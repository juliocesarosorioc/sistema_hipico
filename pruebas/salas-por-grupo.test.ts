import assert from "node:assert/strict";
import { generarSalasDefaultGrupo, listarSalasPorGrupo, crearSalaEnGrupo } from "../src/features/whatsapp-sala/lib/salas";

async function runTests() {
  console.log("=== PRUEBAS: CADA GRUPO TIENE SUS PROPIAS SALAS ===");

  // 1. Validar generación de salas por defecto para dos grupos distintos
  const salasG1 = generarSalasDefaultGrupo("grupo_caracas", "Caracas");
  const salasG2 = generarSalasDefaultGrupo("grupo_valencia", "Valencia");

  assert.equal(salasG1.length, 2, "Grupo 1 debe tener 2 salas por defecto");
  assert.equal(salasG2.length, 2, "Grupo 2 debe tener 2 salas por defecto");

  assert.equal(salasG1[0].grupo_id, "grupo_caracas", "Sala de Caracas debe tener grupo_id de Caracas");
  assert.equal(salasG2[0].grupo_id, "grupo_valencia", "Sala de Valencia debe tener grupo_id de Valencia");
  assert.notEqual(salasG1[0].id, salasG2[0].id, "Las salas de distintos grupos deben tener IDs independientes");

  console.log("✓ Caso 1: Generación de salas por defecto diferenciadas por grupo OK");

  // 2. Crear nueva sala en Grupo Caracas
  const resCrearG1 = await crearSalaEnGrupo("grupo_caracas", "Sala Especial Caracas VIP", "Exclusivo apuestas VIP");
  assert.ok(resCrearG1.ok, "Debe permitir crear la sala");
  assert.ok(resCrearG1.sala, "Debe retornar la sala creada");
  assert.equal(resCrearG1.sala.grupo_id, "grupo_caracas", "La sala creada debe pertenecer a grupo_caracas");
  assert.equal(resCrearG1.sala.nombre, "Sala Especial Caracas VIP");

  console.log("✓ Caso 2: Creación de sala vinculada al grupo específico OK");

  // 3. Crear nueva sala en Grupo Valencia
  const resCrearG2 = await crearSalaEnGrupo("grupo_valencia", "Sala Clásicos Valencia", "Carreras de Valencia");
  assert.ok(resCrearG2.ok, "Debe permitir crear la sala");
  assert.equal(resCrearG2.sala?.grupo_id, "grupo_valencia", "La sala debe pertenecer a grupo_valencia");

  console.log("✓ Caso 3: Creación de sala en segundo grupo independiente OK");

  // 4. Listar salas por grupo: no deben mezclarse
  const listadoG1 = await listarSalasPorGrupo("grupo_caracas", "Caracas");
  const listadoG2 = await listarSalasPorGrupo("grupo_valencia", "Valencia");

  assert.ok(listadoG1.some((s) => s.nombre === "Sala Especial Caracas VIP"), "G1 debe contener su sala creada");
  assert.ok(!listadoG1.some((s) => s.nombre === "Sala Clásicos Valencia"), "G1 NO debe contener salas de G2");

  assert.ok(listadoG2.some((s) => s.nombre === "Sala Clásicos Valencia"), "G2 debe contener su sala creada");
  assert.ok(!listadoG2.some((s) => s.nombre === "Sala Especial Caracas VIP"), "G2 NO debe contener salas de G1");

  console.log("✓ Caso 4: Aislamiento total de salas entre grupos verificado OK");

  console.log("🎉 TODAS LAS PRUEBAS DE SALAS INDEPENDIENTES POR GRUPO PASARON (4/4)");
}

runTests().catch((e) => {
  console.error("Error en pruebas:", e);
  process.exit(1);
});
