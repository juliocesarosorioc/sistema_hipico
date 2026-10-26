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
import {
  armarReporteCarrera,
  esJugadaAdelantadaReporte,
  segmentarJugadasReporte,
  agruparAdelantadasPorSeccion,
  categoriaJugadaAdelantada,
} from "../src/features/liquidacion/lib/reporte-carrera";
import { liquidarOficial } from "../src/features/motores/lib/oficiales";
import { liquidarPuestos } from "../src/features/motores/lib/puestos";
import { relacionResultados } from "../src/features/impresion/lib/reportGenerator";
import { mensajePlanoDeCarrera } from "../src/features/taquilla/lib/mensajeResultado";
import { rutaLoginConBasePath } from "../src/features/auth/lib/sesion";

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

  // Verificar orden de hooks en CargaResultadosModal.tsx (evitar React error #310 al abrir modal)
  const cargaModalSrc = fs.readFileSync(
    path.join(ROOT, "src/features/liquidacion/components/CargaResultadosModal.tsx"),
    "utf8"
  );
  const idxEarlyReturn = cargaModalSrc.indexOf("if (!abierto) return null;");
  assert.ok(idxEarlyReturn > 0, "CargaResultadosModal debe tener early return cuando !abierto");
  const despuesEarlyReturn = cargaModalSrc.slice(idxEarlyReturn);
  assert.equal(
    /\buse(Memo|State|Effect|Callback|Ref)\s*\(/.test(despuesEarlyReturn),
    false,
    "Ningún hook de React (useMemo/useState/useEffect) debe ejecutarse después de 'if (!abierto) return null;'"
  );

  // Verificar segmentación de Jugadas Adelantadas en 7 columnas (igual que Jugadas en Vivo)
  // y exclusión total de adelantadas (ej. MEMPHIS MARCA 3x6 ⏳ ADELANTADA) de la sección en vivo
  const segRinconadaC1 = segmentarJugadasReporte([
    {
      juega: "MEMPHIS",
      aposto: 120,
      resultado: 100,
      jugo: "MARCA",
      caballo: "3x6",
      da: "",
      apostoDa: null,
      resultadoDa: null,
      esAdelantada: true,
    },
    {
      juega: "CARLOS",
      aposto: 200,
      resultado: -200,
      jugo: "1P",
      caballo: "4",
      da: "LUIS",
      apostoDa: 200,
      resultadoDa: 190,
      esAdelantada: false,
    },
  ]);
  assert.equal(segRinconadaC1.enVivo.length, 1, "En Vivo solo debe incluir jugadas no adelantadas (CARLOS)");
  assert.equal(segRinconadaC1.enVivo[0].juega, "CARLOS");
  assert.equal(
    segRinconadaC1.enVivo.some((j) => j.juega === "MEMPHIS" || esJugadaAdelantadaReporte(j)),
    false,
    "MEMPHIS (MARCA 3x6 ⏳ ADELANTADA) jamás debe aparecer en Jugadas en Vivo"
  );
  assert.equal(segRinconadaC1.adelantadas.length, 1, "MEMPHIS debe aparecer únicamente en Jugadas Adelantadas");
  assert.equal(segRinconadaC1.adelantadas[0].juega, "MEMPHIS");
  assert.equal(segRinconadaC1.adelantadas[0].aposto, 120);
  assert.equal(segRinconadaC1.adelantadas[0].resultado, 100);
  assert.equal(segRinconadaC1.adelantadas[0].jugo, "MARCA");
  assert.equal(segRinconadaC1.adelantadas[0].caballo, "3x6");

  const reporteCarreraSrc = fs.readFileSync(
    path.join(ROOT, "src/features/saldos/components/ReporteCarrera.tsx"),
    "utf8"
  );
  assert.ok(
    reporteCarreraSrc.includes("<TablaJugadas filas={adelantadasCol1}") &&
      reporteCarreraSrc.includes("<TablaJugadas filas={jugadasCol1}"),
    "ReporteCarrera debe renderizar la sección de Jugadas Adelantadas con la misma tabla de 7 columnas (TablaJugadas) que Jugadas en Vivo"
  );

  // 14. La Rinconada 1ra Carrera (25/10/2026) — Asiento contable interno "Bono por Cruce de jugadas" (Caso PARTNER +408,50)
  const reporteRinconadaC1Partner = armarReporteCarrera({
    numero: 1,
    hipodromo: "La Rinconada",
    fecha: "2026-10-25",
    pizarra: "3 · 5 · 4 · 1 · 2",
    subtotal: 0,
    filas: [
      // 1) PARTNER 200 (-200,00) | 2Y3N (2) | sam (+190,00)
      {
        id: "2026-10-25-La Rinconada-1-j-0",
        rol: "Juega",
        cliente: "PARTNER",
        jugada: "2Y3N",
        caballo: "2",
        monto: 200,
        resultado: -200,
      },
      {
        id: "2026-10-25-La Rinconada-1-c-0",
        rol: "Consigue",
        cliente: "sam",
        jugada: "2Y3N",
        caballo: "2",
        monto: 200,
        resultado: 190,
      },
      // 2) SAM 400 (-400,00) | 10/8 (1 2) | PARTNER 320 (+380,00)
      {
        id: "2026-10-25-La Rinconada-1-j-1",
        rol: "Juega",
        cliente: "SAM",
        jugada: "10/8",
        caballo: "1 2",
        monto: 400,
        resultado: -400,
      },
      {
        id: "2026-10-25-La Rinconada-1-c-1",
        rol: "Consigue",
        cliente: "PARTNER",
        jugada: "10/8",
        caballo: "1 2",
        monto: 400,
        resultado: 380,
      },
      // 3) BG 180 (-180,00) | 10/8 (1 2) | PARTNER 144 (+171,00)
      {
        id: "2026-10-25-La Rinconada-1-j-2",
        rol: "Juega",
        cliente: "BG",
        jugada: "10/8",
        caballo: "1 2",
        monto: 180,
        resultado: -180,
      },
      {
        id: "2026-10-25-La Rinconada-1-c-2",
        rol: "Consigue",
        cliente: "PARTNER",
        jugada: "10/8",
        caballo: "1 2",
        monto: 180,
        resultado: 171,
      },
      // 4) URIEL 50 (-50,00) | 10/8 (1 2) | PARTNER 40 (+47,50)
      {
        id: "2026-10-25-La Rinconada-1-j-3",
        rol: "Juega",
        cliente: "URIEL",
        jugada: "10/8",
        caballo: "1 2",
        monto: 50,
        resultado: -50,
      },
      {
        id: "2026-10-25-La Rinconada-1-c-3",
        rol: "Consigue",
        cliente: "PARTNER",
        jugada: "10/8",
        caballo: "1 2",
        monto: 50,
        resultado: 47.5,
      },
    ],
  });

  const partnerGana = reporteRinconadaC1Partner.resumen.ganan.find((g) => g.nombre === "PARTNER");
  assert.ok(partnerGana, "PARTNER debe aparecer en el cuadro Ganan / Positivos (+)");
  assert.equal(partnerGana.riesgo, 704, "PARTNER arriesgó 200 + 320 + 144 + 40 = 704");
  assert.equal(
    partnerGana.monto,
    408.5,
    "PARTNER debe reflejar +408,50 (630 ganancia bruta - 200 pérdida = 430 netos antes de comisión -> -5% = 408,50 gracias al Bono por Cruce de jugadas de +10,00)"
  );
  const asientoPartner = reporteRinconadaC1Partner.asientosBonoCruce?.find((a) => a.cliente === "PARTNER");
  assert.ok(asientoPartner, "Debe existir internamente el asiento Bono por Cruce de jugadas para PARTNER");
  assert.equal(asientoPartner.concepto, "Bono por Cruce de jugadas");
  assert.equal(asientoPartner.brutoGanado, 630);
  assert.equal(asientoPartner.brutoPerdido, 200);
  assert.equal(asientoPartner.baseCruce, 200);
  assert.equal(asientoPartner.bonoCruce, 10);
  assert.equal(
    reporteRinconadaC1Partner.jugadasVivo.some((j) => j.jugo.includes("Bono") || j.jugo.includes("CRUCE")),
    false,
    "El asiento Bono por Cruce de jugadas NO debe visualizarse como fila en las tablas de jugadas del reporte"
  );

  // 15. La Rinconada 1ra Carrera (25/10/2026) — Jugada multi-ejemplar: SAM | 50 | 1P (1 2 3) | CLUB (gana el #3)
  for (const formatoCaballos of ["1 2 3", "1,2,3", "1-2-3", "1y2y3", "1x2x3", "(1 2 3)"]) {
    const ticketSam = {
      id: "sam-1p-123",
      hipodromo: "La Rinconada",
      carrera: "1",
      jugada: "1P",
      tipo_jugada: "1P",
      fechas: ["2026-10-25"],
      caballo: formatoCaballos,
      monto: 50,
      cruces: 1,
      cuota: null,
      total: 50,
      addedAt: 0,
      puesto_final: 1,
      dividendos: null,
      pizarra: { primero: "3", segundo: "5", tercero: "4", cuarto: "1", quinto: "2" },
    };
    const resPuestos = liquidarPuestos(ticketSam, 5);
    assert.equal(resPuestos.ok, true, `liquidarPuestos debe dar ganador a SAM en 1P con '${formatoCaballos}' cuando gana el #3`);
    assert.equal(resPuestos.totalClienteNeto, 97.5, "SAM debe recibir 97,50 total (capital 50 + ganancia neta 47,50)");
    assert.equal(resPuestos.gananciaCasa, 2.5, "Comisión casa 5% de 50 = 2,50");

    const resOficial = liquidarOficial(ticketSam, 5);
    assert.equal(resOficial.ok, true, `liquidarOficial debe dar ganador a SAM en 1P con '${formatoCaballos}'`);
    assert.equal(resOficial.totalClienteNeto, 97.5, "Capital (50) + Ganancia neta (47,50) = 97,50");
    assert.equal(resOficial.gananciaCasa, 2.5, "Comisión casa 5% de 50 = 2,50");
  }

  // Incluso si en BD la jugada de SAM tenía `ganador: false` (Perdedor), `relacionResultados` con pizarra ["3", "5", "4"]
  // debe evaluar todos los ejemplares (1, 2, 3) y poner a SAM ganando +47,50 y a CLUB perdiendo -50,00.
  const txtWhatsAppSam = relacionResultados(
    {
      grupo: "LA RINCONADA",
      hipodromo: "La Rinconada",
      fecha: new Date("2026-10-25T12:00:00Z"),
      carrera: 1,
      pizarraPuestos: ["3", "5", "4", "1", "2"],
    },
    [
      {
        clienteJuega: "SAM",
        clienteConsigue: "CLUB",
        jugada: "1P",
        caballo: "1 2 3",
        monto: 50,
        ganador: false, // simula que en BD estaba mal marcada como perdedora
        comisionPct: 5,
      },
    ]
  );
  assert.ok(
    txtWhatsAppSam.includes("Juega SAM $ +47,50") && txtWhatsAppSam.includes("Consigue CLUB $ -50,00"),
    "relacionResultados debe corregir la evaluación con la pizarra y mostrar a SAM ganando +47,50 y CLUB perdiendo -50,00"
  );

  // 16. Segmentación en 5 secciones dentro de Jugadas Adelantadas ("Si las hay")
  assert.equal(categoriaJugadaAdelantada({ jugo: "2N", esAdelantada: true }), "tercios");
  assert.equal(categoriaJugadaAdelantada({ jugo: "MARCA 3x6" }), "marcas");
  assert.equal(categoriaJugadaAdelantada({ jugo: "TABLA FIJA" }), "tablas");
  assert.equal(categoriaJugadaAdelantada({ jugo: "REMATE" }), "remates");
  assert.equal(categoriaJugadaAdelantada({ jugo: "DUPLETA" }), "dupletas");

  const gruposAdelantadas = agruparAdelantadasPorSeccion([
    { juega: "LUIS", jugo: "2N", caballo: "4", aposto: 100, da: "PEDRO", apostoDa: 100, resultado: null, esAdelantada: true },
    { juega: "MEMPHIS", jugo: "MARCA", caballo: "3x6", aposto: 120, da: "", apostoDa: null, resultado: 100, esAdelantada: true },
    { juega: "CARLOS", jugo: "TABLA FIJA", caballo: "2", aposto: 50, da: "BANCA", apostoDa: null, resultado: -50, esAdelantada: true },
    { juega: "ANA", jugo: "REMATE", caballo: "5", aposto: 200, da: "BANCA", apostoDa: null, resultado: 400, esAdelantada: true },
    { juega: "JOSE", jugo: "DUPLETA", caballo: "1-3", aposto: 80, da: "BANCA", apostoDa: null, resultado: -80, esAdelantada: true },
  ]);
  assert.deepEqual(
    gruposAdelantadas.map((g) => g.titulo),
    [
      "Jugadas entre tercios",
      "Marcas Adelantadas",
      "Tablas Adelantadas",
      "Remates Adelantados",
      "Dupletas Adelantadas",
    ],
    "Debe segmentar en las 5 secciones exactas en orden cuando existen jugadas de cada tipo"
  );

  // 17. Reporte preliminar de jugadas incluye las jugadas adelantadas segmentadas
  const txtPreliminarConAdelantadas = mensajePlanoDeCarrera({
    hipodromo: "La Rinconada",
    carrera: 1,
    fecha: "2026-10-25",
    grupo: "LA RINCONADA",
    tickets: [
      { comando: "100 1P", monto: 100, caballo: "3", cliente1: "SAM", cliente2: "CLUB", esAdelantada: false },
      { comando: "120 MARCA", monto: 120, caballo: "3x6", cliente1: "MEMPHIS", cliente2: null, esAdelantada: true },
      { comando: "50 2N", monto: 50, caballo: "4", cliente1: "LUIS", cliente2: "PEDRO", esAdelantada: true },
    ],
  });
  assert.ok(
    txtPreliminarConAdelantadas.includes("⏳ JUGADAS ADELANTADAS (PRE-JUGADAS)") &&
      txtPreliminarConAdelantadas.includes("JUGADAS ENTRE TERCIOS") &&
      txtPreliminarConAdelantadas.includes("MARCAS ADELANTADAS"),
    "El reporte preliminar de jugadas debe incluir las jugadas adelantadas segmentadas por sección"
  );

  // 18. Menú lateral derecho BarraCarrerasLiquidadas en ReporteLiquidacionModal y SelectorReporteCarrera
  const modalLiqSrc = fs.readFileSync(
    path.join(ROOT, "src/features/gestion/components/ReporteLiquidacionModal.tsx"),
    "utf8"
  );
  const selectorRepSrc = fs.readFileSync(
    path.join(ROOT, "src/features/saldos/components/SelectorReporteCarrera.tsx"),
    "utf8"
  );
  assert.ok(
    modalLiqSrc.includes("<BarraCarrerasLiquidadas") && selectorRepSrc.includes("<BarraCarrerasLiquidadas"),
    "El reporte de jugadas debe habilitar el menú lateral derecho BarraCarrerasLiquidadas y eliminar la sección superior"
  );

  // 19. Botón Cerrar Sesión con rutaLoginConBasePath y limpieza inmediata
  const topbarLogoutSrc = fs.readFileSync(
    path.join(ROOT, "src/shared/components/layout/Topbar.tsx"),
    "utf8"
  );
  const sidebarLogoutSrc = fs.readFileSync(
    path.join(ROOT, "src/shared/components/layout/Sidebar.tsx"),
    "utf8"
  );
  assert.ok(
    topbarLogoutSrc.includes("rutaLoginConBasePath") && sidebarLogoutSrc.includes("rutaLoginConBasePath"),
    "Topbar y Sidebar deben usar rutaLoginConBasePath() al cerrar sesión para no generar error 404"
  );
  assert.equal(typeof rutaLoginConBasePath(), "string");

  // 20. Filtro tipo Tabla Dinámica de las carreras en Saldos Consolidados — Semana Fiscal
  const reporteModuleSrc = fs.readFileSync(
    path.join(ROOT, "src/features/saldos/components/ReporteModule.tsx"),
    "utf8"
  );
  assert.ok(
    reporteModuleSrc.includes("Filtro Tipo Tabla Dinámica de las Carreras") &&
      reporteModuleSrc.includes("PIVOT_CARRERAS") &&
      reporteModuleSrc.includes("PIVOT_CLIENTE_CARRERA"),
    "ReporteModule (Saldos Consolidados — Semana Fiscal) debe incluir el filtro tipo Tabla Dinámica de las carreras"
  );

  console.log("✔ [6/6] Modalidad ADELANTADA por defecto, Motor Godet, Reloj, Sidebar, CSS Único, Hooks, Segmentación 5 Secciones Adelantadas, Bono por Cruce (+408,50), Multi-ejemplar 1P (1 2 3), Cerrar Sesión y Tabla Dinámica OK");
}

console.log("6 pasaron, 0 fallaron");
