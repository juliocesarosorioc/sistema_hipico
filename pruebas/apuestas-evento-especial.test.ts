// ============================================================================
// PRUEBAS DE AUTOMATIZACIÓN: APUESTAS DE EVENTOS ESPECIALES / LIBRES
// ============================================================================
// Verifica:
//   1. Cálculo de Pagos Potenciales (fracciones 10/6, cuotas decimales, moneylines).
//   2. Registro de Apuestas de Evento Libre (ej. 10/6 Milwaukee Brewers campeon serie mundial).
//   3. Reporte de Apuestas & Selección de Ganador (Ganador / Perdedor / Pendiente).
//   4. Eliminación de Apuestas.
//   5. Integración con el Botón en la última línea de botones de Gestión de Jugadas.
//
// Corre con: node node_modules/typescript/bin/tsc -p pruebas/tsconfig.json; node -r ./pruebas/_alias.cjs .tsbuild-pruebas/pruebas/apuestas-evento-especial.test.js
// ============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  calcularPagoPotencial,
  registrarApuestaEventoEspecial,
  actualizarEstadoEventoEspecial,
  eliminarApuestaEventoEspecial,
  listarApuestasEventosEspeciales,
} from "../src/features/apuestas/lib/eventos-especiales";

let pasan = 0;
let fallan = 0;

function ok(nombre: string, condicion: boolean) {
  if (condicion) {
    pasan++;
    console.log(`  ✅ ok   ${nombre}`);
  } else {
    fallan++;
    console.error(`  ❌ FAIL ${nombre}`);
  }
}

async function ejecutarPruebas() {
  console.log("\n=======================================================");
  console.log("🏁 INICIANDO PRUEBAS DE APUESTAS DE EVENTOS ESPECIALES");
  console.log("=======================================================\n");

  // --------------------------------------------------------------------------
  // [1] CÁLCULO DE PAGOS POTENCIALES
  // --------------------------------------------------------------------------
  console.log("[1] CÁLCULO DE PAGOS POTENCIALES");

  // 10/6 Milwaukee Brewers: con $60 paga $60 + $60*(10/6) = $60 + $100 = $160
  const pago10_6 = calcularPagoPotencial(60, "10/6");
  ok("Fracción 10/6 con monto $60 paga $160", pago10_6 === 160);

  // 5/2 con $10: $10 + $10*(5/2) = $35
  const pago5_2 = calcularPagoPotencial(10, "5/2");
  ok("Fracción 5/2 con monto $10 paga $35", pago5_2 === 35);

  // Cuota decimal 2.50 con $10: $10 * 2.50 = $25
  const pagoDecimal = calcularPagoPotencial(10, "2.50");
  ok("Cuota decimal 2.50 con monto $10 paga $25", pagoDecimal === 25);

  // Moneyline +150 con $100: $100 + $150 = $250
  const pagoMlPos = calcularPagoPotencial(100, "+150");
  ok("Moneyline +150 con monto $100 paga $250", pagoMlPos === 250);

  // Sin cuota devuelve el monto
  const pagoMismo = calcularPagoPotencial(50, "");
  ok("Sin cuota devuelve el monto apostado", pagoMismo === 50);

  // --------------------------------------------------------------------------
  // [2] REGISTRO DE APUESTA DE EVENTO LIBRE
  // --------------------------------------------------------------------------
  console.log("\n[2] REGISTRO DE APUESTA DE EVENTO LIBRE");

  const eventoTest = "10/6 Milwaukee Brewers campeon serie mundial";
  const resReg = await registrarApuestaEventoEspecial({
    evento: eventoTest,
    cliente_nombre: "JULIO_PRO",
    monto: 60,
    logro_cuota: "10/6",
    nota: "Apuesta especial serie mundial",
  });

  ok("Registro de apuesta devuelve ok: true", resReg.ok === true);
  ok("Apuesta generada tiene id único", Boolean(resReg.apuesta?.id));
  ok("Apuesta tiene evento exacto", resReg.apuesta?.evento === eventoTest);
  ok("Apuesta tiene cliente JULIO_PRO", resReg.apuesta?.cliente_nombre === "JULIO_PRO");
  ok("Apuesta tiene monto 60", resReg.apuesta?.monto === 60);
  ok("Apuesta tiene pago potencial 160", resReg.apuesta?.pago_potencial === 160);
  ok("Apuesta inicia con estado PENDIENTE", resReg.apuesta?.estado === "PENDIENTE");
  ok("Apuesta inicia sin ganador seleccionado", resReg.apuesta?.ganador_seleccionado === false);

  const apuestaId = resReg.apuesta!.id;

  // --------------------------------------------------------------------------
  // [3] SELECCIÓN DE GANADOR EN EL REPORTE
  // --------------------------------------------------------------------------
  console.log("\n[3] SELECCIÓN DE GANADOR EN EL REPORTE");

  // Marcar Ganador
  const resGanador = await actualizarEstadoEventoEspecial(apuestaId, "GANADOR");
  ok("actualizarEstadoEventoEspecial a GANADOR devuelve ok", resGanador.ok === true);

  const listaDespuesGanador = await listarApuestasEventosEspeciales();
  const encontradaGanadora = listaDespuesGanador.find((a) => a.id === apuestaId);
  ok("Apuesta en lista tiene estado GANADOR", encontradaGanadora?.estado === "GANADOR");
  ok("Apuesta tiene ganador_seleccionado: true", encontradaGanadora?.ganador_seleccionado === true);
  ok("Apuesta tiene fecha_liquidacion asignada", Boolean(encontradaGanadora?.fecha_liquidacion));

  // Cambiar a Perdedor
  const resPerdedor = await actualizarEstadoEventoEspecial(apuestaId, "PERDEDOR");
  ok("actualizarEstadoEventoEspecial a PERDEDOR devuelve ok", resPerdedor.ok === true);

  const listaDespuesPerdedor = await listarApuestasEventosEspeciales();
  const encontradaPerdedora = listaDespuesPerdedor.find((a) => a.id === apuestaId);
  ok("Apuesta en lista tiene estado PERDEDOR", encontradaPerdedora?.estado === "PERDEDOR");
  ok("Apuesta en PERDEDOR tiene ganador_seleccionado: false", encontradaPerdedora?.ganador_seleccionado === false);

  // --------------------------------------------------------------------------
  // [4] ELIMINACIÓN DE APUESTA
  // --------------------------------------------------------------------------
  console.log("\n[4] ELIMINACIÓN DE APUESTA");

  const resDel = await eliminarApuestaEventoEspecial(apuestaId);
  ok("eliminarApuestaEventoEspecial devuelve ok", resDel.ok === true);

  const listaFinal = await listarApuestasEventosEspeciales();
  ok("Apuesta eliminada ya no existe en lista", !listaFinal.some((a) => a.id === apuestaId));

  // --------------------------------------------------------------------------
  // [5] BOTÓN EN GESTIÓN DE JUGADAS (ÚLTIMA LÍNEA DE BOTONES)
  // --------------------------------------------------------------------------
  console.log("\n[5] BOTÓN EN GESTIÓN DE JUGADAS (ÚLTIMA LÍNEA DE BOTONES)");

  const rutaGestion = join(process.cwd(), "src/features/gestion/components/GestionJugadasModule.tsx");
  const gestionSrc = readFileSync(rutaGestion, "utf8");
  ok("GestionJugadasModule importa ModalApuestaEventoEspecial", gestionSrc.includes("ModalApuestaEventoEspecial"));
  ok("GestionJugadasModule define estado modalEventoEspecial", gestionSrc.includes("modalEventoEspecial"));
  ok("GestionJugadasModule tiene el botón Evento Libre en la barra de botones", gestionSrc.includes("🎯 Evento Libre"));
  ok("GestionJugadasModule activa el modal al hacer clic en el botón", gestionSrc.includes("setModalEventoEspecial(true)"));
  ok("GestionJugadasModule renderiza ModalApuestaEventoEspecial con props abiertos", gestionSrc.includes("<ModalApuestaEventoEspecial"));

  // --------------------------------------------------------------------------
  // RESUMEN FINAL
  // --------------------------------------------------------------------------
  console.log("\n=======================================================");
  console.log(`📊 RESULTADO DE LA SUITE: ${pasan} pasaron, ${fallan} fallaron.`);
  console.log("=======================================================\n");

  if (fallan > 0) {
    process.exit(1);
  }
}

void ejecutarPruebas();
