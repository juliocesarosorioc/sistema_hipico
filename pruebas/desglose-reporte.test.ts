// ============================================================================
// BLOQUE 5 — DESGLOSE EXPLÍCITO DE EJEMPLARES EN EL REPORTE DE LIQUIDACIÓN.
//
// El reporte NUNCA muestra una jugada sin sus ejemplares, y la columna "Jugada"
// va COMPACTA (sin rótulos largos):
//   · Marcas contra la banca → "2 x 8" (o "(3, 5) x (8, 9)" con varios por
//     lado, sin la palabra "MARCA" ni los "#"). El ticket guarda el número
//     elegido y los rivales en `nota_auditoria.rivales_snapshot`.
//   · Tablas Fijas → "TABLA FIJA 6": solo la modalidad y el Nº de ejemplar (sin
//     el rótulo del hipódromo ni el nombre del caballo).
//   · El resto de las jugadas pasa intacto.
//
// También protege que el rotulado nuevo NO contamine el resto del reporte:
//   · `etiquetaJugada` no lo convierte en "PP" (pareo sin fracción);
//   · `rotuloPareo` no le pega el badge "10/10";
//   · los discos siguen pintando un ejemplar por número;
//   · `armarReporteCarrera` lo clasifica igual en «Parada Adelantadas».
//
// Corre con:  node pruebas/correr.cjs   (o npx tsx pruebas/desglose-reporte.test.ts)
// ============================================================================
import { desgloseJugada, esMarca, esTablaFija } from "../src/features/liquidacion/lib/etiquetas-reporte";
import { etiquetaJugada, rotuloPareo, ladosDePareo, caballoPareoLegible } from "../src/features/taquilla/lib/nomenclatura";
import { numerosDeCaballo } from "../src/features/saldos/lib/discos";
import { armarReporteCarrera } from "../src/features/liquidacion/lib/reporte-carrera";
import type { CarreraReporte } from "../src/features/liquidacion/lib/reportes";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => { pasan++; console.log(`  ok   ${m}`); };
const mal = (m: string, d?: string) => { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };
const si = (c: boolean, m: string, d?: string) => (c ? ok(m) : mal(m, d));
const igual = (a: unknown, b: unknown, m: string) =>
  si(JSON.stringify(a) === JSON.stringify(b), m, `esperado ${JSON.stringify(b)} · recibido ${JSON.stringify(a)}`);

console.log("\nBLOQUE 5 — desglose de ejemplares (núcleo puro)");

// Fila cruda de una MARCA tal como la escribe club_vender_marca: el número
// elegido en `caballo`/`ejemplar_numero`, el rival en la nota de auditoría.
const filaMarca = (over: Record<string, unknown> = {}) => ({
  id: "mk-1",
  hipodromo: "SANTA ANITA",
  carrera: 7,
  nombre_jugada: "MARCA 8",
  caballo: "8",
  ejemplar_numero: 8,
  nota_auditoria: JSON.stringify({ origen: "MARCAS", tipo_matchup: "CONTRA_UNO", rivales_snapshot: [3] }),
  ...over,
});

const marca = desgloseJugada(filaMarca());
igual(marca.jugada, "8 x 3", "marca 1 vs 1 se rotula compacta (sin 'MARCA' ni '#')");
igual(marca.caballo, "8x3", "caballo en formato pareo para pintar los discos de los dos lados");
igual(marca.ejemplar, "8 x 3", "desglose breve = mismo enfrentamiento compacto");
igual(marca.tipo, "MARCA", "el tipo de jugada viaja explícito para clasificar la parada");

// Varios rivales: el número elegido va solo, los rivales entre paréntesis.
const marcaVsVarios = desgloseJugada(filaMarca({ nota_auditoria: JSON.stringify({ rivales_snapshot: [3, 5] }) }));
igual(marcaVsVarios.jugada, "8 x (3, 5)", "marca contra varios rivales");
igual(marcaVsVarios.caballo, "8x3,5", "discos del elegido contra los dos rivales");

// Matchup con varios por lado: formato de la casa "(A, B) x (C, D)".
const marcaDoble = desgloseJugada(
  filaMarca({ nombre_jugada: "MARCA 3,5", caballo: "3,5", ejemplar_numero: null, nota_auditoria: JSON.stringify({ rivales_snapshot: [8, 9] }) })
);
igual(marcaDoble.jugada, "(3, 5) x (8, 9)", "marca doble usa el formato «(…) x (…)»");
igual(marcaDoble.caballo, "3,5x8,9", "discos por lado en la marca doble");
igual(marcaDoble.ejemplar, "(3, 5) x (8, 9)", "desglose breve de la marca doble");

// Sin rivales (fila legacy): solo el número, sin inventar matchup.
const marcaSinRivales = desgloseJugada(filaMarca({ nota_auditoria: JSON.stringify({ origen: "MARCAS" }) }));
igual(marcaSinRivales.jugada, "8", "marca sin rivales rotula solo el número");
igual(marcaSinRivales.caballo, "8", "sin rivales no se arma pareo");

// Nota ya parseada (objeto, no string) — PostgREST puede devolverla así.
igual(desgloseJugada(filaMarca({ nota_auditoria: { rivales_snapshot: [2] } })).jugada, "8 x 2", "rivales desde objeto ya parseado");

// Sin nota ni número recuperable: no se inventa nada.
const marcaRota = desgloseJugada({ nombre_jugada: "MARCA", caballo: "", ejemplar_numero: null, nota_auditoria: null });
igual(marcaRota.jugada, "MARCA", "marca sin datos no inventa ejemplares");
igual(marcaRota.caballo, "", "marca sin datos deja el caballo vacío");
igual(marcaRota.tipo, "MARCA", "marca sin datos conserva su tipo");

console.log("\nBLOQUE 5 — Tablas Fijas");

// Fila cruda de TABLA FIJA (sql/tablas_venta.sql): número en
// `ejemplar_numero`, NOMBRE congelado en `caballo`.
const filaTabla = (over: Record<string, unknown> = {}) => ({
  id: "tf-1",
  hipodromo: "LA PRADERA",
  carrera: 4,
  nombre_jugada: "TABLA FIJA (LA PRADERA C4)",
  caballo: "Golfo",
  ejemplar_numero: 7,
  ...over,
});

const tabla = desgloseJugada(filaTabla());
igual(tabla.jugada, "TABLA FIJA 7", "tabla fija muestra SOLO la modalidad y el Nº de ejemplar");
igual(tabla.caballo, "7", "el disco se pinta con el NÚMERO (lo que decide contra la pizarra)");
igual(tabla.ejemplar, "7", "desglose breve = solo el número");
igual(tabla.tipo, "TABLA", "el tipo de jugada viaja explícito para clasificar la parada");

const tablaSinNombre = desgloseJugada(filaTabla({ caballo: "" }));
igual(tablaSinNombre.jugada, "TABLA FIJA 7", "sin nombre del caballo el rótulo no cambia (solo el número)");
igual(tablaSinNombre.ejemplar, "7", "desglose breve sin nombre");

// TABLA COMPLETA (todos los caballos): sin número no hay qué desglosar.
const tablaCompleta = desgloseJugada(filaTabla({ caballo: "", ejemplar_numero: null }));
igual(tablaCompleta.jugada, "TABLA FIJA (LA PRADERA C4)", "tabla completa queda sin desglose");
igual(tablaCompleta.caballo, "", "tabla completa no inventa número");
igual(tablaCompleta.tipo, "TABLA", "la tabla completa sigue siendo tipo TABLA");

console.log("\nBLOQUE 5 — el resto de las jugadas pasa intacto");

const otra = desgloseJugada({ nombre_jugada: "10A9", caballo: "1x8", ejemplar_numero: null });
igual(otra.jugada, "10A9", "pareo legacy no se toca");
igual(otra.caballo, "1x8", "caballo del pareo no se toca");
igual(desgloseJugada({ nombre_jugada: "TABLA 2", caballo: "2" }).jugada, "TABLA 2", "TABLA variable (no fija) no se toca");
igual(desgloseJugada({ nombre_jugada: "", caballo: "" }).jugada, "", "fila sin nombre_jugada no revienta");
si(esMarca("MARCA 8") && esMarca("MARCAS"), "esMarca reconoce singular y plural");
si(!esMarca("TABLA FIJA (X C1)"), "esMarca no confunde con tablas");
si(esTablaFija("TABLA FIJA (LA PRADERA C4)"), "esTablaFija reconoce la nomenclatura de la casa");
si(!esTablaFija("TABLA 2"), "'TABLA 2' NO es Tabla Fija");

console.log("\nBLOQUE 5 — compatibilidad con discos, rótulos y badges");

const lados = ladosDePareo(marca.caballo);
igual(lados, { juega: "8", da: "3" }, "la plantilla separa los lados de la marca");
igual(caballoPareoLegible(marca.caballo), "8 X 3", "árbol de Saldos / Historial lo muestra legible");
igual(numerosDeCaballo(marcaVsVarios.caballo), ["8", "3", "5"], "un disco por ejemplar del matchup");
igual(numerosDeCaballo(tabla.caballo), ["7"], "un solo disco para la tabla fija");
// `etiquetaJugada` por sí sola SÍ vería "N x N" como un pareo; por eso el
// reporte NO la aplica a Marcas ni Tablas Fijas (usa el `tipo`) y el rótulo
// compacto no se contamina con "PP". Acá se documenta ese comportamiento.
igual(etiquetaJugada(marca.jugada), "PP", "etiquetaJugada por sí sola rotularía 'PP' un texto 'N x N'");
igual(rotuloPareo("2 x 8", marca.caballo), "", "rotuloPareo tampoco pega el badge a un 'N x N'");

console.log("\nBLOQUE 5 — Reporte de Carrera (Parada Adelantadas)");

// Filas ya desglosadas por `carreraReporte`: la parada adelantada debe
// describir al EJEMPLAR, no repetir el tipo de jugada. El `tipoJugada` viaja
// explícito porque la "Jugada" ya no lleva el prefijo de la modalidad.
const CARRERA: CarreraReporte = {
  numero: 7,
  hipodromo: "LA RINCONADA",
  fecha: "2026-10-12",
  pizarra: "8 · 3 · 2",
  subtotal: 0,
  filas: [
    {
      id: "2026-10-12-LA RINCONADA-7-j-0", rol: "Juega", cliente: "Fabio",
      jugada: marca.jugada, caballo: marca.caballo, ejemplar: marca.ejemplar, tipoJugada: marca.tipo,
      monto: 120, resultado: 40, esPareo: false,
    },
    {
      id: "2026-10-12-LA RINCONADA-7-j-1", rol: "Juega", cliente: "Marlene",
      jugada: tabla.jugada, caballo: tabla.caballo, ejemplar: tabla.ejemplar, tipoJugada: tabla.tipo,
      monto: 500, resultado: 1200, esPareo: false,
    },
  ],
};
const d = armarReporteCarrera(CARRERA);
igual(d.jugadasVivo[0]?.jugo, "8 x 3", "la columna «Jugada» muestra la marca compacta (sin pasar por 'PP')");
igual(d.jugadasVivo[1]?.jugo, "TABLA FIJA 7", "la columna «Jugada» muestra la tabla fija compacta");
igual(d.adelantadas.marcas[0]?.descripcion, "8 x 3", "la parada de Marcas describe el matchup compacto");
igual(d.adelantadas.tablas[0]?.descripcion, "7", "la parada de Tablas Fijas describe solo el número");

// El `tipo` explícito clasifica la parada aunque el texto no lleve el prefijo.
si(d.adelantadas.marcas.length === 1 && d.adelantadas.tablas.length === 1, "cada ganadora cae en su sección por `tipoJugada`");

// Filas VIEJAS sin `ejemplar` (fixtures previos): siguen cayendo a `caballo`.
const vieja = armarReporteCarrera({
  ...CARRERA,
  filas: [
    {
      id: "2026-10-12-LA RINCONADA-7-j-9", rol: "Juega", cliente: "Pablo",
      jugada: "TABLA FIJA (LA RINCONADA C7)", caballo: "5", monto: 100, resultado: 30, esPareo: false,
    },
  ],
});
igual(vieja.adelantadas.tablas[0]?.descripcion, "5", "las filas sin ejemplar conservan el comportamiento anterior");

console.log(`\n  BLOQUE 5 DESGLOSE: ${pasan} ok, ${fallan} fallaron\n`);
if (fallan > 0) process.exit(1);
