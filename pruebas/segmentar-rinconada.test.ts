// ============================================================================
// PRUEBAS DE SEGMENTACIÓN Y EXTRACCIÓN ROBUSTA DE LA RINCONADA
// ============================================================================
import assert from "node:assert";
import {
  segmentarPorCarreras,
  armarBloques,
} from "@/features/gaceta/lib/segmentar";
import { numeroDeCarrera, numeroDeValida } from "@/features/gaceta/lib/numeros";

console.log("=== PRUEBAS DE SEGMENTACIÓN LA RINCONADA (TODAS LAS CARRERAS) ===");

// 1. Detección de encabezados con prefijo de hipódromo, reunión o clásico
{
  const textoGaceta = `
HIPÓDROMO LA RINCONADA - REUNIÓN N° 45 - DOMINGO 08/11/2026
DATOS DEL PROGRAMA OFICIAL

1ª CARRERA - HORA: 1:30 PM - DISTANCIA 1.200 METROS
1 CATIRE PEDRO - 54 kg - R. Capriles - R. D'Angelo
2 GRAN SOL - 55 kg - J. Lugo - C.L. Uzcategui

REUNIÓN 45 - 2da. CARRERA - DISTANCIA 1.400 METROS
1 WATER CHESTNUT - 53 kg - F. Quevedo
2 ST. PIERRE - 54 kg - M. Rodriguez

3ra. CARRERA - DISTANCIA 1.100 METROS
1 TEMPLADA - 54 kg
2 SWEET FLOWER - 53 kg

COPA GRADISCO - 4ª CARRERA - DISTANCIA 1.600 METROS
1 CANDY CUMMINGS - 55 kg
2 THE BROTHER SLEW - 54 kg

1ª VÁLIDA PARA EL 5 Y 6
5ª CARRERA - DISTANCIA 1.200 METROS
1 PAPA CHINO - 54 kg
2 EL DE VALLE - 55 kg

2ª VÁLIDA PARA EL 5 Y 6
6ª CARRERA - DISTANCIA 1.300 METROS
1 CARACAS BELLA - 53 kg
2 LUNA LLENA - 54 kg

3ª VÁLIDA PARA EL 5 Y 6 (7ª DEL PROGRAMA)
1 THE MINER - 54 kg
2 PRINCIPE ALBERTO - 55 kg

CLÁSICO NUESTRA SEÑORA DE CHIQUINQUIRÁ - 4ª VÁLIDA - 8ª CARRERA
1 GRAN PEPE - 54 kg
2 MY TITICO MATE - 55 kg

5ª VÁLIDA AL 5 Y 6
9ª CARRERA - DISTANCIA 1.200 METROS
1 LINDA BIKINI - 54 kg
2 PRINCESA PILAR - 53 kg

6ª VÁLIDA PARA EL 5 Y 6
10ª CARRERA - DISTANCIA 1.400 METROS
1 EL GRAN ROCKY - 54 kg
2 MR. COCO - 55 kg
`;

  const segmentos = segmentarPorCarreras(textoGaceta);
  const segmentosCarreras = segmentos.filter((s) => s.numero != null);

  console.log(`Segmentos con número detectados: ${segmentosCarreras.length}`);
  const numerosExtraidos = segmentosCarreras.map((s) => s.numero);
  console.log(`Secuencia de carreras: ${numerosExtraidos.join(", ")}`);

  assert.strictEqual(segmentosCarreras.length, 10, "Debe detectar exactamente las 10 carreras sin omitir ninguna");
  assert.deepStrictEqual(numerosExtraidos, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "La secuencia debe ser 1 al 10 completa");

  // Verificar que armarBloques con 1 carrera por bloque genera 10 bloques aislados
  const bloques = armarBloques(segmentos, 1);
  assert.strictEqual(bloques.length, 10, "Debe armar exactamente 10 bloques individuales");
  assert.deepStrictEqual(bloques[0].numeros, [1], "Bloque 1 contiene carrera 1");
  assert.deepStrictEqual(bloques[4].numeros, [5], "Bloque 5 contiene carrera 5 (1ª Válida)");
  assert.deepStrictEqual(bloques[9].numeros, [10], "Bloque 10 contiene carrera 10 (6ª Válida)");
  console.log("✔ Detección y partición en 10 bloques individuales verificada con éxito");
}

// 2. Detección cuando solo vienen las 6 válidas (sin carreras no válidas previas)
{
  const textoSoloValidas = `
1ª VÁLIDA PARA EL 5 Y 6
1 CABALLO UNO - 54 kg
2 CABALLO DOS - 55 kg

2da. VÁLIDA PARA EL 5 Y 6
1 CABALLO TRES - 54 kg
2 CABALLO CUATRO - 55 kg

3ª VÁLIDA AL 5 Y 6
1 CABALLO CINCO - 54 kg
2 CABALLO SEIS - 55 kg

4ta. VÁLIDA PARA EL 5 Y 6
1 CABALLO SIETE - 54 kg
2 CABALLO OCHO - 55 kg

5ª VÁLIDA
1 CABALLO NUEVE - 54 kg
2 CABALLO DIEZ - 55 kg

6ª VÁLIDA PARA EL 5 Y 6
1 CABALLO ONCE - 54 kg
2 CABALLO DOCE - 55 kg
`;

  const segVal = segmentarPorCarreras(textoSoloValidas);
  const segValNums = segVal.filter((s) => s.numero != null).map((s) => s.numero);
  console.log(`Secuencia de solo válidas: ${segValNums.join(", ")}`);

  assert.strictEqual(segValNums.length, 6, "Debe detectar las 6 válidas");
  assert.deepStrictEqual(segValNums, [5, 6, 7, 8, 9, 10], "Las 6 válidas se numeran correlativamente 5 a 10");
  console.log("✔ Secuencia correlativa de válidas sin carreras previas validada correctamente (5..10)");
}

// 3. Prueba de variantes venezolanas de números de carrera y válidas
{
  assert.strictEqual(numeroDeCarrera("1ERA CARRERA"), 1);
  assert.strictEqual(numeroDeCarrera("1ra. carrera"), 1);
  assert.strictEqual(numeroDeCarrera("1ª CAR."), 1);
  assert.strictEqual(numeroDeCarrera("CAR. 12"), 12);
  assert.strictEqual(numeroDeCarrera("CARRERA No. 10"), 10);
  assert.strictEqual(numeroDeCarrera("DECIMOTERCERA CARRERA"), 13);
  assert.strictEqual(numeroDeValida("1ERA VALIDA"), 1);
  assert.strictEqual(numeroDeValida("1ra. válida"), 1);
  assert.strictEqual(numeroDeValida("6ta. VÁLIDA"), 6);
  console.log("✔ Variantes venezolanas de cabeceras y válidas verificadas con éxito");
}

console.log("\n🎉 TODAS LAS PRUEBAS DE SEGMENTACIÓN LA RINCONADA PASARON CON ÉXITO.");
