/**
 * Suite de Auditoría Integral (Requerimientos 1 al 13)
 * Archivo: pruebas/auditoria-reforma-integral.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  claveCanonicaCarreraLiquidada,
  deduplicarYOrdenarCarrerasLiquidadas,
  ordenarCarrerasLiquidadas,
  timestampLiquidacionMs,
  type ItemCarreraLiquidada,
} from "../src/features/gestion/lib/carreras-liquidadas-orden";
import {
  normalizarJugadaPremio,
  calcularRiesgoCliente2,
  extraerEjemplaresMultiples,
  construirMapaPosicionesPizarra,
  getMejorPos,
  logicaGanancias,
  validarPizarraSinDuplicados,
} from "../src/features/liquidacion/lib/puestos";
import {
  aplicarDevolucionIncentivoAFavor,
  calcularEstadoCuentaCliente,
  construirFichaEstadoCuentaUnificada,
} from "../src/features/saldos/lib/contabilidad-central";

const ROOT = process.cwd();

console.log("=== INICIANDO AUDITORÍA DE REFORMA INTEGRAL (13 REQUERIMIENTOS) ===");

// ---------------------------------------------------------------------------
// 1. Deduplicación y orden cronológico inverso de `Carreras Liquidadas` (Drawer Derecho)
// ---------------------------------------------------------------------------
{
  const items: ItemCarreraLiquidada[] = [
    {
      fecha: "2026-10-25",
      hipodromo: "La Rinconada",
      carrera: 1,
      pizarra: "2-5-1",
      liquidada_at: "2026-10-25T14:00:00Z",
    },
    {
      fecha: "2026-10-25",
      hipodromo: "LA RINCONADA",
      carrera: 1,
      pizarra: "2-5-1",
      liquidada_at: "2026-10-25T14:05:00Z", // duplicado más reciente de C1
    },
    {
      fecha: "2026-10-25",
      hipodromo: "GULFSTREAM PARK",
      carrera: 3,
      pizarra: "4-7-9",
      liquidada_at: "2026-10-25T16:30:00Z", // la más reciente de todas
    },
    {
      fecha: "2026-10-25",
      hipodromo: "VALENCIA",
      carrera: 2,
      pizarra: "1-3-8",
      liquidada_at: "2026-10-25T15:10:00Z",
    },
  ];

  assert.equal(
    claveCanonicaCarreraLiquidada(items[0]),
    claveCanonicaCarreraLiquidada(items[1]),
    "La clave canónica debe coincidir para misma fecha, hipódromo y carrera"
  );

  const ordenadas = deduplicarYOrdenarCarrerasLiquidadas(items);
  assert.equal(ordenadas.length, 3, "Debe eliminar estrictamente carreras duplicadas");
  assert.equal(ordenadas[0].hipodromo, "GULFSTREAM PARK", "La más nueva debe ir arriba en el tope");
  assert.equal(ordenadas[1].hipodromo, "VALENCIA", "La intermedia va segunda");
  assert.equal(ordenadas[2].hipodromo, "LA RINCONADA", "La más vieja va abajo y conserva su timestamp más reciente");
  assert.ok(timestampLiquidacionMs(ordenadas[0]) > timestampLiquidacionMs(ordenadas[1]));
  assert.deepEqual(ordenarCarrerasLiquidadas(items).map((x) => x.carrera), [3, 2, 1]);

  const barraSrc = fs.readFileSync(
    path.join(ROOT, "src/features/gestion/components/BarraCarrerasLiquidadas.tsx"),
    "utf8"
  );
  assert.ok(
    barraSrc.includes("🏁 Liquidadas") && barraSrc.includes("translate-x-full"),
    "BarraCarrerasLiquidadas debe ser un Drawer lateral derecho ocultable"
  );
  console.log("✔ [1/6] Drawer derecho de Carreras Liquidadas deduplicado y en orden cronológico inverso OK");
}

// ---------------------------------------------------------------------------
// 2. Evaluación de jugadas de puestos con 2 o más ejemplares (`1y2`, `3y4`)
// ---------------------------------------------------------------------------
{
  assert.deepEqual(extraerEjemplaresMultiples("1y2"), [1, 2]);
  assert.deepEqual(extraerEjemplaresMultiples("3-4"), [3, 4]);
  assert.deepEqual(extraerEjemplaresMultiples("2, 5, 8"), [2, 5, 8]);
  assert.deepEqual(extraerEjemplaresMultiples("1x2"), [1, 2]);

  // Ejemplo 1: 1P con "1y2" cuando el #2 llega 1° -> gana Cliente 1
  const pizarraEj1 = construirMapaPosicionesPizarra(["2", "5", "1", "7", "4"]);
  assert.equal(getMejorPos("1y2", pizarraEj1), 1);
  const resEj1 = logicaGanancias({
    jugada: "1P",
    caballo: "1y2",
    monto: 100,
    comisionPct: 5,
    pizarra: pizarraEj1,
  });
  assert.equal(resEj1.ganaJugador1, true, "1P de 1y2 cuando #2 llega 1° debe ganar Cliente 1");
  assert.equal(resEj1.netoJugador1, 95);
  assert.equal(resEj1.netoJugador2, -100);

  // Ejemplo 2: 2P con "3y4" cuando #3 llega 5° y #4 llega 2° -> mejorPos = 2 -> gana Cliente 1
  const pizarraEj2 = construirMapaPosicionesPizarra(["8", "4", "9", "1", "3"]);
  assert.equal(getMejorPos("3y4", pizarraEj2), 2);
  const resEj2 = logicaGanancias({
    jugada: "2P",
    caballo: "3y4",
    monto: 200,
    comisionPct: 5,
    pizarra: pizarraEj2,
  });
  assert.equal(resEj2.ganaJugador1, true, "2P de 3y4 cuando #4 llega 2° y #3 llega 5° debe ganar Cliente 1");

  // Ejemplo 3: 2P con "3y4" cuando #3 llega 4° y #4 llega 6° -> mejorPos = 4 (>2) -> gana Cliente 2
  const pizarraEj3 = construirMapaPosicionesPizarra(["8", "1", "9", "3", "2", "4"]);
  assert.equal(getMejorPos("3y4", pizarraEj3), 4);
  const resEj3 = logicaGanancias({
    jugada: "2P",
    caballo: "3y4",
    monto: 200,
    comisionPct: 5,
    pizarra: pizarraEj3,
  });
  assert.equal(resEj3.ganaJugador2, true, "2P de 3y4 cuando mejorPos es 4° debe ganar Cliente 2");

  // Ejemplo 4: 2N y 1Y2N con "1y2": si mejorPos === 1 -> gana Cliente 1; si mejorPos === 2 -> NULA en tramo NINI; si >= 3 -> gana Cliente 2
  const resNiniGana = logicaGanancias({
    jugada: "1Y2N",
    caballo: "1y2",
    monto: 100,
    comisionPct: 5,
    pizarra: pizarraEj1, // #2 llegó 1°
  });
  assert.equal(resNiniGana.ganaJugador1, true);

  const pizarraNiniEmpate = construirMapaPosicionesPizarra(["8", "2", "1", "4", "5"]); // #2 llegó 2°, #1 llegó 3° -> mejorPos = 2
  const res2NEmpate = logicaGanancias({
    jugada: "2N",
    caballo: "1y2",
    monto: 100,
    comisionPct: 5,
    pizarra: pizarraNiniEmpate,
  });
  assert.equal(res2NEmpate.empate, true, "En 2N cuando mejorPos === 2 la jugada es NULA/empate");

  const res1Y2N = logicaGanancias({
    jugada: "1Y2N",
    caballo: "1y2",
    monto: 100,
    comisionPct: 5,
    pizarra: pizarraNiniEmpate,
  });
  assert.equal(res1Y2N.netoJugador1, -50, "En 1Y2N cuando mejorPos === 2 el tramo 2N es NULO y solo pierde la mitad (1P)");
  console.log("✔ [2/6] Evaluación de jugadas de puestos con 2 o más ejemplares (getMejorPos) OK");
}

// ---------------------------------------------------------------------------
// 3. Equivalencia exacta entre "10A7", "10a7", "10/7" y "10A3.5", "10/3,5", "10a3,5"
// ---------------------------------------------------------------------------
{
  for (const variante7 of ["10A7", "10a7", "10/7"]) {
    const norm = normalizarJugadaPremio(variante7);
    assert.equal(norm, "10A7", `Debe normalizar ${variante7} a 10A7`);
    assert.equal(calcularRiesgoCliente2(100, variante7), 70);
  }

  for (const variante35 of ["10A3.5", "10/3,5", "10a3,5", "10a3.5", "10/3.5", "10A3,5"]) {
    const norm = normalizarJugadaPremio(variante35);
    assert.equal(norm, "10A3.5", `Debe normalizar ${variante35} a 10A3.5`);
    assert.equal(calcularRiesgoCliente2(100, variante35), 35, `Riesgo C2 para 100 en ${variante35} debe ser 35`);

    // Liquidación cuando gana Cliente 1 vs Cliente 2
    const pizarra = construirMapaPosicionesPizarra(["4", "1", "2", "3", "5"]);
    const liqGanaC1 = logicaGanancias({
      jugada: variante35,
      caballo: "4 por 1",
      monto: 100,
      comisionPct: 5,
      pizarra,
    });
    assert.equal(liqGanaC1.ganaJugador1, true);
    assert.equal(liqGanaC1.riesgoJugador2, 35);
    // Cliente 1 arriesgó 100 contra 35 de Cliente 2: si gana C1, cobra 95 y C2 pierde 35
    assert.equal(liqGanaC1.netoJugador2, -35);
  }
  console.log("✔ [3/6] Equivalencia universal 10Ax / 10/x con decimales punto y coma OK");
}

// ---------------------------------------------------------------------------
// 4. Bloqueo de ejemplares duplicados en la pizarra de resultados
// ---------------------------------------------------------------------------
{
  const dupCheck = validarPizarraSinDuplicados(["4", "2", "4", "7", "1"]);
  assert.equal(dupCheck.ok, false, "Debe rechazar pizarra con ejemplar #4 repetido");
  assert.deepEqual(dupCheck.duplicados, ["4"]);
  assert.equal(
    dupCheck.mensaje,
    "⚠️ El ejemplar #4 ya está asignado en otra posición de la pizarra"
  );

  const okCheck = validarPizarraSinDuplicados(["4", "2", "8", "7", "1"]);
  assert.equal(okCheck.ok, true);
  assert.equal(okCheck.duplicados.length, 0);
  console.log("✔ [4/6] Bloqueo estricto de cero ejemplares duplicados en la pizarra OK");
}

// ---------------------------------------------------------------------------
// 5. Suma positiva (+) de Devolución de Incentivos al saldo final del cliente
// ---------------------------------------------------------------------------
{
  // Si el cliente perdió -1000 y tiene devolución de 100 -> -1000 + 100 = -900
  const devPerdio = aplicarDevolucionIncentivoAFavor(-1000, 100);
  assert.equal(devPerdio.saldoFinalCliente, -900);
  assert.equal(devPerdio.etiqueta, "🎁 Devolución / Incentivo a favor: +100.00");
  // Si el cliente ganó +2000 y tiene devolución de 150 -> +2000 + 150 = +2150
  const devGano = aplicarDevolucionIncentivoAFavor(2000, 150);
  assert.equal(devGano.saldoFinalCliente, 2150);
  assert.equal(devGano.etiqueta, "🎁 Devolución / Incentivo a favor: +150.00");

  const estadoConIncentivo = calcularEstadoCuentaCliente({
    id: "cli-1",
    nombre: "CARLOS",
    saldoInicial: 0,
    devolucionIncentivo: 150,
    movimientos: [
      {
        id: "t-1",
        cliente_juega_id: "cli-1",
        cliente_juega_nombre: "CARLOS",
        monto_jugado: 1000,
        premio_pagar: 0,
        estado: "Perdedor",
      },
    ],
  });
  assert.equal(estadoConIncentivo.jugadasPerdidas, 1000);
  assert.equal(estadoConIncentivo.devolucionIncentivo, 150);
  assert.equal(
    estadoConIncentivo.saldoContable,
    -850,
    "Perdió 1000 + Incentivo a favor 150 = -850"
  );

  const ficha = construirFichaEstadoCuentaUnificada({
    id: "cli-1",
    nombre: "CARLOS",
    saldoInicial: 0,
    aval: 500,
    devolucionIncentivo: 150,
    movimientos: [
      {
        id: "t-1",
        cliente_juega_id: "cli-1",
        cliente_juega_nombre: "CARLOS",
        monto_jugado: 1000,
        premio_pagar: 0,
        estado: "Perdedor",
      },
    ],
  });
  assert.equal(ficha.devolucionIncentivo, 150);
  assert.equal(ficha.saldoContable, -850);
  assert.equal(ficha.avalVigente, 500);
  console.log("✔ [5/6] Suma positiva (+) de Devolución / Incentivo a favor y Ficha Unificada (10 campos) OK");
}

// ---------------------------------------------------------------------------
// 6. Estado inicial `ADELANTADA` en Tablas Fijas, Remates y Marcas + UI / CSS / Reloj / Sidebar
// ---------------------------------------------------------------------------
{
  const tablasSrc = fs.readFileSync(path.join(ROOT, "src/features/tablas/components/TablasModule.tsx"), "utf8");
  const rematesSrc = fs.readFileSync(path.join(ROOT, "src/features/remates/components/RematesModule.tsx"), "utf8");
  const marcasSrc = fs.readFileSync(path.join(ROOT, "src/features/marcas/components/ModalMarcas.tsx"), "utf8");

  assert.ok(
    tablasSrc.includes('useState<ModalidadTiempo>("ADELANTADA")'),
    "TablasModule debe iniciar en ADELANTADA por defecto"
  );
  assert.ok(
    rematesSrc.includes('useState<ModalidadTiempo>("ADELANTADA")'),
    "RematesModule debe iniciar en ADELANTADA por defecto"
  );
  assert.ok(
    marcasSrc.includes('useState<ModalidadTiempo>("ADELANTADA")'),
    "ModalMarcas debe iniciar en ADELANTADA por defecto"
  );

  // Verificar Motor IA Godet v3 movido a Inteligencia Hípica en modo "En Construcción"
  const gestionSrc = fs.readFileSync(
    path.join(ROOT, "src/features/gestion/components/GestionJugadasModule.tsx"),
    "utf8"
  );
  assert.ok(
    !gestionSrc.includes("ModalAnalisisActuarialGodet"),
    "GestionJugadasModule no debe mostrar el botón ni modal de Motor IA Godet v3"
  );
  const proySrc = fs.readFileSync(
    path.join(ROOT, "src/features/inteligencia/components/ProyeccionesModule.tsx"),
    "utf8"
  );
  assert.ok(
    proySrc.includes("🚧 Módulo en Construcción — Próximamente activo"),
    "ProyeccionesModule debe mostrar el aviso En Construcción de Motor Godet v3"
  );

  // Verificar RelojNavegador en Topbar
  const topbarSrc = fs.readFileSync(path.join(ROOT, "src/shared/components/layout/Topbar.tsx"), "utf8");
  assert.ok(topbarSrc.includes("RelojNavegador"), "Topbar debe montar RelojNavegador en la esquina superior derecha");

  // Verificar Sidebar sin Jugadas entre Tercios y con estructura limpia
  const sidebarSrc = fs.readFileSync(path.join(ROOT, "src/shared/components/layout/Sidebar.tsx"), "utf8");
  assert.ok(
    !sidebarSrc.includes("Jugadas entre Tercios"),
    "Sidebar debe ocultar Jugadas entre Tercios"
  );
  assert.ok(
    sidebarSrc.includes("Operación Principal") && sidebarSrc.includes("Jugadas"),
    "Sidebar debe tener las secciones Operación Principal y Jugadas"
  );

  // Verificar CSS unificado en src/app/globals.css y eliminación de src/input.css
  assert.equal(
    fs.existsSync(path.join(ROOT, "src/input.css")),
    false,
    "src/input.css debe haber sido eliminado"
  );
  const globalsCss = fs.readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
  assert.ok(
    globalsCss.includes(".legacy-impresion-container") && globalsCss.includes(".rt-imprimible"),
    "src/app/globals.css debe centralizar las reglas de impresión y tablas"
  );

  console.log("✔ [6/6] Modalidad ADELANTADA por defecto, Motor Godet en Inteligencia, Reloj, Sidebar y CSS Único OK");
}

console.log("6 pasaron, 0 fallaron");
