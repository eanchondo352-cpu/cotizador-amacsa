import {gruposPrecios,precioPorLargo} from './reglas-mexico';
import precios from './accesorios-mexico.json';
export const DESTINOS_EXTRA = {
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

export const FAMILIAS_ESPECIALES = ['caja_seca','forrajero','piedras','dolly','volteo_manual','cuatrimotos','vasculante','comida','cabezal','caballos'];
export const esEspecial = tipo => FAMILIAS_ESPECIALES.includes(tipo);
const precioValido=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
const redondeo=x=>Math.round((x+Number.EPSILON)*100)/100;
export function conectarExtrasFotos(db){
 if(db._extrasFotosEspeciales1)return false;
 for(const modelo of db.modelosLinea||[]){
  if(modelo.market!=='mexico'||!modelo.esReferenciaListaMexico)continue;
  const tipo=modelo.tipoRemolque==='ganadero_ganso'?'ganadero_ganso_mex':modelo.tipoRemolque;
  for(const ref of modelo.adicionales||[]){
   const p=precios.find(x=>x.id===ref.itemId),d=p&&DESTINOS_EXTRA[p.id.split('-').at(-1)];if(!d)continue;
   const [seccion,id,campo,nombre]=d;db[seccion]||=[];let item=db[seccion].find(x=>x.id===id);
   if(!item){item={id,nombre,precio:null};db[seccion].push(item);}
   const key=campo+'_'+tipo;
   if(!precioValido(item[key]))item[key]=p.precio;
   item.origenesMexico={...item.origenesMexico,[key]:{id:p.id,precio:p.precio,precioLista:p.origen.precioLista,ajustePct:p.origen.ajustePct,fechaLista:p.origen.fechaLista}};
  }
  if(esEspecial(tipo))modelo.soloCatalogo=false;
 }
 db._extrasFotosEspeciales1=true;return true;
}
export function extrasModelo(db,modelo){
 return (modelo?.adicionales||[]).map(ref=>{
  const p=precios.find(x=>x.id===ref.itemId),destino=p&&DESTINOS_EXTRA[p.id.split('-').at(-1)];if(!p||!destino)return null;
  const [seccion,id,campo]=destino,tarifaCampo=campo+'_'+modelo.tipoRemolque;
  return {id:p.id,nombre:p.nombre,unidad:p.unidad,seccion,itemId:id,campo:tarifaCampo,precio:db[seccion]?.find(x=>x.id===id)?.[tarifaCampo]};
 }).filter(Boolean);
}
export function cotizarEspecial(db,q){
 try{
  const m=db.modelosLinea?.find(x=>x.id===q.referenciaMexico&&x.market==='mexico'&&x.tipoRemolque===q.tipoRemolque);
  if(!m||!esEspecial(m.tipoRemolque))throw Error('Selecciona un modelo de Remolques especiales.');
  if(!precioValido(m.precio)||Number(m.precio)<=0)throw Error('Falta el precio base del modelo en Modelos de Línea.');
  if(q.dim.ancho!==m.ancho||q.dim.largo!==m.largo||q.rodado.capacidad!==m.capacidad)throw Error('Las medidas y capacidad deben corresponder al modelo seleccionado.');
  const seleccion=q.carroceria.especial||{},ajustes=[],avisos=[];
  const extraPies=Number(seleccion.piesExtra||0);
  if(!Number.isFinite(extraPies)||extraPies<0)throw Error('Revisa los pies adicionales de largo.');
  let estimado=false;
  if(extraPies){
   const filas=(db.modelosLinea||[]).filter(x=>x.market==='mexico'&&x.tipoRemolque===m.tipoRemolque&&x.ancho===m.ancho&&x.capacidad===m.capacidad).map(x=>({...x,tipo:x.tipoRemolque,w:x.ancho,capacidadId:x.capacidad,l:x.largo?.endsWith('in')?Number(x.largo.replace('in',''))/12:Number(x.largo?.replace('ft',''))}));
   const actual=filas.find(x=>x.id===m.id),grupos=gruposPrecios(filas),grupo=grupos.find(g=>g.lista.some(x=>x.id===m.id));
   const manual=precioValido(m.precioPieExtraEspecial)?[{id:grupo.id,precio:Number(m.precioPieExtraEspecial),validada:true}]:db.tarifasLargo||[];
   const precio=precioPorLargo(filas,actual.l+extraPies,m.id,manual);
   ajustes.push({nombre:'Largo adicional: '+extraPies+' pies',importe:redondeo(precio.base-Number(m.precio)),origen:precio.estimado?'Cálculo por pie con equipo equivalente':'Precio exacto del catálogo'});
   avisos.push(...precio.avisos);estimado=precio.estimado;
  }
  const disponibles=extrasModelo(db,m),map=new Map(disponibles.map(x=>[x.id,x]));
  for(const [id,n] of Object.entries(seleccion.extras||{})){
   const cantidad=Number(n);if(!Number.isFinite(cantidad)||cantidad<0)throw Error('Revisa la cantidad de accesorios.');if(!cantidad)continue;
   const x=map.get(id);if(!x)throw Error('Hay un accesorio que no corresponde a este modelo. Vuelve a seleccionarlo.');
   if(!['pie lineal','pie adicional'].includes(x.unidad)&&!Number.isInteger(cantidad))throw Error('La cantidad de '+x.nombre+' debe ser entera.');
   if(id.endsWith('-FRENOS')&&cantidad>Math.max(0,Number(m.cantEjes||1)-Number(m.cantFrenos||0)))throw Error('Los frenos adicionales exceden los ejes sin freno del modelo.');
   if(!precioValido(x.precio))throw Error('Falta precio de '+x.nombre+': Panel de Control → '+x.seccion+' → '+m.tipoRemolque.replaceAll('_',' ')+'.');
   if(Number(x.precio)<0)throw Error('Revisa el precio negativo de '+x.nombre+'.');
   ajustes.push({nombre:x.nombre+' × '+cantidad,importe:redondeo(cantidad*Number(x.precio)),origen:'Panel de Control · '+m.tipoRemolque.replaceAll('_',' ')});
  }
  return {ok:true,base:Number(m.precio),extras:redondeo(ajustes.reduce((s,x)=>s+x.importe,0)),ajustes,avisos,referencias:[m],esEstimacion:estimado};
 }catch(e){return {ok:false,error:e.message};}
}
