import assert from "node:assert/strict";
import { registrarCruceJugadores } from "../src/features/contabilidad/lib/cruces-jugadores";

async function testCruces() {
  console.log("=== PRUEBAS DE CRUCES ENTRE JUGADORES ===");

  // 1. Mismo jugador emisor y receptor
  const resMismo = await registrarCruceJugadores({
    emisorId: "1",
    emisorNombre: "CARLOS",
    receptorId: "1",
    receptorNombre: "CARLOS",
    monto: 100,
    captureSoporte: "data:image/png;base64,abc",
  });
  assert.equal(resMismo.ok, false);
  assert.match(resMismo.error || "", /misma persona/i);
  console.log("✔ Validación emisor !== receptor OK");

  // 2. Monto <= 0
  const resMonto = await registrarCruceJugadores({
    emisorId: "1",
    emisorNombre: "CARLOS",
    receptorId: "2",
    receptorNombre: "MIGUEL",
    monto: 0,
    captureSoporte: "data:image/png;base64,abc",
  });
  assert.equal(resMonto.ok, false);
  assert.match(resMonto.error || "", /mayor a \$0/i);
  console.log("✔ Validación monto > 0 OK");

  // 3. Soporte obligatorio
  const resSoporte = await registrarCruceJugadores({
    emisorId: "1",
    emisorNombre: "CARLOS",
    receptorId: "2",
    receptorNombre: "MIGUEL",
    monto: 50,
    captureSoporte: "",
  });
  assert.equal(resSoporte.ok, false);
  assert.match(resSoporte.error || "", /soporte|capture/i);
  console.log("✔ Validación soporte obligatorio OK");

  console.log("✔ TODAS LAS VALIDACIONES DE CRUCE ENTRE JUGADORES PASARON CON ÉXITO.");
}

testCruces().catch((err) => {
  console.error("Fallo en prueba:", err);
  process.exit(1);
});
