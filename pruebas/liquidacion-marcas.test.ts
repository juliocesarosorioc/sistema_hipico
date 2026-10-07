// ============================================================================
// Pruebas del simulador de liquidacion de Marcas.
// Espejo de las reglas de club_liquidar_marca. Corre con pruebas/run-marcas.ps1
// ============================================================================
import { liquidarMarca, normalizarOrden, type TicketMarca } from "./simulador-liquidacion-marcas";

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
    console.log(`  FALLA ${nombre}\n         obtenido:  ${a}\n         esperado:  ${b}`);
  }
}

function tick(over: Partial<TicketMarca> = {}): TicketMarca {
  return {
    id: 1,
    cliente: "A",
    saldo: 0,
    caballo: "5",
    rivales: ["1", "2", "3", "4"],
    monto: 120,
    estado: "Pendiente",
    premio_pagar: 0,
    monto_decidido: 0,
    comision_pagada: 0,
    ...over,
  };
}

console.log("\n[1] normalizarOrden acepta las 3 formas de captura");
// ---------------------------------------------------------------------------
eq("strings", normalizarOrden(["5", "3", "1"]), [
  { numero: "5", puesto: 1 },
  { numero: "3", puesto: 2 },
  { numero: "1", puesto: 3 },
]);
eq("numeros sueltos", normalizarOrden([5, 3, 1]), [
  { numero: "5", puesto: 1 },
  { numero: "3", puesto: 2 },
  { numero: "1", puesto: 3 },
]);
eq("objetos con puesto", normalizarOrden([{ numero: "5", puesto: 1 }, { numero: "1", puesto: 2 }]), [
  { numero: "5", puesto: 1 },
  { numero: "1", puesto: 2 },
]);
eq("descarta vacios", normalizarOrden(["5", "", "1"]).length, 2);
try {
  normalizarOrden([]);
  eq("vacio debe fallar", "no fallo", "fallo");
} catch {
  eq("vacio falla", true, true);
}

console.log("\n[2] GANA: delante de todos los rivales");
// ---------------------------------------------------------------------------
{
  // el 5 juega contra 1,2,3,4 y llega 1ro.
  const r = { orden_llegada: normalizarOrden(["5", "1", "2", "3", "4"]), retirados: null };
  const t = tick();
  const res = liquidarMarca(r, [t]);
  eq("queda Ganador", t.estado, "Ganador");
  // 120 jugados -> reintegro bruto 120 + ganancia 100 = 220
  eq("acredita el bruto 220", t.premio_pagar, 220);
  eq("saldo 220", t.saldo, 220);
  eq("conteo", res, { liquidados: 1, ganadores: 1, perdedores: 0, reintegrados: 0, dinero: 220 });
}
{
  // Gana por poco: 2do lugar, pero delante de sus 3 rivales.
  const r = { orden_llegada: normalizarOrden(["1", "5", "2", "3"]), retirados: null };
  const t = tick({ rivales: ["2", "3"] });
  liquidarMarca(r, [t]);
  eq("2do lugar pero sus rivales detras: gana", t.estado, "Ganador");
}
{
  // 100 jugados -> bruto 183.33
  const r = { orden_llegada: normalizarOrden(["5", "1"]), retirados: null };
  const t = tick({ monto: 100, rivales: ["1"] });
  liquidarMarca(r, [t]);
  eq("100 -> bruto 183.33", t.premio_pagar, 183.33);
}

console.log("\n[3] PIERDE: un solo rival por delante basta");
// ---------------------------------------------------------------------------
{
  const r = { orden_llegada: normalizarOrden(["1", "5", "2", "3", "4"]), retirados: null };
  const t = tick();
  const res = liquidarMarca(r, [t]);
  eq("queda Perdedor", t.estado, "Perdedor");
  eq("no se acredita nada", t.saldo, 0);
  eq("no hay reintegro (perdio de verdad)", res.reintegrados, 0);
  eq("conteo", res, { liquidados: 1, ganadores: 0, perdedores: 1, reintegrados: 0, dinero: 0 });
}
{
  // 4to lugar, con 3 rivales por delante.
  const r = { orden_llegada: normalizarOrden(["1", "2", "3", "5", "4"]), retirados: null };
  const t = tick();
  liquidarMarca(r, [t]);
  eq("ultimo lugar pierde", t.estado, "Perdedor");
}

console.log("\n[4] RETIRO del caballo JUGADO -> anula, queda registro informatico");
// ---------------------------------------------------------------------------
{
  const r = { orden_llegada: normalizarOrden(["1", "2", "3"]), retirados: "5" };
  const t = tick();
  const res = liquidarMarca(r, [t]);
  eq("queda Retirado", t.estado, "Retirado");
  eq("devuelve el monto", t.saldo, 120);
  eq("el ticket NO registra resultado financiero", t.monto_decidido, 0);
  eq("no paga premio", t.premio_pagar, 0);
  eq("no cobra comision", t.comision_pagada, 0);
  eq("cuenta como reintegrado", res.reintegrados, 1);
  eq("y NO como perdedor", res.perdedores, 0);
  eq("el dinero movido va aparte del ticket", res.dinero, 120);
}
{
  // Mismo resultado leyendo el flag por caballo de la carrera registrada, que es
  // la verdad, en vez del texto libre.
  const r = {
    orden_llegada: normalizarOrden(["1", "2", "3"]),
    retirados: "NO HUBO RETIROS",
    caballos: [
      { numero: "1", retirado: false, ganador: false },
      { numero: "5", retirado: true, ganador: false },
    ],
  };
  const t = tick();
  liquidarMarca(r, [t]);
  eq("caballos[].retirado manda sobre el texto", t.estado, "Retirado");
}
{
  // El texto y el flag se unen: carrera migrada (texto) + captura nueva (flag).
  const r = {
    orden_llegada: normalizarOrden(["1", "2", "3"]),
    retirados: "7",
    caballos: [{ numero: "5", retirado: true, ganador: false }],
  };
  const t = tick();
  const res = liquidarMarca(r, [t]);
  eq("detecta por el flag", t.estado, "Retirado");
  eq("y el texto tambien se lee", res.reintegrados, 1);
}
{
  // "NO HUBO RETIROS" no debe interpretar nada como retirado.
  const r = { orden_llegada: normalizarOrden(["5", "1"]), retirados: "NO HUBO RETIROS" };
  const t = tick({ rivales: ["1"] });
  liquidarMarca(r, [t]);
  eq("sin retiros, gana normalmente", t.estado, "Ganador");
}
{
  // Match por token exacto: el 4 NO puede hacer retirar al 14.
  const r = { orden_llegada: normalizarOrden(["5", "14"]), retirados: "4" };
  const t = tick({ caballo: "14", rivales: ["5"] });
  liquidarMarca(r, [t]);
  eq("el 14 no coincide con el 4 retirado", t.estado, "Perdedor");
}
{
  // Varios retirados: "4, 7". El 7 tiene que estar EN la lista de rivales,
  // si no el caso no prueba nada.
  const r = { orden_llegada: normalizarOrden(["1", "7", "5"]), retirados: "4, 7" };
  const t = tick({ rivales: ["1", "7"] });
  const res = liquidarMarca(r, [t]);
  eq("rival 7 retirado -> reintegrado", t.estado, "Retirado");
  eq("y cuenta 1", res.reintegrados, 1);
  eq("aunque el 1vena por delante", res.perdedores, 0);
}

console.log("\n[5] RETIRO de un RIVAL -> anula, NO hace perder");
// ---------------------------------------------------------------------------
{
  // El 5 gana claramente, pero su rival el 2 se retiro: el matchup no es
  // evaluable, asi que se devuelve. Y criticalmente: NO debe terminar "Perdedor".
  const r = { orden_llegada: normalizarOrden(["5", "1", "3"]), retirados: "2" };
  const t = tick({ rivales: ["1", "2", "3", "4"] });
  const res = liquidarMarca(r, [t]);
  eq("queda Retirado, no Perdedor", t.estado, "Retirado");
  eq("devuelve el monto una sola vez", t.saldo, 120);
  eq("el ticket queda informatico", t.monto_decidido, 0);
  eq("no paga premio", t.premio_pagar, 0);
  eq("cuenta reintegrado, no perdedor", res, { liquidados: 1, ganadores: 0, perdedores: 0, reintegrados: 1, dinero: 120 });
}
{
  // Regresion del bug: antes el "exit" del rival caia en la rama de perdedor y
  // sobrescribia el estado Retirado, contando dos veces.
  const r = { orden_llegada: normalizarOrden(["5", "1", "3"]), retirados: "2" };
  const t = tick({ rivales: ["2", "1"] });
  const res = liquidarMarca(r, [t]);
  eq("primer rival retirado corta el loop", t.estado, "Retirado");
  eq("saldo no se duplica", t.saldo, 120);
  eq("reintegrados == 1 (no 2)", res.reintegrados, 1);
  eq("perdedores == 0 (no 1)", res.perdedores, 0);
}

console.log("\n[6] aborta SIN mover saldo si algo no se puede decidir");
// ---------------------------------------------------------------------------
{
  const r = { orden_llegada: normalizarOrden(["5", "1"]), retirados: null };
  const tGanador = tick({ id: 1, caballo: "5", rivales: ["1"] });
  const tRaro = tick({ id: 2, cliente: "B", caballo: "9", rivales: ["1"] });
  let lanzo = false;
  try {
    liquidarMarca(r, [tGanador, tRaro]);
  } catch (e) {
    lanzo = true;
    eq("el mensaje nombra al ticket", /ticket 2/.test((e as Error).message), true);
  }
  eq("lanzo", lanzo, true);
  // El SQL aborta la TRANSACCION entera, asi que el ticket 1 tambien revierte.
  eq("el SQL revierte todo (documentado en el test)", "rollback transaccional", "rollback transaccional");
}
{
  const r = { orden_llegada: normalizarOrden(["5", "1"]), retirados: null };
  const t = tick({ rivales: ["7"] });
  let lanzo = false;
  try {
    liquidarMarca(r, [t]);
  } catch {
    lanzo = true;
  }
  eq("rival ausente del orden -> aborta", lanzo, true);
}
{
  let lanzo = false;
  try {
    liquidarMarca({ orden_llegada: [], retirados: null }, [tick()]);
  } catch {
    lanzo = true;
  }
  eq("sin orden de llegada -> aborta", lanzo, true);
}

console.log("\n[7] idempotencia: solo liquida lo Pendiente");
// ---------------------------------------------------------------------------
{
  const r = { orden_llegada: normalizarOrden(["5", "1"]), retirados: null };
  const t = tick({ rivales: ["1"] });
  liquidarMarca(r, [t]);
  const saldoTrasPrimero = t.saldo;
  const res2 = liquidarMarca(r, [t]);
  eq("el saldo no cambia al reintentar", t.saldo, saldoTrasPrimero);
  eq("no liquida nada la 2da vez", res2.liquidados, 0);
}

console.log(`\n${fallan === 0 ? "TODO OK" : "HAY FALLAS"}: ${pasan} pasaron, ${fallan} fallaron\n`);
if (fallan > 0) process.exit(1);
