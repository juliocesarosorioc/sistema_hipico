import { normalizarVenta } from "../src/features/tablas/lib/reporte-tablas-nucleo";

let pasan = 0;
let fallan = 0;
const ok = (m: string, c: boolean) => {
  if (c) {
    pasan++;
    console.log(`  ok   ${m}`);
  } else {
    fallan++;
    console.log(`  FALLA ${m}`);
  }
};

console.log("\nREPORTE — Prioridad de seudónimo en clientes y jugadas");

// 1. Resuelve seudónimo por cliente_juega_id
{
  const mapa = new Map<string, string>();
  mapa.set("uuid-123", "JUANCHO");
  mapa.set("JUAN PEREZ", "JUANCHO");

  const rowConId = {
    id: "tk-1",
    cliente_juega_id: "uuid-123",
    cliente_juega_nombre: "JUAN PEREZ",
    monto_jugado: 50,
  };

  const v1 = normalizarVenta(rowConId, mapa);
  ok("normalizarVenta usa seudónimo por cliente_juega_id", v1.jugador === "JUANCHO");

  const rowSinId = {
    id: "tk-2",
    cliente_juega_nombre: "JUAN PEREZ",
    monto_jugado: 50,
  };

  const v2 = normalizarVenta(rowSinId, mapa);
  ok("normalizarVenta usa seudónimo por coincidencia de nombre", v2.jugador === "JUANCHO");

  const rowDesconocido = {
    id: "tk-3",
    cliente_juega_nombre: "CARLOS RIVAS",
    monto_jugado: 50,
  };

  const v3 = normalizarVenta(rowDesconocido, mapa);
  ok("normalizarVenta mantiene nombre si no hay seudónimo en mapa", v3.jugador === "CARLOS RIVAS");

  const rowSinMapa = normalizarVenta(rowConId);
  ok("normalizarVenta funciona sin mapaSeudonimos (fallback a nombre)", rowSinMapa.jugador === "JUAN PEREZ");
}

console.log(`\n${pasan} pasaron, ${fallan} fallaron\n`);
if (fallan > 0) process.exit(1);
