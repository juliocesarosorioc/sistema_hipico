// =============================================================================
// Pruebas: Límites de Grupo, Autorización de Administrador y Comisiones
// =============================================================================

import assert from "node:assert/strict";
import { esUsuarioPrincipal } from "../src/features/seguridad/lib/resolver";
import { normalizarLimitesMarcas } from "../src/features/marcas/lib/control-riesgo-marcas";

let pasan = 0;
let fallan = 0;

function ok(nombre: string, condicion: boolean) {
  if (condicion) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}`);
  }
}

console.log("\n[1] Autorización de Administrador — Identificación y Reglas");
ok("josorioc es usuario principal", esUsuarioPrincipal("josorioc"));
ok("josorioc@sistemahipico.local es usuario principal", esUsuarioPrincipal("josorioc@sistemahipico.local"));
ok("julio es usuario principal", esUsuarioPrincipal("julio"));
ok("juliocesarosorio es usuario principal", esUsuarioPrincipal("juliocesarosorio"));
ok("operador_taquilla NO es usuario principal", !esUsuarioPrincipal("operador_taquilla"));
ok("cliente_general NO es usuario principal", !esUsuarioPrincipal("cliente_general"));
ok("usuario vacío NO es usuario principal", !esUsuarioPrincipal(""));

console.log("\n[2] Límites de Riesgo para Marcas por Grupo y Plataforma");
const limitesUSD = normalizarLimitesMarcas(null, "USD");
ok("Límite default por grupo en USD es 120", limitesUSD.limite_por_grupo === 120);
ok("Límite default de plataforma en USD es 120", limitesUSD.limite_general_plataforma === 120);

const limitesVES = normalizarLimitesMarcas(null, "VES");
ok("Límite default por grupo en VES es 120000", limitesVES.limite_por_grupo === 120000);
ok("Límite default de plataforma en VES es 120000", limitesVES.limite_general_plataforma === 120000);

const limitesPersonalizados = normalizarLimitesMarcas({
  limite_por_grupo: 50,
  limite_general_plataforma: 200,
  cupos_por_grupo: {
    "grupo-argentina": { max_monto: 80 },
  },
});
ok("Límite personalizado por grupo respetado", limitesPersonalizados.limite_por_grupo === 50);
ok("Límite específico para grupo-argentina respetado", limitesPersonalizados.cupos_por_grupo?.["grupo-argentina"]?.max_monto === 80);

console.log("\n[3] Cálculo de Comisión de Grupo en Tablas Fijas");
function resolverComisionTablas(grupo: { comision_tablas?: number | null; comision_default?: number | null }): number {
  return Number(grupo.comision_tablas ?? grupo.comision_default ?? 2.5);
}

ok("Grupo con comision_tablas explícita (7%)", resolverComisionTablas({ comision_tablas: 7, comision_default: 2.5 }) === 7);
ok("Grupo con comision_tablas null hereda comision_default (3.5%)", resolverComisionTablas({ comision_tablas: null, comision_default: 3.5 }) === 3.5);
ok("Grupo sin comisiones hereda fallback (2.5%)", resolverComisionTablas({}) === 2.5);

console.log("\n[4] Cálculo de Comisión de Grupo en Marcas");
function resolverComisionMarcas(grupo: { comision_marcas?: number | null; comision_default?: number | null }): number {
  return Number(grupo.comision_marcas ?? grupo.comision_default ?? 2.5);
}

ok("Grupo con comision_marcas explícita (6%)", resolverComisionMarcas({ comision_marcas: 6, comision_default: 2.5 }) === 6);
ok("Grupo con comision_marcas null hereda comision_default (4%)", resolverComisionMarcas({ comision_marcas: null, comision_default: 4 }) === 4);
ok("Grupo sin comisiones hereda fallback (2.5%)", resolverComisionMarcas({}) === 2.5);

console.log("\n[5] Validación de Cupo y Límite de Grupo en Tablas Fijas");
function evaluarLimiteTablasGrupo(params: {
  cupoGrupo: number;
  vendidosGrupo: number;
  maxPorJugada: number | null;
  cantidadIntentada: number;
}): { permitido: boolean; motivo?: string } {
  if (params.cupoGrupo > 0 && params.vendidosGrupo + params.cantidadIntentada > params.cupoGrupo) {
    return {
      permitido: false,
      motivo: `Cupo asignado superado (${params.vendidosGrupo} de ${params.cupoGrupo})`,
    };
  }
  if (params.maxPorJugada != null && params.maxPorJugada > 0 && params.cantidadIntentada > params.maxPorJugada) {
    return {
      permitido: false,
      motivo: `Supera el máximo por jugada (${params.maxPorJugada})`,
    };
  }
  return { permitido: true };
}

const v1 = evaluarLimiteTablasGrupo({ cupoGrupo: 10, vendidosGrupo: 8, maxPorJugada: null, cantidadIntentada: 3 });
ok("Venta bloqueada cuando supera cupo disponible", !v1.permitido);

const v2 = evaluarLimiteTablasGrupo({ cupoGrupo: 10, vendidosGrupo: 8, maxPorJugada: null, cantidadIntentada: 2 });
ok("Venta permitida cuando cabe exactamente en el cupo", v2.permitido);

const v3 = evaluarLimiteTablasGrupo({ cupoGrupo: 100, vendidosGrupo: 5, maxPorJugada: 3, cantidadIntentada: 5 });
ok("Venta bloqueada cuando supera maxPorJugada", !v3.permitido);

const v4 = evaluarLimiteTablasGrupo({ cupoGrupo: 100, vendidosGrupo: 5, maxPorJugada: 3, cantidadIntentada: 2 });
ok("Venta permitida dentro de maxPorJugada", v4.permitido);

console.log(`\n=======================================================`);
console.log(`RESULTADO: ${pasan} ok / ${fallan} fallaron`);
if (fallan > 0) process.exit(1);
