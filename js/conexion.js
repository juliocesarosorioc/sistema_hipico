const SUPABASE_URL = 'https://dbkvnqzchtcabhiaqdyi.supabase.co'; 
const SUPABASE_ANON_KEY = 'sb_publishable_hEazSQ2Tp3YLDUoUINIIPw_yuduDLWi';

try {
    if (typeof window.supabase !== 'undefined') {
        window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log("✅ Conexión con Supabase configurada.");
    } else {
        console.error("Error: La librería de Supabase no cargó en el HTML.");
    }
} catch (error) {
    console.error("Error al inicializar Supabase:", error);
}