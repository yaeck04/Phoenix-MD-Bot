// ============================================
// ocr_auto.js - OCR Automático Interactivo v4
// Soporte para múltiples imágenes simultáneas
// ============================================
console.log('[OCR-AUTO-INIT] 📸 Plugin OCR Automático Interactivo cargándose...');

let pnix, procesarMensajeConContexto, formatearResultados, formatearErrores, verificarAccesoUsuario, corregirSeriesVerticales, cargarUltimaLoteria, calcularPremios, cargarConfiguracionPremios, cargarListerosPorciento;
let downloadContentFromMessage = null;

try {
    const commands = require('../lib/commands');
    pnix = commands.pnix;
} catch (e) {
    console.error('[OCR-AUTO-INIT] ❌ Error pnix:', e.message);
}

try {
    const jugadas = require('../lib/jugadas.cjs');
    procesarMensajeConContexto = jugadas.procesarMensajeConContexto;
    formatearResultados = jugadas.formatearResultados;
    formatearErrores = jugadas.formatearErrores;
    verificarAccesoUsuario = jugadas.verificarAccesoUsuario;
    corregirSeriesVerticales = jugadas.corregirSeriesVerticales;
    cargarUltimaLoteria = jugadas.cargarUltimaLoteria;
    calcularPremios = jugadas.calcularPremios;
    cargarConfiguracionPremios = jugadas.cargarConfiguracionPremios;
    cargarListerosPorciento = jugadas.cargarListerosPorciento;
} catch (e) {
    console.error('[OCR-AUTO-INIT] ❌ Error jugadas.cjs:', e.message);
}

const fs = require('fs');
const path = require('path');
const https = require('https');

// ============================================
// IMPORTAR BAILEYS
// ============================================
async function cargarFuncionDescarga() {
    try {
        const baileysUtils = await import('@whiskeysockets/baileys/lib/Utils/messages-media.js');
        downloadContentFromMessage = baileysUtils.downloadContentFromMessage;
        if (typeof downloadContentFromMessage === 'function') {
            console.log('[OCR-AUTO-INIT] ✅ downloadContentFromMessage importada');
            return true;
        }
        return false;
    } catch (e) {
        console.error('[OCR-AUTO-INIT] ❌ Error Baileys:', e.message);
        return false;
    }
}
cargarFuncionDescarga();

// ============================================
// SESIONES INTERACTIVAS
// ============================================
const sesiones = {};
const ESTADO = { CORRIGIENDO: 'corrigiendo', ESPERANDO_PREMIOS: 'esperando_premios' };
const TIMEOUT_SESION = 5 * 60 * 1000;

const procesandoImagen = {};

// ============================================
// 🆕 BUFFER DE IMÁGENES (múltiples imágenes)
// ============================================
const bufferImagenes = {};    // userId -> [filePath, filePath, ...]
const bufferTimers = {};      // userId -> setTimeout ID
const BUFFER_ESPERA = 4000;   // 4 segundos para acumular imágenes

function crearSesion(userId, datos) {
    sesiones[userId] = { ...datos, intentos: 0, timestamp: Date.now() };
}

function cerrarSesion(userId) {
    delete sesiones[userId];
    delete procesandoImagen[userId];
}

function tieneSesionActiva(userId) {
    const s = sesiones[userId];
    if (!s) return false;
    if (Date.now() - s.timestamp > TIMEOUT_SESION) { cerrarSesion(userId); return false; }
    return true;
}

function renovarSesion(userId) {
    if (sesiones[userId]) sesiones[userId].timestamp = Date.now();
}

// ============================================
// FUSIONAR JUGADAS
// ============================================
function fusionarListeros(principal, correccion) {
    for (const [listero, tipos] of Object.entries(correccion)) {
        if (!principal[listero]) principal[listero] = { Fijo: {}, Corrido: {}, Centena: {}, Parlet: {} };
        for (const [tipo, nums] of Object.entries(tipos)) {
            if (!principal[listero][tipo]) principal[listero][tipo] = {};
            for (const [num, monto] of Object.entries(nums)) {
                principal[listero][tipo][num] = (principal[listero][tipo][num] || 0) + monto;
            }
        }
    }
}

// ============================================
// CONFIG TOGGLE
// ============================================
const OCR_AUTO_CONFIG = './data/ocr_auto_config.json';

function cargarConfigAuto() {
    try {
        if (fs.existsSync(OCR_AUTO_CONFIG)) return JSON.parse(fs.readFileSync(OCR_AUTO_CONFIG, 'utf-8'));
    } catch (e) {}
    return { global: true };
}

function guardarConfigAuto(config) {
    try {
        const dir = path.dirname(OCR_AUTO_CONFIG);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(OCR_AUTO_CONFIG, JSON.stringify(config, null, 2));
    } catch (e) {}
}

function autoOcrActivado(userId) {
    const c = cargarConfigAuto();
    if (c[userId] !== undefined) return c[userId];
    return c.global !== false;
}

function toggleAutoOcr(userId, estado) {
    const c = cargarConfigAuto();
    c[userId] = estado;
    guardarConfigAuto(c);
    return estado;
}

// ============================================
// HELPERS
// ============================================
function extraerUserId(m) {
    let raw = m.sender || m.user || m.from || '';
    if (raw.includes('@')) raw = raw.split('@')[0];
    raw = raw.replace(/\D/g, '');
    return raw.length >= 7 ? raw : null;
}

function tieneImagen(m) {
    if (m.msg?.mimetype?.startsWith('image/')) return 'directa';
    if (m.quoted?.msg?.mimetype?.startsWith('image/')) return 'citada';
    if (m.data?.message?.imageMessage) return 'data';
    return null;
}

function esComando(m) {
    const t = m.text || m.body || '';
    return /^[•·#!.,\/\\$%^&*()_=+~`;:'"<>?|]/.test(t.trim());
}

// ============================================
// DESCARGAR IMAGEN
// ============================================
async function descargarImagen(m, conn) {
    try {
        let imgMsg = null;
        if (m.data?.message?.imageMessage) imgMsg = m.data.message.imageMessage;
        else if (m.msg?.mimetype?.startsWith('image/')) imgMsg = m.msg;
        else if (m.quoted?.data?.message?.imageMessage) imgMsg = m.quoted.data.message.imageMessage;
        else if (m.quoted?.msg?.mimetype?.startsWith('image/')) imgMsg = m.quoted.msg;

        if (!imgMsg?.mediaKey) return null;
        const client = m.client;
        if (!client) return null;

        if (downloadContentFromMessage) {
            try {
                const stream = await downloadContentFromMessage(imgMsg, 'image', {
                    mediaKey: imgMsg.mediaKey, mediaKeyTimestamp: imgMsg.mediaKeyTimestamp, url: imgMsg.url
                });
                if (stream) {
                    const chunks = [];
                    for await (const chunk of stream) chunks.push(chunk);
                    const buffer = Buffer.concat(chunks);
                    if (buffer.length > 0) {
                        const tempDir = './temp_images';
                        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
                        const fp = path.join(tempDir, `ocr_auto_${Date.now()}_${Math.random().toString(36).slice(2,6)}.jpg`);
                        fs.writeFileSync(fp, buffer);
                        console.log(`[OCR-AUTO] ✅ DESCARGADA: ${fp} (${buffer.length} bytes)`);
                        return fp;
                    }
                }
            } catch (e) { console.log('[OCR-AUTO] downloadContentFromMessage error:', e.message); }
        }

        try {
            const bk = Object.keys(require.cache).find(k => k.includes('baileys') && k.includes('messages-media'));
            if (bk) {
                const cm = require.cache[bk];
                if (cm?.exports?.downloadContentFromMessage) {
                    const stream = await cm.exports.downloadContentFromMessage(imgMsg, 'image', {});
                    const chunks = [];
                    for await (const chunk of stream) chunks.push(chunk);
                    const buffer = Buffer.concat(chunks);
                    if (buffer.length > 0) {
                        const tempDir = './temp_images';
                        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
                        const fp = path.join(tempDir, `ocr_auto_${Date.now()}_${Math.random().toString(36).slice(2,6)}.jpg`);
                        fs.writeFileSync(fp, buffer);
                        return fp;
                    }
                }
            }
        } catch (e) {}

        if (client._client) {
            try {
                const buffer = await client._client.downloadMediaMessage(m.data, 'buffer', {});
                if (buffer && buffer.length > 0) {
                    const tempDir = './temp_images';
                    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
                    const fp = path.join(tempDir, `ocr_auto_${Date.now()}_${Math.random().toString(36).slice(2,6)}.jpg`);
                    fs.writeFileSync(fp, buffer);
                    return fp;
                }
            } catch (e) {}
        }

        return null;
    } catch (error) {
        console.error('[OCR-AUTO] ❌ Error descargando:', error);
        return null;
    }
}

// ============================================
// API OCR
// ============================================
async function ocrShforge(filePath) {
    return new Promise((resolve) => {
        try {
            const fileBuffer = fs.readFileSync(filePath);
            const filename = path.basename(filePath);
            const boundary = '----OCR' + Math.random().toString(36).substring(2);
            const header = `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`;
            const footer = `\r\n--${boundary}--\r\n`;
            const postData = Buffer.concat([Buffer.from(header), fileBuffer, Buffer.from(footer)]);

            const req = https.request({
                hostname: 'api-image-to-text.shforge.com', path: '/api/ocr/recognize', method: 'POST',
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${boundary}`, 'accept': 'application/json',
                    'X-API-Key': '9f3a1e7c-4b2d-4f89-b6e3-1a8c7d5e0b42', 'Content-Length': postData.length
                }
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        resolve(json.success === true && json.text ? json.text : null);
                    } catch (e) { resolve(null); }
                });
            });
            req.on('error', () => resolve(null));
            req.setTimeout(30000, () => { req.destroy(); resolve(null); });
            req.write(postData); req.end();
        } catch (e) { resolve(null); }
    });
}

// ============================================
// CORREGIR TEXTO OCR
// ============================================
function corregirTextoOcr(texto) {
    texto = texto.replace(/(\d{2,3})x(\d{2,3})/g, '$1+$2');
    texto = texto.replace(/(4l\s*>|41\s*>|A1\s*>)/gi, 'AL>');
    texto = texto.replace(/(\d{2})\s*(4l|41|A1)\s*(\d{2})/gi, '$1Al$3');
    texto = texto.replace(/(\d{2,3})\s+(?:al|@l)\s+(?:com|con|c|cu|cdu)\s+(\d+)/gi, '$1al$2-$3');
    if (typeof corregirSeriesVerticales === 'function') texto = corregirSeriesVerticales(texto);
    return texto;
}

// ============================================
// GENERAR TIKE
// ============================================
function generarTike(userId, listeros, premios, detalles, totalesListeros, pick3, pick4) {
    const loteria = typeof cargarUltimaLoteria === 'function' ? cargarUltimaLoteria(userId) : 'Florida';
    const listerosPorciento = typeof cargarListerosPorciento === 'function' ? cargarListerosPorciento(userId, loteria) : {};

    let tike = `✏️🗒️Cortes de Listeros: \n\n`;

    for (const [listero, tipos] of Object.entries(premios)) {
        const totalListero = totalesListeros[listero] || 0;
        tike += `📋Listero: ${listero} \n`;
        tike += `#Ganadores: ${pick3} ${pick4} \n`;

        let totalJugado = 0;
        if (listeros[listero]) {
            for (const tipoJugada of Object.values(listeros[listero])) {
                totalJugado += Object.values(tipoJugada).reduce((a, b) => a + b, 0);
            }
        }
        tike += `💰Total recogido: ${totalJugado} cup \n`;

        const datosListero = listerosPorciento[listero] || { porciento: 0, deuda: 0 };
        const porcentaje = datosListero.porciento || 0;
        const montoPorcentaje = totalJugado - (totalJugado * porcentaje / 100);

        tike += `📝Recogido - ${porcentaje}%: ${Math.round(montoPorcentaje)} cup \n`;
        tike += `🏆Total premio: ${totalListero} cup \n`;

        for (const [tipo, monto] of Object.entries(tipos)) {
            const montosVistos = new Set();
            let montoJugado = 0;
            if (detalles[listero][tipo]) {
                for (const detalle of detalles[listero][tipo]) {
                    if (!montosVistos.has(detalle)) {
                        montosVistos.add(detalle);
                        const partes = detalle.split('-');
                        montoJugado += parseInt(partes[partes.length - 1]);
                    }
                }
            }
            tike += `  ${tipo}: ${montoJugado} -> ${monto} CUP\n`;
            for (const det of detalles[listero][tipo]) tike += `     ${det}\n`;
        }
        tike += `\n`;

        const balance = montoPorcentaje - totalListero;
        if (balance > 0) tike += `🫵🫰 Debes: ${Math.round(balance)} CUP\n`;
        else if (balance < 0) tike += `🥳🎉 Ganaste: ${Math.abs(Math.round(balance))} CUP\n`;
        else tike += `Balance neutro en lista\n`;
        tike += `⚡⚡⚡⚡⚡⚡⚡⚡\n\n\n`;
    }

    const listerosConPremio = new Set(Object.keys(premios));
    for (const [listero, tipos] of Object.entries(listeros)) {
        if (listerosConPremio.has(listero)) continue;
        let totalJugado = 0;
        for (const tipoJugada of Object.values(tipos)) totalJugado += Object.values(tipoJugada).reduce((a, b) => a + b, 0);
        const datosListero = listerosPorciento[listero] || { porciento: 0, deuda: 0 };
        const porcentaje = datosListero.porciento || 0;
        let montoPorcentaje = totalJugado - (totalJugado * porcentaje / 100);
        if (montoPorcentaje === 0) montoPorcentaje = totalJugado;
        tike += `📋Listeros: ${listero} \n`;
        tike += `#Ganadores: ${pick3} ${pick4} \n`;
        tike += `💰Total recogido: ${totalJugado} cup \n`;
        tike += `📝Recogido - ${porcentaje}%: ${Math.round(montoPorcentaje)} cup \n`;
        tike += `🏆Total premio: 👌Sin premio \n\n`;
        tike += `🫵🫰 Debes: ${Math.round(montoPorcentaje)} cup \n`;
        tike += `⚡⚡⚡⚡⚡⚡⚡⚡ \n\n\n`;
    }
    return tike.trim();
}

// ============================================
// ENVIAR RESULTADOS
// ============================================
async function enviarResultados(m, listeros, tiempoLicencia, loteria, numImagenes) {
    if (!listeros || Object.keys(listeros).length === 0) {
        return m.reply('❌ *No se encontraron jugadas válidas*');
    }

    const totalJugadas = Object.values(listeros).reduce(
        (acc, tipos) => acc + Object.values(tipos).reduce((a, nums) => a + Object.keys(nums).length, 0), 0
    );
    const totalMonto = Object.values(listeros).reduce(
        (acc, tipos) => acc + Object.values(tipos).reduce((a, nums) => a + Object.values(nums).reduce((s, v) => s + v, 0), 0), 0
    );

    let respuesta = `📸 *OCR COMPLETADO*\n\n`;
    if (numImagenes > 1) respuesta += `🖼️ *Imágenes procesadas: ${numImagenes}*\n\n`;
    respuesta += `📊 *Resumen:*\n`;
    respuesta += `   • Jugadas: ${totalJugadas}\n`;
    respuesta += `   • Monto total: ${totalMonto} pesos\n\n`;
    respuesta += `${'━'.repeat(25)}\n\n`;

    if (typeof formatearResultados === 'function') respuesta += formatearResultados(listeros);

    respuesta += `\n${'━'.repeat(25)}\n`;
    respuesta += `🎰 _Lotería: ${loteria}_\n`;
    if (tiempoLicencia) respuesta += `⏳ _Licencia: ${tiempoLicencia}_\n`;

    if (respuesta.length > 4000) {
        const partes = [];
        let parte = '';
        for (const linea of respuesta.split('\n')) {
            if ((parte + linea + '\n').length > 4000) { if (parte) partes.push(parte); parte = linea + '\n'; }
            else parte += linea + '\n';
        }
        if (parte) partes.push(parte);
        for (const p of partes) { await m.reply(p); await new Promise(r => setTimeout(r, 500)); }
    } else {
        await m.reply(respuesta);
    }
}

// ============================================
// MOSTRAR ERROR ACTUAL
// ============================================
async function mostrarErrorActual(m, sesion) {
    const error = sesion.errores[0];
    const total = sesion.errores.length;

    let msg = `⚠️ *ERRORES POR CORREGIR* (${total} restante${total > 1 ? 's' : ''})\n\n`;
    if (sesion.numImagenes > 1) msg += `🖼️ _Procesadas ${sesion.numImagenes} imágenes_\n\n`;
    msg += `❌ *Jugada con error:*\n`;
    msg += `   📝 \`${error.jugada}\`\n`;
    msg += `   📋 Problema: _${error.tipo}_\n\n`;
    msg += `✏️ *Envía la jugada corregida:*\n`;
    msg += `   _Ejemplo: \`44-8\` o \`44-8-5\`_\n\n`;
    msg += `📌 *Opciones:*\n`;
    msg += `   • Envía la corrección directamente\n`;
    msg += `   • Escribe *saltar* para ignorar\n`;
    msg += `   • Escribe *cancelar* para terminar`;

    if (sesion.intentos > 0) msg += `\n\n⚠️ Intento #${sesion.intentos + 1}`;

    await m.reply(msg);
}

// ============================================
// CALCULAR Y MOSTRAR PREMIOS
// ============================================
async function calcularYMostrarPremios(m, userId, listeros, pick3, pick4) {
    if (typeof calcularPremios !== 'function' || typeof cargarConfiguracionPremios !== 'function') {
        return m.reply('❌ *Error:* Funciones de premios no disponibles.');
    }

    const loteria = typeof cargarUltimaLoteria === 'function' ? cargarUltimaLoteria(userId) : 'Florida';
    const configPremios = cargarConfiguracionPremios(userId, loteria);

    const { premios, detalles, ganadorFijo, ganadorCentena, corridos, parletsGanadores } =
        calcularPremios(userId, listeros, pick3, pick4, configPremios);

    let totalGeneral = 0;
    const totalesListeros = {};
    for (const [listero, tipos] of Object.entries(premios)) {
        const total = Object.values(tipos).reduce((acc, val) => acc + val, 0);
        totalesListeros[listero] = total;
        totalGeneral += total;
    }

    if (totalGeneral === 0) {
        const tike = generarTike(userId, listeros, {}, {}, {}, pick3, pick4);
        await m.reply(
            `😔 *Sin premios para Pick3=${pick3} Pick4=${pick4}*\n\n` +
            `✔️ Fijo: ${ganadorFijo}\n✔️ Centena: ${ganadorCentena}\n` +
            `✔️ Corridos: ${corridos.join(', ')}\n✔️ Parlets: ${parletsGanadores.join(', ')}`
        );
        await new Promise(r => setTimeout(r, 800));
        await m.reply(tike);
        return;
    }

    let respuesta = `🏆 *PREMIOS Pick3=${pick3} Pick4=${pick4}*\n\n`;
    respuesta += `✔️ Fijo ganador: ${ganadorFijo}\n`;
    respuesta += `✔️ Centena: ${ganadorCentena}\n`;
    respuesta += `✔️ Corridos: ${corridos.join(', ')}\n`;
    respuesta += `✔️ Parlets: ${parletsGanadores.join(', ')}\n`;
    respuesta += `━━━━━━━━━━━━━━━━━━\n`;
    respuesta += `💰 *Total a pagar: ${totalGeneral} CUP*\n`;
    respuesta += `━━━━━━━━━━━━━━━━━━\n\n`;

    const listerosPorciento = typeof cargarListerosPorciento === 'function' ? cargarListerosPorciento(userId, loteria) : {};

    for (const [listero, tipos] of Object.entries(premios)) {
        const totalListero = totalesListeros[listero];
        let totalJugado = 0;
        if (listeros[listero]) {
            for (const tipoJugada of Object.values(listeros[listero])) {
                totalJugado += Object.values(tipoJugada).reduce((a, b) => a + b, 0);
            }
        }
        const datosListero = listerosPorciento[listero] || { porciento: 0, deuda: 0 };
        const porcentaje = datosListero.porciento || 0;
        const montoDespuesPorcentaje = totalJugado - (totalJugado * porcentaje / 100);
        const balance = montoDespuesPorcentaje - totalListero;

        respuesta += `📋 *${listero}* - Total: ${totalListero} CUP\n`;
        if (balance > 0) respuesta += `Ganancias en lista: ${Math.round(balance)} CUP\n`;
        else if (balance < 0) respuesta += `Pérdidas en lista: ${Math.abs(Math.round(balance))} CUP\n`;
        else respuesta += `Balance neutro en lista\n`;

        for (const [tipo, monto] of Object.entries(tipos)) {
            const montosVistos = new Set();
            let montoJugado = 0;
            if (detalles[listero][tipo]) {
                for (const detalle of detalles[listero][tipo]) {
                    if (!montosVistos.has(detalle)) {
                        montosVistos.add(detalle);
                        const partes = detalle.split('-');
                        montoJugado += parseInt(partes[partes.length - 1]);
                    }
                }
            }
            respuesta += `   🟢 ${tipo}: ${montoJugado} → ${monto} CUP\n`;
            for (const det of detalles[listero][tipo]) respuesta += `      ${det}\n`;
        }
        respuesta += '\n';
    }

    if (respuesta.length > 4000) {
        const partes = [];
        let parte = '';
        for (const linea of respuesta.split('\n')) {
            if ((parte + linea + '\n').length > 4000) { if (parte) partes.push(parte); parte = linea + '\n'; }
            else parte += linea + '\n';
        }
        if (parte) partes.push(parte);
        for (const p of partes) { await m.reply(p); await new Promise(r => setTimeout(r, 500)); }
    } else {
        await m.reply(respuesta);
    }

    await new Promise(r => setTimeout(r, 800));
    const tike = generarTike(userId, listeros, premios, detalles, totalesListeros, pick3, pick4);
    if (tike.length > 4000) {
        const partes = [];
        let parte = '';
        for (const linea of tike.split('\n')) {
            if ((parte + linea + '\n').length > 4000) { if (parte) partes.push(parte); parte = linea + '\n'; }
            else parte += linea + '\n';
        }
        if (parte) partes.push(parte);
        for (const p of partes) { await m.reply(p); await new Promise(r => setTimeout(r, 500)); }
    } else {
        await m.reply(tike);
    }
}

// ============================================
// 🆕 PROCESAR BUFFER DE IMÁGENES
// (Se ejecuta cuando se agotó el tiempo de espera)
// ============================================
async function procesarBuffer(userId, conn) {
    const archivos = bufferImagenes[userId] || [];
    delete bufferImagenes[userId];
    delete bufferTimers[userId];

    if (archivos.length === 0) {
        delete procesandoImagen[userId];
        return;
    }

    console.log(`[OCR-AUTO] 🔄 Procesando ${archivos.length} imagen${archivos.length > 1 ? 'es' : ''} de ${userId}`);

    // Obtener datos de la sesión temporal
    const datosTemp = sesiones[`_buffer_${userId}`] || {};
    const tiempoLicencia = datosTemp.tiempoLicencia || null;
    const loteria = datosTemp.loteria || 'Florida';

    // Reaccionar al primer mensaje
    const primerM = datosTemp.primerMensaje;
    if (primerM) {
        try { await primerM.react('⏳'); } catch (e) {}
    }

    // Procesar cada imagen
    const listerosTotal = {};
    const erroresTotal = [];
    let imagenesOK = 0;

    for (let i = 0; i < archivos.length; i++) {
        const filePath = archivos[i];

        // OCR
        let textoOcr = await ocrShforge(filePath);
        try { fs.unlinkSync(filePath); } catch (e) {}

        if (!textoOcr || textoOcr.trim().length === 0) {
            console.log(`[OCR-AUTO] ⚠️ Imagen ${i + 1}/${archivos.length} sin texto`);
            continue;
        }

        textoOcr = corregirTextoOcr(textoOcr);

        if (typeof procesarMensajeConContexto !== 'function') continue;

        const resultado = procesarMensajeConContexto(userId, textoOcr);

        // Fusionar jugadas válidas
        if (resultado.listeros) {
            fusionarListeros(listerosTotal, resultado.listeros);
        }

        // Acumular errores
        if (resultado.errores && resultado.errores.length > 0) {
            erroresTotal.push(...resultado.errores);
        }

        imagenesOK++;
        console.log(`[OCR-AUTO] ✅ Imagen ${i + 1}/${archivos.length} procesada`);
    }

    // Borrar sesión temporal
    delete sesiones[`_buffer_${userId}`];

    // Guardar para .premios manual
    if (!globalThis.jugadasPorUsuario) globalThis.jugadasPorUsuario = {};
    globalThis.jugadasPorUsuario[userId] = { listeros: listerosTotal, errores: erroresTotal };

    // Quitar lock
    delete procesandoImagen[userId];

    if (imagenesOK === 0) {
        if (primerM) primerM.reply('❌ *No se detectó texto en ninguna imagen*');
        return;
    }

    // ================================
    // ¿HAY ERRORES? → SESIÓN INTERACTIVA
    // ================================
    if (erroresTotal.length > 0) {
        if (primerM) {
            try { await primerM.react('⚠️'); } catch (e) {}
        }

        crearSesion(userId, {
            estado: ESTADO.CORRIGIENDO,
            listeros: listerosTotal,
            errores: erroresTotal,
            tiempoLicencia: tiempoLicencia,
            loteria: loteria,
            numImagenes: imagenesOK
        });

        if (primerM) await mostrarErrorActual(primerM, sesiones[userId]);
        return;
    }

    // ================================
    // SIN ERRORES → RESULTADOS + ESPERAR PREMIOS
    // ================================
    if (primerM) {
        try { await primerM.react('✅'); } catch (e) {}
        await enviarResultados(primerM, listerosTotal, tiempoLicencia, loteria, imagenesOK);
    }

    crearSesion(userId, {
        estado: ESTADO.ESPERANDO_PREMIOS,
        listeros: listerosTotal,
        errores: [],
        tiempoLicencia: tiempoLicencia,
        loteria: loteria,
        numImagenes: imagenesOK
    });

    if (primerM) {
        await new Promise(r => setTimeout(r, 800));
        await primerM.reply(
            `🏆 *Envía los números ganadores para calcular premios*\n\n` +
            `📝 *Formato:* pick3 pick4\n` +
            `📋 *Ejemplo:* \`234 4556\`\n\n` +
            `📌 Escribe *listo* para terminar sin calcular`
        );
    }
}

// ============================================
// HANDLER on: 'image' — OCR automático con buffer
// ============================================
if (typeof pnix === 'function') {
    pnix({
        on: 'image',
        fromMe: false,
        desc: 'OCR automático al recibir imagen',
        type: 'handler'
    }, async (m, conn) => {
        try {
            const userId = extraerUserId(m);
            if (!userId) return;

            let tiempoLicencia = null;
            if (typeof verificarAccesoUsuario === 'function') {
                try {
                    const acceso = verificarAccesoUsuario(userId);
                    if (!acceso.autorizado) return;
                    tiempoLicencia = acceso.tiempoRestante;
                } catch (e) { return; }
            }

            if (!autoOcrActivado(userId)) return;
            if (esComando(m)) return;
            if (!tieneImagen(m)) return;

            // 🔒 Marcar procesando
            procesandoImagen[userId] = true;

            // Cancelar sesión interactiva previa si existe
            if (tieneSesionActiva(userId)) cerrarSesion(userId);

            // Descargar imagen
            const filePath = await descargarImagen(m, conn);
            if (!filePath) {
                delete procesandoImagen[userId];
                try { await m.react('❌'); } catch (e) {}
                return;
            }

            // 🆕 AGREGAR AL BUFFER
            if (!bufferImagenes[userId]) bufferImagenes[userId] = [];
            bufferImagenes[userId].push(filePath);

            // Guardar datos de la primera imagen
            if (!sesiones[`_buffer_${userId}`]) {
                const loteria = typeof cargarUltimaLoteria === 'function' ? cargarUltimaLoteria(userId) : 'Florida';
                sesiones[`_buffer_${userId}`] = {
                    tiempoLicencia: tiempoLicencia,
                    loteria: loteria,
                    primerMensaje: m
                };
            }

            const numEnBuffer = bufferImagenes[userId].length;

            if (numEnBuffer === 1) {
                console.log(`[OCR-AUTO] 📸 Primera imagen de ${userId}, esperando más...`);
            } else {
                console.log(`[OCR-AUTO] 📸 Imagen #${numEnBuffer} de ${userId} (acumulando)`);
            }

            // 🆕 REINICIAR TIMER (debounce)
            if (bufferTimers[userId]) clearTimeout(bufferTimers[userId]);

            bufferTimers[userId] = setTimeout(() => {
                procesarBuffer(userId, conn);
            }, BUFFER_ESPERA);

        } catch (error) {
            console.error('[OCR-AUTO] ❌ Error:', error);
            const userId = extraerUserId(m);
            if (userId) delete procesandoImagen[userId];
            try { await m.react('❌'); } catch (e) {}
        }
    });

    // ============================================
    // HANDLER on: 'text' — Sesión interactiva
    // ============================================
    pnix({
        on: 'text',
        fromMe: false,
        desc: 'Handler interactivo OCR',
        type: 'handler'
    }, async (m, conn) => {
        try {
            // SALTAR si tiene imagen
            if (tieneImagen(m)) return;

            const userId = extraerUserId(m);
            if (!userId) return;

            // SALTAR si estamos procesando/buffering imágenes
            if (procesandoImagen[userId]) return;

            if (!tieneSesionActiva(userId)) return;

            const texto = (m.text || m.body || '').trim();
            if (!texto || texto.length === 0) return;

            // Si es comando → cancelar sesión
            if (esComando(m)) {
                cerrarSesion(userId);
                return;
            }

            renovarSesion(userId);
            const sesion = sesiones[userId];
            const textoLower = texto.toLowerCase();

            // Cancelar
            if (textoLower === 'cancelar' || textoLower === 'salir') {
                if (!globalThis.jugadasPorUsuario) globalThis.jugadasPorUsuario = {};
                globalThis.jugadasPorUsuario[userId] = { listeros: sesion.listeros, errores: [] };
                cerrarSesion(userId);
                return m.reply('🚫 *Sesión cancelada.* Las jugadas válidas se guardaron. Usa `.premios` cuando quieras.');
            }

            // ============================================
            // ESTADO: CORRIGIENDO ERRORES
            // ============================================
            if (sesion.estado === ESTADO.CORRIGIENDO) {

                if (textoLower === 'saltar' || textoLower === 'skip' || textoLower === 's') {
                    sesion.errores.shift();
                    sesion.intentos = 0;

                    if (sesion.errores.length === 0) {
                        if (!globalThis.jugadasPorUsuario) globalThis.jugadasPorUsuario = {};
                        globalThis.jugadasPorUsuario[userId] = { listeros: sesion.listeros, errores: [] };

                        try { await m.react('✅'); } catch (e) {}
                        await enviarResultados(m, sesion.listeros, sesion.tiempoLicencia, sesion.loteria, sesion.numImagenes || 1);

                        sesion.estado = ESTADO.ESPERANDO_PREMIOS;
                        await new Promise(r => setTimeout(r, 800));
                        await m.reply(
                            `🏆 *Envía los números ganadores*\n\n` +
                            `📝 Formato: pick3 pick4 (ej: \`234 4556\`)\n` +
                            `📌 Escribe *listo* para terminar`
                        );
                        return;
                    }

                    await m.reply(`⏭️ Error saltado. Quedan ${sesion.errores.length} error${sesion.errores.length > 1 ? 'es' : ''}.\n`);
                    await mostrarErrorActual(m, sesion);
                    return;
                }

                // Validar que tiene dígitos
                if (!/\d/.test(texto)) {
                    await m.reply(
                        `❌ *La corrección debe contener números*\n\n` +
                        `📝 Envía la jugada corregida (ej: \`44-8\`)\n` +
                        `📌 Escribe *saltar* o *cancelar*`
                    );
                    return;
                }

                console.log(`[OCR-AUTO] ✏️ Corrección de ${userId}: ${texto}`);

                const resultadoCorreccion = procesarMensajeConContexto(userId, texto);

                const tieneJugadas = resultadoCorreccion.listeros &&
                    Object.values(resultadoCorreccion.listeros).some(tipos =>
                        Object.values(tipos).some(nums => Object.keys(nums).length > 0)
                    );

                if (resultadoCorreccion.tieneErrores && resultadoCorreccion.errores.length > 0) {
                    sesion.intentos++;

                    if (sesion.intentos >= 3) {
                        await m.reply(`⚠️ *3 intentos fallidos* — Se saltará este error.`);
                        sesion.errores.shift();
                        sesion.intentos = 0;

                        if (sesion.errores.length === 0) {
                            if (!globalThis.jugadasPorUsuario) globalThis.jugadasPorUsuario = {};
                            globalThis.jugadasPorUsuario[userId] = { listeros: sesion.listeros, errores: [] };

                            try { await m.react('✅'); } catch (e) {}
                            await enviarResultados(m, sesion.listeros, sesion.tiempoLicencia, sesion.loteria, sesion.numImagenes || 1);

                            sesion.estado = ESTADO.ESPERANDO_PREMIOS;
                            await new Promise(r => setTimeout(r, 800));
                            await m.reply(
                                `🏆 *Envía los números ganadores*\n\n` +
                                `📝 Formato: pick3 pick4 (ej: \`234 4556\`)\n` +
                                `📌 Escribe *listo* para terminar`
                            );
                            return;
                        }

                        await mostrarErrorActual(m, sesion);
                        return;
                    }

                    const errCorreccion = resultadoCorreccion.errores[0];
                    await m.reply(
                        `❌ *La corrección también tiene error:*\n` +
                        `   📝 \`${errCorreccion.jugada}\`\n` +
                        `   📋 _${errCorreccion.tipo}_\n\n` +
                        `Intenta de nuevo (intento ${sesion.intentos}/3)\n` +
                        `Escribe *saltar* para ignorar`
                    );
                    return;
                }

                if (!tieneJugadas) {
                    sesion.intentos++;
                    await m.reply(
                        `❌ *No se detectó jugada válida en tu corrección*\n\n` +
                        `📝 Envía la jugada corregida (ej: \`44-8\`)\n` +
                        `📌 Escribe *saltar* o *cancelar*`
                    );
                    return;
                }

                // ¡Corrección válida!
                fusionarListeros(sesion.listeros, resultadoCorreccion.listeros);
                sesion.errores.shift();
                sesion.intentos = 0;

                if (!globalThis.jugadasPorUsuario) globalThis.jugadasPorUsuario = {};
                globalThis.jugadasPorUsuario[userId] = { listeros: sesion.listeros, errores: [] };

                console.log(`[OCR-AUTO] ✅ Corrección aplicada. Errores restantes: ${sesion.errores.length}`);

                if (sesion.errores.length > 0) {
                    try { await m.react('✅'); } catch (e) {}
                    await m.reply(`✅ *Corrección aplicada.* Quedan ${sesion.errores.length} error${sesion.errores.length > 1 ? 'es' : ''}.\n`);
                    await mostrarErrorActual(m, sesion);
                    return;
                }

                try { await m.react('✅'); } catch (e) {}
                await enviarResultados(m, sesion.listeros, sesion.tiempoLicencia, sesion.loteria, sesion.numImagenes || 1);

                sesion.estado = ESTADO.ESPERANDO_PREMIOS;
                await new Promise(r => setTimeout(r, 800));
                await m.reply(
                    `🏆 *Envía los números ganadores para calcular premios*\n\n` +
                    `📝 *Formato:* pick3 pick4\n` +
                    `📋 *Ejemplo:* \`234 4556\`\n\n` +
                    `📌 Escribe *listo* para terminar sin calcular`
                );
                return;
            }

            // ============================================
            // ESTADO: ESPERANDO PREMIOS
            // ============================================
            if (sesion.estado === ESTADO.ESPERANDO_PREMIOS) {

                if (textoLower === 'listo' || textoLower === 'ok' || textoLower === 'fin' || textoLower === 'hecho') {
                    cerrarSesion(userId);
                    return m.reply('✅ *Sesión terminada.* Usa `.premios <pick3> <pick4>` cuando tengas los números.');
                }

                const partes = texto.trim().split(/\s+/);
                if (partes.length >= 2) {
                    const pick3 = partes[0].replace(/\D/g, '');
                    const pick4 = partes[1].replace(/\D/g, '');

                    if (pick3.length === 3 && pick4.length === 4) {
                        try { await m.react('🏆'); } catch (e) {}
                        await calcularYMostrarPremios(m, userId, sesion.listeros, pick3, pick4);
                        cerrarSesion(userId);
                        return;
                    }
                }

                await m.reply(
                    `❌ *Formato inválido*\n\n` +
                    `📝 Envía: \`pick3 pick4\`\n` +
                    `📋 Ejemplo: \`234 4556\`\n\n` +
                    `📌 Escribe *listo* para terminar`
                );
                return;
            }

        } catch (error) {
            console.error('[OCR-AUTO] ❌ Error interactivo:', error);
            const userId = extraerUserId(m);
            if (userId) cerrarSesion(userId);
        }
    });

    // ============================================
    // COMANDO .ocrauto
    // ============================================
    pnix({
        command: 'ocrauto',
        fromMe: false,
        desc: 'Activar o desactivar OCR automático',
        type: 'command'
    }, async (m, conn) => {
        const userId = extraerUserId(m);
        if (!userId) return m.reply('❌ No se pudo identificar tu número.');

        if (typeof verificarAccesoUsuario === 'function') {
            try {
                const acceso = verificarAccesoUsuario(userId);
                if (!acceso.autorizado) return m.reply(acceso.mensaje || '❌ *Acceso denegado*');
            } catch (e) {}
        }

        const args = (m.text || m.body || '').trim().split(/\s+/);
        const accion = (args[1] || '').toLowerCase();

        if (accion === 'off' || accion === 'no' || accion === '0') {
            toggleAutoOcr(userId, false);
            return m.reply(`⏸️ *OCR Automático DESACTIVADO*\n\n📌 \`.ocrauto on\` para activar\n📌 \`.ocr\` para manual`);
        }

        if (accion === 'on' || accion === 'si' || accion === '1') {
            toggleAutoOcr(userId, true);
            return m.reply(`✅ *OCR Automático ACTIVADO*\n\nEnvía una imagen y se procesará solo.`);
        }

        const estado = autoOcrActivado(userId);
        return m.reply(
            `${estado ? '🟢' : '🔴'} *OCR Automático: ${estado ? '✅ ACTIVADO' : '⏸️ DESACTIVADO'}*\n\n` +
            `📌 \`.ocrauto on\` — Activar\n📌 \`.ocrauto off\` — Desactivar`
        );
    });

    console.log('[OCR-AUTO-INIT] ✅ Handlers registrados');
}

module.exports = {};
console.log('[OCR-AUTO-INIT] ✅✅✅ Plugin OCR Automático Interactivo listo ✅✅✅');
