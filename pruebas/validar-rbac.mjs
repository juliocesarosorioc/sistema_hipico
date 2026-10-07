// ============================================================================
// VALIDADOR DE RUTAS, CAPACIDADES Y SQL DE SEGURIDAD
//
// Comprueba que las piezas del MAESTRO no se separen:
//
//   1) src/lib/seguridad/capacidades.ts -> PUERTAS: toda ruta protegida exige
//      una capacidad que existe de verdad en el registro.
//   2) src/app/**/page.tsx              -> toda página real tiene su puerta
//      declarada. Una página sin puerta NO es inaccesible: es ABIERTA.
//   3) src/components/layout/Sidebar.tsx -> el menú no ofrece rutas que no
//      existan ni capacidades inventadas.
//   4) src/db/seguridad_maestro.sql      -> el esquema tiene las 5 tablas del
//      modelo y es idempotente (drop antes de create policy).
//   5) src/db/maestro_seed.sql          -> el seed generado cubre TODAS las
//      capacidades del registro, sin sobras ni faltantes.
//   6) src/db/rbac.sql                   -> el RBAC viejo, si se conserva, tiene
//      que seguir siendo coherente consigo mismo.
//
// Por qué existe: nada de esto cruza en tiempo de compilación. Una capacidad mal
// escrita no da error de TypeScript: `set.has("contabilidad:btn_borrar")` devuelve
// false, el control desaparece y nadie se entera. Y una ruta olvidada en PUERTAS
// no queda cerrada: queda MÁS ABIERTA, porque el middleware nunca la mira.
//
// Uso:
//   node pruebas/validar-rbac.mjs
// ============================================================================
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { cargarRegistro, cargarAbac, RAIZ } from "./cargar-maestro.mjs";

let pasan = 0;
const fallas = [];
const avisos = [];

const ok = (n, d = "") => { pasan++; console.log(`  ok    ${n}${d ? "  " + d : ""}`); };
const falla = (n, d) => { fallas.push(`${n}: ${d}`); console.log(`  FALLA ${n}\n        ${d}`); };
/**
 * El tercer argumento es SIEMPRE la explicación del fallo, nunca un dato que
 * mostrar en verde: pasarlo también al `ok` imprimía "ok la capacidad existe ·
 * no esta en el registro", que se lee como si el error fuera la buena noticia.
 */
const check = (n, cond, porQueFalla = "condicion falsa") =>
  cond ? ok(n) : falla(n, porQueFalla);
const aviso = (n, d) => { avisos.push(`${n}: ${d}`); console.log(`  AVISO ${n}\n        ${d}`); };

const leer = (p) => {
  try {
    return readFileSync(join(RAIZ, p), "utf8");
  } catch {
    return null;
  }
};

/** Ruta relativa al proyecto con "/" hacia adelante, para mensajes estables. */
const rutaRel = (absoluto) => String(absoluto).slice(RAIZ.length + 1).replace(/\\/g, "/");

const leerArchivo = (absoluto) => readFileSync(absoluto, "utf8");

/**
 * El código SIN sus comentarios.
 *
 * Hace falta porque estos archivos explican en prosa por qué una cosa está
 * prohibida, y esa prosa menciona justamente lo prohibido: el encabezado de
 * seguridad_maestro.sql cita el `using (true) with check (true)` viejo, y el
 * doc de pedirRecuperacion() escribe "ese usuario no existe" para explicar por
 * qué nunca se devuelve. Un regex sobre el archivo crudo lee la explicación
 * como si fuera el defecto y falla la suite por su propia documentación.
 */
function sinComentarios(txt) {
  if (txt == null) return "";
  return String(txt)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((l) => l.replace(/\/\/.*$/, "").replace(/--.*$/, ""))
    .join("\n");
}

/** Lista recursiva de archivos con las extensiones dadas. */
function listarArchivos(dir, exts) {
  const salida = [];
  if (!existsSync(dir)) return salida;
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) salida.push(...listarArchivos(p, exts));
    else if (exts.some((e) => d.name.endsWith(e))) salida.push(p);
  }
  return salida;
}

// El registro maestro: fuente única de verdad de rutas y capacidades.
const {
  CAPACIDADES,
  CAPACIDADES_POR_CLAVE,
  PUERTAS,
  RUTAS_PROTEGIDAS,
  capacidadesDeRuta,
  USUARIO_PRINCIPAL,
} = await cargarRegistro();

// =============================================================================
console.log("\n[1] Archivos del maestro");
// =============================================================================
const middleware = leer("src/middleware.ts");
const esquemaSql = leer("src/db/seguridad_maestro.sql");
const esquemaSqlRetirado = leer("src/db/rbac.sql");
const seedSql = leer("src/db/maestro_seed.sql");
const sidebar = leer("src/components/layout/Sidebar.tsx");
const rbac = leer("src/db/rbac.sql");

for (const [n, c] of Object.entries({
  "src/middleware.ts": middleware,
  "src/lib/seguridad/capacidades.ts": CAPACIDADES.length ? "ok" : null,
  "src/db/seguridad_maestro.sql": esquemaSql,
  "src/db/maestro_seed.sql": seedSql,
  "src/components/layout/Sidebar.tsx": sidebar,
  "src/db/rbac.sql": rbac,
})) {
  check(`${n} existe y se pudo leer`, c !== null, c === null ? "no se encontro el archivo" : "");
}
if (fallas.length) {
  console.log(`\nHAY FALLAS: ${pasan} ok, ${fallas.length} fallas\n`);
  process.exit(1);
}

// =============================================================================
console.log("\n[2] Cada puerta exige una capacidad real");
// =============================================================================
check("se leyeron las puertas del registro", PUERTAS.length > 0, "");

const rutasVivas = new Set(RUTAS_PROTEGIDAS);
for (const p of PUERTAS) {
  // Una puerta pública no exige capacidad POR DECLARACIÓN, no por descuido. Se
  // acepta solo si además no pide ninguna: una puerta que dice `publica` y
  // además trae capacidad es contradictoria y podría abrirse de más.
  if (p.publica) {
    check(
      `${p.ruta} es publica y no arrastra ninguna capacidad`,
      !p.capacidad && !(p.algunas?.length ?? 0),
      `declarada publica pero con capacidad "${p.capacidad ?? p.algunas?.join(", ")}": el Matcher y rutaPermitida la abririan para todos`
    );
  } else {
    check(
      `la capacidad "${p.capacidad}" de ${p.ruta} existe`,
      CAPACIDADES_POR_CLAVE.has(p.capacidad),
      `no esta en el registro: capacidadesDeRuta("${p.ruta}") devuelve una clave que nunca se concede y ${p.ruta} queda abierta para todos`
    );
  }
  for (const a of p.algunas ?? []) {
    check(
      `la alternativa "${a}" de ${p.ruta} existe`,
      CAPACIDADES_POR_CLAVE.has(a),
      `no esta en el registro: es letra muerta`
    );
  }
  check(
    `la puerta ${p.ruta} queda en las rutas del matcher`,
    rutasVivas.has(p.ruta),
    `esta en PUERTAS pero no llega al matcher del middleware`
  );
}

// La lista de públicas es corta y cada entrada tiene que justificarse: es la
// única parte del sistema que se abre sin sesión.
{
  const publicas = PUERTAS.filter((p) => p.publica).map((p) => p.ruta).sort();
  // `/reset-password` entra acá porque se abre desde el enlace del correo, o
  // sea sin sesión. No alcanza por sí sola para cambiar nada: la autorización
  // la lleva la sesión de recuperación de Supabase, de un solo uso.
  const esperadas = ["/", "/login", "/reset-password"];
  check(
    "las unicas rutas publicas son la raiz, /login y /reset-password",
    JSON.stringify(publicas) === JSON.stringify(esperadas),
    `publicas: ${publicas.join(", ")} — se espera ${esperadas.join(", ")}`
  );
}

// Coincidencia más larga gana: si no, /contabilidad/caja heredaría la
// capacidad de /contabilidad y abriría de más.
{
  const opciones = CAPACIDADES.filter(
    (c) => c.tipo === "ruta" && c.modulo === "contabilidad"
  ).map((c) => c.clave);
  check(
    "contabilidad declara una capacidad de ruta propia por pantalla",
    opciones.length >= 4,
    `solo hay ${opciones.length}: caja/bancos/monedas se cairian a la de la raíz`
  );
}

// =============================================================================
console.log("\n[3] Toda página real tiene su puerta declarada");
// =============================================================================
// Esto era un AVISO y por ahí se colaron 7 rutas: el menú las listaba, PUERTAS
// no las mencionaba y el middleware nunca corría ahí, así que un Cliente las
// abría por URL directa y la regla 1 no se le aplicaba. Ahora es FALLA.
function paginasReales() {
  const salida = [];
  const recorrer = (dir) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, d.name);
      if (d.isDirectory()) {
        // Los grupos entre paréntesis no aportan segmento de URL: se recorren
        // igual, pero su nombre se descarta al traducir la ruta.
        recorrer(p);
      } else if (d.name === "page.tsx") {
        // Se traduce desde la raíz del proyecto: en Windows `join` deja
        // separadores "\", que no aparecen en las rutas del registro. Y los
        // grupos entre paréntesis se eliminan porque NO aportan segmento de
        // URL: (dashboard)/clientes es /clientes, no /(dashboard)/clientes.
        // Primero se quitan los grupos (con su "/"), y solo después el prefijo
        // `src/app`: si se quitara el prefijo antes, el "/" de más se comería
        // el del grupo y "(dashboard)/clientes" dejaría de reconocerse.
        const rel = p
          .slice(RAIZ.length + 1)
          .replace(/\\/g, "/")
          .replace(/^src\/app/, "")
          .replace(/\/\([^/]+\)/g, "")
          .replace(/\/?page\.tsx$/, "");
        salida.push(rel === "" ? "/" : rel);
      }
    }
  };
  recorrer(join(RAIZ, "src/app"));
  return salida;
}

const PUBLICAS = new Set(["/login"]);
const paginas = paginasReales();
check("se listaron las paginas", paginas.length > 0, `${paginas.length} páginas`);

for (const r of paginas) {
  if (PUBLICAS.has(r)) continue;
  // Una subruta hereda la puerta de su padre más cercano: /contabilidad/caja
  // tiene la suya, pero si se olvidara, la de /contabilidad la cubre.
  const cubierta = [...rutasVivas].some((x) => r === x || r.startsWith(`${x}/`));
  check(
    `la pagina ${r} esta cubierta por una puerta del maestro`,
    cubierta,
    `existe ${r} pero ninguna puerta la exige: se abre por URL directa sin comprobar nada. Declarala en PUERTAS (src/lib/seguridad/capacidades.ts)`
  );
}

for (const r of rutasVivas) {
  if (r === "/") continue;
  const tienePagina = paginas.includes(r) || paginas.some((p) => p.startsWith(`${r}/`));
  check(
    `la puerta ${r} tiene pagina`,
    tienePagina,
    `no existe src/app${r}: el middleware manda a una pantalla que no esta`
  );
}

// =============================================================================
console.log("\n[4] El menú no ofrece rutas sin puerta");
// =============================================================================
const rutasMenu = [...(sidebar ?? "").matchAll(/href:\s*"(\/[a-z0-9-]+)"/g)].map((m) => m[1]);
check("hay rutas en el menu", rutasMenu.length > 0, `${rutasMenu.length} entradas`);

for (const r of rutasMenu) {
  check(
    `la entrada del menu ${r} tiene pagina`,
    paginas.includes(r) || paginas.some((p) => p.startsWith(`${r}/`)),
    `no existe src/app${r}: enlace muerto`
  );
  check(
    `la entrada del menu ${r} tiene capacidad en el registro`,
    capacidadesDeRuta(r).length > 0,
    `el menu no puede deducir la capacidad de ${r}: el enlace se veria sin comprobar acceso`
  );
}

// El menú no debe seguir usando las claves del RBAC viejo: el store ya no las
// concede y esos Guard se quedarían ocultos para todos, incluido el admin.
const clavesViejas = sidebar?.match(/permiso="(administrar_seguridad|gestionar_clientes|ver_clientes|acceso_dashboard)"/g) ?? [];
check(
  "el menu ya no usa claves del RBAC viejo",
  clavesViejas.length === 0,
  clavesViejas.length ? `quedan ${clavesViejas.join(", ")}: el store concede capacidades del maestro y esos Guard ocultarian el enlace para todos` : ""
);

// =============================================================================
console.log("\n[5] El esquema del maestro");
// =============================================================================
for (const tabla of ["capacidad", "tipo_usuario", "tipo_usuario_capacidad", "usuario_sistema", "usuario_capacidad"]) {
  check(
    `seguridad_maestro.sql crea ${tabla}`,
    new RegExp(`create\\s+table\\s+(if\\s+not\\s+exists\\s+)?public\\.${tabla}\\b`, "i").test(esquemaSql ?? ""),
    `falta la tabla ${tabla}: el maestro no tiene donde leer la matriz`
  );
}

{
  // Idempotencia: sin `drop policy if exists`, la segunda corrida aborta con
  // "policy already exists" y se cae el seed entero.
  const creadas = [...(esquemaSql ?? "").matchAll(/create\s+policy\s+("[^"]+"|\S+)\s+on\s+([^\s]+)\s+for\b/g)].map((m) => ({
    nombre: m[1],
    tabla: m[2],
  }));
  check("se leyeron las policies de seguridad_maestro.sql", creadas.length > 0, `${creadas.length} policies`);
      // El `includes` se hace sobre el SQL con espacios colapsados: alinear los
      // `drop policy if exists` en columnas es legible, y comparar con un solo
      // espacio hacía fallar el chequeo por formato y no por seguridad.
      const plano = (esquemaSql ?? "").replace(/\s+/g, " ");
      const sinDrop = creadas.filter((c) => !plano.includes(`drop policy if exists ${c.nombre} on ${c.tabla}`));
      check(
        "seguridad_maestro.sql: cada create policy va precedida de su drop policy if exists",
        sinDrop.length === 0,
        sinDrop.length ? `sin drop: ${sinDrop.map((c) => `${c.nombre} on ${c.tabla}`).join(" | ")}` : "todas cubiertas"
  );
}

// =============================================================================
console.log("\n[6] La UI solo pide capacidades que existen");
// =============================================================================
// Este es el agujero que deja el sistema "todo cerrado" sin que nadie lo note:
// un `permiso="liquidar_carrera"` que ya no existe en el maestro no da error de
// TypeScript ni de React, simplemente NUNCA se cumple y el botón desaparece
// para todo el mundo. Antes de migrar a `modulo:tipo_nombre` quedaban 8 claves
// del catálogo viejo escritas a mano en la interfaz.
{
  const props = /\b(?:permiso|algunaDe)\s*=\s*(?:"([^"]+)"|\{\s*"([^"]+)"\s*\}|\{\s*\[\s*"([^"]+)"\s*\])/g;
  const referidas = [];
  for (const p of listarArchivos(join(RAIZ, "src"), [".ts", ".tsx"])) {
    const txt = leerArchivo(p);
    for (const m of txt.matchAll(props)) {
      const clave = m[1] ?? m[2] ?? m[3];
      if (clave) referidas.push({ clave, archivo: rutaRel(p) });
    }
  }
  const tales = referidas.filter((r) => !r.clave.includes(":"));
  check(
    "toda capacidad pedida por la UI usa la clave del maestro (modulo:tipo_nombre)",
    tales.length === 0,
    tales.length
      ? `${tales.length} con clave vieja: ${[...new Set(tales.map((t) => `${t.clave} (${t.archivo})`))].slice(0, 12).join(", ")}`
      : `${referidas.length} guards, todas con clave del maestro`
  );

  const inexistentes = [...new Set(referidas.filter((r) => !CAPACIDADES_POR_CLAVE.has(r.clave)))];
  check(
    "ningun Guard pide una capacidad que el registro no tiene",
    inexistentes.length === 0,
    inexistentes.length
      ? `el control NUNCA se habilita para nadie: ${inexistentes
          .slice(0, 12)
          .map((r) => `${r.clave} (${r.archivo})`)
          .join(", ")}`
      : `${referidas.length} referencias validas`
  );
}

// =============================================================================
console.log("\n[7] La puerta no regala datos sensibles");
// =============================================================================
{
  // El nombre del usuario principal es el dato más obvio para adivinar por
  // fuerza bruta, y se estaba mostrando como ejemplo en dos formularios. En el
  // login además estaba DENTRO del input, que es el peor lugar: se lee a un
  // metro de distancia y el navegador lo autocompleta.
  //
  // Solo se miran los atributos que la persona ve en pantalla. El valor real
  // del usuario sí aparece en el Topbar una vez dentro: eso es correcto.
  const usuarioPrincipal = USUARIO_PRINCIPAL;
  const vistas = [];
  for (const p of listarArchivos(join(RAIZ, "src"), [".ts", ".tsx"])) {
    const rel = rutaRel(p);
    // Estas rutas lo nombran a propósito, no como texto de pantalla.
    if (rel.startsWith("src/lib/seguridad/") || rel.startsWith("src/db/")) continue;
    const txt = leerArchivo(p);
    for (const m of txt.matchAll(/(placeholder|title|aria-label)\s*=\s*["']([^"']*)["']/g)) {
      if (m[2].includes(usuarioPrincipal)) vistas.push(`${rel} -> ${m[1]}="${m[2]}"`);
    }
  }
  check(
    "ningun campo de la interfaz ofrece el usuario principal como ejemplo",
    vistas.length === 0,
    vistas.length ? vistas.join(" | ") : ""
  );
}

// =============================================================================
console.log("\n[8] No queda un segundo catalogo de permisos en circulacion");
// =============================================================================
{
  // Existía `src/lib/seguridad/permisos.ts` con 11 funciones y su propio
  // catálogo de permisos, en CONFLICTO con el maestro. Nadie lo importaba, pero
  // cualquiera podía hacerlo y saltarse el maestro entero. Se eliminó; esta
  // regla impide que reaparezca.
  const huerfanos = [];
  for (const p of listarArchivos(join(RAIZ, "src"), [".ts", ".tsx"])) {
    const rel = rutaRel(p);
    if (rel === "src/lib/seguridad/permisos.ts") huerfanos.push(`${rel} (el archivo sigue existiendo)`);
  }
  for (const p of listarArchivos(join(RAIZ, "src"), [".ts", ".tsx"])) {
    const rel = rutaRel(p);
    if (rel === "src/lib/seguridad/permisos.ts") continue;
    if (/from\s+["'][^"']*seguridad\/permisos["']/.test(leerArchivo(p))) {
      huerfanos.push(`${rel} importa el catalogo retirado`);
    }
  }
  check(
    "el catalogo de permisos retirado no vuelve a aparecer",
    huerfanos.length === 0,
    huerfanos.join(" | ")
  );

  // Y el legado de SQL tiene que declararse como retirado, para que nadie lo
  // aplique creyendo que configura el acceso de verdad.
  check(
    "rbac.sql se declara retirado y apunta al maestro",
    /ESTE ARCHIVO EST/i.test(esquemaSqlRetirado) && /capacidades\.ts/.test(esquemaSqlRetirado),
    ""
  );
}

// =============================================================================
console.log("\n[12] La RLS del maestro DECIDE, no deja pasar a anon");
// =============================================================================
{
  // Este bloque estuvo como `for all using (true) with check (true)` para anon.
  // Con eso, la llave anon (pública, va en el bundle) podía editar la matriz,
  // ascenderse a principal y desactivar al dueño: la RLS no frenaba nada y
  // todas las guardas de esta sesión eran decorativas frente a la API.
  // Se evalúa el SQL, no la prosa: el encabezado de este archivo QUITA el texto
  // viejo de las policies permisivas para explicar por qué ya no está, y un
  // regex sin filtrar lee ese comentario como si fuera la policy viva.
  const rls = sinComentarios(esquemaSql);

  check(
    "ninguna policy concede acceso a anon",
    !/\bto\s+anon\b/.test(rls) && !/anon\s+todo/i.test(rls),
    "si anon necesita algo, se resuelve con una policy to authenticated, no abriendo anon"
  );
  check(
    "no queda ninguna policy 'para todo, siempre'",
    !/using\s*\(\s*true\s*\)\s*with\s+check\s*\(\s*true\s*\)/.test(rls),
    "using (true) with check (true) deja escribir la matriz a cualquiera"
  );
  check(
    "las cinco tablas del maestro tienen RLS encendido",
    ["capacidad", "tipo_usuario", "tipo_usuario_capacidad", "usuario_sistema", "usuario_capacidad"].every(
      (t) => new RegExp(`alter\\s+table\\s+public\\.${t}\\s+enable\\s+row\\s+level\\s+security`, "i").test(rls)
    ),
    ""
  );
  // La policy de escritura de cada tabla tiene que nombrar la capacidad que el
  // código ya exige, o la base y la UI Gómez diverge.
  for (const [tabla, cap] of [
    ["tipo_usuario", "seguridad:fn_crear_tipo"],
    ["tipo_usuario_capacidad", "seguridad:fn_editar_matriz"],
    ["usuario_capacidad", "seguridad:fn_personalizar_usuario"],
    ["usuario_sistema", "seguridad:fn_asignar_tipo"],
  ]) {
    const bloque = rls.slice(Math.max(0, rls.indexOf(`on public.${tabla}\n  for all`)));
    const hasta = bloque.search(/\ncreate policy|\n-- ---|\Z/);
    const policy = bloque.slice(0, hasta > 0 ? hasta : bloque.length);
    check(
      `escribir ${tabla} exige ${cap} en Postgres`,
      policy.includes(cap),
      "la policy no menciona la capacidad que exige el código"
    );
  }
  // El catálogo no se escribe desde el cliente: es generado y lo siembra el SQL.
  check(
    "el catalogo de capacidades no se escribe desde el cliente",
    !/on public\.capacidad\s*\n\s*for (all|insert|update|delete)/.test(rls),
    "con escritura abierta, cualquiera se inventa una capacidad y se la concede"
  );
  // El enlace con Auth es lo que hace posible todo lo demás.
  check(
    "usuario_sistema tiene la columna auth_id para atar auth.uid()",
    /usuario_sistema\s+add column if not exists auth_id uuid/i.test(rls),
    "sin auth_id ninguna policy puede identificar a quien escribe"
  );
  check(
    "las funciones de decision son security definer con search_path fijo",
    (rls.match(/security definer/g) || []).length >= 2 &&
      (rls.match(/set search_path = public, pg_temp/g) || []).length >= 2,
    "sin esto la policy se cicla o es suceptible al ataque del search_path"
  );
  check(
    "anon no puede ejecutar las funciones de decision",
    /revoke all on function public\.tiene_capacidad\(uuid, text\)\s+from public, anon/i.test(rls),
    "sin el revoke, anon puede preguntar qué tiene y qué no"
  );
  // La escalada de privilegios más obvia: escribirse principal a uno mismo.
  check(
    "no se puede promover a principal sin serlo ya",
    /with check\s*\([\s\S]{0,400}not es_principal or public\.soy_principal\(auth\.uid\(\)\)/.test(rls),
    "si falta, un admin se escribe es_principal y ya no hay frontera"
  );
}

// =============================================================================
console.log("\n[13] La recuperacion de clave no filtra quien tiene cuenta");
// =============================================================================
{
  const sesion = leer("src/lib/auth/sesion.ts");
  const login = leer("src/components/auth/PantallaLogin.tsx");
  const reset = leer("src/app/reset-password/page.tsx");

  check(
    "existe la pagina que consume el token de recuperacion",
    /getSession\(\)/.test(reset) && /updateUser/.test(sesion),
    "sin pagina, el enlace del correo cae en un 404 y el operador queda sin salida"
  );
  // Lo importante: la respuesta no puede depender de si la cuenta existe.
  // Un formulario que dice "ese usuario no existe" es un enumerador de cuentas.
  // El recorte es a propósito: el login ya responde "Usuario o contraseña
  // incorrectos", neutro, y ese mensaje no cuenta para esta regla.
  // El índice se busca SOBRE EL TEXTO YA LIMPIO: quitar comentarios cambia
  // los offsets, así que buscar en el crudo y recortar el limpio cortaba en un
  // punto arbitrario y hacía fallar la regla por una coincidencia de otra parte
  // del archivo.
  const sesionLimpia = sinComentarios(sesion);
  const soloRecovery = sesionLimpia.slice(sesionLimpia.indexOf("pedirRecuperacion"));
  check(
    "el aviso de recuperacion no depende de si el usuario existe",
    /AVISO_RECOVERY/.test(soloRecovery) &&
      !/no (existe|encontrado|está registrado|esta registrado)/i.test(soloRecovery),
    "devolver 'usuario inexistente' permite enumerar quien tiene cuenta"
  );
  // El login tampoco puede confirmar cuentas: dice lo mismo para usuario malo
  // que para contraseña mala.
  check(
    "el login no distingue usuario inexistente de contraseña mala",
    /invalid_credentials[\s\S]{0,200}Usuario o contraseña incorrectos/.test(sesion),
    "si el mensaje nombra cuál de las dos cosas falló, filtra qué usuarios existen"
  );
  check(
    "el rate limit de Supabase tambien se responde de forma neutral",
    /rate\|too many\|429/i.test(sesion) && /AVISO_RECOVERY/.test(sesion.split("429")[1] ?? ""),
    "un 429 solo puede ser 'no existe' o 'demasiados intentos': asi se confirma la cuenta"
  );
  // El token de recuperacion vale una vez y vence; la pagina no puede inventar
  // una sesion propia para cambiar la clave.
  check(
    "cambiar la clave exige la sesion de recuperacion de Supabase",
    /auth\.updateUser\(\{ password/.test(sesion) && !/localStorage/.test(reset),
    "si la pagina se guarda un token, se puede reutilar"
  );
  check(
    "la pagina de reset no guarda ni imprime la clave nueva",
    !/(console\.(log|info|warn)|localStorage|sessionStorage)/.test(reset),
    "una clave escrita a la consola o al storage del navegador es una clave filtrada"
  );
  // Abrir /reset-password a mano tiene que explicar que no alcanza, no fallar en
  // blanco: es lo primero que va a intentar el operador si el enlace venció.
  check(
    "sin enlace valido, la pagina ofrece volver al login",
    /sin_enlace/.test(reset) && /\/login/.test(reset),
    ""
  );
  // La pagina no puede colgar si Supabase no responde.
  check(
    "el cambio de clave tiene limite de tiempo",
    /conTimeout\([\s\S]{0,200}updateUser/.test(sesion),
    "sin conTimeout, la pagina queda en 'Guardando...' para siempre"
  );
}

// =============================================================================
console.log("\n[14] La tabla de contrasenas del legacy queda cerrada y documentada");
// =============================================================================
{
  const retiro = leer("src/db/retirar-legacy-operadores.sql");
  check("existe el script que retira public.operadores", retiro != null, "sin el, la tabla sigue legible con la llave anon");
  if (retiro) {
    check(
      "operadores tiene RLS encendido y sin policy para anon",
      /alter\s+table\s+public\.operadores\s+enable\s+row\s+level\s+security/i.test(retiro) &&
        !/create\s+policy[^;]*\bto\s+anon\b/i.test(retiro) && !/anon\s+todo/i.test(retiro),
      "RLS sin policy para anon es el deny; una policy 'using (false)' no hace falta"
    );
    check(
      "ademas revoca los permisos de anon a nivel de tabla",
      /revoke\s+all\s+on\s+public\.operadores\s+from\s+anon/i.test(retiro),
      "sin el revoke, un GRANT residual deja leerla aunque la policy este bien"
    );
    check(
      "avisa que hay que rotar las contrasenas, no solo cerrar la tabla",
      /rotar|cambiar la clave|rotar las contrasenas/i.test(retiro),
      "bloquear la lectura no deshace que las contrasenas ya esten copiadas"
    );
    // El orden importa: si alguien corre esto pensando que ya seifolds, se
    // queda con la puerta cerrada y las claves viejas vivas.
    check(
      "deja el DROP como decision del dueno, no lo ejecuta solo",
      /drop table if exists public\.operadores/.test(retiro) && !/^\s*drop table/mi.test(retiro),
      "borrar una tabla es decision del dueno, no de un script"
    );
  }
  // La auditoría que lo detecta tiene que existir y no imprimir valores.
  const cred = leer("pruebas/auditar-credenciales.mjs");
  check("existe la auditoria de credenciales expuestas", cred != null, "");
  if (cred) {
    // Lo que hay que impedir es interpolar el VALOR. Imprimir la longitud o
    // una clasificación ("parece hash", "texto plano") no filtra nada, así que
    // la regla busca `${valor}` a secas y tolera `${valor}.length`.
    check(
      "la auditoria de credenciales NO imprime los valores",
      !/console\.(log|info|warn|error)\([\s\S]{0,300}?\$\{\s*valor\s*\}/.test(cred),
      "una auditoría que imprime el valor lo copia al log de CI y al historial"
    );
    check(
      "la auditoria distingue nombres debiles de credenciales reales",
      /CRED_FUERTE/.test(cred) && /CRED_AMBIGUA/.test(cred),
      "con un solo patron, dupletas.clave (clave de apuesta) era falso positivo"
    );
  }
}

// =============================================================================
console.log("\n[15] Las tablas de negocio con PII no quedan abiertas a anon");
// =============================================================================
{
  const rls = sinComentarios(leer("src/db/rls-negocio.sql") ?? "");
  // Se lee una vez y se usa en el bloque de la función: el contrato entre el
  // cliente del portal y la Edge Function son dos archivos distintos, y
  // revisar que hablen el mismo idioma necesita las dos mitades a la vista.
  const portal = sinComentarios(leer("src/lib/portal.ts") ?? "");
  check("existe el archivo de RLS para las tablas de negocio", rls.length > 0, "");
  if (rls) {
    // Se comprobó con la llave anon, sin credenciales: 16 clientes con su
    // portal_token y portal_clave, más cédula, teléfono, correo y saldos.
    const conPII = ["clientes", "tickets_apuestas", "notificaciones", "tickets_jugadas", "solicitudes_tablas"];
    for (const t of conPII) {
      check(
        `${t} tiene RLS encendido y sin policy para anon`,
        new RegExp(`alter\\s+table\\s+public\\.${t}\\s+enable\\s+row\\s+level\\s+security`, "i").test(rls) &&
          !new RegExp(`on\\s+public\\.${t}\\b[^;]*\\bto\\s+anon\\b`, "i").test(rls),
        "RLS sin policy para anon es el deny; con policy, es un select * para cualquiera"
      );
      check(
        `${t} revoca los permisos de anon a nivel de tabla`,
        new RegExp(`revoke\\s+all\\s+on\\s+public\\.${t}\\s+from\\s+anon`, "i").test(rls),
        "sin el revoke, un GRANT residual deja leerla aunque la policy este bien"
      );
    }
    check(
      "el personal entra por authenticated, no por una lista de roles sueltos",
      /to authenticated/.test(rls) && !/to\s+anon\b/.test(rls),
      ""
    );

    // Cada capacidad citada en una policy tiene que existir. Una policy que
    // llama `tiene_capacidad(uid, 'algo:que:no:existe')` NO da error al aplicar
    // el SQL: la funcion devuelve false, nadie pasa nunca, y la tabla queda
    // muda sin que nadie lo note.
    const capEnPolicy = [
      ...new Set([...rls.matchAll(/(?:tiene_capacidad|puede_contexto)\(\s*auth\.uid\(\),\s*'([^']+)'/g)].map((m) => m[1])),
    ];
    const capInexistente = capEnPolicy.filter((c) => !CAPACIDADES_POR_CLAVE.has(c));
    check(
      "toda capacidad que cita una policy existe en el maestro",
      capEnPolicy.length > 0 && capInexistente.length === 0,
      capInexistente.length ? `inexistentes: ${capInexistente.join(", ")}` : `${capEnPolicy.length} capacidades citadas`
    );
    check(
      "ninguna policy escribe con `using (true) with check (true)`",
      !/for all to authenticated\s+using \(true\)\s+with check \(true\)/.test(rls),
      "asi el ABAC no es una frontera: el unico que frena es el guard de la UI"
    );
    check(
      "el ABAC se evalua en la base, no solo en el navegador",
      /puede_contexto\(\s*auth\.uid\(\)/.test(rls),
      "sin puede_contexto en una policy, un INSERT por PostgREST esquiva el ABAC"
    );
    check(
      "la lectura sigue abierta al personal: el ABAC protege escrituras",
      /for select to authenticated using \(true\)/.test(rls),
      "filtrar la lectura por fila exige que cada policy sepa a que tablas unir, y un error ahi es una fuga"
    );
    const tablasConPolicy = [...new Set([...rls.matchAll(/create policy[^;]*on public\.(\w+)/g)].map((m) => m[1]))];
    const sinRevocar = tablasConPolicy.filter((t) => !new RegExp(`revoke all on public\\.${t}\\s+from anon`).test(rls));
    check(
      "toda tabla con policy de escritura tiene revoke para anon",
      sinRevocar.length === 0,
      sinRevocar.length ? `sin revoke: ${sinRevocar.join(", ")}` : `${tablasConPolicy.length} tablas`
    );
    const revokes = [...rls.matchAll(/revoke all on (public\.\w+)/g)].map((m) => m[1]);
    const revokesDup = [...new Set(revokes.filter((r, i) => revokes.indexOf(r) !== i))];
    check(
      "no hay revoke duplicado ni con un typo de mayusculas",
      revokesDup.length === 0,
      revokesDup.length ? `el revoke no matchea la tabla real: ${revokesDup.join(", ")}` : ""
    );
    // `for all` incluye SELECT. Una policy `for all ... using (tiene_capacidad)`
    // deja la LECTURA atada a la capacidad de escribir, y ahi se rompe el caso
    // real: un rol que puede ver la cola de tickets pero no resolverla.
    const forAllConUsing = [...rls.matchAll(/create policy[^;]*for all to authenticated\s*\n?\s*using \(public\./g)];
    check(
      "ninguna policy `for all` ata el SELECT a una capacidad de escritura",
      forAllConUsing.length === 0,
      `separar la lectura: ${forAllConUsing.length} policy(s) con for all + using(public.*)`
    );
    // Y que toda policy de escritura tenga su propio SELECT si la tabla se lee.
    check(
      "las tablas con policy de escritura tienen lectura declarada",
      /for select to authenticated using \(true\)/.test(rls) &&
        /create policy[^;]*for all to authenticated\s*\n?\s*using \(true\)/.test(rls),
      "si no, el UPDATE con `using` cierra tambien el SELECT"
    );
    // El portal no tiene sesión de Auth: si abro una policy para anon, la
    // "protección por fila" es directamente el select * que se quería cerrar.
    check(
      "no se abre el portal con una policy para anon",
        !/\bto\s+anon\b/.test(rls) && !/anon\s+todo/i.test(rls),
      "el portal va por la Edge Function con service_role, no por una policy"
    );
    // Y el código del portal tiene que haber dejado de comparar claves.
    check(
      "el portal ya NO compara portal_clave en el navegador",
      !/portal_clave/.test(portal),
      "comparar la clave en el cliente hace que el select * baje todas las claves"
    );
    check(
      "el portal ya NO hace select * a la tabla de clientes",
      !/\.from\(\s*["']clientes["']\s*\)\s*\.\s*select\(\s*["'`]\*["'`]\s*\)/.test(portal),
      "select * baja portal_token y portal_clave al navegador"
    );
  }
  // La Edge Function es la pieza que reemplaza la comparación en el cliente.
  const fn = leer("supabase/functions/portal-auth/index.ts");
  check("existe la Edge Function que autentica al cliente del portal", fn != null, "");
  if (fn) {
    check(
      "la comparacion de token y clave ocurre en el servidor",
      /function igual\(|igualEnTiempoConstante/.test(fn) &&
        /SUPABASE_SERVICE_ROLE_KEY/.test(fn) &&
        // Y que el portal no compare con === en el cliente (ver abajo).
        /ilike\("seudonimo"/.test(fn),
      "comparar con === filtra cuantos caracteres se acertaron por tiempo"
    );
    check(
      "la funcion NO devuelve portal_clave ni portal_token al cliente",
      /clientePublico/.test(fn) && /portal_clave/.test(fn) && /resto/.test(fn),
      "si vuelve la clave, el select * sigue siendo una fuga con otro nombre"
    );
    check(
      "el fallo es el mismo para usuario inexistente y clave mala",
      /Credenciales inv[aá]lidas o portal deshabilitado/.test(fn),
      "un mensaje distinto segun el caso enumera quien tiene cuenta"
    );
    // El bug de IDOR que había en reclamarJugada: `update ... eq("id")` sin
    // filtrar por cliente dejaba marcar cualquier apuesta del sistema.
    check(
      "marcar un reclamo se ancla al cliente del token, no al id del navegador",
      /\.update\(\{ estado: "EN_REVISION" \}\)[\s\S]{0,200}?\.eq\("cliente_juega_id", cid\)/.test(fn),
      "sin el eq por cliente, un id de otra apuesta marcaba esa apuesta"
    );
    check(
      "toda escritura del portal usa el cliente resuelto, no el que manda el body",
      /cliente_nombre:\s*texto\(cliente\?\.nombre/.test(fn),
      "si el nombre lo manda el navegador, un cliente abre reclamos a nombre de otro"
    );
    check(
      "la subida de imagen no usa URL publica del bucket",
      /createSignedUploadUrl/.test(sinComentarios(fn)) && !/getPublicUrl/.test(sinComentarios(fn)),
      "getPublicUrl deja el comprobante legible por cualquiera que tenga el path"
    );
    check(
      "el login del portal tiene limite de intentos",
      /MAX_INTENTOS/.test(fn),
      "el token del portal es corto: sin tope se prueba a fuerza bruta"
    );
    check(
      "la funcion NO decide el staff leyendo el payload del JWT a mano",
      !/atob\(parte/.test(sinComentarios(fn)) && !/payload\?\.role/.test(sinComentarios(fn)),
      "decodificar el JWT sin verificar la firma es no verificar nada: cualquiera se declara staff"
    );
    check(
      "el staff se valida contra Supabase Auth, no por un claim",
      /auth\.getUser\(jwt\)/.test(sinComentarios(fn)),
      "sin getUser, un JWT forjado con role=authenticated pasa"
    );
    // getUser prueba que el JWT es real, NO que quien lo tiene sea staff. Cualquier
    // cuenta de Auth lo pasa. Sin la segunda comprobacion, un cliente registrado
    // en Supabase Auth entra por la puerta de staff.
    check(
      "un JWT valido no basta para ser staff: se consulta la matriz",
      /\.rpc\(\s*"tiene_capacidad"/.test(sinComentarios(fn)),
      "validar solo el JWT deja entrar a cualquier usuario de Auth como staff"
    );
    // Y la excepcion se acota a la accion que la necesita. Si `esStaff` se calcula
    // para todo, las demas acciones corren con `cid` sin definir.
    check(
      "el salto de staff se limita a `leer-imagen`",
      /accion === "leer-imagen"\s*\?\s*await esStaffAutenticado/.test(sinComentarios(fn)),
      "con esStaff en todas las acciones, `datos` y los reclamos corren con cid undefined"
    );
    check(
      "la firma de imagen no acepta rutas con `..` ni barra inicial",
      /ruta\.includes\("\.\."\)/.test(sinComentarios(fn)) && /ruta\.startsWith\("\/"\)/.test(sinComentarios(fn)),
      "la ruta se concatena con el bucket: sin esto, `../` sale del prefijo del cliente"
    );

    // --- el cliente y la función hablan el mismo idioma --------------------
    // Estos tres checks nacieron de tres bugs reales que compilaron bien y
    // dejaron el portal muerto: faltaba `accion`, el helper devolvía solo
    // `cliente`, y la caché se guardaba tarde. Ninguno lo detectable mirando
    // una pantalla; los tres son contrato entre dos archivos.
    check(
      "el cliente manda `accion` en el login",
      /llamarPortalAuth\(\{\s*accion: "entrar"/.test(portal),
      'sin accion: "entrar", la funcion responde "Falta la accion" y nadie entra'
    );
    check(
      "toda llamada directa a la funcion nombra su accion",
      [...portal.matchAll(/llamarPortalAuth\(\{([\s\S]{0,200}?)\}\)/g)].every((m) =>
        /accion:/.test(m[1]) || /accion\b(?!\s*:)/.test(m[1])
      ),
      "una llamada sin accion no llega a la funcion"
    );
    check(
      "la funcion tiene una rama que rechaza el body sin accion",
      /if \(accion === "entrar"\)[\s\S]{0,120}else if \(!accion\)/.test(fn),
      "sin ese rebote, una llamada sin accion caeria en otra rama por defecto"
    );
    check(
      "el helper devuelve el payload entero, no solo `cliente`",
      /const \{ ok: _ok, error: _error, \.\.\.resto \}/.test(portal),
      "si devuelve r.cliente, las acciones que no son login pierden sus datos"
    );
    check(
      "el helper NO se apoya en `r.cliente` para el resto de acciones",
      !/data:\s*r\.cliente/.test(portal),
      "las acciones datos/subir-imagen no traen cliente y llegarian vacias"
    );
    check(
      "la sesion se guarda en cache ANTES de pedir los datos",
      /localStorage\.setItem\(CACHE_KEY[\s\S]{0,400}construirSesion/.test(portal),
      "si se guarda despues, la primera carga pide datos sin token y sale en cero"
    );
    // Y que la funcion tenga las acciones que el cliente llama. Si el cliente
    // pide una accion que la funcion no conoce, el portal no abre sin error
    // visible.
    const accionesCliente = new Set([...portal.matchAll(/accionPortal(?:<[^>]*>)?\(\s*"([^"]+)"/g)].map((m) => m[1]));
    const accionesDesconocidas = [...accionesCliente].filter((a) => !fn.includes(`"${a}"`) && !fn.includes(`'${a}'`));
    check(
      "toda accion que pide el cliente existe en la funcion",
      accionesCliente.size > 0 && accionesDesconocidas.length === 0,
      accionesDesconocidas.length ? `la funcion no conoce: ${accionesDesconocidas.join(", ")}` : `${accionesCliente.size} acciones`
    );
  }
}

// =============================================================================
console.log("\n[16] El ABAC esta atado al codigo, al SQL y a la seed");
// =============================================================================
{
  const abacSrc = leer("src/lib/seguridad/abac.ts") ?? "";
  const sql = sinComentarios(leer("src/db/seguridad_maestro.sql") ?? "");
  const seed = leer("src/db/maestro_seed.sql") ?? "";
  const vigente = leer("src/lib/seguridad/vigente.ts") ?? "";
  const mod = await cargarAbac();
  const REGLAS = mod.REGLAS_ABAC ?? [];
  const ATRIBUTOS = mod.ATRIBUTOS ?? [];

  check("el modulo ABAC existe y declara reglas", abacSrc.length > 0 && REGLAS.length > 0, "");
  check("el catalogo de atributos existe", ATRIBUTOS.length > 0, "");

  // --- coherencia interna ------------------------------------------------
  const colgadas = REGLAS.filter(
    (r) => !mod.CAPACIDADES_POR_CLAVE?.has?.(r.capacidad) && !CAPACIDADES_POR_CLAVE.has(r.capacidad)
  );
  check(
    "toda regla apunta a una capacidad del maestro",
    colgadas.length === 0,
    colgadas.length ? `colgadas: ${colgadas.map((r) => r.id).join(", ")}` : ""
  );
  const catClaves = new Set(ATRIBUTOS.map((a) => a.clave));
  const sinAtr = REGLAS.filter((r) => !catClaves.has(r.atributo));
  check("toda regla apunta a un atributo del catálogo", sinAtr.length === 0, sinAtr.map((r) => r.id).join(", "));
  const enAtrRoto = REGLAS.filter((r) => r.operador === "en_atributo" && !catClaves.has(String(r.valor)));
  check(
    "en_atributo apunta a un atributo existente",
    enAtrRoto.length === 0,
    enAtrRoto.map((r) => `${r.id} -> ${r.valor}`).join(", ")
  );
  const incoherent = REGLAS.filter(
    (r) => (r.clase === "integridad" && r.principal === "exento") || (r.clase === "limite" && r.principal === "sujeto")
  );
  check(
    "clase y principal son coherentes (integridad=no se levanta, limite=se levanta)",
    incoherent.length === 0,
    incoherent.map((r) => r.id).join(", ")
  );

  // --- la base tiene que saber lo mismo ----------------------------------
  for (const t of ["atributo", "regla_abac", "usuario_atributo"]) {
    check(`el esquema declara public.${t}`, new RegExp(`create table if not exists public\\.${t}\\b`, "i").test(sql), "");
    check(`public.${t} tiene RLS`, new RegExp(`alter table public\\.${t}\\s+enable row level security`, "i").test(sql), "");
  }
  check(
    "el evaluador del ABAC existe en la base",
    /create or replace function public\.evaluar_abac\(u uuid, clave text, ctx jsonb\)/.test(sql) &&
      /create or replace function public\.puede_contexto\(u uuid, clave text, ctx jsonb\)/.test(sql),
    "sin esto, la policy y la UI dan respuestas distintas al mismo usuario"
  );
  check(
    "el evaluador filtra por ambito de tipo",
    /ra\.ambito = 'tipo:' \|\| tipo/.test(sql),
    "sin el filtro de ambito, la regla de hipodromo propio le pegaria al admin"
  );
  check(
    "el conjunto de en_atributo se resuelve del USUARIO, no del registro",
    /atributo_del_contexto\(f\.id, '\{\}'::jsonb, conjunto\)/.test(sql),
    "si el registro eligiera el conjunto permitido, la regla no diria nada"
  );
  // El cierre por omisión, del lado de Postgres.
  check(
    "en la base, un atributo ausente tambien bloquea",
    /if valor is null or valor = 'null'::jsonb then\s*\n?\s*return false;/.test(sql),
    "un null tiene que denegar, no pasar como cero"
  );
  check(
    "un operador desconocido deniega en la base",
    /default:\s*\n?\s*return false;|return false;\s*\n?\s*end if;/.test(sql),
    ""
  );
  check(
    "las funciones del ABAC no se le dan a anon",
    /revoke all on function public\.puede_contexto\(uuid, text, jsonb\) from public, anon;/.test(sql),
    ""
  );
  // `regla_abac` se LEE (el maestro tiene que poder explicar por qué un botón
  // se apaga) pero NO se escribe desde el cliente. Solo se comprueban las
  // policies de escritura: la de lectura sí tiene que existir.
  const escrituraRegla = /create policy[^;]*on public\.regla_abac[^;]*\bfor\s+(all|insert|update|delete)\b/i;
  check(
    "regla_abac NO se puede escribir desde el cliente (si se pudiera, cualquiera se agrega la regla que le falte)",
    /drop policy if exists "escribe reglas quien administra" on public\.regla_abac;/.test(sql) && !escrituraRegla.test(sql),
    escrituraRegla.test(sql) ? "hay una policy de escritura sobre regla_abac" : ""
  );
  check(
    "regla_abac SI se puede leer: el maestro tiene que explicar los bloqueos",
    /create policy[^;]*on public\.regla_abac[^;]*\bfor select\b/i.test(sql),
    "sin lectura, el operador ve el botón apagado sin explicación"
  );
  check(
    "atributo tampoco se escribe desde el cliente",
    !/create policy[^;]*on public\.atributo[^;]*\bfor\s+(all|insert|update|delete)\b/i.test(sql),
    "el catalogo lo genera el seed"
  );

  // --- la seed trae todo -----------------------------------------------
  const sinSeedAtr = ATRIBUTOS.filter((a) => !seed.includes(`'${a.clave}'`));
  check("la seed siembra todos los atributos", sinSeedAtr.length === 0, sinSeedAtr.map((a) => a.clave).join(", "));
  const sinSeedReg = REGLAS.filter((r) => !seed.includes(`'${r.id}'`));
  check("la seed siembra todas las reglas", sinSeedReg.length === 0, sinSeedReg.map((r) => r.id).join(", "));
  check("la seed lleva la clase de la regla", /clase, principal_exento, riesgo, fuente/.test(seed), "");
  check(
    "la seed retira reglas que el codigo ya no declara",
    /delete from public\.regla_abac r/.test(seed),
    "una regla borrada del codigo seguiria viva en la base"
  );

  // --- las dos puertas --------------------------------------------------
  check(
    "exigirCapacidad (solo permiso) y exigirPermiso (permiso + atributos) conviven",
    /export function exigirCapacidad/.test(vigente) && /export function exigirPermiso/.test(vigente),
    "sin las dos, o no hay ABAC o no hay permiso"
  );
  check(
    "la puerta con contexto ordena permiso PRIMERO que atributo",
    /if \(!tieneCapacidad\(capacidad\)\) throw new ErrorPermiso\(capacidad\);\s*\n\s*exigirContexto/.test(vigente),
    "invertido, el mensaje insinua que el problema es el registro cuando es la sesion"
  );
  check(
    "los atributos del usuario se mezclan por DEBAJO del contexto",
    /\{\s*\.\.\.atributos, \.\.\.contexto\s*\}/.test(vigente),
    "al reves, el contexto podria ampliar los permisos del usuario"
  );
  check(
    "sin sesion, la puerta con contexto no pasa",
    /export function puedeConContexto[\s\S]{0,200}if \(!tieneCapacidad\(capacidad\)\) return false;/.test(vigente),
    ""
  );

  // --- y que la regla siga hablando del dominio real --------------------
  // El atributo `metodo_pago` se compara contra una lista escrita a mano. Si
  // contabilidad.ts agrega una modalidad y la lista no la sigue, la operacion
  // legitima se rechaza como "metodo no reconocido", y el error aparece en
  // produccion, en un cobro.
  const conta = leer("src/lib/contabilidad.ts") ?? "";
  // Se comparan con la MISMA normalizacion que usa el motor, tildes
  // incluidas. Si el check se normalizara distinto que `norm()`, pasaria una
  // regla que en produccion bloquea el cobro.
  const norm = (s) =>
    String(s)
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const catalogo = [...conta.matchAll(/export const MODALIDADES_(?:INGRESO|EGRESO) = \[([^\]]*)\]/g)]
    .flatMap((m) => m[1].split(","))
    .map((s) => norm(s.trim().replace(/^"|"$/g, "")))
    .filter(Boolean);
  const metodos = new Set((mod.METODOS_PAGO ?? []).map((s) => norm(s)));
  const sinReconocer = catalogo.filter((m) => !metodos.has(m));
  check(
    "toda modalidad de la UI es reconocida por la regla metodo_pago",
    catalogo.length > 0 && sinReconocer.length === 0,
    sinReconocer.length ? `la UI ofrece ${[...new Set(sinReconocer)].join(", ")} y la regla no lo acepta` : ""
  );
  const sinUso = [...metodos].filter((m) => !catalogo.includes(m));
  check(
    "la regla metodo_pago no acepta modalidades que la UI no ofrece",
    sinUso.length === 0,
    sinUso.length ? `sobran en la regla: ${sinUso.join(", ")}` : ""
  );
  // Y que Postgres normalice igual que el motor: si la base perdona el acento y
  // el cliente no (o al reves), la UI y la base dan veredictos distintos.
  check(
    "Postgres normaliza los tildes igual que el motor",
    /create or replace function public\.norma_abac\(txt text\)/.test(sql) &&
      /rel := public\.norma_abac\(valor #>> '\{\}'\)/.test(sql) &&
      /array_agg\(public\.norma_abac\(x #>> '\{\}'\)\)/.test(sql),
    "sin norma_abac, 'PAGO MOVIL' con tilde pasa en un lado y se rechaza en el otro"
  );
  check(
    "norma_abac no se le deja ejecutar a anon",
    /revoke all on function public\.norma_abac\(text\) from public, anon;/.test(sql),
    ""
  );
  // translate() exige que las dos cadenas midan lo mismo. Con 24 tildes y 23
  // letras, Postgres no da error: corta en la mas corta y deja sin quitar la
  // ultima tilde. El accent-stripping parcial es un fallo silencioso.
  // `[^)]+` y no `[^,]+`: el primer argumento es un `lower(btrim(coalesce(...)))`
  // que ya trae comas adentro, y con `[^,]+` la regex no matchea nunca.
  const tr = sql.match(/translate\([\s\S]*?'([^']*)'\s*,\s*'([^']*)'\s*\)/);
  check(
    "las dos cadenas de translate() miden lo mismo",
    !!tr && [...tr[1]].length === [...tr[2]].length,
    tr ? `desde=${[...tr[1]].length} hacia=${[...tr[2]].length}` : "no se encontro el translate"
  );
  check(
    "no hay bytes rotos (U+FFFD) en el SQL del maestro",
    !/\uFFFD/.test(sql),
    "un caracter roto deja la sentencia sin sentido o, peor, con un string vacio"
  );
  // El nombre del atributo tiene que existir en el catalogo de atributos, y el
  // de la regla en_atributo tambien.
  const conAtributo = REGLAS.filter((r) => !catClaves.has(r.atributo));
  check("el atributo de cada regla existe en el catalogo", conAtributo.length === 0, conAtributo.map((r) => r.id).join(", "));

  // --- el ABAC esta aplicado a algo real, no es decorativo ---------------
  const conContexto = [];
  for (const p of listarArchivos(join(RAIZ, "src"), [".ts", ".tsx"])) {
    if (leerArchivo(p).includes("exigirPermiso(")) conContexto.push(p.replace(/\\/g, "/").split("/src/")[1]);
  }
  check(
    "el ABAC esta aplicado a alguna escritura real, no es decorativo",
    conContexto.length > 0,
    `ningun archivo llama exigirPermiso: ${conContexto.length}`
  );

  // Y que las capacidades con reglas tengan DE VERDAD la puerta con contexto
  // en el archivo que dice la regla. Si la regla dice tickets.ts y ahí solo
  // hay exigirCapacidad, el ABAC no se está evaluando.
  const criticas = REGLAS.filter((r) => r.riesgo === "critico");
  const declaradas = [];
  for (const r of criticas) {
    const archivo = String(r.fuente).split(":")[0];
    const existe = listarArchivos(join(RAIZ, "src"), [".ts", ".tsx"]).some((p) => p.endsWith(archivo.replace(/\\/g, "/")));
    if (existe) declaradas.push(r);
  }
  const sinPuerta = declaradas.filter((r) => {
    const archivo = String(r.fuente).split(":")[0];
    const txt = sinComentarios(
      leerArchivo(listarArchivos(join(RAIZ, "src"), [".ts", ".tsx"]).find((p) => p.endsWith(archivo)) ?? "")
    );
    return !txt.includes("exigirPermiso(");
  });
  check(
    "los archivos con reglas criticas tienen la puerta con contexto",
    sinPuerta.length === 0,
    sinPuerta.length
      ? `${sinPuerta.length} archivo(s) declaran reglas pero usan exigirCapacidad (el ABAC no corre): ${[...new Set(sinPuerta.map((r) => r.fuente.split(":")[0]))].join(", ")}`
      : `${declaradas.length} archivo(s) verificados`
  );
}

// =============================================================================
console.log("\n[9] Toda capacidad de escritura se aplica en el código");
// =============================================================================
// Un `fn_*` declarado y nunca invocado es una capacidad decorativa: el maestro
// dice que existe un control que en realidad no está protegido. Con la llave anon
// y la RLS permisiva, eso significa que la operación se puede ejecutar desde la
// consola del navegador sin ningún control de acceso real.
{
  // El portal es la excepción consciente: el cliente entra con su propio
  // token/clave, no con la sesión de Supabase del personal, así que NO puede
  // pasar por `exigirCapacidad` (que se apoyaría en una sesión vacía). Su
  // frontera es el token, y tiene que reforzarse en la base.
  const EXENTAS = new Set(["portal:fn_operar_portal"]);

  const aplicadas = new Set();
  // Las dos puertas valen: `exigirCapacidad` (solo permiso) y `exigirPermiso`
  // (permiso + atributos del registro, que es la puerta del ABAC). Una
  // capacidad protegida por atributos igual está protegida.
  for (const p of listarArchivos(join(RAIZ, "src"), [".ts", ".tsx"])) {
    const txt = leerArchivo(p);
    for (const m of txt.matchAll(/exigirCapacidad\(\s*"([^"]+)"/g)) aplicadas.add(m[1]);
    for (const m of txt.matchAll(/exigirPermiso\(\s*"([^"]+)"/g)) aplicadas.add(m[1]);
  }
  const declaradas = CAPACIDADES.filter((c) => c.clave.includes(":fn_"));
  const sinAplicar = declaradas.filter((c) => !aplicadas.has(c.clave) && !EXENTAS.has(c.clave));
  check(
    "toda capacidad fn_* se invoca con exigirCapacidad() o exigirPermiso() en su archivo",
    sinAplicar.length === 0,
    sinAplicar.length
      ? `decorativas (nadie las comprueba): ${sinAplicar.map((c) => c.clave).join(", ")}`
      : `${declaradas.length} declaradas, ${aplicadas.size} aplicadas, ${EXENTAS.size} exenta(s)`
  );

  // Y al revés: no se puede exigir una capacidad que el maestro no conoce.
  const fantasma = [...aplicadas].filter((c) => !CAPACIDADES_POR_CLAVE.has(c));
  check(
    "exigirCapacidad() solo nombra capacidades del registro",
    fantasma.length === 0,
    fantasma.length ? `sin declarar: ${fantasma.join(", ")}` : ""
  );
}

// =============================================================================
console.log("\n[10] El seed cubre exactamente el registro");
// =============================================================================
// El generador escribe una línea por capacidad:
//   insert into public.capacidad (clave, ...) values ('<clave>', ...);
const enSeed = [
  ...(seedSql ?? "").matchAll(/^insert into public\.capacidad\s*\(.*?\)\s*values\s*\(\s*'([^']+)'/gm),
].map((m) => m[1]);
check("se leyeron las capacidades del seed", enSeed.length > 0, `${enSeed.length} capacidades`);

const faltantes = CAPACIDADES.filter((c) => !enSeed.includes(c.clave));
check(
  "el seed siembra TODAS las capacidades del registro",
  faltantes.length === 0,
  faltantes.length ? `faltan ${faltantes.length}: ${faltantes.map((c) => c.clave).join(", ")}` : `${enSeed.length} capacidades`
);

const sobrantes = enSeed.filter((k) => !CAPACIDADES_POR_CLAVE.has(k));
check(
  "el seed no siembra capacidades que no existen en el registro",
  sobrantes.length === 0,
  sobrantes.length ? `sobran: ${sobrantes.join(", ")}` : ""
);

{
  // El seed se genera con `on conflict`, así que reaplicarlo no debe romper.
  const sinOnConflict = [...(seedSql ?? "").matchAll(/insert into public\.\w+ \([^)]*\)\s*\n?\s*values[^;]*;/g)].filter(
    (m) => !/on conflict/i.test(m[0])
  );
  check(
    "el seed es idempotente (todas las inserciones traen on conflict)",
    sinOnConflict.length === 0,
    sinOnConflict.length ? `${sinOnConflict.length} inserciones sin on conflict: la segunda aplicacion aborta` : ""
  );
}

check(
  "el seed borra las capacidades que el maestro ya no declara",
  /delete from public\.capacidad/i.test(seedSql ?? ""),
  "sin el delete, una capacidad retirada del codigo sigue viva en la base y el sidebar la sigue authorizing"
);

check(
  "el seed da de alta al usuario principal",
  /'josorioc'/.test(seedSql ?? ""),
  "sin la fila de josorioc el sistema no tiene dueño y nadie entra con acceso total"
);

// =============================================================================
console.log("\n[11] El RBAC viejo (rbac.sql) sigue coherente consigo mismo");
// =============================================================================
{
  const sembrados = [...(rbac ?? "").matchAll(/\(\s*(\d+)\s*,\s*'([a-z_]+)'\s*,/g)].map((m) => ({ id: Number(m[1]), clave: m[2] }));
  check("se leyeron los permisos del seed de rbac.sql", sembrados.length > 0, `${sembrados.length} filas`);
  const ids = sembrados.map((s) => s.id);
  check(
    "rbac.sql no repite ids de permiso",
    new Set(ids).size === ids.length,
    "el front elige el perfil por id: un id repetido reparte permisos al perfil equivocado"
  );
  const creadas = [...(rbac ?? "").matchAll(/create\s+policy\s+("[^"]+"|\S+)\s+on\s+([^\s]+)\s+for\b/g)].map((m) => ({
    nombre: m[1],
    tabla: m[2],
  }));
      const planoRbac = (rbac ?? "").replace(/\s+/g, " ");
      const sinDrop = creadas.filter((c) => !planoRbac.includes(`drop policy if exists ${c.nombre} on ${c.tabla}`));
      check(
        "rbac.sql: cada create policy va precedida de su drop policy if exists",
        sinDrop.length === 0,
        sinDrop.length ? `sin drop: ${sinDrop.map((c) => `${c.nombre} on ${c.tabla}`).join(" | ")}` : "todas cubiertas"
  );
}

// =============================================================================
// Encoding. Escribir estos archivos desde PowerShell dejó caracteres rotos
// (U+FFFD) y, dos veces, texto en chino donde iba un comentario en español. No
// rompe la ejecución, pero esconde diferencias entre lo que dice el código y lo
// que dice el archivo, y un `with check` corrompido no se lee en la revisión.
{
  const tocados = [
    "src/db/rls-negocio.sql",
    "src/db/seguridad_maestro.sql",
    "src/db/maestro_seed.sql",
    "src/lib/hipodromos/servicio.ts",
    "src/lib/seguridad/abac.ts",
    "src/lib/contabilidad.ts",
    "src/lib/portal.ts",
    "src/lib/tickets.ts",
    "src/lib/carreras/retiros.ts",
    "src/lib/liquidacion/pagarYCerrar.ts",
    "supabase/functions/portal-auth/index.ts",
    "src/components/seguridad/SeguridadModule.tsx",
    "pruebas/maestro-seguridad.test.mjs",
    "pruebas/auditar-base-maestro.mjs",
    "pruebas/generar-seed-maestro.mjs",
  ];
  const sucios = [];
  // El mojibake se busca con DIGRAFOS, nunca con una letra suelta: `â` es un
  // carácter legítimo en `norma_abac` (`translate` con acentos) y marcarlo
  // daría ruido. Este archivo se excluye: para describir el patrón tiene que
  // escribirlo, y se detectaría a sí mismo.
  const firmas = /\u00C3[\u0080-\u00BF\u00A0-\u024F]|\u00E2\u20AC|\u00C2[\u0080-\u00BF\u00A0-\u00FF]|\u00C3\u0192/g;
  for (const a of tocados) {
    if (a.endsWith("validar-rbac.mjs")) continue;
    const t = leer(a);
    const marcas = [
      [/\uFFFD/g, "U+FFFD"],
      [/\u4E00-\u9FFF\u3000-\u303F/g, "caracteres CJK"],
      [firmas, "mojibake"],
    ].filter(([re]) => re.test(t));
    if (marcas.length) sucios.push(`${a} (${marcas.map(([, n]) => n).join(", ")})`);
  }
  check(
    "los archivos de seguridad no tienen encoding roto",
    sucios.length === 0,
    sucios.length ? sucios.join(" | ") : `${tocados.length} archivos limpios`
  );
}

// =============================================================================
console.log(`\n${fallas.length === 0 ? "TODO OK" : "HAY FALLAS"}: ${pasan} ok, ${fallas.length} fallas`);
if (avisos.length) console.log(`Avisos: ${avisos.length}`);
if (fallas.length) {
  console.log("\nFallas:");
  for (const f of fallas) console.log("  - " + f);
}
console.log("");
process.exit(fallas.length ? 1 : 0);
