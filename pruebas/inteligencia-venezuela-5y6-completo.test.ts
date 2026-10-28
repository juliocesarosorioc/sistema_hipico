// ============================================================================
// PRUEBAS DE INTELIGENCIA HÍPICA VENEZUELA Y CUADRO MAESTRO 5Y6 (IA GODET v4)
// ============================================================================
// Verifica:
//   1. Segmentación Nivel 1 (Venezuela activo vs USA en construcción).
//   2. Modos Analíticos (Anticipado, En Vivo y Cuadro Maestro 5y6).
//   3. Variables en vivo toleran valores provistos y nulos (null-safety).
//   4. Tendencia de la Tarde propaga el sesgo a todas las carreras y al 5y6.
//   5. Cuadro Maestro 5y6 optimiza 6 válidas excluyendo retirados y con presupuesto.
//   6. Aislamiento estricto de Bounded Context (prefijo ih_* y stores independientes).
//
// Corre con: node pruebas/correr.cjs inteligencia-venezuela-5y6-completo
// ============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  simularCarreraV4,
  evaluarEjemplarV4,
  interpretarDivisaCMG,
  type EjemplarAnalisisV4,
  type TendenciaTarde,
} from "../src/features/inteligencia/lib/analista-venezuela-v4";
import {
  generarCuadroMaestro5y6,
} from "../src/features/inteligencia/lib/optimizador-5y6";
import {
  convertirCarrerasExtraidasACatalogo,
  analizarCarrerasGacetaV4,
} from "../src/features/inteligencia/lib/importador-analizador-gaceta";
import type { CarreraExtraida } from "../src/features/gaceta/lib/ia";

let pasan = 0;
let fallan = 0;

function ok(nombre: string, condicion: boolean) {
  if (condicion) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}`);
  }
}

const raiz = process.cwd();

console.log("\n[1] SEGMENTACIÓN JURISDICCIÓN Y MODOS EN COMPONENTE");
const moduloSrc = readFileSync(
  join(raiz, "src", "features", "inteligencia", "components", "ProyeccionesModule.tsx"),
  "utf8"
);
ok("selector de jurisdicción tiene Venezuela activo", moduloSrc.includes("Venezuela (La Rinconada / Valencia)"));
ok("selector de jurisdicción tiene USA en construcción", moduloSrc.includes("Módulo USA (DRF / Equibase) en Construcción"));
ok("modo 1 Anticipado presente", moduloSrc.includes("Modo 1: Análisis Anticipado"));
ok("modo 2 En Vivo presente con factor de pista", moduloSrc.includes("Modo 2: Análisis En Vivo"));
ok("modo 3 Cuadro Maestro 5y6 con botón destacado", moduloSrc.includes("Cuadro Maestro 5y6"));

console.log("\n[2] TOLERANCIA DE VARIABLES EN VIVO (PESO, PISTA, CARRIL)");
const ejBase: EjemplarAnalisisV4 = {
  id: "1",
  numero: 1,
  nombre: "GRAN TRUENO",
  puestoPista: 1,
  jinete: "J. L. Pérez",
  kilos: 54,
  entrenador: "R. Cartolano",
  morningLine: 2.5,
  speedRatingTTC: 85,
  estilo: "E1",
  actuacionesPrevias: 8,
  diasSinCorrer: 21,
  pesoOptimoKg: 480,
  pesoHoyKg: null, // Caso: sin peso aún en modo anticipado
  efectividadJineteEntrenador: 0.32,
  tendenciaTramoFinal: "SE_MANTIENE",
};

const resSinPeso = evaluarEjemplarV4(ejBase, 1200);
ok("evalúa correctamente sin peso hoy (pesoHoyKg = null)", resSinPeso.scoreGodetTotal > 0);
ok("deltaPeso es null cuando no hay peso", resSinPeso.deltaPesoKg === null);

const ejConPesoOptimo: EjemplarAnalisisV4 = {
  ...ejBase,
  pesoHoyKg: 481, // En rango óptimo |delta| <= 2.5kg
};
const resConPesoOptimo = evaluarEjemplarV4(ejConPesoOptimo, 1200);
ok("aplica bono peso óptimo cuando delta <= 2.5kg", resConPesoOptimo.bonoPesoOptimo === true);
ok("delta peso calculado con precisión", resConPesoOptimo.deltaPesoKg === 1);

const ejConAlertaPeso: EjemplarAnalisisV4 = {
  ...ejBase,
  pesoHoyKg: 490, // Delta +10kg -> Alerta
};
const resConAlerta = evaluarEjemplarV4(ejConAlertaPeso, 1200);
ok("detecta alerta peso cuando delta >= 7kg", resConAlerta.alertaPeso === true);

console.log("\n[3] ⚡ PROPAGACIÓN DE TENDENCIA DE LA TARDE");
const tendencia: TendenciaTarde = {
  activa: true,
  factorPista: "LIGERA",
  varianteSegundos: -0.6,
  carrilDominante: "RIEL",
  estiloDominante: "E1",
  bonoPuntos: 2.8,
};

const resConTendencia = evaluarEjemplarV4(ejBase, 1200, tendencia);
ok(
  "ejemplar E1 en Riel recibe bono y badge de tendencia",
  resConTendencia.favorecidoTendenciaTarde === true &&
    resConTendencia.badges.some((b) => b.includes("TENDENCIA DE LA TARDE"))
);
ok("score total aumenta con la tendencia de la tarde", resConTendencia.scoreGodetTotal > resSinPeso.scoreGodetTotal);

console.log("\n[4] SIMULACIÓN Y GENERACIÓN DEL CUADRO MAESTRO 5Y6");
const carrera1 = simularCarreraV4({
  hipodromo: "LA RINCONADA",
  carreraNumero: 5,
  distancia: 1200,
  fecha: "2026-10-25",
  esValida5y6: true,
  numeroValida5y6: 1,
  ejemplares: [
    { ...ejBase, numero: 1, nombre: "FAVORITO LÍNEA", speedRatingTTC: 92 },
    { ...ejBase, numero: 2, nombre: "SEGUNDO", speedRatingTTC: 75, estilo: "E2" },
    { ...ejBase, numero: 3, nombre: "TERCERO", speedRatingTTC: 70, estilo: "E3" },
    { ...ejBase, numero: 4, nombre: "RETIRADO", speedRatingTTC: 80, retirado: true },
  ],
});

ok("excluye ejemplar retirado de los rankings de proyección", carrera1.ranking.every((r) => r.ejemplar.numero !== 4));
ok("identifica línea fija si probabilidad >= 38% y ventaja clara", carrera1.lineaRecomendada5y6 !== undefined);

// Generar cuadro de 6 válidas
const carrerasSimuladas = [1, 2, 3, 4, 5, 6].map((numValida) =>
  simularCarreraV4({
    hipodromo: "LA RINCONADA",
    carreraNumero: numValida + 4,
    distancia: 1200,
    fecha: "2026-10-25",
    esValida5y6: true,
    numeroValida5y6: numValida,
    ejemplares: [
      { ...ejBase, numero: 1, nombre: `LÍNEA V${numValida}`, speedRatingTTC: 90 },
      { ...ejBase, numero: 2, nombre: `SEGUNDO V${numValida}`, speedRatingTTC: 76, estilo: "E2" },
      { ...ejBase, numero: 3, nombre: `TERCERO V${numValida}`, speedRatingTTC: 72, estilo: "E3" },
      { ...ejBase, numero: 5, nombre: `SORPRESA V${numValida}`, morningLine: 12, speedRatingTTC: 78, estilo: "E3" },
    ],
  })
);

const cuadro5y6 = generarCuadroMaestro5y6({
  fecha: "2026-10-25",
  hipodromo: "LA RINCONADA",
  carrerasValidas: carrerasSimuladas,
  factorMultiplicador: 35.0,
  estrategia: "EQUILIBRADO",
});

ok("el cuadro abarca exactamente las 6 válidas", cuadro5y6.validas.length === 6);
ok("calcula combinaciones totales n1*n2*...*n6", cuadro5y6.combinacionesTotales > 0);
ok("costo total es combinaciones * factor", cuadro5y6.costoTotalBs === cuadro5y6.combinacionesTotales * 35.0);
ok("genera formato para WhatsApp de 5y6", cuadro5y6.resumenTextoWhatsApp.includes("CUADRO MAESTRO 5Y6 NACIONAL"));

console.log("\n[5] INTERPRETACIÓN DE DIVISAS C/M/G VECTORIALES");
const divisa1 = interpretarDivisaCMG("C. AZUL M. BLANCAS G. ROJA");
ok("extrae color camisa C", divisa1.colorCamisa === "#1D4ED8");
ok("extrae color mangas M", divisa1.colorMangas === "#FFFFFF");
ok("extrae color gorro G", divisa1.colorGorro === "#DC2626");

console.log("\n[6] VERIFICACIÓN DE AISLAMIENTO STRICTO (ih_*)");
const sqlSrc = readFileSync(
  join(raiz, "sql", "ih_inteligencia_hipica_venezuela.sql"),
  "utf8"
);
ok("todas las tablas usan prefijo ih_", sqlSrc.includes("ih_ejemplares") && sqlSrc.includes("ih_carreras_programa") && sqlSrc.includes("ih_cuadros_maestros_5y6"));
ok("no altera tablas operativas (sin alter table apuestas ni tickets)", !sqlSrc.includes("ALTER TABLE public.tickets_apuestas") && !sqlSrc.includes("ALTER TABLE public.clientes"));

console.log("\n[7] HERRAMIENTA IMPORTADOR, EXTRACTOR Y ANALIZADOR DE GACETA HÍPICA PDF");
const modalPdfSrc = readFileSync(
  join(raiz, "src", "features", "inteligencia", "components", "ModalImportarGacetaPdf.tsx"),
  "utf8"
);
ok("componente modal de Gaceta PDF existe", modalPdfSrc.includes("Herramienta de Importación, Extracción y Análisis de Gaceta PDF"));
ok("integrado en ProyeccionesModule", moduloSrc.includes("ModalImportarGacetaPdf") && moduloSrc.includes("Importar Gaceta PDF"));

// Prueba de conversión de carreras extraídas a catálogo
const mockExtraidas: CarreraExtraida[] = Array.from({ length: 10 }, (_, i) => ({
  carrera: i + 1,
  hipodromo: "LA RINCONADA",
  fecha: "2026-10-28",
  distancia: 1200,
  superficie: "ARENA",
  premio: 5000,
  ejemplares: [
    { numero: 1, nombre: `CABALLO A-${i + 1}`, jockey: "J. Perez", peso: 54 },
    { numero: 2, nombre: `CABALLO B-${i + 1}`, jockey: "M. Rodriguez", peso: 53 },
    { numero: 3, nombre: `CABALLO C-${i + 1}`, jockey: "F. Quevedo", peso: 55 },
    { numero: 4, nombre: `CABALLO D-${i + 1}`, jockey: "K. Briceno", peso: 52 },
  ],
}));

const catalogoGaceta = convertirCarrerasExtraidasACatalogo(mockExtraidas, "2026-10-28", "LA RINCONADA");
ok("convierte todas las carreras extraídas a catálogo", catalogoGaceta.length === 10);
ok("cada carrera tiene sus ejemplares formateados", (catalogoGaceta[0].caballos || []).length === 4);

// Prueba de análisis automático v4 de la Gaceta extraída
const resumenGacetaV4 = analizarCarrerasGacetaV4({
  carreras: catalogoGaceta,
  fecha: "2026-10-28",
});

ok("analiza las 10 carreras completas con Motor v4", resumenGacetaV4.totalCarreras === 10);
ok("detecta exactamente 6 válidas del 5y6 (C5 a C10)", resumenGacetaV4.carrerasValidas5y6.length === 6);
ok("la primera válida corresponde a la carrera 5", resumenGacetaV4.carrerasValidas5y6[0].carreraNumero === 5);
ok("la sexta válida corresponde a la carrera 10", resumenGacetaV4.carrerasValidas5y6[5].carreraNumero === 10);
ok("calcula rankings y scores Godet v4 para cada carrera", resumenGacetaV4.carrerasAnalizadas.every((c) => c.ranking.length > 0));

console.log(`\nTOTAL: ${pasan} ok / ${fallan} fallaron`);
if (fallan > 0) process.exitCode = 1;
