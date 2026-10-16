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

console.log("\n[3] El módulo de Gestión cablea la re-apertura explícita");
ok("tiene el estado reapertura", /const \[reapertura, setReapertura\] = useState\(false\)/.test(gestion));
ok("detecta la carrera liquidada", /const carreraLiquidada = useMemo\(/.test(gestion));
ok("respeta la capacidad (tieneCapacidad)", /tieneCapacidad\("gestion_jugadas:fn_reabrir_carrera"\)/.test(gestion));
ok("ofrece el botón de re-apertura", gestion.includes("Agregar jugada a carrera liquidada"));
ok("la re-apertura se cierra al cambiar de carrera", /setReapertura\(false\);\s*\}, \[hipodromo, fecha, carrera\]\)/.test(gestion));
ok("al reabrir deja rastro en la auditoría", /REABRIR_LIQUIDADA_INICIO/.test(gestion));
ok("al liquidar lo agregado deja rastro en la auditoría", /"REABRIR_LIQUIDADA"/.test(gestion));
ok("en modo re-apertura usa liquidarPendientesDeCarrera", /liquidarPendientesDeCarrera\(/.test(gestion));
ok("el modal cambia a «Liquidar jugadas agregadas»", gestion.includes("Liquidar jugadas agregadas"));

console.log(`\n${pasan} pasaron, ${fallan} fallaron`);
process.exit(fallan > 0 ? 1 : 0);
