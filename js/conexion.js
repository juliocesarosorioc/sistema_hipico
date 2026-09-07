const SUPABASE_URL = 'https://dbkvnqzchtcabhiaqdyi.supabase.co'; 
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRia3ZucXpjaHRjYWJoaWFxZHlpIipiIjAsImlhdCI6MTc4Zjg3NTE5Niwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzNTkxOTYsImV4cCI6MjEwMzkzNTE5Nn0._ciSMFx_7Ogrt9XAy9YJzJTb2FKYWSwxf_0ryvgU35E';

// Se reasigna el cliente a la variable global sin usar "const" o "let"
window.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);