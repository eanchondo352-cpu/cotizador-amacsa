// Prueba del componente y eventos con React simulado; no usa Firebase ni envía mensajes.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
let esbuild;try{esbuild=require('esbuild');}catch{esbuild=require('../trabajo/verificacion/node_modules/esbuild');}
const source=fs.readFileSync(path.join(__dirname,'src/App.jsx'),'utf8');
const states=[],deps=[],effects=[];let cursor=0,dirty=false;
const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:'fragment',useState:initial=>{const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],v=>{const n=typeof v==='function'?v(states[i]):v;if(n!==states[i]){states[i]=n;dirty=true;}}];},useEffect:(f,d)=>{const i=cursor++;if(!deps[i]||!d||d.some((x,j)=>!Object.is(x,deps[i][j]))){deps[i]=d;effects.push(f);}}};
React.default=React;
const storage={getItem:k=>k==='amacsa_auth'?'true':k==='amacsa_current_user'?JSON.stringify({id:'local',name:'Prueba',role:'admin'}):null,setItem(){},removeItem(){}};
const mockFirebase=new Proxy({}, {get:(_,p)=>p==='initializeApp'?()=>({}):p==='onAuthStateChanged'||p==='onSnapshot'?()=>()=>{}:p==='setDoc'?async()=>{}:()=>({})});
const modules={};
function load(file){if(modules[file])return modules[file].exports;const m={exports:{}};modules[file]=m;let text=fs.readFileSync(file,'utf8');if(file.endsWith('mercados.js'))text=text.replace('USA_HABILITADO = false','USA_HABILITADO = true');if(file.endsWith('App.jsx'))text=text.replace("const [isCloudLoaded, setIsCloudLoaded] = useState(false)","const [isCloudLoaded, setIsCloudLoaded] = useState(true)")+ '\nexport {CotizadorNube};';
if(file.endsWith('App.jsx'))text=text.replace('const handleMejorarConIACatalogo =',"module.exports.cargarUSA=handleCotizarDesdeCatalogo;module.exports.cambioUSA=setCambioDOF;module.exports.verUSA=()=>({q:qReglas,modeloUSA,precioUSA,db,cantEjes,totalFinal,fechaCotizacion,erroresConfiguracion});const handleMejorarConIACatalogo =");
const js=esbuild.transformSync(text,{loader:file.endsWith('.jsx')?'jsx':'js',format:'cjs'}).code;
const req=n=>n.endsWith('.json')?JSON.parse(fs.readFileSync(path.join(path.dirname(file),n),'utf8')):n==='react'?React:n.startsWith('./')?load(path.join(path.dirname(file),n.endsWith('.jsx')?n:fs.existsSync(path.join(path.dirname(file),n+'.js'))?n+'.js':n+'.jsx')):n.startsWith('firebase/')?mockFirebase:n==='lucide-react'?new Proxy({},{get:()=>()=>null}):{};
vm.runInNewContext(`(function(require,module,exports){${js}\n})`,{console,localStorage:storage,sessionStorage:storage,window:{},document:{},setTimeout(){},Date,Map,Set,Intl,URL,fetch(){throw Error('No network in test');}})(req,m,m.exports);return m.exports;}
// JSX sibling module uses extensionless import resolution.
const oldLoad=load;
const app=load(path.join(__dirname,'src/App.jsx'));
let tree;
function render(){let rounds=0;do{dirty=false;cursor=0;effects.length=0;tree=app.CotizadorNube();for(const f of effects.splice(0))f();assert.ok(++rounds<25,'Bucle de reglas/react');}while(dirty);return tree;}
function text(x){if(x==null||typeof x==='boolean')return '';if(typeof x!=='object')return String(x);if(Array.isArray(x))return x.map(text).join(' ');return text(x.props?.children);}
function nodes(x,p,out=[]){if(!x||typeof x!=='object')return out;if(Array.isArray(x)){x.forEach(v=>nodes(v,p,out));return out;}if(p(x))out.push(x);nodes(x.props?.children,p,out);return out;}
function click(pattern){const b=nodes(tree,x=>x.type==='button'&&pattern.test(text(x)))[0];assert.ok(b,'Botón '+pattern);b.props.onClick();render();}
render();assert.ok(text(tree).includes('177,514.73'),'Inicio con precio base de ganso');
click(/Cama\s+Baja/);assert.ok(text(tree).includes('52,559.42'),'Cama baja inicia base12 seleccionada');
click(/Cama\s+Alta/);assert.ok(text(tree).includes('181,970.74')||text(tree).includes('171,012.80'),'Cama alta precio visible');
click(/Remolque\s+Volteo/);assert.ok(!text(tree).includes('NaN'));
click(/Ganadero\s+Redondo/);assert.ok(text(tree).includes('83,279.21'),'RG4 precio correcto');
console.log('OK render y cambios de tipo sin bucles ni NaN');
click(/USA/);assert.ok(!text(tree).includes('NaN'),'USA no produce NaN');
click(/M[ée]xico/i);assert.ok(!text(tree).includes('NaN'),'México vuelve sin NaN');
click(/Catálogo de Modelos/);
click(/^Cama baja$/);
const cotizar=nodes(tree,x=>x.type==='button'&&text(x)==='Ir a Cotizar');assert.ok(cotizar.length>0);
assert.ok(!text(tree).includes('RG4 ·'),'Filtro excluye ganaderos');
cotizar[0].props.onClick();render();assert.ok(!text(tree).includes('NaN'),'Carga modelo de catálogo');
const cerrar=nodes(tree,x=>x.type==='button'&&/Entendido|Aceptar/.test(text(x)))[0];if(cerrar){cerrar.props.onClick();render();}
console.log('OK filtros y carga del catálogo; regreso entre México y USA');

console.log('Botones navegación:',nodes(tree,x=>x.type==='button').map(text).filter(x=>/Catálogo|catálogo|Menú|Modelos|Cerrar/i.test(x)));
console.log('Prueba de interfaz completada sin servicios externos.');

const funcion=(code,inicio,fin)=>code.slice(code.indexOf(inicio),code.indexOf(fin,code.indexOf(inicio)));
const wa=funcion(source,'const handleWhatsAppPDF = async () => {','  const handleCant');
assert.ok(wa.includes('validarPrecioActual()'));
assert.ok(wa.includes('cambioDOF'));
assert.ok(!wa.includes('${totalFinalAMostrar} MXN'));
console.log('OK WhatsApp valida cambio y conserva referencia y moneda.');

const catalogo=JSON.parse(fs.readFileSync(path.join(__dirname,'src/catalogo-usa.json'),'utf8'));
for(const m of catalogo.modelos){
 app.cargarUSA(m);render();
 let v=app.verUSA();
 assert.equal(v.modeloUSA.id,m.id);
 assert.equal(v.q.dim.ancho,m.ancho);assert.equal(v.q.dim.largo,m.largo);
 assert.equal(v.q.rodado.suspension,m.suspension);
 assert.equal(v.q.acople.jalon,m.jalon);
 assert.equal(v.cantEjes,m.cantEjes);
 assert.equal(v.precioUSA.ok,true,m.id+': '+v.precioUSA.error);
 assert.equal(v.precioUSA.base,m.precio);assert.equal(v.precioUSA.extras,0);
 assert.equal(v.erroresConfiguracion.length,0,m.id+': '+v.erroresConfiguracion.join(','));
 app.cambioUSA({valor:20,confirmado:true,fechaCotizacion:v.fechaCotizacion,fechaPublicacion:'2020-01-02'});render();v=app.verUSA();
 assert.ok(Math.abs(v.totalFinal-m.precio/20)<0.011,m.id+' total USD');
}
console.log('73 modelos: carga, medidas, equipo, ejes, base exacta, cero extras incluidos y conversión USD verificadas.');
const core=load(path.join(__dirname,'src/catalogo-usa.js'));
const testDb=JSON.parse(JSON.stringify(app.verUSA().db));
const count=testDb.modelosLinea.length;
assert.equal(core.integrarUSA(testDb),false);assert.equal(testDb.modelosLinea.length,count);
const first=testDb.modelosLinea.find(m=>m.esModeloUSAExcel);first.precio=123456;
core.integrarUSA(testDb);assert.equal(first.precio,123456);
const end=app.verUSA();const changed=JSON.parse(JSON.stringify(end.q));changed.carroceria.redila='cerrada';
const result=core.evaluarUSA(end.db,end.modeloUSA,changed,end.q,[]);
assert.equal(result.ok,true);assert.equal(result.extras,18500);
const unknown=JSON.parse(JSON.stringify(end.q));unknown.acople.gato='sin-tarifa';
assert.equal(core.evaluarUSA(end.db,end.modeloUSA,unknown,end.q,[]).ok,false);
const other=JSON.parse(JSON.stringify(end.q));other.isSpecialClient=!other.isSpecialClient;
assert.equal(core.evaluarUSA(end.db,end.modeloUSA,other,end.q,[]).ok,false);
assert.equal(catalogo.modelos.filter(m=>m.clienteUSA==='DEAN').length,44);
assert.equal(catalogo.modelos.filter(m=>m.clienteUSA==='WALL').length,23);
assert.equal(catalogo.modelos.filter(m=>m.clienteUSA==='DH').length,6);
assert.ok(catalogo.modelos.some(m=>m.id==='USA-DEAN-1962'));
assert.ok(!catalogo.modelos.some(m=>m.id==='USA-DEAN-1991'));
console.log('Migración idempotente, ediciones conservadas, cargos únicos y perfiles verificados.');
const reglas=load(path.join(__dirname,'src/reglas-amacsa.js'));
for(const cantidad of [1,2,3]){
 const q=JSON.parse(JSON.stringify(end.q));q.rodado.suspension='torflex';q.rodado.cantFrenos=0;q.modeloUSA.cantEjes=cantidad;
 const n=reglas.normalizarReglas(q,end.db);assert.equal(n.rodado.cantFrenos,cantidad);
 assert.ok(reglas.validarReglas(q,end.db).includes('Todos los ejes Torflex deben llevar freno.'));
}
const normal=JSON.parse(JSON.stringify(end.q));delete normal.modeloUSA;normal.tipoGanadero='ganso';normal.rodado.capacidad='6t';normal.rodado.suspension='torflex';normal.rodado.cantFrenos=0;
assert.equal(reglas.normalizarReglas(normal,end.db).rodado.cantFrenos,2);
console.log('Torflex: frenos obligatorios en 1, 2 y 3 ejes y en configuración general.');
const mover=JSON.parse(JSON.stringify(end.q));mover.carroceria.puertasIntList=[{id:'x',tipo:'fija',distancia:100}];
const moverBase=JSON.parse(JSON.stringify(mover));moverBase.carroceria.puertasIntList[0].distancia=90;
assert.equal(core.evaluarUSA(end.db,end.modeloUSA,mover,moverBase,[]).ok,true);
assert.equal(core.evaluarUSA(end.db,end.modeloUSA,mover,moverBase,[]).extras,0);
const conLuz=JSON.parse(JSON.stringify(end.q));conLuz.accesorios.lucesInteriores=Number(conLuz.accesorios.lucesInteriores||0)+1;
const dbLuz=JSON.parse(JSON.stringify(end.db));const luz=dbLuz.extras.find(x=>x.id==='lucesInteriores');luz.precio_ganadero_ganso=123;
assert.equal(core.evaluarUSA(dbLuz,end.modeloUSA,conLuz,end.q,[]).extras,123);
const vacio=JSON.parse(JSON.stringify(end.q));vacio.carroceria.ventEst=false;
assert.equal(core.evaluarUSA(end.db,end.modeloUSA,vacio,end.q,[]).ok,true);
console.log('Mover puertas sin cambiar equipo no cobra; extras consultan tarifas; campos vacíos no crean falsos cambios.');
for(const piso of ['hule_anti','hule_liso']){
 const q=JSON.parse(JSON.stringify(end.q));q.acabados.piso=piso;
 const original=JSON.parse(JSON.stringify(end.q));original.acabados.piso='usa_5e565638df49';
 const result=core.evaluarUSA(end.db,end.modeloUSA,q,original,[]);
 assert.equal(result.ok,true);assert.equal(result.extras,0);
}
const anterior=JSON.parse(JSON.stringify(end.db));anterior.modelosLinea[0]={...end.modeloUSA,piso:'usa_5e565638df49'};anterior.pisos.push({id:'usa_5e565638df49',nombre:'Hule según ficha Excel',precioSqFt:123});
core.integrarUSA(anterior);assert.equal(anterior.modelosLinea[0].piso,'hule_anti');assert.ok(!anterior.pisos.some(x=>x.id==='usa_5e565638df49'));assert.equal(anterior.pisosUSAArchivados.at(-1).precioSqFt,123);
console.log('Hule liso/antiderrapante incluidos y migración de la opción anterior verificados.');
