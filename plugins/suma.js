console.log('[SUMA-INIT] 📦 Archivo suma.js cargándose...');

const { pnix } = require('../lib/commands');

const {
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
    verificarAccesoUsuario
} = require('../lib/jugadas.cjs');

const { cargarConfigGrupo, guardarConfigGrupo, cargarListerosGrupo, registrarListero, eliminarListero } = require('../lib/grupo_config.cjs');
const { cargarLimites, guardarLimites } = require('../lib/limits.cjs');
const { crearJornada, cerrarJornada, cargarJornada } = require('../lib/jornadas.cjs');

console.log('[SUMA-INIT] ✅ Dependencias cargadas');

// ============================================
// FUNCIONES AUXILIARES
// ============================================

function getUserId(m) {
    const sender = m.sender || 'unknown';
    if (sender.includes('@lid')) return sender; 
    return sender.replace('@s.whatsapp.net', '').replace(':0', '');
}

// 🆕 FUNCIÓN ROBUSTA PARA OBTENER EL ID DE UN MENSAJE CITADO
function getQuotedId(m) {
    return m.quoted?.sender || 
           m.quoted?.key?.participant || 
           m.quoted?.data?.key?.participant || 
           m.msg?.contextInfo?.participant ||
           m.data?.message?.extendedTextMessage?.contextInfo?.participant ||
           null;
}

function getGroupId(m) {
    const chat = m.from || m.chat || '';
    if (chat.includes('@g.us')) return chat.replace('@g.us', '');
    return null;
}

function generarTikeSinDeuda(userId, listeros, premios, detalles, totalesListeros, pick3, pick4) {
    const loteriaActual = cargarUltimaLoteria(userId);
    const listerosPorciento = cargarListerosPorciento(userId, loteriaActual);
    let tike = `✏️🗒️Cortes de Listeros: \n\n`;
    for (const [listero, tipos] of Object.entries(premios)) {
        const totalListero = totalesListeros[listero] || 0;
        tike += `📋Listero: ${listero} \n#Ganadores: ${pick3} ${pick4} \n`;
        let totalJugado = 0;
        if (listeros[listero]) for (const tipoJugada of Object.values(listeros[listero])) totalJugado += Object.values(tipoJugada).reduce((a, b) => a + b, 0);
        tike += `💰Total recogido: ${totalJugado} cup \n`;
        const datosListero = listerosPorciento[listero] || { porciento: 0, deuda: 0 };
        const porcentaje = datosListero.porciento || 0;
        const montoPorcentaje = totalJugado - (totalJugado * porcentaje / 100);
        tike += `📝Recogido - ${porcentaje}%: ${Math.round(montoPorcentaje)} cup \n🏆Total premio: ${totalListero} cup \n`;
        for (const [tipo, monto] of Object.entries(tipos)) {
            const montosVistos = new Set(); let montoJugado = 0;
            if (detalles[listero][tipo]) for (const detalle of detalles[listero][tipo]) if (!montosVistos.has(detalle)) { montosVistos.add(detalle); const partes = detalle.split('-'); montoJugado += parseInt(partes[partes.length - 1]); }
            tike += `  ${tipo}: ${montoJugado} -> ${monto} CUP\n`;
            for (const det of detalles[listero][tipo]) tike += `     ${det}\n`;
        }
        tike += `\n`;
        const balance = montoPorcentaje - totalListero;
        if (balance > 0) tike += `🫵🫰 Debes: ${Math.round(balance)} CUP\n`; else if (balance < 0) tike += `🥳🎉 Ganaste: ${Math.abs(Math.round(balance))} CUP\n`; else tike += `Balance neutro en lista\n`;
        tike += `⚡⚡⚡⚡⚡⚡⚡⚡\n\n\n`;
    }
    const listerosConPremio = new Set(Object.keys(premios));
    for (const [listero, tipos] of Object.entries(listeros)) {
        if (listerosConPremio.has(listero)) continue;
        let totalJugado = 0; for (const tipoJugada of Object.values(tipos)) totalJugado += Object.values(tipoJugada).reduce((a, b) => a + b, 0);
        const datosListero = listerosPorciento[listero] || { porciento: 0, deuda: 0 }; const porcentaje = datosListero.porciento || 0;
        let montoPorcentaje = totalJugado - (totalJugado * porcentaje / 100); if (montoPorcentaje === 0) montoPorcentaje = totalJugado;
        tike += `📋Listeros: ${listero} \n#Ganadores: ${pick3} ${pick4} \n💰Total recogido: ${totalJugado} cup \n📝Recogido - ${porcentaje}%: ${Math.round(montoPorcentaje)} cup \n🏆Total premio: 👌Sin premio \n\n🫵🫰 Debes: ${Math.round(montoPorcentaje)} cup \n⚡⚡⚡⚡⚡⚡⚡⚡ \n\n\n`;
    }
    return tike.trim();
}

// ============================================
// COMANDO .suma - Procesar jugadas
// ============================================
pnix({
    'command': 'suma',
    'fromMe': false,
    'desc': 'Procesa jugadas de lotería',
    'type': 'command'
}, async (m, conn) => {
    const rawId = getUserId(m);
    const acceso = verificarAccesoUsuario(rawId);
    
    if (!acceso.autorizado) {
        if (rawId.includes('@lid')) {
            return m.reply(`❌ *Acceso denegado (Dispositivo Vinculado)*\n\nNo reconozco tu ID de grupo.\nPara usar el bot, escribe en este grupo:\n\n\`.vincular TU_NUMERO\`\n\nEjemplo: \`.vincular 5356965304\``);
        }
        return m.reply(acceso.mensaje);
    }
    
    const userId = acceso.realPhone;
    const groupId = getGroupId(m);
    
    let textoCompleto = m.text || m.body || '';
    let textoLimpio = textoCompleto.replace(/^\.[a-zA-Z]+\s*/, '').replace(/^\.[a-zA-Z]+$/, '');
    
    if (!textoLimpio || textoLimpio.trim().length === 0) {
        return m.reply(`⚠️ *Uso incorrecto*\n\n📝 \`.suma <jugadas>\`\n📊 \`.suma config\` para ver opciones\n⏳ Licencia: ${acceso.tiempoRestante}`);
    }
    
    const partes = textoLimpio.trim().split(/\s+/);
    const primerArg = partes[0]?.toLowerCase();
    
    // ============================================
    // COMANDOS RÁPIDOS DE GRUPO
    // ============================================
    if (groupId) {
        if (primerArg === 'inicio') {
            const loteria = cargarUltimaLoteria(userId);
            const turno = partes[1]?.toLowerCase() || 'mañana';
            crearJornada(groupId, loteria, turno);
            
            // Guardar el teléfono del admin en la config del grupo
            const config = cargarConfigGrupo(groupId);
            config.adminPhone = userId; // userId es tu teléfono real con licencia
            guardarConfigGrupo(groupId, config);
            
            return m.reply(`🌅 *Jornada de ${loteria} (${turno}) INICIADA*\n\n📩 Los listeros pueden enviar jugadas.`);
        }
        if (primerArg === 'fin') {
            const config = cargarConfigGrupo(groupId);
            if (!config.jornadaActivaId) return m.reply(`❌ No hay jornada activa`);
            cerrarJornada(groupId, config.jornadaActivaId);
            return m.reply(`⛔ *Jornada cerrada manualmente*`);
        }
        if (primerArg === 'comprobar') {
            const config = cargarConfigGrupo(groupId);
            if (!config.jornadaActivaId) return m.reply(`❌ No hay jornada activa`);
            const jornada = cargarJornada(groupId, config.jornadaActivaId);
            let texto = `📋 *COMPROBACIÓN DE JORNADA*\n\n`;
            for (const [listero, tipos] of Object.entries(jornada.listeros)) {
                texto += `👤 *${listero}*\n`;
                for (const [tipo, nums] of Object.entries(tipos)) {
                    if (Object.keys(nums).length > 0) { texto += `  ${tipo}:\n`; for (const [num, monto] of Object.entries(nums)) texto += `    ${num} → ${monto}\n`; }
                }
                texto += '\n';
            }
            return m.reply(texto);
        }
    }

    // ============================================
    // COMANDO UNIFICADO .suma config
    // ============================================
    if (primerArg === 'config') {
        const loteria = cargarUltimaLoteria(userId);
        const config = cargarConfiguracionPremios(userId, loteria);
        
        if (!partes[1]) {
            return m.reply(`⚙️ *TU CONFIGURACIÓN*\n👤 Usuario: *${userId}*\n🎰 Lotería: *${loteria}*\n\n💰 *Premios:*\n   • Parlet: ${config.Parlet} CUP\n   • Centena: ${config.Centena} CUP\n   • Fijo: ${config.Fijo} CUP\n   • Corrido: ${config.Corrido} CUP\n\n⚙️ *Opciones:*\n   • Barra /: ${config.barra_interpretacion}\n   • Gestión deuda: ${config.usar_gestion_deuda ? '✅ ON' : '❌ OFF'}`);
        }

        const tipo = partes[1]?.toLowerCase();
        const valor = partes[2]?.toLowerCase();

        // --- SUBCOMANDOS EXCLUSIVOS DE GRUPO ---
        if (groupId) {
            if (tipo === 'limits') {
                const limites = cargarLimites(groupId, loteria);
                if (!valor) return m.reply(`⚙️ *LÍMITES - ${loteria}*\n\n• Fijo: ${limites.Fijo || 'Sin límite'}\n• Corrido: ${limites.Corrido || 'Sin límite'}\n• Centena: ${limites.Centena || 'Sin límite'}\n• Parlet: ${limites.Parlet || 'Sin límite'}\n\n\`.suma config limits <tipo> <monto>\``);
                const monto = parseInt(partes[3]);
                if (['fijo', 'corrido', 'centena', 'parlet'].includes(valor) && partes[3]) { 
                    limites[valor.charAt(0).toUpperCase() + valor.slice(1)] = isNaN(monto) ? 0 : monto; 
                    guardarLimites(groupId, loteria, limites); 
                    return m.reply(`✅ *Límite actualizado: ${valor} = ${isNaN(monto) ? 'Sin límite' : monto}*`); 
                }
                return m.reply(`❌ Uso: \`.suma config limits <fijo|corrido|centena|parlet> <monto> 0=SinLímite\``);
            }
            
            if (tipo === 'listeros') {
                const listeros = cargarListerosGrupo(groupId);
                const accion = partes[2]?.toLowerCase();
                
                if (!accion || accion === 'list') { 
                    const lista = Object.entries(listeros).map(([id, d]) => `👤 ${d.nombre}`).join('\n'); 
                    return m.reply(`👥 *LISTEROS REGISTRADOS*\n\n${lista || 'No hay listeros.'}\n\n📌 Para agregar:\n\`.suma config listeros add <nombre>\` _(citando mensaje)_\n📌 Para eliminar:\n\`.suma config listeros remove\` _(citando mensaje)_`); 
                }
                if (accion === 'add') { 
                    if (!m.quoted) return m.reply(`❌ Debes responder (citar) a un mensaje del listero.\n\nUso: \`.suma config listeros add <nombre>\``); 
                    
                    const quotedId = getQuotedId(m);
                    if (!quotedId) return m.reply('❌ No pude identificar al remitente del mensaje citado. Intenta de nuevo.');
                    
                    const nombre = partes.slice(3).join(' ') || 'Listero';
                    registrarListero(groupId, quotedId, nombre); 
                    return m.reply(`✅ *Listero registrado: ${nombre}*\n🆔 ID: ${quotedId.split('@')[0]}`); 
                }
                if (accion === 'remove') { 
                    if (!m.quoted) return m.reply(`❌ Debes responder (citar) a un mensaje del listero.\n\nUso: \`.suma config listeros remove\``); 
                    
                    const quotedId = getQuotedId(m);
                    if (!quotedId) return m.reply('❌ No pude identificar al remitente del mensaje citado. Intenta de nuevo.');
                    
                    eliminarListero(groupId, quotedId); 
                    return m.reply(`🗑️ *Listero eliminado*`); 
                }
                return m.reply(`❌ Acción no válida. Usa *add* o *remove*.`);
            }
        }

        // --- SUBCOMANDOS GENERALES (Privado y Grupo) ---
        if (['parlet', 'centena', 'fijo', 'corrido'].includes(tipo) && valor) { 
            const numValor = parseInt(valor); 
            if (isNaN(numValor) || numValor <= 0) return m.reply(`❌ *Valor inválido*`); 
            config[tipo.charAt(0).toUpperCase() + tipo.slice(1)] = numValor; 
            guardarConfiguracionPremios(userId, config, loteria); 
            return m.reply(`✅ *Configuración actualizada: ${tipo} ${numValor} CUP*`); 
        }
        if (tipo === 'barra' && valor) { 
            if (!['error', 'mas', 'menos'].includes(valor)) return m.reply(`❌ *Valor inválido*`); 
            config.barra_interpretacion = valor; 
            guardarConfiguracionPremios(userId, config, loteria); 
            return m.reply(`✅ *Barra actualizada: ${valor}*`); 
        }
        if (tipo === 'deuda' && valor) { 
            if (!['on', 'off'].includes(valor)) return m.reply(`❌ *Valor inválido*`); 
            config.usar_gestion_deuda = (valor === 'on'); 
            guardarConfiguracionPremios(userId, config, loteria); 
            return m.reply(`✅ *Deuda actualizada: ${valor}*`); 
        }

        // Si llegó aquí, no se reconoció el subcomando
        return m.reply(`❌ Opción no reconocida.\n\nConfiguraciones disponibles:\n• limits (en grupo)\n• listeros (en grupo)\n• parlet, centena, fijo, corrido\n• barra, deuda`);
    }
    
    // ============================================
    // COMANDOS ORIGINALES (Lotería y Jugadas)
    // ============================================
    if (primerArg === 'loteria' && partes[1]) {
        const loteria = partes[1].charAt(0).toUpperCase() + partes[1].slice(1).toLowerCase();
        if (LOTERIAS.includes(loteria)) { guardarUltimaLoteria(userId, loteria); return m.reply(`✅ *Lotería cambiada a: ${loteria}*`); }
        else return m.reply(`❌ *Lotería no válida*\n\nOpciones: ${LOTERIAS.join(', ')}`);
    }
    
    try {
        const resultado = procesarMensajeConContexto(userId, textoLimpio);
        const { listeros, errores, tieneErrores } = resultado;
        const totalJugadas = Object.values(listeros).reduce((acc, tipos) => acc + Object.values(tipos).reduce((a, nums) => a + Object.keys(nums).length, 0), 0);
        if (totalJugadas === 0) return m.reply(`❌ *No se encontraron jugadas válidas*\n\n` + (tieneErrores ? `⚠️ Errores:\n${formatearErrores(errores)}` : 'Verifica el formato.'));
        
        if (!globalThis.jugadasPorUsuario) globalThis.jugadasPorUsuario = {};
        globalThis.jugadasPorUsuario[userId] = { listeros, errores };
        
        let respuesta = formatearResultados(listeros);
        if (tieneErrores) respuesta += '\n' + formatearErrores(errores);
        respuesta += `\n🎰 _Lotería: ${cargarUltimaLoteria(userId)}_`;
        respuesta += `\n⏳ _Licencia: ${acceso.tiempoRestante}_`;
        respuesta += `\n\n💡 Usa \`.premios <pick3> <pick4>\` para calcular ganancias`;
        
        await m.reply(respuesta);
    } catch (error) {
        console.error('[SUMA] ❌ Error:', error);
        m.reply(`❌ *Error:* ${error.message}`);
    }
});

// ============================================
// COMANDO .premios
// ============================================
pnix({
    'command': 'premios',
    'fromMe': false,
    'desc': 'Calcula premios y envía tike automáticamente',
    'type': 'command'
}, async (m, conn) => {
    const rawId = getUserId(m);
    const acceso = verificarAccesoUsuario(rawId);
    if (!acceso.autorizado) return m.reply(acceso.mensaje);
    
    const userId = acceso.realPhone;
    const textoCompleto = m.text || m.body || '';
    let textoLimpio = textoCompleto.replace(/^\.[a-zA-Z]+\s*/, '').replace(/^\.[a-zA-Z]+$/, '');
    const args = textoLimpio.trim().split(/\s+/);
    
    if (!args[0] || !args[1]) return m.reply(`🏆 *CALCULAR PREMIOS*\n\n📝 *Formato:*\n\`.premios <pick3> <pick4>\``);
    
    const pick3 = args[0].trim();
    const pick4 = args[1].trim();
    
    if (!/^\d{3}$/.test(pick3) || !/^\d{4}$/.test(pick4)) return m.reply(`❌ *Formato inválido*`);
    if (!globalThis.jugadasPorUsuario || !globalThis.jugadasPorUsuario[userId]) return m.reply(`❌ *No hay jugadas procesadas*\n\nPrimero usa \`.suma\``);
    
    const { listeros } = globalThis.jugadasPorUsuario[userId];
    
    try {
        const loteriaActual = cargarUltimaLoteria(userId);
        const configPremios = cargarConfiguracionPremios(userId, loteriaActual);
        const listerosPorciento = cargarListerosPorciento(userId, loteriaActual);
        const { premios, detalles, ganadorFijo, ganadorCentena, corridos, parletsGanadores } = calcularPremios(userId, listeros, pick3, pick4, configPremios);
        
        let totalGeneral = 0;
        const totalesListeros = {};
        for (const [listero, tipos] of Object.entries(premios)) { const total = Object.values(tipos).reduce((acc, val) => acc + val, 0); totalesListeros[listero] = total; totalGeneral += total; }
        
        if (totalGeneral === 0) {
            const tike = generarTikeSinDeuda(userId, listeros, {}, {}, {}, pick3, pick4);
            await m.reply(`😔 *Sin premios para Pick3=${pick3} Pick4=${pick4}*`);
            await new Promise(r => setTimeout(r, 800));
            await m.reply(tike);
            return;
        }
        
        let respuesta = `🏆 *PREMIOS Pick3=${pick3} Pick4=${pick4}*\n\n✔️ Fijo: ${ganadorFijo}\n✔️ Centena: ${ganadorCentena}\n✔️ Corridos: ${corridos.join(', ')}\n✔️ Parlets: ${parletsGanadores.join(', ')}\n━━━━━━━━━━━━━━━━━━\n💰 *Total a pagar: ${totalGeneral} CUP*\n━━━━━━━━━━━━━━━━━━\n\n`;
        
        for (const [listero, tipos] of Object.entries(premios)) {
            const totalListero = totalesListeros[listero];
            let totalJugado = 0;
            if (listeros[listero]) for (const tipoJugada of Object.values(listeros[listero])) totalJugado += Object.values(tipoJugada).reduce((a, b) => a + b, 0);
            const datosListero = listerosPorciento[listero] || { porciento: 0, deuda: 0 };
            const montoDespuesPorcentaje = totalJugado - (totalJugado * (datosListero.porciento || 0) / 100);
            const balance = montoDespuesPorcentaje - totalListero;
            
            respuesta += `📋 *${listero}* - Total: ${totalListero} CUP\n`;
            if (balance > 0) respuesta += `Ganancias: ${Math.round(balance)} CUP\n`; else if (balance < 0) respuesta += `Pérdidas: ${Math.abs(Math.round(balance))} CUP\n`; else respuesta += `Balance neutro\n`;
            for (const [tipo, monto] of Object.entries(tipos)) { respuesta += `   🟢 ${tipo} → ${monto} CUP\n`; for (const det of detalles[listero][tipo]) respuesta += `      ${det}\n`; }
            respuesta += '\n';
        }
        
        await m.reply(respuesta);
        await new Promise(r => setTimeout(r, 800));
        const tike = generarTikeSinDeuda(userId, listeros, premios, detalles, totalesListeros, pick3, pick4);
        await m.reply(tike);
        
    } catch (error) {
        console.error('[PREMIOS] ❌ Error:', error);
        m.reply(`❌ *Error:* ${error.message}`);
    }
});
