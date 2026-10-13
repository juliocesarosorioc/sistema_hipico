// ============================================================================
// PUESTOS POR BLOQUES — COMBINADA dentro de COMPUESTA ("1P Y 1Y2N").
//
// Protege el desglose por BLOQUES de las jugadas compuestas:
//   · bloque 1: 1P
//   · bloque 2: 1Y2N — que son DOS jugadas: 1P y 2N (50/50 dentro del bloque)
//
// Caso reportado: "1P Y 1Y2N" con caballo "1 · 1" caía en "Retirado"/EMPATA
// porque el motor trataba el bloque anidado "1Y2N" como un simple "2P puro".
// Ahora cada bloque (y cada sub-jugada del bloque anidado) se estima por
// separado y se expone en `ResultadoMotor.bloquesDetalle`.
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import { liquidarPuestos } from "../src/lib/motores/puestos";
import { mensajePreliminarDeCarrera } from "../src/lib/taquilla/mensajeResultado";
import type { TicketMotor } from "../src/lib/bettingEngine";
import type { PizarraCarrera } from "../src/lib/liquidacion";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => { pasan++; console.log(`  ok   ${m}`); };
const mal = (m: string, d?: string) => { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };
const si = (c: boolean, m: string, d?: string) => (c ? ok(m) : mal(m, d));

/** Pizarra donde el ejemplar `eje` llega en el puesto `puesto` (1-5). */
function pizarraDe(eje: string, puesto: number): PizarraCarrera {
  const campos = ["primero", "segundo", "tercero", "cuarto", "quinto", "sexto", "septimo", "octavo"] as const;
  const objetivo: PizarraCarrera = { primero: "" };
  const resto = ["1", "2", "3", "4", "5", "6", "7", "8"].filter((n) => n !== eje);
  campos.forEach((campo, i) => {
    objetivo[campo] = i + 1 === puesto ? eje : (resto.shift() ?? "");
  });
  return objetivo;
}

function ticket(jugada: string, caballo: string, monto: number, pizarra: PizarraCarrera): TicketMotor {
  return {
    hipodromo: "LA RINCONADA",
    carrera: "5",
    caballo,
    fechas: [],
    id: "t-" + jugada,
    cruces: 1,
    cuota: null,
    total: monto,
    addedAt: 0,
    tipo_jugada: jugada,
    monto,
    puesto_final: 1,
    pizarra,
    dividendos: null,
  };
}

const JUEGAN = (caballo: string, piz: PizarraCarrera) => ticket("1P Y 1Y2N", caballo, 1000, piz);

// ── 1. "1P Y 1Y2N" · caballo "1 · 1" · el 1 llega 1º → TODOS ganan ──
{
  const res = liquidarPuestos(JUEGAN("1 · 1", pizarraDe("1", 1)), 5);
  si(res.ok, "1P Y 1Y2N (1·1) con el 1 en 1º → GANA");
  si(Math.abs((res.totalClienteNeto ?? 0) - 1950) < 0.01, `paga 2×monto − 5% = 1.950 (dio ${res.totalClienteNeto})`);
  si(!!res.bloquesDetalle && res.bloquesDetalle.length === 2, "desglosa 2 BLOQUES (1P y 1Y2N)");
  const [b1, b2] = res.bloquesDetalle ?? [];
  si(b1?.fuente === "1p" && b1?.estado === "GANA", "bloque 1 · 1P → GANA");
  si(b2?.fuente === "1y2n" && b2?.estado === "GANA", "bloque 2 · 1Y2N → GANA");
  si(b2?.bloques?.length === 2, "bloque 2 desglosa sus DOS jugadas (1P y 2N)");
  si(b2?.bloques?.[0]?.estado === "GANA" && b2.bloques[0].fuente === "1p", "bloque 2 · 1P → GANA");
  si(b2?.bloques?.[1]?.estado === "GANA" && b2.bloques[1].fuente === "2n", "bloque 2 · 2N → GANA");
}

// ── 2. "1P Y 1Y2N" · el 1 llega 2º → BLOQUE 1 PIERDE, BLOQUE 2: 1P PIERDE + 2N ANULADA ──
{
  const res = liquidarPuestos(JUEGAN("1 · 1", pizarraDe("1", 2)), 5);
  si(!res.ok, "1P Y 1Y2N (1·1) con el 1 en 2º → NO gana (antes caía en Retirado/EMPATA)");
  si(Math.abs((res.totalClienteNeto ?? 0) - 250) < 0.01, `devuelve solo la parte ANULADA del 2N = 250 (dio ${res.totalClienteNeto})`);
  const [b1, b2] = res.bloquesDetalle ?? [];
  si(b1?.estado === "PIERDE", "bloque 1 · 1P → PIERDE (el 1 no llega 1º)");
  si(b2?.estado === "PIERDE", "bloque 2 · 1Y2N → PIERDE (no gana la combinación)");
  si(b2?.bloques?.[0]?.estado === "PIERDE", "bloque 2 · 1P → PIERDE");
  si(b2?.bloques?.[1]?.estado === "ANULADA", "bloque 2 · 2N → ANULADA (empata justo en el puesto N, devuelve su parte)");
}

// ── 3. "1P Y 1Y2N" · el 1 llega 3º → todo pierde, nada que devolver ──
{
  const res = liquidarPuestos(JUEGAN("1 · 1", pizarraDe("1", 3)), 5);
  si(!res.ok && res.totalClienteNeto === 0, "1P Y 1Y2N (1·1) con el 1 en 3º → PIERDE, sin devolución");
  si((res.bloquesDetalle?.every((b) => b.estado === "PIERDE") ?? false), "ambos bloques PIERDE");
}

// ── 4. REGRESIÓN: COMBINADA raíz "1Y2N" (sin COMPUESTA) sigue igual ──
{
  const res = liquidarPuestos(ticket("1Y2N", "1", 1000, pizarraDe("1", 1)), 5);
  si(res.ok && Math.abs((res.totalClienteNeto ?? 0) - 1950) < 0.01, "1Y2N al 1 con el 1 en 1º → GANA 1.950 (sin regresión)");
}
{
  // 2N termina justo en el puesto N → devuelve su parte (la mitad del monto).
  const res = liquidarPuestos(ticket("1Y2N", "1", 1000, pizarraDe("1", 2)), 5);
  si(!res.ok && Math.abs((res.totalClienteNeto ?? 0) - 500) < 0.01, `1Y2N al 1 con el 1 en 2º → 1P pierde + 2N ANULADA = devuelve 500 (dio ${res.totalClienteNeto})`);
}

// ── 5. REGRESIÓN: "1P Y 2P" (bloques hoja, sin anidar) mantiene la regla EMPATA ──
{
  const res = liquidarPuestos(ticket("1P Y 2P", "1", 1000, pizarraDe("1", 2)), 5);
  si(!res.ok, "1P Y 2P al 1 con el 1 en 2º → recupera capital pero NO gana (ok:false)");
  si(Math.abs((res.totalClienteNeto ?? 0) - 1000) < 0.01, `devuelve el capital (1P pierde + 2P gana) = 1.000 (dio ${res.totalClienteNeto})`);
}

// ── 6. Mensaje PRELIMINAR: estima cada bloque y sus resultados ──
{
  const mensaje = mensajePreliminarDeCarrera({
    hipodromo: "LA RINCONADA",
    carrera: 5,
    pizarra: pizarraDe("1", 2),
    dividendos: null,
    tickets: [{ comando: "1000 1P Y 1Y2N", monto: 1000, caballo: "1 · 1", cliente1: "AREVALO" }],
    tasaComision: 5,
  });
  si(/→ 🔁 ANULADA/.test(mensaje), "con el 1 en 2º el veredicto general es ANULADA (devuelve solo la parte del 2N, ya no un Retirado pleno)");
  si(
    mensaje.includes("BLOQUES: 1P→❌ · 1Y2N→❌ (1P→❌ · 2N→🔁)"),
    "la línea estima BLOQUE 1: 1P→❌ y BLOQUE 2: 1Y2N→❌ (1P→❌ · 2N→🔁)"
  );
}

console.log(`\n${pasan} pasan, ${fallan} fallan.`);
if (fallan > 0) process.exit(1);