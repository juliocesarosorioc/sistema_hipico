// ============================================================================
// Coherencia del MÓDULO MAESTRO de seguridad.
//
// Corre en modo SOLO LECTURA contra el código: no toca la base. Verifica que
// el registro de capacidades, la resolución de accesos y las puertas de entrada
// estén de acuerdo entre sí, y que el usuario principal no pueda quedar fuera.
// ============================================================================

let pasan = 0;
let fallan = 0;
const ok = (m) => { pasan++; console.log(`  ok    ${m}`); };
const mal = (m, d) => { fallan++; console.log(`  FALLA ${m}${d ? `\n          ${d}` : ""}`); };

// El registro es TypeScript: `cargar-maestro.mjs` lo compila con el
// compilador del proyecto a un temporal y lo importa desde ahí, igual que
// hacer el seed. Se comparte con validar-rbac.mjs para que los dos validadores
// miren exactamente el mismo registro.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cargarRegistro, RAIZ } from "./cargar-maestro.mjs";

const {
  CAPACIDADES,
  CAPACIDADES_POR_CLAVE,
  MODULOS_ESQUEMA,
  PUERTAS,
  RUTAS_PROTEGIDAS,
  capacidadesDeRuta,

  rutaPermitida,
  baseDeTipo,
  buscarCapacidades,
  esUsuarioPrincipal,
  expandirConRequisitos,
  resolverAccesos,
  USUARIO_PRINCIPAL,
  // La puerta de escritura del data layer, probada en ejecucion.
  ErrorPermiso,
  exigirCapacidad,
    limpiarAccesosVigentes,
    setAccesosVigentes,
    tieneCapacidad,
    usuarioVigente,
    // ABAC: atributos, reglas y las dos puertas (con y sin contexto).
    ATRIBUTOS,
    ATRIBUTOS_POR_CLAVE,
    REGLAS_ABAC,
    ErrorAtributo,
    exigirContexto,
    evaluarAbac,
    permiteConContexto,
    reglasDeCapacidad,
    puedeConContexto,
    exigirPermiso,
  } = await cargarRegistro();

console.log(`\n== Módulo maestro · ${CAPACIDADES.length} capacidades en ${MODULOS_ESQUEMA.length} módulos`);

// ------------------------------------------------------------ integridad ---
console.log("\n-- Integridad del registro");
const duplicadas = CAPACIDADES.map((c) => c.clave).filter((k, i, a) => a.indexOf(k) !== i);
if (!duplicadas.length) ok("ninguna clave de capacidad repetida");
else mal(`hay ${duplicadas.length} claves repetidas`, [...new Set(duplicadas)].join(", "));

const sinModulo = CAPACIDADES.filter((c) => !MODULOS_ESQUEMA.some((m) => m.clave === c.modulo));
if (!sinModulo.length) ok("toda capacidad pertenece a un módulo del esquema");
else mal(`${sinModulo.length} capacidades con módulo inexistente`, sinModulo.map((c) => c.clave).join(", "));

// Trazabilidad: cada capacidad tiene que apuntar a un archivo REAL del proyecto.
// Se comprueba contra el disco y no contra `git ls-files`: los módulos nuevos
// (marcas, dupleta, carga de resultados) todavía no están versionados y no
// deben dar una falsa alarma.
// Si además trae línea, se verifica que la línea exista de verdad.
const existe = (p) => existsSync(join(RAIZ, p));

const sinFuente = CAPACIDADES.filter((c) => !c.fuente || !c.fuente.includes("/"));
if (!sinFuente.length) ok("toda capacidad tiene trazabilidad al código (archivo[:línea])");
else mal(`${sinFuente.length} capacidades sin archivo en la fuente`, sinFuente.map((c) => c.clave).join(", "));

const fuenteInvalida = CAPACIDADES.filter((c) => {
  const archivo = String(c.fuente ?? "").replace(/:\d+$/, "");
  return archivo && !existe(archivo);
});
if (!fuenteInvalida.length) ok("todas las fuentes existen de verdad en el proyecto");
else mal(`${fuenteInvalida.length} fuentes apuntan a archivos inexistentes`, fuenteInvalida.map((c) => `${c.clave} -> ${c.fuente}`).join(", "));

// Si la fuente trae línea, tiene que ser una línea real del archivo.
const lineaFuera = [];
for (const c of CAPACIDADES) {
  const partes = String(c.fuente ?? "").split(":");
  if (partes.length < 2) continue;
  const archivo = partes.slice(0, -1).join(":");
  const linea = Number(partes[partes.length - 1]);
  if (!existe(archivo) || !Number.isInteger(linea)) continue;
  const total = readFileSync(join(RAIZ, archivo), "utf8").split("\n").length;
  if (linea < 1 || linea > total) lineaFuera.push(`${c.clave} -> ${c.fuente} (el archivo tiene ${total})`);
}

// ---- ABAC: editar hipodromos, y el id que no es de uno ---------------------
// El guard de "guardar hipodromo" compara contra la lista de hipodromos del
// operador, que guarda NOMBRES. Un id no dice nada: si el update valida solo el
// nombre del patch, el operador manda su propio nombre con el id de otro y
// escribe sobre la fila ajena. Estos checks fijan los DOS lados de la operacion:
// el nombre que tiene la fila y el nombre que queda.
{
  const CAP = "hipodromos:fn_guardar_hipodromo";
  limpiarAccesosVigentes();
  setAccesosVigentes({
    permisos: [CAP],
    esPrincipal: false,
    usuario: "op",
    tipoUsuario: "operador",
    atributos: { usuario_hipodromos: ["LA TRINIDAD"] },
  });

  // Editar su hipodromo sin cambiar el nombre: solo pais/estado.
  if (puedeConContexto(CAP, { hipodromo: "LA TRINIDAD" })) ok("el operador edita su hipodromo sin renombrarlo");
  else mal("el operador no puede editar su propio hipodromo sin cambiar el nombre");

  // El caso del agujero: nombre propio (pasa) + id ajeno (escribe).
  const actualAjeno = "LA GRITA";
  if (!puedeConContexto(CAP, { hipodromo: actualAjeno })) {
    ok("el nombre que TIENE la fila se valida, no solo el del patch");
  } else {
    mal("validar solo el nombre del patch deja editar el hipodromo de otro por id");
  }

  // Renombrar a un nombre propio debe valer, porque la fila es suya.
  if (puedeConContexto(CAP, { hipodromo: "LA TRINIDAD" })) ok("el operador renombra su hipodromo a un nombre propio");
  else mal("el operador no puede renombrar su hipodromo a un nombre propio");

  // El principal no esta sujeto a la regla del hipodromo propio.
  limpiarAccesosVigentes();
  setAccesosVigentes({ permisos: [CAP], esPrincipal: true, usuario: "julio", tipoUsuario: "admin" });
  if (puedeConContexto(CAP, { hipodromo: "LA GRITA" })) {
    ok("el admin renombra cualquier hipodromo: la regla es del operador");
  } else {
    mal("la regla de hipodromo propio le rompio el renombrado al admin");
  }
}
if (!lineaFuera.length) {
  const conLinea = CAPACIDADES.filter((c) => String(c.fuente).split(":").length > 1).length;
  ok(`las ${conLinea} fuentes con línea apuntan dentro del archivo`);
} else {
  mal(`${lineaFuera.length} fuentes con línea imposible`, lineaFuera.join(", "));
}

const reqRotos = CAPACIDADES.flatMap((c) =>
  (c.requiere ?? []).filter((r) => !CAPACIDADES_POR_CLAVE.has(r)).map((r) => `${c.clave} -> ${r}`)
);
if (!reqRotos.length) ok("ninguna capacidad exige algo que no exista");
else mal(`${reqRotos.length} requisitos rotos`, reqRotos.join(", "));

const tiposValidos = new Set(["ruta", "boton", "modal", "celda", "campo", "funcion"]);
const tiposRaros = CAPACIDADES.filter((c) => !tiposValidos.has(c.tipo));
if (!tiposRaros.length) ok("toda capacidad tiene un tipo válido");
else mal(`${tiposRaros.length} con tipo inválido`, tiposRaros.map((c) => `${c.clave}=${c.tipo}`).join(", "));

const riesgosValidos = new Set(["lectura", "escritura", "critico"]);
const riesgosRaros = CAPACIDADES.filter((c) => !riesgosValidos.has(c.riesgo));
if (!riesgosRaros.length) ok("toda capacidad tiene un riesgo válido");
else mal(`${riesgosRaros.length} con riesgo inválido`, riesgosRaros.map((c) => c.clave).join(", "));

const modulosSinRuta = MODULOS_ESQUEMA.filter((m) => !m.capacidades.some((c) => c.tipo === "ruta"));
if (!modulosSinRuta.length) ok("todo módulo declara su capacidad de tipo ruta");
else mal(`${modulosSinRuta.length} módulos sin ruta`, modulosSinRuta.map((m) => m.clave).join(", "));

// ----------------------------------------------------------------- rutas ---
console.log("\n-- Puertas de entrada");
const rutasVivas = RUTAS_PROTEGIDAS;
if (rutasVivas.length >= 20) ok(`el middleware cubre ${rutasVivas.length} rutas`);
else mal(`el matcher solo cubre ${rutasVivas.length} rutas`, "el resto queda sin comprobar");

  // Una ruta que no exige capacidad tiene que estar JUSTIFICADA: ser pública.
  // Si se olvidara la marca `publica`, la ruta caería en la lista de "sin
  // capacidad" y aparecería como una fuga, no como una puerta declarada.
  const publicas = new Set(PUERTAS.filter((p) => p.publica).map((p) => p.ruta));
  const rutasSinCapacidad = [];
  for (const r of rutasVivas) {
    const cs = capacidadesDeRuta(r);
    if (cs.length && cs.every((c) => CAPACIDADES_POR_CLAVE.has(c))) continue;
    if (publicas.has(r) && !cs.length) continue;
    rutasSinCapacidad.push(r);
  }
if (!rutasSinCapacidad.length) ok("toda ruta protegida exige una capacidad que existe en el registro");
else mal(`${rutasSinCapacidad.length} rutas apuntan a capacidades inexistentes`, rutasSinCapacidad.join(", "));

// La coincidencia más larga tiene que ganar, si no /contabilidad/caja hereda
// la capacidad de /contabilidad y abriría de más.
const caja = capacidadesDeRuta("/contabilidad/caja");
if (caja[0] === "contabilidad:ruta_caja") ok("/contabilidad/caja exige su propia capacidad, no la de la raíz");
else mal("/contabilidad/caja no resuelve a su capacidad específica", `resolvió ${caja[0]}`);

const spec = capacidadesDeRuta("/contabilidad/monedas");
if (spec[0] === "contabilidad:ruta_monedas") ok("/contabilidad/monedas también resuelve a la suya");
else mal("/contabilidad/monedas resuelve mal", `resolvió ${spec[0]}`);

// ------------------------------------------------- usuario principal total ---
console.log("\n-- Usuario principal con acceso total");
if (esUsuarioPrincipal(USUARIO_PRINCIPAL)) ok(`${USUARIO_PRINCIPAL} es reconocido como principal`);
else mal("el usuario principal no se reconoce", USUARIO_PRINCIPAL);

if (esUsuarioPrincipal("josorioc@sistemahipico.local")) ok("también lo reconoce con el dominio del correo");
else mal("no reconoce el correo del usuario principal");
if (esUsuarioPrincipal("Josorioc")) ok("no distingue mayúsculas");
else mal("es sensible a mayúsculas");
if (!esUsuarioPrincipal("otro@ejemplo.com")) ok("no confunde a un usuario cualquiera con el principal");
else mal("un usuario cualquiera pasó por principal");

const rPrincipal = resolverAccesos({ identificador: USUARIO_PRINCIPAL, tipo: null, excepciones: {} });
if (rPrincipal.total && rPrincipal.permitidas.size === CAPACIDADES.length) {
  ok(`tiene las ${rPrincipal.permitidas.size} capacidades, sin depender de la matriz`);
} else {
  mal("el principal no tiene acceso total", `total=${rPrincipal.total} de ${rPrincipal.permitidas.size}`);
}

// Aunque la matriz le niegue TODO, el principal sigue teniendo acceso.
const rPiso = resolverAccesos({
  identificador: USUARIO_PRINCIPAL,
  tipo: { id: 1, nombre: "admin", capacidades: [] },
  excepciones: Object.fromEntries(CAPACIDADES.map((c) => [c.clave, "denegado"])),
});
if (rPiso.permitidas.size === CAPACIDADES.length) ok("ni una matriz vacía ni todo denegado le quitan acceso");
else mal("un tipo sin capacidades lo dejó fuera", `quedó con ${rPiso.permitidas.size}`);

// ------------------------------------------------------------- resolución ---
console.log("\n-- Resolución de accesos");

const sinTipo = resolverAccesos({ identificador: "nuevo@ejemplo.com", tipo: null, excepciones: {} });
if (sinTipo.permitidas.size === 0) ok("un usuario sin tipo asignado no ve NADA (se niega por omisión)");
else mal(`un usuario sin tipo tiene ${sinTipo.permitidas.size} capacidades`, "debería tener 0");

const baseAdmin = baseDeTipo("admin");
const rAdmin = resolverAccesos({ tipo: { id: 1, nombre: "admin", capacidades: baseAdmin }, excepciones: {} });
if (rAdmin.permitidas.size === CAPACIDADES.length) ok(`admin base alcanza las ${CAPACIDADES.length} capacidades`);
else mal(`admin base solo alcanza ${rAdmin.permitidas.size} de ${CAPACIDADES.length}`);

for (const nombre of ["operador", "consulta", "jugador"]) {
  const base = expandirConRequisitos(baseDeTipo(nombre));
  const r = resolverAccesos({ tipo: { id: 9, nombre, capacidades: [...base] }, excepciones: {} });
  const n = r.permitidas.size;
  const criticas = CAPACIDADES.filter((c) => c.riesgo === "critico");
  const concedidas = criticas.filter((c) => r.permitidas.has(c.clave));
  console.log(`       ${nombre.padEnd(9)} ${String(n).padStart(3)} capacidades · ${concedidas.length}/${criticas.length} criticas`);
  if (n > 0 && n <= CAPACIDADES.length) ok(`${nombre} resuelve un subconjunto razonable (${n})`);
  else mal(`${nombre} resolvió ${n} capacidades`, "esperado entre 1 y el total");
}

const rConsulta = resolverAccesos({
  tipo: { id: 3, nombre: "consulta", capacidades: [...expandirConRequisitos(baseDeTipo("consulta"))] },
  excepciones: {},
});
const escrituraDeConsulta = CAPACIDADES.filter((c) => c.riesgo !== "lectura" && rConsulta.permitidas.has(c.clave));
if (!escrituraDeConsulta.length) ok("consulta no puede escribir nada: solo tiene lectura");
else mal(`consulta puede escribir en ${escrituraDeConsulta.length} capacidades`, escrituraDeConsulta.map((c) => c.clave).join(", "));

const rOperador = resolverAccesos({
  tipo: { id: 2, nombre: "operador", capacidades: [...expandirConRequisitos(baseDeTipo("operador"))] },
  excepciones: {},
});
const liquidar = rOperador.permitidas.has("gestion_jugadas:btn_liquidar");
if (liquidar) ok("operador sí puede liquidar (es su trabajo)");
else mal("operador no puede liquidar", "base genérica incompleta");

// Excepciones individuales: mandan sobre la base del tipo.
const conPermiso = resolverAccesos({
  tipo: { id: 3, nombre: "consulta", capacidades: [...expandirConRequisitos(baseDeTipo("consulta"))] },
  excepciones: { "contabilidad:btn_registrar_ingreso": "permitido" },
});
if (conPermiso.permitidas.has("contabilidad:btn_registrar_ingreso")) ok("una excepción individual puede CONCEDER sobre la base");
else mal("no pudo conceder por excepción", "el permiso individual no se aplicó");

const conDenegado = resolverAccesos({
  tipo: { id: 2, nombre: "operador", capacidades: [...expandirConRequisitos(baseDeTipo("operador"))] },
  excepciones: { "gestion_jugadas:btn_liquidar": "denegado" },
});
if (!conDenegado.permitidas.has("gestion_jugadas:btn_liquidar")) ok("una excepción individual puede RESTAR sobre la base");
else mal("no pudo restar por excepción", "el permiso se concedió igual");
if (conDenegado.permitidas.has("gestion_jugadas:btn_cargar")) ok("restar una capacidad no se lleva las otras consigo");
else mal("restar una capacidad se llevó otras", "no debería");

// Requisitos: si se niega el requisito, la capacidad que lo exige cae.
const rReq = resolverAccesos({
  tipo: {
    id: 8,
    nombre: "raro",
    capacidades: ["contabilidad:btn_eliminar_banco", "marcas:btn_guardar_marcas"],
  },
  excepciones: {},
});
if (!rReq.permitidas.has("contabilidad:btn_eliminar_banco")) {
  ok("no concede una capacidad crítica sin su ruta requerida");
} else {
  mal("concedió borrar banco sin haberle dado la ruta", "el requisito no se evaluó");
}

// ------------------------------------------------------- buscador y base ---
console.log("\n-- Búsqueda y bases genéricas");
const buscaLiq = buscarCapacidades("liquidar");
if (buscaLiq.length > 0) ok(`el buscador encuentra "liquidar" (${buscaLiq.length})`);
else mal(`el buscador no encuentra "liquidar"`);
const soloBotones = buscarCapacidades("", "boton");
if (soloBotones.every((c) => c.tipo === "boton")) ok(`el filtro por tipo es exacto (${soloBotones.length} botones)`);
else mal("el filtro por tipo deja pasar capacidades de otro tipo");

  for (const nombre of ["admin", "operador", "consulta", "jugador"]) {
    const base = baseDeTipo(nombre);
    const inventadas = base.filter((c) => !CAPACIDADES_POR_CLAVE.has(c));
    if (!inventadas.length) ok(`la base de ${nombre} solo usa capacidades reales (${base.length})`);
    else mal(`la base de ${nombre} tiene claves inexistentes`, inventadas.join(", "));
  }

  // ------------------------------------------------------------------
  // El bug que casi se va: el operador veía sus botones de escribir, pero su
  // base no incluía las `fn_*` del data layer. La UI se ve habilitada y
  // `exigirCapacidad()` revienta la escritura. Esta regla ata las dos cosas.
  // ------------------------------------------------------------------
  {
    const baseOperador = new Set(baseDeTipo("operador"));
    const fnDeModulo = new Map();
    for (const c of CAPACIDADES) {
      if (c.tipo !== "funcion") continue;
      if (!fnDeModulo.has(c.modulo)) fnDeModulo.set(c.modulo, []);
      fnDeModulo.get(c.modulo).push(c.clave);
    }
    const huerfanas = [];
    for (const c of CAPACIDADES) {
      if (c.tipo !== "boton") continue;
      const modulo = c.modulo;
      // Solo los módulos operativos: seguridad y contabilidad son del admin, y
      // portal no lo opera el personal (juega el cliente con su token).
      if (modulo === "seguridad" || modulo === "contabilidad" || modulo === "portal") continue;
      if (!fnDeModulo.has(modulo)) continue;
      const falta = fnDeModulo.get(modulo).filter((k) => !baseOperador.has(k));
      if (falta.length) huerfanas.push(`${modulo} (boton ${c.clave} sin ${falta.join(", ")})`);
    }
    const soloPortal = CAPACIDADES.filter((c) => c.tipo === "funcion" && c.modulo === "portal").map((c) => c.clave);
    if (!huerfanas.length) {
      // El portal es la excepción consciente, y la misma que declara el
      // validador: el cliente entra con su propio token/clave, no con la sesión
      // de Supabase del personal, así que `exigirCapacidad()` no aplica ahí.
      ok("todo boton operativo del operador tiene su fn_* de data layer en la base");
    } else {
      mal("el operador tiene botones habilitados que el data layer le va a rebotar", [...new Set(huerfanas)].join(" | "));
    }
    if (soloPortal.length === 1 && soloPortal[0] === "portal:fn_operar_portal") {
      ok("portal es la unica excepcion: el cliente juega con su token, no con la sesion del personal");
    } else {
      mal("la excepcion del portal se multiplico sin querer", soloPortal.join(", "));
    }
  }


// ============================================================================
// La puerta de escritura del data layer se prueba en EJECUCIÓN, no mirando el
// texto: una capacidad `fn_*` aplicada y una que se cuela por otro camino se
// ven igual en el fuente, pero se comportan distinto.
// ============================================================================
{
  limpiarAccesosVigentes();
  if (!tieneCapacidad("clientes:fn_eliminar_cliente")) {
    ok("sin sesion ninguna capacidad pasa (ni siquiera una fn_*)");
  } else {
    mal("sin sesion se puede ejecutar una escritura");
  }

  let lanzo = false;
  try {
    exigirCapacidad("clientes:fn_eliminar_cliente");
  } catch (e) {
    lanzo = e instanceof ErrorPermiso;
  }
  if (lanzo) ok("exigirCapacidad lanza ErrorPermiso sin sesion");
  else mal("exigirCapacidad dejo pasar una escritura sin sesion");

  setAccesosVigentes({ permisos: ["clientes:ruta_clientes"], esPrincipal: false, usuario: "consulta" });
  if (tieneCapacidad("clientes:ruta_clientes") && !tieneCapacidad("clientes:fn_eliminar_cliente")) {
    ok("con permisos de lectura, la escritura queda denegada");
  } else {
    mal("los permisos de lectura habilitan una escritura");
  }

  setAccesosVigentes({ permisos: [], esPrincipal: true, usuario: "josorioc" });
  if (tieneCapacidad("clientes:fn_eliminar_cliente")) ok("el principal pasa sin necesidad de permisos listados");
  else mal("el principal quedo sin acceso");

  setAccesosVigentes({ permisos: ["clientes:ruta_clientes"], esPrincipal: false, usuario: "consulta" });
  limpiarAccesosVigentes();
  if (!tieneCapacidad("clientes:ruta_clientes")) ok("cerrar sesion borra los permisos en memoria");
  else mal("los permisos sobreviven a limpiarAccesosVigentes");

  if (usuarioVigente() === "") ok("sin sesion no hay usuario vigente");
  else mal("usuarioVigente quedo con un usuario sin sesion");
}

  // ------------------------------------------------------------------
  // La lista de públicas NO puede estar escrita a mano en los componentes.
  //
  // Esa lista se hardcodeó dos veces y las dos quedaron cortas: AppShell
  // comparaba contra "/" | "/login" y AuthBootstrap contra "/login". Al agregar
  // /reset-password —que se abre SIN sesión, porque llega desde el enlace del
  // correo— esa página quedó envuelta con el menú lateral y además redirigida al
  // login. La recuperación de contraseña no funcionaba, y el test de arriba no lo
  // veía porque sólo probaba `rutaPermitida`, que sí estaba bien.
  // ------------------------------------------------------------------
  {
    // El defecto no era "toda comparación literal": `ES_PORTAL` y el redirect
    // post-login comparan rutas a propósito y no son un problema. El defecto es
    // comparar contra una ruta que PUERTAS declara PÚBLICA: esa lista tiene una
    // sola fuente de verdad y una copia se queda vieja sola.
    const publicas = PUERTAS.filter((p) => p.publica).map((p) => p.ruta);
    for (const rel of ["src/components/layout/AppShell.tsx", "src/components/auth/AuthBootstrap.tsx"]) {
      const sinComentarios = readFileSync(join(RAIZ, rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .split("\n")
        .map((l) => l.replace(/\/\/.*$/, ""))
        .join("\n");
      const literales = publicas.filter((r) =>
        new RegExp(`===\\s*"${r.replace("/", "\\/")}"|===\\s*'${r.replace("/", "\\/")}'`).test(sinComentarios)
      );
      if (!literales.length) ok(`${rel} no copia la lista de rutas publicas (usa esRutaPublica)`);
      else mal(`${rel} hardcodea rutas publicas`, `${literales.join(", ")} — debe usar esRutaPublica()`);
    }
  }

  // ------------------------------------------------------------------
  // La puerta (login) es lo ÚNICO público. Si `rutaPermitida` leyera mal el
  // campo `publica`, el login abriría el sistema entero sin sesión: por eso se
  // prueba con un set vacío, que es exactamente el caso "nadie Entró".
  // ------------------------------------------------------------------
  {
    const vacio = new Set();
    const publicas = PUERTAS.filter((p) => p.publica).map((p) => p.ruta);
    const abiertasDeMas = PUERTAS.map((p) => p.ruta).filter(
      (r) => rutaPermitida(r, vacio) && !publicas.includes(r)
    );
    if (!abiertasDeMas.length) ok(`sin sesion solo se abren las ${publicas.length} rutas publicas`);
    else mal("sin sesion se abren rutas que no son publicas", abiertasDeMas.join(", "));

    if (rutaPermitida("/clientes", vacio) === false) ok("una ruta protegida sigue cerrada sin sesion");
    else mal("una ruta protegida se abrio sin sesion");

    // Y con la capacidad debida, se abre. La puerta no se "pegó" cerrada.
    if (rutaPermitida("/clientes", new Set(["clientes:ruta_clientes"]))) {
      ok("con la capacidad correcta la ruta protegida se abre");
    } else {
      mal("con la capacidad correcta la ruta NO se abre");
    }

    // La coincidencia más larga gana: /contabilidad/caja no puede abrirse con
    // la de /contabilidad.
    if (!rutaPermitida("/contabilidad/caja", new Set(["contabilidad:ruta_contabilidad"]))) {
      ok("la coincidencia mas larga gana: /contabilidad/caja no hereda la de /contabilidad");
    } else {
      mal("/contabilidad/caja se abrio con la capacidad de /contabilidad");
    }
  }

  // ============================================================================
// ABAC — las reglas de atributo
// ============================================================================
console.log("\n== ABAC: reglas de atributo");

{
  // --- el catálogo es coherente ------------------------------------------
  if (ATRIBUTOS.length && ATRIBUTOS_POR_CLAVE.size === ATRIBUTOS.length) {
    ok(`el catalogo tiene ${ATRIBUTOS.length} atributos, sin claves repetidas`);
  } else {
    mal("el catalogo de atributos tiene claves repetidas");
  }

  const sinOrigen = ATRIBUTOS.filter((a) => !a.origen?.trim());
  if (!sinOrigen.length) ok("todo atributo declara de donde sale (origen)");
  else mal(`${sinOrigen.length} atributo(s) sin origen: nadie sabe que pasarles`);

  // Toda regla tiene que apuntar a una capacidad Y un atributo que existan.
  // Una regla colgada es una regla que nunca se dispara: el ABAC parece
  // activo y no lo esta.
  const colgadas = REGLAS_ABAC.filter(
    (r) => !CAPACIDADES_POR_CLAVE.has(r.capacidad) || !ATRIBUTOS_POR_CLAVE.has(r.atributo)
  );
  if (!colgadas.length) ok(`las ${REGLAS_ABAC.length} reglas apuntan a capacidades y atributos reales`);
  else mal(`reglas colgadas: ${colgadas.map((r) => r.id).join(", ")}`);

  const idsRepetidos = REGLAS_ABAC.map((r) => r.id).filter((id, i, a) => a.indexOf(id) !== i);
  if (!idsRepetidos.length) ok("ninguna regla repite id");
  else mal(`ids repetidos: ${[...new Set(idsRepetidos)].join(", ")}`);

  const sinMensaje = REGLAS_ABAC.filter((r) => !r.mensaje?.trim());
  if (!sinMensaje.length) ok("toda regla tiene un mensaje para el operador");
  else mal(`${sinMensaje.length} regla(s) sin mensaje`);

  // Una regla `en_atributo` tiene que apuntar a OTRO atributo del catálogo,
  // o el conjunto permitido nunca se resuelve.
  const enAtr = REGLAS_ABAC.filter((r) => r.operador === "en_atributo");
  const enAtrRoto = enAtr.filter((r) => !ATRIBUTOS_POR_CLAVE.has(String(r.valor ?? "")));
  if (!enAtrRoto.length) ok(`las ${enAtr.length} reglas en_atributo apuntan a un atributo existente`);
  else mal(`en_atributo a un atributo inexistente: ${enAtrRoto.map((r) => `${r.id} -> ${r.valor}`).join(", ")}`);

  // Los topes de dinero son límites operativos: el dueño los puede levantar.
  // Los invariantes de estado, no.
  const integridad = REGLAS_ABAC.filter((r) => /estado_abierto|accion_valida|no_negativo/.test(r.id));
  const integridadExenta = integridad.filter((r) => r.principal === "exento");
  if (!integridadExenta.length) ok("las reglas de integridad no eximen al principal");
  else mal(`integridad eximida al principal: ${integridadExenta.map((r) => r.id).join(", ")}`);

  // Qué se puede levantar y qué no. La intención está DECLARADA en `clase`, y
  // tiene que ser coherente con `principal`: un invariante que el principal se
  // salta es un agujero, y un tope que no se puede levantar es una traba.
  const limites = REGLAS_ABAC.filter((r) => r.clase === "limite");
  const limitesMal = limites.filter((r) => r.principal !== "exento");
  if (limites.length && !limitesMal.length) {
    ok(`los ${limites.length} limites operativos son levantables por el principal`);
  } else {
    mal(`limites que el principal no puede levantar: ${limitesMal.map((r) => r.id).join(", ")}`);
  }

  const integ = REGLAS_ABAC.filter((r) => r.clase === "integridad");
  const integMal = integ.filter((r) => r.principal !== "sujeto");
  if (integ.length && !integMal.length) {
    ok(`los ${integ.length} invariantes le aplican al principal tambien`);
  } else {
    mal(`invariantes que el principal se salta: ${integMal.map((r) => r.id).join(", ")}`);
  }

  // Y toda regla tiene que declararse de una de las dos clases.
  const sinClase = REGLAS_ABAC.filter((r) => r.clase !== "integridad" && r.clase !== "limite");
  if (!sinClase.length) ok("toda regla declara su clase");
  else mal(`${sinClase.length} regla(s) sin clase valida: ${sinClase.map((r) => r.id).join(", ")}`);

  // --- la comparación en sí ---------------------------------------------
  const CAP = "tickets:fn_anular_ticket";
  const op = { tipoUsuario: "admin" };

  if (permiteConContexto(CAP, { estado: "CREADO", accion: "ABONO" }, op)) {
    ok("un ticket CREADO con accion valida pasa");
  } else {
    mal("un ticket CREADO con accion ABONO fue rechazado");
  }

  // ESTE es el caso de integridad: mismo permiso, distinto estado.
  if (!permiteConContexto(CAP, { estado: "SOLUCIONADO", accion: "ABONO" }, op)) {
    ok("un ticket ya SOLUCIONADO no se vuelve a resolver");
  } else {
    mal("un ticket SOLUCIONADO paso el ABAC: se puede re-resolver un ticket cerrado");
  }

  // Ausente = bloquea. Es el cierre por omisión, y el que evita que un
  // formulario con el campo vacio pase los controles de topes.
  if (!permiteConContexto(CAP, { accion: "ABONO" }, op)) {
    ok("sin el atributo estado, la operacion se bloquea");
  } else {
    mal("sin estado, la operacion paso: un undefined cuenta como cumple");
  }
  if (!permiteConContexto(CAP, { estado: "CREADO" }, op)) {
    ok("sin el atributo accion, la operacion se bloquea");
  } else {
    mal("sin accion, la operacion paso");
  }
  if (!permiteConContexto(CAP, {}, op)) {
    ok("con el contexto vacio, la operacion se bloquea");
  } else {
    mal("con el contexto vacio, la operacion paso");
  }
  if (!permiteConContexto(CAP, { estado: "", accion: "ABONO" }, op)) {
    ok("un string vacio cuenta como ausente, no como valor");
  } else {
    mal("estado: '' paso como si fuera un estado valido");
  }

  // Comparación de texto: sin distinguir mayúsculas ni espacios.
  if (permiteConContexto(CAP, { estado: " en_revision ", accion: "abono" }, op)) {
    ok("la comparacion de texto ignora mayusculas y espacios");
  } else {
    mal("el estado ' en_revision ' fue rechazado: la comparacion es sensible a mayusculas");
  }

  // `en` con un valor que NO está en la lista.
  if (!permiteConContexto(CAP, { estado: "BORRADO", accion: "ABONO" }, op)) {
    ok("un estado fuera de la lista se bloquea");
  } else {
    mal("estado BORRADO paso: la lista de estados no se respeta");
  }
  if (!permiteConContexto(CAP, { estado: "CREADO", accion: "INVENTAR" }, op)) {
    ok("una accion inventada se bloquea");
  } else {
    mal("accion INVENTAR paso");
  }

  // Todas las reglas se evalúan: si la primera pasa y la segunda no, bloquea.
  const ev = evaluarAbac(CAP, { estado: "CREADO", accion: "INVENTAR" }, op);
  if (!ev.permitido && ev.regla?.id === "ticket:anular:accion_valida") {
    ok("la evaluacion devuelve WHICH regla bloqueo (accion, no estado)");
  } else {
    mal(`la evaluacion reporto ${ev.regla?.id ?? "nada"} en vez de la regla de accion`);
  }
  if (ev.aplicadas.length === 2) {
    ok("la evaluacion deja ver las dos reglas que se aplicaron");
  } else {
    mal(`se evaluaron ${ev.aplicadas.length} reglas, se esperaban 2`);
  }

  // `exigirContexto` lanza con el mensaje de la regla.
  try {
    exigirContexto(CAP, { estado: "SOLUCIONADO", accion: "ABONO" }, op);
    mal("exigirContexto no lanzo con un ticket ya solucionado");
  } catch (e) {
    if (e instanceof ErrorAtributo && /ya fue solucionado/.test(e.message)) {
      ok("exigirContexto lanza ErrorAtributo con el mensaje de la regla");
    } else {
      mal(`exigirContexto lanzo otra cosa: ${e.name} ${e.message}`);
    }
  }

  // Sin reglas de ABAC, todo pasa: el ABAC solo acota, no habilita.
  if (permiteConContexto("clientes:ruta_clientes", {}, op)) {
    ok("una capacidad sin reglas de atributo no se ve afectada");
  } else {
    mal("una capacidad sin reglas de ABAC quedo bloqueada");
  }

  // --- el ambito por tipo ------------------------------------------------
  const LIQ = "gestion_jugadas:fn_liquidar_carrera";
  const ctxHip = { hipodromo: "LA TRINIDAD", usuario_hipodromos: ["LA TRINIDAD"], monto: 100 };

  if (permiteConContexto(LIQ, ctxHip, { tipoUsuario: "operador" })) {
    ok("el operador liquida el hipodromo que tiene asignado");
  } else {
    mal("el operador no pudo liquidar su propio hipodromo");
  }
  if (!permiteConContexto(LIQ, { ...ctxHip, hipodromo: "LA GRITA" }, { tipoUsuario: "operador" })) {
    ok("al operador se le bloquea un hipodromo ajeno");
  } else {
    mal("el operador pudo liquidar un hipodromo que no tiene asignado");
  }
  // El admin no tiene la regla de hipodromo: los ambitos se respetan.
  if (permiteConContexto(LIQ, { hipodromo: "LA GRITA", monto: 100 }, { tipoUsuario: "admin" })) {
    ok("el admin no esta sujeto a la regla de hipodromo propio");
  } else {
    mal("la regla de ambito tipo:operador le pico al admin");
  }

  // Tope de monto: mismo permiso, distinto valor.
  if (!permiteConContexto(LIQ, { ...ctxHip, monto: 9000 }, { tipoUsuario: "operador" })) {
    ok("una liquidacion de 9.000 al operador se le bloquea por el tope");
  } else {
    mal("el operador liquido 9.000: el tope de monto no se aplica");
  }
  if (permiteConContexto(LIQ, { ...ctxHip, monto: 5000 }, { tipoUsuario: "operador" })) {
    ok("el tope de 5.000 es inclusive: 5.000 exacto pasa");
  } else {
    mal("5.000 exacto fue rechazado: el tope deberia ser inclusivo");
  }
  if (permiteConContexto(LIQ, { ...ctxHip, monto: 5001 }, { tipoUsuario: "admin" })) {
    ok("el admin liquida por encima del tope del operador");
  } else {
    mal("el admin quedo sujeto al tope del operador: el ambito no se respeta");
  }

  // El principal se exime de los topes, pero NO de la integridad.
  if (permiteConContexto(LIQ, { ...ctxHip, monto: 9000 }, { tipoUsuario: "admin", esPrincipal: true })) {
    ok("el principal se exime del tope de monto");
  } else {
    mal("el principal quedo sujeto al tope de monto");
  }
  if (!permiteConContexto(CAP, { estado: "SOLUCIONADO", accion: "ABONO" }, { esPrincipal: true })) {
    ok("el principal tampoco puede resolver un ticket ya cerrado");
  } else {
    mal("el principal re-resolvio un ticket cerrado: la integridad no le aplica");
  }

  // `en_atributo` sin el conjunto del usuario: no se puede saber qué se
  // permite, entonces no se permite.
  if (!permiteConContexto(LIQ, { hipodromo: "LA TRINIDAD", monto: 100 }, { tipoUsuario: "operador" })) {
    ok("sin la lista de hipodromos del usuario, se bloquea");
  } else {
    mal("sin usuario_hipodromos, paso: un conjunto ausente permite todo");
  }
  if (!permiteConContexto(LIQ, { ...ctxHip, usuario_hipodromos: [] }, { tipoUsuario: "operador" })) {
    ok("una lista de hipodromos vacia no habilita nada");
  } else {
    mal("una lista vacia de hipodromos permitio operar");
  }

  // --- montos: formato con miles y decimales -----------------------------
  const CONT = "contabilidad:fn_registrar_movimiento";
  if (permiteConContexto(CONT, { metodo_pago: "efectivo", monto: 1_500.5 }, { tipoUsuario: "operador" })) {
    ok("un monto con decimales se lee bien");
  } else {
    mal("un monto de 1.500,50 fue rechazado");
  }
  if (!permiteConContexto(CONT, { metodo_pago: "bitcoin", monto: 10 }, { tipoUsuario: "operador" })) {
    ok("un metodo de pago desconocido se bloquea");
  } else {
    mal("metodo de pago bitcoin paso");
  }
  if (!permiteConContexto(CONT, { metodo_pago: "efectivo" }, { tipoUsuario: "operador" })) {
    ok("un movimiento sin monto se bloquea (tope sin dato, no pasa)");
  } else {
    mal("un movimiento sin monto paso el tope");
  }

  // --- las dos puertas, juntas ------------------------------------------
  limpiarAccesosVigentes();

  // Sin sesion: ni permiso ni ABAC. El orden de la puerta importa: primero
  // el permiso, para que el mensaje no insinúe que el problema es el registro.
  try {
    exigirPermiso(CAP, { estado: "CREADO", accion: "ABONO" });
    mal("exigirPermiso dejo pasar a alguien sin sesion");
  } catch (e) {
    if (e.name === "ErrorPermiso") ok("sin sesion, la puerta corta por PERMISO (no por atributo)");
    else mal(`sin sesion, corto por ${e.name}: el orden de la puerta esta invertido`);
  }

  // Con la capacidad pero sin los atributos: ahora si es un error de atributo.
  setAccesosVigentes({ permisos: [CAP], esPrincipal: false, usuario: "op1", tipoUsuario: "operador" });
  if (tieneCapacidad(CAP) && !puedeConContexto(CAP, { estado: "CREADO" })) {
    ok("con la capacidad pero sin accion, el bloqueo es por atributo");
  } else {
    mal("con la capacidad pero sin accion, no se bloqueo por atributo");
  }

  try {
    exigirPermiso(CAP, { estado: "CREADO" });
    mal("exigirPermiso dejo pasar con el atributo accion ausente");
  } catch (e) {
    if (e instanceof ErrorAtributo) ok("exigirPermiso lanza ErrorAtributo cuando el permiso esta ok");
    else mal(`exigirPermiso lanzo ${e.name} con el permiso ya cubierto`);
  }

  if (exigirPermiso(CAP, { estado: "EN_REVISION", accion: "REEMBOLSO" }) === undefined) {
    ok("exigirPermiso no devuelve nada cuando todo pasa");
  } else {
    mal("exigirPermiso devolvio algo en vez de fallar en silencio");
  }

  // Los atributos del usuario llegan por la sesion, no por el contexto: si el
  // llamador pudiera pasar `usuario_hipodromos`, se losPoneria a mano.
  setAccesosVigentes({
    permisos: [LIQ],
    esPrincipal: false,
    usuario: "op2",
    tipoUsuario: "operador",
    atributos: { usuario_hipodromos: ["LA TRINIDAD"] },
  });
  if (puedeConContexto(LIQ, { hipodromo: "LA TRINIDAD", monto: 100 })) {
    ok("los hipodromos del usuario salen de la sesion, no hace falta pasarlos");
  } else {
    mal("con usuario_hipodromos en la sesion, la operacion se bloqueo igual");
  }
  if (!puedeConContexto(LIQ, { hipodromo: "LA GRITA", monto: 100 })) {
    ok("el contexto no puede ampliar los hipodromos de la sesion");
  } else {
    mal("un hipodromo ajeno paso: el contexto sobreescribio los atributos del usuario");
  }

  limpiarAccesosVigentes();
  if (!tieneCapacidad(CAP) && !puedeConContexto(CAP, { estado: "CREADO", accion: "ABONO" })) {
    ok("al cerrar sesion no queda ninguna capacidad ni pasa el ABAC");
  } else {
    mal("quedaron capacidades o el ABAC paso despues de cerrar sesion");
  }

  // El helper de la UI.
  if (reglasDeCapacidad(CAP).length === 2 && reglasDeCapacidad("clientes:ruta_clientes").length === 0) {
    ok("reglasDeCapacidad devuelve las de esa capacidad y vacio para las que no tienen");
  } else {
    mal("reglasDeCapacidad no filtro bien por capacidad");
  }
}

// ------------------------------------------------------------- ABAC: tildes ---
// El dominio real trae "PAGO MÓVIL" con tilde y el catálogo lo escribe sin
// tilde. Si la comparación no normaliza, un ingreso de dinero se rechaza como
// "método no reconocido" y el operador no tiene forma de saber por qué.
{
  const CAP = "contabilidad:fn_registrar_movimiento";
  limpiarAccesosVigentes();
  setAccesosVigentes({ permisos: [CAP], esPrincipal: false, usuario: "op", tipoUsuario: "operador" });

  const conTilde = { monto: 100, metodo_pago: "PAGO MÓVIL" };
  const sinTilde = { monto: 100, metodo_pago: "pago movil" };
  if (puedeConContexto(CAP, conTilde) && puedeConContexto(CAP, sinTilde)) {
    ok("el metodo de pago se reconoce con y sin tilde");
  } else {
    mal("el metodo de pago se rechaza segun como este escrita la tilde");
  }

  if (!puedeConContexto(CAP, { monto: 100, metodo_pago: "CRYPTO" })) {
    ok("un metodo de pago inventado se bloquea");
  } else {
    mal("un metodo de pago cualquiera paso el control");
  }

  if (!puedeConContexto(CAP, { monto: 999999, metodo_pago: "efectivo" })) {
    ok("un movimiento que pasa el tope del operador se bloquea");
  } else {
    mal("el tope de monto del operador no se aplico");
  }

  // El principal es exento del tope, pero NO del metodo: el invariante le
  // pega igual. Es el punto de la clase.
  limpiarAccesosVigentes();
  setAccesosVigentes({ permisos: [CAP], esPrincipal: true, usuario: "josorioc", tipoUsuario: "admin" });
  if (
    puedeConContexto(CAP, { monto: 999999, metodo_pago: "efectivo" }) &&
    !puedeConContexto(CAP, { monto: 1, metodo_pago: "CRYPTO" })
  ) {
    ok("el principal levanta el tope pero no el metodo invalido");
  } else {
    mal("el principal no respeta la distincion entre limite e invariante");
  }
}

// ------------------------------------------------- ABAC: borrar hipodromos ---
// `btn_eliminar` era una capacidad critica sin ninguna regla: un operador
// podia borrar el hipodromo de otro con un click.
{
  const CAP = "hipodromos:btn_eliminar";
  limpiarAccesosVigentes();
  setAccesosVigentes({
    permisos: [CAP],
    esPrincipal: false,
    usuario: "op",
    tipoUsuario: "operador",
    atributos: { usuario_hipodromos: ["LA TRINIDAD"] },
  });

  if (puedeConContexto(CAP, { hipodromo: "LA TRINIDAD" })) ok("el operador borra su propio hipodromo");
  else mal("el operador no puede borrar su propio hipodromo");

  if (!puedeConContexto(CAP, { hipodromo: "LA GRITA" })) ok("el operador NO borra un hipodromo ajeno");
  else mal("un operador puede borrar el hipodromo de otro: la regla no esta conectada");

  // Y sin lista de hipodromos, todo bloquea. Es el cierre por omision: si no se
  // sabe que hipodromos tiene, no se asume que tiene todos.
  limpiarAccesosVigentes();
  setAccesosVigentes({ permisos: [CAP], esPrincipal: false, usuario: "op", tipoUsuario: "operador" });
  if (!puedeConContexto(CAP, { hipodromo: "LA TRINIDAD" })) {
    ok("sin hipodromos asignados, el operador no borra ninguno");
  } else {
    mal("sin atributos, el ABAC permitio el borrado en vez de bloquear");
  }
}

// ------------------------------------------------- la Edge Function compila ---
// `tsconfig.json` excluye `supabase/` porque el código de la función corre en
// Deno, no en Next. El efecto secundario es que `npx tsc` no la mira nunca, y
// ahí hubo cuatro errores de tipos que llegaron a "verde". Por eso se chequea
// aparte, con la toolchain que la va a ejecutar.
{
  const fn = "supabase/functions/portal-auth/index.ts";
  if (!existsSync(join(RAIZ, fn))) {
    mal("no existe la Edge Function del portal");
  } else {
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(
      "npx",
      ["--yes", "deno", "check", "--node-modules-dir=auto", fn],
      { cwd: RAIZ, encoding: "utf8", timeout: 600000, shell: true }
    );
    const salida = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    if (r.status === 0) {
      ok("la Edge Function del portal pasa deno check");
    } else {
      const errores = salida
        .split(/\r?\n/)
        .filter((l) => /error|TS\d+/.test(l))
        .slice(0, 4)
        .join(" | ");
      mal(`deno check fallo en ${fn}: ${errores || "sin detalle"}`);
    }
  }
}

// ------------------------------------------------------- encoding de los archivos ---
// Escribir desde PowerShell dejó U+FFFD y, en tres comentarios, texto en chino
// donde iba español. No rompe la ejecución, pero un `with check` o un mensaje de
// error con el texto roto no se revisa, y es justo donde se esconden los
// cambios de seguridad. Se recorre todo el código, no solo una lista.
//
// El mojibake se busca con DIGRAFOS (acentos y comillas codificados dos veces),
// nunca con una letra suelta: `â` es un carácter legítimo —aparece en el
// `translate()` de `norma_abac`— y marcarla haría ruido. Y este archivo se
// excluye a sí mismo, porque para describir el patrón tiene que escribirlo, y
// se detectaría.
{
  const firmas = /\u00C3[\u0080-\u00BF\u00A0-\u024F]|\u00E2\u20AC|\u00C2[\u0080-\u00BF\u00A0-\u00FF]|\u00C3\u0192/g;
  const YO = new URL(import.meta.url).pathname.replace(/^\//, "").replace(/\//g, "\\");
  const ARCHIVOS_DE_SEGURIDAD = [
    "src\\db\\seguridad_maestro.sql",
    "src\\db\\maestro_seed.sql",
    "src\\db\\rls-negocio.sql",
    "src\\lib\\seguridad\\abac.ts",
    "src\\lib\\seguridad\\vigente.ts",
    "src\\lib\\seguridad\\accesos.ts",
    "src\\lib\\hipodromos\\servicio.ts",
    "src\\lib\\contabilidad.ts",
    "src\\lib\\portal.ts",
    "src\\lib\\tickets.ts",
    "src\\lib\\carreras\\retiros.ts",
    "src\\lib\\liquidacion\\pagarYCerrar.ts",
    "supabase\\functions\\portal-auth\\index.ts",
  ];

  const rutas = [];
  const recorrer = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === ".next" || e.name === "legacy") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) recorrer(p);
      else if (/\.(ts|tsx|mjs|sql)$/.test(e.name)) rutas.push(p);
    }
  };
  recorrer(join(RAIZ, "src"));
  recorrer(join(RAIZ, "supabase"));
  recorrer(join(RAIZ, "pruebas"));
  // `sql/` entra ahora: es SQL mantenido a mano con comentarios en espanol que
  // van a mano en el SQL Editor. Un U+FFFD ahi llega hasta la base de
  // produccion, y el archivo mas legacy (`paquete_pendientes.sql`) ya
  // tenia justo ese tipo de dano.
  recorrer(join(RAIZ, "sql"));

  const sucios = [];
  const mojibakeViejo = [];
  for (const p of rutas) {
    if (p === YO) continue;
    const rel = p.slice(RAIZ.length + 1);
    const t = readFileSync(p, "utf8");
    // Duro en todas partes: un U+FFFD o un chino es siempre un error.
    const duros = [
      [/\uFFFD/g, "U+FFFD"],
      [/\u4E00-\u9FFF\u3000-\u303F/g, "caracteres CJK"],
      [/notas partes/g, "typo 'notas partes'"],
    ].filter(([re]) => re.test(t));
    if (duros.length) sucios.push(`${rel} (${duros.map(([, n]) => n).join(", ")})`);

    const roto = (t.match(firmas) || []).length;
    if (roto === 0) continue;
    // Duro en los archivos de seguridad: ahí un texto corrupto puede estar
    // escondiendo un cambio. En el resto, es dano heredado de una conversión
    // de encoding anterior y no se arregla con un test.
    if (ARCHIVOS_DE_SEGURIDAD.includes(rel)) sucios.push(`${rel} (${roto} mojibake)`);
    else mojibakeViejo.push(`${rel} (${roto})`);
  }

  if (sucios.length === 0) {
    ok(`sin encoding roto en ${rutas.length} archivos`);
    if (mojibakeViejo.length) {
      console.log(`       nota: ${mojibakeViejo.length} archivo(s) con mojibake heredado, fuera del alcance de seguridad:`);
      for (const m of mojibakeViejo) console.log(`         - ${m}`);
    }
  } else {
    mal("encoding roto: " + sucios.join(" | "));
  }
}

// ------------------------- `nota_auditoria ->>` sin el cast a jsonb -------------------------
// `tickets_apuestas.nota_auditoria` es TEXT. El operador `->>` es de jsonb, asi
// que sin `::jsonb` el script revienta al aplicarse con
//     ERROR 42883: operator does not exist: text ->> unknown
// Esto ya paso de verdad: `migrar-wps-tickets.sql` y `tablas_venta.sql` lo
// tenian y el gate de encoding (que solo mira caracteres) no lo podia ver.
// El cast explicito tambien evita el problema simetrico: si somewhere se
// escribiera `nota_auditoria` como jsonb, el `->>` pasaria y el resto del
// modulo (que la lee como texto) se romperia al otro lado.
{
  const sueltos = [];
  const dirSql = join(RAIZ, "sql");
  for (const e of readdirSync(dirSql, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith(".sql")) continue;
    const rel = e.name;
    const txt = readFileSync(join(dirSql, rel), "utf8");
    txt.split(/\r?\n/).forEach((linea, i) => {
      const codigo = linea.replace(/--.*$/, "");
      const usos = codigo.match(/\bnota_auditoria\s*(?:->>|->)\s*'/g);
      if (!usos) return;
      for (const u of usos) {
        // cuenta solo los que NO traen `::jsonb` justo antes
        const antes = codigo.slice(0, codigo.indexOf(u));
        if (/\bnota_auditoria\s*::jsonb\s*$/.test(antes)) continue;
        sueltos.push(`${rel}:${i + 1}`);
      }
    });
  }
  if (sueltos.length === 0) ok("ningun `nota_auditoria ->>` sin castear a jsonb");
  else mal("`nota_auditoria ->>` sin `::jsonb` (la columna es TEXT): " + sueltos.join(", "));
}

// ------------------------------------------- ningun .js compilado dentro de src/ ---
// Las pruebas se compilan con `tsc -p pruebas/tsconfig.json`. Ese tsconfig tiene
// `noEmit: false` porque node no corre TS, así que EMITE. Con `--outDir` (que es lo
// que pasa run-marcas.ps1) el .js cae en una carpeta temporal y no molesta. Pero un
// `tsc -p pruebas/tsconfig.json` a pelo lo deja junto al .ts: se juntaron 23 .js en
// src/ y `next build` empezó a compilar src/lib/seguridad/capacidades.js, que reventó
// con "Cannot use 'import.meta' outside a module".
//
// El síntoma (un error de build en una ruta que nadie tocó) no señala la causa, y el
// `.gitignore` no ayuda porque los archivos no se commitean: aparecen, rompen y
// desaparecen al hacer clean. Por eso se comprueba acá.
{
  const suciosJs = [];
  const recorrerJs = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === ".next") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) recorrerJs(p);
      // Solo .js que tenga un .ts al lado: los .js legitimos (config, scripts de
      // supabase, etc.) no vienen acompanados por su fuente TypeScript.
      else if (e.name.endsWith(".js") && existsSync(p.replace(/\.js$/, ".ts"))) {
        suciosJs.push(p.slice(RAIZ.length + 1));
      }
    }
  };
  recorrerJs(join(RAIZ, "src"));

  if (suciosJs.length === 0) {
    ok("no hay .js compilados dentro de src/ (romperian `next build`)");
  } else {
    mal(
      `hay ${suciosJs.length} .js compilados dentro de src/, junto a su .ts: ` +
        `${suciosJs.slice(0, 6).join(", ")}. Se generan al compilar las pruebas sin ` +
        `--outDir. Borralos y no uses \`tsc -p pruebas/tsconfig.json\` a pelo.`
    );
  }

  // Y el outDir por defecto, que es lo que evita que vuelvan a aparecer.
  // El archivo puede venir con BOM (lo escribe PowerShell/VS) y las lineas de
  // comentario son claves JSON entrecomilladas ("//": ...), no comentarios JS:
  // se quita el BOM y se parsea tal cual.
  const cfg = JSON.parse(readFileSync(join(RAIZ, "pruebas/tsconfig.json"), "utf8").replace(/^\uFEFF/, ""));
  if (cfg.compilerOptions && cfg.compilerOptions.outDir) {
    ok(`pruebas/tsconfig.json tiene outDir (${cfg.compilerOptions.outDir})`);
  } else {
    mal("pruebas/tsconfig.json no declara outDir: compilarlo a mano ensucia src/");
  }
}

// -------------------------------------------- el login no puede entrar en bucle ---
// El síntoma era "carga y carga": el login aparecía y se iba solo, sin llegar a
// poder escribir. La causa era un ciclo, no lentitud:
//
//   `onAuthStateChange` dispara INITIAL_SESSION al suscribirse, SIN sesión.
//   -> `inicializar()` resuelve que no hay nadie
//   -> la ruta es de acceso, así que `replace("/dashboard")`
//   -> el dashboard expulsa al login
//   -> el efecto vuelve a correr (depende de `ruta`), se re-suscribe
//   -> INITIAL_SESSION otra vez, y el ciclo se repite
//
// El login tiene que quedarse quieto esperando usuario y contraseña. Estos checks
// fijan las dos mitades: no se redirige sin sesión, y no se re-suscribe en bucle.
{
  const boot = readFileSync(join(RAIZ, "src/components/auth/AuthBootstrap.tsx"), "utf8");
  const login = readFileSync(join(RAIZ, "src/components/auth/PantallaLogin.tsx"), "utf8");
  const store = readFileSync(join(RAIZ, "src/store/useAuthStore.ts"), "utf8");

  // La redirección se tiene que mirar en el store, no en el evento de sesión.
  // Se recorta el handler entero, no desde la línea del `replace`: la guarda
  // va ANTES de él, y mirar solo la línea de abajo no encontraría nada.
  const ini = boot.indexOf("const alCambiar =");
  const handler = boot.slice(ini, boot.indexOf("void (async () => {", ini));
  if (/getState\(\)/.test(handler) && /sembrada/.test(handler)) {
    ok("no se redirige al dashboard sin sesion verificada");
  } else {
    mal("no se redirige al dashboard sin sesion verificada", "sin mirar el store, INITIAL_SESSION manda al dashboard y el ciclo se repite");
  }
  if (/"INITIAL_SESSION"/.test(boot)) ok("INITIAL_SESSION esta contemplado como evento de la sesion");
  else mal("INITIAL_SESSION esta contemplado como evento de la sesion", "es el evento que dispara la suscripcion, el que abria el ciclo");
  if (/desarmado/.test(boot)) ok("la suscripcion se puede desarmar aunque el import siga en vuelo");
  else mal("la suscripcion se puede desarmar aunque el import siga en vuelo", "cada efecto repetido dejaba una suscripcion vieja pidiendo inicializar()");
  if (/MS_CARGA_INICIAL/.test(store) && /Promise\.race/.test(store)) ok("el arranque tiene un corte de tiempo propio");
  else mal("el arranque tiene un corte de tiempo propio", "una promesa colgada no dispara el finally y `inicializada` nunca llega a true");
  if (/carreraCarga/.test(store)) ok("no se apilan arranques: la carga inicial corre una sola vez");
  else mal("no se apilan arranques: la carga inicial corre una sola vez", "AuthBootstrap dispara inicializar() desde dos efectos y en cada evento");

  // Y el formulario NO puede quedar bloqueado por la red: la raiz ya ES el
  // login, asi que tiene que poder escribirse apenas se pinta.
  if (!/disabled=\{cargando \|\| !inicializada\}/.test(login)) {
    ok("el boton de entrar no espera a que termine la carga inicial");
  } else {
    mal("el boton de entrar no espera a que termine la carga inicial", "con la base sin aplicar, `inicializada` tarda y el boton queda muerto");
  }
  if (!/Verificando sesi/.test(login)) ok("el login no muestra un estado 'Verificando sesion' que bloquea el envio");
  else mal("el login no muestra un estado 'Verificando sesion' que bloquea el envio", "sin sesion que mostrar, ese estado solo sirve para parecer cargado");
  if (/usuarioActual\)\s*router\.replace\("\/dashboard"\)/.test(login) && /if \(!inicializada\) return;/.test(login)) {
    ok("el login se dibuja sin depender de que haya sesion");
  } else {
    mal("el login se dibuja sin depender de que haya sesion", "el salto al dashboard se decide despues, no antes de pintar");
  }
}

console.log(`\nTODAS: ${pasan} pasaron, ${fallan} fallaron`);
process.exit(fallan ? 1 : 0);
