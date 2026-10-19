// ============================================================================
// CRUCES EN JUGADAS DE PUESTOS — Regla por Grupo (permite_cruces)
//
// Caso 1 (Grupo CON Cruces = true): Cliente gana +100 y pierde -50 en puestos
// en la misma carrera (Comisión 10%) → Base 50, Comisión 5, Neto +45
// Caso 2 (Grupo SIN Cruces = false): Mismo → Base 100, Comisión 10, Neto +40
// Caso 3 (Pérdida Neta con Cruces): Gana +50, pierde -100 → Base 0, Comisión 0, Neto -50
// Caso 4 (Inmunidad de otras jugadas): Marcas no aplican cruce
// ============================================================================
import { calcularLiquidacionPuestosCarrera, type EntradaCrucePuestos } from "../src/features/motores/lib/puestos";
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

console.log("cruces-puestos:", pasan, "OK /", fallan, "FALLAS");
if (fallan > 0) process.exit(1);
