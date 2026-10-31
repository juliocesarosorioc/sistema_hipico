import test from "node:test";
import assert from "node:assert/strict";
import {
  parseNumeroCaballo,
  compararEjemplares,
  ordenarCarrerasYEjemplares,
  carrerasFaltantes,
  numeroDeCarrera,
} from "../src/features/gaceta/lib/numeros";
import {
  buscarCarreraFaltanteConIA,
  ejecutarOrdenParticularConIA,
} from "../src/features/gaceta/lib/ia";

test("GACETA IA: Ordenamiento determinista de carreras y ejemplares", async (t) => {
  await t.test("1. parseNumeroCaballo parsea enteros y sufijos alfanuméricos", () => {
    const p1 = parseNumeroCaballo(1);
    assert.equal(p1.num, 1);
    assert.equal(p1.sufijo, "");

    const p1a = parseNumeroCaballo("1A");
    assert.equal(p1a.num, 1);
    assert.equal(p1a.sufijo, "A");

    const p10 = parseNumeroCaballo("10");
    assert.equal(p10.num, 10);
    assert.equal(p10.sufijo, "");

    const p2b = parseNumeroCaballo(" 2B ");
    assert.equal(p2b.num, 2);
    assert.equal(p2b.sufijo, "B");
  });

  await t.test("2. compararEjemplares evita el error lexicográfico ('10' antes de '2')", () => {
    const lista = [
      { numero: "10", nombre: "DIEZ" },
      { numero: "2", nombre: "DOS" },
      { numero: "1A", nombre: "UNO A" },
      { numero: 1, nombre: "UNO" },
      { numero: "11", nombre: "ONCE" },
      { numero: "2A", nombre: "DOS A" },
    ];

    lista.sort(compararEjemplares);

    const numerosOrdenados = lista.map((e) => String(e.numero));
    assert.deepEqual(numerosOrdenados, ["1", "1A", "2", "2A", "10", "11"]);
  });

  await t.test("3. ordenarCarrerasYEjemplares ordena carreras por número y caballos por dorsal", () => {
    const carrerasDesordenadas = [
      {
        carrera: 7,
        hipodromo: "LA RINCONADA",
        ejemplares: [
          { numero: 5, nombre: "CINCO" },
          { numero: 1, nombre: "UNO" },
          { numero: 12, nombre: "DOCE" },
          { numero: 2, nombre: "DOS" },
        ],
      },
      {
        carrera: 1,
        hipodromo: "LA RINCONADA",
        ejemplares: [
          { numero: 4, nombre: "CUATRO" },
          { numero: 2, nombre: "DOS" },
          { numero: 1, nombre: "UNO" },
        ],
      },
      {
        carrera: 2,
        hipodromo: "LA RINCONADA",
        ejemplares: [
          { numero: 10, nombre: "DIEZ" },
          { numero: 1, nombre: "UNO" },
          { numero: 3, nombre: "TRES" },
        ],
      },
    ];

    const res = ordenarCarrerasYEjemplares(carrerasDesordenadas);

    // Carreras en orden 1, 2, 7
    assert.equal(res[0].carrera, 1);
    assert.equal(res[1].carrera, 2);
    assert.equal(res[2].carrera, 7);

    // Ejemplares ordenados en cada carrera
    assert.deepEqual(res[0].ejemplares?.map((e) => e.numero), [1, 2, 4]);
    assert.deepEqual(res[1].ejemplares?.map((e) => e.numero), [1, 3, 10]);
    assert.deepEqual(res[2].ejemplares?.map((e) => e.numero), [1, 2, 5, 12]);
  });

  await t.test("4. carrerasFaltantes detecta huecos en la secuencia de carreras", () => {
    const carreras = [
      { carrera: 1, hipodromo: "LA RINCONADA" },
      { carrera: 2, hipodromo: "LA RINCONADA" },
      { carrera: 4, hipodromo: "LA RINCONADA" },
      { carrera: 6, hipodromo: "LA RINCONADA" },
    ];

    const faltantes = carrerasFaltantes(carreras);
    assert.equal(faltantes.length, 1);
    assert.equal(faltantes[0].hipodromo, "LA RINCONADA");
    assert.deepEqual(faltantes[0].faltan, [3, 5]);
  });

  await t.test("5. Exportación de buscarCarreraFaltanteConIA y ejecutarOrdenParticularConIA", () => {
    assert.equal(typeof buscarCarreraFaltanteConIA, "function");
    assert.equal(typeof ejecutarOrdenParticularConIA, "function");
  });
});
