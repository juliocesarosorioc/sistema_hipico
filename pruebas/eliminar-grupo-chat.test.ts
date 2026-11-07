import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  registrarGrupoEliminadoLocal,
  leerGruposEliminadosLocal,
  CLAVE_TOMBSTONES_GRUPOS,
} from "../src/features/grupos/lib/grupos";

test("Tombstones locales para grupos eliminados", () => {
  // Mock localStorage en entorno node
  const memoria: Record<string, string> = {};
  (globalThis as any).window = {
    localStorage: {
      getItem: (k: string) => memoria[k] || null,
      setItem: (k: string, v: string) => {
        memoria[k] = v;
      },
    },
  };

  assert.strictEqual(leerGruposEliminadosLocal().size, 0);

  registrarGrupoEliminadoLocal("grupo-test-123");
  const eliminados = leerGruposEliminadosLocal();
  assert.ok(eliminados.has("grupo-test-123"), "Debe contener el id eliminado");
  assert.strictEqual(eliminados.size, 1);

  // Idempotente
  registrarGrupoEliminadoLocal("grupo-test-123");
  assert.strictEqual(leerGruposEliminadosLocal().size, 1);
});

test("Eliminación de selección interactiva de carreras en el chat (SalaHeaderWallet)", () => {
  const rutaHeader = join(process.cwd(), "src/features/whatsapp-sala/components/SalaHeaderWallet.tsx");
  const codigo = readFileSync(rutaHeader, "utf8");

  // No debe tener selector desplegable de números de carrera ni botones ◀ ▶
  assert.ok(
    !codigo.includes("Selector interactivo de Número de Carrera"),
    "No debe existir el selector interactivo de número de carrera"
  );
  assert.ok(
    !codigo.includes("<select"),
    "No debe existir el tag <select> en el header del chat"
  );
  assert.ok(
    !codigo.includes("title=\"Carrera anterior\""),
    "No deben existir botones de navegación de carrera en el chat"
  );

  // Debe mostrar la carrera activa fija en el badge
  assert.ok(
    codigo.includes("{carreraActiva.hipodromo} C{carreraActiva.carrera} · {carreraActiva.estado}"),
    "El badge debe mostrar la carrera activa fija sin selector"
  );
});

test("RPC y lógica robusta de eliminación de grupos", () => {
  const rutaLib = join(process.cwd(), "src/features/grupos/lib/grupos.ts");
  const codigoLib = readFileSync(rutaLib, "utf8");

  assert.ok(
    codigoLib.includes("club_eliminar_grupo"),
    "Debe llamar a la RPC security definer club_eliminar_grupo"
  );
  assert.ok(
    codigoLib.includes("registrarGrupoEliminadoLocal"),
    "Debe invocar registrarGrupoEliminadoLocal"
  );

  const rutaSql = join(process.cwd(), "sql/eliminar_grupo_robusto.sql");
  const codigoSql = readFileSync(rutaSql, "utf8");
  assert.ok(
    codigoSql.includes("create or replace function public.club_eliminar_grupo"),
    "Debe definir la función club_eliminar_grupo en SQL"
  );
  assert.ok(
    codigoSql.includes("foreign_key_violation"),
    "Debe manejar foreign_key_violation para aplicar soft delete si hay tickets históricos"
  );
});
