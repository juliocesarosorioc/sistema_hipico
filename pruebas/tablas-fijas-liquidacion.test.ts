// ============================================================================
// TABLAS FIJAS — snapshot de la venta, pago y ajuste por retiros.
//
// Bug que estas pruebas blindan (caso Shaflan 18/10/2026): la liquidación de la
// carrera pagaba las tablas fijas con el motor universal, que lee
// `nombre_jugada` ("TABLA FIJA (HIPO Cn)") y NO encuentra el Nº de ejemplar →
// marcaba GANADOR como PERDEDOR con premio 0 y, encima, le cobraba la comisión
// de "jugada perdedora" (monto × pct) inflando la "Comisión de la casa".
//
// Ahora las tablas fijas se liquidan con `club_liquidar_tabla_fija`:
//   · pago = cantidad_tablas × premio_por_tabla  (regla del legacy saldos.js:123)
//   · premio ajustado por retiros POSTERIORES a la venta, usando el snapshot de
//     los precios de TODOS los ejemplares que se guarda al vender.
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { premioConRetiros } from "../src/features/carreras/lib/retiros-nucleo";

let pasan = 0;
let fallan = 0;
const ok = (cond: boolean, msg: string) => {
  if (cond) {
    pasan++;
    console.log(`  ok   ${msg}`);
  } else {
    fallan++;
    console.log(`  FALLA ${msg}`);
  }
};

// ── 1) Fórmula del pago (pura) ──────────────────────────────────────────────
// premioConRetiros(premio, base, sumaRetirados) = premio × (1 − ret/base).
{
  ok(premioConRetiros(100, 160, 0) === 100, "Sin retiros el premio no cambia (100/160 → 100)");
  // Retiran un ejemplar de valor 40 sobre una base de 160: el premio baja 25%.
  ok(premioConRetiros(100, 160, 40) === 75, "Retiro de 40 sobre base 160 baja el premio a 75 (baja 25%)");
  ok(
    Math.abs(premioConRetiros(100, 160, 160) - 0) < 1e-9,
    "Retirar TODA la base deja el premio en 0 (nunca negativo)",
  );
  ok(premioConRetiros(100, 0, 40) === 100, "Base 0 (tabla sin valores) → premio sin tocar");
  ok(premioConRetiros(100, 160, 0) === 100, "Sin retirados no hay baja");
}

// ============================================================================
// SQL: snapshot al vender + pago/ajuste al liquidar
// ============================================================================
const sql = readFileSync(join(process.cwd(), "sql", "tablas_venta.sql"), "utf8");

// --- club_vender_tabla_fija: guarda los precios de TODOS los ejemplares ---
ok(/valores_congelados/.test(sql), "venta: guarda `valores_congelados` (precio de todos los ejemplares)");
ok(/suma_base_congelada/.test(sql), "venta: guarda `suma_base_congelada`");
ok(
  /jsonb_array_elements\(v_caballos\)[\s\S]{0,400}'valor_ejemplar'/.test(sql),
  "venta: el snapshot arma el precio por ejemplar desde `valor_ejemplar`"
);
ok(
  /coalesce\(v_e ->> 'retirado', 'false'\) <> 'true'/.test(sql),
  "venta: el snapshot EXCLUYE a los ejemplares ya retirados"
);

// --- club_liquidar_tabla_fija: pago = cantidad × premio ---
ok(
  /v_pago\s*:=\s*round\(\(v_premio \* v_cant\)::numeric, 2\)/.test(sql),
  "liquidar: pago = premio_por_tabla × cantidad_tablas (no `premio × pts / base`)"
);
ok(
  !/v_premio \* v_pts \/ v_base/.test(sql),
  "liquidar: ya NO reparte el premio por `pts / base` (fórmula vieja rota)"
);
ok(
  /v_cant\s*:=\s*greatest\(coalesce\(v_tk\.cantidad_tablas, 1\), 1\)/.test(sql),
  "liquidar: lee `cantidad_tablas` del ticket (default 1)"
);

// --- ajuste por retiros usando el snapshot (no el valor vivo de la tabla) ---
ok(
  /jsonb_typeof\(v_snap -> 'valores_congelados'\) = 'array'/.test(sql),
  "liquidar: el ajuste por retiros usa `valores_congelados` del snapshot"
);
ok(
  /v_premio \* greatest\(0, v_snap_base - v_suma_ret\) \/ v_snap_base/.test(sql),
  "liquidar: premio_ajustado = premio × (1 − sumaRetirados/base) con la base CONGELADA"
);
ok(
  /v_retirados_actuales/.test(sql) && /retirados_oficiales/.test(sql),
  "liquidar: toma los retirados vigentes de `retirados_oficiales` / `caballos[].retirado`"
);

// --- totales para el resumen ---
ok(
  /'pagado',\s*round\(v_pagado_total/.test(sql),
  "liquidar: devuelve `pagado` (total a pagar a los jugadores)"
);
ok(
  /'comision',\s*round\(v_comision_total/.test(sql),
  "liquidar: devuelve `comision` (lo que se lleva el grupo)"
);
ok(
  /greatest\(0, v_pago - v_jugado\) \* v_pct \/ 100/.test(sql),
  "liquidar: la comisión sale SOLO de la ganancia y solo si gana"
);

// ============================================================================
// Pago esperado (aritmética del legacy): cantidad × premio_por_tabla
// ============================================================================
const pagoTabla = (cantidad: number, premioPorTabla: number) => cantidad * premioPorTabla;
ok(pagoTabla(3, 100) === 300, "pago: 3 tablas a $100 por tabla → $300 (caso Shaflan)");
ok(pagoTabla(1, 100) === 100, "pago: 1 tabla a $100 → $100");

// ============================================================================
// TS: el motor universal ya NO toca las tablas fijas; las liquida su RPC
// ============================================================================
const saldos = readFileSync(
  join(process.cwd(), "src", "features", "liquidacion", "lib", "saldos.ts"),
  "utf8"
);
ok(
  /\.not\("nombre_jugada", "like", "TABLA FIJA%"\)/.test(saldos),
  "saldos: `aplicarLiquidacionSaldos` EXCLUYE los tickets `TABLA FIJA%`"
);

const pagarY = readFileSync(
  join(process.cwd(), "src", "features", "liquidacion", "lib", "pagarYCerrar.ts"),
  "utf8"
);
ok(
  /liquidarTablaFija\(\{\s*tablaId: id, ganadores/.test(pagarY),
  "pagarYCerrar: liquida las tablas fijas de la carrera por su RPC"
);
ok(
  /tablasFijas,/.test(pagarY) && /tablasFijas\?:/.test(pagarY),
  "pagarYCerrar: expone `tablasFijas` (pagado + comisión) en el resumen"
);
ok(
  /claveHipodromo\(String\(t\.hipodromo/.test(pagarY),
  "pagarYCerrar: compara hipódromo por clave canónica (no por texto exacto)"
);

const rpc = readFileSync(
  join(process.cwd(), "src", "features", "tablas", "lib", "rpc.ts"),
  "utf8"
);
ok(
  /pagado:\s*Number\(d\.pagado \?\? 0\)/.test(rpc) && /comision:\s*Number\(d\.comision \?\? 0\)/.test(rpc),
  "rpc: `liquidarTablaFija` devuelve `pagado` y `comision`"
);

console.log(`\nTODO ${fallan === 0 ? "OK" : "FALLA"}: ${pasan} pasaron, ${fallan} fallaron`);
if (fallan > 0) process.exit(1);
