// Archivo: js/conexion.js
// Propósito: Inicializar la conexión real con el backend de Supabase

const SUPABASE_URL = 'https://dbkvnqzchtcabhiaqdyi.supabase.co'; 
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRia3ZucXpjaHRjYWJoaWFxZHlpIipiIjAsImlhdCI6MTc4Zjg3NTE5Niwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzNTkxOTYsImV4cCI6MjEwMzkzNTE5Nn0._ciSMFx_7Ogrt9XAy9YJzJTb2FKYWSwxf_0ryvgU35E';

// Inicializamos el cliente global sin colisionar
let supabase;

try {
    if (typeof window.supabase === 'undefined') {
        console.error("Error crítico: La librería de Supabase no se ha cargado.");
    } else {
        // Asignamos directamente a la variable global sin usar const o let repetidos
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log("✅ Puente con Supabase inicializado correctamente.");
    }
} catch (error) {
    console.error("Error al inicializar Supabase:", error);
}