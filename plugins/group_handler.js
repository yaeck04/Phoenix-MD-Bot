console.log('[GROUP-HANDLER] 🤖 Motor Automático de Grupo cargándose...');

const { pnix } = require('../lib/commands');
const { 
    procesarMensajeConContexto, verificarAccesoUsuario, 
    corregirSeriesVerticales
} = require('../lib/jugadas.cjs');
const { cargarConfigGrupo, cargarListerosGrupo } = require('../lib/grupo_config.cjs');
const { cargarLimites, validarLimites } = require('../lib/limits.cjs');
const { cargarJornada, agregarMensajeJornada } = require('../lib/jornadas.cjs');

const fs = require('fs');
const path = require('path');
const https = require('https');

let downloadContentFromMessage = null;
try {
    import('@whiskeysockets/baileys/lib/Utils/messages-media.js').then(mod => {
        downloadContentFromMessage = mod.downloadContentFromMessage;
        console.log('[GROUP-HANDLER] ✅ downloadContentFromMessage importada');
    }).catch(e => {});
} catch (e) {}

// ============================================
// SISTEMA DE COLAS PARA EVITAR PÉRDIDA DE MSJS
// ============================================
const groupQueues = {};

function encolarMensaje(groupId, task) {
    if (!groupQueues[groupId]) {
        groupQueues[groupId] = Promise.resolve();
    }
    // Encadenar la tarea al final de la cola del grupo
    groupQueues[groupId] = groupQueues[groupId].then(() => task()).catch(err => {
        console.error(`[GROUP-QUEUE] ❌ Error en cola de grupo ${groupId}:`, err);
    });
}

// ============================================
// HELPERS & OCR
// ============================================
function getGroupId(m) {
    const chat = m.from || m.chat || '';
    if (chat.includes('@g.us')) return chat.replace('@g.us', '');
    return null;
}

function esComando(m) {
    const t = m.text || m.body || '';
    return /^[•·#!.,\/\\$%^&*()_=+~`;:'"<>?|]/.test(t.trim());
}

async function descargarImagen(m) {
    try {
        let imgMsg = m.data?.message?.imageMessage || m.msg || m.quoted?.data?.message?.imageMessage || m.quoted?.msg;
        if (!imgMsg?.mediaKey) return null;
        if (downloadContentFromMessage) {
            const stream = await downloadContentFromMessage(imgMsg, 'image', { mediaKey: imgMsg.mediaKey, url: imgMsg.url });
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            const buffer = Buffer.concat(chunks);
            if (buffer.length > 0) {
                const tempDir = './temp_images';
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
                const fp = path.join(tempDir, `grp_${Date.now()}.jpg`);
                fs.writeFileSync(fp, buffer);
                return fp;
            }
        }
        return null;
    } catch (e) { console.error('[GROUP-HANDLER] Error descarga:', e.message); return null; }
}

async function ocrShforge(filePath) {
    return new Promise((resolve) => {
        try {
            const fileBuffer = fs.readFileSync(filePath);
            const boundary = '----OCR' + Math.random().toString(36).substring(2);
            const header = `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="img.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`;
            const footer = `\r\n--${boundary}--\r\n`;
            const postData = Buffer.concat([Buffer.from(header), fileBuffer, Buffer.from(footer)]);
            const req = https.request({
                hostname: 'api-image-to-text.shforge.com', path: '/api/ocr/recognize', method: 'POST',
                headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'accept': 'application/json', 'X-API-Key': '9f3a1e7c-4b2d-4f89-b6e3-1a8c7d5e0b42', 'Content-Length': postData.length }
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try { const json = JSON.parse(data); resolve(json.success === true && json.text ? json.text : null); } 
                    catch (e) { resolve(null); }
                });
            });
            req.on('error', () => resolve(null));
            req.setTimeout(30000, () => { req.destroy(); resolve(null); });
            req.write(postData); req.end();
        } catch (e) { resolve(null); }
    });
}

function corregirTextoOcr(texto) {
    texto = texto.replace(/(\d{2,3})x(\d{2,3})/g, '$1+$2');
    texto = texto.replace(/(4l\s*>|41\s*>|A1\s*>)/gi, 'AL>');
    texto = texto.replace(/(\d{2})\s*(4l|41|A1)\s*(\d{2})/gi, '$1Al$3');
    if (typeof corregirSeriesVerticales === 'function') texto = corregirSeriesVerticales(texto);
    return texto;
}

// ============================================
// MOTOR PRINCIPAL
// ============================================
async function procesarMensajeGrupo(m, conn, esImagen = false) {
    const groupId = getGroupId(m);
    if (!groupId) return;
    if (esComando(m)) return;

    // 🚀 ENCOLAR: Si llegan 5 mensajes rápido, se procesan 1 por 1
    encolarMensaje(groupId, async () => {
        try {
            const configGrupo = cargarConfigGrupo(groupId);
            const rawId = m.sender || '';
            
            if (!configGrupo.jornadaActivaId || !configGrupo.adminPhone) return;
            
            const jornada = cargarJornada(groupId, configGrupo.jornadaActivaId);
            if (!jornada || jornada.estado !== 'activa') return;

            const accesoAdmin = verificarAccesoUsuario(rawId);
            if (accesoAdmin.autorizado && accesoAdmin.realPhone === configGrupo.adminPhone) return;

            const listerosGrupo = cargarListerosGrupo(groupId);
            const datosListero = listerosGrupo[rawId];
            
            if (!datosListero || !datosListero.activo) return;

            let textoProcesar = '';
            if (esImagen) {
                const tieneImg = m.msg?.mimetype?.startsWith('image/') || m.data?.message?.imageMessage || m.quoted?.msg?.mimetype?.startsWith('image/');
                if (!tieneImg) return; // Falso positivo
                
                m.react('⏳').catch(()=>{}); // Fire and forget
                const filePath = await descargarImagen(m, conn);
                if (!filePath) { m.reply('❌ Error descargando imagen.').catch(()=>{}); return; }
                
                let textoOcr = await ocrShforge(filePath);
                try { fs.unlinkSync(filePath); } catch (e) {}
                
                if (!textoOcr) { m.reply('❌ No se pudo leer la imagen.').catch(()=>{}); return; }
                textoProcesar = corregirTextoOcr(textoOcr);
            } else {
                textoProcesar = (m.text || m.body || '').trim();
                if (!textoProcesar) return;
            }

            if (!textoProcesar.includes(':')) {
                textoProcesar = `${datosListero.nombre}: ${textoProcesar}`;
            }

            const adminId = configGrupo.adminPhone;
            const resultado = procesarMensajeConContexto(adminId, textoProcesar);
            
            if (resultado.tieneErrores && resultado.errores.length > 0) {
                const errorDetalle = resultado.errores.map(e => `• \`${e.jugada}\`: ${e.tipo}`).join('\n');
                m.reply(`❌ *Jugada inválida - ${datosListero.nombre}*\n\n${errorDetalle}`).catch(()=>{});
                return;
            }

            const jugadasListero = resultado.listeros[datosListero.nombre];
            const tieneJugadas = jugadasListero && Object.values(jugadasListero).some(t => Object.keys(t).length > 0);

            if (!tieneJugadas) return;

            const limites = cargarLimites(groupId, jornada.loteria);
            const validacion = validarLimites(jornada.acumulacion, jugadasListero, limites);
            
            if (validacion.excede) {
                let msgLimite = `🚫 *¡Límite excedido! - ${datosListero.nombre}*\n\n`;
                for (const det of validacion.detalles) {
                    msgLimite += `• *${det.tipo} ${det.numero}*: Acumulado ${det.montoAcumulado} + ${det.montoNuevo} = ${det.totalSeria} (Límite: ${det.limite})\n`;
                }
                m.reply(msgLimite).catch(()=>{});
                return;
            }

            const msgData = {
                listeroId: rawId,
                listeroNombre: datosListero.nombre,
                timestamp: new Date().toISOString(),
                tipo: esImagen ? 'imagen' : 'texto',
                textoOriginal: textoProcesar,
                valido: true, errores: [], excedeLimites: [],
                jugadas: jugadasListero
            };

            const numeroMensaje = agregarMensajeJornada(groupId, configGrupo.jornadaActivaId, msgData);

            if (numeroMensaje) {
                m.react('✅').catch(()=>{}); // Fire and forget
                m.reply(`✅ *OK #${numeroMensaje}* - ${datosListero.nombre}`).catch(()=>{});
            } else {
                m.reply(`❌ Error interno al guardar.`).catch(()=>{});
            }

        } catch (error) {
            console.error('[GROUP-HANDLER] ❌ ERROR EN COLA:', error);
        }
    });
}

// ============================================
// REGISTRO DE HANDLERS
// ============================================
if (typeof pnix === 'function') {
    pnix({
        on: 'text',
        fromMe: false,
        desc: 'Interceptor automático de texto en grupos',
        type: 'handler'
    }, async (m, conn) => {
        if (m.msg?.mimetype?.startsWith('image/')) return;
        await procesarMensajeGrupo(m, conn, false);
    });

    pnix({
        on: 'image',
        fromMe: false,
        desc: 'Interceptor automático de imágenes en grupos',
        type: 'handler'
    }, async (m, conn) => {
        await procesarMensajeGrupo(m, conn, true);
    });

    console.log('[GROUP-HANDLER] ✅ Motor automático con colas registrado');
}

module.exports = {};
