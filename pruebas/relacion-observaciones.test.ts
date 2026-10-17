// ============================================================================
// RELACIÓN DE RESULTADOS — saldo ajustado (*negrita* / S/S) + observaciones.
//
// Protege el contrato NUEVO de `mensajeResultadoDeCarrera` / `relacionResultados`:
//   · `saldos` (disponible por cliente) anota cada jugada con el saldo de quien
//     financia en *negrita* de WhatsApp; con disponible 0 escribe `*S/S*`.
//   · al pie: «S/S = Sin saldo» + «⚠️ Sin saldo disponible: <nombres>».
//   · `observaciones` se anexa al pie.
//   · SIN `saldos`/`observaciones` el texto es idéntico al de siempre.
//
// Corre con:  node pruebas/correr.cjs   (o npx tsx pruebas/relacion-observaciones.test.ts)
// ============================================================================
import { mensajeResultadoDeCarrera } from "../src/features/taquilla/lib/mensajeResultado";
import type { PizarraCarrera } from "../src/features/liquidacion/lib/liquidacion";

let pasan = 0;
let fallan = 0;
const ok = (m: string, c: boolean, d?: string) => {
  if (c) {
    pasan++;
    console.log(`  ok   ${m}`);
  } else {
    fallan++;
    console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`);
  }
};

const pizarra: PizarraCarrera = {
  primero: "7",
  segundo: "2",
  tercero: "4",
  cuarto: "1",
  quinto: "5",
  sexto: "",
  septimo: "",
  octavo: "",
};
const dividendos: Record<string, number> = { "win:7": 12.5, "place:7": 5.4, "show:7": 3.2 };

const tickets = [
  { comando: "100 2N", monto: 100, caballo: "2", cliente1: "JUAN", cliente2: "PEDRO" },
  { comando: "150 1P", monto: 150, caballo: "7", cliente1: "LUIS", cliente2: "CARLOS" },
];

const base = mensajeResultadoDeCarrera({
  hipodromo: "LA RINCONADA",
  carrera: 5,
  fecha: "2025-10-10",
  grupo: "TERCIOS",
  pizarra,
  dividendos,
  tickets,
  tasaComision: 5,
});

// ── Sin `saldos`/`observaciones`: NO cambia nada (compatibilidad) ──
ok("sin `saldos` no se anota el disponible", !base.includes("Disp *"));
ok("sin `observaciones` no aparece el pie 📝", !base.includes("📝 Observaciones:"));
ok("la relación conserva el cierre POSITIVOS", base.includes("POSITIVOS"));
ok("la relación conserva el cierre NEGATIVOS", base.includes("NEGATIVOS"));

// ── Con `saldos`: *negrita* para el que tiene, *S/S* para el topado ──
const con = mensajeResultadoDeCarrera({
  hipodromo: "LA RINCONADA",
  carrera: 5,
  fecha: "2025-10-10",
  grupo: "TERCIOS",
  pizarra,
  dividendos,
  tickets,
  tasaComision: 5,
  saldos: { LUIS: 1000, JUAN: 0 },
  observaciones: "Cerrar caja a las 6pm",
});

ok(
  "el disponible positivo va en *negrita*",
  con.includes("· Disp *1.000,00*"),
  con.split("\n").find((l) => l.includes("Disp")) ?? "(sin línea con Disp)"
);
ok("un disponible 0 se anota como *S/S*", con.includes("· Disp *S/S*"));
ok("al pie aparece la leyenda «S/S = Sin saldo»", con.includes("S/S = Sin saldo"));
ok(
  "al pie se lista «Sin saldo disponible» con el jugador topado",
  con.includes("⚠️ Sin saldo disponible: JUAN")
);
ok(
  "las observaciones se anexan al pie",
  con.includes("📝 Observaciones:") && con.includes("Cerrar caja a las 6pm")
);
ok("el cierre POSITIVOS sigue presente con saldos", con.includes("POSITIVOS"));

console.log(`\n${pasan} ok, ${fallan} fallaron\n`);
if (fallan > 0) process.exit(1);
