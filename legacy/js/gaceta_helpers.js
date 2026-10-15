// ============================================================
//  gaceta_helpers.js — Constantes y utilidades puras de la gaceta.
//  No toca el DOM ni `estado`: funciones 100% reutilizables.
//  Expone: window.clubGacetaHelpers
// ============================================================
window.clubGacetaHelpers = (() => {

    const SUPERFICIES = ['ARENA', 'CESPED', 'FANGO', 'TAPETA', 'OTRA'];
    const NACIONALIDADES = ['VE', 'USA', 'BR', 'AR', 'CL', 'MX', 'PA', 'PE', 'CO', 'EC', 'UY', 'OTRA'];
    const FLAGS = { VE: '🇻🇪', USA: '🇺🇸', BR: '🇧🇷', AR: '🇦🇷', CL: '🇨🇱', MX: '🇲🇽', PA: '🇵🇦', PE: '🇵🇪', CO: '🇨🇴', EC: '🇪🇨', UY: '🇺🇾', OTRA: '🏳️' };

    // Modelos Flash de respaldo (la app primero consulta a la API cuáles existen hoy)
    const MODELOS_GEMINI = ['gemini-3.6-flash', 'gemini-3-flash', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

    // Hipódromos de EE.UU. sembrados en la BD: si la carrera es de uno de ellos,
    // sus ejemplares quedan con nacionalidad USA por defecto; los de Venezuela (o
    // no reconocidos, el programa es venezolano) quedan VE.
    const HIPODROMOS_USA = [
        'AQUEDUCT', 'BELMONT PARK', 'CHARLES TOWN', 'CHURCHILL DOWNS', 'DEL MAR',
        'FAIR GROUNDS', 'FINGER LAKES', 'GOLDEN GATE FIELDS', 'GULFSTREAM PARK',
        'KEENELAND', 'LAUREL PARK', 'LOS ALAMITOS', 'MONMOUTH PARK', 'OAKLAWN PARK',
        'PIMLICO', 'SANTA ANITA', 'SARATOGA', 'TAMPA BAY DOWNS'
    ];

    // Registro persistente (localStorage/sessionStorage)
    const REGISTRO_KEY = 'gaceta_registro';

    // Acepta "3,5" y "3.5" (decimal con coma típico en Vzla)
    function aNum(v) {
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        if (!s) return null;
        const n = parseFloat(s.replace(/,/g, '.'));
        return Number.isFinite(n) ? n : null;
    }

    function paisHipodromo(hipo) {
        const h = String(hipo || '').trim().toUpperCase();
        if (!h) return null;
        if (HIPODROMOS_USA.some(n => h.includes(n))) return 'USA';
        return 'VE';
    }

    // Nacionalidad por defecto de un ejemplar: la que trajo la IA si es válida,
    // si no la del país del hipódromo de la carrera (USA/VE).
    function nacEjemplar(ej, hipo) {
        const nac = String(ej?.nacionalidad || '').trim().toUpperCase();
        if (NACIONALIDADES.includes(nac)) return nac;
        return paisHipodromo(hipo) || 'VE';
    }

    // Paleta oficial de 14 colores de gualdrapa (idéntica a la del Ensamblaje)
    function colorDeNumeroGac(n) {
        const x = parseInt(n, 10);
        const PALETA = [
            { bg: '#FF0000', fg: '#FFFFFF' }, { bg: '#FFFFFF', fg: '#000000' },
            { bg: '#0000FF', fg: '#FFFFFF' }, { bg: '#FFFF00', fg: '#000000' },
            { bg: '#008000', fg: '#FFFFFF' }, { bg: '#000000', fg: '#FFFF00' },
            { bg: '#FFA500', fg: '#000000' }, { bg: '#FFC0CB', fg: '#000000' },
            { bg: '#40E0D0', fg: '#000000' }, { bg: '#800080', fg: '#FFFFFF' },
            { bg: '#808080', fg: '#FF0000' }, { bg: '#32CD32', fg: '#000000' },
            { bg: '#8B4513', fg: '#FFFFFF' }, { bg: '#800000', fg: '#FFFFFF' }
        ];
        if (!x) return { bg: '#94a3b8', fg: '#FFFFFF' };
        return PALETA[((x - 1) % 14)];
    }

    function parsearRangoPaginas(txt) {
        const set = new Set();
        (txt || '').split(',').forEach(part => {
            part = part.trim();
            if (!part) return;
            const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
            if (m) {
                const a = Math.min(+m[1], +m[2]);
                const b = Math.max(+m[1], +m[2]);
                for (let i = a; i <= b; i++) set.add(i);
            } else if (/^\d+$/.test(part)) {
                set.add(+part);
            }
        });
        return set;
    }

    function dataURLImagen(file) {
        return new Promise((resolve, reject) => {
            const rd = new FileReader();
            rd.onload = () => resolve(rd.result);
            rd.onerror = reject;
            rd.readAsDataURL(file);
        });
    }

    function coaccionarCarreras(v) {
        if (Array.isArray(v)) return v;
        if (v && typeof v === 'object') {
            if (Array.isArray(v.carrera)) return v.carrera;
            const vals = Object.values(v);
            if (vals.length && typeof vals[0] === 'object') return vals;
        }
        return [];
    }

    function parsearJSON(texto) {
        let t = (texto || '').trim();
        const cercos = t.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (cercos) t = cercos[1].trim();
        const intentos = [];
        try { intentos.push(JSON.parse(t)); } catch (e) { /* sigue */ }
        const ini = t.indexOf('{');
        const fin = t.lastIndexOf('}');
        if (ini >= 0 && fin > ini) {
            try { intentos.push(JSON.parse(t.slice(ini, fin + 1))); } catch (e2) { /* sigue */ }
        }
        const iniArr = t.indexOf('[');
        const finArr = t.lastIndexOf(']');
        if (iniArr >= 0 && finArr > iniArr) {
            try { intentos.push(JSON.parse(t.slice(iniArr, finArr + 1))); } catch (e3) { /* sigue */ }
        }
        for (const obj of intentos) {
            if (Array.isArray(obj)) return obj;
            if (obj && typeof obj === 'object') {
                const c = coaccionarCarreras(obj.carreras);
                if (c.length) return c;
                const c2 = coaccionarCarreras(obj.carrera);
                if (c2.length) return c2;
            }
        }
        return [];
    }

    function leerRegistro() {
        try { const a = JSON.parse(localStorage.getItem(REGISTRO_KEY)); if (Array.isArray(a)) return a; } catch (e) { /* vacío */ }
        try { const a = JSON.parse(sessionStorage.getItem(REGISTRO_KEY)); if (Array.isArray(a)) return a; } catch (e) { /* vacío */ }
        return null;
    }

    function escribirRegistro(arr) {
        try { localStorage.setItem(REGISTRO_KEY, JSON.stringify(arr)); } catch (e) { /* vacío */ }
        try { sessionStorage.setItem(REGISTRO_KEY, JSON.stringify(arr)); } catch (e) { /* vacío */ }
    }

    function persistirRegistro(estado) {
        escribirRegistro(estado.carreras.map(c => Object.assign({}, c, { enviada: !!c.enviada, aplicada: !!c.aplicada })));
    }

    function marcarEnviadas(estado, carreras) {
        // Coincidencia robusta: hipódromo+carrera, si no sólo hipódromo, si no
        // una pendiente con hipódromo vacío, y como última vía el primero sin
        // marcar (funciona aunque la IA no haya dado el número de carrera).
        const porMarcar = estado.carreras.filter(c => !c.enviada);
        carreras.forEach(ce => {
            const hipo = String(ce.hipodromo || '').trim().toUpperCase();
            let idx = porMarcar.findIndex(c => String(c.hipodromo || '').trim().toUpperCase() === hipo && String(c.carrera ?? '') === String(ce.carrera ?? ''));
            if (idx === -1 && hipo) idx = porMarcar.findIndex(c => String(c.hipodromo || '').trim().toUpperCase() === hipo);
            if (idx === -1) idx = porMarcar.findIndex(c => !String(c.hipodromo || '').trim());
            if (idx === -1) idx = 0;
            const objetivo = porMarcar.splice(idx, 1)[0];
            if (objetivo) {
                objetivo.enviada = true; objetivo.aplicada = false;
                // Guarda los VALORES editados en pantalla: sin esto, el registro
                // conservaba los valores originales de la IA y al regresar al
                // Ensamblaje no aparecían los que el operador colocó en la carga.
                const porNombre = new Map();
                (ce.caballos || []).forEach(cb => porNombre.set(String(cb.nombre || '').toUpperCase(), cb));
                (objetivo.ejemplares || []).forEach(ej => {
                    const cb = porNombre.get(String(ej.nombre || '').toUpperCase());
                    if (cb) { ej.numero = cb.numero; ej.valor = cb.valor; }
                });
            }
        });
        persistirRegistro(estado);
    }

    return {
        REGISTRO_KEY,
        SUPERFICIES,
        NACIONALIDADES,
        FLAGS,
        MODELOS_GEMINI,
        HIPODROMOS_USA,
        aNum, paisHipodromo, nacEjemplar, colorDeNumeroGac, parsearRangoPaginas,
        dataURLImagen, coaccionarCarreras, parsearJSON,
        leerRegistro, escribirRegistro, persistirRegistro, marcarEnviadas
    };
})();