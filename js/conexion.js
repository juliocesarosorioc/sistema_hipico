// Archivo: js/conexion.js
// Propósito: Inicializar la conexión con Supabase

const SUPABASE_URL = 'https://dbkvnqzchtcabhiaqdyi.supabase.co'; 
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRia3ZucXpjaHRjYWJoaWFxZHlpIipiIjAsImlhdCI6MTc4Zjg3NTE5Niwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzNTkxOTYsImV4cCI6MjEwMzkzNTE5Nn0._ciSMFx_7Ogrt9XAy9YJzJTb2FKYWSwxf_0ryvgU35E';

// Se reasigna el cliente a la variable global evitando colisiones
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