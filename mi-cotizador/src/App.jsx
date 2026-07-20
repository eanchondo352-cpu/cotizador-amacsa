import React, { useState, useEffect } from 'react';
import { Truck, FileText, Printer, Settings, Save, Plus, Trash2, Shield, Disc, DoorOpen, Layers, Zap, Lightbulb, Lock, Unlock, LogOut, ClipboardList, Star, Users, History, User, Key, Database, Globe, RefreshCw, Send } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

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

let app, auth, db_fs;
if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db_fs = getFirestore(app);
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
  '60in': ['10ft', '12ft', '14ft'],
  '75in': ['10ft', '12ft', '14ft', '16ft'],
  '76in': ['10ft', '12ft', '14ft', '16ft', '18ft'],
  '82in': ['10ft', '12ft', '14ft', '16ft', '18ft', '20ft'],
  '84in': ['10ft', '12ft', '14ft', '16ft', '18ft', '20ft']
};

const CAMA_ALTA_LARGOS = ['16ft', '20ft', '22ft', '24ft', '32ft', '42ft'];
const CAMA_ALTA_CAPS = ['6t', '9t', '10t'];
const VOLTEO_COMBOS = {
  '60in': ['10ft', '12ft', '14ft'],
  '76in': ['10ft', '12ft', '14ft', '16ft'],
  '82in': ['10ft', '12ft', '14ft', '16ft']
};

const getCapacidadesCamaBaja = (anchoId, largoId) => {
  let caps = [];
  if (anchoId === '50in') caps.push('850kg');
  else if (anchoId === '60in') caps.push('1_5t', '3t');
  else if (anchoId === '84in') caps.push('3t', '6t');
  else if (['75in', '76in', '82in'].includes(anchoId)) {
    caps.push('3t', '6t');
    if (['10ft', '12ft', '14ft'].includes(largoId)) caps.push('1_5t');
    if (['75in', '76in'].includes(anchoId)) caps.push('4t');
  }
  return caps.length > 0 ? caps : ['3t']; 
};

// --- BASE DE DATOS MAESTRA ---
const DEFAULT_DB = {
  largos: [
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
    { id: '850kg', nombre: '850 Kg (1 Eje Ligero)', precio: -6000 },
    { id: '1_5t', nombre: '1.5 Ton (1 Eje)', precio: -3000 },
    { id: '3t', nombre: '3 Ton (1 o 2 Ejes 3,500 lbs)', precio: 0 },
    { id: '4t', nombre: '4 Ton (2 Ejes)', precio: 8000 },
    { id: '6t', nombre: '6 Ton (2 Ejes 7,000 lbs)', precio: 14500 },
    { id: '7t', nombre: '7 Ton (2 Ejes 8,000 lbs)', precio: 22000 },
    { id: '9t', nombre: '9 Ton (3 Ejes 7,000/8,000 lbs)', precio: 34000 },
    { id: '10t', nombre: '10 Ton (2 Ejes 10,000 lbs)', precio: 48000 }
  ],
  suspension: [
    { id: 'susp_1_5t', nombre: 'Kit Suspensión 1.5 Ton', precio: -1000 },
    { id: 'susp_3t', nombre: 'Kit Suspensión 3/4 Ton', precio: 0 },
    { id: 'susp_6t', nombre: 'Kit Suspensión 6 Ton', precio: 2000 },
    { id: 'muelle', nombre: 'Muelle Estándar (Ganadero/Cama Alta)', precio: 0 },
    { id: 'torflex', nombre: 'Sistema Torflex', precio: 4500 }
  ],
  llantas: [
    { id: 'ninguna', nombre: 'Sin Llantas (Sin rodado)', precio: -12000, precioExtra: 0 },
    { id: '700_15', nombre: '700R15', precio: -3500, precioExtra: 2500 },
    { id: '225_75_15', nombre: '225/75 R15', precio: -2000, precioExtra: 3000 },
    { id: '235_80_16', nombre: 'ST235/80R16', precio: -2500, precioExtra: 3500 },
    { id: '16in_10', nombre: 'ST235/80R16 10 Lonas', precio: -2500, precioExtra: 3500 },
    { id: '16in_14', nombre: 'ST235/80R16 14 Lonas', precio: 0, precioExtra: 4500 },
    { id: '235_80_16_14', nombre: 'ST235/80R16 14 Lonas', precio: 0, precioExtra: 4500 },
    { id: '17_5in', nombre: 'Radial 17.5', precio: 12000, precioExtra: 7500 }
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
    { id: 'cerrada', nombre: 'Cerrada (Ganadero)', precio: 18500 }
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
    { id: 'medio', nombre: 'Medio Techo', precio: 8500 },
    { id: 'completo', nombre: 'Techo Completo', precio: 14500 }
  ],
  jalones: [
    { id: 'ganso_normal', nombre: 'Cuello de Ganso Normal', tipo: 'ganso', precio: -3500 },
    { id: 'ganso_facil', nombre: 'Cuello Ganso Enganche Fácil', tipo: 'ganso', precio: 0 },
    { id: 'bumper_2', nombre: 'Bumper Pull Reforzado 2"', tipo: 'bumper', precio: -4500 },
    { id: 'bumper_2_516', nombre: 'Bumper Pull Reforzado 2" 5/16', tipo: 'bumper', precio: -4000 },
    { id: 'bumper_ajustable_2', nombre: 'Bumper Pull Ajustable 2"', tipo: 'bumper', precio: -2500 },
    { id: 'bumper_ajustable_2_516', nombre: 'Bumper Pull Ajustable 2" 5/16', tipo: 'bumper', precio: -2000 },
    { id: 'argolla', nombre: 'Jalón Argolla', tipo: 'bumper', precio: -1500 }
  ],
  gatos: [
    { id: 'tubo_2k', nombre: 'Gato Tubo Corto 2,000 lbs', precio: -1500 },
    { id: 'normal_2k', nombre: 'Gato Normal 2,000 lbs', precio: 0 },
    { id: 'manual_7k', nombre: 'Gato Manual 7,000 lbs', precio: 1500 },
    { id: 'manual_12k', nombre: 'Gato Manual 12,000 lbs', precio: 3500 },
    { id: 'manual', nombre: 'Gato Manual (Ganadero)', precio: 0 },
    { id: 'hidraulico_sencillo', nombre: 'Gato Hidráulico (Sin Bomba)', precio: 6500 },
    { id: 'hidraulico_bomba', nombre: 'Gato Hidráulico c/Bomba Integrada', precio: 12500 }
  ],
  cadenas: [
    { id: 'ganso_38', nombre: 'Cadena Seguridad Ganso 3/8 x 35"', precio: 0 },
    { id: 'seguridad_14', nombre: 'Cadena Seguridad 1/4 x 54"', precio: 0 }
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
  extras: [
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
    { id: 'fenderReforzado', nombre: 'Fender Reforzado', precio: 1500 },
    { id: 'luzPortaplaca', nombre: 'Luz Portaplaca', precio: 350 }
  ]
};

const DEFAULT_USERS = [
  { id: 'u1', username: 'admin', password: 'adminamacsa', role: 'admin', name: 'Administrador Principal' },
  { id: 'u2', username: 'ventas', password: 'amacsa2026', role: 'sales', name: 'Equipo de Ventas' }
];

const ADMIN_SECTIONS = [
  { id: 'largos', title: 'Largos Disponibles', hasValor: true, valorLabel: 'Largo (Pies)' },
  { id: 'anchos', title: 'Anchos (Pulgadas)', hasValor: true, valorLabel: 'Ancho (In)' },
  { id: 'capacidades', title: 'Configuraciones de Carga (Ejes)' },
  { id: 'llantas', title: 'Tipos de Llantas', hasPrecioExtra: true },
  { id: 'redilas', title: 'Tipos de Redila' },
  { id: 'rampas', title: 'Rampas y Puertas Traseras' },
  { id: 'pisos', title: 'Materiales de Piso (Precio base)', isPiso: true },
  { id: 'puertasInteriores', title: 'Puertas Interiores (Ganadero)' },
  { id: 'puertasTraseras', title: 'Puertas Traseras (Ganadero)' },
  { id: 'techos', title: 'Opciones de Techo' },
  { id: 'jalones', title: 'Tipos de Jalones', isJalon: true },
  { id: 'gatos', title: 'Gatos Hidráulicos y Manuales' },
  { id: 'cadenas', title: 'Cadenas de Seguridad' },
  { id: 'montureros', title: 'Estilos de Monturero' },
  { id: 'suspension', title: 'Sistemas de Suspensión' },
  { id: 'luces', title: 'Paquetes de Luces' },
  { id: 'colores', title: 'Colores de Remolque', isColor: true },
  { id: 'extras', title: 'Accesorios y Extras (Fijos)', isFixed: true }
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
  const [isAuthenticated, setIsAuth] = useState(() => localStorage.getItem('amacsa_auth') === 'true');
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');

  const [db, setDb] = useState(DEFAULT_DB);
  const [users, setUsers] = useState(DEFAULT_USERS);
  const [logs, setLogs] = useState([]);
  const [cotizaciones, setCotizaciones] = useState([]);

  const [currentUser, setCurrentUser] = useState(() => {
    try { const saved = localStorage.getItem('amacsa_current_user'); return saved ? JSON.parse(saved) : null; }
    catch { return null; }
  });

  const [profileForm, setProfileForm] = useState({ name: '', username: '', password: '' });

  const [view, setView] = useState('cotizador');
  const [adminSection, setAdminSection] = useState('cotizaciones');
  const [activeTab, setActiveTab] = useState('cotizacion');
  
  const [market, setMarket] = useState('usa'); 
  const [tipoRemolque, setTipoRemolque] = useState('ganadero');
  const [isSpecialClient, setIsSpecialClient] = useState(true);
  const [tipoGanadero, setTipoGanadero] = useState('ganso');
  const [isAppUnlocked, setIsAppUnlocked] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', username: '', password: '', role: 'sales' });
  const [notification, setNotification] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [adminUnlockPrompt, setAdminUnlockPrompt] = useState(false);
  const [adminUnlockPass, setAdminUnlockPass] = useState('');

  const [cliente, setCliente] = useState({ nombre: '', telefono: '', anticipo: 0, descuentoPct: 0, ajusteRedondeo: 0 });
  const [dim, setDim] = useState({ largo: '20ft', ancho: '84in' });
  const [acople, setAcople] = useState({ jalon: 'ganso_facil', cadena: 'ganso_38', sujetaCadenas: true, gato: 'manual', cantGatos: 1, cargadorSolar: false, cargador110: false });
  const [rodado, setRodado] = useState({ capacidad: '6t', suspension: 'torflex', llanta: '16in_14', cantFrenos: 2, llantaExtra: 0, portaExtra: 1 });
  const [carroceria, setCarroceria] = useState({ techo: 'completo', frente: 'cachucha', redila: 'ptr_abierta', puertaInt: 'fija', cantPtasInt: 1, puertaTras: 'libro', puertaPiloto: true, puertaPilotoAncho: 40, plexiglass: false, rackPacas: false, ventEst: false, ventCirc: false, polverasEspeciales: false, puertaPerroCachucha: false });
  const [monturero, setMonturero] = useState({ tipo: 'ninguno', basesMontura: 3, tubosCobija: 1, puertaPerro: false, paredLarga: 85.5, paredCorta: 40 });
const [acabados, setAcabados] = useState({ piso: 'madera', pintura: 'polvo', mismoColorTecho: false, color: 'gris', luces: 'estandar_usa', bodyLitros: 0, pinturaLitros: 0, techoLitros: 0, cajasPolvo: 0, cajaHtas: 'ninguna' });  const [accesorios, setAccesorios] = useState({ lucesInteriores: 0 });
  const [camaBajaOpts, setCamaBajaOpts] = useState({ rampas: 'ninguna', fenderReforzado: false, ovaloRojo: 0, tresCuartosRojo: 0, tresCuartosAmbar: 0, luzPortaplaca: false });
const [volteoOpts, setVolteoOpts] = useState({ 
    sistemaElevacion: 'hidraulico', // hidraulico, electrico, ambos
    puertaTrasera: 'libro',         // libro, dompe, sencilla, libro_dompe
    fenderReforzado: false,
    luzPortaplaca: false
  });
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
        let updated = false;
        Object.keys(DEFAULT_DB).forEach(key => {
            if (!data[key]) { data[key] = DEFAULT_DB[key]; updated = true; } 
            else {
                DEFAULT_DB[key].forEach(defaultItem => {
                    if (!data[key].find(item => item.id === defaultItem.id)) { data[key].push(defaultItem); updated = true; }
                });
            }
        });
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
      localStorage.setItem('amacsa_current_user', JSON.stringify(currentUser));
      setProfileForm({ name: currentUser.name, username: currentUser.username, password: currentUser.password });
    } else { localStorage.removeItem('amacsa_current_user'); }
  }, [currentUser]);

  const logAction = (actionDescription) => {
    const newLog = { id: Date.now() + Math.random(), date: new Date().toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'medium' }), user: currentUser?.name || 'Sistema', action: actionDescription };
    const updatedLogs = [newLog, ...logs].slice(0, 500);
    setLogs(updatedLogs); setDoc(doc(db_fs, getDocPath('logs')), { list: updatedLogs });
  };

  const handleDbChange = (section, index, field, value) => {
    const newDb = { ...db }; newDb[section][index][field] = value; setDb(newDb); setDoc(doc(db_fs, getDocPath('catalog')), newDb);
  };

  const handleDbAdd = (section) => {
    const newDb = { ...db }; const baseItem = { id: `item_${Date.now()}`, nombre: 'Nuevo Elemento', precio: 0 };
    const sectionDef = ADMIN_SECTIONS.find(s => s.id === section);
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
    if (userMatch) { setCurrentUser(userMatch); setIsAuth(true); localStorage.setItem('amacsa_auth', 'true'); setLoginError(''); logAction(`Inició sesión en el sistema.`); } 
    else { setLoginError('Usuario o contraseña incorrectos'); setLoginPass(''); }
  };

  const handleLogout = () => { setCurrentUser(null); setIsAuth(false); localStorage.removeItem('amacsa_auth'); setIsAppUnlocked(false); setView('cotizador'); };

  const handleAdminAccess = () => { if (isAppUnlocked) { setIsAppUnlocked(false); setView('cotizador'); } else { setAdminUnlockPrompt(true); } };

  const handleUnlockSubmit = (e) => {
    e.preventDefault();
    // Permite acceso si usa la clave maestra O si es admin y pone su propia contraseña
    if (adminUnlockPass === ADMIN_PASSWORD || (currentUser?.role === 'admin' && adminUnlockPass === currentUser.password)) { 
      setIsAppUnlocked(true); setView('admin'); setAdminUnlockPrompt(false); setAdminUnlockPass(''); 
    } 
    else { setNotification({ type: 'error', message: 'Clave de acceso incorrecta.' }); setAdminUnlockPass(''); }
  };

  // --- FUNCIONES ESTRELLA ---
  const handleNuevaCotizacion = () => {
    setCliente({ nombre: '', telefono: '', anticipo: 0, descuentoPct: 0, ajusteRedondeo: 0 });
    setDim({ largo: '20ft', ancho: '84in' });
    setAcople({ jalon: 'ganso_facil', cadena: 'ganso_38', sujetaCadenas: true, gato: 'manual', cantGatos: 1, cargadorSolar: false, cargador110: false });
    setRodado({ capacidad: '6t', suspension: 'torflex', llanta: '16in_14', cantFrenos: 2, llantaExtra: 0, portaExtra: 1 });
    setCarroceria({ techo: 'completo', frente: 'cachucha', redila: 'ptr_abierta', puertaInt: 'fija', cantPtasInt: 1, puertaTras: 'libro', puertaPiloto: true, puertaPilotoAncho: 40, plexiglass: false, rackPacas: false, ventEst: false, ventCirc: false, polverasEspeciales: false, puertaPerroCachucha: false });
    setMonturero({ tipo: 'ninguno', basesMontura: 3, tubosCobija: 1, puertaPerro: false, paredLarga: 85.5, paredCorta: 40 });
    setAcabados({ piso: 'madera', pintura: 'polvo', mismoColorTecho: false, color: 'gris', luces: market === 'usa' ? 'estandar_usa' : 'estandar_mexico', bodyLitros: 0, pinturaLitros: 0, techoLitros: 0, cajasPolvo: 0, cajaHtas: 'ninguna' });    setAccesorios({ lucesInteriores: 0 });
    setCamaBajaOpts({ rampas: 'ninguna', fenderReforzado: false, ovaloRojo: 0, tresCuartosRojo: 0, tresCuartosAmbar: 0, luzPortaplaca: false });
    setNotification({ type: 'success', message: 'Cotizador listo para una nueva cotización.' });
  };

  // AYUDANTES MATEMÁTICOS PARA EL PDF Y GUARDADO
  const formatoMoneda = (num) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num || 0).replace('$', '$ ');
  const getExtraPrice = (id) => db.extras?.find(e => e.id === id)?.precio || 0;
  const getObj = (arr, id) => arr?.find(x => x.id === id) || arr?.[0] || { nombre: 'N/A', precio: 0, valor: 0 };
  
  const calcularTotalActual = () => {
    const oLargo = getObj(db.largos, dim.largo); const oAncho = getObj(db.anchos, dim.ancho); const oJalon = getObj(db.jalones, acople.jalon); const oCadena = getObj(db.cadenas, acople.cadena); const oGato = getObj(db.gatos, acople.gato); const oSusp = getObj(db.suspension, rodado.suspension); const oLlantas = getObj(db.llantas, rodado.llanta); const oTecho = getObj(db.techos, carroceria.techo); const oRedila = getObj(db.redilas, carroceria.redila); const oPInt = getObj(db.puertasInteriores, carroceria.puertaInt); const oPTras = getObj(db.puertasTraseras, carroceria.puertaTras); const oPiso = getObj(db.pisos, acabados.piso); const oMont = getObj(db.montureros, monturero.tipo); const oPint = getObj(db.pinturas, acabados.pintura); const oLuces = getObj(db.luces, acabados.luces); const oRampa = db.rampas?.find(r => r.id === camaBajaOpts.rampas) || {precio: 0}; const oCap = getObj(db.capacidades, rodado.capacidad);
    const anchoEnPies = (oAncho.valor || 0) / 12; const areaSqFt = (oLargo.valor || 0) * anchoEnPies; const costoPisoTotal = areaSqFt * (oPiso.precioSqFt || oPiso.precio || 0) * (oPiso.id === 'madera' ? 2 : 1);
    let costoGatos = acople.gato === 'hidraulico_bomba' ? ((db.gatos?.find(g => g.id === 'hidraulico_sencillo')?.precio || 6500) * acople.cantGatos) + (oGato.precio - (db.gatos?.find(g => g.id === 'hidraulico_sencillo')?.precio || 6500)) : oGato.precio * acople.cantGatos;
    const totalGatos = costoGatos + (acople.cargadorSolar ? 2500 : 0) + (acople.cargador110 ? 1500 : 0) + (acople.sujetaCadenas ? 450 : 0) + (oCadena.precio || 0);
    const totalRodado = oCap.precio + oSusp.precio + oLlantas.precio + (rodado.cantFrenos > 0 ? getExtraPrice('frenos') * rodado.cantFrenos : 0) + (rodado.llantaExtra > 0 ? (rodado.llantaExtra * (oLlantas.precioExtra || 0)) : 0) + (rodado.portaExtra * getExtraPrice('portaExtra'));
    let piesPlexi = (oLargo.valor || 0) * 4; if (oMont.id === 'recto_3') piesPlexi -= 12; else if (oMont.id === 'recto_4') piesPlexi -= 16; else if (oMont.id === 'diagonal') piesPlexi -= (((monturero.paredLarga || 0) + (monturero.paredCorta || 0)) / 12 * 2); if (carroceria.puertaPiloto) piesPlexi -= ((carroceria.puertaPilotoAncho || 0) / 12) * 4; if (carroceria.frente === 'cachucha' && carroceria.puertaPerroCachucha) piesPlexi -= 13.33; if (monturero.puertaPerro) piesPlexi -= 13.33;
    const totalCarroceria = oTecho.precio + oRedila.precio + (oPInt.precio * carroceria.cantPtasInt) + oPTras.precio + (carroceria.frente === 'cachucha' ? getExtraPrice('frenteCachucha') : carroceria.frente === 'canasta' ? getExtraPrice('frenteCanasta') : 0) + (carroceria.plexiglass && piesPlexi > 0 ? Math.ceil(piesPlexi / 46.5) * getExtraPrice('hojaPlexiglass') : 0) + (carroceria.rackPacas ? getExtraPrice('rackPacas') : 0) + (carroceria.ventEst * getExtraPrice('ventEst')) + (carroceria.ventCirc * getExtraPrice('ventCirc')) + (carroceria.polverasEspeciales ? getExtraPrice('polverasEspeciales') : 0) + (carroceria.puertaPerroCachucha ? getExtraPrice('puertaPerroCachucha') : 0);
    const totalMonturero = tipoRemolque === 'ganadero' && oMont.id !== 'ninguno' ? oMont.precio + (monturero.basesMontura * getExtraPrice('basesMontura')) + (monturero.tubosCobija * getExtraPrice('tubosCobija')) + (monturero.puertaPerro ? getExtraPrice('puertaPerroLateral') : 0) : 0;
    const totalAcabados = oPint.precio + oLuces.precio + (accesorios.lucesInteriores * getExtraPrice('lucesInteriores')) + (acabados.bodyLitros * getExtraPrice('litroBody')) + ((acabados.pinturaLitros + acabados.techoLitros) * getExtraPrice('litroPintura')) + (acabados.cajaHtas === 'std' ? getExtraPrice('cajaHtasStd') : acabados.cajaHtas === 'grande' ? getExtraPrice('cajaHtasGrande') : 0);
    const subtotalNeto = getExtraPrice('precioBase') + oLargo.precio + oAncho.precio + oJalon.precio + totalGatos + costoPisoTotal + totalRodado + (tipoRemolque === 'ganadero' ? totalCarroceria : oRedila.precio) + totalMonturero + totalAcabados + (['cama_baja', 'cama_alta'].includes(tipoRemolque) ? oRampa.precio : 0) + (tipoRemolque === 'cama_baja' && camaBajaOpts.fenderReforzado ? getExtraPrice('fenderReforzado') : 0) + (['cama_baja', 'cama_alta'].includes(tipoRemolque) && camaBajaOpts.luzPortaplaca ? getExtraPrice('luzPortaplaca') : 0);
    const subtotalDescuento = subtotalNeto * (1 - (cliente.descuentoPct || 0) / 100);
    const subtotalIva = market === 'usa' ? 0 : subtotalDescuento * 0.16;
    return subtotalDescuento + subtotalIva + (cliente.ajusteRedondeo || 0);
  };

  const handleGuardarCotizacion = () => {
    const totalCalc = calcularTotalActual();
    const nuevaCot = {
      id: `COT-${Math.floor(1000 + Math.random() * 9000)}`,
      fecha: new Date().toLocaleDateString('es-MX'),
      cliente: cliente.nombre || 'Mostrador',
      telefono: cliente.telefono || 'N/A',
      remolque: tipoRemolque.replace('_', ' ').toUpperCase(),
      medida: `${getObj(db.largos, dim.largo).valor}' x ${getObj(db.anchos, dim.ancho).valor}"`,
      total: formatoMoneda(totalCalc),
      vendedor: currentUser?.name || 'Ventas',
      config: { market, tipoRemolque, isSpecialClient, cliente, dim, acople, rodado, carroceria, monturero, acabados, accesorios, camaBajaOpts }
    };
    const updated = [nuevaCot, ...cotizaciones].slice(0, 200);
    setCotizaciones(updated);
    setDoc(doc(db_fs, getDocPath('cotizaciones')), { list: updated });
    logAction(`Guardó cotización ${nuevaCot.id}`);
    setNotification({ type: 'success', message: `Cotización ${nuevaCot.id} guardada con éxito.` });
  };

  const handleCargarCotizacion = (cot) => {
    if (cot.config) {
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
      setView('cotizador');
      setNotification({ type: 'success', message: `Cotización ${cot.id} cargada con éxito. Ya puedes reimprimirla o enviarla.` });
    } else {
      setNotification({ type: 'error', message: `La cotización ${cot.id} es de una versión anterior y no se puede recargar automáticamente.` });
    }
  };

  const handleEliminarCotizacion = (cotId) => {
    setConfirmDialog({ title: 'Eliminar Cotización', message: `¿Seguro que deseas borrar la cotización con folio ${cotId} del historial?`, action: 'DELETE_COTIZACION', payload: { id: cotId } });
  };

  const handleWhatsAppPDF = () => {
    const totalFinalAMostrar = formatoMoneda(calcularTotalActual());
    const texto = `Hola ${cliente.nombre || ''}, te comparto el resumen de tu cotización por un Remolque AMACSA ${tipoRemolque.replace('_', ' ').toUpperCase()}.\n\n*Total:* ${totalFinalAMostrar}\n\nTe envío el archivo PDF adjunto con todas las especificaciones a detalle. ¡Quedo a tus órdenes!`;
    
    // 1. Limpiamos el teléfono (quitamos letras, espacios, guiones)
    // Si no hay teléfono ingresado, el número quedará vacío.
    const numeroLimpio = cliente.telefono ? cliente.telefono.replace(/\D/g, '') : '';
    
    // 2. Construimos el enlace inteligente
    // Si hay un número, abrimos el chat directo. Si no, abrimos WhatsApp general con el texto preparado.
    let linkWhatsApp = '';
    if (numeroLimpio) {
        // Agregamos el prefijo '52' por defecto (México) si el número tiene 10 dígitos
        // Si ingresas un número de USA (10 dígitos), WhatsApp suele requerir el código de país.
        // Aquí asumimos México (+52) por defecto si metes 10 dígitos. 
        const numeroFinal = numeroLimpio.length === 10 ? `52${numeroLimpio}` : numeroLimpio;
        linkWhatsApp = `https://wa.me/${numeroFinal}?text=${encodeURIComponent(texto)}`;
    } else {
        linkWhatsApp = `https://wa.me/?text=${encodeURIComponent(texto)}`;
    }
    
    // 3. Abrimos WhatsApp AL INSTANTE en una nueva pestaña
    window.open(linkWhatsApp, '_blank');
    
    // 4. Lanzamos la ventana de Guardar como PDF
    setTimeout(() => {
      window.print();
    }, 500); 
  };

  // --- MATEMÁTICAS EN TIEMPO REAL ---
  const handleCant = (setter, field, delta, min = 0, max = Infinity) => setter(prev => ({ ...prev, [field]: Math.min(max, Math.max(min, prev[field] + delta)) }));
  const toggle = (setter, field) => setter(prev => ({ ...prev, [field]: !prev[field] }));

  const maxPuertasInt = (() => { const val = parseInt(dim.largo.replace('ft', '')); if (val <= 20) return 1; if (val <= 26) return 2; if (val <= 32) return 3; return 5; })();
  
  const oCap = getObj(db.capacidades, rodado.capacidad);
  let cantEjes = 2;
  if (tipoRemolque === 'cama_alta') { if (oCap.id === '6t') cantEjes = 2; if (oCap.id === '9t') cantEjes = 3; if (oCap.id === '10t') cantEjes = 2; } 
  else { if (['850kg', '1_5t', '1_5t_3500', '1_5t_5200', '3t'].includes(oCap.id)) cantEjes = 1; else if (['9t', '10t'].includes(oCap.id)) cantEjes = 3; }

// 1. Este es el control del Mercado (USA vs México) que tenías antes
  useEffect(() => {
    if (market === 'usa') { 
      setTipoRemolque('ganadero'); 
      setAcople(prev => ({ ...prev, sujetaCadenas: true, cadena: 'ganso_38' })); 
      setAcabados(prev => ({ ...prev, luces: 'estandar_usa' }));
    } 
    else if (market === 'mexico') { 
      setIsSpecialClient(false); 
      setAcabados(prev => ({ ...prev, luces: 'estandar_mexico' }));
    }
  }, [market]);

  // 2. Este es el control NUEVO para el tipo de frente del Ganadero
  useEffect(() => {
    if (tipoRemolque === 'ganadero') {
      if (tipoGanadero === 'redondo') {
        setCarroceria(prev => ({ ...prev, frente: 'ninguno' }));
      } else {
        setCarroceria(prev => ({ ...prev, frente: 'cachucha' }));
      }
    }
  }, [tipoRemolque, tipoGanadero]);

  useEffect(() => {
    if (tipoRemolque === 'cama_baja') {
      const combos = CAMA_BAJA_COMBOS;
      if (!combos[dim.ancho]) setDim(prev => ({ ...prev, ancho: '82in', largo: '16ft' }));
      else if (!combos[dim.ancho].includes(dim.largo)) setDim(prev => ({ ...prev, largo: combos[dim.ancho][0] }));
      
      const validCaps = getCapacidadesCamaBaja(dim.ancho, dim.largo);
      if (validCaps.length > 0 && !validCaps.includes(rodado.capacidad)) setRodado(prev => ({ ...prev, capacidad: validCaps[0] }));
      if (rodado.portaExtra < 1) setRodado(prev => ({ ...prev, portaExtra: 1 }));
      
      const currentJalon = db.jalones?.find(j => j.id === acople.jalon);
      if (currentJalon && currentJalon.tipo === 'ganso') {
        const firstBumper = db.jalones?.find(j => j.id === 'bumper_2_516' || j.tipo !== 'ganso');
        if (firstBumper) setAcople(prev => ({ ...prev, jalon: firstBumper.id }));
      }

      let requiredGato = acople.gato; let requiredSusp = rodado.suspension; let validGatos = [];
      if (rodado.capacidad === '850kg') { validGatos = ['tubo_2k']; requiredSusp = 'susp_1_5t'; } 
      else if (['1_5t', '1_5t_3500', '1_5t_5200'].includes(rodado.capacidad)) { validGatos = ['normal_2k']; requiredSusp = 'susp_1_5t'; } 
      else if (rodado.capacidad === '3t') {
          validGatos = ['normal_2k', 'manual_7k'];
          if (carroceria.redila === 'sin_redila' && !validGatos.includes(acople.gato)) requiredGato = 'manual_7k';
          else if (carroceria.redila !== 'sin_redila' && !validGatos.includes(acople.gato)) requiredGato = 'normal_2k';
          requiredSusp = 'susp_3t';
      } 
      else if (rodado.capacidad === '4t') { validGatos = ['manual_7k']; requiredSusp = 'susp_3t'; } 
      else if (rodado.capacidad === '6t') { validGatos = ['manual_7k', 'manual_12k']; if (carroceria.redila === 'sin_redila') requiredGato = 'manual_12k'; requiredSusp = 'susp_6t'; }
      if (!validGatos.includes(requiredGato)) requiredGato = validGatos[0] || 'normal_2k';
      setAcople(prev => ({ ...prev, gato: requiredGato }));
      setRodado(prev => ({ ...prev, suspension: requiredSusp }));

    } else if (tipoRemolque === 'cama_alta') {
      setDim(prev => ({ ...prev, ancho: '96in', largo: CAMA_ALTA_LARGOS.includes(prev.largo) ? prev.largo : '20ft' }));
      setCarroceria(prev => ({ ...prev, redila: 'sin_redila', frente: 'ninguno' }));
      setAcabados(prev => ({ ...prev, pintura: 'liquida' })); 
      if (rodado.portaExtra < 1) setRodado(prev => ({ ...prev, portaExtra: 1 }));
      if (!CAMA_ALTA_CAPS.includes(rodado.capacidad)) setRodado(prev => ({ ...prev, capacidad: '6t' }));
      if (!['manual_12k', 'hidraulico_sencillo', 'hidraulico_bomba'].includes(acople.gato)) setAcople(prev => ({ ...prev, gato: 'manual_12k' }));
      if (!['recto_rampas', 'cola_4', 'cola_5'].includes(camaBajaOpts.rampas)) setCamaBajaOpts(prev => ({ ...prev, rampas: 'recto_rampas' }));
      if (!['madera', 'lamina_madera'].includes(acabados.piso)) setAcabados(prev => ({ ...prev, piso: 'madera' }));
      const currentJalon = db.jalones?.find(j => j.id === acople.jalon);
      if (currentJalon && !['ganso_normal', 'ganso_facil', 'argolla'].includes(currentJalon.id)) { setAcople(prev => ({ ...prev, jalon: 'ganso_facil' })); }
    
    } else if (tipoRemolque === 'volteo') {
      // 1. Validar combinaciones de Ancho y Largo para Volteo
      if (!VOLTEO_COMBOS[dim.ancho]) {
        setDim(prev => ({ ...prev, ancho: '76in', largo: '12ft' }));
      } else if (!VOLTEO_COMBOS[dim.ancho].includes(dim.largo)) {
        setDim(prev => ({ ...prev, largo: VOLTEO_COMBOS[dim.ancho][0] }));
      }

      // 2. Validar Capacidades según el Ancho elegido
      if (dim.ancho === '60in') {
        if (!['1_5t', '3t', '6t'].includes(rodado.capacidad)) setRodado(prev => ({ ...prev, capacidad: '3t' }));
      } else {
        // Para 76in y 82in solo se permite de 3 o 6 toneladas
        if (!['3t', '6t'].includes(rodado.capacidad)) setRodado(prev => ({ ...prev, capacidad: '3t' }));
      }

      // 3. Forzar Gato de 12,000 lbs obligado para volteos
      if (acople.gato !== 'manual_12k') {
        setAcople(prev => ({ ...prev, gato: 'manual_12k' }));
      }
      // Si es capacidad de 6 toneladas, por defecto asignamos 2 gatos de 12k
      if (rodado.capacidad === '6t' && acople.cantGatos < 2) {
        setAcople(prev => ({ ...prev, cantGatos: 2 }));
      }

      // 4. Caja de Herramientas OBLIGATORIA (No permitimos 'ninguna')
      if (acabados.cajaHtas === 'ninguna') {
        setAcabados(prev => ({ ...prev, cajaHtas: 'std' }));
      }

      // 5. Si lleva llanta de refacción (llantaExtra > 0), obligamos a que lleve portaextra
      if (rodado.llantaExtra > 0 && rodado.portaExtra < 1) {
        setRodado(prev => ({ ...prev, portaExtra: 1 }));
      }

    } else {
      const GANADERO_CAPS = ['3t', '6t', '7t', '9t', '10t'];
      if (!GANADERO_CAPS.includes(rodado.capacidad)) setRodado(prev => ({ ...prev, capacidad: '6t' }));
    }
    // Aseguramos que el efecto escuche los cambios clave del volteo
  }, [tipoRemolque, dim.ancho, dim.largo, rodado.capacidad, carroceria.redila, db.jalones, acople.jalon, rodado.llantaExtra]);

  useEffect(() => {
    if (carroceria.cantPtasInt > maxPuertasInt) setCarroceria(prev => ({ ...prev, cantPtasInt: maxPuertasInt }));
    if (rodado.cantFrenos > cantEjes) setRodado(prev => ({ ...prev, cantFrenos: cantEjes }));
  }, [dim.largo, maxPuertasInt, cantEjes, tipoRemolque]);

  useEffect(() => {
    if (tipoRemolque === 'cama_alta' && acople.gato.includes('hidraulico') && acabados.cajaHtas === 'ninguna') { setAcabados(prev => ({ ...prev, cajaHtas: 'std' })); }
    if (tipoRemolque === 'ganadero') {
        const l = parseInt(dim.largo.replace('ft', '')) || 0;
        let cajas = 0;
        if (acabados.pintura === 'polvo') { if (l <= 16) cajas = 0.75; else if (l <= 20) cajas = 1; else if (l <= 23) cajas = 1.5; else if (l <= 32) cajas = 2; else if (l <= 36) cajas = 2.5; else cajas = 3; }
        if (isSpecialClient && market === 'usa') {
          setAcabados(prev => ({ ...prev, pintura: 'liquida', luces: 'especial_usa', cajasPolvo: 0 }));
          setCarroceria(prev => ({ ...prev, polverasEspeciales: true }));
          setRodado(prev => ({ ...prev, suspension: 'torflex' }));
          setAccesorios(prev => ({ ...prev, lucesInteriores: prev.lucesInteriores > 0 ? prev.lucesInteriores : 1 }));
          let b = 0, p = 0, t = 0;
          if (l <= 16) p = 14.2125; else if (l <= 18) p = 18.95; else if (l <= 20) p = 23.6875; else if (l <= 28) p = 28.425; else if (l <= 32) p = 33.1625; else p = 37.9;
          if (carroceria.techo === 'sin_techo' || carroceria.techo === 'lona' || acabados.mismoColorTecho) t = 0; else { if (l <= 16) t = 2.36875; else t = 4.7375; }
          if (l <= 16) b = 10; else if (l <= 18) b = 12; else if (l <= 22) b = 12; else if (l <= 26) b = 14; else if (l <= 28) b = 15; else b = 16;
          setAcabados(prev => ({ ...prev, bodyLitros: b, pinturaLitros: p, techoLitros: t }));
        } else {
          setCarroceria(prev => ({ ...prev, polverasEspeciales: false }));
          setAcabados(prev => ({ ...prev, cajasPolvo: cajas }));
          if (acople.gato === 'hidraulico_bomba') setAcople(prev => ({ ...prev, gato: 'hidraulico_sencillo' }));
        }
    }
  }, [isSpecialClient, market, tipoRemolque, dim.largo, acabados.pintura, acabados.mismoColorTecho, acople.gato, acabados.cajaHtas]);

  useEffect(() => {
    if (acople.gato === 'manual' || acople.gato.includes('2k') || acople.gato.includes('7k') || acople.gato.includes('12k')) { setAcople(prev => ({ ...prev, cargadorSolar: false, cargador110: false })); } 
    else if (acople.gato.includes('hidraulico')) {
      if (isSpecialClient && market === 'usa') setAcople(prev => ({ ...prev, cargadorSolar: true, cargador110: true }));
      if (acople.gato === 'hidraulico_bomba' && acabados.cajaHtas === 'ninguna') setAcabados(prev => ({ ...prev, cajaHtas: 'std' }));
    }
  }, [acople.gato, isSpecialClient, market]);

  useEffect(() => {
    if (rodado.llantaExtra > rodado.portaExtra && tipoRemolque !== 'ganadero') { setRodado(prev => ({ ...prev, portaExtra: prev.llantaExtra })); }
    if (tipoRemolque === 'cama_alta' && rodado.capacidad === '10t' && rodado.llanta !== '17_5in') setRodado(prev => ({...prev, llanta: '17_5in'}));
  }, [rodado.llantaExtra, rodado.portaExtra, tipoRemolque, rodado.capacidad, rodado.llanta]);

  const anchosDisponibles = tipoRemolque === 'volteo' ? db.anchos?.filter(a => ['60in', '76in', '82in'].includes(a.id)) || [] : tipoRemolque === 'cama_baja' ? db.anchos?.filter(a => Object.keys(CAMA_BAJA_COMBOS).includes(a.id)) || [] : tipoRemolque === 'cama_alta' ? db.anchos?.filter(a => a.id === '96in') || [] : db.anchos?.filter(a => !['50in', '75in', '76in', '82in'].includes(a.id)) || [];
  const largosDisponibles = tipoRemolque === 'volteo' && VOLTEO_COMBOS[dim.ancho] ? db.largos?.filter(l => VOLTEO_COMBOS[dim.ancho].includes(l.id)) || [] : tipoRemolque === 'cama_baja' && CAMA_BAJA_COMBOS[dim.ancho] ? db.largos?.filter(l => CAMA_BAJA_COMBOS[dim.ancho].includes(l.id)) || [] : tipoRemolque === 'cama_alta' ? db.largos?.filter(l => CAMA_ALTA_LARGOS.includes(l.id)) || [] : db.largos?.filter(l => l.valor >= 16) || [];
  const capacidadesDisponibles = tipoRemolque === 'volteo' ? db.capacidades?.filter(c => dim.ancho === '60in' ? ['1_5t', '3t', '6t'].includes(c.id) : ['3t', '6t'].includes(c.id)) || [] : tipoRemolque === 'cama_baja' ? db.capacidades?.filter(c => getCapacidadesCamaBaja(dim.ancho, dim.largo).includes(c.id)) || [] : tipoRemolque === 'cama_alta' ? db.capacidades?.filter(c => CAMA_ALTA_CAPS.includes(c.id)) || [] : db.capacidades?.filter(c => ['3t', '6t', '7t', '9t', '10t'].includes(c.id)) || [];
  const jalonesDisponibles = tipoRemolque === 'volteo' ? db.jalones?.filter(j => ['bumper_2', 'bumper_2_516', 'bumper_ajustable_2', 'bumper_ajustable_2_516', 'argolla', 'ganso_normal', 'ganso_facil'].includes(j.id)) || [] : tipoRemolque === 'cama_baja' ? db.jalones?.filter(j => j.tipo !== 'ganso') || [] : tipoRemolque === 'cama_alta' ? db.jalones?.filter(j => ['ganso_normal', 'ganso_facil', 'argolla'].includes(j.id)) || [] : db.jalones || [];
  const gatosDisponibles = tipoRemolque === 'volteo' ? db.gatos?.filter(g => g.id === 'manual_12k') || [] : tipoRemolque === 'cama_baja' ? db.gatos?.filter(g => { const cap = rodado.capacidad; if (cap === '850kg') return g.id === 'tubo_2k'; if (['1_5t', '1_5t_3500', '1_5t_5200'].includes(cap)) return g.id === 'normal_2k'; if (cap === '3t') return ['normal_2k', 'manual_7k'].includes(g.id); if (cap === '4t') return g.id === 'manual_7k'; if (cap === '6t') return ['manual_7k', 'manual_12k'].includes(g.id); return true; }) || [] : tipoRemolque === 'cama_alta' ? db.gatos?.filter(g => ['manual_12k', 'hidraulico_sencillo', 'hidraulico_bomba'].includes(g.id)) || [] : db.gatos?.filter(g => (isSpecialClient || g.id !== 'hidraulico_bomba') && !['tubo_2k','normal_2k','manual_7k','manual_12k'].includes(g.id)) || [];
  const suspensionesDisponibles = tipoRemolque === 'volteo' ? db.suspension?.filter(s => ['susp_1_5t', 'susp_3t', 'susp_6t'].includes(s.id)) || [] : tipoRemolque === 'cama_baja' ? db.suspension?.filter(s => ['susp_1_5t', 'susp_3t', 'susp_6t'].includes(s.id)) || [] : db.suspension?.filter(s => ['muelle', 'torflex'].includes(s.id)) || [];
  const llantasDisponibles = tipoRemolque === 'cama_baja' ? db.llantas?.filter(l => { const cap = rodado.capacidad; if (['850kg', '1_5t', '1_5t_3500', '1_5t_5200'].includes(cap)) return ['700_15', '225_75_15', 'ninguna'].includes(l.id); if (cap === '3t') return ['700_15', '235_80_16', 'ninguna'].includes(l.id); if (cap === '4t') return ['225_75_15', 'ninguna'].includes(l.id); if (cap === '6t') return ['235_80_16', '235_80_16_14', 'ninguna'].includes(l.id); return true; }) || [] : tipoRemolque === 'cama_alta' ? db.llantas?.filter(l => rodado.capacidad === '10t' ? ['17_5in', 'ninguna'].includes(l.id) : ['235_80_16', '16in_10', '16in_14', '235_80_16_14', 'ninguna'].includes(l.id)) || [] : db.llantas?.filter(l => ['16in_10', '16in_14', '235_80_16_14', '17_5in', 'ninguna'].includes(l.id)) || [];
  const pisosDisponibles = tipoRemolque === 'volteo' ? db.pisos?.filter(p => ['madera', 'lamina_madera'].includes(p.id)) || [] : tipoRemolque === 'cama_baja' ? db.pisos?.filter(p => ['madera', 'duela_laminada'].includes(p.id)) || [] : tipoRemolque === 'cama_alta' ? db.pisos?.filter(p => ['madera', 'lamina_madera'].includes(p.id)) || [] : db.pisos?.filter(p => ['madera', 'hule_liso', 'hule_anti'].includes(p.id)) || [];
  const redilasDisponibles = tipoRemolque === 'cama_baja' ? db.redilas?.filter(r => ['sin_redila', 'ptr_abierta_2', 'ptr_abierta_3', 'ptr_abierta_4', 'cerrada_2', 'cerrada_3', 'cerrada_4'].includes(r.id)) || [] : db.redilas?.filter(r => ['ptr_abierta', 'cerrada'].includes(r.id)) || [];
  const rampasDisponibles = tipoRemolque === 'cama_baja' ? db.rampas?.filter(r => { if (r.id === 'ninguna' || r.id === 'puerta_rampa') return true; const is82 = dim.ancho === '82in'; if (r.id === 'rampa_1_5m') return is82 && carroceria.redila === 'sin_redila'; if (r.id === 'rampa_39') return is82 && carroceria.redila !== 'sin_redila'; return false; }) || [] : tipoRemolque === 'cama_alta' ? db.rampas?.filter(r => ['recto_rampas', 'cola_4', 'cola_5'].includes(r.id)) || [] : [];
  const oLargo = getObj(db.largos, dim.largo); const oAncho = getObj(db.anchos, dim.ancho); const oJalon = getObj(db.jalones, acople.jalon); const oCadena = getObj(db.cadenas, acople.cadena); const oGato = getObj(db.gatos, acople.gato); const oSusp = getObj(db.suspension, rodado.suspension); const oLlantas = getObj(db.llantas, rodado.llanta); const oTecho = getObj(db.techos, carroceria.techo); const oRedila = getObj(db.redilas, carroceria.redila); const oPInt = getObj(db.puertasInteriores, carroceria.puertaInt); const oPTras = getObj(db.puertasTraseras, carroceria.puertaTras); const oPiso = getObj(db.pisos, acabados.piso); const oMont = getObj(db.montureros, monturero.tipo); const oPint = getObj(db.pinturas, acabados.pintura); const oLuces = getObj(db.luces, acabados.luces); const oRampa = db.rampas?.find(r => r.id === camaBajaOpts.rampas) || {precio: 0};
  const lucesDisponibles = db.luces?.filter(l => market === 'usa' ? l.id.includes('_usa') : l.id.includes('_mexico')) || [];
  const anchoEnPies = (oAncho.valor || 0) / 12;
  const areaSqFt = (oLargo.valor || 0) * anchoEnPies;
  const costoPisoTotal = areaSqFt * (oPiso.precioSqFt || oPiso.precio || 0) * (oPiso.id === 'madera' ? 2 : 1);

  let costoGatos = acople.gato === 'hidraulico_bomba' ? ((db.gatos?.find(g => g.id === 'hidraulico_sencillo')?.precio || 6500) * acople.cantGatos) + (oGato.precio - (db.gatos?.find(g => g.id === 'hidraulico_sencillo')?.precio || 6500)) : oGato.precio * acople.cantGatos;
  const totalGatos = costoGatos + (acople.cargadorSolar ? 2500 : 0) + (acople.cargador110 ? 1500 : 0) + (acople.sujetaCadenas ? 450 : 0) + (oCadena.precio || 0);

  const totalRodado = oCap.precio + oSusp.precio + oLlantas.precio + (rodado.cantFrenos > 0 ? getExtraPrice('frenos') * rodado.cantFrenos : 0) + (rodado.llantaExtra > 0 ? (rodado.llantaExtra * (oLlantas.precioExtra || 0)) : 0) + (rodado.portaExtra * getExtraPrice('portaExtra'));
  
  let piesPlexi = (oLargo.valor || 0) * 4;
  if (oMont.id === 'recto_3') piesPlexi -= 12; else if (oMont.id === 'recto_4') piesPlexi -= 16; else if (oMont.id === 'diagonal') piesPlexi -= (((monturero.paredLarga || 0) + (monturero.paredCorta || 0)) / 12 * 2);
  if (carroceria.puertaPiloto) piesPlexi -= ((carroceria.puertaPilotoAncho || 0) / 12) * 4;
  if (carroceria.frente === 'cachucha' && carroceria.puertaPerroCachucha) piesPlexi -= 13.33;
  if (monturero.puertaPerro) piesPlexi -= 13.33;
  
  const totalCarroceria = oTecho.precio + oRedila.precio + (oPInt.precio * carroceria.cantPtasInt) + oPTras.precio + (carroceria.frente === 'cachucha' ? getExtraPrice('frenteCachucha') : carroceria.frente === 'canasta' ? getExtraPrice('frenteCanasta') : 0) + (carroceria.plexiglass && piesPlexi > 0 ? Math.ceil(piesPlexi / 46.5) * getExtraPrice('hojaPlexiglass') : 0) + (carroceria.rackPacas ? getExtraPrice('rackPacas') : 0) + (carroceria.ventEst * getExtraPrice('ventEst')) + (carroceria.ventCirc * getExtraPrice('ventCirc')) + (carroceria.polverasEspeciales ? getExtraPrice('polverasEspeciales') : 0) + (carroceria.puertaPerroCachucha ? getExtraPrice('puertaPerroCachucha') : 0);

  const totalMonturero = tipoRemolque === 'ganadero' && oMont.id !== 'ninguno' ? oMont.precio + (monturero.basesMontura * getExtraPrice('basesMontura')) + (monturero.tubosCobija * getExtraPrice('tubosCobija')) + (monturero.puertaPerro ? getExtraPrice('puertaPerroLateral') : 0) : 0;
  const totalAcabados = oPint.precio + oLuces.precio + (accesorios.lucesInteriores * getExtraPrice('lucesInteriores')) + (acabados.bodyLitros * getExtraPrice('litroBody')) + ((acabados.pinturaLitros + acabados.techoLitros) * getExtraPrice('litroPintura')) + (acabados.cajaHtas === 'std' ? getExtraPrice('cajaHtasStd') : acabados.cajaHtas === 'grande' ? getExtraPrice('cajaHtasGrande') : 0);

  const subtotalNeto = getExtraPrice('precioBase') + oLargo.precio + oAncho.precio + oJalon.precio + totalGatos + costoPisoTotal + totalRodado + (tipoRemolque === 'ganadero' ? totalCarroceria : oRedila.precio) + totalMonturero + totalAcabados + (['cama_baja', 'cama_alta'].includes(tipoRemolque) ? oRampa.precio : 0) + (tipoRemolque === 'cama_baja' && camaBajaOpts.fenderReforzado ? getExtraPrice('fenderReforzado') : 0) + (['cama_baja', 'cama_alta'].includes(tipoRemolque) && camaBajaOpts.luzPortaplaca ? getExtraPrice('luzPortaplaca') : 0);

  const subtotalDescuento = subtotalNeto * (1 - (cliente.descuentoPct || 0) / 100);
  const subtotalIva = market === 'usa' ? 0 : subtotalDescuento * 0.16;
  const totalPrevio = subtotalDescuento + subtotalIva;
  const totalFinal = totalPrevio + (cliente.ajusteRedondeo || 0);
  const saldoPendiente = totalFinal - (cliente.anticipo || 0);

  let capacidadLbs = '7,000 LBS';
  if (tipoRemolque === 'cama_alta') { if (oCap.id === '6t') capacidadLbs = '7,000 LBS'; if (oCap.id === '9t') capacidadLbs = '7,000 LBS'; if (oCap.id === '10t') capacidadLbs = '10,000 LBS'; } 
  else { if (['7t', '9t'].includes(oCap.id)) capacidadLbs = '8,000 LBS'; else if (oCap.id === '10t') capacidadLbs = '10,000 LBS'; else if (['850kg', '1_5t', '1_5t_3500', '3t'].includes(oCap.id)) capacidadLbs = '3,500 LBS'; else if (['1_5t_5200', '4t'].includes(oCap.id)) capacidadLbs = '5,200 LBS'; else if (oCap.id === '6t') capacidadLbs = '6,000 / 7,000 LBS'; }

  let marcaEje = rodado.suspension === 'torflex' ? 'IMPORTADO TORFLEX' : (capacidadLbs === '10,000 LBS' ? 'LIPPERT' : 'DEXTER');
  let medidasEje = '';
  if (tipoRemolque === 'cama_alta') { 
    if (oCap.id === '10t') medidasEje = 'C/F 48" Doble Rodado'; else medidasEje = 'C/F 67"'; 
  } else if (tipoRemolque === 'volteo') {
    // REGLAS EXACTAS DE VOLTEO (58", 74", 80")
    if (dim.ancho === '60in') medidasEje = 'C/F 58"';
    else if (dim.ancho === '76in') medidasEje = 'C/F 74"';
    else if (dim.ancho === '82in') medidasEje = 'C/F 80"';
  } else { 
    if (rodado.suspension === 'torflex') medidasEje = (oAncho.valor >= 78) ? 'C/F 78.5' : 'C/F 60.5'; 
    else if (capacidadLbs === '10,000 LBS') medidasEje = 'C/F HF=91 OB=68.25'; 
    else { if (oAncho.valor === 60) medidasEje = 'C/F HF=76 OB=60.5'; else if (oAncho.valor === 72 && capacidadLbs === '8,000 LBS') medidasEje = 'C/F HF=87.88 OB=72.5'; else if (oAncho.valor === 72) medidasEje = 'C/F HF=76 OB=60.5'; else medidasEje = 'C/F HF=93.25 OB=78.5'; } 
  }
  const nombreEjeCompleto = `EJE ${marcaEje} ${capacidadLbs} ${medidasEje}`;
  const calcLargoPulgadas = (oLargo.valor || 0) * 12;
  const cableAzulMts = rodado.cantFrenos > 0 ? (calcLargoPulgadas + 96 + (rodado.cantFrenos * oAncho.valor)) * 0.0254 : 0;
  
  let llantasPorEje = (tipoRemolque === 'cama_alta' && rodado.capacidad === '10t') ? 4 : 2;
  let cantLlantasTotal = (cantEjes * llantasPorEje) + rodado.llantaExtra;
  const hojasPlexiCalculadas = carroceria.plexiglass && piesPlexi > 0 ? Math.ceil(piesPlexi / (Math.floor(96 / 8.25) * 4)) : 0;

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
              <div className="relative"><User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" /><input type="text" value={loginUser} onChange={(e) => setLoginUser(e.target.value)} className="w-full p-3 pl-10 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-medium" placeholder="ej. admin" /></div>
            </div>
            <div className="mb-6">
              <label className="block text-sm font-bold text-slate-700 mb-2">Contraseña</label>
              <div className="relative"><Key className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" /><input type="password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} className="w-full p-3 pl-10 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-medium" placeholder="••••••••" /></div>
              {loginError && <p className="text-red-500 text-sm font-bold mt-2">{loginError}</p>}
            </div>
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-black py-3 rounded-lg transition">Ingresar al Sistema</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 print:bg-white font-sans pb-12">
      {notification && (
        <div className="fixed inset-0 bg-slate-900/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-sm w-full text-center z-50">
            <div className={`mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-4 ${notification.type === 'error' ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}><Shield className="w-6 h-6" /></div>
            <h3 className="text-xl font-black mb-2 text-slate-800">{notification.type === 'error' ? 'Aviso Importante' : '¡Éxito!'}</h3>
            <p className="text-slate-600 font-medium mb-6">{notification.message}</p>
            <button onClick={() => setNotification(null)} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-bold w-full transition">Entendido</button>
          </div>
        </div>
      )}

      {confirmDialog && (
        <div className="fixed inset-0 bg-slate-900/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-sm w-full text-center z-50">
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
          <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-sm w-full z-50">
            <div className="text-center mb-6"><div className="mx-auto w-12 h-12 rounded-full flex items-center justify-center mb-3 bg-slate-100 text-slate-700"><Settings className="w-6 h-6" /></div><h3 className="text-xl font-black text-slate-800">Candado de Seguridad</h3><p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">Acceso a Catálogo</p></div>
            <form onSubmit={handleUnlockSubmit}>
               <input type="password" autoFocus value={adminUnlockPass} onChange={e => setAdminUnlockPass(e.target.value)} className="w-full p-3.5 border-2 border-slate-200 focus:border-blue-500 rounded-xl mb-6 text-center tracking-[0.5em] font-black text-lg outline-none transition" placeholder="••••••••" />
               <div className="flex space-x-3">
                 <button type="button" onClick={() => setAdminUnlockPrompt(false)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-3 rounded-xl font-bold transition">Volver</button>
                 <button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-xl font-black transition shadow-lg shadow-blue-500/30">Desbloquear</button>
               </div>
            </form>
          </div>
        </div>
      )}

      {/* HEADER PRINCIPAL */}
      <header className="bg-slate-900 text-white p-4 sticky top-0 z-50 flex justify-between items-center shadow-md print:hidden">
        <div className="flex items-center space-x-3">
          <div className="relative h-10 flex items-center justify-center min-w-[40px] bg-slate-800 rounded-lg p-1"><img src="/logo_amacsa.png" alt="AMACSA" className="h-12 object-contain" /></div>
          <div><h1 className="text-xl font-black tracking-wider leading-tight text-white">AMACSA</h1><p className="text-xs text-amber-500 font-bold tracking-widest uppercase">ERP Ventas</p></div>
        </div>
        <div className="flex items-center space-x-3">
          <div className="hidden sm:block text-right mr-2"><p className="text-xs text-slate-400">Usuario activo</p><p className="text-sm font-bold text-white">{currentUser.name}</p></div>
          {view === 'cotizador' ? (
            <>
              <button onClick={handleNuevaCotizacion} className="flex items-center space-x-1 bg-red-600 hover:bg-red-500 px-3 py-2 rounded text-sm font-bold transition text-white" title="Nueva cotización de fábrica"><RefreshCw className="w-4 h-4"/> <span className="hidden md:inline">Nueva Cot.</span></button>
              <button onClick={handleAdminAccess} className={`flex items-center space-x-1 px-4 py-2 rounded text-sm font-bold transition text-white ${isAppUnlocked ? 'bg-red-600 hover:bg-red-500' : 'bg-slate-800 hover:bg-slate-700'}`}>
                {isAppUnlocked ? <><Unlock className="w-4 h-4"/> <span className="hidden md:inline">Cerrar Catálogo</span></> : <><Lock className="w-4 h-4"/> <span className="hidden md:inline">Panel Historial</span></>}
              </button>
              <button onClick={() => window.print()} className="flex items-center space-x-1 bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded text-sm font-bold transition text-white"><Printer className="w-4 h-4"/> <span>Imprimir</span></button>
            </>
          ) : (
            <button onClick={() => setView('cotizador')} className="flex items-center space-x-1 bg-green-600 hover:bg-green-500 px-4 py-2 rounded text-sm font-bold transition text-white"><Save className="w-4 h-4"/> <span>Volver a Ventas</span></button>
          )}
          <button onClick={handleLogout} className="flex items-center space-x-1 bg-slate-800 hover:bg-red-600 px-3 py-2 rounded text-sm font-bold transition text-slate-400 hover:text-white"><LogOut className="w-4 h-4"/></button>
        </div>
      </header>

      {view === 'admin' ? (
        <div className="max-w-[1400px] mx-auto p-4 sm:p-6 flex flex-col md:flex-row gap-6 print:hidden">
          <div className="w-full md:w-1/4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
            <h2 className="text-lg font-black text-slate-800 mb-4 border-b pb-2">Panel de Control</h2>
            <div className="flex flex-col space-y-1 h-[75vh] overflow-y-auto pr-2">
              <div className="text-xs font-black text-slate-400 uppercase tracking-widest mt-2 mb-1 px-4">Historial</div>
              <button onClick={() => setAdminSection('cotizaciones')} className={`flex items-center text-left px-4 py-3 rounded-lg text-sm font-bold transition ${adminSection === 'cotizaciones' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}><FileText className="w-4 h-4 mr-2"/> Cotizaciones Guardadas</button>
              
              <div className="text-xs font-black text-slate-400 uppercase tracking-widest mt-6 mb-1 px-4">Inventario y Precios</div>
              {ADMIN_SECTIONS.map(sec => (
                <button key={sec.id} onClick={() => setAdminSection(sec.id)} className={`text-left px-4 py-3 rounded-lg text-sm font-bold transition ${adminSection === sec.id ? 'bg-blue-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'}`}>{sec.title}</button>
              ))}

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
             {adminSection === 'cotizaciones' ? (
                <div>
                   <h2 className="text-2xl font-black text-slate-800 border-b pb-3 mb-6">Cotizaciones Guardadas</h2>
                   <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[70vh]">
                     <table className="w-full text-left text-sm">
                       <thead className="bg-slate-100 text-slate-600 font-bold sticky top-0 shadow-sm"><tr><th className="p-3 border-b">Folio</th><th className="p-3 border-b">Fecha</th><th className="p-3 border-b">Cliente</th><th className="p-3 border-b">Remolque</th><th className="p-3 border-b text-right">Total Net</th><th className="p-3 border-b text-center">Acciones</th></tr></thead>
                       <tbody>
                         {cotizaciones.length === 0 ? <tr><td colSpan="6" className="p-6 text-center text-slate-500">No hay cotizaciones registradas en la nube.</td></tr> : cotizaciones.map((cot, i) => (
                           <tr key={i} className="border-b last:border-0 hover:bg-slate-50">
                             <td className="p-3 font-black text-blue-700">{cot.id}</td><td className="p-3 text-slate-600 font-medium">{cot.fecha}</td><td className="p-3 font-bold text-slate-800">{cot.cliente}</td><td className="p-3 text-slate-600">{cot.remolque} ({cot.medida})</td><td className="p-3 font-black text-slate-800 text-right">{cot.total}</td>
                             <td className="p-3 text-center space-x-2 whitespace-nowrap">
                                <button onClick={() => handleCargarCotizacion(cot)} className="bg-blue-50 hover:bg-blue-100 text-blue-600 px-3 py-1 rounded text-xs font-black transition border border-blue-200 shadow-sm">Cargar / Reimprimir</button>
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
                      <div className="text-right pt-2"><button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg text-sm font-bold shadow-sm">Guardar Cambios</button></div>
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
                            <td className="p-3"><span className={`px-2 py-1 rounded text-xs font-bold ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>{u.role === 'admin' ? 'Administrador' : 'Ventas'}</span></td>
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
                            <div className="sm:w-1/4 font-black text-blue-700 flex items-center"><User className="w-3 h-3 mr-1 inline"/> {log.user}</div>
                            <div className="sm:w-2/4 text-slate-700 leading-tight">{log.action}</div>
                          </div>
                        ))
                      )}
                   </div>
                </div>
             ) : (
              <>
                <div className="flex justify-between items-center mb-6 border-b pb-3">
                  <h2 className="text-2xl font-black text-slate-800">{ADMIN_SECTIONS.find(s => s.id === adminSection)?.title}</h2>
                  {!ADMIN_SECTIONS.find(s => s.id === adminSection)?.isFixed && (
                    <button onClick={() => handleDbAdd(adminSection)} className="flex items-center space-x-1 bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-bold transition shadow-sm"><Plus className="w-5 h-5"/> <span>Agregar Elemento</span></button>
                  )}
                </div>
                <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-2">
                  {db[adminSection]?.map((item, index) => {
                    const sectionDef = ADMIN_SECTIONS.find(s => s.id === adminSection);
                    return (
                      <div key={item.id || index} className="flex flex-wrap items-center gap-4 p-4 bg-slate-50 border border-slate-200 rounded-xl hover:shadow-sm transition">
                        <div className="flex-1 min-w-[200px]"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Nombre Comercial</label><input type="text" value={item.nombre} onChange={e => handleDbChange(adminSection, index, 'nombre', e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-md font-bold text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                        {sectionDef?.hasValor && (<div className="w-24"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">{sectionDef.valorLabel}</label><input type="number" value={item.valor || 0} onChange={e => handleDbChange(adminSection, index, 'valor', parseFloat(e.target.value) || 0)} className="w-full p-2.5 border border-slate-300 rounded-md font-bold text-slate-800 text-center focus:ring-2" /></div>)}
                        {sectionDef?.hasPrecioExtra && (<div className="w-36"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Precio Extra (MXN)</label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">$</span><input type="number" value={item.precioExtra || 0} onChange={e => handleDbChange(adminSection, index, 'precioExtra', parseFloat(e.target.value) || 0)} className="w-full p-2.5 pl-7 border border-slate-300 rounded-md font-bold" /></div></div>)}
                        {!sectionDef?.isColor && (<div className="w-36"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">{sectionDef?.isPiso ? 'Precio x SqFt' : 'Precio Set (MXN)'}</label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">$</span><input type="number" value={sectionDef?.isPiso ? (item.precioSqFt || 0) : (item.precio || 0)} onChange={e => handleDbChange(adminSection, index, sectionDef?.isPiso ? 'precioSqFt' : 'precio', parseFloat(e.target.value) || 0)} className="w-full p-2.5 pl-7 border border-slate-300 rounded-md font-black text-blue-700 text-right" /></div></div>)}
                        {!sectionDef?.isFixed && (<div className="pt-5"><button onClick={() => handleDbDelete(adminSection, index)} className="p-2.5 bg-white border border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 rounded-lg transition shadow-sm"><Trash2 className="w-5 h-5"/></button></div>)}
                      </div>
                    );
                  })}
                </div>
              </>
             )}
          </div>
        </div>
      ) : (
        <main className="max-w-[1400px] mx-auto p-4 sm:p-6 flex flex-col xl:flex-row gap-6 print:block">
          <div className="w-full xl:w-2/3 space-y-6 print:hidden">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* BOTONES USA / MEXICO (INTACTOS) */}
                <div className="p-1.5 bg-slate-200 rounded-xl flex items-center shadow-inner">
                    <button onClick={() => setMarket('usa')} className={`flex-1 py-3 px-4 rounded-lg font-black text-sm flex items-center justify-center transition-all ${market === 'usa' ? 'bg-white shadow text-blue-900' : 'text-slate-500 hover:text-slate-700'}`}><Globe className="w-4 h-4 mr-2"/> USA</button>
                    <button onClick={() => setMarket('mexico')} className={`flex-1 py-3 px-4 rounded-lg font-black text-sm flex items-center justify-center transition-all ${market === 'mexico' ? 'bg-white shadow text-green-700' : 'text-slate-500 hover:text-slate-700'}`}><Globe className="w-4 h-4 mr-2"/> MÉXICO</button>
                </div>

                {/* NUEVAS TARJETAS VISUALES DE REMOLQUES */}
                <div className={`grid gap-3 ${market === 'mexico' ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-2 max-w-md'}`}>
                    
                    {/* 1. Ganadero Ganso (Visible siempre) */}
                    <button onClick={() => { setTipoRemolque('ganadero'); setTipoGanadero('ganso'); }} className={`relative flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all overflow-hidden group ${tipoRemolque === 'ganadero' && tipoGanadero === 'ganso' ? 'bg-amber-50 border-amber-500 shadow-md' : 'bg-white border-slate-200 hover:border-amber-300 hover:shadow'}`}>
                        <div className="h-12 w-full flex items-center justify-center mb-2 relative">
                            <Truck className={`w-8 h-8 absolute opacity-20 transition-opacity group-hover:opacity-40 ${tipoRemolque === 'ganadero' && tipoGanadero === 'ganso' ? 'text-amber-600' : 'text-slate-500'}`} />
                            <img src="/img_ganso.png" alt="Ganso" className="max-h-full max-w-full object-contain drop-shadow-md z-10 relative" onError={(e) => e.target.style.display='none'} />
                        </div>
                        <span className={`font-black z-10 text-center text-[11px] leading-tight ${tipoRemolque === 'ganadero' && tipoGanadero === 'ganso' ? 'text-amber-800' : 'text-slate-600'}`}>Ganadero<br/>Ganso</span>
                    </button>

                    {/* 2. Ganadero Redondo (Visible siempre) */}
                    <button onClick={() => { setTipoRemolque('ganadero'); setTipoGanadero('redondo'); }} className={`relative flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all overflow-hidden group ${tipoRemolque === 'ganadero' && tipoGanadero === 'redondo' ? 'bg-amber-50 border-amber-500 shadow-md' : 'bg-white border-slate-200 hover:border-amber-300 hover:shadow'}`}>
                        <div className="h-12 w-full flex items-center justify-center mb-2 relative">
                            <Truck className={`w-8 h-8 absolute opacity-20 transition-opacity group-hover:opacity-40 ${tipoRemolque === 'ganadero' && tipoGanadero === 'redondo' ? 'text-amber-600' : 'text-slate-500'}`} />
                            <img src="/img_redondo.png" alt="Redondo" className="max-h-full max-w-full object-contain drop-shadow-md z-10 relative" onError={(e) => e.target.style.display='none'} />
                        </div>
                        <span className={`font-black z-10 text-center text-[11px] leading-tight ${tipoRemolque === 'ganadero' && tipoGanadero === 'redondo' ? 'text-amber-800' : 'text-slate-600'}`}>Ganadero<br/>Redondo</span>
                    </button>

                    {/* EXCLUSIVOS DE MÉXICO */}
                    {market === 'mexico' && (
                        <>
                            <button onClick={() => setTipoRemolque('cama_baja')} className={`relative flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all overflow-hidden group ${tipoRemolque === 'cama_baja' ? 'bg-indigo-50 border-indigo-500 shadow-md' : 'bg-white border-slate-200 hover:border-indigo-300 hover:shadow'}`}>
                                <div className="h-12 w-full flex items-center justify-center mb-2 relative">
                                    <Truck className={`w-8 h-8 absolute opacity-20 transition-opacity group-hover:opacity-40 ${tipoRemolque === 'cama_baja' ? 'text-indigo-600' : 'text-slate-500'}`} />
                                    <img src="/img_camabaja.png" alt="Cama Baja" className="max-h-full max-w-full object-contain drop-shadow-md z-10 relative" onError={(e) => e.target.style.display='none'} />
                                </div>
                                <span className={`font-black z-10 text-center text-[11px] leading-tight ${tipoRemolque === 'cama_baja' ? 'text-indigo-800' : 'text-slate-600'}`}>Cama<br/>Baja</span>
                            </button>

                            <button onClick={() => setTipoRemolque('cama_alta')} className={`relative flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all overflow-hidden group ${tipoRemolque === 'cama_alta' ? 'bg-emerald-50 border-emerald-500 shadow-md' : 'bg-white border-slate-200 hover:border-emerald-300 hover:shadow'}`}>
                                <div className="h-12 w-full flex items-center justify-center mb-2 relative">
                                    <Truck className={`w-8 h-8 absolute opacity-20 transition-opacity group-hover:opacity-40 ${tipoRemolque === 'cama_alta' ? 'text-emerald-600' : 'text-slate-500'}`} />
                                    <img src="/img_camaalta.png" alt="Cama Alta" className="max-h-full max-w-full object-contain drop-shadow-md z-10 relative" onError={(e) => e.target.style.display='none'} />
                                </div>
                                <span className={`font-black z-10 text-center text-[11px] leading-tight ${tipoRemolque === 'cama_alta' ? 'text-emerald-800' : 'text-slate-600'}`}>Cama<br/>Alta</span>
                            </button>

                            <button onClick={() => setTipoRemolque('volteo')} className={`relative flex flex-col items-center justify-center p-3 rounded-2xl border-2 transition-all overflow-hidden group ${tipoRemolque === 'volteo' ? 'bg-red-50 border-red-500 shadow-md' : 'bg-white border-slate-200 hover:border-red-300 hover:shadow'}`}>
                                <div className="h-12 w-full flex items-center justify-center mb-2 relative">
                                    <Truck className={`w-8 h-8 absolute opacity-20 transition-opacity group-hover:opacity-40 ${tipoRemolque === 'volteo' ? 'text-red-600' : 'text-slate-500'}`} />
                                    <img src="/img_volteo.png" alt="Volteo" className="max-h-full max-w-full object-contain drop-shadow-md z-10 relative" onError={(e) => e.target.style.display='none'} />
                                </div>
                                <span className={`font-black z-10 text-center text-[11px] leading-tight ${tipoRemolque === 'volteo' ? 'text-red-800' : 'text-slate-600'}`}>Remolque<br/>Volteo</span>
                            </button>
                        </>
                    )}
                </div>
            </div>

            {market === 'usa' && tipoRemolque === 'ganadero' && (
                <div className={`p-5 rounded-xl shadow-sm border transition-colors ${isSpecialClient ? 'bg-indigo-900 border-indigo-700' : 'bg-white border-slate-200'}`}>
                  <div className="flex justify-between items-center">
                    <div className="flex items-center space-x-3">
                      <div className={`p-2 rounded-lg ${isSpecialClient ? 'bg-indigo-800' : 'bg-slate-100'}`}><Star className={`w-6 h-6 ${isSpecialClient ? 'text-indigo-300' : 'text-slate-400'}`}/></div>
                      <div><h2 className={`font-black text-lg ${isSpecialClient ? 'text-white' : 'text-slate-800'}`}>Cliente Especial USA</h2><p className={`text-xs font-bold ${isSpecialClient ? 'text-indigo-300' : 'text-slate-500'}`}>{isSpecialClient ? 'Reglas y accesorios requeridos activados' : 'Configuración Estándar USA'}</p></div>
                    </div>
                    <label className={`flex items-center space-x-3 px-5 py-3 rounded-xl cursor-pointer border transition shadow-inner ${isSpecialClient ? 'bg-indigo-950 border-indigo-700 text-white' : 'bg-slate-50 border-slate-300 text-slate-600 hover:bg-slate-100'}`}>
                      <span className="text-sm font-black tracking-wide uppercase">Cliente Especial</span>
                      <div className={`w-12 h-6 rounded-full p-1 transition-colors duration-300 ${isSpecialClient ? 'bg-green-500' : 'bg-slate-400'}`}><div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform duration-300 ${isSpecialClient ? 'translate-x-6' : 'translate-x-0'}`}></div></div>
                      <input type="checkbox" checked={isSpecialClient} onChange={() => setIsSpecialClient(!isSpecialClient)} className="hidden"/>
                    </label>
                  </div>
                </div>
            )}
            
            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
              <h2 className="text-lg font-black text-slate-800 flex items-center mb-4"><User className="w-5 h-5 mr-2 text-blue-600"/> Datos del Cliente</h2>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                <div className="md:col-span-2"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Nombre Comercial / Cliente</label><input type="text" value={cliente.nombre} onChange={e => setCliente({...cliente, nombre: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md font-medium" placeholder="Ej. Juan Pérez" /></div>
                <div className="md:col-span-1"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Teléfono</label><input type="text" value={cliente.telefono} onChange={e => setCliente({...cliente, telefono: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md font-medium" placeholder="Ej. 614 123 4567" /></div>
                <div className="md:col-span-1"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Descuento (%)</label><div className="relative"><input type="number" min="0" max="100" value={cliente.descuentoPct || ''} onChange={e => setCliente({...cliente, descuentoPct: parseFloat(e.target.value) || 0})} className="w-full p-2 border border-slate-300 rounded-md font-black text-red-600 text-center" placeholder="0" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">%</span></div></div>
                <div className="md:col-span-1"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Ajuste / Redondeo</label><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">$</span><input type="number" value={cliente.ajusteRedondeo || ''} onChange={e => setCliente({...cliente, ajusteRedondeo: parseFloat(e.target.value) || 0})} className="w-full p-2 pl-7 border border-slate-300 rounded-md font-black text-purple-700" placeholder="0" /></div></div>
                <div className="md:col-span-5 border-t border-slate-100 pt-3 mt-1"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Anticipo (MXN)</label><div className="relative max-w-[200px]"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">$</span><input type="number" value={cliente.anticipo || ''} onChange={e => setCliente({...cliente, anticipo: parseFloat(e.target.value) || 0})} className="w-full p-2 pl-7 border border-slate-300 rounded-md font-black text-green-700 bg-green-50" placeholder="0" /></div></div>
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
              <h2 className="text-lg font-black text-slate-800 flex items-center mb-4"><Disc className="w-5 h-5 mr-2 text-blue-600"/> 1. Dimensiones y Acoplamiento</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Largo del Remolque</label><select value={dim.largo} onChange={e => setDim({...dim, largo: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md font-medium">{largosDisponibles.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                <div><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Ancho Exterior</label><select value={dim.ancho} onChange={e => setDim({...dim, ancho: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md font-medium">{anchosDisponibles.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-100">
                <div><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Tipo de Jalón</label><select value={acople.jalon} onChange={e => setAcople({...acople, jalon: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md font-bold">{jalonesDisponibles.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                <div><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Cadena de Seguridad</label><select value={acople.cadena} disabled={market === 'usa'} onChange={e => setAcople({...acople, cadena: e.target.value})} className={`w-full p-2 border border-slate-300 rounded-md font-bold ${market === 'usa' ? 'bg-slate-100 opacity-70' : ''}`}>{db.cadenas?.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                <div className="flex flex-col justify-end space-y-2 pb-1"><label className={`flex items-center space-x-2 font-medium text-sm text-slate-700 ${market === 'usa' ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}><input type="checkbox" checked={acople.sujetaCadenas} disabled={market === 'usa'} onChange={() => toggle(setAcople, 'sujetaCadenas')} className="w-4 h-4 text-blue-600"/> <span>Incluir Sujeta Cadenas</span></label></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 pt-4 mt-4 border-t border-slate-100">
                <div className="sm:col-span-6"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Gato Elevación</label><select value={acople.gato} onChange={e => setAcople({...acople, gato: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md">{gatosDisponibles.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                <div className="sm:col-span-2"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Cant.</label><div className="flex bg-slate-100 border border-slate-300 rounded h-[42px] items-center"><button onClick={() => handleCant(setAcople, 'cantGatos', -1, 1)} className="px-3 font-bold hover:bg-slate-200 h-full">-</button><span className="px-2 font-bold w-full text-center">{acople.cantGatos}</span><button onClick={() => handleCant(setAcople, 'cantGatos', 1)} className="px-3 font-bold hover:bg-slate-200 h-full">+</button></div></div>
                {acople.gato.includes('hidraulico') && (
                  <div className="sm:col-span-4 flex flex-col justify-center space-y-1">
                    <label className="flex items-center space-x-2 border rounded px-2 py-1 cursor-pointer"><input type="checkbox" checked={acople.cargadorSolar} disabled={isSpecialClient && market==='usa'} onChange={() => toggle(setAcople, 'cargadorSolar')} className="w-3.5 h-3.5"/><span className="text-xs font-medium">+ Cargador Solar</span></label>
                    <label className="flex items-center space-x-2 border rounded px-2 py-1 cursor-pointer"><input type="checkbox" checked={acople.cargador110} disabled={isSpecialClient && market==='usa'} onChange={() => toggle(setAcople, 'cargador110')} className="w-3.5 h-3.5"/><span className="text-xs font-medium">+ Cargador 110v</span></label>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
              <h2 className="text-lg font-black text-slate-800 flex items-center mb-4"><Zap className="w-5 h-5 mr-2 text-blue-600"/> 2. Capacidad y Ejes</h2>
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200 mb-5"><label className="text-xs font-bold text-blue-800 uppercase block mb-2">Configuración de Ejes</label><select value={rodado.capacidad} onChange={e => setRodado({...rodado, capacidad: e.target.value})} className="w-full p-2 border border-blue-300 rounded-md font-black text-blue-900">{capacidadesDisponibles.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Suspensión</label>
                  <select value={rodado.suspension} disabled={isSpecialClient && market==='usa'} onChange={e => setRodado({...rodado, suspension: e.target.value})} className={`w-full p-2 border border-slate-300 rounded-md ${isSpecialClient && market==='usa' ? 'bg-slate-100 font-bold' : ''}`}>{suspensionesDisponibles.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>
                </div>
                <div><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Set de Llantas</label><select value={rodado.llanta} onChange={e => setRodado({...rodado, llanta: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md">{llantasDisponibles.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
              </div>
              <div className="flex flex-wrap items-center gap-5 pt-4 border-t border-slate-100">
                <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded px-2 py-1"><span className="text-sm font-bold text-slate-700">Frenos Eléctricos:</span><button onClick={() => handleCant(setRodado, 'cantFrenos', -1, 0, cantEjes)} className="px-2 font-bold hover:bg-slate-200 rounded text-lg">-</button><span className="font-black text-blue-700 w-4 text-center">{rodado.cantFrenos}</span><button onClick={() => handleCant(setRodado, 'cantFrenos', 1, 0, cantEjes)} className="px-2 font-bold hover:bg-slate-200 rounded text-lg">+</button><span className="text-xs font-medium text-slate-500 ml-1">/ {cantEjes} Ejes</span></div>
                <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded px-2 py-1"><span className="text-sm font-bold text-slate-700">Llanta Extra:</span><button onClick={() => handleCant(setRodado, 'llantaExtra', -1)} className="px-2 font-bold hover:bg-slate-200 rounded">-</button><span className="font-black text-blue-700 w-4 text-center">{rodado.llantaExtra}</span><button onClick={() => handleCant(setRodado, 'llantaExtra', 1)} className="px-2 font-bold hover:bg-slate-200 rounded">+</button></div>
                <div className="flex items-center space-x-2 bg-slate-50 border border-slate-200 rounded px-2 py-1"><span className="text-sm font-medium text-slate-700">Porta Extra:</span><button onClick={() => handleCant(setRodado, 'portaExtra', -1, tipoRemolque !== 'ganadero' ? 1 : rodado.llantaExtra)} className="px-2 font-bold hover:bg-slate-200 rounded">-</button><span className="font-bold w-4 text-center">{rodado.portaExtra}</span><button onClick={() => handleCant(setRodado, 'portaExtra', 1)} className="px-2 font-bold hover:bg-slate-200 rounded">+</button></div>
              </div>
            </div>

            <div className={`p-5 rounded-xl shadow-sm border ${tipoRemolque === 'cama_baja' ? 'bg-indigo-50 border-indigo-200' : tipoRemolque === 'cama_alta' ? 'bg-emerald-50 border-emerald-200' : tipoRemolque === 'volteo' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
              <h2 className={`text-lg font-black flex items-center mb-4 ${tipoRemolque === 'cama_baja' ? 'text-indigo-900' : tipoRemolque === 'cama_alta' ? 'text-emerald-900' : tipoRemolque === 'volteo' ? 'text-red-900' : 'text-amber-900'}`}><Shield className={`w-5 h-5 mr-2 ${tipoRemolque === 'cama_baja' ? 'text-indigo-600' : tipoRemolque === 'cama_alta' ? 'text-emerald-600' : tipoRemolque === 'volteo' ? 'text-red-600' : 'text-amber-600'}`}/> 3. Estructura {tipoRemolque === 'cama_baja' ? 'Cama Baja' : tipoRemolque === 'cama_alta' ? 'Cama Alta' : tipoRemolque === 'volteo' ? 'Volteo' : 'Ganadera'}</h2>
              
              {tipoRemolque === 'ganadero' && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
                    <div><label className="text-xs font-bold text-amber-700 uppercase block mb-1">Techo</label><select value={carroceria.techo} onChange={e => setCarroceria({...carroceria, techo: e.target.value})} className="w-full p-2 border border-amber-300 rounded-md">{db.techos.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                    <div>
                      <label className="text-xs font-bold text-amber-700 uppercase block mb-1">Frente</label>
                      <select value={carroceria.frente} onChange={e => setCarroceria({...carroceria, frente: e.target.value})} className="w-full p-2 border border-amber-300 rounded-md font-bold">
                        {db.jalones?.find(j => j.id === acople.jalon)?.tipo === 'ganso' ? (
                          <>
                            <option value="cachucha">Cachucha</option>
                            <option value="canasta">Canasta</option>
                          </>
                        ) : (
                          <option value="ninguno">Redondo Fijo</option>
                        )}
                      </select>
                    </div>
                    <div><label className="text-xs font-bold text-amber-700 uppercase block mb-1">Redila</label><select value={carroceria.redila} onChange={e => setCarroceria({...carroceria, redila: e.target.value})} className="w-full p-2 border border-amber-300 rounded-md font-bold">{redilasDisponibles.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-amber-200">
                    <div>
                      <label className="text-xs font-bold text-amber-700 uppercase block mb-1">Ptas. Int ({carroceria.cantPtasInt} / {maxPuertasInt})</label>
                      <div className="flex"><select value={carroceria.puertaInt} onChange={e => setCarroceria({...carroceria, puertaInt: e.target.value})} className="flex-1 p-2 border border-amber-300 rounded-l-md">{db.puertasInteriores.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select><button onClick={() => handleCant(setCarroceria, 'cantPtasInt', -1)} className="px-2 bg-amber-100 border-y border-amber-300 font-bold">-</button><button onClick={() => handleCant(setCarroceria, 'cantPtasInt', 1, 0, maxPuertasInt)} disabled={carroceria.cantPtasInt >= maxPuertasInt} className="px-2 bg-amber-100 border border-amber-300 rounded-r-md font-bold disabled:opacity-50">+</button></div>
                    </div>
                    <div><label className="text-xs font-bold text-amber-700 uppercase block mb-1">Pta Trasera</label><select value={carroceria.puertaTrasera} onChange={e => setCarroceria({...carroceria, puertaTrasera: e.target.value})} className="w-full p-2 border border-amber-300 rounded-md">{db.puertasTraseras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
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
                <h2 className="text-lg font-black text-slate-800 flex items-center mb-4"><DoorOpen className="w-5 h-5 mr-2 text-blue-600"/> 4. Monturero</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <select value={monturero.tipo} onChange={e => setMonturero({...monturero, tipo: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md font-medium">{db.montureros.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>
                  {(monturero.tipo !== 'ninguno' || carroceria.frente === 'cachucha') && (<label className="flex items-center space-x-2 cursor-pointer font-medium"><input type="checkbox" checked={monturero.puertaPerro} onChange={() => toggle(setMonturero, 'puertaPerro')} className="w-4 h-4 text-blue-600"/> <span>Incluir Puerta Perro Lateral</span></label>)}
                </div>
                {monturero.tipo === 'diagonal' && (
                    <div className="flex gap-4 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                        <div className="flex-1"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Pared Larga (Pulgadas)</label><div className="flex border border-slate-300 rounded overflow-hidden h-[34px]"><button onClick={() => handleCant(setMonturero, 'paredLarga', -0.5, 40, 120)} className="px-3 font-bold bg-white hover:bg-slate-100">-</button><span className="w-full text-center font-bold bg-white border-x border-slate-300 flex items-center justify-center">{monturero.paredLarga}"</span><button onClick={() => handleCant(setMonturero, 'paredLarga', 0.5, 40, 120)} className="px-3 font-bold bg-white hover:bg-slate-100">+</button></div></div>
                        <div className="flex-1"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Pared Corta (Pulgadas)</label><div className="flex border border-slate-300 rounded overflow-hidden h-[34px]"><button onClick={() => handleCant(setMonturero, 'paredCorta', -0.5, 10, 80)} className="px-3 font-bold bg-white hover:bg-slate-100">-</button><span className="w-full text-center font-bold bg-white border-x border-slate-300 flex items-center justify-center">{monturero.paredCorta}"</span><button onClick={() => handleCant(setMonturero, 'paredCorta', 0.5, 10, 80)} className="px-3 font-bold bg-white hover:bg-slate-100">+</button></div></div>
                    </div>
                )}
              </div>
            )}

            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
              <div className="flex justify-between items-center mb-4"><h2 className="text-lg font-black text-slate-800 flex items-center"><Layers className="w-5 h-5 mr-2 text-blue-600"/> {tipoRemolque === 'ganadero' ? '5.' : '4.'} Acabados y Accesorios</h2></div>
              <div className="mb-5 bg-slate-50 p-4 rounded-lg border border-slate-200">
                <label className="text-xs font-bold text-slate-500 uppercase block mb-3">Color del Remolque</label>
                <div className="flex flex-wrap gap-3">
                  {db.colores?.map(c => (
                    <button key={c.id} onClick={() => setAcabados({...acabados, color: c.id})} className={`flex items-center space-x-2 px-3 py-2 rounded-full border shadow-sm transition ${acabados.color === c.id ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-200' : 'border-slate-300 hover:bg-white bg-slate-100'}`}>
                      <div className="w-5 h-5 rounded-full shadow-sm border border-slate-300" style={{ backgroundColor: c.hex }}></div><span className="text-sm font-bold text-slate-700">{c.nombre}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                <div><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Piso</label><select value={acabados.piso} onChange={e => setAcabados({...acabados, piso: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md">{pisosDisponibles.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                <div><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Caja Htas</label><select value={acabados.cajaHtas} onChange={e => setAcabados({...acabados, cajaHtas: e.target.value})} className="w-full p-2 border border-slate-300 rounded-md">{(!acople.gato.includes('hidraulico')) && <option value="ninguna">Sin Caja</option>}<option value="std">Estándar</option><option value="grande">Grande</option></select></div>
                <div><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Luces</label><select value={acabados.luces} disabled={isSpecialClient && market==='usa'} onChange={e => setAcabados({...acabados, luces: e.target.value})} className={`w-full p-2 border border-slate-300 rounded-md ${isSpecialClient && market==='usa' ? 'bg-slate-100 font-bold' : ''}`}>{lucesDisponibles.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>              </div>

              {acabados.luces === 'especial' && ['cama_baja', 'cama_alta'].includes(tipoRemolque) && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                   <div><label className="text-[11px] font-bold text-blue-800 uppercase block mb-1">Óvalos Rojos</label><div className="flex bg-white border border-blue-300 rounded overflow-hidden"><button onClick={() => handleCant(setCamaBajaOpts, 'ovaloRojo', -1)} className="px-3 py-1 font-bold hover:bg-slate-100">-</button><span className="w-full text-center py-1 font-bold border-x border-blue-200">{camaBajaOpts.ovaloRojo}</span><button onClick={() => handleCant(setCamaBajaOpts, 'ovaloRojo', 1)} className="px-3 py-1 font-bold hover:bg-slate-100">+</button></div></div>
                   <div><label className="text-[11px] font-bold text-blue-800 uppercase block mb-1">3/4" Rojos</label><div className="flex bg-white border border-blue-300 rounded overflow-hidden"><button onClick={() => handleCant(setCamaBajaOpts, 'tresCuartosRojo', -1)} className="px-3 py-1 font-bold hover:bg-slate-100">-</button><span className="w-full text-center py-1 font-bold border-x border-blue-200">{camaBajaOpts.tresCuartosRojo}</span><button onClick={() => handleCant(setCamaBajaOpts, 'tresCuartosRojo', 1)} className="px-3 py-1 font-bold hover:bg-slate-100">+</button></div></div>
                   <div><label className="text-[11px] font-bold text-blue-800 uppercase block mb-1">3/4" Ámbar</label><div className="flex bg-white border border-blue-300 rounded overflow-hidden"><button onClick={() => handleCant(setCamaBajaOpts, 'tresCuartosAmbar', -1)} className="px-3 py-1 font-bold hover:bg-slate-100">-</button><span className="w-full text-center py-1 font-bold border-x border-blue-200">{camaBajaOpts.tresCuartosAmbar}</span><button onClick={() => handleCant(setCamaBajaOpts, 'tresCuartosAmbar', 1)} className="px-3 py-1 font-bold hover:bg-slate-100">+</button></div></div>
                   <div className="flex items-end pb-0.5"><label className="flex items-center space-x-2 cursor-pointer font-bold text-[13px] text-blue-900 bg-white px-3 py-1.5 rounded border border-blue-300 w-full justify-center shadow-sm"><input type="checkbox" checked={camaBajaOpts.luzPortaplaca} onChange={() => toggle(setCamaBajaOpts, 'luzPortaplaca')} className="w-4 h-4 text-blue-600"/> <span>Luz Portaplaca</span></label></div>
                </div>
              )}

              {tipoRemolque === 'ganadero' && ( <div className="grid grid-cols-1 gap-4 mb-4 bg-slate-50 p-3 rounded border border-slate-200"><div className="flex justify-between items-center max-w-sm"><label className="text-sm font-bold text-slate-700 flex items-center"><Lightbulb className="w-4 h-4 mr-2 text-amber-500"/> Luces Interiores</label><div className="flex bg-white border border-slate-300 rounded overflow-hidden"><button onClick={() => handleCant(setAccesorios, 'lucesInteriores', -1)} className="px-3 py-1 font-bold hover:bg-slate-100">-</button><span className="px-4 py-1 font-bold border-x border-slate-200">{accesorios.lucesInteriores}</span><button onClick={() => handleCant(setAccesorios, 'lucesInteriores', 1)} className="px-3 py-1 font-bold hover:bg-slate-100">+</button></div></div></div> )}

              <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 pt-4 border-t border-slate-100 items-end">
                <div className="sm:col-span-2"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Tipo Pintura</label><select value={acabados.pintura} disabled={(isSpecialClient && market==='usa') || tipoRemolque === 'cama_alta'} onChange={e => setAcabados({...acabados, pintura: e.target.value})} className={`w-full p-2 border border-slate-300 rounded-md h-[34px] text-sm ${((isSpecialClient && market==='usa') || tipoRemolque === 'cama_alta') ? 'bg-slate-100 font-bold' : ''}`}>{db.pinturas.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></div>
                {acabados.pintura === 'polvo' ? ( <div className="sm:col-span-3"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Cajas de Polvo (20kg)</label><div className="h-[34px] flex items-center font-bold text-slate-800 bg-slate-100 px-3 rounded border border-slate-200">{acabados.cajasPolvo} Cajas</div></div> ) : (
                  <>
                    <div><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Body(L)</label><div className="flex bg-slate-50 border border-slate-300 rounded overflow-hidden h-[34px]"><button onClick={() => handleCant(setAcabados, 'bodyLitros', -1)} className="px-2 font-bold hover:bg-slate-200">-</button><span className="w-full text-center font-bold bg-white border-x border-slate-300 flex items-center justify-center">{acabados.bodyLitros}</span><button onClick={() => handleCant(setAcabados, 'bodyLitros', 1)} className="px-2 font-bold hover:bg-slate-200">+</button></div></div>
                    <div><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Base(L)</label><div className="flex bg-slate-50 border border-slate-300 rounded overflow-hidden h-[34px]"><button onClick={() => handleCant(setAcabados, 'pinturaLitros', -1)} className="px-2 font-bold hover:bg-slate-200">-</button><span className="w-full text-center font-bold bg-white border-x border-slate-300 flex items-center justify-center">{acabados.pinturaLitros}</span><button onClick={() => handleCant(setAcabados, 'pinturaLitros', 1)} className="px-2 font-bold hover:bg-slate-200">+</button></div></div>
                    <div className="flex flex-col relative"><label className="text-xs font-bold text-slate-500 uppercase block mb-1">Techo(L)</label><div className={`flex bg-slate-50 border border-slate-300 rounded overflow-hidden h-[34px] ${(acabados.mismoColorTecho || ['cama_baja', 'cama_alta'].includes(tipoRemolque)) ? 'opacity-50 pointer-events-none' : ''}`}><button onClick={() => handleCant(setAcabados, 'techoLitros', -1)} className="px-2 font-bold hover:bg-slate-200">-</button><span className="w-full text-center font-bold bg-white border-x border-slate-300 flex items-center justify-center">{acabados.techoLitros}</span><button onClick={() => handleCant(setAcabados, 'techoLitros', 1)} className="px-2 font-bold hover:bg-slate-200">+</button></div>
                        {carroceria.techo !== 'sin_techo' && carroceria.techo !== 'lona' && tipoRemolque === 'ganadero' && ( <label className="absolute -top-6 -right-2 flex items-center space-x-1 cursor-pointer whitespace-nowrap bg-white border border-slate-200 px-1.5 py-0.5 rounded shadow-sm"><input type="checkbox" checked={acabados.mismoColorTecho} onChange={() => toggle(setAcabados, 'mismoColorTecho')} className="w-3 h-3 text-blue-600"/><span className="text-[10px] font-bold text-slate-600">Mismo Color</span></label> )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="w-full xl:w-1/3 print:w-full print:block">
            {/* ENVOLTORIO STICKY CON SCROLL INTERNO PARA SOLUCIONAR TICKET LARGO */}
            <div className="sticky top-24 max-h-[calc(100vh-6rem)] overflow-y-auto pb-8 pr-1 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-thumb]:rounded-full">
              
              {activeTab === 'cotizacion' && (
                <div id="ticket-cotizacion" className="bg-white p-6 rounded-xl shadow-xl border-t-8 border-slate-900 print:relative print:top-0 print:border-t-0 print:shadow-none print:w-full print:p-0">
                  
                  {/* MEMBRETE */}
                  <div className="hidden print:flex items-center justify-between mb-8 border-b-2 border-slate-800 pb-4">
                    <div className="flex items-center space-x-4">
                      <img src="/logo_amacsa.png" alt="AMACSA" className="h-12 object-contain" />
                      <div>
                        <h1 className="text-xl font-black text-slate-900 leading-none mb-1">ADEMES Y MAQUINARIA DE CUAUHTÉMOC S.A. DE C.V.</h1>
                        <p className="text-xs text-slate-600 font-bold">Sucursal Campo 6 1/2, Cuauhtémoc, Chihuahua.</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <h2 className="text-xl font-black tracking-widest text-slate-800">COTIZACIÓN</h2>
                      <p className="text-xs font-bold text-slate-500">{new Date().toLocaleDateString('es-MX')}</p>
                    </div>
                  </div>

                  <h2 className="text-2xl font-black mb-6 border-b-4 border-slate-900 pb-2 uppercase flex items-center text-slate-800 print:hidden"><FileText className="w-6 h-6 mr-3"/> Cotización Oficial</h2>
                  
                  <div className="grid grid-cols-1 print:grid-cols-2 gap-4 text-sm mb-6 print:mb-2">
                    <div className="space-y-4">
                      {(cliente.nombre || cliente.telefono) && (
                        <div className="p-4 bg-slate-50 print:border-0 print:p-0 print:mb-2 rounded-lg border border-slate-200">
                          <h3 className="font-bold text-slate-800 mb-2 uppercase tracking-wider text-[10px]">Datos del Cliente</h3>
                          <ul className="space-y-1 text-slate-700 print:text-slate-900 text-xs">
                            {cliente.nombre && <li>• Nombre Comercial: <span className="font-bold">{cliente.nombre}</span></li>}
                            {cliente.telefono && <li>• Teléfono de Contacto: <span className="font-bold">{cliente.telefono}</span></li>}
                          </ul>
                        </div>
                      )}
                      <div className="p-4 bg-slate-50 print:border-0 print:p-0 print:mb-2 rounded-lg border border-slate-200">
                        <h3 className="font-bold text-slate-800 mb-2 uppercase tracking-wider text-[10px]">Estructura y Carrocería</h3>
                        <ul className="space-y-1 text-slate-700 print:text-slate-900 text-xs">
                          {tipoRemolque === 'ganadero' && <li>• Techo: <span className="font-bold">{oTecho.nombre}</span></li>}
                          {tipoRemolque === 'ganadero' && carroceria.frente !== 'ninguno' && <li>• Frente: <span className="font-bold capitalize">{carroceria.frente}</span></li>}
                          {tipoRemolque !== 'cama_alta' && <li>• Redila: <span className="font-bold">{oRedila.nombre}</span></li>}
                          {tipoRemolque === 'ganadero' && <li>• Puertas Interiores: <span className="font-bold">{carroceria.cantPtasInt}x {oPInt.nombre}</span></li>}
                          {tipoRemolque === 'ganadero' && <li>• Puerta Trasera: <span className="font-bold">{oPTras.nombre}</span></li>}
                          {tipoRemolque === 'ganadero' && oMont.id !== 'ninguno' && <li>• Monturero: <span className="font-bold">{oMont.nombre} {monturero.puertaPerro ? '(Incluye Puerta Perro)' : ''}</span></li>}
                          {['cama_baja', 'cama_alta'].includes(tipoRemolque) && camaBajaOpts.rampas !== 'ninguna' && <li>• Accesos: <span className="font-bold">{oRampa.nombre}</span></li>}
                          {tipoRemolque === 'cama_baja' && camaBajaOpts.fenderReforzado && <li>• Fender: <span className="font-bold">Fender Reforzado Especial</span></li>}
                          {tipoRemolque === 'volteo' && <li>• Elevación: <span className="font-bold capitalize">{volteoOpts.sistemaElevacion}</span></li>}
                          {tipoRemolque === 'volteo' && <li>• Puerta Trasera: <span className="font-bold capitalize">{volteoOpts.puertaTrasera.replace('_', ' ')}</span></li>}
                          {tipoRemolque === 'volteo' && volteoOpts.fenderReforzado && <li>• Fender: <span className="font-bold">Fender Reforzado Especial</span></li>}
                        </ul>
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      <div className="p-4 bg-slate-50 print:border-0 print:p-0 print:mb-2 rounded-lg border border-slate-200">
                        <h3 className="font-bold text-slate-800 mb-2 uppercase tracking-wider text-[10px]">Especificaciones Principales</h3>
                        <ul className="space-y-1 text-slate-700 print:text-slate-900 text-xs">
                          <li>• Remolque {tipoRemolque === 'ganadero' ? 'Ganadero' : tipoRemolque === 'cama_alta' ? 'Cama Alta' : 'Cama Baja'} AMACSA {oLargo.valor}' Largo x {oAncho.valor}" Ancho</li>
                          <li>• Capacidad: <span className="font-bold">{oCap.nombre}</span></li>
                          <li>• Acoplamiento: <span className="font-bold">{oJalon.nombre}</span></li>
                          <li>• Suspensión: <span className="font-bold">{oSusp.nombre}</span></li>
                          <li>• Rodado: <span className="font-bold">{oLlantas.nombre}</span></li>
                          <li>• Piso: <span className="font-bold">{oPiso.nombre}</span></li>
                          <li>• Color: <span className="font-bold uppercase">{db.colores?.find(c => c.id === acabados.color)?.nombre || 'Estándar'}</span></li>
                        </ul>
                      </div>
                      <div className="p-4 bg-blue-50 print:bg-transparent print:border-0 print:p-0 rounded-lg border border-blue-100">
                        <h3 className="font-bold text-blue-900 print:text-slate-800 mb-2 uppercase tracking-wider text-[10px]">Extras e Inclusiones</h3>
                        <ul className="space-y-1 text-blue-800 print:text-slate-900 text-xs">
                          {market === 'usa' ? ( <li>• Cadena de Seguridad: <span className="font-bold">Ganso 3/8 x 35"</span></li> ) : ( acople.cadena !== 'ninguna' && <li>• Cadena de Seguridad: <span className="font-bold">{oCadena.nombre}</span></li> )}
                          {acople.sujetaCadenas && <li>• Sistema Sujeta Cadenas</li>}
                          <li>• <span className="font-bold">{acople.cantGatos}x</span> {oGato.nombre}</li>
                          {acople.cargadorSolar && <li>• Cargador Solar Integrado</li>}
                          {acople.cargador110 && <li>• Cargador 110v Integrado</li>}
                          {rodado.cantFrenos > 0 && <li>• <span className="font-bold">{rodado.cantFrenos}x</span> Ejes con Frenos Eléctricos</li>}
                          {rodado.llantaExtra > 0 && <li>• <span className="font-bold">{rodado.llantaExtra}x</span> Llanta de Refacción</li>}
                          {Number(rodado.portaExtra) > 0 && <li>• <span className="font-bold">{Number(rodado.portaExtra)}x</span> Porta Extra Especial</li>}
                          {tipoRemolque === 'ganadero' && carroceria.puertaPiloto && <li>• Puerta Piloto Lateral ({carroceria.puertaPilotoAncho}")</li>}
                          {tipoRemolque === 'ganadero' && carroceria.plexiglass && <li>• Sistema de Plexiglass (Todas las rejillas)</li>}
                          {tipoRemolque === 'ganadero' && carroceria.rackPacas && <li>• Rack Superior para Pacas</li>}
                          {carroceria.polverasEspeciales && <li>• Polveras Estilo USA</li>}
                          <li>• {oLuces.nombre} {acabados.luces === 'especial' && ['cama_baja', 'cama_alta'].includes(tipoRemolque) ? `(${camaBajaOpts.ovaloRojo}x Óvalo, ${camaBajaOpts.tresCuartosRojo}x 3/4" R, ${camaBajaOpts.tresCuartosAmbar}x 3/4" A)` : ''}</li>
                          {acabados.cajaHtas !== 'ninguna' && <li>• Caja de Herramientas ({acabados.cajaHtas === 'std' ? 'Estándar' : 'Grande'})</li>}
                        </ul>
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-6 pt-4 border-t-2 border-slate-800 bg-slate-900 print:bg-transparent print:border-slate-300 print:-mx-0 print:px-0 -mx-6 px-6 pb-6 rounded-b-xl text-white print:text-slate-900 print:shadow-none print:mt-2 print:pt-2">
                    <div className="flex justify-between text-slate-300 print:text-slate-700 font-bold mb-1 text-[11px] print:mb-0"><span>Subtotal Neto</span><span>{formatoMoneda(subtotalNeto)}</span></div>
                    {cliente.descuentoPct > 0 && ( <div className="flex justify-between text-red-400 print:text-red-700 font-bold mb-1 text-[11px] print:mb-0"><span>Descuento Comercial ({cliente.descuentoPct}%)</span><span>- {formatoMoneda(subtotalNeto - subtotalDescuento)}</span></div> )}
                    {market !== 'usa' && ( <div className="flex justify-between text-slate-400 print:text-slate-600 font-bold mb-2 text-[11px] print:mb-0"><span>I.V.A. (16%)</span><span>{formatoMoneda(subtotalIva)}</span></div> )}
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
                    <p className="text-slate-400 print:text-slate-500 text-[9px] mt-4 text-center print:mt-2">Cotización válida por 15 días. Sujeta a cambios de ingeniería y planta. Razón Social: Ademes y Maquinaria de Cuauhtémoc S.A. de C.V.</p>
                    <div className="hidden print:block mt-6 pt-2 border-t border-slate-300 text-center mx-auto w-48"><p className="text-[11px] font-bold text-slate-800">{currentUser?.name}</p><p className="text-[9px] text-slate-500">Representante de Ventas AMACSA</p></div>
                  </div>
                </div>
              )}
              
              {activeTab === 'cotizacion' && (
                <div className="print:hidden grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                   <button onClick={handleWhatsAppPDF} className="bg-[#25D366] hover:bg-[#128C7E] text-white font-black py-3 px-4 rounded-xl flex items-center justify-center transition shadow-md"><Send className="w-5 h-5 mr-2" /> <span>WhatsApp con PDF</span></button>
                   <button onClick={handleGuardarCotizacion} className="bg-slate-800 hover:bg-slate-700 text-white font-black py-3 px-4 rounded-xl flex items-center justify-center transition shadow-md"><Save className="w-5 h-5 mr-2" /> <span>Guardar en Historial</span></button>
                </div>
              )}
            </div>
          </div>
        </main>
      )}
    </div>
  );
}