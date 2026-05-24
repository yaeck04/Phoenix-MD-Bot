const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('fs');
const { join } = require('path');
const { cargarConfigGrupo, guardarConfigGrupo } = require('./grupo_config.cjs');

const GROUPS_DIR = './data/groups';

function obtenerRutaGrupo(groupId) {
    const dir = join(GROUPS_DIR, groupId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
}

function generarIdJornada(loteria, turno) {
    const hoy = new Date();
    const fecha = hoy.toISOString().split('T')[0];
    return `${fecha}_${loteria.toLowerCase()}_${turno}`;
}

function cargarJornada(groupId, jornadaId) {
    const ruta = join(obtenerRutaGrupo(groupId), 'jornadas', `${jornadaId}.json`);
    if (existsSync(ruta)) {
        try { return JSON.parse(readFileSync(ruta, 'utf-8')); } catch (e) {}
    }
    return null;
}

function guardarJornada(groupId, jornadaId, data) {
    const dir = join(obtenerRutaGrupo(groupId), 'jornadas');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const ruta = join(dir, `${jornadaId}.json`);
    writeFileSync(ruta, JSON.stringify(data, null, 2));
}

function crearJornada(groupId, loteria, turno) {
    const jornadaId = generarIdJornada(loteria, turno);
    let jornada = cargarJornada(groupId, jornadaId);
    
    if (jornada && jornada.estado === 'activa') return jornada;
    
    jornada = {
        id: jornadaId, fecha: new Date().toISOString(),
        loteria, turno, estado: 'activa',
        inicioReal: new Date().toISOString(), finReal: null,
        mensajes: [],
        acumulacion: { Fijo: {}, Corrido: {}, Centena: {}, Parlet: {} },
        listeros: {},
        premios: null, pick3: null, pick4: null
    };
    
    guardarJornada(groupId, jornadaId, jornada);
    
    // Marcar como jornada activa en la config del grupo
    const config = cargarConfigGrupo(groupId);
    config.jornadaActivaId = jornadaId;
    guardarConfigGrupo(groupId, config);
    
    return jornada;
}

function cerrarJornada(groupId, jornadaId) {
    const jornada = cargarJornada(groupId, jornadaId);
    if (!jornada) return null;
    
    jornada.estado = 'cerrada';
    jornada.finReal = new Date().toISOString();
    guardarJornada(groupId, jornadaId, jornada);
    
    // Quitar jornada activa de la config
    const config = cargarConfigGrupo(groupId);
    if (config.jornadaActivaId === jornadaId) {
        config.jornadaActivaId = null;
        guardarConfigGrupo(groupId, config);
    }
    
    return jornada;
}

function agregarMensajeJornada(groupId, jornadaId, msgData) {
    const jornada = cargarJornada(groupId, jornadaId);
    if (!jornada || jornada.estado !== 'activa') return null;
    
    msgData.numero = jornada.mensajes.length + 1;
    jornada.mensajes.push(msgData);
    
    if (msgData.valido && msgData.jugadas) {
        for (const [tipo, nums] of Object.entries(msgData.jugadas)) {
            if (!jornada.acumulacion[tipo]) jornada.acumulacion[tipo] = {};
            for (const [num, monto] of Object.entries(nums)) {
                jornada.acumulacion[tipo][num] = (jornada.acumulacion[tipo][num] || 0) + monto;
            }
        }
        
        const listero = msgData.listeroNombre;
        if (!jornada.listeros[listero]) jornada.listeros[listero] = { Fijo: {}, Corrido: {}, Centena: {}, Parlet: {} };
        for (const [tipo, nums] of Object.entries(msgData.jugadas)) {
            if (!jornada.listeros[listero][tipo]) jornada.listeros[listero][tipo] = {};
            for (const [num, monto] of Object.entries(nums)) {
                jornada.listeros[listero][tipo][num] = (jornada.listeros[listero][tipo][num] || 0) + monto;
            }
        }
    }
    
    guardarJornada(groupId, jornadaId, jornada);
    return msgData.numero;
}

module.exports = { generarIdJornada, cargarJornada, guardarJornada, crearJornada, cerrarJornada, agregarMensajeJornada };
