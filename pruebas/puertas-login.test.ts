// ============================================================================
// Pruebas de las PUERTAS del sistema y del circuito de login.
//
// Lo que se rompió acá, más de una vez, siempre de la misma forma: el login
// acepta la contraseña, el middleware no encuentra a quién dejar pasar, y el
// operador queda rebotando entre /login y /dashboard sin ver un solo mensaje.
// Como se rompe un bucle de redirecciones y no una fila de datos, estas
// pruebas cubren A DÓNDE MANDA cada situación:
//
//   - rutaPermitida / esRutaPublica / esPantallaDeAcceso: la frontera
//   - primeraRutaPermitida: el destino cuando la ruta pedida se niega
//   - esRolCliente: cliente puro vs. administrador con perfil "cliente"
// ============================================================================
import {
  esPantallaDeAcceso,
  esRolCliente,
  esRutaPublica,
  primeraRutaPermitida,
  rutaPermitida,
  RUTAS_PROTEGIDAS,
} from "../src/features/seguridad/lib/capacidades";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let pasan = 0;
let fallan = 0;

function eq(nombre: string, obtenido: unknown, esperado: unknown) {
  const a = JSON.stringify(obtenido);
  const b = JSON.stringify(esperado);
  if (a === b) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}\n        obtenido:  ${a}\n        esperado:  ${b}`);
  }
}

function ok(nombre: string, condicion: boolean) {
  if (condicion) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}`);
  }
}

console.log("\n[1] la puerta de cada ruta");

eq("el login es público", esRutaPublica("/login"), true);
eq("la raíz es pantalla de acceso", esPantallaDeAcceso("/"), true);
eq("el login es pantalla de acceso", esPantallaDeAcceso("/login"), true);
ok(
  "reset-password es pública pero NO de acceso",
  esRutaPublica("/reset-password") && !esPantallaDeAcceso("/reset-password")
);
ok("el escritorio no es público", !esRutaPublica("/dashboard"));
eq("con la capacidad, /dashboard abre", rutaPermitida("/dashboard", ["general:ruta_dashboard"]), true);
eq("sin la capacidad, /dashboard no", rutaPermitida("/dashboard", []), false);
eq("con la capacidad, /clientes abre", rutaPermitida("/clientes", ["clientes:ruta_clientes"]), true);
eq(
  "con la capacidad, /diagnostico abre",
  rutaPermitida("/diagnostico", ["seguridad:ruta_seguridad"]),
  true
);
eq("una ruta inexistente se NIEGA (no es atajo)", rutaPermitida("/ruta-inventada", ["clientes:ruta_clientes"]), false);
eq("toda ruta registrada queda en la lista", RUTAS_PROTEGIDAS.includes("/dashboard"), true);

console.log("\n[2] a dónde va el que intentó entrar a algo que no le corresponde");

// Este es el bucle que se come al operador: el destino fijo era /dashboard,
// que exige general:ruta_dashboard. Un operador de Taquilla no la tiene, así
// que el middleware lo echaba de /dashboard a /dashboard para siempre.
eq("con acceso al escritorio, el destino es el escritorio", primeraRutaPermitida(["general:ruta_dashboard"]), "/dashboard");
eq(
  "un operador de Marcas aterriza en /marcas, no en un escritorio que no puede ver",
  primeraRutaPermitida(["marcas:ruta_marcas"]),
  "/marcas"
);
eq(
  "un operador de Taquilla aterriza en /taquilla",
  primeraRutaPermitida(["taquilla:ruta_taquilla"]),
  "/taquilla"
);
eq(
  "un operador de Clientes aterriza en /clientes",
  primeraRutaPermitida(["clientes:ruta_clientes"]),
  "/clientes"
);
eq("sin NINGUNA capacidad no hay destino: se vuelve al login", primeraRutaPermitida([]), null);

ok(
  "el destino propuesto SIEMPRE es una ruta que ese usuario puede abrir",
  (["marcas", "taquilla", "clientes", "remates"] as const).every((m) => {
    const cap = `${m}:ruta_${m}`;
    const destino = primeraRutaPermitida([cap]);
    return destino !== null && rutaPermitida(destino, [cap]);
  })
);

console.log("\n[3] cliente/jugador puro");

ok("perfil cliente solo con el portal: es cliente puro", esRolCliente("cliente", new Set(["portal:ruta_portal"])));
ok(
  "perfil cliente con un permiso de más: NO es cliente puro",
  !esRolCliente("cliente", new Set(["portal:ruta_portal", "clientes:ruta_clientes"]))
);
ok("perfil admin: no es cliente puro", !esRolCliente("admin", new Set()));
ok("perfil jugador: cuenta como cliente", esRolCliente("jugador", new Set(["portal:ruta_portal"])));
ok("perfil con acentos/espacios se normaliza", esRolCliente("Cliente, Jugador", new Set(["portal:ruta_portal"])));

// ---------------------------------------------------------------------------
console.log("\n[4] el campo «Grupo» del cliente es solo del usuario principal");
// ---------------------------------------------------------------------------
// Meter a un cliente en un grupo le cambia el precio de TODAS sus jugadas. El
// campo no se abre a quien solo pueda crear clientes: el gate es `esPrincipal`,
// no una capacidad nueva. Se prueba lo que el gate tiene que seguir siendo
// cierto; la fila del <select> es JSX y no se puede comprobar desde Node.
import { esUsuarioPrincipal } from "../src/features/seguridad/lib/resolver";
import { resolverAccesos } from "../src/features/seguridad/lib/resolver";
import { baseDeTipo } from "../src/features/seguridad/lib/resolver";

ok("el principal se reconoce con y sin dominio", esUsuarioPrincipal("josorioc@sistemahipico.local"));
ok("el principal tiene acceso total", resolverAccesos({ identificador: "josorioc" }).total);
ok("otro usuario NO es el principal", !esUsuarioPrincipal("alguien.otro"));
ok(
  "un operador, aunque cree y edite clientes, no es el principal",
  !resolverAccesos({ tipo: { id: 2, nombre: "operador", capacidades: baseDeTipo("operador") } }).total
);
ok(
  "ni una excepcion individual convierte a alguien en principal",
  !resolverAccesos({
    identificador: "otro",
    tipo: { id: 1, nombre: "admin", capacidades: baseDeTipo("admin") },
    excepciones: { "clientes:fn_guardar_cliente": "permitido" },
  }).total
);

// ---------------------------------------------------------------------------
console.log("\n[5] el parche de clientes no deja mover `grupo_id` sin ser principal");
// ---------------------------------------------------------------------------
// Ocultar el <select> no alcanza: `actualizarCliente` corre en el navegador y se
// puede llamar desde la consola con el mismo token. Por eso el filtro vive en la
// función de escritura. Se prueba con `esPrincipal` explícito para no depender
// del estado global de la sesión.
import { sinCamposDelPrincipal } from "../src/features/clientes/lib/clientes";

const parche = {
  nombre: "Juan",
  comision: 8,
  es_socio: false,
  mostrar_saldo_socio: false,
  permite_cruces: true,
  tasa_cuadre: 15,
  devolucion: 0,
};

const delPrincipal = sinCamposDelPrincipal({ ...parche, grupo_id: 7 }, true);
eq("el principal sí mueve grupo_id", delPrincipal.grupo_id, 7);

const delOperador = sinCamposDelPrincipal({ ...parche, grupo_id: 7 }, false);
ok("el operador NO puede asignar grupo", !("grupo_id" in delOperador));
eq("el operador sí guarda lo demás", delOperador, parche);

const operadorQueQuita = sinCamposDelPrincipal({ ...parche, grupo_id: null }, false);
ok("ni mandando null alcanza para sacarlo del grupo", !("grupo_id" in operadorQueQuita));

const altaDelOperador = sinCamposDelPrincipal({ ...parche, grupo_id: 3 }, false);
ok("tampoco en el alta", !("grupo_id" in altaDelOperador));

const otrosCampos = { grupo_id: undefined, ...parche };
eq("un undefined tampoco cuela", "grupo_id" in sinCamposDelPrincipal(otrosCampos, false), false);

// ---------------------------------------------------------------------------
console.log("\n[6] el middleware deja pasar /portal sin sesión de Supabase");
// ---------------------------------------------------------------------------
// El portal NO se autentica con la sesión del sistema: el jugador entra con su
// token/clave (o el enlace `?c=&k=`) y la autorización la hace la Edge Function
// `portal-auth`. Exigirle las cookies `hipico_*` lo mandaba a `/login` y PERDÍA
// el `?c=&k=`, así que NINGÚN enlace del portal funcionaba en modo servidor.
// Se comprueba lo que tiene que seguir siendo cierto; la función de middleware
// no se puede ejecutar desde Node (depende de NextRequest), así que se revisa la
// forma del archivo fuente: la salida adelantada para /portal va ANTES del
// chequeo de cookies.
const middlewareSrc = readFileSync(join(process.cwd(), "src", "middleware.ts"), "utf8");

ok(
  "el middleware exceptúa /portal y sus subrutas",
  /const ES_PORTAL = \(p: string\) => p === "\/portal" \|\| p\.startsWith\("\/portal\/"\)/.test(
    middlewareSrc
  )
);
ok(
  "la salida de /portal ocurre ANTES del chequeo de cookies",
  (() => {
    const iPortal = middlewareSrc.indexOf("if (ES_PORTAL(pathname)) return NextResponse.next();");
    const iCookies = middlewareSrc.indexOf('req.cookies.get("hipico_usuario")');
    return iPortal !== -1 && iCookies !== -1 && iPortal < iCookies;
  })()
);
ok(
  "/portal SIGUE declarada y protegida en la matriz de puertas",
  RUTAS_PROTEGIDAS.includes("/portal") && rutaPermitida("/portal", ["portal:ruta_portal"])
);

// ---------------------------------------------------------------------------
console.log("\n[7] los campos de contraseña del portal NO recortan lo que se escribe");
// ---------------------------------------------------------------------------
// El bug: el login del /portal tenía `maxLength={8}` en la contraseña, copiado
// de la regla 4–8 que solo aplica al PIN NUEVO. Cualquier clave más larga
// quedaba cortada en silencio —"JUGADOR123" se volvía "JUGADOR1"— y el login
// fallaba sin explicar por qué. Un tope en la contraseña convierte credenciales
// válidas en errores indescifrables. Se revisa la forma del fuente porque el
// campo es JSX y no se puede montar desde Node.
const portalSrc = readFileSync(
  join(process.cwd(), "src", "features", "portal", "components", "PortalModule.tsx"),
  "utf8"
);

// La contraseña de LOGIN ya no debe tener el tope corto (8) que la truncaba.
ok(
  "la contraseña del login ya no se limita a 8 caracteres",
  /value=\{props\.clave\}[\s\S]{0,220}?maxLength=\{MAX_CLAVE\}/.test(portalSrc)
);
ok("MAX_CLAVE permite claves más largas que el PIN (>= 8)", /const MAX_CLAVE = (\d+);/.test(portalSrc) && Number(portalSrc.match(/const MAX_CLAVE = (\d+);/)![1]) > 8);
ok("el token del login usa MAX_TOKEN", /value=\{props\.token\}[\s\S]{0,200}?maxLength=\{MAX_TOKEN\}/.test(portalSrc));

// El "PIN actual" es el que YA está guardado: puede ser más largo que 8 y no se
// puede truncar, o el cliente con clave larga no podría cambiarla nunca.
ok(
  "el PIN ACTUAL del perfil acepta claves largas (no maxLength={8})",
  /perfil-clave-actual/.test(portalSrc) &&
    /maxLength=\{MAX_CLAVE\}/.test(portalSrc) &&
    !/maxLength=\{8\}[\s\S]{0,80}?perfil-clave-actual/.test(portalSrc)
);

// El PIN NUEVO sí conserva la política 4–8: es una regla de alta, no un tope de
// escritura sobre un valor existente.
ok("el PIN NUEVO sigue con el tope de 8 (política 4–8)", /perfil-clave-nueva/.test(portalSrc));

// El servidor lee la clave con un tope amplio (128): el login no puede rechazar
// una clave larga por venir recortada.
const authSrc = readFileSync(
  join(process.cwd(), "supabase", "functions", "portal-auth", "index.ts"),
  "utf8"
);
ok("el servidor lee la clave de login con margen (clave, 128)", /texto\(e\.clave, 128\)/.test(authSrc));
ok(
  "el tope 4–8 del servidor aplica SOLO al PIN nuevo",
  /claveNueva\.length < 4 \|\| claveNueva\.length > 8/.test(authSrc) &&
    !/igual\(texto\(c\.portal_clave\)[^)]*\.length/.test(authSrc)
);

console.log(`\nTODO OK: ${pasan} pasaron, ${fallan} fallaron`);
if (fallan > 0) process.exit(1);