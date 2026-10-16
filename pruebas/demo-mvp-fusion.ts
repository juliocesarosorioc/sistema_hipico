// ============================================================================
// DEMO END-TO-END · MVP FUSION — La Rinconada, 5ta carrera (11/10/2026)
//
// Prueba el flujo COMPLETO de "cargar el resultado", usando las MISMAS
// funciones que la app (no un atajo):
//
//   1) REGISTRO   · Carga Rápida: el plano real que se pega (líneas "N) Juega
//                   X … con … da Y") se estructura con `normalizarLineaRapida`.
//   2) CÁLCULO    · `resultadoDeJugada` (motor universal `liquidarOficial`):
//                   veredicto por jugada, comisión 5% y crédito al saldo.
//   3) SALDOS     · movimiento real de `clientes.saldo_actual` por jugador
//                   (gana: acredita; pierde: ya debitó al vender; anulada:
//                   devuelve el capital), como lo escribe `aplicarLiquidacionSaldos`.
//   4) MENSAJES   · los textos a pegar en el grupo:
//                     · PLANO DE JUGADAS      (`mensajePlanoDeCarrera`)
//                     · RELACIÓN DE RESULTADOS (`mensajeResultadoDeCarrera`)
//
// Corre con:
//   node node_modules/typescript/bin/tsc -p pruebas/tsconfig.json
//   node -r ./pruebas/_alias.cjs .tsbuild-pruebas/pruebas/demo-mvp-fusion.js
// ============================================================================
import { normalizarLineaRapida } from "../src/features/taquilla/lib/normalizar";
import {
  mensajePlanoDeCarrera,
  mensajeResultadoDeCarrera,
  resultadoDeJugada,
  type TicketMensaje,
} from "../src/features/taquilla/lib/mensajeResultado";
import {
  fmtMonto,
  relacionResultados,
  type MetaCarrera,
  type JugadaRelacion,
  type TicketApuestaJugada,
} from "../src/features/impresion/lib/reportGenerator";
import { parsearNini, normalizarNini } from "../src/features/betting/lib/bettingEngine";
import type { PizarraCarrera } from "../src/features/liquidacion/lib/liquidacion";

const GRUPO = "MVP FUSION";
const HIPODROMO = "La Rinconada";
const CARRERA = "5ta";
const FECHA = "2026-10-11";
const TASA = 5; // comisión casa: 5% sobre la ganancia bruta

/** Resultado oficial de la carrera (pizarra escrita por el operador en Ctrl+Y). */
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

/** Catálogo de clientes contra el que la Carga Rápida resuelve los nombres. */
const CATALOGO = [
  "Gaelito", "Toño", "Dinero", "Vendi", "Kiliam", "Rinconada", "Cesar", "Yayaju",
  "Benelli", "Yire", "Portugal", "Pitufo", "Chivo", "Mathia", "Rafa", "Guason",
  "Alana", "Pinto", "Korea", "Amarillo", "Jarry", "Ch", "Zorro", "Alambre",
  "Gianis", "Super", "Angelo", "Arevalo", "Profe", "Gari", "Paizita", "Shango",
  "Entubado", "Batman", "Newyork", "Fantastico", "Loyalty", "Ps", "Ardilla",
  "Kk", "Toyota",
];
const clientes = CATALOGO.map((nombre) => ({ nombre }));

/** El plano tal cual se pega en Carga Rápida (con el índice de lista "N)"). */
const PLANO = [
  "1) Juega Gaelito 10A9 (5) con 5.000,00 da Toño",
  "2) Juega Dinero 10A8 (5) con 20.000,00 da Vendi",
  "3) Juega Dinero 10A8 (5) con 5.000,00 da Toño",
  "4) Juega Dinero 10A8 (5) con 50.000,00 da Kiliam",
  "5) Juega Rinconada 10A8 (5) con 20.000,00 da Kiliam",
  "6) Juega Gaelito 10A8 (5) con 50.000,00 da Kiliam",
  "7) Juega Cesar 10A8 (5) con 20.000,00 da Kiliam",
  "8) Juega Dinero 10A8 (5) con 50.000,00 da Yayaju",
  "9) Juega Benelli 10A8 (5) con 20.000,00 da Kiliam",
  "10) Juega Cesar 10A8 (5) con 10.000,00 da Kiliam",
  "11) Juega Yire 10A9 (5) con 18.000,00 da Portugal",
  "12) Juega Pitufo 10A9 (5) con 25.000,00 da Chivo",
  "13) Juega Pitufo 10A9 (5) con 30.000,00 da Mathia",
  "14) Juega Rafa 10A9 (5) con 200.000,00 da Kiliam",
  "15) Juega Guason 10A9 (5) con 14.000,00 da Kiliam",
  "16) Juega Alana 2Y2N (3) con 10.000,00 da Pinto",
  "17) Juega Cesar 10A9 (5) con 10.000,00 da Kiliam",
  "18) Juega Korea 10A9 (5) con 10.000,00 da Kiliam",
  "19) Juega Amarillo 10A9 (5) con 30.000,00 da Yayaju",
  "20) Juega Gaelito 10A9 (5) con 50.000,00 da Kiliam",
  "21) Juega Jarry 10A9 (5) con 8.000,00 da Yayaju",
  "22) Juega Gaelito 10A9 (5) con 50.000,00 da Ch",
  "23) Juega Pitufo 10A9 (5) con 200.000,00 da Kiliam",
  "24) Juega Dinero 10A9 (5) con 40.000,00 da Kiliam",
  "25) Juega Zorro 10A9 (5) con 50.000,00 da Kiliam",
  "26) Juega Zorro 10A9 (5) con 50.000,00 da Alambre",
  "27) Juega Zorro 10A9 (5) con 9.555,56 da Gianis",
  "28) Juega Super 2Y2N (3) con 5.000,00 da Angelo",
  "29) Juega Arevalo 10A9 (5) con 20.000,00 da Alambre",
  "30) Juega Profe 1P (5) con 10.000,00 da Gari",
  "31) Juega Paizita 10A9 (5) con 20.000,00 da Shango",
  "32) Juega Paizita 10A9 (5) con 50.000,00 da Entubado",
  "33) Juega Profe 10A9 (5) con 13.312,82 da Batman",
  "34) Juega Profe 10A9 (5) con 5.000,00 da Newyork",
  "35) Juega Fantastico 1P (5) con 10.000,00 da Loyalty",
  "36) Juega Paizita 10A9 (5) con 13.778,89 da Ps",
  "37) Juega Paizita 10A9 (5) con 10.000,00 da Ardilla",
  "38) Juega Paizita 10A9 (5) con 90.000,00 da Kk",
  "39) Juega Toyota 2N (3) con 19.753,00 da Angelo",
];

const num = (monto: string) => Number(monto.replace(/\./g, "").replace(",", "."));
const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

// ---------------------------------------------------------------------------
console.log("=".repeat(74));
console.log("  DEMO END-TO-END · CARGA DE RESULTADO · " + GRUPO);
console.log(`  ${HIPODROMO} · ${CARRERA} carrera · ${FECHA}`);
console.log("=".repeat(74));

// 1) REGISTRO -----------------------------------------------------------------
console.log("\n[1] REGISTRO DEL RESULTADO (Carga Rápida)");
console.log(`    Pizarra: ${[PIZARRA.primero, PIZARRA.segundo, PIZARRA.tercero, PIZARRA.cuarto, PIZARRA.quinto].join(".")} (1º..5º)`);

const tickets: TicketMensaje[] = [];
for (const linea of PLANO) {
  const r = normalizarLineaRapida(linea, { clientes });
  if (!r) continue;
  if (!r.ok) {
    console.log(`    ✗ línea ilegible: ${linea} → ${r.motivo}`);
    continue;
  }
  tickets.push({
    comando: r.jugada,
    monto: num(r.monto),
    caballo: r.caballo,
    cliente1: r.cliente1,
    cliente2: r.cliente2,
  });
}
console.log(`    ✓ ${tickets.length} jugadas estructuradas (cliente, jugada, caballo, monto, "da")`);

// 2) CÁLCULO ------------------------------------------------------------------
console.log("\n[2] CÁLCULO DE LA LIQUIDACIÓN (motor universal · comisión 5% s/ ganancia bruta)");
console.log("    " + "n".padEnd(3) + "cliente".padEnd(11) + "jugada".padEnd(9) + "monto".padStart(13) + "  veredicto".padEnd(26) + "crédito".padStart(14) + "comisión".padStart(12));

const movSaldo = new Map<string, number>();
let totalInvertido = 0;
let abonoGanadores = 0;
let reembolsos = 0;
let comisionCasa = 0;
let gananciaBruta = 0;
let ganadores = 0;
let anuladas = 0;

tickets.forEach((t, i) => {
  const { relacion, res } = resultadoDeJugada(t, PIZARRA, null, TASA);
  const anulada = !res.ok && res.totalClienteNeto > 0;
  const credito = res.ok || anulada ? res.totalClienteNeto : 0;
  const monto = relacion.monto;

  totalInvertido += monto;
  if (anulada) { reembolsos += credito; anuladas++; }
  if (res.ok) { abonoGanadores += credito; comisionCasa += res.gananciaCasa; gananciaBruta += credito + res.gananciaCasa - monto; ganadores++; }

  // Movimiento real del saldo del que JUEGA (lo que escribe aplicarLiquidacionSaldos):
  // la venta ya descontó el monto; aquí se acredita el premio (o se devuelve capital).
  add(movSaldo, relacion.clienteJuega, credito - monto);

  const veredicto = res.indeterminado ? "⚠ PENDIENTE (falta dividendo)" : anulada ? "◻ ANULADA (devuelve capital)" : res.ok ? "✔ GANA" : "✘ PIERDE";
  console.log(
    "    " +
      String(i + 1).padEnd(3) +
      relacion.clienteJuega.padEnd(11) +
      `${relacion.jugada}(${relacion.caballo})`.padEnd(9) +
      fmtMonto(monto).padStart(13) +
      "  " + veredicto.padEnd(24) +
      fmtMonto(credito).padStart(14) +
      fmtMonto(res.gananciaCasa).padStart(12)
  );
});

// 3) SALDOS -------------------------------------------------------------------
console.log("\n[3] MOVIMIENTO DE SALDOS POR JUGADOR (crédito − monto; la venta ya debitó)");
const orden = [...movSaldo.entries()].sort((a, b) => b[1] - a[1]);
const positivos = orden.filter(([, v]) => v > 0.0001);
const negativos = orden.filter(([, v]) => v < -0.0001);
const totalMov = orden.reduce((a, [, v]) => a + v, 0);
for (const [nombre, v] of positivos) console.log(`    ▲ ${nombre.padEnd(11)} +${fmtMonto(v)}`);
for (const [nombre, v] of negativos) console.log(`    ▼ ${nombre.padEnd(11)} -${fmtMonto(Math.abs(v))}`);

console.log("\n    RESUMEN BANCARIO");
console.log(`      Total invertido ......... ${fmtMonto(totalInvertido).padStart(14)}`);
console.log(`      Ganancia bruta .......... ${fmtMonto(gananciaBruta).padStart(14)}`);
console.log(`      Comisión casa (5%) ...... ${fmtMonto(comisionCasa).padStart(14)}`);
console.log(`      Abono a ganadores ....... ${fmtMonto(abonoGanadores).padStart(14)}  (${ganadores} jugadas)`);
console.log(`      Reembolsos (anuladas) ... ${fmtMonto(reembolsos).padStart(14)}  (${anuladas} jugada)`);
console.log(`      Crédito a saldos ........ ${fmtMonto(abonoGanadores + reembolsos).padStart(14)}  (lo que acredita aplicarLiquidacionSaldos)`);
console.log(`      Σ mov. del que juega .... ${fmtMonto(totalMov).padStart(14)}  (créditos − invertido de los que juegan)`);

// 4) MENSAJES -----------------------------------------------------------------
const plano = mensajePlanoDeCarrera({ hipodromo: HIPODROMO, carrera: CARRERA, fecha: FECHA, grupo: GRUPO, tickets });
const resultado = mensajeResultadoDeCarrera({ hipodromo: HIPODROMO, carrera: CARRERA, fecha: FECHA, grupo: GRUPO, pizarra: PIZARRA, tickets, tasaComision: TASA });

const barra = "\n" + "-".repeat(74) + "\n";
console.log(barra);
console.log("=== MENSAJE 1 · PLANO DE JUGADAS (pre-carrera, " + tickets.length + " jugadas) ===");
console.log(barra);
console.log(plano);
console.log(barra);
console.log("=== MENSAJE 2 · RELACIÓN DE RESULTADOS (post-carrera) ===");
console.log(barra);
console.log(resultado);
console.log(barra);

// 5) VERIFICACIÓN -------------------------------------------------------------
const ok = (nombre: string, cond: boolean) => console.log(`  ${cond ? "ok  " : "FALLA"} ${nombre}`);
/** Suma el cierre 🟢 POSITIVOS / 🔴 NEGATIVOS de un mensaje de resultados. */
function sumaCierre(msg: string): number {
  const ls = msg.split("\n");
  const iPos = ls.findIndex((l) => l.startsWith("🟢 POSITIVOS"));
  const iNeg = ls.findIndex((l) => l.startsWith("🔴 NEGATIVOS"));
  if (iPos < 0 || iNeg < 0) return Number.NaN;
  let s = 0;
  const sumar = (l: string) => {
    const m = /([+-])([\d.]+,\d\d)\s*$/.exec(l);
    if (m) s += (m[1] === "+" ? 1 : -1) * num(m[2]);
  };
  for (let i = iPos + 1; i < iNeg; i++) sumar(ls[i]);
  for (let i = iNeg + 1; i < ls.length && /^\d+\)/.test(ls[i]); i++) sumar(ls[i]);
  return s;
}
const cierre = sumaCierre(resultado);
console.log("[5] VERIFICACIÓN");
ok("las 39 jugadas quedaron estructuradas", tickets.length === 39);
ok("la relación de resultados reproduce el 2Y2N con -5.000,00 (jugada 16)", resultado.includes("Consigue Pinto $ -5.000,00"));
ok("la anulada 2N sale 0/0 (jugada 39)", resultado.includes("Juega Toyota $ +0,00") && resultado.includes("Consigue Angelo $ +0,00"));
ok("el cierre resta la anulada: Angelo -2.500,00", resultado.includes("Angelo -2.500,00"));
ok("Σ del cierre (POSITIVOS−NEGATIVOS) = −comisión casa", Math.abs(cierre + comisionCasa) < 0.01);

// 6) PARIDAD CON EL CAMINO DEL GRUPO ------------------------------------------
// El módulo de WhatsApp NO usa el mensaje de sesión: relee los tickets ya
// liquidados de `tickets_apuestas` (cargarJugadasDeCarrera → mapearJugada) y
// arma la misma relación. Aquí se reproduce esa ruta para comprobar que el
// texto que se pega en el GRUPO es idéntico al de la sesión.
const mapearJugada = (r: TicketApuestaJugada): JugadaRelacion => {
  const jugadaCruda = String(r.nombre_jugada ?? "").trim();
  const esNini = parsearNini(jugadaCruda) !== null;
  return {
    clienteJuega: String(r.cliente_juega_nombre ?? "—"),
    jugada: esNini ? normalizarNini(jugadaCruda) : jugadaCruda,
    caballo: String(r.caballo ?? "").trim(),
    monto: Number(r.monto_jugado),
    clienteConsigue: r.cliente_consigue_nombre ? String(r.cliente_consigue_nombre) : undefined,
    modalidad: esNini ? "NINI" : "GENERICA",
    cantidadTablas: Number(r.cantidad_tablas),
    premioPorTabla: Number(r.premio_por_tabla),
    premioPotencial: Number(r.premio_pagar),
    comisionPct: Number(r.comision_porcentaje) || undefined,
    ganador: Number(r.premio_pagar) > 0,
  };
};
// Filas tal como las deja `aplicarLiquidacionSaldos`: premio_pagar = BRUTO
// (capital + ganancia) y el saldo se acredita neto (totalClienteNeto).
const filasDb: TicketApuestaJugada[] = tickets.map((t, i) => {
  const { res } = resultadoDeJugada(t, PIZARRA, null, TASA);
  const anulada = !res.ok && res.totalClienteNeto > 0;
  return {
    id: String(i + 1),
    nombre_jugada: t.comando,
    caballo: t.caballo ?? "",
    cantidad_tablas: 0,
    monto_jugado: t.monto,
    premio_pagar: res.ok ? Math.round((res.totalClienteNeto + res.gananciaCasa) * 100) / 100 : 0,
    premio_por_tabla: 0,
    comision_porcentaje: TASA,
    estado: anulada ? "Retirado" : res.ok ? "Ganador" : "Perdedor",
    cliente_juega_nombre: t.cliente1 ?? "",
    cliente_consigue_nombre: t.cliente2 ?? "",
  };
});
const metaGrupo: MetaCarrera = {
  grupo: GRUPO,
  fecha: new Date(`${FECHA}T12:00:00`),
  hipodromo: HIPODROMO,
  carrera: CARRERA,
  pizarra: "5-3-2-6-7",
  pizarraPuestos: ["5", "3", "2", "6", "7"],
  dividendos: null,
};
const msgGrupo = relacionResultados(metaGrupo, filasDb.map(mapearJugada));
const iguales = msgGrupo === resultado;
console.log("\n[6] PARIDAD · mensaje del GRUPO (WhatsApp relee la BD) vs. mensaje de sesión");
ok("el mensaje que se pega en el grupo es idéntico al de la sesión", iguales);
if (!iguales) {
  const a = resultado.split("\n");
  const b = msgGrupo.split("\n");
  let difs = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      if (difs < 5) {
        console.log(`      sesión: ${a[i] ?? ""}`);
        console.log(`      grupo : ${b[i] ?? ""}`);
      }
      difs++;
    }
  }
  console.log(`      (${difs} líneas distintas)`);
}
