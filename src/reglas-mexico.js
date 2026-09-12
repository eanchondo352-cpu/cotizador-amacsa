// Reglas México: independientes de clientes, modelos y precios USA.
export function corregirFrenteRedondo(db){
 if(db._frenteRedondo2026v3)return false;
 for(const m of db.modelosLinea||[]){if(!m.esReferenciaListaMexico||m.tipoRemolque!=='ganadero_redondo')continue;
  m.cadena='seguridad_14';if(['1_5t','3t'].includes(m.capacidad))m.gato='normal_2k';else if(m.capacidad==='6t')m.gato='manual_7k';
  m.puertasIncluidas=Number(String(m.largo).replace('ft',''))===10?0:1;m.puertaCentralTipo='corrediza';m.puertaTras='corrediza';m.portaIncluidosPrecio=0;
 }
 const porta=db.extras?.find(x=>x.id==='portaExtra');if(porta&&!numeroPrecio(porta.precio_ganadero_redondo)&&numeroPrecio(porta.precio))porta.precio_ganadero_redondo=Number(porta.precio);
 db._frenteRedondo2026v2=true;db._frenteRedondo2026v3=true;return true;
}
export function esTorflex(q,db){const id=q.rodado?.suspension;return id==='torflex'||/^torflex/i.test(String(id||''))||/TORFLEX|TOFLEX|TORLEX/i.test(db.suspension?.find(x=>x.id===id)?.nombre||'');}
export function corregirFrenosCatalogo(db){let cambio=false;for(const m of db.modelosLinea||[]){if(m.market==='usa'||m.esModeloUSAExcel)continue;if(esTorflex({rodado:{suspension:m.suspension}},db)&&Number(m.cantEjes)>0&&Number(m.cantFrenos)!==Number(m.cantEjes)){m.cantFrenos=Number(m.cantEjes);cambio=true;}}return cambio;}
// Reglas confirmadas con diseño. Medidas internas: pulgadas; largo comercial: pies.
export const redondear = n => Math.round((n + Number.EPSILON) * 100) / 100;
export const numeroPrecio = n => n !== '' && n !== null && n !== undefined && Number.isFinite(Number(n));
export const tiposMexico = ['cama_baja','cama_alta','volteo','ganadero_redondo','ganadero_ganso_mex','caja_seca'];
export const capacidadTon = id => ({'850kg':.85,'1_5t':1.5,'2t_5200':2,'2t_6200':2,'3t':3,'4t':4,'4t_5200':4,'4t_6000':4,'4t_6200':4,'6t':6,'7t':7,'9t':9,'10t':10}[id]);
export function largoPies(q,db) { return q.usarLargoCustom ? Number(q.largoCustom) : Number(db.largos?.find(x=>x.id===q.dim.largo)?.valor); }
export function limitesLargo(q) {
 const w=Number(q.dim.ancho.replace('in','')), t=capacidadTon(q.rodado.capacidad);
 if(q.tipoRemolque==='cama_baja')return {min:w===50?7:10,max:w===50?8:t===1.5?14:[60,72].includes(w)?16:20};
 if(q.tipoRemolque==='volteo')return {min:w===50?7.5:10,max:w===50?7.5:16};
 if(q.tipoRemolque==='cama_alta')return {min:16,max:42};
 if(q.tipoGanadero==='redondo')return {min:10,max:t===1.5?12:t===3?16:18};
 return {min:16,max:null}; // Ganadero ganso México: largos desde 16 pies en adelante.
}
export function opcionesReglas(q,db) {
 const tipo=q.tipoRemolque,red=q.tipoGanadero==='redondo',cap=q.rodado.capacidad,w=q.dim.ancho;
 const all=s=>(db[s]||[]).map(x=>x.id);
 // Solo anchos respaldados por las listas/fotos de México.
 let anchos=tipo==='cama_baja'?['50in','60in','72in','76in','82in']:
  tipo==='cama_alta'?['96in']:
  tipo==='volteo'?['60in','69in','76in','82in']:
  red?['60in']:
  ['76in'];
 let capacidades;
 if(tipo==='cama_baja') capacidades=w==='50in'?['850kg']:['3t','6t',...(w==='76in'?['4t_5200','4t_6000']:[]),...(!['82in'].includes(w)&&largoPies(q,db)<=14?['1_5t']:[])];
 else if(tipo==='cama_alta')capacidades=['6t','9t','10t'];
 else if(tipo==='volteo')capacidades=w==='50in'?['850kg']:['60in','69in','76in'].includes(w)&&largoPies(q,db)<=14?['1_5t','3t','6t']:['3t','6t'];
 else if(red)capacidades=['1_5t','3t','6t'];
 else capacidades=['6t','9t'];
 let gatos=tipo==='cama_alta'?['manual_12k','hidraulico_sencillo']:tipo==='volteo'?(cap==='850kg'?['tubo_2k']:['manual_12k','manual_7k']):tipo==='cama_baja'?(cap==='850kg'?['tubo_2k']:cap==='1_5t'?['normal_2k']:cap==='3t'?['normal_2k','manual_7k']:cap==='6t'?['manual_7k','manual_12k']:['manual_7k']):red?(cap==='1_5t'?['normal_2k']:cap==='3t'?['normal_2k','manual_7k']:['manual_7k','normal_2k','manual_12k']):['manual_12k','hidraulico_sencillo'];
 // La suspensión se selecciona por sistema; el eje Torflex específico se
 // determina automáticamente por capacidad (9t = 3x8,000; 10t = 2x10,000).
 // No se muestran los ejes individuales como opciones separadas.
 const suspension=['muelle','torflex','muelle_drop'];
let llantas=cap==='850kg'
 ? ['r13','ninguna']
 : ['1_5t','3t'].includes(cap)
 ? ['700_15','225_75_15','235_80_16','ninguna']
 : cap.startsWith('4t')
 ? ['225_75_15','235_80_16','ninguna']
 : ['235_80_16','235_80_16_14','17_5in','ninguna'];
 if(q.rodado.suspension==='torflex'||tipo==='cama_alta'&&cap==='10t')llantas.push('17_5in');
 const jalones=tipo==='cama_alta'?['ganso_normal','ganso_facil','argolla']:tipo==='ganadero'&&!red?['ganso_normal','ganso_facil']:tipo==='volteo'?all('jalones'):all('jalones').filter(id=>!id.includes('ganso'));
 const cadenas=tipo==='ganadero'&&!red?['ganso_38']:red?['seguridad_14']:['seguridad_14','ganso_38'];
 const redilas=tipo==='cama_alta'?['sin_redila']:tipo==='cama_baja'?['sin_redila',...['ptr_abierta','cerrada'].flatMap(s=>[2,3,4,5,6].map(n=>s+'_'+n))]:tipo==='ganadero'?['ptr_abierta','cerrada',...(red?['desmontable']:[])]:['ptr_abierta'];
 const pisos=tipo==='volteo'?['lamina_madera','lamina_3_16']:tipo==='cama_alta'?['madera','lamina_madera']:tipo==='cama_baja'?['madera','duela_laminada','lamina_madera']:['madera','hule_liso','hule_anti'];
 const rampas=tipo==='cama_alta'?['recto_rampas','cola_4','cola_5']:tipo==='cama_baja'?['ninguna','puerta_rampa',...(w==='82in'?[q.carroceria.redila==='sin_redila'?'rampa_1_5m':'rampa_39']:[])]:['ninguna'];
 const lim=limitesLargo(q);
 const largos=(db.largos||[]).filter(x=>x.valor>=lim.min&&(!lim.max||x.valor<=lim.max)).sort((a,b)=>Number(a.valor)-Number(b.valor)).map(x=>x.id);
 anchos=[...anchos].sort((a,b)=>Number(String(a).replace('in',''))-Number(String(b).replace('in','')));
 return {anchos,capacidades,gatos,suspension,llantas,jalones,cadenas,redilas,pisos,rampas,largos,montureros:all('montureros')};
}
export function ejesReglas(q) {
 const cap=q.rodado.capacidad, t=q.tipoRemolque;
 let cantidad=2,libras=7000;
 if(cap==='850kg'){cantidad=1;libras=2000;}
 else if(cap==='1_5t'){cantidad=1;libras=3500;}
 else if(cap==='3t'){cantidad=t==='ganadero'&&q.tipoGanadero==='ganso'&&q.rodado.cantEjesGanso===1?1:2;libras=cantidad===1?7000:3500;}
 else if(cap.includes('5200')||cap==='4t'){libras=5200;cantidad=cap.startsWith('2t')?1:2;}
 else if(cap.includes('6000'))libras=6000;
 else if(cap.includes('6200')){libras=6200;cantidad=cap.startsWith('2t')?1:2;}
 else if(cap==='7t')libras=8000;
 else if(cap==='9t'){cantidad=3;libras=8000;}
 else if(cap==='10t'){cantidad=Number(q.rodado.cantEjesGanso)>=3?3:2;libras=q.rodado.cantEjesGanso===3?8000:10000;}
 return {cantidad,libras,llantasPorEje:t==='cama_alta'&&cap==='10t'&&cantidad===2?4:2};
}
export function puertasReglas(q,db) {
 const ancho=Number(db.anchos?.find(x=>x.id===q.dim.ancho)?.valor)||0;
 const largo=largoPies(q,db)*12;
 const m=q.monturero||{}, inicio=m.tipo==='recto_3'?36:m.tipo==='recto_4'?48:m.tipo==='diagonal'?Math.max(Number(m.paredLarga)||0,Number(m.paredCorta)||0):0;
 const util=Math.max(0,largo-inicio),max=ancho>0?Math.max(0,Math.floor((util+1e-7)/ancho)-1):0;
 const list=q.carroceria.puertasIntList||[], automatico=q.carroceria.modoPuertas!=='manual';
 const puertas=list.map((p,i)=>({...p,distancia:automatico?redondear(inicio+util*(i+1)/(list.length+1)):Number(p.distancia)}));
 const errores=[];
 if(list.length>max)errores.push(`Máximo ${max} puertas interiores para el largo útil y ancho seleccionados.`);
 let prev=inicio;
 for(const [i,p] of puertas.entries()){
  const d=p.distancia,delta=p.tipo==='diagonal'?Number(p.desfase||0):0;
  const longitud=p.tipo==='diagonal'?Math.hypot(ancho,delta):ancho;
  p.longitud=redondear(longitud);
  const anterior=puertas[i-1];
  const separacionMin=(p.tipo==='diagonal'||anterior?.tipo==='diagonal')?40:ancho;
  if(!Number.isFinite(d)||d<=prev||d>=largo)errores.push(`Puerta ${i+1}: posición fuera de orden o del área de carga.`);
  else if(d-prev<separacionMin-.02)errores.push(`Puerta ${i+1}: separación mínima ${(separacionMin/12).toFixed(2)} pies (${separacionMin} pulgadas).`);
  const siguiente=i+1<puertas.length?puertas[i+1].distancia:largo;
  if(siguiente-d<longitud-.02 || (p.tipo==='diagonal'&&i===puertas.length-1&&siguiente-d<=longitud+.02))errores.push(`Puerta ${i+1}: requiere ${p.longitud} pulgadas libres hacia la parte trasera para abrir.`);
  if(p.tipo==='diagonal'&&(!Number.isFinite(delta)||delta<0))errores.push(`Puerta ${i+1}: revise el desplazamiento de la diagonal.`);
  prev=d;
 }
 return {ancho,largo,inicio,util,max,puertas,errores:[...new Set(errores)],consulta:puertas.some(p=>p.tipo==='diagonal')?'Puertas diagonales: longitud geométrica calculada; confirmar bisagras, holguras y apertura con diseño.':''};
}
export function normalizarReglas(q,db) {
 const n=JSON.parse(JSON.stringify(q));
 if(!['cama_baja','cama_alta','ganadero','volteo'].includes(n.tipoRemolque))return n;
 const r=n.rodado,a=n.acople,c=n.carroceria,f=n.acabados;
 // Unificar nombres históricos que representaban el mismo gato.
 if(a.gato==='manual')a.gato='manual_12k';
 if(a.gato==='hidraulico_bomba')a.gato='hidraulico_sencillo';
 const gatoGuardado=db.gatos?.find(x=>x.id===a.gato);
 const nombreGato=String(gatoGuardado?.nombre||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
 if(/^12k mecanico\b/.test(nombreGato)||/^12k hidraulico(?:\s+c\/bomba)?\b/.test(nombreGato))a.gato=nombreGato.includes('hidraulico')?'hidraulico_sencillo':'manual_12k';
 if(/^7k mecanico\b/.test(nombreGato))a.gato='manual_7k';
 // Compatibilidad con cotizaciones guardadas cuando antes se elegía el eje
 // Torflex individualmente desde el selector.
 if(/^torflex_/i.test(String(r.suspension||''))||r.suspension==='eje_10000_46')r.suspension='torflex';
 if(n.market==='mexico'&&!['estandar_mexico','especial_mexico'].includes(f.luces))f.luces='estandar_mexico';
 if(r.capacidad==='4t'&&n.tipoRemolque==='cama_baja')r.capacidad='4t_5200';
 let o=opcionesReglas(n,db);
 if(!o.anchos.includes(n.dim.ancho))n.dim.ancho=o.anchos[0];
 o=opcionesReglas(n,db);
 if(!o.capacidades.includes(r.capacidad))r.capacidad=o.capacidades[0];
 o=opcionesReglas(n,db);
 if(!n.usarLargoCustom&&!o.largos.includes(n.dim.largo))n.dim.largo=o.largos[0]||n.dim.largo;
 const pairs=[['jalones',a,'jalon'],['gatos',a,'gato'],['cadenas',a,'cadena'],['suspension',r,'suspension'],['llantas',r,'llanta'],['redilas',c,'redila'],['pisos',f,'piso'],['rampas',n.camaBajaOpts,'rampas'],['montureros',n.monturero,'tipo']];
 for(const [key,obj,field] of pairs)if(!o[key].includes(obj[field]))obj[field]=o[key][0];
 r.portaExtra=Math.max(1,Number(r.portaExtra)||0, n.tipoRemolque!=='ganadero'?Number(r.llantaExtra)||0:0);
 a.cantGatos=Math.max(1,Math.min(n.tipoRemolque==='volteo'&&!a.jalon.includes('ganso')?1:2,Number(a.cantGatos)||1));
 a.cadena=n.tipoRemolque==='ganadero'&&n.tipoGanadero==='redondo'?'seguridad_14':n.tipoRemolque==='ganadero'&&n.tipoGanadero==='ganso'?'ganso_38':n.tipoRemolque==='cama_alta'||capacidadTon(r.capacidad)>=6?'ganso_38':'seguridad_14';
 const e=ejesReglas(n),frenoObligatorio=esTorflex(n,db)||['4t_5200','4t_6000','4t_6200'].includes(r.capacidad);r.cantFrenos=frenoObligatorio?e.cantidad:Math.min(e.cantidad,Math.max(0,Number(r.cantFrenos)||0));
 if(n.tipoRemolque==='ganadero'){
  const frentes=n.tipoGanadero==='redondo'?['ninguno','cuadrado']:['cachucha','canasta'];
  if(!frentes.includes(c.frente))c.frente=frentes[0];
 }else c.frente='ninguno';
 if(n.tipoRemolque==='volteo'){
  if(!f.cajaHtas||f.cajaHtas==='ninguna')f.cajaHtas='std';
  if(n.volteoOpts.puertaTrasera==='sencilla')n.volteoOpts.puertaTrasera='libro';
 }
 if(a.gato?.includes('hidraulico')&&(n.tipoRemolque==='cama_alta')&&f.cajaHtas==='ninguna')f.cajaHtas='std';
 if(!a.gato?.includes('hidraulico')){a.cargadorSolar=false;a.cargador110=false;}
 c.polverasEspeciales=false;
 const L=largoPies(n,db);f.bodyLitros=f.tipoBody&&f.tipoBody!=='ninguno'?(L<=16?10:L<=22?12:L<=26?14:L<=28?15:16)+(f.tipoBody==='full'?3:0):0;
 if(n.tipoRemolque==='ganadero'&&c.modoPuertas!=='manual')c.puertasIntList=puertasReglas(n,db).puertas;
 if(esTorflex(n,db))r.cantFrenos=ejesReglas(n).cantidad;
 return n;
}
export function validarReglas(q,db) {
 if(!['cama_baja','cama_alta','ganadero','volteo'].includes(q.tipoRemolque))return q.modeloEspecial||q.referenciaMexico?[]:['Selecciona el modelo especial del catálogo.'];
 const ejes=ejesReglas(q),frenoObligatorio=esTorflex(q,db)||['4t_5200','4t_6000','4t_6200'].includes(q.rodado.capacidad);
 if(frenoObligatorio&&Number(q.rodado.cantFrenos)!==ejes.cantidad)return ['Todos los ejes Torflex, 5,200 y 6,000 lbs deben llevar freno.'];
 if(q.acople?.controlFreno&&Number(q.rodado.cantFrenos)<=0)return ['El control de freno requiere por lo menos un eje con freno.'];
 const errors=[],op=opcionesReglas(q,db),l=largoPies(q,db),lim=limitesLargo(q);
 if(!op.anchos.includes(q.dim.ancho))errors.push('Ancho no autorizado para esta configuración de ejes.');
 if(!op.capacidades.includes(q.rodado.capacidad))errors.push('Capacidad no permitida para estas medidas.');
 if(!Number.isFinite(l)||l<lim.min||(lim.max&&l>lim.max))errors.push(`Largo permitido: desde ${lim.min}${lim.max?' hasta '+lim.max:''} pies.`);
 for(const [s,obj,k] of [['gatos',q.acople,'gato'],['jalones',q.acople,'jalon'],['cadenas',q.acople,'cadena'],['llantas',q.rodado,'llanta'],['suspension',q.rodado,'suspension'],['pisos',q.acabados,'piso'],['rampas',q.camaBajaOpts,'rampas']]){
  const legado=s==='suspension'&&(/^(susp_|torflex_)/.test(String(obj[k]||''))||obj[k]==='eje_10000_46');
  if(!legado&&!op[s].includes(obj[k]))errors.push(`Revisa ${s}: opción incompatible.`);
 }
 if(q.tipoRemolque==='ganadero')errors.push(...puertasReglas(q,db).errores);
 if(q.tipoGanadero==='ganso'){
  const hid=String(q.acople?.gato||'').includes('hidraulico');
  if(hid&&q.acabados?.cargador110===false)errors.push('El cargador de 110 V es obligatorio con gato hidráulico con kit y bomba.');
  if(hid&&q.carroceria?.frente==='canasta'&&q.acabados?.cajaHtas==='ninguna')errors.push('La canasta con gato hidráulico requiere caja de herramienta.');
  if(q.carroceria?.techo&&q.carroceria.techo!=='sin_techo'&&q.carroceria?.frente!=='canasta'&&q.carroceria?.techo!=='lona')errors.push('Al seleccionar techo debe incluir cachucha, salvo lona o techo abierto.');
  if(q.carroceria?.ventilacion==='estandar'&&(!q.carroceria?.techo||q.carroceria.techo==='sin_techo'))errors.push('La ventilación estándar solo está disponible con techo.');
 }
 if (q.tipoGanadero === 'ganso') {
  const gato = String(q.acople?.gato || '');
  const esHidraulicoKit = gato === 'hidraulico_sencillo';

  if (
  esHidraulicoKit &&
  q.acabados?.cargador110 !== true &&
  q.acople?.cargador110 !== true
) {
  errors.push(
    'El cargador de 110 V es obligatorio con gato hidráulico con kit y bomba.'
  );
}

  if (
   esHidraulicoKit &&
   q.carroceria?.frente === 'canasta' &&
   q.acabados?.cajaHtas === 'ninguna'
  ) {
   errors.push(
    'La canasta con gato hidráulico requiere una caja de herramienta.'
   );
  }

  const techo = q.carroceria?.techo;
  const frente = q.carroceria?.frente;

  if (
   techo &&
   techo !== 'sin_techo' &&
   techo !== 'lona' &&
   frente !== 'cachucha'
  ) {
   errors.push(
    'Al seleccionar techo debe incluir cachucha, salvo lona o techo abierto.'
   );
  }

  const ventilacion = q.carroceria?.ventilacion;

  if (
   ventilacion === 'estandar' &&
   (!techo || techo === 'sin_techo')
  ) {
   errors.push(
    'La ventilación estándar solo está disponible cuando hay techo.'
   );
  }

  if (
   q.carroceria?.puertaPerro === true &&
   ventilacion !== 'circular'
  ) {
   errors.push(
    'La puerta para perro requiere ventilación circular.'
   );
  }
 }
 return errors;
}
const firmaAnterior = z => [z.tipo,z.w,z.capacidadId||z.capacidad,z.variante||'',z.redila,z.piso,z.rampas||'',z.jalon,z.gato,z.suspension,z.llanta,z.cantFrenos,z.cantEjes,z.techo];
export const firmaGrupo = z => JSON.stringify([...firmaAnterior(z),z.cadena,z.cantGatos,z.configuracionEjes,z.puertasIncluidas,z.puertaCentralTipo,z.puertaTras,z.frente,z.monturero,z.pintura,z.luces,z.llantaExtra,z.portaIncluidosPrecio,z.sistemaElevacion,z.alturaMetros]);
export function gruposPrecios(filas) {
 const grupos=new Map();
 for(const z of filas){const key=firmaGrupo(z);if(!grupos.has(key))grupos.set(key,[]);grupos.get(key).push(z);}
 return [...grupos].map(([id,lista])=>{
  lista.sort((a,b)=>a.l-b.l);
  const duplicados=lista.some((z,i)=>i&&lista[i-1].l===z.l);
  const puntos=lista.filter(z=>numeroPrecio(z.precio)&&Number(z.precio)>0&&Number.isFinite(z.l)&&z.l>0);
  const base=puntos[0],fin=puntos.at(-1);
  const creciente=puntos.every((z,i)=>!i||Number(z.precio)>=Number(puntos[i-1].precio));
  // Promedio ponderado de incrementos por pie: suma de diferencias / suma de pies.
  const propuesta=!duplicados&&creciente&&base&&fin&&fin.l>base.l?redondear((Number(fin.precio)-Number(base.precio))/(fin.l-base.l)):null;
  return {id,idAnterior:JSON.stringify(firmaAnterior(lista[0])),lista,base,fin,propuesta,duplicados,nombre:lista[0].nombre};
 });
}
export function tarifaGrupo(g,tarifas=[],grupos=[g]) {
 const actual=tarifas.find(t=>t.id===g.id);if(actual)return actual;
 // Una tarifa anterior solo se reutiliza si su grupo no se dividió por diferencias de equipo.
 return grupos.filter(x=>x.idAnterior===g.idAnterior).length===1?tarifas.find(t=>t.id===g.idAnterior):undefined;
}
export function precioPorLargo(filas,largo,referencia,tarifas=[]) {
 if(!Number.isFinite(largo)||largo<=0)throw new Error('Captura un largo válido.');
 const grupos=gruposPrecios(filas),seleccion=filas.find(z=>z.id===referencia);
 const grupoSeleccion=seleccion?grupos.find(g=>g.lista.some(z=>z.id===referencia)):null;
 const exactas=(grupoSeleccion?grupoSeleccion.lista:filas).filter(z=>z.l===largo);
 if(exactas.length){const z=exactas.find(z=>z.id===referencia)||(exactas.length===1?exactas[0]:null);if(!z)throw new Error('Seleccione la variante exacta de lista.');if(!numeroPrecio(z.precio)||Number(z.precio)<=0)throw new Error('Precio de modelo pendiente en Modelos de Línea.');return {base:Number(z.precio),referencias:[z],estimado:false,avisos:[]};}
 const g=grupoSeleccion||(grupos.length===1?grupos[0]:null);
 if(!g)throw new Error('Seleccione una referencia del mismo tipo, ancho, capacidad y equipo.');
 if(g.duplicados)throw new Error('Hay variantes con el mismo largo: complete el equipo que las diferencia antes de calcular una tarifa por pie.');
 const config=tarifaGrupo(g,tarifas,grupos);
 let tarifa=config?(numeroPrecio(config.precio)?Number(config.precio):null):g.propuesta;
 let puntos=g.lista.filter(z=>numeroPrecio(z.precio)&&Number(z.precio)>0&&Number.isFinite(z.l)&&z.l>0).sort((a,b)=>a.l-b.l);
 let base=g.lista.filter(z=>z.l<largo&&numeroPrecio(z.precio)&&Number(z.precio)>0).at(-1);
 // Cama baja y otros modelos con un solo largo de lista: el pie extra se
 // estima como precio total ÷ pies de lista + 15 %. Nunca se permite cotizar
 // por debajo de ese largo mínimo.
 const largosUnicos=[...new Set(puntos.map(z=>z.l))];
 if((tarifa===null||tarifa<0)&&largosUnicos.length===1&&puntos[0]){
  base=puntos[0];tarifa=redondear((Number(base.precio)/base.l)*1.15);
 }
 if(!base)throw new Error('No hay un modelo inferior comparable. Capture el precio de esta medida en el catálogo.');
 if(tarifa===null||tarifa<0)throw new Error('Falta precio por pie: se necesitan dos largos del mismo ancho, capacidad y equipo, o una tarifa manual.');
 return {base:redondear(Number(base.precio)+(largo-base.l)*tarifa),referencias:[...new Map([base,...(!config?g.lista:[])].map(z=>[z.id,z])).values()],estimado:true,avisos:[`Base ${base.l} pies + ${redondear(largo-base.l)} pies × $${tarifa.toFixed(2)} MXN. Mismo ancho, capacidad y equipo.${config?' Tarifa manual.':' Promedio automático ponderado.'}`],grupo:g.id,tarifa};
}
export function actualizarCatalogoReglas(data) {
 let cambioUnificacion=false;
 // Quitar duplicados históricos del panel: cada variante se cotiza con un
 // único registro canónico para evitar precios y nombres distintos.
 if(Array.isArray(data.gatos)){
  const idsAntes=data.gatos.map(x=>x.id).join('|');
  data.gatos=data.gatos.filter(x=>{
   const nombre=String(x.nombre||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
   const duplicado=['manual','hidraulico_bomba'].includes(x.id)||
    /^12k mecanico\b/.test(nombre)||/^7k mecanico\b/.test(nombre)||
    /^12k hidraulico(?:\s+c\/bomba)?\b/.test(nombre);
   return !duplicado;
  });
  const canon=data.gatos.find(x=>x.id==='manual_7k');if(canon)canon.nombre='Gato mecánico 7,000 lbs';
  const canon12=data.gatos.find(x=>x.id==='manual_12k');if(canon12)canon12.nombre='Gato mecánico/manual 12,000 lbs (ganadero)';
  const hid=data.gatos.find(x=>x.id==='hidraulico_sencillo');if(hid)hid.nombre='Gato hidráulico con kit y bomba';
  cambioUnificacion=idsAntes!==data.gatos.map(x=>x.id).join('|');
 }
 // Sincronizar precios aun cuando la migración principal ya se ejecutó.
 if(data._reglasDiseno2026v2===1){
  for(const [id,precio] of [['torflex_7000',14662.38],['torflex_8000',22233],['torflex_10000',35000],['eje_10000_46',52189.60]]){
   const eje=data.suspension?.find(x=>x.id===id);if(eje){eje.precio=precio;for(const tipo of tiposMexico)eje['precio_'+tipo]=precio;}
  }
  return cambioUnificacion;
 }
 const add=(s,item)=>{data[s]||=[];if(!data[s].some(x=>x.id===item.id))data[s].push(item);};
 add('capacidades',{id:'4t_6000',nombre:'4 Ton (2 Ejes de 6,000 lbs)',precio:null});
 add('suspension',{id:'susp_5t',nombre:'Kit para 2 ejes de 6,000 lb (comercial 4 t)',precio:null});
 add('suspension',{id:'torflex_7000',nombre:'Eje Torflex 7,000 lbs · 78.5"',precio:14662.38});
 add('suspension',{id:'torflex_8000',nombre:'Eje Torflex 8,000 lbs · 78.5" sencillo',precio:22233});
 add('suspension',{id:'torflex_10000',nombre:'Eje Torflex 10,000 lbs · 78.5" sencillo',precio:35000});
 add('suspension',{id:'eje_10000_46',nombre:'Eje 10,000 lbs · 46" doble rodado',precio:52189.60});
 add('llantas',{id:'r13',nombre:'R13 (850 kg)',precio:null,precioExtra:null});
 add('pisos',{id:'lamina_3_16',nombre:'Lámina 3/16 sin madera',precioSqFt:null});
 for(const s of ['ptr_abierta','cerrada'])for(const n of [5,6])add('redilas',{id:s+'_'+n,nombre:`${s==='cerrada'?'Cerrada':'Abierta'} ${n} pies (especial)`,precio:null});
 for(const [id,nombre] of [['gatoExtra','Gato adicional'],['bateria','Batería para equipo hidráulico'],['cantidadEjes','Cambio de configuración de ejes'],['frenosTorflex','Frenos incluidos con Torflex']])add('extras',{id,nombre,precio:null});
 for(let n=7;n<=44;n++)add('largos',{id:n+'ft',nombre:n+' Pies',valor:n,precio:0});
 for(const section of ['extras','capacidades','llantas','gatos','rampas','largos'])data[section]=(data[section]||[]).filter((x,i,arr)=>arr.findIndex(y=>y.id===x.id)===i);
 const setTipo=(seccion,id,tipo,valor)=>{const x=data[seccion]?.find(z=>z.id===id);if(x)x['precio_'+tipo]=valor;};
 for(const x of data.suspension.filter(z=>/^torflex_/.test(z.id)||z.id==='eje_10000_46'))for(const tipo of tiposMexico)x['precio_'+tipo]=Number(x.precio);
 for(const tipo of tiposMexico){
  setTipo('gatos','hidraulico_sencillo',tipo,14950);setTipo('extras','lona',tipo,7000);setTipo('extras','pinturaPolvoKg',tipo,418);
  setTipo('extras','cajaChapaCromo',tipo,400);setTipo('extras','cajaChapaNegra',tipo,462.59);setTipo('extras','luzBarraRoja',tipo,214);
  setTipo('extras','luzOvalo',tipo,105.19);setTipo('extras','luzTresCuartosRoja',tipo,25);setTipo('cadenas','seguridad_14',tipo,78.6);setTipo('jalones','bumper_2',tipo,600);
 }
 setTipo('extras','puertaPiloto','cama_baja',1500);
 for(const m of data.modelosLinea||[]){if(m.market==='mexico'&&!esTorflex({rodado:{suspension:m.suspension}},data)&&!['4t_5200','4t_6000','4t_6200'].includes(m.capacidad))m.cantFrenos=0;}
 const precios=['capacidades','suspension','llantas','redilas','pisos','puertasInteriores','puertasTraseras','techos','jalones','gatos','cadenas','montureros','pinturas','luces','rampas','extras'];
 // Conservar General/USA y tarifas específicas capturadas. México sin lista ni valor específico: vacío.
 for(const s of precios)for(const item of data[s]||[]){
  const fields=s==='pisos'?['precioSqFt']:['precio',...(['gatos','jalones','llantas','rampas'].includes(s)?['precioExtra']:[])];
  for(const tipo of tiposMexico)for(const campo of fields){const key=campo+'_'+tipo;if(item[key]===undefined)item[key]=null;}
 }
 for(const [id,key] of [['manual_7k','precio_cama_baja'],['manual_7k','precio_volteo'],['manual_12k','precio_volteo']]){
  const it=data.gatos.find(x=>x.id===id),source=key.replace('precio_','precioExtra_');
  if(it&&it[key]===null&&numeroPrecio(it[source])){it[key]=it[source];it.origenesMexico={...it.origenesMexico,[key]:it.origenesMexico?.[source]||{precio:it[source]}};}
 }
 for(const m of data.modelosLinea||[]){
  if(!m.esReferenciaListaMexico)continue;
  const t=m.tipoRemolque,c=m.capacidad;
  m.portaExtra=Math.max(1,Number(m.portaExtra)||0);
  if(m.puertasIncluidas===undefined&&!t.startsWith('ganadero'))m.puertasIncluidas=0;
  if(m.cantEjes===undefined)m.cantEjes=capacidadTon(c)<=2?1:c==='9t'?3:2;
  if(['cama_baja','volteo','ganadero_redondo'].includes(t)&&['bumper_2_516','bumper_ajustable_2_516'].includes(m.jalon))m.jalon='bumper_2';
  if(c==='850kg')m.llanta='r13';
  if(t==='cama_baja'&&m.especificaciones?.includes('Sin redila')&&m.redila==='ptr_abierta_2')m.redila='sin_redila';
  if(t==='volteo')m.cantGatos=1;
  if(t==='ganadero_redondo')m.gato=['1_5t','3t'].includes(c)?'normal_2k':'manual_7k';
  if(t.startsWith('ganadero')){
   if(m.puertasIncluidas===undefined)m.puertasIncluidas=1;
   if(m.frente===undefined)m.frente=t==='ganadero_ganso'?'cachucha':'ninguno';
   if(m.puertaTras===undefined)m.puertaTras='corrediza';
  }
  if(m.capacidad==='4t')m.capacidad='4t_5200';
 }
 data.tarifasLargo||=[];
 data._reglasDiseno2026=1;data._reglasDiseno2026v2=1;return true;
}
export function aplicarPredeterminados(q,db) {
 const n=JSON.parse(JSON.stringify(q)),t=n.tipoRemolque,cap=n.rodado.capacidad;
 n.acople.gato=t==='cama_alta'?'manual_12k':t==='volteo'?(cap==='850kg'?'tubo_2k':'manual_12k'):t==='cama_baja'?(cap==='850kg'?'tubo_2k':cap==='1_5t'||cap==='3t'?'normal_2k':'manual_7k'):n.tipoGanadero==='ganso'?'manual_12k':['1_5t','3t'].includes(cap)?'normal_2k':'manual_7k';
 n.acople.cantGatos=1;
 n.rodado.llanta=cap==='850kg'?'r13':['1_5t','3t'].includes(cap)?'700_15':cap.startsWith('4t')?'225_75_15':t==='cama_alta'&&cap==='10t'?'17_5in':'235_80_16';
 if (q.tipoGanadero === 'ganso') {
  if (q.carroceria.frente === undefined) {
   q.carroceria.frente = 'canasta';
  }

  if (q.carroceria.cachucha === undefined) {
   q.carroceria.cachucha = false;
  }

  if (q.carroceria.ventilacion === undefined) {
   q.carroceria.ventilacion = 'ninguna';
  }

  if (q.acople.gato === 'hidraulico_sencillo') {
  q.acople.cargador110 = true;
  q.acabados.cargador110 = true;
}
 }
 if(q.tipoGanadero==='ganso'){
  if(q.carroceria.frente===undefined)q.carroceria.frente='canasta';
  if(q.carroceria.cachucha===undefined)q.carroceria.cachucha=false;
  if(q.carroceria.ventilacion===undefined)q.carroceria.ventilacion='ninguna';
  if(q.acople.gato==='hidraulico_sencillo')q.acabados.cargador110=true;
 }
 n.rodado.suspension=t==='ganadero'||t==='cama_alta'?'muelle':opcionesReglas(n,db).suspension[0];
 n.rodado.cantFrenos=(esTorflex(n,db)||['4t_5200','4t_6000','4t_6200'].includes(cap))?ejesReglas(n).cantidad:0;
 return normalizarReglas(n,db);
}