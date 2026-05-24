console.log('[OCR-INIT] 📸 Plugin OCR cargándose...');

let pnix, procesarMensajeConContexto, formatearResultados, formatearErrores, verificarAccesoUsuario, corregirSeriesVerticales;
let downloadContentFromMessage = null;

try {
    const commands = require('../lib/commands');
    pnix = commands.pnix;
} catch (e) {
    console.error('[OCR-INIT] ❌ Error pnix:', e.message);
}

try {
    const jugadas = require('../lib/jugadas.cjs');
    procesarMensajeConContexto = jugadas.procesarMensajeConContexto;
    formatearResultados = jugadas.formatearResultados;
    formatearErrores = jugadas.formatearErrores;
    verificarAccesoUsuario = jugadas.verificarAccesoUsuario;
    corregirSeriesVerticales = jugadas.corregirSeriesVerticales;
} catch (e) {
    console.error('[OCR-INIT] ❌ Error jugadas.cjs:', e.message);
}

const fs = require('fs');
const path = require('path');
const https = require('https');

// Importar dinámicamente la función de descarga de Baileys
async function cargarFuncionDescarga() {
    try {
        console.log('[OCR-INIT] Importando downloadContentFromMessage de Baileys...');
        const baileysUtils = await import('@whiskeysockets/baileys/lib/Utils/messages-media.js');
        downloadContentFromMessage = baileysUtils.downloadContentFromMessage;
        if (typeof downloadContentFromMessage === 'function') {
            console.log('[OCR-INIT] ✅ downloadContentFromMessage importada correctamente');
            return true;
        }
        return false;
    } catch (e) {
        console.error('[OCR-INIT] ❌ Error importando Baileys:', e.message);
        return false;
    }
}

// Cargar al inicio
cargarFuncionDescarga().then(ok => {
    if (!ok) {
        console.log('[OCR-INIT] ⚠️ No se pudo importar, se usarán métodos alternativos');
    }
});

console.log('[OCR-INIT] ✅ Dependencias base cargadas');

// ============================================
// FUNCIÓN: Extraer userId limpio (solo números)
// ============================================
function extraerUserId(m) {
    let raw = m.sender || m.user || m.from || '';
    // Tomar solo la parte antes de @
    if (raw.includes('@')) raw = raw.split('@')[0];
    // Eliminar cualquier cosa que no sea dígito
    raw = raw.replace(/\D/g, '');
    // Si quedó vacío o es muy corto, no es un teléfono válido
    if (raw.length < 7) return null;
    return raw;
}

// ============================================
// FUNCIÓN: Descargar imagen
// ============================================
async function descargarImagen(m, conn) {
    try {
        console.log('[OCR] Descargando imagen...');
        
        if (!m.data?.message?.imageMessage?.mediaKey) {
            console.log('[OCR] ❌ No hay m.data con imageMessage');
            return null;
        }

        const client = m.client;
        if (!client) {
            console.log('[OCR] ❌ No hay m.client');
            return null;
        }

        console.log('[OCR] ✅ Client encontrado');
        console.log('[OCR] ✅ mediaKey:', m.data.message.imageMessage.mediaKey.length, 'bytes');

        // MÉTODO 1: Usar función importada de Baileys directamente
        if (downloadContentFromMessage) {
            try {
                console.log('[OCR] Usando downloadContentFromMessage (Baileys directo)...');
                const stream = await downloadContentFromMessage(
                    m.data.message.imageMessage, 
                    'image',
                    {
                        mediaKey: m.data.message.imageMessage.mediaKey,
                        mediaKeyTimestamp: m.data.message.imageMessage.mediaKeyTimestamp,
                        url: m.data.message.imageMessage.url
                    }
                );
                
                if (stream) {
                    const chunks = [];
                    for await (const chunk of stream) {
                        chunks.push(chunk);
                    }
                    const buffer = Buffer.concat(chunks);
                    
                    if (buffer.length > 0) {
                        const tempDir = './temp_images';
                        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
                        const filePath = path.join(tempDir, `ocr_${Date.now()}.jpg`);
                        fs.writeFileSync(filePath, buffer);
                        console.log(`[OCR] ✅✅✅ DESCARGADA (Baileys directo): ${filePath} (${buffer.length} bytes) ✅✅✅`);
                        return filePath;
                    }
                }
            } catch (e) {
                console.log('[OCR] downloadContentFromMessage error:', e.message);
            }
        }

        // MÉTODO 2: Buscar en require cache
        try {
            const cacheKeys = Object.keys(require.cache);
            const baileysKey = cacheKeys.find(k => k.includes('baileys') && k.includes('messages-media'));
            if (baileysKey) {
                console.log('[OCR] Encontrado en require.cache:', baileysKey);
                const cachedModule = require.cache[baileysKey];
                if (cachedModule?.exports?.downloadContentFromMessage) {
                    console.log('[OCR] Usando función del cache...');
                    const stream = await cachedModule.exports.downloadContentFromMessage(
                        m.data.message.imageMessage, 
                        'image',
                        {}
                    );
                    const chunks = [];
                    for await (const chunk of stream) chunks.push(chunk);
                    const buffer = Buffer.concat(chunks);
                    if (buffer.length > 0) {
                        const tempDir = './temp_images';
                        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
                        const filePath = path.join(tempDir, `ocr_${Date.now()}.jpg`);
                        fs.writeFileSync(filePath, buffer);
                        console.log(`[OCR] ✅ DESCARGADA (cache): ${filePath}`);
                        return filePath;
                    }
                }
            }
        } catch (e) {
            console.log('[OCR] Cache search error:', e.message);
        }

        // MÉTODO 3: Intentar acceder a la función interna del proxy
        if (client._client) {
            console.log('[OCR] m.client._client existe, intentando...');
            try {
                const buffer = await client._client.downloadMediaMessage(m.data, 'buffer', {});
                if (buffer && buffer.length > 0) {
                    const tempDir = './temp_images';
                    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
                    const filePath = path.join(tempDir, `ocr_${Date.now()}.jpg`);
                    fs.writeFileSync(filePath, buffer);
                    console.log(`[OCR] ✅ DESCARGADA (_client): ${filePath}`);
                    return filePath;
                }
            } catch (e) {
                console.log('[OCR] _client error:', e.message);
            }
        }

        console.log('[OCR] ❌ Todos los métodos fallaron');
        return null;

    } catch (error) {
        console.error('[OCR] ❌ Error descargando:', error);
        return null;
    }
}

// ============================================
// FUNCIÓN: API OCR
// ============================================
async function ocrShforge(filePath) {
    return new Promise((resolve) => {
        try {
            const fileBuffer = fs.readFileSync(filePath);
            const filename = path.basename(filePath);
            const boundary = '----OCR' + Math.random().toString(36).substring(2);

            const header = `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`;
            const footer = `\r\n--${boundary}--\r\n`;

            const postData = Buffer.concat([
                Buffer.from(header),
                fileBuffer,
                Buffer.from(footer)
            ]);

            console.log(`[OCR] API: ${(postData.length / 1024).toFixed(1)} KB`);

            const req = https.request({
                hostname: 'api-image-to-text.shforge.com',
                path: '/api/ocr/recognize',
                method: 'POST',
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'accept': 'application/json',
                    'X-API-Key': '9f3a1e7c-4b2d-4f89-b6e3-1a8c7d5e0b42',
                    'Content-Length': postData.length
                }
            }, (res) => {
                let data = '';
                console.log(`[OCR] API status: ${res.statusCode}`);

                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        if (json.success === true && json.text) {
                            console.log(`[OCR] ✅ Texto: ${json.text.length} chars`);
                            resolve(json.text);
                        } else {
                            console.log('[OCR] ⚠️ API false');
                            resolve(null);
                        }
                    } catch (e) {
                        console.log('[OCR] ❌ Parse error');
                        resolve(null);
                    }
                });
            });

            req.on('error', (e) => {
                console.log('[OCR] ❌ HTTP error:', e.message);
                resolve(null);
            });

            req.setTimeout(30000, () => { req.destroy(); resolve(null); });
            req.write(postData);
            req.end();

        } catch (e) {
            console.log('[OCR] ❌ Error:', e.message);
            resolve(null);
        }
    });
}

// ============================================
// FUNCIÓN: Corregir texto OCR
// ============================================
function corregirTextoOcr(texto) {
    // Corregir "x" como separador de parlets (OCR confunde + con x)
    // Ej: 29x52-10 → 29+52-10
    // Pero NO corregir si es parte de un número (ya no aplica con 2-3 dígitos)
    texto = texto.replace(/(\d{2,3})x(\d{2,3})/g, '$1+$2');
    
    // Corregir variantes de "al"
    texto = texto.replace(/(4l\s*>|41\s*>|A1\s*>)/gi, 'AL>');
    texto = texto.replace(/(\d{2})\s*(4l|41|A1)\s*(\d{2})/gi, '$1Al$3');
    texto = texto.replace(/(\d{2,3})\s+(?:al|@l)\s+(?:com|con|c|cu|cdu)\s+(\d+)/gi, '$1al$2-$3');
    
    // Corregir series verticales
    if (typeof corregirSeriesVerticales === 'function') {
        texto = corregirSeriesVerticales(texto);
    }
    return texto;
}

// ============================================
// COMANDO .ocr
// ============================================
if (typeof pnix === 'function') {
    pnix({
        'command': 'ocr',
        'fromMe': false,
        'desc': 'Procesa jugadas desde imagen (OCR)',
        'type': 'command'
    }, async (m, conn) => {
        console.log('[OCR] ========================================');
        console.log('[OCR] 📸 .ocr ejecutado');
        console.log('[OCR] ========================================');

        // ============================================
        // FIX 1: Extraer userId solo numérico
        // ============================================
        const userId = extraerUserId(m);
        console.log('[OCR] 👤 Usuario:', userId);

        if (!userId) {
            return m.reply('❌ *Error:* No se pudo identificar tu número de usuario.');
        }

        // ============================================
        // FIX 2: Verificar acceso
        // ============================================
        if (typeof verificarAccesoUsuario === 'function') {
            try {
                const acceso = verificarAccesoUsuario(userId);
                if (!acceso.autorizado) {
                    return m.reply(acceso.mensaje || '❌ *Acceso denegado*\n\nTu número no está registrado.');
                }
                console.log('[OCR] ✅ Autorizado:', acceso.tiempoRestante);
            } catch (e) {
                console.error('[OCR] Error verificando acceso:', e.message);
            }
        }

        // Verificar que hay imagen
        if (!(m.msg?.url && m.msg?.mimetype?.startsWith('image/'))) {
            if (!(m.quoted?.msg?.url && m.quoted?.msg?.mimetype?.startsWith('image/'))) {
                return m.reply(
                    `📸 *COMANDO OCR*\n\n` +
                    `📝 *Formas de usar:*\n\n` +
                    `1️⃣ *Responde a imagen:*\n` +
                    `   Selecciona imagen → Responder → \`.ocr\`\n\n` +
                    `2️⃣ *Imagen con caption:*\n` +
                    `   Adjunta imagen + \`.ocr\` en el pie`
                );
            }
        }

        await m.reply('⏳ *Procesando imagen...*\n🕐 Extrayendo texto con OCR...');

        const filePath = await descargarImagen(m, conn);

        if (!filePath) {
            return m.reply('❌ *Error al descargar la imagen*\n\nNo se pudo obtener la imagen del mensaje.');
        }

        let textoOcr = await ocrShforge(filePath);
        try { fs.unlinkSync(filePath); } catch (e) {}

        if (!textoOcr || textoOcr.trim().length === 0) {
            return m.reply('❌ *No se detectó texto en la imagen*');
        }

        console.log('[OCR] 📝 Texto OCR:', textoOcr.substring(0, 200));
        textoOcr = corregirTextoOcr(textoOcr);

        if (typeof procesarMensajeConContexto !== 'function') {
            return m.reply('❌ *Error interno:* Módulo de procesamiento no disponible.');
        }

        // ============================================
        // FIX 3: PASAR userId COMO PRIMER PARÁMETRO
        // ============================================
        console.log('[OCR] ⚙️ Procesando jugadas para userId:', userId);
        const resultado = procesarMensajeConContexto(userId, textoOcr);
        const { listeros, errores, tieneErrores } = resultado;

        if (!listeros || Object.keys(listeros).length === 0) {
            let resp = '❌ *No se encontraron jugadas válidas*\n\n';
            resp += '*Texto detectado:*\n```\n';
            resp += textoOcr.substring(0, 800);
            resp += '\n```';
            return m.reply(resp);
        }

        const totalJugadas = Object.values(listeros).reduce(
            (acc, tipos) => acc + Object.values(tipos).reduce(
                (a, nums) => a + Object.keys(nums).length, 0
            ), 0
        );

        const totalMonto = Object.values(listeros).reduce(
            (acc, tipos) => acc + Object.values(tipos).reduce(
                (a, nums) => a + Object.values(nums).reduce((s, v) => s + v, 0), 0
            ), 0
        );

        console.log(`[OCR] ✅ ${totalJugadas} jugadas, ${totalMonto} pesos`);

        let respuesta = `📸 *OCR COMPLETADO*\n\n`;
        respuesta += `📊 *Resumen:*\n`;
        respuesta += `   • Jugadas: ${totalJugadas}\n`;
        respuesta += `   • Monto total: ${totalMonto} pesos\n\n`;
        respuesta += `${'━'.repeat(25)}\n\n`;

        if (typeof formatearResultados === 'function') {
            respuesta += formatearResultados(listeros);
        } else {
            respuesta += JSON.stringify(listeros, null, 2);
        }

        if (tieneErrores && errores && errores.length > 0 && typeof formatearErrores === 'function') {
            respuesta += '\n' + formatearErrores(errores);
        }

        respuesta += `\n${'━'.repeat(25)}\n`;
        respuesta += `💡 Usa \`.premios <pick3> <pick4>\``;

        if (respuesta.length > 4000) {
            const partes = [];
            let parte = '';
            for (const linea of respuesta.split('\n')) {
                if ((parte + linea + '\n').length > 4000) {
                    if (parte) partes.push(parte);
                    parte = linea + '\n';
                } else {
                    parte += linea + '\n';
                }
            }
            if (parte) partes.push(parte);
            for (const p of partes) {
                await m.reply(p);
                await new Promise(r => setTimeout(r, 500));
            }
        } else {
            await m.reply(respuesta);
        }

        globalThis.ultimaJugadaProcesada = { listeros, errores };
        console.log('[OCR] ✅✅✅ COMPLETADO ✅✅✅');
    });

    pnix({
        'command': 'ocrtexto',
        'fromMe': false,
        'desc': 'Extrae texto sin procesar',
        'type': 'command'
    }, async (m, conn) => {
        const userId = extraerUserId(m);

        if (!userId) {
            return m.reply('❌ *Error:* No se pudo identificar tu número.');
        }

        if (typeof verificarAccesoUsuario === 'function') {
            try {
                const acceso = verificarAccesoUsuario(userId);
                if (!acceso.autorizado) return m.reply(acceso.mensaje || '❌ *Acceso denegado*');
            } catch (e) {}
        }

        if (!(m.msg?.url && m.msg?.mimetype?.startsWith('image/')) && 
            !(m.quoted?.msg?.url && m.quoted?.msg?.mimetype?.startsWith('image/'))) {
            return m.reply('📸 *Usa:*\n\n1. Responde a imagen con `.ocrtexto`\n2. Adjunta imagen + `.ocrtexto`');
        }

        await m.reply('⏳ Extrayendo texto...');
        const filePath = await descargarImagen(m, conn);
        if (!filePath) return m.reply('❌ Error descargando');

        let textoOcr = await ocrShforge(filePath);
        try { fs.unlinkSync(filePath); } catch (e) {}

        if (!textoOcr || textoOcr.trim().length === 0) return m.reply('❌ No se detectó texto');

        let resp = `📸 *TEXTO EXTRAÍDO*\n\n\`\`\`\n${textoOcr}\n\`\`\``;
        if (resp.length > 4000) {
            const partes = [];
            let parte = '';
            for (const linea of resp.split('\n')) {
                if ((parte + linea + '\n').length > 4000) {
                    if (parte) partes.push(parte);
                    parte = linea + '\n';
                } else {
                    parte += linea + '\n';
                }
            }
            if (parte) partes.push(parte);
            for (const p of partes) {
                await m.reply(p);
                await new Promise(r => setTimeout(r, 500));
            }
        } else {
            await m.reply(resp);
        }
    });

    console.log('[OCR-INIT] ✅ Comandos registrados');
}

module.exports = {};
console.log('[OCR-INIT] ✅✅✅ Plugin OCR listo ✅✅✅');
