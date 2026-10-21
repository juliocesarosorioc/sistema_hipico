// ============================================================================
// FASE 1 — Endurecimiento de autenticación, presets de rol y aislamiento
//          del Dueño de Grupo.
//
// Lo que se protege acá:
//   1. Las utilidades de seguridad (sanitización, entropía, rate limit) NO
//      dejan pasar basura ni credenciales vacías truncadas.
//   2. Los presets de rol resuelven a capacidades REALES del maestro (una
//      clave inventada haría un preset que no habilita nada).
//   3. El aislamiento del dueño de grupo existe en las DOS capas: ABAC
//      (reglas `*:mismo_grupo` en abac.ts) y RLS (el seed SQL trae esas
//      reglas y el atributo `usuario_grupos`).
// ============================================================================
import {
  calcularFortalezaClave,
  esPinValido,
  RateLimiterCliente,
  sanitizarEmail,
  sanitizarIdentificador,
  sanitizarTexto,
} from "../src/shared/lib/security";
import { CAPACIDADES, CAPACIDADES_POR_CLAVE } from "../src/features/seguridad/lib/capacidades";
import { PRESETS_ROL, capacidadesDePreset, contarPreset } from "../src/features/seguridad/lib/presets";
import { ATRIBUTOS, REGLAS_ABAC } from "../src/features/seguridad/lib/abac";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let pasan = 0;
let fallan = 0;

function eq(nombre: string, obtenido: unknown, esperado: unknown) {
  const a = JSON.stringify(obtenido);
  const b = JSON.stringify(esperado);
  if (a === b) {
    pasan++;
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}\n        obtenido:  ${a}\n        esperado:  ${b}`);
  }
}

function ok(nombre: string, condicion: boolean) {
  if (condicion) {
    pasan++;
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}`);
  }
}

// ---------------------------------------------------------------------------
// 1) Sanitización
// ---------------------------------------------------------------------------
console.log("-- sanitizar --");
eq("identificador corta a minúsculas y sin símbolos", sanitizarIdentificador("JosOrioc!"), "josorioc");
eq("identificador quita espacios y acentos raros", sanitizarIdentificador("  Admin User "), "adminuser");
eq("identificador vacío devuelve vacío (no \"null\")", sanitizarIdentificador(null), "");
eq("identificador respeta el tope de largo", sanitizarIdentificador("a".repeat(200)).length, 64);

eq("texto quita <script>", sanitizarTexto("<script>alert(1)</script>hola"), "hola");
eq("texto quita javascript:", sanitizarTexto("javascript:alert(1)"), "alert(1)");
eq("texto quita onerror=", sanitizarTexto("img onerror=alert(1)"), "img alert(1)");
eq("texto quita caracteres de control", sanitizarTexto("a\u0000b\u001Fc"), "abc");

eq("email válido pasa", sanitizarEmail("Juan.Perez@Example.COM"), "juan.perez@example.com");
eq("email sin arroba se rechaza", sanitizarEmail("juanperez"), "");
eq("email con espacios se rechaza", sanitizarEmail("juan perez@x.com"), "");
eq("email null devuelve vacío", sanitizarEmail(undefined), "");

// ---------------------------------------------------------------------------
// 2) Entropía / fortaleza
// ---------------------------------------------------------------------------
console.log("-- entropía --");
ok("vacío = muy débil", calcularFortalezaClave("").score === 0);
ok("clave corta y común = débil", calcularFortalezaClave("password").score <= 1);
ok("clave larga con todo = fuerte o más", calcularFortalezaClave("Tr4b4jo#Seguro2026").score >= 3);
ok("fortaleza devuelve sugerencias cuando falta algo", calcularFortalezaClave("abc").suggestions.length > 0);
ok("fortaleza tope 4 nunca se pasa", calcularFortalezaClave("Aa1!Bb2@Cc3#Dd4$Ee5%").score <= 4);

// ---------------------------------------------------------------------------
// 3) PIN
// ---------------------------------------------------------------------------
console.log("-- PIN --");
ok("PIN vacío inválido", !esPinValido("").ok);
ok("PIN de 3 inválido", !esPinValido("123").ok);
ok("PIN alfanumérico de 4 válido", esPinValido("A1b2").ok);
ok("PIN de 9 inválido", !esPinValido("123456789").ok);
ok("PIN con símbolo inválido", !esPinValido("12-34").ok);
ok("PIN con espacio inválido", !esPinValido("12 34").ok);

// ---------------------------------------------------------------------------
// 4) Rate limiter con bloqueo progresivo
// ---------------------------------------------------------------------------
console.log("-- rate limit --");
{
  const rl = new RateLimiterCliente(3, 60_000, 60_000);
  ok("arranca pudiendo intentar", rl.puedeIntentar().ok);
  rl.registrarFallo();
  rl.registrarFallo();
  ok("con 2 fallos de 3 todavía puede", rl.puedeIntentar().ok);
  rl.registrarFallo();
  const bloqueado = rl.puedeIntentar();
  ok("al 3er fallo queda bloqueado", !bloqueado.ok);
  ok("informa segundos restantes", (bloqueado.segundosRestantes ?? 0) > 0);
  rl.registrarExito();
  ok("un login exitoso limpia el bloqueo", rl.puedeIntentar().ok);
}
{
  const rl = new RateLimiterCliente(2, 60_000, 60_000);
  rl.registrarFallo();
  rl.registrarFallo();
  ok("se bloquea exactamente en el tope", !rl.puedeIntentar().ok);
}

// ---------------------------------------------------------------------------
// 5) Presets de rol
// ---------------------------------------------------------------------------
console.log("-- presets --");
ok("hay 5 presets (superadmin, admin, dueño, operador, jugador)", PRESETS_ROL.length === 5);
ok("existe el preset del dueño de grupo", PRESETS_ROL.some((p) => p.id === "dueno_grupo"));
ok("existe el preset del jugador/portal", PRESETS_ROL.some((p) => p.id === "jugador"));

for (const p of PRESETS_ROL) {
  const claves = capacidadesDePreset(p);
  ok(`preset "${p.id}" resuelve a capacidades`, claves.length > 0 || p.id === "jugador");
  ok(`preset "${p.id}" cuenta coherente`, contarPreset(p) === claves.length);
  // Toda clave del preset debe existir en el maestro: una clave inventada
  // sería un preset que promete y no habilita nada.
  const inventadas = claves.filter((k) => !CAPACIDADES_POR_CLAVE.has(k));
  ok(`preset "${p.id}" no tiene claves inventadas`, inventadas.length === 0);
}

// El superadmin debe tener TODAS las capacidades del maestro.
ok(
  "superadmin habilita el maestro completo",
  capacidadesDePreset(PRESETS_ROL.find((p) => p.id === "superadmin")!).length === CAPACIDADES.length
);
// El admin NO debe poder tocar el maestro de seguridad.
{
  const admin = capacidadesDePreset(PRESETS_ROL.find((p) => p.id === "admin")!);
  ok("admin NO tiene la ruta de seguridad", !admin.includes("seguridad:ruta_seguridad"));
  ok("admin SÍ tiene gestión de jugadas", admin.includes("gestion_jugadas:ruta_gestion"));
}
// El jugador solo debe ver el portal.
{
  const jugador = capacidadesDePreset(PRESETS_ROL.find((p) => p.id === "jugador")!);
  ok("jugador solo tiene el portal", jugador.every((k) => k.startsWith("portal:") || k.startsWith("general:")));
  ok("jugador tiene la ruta del portal", jugador.includes("portal:ruta_portal"));
}
// El dueño de grupo no administra el maestro de seguridad.
{
  const dueno = capacidadesDePreset(PRESETS_ROL.find((p) => p.id === "dueno_grupo")!);
  ok("dueño de grupo NO tiene el maestro de seguridad", !dueno.includes("seguridad:fn_editar_matriz"));
  ok("dueño de grupo SÍ gestiona clientes", dueno.includes("clientes:fn_guardar_cliente"));
}

// ---------------------------------------------------------------------------
// 6) Aislamiento del Dueño de Grupo — ABAC + RLS
// ---------------------------------------------------------------------------
console.log("-- aislamiento por grupo --");
ok("el atributo `grupo` existe en abac.ts", ATRIBUTOS.some((a) => a.clave === "grupo"));
ok("el atributo `usuario_grupos` existe en abac.ts", ATRIBUTOS.some((a) => a.clave === "usuario_grupos"));

const reglasGrupo = REGLAS_ABAC.filter((r) => r.id.includes("mismo_grupo"));
ok("hay reglas de aislamiento por grupo", reglasGrupo.length >= 4);
ok(
  "todas las reglas de grupo miran el atributo `grupo`",
  reglasGrupo.every((r) => r.atributo === "grupo")
);
ok(
  "todas las reglas de grupo comparan contra `usuario_grupos`",
  reglasGrupo.every((r) => r.operador === "en_atributo" && r.valor === "usuario_grupos")
);
ok(
  "cubren clientes, grupos y contabilidad",
  ["clientes:fn_guardar_cliente", "grupos:fn_guardar_grupo", "contabilidad:fn_registrar_movimiento"].every(
    (cap) => reglasGrupo.some((r) => r.capacidad === cap)
  )
);
ok(
  "el aislamiento aplica a admin_grupo y banquero",
  ["admin_grupo", "banquero"].every((t) => reglasGrupo.some((r) => r.ambito === `tipo:${t}`))
);

// El seed generado debe traer las reglas (base y código no pueden divergir).
const seed = readFileSync(join(process.cwd(), "src/core/db/maestro_seed.sql"), "utf8");
ok("el seed trae el atributo usuario_grupos", seed.includes("'usuario_grupos'"));
ok("el seed trae la regla clientes:guardar:mismo_grupo", seed.includes("'clientes:guardar:mismo_grupo'"));
ok("el seed trae la regla contabilidad:mismo_grupo", seed.includes("'contabilidad:mismo_grupo'"));
ok("el seed trae el tipo admin_grupo en las reglas", seed.includes("'tipo:admin_grupo'"));
ok("el seed trae el tipo banquero en las reglas", seed.includes("'tipo:banquero'"));

// ---------------------------------------------------------------------------
console.log(`\n${pasan} ok / ${fallan} fallaron`);
if (fallan > 0) process.exit(1);
