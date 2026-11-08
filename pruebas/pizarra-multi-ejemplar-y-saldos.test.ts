import test from "node:test";
import assert from "node:assert/strict";
import { puestosDesdeOrdenLlegada } from "@/features/motores/lib/oficiales";
import { armarReporteCarrera } from "@/features/liquidacion/lib/reporte-carrera";
import { calcularBaseDecididaCarrera } from "@/features/liquidacion/lib/devoluciones-cruce";
import type { CarreraReporte } from "@/features/liquidacion/lib/reportes";

test("1. puestosDesdeOrdenLlegada procesa fielmente los 4 ejemplares ingresados", () => {
  // Caso Postgres array serializado como string: '{"9","8","6","4"}'
  const resPgQuotes = puestosDesdeOrdenLlegada('{"9","8","6","4"}');
  assert.deepEqual(resPgQuotes, ["9", "8", "6", "4"], "Debe extraer los 4 caballos eliminando comillas de Postgres");

  // Caso Postgres array sin comillas: '{9,8,6,4}'
  const resPgPlain = puestosDesdeOrdenLlegada("{9,8,6,4}");
  assert.deepEqual(resPgPlain, ["9", "8", "6", "4"], "Debe extraer los 4 caballos de {9,8,6,4}");

  // Caso string separado por puntos medios: '9 · 8 · 6 · 4'
  const resPuntos = puestosDesdeOrdenLlegada("9 · 8 · 6 · 4");
  assert.deepEqual(resPuntos, ["9", "8", "6", "4"], "Debe extraer los 4 caballos de '9 · 8 · 6 · 4'");

  // Caso string con guiones: '9-8-6-4'
  const resGuiones = puestosDesdeOrdenLlegada("9-8-6-4");
  assert.deepEqual(resGuiones, ["9", "8", "6", "4"], "Debe extraer los 4 caballos de '9-8-6-4'");

  // Caso array de objetos {numero, puesto}
  const resObj = puestosDesdeOrdenLlegada([
    { numero: "9", puesto: 1 },
    { numero: "8", puesto: 2 },
    { numero: "6", puesto: 3 },
    { numero: "4", puesto: 4 },
  ]);
  assert.deepEqual(resObj, ["9", "8", "6", "4"], "Debe ordenar por puesto y extraer los 4 ejemplares");
});

test("2. armarReporteCarrera coloca los 4 ejemplares en la Pizarra Oficial del Reporte", () => {
  const carreraRep: CarreraReporte = {
    numero: 5,
    hipodromo: "GULFSTREAM PARK",
    fecha: "2026-11-08",
    pizarra: "9 · 8 · 6 · 4",
    pizarraRaya: null,
    retirados: [],
    filas: [
      {
        id: "t1",
        rol: "Juega",
        cliente: "Pedro",
        jugada: "1P #9",
        caballo: "9",
        monto: 50,
        resultado: 100,
        riesgo: 50,
      },
    ],
    subtotal: 100,
  };

  const datosReporte = armarReporteCarrera(carreraRep, "Grupo Principal");
  assert.equal(datosReporte.encabezado.llegada.length, 4, "El reporte debe incluir exactamente los 4 ejemplares");
  assert.equal(datosReporte.encabezado.llegada[0].numero, "9");
  assert.equal(datosReporte.encabezado.llegada[0].puesto, "1º");
  assert.equal(datosReporte.encabezado.llegada[1].numero, "8");
  assert.equal(datosReporte.encabezado.llegada[1].puesto, "2º");
  assert.equal(datosReporte.encabezado.llegada[2].numero, "6");
  assert.equal(datosReporte.encabezado.llegada[2].puesto, "3º");
  assert.equal(datosReporte.encabezado.llegada[3].numero, "4");
  assert.equal(datosReporte.encabezado.llegada[3].puesto, "4º");
});

test("3. Regla canónica de Saldos y Cruces: base de devolución sobre monto neto decidido sin comisión", () => {
  // A. Si solo perdió 50 -> base = 50, devolución al 10% = $5.00
  const casoPerdio = calcularBaseDecididaCarrera(
    [{ nombreJugada: "1P", montoJugado: 50, premioPagar: 0, resultado: -50, estado: "PERDEDOR", rol: "Juega" }],
    10
  );
  assert.equal(casoPerdio.baseDecididaTotal, 50, "Si perdió 50, la base decidida es 50");
  assert.equal(casoPerdio.devolucion, 5, "Devolución 10% sobre 50 es 5");

  // B. Si solo ganó 50 -> base = 50, devolución al 10% = $5.00
  const casoGano = calcularBaseDecididaCarrera(
    [{ nombreJugada: "1P", montoJugado: 25, premioPagar: 75, resultado: 50, estado: "GANADOR", rol: "Juega" }],
    10
  );
  assert.equal(casoGano.baseDecididaTotal, 50, "Si ganó 50 neto, la base decidida es 50");
  assert.equal(casoGano.devolucion, 5, "Devolución 10% sobre 50 es 5");

  // C. Si en la carrera ganó 50 y perdió 20 -> base = |50 - 20| = 30
  const casoCruce = calcularBaseDecididaCarrera(
    [
      { nombreJugada: "1P", montoJugado: 25, premioPagar: 75, resultado: 50, estado: "GANADOR", rol: "Juega" },
      { nombreJugada: "1P", montoJugado: 20, premioPagar: 0, resultado: -20, estado: "PERDEDOR", rol: "Juega" },
    ],
    10
  );
  assert.equal(casoCruce.baseDecididaTotal, 30, "Si ganó 50 y perdió 20, la base neta decidida es 30");
  assert.equal(casoCruce.devolucion, 3, "Devolución 10% sobre 30 es 3");

  // D. Si ganó y perdió lo mismo (50 y 50) -> base = 0
  const casoEmpate = calcularBaseDecididaCarrera(
    [
      { nombreJugada: "1P", montoJugado: 25, premioPagar: 75, resultado: 50, estado: "GANADOR", rol: "Juega" },
      { nombreJugada: "1P", montoJugado: 50, premioPagar: 0, resultado: -50, estado: "PERDEDOR", rol: "Juega" },
    ],
    10
  );
  assert.equal(casoEmpate.baseDecididaTotal, 0, "Si empató ganancias y pérdidas, la base es 0");
  assert.equal(casoEmpate.devolucion, 0, "Devolución es 0");
});
