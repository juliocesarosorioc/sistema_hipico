import assert from "node:assert/strict";
import { calcularReembolsosCruce } from "../src/features/taquilla/lib/cruces-y-tapas";

const belmont = calcularReembolsosCruce(
  [{ cliente: "Partner", brutoGanado: 200, brutoPerdido: 50, comisionCobrada: 10 }],
  "con_cruces",
  5
);
const reembolso = belmont.porCliente.get("PARTNER")?.reembolsoCruce ?? 0;
assert.equal(reembolso, 2.5);
assert.equal(200 - 10 - 50 + reembolso, 142.5);

const sinComision = calcularReembolsosCruce(
  [{ cliente: "Sin comisión", brutoGanado: 200, brutoPerdido: 50, comisionCobrada: 0 }],
  "con_cruces",
  5
);
assert.equal(sinComision.totalReembolsado, 0);

console.log("3 pasaron, 0 fallaron");
