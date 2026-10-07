// ============================================================================
// Alta del usuario administrador en Supabase Auth.
//
// La anon key NO puede crear usuarios: hace falta la SERVICE ROLE. Pasala por
// variable de entorno, no la escribas en el archivo ni la commitees.
//
//   $env:SUPABASE_SERVICE_ROLE_KEY = "eyJ..."
//   node pruebas/crear-admin.mjs josorioc "TU_CONTRASENA"
//
// Identificador: el login acepta el usuario corto (josorioc) y lo resuelve a
// <usuario>@<NEXT_PUBLIC_AUTH_DOMAIN> (por defecto sistemahipico.local). El
// script crea el alta con ese mismo correo, de modo que coincidan.
//
// Toca SOLO Supabase Auth y la fila del propio usuario en usuario_sistema (para atar su`r`n// auth_id, que es lo que le permite operar bajo RLS). No toca resultados_carreras`r`n// ni ninguna tabla de negocio. Es idempotente: si el usuario ya existe, actualiza`r`n// la clave.
// ============================================================================
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function leerEnv() {
  const salida = {};
  let txt = "";
  try { txt = readFileSync(".env.local", "utf8"); } catch { txt = ""; }
  for (const l of txt.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(l);
    if (m) salida[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return salida;
}

const dotenv = leerEnv();
const URL_ = dotenv.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || dotenv.SUPABASE_SERVICE_ROLE_KEY || "";
const DOMINIO = (process.env.NEXT_PUBLIC_AUTH_DOMAIN || dotenv.NEXT_PUBLIC_AUTH_DOMAIN || "sistemahipico.local")
  .trim()
  .toLowerCase();

const usuario = (process.argv[2] || "").trim().toLowerCase();
const clave = process.argv[3] || "";

if (!URL_) { console.error("Falta NEXT_PUBLIC_SUPABASE_URL (.env.local)"); process.exit(1); }
if (!SERVICE) {
  console.error("Falta SUPABASE_SERVICE_ROLE_KEY. Sin esto no se puede crear usuarios en Auth.");
  console.error("Ejemplo:");
  console.error('  $env:SUPABASE_SERVICE_ROLE_KEY = "eyJ..."');
  console.error("  node pruebas/crear-admin.mjs josorioc \"TU_CONTRASENA\"");
  process.exit(1);
}
if (!usuario || !clave) {
  console.error("Uso: node pruebas/crear-admin.mjs <usuario> <contrasena>");
  process.exit(1);
}
if (clave.length < 8) { console.error("La contraseña debe tener al menos 8 caracteres."); process.exit(1); }

const correo = usuario.includes("@") ? usuario : `${usuario}@${DOMINIO}`;
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };

// ¿Existe ya?
const lista = await fetch(
  `${URL_}/auth/v1/admin/users?per_page=1000`,
  { headers: H }
);
if (!lista.ok) { console.error(`No pude listar usuarios: ${lista.status} ${await lista.text()}`); process.exit(1); }
const existentes = await lista.json();
const previo = (existentes?.users ?? []).find((u) => (u.email ?? "").toLowerCase() === correo);

const cuerpo = {
  email: correo,
  password: clave,
  email_confirm: true,
  user_metadata: { username: usuario, perfil: "Admin" },
};

const r = await fetch(`${URL_}/auth/v1/admin/users${previo ? `/${previo.id}` : ""}`, {
  method: previo ? "PUT" : "POST",
  headers: H,
  body: JSON.stringify(cuerpo),
});

if (!r.ok) {
  console.error(`FALLO al escribir en Auth: ${r.status} ${await r.text()}`);
  process.exit(1);
}

const u = await r.json();
console.log(`${previo ? "ACTUALIZADO" : "CREADO"}  ${correo}`);
console.log(`  id                 ${u.id}`);
console.log(`  confirmado         ${u.email_confirmed_at ? "si" : "no"}`);
console.log(`  perfil (metadata)  ${u.user_metadata?.perfil}`);
console.log(`  ingreso            con "${usuario}" -> ${correo}`);

// ---------------------------------------------------------------------------
// Enlace con el maestro. Sin esto, la fila de `usuario_sistema` sigue sin
// `auth_id` y la RLS no le reconoce: como las policies ahora exigen `auth.uid()`,
// el usuario entraría al login y no vería ni un permiso. Se escribe con la
// service role, que no está sujeta a RLS, así que puede hacerlo aunque todavía
// no haya nadie autorizado.
// ---------------------------------------------------------------------------
const db = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: fila, error: eLectura } = await db
  .from("usuario_sistema")
  .select("id, tipo_usuario_id, es_principal, auth_id")
  .eq("id", usuario)
  .maybeSingle();

if (eLectura) {
  console.error(`\n  No pude leer public.usuario_sistema: ${eLectura.message}`);
  console.error("  Si da 404, aplicá antes src/db/seguridad_maestro.sql y src/db/maestro_seed.sql.");
  process.exit(1);
}

if (!fila) {
  console.error(`\n  La fila "${usuario}" NO existe en public.usuario_sistema.`);
  console.error("  Aplicá src/db/maestro_seed.sql (crea al principal) y volvé a correr este script.");
  process.exit(1);
}

if (fila.auth_id && fila.auth_id !== u.id) {
  console.error(`\n  "${usuario}" ya estaba atado a otro usuario de Auth (${fila.auth_id}).`);
  console.error("  No lo reatrapo solo: podría darle acceso a la cuenta equivocada. Resolvilo a mano.");
  process.exit(1);
}

const { error: eEnlace } = await db.from("usuario_sistema").update({ auth_id: u.id }).eq("id", usuario);
if (eEnlace) {
  console.error(`\n  No pude atar auth_id: ${eEnlace.message}`);
  process.exit(1);
}

console.log(`\n  usuario_sistema    "${usuario}" atado a ${u.id}`);
console.log(`  tipo               ${fila.tipo_usuario_id}${fila.es_principal ? " (principal: acceso total)" : ""}`);
console.log(`\n  Listo. Verificalo con:  node pruebas/auditar-base-maestro.mjs`);
