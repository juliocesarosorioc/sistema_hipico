// ============================================================================
// VALIDADOR DE PRE-VUELO para sql/marcas_venta.sql
//
// El script nunca ha pasado por PostgreSQL (no hay psql, ni docker, ni
// service_role) y se va a aplicar a mano en el SQL Editor. Si tiene un error,
// se descubre en el peor momento: cuando la caja intenta cobrar.
//
// Esto NO sustituye a ejecutarlo, pero atrapa la clase de fallo que mas duele:
// desbalance de parentesis, `$$` sin cerrar, grants que no corresponden a la
// firma real (Postgres los rechaza y se cae el script ENTERO, no solo la linea),
// tablas inexistentes, `if not found` mal colocado y restos de edicion.
//
// El mismo script se puede pasar a proposito para ver como falla:
//   node pruebas/validar-marcas-ddl.mjs ruta.sql
// ============================================================================
import { readFileSync, readdirSync } from "node:fs";

const ruta = process.argv.find((a) => a.endsWith(".sql")) ?? "sql/marcas_venta.sql";
const sql = readFileSync(ruta, "utf8");
const lineas = sql.split(/\r?\n/);

let pasan = 0;
const fallas = [];

/** Quita comentarios y el contenido de las comillas simples. */
const limpiar = (l) => l.replace(/--.*$/, "").replace(/'(\\.|[^'])*'/g, "''");
const codigo = lineas.map(limpiar);

function ok(n, d = "") { pasan++; console.log(`  ok    ${n}${d ? "  " + d : ""}`); }
function falla(n, d) { fallas.push(`${n}: ${d}`); console.log(`  FALLA ${n}\n        ${d}`); }
function check(n, cond, d = "") { cond ? ok(n, d) : falla(n, d || "condicion falsa"); }

/** Divide por comas de nivel superior (ignora las que estan dentro de parentesis o texto). */
function partirArgs(txt) {
  const salida = [];
  let nivel = 0, actual = "", enTexto = false;
  for (const ch of txt) {
    if (ch === "'") enTexto = !enTexto;
    if (!enTexto) {
      if ("([{".includes(ch)) nivel++;
      if (")]}".includes(ch)) nivel--;
    }
    if (ch === "," && nivel === 0 && !enTexto) { salida.push(actual); actual = ""; continue; }
    actual += ch;
  }
  if (actual.trim()) salida.push(actual);
  return salida.map((s) => s.trim()).filter(Boolean);
}

/** Texto entre la primera '(' y su ')' correspondiente, inclusive. */
function parentesisQueAbre(txt, desde = 0) {
  const i = txt.indexOf("(", desde);
  if (i < 0) return null;
  let nivel = 0, enTexto = false;
  for (let k = i; k < txt.length; k++) {
    const ch = txt[k];
    if (ch === "'") enTexto = !enTexto;
    if (enTexto) continue;
    if (ch === "(") nivel++;
    else if (ch === ")") { nivel--; if (nivel === 0) return txt.slice(i, k + 1); }
  }
  return null;
}

console.log(`\n=== ${ruta} (${lineas.length} lineas) ===`);

// ===========================================================================
console.log("\n[1] Estructura del archivo");
// ===========================================================================
{
  const d = (sql.match(/\$\$/g) || []).length;
  check("los delimitadores $$ estan balanceados", d % 2 === 0, `${d} apariciones`);
}
{
  let b = 0;
  for (const s of codigo) b += (s.match(/\(/g) || []).length - (s.match(/\)/g) || []).length;
  check("sin parentesis desbalanceados en todo el archivo", b === 0, `balance ${b}`);
}
{
  const c = codigo.join(" ").match(/'/g) || [];
  check("comillas simples balanceadas", c.length % 2 === 0, `${c.length} comillas`);
}

// ===========================================================================
console.log("\n[2] Cada funcion esta completa");
// ===========================================================================
/** nombre -> { tipos: string[], inicio, fin, balance } */
const firmas = new Map();
let firmaPendiente = null;

for (const [i, l] of lineas.entries()) {
  if (firmaPendiente === null && /create or replace function\s+public\.(\w+)/i.test(l)) {
    firmaPendiente = { nombre: RegExp.$1, inicio: i, prof: 0, tipos: null };
  }
  if (!firmaPendiente) continue;

  // Cuenta en la MISMA linea en la que arranco la funcion: el `(` de la
  // declaracion cuenta igual que cualquier otro.
  const s = codigo[i];
  firmaPendiente.prof += (s.match(/\(/g) || []).length - (s.match(/\)/g) || []).length;

  if (firmaPendiente.tipos === null) {
    // Cuando se cierra la lista de parametros, se congelan los tipos.
    const cab = parentesisQueAbre(codigo.slice(firmaPendiente.inicio).join("\n"));
    if (cab && firmaPendiente.prof === 0) {
      firmaPendiente.tipos = partirArgs(cab.slice(1, -1)).map((p) => {
        const sinDefault = p.split(/\bdefault\b/i)[0].trim();   // `p_usuario text default null` -> `p_usuario text`
        const partes = sinDefault.split(/\s+/).filter(Boolean);
        const tipo = partes[partes.length - 1];                  // el ultimo token es el tipo
        return tipo.toLowerCase();
      });
    }
  }

  if (/^\s*\$\$\s*;/.test(s)) {
    firmas.set(firmaPendiente.nombre, { ...firmaPendiente, fin: i });
    const n = firmaPendiente.nombre;
    check(`${n}: parentesis balanceados`, firmaPendiente.prof === 0, `linea ${i + 1}, balance ${firmaPendiente.prof}`);
    firmaPendiente = null;
  }
}

// Una funcion abierta al final del archivo significa que falta su `$$;`. La
// paridad de `$$` NO lo detecta (borrar un cierre deja un numero par), asi que
// hace falta mirarlo explicitamente.
if (firmaPendiente) {
  falla(
    `${firmaPendiente.nombre}: el cuerpo no cierra con $$;`,
    `abierto en la linea ${firmaPendiente.inicio + 1} y sin terminador; PostgreSQL aborta el script entero`
  );
}
if (firmas.size === 0) falla("no se encontro ninguna funcion", "el archivo no declara ninguna funcion de Marcas");

for (const [n, f] of firmas) {
  const cuerpo = codigo.slice(f.inicio, f.fin + 1).join("\n");
  check(`${n}: declara language plpgsql`, /language\s+plpgsql/i.test(cuerpo));
  check(`${n}: security definer`, /security\s+definer/i.test(cuerpo), "(las RPC tocan dinero)");
  check(`${n}: fija search_path`, /set\s+search_path\s*=/i.test(cuerpo));
}

// ===========================================================================
console.log("\n[3] Los grants corresponden a las firmas reales");
// ===========================================================================
{
  // Postgres resuelve `grant ... on function f(tipos)` por la firma EXACTA. Un
  // tipo o un numero de argumentos distintos y el grant falla, tumbando el
  // script completo. Es el fallo mas caro y mas invisible de una migracion.
  const grants = [...sql.matchAll(/grant\s+execute\s+on\s+function\s+public\.(\w+)\s*\(([^)]*)\)/gi)];
  check("hay grants para las funciones de Marcas", grants.length > 0, `${grants.length} grants`);

  for (const g of grants) {
    const [, nombre, args] = g;
    const delGrant = partirArgs(args).map((a) => a.toLowerCase().replace(/\s+/g, ""));
    const f = firmas.get(nombre);
    if (!f) { falla(`grant de ${nombre}`, "no hay ninguna funcion declarada con ese nombre"); continue; }
    const iguales = f.tipos.length === delGrant.length && f.tipos.every((t, k) => t === delGrant[k]);
    check(
      `grant de ${nombre} coincide con la declaracion`,
      iguales,
      iguales
        ? `(${delGrant.join(", ")})`
        : `el grant dice (${delGrant.join(", ")}) y la funcion declara (${f.tipos.join(", ")})`
    );
  }
  for (const n of firmas.keys()) {
    if (!grants.some((g) => g[1] === n)) falla(`${n}: sin grant execute`, "anon recibiria 404 al llamarla");
  }
}

// ===========================================================================
console.log("\n[4] Tablas referenciadas");
// ===========================================================================
{
  // Variables plpgsql: se declaran en los bloques `declare`. Un `select ... into
  // v_cfg` NO es una tabla, y contarla como tal llenaba la lista de falsos
  // positivos con v_cfg, v_nv, v_orden...
  const variables = new Set();
  let enDeclare = false;
  for (const s of codigo) {
    if (/^\s*declare\b/i.test(s)) { enDeclare = true; continue; }
    if (enDeclare && /^\s*begin\b/i.test(s)) { enDeclare = false; continue; }
    if (!enDeclare) continue;
    for (const m of s.matchAll(/\b(v_\w+|v\w+)\s+(?:public\.\w+%|text|jsonb|int\b|integer|numeric|boolean|record|date\b|bigint|uuid)/gi)) variables.add(m[1]);
    for (const m of s.matchAll(/\bv\w+\s+public\.\w+%/gi)) variables.add(m[0].split(/\s+/)[0]);
  }

  const VIVAS = new Set([
    "grupos_venta", "clientes", "clientes_grupos", "resultados_carreras",
    "tickets_apuestas", "marcas_dia", "tablas_fijas", "auditoria",
    "pg_proc", "pg_namespace",
  ]);
  const creadas = new Set();
  for (const f of readdirSync("sql").filter((x) => x.endsWith(".sql"))) {
    const t = readFileSync(`sql/${f}`, "utf8");
    for (const m of t.matchAll(/create table\s+(?:if not exists\s+)?(?:public\.)?(\w+)/gi)) creadas.add(m[1]);
  }

  // `from X` / `update X` / `join X`, pero NO si X va seguido de `(` (eso es una
  // funcion: unnest, jsonb_array_elements, regexp_matches) y NO si es variable.
  const usadas = new Set();
  for (const s of codigo) {
    for (const m of s.matchAll(/\b(?:from|update|join|into)\s+(?:public\.)?(\w+)\s*(\()?/gi)) {
      const [, nombre, paren] = m;
      if (paren) continue;                 // funcion, no tabla
      if (variables.has(nombre)) continue; // variable plpgsql
      if (/^(values|dual|set|only)$/i.test(nombre)) continue;
      usadas.add(nombre);
    }
  }
  const desconocidas = [...usadas].filter((t) => !VIVAS.has(t) && !creadas.has(t));
  check(
    "todas las tablas referenciadas existen",
    desconocidas.length === 0,
    desconocidas.length ? "desconocidas: " + desconocidas.join(", ") : `${usadas.size} tablas: ${[...usadas].join(", ")}`
  );
  const creadasAqui = [...sql.matchAll(/create table\s+(?:if not exists\s+)?(?:public\.)?(\w+)/gi)].map((m) => m[1]);
  check("crea marcas_carrera", creadasAqui.includes("marcas_carrera"), creadasAqui.join(", ") || "ninguna");
}

// ===========================================================================
console.log("\n[5] `if not found` solo donde tiene sentido");
// ===========================================================================
{
  // FOUND refleja la ultima sentencia de SQL ejecutada. Si entre el
  // SELECT/UPDATE y el `if not found` hay otra cosa, FOUND ya no vale y la
  // validacion es un adorno que nunca se dispara. La sentencia empieza varias
  // lineas mas arriba, asi que hay que subir hasta su principio.
  const malas = [];
  for (const [i, l] of lineas.entries()) {
    if (!/^\s*if\s+not\s+found/i.test(l)) continue;
    let j = i - 1;
    while (j >= 0 && codigo[j].trim() === "") j--;
    if (j < 0) continue;
    // sube hasta el inicio de la sentencia (la linea anterior que no acaba en ';')
    let ini = j;
    while (ini > 0 && codigo[ini - 1].trim() !== "" && !/;\s*$/.test(codigo[ini - 1])) ini--;
    const stmt = codigo.slice(ini, j + 1).join(" ").trim();
    if (!/^\s*(select|update|delete|insert)\b/i.test(stmt)) {
      malas.push(`linea ${i + 1}: la sentencia empieza en "${stmt.slice(0, 55)}"`);
    }
  }
  check("cada `if not found` sigue a un select/update/delete", malas.length === 0, malas.length ? malas.join(" | ") : "todas bien colocadas");
}

// ===========================================================================
console.log("\n[6] Invariantes de dinero");
// ===========================================================================
{
  const n100 = (sql.match(/\*\s*100\s*\/\s*120/g) || []).length;
  const n220 = (sql.match(/\*\s*220\s*\/\s*120/g) || []).length;
  check("usa la proporcion 100/120 (ganancia neta)", n100 > 0, `${n100} veces`);
  check("usa la proporcion 220/120 (pago bruto)", n220 > 0, `${n220} veces`);

  // Un reembolso debe dejar el ticket en cero y en 'Retirado': es la convencion
  // de club_reembolsar_retirados y lo que permite separar "anulado por retiro"
  // de "perdido" en un reporte.
  const reembolsos = [...sql.matchAll(/set\s+estado\s*=\s*'Retirado'([\s\S]{0,260}?)where\s+id/gi)];
  check("los reembolsos marcan 'Retirado'", reembolsos.length >= 2, `${reembolsos.length} sitios`);
  reembolsos.forEach((r, i) => {
    check(
      `reembolso ${i + 1} deja premio_pagar y monto_decidido en 0`,
      /premio_pagar\s*=\s*0/.test(r[1]) && /monto_decidido\s*=\s*0/.test(r[1])
    );
  });

  const estados = [...new Set([...sql.matchAll(/estado\s*=\s*'([^']+)'/gi)].map((m) => m[1].trim()))];
  const conocidos = new Set(["Pendiente", "Ganador", "Perdedor", "Retirado", "Abierta", "Cerrada"]);
  const raros = estados.filter((e) => !conocidos.has(e));
  check("los estados usados son los que el resto de la app reconoce", raros.length === 0, raros.length ? "raros: " + raros.join(", ") : estados.join(", "));
}

// ===========================================================================
console.log("\n[6b] TOPE DE JUEGO CON AVAL (saldo + aval)");
// ===========================================================================
// El aval es credito negado, NO efectivo: autoriza a jugar por encima del saldo
// y el saldo queda debitado en negativo (la deuda se cobra). El tope de juego
// es `saldo + aval`. Un cliente en mora con aval NO esta bloqueado, y uno en mora
// sin aval no compra. Si el servidor topa distinto que el navegador, el caja
// autoriza de mas (la RPC lo rechaza y se pierde la venta) o topa donde si
// habia credito (no se vende). Por eso la regla se comprueba en los TRES lados.
{
  // --- marcas_venta.sql: v_limite = saldo + aval ---------------------------
  const iCliente = sql.indexOf("v_limite   := v_saldo + v_aval");
  check("club_vender_marca calcula el limite como saldo + aval", iCliente > 0);
  const bloqueCliente = iCliente > 0 ? sql.slice(iCliente, iCliente + 1400) : "";
  check("el limite se compara contra el monto de la jugada", /v_limite\s*<\s*p_monto/.test(bloqueCliente));
  check("el modo 'libre' exime del tope (no solo en el navegador)", /v_modo\s*<>\s*'libre'/.test(bloqueCliente));
  check(
    "el cliente se bloquea con `for update` (dos cajas no se pisan el saldo)",
    /from\s+public\.clientes[\s\S]{0,120}?for\s+update/i.test(sql)
  );

  // --- contabilidad.sql: el aval NO entra al saldo --------------------------
  const ctb = readFileSync("sql/contabilidad.sql", "utf8");
  const iOtorgar = ctb.indexOf("if p_tipo = 'Otorgar Aval'");
  const iPagar = ctb.indexOf("elsif p_tipo = 'Pagar Aval'");
  const iElse = ctb.indexOf("else", iPagar > 0 ? iPagar : 0);
  const iUpdate = ctb.indexOf("update public.clientes", iPagar);
  check("contabilidad.sql maneja 'Otorgar Aval'", iOtorgar > 0 && iPagar > iOtorgar);
  if (iOtorgar > 0 && iPagar > iOtorgar && iElse > iPagar) {
    const otorgar = ctb.slice(iOtorgar, iPagar);
    const pagar = ctb.slice(iPagar, iElse);
    // El bug era sumar al saldo Y al aval: el aval contaba doble como poder de
    // compra y el cliente podia RETIRARLO como si fuera efectivo.
    const sumaSaldo = /v_saldo\s*:=\s*v_saldo\s*\+\s*p_monto/;
    check("'Otorgar Aval' NO suma al saldo (el aval no es dinero retirable)", !sumaSaldo.test(otorgar));
    check("'Otorgar Aval' sube el aval", /v_aval\s*:=\s*v_aval\s*\+\s*p_monto/.test(otorgar));
    check("'Pagar Aval' NO abona el saldo completo (era crear plata de la nada)", !sumaSaldo.test(pagar));
    check("'Pagar Aval' reduce el aval", /v_aval\s*:=\s*v_aval\s*-\s*v_a_aval/.test(pagar));
    check("'Pagar Aval' topa la reducción del aval en lo que hay (piso 0)", /v_a_aval\s*:=\s*least\(v_exceso,\s*v_aval\)/.test(pagar));
    check("'Pagar Aval' cancela primero la deuda del saldo", /v_saldo\s*:=\s*v_saldo\s*\+\s*v_a_deuda/.test(pagar));
    check(
      "'Pagar Aval' no pierde el excedente sobre deuda+aval (entra al saldo)",
      /v_saldo\s*:=\s*v_saldo\s*\+\s*\(v_exceso\s*-\s*v_a_aval\)/.test(pagar)
    );
  }

  // El retiro no puede dejar el saldo en negativo aunque haya aval: si pudiera,
  // el cliente se lleva la garantia en efectivo y la garantia no respalda nada.
  const retiro = ctb.slice(ctb.indexOf("No se permite dejar el saldo en negativo"));
  check("el retiro sigue prohibiendo dejar el saldo en negativo", /if\s+v_saldo\s*<\s*0\s+then/.test(retiro));
  check("el retiro no mira el aval (no es efectivo)", !/saldo_actual[\s\S]{0,200}?aval[\s\S]{0,200}?if\s+v_saldo\s*<\s*0/.test(retiro));

  // --- tablas_venta.sql: el chequeo no puede faltar --------------------------
  const tbl = readFileSync("sql/tablas_venta.sql", "utf8");
  const iLimite = tbl.indexOf("v_limite := coalesce(v_cliente.saldo_actual, 0) + v_aval");
  check("club_vender_tabla calcula el limite como saldo + aval", iLimite > 0);
  if (iLimite > 0) {
    const bloqueT = tbl.slice(iLimite, iLimite + 700);
    check("club_vender_tabla compara el limite contra el monto", /v_limite\s*<\s*p_monto/.test(bloqueT));
    check("club_vender_tabla exime al modo 'libre'", /<>\s*'libre'/.test(bloqueT));
  }
  check(
    "club_vender_tabla bloquea el cliente con `for update`",
    /from\s+public\.clientes\s+where\s+id\s*=\s*p_cliente_id\s+for\s+update/i.test(tbl)
  );
}

{
  // El boton deshabilitado no cubre el reintento por timeout de red: PostgREST
  // reintenta y sin esto el cliente paga dos veces. Se comprueban las TRES
  // piezas, porque con dos de tres el garantia es falsa:
  //   1) la RPC acepta la clave
  //   2) la guarda en el ticket
  //   3) hay un indice unico que serializa la carrera
  check(
    "club_vender_marca acepta p_idem",
    /p_idem\s+text\s+default\s+null/i.test(sql),
    "sin el parametro la caja no puede mandar la clave"
  );
  check(
    "la clave se guarda en nota_auditoria",
    /'idempotencia',\s*v_idem/i.test(sql),
    "sin guardarla el reintento no la encontraria"
  );
  check(
    "hay indice unico sobre la clave",
    /create\s+unique\s+index[\s\S]{0,220}idempotencia/i.test(sql),
    "sin indice, dos llamadas concurrentes con la misma clave pasan el filtro"
  );
  const idx = /create\s+unique\s+index[\s\S]{0,300}?;/i.exec(sql);
  check(
    "el indice es PARCIAL (solo los tickets de Marcas)",
    idx ? /where[\s\S]*idempotencia[\s\S]*is\s+not\s+null/i.test(idx[0]) : false,
    "un indice global colisiona con los tickets que no llevan clave"
  );
  check(
    "el choque de clave se traduce a un mensaje",
    /when\s+unique_violation[\s\S]{0,200}raise\s+exception/i.test(sql),
    "si no, la caja ve un error crudo de unicidad"
  );
  check(
    "se tira la firma anterior de club_vender_marca",
    /drop\s+function\s+if\s+exists\s+public\.club_vender_marca\s*\(\s*text\s*,\s*int\s*,\s*date\s*,\s*text\s*,\s*numeric\s*,\s*uuid\s*,\s*uuid\s*,\s*text\s*,\s*text\s*\)/i.test(sql),
    "al cambiar la firma, la vieja sigue existiendo y confunde al GRANT"
  );
  // La jugada de Marcas es de a UNO: el snapshot lleva un solo rival. Si esto
  // falta, el ticket queda con la lista entera y la liquidacion paga como si
  // el caballo tuviera que ganarle a todos.
  check(
    "la jugada es de a uno: el snapshot guarda UN rival",
    /v_rivales\s*:=\s*array\[\s*v_rival\s*\]/i.test(sql),
    "sin rival unico, el ticket congela un paquete de rivales y no un match"
  );
  check(
    "el rival se revalida contra los legales antes de guardarlo",
    /not\s*\(\s*v_rival\s*=\s*any\s*\(\s*v_candidatos\s*\)\s*\)[\s\S]{0,160}raise\s+exception/i.test(sql),
    "si el navegador elige, tiene que haber un candado: nunca uno de la izquierda contra uno de la derecha"
  );

  // -----------------------------------------------------------------------
  // Expresiones de indice: los DOBLES parentesis son obligatorios.
  //
  // En `create index`, si la columna es una expresion (`col ->> 'k'`,
  // `lower(x)`, `a::int`), tiene que ir envuelta en su propio parentesis. Sin
  // ellos Postgres parsea `col` como la columna del indice, se topa con el
  // operador y aborta TODO el script con:
  //     ERROR 42601: syntax error at or near "->>"
  //
  // Esto ya paso de verdad: el validador, al ser regex, lo daba por bueno.
  // -----------------------------------------------------------------------
  const indices = [...sql.matchAll(/create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?[\w.]+\s+on\s+[\w.]+\s*\(([^;]*?)\)\s*(?:where|;)/gi)];
  check("hay indices que revisar", indices.length > 0, `${indices.length} indices`);
  const SIN_PARENTESIS = indices.filter((m) => {
    const cols = m[1].trim();
    const esExpresion = /->>|<-|->|::|\w\s*\(/.test(cols);
    return esExpresion && !cols.startsWith("(");
  });
  check(
    "las expresiones de indice van con parentesis propios",
    SIN_PARENTESIS.length === 0,
    SIN_PARENTESIS.length
      ? `ERROR 42601 probable: ${SIN_PARENTESIS.map((m) => m[1].trim().slice(0, 60)).join(" | ")}`
      : `${indices.length} indice(s) bien formados`
  );

  // -----------------------------------------------------------------------
  // `nota_auditoria` es TEXT, no jsonb.
  //
  // El snapshot se guarda serializado en una columna de texto, asi que pedirle
  // `->>` a pelo no existe. Postgres responde:
  //     ERROR 42883: operator does not exist: text ->> unknown
  // y hay que castear: `nota_auditoria::jsonb ->> '...'`.
  //
  // Esto ya paso de verdad, en seis sitios a la vez.
  // -----------------------------------------------------------------------
  const SIN_CAST = [];
  for (const [i, linea] of sql.split("\n").entries()) {
    if (/^\s*--/.test(linea)) continue;
    if (/\bnota_auditoria ->/.test(linea)) SIN_CAST.push(`L${i + 1}`);
  }
  check(
    "nota_auditoria se lee siempre como ::jsonb",
    SIN_CAST.length === 0,
    SIN_CAST.length
      ? `ERROR 42883 probable: ${SIN_CAST.length} sitio(s) sin cast -> ${SIN_CAST.join(", ")}`
      : "columna text, casteada en todos los accesos"
  );

  // -----------------------------------------------------------------------
  // `with ordinality` devuelve un RECORD, no un jsonb.
  //
  // `from jsonb_array_elements(p_orden) with ordinality as x(e, ord)` hace que
  // `x` sea una fila de dos columnas. Pedirle `->>` a `x` a pelo da:
  //     ERROR 42883: operator does not exist: record ->> unknown
  // Hay que bajar a la columna del elemento, que aqui se llama `e`.
  // -----------------------------------------------------------------------
  const ALIAS_RECORD = [];
  const alias = new Set();
  for (const linea of sql.split("\n")) {
    const m = linea.match(/with\s+ordinality\s+as\s+(\w+)\s*\(\s*(\w+)\s*,/i);
    if (m) alias.add(m[1]);
  }
  for (const [i, linea] of sql.split("\n").entries()) {
    if (/^\s*--/.test(linea)) continue;
    for (const a of alias) {
      if (new RegExp(`\\b${a}\\s*->`, "i").test(linea)) ALIAS_RECORD.push(`L${i + 1} (${a}.elem)`);
    }
  }
  check(
    "los alias de with ordinality bajan a su columna",
    ALIAS_RECORD.length === 0,
    ALIAS_RECORD.length
      ? `ERROR 42883 probable: ${ALIAS_RECORD.join(", ")}`
      : `${alias.size} alias con ordinality, todos con columna`
  );

  // -----------------------------------------------------------------------
  // Variable de loop que se recorre por campos.
  //
  // `for v_fila in select ... as num ... loop v_fila.num` solo funciona si
  // `v_fila` es `record`. Si es un escalar (jsonb, text, int), Postgres parsea
  // `v_fila.num` como tabla+columna y la funcion revienta al ejecutarse con:
  //     ERROR 42P01: missing FROM-clause entry for table "v_fila"
  // Nota: este NO se ve al crear la funcion, solo al correrla. La E2E lo cazó.
  // -----------------------------------------------------------------------
  const LOOP_ESCALAR = [];
  for (const bloque of sql.split("$$")) {
    const decl = [...bloque.matchAll(/^\s*(\w+)\s+(jsonb|text|int|numeric|boolean|date|uuid)\s*(?::=|;)/gim)];
    for (const [, varName] of decl) {
      const seUsa = new RegExp(
        `for\\s+${varName}\\s+in[\\s\\S]{0,400}?\\n\\s*end loop;`,
        "i"
      ).test(bloque);
      if (!seUsa) continue;
      const porCampo = new RegExp(`\\b${varName}\\s*\\.\\s*\\w`).test(bloque);
      if (porCampo) LOOP_ESCALAR.push(varName);
    }
  }
  check(
    "las variables de loop por campo son record",
    LOOP_ESCALAR.length === 0,
    LOOP_ESCALAR.length
      ? `ERROR 42P01 probable: ${LOOP_ESCALAR.join(", ")} declarada(s) escalar(es) y usadas con .campo`
      : "variables de loop con acceso por campo, todas record"
  );

  // -----------------------------------------------------------------------
  // `ejemplar_numero` es integer, `p_caballo` es text.
  //
  // El numero del caballo se maneja como texto en casi toda la funcion (se
  // compara contra `marcas text[]` y contra el snapshot), pero la columna del
  // ticket es integer. Meter el texto a pelo da:
  //     ERROR 42804: column "ejemplar_numero" is of type integer but
  //     expression is of type text
  // Solo se ve al ejecutar el INSERT, no al crear la funcion.
  // -----------------------------------------------------------------------
  // El bug era `, v_sel, v_sel,`: `caballo` y `ejemplar_numero` recibian el
  // mismo texto a pelo. Con el cast queda `, v_sel, nullif(v_sel, '')::int,`.
  const insertTicket = sql.match(/insert\s+into\s+public\.tickets_apuestas[\s\S]*?values\s*\(([\s\S]*?)\n\s*\)/i);
  const valores = insertTicket ? insertTicket[1] : "";
  const DOS_V_SEL = /,\s*v_sel\s*,\s*v_sel\s*,/.test(valores);
  check(
    "ejemplar_numero se castea a int",
    valores.length > 0 && !DOS_V_SEL,
    DOS_V_SEL
      ? "ERROR 42804 probable: v_sel (text) entra sin castear en la columna integer"
      : valores.length
        ? "columna integer recibe el numero casteado"
        : "no se encontro el INSERT de tickets_apuestas"
  );

  // -----------------------------------------------------------------------
  // El caballo que se juega tiene que correr en la carrera.
  //
  // Se validaba que las MARCAS y los NV esten entre los participantes, pero no
  // `v_sel`. La RPC aceptaba vender el caballo 9 en una carrera con 1-4, y el
  // ticket reventaba despues en la liquidacion con "el caballo 9 no aparece en
  // el orden de llegada". La E2E lo cazó.
  // -----------------------------------------------------------------------
  const validaSeleccion = /not\s*\(\s*v_sel\s*=\s*any\s*\(\s*v_participantes\s*\)/i.test(sql);
  check(
    "el caballo jugado se valida contra los participantes",
    validaSeleccion,
    validaSeleccion
      ? "v_sel se comprueba contra v_participantes"
      : "FALTA la comprobacion: se podria vender un caballo que no corre"
  );
}

// ===========================================================================
console.log("\n[7] Restos de edicion");
// ===========================================================================
{
  const Sospechosos = ["actualizado", "TBD", "FIXME", "asdf", "error de sintaxis", "revisar aqui"];
  const hallados = Sospechosos.filter((s) => sql.toLowerCase().includes(s.toLowerCase()));
  check("sin marcadores de edicion pendiente", hallados.length === 0, hallados.length ? "encontrados: " + hallados.join(", ") : "limpio");
}

// ===========================================================================
console.log("\n[8] Debutantes (mismo comportamiento que el NV)");
// ===========================================================================
// Un debutante que NO vale tiene que comportarse exactamente como un NV: no se
// puede jugar y no cuenta como rival. Estos checks vigilan que la regla este
// implementada de verdad y no solo mentioned en un comentario.
{
  // OJO: la columna hay que buscarla DENTRO del create table, no en el archivo
  // entero. El `alter table ... add column if not exists debutantes text not
  // null default ''` repite el mismo texto, asi que un regex global daba por
  // buena una tabla a la que le faltaba la columna. (Lo encontrar el fault
  // injection.)
  const bloqueTabla = /create table if not exists public\.marcas_carrera\s*\(([\s\S]*?)\n\);/.exec(sql)?.[1] ?? "";
  check("se leyo el bloque create table de marcas_carrera", bloqueTabla.length > 0, "no se encontro el create table");
  check(
    "la tabla declara la columna debutantes",
    /debutantes\s+text\s+not\s+null\s+default\s+''/i.test(bloqueTabla),
    "falta la columna debutantes en el create table"
  );
  check(
    "la tabla declara el switch debutantes_valen",
    /debutantes_valen\s+boolean\s+not\s+null\s+default\s+true/i.test(bloqueTabla),
    "falta la columna debutantes_valen en el create table"
  );
  // La tabla ya existe en la base, asi que el CREATE no sirve: sin el ALTER la
  // columna no se crearia nunca.
  check(
    "hay ALTER TABLE ... add column if not exists para las dos columnas",
    /alter\s+table\s+public\.marcas_carrera\s+add\s+column\s+if\s+not\s+exists\s+debutantes\s+text/i.test(sql) &&
      /alter\s+table\s+public\.marcas_carrera\s+add\s+column\s+if\s+not\s+exists\s+debutantes_valen\s+boolean/i.test(sql),
    "sin esto la columna no existe en una base que ya tiene la tabla"
  );

  check("parsea la lista de debutantes", /into\s+v_debutantes[\s\S]{0,200}coalesce\(v_cfg\.debutantes/i.test(sql));

  // El switch null no puede volverse "no valen": bloquearia en silencio.
  check(
    "el switch se lee con coalesce(..., true), no con un <> directo",
    /coalesce\s*\(\s*v_cfg\.debutantes_valen\s*,\s*true\s*\)/i.test(sql) &&
      !/if\s+v_cfg\.debutantes_valen\s*<>/i.test(sql),
    "un null en el switch no debe interpretarse como 'no valen'"
  );

  check(
    "con el switch apagado los debutantes se suman al NV efectivo",
    /if\s+not\s+v_debutantes_valen\s+then[\s\S]{0,200}unnest\s*\(\s*v_nv\s*\|\|\s*v_debutantes\s*\)/i.test(sql),
    "sin el fold, un debutante marcado 'no vale' seguiria pudiendo jugarse"
  );
  check(
    "el fold va DESPUES de validar los participantes",
    (() => {
      const iPart = sql.search(/if\s+exists\s*\(select 1 from unnest\(v_debutantes\) d where not \(d = any\(v_participantes\)\)\)/i);
      const iFold = sql.search(/from\s+unnest\s*\(\s*v_nv\s*\|\|\s*v_debutantes\s*\)/i);
      return iPart > 0 && iFold > iPart;
    })(),
    "si el fold va antes, un debutante mal escrito se reporta como error de NV"
  );
  check(
    "un debutante con el switch apagado da su propio error, no el de NV",
    /es debutante y la carrera/i.test(sql),
    "el mensaje tiene que decir 'debutante', si no el caja busca el error en la columna NV"
  );
  check(
    "no se puede ser marca y debutante a la vez",
    /esta como marca y como debutante/i.test(sql)
  );
  check(
    "los debutantes se validan aunque el switch este en true",
    /if\s+exists\s*\(select 1 from unnest\(v_debutantes\) d where not \(d = any\(v_participantes\)\)\)/i.test(sql)
  );
  check(
    "el ticket guarda el snapshot de debutantes",
    /'debutantes_snapshot',\s*v_cfg\.debutantes/i.test(sql) && /'debutantes_valen_snapshot',\s*v_debutantes_valen/i.test(sql),
    "sin snapshot no se puede explicar despues por que se bloqueo una jugada"
  );
}

// ===========================================================================
console.log("\n[9] sql/grupos_venta_lectura.sql (lectura de grupos para anon)");
// ===========================================================================
// El modulo de Marcas necesita `grupos_venta` para el desplegable de grupo de la
// venta. Sin esto la app recibe 200 con 0 filas y el modal sale vacio.
{
  const rutaGrupos = ruta.replace(/[^\\/]+$/, "grupos_venta_lectura.sql");
  let g = "";
  try {
    g = readFileSync(rutaGrupos, "utf8");
  } catch {
    g = "";
  }
  const gcode = g.split(/\r?\n/).map(limpiar).join("\n");

  check("el archivo existe y se pudo leer", g.length > 0, g.length ? "" : "falta " + rutaGrupos);

  if (g.length) {
    check("habilita RLS en grupos_venta", /alter\s+table\s+public\.grupos_venta\s+enable\s+row\s+level\s+security/i.test(gcode));
    check("da SELECT a anon", /grant\s+select\s+on\s+public\.grupos_venta\s+to\s+anon/i.test(gcode));
    check(
      "crea policy de lectura para anon",
      /create\s+policy\s+grupos_venta_select[\s\S]*?for\s+select[\s\S]*?to\s+anon[\s\S]*?using\s*\(\s*true\s*\)/i.test(gcode)
    );

    // Lo que este archivo NO debe hacer. Un `using (true)` en un INSERT/UPDATE/
    // DELETE deja que cualquiera con la llave publica modifique los grupos.
    const escrEditable = [
      "grupos_venta_insert", "grupos_venta_update", "grupos_venta_delete",
      "grupos_venta_write", "grupos_venta_todo",
    ];
    check(
      "no abre escritura de grupos_venta a anon",
      !escrEditable.some((n) => new RegExp(`create\\s+policy\\s+${n}`, "i").test(gcode))
    );
    const escritura =
      /grant\s+(insert|update|delete|all)(\s*,\s*(insert|update|delete|all))*\s+on\s+public\.grupos_venta\s+to\s+anon/i.test(gcode);
    check("no otorga INSERT/UPDATE/DELETE a anon", !escritura, escritura ? "encontro un grant de escritura" : "");

    const escrituraCg =
      /grant\s+(insert|update|delete|all)(\s*,\s*(insert|update|delete|all))*\s+on\s+public\.clientes_grupos\s+to\s+anon/i.test(gcode);
    check("no otorga escritura de clientes_grupos a anon", !escrituraCg, escrituraCg ? "encontro un grant de escritura" : "");

    check("envuelto en transaccion", /^\s*begin\s*;/im.test(gcode) && /^\s*commit\s*;/im.test(gcode));
    check("es idempotente (drop policy if exists)", (gcode.match(/drop\s+policy\s+if\s+exists/gi) ?? []).length >= 2);
    // Este se lee del SQL sin limpiar: `limpiar()` vacia el contenido de las
    // comillas simples y dejaria to_regclass('') .
    check("tolera que clientes_grupos no exista", /to_regclass\(\s*'public\.clientes_grupos'\s*\)/i.test(g));
  }

  // El otro lado del arreglo: la app tiene que caer al RPC cuando el SELECT
  // directo vuelve vacio, porque RLS responde 200 con [] y no un error.
  let libs = "";
  try {
    libs = readFileSync("src/lib/grupos.ts", "utf8");
  } catch {
    libs = "";
  }
  check("src/lib/grupos.ts existe", libs.length > 0);
  if (libs) {
    // El SELECT solo se da por bueno con filas (o se lanza para caer al RPC);
    // con lista vacia el flujo sigue hasta el RPC security definer.
    const selectoCondicionado =
      /if\s*\(\s*data\s*&&\s*data\.length\s*\)\s*grupos\s*=\s*data/i.test(libs) ||
      /if\s*\(\s*!\s*grupos\.length\s*\)\s*throw/i.test(libs);
    check(
      "el fallback al RPC se dispara tambien con lista vacia (no solo con error)",
      selectoCondicionado && /rpc\(\s*["']club_listar_grupos["']\s*\)/i.test(libs),
      "sin esto el try/catch nunca se activa y el desplegable sale vacio"
    );
  }
}

// ===========================================================================
console.log(`\n${fallas.length === 0 ? "TODO OK" : "HAY FALLAS"}: ${pasan} ok, ${fallas.length} fallas`);
if (fallas.length) {
  console.log("\nFallas:");
  for (const f of fallas) console.log("  - " + f);
}
console.log("");
process.exit(fallas.length ? 1 : 0);
