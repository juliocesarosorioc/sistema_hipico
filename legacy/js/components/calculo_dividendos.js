// ============================================================
//  Motor de dividendos por tipo de jugada (WIN/PLACE/SHOW/
//  PUESTOS/MARCAS) basado en pozo parimutuel.
//  Sugiere dividendos (pago por cada $1 apostado) a partir de
//  los tickets registrados de la carrera y el orden de llegada.
//  La Taquilla carga el resultado central y ajusta sobre estos
//  valores sugeridos antes de guardarlos en resultados_carreras.
// ============================================================
window.clubDividendos = (() => {

    const TAKEOUT = 0.18;

    // Aliases de cada tipo de jugada según tipos_jugadas.nombre
    const TIPOS = {
        win:    /^(WIN|GANADOR|GANANCIA)$/i,
        place:  /^(PLACE|LUGAR|2DO|SEGUNDO)$/i,
        show:   /^(SHOW|MOSTRAR|3RO|TERCERO)$/i,
        puestos:/^(PUESTOS|EXACTA|PERFECTA)$/i,
        marcas: /^(MARCAS|TRIFECTA|SUPERFECTA)$/i
    };

    const CLAVES = ['win', 'place', 'show', 'puestos', 'marcas'];

    // Agrupa los tickets de una carrera por tipo de jugada
    function agrupar(tickets) {
        const grupos = { win: [], place: [], show: [], puestos: [], marcas: [], otros: [] };
        (tickets || []).forEach(t => {
            const nom = String(t.nombre_jugada || '').trim();
            let k = 'otros';
            for (const [clave, re] of Object.entries(TIPOS)) {
                if (re.test(nom)) { k = clave; break; }
            }
            grupos[k].push(t);
        });
        return grupos;
    }

    function sumarMonto(lista) {
        return (lista || []).reduce((a, t) => a + (parseFloat(t.monto_jugado) || 0), 0);
    }

    // Montos apostados por número dentro de un grupo
    function montoHorse(lista, numeros) {
        const nums = new Set((numeros || []).map(String));
        return (lista || []).reduce((a, t) => {
            const cab = String(t.caballo || '').trim().toUpperCase();
            return nums.has(cab) ? a + (parseFloat(t.monto_jugado) || 0) : a;
        }, 0);
    }

    // Montos apostados por una combinación ordenada (exacta/trifecta)
    function montoCombinacion(lista, combinacion) {
        const ord = (combinacion || []).map(String);
        if (!ord.length) return 0;
        return (lista || []).reduce((a, t) => {
            const cab = window.clubCalculo?.parsearCaballos(t.caballo) || [];
            const arr = cab.map(String);
            if (arr.length === ord.length && ord.every((v, i) => arr[i] === v)) {
                return a + (parseFloat(t.monto_jugado) || 0);
            }
            return a;
        }, 0);
    }

    // Dividendo neto (con takeout de pozo) sobre el monto ganador
    function dividendo(pool, montoGanador) {
        if (!pool || pool <= 0) return null;
        if (!montoGanador || montoGanador <= 0) return null;
        const d = (pool * (1 - TAKEOUT)) / montoGanador;
        return Math.max(Number(d.toFixed(2)), 0) || null;
    }

    // Ticket sin cruces: solo el número puro
    function puro(caballo) {
        return String(caballo || '').trim().toUpperCase();
    }

    // Devuelve los dividendos sugeridos para una carrera.
    //  tickets : filas de tickets_apuestas de la carrera
    //  orden   : números de ejemplares en orden de llegada, ej. ['5','3','8']
    function calcular(tickets, orden) {
        const grupos = agrupar(tickets);
        const ord = (orden || []).map(String).filter(Boolean);
        const sugeridos = { win: null, place: null, show: null, puestos: null, marcas: null };

        if (ord.length >= 1) {
            const base = () => sumarMonto(grupos.win) || sumarMonto(tickets);
            sugeridos.win = dividendo(base(), montoHorse(grupos.win, [ord[0]]));
        }
        if (ord.length >= 2) {
            const base = () => sumarMonto(grupos.place) || sumarMonto(tickets);
            sugeridos.place = dividendo(base(), montoHorse(grupos.place, ord.slice(0, 2)));
        }
        if (ord.length >= 3) {
            const base = () => sumarMonto(grupos.show) || sumarMonto(tickets);
            sugeridos.show = dividendo(base(), montoHorse(grupos.show, ord.slice(0, 3)));
        }
        if (ord.length >= 2) {
            const poolPuestos = sumarMonto(grupos.puestos);
            const ganPuestos = montoCombinacion(grupos.puestos, ord.slice(0, 2));
            sugeridos.puestos = dividendo(poolPuestos, ganPuestos);
        }
        if (ord.length >= 3) {
            const poolMarcas = sumarMonto(grupos.marcas);
            const ganMarcas = montoCombinacion(grupos.marcas, ord.slice(0, 3));
            sugeridos.marcas = dividendo(poolMarcas, ganMarcas);
        }

        return {
            ganador: ord[0],
            orden: ord,
            pool_total: sumarMonto(tickets),
            por_tipo: {
                win: sumarMonto(grupos.win),
                place: sumarMonto(grupos.place),
                show: sumarMonto(grupos.show),
                puestos: sumarMonto(grupos.puestos),
                marcas: sumarMonto(grupos.marcas)
            },
            sugeridos
        };
    }

    // Verifica que el ticket sea ganador de un tipo (para liquidación futura)
    function esGanador(ticket, resultado) {
        const nom = String(ticket.nombre_jugada || '').trim();
        const cab = puro(ticket.caballo);
        const ord = (resultado?.orden || resultado?.ganadores || []).map(String);
        // Tabla: se usa el ganador de la carrera
        if (/TABLA/i.test(nom)) return ord.includes(cab);
        if (TIPOS.win.test(nom)) return ord.length >= 1 && ord[0] === cab;
        if (TIPOS.place.test(nom)) return ord.length >= 2 && ord.slice(0, 2).includes(cab);
        if (TIPOS.show.test(nom)) return ord.length >= 3 && ord.slice(0, 3).includes(cab);
        if (TIPOS.puestos.test(nom)) {
            const combo = window.clubCalculo?.parsearCaballos(ticket.caballo) || [];
            return ord.length >= 2 && combo.map(String).join('-') === ord.slice(0, 2).join('-');
        }
        if (TIPOS.marcas.test(nom)) {
            const combo = window.clubCalculo?.parsearCaballos(ticket.caballo) || [];
            return ord.length >= 3 && combo.map(String).join('-') === ord.slice(0, 3).join('-');
        }
        // Por defecto: acierta si su número está en los ganadores
        return ord.includes(cab);
    }

    return { TIPOS, CLAVES, calcular, esGanador, agrupar };
})();