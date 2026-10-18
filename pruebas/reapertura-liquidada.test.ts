// ============================================================================
// ÍTEM 1 — Registrar MÁS jugadas a una carrera ya CERRADA / LIQUIDADA.
//
// El dueño pide poder agregar jugadas DESPUÉS de liquidar y liquidar SOLO lo
// agregado, sin rehacer toda la carrera, con trazabilidad (capacidad nueva).
//
// Sin base de datos no se puede ejercitar la liquidación real, así que se
// blinda lo que hace que la función sea SEGURA y AUDITABLE:
//   · `liquidarPendientesDeCarrera` liquida con el mismo motor de saldos
//     (idempotente por estado: sólo toca 'Pendiente') y NO reescribe el
//     resultado central ni vuelve a cerrar la tabla;
//   · exige la capacidad `gestion_jugadas:fn_reabrir_carrera`;
//   · el módulo ofrece la re-apertura explícita y la deja en la auditoría.
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

const raiz = process.cwd();
const leer = (...partes: string[]) => readFileSync(join(raiz, ...partes), "utf8");

const pagar = leer("src", "features", "liquidacion", "lib", "pagarYCerrar.ts");
const gestion = leer("src", "features", "gestion", "components", "GestionJugadasModule.tsx");
const capacidades = leer("src", "features", "seguridad", "lib", "capacidades.ts");

// Cuerpo de la función de re-apertura (hasta el siguiente cierre de bloque).
const cuerpo = (() => {
  const i = pagar.indexOf("export async function liquidarPendientesDeCarrera");
  if (i < 0) return "";
  const j = pagar.indexOf("\n}\n", i);
  return pagar.slice(i, j < 0 ? undefined : j + 3);
})();

console.log("\n[1] liquidarPendientesDeCarrera: solo toca lo PENDIENTE");
ok("la función existe", cuerpo.length > 0);
ok("liquida con aplicarLiquidacionSaldos (idempotente por estado)", /aplicarLiquidacionSaldos\(/.test(cuerpo));
ok("NO reescribe el resultado central", !/upsertResultadoCentral\(/.test(cuerpo));
ok("NO vuelve a cerrar la tabla", !/cerrarTablaFija\(/.test(cuerpo));
ok("exige la capacidad de re-apertura", /exigirPermiso\(\s*"gestion_jugadas:fn_reabrir_carrera"/.test(cuerpo));

console.log("\n[2] La capacidad nueva está declarada en el catálogo");
ok("capacidad fn_reabrir_carrera declarada", /"fn_reabrir_carrera"/.test(capacidades));
ok("documentada como crítico", /"fn_reabrir_carrera"[^\n]*"critico"/.test(capacidades));

console.log("\n[3] El módulo de Gestión cablea la re-apertura + edición de jugadas guardadas");
ok("tiene el estado reapertura", /const \[reapertura, setReapertura\] = useState\(false\)/.test(gestion));
ok("tiene el modal de jugadas guardadas", /const \[modalEditarJugadas, setModalEditarJugadas\] = useState\(false\)/.test(gestion));
ok("detecta la carrera liquidada", /const carreraLiquidada = useMemo\(/.test(gestion));
ok("respeta la capacidad (tieneCapacidad)", /tieneCapacidad\("gestion_jugadas:fn_reabrir_carrera"\)/.test(gestion));
ok("ofrece el botón de re-apertura", gestion.includes("Agregar jugada a carrera liquidada"));
ok("ofrece el botón para editar jugadas guardadas", gestion.includes("Editar jugadas guardadas"));
ok("la re-apertura se cierra al cambiar de carrera", /setReapertura\(false\);[\s\S]*?\}, \[hipodromo, fecha, carrera\]\)/.test(gestion));
ok("al reabrir deja rastro en la auditoría", /REABRIR_LIQUIDADA_INICIO/.test(gestion));
ok("al liquidar lo agregado deja rastro en la auditoría", /"REABRIR_LIQUIDADA"/.test(gestion));
ok("en modo re-apertura usa liquidarPendientesDeCarrera", /liquidarPendientesDeCarrera\(/.test(gestion));
ok("el modal cambia a «Liquidar jugadas agregadas»", gestion.includes("Liquidar jugadas agregadas"));

console.log("\n[4] Editar jugadas guardadas de una carrera (aunque esté cerrada)");
const modal = leer("src", "features", "gestion", "components", "ModalEditarJugadasCarrera.tsx");
ok("el módulo monta el modal de edición", /<ModalEditarJugadasCarrera/.test(gestion));
ok("lee las jugadas reales de la carrera", /listarJugadasDeCarrera\(/.test(modal));
ok("corrige con editarJugada", /corregirJugadaYRecalcular\(/.test(modal));
ok("anula con anularJugada", /anularJugadaYRecalcular\(/.test(modal));
ok("exige motivo para corregir", /Indicá el motivo de la corrección/.test(modal));
ok("exige motivo para anular", /Indicá el motivo de la anulación/.test(modal));
ok("deja traza en la auditoría al corregir", /EDITAR_JUGADA_CARRERA/.test(modal));
ok("deja traza en la auditoría al anular", /ANULAR_JUGADA_CARRERA/.test(modal));

console.log("\n[5] Recalcular TODA la carrera al corregir/anular una jugada liquidada");
const recalcular = leer("src", "features", "liquidacion", "lib", "recalcular.ts");
const saldos = leer("src", "features", "liquidacion", "lib", "saldos.ts");
ok("existe la reversión de la liquidación", /export async function revertirLiquidacionCarrera/.test(recalcular));
ok("revertir reusa el MISMO decisor que la liquidación", /decidirTickets\(/.test(recalcular) && /export function decidirTickets/.test(saldos));
ok("corrige y recalcula (revertir → editar → re-liquidar)", /export async function corregirJugadaYRecalcular/.test(recalcular) && /editarJugada\(/.test(recalcular) && /revertirLiquidacionCarrera\(/.test(recalcular));
ok("anula y recalcula", /export async function anularJugadaYRecalcular/.test(recalcular) && /anularJugada\(/.test(recalcular));
ok("recalcula la carrera completa (restaurar)", /export async function recalcularCarrera/.test(recalcular));
ok("la re-liquidación reusa aplicarLiquidacionSaldos", /aplicarLiquidacionSaldos\(/.test(recalcular));
ok("la liquidación excluye jugadas anuladas del motor", /\.or\("anulada\.is\.null,anulada\.eq\.false"\)/.test(saldos));
ok("TABLA usa el premio congelado del ticket como respaldo", /ctx\.premio_por_tabla != null[\s\S]*?fila\.premio_por_tabla/.test(saldos));
ok("el modal pide la comisión de la carrera", /tasaComision\?: number \| null/.test(modal));
ok("el módulo pasa la comisión al modal", /tasaComision=\{comisionNum\}/.test(gestion));

console.log(`\n${pasan} pasaron, ${fallan} fallaron`);
process.exit(fallan > 0 ? 1 : 0);
