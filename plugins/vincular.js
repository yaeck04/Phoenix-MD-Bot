const { pnix } = require('../lib/commands');
const { verificarAccesoUsuario, cargarUsuariosAcceso, guardarUsuariosAcceso } = require('../lib/jugadas.cjs');

// Función auxiliar robusta para detectar el grupo
function getGroupId(m) {
    const chat = m.from || m.chat || m.key?.remoteJid || '';
    if (chat.includes('@g.us')) return chat.replace('@g.us', '');
    return null;
}

pnix({
    command: 'vincular',
    fromMe: false,
    desc: 'Vincula tu ID de grupo con tu número de licencia',
    type: 'command'
}, async (m, conn) => {
    const groupId = getGroupId(m);
    const senderId = m.sender || ''; // En grupo esto es el @lid
    
    if (!groupId) {
        return m.reply('⚠️ *Este comando se usa en el grupo.*\n\nEn el grupo escribe:\n`.vincular TU_NUMERO`\n\nEjemplo: `.vincular 5356965304`');
    }

    if (!senderId.includes('@lid')) {
        return m.reply('✅ Tu número ya es visible en este grupo, no necesitas vincularte.');
    }

    const args = (m.text || m.body || '').trim().split(/\s+/);
    const phoneNumber = args[1];

    if (!phoneNumber) {
        return m.reply('⚠️ *Uso:*\n\n`.vincular TU_NUMERO_TELEFONO`\n\nEjemplo: `.vincular 5356965304`');
    }

    const cleanPhone = phoneNumber.replace(/\D/g, '');
    
    // Verificar si el teléfono tiene licencia
    const usuarios = cargarUsuariosAcceso();
    const idx = usuarios.findIndex(u => u.phone === cleanPhone);

    if (idx === -1) {
        return m.reply(`❌ El número ${cleanPhone} no tiene licencia activa.`);
    }

    // Vincular el @lid con el teléfono
    if (!usuarios[idx].groupLids) usuarios[idx].groupLids = [];
    
    if (!usuarios[idx].groupLids.includes(senderId)) {
        usuarios[idx].groupLids.push(senderId);
        guardarUsuariosAcceso(usuarios);
        return m.reply(`✅ *¡Vinculación exitosa!*\n\nTu ID de grupo ahora está vinculado a la licencia de ${cleanPhone}.\n\n¡Ya puedes usar los comandos del bot en este grupo!`);
    } else {
        return m.reply(`ℹ️ *Ya estás vinculado* a la licencia de ${cleanPhone}.`);
    }
});
