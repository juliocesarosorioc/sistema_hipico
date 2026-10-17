// ============================================================================
// RESULTADO PRELIMINAR — texto post-carrera SIN balance de dinero.
//
// Protege el contrato de `mensajePreliminarDeCarrera` / `veredictoDeJugada`:
//   · cabecera con la pizarra de llegada (1º-5º),
//   · UNA línea por jugada con el veredicto del MOTOR (✅ GANA / ❌ PIERDE /
//     ⏳ PENDIENTE / 🔁 ANULADA),
//   · NO aparece el balance de dinero (POSITIVOS / NEGATIVOS / "Balance").
//
// Corre con:  node pruebas/correr.cjs   (o npx tsx pruebas/preliminar-resultado.test.ts)
// ============================================================================
import {
  mensajePreliminarDeCarrera,
  veredictoDeJugada,
  type TicketMensaje,
} from "../src/features/taquilla/lib/mensajeResultado";
import type { PizarraCarrera } from "../src/features/liquidacion/lib/liquidacion";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => { pasan++; console.log(`  ok   ${m}`); };
const mal = (m: string, d?: string) => { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };
const si = (c: boolean, m: string, d?: string) => (c ? ok(m) : mal(m, d));

// Pizarra de llegada 7 · 2 · 4 · 1 · 5 (misma del test de relación de resultados).
const PIZARRA: PizarraCarrera = {
  primero: "7",
  segundo: "2",
  tercero: "4",
  cuarto: "1",
  quinto: "5",
  sexto: "",
  septimo: "",
  octavo: "",
};

// Dividendos W/P/S de la casa (por $1) para que el motor decida W/P/S.
const DIVIDENDOS: Record<string, number> = {
  "win:7": 12.5,
  "place:7": 5.4,
  "show:7": 3.2,
};

// Puesto puro al ganador: el 7 llega 1º → GANA.
const GANADORA: TicketMensaje = {
  comando: "100 1P",
  monto: 100,
  caballo: "7",
  cliente1: "LUIS",
  cliente2: "CARLOS",
};
// NINI 2N al 4: el 4 llega 3º (peor que el puesto 2) → PIERDE.
const NINI_PERDEDORA: TicketMensaje = {
  comando: "200 2N",
  monto: 200,
  caballo: "4",
  cliente1: "JUAN",
  cliente2: "PEDRO",
};
// NINI 2N al 7: el 7 llega 1º (mejor que el puesto 2) → GANA.
const NINI_GANADORA: TicketMensaje = {
  comando: "200 2N",
  monto: 200,
  caballo: "7",
  cliente1: "RAUL",
};
// NINI 2N al 2: el 2 llega JUSTO 2º (puesto = N) → empate oficial: devuelve capital (ANULADA).
const NINI_ANULADA: TicketMensaje = {
  comando: "200 2N",
  monto: 200,
  caballo: "2",
  cliente1: "SOFIA",
};
const PUESTO_PERDEDOR: TicketMensaje = {
  comando: "150 1P",
  monto: 150,
  caballo: "3",
  cliente1: "MARIO",
};

// ── 1. Veredictos por jugada contra el motor ──
si(veredictoDeJugada(GANADORA, PIZARRA, DIVIDENDOS, 5) === "GANA", "1P al 7 (llega 1º) → GANA");
si(veredictoDeJugada(NINI_GANADORA, PIZARRA, DIVIDENDOS, 5) === "GANA", "2N al 7 (llega 1º, mejor que el puesto 2) → GANA");
si(veredictoDeJugada(NINI_PERDEDORA, PIZARRA, DIVIDENDOS, 5) === "PIERDE", "2N al 4 (llega 3º, peor que el puesto 2) → PIERDE");
si(veredictoDeJugada(PUESTO_PERDEDOR, PIZARRA, DIVIDENDOS, 5) === "PIERDE", "1P al 3 (fuera del top 5) → PIERDE");
si(
  veredictoDeJugada(NINI_ANULADA, PIZARRA, DIVIDENDOS, 5) === "ANULADA",
  "2N al 2 (llega justo 2º = puesto N) → ANULADA (empate, devuelve capital)"
);

// ── 2. PENDIENTE: W al ganador sin el dividendo de la celda cargado ──
const W_SIN_DIVIDENDO: TicketMensaje = { comando: "50 W", monto: 50, caballo: "7", cliente1: "ANA" };
si(
  veredictoDeJugada(W_SIN_DIVIDENDO, PIZARRA, null, 5) === "PENDIENTE",
  "W al ganador sin dividendo de la celda → PENDIENTE (no se cobra ni se pierde)"
);

// ── 3. Armado del texto ──
const mensaje = mensajePreliminarDeCarrera({
  hipodromo: "LA RINCONADA",
  carrera: 5,
  fecha: "2026-10-12",
  grupo: "TERCIOS",
  pizarra: PIZARRA,
  dividendos: DIVIDENDOS,
  tickets: [GANADORA, NINI_PERDEDORA, PUESTO_PERDEDOR],
  tasaComision: 5,
});

si(mensaje.includes("🏁 RESULTADO PRELIMINAR"), "lleva el título «🏁 RESULTADO PRELIMINAR»");
si(mensaje.includes("TERCIOS"), "la cabecera lleva el grupo");
si(mensaje.includes("7-2-4-1-5"), "la cabecera lleva la pizarra de llegada 7-2-4-1-5");
si(/Pizarra:\s*7-2-4-1-5/.test(mensaje), "la línea «Pizarra:» muestra la llegada");

// Cada jugada con su veredicto del motor.
si(mensaje.includes("1) Juega LUIS 1P (7) con 100,00 da CARLOS → ✅ GANA"), `línea 1 GANA con su DA\n         ${mensaje.split("\n").find((l) => l.startsWith("1)")) ?? "(sin línea 1)"}`);
si(/2\) Juega JUAN[\s\S]*?→ ❌ PIERDE/.test(mensaje), "línea 2 PIERDE (NINI al 4, llega 3º)");
si(/3\) Juega MARIO[\s\S]*?→ ❌ PIERDE/.test(mensaje), "línea 3 PIERDE (puesto al 3)");

// Pie Preliminar.
si(mensaje.includes("Total jugadas: 3"), "el pie lleva «Total jugadas: 3»");
si(
  mensaje.includes("PRELIMINAR — veredicto según la pizarra"),
  "el pie aclara que es preliminar (sin pendientes)"
);

// ── 4. SIN balance de dinero ──
si(!mensaje.includes("POSITIVOS"), "NO aparece el cierre POSITIVOS");
si(!mensaje.includes("NEGATIVOS"), "NO aparece el cierre NEGATIVOS");
si(!/Balance/i.test(mensaje), "NO aparece la palabra Balance");
si(!mensaje.includes("Consigue"), "NO aparece el detalle de dinero del Consigue");
si(!/gananciaCasa|Balance banca/i.test(mensaje), "NO aparece el balance de la banca");

// ── 5. Con una jugada PENDIENTE el pie avisa ──
const conPendiente = mensajePreliminarDeCarrera({
  hipodromo: "LA RINCONADA",
  carrera: 5,
  pizarra: PIZARRA,
  dividendos: null,
  tickets: [W_SIN_DIVIDENDO],
});
si(conPendiente.includes("PENDIENTE"), "una jugada sin dividendo se lista como PENDIENTE");
si(
  /1 jugada\(s\) PENDIENTE\(s\)/.test(conPendiente),
  "el pie cuenta las jugadas PENDIENTE(s)"
);

// ── 6. Jugada ANULADA: se lista con 🔁 y NO se cuenta como pendiente ──
const conAnulada = mensajePreliminarDeCarrera({
  hipodromo: "LA RINCONADA",
  carrera: 5,
  pizarra: PIZARRA,
  dividendos: DIVIDENDOS,
  tickets: [NINI_ANULADA],
});
si(/→ 🔁 ANULADA/.test(conAnulada), "el NINI que empata en el puesto N se lista como 🔁 ANULADA");
si(!/PENDIENTE\(s\)/.test(conAnulada), "una ANULADA no se cuenta como PENDIENTE");

// ── 7. Saldo ajustado (*negrita* / S/S) + lista de sin saldo + observaciones ──
const conSaldos = mensajePreliminarDeCarrera({
  hipodromo: "LA RINCONADA",
  carrera: 5,
  fecha: "2026-10-12",
  grupo: "TERCIOS",
  pizarra: PIZARRA,
  dividendos: DIVIDENDOS,
  tickets: [GANADORA, PUESTO_PERDEDOR],
  tasaComision: 5,
  saldos: { LUIS: 1000, MARIO: 0 },
  observaciones: "Cerrar caja a las 6pm",
});
si(
  conSaldos.includes("→ ✅ GANA · Disp *1.000,00*"),
  "el disponible positivo se anota entre *asteriscos* (negrita WhatsApp)",
  conSaldos.split("\n").find((l) => l.startsWith("1)")) ?? "(sin línea 1)"
);
si(
  /Juega MARIO[\s\S]*?→ ❌ PIERDE · Disp \*S\/S\*/.test(conSaldos),
  "un disponible 0 se anota como *S/S*"
);
si(conSaldos.includes("S/S = Sin saldo"), "al pie aparece la leyenda «S/S = Sin saldo»");
si(
  conSaldos.includes("⚠️ Sin saldo disponible: MARIO"),
  "al pie se lista «Sin saldo disponible» con el jugador topado"
);
si(
  conSaldos.includes("📝 Observaciones:") && conSaldos.includes("Cerrar caja a las 6pm"),
  "las observaciones se anexan al pie"
);
si(!mensaje.includes("Disp *"), "sin `saldos` las líneas NO llevan el sufijo de disponible");
si(!mensaje.includes("S/S = Sin saldo"), "sin `saldos` NO aparece la leyenda S/S");

console.log(`\n${pasan} ok, ${fallan} fallaron.\n`);
if (fallan > 0) process.exit(1);
