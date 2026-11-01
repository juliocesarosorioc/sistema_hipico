import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { armarReporteCarrera } from "../src/features/liquidacion/lib/reporte-carrera";

const carreraPartner = {
  numero: 4,
  hipodromo: "BELMONT PARK",
  fecha: "2026-10-31",
  pizarra: "1 · 2 · 3",
  subtotal: 0,
  filas: [
    {
      id: "belmont-c4-j-0",
      rol: "Juega" as const,
      cliente: "PARTNER",
      jugada: "1P",
      caballo: "1",
      monto: 200,
      resultado: 190,
    },
    {
      id: "belmont-c4-j-1",
      rol: "Juega" as const,
      cliente: "PARTNER",
      jugada: "1P",
      caballo: "2",
      monto: 50,
      resultado: -50,
    },
  ],
};

const conCruces = armarReporteCarrera(
  carreraPartner,
  undefined,
  undefined,
  { comisionPct: 5 }
);
assert.equal(
  conCruces.resumen.ganan.find((fila) => fila.nombre === "PARTNER")?.monto,
  142.5,
  "Con cruces: 190 netos + 2,50 de comisión devuelta - 50 perdidos = 142,50"
);
assert.equal(
  conCruces.asientosBonoCruce?.find((fila) => fila.cliente === "PARTNER")?.bonoCruce,
  2.5,
  "El cruce compensa comisión sobre la menor entre 200 ganados y 50 perdidos"
);

const sinCruces = armarReporteCarrera(
  carreraPartner,
  undefined,
  undefined,
  { modalidadCruce: false, comisionPct: 5 }
);
assert.equal(
  sinCruces.resumen.ganan.find((fila) => fila.nombre === "PARTNER")?.monto,
  140,
  "Sin cruces se mantiene la comisión individual por ticket"
);
assert.equal(sinCruces.asientosBonoCruce?.length, 0, "Sin cruces no se acredita reembolso");

const reporteModule = fs.readFileSync(
  path.join(process.cwd(), "src/features/saldos/components/ReporteModule.tsx"),
  "utf8"
);
assert.ok(
  reporteModule.includes("bonoCrucePorCliente") &&
    reporteModule.includes("(bonoCrucePorCliente.get(cli) ?? 0)"),
  "La totalización semanal debe sumar el asiento a la cuenta del cliente"
);

console.log("4 pasaron, 0 fallaron");
