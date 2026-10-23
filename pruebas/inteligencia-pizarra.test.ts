// ============================================================================
// PIZARRA PROSPECTIVA — MACTOR + SMIC + ACTUARIO (núcleo puro).
//
// Fija el contrato de `src/features/inteligencia/lib/pizarra.ts`:
//
//   A. El estilo E1/E2/E3 se INFIERE (no hay parciales oficiales en la base) y
//      la regla es la declarada: velocidad relativa, consistencia y cambio de
//      distancia. Si mañana se cambia, estos números lo delatan.
//   B. El tren MACTOR respeta el reloj de la pista antes que el conteo de
//      velocistas: un 400 m de 21.5 s es violento aun sin E1.
//   C. El ajuste por peso es simétrico al del motor Godet: cargar el peso de
//      referencia suma, la descarga suma, la sobrecarga resta y se acota.
//   D. `construirPizarra` redistribuye el 100% entre los ACTIVOS: retirar a
//      uno no deja huecos ni probabilidades que no suman.
//   E. La recta final ordena por score y descuenta la brecha por el remate de
//      200 m del motor, con el puntero pegado al disco (0%).
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import {
  ajusteDePeso,
  ajusteDePista,
  ajustePorTrackeos,
  construirPizarra,
  estadoTrenMactor,
  inferirEstilo,
  mediana,
  rectaFinal,
  AJUSTES_POR_DEFECTO,
  type InsumoPizarra,
} from "../src/features/inteligencia/lib/pizarra";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => {
  pasan++;
  console.log(`  ok   ${m}`);
};
const mal = (m: string, d?: string) => {
  fallan++;
  console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`);
};
const si = (c: boolean, m: string, d?: string) => (c ? ok(m) : mal(m, d));
const igual = (a: unknown, b: unknown, m: string) =>
  si(
    JSON.stringify(a) === JSON.stringify(b),
    m,
    `esperado ${JSON.stringify(b)} · recibido ${JSON.stringify(a)}`
  );
const cerca = (a: number, b: number, m: string, tol = 0.001) =>
  si(Math.abs(a - b) <= tol, m, `esperado ~${b} · recibido ${a}`);

// ---------------------------------------------------------------------------
console.log("[1] mediana: referencia del lote");
// ---------------------------------------------------------------------------

igual(mediana([3, 1, 2]), 2, "impar: el del medio");
igual(mediana([4, 1, 3, 2]), 2.5, "par: promedio de los dos del medio");
igual(mediana([0, -5, NaN]), 0, "ignora ceros, negativos y NaN (sin datos = 0)");

// ---------------------------------------------------------------------------
console.log("\n[2] estilo E1/E2/E3 inferido");
// ---------------------------------------------------------------------------

const REF = 75;

igual(
  inferirEstilo({ speedRating: 90, consistencia: 20, distancias: [] }, 1200, REF),
  "E1",
  "rápido (+15 sobre el lote) e intermitente → E1 velocista"
);
igual(
  inferirEstilo({ speedRating: 60, consistencia: 70, distancias: [] }, 1200, REF),
  "E3",
  "lento (−15) pero constante → E3 rematador"
);
igual(
  inferirEstilo({ speedRating: 80, consistencia: 55, distancias: [] }, 1200, REF),
  "E2",
  "el del medio, sin señales extremas → E2 perseguidor"
);
igual(
  inferirEstilo({ speedRating: 75, consistencia: 50, distancias: [1000, 1000, 1100] }, 1600, REF),
  "E1",
  "hoy estira de 1000 a 1600 m (+25%): lo empuja al frente → E1"
);
igual(
  inferirEstilo({ speedRating: 75, consistencia: 50, distancias: [1600, 1700] }, 1000, REF),
  "E3",
  "hoy acorta de 1600 a 1000 m (−37%): llega desde atrás → E3"
);

// ---------------------------------------------------------------------------
console.log("\n[3] tren MACTOR: el reloj manda, después el conteo");
// ---------------------------------------------------------------------------

const e1 = (numero: number) => ({ numero, estilo: "E1" as const });
const e2 = (numero: number) => ({ numero, estilo: "E2" as const });

igual(
  estadoTrenMactor([e1(1), e1(2), e1(3), e2(4)], 22.4).codigo,
  "violento",
  "3+ velocistas activos → tren violento (se anulan)"
);
igual(
  estadoTrenMactor([e1(1), e2(2), e2(3)], 22.4).codigo,
  "solitario",
  "un solo E1 → puntero solitario"
);
igual(estadoTrenMactor([e1(1), e2(2)], 22.4).puntero, 1, "el puntero solitario es el único E1");
igual(
  estadoTrenMactor([e2(1), e2(2)], 22.4).codigo,
  "falso",
  "sin E1 → tren falso (los perseguidores toman la iniciativa)"
);
igual(
  estadoTrenMactor([e1(1), e1(2), e2(3)], 22.4).codigo,
  "violento",
  "2 E1 activos → duelo en punta"
);
igual(
  estadoTrenMactor([e2(1), e2(2), e2(3)], 21.5).codigo,
  "violento",
  "un 400 m de 21.5 s es violento aunque no haya E1"
);

// ---------------------------------------------------------------------------
console.log("\n[4] ajuste por pista y por sesgo");
// ---------------------------------------------------------------------------

igual(ajusteDePista("E1", 1, AJUSTES_POR_DEFECTO), 0, "pista normal y sin sesgo no ajusta");
cerca(
  ajusteDePista("E1", 1, { ...AJUSTES_POR_DEFECTO, factorPista: "ligera" }),
  2.0,
  "pista ligera premia al E1"
);
cerca(
  ajusteDePista("E3", 6, { ...AJUSTES_POR_DEFECTO, factorPista: "pesada" }),
  2.4,
  "pista pesada premia al E3"
);
cerca(
  ajusteDePista("E2", 2, { ...AJUSTES_POR_DEFECTO, sesgo: "riel_interno" }),
  2.2,
  "sesgo al riel interno premia PP 1-3"
);
cerca(
  ajusteDePista("E2", 7, { ...AJUSTES_POR_DEFECTO, sesgo: "rematadores" }),
  2.5,
  "sesgo rematador premia a E2/E3"
);
igual(
  ajusteDePista("E1", 7, { ...AJUSTES_POR_DEFECTO, sesgo: "riel_interno" }),
  0,
  "el 7 no recibe el bono del riel interno"
);

// ---------------------------------------------------------------------------
console.log("\n[5] ajuste por peso: referencia, descarga y sobrecarga");
// ---------------------------------------------------------------------------

const sinPeso = ajusteDePeso(null, 54);
igual(sinPeso.delta, null, "sin peso declarado no hay delta");
igual(sinPeso.ajuste, 0, "sin peso declarado no hay ajuste");

const enPeso = ajusteDePeso(54, 54);
igual(enPeso.delta, 0, "54 kg sobre referencia 54 → delta 0");
cerca(enPeso.ajuste, 1.9, "correr en el peso de referencia es la mejor posición (+1.9)");

cerca(ajusteDePeso(51.5, 54).ajuste, 2.4, "descarga de 2.5 kg → +2.4");
cerca(ajusteDePeso(56, 54).ajuste, -0.28, "sobrecarga de 2 kg → penalización leve");
cerca(ajusteDePeso(70, 54).ajuste, -4.5, "sobrecarga absurda → penalización acotada en −4.5");

// ---------------------------------------------------------------------------
console.log("\n[6] construirPizarra: activos, retiros y probabilidad 100%");
// ---------------------------------------------------------------------------

const insumo = (numero: number, extra: Partial<InsumoPizarra> = {}): InsumoPizarra => ({
  numero,
  nombre: `CABALLO ${numero}`,
  speedRating: 75,
  consistencia: 50,
  actuaciones: 10,
  placements: 4,
  winRate: 40,
  diasDescanso: 21,
  efectividadYunta: 0.4,
  pesoHoyKg: 54,
  jockey: `JINETE ${numero}`,
  entrenador: "ENTRENADOR",
  distancias: [1200, 1200],
  ...extra,
});

const lote: InsumoPizarra[] = [
  insumo(1, { speedRating: 90, consistencia: 20, pesoHoyKg: 54 }),
  insumo(2, { speedRating: 80, consistencia: 55, pesoHoyKg: 56 }),
  insumo(3, { speedRating: 70, consistencia: 50, pesoHoyKg: 52 }),
  insumo(4, { speedRating: 60, consistencia: 70, pesoHoyKg: 54, retirado: true }),
];

const p = construirPizarra(lote, AJUSTES_POR_DEFECTO, 1200);

igual(p.totalActivos, 3, "el retirado no entra en la simulación");
igual(p.totalRetirados, 1, "el retirado se informa aparte");
igual(p.retirados.map((r) => r.numero), [4], "y es el #4");
igual(p.activos.map((f) => f.puesto), [1, 2, 3], "los puestos se numeran 1..n entre activos");
si(
  p.activos.every((f, i, xs) => i === 0 || xs[i - 1].score >= f.score),
  "ordenado de mayor a menor score"
);

const suma = p.activos.reduce((s, f) => s + f.probabilidad, 0);
cerca(Math.round(suma * 10) / 10, 100, "la probabilidad SMIC de los activos suma 100%");
si(
  p.activos.every((f) => Number.isFinite(f.probabilidad) && f.probabilidad > 0 && f.probabilidad < 100),
  "nadie queda en 0% ni en 100% (softmax reparte)"
);
si(
  p.activos.every((f) => Number.isFinite(f.score) && Number.isFinite(f.remate200Seg)),
  "score y remate son números finitos (sin NaN con historial incompleto)"
);
igual(p.pesoReferenciaKg, 54, "la referencia de peso es la mediana de los declarados");
si(
  p.activos.find((f) => f.numero === 1)?.notaPeso?.includes("referencia") === true,
  "el ejemplar con el peso de referencia lleva la nota +1.9"
);

igual(p.tickets.ganador?.numero, p.activos[0].numero, "el ticket de ganador es el primero");
si(p.tickets.exacta.includes("-"), "la exacta trae dos números");
si(p.tickets.trifecta.split("/").length === 3, "la trifecta trae tres lugares");
si(
  p.informe.some((l) => l.includes("#4")),
  "el informe nombra al retirado"
);

const sinRetiros = construirPizarra(
  lote.map((i) => ({ ...i, retirado: false })),
  AJUSTES_POR_DEFECTO,
  1200
);
igual(sinRetiros.totalActivos, 4, "sin retiros entran los 4");
cerca(
  Math.round(sinRetiros.activos.reduce((s, f) => s + f.probabilidad, 0) * 10) / 10,
  100,
  "y también suma 100%"
);
si(
  sinRetiros.informe.some((l) => l.includes("Todos los ejemplares inscritos")),
  "el informe avisa cuando no hay retiros"
);

// ---------------------------------------------------------------------------
console.log("\n[7] recta final: el puntero al disco y el resto detrás");
// ---------------------------------------------------------------------------

const carriles = rectaFinal(p.activos, 6);
igual(carriles.length, 3, "dibuja una calle por activo (hasta 6)");
igual(carriles[0].posicionPct, 0, "el puntero queda pegado al disco (0%)");
igual(carriles[0].cuerpos, 0, "el puntero no tiene cuerpos de desventaja");
si(
  carriles.every((c, i) => i === 0 || c.posicionPct >= carriles[i - 1].posicionPct),
  "las posiciones no se cruzan: cada uno queda igual o más atrás"
);
si(
  carriles.every((c) => c.posicionPct <= 76),
  "ninguna calle se sale del tablero"
);

// ---------------------------------------------------------------------------
console.log("\n[8] una carrera sin activos no revienta");
// ---------------------------------------------------------------------------

const todosRetirados = construirPizarra(
  lote.map((i) => ({ ...i, retirado: true })),
  AJUSTES_POR_DEFECTO,
  1200
);
igual(todosRetirados.totalActivos, 0, "0 activos");
igual(todosRetirados.activos.length, 0, "lista vacía (la UI muestra el aviso)");
igual(todosRetirados.tickets.ganador, null, "sin ganador sugerido");
igual(rectaFinal(todosRetirados.activos).length, 0, "sin carriles para dibujar");

// ---------------------------------------------------------------------------
console.log("\n[9] duelo de velocistas, retiro táctico y condición Wet");
// ---------------------------------------------------------------------------

const paces: InsumoPizarra[] = [
  insumo(1, { paceEarly: 95, consistencia: 50, speedRating: 75 }),
  insumo(7, { paceEarly: 93, consistencia: 50, speedRating: 75 }),
  insumo(8, { paceLate: 94, consistencia: 50, speedRating: 75 }),
  insumo(3, { paceEarly: 98, consistencia: 50, speedRating: 75, retirado: true }),
];
const duelo = construirPizarra(paces, AJUSTES_POR_DEFECTO, 1400);
igual(duelo.tren.codigo, "violento", "dos E1 con early pace alto activan duelo en punta");
igual(duelo.activos[0].numero, 8, "el E3 lidera cuando el duelo favorece el remate");
si(duelo.informe.some((linea) => linea.includes("Planteamiento con todos")), "el dictamen compara inscritos y retiros");

const conRetiro = construirPizarra(
  paces.map((ejemplar) => ({
    ...ejemplar,
    retirado: ejemplar.numero === 1 || ejemplar.retirado === true,
  })),
  AJUSTES_POR_DEFECTO,
  1400
);
igual(conRetiro.tren.codigo, "solitario", "al retirar un E1, el otro queda como puntero solitario");
igual(conRetiro.tren.puntero, 7, "el puntero solitario queda identificado");
igual(conRetiro.activos[0].numero, 7, "el E1 sobreviviente sube al primer lugar");

const muddy = { ...AJUSTES_POR_DEFECTO, factorPista: "muddy" as const };
si(
  ajusteDePista("E2", 4, muddy, { aptitudSuperficie: { Wet: 430 } }) >
    ajusteDePista("E2", 4, muddy, { aptitudSuperficie: { Turf: 390 } }),
  "Muddy favorece un rating Wet y penaliza el perfil solo Turf"
);
cerca(
  ajusteDePista("E2", 4, { ...AJUSTES_POR_DEFECTO, factorPista: "off_turf_fango" }, {
    aptitudSuperficie: { Wet: 430 },
  }),
  1.8,
  "Off-the-Turf a fango incorpora la ventaja Wet"
);
igual(ajustePorTrackeos([{ remate_200m: "12.0", comentario: "FENOMENO" }]), 2, "trackeo nacional destacado bonifica");

const value = construirPizarra(
  [insumo(1, { morningLine: "20-1", paceEarly: 95 })],
  AJUSTES_POR_DEFECTO
);
si(value.activos[0].overlay, "overlay compara la SMIC final con la probabilidad implícita del M/L");

console.log(`\n${pasan} pasaron, ${fallan} fallaron`);
process.exit(fallan > 0 ? 1 : 0);
