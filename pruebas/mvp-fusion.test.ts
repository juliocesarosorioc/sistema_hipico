// ============================================================================
// MVP FUSION — La Rinconada, 5ta carrera (domingo 11/10/2026).
//
// Validación END-TO-END de la carga de un resultado: el plano real que se pega
// en Carga Rápida (líneas numeradas "N) Juega X … con … da Y") se estructura en
// las 5 columnas con `normalizarLineaRapida`, se resuelve con el MISMO motor
// universal de la liquidación (`mensajeResultadoDeCarrera` → `liquidarOficial`)
// y el texto resultante tiene que reproducir jugada por jugada el balance que
// suministra la casa (incluido el cierre 🟢 POSITIVOS / 🔴 NEGATIVOS).
//
// Protege DOS errores reales de liquidación de la familia NINI que el plano
// destapó:
//   1. "2Y2N" (COMBINADA 2p+2n): el "da" entrega el BRUTO real del motor
//      (½ del capital), no el capital entero. Antes el reporte devolvía
//      `-10.000,00` en vez de `-5.000,00` y ensuciaba el cierre.
//   2. "2N" con el caballo JUSTO en el puesto N: la jugada se ANULA y se
//      devuelve el capital → 0/0 (ni gana el que juega ni el "da"). Antes se
//      contaba como pérdida (`-19.753,00` / `+18.765,35`).
//
// Pizarra oficial: 5.3.2.6.7  (1º 5, 2º 3).
// ============================================================================
import { normalizarLineaRapida } from "../src/features/taquilla/lib/normalizar";
import { mensajeResultadoDeCarrera } from "../src/features/taquilla/lib/mensajeResultado";
import { fmtMonto } from "../src/features/impresion/lib/reportGenerator";
import type { PizarraCarrera } from "../src/features/liquidacion/lib/liquidacion";

let pasan = 0;
let fallan = 0;

function ok(nombre: string, condicion: boolean, detalle = "") {
  if (condicion) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}${detalle ? "\n         " + detalle : ""}`);
  }
}

type JugadaMvp = {
  /** Línea tal cual se pega en Carga Rápida (con el índice de lista "N)"). */
  linea: string;
  /** Nomenclatura canónica que muestra el reporte (j.y NINI en mayúscula). */
  jugada: string;
  caballo: string;
  monto: number;
  juega: string;
  consigue: string;
  /** Ganancia NETA del que juega (lo que muestra "Juega X $ +…"). */
  gn: number;
  /** Bruto que entrega el "da" (lo que muestra "Consigue Y $ -…"). */
  gb: number;
  /** Jugada anulada → 0/0 (se devuelve el capital). */
  anulada?: boolean;
};

const JUGADAS: JugadaMvp[] = [
  { linea: "1) Juega Gaelito 10A9 (5) con 5.000,00 da Toño", jugada: "10A9", caballo: "5", monto: 5000, juega: "Gaelito", consigue: "Toño", gn: 4275, gb: 4500 },
  { linea: "2) Juega Dinero 10A8 (5) con 20.000,00 da Vendi", jugada: "10A8", caballo: "5", monto: 20000, juega: "Dinero", consigue: "Vendi", gn: 15200, gb: 16000 },
  { linea: "3) Juega Dinero 10A8 (5) con 5.000,00 da Toño", jugada: "10A8", caballo: "5", monto: 5000, juega: "Dinero", consigue: "Toño", gn: 3800, gb: 4000 },
  { linea: "4) Juega Dinero 10A8 (5) con 50.000,00 da Kiliam", jugada: "10A8", caballo: "5", monto: 50000, juega: "Dinero", consigue: "Kiliam", gn: 38000, gb: 40000 },
  { linea: "5) Juega Rinconada 10A8 (5) con 20.000,00 da Kiliam", jugada: "10A8", caballo: "5", monto: 20000, juega: "Rinconada", consigue: "Kiliam", gn: 15200, gb: 16000 },
  { linea: "6) Juega Gaelito 10A8 (5) con 50.000,00 da Kiliam", jugada: "10A8", caballo: "5", monto: 50000, juega: "Gaelito", consigue: "Kiliam", gn: 38000, gb: 40000 },
  { linea: "7) Juega Cesar 10A8 (5) con 20.000,00 da Kiliam", jugada: "10A8", caballo: "5", monto: 20000, juega: "Cesar", consigue: "Kiliam", gn: 15200, gb: 16000 },
  { linea: "8) Juega Dinero 10A8 (5) con 50.000,00 da Yayaju", jugada: "10A8", caballo: "5", monto: 50000, juega: "Dinero", consigue: "Yayaju", gn: 38000, gb: 40000 },
  { linea: "9) Juega Benelli 10A8 (5) con 20.000,00 da Kiliam", jugada: "10A8", caballo: "5", monto: 20000, juega: "Benelli", consigue: "Kiliam", gn: 15200, gb: 16000 },
  { linea: "10) Juega Cesar 10A8 (5) con 10.000,00 da Kiliam", jugada: "10A8", caballo: "5", monto: 10000, juega: "Cesar", consigue: "Kiliam", gn: 7600, gb: 8000 },
  { linea: "11) Juega Yire 10A9 (5) con 18.000,00 da Portugal", jugada: "10A9", caballo: "5", monto: 18000, juega: "Yire", consigue: "Portugal", gn: 15390, gb: 16200 },
  { linea: "12) Juega Pitufo 10A9 (5) con 25.000,00 da Chivo", jugada: "10A9", caballo: "5", monto: 25000, juega: "Pitufo", consigue: "Chivo", gn: 21375, gb: 22500 },
  { linea: "13) Juega Pitufo 10A9 (5) con 30.000,00 da Mathia", jugada: "10A9", caballo: "5", monto: 30000, juega: "Pitufo", consigue: "Mathia", gn: 25650, gb: 27000 },
  { linea: "14) Juega Rafa 10A9 (5) con 200.000,00 da Kiliam", jugada: "10A9", caballo: "5", monto: 200000, juega: "Rafa", consigue: "Kiliam", gn: 171000, gb: 180000 },
  { linea: "15) Juega Guason 10A9 (5) con 14.000,00 da Kiliam", jugada: "10A9", caballo: "5", monto: 14000, juega: "Guason", consigue: "Kiliam", gn: 11970, gb: 12600 },
  { linea: "16) Juega Alana 2Y2N (3) con 10.000,00 da Pinto", jugada: "2Y2N", caballo: "3", monto: 10000, juega: "Alana", consigue: "Pinto", gn: 4750, gb: 5000 },
  { linea: "17) Juega Cesar 10A9 (5) con 10.000,00 da Kiliam", jugada: "10A9", caballo: "5", monto: 10000, juega: "Cesar", consigue: "Kiliam", gn: 8550, gb: 9000 },
  { linea: "18) Juega Korea 10A9 (5) con 10.000,00 da Kiliam", jugada: "10A9", caballo: "5", monto: 10000, juega: "Korea", consigue: "Kiliam", gn: 8550, gb: 9000 },
  { linea: "19) Juega Amarillo 10A9 (5) con 30.000,00 da Yayaju", jugada: "10A9", caballo: "5", monto: 30000, juega: "Amarillo", consigue: "Yayaju", gn: 25650, gb: 27000 },
  { linea: "20) Juega Gaelito 10A9 (5) con 50.000,00 da Kiliam", jugada: "10A9", caballo: "5", monto: 50000, juega: "Gaelito", consigue: "Kiliam", gn: 42750, gb: 45000 },
  { linea: "21) Juega Jarry 10A9 (5) con 8.000,00 da Yayaju", jugada: "10A9", caballo: "5", monto: 8000, juega: "Jarry", consigue: "Yayaju", gn: 6840, gb: 7200 },
  { linea: "22) Juega Gaelito 10A9 (5) con 50.000,00 da Ch", jugada: "10A9", caballo: "5", monto: 50000, juega: "Gaelito", consigue: "Ch", gn: 42750, gb: 45000 },
  { linea: "23) Juega Pitufo 10A9 (5) con 200.000,00 da Kiliam", jugada: "10A9", caballo: "5", monto: 200000, juega: "Pitufo", consigue: "Kiliam", gn: 171000, gb: 180000 },
  { linea: "24) Juega Dinero 10A9 (5) con 40.000,00 da Kiliam", jugada: "10A9", caballo: "5", monto: 40000, juega: "Dinero", consigue: "Kiliam", gn: 34200, gb: 36000 },
  { linea: "25) Juega Zorro 10A9 (5) con 50.000,00 da Kiliam", jugada: "10A9", caballo: "5", monto: 50000, juega: "Zorro", consigue: "Kiliam", gn: 42750, gb: 45000 },
  { linea: "26) Juega Zorro 10A9 (5) con 50.000,00 da Alambre", jugada: "10A9", caballo: "5", monto: 50000, juega: "Zorro", consigue: "Alambre", gn: 42750, gb: 45000 },
  { linea: "27) Juega Zorro 10A9 (5) con 9.555,56 da Gianis", jugada: "10A9", caballo: "5", monto: 9555.56, juega: "Zorro", consigue: "Gianis", gn: 8170, gb: 8600 },
  { linea: "28) Juega Super 2Y2N (3) con 5.000,00 da Angelo", jugada: "2Y2N", caballo: "3", monto: 5000, juega: "Super", consigue: "Angelo", gn: 2375, gb: 2500 },
  { linea: "29) Juega Arevalo 10A9 (5) con 20.000,00 da Alambre", jugada: "10A9", caballo: "5", monto: 20000, juega: "Arevalo", consigue: "Alambre", gn: 17100, gb: 18000 },
  { linea: "30) Juega Profe 1P (5) con 10.000,00 da Gari", jugada: "1P", caballo: "5", monto: 10000, juega: "Profe", consigue: "Gari", gn: 9500, gb: 10000 },
  { linea: "31) Juega Paizita 10A9 (5) con 20.000,00 da Shango", jugada: "10A9", caballo: "5", monto: 20000, juega: "Paizita", consigue: "Shango", gn: 17100, gb: 18000 },
  { linea: "32) Juega Paizita 10A9 (5) con 50.000,00 da Entubado", jugada: "10A9", caballo: "5", monto: 50000, juega: "Paizita", consigue: "Entubado", gn: 42750, gb: 45000 },
  { linea: "33) Juega Profe 10A9 (5) con 13.312,82 da Batman", jugada: "10A9", caballo: "5", monto: 13312.82, juega: "Profe", consigue: "Batman", gn: 11382.46, gb: 11981.54 },
  { linea: "34) Juega Profe 10A9 (5) con 5.000,00 da Newyork", jugada: "10A9", caballo: "5", monto: 5000, juega: "Profe", consigue: "Newyork", gn: 4275, gb: 4500 },
  { linea: "35) Juega Fantastico 1P (5) con 10.000,00 da Loyalty", jugada: "1P", caballo: "5", monto: 10000, juega: "Fantastico", consigue: "Loyalty", gn: 9500, gb: 10000 },
  { linea: "36) Juega Paizita 10A9 (5) con 13.778,89 da Ps", jugada: "10A9", caballo: "5", monto: 13778.89, juega: "Paizita", consigue: "Ps", gn: 11780.95, gb: 12401 },
  { linea: "37) Juega Paizita 10A9 (5) con 10.000,00 da Ardilla", jugada: "10A9", caballo: "5", monto: 10000, juega: "Paizita", consigue: "Ardilla", gn: 8550, gb: 9000 },
  { linea: "38) Juega Paizita 10A9 (5) con 90.000,00 da Kk", jugada: "10A9", caballo: "5", monto: 90000, juega: "Paizita", consigue: "Kk", gn: 76950, gb: 81000 },
  { linea: "39) Juega Toyota 2N (3) con 19.753,00 da Angelo", jugada: "2N", caballo: "3", monto: 19753, juega: "Toyota", consigue: "Angelo", gn: 0, gb: 0, anulada: true },
];

const PIZARRA: PizarraCarrera = {
  primero: "5",
  segundo: "3",
  tercero: "2",
  cuarto: "6",
  quinto: "7",
  sexto: "",
  septimo: "",
  octavo: "",
};

/** Catálogo de clientes (los nombres tal como los matchea la Carga Rápida). */
const CLIENTES = [...new Set(JUGADAS.flatMap((j) => [j.juega, j.consigue]))].map((nombre) => ({ nombre }));

// ---------------------------------------------------------------------------
console.log("\n[1] CARGA RÁPIDA: el plano numerado se estructura en 5 columnas");
// ---------------------------------------------------------------------------
for (const j of JUGADAS) {
  const r = normalizarLineaRapida(j.linea, { clientes: CLIENTES });
  if (!r || !r.ok) {
    ok(`fila ${j.jugada} ${j.caballo} parsea`, false, r && !r.ok ? r.motivo : "null");
    continue;
  }
  ok(
    `fila ${j.jugada} (${j.caballo}) ${j.juega} → ${j.consigue}`,
    r.jugada === j.jugada &&
      r.caballo === j.caballo &&
      Number(r.monto.replace(/\./g, "").replace(",", ".")) === j.monto &&
      r.cliente1 === j.juega &&
      r.cliente2 === j.consigue,
    `obtenido: ${r.jugada} (${r.caballo}) ${r.monto} ${r.cliente1} da ${r.cliente2}`
  );
}

// ---------------------------------------------------------------------------
console.log("\n[2] LIQUIDACIÓN: cada jugada muestra su balance exacto");
// ---------------------------------------------------------------------------
const mensaje = mensajeResultadoDeCarrera({
  hipodromo: "La Rinconada",
  carrera: "5ta",
  fecha: "2026-10-11",
  grupo: "MVP FUSION",
  pizarra: PIZARRA,
  tickets: JUGADAS.map((j) => ({
    comando: j.jugada,
    monto: j.monto,
    caballo: j.caballo,
    cliente1: j.juega,
    cliente2: j.consigue,
  })),
  tasaComision: 5,
});

for (const j of JUGADAS) {
  const n = JUGADAS.indexOf(j) + 1;
  const bloque = j.anulada
    ? `${n}) ${j.jugada} (${j.caballo}) con ${fmtMonto(j.monto)}\nJuega ${j.juega} $ +0,00\nConsigue ${j.consigue} $ +0,00`
    : `${n}) ${j.jugada} (${j.caballo}) con ${fmtMonto(j.monto)}\nJuega ${j.juega} $ +${fmtMonto(j.gn)}\nConsigue ${j.consigue} $ -${fmtMonto(j.gb)}`;
  ok(`bloque ${n}) ${j.jugada} (${j.caballo})`, mensaje.includes(bloque), `esperado:\n${bloque}`);
}

// ---------------------------------------------------------------------------
console.log("\n[3] CIERRE: POSITIVOS / NEGATIVOS (suma por cliente)");
// ---------------------------------------------------------------------------
const netos = new Map<string, number>();
for (const j of JUGADAS) {
  if (j.anulada) continue;
  netos.set(j.juega, (netos.get(j.juega) ?? 0) + j.gn);
  netos.set(j.consigue, (netos.get(j.consigue) ?? 0) - j.gb);
}
const positivos = [...netos.entries()].filter(([, v]) => v > 0.0001).sort((a, b) => b[1] - a[1]);
const negativos = [...netos.entries()].filter(([, v]) => v < -0.0001).sort((a, b) => a[1] - b[1]);

ok("19 clientes en POSITIVOS", positivos.length === 19, `obtenido ${positivos.length}`);
ok("21 clientes en NEGATIVOS", negativos.length === 21, `obtenido ${negativos.length}`);
for (const [nombre, valor] of positivos) {
  ok(`POSITIVO ${nombre} +${fmtMonto(valor)}`, mensaje.includes(`${nombre} +${fmtMonto(valor)}`));
}
for (const [nombre, valor] of negativos) {
  ok(`NEGATIVO ${nombre} -${fmtMonto(Math.abs(valor))}`, mensaje.includes(`${nombre} -${fmtMonto(Math.abs(valor))}`));
}
// Angelo queda NEGATIVO (-2.500,00) por la anulada; Toyota no aparece (0/0).
ok("Angelo cierra en -2.500,00 (anulada restada)", mensaje.includes("Angelo -2.500,00"));
ok("Toyota NO aparece en el cierre (anulada 0/0)", !/Toyota [+-]/.test(mensaje));
ok("no queda la regresión +13.765,35 de Angelo", !mensaje.includes("Angelo +13.765,35"));

console.log(`\nTODAS: ${pasan} pasaron, ${fallan} fallaron`);
if (fallan) process.exit(1);
