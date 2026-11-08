import test from "node:test";
import assert from "node:assert/strict";
import {
  resolverEstadoSemaforo,
  validarTransicionPermitida,
  COLORES_SEMAFORO,
  type EstadoCarrera,
} from "../src/features/gestion/lib/semaforo-core";

test("CERTIFICACIÓN ESTADO 1: Carrera sin registros de jugadas ni caballos es GRIS", () => {
  const estado = resolverEstadoSemaforo({
    liquidada: false,
    tieneJugadas: false,
    tieneCaballos: false,
  });
  assert.equal(estado, "inactiva", "Estado debe ser inactiva");
  assert.equal(COLORES_SEMAFORO[estado].colorName, "gris", "Color debe ser gris");
  assert.match(COLORES_SEMAFORO[estado].chip, /bg-slate-300/, "Clase visual debe contener bg-slate-300");
});

test("CERTIFICACIÓN ESTADO 2: Carrera con caballos registrados (precargado) y sin jugadas es VERDE", () => {
  const estado = resolverEstadoSemaforo({
    liquidada: false,
    tieneJugadas: false,
    tieneCaballos: true,
  });
  assert.equal(estado, "abierta", "Estado debe ser abierta");
  assert.equal(COLORES_SEMAFORO[estado].colorName, "verde", "Color debe ser verde");
  assert.match(COLORES_SEMAFORO[estado].chip, /bg-emerald-600/, "Clase visual debe contener bg-emerald-600");
});

test("CERTIFICACIÓN ESTADO 3: Carrera con jugadas y no liquidada es AMARILLO", () => {
  // Con caballos y con jugadas
  const estadoConCaballos = resolverEstadoSemaforo({
    liquidada: false,
    tieneJugadas: true,
    tieneCaballos: true,
  });
  assert.equal(estadoConCaballos, "con_jugadas", "Estado debe ser con_jugadas");
  assert.equal(COLORES_SEMAFORO[estadoConCaballos].colorName, "amarillo", "Color debe ser amarillo");
  assert.match(COLORES_SEMAFORO[estadoConCaballos].chip, /bg-amber-400/, "Clase visual debe contener bg-amber-400");

  // En modo manual o precarga sin caballos pero con jugadas
  const estadoSinCaballos = resolverEstadoSemaforo({
    liquidada: false,
    tieneJugadas: true,
    tieneCaballos: false,
  });
  assert.equal(estadoSinCaballos, "con_jugadas", "Estado con jugadas siempre es con_jugadas");
  assert.equal(COLORES_SEMAFORO[estadoSinCaballos].colorName, "amarillo", "Color debe ser amarillo");
});

test("CERTIFICACIÓN ESTADO 4: Carrera con jugadas liquidadas es ROJO", () => {
  const estado = resolverEstadoSemaforo({
    liquidada: true,
    tieneJugadas: true,
    tieneCaballos: true,
  });
  assert.equal(estado, "cerrada", "Estado debe ser cerrada");
  assert.equal(COLORES_SEMAFORO[estado].colorName, "rojo", "Color debe ser rojo");
  assert.match(COLORES_SEMAFORO[estado].chip, /bg-red-600/, "Clase visual debe contener bg-red-600");
});

test("CERTIFICACIÓN TRANSICIÓN: Luego de liquidada (ROJO) SOLO puede pasar a AMARILLO si se reversa", () => {
  // Estado inicial: Liquidada (ROJO)
  const estadoLiquidada = resolverEstadoSemaforo({
    liquidada: true,
    tieneJugadas: true,
    tieneCaballos: true,
  });
  assert.equal(estadoLiquidada, "cerrada");

  // Se reversa la liquidación: liquidada = false, pero las jugadas siguen existiendo
  const estadoReversada = resolverEstadoSemaforo({
    liquidada: false,
    tieneJugadas: true, // las jugadas se mantienen en la carrera reversada
    tieneCaballos: true,
  });
  assert.equal(estadoReversada, "con_jugadas", "Al reversar la carrera debe pasar estrictamente a AMARILLO");

  // Validación de la transición
  const transicion = validarTransicionPermitida(estadoLiquidada, estadoReversada, "reversar");
  assert.equal(transicion.valida, true, "Transición de ROJO a AMARILLO por reversar es válida");

  // Verificación de que NO puede pasar directamente a VERDE o GRIS al reversar
  const transicionInvalidaVerde = validarTransicionPermitida(estadoLiquidada, "abierta", "reversar");
  assert.equal(transicionInvalidaVerde.valida, false, "No puede pasar de ROJO a VERDE al reversar");

  const transicionInvalidaGris = validarTransicionPermitida(estadoLiquidada, "inactiva", "reversar");
  assert.equal(transicionInvalidaGris.valida, false, "No puede pasar de ROJO a GRIS al reversar");
});

test("CERTIFICACIÓN TRANSICIÓN: De AMARILLO SOLO pasa a VERDE si tiene caballos y se borran todas las jugadas", () => {
  // Estado inicial: AMARILLO (con jugadas y caballos)
  const estadoConJugadas = resolverEstadoSemaforo({
    liquidada: false,
    tieneJugadas: true,
    tieneCaballos: true,
  });
  assert.equal(estadoConJugadas, "con_jugadas");

  // Se eliminan / anulan todas las jugadas: tieneJugadas = false, tieneCaballos = true
  const estadoSinJugadasConCaballos = resolverEstadoSemaforo({
    liquidada: false,
    tieneJugadas: false,
    tieneCaballos: true,
  });
  assert.equal(estadoSinJugadasConCaballos, "abierta", "Al borrar jugadas con caballos registrados pasa a VERDE");

  const trans = validarTransicionPermitida(estadoConJugadas, estadoSinJugadasConCaballos, "borrar_jugadas");
  assert.equal(trans.valida, true);
});

test("CERTIFICACIÓN TRANSICIÓN: De VERDE SOLO pasa de vuelta a GRIS si se eliminan todos los caballos", () => {
  // Estado inicial: VERDE (precargada con caballos, sin jugadas)
  const estadoVerde = resolverEstadoSemaforo({
    liquidada: false,
    tieneJugadas: false,
    tieneCaballos: true,
  });
  assert.equal(estadoVerde, "abierta");

  // Se eliminan todos los caballos de la carrera: tieneCaballos = false
  const estadoSinCaballos = resolverEstadoSemaforo({
    liquidada: false,
    tieneJugadas: false,
    tieneCaballos: false,
  });
  assert.equal(estadoSinCaballos, "inactiva", "Al eliminar todos los caballos vuelve a GRIS");

  const trans = validarTransicionPermitida(estadoVerde, estadoSinCaballos, "eliminar_caballos");
  assert.equal(trans.valida, true);
});

test("CERTIFICACIÓN EXHAUSTIVA DE TODAS LAS 8 COMBINACIONES DE ENTRADA (MÁQUINA DE ESTADOS DETERMINÍSTICA)", () => {
  const casos: Array<{
    liquidada: boolean;
    tieneJugadas: boolean;
    tieneCaballos: boolean;
    esperado: EstadoCarrera;
    descripcion: string;
  }> = [
    // 0 0 0: Sin jugadas, sin caballos, no liquidada -> GRIS
    {
      liquidada: false,
      tieneJugadas: false,
      tieneCaballos: false,
      esperado: "inactiva",
      descripcion: "0 jugadas, 0 caballos -> GRIS",
    },
    // 0 0 1: Sin jugadas, con caballos, no liquidada -> VERDE
    {
      liquidada: false,
      tieneJugadas: false,
      tieneCaballos: true,
      esperado: "abierta",
      descripcion: "Precargada con caballos, 0 jugadas -> VERDE",
    },
    // 0 1 0: Con jugadas, sin caballos, no liquidada -> AMARILLO
    {
      liquidada: false,
      tieneJugadas: true,
      tieneCaballos: false,
      esperado: "con_jugadas",
      descripcion: "Con jugadas manuales, 0 caballos -> AMARILLO",
    },
    // 0 1 1: Con jugadas, con caballos, no liquidada -> AMARILLO
    {
      liquidada: false,
      tieneJugadas: true,
      tieneCaballos: true,
      esperado: "con_jugadas",
      descripcion: "Con jugadas y caballos en juego -> AMARILLO",
    },
    // 1 0 0: Liquidada -> ROJO
    {
      liquidada: true,
      tieneJugadas: false,
      tieneCaballos: false,
      esperado: "cerrada",
      descripcion: "Liquidada sin jugadas -> ROJO",
    },
    // 1 0 1: Liquidada con caballos -> ROJO
    {
      liquidada: true,
      tieneJugadas: false,
      tieneCaballos: true,
      esperado: "cerrada",
      descripcion: "Liquidada con caballos -> ROJO",
    },
    // 1 1 0: Liquidada con jugadas sin caballos -> ROJO
    {
      liquidada: true,
      tieneJugadas: true,
      tieneCaballos: false,
      esperado: "cerrada",
      descripcion: "Liquidada con jugadas -> ROJO",
    },
    // 1 1 1: Liquidada estándar con jugadas y caballos -> ROJO
    {
      liquidada: true,
      tieneJugadas: true,
      tieneCaballos: true,
      esperado: "cerrada",
      descripcion: "Liquidada completa estándar -> ROJO",
    },
  ];

  for (const c of casos) {
    const res = resolverEstadoSemaforo({
      liquidada: c.liquidada,
      tieneJugadas: c.tieneJugadas,
      tieneCaballos: c.tieneCaballos,
    });
    assert.equal(res, c.esperado, `Fallo en caso: ${c.descripcion}`);
  }
});
