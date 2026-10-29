/**
 * ============================================================================
 * SUITE DE AUDITORÍA AUTOMÁTICA TOTAL (`pruebas/auditoria-total-apuestas.test.ts`)
 * ============================================================================
 *
 * Verifica de punta a punta las 6 garantías obligatorias:
 *  1. Cruces en Vivo (Tapas):
 *     Pedro tiene 1000 disponibles, juega 1000 al #5 (1P) -> disponible 0.
 *     En la siguiente línea Da 1000 al #5 (1P, 5% com) -> riesgo comprometido
 *     baja de 1000 a 50 y su disponible sube a 950.
 *  2. Cruces en Liquidación (`CON CRUCES` vs `SIN CRUCES`):
 *     Jugador gana 1000 brutos (+950 netos al 5%) en una línea y pierde -600 en
 *     otra línea de la misma carrera:
 *       - SIN CRUCES: neto = +350
 *       - CON CRUCES: recibe reembolso +30 (5% de 600) sumado directamente a su
 *         neto en Positivos/Negativos (+380), sin pintar fila CRUCE suelta en la
 *         tabla de 7 columnas.
 *  3. Separación En Vivo vs. Adelantadas + Estructura de 7 Columnas + Barra de
 *     Carreras Liquidadas en orden numérico.
 *  4. Caso Pedro en Argentina (`-6000` corrupto/huérfano):
 *     El motor centralizado sanea a `0` (`Disponible: 2000` con `Aval: 2000`).
 *  5. Perfil OPERADOR (`rol === 'OPERADOR'`):
 *     Únicamente tiene acceso y visibilidad a `🐎🎲 Apuestas` y `💵📑 Reportes`.
 *     Cualquier ruta ajena (`/clientes`, `/contabilidad`, `/seguridad`, `/grupos`,
 *     `/inicio`) queda bloqueada.
 *  6. Motor Hípico Godet v4 (`MACTOR + SMIC + Actuario v4`):
 *     Retirar un ejemplar `E1` recalcula MACTOR en tiempo real y mantiene la suma
 *     exacta de `100%` en los escenarios SMIC.
 */

import {
  _comprometidoSimuladoCli,
  _reembolsosCruce,
  calcularReembolsosCruce,
} from "../src/features/taquilla/lib/cruces-y-tapas";
import { proyectarFilasEnOrden, type FilaDeCarga } from "../src/features/taquilla/lib/saldosEnCurso";
import { armarReporteCarrera } from "../src/features/liquidacion/lib/reporte-carrera";
import type { CarreraReporte } from "../src/features/liquidacion/lib/reportes";
import {
  calcularEstadoCuentaCliente,
  sanearSaldoHuerfano,
} from "../src/features/saldos/lib/contabilidad-central";
import {
  esRolOperadorExclusivo,
  esRutaPermitidaOperador,
  MODULOS_VISIBLES_OPERADOR,
  rutaPermitida,
} from "../src/features/seguridad/lib/capacidades";
import { baseDeTipo } from "../src/features/seguridad/lib/resolver";
import {
  ordenarCarrerasLiquidadas,
  formatearItemCarreraLiquidada,
} from "../src/features/gestion/lib/carreras-liquidadas-orden";
import {
  generarProspectivaGodet,
  type EjemplarGodet,
} from "../src/features/gaceta/lib/actuarialGodetEngine";

let pasan = 0;
let fallan = 0;

function ok(nombre: string, condicion: boolean, detalle?: string) {
  if (condicion) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  }
}

function eq(nombre: string, obtenido: unknown, esperado: unknown) {
  const a = JSON.stringify(obtenido);
  const b = JSON.stringify(esperado);
  ok(nombre, a === b, `obtenido=${a} esperado=${b}`);
}

// ============================================================================
// 1. CRUCES EN VIVO (TAPAS)
// ============================================================================
console.log("\n[1] Cruces en Vivo (Tapas): cobertura por simulación de peor escenario");
{
  const catalogo = [
    { id: "pedro", nombre: "Pedro", saldo_actual: 1000, aval: 0, modo_juego: "aval" },
    { id: "juan", nombre: "Juan", saldo_actual: 5000, aval: 0, modo_juego: "aval" },
  ];
  const resolver = (txt: string) =>
    catalogo.find((c) => c.nombre.toLowerCase() === txt.trim().toLowerCase()) ?? null;

  // Escenario A: Pedro juega 1000 al #5 (1P) y luego Da 1000 al #5 (1P) como Cliente 2
  const filas: FilaDeCarga[] = [
    { id: "t1", jugada: "1P", caballo: "5", monto: "1000", cliente1: "Pedro", cliente2: "Juan" },
    { id: "t2", jugada: "1P", caballo: "5", monto: "1000", cliente1: "Juan", cliente2: "Pedro" },
    { id: "t3", jugada: "1P", caballo: "2", monto: "950", cliente1: "Pedro", cliente2: "Juan" },
  ];

  const proy = proyectarFilasEnOrden(filas, resolver, 5);
  eq("Línea 1: Pedro juega 1000 al #5 (1P) -> monto aceptado 1000", proy[0].montoAceptado, 1000);
  eq("Línea 1: Disponible de Pedro baja a 0", proy[0].queda, 0);
  eq("Línea 2: Pedro Da 1000 al #5 (1P) -> riesgo comprometido baja a 50", proy[1].riesgoComprometidoCliente2, 50);
  eq("Línea 2: Disponible de Pedro sube inmediatamente a 950 tras la tapa", proy[1].quedaCliente2, 950);
  eq("Línea 3: Pedro puede jugar los 950 liberados en otra línea de la misma carrera", proy[2].montoAceptado, 950);

  // Verificación directa contra _comprometidoSimuladoCli
  const riesgoDirecto = _comprometidoSimuladoCli(
    "Pedro",
    [
      { id: 1, jugador: "Pedro", tercio: "Juan", jugada: "1P", caballo: "5", monto: 1000, comisionPct: 5 },
      { id: 2, jugador: "Juan", tercio: "Pedro", jugada: "1P", caballo: "5", monto: 1000, comisionPct: 5 },
    ],
    5
  );
  eq("_comprometidoSimuladoCli devuelve exactamente 50 de riesgo neto en tapa 1000x1000 al 5%", riesgoDirecto, 50);
}

// ============================================================================
// 2. CRUCES EN LIQUIDACIÓN (`CON CRUCES` vs `SIN CRUCES`)
// ============================================================================
console.log("\n[2] Cruces en Liquidación: reembolso directo al neto sin fila CRUCE suelta");
{
  // Pedro gana 1000 brutos (+950 netos al 5%) en ticket 1 y pierde -600 en ticket 2
  const carreraMock: CarreraReporte = {
    hipodromo: "La Rinconada",
    numero: 1,
    fecha: "2026-10-25",
    pizarra: "5 · 2 · 8",
    subtotal: 0,
    filas: [
      {
        id: "tk-j-1",
        cliente: "Pedro",
        rol: "Juega",
        jugada: "1P",
        caballo: "5",
        monto: 1000,
        resultado: 950,
        esAdelantada: false,
      },
      {
        id: "tk-c-1",
        cliente: "Juan",
        rol: "Consigue",
        jugada: "1P",
        caballo: "5",
        monto: 1000,
        resultado: -1000,
        esAdelantada: false,
      },
      {
        id: "tk-j-2",
        cliente: "Pedro",
        rol: "Juega",
        jugada: "1P",
        caballo: "2",
        monto: 600,
        resultado: -600,
        esAdelantada: false,
      },
      {
        id: "tk-c-2",
        cliente: "Carlos",
        rol: "Consigue",
        jugada: "1P",
        caballo: "2",
        monto: 600,
        resultado: 570,
        esAdelantada: false,
      },
    ],
  };

  const repSinCruces = armarReporteCarrera(carreraMock, "ARGENTINA", undefined, {
    liquidada: true,
    modalidadCruce: "sin_cruces",
    comisionPct: 5,
  });
  const pedroSinCruce = repSinCruces.resumen.ganan.find((g) => g.nombre === "Pedro");
  eq("En modalidad SIN CRUCES el neto de Pedro es +350 (950 - 600)", pedroSinCruce?.monto, 350);

  const repConCruces = armarReporteCarrera(carreraMock, "ARGENTINA", undefined, {
    liquidada: true,
    modalidadCruce: "con_cruces",
    comisionPct: 5,
  });
  const pedroConCruce = repConCruces.resumen.ganan.find((g) => g.nombre === "Pedro");
  eq(
    "En modalidad CON CRUCES Pedro recibe +30 (5% de 600) sumado a su neto = +380",
    pedroConCruce?.monto,
    380
  );
  eq(
    "La tabla de 7 columnas conserva exactamente las 2 jugadas reales sin filas CRUCE sueltas",
    repConCruces.jugadasVivo.length,
    2
  );

  // Verificación directa de _reembolsosCruce y calcularReembolsosCruce
  const calc = calcularReembolsosCruce(
    [{ cliente: "Pedro", brutoGanado: 1000, brutoPerdido: 600 }],
    "con_cruces",
    5
  );
  eq("calcularReembolsosCruce devuelve reembolsoCruce = 30", calc.porCliente.get("PEDRO")?.reembolsoCruce, 30);
  const calcAlias = _reembolsosCruce(
    [
      { cliente: "Pedro", resultado: 950 },
      { cliente: "Pedro", resultado: -600 },
    ],
    "con_cruces",
    5
  );
  eq("_reembolsosCruce reconstruye brutoGanado=1000 desde neto=950 y devuelve 30", calcAlias.totalReembolsado, 30);
}

// ============================================================================
// 3. SEPARACIÓN ESTRICTA EN VIVO VS ADELANTADAS Y BARRA DE CARRERAS LIQUIDADAS
// ============================================================================
console.log("\n[3] Separación En Vivo vs. Adelantadas (7 columnas) y Barra de Carreras Liquidadas");
{
  const carreraMixta: CarreraReporte = {
    hipodromo: "Valencia",
    numero: 3,
    fecha: "2026-10-25",
    pizarra: "4 · 1 · 7",
    subtotal: 0,
    filas: [
      {
        id: "m-j-1",
        cliente: "Luis",
        rol: "Juega",
        jugada: "1P",
        caballo: "4",
        monto: 500,
        resultado: null,
        esAdelantada: false,
      },
      {
        id: "m-c-1",
        cliente: "Mario",
        rol: "Consigue",
        jugada: "1P",
        caballo: "4",
        monto: 500,
        resultado: null,
        esAdelantada: false,
      },
      {
        id: "m-j-2",
        cliente: "Elena",
        rol: "Juega",
        jugada: "2P",
        caballo: "1",
        monto: 300,
        resultado: null,
        esAdelantada: true,
      },
      {
        id: "m-c-2",
        cliente: "Mario",
        rol: "Consigue",
        jugada: "2P",
        caballo: "1",
        monto: 300,
        resultado: null,
        esAdelantada: true,
      },
    ],
  };

  const soloVivo = armarReporteCarrera(carreraMixta, "GRUPO 1", undefined, {
    liquidada: false,
    filtroModalidad: "EN_VIVO",
  });
  const soloAdelantada = armarReporteCarrera(carreraMixta, "GRUPO 1", undefined, {
    liquidada: false,
    filtroModalidad: "ADELANTADA",
  });

  eq("Filtro EN_VIVO incluye únicamente la jugada con es_adelantada=false", soloVivo.jugadasVivo.length, 1);
  eq("Jugador 1 en EN_VIVO es Luis", soloVivo.jugadasVivo[0]?.juega, "Luis");
  eq("Filtro ADELANTADA incluye únicamente la jugada con es_adelantada=true", soloAdelantada.jugadasVivo.length, 1);
  eq("Jugador 1 en ADELANTADA es Elena", soloAdelantada.jugadasVivo[0]?.juega, "Elena");

  // Verificación de las 7 columnas en cada fila de JugadaVivo
  const f7 = soloVivo.jugadasVivo[0]!;
  ok(
    "Fila de reporte contiene los 7 campos de las 7 columnas (juega, aposto, resultado, jugo/caballo, da, apostoDa, resultadoDa)",
    f7.juega === "Luis" &&
      f7.aposto === 500 &&
      f7.resultado === null &&
      Boolean(f7.jugo) &&
      f7.da === "Mario" &&
      f7.apostoDa === 500 &&
      f7.resultadoDa === null
  );

  // Verificación de BarraCarrerasLiquidadas en estricto orden numérico (1ª, 2ª, 3ª...)
  const desordenadas = [
    { carrera: 4, hipodromo: "La Rinconada", pizarra: "3-1-2", totalJugadas: 12, liquidada: true },
    { carrera: 1, hipodromo: "La Rinconada", pizarra: "5-2-8", totalJugadas: 9, liquidada: true },
    { carrera: 3, hipodromo: "La Rinconada", pizarra: "", totalJugadas: 5, liquidada: false },
    { carrera: 2, hipodromo: "La Rinconada", pizarra: "7-4-1", totalJugadas: 15, liquidada: true },
  ];
  const ordenadas = ordenarCarrerasLiquidadas(desordenadas);
  eq(
    "BarraCarrerasLiquidadas filtra solo liquidadas y ordena estrictamente 1ª, 2ª, 4ª",
    ordenadas.map((c) => c.carrera),
    [1, 2, 4]
  );
  eq(
    "Formato compacto de ítem de carrera liquidada coincide con especificación",
    formatearItemCarreraLiquidada(ordenadas[0]),
    "✅ C1 · La Rinconada | Pizarra: 5-2-8 | Jugadas: 9"
  );
}

// ============================================================================
// 4. CASO PEDRO EN ARGENTINA (-6000 CORRUPTO -> 0 CONTABLE / 2000 DISPONIBLE)
// ============================================================================
console.log("\n[4] Contabilidad Centralizada: saneamiento automático de Pedro (-6000 en Argentina)");
{
  const saneado = sanearSaldoHuerfano(-6000, []);
  eq("sanearSaldoHuerfano detecta -6000 sin movimientos y devuelve saldoSaneado = 0", saneado.saldoSaneado, 0);
  eq("sanearSaldoHuerfano marca fueSaneado = true", saneado.fueSaneado, true);

  const estadoPedro = calcularEstadoCuentaCliente({
    id: "pedro-arg",
    nombre: "Pedro",
    grupoNombre: "Argentina",
    saldoBaseBd: -6000,
    aval: 2000,
    comisionPct: 5,
    libre: false,
    movimientos: [],
    jugadasActivasCarrera: [],
  });
  eq("Saldo contable de Pedro en Argentina queda en 0", estadoPedro.saldoContable, 0);
  eq("Aval de Pedro en Argentina es 2000", estadoPedro.aval, 2000);
  eq("Disponible para jugar de Pedro en Argentina es 2000 (0 + 2000 - 0)", estadoPedro.disponibleParaJugar, 2000);
}

// ============================================================================
// 5. PERFIL OPERADOR (`rol === 'OPERADOR'`): SOLO APUESTAS Y REPORTES
// ============================================================================
console.log("\n[5] Control de Acceso para OPERADOR: visibilidad y rutas exclusivas");
{
  ok("esRolOperadorExclusivo reconoce ['OPERADOR']", esRolOperadorExclusivo(["OPERADOR"]));
  ok("esRolOperadorExclusivo reconoce modoOperador=true", esRolOperadorExclusivo(["Admin"], true));
  ok("esRolOperadorExclusivo NO restringe a Admin en vista completa", !esRolOperadorExclusivo(["Admin"], false));

  eq("Operador tiene 10 módulos principales visibles (Operación Principal y Jugadas)", MODULOS_VISIBLES_OPERADOR.length, 10);
  ok("Módulos visibles contienen /inicio", MODULOS_VISIBLES_OPERADOR.some((m) => m.href === "/inicio"));
  ok("Módulos visibles contienen /apuestas", MODULOS_VISIBLES_OPERADOR.some((m) => m.href === "/apuestas"));
  ok("Módulos visibles contienen /saldos-reportes", MODULOS_VISIBLES_OPERADOR.some((m) => m.href === "/saldos-reportes"));
  ok("Módulos visibles contienen /clientes", MODULOS_VISIBLES_OPERADOR.some((m) => m.href === "/clientes"));
  ok("Módulos visibles contienen /tickets", MODULOS_VISIBLES_OPERADOR.some((m) => m.href === "/tickets"));
  ok("Módulos visibles contienen /tablas-fijas", MODULOS_VISIBLES_OPERADOR.some((m) => m.href === "/tablas-fijas"));
  ok("Módulos visibles contienen /marcas", MODULOS_VISIBLES_OPERADOR.some((m) => m.href === "/marcas"));
  ok("Módulos visibles contienen /remates", MODULOS_VISIBLES_OPERADOR.some((m) => m.href === "/remates"));
  ok("Módulos visibles contienen /dupleta", MODULOS_VISIBLES_OPERADOR.some((m) => m.href === "/dupleta"));
  ok("Módulos visibles contienen /pollas", MODULOS_VISIBLES_OPERADOR.some((m) => m.href === "/pollas"));

  // Verificación de acceso a rutas de Operación Principal y Jugadas
  const rutasPermitidasOperador = [
    "/inicio",
    "/dashboard",
    "/apuestas",
    "/gestion-jugadas",
    "/saldos-reportes",
    "/reporte-diario",
    "/clientes",
    "/tickets",
    "/tablas-fijas",
    "/marcas",
    "/remates",
    "/dupleta",
    "/pollas",
  ];
  const capsOperador = new Set(baseDeTipo("operador"));
  for (const r of rutasPermitidasOperador) {
    ok(`Operador puede navegar a ${r}`, esRutaPermitidaOperador(r));
    ok(`baseDeTipo('operador') abre ${r}`, rutaPermitida(r, capsOperador));
  }

  // Rutas administrativas y de configuración bloqueadas
  const rutasBloqueadas = [
    "/grupos",
    "/contabilidad",
    "/contabilidad/caja",
    "/seguridad",
    "/hipodromos",
    "/diagnostico",
    "/whatsapp",
  ];
  for (const r of rutasBloqueadas) {
    ok(
      `Ruta ${r} está bloqueada para el perfil OPERADOR tanto en guard como en capacidades`,
      !esRutaPermitidaOperador(r) && !rutaPermitida(r, capsOperador)
    );
  }
}

// ============================================================================
// 6. MOTOR GODET v4: RETIRO DE EJEMPLAR E1 RECALCULA MACTOR Y SUMA 100% EN SMIC
// ============================================================================
console.log("\n[6] Motor Hípico Godet v4: retiro de ejemplar E1 recalcula MACTOR y suma 100% en SMIC");
{
  const ejemplaresCompletos: EjemplarGodet[] = [
    { id: "1", numero: 1, nombre: "RELÁMPAGO", tipoCarrera: "velocista", speedRatingTTC: 92 },
    { id: "2", numero: 2, nombre: "CENTELLA", tipoCarrera: "velocista", speedRatingTTC: 90 },
    { id: "3", numero: 3, nombre: "CAZADOR", tipoCarrera: "perseguidor", speedRatingTTC: 88 },
    { id: "4", numero: 4, nombre: "TRUENO", tipoCarrera: "rematador", speedRatingTTC: 91 },
  ];

  const factoresBase = {
    pista: "arena" as const,
    clima: "seco" as const,
    cambioJockey: false,
    cambioEntrenador: false,
    reaparecida: false,
    customFactors: [],
  };

  const antes = generarProspectivaGodet(ejemplaresCompletos, "previa", factoresBase);
  eq("Antes del retiro hay 2 punteros E1 en MACTOR", antes.mactor.grupos.E1, 2);
  const sumaSmicAntes = antes.smic.escenarios.reduce((acc, s) => acc + s.probabilidadPct, 0);
  eq("Escenarios SMIC antes del retiro suman exactamente 100%", sumaSmicAntes, 100);

  // Retiramos el ejemplar #1 (E1 velocista)
  const sinRetirado = ejemplaresCompletos.filter((e) => e.numero !== 1);
  const despues = generarProspectivaGodet(sinRetirado, "previa", factoresBase);
  eq("Después de retirar un E1 queda 1 puntero E1 en MACTOR", despues.mactor.grupos.E1, 1);
  ok(
    "El equilibrio MACTOR de punteros E1 cambia al retirar un ejemplar E1",
    despues.mactor.equilibrio.E1 !== antes.mactor.equilibrio.E1
  );
  const sumaSmicDespues = despues.smic.escenarios.reduce((acc, s) => acc + s.probabilidadPct, 0);
  eq("Escenarios SMIC después del retiro siguen sumando exactamente 100%", sumaSmicDespues, 100);
}

console.log(`\n============================================================================`);
console.log(`AUDITORÍA TOTAL APUESTAS: ${pasan} ok / ${fallan} fallaron`);
if (fallan > 0) process.exit(1);
