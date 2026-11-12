import assert from "node:assert";
import {
  parsearGacetaVenezuelaNativo,
  parsearEjemplaresVenezuela,
} from "@/features/gaceta/lib/segmentar";

console.log("=== PRUEBAS MOTOR DETERMINÍSTICO VENEZUELA (LA RINCONADA / VALENCIA) ===");

// 1. Programa oficial completo de La Rinconada con 10 carreras
{
  const textoRinconada = `
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

  const res = parsearGacetaVenezuelaNativo(textoRinconada);
  console.log(`Carreras extraídas determinísticamente: ${res.carreras.length}`);
  assert.strictEqual(res.carreras.length, 10, "Debe extraer las 10 carreras");
  assert.strictEqual(res.carreras[0].hipodromo, "LA RINCONADA");
  assert.strictEqual(res.carreras[0].fecha, "2026-11-08");
  assert.strictEqual(res.carreras[0].distancia, 1200);
  assert.strictEqual(res.carreras[0].carrera, 1);
  assert.strictEqual(res.carreras[0].ejemplares.length, 2);
  assert.strictEqual(res.carreras[0].ejemplares[0].nombre, "CATIRE PEDRO");
  assert.strictEqual(res.carreras[0].ejemplares[0].jinete, "R. Capriles");
  assert.strictEqual(res.carreras[0].ejemplares[0].entrenador, "R. D'Angelo");
  assert.strictEqual(res.carreras[0].ejemplares[0].peso, "54");

  assert.strictEqual(res.carreras[3].carrera, 4);
  assert.strictEqual(res.carreras[3].distancia, 1600);
  assert.strictEqual(res.carreras[3].ejemplares[0].nombre, "CANDY CUMMINGS");

  assert.strictEqual(res.carreras[9].carrera, 10);
  assert.strictEqual(res.carreras[9].ejemplares[0].nombre, "EL GRAN ROCKY");
  console.log("✔ Extracción determinística completa de La Rinconada verificada.");
}

// 2. Programa de Valencia (HINAVA)
{
  const textoValencia = `
HIPÓDROMO NACIONAL DE VALENCIA (HINAVA) - REUNIÓN N° 22
VIERNES 13/11/2026 - PROGRAMA OFICIAL

1ª CARRERA - HORA: 2:00 PM - DISTANCIA 1.200 METROS
1 GRAN POET - 54 kg - J. Lugo
2 KING JESUS - 55 kg - K. Aray

2ª CARRERA - DISTANCIA 1.300 METROS
1 MR. OLIVER - 54 kg
2 EL DE MATHIAS - 53 kg
`;

  const res = parsearGacetaVenezuelaNativo(textoValencia);
  assert.strictEqual(res.carreras.length, 2);
  assert.strictEqual(res.carreras[0].hipodromo, "VALENCIA");
  assert.strictEqual(res.carreras[0].fecha, "2026-11-13");
  assert.strictEqual(res.carreras[0].ejemplares[0].nombre, "GRAN POET");
  assert.strictEqual(res.carreras[0].ejemplares[0].jinete, "J. Lugo");
  console.log("✔ Extracción determinística de Valencia (HINAVA) verificada.");
}

// 3. Formato con PP explícito y nacionalidades
{
  const textoPP = `
5ª CARRERA - DISTANCIA 1.600 METROS
1 [PP 4] WATER CHESTNUT (VEN) 53 kg - F. Quevedo - R. Lanz
2 (PP 5) WHITE ABARRIO (USA) 55 kg - J. Lugo - R. Cartolano
`;

  const res = parsearEjemplaresVenezuela(textoPP);
  assert.strictEqual(res.length, 2);
  assert.strictEqual(res[0].numero, "1");
  assert.strictEqual(res[0].pp, 4);
  assert.strictEqual(res[0].nombre, "WATER CHESTNUT");
  assert.strictEqual(res[0].jinete, "F. Quevedo");
  assert.strictEqual(res[0].entrenador, "R. Lanz");
  assert.strictEqual(res[1].numero, "2");
  assert.strictEqual(res[1].pp, 5);
  assert.strictEqual(res[1].nombre, "WHITE ABARRIO");
  console.log("✔ Formato con PP y nacionalidades verificado.");
}

console.log("\n🎉 TODAS LAS PRUEBAS DETERMINÍSTICAS DE VENEZUELA PASARON CON ÉXITO.");
