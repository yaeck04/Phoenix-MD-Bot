const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('fs');
const { join } = require('path');

const GROUPS_DIR = './data/groups';

function obtenerRutaGrupo(groupId) {
    const dir = join(GROUPS_DIR, groupId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
}

function cargarJSON(ruta, defecto = {}) {
    if (existsSync(ruta)) {
        try { return JSON.parse(readFileSync(ruta, 'utf-8')); } catch (e) {}
    }
    return defecto;
}

function guardarJSON(ruta, datos) {
    writeFileSync(ruta, JSON.stringify(datos, null, 2));
}

// ===== CONFIGURACIÓN GENERAL DEL GRUPO =====
function cargarConfigGrupo(groupId) {
    const ruta = join(obtenerRutaGrupo(groupId), 'config.json');
    const defecto = {
        adminPhone: null,
        loteriaActual: "Florida",
        modo: "automatico",
        listerosRegistrados: [],
        configPremios: { Parlet: 400, Centena: 400, Fijo: 80, Corrido: 20 },
        barra_interpretacion: "error"
    };
    return cargarJSON(ruta, defecto);
}

function guardarConfigGrupo(groupId, config) {
    const ruta = join(obtenerRutaGrupo(groupId), 'config.json');
    guardarJSON(ruta, config);
}

// ===== LISTEROS =====
function cargarListerosGrupo(groupId) {
    const ruta = join(obtenerRutaGrupo(groupId), 'listeros.json');
    return cargarJSON(ruta, {});
}

function guardarListerosGrupo(groupId, listeros) {
    const ruta = join(obtenerRutaGrupo(groupId), 'listeros.json');
    guardarJSON(ruta, listeros);
}

function registrarListero(groupId, phone, nombre) {
    const listeros = cargarListerosGrupo(groupId);
    listeros[phone] = { nombre, porciento: 0, deuda: 0, horarioPermitido: "ambos", activo: true };
    guardarListerosGrupo(groupId, listeros);
    return listeros[phone];
}

function eliminarListero(groupId, phone) {
    const listeros = cargarListerosGrupo(groupId);
    delete listeros[phone];
    guardarListerosGrupo(groupId, listeros);
}

// ===== HORARIOS =====
function cargarHorariosGrupo(groupId) {
    const ruta = join(obtenerRutaGrupo(groupId), 'horarios.json');
    const defecto = {
        "Florida": {
            "mañana": { inicio: "08:00", fin: "13:20", resultados: "13:36", dias: ["lunes","martes","miércoles","jueves","viernes","sábado"] },
            "tarde": { inicio: "15:00", fin: "19:30", resultados: "19:46", dias: ["lunes","martes","miércoles","jueves","viernes","sábado"] }
        }
    };
    return cargarJSON(ruta, defecto);
}

function guardarHorariosGrupo(groupId, horarios) {
    const ruta = join(obtenerRutaGrupo(groupId), 'horarios.json');
    guardarJSON(ruta, horarios);
}

module.exports = {
    cargarConfigGrupo, guardarConfigGrupo,
    cargarListerosGrupo, guardarListerosGrupo, registrarListero, eliminarListero,
    cargarHorariosGrupo, guardarHorariosGrupo
};
