// ============================================================================
// GESTIÓN DE JUGADAS — botón de saldos, dos clientes y grupo de Marcas.
//
// Tres pedidos del dueño sobre la operación de taquilla:
//
//  1. «El botón de actualizar saldo no funciona»: el catálogo de clientes se
//     cachea en el módulo y `listarClientesVenta()` devolvía la copia vieja sin
//     tocar la base, así que el refresco (y el que corre tras cada venta) no
//     traía los saldos reales. Hay que invalidar el caché ANTES de releer.
//  2. Las jugadas de la taquilla SIEMPRE llevan dos clientes (quién juega +
//     quién da): el CLIENTE 2 dejó de ser informativo y es obligatorio.
//  3. En Marcas el grupo viene por defecto: el del usuario logueado y, si es
//     super administrador, el elegido en el filtro de la barra superior.
//
// Sin navegador se blinda el cableado de los componentes (leído del fuente,
// como otras pruebas de UX).
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";

let pasan = 0;
let fallan = 0;
const ok = (m: string, c: boolean) => {
  if (c) {
    pasan++;
    console.log(`  ok   ${m}`);
  } else {
    fallan++;
    console.log(`  FALLA ${m}`);
  }
};

const raiz = process.cwd();
const leer = (...partes: string[]) => readFileSync(join(raiz, ...partes), "utf8");

const gestion = leer("src", "features", "gestion", "components", "GestionJugadasModule.tsx");
const grupos = leer("src", "features", "grupos", "lib", "grupos.ts");
const marcas = leer("src", "features", "marcas", "components", "ModalMarcas.tsx");

console.log("\n[1] El botón de saldos («🔄 Saldos») vuelve a leer la base");
ok("`limpiarCacheClientesVenta` existe y se exporta", /export function limpiarCacheClientesVenta/.test(grupos));
ok("el módulo importa `limpiarCacheClientesVenta`", /import[\s\S]*limpiarCacheClientesVenta[\s\S]*from "@\/features\/grupos\/lib\/grupos"/.test(gestion));
ok(
  "`recargarClientes` invalida el caché ANTES de listar",
  /limpiarCacheClientesVenta\(\)\s*;[\s\S]{0,160}listarClientesVenta\(\)/.test(gestion)
);
ok("el botón está cableado a `recargarClientes()`", /onClick=\{\(\) => \{\s*void recargarClientes\(\)/.test(gestion));

console.log("\n[2] Dos clientes obligatorios para cargar jugadas");
ok(
  "la carga exige el CLIENTE 2 vacío",
  /falta el CLIENTE 2 \(dador\)\. Las jugadas se cargan con DOS clientes/.test(gestion)
);
ok(
  "la carga exige que el CLIENTE 2 exista en el catálogo",
  /el CLIENTE 2 no está en el catálogo \(se exigen dos clientes\)/.test(gestion)
);
ok(
  "cada falta de CLIENTE 2 marca la fila en rojo (`indicesError`)",
  /falta el CLIENTE 2[\s\S]{0,220}indicesError\.push/.test(gestion)
);
ok("el buscador rotula el CLIENTE 2 como obligatorio", /Cliente 2 \(obligatorio\)/.test(gestion));

console.log("\n[3] Marcas: grupo por defecto (logueado / filtro del super admin)");
ok("el modal importa `grupoDeVentaVigente`", /import[\s\S]*grupoDeVentaVigente[\s\S]*from "@\/features\/grupos\/lib\/grupos"/.test(marcas));
ok("autoselecciona el grupo por defecto", /setGrupoId\(\(actual\) => \{[\s\S]{0,200}grupoDeVentaVigente\(\)/.test(marcas));
ok(
  "un usuario logueado manda su grupo; el super admin, el del filtro",
  /export function grupoDeVentaVigente\(\): string \{\s*const propio = grupoVigente\(\);\s*if \(propio\) return String\(propio\);\s*const activo = grupoActivoVigente\(\);\s*return activo \? String\(activo\) : "";\s*\}/.test(grupos)
);

console.log(`\n${pasan} pasaron, ${fallan} fallaron`);
process.exit(fallan > 0 ? 1 : 0);
