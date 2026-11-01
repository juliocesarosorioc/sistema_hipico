import assert from "node:assert/strict";
import {
  calcularDeltaMovimientoSaldo,
  calcularSaldoSemana,
} from "../src/features/saldos/lib/saldo-semanal";

assert.equal(calcularDeltaMovimientoSaldo("DEPOSITO", 100), 100);
assert.equal(calcularDeltaMovimientoSaldo("RETIRO", 35.5), -35.5);
assert.equal(calcularDeltaMovimientoSaldo("PAGO_A_GANADOR", 42), -42);
assert.equal(calcularDeltaMovimientoSaldo("COBRO_CLIENTE", 20), 20);
assert.equal(
  calcularDeltaMovimientoSaldo("TRANSFERENCIA_SALIDA", 18) +
    calcularDeltaMovimientoSaldo("TRANSFERENCIA_ENTRADA", 18),
  0,
  "Una transferencia entre clientes no altera el total de saldos"
);
assert.equal(
  calcularSaldoSemana(142.5, 0, -50),
  92.5,
  "El saldo semanal incorpora el pago hecho dentro de esa semana"
);
assert.equal(
  calcularSaldoSemana(0, 0, 10),
  10,
  "Cada semana se calcula desde cero, sin arrastrar el cierre anterior"
);

console.log("7 pasaron, 0 fallaron");
