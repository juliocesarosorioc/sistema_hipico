import assert from "node:assert/strict";
import {
  calcularReembolsosCruce,
  _comprometidoSimuladoCli,
  _rolEfectivo,
  extraerCaballosJugada,
  normalizarNombreCliente,
} from "@/features/taquilla/lib/cruces-y-tapas";
import {
  calcularLiquidacionPuestosCarrera,
  resolverReglaCrucePuestos,
  type EntradaCrucePuestos,
  type OpcionesCrucesPuestos,
} from "@/features/motores/lib/puestos";
import {
  registrarCruceJugadores,
} from "@/features/contabilidad/lib/cruces-jugadores";

let ok = 0;
function test(nombre: string, fn: () => void | Promise<void>) {
  // Synchronous runner tracker
  try {
    const res = fn();
    if (res instanceof Promise) {
      throw new Error("testAsync must be used for async functions");
    }
    ok++;
    console.log(`  ✔ [OK] ${nombre}`);
  } catch (e) {
    console.error(`  ✖ [FALLA] ${nombre}`);
    throw e;
  }
}

async function testAsync(nombre: string, fn: () => Promise<void>) {
  try {
    await fn();
    ok++;
    console.log(`  ✔ [OK] ${nombre}`);
  } catch (e) {
    console.error(`  ✖ [FALLA] ${nombre}`);
    throw e;
  }
}

async function main() {
  console.log("\n=======================================================");
  console.log("SUITE DE CERTIFICACIÓN EXHAUSTIVA DE CRUCES");
  console.log("=======================================================\n");

  // ----------------------------------------------------------------------------
  // SECCIÓN 1: CRUCE FINANCIERO Y REEMBOLSO DE COMISIÓN EN LIQUIDACIÓN
  // ----------------------------------------------------------------------------
  console.log("--- SECCIÓN 1: Cruce Financiero y Reembolso de Comisión ---");

  test("1.1 Ganancia $100 y Pérdida $60 con CON CRUCES (Comisión 5%): reembolso exacto", () => {
    const lineas = [
      { cliente: "Carlos Gomez", brutoGanado: 100, brutoPerdido: 0, comisionPct: 5 },
      { cliente: "Carlos Gomez", brutoGanado: 0, brutoPerdido: 60, comisionPct: 5 },
    ];
    const res = calcularReembolsosCruce(lineas, true, 5);
    // Ganado: 100, Perdido: 60, Base cruce = min(100, 60) = 60
    // Comision cobrada en ganado = 5% de 100 = $5.00
    // Reembolso = comision * (base / ganado) = 5.00 * (60 / 100) = $3.00
    assert.equal(res.totalReembolsado, 3);
    const cli = res.porCliente.get("CARLOS GOMEZ");
    assert.ok(cli);
    assert.equal(cli.reembolsoCruce, 3);
    assert.equal(cli.baseCruce, 60);
    assert.equal(cli.brutoGanado, 100);
    assert.equal(cli.brutoPerdido, 60);
    assert.equal(cli.etiqueta, "🔀 CRUCE (+3.00)");
  });

  test("1.2 Ganancia $100 y Pérdida $60 con SIN CRUCES: no debe haber reembolso", () => {
    const lineas = [
      { cliente: "Carlos Gomez", brutoGanado: 100, brutoPerdido: 0, comisionPct: 5 },
      { cliente: "Carlos Gomez", brutoGanado: 0, brutoPerdido: 60, comisionPct: 5 },
    ];
    const res = calcularReembolsosCruce(lineas, false, 5);
    assert.equal(res.totalReembolsado, 0);
    assert.equal(res.filasCruce.length, 0);
    assert.equal(res.porCliente.size, 0);
  });

  test("1.3 Ganancia $50 y Pérdida $100 (Pérdida Neta): se reembolsa el 100% de la comisión cobrada", () => {
    const lineas = [
      { cliente: "Maria Lopez", brutoGanado: 50, brutoPerdido: 0, comisionPct: 5 },
      { cliente: "Maria Lopez", brutoGanado: 0, brutoPerdido: 100, comisionPct: 5 },
    ];
    const res = calcularReembolsosCruce(lineas, true, 5);
    // Ganado: 50, Perdido: 100, Base cruce = min(50, 100) = 50
    // Comision cobrada en ganado = 5% de 50 = $2.50
    // Reembolso = 2.50 * (50 / 50) = $2.50 (toda la comisión del ticket ganado es devuelta porque está 100% cruzado)
    assert.equal(res.totalReembolsado, 2.5);
    const cli = res.porCliente.get("MARIA LOPEZ");
    assert.ok(cli);
    assert.equal(cli.reembolsoCruce, 2.5);
    assert.equal(cli.baseCruce, 50);
  });

  test("1.4 Solo gana o solo pierde: cruce es 0 (no hay parte cruzada)", () => {
    const soloGana = [
      { cliente: "Pedro", brutoGanado: 100, brutoPerdido: 0, comisionPct: 5 },
    ];
    const resGana = calcularReembolsosCruce(soloGana, true, 5);
    assert.equal(resGana.totalReembolsado, 0);

    const soloPierde = [
      { cliente: "Pedro", brutoGanado: 0, brutoPerdido: 50, comisionPct: 5 },
    ];
    const resPierde = calcularReembolsosCruce(soloPierde, true, 5);
    assert.equal(resPierde.totalReembolsado, 0);
  });

  test("1.5 Tasas de comisión mixtas: prorrateo proporcional exacto", () => {
    const lineas = [
      { cliente: "Ana", brutoGanado: 100, brutoPerdido: 0, comisionCobrada: 5 }, // 5%
      { cliente: "Ana", brutoGanado: 100, brutoPerdido: 0, comisionCobrada: 10 }, // 10%
      { cliente: "Ana", brutoGanado: 0, brutoPerdido: 100, comisionPct: 5 },
    ];
    // Total ganado = 200, Total comision cobrada = 15.00
    // Total perdido = 100, Base cruce = 100
    // Reembolso = 15.00 * (100 / 200) = 7.50
    const res = calcularReembolsosCruce(lineas, true);
    assert.equal(res.totalReembolsado, 7.5);
  });

  test("1.6 Tickets con comisión explícita 0%: no generan reembolso fantasma", () => {
    const lineas = [
      { cliente: "Convenio0", brutoGanado: 100, brutoPerdido: 0, comisionCobrada: 0 },
      { cliente: "Convenio0", brutoGanado: 0, brutoPerdido: 100, comisionPct: 0 },
    ];
    const res = calcularReembolsosCruce(lineas, true);
    assert.equal(res.totalReembolsado, 0);
  });

  // ----------------------------------------------------------------------------
  // SECCIÓN 2: CRUCE ROL CONSIGUE (DADOR / BANQUERO VS JUGADOR)
  // ----------------------------------------------------------------------------
  console.log("\n--- SECCIÓN 2: Cruce con Rol Consigue (Dador) ---");

  test("2.1 Cliente gana como Juega y pierde como Consigue en la misma carrera", () => {
    const lineas = [
      { cliente: "DadorNet", brutoGanado: 150, brutoPerdido: 0, comisionPct: 5, rol: "juega" },
      { cliente: "DadorNet", brutoGanado: 0, brutoPerdido: 50, comisionPct: 5, rol: "consigue" },
    ];
    const res = calcularReembolsosCruce(lineas, true, 5);
    // Ganado: 150, Perdido: 50, Base = 50
    // Comision cobrada: 5% de 150 = 7.50
    // Reembolso = 7.50 * (50 / 150) = 2.50
    assert.equal(res.totalReembolsado, 2.5);
    assert.equal(res.porCliente.get("DADORNET")?.reembolsoCruce, 2.5);
  });

  test("2.2 Cliente pierde como Juega y gana como Consigue en la misma carrera", () => {
    const lineas = [
      { cliente: "DadorNet", brutoGanado: 0, brutoPerdido: 80, comisionPct: 5, rol: "juega" },
      { cliente: "DadorNet", brutoGanado: 100, brutoPerdido: 0, comisionPct: 5, rol: "consigue" },
    ];
    const res = calcularReembolsosCruce(lineas, true, 5);
    // Ganado: 100, Perdido: 80, Base = 80
    // Comision cobrada: 5% de 100 = 5.00
    // Reembolso = 5.00 * (80 / 100) = 4.00
    assert.equal(res.totalReembolsado, 4);
  });

  // ----------------------------------------------------------------------------
  // SECCIÓN 3: JERARQUÍA DE CONFIGURACIÓN Y OVERRIDES DE CRUCES
  // ----------------------------------------------------------------------------
  console.log("\n--- SECCIÓN 3: Jerarquía y Overrides de Cruces en Puestos ---");

  test("3.1 Override a nivel carrera por jugador tiene precedencia máxima sobre el grupo", () => {
    const opciones: OpcionesCrucesPuestos = {
      grupo: { mismoEjemplar: false, diferenteEjemplar: false },
      carreraPorJugadorOverride: {
        "CLI-VIP": {
          mismoEjemplar: true,
          diferenteEjemplar: true,
        },
      },
    };
    const rMismo = resolverReglaCrucePuestos(opciones, "CLI-VIP", "mismoEjemplar");
    assert.equal(rMismo.activo, true);
    assert.equal(rMismo.origen, "Solo Carrera - Jugador");

    const rOtro = resolverReglaCrucePuestos(opciones, "CLI-OTRO", "mismoEjemplar");
    assert.equal(rOtro.activo, false);
    assert.equal(rOtro.origen, "Grupo");
  });

  test("3.2 Override a nivel carrera global (todos) tiene precedencia sobre el grupo", () => {
    const opciones: OpcionesCrucesPuestos = {
      grupo: { mismoEjemplar: false, diferenteEjemplar: false },
      carreraTodosOverride: {
        mismoEjemplar: true,
        diferenteEjemplar: true,
      },
    };
    const r = resolverReglaCrucePuestos(opciones, "CUALQUIERA", "mismoEjemplar");
    assert.equal(r.activo, true);
    assert.equal(r.origen, "Solo Carrera - Todos");
  });

  test("3.3 Liquidación de puestos aplica cruce selectivo por ejemplar", () => {
    // Apuesta 1: gana en caballo 1 (bruto 200, monto 100 -> ganancia 100)
    // Apuesta 2: pierde en caballo 2 (monto 40 -> perdida 40)
    const entradas: EntradaCrucePuestos[] = [
      { cliente: "Hugo", clienteId: "CLI-1", caballo: "1", monto: 100, bruto: 200, ok: true },
      { cliente: "Hugo", clienteId: "CLI-1", caballo: "2", monto: 40, bruto: 0, ok: false },
    ];

    // Caso A: con diferenteEjemplar = true
    const liqCon = calcularLiquidacionPuestosCarrera(entradas, {
      grupo: { mismoEjemplar: true, diferenteEjemplar: true },
      pctComision: 5,
    });
    assert.equal(liqCon.length, 1);
    assert.equal(liqCon[0].ganadoBruto, 100);
    assert.equal(liqCon[0].perdidoBruto, 40);
    assert.equal(liqCon[0].neto, 60);
    // Base de comisión con cruce = 100 - 40 = 60
    assert.equal(liqCon[0].baseComision, 60);
    assert.equal(liqCon[0].comision, 3); // 5% de 60
    assert.equal(liqCon[0].netoCliente, 57); // 60 - 3

    // Caso B: con diferenteEjemplar = false (sin cruces entre diferentes caballos)
    const liqSin = calcularLiquidacionPuestosCarrera(entradas, {
      grupo: { mismoEjemplar: true, diferenteEjemplar: false },
      pctComision: 5,
    });
    assert.equal(liqSin.length, 1);
    assert.equal(liqSin[0].baseComision, 100); // No hay cruce de pérdida de caballo 2
    assert.equal(liqSin[0].comision, 5); // 5% de 100
    assert.equal(liqSin[0].netoCliente, 55); // Neto 60 - comision 5
  });

  // ----------------------------------------------------------------------------
  // SECCIÓN 4: IDENTIDAD CANÓNICA Y MULTISEUDÓNIMO / ALIAS
  // ----------------------------------------------------------------------------
  console.log("\n--- SECCIÓN 4: Identidad Canónica y Normalización de Nombres ---");

  test("4.1 Agrupación canónica por clienteId cruza tickets con distintos alias/seudónimos", () => {
    const lineas = [
      { cliente: "El Campeon", clienteId: "UUID-USER-1", brutoGanado: 100, brutoPerdido: 0, comisionPct: 5 },
      { cliente: "Juan Oficial", clienteId: "UUID-USER-1", brutoGanado: 0, brutoPerdido: 50, comisionPct: 5 },
    ];
    const res = calcularReembolsosCruce(lineas, true, 5);
    assert.equal(res.totalReembolsado, 2.5);
    assert.equal(res.porCliente.size, 1);
  });

  test("4.2 Normalización de espacios y mayúsculas en nombre agrupa adecuadamente", () => {
    const n1 = normalizarNombreCliente("  pedro   ramirez  ");
    const n2 = normalizarNombreCliente("PEDRO RAMIREZ");
    assert.equal(n1, n2);

    const lineas = [
      { cliente: "  pedro ramirez  ", brutoGanado: 100, brutoPerdido: 0, comisionPct: 5 },
      { cliente: "PEDRO RAMIREZ", brutoGanado: 0, brutoPerdido: 40, comisionPct: 5 },
    ];
    const res = calcularReembolsosCruce(lineas, true, 5);
    assert.equal(res.totalReembolsado, 2);
  });

  test("4.3 Clientes distintos con distinto id y nombre NUNCA se cruzan entre sí", () => {
    const lineas = [
      { cliente: "Cliente Uno", clienteId: "ID-1", brutoGanado: 100, brutoPerdido: 0, comisionPct: 5 },
      { cliente: "Cliente Dos", clienteId: "ID-2", brutoGanado: 0, brutoPerdido: 100, comisionPct: 5 },
    ];
    const res = calcularReembolsosCruce(lineas, true, 5);
    assert.equal(res.totalReembolsado, 0);
    assert.equal(res.porCliente.size, 0);
  });

  // ----------------------------------------------------------------------------
  // SECCIÓN 5: RIESGO COMPROMETIDO Y TAPAS EN VIVO EN TAQUILLA
  // ----------------------------------------------------------------------------
  console.log("\n--- SECCIÓN 5: Simulación de Riesgo Comprometido y Tapas en Taquilla ---");

  test("5.1 Match simétrico PP (1x2): con comisión 0% cancela 100% el riesgo; con comisión 5% el riesgo residual es exactamente la comisión ($5)", () => {
    // Cliente apuesta $100 a favor de 1x2 como Juega, y $100 como Da
    const jugadas = [
      { jugador: "Beto", tercio: "Casa", jugada: "PP", caballo: "1x2", monto: 100 },
      { jugador: "Casa", tercio: "Beto", jugada: "PP", caballo: "1x2", monto: 100 },
    ];
    // Sin comisión (0%): cobertura total de riesgo ($0)
    const riesgoSinComision = _comprometidoSimuladoCli("Beto", jugadas, 0);
    assert.equal(riesgoSinComision, 0);

    // Con comisión estándar (5%): el peor escenario simulado retiene la comisión ganadora de $5
    const riesgoConComision = _comprometidoSimuladoCli("Beto", jugadas, 5);
    assert.equal(riesgoConComision, 5);
  });

  test("5.2 Match asimétrico 1x2 ($100 vs $60): sin comisión el riesgo es $40; con comisión 5% es $43", () => {
    const jugadas = [
      { jugador: "Beto", tercio: "Casa", jugada: "PP", caballo: "1x2", monto: 100 },
      { jugador: "Casa", tercio: "Beto", jugada: "PP", caballo: "1x2", monto: 60 },
    ];
    const riesgoSinComision = _comprometidoSimuladoCli("Beto", jugadas, 0);
    assert.equal(riesgoSinComision, 40);

    const riesgoConComision = _comprometidoSimuladoCli("Beto", jugadas, 5);
    assert.equal(riesgoConComision, 43); // -100 + (60 - 3) = -43
  });

  test("5.3 Jugadas anuladas y caballos retirados se excluyen de la simulación de riesgo", () => {
    const jugadas = [
      { jugador: "Beto", tercio: "Casa", jugada: "PP", caballo: "1x2", monto: 100, estado: "ANULADA" },
      { jugador: "Beto", tercio: "Casa", jugada: "1P", caballo: "5", monto: 50 },
    ];
    // El caballo 5 está retirado
    const retirados = new Set(["5"]);
    const riesgo = _comprometidoSimuladoCli("Beto", jugadas, 5, retirados);
    assert.equal(riesgo, 0);
  });

  // ----------------------------------------------------------------------------
  // SECCIÓN 6: CRUCES ENTRE JUGADORES (TRANSFERENCIA DE SALDO)
  // ----------------------------------------------------------------------------
  console.log("\n--- SECCIÓN 6: Validación de Cruce Entre Jugadores ---");

  await testAsync("6.1 Validación de cruce entre jugadores rechaza emisor === receptor", async () => {
    const res = await registrarCruceJugadores({
      emisorId: "USR-1",
      emisorNombre: "CARLOS",
      receptorId: "USR-1",
      receptorNombre: "CARLOS",
      monto: 100,
      captureSoporte: "data:image/png;base64,abc",
    });
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /misma persona/i);
  });

  await testAsync("6.2 Validación de cruce entre jugadores rechaza monto menor o igual a cero", async () => {
    const resZero = await registrarCruceJugadores({
      emisorId: "USR-1",
      emisorNombre: "CARLOS",
      receptorId: "USR-2",
      receptorNombre: "MIGUEL",
      monto: 0,
      captureSoporte: "data:image/png;base64,abc",
    });
    assert.equal(resZero.ok, false);
    assert.match(resZero.error ?? "", /mayor a \$0/i);

    const resNeg = await registrarCruceJugadores({
      emisorId: "USR-1",
      emisorNombre: "CARLOS",
      receptorId: "USR-2",
      receptorNombre: "MIGUEL",
      monto: -50,
      captureSoporte: "data:image/png;base64,abc",
    });
    assert.equal(resNeg.ok, false);
    assert.match(resNeg.error ?? "", /mayor a \$0/i);
  });

  await testAsync("6.3 Validación de cruce entre jugadores exige comprobante de respaldo", async () => {
    const resSin = await registrarCruceJugadores({
      emisorId: "USR-1",
      emisorNombre: "CARLOS",
      receptorId: "USR-2",
      receptorNombre: "MIGUEL",
      monto: 50,
      captureSoporte: "",
    });
    assert.equal(resSin.ok, false);
    assert.match(resSin.error ?? "", /soporte|capture/i);
  });

  console.log("\n=======================================================");
  console.log(`🎉 TODAS LAS PRUEBAS DE CERTIFICACIÓN DE CRUCES PASARON (${ok}/19)`);
  console.log("=======================================================\n");
}

main().catch((err) => {
  console.error("Fallo general:", err);
  process.exit(1);
});
