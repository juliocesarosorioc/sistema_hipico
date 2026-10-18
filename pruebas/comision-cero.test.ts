// ============================================================================
// COMISIÓN 0% — El 0 es un valor VÁLIDO (grupo/jugada SIN comisión).
//
// El error clásico era `parseFloat(v) || 2.5` (y `pct > 0 ? pct : 5`): como `0`
// es falsy, un 0% pactado se convertía en 2,5% / 5%. Estos casos blindan que:
//   · `porcentajeDeEntrada` conserva el 0 y solo cae al default si el campo
//     viene vacío/no numérico/negativo;
//   · `balanceJugada` (relación de WhatsApp) NO retiene comisión cuando el
//     ticket trae `comisionPct = 0`, y sí usa el 5% por defecto cuando falta.
// ============================================================================
import { porcentajeDeEntrada } from "../src/features/grupos/lib/grupos";
import { balanceJugada, type JugadaRelacion } from "../src/features/impresion/lib/reportGenerator";

let pasan = 0;
let fallan = 0;

function ok(nombre: string, condicion: boolean, detalle = "") {
  if (condicion) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}${detalle ? "\n         " + detalle : ""}`);
  }
}

/* ── porcentajeDeEntrada: 0 se conserva ─────────────────────────────────── */
ok('porcentajeDeEntrada("0") = 0', porcentajeDeEntrada("0") === 0);
ok("porcentajeDeEntrada(0) = 0", porcentajeDeEntrada(0) === 0);
ok('porcentajeDeEntrada("0.0") = 0', porcentajeDeEntrada("0.0") === 0);
ok('porcentajeDeEntrada(" 0 ") = 0', porcentajeDeEntrada(" 0 ") === 0);
ok('porcentajeDeEntrada("0,5") = 0,5', porcentajeDeEntrada("0,5") === 0.5);

/* ── porcentajeDeEntrada: solo el vacío/no numérico cae al default ───────── */
ok('porcentajeDeEntrada("") = 5', porcentajeDeEntrada("") === 5);
ok('porcentajeDeEntrada("   ") = 5', porcentajeDeEntrada("   ") === 5);
ok("porcentajeDeEntrada(null) = 5", porcentajeDeEntrada(null) === 5);
ok("porcentajeDeEntrada(undefined) = 5", porcentajeDeEntrada(undefined) === 5);
ok('porcentajeDeEntrada("abc") = 5', porcentajeDeEntrada("abc") === 5);
ok('porcentajeDeEntrada("5") = 5', porcentajeDeEntrada("5") === 5);
ok("porcentajeDeEntrada(-1) = 5", porcentajeDeEntrada(-1) === 5);
ok("porcentajeDeEntrada(0, 5) = 0 (default configurable)", porcentajeDeEntrada(0, 5) === 0);
ok('porcentajeDeEntrada("", 5) = 5', porcentajeDeEntrada("", 5) === 5);

/* ── balanceJugada: 0% no retiene; ausente usa 5% ───────────────────────── */
const jugada = (over: Partial<JugadaRelacion>): JugadaRelacion => ({
  clienteJuega: "A",
  jugada: "1P",
  caballo: "3",
  monto: 1000,
  ganador: true,
  premioPotencial: 2000,
  ...over,
});

const b0 = balanceJugada(jugada({ comisionPct: 0 }));
ok("0%: ganancia bruta 1000", b0.gananciaBruta === 1000);
ok("0%: comisión 0 (no cobra default)", b0.comision === 0);
ok("0%: ganancia neta 1000 (sin retención)", b0.gananciaNeta === 1000);

const b5 = balanceJugada(jugada({ comisionPct: 5 }));
ok("5%: comisión 50", b5.comision === 50);
ok("5%: ganancia neta 950", b5.gananciaNeta === 950);

const bDef = balanceJugada(jugada({}));
ok("sin comisionPct: default 5% → comisión 50", bDef.comision === 50);

const b25 = balanceJugada(jugada({ comisionPct: 2.5 }));
ok("2,5%: comisión 25", b25.comision === 25);

const bPerd = balanceJugada(jugada({ comisionPct: 0, ganador: false }));
ok("perdedor: premio bruto 0", bPerd.premioPotencial === 0);
ok("perdedor: comisión 0", bPerd.comision === 0);

console.log(`\nTODAS: ${pasan} pasaron, ${fallan} fallaron`);
if (fallan) process.exit(1);
