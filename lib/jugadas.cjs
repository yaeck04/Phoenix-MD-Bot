const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('fs');
const { join } = require('path');

const LOTERIAS = ["Florida", "Georgia", "New_York"];
const CONFIG_DIR = './data/users';

const DEFAULT_CONFIG = {
    Parlet: 400,
    Centena: 400,
    Fijo: 80,
    Corrido: 20,
    barra_interpretacion: "error",
    usar_gestion_deuda: true
};

// ============================================
// SISTEMA DE ACCESO TEMPORAL POR USUARIO
// ============================================
const ACCESS_FILE = './users_access.json';

function cargarUsuariosAcceso() {
    if (!existsSync(ACCESS_FILE)) {
        writeFileSync(ACCESS_FILE, '[]');
        return [];
    }
    try {
        return JSON.parse(readFileSync(ACCESS_FILE, 'utf-8'));
    } catch (e) {
        return [];
    }
}

function guardarUsuariosAcceso(usuarios) {
    writeFileSync(ACCESS_FILE, JSON.stringify(usuarios, null, 2));
}

function parsearDuracion(duracionStr) {
    const match = duracionStr.match(/^(\d+)([dh])$/i);
    if (!match) return null;
    
    const cantidad = parseInt(match[1]);
    const tipo = match[2].toLowerCase();
    const ahora = Date.now();
    
    if (tipo === 'h') return ahora + (cantidad * 60 * 60 * 1000);
    if (tipo === 'd') return ahora + (cantidad * 24 * 60 * 60 * 1000);
    
    return null;
}

function verificarAccesoUsuario(userId) {
    const usuarios = cargarUsuariosAcceso();
    let indexUsuario = -1;
    let realPhone = userId;

    // Si viene de un grupo con @lid
    if (typeof userId === 'string' && userId.includes('@lid')) {
        indexUsuario = usuarios.findIndex(u => u.groupLids && u.groupLids.includes(userId));
        if (indexUsuario !== -1) realPhone = usuarios[indexUsuario].phone; // Encontrar el teléfono real
    } else {
        // Si viene del chat privado (número normal)
        indexUsuario = usuarios.findIndex(u => u.phone === userId);
    }

    if (indexUsuario === -1) {
        return { 
            autorizado: false, 
            mensaje: `❌ *Acceso denegado*\n\nTu número no está registrado en el sistema.\n\n📞 Contacta al administrador para solicitar acceso.` 
        };
    }
    
    const usuario = usuarios[indexUsuario];
    
    if (typeof usuario.expires === 'string' && /^[0-9]+[dh]$/i.test(usuario.expires)) {
        const timestamp = parsearDuracion(usuario.expires);
        if (timestamp) {
            usuario.expires = timestamp;
            usuarios[indexUsuario] = usuario;
            guardarUsuariosAcceso(usuarios);
        } else {
            return { autorizado: false, mensaje: "⚠️ Error en el formato de tiempo asignado." };
        }
    }
    
    const expiracion = parseInt(usuario.expires);
    if (isNaN(expiracion)) return { autorizado: false, mensaje: "⚠️ Error en la fecha de expiración." };
    
    if (Date.now() > expiracion) {
        const fechaExpiracion = new Date(expiracion).toLocaleString('es-VE');
        return { 
            autorizado: false, 
            mensaje: `⏰ *Licencia expirada*\n\nHola *${usuario.name}*, tu acceso expiró el:\n_${fechaExpiracion}_\n\n📞 Contacta al administrador para renovar.` 
        };
    }
    
    const diferencia = expiracion - Date.now();
    const diasRestantes = Math.floor(diferencia / (1000 * 60 * 60 * 24));
    const horasRestantes = Math.floor((diferencia % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    let tiempoTexto = diasRestantes > 0 ? `${diasRestantes} días y ${horasRestantes} horas` : `${horasRestantes} horas`;
    
    // 🆕 Devolver el teléfono real para que el sistema funcione internamente con él
    return { 
        autorizado: true, 
        nombre: usuario.name, 
        tiempoRestante: tiempoTexto,
        realPhone: realPhone 
    };
}

// FUNCIÓN MAESTRA PARA RESOLVER IDs
function resolverUserId(m) {
    const chatJid = m.key?.remoteJid || '';
    if (chatJid.includes('@g.us')) {
        // ESTAMOS EN UN GRUPO: devolver el sender (puede ser @lid o @s.whatsapp.net)
        return m.sender || '';
    } else {
        // ESTAMOS EN CHAT PRIVADO: el chatJid SIEMPRE es el número real
        return chatJid.split('@')[0].replace(/\D/g, '');
    }
}

// ============================================
// FUNCIONES DE RUTAS POR USUARIO
// ============================================
function obtenerRutaUsuario(userId) {
    const userDir = join(CONFIG_DIR, userId);
    if (!existsSync(userDir)) {
        mkdirSync(userDir, { recursive: true });
    }
    return userDir;
}

function obtenerRutaConfigPremios(userId, loteria) {
    return join(obtenerRutaUsuario(userId), `configuracion_premios_${loteria.toLowerCase()}.json`);
}

function obtenerRutaLasterosPorciento(userId, loteria) {
    return join(obtenerRutaUsuario(userId), `listeros_porciento_${loteria.toLowerCase()}.json`);
}

function obtenerRutaUltimaLoteria(userId) {
    return join(obtenerRutaUsuario(userId), 'ultima_loteria.json');
}

function cargarUltimaLoteria(userId) {
    const path = obtenerRutaUltimaLoteria(userId);
    if (existsSync(path)) {
        try {
            const data = JSON.parse(readFileSync(path, 'utf-8'));
            return data.loteria || "Florida";
        } catch (e) {}
    }
    return "Florida";
}

function guardarUltimaLoteria(userId, loteria) {
    writeFileSync(obtenerRutaUltimaLoteria(userId), JSON.stringify({ loteria }));
}

function cargarConfiguracionPremios(userId, loteria) {
    if (!loteria) loteria = cargarUltimaLoteria(userId);
    const path = obtenerRutaConfigPremios(userId, loteria);
    if (existsSync(path)) {
        try {
            return JSON.parse(readFileSync(path, 'utf-8'));
        } catch (e) {}
    }
    return { ...DEFAULT_CONFIG };
}

function guardarConfiguracionPremios(userId, config, loteria) {
    if (!loteria) loteria = cargarUltimaLoteria(userId);
    writeFileSync(obtenerRutaConfigPremios(userId, loteria), JSON.stringify(config, null, 2));
}

function cargarListerosPorciento(userId, loteria) {
    if (!loteria) loteria = cargarUltimaLoteria(userId);
    const path = obtenerRutaLasterosPorciento(userId, loteria);
    if (existsSync(path)) {
        try {
            const data = JSON.parse(readFileSync(path, 'utf-8'));
            const nuevoFormato = {};
            for (const [k, v] of Object.entries(data)) {
                if (typeof v === 'number') {
                    nuevoFormato[k] = { porciento: v, deuda: 0 };
                } else if (typeof v === 'object') {
                    nuevoFormato[k] = {
                        porciento: v.porciento || 0,
                        deuda: v.deuda || 0
                    };
                }
            }
            return nuevoFormato;
        } catch (e) {}
    }
    return {};
}

function guardarListerosPorciento(userId, listeros, loteria) {
    if (!loteria) loteria = cargarUltimaLoteria(userId);
    writeFileSync(obtenerRutaLasterosPorciento(userId, loteria), JSON.stringify(listeros, null, 2));
}

function limpiarNombre(nombre) {
    return nombre.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s]/g, '').trim();
}

function desglosarSerie(numeroInicio, numeroFin, montoFijo, montoCorrido) {
    const resultados = [];
    const ni = parseInt(numeroInicio);
    const nf = parseInt(numeroFin);
    
    if (ni % 11 === 0 && nf % 11 === 0 && (nf - ni) === 99) {
        for (let i = 0; i < 100; i += 11) {
            resultados.push({ numero: `${i.toString().padStart(2, '0')}`, fijo: montoFijo, corrido: montoCorrido });
        }
        return resultados;
    }
    
    if (ni % 10 === nf % 10 && (nf - ni) === 90) {
        const terminal = ni % 10;
        for (let decena = 0; decena < 10; decena++) {
            resultados.push({ numero: `${decena}${terminal}`, fijo: montoFijo, corrido: montoCorrido });
        }
        return resultados;
    }
    
    if (Math.floor(ni / 10) === Math.floor(nf / 10) && (nf - ni) === 9) {
        const decena = Math.floor(ni / 10);
        for (let unidad = 0; unidad < 10; unidad++) {
            resultados.push({ numero: `${decena}${unidad}`, fijo: montoFijo, corrido: montoCorrido });
        }
        return resultados;
    }
    
    if (ni === 1 && nf === 10) {
        for (let i = ni; i <= nf; i++) {
            resultados.push({ numero: `${i.toString().padStart(2, '0')}`, fijo: montoFijo, corrido: montoCorrido });
        }
        return resultados;
    }
    
    if (ni === 90 && nf === 0) {
        for (let i = 90; i < 100; i++) {
            resultados.push({ numero: `${i.toString().padStart(2, '0')}`, fijo: montoFijo, corrido: montoCorrido });
        }
        resultados.push({ numero: '00', fijo: montoFijo, corrido: montoCorrido });
        return resultados;
    }
    
    if (Math.floor(ni / 10) === Math.floor(nf / 10) && nf > ni) {
        const decena = Math.floor(ni / 10);
        for (let unidad = ni % 10; unidad <= (nf % 10); unidad++) {
            resultados.push({ numero: `${decena}${unidad}`, fijo: montoFijo, corrido: montoCorrido });
        }
        return resultados;
    }
    
    if (ni % 10 === nf % 10 && nf > ni && (Math.floor(nf / 10) - Math.floor(ni / 10)) === 1) {
        for (let i = ni; i <= nf; i++) {
            resultados.push({ numero: `${i.toString().padStart(2, '0')}`, fijo: montoFijo, corrido: montoCorrido });
        }
        return resultados;
    }
    
    if (ni % 10 === nf % 10 && nf > ni) {
        const unidad = ni % 10;
        for (let decena = Math.floor(ni / 10); decena <= Math.floor(nf / 10); decena++) {
            resultados.push({ numero: `${decena}${unidad}`, fijo: montoFijo, corrido: montoCorrido });
        }
        return resultados;
    }
    
    if (ni % 11 === 0 && nf % 11 === 0 && nf > ni) {
        for (let i = ni; i <= nf; i += 11) {
            resultados.push({ numero: `${i.toString().padStart(2, '0')}`, fijo: montoFijo, corrido: montoCorrido });
        }
        return resultados;
    }
    
    return [];
}

function desglosarSerieCentena(numeroInicio, numeroFin, montoFijo) {
    const resultados = [];
    const ni = parseInt(numeroInicio);
    const nf = parseInt(numeroFin);
    
    if (nf > ni && Math.floor(ni / 10) === Math.floor(nf / 10)) {
        for (let i = ni; i <= nf; i++) {
            resultados.push({ numero: `${i.toString().padStart(3, '0')}`, fijo: montoFijo });
        }
        return resultados;
    }
    
    if (nf > ni && Math.floor(ni / 100) === Math.floor(nf / 100) && (ni % 100) === 1 && (nf % 100) === 10) {
        for (let i = ni; i <= nf; i++) {
            resultados.push({ numero: `${i.toString().padStart(3, '0')}`, fijo: montoFijo });
        }
        return resultados;
    }
    
    if (nf > ni && Math.floor(ni / 100) === Math.floor(nf / 100) && ni % 10 === nf % 10 && (Math.floor(nf / 10) % 10 - Math.floor(ni / 10) % 10) === 1) {
        for (let num = ni; num <= nf; num++) {
            resultados.push({ numero: `${num.toString().padStart(3, '0')}`, fijo: montoFijo });
        }
        return resultados;
    }
    
    if (nf > ni && Math.floor(ni / 100) === Math.floor(nf / 100) && ni % 10 === nf % 10) {
        const primerDigito = Math.floor(ni / 100);
        const ultimoDigito = ni % 10;
        for (let medio = Math.floor(ni / 10) % 10; medio <= Math.floor(nf / 10) % 10; medio++) {
            const num = primerDigito * 100 + medio * 10 + ultimoDigito;
            resultados.push({ numero: `${num.toString().padStart(3, '0')}`, fijo: montoFijo });
        }
        return resultados;
    }
    
    if (nf > ni && Math.floor(ni / 100) === Math.floor(nf / 100) && (ni % 100) % 11 === 0 && (nf % 100) % 11 === 0) {
        const primerDigito = Math.floor(ni / 100);
        for (let par = ni % 100; par <= (nf % 100); par += 11) {
            const num = primerDigito * 100 + par;
            resultados.push({ numero: `${num.toString().padStart(3, '0')}`, fijo: montoFijo });
        }
        return resultados;
    }
    
    if (numeroInicio.length === 3 && numeroFin.length === 3 && numeroInicio.slice(1) === numeroFin.slice(1) && parseInt(numeroFin[0]) > parseInt(numeroInicio[0])) {
        const ultimosDigitos = numeroInicio.slice(1);
        for (let digito = parseInt(numeroInicio[0]); digito <= parseInt(numeroFin[0]); digito++) {
            resultados.push({ numero: `${digito}${ultimosDigitos}`, fijo: montoFijo });
        }
        return resultados;
    }
    
    return [];
}

function procesarMensajeConContexto(userId, texto) {
    const loteriaActual = cargarUltimaLoteria(userId);
    const configPremios = cargarConfiguracionPremios(userId, loteriaActual);
    const barraConfig = configPremios.barra_interpretacion || "error";
    
    const listeros = {};
    
    function agregarJugada(listero, tipo, numero, monto) {
        if (!listeros[listero]) {
            listeros[listero] = { Fijo: {}, Corrido: {}, Centena: {}, Parlet: {} };
        }
        if (!listeros[listero][tipo]) {
            listeros[listero][tipo] = {};
        }
        listeros[listero][tipo][numero] = (listeros[listero][tipo][numero] || 0) + monto;
    }
    
    const seriePatron = /^(\d{2})al(\d{2})-(\d+)(?:-(\d+))?$/i;
    const serieCentenaPatron = /^(\d{3})al(\d{3})-(\d+)(?:-(\d+))?$/i;
    
    texto = texto.replace(/: (\[\d)/g, ':\n$1');
    const textoOriginal = texto;
    texto = texto.replace(/^\[\d{1,2}\/\d{1,2},\s*\d{1,2}:\d{2}\]\s*/gm, '');
    texto = texto.replace(/\.\     /g, '     ');
    texto = texto.replace(/(?<![a-zA-ZáéíóúÁÉÍÓÚñÑ])[oO]{2}(?![a-zA-ZáéíóúÁÉÍÓÚñÑ])/g, '00');
    texto = texto.replace(/(?<![a-zA-ZáéíóúÁÉÍÓÚñÑ])[oO]{3}(?![a-zA-ZáéíóúÁÉÍÓÚñÑ])/g, '000');
    texto = texto.replace(/([a-zA-ZáéíóúÁÉÍÓÚñÑ])([oO]+)(\d)/g, '$1$2 $3');
    texto = texto.replace(/(\d)([oO]+)([a-zA-ZáéíóúÁÉÍÓÚñÑ])/g, '$1 $2$3');
    texto = texto.replace(/[!?'`|•√π÷§∆}{°^¥€¢&$£✓™®©%]/g, '');
    texto = texto.replace(/(?<=\d)[oO]|[oO](?=\d)/g, '0');
    texto = texto.replace(/(?<![a-zA-ZáéíóúÁÉÍÓÚñÑ])[oO] *(?=[-.+>~_=#×xX*\/@])/g, '0');
    texto = texto.replace(/(?<![a-zA-ZáéíóúÁÉÍÓÚñÑ])[oO] *(?=(com|con|c|cu|cdu|al|@l))/gi, '0');
    texto = texto.replace(/(\d|\.)([a-zA-ZáéíóúÁÉÍÓÚñÑ\ ]+)([-.+>~_=#×xX*\/@])/g, '$1$3');
    texto = texto.replace(/([-.+>~_=#×xX*\/@])([a-zA-ZáéíóúÁÉÍÓÚñÑ\ ]+)(\d)/g, '$1$3');
    texto = texto.replace(/(?<=\d) *(?:\. *)+(?=\d)/g, '-');
    texto = texto.replace(/(?<=\d) *(?:\; *)+(?=\d)/g, '-');
    texto = texto.replace(/(?<=\d) *(?:\, *)+(?=\d)/g, '-');
    texto = texto.replace(/[.,;]/g, '');
    texto = texto.replace(/(?<=\d) *(?:\= *)+(?=\d)/g, '-');
    texto = texto.replace(/(?<=\d) *(?:\_ *)+(?=\d)/g, '-');
    texto = texto.replace(/(?<=\d) *(?:\− *)+(?=\d)/g, '-');
    texto = texto.replace(/(?<=\d) *(?:\> *)+(?=\d)/g, '-');
    texto = texto.replace(/(?<=\d) *(?:\~ *)+(?=\d)/g, '-');
    texto = texto.replace(/(?<=\d) *(?:[-–—−‒―] *)+(?=\d)/g, '-');
    texto = texto.replace(/(?<=\d)\ *[#×xX*]+\ *(?=\d)/g, '+');
    
    if (barraConfig === "mas") {
        texto = texto.replace(/(\d{1,2}) *\/+ *(\d{1,2})/g, '$1+$2');
    } else if (barraConfig === "menos") {
        texto = texto.replace(/(\d) *\/+ *(\d)/g, '$1-$2');
    }
    
    texto = texto.replace(/(?<=\d) *(?:\- *)+(?=\d)/g, '-');
    texto = texto.replace(/(?<=\d) *(?:\+ *)+(?=\d)/g, '+');
    texto = texto.replace(/(\d) *([-+>~_=#×xX*\/@]) *([-+>~_=#×xX*\/@]) *(\d)/g, '$1∆$4');
    texto = texto.replace(/(\d{1,3}) *\@+ *(\d{1,3})/g, '$1al$2');
    texto = texto.replace(/(\d{1,3}) *\@l+ *(\d{1,3})/gi, '$1al$2');
    texto = texto.replace(/(\d{1,3}) *a+ *(\d{1,3})/gi, '$1al$2');
    texto = texto.replace(/(\d{2}) *al *(\d{2}) *(com|con|c|cu|cdu) *(\d{1,4})/gi, (m, p1, p2, p3, p4) => `${parseInt(p1).toString().padStart(2, '0')}al${parseInt(p2).padStart(2, '0')}-${p4}`);
    texto = texto.replace(/(?<=\d) *(com|con|cu|c|cdu) *([-]?\d+)/gi, (m, p1, p2) => `-${p2.replace('-', '')}`);
    
    const lineasOriginales = textoOriginal.split('\n');
    const lineasProcesadas = texto.split('\n');
    
    let listeroActual = null;
    const errores = [];
    
    for (let i = 0; i < lineasProcesadas.length; i++) {
        let linea = lineasProcesadas[i].trim();
        const lineaRef = lineasOriginales[i];
        
        if (!linea) continue;
        
        const matchEncabezado = linea.match(/^(?:\[[^\]]+\]\s*)?([^:]+):\s*(.*)/);
        if (matchEncabezado) {
            listeroActual = limpiarNombre(matchEncabezado[1].trim()) || "Desconocido";
            linea = matchEncabezado[2] || '';
        } else {
            if (!listeroActual) listeroActual = "Desconocido";
        }
        
        linea = linea.replace(/\ *[-]?\ *al\ *[-]?\ */gi, 'al');
        linea = linea.replace(/\ *-\ */g, '-');
        linea = linea.replace(/-{2,}/g, '-');
        linea = linea.replace(/\ *\+\ */g, '+');
        linea = linea.replace(/\++/g, '+');
        
        const jugadas = linea.split(/\s+/);
        
        for (let j of jugadas) {
            j = j.trim();
            j = j.replace(/^[a-zA-Z]+/, '');
            j = j.replace(/[a-zA-Z]+$/, '');
            j = j.replace(/^[^\d]+/, '');
            j = j.replace(/[^\d]+$/, '');
            j = j.replace(/\b(\d)\b/g, '0$1');
            j = j.replace(/\b(\d)(?=-)/g, '0$1');
            j = j.replace(/(?<=al)(\d)(?=-)/g, '0$1');
            
            const esValido = /^\d{2,3}(-\d+){1,2}$/.test(j) ||
                            /^\d{2}al\d{2}-\d+(-\d+)?$/i.test(j) ||
                            /^\d{3}al\d{3}-\d+(-\d+)?$/i.test(j) ||
                            /^\d{1,}al\d{1,}-\d+(-\d+)?$/i.test(j) ||
                            j.includes('+') ||
                            j.includes('/') ||
                            j.includes('(') ||
                            j.includes(':') ||
                            j.includes('∆');
            
            if (!esValido) continue;
            
            let errorTipo = null;
            
            if (barraConfig === "error" && j.includes('/')) errorTipo = "Carácter '/' no permitido.";
            if (j.includes('(')) errorTipo = "Carácter '(' no permitido.";
            if (j.includes(':')) errorTipo = "Carácter ':' no permitido.";
            if (j.includes('∆')) errorTipo = "Carácteres dobles distintos no permitido.";
            
            if (!errorTipo && j.toLowerCase().includes('al')) {
                const partes = j.toLowerCase().split('al');
                if (partes.length >= 2) {
                    const num1 = partes[0];
                    const num2 = partes[1].split('-')[0];
                    if (/^\d+$/.test(num1) && /^\d+$/.test(num2)) {
                        if (!((num1.length === 2 && num2.length === 2) || (num1.length === 3 && num2.length === 3))) {
                            errorTipo = "Los números de la serie deben tener la misma cantidad de dígitos (2 o 3)";
                        }
                    }
                }
            }
            
            if (!errorTipo && j.includes('+')) {
                const partes = j.split('-');
                if (partes.length === 1) errorTipo = "Parlet/candado sin monto fijo";
                else if (partes.length > 2) errorTipo = "Parlet/candados no llevan monto corrido";
                else {
                    const monto = parseInt(partes[1]);
                    if (isNaN(monto)) errorTipo = "Monto inválido";
                    else {
                        const listaNumeros = partes[0].split('+');
                        for (const num of listaNumeros) {
                            if (!/^\d+$/.test(num) || num.length > 2) {
                                errorTipo = `Número inválido en candado (${num}).`;
                                break;
                            }
                        }
                        if (!errorTipo) {
                            if (listaNumeros.length >= 3) {
                                for (let a = 0; a < listaNumeros.length; a++) {
                                    for (let b = a + 1; b < listaNumeros.length; b++) {
                                        agregarJugada(listeroActual, 'Parlet', [listaNumeros[a], listaNumeros[b]].sort().join('+'), monto);
                                    }
                                }
                            } else if (listaNumeros.length === 2) {
                                agregarJugada(listeroActual, 'Parlet', listaNumeros.sort().join('+'), monto);
                            }
                            continue;
                        }
                    }
                }
            }
            
            if (!errorTipo) {
                if (serieCentenaPatron.test(j) && (j.match(/-/g) || []).length >= 2) errorTipo = "Centenas no llevan monto corrido";
                else if (j.split('-').length === 3 && /^\d{3}$/.test(j.split('-')[0])) errorTipo = "Centenas no llevan monto corrido";
            }
            
            if (errorTipo) {
                errores.push({ jugada: j, tipo: errorTipo, linea: lineaRef });
                continue;
            }
            
            if (j.includes('+')) {
                const partes = j.split('-');
                const monto = parseInt(partes[1]);
                if (!isNaN(monto)) agregarJugada(listeroActual, 'Parlet', partes[0], monto);
                continue;
            }
            
            const matchCentena = j.match(serieCentenaPatron);
            if (matchCentena) {
                const resultados = desglosarSerieCentena(matchCentena[1], matchCentena[2], parseInt(matchCentena[3]));
                if (resultados.length > 0) {
                    for (const { numero, fijo } of resultados) agregarJugada(listeroActual, 'Centena', numero, fijo);
                } else {
                    errores.push({ jugada: j, tipo: "serie de centenas", linea: lineaRef });
                }
                continue;
            }
            
            const matchSerie = j.match(seriePatron);
            if (matchSerie) {
                const resultados = desglosarSerie(matchSerie[1], matchSerie[2], parseInt(matchSerie[3]), matchSerie[4] ? parseInt(matchSerie[4]) : null);
                if (resultados.length > 0) {
                    for (const { numero, fijo, corrido } of resultados) {
                        agregarJugada(listeroActual, 'Fijo', numero, fijo);
                        if (corrido) agregarJugada(listeroActual, 'Corrido', numero, corrido);
                    }
                } else {
                    errores.push({ jugada: j, tipo: "serie de dos dígitos", linea: lineaRef });
                }
                continue;
            }
            
            const partes = j.split('-');
            if (partes.length === 2 && /^\d+$/.test(partes[0])) {
                if (partes[0].length === 3) {
                    agregarJugada(listeroActual, 'Centena', partes[0], parseInt(partes[1]));
                } else {
                    agregarJugada(listeroActual, 'Fijo', parseInt(partes[0]).toString().padStart(2, '0'), parseInt(partes[1]));
                }
            } else if (partes.length === 3 && /^\d+$/.test(partes[0])) {
                const numFormateado = partes[0].length < 3 ? parseInt(partes[0]).toString().padStart(2, '0') : partes[0];
                agregarJugada(listeroActual, 'Fijo', numFormateado, parseInt(partes[1]));
                agregarJugada(listeroActual, 'Corrido', numFormateado, parseInt(partes[2]));
            }
        }
    }
    
    return { listeros, errores, tieneErrores: errores.length > 0 };
}

function formatearResultados(listeros) {
    let texto = "📊 *RESULTADOS DE JUGADAS*\n\n";
    const ordenTipos = ['Fijo', 'Corrido', 'Centena', 'Parlet'];
    
    for (const [listero, tipos] of Object.entries(listeros)) {
        const totalListero = Object.values(tipos).reduce((acc, nums) => acc + Object.values(nums).reduce((a, b) => a + b, 0), 0);
        texto += `📋 *${listero}* - Total: ${totalListero} pesos\n`;
        
        for (const tipo of ordenTipos) {
            if (tipos[tipo] && Object.keys(tipos[tipo]).length > 0) {
                texto += `  🟢 *${tipo}:*\n`;
                for (const [num, monto] of Object.entries(tipos[tipo]).sort((a, b) => b[1] - a[1])) {
                    texto += `     ${num} → ${monto}\n`;
                }
            }
        }
        texto += '\n';
    }
    return texto;
}

function formatearErrores(errores) {
    if (errores.length === 0) return '';
    let texto = "⚠️ *ERRORES ENCONTRADOS*\n\n";
    errores.forEach((err, i) => {
        texto += `${i + 1}. *${err.jugada}*\n   ${err.tipo}\n   Línea: ${err.linea}\n\n`;
    });
    return texto;
}

function calcularPremios(userId, listeros, pick3, pick4, configPremios) {
    const ganadorFijo = pick3.slice(-2);
    const ganadorCentena = pick3;
    const corridos = [pick4.slice(0, 2), pick4.slice(-2), pick3.slice(-2)];
    
    const parletsGanadores = new Set();
    for (let i = 0; i < corridos.length; i++) {
        for (let j = i + 1; j < corridos.length; j++) {
            parletsGanadores.add([corridos[i], corridos[j]].sort().join('+'));
        }
    }
    
    const premios = {};
    const detalles = {};
    
    for (const [listero, tipos] of Object.entries(listeros)) {
        premios[listero] = {};
        detalles[listero] = {};
        
        if (tipos.Fijo) {
            premios[listero].Fijo = 0;
            detalles[listero].Fijo = [];
            for (const [num, monto] of Object.entries(tipos.Fijo)) {
                if (num === ganadorFijo) {
                    premios[listero].Fijo += monto * configPremios.Fijo;
                    detalles[listero].Fijo.push(`${num}-${monto}`);
                }
            }
            if (premios[listero].Fijo === 0) delete premios[listero].Fijo;
            if (detalles[listero].Fijo.length === 0) delete detalles[listero].Fijo;
        }
        
        if (tipos.Centena) {
            premios[listero].Centena = 0;
            detalles[listero].Centena = [];
            for (const [num, monto] of Object.entries(tipos.Centena)) {
                if (num === ganadorCentena) {
                    premios[listero].Centena += monto * configPremios.Centena;
                    detalles[listero].Centena.push(`${num}-${monto}`);
                }
            }
            if (premios[listero].Centena === 0) delete premios[listero].Centena;
            if (detalles[listero].Centena.length === 0) delete detalles[listero].Centena;
        }
        
        if (tipos.Corrido) {
            premios[listero].Corrido = 0;
            detalles[listero].Corrido = [];
            for (const [num, monto] of Object.entries(tipos.Corrido)) {
                const vecesGanadora = corridos.filter(c => c === num).length;
                if (vecesGanadora > 0) {
                    premios[listero].Corrido += monto * configPremios.Corrido * vecesGanadora;
                    for (let i = 0; i < vecesGanadora; i++) {
                        detalles[listero].Corrido.push(`${num}-${monto}`);
                    }
                }
            }
            if (premios[listero].Corrido === 0) delete premios[listero].Corrido;
            if (detalles[listero].Corrido.length === 0) delete detalles[listero].Corrido;
        }
        
        if (tipos.Parlet) {
            premios[listero].Parlet = 0;
            detalles[listero].Parlet = [];
            for (const [nums, monto] of Object.entries(tipos.Parlet)) {
                if (parletsGanadores.has(nums.split('+').sort().join('+'))) {
                    premios[listero].Parlet += monto * configPremios.Parlet;
                    detalles[listero].Parlet.push(`${nums}-${monto}`);
                }
            }
            if (premios[listero].Parlet === 0) delete premios[listero].Parlet;
            if (detalles[listero].Parlet.length === 0) delete detalles[listero].Parlet;
        }
    }
    
    return { premios, detalles, ganadorFijo, ganadorCentena, corridos, parletsGanadores: [...parletsGanadores] };
}

// ============================================
// CORRECCIÓN DE SERIES VERTICALES (Usado por OCR)
// ============================================
function corregirSeriesVerticales(texto) {
    const lineas = texto.split('\n');
    const resultado = [];
    let i = 0;
    
    while (i < lineas.length) {
        if (i + 2 < lineas.length) {
            const l1 = lineas[i].trim();
            const l2 = lineas[i + 1].toLowerCase();
            const l3 = lineas[i + 2].trim();
            
            if (/^\d+$/.test(l1) && /^\d+$/.test(l3) && (l2.includes('al') || l2.includes('@'))) {
                const monto = l2.match(/\d+/g);
                if (monto && monto.length > 0) {
                    resultado.push(`${parseInt(l1).toString().padStart(2, '0') }al${parseInt(l3).toString().padStart(2, '0') }-${monto[0]}`);
                    i += 3;
                    continue;
                }
            }
        }
        resultado.push(lineas[i].trim());
        i++;
    }
    
    return resultado.join('\n');
}

// ============================================
// SISTEMA DE VINCULACIÓN LID -> TELÉFONO
// ============================================
const CODIGOS_VINCULACION = {}; // Temporal en memoria

function generarCodigoVinculacion(phoneNumber) {
    const usuarios = cargarUsuariosAcceso();
    const indexUsuario = usuarios.findIndex(u => u.phone === phoneNumber);
    
    if (indexUsuario === -1) return null; // El número no tiene licencia
    
    const codigo = 'VINC-' + Math.floor(1000 + Math.random() * 9000);
    CODIGOS_VINCULACION[codigo] = { userId: phoneNumber, expira: Date.now() + (5 * 60 * 1000) };
    
    return codigo;
}

function vincularLidConCodigo(codigo, lidCompleto) {
    const datosCodigo = CODIGOS_VINCULACION[codigo];
    if (!datosCodigo) return { exito: false, mensaje: "❌ Código inválido o expirado." };
    
    if (Date.now() > datosCodigo.expira) {
        delete CODIGOS_VINCULACION[codigo];
        return { exito: false, mensaje: "❌ El código ha expirado. Genera uno nuevo en privado." };
    }
    
    const usuarios = cargarUsuariosAcceso();
    const indexUsuario = usuarios.findIndex(u => u.phone === datosCodigo.userId);
    
    if (indexUsuario === -1) return { exito: false, mensaje: "❌ Usuario no encontrado." };
    
    if (!usuarios[indexUsuario].groupLids) usuarios[indexUsuario].groupLids = [];
    
    // Evitar duplicados
    if (!usuarios[indexUsuario].groupLids.includes(lidCompleto)) {
        usuarios[indexUsuario].groupLids.push(lidCompleto);
        guardarUsuariosAcceso(usuarios);
    }
    
    delete CODIGOS_VINCULACION[codigo];
    
    return { exito: true, mensaje: `✅ *Vinculación exitosa*\n\nTu cuenta (${datosCodigo.userId}) ahora está vinculada a este grupo.` };
}

// ============================================
// FUNCIÓN MAESTRA PARA RESOLVER IDs
// ============================================
function resolverUserId(m) {
    const chatJid = m.key?.remoteJid || '';
    const senderId = m.sender || '';
    
    if (chatJid.includes('@g.us')) {
        // ESTAMOS EN UN GRUPO
        if (senderId.includes('@lid')) {
            // Buscar el @lid en la base de datos
            const usuarios = cargarUsuariosAcceso();
            const usuario = usuarios.find(u => u.groupLids && u.groupLids.includes(senderId));
            if (usuario) return usuario.phone; // Retornar el teléfono real
        }
        // Si no es @lid o no está vinculado, extraer el número normal
        return senderId.split('@')[0].replace(/\D/g, '');
    } else {
        // ESTAMOS EN CHAT PRIVADO
        // En privado, el ID del chat SIEMPRE es el número de teléfono real
        return chatJid.split('@')[0].replace(/\D/g, '');
    }
}

// ============================================
// EXPORTS
// ============================================
module.exports = {
    procesarMensajeConContexto,
    formatearResultados,
    formatearErrores,
    cargarUltimaLoteria,
    guardarUltimaLoteria,
    cargarConfiguracionPremios,
    guardarConfiguracionPremios,
    cargarListerosPorciento,
    guardarListerosPorciento,
    LOTERIAS,
    DEFAULT_CONFIG,
    calcularPremios,
    verificarAccesoUsuario,
    corregirSeriesVerticales,
    cargarUsuariosAcceso,   // ¡¡EXPORTADO!!
    guardarUsuariosAcceso,  // ¡¡EXPORTADO!!
    resolverUserId          // ¡¡NUEVA FUNCIÓN MAESTRA!!
};
