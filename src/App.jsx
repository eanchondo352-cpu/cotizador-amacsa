import Especiales from './Especiales';
import {FAMILIAS_ESPECIALES,esEspecial,conectarExtrasFotos,cotizarEspecial} from './especiales-mexico';
import ACCESORIOS_MEXICO from './accesorios-mexico.json';
import CATALOGO_MEXICO from './catalogo-mexico.json';
import {USA_HABILITADO,registroVisible,esRegistroUSA} from './mercados';
import {integrarUSA,configurarUSA,evaluarUSA,equipoUSA,modeloCompactoUSA} from './catalogo-usa';
import TipoCambio, {validarCambio, convertirUSD, ReferenciasUSA} from './TipoCambio';
import {corregirFrenteRedondo,esTorflex,corregirFrenosCatalogo,gruposPrecios, numeroPrecio, limitesLargo, opcionesReglas, normalizarReglas, validarReglas, puertasReglas, ejesReglas, precioPorLargo, actualizarCatalogoReglas, aplicarPredeterminados} from './reglas-amacsa';
import {PuertasInteriores, PanelTarifas} from './PanelReglas';
import React, { useState, useEffect } from 'react';
import { AlertTriangle, Truck, FileText, Printer, Settings, Save, Plus, Trash2, Shield, Disc, DoorOpen, Layers, Zap, Lightbulb, Lock, Unlock, LogOut, ClipboardList, Star, Users, History, User, Key, Database, Globe, Image, RefreshCw, Send, Menu, X } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';

// === MOTOR MEXICO: LISTAS + CONFIGURADOR ORIGINAL ===
// Importes de venta con IVA incluido. Las interpolaciones NO son costos de fabricación.
const mxRedondear = n => Math.round((n + Number.EPSILON) * 100) / 100;
const mxTon = id => ({'850kg':.85,'1_5t':1.5,'1_5t_3500':1.5,'1_5t_5200':1.5,'2t_5200':2,'2t_6200':2,'3t':3,'4t':4,'4t_6000':4,'4t_5200':4,'4t_6200':4,'6t':6,'7t':7,'9t':9,'10t':10}[id]);
const mxCapId = n => ({'.85':'850kg','0.85':'850kg','1.5':'1_5t',2:'2t_5200',3:'3t',4:'4t_5200',6:'6t',7:'7t',9:'9t',10:'10t'}[n]);
// Equipo base de cama baja confirmado para cotizar desde la lista.
const mxJalonBase = (tipo,cap,ganso=false) => ganso?'ganso_normal':['cama_baja','volteo','ganadero_redondo'].includes(tipo)?'bumper_2':'bumper_2_516';
const mxCamaBajaInicial = () => ({
  tipoRemolque:'cama_baja',tipoGanadero:'ganso',dim:{ancho:'60in',largo:'10ft'},
  rodado:{capacidad:'3t',llanta:'700_15',suspension:'susp_3t',cantFrenos:0,llantaExtra:0,portaExtra:1,cantEjesGanso:2},
  acople:{jalon:'bumper_2',gato:'normal_2k',cantGatos:1,cadena:'seguridad_14',sujetaCadenas:false,controlFreno:false,cargadorSolar:false,cargador110:false},
  carroceria:{redila:'ptr_abierta_2',techo:'sin_techo',frente:'ninguno',puertasIntList:[],puertaPiloto:false},
  acabados:{piso:'madera',pintura:'liquida',luces:'estandar_mexico',bodyLitros:0,pinturaLitros:0,techoLitros:0,cajasPolvo:0,cajaHtas:'ninguna',cajaChapa:'ninguna'},
  monturero:{tipo:'ninguno'},camaBajaOpts:{rampas:'ninguna',fenderReforzado:false,luzPortaplaca:false},
  volteoOpts:{},accesorios:{lucesInteriores:0,ovaloRojo:0,ovaloAmbar:0,tresCuartosRojo:0,tresCuartosAmbar:0,dosPulgadasRojo:0,dosPulgadasAmbar:0,luzPortaplaca:false},
  extrasCustom:[],cantEjes:2
});
function mxEvaluar(db, q) {
 if(esEspecial(q.tipoRemolque))return cotizarEspecial(db,q);
 try {
  const {tipoRemolque:tipo,tipoGanadero,dim,rodado:r,acople:a,carroceria:c,acabados:f,monturero:m,camaBajaOpts:b,volteoOpts:v,accesorios:x}=q;
  const avisos=[], ajustes=[];
  const tipoTarifa=tipo==='ganadero'?(tipoGanadero==='redondo'?'ganadero_redondo':'ganadero_ganso_mex'):tipo;
  const objeto=(seccion,id)=>db[seccion]?.find(e=>e.id===id);
  const tarifa=(seccion,id,campo='precio')=>{
    const e=objeto(seccion,id); const valor=e?.[`${campo}_${tipoTarifa}`];
    if(!numeroPrecio(valor)) throw new Error(`Falta tarifa de ${seccion}: ${id}. Captúrala en Configuraciones.`);
    return Number(valor);
  };
  const cantidad=(n,nombre)=>{ const valor=Number(n??0);if(!Number.isFinite(valor)||valor<0)throw new Error(`Revisa la cantidad de ${nombre}.`);return valor; };
  const largo=q.usarLargoCustom?Number(q.largoCustom):Number(objeto('largos',dim.largo)?.valor);
  const ancho=Number(objeto('anchos',dim.ancho)?.valor), cap=mxTon(r.capacidad);
  if(!Number.isFinite(largo)||largo<=0||!Number.isFinite(ancho)||ancho<=0||!cap)throw new Error('Selecciona medidas y capacidad válidas.');
  const erroresReglas=validarReglas({...q,market:'mexico'},db);if(erroresReglas.length)throw new Error(erroresReglas[0]);
  const familia=tipo==='ganadero'?`ganadero_${tipoGanadero}`:tipo;
  let piso=f.piso==='lamina_madera'?'lámina':'madera';
  let variante=tipo==='cama_baja'?`${String(c.redila).startsWith('cerrada')?'Cerrado':'Abierto'} / ${piso}`:tipo==='volteo'?(v.sistemaElevacion==='hidraulico'?'Con tractor':'Con bomba eléctrica'):tipo==='ganadero'&&tipoGanadero==='redondo'?(c.redila==='desmontable'?'Redila desmontable':'Redila fija'):null;
  let filas=mxFilasModelos(db).filter(z=>z.tipo===familia && (!variante || z.variante===variante) && z.modoPrecio==='fijo')
    .filter(z=>z.w>0&&z.l>0&&z.t>0);
  if(tipo==='cama_baja'){
    const redilaTresExacta=c.redila==='ptr_abierta_3'&&filas.some(z=>['CB2','CB14'].includes(z.codigoLista)&&z.w===ancho&&z.l===largo&&z.t===cap);
    filas=filas.filter(z=>redilaTresExacta?['CB2','CB14'].includes(z.codigoLista):!['CB2','CB14'].includes(z.codigoLista));
    // CB3 trae rampa para moto. Solo se compara directamente cuando se pide puerta rampa.
    if(b.rampas!=='puerta_rampa')filas=filas.filter(z=>z.codigoLista!=='CB3');
  }
  filas=filas.filter(z=>z.w===ancho && z.capacidadId===r.capacidad);
  if(!filas.length)throw new Error('No hay una configuración comparable en las listas para esta selección. Define su precio en Configuraciones.');
  const exactas=filas.filter(z=>z.l===largo&&z.w===ancho&&z.t===cap);
  if(exactas.length>1&&!exactas.some(z=>z.id===q.referenciaMexico)) return {ok:false,error:'La lista tiene varias variantes para estas medidas. Elige la referencia de precio.',alternativas:exactas};
  if(!exactas.length && !filas.some(z=>z.id===q.referenciaMexico) && gruposPrecios(filas).length>1)return {ok:false,error:'Elige el modelo de referencia con el mismo equipo.',alternativas:filas};
  const calculoLargo=precioPorLargo(filas,largo,exactas.length===1?exactas[0].id:q.referenciaMexico,db.tarifasLargo);
  const referencias=new Map(calculoLargo.referencias.map(z=>[z.id,z]));
  let esEstimacion=calculoLargo.estimado;
  avisos.push(...calculoLargo.avisos);
  let base=mxRedondear(calculoLargo.base);
  if(tipo==='ganadero'&&tipoGanadero==='ganso'&&esTorflex(q,db)&&ancho===76){
    base=mxRedondear(base*(79/76));esEstimacion=true;
    avisos.push('Torflex en ganadero ganso: ancho estructural ajustado automáticamente de 76 a 79 pulgadas.');
  }
  const deLista=suffix=>mxAccesorioPanel(db,tipoTarifa,suffix);
  const equipoComun=(campo,fallback)=>{
    const valores=[...new Set([...referencias.values()].map(z=>z[campo]))];
    return valores.length===1&&valores[0]!==undefined?valores[0]:fallback;
  };
  const agregar=(nombre,importe,origen='Cargo adicional del Panel de Control')=>{
    if(!Number.isFinite(importe))throw new Error(`No se pudo calcular ${nombre}.`);
    importe=mxRedondear(importe);if(importe!==0){ajustes.push({nombre,importe,origen});if(origen.includes('estimación'))esEstimacion=true;}
  };
  const extra=(nombre,unidades,id,suffix)=>{
    unidades=cantidad(unidades,nombre);if(!unidades)return;
    const p=suffix&&deLista(suffix);
    const unitario=p?Number(p.precio):tarifa('extras',id);
    if(unitario===0){avisos.push(`${nombre}: tarifa de cero en el catálogo; revisa que sea intencional.`);esEstimacion=true;}
    agregar(`${nombre} × ${unidades}`,unidades*unitario,p?p.origen:'Cargo adicional del Panel de Control');
  };
  const diferencia=(nombre,seccion,seleccion,incluido,unidades=1)=>{if(seleccion&&seleccion!==incluido)agregar(nombre,tarifa(seccion,seleccion)*unidades);};
  const ganso=tipo==='cama_alta'||(tipo==='ganadero'&&tipoGanadero==='ganso');
  const ejeInfo=ejesReglas(q);const ejeCount=ejeInfo.cantidad;
  const ejesBase=Number(equipoComun('cantEjes',cap<=2?1:cap===9?3:2));
  if(ejeCount!==ejesBase || cap===10&&r.cantEjesGanso===310)extra('Cambio de configuración de ejes',1,'cantidadEjes');
  const frenosIncluidos =
  r.suspension === 'torflex'
    ? equipoComun('cantFrenos', ganso ? (cap === 9 ? 2 : 1) : 0)
    : 0;

const frenosSeleccionados = Math.max(
  0,
  cantidad(r.cantFrenos, 'frenos')
);

const frenosExtra = Math.max(
  0,
  frenosSeleccionados - frenosIncluidos
);

if (frenosExtra > 0) {
  extra(
    'Frenos adicionales',
    frenosExtra,
    'frenos',
    'FRENOS'
  );
}

if (frenosSeleccionados > 0 && r.suspension !== 'torflex') {
  avisos.push(
    `Frenos seleccionados: ${frenosSeleccionados} eje(s) × $3,500 MXN`
  );
}
  const llantaBase=equipoComun('llanta',cap<=3?'700_15':tipo==='cama_alta'&&cap===10?'17_5in':'235_80_16');
  diferencia('Cambio de llantas','llantas',r.llanta,llantaBase,ejeCount*ejeInfo.llantasPorEje);
  if(r.llantaExtra){const pl=r.llanta==='700_15'?deLista('LL700'):r.llanta==='750_16'?deLista('LL750'):null;agregar(`Llanta de refacción × ${r.llantaExtra}`,cantidad(r.llantaExtra,'llantas')*(pl?Number(pl.precio):tarifa('llantas',r.llanta,'precioExtra')),pl?pl.origen:'Cargo adicional del Panel de Control');}
  extra('Porta extra',Math.max(0,Number(r.portaExtra)-(tipo==='ganadero'&&tipoGanadero==='redondo'?0:1)),'portaExtra','PORTA');
  extra('Control de freno',a.controlFreno,'controlFreno','CONTROL');
  const suspBase=equipoComun('suspension',['cama_baja','volteo'].includes(tipo)?cap<=1.5?'susp_1_5t':cap>=6?'susp_6t':'susp_3t':'muelle');
  if(esTorflex(q,db)){
    // Torflex se selecciona como sistema; el eje y su precio dependen de la capacidad.
    const ejeTorflex=cap===9?'torflex_8000':cap===10?'torflex_10000':cap>=6?'torflex_7000':null;
    if(ejeTorflex){
      const importeEje=tarifa('suspension',ejeTorflex)*ejeCount;
      agregar(`Eje Torflex automático (${ejeCount} × ${ejeInfo.libras.toLocaleString('en-US')} lbs)`,importeEje,'Precio de eje Torflex según capacidad');
    } else avisos.push('Torflex no está disponible para esta capacidad; selecciona una capacidad de 6, 9 o 10 toneladas.');
  } else if(r.suspension==='muelle_drop'){
    // Muelle estándar es parte del precio base; Drop solo se cobra si tiene
    // una tarifa capturada en el Panel de Control.
    const drop=db.suspension?.find(x=>x.id==='muelle_drop');
    const precioDrop=drop?.[`${'precio'}_${tipoTarifa}`];
    if(Number.isFinite(Number(precioDrop)))agregar('Cambio a Muelles Drop',Number(precioDrop),'Panel de Control');
    else avisos.push('Muelles Drop: captura su tarifa en el Panel de Control para cotizar el cambio.');
  }
  diferencia('Cambio de jalón','jalones',a.jalon,equipoComun('jalon',mxJalonBase(tipo,cap,ganso)));
  const gatoBase=tipo==='ganadero'&&tipoGanadero==='redondo'&&cap===6?'manual_7k':equipoComun('gato',tipo==='volteo'||tipo==='cama_alta'?'manual_12k':ganso?'manual_12k':cap<=.85?'tubo_2k':cap<=3?'normal_2k':'manual_7k');
  const gatosBase=equipoComun('cantGatos',1);
  if(ganso&&a.gato==='hidraulico_sencillo'){
    const importe=Number(a.cantGatos)>=2?23950:14950;agregar(`Gato hidráulico + kit × ${a.cantGatos}`,importe,'Tarifa confirmada por diseño');
  } else {
    diferencia('Cambio de gato','gatos',a.gato,gatoBase,gatosBase);
    if(Number(a.cantGatos)>gatosBase){const extraGatos=Number(a.cantGatos)-gatosBase;const p=deLista(a.gato==='manual_12k'?'GATO12':a.gato==='manual_7k'?'GATO7':'SIN_PRECIO');agregar('Cantidad adicional de gatos',extraGatos*(p?Number(p.precio):tarifa('gatos',a.gato,'precioExtra')),p?p.origen:'Cargo adicional del Panel de Control');}
  }
  diferencia('Cadena de seguridad','cadenas',a.cadena,tipo==='ganadero'&&tipoGanadero==='redondo'?'seguridad_14':ganso||cap>=6?'ganso_38':'seguridad_14');
  extra('Sujeta cadenas',a.sujetaCadenas,'sujetaCadenas');extra('Cargador solar',a.cargadorSolar,'cargadorSolar');extra('Cargador 110 V',a.cargador110,'cargador110');
  // Piso y redila ya están considerados en el precio base comparable.
  const pisoIncluido=equipoComun('piso','madera');
  if(f.piso!==pisoIncluido)agregar('Cambio de piso',largo*ancho/12*tarifa('pisos',f.piso,'precioSqFt'));
  if(tipo==='cama_baja'){
    const redilaBase=equipoComun('redila','ptr_abierta_2');
    diferencia('Altura o tipo de redila','redilas',c.redila,redilaBase);
  } else if(tipo==='ganadero'&&tipoGanadero==='redondo'&&!['ptr_abierta','desmontable'].includes(c.redila))diferencia('Tipo de redila','redilas',c.redila,'ptr_abierta');
  else if(tipo==='ganadero'&&ganso)diferencia('Tipo de redila','redilas',c.redila,'ptr_abierta');
  if (tipo === 'ganadero') {
  if (
    c.techo &&
    c.techo !== equipoComun('techo', 'sin_techo')
  ) {
    if (
      c.techo === 'media_especial' &&
      (
        Number(c.techoEspecialLargo) <= 0 ||
        Number(c.techoEspecialLargo) > largo
      )
    ) {
      throw new Error(
        'Captura el largo del techo especial entre 1 pie y el largo del remolque.'
      );
    }

    const p = deLista('TECHO');

    const fraccion = {
      medio: 0.5,
      media_especial: 0.5,
      tres_cuartos: 0.75,
      completo: 1
    }[c.techo] || 0;

    const largoCubierto =
      c.techo === 'media_especial'
        ? Number(c.techoEspecialLargo)
        : Number(largo) * fraccion;

    const precioPorPieTecho =
      Number(p?.precio) > 0 ? Number(p.precio) : 800;

    const precioTecho =
      largoCubierto * precioPorPieTecho;

    agregar(
      'Techo',
      precioTecho,
      `Techo: ${largoCubierto} pies lineales × $${precioPorPieTecho.toLocaleString('es-MX')} MXN`
    );
  }
}
    diferencia('Puerta trasera','puertasTraseras',c.puertaTras,equipoComun('puertaTras','corrediza'));
    const puertas=c.puertasIntList||[];
    puertas.forEach((p,i)=>{if(i<Number(equipoComun('puertasIncluidas',1))&&p.tipo===equipoComun('puertaCentralTipo',tipoGanadero==='redondo'?'corrediza':'fija'))return;const precio=tarifa('puertasInteriores',p.tipo);agregar(`Puerta interior ${i+1}: ${p.tipo}`,precio);if(precio===0){esEstimacion=true;avisos.push('Puerta interior adicional con tarifa cero: captura su precio para valorar el cambio.');}});
    extra('Puerta piloto lateral',c.puertaPiloto,'puertaPiloto','PTALATERAL');
    extra('Rack para pacas',c.rackPacas,'rackPacas');extra('Ventilación estándar',c.ventEst,'ventEst');extra('Ventilación circular',c.ventCirc,'ventCirc');
    extra('Polveras especiales',c.polverasEspeciales,'polverasEspeciales');extra('Puerta perro frontal',c.puertaPerroCachucha,'puertaPerroCachucha');
    extra('Apertura estribo',c.aperturaEstribo,'aperturaEstribo');extra('Apertura limpieza',c.aperturaLimpieza,'aperturaLimpieza');
    if(c.frente==='cachucha'&&c.frente!==equipoComun('frente','ninguno'))extra('Cachucha',1,'frenteCachucha','CACHUCHA');else if(c.frente==='canasta'&&c.frente!==equipoComun('frente','ninguno'))extra('Canasta',1,'frenteCanasta');
    if(ganso&&a.gato==='hidraulico_sencillo'&&c.frente==='canasta'&&(!f.cajaHtas||f.cajaHtas==='ninguna')){extra('Caja de herramientas obligatoria para canasta',1,'cajaHtasStd');extra('Chapa cromo de caja obligatoria',1,'cajaChapaCromo');avisos.push('La canasta con gato hidráulico requiere caja de herramientas.');}
    if(c.plexiglass)extra('Hojas de plexiglás',Math.ceil(Math.max(0,q.piesPlexi||0)/44),'hojaPlexiglass');
    if(m.tipo&&m.tipo!=='ninguno'){
      agregar('Monturero',tarifa('montureros',m.tipo));extra('Bases de montura',m.basesMontura,'basesMontura');extra('Tubos de cobija',m.tubosCobija,'tubosCobija');extra('Puerta perro del monturero',m.puertaPerro,'puertaPerroLateral');
    }
  }
  if(tipo==='cama_baja')extra('Puerta lateral',c.puertaPiloto,'puertaPiloto');
  if(['cama_baja','cama_alta'].includes(tipo)){
    const rampaBase=equipoComun('rampas',tipo==='cama_alta'?'recto_rampas':'ninguna');
    diferencia('Cambio de rampas','rampas',b.rampas,rampaBase);
  }
  if(tipo==='volteo'){
    if(v.sistemaElevacion==='ambos'){extra('Sistema dual: pistón adicional',1,'pistonHidraulico','PISTON');esEstimacion=true;avisos.push('Sistema dual estimado desde bomba eléctrica más pistón: la lista no publica un paquete dual.');}
    if(v.puertaTrasera!=='libro') { const id='volteoPuerta_'+v.puertaTrasera;extra('Cambio de puerta de volteo',1,id); }
  }
  if(['cama_baja','volteo'].includes(tipo))extra('Fender reforzado',tipo==='volteo'?v.fenderReforzado:b.fenderReforzado,'fenderReforzado');
  diferencia('Pintura','pinturas',f.pintura,equipoComun('pintura','liquida'));
  if(f.luces==='especial_mexico'){
    if(![x.ovaloRojo,x.ovaloAmbar,x.tresCuartosRojo,x.tresCuartosAmbar,x.dosPulgadasRojo,x.dosPulgadasAmbar].some(z=>Number(z)>0))diferencia('Paquete especial de luces','luces',f.luces,'estandar_mexico');
    extra('Luz óvalo roja',x.ovaloRojo,'luzOvalo');extra('Luz óvalo ámbar',x.ovaloAmbar,'luzOvaloAmbar');
    extra('Luz 3/4 roja',x.tresCuartosRojo,'luzTresCuartosRoja');extra('Luz 3/4 ámbar',x.tresCuartosAmbar,'luzTresCuartosAmbar');
    extra('Luz 2 pulgadas roja',x.dosPulgadasRojo,'luzDosPulgadasRoja');extra('Luz 2 pulgadas ámbar',x.dosPulgadasAmbar,'luzDosPulgadasAmbar');
  }else diferencia('Paquete de luces','luces',f.luces,'estandar_mexico');
  extra('Luces interiores',x.lucesInteriores,'lucesInteriores');
  extra('Luz portaplaca',Boolean(x.luzPortaplaca||b.luzPortaplaca||v.luzPortaplaca),'luzPortaplaca');
  extra('Body (litros)',f.bodyLitros,'litroBody');
  if(f.pintura==='liquida'){extra('Pintura (litros adicionales)',f.pinturaLitros,'litroPintura');extra('Pintura techo (litros adicionales)',f.techoLitros,'litroPintura');}
  if(f.cajaHtas&&f.cajaHtas!=='ninguna'){
    const cajaId=f.cajaHtas==='std'?'cajaHtasStd':f.cajaHtas==='grande'?'cajaHtasGrande':'cajaHtasEspecial';
    if(tipo==='volteo'){if(cajaId!=='cajaHtasStd')agregar('Cambio de caja de herramientas',tarifa('extras',cajaId));avisos.push('Se considera incluida la caja estándar obligatoria del volteo según las reglas originales; la foto no desglosa este equipo.');esEstimacion=true;}
    else extra('Caja de herramientas',1,cajaId);
    if(f.cajaChapa&&f.cajaChapa!=='ninguna')extra(`Chapa de caja (${f.cajaChapa==='negra'?'negra':'cromo'})`,1,f.cajaChapa==='negra'?'cajaChapaNegra':'cajaChapaCromo');
  }
  for(const e of q.extrasCustom||[])agregar(e.nombre,Number(e.precio),'Importe capturado manualmente');
  if(tipo==='ganadero'){const p=puertasReglas(q,db);if(p.consulta)avisos.push(p.consulta);if(!limitesLargo(q).max&&largo>44){esEstimacion=true;avisos.push('Largo especial mayor a 44 pies: consultar con diseño.');}}
  const extras=mxRedondear(ajustes.reduce((s,e)=>s+e.importe,0));
  if(base+extras<=0)throw new Error('Los ajustes dejan un precio no válido; revisa las tarifas.');
  return {ok:true,base,extras,ajustes,referencias:[...referencias.values()].map(z=>({id:z.id,nombre:z.nombre,precio:z.precio,medidas:z.medidas,capacidad:z.capacidad})),esEstimacion,avisos:[...new Set(avisos)],alternativas:exactas.length>1?exactas:[]};
 }catch(error){return {ok:false,error:error.message,alternativas:[]};}
}
// === FIN MOTOR MEXICO ===

const MX_LISTAS = CATALOGO_MEXICO;
const MX_ACCESORIOS = ACCESORIOS_MEXICO;
// Una sola fuente editable: modelosLinea y las secciones originales del Panel de Control.
const MX_DESTINOS_ACCESORIOS = {
  FRENOS:['extras','frenos','precio','Frenos eléctricos (por eje)'],
  CONTROL:['extras','controlFreno','precio','Control de freno'],
  PORTA:['extras','portaExtra','precio','Porta extra'],
  GATO7:['gatos','manual_7k','precioExtra','Gato de 7,000 lbs'],
  GATO12:['gatos','manual_12k','precioExtra','Gato de 12,000 lbs'],
  LL700:['llantas','700_15','precioExtra','Llanta y rin 700-15'],
  LL750:['llantas','750_16','precioExtra','Llanta y rin 750-16'],
  PTARAMPA:['rampas','puerta_rampa','precioExtra','Puerta rampa'],
  PTALATERAL:['extras','puertaPiloto','precio','Puerta piloto lateral'],
  REDILA:['extras','pieRedilaVolteo','precio','Pie adicional de redila de volteo'],
  PISTON:['extras','pistonHidraulico','precio','Pistón hidráulico'],
  PISTON30:['extras','piston30x30','precio','Pistón 30 x 30'],
  BOMBA:['extras','bombaElectrica','precio','Bomba eléctrica adicional'],
  TIJERA:['extras','tijeraPiston','precio','Tijera para pistón'],
  TECHO:['extras','precioPieTecho','precio','Techo de lámina por pie lineal'],
  JALON:['jalones','ganso_normal','precioExtra','Jalón cuello de ganso'],
  CACHUCHA:['extras','frenteCachucha','precio','Frente: Cachucha']
};
function mxModeloDeLista(z) {
  const medidas=z.medidas.match(/[\d.]+/g)||[],cap=Number(z.capacidad.replace(/[^\d.]/g,''))/(z.capacidad.includes('kg')?1000:1);
  const ganso=z.tipo==='cama_alta'||z.tipo==='ganadero_ganso',baja=z.tipo==='cama_baja',volteo=z.tipo==='volteo';
  const largo=medidas[1]?`${medidas[1]}${z.medidas.trim().endsWith('"')?'in':'ft'}`:`${medidas[0]}ft`,ancho=medidas[1]?`${medidas[0]}in`:'';
  const redila=baja?(z.nombre.includes('Cerrado')?'cerrada_2':['CB2','CB14'].includes(z.codigoLista)?'ptr_abierta_3':'ptr_abierta_2'):z.tipo==='cama_alta'?'sin_redila':z.nombre.includes('Redila desmontable')?'desmontable':'ptr_abierta';
  return {...z,market:'mexico',tipoRemolque:z.tipo,capacidadLista:z.capacidad,capacidad:mxCapId(cap)||z.capacidad,largo,ancho,
    redila:baja&&z.especificaciones.includes('Sin redila')?'sin_redila':redila,piso:volteo||z.nombre.includes('/ lámina')?'lamina_madera':'madera',
    jalon:mxJalonBase(z.tipo,cap,ganso),suspension:baja||volteo?cap<=1.5?'susp_1_5t':cap>=6?'susp_6t':'susp_3t':'muelle',
    llanta:cap<=3?'700_15':z.tipo==='cama_alta'&&cap===10?'17_5in':'235_80_16',
    gato:volteo||z.tipo==='cama_alta'?'manual_12k':ganso?'manual_12k':cap<=.85?'tubo_2k':cap<=3?'normal_2k':'manual_7k',
    cadena:ganso||cap>=6?'ganso_38':'seguridad_14',cantGatos:volteo&&cap===6?2:1,
    cantFrenos:ganso?(cap===9?2:1):0,llantaExtra:0,portaExtra:0,
    techo:'sin_techo',pintura:'liquida',luces:'estandar_mexico',color:'gris',
    rampas:z.tipo==='cama_alta'?'recto_rampas':z.codigoLista==='CB3'?'puerta_rampa':'ninguna',
    sistemaElevacion:z.nombre.includes('Con bomba eléctrica')?'electrico':'hidraulico',
    foto:z.tipo==='cama_baja'?'/img_camabaja.png':z.tipo==='cama_alta'?'/img_camaalta.png':volteo?'/img_volteo.png':'',
    soloCatalogo:!['cama_baja','cama_alta','ganadero_redondo','ganadero_ganso','volteo'].includes(z.tipo),esReferenciaListaMexico:true};
}
function mxUnificarCatalogo(data) {
  if(data._mxCatalogoUnificado===1)return false;
  data.modelosLinea=data.modelosLinea||[];
  for(const z of data.modelosCotizacion??MX_LISTAS) {
    if(!data.modelosLinea.some(m=>m.id===z.id))data.modelosLinea.push(mxModeloDeLista(z));
  }
  for(const p of data.piezasCotizacion??MX_ACCESORIOS) {
    const [,grupo,suffix]=p.id.split('-'),destino=MX_DESTINOS_ACCESORIOS[suffix];if(!destino)continue;
    const tipos={CAMA:['cama_baja'],VOLTEO:['volteo'],GANADERO:['ganadero_ganso_mex','ganadero_redondo'],ESPECIALES:['cama_alta'],CAJA:['caja_seca']}[grupo]||[];
    const [seccion,id,campo,nombre]=destino;
    data[seccion]=data[seccion]||[];let item=data[seccion].find(z=>z.id===id);
    if(!item){item={id,nombre,precio:null};data[seccion].push(item);}
    for(const tipo of tipos){
      const key=`${campo}_${tipo}`;
      if(item[key]===undefined)item[key]=p.precio;
      item.origenesMexico={...item.origenesMexico,[key]:{id:p.id,precio:p.precio,fechaLista:p.origen?.fechaLista||'',ajustePct:p.origen?.ajustePct||0}};
    }
  }
  delete data.modelosCotizacion;delete data.piezasCotizacion;
  data._mxCatalogoUnificado=1;
  return true;
}
function auditarCatalogoMexico(data){
 if(data._auditoriaMexico20260910)return false;
 const fuentes=new Map(MX_LISTAS.map(z=>[z.id,z]));
 for(const m of data.modelosLinea||[]){
  if(m.market!=='mexico'||!m.esReferenciaListaMexico||!fuentes.has(m.id))continue;
  const z=fuentes.get(m.id),base=mxModeloDeLista(z);
  if(Number(m.precio)!==Number(z.precio))m.precioAnteriorAuditoria=m.precio??null;
  for(const k of ['precio','origen','especificaciones','ancho','largo','piso','redila','rampas','sistemaElevacion','cantFrenos','soloCatalogo'])m[k]=base[k]??null;
  if(m.soloCatalogo){
   m.equipoFotografia=z.especificaciones;
   if(z.tipo==='caja_seca'){m.piso='madera';m.puertaTras='libro';m.alturaMetros=z.codigoLista==='CS1'?1.2:2;}
   if(z.tipo==='cuatrimotos'){m.piso=z.nombre.includes('lámina')?'lamina_madera':'madera';m.rampas='puerta_rampa';}
   if(z.tipo==='volteo_manual'||z.tipo==='forrajero'||z.tipo==='piedras')m.piso='lamina_madera';
   if(z.tipo==='vasculante'){m.piso=z.nombre.includes('antiderrapante')?'lamina_antiderrapante':'madera';m.cantEjes=2;}
   if(z.tipo==='comida')m.piso='madera';
  }
  if(m.tipoRemolque==='cama_alta')m.cantEjes=2;
  if(m.tipoRemolque==='ganadero_ganso')m.cantEjes=m.capacidad==='9t'?3:2;
 }
 data.anchos||=[];if(!data.anchos.some(x=>x.id==='69in'))data.anchos.push({id:'69in',nombre:'69 Pulgadas',valor:69,precio:0});
 data._auditoriaMexico20260910=true;return true;
}
function repararPreciosLista(data){
 if(data._preciosListaConectados1)return false;
 for(const p of MX_ACCESORIOS){
  const [,grupo,suffix]=p.id.split('-'),d=MX_DESTINOS_ACCESORIOS[suffix];if(!d)continue;
  const tipos={CAMA:['cama_baja'],VOLTEO:['volteo'],GANADERO:['ganadero_ganso_mex','ganadero_redondo'],ESPECIALES:['cama_alta'],CAJA:['caja_seca']}[grupo]||[];
  const [sec,id,campo,nombre]=d;data[sec]||=[];let item=data[sec].find(x=>x.id===id);if(!item){item={id,nombre,precio:null};data[sec].push(item);}
  for(const tipo of tipos){
   const key=campo+'_'+tipo;
   if(!numeroPrecio(item[key])){item[key]=p.precio;item.origenesMexico={...item.origenesMexico,[key]:{id:p.id,precio:p.precio,fechaLista:p.origen?.fechaLista||''}};}
   if(['GATO7','GATO12','PTARAMPA','JALON'].includes(suffix)){
    const destino='precio_'+tipo;if(!numeroPrecio(item[destino])){item[destino]=item[key];item.origenesMexico={...item.origenesMexico,[destino]:item.origenesMexico?.[key]||{id:p.id,precio:item[key]}};}
   }
  }
 }
 data._preciosListaConectados1=true;return true;
}
function mxFilasModelos(data) {
  return (data.modelosLinea||[]).filter(z=>z.market==='mexico'&&z.esReferenciaListaMexico).map(z=>{
    const w=Number(z.ancho?.replace('in','')),l=z.largo?.endsWith('in')?Number(z.largo.replace('in',''))/12:Number(z.largo?.replace('ft','')),t=mxTon(z.capacidad);
    const tipo=z.tipoRemolque;
    const piso=z.piso==='lamina_madera'?'lámina':'madera';
    const variante=tipo==='cama_baja'?`${String(z.redila).startsWith('cerrada')?'Cerrado':'Abierto'} / ${piso}`:tipo==='volteo'?(z.sistemaElevacion==='hidraulico'?'Con tractor':'Con bomba eléctrica'):tipo==='ganadero_redondo'?(z.redila==='desmontable'?'Redila desmontable':'Redila fija'):null;
    return {...z,tipo,w,l,t,variante,capacidadId:z.capacidad,capacidad:`${t} ton`,medidas:`${w}" x ${l}'`};
  });
}
function mxAccesorioPanel(data,tipo,suffix) {
  const d=MX_DESTINOS_ACCESORIOS[suffix];if(!d)return null;
  if(suffix==='PTALATERAL'&&tipo==='cama_baja')return {precio:1500,origen:'Tarifa confirmada para cama baja'};
  const [seccion,id,campo]=d,item=data[seccion]?.find(z=>z.id===id),key=`${campo}_${tipo}`;
  if(!item?.origenesMexico?.[key])return null;
  const valor=item[key];
  if(!numeroPrecio(valor))throw new Error(`Falta tarifa de ${item.nombre}. Captúrala en el Panel de Control.`);
  return {precio:Number(valor),origen:Number(valor)===Number(item.origenesMexico[key].precio)?'Accesorio de lista':'Tarifa del Panel de Control'};
}
function mxConfiguracionModelo(modelo) {
  const q=mxCamaBajaInicial();
  q.tipoRemolque=modelo.tipoRemolque.startsWith('ganadero_')?'ganadero':modelo.tipoRemolque;
  q.tipoGanadero=modelo.tipoRemolque==='ganadero_redondo'?'redondo':'ganso';
  q.dim={ancho:modelo.ancho,largo:modelo.largo};
  for(const key of ['capacidad','suspension','llanta','cantFrenos','llantaExtra','portaExtra'])q.rodado[key]=modelo[key]??q.rodado[key];
  for(const key of ['jalon','gato','cadena','cantGatos'])q.acople[key]=modelo[key]??q.acople[key];
  for(const key of ['redila','techo','frente','puertaTras'])q.carroceria[key]=modelo[key]??q.carroceria[key];
  q.carroceria.puertaTras=modelo.puertaTras||'corrediza';
  q.rodado.cantEjesGanso=modelo.configuracionEjes??(modelo.cantEjes===3?3:2);
  if(q.tipoRemolque==='ganadero')q.carroceria.puertasIntList=Array.from({length:Number(modelo.puertasIncluidas??1)},(_,i)=>({id:'base'+i,tipo:modelo.puertaCentralTipo||'fija',distancia:84}));q.carroceria.modoPuertas='automatico';
  for(const key of ['piso','pintura','luces','color'])q.acabados[key]=modelo[key]??q.acabados[key];
  q.camaBajaOpts.rampas=modelo.rampas||'ninguna';
  q.volteoOpts={sistemaElevacion:modelo.sistemaElevacion||'hidraulico',puertaTrasera:'libro',fenderReforzado:false,luzPortaplaca:false};
  if(q.tipoRemolque==='volteo')q.acabados.cajaHtas='std';
  q.referenciaMexico=modelo.id;
  return q;
}

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
    '76in': Array.from({length:11},(_,i)=>`${i+10}ft`),
    '82in': ['10ft', '11ft', '12ft', '13ft', '14ft', '15ft', '16ft', '17ft', '18ft', '19ft', '20ft'],
  };

  const CAMA_ALTA_LARGOS = ['16ft', '18ft', '20ft', '22ft', '24ft', '26ft', '28ft', '30ft', '32ft', '40ft', '42ft'];
  const CAMA_ALTA_CAPS = ['6t', '9t', '10t'];
  
  const VOLTEO_COMBOS = {
    '60in': ['10ft', '11ft', '12ft', '13ft', '14ft'],
    '76in': ['10ft', '11ft', '12ft', '13ft', '14ft', '15ft', '16ft'],
    '82in': ['10ft', '11ft', '12ft', '13ft', '14ft', '15ft', '16ft']
  };

const getCapacidadesCamaBaja = (anchoId, largoId) => {
  let caps = [];
  if (anchoId === '50in') caps.push('850kg');
  else if (anchoId === '60in') caps.push(...(Number(largoId.replace('ft',''))<=14?['1_5t']:[]),'3t','6t');
  else if (['72in', '76in', '82in'].includes(anchoId)) {
    caps.push('3t', '6t');
    // Aquí agregamos el 11ft y 13ft para que no desaparezca la opción de 1.5 Ton
    if (['10ft', '11ft', '12ft', '13ft', '14ft'].includes(largoId)) caps.push('1_5t');
    if (anchoId === '76in') caps.push('4t_5200','4t_6000');
  }
  return caps.length > 0 ? caps : ['3t'];
};
// --- BASE DE DATOS MAESTRA ---
const DEFAULT_DB = {
  largos: [
    {id:'11ft',nombre:'11 Pies',valor:11,precio:0},
    {id:'13ft',nombre:'13 Pies',valor:13,precio:0},
    {id:'15ft',nombre:'15 Pies',valor:15,precio:0},
    {id:'19ft',nombre:'19 Pies',valor:19,precio:0},
    {id:'30ft',nombre:'30 Pies',valor:30,precio:0},

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
    {id:'4t',nombre:'4 Ton (2 Ejes 5,200 lbs)',precio:6000},
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
    { id: 'torflex', nombre: 'Sistema Torflex', precio: 4500 },
    { id: 'torflex_7000', nombre: 'Eje Torflex 7,000 lbs · 78.5"', precio: 14662.38 },
    { id: 'torflex_8000', nombre: 'Eje Torflex 8,000 lbs · 78.5" sencillo', precio: 22233 },
    { id: 'torflex_10000', nombre: 'Eje Torflex 10,000 lbs · 78.5" sencillo', precio: 35000 },
    { id: 'eje_10000_46', nombre: 'Eje 10,000 lbs · 46" doble rodado', precio: 52189.60 }
  ],
  llantas: [
    { id: 'ninguna', nombre: 'Sin Llantas (Sin rodado)', precio: -12000, precioExtra: 0 },
    { id: '700_15', nombre: '700R15', precio: -3500, precioExtra: 2500 },
    { id: '225_75_15', nombre: '225/75 R15', precio: -2000, precioExtra: 3000 },
    { id: '235_80_16', nombre: 'ST235/80R16', precio: -2500, precioExtra: 3500 },
    { id: '16in_10', nombre: 'ST235/80R16 10 Lonas', precio: -2500, precioExtra: 3500 },
    { id: '16in_14', nombre: 'ST235/80R16 14 Lonas', precio: 0, precioExtra: 2928 },
    { id: '235_80_16_14', nombre: 'ST235/80R16 14 Lonas', precio: 0, precioExtra: 4500 },
    { id: '17_5in', nombre: 'Radial 17.5', precio: 12000, precioExtra: 3894 }
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
    { id: 'medio', nombre: 'Medio Techo', precio: 800 },
    { id: 'media_especial', nombre: 'Media Especial', precio: 800 },
    { id: 'tres_cuartos', nombre: 'Techo 3/4', precio: 800 },
    { id: 'completo', nombre: 'Techo Completo', precio: 800 }
  ],
  jalones: [
    { id: 'ganso_normal', nombre: 'Cuello de Ganso Normal', tipo: 'ganso', precio: -3500 },
    { id: 'ganso_facil', nombre: 'Cuello Ganso Enganche Fácil', tipo: 'ganso', precio: 0 },
    { id: 'bumper_2', nombre: 'Bumper Pull Reforzado 2"', tipo: 'bumper', precio: 600 },
    { id: 'bumper_2_516', nombre: 'Bumper Pull Reforzado 2" 5/16', tipo: 'bumper', precio: -4000 },
    { id: 'bumper_ajustable_2', nombre: 'Bumper Pull Ajustable 2"', tipo: 'bumper', precio: -2500 },
    { id: 'bumper_ajustable_2_516', nombre: 'Bumper Pull Ajustable 2" 5/16', tipo: 'bumper', precio: -2000 },
    { id: 'argolla', nombre: 'Jalón Argolla', tipo: 'bumper', precio: -1500 }
  ],
  gatos: [
    { id: 'tubo_2k', nombre: 'Gato Tubo Corto 2,000 lbs', precio: -1500 },
    { id: 'normal_2k', nombre: 'Gato Normal 2,000 lbs', precio: 0 },
    { id: 'manual_7k', nombre: 'Gato mecánico 7,000 lbs', precio: 1500 },
    { id: 'manual_12k', nombre: 'Gato mecánico/manual 12,000 lbs (ganadero)', precio: 3500 },
    { id: 'hidraulico_sencillo', nombre: 'Gato hidráulico con kit y bomba', precio: 14950 }
  ],
  cadenas: [
    { id: 'ganso_38', nombre: 'Cadena Seguridad Ganso 3/8 x 35"', precio: 0 },
    { id: 'seguridad_14', nombre: 'Cadena Seguridad 1/4 x 54"', precio: 78.6 }
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
    {id:'controlFreno',nombre:'Control de freno (tarifa si no está en lista)',precio:null},
    {id:'cajaHtasEspecial',nombre:'Caja de herramientas especial (pendiente de tarifa)',precio:null},
    {id:'volteoPuerta_dompe',nombre:'Volteo: diferencia por puerta dompe (pendiente)',precio:null},
    {id:'volteoPuerta_sencilla',nombre:'Volteo: diferencia por puerta sencilla (pendiente)',precio:null},
    {id:'volteoPuerta_libro_dompe',nombre:'Volteo: diferencia por puerta combinada (pendiente)',precio:null},
    {id:'puertaPiloto',nombre:'Puerta piloto (tarifa si no está en lista)',precio:null},

    { id: 'luzOvalo', nombre: 'Luz Óvalo Roja (Unidad)', precio: 105.19 },
    { id: 'luzOvaloAmbar', nombre: 'Luz Óvalo Ámbar (Unidad)', precio: 350 },
    { id: 'luzTresCuartosRoja', nombre: 'Luz 3/4" Roja (Unidad)', precio: 25 },
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
    { id: 'pinturaPolvoKg', nombre: 'Pintura en polvo (kg)', precio: 418 },
    { id: 'lona', nombre: 'Lona', precio: 7000 },
    { id: 'cajaChapaCromo', nombre: 'Chapa cromo para caja', precio: 400 },
    { id: 'cajaChapaNegra', nombre: 'Chapa negra para caja', precio: 462.59 },
    { id: 'luzBarraRoja', nombre: 'Luz barra roja', precio: 214 },
    { id: 'fenderReforzado', nombre: 'Fender Reforzado', precio: 1500 },
    { id: 'luzPortaplaca', nombre: 'Luz Portaplaca', precio: 350 },
    { id: 'aperturaEstribo', nombre: 'Apertura para Estribo', precio: 1500 },
    { id: 'aperturaLimpieza', nombre: 'Apertura para Limpieza', precio: 1000 }
  ],
  modelosLinea: []
};

mxUnificarCatalogo(DEFAULT_DB);
actualizarCatalogoReglas(DEFAULT_DB);
if(USA_HABILITADO)integrarUSA(DEFAULT_DB);
corregirFrenosCatalogo(DEFAULT_DB);
repararPreciosLista(DEFAULT_DB);
corregirFrenteRedondo(DEFAULT_DB);
auditarCatalogoMexico(DEFAULT_DB);
conectarExtrasFotos(DEFAULT_DB);

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
  { id: 'rampas', title: 'Rampas y Puertas Traseras', hasPrecioExtra:true },
  { id: 'pisos', title: 'Materiales de Piso (Precio base)', isPiso: true },
  { id: 'puertasInteriores', title: 'Puertas Interiores (Ganadero)' },
  { id: 'puertasTraseras', title: 'Puertas Traseras (Ganadero)' },
  { id: 'techos', title: 'Opciones de Techo' },
  { id: 'jalones', title: 'Tipos de Jalones', hasPrecioExtra:true, isJalon: true },
  { id: 'gatos', title: 'Gatos Hidráulicos y Manuales', hasPrecioExtra:true },
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
  const [cambioDOF,setCambioDOF]=useState(null);
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

  const [view, setView] = useState('cotizador');
  const [filtroCatalogo,setFiltroCatalogo]=useState('todos');
  const [busquedaCatalogo,setBusquedaCatalogo]=useState('');
  const [adminSection, setAdminSection] = useState('cotizaciones');
  const [adminTrailerTab, setAdminTrailerTab] = useState('gen');
  const [activeTab, setActiveTab] = useState('cotizacion');
  const [usarLargoCustom, setUsarLargoCustom] = useState(false);
  const [largoCustom, setLargoCustom] = useState('');
  
  const [market, setMarketEstado] = useState('mexico');
  const setMarket = value => setMarketEstado(USA_HABILITADO ? value : 'mexico');
  const [referenciaMexico, setReferenciaMexico] = useState('');
  const [seleccionUSA,setSeleccionUSA]=useState(null);
  const [filtroClienteUSA,setFiltroClienteUSA]=useState('todos'); 
  const [tipoRemolque, setTipoRemolque] = useState('ganadero');
  const [isSpecialClient, setIsSpecialClient] = useState(false);
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
  const [dim, setDim] = useState({ largo: '16ft', ancho: '76in' });
  const [acople, setAcople] = useState({ jalon: 'ganso_normal', cadena: 'ganso_38', sujetaCadenas: false, gato: 'manual', cantGatos: 1, cargadorSolar: false, cargador110: false });
  const [rodado, setRodado] = useState({ capacidad: '6t', suspension: 'muelle', llanta: '235_80_16', cantFrenos: 1, llantaExtra: 0, portaExtra: 1, cantEjesGanso: 2 });
  const [carroceria, setCarroceria] = useState({ techo: 'sin_techo', frente: 'cachucha', redila: 'ptr_abierta', puertasIntList: [{id: Date.now(), tipo: 'fija', distancia: 84}], modoPuertas:'automatico', puertaTras: 'corrediza', puertaPiloto: false, puertaPilotoAncho: 40, plexiglass: false, rackPacas: false, ventEst: false, ventCirc: false, polverasEspeciales: false, puertaPerroCachucha: false, aperturaEstribo: false, aperturaLimpieza: false });
  const [monturero, setMonturero] = useState({ tipo: 'ninguno', basesMontura: 3, tubosCobija: 2, puertaPerro: false, paredLarga: 85.5, paredCorta: 40 });
  const [acabados, setAcabados] = useState({ piso: 'madera', pintura: 'liquida', mismoColorTecho: false, color: 'gris', luces: 'estandar_usa', bodyLitros: 0, pinturaLitros: 0, techoLitros: 0, cajasPolvo: 0, cajaHtas: 'ninguna', cajaChapa: 'ninguna', cajaHtasLargo: 40 });
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
        let updated = mxUnificarCatalogo(data);
        Object.keys(DEFAULT_DB).forEach(key => {
            if(!Array.isArray(DEFAULT_DB[key]) || key==='modelosLinea')return;
            if (!data[key]) { data[key] = DEFAULT_DB[key]; updated = true; } 
            else {
                DEFAULT_DB[key].forEach(defaultItem => {
                    if (!data[key].find(item => item.id === defaultItem.id)) { data[key].push(defaultItem); updated = true; }
                });
            }
        });
        updated=actualizarCatalogoReglas(data)||updated;
        if(USA_HABILITADO)updated=integrarUSA(data)||updated;
        updated=corregirFrenosCatalogo(data)||updated;
        updated=repararPreciosLista(data)||updated;
        updated=corregirFrenteRedondo(data)||updated;
        updated=auditarCatalogoMexico(data)||updated;
        updated=conectarExtrasFotos(data)||updated;
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

  const handleDbChange = (section, index, field, value) => {
    const newDb = { ...db }; newDb[section][index][field] = value; corregirFrenosCatalogo(newDb); setDb(newDb); setDoc(doc(db_fs, getDocPath('catalog')), newDb);
  };

  const handleDbAdd = (section) => {
    const newDb = { ...db }; const baseItem = { id: `item_${Date.now()}`, nombre: 'Nuevo Elemento', precio: null };
    const sectionDef = ADMIN_SECTIONS.find(s => s.id === section);
    if(sectionDef?.isCatalog)baseItem.market='mexico';
    if (sectionDef?.hasValor) baseItem.valor = 0;
    if (sectionDef?.isPiso) { baseItem.precioSqFt = 0; delete baseItem.precio; }
    if (sectionDef?.isColor) { baseItem.hex = '#000000'; delete baseItem.precio; }
    if (sectionDef?.hasPrecioExtra) { baseItem.precioExtra = 0; }
    if (sectionDef?.isJalon) { baseItem.tipo = 'ganso'; }
    newDb[section] = [...(newDb[section] || []), baseItem];
    setDb(newDb); setDoc(doc(db_fs, getDocPath('catalog')), newDb);
  };

  const executeConfirm = () => {
    if (!confirmDialog) return;
    if (confirmDialog.action === 'DELETE_DB_ITEM') {
        const { section, index } = confirmDialog.payload; const newDb = { ...db }; newDb[section].splice(index, 1);
        setDb(newDb); setDoc(doc(db_fs, getDocPath('catalog')), newDb);
    } else if (confirmDialog.action === 'DELETE_COTIZACION') {
        const { id } = confirmDialog.payload; const updated = cotizaciones.filter(c => c.id !== id);
        setCotizaciones(updated); setDoc(doc(db_fs, getDocPath('cotizaciones')), { list: updated });
        logAction(`Eliminó la cotización con folio ${id} del historial.`);
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

  const aplicarCamaBajaDeLista = () => {
    const base = mxCamaBajaInicial();
    setDim(base.dim);setAcople(base.acople);setRodado(base.rodado);
    setCarroceria(prev=>({...prev,...base.carroceria}));
    setAcabados(prev=>({...prev,...base.acabados}));
    setMonturero(prev=>({...prev,...base.monturero}));
    setCamaBajaOpts(base.camaBajaOpts);setAccesorios(base.accesorios);
    setExtrasCustom([]);setReferenciaMexico('');setUsarLargoCustom(false);setLargoCustom('');
  };
  // --- FUNCIONES ESTRELLA ---
  const handleNuevaCotizacion = () => {
    setSeleccionUSA(null);
    setCambioDOF(null);setFechaCotizacion(new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10));
    setReferenciaMexico('');setUsarLargoCustom(false);setLargoCustom('');setExtrasCustom([]);
    setCliente({ nombre: '', telefono: '', anticipo: 0, descuentoPct: 0, descuentoExtraPct:0, ajusteRedondeo: 0, cantidad:1 });
    cambiarTipo(tipoRemolque,tipoGanadero);
    setNotification({ type: 'success', message: 'Cotizador listo para una nueva cotización.' });
  };

  // --- AYUDANTES MATEMÁTICOS Y CÁLCULOS ---
  const formatoMoneda = (num) => num === null || !Number.isFinite(Number(num)) ? 'Pendiente' : new Intl.NumberFormat('es-MX', { style:'currency', currency:market==='mexico'?'MXN':'USD' }).format(Number(num)) + (market==='mexico'?' MXN':' USD');
  
  const tipoPrecio = tipoRemolque === 'ganadero' 
    ? (tipoGanadero === 'redondo' && market === 'mexico' ? 'ganadero_redondo' 
       : tipoGanadero === 'ganso' && market === 'mexico' ? 'ganadero_ganso_mex' 
       : 'ganadero_ganso') 
    : tipoRemolque;

  const getP = (obj, key = 'precio') => obj ? (obj[`${key}_${tipoPrecio}`] !== undefined ? obj[`${key}_${tipoPrecio}`] : (obj[key] || 0)) : 0;
  const getExtraPrice = (id) => { const ext = db.extras?.find(e => e.id === id); return ext ? (ext[`precio_${tipoPrecio}`] ?? ext.precio ?? 0) : 0; };
  const getObj = (arr, id) => arr?.find(x => x.id === id) || {id,nombre:'No encontrado',precio:null,valor:0};

  const oCap = getObj(db.capacidades, rodado.capacidad);

  const modeloUSA=market==='usa'?seleccionUSA?.modelo:null;
  const modeloEspecial=market==='mexico'&&esEspecial(tipoRemolque)?db.modelosLinea.find(m=>m.id===referenciaMexico):null;
  const qReglas={modeloEspecial,referenciaMexico,modeloUSA,market,isSpecialClient,tipoRemolque,tipoGanadero,dim,rodado,acople,carroceria,acabados,monturero,camaBajaOpts,volteoOpts,accesorios,usarLargoCustom,largoCustom};
  const estadoPuertas=puertasReglas(qReglas,db);
  const erroresConfiguracion=validarReglas(qReglas,db);
  const ejesActuales=ejesReglas(qReglas);
  const cantEjes=ejesActuales.cantidad;
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

  if(oCap.id==='850kg')nombreCapacidadTicket='850 Kg (1 Eje de 2,000 lbs)';
  if(oCap.id==='4t_6000')nombreCapacidadTicket='4 Ton (2 Ejes de 6,000 lbs)';
  if(oCap.id==='3t'&&cantEjes===1)nombreCapacidadTicket='3 Ton (1 Eje de 7,000 lbs)';
  const oLargo = usarLargoCustom && market==='mexico' ? {id:'especial',valor:Number(largoCustom),nombre:`${largoCustom} Pies (especial)`,precio:0} : getObj(db.largos, dim.largo); 
  const oAncho = getObj(db.anchos, dim.ancho); 
  // En Ganadero Ganso, Torflex obliga a fabricar el ancho estructural de 79",
  // aunque la medida de catálogo/base seleccionada sea 76". Conservamos 76"
  // como referencia de lista para poder calcular el precio y mostramos 79"
  // en la cotización y en las especificaciones técnicas.
  const anchoEstructural = tipoRemolque === 'ganadero' && tipoGanadero === 'ganso' && esTorflex(qReglas, db) && oAncho?.valor === 76 ? 79 : oAncho?.valor;
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
  
  const totalCarroceria = costoTecho + getP(oRedila) + (carroceria.puertasIntList||[]).reduce((sum,p)=>sum+getP(getObj(db.puertasInteriores,p.tipo)),0) + getP(oPTras) + (carroceria.frente === 'cachucha' ? getExtraPrice('frenteCachucha') : carroceria.frente === 'canasta' ? getExtraPrice('frenteCanasta') : 0) + (carroceria.plexiglass && piesPlexi > 0 ? Math.ceil(piesPlexi / 46.5) * getExtraPrice('hojaPlexiglass') : 0) + (carroceria.rackPacas ? getExtraPrice('rackPacas') : 0) + (carroceria.ventEst * getExtraPrice('ventEst')) + (carroceria.ventCirc * getExtraPrice('ventCirc')) + (carroceria.polverasEspeciales ? getExtraPrice('polverasEspeciales') : 0) + (carroceria.puertaPerroCachucha ? getExtraPrice('puertaPerroCachucha') : 0);

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
      if(tipo==='ganadero'&&ganadero==='redondo')return 'seguridad_14';
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


  // México usa la lista como base y cobra solo ajustes sobre la configuración de referencia.
  const precioMexico = market === 'mexico' ? mxEvaluar(db, {
    tipoRemolque,tipoGanadero,dim,rodado,acople,carroceria,acabados,monturero,
    camaBajaOpts,volteoOpts,accesorios,extrasCustom,usarLargoCustom,largoCustom,
    referenciaMexico,cantEjes,piesPlexi,market,isSpecialClient
  }) : null;
  const precioUSA=modeloUSA?evaluarUSA(db,db.modelosLinea.find(m=>m.id===modeloUSA.id)||modeloUSA,qReglas,seleccionUSA.base,extrasCustom):null;
  let precioBasePuro = 0;
  if (market === 'mexico') {
    precioBasePuro = precioMexico.ok ? precioMexico.base * (cliente.cantidad || 1) : NaN;
  } else if (precioUSA) {
    precioBasePuro=precioUSA.ok?precioUSA.base*(cliente.cantidad||1):NaN;
  } else if (matchTabulador && Number(matchTabulador.precio) > 0) {
    precioBasePuro = Number(matchTabulador.precio) * (cliente.cantidad || 1);
  } else {
    const precioBase = getExtraPrice('precioBase') || 0;
    const costoPiezasEstructurales = getP(oLargo) + getP(oAncho) + getP(oCap) + costoPisoTotal;
    precioBasePuro = (precioBase + costoPiezasEstructurales) * (cliente.cantidad || 1);
  }
  let costoTotalExtras = (market === 'mexico' ? (precioMexico.ok ? precioMexico.extras : NaN) : precioUSA?(precioUSA.ok?precioUSA.extras:NaN):totalExtrasBlindados) * (cliente.cantidad || 1);
  if(market==='usa'){precioBasePuro=convertirUSD(precioBasePuro,cambioDOF,fechaCotizacion);costoTotalExtras=convertirUSD(costoTotalExtras,cambioDOF,fechaCotizacion);}
  subtotalNeto = mxRedondear(precioBasePuro + costoTotalExtras);

  // --- 4. DESGLOSE FISCAL Y DESCUENTOS (BLINDADOS) ---
  const montoDescuento1 = precioBasePuro * ((cliente.descuentoPct || 0) / 100);
  const baseConDesc1 = precioBasePuro - montoDescuento1;
  
  const montoDescuento2 = baseConDesc1 * ((cliente.descuentoExtraPct || 0) / 100);
  const baseConDescFinal = baseConDesc1 - montoDescuento2;

  const subtotalDescuento = baseConDescFinal + costoTotalExtras;
  
  const subtotalSinIva = market === 'usa' ? subtotalDescuento : mxRedondear((subtotalDescuento + Number(cliente.ajusteRedondeo || 0)) / 1.16);
  const subtotalIva = market === 'usa' ? 0 : mxRedondear(subtotalDescuento + Number(cliente.ajusteRedondeo || 0) - subtotalSinIva);
  
  const totalFinal = mxRedondear(subtotalDescuento + Number(cliente.ajusteRedondeo || 0));
  const saldoPendiente = totalFinal - (cliente.anticipo || 0);
  
  const validarPrecioActual = () => {
    if(precioUSA&&!precioUSA.ok){setNotification({type:'error',message:precioUSA.error});return false;}
    if(market==='usa'&&validarCambio(cambioDOF,fechaCotizacion)){setNotification({type:'error',message:validarCambio(cambioDOF,fechaCotizacion)});return false;}
    if(erroresConfiguracion.length){setNotification({type:'error',message:erroresConfiguracion[0]});return false;}
    if (market==='mexico' && !precioMexico.ok) {setNotification({type:'error',message:precioMexico.error});return false;}
    if (!Number.isFinite(totalFinal) || totalFinal <= 0 || Number(cliente.cantidad)<1 || !Number.isInteger(Number(cliente.cantidad)) || [cliente.descuentoPct,cliente.descuentoExtraPct].some(v=>Number(v)<0||Number(v)>100)) {setNotification({type:'error',message:'Revisa cantidades, descuentos y precio total.'});return false;}
    return true;
  };
  const calcularTotalActual = () => totalFinal;
  const handleGuardarComoCatalogo = () => {
    if (!validarPrecioActual()) return;
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
    if (!validarPrecioActual()) return;
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
      medida: modeloEspecial?modeloEspecial.medidas:`${oLargo.valor}' x ${anchoEstructural}"`,
      total: formatoMoneda(totalCalc),
      vendedor: currentUser?.name || 'Ventas',
      pdfUrl: urlPdf, // <--- AQUÍ SE GUARDA EL ENLACE MÁGICO
config: { seleccionUSA:market==='usa'?seleccionUSA:null, cambioDOF:market==='usa'?cambioDOF:null, moneda:market==='usa'?'USD':'MXN', totalNumerico:totalCalc, detallePrecioMexico:precioMexico, referenciaMexico, tipoGanadero, volteoOpts, extrasCustom, fechaCotizacion, fechaEntrega, folio, market, tipoRemolque, isSpecialClient, cliente, dim, acople, rodado, carroceria, monturero, acabados, accesorios, camaBajaOpts, usarLargoCustom, largoCustom }    };

    const updated = [nuevaCot, ...cotizaciones].slice(0, 200);
    setCotizaciones(updated);
    setDoc(doc(db_fs, getDocPath('cotizaciones')), { list: updated });
    logAction(`Guardó cotización ${nuevaCot.id} con PDF en la nube.`);
    setNotification({ type: 'success', message: `Cotización ${nuevaCot.id} guardada y PDF respaldado con éxito.` });
  };

  const handleCargarCotizacion = (cot) => {
    if(!registroVisible(cot))return;
    if (cot.config) {
      if (cot.config.modoCotizacion === 'ensambles') {setNotification({type:'error',message:'Este documento se guardó con la versión anterior por modelos. Conserva su detalle en el historial de esa versión; para cotizarlo aquí captura sus especificaciones.'});return;}
      setSeleccionUSA(cot.config.seleccionUSA || null);
      setCambioDOF(cot.config.cambioDOF || null);
      setReferenciaMexico(cot.config.referenciaMexico || '');
      setTipoGanadero(cot.config.tipoGanadero || 'ganso');
      setVolteoOpts(cot.config.volteoOpts || {sistemaElevacion:'hidraulico',puertaTrasera:'libro',fenderReforzado:false,luzPortaplaca:false});
      setExtrasCustom(cot.config.extrasCustom || []);
      setFechaCotizacion(cot.config.fechaCotizacion || new Date().toISOString().slice(0,10));
      setFechaEntrega(cot.config.fechaEntrega || '');
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
    if(!registroVisible(cot))return;
    if (cot.config) {
      if (cot.config.modoCotizacion === 'ensambles') {setNotification({type:'error',message:'Este documento se guardó con la versión anterior por modelos. Conserva su detalle en el historial de esa versión; para cotizarlo aquí captura sus especificaciones.'});return;}
      setSeleccionUSA(cot.config.seleccionUSA || null);
      setCambioDOF(null);
      setReferenciaMexico(cot.config.referenciaMexico || '');
      setTipoGanadero(cot.config.tipoGanadero || 'ganso');
      setVolteoOpts(cot.config.volteoOpts || {sistemaElevacion:'hidraulico',puertaTrasera:'libro',fenderReforzado:false,luzPortaplaca:false});
      setExtrasCustom(cot.config.extrasCustom || []);
      setFechaCotizacion(new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10));
      setFechaEntrega(cot.config.fechaEntrega || '');
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
    if(!registroVisible(modelo))return;
    if(modelo.esModeloUSAExcel){
      modelo=modeloCompactoUSA(modelo);
      let q=configurarUSA(modelo,mxCamaBajaInicial());q.modeloUSA=modelo;
      q=normalizarReglas(q,db);
      const baseUSA=JSON.parse(JSON.stringify(q));delete baseUSA.modeloUSA;
      setSeleccionUSA({modelo:JSON.parse(JSON.stringify(modelo)),base:baseUSA});
      setMarket('usa');setIsSpecialClient(!!modelo.isSpecialClient);setTipoRemolque(q.tipoRemolque);setTipoGanadero(q.tipoGanadero);
      actualizarEstadoReglas(q);setReferenciaMexico('');setUsarLargoCustom(false);setLargoCustom('');setExtrasCustom([]);setPrecioManual('');
      setView('cotizador');setNotification({type:'success',message:`${modelo.clienteUSA}: modelo base cargado con el equipo incluido y precio en MXN.`});return;
    }
    setSeleccionUSA(null);
    if(modelo.esReferenciaListaMexico) {
      
      const q=normalizarReglas({...mxConfiguracionModelo(modelo),market:'mexico'},db);
      const tipos=['cama_baja','cama_alta','ganadero','volteo',...FAMILIAS_ESPECIALES];
      if(!tipos.includes(q.tipoRemolque) || (!esEspecial(q.tipoRemolque)&&(!db.anchos.some(z=>z.id===q.dim.ancho)||!db.largos.some(z=>z.id===q.dim.largo)))) {
        setNotification({type:'error',message:'El precio está disponible en Modelos de Línea. Esta familia o medida todavía no tiene reglas de configuración en el formulario original.'});return;
      }
      setMarket('mexico');setIsSpecialClient(false);setTipoRemolque(q.tipoRemolque);setTipoGanadero(q.tipoGanadero);
      setDim(q.dim);setRodado(q.rodado);setAcople(q.acople);
      setCarroceria({puertaPilotoAncho:40,...q.carroceria,especial:{piesExtra:0,extras:{}}});setAcabados({color:'gris',tipoBody:'ninguno',...q.acabados});
      setMonturero({paredLarga:85.5,paredCorta:40,basesMontura:3,tubosCobija:2,...q.monturero});setCamaBajaOpts(q.camaBajaOpts);setVolteoOpts(q.volteoOpts);setAccesorios(q.accesorios);
      setReferenciaMexico(modelo.id);setExtrasCustom([]);setUsarLargoCustom(false);setLargoCustom('');setPrecioManual('');
      setView('cotizador');setNotification({type:'success',message:`Modelo "${modelo.nombre}" cargado desde la lista. Puedes cambiar sus especificaciones.`});return;
    }
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
    if (!validarPrecioActual()) return;
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
      medida: modeloEspecial?modeloEspecial.medidas:`${oLargo.valor}' x ${anchoEstructural}"`,
      total: formatoMoneda(totalCalc),
      vendedor: currentUser?.name || 'Ventas',
      pdfUrl: urlPdf,
      config: { seleccionUSA:market==='usa'?seleccionUSA:null, cambioDOF:market==='usa'?cambioDOF:null, moneda:market==='usa'?'USD':'MXN', totalNumerico:totalCalc, detallePrecioMexico:precioMexico, referenciaMexico, tipoGanadero, volteoOpts, extrasCustom, fechaCotizacion, fechaEntrega, folio, market, tipoRemolque, isSpecialClient, cliente, dim, acople, rodado, carroceria, monturero, acabados, accesorios, camaBajaOpts, usarLargoCustom, largoCustom, precioManual } // <--- PRECIO MANUAL AGREGADO
    };

    const updated = [nuevaCot, ...cotizaciones].slice(0, 200);
    setCotizaciones(updated);
    setDoc(doc(db_fs, getDocPath('cotizaciones')), { list: updated });
    logAction(`Generó y guardó automáticamente la cotización ${nuevaCot.id} vía WhatsApp.`);

    // 4. Mensaje corporativo base (Respaldado por si la IA de Google se satura)
    const totalFinalAMostrar = formatoMoneda(totalCalc);
    let textoFinal = `Estimado(a) *${cliente.nombre || 'Cliente'}*, le comparto el presupuesto oficial de su *Remolque AMACSA*.\n\n*Total:* ${totalFinalAMostrar}\n\nPuedes descargar y revisar su cotización detallada a formato PDF abriendo el siguiente enlace seguro:\n${urlPdf || '[Enlace generado en planta]'}\n\nQuedamos a sus órdenes para cualquier duda o aclaración.\n*Ventas AMACSA*`;

    // 5. Intentamos contactar a Gemini para personalizar el texto
    try {
      const prompt = `Actúa como ${currentUser?.name || 'Representante de Ventas'} de la empresa fabricante AMACSA. 
Redacta un mensaje de WhatsApp breve, profesional y cordial para el cliente ${cliente.nombre || 'estimado cliente'}. 
Infórmale que su presupuesto está listo. 
Datos del equipo: ${modeloEspecial?modeloEspecial.nombre+'; '+modeloEspecial.especificaciones:'Remolque '+tipoRemolque.replace('_', ' ')+' con capacidad de '+nombreCapacidadTicket}. 
Precio total: ${totalFinalAMostrar}.
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

  const isGanaderoRedondoMex=tipoRemolque==='ganadero'&&tipoGanadero==='redondo'&&market==='mexico';
  const isGanaderoRedondoUSA=tipoRemolque==='ganadero'&&tipoGanadero==='redondo'&&market==='usa';

// 1. Este es el control del Mercado (USA vs México) que tenías antes
  useEffect(() => {
    if (market === 'usa' && !seleccionUSA) { 
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
          const cadenaIdeal = tipoRemolque==='ganadero'&&tipoGanadero==='redondo'?'seguridad_14':(tipoRemolque === 'cama_alta' || (tipoRemolque === 'ganadero' && tipoGanadero === 'ganso') || ['6t', '7t', '9t', '10t'].includes(rodado.capacidad)) 
              ? 'ganso_38' 
              : 'seguridad_14';
              
          setAcople(prev => {
              if (prev.cadena !== cadenaIdeal) return { ...prev, cadena: cadenaIdeal };
              return prev;
          });
      }
  }, [tipoRemolque, tipoGanadero, rodado.capacidad, market]);

  const actualizarEstadoReglas=n=>{
    for(const [key,setter] of [['dim',setDim],['rodado',setRodado],['acople',setAcople],['carroceria',setCarroceria],['acabados',setAcabados],['monturero',setMonturero],['camaBajaOpts',setCamaBajaOpts],['volteoOpts',setVolteoOpts],['accesorios',setAccesorios]])
      setter(prev=>JSON.stringify(prev)===JSON.stringify(n[key])?prev:n[key]);
  };
  useEffect(()=>{actualizarEstadoReglas(normalizarReglas(qReglas,db));},[JSON.stringify(qReglas),db]);
  const opciones=opcionesReglas(qReglas,db);
  const disponibles=(seccion,key)=>(db[seccion]||[]).filter(z=>opciones[key||seccion]?.includes(z.id));
  const anchosDisponibles=disponibles('anchos'),largosDisponibles=disponibles('largos'),capacidadesDisponibles=disponibles('capacidades'),jalonesDisponibles=disponibles('jalones'),gatosDisponibles=disponibles('gatos'),suspensionesDisponibles=disponibles('suspension'),llantasDisponibles=disponibles('llantas'),pisosDisponibles=disponibles('pisos'),redilasDisponibles=disponibles('redilas'),monturerosDisponibles=disponibles('montureros'),rampasDisponibles=disponibles('rampas');
  const cadenasDisponibles=(db.cadenas||[]).filter(o=>!opciones.cadenas||opciones.cadenas.includes(o.id));
  const frenosObligatorios=esTorflex(qReglas,db)||['4t_5200','4t_6000','4t_6200'].includes(rodado.capacidad);
  const cambiarTipo=(tipo,sub='ganso')=>{
    setSeleccionUSA(null);
    const candidatos=db.modelosLinea.filter(z=>z.esReferenciaListaMexico&&z.tipoRemolque===(tipo==='ganadero'?'ganadero_'+sub:tipo)&&z.capacidad==='3t');
    const modelo=candidatos.find(z=>z.largo==='12ft')||candidatos[0]||db.modelosLinea.find(z=>z.esReferenciaListaMexico&&z.tipoRemolque===(tipo==='ganadero'?'ganadero_'+sub:tipo)&&z.capacidad==='6t');
    let n=modelo?mxConfiguracionModelo(modelo):mxCamaBajaInicial();
    n={...n,tipoRemolque:tipo,tipoGanadero:sub,market,isSpecialClient:market==='usa'&&isSpecialClient};
    n.carroceria={puertaPilotoAncho:40,puertasIntList:[],puertaTras:'corrediza',...n.carroceria};
    n.monturero={tipo:'ninguno',paredLarga:85.5,paredCorta:40,basesMontura:3,tubosCobija:2};
    actualizarEstadoReglas(normalizarReglas(n,db));setTipoRemolque(tipo);setTipoGanadero(sub);setReferenciaMexico(modelo?.id||'');setUsarLargoCustom(false);setLargoCustom('');setPrecioManual('');setExtrasCustom([]);
  };
    const lucesDisponibles = db.luces?.filter(l => market === 'usa' ? l.id.includes('_usa') : l.id.includes('_mexico')) || [];
    
let capacidadLbs=modeloUSA&&rodado.capacidad===modeloUSA.capacidad?modeloUSA.ejesDescripcion:ejesActuales.libras.toLocaleString('en-US')+' LBS';
  const torflexSeleccionado = esTorflex(qReglas, db);
  let marcaEje = torflexSeleccionado ? 'IMPORTADO TORFLEX' : (capacidadLbs === '10,000 LBS' ? 'LIPPERT' : 'DEXTER');
  let medidasEje = '';
  if (tipoRemolque === 'cama_alta') { 
    if (oCap.id === '10t'&&cantEjes===2) medidasEje = 'C/F 48" Doble Rodado'; else medidasEje = 'C/F 67"'; 
  } else if (tipoRemolque === 'volteo') {
    // REGLAS EXACTAS DE VOLTEO (58", 74", 80")
    if (dim.ancho === '60in') medidasEje = 'C/F 58"';
    else if (dim.ancho === '76in') medidasEje = 'C/F 74"';
    else if (dim.ancho === '82in') medidasEje = 'C/F 80"';
  } else { 
    if (torflexSeleccionado) medidasEje = 'C/F 78.5' ; 
    else if (capacidadLbs === '10,000 LBS') medidasEje = 'C/F HF=91 OB=68.25'; 
    else { if (oAncho.valor === 60) medidasEje = 'C/F HF=76 OB=60.5'; else if (oAncho.valor === 72 && capacidadLbs === '8,000 LBS') medidasEje = 'C/F HF=87.88 OB=72.5'; else if (oAncho.valor === 72) medidasEje = 'C/F HF=76 OB=60.5'; else medidasEje = 'C/F HF=93.25 OB=78.5'; } 
  }
  const nombreEjeCompleto = `EJE ${marcaEje} ${capacidadLbs} ${medidasEje}`;
  const calcLargoPulgadas = (oLargo.valor || 0) * 12;
  const cableAzulMts = rodado.cantFrenos > 0 ? (calcLargoPulgadas + 96 + (rodado.cantFrenos * anchoEstructural)) * 0.0254 : 0;
  
  let llantasPorEje = ejesActuales.llantasPorEje;
  let cantLlantasTotal = (cantEjes * llantasPorEje) + rodado.llantaExtra;
  const hojasPlexiCalculadas = carroceria.plexiglass && piesPlexi > 0 ? Math.ceil(piesPlexi / (Math.floor(96 / 8.25) * 4)) : 0;

  const familiaCatalogo=item=>item.tipoRemolque==='ganadero'?(item.tipoGanadero==='redondo'?'ganadero_redondo':'ganadero_ganso'):item.tipoRemolque;
  const familiasCatalogo=[['todos','Todos'],['ganadero_ganso','Ganadero con ganso'],['ganadero_redondo','Ganadero redondo'],['cama_baja','Cama baja'],['cama_alta','Cama alta'],['volteo','Volteo'],['caja_seca','Caja seca'],['otros','Otros']];
  const modelosVisibles=(db.modelosLinea||[]).filter(registroVisible).filter(z=>{if(filtroClienteUSA!=='todos'&&z.clienteUSA!==filtroClienteUSA)return false;const f=familiaCatalogo(z);return (filtroCatalogo==='todos'||filtroCatalogo===f||filtroCatalogo==='otros'&&!familiasCatalogo.some(([id])=>id===f))&&`${z.nombre} ${z.codigoLista||''} ${z.especificaciones||''}`.toLowerCase().includes(busquedaCatalogo.toLowerCase());});
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
      <style>{`
        @media print {
          @page { margin: 12mm; }
          html:has(#ticket-cotizacion), body:has(#ticket-cotizacion) {
            margin: 0 !important; padding: 0 !important; height: auto !important;
            min-height: 0 !important; overflow: visible !important;
            transform: none !important; zoom: 1 !important;
          }
          /* Retirar formularios y avisos del flujo; visibility:hidden conserva su espacio. */
          body:has(#ticket-cotizacion) *:has(#ticket-cotizacion) > :not(:has(#ticket-cotizacion)):not(#ticket-cotizacion):not(style) {
            display: none !important;
          }
          /* La vista previa tiene sticky y alto de pantalla: el papel necesita flujo normal. */
          body:has(#ticket-cotizacion) *:has(#ticket-cotizacion) {
            display: block !important; position: static !important; float: none !important;
            inset: auto !important; width: 100% !important; max-width: none !important;
            height: auto !important; min-height: 0 !important; max-height: none !important;
            overflow: visible !important; margin: 0 !important; padding: 0 !important;
            transform: none !important; animation: none !important;
            visibility: visible !important; break-inside: auto !important;
          }
          body #ticket-cotizacion {
            display: block !important; position: static !important; float: none !important;
            inset: auto !important; width: 100% !important; max-width: none !important;
            height: auto !important; min-height: 0 !important; max-height: none !important;
            margin: 0 !important; padding: 0 !important; overflow: visible !important;
            transform: none !important; animation: none !important;
            visibility: visible !important; break-inside: auto !important;
            box-shadow: none !important; border: 0 !important; border-radius: 0 !important;
          }
          body #ticket-cotizacion * {
            visibility: visible !important; animation: none !important; max-height: none !important;
          }
          body #ticket-cotizacion .print-only-screen { display: none !important; }
        }
      `}</style>

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
              <button onClick={() => {if(validarPrecioActual())window.print();}} className="p-2.5 sm:p-3 bg-green-600 hover:bg-green-500 rounded-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-green-500/50 active:scale-95 text-white flex items-center justify-center" title="Imprimir Cotización"><Printer className="w-5 h-5"/></button>
              <button onClick={() => { setEsHojaDiseno(true); setTimeout(() => { window.print(); setEsHojaDiseno(false); }, 100); }} className="p-2.5 sm:p-3 bg-slate-800 hover:bg-slate-700 rounded-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-slate-900/50 active:scale-95 text-white mr-1 sm:mr-3 flex items-center justify-center text-lg leading-none" title="Imprimir Hoja de Diseño">🖨️</button>
            </>
          ) : (
            <button onClick={() => setView('cotizador')} className="p-2.5 sm:p-3 bg-green-600 hover:bg-green-500 rounded-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-green-500/50 active:scale-95 text-white flex items-center justify-center mr-1 sm:mr-3" title="Volver al Cotizador"><Save className="w-5 h-5"/></button>
          )}
          <div className="w-px h-8 bg-slate-700 mx-1 hidden sm:block"></div>
          <button onClick={handleLogout} className="p-2.5 sm:p-3 bg-slate-800 hover:bg-red-600 rounded-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-red-500/50 active:scale-95 text-slate-400 hover:text-white flex items-center justify-center" title="Cerrar Sesión"><LogOut className="w-5 h-5"/></button>
        </div>
      </header>

      {view === 'catalogo' ? (
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

          <div className="print:hidden"><PanelTarifas db={db} filas={mxFilasModelos(db)} canEdit={currentUser?.role==='admin'} onChange={tarifas=>{if(currentUser?.role!=='admin')return;const next={...db,tarifasLargo:tarifas};setDb(next);setDoc(doc(db_fs,getDocPath('catalog')),next).catch(()=>setNotification({type:'error',message:'No se pudieron guardar las tarifas. Reintenta.'}));}}/></div>
          <div className="print:hidden flex flex-wrap gap-2 mb-4">{familiasCatalogo.map(([id,label])=><button key={id} onClick={()=>setFiltroCatalogo(id)} className={`px-3 py-2 rounded-lg font-bold ${filtroCatalogo===id?'bg-green-700 text-white':'bg-white border text-slate-700'}`}>{label}</button>)}<input className="border rounded-lg p-2 flex-1" placeholder="Buscar modelo, medida o especificación" value={busquedaCatalogo} onChange={e=>setBusquedaCatalogo(e.target.value)}/></div>
          {USA_HABILITADO&&<div className="flex gap-2 flex-wrap mb-4 print:hidden">{[['todos','Todos los clientes'],['DEAN','Dean · USA especial'],['WALL','Wall · USA normal'],['DH','DH · USA normal']].map(([id,label])=><button key={id} className={`px-4 py-2 rounded-lg text-sm font-bold ${filtroClienteUSA===id?'bg-green-600 text-white':'bg-slate-100 text-slate-600'}`} onClick={()=>setFiltroClienteUSA(id)}>{label}</button>)}</div>}
          <p className="text-sm text-slate-600 mb-4">{familiasCatalogo.find(([id])=>id===filtroCatalogo)?.[1]} · {modelosVisibles.length} modelos</p>
          {/* Catálogo original */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 print:grid-cols-2 print:gap-4 gap-6">
            {modelosVisibles.map(item => (
              <div key={item.id} className="bg-white rounded-2xl shadow-lg overflow-hidden border border-slate-200 hover:shadow-2xl hover:-translate-y-1 transition-all duration-300 flex flex-col print:shadow-none print:border-2 print:border-slate-300 print:break-inside-avoid print:rounded-xl">
                
                <div className="h-56 bg-slate-100 relative group print:h-48 print:bg-transparent">
                  <img src={item.foto || '/img_ganso.png'} alt={item.nombre} className="w-full h-full object-cover transition duration-500 group-hover:scale-110 print:object-contain" onError={e => e.target.src='/img_ganso.png'} />
                  <div className="absolute top-3 right-3 bg-amber-500 text-white text-xs font-black px-3 py-1.5 rounded-lg shadow-md tracking-wider print:bg-white print:text-slate-800 print:border print:border-slate-400 print:shadow-none">{item.clienteUSA?`${item.clienteUSA} · ${item.isSpecialClient?'ESPECIAL':'NORMAL'}`:'ESTÁNDAR'}</div>
                </div>
                
                <div className="p-5 flex flex-col flex-1 print:p-4">
                  <h3 className="font-black text-slate-800 text-xl leading-tight mb-2 print:text-lg">{item.nombre}</h3>
                  <p className="text-sm text-slate-600 font-medium mb-4 flex-1 whitespace-pre-wrap print:text-xs print:mb-2">{item.especificaciones}</p>
                  
                  <div className="border-t border-slate-100 pt-4 flex justify-between items-end mt-auto print:border-slate-300 print:pt-2">
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 print:text-slate-500">Precio Referencia</p>
                      <span className="text-2xl font-black text-blue-700 print:text-slate-900 print:text-xl">{(numeroPrecio(item.precio)?new Intl.NumberFormat("es-MX",{style:"currency",currency:item.market==="mexico"||item.esModeloUSAExcel?"MXN":"USD"}).format(item.precio):'Consultar')} {item.market==="mexico"||item.esModeloUSAExcel?"MXN":"USD"}</span>
                    </div>
                    {/* Ocultamos el botón al imprimir */}
                    {/* Ocultamos el botón al imprimir */}
                    <button onClick={() => handleCotizarDesdeCatalogo(item)} className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-slate-700/50 active:scale-95 print:hidden">Ir a Cotizar</button>
                  </div>
                </div>
                
              </div>
            ))}

            {(modelosVisibles.length===0) && (
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
                         {cotizaciones.filter(registroVisible).length === 0 ? <tr><td colSpan="6" className="p-6 text-center text-slate-500">No hay cotizaciones registradas en la nube.</td></tr> : cotizaciones.filter(registroVisible).map((cot, i) => (
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
                  {adminSection==='modelosLinea'&&<details className="print:hidden mb-4 rounded-xl border border-slate-200 bg-slate-50"><summary className="cursor-pointer p-3 text-sm font-bold text-green-800">Ajustes de precio por largo y listas para imprimir</summary><PanelTarifas db={db} filas={mxFilasModelos(db)} canEdit={currentUser?.role==='admin'} onChange={tarifas=>{if(currentUser?.role!=='admin')return;const next={...db,tarifasLargo:tarifas};setDb(next);setDoc(doc(db_fs,getDocPath('catalog')),next).catch(()=>setNotification({type:'error',message:'No se pudieron guardar las tarifas. Reintenta.'}));}}/></details>}
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-black text-slate-800">{ADMIN_SECTIONS.find(s => s.id === adminSection)?.title}</h2>
                    {!ADMIN_SECTIONS.find(s => s.id === adminSection)?.isFixed && (
                      <button onClick={() => handleDbAdd(adminSection)} className="flex items-center space-x-1 bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-bold transition shadow-sm">
                        <Plus className="w-5 h-5"/> <span>Agregar Elemento</span>
                      </button>
                    )}
                  </div>
                  
                  {USA_HABILITADO&&adminSection==='modelosLinea'&&<div className="flex gap-2 flex-wrap mb-3">{[['todos','Todos los clientes'],['DEAN','Dean · USA especial'],['WALL','Wall · USA normal'],['DH','DH · USA normal']].map(([id,label])=><button key={id} className={`px-3 py-2 rounded-lg text-xs font-bold ${filtroClienteUSA===id?'bg-green-600 text-white':'bg-slate-100 text-slate-600'}`} onClick={()=>{setFiltroClienteUSA(id);setAdminTrailerTab('gen');}}>{label}</button>)}</div>}
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
                        { id: 'cama_alta', name: 'Cama Alta' },
                        { id: 'caja_seca', name: 'Caja Seca' },...FAMILIAS_ESPECIALES.filter(t=>t!=='caja_seca').map(id=>({id,name:id.replaceAll('_',' ')}))
                      ].filter(tab=>USA_HABILITADO||tab.id!=='ganadero_ganso').map(tab => (
                        <button key={tab.id} onClick={() => setAdminTrailerTab(tab.id)} className={`px-4 py-2 rounded-md text-sm font-black whitespace-nowrap transition-all ${adminTrailerTab === tab.id ? 'bg-white text-green-700 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200'}`}>
                          {tab.name}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-2">
                    {db[adminSection]?.map((item, index) => {
                      if(!registroVisible(item)||(!USA_HABILITADO&&(item.id?.startsWith('usa_')||item.id?.endsWith('_usa'))))return null;
                      const sectionDef = ADMIN_SECTIONS.find(s => s.id === adminSection);
                      const isCatalog = sectionDef?.isCatalog;
                      if(isCatalog&&filtroClienteUSA!=='todos'&&item.clienteUSA!==filtroClienteUSA)return null;
                      if(isCatalog && adminTrailerTab!=='gen') {
                        const tipoTab=item.market==='usa'?'ganadero_ganso':item.tipoRemolque==='ganadero_ganso'?'ganadero_ganso_mex':item.tipoRemolque;
                        if(tipoTab!==adminTrailerTab)return null;
                      }

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
                                        placeholder="Consultar" value={item.precio ?? ''} 
                                        onChange={e => handleDbChange(adminSection, index, 'precio', e.target.value===''?null:parseFloat(e.target.value))} 
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

                            {item.market==='mexico'&&<label className="text-xs font-bold"><input type="checkbox" checked={!!item.esReferenciaListaMexico} onChange={e=>{const next={...db,modelosLinea:db.modelosLinea.map((m,i)=>i===index?{...m,esReferenciaListaMexico:e.target.checked,modoPrecio:'fijo'}:m)};setDb(next);setDoc(doc(db_fs,getDocPath('catalog')),next);}}/> Usar como modelo base para el cálculo por largo</label>}
                            {item.esModeloUSAExcel&&<p className="text-xs font-bold text-green-800">{item.clienteUSA} · USA {item.isSpecialClient?'especial':'normal'} · Precio base en MXN · {item.origenUSA.hoja}, {item.origenUSA.celda}</p>}
                            {item.esReferenciaListaMexico && <p className="text-xs text-slate-500">Precio con IVA · Lista {item.origen?.fechaLista}{item.origen?.ajustePct ? ` · ${item.origen.ajustePct}% ya aplicado` : ''} · {item.medidas} · {item.capacidadLista}</p>}
                            {/* --- NUEVA CUADRÍCULA CON TODAS LAS OPCIONES --- */}
                            {esEspecial(item.tipoRemolque)&&<label className="block text-xs font-bold text-slate-500">PRECIO POR PIE ADICIONAL (MXN, IVA INCLUIDO)<input type="number" min="0" step="0.01" value={item.precioPieExtraEspecial??''} placeholder="Capturar si se ofrece largo adicional" className="w-full p-2 border border-slate-300 rounded-md" onChange={e=>handleDbChange(adminSection,index,'precioPieExtraEspecial',e.target.value===''?null:Number(e.target.value))}/></label>}
                            <p className="text-sm text-slate-600">Selecciona una por una las características incluidas en el precio de este modelo. Los cargos por cambios se administran en los apartados de accesorios del Panel de Control.</p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pt-4 border-t border-slate-100">
                              <h3 className="col-span-full text-sm font-black text-green-800 border-b border-slate-200 pb-2 pt-3">Modelo y medidas</h3>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Mercado (Bandera)</label><select value={item.market || ''} onChange={e => handleDbChange(adminSection, index, 'market', e.target.value)} className="w-full p-2 border border-amber-300 rounded-md text-xs font-black bg-amber-50 text-amber-900"><option value="">-- Seleccionar --</option>{USA_HABILITADO&&<option value="usa">USA</option>}<option value="mexico">México</option></select></div>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Tipo Remolque</label><select value={item.tipoRemolque || ''} onChange={e => handleDbChange(adminSection, index, 'tipoRemolque', e.target.value)} className="w-full p-2 border border-amber-300 rounded-md text-xs font-black bg-amber-50 text-amber-900"><option value="">-- Seleccionar --</option>{item.tipoRemolque && !["ganadero_ganso","ganadero_redondo","cama_baja","cama_alta","volteo"].includes(item.tipoRemolque) && <option value={item.tipoRemolque}>{item.tipoRemolque.replaceAll("_"," ")}</option>}<option value="ganadero_ganso">Ganadero Ganso</option><option value="ganadero_redondo">Ganadero Redondo</option><option value="cama_baja">Cama Baja</option><option value="cama_alta">Cama Alta</option><option value="volteo">Volteo</option></select></div>
                              
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Largo</label><select value={item.largo || ''} onChange={e => handleDbChange(adminSection, index, 'largo', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{item.largo && !db.largos?.some(z=>z.id===item.largo) && <option value={item.largo}>{item.largo}</option>}{db.largos?.filter(registroVisible).map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ancho</label><select value={item.ancho || ''} onChange={e => handleDbChange(adminSection, index, 'ancho', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{item.ancho && !db.anchos?.some(z=>z.id===item.ancho) && <option value={item.ancho}>{item.ancho}</option>}{db.anchos?.filter(registroVisible).map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Capacidad</label><select value={item.capacidad || ''} onChange={e => handleDbChange(adminSection, index, 'capacidad', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{item.capacidad && !db.capacidades?.some(z=>z.id===item.capacidad) && <option value={item.capacidad}>{item.capacidad}</option>}{db.capacidades?.filter(registroVisible).map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                              <h3 className="col-span-full text-sm font-black text-green-800 border-b border-slate-200 pb-2 pt-3">Ejes, suspensión y llantas</h3>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Suspensión</label><select value={item.suspension || ''} onChange={e => handleDbChange(adminSection, index, 'suspension', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{db.suspension?.filter(registroVisible).map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Llantas</label><select value={item.llanta || ''} onChange={e => handleDbChange(adminSection, index, 'llanta', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{db.llantas?.filter(registroVisible).map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                              <h3 className="col-span-full text-sm font-black text-green-800 border-b border-slate-200 pb-2 pt-3">Jalón y apoyo</h3>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Jalón</label><select value={item.jalon || ''} onChange={e => handleDbChange(adminSection, index, 'jalon', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{db.jalones?.filter(registroVisible).map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Gato</label><select value={item.gato || ''} onChange={e => handleDbChange(adminSection, index, 'gato', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{db.gatos?.filter(registroVisible).map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                              <h3 className="col-span-full text-sm font-black text-green-800 border-b border-slate-200 pb-2 pt-3">Carrocería y equipamiento</h3>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Techo</label><select value={item.techo || ''} onChange={e => handleDbChange(adminSection, index, 'techo', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{db.techos?.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Redila</label><select value={item.redila || ''} onChange={e => handleDbChange(adminSection, index, 'redila', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{db.redilas?.filter(registroVisible).map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Piso</label><select value={item.piso || ''} onChange={e => handleDbChange(adminSection, index, 'piso', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{db.pisos?.filter(registroVisible).map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Monturero</label><select value={item.monturero || ''} onChange={e => handleDbChange(adminSection, index, 'monturero', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{db.montureros?.filter(registroVisible).map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                              <h3 className="col-span-full text-sm font-black text-green-800 border-b border-slate-200 pb-2 pt-3">Acabados</h3>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Pintura</label><select value={item.pintura || ''} onChange={e => handleDbChange(adminSection, index, 'pintura', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{db.pinturas?.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Luces</label><select value={item.luces || ''} onChange={e => handleDbChange(adminSection, index, 'luces', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{db.luces?.filter(registroVisible).map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                              <div><label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Color</label><select value={item.color || ''} onChange={e => handleDbChange(adminSection, index, 'color', e.target.value)} className="w-full p-2 border border-slate-300 rounded-md text-xs font-bold bg-white"><option value="">-- Seleccionar --</option>{db.colores?.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                            </div>

                            {(item.market==='mexico'||item.esModeloUSAExcel)&&<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 border-t border-slate-100 pt-4">
                              {[['rampas','rampas','Rampas incluidas'],['cadena','cadenas','Cadena incluida'],['puertaTras','puertasTraseras','Puerta trasera incluida']].map(([key,sec,title])=><label key={key} className="text-[10px] font-bold text-slate-500 uppercase block">{title}<select className="block mt-1 w-full p-2 border border-slate-300 rounded-md text-xs font-bold text-slate-800 normal-case bg-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500" value={item[key]||''} onChange={e=>handleDbChange(adminSection,index,key,e.target.value)}><option value="">Seleccionar</option>{db[sec].map(o=><option key={o.id} value={o.id}>{o.nombre}</option>)}</select></label>)}
                              {item.tipoRemolque==='volteo'&&<label className="text-[10px] font-bold text-slate-500 uppercase block">Elevación incluida<select className="block mt-1 w-full p-2 border border-slate-300 rounded-md text-xs font-bold text-slate-800 normal-case bg-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500" value={item.sistemaElevacion||'hidraulico'} onChange={e=>handleDbChange(adminSection,index,'sistemaElevacion',e.target.value)}><option value="hidraulico">Con tractor</option><option value="electrico">Con bomba eléctrica</option></select></label>}
                            </div>}
                            {(item.market==='mexico'||item.esModeloUSAExcel)&&<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 border-t border-slate-100 pt-4">
                              {['cantFrenos','cantGatos','cantEjes','puertasIncluidas'].map(k=><label key={k} className="text-[10px] font-bold text-slate-500 uppercase block">{{cantFrenos:'Frenos incluidos (ejes)',cantGatos:'Gatos incluidos',cantEjes:'Cantidad de ejes incluidos',puertasIncluidas:'Puertas interiores incluidas'}[k]}<input className="block mt-1 w-full p-2 border border-slate-300 rounded-md text-xs font-bold text-slate-800 normal-case bg-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500" type="number" min="0" step="1" disabled={k==='cantFrenos'&&esTorflex({rodado:{suspension:item.suspension}},db)} value={item[k]??0} onChange={e=>handleDbChange(adminSection,index,k,Math.max(0,Number(e.target.value)))}/></label>)}
                              <label className="text-[10px] font-bold text-slate-500 uppercase block">Frente incluido<select className="block mt-1 w-full p-2 border border-slate-300 rounded-md text-xs font-bold text-slate-800 normal-case bg-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500" value={item.frente||'ninguno'} onChange={e=>handleDbChange(adminSection,index,'frente',e.target.value)}>{['ninguno','cuadrado','cachucha','canasta'].map(k=><option key={k}>{k}</option>)}</select></label>
                            </div>}
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
                                          {db.largos?.filter(registroVisible).map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                                      </select>
                                  </div>
                                  <div>
                                      <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Ancho</label>
                                      <select value={item.ancho || ''} onChange={e => handleDbChange(adminSection, index, 'ancho', e.target.value)} className="p-2 border border-slate-300 rounded-md text-xs font-bold text-slate-800 w-28">
                                          <option value="">- Todos -</option>
                                          {db.anchos?.filter(registroVisible).map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                                      </select>
                                  </div>
                                  <div>
                                      <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Capacidad</label>
                                      <select value={item.capacidad || ''} onChange={e => handleDbChange(adminSection, index, 'capacidad', e.target.value)} className="p-2 border border-slate-300 rounded-md text-xs font-bold text-slate-800 w-32">
                                          <option value="">- Todos -</option>
                                          {db.capacidades?.filter(registroVisible).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                                      </select>
                                  </div>
                                  <div className="flex-1 min-w-[140px]">
                                      <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Costo Fijo Exacto ($)</label>
                                      <input type="number" placeholder="Consultar" value={item.precio ?? ''} onChange={e => handleDbChange(adminSection, index, 'precio', e.target.value===''?null:parseFloat(e.target.value))} className="w-full p-2 border border-green-300 bg-green-50 text-green-800 rounded-md font-black text-right" />
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
                      {USA_HABILITADO&&<option value="usa">USA</option>}
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
                      {db.anchos?.filter(registroVisible).map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                  </select>
              </div>
              <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Capacidad</label>
                  <select value={item.capacidad || ''} onChange={e => handleDbChange(adminSection, index, 'capacidad', e.target.value)} className="p-2 border border-slate-300 rounded-md text-xs font-bold text-slate-800 w-32">
                      <option value="">- Seleccionar -</option>
                      {db.capacidades?.filter(registroVisible).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
              </div>
              <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Largo (Pies)</label>
                  <input type="number" value={item.largo || 0} onChange={e => handleDbChange(adminSection, index, 'largo', e.target.value===''?null:parseFloat(e.target.value))} className="p-2 border border-slate-300 rounded-md text-xs font-bold text-slate-800 w-20 text-center" />
              </div>
              
              <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Redila (Opcional)</label>
                  <select value={item.redila || ''} onChange={e => handleDbChange(adminSection, index, 'redila', e.target.value)} className="p-2 border border-slate-300 rounded-md text-xs font-bold text-slate-800 w-28">
                      <option value="">- Cualquiera -</option>
                      {db.redilas?.filter(registroVisible).map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                  </select>
              </div>
              <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Piso (Opcional)</label>
                  <select value={item.piso || ''} onChange={e => handleDbChange(adminSection, index, 'piso', e.target.value)} className="p-2 border border-slate-300 rounded-md text-xs font-bold text-slate-800 w-28">
                      <option value="">- Cualquiera -</option>
                      {db.pisos?.filter(registroVisible).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
              </div>

              <div className="flex-1 min-w-[160px]">
                  <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Precio Base Completo ($)</label>
                  <input type="number" placeholder="Consultar" value={item.precio ?? ''} onChange={e => handleDbChange(adminSection, index, 'precio', e.target.value===''?null:parseFloat(e.target.value))} className="w-full p-2 border border-green-300 bg-green-50 text-green-800 rounded-md font-black text-right" />
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
                            <div className="absolute top-2 right-4 text-[10px] font-bold text-amber-500 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">Precio pendiente de captura</div>
                          )}
                          <div className="flex-1 min-w-[200px]">
                            <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Nombre Comercial</label>
                            <input type="text" value={item.nombre} onChange={e => handleDbChange(adminSection, index, 'nombre', e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-md font-bold text-slate-800 focus:ring-2 focus:ring-green-500 outline-none" />
                          </div>
                          
                          {sectionDef?.hasValor && (
                            <div className="w-24">
                              <label className="text-xs font-bold text-slate-500 uppercase block mb-1">{sectionDef.valorLabel}</label>
                              <input type="number" value={item.valor || 0} onChange={e => handleDbChange(adminSection, index, 'valor', e.target.value===''?null:parseFloat(e.target.value))} className="w-full p-2.5 border border-slate-300 rounded-md font-bold text-slate-800 text-center focus:ring-2" />
                            </div>
                          )}
                          
                          {sectionDef?.hasPrecioExtra && (
                                <div className="w-36">
                                  <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Pieza adicional {isGeneral ? '(Base)' : ''}</label>
                                  <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">$</span>
                                    <input type="number" placeholder="Consultar" value={item[activeExtraKey] !== undefined ? (item[activeExtraKey] ?? '') : isGeneral ? (item.precioExtra ?? '') : ''} onChange={e => handleDbChange(adminSection, index, activeExtraKey, e.target.value===''?null:parseFloat(e.target.value))} className={`w-full p-2.5 pl-7 border rounded-md font-bold ${!isGeneral && item[activeExtraKey] !== undefined ? 'border-green-400 bg-green-50 text-green-800' : 'border-slate-300'}`} />
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
                              <label className="text-xs font-bold text-slate-500 uppercase block mb-1">{sectionDef?.isPiso ? 'Cargo por pie²' : sectionDef?.id === 'anchos' ? 'Costo Pie Extra' : 'Cargo por cambio / adicional'} {isGeneral ? '(Base)' : ''}</label>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">$</span>
                                <input type="number" placeholder="Consultar" value={item[activePKey] !== undefined ? (item[activePKey] ?? '') : isGeneral ? (item[pKey] ?? '') : ''} onChange={e => handleDbChange(adminSection, index, activePKey, e.target.value===''?null:parseFloat(e.target.value))} className={`w-full p-2.5 pl-7 border rounded-md font-black text-right ${!isGeneral && item[activePKey] !== undefined ? 'border-green-400 bg-green-50 text-green-700' : 'border-slate-300 text-slate-700'}`} />
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
                {USA_HABILITADO&&<button onClick={() => setMarket('usa')} className={`flex-1 py-3 px-4 rounded-lg font-black text-sm flex items-center justify-center transition-all duration-300 active:scale-95 ${market === 'usa' ? 'bg-white shadow-lg shadow-green-900/20 text-green-900 scale-[1.02] -translate-y-0.5' : 'text-slate-500 hover:text-slate-700 hover:-translate-y-1 hover:shadow-md'}`}>
                    <img src="https://flagcdn.com/w40/us.png" alt="USA" className="w-5 h-auto mr-2 rounded-sm shadow-sm" /> USA
                </button>}
                <button onClick={() => setMarket('mexico')} className={`flex-1 py-3 px-4 rounded-lg font-black text-sm flex items-center justify-center transition-all duration-300 active:scale-95 ${market === 'mexico' ? 'bg-white shadow-lg shadow-green-700/20 text-green-700 scale-[1.02] -translate-y-0.5' : 'text-slate-500 hover:text-slate-700 hover:-translate-y-1 hover:shadow-md'}`}>
                    <img src="https://flagcdn.com/w40/mx.png" alt="México" className="w-5 h-auto mr-2 rounded-sm shadow-sm" /> MÉXICO
                </button>
            </div>

            {/* NUEVAS TARJETAS VISUALES DE REMOLQUES */}
            <div className={`grid gap-3 ${market === 'mexico' ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-2 max-w-md'}`}>
                
                {/* 1. Ganadero Ganso (Visible siempre) */}
                <button onClick={() => { cambiarTipo('ganadero','ganso'); }} className={`relative flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all duration-300 hover:-translate-y-1 active:scale-95 overflow-hidden group ${tipoRemolque === 'ganadero' && tipoGanadero === 'ganso' ? 'bg-amber-50 border-amber-500 shadow-lg shadow-amber-500/40 -translate-y-1' : 'bg-white border-slate-200 hover:border-amber-300 hover:shadow-xl hover:shadow-amber-500/20'}`}>
                    <div className="h-12 w-full flex items-center justify-center mb-2 relative">
                        <Truck className={`w-8 h-8 absolute opacity-20 transition-opacity group-hover:opacity-40 ${tipoRemolque === 'ganadero' && tipoGanadero === 'ganso' ? 'text-amber-600' : 'text-slate-500'}`} />
                        <img src="/img_ganso.png" alt="Ganso" className="max-h-full max-w-full object-contain drop-shadow-md z-10 relative transition-transform duration-300 group-hover:scale-110" onError={(e) => e.target.style.display='none'} />
                    </div>
                    <span className={`font-black z-10 text-center text-[11px] leading-tight transition-colors duration-300 ${tipoRemolque === 'ganadero' && tipoGanadero === 'ganso' ? 'text-amber-800' : 'text-slate-600 group-hover:text-amber-700'}`}>Ganadero<br/>Ganso</span>
                </button>

                {/* 2. Ganadero Redondo (Visible siempre) */}
                <button onClick={() => { cambiarTipo('ganadero','redondo'); }} className={`relative flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all duration-300 hover:-translate-y-1 active:scale-95 overflow-hidden group ${tipoRemolque === 'ganadero' && tipoGanadero === 'redondo' ? 'bg-amber-50 border-amber-500 shadow-lg shadow-amber-500/40 -translate-y-1' : 'bg-white border-slate-200 hover:border-amber-300 hover:shadow-xl hover:shadow-amber-500/20'}`}>
                    <div className="h-12 w-full flex items-center justify-center mb-2 relative">
                        <Truck className={`w-8 h-8 absolute opacity-20 transition-opacity group-hover:opacity-40 ${tipoRemolque === 'ganadero' && tipoGanadero === 'redondo' ? 'text-amber-600' : 'text-slate-500'}`} />
                        <img src="/img_redondo.png" alt="Redondo" className="max-h-full max-w-full object-contain drop-shadow-md z-10 relative transition-transform duration-300 group-hover:scale-110" onError={(e) => e.target.style.display='none'} />
                    </div>
                    <span className={`font-black z-10 text-center text-[11px] leading-tight transition-colors duration-300 ${tipoRemolque === 'ganadero' && tipoGanadero === 'redondo' ? 'text-amber-800' : 'text-slate-600 group-hover:text-amber-700'}`}>Ganadero<br/>Redondo</span>
                </button>

                {/* EXCLUSIVOS DE MÉXICO */}
                {market === 'mexico' && (
                    <>
                        <button onClick={() => {cambiarTipo('cama_baja');}} className={`relative flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all duration-300 hover:-translate-y-1 active:scale-95 overflow-hidden group ${tipoRemolque === 'cama_baja' ? 'bg-indigo-50 border-indigo-500 shadow-lg shadow-indigo-500/40 -translate-y-1' : 'bg-white border-slate-200 hover:border-indigo-300 hover:shadow-xl hover:shadow-indigo-500/20'}`}>
                            <div className="h-12 w-full flex items-center justify-center mb-2 relative">
                                <Truck className={`w-8 h-8 absolute opacity-20 transition-opacity group-hover:opacity-40 ${tipoRemolque === 'cama_baja' ? 'text-indigo-600' : 'text-slate-500'}`} />
                                <img src="/img_camabaja.png" alt="Cama Baja" className="max-h-full max-w-full object-contain drop-shadow-md z-10 relative transition-transform duration-300 group-hover:scale-110" onError={(e) => e.target.style.display='none'} />
                            </div>
                            <span className={`font-black z-10 text-center text-[11px] leading-tight transition-colors duration-300 ${tipoRemolque === 'cama_baja' ? 'text-indigo-800' : 'text-slate-600 group-hover:text-indigo-700'}`}>Cama<br/>Baja</span>
                        </button>

                        <button onClick={() => cambiarTipo('cama_alta')} className={`relative flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all duration-300 hover:-translate-y-1 active:scale-95 overflow-hidden group ${tipoRemolque === 'cama_alta' ? 'bg-emerald-50 border-emerald-500 shadow-lg shadow-emerald-500/40 -translate-y-1' : 'bg-white border-slate-200 hover:border-emerald-300 hover:shadow-xl hover:shadow-emerald-500/20'}`}>
                            <div className="h-12 w-full flex items-center justify-center mb-2 relative">
                                <Truck className={`w-8 h-8 absolute opacity-20 transition-opacity group-hover:opacity-40 ${tipoRemolque === 'cama_alta' ? 'text-emerald-600' : 'text-slate-500'}`} />
                                <img src="/img_camaalta.png" alt="Cama Alta" className="max-h-full max-w-full object-contain drop-shadow-md z-10 relative transition-transform duration-300 group-hover:scale-110" onError={(e) => e.target.style.display='none'} />
                            </div>
                            <span className={`font-black z-10 text-center text-[11px] leading-tight transition-colors duration-300 ${tipoRemolque === 'cama_alta' ? 'text-emerald-800' : 'text-slate-600 group-hover:text-emerald-700'}`}>Cama<br/>Alta</span>
                        </button>

                        <button onClick={() => cambiarTipo('volteo')} className={`relative flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all duration-300 hover:-translate-y-1 active:scale-95 overflow-hidden group ${tipoRemolque === 'volteo' ? 'bg-red-50 border-red-500 shadow-lg shadow-red-500/40 -translate-y-1' : 'bg-white border-slate-200 hover:border-red-300 hover:shadow-xl hover:shadow-red-500/20'}`}>
                            <div className="h-12 w-full flex items-center justify-center mb-2 relative">
                                <Truck className={`w-8 h-8 absolute opacity-20 transition-opacity group-hover:opacity-40 ${tipoRemolque === 'volteo' ? 'text-red-600' : 'text-slate-500'}`} />
                                <img src="/img_volteo.png" alt="Volteo" className="max-h-full max-w-full object-contain drop-shadow-md z-10 relative transition-transform duration-300 group-hover:scale-110" onError={(e) => e.target.style.display='none'} />
                            </div>
                            <span className={`font-black z-10 text-center text-[11px] leading-tight transition-colors duration-300 ${tipoRemolque === 'volteo' ? 'text-red-800' : 'text-slate-600 group-hover:text-red-700'}`}>Remolque<br/>Volteo</span>
                        </button>
                    </>
                )}
            </div>

            {market==='mexico'&&<button className={`w-full p-4 rounded-xl border-2 font-black ${modeloEspecial?'bg-amber-50 border-amber-500':'bg-white border-slate-200 text-green-800'}`} onClick={()=>handleCotizarDesdeCatalogo(db.modelosLinea.find(m=>m.market==='mexico'&&esEspecial(m.tipoRemolque)))}>Remolques especiales</button>}
            {modeloUSA&&<section className="p-4 border border-green-200 bg-green-50 rounded-xl"><h3 className="font-black text-green-800">Modelo base: {modeloUSA.nombre}</h3><p className="text-sm text-slate-700">{modeloUSA.especificaciones}</p><p className="text-xs text-slate-500">Precio base MXN: {modeloUSA.precio} · {modeloUSA.origenUSA.hoja}, {modeloUSA.origenUSA.celda}</p>{precioUSA?.error&&<p className="text-sm text-amber-800 mt-2">{precioUSA.error}</p>}<details className="mt-2 text-xs"><summary className="cursor-pointer font-bold">Ver equipo incluido del Excel</summary>{equipoUSA(modeloUSA.id).map((x,i)=><p key={i}>{x.cantidad} × {x.descripcion}</p>)}</details></section>}
            {market==='usa'&&<><TipoCambio value={cambioDOF} onChange={setCambioDOF} fecha={fechaCotizacion}/></>}
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
                <div className="md:col-span-1"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Descuento (%)</label><div className="relative"><input type="number" min="0" max="100" value={cliente.descuentoPct || ''} onChange={e => setCliente({...cliente, descuentoPct: e.target.value===''?null:parseFloat(e.target.value)})} className="w-full p-2 border border-slate-300 rounded-md font-black text-red-600 text-center" placeholder="0" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">%</span></div></div>
                <div className="md:col-span-1"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Desc. Extra (%)</label><div className="relative"><input type="number" min="0" max="100" value={cliente.descuentoExtraPct || ''} onChange={e => setCliente({...cliente, descuentoExtraPct: e.target.value===''?null:parseFloat(e.target.value)})} className="w-full p-2 border border-slate-300 rounded-md font-black text-amber-500 text-center" placeholder="0" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">%</span></div></div>
                <div className="md:col-span-1"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Ajuste / Redondeo</label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">$</span><input type="number" value={cliente.ajusteRedondeo || ''} onChange={e => setCliente({...cliente, ajusteRedondeo: e.target.value===''?null:parseFloat(e.target.value)})} className="w-full p-2 pl-7 border border-slate-300 rounded-md font-black text-purple-700" placeholder="0" /></div></div>
                <div className="md:col-span-5 border-t border-slate-100 pt-3 mt-1"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Anticipo (MXN)</label><div className="relative max-w-[200px]"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">$</span><input type="number" value={cliente.anticipo || ''} onChange={e => setCliente({...cliente, anticipo: e.target.value===''?null:parseFloat(e.target.value)})} className="w-full p-2 pl-7 border border-slate-300 rounded-md font-black text-green-700 bg-green-50" placeholder="0" /></div></div>
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
             
            {modeloEspecial?<Especiales db={db} modelo={modeloEspecial} onModelo={handleCotizarDesdeCatalogo} value={carroceria.especial} onChange={value=>setCarroceria(c=>({...c,especial:value}))}/>:<>
            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
              <h2 className="text-lg font-black text-slate-800 flex items-center mb-4"><Disc className="w-5 h-5 mr-2 text-green-600"/> 1. Dimensiones y Acoplamiento</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Largo del Remolque</label><select value={dim.largo} onChange={e => {setDim({...dim,largo:e.target.value});if(isGanaderoRedondoMex)setCarroceria(c=>({...c,modoPuertas:'automatico',puertasIntList:e.target.value==='10ft'?[]:[{id:'central-base',tipo:'corrediza',distancia:0}]}));}} className="w-full p-2 border border-slate-300 rounded-md font-medium">{largosDisponibles.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                <div><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Ancho Exterior</label><select value={dim.ancho} onChange={e => setDim({...dim, ancho: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md font-medium">{anchosDisponibles.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select><p className="text-[11px] text-slate-500 mt-1">Medidas disponibles según las listas de México. Un ancho especial requiere alta de modelo y precio en el panel.</p></div>
              </div>
              {!!erroresConfiguracion.length&&<p role="alert" className="text-red-700 text-sm mb-3">{erroresConfiguracion.join(' ')}</p>}
              {market==='mexico' && <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
                <label className="font-bold text-slate-600 flex items-center gap-2"><input type="checkbox" checked={usarLargoCustom} onChange={e=>{setUsarLargoCustom(e.target.checked);if(!largoCustom)setLargoCustom(String(getObj(db.largos,dim.largo).valor));}} />Largo especial (estimación)</label>
                {usarLargoCustom && <label className="text-slate-600">Pies: <input aria-label="Largo especial en pies" type="number" min="1" step="0.01" value={largoCustom} onChange={e=>setLargoCustom(e.target.value)} className="w-24 border border-slate-300 rounded p-2 font-bold" /></label>}
                {!!precioMexico?.alternativas?.length && <label className="w-full text-slate-600">Variante de lista para estas medidas<select value={referenciaMexico} onChange={e=>setReferenciaMexico(e.target.value)} className="w-full border rounded p-2"><option value="">Selecciona la variante de referencia</option>{precioMexico.alternativas.map(z=><option key={z.id} value={z.id}>{z.nombre} · {formatoMoneda(z.precio)}</option>)}</select></label>}
              </div>}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-100">
                <div><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Tipo de Jalón</label><select value={acople.jalon} onChange={e => setAcople({...acople, jalon: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md font-bold">{jalonesDisponibles.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                <div><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Cadena de Seguridad</label><select value={acople.cadena} disabled={market === 'usa'} onChange={e => setAcople({...acople, cadena: e.target.value})} className={`w-full p-2 border border-slate-300 rounded-md font-bold ${market === 'usa' ? 'bg-slate-100 opacity-70' : ''}`}>{cadenasDisponibles.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                <div className="flex flex-col justify-end space-y-2 pb-1"><label className={`flex items-center space-x-2 font-medium text-sm text-slate-700 ${market === 'usa' ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}><input type="checkbox" checked={acople.sujetaCadenas} disabled={market === 'usa'} onChange={() => toggle(setAcople, 'sujetaCadenas')} className="w-4 h-4 text-green-600"/> <span>Incluir Sujeta Cadenas</span></label></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 pt-4 mt-4 border-t border-slate-100">
                <div className="sm:col-span-6">
  <label className="text-xs font-bold text-slate-500 uppercase block mb-1">
    Gato Elevación
  </label>

  <select
    value={acople.gato}
    onChange={(e) => {
      const nuevoGato = e.target.value;

      setAcople((prev) => ({
        ...prev,
        gato: nuevoGato,

        // Se activa automáticamente con gato hidráulico + kit y bomba
        cargador110:
          nuevoGato === 'hidraulico_sencillo'
            ? true
            : prev.cargador110
      }));
    }}
    className="w-full p-2 border border-slate-300 rounded-md"
  >
    {gatosDisponibles.map((o) => (
      <option key={o.id} value={o.id}>
        {o.nombre}
      </option>
    ))}
  </select>
</div>
                <div className="sm:col-span-2"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Cant.</label><div className="flex bg-slate-100 border border-slate-300 rounded h-[42px] items-center"><button onClick={() => handleCant(setAcople, 'cantGatos', -1, 1)} className="px-3 font-bold hover:bg-slate-200 h-full">-</button><span className="px-2 font-bold w-full text-center">{acople.cantGatos}</span><button onClick={() => handleCant(setAcople, 'cantGatos', 1)} className="px-3 font-bold hover:bg-slate-200 h-full">+</button></div></div>
                {acople.gato.includes('hidraulico') && (
                  <div className="sm:col-span-4 flex flex-col justify-center space-y-1">
                   <label className="flex items-center space-x-2 border rounded px-2 py-1 cursor-pointer">
  <input
    type="checkbox"
    checked={!!acople.cargadorSolar}
    onChange={(e) =>
      setAcople((prev) => ({
        ...prev,
        cargadorSolar: e.target.checked
      }))
    }
    className="w-3.5 h-3.5"
  />
  <span className="text-xs font-medium">+ Cargador Solar</span>
</label>

<label className="flex items-center space-x-2 border rounded px-2 py-1 cursor-pointer">
  <input
    type="checkbox"
    checked={!!acople.cargador110}
    onChange={(e) =>
      setAcople((prev) => ({
        ...prev,
        cargador110: e.target.checked
      }))
    }
    className="w-3.5 h-3.5"
  />
  <span className="text-xs font-medium">+ Cargador 110v</span>
</label>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
              <h2 className="text-lg font-black text-slate-800 flex items-center mb-4"><Zap className="w-5 h-5 mr-2 text-green-600"/> 2. Capacidad y Ejes</h2>
              <div className="p-4 bg-green-50 rounded-lg border border-green-200 mb-5">
                  <label className="text-xs font-bold text-green-800 uppercase block mb-2">Configuración de Ejes</label>
                  <select value={rodado.capacidad} onChange={e => actualizarEstadoReglas(aplicarPredeterminados({...qReglas,rodado:{...rodado,capacidad:e.target.value}},db))} className="w-full p-2 border border-green-300 rounded-md font-black text-green-900">
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
                <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded px-2 py-1"><span className="text-sm font-bold text-slate-700">Frenos Eléctricos:</span><button disabled={frenosObligatorios} onClick={() => handleCant(setRodado, 'cantFrenos', -1, frenosObligatorios ? cantEjes : 0, cantEjes)} className="px-2 font-bold hover:bg-slate-200 rounded text-lg">-</button><span className="font-black text-green-700 w-4 text-center">{rodado.cantFrenos}</span><button disabled={frenosObligatorios} onClick={() => handleCant(setRodado, 'cantFrenos', 1, frenosObligatorios ? cantEjes : 0, cantEjes)} className="px-2 font-bold hover:bg-slate-200 rounded text-lg">+</button><span className="text-xs font-medium text-slate-500 ml-1">/ {cantEjes} Ejes{frenosObligatorios?' · Obligatorio':''}</span></div>
                <label className="flex items-center gap-2 text-sm font-bold text-slate-700"><input type="checkbox" checked={acople.controlFreno||false} disabled={rodado.cantFrenos<=0} onChange={e=>setAcople({...acople,controlFreno:e.target.checked})}/> Control de freno</label>
                <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded px-2 py-1"><span className="text-sm font-bold text-slate-700">Llanta Extra:</span><button onClick={() => handleCant(setRodado, 'llantaExtra', -1)} className="px-2 font-bold hover:bg-slate-200 rounded">-</button><span className="font-black text-green-700 w-4 text-center">{rodado.llantaExtra}</span><button onClick={() => handleCant(setRodado, 'llantaExtra', 1)} className="px-2 font-bold hover:bg-slate-200 rounded">+</button></div>
                <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded px-2 py-1"><span className="text-sm font-medium text-slate-700">Porta Extra:</span><button onClick={() => handleCant(setRodado, 'portaExtra', -1, tipoRemolque==='cama_baja' && market==='mexico' ? rodado.llantaExtra : tipoRemolque !== 'ganadero' ? 1 : rodado.llantaExtra)} className="px-2 font-bold hover:bg-slate-200 rounded">-</button><span className="font-bold w-4 text-center">{rodado.portaExtra}</span><button onClick={() => handleCant(setRodado, 'portaExtra', 1)} className="px-2 font-bold hover:bg-slate-200 rounded">+</button></div>
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
                            <input type="number" min="1" max={Number(oLargo.valor)} value={carroceria.techoEspecialLargo || ''} onChange={e => { let max = Number(oLargo.valor); let val = parseInt(e.target.value)||''; setCarroceria({...carroceria, techoEspecialLargo: val > max ? max : val})}} className="w-full bg-transparent font-black text-amber-900 text-center outline-none" placeholder="Pies"/>
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

              <PuertasInteriores q={qReglas} db={db} onChange={setCarroceria}/>
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
                  {acabados.cajaHtas !== 'ninguna' && <select aria-label="Chapa de caja de herramientas" value={acabados.cajaChapa||'cromo'} onChange={e=>setAcabados({...acabados,cajaChapa:e.target.value})} className="w-full p-2 mt-1 border border-slate-300 rounded-md text-xs"><option value="cromo">Chapa cromo · $400</option><option value="negra">Chapa negra · $462.59</option></select>}
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
                           const l = Number(oLargo.valor) || 0;
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
                                            <span className="font-black text-green-700">{formatoMoneda(market==='usa'?convertirUSD(Number(ext.precio),cambioDOF,fechaCotizacion):Number(ext.precio))}</span>
                                            <button onClick={() => setExtrasCustom(extrasCustom.filter(e => e.id !== ext.id))} className="text-red-500 hover:bg-red-100 p-1.5 rounded transition"><Trash2 className="w-4 h-4"/></button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            </>}
          </div>

          {/* ====== COLUMNA DERECHA (TICKET) ====== */}
          <div className="w-full xl:w-1/3 print:w-full print:block">
            <div className="sticky top-24 max-h-[calc(100vh-6rem)] overflow-y-auto pb-8 pr-1 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full">
              
              {activeTab === 'cotizacion' && (
                <div id="ticket-cotizacion" className="bg-white p-6 rounded-xl shadow-xl border-t-8 border-slate-900 print:relative print:top-0 print:border-t-0 print:shadow-none print:w-full print:p-0 animar-entrada">

                  {market==='mexico' && !esHojaDiseno && <div className="print-only-screen print:hidden mb-4 text-xs border-b border-slate-200 pb-3">
                    <p className="font-black text-slate-700">{!precioMexico.ok?'PRECIO PENDIENTE':precioMexico.esEstimacion?'COTIZACIÓN ESTIMADA CON REFERENCIA A LISTAS':'BASE DE LISTA + ADICIONALES'}</p>
                    {!precioMexico.ok ? <p className="text-red-700">{precioMexico.error}</p> : <>
                      <p>Base por remolque: {formatoMoneda(precioMexico.base)} · IVA incluido</p>
                      <details className="mt-2 print:hidden"><summary className="cursor-pointer font-bold">Ver referencias y ajustes del cálculo</summary>
                        {precioMexico.referencias.map(z=><p key={z.id} className="mt-2">{z.nombre}: {formatoMoneda(z.precio)}</p>)}
                        {precioMexico.ajustes.map((z,i)=><p key={i} className="mt-1">{z.nombre}: {formatoMoneda(z.importe)} <span className="text-slate-500">({z.origen})</span></p>)}
                        {precioMexico.avisos.map((z,i)=><p key={i} className="mt-2 text-amber-800">{z}</p>)}
                      </details>
                    </>}
                  </div>}
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
                        {esHojaDiseno ? 'HOJA DE DISEÑO' : market==='mexico'&&precioMexico?.esEstimacion ? 'COTIZACIÓN ESTIMADA' : 'COTIZACIÓN'}
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

                  {modeloEspecial?<div className="p-4 border border-slate-200 rounded-lg mb-6 text-sm print:p-0 print:border-0">
                    <h3 className="font-black text-slate-800">{modeloEspecial.nombre}</h3>
                    <p className="mt-2">{modeloEspecial.especificaciones}</p>
                    {Number(carroceria.especial?.piesExtra)>0&&<p>Largo adicional: {carroceria.especial.piesExtra} pies sobre {modeloEspecial.medidas}.</p>}
                    {precioMexico?.ajustes?.map((x,i)=><p key={i} className="mt-1">{x.nombre}</p>)}
                  </div>:<>
                  {/* ====== ESPECIFICACIONES (NUEVO ORDEN) ====== */}
                  <div className="p-4 bg-white print:p-0 rounded-lg border border-slate-200 print:border-0 mb-6">
                    <h3 className="font-bold text-slate-800 mb-4 uppercase tracking-wider text-[10px] print:hidden">Especificaciones del Remolque</h3>
                    <ul className="space-y-3 text-slate-700 print:text-slate-900 text-xs">
                      <li><span className="font-black uppercase text-slate-500 print:text-slate-700 mr-2">Tipo y Tamaño:</span><br className="print:hidden"/> Remolque {tipoRemolque === 'ganadero' ? 'Ganadero' : tipoRemolque === 'cama_alta' ? 'Cama Alta' : tipoRemolque === 'volteo' ? 'Volteo' : 'Cama Baja'} AMACSA {oLargo.valor}' Largo x {anchoEstructural}" Ancho{anchoEstructural !== oAncho.valor ? ' (ancho estructural Torflex)' : ''}</li>
                      
                      <li><span className="font-black uppercase text-slate-500 print:text-slate-700 mr-2">Capacidad y Ejes:</span><br className="print:hidden"/> <span className="font-bold text-green-700 print:text-slate-900">{nombreCapacidadTicket}</span> — {oSusp.nombre} — Llantas {oLlantas.nombre} {rodado.cantFrenos > 0 ? `(${rodado.cantFrenos}x Ejes c/Frenos)` : ''}</li>
                      <li><span className="font-black uppercase text-slate-500 print:text-slate-700 mr-2">Tipo de Jalón:</span><br className="print:hidden"/> <span className="font-bold">{oJalon.nombre}</span> {market === 'usa' ? '(Ganso 3/8 x 35")' : (acople.cadena !== 'ninguna' ? `(${oCadena.nombre})` : '')} {acople.sujetaCadenas ? '+ Sujeta Cadenas' : ''}</li>
                      
                      {tipoRemolque !== 'cama_alta' && <li><span className="font-black uppercase text-slate-500 print:text-slate-700 mr-2">Redila:</span><br className="print:hidden"/> <span className="font-bold">{oRedila.nombre}</span></li>}
                      
                      <li><span className="font-black uppercase text-slate-500 print:text-slate-700 mr-2">Piso:</span><br className="print:hidden"/> <span className="font-bold">{oPiso.nombre}</span></li>
                      
                      <li><span className="font-black uppercase text-slate-500 print:text-slate-700 mr-2">Gato (Elevación):</span><br className="print:hidden"/> <span className="font-bold">{acople.cantGatos}x {oGato.nombre}</span> {acople.cargadorSolar ? '+ Cargador Solar' : ''} {acople.cargador110 ? '+ Cargador 110v' : ''}</li>
                      
                      {tipoRemolque === 'ganadero' && <li><span className="font-black uppercase text-slate-500 print:text-slate-700 mr-2">Puertas:</span><br className="print:hidden"/> <span className="font-bold">Interiores:</span> {estadoPuertas.puertas.length===0?'Ninguna':estadoPuertas.puertas.map((p,i)=>`${i+1}. ${getObj(db.puertasInteriores,p.tipo).nombre} a ${p.distancia} pulg., largo ${p.longitud} pulg.`).join(' | ')} &nbsp;|&nbsp; <span className="font-bold">Trasera:</span> {oPTras.nombre} {carroceria.puertaPiloto ? `| Piloto Lateral (${carroceria.puertaPilotoAncho}")` : ''}</li>}
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
                              <li key={ext.id}>Extra: <span className="font-bold">{ext.nombre}</span> {!esHojaDiseno && <span className="text-slate-400 text-[10px] ml-1">(+ {formatoMoneda(market==='usa'?convertirUSD(Number(ext.precio),cambioDOF,fechaCotizacion):Number(ext.precio))})</span>}</li>
                          ))}
                        </ul>
                      </li>

                      <li><span className="font-black uppercase text-slate-500 print:text-slate-700 mr-2">Color del Remolque:</span><br className="print:hidden"/> <span className="font-black uppercase">{db.colores?.find(c => c.id === acabados.color)?.nombre || 'Estándar'}</span></li>
                    </ul>
                  </div>

                  </>}
                  {modeloUSA&&<div className="my-4 p-3 border border-slate-200 text-xs"><b>Modelo base {modeloUSA.clienteUSA}: {modeloUSA.nombre}</b><p>{modeloUSA.especificaciones}</p>{precioUSA?.ajustes?.map((x,i)=><p key={i}>Cambio: {x.nombre} · {formatoMoneda(convertirUSD(x.importe,cambioDOF,fechaCotizacion))}</p>)}</div>}
                  {/* Observaciones impresas en Ticket */}
                  {cliente.observaciones && (
                      <div className="mt-4 p-4 bg-amber-50 print:bg-transparent print:border-2 print:border-slate-800 border border-amber-200 rounded-lg mb-6">
                          <h4 className="font-black text-amber-900 print:text-slate-800 text-xs uppercase tracking-wider mb-2">Notas y Observaciones Especiales:</h4>
                          <p className="text-sm font-medium text-amber-800 print:text-slate-900 whitespace-pre-wrap leading-relaxed">{cliente.observaciones}</p>
                      </div>
                  )}

                  {market==='usa'&&!esHojaDiseno&&<p className="text-xs text-slate-600 mt-4">Tipo de cambio: {cambioDOF?.valor||'Pendiente'} MXN/USD · Publicación DOF: {cambioDOF?.fechaPublicacion||'Pendiente'} · Cotización: {fechaCotizacion}</p>}
                  {/* Ocultar precios si es hoja de diseño */}
                  {!esHojaDiseno && (
                    <>
                      <div className="mt-6 pt-4 border-t-2 border-slate-800 bg-slate-900 print:bg-transparent print:border-slate-300 print:-mx-0 print:px-0 -mx-6 px-6 pb-6 rounded-b-xl text-white print:text-slate-900 print:shadow-none print:mt-2 print:pt-2">
                        {market==='mexico'&&precioMexico?.ok&&<div className="text-[11px] text-slate-300 print:text-slate-700 border-b border-slate-700 print:border-slate-300 pb-2 mb-2">
                          <div className="flex justify-between gap-2"><span>Precio base de catálogo × {cliente.cantidad||1}</span><span>{formatoMoneda(precioBasePuro)}</span></div>
                          {precioMexico.ajustes.map((z,i)=><div key={i} className="flex justify-between gap-2"><span>{z.nombre}{Number(cliente.cantidad)>1?` (por ${cliente.cantidad} remolques)`:''}</span><span>{formatoMoneda(z.importe*(cliente.cantidad||1))}</span></div>)}
                        </div>}
                        <div className="flex justify-between text-slate-300 print:text-slate-700 font-bold mb-1 text-[11px] print:mb-0"><span>{market==='mexico'?'Importe con IVA antes de descuentos':'Subtotal'}</span><span>{formatoMoneda(subtotalNeto)}</span></div>
                        {cliente.descuentoPct > 0 && ( <div className="flex justify-between text-red-400 print:text-red-700 font-bold mb-1 text-[11px] print:mb-0"><span>Descuento Comercial ({cliente.descuentoPct}%)</span><span>- {formatoMoneda(montoDescuento1)}</span></div> )}
{cliente.descuentoExtraPct > 0 && ( <div className="flex justify-between text-amber-500 print:text-amber-700 font-bold mb-1 text-[11px] print:mb-0"><span>Descuento Extra ({cliente.descuentoExtraPct}%)</span><span>- {formatoMoneda(montoDescuento2)}</span></div> )} {market !== 'usa' && ( <div className="flex justify-between text-slate-400 print:text-slate-600 font-bold mb-2 text-[11px] print:mb-0"><span>I.V.A. incluido (16%)</span><span>{formatoMoneda(subtotalIva)}</span></div> )}
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
