// Activar USA requiere cambiar esta bandera explícitamente.
export const USA_HABILITADO = false;
export function esRegistroUSA(item) {
 const q=item?.config||item||{};
 return q.market==='usa'||q.moneda==='USD'||item?.market==='usa'||!!q.seleccionUSA||!!q.esModeloUSAExcel||!!q.clienteUSA||/^usa_/.test(item?.id||'')||/_usa$/.test(item?.id||'')||/\bUSA\b/.test(item?.nombre||'');
}
export const registroVisible = item => USA_HABILITADO || !esRegistroUSA(item);
