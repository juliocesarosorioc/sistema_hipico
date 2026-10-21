// ============================================================================
// PROMPT #6 · VENTANA DE REVISIÓN Y RECLAMOS POR GRUPO — NÚCLEO PURO
//
// Cada grupo decide hasta cuándo el jugador puede reclamar una jugada o pedir
// que le incluyan una "no relacionada":
//
//   · SOLO_DIA_EN_CURSO (default) → sólo el día en curso.
//   · SEMANA_EN_CURSO              → la semana fiscal del grupo.
//
// Qué protege esta prueba:
//   1. El núcleo puro (`ventana-reclamos.ts`): normalización, rango semanal,
//      la decisión `dentroDeVentana` y los topes/pisos para el input de fecha.
//   2. Que la fecha "del futuro" NUNCA se pueda reclamar (error de carga).
//   3. Que la ventana semanal respete el ciclo del grupo (dia_inicio/dia_fin),
//      incluido el ciclo que CRUZA el domingo (ej. Viernes → Martes).
//   4. Que el servidor (Edge Function) y el modal usen el mismo cálculo.
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  VENTANAS,
  VENTANA_POR_DEFECTO,
  esVentanaValida,
  normalizarVentana,
  etiquetaVentana,
  rangoSemana,
  dentroDeVentana,
  fechaTopeReclamo,
  fechaPisoReclamo,
  explicarVentana,
} from "../src/features/portal/lib/ventana-reclamos";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => { pasan++; console.log(`  ok   ${m}`); };
const mal = (m: string, d?: string) => { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };
const si = (c: boolean, m: string, d?: string) => (c ? ok(m) : mal(m, d));
const igual = (a: unknown, b: unknown, m: string) =>
  si(JSON.stringify(a) === JSON.stringify(b), m, `esperado ${JSON.stringify(b)} · recibido ${JSON.stringify(a)}`);

const raiz = process.cwd();
const leer = (...partes: string[]) => readFileSync(join(raiz, ...partes), "utf8");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 1 — normalización del modo");
// ---------------------------------------------------------------------------
igual([...VENTANAS], ["SOLO_DIA_EN_CURSO", "SEMANA_EN_CURSO"], "los dos modos, en orden");
igual(VENTANA_POR_DEFECTO, "SOLO_DIA_EN_CURSO", "el default es día en curso");
si(esVentanaValida("SOLO_DIA_EN_CURSO"), "SOLO_DIA_EN_CURSO es válido");
si(esVentanaValida("semana_en_curso"), "'semana_en_curso' en minúsculas es válido");
si(!esVentanaValida("mes_en_curso"), "'mes_en_curso' NO es válido");
si(!esVentanaValida(null), "null NO es válido");
igual(normalizarVentana(" semana_en_curso "), "SEMANA_EN_CURSO", "normaliza espacios y mayúsculas");
igual(normalizarVentana(undefined), "SOLO_DIA_EN_CURSO", "undefined cae al default");
igual(normalizarVentana("basura"), "SOLO_DIA_EN_CURSO", "valor inválido cae al default");
igual(etiquetaVentana("SEMANA_EN_CURSO"), "Semana en curso", "rótulo de semana");
igual(etiquetaVentana("SOLO_DIA_EN_CURSO"), "Sólo día en curso", "rótulo de día");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 2 — rango de la semana fiscal del grupo");
// ---------------------------------------------------------------------------
// Default Lunes(1)→Domingo(7). El 2026-10-21 es miércoles.
igual(
  rangoSemana("2026-10-21", { diaInicio: 1, diaFin: 7 }),
  { inicio: "2026-10-19", fin: "2026-10-25" },
  "Lun→Dom alrededor del miércoles 2026-10-21"
);
// Ciclo que NO arranca en lunes: Viernes(5)→Martes(2).
igual(
  rangoSemana("2026-10-21", { diaInicio: 5, diaFin: 2 }),
  { inicio: "2026-10-16", fin: "2026-10-20" },
  "Vie→Mar: el miércoles 2026-10-21 cae en la semana que abrió el viernes 16"
);
igual(
  rangoSemana("2026-10-17", { diaInicio: 5, diaFin: 2 }),
  { inicio: "2026-10-16", fin: "2026-10-20" },
  "Vie→Mar: el sábado 17 sigue en la misma semana"
);
// Ciclo de un solo día (inicio = fin): la "semana" es ese día.
igual(
  rangoSemana("2026-10-21", { diaInicio: 3, diaFin: 3 }),
  { inicio: "2026-10-21", fin: "2026-10-21" },
  "ciclo de un solo día: inicio = fin"
);
// Entradas basura: cae al default L→D.
igual(
  rangoSemana("2026-10-21", { diaInicio: 99, diaFin: -1 }),
  { inicio: "2026-10-19", fin: "2026-10-25" },
  "días fuera de rango (1..7) caen al default"
);

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 3 — ¿la jugada cae dentro de la ventana?");
// ---------------------------------------------------------------------------
const cicloLD = { diaInicio: 1, diaFin: 7 };
// Día en curso.
si(dentroDeVentana("2026-10-21", "2026-10-21", "SOLO_DIA_EN_CURSO"), "día: la de hoy sí");
si(!dentroDeVentana("2026-10-20", "2026-10-21", "SOLO_DIA_EN_CURSO"), "día: la de ayer NO");
si(!dentroDeVentana("2026-10-22", "2026-10-21", "SOLO_DIA_EN_CURSO"), "día: la de mañana NO (futuro)");
// Semana en curso.
si(dentroDeVentana("2026-10-20", "2026-10-21", "SEMANA_EN_CURSO", cicloLD), "semana: la de ayer sí");
si(dentroDeVentana("2026-10-19", "2026-10-21", "SEMANA_EN_CURSO", cicloLD), "semana: el lunes (inicio) sí");
si(!dentroDeVentana("2026-10-18", "2026-10-21", "SEMANA_EN_CURSO", cicloLD), "semana: el domingo anterior NO");
si(!dentroDeVentana("2026-10-26", "2026-10-21", "SEMANA_EN_CURSO", cicloLD), "semana: la del lunes siguiente NO");
si(!dentroDeVentana("2026-10-25", "2026-10-21", "SEMANA_EN_CURSO", cicloLD), "semana: el domingo siguiente todavía NO (futuro)");
// Fechas inválidas / vacías: cerrar siempre.
si(!dentroDeVentana("", "2026-10-21", "SEMANA_EN_CURSO", cicloLD), "fecha vacía → false");
si(!dentroDeVentana(null, "2026-10-21", "SOLO_DIA_EN_CURSO"), "fecha null → false");
si(!dentroDeVentana("21/10/2026", "2026-10-21", "SOLO_DIA_EN_CURSO"), "formato no ISO → false");
si(!dentroDeVentana("2026-10-21", "", "SEMANA_EN_CURSO", cicloLD), "hoy vacío → false");
// Ciclo que cruza: Vie→Mar, hoy miércoles 21 → semana [16..20]; el 20 sí, el 21 no.
si(dentroDeVentana("2026-10-20", "2026-10-21", "SEMANA_EN_CURSO", { diaInicio: 5, diaFin: 2 }), "Vie→Mar: el martes 20 sí");
si(!dentroDeVentana("2026-10-21", "2026-10-21", "SEMANA_EN_CURSO", { diaInicio: 5, diaFin: 2 }), "Vie→Mar: el propio miércoles 21 NO (ya cerró la semana)");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 4 — topes y pisos para el input de fecha");
// ---------------------------------------------------------------------------
igual(fechaTopeReclamo("2026-10-21", "SOLO_DIA_EN_CURSO"), "2026-10-21", "día: tope = hoy");
igual(fechaPisoReclamo("2026-10-21", "SOLO_DIA_EN_CURSO"), "2026-10-21", "día: piso = hoy");
igual(fechaPisoReclamo("2026-10-21", "SEMANA_EN_CURSO", cicloLD), "2026-10-19", "semana: piso = lunes de la semana");
igual(fechaTopeReclamo("2026-10-21", "SEMANA_EN_CURSO", cicloLD), "2026-10-25", "semana: tope = domingo de la semana");
// El tope de la semana puede ser FUTURO (viernes 23 → domingo 25); el filtro
// por "no futuro" lo hace `dentroDeVentana`, no el input.
igual(fechaTopeReclamo("2026-10-23", "SEMANA_EN_CURSO", cicloLD), "2026-10-25", "semana: tope futuro permitido en el input");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 5 — texto de la ventana");
// ---------------------------------------------------------------------------
si(/día de hoy/i.test(explicarVentana("SOLO_DIA_EN_CURSO")), "explica el modo día");
si(/semana en curso/i.test(explicarVentana("SEMANA_EN_CURSO")), "explica el modo semana");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 6 — el servidor y el modal comparten el cálculo");
// ---------------------------------------------------------------------------
const fn = leer("supabase", "functions", "portal-auth", "index.ts");
si(/function rangoVentana/.test(fn), "la Edge Function define rangoVentana");
si(/SOLO_DIA_EN_CURSO/.test(fn) && /SEMANA_EN_CURSO/.test(fn), "la Edge Function conoce los dos modos");
si(/ventana_reclamos/.test(fn), "la Edge Function lee grupos_venta.ventana_reclamos");

const modal = leer("src", "features", "portal", "components", "ModalJugadaNoRelacionada.tsx");
si(/fechaPisoReclamo/.test(modal) && /fechaTopeReclamo/.test(modal), "el modal usa piso/tope del núcleo");
si(/normalizarVentana/.test(modal), "el modal normaliza la ventana del grupo");

const portal = leer("src", "features", "portal", "components", "PortalModule.tsx");
si(/dentroDeVentana/.test(portal), "el reporte del portal decide el botón con dentroDeVentana");

const grupos = leer("src", "features", "grupos", "components", "GruposModule.tsx");
si(/actualizarVentanaReclamos/.test(grupos), "GruposModule guarda la ventana con actualizarVentanaReclamos");

const libGrupos = leer("src", "features", "grupos", "lib", "grupos.ts");
si(/ventana_reclamos/.test(libGrupos), "grupos.ts expone ventana_reclamos (GrupoRow)");
si(/export async function actualizarVentanaReclamos/.test(libGrupos), "grupos.ts define actualizarVentanaReclamos");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 7 — migración SQL: columna, check y RPC");
// ---------------------------------------------------------------------------
const sql = leer("sql", "portal_jugadas_reclamos.sql");
si(/add column if not exists ventana_reclamos/.test(sql), "trae la columna ventana_reclamos");
si(/SOLO_DIA_EN_CURSO/.test(sql) && /SEMANA_EN_CURSO/.test(sql), "el check admite los dos modos");
si(/create or replace function public\.club_actualizar_ventana_reclamos/.test(sql), "define la RPC club_actualizar_ventana_reclamos");
si(/create or replace function public\.club_portal_vender_polla/.test(sql), "define la RPC de venta de Polla del portal");
si(/club_portal_vender_polla\(uuid, jsonb, uuid, uuid, text\)/.test(sql), "la firma de la RPC de Polla es de 5 parámetros");
si(/security definer/i.test(sql), "las RPC corren con security definer");

// ---------------------------------------------------------------------------
console.log(`\n${pasan} pasaron, ${fallan} fallaron`);
process.exit(fallan > 0 ? 1 : 0);
