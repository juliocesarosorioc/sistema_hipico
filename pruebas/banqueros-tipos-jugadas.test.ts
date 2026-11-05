import { strictEqual, ok } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MODALIDADES_BANQUERO,
  ETIQUETA_MODALIDAD,
  obtenerEtiquetaModalidad,
  type ModalidadBanquero,
  type BanqueroConvenio,
} from "../src/features/liquidacion/lib/banqueros";

const raiz = process.cwd();

console.log("\n[1] Modalidades fijas y tipos dinámicos de banquero");
{
  ok(MODALIDADES_BANQUERO.includes("TABLAS"), "incluye TABLAS");
  ok(MODALIDADES_BANQUERO.includes("MARCAS"), "incluye MARCAS");
  ok(MODALIDADES_BANQUERO.includes("DUPLETA"), "incluye DUPLETA");
  ok(MODALIDADES_BANQUERO.includes("REMATES"), "incluye REMATES");
  ok(MODALIDADES_BANQUERO.includes("WPS"), "incluye WPS");
  ok(MODALIDADES_BANQUERO.includes("POLLAS"), "incluye POLLAS");

  strictEqual(obtenerEtiquetaModalidad("TABLAS"), "Tablas Fijas");
  strictEqual(obtenerEtiquetaModalidad("MARCAS"), "Marcas");
  strictEqual(obtenerEtiquetaModalidad("GANADOR"), "Ganador");
  strictEqual(obtenerEtiquetaModalidad("EXACTA"), "Exacta");
  strictEqual(obtenerEtiquetaModalidad("TRIFECTA"), "Trifecta");
  strictEqual(obtenerEtiquetaModalidad("CUATRIFECTA"), "Cuatrifecta");
  strictEqual(obtenerEtiquetaModalidad("SUPERFECTA"), "Superfecta");
}

console.log("\n[2] Verificación estática de GruposModule y soporte de todos los clientes como banquero");
{
  const mod = readFileSync(
    join(raiz, "src", "features", "grupos", "components", "GruposModule.tsx"),
    "utf8"
  );

  ok(/miembrosGrupoConvenio/.test(mod), "separa miembros del grupo seleccionado");
  ok(/otrosClientesConvenio/.test(mod), "permite seleccionar clientes de toda la plataforma");
  ok(/Banquero por Modalidad y Tipos/.test(mod), "la pestaña indica soporte de modalidades y tipos");
  ok(/banqueroMasivoId/.test(mod), "cuenta con barra de asignación rápida para todos los tipos");
  ok(/filtroBanquero/.test(mod), "cuenta con búsqueda y filtro de modalidades y tipos");
  ok(/obtenerEtiquetaModalidad\(f\.modalidad\)/.test(mod), "formatea la etiqueta para cualquier tipo de jugada");
}

console.log("\n[3] Verificación del trigger SQL club_fijar_banquero_ticket");
{
  const sql = readFileSync(
    join(raiz, "sql", "banqueros_tipos_jugadas.sql"),
    "utf8"
  );

  ok(/club_modalidad_ticket/.test(sql), "define o actualiza club_modalidad_ticket");
  ok(/trg_fijar_banquero_ticket/.test(sql), "redefine trigger trg_fijar_banquero_ticket");
  ok(/nombre_jugada/.test(sql), "inspecciona nombre_jugada de tickets_apuestas");
  ok(/nota_auditoria::jsonb ->> 'jugada'/.test(sql), "inspecciona nota_auditoria.jugada");
}

console.log("\n✅ TODAS LAS PRUEBAS DE BANQUEROS Y TIPOS DE JUGADA PASARON EXITOSAMENTE (3/3)");
