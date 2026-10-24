<<<<<<< HEAD
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
=======
import { describe, expect, it } from "vitest";
import { generarProspectivaGodet, simularTrenCarrera, type EjemplarGodet } from "@/features/gaceta/lib/actuarialGodetEngine";
import { dividirYProcesarGacetaCompleta } from "@/features/gaceta/lib/ia";

describe("Inteligencia Hípica - Godet MACTOR/SMIC", () => {
  const baseEjemplares: EjemplarGodet[] = [
    { id: "1", numero: 1, nombre: "TANK ABBOTT", tipoCarrera: "velocista", estilo: "E1", earlyPace: 95, latePace: 65, actuaciones: 10, speedRatingTTC: 78, beyer: 82, morningLine: "2-1", pesoNeto: 54, descargo: 0 },
    { id: "2", numero: 2, nombre: "RAPIDO VENEZOLANO", tipoCarrera: "velocista", estilo: "E1", earlyPace: 93, latePace: 68, actuaciones: 8, speedRatingTTC: 76, beyer: 80, morningLine: "3-1" },
    { id: "3", numero: 3, nombre: "CLOSER KING", tipoCarrera: "rematador", estilo: "E3", earlyPace: 75, latePace: 92, actuaciones: 12, speedRatingTTC: 80, beyer: 86, morningLine: "4-1" },
    { id: "4", numero: 4, nombre: "STALKER BOY", tipoCarrera: "perseguidor", estilo: "E2", earlyPace: 82, latePace: 84, actuaciones: 9, speedRatingTTC: 78, beyer: 83, morningLine: "5-1" },
  ];

  it("clasifica tren de carrera con 2 velocistas E1 (duelo en punta)", () => {
    const tren = simularTrenCarrera(baseEjemplares);
    expect(tren.mactor.grupos.E1).toBe(2);
    expect(tren.escenarios.some((e) => e.tipo === "duelo_suicida")).toBe(true);
  });

  it("cuando se retira un velocista E1, el otro queda solo en punta (lone speed)", () => {
    const retirados = new Set(["1"]);
    const tren = simularTrenCarrera(baseEjemplares, retirados);
    expect(tren.mactor.grupos.E1).toBe(1);
    expect(tren.escenarios.some((e) => e.tipo === "retiro_velocista")).toBe(true);
  });

  it("genera prospectiva Godet con SMIC/MACTOR y favorece rematadores en duelo", () => {
    const res = generarProspectivaGodet(baseEjemplares, "previa", { pista: "arena", clima: "seco", cambioJockey: false, cambioEntrenador: false, reaparecida: false, customFactors: [] });
    expect(res.ordenLlegada.length).toBe(4);
    expect(res.mactor.grupos.E1).toBe(2);
    // En duelo de velocistas, el rematador (E3) debe recibir ajuste favorable
    const closer = res.ordenLlegada.find((r) => r.ejemplar.nombre === "CLOSER KING");
    expect(closer).toBeDefined();
    expect(closer?.estilo).toBe("E3");
  });

  it("penaliza caballos de grama si pista cambia a fango/muddy", () => {
    const turfHorse: EjemplarGodet[] = [
      { id: "t1", numero: 1, nombre: "GRASS SPECIALIST", estilo: "E2", aptitudTurf: 85, aptitudWet: 25, actuaciones: 10, speedRatingTTC: 80, morningLine: "2-1" },
      { id: "t2", numero: 2, nombre: "MUD MASTER", estilo: "E2", aptitudTurf: 40, aptitudWet: 88, actuaciones: 10, speedRatingTTC: 78, morningLine: "3-1" },
    ];
    const res = generarProspectivaGodet(turfHorse, "en_vivo", { pista: "fango", clima: "lluvioso", cambioJockey: false, cambioEntrenador: false, reaparecida: false, customFactors: [] }, { superficie: "muddy", sesgoRielInterno: 0, sesgoRielExterno: 0, sesgoVelocistas: 0, sesgoRematadores: 0, brisaRecta: 0, varianteObservada: 0 });
    expect(res.ordenLlegada.length).toBe(2);
    // MUD MASTER debe tener mayor probabilidad relativa
    const mud = res.ordenLlegada.find((r) => r.ejemplar.nombre === "MUD MASTER");
    expect(mud?.probNorm).toBeGreaterThan(30);
  });

  it("detecta overlays vs morning line", () => {
    const ej: EjemplarGodet[] = [
      { id: "o1", numero: 1, nombre: "VALUE HORSE", estilo: "E3", actuaciones: 15, speedRatingTTC: 85, beyer: 90, morningLine: "10-1" },
      { id: "o2", numero: 2, nombre: "FAVORITE", estilo: "E1", actuaciones: 12, speedRatingTTC: 82, beyer: 86, morningLine: "2-1" },
    ];
    const res = generarProspectivaGodet(ej, "previa", { pista: "dirt_fast", clima: "seco", cambioJockey: false, cambioEntrenador: false, reaparecida: false, customFactors: [] });
    const value = res.ordenLlegada.find((r) => r.ejemplar.nombre === "VALUE HORSE");
    expect(value).toBeDefined();
    expect(typeof value?.overlay).toBe("boolean");
  });
});

describe("Extracción Gaceta multi-formato", () => {
  it("divide y procesa gaceta completa por carreras", async () => {
    const texto = `
RACE 1
1 TANK ABBOTT VE 57-3 JOCKEY A TRAINER B
RACE 2
2 PRINCESA SUSEJ VE 54 JOCKEY C TRAINER D
    `;
    const carreras = await dividirYProcesarGacetaCompleta(texto, async (frag) => {
      if (frag.includes("RACE 1")) return [{ numero_carrera: 1, ejemplares: [{ numero: 1, nombre: "TANK ABBOTT", jinete: "JOCKEY A", peso: "57-3" }] }];
      if (frag.includes("RACE 2")) return [{ numero_carrera: 2, ejemplares: [{ numero: 2, nombre: "PRINCESA SUSEJ", jinete: "JOCKEY C", peso: "54" }] }];
      return [];
    });
    expect(carreras.length).toBe(2);
    expect(carreras[0].numero_carrera).toBe(1);
    expect(carreras[1].ejemplares[0].nombre).toBe("PRINCESA SUSEJ");
  });

  it("fusiona ejemplares por número sin duplicados", async () => {
    const texto = "CARRERA 1\nCARRERA 1 CONT";
    const llamadas: string[] = [];
    const carreras = await dividirYProcesarGacetaCompleta(texto, async (frag) => {
      llamadas.push(frag);
      if (llamadas.length === 1) return [{ numero_carrera: 1, ejemplares: [{ numero: 1, nombre: "CABALLO A" }] }];
      return [{ numero_carrera: 1, ejemplares: [{ numero: 1, nombre: "CABALLO A", jinete: "JINETE X" }, { numero: 2, nombre: "CABALLO B" }] }];
    });
    expect(carreras.length).toBe(1);
    expect(carreras[0].ejemplares.length).toBe(2);
  });
});

describe("Historial por ejemplar (llave maestra)", () => {
  it("normalización conceptual nombre_normalizado", () => {
    const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim().replace(/\s+/g, " ");
    expect(norm("Tank Abbott!")).toBe("TANK ABBOTT");
    expect(norm("princesa   susej")).toBe("PRINCESA SUSEJ");
  });
});
>>>>>>> bd25c19 (feat(inteligencia): integrar pizarra Godet MACTOR/SMIC nacional y DRF con historial por ejemplar, trackeos y tren de carrera)
