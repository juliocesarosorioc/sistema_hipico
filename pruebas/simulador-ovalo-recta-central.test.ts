import assert from "node:assert/strict";
import { parsearLineaParticipanteGaceta, parsearFilaRetrospecto } from "@/features/inteligencia/lib/extractor-gaceta-venezuela";
import { parsearLineaTraqueo, convertirTiempoQuintosADecimal, calcularCalidadWorkout } from "@/features/inteligencia/lib/extractor-traqueos-venezuela";
import { evaluarFactorPuestoPartida, COLORES_GUALDRAPA, simularCarreraV4 } from "@/features/inteligencia/lib/analista-venezuela-v4";
import { obtenerHitoDistancia, ANCHO_PISTA } from "@/features/inteligencia/lib/geometria-ovalo-rinconada";

console.log("🏇 INICIANDO SUITE DE PRUEBAS: SIMULADOR ÓVALO, RECTA CENTRAL, FACTOR PP Y TRAQUEOS (ih_*)...");

// 1. REGLA DE DIFERENCIACIÓN: N° PROGRAMA vs PP ACTUAL
{
  // Simulación de línea donde el caballo #1 corre por el PP 6 (como en C508 1400m o C510 1500m de La Rinconada)
  const l1 = "1 [PP 6] THE BRONX (USA) 53 Kg - J. Lugo - R. Cartolano";
  const p1 = parsearLineaParticipanteGaceta(l1, 1);
  assert.equal(p1.numeroPrograma, 1, "El número de programa debe ser 1");
  assert.equal(p1.puestoPistaActual, 6, "El puesto de partida debe ser PP 6");
  assert.equal(p1.kilos, 53, "Debe extraer 53 kg");
  assert.equal(p1.jinete, "J. Lugo", "Jinete extraído correctamente");
  assert.equal(p1.entrenador, "R. Cartolano", "Entrenador extraído");

  const l2 = "9 (PP 14) HURACAN JESUS 54 Kg - H. Medina";
  const p2 = parsearLineaParticipanteGaceta(l2, 9);
  assert.equal(p2.numeroPrograma, 9, "El número de programa debe ser 9");
  assert.equal(p2.puestoPistaActual, 14, "El puesto de partida debe ser PP 14");
  console.log("  ✔ Parseo y separación estricta N° Programa vs PP Actual: OK");
}

// 2. PARSEO DE RETROSPECTO HISTÓRICO Y PP PREVIO
{
  const filaRetro = "15/10/2026 C480 445kg 1400 PP 4 (23.1) (72.2) Lleg: 2 a 1 1/2 cpo TPart, corrió adentro";
  const ret = parsearFilaRetrospecto(filaRetro);
  assert.equal(ret.fecha, "2026-10-15");
  assert.equal(ret.carreraNumero, 480);
  assert.equal(ret.distanciaMetros, 1400);
  assert.equal(ret.puestoPartidaPP, 4);
  assert.equal(ret.pesoBalanzaKg, 445);
  assert.ok(ret.comentariosCarrera?.includes("TPart"), "Detecta tropiezo de partida");
  console.log("  ✔ Extracción de PP histórico y tropiezos en retrospecto: OK");
}

// 3. EVALUACIÓN BIOMECÁNICA DEL FACTOR PP (evaluarFactorPuestoPartida)
{
  // A. Bonificación de alivio: partió en PP 1 con TPart (tropiezo) y hoy sale por PP 7
  const evalAlivio = evaluarFactorPuestoPartida(7, 1400, 1, ["TPart", "PMal"]);
  assert.equal(evalAlivio.bonoAlivio, true, "Debe conceder bono de alivio");
  assert.ok(evalAlivio.puntosPP >= 5.5, "Puntuación de PP debe reflejar la mejora");

  // B. Bonificación en tiro largo (1800m): corrió abierto desde PP 14 en la anterior y hoy sale por PP 3
  const evalLargo = evaluarFactorPuestoPartida(3, 1800, 14, ["CAfPa"]);
  assert.equal(evalLargo.bonoCurvaAhorro, true, "Debe conceder ahorro de curva");
  assert.ok(evalLargo.puntosPP >= 6.0, "Puntuación bonificada en curva");
  console.log("  ✔ Evaluación matemática de factor PP (Zonas, ΔPP y Ahorro en codos): OK");
}

// 4. MOTOR DE TRAQUEOS LA RINCONADA Y TOMATIEMPOS INH
{
  // Conversión de quintos a decimal
  assert.equal(convertirTiempoQuintosADecimal('36" 4'), 36.8, "36\" 4 debe ser 36.8s");
  assert.equal(convertirTiempoQuintosADecimal('65" 1'), 65.2, "65\" 1 debe ser 65.2s");
  assert.equal(convertirTiempoQuintosADecimal('11" 2'), 11.4, "11\" 2 debe ser 11.4s");

  // Parsea línea de Gaceta Hípica: EXCITE (USA) 600 en 36" 4 (11" 3), espectacular.
  const tr1 = parsearLineaTraqueo('EXCITE (USA) 600 en 36" 4 (11" 3), espectacular.');
  assert.ok(tr1 !== null);
  assert.equal(tr1.nombreNormalizado, "EXCITE USA");
  assert.equal(tr1.distanciaMetros, 600);
  assert.equal(tr1.tiempoDecimalSegundos, 36.8);
  assert.equal(tr1.remateDecimalSegundos, 11.6);
  assert.equal(tr1.calificacion, "E", "Debe ser calificado Excelente (E)");
  assert.ok(tr1.indiceCalidadWorkout >= 8.5, "Índice workout >= 8.5");

  // Parsea línea con 2da Vuelta: BENICIA (ARG) 1.000 en 65" 4 (11" 2), tronando en la raya. (2V). SS.
  const tr2 = parsearLineaTraqueo('BENICIA (ARG) 1.000 en 65" 4 (11" 2), tronando en la raya. (2V). SS.');
  assert.ok(tr2 !== null);
  assert.equal(tr2.distanciaMetros, 1000);
  assert.equal(tr2.tiempoDecimalSegundos, 65.8);
  assert.equal(tr2.segundaVuelta, true, "Detecta 2da Vuelta (2V)");
  assert.equal(tr2.modalidad, "SS", "Detecta Sin Silla (SS)");
  assert.equal(tr2.calificacion, "E");

  // Parsea PROMETHEUS 600 en 38" 4 (11" 2), volando en los finales. (Con remate de 11.4 y comentario 'volando', el índice alcanza calificación destacada 'E' / 'MB')
  const tr3 = parsearLineaTraqueo('PROMETHEUS 600 en 38" 4 (11" 2), volando en los finales.');
  assert.ok(tr3 !== null);
  assert.equal(tr3.nombreNormalizado, "PROMETHEUS");
  assert.equal(tr3.distanciaMetros, 600);
  assert.ok(["E", "MB"].includes(tr3.calificacion), "Debe calificar Excelente (E) o Muy Bien (MB)");
  console.log("  ✔ Extracción y conversión decimal de TRAQUEOS LA RINCONADA + TOMATIEMPOS: OK");
}

// 5. COLORES DE GUALDRAPA OFICIALES (CLOTH #1 AL #14) PARA LA PISTA RECTA CENTRAL
{
  for (let n = 1; n <= 14; n++) {
    const cloth = COLORES_GUALDRAPA[n];
    assert.ok(cloth, `Debe existir color para el caballo #${n}`);
    assert.ok(cloth.bg.startsWith("#"), "Color de fondo hex válido");
    assert.ok(cloth.text.startsWith("#"), "Color de texto hex válido");
  }
  // Verificar colores reglamentarios: #1 Rojo, #2 Blanco, #3 Azul, #4 Amarillo
  assert.equal(COLORES_GUALDRAPA[1].nombreColor, "Rojo");
  assert.equal(COLORES_GUALDRAPA[2].nombreColor, "Blanco");
  assert.equal(COLORES_GUALDRAPA[3].nombreColor, "Azul");
  assert.equal(COLORES_GUALDRAPA[4].nombreColor, "Amarillo");
  console.log("  ✔ Colores oficiales CLOTH (#1..#14) para la pista recta central: OK");
}

// 6. SIMULACIÓN DE CARRERA CON DOBLE PISTA Y PROYECCIÓN 1:1
{
  const res = simularCarreraV4({
    hipodromo: "LA RINCONADA",
    carreraNumero: 5,
    distancia: 1400,
    fecha: "2026-11-01",
    esValida5y6: true,
    ejemplares: [
      {
        id: "cab-1",
        numero: 1,
        puestoPista: 6, // PP 6 para el número 1 en 1400m
        nombre: "THE BRONX",
        jinete: "J. Lugo",
        kilos: 53,
        entrenador: "R. Cartolano",
        morningLine: 2.0,
        speedRatingTTC: 88,
        estilo: "E1",
        actuacionesPrevias: 5,
        diasSinCorrer: 21,
        pesoOptimoKg: 450,
        efectividadJineteEntrenador: 0.32,
        tendenciaTramoFinal: "SE_MANTIENE",
      },
      {
        id: "cab-2",
        numero: 2,
        puestoPista: 7,
        nombre: "HURACAN JESUS",
        jinete: "H. Medina",
        kilos: 54,
        entrenador: "R. Lanz",
        morningLine: 3.5,
        speedRatingTTC: 84,
        estilo: "E3",
        actuacionesPrevias: 6,
        diasSinCorrer: 28,
        pesoOptimoKg: 460,
        efectividadJineteEntrenador: 0.25,
        tendenciaTramoFinal: "ATROPELLA",
      },
    ],
  });

  assert.ok(res.ranking.length === 2);
  assert.equal(res.ranking[0].ordenLlegadaProyectado, 1);
  assert.ok(res.ranking[0].probabilidadSMIC > 0);
  console.log("  ✔ Simulación integrada con ranking proyectado y factores duales: OK");
}

// 7. RAYAS DE DISTANCIA RECTAS Y PERPENDICULARES ENTRE BARANDA INTERIOR Y BARANDA EXTERIOR
{
  for (let m = 0; m <= 1800; m += 100) {
    const { posRiel, posExt } = obtenerHitoDistancia(m);
    const dx = posExt.x - posRiel.x;
    const dy = posExt.y - posRiel.y;
    const longitudRaya = Math.hypot(dx, dy);

    // Cada raya debe cruzar exactamente el ancho de la pista (70m)
    assert.ok(
      Math.abs(longitudRaya - ANCHO_PISTA) < 0.001,
      `La raya en el hito ${m}m debe medir exactamente ANCHO_PISTA (${ANCHO_PISTA}), midió ${longitudRaya}`
    );

    // En las rectas (inferior 0..360m y enfrente 860..1260m): la raya debe ser vertical pura (dx === 0)
    if (m <= 360 || (m >= 860 && m <= 1260) || m >= 1760) {
      assert.ok(
        Math.abs(dx) < 0.001,
        `En tramo recto (${m}m), la raya debe ser recta vertical (dx=0), pero dx fue ${dx}`
      );
    }
  }
  console.log("  ✔ Rayas de distancias cada 100m son rectas y perpendiculares entre baranda interior y exterior: OK");
}

console.log("\n🎉 TODAS LAS PRUEBAS DE SIMULADOR DE ÓVALO CON RECTA CENTRAL, PP Y TRAQUEOS PASARON EXITOSAMENTE (7/7).\n");
