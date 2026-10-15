// ============================================================================
// PRUEBA EXTREMO A EXTREMO del modulo Marcas, contra la base real.
//
// Recorre el camino completo con dinero de verdad:
//   registrar carreras -> configurar marcas -> vender -> cargar orden de
//   llegada -> liquidar -> comprobar tickets y saldos -> devolver todo a su
//   estado original
//
// SEGURIDAD
// No toca ninguna carrera real. Se crean DOS carreras SINTETICAS con el
// hipodromo `__E2E_MARCAS__`, que es un valor imposible en un programa, asi que
// no se pisa el resultado ni las marcas de ninguna jornada.
//
// El saldo del cliente se anota antes y se restaura en un `finally`: si la
// prueba revienta a la mitad, o si el proceso muere, el dinero vuelve igual.
// Eso obliga a que los pasos vivan dentro del `try`; por eso la restauracion no
// esta al final del script sino en el `finally`.
//
// Requiere, en este orden:
//   1) sql/marcas_venta.sql        aplicado
//   2) sql/marcas_seed_grupos.sql  aplicado
//
// Uso:  node pruebas/e2e-marcas.mjs [--limpiar]
// ============================================================================
import { readFileSync } from "node:fs";

const env = {};
for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(l);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

const HIPO = "__E2E_MARCAS__";
const FECHA = "2026-01-01";   // fecha de mentira: nadie juega ese dia

// ---------------------------------------------------------------------------
// DOS carreras, porque "gana" y "se anula" son incompatibles en la misma.
//
// Si el caballo 2 se retirara con marcas 1/2/3, TODAS las jugadas de esa
// carrera se anularian: el 3 juega contra {1,2} y el 4 (no marcado) contra
// {1,2,3}, y en los dos casos el 2 es rival suyo. En un solo resultado no se
// puede ver un ganador y un reembolso a la vez, porque `club_liquidar_marca`
// devuelve el stake en cuanto un rival deja de ser comparable.
//
//   C1  sin retiros  -> el 3 gana y el 4 pierde
//   C2  con retiro    -> el 3 se anula por rival retirado y el 2 por retirado
// ---------------------------------------------------------------------------
const C1 = 1;
const C2 = 2;
const CABALLOS = [
  { numero: "1", nombre: "E2E UNO", retirado: false },
  { numero: "2", nombre: "E2E DOS", retirado: false },
  { numero: "3", nombre: "E2E TRES", retirado: false },
  { numero: "4", nombre: "E2E CUATRO", retirado: false },
];
const MARCAS = "1/2/3";   // orden jerarquico: el 3 juega contra 1 y 2
const RETIRADO = "2";      // en la C2 se retira el 2

// Montos separados para que el saldo final se pueda leer a mano:
//   C1: -120 (3, gana) -60 (4, pierde) +220 bruto = +40
//   C2: -30 (3, rival retirado) +30 -20 (2, retirado) +20 = 0 neto
const MONTO_GANA = 120;
const MONTO_PIERDE = 60;
const MONTO_RIVAL_RETIRADO = 30;
const MONTO_CABALLO_RETIRADO = 20;
const NOMBRE_CLIENTE_E2E = "__E2E_CLIENTE_MARCAS__";
// C2 no mueve el saldo: un reembolso es neutro, se descuenta el stake y se
// devuelve el MISMO monto. Sumar `+MONTO_RIVAL_RETIRADO + MONTO_CABALLO_RETIRADO`
// sin restar los stakes inflaba la expectativa en 50.
const NETO_ESPERADO = -MONTO_GANA - MONTO_PIERDE + 220;

let ClientId = null;
let GrupoId = null;
let SaldoInicial = null;
let ClienteEsSintetico = false;
let ticketIds = [];
let fallos = 0;
const soloLimpiar = process.argv.includes("--limpiar");

const paso = (t) => console.log(`\n── ${t}`);
const ok = (t, d = "") => console.log(`   ok    ${t}${d ? "  " + d : ""}`);
const mal = (t, d) => { fallos++; console.log(`   FALLA ${t}\n          ${d}`); };
const assert = (t, cond, d = "") => (cond ? ok(t, d) : mal(t, d || "la condicion no se cumple"));

async function rest(ruta, metodo = "GET", cuerpo) {
  const r = await fetch(`${URL}/rest/v1/${ruta}`, {
    method: metodo,
    // `resolution=merge-duplicates` va siempre: sin el, un POST con `on_conflict`
  // sobre una fila existente responde 409 y NO actualiza nada. Como el 409 se
  // parece a un conflicto legitimo, el script lo tomaba por un rechazo de
  // negocio y la prueba pasaba sin comprobar lo que de verdad importa.
  headers: { ...H, Prefer: "resolution=merge-duplicates,return=representation" },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  return { status: r.status, data, txt };
}
async function rpc(nombre, cuerpo) {
  const r = await fetch(`${URL}/rest/v1/rpc/${nombre}`, {
    method: "POST", headers: H, body: JSON.stringify(cuerpo),
  });
  let data = null;
  try { data = await r.json(); } catch { data = null; }
  return { status: r.status, data, txt: JSON.stringify(data) };
}

const dinero = (n) => `$${Number(n ?? 0).toFixed(2)}`;

/** Registra una de las dos carreras sinteticas. */
async function registrarCarrera(n) {
  return rest(
    `resultados_carreras?hipodromo=eq.${HIPO}&fecha=eq.${FECHA}&carrera=eq.${n}&select=id`,
    "POST",
    {
      fecha: FECHA, hipodromo: HIPO, carrera: n,
      caballos: CABALLOS,
      distancia: 1000, superficie: "ARENA", premio: 0, hora: "12:00",
    }
  );
}

/** Vende una jugada y registra el ticket para las comprobaciones finales. */
async function vender(carrera, caballo, monto, p_idem) {
  const r = await rpc("club_vender_marca", {
    p_hipodromo: HIPO, p_carrera: carrera, p_fecha: FECHA,
    p_caballo: caballo, p_monto: monto,
    p_cliente_id: ClientId, p_grupo_id: GrupoId, p_usuario: "e2e",
    ...(p_idem ? { p_idem } : {}),
  });
  if (r.data?.ticket_id && !ticketIds.includes(r.data.ticket_id)) ticketIds.push(r.data.ticket_id);
  return r;
}

const saldoActual = async () => {
  const s = await rest(`clientes?id=eq.${ClientId}&select=saldo_actual`);
  return Number(s.data?.[0]?.saldo_actual ?? 0);
};

// ===========================================================================
// Limpieza (idempotente: se puede repetir)
// ===========================================================================
async function limpiar() {
  const t = await rest(`tickets_apuestas?hipodromo=eq.${HIPO}&select=id`);
  if (t.status === 200 && Array.isArray(t.data) && t.data.length) {
    await rest(`tickets_apuestas?id=in.(${t.data.map((x) => x.id).join(",")})`, "DELETE");
    ok(`borrados ${t.data.length} ticket(s) de prueba`);
  } else ok("no habia tickets de prueba");
  for (const c of [C1, C2]) {
    await rest(`marcas_carrera?hipodromo=eq.${HIPO}&fecha=eq.${FECHA}&carrera=eq.${c}`, "DELETE");
    await rest(`resultados_carreras?hipodromo=eq.${HIPO}&fecha=eq.${FECHA}&carrera=eq.${c}`, "DELETE");
  }
  ok("carreras sinteticas y configuraciones de prueba borradas");
}

if (soloLimpiar) {
  paso("Limpiando restos de pruebas anteriores");
  await limpiar();
  console.log("\n  AVISO: --limpiar borra tickets y carreras, pero NO puede devolver\n" +
    "  el saldo: si una corrida anterior murio antes de restaurar, el cliente\n" +
    "  quedo descuadrado. Para eso esta el `finally` de este script.\n");
  process.exit(0);
}

console.log(`\n=== E2E MARCAS (hipodromo sintetico ${HIPO}, ${FECHA}) ===`);

// ---------------------------------------------------------------------------
paso("0) Sin esto no se puede probar nada");
// ---------------------------------------------------------------------------
// Se juntean TODAS las carencias en vez de salir en la primera: asi una sola
// corrida dice que falta aplicar, en vez de ir descubriendolo de tres en tres.
const falta = [];
// Cosas que no rompen la prueba pero que hay que saber: la app tiene mas de un
// camino para leer lo mismo, y basta con que uno funcione.
const avisos = [];

// OJO: llamar con `{}` NO sirve para saber si la funcion existe. PostgREST
// devuelve 404 tambien cuando la funcion esta bien pero le faltan argumentos
// (PGRST202 "no encuentro la funcion con esa firma"). Hay que llamar con todos
// los argumentos bien tipados: si la funcion existe, la respuesta es un 400 de
// negocio ("la carrera X no tiene configuracion"), no un 404.
const ZERO = "00000000-0000-0000-0000-000000000000";
const SONDA_RPC = {
  club_vender_marca: {
    p_hipodromo: "__SONDA__", p_carrera: 1, p_fecha: "2000-01-01", p_caballo: "1",
    p_monto: 1, p_cliente_id: ZERO, p_grupo_id: ZERO, p_usuario: "sonda", p_idem: "sonda",
  },
  club_registrar_orden_llegada: {
    p_hipodromo: "__SONDA__", p_carrera: 1, p_fecha: "2000-01-01", p_orden: [1], p_retirados: null, p_usuario: "sonda",
  },
  club_liquidar_marca: { p_hipodromo: "__SONDA__", p_carrera: 1, p_fecha: "2000-01-01" },
};
for (const [n, args] of Object.entries(SONDA_RPC)) {
  const r = await rpc(n, args);
  if (r.status === 404) falta.push(`RPC ${n}`);
}
const cfg = await rest(`marcas_carrera?select=*&limit=1`);
if (cfg.status === 404) falta.push("tabla marcas_carrera");

// Un cliente de verdad en un grupo de verdad: la cascada Grupo -> Cliente.
//
// `grupos_venta` se lee en el desplegable de grupo del modal de venta. Con RLS
// activo y sin policy, Postgres NO da error: filtra y responde 200 con []. O sea
// que el `catch` de la app no se dispara y el desplegable sale vacio en
// silencio. Por eso se comprueban los DOS caminos que tiene la app:
//
//   SELECT directo -> 0 filas  => la app cae al RPC `club_listar_grupos`
//   ambos vacios               => el desplegable esta roto de verdad
const gDirecto = await rest("grupos_venta?select=id,nombre,activo&limit=100");
const nDirecto = Array.isArray(gDirecto.data) ? gDirecto.data.length : 0;
const gRpc = await rpc("club_listar_grupos");
const nRpc = Array.isArray(gRpc.data) ? gRpc.data.length : 0;
if (!nDirecto && !nRpc) {
  falta.push("grupos_venta (ni por SELECT ni por el RPC club_listar_grupos) -> el desplegable de grupo sale vacio");
} else if (!nDirecto) {
  avisos.push(
    "grupos_venta no es legible por SELECT con anon (0 filas), se esta usando el RPC club_listar_grupos. " +
      "La app funciona, pero conviene aplicar sql/grupos_venta_lectura.sql"
  );
}

let cliente = null;
const cli = await rest("clientes?select=id,nombre,saldo_actual,grupo_id&limit=500");
const todosClientes = Array.isArray(cli.data) ? cli.data : [];
if (!todosClientes.length) {
  falta.push("clientes (de ahi se saca el grupo de venta)");
} else {
  // Cliente SINTETICO, con saldo. No se usa uno real porque en esta base los 16
  // clientes estan en 0 o negativo, y aparte tocarle el saldo a un cliente de
  // verdad durante la prueba es justo lo que hay que evitar. Este se crea, se
  // usa y se borra al final.
  //
  // El grupo se toma de cualquier cliente existente: hace falta un uuid de
  // grupo valido para la RPC y `clientes.grupo_id` es legible sin depender de
  // las policies de `grupos_venta`.
  const grupoRef = todosClientes.find((c) => c.grupo_id)?.grupo_id;
  if (!grupoRef) {
    falta.push(
      `clientes con grupo asignado: hay ${todosClientes.length} y ninguno tiene grupo_id (aplica sql/marcas_seed_grupos.sql)`
    );
  } else {
    // Una corrida anterior pudo morir antes del `finally` y dejar el cliente
    // a medias. `clientes.nombre` es unico, asi que sin esta limpieza el
    // INSERT rebota con 23505 y la prueba no arranca.
    const sobras = await rest(`clientes?nombre=eq.${NOMBRE_CLIENTE_E2E}&select=id`);
    if ((sobras.data ?? []).length) {
      const b = await rest(`clientes?nombre=eq.${NOMBRE_CLIENTE_E2E}`, "DELETE");
      console.log(
        `   (limpiado un cliente de prueba que habia quedado de una corrida previa: ${(sobras.data ?? []).length}, delete status ${b.status})`
      );
    }

    const creado = await rest("clientes", "POST", {
      nombre: NOMBRE_CLIENTE_E2E,
      saldo_actual: 10000,
      grupo_id: grupoRef,
      seudonimo: "e2e-marcas",
    });
    if (creado.status >= 400 || !creado.data?.[0]?.id) {
      falta.push(
        `crear el cliente de prueba (anon no puede insertar en clientes): status ${creado.status} ${JSON.stringify(creado.data ?? creado.text ?? "").slice(0, 120)}`
      );
    } else {
      cliente = creado.data[0];
      ClientId = cliente.id;
      ClienteEsSintetico = true;
      GrupoId = grupoRef;
      SaldoInicial = Number(cliente.saldo_actual ?? 0);
      ok(`cliente de prueba: ${cliente.nombre} con saldo ${dinero(SaldoInicial)}`);
      ok(`grupo de venta (sacado de un cliente existente): ${GrupoId}`);
    }
  }
}

if (falta.length) {
  console.log(`\n   FALTA EN LA BASE (${falta.length}):`);
  for (const f of falta) console.log(`     - ${f}`);
  console.log("\n   Aplica, desde el SQL Editor de Supabase:");
  console.log("     1) sql/marcas_venta.sql          (tabla marcas_carrera + las 3 RPC)");
  console.log("     2) sql/marcas_seed_grupos.sql    (grupos y pertenencias)");
  console.log("     3) sql/grupos_venta_lectura.sql  (que anon pueda leer los grupos)");
  console.log("   y vuelve a correr:  node pruebas/e2e-marcas.mjs\n");
  process.exit(2);
}
ok("la tabla marcas_carrera y las tres RPC existen");

if (avisos.length) {
  console.log(`\n   AVISO (${avisos.length}, no bloquea la prueba):`);
  for (const a of avisos) console.log(`     - ${a}`);
  console.log("");
}

await limpiar();

// ===========================================================================
// Todo lo que mueve dinero vive aqui adentro, para que el `finally` de
// abajo restaure el saldo aunque una comprobacion falle o lance.
// ===========================================================================
try {
  // -------------------------------------------------------------------------
  paso("1) Registrar las dos carreras sinteticas");
  // -------------------------------------------------------------------------
  for (const n of [C1, C2]) {
    const r = await registrarCarrera(n);
    assert(
      `carrera ${n} registrada`,
      r.status === 201 || r.status === 200,
      `status ${r.status}: ${String(r.txt).slice(0, 120)}`
    );
  }

  // -------------------------------------------------------------------------
  paso("2) Configurar marcas (el orden es la jerarquia) y abrirlas");
  // -------------------------------------------------------------------------
  for (const n of [C1, C2]) {
    const r = await rest(`marcas_carrera?on_conflict=hipodromo,fecha,carrera`, "POST", {
      hipodromo: HIPO, fecha: FECHA, carrera: n, marcas: MARCAS, nv: "", estado: "Abierta",
    });
    assert(
      `configuracion de la carrera ${n} guardada`,
      r.status === 200 || r.status === 201,
      `status ${r.status}: ${String(r.txt).slice(0, 140)}`
    );
  }
  {
    const leida = await rest(`marcas_carrera?hipodromo=eq.${HIPO}&select=carrera,marcas,estado&order=carrera`);
    assert(
      "se lee igual que se escribio",
      JSON.stringify(leida.data) ===
        JSON.stringify([
          { carrera: C1, marcas: MARCAS, estado: "Abierta" },
          { carrera: C2, marcas: MARCAS, estado: "Abierta" },
        ]),
      JSON.stringify(leida.data)
    );
  }

  // -------------------------------------------------------------------------
  paso("3) C1 sin retiros: el 3 juega contra 1 y 2, el 4 contra todas");
  // -------------------------------------------------------------------------
  {
    const r = await vender(C1, "3", MONTO_GANA);
    assert(
      "la venta del 3 se registro",
      r.status === 200 && r.data?.ok === true,
      `status ${r.status}: ${r.txt.slice(0, 220)}`
    );
    assert(
      "rivales = 1 y 2 (los de su izquierda)",
      JSON.stringify(r.data?.rivales) === JSON.stringify(["1", "2"]),
      JSON.stringify(r.data?.rivales)
    );
    assert("tipo = CONTRA_IZQUIERDA", r.data?.tipo === "CONTRA_IZQUIERDA", String(r.data?.tipo));
    assert(
      "pago bruto = 220 (120 por 100)",
      Number(r.data?.pago_bruto) === 220,
      `pago_bruto ${r.data?.pago_bruto}`
    );
  }
  {
    const r = await vender(C1, "4", MONTO_PIERDE);
    assert("la venta del 4 se registro", r.status === 200 && r.data?.ok === true, r.txt.slice(0, 200));
    assert(
      "rivales = las tres marcas (no marcado => contra todas)",
      JSON.stringify(r.data?.rivales) === JSON.stringify(["1", "2", "3"]),
      JSON.stringify(r.data?.rivales)
    );
    assert("tipo = CONTRA_TODAS", r.data?.tipo === "CONTRA_TODAS", String(r.data?.tipo));
  }
  {
    const saldo = await saldoActual();
    assert(
      `el saldo bajo ${MONTO_GANA + MONTO_PIERDE} exactos`,
      Math.abs(saldo - (SaldoInicial - MONTO_GANA - MONTO_PIERDE)) < 0.005,
      `saldo ${dinero(saldo)}, se esperaba ${dinero(SaldoInicial - MONTO_GANA - MONTO_PIERDE)}`
    );
  }
  {
    const t = await rest(
      `tickets_apuestas?id=eq.${ticketIds[0]}&select=nombre_jugada,estado,monto_jugado,monto_decidido,comision_pagada,nota_auditoria`
    );
    const tk = t.data?.[0];
    // `nota_auditoria` es una columna TEXT con el JSON serializado, no un
    // jsonb: hay que parsearlo. Con `tk.nota_auditoria?.x` sale undefined
    // siempre y la comprobacion falla sin que haya nada roto.
    let nota = {};
    try {
      nota = typeof tk?.nota_auditoria === "string" ? JSON.parse(tk.nota_auditoria) : tk?.nota_auditoria ?? {};
    } catch {
      nota = {};
    }
    assert("nombre_jugada = 'MARCA 3'", tk?.nombre_jugada === "MARCA 3", String(tk?.nombre_jugada));
    assert("estado = Pendiente", tk?.estado === "Pendiente", String(tk?.estado));
    assert(
      "comision_pagada = 0 (el modulo no cobra comision)",
      Number(tk?.comision_pagada) === 0,
      String(tk?.comision_pagada)
    );
    assert(
      "el snapshot guardo a los rivales",
      JSON.stringify(nota?.rivales_snapshot) === JSON.stringify(["1", "2"]),
      JSON.stringify(nota?.rivales_snapshot)
    );
    assert(
      "el snapshot guardo la fecha de carrera",
      String(nota?.fecha_carrera) === FECHA,
      String(nota?.fecha_carrera)
    );
    assert(
      "el snapshot guardo el origen MARCAS",
      nota?.origen === "MARCAS",
      String(nota?.origen)
    );
  }

  // -------------------------------------------------------------------------
  paso("4b) Idempotencia de la VENTA: la misma clave no cobra dos veces");
  // -------------------------------------------------------------------------
  // Esto es lo que garantiza el indice unico `tickets_marcas_idem_unico`: si
  // la caja hace doble clic o reintenta por timeout, la segunda llamada tiene
  // que devolver el MISMO ticket y NO volver a descontar.
  {
    const clave = `e2e-${Date.now()}`;
    const antes = await saldoActual();

    const a = await vender(C1, "2", 40, clave);
    assert("la primera llamada con clave registra la jugada", a.status === 200 && a.data?.ok === true, a.txt.slice(0, 200));

    const medio = await saldoActual();
    assert(
      "  y descuenta una sola vez",
      Math.abs(medio - (antes - 40)) < 0.005,
      `saldo ${dinero(medio)}, se esperaba ${dinero(antes - 40)}`
    );

    // Reintento con la misma clave: la RPC debe reconocerla.
    const b = await rpc("club_vender_marca", {
      p_hipodromo: HIPO, p_carrera: C1, p_fecha: FECHA, p_caballo: "2", p_monto: 40,
      p_cliente_id: ClientId, p_grupo_id: GrupoId, p_usuario: "e2e", p_idem: clave,
    });
    const mismoTicket = b.status === 200 && Number(b.data?.ticket_id) === Number(a.data?.ticket_id);
    assert(
      "el reintento con la misma clave devuelve el mismo ticket",
      mismoTicket,
      `1er ticket ${a.data?.ticket_id}, reintento status ${b.status} ticket ${b.data?.ticket_id}: ${b.txt.slice(0, 160)}`
    );

    const despues = await saldoActual();
    assert(
      "  y NO descuenta una segunda vez",
      Math.abs(despues - medio) < 0.005,
      `saldo ${dinero(despues)}, se esperaba ${dinero(medio)} (sin cambio)`
    );

    // Y solo existe un ticket con esa clave.
    const conClave = await rest(
      `tickets_apuestas?cliente_juega_id=eq.${ClientId}&select=id,estado,monto_jugado`
    );
    const deEsa = (conClave.data ?? []).filter((x) => Number(x.monto_jugado) === 40);
    assert(
      "  y hay un solo ticket con ese monto (no se duplico)",
      deEsa.length === 1,
      `${deEsa.length} tickets de 40: ${deEsa.map((x) => x.id).join(", ")}`
    );

    // Se borra y se devuelve el stake para que los pasos de liquidacion de C1
    // (que asumen exactamente 2 tickets) no tengan que contar con un tercero.
    // La prueba ya cumplio: mismo ticket, un solo descuento.
    const id = a.data?.ticket_id;
    if (id) {
      const d = await rest(`tickets_apuestas?id=eq.${id}`, "DELETE");
      const back = await rest(`clientes?id=eq.${ClientId}`, "PATCH", {
        saldo_actual: Number(antes),
      });
      ticketIds = ticketIds.filter((x) => x !== id);
      const q = await rest(`tickets_apuestas?id=eq.${id}&select=id`);
      assert(
        "  y el ticket de la prueba se devuelve (limpieza)",
        (q.data ?? []).length === 0 && Number(antes) === medio + 40,
        `delete status ${d.status}, patch status ${back.status}, quedan ${(q.data ?? []).length}`
      );
    }
  }

  // -------------------------------------------------------------------------
  paso("4c) La RPC rechaza lo que no tiene sentido");
  // -------------------------------------------------------------------------
  const rechazar = async (cuerpo, etiqueta) => {
    const r = await rpc("club_vender_marca", cuerpo);
    assert(etiqueta, r.status !== 200, `status ${r.status}: ${r.txt.slice(0, 160)}`);
  };
  await rechazar(
    { p_hipodromo: HIPO, p_carrera: C1, p_fecha: FECHA, p_caballo: "1", p_monto: 50, p_cliente_id: ClientId, p_grupo_id: GrupoId },
    "el primer favorito no se puede jugar"
  );
  await rechazar(
    { p_hipodromo: HIPO, p_carrera: C1, p_fecha: FECHA, p_caballo: "9", p_monto: 50, p_cliente_id: ClientId, p_grupo_id: GrupoId },
    "un caballo que no corre no se puede jugar"
  );
  await rechazar(
    { p_hipodromo: HIPO, p_carrera: C1, p_fecha: FECHA, p_caballo: "3", p_monto: 0, p_cliente_id: ClientId, p_grupo_id: GrupoId },
    "un monto de cero no se puede jugar"
  );
  // OJO: aqui NO se prueba que el monto tenga que ser multiplo de 20. Se probo y
  // es una regla que no existe: en el modal el monto es un campo de texto
  // libre (`placeholder="0.00"`), sin lista cerrada de montos. La asercion era
  // mia y estaba inventada.
  {
    // Cliente que no pertenece al grupo enviado: la RPC tiene que rechazarlo.
    //
    // Antes esta asercion omitia `p_grupo_id` a proposito y comprobaba
    // `status !== 200`. Eso pasaba por la razon equivocada: al faltar el
    // parametro, PostgREST no encuentra la FUNCION con esa firma y devuelve 404
    // (PGRST202), o sea que la prueba no ejercitaba nada de la RPC. Ahora se
    // manda un grupo con formato valido pero inexistente: la funcion SI se
    // encuentra y tiene que contestar 400 por regla de negocio.
    const grupoAjeno = "00000000-0000-0000-0000-0000000000e2";
    // Cuantos tickets pendientes hay AHORA. En este punto no es cero: las dos
    // ventas de C1 siguen sin liquidar. Lo que se comprueba es que la llamada
    // rechazada no AGREGUE ninguno, o sea que la cuenta no se mueva.
    const pendAntes = await rest(`tickets_apuestas?cliente_juega_id=eq.${ClientId}&estado=eq.Pendiente&select=id`);
    const nAntes = (pendAntes.data ?? []).length;
    const saldoAntes = await saldoActual();

    const r = await rpc("club_vender_marca", {
      p_hipodromo: HIPO, p_carrera: C1, p_fecha: FECHA, p_caballo: "3",
      p_monto: 50, p_cliente_id: ClientId, p_grupo_id: grupoAjeno, p_usuario: "e2e",
    });
    assert(
      "no se puede vender con un grupo del que el cliente no es miembro",
      r.status === 400 && /grupo/i.test(r.txt),
      `status ${r.status} (se esperaba 400 de negocio, no 404 de firma): ${r.txt.slice(0, 200)}`
    );
    const pendDespues = await rest(`tickets_apuestas?cliente_juega_id=eq.${ClientId}&estado=eq.Pendiente&select=id`);
    assert(
      "  y no creo ningun ticket",
      (pendDespues.data ?? []).length === nAntes,
      `pendientes antes ${nAntes}, despues ${(pendDespues.data ?? []).length}`
    );
    assert(
      "  y no toco el saldo",
      Math.abs((await saldoActual()) - saldoAntes) < 0.005,
      `saldo antes ${dinero(saldoAntes)}, despues ${dinero(await saldoActual())}`
    );
  }
  {
    const r = await rpc("club_liquidar_marca", { p_hipodromo: HIPO, p_carrera: C1, p_fecha: FECHA });
    assert("sin orden de llegada no se liquida", r.status !== 200, r.txt.slice(0, 160));
  }

  // -------------------------------------------------------------------------
  paso("5) C1: orden de llegada sin retiros -> gana el 3, pierde el 4");
  // -------------------------------------------------------------------------
  const ORDEN_C1 = [{ numero: "3", puesto: 1 }, { numero: "1", puesto: 2 }, { numero: "4", puesto: 3 }, { numero: "2", puesto: 4 }];
  {
    const r = await rpc("club_registrar_orden_llegada", {
      p_hipodromo: HIPO, p_carrera: C1, p_fecha: FECHA,
      p_orden: ORDEN_C1, p_retirados: "", p_usuario: "e2e",
    });
    assert("el orden se registro", r.status === 200 && r.data?.ok === true, r.txt.slice(0, 200));
    assert(
      "llego ordenado y con(retirados) vacio",
      JSON.stringify(r.data?.orden) === JSON.stringify(ORDEN_C1) &&
        JSON.stringify(r.data?.retirados) === JSON.stringify([]),
      `${JSON.stringify(r.data?.orden)} / ${JSON.stringify(r.data?.retirados)}`
    );
  }
  {
    const rc = await rest(`resultados_carreras?hipodromo=eq.${HIPO}&carrera=eq.${C1}&select=caballos`);
    const cab = rc.data?.[0]?.caballos ?? [];
    assert("el ganador quedo marcado", cab.find((c) => c.numero === "3")?.ganador === true);
    assert("el retirado NO se marco", cab.find((c) => c.numero === "2")?.retirado === false);
  }

  // -------------------------------------------------------------------------
  paso("6) Liquidar C1: 1 ganador, 1 perdedor, ninguno reintegrado");
  // -------------------------------------------------------------------------
  {
    const r = await rpc("club_liquidar_marca", { p_hipodromo: HIPO, p_carrera: C1, p_fecha: FECHA });
    assert("la liquidacion corrio", r.status === 200 && r.data?.ok === true, r.txt.slice(0, 200));
    const l = r.data ?? {};
    assert("2 tickets liquidados", Number(l.liquidados) === 2, `liquidados ${l.liquidados}`);
    assert("1 ganador", Number(l.ganadores) === 1, `ganadores ${l.ganadores}`);
    assert("1 perdedor", Number(l.perdedores) === 1, `perdedores ${l.perdedores}`);
    assert("0 reintegrados", Number(l.reintegrados) === 0, `reintegrados ${l.reintegrados}`);
  }
  {
    const saldo = await saldoActual();
    const esperado = SaldoInicial - MONTO_GANA - MONTO_PIERDE + 220;
    assert(
      "descontadas las dos y acreditado el bruto del ganador",
      Math.abs(saldo - esperado) < 0.005,
      `saldo ${dinero(saldo)}, se esperaba ${dinero(esperado)}`
    );
  }
  {
    const t = await rest(
      `tickets_apuestas?id=in.(${ticketIds.join(",")})&select=caballo,estado,monto_jugado,monto_decidido,premio_pagar,comision_pagada`
    );
    const g = t.data?.find((x) => x.caballo === "3");
    const p = t.data?.find((x) => x.caballo === "4");
    assert("ticket del 3 = Ganador", g?.estado === "Ganador", String(g?.estado));
    assert("  y cobra el bruto 220", Number(g?.premio_pagar) === 220, `premio_pagar ${g?.premio_pagar}`);
    assert("  y monto_decidido = 220", Number(g?.monto_decidido) === 220, `monto_decidido ${g?.monto_decidido}`);
    assert("  y comision 0", Number(g?.comision_pagada) === 0, String(g?.comision_pagada));
    assert("ticket del 4 = Perdedor", p?.estado === "Perdedor", String(p?.estado));
    assert("  y no cobra nada", Number(p?.premio_pagar) === 0, `premio_pagar ${p?.premio_pagar}`);
  }

  // -------------------------------------------------------------------------
  paso("7) C2: se retira el 2 -> se anula por rival retirado y por retirado");
  // -------------------------------------------------------------------------
  {
    // El 3 juega contra {1,2}: el 2 es rival suyo, asi que la jugada no se puede
    // comparar y se devuelve el stake.
    const r = await vender(C2, "3", MONTO_RIVAL_RETIRADO);
    assert("se vendio la jugada del 3", r.status === 200 && r.data?.ok === true, r.txt.slice(0, 200));
    assert(
      "rivales = 1 y 2",
      JSON.stringify(r.data?.rivales) === JSON.stringify(["1", "2"]),
      JSON.stringify(r.data?.rivales)
    );
  }
  {
    // El 2 todavia NO esta retirado: el retiro se registra mas adelante, en el
    // paso 8. Al momento de vender no hay nada que lo impida, y esta bien que
    // se pueda: asi queda un ticket del caballo que se retira, que es
    // justamente el segundo caso de reembolso que hay que probar.
    const r = await rpc("club_vender_marca", {
      p_hipodromo: HIPO, p_carrera: C2, p_fecha: FECHA, p_caballo: "2", p_monto: MONTO_CABALLO_RETIRADO,
      p_cliente_id: ClientId, p_grupo_id: GrupoId, p_usuario: "e2e",
    });
    assert(
      "tambien se puede vender el caballo que se retirara despues",
      r.status === 200 && r.data?.ok === true,
      `status ${r.status}: ${r.txt.slice(0, 160)}`
    );
    if (r.status === 200 && r.data?.ticket_id) ticketIds.push(r.data.ticket_id);
  }
  {
    const saldo = await saldoActual();
    const esperado =
      SaldoInicial - MONTO_GANA - MONTO_PIERDE + 220 - MONTO_RIVAL_RETIRADO - MONTO_CABALLO_RETIRADO;
    assert(
      `descontadas las dos jugadas de C2 (${MONTO_RIVAL_RETIRADO} y ${MONTO_CABALLO_RETIRADO})`,
      Math.abs(saldo - esperado) < 0.005,
      `saldo ${dinero(saldo)}, se esperaba ${dinero(esperado)}`
    );
  }

  // -------------------------------------------------------------------------
  paso("8) Registrar el retiro y liquidar C2: los dos tickets se anulan");
  // -------------------------------------------------------------------------
  {
    const r = await rpc("club_registrar_orden_llegada", {
      p_hipodromo: HIPO, p_carrera: C2, p_fecha: FECHA,
      p_orden: ORDEN_C1, p_retirados: RETIRADO, p_usuario: "e2e",
    });
    assert("el retiro quedo registrado", r.status === 200 && r.data?.ok === true, r.txt.slice(0, 200));
    assert(
      "retirados = [2]",
      JSON.stringify(r.data?.retirados) === JSON.stringify([RETIRADO]),
      JSON.stringify(r.data?.retirados)
    );
  }
  {
    const rc = await rest(`resultados_carreras?hipodromo=eq.${HIPO}&carrera=eq.${C2}&select=caballos`);
    const cab = rc.data?.[0]?.caballos ?? [];
    assert("el retirado quedo marcado en la carrera", cab.find((c) => c.numero === "2")?.retirado === true);
  }
  {
    const r = await rpc("club_liquidar_marca", { p_hipodromo: HIPO, p_carrera: C2, p_fecha: FECHA });
    assert("la liquidacion corrio", r.status === 200 && r.data?.ok === true, r.txt.slice(0, 200));
    const l = r.data ?? {};
    // 2 tickets: el del 3 (se anula porque su RIVAL, el 2, se retiro) y el del
    // 2 (se anula porque el caballo jugado se retiro). Los dos Paths.
    assert("2 tickets liquidados", Number(l.liquidados) === 2, `liquidados ${l.liquidados}`);
    assert("0 ganadores", Number(l.ganadores) === 0, `ganadores ${l.ganadores}`);
    assert("0 perdedores (anulado no es perder)", Number(l.perdedores) === 0, `perdedores ${l.perdedores}`);
    assert("2 reintegrados", Number(l.reintegrados) === 2, `reintegrados ${l.reintegrados}`);
  }
  {
    const t = await rest(
      `tickets_apuestas?hipodromo=eq.${HIPO}&carrera=eq.${C2}&select=caballo,estado,monto_jugado,monto_decidido,premio_pagar,comision_pagada`
    );
    assert("los dos tickets de C2 quedan como registro", (t.data ?? []).length === 2, `${(t.data ?? []).length}`);
    for (const x of t.data ?? []) {
      assert(
        `  ticket del ${x.caballo} = Retirado`,
        x.estado === "Retirado",
        String(x.estado)
      );
      assert(`  y del ${x.caballo} con monto_decidido 0`, Number(x.monto_decidido) === 0, `monto_decidido ${x.monto_decidido}`);
      assert(`  y del ${x.caballo} con premio_pagar 0`, Number(x.premio_pagar) === 0, `premio_pagar ${x.premio_pagar}`);
      assert(`  y del ${x.caballo} con comision 0`, Number(x.comision_pagada) === 0, String(x.comision_pagada));
    }
    const suma = (t.data ?? []).reduce((a, x) => a + Number(x.monto_jugado ?? 0), 0);
    assert(
      "  y se devolvio exactamente el stake de los dos",
      Math.abs(suma - (MONTO_RIVAL_RETIRADO + MONTO_CABALLO_RETIRADO)) < 0.005,
      `stakes ${dinero(suma)}`
    );
  }

  // -------------------------------------------------------------------------
  paso("9) Idempotencia: liquidar dos veces no mueve nada");
  // -------------------------------------------------------------------------
  for (const c of [C1, C2]) {
    const antes = await saldoActual();
    const r = await rpc("club_liquidar_marca", { p_hipodromo: HIPO, p_carrera: c, p_fecha: FECHA });
    const despues = await saldoActual();
    assert(
      `C${c}: la segunda liquidacion no liquida nada`,
      Number(r.data?.liquidados) === 0,
      `liquidados ${r.data?.liquidados}`
    );
    assert(
      `C${c}: ni mueve el saldo`,
      Math.abs(antes - despues) < 0.005,
      `${dinero(antes)} -> ${dinero(despues)}`
    );
  }

  // -------------------------------------------------------------------------
  paso("10) El saldo final cuadra centavo a centavo");
  // -------------------------------------------------------------------------
  {
    const saldo = await saldoActual();
    const esperado = SaldoInicial + NETO_ESPERADO;
    assert(
      "el saldo quedo donde debia",
      Math.abs(saldo - esperado) < 0.005,
      `saldo ${dinero(saldo)}, se esperaba ${dinero(esperado)} (= ${dinero(SaldoInicial)} ${NETO_ESPERADO >= 0 ? "+" : "-"} ${dinero(Math.abs(NETO_ESPERADO))})`
    );
  }
} catch (e) {
  fallos++;
  mal("el script lanzo una excepcion", `${e?.message ?? e}`);
} finally {
  // -------------------------------------------------------------------------
  // El dinero SIEMPRE vuelve, tambien si el proceso esta a punto de morir.
  // -------------------------------------------------------------------------
  paso("Restaurando el saldo (siemn en finally)");
  if (ClientId && SaldoInicial !== null) {
    const s = await rest(`clientes?id=eq.${ClientId}`, "PATCH", { saldo_actual: SaldoInicial });
    const v = await rest(`clientes?id=eq.${ClientId}&select=saldo_actual`);
    const ahora = Number(v.data?.[0]?.saldo_actual ?? -1);
    assert(
      "saldo restaurado al original",
      Math.abs(ahora - SaldoInicial) < 0.005,
      `${dinero(ahora)} (se esperaba ${dinero(SaldoInicial)}, patch status ${s.status})`
    );
  } else {
    console.log("   (no se vendio nada: no hay saldo que restaurar)");
  }
  // OJO: se borran por `cliente_juega_id`, no por la lista `ticketIds`. Las
  // pruebas negativas del paso 4 pueden abrir tickets igual (si la RPC acepta
  // algo que creiamos que rechazaba) y si se limpian solo los de `ticketIds`
  // esos quedan huerfanos, el DELETE del cliente revienta con 409 por la llave
  // foranea y el cliente de prueba se queda en la base para siempre.
  if (ClienteEsSintetico && ClientId) {
    paso("Borrando los tickets y el cliente de prueba");
    const propios = await rest(
      `tickets_apuestas?cliente_juega_id=eq.${ClientId}&select=id,estado,monto_jugado`
    );
    const nT = (propios.data ?? []).length;
    if (nT) {
      const d = await rest(
        `tickets_apuestas?cliente_juega_id=eq.${ClientId}`,
        "DELETE"
      );
      const q = await rest(`tickets_apuestas?cliente_juega_id=eq.${ClientId}&select=id`);
      assert(
        "no quedaron tickets del cliente de prueba",
        (q.data ?? []).length === 0,
        `habia ${nT} (${(propios.data ?? []).map((x) => `${x.id}:${x.estado}:${x.monto_jugado}`).join(", ")}), delete status ${d.status}, quedan ${(q.data ?? []).length}`
      );
    }
    const d2 = await rest(`clientes?id=eq.${ClientId}`, "DELETE");
    const q2 = await rest(`clientes?id=eq.${ClientId}&select=nombre`);
    assert(
      "el cliente de prueba no quedo en la base",
      (q2.data ?? []).length === 0,
      `delete status ${d2.status}, quedan ${(q2.data ?? []).length}`
    );
  } else if (ticketIds.length) {
    await rest(`tickets_apuestas?id=in.(${ticketIds.join(",")})`, "DELETE");
  }
  await limpiar();
}

console.log(
  `\n${fallos === 0 ? "E2E OK" : "E2E CON FALLAS"}: ${
    fallos === 0 ? "todo el dinero y los tickets cuadran" : fallos + " comprobacion(es) fallaron"
  }\n`
);
process.exit(fallos ? 1 : 0);
