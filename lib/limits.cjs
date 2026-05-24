const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('fs');
const { join } = require('path');

const GROUPS_DIR = './data/groups';

function obtenerRutaGrupo(groupId) {
    const dir = join(GROUPS_DIR, groupId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
}

function cargarLimites(groupId, loteria) {
    const ruta = join(obtenerRutaGrupo(groupId), `limits_${loteria.toLowerCase()}.json`);
    if (existsSync(ruta)) {
        try { return JSON.parse(readFileSync(ruta, 'utf-8')); } catch (e) {}
    }
    // Defecto: sin límites (infinito)
    return { Fijo: 0, Corrido: 0, Centena: 0, Parlet: 0, porNumero: { Fijo: true, Corrido: true, Centena: true, Parlet: true } };
}

function guardarLimites(groupId, loteria, limites) {
    const ruta = join(obtenerRutaGrupo(groupId), `limits_${loteria.toLowerCase()}.json`);
    writeFileSync(ruta, JSON.stringify(limites, null, 2));
}

// Validar si las nuevas jugadas superan la acumulación permitida
function validarLimites(acumulacionActual, nuevasJugadas, limites) {
    const excedentes = [];
    
    for (const [tipo, nums] of Object.entries(nuevasJugadas)) {
        const limiteConfig = limites[tipo] || 0;
        const limitePorNumero = limites.porNumero?.[tipo] !== false;
        
        if (limiteConfig <= 0) continue; // 0 = sin límite
        if (!limitePorNumero) continue;  // Si no es por número, ignorar por ahora
        
        for (const [num, monto] of Object.entries(nums)) {
            const acumulado = acumulacionActual[tipo]?.[num] || 0;
            const totalSeria = acumulado + monto;
            
            if (totalSeria > limiteConfig) {
                excedentes.push({
                    tipo, numero: num,
                    montoNuevo: monto,
                    montoAcumulado: acumulado,
                    totalSeria, limite: limiteConfig
                });
            }
        }
    }
    
    return { excede: excedentes.length > 0, detalles: excedentes };
}

module.exports = { cargarLimites, guardarLimites, validarLimites };
