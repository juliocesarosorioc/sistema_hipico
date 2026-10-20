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

console.log(`\n${pasan} ok / ${fallan} fallaron`);
if (fallan > 0) process.exitCode = 1;
