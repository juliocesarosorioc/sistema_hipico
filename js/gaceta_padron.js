// ============================================================
//  gaceta_padron.js — Registro del padrón de ejemplares y del
//  historial de gacetas procesadas. Sin DOM: solo Supabase.
//  Expone: window.clubGacetaPadron
// ============================================================
window.clubGacetaPadron = (() => {

    // Inserta en ejemplares completando columnas NOT NULL legacy que exija
    // la BD (sin abortar el lote) tras detectar el error de Postgres.
    async function insertarEjemplar(supabase, nombre, nacionalidad) {
        const extras = {};
        for (let i = 0; i < 5; i++) {
            const body = Object.assign({ nombre, nacionalidad }, extras);
            const { data, error } = await supabase.from('ejemplares').insert(body).select('id').single();
            if (!error) return { data, error };
            if (error.code === '23505') return { data, error };
            const msg = String(error.message || '');
            const nullM = /null value in column "([^"]+)"/.exec(msg);
            if (nullM) {
                const col = nullM[1];
                if (extras[col] !== undefined) return { data, error };
                extras[col] = 0;
                continue;
            }
            const tipoM = /column "([^"]+)" is of type (?:text|character varying|boolean)/i.exec(msg);
            if (tipoM) {
                const col = tipoM[1];
                if (extras[col] !== undefined) return { data, error };
                extras[col] = /boolean/i.test(tipoM[2]) ? false : '';
                continue;
            }
            return { data, error };
        }
        return { data: null, error: { message: 'Columnas requeridas faltantes en ejemplares' } };
    }

    // Vincula cada ejemplar con su id en el padrón; crea los que no existan.
    // Devuelve { nuevos, vinculados, fallidos, errorDb }.
    async function registrar(supabase, carreras) {
        const totales = { nuevos: 0, vinculados: 0, fallidos: 0, errorDb: null };
        if (!supabase) return totales;
        const listaCarreras = Array.isArray(carreras) ? carreras : [];

        let mapa = new Map();
        try {
            const { data, error } = await supabase.from('ejemplares').select('id, nombre, nacionalidad');
            if (error) throw error;
            (data || []).forEach(e => {
                const clave = `${String(e.nombre || '').trim().toUpperCase()}|${String(e.nacionalidad || 'VE').trim().toUpperCase() || 'VE'}`;
                mapa.set(clave, e.id);
            });
        } catch (e) {
            const n = listaCarreras.reduce((a, c) => a + (Array.isArray(c.ejemplares) ? c.ejemplares.length : 0), 0);
            totales.fallidos = n;
            totales.errorDb = e.message || String(e);
            return totales;
        }

        let totalNombres = 0;
        for (const c of listaCarreras) totalNombres += (Array.isArray(c.ejemplares) ? c.ejemplares.length : 0);
        let procesados = 0;
        let rls = false;

        for (const c of listaCarreras) {
            if (rls) break;
            c.ejemplares = Array.isArray(c.ejemplares) ? c.ejemplares : [];
            for (const ej of c.ejemplares) {
                const nombre = String(ej.nombre || '').trim().toUpperCase().slice(0, 100);
                const nac = (String(ej.nacionalidad || 'VE').trim().toUpperCase() || 'VE').slice(0, 3);
                ej.nombre = nombre;
                ej.nacionalidad = nac;
                if (!nombre) { ej.ejemplar_id = null; procesados++; continue; }
                const clave = `${nombre}|${nac}`;
                if (mapa.has(clave)) {
                    ej.ejemplar_id = mapa.get(clave);
                    ej.nuevo = false;
                    totales.vinculados++;
                    procesados++;
                    continue;
                }
                const { data, error } = await insertarEjemplar(supabase, nombre, nac);
                if (error) {
                    console.error('[gaceta_padron] INSERT error:', JSON.stringify(error, null, 2));
                    if (error.code === '23505') {
                        const { data: existente } = await supabase.from('ejemplares').select('id').eq('nombre', nombre).eq('nacionalidad', nac).limit(1).single();
                        if (existente) { ej.ejemplar_id = existente.id; ej.nuevo = false; totales.vinculados++; procesados++; continue; }
                    }
                    totales.errorDb = totales.errorDb || (error.message || String(error));
                    if (rls || error.status === 403 || error.code === '42501' || /row-level security|permission denied for table/i.test(String(error.message || ''))) {
                        // SQL pendiente (RLS activo en "ejemplares"): no seguir martillando inserciones.
                        rls = true;
                        ej.ejemplar_id = null; ej.nuevo = false;
                        totales.fallidos = totalNombres - procesados;
                        break;
                    }
                    ej.ejemplar_id = null; ej.nuevo = false; totales.fallidos++;
                    procesados++;
                    continue;
                }
                if (data?.id) {
                    ej.ejemplar_id = data.id; ej.nuevo = true; totales.nuevos++;
                    mapa.set(clave, data.id);
                } else {
                    ej.ejemplar_id = null; ej.nuevo = false; totales.fallidos++;
                }
                procesados++;
            }
        }
        return totales;
    }

    async function guardarHistorial(supabase, carreras, usuario) {
        const listaCarreras = Array.isArray(carreras) ? carreras : [];
        const fecha = listaCarreras.find(c => c.fecha)?.fecha || null;
        const { error } = await supabase.from('gaceta_procesada').insert({
            fecha_gaceta: fecha || null,
            num_carreras: listaCarreras.length,
            contenido: listaCarreras,
            creado_por: usuario || 'desconocido'
        });
        if (error) throw error;
    }

    return { registrar, guardarHistorial, insertarEjemplar };
})();