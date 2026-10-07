// ============================================================================
// E2E DE DEBUTANTES y DEL SNAPSHOT DE CONFIGURACION.
//
// Va aparte de e2e-marcas.mjs a proposito: ese script tiene una aritmetica de
// saldo encadenada (gana + pierde + reembolso en el mismo cliente) y meterle
// ventas nuevas obliga a recalcularla entera, con lo que un error mio se
// confunde con un error del modulo. Aqui hay su propio cliente sintetico, su
// propia carrera y su propia limpieza, asi que un fallo aqui no puede
// enmascarar ni ser enmascarado por el otro script.
//
// Que prueba:
//
//   1. Con el switch "debutantes valen", el debutante se juega como un caballo
//      normal y el ticket guarda el snapshot.
//   2. Con el switch apagado, vender ese debutante se BLOQUEA, el error dice
//      "debutante" y no "NV", y el saldo del cliente no se mueve ni un peso.
//      Un bloqueo que descuenta saldo seria doble fallo: negocio y caja.
//   3. Editar la configuracion NO altera los tickets ya vendidos: se vende con
//      la config A, se cambia a la config B, se liquida, y el ticket viejo se
//      liquida contra los rivales de A. Un ticket nuevo si usa B.
//
// Si la base todavia no tiene las columnas de debutantes, esto NO se salta en
// silencio: lo dice y sale con codigo 1. La regla "debutantes no valen" no se
// puede comprobar hasta que sql/marcas_venta.sql este aplicado.
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

// Fecha de mentira: nadie juega ese dia, asi que no se pisa ninguna carrera de
// verdad aunque el script se deje a medias.
const HIPO = "__E2E_DEBUTANTES__";
const FECHA = "2026-01-02";
const CARRERA = 1;

const CABALLOS = [
  { numero: "1", nombre: "DEB UNO", retirado: false },
  { numero: "2", nombre: "DEB DOS", retirado: false },
  { numero: "3", nombre: "DEB TRES", retirado: false },
  { numero: "4", nombre: "DEB CUATRO", retirado: false },
  { numero: "5", nombre: "DEB CINCO debutante", retirado: false },
];
/** Configuracion base: el 5 es debutante. El switch lo cambia cada prueba. */
const CFG = { marcas: "1/2/3", nv: "", debutantes: "5", debutantes_valen: true };

const MONTO = 100;
const NOMBRE_CLIENTE = "__E2E_CLIENTE_DEBUTANTES__";
const SALDO_INICIAL = 1000;

let ClientId = null;
let GrupoId = null;
let SaldoInicial = null;
let fallos = 0;
const soloLimpiar = process.argv.includes("--limpiar");

const paso = (t) => console.log(`\n-- ${t}`);
const ok = (t, d = "") => console.log(`   ok    ${t}${d ? "  " + d : ""}`);
const mal = (t, d) => { fallos++; console.log(`   FALLA ${t}\n          ${d}`); };
const assert = (t, cond, d = "") => (cond ? ok(t, d) : mal(t, d || "la condicion no se cumple"));

async function rest(ruta, metodo = "GET", cuerpo) {
  // `resolution=merge-duplicates` NO es opcional en un POST con `on_conflict`.
  // Con solo `return=representation`, PostgREST responde 409 en el segundo
  // INSERT sobre una fila que ya existe: la config de marcas NO se actualiza y
  // el switch `debutantes_valen` se queda en el valor viejo. El sintoma es
  // desconcertante: la venta del debutante "apagado" se acepta porque el switch
  // en realidad nunca se apagó. La app no sufre esto porque usa el SDK
  // (`.upsert()`), que manda el Prefer solo.
  const r = await fetch(`${URL}/rest/v1/${ruta}`, {
    method: metodo,
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

const saldoActual = async () => {
  const s = await rest(`clientes?id=eq.${ClientId}&select=saldo_actual`);
  return Number(s.data?.[0]?.saldo_actual ?? 0);
};

/**
 * Escribe la configuracion de la carrera (insert o update segun exista).
 *
 * `on_conflict=hipodromo,fecha,carrera` nombra las COLUMNAS del indice unico,
 * no el constraint: PostgREST lo traduce a un ON CONFLICT (...) y Postgres lo
 * resuelve contra el indice que las cubre. Escribiendo `on_conflict=
 * marcas_carrera_unica` Postgres lo interpreta como una COLUMNA y responde
 * 'column "marcas_carrera_unica" does not exist'.
 */
async function configurar(c) {
  return rest(`marcas_carrera?on_conflict=hipodromo,fecha,carrera`, "POST", {
    hipodromo: HIPO, fecha: FECHA, carrera: CARRERA, estado: "Abierta", ...c,
  });
}

let idem = 0;
/** Cada venta lleva su propia clave de idempotencia. */
async function vender(caballo, monto = MONTO) {
  idem += 1;
  // Si `ClientId` fuera null, PostgREST buscaria la firma de la funcion SIN
  // `p_cliente_id` y devolveria PGRST202, un error que parece de SQL aplicado
  // cuando en realidad es que no se creo el cliente. No se lanza excepcion: se
  // avisa y se sigue, para que el resumen final de la E2E muestre TODOS los
  // fallos y no solo el primero.
  if (!ClientId) {
    return { status: 0, data: null, txt: "vender() sin ClientId: el cliente sintetico no se creo" };
  }
  return rpc("club_vender_marca", {
    p_hipodromo: HIPO, p_carrera: CARRERA, p_fecha: FECHA,
    p_caballo: caballo, p_monto: monto,
    p_cliente_id: ClientId, p_grupo_id: GrupoId, p_usuario: "e2e",
    p_idem: `deb-${FECHA}-${idem}`,
  });
}

/** El snapshot del ticket: `nota_auditoria` es TEXT con el JSON dentro. */
async function snapshot(ticketId) {
  const t = await rest(`tickets_apuestas?id=eq.${ticketId}&select=nombre_jugada,estado,monto_jugado,monto_decidido,nota_auditoria`);
  const tk = Array.isArray(t.data) ? t.data[0] : null;
  if (!tk) return null;
  let nota = {};
  try { nota = typeof tk.nota_auditoria === "string" ? JSON.parse(tk.nota_auditoria) : tk.nota_auditoria ?? {}; }
  catch { nota = {}; }
  return { ...tk, nota };
}

async function registrarCarrera() {
  return rest(
    `resultados_carreras?hipodromo=eq.${HIPO}&fecha=eq.${FECHA}&carrera=eq.${CARRERA}&select=id`,
    "POST",
    { fecha: FECHA, hipodromo: HIPO, carrera: CARRERA, caballos: CABALLOS, distancia: 1000, premio: 0, hora: "12:00" }
  );
}

async function limpiar() {
  // El filtro va SOLO por hipodromo, no por `nombre_jugada=like.MARCA%`.
  // Ese `like` sin comillas (el valor tiene que ir entre comillas dobles
  // DENTRO del par de comillas simples: `like.*MARCA*`) lo devuelve Cloudflare
  // como una pagina HTML de error con status 200. La comprobacion `status ===
  // 200` lo daba por bueno, los tickets NO se borraban nunca, y el cliente
  // sintetico quedaba referenciado por ellos: el DELETE del cliente devolvia
  // 23503 y la corrida siguiente moria en el POST con 409 por el UNIQUE de
  // `clientes.nombre`. Todo el ruido de "no encuentra la funcion club_vender_
  // marca" (PGRST202) salia de ahi.
  const t = await rest(`tickets_apuestas?hipodromo=eq.${HIPO}&select=id`);
  if (t.status === 200 && Array.isArray(t.data) && t.data.length) {
    const d = await rest(`tickets_apuestas?id=in.(${t.data.map((x) => x.id).join(",")})`, "DELETE");
    if (d.status >= 200 && d.status < 300) ok(`borrados ${t.data.length} ticket(s) de prueba`);
    else mal("no se pudieron borrar los tickets de prueba", `status ${d.status}: ${String(d.txt).slice(0, 180)}`);
  } else if (t.status === 200) {
    ok("no habia tickets de prueba");
  } else {
    mal("no se pudo leer los tickets de prueba", `status ${t.status}: ${String(t.txt).slice(0, 180)}`);
  }
  await rest(`marcas_carrera?hipodromo=eq.${HIPO}&fecha=eq.${FECHA}`, "DELETE");
  await rest(`resultados_carreras?hipodromo=eq.${HIPO}&fecha=eq.${FECHA}`, "DELETE");
  ok("carrera y configuracion sinteticas borradas");

  // El cliente sintetico, AL FINAL y DESPUES de los tickets.
  // `clientes.nombre` es UNIQUE, asi que un cliente que quede de una corrida
  // abortada hace que la siguiente muera con 409 en el POST y no pueda ni
  // empezar. El borrado, en cambio, tiene que ir despues: `tickets_apuestas`
  // tiene FK a `clientes` sin ON DELETE CASCADE, y borrarlos en el otro orden
  // devuelve 23503 y deja el cliente vivo para siempre.
  const cli = await rest(`clientes?nombre=eq.${NOMBRE_CLIENTE}&select=id`);
  if (cli.status === 200 && Array.isArray(cli.data) && cli.data.length) {
    const d = await rest(`clientes?id=in.(${cli.data.map((x) => x.id).join(",")})`, "DELETE");
    if (d.status >= 200 && d.status < 300) {
      ok("cliente sintetico borrado");
    } else {
      // Casi siempre 23503: quedo algun ticket apuntandole.
      mal("no se pudo borrar el cliente sintetico", `status ${d.status}: ${String(d.txt).slice(0, 180)}`);
    }
  }
}

if (soloLimpiar) {
  console.log("\n=== Limpiando restos de E2E de debutantes ===");
  await limpiar();
  console.log("");
  process.exit(0);
}

console.log(`\n=== E2E DEBUTANTES (hipodromo sintetico ${HIPO}, ${FECHA}) ===`);

// ---------------------------------------------------------------------------
// 0) Sin esto no se puede probar nada.
// ---------------------------------------------------------------------------
paso("0) La base tiene la regla de debutantes aplicada");
const probe = await rest(`marcas_carrera?select=debutantes,debutantes_valen&limit=1`);
const sinColumnas = probe.status === 400 || /column .*debutantes.* does not exist/i.test(String(probe.txt));

if (sinColumnas) {
  // No se llama a process.exit(): salir por lo bajo con sockets de fetch
  // abiertos hace que node aborte con un assertion en Windows y el mensaje
  // real se pierde. Se fija `exitCode` y se deja terminar el script.
  console.log(`\n   FALLA la base no tiene las columnas de debutantes\n` +
    `          ${String(probe.txt).slice(0, 200)}\n` +
    `          Ejecuta sql/marcas_venta.sql en el SQL Editor de Supabase.\n`);
  process.exitCode = 1;
} else {
  assert("marcas_carrera expone debutantes y debutantes_valen", probe.status === 200, `status ${probe.status}: ${probe.txt.slice(0, 160)}`);

  const rpcOk = await rpc("club_vender_marca", {
    p_hipodromo: "__SONDA__", p_carrera: 1, p_fecha: "2000-01-01", p_caballo: "1",
    p_monto: 1, p_cliente_id: "00000000-0000-0000-0000-000000000000",
    p_grupo_id: "00000000-0000-0000-0000-000000000000", p_usuario: "sonda", p_idem: "sonda",
  });
  assert("club_vender_marca esta instalada", rpcOk.status !== 404, `status ${rpcOk.status}: ${rpcOk.txt.slice(0, 160)}`);

  // -------------------------------------------------------------------------
  // 1) Cliente sintetico + carrera. Nunca se toca uno de verdad.
  // -------------------------------------------------------------------------
  const cli = await rest(`clientes?select=id,nombre,saldo_actual,grupo_id&limit=500`);
  const todosClientes = Array.isArray(cli.data) ? cli.data : [];
  if (!todosClientes.length) {
    console.log("\n   FALLA no hay clientes en la base, no se puede crear el sintetico\n");
    process.exitCode = 1;
  } else {
    const grupoRef = todosClientes.find((c) => c.grupo_id)?.grupo_id;
    if (!grupoRef) {
      console.log("\n   FALLA ningun cliente tiene grupo_id, la RPC exige un grupo valido\n");
      process.exitCode = 1;
    } else {
      GrupoId = grupoRef;
      // Restos de una corrida anterior. `clientes.nombre` es UNIQUE, asi que sin
      // esta limpieza el POST del cliente da 409 y, como `ClientId` queda null,
      // todo lo demas falla con errores que apuntan a la RPC y no a la causa.
      paso("0b) Limpiando restos de una corrida anterior");
      await limpiar();
      try {
        paso("1) Montaje: cliente sintetico y carrera con 5 ejemplares");
        // `estado`, NO `activo`. En esta base la columna de estado de `clientes`
        // es un texto ("Activo"/"Inactivo"); no hay booleano `activo`, y mandarlo
        // hace que el POST entero rebote con PGRST204. Como el cliente queda en
        // `ClientId = null`, la venta siguiente se llama sin `p_cliente_id` y
        // PostgREST responde PGRST202 ("no encuentro la funcion"), que parece
        // un problema de SQL aplicado y en realidad es este insert.
        const nuevo = await rest("clientes?select=*", "POST", {
          nombre: NOMBRE_CLIENTE, saldo_actual: SALDO_INICIAL, grupo_id: GrupoId, estado: "Activo",
        });
        // Con `Prefer: return=representation` el POST devuelve el array de la
        // fila insertada, no un objeto. Sin el `[0]`, `ClientId` queda
        // `undefined` y todo lo de abajo falla con errores que apuntan a otro
        // sitio (PGRST202 en la venta, saldo 0, "no tiene configuracion").
        ClientId = nuevo.data?.[0]?.id ?? null;
        assert("cliente sintetico creado", nuevo.status === 201 && !!ClientId, `status ${nuevo.status}: ${String(nuevo.txt).slice(0, 160)}`);
        SaldoInicial = await saldoActual();
        assert(`el cliente arranca con $${SALDO_INICIAL}`, Math.abs(SaldoInicial - SALDO_INICIAL) < 0.005, `saldo ${SaldoInicial}`);

        // 409 = la carrera sintetica quedo de una corrida anterior. Se borra y se
        // vuelve a crear, en vez de dar el paso por bueno: si el INSERT no se
        // hiciera, la prueba de los snapshots correria sobre datos viejos.
        let rc = await registrarCarrera();
        if (rc.status === 409) {
          await rest(`resultados_carreras?hipodromo=eq.${HIPO}&fecha=eq.${FECHA}&carrera=eq.${CARRERA}`, "DELETE");
          rc = await registrarCarrera();
        }
        assert("carrera registrada", rc.status === 200 || rc.status === 201, `status ${rc.status}: ${String(rc.txt).slice(0, 160)}`);

        // ---------------------------------------------------------------
        paso("2) Switch ENCENDIDO: el debutante se juega normal y queda en el snapshot");
        // ---------------------------------------------------------------
        await configurar(CFG);
        {
          const leida = await rest(`marcas_carrera?hipodromo=eq.${HIPO}&select=debutantes,debutantes_valen`);
          const c = Array.isArray(leida.data) ? leida.data[0] : null;
          assert("la configuracion guarda el debutante", String(c?.debutantes) === "5", JSON.stringify(c));
          assert("el switch queda en true", c?.debutantes_valen === true, JSON.stringify(c?.debutantes_valen));
        }
        let ticketA = null;
        {
          const r = await vender("5");
          assert("la venta del debutante se registro", r.status === 200 && r.data?.ok === true, r.txt.slice(0, 220));
          ticketA = r.data?.ticket_id ?? null;
          assert(
            "juega contra todas las marcas (no esta marcado)",
            JSON.stringify(r.data?.rivales) === JSON.stringify(["1", "2", "3"]),
            JSON.stringify(r.data?.rivales)
          );
          assert("tipo = CONTRA_TODAS", r.data?.tipo === "CONTRA_TODAS", String(r.data?.tipo));
        }
        {
          const s = await snapshot(ticketA);
          assert("el ticket guardo el snapshot de debutantes", String(s?.nota?.debutantes_snapshot) === "5", JSON.stringify(s?.nota));
          assert(
            "y guardo el switch tal como estaba al vender",
            s?.nota?.debutantes_valen_snapshot === true,
            JSON.stringify(s?.nota?.debutantes_valen_snapshot)
          );
          assert(
            "y guardo los rivales contra los que se vendio",
            JSON.stringify(s?.nota?.rivales_snapshot) === JSON.stringify(["1", "2", "3"]),
            JSON.stringify(s?.nota?.rivales_snapshot)
          );
          const saldoTrasVender = await saldoActual();
          assert(
            `el saldo bajo ${MONTO} exactos`,
            Math.abs(saldoTrasVender - (SaldoInicial - MONTO)) < 0.005,
            `saldo ${saldoTrasVender}`
          );
        }

        // ---------------------------------------------------------------
        paso("3) Switch APAGADO: el debutante queda bloqueado como un NV");
        // ---------------------------------------------------------------
        await configurar({ ...CFG, debutantes_valen: false });
        {
          const r = await vender("5");
          // Un bloqueo es un 400 de NEGOCIO, no un 404 (la RPC existe) ni un
          // 500 (error de base). Solo el 400 es la respuesta esperada.
          assert("la venta del debutante se rechaza", r.status === 400, `status ${r.status}: ${r.txt.slice(0, 220)}`);
          assert("no devuelve ticket", !r.data?.ticket_id, JSON.stringify(r.data?.ticket_id));
          const msg = String(r.data?.error ?? r.txt);
          assert("el error dice 'debutante'", /debutante/i.test(msg), `mensaje: ${msg.slice(0, 220)}`);
          assert("y NO lo reporta como un NV pelado", !/es NV \(No Vale\)/i.test(msg), `mensaje: ${msg.slice(0, 220)}`);
          const saldoTrasBloqueo = await saldoActual();
          assert(
            "el saldo NO se movio (un bloqueo no descuenta)",
            Math.abs(saldoTrasBloqueo - (SaldoInicial - MONTO)) < 0.005,
            `saldo ${saldoTrasBloqueo}, esperado ${SaldoInicial - MONTO}`
          );
        }
        {
          // Un NV de verdad, misma carrera y mismo switch, se bloquea con SU
          // propio mensaje. Si los dos casos dieran el mismo texto, el caja no
          // podria saber en que columna tiene que corregir.
          await configurar({ ...CFG, debutantes_valen: false, nv: "4" });
          const rNv = await vender("4");
          assert("un NV de verdad tambien se rechaza", rNv.status === 400, `status ${rNv.status}`);
          const msgNv = String(rNv.data?.error ?? rNv.txt);
          assert("con el mensaje de NV", /es NV/i.test(msgNv), `mensaje: ${msgNv.slice(0, 220)}`);
          assert("y sin decir 'debutante'", !/es debutante/i.test(msgNv), `mensaje: ${msgNv.slice(0, 220)}`);
          await configurar({ ...CFG, debutantes_valen: false });
        }
        {
          // Con el switch apagado el debutante tampoco puede ser RIVAL. Se
          // comprueba jugando un NO marcado, que es el caso que los mide a todos.
          const r4 = await vender("4");
          assert("el no marcado se juega igual", r4.status === 200 && r4.data?.ok === true, r4.txt.slice(0, 200));
          assert(
            "y sus rivales NO incluyen al debutante",
            JSON.stringify(r4.data?.rivales) === JSON.stringify(["1", "2", "3"]),
            JSON.stringify(r4.data?.rivales)
          );
        }

        // ---------------------------------------------------------------
        paso("4) Un debutante que no corre se rechaza al vender");
        // ---------------------------------------------------------------
        {
          // El insert por REST no pasa por la RPC, asi que la fila con un "9"
          // se puede escribir. Lo que tiene que rechazar es la VENTA: si la
          // aceptara, ese numero caeria en un NV silencioso que nadie ve.
          const r = await configurar({ marcas: "1/2/3", nv: "", debutantes: "9", debutantes_valen: false });
          assert("la fila se escribio (el insert no valida, la venta si)", r.status === 200 || r.status === 201, `status ${r.status}`);
          const v = await vender("9");
          assert("vender un debutante inexistente se rechaza", v.status === 400, `status ${v.status}: ${v.txt.slice(0, 200)}`);
          await configurar({ ...CFG, debutantes_valen: false });
        }

        // ---------------------------------------------------------------
        paso("5) Editar la configuracion NO toca los tickets ya vendidos");
        // ---------------------------------------------------------------
        {
          // ticketA se vendio con switch en true y rivales {1,2,3}. Ahora la
          // configuracion pasa a ser otra (el 5 ya no es debutante). Al
          // liquidar, el ticket viejo TIENE que seguir con sus rivales de
          // siempre: si se recalculara contra la config nueva, cualquier
          // cambio de marcas reescribiria el pasado.
          await configurar({ marcas: "1/2/4", nv: "", debutantes: "", debutantes_valen: true });

          // La liquidacion necesita ORDEN DE LLEGADA: sin el, la RPC no puede
          // saber en que puesto salio cada caballo. Se registra aqui y no antes
          // porque hasta este punto la prueba solo necesita vender.
          {
            const llegada = await rpc("club_registrar_orden_llegada", {
              p_hipodromo: HIPO, p_carrera: CARRERA, p_fecha: FECHA,
              p_orden: [
                { numero: "1", puesto: 1 }, { numero: "2", puesto: 2 },
                { numero: "3", puesto: 3 }, { numero: "4", puesto: 4 },
                { numero: "5", puesto: 5 },
              ],
            });
            assert("orden de llegada cargado", llegada.status === 200, `status ${llegada.status}: ${llegada.txt.slice(0, 200)}`);
          }

          const liq = await rpc("club_liquidar_marca", {
            p_hipodromo: HIPO, p_carrera: CARRERA, p_fecha: FECHA,
          });
          assert("la liquidacion corre", liq.status === 200 && liq.data?.ok === true, liq.txt.slice(0, 220));
          const s = await snapshot(ticketA);
          assert(
            "el ticket viejo conservo sus rivales del momento de la venta",
            JSON.stringify(s?.nota?.rivales_snapshot) === JSON.stringify(["1", "2", "3"]),
            JSON.stringify(s?.nota?.rivales_snapshot)
          );
          assert(
            "y su snapshot de debutantes tambien quedo congelado",
            String(s?.nota?.debutantes_snapshot) === "5",
            JSON.stringify(s?.nota?.debutantes_snapshot)
          );
          // El 5 salio 5to, asi que la jugada pierde: la RPC lo deja en
          // "Perdedor", no en "Liquidado". Lo que importa es que ya NO este
          // "Pendiente": si la liquidacion no lo hubiera tocado, la fila
          // seguiria pendiente de pagar.
          assert(
            "el ticket viejo quedo liquidado (perdedor, no pendiente)",
            String(s?.estado) === "Perdedor" || String(s?.estado) === "Liquidado",
            `estado ${s?.estado}`
          );
        }
        {
          // Y una venta nueva, con la config de ahora, SI toma la configuracion
          // vigente. Si tomara la vieja, cambiar la config no serviria de nada.
          await configurar({ marcas: "1/2/3", nv: "", debutantes: "4", debutantes_valen: true });
          const r = await vender("2");
          assert("una venta nueva si usa la configuracion nueva", r.status === 200 && r.data?.ok === true, r.txt.slice(0, 200));
          const s = await snapshot(r.data?.ticket_id);
          assert("su snapshot trae el debutante nuevo", String(s?.nota?.debutantes_snapshot) === "4", JSON.stringify(s?.nota?.debutantes_snapshot));
          assert("y las marcas nuevas", String(s?.nota?.marcas_snapshot) === "1/2/3", JSON.stringify(s?.nota?.marcas_snapshot));
        }
      } finally {
        // El saldo SIEMPRE vuelve, aun si una comprobacion de arriba lanzo.
        paso("Devolviendo el saldo");
        if (ClientId) {
          await rest(`clientes?id=eq.${ClientId}`, "PATCH", { saldo_actual: SALDO_INICIAL });
          const s = await saldoActual();
          if (Math.abs(s - SALDO_INICIAL) < 0.005) ok(`saldo restaurado a $${s}`);
          else mal("no se pudo restaurar el saldo", `quedo en ${s}, esperado ${SALDO_INICIAL}`);
        }
        await limpiar();
        if (ClientId) {
          await rest(`clientes?id=eq.${ClientId}`, "DELETE");
          ok("cliente sintetico borrado");
        }
      }
    }
  }
}

if (fallos) console.log(`\nE2E DEBUTANTES: ${fallos} FALLA(S)\n`);
else if (!sinColumnas) console.log("\nE2E DEBUTANTES: OK\n");

// No se fuerza el codigo con process.exit: se deja que node termine solo. Asi
// los sockets de Supabase cierran limpios en vez de provoca un assertion.
if (fallos) process.exitCode = 1;
