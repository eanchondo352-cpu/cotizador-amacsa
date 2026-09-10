import React from 'react';
import {FAMILIAS_ESPECIALES,extrasModelo} from './especiales-mexico';
const nombres={caja_seca:'Caja seca',forrajero:'Forrajero',piedras:'Para piedras',dolly:'Dolly',volteo_manual:'Volteo manual',cuatrimotos:'Cuatrimotos',vasculante:'Basculante',comida:'Puesto de comida',cabezal:'Cabezal de trilladora',caballos:'Para caballos'};
const campo='w-full p-2 border border-slate-300 rounded-md font-medium bg-white focus:ring-2 focus:ring-green-500';
export default function Especiales({db,modelo,onModelo,value={},onChange}){
 const lista=(db.modelosLinea||[]).filter(m=>m.market==='mexico'&&FAMILIAS_ESPECIALES.includes(m.tipoRemolque));
 const familia=lista.filter(m=>m.tipoRemolque===modelo?.tipoRemolque),extras=extrasModelo(db,modelo);
 const seleccionar=(key,v)=>{const candidatas=familia.filter(m=>String(m[key]||'')===v);const mejor=candidatas.find(m=>['ancho','largo','capacidad'].filter(k=>k!==key).every(k=>m[k]===modelo[k]))||candidatas[0];if(mejor)onModelo(mejor);};
 return <section className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 space-y-4">
  <h2 className="text-lg font-black text-slate-800">Remolques especiales</h2>
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
   <label className="text-xs font-bold text-slate-500">TIPO<select aria-label="Tipo de remolque especial" className={campo} value={modelo?.tipoRemolque||''} onChange={e=>onModelo(lista.find(m=>m.tipoRemolque===e.target.value))}>{FAMILIAS_ESPECIALES.filter(t=>lista.some(m=>m.tipoRemolque===t)).map(t=><option key={t} value={t}>{nombres[t]}</option>)}</select></label>
   {['ancho','largo','capacidad'].map(key=><label key={key} className="text-xs font-bold text-slate-500">{key.toUpperCase()}<select aria-label={'Especial '+key} className={campo} value={modelo?.[key]||''} onChange={e=>seleccionar(key,e.target.value)}>{[...new Set(familia.map(m=>m[key]||''))].map(v=><option key={v} value={v}>{v?String(v).replace('in',' pulgadas').replace('ft',' pies').replace('1_5t','1.5 ton').replace('850kg','850 kg'):'No especificado en catálogo'}</option>)}</select></label>)}
   <label className="text-xs font-bold text-slate-500 col-span-full">VARIANTE Y EQUIPO INCLUIDO<select aria-label="Modelo especial" className={campo} value={modelo?.id||''} onChange={e=>onModelo(lista.find(m=>m.id===e.target.value))}>{familia.filter(m=>m.ancho===modelo?.ancho&&m.largo===modelo?.largo&&m.capacidad===modelo?.capacidad).map(m=><option key={m.id} value={m.id}>{m.nombre}</option>)}</select></label>
  </div>
  <p className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-900">{modelo?.especificaciones}</p>
  <label className="block text-xs font-bold text-slate-500">PIES ADICIONALES DE LARGO<input aria-label="Pies adicionales especial" className={campo} type="number" min="0" step="0.5" value={value.piesExtra||0} onChange={e=>onChange({...value,piesExtra:e.target.value})}/></label>
  <p className="text-xs text-slate-500">El pie adicional se calcula con modelos del mismo ancho, capacidad y equipo. Si faltan comparables, captura la tarifa por pie en Modelos de Línea.</p><h3 className="font-black text-green-800">Extras y cambios</h3>
  <p className="text-xs text-slate-500">Cero conserva el equipo incluido. Los precios se administran en el Panel de Control; el importe se suma por cada unidad o cambio seleccionado.</p>
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{extras.map(x=><label key={x.id} className="text-sm font-bold text-slate-700">{x.nombre}<input aria-label={x.nombre} className={campo} type="number" min="0" step={x.unidad.includes('pie')?'0.5':'1'} value={value.extras?.[x.id]||0} onChange={e=>onChange({...value,extras:{...value.extras,[x.id]:e.target.value}})}/><span className="text-xs font-normal text-slate-500">{x.precio!==null&&x.precio!==undefined&&x.precio!==''?'$'+Number(x.precio).toLocaleString('es-MX')+' MXN por '+x.unidad:'Precio por capturar en Panel de Control'}</span></label>)}</div>
  {!extras.length&&<p className="text-sm text-slate-500">Esta ficha no incluye una lista de adicionales con precio.</p>}
 </section>;
}
