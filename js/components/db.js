// Archivo: js/components/db.js
// Propósito: Conexión única y reusable a Supabase.
// Todas las páginas deben cargar: supabase CDN -> db.js -> conexion.js

// Carga el indicador global de acción (caballito corriendo + % de avance)
// ANTES de crear el cliente de Supabase, para que toda consulta quede
// contabilizada (el cliente debe usar el fetch "vivo" de la página).
if (!window.clubIndicador) {
    document.write('<script src="../js/components/indicador_accion.js"><\/script>');
}

const SUPABASE_URL = 'https://dbkvnqzchtcabhiaqdyi.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRia3ZucXpjaHRjYWJoaWFxZHlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzNTkxOTYsImV4cCI6MjEwMzkzNTE5Nn0._ciSMFx_7Ogrt9XAy9YJzJTb2FKYWSwxf_0ryvgU35E';

(() => {
    if (window.__clubSupabaseClient) {
        window.supabase = window.__clubSupabaseClient;
        return;
    }

    if (typeof supabase === 'undefined' || typeof supabase.createClient !== 'function') {
        console.error('Error: La librería de Supabase no cargó en el HTML.');
        return;
    }

    // "fetch" vivo: cada llamada pasa por window.fetch (que el indicador
    // contabiliza), aunque el cliente se haya creado antes de montarlo.
    window.__clubSupabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { fetch: (...args) => window.fetch(...args) }
    });
    window.supabase = window.__clubSupabaseClient;
    console.log('Conexión con Supabase configurada exitosamente.');
})();

// ==========================================
// Utilidades compartidas de base de datos
// ==========================================
window.clubDB = {
    // Registra una acción en la tabla de auditoría (requiere función club_log_accion).
    // Si la función aún no existe en la BD, falla en silencio sin romper la app.
    async logAccion(modulo, accion) {
        try {
            const sesion = window.clubAuth ? window.clubAuth.getSesion() : null;
            await window.supabase.rpc('club_log_accion', {
                p_usuario: sesion ? sesion.nombre : 'anon',
                p_modulo: modulo,
                p_accion: accion,
                p_navegador: navigator.userAgent
            });
        } catch (e) {
            console.warn('[auditoría] No se pudo registrar la acción:', e.message);
        }
    }
};