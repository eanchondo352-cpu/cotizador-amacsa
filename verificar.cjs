const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'src/App.jsx'),'utf8');
const rules=fs.readFileSync(path.join(__dirname,'src/reglas-mexico.js'),'utf8').replace(/export /g,'');
const usa=fs.readFileSync(path.join(__dirname,'src/catalogo-usa.js'),'utf8').replace(/import datos from .*?;/,'const datos='+fs.readFileSync(path.join(__dirname,'src/catalogo-usa.json'),'utf8')+';').replace(/export /g,'');
const mercados=fs.readFileSync(path.join(__dirname,'src/mercados.js'),'utf8').replace(/export /g,'');
const cat='const ACCESORIOS_MEXICO='+fs.readFileSync(path.join(__dirname,'src/accesorios-mexico.json'),'utf8')+';const CATALOGO_MEXICO='+fs.readFileSync(path.join(__dirname,'src/catalogo-mexico.json'),'utf8')+';';
const especiales=fs.readFileSync(path.join(__dirname,'src/especiales-mexico.js'),'utf8').replace(/import precios from .*?;/,'const precios='+fs.readFileSync(path.join(__dirname,'src/accesorios-mexico.json'),'utf8')+';').replace(/import \{gruposPrecios,precioPorLargo\} from .*?;/,'').replace(/export /g,'');
const E=vm.runInNewContext(especiales+'\n'+mercados+'\n'+cat+'\n'+usa+'\n'+rules+'\n'+source.slice(source.indexOf('// === MOTOR MEXICO'),source.indexOf('// --- 1. CONFIGURACIÓN DE LA NUBE'))+'\n'+source.slice(source.indexOf('  const CAMA_BAJA_COMBOS'),source.indexOf('const DEFAULT_USERS'))+';({conectarExtrasFotos,extrasModelo,cotizarEspecial,auditarCatalogoMexico,corregirFrenteRedondo,DEFAULT_DB,mxEvaluar,mxConfiguracionModelo,mxFilasModelos,mxCamaBajaInicial,normalizarReglas,validarReglas,opcionesReglas,actualizarCatalogoReglas,precioPorLargo,gruposPrecios,puertasReglas,ejesReglas,aplicarPredeterminados});');
const db=E.DEFAULT_DB,clone=x=>JSON.parse(JSON.stringify(x));
let count=0;const test=(name,f)=>{try{f();count++;console.log('OK '+name);}catch(e){console.error('FALLÓ '+name,e.message);process.exitCode=1;}};
const base=()=>({...E.mxCamaBajaInicial(),market:'mexico'});
const config=(codigo,cap='3t',txt='Redila fija')=>{const m=db.modelosLinea.find(z=>z.codigoLista===codigo&&z.capacidad===cap&&z.nombre.includes(txt));assert.ok(m,codigo);return E.normalizarReglas({...E.mxConfiguracionModelo(m),market:'mexico'},db);};
const calc=(q,d=db)=>{const r=E.mxEvaluar(d,q);assert.equal(r.ok,true,r.error);return r;};
test('Cama baja del usuario: precio exacto y porta incluido',()=>{const r=calc(base());assert.equal(r.base,49874.45);assert.equal(r.extras,0);});
test('Cambio abierta/cerrada reversible, sin duplicar cargo',()=>{const q=base();q.carroceria.redila='cerrada_2';assert.equal(calc(q).base+calc(q).extras,53200.20);q.carroceria.redila='ptr_abierta_2';assert.equal(calc(q).base,49874.45);});
test('Refacción de lista + porta adicional',()=>{const q=base();q.rodado.llantaExtra=1;assert.equal(calc(q).extras,2200);q.rodado.portaExtra=2;assert.equal(calc(q).extras,3000);});
test('Cargo por cambio se suma sin restar equipo incluido',()=>{const d=clone(db);d.jalones.find(z=>z.id==='bumper_ajustable_2').precio_cama_baja=1500;d.jalones.find(z=>z.id==='bumper_2').precio_cama_baja=1000;const q=base();q.acople.jalon='bumper_ajustable_2';assert.equal(calc(q,d).extras,1500);});
test('Precio vacío bloquea aunque General tenga valor',()=>{const q=base();q.acople.jalon='bumper_ajustable_2';assert.equal(E.mxEvaluar(db,q).ok,false);const d=clone(db);d.jalones.find(z=>z.id===q.acople.jalon).precio_cama_baja='';assert.equal(E.mxEvaluar(d,q).ok,false);});
test('Un cero capturado explícitamente es válido',()=>{const q=base(),d=clone(db);q.acople.jalon='bumper_ajustable_2';d.jalones.find(z=>z.id===q.acople.jalon).precio_cama_baja=0;assert.equal(calc(q,d).extras,0);});
test('No estima cambiando ancho o capacidad',()=>{const q=base();q.dim.ancho='84in';assert.equal(E.mxEvaluar(db,q).ok,false);q.dim.ancho='76in';q.rodado.capacidad='4t_6000';assert.equal(E.mxEvaluar(db,q).ok,false);});
test('Anchos México limitados a medidas de las fotos por familia',()=>{
 const q=base();
 const iguales=(a,b)=>assert.equal(JSON.stringify(a),JSON.stringify(b));
 iguales(E.opcionesReglas(q,db).anchos,['50in','60in','72in','76in','82in']);
 q.tipoRemolque='volteo';iguales(E.opcionesReglas(q,db).anchos,['60in','69in','76in','82in']);
 q.tipoRemolque='cama_alta';iguales(E.opcionesReglas(q,db).anchos,['96in']);
 q.tipoRemolque='ganadero';q.tipoGanadero='redondo';iguales(E.opcionesReglas(q,db).anchos,['60in']);
 q.tipoGanadero='ganso';iguales(E.opcionesReglas(q,db).anchos,['76in']);
});
test('Las dos variantes 4t conservan distintas capacidades de eje',()=>{const q=base();q.dim.ancho='76in';q.rodado.capacidad='4t_5200';assert.equal(E.ejesReglas(q).libras,5200);q.rodado.capacidad='4t_6000';assert.equal(E.ejesReglas(q).libras,6000);assert.ok(E.opcionesReglas(q,db).capacidades.includes('4t_5200'));assert.ok(E.opcionesReglas(q,db).capacidades.includes('4t_6000'));});
test('850kg: eje 2000 y llanta R13',()=>{const q=base();q.dim={ancho:'50in',largo:'90in'};q.rodado.capacidad='850kg';const n=E.normalizarReglas(q,db);assert.equal(E.ejesReglas(n).libras,2000);assert.equal(n.rodado.llanta,'r13');});
test('Cama baja 75 y 76 hasta20; 60 1.5t hasta14',()=>{const q=base();q.dim={ancho:'75in',largo:'20ft'};assert.ok(E.opcionesReglas(q,db).largos.includes('20ft'));q.dim={ancho:'60in',largo:'15ft'};assert.ok(!E.opcionesReglas(q,db).capacidades.includes('1_5t'));});
test('Cama alta elimina7t; doble rodado solo2ejes',()=>{const q=base();q.tipoRemolque='cama_alta';q.rodado.capacidad='10t';q.rodado.cantEjesGanso=2;assert.equal(E.ejesReglas(q).llantasPorEje,4);q.rodado.cantEjesGanso=310;assert.equal(E.ejesReglas(q).llantasPorEje,2);assert.equal(E.ejesReglas(q).libras,10000);assert.ok(!E.opcionesReglas(q,db).capacidades.includes('7t'));});
test('Volteo: un gato default y dos solo con ganso',()=>{const q=base();q.tipoRemolque='volteo';q.acople.cantGatos=2;let n=E.normalizarReglas(q,db);assert.equal(n.acople.cantGatos,1);q.acople.jalon='ganso_normal';n=E.normalizarReglas(q,db);assert.equal(n.acople.cantGatos,2);});
test('Ganadero RG4 12ft: precio de lista exacto',()=>{const r=calc(config('RG4'));assert.equal(r.base,83279.21);assert.equal(r.extras,1200);});
test('Ganadero 13ft con refacción coincide con lista de prueba',()=>{const q=config('RG4');q.usarLargoCustom=true;q.largoCustom=13;q.rodado.llantaExtra=1;const r=calc(q);assert.equal(r.base+r.extras,89713.87);assert.equal(r.esEstimacion,true);});
test('14ft conserva precio exacto, no promedio',()=>{const r=calc(config('RG5'));assert.equal(r.base,89393.13);assert.equal(r.extras,1200);});
test('Tarifa manual validada prevalece en medidas nuevas',()=>{const q=config('RG4');q.usarLargoCustom=true;q.largoCustom=13;const d=clone(db),filas=E.mxFilasModelos(d).filter(z=>z.tipo==='ganadero_redondo'&&z.w===60&&z.capacidadId==='3t'&&z.variante==='Redila fija'),g=E.gruposPrecios(filas).find(g=>g.lista.some(z=>z.id===q.referenciaMexico));d.tarifasLargo=[{id:g.id,precio:4000,modeloBase:g.base.id,validada:true}];assert.equal(calc(q,d).base,87279.21);assert.equal(calc(q,d).esEstimacion,true);d.tarifasLargo[0].precio=null;assert.equal(E.mxEvaluar(d,q).ok,false);});
const doors=()=>{const q=config('RG4');q.dim.largo='20ft';q.tipoGanadero='ganso';q.monturero={tipo:'ninguno'};q.carroceria.puertasIntList=[{id:'1',tipo:'fija'},{id:'2',tipo:'fija'}];return q;};
test('60x20 máximo3; dos puertas a80 y160pulgadas',()=>{const p=E.puertasReglas(doors(),db);assert.equal(p.max,3);assert.equal(p.puertas[0].distancia,80);assert.equal(p.puertas[1].distancia,160);assert.equal(p.errores.length,0);});
test('Rechaza posiciones12 y15pies; acepta10 y15pies',()=>{const q=doors();q.carroceria.modoPuertas='manual';q.carroceria.puertasIntList[0].distancia=144;q.carroceria.puertasIntList[1].distancia=180;assert.ok(E.puertasReglas(q,db).errores.length);q.carroceria.puertasIntList[0].distancia=120;assert.equal(E.puertasReglas(q,db).errores.length,0);});
test('Una puerta personalizada no se presenta como centrada',()=>{const q=doors();q.carroceria.modoPuertas='manual';q.carroceria.puertasIntList=[{id:'1',tipo:'fija',distancia:120}];assert.equal(E.puertasReglas(q,db).puertas[0].distancia,120);});
test('Monturero descuenta espacio; diagonales calculan largo',()=>{const q=doors();q.monturero={tipo:'recto_4'};assert.equal(E.puertasReglas(q,db).max,2);q.monturero.tipo='ninguno';q.carroceria.puertasIntList=[{id:'1',tipo:'diagonal',desfase:45}];assert.equal(E.puertasReglas(q,db).puertas[0].longitud,75);assert.ok(E.puertasReglas(q,db).consulta);});
test('Normalización estable y no elimina puertas personalizadas',()=>{const q=doors();q.carroceria.modoPuertas='manual';q.carroceria.puertasIntList=[{id:'1',tipo:'fija',distancia:144},{id:'2',tipo:'fija',distancia:180}];const n=E.normalizarReglas(q,db);assert.equal(n.carroceria.puertasIntList.length,2);assert.equal(JSON.stringify(n),JSON.stringify(E.normalizarReglas(n,db)));});
test('Migración idempotente conserva precios editados y ajuste2020',()=>{const d=clone(db);d.extras.find(z=>z.id==='portaExtra').precio_cama_baja=999;assert.equal(E.actualizarCatalogoReglas(d),false);assert.equal(d.extras.find(z=>z.id==='portaExtra').precio_cama_baja,999);assert.equal(d.modelosLinea.find(z=>z.codigoLista==='CS1'&&z.capacidad==='850kg').precio,64389.9);});
test('Funciones originales conservadas: WhatsApp/PDF, guardar, duplicar y diseño',()=>{for(const t of ['handleWhatsAppPDF','handleDuplicarCotizacion','handleGuardarCotizacion','ticket-cotizacion','https://wa.me/','encodeURIComponent(textoFinal)','esHojaDiseno'])assert.ok(source.includes(t),t);assert.ok(source.includes('modelosVisibles.map'));});
console.log(`${count} pruebas correctas. Sin conexión a Firebase.`);

for(const [codigo,num] of [['RG2',0],['RG4',1],['RG5',1],['RG6',1]])test('Puerta base frente redondo '+codigo,()=>{const q=config(codigo);assert.equal(q.carroceria.puertasIntList.length,num);assert.ok(q.carroceria.puertasIntList.every(p=>p.tipo==='corrediza'));assert.equal(q.carroceria.puertaTras,'corrediza');const r=calc(q);assert.equal(r.extras,1200);});
test('Redondo 6t: cadena 1/4, gato7k incluido y porta aparte',()=>{const q=config('RG4','6t');assert.equal(q.acople.cadena,'seguridad_14');assert.equal(q.acople.gato,'manual_7k');const r=calc(q);assert.equal(r.extras,1200);assert.equal(r.ajustes.length,1);assert.ok(r.ajustes[0].nombre.includes('Porta'));});

test('RG6 desmontable de la captura: base98269.38, gato2k, puerta central y porta aparte',()=>{
 const q=config('RG6','3t','Redila desmontable');assert.equal(q.acople.gato,'normal_2k');assert.equal(q.carroceria.puertasIntList.length,1);assert.equal(q.carroceria.puertasIntList[0].tipo,'corrediza');
 const r=calc(q);assert.equal(r.base,98269.38);assert.equal(r.extras,1200);assert.equal(r.base+r.extras,99469.38);assert.equal(r.ajustes.length,1);assert.ok(r.ajustes[0].nombre.includes('Porta'));
});
test('Corrige base3t heredada sin alterar precios de catálogo ni tarifas capturadas',()=>{
 const d=clone(db);delete d._frenteRedondo2026v3;const m=d.modelosLinea.find(z=>z.codigoLista==='RG6'&&z.capacidad==='3t'&&z.redila==='desmontable');m.gato='manual_7k';m.puertasIncluidas=0;
 d.gatos.find(z=>z.id==='normal_2k').precio_ganadero_redondo=-1450;d.extras.find(z=>z.id==='portaExtra').precio_ganadero_redondo=875;
 assert.equal(E.corregirFrenteRedondo(d),true);assert.equal(m.precio,98269.38);assert.equal(m.gato,'normal_2k');assert.equal(m.puertasIncluidas,1);
 const q=E.normalizarReglas({...E.mxConfiguracionModelo(m),market:'mexico'},d);const r=calc(q,d);assert.equal(r.base+r.extras,99144.38);assert.equal(r.ajustes.length,1);assert.equal(E.corregirFrenteRedondo(d),false);
});
test('Precios redondo 2024 cotejados con foto, ambas redilas y capacidades',()=>{
 const rows=[['RG2','1_5t',59925.29,63642.61],['RG2','3t',73247.13,76962.50],['RG2','6t',97326.89,100272.14],['RG4','1_5t',68789.84,72507.16],['RG4','3t',83279.21,85527.31],['RG4','6t',103966.76,108367.94],['RG5','3t',89393.13,91461.67],['RG5','6t',111806.24,114016.48],['RG6','3t',95417.85,98269.38],['RG6','6t',118399.93,120810.18]];
 for(const [code,cap,fija,desmontable] of rows)for(const [variant,price] of [['Redila fija',fija],['Redila desmontable',desmontable]]){const q=config(code,cap,variant);const r=calc(q);assert.equal(r.base,price,code+' '+cap+' '+variant);assert.equal(r.extras,1200);}
});

const resultados=[];
for(const m of db.modelosLinea.filter(z=>z.esReferenciaListaMexico)){
 const raw=E.mxConfiguracionModelo(m),q=E.normalizarReglas({...raw,market:'mexico'},db);
 const r=E.mxEvaluar(db,q);
 const cambios=['dim','rodado','acople','acabados','carroceria','camaBajaOpts'].flatMap(k=>Object.keys(raw[k]||{}).filter(f=>['ancho','largo','capacidad','piso','redila','rampas','cantFrenos','gato','jalon'].includes(f)&&JSON.stringify(raw[k][f])!==JSON.stringify(q[k][f])).map(f=>k+'.'+f+': '+raw[k][f]+' → '+q[k][f]));
 resultados.push({id:m.id,codigo:m.codigoLista,nombre:m.nombre,tipo:m.tipoRemolque,precio:m.precio,ok:r.ok,error:r.error,base:r.base,extras:r.extras,cambios,ajustes:r.ajustes});
}
fs.writeFileSync(path.join(__dirname,'auditoria-calculos.json'),JSON.stringify(resultados,null,2));
const activas=resultados.filter(x=>['cama_baja','cama_alta','ganadero_redondo','ganadero_ganso','volteo'].includes(x.tipo));
assert.equal(activas.length,186);for(const x of activas){assert.equal(x.ok,true,x.nombre+': '+x.error);assert.equal(x.base,x.precio,x.nombre);assert.equal(x.cambios.length,0,x.nombre);assert.equal(x.extras,x.tipo==='ganadero_redondo'?1200:0,x.nombre);}
console.log('211 fichas auditadas; 186 configuraciones: base exacta y equipo sin cambios; 25 especiales evaluados en las pruebas siguientes.');
const d=clone(db),extranjero={id:'extranjero',market:'usa',precio:100,esModeloUSAExcel:true};d.modelosLinea.push(extranjero);delete d._auditoriaMexico20260910;const antes=JSON.stringify(extranjero);assert.equal(E.auditarCatalogoMexico(d),true);assert.equal(JSON.stringify(extranjero),antes);assert.equal(E.auditarCatalogoMexico(d),false);console.log('Migración México idempotente y datos USA conservados.'); 

test('25 especiales conservan base y se cotizan sin cargos adicionales iniciales',()=>{
 const especiales=db.modelosLinea.filter(m=>['caja_seca','forrajero','piedras','dolly','volteo_manual','cuatrimotos','vasculante','comida','cabezal','caballos'].includes(m.tipoRemolque));assert.equal(especiales.length,25);
 for(const m of especiales){const q={...E.mxConfiguracionModelo(m),market:'mexico'};q.carroceria.especial={extras:{},piesExtra:0};const r=calc(q);assert.equal(r.base,m.precio,m.nombre);assert.equal(r.extras,0,m.nombre);for(const extra of E.extrasModelo(db,m)){const d=clone(q);d.carroceria.especial.extras[extra.id]=1;const r2=calc(d);assert.equal(r2.extras,Number(extra.precio),extra.id+' '+m.nombre);}}
});
test('Extras 2020: 35% único, tarifas del panel y persistencia de cantidades',()=>{
 const m=db.modelosLinea.find(m=>m.codigoLista==='CS2'&&m.capacidad==='3t'),q={...E.mxConfiguracionModelo(m),market:'mexico'};
 q.carroceria.especial={extras:{'MX-CAJA-GATO7':1,'MX-CAJA-PORTA':1},piesExtra:0};assert.equal(calc(q).extras,2025);
 const d=clone(db);d.gatos.find(x=>x.id==='manual_7k').precioExtra_caja_seca=1000;assert.equal(calc(q,d).extras,2080);assert.equal(E.conectarExtrasFotos(d),false);
 assert.equal(calc(clone(q)).extras,2025);q.carroceria.especial.extras['MX-CAJA-GATO7']=0;assert.equal(calc(q).extras,1080);
});
test('Largo especial automático y tarifa manual cuando no hay comparables',()=>{
 const m=db.modelosLinea.find(m=>m.codigoLista==='CS2'&&m.capacidad==='3t'),q={...E.mxConfiguracionModelo(m),market:'mexico'};q.carroceria.especial={extras:{},piesExtra:1};assert.equal(E.mxEvaluar(db,q).ok,true);
 const solo=db.modelosLinea.find(m=>m.codigoLista==='RD1'),q2={...E.mxConfiguracionModelo(solo),market:'mexico'};q2.carroceria.especial={extras:{},piesExtra:2};assert.equal(E.mxEvaluar(db,q2).ok,false);
 const d=clone(db);d.modelosLinea.find(x=>x.id===solo.id).precioPieExtraEspecial=1500;assert.equal(calc(q2,d).extras,3000);
 q.carroceria.especial={extras:{'MX-CAJA-GATO7':1},piesExtra:0};d.gatos.find(x=>x.id==='manual_7k').precioExtra_caja_seca=null;assert.equal(E.mxEvaluar(d,q).ok,false);
});
test('60in 3t: promedio1197.53, base12ft para14ft, precio exacto16ft',()=>{
 const q=base();q.dim.largo='14ft';const r=calc(q);assert.equal(r.base,54954.48);assert.ok(r.avisos.some(x=>x.includes('1197.53')));q.dim.largo='16ft';assert.equal(calc(q).base,57059.63);assert.equal(calc(q).esEstimacion,false);
});
test('60in6t usa su propio promedio, no el de3t ni otro ancho',()=>{
 const q=E.normalizarReglas({...base(),rodado:{...base().rodado,capacidad:'6t'}},db);q.dim.largo='14ft';const r=calc(q);assert.equal(r.base,81778.95);
 const d=clone(db);for(const m of d.modelosLinea)if(m.ancho!=='60in'||m.capacidad!=='6t')m.precio=99999999;
 assert.equal(calc(q,d).base,r.base);
});
test('Sin dos largos equivalentes no usa otra capacidad ni otro ancho',()=>{
 const rows=[{id:'a',tipo:'cama_baja',w:60,l:10,capacidadId:'3t',precio:100},{id:'b',tipo:'cama_baja',w:60,l:16,capacidadId:'6t',precio:400},{id:'c',tipo:'cama_baja',w:76,l:16,capacidadId:'3t',precio:300}];
 assert.throws(()=>E.precioPorLargo(rows,14,'a'),/Falta precio por pie/);
 assert.throws(()=>E.precioPorLargo(rows,16,'a'),/Falta precio por pie/);
});
test('No compara equipo distinto; exactos no necesitan tarifa',()=>{
 const rows=[{id:'a',tipo:'cama_baja',w:60,l:10,capacidadId:'3t',precio:100,cantGatos:1},{id:'b',tipo:'cama_baja',w:60,l:16,capacidadId:'3t',precio:400,cantGatos:2}];
 assert.throws(()=>E.precioPorLargo(rows,14,'a'),/Falta precio por pie/);assert.equal(E.precioPorLargo(rows,10,'a').base,100);
});
test('Ganso México usa cadena 3/8 y gatos autorizados',()=>{
 const q=base();q.tipoRemolque='ganadero';q.tipoGanadero='ganso';q.dim={ancho:'76in',largo:'16ft'};q.rodado.capacidad='3t';
 const op=E.opcionesReglas(q,db);assert.deepEqual(JSON.parse(JSON.stringify(op.cadenas)),['ganso_38']);assert.deepEqual(JSON.parse(JSON.stringify(op.gatos)),['manual_12k','hidraulico_sencillo']);
});
test('Frenos obligatorios solo en Torflex y ejes 5200/6000',()=>{
 const q=base();q.rodado.capacidad='3t';q.rodado.cantFrenos=0;assert.equal(E.validarReglas(q,db).some(x=>x.includes('freno')),false);
 q.rodado.capacidad='4t_5200';q.rodado.cantFrenos=0;assert.ok(E.validarReglas(q,db).some(x=>x.includes('5,200')));
 q.rodado.cantFrenos=2;assert.equal(E.validarReglas(q,db).some(x=>x.includes('5,200')),false);
});
test('Puerta lateral de cama baja usa 1500 y Torflex ganso ajusta a79',()=>{
 const q=base();q.carroceria.puertaPiloto=true;const r=calc(q);assert.equal(r.ajustes.find(x=>x.nombre.includes('Puerta'))?.importe,1500);
 const g=E.normalizarReglas({...base(),tipoRemolque:'ganadero',tipoGanadero:'ganso',dim:{ancho:'76in',largo:'16ft'},rodado:{...base().rodado,capacidad:'3t',suspension:'torflex_7000',cantFrenos:2},carroceria:{...base().carroceria,frente:'cachucha',puertasIntList:[]}},db);assert.ok(E.validarReglas(g,db).every(x=>!x.includes('freno')));
 const rg=E.normalizarReglas({...E.mxConfiguracionModelo(db.modelosLinea.find(x=>x.codigoLista==='RGE5')),market:'mexico'},db);rg.rodado.suspension='torflex_7000';rg.rodado.cantFrenos=2;const rr=calc(rg);assert.ok(rr.avisos.some(x=>x.includes('76 a 79')));
});
