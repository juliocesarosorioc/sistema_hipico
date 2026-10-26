// ============================================================================
// SUITE DE VERIFICACIÓN INTEGRAL:
//  - FASE 1: Dinero en centavos enteros + Contabilidad Centralizada (Pedro -6000)
//  - FASE 2: Cruces, Tapas y Clusters (_comprometidoSimuladoCli + calcularReembolsosCruce)
//  - FASE 3: Descuento progresivo línea por línea + Separación En Vivo vs Adelantadas
//  - FASE 4: Estructura de 7 columnas del Reporte + Ganadores/Perdedores + Excesos
//  - FASE 5/6: Visor WhatsApp (#reporteArea) + Acuse de Recibo + Cierre de modales
//  - FASE 7: Motor Hípico Godet v3 (MACTOR + SMIC + Actuario v4)
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  aCentavos,
  deCentavos,
  sumarDinero,
  restarDinero,
  multiplicarDinero,
  calcularComisionExacta,
  formatearMontoSinMoneda,
  limpiarSimbolosMoneda,
} from "../src/shared/lib/dinero";
import {
  esTablaInexistente42P01,
  esJugadaAnuladaOExcluida,
  calcularResumenContableCliente,
} from "../src/features/saldos/lib/contabilidad-central";
import {
  TABLA_JUGADAS,
  _rolEfectivo,
  _comprometidoSimuladoCli,
  calcularReembolsosCruce,
} from "../src/features/taquilla/lib/cruces-y-tapas";
import { proyectarFilasEnOrden } from "../src/features/taquilla/lib/saldosEnCurso";
import {
  COLUMNAS_REPORTE_7,
  construirFilas7Columnas,
  generarTextoPrejugadasWhatsapp,
  generarTextoSaldosWhatsapp,
} from "../src/features/liquidacion/lib/reporte-imagen";
import { armarReporteCarrera } from "../src/features/liquidacion/lib/reporte-carrera";
import { generarProspectivaGodet, calcularSMIC } from "../src/features/gaceta/lib/actuarialGodetEngine";

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
  si(JSON.stringify(a) === JSON.stringify(b), m, `esperado ${JSON.stringify(b)} · recibido ${JSON.stringify(a)}`);

// ---------------------------------------------------------------------------
console.log("\n[FASE 1] Precisión Aritmética en Centavos y Contabilidad Central (Caso Pedro -6000)");
// ---------------------------------------------------------------------------
igual(sumarDinero(0.1, 0.2), 0.3, "0.1 + 0.2 = 0.30 exacto sin deriva IEEE 754");
igual(restarDinero(1000.1, 0.05), 1000.05, "resta exacta en centavos enteros");
igual(multiplicarDinero(100, 0.95), 95, "multiplicación exacta en centavos");
igual(calcularComisionExacta(1000, 5), 50, "comisión 5% de 1000 = 50");
igual(aCentavos(deCentavos(123456)), 123456, "ida y vuelta en centavos enteros");
si(!/[$]|Bs|USD|VES/.test(formatearMontoSinMoneda(1500.5)), "formatearMontoSinMoneda no emite símbolos de moneda");
si(!/[$]|Bs|USD|VES/.test(limpiarSimbolosMoneda("$ 1.500,00 Bs USD VES")), "limpiarSimbolosMoneda elimina $, Bs, USD, VES");

// Tolerancia 42P01
si(esTablaInexistente42P01({ code: "42P01", message: "relation cuaderno_movimientos does not exist" }), "detecta error PostgreSQL 42P01");
si(esJugadaAnuladaOExcluida({ estado: "ANULADA" }), "detecta jugada ANULADA");

// Caso Pedro con -6000 en grupo Argentina cuando todas sus jugadas están ANULADAS
const resumenPedro = calcularResumenContableCliente({
  clienteId: "pedro-arg-1",
  nombre: "PEDRO",
  grupoId: "argentina",
  aval: 2000,
  saldoEnBase: -6000,
  depositos: 0,
  retiros: 0,
  tickets: [
    {
      id: 101,
      cliente_juega_id: "pedro-arg-1",
      cliente_juega_nombre: "PEDRO",
      cliente_consigue_nombre: "CARLOS",
      nombre_jugada: "1P",
      caballo: "3",
      monto_jugado: 3000,
      estado: "ANULADA",
      anulada: true,
    },
    {
      id: 102,
      cliente_juega_id: "pedro-arg-1",
      cliente_juega_nombre: "PEDRO",
      cliente_consigue_nombre: "LUIS",
      nombre_jugada: "2P",
      caballo: "5",
      monto_jugado: 3000,
      estado: "ANULADA",
      anulada: true,
    },
  ],
});

igual(resumenPedro.saldoContable, 0, "Pedro (Grupo Argentina): saldoContable auto-curado de -6000 a 0");
igual(resumenPedro.avalVigente, 2000, "Pedro (Grupo Argentina): avalVigente = 2000");
igual(resumenPedro.riesgoEnCurso, 0, "Pedro (Grupo Argentina): riesgoEnCurso = 0 (jugadas anuladas excluidas)");
igual(resumenPedro.disponibleParaJugar, 2000, "Pedro (Grupo Argentina): disponibleParaJugar = 2000");
si(resumenPedro.reparadoAutomaticamente === true, "Pedro (Grupo Argentina): marcado como reparadoAutomaticamente");

// ---------------------------------------------------------------------------
console.log("\n[FASE 2] Motor Exacto de Cruces, Tapas y Clusters");
// ---------------------------------------------------------------------------
si(Boolean(TABLA_JUGADAS["1P"] && TABLA_JUGADAS["6Y7NY7N"] && TABLA_JUGADAS["PP"] && TABLA_JUGADAS["10A8"]), "TABLA_JUGADAS incluye 1P..6Y7NY7N, PP y 10Ax");

const rolPP = _rolEfectivo("PP", ["6"], ["3"], "juega");
igual([rolPP.c1Canon[0], rolPP.c2Canon[0], rolPP.rol], ["3", "6", "da"], "PP canonicaliza 6x3 -> 3x6 e invierte el rol");

const rol10A = _rolEfectivo("10A8", ["6"], ["3"], "juega");
igual([rol10A.c1Canon[0], rol10A.c2Canon[0], rol10A.rol], ["6", "3", "juega"], "10A8 preserva la asimetría entre C1 y C2");

// Cobertura por tapa en el mismo caballo (#3): juega 1000 al 1P y da 1000 al 1P en el mismo caballo #3
const riesgoTapado = _comprometidoSimuladoCli(
  "PEDRO",
  [
    { id: 1, jugador: "PEDRO", tercio: "JUAN", jugada: "1P", caballo: "3", monto: 1000, estado: "PENDIENTE" },
    { id: 2, jugador: "LUIS", tercio: "PEDRO", jugada: "1P", caballo: "3", monto: 1000, estado: "PENDIENTE" },
  ],
  5
);
si(riesgoTapado <= 50, `Cobertura por tapa libera el principal y solo reserva la comisión (${riesgoTapado})`);

// Reembolso de comisión en CON CRUCES vs SIN CRUCES
const reembolsosCon = calcularReembolsosCruce(
  [{ cliente: "PEDRO", brutoGanado: 1000, brutoPerdido: 600 }],
  "con_cruces",
  5
);
const crucePedro = reembolsosCon.porCliente.get("PEDRO");
igual(crucePedro?.reembolsoCruce, 30, "CON CRUCES: min(1000, 600) * 5% = 30 de reembolsoCruce");
si(Boolean(crucePedro?.etiqueta.includes("🔀 CRUCE")), "CON CRUCES: genera línea auditable 🔀 CRUCE");

const reembolsosSin = calcularReembolsosCruce(
  [{ cliente: "PEDRO", brutoGanado: 1000, brutoPerdido: 600 }],
  "sin_cruces",
  5
);
igual(reembolsosSin.filasCruce.length, 0, "SIN CRUCES: no aplica reembolso de cruce");

// ---------------------------------------------------------------------------
console.log("\n[FASE 3] Descuento Progresivo Línea por Línea (2000 -> 1000 -> 500 -> 600 acepta 500)");
// ---------------------------------------------------------------------------
const catalogo = {
  PEDRO: { id: "p1", nombre: "PEDRO", saldo_actual: 0, aval: 2000, grupos: [1], grupo_id: 1 },
  JUAN: { id: "j1", nombre: "JUAN", saldo_actual: 5000, aval: 0, grupos: [1], grupo_id: 1 },
};
const proyeccionProgresiva = proyectarFilasEnOrden(
  [
    { id: "tk-1", jugada: "1p", caballo: "1", monto: "1000", cliente1: "PEDRO", cliente2: "JUAN" },
    { id: "tk-2", jugada: "1p", caballo: "2", monto: "500", cliente1: "PEDRO", cliente2: "JUAN" },
    { id: "tk-3", jugada: "1p", caballo: "3", monto: "600", cliente1: "PEDRO", cliente2: "JUAN" },
  ],
  (n) => catalogo[n as keyof typeof catalogo] ?? null,
  5
);
igual(proyeccionProgresiva[0].montoAceptado, 1000, "Línea 1: acepta 1000");
igual(proyeccionProgresiva[0].queda, 1000, "Línea 1: Queda 1000");
igual(proyeccionProgresiva[1].montoAceptado, 500, "Línea 2: acepta 500");
igual(proyeccionProgresiva[1].queda, 500, "Línea 2: Queda 500");
igual(proyeccionProgresiva[2].montoSolicitado, 600, "Línea 3: solicitó 600");
igual(proyeccionProgresiva[2].montoAceptado, 500, "Línea 3: acepta únicamente los 500 restantes");
igual(proyeccionProgresiva[2].montoExcedido, 100, "Línea 3: montoExcedido = 100");
igual(proyeccionProgresiva[2].queda, 0, "Línea 3: Queda 0");
igual(proyeccionProgresiva[2].observacionExceso, "Excedido 100", "Línea 3: registra observación 'Excedido 100'");

// Deduplicación por id de ticket
const proyeccionDeduplicada = proyectarFilasEnOrden(
  [
    { id: "tk-dup", jugada: "1p", caballo: "1", monto: "1000", cliente1: "PEDRO", cliente2: "JUAN" },
    { id: "tk-dup", jugada: "1p", caballo: "1", monto: "1000", cliente1: "PEDRO", cliente2: "JUAN" },
  ],
  (n) => catalogo[n as keyof typeof catalogo] ?? null,
  5
);
igual(proyeccionDeduplicada[1].queda, 1000, "Deduplicación por id: no descuenta dos veces el mismo ticket");

// ---------------------------------------------------------------------------
console.log("\n[FASE 4 & 6] Estructura de 7 Columnas y Reportes WhatsApp sin símbolos de moneda");
// ---------------------------------------------------------------------------
igual(COLUMNAS_REPORTE_7.length, 7, "Reporte tiene exactamente las 7 columnas oficiales");
const filas7 = construirFilas7Columnas(
  [
    {
      juega: "PEDRO",
      aposto: 1000,
      resultado: null,
      jugo: "1P",
      caballo: "3",
      da: "JUAN",
      apostoDa: 1000,
      resultadoDa: null,
    },
  ],
  false
);
igual(filas7[0].quienJuega, "PEDRO", "Col 1: Quien Juega");
igual(filas7[0].apostoJuega, 1000, "Col 2: Apostó (J1)");
igual(filas7[0].resultadoJuega, -1000, "Col 3: Resultado en riesgo negativo (J1)");
igual(filas7[0].jugada, "1P (3)", "Col 4: Jugada");
igual(filas7[0].quienDa, "JUAN", "Col 5: Quien Da");
igual(filas7[0].apostoDa, 1000, "Col 6: Apostó (J2)");
igual(filas7[0].resultadoDa, -1000, "Col 7: Resultado en riesgo negativo (J2)");

const repCarrera = armarReporteCarrera(
  {
    numero: 1,
    hipodromo: "LA RINCONADA",
    fecha: "2026-10-25",
    pizarra: "3 · 1 · 2",
    subtotal: 0,
    filas: [
      { id: "1-j-0", rol: "Juega", cliente: "PEDRO", jugada: "1P", caballo: "3", monto: 1000, resultado: 950 },
      { id: "1-c-0", rol: "Consigue", cliente: "JUAN", jugada: "1P", caballo: "3", monto: 1000, resultado: -1000 },
    ],
  },
  "ARGENTINA",
  (nombre) => (nombre === "PEDRO" ? 500 : 5000) // Fuerza observación de exceso (jugó 1000 con límite 500)
);
si((repCarrera.observacionesOrdenExceso?.length ?? 0) > 0, "Reporte genera bloque de observaciones de límite de saldo y orden de juego");

const txtPre = generarTextoPrejugadasWhatsapp({
  grupo: "ARGENTINA",
  hipodromo: "LA RINCONADA",
  carrera: 1,
  fecha: "2026-10-25",
  jugadasEnVivo: [{ juega: "PEDRO", jugada: "1P", caballo: "3", da: "JUAN", monto: 1000 }],
  jugadasAdelantadas: [{ juega: "LUIS", jugada: "2P", caballo: "5", da: "MARIA", monto: 500 }],
});
si(txtPre.includes("JUGADAS EN VIVO") && txtPre.includes("JUGADAS ADELANTADAS"), "Prejugadas WhatsApp separa En Vivo y Adelantadas");
si(!/[$]|Bs|USD|VES/.test(txtPre), "Prejugadas WhatsApp no contiene símbolos de moneda");

const txtSaldos = generarTextoSaldosWhatsapp({
  grupo: "ARGENTINA",
  hipodromo: "LA RINCONADA",
  carrera: 1,
  fecha: "2026-10-25",
  clientes: [
    { nombre: "PEDRO", saldoContable: 0, aval: 2000, riesgoEnCurso: 0, disponible: 2000, libre: false, tuvoMovimiento: true },
    { nombre: "JUAN", saldoContable: -500, aval: 0, riesgoEnCurso: 0, disponible: -500, libre: false, tuvoMovimiento: true },
  ],
  filtro: "todos",
  separarPositivosNegativos: true,
});
si(txtSaldos.includes("POSITIVOS") && txtSaldos.includes("NEGATIVOS"), "Reporte de saldos separa positivos y negativos");
si(!/[$]|Bs|USD|VES/.test(txtSaldos), "Reporte de saldos WhatsApp no contiene símbolos de moneda");

// ---------------------------------------------------------------------------
console.log("\n[FASE 7] Motor Hípico Godet v3 (MACTOR + SMIC + Actuario v4)");
// ---------------------------------------------------------------------------
const ejemplaresGodet = [
  { id: "1", numero: 1, nombre: "RELAMPAGO", speedRatingTTC: 92, actuaciones: 8, tipoCarrera: "velocista" as const },
  { id: "2", numero: 2, nombre: "TRUENO", speedRatingTTC: 85, actuaciones: 6, tipoCarrera: "perseguidor" as const },
  { id: "3", numero: 3, nombre: "CENTELLA", speedRatingTTC: 79, actuaciones: 5, tipoCarrera: "rematador" as const },
];
const analisisGodet = generarProspectivaGodet(ejemplaresGodet, "previa", {
  pista: "arena",
  clima: "seco",
  cambioJockey: false,
  cambioEntrenador: false,
  reaparecida: false,
  customFactors: [],
});
igual(analisisGodet.ordenLlegada.length, 3, "Motor Godet analiza los 3 ejemplares inscritos");
si(analisisGodet.smic.escenarios.length === 3, "SMIC genera los 3 escenarios probabilísticos");
const sumaSmic = calcularSMIC(ejemplaresGodet).escenarios.reduce((a, s) => a + s.probabilidadPct, 0);
si(Math.abs(sumaSmic - 100) <= 1, `Probabilidades SMIC suman 100% (${sumaSmic}%)`);

const gestionSrc = readFileSync(join(process.cwd(), "src", "features", "gestion", "components", "GestionJugadasModule.tsx"), "utf8");
const proySrc = readFileSync(join(process.cwd(), "src", "features", "inteligencia", "components", "ProyeccionesModule.tsx"), "utf8");
si(gestionSrc.includes('id="reporteArea"'), "GestionJugadasModule incluye el visor interactivo #reporteArea");
si(proySrc.includes("Motor IA Godet v3"), "ProyeccionesModule aloja Motor IA Godet v3");
si(gestionSrc.includes("Acuse de Recibo"), "GestionJugadasModule exige Acuse de Recibo del operador");

console.log(`\nRESULTADO — contabilidad, cruces y 7 columnas: ${pasan} ok, ${fallan} fallan\n`);
if (fallan > 0) process.exit(1);
