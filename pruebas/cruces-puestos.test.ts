// ============================================================================
// CRUCES EN JUGADAS DE PUESTOS — Regla por Grupo (permite_cruces)
//
// Caso 1 (Grupo CON Cruces = true): Cliente gana +100 y pierde -50 en puestos
// en la misma carrera (Comisión 10%) → Base 50, Comisión 5, Neto +45
// Caso 2 (Grupo SIN Cruces = false): Mismo → Base 100, Comisión 10, Neto +40
// Caso 3 (Pérdida Neta con Cruces): Gana +50, pierde -100 → Base 0, Comisión 0, Neto -50
// Caso 4 (Inmunidad de otras jugadas): Marcas no aplican cruce
// ============================================================================
import {
  asociarReglasCrucesPuestosPorJugador,
  calcularLiquidacionPuestosCarrera,
  resolverReglaCrucePuestos,
  type EntradaCrucePuestos,
} from "../src/features/motores/lib/puestos";
import { reconciliarIdentidadPersistida } from "../src/features/liquidacion/lib/identidad-tickets";
import { netearComisionCruce, type NeteoCruceItem } from "../src/features/betting/lib/bettingEngine";

let pasan = 0;
let fallan = 0;
const assert = (cond: boolean, msg: string) => {
  if (cond) pasan++;
  else { fallan++; console.error("FALLA:", msg); }
};

// Caso 1: CON cruces, +100 -50, 10% → base 50, comisión 5, neto 45
{
  const entradas: EntradaCrucePuestos[] = [
    { cliente: "C1", ok: true, bruto: 150, monto: 50 }, // gana +100
    { cliente: "C1", ok: false, bruto: 0, monto: 50 },   // pierde -50
  ];
  const res = calcularLiquidacionPuestosCarrera(entradas, { permiteCruces: true, pctComision: 10 });
  assert(res.length === 1, "Caso 1: debe agrupar 1 cliente");
  const r = res[0];
  assert(Math.abs(r.baseComision - 50) < 0.001, `Caso 1 base ${r.baseComision} != 50`);
  assert(Math.abs(r.comision - 5) < 0.001, `Caso 1 comisión ${r.comision} != 5`);
  assert(Math.abs(r.netoCliente - 45) < 0.001, `Caso 1 neto ${r.netoCliente} != 45`);
}

// Caso 2: SIN cruces, +100 -50, 10% → base 100, comisión 10, neto 40
{
  const entradas: EntradaCrucePuestos[] = [
    { cliente: "C1", ok: true, bruto: 150, monto: 50 }, // +100
    { cliente: "C1", ok: false, bruto: 0, monto: 50 },   // -50
  ];
  const res = calcularLiquidacionPuestosCarrera(entradas, { permiteCruces: false, pctComision: 10 });
  const r = res[0];
  assert(Math.abs(r.baseComision - 100) < 0.001, `Caso 2 base ${r.baseComision} != 100`);
  assert(Math.abs(r.comision - 10) < 0.001, `Caso 2 comisión ${r.comision} != 10`);
  assert(Math.abs(r.netoCliente - 40) < 0.001, `Caso 2 neto ${r.netoCliente} != 40`);
}

// Caso 3: CON cruces, gana +50 pierde -100 → base 0, comisión 0, neto -50
{
  const entradas: EntradaCrucePuestos[] = [
    { cliente: "C1", ok: true, bruto: 100, monto: 50 },  // +50
    { cliente: "C1", ok: false, bruto: 0, monto: 100 },  // -100
  ];
  const res = calcularLiquidacionPuestosCarrera(entradas, { permiteCruces: true, pctComision: 10 });
  const r = res[0];
  assert(Math.abs(r.baseComision - 0) < 0.001, `Caso 3 base ${r.baseComision} != 0`);
  assert(Math.abs(r.comision - 0) < 0.001, `Caso 3 comisión ${r.comision} != 0`);
  assert(Math.abs(r.netoCliente - (-50)) < 0.001, `Caso 3 neto ${r.netoCliente} != -50`);
}

// Caso 4: Inmunidad de otras jugadas (Marcas) - sin agrupar por cliente mantiene cruce tradicional
{
  const items: NeteoCruceItem[] = [
    { cliente: "C1", caballo: "1", monto: 50, bruto: 150, ok: true },  // gana +100
    { cliente: "C1", caballo: "1", monto: 50, bruto: 0, ok: false },   // pierde -50
  ];
  const g1 = netearComisionCruce(items, "C1R", 10, { agruparPorCliente: false, permiteCruces: true });
  assert(g1.size > 0, "Caso 4: debe existir grupo");
  for (const [k, v] of g1) {
    assert(Math.abs(v.comisionNeta - 5) < 0.001, `Caso 4a comisión ${v.comisionNeta} != 5`);
  }
}

// Caso 5: las modalidades se aplican por ejemplar y de forma independiente.
{
  const entradas: EntradaCrucePuestos[] = [
    { cliente: "C1", caballo: "1", ok: true, bruto: 150, monto: 50 },
    { cliente: "C1", caballo: "1", ok: false, bruto: 0, monto: 50 },
    { cliente: "C1", caballo: "5", ok: false, bruto: 0, monto: 25 },
  ];
  const [r] = calcularLiquidacionPuestosCarrera(entradas, {
    pctComision: 10,
    grupo: { mismoEjemplar: true, diferenteEjemplar: false },
  });
  assert(r.baseComision === 50, `Caso 5 base ${r.baseComision} != 50`);
  assert(r.comision === 5, `Caso 5 comisión ${r.comision} != 5`);
  assert(r.modalidadesAplicadas.some((m) => m.modalidad === "mismoEjemplar"), "Caso 5 debe registrar modalidad mismo ejemplar");
}

// Caso 6: prioridad estricta: override jugador > override global > ficha > grupo.
{
  const opciones = {
    grupo: { mismoEjemplar: false, diferenteEjemplar: false },
    porJugadorPermanente: { JUAN: { mismoEjemplar: true, diferenteEjemplar: true } },
    carreraTodosOverride: { mismoEjemplar: false },
    carreraPorJugadorOverride: { JUAN: { mismoEjemplar: true } },
  };
  const regla = resolverReglaCrucePuestos(opciones, "juan", "mismoEjemplar");
  assert(regla.activo && regla.origen === "Solo Carrera - Jugador", "Caso 6 debe prevalecer excepción de jugador en carrera");
  const global = resolverReglaCrucePuestos(opciones, "juan", "diferenteEjemplar");
  assert(global.activo && global.origen === "Ficha Usuario", "Caso 6 debe heredar la ficha si el override de carrera no define esa modalidad");
  const globalOverride = resolverReglaCrucePuestos({
    ...opciones,
    carreraTodosOverride: { diferenteEjemplar: false },
  }, "juan", "diferenteEjemplar");
  assert(!globalOverride.activo && globalOverride.origen === "Solo Carrera - Todos", "Caso 6 debe prevalecer excepción global sobre ficha");
  const permanente = resolverReglaCrucePuestos(
    { grupo: { diferenteEjemplar: false }, porJugadorPermanente: { JUAN: { diferenteEjemplar: true } } },
    "JUAN",
    "diferenteEjemplar"
  );
  assert(permanente.activo && permanente.origen === "Ficha Usuario", "Caso 6 debe aplicar la ficha antes que el grupo");
  const grupo = resolverReglaCrucePuestos({ grupo: { mismoEjemplar: true } }, "OTRO", "mismoEjemplar");
  assert(grupo.activo && grupo.origen === "Grupo", "Caso 6 debe usar el grupo cuando no hay overrides");
}

// Caso 7: Diferentes Ejemplares solo netea si esa modalidad está habilitada.
{
  const entradas: EntradaCrucePuestos[] = [
    { cliente: "C1", caballo: "1", ok: true, bruto: 150, monto: 50 },
    { cliente: "C1", caballo: "5", ok: false, bruto: 0, monto: 100 },
  ];
  const [conDiferentes] = calcularLiquidacionPuestosCarrera(entradas, {
    pctComision: 10,
    grupo: { mismoEjemplar: false, diferenteEjemplar: true },
  });
  const [sinDiferentes] = calcularLiquidacionPuestosCarrera(entradas, {
    pctComision: 10,
    grupo: { mismoEjemplar: false, diferenteEjemplar: false },
  });
  assert(conDiferentes.comision === 0, `Caso 7 cruce activo debe dejar comisión 0, recibió ${conDiferentes.comision}`);
  assert(sinDiferentes.comision === 10, `Caso 7 sin cruce debe cobrar comisión completa 10, recibió ${sinDiferentes.comision}`);
}

// Caso 8: las reglas por nombre también deben resolver al liquidar por ID de cliente.
{
  const clienteId = "partner-uuid";
  const jugador = [{ id: clienteId, nombre: "Partner" }];
  const permanente = asociarReglasCrucesPuestosPorJugador(
    { PARTNER: { mismoEjemplar: false, diferenteEjemplar: true } },
    jugador
  );
  const porCarrera = asociarReglasCrucesPuestosPorJugador(
    { PARTNER: { diferenteEjemplar: true } },
    jugador
  );
  const idTienePrioridad = asociarReglasCrucesPuestosPorJugador(
    {
      PARTNER: { diferenteEjemplar: true },
      [clienteId.toUpperCase()]: { diferenteEjemplar: false },
    },
    jugador
  );
  const [reglaPermanente] = calcularLiquidacionPuestosCarrera(
    [
      { cliente: clienteId, caballo: "1", ok: true, bruto: 150, monto: 50 },
      { cliente: clienteId, caballo: "5", ok: false, bruto: 0, monto: 50 },
    ],
    {
      pctComision: 10,
      grupo: { mismoEjemplar: false, diferenteEjemplar: false },
      porJugadorPermanente: permanente,
    }
  );
  const [reglaCarrera] = calcularLiquidacionPuestosCarrera(
    [
      { cliente: clienteId, caballo: "1", ok: true, bruto: 150, monto: 50 },
      { cliente: clienteId, caballo: "5", ok: false, bruto: 0, monto: 50 },
    ],
    {
      pctComision: 10,
      grupo: { mismoEjemplar: false, diferenteEjemplar: false },
      carreraPorJugadorOverride: porCarrera,
    }
  );
  assert(reglaPermanente.comision === 5, `Caso 8 la regla permanente por ID debe cruzar; comisión ${reglaPermanente.comision} != 5`);
  assert(reglaCarrera.comision === 5, `Caso 8 la excepción de carrera por ID debe cruzar; comisión ${reglaCarrera.comision} != 5`);
  assert(
    resolverReglaCrucePuestos({ carreraPorJugadorOverride: idTienePrioridad }, clienteId, "diferenteEjemplar").activo === false,
    "Caso 8 una regla explícita por ID debe prevalecer sobre la regla heredada por nombre"
  );
}

// Caso 9: el mismo jugador liquidado para dos grupos usa la política de cada cuenta.
{
  const liquidaciones = calcularLiquidacionPuestosCarrera(
    [
      { cliente: "partner-id", grupoId: "grupo-a", caballo: "1", ok: true, bruto: 150, monto: 50 },
      { cliente: "partner-id", grupoId: "grupo-a", caballo: "5", ok: false, bruto: 0, monto: 50 },
      { cliente: "partner-id", grupoId: "grupo-b", caballo: "1", ok: true, bruto: 150, monto: 50 },
      { cliente: "partner-id", grupoId: "grupo-b", caballo: "5", ok: false, bruto: 0, monto: 50 },
    ],
    {
      pctComision: 10,
      porGrupo: {
        "grupo-a": { grupo: { mismoEjemplar: false, diferenteEjemplar: true } },
        "grupo-b": { grupo: { mismoEjemplar: false, diferenteEjemplar: false } },
      },
    }
  );
  assert(liquidaciones.length === 2, "Caso 9 debe mantener un resultado por cliente y grupo");
  assert(liquidaciones.find((x) => x.grupoId === "grupo-a")?.comision === 5, "Caso 9 grupo A debe cruzar");
  assert(liquidaciones.find((x) => x.grupoId === "grupo-b")?.comision === 10, "Caso 9 grupo B no debe cruzar");
}

// Caso 10: un ID estable une tickets con nombres distintos y resuelve su regla de cruce.
{
  const clienteId = "cliente-eddie-uuid";
  const [liquidacion] = calcularLiquidacionPuestosCarrera(
    [
      { cliente: "EDDIE", clienteId, caballo: "1", ok: true, bruto: 150, monto: 50 },
      { cliente: "DAVID ADONAY CABRERA LEON", clienteId, caballo: "2", ok: false, bruto: 0, monto: 50 },
    ],
    {
      pctComision: 10,
      grupo: { mismoEjemplar: false, diferenteEjemplar: false },
      porJugadorPermanente: {
        [clienteId]: { mismoEjemplar: false, diferenteEjemplar: true },
      },
    }
  );
  assert(liquidacion.participantes === 2, "Caso 10 agrupa los alias del mismo ID");
  assert(liquidacion.clienteId === clienteId, "Caso 10 conserva el ID estable");
  assert(liquidacion.comision === 5, "Caso 10 aplica la regla de cruce por ID");
  assert(
    liquidacion.modalidadesAplicadas.some((modalidad) => modalidad.modalidad === "diferenteEjemplar"),
    "Caso 10 reporta el cruce entre ejemplares distintos"
  );
}

// Caso 11: el ID persistido reemplaza una identidad de sesión vieja o incorrecta.
{
  const reconciliados = reconciliarIdentidadPersistida(
    [
      { ticketId: 101, cliente1: "Partner", cliente1Id: "id-antiguo" },
      { ticketId: 102, cliente1: "PARTNER / alias", cliente1Id: undefined },
      { ticketId: 103, cliente1: "Otro", cliente1Id: "id-otro" },
    ],
    new Map([
      ["101", "partner-uuid"],
      ["102", "partner-uuid"],
      ["103", "otro-uuid"],
    ])
  );
  assert(reconciliados[0].cliente1Id === reconciliados[1].cliente1Id, "Caso 11 IDs persistidos consolidan alias diferentes");
  assert(reconciliados[0].cliente1Id === "partner-uuid", "Caso 11 prevalece la identidad contable persistida");
  assert(reconciliados[2].cliente1Id === "otro-uuid", "Caso 11 mantiene separadas cuentas diferentes");
}

// Caso 12: cruces completos replican la liquidación contable de la carrera sin depender del ejemplar.
{
  const [liquidacion] = calcularLiquidacionPuestosCarrera(
    [
      { cliente: "INFILTRADO", clienteId: "infiltrado-id", ok: true, bruto: 150, monto: 100 },
      { cliente: "INFILTRADO", clienteId: "infiltrado-id", ok: false, bruto: 0, monto: 35 },
    ],
    {
      pctComision: 5,
      grupo: { mismoEjemplar: true, diferenteEjemplar: true },
    }
  );
  assert(liquidacion.ganadoBruto === 50, "Caso 12 contabiliza la ganancia bruta del cliente");
  assert(liquidacion.perdidoBruto === 35, "Caso 12 contabiliza la pérdida bruta del cliente");
  assert(liquidacion.neto === 15, "Caso 12 totaliza la cuenta en +15 antes de comisión");
  assert(liquidacion.baseComision === 15, "Caso 12 calcula comisión solo sobre el neto positivo");
  assert(liquidacion.comision === 0.75, "Caso 12 cobra 5% de 15");
  assert(liquidacion.netoCliente === 14.25, "Caso 12 acredita el neto de carrera después de comisión");
}

console.log("cruces-puestos:", pasan, "OK /", fallan, "FALLAS");
if (fallan > 0) process.exit(1);
