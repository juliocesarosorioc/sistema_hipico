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