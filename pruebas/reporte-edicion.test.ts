// ============================================================================
// EDICIÓN DE JUGADAS DESDE LOS REPORTES — perfil y mapeo.
//
// El dueño pidió que el detalle del Reporte de Marcas / Tablas Fijas permita
// corregir, anular y restaurar una jugada (con motivo, sin crear), pero SOLO para
// el perfil "Administrador Principal": un operador con capacidad de gestión no
// debe tocar las ventas desde el reporte.
//
// Sin navegador se blinda la lógica: la puerta de perfil (`vigente`) y el mapeo
// del estado de anulación (`reporte-tablas-nucleo`), más el cableado de los
// componentes (leído del fuente, como otras pruebas de UX).
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  esPerfilAdministradorVigente,
  esPrincipalVigente,
  limpiarAccesosVigentes,
  setAccesosVigentes,
  tipoUsuarioVigente,
} from "../src/features/seguridad/lib/vigente";
import { normalizarVenta } from "../src/features/tablas/lib/reporte-tablas-nucleo";

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

// ---------------------------------------------------------------------------
// 1) Puerta de perfil "Administrador Principal"
// ---------------------------------------------------------------------------
setAccesosVigentes({ permisos: [], esPrincipal: false, usuario: "op1", tipoUsuario: "operador" });
ok("operador NO tiene el perfil", esPerfilAdministradorVigente() === false);

setAccesosVigentes({ permisos: [], esPrincipal: false, usuario: "consulta", tipoUsuario: "consulta" });
ok("consulta NO tiene el perfil", esPerfilAdministradorVigente() === false);

setAccesosVigentes({ permisos: [], esPrincipal: false, usuario: "adm2", tipoUsuario: "admin" });
ok("tipo 'admin' SÍ tiene el perfil", esPerfilAdministradorVigente() === true);

setAccesosVigentes({ permisos: [], esPrincipal: false, usuario: "jefe", tipoUsuario: "Administrador Principal" });
ok("tipo 'Administrador Principal' SÍ tiene el perfil", esPerfilAdministradorVigente() === true);

setAccesosVigentes({ permisos: [], esPrincipal: true, usuario: "josorioc", tipoUsuario: "" });
ok("el usuario principal (josorioc) SÍ tiene el perfil", esPerfilAdministradorVigente() === true);
ok("esPrincipalVigente refleja la sesión", esPrincipalVigente() === true);

limpiarAccesosVigentes();
ok("sin sesión NO tiene el perfil", esPerfilAdministradorVigente() === false);
ok("tipoUsuarioVigente queda vacío", tipoUsuarioVigente() === "");

// ---------------------------------------------------------------------------
// 2) El detalle del reporte conoce el estado de anulación
// ---------------------------------------------------------------------------
ok("fila sin anulada → anulada=false", normalizarVenta({ id: "1" }).anulada === false);
ok("fila anulada=true → anulada=true", normalizarVenta({ id: "2", anulada: true }).anulada === true);
ok("anulada no booleana no cuenta", normalizarVenta({ id: "3", anulada: "true" }).anulada === false);

// ---------------------------------------------------------------------------
// 3) Cableado de la capa de presentación (fuente)
// ---------------------------------------------------------------------------
const raiz = process.cwd();
const leer = (...partes: string[]) => readFileSync(join(raiz, ...partes), "utf8");

const modal = leer("src", "features", "reportes", "components", "ReporteVentasModal.tsx");
ok("el reporte consulta el perfil al abrir", /puedeEditarDesdeReporte\(\)/.test(modal));
ok("la columna de acciones depende del perfil", /accionesDetalle/.test(modal));
ok("hay botones de restaurar/anular/editar", /"restaurar"/.test(modal) && /"anular"/.test(modal) && /"editar"/.test(modal));
ok("el modal de acción se monta", /ModalAccionJugadaReporte/.test(modal));

const puerta = leer("src", "features", "reportes", "lib", "edicion-reporte.ts");
ok("la puerta exige el perfil antes de delegar", /if \(!puedeEditarDesdeReporte\(\)\) return \{ ok: false, error: SIN_PERFIL_ADMIN \}/.test(puerta));
ok("delega en las funciones auditadas", /editarJugada\(/.test(puerta) && /anularJugada\(/.test(puerta) && /restaurarJugada\(/.test(puerta));
ok("marca la auditoría con el usuario vigente", /usuarioVigente\(\)/.test(puerta));

console.log(`\n${pasan} pasaron, ${fallan} fallaron`);
process.exit(fallan > 0 ? 1 : 0);
