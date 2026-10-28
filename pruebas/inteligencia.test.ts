// ============================================================================
// SEGMENTACIÓN DE LA GACETA EN TEXTO + RANKING ACTUARIAL
// ============================================================================
//
// Fija el contrato de los dos módulos puros que sostienen la carga completa
// de la gaceta y la proyección de la carrera:
//
//   A. `segmentarPorCarreras` parte el documento por los ENCABEZADOS de
//      carrera y `armarBloques` los agrupa de 2 en 2 o de 3 en 3. Es lo que
//      evita que la respuesta del modelo se trunque y las últimas carreras
//      se pierdan (Belmont 1-3, Charles Town 4-6, Keeneland 4-6).
//   B. `consolidarPorNumero` junta los bloques en un `Map` por número de
//      carrera: la misma carrera partida entre dos bloques se une con sus
//      ejemplares, y dos carreras distintas con el mismo número NO se
//      colapsan (esa era la forma de perder la 13.ª).
//   C. `calcularRankingActuarial` ordena por probabilidad real: la forma
//      manda, la consistencia acompaña, y la credibilidad Bühlmann-Straub
//      impide que un debut perfecto se lleve la carrera.
//
// Corre con:  node pruebas/correr.cjs   (o npx tsx pruebas/inteligencia.test.ts)
// ============================================================================
import {
  armarBloques,
  consolidarPorNumero,
  segmentarPorCarreras,
} from "@/features/gaceta/lib/segmentar";
import {
  calcularRankingActuarial,
  credibilidadStraub,
  diasDesdeUltima,
  escalaSpeed,
  etiquetaRiesgo,
  riesgoCox,
  type ContextoCarrera,
  type EjemplarProyectable,
} from "@/features/inteligencia/lib/proyecciones";
import type { MemoriaEjemplar } from "@/features/gaceta/lib/padron";

let pasan = 0;
let fallan = 0;
/** Aserción con condición explícita: `ok("mensaje", condicion, detalle?)`. */
const ok = (m: string, condicion: boolean, detalle?: string) => {
  if (condicion) {
    pasan++;
    console.log(`  ok   ${m}${detalle ? ` (${detalle})` : ""}`);
  } else {
    fallan++;
    console.log(`  FALLA ${m}${detalle ? `\n         ${detalle}` : ""}`);
  }
};
const mal = (m: string, d?: string) => { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };
const igual = (real: unknown, esperado: unknown, m: string) =>
  JSON.stringify(real) === JSON.stringify(esperado)
    ? ok(`${m} -> ${JSON.stringify(real)}`, true)
    : mal(m, `esperado ${JSON.stringify(esperado)}, llego ${JSON.stringify(real)}`);

// ---------------------------------------------------------------------------
console.log("\n[1] segmentar por encabezados de carrera");
// ---------------------------------------------------------------------------

const DOCUMENTO = `PROGRAMA OFICIAL — LA RINCONADA
Domingo, 4 de Octubre de 2026

CARRERA 1
1400 metros. Premio $8.000
1 EL TREMENDO
2 LA FARAONA

RACE 2
1100 metros. Premio $5.000
1 MI NIÑA
2 EL GRANDE

CARRERA Nº 3
1600 metros
1 EL REY
2 LA CATEDRAL

DECIMOTERCERA CARRERA
1400 metros
1 EL ULTIMO`;

const segs = segmentarPorCarreras(DOCUMENTO);
const conNumero = segs.filter((s) => s.numero != null);
igual(conNumero.length, 4, "el documento tiene 4 carreras con encabezado legible");
igual(conNumero.map((s) => s.numero), [1, 2, 3, 13], "los números se leen bien (1, 2, 3 y 13)");
ok(
  "el encabezado del documento NO cuenta como carrera",
  segs.some((s) => s.numero == null && s.texto.includes("PROGRAMA OFICIAL"))
);

// Test específico: Septima carrera de La Rinconada / 1ra Válida para el 5 y 6
const DOC_RINCONADA = `PROGRAMA OFICIAL LA RINCONADA
6ª CARRERA
1200 metros
1 CABALLO SEIS

7ª CARRERA - 1ª VÁLIDA PARA EL 5 Y 6 (HORA: 3:30 PM)
1200 metros. Premio Bs. 15.000
1 PURASANGRE SIETE
2 CAMPEON SIETE

2ª VÁLIDA PARA EL 5 Y 6
1400 metros
1 CABALLO OCHO`;

const segsRinconada = segmentarPorCarreras(DOC_RINCONADA);
const numsRinconada = segsRinconada.filter((s) => s.numero != null).map((s) => s.numero);
igual(numsRinconada, [6, 7, 8], "La Rinconada detecta la 7ª carrera y las válidas correctamente");

// Un texto SIN encabezados no se pierde: se devuelve entero.
const sinEncabezado = segmentarPorCarreras("SOLO TEXTO SUELTO SIN CARRERAS");
igual(sinEncabezado.length, 1, "un texto sin encabezados se devuelve como un bloque");
igual(sinEncabezado[0].numero, null, "el bloque sin encabezados no tiene número");

// Una frase que menciona "carrera" en medio NO es un encabezado.
const frase = segmentarPorCarreras("En la carrera del domingo\n participated el caballo 5");
igual(frase.filter((s) => s.numero != null).length, 0, "una frase con 'carrera' no abre un segmento");

// ---------------------------------------------------------------------------
console.log("\n[2] bloques de 2 a 3 carreras");
// ---------------------------------------------------------------------------

const bloques = armarBloques(segs, 3);
igual(bloques.length, 2, "4 carreras entran en 2 bloques de 3 y 1");
igual(bloques[0].numeros, [1, 2, 3], "el primer bloque lleva las carreras 1-3");
igual(bloques[1].numeros, [13], "el segundo bloque lleva la 13");
ok("el encabezado del documento viaja con el primer bloque", bloques[0].texto.includes("PROGRAMA OFICIAL"));
ok("el primer bloque no repite el texto de la 13", !bloques[0].texto.includes("EL ULTIMO"));

const bloques2 = armarBloques(segs, 2);
igual(bloques2.length, 2, "con 2 por bloque, 4 carreras dan 2 bloques");
igual(bloques2[0].numeros, [1, 2], "el primer bloque de a 2 lleva las carreras 1 y 2");

// ---------------------------------------------------------------------------
console.log("\n[3] consolidación por número de carrera");
// ---------------------------------------------------------------------------

type C = { carrera: number; ejemplares: Array<{ numero: number; nombre: string }> };

const mismaPartida: C[] = [
  { carrera: 1, ejemplares: [{ numero: 1, nombre: "A" }] },
  { carrera: 1, ejemplares: [{ numero: 2, nombre: "B" }] },
];
const cons1 = consolidarPorNumero(mismaPartida);
igual(cons1.porNumero.size, 1, "la misma carrera partida se cuenta como UNA");
igual(cons1.porNumero.get(1)?.ejemplares.length, 2, "y se unen sus ejemplares (no se pierde ninguno)");

const distintas: C[] = [
  { carrera: 10, ejemplares: [{ numero: 1, nombre: "A" }] },
  { carrera: 10, ejemplares: [{ numero: 1, nombre: "Z" }] },
];
const cons2 = consolidarPorNumero(distintas);
igual(cons2.porNumero.size, 1, "con ejemplares disjuntos se conserva la primera");
igual(cons2.colisiones.length, 1, "y la SEGUNDA sale como colisión para renumerar (no se pierde)");

// ---------------------------------------------------------------------------
console.log("\n[4] el ranking actuarial");
// ---------------------------------------------------------------------------

const memoria = (
  actuaciones: number,
  placements: number,
  consistencia: number,
  speed: number,
  ultima = "2026-09-20"
): MemoriaEjemplar => ({
  nombre: "X",
  nacionalidad: "VE",
  actuaciones,
  placements,
  winRate: actuaciones ? Math.round((placements / actuaciones) * 100) : 0,
  indiceConsistenciaGodet: consistencia,
  speedRating: speed,
  serieSpeedRating: [speed],
  jineteHabitual: "J. PEREZ",
  entrenadorHabitual: "E. RAMOS",
  historial: [
    { fecha: ultima, hipodromo: "LA RINCONADA", carrera: 1, puesto: 1, distancia: 1400, superficie: "ARENA", premio: 8000 },
  ],
});

const ctx: ContextoCarrera = {
  hipodromo: "LA RINCONADA",
  carrera: 1,
  fecha: "2026-10-04",
  distancia: 1400,
  superficie: "ARENA",
  premio: 8000,
};

const proyectables: EjemplarProyectable[] = [
  { numero: 1, nombre: "EL TREMENDO", nacionalidad: "VE", memoria: memoria(20, 12, 72, 98) },
  { numero: 2, nombre: "LA FARAONA", nacionalidad: "VE", memoria: memoria(8, 3, 35, 84) },
  { numero: 3, nombre: "MI NIÑA", nacionalidad: "VE", memoria: null },
];

const rank = calcularRankingActuarial(proyectables, ctx);
igual(rank.length, 3, "el ranking trae las tres filas");
igual(rank[0].nombre, "EL TREMENDO", "el de más historial y mejor forma va primero");
igual(rank[2].nombre, "MI NIÑA", "el que no tiene historial va último (no se inventa)");
ok(
  "las probabilidades suman 100",
  Math.abs(rank.reduce((s, f) => s + f.probabilidad, 0) - 100) < 0.5,
  `suma ${rank.reduce((s, f) => s + f.probabilidad, 0).toFixed(2)}`
);
ok(
  "el último tiene un Índice de Consistencia de 0 (no hay historial)",
  rank[2].indiceConsistencia === 0
);
ok(
  "sin historial la credibilidad es 0",
  rank[2].credibilidad === 0
);
ok(
  "con 20 actuaciones la credibilidad es alta",
  rank[0].credibilidad > 0.6,
  `Z=${rank[0].credibilidad}`
);

// ---------------------------------------------------------------------------
console.log("\n[5] las piezas del modelo");
// ---------------------------------------------------------------------------

igual(escalaSpeed(0), 60, "sin rating se usa la media de la población");
igual(escalaSpeed(130), 100, "el rating máximo llega a 100");
igual(escalaSpeed(50), 0, "el rating mínimo llega a 0");
igual(Number(credibilidadStraub(0).toFixed(2)), 0, "sin actuaciones no hay credibilidad propia");
ok("con muchas actuaciones la credibilidad se acerca a 1", credibilidadStraub(200) > 0.95);
igual(riesgoCox(0, 0), 1, "sin datos de riesgo el hazard ratio es 1");
ok("descanso corto sube el riesgo", riesgoCox(7, 0) > 1);
ok("las alertas médicas suben el riesgo", riesgoCox(30, 2) > 1);
igual(etiquetaRiesgo(1), "bajo", "riesgo normal = bajo");
igual(etiquetaRiesgo(1.3), "alto", "riesgo alto se marca");
igual(diasDesdeUltima("2026-10-01", "2026-10-04"), 3, "los días se calculan bien");
igual(diasDesdeUltima(null, "2026-10-04"), 0, "sin última carrera no hay días");

// ---------------------------------------------------------------------------
console.log(`\n${pasan} pasaron, ${fallan} fallaron.`);
if (fallan > 0) process.exit(1);
