// ============================================================================
// CUADERNO DE JUGADAS — agregación (libro manual, entre varios grupos).
//
// Fija las reglas de `resumenCuaderno` que usan los reportes del Cuaderno:
//
//   A. `apostado` = suma de `monto` de TODOS los apuntes; `premios` = suma de
//      `premio` SOLO de los 'Ganada'; `neto` = premios - apostado.
//   B. `pendiente` = suma de `monto` de los 'Pendiente' (todavía en riesgo).
//   C. Se agrupa por `grupo_nombre` (texto libre: sirve para grupos que NO
//      están registrados) y por semana lunes→domingo.
//   D. Fechas rotas o `monto`/`premio` como texto (PostgREST devuelve `numeric`
//      string) no rompen los totales: se normalizan.
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import {
  inicioSemana,
  num,
  resumenCuaderno,
  sumarDiasIso,
  etiquetaSemana,
  type CuadernoFila,
} from "../src/features/clientes/lib/cuadernoResumen";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => { pasan++; console.log(`  ok   ${m}`); };
const mal = (m: string, d?: string) => { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };
const igual = (real: unknown, esperado: unknown, m: string) =>
  JSON.stringify(real) === JSON.stringify(esperado)
    ? ok(`${m} -> ${JSON.stringify(real)}`)
    : mal(m, `esperado ${JSON.stringify(esperado)}, llego ${JSON.stringify(real)}`);

const base = (p: Partial<CuadernoFila>): CuadernoFila => ({
  id: 1,
  cliente_id: "c1",
  grupo_nombre: "GRUPO A",
  fecha: "2026-10-14", // miércoles
  monto: 10,
  premio: 0,
  estado: "Pendiente",
  ...p,
});

console.log("\n== num (numeric string de PostgREST) ==");
igual(num("12.5"), 12.5, "string numérico");
igual(num(null), 0, "null → 0");
igual(num("abc"), 0, "basura → 0");
igual(num(undefined), 0, "undefined → 0");

console.log("\n== semanas (lunes a domingo) ==");
igual(inicioSemana("2026-10-14"), "2026-10-12", "miércoles → lunes de esa semana");
igual(inicioSemana("2026-10-12"), "2026-10-12", "lunes queda lunes");
igual(inicioSemana("2026-10-18"), "2026-10-12", "domingo pertenece a la semana que abrió el lunes");
igual(inicioSemana(""), "", "fecha vacía se devuelve tal cual");
igual(sumarDiasIso("2026-10-12", 6), "2026-10-18", "lunes + 6 = domingo");
igual(etiquetaSemana("2026-10-12"), "2026-10-12 → 2026-10-18", "etiqueta de la semana");

console.log("\n== totales globales ==");
const filas: CuadernoFila[] = [
  base({ id: 1, grupo_nombre: "GRUPO A", fecha: "2026-10-14", monto: 10, estado: "Pasada" }), // estado inválido: NO suma premio, NO es pendiente
  base({ id: 2, grupo_nombre: "GRUPO A", fecha: "2026-10-14", monto: 20, premio: 50, estado: "Ganada" }),
  base({ id: 3, grupo_nombre: "GRUPO B", fecha: "2026-10-15", monto: 5, estado: "Perdida" }),
  base({ id: 4, grupo_nombre: "GRUPO B", fecha: "2026-10-21", monto: 8, estado: "Pendiente" }),
  base({ id: 5, grupo_nombre: "GRUPO EXTERNO (no registrado)", fecha: "2026-10-22", monto: "12", estado: "Reembolsada" }),
];

const r = resumenCuaderno(filas);
igual(r.totales.jugadas, 5, "cuenta todas las jugadas");
igual(r.totales.apostado, 55, "apostado = 10+20+5+8+12");
igual(r.totales.premios, 50, "premios = solo la Ganada");
igual(r.totales.neto, -5, "neto = premios - apostado");
igual(r.totales.pendiente, 8, "pendiente = solo las Pendiente");

console.log("\n== por grupo (incluye grupos NO registrados) ==");
igual(r.porGrupo.map((g) => g.grupo), ["GRUPO A", "GRUPO B", "GRUPO EXTERNO (no registrado)"], "ordenado por apostado desc");
const gb = r.porGrupo.find((g) => g.grupo === "GRUPO B")!;
igual([gb.apostado, gb.premios, gb.neto, gb.pendiente], [13, 0, -13, 8], "GRUPO B: 5 perdida + 8 pendiente");
const gext = r.porGrupo.find((g) => g.grupo.includes("EXTERNO"))!;
igual([gext.apostado, gext.neto, gext.pendiente], [12, -12, 0], "el grupo externo aparece aunque no esté en el sistema");

console.log("\n== por semana (la del 21 y 22 cae en la misma) ==");
igual(r.porSemana.map((s) => s.inicio), ["2026-10-19", "2026-10-12"], "de la más reciente a la más vieja");
const semVieja = r.porSemana.find((s) => s.inicio === "2026-10-12")!;
igual([semVieja.apostado, semVieja.premios], [35, 50], "semana del 12: $35 jugados, $50 de premio");
const semNueva = r.porSemana.find((s) => s.inicio === "2026-10-19")!;
igual(semNueva.fin, "2026-10-25", "cierra el domingo");
igual([semNueva.apostado, semNueva.pendiente], [20, 8], "semana del 19: 8 pendiente + 12 reembolsado");

console.log("\n== grupo en blanco cae en SIN GRUPO ==");
const soloBlanco = resumenCuaderno([base({ grupo_nombre: "   ", monto: 3 })]);
igual(soloBlanco.porGrupo[0].grupo, "SIN GRUPO", "nombre vacío → SIN GRUPO");

console.log("\n== vacío no rompe ==");
const vacio = resumenCuaderno([]);
igual(vacio.totales, { jugadas: 0, apostado: 0, premios: 0, neto: 0, pendiente: 0 }, "totales en cero");
igual(vacio.porGrupo.length, 0, "sin grupos");
igual(vacio.porSemana.length, 0, "sin semanas");

console.log("\n== fecha rota no desaparece del reporte ==");
const rota = resumenCuaderno([base({ fecha: "no-es-fecha", monto: 4 })]);
igual(rota.totales.apostado, 4, "suma igual");
igual(rota.porSemana.length, 1, "cae en su propio grupo de semana");

console.log(`\n  ${pasan} ok, ${fallan} fallaron`);
if (fallan > 0) process.exit(1);
