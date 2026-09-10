import datos from './catalogo-usa.json';
const pisoHule=id=>['hule_liso','hule_anti','usa_5e565638df49'].includes(id);
const pisoNormal=id=>id==='usa_5e565638df49'?'hule_anti':id;
export const equipoUSA=id=>datos.modelos.find(m=>m.id===id)?.equipoExcel||[];
export function modeloCompactoUSA(m){const {equipoExcel,...rest}=m;rest.piso=pisoNormal(rest.piso);return JSON.parse(JSON.stringify(rest));}
export function integrarUSA(db){
 let changed=false;
 for(const [sec,items] of Object.entries(datos.opciones)){
  db[sec]||=[];for(const item of items)if(!db[sec].some(x=>x.id===item.id)){db[sec].push({...item});changed=true;}
 }
 for(const m of datos.modelos)for(const [sec,id,valor,unit] of [['anchos',m.ancho,Number(m.ancho.replace('in','')),'Pulgadas'],['largos',m.largo,Number(m.largo.replace('ft','')),'Pies']]){
  db[sec]||=[];if(!db[sec].some(x=>x.id===id)){db[sec].push({id,nombre:valor+' '+unit,valor,precio:null});changed=true;}
 }
 db.modelosLinea||=[];
 if(!db._catalogoUSAExcel1){for(const m of datos.modelos)if(!db.modelosLinea.some(x=>x.id===m.id))db.modelosLinea.push(modeloCompactoUSA(m));db._catalogoUSAExcel1=true;changed=true;}
 for(const m of db.modelosLinea){if(m.esModeloUSAExcel&&m.piso==='usa_5e565638df49'){m.piso='hule_anti';m.pisosIncluidosUSA=['hule_liso','hule_anti'];changed=true;}}
 const antiguos=(db.pisos||[]).filter(x=>x.id==='usa_5e565638df49');
 if(antiguos.length){db.pisosUSAArchivados=[...(db.pisosUSAArchivados||[]),...antiguos];db.pisos=db.pisos.filter(x=>x.id!=='usa_5e565638df49');changed=true;}
 return changed;
}
export function configurarUSA(m,q){
 const n=JSON.parse(JSON.stringify(q));n.market='usa';n.isSpecialClient=!!m.isSpecialClient;
 n.tipoRemolque=m.tipoRemolque.startsWith('ganadero_')?'ganadero':m.tipoRemolque;n.tipoGanadero=m.tipoRemolque==='ganadero_redondo'?'redondo':'ganso';
 n.dim={ancho:m.ancho,largo:m.largo};
 for(const k of ['capacidad','suspension','llanta','cantFrenos','llantaExtra','portaExtra'])n.rodado[k]=m[k];
 n.rodado.cantEjesGanso=m.cantEjes;
 for(const k of ['jalon','gato','cadena','cantGatos'])n.acople[k]=m[k];
 n.acople.cargadorSolar=false;n.acople.cargador110=false;
 for(const k of ['redila','techo','frente','puertaTras','plexiglass','rackPacas'])n.carroceria[k]=m[k];
 n.carroceria.puertasIntList=Array.from({length:Number(m.puertasIncluidas)||0},(_,i)=>({id:'usa'+i,tipo:'fija',distancia:0}));n.carroceria.modoPuertas='automatico';
 for(const k of ['piso','pintura','luces','color'])n.acabados[k]=m[k];n.acabados.piso=pisoNormal(n.acabados.piso);n.acabados.tipoBody='ninguno';n.acabados.bodyLitros=0;
 n.monturero.tipo=m.monturero;n.usarLargoCustom=false;n.largoCustom='';
 return n;
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b)||([undefined,null,false,0,''].includes(a)&&[undefined,null,false,0,''].includes(b));
export function evaluarUSA(db,m,q,base,extras=[]){
 if(!m||!base)return {ok:false,error:'Vuelve a cargar el modelo USA desde el catálogo.'};
 if(q.isSpecialClient!==!!m.isSpecialClient)return {ok:false,error:'Selecciona un modelo correspondiente al perfil de cliente.'};
 const ajustes=[],pendientes=[];
 const notas=[];
 const tarifa=(sec,id,key='precio')=>{const o=db[sec]?.find(x=>x.id===id);const p=o?.[key+'_ganadero_ganso']??o?.[key];return p!==null&&p!==undefined&&p!==''&&Number.isFinite(Number(p))&&Number(p)>=0?Number(p):null;};
 const add=(label,amount)=>{if(amount===null)pendientes.push(label);else ajustes.push({nombre:label,importe:amount});};
 const handled=new Set();
 const mappings=[['rodado','capacidad','capacidades'],['rodado','suspension','suspension'],['rodado','llanta','llantas'],['acople','jalon','jalones'],['acople','gato','gatos'],['acople','cadena','cadenas'],['carroceria','techo','techos'],['carroceria','redila','redilas'],['carroceria','puertaTras','puertasTraseras'],['acabados','pintura','pinturas'],['acabados','luces','luces'],['monturero','tipo','montureros']];
 for(const [group,key,sec] of mappings){handled.add(group+'.'+key);if(!same(q[group][key],base[group][key]))add('Cambio de '+sec,tarifa(sec,q[group][key]));}
 handled.add('acabados.color'); // Color de acabado no modifica el precio por sí mismo.
 for(const [group,key,sec,id,pricekey] of [['rodado','llantaExtra','llantas',q.rodado.llanta,'precioExtra'],['acople','cantGatos','gatos',q.acople.gato,'precioExtra']]){
  handled.add(group+'.'+key);const d=Number(q[group][key])-Number(base[group][key]);if(d){const p=tarifa(sec,id,pricekey);add('Cantidad adicional de '+sec,d<0||p===null?null:d*p);}
 }

 // Posiciones y modo de distribución no alteran por sí solos el equipo comprado.
 handled.add('carroceria.modoPuertas');
 const puertas=q.carroceria.puertasIntList||[],anteriores=base.carroceria.puertasIntList||[];
 handled.add('carroceria.puertasIntList');
 for(let i=0;i<Math.max(puertas.length,anteriores.length);i++){
  const actual=puertas[i],anterior=anteriores[i];
  if(!actual){pendientes.push('Retiro de puerta interior');continue;}
  if(!anterior||actual.tipo!==anterior.tipo)add('Puerta interior '+(i+1),tarifa('puertasInteriores',actual.tipo));
 }
 const unitarios=[
 ['rodado','portaExtra','portaExtra'],['rodado','cantFrenos','frenos'],
 ['acople','controlFreno','controlFreno'],['acople','sujetaCadenas','sujetaCadenas'],['acople','cargadorSolar','cargadorSolar'],['acople','cargador110','cargador110'],
 ['carroceria','puertaPiloto','puertaPiloto'],['carroceria','rackPacas','rackPacas'],['carroceria','ventEst','ventEst'],['carroceria','ventCirc','ventCirc'],['carroceria','polverasEspeciales','polverasEspeciales'],['carroceria','puertaPerroCachucha','puertaPerroCachucha'],['carroceria','aperturaEstribo','aperturaEstribo'],['carroceria','aperturaLimpieza','aperturaLimpieza'],
 ['monturero','basesMontura','basesMontura'],['monturero','tubosCobija','tubosCobija'],['monturero','puertaPerro','puertaPerroLateral'],
 ['accesorios','lucesInteriores','lucesInteriores'],['accesorios','ovaloRojo','luzOvalo'],['accesorios','ovaloAmbar','luzOvaloAmbar'],['accesorios','tresCuartosRojo','luzTresCuartosRoja'],['accesorios','tresCuartosAmbar','luzTresCuartosAmbar'],['accesorios','dosPulgadasRojo','luzDosPulgadasRoja'],['accesorios','dosPulgadasAmbar','luzDosPulgadasAmbar'],['accesorios','luzPortaplaca','luzPortaplaca'],
 ['acabados','pinturaLitros','litroPintura'],['acabados','techoLitros','litroPintura'],['acabados','bodyLitros','litroBody']];
 for(const [group,key,id] of unitarios){
  handled.add(group+'.'+key);const delta=Number(q[group]?.[key]||0)-Number(base[group]?.[key]||0);
  if(delta){const p=tarifa('extras',id);add(db.extras?.find(x=>x.id===id)?.nombre||id,delta<0||p===null?null:delta*p);}
 }
 handled.add('acabados.piso');
 if(q.acabados.piso!==base.acabados.piso&&!(pisoHule(q.acabados.piso)&&pisoHule(base.acabados.piso))){const p=tarifa('pisos',q.acabados.piso,'precioSqFt');const area=Number(q.dim.ancho.replace('in',''))/12*Number(q.dim.largo.replace('ft',''));add('Cambio de piso',p===null||!Number.isFinite(area)?null:p*area);}
 handled.add('acabados.cajaHtas');
 if(!same(q.acabados.cajaHtas,base.acabados.cajaHtas))add('Caja de herramientas',tarifa('extras',{std:'cajaHtasStd',grande:'cajaHtasGrande',especial:'cajaHtasEspecial'}[q.acabados.cajaHtas]));
 for(const group of ['dim','rodado','acople','carroceria','acabados','monturero','camaBajaOpts','volteoOpts','accesorios'])for(const key of new Set([...Object.keys(base[group]||{}),...Object.keys(q[group]||{})])){
  if(handled.has(group+'.'+key))continue;
  const a=q[group]?.[key],b=base[group]?.[key];
  if(group==='carroceria'&&key==='puertasIntList'){
   if(!same((a||[]).map(x=>({tipo:x.tipo,distancia:x.distancia,desfase:x.desfase||0})),(b||[]).map(x=>({tipo:x.tipo,distancia:x.distancia,desfase:x.desfase||0}))))pendientes.push('Cambio de puertas interiores');
  }else if(!same(a,b))pendientes.push(group+'.'+key);
 }
 if(q.usarLargoCustom||q.tipoRemolque!==base.tipoRemolque||q.tipoGanadero!==base.tipoGanadero)pendientes.push('Medidas o tipo de remolque');
 for(const e of extras){const p=Number(e.precio);add(e.nombre,e.precio===''||!Number.isFinite(p)||p<0?null:p);}
 const price=Number(m.precio);if(m.precio===null||m.precio===''||!Number.isFinite(price)||price<=0)pendientes.push('Precio base');
 return {ok:!pendientes.length,base:price,extras:ajustes.reduce((s,x)=>s+x.importe,0),ajustes,error:pendientes.length?'Falta tarifa para: '+[...new Set(pendientes)].join(', '):'',modelo:m.id};
}
