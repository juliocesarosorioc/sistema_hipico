// Archivo: js/conexion.js
// Propósito: Puente de compatibilidad. Las credenciales y el cliente Supabase
// viven en js/components/db.js. Este archivo expone window.supabase para
// que todos los módulos existentes sigan funcionando sin cambios.

if (window.__clubSupabaseClient) {
    window.supabase = window.__clubSupabaseClient;
} else if (typeof supabase !== 'undefined' && typeof supabase.createClient === 'function') {
    console.error('Error: db.js debe cargarse antes de conexion.js.');
} else {
    console.error('Error: La librería de Supabase no cargó en el HTML.');
}

// ============================================================
//  TASAS DE REFERENCIA (BCV / BINANCE / EURO)
// ============================================================
//  Lee tasas_referencia (tabla creada con sql/tasas_referencia.sql)
//  y se usa en todas las paginas para tomar la tasa VIGENTE segun fecha.
//  Si la tabla aun no existe (SQL no ejecutado), hace fallback a monedas.
// ============================================================
window.clubTasas = {
    TIPOS: ['BCV', 'BINANCE', 'EURO'],
    LABELS: { BCV: 'Dólar BCV', BINANCE: 'Dólar Binance', EURO: 'Euro' },

    // Tasa vigente de un tipo (ej 'BCV') al cierre de una fecha (YYYY-MM-DD o null=hoy).
    // Retorna { tasa, fecha_aplicar } o null.
    async vigente(tipo, fechaISO) {
        const hasta = fechaISO ? `${fechaISO}T23:59:59` : null;
        try {
            let q = window.supabase.from('tasas_referencia')
                .select('tasa, fecha_aplicar')
                .eq('tipo', tipo)
                .order('fecha_aplicar', { ascending: false })
                .limit(1);
            if (hasta) q = q.lte('fecha_aplicar', hasta);
            const { data } = await q.single();
            return data ? { tasa: parseFloat(data.tasa), fecha_aplicar: data.fecha_aplicar } : null;
        } catch (e) {
            return null;
        }
    },

    // Tasa global del dolar (BCV) vigente hoy, con fallback a monedas.tasa_cambio.
    async globalVes() {
        const bcv = await window.clubTasas.vigente('BCV');
        if (bcv && bcv.tasa > 0) return bcv.tasa;
        try {
            const { data } = await window.supabase.from('monedas').select('tasa_cambio').limit(1).single();
            if (data && data.tasa_cambio) return parseFloat(data.tasa_cambio);
        } catch (e) { /* sin monedas */ }
        return 1.0;
    }
};