// Archivo: js/components/programa_dia.js
// Propósito: "Programa del día" compartido entre módulos. Cuando el
// Ensamblaje carga las carreras y el hipódromo desde la Gaceta, los
// guarda en la tabla public.programa_dia (una fila por fecha), con
// respaldo en localStorage si la tabla todavía no existe. Taquilla,
// Venta de Tablas, Liquidación y W.P.S. llaman a window.clubPrograma
// para precargar hipódromo/carreras sin volver a configurarlos.
// Carga SIEMPRE tolerante: si algo falla, devuelve el respaldo local.

(function () {
    if (window.clubPrograma) return;

    const CLAVE = 'club_programa_dia';

    function leerLocal() {
        try {
            const x = JSON.parse(localStorage.getItem(CLAVE));
            if (x && Array.isArray(x.carreras)) return x;
        } catch (e) { /* vacío */ }
        return null;
    }
    function escribirLocal(p) {
        try { localStorage.setItem(CLAVE, JSON.stringify(p)); } catch (e) { /* vacío */ }
    }

    function hoy() {
        const d = new Date();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const dia = String(d.getDate()).padStart(2, '0');
        return d.getFullYear() + '-' + m + '-' + dia;
    }

    function base() {
        const local = leerLocal();
        return {
            fecha: (local && local.fecha) || hoy(),
            hipodromos: (local && Array.isArray(local.hipodromos)) ? local.hipodromos : [],
            carreras: (local && Array.isArray(local.carreras)) ? local.carreras : []
        };
    }

    // Carga el programa del día desde la BD; si falta la tabla usa localStorage.
    async function cargar() {
        try {
            const { data } = await window.supabase
                .from('programa_dia')
                .select('fecha, hipodromos, carreras')
                .order('fecha', { ascending: false })
                .limit(1);
            if (data && data.length) {
                const p = {
                    fecha: data[0].fecha || hoy(),
                    hipodromos: data[0].hipodromos || [],
                    carreras: data[0].carreras || []
                };
                escribirLocal(p);
                return p;
            }
        } catch (e) { /* sin tabla todavía: respaldo local */ }
        return base();
    }

    // Guarda en BD (upsert por fecha) y en el navegador. Nunca lanza.
    async function guardar(programa) {
        const p = {
            fecha: (programa && programa.fecha) || hoy(),
            hipodromos: Array.isArray(programa && programa.hipodromos) ? programa.hipodromos : [],
            carreras: Array.isArray(programa && programa.carreras) ? programa.carreras : []
        };
        escribirLocal(p);
        try {
            await window.supabase.from('programa_dia').upsert(
                {
                    fecha: p.fecha,
                    hipodromos: p.hipodromos,
                    carreras: p.carreras,
                    resumen: p.carreras.length + ' carrera(s) · ' + p.hipodromos.join(', '),
                    creado_por: (window.clubAuth && window.clubAuth.getSesion && window.clubAuth.getSesion().nombre) || 'desconocido'
                },
                { onConflict: 'fecha' }
            );
        } catch (e) { /* sin tabla: el respaldo local ya quedó escrito */ }
        return p;
    }

    // Anexa (o actualiza) una carrera al programa del día y persiste.
    function agregarCarrera(c) {
        if (!c || !c.hipodromo) return {};
        const nombreHipo = String(c.hipodromo).trim().toUpperCase();
        if (!nombreHipo) return {};
        const p = base();
        if (!p.hipodromos.some(h => String(h).toUpperCase() === nombreHipo)) {
            p.hipodromos.push(nombreHipo);
        }
        const nueva = {
            hipodromo: nombreHipo,
            carrera: c.carrera || null,
            distancia: c.distancia || null,
            superficie: c.superficie || '',
            premio: c.premio || 0,
            caballos: Array.isArray(c.caballos) ? c.caballos : []
        };
        const idx = p.carreras.findIndex(x =>
            String(x.hipodromo || '').toUpperCase() === nombreHipo &&
            (x.carrera === c.carrera)
        );
        if (idx === -1) p.carreras.push(nueva);
        else p.carreras[idx] = Object.assign({}, p.carreras[idx], nueva);
        return guardar(p);
    }

    window.clubPrograma = {
        cargar: cargar,
        guardar: guardar,
        agregarCarrera: agregarCarrera,
        obtener: base,
        hipodromos: function () { return base().hipodromos; },
        carreras: function () { return base().carreras; }
    };
})();