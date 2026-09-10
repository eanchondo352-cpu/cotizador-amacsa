import React,{useState} from 'react';
import referenciasUSA from './modelos-usa-excel.json';
export const FUENTE_DOF='https://dof.gob.mx/indicadores_detalle.php?cod_tipo_indicador=158';
export function fechaValida(s){return /^\d{4}-\d{2}-\d{2}$/.test(s||'')&&Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;}
export function enlaceDOF(fecha){
 const base='https://dof.gob.mx/indicadores_detalle.php?cod_tipo_indicador=158';
 if(!fechaValida(fecha))return base;
 const fin=new Date(fecha+'T12:00:00Z');fin.setUTCDate(fin.getUTCDate()-1);
 const inicio=new Date(fin);inicio.setUTCDate(inicio.getUTCDate()-30);
 const formato=d=>[String(d.getUTCDate()).padStart(2,'0'),String(d.getUTCMonth()+1).padStart(2,'0'),d.getUTCFullYear()].join('/');
 return base+'&dfecha='+encodeURIComponent(formato(inicio))+'&hfecha='+encodeURIComponent(formato(fin));
}
export function validarCambio(tc,fecha){
 if(!fechaValida(fecha))return 'Indica una fecha válida de cotización.';
 if(!tc||!Number.isFinite(Number(tc.valor))||Number(tc.valor)<=0)return 'Captura el tipo de cambio en MXN por USD.';
 if(!fechaValida(tc.fechaPublicacion)||tc.fechaPublicacion>=fecha)return 'La publicación del DOF debe ser anterior a la fecha de cotización.';
 if(!tc.confirmado||tc.fechaCotizacion!==fecha)return 'Confirma el último tipo de cambio publicado antes de esta cotización.';
 return '';
}
export function convertirUSD(mxn,tc,fecha){return validarCambio(tc,fecha)?NaN:Number(mxn)/Number(tc.valor);}
export default function TipoCambio({value,onChange,fecha}){
 const tc=value||{},error=validarCambio(tc,fecha);
 const campo='block mt-1 w-full p-2 border border-slate-300 rounded-md text-sm font-bold text-slate-800 bg-white focus:ring-2 focus:ring-green-500';
 const edit=(k,v)=>onChange({...tc,[k]:v,confirmado:false,fechaCotizacion:fecha,fuente:enlaceDOF(fecha),metodo:'captura-verificada'});
 return <section className="p-5 bg-white border border-slate-200 rounded-xl shadow-sm space-y-3 print:hidden">
 <h3 className="text-lg font-black text-green-800">Tipo de cambio · Cotización USA</h3>
 <p className="text-xs text-slate-600">Importes del tabulador y accesorios en MXN; cotización en USD. Usa la columna de publicación en el DOF, con fecha anterior a {fecha}. Anticipos y ajustes de redondeo se capturan en USD.</p>
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><label className="text-xs font-bold text-slate-500">MXN por 1 USD<input className={campo} type="number" min="0.0001" step="0.0001" value={tc.valor??''} onChange={e=>edit('valor',e.target.value)}/></label><label className="text-xs font-bold text-slate-500">Fecha de publicación en DOF<input className={campo} type="date" value={tc.fechaPublicacion||''} onChange={e=>edit('fechaPublicacion',e.target.value)}/></label></div>
 <a className="inline-block text-sm font-bold text-green-700 underline" href={enlaceDOF(fecha)} target="_blank" rel="noopener noreferrer">Consultar tipo de cambio en el DOF</a>
 <label className="flex gap-2 items-start text-sm text-slate-700"><input className="mt-1 accent-green-600" type="checkbox" checked={!!tc.confirmado&&tc.fechaCotizacion===fecha} onChange={e=>onChange({...tc,confirmado:e.target.checked,fechaCotizacion:fecha,fuente:enlaceDOF(fecha),metodo:'captura-verificada'})}/>Verifiqué que es el último publicado antes de la fecha de cotización.</label>
 {error?<p className="text-sm text-amber-700">{error}</p>:<p className="text-sm text-green-700">Esta referencia se guardará junto con la cotización.</p>}
 </section>;
}

export function ReferenciasUSA({tc,fecha,especial}){
 const [busqueda,setBusqueda]=useState('');
 const filas=referenciasUSA.filter(m=>m.perfil===(especial?'especial':'normal')&&m.descripcion.toLowerCase().includes(busqueda.toLowerCase()));
 return <details className="print:hidden bg-white p-4 border border-slate-200 rounded-xl"><summary className="cursor-pointer text-sm font-bold text-green-800">Referencias Excel USA · {especial?'Dean':'Wall y DH'}</summary><p className="text-xs text-slate-600 my-3">Consulta los totales y el equipo descrito en el Excel. Estas referencias no sustituyen automáticamente la configuración seleccionada ni sus cargos.</p><input className="w-full p-2 border border-slate-300 rounded-md text-sm" aria-label="Buscar referencia USA" placeholder="Buscar medidas o características" value={busqueda} onChange={e=>setBusqueda(e.target.value)}/><div className="max-h-80 overflow-auto mt-3 space-y-3">{filas.map(m=>{const usd=convertirUSD(m.totalMXN,tc,fecha);return <article key={m.id} className="p-3 rounded-lg border border-slate-200 text-xs"><b>{m.cliente} · {m.descripcion}</b><p className="mt-2">Total Excel: {m.totalMXN.toFixed(2)} MXN · Equivalente: {Number.isFinite(usd)?usd.toFixed(2)+' USD':'captura el tipo de cambio'}</p><p className="text-slate-500">{m.hoja} · {m.celdaTotal}</p></article>})}</div></details>;
}
