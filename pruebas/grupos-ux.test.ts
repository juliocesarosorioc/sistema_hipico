// ============================================================================
// ÍTEM 5 — Grupos de Venta y Convenios: UX/UI.
//
// El dueño pide que el LISTADO COMPLETO de grupos registrados quede primero, en
// la parte superior y siempre visible, y que el alta de un grupo se haga en un
// MODAL (botón "➕ Registrar grupo") en vez del formulario embebido.
//
// Sin navegador, se blinda la capa de componente: que el listado salga sin tope
// de alto (completo) y que el formulario de alta viva dentro de un modal.
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
const src = readFileSync(
  join(raiz, "src", "features", "grupos", "components", "GruposModule.tsx"),
  "utf8"
);

console.log("\n[1] Alta de grupo en MODAL");
ok("hay botón \"➕ Registrar grupo\"", src.includes("Registrar grupo"));
ok("el botón abre el modal", /setModalGrupo\(true\)/.test(src));
ok("el formulario vive en un modal condicional", /modalGrupo \? \(/.test(src));
ok("el modal es una capa fija a pantalla", /fixed inset-0 z-\[60\]/.test(src));
ok("el modal se rotula \"Registrar Grupo de Venta\"", src.includes("Registrar Grupo de Venta"));
ok("al guardar se cierra el modal", /setModalGrupo\(false\)/.test(src));

console.log("\n[2] Listado COMPLETO primero, sin tope de alto");
ok(
  "el contenedor de grupos ya no limita el alto (max-h-[24rem])",
  !/max-h-\[24rem\][^>]*>\s*\{visiblesGrupos\.length/.test(src)
);
ok("el listado de grupos se renderiza (visiblesGrupos)", /visiblesGrupos\.map\(/.test(src));

console.log("\n[3] BLOQUE 6 · modal de comisiones sin desborde de pantalla");
const campos = readFileSync(
  join(raiz, "src", "features", "grupos", "components", "CamposComisionesConvenio.tsx"),
  "utf8"
);
ok(
  "el bloque fija el techo de pantalla (max-h-[85vh])",
  /max-h-\[85vh\]/.test(campos)
);
ok(
  "el bloque se reparte en columna y recorta (flex flex-col overflow-hidden rounded-2xl)",
  /flex flex-col overflow-hidden rounded-2xl/.test(campos)
);
ok("el cuerpo rueda por dentro (overflow-y-auto p-5)", /overflow-y-auto p-5/.test(campos));
ok(
  "los campos van en grid limpio (grid-cols-1 sm:grid-cols-2 gap-4)",
  /grid-cols-1 sm:grid-cols-2 gap-4/.test(campos)
);
ok(
  "el modal de edición usa el mismo marco (max-w-2xl max-h-[85vh])",
  /w-full max-w-2xl max-h-\[85vh\] flex flex-col overflow-hidden rounded-2xl/.test(src)
);
ok(
  "el modal de alta usa el mismo marco (max-w-2xl max-h-[85vh])",
  /w-full max-w-2xl max-h-\[85vh\] flex-col overflow-hidden rounded-2xl/.test(src)
);
ok(
  "el pie con Guardar queda fijo y visible (shrink-0)",
  /flex shrink-0 justify-end gap-3 border-t/.test(src)
);

console.log(`\n${pasan} pasaron, ${fallan} fallaron`);
process.exit(fallan > 0 ? 1 : 0);
