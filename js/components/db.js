// Archivo: js/components/db.js
// Propósito: Conexión única y reusable a Supabase.
// Todas las páginas deben cargar: supabase CDN -> db.js -> conexion.js

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

    window.__clubSupabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window.supabase = window.__clubSupabaseClient;
    console.log('Conexión con Supabase configurada exitosamente.');
})();