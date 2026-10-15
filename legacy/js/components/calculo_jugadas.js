// ============================================================
//  Módulo compartido de cálculo de jugadas (taquilla)
//  Define cómo se COBRA y se PAGA cada tipo de jugada.
// ============================================================
window.clubCalculo = (() => {

    // Separa los ejemplares que componen un "cruce":
    //   "5"     -> [5]
    //   "2x3"   -> [2, 3]
    //   "4*8"   -> [4, 8]
    //   "1,2,3" -> [1, 2, 3]
    //   "5-6"   -> [5, 6]
    function parsearCaballos(caballo) {
        const t = String(caballo || '').trim().toUpperCase();
        if (!t) return [];
        const tokens = t.split(/[x*;, +-]+/).map(s => s.trim()).filter(s => /^\d+$/.test(s));
        return [...new Set(tokens)];
    }

    // Cantidad de cruces de la línea (1 si es jugada sencilla)
    function numeroDeCruces(caballo) {
        return parsearCaballos(caballo).length;
    }

    // Total a COBRAR al registrar: monto (por cruce) × número de cruces
    function costoDeLinea(montoPorCruce, numCruces) {
        const m = parseFloat(montoPorCruce) || 0;
        const n = numCruces > 0 ? numCruces : 1;
        return m * n;
    }

    // ¿La jugada se paga "por tabla" (pizarra fija) o por unidad ($)?
    function esPorTabla(jugada, nombreJugada) {
        return !!(jugada && (jugada.tipo_calculo === 'POR_TABLA' || /TABLA/i.test(nombreJugada || '')));
    }

    // Datos del premio a CONGELAR en cada ticket (por ejemplar):
    //  - tablas:  premio de la tabla (premio_recalculado) y su cantidad_tablas
    //  - resto:   monto × "pago si gana" (premio_a_pagar) por unidad
    function premioPorTicket(montoPorCruce, jugada, tablaAsociada) {
        if (tablaAsociada) {
            return {
                premio_por_tabla: Math.max(parseFloat(tablaAsociada.premio_recalculado) || 0, 0),
                cantidad_tablas: Math.max(parseInt(tablaAsociada.cantidad_tablas) || 1, 1),
                moneda: tablaAsociada.moneda || 'USD',
                grupo: tablaAsociada.grupo_venta || 'GENERAL',
                comision_porcentaje: (parseFloat(tablaAsociada.comision_grupo) >= 0)
                    ? parseFloat(tablaAsociada.comision_grupo) : null
            };
        }
        const factor = (jugada && parseFloat(jugada.premio_a_pagar) > 0) ? parseFloat(jugada.premio_a_pagar) : 1;
        const comJugada = (jugada && !isNaN(parseFloat(jugada.comision_porcentaje))) ? parseFloat(jugada.comision_porcentaje) : null;
        return {
            premio_por_tabla: (parseFloat(montoPorCruce) || 0) * factor,
            cantidad_tablas: 1,
            moneda: 'USD',
            grupo: 'GENERAL',
            comision_porcentaje: comJugada
        };
    }

    return { parsearCaballos, numeroDeCruces, costoDeLinea, esPorTabla, premioPorTicket };
})();