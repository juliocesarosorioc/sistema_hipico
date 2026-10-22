// ============================================================================
// BLOQUE 2 — PRE-VISUALIZACIÓN PERMANENTE DE JUGADAS CARGADAS.
//
// El panel debe mostrar SIEMPRE las jugadas de la carrera que ya están en la
// base, no solo las de la sesión:
//   · las persistidas llevan ✅ Validada / Cargada;
//   · las ventas de sesión se fusionan sin duplicarse;
//   · tabla fija / marca / dupleta / remate / polla no entran al panel;
//   · el resultado muestra premio (Ganador) o saldo en contra (Perdedor).
//
// Corre con: node pruebas/correr.cjs
// ============================================================================
import {
  armarFilasPreview,
  esJugadaDeTaquilla,
  estadoLiquidacionDe,
  jugadaSinMonto,
  resumenPreview,
  type JugadaPersistida,
  type TicketSesion,
} from "../src/features/gestion/lib/preview-carrera";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => { pasan++; console.log(`  ok   ${m}`); };
const mal = (m: string, d?: string) => { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };
const si = (c: boolean, m: string, d?: string) => (c ? ok(m) : mal(m, d));
const igual = (a: unknown, b: unknown, m: string) =>
  si(JSON.stringify(a) === JSON.stringify(b), m, `esperado ${JSON.stringify(b)} · recibido ${JSON.stringify(a)}`);

console.log("\nBLOQUE 2 — pre-visualización permanente (núcleo puro)");

// ── 1. Clasificación de jugadas ────────────────────────────────────────────
si(esJugadaDeTaquilla("2P"), "una jugada de puestos es de taquilla");
si(esJugadaDeTaquilla("100 W"), "WPS es de taquilla");
si(!esJugadaDeTaquilla("TABLA FIJA (HIPO C4)"), "la tabla fija no es de taquilla");
si(!esJugadaDeTaquilla("MARCA 8"), "la marca no es de taquilla");
si(!esJugadaDeTaquilla("DUPLETA 3-5"), "la dupleta no es de taquilla");
si(!esJugadaDeTaquilla("REMATE LOTE 1"), "el remate no es de taquilla");
si(!esJugadaDeTaquilla("POLLA 123"), "la polla no es de taquilla");
si(!esJugadaDeTaquilla(""), "una jugada vacía no entra al panel");

igual(jugadaSinMonto("100 2P"), "2P", "se quita el monto del comando");
igual(jugadaSinMonto("2P"), "2P", "un comando sin monto queda igual");

// ── 2. Persistidas: siempre visibles y validadas ───────────────────────────
const persistida = (over: Partial<JugadaPersistida> = {}): JugadaPersistida => ({
  id: "101",
  nombre_jugada: "2P",
  caballo: "7",
  monto_jugado: 100,
  estado: "Pendiente",
  cliente_juega_nombre: "ANA",
  cliente_consigue_nombre: "LUIS",
  ...over,
});

const filasBase = armarFilasPreview([persistida()], []);
igual(filasBase.length, 1, "una jugada persistida se pinta aunque la sesión esté vacía");
si(filasBase[0].validada, "la jugada persistida lleva ✅ Validada");
si(!filasBase[0].soloSesion, "la jugada persistida no es solo de sesión");
igual(filasBase[0].cliente1, "ANA", "conserva el cliente que juega");
igual(filasBase[0].cliente2, "LUIS", "conserva el cliente que da");
igual(filasBase[0].jugada, "2P", "conserva la nomenclatura");

// ── 3. Fusion con la sesión sin duplicar ───────────────────────────────────
const ticketSesion = (over: Partial<TicketSesion> = {}): TicketSesion => ({
  id: "s-1",
  comando: "100 2P",
  monto: 100,
  caballo: "7",
  cliente1: "ANA",
  cliente2: "LUIS",
  ticketId: 101,
  cobro1: 250,
  cobro2: 0,
  gananciaProyectada: 150,
  ...over,
});

const fusion = armarFilasPreview([persistida()], [ticketSesion()]);
igual(fusion.length, 1, "el ticket de sesión que ya está en la base no se duplica");
igual(fusion[0].ticketId, "101", "la fila fusionada conserva el id del ticket");
igual(fusion[0].premioSaldo, 150, "la proyección de la sesión completa la fila pendiente");
si(fusion[0].esPremio, "la proyección positiva se pinta como premio");

const soloSesion = armarFilasPreview([], [ticketSesion({ ticketId: undefined })]);
igual(soloSesion.length, 1, "una venta que aún no se refleja en la base se pinta");
si(!soloSesion[0].validada, "una venta sin ticketId no está validada");
si(soloSesion[0].soloSesion, "se marca como solo de sesión");
igual(soloSesion[0].monto, 100, "conserva el monto");

const ventaConId = armarFilasPreview([], [ticketSesion({ ticketId: 500 })]);
si(ventaConId[0].validada, "una venta de sesión con ticketId ya está validada");

// ── 4. Modalidades especiales fuera del panel ──────────────────────────────
const especiales = armarFilasPreview(
  [
    persistida({ id: "1", nombre_jugada: "TABLA FIJA (HIPO C4)" }),
    persistida({ id: "2", nombre_jugada: "MARCA 8" }),
    persistida({ id: "3", nombre_jugada: "DUPLETA 1-2" }),
    persistida({ id: "4", nombre_jugada: "REMATE LOTE 1" }),
    persistida({ id: "5", nombre_jugada: "POLLA 9" }),
    persistida({ id: "6", nombre_jugada: "2N" }),
  ],
  []
);
igual(especiales.length, 1, "solo la jugada de taquilla entra al panel");
igual(especiales[0].jugada, "2N", "la jugada que queda es la de taquilla");

// ── 5. Resultado: premio vs saldo ──────────────────────────────────────────
const ganador = armarFilasPreview([persistida({ estado: "Ganador", premio_pagar: 320 })], []);
igual(ganador[0].estado, "Ganador", "el estado Ganador se normaliza");
igual(ganador[0].premioSaldo, 320, "el ganador muestra el premio");
si(ganador[0].esPremio, "el premio se pinta en positivo");

const perdedor = armarFilasPreview([persistida({ estado: "Perdedor", premio_pagar: 0 })], []);
igual(perdedor[0].estado, "Perdedor", "el estado Perdedor se normaliza");
igual(perdedor[0].premioSaldo, -100, "el perdedor muestra el saldo en contra");
si(!perdedor[0].esPremio, "el saldo en contra se pinta en negativo");

const retirado = armarFilasPreview([persistida({ estado: "Retirado" })], []);
igual(retirado[0].estado, "Retirado", "el retirado se normaliza");
igual(retirado[0].premioSaldo, 0, "el retirado no suma premio ni saldo");

const anulada = armarFilasPreview([persistida({ anulada: true, estado: "Pendiente" })], []);
igual(anulada[0].estado, "Anulada", "la anulada gana sobre el estado crudo");
si(anulada[0].anulada, "la fila anulada queda marcada");
igual(anulada[0].premioSaldo, 0, "la anulada no proyecta dinero");

const pendienteSinSesion = armarFilasPreview([persistida()], []);
si(!pendienteSinSesion[0].tieneProyeccion, "una pendiente sin sesión no inventa proyección");

// ── 6. Resumen del panel ───────────────────────────────────────────────────
const resumen = resumenPreview(
  armarFilasPreview(
    [persistida({ id: "1", monto_jugado: 100 }), persistida({ id: "2", monto_jugado: 50, estado: "Ganador", premio_pagar: 80 })],
    [ticketSesion({ id: "s-9", ticketId: undefined, monto: 25 })]
  )
);
igual(resumen.jugadas, 3, "el resumen cuenta todas las filas");
igual(resumen.validadas, 2, "el resumen cuenta las validadas");
igual(resumen.soloSesion, 1, "el resumen cuenta las que solo están en sesión");
igual(resumen.monto, 175, "el resumen suma los montos");

// Una ANULADA no suma al monto del panel (capital devuelto), pero sí se cuenta
// como jugada (está en la lista).
const resumenConAnulada = resumenPreview(
  armarFilasPreview(
    [
      persistida({ id: "1", monto_jugado: 100 }),
      persistida({ id: "2", monto_jugado: 999, anulada: true }),
    ],
    []
  )
);
igual(resumenConAnulada.jugadas, 2, "la anulada cuenta como jugada en el panel");
igual(resumenConAnulada.monto, 100, "la anulada NO suma al monto del panel");

// ── 7. Símbolo ✅/✖ y saldo por CADA jugador ───────────────────────────────
// El dueño pidió que, a la derecha de cada nombre, se vea si ese jugador ganó
// (✅) o perdió (✖) y su saldo: lo que ARRIESGA si la carrera no está liquidada,
// o lo que GANÓ/PERDIÓ si ya lo está.
{
  // Carrera PENDIENTE: ambos arriesgan el monto, sin símbolo.
  const pend = armarFilasPreview([persistida()], []);
  igual(pend[0].lado1.estado, "ARRIESGA", "pendiente: el que juega arriesga");
  igual(pend[0].lado2.estado, "ARRIESGA", "pendiente: el que da arriesga");
  igual(pend[0].lado1.monto, 100, "pendiente: arriesga el monto");
  si(!pend[0].lado1.liquidada, "pendiente: el resultado no es definitivo");

  // GANADOR: el que juega gana el NETO (premio bruto − comisión − monto).
  const gan = armarFilasPreview(
    [persistida({ estado: "Ganador", premio_pagar: 320, comision_porcentaje: 10 })],
    []
  );
  igual(gan[0].lado1.estado, "GANO", "ganador: el que juega GANÓ");
  // ganancia bruta = 220 · comisión 10% = 22 · neto = 220 − 22 = 198
  igual(gan[0].lado1.monto, 198, "ganador: gana el neto (bruto − comisión)");
  igual(gan[0].lado1.signo, 1, "ganador: saldo positivo");
  si(gan[0].lado1.liquidada, "ganador: resultado definitivo");
  igual(gan[0].lado2.estado, "PERDIO", "ganador: el que da PERDIÓ");
  igual(gan[0].lado2.monto, 220, "ganador: el que da entrega la ganancia bruta");

  // GANADOR sin premio cargado (break-even): sigue siendo ✅ — antes se pintaba
  // como perdedor "y no se le pagaba al ganador".
  const ganSinPremio = armarFilasPreview([persistida({ estado: "Ganador", premio_pagar: 0 })], []);
  igual(ganSinPremio[0].lado1.estado, "GANO", "ganador sin premio: sigue siendo ganador");
  igual(ganSinPremio[0].lado1.monto, 0, "ganador sin premio: gana 0 (no pierde)");

  // PERDEDOR: el que juega pierde el monto; el que da cobra el monto menos comisión.
  const per = armarFilasPreview(
    [persistida({ estado: "Perdedor", premio_pagar: 0, comision_porcentaje: 10 })],
    []
  );
  igual(per[0].lado1.estado, "PERDIO", "perdedor: el que juega PERDIÓ");
  igual(per[0].lado1.monto, 100, "perdedor: pierde el monto");
  igual(per[0].lado1.signo, -1, "perdedor: saldo en contra");
  igual(per[0].lado2.estado, "GANO", "perdedor: el que da GANÓ");
  igual(per[0].lado2.monto, 90, "perdedor: el que da cobra el monto menos la comisión");

  // ANULADA / RETIRADO: sin símbolo ni saldo.
  const anu = armarFilasPreview([persistida({ anulada: true, estado: "Pendiente" })], []);
  igual(anu[0].lado1.estado, "ANULADA", "anulada: el que juega queda anulado");
  igual(anu[0].lado1.monto, 0, "anulada: no proyecta dinero");
  igual(anu[0].lado2.estado, "ANULADA", "anulada: el que da queda anulado");

  const ret = armarFilasPreview([persistida({ estado: "Retirado" })], []);
  igual(ret[0].lado1.estado, "RETIRADO", "retirado: el que juega queda retirado");

  // Una pendiente con proyección de la sesión NO anticipa ganador/perdedor: la
  // carrera todavía no se liquidó, así que se sigue mostrando el monto en riesgo.
  const proy = armarFilasPreview([persistida({ comision_porcentaje: 10 })], [ticketSesion({ cobro1: 250 })]);
  igual(proy[0].lado1.estado, "ARRIESGA", "pendiente con proyección: NO se anticipa ganador");
  igual(proy[0].lado1.monto, 100, "pendiente con proyección: muestra el monto en riesgo");
  si(!proy[0].lado1.liquidada, "pendiente con proyección: no es definitivo");
}

// ── 8. Columna «Estado»: SOLO Liquidada / Pendiente / Anulada ──────────────
// El panel no debe mostrar Ganador ni Perdedor en la columna de estado: eso se
// refleja en las columnas de cliente (✅/✖ + saldo).
{
  igual(estadoLiquidacionDe("Ganador"), "Liquidada", "un Ganador ya está Liquidada");
  igual(estadoLiquidacionDe("Perdedor"), "Liquidada", "un Perdedor ya está Liquidada");
  igual(estadoLiquidacionDe("Retirado"), "Liquidada", "un Retirado se resolvió: Liquidada");
  igual(estadoLiquidacionDe("Pendiente"), "Pendiente", "una jugada sin decidir está Pendiente");
  igual(estadoLiquidacionDe("Anulada"), "Anulada", "una jugada anulada se muestra Anulada");

  const filas = armarFilasPreview(
    [
      persistida({ id: "1", estado: "Ganador", premio_pagar: 300 }),
      persistida({ id: "2", estado: "Perdedor" }),
      persistida({ id: "3", estado: "Pendiente" }),
      persistida({ id: "4", anulada: true }),
    ],
    []
  );
  igual(filas.map((f) => f.estadoLiquidacion), ["Liquidada", "Liquidada", "Pendiente", "Anulada"],
    "la columna Estado resume el ciclo de vida, nunca ganó/perdió");
  si(!filas.some((f) => /Ganador|Perdedor/.test(f.estadoLiquidacion)), "nunca aparece Ganador/Perdedor en el estado");
}

console.log(`\n${pasan} ok / ${fallan} fallaron`);
if (fallan > 0) process.exitCode = 1;