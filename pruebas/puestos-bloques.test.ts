// ============================================================================
// PUESTOS, COMBINADAS, BLOQUES EN ESCALERA Y FUENTE ÚNICA DE VERDAD (SSOT)
//
// Verifica las 6 Reglas de Negocio Inquebrantables:
//   · Regla 1: Principio de Riesgo Bilateral (Prohibición de 1N y validación por N_corredores)
//   · Regla 2: Jugadas Individuales (100% del monto: 1P, 2N, 2P, 3N, 3P, 4N, 4P, 5N, 5P)
//   · Regla 3: Jugadas Combinadas (50% / 50% entre dos peldaños y todos sus sinónimos / y Y)
//   · Regla 4: Jugadas en Bloque (Escalera Estricta de Progresión 75%/25% y 25%/75% + comisión 5% única sobre neto)
//   · Regla 5: SSOT en `src/features/motores/lib/puestos.ts` y `src/features/saldos/lib/contabilidad-central.ts`
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import {
  liquidarPuestos,
  validarPuesto,
  minimoCorredoresRequeridos,
  liquidarPuesto,
  evaluarPuestoPorPosicion,
  parsearNomenclatura,
} from "../src/features/motores/lib/puestos";
import { logicaGanancias } from "../src/features/liquidacion/lib/puestos";
import { validarComando } from "../src/features/taquilla/lib/validar";
import { procesarJugadasPuestos } from "../src/features/taquilla/lib/procesarPuestos";
import { esJugadaCoherente } from "../src/features/taquilla/lib/expandirDobleSplit";
import { mensajePreliminarDeCarrera } from "../src/features/taquilla/lib/mensajeResultado";
import { armarFilasPreview } from "../src/features/gestion/lib/preview-carrera";
import { relacionResultados } from "../src/features/impresion/lib/reportGenerator";
import { calcularEstadoCuentaCliente as calcDesdeCentral } from "../src/features/saldos/lib/contabilidad-central";
import { calcularEstadoCuentaCliente as calcDesdeSaldos } from "../src/features/liquidacion/lib/saldos";
import { calcularEstadoCuentaCliente as calcDesdeReportes } from "../src/features/liquidacion/lib/reportes";
import { calcularEstadoCuentaCliente as calcDesdeReporteCarrera } from "../src/features/liquidacion/lib/reporte-carrera";
import { calcularEstadoCuentaCliente as calcDesdeImpresion } from "../src/features/impresion/lib/reportGenerator";
import type { TicketMotor } from "../src/features/betting/lib/bettingEngine";
import type { PizarraCarrera } from "../src/features/liquidacion/lib/liquidacion";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => {
  pasan++;
  console.log(`  ok   ${m}`);
};
const mal = (m: string, d?: string) => {
  fallan++;
  console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`);
};
const si = (c: boolean, m: string, d?: string) => (c ? ok(m) : mal(m, d));
const cerca = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps;

/** Pizarra donde el ejemplar `eje` llega en el puesto `puesto` (1-8). */
function pizarraDe(eje: string, puesto: number): PizarraCarrera {
  const campos = ["primero", "segundo", "tercero", "cuarto", "quinto", "sexto", "septimo", "octavo"] as const;
  const objetivo: PizarraCarrera = { primero: "" };
  const resto = ["1", "2", "3", "4", "5", "6", "7", "8"].filter((n) => n !== eje);
  campos.forEach((campo, i) => {
    objetivo[campo] = i + 1 === puesto ? eje : (resto.shift() ?? "");
  });
  return objetivo;
}

function ticket(
  jugada: string,
  caballo: string,
  monto: number,
  pizarra: PizarraCarrera,
  nCorredores?: number
): TicketMotor {
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
    n_corredores: nCorredores ?? null,
  };
}

const JUEGAN = (caballo: string, piz: PizarraCarrera) => ticket("1P Y 1Y2N", caballo, 1000, piz);

console.log("\n=== [0] DESGLOSE BASE DE BLOQUES ANIDADOS (1P Y 1Y2N) ===");
// ── 1. "1P Y 1Y2N" · caballo "1 · 1" · el 1 llega 1º → TODOS ganan ──
{
  const res = liquidarPuestos(JUEGAN("1 · 1", pizarraDe("1", 1)), 5);
  si(res.ok, "1P Y 1Y2N (1·1) con el 1 en 1º → GANA");
  si(cerca(res.totalClienteNeto ?? 0, 1950), `paga 2×monto − 5% = 1.950 (dio ${res.totalClienteNeto})`);
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
  si(!res.ok, "1P Y 1Y2N (1·1) con el 1 en 2º → NO gana");
  si(cerca(res.totalClienteNeto ?? 0, 250), `devuelve solo la parte ANULADA del 2N = 250 (dio ${res.totalClienteNeto})`);
  const [b1, b2] = res.bloquesDetalle ?? [];
  si(b1?.estado === "PIERDE", "bloque 1 · 1P → PIERDE (el 1 no llega 1º)");
  si(b2?.estado === "PIERDE", "bloque 2 · 1Y2N → PIERDE (no gana la combinación)");
  si(b2?.bloques?.[0]?.estado === "PIERDE", "bloque 2 · 1P → PIERDE");
  si(b2?.bloques?.[1]?.estado === "EMPATA" || b2?.bloques?.[1]?.estado === "ANULADA", "bloque 2 · 2N → EMPATA (empata justo en el puesto N, devuelve su parte)");
}

// ── 3. "1P Y 1Y2N" · el 1 llega 3º → todo pierde, nada que devolver ──
{
  const res = liquidarPuestos(JUEGAN("1 · 1", pizarraDe("1", 3)), 5);
  si(!res.ok && res.totalClienteNeto === 0, "1P Y 1Y2N (1·1) con el 1 en 3º → PIERDE, sin devolución");
  si(res.bloquesDetalle?.every((b) => b.estado === "PIERDE") ?? false, "ambos bloques PIERDE");
}

// ── 4. REGRESIÓN: COMBINADA raíz "1Y2N" (sin COMPUESTA) sigue igual ──
{
  const res = liquidarPuestos(ticket("1Y2N", "1", 1000, pizarraDe("1", 1)), 5);
  si(res.ok && cerca(res.totalClienteNeto ?? 0, 1950), "1Y2N al 1 con el 1 en 1º → GANA 1.950 (sin regresión)");
}
{
  const res = liquidarPuestos(ticket("1Y2N", "1", 1000, pizarraDe("1", 2)), 5);
  si(!res.ok && cerca(res.totalClienteNeto ?? 0, 500), `1Y2N al 1 con el 1 en 2º → 1P pierde + 2N ANULADA = devuelve 500 (dio ${res.totalClienteNeto})`);
}

// ── 5. REGRESIÓN: "1P Y 2P" mantiene la regla EMPATA en 2° ──
{
  const res = liquidarPuestos(ticket("1P Y 2P", "1", 1000, pizarraDe("1", 2)), 5);
  si(!res.ok, "1P Y 2P al 1 con el 1 en 2º → recupera capital pero NO gana (ok:false)");
  si(cerca(res.totalClienteNeto ?? 0, 1000), `devuelve el capital (1P pierde + 2P gana) = 1.000 (dio ${res.totalClienteNeto})`);
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
  si(/→ ❌ PIERDE/.test(mensaje), "con el 1 en 2º el veredicto general es PIERDE (pierde 75% en 1P y empata 25% en 2N)");
  si(
    mensaje.includes("BLOQUES: 1P→❌ · 1Y2N→❌ (1P→❌ · 2N→🔁)"),
    "la línea estima BLOQUE 1: 1P→❌ y BLOQUE 2: 1Y2N→❌ (1P→❌ · 2N→🔁)"
  );

  // Y para una jugada COMBINADA ("2 jugadas en 1", ej. 2Y3N con el 7 en 3°):
  // NO se etiqueta como BLOQUES sino como COMBINADA (2 en 1): 2P→❌ · 3N→🔁
  const msgCombinada = mensajePreliminarDeCarrera({
    hipodromo: "KEENELAND",
    carrera: 4,
    pizarra: pizarraDe("7", 3),
    dividendos: null,
    tickets: [{ comando: "30 2Y3N", monto: 30, caballo: "7", cliente1: "Sam", cliente2: "Newcastle" }],
    tasaComision: 5,
  });
  si(/→ ❌ PIERDE/.test(msgCombinada), "2Y3N (7) en 3° → veredicto PIERDE (pierde mitad 2P, empata mitad 3N)");
  si(
    msgCombinada.includes("COMBINADA (2 en 1): 2P→❌ · 3N→🔁") && !msgCombinada.includes("BLOQUES:"),
    "2Y3N se desglosa como 'COMBINADA (2 en 1): 2P→❌ · 3N→🔁' y NO como jugada de bloques"
  );
}

// ============================================================================
// CASO 1 (REGLA 1): PROHIBICIÓN ABSOLUTA DE `1N` (PRIMER NINI)
// ============================================================================
console.log("\n=== [CASO 1] REGLA 1: Eliminación absoluta de '1N' en todas las modalidades ===");
for (const prohibida of ["1n", "1N", "1p y 1n", "1P Y 1N", "1/1n", "1/1N", "1y1n", "1Y1N", "1n/2n", "1n y 2n"]) {
  si(parsearNomenclatura(prohibida) === null, `parsearNomenclatura('${prohibida}') rechaza con null`);
  si(!validarPuesto(prohibida, 8).ok, `validarPuesto('${prohibida}', 8) rechaza como inválida`);
  si(!validarComando(`100 ${prohibida}`, 5, "1").ok, `validarComando('100 ${prohibida}') rechaza en preventa`);
  si(!esJugadaCoherente(prohibida), `esJugadaCoherente('${prohibida}') rechaza en carga rápida`);
}

// ============================================================================
// CASO 2 (REGLA 1): VALIDACIÓN DINÁMICA SEGÚN `N_corredores` (RIESGO BILATERAL)
// ============================================================================
console.log("\n=== [CASO 2] REGLA 1: Validación de Riesgo Bilateral según N_corredores ===");
{
  // Con N_corredores = 2: solo 1P es válida; 2N, 2P, 1/2N, 2/2N son INVÁLIDAS
  si(validarPuesto("1p", 2).ok, "Con N=2: '1p' es VÁLIDA (Banquero gana si llega 2°)");
  for (const inv2 of ["2n", "2p", "1/2n", "2/2n", "1y2n", "2y2n", "1p y 1/2n", "2n y 2/2n"]) {
    si(!validarPuesto(inv2, 2).ok, `Con N=2: '${inv2}' es INVÁLIDA por falta de riesgo para el Banquero`);
    si(!validarComando(`100 ${inv2}`, 5, "1", 2).ok, `validarComando('100 ${inv2}', N=2) bloquea en preventa`);
    // Y si hubo retiros posteriores al momento de liquidar con N=2 -> se anula devolviendo el capital (balanceBanca=0)
    const liqRetiros = liquidarPuestos(ticket(inv2, "1", 100, pizarraDe("1", 1), 2), 5);
    si(
      !liqRetiros.ok && liqRetiros.totalClienteNeto === 100 && liqRetiros.balanceBanca === 0,
      `Liquidación con retiros posteriores (N=2) anula '${inv2}' devolviendo capital $100`
    );
  }

  // Con N_corredores = 3: 1p, 2n, 2p, 1/2n, 2/2n, 1/2, bloques de nivel 1->2 son VÁLIDAS; 3n, 3p, 2/3n son INVÁLIDAS
  for (const val3 of ["1p", "2n", "2p", "1/2n", "2/2n", "1/2", "1p y 1/2n", "1/2n y 2n", "2n y 2/2n", "2/2n y 2p"]) {
    si(validarPuesto(val3, 3).ok, `Con N=3: '${val3}' es VÁLIDA (minReq=${minimoCorredoresRequeridos(val3)})`);
  }
  for (const inv3 of ["3n", "3p", "2/3n", "3/3n", "2p y 2/3n", "3n y 3/3n"]) {
    si(!validarPuesto(inv3, 3).ok, `Con N=3: '${inv3}' es INVÁLIDA (requiere N>=4)`);
  }

  // Con N_corredores = 4: 3n, 3p, 2/3n, 3/3n son VÁLIDAS; 4n, 4p, 3/4n son INVÁLIDAS
  for (const val4 of ["3n", "3p", "2/3n", "3/3n", "2/3", "2p y 2/3n", "2/3n y 3n", "3n y 3/3n", "3/3n y 3p"]) {
    si(validarPuesto(val4, 4).ok, `Con N=4: '${val4}' es VÁLIDA`);
  }
  for (const inv4 of ["4n", "4p", "3/4n", "4/4n", "3p y 3/4n"]) {
    si(!validarPuesto(inv4, 4).ok, `Con N=4: '${inv4}' es INVÁLIDA (requiere N>=5)`);
  }

  // Con N_corredores = 5: 4n, 4p, 3/4n, 4/4n son VÁLIDAS; 5n, 5p, 4/5n son INVÁLIDAS
  for (const val5 of ["4n", "4p", "3/4n", "4/4n", "3/4", "3p y 3/4n", "3/4n y 4n", "4n y 4/4n", "4/4n y 4p"]) {
    si(validarPuesto(val5, 5).ok, `Con N=5: '${val5}' es VÁLIDA`);
  }
  for (const inv5 of ["5n", "5p", "4/5n", "5/5n"]) {
    si(!validarPuesto(inv5, 5).ok, `Con N=5: '${inv5}' es INVÁLIDA (requiere N>=6)`);
  }
}

// ============================================================================
// CASO 3 (REGLAS 2 Y 3): JUGADAS INDIVIDUALES (100%) Y COMBINADAS (50% / 50%)
// ============================================================================
console.log("\n=== [CASO 3] REGLA 3: Liquidación de Combinadas 50%/50% y Sinónimos ===");
{
  // 1) 1/2N (sinónimos: 1/2N, 1Y2N, 1P Y 2N, 1P/2N) con monto 100
  for (const syn of ["1/2N", "1Y2N", "1P Y 2N", "1P/2N"]) {
    const pos1 = liquidarPuesto(syn, 1, 100);
    const pos2 = liquidarPuesto(syn, 2, 100);
    const pos3 = liquidarPuesto(syn, 3, 100);
    si(
      cerca(pos1.netoJugadorBruto, 100) && cerca(pos1.netoJugador, 95) && cerca(pos1.comision, 5),
      `${syn} (monto 100) llega 1° -> Jugador gana +100 bruto (+95 neto tras 5%)`
    );
    si(
      cerca(pos2.netoJugadorBruto, -50) && cerca(pos2.netoJugador, -50) && cerca(pos2.banker, 50),
      `${syn} (monto 100) llega 2° -> Banquero gana +50 bruto (Jugador pierde -50)`
    );
    si(
      cerca(pos3.netoJugadorBruto, -100) && cerca(pos3.netoJugador, -100) && cerca(pos3.banker, 100),
      `${syn} (monto 100) llega 3° -> Banquero gana +100 bruto (Jugador pierde -100)`
    );
  }

  // 2) 2/2N (sinónimos: 2/2N, 2Y2N, 2N/2P, 2P/2N, 2N Y 2P, 2P Y 2N) con monto 100
  for (const syn of ["2/2N", "2Y2N", "2N/2P", "2P/2N", "2N Y 2P", "2P Y 2N"]) {
    const pos1 = liquidarPuesto(syn, 1, 100);
    const pos2 = liquidarPuesto(syn, 2, 100);
    const pos3 = liquidarPuesto(syn, 3, 100);
    si(
      cerca(pos1.netoJugadorBruto, 100) && cerca(pos1.netoJugador, 95),
      `${syn} (monto 100) llega 1° -> Jugador gana +100 bruto (+95 neto)`
    );
    si(
      cerca(pos2.netoJugadorBruto, 50) && cerca(pos2.netoJugador, 47.5) && cerca(pos2.comision, 2.5),
      `${syn} (monto 100) llega 2° -> Jugador gana +50 bruto (+47.50 neto tras 5% sobre 50)`
    );
    si(
      cerca(pos3.netoJugadorBruto, -100) && cerca(pos3.banker, 100),
      `${syn} (monto 100) llega 3° -> Banquero gana +100 bruto (Jugador pierde -100)`
    );
  }

  // 3) 1/2 o 1/2P (sinónimos: 1/2, 1/2P, 1Y2, 1Y2P, 1P Y 2P) con monto 100
  for (const syn of ["1/2", "1/2P", "1Y2", "1Y2P", "1P Y 2P"]) {
    const pos1 = liquidarPuesto(syn, 1, 100);
    const pos2 = liquidarPuesto(syn, 2, 100);
    const pos3 = liquidarPuesto(syn, 3, 100);
    si(cerca(pos1.netoJugador, 95), `${syn} llega 1° -> +95 neto`);
    si(cerca(pos2.netoJugadorBruto, 0) && pos2.draw === true && cerca(pos2.comision, 0), `${syn} llega 2° -> neteo 0% sin comisión`);
    si(cerca(pos3.netoJugadorBruto, -100), `${syn} llega 3° -> -100`);
  }

  // 4) Nivel 2->3 (2/3N, 3/3N, 2/3P), Nivel 3->4 (3/4N, 4/4N, 3/4P), Nivel 4->5 (4/5N, 5/5N, 4/5P)
  si(cerca(liquidarPuesto("2/3N", 2, 100).netoJugador, 95), "2/3N llega 2° -> +95 neto");
  si(cerca(liquidarPuesto("2/3N", 3, 100).netoJugadorBruto, -50), "2/3N llega 3° -> Banquero gana 50% (-50)");
  si(cerca(liquidarPuesto("3/3N", 3, 100).netoJugador, 47.5), "3/3N llega 3° -> Jugador gana 50% (+47.50 neto)");
  si(cerca(liquidarPuesto("2/3P", 3, 100).netoJugadorBruto, 0), "2/3P llega 3° -> Se netean ambas mitades (0)");

  si(cerca(liquidarPuesto("3/4N", 3, 100).netoJugador, 95), "3/4N llega 3° -> +95 neto");
  si(cerca(liquidarPuesto("3/4N", 4, 100).netoJugadorBruto, -50), "3/4N llega 4° -> Banquero gana 50% (-50)");
  si(cerca(liquidarPuesto("4/4N", 4, 100).netoJugador, 47.5), "4/4N llega 4° -> Jugador gana 50% (+47.50 neto)");
  si(cerca(liquidarPuesto("3/4P", 4, 100).netoJugadorBruto, 0), "3/4P llega 4° -> Se netean ambas mitades (0)");

  si(cerca(liquidarPuesto("4/5N", 4, 100).netoJugador, 95), "4/5N llega 4° -> +95 neto");
  si(cerca(liquidarPuesto("4/5N", 5, 100).netoJugadorBruto, -50), "4/5N llega 5° -> Banquero gana 50% (-50)");
  si(cerca(liquidarPuesto("5/5N", 5, 100).netoJugador, 47.5), "5/5N llega 5° -> Jugador gana 50% (+47.50 neto)");
  si(cerca(liquidarPuesto("4/5P", 5, 100).netoJugadorBruto, 0), "4/5P llega 5° -> Se netean ambas mitades (0)");
}

// ============================================================================
// CASO 4 (REGLA 4): JUGADAS EN BLOQUE (ESCALERA ESTRICTA 75/25 Y 25/75 + COMISIÓN ÚNICA)
// ============================================================================
console.log("\n=== [CASO 4] REGLA 4: Bloques en Escalera (75%/25% y 25%/75%) y Comisión sobre Neto ===");
{
  // Nivel 1 a 2 (posición crítica = 2°)
  // 1) 1P Y 1/2N (75% en 1P + 25% en 2N)
  for (const syn of ["1P Y 1/2N", "1P Y 1Y2N", "1PY1Y2N"]) {
    const p1 = liquidarPuesto(syn, 1, 100);
    const p2 = liquidarPuesto(syn, 2, 100);
    const p3 = liquidarPuesto(syn, 3, 100);
    si(cerca(p1.netoJugadorBruto, 100) && cerca(p1.netoJugador, 95), `${syn} (100) llega 1° -> +100 bruto (+95 neto)`);
    si(
      cerca(p2.netoJugadorBruto, -75) && cerca(p2.banker, 75) && cerca(p2.comision, 0),
      `${syn} (100) llega 2° -> Banquero gana +75 bruto (Jugador pierde -75)`
    );
    si(cerca(p3.netoJugadorBruto, -100) && cerca(p3.banker, 100), `${syn} (100) llega 3° -> Banquero gana +100`);
  }

  // 2) 1/2N Y 2N (25% en 1P + 75% en 2N)
  for (const syn of ["1/2N Y 2N", "1Y2N Y 2N", "1Y2NY2N"]) {
    const p1 = liquidarPuesto(syn, 1, 100);
    const p2 = liquidarPuesto(syn, 2, 100);
    const p3 = liquidarPuesto(syn, 3, 100);
    si(cerca(p1.netoJugadorBruto, 100) && cerca(p1.netoJugador, 95), `${syn} (100) llega 1° -> +100 bruto (+95 neto)`);
    si(
      cerca(p2.netoJugadorBruto, -25) && cerca(p2.banker, 25) && cerca(p2.comision, 0),
      `${syn} (100) llega 2° -> Banquero gana +25 bruto (Jugador pierde -25)`
    );
    si(cerca(p3.netoJugadorBruto, -100) && cerca(p3.banker, 100), `${syn} (100) llega 3° -> Banquero gana +100`);
  }

  // 3) 2N Y 2/2N (75% en 2N + 25% en 2P)
  for (const syn of ["2N Y 2/2N", "2N Y 2Y2N", "2NY2Y2N"]) {
    const p1 = liquidarPuesto(syn, 1, 100);
    const p2 = liquidarPuesto(syn, 2, 100);
    const p3 = liquidarPuesto(syn, 3, 100);
    si(cerca(p1.netoJugadorBruto, 100) && cerca(p1.netoJugador, 95), `${syn} (100) llega 1° -> +100 bruto (+95 neto)`);
    si(
      cerca(p2.netoJugadorBruto, 25) && cerca(p2.netoJugador, 23.75) && cerca(p2.comision, 1.25),
      `${syn} (100) llega 2° -> Jugador gana +25 bruto (+23.75 neto tras 5% sobre 25)`
    );
    si(cerca(p3.netoJugadorBruto, -100) && cerca(p3.banker, 100), `${syn} (100) llega 3° -> Banquero gana +100`);
  }

  // 4) 2/2N Y 2P (25% en 2N + 75% en 2P)
  for (const syn of ["2/2N Y 2P", "2Y2N Y 2P", "2Y2NY2P"]) {
    const p1 = liquidarPuesto(syn, 1, 100);
    const p2 = liquidarPuesto(syn, 2, 100);
    const p3 = liquidarPuesto(syn, 3, 100);
    si(cerca(p1.netoJugadorBruto, 100) && cerca(p1.netoJugador, 95), `${syn} (100) llega 1° -> +100 bruto (+95 neto)`);
    si(
      cerca(p2.netoJugadorBruto, 75) && cerca(p2.netoJugador, 71.25) && cerca(p2.comision, 3.75),
      `${syn} (100) llega 2° -> Jugador gana +75 bruto (+71.25 neto tras 5% sobre 75)`
    );
    si(cerca(p3.netoJugadorBruto, -100) && cerca(p3.banker, 100), `${syn} (100) llega 3° -> Banquero gana +100`);
  }

  // Nivel 2 a 3 (posición crítica = 3°)
  si(cerca(liquidarPuesto("2P Y 2/3N", 3, 100).netoJugadorBruto, -75), "2P Y 2/3N llega 3° -> Banquero gana 75% (-75)");
  si(cerca(liquidarPuesto("2/3N Y 3N", 3, 100).netoJugadorBruto, -25), "2/3N Y 3N llega 3° -> Banquero gana 25% (-25)");
  si(cerca(liquidarPuesto("3N Y 3/3N", 3, 100).netoJugador, 23.75), "3N Y 3/3N llega 3° -> Jugador gana 25% (+23.75 neto)");
  si(cerca(liquidarPuesto("3/3N Y 3P", 3, 100).netoJugador, 71.25), "3/3N Y 3P llega 3° -> Jugador gana 75% (+71.25 neto)");

  // Nivel 3 a 4 (posición crítica = 4°)
  si(cerca(liquidarPuesto("3P Y 3/4N", 4, 100).netoJugadorBruto, -75), "3P Y 3/4N llega 4° -> Banquero gana 75% (-75)");
  si(cerca(liquidarPuesto("3/4N Y 4N", 4, 100).netoJugadorBruto, -25), "3/4N Y 4N llega 4° -> Banquero gana 25% (-25)");
  si(cerca(liquidarPuesto("4N Y 4/4N", 4, 100).netoJugador, 23.75), "4N Y 4/4N llega 4° -> Jugador gana 25% (+23.75 neto)");
  si(cerca(liquidarPuesto("4/4N Y 4P", 4, 100).netoJugador, 71.25), "4/4N Y 4P llega 4° -> Jugador gana 75% (+71.25 neto)");

  // Nivel 4 a 5 (posición crítica = 5°)
  si(cerca(liquidarPuesto("4P Y 4/5N", 5, 100).netoJugadorBruto, -75), "4P Y 4/5N llega 5° -> Banquero gana 75% (-75)");
  si(cerca(liquidarPuesto("4/5N Y 5N", 5, 100).netoJugadorBruto, -25), "4/5N Y 5N llega 5° -> Banquero gana 25% (-25)");
  si(cerca(liquidarPuesto("5N Y 5/5N", 5, 100).netoJugador, 23.75), "5N Y 5/5N llega 5° -> Jugador gana 25% (+23.75 neto)");
  si(cerca(liquidarPuesto("5/5N Y 5P", 5, 100).netoJugador, 71.25), "5/5N Y 5P llega 5° -> Jugador gana 75% (+71.25 neto)");

  // Verificación en `logicaGanancias` y `procesarJugadasPuestos` (coherencia con TABLA_JUGADAS de cruces-y-tapas)
  const lg1 = logicaGanancias({ jugada: "1P Y 1/2N", caballo: "1", monto: 100, pizarra: ["2", "1", "3", "4"] });
  si(cerca(lg1.netoJugador1, -75) && cerca(lg1.netoJugador2, 71.25), "logicaGanancias('1P Y 1/2N', llega 2°) -> J1=-75, J2=+71.25");
  const lg2 = logicaGanancias({ jugada: "2/2N Y 2P", caballo: "1", monto: 100, pizarra: ["2", "1", "3", "4"] });
  si(cerca(lg2.netoJugador1, 71.25) && cerca(lg2.netoJugador2, -75), "logicaGanancias('2/2N Y 2P', llega 2°) -> J1=+71.25, J2=-75");

  const proc = procesarJugadasPuestos("1P Y 1/2N", 100);
  si(cerca(proc["1p"] ?? 0, 75) && cerca(proc["2n"] ?? 0, 25), "procesarJugadasPuestos('1P Y 1/2N', 100) -> 75 en 1p y 25 en 2n");
  const proc23 = procesarJugadasPuestos("2P Y 2/3N", 100);
  si(cerca(proc23["2p"] ?? 0, 75) && cerca(proc23["3n"] ?? 0, 25), "procesarJugadasPuestos('2P Y 2/3N', 100) -> 75% en 2p y 25% en 3n");
  const proc23Short = procesarJugadasPuestos("2P Y 2/3", 100);
  si(cerca(proc23Short["2p"] ?? 0, 75) && cerca(proc23Short["3n"] ?? 0, 25), "procesarJugadasPuestos('2P Y 2/3', 100) -> 75% en 2p y 25% en 3n");
  const proc23Inv = procesarJugadasPuestos("2/3N Y 3N", 100);
  si(cerca(proc23Inv["2p"] ?? 0, 25) && cerca(proc23Inv["3n"] ?? 0, 75), "procesarJugadasPuestos('2/3N Y 3N', 100) -> 25% en 2p y 75% en 3n");
  const proc33A = procesarJugadasPuestos("3N Y 3/3N", 100);
  si(cerca(proc33A["3n"] ?? 0, 75) && cerca(proc33A["3p"] ?? 0, 25), "procesarJugadasPuestos('3N Y 3/3N', 100) -> 75% en 3n y 25% en 3p");
  const proc33B = procesarJugadasPuestos("3/3N Y 3P", 100);
  si(cerca(proc33B["3n"] ?? 0, 25) && cerca(proc33B["3p"] ?? 0, 75), "procesarJugadasPuestos('3/3N Y 3P', 100) -> 25% en 3n y 75% en 3p");

  // Verificación end-to-end en Preview de Carrera y Relación de Resultados (WhatsApp) para Combinadas (50/50) y Bloques (75/25 · 25/75)
  const filasPrev = armarFilasPreview(
    [
      {
        id: "comb-2y3n",
        nombre_jugada: "2Y3N",
        caballo: "7",
        monto_jugado: 30,
        premio_pagar: 15,
        comision_porcentaje: 5,
        estado: "Perdedor",
        cliente_juega_nombre: "Sam",
        cliente_consigue_nombre: "Newcastle",
      },
      {
        id: "bloq-75-25",
        nombre_jugada: "2P Y 2/3N",
        caballo: "7",
        monto_jugado: 100,
        premio_pagar: 25,
        comision_porcentaje: 5,
        estado: "Perdedor",
        cliente_juega_nombre: "Sam",
        cliente_consigue_nombre: "Newcastle",
      },
      {
        id: "bloq-25-75",
        nombre_jugada: "2/3N Y 3N",
        caballo: "7",
        monto_jugado: 100,
        premio_pagar: 75,
        comision_porcentaje: 5,
        estado: "Perdedor",
        cliente_juega_nombre: "Sam",
        cliente_consigue_nombre: "Newcastle",
      },
    ],
    [],
    ["1", "10", "7", "4"]
  );
  si(
    filasPrev[0].lado1.monto === 15 && filasPrev[0].lado2.monto === 14.25,
    "Preview Combinada 2Y3N (30) en 3°: Sam pierde 50% (-15) y Newcastle gana 50% menos 5% (+14.25)"
  );
  si(
    filasPrev[1].lado1.monto === 75 && filasPrev[1].lado2.monto === 71.25,
    "Preview Bloque 2P Y 2/3N (100) en 3°: Sam pierde 75% (-75) y Newcastle gana 75% menos 5% (+71.25)"
  );
  si(
    filasPrev[2].lado1.monto === 25 && filasPrev[2].lado2.monto === 23.75,
    "Preview Bloque 2/3N Y 3N (100) en 3°: Sam pierde 25% (-25) y Newcastle gana 25% menos 5% (+23.75)"
  );

  const relBloques = relacionResultados(
    {
      grupo: "TERCIOS",
      fecha: new Date("2026-10-30T12:00:00Z"),
      hipodromo: "KEENELAND",
      carrera: 4,
      pizarra: "1 - 10 - 7 - 4",
      pizarraPuestos: ["1", "10", "7", "4"],
    },
    [
      {
        clienteJuega: "Sam",
        jugada: "2P Y 2/3N",
        caballo: "7",
        monto: 100,
        clienteConsigue: "Newcastle",
        modalidad: "GENERICA",
        comisionPct: 5,
      },
      {
        clienteJuega: "Luis",
        jugada: "2/3N Y 3N",
        caballo: "7",
        monto: 100,
        clienteConsigue: "Carlos",
        modalidad: "GENERICA",
        comisionPct: 5,
      },
      {
        clienteJuega: "Pedro",
        jugada: "3N Y 3/3N",
        caballo: "7",
        monto: 100,
        clienteConsigue: "Miguel",
        modalidad: "GENERICA",
        comisionPct: 5,
      },
      {
        clienteJuega: "Ana",
        jugada: "3/3N Y 3P",
        caballo: "7",
        monto: 100,
        clienteConsigue: "Sofia",
        modalidad: "GENERICA",
        comisionPct: 5,
      },
    ]
  );
  si(
    relBloques.includes("Juega Sam $ -75,00") && relBloques.includes("Da Newcastle $ +71,25"),
    "Relación WhatsApp Bloque '2P Y 2/3N' (100) en 3°: Sam -75,00 / Newcastle +71,25"
  );
  si(
    relBloques.includes("Juega Luis $ -25,00") && relBloques.includes("Da Carlos $ +23,75"),
    "Relación WhatsApp Bloque '2/3N Y 3N' (100) en 3°: Luis -25,00 / Carlos +23,75"
  );
  si(
    relBloques.includes("Juega Pedro $ +23,75") && relBloques.includes("Da Miguel $ -25,00"),
    "Relación WhatsApp Bloque '3N Y 3/3N' (100) en 3°: Pedro +23,75 / Miguel -25,00"
  );
  si(
    relBloques.includes("Juega Ana $ +71,25") && relBloques.includes("Da Sofia $ -75,00"),
    "Relación WhatsApp Bloque '3/3N Y 3P' (100) en 3°: Ana +71,25 / Sofia -75,00"
  );

  // Saltos de peldaño prohibidos en bloques (Regla 4.2)
  for (const saltoInvalido of ["1P Y 2/2N", "1P Y 3N", "2N Y 3P", "1/2N Y 2P", "2N Y 2/3N", "1P Y 3/4N"]) {
    si(!validarPuesto(saltoInvalido, 8).ok, `Salto de escalera '${saltoInvalido}' es RECHAZADO por validarPuesto`);
    si(parsearNomenclatura(saltoInvalido) === null, `Salto de escalera '${saltoInvalido}' es RECHAZADO por parsearNomenclatura`);
  }
}

// ============================================================================
// CASO 5 (REGLA 5): UNIFICACIÓN DE SALDO (SSOT `contabilidad-central.ts`)
// ============================================================================
console.log("\n=== [CASO 5] REGLA 5: Unificación de Saldo en `contabilidad-central.ts` ===");
{
  const payload = {
    id: "cli-ssot-1",
    nombre: "Carlos Mendoza",
    aval: 1500,
    depositos: 500,
    retiros: 100,
    devolucionIncentivo: 25,
    movimientos: [
      {
        id: "tk-1",
        cliente_juega_nombre: "Carlos Mendoza",
        cliente_consigue_nombre: "Banca",
        jugada: "2/2N Y 2P",
        caballo: "4",
        monto_jugado: 100,
        premio_pagar: 175,
        comision_pagada: 3.75,
        estado: "GANADOR",
      },
      {
        id: "tk-2",
        cliente_juega_nombre: "Carlos Mendoza",
        cliente_consigue_nombre: "Banca",
        jugada: "1P Y 1/2N",
        caballo: "2",
        monto_jugado: 100,
        estado: "PERDEDOR",
      },
    ],
  };

  const sCentral = calcDesdeCentral(payload);
  const sSaldos = calcDesdeSaldos(payload);
  const sReportes = calcDesdeReportes(payload);
  const sRepCarrera = calcDesdeReporteCarrera(payload);
  const sImpresion = calcDesdeImpresion(payload);

  si(
    sCentral.saldoContable === sSaldos.saldoContable &&
      sCentral.saldoContable === sReportes.saldoContable &&
      sCentral.saldoContable === sRepCarrera.saldoContable &&
      sCentral.saldoContable === sImpresion.saldoContable &&
      sCentral.disponibleParaJugar === sSaldos.disponibleParaJugar,
    `Todos los módulos reportan exactamente el mismo saldoContable (${sCentral.saldoContable}) y disponibleParaJugar (${sCentral.disponibleParaJugar}) desde contabilidad-central.ts`
  );
}

console.log(`\n${pasan} pasan, ${fallan} fallan.`);
if (fallan > 0) process.exit(1);
