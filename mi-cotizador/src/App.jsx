import React, { useState, useEffect } from 'react';
import { AlertTriangle, Truck, FileText, Printer, Settings, Save, Plus, Trash2, Shield, Disc, DoorOpen, Layers, Zap, Lightbulb, Lock, Unlock, LogOut, ClipboardList, Star, Users, History, User, Key, Database, Globe, Image, RefreshCw, Send, Menu, X } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, runTransaction, getDoc } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';

// === MOTOR DE COTIZACIÓN POR ENSAMBLES · V1 ===
// Precios de VENTA por unidad. Cada registro declara moneda, base de IVA y tasa.
// Las listas de México usan importes CON IVA; no se vuelve a agregar al total.
// No se reutilizan los recargos negativos del cotizador anterior como precios absolutos.
const EC_SECCIONES = { piezas: 'piezasCotizacion', ensambles: 'ensamblesCotizacion', modelos: 'modelosCotizacion' };
const EC_TIPOS = {
  ganadero_ganso: 'Ganadero cuello de ganso', ganadero_redondo: 'Ganadero jalón de defensa',
  cama_baja: 'Cama baja', cama_alta: 'Cama alta', volteo: 'Volteo', caja_seca: 'Caja seca', dolly: 'Dolly', volteo_manual: 'Volteo manual', cuatrimotos: 'Cuatrimotos', vasculante: 'Vasculante', comida: 'Puesto de comida', cabezal: 'Cabezal de trilladora', forrajero: 'Forrajero', piedras: 'Cama alta para piedras', caballos: 'Caballos / monturero', otro: 'Otro / especial'
};
const EC_CATEGORIAS = ['Chasis', 'Jalón', 'Rodado y suspensión', 'Piso', 'Carrocería', 'Luces', 'Acabados', 'Accesorios', 'Mano de obra', 'Otro'];
const ecCopia = value => JSON.parse(JSON.stringify(value));
const ecId = prefijo => `${prefijo}_${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`}`;
const ecFecha = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const ecMoneda = (valor, moneda = 'MXN') => valor == null ? 'Sin precio' : new Intl.NumberFormat('es-MX', { style: 'currency', currency: moneda }).format(valor) + ` ${moneda}`;
function ecNumero(valor, etiqueta, { max = 1e9, min = 0, decimales = 2 } = {}) {
  if (valor === null || valor === undefined || valor === '' || typeof valor === 'boolean' ||
      (typeof valor === 'string' && !/^\d+(\.\d+)?$/.test(valor.trim()))) throw new Error(`${etiqueta}: captura un número válido.`);
  const n = Number(valor);
  const factor = 10 ** decimales;
  if (!Number.isFinite(n) || n < min || n > max || Math.abs(n * factor - Math.round(n * factor)) > 0.00001) {
    throw new Error(`${etiqueta}: debe estar entre ${min} y ${max}, con hasta ${decimales} decimales.`);
  }
  return n;
}
const ecCentavos = (valor, etiqueta = 'Precio') => Math.round(ecNumero(valor, etiqueta) * 100);
const ecCantidad = (valor, etiqueta = 'Cantidad') => ecNumero(valor, etiqueta, { min: 0.0001, max: 10000, decimales: 4 });
function ecSuma(valores) {
  const n = valores.reduce((s, v) => s + v, 0);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('El importe supera el rango de cálculo.');
  return n;
}
function ecUnicos(lineas, clave, etiqueta) {
  const ids = lineas.map(clave);
  if (new Set(ids).size !== ids.length) throw new Error(`${etiqueta}: hay elementos repetidos; usa una sola línea y ajusta su cantidad.`);
}
function ecCatalogo(db) {
  return {
    piezas: db.piezasCotizacion || [], ensambles: db.ensamblesCotizacion || [], modelos: db.modelosCotizacion || []
  };
}
function ecComprobarMoneda(item, moneda) {
  if (!['MXN', 'USD'].includes(moneda) || item.moneda !== moneda) throw new Error(`${item.nombre}: la moneda no coincide con ${moneda}.`);
}
function ecComprobarBase(item, base) {
  if (!base) return;
  if (item.basePrecio !== base.basePrecio || Number(item.ivaPct) !== Number(base.ivaPct)) throw new Error(`${item.nombre}: el tratamiento de IVA no coincide con el modelo o ensamble.`);
}
function ecResolverPieza(cat, id, moneda) {
  const item = cat.piezas.find(p => p.id === id);
  if (!item) throw new Error('No se encontró una pieza del catálogo.');
  ecComprobarMoneda(item, moneda);
  return { id: item.id, codigo: item.codigo, nombre: item.nombre, unidad: item.unidad, clase: 'pieza', moneda, centavos: ecCentavos(item.precio, `${item.nombre}, precio`), componentes: [] };
}
function ecResolverEnsamble(cat, id, moneda, { informativo = false } = {}) {
  const item = cat.ensambles.find(e => e.id === id);
  if (!item) throw new Error('No se encontró un ensamble del catálogo.');
  ecComprobarMoneda(item, moneda);
  const lineas = item.componentes || [];
  ecUnicos(lineas, l => l.piezaId, item.nombre);
  const componentes = lineas.map(l => {
    const pieza = cat.piezas.find(p => p.id === l.piezaId);
    if (!pieza) throw new Error(`${item.nombre}: falta una pieza de su composición.`);
    ecComprobarMoneda(pieza, moneda);
    ecComprobarBase(pieza, item);
    const cantidad = ecCantidad(l.cantidad, `Cantidad de ${pieza.nombre}`);
    // En precio fijo, la lista de piezas es informativa: nunca se suma de nuevo.
    const precio = item.modoPrecio === 'componentes' && !informativo ? ecResolverPieza(cat, pieza.id, moneda).centavos : null;
    return { id: pieza.id, codigo: pieza.codigo, nombre: pieza.nombre, unidad: pieza.unidad, cantidad, precioCentavos: precio, importeCentavos: precio === null ? null : Math.round(precio * cantidad) };
  });
  let centavos = null;
  if (!informativo) {
    if (item.modoPrecio === 'fijo') centavos = ecCentavos(item.precio, `${item.nombre}, precio fijo`);
    else if (item.modoPrecio === 'componentes') {
      if (!componentes.length) throw new Error(`${item.nombre}: agrega al menos una pieza.`);
      centavos = ecSuma(componentes.map(p => p.importeCentavos));
    } else throw new Error(`${item.nombre}: selecciona cómo calcular su precio.`);
  }
  return { id: item.id, codigo: item.codigo, nombre: item.nombre, categoria: item.categoria, clase: 'ensamble', moneda, centavos, componentes };
}
function ecResolverReferencia(cat, linea, moneda) {
  if (linea.clase === 'pieza') return ecResolverPieza(cat, linea.itemId, moneda);
  if (linea.clase === 'ensamble') return ecResolverEnsamble(cat, linea.itemId, moneda);
  throw new Error('El tipo de adicional no es válido.');
}
const ecClaveRef = l => `${l.clase}:${l.itemId}`;
function ecCalcular(cat, solicitud) {
  try {
    const modelo = cat.modelos.find(m => m.id === solicitud.modeloId);
    if (!modelo) throw new Error('Selecciona un modelo de remolque.');
    const moneda = modelo.moneda;
    if (!['con_iva', 'sin_iva'].includes(modelo.basePrecio)) throw new Error('Define si el precio del modelo incluye IVA.');
    ecComprobarMoneda(modelo, moneda);
    const cantidad = ecNumero(solicitud.cantidad, 'Cantidad de remolques', { min: 1, max: 1000, decimales: 0 });
    const descuentoPct = ecNumero(solicitud.descuentoPct, 'Descuento', { max: 100, decimales: 4 });
    const ivaPct = ecNumero(modelo.ivaPct, 'Impuesto', { max: 100, decimales: 4 });
    const anticipoCentavos = ecCentavos(solicitud.anticipo, 'Anticipo');
    ecUnicos(modelo.ensambles || [], l => l.ensambleId, modelo.nombre);
    const incluidos = (modelo.ensambles || []).map(l => {
      const item = ecResolverEnsamble(cat, l.ensambleId, moneda, { informativo: modelo.modoPrecio === 'fijo' });
      ecComprobarBase(cat.ensambles.find(e => e.id === l.ensambleId), modelo);
      const unidades = ecCantidad(l.cantidad, `Cantidad de ${item.nombre}`);
      return { ...item, cantidad: unidades, importeCentavos: item.centavos === null ? null : Math.round(item.centavos * unidades) };
    });
    let baseUnitariaCentavos;
    if (modelo.modoPrecio === 'fijo') baseUnitariaCentavos = ecCentavos(modelo.precio, `${modelo.nombre}, precio fijo`);
    else if (modelo.modoPrecio === 'ensambles') {
      if (!incluidos.length) throw new Error(`${modelo.nombre}: agrega al menos un ensamble.`);
      baseUnitariaCentavos = ecSuma(incluidos.map(l => l.importeCentavos));
    } else throw new Error('Selecciona cómo calcular el precio del modelo.');
    ecUnicos(solicitud.extras || [], ecClaveRef, 'Adicionales');
    const extras = (solicitud.extras || []).map(l => {
      if (!(modelo.adicionales || []).some(a => ecClaveRef(a) === ecClaveRef(l))) throw new Error('Un adicional ya no está autorizado para este modelo; vuelve a seleccionarlo.');
      const item = ecResolverReferencia(cat, l, moneda);
      ecComprobarBase((l.clase === 'pieza' ? cat.piezas : cat.ensambles).find(e => e.id === l.itemId), modelo);
      const unidades = ecCantidad(l.cantidad, `Cantidad adicional de ${item.nombre}`);
      return { ...item, cantidad: unidades, importeCentavos: Math.round(item.centavos * unidades) };
    });
    const extrasUnitariosCentavos = ecSuma(extras.map(l => l.importeCentavos));
    const baseCentavos = ecSuma([baseUnitariaCentavos * cantidad]);
    const extrasCentavos = ecSuma([extrasUnitariosCentavos * cantidad]);
    const descuentoCentavos = Math.round(baseCentavos * descuentoPct / 100);
    const importeListaCentavos = ecSuma([baseCentavos - descuentoCentavos, extrasCentavos]);
    const subtotalCentavos = modelo.basePrecio === 'con_iva' ? Math.round(importeListaCentavos / (1 + ivaPct / 100)) : importeListaCentavos;
    const ivaCentavos = modelo.basePrecio === 'con_iva' ? importeListaCentavos - subtotalCentavos : Math.round(subtotalCentavos * ivaPct / 100);
    const totalCentavos = ecSuma([subtotalCentavos, ivaCentavos]);
    if (anticipoCentavos > totalCentavos) throw new Error('El anticipo no puede superar el total.');
    return { ok: true, modelo: ecCopia(modelo), moneda, cantidad, incluidos, extras, baseUnitariaCentavos, extrasUnitariosCentavos, baseCentavos, extrasCentavos, descuentoCentavos, subtotalCentavos, ivaCentavos, totalCentavos, anticipoCentavos, saldoCentavos: totalCentavos - anticipoCentavos, descuentoPct, ivaPct };
  } catch (error) { return { ok: false, error: error.message }; }
}
function ecSolicitud(modelo = null) {
  return { modeloId: modelo?.id || '', cliente: '', telefono: '', fecha: ecFecha(), entrega: '', cantidad: 1, descuentoPct: 0, ivaPct: modelo?.ivaPct ?? 0, anticipo: 0, notas: '', extras: [] };
}
function ecRegistroNuevo(seccion) {
  const base = { id: ecId(seccion), codigo: '', nombre: '', moneda: 'MXN', precio: null, basePrecio: 'con_iva', ivaPct: 16 };
  if (seccion === 'piezas') return { ...base, categoria: 'Otro', unidad: 'pza' };
  if (seccion === 'ensambles') return { ...base, categoria: 'Chasis', modoPrecio: 'fijo', componentes: [] };
  return { ...base, tipo: 'cama_baja', medidas: '', capacidad: '', especificaciones: '', modoPrecio: 'fijo', ivaPct: 16, ensambles: [], adicionales: [] };
}
function ecValidarRegistro(cat, seccion, original) {
  const item = ecCopia(original);
  item.codigo = item.codigo.trim(); item.nombre = item.nombre.trim();
  if (!item.codigo || !item.nombre) throw new Error('Captura el código y el nombre.');
  if (cat[seccion].some(i => i.id !== item.id && i.codigo.toLowerCase() === item.codigo.toLowerCase())) throw new Error('Ya existe un registro con ese código.');
  ecComprobarMoneda(item, item.moneda);
  if (!['con_iva', 'sin_iva'].includes(item.basePrecio)) throw new Error('Indica si el precio incluye IVA.');
  item.ivaPct = ecNumero(item.ivaPct, 'Impuesto', { max: 100, decimales: 4 });
  const usaPrecio = seccion === 'piezas' || item.modoPrecio === 'fijo';
  item.precio = usaPrecio && item.precio !== null && item.precio !== '' ? ecNumero(item.precio, 'Precio de venta') : null;
  if (seccion === 'piezas' && !item.unidad.trim()) throw new Error('Captura la unidad de la pieza.');
  if (seccion === 'ensambles') {
    if (!['fijo', 'componentes'].includes(item.modoPrecio)) throw new Error('Selecciona el modo de precio del ensamble.');
    ecUnicos(item.componentes, l => l.piezaId, 'Piezas');
    item.componentes = item.componentes.map(l => {
      const pieza = cat.piezas.find(p => p.id === l.piezaId);
      if (!pieza) throw new Error('Selecciona una pieza en cada línea.');
      ecComprobarMoneda(pieza, item.moneda);
      ecComprobarBase(pieza, item);
      return { piezaId: l.piezaId, cantidad: ecCantidad(l.cantidad) };
    });
  }
  if (seccion === 'modelos') {
    if (!EC_TIPOS[item.tipo]) throw new Error('Selecciona un tipo de remolque.');
    if (!['fijo', 'ensambles'].includes(item.modoPrecio)) throw new Error('Selecciona el modo de precio del modelo.');
    item.ivaPct = ecNumero(item.ivaPct, 'Impuesto', { max: 100, decimales: 4 });
    ecUnicos(item.ensambles, l => l.ensambleId, 'Ensambles');
    ecUnicos(item.adicionales, ecClaveRef, 'Adicionales');
    item.ensambles = item.ensambles.map(l => {
      const ensamble = cat.ensambles.find(e => e.id === l.ensambleId);
      if (!ensamble) throw new Error('Selecciona un ensamble en cada línea.');
      ecComprobarMoneda(ensamble, item.moneda);
      ecComprobarBase(ensamble, item);
      return { ensambleId: l.ensambleId, cantidad: ecCantidad(l.cantidad) };
    });
    item.adicionales.forEach(l => {
      const candidato = (l.clase === 'pieza' ? cat.piezas : l.clase === 'ensamble' ? cat.ensambles : []).find(e => e.id === l.itemId);
      if (!candidato) throw new Error('Selecciona un adicional en cada línea.');
      ecComprobarMoneda(candidato, item.moneda);
      ecComprobarBase(candidato, item);
    });
  }
  return item;
}
function ecDependencias(cat, seccion, id) {
  if (seccion === 'modelos') return [];
  const referencias = seccion === 'piezas' ? cat.ensambles.filter(e => e.componentes.some(l => l.piezaId === id)) : [];
  return [...referencias, ...cat.modelos.filter(m => (seccion === 'ensambles' && m.ensambles.some(l => l.ensambleId === id)) || m.adicionales.some(l => l.clase === (seccion === 'piezas' ? 'pieza' : 'ensamble') && l.itemId === id))].map(i => i.nombre);
}
function ecSnapshot(solicitud, calculo, vendedor, id = ecId('ENS')) {
  if (!calculo.ok) throw new Error(calculo.error);
  if (!solicitud.cliente.trim()) throw new Error('Captura el nombre del cliente antes de guardar.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(solicitud.fecha)) throw new Error('Captura una fecha válida.');
  return ecCopia({ schemaVersion: 1, id, creadoEn: new Date().toISOString(), vendedor, solicitud, calculo });
}
// === FIN DEL MOTOR DE ENSAMBLES ===

// Precios transcritos de las listas del usuario. IVA incluido.
const EC_PRECIOS_MEXICO = {"version":"MX-listas-2024-caja2020-mas35-v1","moneda":"MXN","ivaIncluido":true,"tasaIva":16,"fuentes":{"caja":["8e7a4bbf-134f-4559-b5d3-89552017ada4.png","2020-05-29",35],"volteo":["0c177731-be62-46a8-a036-1d900de8c7bf.png","2024-02-02",0],"especiales":["a32071f4-14f2-45d7-ae8c-016bd4238fe9.png","2024-02-02",0],"ganadero":["b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","2024-02-02",0],"cama":["18742905-86b9-443a-8f04-de684b70e041.png","2024-02-02",0]},"modelos":[{"id":"MX-caja-CS1-48in_x_8ft-850_kg-Caja_seca","codigo":"CS1 / Caja seca / 850 kg / 48\" x 8'","codigoLista":"CS1","nombre":"CS1 · Caja seca · 48\" x 8' · 850 kg","tipo":"caja_seca","medidas":"48\" x 8'","capacidad":"850 kg","especificaciones":"Piso de madera; forrado con triplay; puerta tipo libro. Altura 1.20 m (solo CS1).","moneda":"MXN","precio":64389.9,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAJA-FRENOS"},{"clase":"pieza","itemId":"MX-CAJA-GATO7"},{"clase":"pieza","itemId":"MX-CAJA-PTARAMPA"},{"clase":"pieza","itemId":"MX-CAJA-PTALATERAL"},{"clase":"pieza","itemId":"MX-CAJA-LL750"},{"clase":"pieza","itemId":"MX-CAJA-LL700"},{"clase":"pieza","itemId":"MX-CAJA-CONTROL"},{"clase":"pieza","itemId":"MX-CAJA-PORTA"}],"origen":{"archivo":"8e7a4bbf-134f-4559-b5d3-89552017ada4.png","fechaLista":"2020-05-29","precioLista":47696.22,"ajustePct":35,"precioAplicado":64389.9,"nota":"Importes con IVA incluido, confirmado por el usuario. Aumento del 35% en la hoja de 2020."},"_revision":1},{"id":"MX-caja-CS1-48in_x_8ft-1.5_ton-Caja_seca","codigo":"CS1 / Caja seca / 1.5 ton / 48\" x 8'","codigoLista":"CS1","nombre":"CS1 · Caja seca · 48\" x 8' · 1.5 ton","tipo":"caja_seca","medidas":"48\" x 8'","capacidad":"1.5 ton","especificaciones":"Piso de madera; forrado con triplay; puerta tipo libro. Altura 1.20 m (solo CS1).","moneda":"MXN","precio":73841.63,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAJA-FRENOS"},{"clase":"pieza","itemId":"MX-CAJA-GATO7"},{"clase":"pieza","itemId":"MX-CAJA-PTARAMPA"},{"clase":"pieza","itemId":"MX-CAJA-PTALATERAL"},{"clase":"pieza","itemId":"MX-CAJA-LL750"},{"clase":"pieza","itemId":"MX-CAJA-LL700"},{"clase":"pieza","itemId":"MX-CAJA-CONTROL"},{"clase":"pieza","itemId":"MX-CAJA-PORTA"}],"origen":{"archivo":"8e7a4bbf-134f-4559-b5d3-89552017ada4.png","fechaLista":"2020-05-29","precioLista":54697.5,"ajustePct":35,"precioAplicado":73841.63,"nota":"Importes con IVA incluido, confirmado por el usuario. Aumento del 35% en la hoja de 2020."},"_revision":1},{"id":"MX-caja-CS2-60in_x_10ft-1.5_ton-Caja_seca","codigo":"CS2 / Caja seca / 1.5 ton / 60\" x 10'","codigoLista":"CS2","nombre":"CS2 · Caja seca · 60\" x 10' · 1.5 ton","tipo":"caja_seca","medidas":"60\" x 10'","capacidad":"1.5 ton","especificaciones":"Piso de madera; forrado con triplay; puerta tipo libro. Altura 2 m.","moneda":"MXN","precio":97470.95,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAJA-FRENOS"},{"clase":"pieza","itemId":"MX-CAJA-GATO7"},{"clase":"pieza","itemId":"MX-CAJA-PTARAMPA"},{"clase":"pieza","itemId":"MX-CAJA-PTALATERAL"},{"clase":"pieza","itemId":"MX-CAJA-LL750"},{"clase":"pieza","itemId":"MX-CAJA-LL700"},{"clase":"pieza","itemId":"MX-CAJA-CONTROL"},{"clase":"pieza","itemId":"MX-CAJA-PORTA"}],"origen":{"archivo":"8e7a4bbf-134f-4559-b5d3-89552017ada4.png","fechaLista":"2020-05-29","precioLista":72200.7,"ajustePct":35,"precioAplicado":97470.95,"nota":"Importes con IVA incluido, confirmado por el usuario. Aumento del 35% en la hoja de 2020."},"_revision":1},{"id":"MX-caja-CS2-60in_x_10ft-3_ton-Caja_seca","codigo":"CS2 / Caja seca / 3 ton / 60\" x 10'","codigoLista":"CS2","nombre":"CS2 · Caja seca · 60\" x 10' · 3 ton","tipo":"caja_seca","medidas":"60\" x 10'","capacidad":"3 ton","especificaciones":"Piso de madera; forrado con triplay; puerta tipo libro. Altura 2 m.","moneda":"MXN","precio":112239.27,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAJA-FRENOS"},{"clase":"pieza","itemId":"MX-CAJA-GATO7"},{"clase":"pieza","itemId":"MX-CAJA-PTARAMPA"},{"clase":"pieza","itemId":"MX-CAJA-PTALATERAL"},{"clase":"pieza","itemId":"MX-CAJA-LL750"},{"clase":"pieza","itemId":"MX-CAJA-LL700"},{"clase":"pieza","itemId":"MX-CAJA-CONTROL"},{"clase":"pieza","itemId":"MX-CAJA-PORTA"}],"origen":{"archivo":"8e7a4bbf-134f-4559-b5d3-89552017ada4.png","fechaLista":"2020-05-29","precioLista":83140.2,"ajustePct":35,"precioAplicado":112239.27,"nota":"Importes con IVA incluido, confirmado por el usuario. Aumento del 35% en la hoja de 2020."},"_revision":1},{"id":"MX-caja-CS3-60in_x_12ft-1.5_ton-Caja_seca","codigo":"CS3 / Caja seca / 1.5 ton / 60\" x 12'","codigoLista":"CS3","nombre":"CS3 · Caja seca · 60\" x 12' · 1.5 ton","tipo":"caja_seca","medidas":"60\" x 12'","capacidad":"1.5 ton","especificaciones":"Piso de madera; forrado con triplay; puerta tipo libro. Altura 2 m.","moneda":"MXN","precio":108694.87,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAJA-FRENOS"},{"clase":"pieza","itemId":"MX-CAJA-GATO7"},{"clase":"pieza","itemId":"MX-CAJA-PTARAMPA"},{"clase":"pieza","itemId":"MX-CAJA-PTALATERAL"},{"clase":"pieza","itemId":"MX-CAJA-LL750"},{"clase":"pieza","itemId":"MX-CAJA-LL700"},{"clase":"pieza","itemId":"MX-CAJA-CONTROL"},{"clase":"pieza","itemId":"MX-CAJA-PORTA"}],"origen":{"archivo":"8e7a4bbf-134f-4559-b5d3-89552017ada4.png","fechaLista":"2020-05-29","precioLista":80514.72,"ajustePct":35,"precioAplicado":108694.87,"nota":"Importes con IVA incluido, confirmado por el usuario. Aumento del 35% en la hoja de 2020."},"_revision":1},{"id":"MX-caja-CS3-60in_x_12ft-3_ton-Caja_seca","codigo":"CS3 / Caja seca / 3 ton / 60\" x 12'","codigoLista":"CS3","nombre":"CS3 · Caja seca · 60\" x 12' · 3 ton","tipo":"caja_seca","medidas":"60\" x 12'","capacidad":"3 ton","especificaciones":"Piso de madera; forrado con triplay; puerta tipo libro. Altura 2 m.","moneda":"MXN","precio":123463.2,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAJA-FRENOS"},{"clase":"pieza","itemId":"MX-CAJA-GATO7"},{"clase":"pieza","itemId":"MX-CAJA-PTARAMPA"},{"clase":"pieza","itemId":"MX-CAJA-PTALATERAL"},{"clase":"pieza","itemId":"MX-CAJA-LL750"},{"clase":"pieza","itemId":"MX-CAJA-LL700"},{"clase":"pieza","itemId":"MX-CAJA-CONTROL"},{"clase":"pieza","itemId":"MX-CAJA-PORTA"}],"origen":{"archivo":"8e7a4bbf-134f-4559-b5d3-89552017ada4.png","fechaLista":"2020-05-29","precioLista":91454.22,"ajustePct":35,"precioAplicado":123463.2,"nota":"Importes con IVA incluido, confirmado por el usuario. Aumento del 35% en la hoja de 2020."},"_revision":1},{"id":"MX-caja-CS3-60in_x_12ft-6_ton-Caja_seca","codigo":"CS3 / Caja seca / 6 ton / 60\" x 12'","codigoLista":"CS3","nombre":"CS3 · Caja seca · 60\" x 12' · 6 ton","tipo":"caja_seca","medidas":"60\" x 12'","capacidad":"6 ton","especificaciones":"Piso de madera; forrado con triplay; puerta tipo libro. Altura 2 m.","moneda":"MXN","precio":153073.8,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAJA-FRENOS"},{"clase":"pieza","itemId":"MX-CAJA-GATO7"},{"clase":"pieza","itemId":"MX-CAJA-PTARAMPA"},{"clase":"pieza","itemId":"MX-CAJA-PTALATERAL"},{"clase":"pieza","itemId":"MX-CAJA-LL750"},{"clase":"pieza","itemId":"MX-CAJA-LL700"},{"clase":"pieza","itemId":"MX-CAJA-CONTROL"},{"clase":"pieza","itemId":"MX-CAJA-PORTA"}],"origen":{"archivo":"8e7a4bbf-134f-4559-b5d3-89552017ada4.png","fechaLista":"2020-05-29","precioLista":113388.0,"ajustePct":35,"precioAplicado":153073.8,"nota":"Importes con IVA incluido, confirmado por el usuario. Aumento del 35% en la hoja de 2020."},"_revision":1},{"id":"MX-caja-CS4-60in_x_14ft-1.5_ton-Caja_seca","codigo":"CS4 / Caja seca / 1.5 ton / 60\" x 14'","codigoLista":"CS4","nombre":"CS4 · Caja seca · 60\" x 14' · 1.5 ton","tipo":"caja_seca","medidas":"60\" x 14'","capacidad":"1.5 ton","especificaciones":"Piso de madera; forrado con triplay; puerta tipo libro. Altura 2 m.","moneda":"MXN","precio":119999.56,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAJA-FRENOS"},{"clase":"pieza","itemId":"MX-CAJA-GATO7"},{"clase":"pieza","itemId":"MX-CAJA-PTARAMPA"},{"clase":"pieza","itemId":"MX-CAJA-PTALATERAL"},{"clase":"pieza","itemId":"MX-CAJA-LL750"},{"clase":"pieza","itemId":"MX-CAJA-LL700"},{"clase":"pieza","itemId":"MX-CAJA-CONTROL"},{"clase":"pieza","itemId":"MX-CAJA-PORTA"}],"origen":{"archivo":"8e7a4bbf-134f-4559-b5d3-89552017ada4.png","fechaLista":"2020-05-29","precioLista":88888.56,"ajustePct":35,"precioAplicado":119999.56,"nota":"Importes con IVA incluido, confirmado por el usuario. Aumento del 35% en la hoja de 2020."},"_revision":1},{"id":"MX-caja-CS4-60in_x_14ft-3_ton-Caja_seca","codigo":"CS4 / Caja seca / 3 ton / 60\" x 14'","codigoLista":"CS4","nombre":"CS4 · Caja seca · 60\" x 14' · 3 ton","tipo":"caja_seca","medidas":"60\" x 14'","capacidad":"3 ton","especificaciones":"Piso de madera; forrado con triplay; puerta tipo libro. Altura 2 m.","moneda":"MXN","precio":134687.12,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAJA-FRENOS"},{"clase":"pieza","itemId":"MX-CAJA-GATO7"},{"clase":"pieza","itemId":"MX-CAJA-PTARAMPA"},{"clase":"pieza","itemId":"MX-CAJA-PTALATERAL"},{"clase":"pieza","itemId":"MX-CAJA-LL750"},{"clase":"pieza","itemId":"MX-CAJA-LL700"},{"clase":"pieza","itemId":"MX-CAJA-CONTROL"},{"clase":"pieza","itemId":"MX-CAJA-PORTA"}],"origen":{"archivo":"8e7a4bbf-134f-4559-b5d3-89552017ada4.png","fechaLista":"2020-05-29","precioLista":99768.24,"ajustePct":35,"precioAplicado":134687.12,"nota":"Importes con IVA incluido, confirmado por el usuario. Aumento del 35% en la hoja de 2020."},"_revision":1},{"id":"MX-caja-CS4-60in_x_14ft-6_ton-Caja_seca","codigo":"CS4 / Caja seca / 6 ton / 60\" x 14'","codigoLista":"CS4","nombre":"CS4 · Caja seca · 60\" x 14' · 6 ton","tipo":"caja_seca","medidas":"60\" x 14'","capacidad":"6 ton","especificaciones":"Piso de madera; forrado con triplay; puerta tipo libro. Altura 2 m.","moneda":"MXN","precio":164304.53,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAJA-FRENOS"},{"clase":"pieza","itemId":"MX-CAJA-GATO7"},{"clase":"pieza","itemId":"MX-CAJA-PTARAMPA"},{"clase":"pieza","itemId":"MX-CAJA-PTALATERAL"},{"clase":"pieza","itemId":"MX-CAJA-LL750"},{"clase":"pieza","itemId":"MX-CAJA-LL700"},{"clase":"pieza","itemId":"MX-CAJA-CONTROL"},{"clase":"pieza","itemId":"MX-CAJA-PORTA"}],"origen":{"archivo":"8e7a4bbf-134f-4559-b5d3-89552017ada4.png","fechaLista":"2020-05-29","precioLista":121707.06,"ajustePct":35,"precioAplicado":164304.53,"nota":"Importes con IVA incluido, confirmado por el usuario. Aumento del 35% en la hoja de 2020."},"_revision":1},{"id":"MX-caja-CS5-82in_x_16ft-3_ton-Caja_seca","codigo":"CS5 / Caja seca / 3 ton / 82\" x 16'","codigoLista":"CS5","nombre":"CS5 · Caja seca · 82\" x 16' · 3 ton","tipo":"caja_seca","medidas":"82\" x 16'","capacidad":"3 ton","especificaciones":"Piso de madera; forrado con triplay; puerta tipo libro. Altura 2 m.","moneda":"MXN","precio":158918.36,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAJA-FRENOS"},{"clase":"pieza","itemId":"MX-CAJA-GATO7"},{"clase":"pieza","itemId":"MX-CAJA-PTARAMPA"},{"clase":"pieza","itemId":"MX-CAJA-PTALATERAL"},{"clase":"pieza","itemId":"MX-CAJA-LL750"},{"clase":"pieza","itemId":"MX-CAJA-LL700"},{"clase":"pieza","itemId":"MX-CAJA-CONTROL"},{"clase":"pieza","itemId":"MX-CAJA-PORTA"}],"origen":{"archivo":"8e7a4bbf-134f-4559-b5d3-89552017ada4.png","fechaLista":"2020-05-29","precioLista":117717.3,"ajustePct":35,"precioAplicado":158918.36,"nota":"Importes con IVA incluido, confirmado por el usuario. Aumento del 35% en la hoja de 2020."},"_revision":1},{"id":"MX-caja-CS5-82in_x_16ft-6_ton-Caja_seca","codigo":"CS5 / Caja seca / 6 ton / 82\" x 16'","codigoLista":"CS5","nombre":"CS5 · Caja seca · 82\" x 16' · 6 ton","tipo":"caja_seca","medidas":"82\" x 16'","capacidad":"6 ton","especificaciones":"Piso de madera; forrado con triplay; puerta tipo libro. Altura 2 m.","moneda":"MXN","precio":188550.29,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAJA-FRENOS"},{"clase":"pieza","itemId":"MX-CAJA-GATO7"},{"clase":"pieza","itemId":"MX-CAJA-PTARAMPA"},{"clase":"pieza","itemId":"MX-CAJA-PTALATERAL"},{"clase":"pieza","itemId":"MX-CAJA-LL750"},{"clase":"pieza","itemId":"MX-CAJA-LL700"},{"clase":"pieza","itemId":"MX-CAJA-CONTROL"},{"clase":"pieza","itemId":"MX-CAJA-PORTA"}],"origen":{"archivo":"8e7a4bbf-134f-4559-b5d3-89552017ada4.png","fechaLista":"2020-05-29","precioLista":139666.88,"ajustePct":35,"precioAplicado":188550.29,"nota":"Importes con IVA incluido, confirmado por el usuario. Aumento del 35% en la hoja de 2020."},"_revision":1},{"id":"MX-volteo-CV2H-60in_x_12ft-1.5_ton-Con_tractor","codigo":"CV2H / Con tractor / 1.5 ton / 60\" x 12'","codigoLista":"CV2H","nombre":"CV2H · Con tractor · 60\" x 12' · 1.5 ton","tipo":"volteo","medidas":"60\" x 12'","capacidad":"1.5 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":101739.65,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":101739.65,"ajustePct":0,"precioAplicado":101739.65,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV2H-60in_x_12ft-3_ton-Con_tractor","codigo":"CV2H / Con tractor / 3 ton / 60\" x 12'","codigoLista":"CV2H","nombre":"CV2H · Con tractor · 60\" x 12' · 3 ton","tipo":"volteo","medidas":"60\" x 12'","capacidad":"3 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":115640.45,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":115640.45,"ajustePct":0,"precioAplicado":115640.45,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV2H-60in_x_12ft-6_ton-Con_tractor","codigo":"CV2H / Con tractor / 6 ton / 60\" x 12'","codigoLista":"CV2H","nombre":"CV2H · Con tractor · 60\" x 12' · 6 ton","tipo":"volteo","medidas":"60\" x 12'","capacidad":"6 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":132397.89,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":132397.89,"ajustePct":0,"precioAplicado":132397.89,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV3H-60in_x_14ft-1.5_ton-Con_tractor","codigo":"CV3H / Con tractor / 1.5 ton / 60\" x 14'","codigoLista":"CV3H","nombre":"CV3H · Con tractor · 60\" x 14' · 1.5 ton","tipo":"volteo","medidas":"60\" x 14'","capacidad":"1.5 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":106713.48,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":106713.48,"ajustePct":0,"precioAplicado":106713.48,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV3H-60in_x_14ft-3_ton-Con_tractor","codigo":"CV3H / Con tractor / 3 ton / 60\" x 14'","codigoLista":"CV3H","nombre":"CV3H · Con tractor · 60\" x 14' · 3 ton","tipo":"volteo","medidas":"60\" x 14'","capacidad":"3 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":120661.93,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":120661.93,"ajustePct":0,"precioAplicado":120661.93,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV3H-60in_x_14ft-6_ton-Con_tractor","codigo":"CV3H / Con tractor / 6 ton / 60\" x 14'","codigoLista":"CV3H","nombre":"CV3H · Con tractor · 60\" x 14' · 6 ton","tipo":"volteo","medidas":"60\" x 14'","capacidad":"6 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":138045.64,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":138045.64,"ajustePct":0,"precioAplicado":138045.64,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV4H-60in_x_16ft-3_ton-Con_tractor","codigo":"CV4H / Con tractor / 3 ton / 60\" x 16'","codigoLista":"CV4H","nombre":"CV4H · Con tractor · 60\" x 16' · 3 ton","tipo":"volteo","medidas":"60\" x 16'","capacidad":"3 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":126459.74,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":126459.74,"ajustePct":0,"precioAplicado":126459.74,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV4H-60in_x_16ft-6_ton-Con_tractor","codigo":"CV4H / Con tractor / 6 ton / 60\" x 16'","codigoLista":"CV4H","nombre":"CV4H · Con tractor · 60\" x 16' · 6 ton","tipo":"volteo","medidas":"60\" x 16'","capacidad":"6 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":143843.34,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":143843.34,"ajustePct":0,"precioAplicado":143843.34,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV6H-69in_x_12ft-1.5_ton-Con_tractor","codigo":"CV6H / Con tractor / 1.5 ton / 69\" x 12'","codigoLista":"CV6H","nombre":"CV6H · Con tractor · 69\" x 12' · 1.5 ton","tipo":"volteo","medidas":"69\" x 12'","capacidad":"1.5 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":105619.56,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":105619.56,"ajustePct":0,"precioAplicado":105619.56,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV6H-69in_x_12ft-3_ton-Con_tractor","codigo":"CV6H / Con tractor / 3 ton / 69\" x 12'","codigoLista":"CV6H","nombre":"CV6H · Con tractor · 69\" x 12' · 3 ton","tipo":"volteo","medidas":"69\" x 12'","capacidad":"3 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":119568.87,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":119568.87,"ajustePct":0,"precioAplicado":119568.87,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV6H-69in_x_12ft-6_ton-Con_tractor","codigo":"CV6H / Con tractor / 6 ton / 69\" x 12'","codigoLista":"CV6H","nombre":"CV6H · Con tractor · 69\" x 12' · 6 ton","tipo":"volteo","medidas":"69\" x 12'","capacidad":"6 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":136499.36,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":136499.36,"ajustePct":0,"precioAplicado":136499.36,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV7H-69in_x_14ft-1.5_ton-Con_tractor","codigo":"CV7H / Con tractor / 1.5 ton / 69\" x 14'","codigoLista":"CV7H","nombre":"CV7H · Con tractor · 69\" x 14' · 1.5 ton","tipo":"volteo","medidas":"69\" x 14'","capacidad":"1.5 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":110195.27,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":110195.27,"ajustePct":0,"precioAplicado":110195.27,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV7H-69in_x_14ft-3_ton-Con_tractor","codigo":"CV7H / Con tractor / 3 ton / 69\" x 14'","codigoLista":"CV7H","nombre":"CV7H · Con tractor · 69\" x 14' · 3 ton","tipo":"volteo","medidas":"69\" x 14'","capacidad":"3 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":124143.73,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":124143.73,"ajustePct":0,"precioAplicado":124143.73,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV7H-69in_x_14ft-6_ton-Con_tractor","codigo":"CV7H / Con tractor / 6 ton / 69\" x 14'","codigoLista":"CV7H","nombre":"CV7H · Con tractor · 69\" x 14' · 6 ton","tipo":"volteo","medidas":"69\" x 14'","capacidad":"6 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":140750.97,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":140750.97,"ajustePct":0,"precioAplicado":140750.97,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV8H-69in_x_16ft-3_ton-Con_tractor","codigo":"CV8H / Con tractor / 3 ton / 69\" x 16'","codigoLista":"CV8H","nombre":"CV8H · Con tractor · 69\" x 16' · 3 ton","tipo":"volteo","medidas":"69\" x 16'","capacidad":"3 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":125047.46,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":125047.46,"ajustePct":0,"precioAplicado":125047.46,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV8H-69in_x_16ft-6_ton-Con_tractor","codigo":"CV8H / Con tractor / 6 ton / 69\" x 16'","codigoLista":"CV8H","nombre":"CV8H · Con tractor · 69\" x 16' · 6 ton","tipo":"volteo","medidas":"69\" x 16'","capacidad":"6 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":141991.23,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":141991.23,"ajustePct":0,"precioAplicado":141991.23,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV10H-76in_x_12ft-1.5_ton-Con_tractor","codigo":"CV10H / Con tractor / 1.5 ton / 76\" x 12'","codigoLista":"CV10H","nombre":"CV10H · Con tractor · 76\" x 12' · 1.5 ton","tipo":"volteo","medidas":"76\" x 12'","capacidad":"1.5 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":108994.21,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":108994.21,"ajustePct":0,"precioAplicado":108994.21,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV10H-76in_x_12ft-3_ton-Con_tractor","codigo":"CV10H / Con tractor / 3 ton / 76\" x 12'","codigoLista":"CV10H","nombre":"CV10H · Con tractor · 76\" x 12' · 3 ton","tipo":"volteo","medidas":"76\" x 12'","capacidad":"3 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":122942.68,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":122942.68,"ajustePct":0,"precioAplicado":122942.68,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV10H-76in_x_12ft-6_ton-Con_tractor","codigo":"CV10H / Con tractor / 6 ton / 76\" x 12'","codigoLista":"CV10H","nombre":"CV10H · Con tractor · 76\" x 12' · 6 ton","tipo":"volteo","medidas":"76\" x 12'","capacidad":"6 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":140326.38,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":140326.38,"ajustePct":0,"precioAplicado":140326.38,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV11H-76in_x_14ft-3_ton-Con_tractor","codigo":"CV11H / Con tractor / 3 ton / 76\" x 14'","codigoLista":"CV11H","nombre":"CV11H · Con tractor · 76\" x 14' · 3 ton","tipo":"volteo","medidas":"76\" x 14'","capacidad":"3 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":128944.7,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":128944.7,"ajustePct":0,"precioAplicado":128944.7,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV11H-76in_x_14ft-6_ton-Con_tractor","codigo":"CV11H / Con tractor / 6 ton / 76\" x 14'","codigoLista":"CV11H","nombre":"CV11H · Con tractor · 76\" x 14' · 6 ton","tipo":"volteo","medidas":"76\" x 14'","capacidad":"6 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":146561.71,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":146561.71,"ajustePct":0,"precioAplicado":146561.71,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV12H-76in_x_16ft-3_ton-Con_tractor","codigo":"CV12H / Con tractor / 3 ton / 76\" x 16'","codigoLista":"CV12H","nombre":"CV12H · Con tractor · 76\" x 16' · 3 ton","tipo":"volteo","medidas":"76\" x 16'","capacidad":"3 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":135136.15,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":135136.15,"ajustePct":0,"precioAplicado":135136.15,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV12H-76in_x_16ft-6_ton-Con_tractor","codigo":"CV12H / Con tractor / 6 ton / 76\" x 16'","codigoLista":"CV12H","nombre":"CV12H · Con tractor · 76\" x 16' · 6 ton","tipo":"volteo","medidas":"76\" x 16'","capacidad":"6 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":152753.64,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":152753.64,"ajustePct":0,"precioAplicado":152753.64,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV13H-82in_x_12ft-3_ton-Con_tractor","codigo":"CV13H / Con tractor / 3 ton / 82\" x 12'","codigoLista":"CV13H","nombre":"CV13H · Con tractor · 82\" x 12' · 3 ton","tipo":"volteo","medidas":"82\" x 12'","capacidad":"3 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":125123.96,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":125123.96,"ajustePct":0,"precioAplicado":125123.96,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV13H-82in_x_12ft-6_ton-Con_tractor","codigo":"CV13H / Con tractor / 6 ton / 82\" x 12'","codigoLista":"CV13H","nombre":"CV13H · Con tractor · 82\" x 12' · 6 ton","tipo":"volteo","medidas":"82\" x 12'","capacidad":"6 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":142379.81,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":142379.81,"ajustePct":0,"precioAplicado":142379.81,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV14H-82in_x_14ft-3_ton-Con_tractor","codigo":"CV14H / Con tractor / 3 ton / 82\" x 14'","codigoLista":"CV14H","nombre":"CV14H · Con tractor · 82\" x 14' · 3 ton","tipo":"volteo","medidas":"82\" x 14'","capacidad":"3 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":131239.53,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":131239.53,"ajustePct":0,"precioAplicado":131239.53,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV14H-82in_x_14ft-6_ton-Con_tractor","codigo":"CV14H / Con tractor / 6 ton / 82\" x 14'","codigoLista":"CV14H","nombre":"CV14H · Con tractor · 82\" x 14' · 6 ton","tipo":"volteo","medidas":"82\" x 14'","capacidad":"6 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":151118.08,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":151118.08,"ajustePct":0,"precioAplicado":151118.08,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV15H-82in_x_16ft-3_ton-Con_tractor","codigo":"CV15H / Con tractor / 3 ton / 82\" x 16'","codigoLista":"CV15H","nombre":"CV15H · Con tractor · 82\" x 16' · 3 ton","tipo":"volteo","medidas":"82\" x 16'","capacidad":"3 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":138535.22,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":138535.22,"ajustePct":0,"precioAplicado":138535.22,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV15H-82in_x_16ft-6_ton-Con_tractor","codigo":"CV15H / Con tractor / 6 ton / 82\" x 16'","codigoLista":"CV15H","nombre":"CV15H · Con tractor · 82\" x 16' · 6 ton","tipo":"volteo","medidas":"82\" x 16'","capacidad":"6 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con tractor.","moneda":"MXN","precio":154396.65,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":154396.65,"ajustePct":0,"precioAplicado":154396.65,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV2H-60in_x_12ft-1.5_ton-Con_bomba_eléctrica","codigo":"CV2H / Con bomba eléctrica / 1.5 ton / 60\" x 12'","codigoLista":"CV2H","nombre":"CV2H · Con bomba eléctrica · 60\" x 12' · 1.5 ton","tipo":"volteo","medidas":"60\" x 12'","capacidad":"1.5 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":121679.55,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":121679.55,"ajustePct":0,"precioAplicado":121679.55,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV2H-60in_x_12ft-3_ton-Con_bomba_eléctrica","codigo":"CV2H / Con bomba eléctrica / 3 ton / 60\" x 12'","codigoLista":"CV2H","nombre":"CV2H · Con bomba eléctrica · 60\" x 12' · 3 ton","tipo":"volteo","medidas":"60\" x 12'","capacidad":"3 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":135581.93,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":135581.93,"ajustePct":0,"precioAplicado":135581.93,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV2H-60in_x_12ft-6_ton-Con_bomba_eléctrica","codigo":"CV2H / Con bomba eléctrica / 6 ton / 60\" x 12'","codigoLista":"CV2H","nombre":"CV2H · Con bomba eléctrica · 60\" x 12' · 6 ton","tipo":"volteo","medidas":"60\" x 12'","capacidad":"6 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":152340.11,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":152340.11,"ajustePct":0,"precioAplicado":152340.11,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV3H-60in_x_14ft-1.5_ton-Con_bomba_eléctrica","codigo":"CV3H / Con bomba eléctrica / 1.5 ton / 60\" x 14'","codigoLista":"CV3H","nombre":"CV3H · Con bomba eléctrica · 60\" x 14' · 1.5 ton","tipo":"volteo","medidas":"60\" x 14'","capacidad":"1.5 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":125892.3,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":125892.3,"ajustePct":0,"precioAplicado":125892.3,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV3H-60in_x_14ft-3_ton-Con_bomba_eléctrica","codigo":"CV3H / Con bomba eléctrica / 3 ton / 60\" x 14'","codigoLista":"CV3H","nombre":"CV3H · Con bomba eléctrica · 60\" x 14' · 3 ton","tipo":"volteo","medidas":"60\" x 14'","capacidad":"3 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":140601.85,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":140601.85,"ajustePct":0,"precioAplicado":140601.85,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV3H-60in_x_14ft-6_ton-Con_bomba_eléctrica","codigo":"CV3H / Con bomba eléctrica / 6 ton / 60\" x 14'","codigoLista":"CV3H","nombre":"CV3H · Con bomba eléctrica · 60\" x 14' · 6 ton","tipo":"volteo","medidas":"60\" x 14'","capacidad":"6 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":157987.71,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":157987.71,"ajustePct":0,"precioAplicado":157987.71,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV4H-60in_x_16ft-3_ton-Con_bomba_eléctrica","codigo":"CV4H / Con bomba eléctrica / 3 ton / 60\" x 16'","codigoLista":"CV4H","nombre":"CV4H · Con bomba eléctrica · 60\" x 16' · 3 ton","tipo":"volteo","medidas":"60\" x 16'","capacidad":"3 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":146399.66,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":146399.66,"ajustePct":0,"precioAplicado":146399.66,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV4H-60in_x_16ft-6_ton-Con_bomba_eléctrica","codigo":"CV4H / Con bomba eléctrica / 6 ton / 60\" x 16'","codigoLista":"CV4H","nombre":"CV4H · Con bomba eléctrica · 60\" x 16' · 6 ton","tipo":"volteo","medidas":"60\" x 16'","capacidad":"6 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":163785.52,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":163785.52,"ajustePct":0,"precioAplicado":163785.52,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV6H-69in_x_12ft-1.5_ton-Con_bomba_eléctrica","codigo":"CV6H / Con bomba eléctrica / 1.5 ton / 69\" x 12'","codigoLista":"CV6H","nombre":"CV6H · Con bomba eléctrica · 69\" x 12' · 1.5 ton","tipo":"volteo","medidas":"69\" x 12'","capacidad":"1.5 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":125636.67,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":125636.67,"ajustePct":0,"precioAplicado":125636.67,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV6H-69in_x_12ft-3_ton-Con_bomba_eléctrica","codigo":"CV6H / Con bomba eléctrica / 3 ton / 69\" x 12'","codigoLista":"CV6H","nombre":"CV6H · Con bomba eléctrica · 69\" x 12' · 3 ton","tipo":"volteo","medidas":"69\" x 12'","capacidad":"3 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":139539.05,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":139539.05,"ajustePct":0,"precioAplicado":139539.05,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV6H-69in_x_12ft-6_ton-Con_bomba_eléctrica","codigo":"CV6H / Con bomba eléctrica / 6 ton / 69\" x 12'","codigoLista":"CV6H","nombre":"CV6H · Con bomba eléctrica · 69\" x 12' · 6 ton","tipo":"volteo","medidas":"69\" x 12'","capacidad":"6 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":156391.98,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":156391.98,"ajustePct":0,"precioAplicado":156391.98,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV7H-69in_x_14ft-1.5_ton-Con_bomba_eléctrica","codigo":"CV7H / Con bomba eléctrica / 1.5 ton / 69\" x 14'","codigoLista":"CV7H","nombre":"CV7H · Con bomba eléctrica · 69\" x 14' · 1.5 ton","tipo":"volteo","medidas":"69\" x 14'","capacidad":"1.5 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":130300.07,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":130300.07,"ajustePct":0,"precioAplicado":130300.07,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV7H-69in_x_14ft-3_ton-Con_bomba_eléctrica","codigo":"CV7H / Con bomba eléctrica / 3 ton / 69\" x 14'","codigoLista":"CV7H","nombre":"CV7H · Con bomba eléctrica · 69\" x 14' · 3 ton","tipo":"volteo","medidas":"69\" x 14'","capacidad":"3 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":144083.65,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":144083.65,"ajustePct":0,"precioAplicado":144083.65,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV7H-69in_x_14ft-6_ton-Con_bomba_eléctrica","codigo":"CV7H / Con bomba eléctrica / 6 ton / 69\" x 14'","codigoLista":"CV7H","nombre":"CV7H · Con bomba eléctrica · 69\" x 14' · 6 ton","tipo":"volteo","medidas":"69\" x 14'","capacidad":"6 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":160551.47,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":160551.47,"ajustePct":0,"precioAplicado":160551.47,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV8H-69in_x_16ft-3_ton-Con_bomba_eléctrica","codigo":"CV8H / Con bomba eléctrica / 3 ton / 69\" x 16'","codigoLista":"CV8H","nombre":"CV8H · Con bomba eléctrica · 69\" x 16' · 3 ton","tipo":"volteo","medidas":"69\" x 16'","capacidad":"3 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":144987.38,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":144987.38,"ajustePct":0,"precioAplicado":144987.38,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV8H-69in_x_16ft-6_ton-Con_bomba_eléctrica","codigo":"CV8H / Con bomba eléctrica / 6 ton / 69\" x 16'","codigoLista":"CV8H","nombre":"CV8H · Con bomba eléctrica · 69\" x 16' · 6 ton","tipo":"volteo","medidas":"69\" x 16'","capacidad":"6 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":161931.13,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":161931.13,"ajustePct":0,"precioAplicado":161931.13,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV10H-76in_x_12ft-1.5_ton-Con_bomba_eléctrica","codigo":"CV10H / Con bomba eléctrica / 1.5 ton / 76\" x 12'","codigoLista":"CV10H","nombre":"CV10H · Con bomba eléctrica · 76\" x 12' · 1.5 ton","tipo":"volteo","medidas":"76\" x 12'","capacidad":"1.5 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":128980.22,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":128980.22,"ajustePct":0,"precioAplicado":128980.22,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV10H-76in_x_12ft-3_ton-Con_bomba_eléctrica","codigo":"CV10H / Con bomba eléctrica / 3 ton / 76\" x 12'","codigoLista":"CV10H","nombre":"CV10H · Con bomba eléctrica · 76\" x 12' · 3 ton","tipo":"volteo","medidas":"76\" x 12'","capacidad":"3 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":142882.59,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":142882.59,"ajustePct":0,"precioAplicado":142882.59,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV10H-76in_x_12ft-6_ton-Con_bomba_eléctrica","codigo":"CV10H / Con bomba eléctrica / 6 ton / 76\" x 12'","codigoLista":"CV10H","nombre":"CV10H · Con bomba eléctrica · 76\" x 12' · 6 ton","tipo":"volteo","medidas":"76\" x 12'","capacidad":"6 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":160344.79,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":160344.79,"ajustePct":0,"precioAplicado":160344.79,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV11H-76in_x_14ft-3_ton-Con_bomba_eléctrica","codigo":"CV11H / Con bomba eléctrica / 3 ton / 76\" x 14'","codigoLista":"CV11H","nombre":"CV11H · Con bomba eléctrica · 76\" x 14' · 3 ton","tipo":"volteo","medidas":"76\" x 14'","capacidad":"3 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":148885.41,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":148885.41,"ajustePct":0,"precioAplicado":148885.41,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV11H-76in_x_14ft-6_ton-Con_bomba_eléctrica","codigo":"CV11H / Con bomba eléctrica / 6 ton / 76\" x 14'","codigoLista":"CV11H","nombre":"CV11H · Con bomba eléctrica · 76\" x 14' · 6 ton","tipo":"volteo","medidas":"76\" x 14'","capacidad":"6 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":166505.92,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":166505.92,"ajustePct":0,"precioAplicado":166505.92,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV12H-76in_x_16ft-3_ton-Con_bomba_eléctrica","codigo":"CV12H / Con bomba eléctrica / 3 ton / 76\" x 16'","codigoLista":"CV12H","nombre":"CV12H · Con bomba eléctrica · 76\" x 16' · 3 ton","tipo":"volteo","medidas":"76\" x 16'","capacidad":"3 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":155076.07,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":155076.07,"ajustePct":0,"precioAplicado":155076.07,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV12H-76in_x_16ft-6_ton-Con_bomba_eléctrica","codigo":"CV12H / Con bomba eléctrica / 6 ton / 76\" x 16'","codigoLista":"CV12H","nombre":"CV12H · Con bomba eléctrica · 76\" x 16' · 6 ton","tipo":"volteo","medidas":"76\" x 16'","capacidad":"6 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":173075.26,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":173075.26,"ajustePct":0,"precioAplicado":173075.26,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV13H-82in_x_12ft-3_ton-Con_bomba_eléctrica","codigo":"CV13H / Con bomba eléctrica / 3 ton / 82\" x 12'","codigoLista":"CV13H","nombre":"CV13H · Con bomba eléctrica · 82\" x 12' · 3 ton","tipo":"volteo","medidas":"82\" x 12'","capacidad":"3 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":145063.88,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":145063.88,"ajustePct":0,"precioAplicado":145063.88,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV13H-82in_x_12ft-6_ton-Con_bomba_eléctrica","codigo":"CV13H / Con bomba eléctrica / 6 ton / 82\" x 12'","codigoLista":"CV13H","nombre":"CV13H · Con bomba eléctrica · 82\" x 12' · 6 ton","tipo":"volteo","medidas":"82\" x 12'","capacidad":"6 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":162320.52,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":162320.52,"ajustePct":0,"precioAplicado":162320.52,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV14H-82in_x_14ft-3_ton-Con_bomba_eléctrica","codigo":"CV14H / Con bomba eléctrica / 3 ton / 82\" x 14'","codigoLista":"CV14H","nombre":"CV14H · Con bomba eléctrica · 82\" x 14' · 3 ton","tipo":"volteo","medidas":"82\" x 14'","capacidad":"3 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":151179.45,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":151179.45,"ajustePct":0,"precioAplicado":151179.45,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV14H-82in_x_14ft-6_ton-Con_bomba_eléctrica","codigo":"CV14H / Con bomba eléctrica / 6 ton / 82\" x 14'","codigoLista":"CV14H","nombre":"CV14H · Con bomba eléctrica · 82\" x 14' · 6 ton","tipo":"volteo","medidas":"82\" x 14'","capacidad":"6 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":170490.71,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":170490.71,"ajustePct":0,"precioAplicado":170490.71,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV15H-82in_x_16ft-3_ton-Con_bomba_eléctrica","codigo":"CV15H / Con bomba eléctrica / 3 ton / 82\" x 16'","codigoLista":"CV15H","nombre":"CV15H · Con bomba eléctrica · 82\" x 16' · 3 ton","tipo":"volteo","medidas":"82\" x 16'","capacidad":"3 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":158475.14,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":158475.14,"ajustePct":0,"precioAplicado":158475.14,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CV15H-82in_x_16ft-6_ton-Con_bomba_eléctrica","codigo":"CV15H / Con bomba eléctrica / 6 ton / 82\" x 16'","codigoLista":"CV15H","nombre":"CV15H · Con bomba eléctrica · 82\" x 16' · 6 ton","tipo":"volteo","medidas":"82\" x 16'","capacidad":"6 ton","especificaciones":"Piso de lámina; redila de 24\" de alto; volteo con bomba eléctrica.","moneda":"MXN","precio":174079.16,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-FRENOS"},{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":174079.16,"ajustePct":0,"precioAplicado":174079.16,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CBF1-79in_x_13ft-6_ton-Forrajero","codigo":"CBF1 / Forrajero / 6 ton / 79\" x 13'","codigoLista":"CBF1","nombre":"CBF1 · Forrajero · 79\" x 13' · 6 ton","tipo":"forrajero","medidas":"79\" x 13'","capacidad":"6 ton","especificaciones":"Piso de lámina; volteo con el tractor; 2 ejes de 8 birlos; doble gato.","moneda":"MXN","precio":181604.13,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":181604.13,"ajustePct":0,"precioAplicado":181604.13,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CA-82in_x_12ft-6_ton-Para_piedras","codigo":"CA / Para piedras / 6 ton / 82\" x 12'","codigoLista":"CA","nombre":"CA · Para piedras · 82\" x 12' · 6 ton","tipo":"piedras","medidas":"82\" x 12'","capacidad":"6 ton","especificaciones":"Redila 15\"; piso de lámina; volteo con el tractor; 2 ejes de 8 birlos; doble gato.","moneda":"MXN","precio":152441.99,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":152441.99,"ajustePct":0,"precioAplicado":152441.99,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-volteo-CA-82in_x_14ft-6_ton-Para_piedras","codigo":"CA / Para piedras / 6 ton / 82\" x 14'","codigoLista":"CA","nombre":"CA · Para piedras · 82\" x 14' · 6 ton","tipo":"piedras","medidas":"82\" x 14'","capacidad":"6 ton","especificaciones":"Redila 15\"; piso de lámina; volteo con el tractor; 2 ejes de 8 birlos; doble gato.","moneda":"MXN","precio":162630.31,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-VOLTEO-GATO12"},{"clase":"pieza","itemId":"MX-VOLTEO-LL750"},{"clase":"pieza","itemId":"MX-VOLTEO-LL700"},{"clase":"pieza","itemId":"MX-VOLTEO-CONTROL"},{"clase":"pieza","itemId":"MX-VOLTEO-REDILA"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON"},{"clase":"pieza","itemId":"MX-VOLTEO-PISTON30"},{"clase":"pieza","itemId":"MX-VOLTEO-BOMBA"},{"clase":"pieza","itemId":"MX-VOLTEO-TIJERA"}],"origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":162630.31,"ajustePct":0,"precioAplicado":162630.31,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-especiales-RD1-80in_x_4.8ft-850_kg-Dolly","codigo":"RD1 / Dolly / 850 kg / 80\" x 4.8'","codigoLista":"RD1","nombre":"RD1 · Dolly · 80\" x 4.8' · 850 kg","tipo":"dolly","medidas":"80\" x 4.8'","capacidad":"850 kg","especificaciones":"1 eje de 5 birlos; con winch; bandas con matraca.","moneda":"MXN","precio":40898.0,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[],"origen":{"archivo":"a32071f4-14f2-45d7-ae8c-016bd4238fe9.png","fechaLista":"2024-02-02","precioLista":40898.0,"ajustePct":0,"precioAplicado":40898.0,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-especiales-CBVM-48in_x_7ft-850_kg-Volteo_manual","codigo":"CBVM / Volteo manual / 850 kg / 48\" x 7'","codigoLista":"CBVM","nombre":"CBVM · Volteo manual · 48\" x 7' · 850 kg","tipo":"volteo_manual","medidas":"48\" x 7'","capacidad":"850 kg","especificaciones":"Cerrado; piso de lámina; volteo manual; 1 eje de 5 birlos.","moneda":"MXN","precio":38967.48,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[],"origen":{"archivo":"a32071f4-14f2-45d7-ae8c-016bd4238fe9.png","fechaLista":"2024-02-02","precioLista":38967.48,"ajustePct":0,"precioAplicado":38967.48,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-especiales-CB4-50in_x_90in-850_kg-Abierto,_piso_madera","codigo":"CB4 / Abierto, piso madera / 850 kg / 50\" x 90\"","codigoLista":"CB4","nombre":"CB4 · Abierto, piso madera · 50\" x 90\" · 850 kg","tipo":"cuatrimotos","medidas":"50\" x 90\"","capacidad":"850 kg","especificaciones":"Puerta tipo rampa; 1 eje de 5 birlos.","moneda":"MXN","precio":23677.13,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[],"origen":{"archivo":"a32071f4-14f2-45d7-ae8c-016bd4238fe9.png","fechaLista":"2024-02-02","precioLista":23677.13,"ajustePct":0,"precioAplicado":23677.13,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-especiales-CB4-50in_x_90in-850_kg-Cerrado,_piso_lámina","codigo":"CB4 / Cerrado, piso lámina / 850 kg / 50\" x 90\"","codigoLista":"CB4","nombre":"CB4 · Cerrado, piso lámina · 50\" x 90\" · 850 kg","tipo":"cuatrimotos","medidas":"50\" x 90\"","capacidad":"850 kg","especificaciones":"Puerta tipo rampa; 1 eje de 5 birlos.","moneda":"MXN","precio":26394.47,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[],"origen":{"archivo":"a32071f4-14f2-45d7-ae8c-016bd4238fe9.png","fechaLista":"2024-02-02","precioLista":26394.47,"ajustePct":0,"precioAplicado":26394.47,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-especiales-CBB7-82in_x_21ft-6_ton-Piso_madera","codigo":"CBB7 / Piso madera / 6 ton / 82\" x 21'","codigoLista":"CBB7","nombre":"CBB7 · Piso madera · 82\" x 21' · 6 ton","tipo":"vasculante","medidas":"82\" x 21'","capacidad":"6 ton","especificaciones":"Pedal para levante; 2 ejes de 8 birlos; 17' vasculantes y 4' fijos.","moneda":"MXN","precio":150535.72,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-ESPECIALES-FRENOS"}],"origen":{"archivo":"a32071f4-14f2-45d7-ae8c-016bd4238fe9.png","fechaLista":"2024-02-02","precioLista":150535.72,"ajustePct":0,"precioAplicado":150535.72,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-especiales-CBB7-82in_x_21ft-6_ton-Piso_lámina_antiderrapante","codigo":"CBB7 / Piso lámina antiderrapante / 6 ton / 82\" x 21'","codigoLista":"CBB7","nombre":"CBB7 · Piso lámina antiderrapante · 82\" x 21' · 6 ton","tipo":"vasculante","medidas":"82\" x 21'","capacidad":"6 ton","especificaciones":"Pedal para levante; 2 ejes de 8 birlos; 17' vasculantes y 4' fijos.","moneda":"MXN","precio":172212.29,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-ESPECIALES-FRENOS"}],"origen":{"archivo":"a32071f4-14f2-45d7-ae8c-016bd4238fe9.png","fechaLista":"2024-02-02","precioLista":172212.29,"ajustePct":0,"precioAplicado":172212.29,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-especiales-RPA1-76in_x_16ft-3_ton-Puesto_de_comida","codigo":"RPA1 / Puesto de comida / 3 ton / 76\" x 16'","codigoLista":"RPA1","nombre":"RPA1 · Puesto de comida · 76\" x 16' · 3 ton","tipo":"comida","medidas":"76\" x 16'","capacidad":"3 ton","especificaciones":"Piso de madera; cerrado 2 m de alto; cortina para cubrir ventana; 2 ejes de 5 birlos.","moneda":"MXN","precio":258886.52,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-ESPECIALES-FRENOS"}],"origen":{"archivo":"a32071f4-14f2-45d7-ae8c-016bd4238fe9.png","fechaLista":"2024-02-02","precioLista":258886.52,"ajustePct":0,"precioAplicado":258886.52,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-especiales-REMCAB-25ft-4_ton-Cabezal_de_trilladora","codigo":"REMCAB / Cabezal de trilladora / 4 ton / 25'","codigoLista":"REMCAB","nombre":"REMCAB · Cabezal de trilladora · 25' · 4 ton","tipo":"cabezal","medidas":"25'","capacidad":"4 ton","especificaciones":"Chasis para cabezal; jalón quinta rueda; bases para cabezal; 2 ejes de 6 birlos.","moneda":"MXN","precio":57463.21,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[],"origen":{"archivo":"a32071f4-14f2-45d7-ae8c-016bd4238fe9.png","fechaLista":"2024-02-02","precioLista":57463.21,"ajustePct":0,"precioAplicado":57463.21,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-especiales-RCA1-96in_x_20ft-6_ton-Con_ganso","codigo":"RCA1 / Con ganso / 6 ton / 96\" x 20'","codigoLista":"RCA1","nombre":"RCA1 · Con ganso · 96\" x 20' · 6 ton","tipo":"cama_alta","medidas":"96\" x 20'","capacidad":"6 ton","especificaciones":"Piso de madera; 2 ejes de 8 birlos; freno en 1 eje incluido; con rampa.","moneda":"MXN","precio":181970.74,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-ESPECIALES-FRENOS"}],"origen":{"archivo":"a32071f4-14f2-45d7-ae8c-016bd4238fe9.png","fechaLista":"2024-02-02","precioLista":181970.74,"ajustePct":0,"precioAplicado":181970.74,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-especiales-RCA1-96in_x_20ft-10_ton-Con_ganso","codigo":"RCA1 / Con ganso / 10 ton / 96\" x 20'","codigoLista":"RCA1","nombre":"RCA1 · Con ganso · 96\" x 20' · 10 ton","tipo":"cama_alta","medidas":"96\" x 20'","capacidad":"10 ton","especificaciones":"Piso de madera; 2 ejes de 8 birlos; freno en 1 eje incluido; con rampa.","moneda":"MXN","precio":298155.0,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-ESPECIALES-FRENOS"}],"origen":{"archivo":"a32071f4-14f2-45d7-ae8c-016bd4238fe9.png","fechaLista":"2024-02-02","precioLista":298155.0,"ajustePct":0,"precioAplicado":298155.0,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-especiales-RCA2-96in_x_22ft-6_ton-Con_ganso","codigo":"RCA2 / Con ganso / 6 ton / 96\" x 22'","codigoLista":"RCA2","nombre":"RCA2 · Con ganso · 96\" x 22' · 6 ton","tipo":"cama_alta","medidas":"96\" x 22'","capacidad":"6 ton","especificaciones":"Piso de madera; 2 ejes de 8 birlos; freno en 1 eje incluido; con rampa.","moneda":"MXN","precio":185633.04,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-ESPECIALES-FRENOS"}],"origen":{"archivo":"a32071f4-14f2-45d7-ae8c-016bd4238fe9.png","fechaLista":"2024-02-02","precioLista":185633.04,"ajustePct":0,"precioAplicado":185633.04,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-especiales-RCA2-96in_x_22ft-10_ton-Con_ganso","codigo":"RCA2 / Con ganso / 10 ton / 96\" x 22'","codigoLista":"RCA2","nombre":"RCA2 · Con ganso · 96\" x 22' · 10 ton","tipo":"cama_alta","medidas":"96\" x 22'","capacidad":"10 ton","especificaciones":"Piso de madera; 2 ejes de 8 birlos; freno en 1 eje incluido; con rampa.","moneda":"MXN","precio":303478.66,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-ESPECIALES-FRENOS"}],"origen":{"archivo":"a32071f4-14f2-45d7-ae8c-016bd4238fe9.png","fechaLista":"2024-02-02","precioLista":303478.66,"ajustePct":0,"precioAplicado":303478.66,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-especiales-RCA3-96in_x_24ft-6_ton-Con_ganso","codigo":"RCA3 / Con ganso / 6 ton / 96\" x 24'","codigoLista":"RCA3","nombre":"RCA3 · Con ganso · 96\" x 24' · 6 ton","tipo":"cama_alta","medidas":"96\" x 24'","capacidad":"6 ton","especificaciones":"Piso de madera; 2 ejes de 8 birlos; freno en 1 eje incluido; con rampa.","moneda":"MXN","precio":195023.17,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-ESPECIALES-FRENOS"}],"origen":{"archivo":"a32071f4-14f2-45d7-ae8c-016bd4238fe9.png","fechaLista":"2024-02-02","precioLista":195023.17,"ajustePct":0,"precioAplicado":195023.17,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-especiales-RCA3-96in_x_24ft-10_ton-Con_ganso","codigo":"RCA3 / Con ganso / 10 ton / 96\" x 24'","codigoLista":"RCA3","nombre":"RCA3 · Con ganso · 96\" x 24' · 10 ton","tipo":"cama_alta","medidas":"96\" x 24'","capacidad":"10 ton","especificaciones":"Piso de madera; 2 ejes de 8 birlos; freno en 1 eje incluido; con rampa.","moneda":"MXN","precio":313821.51,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-ESPECIALES-FRENOS"}],"origen":{"archivo":"a32071f4-14f2-45d7-ae8c-016bd4238fe9.png","fechaLista":"2024-02-02","precioLista":313821.51,"ajustePct":0,"precioAplicado":313821.51,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-especiales-RCA4-96in_x_28ft-6_ton-Con_ganso","codigo":"RCA4 / Con ganso / 6 ton / 96\" x 28'","codigoLista":"RCA4","nombre":"RCA4 · Con ganso · 96\" x 28' · 6 ton","tipo":"cama_alta","medidas":"96\" x 28'","capacidad":"6 ton","especificaciones":"Piso de madera; 2 ejes de 8 birlos; freno en 1 eje incluido; con rampa.","moneda":"MXN","precio":203414.85,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-ESPECIALES-FRENOS"}],"origen":{"archivo":"a32071f4-14f2-45d7-ae8c-016bd4238fe9.png","fechaLista":"2024-02-02","precioLista":203414.85,"ajustePct":0,"precioAplicado":203414.85,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-especiales-RCA4-96in_x_28ft-10_ton-Con_ganso","codigo":"RCA4 / Con ganso / 10 ton / 96\" x 28'","codigoLista":"RCA4","nombre":"RCA4 · Con ganso · 96\" x 28' · 10 ton","tipo":"cama_alta","medidas":"96\" x 28'","capacidad":"10 ton","especificaciones":"Piso de madera; 2 ejes de 8 birlos; freno en 1 eje incluido; con rampa.","moneda":"MXN","precio":322538.7,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-ESPECIALES-FRENOS"}],"origen":{"archivo":"a32071f4-14f2-45d7-ae8c-016bd4238fe9.png","fechaLista":"2024-02-02","precioLista":322538.7,"ajustePct":0,"precioAplicado":322538.7,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ganadero-RG2-60in_x_10ft-1.5_ton-Redila_fija","codigo":"RG2 / Redila fija / 1.5 ton / 60\" x 10'","codigoLista":"RG2","nombre":"RG2 · Redila fija · 60\" x 10' · 1.5 ton","tipo":"ganadero_redondo","medidas":"60\" x 10'","capacidad":"1.5 ton","especificaciones":"Piso de madera; jalón reforzado; rines de 5 birlos; puerta trasera corrediza.","moneda":"MXN","precio":59925.29,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-GANADERO-FRENOS"},{"clase":"pieza","itemId":"MX-GANADERO-PTALATERAL"},{"clase":"pieza","itemId":"MX-GANADERO-LL750"},{"clase":"pieza","itemId":"MX-GANADERO-LL700"},{"clase":"pieza","itemId":"MX-GANADERO-CONTROL"},{"clase":"pieza","itemId":"MX-GANADERO-TECHO"},{"clase":"pieza","itemId":"MX-GANADERO-JALON"},{"clase":"pieza","itemId":"MX-GANADERO-CACHUCHA"}],"origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":59925.29,"ajustePct":0,"precioAplicado":59925.29,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ganadero-RG2-60in_x_10ft-3_ton-Redila_fija","codigo":"RG2 / Redila fija / 3 ton / 60\" x 10'","codigoLista":"RG2","nombre":"RG2 · Redila fija · 60\" x 10' · 3 ton","tipo":"ganadero_redondo","medidas":"60\" x 10'","capacidad":"3 ton","especificaciones":"Piso de madera; jalón reforzado; rines de 5 birlos; puerta trasera corrediza.","moneda":"MXN","precio":73247.13,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-GANADERO-FRENOS"},{"clase":"pieza","itemId":"MX-GANADERO-PTALATERAL"},{"clase":"pieza","itemId":"MX-GANADERO-LL750"},{"clase":"pieza","itemId":"MX-GANADERO-LL700"},{"clase":"pieza","itemId":"MX-GANADERO-CONTROL"},{"clase":"pieza","itemId":"MX-GANADERO-TECHO"},{"clase":"pieza","itemId":"MX-GANADERO-JALON"},{"clase":"pieza","itemId":"MX-GANADERO-CACHUCHA"}],"origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":73247.13,"ajustePct":0,"precioAplicado":73247.13,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ganadero-RG2-60in_x_10ft-6_ton-Redila_fija","codigo":"RG2 / Redila fija / 6 ton / 60\" x 10'","codigoLista":"RG2","nombre":"RG2 · Redila fija · 60\" x 10' · 6 ton","tipo":"ganadero_redondo","medidas":"60\" x 10'","capacidad":"6 ton","especificaciones":"Piso de madera; jalón reforzado; rines de 5 birlos; puerta trasera corrediza.","moneda":"MXN","precio":97326.89,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-GANADERO-FRENOS"},{"clase":"pieza","itemId":"MX-GANADERO-PTALATERAL"},{"clase":"pieza","itemId":"MX-GANADERO-LL750"},{"clase":"pieza","itemId":"MX-GANADERO-LL700"},{"clase":"pieza","itemId":"MX-GANADERO-CONTROL"},{"clase":"pieza","itemId":"MX-GANADERO-TECHO"},{"clase":"pieza","itemId":"MX-GANADERO-JALON"},{"clase":"pieza","itemId":"MX-GANADERO-CACHUCHA"}],"origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":97326.89,"ajustePct":0,"precioAplicado":97326.89,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ganadero-RG4-60in_x_12ft-1.5_ton-Redila_fija","codigo":"RG4 / Redila fija / 1.5 ton / 60\" x 12'","codigoLista":"RG4","nombre":"RG4 · Redila fija · 60\" x 12' · 1.5 ton","tipo":"ganadero_redondo","medidas":"60\" x 12'","capacidad":"1.5 ton","especificaciones":"Piso de madera; jalón reforzado; rines de 5 birlos; puerta trasera corrediza.","moneda":"MXN","precio":68789.84,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-GANADERO-FRENOS"},{"clase":"pieza","itemId":"MX-GANADERO-PTALATERAL"},{"clase":"pieza","itemId":"MX-GANADERO-LL750"},{"clase":"pieza","itemId":"MX-GANADERO-LL700"},{"clase":"pieza","itemId":"MX-GANADERO-CONTROL"},{"clase":"pieza","itemId":"MX-GANADERO-TECHO"},{"clase":"pieza","itemId":"MX-GANADERO-JALON"},{"clase":"pieza","itemId":"MX-GANADERO-CACHUCHA"}],"origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":68789.84,"ajustePct":0,"precioAplicado":68789.84,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ganadero-RG4-60in_x_12ft-3_ton-Redila_fija","codigo":"RG4 / Redila fija / 3 ton / 60\" x 12'","codigoLista":"RG4","nombre":"RG4 · Redila fija · 60\" x 12' · 3 ton","tipo":"ganadero_redondo","medidas":"60\" x 12'","capacidad":"3 ton","especificaciones":"Piso de madera; jalón reforzado; rines de 5 birlos; puerta trasera corrediza.","moneda":"MXN","precio":83279.21,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-GANADERO-FRENOS"},{"clase":"pieza","itemId":"MX-GANADERO-PTALATERAL"},{"clase":"pieza","itemId":"MX-GANADERO-LL750"},{"clase":"pieza","itemId":"MX-GANADERO-LL700"},{"clase":"pieza","itemId":"MX-GANADERO-CONTROL"},{"clase":"pieza","itemId":"MX-GANADERO-TECHO"},{"clase":"pieza","itemId":"MX-GANADERO-JALON"},{"clase":"pieza","itemId":"MX-GANADERO-CACHUCHA"}],"origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":83279.21,"ajustePct":0,"precioAplicado":83279.21,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ganadero-RG4-60in_x_12ft-6_ton-Redila_fija","codigo":"RG4 / Redila fija / 6 ton / 60\" x 12'","codigoLista":"RG4","nombre":"RG4 · Redila fija · 60\" x 12' · 6 ton","tipo":"ganadero_redondo","medidas":"60\" x 12'","capacidad":"6 ton","especificaciones":"Piso de madera; jalón reforzado; rines de 5 birlos; puerta trasera corrediza.","moneda":"MXN","precio":103966.76,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-GANADERO-FRENOS"},{"clase":"pieza","itemId":"MX-GANADERO-PTALATERAL"},{"clase":"pieza","itemId":"MX-GANADERO-LL750"},{"clase":"pieza","itemId":"MX-GANADERO-LL700"},{"clase":"pieza","itemId":"MX-GANADERO-CONTROL"},{"clase":"pieza","itemId":"MX-GANADERO-TECHO"},{"clase":"pieza","itemId":"MX-GANADERO-JALON"},{"clase":"pieza","itemId":"MX-GANADERO-CACHUCHA"}],"origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":103966.76,"ajustePct":0,"precioAplicado":103966.76,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ganadero-RG5-60in_x_14ft-3_ton-Redila_fija","codigo":"RG5 / Redila fija / 3 ton / 60\" x 14'","codigoLista":"RG5","nombre":"RG5 · Redila fija · 60\" x 14' · 3 ton","tipo":"ganadero_redondo","medidas":"60\" x 14'","capacidad":"3 ton","especificaciones":"Piso de madera; jalón reforzado; rines de 5 birlos; puerta trasera corrediza.","moneda":"MXN","precio":89393.13,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-GANADERO-FRENOS"},{"clase":"pieza","itemId":"MX-GANADERO-PTALATERAL"},{"clase":"pieza","itemId":"MX-GANADERO-LL750"},{"clase":"pieza","itemId":"MX-GANADERO-LL700"},{"clase":"pieza","itemId":"MX-GANADERO-CONTROL"},{"clase":"pieza","itemId":"MX-GANADERO-TECHO"},{"clase":"pieza","itemId":"MX-GANADERO-JALON"},{"clase":"pieza","itemId":"MX-GANADERO-CACHUCHA"}],"origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":89393.13,"ajustePct":0,"precioAplicado":89393.13,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ganadero-RG5-60in_x_14ft-6_ton-Redila_fija","codigo":"RG5 / Redila fija / 6 ton / 60\" x 14'","codigoLista":"RG5","nombre":"RG5 · Redila fija · 60\" x 14' · 6 ton","tipo":"ganadero_redondo","medidas":"60\" x 14'","capacidad":"6 ton","especificaciones":"Piso de madera; jalón reforzado; rines de 5 birlos; puerta trasera corrediza.","moneda":"MXN","precio":111606.24,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-GANADERO-FRENOS"},{"clase":"pieza","itemId":"MX-GANADERO-PTALATERAL"},{"clase":"pieza","itemId":"MX-GANADERO-LL750"},{"clase":"pieza","itemId":"MX-GANADERO-LL700"},{"clase":"pieza","itemId":"MX-GANADERO-CONTROL"},{"clase":"pieza","itemId":"MX-GANADERO-TECHO"},{"clase":"pieza","itemId":"MX-GANADERO-JALON"},{"clase":"pieza","itemId":"MX-GANADERO-CACHUCHA"}],"origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":111606.24,"ajustePct":0,"precioAplicado":111606.24,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ganadero-RG6-60in_x_16ft-3_ton-Redila_fija","codigo":"RG6 / Redila fija / 3 ton / 60\" x 16'","codigoLista":"RG6","nombre":"RG6 · Redila fija · 60\" x 16' · 3 ton","tipo":"ganadero_redondo","medidas":"60\" x 16'","capacidad":"3 ton","especificaciones":"Piso de madera; jalón reforzado; rines de 5 birlos; puerta trasera corrediza.","moneda":"MXN","precio":95417.85,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-GANADERO-FRENOS"},{"clase":"pieza","itemId":"MX-GANADERO-PTALATERAL"},{"clase":"pieza","itemId":"MX-GANADERO-LL750"},{"clase":"pieza","itemId":"MX-GANADERO-LL700"},{"clase":"pieza","itemId":"MX-GANADERO-CONTROL"},{"clase":"pieza","itemId":"MX-GANADERO-TECHO"},{"clase":"pieza","itemId":"MX-GANADERO-JALON"},{"clase":"pieza","itemId":"MX-GANADERO-CACHUCHA"}],"origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":95417.85,"ajustePct":0,"precioAplicado":95417.85,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ganadero-RG6-60in_x_16ft-6_ton-Redila_fija","codigo":"RG6 / Redila fija / 6 ton / 60\" x 16'","codigoLista":"RG6","nombre":"RG6 · Redila fija · 60\" x 16' · 6 ton","tipo":"ganadero_redondo","medidas":"60\" x 16'","capacidad":"6 ton","especificaciones":"Piso de madera; jalón reforzado; rines de 5 birlos; puerta trasera corrediza.","moneda":"MXN","precio":118399.93,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-GANADERO-FRENOS"},{"clase":"pieza","itemId":"MX-GANADERO-PTALATERAL"},{"clase":"pieza","itemId":"MX-GANADERO-LL750"},{"clase":"pieza","itemId":"MX-GANADERO-LL700"},{"clase":"pieza","itemId":"MX-GANADERO-CONTROL"},{"clase":"pieza","itemId":"MX-GANADERO-TECHO"},{"clase":"pieza","itemId":"MX-GANADERO-JALON"},{"clase":"pieza","itemId":"MX-GANADERO-CACHUCHA"}],"origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":118399.93,"ajustePct":0,"precioAplicado":118399.93,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ganadero-RG2-60in_x_10ft-1.5_ton-Redila_desmontable","codigo":"RG2 / Redila desmontable / 1.5 ton / 60\" x 10'","codigoLista":"RG2","nombre":"RG2 · Redila desmontable · 60\" x 10' · 1.5 ton","tipo":"ganadero_redondo","medidas":"60\" x 10'","capacidad":"1.5 ton","especificaciones":"Piso de madera; jalón reforzado; rines de 5 birlos; puerta trasera corrediza.","moneda":"MXN","precio":63642.61,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-GANADERO-FRENOS"},{"clase":"pieza","itemId":"MX-GANADERO-PTALATERAL"},{"clase":"pieza","itemId":"MX-GANADERO-LL750"},{"clase":"pieza","itemId":"MX-GANADERO-LL700"},{"clase":"pieza","itemId":"MX-GANADERO-CONTROL"},{"clase":"pieza","itemId":"MX-GANADERO-TECHO"},{"clase":"pieza","itemId":"MX-GANADERO-JALON"},{"clase":"pieza","itemId":"MX-GANADERO-CACHUCHA"}],"origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":63642.61,"ajustePct":0,"precioAplicado":63642.61,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ganadero-RG2-60in_x_10ft-3_ton-Redila_desmontable","codigo":"RG2 / Redila desmontable / 3 ton / 60\" x 10'","codigoLista":"RG2","nombre":"RG2 · Redila desmontable · 60\" x 10' · 3 ton","tipo":"ganadero_redondo","medidas":"60\" x 10'","capacidad":"3 ton","especificaciones":"Piso de madera; jalón reforzado; rines de 5 birlos; puerta trasera corrediza.","moneda":"MXN","precio":76962.5,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-GANADERO-FRENOS"},{"clase":"pieza","itemId":"MX-GANADERO-PTALATERAL"},{"clase":"pieza","itemId":"MX-GANADERO-LL750"},{"clase":"pieza","itemId":"MX-GANADERO-LL700"},{"clase":"pieza","itemId":"MX-GANADERO-CONTROL"},{"clase":"pieza","itemId":"MX-GANADERO-TECHO"},{"clase":"pieza","itemId":"MX-GANADERO-JALON"},{"clase":"pieza","itemId":"MX-GANADERO-CACHUCHA"}],"origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":76962.5,"ajustePct":0,"precioAplicado":76962.5,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ganadero-RG2-60in_x_10ft-6_ton-Redila_desmontable","codigo":"RG2 / Redila desmontable / 6 ton / 60\" x 10'","codigoLista":"RG2","nombre":"RG2 · Redila desmontable · 60\" x 10' · 6 ton","tipo":"ganadero_redondo","medidas":"60\" x 10'","capacidad":"6 ton","especificaciones":"Piso de madera; jalón reforzado; rines de 5 birlos; puerta trasera corrediza.","moneda":"MXN","precio":100272.14,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-GANADERO-FRENOS"},{"clase":"pieza","itemId":"MX-GANADERO-PTALATERAL"},{"clase":"pieza","itemId":"MX-GANADERO-LL750"},{"clase":"pieza","itemId":"MX-GANADERO-LL700"},{"clase":"pieza","itemId":"MX-GANADERO-CONTROL"},{"clase":"pieza","itemId":"MX-GANADERO-TECHO"},{"clase":"pieza","itemId":"MX-GANADERO-JALON"},{"clase":"pieza","itemId":"MX-GANADERO-CACHUCHA"}],"origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":100272.14,"ajustePct":0,"precioAplicado":100272.14,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ganadero-RG4-60in_x_12ft-1.5_ton-Redila_desmontable","codigo":"RG4 / Redila desmontable / 1.5 ton / 60\" x 12'","codigoLista":"RG4","nombre":"RG4 · Redila desmontable · 60\" x 12' · 1.5 ton","tipo":"ganadero_redondo","medidas":"60\" x 12'","capacidad":"1.5 ton","especificaciones":"Piso de madera; jalón reforzado; rines de 5 birlos; puerta trasera corrediza.","moneda":"MXN","precio":72507.16,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-GANADERO-FRENOS"},{"clase":"pieza","itemId":"MX-GANADERO-PTALATERAL"},{"clase":"pieza","itemId":"MX-GANADERO-LL750"},{"clase":"pieza","itemId":"MX-GANADERO-LL700"},{"clase":"pieza","itemId":"MX-GANADERO-CONTROL"},{"clase":"pieza","itemId":"MX-GANADERO-TECHO"},{"clase":"pieza","itemId":"MX-GANADERO-JALON"},{"clase":"pieza","itemId":"MX-GANADERO-CACHUCHA"}],"origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":72507.16,"ajustePct":0,"precioAplicado":72507.16,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ganadero-RG4-60in_x_12ft-3_ton-Redila_desmontable","codigo":"RG4 / Redila desmontable / 3 ton / 60\" x 12'","codigoLista":"RG4","nombre":"RG4 · Redila desmontable · 60\" x 12' · 3 ton","tipo":"ganadero_redondo","medidas":"60\" x 12'","capacidad":"3 ton","especificaciones":"Piso de madera; jalón reforzado; rines de 5 birlos; puerta trasera corrediza.","moneda":"MXN","precio":85527.31,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-GANADERO-FRENOS"},{"clase":"pieza","itemId":"MX-GANADERO-PTALATERAL"},{"clase":"pieza","itemId":"MX-GANADERO-LL750"},{"clase":"pieza","itemId":"MX-GANADERO-LL700"},{"clase":"pieza","itemId":"MX-GANADERO-CONTROL"},{"clase":"pieza","itemId":"MX-GANADERO-TECHO"},{"clase":"pieza","itemId":"MX-GANADERO-JALON"},{"clase":"pieza","itemId":"MX-GANADERO-CACHUCHA"}],"origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":85527.31,"ajustePct":0,"precioAplicado":85527.31,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ganadero-RG4-60in_x_12ft-6_ton-Redila_desmontable","codigo":"RG4 / Redila desmontable / 6 ton / 60\" x 12'","codigoLista":"RG4","nombre":"RG4 · Redila desmontable · 60\" x 12' · 6 ton","tipo":"ganadero_redondo","medidas":"60\" x 12'","capacidad":"6 ton","especificaciones":"Piso de madera; jalón reforzado; rines de 5 birlos; puerta trasera corrediza.","moneda":"MXN","precio":108367.94,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-GANADERO-FRENOS"},{"clase":"pieza","itemId":"MX-GANADERO-PTALATERAL"},{"clase":"pieza","itemId":"MX-GANADERO-LL750"},{"clase":"pieza","itemId":"MX-GANADERO-LL700"},{"clase":"pieza","itemId":"MX-GANADERO-CONTROL"},{"clase":"pieza","itemId":"MX-GANADERO-TECHO"},{"clase":"pieza","itemId":"MX-GANADERO-JALON"},{"clase":"pieza","itemId":"MX-GANADERO-CACHUCHA"}],"origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":108367.94,"ajustePct":0,"precioAplicado":108367.94,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ganadero-RG5-60in_x_14ft-3_ton-Redila_desmontable","codigo":"RG5 / Redila desmontable / 3 ton / 60\" x 14'","codigoLista":"RG5","nombre":"RG5 · Redila desmontable · 60\" x 14' · 3 ton","tipo":"ganadero_redondo","medidas":"60\" x 14'","capacidad":"3 ton","especificaciones":"Piso de madera; jalón reforzado; rines de 5 birlos; puerta trasera corrediza.","moneda":"MXN","precio":91461.67,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-GANADERO-FRENOS"},{"clase":"pieza","itemId":"MX-GANADERO-PTALATERAL"},{"clase":"pieza","itemId":"MX-GANADERO-LL750"},{"clase":"pieza","itemId":"MX-GANADERO-LL700"},{"clase":"pieza","itemId":"MX-GANADERO-CONTROL"},{"clase":"pieza","itemId":"MX-GANADERO-TECHO"},{"clase":"pieza","itemId":"MX-GANADERO-JALON"},{"clase":"pieza","itemId":"MX-GANADERO-CACHUCHA"}],"origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":91461.67,"ajustePct":0,"precioAplicado":91461.67,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ganadero-RG5-60in_x_14ft-6_ton-Redila_desmontable","codigo":"RG5 / Redila desmontable / 6 ton / 60\" x 14'","codigoLista":"RG5","nombre":"RG5 · Redila desmontable · 60\" x 14' · 6 ton","tipo":"ganadero_redondo","medidas":"60\" x 14'","capacidad":"6 ton","especificaciones":"Piso de madera; jalón reforzado; rines de 5 birlos; puerta trasera corrediza.","moneda":"MXN","precio":114016.48,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-GANADERO-FRENOS"},{"clase":"pieza","itemId":"MX-GANADERO-PTALATERAL"},{"clase":"pieza","itemId":"MX-GANADERO-LL750"},{"clase":"pieza","itemId":"MX-GANADERO-LL700"},{"clase":"pieza","itemId":"MX-GANADERO-CONTROL"},{"clase":"pieza","itemId":"MX-GANADERO-TECHO"},{"clase":"pieza","itemId":"MX-GANADERO-JALON"},{"clase":"pieza","itemId":"MX-GANADERO-CACHUCHA"}],"origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":114016.48,"ajustePct":0,"precioAplicado":114016.48,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ganadero-RG6-60in_x_16ft-3_ton-Redila_desmontable","codigo":"RG6 / Redila desmontable / 3 ton / 60\" x 16'","codigoLista":"RG6","nombre":"RG6 · Redila desmontable · 60\" x 16' · 3 ton","tipo":"ganadero_redondo","medidas":"60\" x 16'","capacidad":"3 ton","especificaciones":"Piso de madera; jalón reforzado; rines de 5 birlos; puerta trasera corrediza.","moneda":"MXN","precio":98269.38,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-GANADERO-FRENOS"},{"clase":"pieza","itemId":"MX-GANADERO-PTALATERAL"},{"clase":"pieza","itemId":"MX-GANADERO-LL750"},{"clase":"pieza","itemId":"MX-GANADERO-LL700"},{"clase":"pieza","itemId":"MX-GANADERO-CONTROL"},{"clase":"pieza","itemId":"MX-GANADERO-TECHO"},{"clase":"pieza","itemId":"MX-GANADERO-JALON"},{"clase":"pieza","itemId":"MX-GANADERO-CACHUCHA"}],"origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":98269.38,"ajustePct":0,"precioAplicado":98269.38,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ganadero-RG6-60in_x_16ft-6_ton-Redila_desmontable","codigo":"RG6 / Redila desmontable / 6 ton / 60\" x 16'","codigoLista":"RG6","nombre":"RG6 · Redila desmontable · 60\" x 16' · 6 ton","tipo":"ganadero_redondo","medidas":"60\" x 16'","capacidad":"6 ton","especificaciones":"Piso de madera; jalón reforzado; rines de 5 birlos; puerta trasera corrediza.","moneda":"MXN","precio":120810.18,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-GANADERO-FRENOS"},{"clase":"pieza","itemId":"MX-GANADERO-PTALATERAL"},{"clase":"pieza","itemId":"MX-GANADERO-LL750"},{"clase":"pieza","itemId":"MX-GANADERO-LL700"},{"clase":"pieza","itemId":"MX-GANADERO-CONTROL"},{"clase":"pieza","itemId":"MX-GANADERO-TECHO"},{"clase":"pieza","itemId":"MX-GANADERO-JALON"},{"clase":"pieza","itemId":"MX-GANADERO-CACHUCHA"}],"origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":120810.18,"ajustePct":0,"precioAplicado":120810.18,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ganadero-CAB-69in_x_10ft-3_ton-Monturero_techado","codigo":"CAB / Monturero techado / 3 ton / 69\" x 10'","codigoLista":"CAB","nombre":"CAB · Monturero techado · 69\" x 10' · 3 ton","tipo":"caballos","medidas":"69\" x 10'","capacidad":"3 ton","especificaciones":"Piso de madera; monturero techado.","moneda":"MXN","precio":163051.83,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-GANADERO-FRENOS"},{"clase":"pieza","itemId":"MX-GANADERO-PTALATERAL"},{"clase":"pieza","itemId":"MX-GANADERO-LL750"},{"clase":"pieza","itemId":"MX-GANADERO-LL700"},{"clase":"pieza","itemId":"MX-GANADERO-CONTROL"},{"clase":"pieza","itemId":"MX-GANADERO-TECHO"},{"clase":"pieza","itemId":"MX-GANADERO-JALON"},{"clase":"pieza","itemId":"MX-GANADERO-CACHUCHA"}],"origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":163051.83,"ajustePct":0,"precioAplicado":163051.83,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ganadero-CAB1-82in_x_16ft-6_ton-Techado,_3_ventanas","codigo":"CAB1 / Techado, 3 ventanas / 6 ton / 82\" x 16'","codigoLista":"CAB1","nombre":"CAB1 · Techado, 3 ventanas · 82\" x 16' · 6 ton","tipo":"caballos","medidas":"82\" x 16'","capacidad":"6 ton","especificaciones":"Piso de madera; techado; monturero; 3 ventanas.","moneda":"MXN","precio":223650.91,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-GANADERO-FRENOS"},{"clase":"pieza","itemId":"MX-GANADERO-PTALATERAL"},{"clase":"pieza","itemId":"MX-GANADERO-LL750"},{"clase":"pieza","itemId":"MX-GANADERO-LL700"},{"clase":"pieza","itemId":"MX-GANADERO-CONTROL"},{"clase":"pieza","itemId":"MX-GANADERO-TECHO"},{"clase":"pieza","itemId":"MX-GANADERO-JALON"},{"clase":"pieza","itemId":"MX-GANADERO-CACHUCHA"}],"origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":223650.91,"ajustePct":0,"precioAplicado":223650.91,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ganadero-RGE5-76in_x_16ft-6_ton-Ganso_tipo_H","codigo":"RGE5 / Ganso tipo H / 6 ton / 76\" x 16'","codigoLista":"RGE5","nombre":"RGE5 · Ganso tipo H · 76\" x 16' · 6 ton","tipo":"ganadero_ganso","medidas":"76\" x 16'","capacidad":"6 ton","especificaciones":"Piso de madera; jalón cuello de ganso tipo H; 8 birlos; freno en 1 eje incluido.","moneda":"MXN","precio":177514.73,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-GANADERO-FRENOS"},{"clase":"pieza","itemId":"MX-GANADERO-PTALATERAL"},{"clase":"pieza","itemId":"MX-GANADERO-LL750"},{"clase":"pieza","itemId":"MX-GANADERO-LL700"},{"clase":"pieza","itemId":"MX-GANADERO-CONTROL"},{"clase":"pieza","itemId":"MX-GANADERO-TECHO"},{"clase":"pieza","itemId":"MX-GANADERO-CACHUCHA"}],"origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":177514.73,"ajustePct":0,"precioAplicado":177514.73,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ganadero-RGE1-76in_x_20ft-6_ton-Ganso_tipo_H","codigo":"RGE1 / Ganso tipo H / 6 ton / 76\" x 20'","codigoLista":"RGE1","nombre":"RGE1 · Ganso tipo H · 76\" x 20' · 6 ton","tipo":"ganadero_ganso","medidas":"76\" x 20'","capacidad":"6 ton","especificaciones":"Piso de madera; jalón cuello de ganso tipo H; 8 birlos; freno en 1 eje incluido.","moneda":"MXN","precio":200409.82,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-GANADERO-FRENOS"},{"clase":"pieza","itemId":"MX-GANADERO-PTALATERAL"},{"clase":"pieza","itemId":"MX-GANADERO-LL750"},{"clase":"pieza","itemId":"MX-GANADERO-LL700"},{"clase":"pieza","itemId":"MX-GANADERO-CONTROL"},{"clase":"pieza","itemId":"MX-GANADERO-TECHO"},{"clase":"pieza","itemId":"MX-GANADERO-CACHUCHA"}],"origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":200409.82,"ajustePct":0,"precioAplicado":200409.82,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ganadero-RGE4-76in_x_22ft-6_ton-Ganso_tipo_H","codigo":"RGE4 / Ganso tipo H / 6 ton / 76\" x 22'","codigoLista":"RGE4","nombre":"RGE4 · Ganso tipo H · 76\" x 22' · 6 ton","tipo":"ganadero_ganso","medidas":"76\" x 22'","capacidad":"6 ton","especificaciones":"Piso de madera; jalón cuello de ganso tipo H; 8 birlos; freno en 1 eje incluido.","moneda":"MXN","precio":210215.3,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-GANADERO-FRENOS"},{"clase":"pieza","itemId":"MX-GANADERO-PTALATERAL"},{"clase":"pieza","itemId":"MX-GANADERO-LL750"},{"clase":"pieza","itemId":"MX-GANADERO-LL700"},{"clase":"pieza","itemId":"MX-GANADERO-CONTROL"},{"clase":"pieza","itemId":"MX-GANADERO-TECHO"},{"clase":"pieza","itemId":"MX-GANADERO-CACHUCHA"}],"origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":210215.3,"ajustePct":0,"precioAplicado":210215.3,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ganadero-RGE2-76in_x_24ft-6_ton-Ganso_tipo_H","codigo":"RGE2 / Ganso tipo H / 6 ton / 76\" x 24'","codigoLista":"RGE2","nombre":"RGE2 · Ganso tipo H · 76\" x 24' · 6 ton","tipo":"ganadero_ganso","medidas":"76\" x 24'","capacidad":"6 ton","especificaciones":"Piso de madera; jalón cuello de ganso tipo H; 8 birlos; freno en 1 eje incluido.","moneda":"MXN","precio":222605.97,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-GANADERO-FRENOS"},{"clase":"pieza","itemId":"MX-GANADERO-PTALATERAL"},{"clase":"pieza","itemId":"MX-GANADERO-LL750"},{"clase":"pieza","itemId":"MX-GANADERO-LL700"},{"clase":"pieza","itemId":"MX-GANADERO-CONTROL"},{"clase":"pieza","itemId":"MX-GANADERO-TECHO"},{"clase":"pieza","itemId":"MX-GANADERO-CACHUCHA"}],"origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":222605.97,"ajustePct":0,"precioAplicado":222605.97,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ganadero-RGE3-76in_x_32ft-9_ton-Ganso_tipo_H","codigo":"RGE3 / Ganso tipo H / 9 ton / 76\" x 32'","codigoLista":"RGE3","nombre":"RGE3 · Ganso tipo H · 76\" x 32' · 9 ton","tipo":"ganadero_ganso","medidas":"76\" x 32'","capacidad":"9 ton","especificaciones":"Piso de madera; jalón cuello de ganso tipo H; 3 ejes, 2 con freno.","moneda":"MXN","precio":303482.15,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-GANADERO-FRENOS"},{"clase":"pieza","itemId":"MX-GANADERO-PTALATERAL"},{"clase":"pieza","itemId":"MX-GANADERO-LL750"},{"clase":"pieza","itemId":"MX-GANADERO-LL700"},{"clase":"pieza","itemId":"MX-GANADERO-CONTROL"},{"clase":"pieza","itemId":"MX-GANADERO-TECHO"},{"clase":"pieza","itemId":"MX-GANADERO-CACHUCHA"}],"origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":303482.15,"ajustePct":0,"precioAplicado":303482.15,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB1-60in_x_10ft-1.5_ton-Abierto_/_madera","codigo":"CB1 / Abierto / madera / 1.5 ton / 60\" x 10'","codigoLista":"CB1","nombre":"CB1 · Abierto / madera · 60\" x 10' · 1.5 ton","tipo":"cama_baja","medidas":"60\" x 10'","capacidad":"1.5 ton","especificaciones":"Cama baja abierto / madera.","moneda":"MXN","precio":34409.24,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":34409.24,"ajustePct":0,"precioAplicado":34409.24,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB1-60in_x_10ft-3_ton-Abierto_/_madera","codigo":"CB1 / Abierto / madera / 3 ton / 60\" x 10'","codigoLista":"CB1","nombre":"CB1 · Abierto / madera · 60\" x 10' · 3 ton","tipo":"cama_baja","medidas":"60\" x 10'","capacidad":"3 ton","especificaciones":"Cama baja abierto / madera.","moneda":"MXN","precio":49874.45,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":49874.45,"ajustePct":0,"precioAplicado":49874.45,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB1-60in_x_10ft-6_ton-Abierto_/_madera","codigo":"CB1 / Abierto / madera / 6 ton / 60\" x 10'","codigoLista":"CB1","nombre":"CB1 · Abierto / madera · 60\" x 10' · 6 ton","tipo":"cama_baja","medidas":"60\" x 10'","capacidad":"6 ton","especificaciones":"Cama baja abierto / madera.","moneda":"MXN","precio":75130.51,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":75130.51,"ajustePct":0,"precioAplicado":75130.51,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB2-60in_x_10ft-1.5_ton-Abierto_/_madera","codigo":"CB2 / Abierto / madera / 1.5 ton / 60\" x 10'","codigoLista":"CB2","nombre":"CB2 · Abierto / madera · 60\" x 10' · 1.5 ton","tipo":"cama_baja","medidas":"60\" x 10'","capacidad":"1.5 ton","especificaciones":"Cama baja abierto / madera. Redila de 3'.","moneda":"MXN","precio":43626.96,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":43626.96,"ajustePct":0,"precioAplicado":43626.96,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB9-60in_x_12ft-1.5_ton-Abierto_/_madera","codigo":"CB9 / Abierto / madera / 1.5 ton / 60\" x 12'","codigoLista":"CB9","nombre":"CB9 · Abierto / madera · 60\" x 12' · 1.5 ton","tipo":"cama_baja","medidas":"60\" x 12'","capacidad":"1.5 ton","especificaciones":"Cama baja abierto / madera.","moneda":"MXN","precio":36412.63,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":36412.63,"ajustePct":0,"precioAplicado":36412.63,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB9-60in_x_12ft-3_ton-Abierto_/_madera","codigo":"CB9 / Abierto / madera / 3 ton / 60\" x 12'","codigoLista":"CB9","nombre":"CB9 · Abierto / madera · 60\" x 12' · 3 ton","tipo":"cama_baja","medidas":"60\" x 12'","capacidad":"3 ton","especificaciones":"Cama baja abierto / madera.","moneda":"MXN","precio":52559.42,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":52559.42,"ajustePct":0,"precioAplicado":52559.42,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB9-60in_x_12ft-6_ton-Abierto_/_madera","codigo":"CB9 / Abierto / madera / 6 ton / 60\" x 12'","codigoLista":"CB9","nombre":"CB9 · Abierto / madera · 60\" x 12' · 6 ton","tipo":"cama_baja","medidas":"60\" x 12'","capacidad":"6 ton","especificaciones":"Cama baja abierto / madera.","moneda":"MXN","precio":77367.03,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":77367.03,"ajustePct":0,"precioAplicado":77367.03,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB14-60in_x_12ft-1.5_ton-Abierto_/_madera","codigo":"CB14 / Abierto / madera / 1.5 ton / 60\" x 12'","codigoLista":"CB14","nombre":"CB14 · Abierto / madera · 60\" x 12' · 1.5 ton","tipo":"cama_baja","medidas":"60\" x 12'","capacidad":"1.5 ton","especificaciones":"Cama baja abierto / madera. Redila de 3'.","moneda":"MXN","precio":52034.96,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":52034.96,"ajustePct":0,"precioAplicado":52034.96,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB14-60in_x_12ft-3_ton-Abierto_/_madera","codigo":"CB14 / Abierto / madera / 3 ton / 60\" x 12'","codigoLista":"CB14","nombre":"CB14 · Abierto / madera · 60\" x 12' · 3 ton","tipo":"cama_baja","medidas":"60\" x 12'","capacidad":"3 ton","especificaciones":"Cama baja abierto / madera. Redila de 3'.","moneda":"MXN","precio":65290.99,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":65290.99,"ajustePct":0,"precioAplicado":65290.99,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB10-60in_x_16ft-3_ton-Abierto_/_madera","codigo":"CB10 / Abierto / madera / 3 ton / 60\" x 16'","codigoLista":"CB10","nombre":"CB10 · Abierto / madera · 60\" x 16' · 3 ton","tipo":"cama_baja","medidas":"60\" x 16'","capacidad":"3 ton","especificaciones":"Cama baja abierto / madera.","moneda":"MXN","precio":57059.63,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":57059.63,"ajustePct":0,"precioAplicado":57059.63,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB10-60in_x_16ft-6_ton-Abierto_/_madera","codigo":"CB10 / Abierto / madera / 6 ton / 60\" x 16'","codigoLista":"CB10","nombre":"CB10 · Abierto / madera · 60\" x 16' · 6 ton","tipo":"cama_baja","medidas":"60\" x 16'","capacidad":"6 ton","especificaciones":"Cama baja abierto / madera.","moneda":"MXN","precio":88366.27,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":88366.27,"ajustePct":0,"precioAplicado":88366.27,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB3-72in_x_12ft-1.5_ton-Abierto_/_madera","codigo":"CB3 / Abierto / madera / 1.5 ton / 72\" x 12'","codigoLista":"CB3","nombre":"CB3 · Abierto / madera · 72\" x 12' · 1.5 ton","tipo":"cama_baja","medidas":"72\" x 12'","capacidad":"1.5 ton","especificaciones":"Cama baja abierto / madera. Con rampa para moto.","moneda":"MXN","precio":52456.01,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":52456.01,"ajustePct":0,"precioAplicado":52456.01,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB4-76in_x_12ft-1.5_ton-Abierto_/_madera","codigo":"CB4 / Abierto / madera / 1.5 ton / 76\" x 12'","codigoLista":"CB4","nombre":"CB4 · Abierto / madera · 76\" x 12' · 1.5 ton","tipo":"cama_baja","medidas":"76\" x 12'","capacidad":"1.5 ton","especificaciones":"Cama baja abierto / madera.","moneda":"MXN","precio":39025.33,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":39025.33,"ajustePct":0,"precioAplicado":39025.33,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB4-76in_x_12ft-3_ton-Abierto_/_madera","codigo":"CB4 / Abierto / madera / 3 ton / 76\" x 12'","codigoLista":"CB4","nombre":"CB4 · Abierto / madera · 76\" x 12' · 3 ton","tipo":"cama_baja","medidas":"76\" x 12'","capacidad":"3 ton","especificaciones":"Cama baja abierto / madera.","moneda":"MXN","precio":54744.35,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":54744.35,"ajustePct":0,"precioAplicado":54744.35,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB11-76in_x_14ft-1.5_ton-Abierto_/_madera","codigo":"CB11 / Abierto / madera / 1.5 ton / 76\" x 14'","codigoLista":"CB11","nombre":"CB11 · Abierto / madera · 76\" x 14' · 1.5 ton","tipo":"cama_baja","medidas":"76\" x 14'","capacidad":"1.5 ton","especificaciones":"Cama baja abierto / madera.","moneda":"MXN","precio":40924.17,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":40924.17,"ajustePct":0,"precioAplicado":40924.17,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB11-76in_x_14ft-3_ton-Abierto_/_madera","codigo":"CB11 / Abierto / madera / 3 ton / 76\" x 14'","codigoLista":"CB11","nombre":"CB11 · Abierto / madera · 76\" x 14' · 3 ton","tipo":"cama_baja","medidas":"76\" x 14'","capacidad":"3 ton","especificaciones":"Cama baja abierto / madera.","moneda":"MXN","precio":57133.22,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":57133.22,"ajustePct":0,"precioAplicado":57133.22,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB11-76in_x_14ft-6_ton-Abierto_/_madera","codigo":"CB11 / Abierto / madera / 6 ton / 76\" x 14'","codigoLista":"CB11","nombre":"CB11 · Abierto / madera · 76\" x 14' · 6 ton","tipo":"cama_baja","medidas":"76\" x 14'","capacidad":"6 ton","especificaciones":"Cama baja abierto / madera.","moneda":"MXN","precio":83575.09,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":83575.09,"ajustePct":0,"precioAplicado":83575.09,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB6-76in_x_16ft-3_ton-Abierto_/_madera","codigo":"CB6 / Abierto / madera / 3 ton / 76\" x 16'","codigoLista":"CB6","nombre":"CB6 · Abierto / madera · 76\" x 16' · 3 ton","tipo":"cama_baja","medidas":"76\" x 16'","capacidad":"3 ton","especificaciones":"Cama baja abierto / madera.","moneda":"MXN","precio":60514.05,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":60514.05,"ajustePct":0,"precioAplicado":60514.05,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB6-76in_x_16ft-6_ton-Abierto_/_madera","codigo":"CB6 / Abierto / madera / 6 ton / 76\" x 16'","codigoLista":"CB6","nombre":"CB6 · Abierto / madera · 76\" x 16' · 6 ton","tipo":"cama_baja","medidas":"76\" x 16'","capacidad":"6 ton","especificaciones":"Cama baja abierto / madera.","moneda":"MXN","precio":86950.9,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":86950.9,"ajustePct":0,"precioAplicado":86950.9,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB8-82in_x_16ft-3_ton-Abierto_/_madera","codigo":"CB8 / Abierto / madera / 3 ton / 82\" x 16'","codigoLista":"CB8","nombre":"CB8 · Abierto / madera · 82\" x 16' · 3 ton","tipo":"cama_baja","medidas":"82\" x 16'","capacidad":"3 ton","especificaciones":"Cama baja abierto / madera. Sin redila.","moneda":"MXN","precio":62416.18,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":62416.18,"ajustePct":0,"precioAplicado":62416.18,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB8-82in_x_16ft-6_ton-Abierto_/_madera","codigo":"CB8 / Abierto / madera / 6 ton / 82\" x 16'","codigoLista":"CB8","nombre":"CB8 · Abierto / madera · 82\" x 16' · 6 ton","tipo":"cama_baja","medidas":"82\" x 16'","capacidad":"6 ton","especificaciones":"Cama baja abierto / madera. Sin redila.","moneda":"MXN","precio":89378.59,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":89378.59,"ajustePct":0,"precioAplicado":89378.59,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB5-82in_x_16ft-3_ton-Abierto_/_madera","codigo":"CB5 / Abierto / madera / 3 ton / 82\" x 16'","codigoLista":"CB5","nombre":"CB5 · Abierto / madera · 82\" x 16' · 3 ton","tipo":"cama_baja","medidas":"82\" x 16'","capacidad":"3 ton","especificaciones":"Cama baja abierto / madera. Sin redila.","moneda":"MXN","precio":68129.02,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":68129.02,"ajustePct":0,"precioAplicado":68129.02,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB5-82in_x_16ft-6_ton-Abierto_/_madera","codigo":"CB5 / Abierto / madera / 6 ton / 82\" x 16'","codigoLista":"CB5","nombre":"CB5 · Abierto / madera · 82\" x 16' · 6 ton","tipo":"cama_baja","medidas":"82\" x 16'","capacidad":"6 ton","especificaciones":"Cama baja abierto / madera. Sin redila.","moneda":"MXN","precio":91156.31,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":91156.31,"ajustePct":0,"precioAplicado":91156.31,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB12-82in_x_18ft-3_ton-Abierto_/_madera","codigo":"CB12 / Abierto / madera / 3 ton / 82\" x 18'","codigoLista":"CB12","nombre":"CB12 · Abierto / madera · 82\" x 18' · 3 ton","tipo":"cama_baja","medidas":"82\" x 18'","capacidad":"3 ton","especificaciones":"Cama baja abierto / madera. Sin redila.","moneda":"MXN","precio":64463.02,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":64463.02,"ajustePct":0,"precioAplicado":64463.02,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB12-82in_x_18ft-6_ton-Abierto_/_madera","codigo":"CB12 / Abierto / madera / 6 ton / 82\" x 18'","codigoLista":"CB12","nombre":"CB12 · Abierto / madera · 82\" x 18' · 6 ton","tipo":"cama_baja","medidas":"82\" x 18'","capacidad":"6 ton","especificaciones":"Cama baja abierto / madera. Sin redila.","moneda":"MXN","precio":92369.49,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":92369.49,"ajustePct":0,"precioAplicado":92369.49,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB13-82in_x_20ft-3_ton-Abierto_/_madera","codigo":"CB13 / Abierto / madera / 3 ton / 82\" x 20'","codigoLista":"CB13","nombre":"CB13 · Abierto / madera · 82\" x 20' · 3 ton","tipo":"cama_baja","medidas":"82\" x 20'","capacidad":"3 ton","especificaciones":"Cama baja abierto / madera. Sin redila.","moneda":"MXN","precio":67422.05,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":67422.05,"ajustePct":0,"precioAplicado":67422.05,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB13-82in_x_20ft-6_ton-Abierto_/_madera","codigo":"CB13 / Abierto / madera / 6 ton / 82\" x 20'","codigoLista":"CB13","nombre":"CB13 · Abierto / madera · 82\" x 20' · 6 ton","tipo":"cama_baja","medidas":"82\" x 20'","capacidad":"6 ton","especificaciones":"Cama baja abierto / madera. Sin redila.","moneda":"MXN","precio":96598.18,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":96598.18,"ajustePct":0,"precioAplicado":96598.18,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB1-60in_x_10ft-1.5_ton-Abierto_/_lámina","codigo":"CB1 / Abierto / lámina / 1.5 ton / 60\" x 10'","codigoLista":"CB1","nombre":"CB1 · Abierto / lámina · 60\" x 10' · 1.5 ton","tipo":"cama_baja","medidas":"60\" x 10'","capacidad":"1.5 ton","especificaciones":"Cama baja abierto / lámina.","moneda":"MXN","precio":39519.6,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":39519.6,"ajustePct":0,"precioAplicado":39519.6,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB1-60in_x_10ft-3_ton-Abierto_/_lámina","codigo":"CB1 / Abierto / lámina / 3 ton / 60\" x 10'","codigoLista":"CB1","nombre":"CB1 · Abierto / lámina · 60\" x 10' · 3 ton","tipo":"cama_baja","medidas":"60\" x 10'","capacidad":"3 ton","especificaciones":"Cama baja abierto / lámina.","moneda":"MXN","precio":54448.41,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":54448.41,"ajustePct":0,"precioAplicado":54448.41,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB1-60in_x_10ft-6_ton-Abierto_/_lámina","codigo":"CB1 / Abierto / lámina / 6 ton / 60\" x 10'","codigoLista":"CB1","nombre":"CB1 · Abierto / lámina · 60\" x 10' · 6 ton","tipo":"cama_baja","medidas":"60\" x 10'","capacidad":"6 ton","especificaciones":"Cama baja abierto / lámina.","moneda":"MXN","precio":78425.05,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":78425.05,"ajustePct":0,"precioAplicado":78425.05,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB9-60in_x_12ft-1.5_ton-Abierto_/_lámina","codigo":"CB9 / Abierto / lámina / 1.5 ton / 60\" x 12'","codigoLista":"CB9","nombre":"CB9 · Abierto / lámina · 60\" x 12' · 1.5 ton","tipo":"cama_baja","medidas":"60\" x 12'","capacidad":"1.5 ton","especificaciones":"Cama baja abierto / lámina.","moneda":"MXN","precio":39643.98,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":39643.98,"ajustePct":0,"precioAplicado":39643.98,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB9-60in_x_12ft-3_ton-Abierto_/_lámina","codigo":"CB9 / Abierto / lámina / 3 ton / 60\" x 12'","codigoLista":"CB9","nombre":"CB9 · Abierto / lámina · 60\" x 12' · 3 ton","tipo":"cama_baja","medidas":"60\" x 12'","capacidad":"3 ton","especificaciones":"Cama baja abierto / lámina.","moneda":"MXN","precio":56518.37,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":56518.37,"ajustePct":0,"precioAplicado":56518.37,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB9-60in_x_12ft-6_ton-Abierto_/_lámina","codigo":"CB9 / Abierto / lámina / 6 ton / 60\" x 12'","codigoLista":"CB9","nombre":"CB9 · Abierto / lámina · 60\" x 12' · 6 ton","tipo":"cama_baja","medidas":"60\" x 12'","capacidad":"6 ton","especificaciones":"Cama baja abierto / lámina.","moneda":"MXN","precio":80661.57,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":80661.57,"ajustePct":0,"precioAplicado":80661.57,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB10-60in_x_16ft-3_ton-Abierto_/_lámina","codigo":"CB10 / Abierto / lámina / 3 ton / 60\" x 16'","codigoLista":"CB10","nombre":"CB10 · Abierto / lámina · 60\" x 16' · 3 ton","tipo":"cama_baja","medidas":"60\" x 16'","capacidad":"3 ton","especificaciones":"Cama baja abierto / lámina.","moneda":"MXN","precio":62108.41,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":62108.41,"ajustePct":0,"precioAplicado":62108.41,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB10-60in_x_16ft-6_ton-Abierto_/_lámina","codigo":"CB10 / Abierto / lámina / 6 ton / 60\" x 16'","codigoLista":"CB10","nombre":"CB10 · Abierto / lámina · 60\" x 16' · 6 ton","tipo":"cama_baja","medidas":"60\" x 16'","capacidad":"6 ton","especificaciones":"Cama baja abierto / lámina.","moneda":"MXN","precio":91660.43,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":91660.43,"ajustePct":0,"precioAplicado":91660.43,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB3-72in_x_12ft-1.5_ton-Abierto_/_lámina","codigo":"CB3 / Abierto / lámina / 1.5 ton / 72\" x 12'","codigoLista":"CB3","nombre":"CB3 · Abierto / lámina · 72\" x 12' · 1.5 ton","tipo":"cama_baja","medidas":"72\" x 12'","capacidad":"1.5 ton","especificaciones":"Cama baja abierto / lámina. Con rampa para moto.","moneda":"MXN","precio":54583.11,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":54583.11,"ajustePct":0,"precioAplicado":54583.11,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB4-76in_x_12ft-1.5_ton-Abierto_/_lámina","codigo":"CB4 / Abierto / lámina / 1.5 ton / 76\" x 12'","codigoLista":"CB4","nombre":"CB4 · Abierto / lámina · 76\" x 12' · 1.5 ton","tipo":"cama_baja","medidas":"76\" x 12'","capacidad":"1.5 ton","especificaciones":"Cama baja abierto / lámina.","moneda":"MXN","precio":43622.96,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":43622.96,"ajustePct":0,"precioAplicado":43622.96,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB4-76in_x_12ft-3_ton-Abierto_/_lámina","codigo":"CB4 / Abierto / lámina / 3 ton / 76\" x 12'","codigoLista":"CB4","nombre":"CB4 · Abierto / lámina · 76\" x 12' · 3 ton","tipo":"cama_baja","medidas":"76\" x 12'","capacidad":"3 ton","especificaciones":"Cama baja abierto / lámina.","moneda":"MXN","precio":61701.35,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":61701.35,"ajustePct":0,"precioAplicado":61701.35,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB11-76in_x_14ft-1.5_ton-Abierto_/_lámina","codigo":"CB11 / Abierto / lámina / 1.5 ton / 76\" x 14'","codigoLista":"CB11","nombre":"CB11 · Abierto / lámina · 76\" x 14' · 1.5 ton","tipo":"cama_baja","medidas":"76\" x 14'","capacidad":"1.5 ton","especificaciones":"Cama baja abierto / lámina.","moneda":"MXN","precio":46172.3,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":46172.3,"ajustePct":0,"precioAplicado":46172.3,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB11-76in_x_14ft-3_ton-Abierto_/_lámina","codigo":"CB11 / Abierto / lámina / 3 ton / 76\" x 14'","codigoLista":"CB11","nombre":"CB11 · Abierto / lámina · 76\" x 14' · 3 ton","tipo":"cama_baja","medidas":"76\" x 14'","capacidad":"3 ton","especificaciones":"Cama baja abierto / lámina.","moneda":"MXN","precio":62368.14,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":62368.14,"ajustePct":0,"precioAplicado":62368.14,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB11-76in_x_14ft-6_ton-Abierto_/_lámina","codigo":"CB11 / Abierto / lámina / 6 ton / 76\" x 14'","codigoLista":"CB11","nombre":"CB11 · Abierto / lámina · 76\" x 14' · 6 ton","tipo":"cama_baja","medidas":"76\" x 14'","capacidad":"6 ton","especificaciones":"Cama baja abierto / lámina.","moneda":"MXN","precio":89520.12,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":89520.12,"ajustePct":0,"precioAplicado":89520.12,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB6-76in_x_16ft-3_ton-Abierto_/_lámina","codigo":"CB6 / Abierto / lámina / 3 ton / 76\" x 16'","codigoLista":"CB6","nombre":"CB6 · Abierto / lámina · 76\" x 16' · 3 ton","tipo":"cama_baja","medidas":"76\" x 16'","capacidad":"3 ton","especificaciones":"Cama baja abierto / lámina.","moneda":"MXN","precio":66081.73,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":66081.73,"ajustePct":0,"precioAplicado":66081.73,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB6-76in_x_16ft-6_ton-Abierto_/_lámina","codigo":"CB6 / Abierto / lámina / 6 ton / 76\" x 16'","codigoLista":"CB6","nombre":"CB6 · Abierto / lámina · 76\" x 16' · 6 ton","tipo":"cama_baja","medidas":"76\" x 16'","capacidad":"6 ton","especificaciones":"Cama baja abierto / lámina.","moneda":"MXN","precio":92894.93,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":92894.93,"ajustePct":0,"precioAplicado":92894.93,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB8-82in_x_16ft-3_ton-Abierto_/_lámina","codigo":"CB8 / Abierto / lámina / 3 ton / 82\" x 16'","codigoLista":"CB8","nombre":"CB8 · Abierto / lámina · 82\" x 16' · 3 ton","tipo":"cama_baja","medidas":"82\" x 16'","capacidad":"3 ton","especificaciones":"Cama baja abierto / lámina. Sin redila.","moneda":"MXN","precio":68878.58,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":68878.58,"ajustePct":0,"precioAplicado":68878.58,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB8-82in_x_16ft-6_ton-Abierto_/_lámina","codigo":"CB8 / Abierto / lámina / 6 ton / 82\" x 16'","codigoLista":"CB8","nombre":"CB8 · Abierto / lámina · 82\" x 16' · 6 ton","tipo":"cama_baja","medidas":"82\" x 16'","capacidad":"6 ton","especificaciones":"Cama baja abierto / lámina. Sin redila.","moneda":"MXN","precio":95859.25,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":95859.25,"ajustePct":0,"precioAplicado":95859.25,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB9-82in_x_16ft-3_ton-Abierto_/_lámina","codigo":"CB9 / Abierto / lámina / 3 ton / 82\" x 16'","codigoLista":"CB9","nombre":"CB9 · Abierto / lámina · 82\" x 16' · 3 ton","tipo":"cama_baja","medidas":"82\" x 16'","capacidad":"3 ton","especificaciones":"Cama baja abierto / lámina. Sin redila.","moneda":"MXN","precio":74605.65,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":74605.65,"ajustePct":0,"precioAplicado":74605.65,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB9-82in_x_16ft-6_ton-Abierto_/_lámina","codigo":"CB9 / Abierto / lámina / 6 ton / 82\" x 16'","codigoLista":"CB9","nombre":"CB9 · Abierto / lámina · 82\" x 16' · 6 ton","tipo":"cama_baja","medidas":"82\" x 16'","capacidad":"6 ton","especificaciones":"Cama baja abierto / lámina. Sin redila.","moneda":"MXN","precio":98478.6,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":98478.6,"ajustePct":0,"precioAplicado":98478.6,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB12-82in_x_18ft-3_ton-Abierto_/_lámina","codigo":"CB12 / Abierto / lámina / 3 ton / 82\" x 18'","codigoLista":"CB12","nombre":"CB12 · Abierto / lámina · 82\" x 18' · 3 ton","tipo":"cama_baja","medidas":"82\" x 18'","capacidad":"3 ton","especificaciones":"Cama baja abierto / lámina. Sin redila.","moneda":"MXN","precio":72191.25,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":72191.25,"ajustePct":0,"precioAplicado":72191.25,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB12-82in_x_18ft-6_ton-Abierto_/_lámina","codigo":"CB12 / Abierto / lámina / 6 ton / 82\" x 18'","codigoLista":"CB12","nombre":"CB12 · Abierto / lámina · 82\" x 18' · 6 ton","tipo":"cama_baja","medidas":"82\" x 18'","capacidad":"6 ton","especificaciones":"Cama baja abierto / lámina. Sin redila.","moneda":"MXN","precio":100024.39,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":100024.39,"ajustePct":0,"precioAplicado":100024.39,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB13-82in_x_20ft-3_ton-Abierto_/_lámina","codigo":"CB13 / Abierto / lámina / 3 ton / 82\" x 20'","codigoLista":"CB13","nombre":"CB13 · Abierto / lámina · 82\" x 20' · 3 ton","tipo":"cama_baja","medidas":"82\" x 20'","capacidad":"3 ton","especificaciones":"Cama baja abierto / lámina. Sin redila.","moneda":"MXN","precio":75751.87,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":75751.87,"ajustePct":0,"precioAplicado":75751.87,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB13-82in_x_20ft-6_ton-Abierto_/_lámina","codigo":"CB13 / Abierto / lámina / 6 ton / 82\" x 20'","codigoLista":"CB13","nombre":"CB13 · Abierto / lámina · 82\" x 20' · 6 ton","tipo":"cama_baja","medidas":"82\" x 20'","capacidad":"6 ton","especificaciones":"Cama baja abierto / lámina. Sin redila.","moneda":"MXN","precio":104050.03,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":104050.03,"ajustePct":0,"precioAplicado":104050.03,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB1-60in_x_10ft-1.5_ton-Cerrado_/_madera","codigo":"CB1 / Cerrado / madera / 1.5 ton / 60\" x 10'","codigoLista":"CB1","nombre":"CB1 · Cerrado / madera · 60\" x 10' · 1.5 ton","tipo":"cama_baja","medidas":"60\" x 10'","capacidad":"1.5 ton","especificaciones":"Cama baja cerrado / madera.","moneda":"MXN","precio":36617.09,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":36617.09,"ajustePct":0,"precioAplicado":36617.09,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB1-60in_x_10ft-3_ton-Cerrado_/_madera","codigo":"CB1 / Cerrado / madera / 3 ton / 60\" x 10'","codigoLista":"CB1","nombre":"CB1 · Cerrado / madera · 60\" x 10' · 3 ton","tipo":"cama_baja","medidas":"60\" x 10'","capacidad":"3 ton","especificaciones":"Cama baja cerrado / madera.","moneda":"MXN","precio":53200.2,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":53200.2,"ajustePct":0,"precioAplicado":53200.2,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB1-60in_x_10ft-6_ton-Cerrado_/_madera","codigo":"CB1 / Cerrado / madera / 6 ton / 60\" x 10'","codigoLista":"CB1","nombre":"CB1 · Cerrado / madera · 60\" x 10' · 6 ton","tipo":"cama_baja","medidas":"60\" x 10'","capacidad":"6 ton","especificaciones":"Cama baja cerrado / madera.","moneda":"MXN","precio":77989.8,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":77989.8,"ajustePct":0,"precioAplicado":77989.8,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB9-60in_x_12ft-1.5_ton-Cerrado_/_madera","codigo":"CB9 / Cerrado / madera / 1.5 ton / 60\" x 12'","codigoLista":"CB9","nombre":"CB9 · Cerrado / madera · 60\" x 12' · 1.5 ton","tipo":"cama_baja","medidas":"60\" x 12'","capacidad":"1.5 ton","especificaciones":"Cama baja cerrado / madera.","moneda":"MXN","precio":41918.27,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":41918.27,"ajustePct":0,"precioAplicado":41918.27,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB9-60in_x_12ft-3_ton-Cerrado_/_madera","codigo":"CB9 / Cerrado / madera / 3 ton / 60\" x 12'","codigoLista":"CB9","nombre":"CB9 · Cerrado / madera · 60\" x 12' · 3 ton","tipo":"cama_baja","medidas":"60\" x 12'","capacidad":"3 ton","especificaciones":"Cama baja cerrado / madera.","moneda":"MXN","precio":57186.67,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":57186.67,"ajustePct":0,"precioAplicado":57186.67,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB9-60in_x_12ft-6_ton-Cerrado_/_madera","codigo":"CB9 / Cerrado / madera / 6 ton / 60\" x 12'","codigoLista":"CB9","nombre":"CB9 · Cerrado / madera · 60\" x 12' · 6 ton","tipo":"cama_baja","medidas":"60\" x 12'","capacidad":"6 ton","especificaciones":"Cama baja cerrado / madera.","moneda":"MXN","precio":80226.32,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":80226.32,"ajustePct":0,"precioAplicado":80226.32,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB10-60in_x_16ft-3_ton-Cerrado_/_madera","codigo":"CB10 / Cerrado / madera / 3 ton / 60\" x 16'","codigoLista":"CB10","nombre":"CB10 · Cerrado / madera · 60\" x 16' · 3 ton","tipo":"cama_baja","medidas":"60\" x 16'","capacidad":"3 ton","especificaciones":"Cama baja cerrado / madera.","moneda":"MXN","precio":61258.4,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":61258.4,"ajustePct":0,"precioAplicado":61258.4,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB10-60in_x_16ft-6_ton-Cerrado_/_madera","codigo":"CB10 / Cerrado / madera / 6 ton / 60\" x 16'","codigoLista":"CB10","nombre":"CB10 · Cerrado / madera · 60\" x 16' · 6 ton","tipo":"cama_baja","medidas":"60\" x 16'","capacidad":"6 ton","especificaciones":"Cama baja cerrado / madera.","moneda":"MXN","precio":89825.48,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":89825.48,"ajustePct":0,"precioAplicado":89825.48,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB3-72in_x_12ft-1.5_ton-Cerrado_/_madera","codigo":"CB3 / Cerrado / madera / 1.5 ton / 72\" x 12'","codigoLista":"CB3","nombre":"CB3 · Cerrado / madera · 72\" x 12' · 1.5 ton","tipo":"cama_baja","medidas":"72\" x 12'","capacidad":"1.5 ton","especificaciones":"Cama baja cerrado / madera. Con rampa para moto.","moneda":"MXN","precio":54923.73,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":54923.73,"ajustePct":0,"precioAplicado":54923.73,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB4-76in_x_12ft-1.5_ton-Cerrado_/_madera","codigo":"CB4 / Cerrado / madera / 1.5 ton / 76\" x 12'","codigoLista":"CB4","nombre":"CB4 · Cerrado / madera · 76\" x 12' · 1.5 ton","tipo":"cama_baja","medidas":"76\" x 12'","capacidad":"1.5 ton","especificaciones":"Cama baja cerrado / madera.","moneda":"MXN","precio":42088.58,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":42088.58,"ajustePct":0,"precioAplicado":42088.58,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB4-76in_x_12ft-3_ton-Cerrado_/_madera","codigo":"CB4 / Cerrado / madera / 3 ton / 76\" x 12'","codigoLista":"CB4","nombre":"CB4 · Cerrado / madera · 76\" x 12' · 3 ton","tipo":"cama_baja","medidas":"76\" x 12'","capacidad":"3 ton","especificaciones":"Cama baja cerrado / madera.","moneda":"MXN","precio":60640.79,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":60640.79,"ajustePct":0,"precioAplicado":60640.79,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB11-76in_x_14ft-1.5_ton-Cerrado_/_madera","codigo":"CB11 / Cerrado / madera / 1.5 ton / 76\" x 14'","codigoLista":"CB11","nombre":"CB11 · Cerrado / madera · 76\" x 14' · 1.5 ton","tipo":"cama_baja","medidas":"76\" x 14'","capacidad":"1.5 ton","especificaciones":"Cama baja cerrado / madera.","moneda":"MXN","precio":44074.31,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":44074.31,"ajustePct":0,"precioAplicado":44074.31,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB11-76in_x_14ft-3_ton-Cerrado_/_madera","codigo":"CB11 / Cerrado / madera / 3 ton / 76\" x 14'","codigoLista":"CB11","nombre":"CB11 · Cerrado / madera · 76\" x 14' · 3 ton","tipo":"cama_baja","medidas":"76\" x 14'","capacidad":"3 ton","especificaciones":"Cama baja cerrado / madera.","moneda":"MXN","precio":61639.51,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":61639.51,"ajustePct":0,"precioAplicado":61639.51,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB11-76in_x_14ft-6_ton-Cerrado_/_madera","codigo":"CB11 / Cerrado / madera / 6 ton / 76\" x 14'","codigoLista":"CB11","nombre":"CB11 · Cerrado / madera · 76\" x 14' · 6 ton","tipo":"cama_baja","medidas":"76\" x 14'","capacidad":"6 ton","especificaciones":"Cama baja cerrado / madera.","moneda":"MXN","precio":90223.12,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":90223.12,"ajustePct":0,"precioAplicado":90223.12,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB6-76in_x_16ft-3_ton-Cerrado_/_madera","codigo":"CB6 / Cerrado / madera / 3 ton / 76\" x 16'","codigoLista":"CB6","nombre":"CB6 · Cerrado / madera · 76\" x 16' · 3 ton","tipo":"cama_baja","medidas":"76\" x 16'","capacidad":"3 ton","especificaciones":"Cama baja cerrado / madera.","moneda":"MXN","precio":65487.28,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":65487.28,"ajustePct":0,"precioAplicado":65487.28,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB6-76in_x_16ft-6_ton-Cerrado_/_madera","codigo":"CB6 / Cerrado / madera / 6 ton / 76\" x 16'","codigoLista":"CB6","nombre":"CB6 · Cerrado / madera · 76\" x 16' · 6 ton","tipo":"cama_baja","medidas":"76\" x 16'","capacidad":"6 ton","especificaciones":"Cama baja cerrado / madera.","moneda":"MXN","precio":93597.93,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":93597.93,"ajustePct":0,"precioAplicado":93597.93,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB8-82in_x_16ft-3_ton-Cerrado_/_madera","codigo":"CB8 / Cerrado / madera / 3 ton / 82\" x 16'","codigoLista":"CB8","nombre":"CB8 · Cerrado / madera · 82\" x 16' · 3 ton","tipo":"cama_baja","medidas":"82\" x 16'","capacidad":"3 ton","especificaciones":"Cama baja cerrado / madera.","moneda":"MXN","precio":67729.98,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":67729.98,"ajustePct":0,"precioAplicado":67729.98,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB8-82in_x_16ft-6_ton-Cerrado_/_madera","codigo":"CB8 / Cerrado / madera / 6 ton / 82\" x 16'","codigoLista":"CB8","nombre":"CB8 · Cerrado / madera · 82\" x 16' · 6 ton","tipo":"cama_baja","medidas":"82\" x 16'","capacidad":"6 ton","especificaciones":"Cama baja cerrado / madera.","moneda":"MXN","precio":93959.12,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":93959.12,"ajustePct":0,"precioAplicado":93959.12,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB12-82in_x_18ft-3_ton-Cerrado_/_madera","codigo":"CB12 / Cerrado / madera / 3 ton / 82\" x 18'","codigoLista":"CB12","nombre":"CB12 · Cerrado / madera · 82\" x 18' · 3 ton","tipo":"cama_baja","medidas":"82\" x 18'","capacidad":"3 ton","especificaciones":"Cama baja cerrado / madera.","moneda":"MXN","precio":69812.91,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":69812.91,"ajustePct":0,"precioAplicado":69812.91,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB12-82in_x_18ft-6_ton-Cerrado_/_madera","codigo":"CB12 / Cerrado / madera / 6 ton / 82\" x 18'","codigoLista":"CB12","nombre":"CB12 · Cerrado / madera · 82\" x 18' · 6 ton","tipo":"cama_baja","medidas":"82\" x 18'","capacidad":"6 ton","especificaciones":"Cama baja cerrado / madera.","moneda":"MXN","precio":101436.81,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":101436.81,"ajustePct":0,"precioAplicado":101436.81,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB13-82in_x_20ft-3_ton-Cerrado_/_madera","codigo":"CB13 / Cerrado / madera / 3 ton / 82\" x 20'","codigoLista":"CB13","nombre":"CB13 · Cerrado / madera · 82\" x 20' · 3 ton","tipo":"cama_baja","medidas":"82\" x 20'","capacidad":"3 ton","especificaciones":"Cama baja cerrado / madera.","moneda":"MXN","precio":73879.54,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":73879.54,"ajustePct":0,"precioAplicado":73879.54,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB13-82in_x_20ft-6_ton-Cerrado_/_madera","codigo":"CB13 / Cerrado / madera / 6 ton / 82\" x 20'","codigoLista":"CB13","nombre":"CB13 · Cerrado / madera · 82\" x 20' · 6 ton","tipo":"cama_baja","medidas":"82\" x 20'","capacidad":"6 ton","especificaciones":"Cama baja cerrado / madera.","moneda":"MXN","precio":104194.63,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":104194.63,"ajustePct":0,"precioAplicado":104194.63,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB1-60in_x_10ft-1.5_ton-Cerrado_/_lámina","codigo":"CB1 / Cerrado / lámina / 1.5 ton / 60\" x 10'","codigoLista":"CB1","nombre":"CB1 · Cerrado / lámina · 60\" x 10' · 1.5 ton","tipo":"cama_baja","medidas":"60\" x 10'","capacidad":"1.5 ton","especificaciones":"Cama baja cerrado / lámina.","moneda":"MXN","precio":41747.85,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":41747.85,"ajustePct":0,"precioAplicado":41747.85,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB1-60in_x_10ft-3_ton-Cerrado_/_lámina","codigo":"CB1 / Cerrado / lámina / 3 ton / 60\" x 10'","codigoLista":"CB1","nombre":"CB1 · Cerrado / lámina · 60\" x 10' · 3 ton","tipo":"cama_baja","medidas":"60\" x 10'","capacidad":"3 ton","especificaciones":"Cama baja cerrado / lámina.","moneda":"MXN","precio":56450.52,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":56450.52,"ajustePct":0,"precioAplicado":56450.52,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB1-60in_x_10ft-6_ton-Cerrado_/_lámina","codigo":"CB1 / Cerrado / lámina / 6 ton / 60\" x 10'","codigoLista":"CB1","nombre":"CB1 · Cerrado / lámina · 60\" x 10' · 6 ton","tipo":"cama_baja","medidas":"60\" x 10'","capacidad":"6 ton","especificaciones":"Cama baja cerrado / lámina.","moneda":"MXN","precio":80543.53,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":80543.53,"ajustePct":0,"precioAplicado":80543.53,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB9-60in_x_12ft-1.5_ton-Cerrado_/_lámina","codigo":"CB9 / Cerrado / lámina / 1.5 ton / 60\" x 12'","codigoLista":"CB9","nombre":"CB9 · Cerrado / lámina · 60\" x 12' · 1.5 ton","tipo":"cama_baja","medidas":"60\" x 12'","capacidad":"1.5 ton","especificaciones":"Cama baja cerrado / lámina.","moneda":"MXN","precio":45926.99,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":45926.99,"ajustePct":0,"precioAplicado":45926.99,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB9-60in_x_12ft-3_ton-Cerrado_/_lámina","codigo":"CB9 / Cerrado / lámina / 3 ton / 60\" x 12'","codigoLista":"CB9","nombre":"CB9 · Cerrado / lámina · 60\" x 12' · 3 ton","tipo":"cama_baja","medidas":"60\" x 12'","capacidad":"3 ton","especificaciones":"Cama baja cerrado / lámina.","moneda":"MXN","precio":61030.06,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":61030.06,"ajustePct":0,"precioAplicado":61030.06,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB9-60in_x_12ft-6_ton-Cerrado_/_lámina","codigo":"CB9 / Cerrado / lámina / 6 ton / 60\" x 12'","codigoLista":"CB9","nombre":"CB9 · Cerrado / lámina · 60\" x 12' · 6 ton","tipo":"cama_baja","medidas":"60\" x 12'","capacidad":"6 ton","especificaciones":"Cama baja cerrado / lámina.","moneda":"MXN","precio":82780.05,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":82780.05,"ajustePct":0,"precioAplicado":82780.05,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB10-60in_x_16ft-3_ton-Cerrado_/_lámina","codigo":"CB10 / Cerrado / lámina / 3 ton / 60\" x 16'","codigoLista":"CB10","nombre":"CB10 · Cerrado / lámina · 60\" x 16' · 3 ton","tipo":"cama_baja","medidas":"60\" x 16'","capacidad":"3 ton","especificaciones":"Cama baja cerrado / lámina.","moneda":"MXN","precio":66309.58,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":66309.58,"ajustePct":0,"precioAplicado":66309.58,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB10-60in_x_16ft-6_ton-Cerrado_/_lámina","codigo":"CB10 / Cerrado / lámina / 6 ton / 60\" x 16'","codigoLista":"CB10","nombre":"CB10 · Cerrado / lámina · 60\" x 16' · 6 ton","tipo":"cama_baja","medidas":"60\" x 16'","capacidad":"6 ton","especificaciones":"Cama baja cerrado / lámina.","moneda":"MXN","precio":92377.75,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":92377.75,"ajustePct":0,"precioAplicado":92377.75,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB3-72in_x_12ft-1.5_ton-Cerrado_/_lámina","codigo":"CB3 / Cerrado / lámina / 1.5 ton / 72\" x 12'","codigoLista":"CB3","nombre":"CB3 · Cerrado / lámina · 72\" x 12' · 1.5 ton","tipo":"cama_baja","medidas":"72\" x 12'","capacidad":"1.5 ton","especificaciones":"Cama baja cerrado / lámina. Con rampa para moto.","moneda":"MXN","precio":59312.31,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":59312.31,"ajustePct":0,"precioAplicado":59312.31,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB4-76in_x_12ft-1.5_ton-Cerrado_/_lámina","codigo":"CB4 / Cerrado / lámina / 1.5 ton / 76\" x 12'","codigoLista":"CB4","nombre":"CB4 · Cerrado / lámina · 76\" x 12' · 1.5 ton","tipo":"cama_baja","medidas":"76\" x 12'","capacidad":"1.5 ton","especificaciones":"Cama baja cerrado / lámina.","moneda":"MXN","precio":46474.67,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":46474.67,"ajustePct":0,"precioAplicado":46474.67,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB4-76in_x_12ft-3_ton-Cerrado_/_lámina","codigo":"CB4 / Cerrado / lámina / 3 ton / 76\" x 12'","codigoLista":"CB4","nombre":"CB4 · Cerrado / lámina · 76\" x 12' · 3 ton","tipo":"cama_baja","medidas":"76\" x 12'","capacidad":"3 ton","especificaciones":"Cama baja cerrado / lámina.","moneda":"MXN","precio":65026.9,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":65026.9,"ajustePct":0,"precioAplicado":65026.9,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB11-76in_x_14ft-1.5_ton-Cerrado_/_lámina","codigo":"CB11 / Cerrado / lámina / 1.5 ton / 76\" x 14'","codigoLista":"CB11","nombre":"CB11 · Cerrado / lámina · 76\" x 14' · 1.5 ton","tipo":"cama_baja","medidas":"76\" x 14'","capacidad":"1.5 ton","especificaciones":"Cama baja cerrado / lámina.","moneda":"MXN","precio":49322.45,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":49322.45,"ajustePct":0,"precioAplicado":49322.45,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB11-76in_x_14ft-3_ton-Cerrado_/_lámina","codigo":"CB11 / Cerrado / lámina / 3 ton / 76\" x 14'","codigoLista":"CB11","nombre":"CB11 · Cerrado / lámina · 76\" x 14' · 3 ton","tipo":"cama_baja","medidas":"76\" x 14'","capacidad":"3 ton","especificaciones":"Cama baja cerrado / lámina.","moneda":"MXN","precio":66863.33,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":66863.33,"ajustePct":0,"precioAplicado":66863.33,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB11-76in_x_14ft-6_ton-Cerrado_/_lámina","codigo":"CB11 / Cerrado / lámina / 6 ton / 76\" x 14'","codigoLista":"CB11","nombre":"CB11 · Cerrado / lámina · 76\" x 14' · 6 ton","tipo":"cama_baja","medidas":"76\" x 14'","capacidad":"6 ton","especificaciones":"Cama baja cerrado / lámina.","moneda":"MXN","precio":96167.15,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":96167.15,"ajustePct":0,"precioAplicado":96167.15,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB6-76in_x_16ft-3_ton-Cerrado_/_lámina","codigo":"CB6 / Cerrado / lámina / 3 ton / 76\" x 16'","codigoLista":"CB6","nombre":"CB6 · Cerrado / lámina · 76\" x 16' · 3 ton","tipo":"cama_baja","medidas":"76\" x 16'","capacidad":"3 ton","especificaciones":"Cama baja cerrado / lámina.","moneda":"MXN","precio":71229.38,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":71229.38,"ajustePct":0,"precioAplicado":71229.38,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB6-76in_x_16ft-6_ton-Cerrado_/_lámina","codigo":"CB6 / Cerrado / lámina / 6 ton / 76\" x 16'","codigoLista":"CB6","nombre":"CB6 · Cerrado / lámina · 76\" x 16' · 6 ton","tipo":"cama_baja","medidas":"76\" x 16'","capacidad":"6 ton","especificaciones":"Cama baja cerrado / lámina.","moneda":"MXN","precio":99541.96,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":99541.96,"ajustePct":0,"precioAplicado":99541.96,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB8-82in_x_16ft-3_ton-Cerrado_/_lámina","codigo":"CB8 / Cerrado / lámina / 3 ton / 82\" x 16'","codigoLista":"CB8","nombre":"CB8 · Cerrado / lámina · 82\" x 16' · 3 ton","tipo":"cama_baja","medidas":"82\" x 16'","capacidad":"3 ton","especificaciones":"Cama baja cerrado / lámina.","moneda":"MXN","precio":73746.3,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":73746.3,"ajustePct":0,"precioAplicado":73746.3,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB8-82in_x_16ft-6_ton-Cerrado_/_lámina","codigo":"CB8 / Cerrado / lámina / 6 ton / 82\" x 16'","codigoLista":"CB8","nombre":"CB8 · Cerrado / lámina · 82\" x 16' · 6 ton","tipo":"cama_baja","medidas":"82\" x 16'","capacidad":"6 ton","especificaciones":"Cama baja cerrado / lámina.","moneda":"MXN","precio":100598.57,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":100598.57,"ajustePct":0,"precioAplicado":100598.57,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB12-82in_x_18ft-3_ton-Cerrado_/_lámina","codigo":"CB12 / Cerrado / lámina / 3 ton / 82\" x 18'","codigoLista":"CB12","nombre":"CB12 · Cerrado / lámina · 82\" x 18' · 3 ton","tipo":"cama_baja","medidas":"82\" x 18'","capacidad":"3 ton","especificaciones":"Cama baja cerrado / lámina.","moneda":"MXN","precio":77561.92,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":77561.92,"ajustePct":0,"precioAplicado":77561.92,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB12-82in_x_18ft-6_ton-Cerrado_/_lámina","codigo":"CB12 / Cerrado / lámina / 6 ton / 82\" x 18'","codigoLista":"CB12","nombre":"CB12 · Cerrado / lámina · 82\" x 18' · 6 ton","tipo":"cama_baja","medidas":"82\" x 18'","capacidad":"6 ton","especificaciones":"Cama baja cerrado / lámina.","moneda":"MXN","precio":106884.34,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":106884.34,"ajustePct":0,"precioAplicado":106884.34,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB13-82in_x_20ft-3_ton-Cerrado_/_lámina","codigo":"CB13 / Cerrado / lámina / 3 ton / 82\" x 20'","codigoLista":"CB13","nombre":"CB13 · Cerrado / lámina · 82\" x 20' · 3 ton","tipo":"cama_baja","medidas":"82\" x 20'","capacidad":"3 ton","especificaciones":"Cama baja cerrado / lámina.","moneda":"MXN","precio":81504.02,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":81504.02,"ajustePct":0,"precioAplicado":81504.02,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-cama-CB13-82in_x_20ft-6_ton-Cerrado_/_lámina","codigo":"CB13 / Cerrado / lámina / 6 ton / 82\" x 20'","codigoLista":"CB13","nombre":"CB13 · Cerrado / lámina · 82\" x 20' · 6 ton","tipo":"cama_baja","medidas":"82\" x 20'","capacidad":"6 ton","especificaciones":"Cama baja cerrado / lámina.","moneda":"MXN","precio":111646.49,"basePrecio":"con_iva","ivaPct":16,"modoPrecio":"fijo","ensambles":[],"adicionales":[{"clase":"pieza","itemId":"MX-CAMA-FRENOS"},{"clase":"pieza","itemId":"MX-CAMA-GATO7"},{"clase":"pieza","itemId":"MX-CAMA-LL750"},{"clase":"pieza","itemId":"MX-CAMA-LL700"},{"clase":"pieza","itemId":"MX-CAMA-CONTROL"},{"clase":"pieza","itemId":"MX-CAMA-PORTA"}],"origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":111646.49,"ajustePct":0,"precioAplicado":111646.49,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1}],"piezas":[{"id":"MX-CAJA-FRENOS","codigo":"MX-CAJA-FRENOS","nombre":"Frenos adicionales (importe de lista)","moneda":"MXN","precio":3375.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"opción","categoria":"Rodado y suspensión","origen":{"archivo":"8e7a4bbf-134f-4559-b5d3-89552017ada4.png","fechaLista":"2020-05-29","precioLista":2500,"ajustePct":35,"precioAplicado":3375.0,"nota":"Importes con IVA incluido, confirmado por el usuario. Aumento del 35% en la hoja de 2020."},"_revision":1},{"id":"MX-VOLTEO-FRENOS","codigo":"MX-VOLTEO-FRENOS","nombre":"Frenos adicionales (importe de lista)","moneda":"MXN","precio":3500.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"opción","categoria":"Rodado y suspensión","origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":3500,"ajustePct":0,"precioAplicado":3500.0,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-ESPECIALES-FRENOS","codigo":"MX-ESPECIALES-FRENOS","nombre":"Frenos adicionales (importe de lista)","moneda":"MXN","precio":3500.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"opción","categoria":"Rodado y suspensión","origen":{"archivo":"a32071f4-14f2-45d7-ae8c-016bd4238fe9.png","fechaLista":"2024-02-02","precioLista":3500,"ajustePct":0,"precioAplicado":3500.0,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-GANADERO-FRENOS","codigo":"MX-GANADERO-FRENOS","nombre":"Frenos adicionales (importe de lista)","moneda":"MXN","precio":3500.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"opción","categoria":"Rodado y suspensión","origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":3500,"ajustePct":0,"precioAplicado":3500.0,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-CAMA-FRENOS","codigo":"MX-CAMA-FRENOS","nombre":"Frenos adicionales (importe de lista)","moneda":"MXN","precio":3500.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"opción","categoria":"Rodado y suspensión","origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":3500,"ajustePct":0,"precioAplicado":3500.0,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-CAJA-GATO7","codigo":"MX-CAJA-GATO7","nombre":"Gato de 7,000 lbs","moneda":"MXN","precio":945.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"pza","categoria":"Accesorios","origen":{"archivo":"8e7a4bbf-134f-4559-b5d3-89552017ada4.png","fechaLista":"2020-05-29","precioLista":700,"ajustePct":35,"precioAplicado":945.0,"nota":"Importes con IVA incluido, confirmado por el usuario. Aumento del 35% en la hoja de 2020."},"_revision":1},{"id":"MX-CAJA-PTARAMPA","codigo":"MX-CAJA-PTARAMPA","nombre":"Puerta rampa","moneda":"MXN","precio":8100.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"pza","categoria":"Accesorios","origen":{"archivo":"8e7a4bbf-134f-4559-b5d3-89552017ada4.png","fechaLista":"2020-05-29","precioLista":6000,"ajustePct":35,"precioAplicado":8100.0,"nota":"Importes con IVA incluido, confirmado por el usuario. Aumento del 35% en la hoja de 2020."},"_revision":1},{"id":"MX-CAJA-PTALATERAL","codigo":"MX-CAJA-PTALATERAL","nombre":"Puerta lateral","moneda":"MXN","precio":2025.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"pza","categoria":"Accesorios","origen":{"archivo":"8e7a4bbf-134f-4559-b5d3-89552017ada4.png","fechaLista":"2020-05-29","precioLista":1500,"ajustePct":35,"precioAplicado":2025.0,"nota":"Importes con IVA incluido, confirmado por el usuario. Aumento del 35% en la hoja de 2020."},"_revision":1},{"id":"MX-CAJA-LL750","codigo":"MX-CAJA-LL750","nombre":"Llanta y rin 750-16","moneda":"MXN","precio":4050.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"juego","categoria":"Accesorios","origen":{"archivo":"8e7a4bbf-134f-4559-b5d3-89552017ada4.png","fechaLista":"2020-05-29","precioLista":3000,"ajustePct":35,"precioAplicado":4050.0,"nota":"Importes con IVA incluido, confirmado por el usuario. Aumento del 35% en la hoja de 2020."},"_revision":1},{"id":"MX-CAJA-LL700","codigo":"MX-CAJA-LL700","nombre":"Llanta y rin 700-15","moneda":"MXN","precio":2902.5,"basePrecio":"con_iva","ivaPct":16,"unidad":"juego","categoria":"Accesorios","origen":{"archivo":"8e7a4bbf-134f-4559-b5d3-89552017ada4.png","fechaLista":"2020-05-29","precioLista":2150,"ajustePct":35,"precioAplicado":2902.5,"nota":"Importes con IVA incluido, confirmado por el usuario. Aumento del 35% en la hoja de 2020."},"_revision":1},{"id":"MX-CAJA-CONTROL","codigo":"MX-CAJA-CONTROL","nombre":"Control de freno","moneda":"MXN","precio":2430.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"pza","categoria":"Accesorios","origen":{"archivo":"8e7a4bbf-134f-4559-b5d3-89552017ada4.png","fechaLista":"2020-05-29","precioLista":1800,"ajustePct":35,"precioAplicado":2430.0,"nota":"Importes con IVA incluido, confirmado por el usuario. Aumento del 35% en la hoja de 2020."},"_revision":1},{"id":"MX-CAJA-PORTA","codigo":"MX-CAJA-PORTA","nombre":"Porta extra","moneda":"MXN","precio":1080.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"pza","categoria":"Accesorios","origen":{"archivo":"8e7a4bbf-134f-4559-b5d3-89552017ada4.png","fechaLista":"2020-05-29","precioLista":800,"ajustePct":35,"precioAplicado":1080.0,"nota":"Importes con IVA incluido, confirmado por el usuario. Aumento del 35% en la hoja de 2020."},"_revision":1},{"id":"MX-VOLTEO-GATO12","codigo":"MX-VOLTEO-GATO12","nombre":"Gato de 12,000 lbs","moneda":"MXN","precio":2500.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"pza","categoria":"Accesorios","origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":2500,"ajustePct":0,"precioAplicado":2500.0,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-VOLTEO-LL750","codigo":"MX-VOLTEO-LL750","nombre":"Llanta y rin 750-16","moneda":"MXN","precio":3500.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"juego","categoria":"Accesorios","origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":3500,"ajustePct":0,"precioAplicado":3500.0,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-VOLTEO-LL700","codigo":"MX-VOLTEO-LL700","nombre":"Llanta y rin 700-15","moneda":"MXN","precio":2200.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"juego","categoria":"Accesorios","origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":2200,"ajustePct":0,"precioAplicado":2200.0,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-VOLTEO-CONTROL","codigo":"MX-VOLTEO-CONTROL","nombre":"Control de freno","moneda":"MXN","precio":3000.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"pza","categoria":"Accesorios","origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":3000,"ajustePct":0,"precioAplicado":3000.0,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-VOLTEO-REDILA","codigo":"MX-VOLTEO-REDILA","nombre":"Pie adicional de redila","moneda":"MXN","precio":7500.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"pie adicional","categoria":"Accesorios","origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":7500,"ajustePct":0,"precioAplicado":7500.0,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-VOLTEO-PISTON","codigo":"MX-VOLTEO-PISTON","nombre":"Pistón hidráulico","moneda":"MXN","precio":6000.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"pza","categoria":"Accesorios","origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":6000,"ajustePct":0,"precioAplicado":6000.0,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-VOLTEO-PISTON30","codigo":"MX-VOLTEO-PISTON30","nombre":"Pistón 30 x 30","moneda":"MXN","precio":5500.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"pza","categoria":"Accesorios","origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":5500,"ajustePct":0,"precioAplicado":5500.0,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-VOLTEO-BOMBA","codigo":"MX-VOLTEO-BOMBA","nombre":"Bomba eléctrica adicional","moneda":"MXN","precio":11000.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"pza","categoria":"Accesorios","origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":11000,"ajustePct":0,"precioAplicado":11000.0,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-VOLTEO-TIJERA","codigo":"MX-VOLTEO-TIJERA","nombre":"Tijera para pistón","moneda":"MXN","precio":8000.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"pza","categoria":"Accesorios","origen":{"archivo":"0c177731-be62-46a8-a036-1d900de8c7bf.png","fechaLista":"2024-02-02","precioLista":8000,"ajustePct":0,"precioAplicado":8000.0,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-GANADERO-PTALATERAL","codigo":"MX-GANADERO-PTALATERAL","nombre":"Puerta lateral","moneda":"MXN","precio":2500.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"pza","categoria":"Accesorios","origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":2500,"ajustePct":0,"precioAplicado":2500.0,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-GANADERO-LL750","codigo":"MX-GANADERO-LL750","nombre":"Llanta y rin 750-16","moneda":"MXN","precio":3500.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"juego","categoria":"Accesorios","origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":3500,"ajustePct":0,"precioAplicado":3500.0,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-GANADERO-LL700","codigo":"MX-GANADERO-LL700","nombre":"Llanta y rin 700-15","moneda":"MXN","precio":2200.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"juego","categoria":"Accesorios","origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":2200,"ajustePct":0,"precioAplicado":2200.0,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-GANADERO-CONTROL","codigo":"MX-GANADERO-CONTROL","nombre":"Control de freno","moneda":"MXN","precio":3000.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"pza","categoria":"Accesorios","origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":3000,"ajustePct":0,"precioAplicado":3000.0,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-GANADERO-TECHO","codigo":"MX-GANADERO-TECHO","nombre":"Techo de lámina por pie lineal","moneda":"MXN","precio":800.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"pie lineal","categoria":"Accesorios","origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":800,"ajustePct":0,"precioAplicado":800.0,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-GANADERO-JALON","codigo":"MX-GANADERO-JALON","nombre":"Jalón cuello de ganso (adicional de lista)","moneda":"MXN","precio":8500.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"opción","categoria":"Accesorios","origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":8500,"ajustePct":0,"precioAplicado":8500.0,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-GANADERO-CACHUCHA","codigo":"MX-GANADERO-CACHUCHA","nombre":"Cachucha de fibra de vidrio","moneda":"MXN","precio":10000.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"pza","categoria":"Accesorios","origen":{"archivo":"b5604473-734b-4b1b-92c1-5ec7a3c65bcf.png","fechaLista":"2024-02-02","precioLista":10000,"ajustePct":0,"precioAplicado":10000.0,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-CAMA-GATO7","codigo":"MX-CAMA-GATO7","nombre":"Gato de 7,000 lbs","moneda":"MXN","precio":1450.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"pza","categoria":"Accesorios","origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":1450,"ajustePct":0,"precioAplicado":1450.0,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-CAMA-LL750","codigo":"MX-CAMA-LL750","nombre":"Llanta y rin 750-16","moneda":"MXN","precio":3500.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"juego","categoria":"Accesorios","origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":3500,"ajustePct":0,"precioAplicado":3500.0,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-CAMA-LL700","codigo":"MX-CAMA-LL700","nombre":"Llanta y rin 700-15","moneda":"MXN","precio":2200.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"juego","categoria":"Accesorios","origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":2200,"ajustePct":0,"precioAplicado":2200.0,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-CAMA-CONTROL","codigo":"MX-CAMA-CONTROL","nombre":"Control de freno","moneda":"MXN","precio":3000.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"pza","categoria":"Accesorios","origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":3000,"ajustePct":0,"precioAplicado":3000.0,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1},{"id":"MX-CAMA-PORTA","codigo":"MX-CAMA-PORTA","nombre":"Porta extra","moneda":"MXN","precio":800.0,"basePrecio":"con_iva","ivaPct":16,"unidad":"pza","categoria":"Accesorios","origen":{"archivo":"18742905-86b9-443a-8f04-de684b70e041.png","fechaLista":"2024-02-02","precioLista":800,"ajustePct":0,"precioAplicado":800.0,"nota":"Importes con IVA incluido, confirmado por el usuario."},"_revision":1}],"ensambles":[]};

// === INTERFAZ DE MODELOS, PIEZAS Y ENSAMBLES ===
function ECInput({ label, value, onChange, type = 'text', ...props }) {
  return <label className="ec-field"><span>{label}</span><input type={type} value={value ?? ''} onChange={e => onChange(e.target.value)} {...props} /></label>;
}
function ECSelect({ label, value, onChange, children, ...props }) {
  return <label className="ec-field"><span>{label}</span><select value={value} onChange={e => onChange(e.target.value)} {...props}>{children}</select></label>;
}
function ECResumen({ calculo: c, solicitud: s, id = 'BORRADOR', vendedor = '' }) {
  if (!c.ok) return <div className="ec-empty" role="status"><strong>Completa la cotización</strong><p>{c.error}</p></div>;
  const dinero = n => ecMoneda(n / 100, c.moneda);
  const baseIva = c.modelo.basePrecio === 'con_iva' ? 'IVA incluido' : 'antes de IVA';
  return <article className="ec-ticket">
    <div className="ec-ticket-head"><strong>AMACSA</strong><span>COTIZACIÓN · {id}</span></div>
    <h2>{c.modelo.nombre}</h2>
    <p>{s.cliente || 'Cliente por capturar'}{s.telefono ? ` · ${s.telefono}` : ''}</p>
    <p className="ec-muted">Fecha: {s.fecha}{s.entrega ? ` · Entrega: ${s.entrega}` : ''}{vendedor ? ` · ${vendedor}` : ''}</p>
    <p>{c.modelo.medidas} · {c.modelo.capacidad}</p>
    <p className="ec-specs">{c.modelo.especificaciones}</p>
    <div className="ec-line"><span>Precio por remolque ({baseIva})</span><strong>{dinero(c.baseUnitariaCentavos)}</strong></div>
    {!!c.incluidos.length && <details><summary>Ensambles incluidos por remolque</summary><ul>{c.incluidos.map(l => <li key={l.id}>{l.cantidad} × {l.nombre}{c.modelo.modoPrecio === 'ensambles' ? ` — ${dinero(l.importeCentavos)}` : ''}
      {!!l.componentes.length && <span className="ec-muted ec-block">{l.componentes.map(p => `${p.cantidad} ${p.unidad} ${p.nombre}`).join('; ')}</span>}
    </li>)}</ul></details>}
    {!!c.extras.length && <div className="ec-extra-summary"><h3>Adicionales por remolque</h3>{c.extras.map(l => <div className="ec-line" key={l.clase + l.id}><span>{l.cantidad} × {l.nombre}{l.unidad ? ` (${l.unidad})` : ''}</span><strong>{dinero(l.importeCentavos)}</strong></div>)}</div>}
    <div className="ec-totals">
      <div className="ec-line"><span>{c.cantidad} remolque(s) · {baseIva}</span><strong>{dinero(c.baseCentavos)}</strong></div>
      <div className="ec-line"><span>Adicionales · {baseIva}</span><strong>{dinero(c.extrasCentavos)}</strong></div>
      {c.descuentoPct > 0 && <div className="ec-line"><span>Descuento en remolques ({c.descuentoPct}%)</span><strong>− {dinero(c.descuentoCentavos)}</strong></div>}
      <div className="ec-line"><span>Subtotal sin IVA</span><strong>{dinero(c.subtotalCentavos)}</strong></div>
      <div className="ec-line"><span>IVA {c.ivaPct}% {c.modelo.basePrecio === 'con_iva' ? '(incluido)' : ''}</span><strong>{dinero(c.ivaCentavos)}</strong></div>
      <div className="ec-line ec-total"><span>Total</span><strong>{dinero(c.totalCentavos)}</strong></div>
      <div className="ec-line"><span>Anticipo</span><strong>{dinero(c.anticipoCentavos)}</strong></div>
      <div className="ec-line"><span>Saldo pendiente</span><strong>{dinero(c.saldoCentavos)}</strong></div>
    </div>
    {s.notas && <p className="ec-specs"><strong>Observaciones: </strong>{s.notas}</p>}
  </article>;
}
function ecCrearPdf(snapshot) {
  const { calculo: c, solicitud: s } = snapshot;
  if (!c.ok) throw new Error(c.error);
  const pdf = new jsPDF('p', 'mm', 'a4');
  const dinero = n => ecMoneda(n / 100, c.moneda);
  let y = 20;
  const cabecera = () => {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(19); pdf.setTextColor(20, 83, 45);
    pdf.text('AMACSA', 17, 18); pdf.setFontSize(10); pdf.setTextColor(30, 41, 59);
    pdf.text('COTIZACION ' + snapshot.id, 17, 25); y = 34;
  };
  const texto = (contenido, negrita = false) => {
    pdf.setFont('helvetica', negrita ? 'bold' : 'normal'); pdf.setFontSize(10);
    const limpio = String(contenido || '').replace(/[^\x20-\xFF\n]/g, ' ');
    const lineas = pdf.splitTextToSize(limpio, 174);
    for (const linea of lineas) {
      if (y > 276) { pdf.addPage(); cabecera(); }
      pdf.text(linea, 17, y); y += 5;
    }
    y += 2;
  };
  cabecera();
  texto(c.modelo.nombre, true); texto(`Cliente: ${s.cliente || 'Mostrador'} | Tel.: ${s.telefono || ''}`);
  texto(`Fecha: ${s.fecha} | Vendedor: ${snapshot.vendedor || ''}`);
  if (s.entrega) texto(`Entrega prevista: ${s.entrega}`);
  texto(`Medidas: ${c.modelo.medidas} | Capacidad: ${c.modelo.capacidad}`); texto(c.modelo.especificaciones);
  texto(`Precio por remolque: ${dinero(c.baseUnitariaCentavos)} (${c.modelo.basePrecio === 'con_iva' ? 'IVA incluido' : 'antes de IVA'})`, true);
  if (c.incluidos.length) {
    texto('Ensambles incluidos por remolque:', true);
    c.incluidos.forEach(l => texto(`${l.cantidad} x ${l.nombre}${c.modelo.modoPrecio === 'ensambles' ? ': ' + dinero(l.importeCentavos) : ''}`));
  }
  if (c.extras.length) {
    texto('Adicionales por remolque:', true);
    c.extras.forEach(l => texto(`${l.cantidad} x ${l.nombre}${l.unidad ? ' (' + l.unidad + ')' : ''}: ${dinero(l.importeCentavos)}`));
  }
  texto(`Cantidad: ${c.cantidad} remolque(s).`, true);
  texto(`Remolques: ${dinero(c.baseCentavos)} | Adicionales: ${dinero(c.extrasCentavos)}`);
  if (c.descuentoPct) texto(`Descuento sobre remolques (${c.descuentoPct}%): -${dinero(c.descuentoCentavos)}`);
  texto(`Subtotal sin IVA: ${dinero(c.subtotalCentavos)}`);
  texto(`IVA ${c.ivaPct}%${c.modelo.basePrecio === 'con_iva' ? ' (incluido)' : ''}: ${dinero(c.ivaCentavos)}`);
  texto(`TOTAL: ${dinero(c.totalCentavos)}`, true);
  texto(`Anticipo: ${dinero(c.anticipoCentavos)} | Saldo pendiente: ${dinero(c.saldoCentavos)}`, true);
  if (s.notas) { texto('Observaciones:', true); texto(s.notas); }
  for (let pagina = 1; pagina <= pdf.getNumberOfPages(); pagina++) {
    pdf.setPage(pagina); pdf.setFontSize(8); pdf.setTextColor(100);
    pdf.text(`AMACSA | ${snapshot.id} | ${pagina} / ${pdf.getNumberOfPages()}`, 17, 289);
  }
  return pdf;
}

function ECEditor({ cat, seccion, inicial, onGuardar, onCancelar, busy }) {
  const [item, setItem] = useState(() => ecCopia(inicial));
  const modificar = (campo, valor) => setItem(prev => ({ ...prev, [campo]: valor }));
  const mismaBase = i => i.moneda === item.moneda && i.basePrecio === item.basePrecio && Number(i.ivaPct) === Number(item.ivaPct);
  const piezas = cat.piezas.filter(mismaBase);
  const ensambles = cat.ensambles.filter(mismaBase);
  const referencias = [...piezas.map(p => ({...p, clase:'pieza'})), ...ensambles.map(e => ({...e, clase:'ensamble'}))];
  const cambiarLinea = (campo, index, valor) => modificar(campo, item[campo].map((l,i) => i === index ? { ...l, ...valor } : l));
  const quitarLinea = (campo,index) => modificar(campo,item[campo].filter((_,i) => i !== index));
  let vistaPrecio;
  try {
    if (seccion === 'piezas') vistaPrecio = ecMoneda(ecCentavos(item.precio) / 100,item.moneda);
    else if (seccion === 'ensambles') vistaPrecio = ecMoneda(ecResolverEnsamble({...cat,ensambles:[item,...cat.ensambles.filter(e => e.id !== item.id)]},item.id,item.moneda).centavos / 100,item.moneda);
    else {
      const resultado=ecCalcular({...cat,modelos:[item,...cat.modelos.filter(m => m.id !== item.id)]},ecSolicitud(item));
      vistaPrecio = resultado.ok ? ecMoneda(resultado.baseUnitariaCentavos / 100,item.moneda) : resultado.error;
    }
  } catch(error) { vistaPrecio=error.message; }
  return <form className="ec-card" onSubmit={e => { e.preventDefault(); onGuardar(item); }}>
    <div className="ec-row"><h2>{cat[seccion].some(i => i.id === item.id) ? 'Editar' : 'Nuevo'} {seccion === 'piezas' ? 'registro de pieza' : seccion === 'ensambles' ? 'ensamble' : 'modelo'}</h2><button type="button" onClick={onCancelar} disabled={busy}>Cerrar</button></div>
    <fieldset disabled={busy}>
      <div className="ec-grid">
        <ECInput label="Código único" value={item.codigo} onChange={v => modificar('codigo',v)} required />
        <ECInput label="Nombre" value={item.nombre} onChange={v => modificar('nombre',v)} required />
        <ECSelect label="Moneda" value={item.moneda} onChange={v => modificar('moneda',v)}><option value="MXN">Pesos mexicanos (MXN)</option><option value="USD">Dólares (USD)</option></ECSelect>
        <ECSelect label="Tratamiento del precio" value={item.basePrecio} onChange={v => modificar('basePrecio',v)}><option value="con_iva">El precio ya incluye IVA</option><option value="sin_iva">Agregar IVA al precio</option></ECSelect>
        <ECInput label="Tasa de IVA (%)" type="number" min="0" max="100" step="0.0001" value={item.ivaPct} onChange={v => modificar('ivaPct',v)} required />
        {seccion !== 'modelos' && <ECSelect label="Categoría" value={item.categoria} onChange={v => modificar('categoria',v)}>{EC_CATEGORIAS.map(c => <option key={c}>{c}</option>)}</ECSelect>}
        {seccion === 'piezas' && <ECInput label="Unidad (pza, metro, juego, hora…)" value={item.unidad} onChange={v => modificar('unidad',v)} required />}
        {seccion !== 'piezas' && <ECSelect label="Cómo se define el precio" value={item.modoPrecio} onChange={v => modificar('modoPrecio',v)}><option value="fijo">Precio fijo definido</option><option value={seccion === 'modelos' ? 'ensambles' : 'componentes'}>{seccion === 'modelos' ? 'Sumar ensambles incluidos' : 'Sumar piezas del ensamble'}</option></ECSelect>}
        {(seccion === 'piezas' || item.modoPrecio === 'fijo') && <ECInput label={`Precio de venta ${item.basePrecio === 'con_iva' ? 'con IVA' : 'sin IVA'}`} type="number" min="0" step="0.01" placeholder="Pendiente de precio" value={item.precio} onChange={v => modificar('precio',v === '' ? null : v)} />}
      </div>
      <p className="ec-hint">Usa precios de venta completos. Un precio vacío queda pendiente; cero significa que el concepto es gratuito.</p>
      {item.origen && <div className="ec-source">Referencia de captura: lista del {item.origen.fechaLista}. Precio original: {ecMoneda(item.origen.precioLista,item.moneda)}{item.origen.ajustePct ? ` · Aumento inicial: ${item.origen.ajustePct}% · Importe aplicado: ${ecMoneda(item.origen.precioAplicado,item.moneda)}.` : '.'}</div>}
      {seccion === 'modelos' && <>
        <div className="ec-grid">
          <ECSelect label="Tipo de remolque" value={item.tipo} onChange={v => modificar('tipo',v)}>{Object.entries(EC_TIPOS).map(([v,n]) => <option key={v} value={v}>{n}</option>)}</ECSelect>
          <ECInput label="Medidas (ancho × largo)" value={item.medidas} onChange={v => modificar('medidas',v)} placeholder={'82 pulgadas × 16 pies'} />
          <ECInput label="Capacidad" value={item.capacidad} onChange={v => modificar('capacidad',v)} placeholder="6 ton" />
        </div>
        <label className="ec-field"><span>Características incluidas en el precio</span><textarea rows="3" value={item.especificaciones} onChange={e => modificar('especificaciones',e.target.value)} /></label>
      </>}
      {seccion === 'ensambles' && <section className="ec-composition">
        <h3>Piezas por ensamble</h3><p className="ec-hint">Ejemplo: largueros + travesaños + placas para formar un chasis. Puedes registrar mano de obra como una pieza con unidad “hora”.</p>
        {item.modoPrecio === 'fijo' && <p className="ec-hint">La composición es informativa: el precio fijo ya cubre estas piezas.</p>}
        {item.componentes.map((l,i) => <div className="ec-item" key={i}>
          <ECSelect label="Pieza" value={l.piezaId} onChange={v => cambiarLinea('componentes',i,{piezaId:v})}><option value="">Seleccionar pieza</option>{piezas.map(p => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre} ({p.unidad})</option>)}</ECSelect>
          <ECInput label="Cantidad" type="number" min="0.0001" step="0.0001" value={l.cantidad} onChange={v => cambiarLinea('componentes',i,{cantidad:v})} />
          <button type="button" onClick={() => quitarLinea('componentes',i)} aria-label={`Quitar pieza ${i+1}`}>Quitar</button>
        </div>)}
        <button type="button" onClick={() => modificar('componentes',[...item.componentes,{piezaId:'',cantidad:1}])} disabled={!piezas.length}>+ Agregar pieza</button>
        {!piezas.length && <p className="ec-hint">Primero registra piezas en la misma moneda y con el mismo tratamiento de IVA.</p>}
      </section>}
      {seccion === 'modelos' && <>
        <section className="ec-composition"><h3>Ensambles incluidos por remolque</h3>
          <p className="ec-hint">{item.modoPrecio === 'fijo' ? 'El precio fijo ya incluye estos ensambles; no se suman otra vez.' : 'El precio del remolque será la suma de estos ensambles por sus cantidades.'}</p>
          {item.ensambles.map((l,i) => <div className="ec-item" key={i}>
            <ECSelect label="Ensamble" value={l.ensambleId} onChange={v => cambiarLinea('ensambles',i,{ensambleId:v})}><option value="">Seleccionar ensamble</option>{ensambles.map(e => <option key={e.id} value={e.id}>{e.codigo} · {e.nombre}</option>)}</ECSelect>
            <ECInput label="Cantidad" type="number" min="0.0001" step="0.0001" value={l.cantidad} onChange={v => cambiarLinea('ensambles',i,{cantidad:v})} />
            <button type="button" onClick={() => quitarLinea('ensambles',i)}>Quitar</button>
          </div>)}
          <button type="button" onClick={() => modificar('ensambles',[...item.ensambles,{ensambleId:'',cantidad:1}])} disabled={!ensambles.length}>+ Agregar ensamble</button>
          {!ensambles.length && <p className="ec-hint">Registra ensambles para seleccionarlos aquí. Un modelo con precio fijo también funciona sin desglosar ensambles.</p>}
        </section>
        <section className="ec-composition"><h3>Adicionales que ventas puede cotizar</h3><p className="ec-hint">Agrega únicamente opciones compatibles con este modelo. Las cantidades se capturan al cotizar.</p>
          {item.adicionales.map((l,i) => <div className="ec-item ec-item-simple" key={i}>
            <ECSelect label="Adicional permitido" value={ecClaveRef(l)} onChange={v => { const p = referencias.find(r => `${r.clase}:${r.id}` === v); cambiarLinea('adicionales',i,{clase:p?.clase || 'pieza',itemId:p?.id || ''}); }}><option value="pieza:">Seleccionar adicional</option>{referencias.map(r => <option key={r.clase+r.id} value={`${r.clase}:${r.id}`}>{r.clase} · {r.codigo} · {r.nombre}</option>)}</ECSelect>
            <button type="button" onClick={() => quitarLinea('adicionales',i)}>Quitar</button>
          </div>)}
          <button type="button" onClick={() => modificar('adicionales',[...item.adicionales,{clase:'pieza',itemId:''}])} disabled={!referencias.length}>+ Autorizar adicional</button>
        </section>
      </>}
      <p className="ec-price-preview"><strong>Precio por unidad: </strong>{vistaPrecio}</p>
      <div className="ec-actions"><button type="submit" className="ec-primary">{busy ? 'Guardando…' : 'Guardar registro'}</button><button type="button" onClick={onCancelar}>Cancelar</button></div>
    </fieldset>
  </form>;
}

function CotizadorEnsambles({ db, currentUser, onGuardarRegistro, onEliminarRegistro, onGuardarCotizacion, carga }) {
  const cat = ecCatalogo(db);
  const [tab,setTab] = useState('cotizar');
  const [tipo,setTipo] = useState('cama_baja');
  const [medida,setMedida] = useState('');
  const [capacidad,setCapacidad] = useState('');
  const [solicitud,setSolicitud] = useState(ecSolicitud);
  const [guardada,setGuardada] = useState(null);
  const [editor,setEditor] = useState(null);
  const [busqueda,setBusqueda] = useState('');
  const [filtroAdmin,setFiltroAdmin] = useState('');
  const [busy,setBusy] = useState(false);
  const [mensaje,setMensaje] = useState(null);
  const [eliminar,setEliminar] = useState(null);
  const esAdmin = currentUser?.role === 'admin';
  const cargar = (snapshot, modo) => {
    setTab('cotizar'); setEditor(null); setMensaje(null);
    setTipo(snapshot.calculo.modelo.tipo); setMedida(''); setCapacidad('');
    if (modo === 'ver') { setGuardada(ecCopia(snapshot)); setSolicitud(ecCopia(snapshot.solicitud)); }
    else { setGuardada(null); setSolicitud({...ecCopia(snapshot.solicitud),fecha:ecFecha(),anticipo:0}); setMensaje({texto:'Copia nueva con los precios actuales del catálogo. Revisa los importes antes de guardar.',error:false}); }
  };
  useEffect(() => { if (carga?.snapshot) cargar(carga.snapshot,carga.modo); },[carga]);
  const ejecutar = async accion => {
    if (busy) return;
    setBusy(true); setMensaje(null);
    try { await accion(); } catch(error) { setMensaje({texto:error.message || 'No se pudo guardar. Intenta de nuevo.',error:true}); }
    finally { setBusy(false); }
  };
  const editarSolicitud = (campo,valor) => { setGuardada(null); setSolicitud(prev => ({...prev,[campo]:valor})); };
  const limpiarModelo = () => { setGuardada(null); setSolicitud(prev => ({...prev,modeloId:'',extras:[],anticipo:0})); };
  const modelo = cat.modelos.find(m => m.id === solicitud.modeloId);
  const calculo = guardada?.calculo || ecCalcular(cat,solicitud);
  const s = guardada?.solicitud || solicitud;
  const modelosTipo = cat.modelos.filter(m => m.tipo === tipo);
  const medidas = [...new Set(modelosTipo.map(m => m.medidas))];
  const capacidades = [...new Set(modelosTipo.filter(m => !medida || m.medidas === medida).map(m => m.capacidad))];
  const modelos = modelosTipo.filter(m => (!medida || m.medidas === medida) && (!capacidad || m.capacidad === capacidad));
  const referencia = l => (l.clase === 'pieza' ? cat.piezas : cat.ensambles).find(i => i.id === l.itemId);
  const extrasDisponibles = (modelo?.adicionales || []).filter(l => !(solicitud.extras || []).some(e => ecClaveRef(e) === ecClaveRef(l)));
  const abrirTab = t => { if (busy) return; if (editor && !window.confirm('Hay un registro abierto. ¿Descartar sus cambios sin guardar?')) return; setTab(t);setEditor(null);setEliminar(null);setBusqueda('');setFiltroAdmin('');setMensaje(null); };
  const registros = tab === 'cotizar' ? [] : cat[tab].filter(i => `${i.codigo} ${i.nombre} ${i.medidas || ''}`.toLocaleLowerCase('es').includes(busqueda.toLocaleLowerCase('es')) && (tab !== 'modelos' || !filtroAdmin || i.tipo === filtroAdmin));
  const nueva = () => {setGuardada(null);setSolicitud(ecSolicitud());setMensaje(null);setTipo('cama_baja');setMedida('');setCapacidad('');};
  return <main className="ec-app">
    <style>{EC_CSS}</style>
    <div className="ec-top"><div><span className="ec-eyebrow">AMACSA · PRECIOS DE MÉXICO</span><h1>Modelos y ensambles</h1><p>Selecciona el remolque y agrega las opciones que necesita tu cliente.</p></div><div className="ec-badge">MXN · Listas con IVA incluido</div></div>
    <nav className="ec-tabs" aria-label="Cotización y catálogos">
      <button aria-current={tab === 'cotizar' ? 'page' : undefined} onClick={() => abrirTab('cotizar')}>Cotizar</button>
      {esAdmin && <><button aria-current={tab === 'modelos' ? 'page' : undefined} onClick={() => abrirTab('modelos')}>Modelos ({cat.modelos.length})</button><button aria-current={tab === 'ensambles' ? 'page' : undefined} onClick={() => abrirTab('ensambles')}>Ensambles ({cat.ensambles.length})</button><button aria-current={tab === 'piezas' ? 'page' : undefined} onClick={() => abrirTab('piezas')}>Piezas y accesorios ({cat.piezas.length})</button></>}
    </nav>
    {mensaje && <div role={mensaje.error ? 'alert' : 'status'} className={`ec-message ${mensaje.error ? 'ec-error' : ''}`}>{mensaje.texto}<button aria-label="Cerrar aviso" onClick={() => setMensaje(null)}>×</button></div>}
    {tab === 'cotizar' ? <div className="ec-columns">
      <div className="ec-card">
        <div className="ec-row"><h2>{guardada ? 'Cotización guardada' : 'Preparar cotización'}</h2><button onClick={nueva} disabled={busy}>Nueva</button></div>
        <fieldset disabled={busy}>
        {guardada ? <div className="ec-source"><p>Folio: <strong>{guardada.id}</strong></p><p>Este documento conserva los precios, cantidades y características guardados.</p><button disabled={busy} onClick={() => cargar(guardada,'duplicar')}>Duplicar con precios actuales</button></div> : <>
          <div className="ec-grid">
            <ECSelect label="Tipo de remolque" value={tipo} onChange={v => {setTipo(v);setMedida('');setCapacidad('');limpiarModelo();}}>{Object.entries(EC_TIPOS).map(([v,n]) => <option key={v} value={v}>{n}</option>)}</ECSelect>
            <ECSelect label="Medida" value={medida} onChange={v => {setMedida(v);setCapacidad('');limpiarModelo();}}><option value="">Todas las medidas</option>{medidas.map(m => <option key={m}>{m}</option>)}</ECSelect>
            <ECSelect label="Capacidad" value={capacidad} onChange={v => {setCapacidad(v);limpiarModelo();}}><option value="">Todas las capacidades</option>{capacidades.map(c => <option key={c}>{c}</option>)}</ECSelect>
          </div>
          <ECSelect label="Modelo y configuración" value={solicitud.modeloId} onChange={id => { const m=cat.modelos.find(x => x.id===id);setSolicitud(prev => ({...prev,modeloId:id,ivaPct:m?.ivaPct ?? 16,extras:[],anticipo:0})); }}><option value="">Seleccionar modelo</option>{modelos.map(m => <option key={m.id} value={m.id}>{m.nombre}{m.modoPrecio === 'fijo' ? ` · ${ecMoneda(m.precio,m.moneda)}` : ' · Por ensambles'}</option>)}</ECSelect>
          {!modelos.length && <p className="ec-hint">No hay modelos para esta selección. Un administrador puede registrarlos en Modelos.</p>}
          {modelo && <div className="ec-source"><strong>{modelo.modoPrecio === 'fijo' ? 'Precio fijo + adicionales' : 'Suma de ensambles + adicionales'}</strong><p>{modelo.especificaciones}</p><p>{modelo.moneda} · {modelo.basePrecio === 'con_iva' ? 'IVA incluido' : 'IVA por agregar'} ({modelo.ivaPct}%).</p>{modelo.origen && <p>Lista del {modelo.origen.fechaLista}{modelo.origen.ajustePct ? ` · Aumento aplicado: ${modelo.origen.ajustePct}%` : ''}.</p>}</div>}
          <h3>Cliente y cantidades</h3>
          <div className="ec-grid">
            <ECInput label="Cliente" value={s.cliente} onChange={v => editarSolicitud('cliente',v)} />
            <ECInput label="Teléfono" type="tel" value={s.telefono} onChange={v => editarSolicitud('telefono',v)} />
            <ECInput label="Fecha de cotización" type="date" value={s.fecha} onChange={v => editarSolicitud('fecha',v)} />
            <ECInput label="Entrega prevista" type="date" value={s.entrega} onChange={v => editarSolicitud('entrega',v)} />
            <ECInput label="Cantidad de remolques" type="number" min="1" max="1000" step="1" value={s.cantidad} onChange={v => editarSolicitud('cantidad',v)} />
            <ECInput label="Descuento solo en remolques (%)" type="number" min="0" max="100" step="0.01" value={s.descuentoPct} onChange={v => editarSolicitud('descuentoPct',v)} />
            <ECInput label={`Anticipo (${modelo?.moneda || 'MXN'})`} type="number" min="0" step="0.01" value={s.anticipo} onChange={v => editarSolicitud('anticipo',v)} />
          </div>
          <h3>Adicionales por remolque</h3><p className="ec-hint">Cada cantidad se multiplica por el número de remolques. El modelo ya incluye las características de su ficha.</p>
          {s.extras.map((l,i) => <div className="ec-item ec-extra" key={ecClaveRef(l)}><div><strong>{referencia(l)?.nombre || 'Adicional no disponible'}</strong><span className="ec-block ec-muted">Unidad: {referencia(l)?.unidad || 'ensamble'}</span></div><ECInput label="Cantidad" type="number" min="0.0001" step="0.0001" value={l.cantidad} onChange={v => editarSolicitud('extras',s.extras.map((e,n) => n===i ? {...e,cantidad:v} : e))} /><button onClick={() => editarSolicitud('extras',s.extras.filter((_,n) => n!==i))}>Quitar</button></div>)}
          <ECSelect label="Agregar una opción" value="" disabled={!extrasDisponibles.length} onChange={v => { const l=extrasDisponibles.find(e => ecClaveRef(e)===v);if(l) editarSolicitud('extras',[...s.extras,{...l,cantidad:1}]); }}><option value="">{extrasDisponibles.length ? 'Seleccionar adicional' : 'Sin más adicionales autorizados'}</option>{extrasDisponibles.map(l => <option key={ecClaveRef(l)} value={ecClaveRef(l)}>{referencia(l)?.nombre || 'Registro no disponible'}{l.clase === 'pieza' ? ` · ${ecMoneda(referencia(l)?.precio,modelo?.moneda)}` : ''}</option>)}</ECSelect>
          <label className="ec-field"><span>Observaciones y condiciones</span><textarea value={s.notas} rows="3" onChange={e => editarSolicitud('notas',e.target.value)} /></label>
        </>}
        <div className="ec-actions">
          {!guardada && <button className="ec-primary" disabled={busy || !calculo.ok || !s.cliente.trim()} onClick={() => ejecutar(async () => { const snapshot=ecSnapshot(s,calculo,currentUser?.name || 'Ventas'); await onGuardarCotizacion(snapshot);setGuardada(snapshot);setMensaje({texto:`Cotización ${snapshot.id} guardada.`,error:false}); })}>{busy ? 'Guardando…' : 'Guardar cotización'}</button>}
          <button disabled={busy || !calculo.ok || !s.cliente.trim()} onClick={() => ejecutar(async () => {const snapshot=guardada || ecSnapshot(s,calculo,currentUser?.name || 'Ventas','BORRADOR');ecCrearPdf(snapshot).save(`Cotizacion-${snapshot.id}.pdf`);})}>Descargar PDF</button>
        </div>
        </fieldset>
      </div>
      <ECResumen calculo={calculo} solicitud={s} id={guardada?.id} vendedor={guardada?.vendedor || currentUser?.name} />
    </div> : esAdmin && <>
      {editor ? <ECEditor key={editor.id} cat={cat} seccion={tab} inicial={editor} busy={busy} onCancelar={() => setEditor(null)} onGuardar={item => ejecutar(async () => {await onGuardarRegistro(tab,ecValidarRegistro(cat,tab,item));setEditor(null);setMensaje({texto:'Registro guardado. Las nuevas cotizaciones usarán este precio.',error:false});})} /> : <div className="ec-card">
        <div className="ec-row"><h2>{tab === 'modelos' ? 'Modelos de remolque' : tab === 'ensambles' ? 'Ensambles reutilizables' : 'Piezas y accesorios'}</h2><button className="ec-primary" onClick={() => setEditor(ecRegistroNuevo(tab))}>+ Nuevo registro</button></div>
        {tab === 'ensambles' && <p className="ec-hint">Define chasis, jalones, rodados o paquetes de luces. Puedes asignar un precio fijo o sumar sus piezas; después inclúyelos en tus modelos.</p>}
        <div className="ec-grid"><ECInput label="Buscar por código o nombre" value={busqueda} onChange={setBusqueda} type="search" />{tab === 'modelos' && <ECSelect label="Tipo de remolque" value={filtroAdmin} onChange={setFiltroAdmin}><option value="">Todos</option>{Object.entries(EC_TIPOS).map(([v,n]) => <option key={v} value={v}>{n}</option>)}</ECSelect>}</div>
        <div className="ec-table-scroll"><table><thead><tr><th>Código / nombre</th><th>Precio de venta</th><th>IVA</th><th>Acciones</th></tr></thead><tbody>
          {registros.map(item => {let precio=item.precio;let error='';try{if(tab==='ensambles') precio=ecResolverEnsamble(cat,item.id,item.moneda).centavos/100;else if(tab==='modelos'){const c=ecCalcular(cat,ecSolicitud(item));if(!c.ok)throw new Error(c.error);precio=c.baseUnitariaCentavos/100;}}catch(e){error=e.message;}return <tr key={item.id}><td><strong>{item.nombre}</strong><span className="ec-muted ec-block">{item.codigo}</span></td><td>{error ? <span title={error}>Pendiente de completar</span> : ecMoneda(precio,item.moneda)}</td><td>{item.basePrecio === 'con_iva' ? 'Incluido' : 'Por agregar'} {item.ivaPct}%</td><td><div className="ec-actions"><button disabled={busy} onClick={() => setEditor(ecCopia(item))}>Editar</button><button disabled={busy} onClick={() => {const copia={...ecCopia(item),id:ecId(tab),codigo:item.codigo+'-COPIA',nombre:item.nombre+' (copia)',_revision:0};delete copia.origen;setEditor(copia);}}>Duplicar</button><button disabled={busy} onClick={() => setEliminar(item)}>Eliminar</button></div></td></tr>;})}
          {!registros.length && <tr><td colSpan="4" className="ec-empty">No hay registros para esta selección.</td></tr>}
        </tbody></table></div>
      </div>}
      {eliminar && <div className="ec-message ec-error" role="alert"><div><strong>Eliminar {eliminar.nombre}</strong><p>Si forma parte de un ensamble o modelo, primero tendrás que retirar esa referencia.</p><div className="ec-actions"><button disabled={busy} onClick={() => ejecutar(async () => {await onEliminarRegistro(tab,eliminar);setEliminar(null);setMensaje({texto:'Registro eliminado.',error:false});})}>Confirmar eliminación</button><button disabled={busy} onClick={() => setEliminar(null)}>Cancelar</button></div></div></div>}
    </>}
  </main>;
}
const EC_CSS = `
 .ec-app{max-width:1440px;margin:0 auto;padding:26px 24px 60px;color:#182a25;font-size:16px;line-height:1.5}
 .ec-app *{box-sizing:border-box}.ec-app h1{font-size:30px;line-height:1.15;font-weight:800;margin:6px 0 10px;letter-spacing:-.5px}.ec-app h2{font-size:21px;font-weight:800;margin:0 0 14px;line-height:1.3}.ec-app h3{font-size:17px;font-weight:750;margin:22px 0 10px}.ec-app p{margin:6px 0 12px}
 .ec-top,.ec-row{display:flex;justify-content:space-between;align-items:center;gap:18px}.ec-eyebrow{font-size:12px;font-weight:800;letter-spacing:1.2px;color:#206344}.ec-badge{font-size:14px;background:#dcfce7;color:#14532d;border:1px solid #86efac;padding:10px 14px;border-radius:8px;white-space:nowrap}.ec-top p{color:#475569}.ec-tabs{display:flex;gap:6px;overflow-x:auto;border-bottom:1px solid #cbd5e1;margin:18px 0 24px;padding-bottom:10px}
 .ec-app button{border:1px solid #b6c9c0;background:white;padding:9px 13px;border-radius:7px;font-weight:700;font-size:14px;cursor:pointer;line-height:1.4}.ec-app button:hover{background:#effaf3}.ec-app button:disabled{opacity:.45;cursor:not-allowed}.ec-app button:focus-visible,.ec-app input:focus-visible,.ec-app select:focus-visible,.ec-app textarea:focus-visible{outline:3px solid #15803d;outline-offset:2px}.ec-app .ec-primary,.ec-tabs button[aria-current]{background:#166534;color:white;border-color:#166534}.ec-tabs button{white-space:nowrap}
 .ec-columns{display:grid;grid-template-columns:minmax(0,1.12fr) minmax(0,.88fr);gap:24px;align-items:start}.ec-card,.ec-ticket{background:white;border:1px solid #d2ded8;border-radius:12px;padding:24px;min-width:0}.ec-ticket{border-top:5px solid #166534}.ec-ticket-head{display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;margin-bottom:24px;color:#166534}.ec-ticket-head strong{font-size:25px;letter-spacing:1px}.ec-ticket-head span{font-size:12px;overflow-wrap:anywhere}
 .ec-field{display:flex;flex-direction:column;gap:5px;margin:0 0 15px;min-width:0}.ec-field>span{font-size:14px;font-weight:650;color:#334f43}.ec-field input,.ec-field select,.ec-field textarea{background:white;border:1px solid #b4c6bc;border-radius:7px;padding:10px 11px;font-size:16px;font-family:inherit;line-height:1.4;min-width:0;width:100%;color:#162c20}.ec-field textarea{resize:vertical}.ec-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 16px}.ec-app fieldset{border:0;padding:0;margin:0;min-width:0}
 .ec-hint,.ec-muted{font-size:14px;color:#5a6c62}.ec-block{display:block}.ec-source{background:#f2f8f5;border-left:3px solid #86bca0;padding:12px 15px;margin:14px 0 22px;font-size:14px}.ec-source p:last-child{margin-bottom:0}.ec-specs{white-space:pre-wrap;overflow-wrap:anywhere}.ec-composition{border-top:1px solid #d4e2da;margin-top:18px;padding-bottom:14px}.ec-item{display:grid;grid-template-columns:minmax(0,1fr) 110px auto;gap:12px;align-items:end;margin:12px 0}.ec-item .ec-field{margin:0}.ec-item-simple{grid-template-columns:minmax(0,1fr) auto}.ec-extra{padding:12px 0;border-bottom:1px solid #e3ece6}.ec-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.ec-row{margin-bottom:16px}.ec-row h2{margin:0}.ec-price-preview{background:#e9f5ed;padding:14px;border-radius:8px;overflow-wrap:anywhere}
 .ec-line{display:flex;justify-content:space-between;gap:15px;padding:8px 0;font-size:14px}.ec-line>span{min-width:0;overflow-wrap:anywhere}.ec-line strong{white-space:nowrap;align-self:flex-end}.ec-totals{border-top:2px solid #c5d8cc;margin-top:22px;padding-top:10px}.ec-total{color:#14532d;font-size:23px;border-top:1px solid #ceded4;margin-top:10px}.ec-app details{margin:14px 0;font-size:14px}.ec-app summary{cursor:pointer;font-weight:700}.ec-app details ul{padding-left:18px;list-style:disc}.ec-app details li{margin-top:10px}.ec-table-scroll{overflow:auto;max-height:65vh}.ec-app table{width:100%;text-align:left;border-collapse:collapse;font-size:14px}.ec-app th{position:sticky;top:0;background:#eaf3ed;z-index:1}.ec-app th,.ec-app td{padding:13px 12px;border-bottom:1px solid #dae6de;vertical-align:top}.ec-app td .ec-actions{margin:0;min-width:235px}
 .ec-message{display:flex;justify-content:space-between;gap:16px;margin:16px 0;padding:16px;border:1px solid #94c9aa;background:#edfaf2;border-radius:8px}.ec-error{border-color:#eab7ae;background:#fff2ef;color:#862c22}.ec-empty{padding:40px 24px;text-align:center;color:#53665a;background:#fff;border:1px dashed #c2d3c8;border-radius:12px}
 @media(max-width:1000px){.ec-columns{grid-template-columns:1fr}.ec-top{align-items:flex-start;flex-direction:column}.ec-badge{white-space:normal}}
 @media(max-width:600px){.ec-app{padding:18px 12px 40px}.ec-card,.ec-ticket{padding:18px}.ec-grid{grid-template-columns:1fr}.ec-item{grid-template-columns:1fr 90px}.ec-item>button{grid-column:1/-1}.ec-item-simple{grid-template-columns:1fr}.ec-line{flex-wrap:wrap;gap:4px 12px}.ec-line strong{margin-left:auto}.ec-row{align-items:flex-start;flex-wrap:wrap}}
 @media print{.ec-app .ec-top,.ec-app .ec-tabs,.ec-app .ec-card,.ec-app .ec-message{display:none!important}.ec-app,.ec-columns{display:block!important;padding:0!important}.ec-ticket{border:0!important;padding:0!important}.ec-ticket details{display:none}.ec-ticket-head,.ec-total{color:#111!important}}
`;
// === FIN DE LA INTERFAZ DE ENSAMBLES ===

// --- 1. CONFIGURACIÓN DE LA NUBE (FIREBASE) ---
const LOCAL_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDO5iOAOrdEs1xCG6QyV1nGatkvQReclsQ",
  authDomain: "cotizador-amacsa-usa.firebaseapp.com",
  projectId: "cotizador-amacsa-usa",
  storageBucket: "cotizador-amacsa-usa.firebasestorage.app",
  messagingSenderId: "837899744434",
  appId: "1:837899744434:web:71616353308f5d2394c5ab",
  measurementId: "G-Z3Y1FDQZ48"
};

const envConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const firebaseConfig = envConfig || LOCAL_FIREBASE_CONFIG;
const isFirebaseConfigured = Object.keys(firebaseConfig).length > 0 && !!firebaseConfig.apiKey;

let app, auth, db_fs, storage;
if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db_fs = getFirestore(app);
  storage = getStorage(app);
}

// Lógica inteligente para rutas de Firebase independientemente del entorno
const appId = typeof __app_id !== 'undefined' ? __app_id : 'amacsa-usa-app';
const isWorkspacePath = appId.includes('/');
const getDocPath = (docName) => {
    return isWorkspacePath 
        ? `artifacts/${appId}/public/data/${docName}` 
        : `artifacts/${appId}/public/data/store/${docName}`;
};

const PRECIO_LITRO_BODY = 250;
const PRECIO_LITRO_PINTURA = 180;

// --- DICCIONARIO DE REGLAS ---
  const CAMA_BAJA_COMBOS = {
    '50in': ['7ft', '90in', '8ft'],
    '60in': ['10ft', '11ft', '12ft', '13ft', '14ft', '15ft', '16ft'],
    '72in': ['10ft', '11ft', '12ft', '13ft', '14ft', '15ft', '16ft'],
    '75in': ['10ft', '11ft', '12ft', '13ft', '14ft', '15ft', '16ft'],
    '76in': ['10ft', '11ft', '12ft', '13ft', '14ft', '15ft', '16ft', '17ft', '18ft'],
    '82in': ['10ft', '11ft', '12ft', '13ft', '14ft', '15ft', '16ft', '17ft', '18ft', '19ft', '20ft'],
    '84in': ['10ft', '11ft', '12ft', '13ft', '14ft', '15ft', '16ft', '17ft', '18ft', '19ft', '20ft']
  };

  const CAMA_ALTA_LARGOS = ['16ft', '18ft', '20ft', '22ft', '24ft', '26ft', '28ft', '30ft', '32ft', '40ft', '42ft'];
  const CAMA_ALTA_CAPS = ['6t', '7t', '9t', '10t'];
  
  const VOLTEO_COMBOS = {
    '60in': ['10ft', '11ft', '12ft', '13ft', '14ft'],
    '76in': ['10ft', '11ft', '12ft', '13ft', '14ft', '15ft', '16ft'],
    '82in': ['10ft', '11ft', '12ft', '13ft', '14ft', '15ft', '16ft']
  };

const getCapacidadesCamaBaja = (anchoId, largoId) => {
  let caps = [];
  if (anchoId === '50in') caps.push('850kg');
  else if (anchoId === '60in') caps.push('1_5t', '3t', '6t');
  else if (anchoId === '84in') caps.push('3t', '6t');
  else if (['72in', '75in', '76in', '82in'].includes(anchoId)) {
    caps.push('3t', '6t');
    // Aquí agregamos el 11ft y 13ft para que no desaparezca la opción de 1.5 Ton
    if (['10ft', '11ft', '12ft', '13ft', '14ft'].includes(largoId)) caps.push('1_5t');
    if (['75in', '76in'].includes(anchoId)) caps.push('4t');
  }
  return caps.length > 0 ? caps : ['3t'];
};
// --- BASE DE DATOS MAESTRA ---
const DEFAULT_DB = {
  // Se cargan una vez. No se reinsertan registros eliminados en sincronizaciones posteriores.
  piezasCotizacion: EC_PRECIOS_MEXICO.piezas,
  ensamblesCotizacion: EC_PRECIOS_MEXICO.ensambles,
  modelosCotizacion: EC_PRECIOS_MEXICO.modelos,
  largos: [
    { id: '7ft', nombre: '7 Pies', valor: 7, precio: 0 },
    { id: '90in', nombre: '90 Pulgadas (7.5\')', valor: 7.5, precio: 0 },
    { id: '8ft', nombre: '8 Pies', valor: 8, precio: 0 },
    { id: '10ft', nombre: '10 Pies', valor: 10, precio: -10000 },
    { id: '12ft', nombre: '12 Pies', valor: 12, precio: -5000 },
    { id: '14ft', nombre: '14 Pies', valor: 14, precio: -2000 },
    { id: '16ft', nombre: '16 Pies', valor: 16, precio: 0 },
    { id: '17ft', nombre: '17 Pies', valor: 17, precio: 6000 },
    { id: '18ft', nombre: '18 Pies', valor: 18, precio: 12000 },
    { id: '20ft', nombre: '20 Pies', valor: 20, precio: 24000 },
    { id: '22ft', nombre: '22 Pies', valor: 22, precio: 36000 },
    { id: '23ft', nombre: '23 Pies', valor: 23, precio: 42000 },
    { id: '24ft', nombre: '24 Pies', valor: 24, precio: 48000 },
    { id: '26ft', nombre: '26 Pies', valor: 26, precio: 60000 },
    { id: '28ft', nombre: '28 Pies', valor: 28, precio: 72000 },
    { id: '32ft', nombre: '32 Pies', valor: 32, precio: 96000 },
    { id: '36ft', nombre: '36 Pies', valor: 36, precio: 120000 },
    { id: '40ft', nombre: '40 Pies', valor: 40, precio: 144000 },
    { id: '42ft', nombre: '42 Pies', valor: 42, precio: 156000 },
    { id: '44ft', nombre: '44 Pies', valor: 44, precio: 168000 }
  ],
  anchos: [
    { id: '50in', nombre: '50 Pulgadas', valor: 50, precio: -12000 },
    { id: '60in', nombre: '60 Pulgadas (5\')', valor: 60, precio: -8000 },
    { id: '72in', nombre: '72 Pulgadas (6\')', valor: 72, precio: -4000 },
    { id: '75in', nombre: '75 Pulgadas', valor: 75, precio: -3000 },
    { id: '76in', nombre: '76 Pulgadas', valor: 76, precio: -2500 },
    { id: '78in', nombre: '78 Pulgadas (6.5\')', valor: 78, precio: -2000 },
    { id: '82in', nombre: '82 Pulgadas', valor: 82, precio: -1000 },
    { id: '84in', nombre: '84 Pulgadas (7\')', valor: 84, precio: 0 },
    { id: '96in', nombre: '96 Pulgadas (8\')', valor: 96, precio: 8500 }
  ],
  capacidades: [
    // Ligeros (Si cobras menos por estos, pon el número en negativo, ej: -3000)
    { id: '850kg', nombre: '850 Kg (1 Eje Ligero)', precio: -6000 }, // <--- REVISAR/CAMBIAR
    { id: '1_5t', nombre: '1.5 Ton (1 Eje)', precio: -3000 },        // <--- REVISAR/CAMBIAR
    { id: '2t_5200', nombre: '2 Ton (1 Eje 5,200 lbs)', precio: -1500 },
    { id: '2t_6200', nombre: '2 Ton (1 Eje 6,200 lbs)', precio: -500 },
    
    // Estándar (Este déjalo en 0, es la base)
    { id: '3t', nombre: '3 Ton (1 o 2 Ejes 3,500 lbs)', precio: 0 }, 
    
    // Pesados (Pon exactamente cuánto extra cobras por subir a estos ejes)
    { id: '4t_5200', nombre: '4 Ton (2 Ejes 5,200 lbs)', precio: 6000 },  // <--- CAMBIAR AQUÍ
    { id: '4t_6200', nombre: '4 Ton (2 Ejes 6,200 lbs)', precio: 7500 },  // <--- CAMBIAR AQUÍ
    { id: '6t', nombre: '6 Ton (2 Ejes 7,000 lbs)', precio: 14500 },      // <--- CAMBIAR AQUÍ
    { id: '7t', nombre: '7 Ton (2 Ejes 8,000 lbs)', precio: 22000 },      // <--- CAMBIAR AQUÍ
    { id: '9t', nombre: '9 Ton (3 Ejes 7,000 lbs)', precio: 34000 },      // <--- CAMBIAR AQUÍ
    { id: '10t', nombre: '10 Ton (2 Ejes 10k lbs ó 3 Ejes 8k lbs)', precio: 48000 } // <--- CAMBIAR AQUÍ
  ],
  suspension: [
    { id: 'susp_1_5t', nombre: 'Kit Suspensión 1.5 Ton', precio: -1000 },
    { id: 'susp_3t', nombre: 'Kit Suspensión 3/4 Ton', precio: 0 },
    { id: 'susp_6t', nombre: 'Kit Suspensión 6 Ton', precio: 2000 },
    { id: 'muelle', nombre: 'Muelle Estándar (Ganadero/Cama Alta)', precio: 0 },
    { id: 'muelle_drop', nombre: 'Muelles Drop', precio: 1500 },
    { id: 'torflex', nombre: 'Sistema Torflex', precio: 4500 }
  ],
  llantas: [
    { id: 'ninguna', nombre: 'Sin Llantas (Sin rodado)', precio: -12000, precioExtra: 0 },
    { id: '700_15', nombre: '700R15', precio: -3500, precioExtra: 2500 },
    { id: '225_75_15', nombre: '225/75 R15', precio: -2000, precioExtra: 3000 },
    { id: '235_80_16', nombre: 'ST235/80R16', precio: -2500, precioExtra: 3500 },
    { id: '16in_10', nombre: 'ST235/80R16 10 Lonas', precio: -2500, precioExtra: 3500 },
    { id: '16in_14', nombre: 'ST235/80R16 14 Lonas', precio: 0, precioExtra: 4500 },
    { id: '235_80_16_14', nombre: 'ST235/80R16 14 Lonas', precio: 0, precioExtra: 4500 },
    { id: '17_5in', nombre: 'Radial 17.5', precio: 12000, precioExtra: 7500 }
  ],
  redilas: [
    { id: 'sin_redila', nombre: 'Sin Redila (Plataforma)', precio: -3000 },
    { id: 'ptr_abierta_2', nombre: 'Abierta 2 Pies', precio: 0 },
    { id: 'ptr_abierta_3', nombre: 'Abierta 3 Pies', precio: 2000 },
    { id: 'ptr_abierta_4', nombre: 'Abierta 4 Pies', precio: 4000 },
    { id: 'cerrada_2', nombre: 'Cerrada 2 Pies', precio: 3000 },
    { id: 'cerrada_3', nombre: 'Cerrada 3 Pies', precio: 6000 },
    { id: 'cerrada_4', nombre: 'Cerrada 4 Pies', precio: 9000 },
    { id: 'ptr_abierta', nombre: 'PTR Abierta (Ganadero)', precio: 0 },
    { id: 'cerrada', nombre: 'Cerrada (Ganadero)', precio: 18500 },
    { id: 'combinada', nombre: 'Redila Combinada', precio: 10000 },
    { id: 'desmontable', nombre: 'Redila Desmontable', precio: 12000 }
  ],
  pisos: [
    { id: 'madera', nombre: 'Madera (Fórmula LxAx2)', precioSqFt: 35 },
    { id: 'duela_laminada', nombre: 'Duela Laminada', precioSqFt: 55 },
    { id: 'hule_liso', nombre: 'Tablones de Hule Liso', precioSqFt: 85 },
    { id: 'hule_anti', nombre: 'Tablones de Hule Antiderrapante', precioSqFt: 110 },
    { id: 'lamina_madera', nombre: 'Lámina C.14 Antiderrapante c/Madera', precioSqFt: 65 }
  ],
  puertasInteriores: [
    { id: 'fija', nombre: 'Fija', precio: 0 },
    { id: 'corrediza', nombre: 'Corrediza', precio: 3800 },
    { id: 'abatible', nombre: 'Abatible', precio: 3500 },
    { id: 'diagonal', nombre: 'Diagonal', precio: 2500 }
  ],
  puertasTraseras: [
    { id: 'fija', nombre: 'Fija', precio: 0 },
    { id: 'libro', nombre: 'De Libro (2 Hojas)', precio: 3500 },
    { id: 'corrediza', nombre: 'Corrediza', precio: 4500 }
  ],
  techos: [
    { id: 'sin_techo', nombre: 'Sin Techo', precio: 0 },
    { id: 'medio', nombre: 'Medio Techo', precio: 8500 },
    { id: 'media_especial', nombre: 'Media Especial', precio: 9500 },
    { id: 'tres_cuartos', nombre: 'Techo 3/4', precio: 11500 },
    { id: 'completo', nombre: 'Techo Completo', precio: 14500 }
  ],
  jalones: [
    { id: 'ganso_normal', nombre: 'Cuello de Ganso Normal', tipo: 'ganso', precio: -3500 },
    { id: 'ganso_facil', nombre: 'Cuello Ganso Enganche Fácil', tipo: 'ganso', precio: 0 },
    { id: 'bumper_2', nombre: 'Bumper Pull Reforzado 2"', tipo: 'bumper', precio: -4500 },
    { id: 'bumper_2_516', nombre: 'Bumper Pull Reforzado 2" 5/16', tipo: 'bumper', precio: -4000 },
    { id: 'bumper_ajustable_2', nombre: 'Bumper Pull Ajustable 2"', tipo: 'bumper', precio: -2500 },
    { id: 'bumper_ajustable_2_516', nombre: 'Bumper Pull Ajustable 2" 5/16', tipo: 'bumper', precio: -2000 },
    { id: 'argolla', nombre: 'Jalón Argolla', tipo: 'bumper', precio: -1500 }
  ],
  gatos: [
    { id: 'tubo_2k', nombre: 'Gato Tubo Corto 2,000 lbs', precio: -1500 },
    { id: 'normal_2k', nombre: 'Gato Normal 2,000 lbs', precio: 0 },
    { id: 'manual_7k', nombre: 'Gato Manual 7,000 lbs', precio: 1500 },
    { id: 'manual_12k', nombre: 'Gato Manual 12,000 lbs', precio: 3500 },
    { id: 'manual', nombre: 'Gato Manual (Ganadero)', precio: 0 },
    { id: 'hidraulico_sencillo', nombre: 'Gato Hidráulico (Sin Bomba)', precio: 6500 },
    { id: 'hidraulico_bomba', nombre: 'Gato Hidráulico c/Bomba Integrada', precio: 12500 }
  ],
  cadenas: [
    { id: 'ganso_38', nombre: 'Cadena Seguridad Ganso 3/8 x 35"', precio: 0 },
    { id: 'seguridad_14', nombre: 'Cadena Seguridad 1/4 x 54"', precio: 0 }
  ],
  montureros: [
    { id: 'ninguno', nombre: 'Sin Monturero', precio: 0 },
    { id: 'recto_3', nombre: 'Recto (3 Pies)', precio: 5500 },
    { id: 'recto_4', nombre: 'Recto (4 Pies)', precio: 6800 },
    { id: 'diagonal', nombre: 'Diagonal', precio: 8500 }
  ],
  pinturas: [
    { id: 'liquida', nombre: 'Pintura Líquida', precio: 0 },
    { id: 'polvo', nombre: 'Pintura en Polvo (Powder Coating)', precio: 18000 }
  ],
  luces: [
    { id: 'estandar_usa', nombre: 'Luces LED Estándar USA', precio: 0 },
    { id: 'especial_usa', nombre: 'Paquete Especial USA (Full LED)', precio: 4500 },
    { id: 'estandar_mexico', nombre: 'Luces LED Estándar México', precio: 0 },
    { id: 'especial_mexico', nombre: 'Paquete Especial México (Full LED)', precio: 4500 }
  ],
  colores: [
    { id: 'gris', nombre: 'Gris Grafito', hex: '#374151' },
    { id: 'negro', nombre: 'Negro Mate', hex: '#111827' },
    { id: 'rojo', nombre: 'Rojo Carmesí', hex: '#991B1B' },
    { id: 'azul', nombre: 'Azul Marino', hex: '#1E3A8A' },
    { id: 'blanco', nombre: 'Blanco Puro', hex: '#F9FAFB' }
  ],
  rampas: [
    { id: 'ninguna', nombre: 'Sin Rampas', precio: 0 },
    { id: 'rampa_1_5m', nombre: 'Rampas 1.5m (Plataforma)', precio: 3500 },
    { id: 'rampa_39', nombre: 'Rampas 39 7/8" (C/ Redila)', precio: 4500 },
    { id: 'puerta_rampa', nombre: 'Puerta Rampa Trasera', precio: 6500 },
    { id: 'recto_rampas', nombre: 'Recto con Rampas (Cama Alta)', precio: 4500 },
    { id: 'cola_4', nombre: 'Cola de Pato 4\' con Rampas', precio: 6500 },
    { id: 'cola_5', nombre: 'Cola de Pato 5\' con Rampas', precio: 8500 }
  ],
  preciosFijos: [],
  extras: [
    { id: 'luzOvalo', nombre: 'Luz Óvalo Roja (Unidad)', precio: 350 },
    { id: 'luzOvaloAmbar', nombre: 'Luz Óvalo Ámbar (Unidad)', precio: 350 },
    { id: 'luzTresCuartosRoja', nombre: 'Luz 3/4" Roja (Unidad)', precio: 85 },
    { id: 'luzTresCuartosAmbar', nombre: 'Luz 3/4" Ámbar (Unidad)', precio: 85 },
    { id: 'luzDosPulgadasRoja', nombre: 'Luz 2" Roja (Unidad)', precio: 120 },
    { id: 'luzDosPulgadasAmbar', nombre: 'Luz 2" Ámbar (Unidad)', precio: 120 },
    { id: 'precioPieExtra', nombre: 'Precio por Pie Extra (Medidas Especiales)', precio: 2500 },
    { id: 'precioBase', nombre: 'Precio Base del Remolque', precio: 95000 },
    { id: 'precioPieExtra', nombre: 'Precio por Pie Extra (Medidas Especiales)', precio: 2500 },
    { id: 'precioBase', nombre: 'Precio Base del Remolque', precio: 95000 },
    { id: 'frenos', nombre: 'Frenos Eléctricos (Por Eje)', precio: 6800 },
    { id: 'portaExtra', nombre: 'Porta Extra (Unidad)', precio: 1200 },
    { id: 'cargadorSolar', nombre: 'Cargador Solar', precio: 2500 },
    { id: 'cargador110', nombre: 'Cargador 110v', precio: 1500 },
    { id: 'sujetaCadenas', nombre: 'Sujeta Cadenas', precio: 450 },
    { id: 'frenteCachucha', nombre: 'Frente: Cachucha', precio: 6500 },
    { id: 'frenteCanasta', nombre: 'Frente: Canasta', precio: 8500 },
    { id: 'hojaPlexiglass', nombre: 'Hoja de Plexiglass (4x8)', precio: 2500 }, 
    { id: 'rackPacas', nombre: 'Rack para Pacas', precio: 12000 },
    { id: 'ventEst', nombre: 'Ventilación Estándar (Unidad)', precio: 2000 },
    { id: 'ventCirc', nombre: 'Ventilación Circular (Unidad)', precio: 3500 },
    { id: 'polverasEspeciales', nombre: 'Polveras Especiales USA', precio: 3500 },
    { id: 'puertaPerroCachucha', nombre: 'Puerta Perro Frontal', precio: 1800 },
    { id: 'puertaPerroLateral', nombre: 'Puerta Perro Lateral', precio: 1800 },
    { id: 'basesMontura', nombre: 'Base Montura (Extra)', precio: 250 },
    { id: 'tubosCobija', nombre: 'Tubo Cobija (Extra)', precio: 150 },
    { id: 'cajaHtasStd', nombre: 'Caja Htas Estándar', precio: 5500 },
    { id: 'cajaHtasGrande', nombre: 'Caja Htas Grande Aluminio', precio: 8500 },
    { id: 'lucesInteriores', nombre: 'Luces Interiores (Unidad)', precio: 500 },
    { id: 'litroBody', nombre: 'Precio Litro de Body', precio: 250 },
    { id: 'litroPintura', nombre: 'Precio Litro de Pintura', precio: 180 },
    { id: 'fenderReforzado', nombre: 'Fender Reforzado', precio: 1500 },
    { id: 'luzPortaplaca', nombre: 'Luz Portaplaca', precio: 350 },
    { id: 'aperturaEstribo', nombre: 'Apertura para Estribo', precio: 1500 },
    { id: 'aperturaLimpieza', nombre: 'Apertura para Limpieza', precio: 1000 }
  ],
  modelosLinea: []
};

const DEFAULT_USERS = [
  { id: 'u1', username: 'admin', password: 'adminamacsa', role: 'admin', name: 'Administrador Principal' },
  { id: 'u2', username: 'ventas', password: 'amacsa2026', role: 'sales', name: 'Equipo de Ventas' }
];

const ADMIN_SECTIONS = [
  { id: 'preciosFijos', title: 'Tabulador Precios Base (Por Tipo y Medida)', isTabulador: true },
  { id: 'preciosTechos', title: 'Matriz Precios: Techos', isMatrizTecho: true },
  { id: 'preciosPisos', title: 'Matriz Precios: Pisos', isMatrizPiso: true },
  //{ id: 'largos', title: 'Largos Disponibles', hasValor: true, valorLabel: 'Largo (Pies)' },
  //{ id: 'anchos', title: 'Anchos y Costo por Pie Extra', hasValor: true, valorLabel: 'Ancho (In)' },
  { id: 'capacidades', title: 'Configuraciones de Carga (Ejes)' },
  { id: 'llantas', title: 'Tipos de Llantas', hasPrecioExtra: true },
  { id: 'redilas', title: 'Tipos de Redila' },
  { id: 'rampas', title: 'Rampas y Puertas Traseras' },
  { id: 'pisos', title: 'Materiales de Piso (Precio base)', isPiso: true },
  { id: 'puertasInteriores', title: 'Puertas Interiores (Ganadero)' },
  { id: 'puertasTraseras', title: 'Puertas Traseras (Ganadero)' },
  { id: 'techos', title: 'Opciones de Techo' },
  { id: 'jalones', title: 'Tipos de Jalones', isJalon: true },
  { id: 'gatos', title: 'Gatos Hidráulicos y Manuales' },
  { id: 'cadenas', title: 'Cadenas de Seguridad' },
  { id: 'montureros', title: 'Estilos de Monturero' },
  { id: 'suspension', title: 'Sistemas de Suspensión' },
  { id: 'luces', title: 'Paquetes de Luces' },
  { id: 'colores', title: 'Colores de Remolque', isColor: true },
  { id: 'extras', title: 'Accesorios y Extras (Fijos)', isFixed: true },
  { id: 'modelosLinea', title: 'Modelos de Línea (Estándar)', isCatalog: true }
];

const ADMIN_PASSWORD = "adminamacsa";

export default function App() {
  if (!isFirebaseConfigured) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 font-sans">
        <div className="bg-white p-8 rounded-2xl max-w-2xl text-center shadow-2xl">
           <Database className="w-16 h-16 text-red-500 mx-auto mb-4" />
           <h1 className="text-2xl font-black text-slate-800 mb-4">¡Falta Conectar la Nube!</h1>
           <p className="text-slate-600 font-medium mb-6">Pega tus llaves de Firebase en Visual Studio Code.</p>
        </div>
      </div>
    );
  }
  return <CotizadorNube />;
}

function CotizadorNube() {
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [isCloudLoaded, setIsCloudLoaded] = useState(false);
  const [isAuthenticated, setIsAuth] = useState(() => localStorage.getItem('amacsa_auth') === 'true' || sessionStorage.getItem('amacsa_auth') === 'true');
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');
  const [folio, setFolio] = useState('');
  const [fechaCotizacion, setFechaCotizacion] = useState(new Date().toISOString().split('T')[0]);
  const [fechaEntrega, setFechaEntrega] = useState('');
  const [db, setDb] = useState(DEFAULT_DB);
  const [users, setUsers] = useState(DEFAULT_USERS);
  const [logs, setLogs] = useState([]);
  const [cotizaciones, setCotizaciones] = useState([]);
  const [esHojaDiseno, setEsHojaDiseno] = useState(false);
  const [currentUser, setCurrentUser] = useState(() => {
    try { const saved = localStorage.getItem('amacsa_current_user') || sessionStorage.getItem('amacsa_current_user'); return saved ? JSON.parse(saved) : null; }
    catch { return null; }
  });
  const [rememberMe, setRememberMe] = useState(false);

  const [profileForm, setProfileForm] = useState({ name: '', username: '', password: '' });

  const [view, setView] = useState('ensambles');
  const [cargaEnsambles, setCargaEnsambles] = useState(null);
  const [adminSection, setAdminSection] = useState('cotizaciones');
  const [adminTrailerTab, setAdminTrailerTab] = useState('gen');
  const [activeTab, setActiveTab] = useState('cotizacion');
  const [usarLargoCustom, setUsarLargoCustom] = useState(false);
  const [largoCustom, setLargoCustom] = useState('');
  
  const [market, setMarket] = useState('usa'); 
  const [tipoRemolque, setTipoRemolque] = useState('ganadero');
  const [isSpecialClient, setIsSpecialClient] = useState(true);
  const [tipoGanadero, setTipoGanadero] = useState('ganso');
  const [isAppUnlocked, setIsAppUnlocked] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', username: '', password: '', role: 'sales' });
  const [notification, setNotification] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [adminUnlockPrompt, setAdminUnlockPrompt] = useState(false);
  const [adminUnlockPass, setAdminUnlockPass] = useState('');
  const [mostrarExtras, setMostrarExtras] = useState(false);
  const [isGeneratingIA, setIsGeneratingIA] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const handleImageUpload = async (e, section, index) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setNotification({ type: 'error', message: 'Por favor, selecciona un archivo de imagen válido.' });
      return;
    }
    setUploadingImage(true);
    try {
      const fileRef = ref(storage, `catalogo/${Date.now()}_${file.name}`);
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);
      handleDbChange(section, index, 'foto', url);
      setNotification({ type: 'success', message: '¡Imagen subida correctamente a la nube!' });
    } catch (error) {
      console.error("Error al subir la imagen:", error);
      setNotification({ type: 'error', message: 'Error al subir. Verifica los permisos de Storage en Firebase.' });
    } finally {
      setUploadingImage(false);
    }
  };
  // ESTADOS PRINCIPALES
  const [cliente, setCliente] = useState({ nombre: '', telefono: '', anticipo: 0, descuentoPct: 0, descuentoExtraPct: 0, ajusteRedondeo: 0, cantidad: 1 });
  const [dim, setDim] = useState({ largo: '20ft', ancho: '84in' });
  const [acople, setAcople] = useState({ jalon: 'ganso_facil', cadena: 'ganso_38', sujetaCadenas: true, gato: 'manual', cantGatos: 1, cargadorSolar: false, cargador110: false });
  const [rodado, setRodado] = useState({ capacidad: '6t', suspension: 'torflex', llanta: '16in_14', cantFrenos: 2, llantaExtra: 0, portaExtra: 1, cantEjesGanso: 2 });
  const [carroceria, setCarroceria] = useState({ techo: 'completo', frente: 'cachucha', redila: 'ptr_abierta', puertasIntList: [{id: Date.now(), tipo: 'fija', distancia: 84}], puertaTras: 'libro', puertaPiloto: true, puertaPilotoAncho: 40, plexiglass: false, rackPacas: false, ventEst: false, ventCirc: false, polverasEspeciales: false, puertaPerroCachucha: false, aperturaEstribo: false, aperturaLimpieza: false });
  const [monturero, setMonturero] = useState({ tipo: 'ninguno', basesMontura: 3, tubosCobija: 1, puertaPerro: false, paredLarga: 85.5, paredCorta: 40 });
  const [acabados, setAcabados] = useState({ piso: 'madera', pintura: 'polvo', mismoColorTecho: false, color: 'gris', luces: 'estandar_usa', bodyLitros: 0, pinturaLitros: 0, techoLitros: 0, cajasPolvo: 0, cajaHtas: 'ninguna', cajaHtasLargo: 40 });
  const [accesorios, setAccesorios] = useState({ lucesInteriores: 0, ovaloRojo: 0, ovaloAmbar: 0, tresCuartosRojo: 0, tresCuartosAmbar: 0, dosPulgadasRojo: 0, dosPulgadasAmbar: 0, luzPortaplaca: false });
  const [extrasCustom, setExtrasCustom] = useState([]); 
  const [inputExtra, setInputExtra] = useState({ nombre: '', precio: '' });  
  const [precioManual, setPrecioManual] = useState('');  
  const [camaBajaOpts, setCamaBajaOpts] = useState({ rampas: 'ninguna', fenderReforzado: false, ovaloRojo: 0, tresCuartosRojo: 0, tresCuartosAmbar: 0, luzPortaplaca: false });
  const [volteoOpts, setVolteoOpts] = useState({ sistemaElevacion: 'hidraulico', puertaTrasera: 'libro', fenderReforzado: false, luzPortaplaca: false });
    
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else { await signInAnonymously(auth); }
      } catch (err) { console.error("Auth init error:", err); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setFirebaseUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!firebaseUser) return;
    const catalogRef = doc(db_fs, getDocPath('catalog'));
    const usersRef = doc(db_fs, getDocPath('users'));
    const logsRef = doc(db_fs, getDocPath('logs'));
    const cotizacionesRef = doc(db_fs, getDocPath('cotizaciones'));

    let loadedFlags = { catalog: false, users: false, logs: false, cotizaciones: false };
    const checkLoaded = () => { if(loadedFlags.catalog && loadedFlags.users && loadedFlags.logs && loadedFlags.cotizaciones) setIsCloudLoaded(true); };

    const unsubCatalog = onSnapshot(catalogRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        let updated = false;
        Object.keys(DEFAULT_DB).forEach(key => {
            if (!data[key]) { data[key] = DEFAULT_DB[key]; updated = true; } 
            else if (!Object.values(EC_SECCIONES).includes(key)) {
                DEFAULT_DB[key].forEach(defaultItem => {
                    if (!data[key].find(item => item.id === defaultItem.id)) { data[key].push(defaultItem); updated = true; }
                });
            }
        });
        if (updated) setDoc(catalogRef, data); 
        setDb(data); 
      } else { setDoc(catalogRef, DEFAULT_DB); }
      loadedFlags.catalog = true; checkLoaded();
    }, (e) => console.error("Error Sincronizando Catálogo", e));

    const unsubUsers = onSnapshot(usersRef, (docSnap) => {
      if (docSnap.exists()) { setUsers(docSnap.data().list || []); } 
      else { setDoc(usersRef, { list: DEFAULT_USERS }); }
      loadedFlags.users = true; checkLoaded();
    }, (e) => console.error("Error Sincronizando Usuarios", e));

    const unsubLogs = onSnapshot(logsRef, (docSnap) => {
       if (docSnap.exists()) { setLogs(docSnap.data().list || []); } 
       else { setDoc(logsRef, { list: [] }); }
       loadedFlags.logs = true; checkLoaded();
    }, (e) => console.error("Error Sincronizando Bitácora", e));

    const unsubCotizaciones = onSnapshot(cotizacionesRef, (docSnap) => {
       if (docSnap.exists()) { setCotizaciones(docSnap.data().list || []); } 
       else { setDoc(cotizacionesRef, { list: [] }); }
       loadedFlags.cotizaciones = true; checkLoaded();
    }, (e) => console.error("Error Sincronizando Cotizaciones", e));

    return () => { unsubCatalog(); unsubUsers(); unsubLogs(); unsubCotizaciones(); };
  }, [firebaseUser]);

  useEffect(() => { 
    if (currentUser) {
      if (localStorage.getItem('amacsa_auth') === 'true') {
        localStorage.setItem('amacsa_current_user', JSON.stringify(currentUser));
      } else {
        sessionStorage.setItem('amacsa_current_user', JSON.stringify(currentUser));
      }
      setProfileForm({ name: currentUser.name, username: currentUser.username, password: currentUser.password });
    } else { 
      localStorage.removeItem('amacsa_current_user'); 
      sessionStorage.removeItem('amacsa_current_user');
    }
  }, [currentUser]);

  const logAction = (actionDescription) => {
    const newLog = { id: Date.now() + Math.random(), date: new Date().toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'medium' }), user: currentUser?.name || 'Sistema', action: actionDescription };
    const updatedLogs = [newLog, ...logs].slice(0, 500);
    setLogs(updatedLogs); setDoc(doc(db_fs, getDocPath('logs')), { list: updatedLogs });
  };


  // Catálogos nuevos: una transacción por registro, con detección de ediciones concurrentes.
  const handleGuardarRegistroEnsambles = async (seccion, item) => {
    if (currentUser?.role !== 'admin') throw new Error('Solo un administrador puede modificar estos catálogos.');
    const campo = EC_SECCIONES[seccion];
    if (!campo) throw new Error('Catálogo no válido.');
    await runTransaction(db_fs, async transaction => {
      const catalogRef = doc(db_fs, getDocPath('catalog'));
      const snap = await transaction.get(catalogRef);
      if (!snap.exists()) throw new Error('El catálogo aún no está disponible.');
      const actual = snap.data();
      const cat = ecCatalogo(actual);
      const anterior = cat[seccion].find(r => r.id === item.id);
      if (anterior && (anterior._revision || 0) !== (item._revision || 0)) throw new Error('Otra persona cambió este registro. Cierra el editor y vuelve a abrirlo para tomar la versión actual.');
      if (!anterior && (item._revision || 0) > 0) throw new Error('El registro fue eliminado por otra persona.');
      const validado = ecValidarRegistro(cat,seccion,item);
      validado._revision = (anterior?._revision || 0) + 1;
      validado.actualizadoEn = new Date().toISOString();
      const registros = anterior ? cat[seccion].map(r => r.id === item.id ? validado : r) : [...cat[seccion],validado];
      const siguiente = {...cat,[seccion]:registros};
      // No permitir un cambio de moneda/IVA que rompa recetas ya registradas.
      if (seccion === 'piezas') siguiente.ensambles.filter(e => e.componentes.some(l => l.piezaId === item.id)).forEach(e => ecValidarRegistro(siguiente,'ensambles',e));
      if (seccion !== 'modelos') siguiente.modelos.filter(m => (seccion === 'ensambles' && m.ensambles.some(l => l.ensambleId === item.id)) || m.adicionales.some(l => l.clase === (seccion === 'piezas' ? 'pieza' : 'ensamble') && l.itemId === item.id)).forEach(m => ecValidarRegistro(siguiente,'modelos',m));
      transaction.set(catalogRef,{[campo]:registros},{merge:true});
    });
  };
  const handleEliminarRegistroEnsambles = async (seccion, item) => {
    if (currentUser?.role !== 'admin') throw new Error('Solo un administrador puede eliminar registros.');
    const campo = EC_SECCIONES[seccion];
    if (!campo) throw new Error('Catálogo no válido.');
    await runTransaction(db_fs, async transaction => {
      const catalogRef = doc(db_fs,getDocPath('catalog'));
      const snap = await transaction.get(catalogRef);
      if (!snap.exists()) throw new Error('No se encontró el catálogo.');
      const cat = ecCatalogo(snap.data());
      const actual = cat[seccion].find(r => r.id === item.id);
      if (actual && (actual._revision || 0) !== (item._revision || 0)) throw new Error('El registro cambió. Revisa su versión actual antes de eliminarlo.');
      const referencias = ecDependencias(cat,seccion,item.id);
      if (referencias.length) throw new Error('Este registro se utiliza en: ' + referencias.join(', ') + '. Retira esas referencias antes de eliminarlo.');
      transaction.set(catalogRef,{[campo]:cat[seccion].filter(r => r.id !== item.id)},{merge:true});
    });
  };
  const handleGuardarCotizacionEnsambles = async snapshot => {
    // El detalle se guarda en su propio documento. El historial solo guarda el índice.
    // Así no crece el documento único del historial con todas las recetas y precios.
    await runTransaction(db_fs, async transaction => {
      const historyRef = doc(db_fs,getDocPath('cotizaciones'));
      const quoteRef = doc(db_fs,getDocPath('ensamble_' + snapshot.id));
      const history = await transaction.get(historyRef);
      const quote = await transaction.get(quoteRef);
      if (quote.exists()) return; // Reintento del mismo folio: no duplicar.
      const c = snapshot.calculo;
      const registro = {
        id:snapshot.id,fecha:snapshot.solicitud.fecha,cliente:snapshot.solicitud.cliente,
        telefono:snapshot.solicitud.telefono || 'N/A',remolque:c.modelo.nombre,
        medida:c.modelo.medidas,total:ecMoneda(c.totalCentavos/100,c.moneda),
        totalNumerico:c.totalCentavos/100,moneda:c.moneda,vendedor:snapshot.vendedor,
        pdfUrl:null,config:{modoCotizacion:'ensambles',ensambleId:snapshot.id}
      };
      transaction.set(quoteRef,snapshot);
      transaction.set(historyRef,{list:[registro,...(history.exists() ? history.data().list || [] : [])].slice(0,200)},{merge:true});
    });
  };
  const handleAbrirCotizacionEnsambles = async (cot, modo) => {
    try {
      const snapshot = await getDoc(doc(db_fs,getDocPath('ensamble_' + cot.config.ensambleId)));
      if (!snapshot.exists()) throw new Error('No se encontró el detalle guardado de esta cotización.');
      const data = snapshot.data();
      if (data.schemaVersion !== 1 || !data.calculo?.ok) throw new Error('La cotización guardada no tiene un formato válido.');
      setCargaEnsambles({token:ecId('abrir'),snapshot:data,modo});
      setView('ensambles');
    } catch(error) { setNotification({type:'error',message:error.message}); }
  };

  const handleDbChange = (section, index, field, value) => {
    const newDb = { ...db }; newDb[section][index][field] = value; setDb(newDb); setDoc(doc(db_fs, getDocPath('catalog')), newDb);
  };

  const handleDbAdd = (section) => {
    const newDb = { ...db }; const baseItem = { id: `item_${Date.now()}`, nombre: 'Nuevo Elemento', precio: 0 };
    const sectionDef = ADMIN_SECTIONS.find(s => s.id === section);
    if (sectionDef?.hasValor) baseItem.valor = 0;
    if (sectionDef?.isPiso) { baseItem.precioSqFt = 0; delete baseItem.precio; }
    if (sectionDef?.isColor) { baseItem.hex = '#000000'; delete baseItem.precio; }
    if (sectionDef?.hasPrecioExtra) { baseItem.precioExtra = 0; }
    if (sectionDef?.isJalon) { baseItem.tipo = 'ganso'; }
    newDb[section] = [...(newDb[section] || []), baseItem];
    setDb(newDb); setDoc(doc(db_fs, getDocPath('catalog')), newDb);
  };

  const executeConfirm = async () => {
    if (!confirmDialog) return;
    if (confirmDialog.action === 'DELETE_DB_ITEM') {
        const { section, index } = confirmDialog.payload; const newDb = { ...db }; newDb[section].splice(index, 1);
        setDb(newDb); setDoc(doc(db_fs, getDocPath('catalog')), newDb);
    } else if (confirmDialog.action === 'DELETE_COTIZACION') {
        const { id } = confirmDialog.payload;
        const cotizacion = cotizaciones.find(c => c.id === id);
        try {
          await runTransaction(db_fs, async transaction => {
            const historyRef = doc(db_fs,getDocPath('cotizaciones'));
            const snap = await transaction.get(historyRef);
            const lista = snap.exists() ? snap.data().list || [] : [];
            const actual = lista.find(c => c.id === id) || cotizacion;
            if (actual?.config?.modoCotizacion === 'ensambles') transaction.delete(doc(db_fs,getDocPath('ensamble_' + actual.config.ensambleId)));
            transaction.set(historyRef,{list:lista.filter(c => c.id !== id)},{merge:true});
          });
          logAction(`Eliminó la cotización con folio ${id} del historial.`);
        } catch(error) { setNotification({type:'error',message:'No se pudo eliminar la cotización: ' + error.message}); return; }
    } else if (confirmDialog.action === 'DELETE_USER') {
        const { id, name } = confirmDialog.payload; const newUsers = users.filter(u => u.id !== id);
        setUsers(newUsers); setDoc(doc(db_fs, getDocPath('users')), { list: newUsers });
        logAction(`Eliminó al usuario: ${name}.`);
    } else if (confirmDialog.action === 'CLEAR_LOGS') {
        setLogs([]); setDoc(doc(db_fs, getDocPath('logs')), { list: [] }); logAction('Limpió todo el historial de cambios.');
    }
    setConfirmDialog(null);
  };

  const handleDbDelete = (section, index) => {
    setConfirmDialog({ title: 'Eliminar Elemento', message: `¿Estás seguro de que deseas eliminar este elemento?`, action: 'DELETE_DB_ITEM', payload: { section, index }});
  };

  const handleAddUser = (e) => {
    e.preventDefault();
    if (!newUser.name || !newUser.username || !newUser.password) { setNotification({ type: 'error', message: 'Llena todos los campos.' }); return; }
    if (users.find(u => u.username === newUser.username)) { setNotification({ type: 'error', message: 'Usuario ya existe.' }); return; }
    const newId = `u_${Date.now()}`; const newUsers = [...users, { id: newId, ...newUser }];
    setUsers(newUsers); setDoc(doc(db_fs, getDocPath('users')), { list: newUsers });
    logAction(`Creó un nuevo usuario: ${newUser.name} (${newUser.role}).`);
    setNewUser({ name: '', username: '', password: '', role: 'sales' }); setNotification({ type: 'success', message: 'Usuario creado.' });
  };

  const handleDeleteUser = (userId, userName) => {
    if (userId === currentUser.id) { setNotification({ type: 'error', message: 'No puedes eliminar tu propio usuario.' }); return; }
    setConfirmDialog({ title: 'Eliminar Usuario', message: `¿Seguro que deseas eliminar al usuario ${userName}?`, action: 'DELETE_USER', payload: { id: userId, name: userName } });
  };

  const handleUpdateProfile = (e) => {
    e.preventDefault();
    if (!profileForm.name || !profileForm.username || !profileForm.password) { setNotification({ type: 'error', message: 'Todos los campos son obligatorios.' }); return; }
    const existingUser = users.find(u => u.username === profileForm.username && u.id !== currentUser.id);
    if (existingUser) { setNotification({ type: 'error', message: 'El usuario ya está en uso.' }); return; }
    const updatedUsers = users.map(u => u.id === currentUser.id ? { ...u, name: profileForm.name, username: profileForm.username, password: profileForm.password } : u );
    setUsers(updatedUsers); setDoc(doc(db_fs, getDocPath('users')), { list: updatedUsers });
    setCurrentUser({ ...currentUser, name: profileForm.name, username: profileForm.username, password: profileForm.password });
    logAction(`Actualizó su información de perfil personal.`); setNotification({ type: 'success', message: '¡Perfil actualizado!' });
  };

  const handleLogin = (e) => {
    e.preventDefault();
    const userMatch = users.find(u => u.username === loginUser && u.password === loginPass);
    if (userMatch) { 
      setCurrentUser(userMatch); 
      setIsAuth(true); 
      if (rememberMe) {
        localStorage.setItem('amacsa_auth', 'true');
      } else {
        sessionStorage.setItem('amacsa_auth', 'true');
      }
      setLoginError(''); 
      logAction(`Inició sesión en el sistema.`); 
    } 
    else { setLoginError('Usuario o contraseña incorrectos'); setLoginPass(''); }
  };

  const handleLogout = () => { setCurrentUser(null); setIsAuth(false); localStorage.removeItem('amacsa_auth'); localStorage.removeItem('amacsa_current_user'); sessionStorage.removeItem('amacsa_auth'); sessionStorage.removeItem('amacsa_current_user'); setIsAppUnlocked(false); setView('cotizador'); };

  const handleAdminAccess = () => { 
    if (isAppUnlocked) { setIsAppUnlocked(false); setView('cotizador'); } 
    else { setIsAppUnlocked(true); setView('admin'); } 
  };

  const handleUnlockSubmit = (e) => {
    e.preventDefault();
    // Permite acceso si usa la clave maestra O si es admin y pone su propia contraseña
    if (adminUnlockPass === ADMIN_PASSWORD || (currentUser?.role === 'admin' && adminUnlockPass === currentUser.password)) { 
      setIsAppUnlocked(true); setView('admin'); setAdminUnlockPrompt(false); setAdminUnlockPass(''); 
    } 
    else { setNotification({ type: 'error', message: 'Clave de acceso incorrecta.' }); setAdminUnlockPass(''); }
  };

  // --- FUNCIONES ESTRELLA ---
  const handleNuevaCotizacion = () => {
    setCliente({ nombre: '', telefono: '', anticipo: 0, descuentoPct: 0, ajusteRedondeo: 0 });
    setDim({ largo: '20ft', ancho: '84in' });
    setAcople({ jalon: 'ganso_facil', cadena: 'ganso_38', sujetaCadenas: true, gato: 'manual', cantGatos: 1, cargadorSolar: false, cargador110: false });
    setRodado({ capacidad: '6t', suspension: 'torflex', llanta: '16in_14', cantFrenos: 2, llantaExtra: 0, portaExtra: 1 });
    setCarroceria({ techo: 'completo', frente: 'cachucha', redila: 'ptr_abierta', puertaInt: 'fija', cantPtasInt: 1, puertaTras: 'libro', puertaPiloto: true, puertaPilotoAncho: 40, plexiglass: false, rackPacas: false, ventEst: false, ventCirc: false, polverasEspeciales: false, puertaPerroCachucha: false });
    setMonturero({ tipo: 'ninguno', basesMontura: 3, tubosCobija: 1, puertaPerro: false, paredLarga: 85.5, paredCorta: 40 });
    setAcabados({ piso: 'madera', pintura: 'polvo', mismoColorTecho: false, color: 'gris', luces: market === 'usa' ? 'estandar_usa' : 'estandar_mexico', bodyLitros: 0, pinturaLitros: 0, techoLitros: 0, cajasPolvo: 0, cajaHtas: 'ninguna' });    setAccesorios({ lucesInteriores: 0, ovaloRojo: 0, tresCuartosRojo: 0, tresCuartosAmbar: 0, dosPulgadasRojo: 0, dosPulgadasAmbar: 0, luzPortaplaca: false });
    setCamaBajaOpts({ rampas: 'ninguna', fenderReforzado: false, ovaloRojo: 0, tresCuartosRojo: 0, tresCuartosAmbar: 0, luzPortaplaca: false });
    setNotification({ type: 'success', message: 'Cotizador listo para una nueva cotización.' });
  };

  // --- AYUDANTES MATEMÁTICOS Y CÁLCULOS ---
  const formatoMoneda = (num) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num || 0).replace('$', '$ ');
  
  const tipoPrecio = tipoRemolque === 'ganadero' 
    ? (tipoGanadero === 'redondo' && market === 'mexico' ? 'ganadero_redondo' 
       : tipoGanadero === 'ganso' && market === 'mexico' ? 'ganadero_ganso_mex' 
       : 'ganadero_ganso') 
    : tipoRemolque;

  const getP = (obj, key = 'precio') => obj ? (obj[`${key}_${tipoPrecio}`] !== undefined ? obj[`${key}_${tipoPrecio}`] : (obj[key] || 0)) : 0;
  const getExtraPrice = (id) => { const ext = db.extras?.find(e => e.id === id); return ext ? (ext[`precio_${tipoPrecio}`] ?? ext.precio ?? 0) : 0; };
  const getObj = (arr, id) => arr?.find(x => x.id === id) || arr?.[0] || { nombre: 'N/A', precio: 0, valor: 0 };

  const oCap = getObj(db.capacidades, rodado.capacidad);

  let cantEjes = 2;
  if (tipoRemolque === 'cama_alta') { 
      if (oCap.id === '6t') cantEjes = 2; 
      else if (oCap.id === '10t') cantEjes = (rodado.cantEjesGanso >= 3) ? 3 : 2; 
      else if (oCap.id === '9t') cantEjes = 3; 
  } else if (tipoRemolque === 'volteo' || tipoRemolque === 'cama_baja' || (tipoRemolque === 'ganadero' && tipoGanadero === 'redondo' && market === 'mexico')) {
      if (oCap.id === '6t' || oCap.id === '7t') cantEjes = 2;
      else if (oCap.id === '3t') cantEjes = 2;
      else if (oCap.id === '1_5t' || oCap.id === '850kg') cantEjes = 1;
  } else { 
      if (oCap.id === '9t') cantEjes = 3;
      else if (['7t', '6t', '4t_5200', '4t_6200'].includes(oCap.id)) cantEjes = 2;
      else if (['850kg', '1_5t', '2t_5200', '2t_6200'].includes(oCap.id)) cantEjes = 1;
      else if (oCap.id === '10t') cantEjes = (rodado.cantEjesGanso >= 3) ? 3 : 2; 
      else if (oCap.id === '3t') cantEjes = (rodado.cantEjesGanso === 2) ? 2 : 1;
  }

  let nombreCapacidadTicket = oCap.nombre;
  if (oCap.id === '10t') {
      if (rodado.cantEjesGanso === 310) nombreCapacidadTicket = '10 Ton (3 Ejes de 10,000 lbs)';
      else if (rodado.cantEjesGanso === 3) nombreCapacidadTicket = '10 Ton (3 Ejes de 8,000 lbs)';
      else nombreCapacidadTicket = '10 Ton (2 Ejes de 10,000 lbs)';
  }
  else if (oCap.id === '9t') nombreCapacidadTicket = '9 Ton (3 Ejes de 7,000 lbs)';
  else if (oCap.id === '7t') nombreCapacidadTicket = '7 Ton (2 Ejes de 8,000 lbs)';
  else if (oCap.id === '4t_5200') nombreCapacidadTicket = '4 Ton (2 Ejes de 5,200 lbs)';
  else if (oCap.id === '4t_6200') nombreCapacidadTicket = '4 Ton (2 Ejes de 6,200 lbs)';
  else if (oCap.id === '2t_5200') nombreCapacidadTicket = '2 Ton (1 Eje de 5,200 lbs)';
  else if (oCap.id === '2t_6200') nombreCapacidadTicket = '2 Ton (1 Eje de 6,200 lbs)';
  else if (oCap.id === '1_5t') nombreCapacidadTicket = '1.5 Ton (1 Eje de 3,500 lbs)';
  else if (oCap.id === '3t') {
      if (tipoRemolque === 'volteo' || tipoRemolque === 'cama_baja') nombreCapacidadTicket = '3 Ton (2 Ejes de 3,500 lbs)';
      else nombreCapacidadTicket = `3 Ton (${cantEjes} Eje(s) de 3,500 lbs)`;
  }

  const oLargo = getObj(db.largos, dim.largo); 
  const oAncho = getObj(db.anchos, dim.ancho); 
  const oJalon = getObj(db.jalones, acople.jalon); 
  const oCadena = getObj(db.cadenas, acople.cadena); 
  const oGato = getObj(db.gatos, acople.gato); 
  const oSusp = getObj(db.suspension, rodado.suspension); 
  const oLlantas = getObj(db.llantas, rodado.llanta); 
  const oTecho = getObj(db.techos, carroceria.techo); 
  const oRedila = getObj(db.redilas, carroceria.redila); 
  const oPInt = getObj(db.puertasInteriores, carroceria.puertaInt); 
  const oPTras = getObj(db.puertasTraseras, carroceria.puertaTras); 
  const oPiso = getObj(db.pisos, acabados.piso); 
  const oMont = getObj(db.montureros, monturero.tipo); 
  const oPint = getObj(db.pinturas, acabados.pintura); 
  const oLuces = getObj(db.luces, acabados.luces); 
  const oRampa = (camaBajaOpts.rampas && camaBajaOpts.rampas !== 'ninguna') 
  ? (db.rampas?.find(r => r.id === camaBajaOpts.rampas) || {precio: 0}) 
  : {precio: 0};

  const findMatrizPrice = (matrix, tipoKey, currentTipo) => {
    if (!matrix || matrix.length === 0) return null;
    const matches = matrix.filter(p => {
        if (p[tipoKey] && p[tipoKey] !== currentTipo) return false;
        if (p.largo && p.largo !== dim.largo) return false;
        if (p.ancho && p.ancho !== dim.ancho) return false;
        if (p.capacidad && p.capacidad !== rodado.capacidad) return false;
        return true;
    });
    if (matches.length === 0) return null;
    matches.sort((a, b) => Object.keys(b).filter(k => b[k]).length - Object.keys(a).filter(k => a[k]).length);
    return Number(matches[0].precio);
  };

  const precioMatrizPiso = findMatrizPrice(db.preciosPisos, 'piso', acabados.piso);
  const anchoEnPies = (oAncho.valor || 0) / 12;
  const areaSqFt = (oLargo.valor || 0) * anchoEnPies;
  const costoPisoTotal = precioMatrizPiso !== null ? precioMatrizPiso : (areaSqFt * (getP(oPiso, 'precioSqFt') || getP(oPiso) || 0) * (oPiso.id === 'madera' ? 2 : 1));

  const precioMatrizTecho = findMatrizPrice(db.preciosTechos, 'techo', carroceria.techo);
  const costoTecho = precioMatrizTecho !== null ? precioMatrizTecho : getP(oTecho);

  let costoGatos = acople.gato === 'hidraulico_bomba' ? ((getP(db.gatos?.find(g => g.id === 'hidraulico_sencillo')) || 6500) * acople.cantGatos) + (getP(oGato) - (getP(db.gatos?.find(g => g.id === 'hidraulico_sencillo')) || 6500)) : getP(oGato) * acople.cantGatos;
  const totalGatos = costoGatos + (acople.cargadorSolar ? 2500 : 0) + (acople.cargador110 ? 1500 : 0) + (acople.sujetaCadenas ? 450 : 0) + getP(oCadena);

  const totalRodado = getP(oCap) + getP(oSusp) + getP(oLlantas) + (rodado.cantFrenos > 0 ? getExtraPrice('frenos') * rodado.cantFrenos : 0) + (rodado.llantaExtra > 0 ? (rodado.llantaExtra * getP(oLlantas, 'precioExtra')) : 0) + (rodado.portaExtra * getExtraPrice('portaExtra'));
  
  let piesPlexi = (oLargo.valor || 0) * 4;
  if (oMont.id === 'recto_3') piesPlexi -= 12; else if (oMont.id === 'recto_4') piesPlexi -= 16; else if (oMont.id === 'diagonal') piesPlexi -= (((monturero.paredLarga || 0) + (monturero.paredCorta || 0)) / 12 * 2);
  if (carroceria.puertaPiloto) piesPlexi -= ((carroceria.puertaPilotoAncho || 0) / 12) * 4;
  if (carroceria.frente === 'cachucha' && carroceria.puertaPerroCachucha) piesPlexi -= 13.33;
  if (monturero.puertaPerro) piesPlexi -= 13.33;
  
  const totalCarroceria = costoTecho + getP(oRedila) + (getP(oPInt) * carroceria.cantPtasInt) + getP(oPTras) + (carroceria.frente === 'cachucha' ? getExtraPrice('frenteCachucha') : carroceria.frente === 'canasta' ? getExtraPrice('frenteCanasta') : 0) + (carroceria.plexiglass && piesPlexi > 0 ? Math.ceil(piesPlexi / 46.5) * getExtraPrice('hojaPlexiglass') : 0) + (carroceria.rackPacas ? getExtraPrice('rackPacas') : 0) + (carroceria.ventEst * getExtraPrice('ventEst')) + (carroceria.ventCirc * getExtraPrice('ventCirc')) + (carroceria.polverasEspeciales ? getExtraPrice('polverasEspeciales') : 0) + (carroceria.puertaPerroCachucha ? getExtraPrice('puertaPerroCachucha') : 0);

  const totalMonturero = tipoRemolque === 'ganadero' && oMont.id !== 'ninguno' ? getP(oMont) + (monturero.basesMontura * getExtraPrice('basesMontura')) + (monturero.tubosCobija * getExtraPrice('tubosCobija')) + (monturero.puertaPerro ? getExtraPrice('puertaPerroLateral') : 0) : 0;
  const totalAcabados = getP(oPint) + getP(oLuces) + (accesorios.lucesInteriores * getExtraPrice('lucesInteriores')) + (acabados.bodyLitros * getExtraPrice('litroBody')) + (acabados.cajaHtas === 'std' ? getExtraPrice('cajaHtasStd') : acabados.cajaHtas === 'grande' ? getExtraPrice('cajaHtasGrande') : acabados.cajaHtas === 'especial' ? 8500 : 0);

  // --- 3. BUSCADOR INTELIGENTE EN EL TABULADOR ---
  const tipoFiltroTab = tipoRemolque === 'ganadero' ? `ganadero_${tipoGanadero}` : tipoRemolque;
  const largoFiltroNum = parseFloat(dim.largo.replace('ft', '')) || 0;

  // --- 1. BUSCADOR EN EL CATÁLOGO OFICIAL (7 PILARES) ---
  const matchesTabulador = (db.preciosFijos || []).filter(p => {
      if (p.market && p.market !== market) return false;
      if (p.tipo && p.tipo !== tipoFiltroTab) return false;
      if (p.ancho && p.ancho !== dim.ancho) return false;
      if (p.capacidad && p.capacidad !== rodado.capacidad) return false;
      if (p.largo && Number(p.largo) !== largoFiltroNum) return false;
      
      // NUEVO: Filtros estrictos de Redila y Piso 
      if (p.redila && p.redila !== carroceria.redila) return false;
      if (p.piso && p.piso !== acabados.piso) return false;
      
      return true; 
  });

  matchesTabulador.sort((a, b) => Object.keys(b).filter(k => b[k]).length - Object.keys(a).filter(k => a[k]).length);
  const matchTabulador = matchesTabulador[0];

  let subtotalNeto = 0;
  const totalExtrasCustom = extrasCustom.reduce((sum, item) => sum + (Number(item.precio) || 0), 0);

  // --- 2. CÁLCULO DE EXTRAS Y LISTA NEGRA (FUERA DE DESCUENTO) ---
  const costoLlantasExtra = rodado.llantaExtra > 0 ? (rodado.llantaExtra * getP(getObj(db.llantas, rodado.llanta), 'precioExtra')) : 0;
  const costoPortaExtra = rodado.portaExtra > 0 ? (rodado.portaExtra * (getExtraPrice('portaExtra') || 800)) : 0;
  const costoFrenos = rodado.cantFrenos > 0 ? ((getExtraPrice('frenos') || 3000) * rodado.cantFrenos) : 0;
  const costoControlFreno = acople.controlFreno ? (getExtraPrice('controlFreno') || 2500) : 0;

  // Acoplamiento, Gatos y Llantas Dinámicas
  const costoJalon = getP(oJalon);
  // --- NUEVO: CALCULADOR INTELIGENTE DE CADENAS ESTÁNDAR ---
  const getCadenaDefault = (cap, tipo, ganadero) => {
      if (tipo === 'cama_alta') return 'ganso_38';
      if (tipo === 'ganadero' && ganadero === 'ganso') return 'ganso_38';
      if (['6t', '7t', '9t', '10t'].includes(cap)) return 'ganso_38';
      return 'seguridad_14'; // Por defecto para Cama Baja 1.5t/3t/4t, Redondo, etc.
  };
  
  const oCadenaEstandar = getObj(db.cadenas, getCadenaDefault(rodado.capacidad, tipoRemolque, tipoGanadero));
  // SOLO cobramos la diferencia si elige una cadena mejor a la estándar que le toca
  const costoCadenaDinamico = getP(oCadena) - getP(oCadenaEstandar);

  const costoSujetaCadenas = acople.sujetaCadenas ? (getExtraPrice('sujetaCadenas') || 450) : 0;
  const costoGatosFinal = acople.gato === 'hidraulico_bomba' ? ((getP(db.gatos?.find(g => g.id === 'hidraulico_sencillo')) || 6500) * acople.cantGatos) + (getP(oGato) - (getP(db.gatos?.find(g => g.id === 'hidraulico_sencillo')) || 6500)) : getP(oGato) * acople.cantGatos;
  const accesoriosSolaresFinal = (acople.cargadorSolar ? 2500 : 0) + (acople.cargador110 ? 1500 : 0);
  
  const totalAcople = costoJalon + costoCadenaDinamico + costoSujetaCadenas + costoGatosFinal + accesoriosSolaresFinal;

  // --- NUEVO: CALCULADOR INTELIGENTE DE LLANTAS ESTÁNDAR ---
  // Identifica qué llanta trae "de fábrica" según la capacidad y el tipo de remolque
  const getLlantaDefault = (cap, tipo) => {
      // 1. Todas las de 3 Toneladas (y menores) llevan la 700R15 por defecto
      if (['850kg', '1_5t', '1_5t_3500', '1_5t_5200', '3t'].includes(cap)) return '700_15';
      
      // 2. Excepción para cama baja de 4T
      if (tipo === 'cama_baja' && cap === '4t') return '225_75_15';
      
      // 3. Excepción para Cama Alta 10T (Si la 10T lleva rin 16 estándar, cámbialo a '235_80_16')
      if (tipo === 'cama_alta' && cap === '10t') return '17_5in'; 
      
      // 4. Por defecto para remolques pesados (4T, 6T, 7T, 9T) asume la 235/80R16 Estándar
      return '235_80_16'; 
  };

  const llantaEstandarId = getLlantaDefault(rodado.capacidad, tipoRemolque);
  const oLlantaEstandar = getObj(db.llantas, llantaEstandarId);

  const llantasPorEjeBase = (tipoRemolque === 'cama_alta' && rodado.capacidad === '10t') ? 4 : 2;
  const cantLlantasPiso = cantEjes * llantasPorEjeBase; 
  
  // SOLO cobramos (o descontamos) la diferencia si el cliente elige una llanta diferente a la estándar
  const costoLlantasDinamico = (getP(oLlantas) - getP(oLlantaEstandar)) * cantLlantasPiso;

  // --- NUEVO: CALCULADOR INTELIGENTE DE PISOS Y REDILAS ---
  // Calculamos la diferencia exacta si el piso elegido es distinto a la madera estándar
  const costoPisoMaderaBase = areaSqFt * (db.pisos?.find(p => p.id === 'madera')?.precioSqFt || 35) * 2;
  const extraPorPiso = costoPisoTotal > costoPisoMaderaBase ? (costoPisoTotal - costoPisoMaderaBase) : 0;

  // Integramos la Redila (que puede sumar o restar dinero) y el Piso a los upgrades estructurales
// --- INTELIGENCIA DE REDILA REFORZADA (PLATAFORMA MÁS CARA) ---
  const baseEncontrada = matchesTabulador[0];
  const redilaYaIncluida = baseEncontrada && baseEncontrada.redila === carroceria.redila;
  
  // Si el tabulador ya tiene el precio exacto con esa redila, $0 extra. 
  // Si es una medida general, sumamos el costo de la redila (o el recargo por hacerlo plataforma sin redila).
  const costoRedilaInteligente = redilaYaIncluida ? 0 : getP(oRedila);

  // --- CALCULADORA DE LUCES INDIVIDUALES (Paquete Especial México) ---
  const costoLucesIndividuales = acabados.luces === 'especial_mexico' ? 
    ((accesorios.ovaloRojo || 0) * (getExtraPrice('luzOvalo') || 350)) +
    ((accesorios.ovaloAmbar || 0) * (getExtraPrice('luzOvaloAmbar') || 350)) +
    ((accesorios.tresCuartosRojo || 0) * (getExtraPrice('luzTresCuartosRoja') || 85)) +
    ((accesorios.tresCuartosAmbar || 0) * (getExtraPrice('luzTresCuartosAmbar') || 85)) +
    ((accesorios.dosPulgadasRojo || 0) * (getExtraPrice('luzDosPulgadasRoja') || 120)) +
    ((accesorios.dosPulgadasAmbar || 0) * (getExtraPrice('luzDosPulgadasAmbar') || 120)) +
    (accesorios.luzPortaplaca ? (getExtraPrice('luzPortaplaca') || 350) : 0) : 0;

  const costoUpgradesBase = costoLlantasDinamico + getP(oSusp) + costoTecho + getP(oPint) + getP(oLuces) + costoRedilaInteligente + costoLucesIndividuales;
  // Sistema Hidráulico Extra y Carrocería (Lista Negra)
  const costoGatoExtra = acople.gatoExtra ? (getExtraPrice('gatoExtra') || 1500) : 0; 
  const costoPiston = acople.pistonHidraulico ? (getExtraPrice('pistonHidraulico') || 5000) : 0;
  const costoBomba = acople.bombaElectrica ? (getExtraPrice('bombaElectrica') || 4000) : 0;
  
  const costoPuertaLateral = carroceria.puertaLateral ? (getExtraPrice('portaLateral') || 2000) : 0;
  const costoPuertaCentral = carroceria.puertaCentralExtra ? (getExtraPrice('puertaCentralExtra') || 2000) : 0;
  const costoPuertaRampa = carroceria.puertaRampa ? (getExtraPrice('puertaRampa') || 2500) : 0;
  const costoTechoFinal = carroceria.techo ? getP(oTecho) : 0;
  const costoCachucha = carroceria.cachucha ? (getExtraPrice('cachucha') || 1500) : 0;
  const costoPieExtraRedila = (carroceria.pieAdicionalRedila || 0) * (getExtraPrice('pieRedila') || 500);

  // Sumatoria total blindada (Ahora declarada al final, cuando todas las variables ya existen)
  const totalExtrasBlindados = totalAcople + costoUpgradesBase + costoLlantasExtra + costoPortaExtra + costoFrenos + costoControlFreno + 
                             costoGatoExtra + costoPiston + costoBomba + 
                             costoPuertaLateral + costoPuertaCentral + costoPuertaRampa + 
                             costoTechoFinal + costoCachucha + costoPieExtraRedila + 
                             totalMonturero + totalAcabados + totalExtrasCustom;


  // --- 3. DECISIÓN DEL MOTOR (PLAN A vs PLAN B) ---
  let precioBasePuro = 0;

  if (matchTabulador && Number(matchTabulador.precio) > 0) {
      // PLAN A: Base pura del Tabulador
      precioBasePuro = Number(matchTabulador.precio) * (cliente.cantidad || 1);
  } else {
      // PLAN B: Base armada pieza por pieza (Ya sin doble cobro de las llantas)
      const precioBase = getExtraPrice('precioBase') || 0; 
      const costoPiezasEstructurales = getP(oLargo) + getP(oAncho) + getP(oCap) + costoPisoTotal;
      precioBasePuro = (precioBase + costoPiezasEstructurales) * (cliente.cantidad || 1);
  }

  const costoTotalExtras = totalExtrasBlindados * (cliente.cantidad || 1);
  subtotalNeto = precioBasePuro + costoTotalExtras;

  // --- 4. DESGLOSE FISCAL Y DESCUENTOS (BLINDADOS) ---
  const montoDescuento1 = precioBasePuro * ((cliente.descuentoPct || 0) / 100);
  const baseConDesc1 = precioBasePuro - montoDescuento1;
  
  const montoDescuento2 = baseConDesc1 * ((cliente.descuentoExtraPct || 0) / 100);
  const baseConDescFinal = baseConDesc1 - montoDescuento2;

  const subtotalDescuento = baseConDescFinal + costoTotalExtras;
  
  const subtotalSinIva = market === 'usa' ? subtotalDescuento : (subtotalDescuento / 1.16);
  const subtotalIva = market === 'usa' ? 0 : (subtotalDescuento - subtotalSinIva);
  
  const totalFinal = subtotalDescuento + (cliente.ajusteRedondeo || 0);
  const saldoPendiente = totalFinal - (cliente.anticipo || 0);
  
  const calcularTotalActual = () => totalFinal;
  const handleGuardarComoCatalogo = () => {
    const totalCalc = calcularTotalActual();
    const nombreModelo = `Remolque ${tipoRemolque.replace('_', ' ').toUpperCase()} ${oLargo.valor}' x ${oAncho.valor}"`;
    const specsBreves = `${nombreCapacidadTicket}, Susp. ${oSusp.nombre}, Piso ${oPiso.nombre}, Jalón ${oJalon.nombre}`;

    const nuevoModeloCatalogo = {
      id: `cat_${Date.now()}`,
      nombre: nombreModelo,
      precio: totalCalc,
      foto: '', 
      especificaciones: specsBreves,
      market: market,
      tipoRemolque: tipoRemolque === 'ganadero' ? `ganadero_${tipoGanadero}` : tipoRemolque,
      largo: dim.largo,
      ancho: dim.ancho,
      capacidad: rodado.capacidad,
      suspension: rodado.suspension,
      llanta: rodado.llanta,
      jalon: acople.jalon,
      gato: acople.gato,
      techo: carroceria.techo,
      redila: carroceria.redila,
      piso: acabados.piso,
      monturero: monturero.tipo,
      pintura: acabados.pintura,
      luces: acabados.luces,
      color: acabados.color
    };

    const newDb = { ...db };
    newDb.modelosLinea = [nuevoModeloCatalogo, ...(newDb.modelosLinea || [])];
    setDb(newDb);
    setDoc(doc(db_fs, getDocPath('catalog')), newDb);

    logAction(`Guardó un nuevo modelo en el catálogo desde el cotizador: ${nombreModelo}`);
    setNotification({ type: 'success', message: `¡${nombreModelo} agregado al Catálogo de Línea con éxito!` });
  };

  const handleGuardarCotizacion = async () => {
    const totalCalc = calcularTotalActual();
    const nuevaCotId = `COT-${Math.floor(1000 + Math.random() * 9000)}`;

    // Avisamos al usuario que estamos trabajando
    setNotification({ type: 'success', message: 'Generando PDF y subiendo a la nube...' });

    let urlPdf = null;
    try {
      const ticketElement = document.getElementById('ticket-cotizacion');
      if (ticketElement) {
        // Creamos un contenedor temporal visible pero transparente para que el navegador lo pinte bien
        const clone = ticketElement.cloneNode(true);
        clone.style.width = '800px';
        clone.style.position = 'fixed';
        clone.style.top = '0';
        clone.style.left = '0';
        clone.style.zIndex = '99999';
        clone.style.opacity = '1'; // Lo dejamos visible un instante para que toPng lo capture perfecto
        clone.style.background = '#ffffff';
        clone.style.padding = '30px';
        document.body.appendChild(clone);

        // Damos un pequeño respiro de 200ms para que el navegador renderice textos y estilos
        await new Promise(resolve => setTimeout(resolve, 200));

        const imgData = await toPng(clone, { pixelRatio: 2, backgroundColor: '#ffffff' });
        document.body.removeChild(clone);

        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const imgProps = pdf.getImageProperties(imgData);
        const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
        pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
        
        const pdfBlob = pdf.output('blob');
        const pdfRef = ref(storage, `cotizaciones/COT-${Math.floor(1000 + Math.random() * 9000)}.pdf`);
        await uploadBytes(pdfRef, pdfBlob);
        urlPdf = await getDownloadURL(pdfRef);
      }
    } catch (error) {
      console.error("Error creando PDF:", error);
    }

    const nuevaCot = {
      id: nuevaCotId,
      fecha: new Date().toLocaleDateString('es-MX'),
      cliente: cliente.nombre || 'Mostrador',
      telefono: cliente.telefono || 'N/A',
      remolque: tipoRemolque.replace('_', ' ').toUpperCase(),
      medida: `${getObj(db.largos, dim.largo).valor}' x ${getObj(db.anchos, dim.ancho).valor}"`,
      total: formatoMoneda(totalCalc),
      vendedor: currentUser?.name || 'Ventas',
      pdfUrl: urlPdf, // <--- AQUÍ SE GUARDA EL ENLACE MÁGICO
config: { market, tipoRemolque, isSpecialClient, cliente, dim, acople, rodado, carroceria, monturero, acabados, accesorios, camaBajaOpts, usarLargoCustom, largoCustom }    };

    const updated = [nuevaCot, ...cotizaciones].slice(0, 200);
    setCotizaciones(updated);
    setDoc(doc(db_fs, getDocPath('cotizaciones')), { list: updated });
    logAction(`Guardó cotización ${nuevaCot.id} con PDF en la nube.`);
    setNotification({ type: 'success', message: `Cotización ${nuevaCot.id} guardada y PDF respaldado con éxito.` });
  };

  const handleCargarCotizacion = (cot) => {
    if (cot.config?.modoCotizacion === 'ensambles') { void handleAbrirCotizacionEnsambles(cot,'ver'); return; }
    if (cot.config) {
      setMarket(cot.config.market || 'mexico');
      setTipoRemolque(cot.config.tipoRemolque || 'ganadero');
      setIsSpecialClient(cot.config.isSpecialClient !== undefined ? cot.config.isSpecialClient : true);
      setCliente(cot.config.cliente);
      setDim(cot.config.dim);
      setAcople(cot.config.acople);
      setRodado(cot.config.rodado);
      setCarroceria(cot.config.carroceria);
      setMonturero(cot.config.monturero);
      setAcabados(cot.config.acabados);
      setAccesorios(cot.config.accesorios);
      setCamaBajaOpts(cot.config.camaBajaOpts || { rampas: 'ninguna', fenderReforzado: false, ovaloRojo: 0, tresCuartosRojo: 0, tresCuartosAmbar: 0, luzPortaplaca: false });
      setUsarLargoCustom(cot.config.usarLargoCustom || false);
      setLargoCustom(cot.config.largoCustom || '');
      setPrecioManual(cot.config.precioManual || ''); // Carga el precio manual
      setView('cotizador');
      setNotification({ type: 'success', message: `Cotización ${cot.id} cargada con éxito. Ya puedes reimprimirla o enviarla.` });
    } else {
      setNotification({ type: 'error', message: `La cotización ${cot.id} es de una versión anterior y no se puede recargar automáticamente.` });
    }
  };

const handleDuplicarCotizacion = (cot) => {
    if (cot.config?.modoCotizacion === 'ensambles') { void handleAbrirCotizacionEnsambles(cot,'duplicar'); return; }
    if (cot.config) {
      setMarket(cot.config.market || 'mexico');
      setTipoRemolque(cot.config.tipoRemolque || 'ganadero');
      setIsSpecialClient(cot.config.isSpecialClient !== undefined ? cot.config.isSpecialClient : true);
      // Cargamos los datos agregando "(Copia)" para identificar que es un nuevo presupuesto
      setCliente({ ...cot.config.cliente, nombre: `${cot.config.cliente.nombre || 'Cliente'} (Copia)` });
      setDim(cot.config.dim);
      setAcople(cot.config.acople);
      setRodado(cot.config.rodado);
      setCarroceria(cot.config.carroceria);
      setMonturero(cot.config.monturero);
      setAcabados(cot.config.acabados);
      setAccesorios(cot.config.accesorios);
      setCamaBajaOpts(cot.config.camaBajaOpts || { rampas: 'ninguna', fenderReforzado: false, ovaloRojo: 0, tresCuartosRojo: 0, tresCuartosAmbar: 0, luzPortaplaca: false });
      setUsarLargoCustom(cot.config.usarLargoCustom || false);
      setLargoCustom(cot.config.largoCustom || '');
      setPrecioManual(cot.config.precioManual || ''); // Carga el precio manual
      setView('cotizador');
      setNotification({ type: 'success', message: `¡Cotización duplicada! Modifica los cambios necesarios y guárdala con un nuevo folio.` });
      logAction(`Duplicó la cotización ${cot.id} para generar un nuevo presupuesto.`);
    } else {
      setNotification({ type: 'error', message: `La cotización ${cot.id} es de una versión anterior y no se puede duplicar automáticamente.` });
    }
  };

  const handleEliminarCotizacion = (cotId) => {
    setConfirmDialog({ title: 'Eliminar Cotización', message: `¿Seguro que deseas borrar la cotización con folio ${cotId} del historial?`, action: 'DELETE_COTIZACION', payload: { id: cotId } });
  };

 const [isGeneratingCatalogAI, setIsGeneratingCatalogAI] = useState(false);

const handleCotizarDesdeCatalogo = (modelo) => {
    // 1. Cargamos mercado y tipo
    setMarket(modelo.market || 'usa');
    setTipoRemolque(modelo.tipoRemolque || 'ganadero');
    
    // 2. Cargamos dimensiones completas
    setDim({ largo: modelo.largo, ancho: modelo.ancho });
    
    // 3. Cargamos toda la configuración estructural (El "Preset")
    setRodado({ 
        capacidad: modelo.capacidad, 
        suspension: modelo.suspension, 
        llanta: modelo.llanta,
        cantFrenos: 2, // O el valor que desees por defecto
        llantaExtra: 0,
        portaExtra: 1
    });

    setAcople({ 
        jalon: modelo.jalon, 
        gato: modelo.gato, 
        cantGatos: 1, 
        cargadorSolar: false, 
        cargador110: false 
    });

    setCarroceria({ 
        techo: modelo.techo, 
        redila: modelo.redila, 
        puertaTras: 'libro' // O el valor que tenga el modelo
        // ... agrega aquí todos los campos que falten del estado carroceria
    });

    setAcabados({ 
        piso: modelo.piso, 
        pintura: modelo.pintura, 
        luces: modelo.luces, 
        color: modelo.color 
    });

    // 4. Cambiamos de vista y avisamos
    setView('cotizador');
    setNotification({ type: 'success', message: `Modelo "${modelo.nombre}" cargado. Ahora puedes personalizarlo.` });
  };

  const handleMejorarConIACatalogo = async (index) => {
    const itemActual = db[adminSection][index];
    const textoBase = itemActual.especificaciones || itemActual.nombre || "Remolque AMACSA";

    setIsGeneratingCatalogAI(true);
    setNotification({ type: 'success', message: 'La IA está analizando y cotizando el equipo...' });

    try {
      const prompt = `Actúa como un experto cotizador y jefe de planta de la empresa fabricante de remolques AMACSA.
Tengo este modelo de línea / descripción rápida: "${textoBase}".
Por favor, responde estrictamente en formato JSON válido (sin bloques de código markdown extra, solo el JSON puro) con las siguientes dos llaves:
1. "specs": Una versión limpia, técnica, formal y redactada con estándar corporativo de las especificaciones breves para el catálogo (ej. "2 Ejes 7k, Piso Madera, Cuello Ganso, Torflex").
2. "precio": Un número entero estimado de referencia en MXN para este tipo de remolque en el mercado actual de México.

Ejemplo de respuesta esperada:
{
  "specs": "2 Ejes 7k, Piso de Madera, Cuello Ganso Reforzado",
  "precio": 145000
}`;

      const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });

      const data = await response.json();
      console.log("🤖 Respuesta de la IA:", data); // Agregué esto para espiar qué nos dice si falla

      if (response.ok && data.text) {
        // Limpiamos posibles marcas de markdown del JSON
        let jsonStr = data.text.replace(/```json/g, '').replace(/```/g, '').trim();
        const resultado = JSON.parse(jsonStr);

        // USAMOS TU FUNCIÓN PARA GUARDAR EN FIREBASE DIRECTAMENTE
        if (resultado.specs) {
          handleDbChange(adminSection, index, 'especificaciones', resultado.specs);
        }
        if (resultado.precio) {
          handleDbChange(adminSection, index, 'precio', resultado.precio); // Corregido: Era 'precio', no 'precioBase'
        }
        
        setNotification({ type: 'success', message: '¡Especificaciones y precio optimizados por IA con éxito!' });
      } else {
         setNotification({ type: 'error', message: 'Error de la IA: No devolvió el texto esperado.' });
      }
    } catch (error) {
      console.error('Error con la IA del catálogo:', error);
      setNotification({ type: 'error', message: 'No se pudo conectar con la IA de Google en este momento.' });
    } finally {
      setIsGeneratingCatalogAI(false);
    }
  };

   const handleWhatsAppPDF = async () => {
    setIsGeneratingIA(true);
    setNotification({ type: 'success', message: 'Guardando en historial y preparando WhatsApp...' });

    const totalCalc = calcularTotalActual();
    const nuevaCotId = `COT-${Math.floor(1000 + Math.random() * 9000)}`;

    let urlPdf = null;
    try {
      // 1. Tomamos la "foto" en ancho real y creamos el PDF oficial
      const ticketElement = document.getElementById('ticket-cotizacion');
      if (ticketElement) {
        const clone = ticketElement.cloneNode(true);
        clone.style.width = '800px';
        clone.style.position = 'fixed';
        clone.style.top = '0';
        clone.style.left = '0';
        clone.style.zIndex = '99999';
        clone.style.opacity = '1';
        clone.style.background = '#ffffff';
        clone.style.padding = '30px';
        document.body.appendChild(clone);

        await new Promise(resolve => setTimeout(resolve, 200));

        const imgData = await toPng(clone, { pixelRatio: 2, backgroundColor: '#ffffff' });
        document.body.removeChild(clone);

        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const imgProps = pdf.getImageProperties(imgData);
        const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
        pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
        
        // 2. Lo guardamos en la nube y obtenemos su enlace seguro de acceso inmediato
        const pdfBlob = pdf.output('blob');
        const pdfRef = ref(storage, `cotizaciones/${nuevaCotId}.pdf`);
        await uploadBytes(pdfRef, pdfBlob);
        
        // Usamos getDownloadURL para garantizar acceso autorizado sin errores de permisos
        urlPdf = await getDownloadURL(pdfRef);
      }
    } catch (error) {
      console.error('Error al generar o subir PDF:', error);
    }

    // 3. Guardamos la cotización en el historial y en la nube automáticamente
    const nuevaCot = {
      id: nuevaCotId,
      fecha: new Date().toLocaleDateString('es-MX'),
      cliente: cliente.nombre || 'Mostrador',
      telefono: cliente.telefono || 'N/A',
      remolque: tipoRemolque.replace('_', ' ').toUpperCase(),
      medida: `${getObj(db.largos, dim.largo).valor}' x ${getObj(db.anchos, dim.ancho).valor}"`,
      total: formatoMoneda(totalCalc),
      vendedor: currentUser?.name || 'Ventas',
      pdfUrl: urlPdf,
      config: { market, tipoRemolque, isSpecialClient, cliente, dim, acople, rodado, carroceria, monturero, acabados, accesorios, camaBajaOpts, usarLargoCustom, largoCustom, precioManual } // <--- PRECIO MANUAL AGREGADO
    };

    const updated = [nuevaCot, ...cotizaciones].slice(0, 200);
    setCotizaciones(updated);
    setDoc(doc(db_fs, getDocPath('cotizaciones')), { list: updated });
    logAction(`Generó y guardó automáticamente la cotización ${nuevaCot.id} vía WhatsApp.`);

    // 4. Mensaje corporativo base (Respaldado por si la IA de Google se satura)
    const totalFinalAMostrar = formatoMoneda(totalCalc);
    let textoFinal = `Estimado(a) *${cliente.nombre || 'Cliente'}*, le comparto el presupuesto oficial de su *Remolque AMACSA*.\n\n*Total:* ${totalFinalAMostrar} MXN\n\nPuedes descargar y revisar su cotización detallada a formato PDF abriendo el siguiente enlace seguro:\n${urlPdf || '[Enlace generado en planta]'}\n\nQuedamos a sus órdenes para cualquier duda o aclaración.\n*Ventas AMACSA*`;

    // 5. Intentamos contactar a Gemini para personalizar el texto
    try {
      const prompt = `Actúa como ${currentUser?.name || 'Representante de Ventas'} de la empresa fabricante AMACSA. 
Redacta un mensaje de WhatsApp breve, profesional y cordial para el cliente ${cliente.nombre || 'estimado cliente'}. 
Infórmale que su presupuesto está listo. 
Datos del equipo: Remolque ${tipoRemolque.replace('_', ' ')} con capacidad de ${nombreCapacidadTicket}. 
Precio total: ${totalFinalAMostrar} MXN.
Agrega UNA sola línea destacando de manera técnica y formal una ventaja clave del equipo.
Menciona que pueden descargar y ver su cotización oficial a detalle abriendo el siguiente enlace seguro: ${urlPdf || '[Enlace no disponible]'}
Despídete y firma el mensaje estrictamente con el nombre: ${currentUser?.name || 'Ventas AMACSA'}.
Tono: Formal, corporativo, directo y amable. Estrictamente prohíbe el uso de jerga o palabras coloquiales.`;

      const response = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }) 
      });

      const data = await response.json();
      if (response.ok && data.text) { 
        textoFinal = data.text; 
      }
    } catch (aiError) {
      console.log('Aviso: IA ocupada, usando formato corporativo estándar.');
    } finally {
      setIsGeneratingIA(false);
    }

    // 6. Lanzamos WhatsApp con el enlace y el mensaje listo
    const numeroLimpio = cliente.telefono ? cliente.telefono.replace(/\D/g, '') : '';
    const numeroFinal = numeroLimpio.length === 10 ? `52${numeroLimpio}` : numeroLimpio;
    const linkWhatsApp = numeroFinal ? `https://wa.me/${numeroFinal}?text=${encodeURIComponent(textoFinal)}` : `https://wa.me/?text=${encodeURIComponent(textoFinal)}`;

    window.open(linkWhatsApp, '_blank');
    setNotification({ type: 'success', message: `Cotización ${nuevaCotId} guardada en el historial y WhatsApp abierto.` });
  };

  // --- MATEMÁTICAS EN TIEMPO REAL ---
  const handleCant = (setter, field, delta, min = 0, max = Infinity) => setter(prev => ({ ...prev, [field]: Math.min(max, Math.max(min, prev[field] + delta)) }));
  const toggle = (setter, field) => setter(prev => ({ ...prev, [field]: !prev[field] }));

  const maxPuertasInt = (() => { const val = parseInt(dim.largo.replace('ft', '')); if (val <= 20) return 1; if (val <= 26) return 2; if (val <= 32) return 3; return 5; })();
  
   const isGanaderoRedondoMex = tipoRemolque === 'ganadero' && tipoGanadero === 'redondo' && market === 'mexico';
  const isGanaderoRedondoUSA = tipoRemolque === 'ganadero' && tipoGanadero === 'redondo' && market === 'usa';

// 1. Este es el control del Mercado (USA vs México) que tenías antes
  useEffect(() => {
    if (market === 'usa') { 
      setTipoRemolque('ganadero'); 
      setAcople(prev => ({ ...prev, sujetaCadenas: true, cadena: 'ganso_38' })); 
      setAcabados(prev => ({ ...prev, luces: 'estandar_usa' }));
    } 
    else if (market === 'mexico') { 
      setIsSpecialClient(false); 
      setAcabados(prev => ({ ...prev, luces: 'estandar_mexico' }));
    }
  }, [market]);
  // --- NUEVO: Auto-Selección Inteligente de Cadena ---
  useEffect(() => {
      // Si el mercado es USA, ya forzamos la 3/8 arriba, lo ignoramos para que no choque
      if (market !== 'usa') {
          const cadenaIdeal = (tipoRemolque === 'cama_alta' || (tipoRemolque === 'ganadero' && tipoGanadero === 'ganso') || ['6t', '7t', '9t', '10t'].includes(rodado.capacidad)) 
              ? 'ganso_38' 
              : 'seguridad_14';
              
          setAcople(prev => {
              if (prev.cadena !== cadenaIdeal) return { ...prev, cadena: cadenaIdeal };
              return prev;
          });
      }
  }, [tipoRemolque, tipoGanadero, rodado.capacidad, market]);

  // 2. Control Inteligente para Frente, Gatos, Jalones y Monturero del Ganadero
  useEffect(() => {
    if (tipoRemolque === 'ganadero') {
      setCarroceria(prev => {
          let nuevoFrente = prev.frente;
          if (tipoGanadero === 'redondo') {
              if (nuevoFrente !== 'ninguno' && nuevoFrente !== 'cuadrado') nuevoFrente = 'ninguno';
          } else {
              if (nuevoFrente !== 'cachucha' && nuevoFrente !== 'canasta') nuevoFrente = 'cachucha';
          }
          return prev.frente !== nuevoFrente ? { ...prev, frente: nuevoFrente } : prev;
      });
      
      setAcople(prev => {
          let nuevoGato = prev.gato;
          let nuevoJalon = prev.jalon;

          if (tipoGanadero === 'redondo' && nuevoJalon.includes('ganso')) {
              nuevoJalon = 'bumper_ajustable_2_516'; 
          } else if (tipoGanadero === 'ganso' && !nuevoJalon.includes('ganso')) {
              nuevoJalon = 'ganso_facil'; 
          }

          if (market === 'usa') {
              if (!['manual_12k', 'hidraulico_sencillo', 'hidraulico_bomba'].includes(nuevoGato)) nuevoGato = 'manual_12k';
          } else {
              if (tipoGanadero === 'redondo') {
                  if (['3t', '2t_5200', '2t_6200'].includes(rodado.capacidad)) {
                      nuevoGato = 'normal_2k';
                  } else {
                      if (!['manual_7k', 'manual_12k'].includes(nuevoGato)) nuevoGato = 'manual_7k';
                  }
              } else {
                  if (['tubo_2k', 'normal_2k', 'manual_7k', 'manual_12k'].includes(nuevoGato)) nuevoGato = 'manual';
              }
          }
          
          return (prev.gato !== nuevoGato || prev.jalon !== nuevoJalon) ? { ...prev, gato: nuevoGato, jalon: nuevoJalon } : prev;
      });

      // NUEVO: Regla 3 - Monturero Redondo USA (Bloquear Diagonal)
      setMonturero(prev => {
          if (tipoGanadero === 'redondo' && market === 'usa' && prev.tipo === 'diagonal') {
              return { ...prev, tipo: 'ninguno' };
          }
          return prev;
      });
    }
  }, [tipoRemolque, tipoGanadero, rodado.capacidad, market]);

  useEffect(() => {
    if (tipoRemolque === 'cama_baja') {
      const combos = CAMA_BAJA_COMBOS;
      if (!combos[dim.ancho]) setDim(prev => ({ ...prev, ancho: '82in', largo: '16ft' }));
      else if (!combos[dim.ancho].includes(dim.largo)) setDim(prev => ({ ...prev, largo: combos[dim.ancho][0] }));
      
      const validCaps = getCapacidadesCamaBaja(dim.ancho, dim.largo);
      if (validCaps.length > 0 && !validCaps.includes(rodado.capacidad)) setRodado(prev => ({ ...prev, capacidad: validCaps[0] }));
      if (rodado.portaExtra < 1) setRodado(prev => ({ ...prev, portaExtra: 1 }));
      
      const currentJalon = db.jalones?.find(j => j.id === acople.jalon);
      if (currentJalon && currentJalon.tipo === 'ganso') {
        const firstBumper = db.jalones?.find(j => j.id === 'bumper_2_516' || j.tipo !== 'ganso');
        if (firstBumper) setAcople(prev => ({ ...prev, jalon: firstBumper.id }));
      }

      let requiredGato = acople.gato; let requiredSusp = rodado.suspension; let validGatos = [];
      if (rodado.capacidad === '850kg') { validGatos = ['tubo_2k']; requiredSusp = 'susp_1_5t'; } 
      else if (['1_5t', '1_5t_3500', '1_5t_5200'].includes(rodado.capacidad)) { validGatos = ['normal_2k']; requiredSusp = 'susp_1_5t'; } 
      else if (rodado.capacidad === '3t') {
          validGatos = ['normal_2k', 'manual_7k'];
          if (carroceria.redila === 'sin_redila' && !validGatos.includes(acople.gato)) requiredGato = 'manual_7k';
          else if (carroceria.redila !== 'sin_redila' && !validGatos.includes(acople.gato)) requiredGato = 'normal_2k';
          requiredSusp = 'susp_3t';
      } 
      else if (rodado.capacidad === '4t') { validGatos = ['manual_7k']; requiredSusp = 'susp_3t'; } 
      else if (rodado.capacidad === '6t') { validGatos = ['manual_7k', 'manual_12k']; if (carroceria.redila === 'sin_redila') requiredGato = 'manual_12k'; requiredSusp = 'susp_6t'; }
      if (!validGatos.includes(requiredGato)) requiredGato = validGatos[0] || 'normal_2k';
      setAcople(prev => ({ ...prev, gato: requiredGato }));
      setRodado(prev => ({ ...prev, suspension: requiredSusp }));

    } else if (tipoRemolque === 'cama_alta') {
      setDim(prev => ({ ...prev, ancho: '96in', largo: CAMA_ALTA_LARGOS.includes(prev.largo) ? prev.largo : '20ft' }));
      setCarroceria(prev => ({ ...prev, redila: 'sin_redila', frente: 'ninguno' }));
      setAcabados(prev => ({ ...prev, pintura: 'liquida' })); 
      if (rodado.portaExtra < 1) setRodado(prev => ({ ...prev, portaExtra: 1 }));
      if (!CAMA_ALTA_CAPS.includes(rodado.capacidad)) setRodado(prev => ({ ...prev, capacidad: '6t' }));
      if (!['manual_12k', 'hidraulico_sencillo', 'hidraulico_bomba'].includes(acople.gato)) setAcople(prev => ({ ...prev, gato: 'manual_12k' }));
      if (!['recto_rampas', 'cola_4', 'cola_5'].includes(camaBajaOpts.rampas)) setCamaBajaOpts(prev => ({ ...prev, rampas: 'recto_rampas' }));
      if (!['madera', 'lamina_madera'].includes(acabados.piso)) setAcabados(prev => ({ ...prev, piso: 'madera' }));
      const currentJalon = db.jalones?.find(j => j.id === acople.jalon);
      if (currentJalon && !['ganso_normal', 'ganso_facil', 'argolla'].includes(currentJalon.id)) { setAcople(prev => ({ ...prev, jalon: 'ganso_facil' })); }
    
    } else if (tipoRemolque === 'volteo') {
      // 1. Validar combinaciones de Ancho y Largo para Volteo
      if (!VOLTEO_COMBOS[dim.ancho]) {
        setDim(prev => ({ ...prev, ancho: '76in', largo: '12ft' }));
      } else if (!VOLTEO_COMBOS[dim.ancho].includes(dim.largo)) {
        setDim(prev => ({ ...prev, largo: VOLTEO_COMBOS[dim.ancho][0] }));
      }

      // 2. Validar Capacidades según el Ancho elegido
      if (dim.ancho === '60in') {
        if (!['1_5t', '3t', '6t'].includes(rodado.capacidad)) setRodado(prev => ({ ...prev, capacidad: '3t' }));
      } else {
        // Para 76in y 82in solo se permite de 3 o 6 toneladas
        if (!['3t', '6t'].includes(rodado.capacidad)) setRodado(prev => ({ ...prev, capacidad: '3t' }));
      }

      // 3. Forzar Gato de 12,000 lbs obligado para volteos
      if (acople.gato !== 'manual_12k') {
        setAcople(prev => ({ ...prev, gato: 'manual_12k' }));
      }
      // Si es capacidad de 6 toneladas, por defecto asignamos 2 gatos de 12k
      if (rodado.capacidad === '6t' && acople.cantGatos < 2) {
        setAcople(prev => ({ ...prev, cantGatos: 2 }));
      }

      // 4. Caja de Herramientas OBLIGATORIA (No permitimos 'ninguna')
      if (acabados.cajaHtas === 'ninguna') {
        setAcabados(prev => ({ ...prev, cajaHtas: 'std' }));
      }

      // 5. Si lleva llanta de refacción (llantaExtra > 0), obligamos a que lleve portaextra
      if (rodado.llantaExtra > 0 && rodado.portaExtra < 1) {
        setRodado(prev => ({ ...prev, portaExtra: 1 }));
      }
// 6. Ligar la suspensión exactamente a la capacidad elegida
        let suspCorrecta = rodado.capacidad === '1_5t' ? 'susp_1_5t' : (rodado.capacidad === '6t' ? 'susp_6t' : 'susp_3t');
        if (rodado.suspension !== suspCorrecta) {
          setRodado(prev => ({ ...prev, suspension: suspCorrecta }));
        }
   } else if (tipoRemolque === 'ganadero' && tipoGanadero === 'redondo' && market === 'mexico') {
            if (!['1_5t', '3t', '6t'].includes(rodado.capacidad)) setRodado(prev => ({ ...prev, capacidad: '3t' }));
            
            if (rodado.capacidad === '1_5t') {
                if (dim.ancho !== '60in') setDim(prev => ({ ...prev, ancho: '60in' }));
                if (!['10ft', '12ft'].includes(dim.largo)) setDim(prev => ({ ...prev, largo: '12ft' }));
            } else if (rodado.capacidad === '3t') {
                if (!['60in', '76in'].includes(dim.ancho)) setDim(prev => ({ ...prev, ancho: '76in' }));
                if (!['10ft', '12ft', '14ft', '16ft'].includes(dim.largo)) setDim(prev => ({ ...prev, largo: '16ft' }));
            } else if (rodado.capacidad === '6t') {
                if (!['60in', '76in'].includes(dim.ancho)) setDim(prev => ({ ...prev, ancho: '76in' }));
                if (!['12ft', '14ft', '16ft', '18ft'].includes(dim.largo)) setDim(prev => ({ ...prev, largo: '16ft' }));
            }
        } else if (tipoRemolque === 'ganadero' && tipoGanadero === 'redondo' && market === 'usa') {
            if (dim.ancho !== '75in') setDim(prev => ({ ...prev, ancho: '75in' }));
            if (!['14ft', '16ft'].includes(dim.largo)) setDim(prev => ({ ...prev, largo: '16ft' }));
            
            if (dim.largo === '14ft') {
                if (!['2t_5200', '2t_6200'].includes(rodado.capacidad)) setRodado(prev => ({ ...prev, capacidad: '2t_5200' }));
            } else if (dim.largo === '16ft') {
                if (!['4t_5200', '4t_6200'].includes(rodado.capacidad)) setRodado(prev => ({ ...prev, capacidad: '4t_5200' }));
            }
        }
  
    // Aseguramos que el efecto escuche los cambios clave del volteo
  }, [tipoRemolque, dim.ancho, dim.largo, rodado.capacidad, carroceria.redila, db.jalones, acople.jalon, rodado.llantaExtra, tipoGanadero, market]);

  useEffect(() => {
    const maxLargo = parseInt(dim.largo.replace('ft', '')) || 0;
    if (carroceria.techoEspecialLargo > maxLargo) {
        setCarroceria(prev => ({ ...prev, techoEspecialLargo: maxLargo }));
    }
    if ((carroceria.puertasIntList || []).length > maxPuertasInt) {
        setCarroceria(prev => ({ ...prev, puertasIntList: prev.puertasIntList.slice(0, maxPuertasInt) }));
    }
    if (rodado.cantFrenos > cantEjes) setRodado(prev => ({ ...prev, cantFrenos: cantEjes }));
  }, [dim.largo, maxPuertasInt, cantEjes, tipoRemolque, carroceria.puertasIntList]);

  useEffect(() => {
    if (tipoRemolque === 'cama_alta' && acople.gato.includes('hidraulico') && acabados.cajaHtas === 'ninguna') { setAcabados(prev => ({ ...prev, cajaHtas: 'std' })); }
    if (tipoRemolque === 'ganadero') {
        const l = parseInt(dim.largo.replace('ft', '')) || 0;
        
        setAcabados(prev => {
            let tipoB = prev.tipoBody || 'ninguno';
            // Si es USA y está en "ninguno", lo forzamos a estándar. Si ya está en "full", lo respeta.
            if (isSpecialClient && market === 'usa' && tipoB === 'ninguno') tipoB = 'estandar';
            
            let b = 0;
            if (tipoB !== 'ninguno') {
                if (l <= 16) b = 10; else if (l <= 22) b = 12; else if (l <= 26) b = 14; else if (l <= 28) b = 15; else b = 16;
                if (tipoB === 'full') b += 3;
            }

            if (isSpecialClient && market === 'usa') {
                // Candado para evitar ciclos infinitos
                if (prev.pintura === 'liquida' && prev.luces === 'especial_usa' && prev.tipoBody === tipoB && prev.bodyLitros === b) return prev;
                return { ...prev, pintura: 'liquida', luces: 'especial_usa', tipoBody: tipoB, bodyLitros: b };
            }
            return (prev.bodyLitros !== b || prev.tipoBody !== tipoB) ? { ...prev, tipoBody: tipoB, bodyLitros: b } : prev;
        });

        if (isSpecialClient && market === 'usa') {
          setCarroceria(prev => ({ ...prev, polverasEspeciales: true }));
          setRodado(prev => ({ ...prev, suspension: 'torflex' }));
          setAccesorios(prev => ({ ...prev, lucesInteriores: prev.lucesInteriores > 0 ? prev.lucesInteriores : 1 }));
        } else {
          setCarroceria(prev => ({ ...prev, polverasEspeciales: false }));
          if (acople.gato === 'hidraulico_bomba') setAcople(prev => ({ ...prev, gato: 'hidraulico_sencillo' }));
        }
    }
  }, [isSpecialClient, market, tipoRemolque, dim.largo, acople.gato, acabados.cajaHtas]);

  useEffect(() => {
    if (acople.gato === 'manual' || acople.gato.includes('2k') || acople.gato.includes('7k') || acople.gato.includes('12k')) { setAcople(prev => ({ ...prev, cargadorSolar: false, cargador110: false })); } 
    else if (acople.gato.includes('hidraulico')) {
      if (isSpecialClient && market === 'usa') setAcople(prev => ({ ...prev, cargadorSolar: true, cargador110: true }));
      if (acople.gato === 'hidraulico_bomba' && acabados.cajaHtas === 'ninguna') setAcabados(prev => ({ ...prev, cajaHtas: 'std' }));
    }
  }, [acople.gato, isSpecialClient, market]);

  useEffect(() => {
    if (rodado.llantaExtra > rodado.portaExtra && tipoRemolque !== 'ganadero') { setRodado(prev => ({ ...prev, portaExtra: prev.llantaExtra })); }
    if (tipoRemolque === 'cama_alta' && rodado.capacidad === '10t' && rodado.llanta !== '17_5in') setRodado(prev => ({...prev, llanta: '17_5in'}));
  }, [rodado.llantaExtra, rodado.portaExtra, tipoRemolque, rodado.capacidad, rodado.llanta]);

const anchosDisponibles = tipoRemolque === 'volteo' 
    ? db.anchos?.filter(a => ['60in', '76in', '82in'].includes(a.id)) || [] 
    : tipoRemolque === 'cama_baja' 
    ? db.anchos?.filter(a => Object.keys(CAMA_BAJA_COMBOS).includes(a.id)) || [] 
    : tipoRemolque === 'cama_alta' 
    ? db.anchos?.filter(a => a.id === '96in') || [] 
    : isGanaderoRedondoMex 
    ? db.anchos?.filter(a => ['60in', '76in'].includes(a.id)) || [] 
    : isGanaderoRedondoUSA 
    ? db.anchos?.filter(a => ['75in'].includes(a.id)) || [] 
    : db.anchos?.filter(a => !['50in', '75in', '76in', '82in'].includes(a.id)) || [];

  const largosDisponibles = tipoRemolque === 'volteo' && VOLTEO_COMBOS[dim.ancho] 
    ? db.largos?.filter(l => VOLTEO_COMBOS[dim.ancho].includes(l.id)) || [] 
    : tipoRemolque === 'cama_baja' && CAMA_BAJA_COMBOS[dim.ancho] 
    ? db.largos?.filter(l => CAMA_BAJA_COMBOS[dim.ancho].includes(l.id)) || [] 
    : tipoRemolque === 'cama_alta' 
    ? db.largos?.filter(l => CAMA_ALTA_LARGOS.includes(l.id)) || [] 
    : isGanaderoRedondoMex 
    ? db.largos?.filter(l => {
        if (rodado.capacidad === '1_5t') return ['10ft', '12ft'].includes(l.id);
        if (rodado.capacidad === '3t') return ['10ft', '12ft', '14ft', '16ft'].includes(l.id);
        if (rodado.capacidad === '6t') return ['12ft', '14ft', '16ft', '18ft'].includes(l.id);
        return false;
      }) || [] 
    : isGanaderoRedondoUSA 
    ? db.largos?.filter(l => ['14ft', '16ft'].includes(l.id)) || [] 
    : db.largos?.filter(l => l.valor >= 16) || [];

  const capacidadesDisponibles = tipoRemolque === 'volteo' 
    ? db.capacidades?.filter(c => dim.ancho === '60in' ? ['1_5t', '3t', '6t'].includes(c.id) : ['3t', '6t'].includes(c.id)) || [] 
    : tipoRemolque === 'cama_baja' 
    ? db.capacidades?.filter(c => getCapacidadesCamaBaja(dim.ancho, dim.largo).includes(c.id)) || [] 
    : tipoRemolque === 'cama_alta' 
    ? db.capacidades?.filter(c => CAMA_ALTA_CAPS.includes(c.id)) || [] 
    : isGanaderoRedondoMex 
    ? db.capacidades?.filter(c => ['1_5t', '3t', '6t'].includes(c.id)) || [] 
    : isGanaderoRedondoUSA 
    ? db.capacidades?.filter(c => dim.largo === '14ft' ? ['2t_5200', '2t_6200'].includes(c.id) : ['4t_5200', '4t_6200'].includes(c.id)) || [] 
    : db.capacidades?.filter(c => {
        if (['2t_5200', '2t_6200', '4t_5200', '4t_6200'].includes(c.id)) return acople.jalon.includes('ganso') && rodado.suspension === 'muelle_drop';
        return ['3t', '6t', '7t', '9t', '10t'].includes(c.id);
      }) || [];
const jalonesDisponibles = tipoRemolque === 'volteo' ? db.jalones?.filter(j => ['bumper_2', 'bumper_2_516', 'bumper_ajustable_2', 'bumper_ajustable_2_516', 'argolla', 'ganso_normal', 'ganso_facil'].includes(j.id)) || [] : tipoRemolque === 'cama_baja' ? db.jalones?.filter(j => j.tipo !== 'ganso') || [] : tipoRemolque === 'cama_alta' ? db.jalones?.filter(j => ['ganso_normal', 'ganso_facil', 'argolla'].includes(j.id)) || [] : (tipoRemolque === 'ganadero' && tipoGanadero === 'redondo') ? db.jalones?.filter(j => j.tipo !== 'ganso') || [] : db.jalones || [];
  const gatosDisponibles = tipoRemolque === 'volteo' ? db.gatos?.filter(g => g.id === 'manual_12k') || [] : tipoRemolque === 'cama_baja' ? db.gatos?.filter(g => { const cap = rodado.capacidad; if (cap === '850kg') return g.id === 'tubo_2k'; if (['1_5t', '1_5t_3500', '1_5t_5200'].includes(cap)) return g.id === 'normal_2k'; if (cap === '3t') return ['normal_2k', 'manual_7k'].includes(g.id); if (cap === '4t') return g.id === 'manual_7k'; if (cap === '6t') return ['manual_7k', 'manual_12k'].includes(g.id); return true; }) || [] : tipoRemolque === 'cama_alta' ? db.gatos?.filter(g => ['manual_12k', 'hidraulico_sencillo', 'hidraulico_bomba'].includes(g.id)) || [] : db.gatos?.filter(g => {
      if (market === 'usa') return ['manual_12k', 'hidraulico_sencillo', 'hidraulico_bomba'].includes(g.id);
      if (!isSpecialClient && g.id === 'hidraulico_bomba') return false;
      if (carroceria.frente === 'ninguno') {
          if (['3t', '2t_5200', '2t_6200'].includes(rodado.capacidad)) return g.id === 'normal_2k';
          return ['manual_7k', 'manual_12k'].includes(g.id);
      }
      return !['tubo_2k', 'normal_2k', 'manual_7k', 'manual_12k'].includes(g.id);
  }) || [];
  const suspensionesDisponibles = ['volteo', 'cama_baja'].includes(tipoRemolque) ? db.suspension?.filter(s => {
      if (['850kg', '1_5t'].includes(rodado.capacidad)) return s.id === 'susp_1_5t';
      if (['3t', '4t'].includes(rodado.capacidad)) return s.id === 'susp_3t';
      if (rodado.capacidad === '6t') return s.id === 'susp_6t';
      return false;
  }) || [] : db.suspension?.filter(s => ['muelle', 'torflex', 'muelle_drop'].includes(s.id)) || [];
  const llantasDisponibles = tipoRemolque === 'cama_baja' ? db.llantas?.filter(l => { const cap = rodado.capacidad; if (['850kg', '1_5t', '1_5t_3500', '1_5t_5200'].includes(cap)) return ['700_15', '225_75_15', 'ninguna'].includes(l.id); if (cap === '3t') return ['700_15', '235_80_16', 'ninguna'].includes(l.id); if (cap === '4t') return ['225_75_15', 'ninguna'].includes(l.id); if (cap === '6t') return ['235_80_16', '235_80_16_14', 'ninguna'].includes(l.id); return true; }) || [] : tipoRemolque === 'cama_alta' ? db.llantas?.filter(l => rodado.capacidad === '10t' ? ['17_5in', 'ninguna'].includes(l.id) : ['235_80_16', '16in_10', '16in_14', '235_80_16_14', 'ninguna'].includes(l.id)) || [] : db.llantas?.filter(l => ['16in_10', '16in_14', '235_80_16_14', '17_5in', 'ninguna'].includes(l.id)) || [];
  const pisosDisponibles = tipoRemolque === 'volteo' ? db.pisos?.filter(p => ['madera', 'lamina_madera'].includes(p.id)) || [] : tipoRemolque === 'cama_baja' ? db.pisos?.filter(p => ['madera', 'duela_laminada'].includes(p.id)) || [] : tipoRemolque === 'cama_alta' ? db.pisos?.filter(p => ['madera', 'lamina_madera'].includes(p.id)) || [] : db.pisos?.filter(p => ['madera', 'hule_liso', 'hule_anti'].includes(p.id)) || [];
const redilasDisponibles = tipoRemolque === 'cama_baja' ? db.redilas?.filter(r => ['sin_redila', 'ptr_abierta_2', 'ptr_abierta_3', 'ptr_abierta_4', 'cerrada_2', 'cerrada_3', 'cerrada_4'].includes(r.id)) || [] : isGanaderoRedondoMex ? db.redilas?.filter(r => ['ptr_abierta', 'cerrada', 'combinada', 'desmontable'].includes(r.id)) || [] : db.redilas?.filter(r => ['ptr_abierta', 'cerrada', 'combinada'].includes(r.id)) || [];
  const monturerosDisponibles = (tipoRemolque === 'ganadero' && tipoGanadero === 'redondo' && market === 'usa') ? db.montureros?.filter(m => ['ninguno', 'recto_3', 'recto_4'].includes(m.id)) || [] : db.montureros || [];
const rampasDisponibles = tipoRemolque === 'cama_baja' ? db.rampas?.filter(r => { if (r.id === 'ninguna' || r.id === 'puerta_rampa') return true; const is82 = dim.ancho === '82in'; if (r.id === 'rampa_1_5m') return is82 && carroceria.redila === 'sin_redila'; if (r.id === 'rampa_39') return is82 && carroceria.redila !== 'sin_redila'; return false; }) || [] : tipoRemolque === 'cama_alta' ? db.rampas?.filter(r => ['recto_rampas', 'cola_4', 'cola_5'].includes(r.id)) || [] : [];
    const lucesDisponibles = db.luces?.filter(l => market === 'usa' ? l.id.includes('_usa') : l.id.includes('_mexico')) || [];
    
let capacidadLbs = '7,000 LBS';
  if (tipoRemolque === 'cama_alta') { 
      if (oCap.id === '6t' || oCap.id === '9t') capacidadLbs = '7,000 LBS'; 
      if (oCap.id === '10t') capacidadLbs = rodado.cantEjesGanso === 3 ? '8,000 LBS' : '10,000 LBS'; 
  } 
  else { 
      if (['7t', '9t', '10t'].includes(oCap.id)) capacidadLbs = oCap.id === '10t' ? (rodado.cantEjesGanso === 3 ? '8,000 LBS' : '10,000 LBS') : (oCap.id === '9t' ? '7,000 LBS' : '8,000 LBS'); 
      else if (['850kg', '1_5t', '3t'].includes(oCap.id)) capacidadLbs = '3,500 LBS'; 
      else if (oCap.id.includes('5200')) capacidadLbs = '5,200 LBS'; 
      else if (oCap.id.includes('6200')) capacidadLbs = '6,200 LBS'; 
      else if (oCap.id === '6t') capacidadLbs = '7,000 LBS'; 
  }
  let marcaEje = rodado.suspension === 'torflex' ? 'IMPORTADO TORFLEX' : (capacidadLbs === '10,000 LBS' ? 'LIPPERT' : 'DEXTER');
  let medidasEje = '';
  if (tipoRemolque === 'cama_alta') { 
    if (oCap.id === '10t') medidasEje = 'C/F 48" Doble Rodado'; else medidasEje = 'C/F 67"'; 
  } else if (tipoRemolque === 'volteo') {
    // REGLAS EXACTAS DE VOLTEO (58", 74", 80")
    if (dim.ancho === '60in') medidasEje = 'C/F 58"';
    else if (dim.ancho === '76in') medidasEje = 'C/F 74"';
    else if (dim.ancho === '82in') medidasEje = 'C/F 80"';
  } else { 
    if (rodado.suspension === 'torflex') medidasEje = (oAncho.valor >= 78) ? 'C/F 78.5' : 'C/F 60.5'; 
    else if (capacidadLbs === '10,000 LBS') medidasEje = 'C/F HF=91 OB=68.25'; 
    else { if (oAncho.valor === 60) medidasEje = 'C/F HF=76 OB=60.5'; else if (oAncho.valor === 72 && capacidadLbs === '8,000 LBS') medidasEje = 'C/F HF=87.88 OB=72.5'; else if (oAncho.valor === 72) medidasEje = 'C/F HF=76 OB=60.5'; else medidasEje = 'C/F HF=93.25 OB=78.5'; } 
  }
  const nombreEjeCompleto = `EJE ${marcaEje} ${capacidadLbs} ${medidasEje}`;
  const calcLargoPulgadas = (oLargo.valor || 0) * 12;
  const cableAzulMts = rodado.cantFrenos > 0 ? (calcLargoPulgadas + 96 + (rodado.cantFrenos * oAncho.valor)) * 0.0254 : 0;
  
  let llantasPorEje = (tipoRemolque === 'cama_alta' && rodado.capacidad === '10t') ? 4 : 2;
  let cantLlantasTotal = (cantEjes * llantasPorEje) + rodado.llantaExtra;
  const hojasPlexiCalculadas = carroceria.plexiglass && piesPlexi > 0 ? Math.ceil(piesPlexi / (Math.floor(96 / 8.25) * 4)) : 0;

   if (!isCloudLoaded) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <Truck className="w-16 h-16 text-amber-500 animate-bounce mb-4" />
        <h2 className="text-white font-black text-2xl tracking-widest uppercase">Sincronizando</h2>
        <p className="text-slate-400 font-medium">Conectando con la nube empresarial...</p>
      </div>
    );
  }

  if (!isAuthenticated || !currentUser) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
          <div className="text-center mb-8"><h1 className="text-2xl font-black text-slate-900">AMACSA ERP</h1><p className="text-slate-500 font-medium">Sistema de Cotización en la Nube</p></div>
          <form onSubmit={handleLogin}>
            <div className="mb-4">
              <label className="block text-sm font-bold text-slate-700 mb-2">Usuario</label>
              <div className="relative"><User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" /><input type="text" value={loginUser} onChange={(e) => setLoginUser(e.target.value)} className="w-full p-3 pl-10 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none font-medium" placeholder="ej. admin" /></div>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-bold text-slate-700 mb-2">Contraseña</label>
              <div className="relative"><Key className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" /><input type="password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} className="w-full p-3 pl-10 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none font-medium" placeholder="••••••••" /></div>
              {loginError && <p className="text-red-500 text-sm font-bold mt-2">{loginError}</p>}
            </div>
            <div className="mb-6 flex items-center">
              <input type="checkbox" id="rememberMe" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="mr-2 w-4 h-4 text-green-600 rounded focus:ring-green-500 border-slate-300 cursor-pointer" />
              <label htmlFor="rememberMe" className="text-sm font-bold text-slate-700 cursor-pointer">Mantener sesión iniciada</label>
            </div>
            <button type="submit" className="w-full bg-green-600 hover:bg-green-700 text-white font-black py-3 rounded-lg transition">Ingresar al Sistema</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white font-sans pb-12">
      {notification && (
  <div className="fixed inset-0 bg-slate-900/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
    <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-sm w-full text-center z-50 animar-entrada">
            <div className={`mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-4 ${notification.type === 'error' ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}><Shield className="w-6 h-6" /></div>
            <h3 className="text-xl font-black mb-2 text-slate-800">{notification.type === 'error' ? 'Aviso Importante' : '¡Éxito!'}</h3>
            <p className="text-slate-600 font-medium mb-6">{notification.message}</p>
            <button onClick={() => setNotification(null)} className="bg-green-600 hover:bg-green-700 text-white px-6 py-2.5 rounded-xl font-bold w-full transition">Entendido</button>
          </div>
        </div>
      )}

      {confirmDialog && (
  <div className="fixed inset-0 bg-slate-900/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
    <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-sm w-full text-center z-50 animar-entrada">
            <div className="mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-4 bg-amber-100 text-amber-600"><Lock className="w-6 h-6" /></div>
            <h3 className="text-xl font-black mb-2 text-slate-800">{confirmDialog.title}</h3>
            <p className="text-slate-600 font-medium mb-6">{confirmDialog.message}</p>
            <div className="flex space-x-3">
               <button onClick={() => setConfirmDialog(null)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-800 px-4 py-2.5 rounded-xl font-bold transition">Cancelar</button>
               <button onClick={executeConfirm} className="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-xl font-bold transition shadow-md shadow-red-500/30">Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {adminUnlockPrompt && (
  <div className="fixed inset-0 bg-slate-900/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
    <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-sm w-full z-50 animar-entrada">
            <div className="text-center mb-6"><div className="mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-3 bg-slate-100 text-slate-700"><Settings className="w-6 h-6" /></div><h3 className="text-xl font-black text-slate-800">Candado de Seguridad</h3><p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">Acceso a Catálogo</p></div>
            <form onSubmit={handleUnlockSubmit}>
               <input type="password" autoFocus value={adminUnlockPass} onChange={e => setAdminUnlockPass(e.target.value)} className="w-full p-3.5 border-2 border-slate-200 focus:border-green-500 rounded-xl mb-6 text-center tracking-[0.5em] font-black text-lg outline-none transition" placeholder="••••••••" />
               <div className="flex space-x-3">
                 <button type="button" onClick={() => setAdminUnlockPrompt(false)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-3 rounded-xl font-bold transition">Volver</button>
                 <button type="submit" className="flex-1 bg-green-600 hover:bg-green-700 text-white px-4 py-3 rounded-xl font-black transition shadow-lg shadow-green-500/30">Desbloquear</button>
               </div>
            </form>
          </div>
        </div>
      )}

      {/* === MENÚ LATERAL (SIDEBAR) === */}
      {/* Fondo oscuro cuando está abierto */}
      {isMenuOpen && (
        <div className="fixed inset-0 bg-slate-900/60 z-[60] backdrop-blur-sm transition-opacity" onClick={() => setIsMenuOpen(false)}></div>
      )}
      {/* Panel Desplegable */}
      <div className={`fixed inset-y-0 left-0 w-72 bg-slate-900 shadow-2xl z-[70] transform transition-transform duration-300 ease-in-out flex flex-col ${isMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="h-8 bg-white rounded p-1"><img src="/logo_amacsa.png" alt="AMACSA" className="h-full object-contain" /></div>
            <span className="font-black text-white tracking-widest">MENÚ</span>
          </div>
          <button onClick={() => setIsMenuOpen(false)} className="text-slate-400 hover:text-white transition bg-slate-800 p-1.5 rounded-lg"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-3 flex-1 overflow-y-auto">
          <button onClick={() => { setView('ensambles'); setIsMenuOpen(false); }} className={`w-full flex items-center space-x-3 px-4 py-3.5 rounded-xl font-bold transition ${view === 'ensambles' ? 'bg-green-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}><Layers className="w-5 h-5"/><span>Precios de lista y ensambles</span></button>
          <button onClick={() => { setView('cotizador'); setIsMenuOpen(false); }} className="w-full flex items-center space-x-3 px-4 py-3.5 rounded-xl font-bold text-slate-300 hover:bg-slate-800"><Truck className="w-5 h-5"/><span>Cotizador detallado anterior</span></button>

          <button onClick={() => { setView('catalogo'); setIsMenuOpen(false); }} className={`w-full flex items-center space-x-3 px-4 py-3.5 rounded-xl font-bold transition-all duration-300 active:scale-95 ${view === 'catalogo' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50 -translate-y-0.5' : 'text-slate-300 hover:bg-slate-800 hover:text-white hover:-translate-y-1 hover:shadow-md'}`}>
            <span className="text-xl leading-none">📖</span> <span>Catálogo de Modelos</span>
          </button>
          <button onClick={() => { handleAdminAccess(); setIsMenuOpen(false); }} className={`w-full flex items-center space-x-3 px-4 py-3.5 rounded-xl font-bold transition-all duration-300 active:scale-95 ${view === 'admin' ? 'bg-amber-600 text-white shadow-lg shadow-amber-900/50 -translate-y-0.5' : 'text-slate-300 hover:bg-slate-800 hover:text-white hover:-translate-y-1 hover:shadow-md'}`}>
            <Settings className="w-5 h-5"/> <span>Configuraciones</span>
          </button>
        </div>
        <div className="p-4 border-t border-slate-800 text-[10px] font-bold text-slate-500 text-center uppercase tracking-widest">
          AMACSA ERP V2.0
        </div>
      </div>

      {/* HEADER PRINCIPAL */}
      <header className="bg-green-950 border-b-4 border-green-600 text-white p-3 sm:p-4 sticky top-0 z-50 flex justify-between items-center shadow-lg print:hidden">
        <div className="flex items-center space-x-3 sm:space-x-4">
          <button onClick={() => setIsMenuOpen(true)} className="p-2 bg-slate-800 hover:bg-green-500 hover:text-white rounded-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-green-500/50 active:scale-95 text-slate-300"><Menu className="w-6 h-6"/></button>
          <div className="relative h-10 sm:h-11 flex items-center justify-center min-w-[40px] sm:min-w-[45px] bg-white rounded-lg p-1.5 shadow-inner hidden sm:flex"><img src="/logo_amacsa.png" alt="AMACSA" className="h-full object-contain" /></div>
          <div><h1 className="text-xl sm:text-2xl font-black tracking-widest leading-none text-white">AMACSA</h1><p className="text-[9px] sm:text-[10px] text-amber-400 font-black tracking-[0.2em] uppercase mt-0.5">ERP Ventas</p></div>
        </div>
        
        <div className="flex items-center space-x-2">
          <div className="hidden lg:block text-right mr-3"><p className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Usuario activo</p><p className="text-sm font-bold text-white leading-tight">{currentUser.name}</p></div>
          
          {view === 'cotizador' ? (
            <>
              <button onClick={handleNuevaCotizacion} className="p-2.5 sm:p-3 bg-red-600 hover:bg-red-500 rounded-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-red-500/50 active:scale-95 text-white flex items-center justify-center" title="Nueva Cotización"><RefreshCw className="w-5 h-5"/></button>
              <button onClick={() => window.print()} className="p-2.5 sm:p-3 bg-green-600 hover:bg-green-500 rounded-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-green-500/50 active:scale-95 text-white flex items-center justify-center" title="Imprimir Cotización"><Printer className="w-5 h-5"/></button>
              <button onClick={() => { setEsHojaDiseno(true); setTimeout(() => { window.print(); setEsHojaDiseno(false); }, 100); }} className="p-2.5 sm:p-3 bg-slate-800 hover:bg-slate-700 rounded-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-slate-900/50 active:scale-95 text-white mr-1 sm:mr-3 flex items-center justify-center text-lg leading-none" title="Imprimir Hoja de Diseño">🖨️</button>
            </>
          ) : (
            <button onClick={() => setView('cotizador')} className="p-2.5 sm:p-3 bg-green-600 hover:bg-green-500 rounded-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-green-500/50 active:scale-95 text-white flex items-center justify-center mr-1 sm:mr-3" title="Volver al Cotizador"><Save className="w-5 h-5"/></button>
          )}
          <div className="w-px h-8 bg-slate-700 mx-1 hidden sm:block"></div>
          <button onClick={handleLogout} className="p-2.5 sm:p-3 bg-slate-800 hover:bg-red-600 rounded-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-red-500/50 active:scale-95 text-slate-400 hover:text-white flex items-center justify-center" title="Cerrar Sesión"><LogOut className="w-5 h-5"/></button>
        </div>
      </header>

      {view === 'ensambles' ? (
        <CotizadorEnsambles db={db} currentUser={currentUser} carga={cargaEnsambles}
          onGuardarRegistro={handleGuardarRegistroEnsambles}
          onEliminarRegistro={handleEliminarRegistroEnsambles}
          onGuardarCotizacion={handleGuardarCotizacionEnsambles} />
      ) : view === 'catalogo' ? (
        <div className="max-w-[1400px] mx-auto p-4 sm:p-6 animar-entrada print:p-0 print:max-w-none">
          
          <div className="flex justify-between items-center mb-8 border-b-4 border-slate-900 pb-3 print:border-b-2">
            <div className="flex items-center">
              <span className="text-3xl mr-3 print:hidden">📖</span>
              <img src="/logo_amacsa.png" alt="AMACSA" className="h-10 hidden print:block mr-4 object-contain" />
              <h2 className="text-3xl font-black text-slate-800 tracking-tight">Catálogo de Modelos de Línea</h2>
            </div>
           <button onClick={() => window.print()} className="print:hidden bg-slate-800 hover:bg-slate-700 text-white font-black py-2.5 px-5 rounded-xl flex items-center transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-slate-700/50 active:scale-95">
              <Printer className="w-5 h-5 mr-2" /> Imprimir Catálogo
            </button>
          </div>

          {/* Ajustamos la cuadrícula para que en impresión salgan 2 o 3 columnas y no se desparrame */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 print:grid-cols-2 print:gap-4 gap-6">
            {db.modelosLinea?.map(item => (
              <div key={item.id} className="bg-white rounded-2xl shadow-lg overflow-hidden border border-slate-200 hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 flex flex-col print:shadow-none print:border-2 print:border-slate-300 print:break-inside-avoid print:rounded-xl">
                
                <div className="h-56 bg-slate-100 relative group print:h-48 print:bg-transparent">
                  <img src={item.foto || '/img_ganso.png'} alt={item.nombre} className="w-full h-full object-cover transition duration-500 group-hover:scale-110 print:object-contain" onError={e => e.target.src='/img_ganso.png'} />
                  <div className="absolute top-3 right-3 bg-amber-500 text-white text-xs font-black px-3 py-1.5 rounded-lg shadow-md tracking-wider print:bg-white print:text-slate-800 print:border print:border-slate-400 print:shadow-none">ESTÁNDAR</div>
                </div>
                
                <div className="p-5 flex flex-col flex-1 print:p-4">
                  <h3 className="font-black text-slate-800 text-xl leading-tight mb-2 print:text-lg">{item.nombre}</h3>
                  <p className="text-sm text-slate-600 font-medium mb-4 flex-1 whitespace-pre-wrap print:text-xs print:mb-2">{item.especificaciones}</p>
                  
                  <div className="border-t border-slate-100 pt-4 flex justify-between items-end mt-auto print:border-slate-300 print:pt-2">
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 print:text-slate-500">Precio Referencia</p>
                      <span className="text-2xl font-black text-blue-700 print:text-slate-900 print:text-xl">{formatoMoneda(item.precio)}</span>
                    </div>
                    {/* Ocultamos el botón al imprimir */}
                    {/* Ocultamos el botón al imprimir */}
                    <button onClick={() => handleCotizarDesdeCatalogo(item)} className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-slate-700/50 active:scale-95 print:hidden">Ir a Cotizar</button>
                  </div>
                </div>
                
              </div>
            ))}

            {(!db.modelosLinea || db.modelosLinea.length === 0) && (
              <div className="col-span-full py-16 text-center bg-white rounded-2xl border border-dashed border-slate-300 print:hidden">
                <span className="text-5xl block mb-3 opacity-50">📖</span>
                <p className="text-slate-500 font-bold text-lg">No hay modelos de línea registrados.</p>
                <p className="text-slate-400 text-sm mt-1">Agrega tus remolques más populares desde el cotizador.</p>
              </div>
            )}
          </div>
        </div>
      ) : view === 'admin' ? (
        <div className="max-w-[1400px] mx-auto p-4 sm:p-6 flex flex-col md:flex-row gap-6 print:hidden">
          <div className="w-full md:w-1/4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
            <h2 className="text-lg font-black text-slate-800 mb-4 border-b pb-2">Panel de Control</h2>
            <div className="flex flex-col space-y-1 h-[75vh] overflow-y-auto pr-2">
              <div className="text-xs font-black text-slate-400 uppercase tracking-widest mt-2 mb-1 px-4">Historial</div>
              <button onClick={() => setAdminSection('cotizaciones')} className={`flex items-center text-left px-4 py-3 rounded-lg text-sm font-bold transition ${adminSection === 'cotizaciones' ? 'bg-green-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}><FileText className="w-4 h-4 mr-2"/> Cotizaciones Guardadas</button>
              
              <div className="text-xs font-black text-slate-400 uppercase tracking-widest mt-6 mb-1 px-4">Catálogo</div>
              <button onClick={() => setAdminSection('modelosLinea')} className={`text-left px-4 py-3 rounded-lg text-sm font-bold transition ${adminSection === 'modelosLinea' ? 'bg-green-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}>Modelos de Línea (Estándar)</button>

              {currentUser?.role === 'admin' && (
                <>
                  <div className="text-xs font-black text-slate-400 uppercase tracking-widest mt-6 mb-1 px-4">Inventario y Precios</div>
                  {ADMIN_SECTIONS.filter(sec => sec.id !== 'modelosLinea').map(sec => (
                    <button key={sec.id} onClick={() => setAdminSection(sec.id)} className={`text-left px-4 py-3 rounded-lg text-sm font-bold transition ${adminSection === sec.id ? 'bg-green-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}>{sec.title}</button>
                  ))}
                </>
              )}

              <div className="text-xs font-black text-slate-400 uppercase tracking-widest mt-6 mb-1 px-4">Mi Cuenta</div>
              <button onClick={() => setAdminSection('perfil')} className={`flex items-center text-left px-4 py-3 rounded-lg text-sm font-bold transition ${adminSection === 'perfil' ? 'bg-amber-500 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}><User className="w-4 h-4 mr-2"/> Mi Perfil</button>

              {currentUser?.role === 'admin' && (
                <>
                  <div className="text-xs font-black text-slate-400 uppercase tracking-widest mt-6 mb-1 px-4">Seguridad</div>
                  <button onClick={() => setAdminSection('usuarios')} className={`flex items-center text-left px-4 py-3 rounded-lg text-sm font-bold transition ${adminSection === 'usuarios' ? 'bg-amber-500 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}><Users className="w-4 h-4 mr-2"/> Gestión de Usuarios</button>
                  <button onClick={() => setAdminSection('logs')} className={`flex items-center text-left px-4 py-3 rounded-lg text-sm font-bold transition ${adminSection === 'logs' ? 'bg-amber-500 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}><History className="w-4 h-4 mr-2"/> Bitácora de Cambios</button>
                </>
              )}
            </div>
          </div>
          <div className="w-full md:w-3/4 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
             {currentUser?.role !== 'admin' && adminSection !== 'cotizaciones' && adminSection !== 'perfil' ? (
                <div className="py-16 text-center">
                   <span className="text-4xl block mb-2">🔒</span>
                   <h3 className="text-xl font-black text-slate-800">Acceso Restringido</h3>
                   <p className="text-slate-500 text-sm mt-1">Solo los administradores pueden modificar precios y catálogos.</p>
                </div>
             ) : adminSection === 'cotizaciones' ? (
                <div>
                   <h2 className="text-2xl font-black text-slate-800 border-b pb-3 mb-6">Cotizaciones Guardadas</h2>
                   <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[70vh]">
                     <table className="w-full text-left text-sm">
                       <thead className="bg-slate-100 text-slate-600 font-bold sticky top-0 shadow-sm"><tr><th className="p-3 border-b">Folio</th><th className="p-3 border-b">Fecha</th><th className="p-3 border-b">Cliente</th><th className="p-3 border-b">Remolque</th><th className="p-3 border-b text-right">Total Net</th><th className="p-3 border-b text-center">Acciones</th></tr></thead>
                       <tbody>
                         {cotizaciones.length === 0 ? <tr><td colSpan="6" className="p-6 text-center text-slate-500">No hay cotizaciones registradas en la nube.</td></tr> : cotizaciones.map((cot, i) => (
                           <tr key={i} className="border-b last:border-0 hover:bg-slate-50">
                             <td className="p-3 font-black text-green-700">{cot.id}</td><td className="p-3 text-slate-600 font-medium">{cot.fecha}</td><td className="p-3 font-bold text-slate-800">{cot.cliente}</td><td className="p-3 text-slate-600">{cot.remolque} ({cot.medida})</td><td className="p-3 font-black text-slate-800 text-right">{cot.total}</td>
                             <td className="p-3 text-center space-x-2 whitespace-nowrap">
                                  {cot.pdfUrl && (
                                    <a href={cot.pdfUrl} target="_blank" rel="noopener noreferrer" className="bg-blue-50 hover:bg-blue-100 text-blue-600 px-3 py-1.5 rounded text-xs font-black transition border border-blue-200 shadow-sm inline-block" title="Abrir PDF Original">Ver PDF</a>
                                  )}
                                  <button onClick={() => handleCargarCotizacion(cot)} className="bg-green-50 hover:bg-green-100 text-green-600 px-3 py-1.5 rounded text-xs font-black transition border border-green-200 shadow-sm">Cargar</button>
<button onClick={() => handleDuplicarCotizacion(cot)} className="bg-amber-50 hover:bg-amber-100 text-amber-700 px-3 py-1.5 rounded text-xs font-black transition border border-amber-200 shadow-sm">Duplicar</button>
                                  <button onClick={() => handleEliminarCotizacion(cot.id)} className="text-red-500 hover:text-red-700 p-1 transition align-middle" title="Eliminar del historial"><Trash2 className="w-5 h-5 inline" /></button>
                                </td>
                           </tr>
                         ))}
                       </tbody>
                     </table>
                   </div>
                </div>
             ) : adminSection === 'perfil' ? (
                <div>
                  <h2 className="text-2xl font-black text-slate-800 border-b pb-3 mb-6">Mi Perfil</h2>
                  <div className="bg-slate-50 p-5 rounded-lg border border-slate-200 mb-6 max-w-lg">
                    <form onSubmit={handleUpdateProfile} className="space-y-4">
                      <div><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Nombre Completo</label><input type="text" value={profileForm.name} onChange={e => setProfileForm({...profileForm, name: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md font-medium" /></div>
                      <div><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Usuario de Acceso</label><input type="text" value={profileForm.username} onChange={e => setProfileForm({...profileForm, username: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md font-medium" /></div>
                      <div><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Contraseña</label><input type="text" value={profileForm.password} onChange={e => setProfileForm({...profileForm, password: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md font-medium" /></div>
                      <div className="text-right pt-2"><button type="submit" className="bg-green-600 hover:bg-green-500 text-white px-6 py-2 rounded-lg text-sm font-bold shadow-sm">Guardar Cambios</button></div>
                    </form>
                  </div>
                </div>
             ) : adminSection === 'usuarios' && currentUser?.role === 'admin' ? (
                <div>
                  <h2 className="text-2xl font-black text-slate-800 border-b pb-3 mb-6">Gestión de Usuarios</h2>
                  <div className="bg-slate-50 p-5 rounded-lg border border-slate-200 mb-6">
                    <form onSubmit={handleAddUser} className="grid grid-cols-1 sm:grid-cols-5 gap-4 items-end">
                      <div className="sm:col-span-2"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Nombre Completo</label><input type="text" value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md font-medium" placeholder="Ej. Juan Pérez" /></div>
                      <div><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Usuario</label><input type="text" value={newUser.username} onChange={e => setNewUser({...newUser, username: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md font-medium" placeholder="ej. juanp" /></div>
                      <div><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Contraseña</label><input type="text" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md font-medium" placeholder="***" /></div>
                      <div><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Rol</label><select value={newUser.role} onChange={e => setNewUser({...newUser, role: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md font-bold text-slate-700"><option value="sales">Ventas</option><option value="admin">Admin</option></select></div>
                      <div className="sm:col-span-5 text-right mt-2"><button type="submit" className="bg-green-600 hover:bg-green-500 text-white px-6 py-2 rounded-lg text-sm font-bold shadow-sm">Agregar Usuario</button></div>
                    </form>
                  </div>
                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-100 text-slate-600 font-bold"><tr><th className="p-3 border-b">Nombre</th><th className="p-3 border-b">Usuario</th><th className="p-3 border-b">Rol</th><th className="p-3 border-b text-right">Acciones</th></tr></thead>
                      <tbody>
                        {users.map(u => (
                          <tr key={u.id} className="border-b last:border-0 hover:bg-slate-50">
                            <td className="p-3 font-medium text-slate-800">{u.name}</td><td className="p-3 text-slate-600">{u.username}</td>
                            <td className="p-3"><span className={`px-2 py-1 rounded text-xs font-bold ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}`}>{u.role === 'admin' ? 'Administrador' : 'Ventas'}</span></td>
                            <td className="p-3 text-right"><button onClick={() => handleDeleteUser(u.id, u.name)} disabled={u.id === currentUser.id} className="text-red-500 hover:text-red-700 disabled:opacity-30 transition p-1"><Trash2 className="w-5 h-5 inline" /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
             ) : adminSection === 'logs' && currentUser?.role === 'admin' ? (
                <div>
                   <div className="flex justify-between items-center mb-6 border-b pb-3">
                      <h2 className="text-2xl font-black text-slate-800">Bitácora de Cambios</h2>
                      <button onClick={() => setConfirmDialog({ title: 'Limpiar Historial', message: '¿Borrar todo el historial de cambios permanentemente de la nube?', action: 'CLEAR_LOGS' })} className="text-sm font-bold text-red-600 hover:bg-red-50 px-3 py-1.5 rounded transition border border-red-200">Limpiar Historial</button>
                   </div>
                   <div className="max-h-[65vh] overflow-y-auto pr-2 space-y-3">
                      {logs.length === 0 ? (<p className="text-slate-500 italic text-center py-8">No hay registros de cambios recientes.</p>) : (
                        logs.map((log) => (
                          <div key={log.id} className="flex flex-col sm:flex-row sm:items-start gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm">
                            <div className="sm:w-1/4 text-slate-500 text-xs font-bold pt-0.5 whitespace-nowrap">{log.date}</div>
                            <div className="sm:w-1/4 font-black text-green-700 flex items-center"><User className="w-3 h-3 mr-1 inline"/> {log.user}</div>
                            <div className="sm:w-2/4 text-slate-700 leading-tight">{log.action}</div>
                          </div>
                        ))
                      )}
                   </div>
                </div>
             ) : (
                <div className="flex flex-col h-full">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-black text-slate-800">{ADMIN_SECTIONS.find(s => s.id === adminSection)?.title}</h2>
                    {!ADMIN_SECTIONS.find(s => s.id === adminSection)?.isFixed && (
                      <button onClick={() => handleDbAdd(adminSection)} className="flex items-center space-x-1 bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-bold transition shadow-sm">
                        <Plus className="w-5 h-5"/> <span>Agregar Elemento</span>
                      </button>
                    )}
                  </div>
                  
                  {/* MATRIZ DE PRECIOS POR TIPO DE REMOLQUE */}
                  {!ADMIN_SECTIONS.find(s => s.id === adminSection)?.isColor && adminSection !== 'preciosFijos' && (
                    <div className="flex space-x-2 mb-4 bg-slate-100 p-1.5 rounded-lg overflow-x-auto">
                      {[
                        { id: 'gen', name: 'General (Base)' },
                        { id: 'ganadero_ganso', name: 'Ganso / USA' },
                        { id: 'ganadero_ganso_mex', name: 'Ganso / Mex' },
                        { id: 'ganadero_redondo', name: 'Redondo (Mex)' },
                        { id: 'volteo', name: 'Volteo' },
                        { id: 'cama_baja', name: 'Cama Baja' },
                        { id: 'cama_alta', name: 'Cama Alta' }
                      ].map(tab => (
                        <button key={tab.id} onClick={() => setAdminTrailerTab(tab.id)} className={`px-4 py-2 rounded-md text-sm font-black whitespace-nowrap transition-all ${adminTrailerTab === tab.id ? 'bg-white text-green-700 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200'}`}>
                          {tab.name}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-2">
                    {db[adminSection]?.map((item, index) => {
                      const sectionDef = ADMIN_SECTIONS.find(s => s.id === adminSection);
                      const isCatalog = sectionDef?.isCatalog;

                      if (isCatalog) {
                        return (
                          <div key={item.id || index} className="p-5 bg-white border-2 border-slate-200 rounded-2xl shadow-sm space-y-4 mb-4">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                              <div className="flex-1 w-full">
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Nombre Comercial del Modelo</label>
                                <input 
                                  type="text" 
                                  value={item.nombre || ''} 
                                  onChange={e => handleDbChange(adminSection, index, 'nombre', e.target.value)} 
                                  className="w-full p-2.5 border border-slate-300 rounded-lg font-black text-slate-800 text-lg" 
                                />
                              </div>
                              {currentUser?.role === 'admin' ? (
                                <div className="w-full sm:w-48">
                                    <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Precio Base ($)</label>
                                    <input 
                                        type="number" 
                                        value={item.precio || 0} 
                                        onChange={e => handleDbChange(adminSection, index, 'precio', parseFloat(e.target.value) || 0)} 
                                        className="w-full p-2.5 border border-blue-300 bg-blue-50 rounded-lg font-black text-blue-800 text-right" 
                                    />
                                </div>
                            ) : (
                                <div className="w-full sm:w-48 p-2.5 bg-slate-100 rounded-lg border border-slate-200 text-right">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Precio Referencia</span>
                                    <span className="font-black text-slate-600">Restringido</span>
                                </div>
                            )}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                              <div>
                                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Fotografía</label>
                                <div className="flex items-center space-x-3">
                                  {item.foto ? (
                                    <div className="w-12 h-12 rounded-lg border overflow-hidden shrink-0"><img src={item.foto} alt="" className="w-full h-full object-cover"/></div>
                                  ) : (
                                    <div className="w-12 h-12 rounded-lg border border-dashed bg-slate-50 flex items-center justify-center shrink-0"><Image className="w-5 h-5 text-slate-400"/></div>
                                  )}
                                  <label className="flex-1 cursor-pointer border py-2.5 px-3 rounded-lg text-xs font-bold text-center bg-slate-50 hover:bg-slate-100 text-slate-700 transition">
                                    {uploadingImage ? 'Subiendo...' : (item.foto ? 'Cambiar Foto' : 'Subir Imagen')}
                                    <input type="file" accept="image/*" className="hidden" onChange={e => handleImageUpload(e, adminSection, index)} disabled={uploadingImage} />
                                  </label>
                                </div>
                              </div>

                              <div className="flex flex-col justify-end">
                                <button
                                  type="button"
                                  onClick={() => handleMejorarConIACatalogo(index)}
                                  disabled={isGeneratingCatalogAI}
                                  className="w-full bg-amber-500 hover:bg-amber-600 text-white p-3 rounded-lg font-black text-xs flex items-center justify-center gap-2 transition shadow-sm"
                                >
                                  ✨ {isGeneratingCatalogAI ? 'Analizando con IA...' : 'Autocompletar Especificaciones y Precio con IA'}
                                </button>
                              </div>
                            </div>

                            {/* --- NUEVA CUADRÍCULA CON TODAS LAS OPCIONES --- */}
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pt-4 border-t border-slate-100">
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Mercado (Bandera)</label><select value={item.market || ''} onChange={e => handleDbChange(adminSection, index, 'market', e.target.value)} className="w-full p-2 border border-amber-300 rounded-md text-xs font-black bg-amber-50 text-amber-900"><option value="">-- Seleccionar --</option><option value="usa">USA</option><option value="mexico">México</option></select></div>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Tipo Remolque</label><select value={item.tipoRemolque || ''} onChange={e => handleDbChange(adminSection, index, 'tipoRemolque', e.target.value)} className="w-full p-2 border border-amber-300 rounded-md text-xs font-black bg-amber-50 text-amber-900"><option value="">-- Seleccionar --</option><option value="ganadero_ganso">Ganadero Ganso</option><option value="ganadero_redondo">Ganadero Redondo</option><option value="cama_baja">Cama Baja</option><option value="cama_alta">Cama Alta</option><option value="volteo">Volteo</option></select></div>
                              
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Largo</label><select value={item.largo || ''} onChange={e => handleDbChange(adminSection, index, 'largo', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{db.largos?.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ancho</label><select value={item.ancho || ''} onChange={e => handleDbChange(adminSection, index, 'ancho', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{db.anchos?.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Capacidad</label><select value={item.capacidad || ''} onChange={e => handleDbChange(adminSection, index, 'capacidad', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{db.capacidades?.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Suspensión</label><select value={item.suspension || ''} onChange={e => handleDbChange(adminSection, index, 'suspension', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{db.suspension?.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Llantas</label><select value={item.llanta || ''} onChange={e => handleDbChange(adminSection, index, 'llanta', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{db.llantas?.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Jalón</label><select value={item.jalon || ''} onChange={e => handleDbChange(adminSection, index, 'jalon', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{db.jalones?.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Gato</label><select value={item.gato || ''} onChange={e => handleDbChange(adminSection, index, 'gato', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{db.gatos?.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Techo</label><select value={item.techo || ''} onChange={e => handleDbChange(adminSection, index, 'techo', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{db.techos?.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Redila</label><select value={item.redila || ''} onChange={e => handleDbChange(adminSection, index, 'redila', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{db.redilas?.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Piso</label><select value={item.piso || ''} onChange={e => handleDbChange(adminSection, index, 'piso', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{db.pisos?.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Monturero</label><select value={item.monturero || ''} onChange={e => handleDbChange(adminSection, index, 'monturero', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{db.montureros?.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Pintura</label><select value={item.pintura || ''} onChange={e => handleDbChange(adminSection, index, 'pintura', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{db.pinturas?.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Luces</label><select value={item.luces || ''} onChange={e => handleDbChange(adminSection, index, 'luces', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{db.luces?.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Color</label><select value={item.color || ''} onChange={e => handleDbChange(adminSection, index, 'color', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{db.colores?.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                            </div>

                            <div className="pt-2">
                              <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Especificaciones Breves (Catálogo)</label>
                              <input 
                                type="text" 
                                value={item.especificaciones || ''} 
                                onChange={e => handleDbChange(adminSection, index, 'especificaciones', e.target.value)} 
                                className="w-full p-2.5 border border-slate-300 rounded-lg font-medium text-xs bg-slate-50" 
                                placeholder="Ej. 2 Ejes 7k, Piso Madera..." 
                              />
                            </div>

                            <div className="flex justify-end pt-2 border-t border-slate-100">
                              <button 
                                onClick={() => handleDbDelete(adminSection, index)} 
                                className="flex items-center space-x-1 text-xs font-bold text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg transition border border-red-200"
                              >
                                <Trash2 className="w-4 h-4"/> <span>Eliminar Modelo</span>
                              </button>
                            </div>
                          </div>
                        );
                      }
if (sectionDef?.isMatrizTecho || sectionDef?.isMatrizPiso) {
                          const isTecho = sectionDef.isMatrizTecho;
                          return (
                              <div key={item.id || index} className="flex flex-wrap items-end gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl hover:shadow-sm transition relative mb-3">
                                  <div>
                                      <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">{isTecho ? 'Tipo de Techo' : 'Material de Piso'}</label>
                                      <select value={isTecho ? (item.techo || '') : (item.piso || '')} onChange={e => handleDbChange(adminSection, index, isTecho ? 'techo' : 'piso', e.target.value)} className="p-2 border border-slate-300 rounded-md text-xs font-bold text-slate-800 w-36">
                                          <option value="">- Seleccionar -</option>
                                          {(isTecho ? db.techos : db.pisos)?.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                                      </select>
                                  </div>
                                  <div>
                                      <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Largo</label>
                                      <select value={item.largo || ''} onChange={e => handleDbChange(adminSection, index, 'largo', e.target.value)} className="p-2 border border-slate-300 rounded-md text-xs font-bold text-slate-800 w-28">
                                          <option value="">- Todos -</option>
                                          {db.largos?.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                                      </select>
                                  </div>
                                  <div>
                                      <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ancho</label>
                                      <select value={item.ancho || ''} onChange={e => handleDbChange(adminSection, index, 'ancho', e.target.value)} className="p-2 border border-slate-300 rounded-md text-xs font-bold text-slate-800 w-28">
                                          <option value="">- Todos -</option>
                                          {db.anchos?.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                                      </select>
                                  </div>
                                  <div>
                                      <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Capacidad</label>
                                      <select value={item.capacidad || ''} onChange={e => handleDbChange(adminSection, index, 'capacidad', e.target.value)} className="p-2 border border-slate-300 rounded-md text-xs font-bold text-slate-800 w-32">
                                          <option value="">- Todos -</option>
                                          {db.capacidades?.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                                      </select>
                                  </div>
                                  <div className="flex-1 min-w-[140px]">
                                      <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Costo Fijo Exacto ($)</label>
                                      <input type="number" value={item.precio || 0} onChange={e => handleDbChange(adminSection, index, 'precio', parseFloat(e.target.value)||0)} className="w-full p-2 border border-green-300 bg-green-50 text-green-800 rounded-md font-black text-right" />
                                  </div>
                                  <button onClick={() => handleDbDelete(adminSection, index)} className="p-2 bg-white border border-red-200 text-red-600 rounded-md hover:bg-red-50"><Trash2 className="w-5 h-5"/></button>
                              </div>
                          );
                      }

                     const isTabulador = sectionDef?.isTabulador;
    if (isTabulador) {
      return (
          <div key={item.id || index} className="flex flex-wrap items-end gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl hover:shadow-sm transition relative mb-3">
              <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Mercado</label>
                  <select value={item.market || 'mexico'} onChange={e => handleDbChange(adminSection, index, 'market', e.target.value)} className="p-2 border border-slate-300 rounded-md text-xs font-bold text-slate-800 w-24">
                      <option value="mexico">México</option>
                      <option value="usa">USA</option>
                  </select>
              </div>
              <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Tipo de Remolque</label>
                  <select value={item.tipo || ''} onChange={e => handleDbChange(adminSection, index, 'tipo', e.target.value)} className="p-2 border border-slate-300 rounded-md text-xs font-bold text-slate-800 w-36">
                      <option value="ganadero_ganso">Ganadero Ganso</option>
                      <option value="ganadero_ganso_mex">Ganso Mex</option>
                      <option value="ganadero_redondo">Ganadero Redondo</option>
                      <option value="cama_baja">Cama Baja</option>
                      <option value="cama_alta">Cama Alta</option>
                      <option value="volteo">Volteo</option>
                  </select>
              </div>
              <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ancho</label>
                  <select value={item.ancho || ''} onChange={e => handleDbChange(adminSection, index, 'ancho', e.target.value)} className="p-2 border border-slate-300 rounded-md text-xs font-bold text-slate-800 w-28">
                      <option value="">- Seleccionar -</option>
                      {db.anchos?.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                  </select>
              </div>
              <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Capacidad</label>
                  <select value={item.capacidad || ''} onChange={e => handleDbChange(adminSection, index, 'capacidad', e.target.value)} className="p-2 border border-slate-300 rounded-md text-xs font-bold text-slate-800 w-32">
                      <option value="">- Seleccionar -</option>
                      {db.capacidades?.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
              </div>
              <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Largo (Pies)</label>
                  <input type="number" value={item.largo || 0} onChange={e => handleDbChange(adminSection, index, 'largo', parseFloat(e.target.value)||0)} className="p-2 border border-slate-300 rounded-md text-xs font-bold text-slate-800 w-20 text-center" />
              </div>
              
              <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Redila (Opcional)</label>
                  <select value={item.redila || ''} onChange={e => handleDbChange(adminSection, index, 'redila', e.target.value)} className="p-2 border border-slate-300 rounded-md text-xs font-bold text-slate-800 w-28">
                      <option value="">- Cualquiera -</option>
                      {db.redilas?.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                  </select>
              </div>
              <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Piso (Opcional)</label>
                  <select value={item.piso || ''} onChange={e => handleDbChange(adminSection, index, 'piso', e.target.value)} className="p-2 border border-slate-300 rounded-md text-xs font-bold text-slate-800 w-28">
                      <option value="">- Cualquiera -</option>
                      {db.pisos?.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
              </div>

              <div className="flex-1 min-w-[160px]">
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Precio Base Completo ($)</label>
                  <input type="number" value={item.precio || 0} onChange={e => handleDbChange(adminSection, index, 'precio', parseFloat(e.target.value)||0)} className="w-full p-2 border border-green-300 bg-green-50 text-green-800 rounded-md font-black text-right" />
              </div>
              <button onClick={() => handleDbDelete(adminSection, index)} className="p-2 bg-white border border-red-200 text-red-600 rounded-md hover:bg-red-50"><Trash2 className="w-5 h-5"/></button>
          </div>
      );
    }
                      const isGeneral = adminTrailerTab === 'gen';
                      const pKey = sectionDef?.isPiso ? 'precioSqFt' : 'precio';
                      const extraKey = 'precioExtra';
                      const activePKey = isGeneral ? pKey : `${pKey}_${adminTrailerTab}`;
                      const activeExtraKey = isGeneral ? extraKey : `${extraKey}_${adminTrailerTab}`;

                      return (
                        <div key={item.id || index} className="flex flex-wrap items-center gap-4 p-4 bg-slate-50 border border-slate-200 rounded-xl hover:shadow-sm transition relative">
                          {!isGeneral && item[activePKey] === undefined && !sectionDef?.isColor && (
                            <div className="absolute top-2 right-4 text-[10px] font-bold text-amber-500 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">Usando precio General</div>
                          )}
                          <div className="flex-1 min-w-[200px]">
                            <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Nombre Comercial</label>
                            <input type="text" value={item.nombre} onChange={e => handleDbChange(adminSection, index, 'nombre', e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-md font-bold text-slate-800 focus:ring-2 focus:ring-green-500 outline-none" />
                          </div>
                          
                          {sectionDef?.hasValor && (
                            <div className="w-24">
                              <label className="text-xs font-bold text-slate-500 uppercase block mb-1">{sectionDef.valorLabel}</label>
                              <input type="number" value={item.valor || 0} onChange={e => handleDbChange(adminSection, index, 'valor', parseFloat(e.target.value) || 0)} className="w-full p-2.5 border border-slate-300 rounded-md font-bold text-slate-800 text-center focus:ring-2" />
                            </div>
                          )}
                          
                          {sectionDef?.hasPrecioExtra && (
                                <div className="w-36">
                                  <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Extra {isGeneral ? '(Base)' : ''}</label>
                                  <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">$</span>
                                    <input type="number" value={item[activeExtraKey] ?? item.precioExtra ?? 0} onChange={e => handleDbChange(adminSection, index, activeExtraKey, parseFloat(e.target.value) || 0)} className={`w-full p-2.5 pl-7 border rounded-md font-bold ${!isGeneral && item[activeExtraKey] !== undefined ? 'border-green-400 bg-green-50 text-green-800' : 'border-slate-300'}`} />
                                  </div>
                                </div>
                              )}

                              {sectionDef?.isColor && (
                                <div className="w-36">
                                  <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Color (HEX)</label>
                                  <div className="flex items-center space-x-2">
                                    <input type="color" value={item.hex || '#000000'} onChange={e => handleDbChange(adminSection, index, 'hex', e.target.value)} className="w-10 h-10 p-0 border-0 rounded cursor-pointer shrink-0" />
                                    <input type="text" value={item.hex || '#000000'} onChange={e => handleDbChange(adminSection, index, 'hex', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md font-bold text-xs text-center uppercase" />
                                  </div>
                                </div>
                              )}
                          
                          {!sectionDef?.isColor && !sectionDef?.isCatalog && (
                            <div className="w-36">
                              <label className="text-xs font-bold text-slate-500 uppercase block mb-1">{sectionDef?.isPiso ? 'P. SqFt' : sectionDef?.id === 'anchos' ? 'Costo Pie Extra' : 'Precio'} {isGeneral ? '(Base)' : ''}</label>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">$</span>
                                <input type="number" value={item[activePKey] ?? item[pKey] ?? 0} onChange={e => handleDbChange(adminSection, index, activePKey, parseFloat(e.target.value) || 0)} className={`w-full p-2.5 pl-7 border rounded-md font-black text-right ${!isGeneral && item[activePKey] !== undefined ? 'border-green-400 bg-green-50 text-green-700' : 'border-slate-300 text-slate-700'}`} />
                              </div>
                            </div>
                          )}
                          
                          {!sectionDef?.isFixed && (
                            <div className="pt-5">
                              <button onClick={() => handleDbDelete(adminSection, index)} className="p-2.5 bg-white border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 rounded-lg transition shadow-sm">
                                <Trash2 className="w-5 h-5"/>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
             )}
          </div>
        </div>
      ) : (
        <main className="max-w-[1400px] mx-auto p-4 sm:p-6 flex flex-col xl:flex-row gap-6">
          {/* ====== COLUMNA IZQUIERDA (FORMULARIOS) ====== */}
          <div className="w-full xl:w-2/3 space-y-6 print:hidden">

            {/* BOTONES USA / MEXICO CON IMAGEN DE BANDERAS */}
            <div className="p-1.5 bg-slate-200 rounded-xl flex items-center shadow-inner">
                <button onClick={() => setMarket('usa')} className={`flex-1 py-3 px-4 rounded-lg font-black text-sm flex items-center justify-center transition-all duration-300 active:scale-95 ${market === 'usa' ? 'bg-white shadow-lg shadow-green-900/20 text-green-900 scale-[1.02] -translate-y-0.5' : 'text-slate-500 hover:text-slate-700 hover:-translate-y-1 hover:shadow-md'}`}>
                    <img src="https://flagcdn.com/w40/us.png" alt="USA" className="w-5 h-auto mr-2 rounded-sm shadow-sm" /> USA
                </button>
                <button onClick={() => setMarket('mexico')} className={`flex-1 py-3 px-4 rounded-lg font-black text-sm flex items-center justify-center transition-all duration-300 active:scale-95 ${market === 'mexico' ? 'bg-white shadow-lg shadow-green-700/20 text-green-700 scale-[1.02] -translate-y-0.5' : 'text-slate-500 hover:text-slate-700 hover:-translate-y-1 hover:shadow-md'}`}>
                    <img src="https://flagcdn.com/w40/mx.png" alt="México" className="w-5 h-auto mr-2 rounded-sm shadow-sm" /> MÉXICO
                </button>
            </div>

            {/* NUEVAS TARJETAS VISUALES DE REMOLQUES */}
            <div className={`grid gap-3 ${market === 'mexico' ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-2 max-w-md'}`}>
                
                {/* 1. Ganadero Ganso (Visible siempre) */}
                <button onClick={() => { setTipoRemolque('ganadero'); setTipoGanadero('ganso'); }} className={`relative flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all duration-300 hover:-translate-y-1 active:scale-95 overflow-hidden group ${tipoRemolque === 'ganadero' && tipoGanadero === 'ganso' ? 'bg-amber-50 border-amber-500 shadow-lg shadow-amber-500/40 -translate-y-1' : 'bg-white border-slate-200 hover:border-amber-300 hover:shadow-xl hover:shadow-amber-500/20'}`}>
                    <div className="h-12 w-full flex items-center justify-center mb-2 relative">
                        <Truck className={`w-8 h-8 absolute opacity-20 transition-opacity group-hover:opacity-40 ${tipoRemolque === 'ganadero' && tipoGanadero === 'ganso' ? 'text-amber-600' : 'text-slate-500'}`} />
                        <img src="/img_ganso.png" alt="Ganso" className="max-h-full max-w-full object-contain drop-shadow-md z-10 relative transition-transform duration-300 group-hover:scale-110" onError={(e) => e.target.style.display='none'} />
                    </div>
                    <span className={`font-black z-10 text-center text-[11px] leading-tight transition-colors duration-300 ${tipoRemolque === 'ganadero' && tipoGanadero === 'ganso' ? 'text-amber-800' : 'text-slate-600 group-hover:text-amber-700'}`}>Ganadero<br/>Ganso</span>
                </button>

                {/* 2. Ganadero Redondo (Visible siempre) */}
                <button onClick={() => { setTipoRemolque('ganadero'); setTipoGanadero('redondo'); }} className={`relative flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all duration-300 hover:-translate-y-1 active:scale-95 overflow-hidden group ${tipoRemolque === 'ganadero' && tipoGanadero === 'redondo' ? 'bg-amber-50 border-amber-500 shadow-lg shadow-amber-500/40 -translate-y-1' : 'bg-white border-slate-200 hover:border-amber-300 hover:shadow-xl hover:shadow-amber-500/20'}`}>
                    <div className="h-12 w-full flex items-center justify-center mb-2 relative">
                        <Truck className={`w-8 h-8 absolute opacity-20 transition-opacity group-hover:opacity-40 ${tipoRemolque === 'ganadero' && tipoGanadero === 'redondo' ? 'text-amber-600' : 'text-slate-500'}`} />
                        <img src="/img_redondo.png" alt="Redondo" className="max-h-full max-w-full object-contain drop-shadow-md z-10 relative transition-transform duration-300 group-hover:scale-110" onError={(e) => e.target.style.display='none'} />
                    </div>
                    <span className={`font-black z-10 text-center text-[11px] leading-tight transition-colors duration-300 ${tipoRemolque === 'ganadero' && tipoGanadero === 'redondo' ? 'text-amber-800' : 'text-slate-600 group-hover:text-amber-700'}`}>Ganadero<br/>Redondo</span>
                </button>

                {/* EXCLUSIVOS DE MÉXICO */}
                {market === 'mexico' && (
                    <>
                        <button onClick={() => setTipoRemolque('cama_baja')} className={`relative flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all duration-300 hover:-translate-y-1 active:scale-95 overflow-hidden group ${tipoRemolque === 'cama_baja' ? 'bg-indigo-50 border-indigo-500 shadow-lg shadow-indigo-500/40 -translate-y-1' : 'bg-white border-slate-200 hover:border-indigo-300 hover:shadow-xl hover:shadow-indigo-500/20'}`}>
                            <div className="h-12 w-full flex items-center justify-center mb-2 relative">
                                <Truck className={`w-8 h-8 absolute opacity-20 transition-opacity group-hover:opacity-40 ${tipoRemolque === 'cama_baja' ? 'text-indigo-600' : 'text-slate-500'}`} />
                                <img src="/img_camabaja.png" alt="Cama Baja" className="max-h-full max-w-full object-contain drop-shadow-md z-10 relative transition-transform duration-300 group-hover:scale-110" onError={(e) => e.target.style.display='none'} />
                            </div>
                            <span className={`font-black z-10 text-center text-[11px] leading-tight transition-colors duration-300 ${tipoRemolque === 'cama_baja' ? 'text-indigo-800' : 'text-slate-600 group-hover:text-indigo-700'}`}>Cama<br/>Baja</span>
                        </button>

                        <button onClick={() => setTipoRemolque('cama_alta')} className={`relative flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all duration-300 hover:-translate-y-1 active:scale-95 overflow-hidden group ${tipoRemolque === 'cama_alta' ? 'bg-emerald-50 border-emerald-500 shadow-lg shadow-emerald-500/40 -translate-y-1' : 'bg-white border-slate-200 hover:border-emerald-300 hover:shadow-xl hover:shadow-emerald-500/20'}`}>
                            <div className="h-12 w-full flex items-center justify-center mb-2 relative">
                                <Truck className={`w-8 h-8 absolute opacity-20 transition-opacity group-hover:opacity-40 ${tipoRemolque === 'cama_alta' ? 'text-emerald-600' : 'text-slate-500'}`} />
                                <img src="/img_camaalta.png" alt="Cama Alta" className="max-h-full max-w-full object-contain drop-shadow-md z-10 relative transition-transform duration-300 group-hover:scale-110" onError={(e) => e.target.style.display='none'} />
                            </div>
                            <span className={`font-black z-10 text-center text-[11px] leading-tight transition-colors duration-300 ${tipoRemolque === 'cama_alta' ? 'text-emerald-800' : 'text-slate-600 group-hover:text-emerald-700'}`}>Cama<br/>Alta</span>
                        </button>

                        <button onClick={() => setTipoRemolque('volteo')} className={`relative flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all duration-300 hover:-translate-y-1 active:scale-95 overflow-hidden group ${tipoRemolque === 'volteo' ? 'bg-red-50 border-red-500 shadow-lg shadow-red-500/40 -translate-y-1' : 'bg-white border-slate-200 hover:border-red-300 hover:shadow-xl hover:shadow-red-500/20'}`}>
                            <div className="h-12 w-full flex items-center justify-center mb-2 relative">
                                <Truck className={`w-8 h-8 absolute opacity-20 transition-opacity group-hover:opacity-40 ${tipoRemolque === 'volteo' ? 'text-red-600' : 'text-slate-500'}`} />
                                <img src="/img_volteo.png" alt="Volteo" className="max-h-full max-w-full object-contain drop-shadow-md z-10 relative transition-transform duration-300 group-hover:scale-110" onError={(e) => e.target.style.display='none'} />
                            </div>
                            <span className={`font-black z-10 text-center text-[11px] leading-tight transition-colors duration-300 ${tipoRemolque === 'volteo' ? 'text-red-800' : 'text-slate-600 group-hover:text-red-700'}`}>Remolque<br/>Volteo</span>
                        </button>
                    </>
                )}
            </div>

            {market === 'usa' && tipoRemolque === 'ganadero' && (
                <div className={`p-5 rounded-xl shadow-sm border transition-colors ${isSpecialClient ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center space-x-3">
                      <div className={`p-2 rounded-lg ${isSpecialClient ? 'bg-slate-700' : 'bg-slate-100'}`}><Star className={`w-6 h-6 ${isSpecialClient ? 'text-amber-400' : 'text-slate-400'}`}/></div>
                      <div><h2 className={`font-black text-lg ${isSpecialClient ? 'text-white' : 'text-slate-800'}`}>Cliente Especial USA</h2><p className={`text-xs font-bold ${isSpecialClient ? 'text-amber-400' : 'text-slate-500'}`}>{isSpecialClient ? 'Reglas y accesorios requeridos activados' : 'Configuración Estándar USA'}</p></div>
                    </div>
                    <label className={`flex items-center space-x-3 px-5 py-3 rounded-xl cursor-pointer border transition shadow-inner ${isSpecialClient ? 'bg-slate-900 border-slate-600 text-white' : 'bg-slate-50 border-slate-300 text-slate-600 hover:bg-slate-100'}`}>
                      <span className="text-sm font-black tracking-wide uppercase">Cliente Especial</span>
                      <div className={`w-12 h-6 rounded-full p-1 transition-colors duration-300 ${isSpecialClient ? 'bg-green-500' : 'bg-slate-400'}`}><div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform duration-300 ${isSpecialClient ? 'translate-x-6' : 'translate-x-0'}`}></div></div>
                      <input type="checkbox" checked={isSpecialClient} onChange={() => setIsSpecialClient(!isSpecialClient)} className="hidden"/>
                    </label>
                  </div>
                </div>
            )}
            
            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
              <h2 className="text-lg font-black text-slate-800 flex items-center mb-4"><User className="w-5 h-5 mr-2 text-green-600"/> Datos del Cliente</h2>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <div className="md:col-span-2"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Nombre Comercial / Cliente</label><input type="text" value={cliente.nombre} onChange={e => setCliente({...cliente, nombre: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md font-medium outline-none transition-all duration-300 focus:border-green-500 focus:ring-4 focus:ring-green-500/20 hover:border-green-400" placeholder="Ej. Juan Pérez" /></div>
                <div className="md:col-span-1"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Teléfono</label><input type="text" value={cliente.telefono} onChange={e => setCliente({...cliente, telefono: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md font-medium" placeholder="Ej. 614 123 4567" /></div>
               <div><label className="text-xs font-bold text-green-700 uppercase block mb-1">Cant. Remolques</label><input type="number" min="1" value={cliente.cantidad} onChange={e => setCliente({...cliente, cantidad: parseInt(e.target.value)||1})} className="w-full p-2 border-2 border-green-400 bg-green-50 text-green-900 rounded-md font-black text-center" /></div>
                <div className="md:col-span-1"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Descuento (%)</label><div className="relative"><input type="number" min="0" max="100" value={cliente.descuentoPct || ''} onChange={e => setCliente({...cliente, descuentoPct: parseFloat(e.target.value) || 0})} className="w-full p-2 border border-slate-300 rounded-md font-black text-red-600 text-center" placeholder="0" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">%</span></div></div>
                <div className="md:col-span-1"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Desc. Extra (%)</label><div className="relative"><input type="number" min="0" max="100" value={cliente.descuentoExtraPct || ''} onChange={e => setCliente({...cliente, descuentoExtraPct: parseFloat(e.target.value) || 0})} className="w-full p-2 border border-slate-300 rounded-md font-black text-amber-500 text-center" placeholder="0" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">%</span></div></div>
                <div className="md:col-span-1"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Ajuste / Redondeo</label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">$</span><input type="number" value={cliente.ajusteRedondeo || ''} onChange={e => setCliente({...cliente, ajusteRedondeo: parseFloat(e.target.value) || 0})} className="w-full p-2 pl-7 border border-slate-300 rounded-md font-black text-purple-700" placeholder="0" /></div></div>
                <div className="md:col-span-5 border-t border-slate-100 pt-3 mt-1"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Anticipo (MXN)</label><div className="relative max-w-[200px]"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">$</span><input type="number" value={cliente.anticipo || ''} onChange={e => setCliente({...cliente, anticipo: parseFloat(e.target.value) || 0})} className="w-full p-2 pl-7 border border-slate-300 rounded-md font-black text-green-700 bg-green-50" placeholder="0" /></div></div>
               {/* Fila de Folio y Fechas (Ya con espacio correcto) */}
<div className="col-span-full grid grid-cols-1 md:grid-cols-4 gap-6 mt-6 pt-6 border-t border-slate-200">
                    <div>
                        <label className="block text-[11px] font-black text-slate-400 mb-2 tracking-wider uppercase">Cantidad de Remolques</label>
<input type="number" min="1" value={cliente.cantidad || 1} onChange={(e) => setCliente({...cliente, cantidad: parseInt(e.target.value) || 1})} className="w-full bg-green-50 border-2 border-green-200 text-green-900 font-black rounded-xl px-4 py-3 outline-none transition-all duration-300 focus:border-green-500 focus:ring-4 focus:ring-green-500/20 hover:border-green-400" />                    </div>
                    <div>
                        <label className="block text-[11px] font-black text-slate-400 mb-2 tracking-wider uppercase">Folio de Diseño</label>
                        <input type="text" value={folio} onChange={(e) => setFolio(e.target.value)} placeholder="Ej. JP-015" className="w-full bg-slate-50 border-2 border-slate-200 text-slate-700 font-bold rounded-xl px-4 py-3 focus:outline-none focus:border-green-500 focus:bg-white transition-colors" />
                    </div>
                    <div>
                        <label className="block text-[11px] font-black text-slate-400 mb-2 tracking-wider uppercase">Fecha de Cotización</label>
                        <input type="date" value={fechaCotizacion} onChange={(e) => setFechaCotizacion(e.target.value)} className="w-full bg-slate-50 border-2 border-slate-200 text-slate-700 font-bold rounded-xl px-4 py-3 focus:outline-none focus:border-green-500 focus:bg-white transition-colors" />
                    </div>
                    <div>
                        <label className="block text-[11px] font-black text-slate-400 mb-2 tracking-wider uppercase">Entrega Estimada</label>
                        <input type="date" value={fechaEntrega} onChange={(e) => setFechaEntrega(e.target.value)} className="w-full bg-amber-50 border-2 border-amber-200 text-amber-900 font-bold rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 focus:bg-white transition-colors" />
                    </div>
                </div>

              </div>
            </div>
             
            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
              <h2 className="text-lg font-black text-slate-800 flex items-center mb-4"><Disc className="w-5 h-5 mr-2 text-green-600"/> 1. Dimensiones y Acoplamiento</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Largo del Remolque</label><select value={dim.largo} onChange={e => setDim({...dim, largo: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md font-medium">{largosDisponibles.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                <div><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Ancho Exterior</label><select value={dim.ancho} onChange={e => setDim({...dim, ancho: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md font-medium">{anchosDisponibles.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-100">
                <div><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Tipo de Jalón</label><select value={acople.jalon} onChange={e => setAcople({...acople, jalon: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md font-bold">{jalonesDisponibles.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                <div><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Cadena de Seguridad</label><select value={acople.cadena} disabled={market === 'usa'} onChange={e => setAcople({...acople, cadena: e.target.value})} className={`w-full p-2 border border-slate-300 rounded-md font-bold ${market === 'usa' ? 'bg-slate-100 opacity-70' : ''}`}>{db.cadenas?.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                <div className="flex flex-col justify-end space-y-2 pb-1"><label className={`flex items-center space-x-2 font-medium text-sm text-slate-700 ${market === 'usa' ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}><input type="checkbox" checked={acople.sujetaCadenas} disabled={market === 'usa'} onChange={() => toggle(setAcople, 'sujetaCadenas')} className="w-4 h-4 text-green-600"/> <span>Incluir Sujeta Cadenas</span></label></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 pt-4 mt-4 border-t border-slate-100">
                <div className="sm:col-span-6"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Gato Elevación</label><select value={acople.gato} onChange={e => setAcople({...acople, gato: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md">{gatosDisponibles.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                <div className="sm:col-span-2"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Cant.</label><div className="flex bg-slate-100 border border-slate-300 rounded h-[42px] items-center"><button onClick={() => handleCant(setAcople, 'cantGatos', -1, 1)} className="px-3 font-bold hover:bg-slate-200 h-full">-</button><span className="px-2 font-bold w-full text-center">{acople.cantGatos}</span><button onClick={() => handleCant(setAcople, 'cantGatos', 1)} className="px-3 font-bold hover:bg-slate-200 h-full">+</button></div></div>
                {acople.gato.includes('hidraulico') && (
                  <div className="sm:col-span-4 flex flex-col justify-center space-y-1">
                    <label className="flex items-center space-x-2 border rounded px-2 py-1 cursor-pointer"><input type="checkbox" checked={acople.cargadorSolar} disabled={isSpecialClient && market==='usa'} onChange={() => toggle(setAcople, 'cargadorSolar')} className="w-3.5 h-3.5"/><span className="text-xs font-medium">+ Cargador Solar</span></label>
                    <label className="flex items-center space-x-2 border rounded px-2 py-1 cursor-pointer"><input type="checkbox" checked={acople.cargador110} disabled={isSpecialClient && market==='usa'} onChange={() => toggle(setAcople, 'cargador110')} className="w-3.5 h-3.5"/><span className="text-xs font-medium">+ Cargador 110v</span></label>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
              <h2 className="text-lg font-black text-slate-800 flex items-center mb-4"><Zap className="w-5 h-5 mr-2 text-green-600"/> 2. Capacidad y Ejes</h2>
              <div className="p-4 bg-green-50 rounded-lg border border-green-200 mb-5">
                  <label className="text-xs font-bold text-green-800 uppercase block mb-2">Configuración de Ejes</label>
                  <select value={rodado.capacidad} onChange={e => setRodado({...rodado, capacidad: e.target.value})} className="w-full p-2 border border-green-300 rounded-md font-black text-green-900">
                      {capacidadesDisponibles.map(o => {
                          let displayName = o.nombre;
                          // FORZAMOS LOS NOMBRES PARA IGNORAR LA NUBE
                          if (o.id === '9t') displayName = '9 Ton (3 Ejes 7,000 lbs)';
                          else if (o.id === '10t') displayName = '10 Ton (Configuración Especial)';
                          else if (o.id === '3t') displayName = (tipoRemolque === 'volteo' || tipoRemolque === 'cama_baja' || isGanaderoRedondoMex) ? '3 Ton (2 Ejes 3,500 lbs)' : '3 Ton (Configuración Especial)';
                          else if (o.id === '1_5t') displayName = '1.5 Ton (1 Eje 3,500 lbs)';
                          return <option key={o.id} value={o.id}>{displayName}</option>;
                      })}
                  </select>
              </div>
              {((rodado.capacidad === '10t') || (rodado.capacidad === '3t' && tipoRemolque === 'ganadero' && !isGanaderoRedondoMex)) && (
                  <div className="mt-3">
                    <label className="text-[11px] font-bold text-green-800 uppercase block mb-1">Especifique Cantidad de Ejes</label>
                    <select value={rodado.cantEjesGanso} onChange={e => setRodado({...rodado, cantEjesGanso: parseInt(e.target.value)})} className="w-full sm:w-2/3 p-2 border border-green-300 rounded-md font-bold text-green-900 bg-white shadow-sm">
                      {rodado.capacidad === '10t' ? (
                        <>
                           <option value={2}>2 Ejes (de 10,000 lbs)</option>
                           <option value={3}>3 Ejes (de 8,000 lbs)</option>
                           <option value={310}>3 Ejes (de 10,000 lbs)</option>
                        </>
                      ) : (
                        <><option value={1}>1 Eje (de 3,500 lbs)</option><option value={2}>2 Ejes (de 3,500 lbs)</option></>
                      )}
                    </select>
                  </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Suspensión</label>
                  <select value={rodado.suspension} disabled={isSpecialClient && market==='usa'} onChange={e => setRodado({...rodado, suspension: e.target.value})} className={`w-full p-2 border border-slate-300 rounded-md ${isSpecialClient && market==='usa' ? 'bg-slate-100 font-bold' : ''}`}>{suspensionesDisponibles.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>
                </div>
                <div><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Set de Llantas</label><select value={rodado.llanta} onChange={e => setRodado({...rodado, llanta: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md">{llantasDisponibles.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
              </div>
              <div className="flex flex-wrap items-center gap-5 pt-4 border-t border-slate-100">
                <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded px-2 py-1"><span className="text-sm font-bold text-slate-700">Frenos Eléctricos:</span><button onClick={() => handleCant(setRodado, 'cantFrenos', -1, 0, cantEjes)} className="px-2 font-bold hover:bg-slate-200 rounded text-lg">-</button><span className="font-black text-green-700 w-4 text-center">{rodado.cantFrenos}</span><button onClick={() => handleCant(setRodado, 'cantFrenos', 1, 0, cantEjes)} className="px-2 font-bold hover:bg-slate-200 rounded text-lg">+</button><span className="text-xs font-medium text-slate-500 ml-1">/ {cantEjes} Ejes</span></div>
                <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded px-2 py-1"><span className="text-sm font-bold text-slate-700">Llanta Extra:</span><button onClick={() => handleCant(setRodado, 'llantaExtra', -1)} className="px-2 font-bold hover:bg-slate-200 rounded">-</button><span className="font-black text-green-700 w-4 text-center">{rodado.llantaExtra}</span><button onClick={() => handleCant(setRodado, 'llantaExtra', 1)} className="px-2 font-bold hover:bg-slate-200 rounded">+</button></div>
                <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded px-2 py-1"><span className="text-sm font-medium text-slate-700">Porta Extra:</span><button onClick={() => handleCant(setRodado, 'portaExtra', -1, tipoRemolque !== 'ganadero' ? 1 : rodado.llantaExtra)} className="px-2 font-bold hover:bg-slate-200 rounded">-</button><span className="font-bold w-4 text-center">{rodado.portaExtra}</span><button onClick={() => handleCant(setRodado, 'portaExtra', 1)} className="px-2 font-bold hover:bg-slate-200 rounded">+</button></div>
              </div>
            </div>

            <div className={`p-5 rounded-xl shadow-sm border ${tipoRemolque === 'cama_baja' ? 'bg-indigo-50 border-indigo-200' : tipoRemolque === 'cama_alta' ? 'bg-emerald-50 border-emerald-200' : tipoRemolque === 'volteo' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
              <h2 className={`text-lg font-black flex items-center mb-4 ${tipoRemolque === 'cama_baja' ? 'text-indigo-900' : tipoRemolque === 'cama_alta' ? 'text-emerald-900' : tipoRemolque === 'volteo' ? 'text-red-900' : 'text-amber-900'}`}><Shield className={`w-5 h-5 mr-2 ${tipoRemolque === 'cama_baja' ? 'text-indigo-600' : tipoRemolque === 'cama_alta' ? 'text-emerald-600' : tipoRemolque === 'volteo' ? 'text-red-600' : 'text-amber-600'}`}/> 3. Estructura {tipoRemolque === 'cama_baja' ? 'Cama Baja' : tipoRemolque === 'cama_alta' ? 'Cama Alta' : tipoRemolque === 'volteo' ? 'Volteo' : 'Ganadera'}</h2>
              
              {tipoRemolque === 'ganadero' && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
                    <div>
                      <label className="text-xs font-bold text-amber-700 uppercase block mb-1">Techo</label>
                      <div className="flex gap-2">
                        <select value={carroceria.techo} onChange={e => setCarroceria({...carroceria, techo: e.target.value})} className="w-full p-2 border border-amber-300 rounded-md">{db.techos.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>
                        {carroceria.techo === 'media_especial' && (
                          <div className="flex items-center bg-amber-50 border border-amber-300 rounded-md px-2 w-24 shadow-sm" title="Largo máximo limitado al tamaño del remolque">
                            <input type="number" min="1" max={parseInt(dim.largo.replace('ft', ''))} value={carroceria.techoEspecialLargo || ''} onChange={e => { let max = parseInt(dim.largo.replace('ft', '')); let val = parseInt(e.target.value)||''; setCarroceria({...carroceria, techoEspecialLargo: val > max ? max : val})}} className="w-full bg-transparent font-black text-amber-900 text-center outline-none" placeholder="Pies"/>
                            <span className="text-[10px] font-bold text-amber-700 pr-1">FT</span>
                          </div>
                        )}
                      </div>
                    </div>
                     <div>
                      <label className="text-xs font-bold text-amber-700 uppercase block mb-1">Frente</label>
                      <select value={carroceria.frente} onChange={e => setCarroceria({...carroceria, frente: e.target.value})} className="w-full p-2 border border-amber-300 rounded-md font-bold">
                        {db.jalones?.find(j => j.id === acople.jalon)?.tipo === 'ganso' ? (
                          <>
                            <option value="cachucha">Cachucha</option>
                            <option value="canasta">Canasta</option>
                          </>
                        ) : (
                          <>
                            <option value="ninguno">Redondo Fijo</option>
                            <option value="cuadrado">Frente Cuadrado</option>
                          </>
                        )}
                      </select>
                    </div>
                    <div><label className="text-xs font-bold text-amber-700 uppercase block mb-1">Redila</label><select value={carroceria.redila} onChange={e => setCarroceria({...carroceria, redila: e.target.value})} className="w-full p-2 border border-amber-300 rounded-md font-bold">{redilasDisponibles.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                  </div>
                  <div className="flex flex-wrap gap-4 mt-2">
                 {(carroceria.redila.includes('cerrada') || carroceria.redila === 'combinada') && ( <label className="flex items-center space-x-2 font-medium text-sm text-amber-900 cursor-pointer"><input type="checkbox" checked={carroceria.aperturaEstribo} onChange={() => toggle(setCarroceria, 'aperturaEstribo')} className="w-4 h-4 text-amber-600"/> <span>Apertura para Estribo</span></label> )}
                 <label className="flex items-center space-x-2 font-medium text-sm text-amber-900 cursor-pointer"><input type="checkbox" checked={carroceria.aperturaLimpieza} onChange={() => toggle(setCarroceria, 'aperturaLimpieza')} className="w-4 h-4 text-amber-600"/> <span>Apertura para Limpieza</span></label>
              </div>

              <div className="col-span-full border-t border-amber-200 pt-4 mt-4">
                <div className="flex justify-between items-center mb-3">
                       <label className="text-xs font-black text-amber-800 uppercase block">Puertas Interiores (Dinámicas)</label>
                       <button onClick={() => { if ((carroceria.puertasIntList||[]).length < maxPuertasInt) setCarroceria({...carroceria, puertasIntList: [...(carroceria.puertasIntList||[]), {id: Date.now(), tipo: 'fija', distancia: getObj(db.anchos, dim.ancho).valor}]}) }} disabled={(carroceria.puertasIntList||[]).length >= maxPuertasInt} className={`px-3 py-1 rounded-md text-xs font-black transition shadow-sm border ${(carroceria.puertasIntList||[]).length >= maxPuertasInt ? 'bg-slate-100 border-slate-300 text-slate-400 cursor-not-allowed' : 'bg-amber-100 border-amber-300 text-amber-800 hover:bg-amber-200'}`}>+ Agregar Puerta</button>
                    </div>
                    <div className="space-y-2">
                  {(carroceria.puertasIntList || []).map((pta, idx) => (
                     <div key={pta.id} className="flex flex-wrap sm:flex-nowrap gap-2 items-center bg-white p-2 rounded-lg border border-amber-200 shadow-sm">
                        <span className="font-black text-slate-400 text-xs px-2">{idx+1}.</span>
                        <select value={pta.tipo} onChange={e => { const newList = [...carroceria.puertasIntList]; newList[idx].tipo = e.target.value; setCarroceria({...carroceria, puertasIntList: newList}); }} className="flex-1 p-2 border border-amber-300 rounded text-sm font-bold text-amber-900 bg-amber-50">
                           {db.puertasInteriores.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                        </select>
                        <div className="flex items-center space-x-2 bg-slate-50 px-2 py-1 rounded border border-slate-200 min-w-[120px] justify-center">
                            {carroceria.puertasIntList.length === 1 ? (
                                <span className="text-xs font-black text-green-700 uppercase">Centrada</span>
                            ) : (
                                <>
                                   <span className="text-[10px] font-bold text-slate-500 uppercase">Distancia:</span>
                                   <input type="number" min="10" max={parseInt(dim.largo.replace('ft', '')) * 12} value={pta.distancia} onChange={e => { const maxPulgadas = parseInt(dim.largo.replace('ft', '')) * 12; const newList = [...carroceria.puertasIntList]; newList[idx].distancia = Math.min(maxPulgadas, Math.max(10, parseInt(e.target.value)||0)); setCarroceria({...carroceria, puertasIntList: newList}); }} className="w-16 p-1 border border-slate-300 rounded text-sm text-center font-black text-green-700" />
                                   <span className="text-[10px] font-bold text-slate-500">PULG.</span>
                                </>
                            )}
                        </div>
                        <button onClick={() => { const newList = carroceria.puertasIntList.filter((_, i) => i !== idx); setCarroceria({...carroceria, puertasIntList: newList}); }} className="text-red-500 hover:bg-red-50 p-2 rounded border border-transparent hover:border-red-200 transition"><Trash2 className="w-5 h-5"/></button>
                     </div>
                  ))}
                  {(carroceria.puertasIntList?.length === 0) && <p className="text-xs font-bold text-amber-600/70 italic py-2 text-center bg-amber-50 rounded border border-amber-100">Sin puertas interiores.</p>}
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-amber-200">
                <label className="text-xs font-bold text-amber-700 uppercase block mb-1">Puerta Trasera</label><select value={carroceria.puertaTras} onChange={e => setCarroceria({...carroceria, puertaTras: e.target.value})} className="w-full sm:w-1/3 p-2 border border-amber-300 rounded-md font-bold">{db.puertasTraseras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>
              </div>
                  <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-amber-200">
                    <div className={`flex items-center space-x-2 ${carroceria.puertaPiloto ? 'bg-white border border-amber-200 rounded px-2 py-0.5 shadow-sm' : ''}`}>
                      <label className="flex items-center space-x-2 cursor-pointer font-medium text-sm text-amber-900"><input type="checkbox" checked={carroceria.puertaPiloto} onChange={() => toggle(setCarroceria, 'puertaPiloto')} className="w-4 h-4 text-amber-600"/> <span>Pta Piloto</span></label>
                      {carroceria.puertaPiloto && ( <div className="flex items-center ml-1 border-l border-amber-200 pl-2"><button onClick={() => handleCant(setCarroceria, 'puertaPilotoAncho', -1, 40, 60)} className="px-2 font-bold text-amber-800 hover:bg-amber-100 rounded">-</button><span className="font-black w-7 text-center text-amber-900">{carroceria.puertaPilotoAncho}"</span><button onClick={() => handleCant(setCarroceria, 'puertaPilotoAncho', 1, 40, 60)} className="px-2 font-bold text-amber-800 hover:bg-amber-100 rounded">+</button></div> )}
                    </div>
                    <label className="flex items-center space-x-2 cursor-pointer font-medium text-sm text-amber-900"><input type="checkbox" checked={carroceria.plexiglass} onChange={() => toggle(setCarroceria, 'plexiglass')} className="w-4 h-4 text-amber-600"/> <span>Plexiglass</span></label>
                    <label className="flex items-center space-x-2 cursor-pointer font-medium text-sm text-amber-900"><input type="checkbox" checked={carroceria.rackPacas} onChange={() => toggle(setCarroceria, 'rackPacas')} className="w-4 h-4 text-amber-600"/> <span>Rack Pacas</span></label>
                    <div className="flex items-center space-x-2 bg-white border border-amber-200 rounded px-2 py-0.5"><span className="text-sm font-medium text-amber-900">Vent. Estándar:</span><button onClick={() => handleCant(setCarroceria, 'ventEst', -1)} className="px-2 font-bold text-amber-800">-</button><span className="font-bold w-4 text-center text-amber-900">{Number(carroceria.ventEst) || 0}</span><button onClick={() => handleCant(setCarroceria, 'ventEst', 1)} className="px-2 font-bold text-amber-800">+</button></div>
                    <div className="flex items-center space-x-2 bg-white border border-amber-200 rounded px-2 py-0.5"><span className="text-sm font-medium text-amber-900">Vent. Circular:</span><button onClick={() => handleCant(setCarroceria, 'ventCirc', -1)} className="px-2 font-bold text-amber-800">-</button><span className="font-bold w-4 text-center text-amber-900">{Number(carroceria.ventCirc) || 0}</span><button onClick={() => handleCant(setCarroceria, 'ventCirc', 1)} className="px-2 font-bold text-amber-800">+</button></div>
                    {carroceria.frente === 'cachucha' && (<label className="flex items-center space-x-2 cursor-pointer font-medium text-sm text-amber-900"><input type="checkbox" checked={carroceria.puertaPerroCachucha} onChange={() => toggle(setCarroceria, 'puertaPerroCachucha')} className="w-4 h-4 text-amber-600"/> <span>Puerta Perro Cachucha</span></label>)}
                    {isSpecialClient && market==='usa' && (<label className="flex items-center space-x-2 cursor-pointer font-medium text-sm text-amber-900"><input type="checkbox" checked={carroceria.polverasEspeciales} onChange={() => toggle(setCarroceria, 'polverasEspeciales')} className="w-4 h-4 text-amber-600"/> <span>Polveras Especiales USA</span></label>)}
                  </div>
                </>
              )}
              
              {tipoRemolque === 'volteo' && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                      <div>
                         <label className="text-xs font-bold text-red-700 uppercase block mb-1">Sistema de Elevación</label>
                         <select value={volteoOpts.sistemaElevacion} onChange={e => setVolteoOpts({...volteoOpts, sistemaElevacion: e.target.value})} className="w-full p-2 border border-red-300 rounded-md font-bold text-red-900 bg-white">
                            <option value="hidraulico">Hidráulico</option>
                            <option value="electrico">Eléctrico</option>
                            <option value="ambos">Ambos Sistemas (Dual)</option>
                         </select>
                      </div>
                      <div>
                         <label className="text-xs font-bold text-red-700 uppercase block mb-1">Puerta Trasera</label>
                         <select value={volteoOpts.puertaTrasera} onChange={e => setVolteoOpts({...volteoOpts, puertaTrasera: e.target.value})} className="w-full p-2 border border-red-300 rounded-md font-bold text-red-900 bg-white">
                            <option value="libro">Tipo Libro (Granero)</option>
                            <option value="dompe">Tipo Dompe</option>
                            <option value="sencilla">Puerta Sencilla (Especial)</option>
                            <option value="libro_dompe">Combinada (Libro + Dompe)</option>
                         </select>
                      </div>
                  </div>
                  <div className="flex items-end pb-2 gap-4 border-t border-red-200 pt-4">
                      <label className="flex items-center space-x-2 cursor-pointer font-medium text-sm text-red-900 bg-white px-3 py-1.5 rounded border border-red-200 shadow-sm">
                          <input type="checkbox" checked={volteoOpts.fenderReforzado} onChange={() => setVolteoOpts({...volteoOpts, fenderReforzado: !volteoOpts.fenderReforzado})} className="w-4 h-4 text-red-600"/> <span>Fender Reforzado</span>
                      </label>
                      <label className="flex items-center space-x-2 cursor-pointer font-medium text-sm text-red-900 bg-white px-3 py-1.5 rounded border border-red-200 shadow-sm">
                          <input type="checkbox" checked={volteoOpts.luzPortaplaca} onChange={() => setVolteoOpts({...volteoOpts, luzPortaplaca: !volteoOpts.luzPortaplaca})} className="w-4 h-4 text-red-600"/> <span>Luz Portaplaca opcional</span>
                      </label>
                  </div>
                </>
              )}

              {['cama_baja', 'cama_alta'].includes(tipoRemolque) && (
                <>
                   {tipoRemolque === 'cama_baja' && ( <div className="mb-4"><label className="text-xs font-bold text-indigo-700 uppercase block mb-1">Redila Plataforma</label><select value={carroceria.redila} onChange={e => setCarroceria({...carroceria, redila: e.target.value})} className="w-full sm:w-1/2 p-2 border border-indigo-300 rounded-md font-bold">{redilasDisponibles.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div> )}
                   <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t ${tipoRemolque === 'cama_alta' ? 'border-emerald-200' : 'border-indigo-200'}`}>
                     <div><label className={`text-xs font-bold uppercase block mb-1 ${tipoRemolque === 'cama_alta' ? 'text-emerald-700' : 'text-indigo-700'}`}>Rampas / Cola de Pato</label><select value={camaBajaOpts.rampas} onChange={e => setCamaBajaOpts({...camaBajaOpts, rampas: e.target.value})} className={`w-full p-2 border rounded-md font-bold ${tipoRemolque === 'cama_alta' ? 'border-emerald-300 text-emerald-900' : 'border-indigo-300 text-indigo-900'}`}>{rampasDisponibles.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}</select></div>
                     {tipoRemolque === 'cama_baja' && ( <div className="flex items-end pb-2"><label className="flex items-center space-x-2 cursor-pointer font-medium text-sm text-indigo-900 bg-white px-3 py-1.5 rounded border border-indigo-200 shadow-sm"><input type="checkbox" checked={camaBajaOpts.fenderReforzado} onChange={() => toggle(setCamaBajaOpts, 'fenderReforzado')} className="w-4 h-4 text-indigo-600"/> <span>Fender Reforzado</span></label></div> )}
                   </div>
                </>
              )}
            </div>

            {tipoRemolque === 'ganadero' && (
              <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                <h2 className="text-lg font-black text-slate-800 flex items-center mb-4"><DoorOpen className="w-5 h-5 mr-2 text-green-600"/> 4. Monturero</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <select value={monturero.tipo} onChange={e => setMonturero({...monturero, tipo: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md font-medium">{monturerosDisponibles.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>
                  {(monturero.tipo !== 'ninguno' || carroceria.frente === 'cachucha') && (<label className="flex items-center space-x-2 cursor-pointer font-medium"><input type="checkbox" checked={monturero.puertaPerro} onChange={() => toggle(setMonturero, 'puertaPerro')} className="w-4 h-4 text-green-600"/> <span>Incluir Puerta Perro Lateral</span></label>)}
                </div>
                {monturero.tipo === 'diagonal' && (
                    <div className="flex gap-4 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                        <div className="flex-1"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Pared Larga (Pulgadas)</label><div className="flex border border-slate-300 rounded overflow-hidden h-[34px]"><button onClick={() => handleCant(setMonturero, 'paredLarga', -0.5, 40, 120)} className="px-3 font-bold bg-white hover:bg-slate-100">-</button><span className="w-full text-center font-bold bg-white border-x border-slate-300 flex items-center justify-center">{monturero.paredLarga}"</span><button onClick={() => handleCant(setMonturero, 'paredLarga', 0.5, 40, 120)} className="px-3 font-bold bg-white hover:bg-slate-100">+</button></div></div>
                        <div className="flex-1"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Pared Corta (Pulgadas)</label><div className="flex border border-slate-300 rounded overflow-hidden h-[34px]"><button onClick={() => handleCant(setMonturero, 'paredCorta', -0.5, 10, 80)} className="px-3 font-bold bg-white hover:bg-slate-100">-</button><span className="w-full text-center font-bold bg-white border-x border-slate-300 flex items-center justify-center">{monturero.paredCorta}"</span><button onClick={() => handleCant(setMonturero, 'paredCorta', 0.5, 10, 80)} className="px-3 font-bold bg-white hover:bg-slate-100">+</button></div></div>
                    </div>
                )}
              </div>
            )}

            {/* 4. ACABADOS Y ACCESORIOS */}
            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
              <div className="flex justify-between items-center mb-4"><h2 className="text-lg font-black text-slate-800 flex items-center"><Layers className="w-5 h-5 mr-2 text-green-600"/> {tipoRemolque === 'ganadero' ? '5.' : '4.'} Acabados y Accesorios</h2></div>
              <div className="mb-5 bg-slate-50 p-4 rounded-lg border border-slate-200">
                <label className="text-xs font-bold text-slate-500 uppercase block mb-3">Color del Remolque</label>
                <div className="flex flex-wrap gap-3">
                  {db.colores?.map(c => (
                    <button key={c.id} onClick={() => setAcabados({...acabados, color: c.id})} className={`flex items-center space-x-2 px-3 py-2 rounded-full border shadow-sm transition ${acabados.color === c.id ? 'border-green-600 bg-green-50 ring-2 ring-green-200' : 'border-slate-300 hover:bg-white bg-slate-100'}`}>
                      <div className="w-5 h-5 rounded-full shadow-sm border border-slate-300" style={{ backgroundColor: c.hex }}></div><span className="text-sm font-bold text-slate-700">{c.nombre}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                <div><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Piso</label><select value={acabados.piso} onChange={e => setAcabados({...acabados, piso: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md">{pisosDisponibles.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Caja Htas</label>
                  <select value={acabados.cajaHtas} onChange={e => setAcabados({...acabados, cajaHtas: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md font-bold">
                    <option value="ninguna">Sin Caja</option><option value="std">Estándar</option><option value="especial">Medida Especial</option>
                  </select>
                </div>
                <div><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Luces</label><select value={acabados.luces} disabled={isSpecialClient && market==='usa'} onChange={e => setAcabados({...acabados, luces: e.target.value})} className={`w-full p-2 border border-slate-300 rounded-md ${isSpecialClient && market==='usa' ? 'bg-slate-100 font-bold' : ''}`}>{lucesDisponibles.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
              </div>
              
              {acabados.cajaHtas === 'especial' && (
                <div className="mt-2 mb-4 bg-amber-50 border-2 border-amber-200 p-4 rounded-lg flex flex-col sm:flex-row items-center justify-between gap-4">
                   <div className="flex items-center space-x-3">
                      <span className="text-xs font-black text-amber-900 uppercase">Largo Especial:</span>
                      <div className="flex items-center bg-white border border-amber-300 rounded-lg overflow-hidden shadow-sm">
                         <button onClick={() => handleCant(setAcabados, 'cajaHtasLargo', -1)} className="px-3 py-1 font-black text-amber-700 hover:bg-amber-100 transition">-</button>
                         <span className="w-16 text-center font-black text-lg text-amber-900 border-x border-amber-200">{acabados.cajaHtasLargo}"</span>
                         <button onClick={() => handleCant(setAcabados, 'cajaHtasLargo', 1)} className="px-3 py-1 font-black text-amber-700 hover:bg-amber-100 transition">+</button>
                      </div>
                   </div>
                   <p className="text-[10px] font-bold text-red-600 flex-1 leading-tight bg-white p-2 rounded border border-red-100"><AlertTriangle className="w-4 h-4 inline mr-1 text-red-500 mb-0.5"/> Consultar con diseño para verificar si es posible fabricar el remolque con esta medida.</p>
                </div>
              )}

              {acabados.luces === 'especial_mexico' && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg mb-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                  <div><label className="text-[10px] font-bold text-green-800 uppercase block mb-1">Óvalo Rojo</label><div className="flex bg-white border border-green-300 rounded overflow-hidden"><button onClick={() => handleCant(setAccesorios, 'ovaloRojo', -1)} className="px-2 py-1 font-bold hover:bg-slate-100">-</button><span className="w-full text-center py-1 font-bold border-x border-green-200 text-xs">{accesorios.ovaloRojo || 0}</span><button onClick={() => handleCant(setAccesorios, 'ovaloRojo', 1)} className="px-2 py-1 font-bold hover:bg-slate-100">+</button></div></div>
                  <div><label className="text-[10px] font-bold text-green-800 uppercase block mb-1">Óvalo Ámbar</label><div className="flex bg-white border border-green-300 rounded overflow-hidden"><button onClick={() => handleCant(setAccesorios, 'ovaloAmbar', -1)} className="px-2 py-1 font-bold hover:bg-slate-100">-</button><span className="w-full text-center py-1 font-bold border-x border-green-200 text-xs">{accesorios.ovaloAmbar || 0}</span><button onClick={() => handleCant(setAccesorios, 'ovaloAmbar', 1)} className="px-2 py-1 font-bold hover:bg-slate-100">+</button></div></div>
                  <div><label className="text-[10px] font-bold text-green-800 uppercase block mb-1">3/4" Roja</label><div className="flex bg-white border border-green-300 rounded overflow-hidden"><button onClick={() => handleCant(setAccesorios, 'tresCuartosRojo', -1)} className="px-2 py-1 font-bold hover:bg-slate-100">-</button><span className="w-full text-center py-1 font-bold border-x border-green-200 text-xs">{accesorios.tresCuartosRojo || 0}</span><button onClick={() => handleCant(setAccesorios, 'tresCuartosRojo', 1)} className="px-2 py-1 font-bold hover:bg-slate-100">+</button></div></div>
                  <div><label className="text-[10px] font-bold text-green-800 uppercase block mb-1">3/4" Ámbar</label><div className="flex bg-white border border-green-300 rounded overflow-hidden"><button onClick={() => handleCant(setAccesorios, 'tresCuartosAmbar', -1)} className="px-2 py-1 font-bold hover:bg-slate-100">-</button><span className="w-full text-center py-1 font-bold border-x border-green-200 text-xs">{accesorios.tresCuartosAmbar || 0}</span><button onClick={() => handleCant(setAccesorios, 'tresCuartosAmbar', 1)} className="px-2 py-1 font-bold hover:bg-slate-100">+</button></div></div>
                  <div><label className="text-[10px] font-bold text-green-800 uppercase block mb-1">2" Roja</label><div className="flex bg-white border border-green-300 rounded overflow-hidden"><button onClick={() => handleCant(setAccesorios, 'dosPulgadasRojo', -1)} className="px-2 py-1 font-bold hover:bg-slate-100">-</button><span className="w-full text-center py-1 font-bold border-x border-green-200 text-xs">{accesorios.dosPulgadasRojo || 0}</span><button onClick={() => handleCant(setAccesorios, 'dosPulgadasRojo', 1)} className="px-2 py-1 font-bold hover:bg-slate-100">+</button></div></div>
                  <div><label className="text-[10px] font-bold text-green-800 uppercase block mb-1">2" Ámbar</label><div className="flex bg-white border border-green-300 rounded overflow-hidden"><button onClick={() => handleCant(setAccesorios, 'dosPulgadasAmbar', -1)} className="px-2 py-1 font-bold hover:bg-slate-100">-</button><span className="w-full text-center py-1 font-bold border-x border-green-200 text-xs">{accesorios.dosPulgadasAmbar || 0}</span><button onClick={() => handleCant(setAccesorios, 'dosPulgadasAmbar', 1)} className="px-2 py-1 font-bold hover:bg-slate-100">+</button></div></div>
                  <div className="flex items-end pb-0.5"><label className="flex items-center space-x-2 cursor-pointer font-bold text-[11px] text-green-900 bg-white px-2 py-1.5 rounded border border-green-300 w-full justify-center shadow-sm"><input type="checkbox" checked={accesorios.luzPortaplaca || false} onChange={() => toggle(setAccesorios, 'luzPortaplaca')} className="w-3.5 h-3.5 text-green-600"/> <span>Portaplaca</span></label></div>
                </div>
              )}

              {tipoRemolque === 'ganadero' && ( <div className="grid grid-cols-1 gap-4 mb-4 bg-slate-50 p-3 rounded border border-slate-200"><div className="flex justify-between items-center max-w-sm"><label className="text-sm font-bold text-slate-700 flex items-center"><Lightbulb className="w-4 h-4 mr-2 text-amber-500"/> Luces Interiores</label><div className="flex bg-white border border-slate-300 rounded overflow-hidden"><button onClick={() => handleCant(setAccesorios, 'lucesInteriores', -1)} className="px-3 py-1 font-bold hover:bg-slate-100">-</button><span className="px-4 py-1 font-bold border-x border-slate-200">{accesorios.lucesInteriores}</span><button onClick={() => handleCant(setAccesorios, 'lucesInteriores', 1)} className="px-3 py-1 font-bold hover:bg-slate-100">+</button></div></div></div> )}

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pt-4 border-t border-slate-100 items-end">
                <div className="sm:col-span-2">
                  <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Tipo Pintura</label>
                  <select value={acabados.pintura} disabled={(isSpecialClient && market==='usa') || tipoRemolque === 'cama_alta'} onChange={e => setAcabados({...acabados, pintura: e.target.value})} className={`w-full p-2 border border-slate-300 rounded-md h-[34px] text-sm ${((isSpecialClient && market==='usa') || tipoRemolque === 'cama_alta') ? 'bg-slate-100 font-bold' : ''}`}>
                    {db.pinturas.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                   <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Aplicación de Body</label>
                   <select
                       value={(isSpecialClient && market === 'usa' && (!acabados.tipoBody || acabados.tipoBody === 'ninguno')) ? 'estandar' : (acabados.tipoBody || 'ninguno')}
                       onChange={e => {
                           const val = e.target.value;
                           const l = parseInt(dim.largo.replace('ft', '')) || 0;
                           let b = 0;
                           if (val !== 'ninguno') {
                               if (l <= 16) b = 10; else if (l <= 22) b = 12; else if (l <= 26) b = 14; else if (l <= 28) b = 15; else b = 16;
                               if (val === 'full') b += 3;
                           }
                           setAcabados({...acabados, tipoBody: val, bodyLitros: b});
                       }}
                       className="w-full p-2 border border-slate-300 rounded-md h-[34px] text-xs font-bold text-slate-700"
                   >
                       {!(isSpecialClient && market === 'usa') && <option value="ninguno">Sin Body</option>}
                       <option value="estandar">Body Estándar (Inferior, Redila, Llantas, Monturero)</option>
                       <option value="full">Body Full (+ Fender y Defensa)</option>
                   </select>
                </div>
              </div>
            </div>

{/* --- PANEL INTELIGENTE DE UPSELLING (VENTA CRUZADA - FLOTANTE COMPACTO) --- */}
            {(() => {
              const sugerencias = [];
              
              // Textos más cortos para ahorrar espacio
              if (tipoRemolque === 'ganadero' && !carroceria.plexiglass) {
                sugerencias.push({ id: 'plexi', texto: 'Añadir Plexiglass (Protege al ganado)', boton: '+ Añadir Plexiglass', accion: () => toggle(setCarroceria, 'plexiglass') });
              }
              if (tipoRemolque === 'ganadero' && accesorios.lucesInteriores === 0) {
                sugerencias.push({ id: 'luzint', texto: 'Luces Interiores (Para carga nocturna)', boton: '+ 1 Luz Interior', accion: () => handleCant(setAccesorios, 'lucesInteriores', 1) });
              }
              if (acople.gato.includes('hidraulico') && !acople.cargadorSolar && !(isSpecialClient && market === 'usa')) {
                sugerencias.push({ id: 'solar', texto: 'Cargador Solar (Previene batería muerta)', boton: '+ Cargador Solar', accion: () => toggle(setAcople, 'cargadorSolar') });
              }
              if (tipoRemolque === 'cama_baja' && !camaBajaOpts.fenderReforzado) {
                sugerencias.push({ id: 'fenderCB', texto: 'Fender Reforzado (Soporta maquinaria)', boton: '+ Fender Reforzado', accion: () => toggle(setCamaBajaOpts, 'fenderReforzado') });
              }
              if (tipoRemolque === 'volteo' && !volteoOpts.fenderReforzado) {
                sugerencias.push({ id: 'fenderV', texto: 'Fender Reforzado (Mayor durabilidad)', boton: '+ Fender Reforzado', accion: () => setVolteoOpts({...volteoOpts, fenderReforzado: true}) });
              }
            

              if (sugerencias.length === 0) return null;

              return (
                <div className="fixed bottom-4 left-4 sm:bottom-6 sm:left-6 z-[100] w-[calc(100vw-2rem)] sm:w-[240px] bg-white/95 backdrop-blur-xl p-3 rounded-xl shadow-[0_10px_30px_rgba(245,158,11,0.2)] border border-amber-300 print:hidden transition-all duration-300 hover:-translate-y-1">
                  
                  {/* Foquito más pequeño */}
                  <div className="absolute -top-3 -right-3 bg-gradient-to-br from-amber-400 to-orange-500 w-7 h-7 rounded-full flex items-center justify-center shadow-md shadow-orange-500/40 animate-bounce">
                    <Lightbulb className="w-3.5 h-3.5 text-white" />
                  </div>
                  
                  <h2 className="text-[10px] font-black text-amber-900 mb-2 uppercase tracking-wider">💡 Sugerencia</h2>
                  
                  <div className="flex flex-col gap-2">
                    {/* SOLO MOSTRAMOS 1 A LA VEZ */}
                    {sugerencias.slice(0, 1).map(s => (
                      <div key={s.id} className="bg-amber-50/50 p-2 rounded-lg border border-amber-100">
                        <p className="text-[11px] font-bold text-slate-700 mb-2 leading-tight">{s.texto}</p>
                        <button onClick={s.accion} className="w-full bg-amber-500 hover:bg-amber-600 text-white font-black py-1.5 px-2 rounded-md text-[10px] uppercase transition-all duration-300 shadow-sm hover:shadow-amber-500/40 active:scale-95">
                          {s.boton}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
            

            {/* --- NOTAS Y OBSERVACIONES --- */}
            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 mt-6 print:hidden">
                <h2 className="text-lg font-black text-slate-800 flex items-center mb-4"><FileText className="w-5 h-5 mr-2 text-green-600"/> 6. Notas y Observaciones para Diseño</h2>
                <textarea value={cliente.observaciones || ''} onChange={e => setCliente({...cliente, observaciones: e.target.value})} className="w-full p-3 border border-slate-300 rounded-md font-medium text-sm focus:ring-2 focus:ring-green-500 outline-none" placeholder="Ej. El techo debe llevar una caída diferente en la parte trasera, cliente solicita ganchos extra, etc..." rows="3"></textarea>
            </div>
            
            {/* --- EXTRAS ESPECIALES DESPLEGABLES --- */}
            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 mt-6 print:hidden">
                <button onClick={() => setMostrarExtras(!mostrarExtras)} className="w-full text-left flex justify-between items-center group">
                    <h2 className="text-lg font-black text-slate-800 flex items-center"><Plus className="w-5 h-5 mr-2 text-green-600"/> Extras Especiales (Fuera de Catálogo)</h2>
                    <span className="text-sm font-bold text-green-600 bg-green-50 px-3 py-1 rounded-full border border-green-200 transition group-hover:bg-green-100">{mostrarExtras ? 'Ocultar' : 'Agregar Extra'}</span>
                </button>
                
                {mostrarExtras && (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                        <div className="flex flex-col sm:flex-row gap-3 mb-3">
                            <input type="text" value={inputExtra.nombre} onChange={e => setInputExtra({...inputExtra, nombre: e.target.value})} placeholder="Descripción... (Ej. Llantas Michelin)" className="flex-1 p-2 border border-slate-300 rounded-md font-medium text-sm" />
                            <div className="relative w-full sm:w-40">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">$</span>
                                <input type="number" value={inputExtra.precio} onChange={e => setInputExtra({...inputExtra, precio: e.target.value})} placeholder="0.00" className="w-full p-2 pl-7 border border-slate-300 rounded-md font-bold text-sm text-green-700" />
                            </div>
                            <button onClick={() => { if(inputExtra.nombre) { setExtrasCustom([...extrasCustom, { id: Date.now(), nombre: inputExtra.nombre, precio: inputExtra.precio }]); setInputExtra({nombre: '', precio: ''}); } }} className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-md font-bold transition flex items-center justify-center shadow-sm">Añadir</button>
                        </div>
                        
                        {extrasCustom.length > 0 && (
                            <div className="space-y-2 mt-4 pt-4 border-t border-slate-100">
                                {extrasCustom.map(ext => (
                                    <div key={ext.id} className="flex justify-between items-center bg-slate-50 p-2.5 rounded border border-slate-200 text-sm">
                                        <span className="font-bold text-slate-700">• {ext.nombre}</span>
                                        <div className="flex items-center space-x-4">
                                            <span className="font-black text-green-700">{formatoMoneda(Number(ext.precio))}</span>
                                            <button onClick={() => setExtrasCustom(extrasCustom.filter(e => e.id !== ext.id))} className="text-red-500 hover:bg-red-100 p-1.5 rounded transition"><Trash2 className="w-4 h-4"/></button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

          </div>

          {/* ====== COLUMNA DERECHA (TICKET) ====== */}
          <div className="w-full xl:w-1/3 print:w-full print:block">
            <div className="sticky top-24 max-h-[calc(100vh-6rem)] overflow-y-auto pb-8 pr-1 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full">
              
              {activeTab === 'cotizacion' && (
                <div id="ticket-cotizacion" className="bg-white p-6 rounded-xl shadow-xl border-t-8 border-slate-900 print:relative print:top-0 print:border-t-0 print:shadow-none print:w-full print:p-0 animar-entrada">

                  {/* MEMBRETE */}
                  <div className="flex items-center justify-between mb-6 border-b-2 border-slate-800 pb-4 gap-3">
                    <div className="flex items-center space-x-3 overflow-hidden">
                      <img src="/logo_amacsa.png" alt="AMACSA" className="h-10 sm:h-12 object-contain shrink-0" />
                      <div className="min-w-0">
                        <h1 className="text-[11px] sm:text-sm font-black text-slate-900 leading-tight truncate">ADEMES Y MAQUINARIA DE CUAUHTÉMOC S.A. DE C.V.</h1>
                        <p className="text-[9px] sm:text-xs text-slate-600 font-bold">Sucursal Campo 6 1/2, Cuauhtémoc, Chihuahua.</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <h2 className="text-sm sm:text-xl font-black tracking-widest text-slate-800">
                        {esHojaDiseno ? 'HOJA DE DISEÑO' : 'COTIZACIÓN'}
                      </h2>
                      <p className="text-[10px] font-bold text-slate-500 mt-0.5">Fecha: {fechaCotizacion}</p>
                    </div>
                  </div>

                  <h2 className="text-2xl font-black mb-6 border-b-4 border-slate-900 pb-2 uppercase flex items-center text-slate-800 print:hidden"><FileText className="w-6 h-6 mr-3"/> {esHojaDiseno ? 'HOJA DE DISEÑO (INTERNO)' : 'COTIZACIÓN OFICIAL'}</h2>
                  
                  {/* ====== DATOS DE LA ORDEN (ENCABEZADO HORIZONTAL) ====== */}
                  {(cliente.nombre || cliente.telefono || (esHojaDiseno && (folio || fechaEntrega))) && (
                    <div className="p-4 bg-slate-50 print:bg-transparent print:border-y-2 print:border-x-0 print:border-slate-800 print:py-3 print:px-0 print:mb-6 print:rounded-none rounded-lg border border-slate-200 mb-6">
                      <h3 className="font-bold text-slate-800 mb-2 uppercase tracking-wider text-[10px]">
                        {esHojaDiseno ? 'Datos de la Orden' : 'Datos del Cliente'}
                      </h3>
                      <ul className="flex flex-col sm:flex-row print:flex-row flex-wrap gap-x-8 gap-y-2 text-slate-700 print:text-slate-900 text-xs">
                        {cliente.nombre && <li>• Cliente: <span className="font-bold">{cliente.nombre}</span></li>}
                        {cliente.telefono && !esHojaDiseno && <li>• Teléfono: <span className="font-bold">{cliente.telefono}</span></li>}
                        <li>• Cantidad: <span className="font-black text-green-700 print:text-slate-900">{cliente.cantidad || 1} Remolque(s)</span></li>
                        {esHojaDiseno && folio && <li>• Folio: <span className="font-black text-green-700 print:text-slate-900">{folio}</span></li>}
                        {esHojaDiseno && fechaEntrega && <li>• Entrega Estimada: <span className="font-black text-amber-600 print:text-slate-900">{fechaEntrega}</span></li>}
                      </ul>
                    </div>
                  )}

                  {/* ====== ESPECIFICACIONES (NUEVO ORDEN) ====== */}
                  <div className="p-4 bg-white print:p-0 rounded-lg border border-slate-200 print:border-0 mb-6">
                    <h3 className="font-bold text-slate-800 mb-4 uppercase tracking-wider text-[10px] print:hidden">Especificaciones del Remolque</h3>
                    <ul className="space-y-3 text-slate-700 print:text-slate-900 text-xs">
                      <li><span className="font-black uppercase text-slate-500 print:text-slate-700 mr-2">Tipo y Tamaño:</span><br className="print:hidden"/> Remolque {tipoRemolque === 'ganadero' ? 'Ganadero' : tipoRemolque === 'cama_alta' ? 'Cama Alta' : tipoRemolque === 'volteo' ? 'Volteo' : 'Cama Baja'} AMACSA {oLargo.valor}' Largo x {oAncho.valor}" Ancho</li>
                      
                      <li><span className="font-black uppercase text-slate-500 print:text-slate-700 mr-2">Capacidad y Ejes:</span><br className="print:hidden"/> <span className="font-bold text-green-700 print:text-slate-900">{nombreCapacidadTicket}</span> — {oSusp.nombre} — Llantas {oLlantas.nombre} {rodado.cantFrenos > 0 ? `(${rodado.cantFrenos}x Ejes c/Frenos)` : ''}</li>
                      <li><span className="font-black uppercase text-slate-500 print:text-slate-700 mr-2">Tipo de Jalón:</span><br className="print:hidden"/> <span className="font-bold">{oJalon.nombre}</span> {market === 'usa' ? '(Ganso 3/8 x 35")' : (acople.cadena !== 'ninguna' ? `(${oCadena.nombre})` : '')} {acople.sujetaCadenas ? '+ Sujeta Cadenas' : ''}</li>
                      
                      {tipoRemolque !== 'cama_alta' && <li><span className="font-black uppercase text-slate-500 print:text-slate-700 mr-2">Redila:</span><br className="print:hidden"/> <span className="font-bold">{oRedila.nombre}</span></li>}
                      
                      <li><span className="font-black uppercase text-slate-500 print:text-slate-700 mr-2">Piso:</span><br className="print:hidden"/> <span className="font-bold">{oPiso.nombre}</span></li>
                      
                      <li><span className="font-black uppercase text-slate-500 print:text-slate-700 mr-2">Gato (Elevación):</span><br className="print:hidden"/> <span className="font-bold">{acople.cantGatos}x {oGato.nombre}</span> {acople.cargadorSolar ? '+ Cargador Solar' : ''} {acople.cargador110 ? '+ Cargador 110v' : ''}</li>
                      
                      {tipoRemolque === 'ganadero' && <li><span className="font-black uppercase text-slate-500 print:text-slate-700 mr-2">Puertas:</span><br className="print:hidden"/> <span className="font-bold">Interiores:</span> {carroceria.puertasIntList?.length === 0 ? 'Ninguna' : carroceria.puertasIntList?.length === 1 ? `1x ${getObj(db.puertasInteriores, carroceria.puertasIntList[0].tipo).nombre} (Centrada)` : carroceria.puertasIntList?.map((p, i) => `${i+1}. ${getObj(db.puertasInteriores, p.tipo).nombre} a ${p.distancia}"`).join(' | ')} &nbsp;|&nbsp; <span className="font-bold">Trasera:</span> {oPTras.nombre} {carroceria.puertaPiloto ? `| Piloto Lateral (${carroceria.puertaPilotoAncho}")` : ''}</li>}
                      {tipoRemolque === 'volteo' && <li><span className="font-black uppercase text-slate-500 print:text-slate-700 mr-2">Puerta Trasera:</span><br className="print:hidden"/> <span className="font-bold capitalize">{volteoOpts.puertaTrasera.replace('_', ' ')}</span></li>}

                      <li>
                        <span className="font-black uppercase text-slate-500 print:text-slate-700 block mb-1">Otros Accesorios:</span>
                        <ul className="ml-4 space-y-1 text-slate-600 print:text-slate-800 list-disc">
                          {tipoRemolque === 'ganadero' && <li>Techo: <span className="font-bold">{oTecho.nombre} {carroceria.techo === 'media_especial' && carroceria.techoEspecialLargo ? `(${carroceria.techoEspecialLargo} Pies)` : ''}</span></li>}
                          {tipoRemolque === 'ganadero' && carroceria.frente !== 'ninguno' && <li>Frente: <span className="font-bold capitalize">{carroceria.frente}</span> {carroceria.puertaPerroCachucha ? '(C/ Puerta Perro)' : ''}</li>}
                          {tipoRemolque === 'ganadero' && oMont.id !== 'ninguno' && <li>Monturero: <span className="font-bold">{oMont.nombre}</span> {monturero.puertaPerro ? '(C/ Puerta Perro Lateral)' : ''}</li>}
                          {tipoRemolque === 'ganadero' && carroceria.plexiglass && <li>Sistema de Plexiglass (Todas las rejillas)</li>}
                          {tipoRemolque === 'ganadero' && carroceria.rackPacas && <li>Rack Superior para Pacas</li>}
                          {tipoRemolque === 'volteo' && <li>Sistema de Elevación: <span className="font-bold capitalize">{volteoOpts.sistemaElevacion}</span></li>}
                          {['cama_baja', 'cama_alta'].includes(tipoRemolque) && camaBajaOpts.rampas !== 'ninguna' && <li>Accesos: <span className="font-bold">{oRampa.nombre}</span></li>}
                          {['cama_baja', 'volteo'].includes(tipoRemolque) && (camaBajaOpts.fenderReforzado || volteoOpts.fenderReforzado) && <li>Fender Reforzado Especial</li>}
                          {rodado.llantaExtra > 0 && <li><span className="font-bold">{rodado.llantaExtra}x</span> Llanta de Refacción</li>}
                          {Number(rodado.portaExtra) > 0 && <li><span className="font-bold">{Number(rodado.portaExtra)}x</span> Porta Extra Especial</li>}
                          {carroceria.polverasEspeciales && <li>Polveras Estilo USA</li>}
                          <li>Luces: <span className="font-bold">{oLuces.nombre}</span> {acabados.luces === 'especial_mexico' ? `(${accesorios.ovaloRojo||0}x Óv. R, ${accesorios.ovaloAmbar||0}x Óv. A, ${accesorios.tresCuartosRojo||0}x 3/4" R, ${accesorios.tresCuartosAmbar||0}x 3/4" A, ${accesorios.dosPulgadasRojo||0}x 2" R, ${accesorios.dosPulgadasAmbar||0}x 2" A)` : ''} {accesorios.luzPortaplaca || camaBajaOpts.luzPortaplaca || volteoOpts.luzPortaplaca ? '+ Luz Portaplaca' : ''}</li>
                          {acabados.cajaHtas !== 'ninguna' && <li>Caja de Herramientas: <span className="font-bold">{acabados.cajaHtas === 'std' ? 'Estándar' : acabados.cajaHtas === 'grande' ? 'Grande Aluminio' : `Medida Especial (${acabados.cajaHtasLargo}" Pulgadas)`}</span></li>}
                          {((acabados.tipoBody || 'ninguno') !== 'ninguno' || (isSpecialClient && market === 'usa')) && <li>Aplicación de Body: <span className="font-bold">{(acabados.tipoBody === 'full') ? 'Full (Estándar + Fender y Defensa)' : 'Estándar (Chasis, Redila, Monturero, Llantas)'}</span></li>}
                          {extrasCustom.map(ext => (
                              <li key={ext.id}>Extra: <span className="font-bold">{ext.nombre}</span> {!esHojaDiseno && <span className="text-slate-400 text-[10px] ml-1">(+ {formatoMoneda(Number(ext.precio))})</span>}</li>
                          ))}
                        </ul>
                      </li>

                      <li><span className="font-black uppercase text-slate-500 print:text-slate-700 mr-2">Color del Remolque:</span><br className="print:hidden"/> <span className="font-black uppercase">{db.colores?.find(c => c.id === acabados.color)?.nombre || 'Estándar'}</span></li>
                    </ul>
                  </div>

                  {/* Observaciones impresas en Ticket */}
                  {cliente.observaciones && (
                      <div className="mt-4 p-4 bg-amber-50 print:bg-transparent print:border-2 print:border-slate-800 border border-amber-200 rounded-lg mb-6">
                          <h4 className="font-black text-amber-900 print:text-slate-800 text-xs uppercase tracking-wider mb-2">Notas y Observaciones Especiales:</h4>
                          <p className="text-sm font-medium text-amber-800 print:text-slate-900 whitespace-pre-wrap leading-relaxed">{cliente.observaciones}</p>
                      </div>
                  )}

                  {/* Ocultar precios si es hoja de diseño */}
                  {!esHojaDiseno && (
                    <>
                      <div className="mt-6 pt-4 border-t-2 border-slate-800 bg-slate-900 print:bg-transparent print:border-slate-300 print:-mx-0 print:px-0 -mx-6 px-6 pb-6 rounded-b-xl text-white print:text-slate-900 print:shadow-none print:mt-2 print:pt-2">
                        <div className="flex justify-between text-slate-300 print:text-slate-700 font-bold mb-1 text-[11px] print:mb-0"><span>Subtotal Neto</span><span>{formatoMoneda(subtotalNeto)}</span></div>
                        {cliente.descuentoPct > 0 && ( <div className="flex justify-between text-red-400 print:text-red-700 font-bold mb-1 text-[11px] print:mb-0"><span>Descuento Comercial ({cliente.descuentoPct}%)</span><span>- {formatoMoneda(montoDescuento1)}</span></div> )}
{cliente.descuentoExtraPct > 0 && ( <div className="flex justify-between text-amber-500 print:text-amber-700 font-bold mb-1 text-[11px] print:mb-0"><span>Descuento Extra ({cliente.descuentoExtraPct}%)</span><span>- {formatoMoneda(montoDescuento2)}</span></div> )} {market !== 'usa' && ( <div className="flex justify-between text-slate-400 print:text-slate-600 font-bold mb-2 text-[11px] print:mb-0"><span>I.V.A. (16%)</span><span>{formatoMoneda(subtotalIva)}</span></div> )}
                        {cliente.ajusteRedondeo !== 0 && ( <div className="flex justify-between text-purple-400 print:text-purple-700 font-bold mb-3 text-[11px] print:mb-0"><span>Ajuste / Redondeo</span><span>{cliente.ajusteRedondeo > 0 ? '+' : ''} {formatoMoneda(cliente.ajusteRedondeo)}</span></div> )}

                        <div className="text-[10px] font-bold tracking-widest text-green-500 print:text-slate-500 uppercase mb-1 border-t border-slate-700 print:border-slate-300 pt-2 print:mt-1">Precio Final {market === 'usa' ? '(Tasa 0% IVA)' : '(IVA Incluido)'}</div>
                        <div className={`flex justify-between font-black mt-1 ${Number(cliente.anticipo) > 0 ? 'text-2xl mb-2' : 'text-3xl'} items-center print:text-2xl print:mb-1`}>
                          <span>TOTAL</span>
                          <span className={`${market === 'usa' ? 'text-green-400' : 'text-white'} print:text-slate-900`}>{formatoMoneda(totalFinal)}</span>
                        </div>

                        {Number(cliente.anticipo) > 0 && (
                          <>
                            <div className="flex justify-between text-slate-300 print:text-slate-700 font-bold mb-1 text-xs border-t border-slate-700 print:border-slate-300 pt-2 print:pt-1"><span>Anticipo</span><span className="text-amber-400 print:text-slate-800">{formatoMoneda(Number(cliente.anticipo))}</span></div>
                            <div className="flex justify-between font-black mt-1 text-xl items-center print:text-lg"><span>Saldo Pendiente</span><span className="text-white print:text-slate-900">{formatoMoneda(saldoPendiente)}</span></div>
                          </>
                        )}
                        <p className="text-slate-400 print:text-slate-500 text-[9px] mt-4 text-center print:mt-2">Cotización válida por 15 días. Sujeta a cambios de precios, ingeniería y planta sin previo aviso. Razón Social: Ademes y Maquinaria de Cuauhtémoc S.A. de C.V.</p>
                      </div>

                      <div className="block mt-6 pt-2 border-t border-slate-300 text-center mx-auto w-48"><p className="text-[11px] font-bold text-slate-800">{currentUser?.name}</p><p className="text-[9px] text-slate-500">Representante de Ventas AMACSA</p></div>
                    </>
                  )}
                </div>
              )}

              {activeTab === 'cotizacion' && (
                <div className="print:hidden flex flex-col gap-3 mt-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button onClick={handleWhatsAppPDF} disabled={isGeneratingIA} className={`font-black py-3 px-4 rounded-xl flex items-center justify-center transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-green-500/50 active:scale-95 ${isGeneratingIA ? 'bg-slate-400 cursor-not-allowed text-white' : 'bg-[#25D366] hover:bg-[#128C7E] text-white'}`}>
                      {isGeneratingIA ? <RefreshCw className="w-5 h-5 mr-2 animate-spin" /> : <Send className="w-5 h-5 mr-2" />}
                      <span>{isGeneratingIA ? 'Redactando con IA...' : 'WhatsApp con PDF'}</span>
                    </button>
                    <button onClick={handleGuardarCotizacion} className="bg-slate-800 hover:bg-slate-700 text-white font-black py-3 px-4 rounded-xl flex items-center justify-center transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-slate-700/50 active:scale-95"><Save className="w-5 h-5 mr-2" /> <span>Guardar en Historial</span></button>
                  </div>
                  
                  {/* Botón de Guardar en Catálogo (Habilitado para Ventas y Admin) */}
                  <button onClick={handleGuardarComoCatalogo} className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white font-black py-3 px-4 rounded-xl flex items-center justify-center transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-orange-500/50 active:scale-95 mt-1 border border-orange-600/50">
                    <span className="text-2xl leading-none mr-2">🌟</span> <span>Guardar en Catálogo de Línea</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </main>
      )}
    </div>
  );
}