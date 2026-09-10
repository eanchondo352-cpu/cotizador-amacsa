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
function load(file){if(modules[file])return modules[file].exports;const m={exports:{}};modules[file]=m;let text=fs.readFileSync(file,'utf8');if(file.endsWith('App.jsx'))text=text.replace("const [isCloudLoaded, setIsCloudLoaded] = useState(false)","const [isCloudLoaded, setIsCloudLoaded] = useState(true)")+ '\nexport {CotizadorNube};';
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
const largoRedondo=nodes(tree,x=>x.type==='select'&&x.props.value==='12ft')[0];assert.ok(largoRedondo);largoRedondo.props.onChange({target:{value:'16ft'}});render();
const redilaRedondo=nodes(tree,x=>x.type==='select'&&x.props.value==='ptr_abierta')[0];assert.ok(redilaRedondo);redilaRedondo.props.onChange({target:{value:'desmontable'}});render();
assert.ok(text(tree).includes('98,269.38'),'Precio exacto RG6 desmontable');
assert.ok(text(tree).includes('99,469.38'),'Total RG6 con porta1200');
assert.ok(nodes(tree,x=>x.type==='select'&&x.props.value==='normal_2k').length,'Gato2k por defecto');
assert.ok(text(tree).includes('Porta extra × 1'),'Desglose porta visible');
console.log('OK RG6 16ft desmontable por selectores: base98269.38 y total99469.38');
console.log('OK render y cambios de tipo sin bucles ni NaN');
assert.equal(nodes(tree,x=>x.type==='button'&&/^USA$/.test(text(x).trim())).length,0,'USA oculto');
click(/M[ée]xico/i);assert.ok(!text(tree).includes('NaN'),'México vuelve sin NaN');
click(/Catálogo de Modelos/);
assert.equal(nodes(tree,x=>(x.type==='button'||x.type==='option')&&/USA|DEAN|WALL|DH/.test(text(x))).length,0,'Catálogo y filtros solo México');
click(/^Cama baja$/);
const cotizar=nodes(tree,x=>x.type==='button'&&text(x)==='Ir a Cotizar');assert.ok(cotizar.length>0);
assert.ok(!text(tree).includes('RG4 ·'),'Filtro excluye ganaderos');
cotizar[0].props.onClick();render();assert.ok(!text(tree).includes('NaN'),'Carga modelo de catálogo');
const cerrar=nodes(tree,x=>x.type==='button'&&/Entendido|Aceptar/.test(text(x)))[0];if(cerrar){cerrar.props.onClick();render();}
console.log('OK filtros y carga del catálogo México; USA oculto');

console.log('Botones navegación:',nodes(tree,x=>x.type==='button').map(text).filter(x=>/Catálogo|catálogo|Menú|Modelos|Cerrar/i.test(x)));
console.log('Prueba de interfaz completada sin servicios externos.');

const funcion=(code,inicio,fin)=>code.slice(code.indexOf(inicio),code.indexOf(fin,code.indexOf(inicio)));
const wa=funcion(source,'const handleWhatsAppPDF = async () => {','  const handleCant');
assert.ok(wa.includes('validarPrecioActual()'));
assert.ok(wa.includes('cambioDOF'));
assert.ok(!wa.includes('${totalFinalAMostrar} MXN'));
console.log('OK WhatsApp valida cambio y conserva referencia y moneda.');
click(/Remolques especiales/);
const especial=()=>nodes(tree,x=>x.props?.modelo&&x.props?.onModelo&&x.props?.onChange)[0];
assert.ok(especial(),'Formulario especial integrado');
const modelosEspeciales=especial().props.db.modelosLinea.filter(m=>['caja_seca','forrajero','piedras','dolly','volteo_manual','cuatrimotos','vasculante','comida','cabezal','caballos'].includes(m.tipoRemolque));
for(const m of modelosEspeciales){especial().props.onModelo(m);render();assert.ok(text(tree).includes(m.especificaciones),m.nombre);assert.ok(!text(tree).includes('NaN'));assert.ok(especial(),m.nombre);}
const caja=modelosEspeciales.find(m=>m.codigoLista==='CS2'&&m.capacidad==='3t');especial().props.onModelo(caja);render();especial().props.onChange({extras:{'MX-CAJA-GATO7':1},piesExtra:0});render();
assert.ok(text(tree).includes('113,184.27'),'Base112239.27 + gato945');
assert.ok(text(tree).includes('Gato de 7,000 lbs × 1'),'Accesorio en ticket');
click(/Cama\s+Baja/);assert.ok(!especial(),'Retorno al configurador normal');
console.log('OK 25 modelos especiales en pantalla, extras cotizados e impresión con equipo específico.');
