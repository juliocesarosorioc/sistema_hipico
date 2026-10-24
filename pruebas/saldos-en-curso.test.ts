// ============================================================================
// TOPE DE SALDO EN ORDEN — la carga de varias jugadas del MISMO cliente.
//
// `proyectarFila` topa cada jugada contra el saldo del cliente, pero mirando
// SOLO esa fila: con dos jugadas de 800 y un saldo de 1000, las dos se
// autorizaban completas y la segunda la rechazaba la RPC al cobrar. Este test
// protege el tope "en orden" (ver src/features/taquilla/lib/saldosEnCurso.ts).
//
// Corre con:  node pruebas/correr.cjs   (o npx tsx pruebas/saldos-en-curso.test.ts)
// ============================================================================
import {
  clienteConSaldoDescontado,
  proyectarFilasEnOrden,
  type FilaDeCarga,
} from "../src/features/taquilla/lib/saldosEnCurso";
import { proyectarFila } from "../src/features/taquilla/lib/validar";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => { pasan++; console.log(`  ok   ${m}`); };
const mal = (m: string, d?: string) => { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };
const si = (c: boolean, m: string, d?: string) => (c ? ok(m) : mal(m, d));

/** Catálogo de prueba: el cliente 1 es a quien se descuenta. */
const CATALOGO = [
  { id: "ana", nombre: "Ana", saldo_actual: 1000, aval: 0, modo_juego: "aval" },
  { id: "beto", nombre: "Beto", saldo_actual: 900, aval: 0, modo_juego: "aval" },
];
const resolver = (texto: string) => {
  const t = texto.trim().toLowerCase();
  return CATALOGO.find((c) => c.nombre.toLowerCase() === t) ?? null;
};

// ---------------------------------------------------------------------------
// 1. Dos jugadas del MISMO cliente: la segunda ve el saldo que dejó la primera
// ---------------------------------------------------------------------------
console.log("\n== Dos jugadas del mismo cliente (800 + 800 con saldo 1000) ==");
{
  const filas: FilaDeCarga[] = [
    { jugada: "2p", caballo: "3", monto: "800", cliente1: "Ana", cliente2: "" },
    { jugada: "2p", caballo: "5", monto: "800", cliente1: "Ana", cliente2: "" },
  ];
  const p = proyectarFilasEnOrden(filas, resolver);
  si(p[0].proyeccion.ok && p[0].proyeccion.monto === 800,
    "fila 1: autoriza los 800 completos", JSON.stringify(p[0].proyeccion));
  si(p[0].cliente1?.saldo_actual === 1000,
    "fila 1: ve el saldo entero (1000)", String(p[0].cliente1?.saldo_actual));
  si(p[1].cliente1?.saldo_actual === 200,
    "fila 2: ve el saldo que dejó la fila 1 (1000 − 800 = 200)", String(p[1].cliente1?.saldo_actual));
  si(p[1].proyeccion.ok && p[1].proyeccion.monto === 200,
    "fila 2: autoriza solo 200 (recortada)", JSON.stringify(p[1].proyeccion));
  si(p[1].proyeccion.ok && p[1].proyeccion.reparto?.recortado === true,
    "fila 2: queda marcada como recortada");
}

// ---------------------------------------------------------------------------
// 2. Clientes distintos: cada uno ve su propio saldo (no se mezclan)
// ---------------------------------------------------------------------------
console.log("\n== Clientes distintos: cada saldo es independiente ==");
{
  const filas: FilaDeCarga[] = [
    { jugada: "2p", caballo: "3", monto: "800", cliente1: "Ana", cliente2: "" },
    { jugada: "2p", caballo: "5", monto: "800", cliente1: "Beto", cliente2: "" },
  ];
  const p = proyectarFilasEnOrden(filas, resolver);
  si(p[1].proyeccion.ok && p[1].proyeccion.monto === 800,
    "la fila de Beto no la toca el gasto de Ana", JSON.stringify(p[1].proyeccion));
  si(p[1].cliente1?.saldo_actual === 900,
    "Beto sigue con sus 900", String(p[1].cliente1?.saldo_actual));
}

// ---------------------------------------------------------------------------
// 3. El CLIENTE 2 (dador) NO se descuenta: solo el que juega paga
// ---------------------------------------------------------------------------
console.log("\n== El dador (cliente 2) no se descuenta ==");
{
  const filas: FilaDeCarga[] = [
    { jugada: "1p", caballo: "1x2", monto: "800", cliente1: "Ana", cliente2: "Beto" },
    { jugada: "1p", caballo: "3x4", monto: "800", cliente1: "Ana", cliente2: "Beto" },
  ];
  const p = proyectarFilasEnOrden(filas, resolver);
  si(p[0].proyeccion.ok && p[0].proyeccion.monto === 800,
    "fila 1 (dador): autoriza 800", JSON.stringify(p[0].proyeccion));
  si(p[1].cliente2?.saldo_actual === 900,
    "Beto (dador) sigue con 900: no se le descuenta", String(p[1].cliente2?.saldo_actual));
  si(p[1].proyeccion.ok && p[1].proyeccion.monto === 200,
    "fila 2: topada por el saldo restante de Ana (200)", JSON.stringify(p[1].proyeccion));
}

// ---------------------------------------------------------------------------
// 4. Una fila sin monto (ilegible) no descuenta nada
// ---------------------------------------------------------------------------
console.log("\n== Fila ilegible no descuenta ==");
{
  const filas: FilaDeCarga[] = [
    { jugada: "2p", caballo: "3", monto: "", cliente1: "Ana", cliente2: "" },
    { jugada: "2p", caballo: "5", monto: "800", cliente1: "Ana", cliente2: "" },
  ];
  const p = proyectarFilasEnOrden(filas, resolver);
  si(p[1].proyeccion.ok && p[1].proyeccion.monto === 800,
    "sin monto en la fila 1, la fila 2 conserva el saldo entero", JSON.stringify(p[1].proyeccion));
}

// ---------------------------------------------------------------------------
// 5. clienteConSaldoDescontado: no toca nada si no hay descuento
// ---------------------------------------------------------------------------
console.log("\n== clienteConSaldoDescontado ==");
{
  const c = { id: "ana", nombre: "Ana", saldo_actual: 500, aval: 100, modo_juego: "aval" };
  const vacio = new Map<string, number>();
  si(clienteConSaldoDescontado(c, vacio) === c,
    "sin descuento devuelve el MISMO objeto (no rompe identidad)");
  const conUso = new Map<string, number>([["ana", 200]]);
  const r = clienteConSaldoDescontado(c, conUso);
  si(r !== c && r?.saldo_actual === 300,
    "con descuento resta del saldo_actual (500 − 200 = 300)", String(r?.saldo_actual));
  si(r?.aval === 100,
    "el aval NO se rebaja: solo baja el saldo", String(r?.aval));
}

// ---------------------------------------------------------------------------
// 6. El disponible se AGOTA: la fila que lo agota autoriza 0 (no el monto pedido)
// ---------------------------------------------------------------------------
console.log("\n== Se agota el disponible: el espejo muestra exceso con saldo cero ==");
{
  const filas: FilaDeCarga[] = [
    { jugada: "2p", caballo: "3", monto: "600", cliente1: "Ana", cliente2: "" },
    { jugada: "2p", caballo: "4", monto: "600", cliente1: "Ana", cliente2: "" },
    { jugada: "2p", caballo: "5", monto: "600", cliente1: "Ana", cliente2: "" },
  ];
  const p = proyectarFilasEnOrden(filas, resolver);
  const m = p.map((x) => x.montoAceptado);
  si(JSON.stringify(m) === JSON.stringify([600, 400, 0]),
    "saldo 1000 con tres de 600: acepta 600 · 400 · 0", JSON.stringify(m));
  si(p[1].proyeccion.ok && p[1].proyeccion.reparto?.recortado === true,
    "la segunda queda marcada como recortada");
  si(p[2].montoExcedido === 600 && p[2].observacion === "Sin saldo",
    "la tercera indica que ya no hay saldo disponible y marca Sin saldo", JSON.stringify(p[2]));
  si(p[2].saldoRestante === 0 && p[2].etiquetaRestante === "Queda: 0",
    "la tercera muestra saldo restante cero", JSON.stringify(p[2]));
  si(p[2].cliente1?.saldo_actual === 0,
    "la tercera ve el saldo agotado (0)", String(p[2].cliente1?.saldo_actual));
}

console.log("\n== Saldo 500 con tres de 300: 300 · 200 · 0 ==");
{
  const cat = [{ id: "leo", nombre: "Leo", saldo_actual: 500, aval: 0, modo_juego: "aval" }];
  const r = (t: string) => cat.find((c) => c.nombre.toLowerCase() === t.trim().toLowerCase()) ?? null;
  const filas: FilaDeCarga[] = [
    { jugada: "2p", caballo: "3", monto: "300", cliente1: "Leo", cliente2: "" },
    { jugada: "2p", caballo: "4", monto: "300", cliente1: "Leo", cliente2: "" },
    { jugada: "2p", caballo: "5", monto: "300", cliente1: "Leo", cliente2: "" },
  ];
  const p = proyectarFilasEnOrden(filas, r);
  const m = p.map((x) => x.montoAceptado);
  si(JSON.stringify(m) === JSON.stringify([300, 200, 0]), "300 · 200 · 0", JSON.stringify(m));
}

console.log("\n== Cuando el saldo ya quedó en cero, la siguiente línea marca Sin saldo ==");
{
  const cat = [{ id: "mario", nombre: "Mario", saldo_actual: 500, aval: 0, modo_juego: "aval" }];
  const r = (t: string) => cat.find((c) => c.nombre.toLowerCase() === t.trim().toLowerCase()) ?? null;
  const filas: FilaDeCarga[] = [
    { jugada: "2p", caballo: "3", monto: "300", cliente1: "Mario", cliente2: "" },
    { jugada: "2p", caballo: "4", monto: "300", cliente1: "Mario", cliente2: "" },
    { jugada: "2p", caballo: "5", monto: "300", cliente1: "Mario", cliente2: "" },
  ];
  const p = proyectarFilasEnOrden(filas, r);
  si(JSON.stringify(p.map((x) => x.montoAceptado)) === JSON.stringify([300, 200, 0]),
    "acepta 300 · 200 · 0 con saldo agotado",
    JSON.stringify(p.map((x) => x.montoAceptado)));
  si(p[2].observacion === "Sin saldo" && p[2].montoExcedido === 300 && p[2].saldoRestante === 0,
    "la línea agotada se marca como Sin saldo, no como Excedido",
    JSON.stringify(p[2]));
  si(!p[2].excedido,
    "la línea agotada NO se marca como excedida pero sí conserva el monto excedido bruto",
    JSON.stringify(p[2]));
}

console.log("\n== El aval amplía el disponible pero NO se rebaja ==");
{
  const cat = [{ id: "car", nombre: "Carla", saldo_actual: 0, aval: 500, modo_juego: "aval" }];
  const r = (t: string) => cat.find((c) => c.nombre.toLowerCase() === t.trim().toLowerCase()) ?? null;
  const filas: FilaDeCarga[] = [
    { jugada: "2p", caballo: "3", monto: "300", cliente1: "Carla", cliente2: "" },
    { jugada: "2p", caballo: "4", monto: "300", cliente1: "Carla", cliente2: "" },
  ];
  const p = proyectarFilasEnOrden(filas, r);
  const m = p.map((x) => (x.proyeccion.ok ? x.proyeccion.monto : NaN));
  si(m[0] === 300 && m[1] === 200, "con aval 500: 300 · 200", JSON.stringify(m));
  si(p[1].cliente1?.saldo_actual === -300 && p[1].cliente1?.aval === 500,
    "el saldo baja a -300 y el aval sigue 500");
}

console.log("\n== Recorte progresivo exacto y observación corta ==");
{
  const cat = [{ id: "eli", nombre: "Eli", saldo_actual: 2000, aval: 0, modo_juego: "aval" }];
  const r = (t: string) => cat.find((c) => c.nombre.toLowerCase() === t.trim().toLowerCase()) ?? null;
  const filas: FilaDeCarga[] = [
    { jugada: "2p", caballo: "3", monto: "1000", cliente1: "Eli", cliente2: "" },
    { jugada: "2p", caballo: "4", monto: "500", cliente1: "Eli", cliente2: "" },
    { jugada: "2p", caballo: "5", monto: "600", cliente1: "Eli", cliente2: "" },
  ];
  const p = proyectarFilasEnOrden(filas, r);
  si(JSON.stringify(p.map((x) => x.montoAceptado)) === JSON.stringify([1000, 500, 500]),
    "acepta 1000 · 500 · recorta a 500", JSON.stringify(p.map((x) => x.montoAceptado)));
  si(p[2].montoExcedido === 100 && p[2].observacion === "Excedido 100",
    "persiste la nota visual exacta Excedido 100", JSON.stringify(p[2]));
  si(p[0].saldoRestante === 1000 && p[1].saldoRestante === 500 && p[2].saldoRestante === 0,
    "muestra el saldo restante línea por línea", JSON.stringify(p.map((x) => x.saldoRestante)));
}

// ---------------------------------------------------------------------------
// 7. REGLA CERO: lo que NO cambió (sin datos de cliente, modo libre)
// ---------------------------------------------------------------------------
console.log("\n== Sin datos de cliente la proyección NO se topa ==");
{
  const nada = () => null;
  const p = proyectarFilasEnOrden(
    [{ jugada: "2x3 10/8", caballo: "", monto: "100", cliente1: "Fantasma", cliente2: "" }],
    nada
  );
  si(p[0].proyeccion.ok && p[0].proyeccion.monto === 100,
    "cliente desconocido → autoriza el monto pedido (no hay a quién topar)",
    JSON.stringify(p[0].proyeccion));
  const solo = proyectarFila({ jugada: "2n", monto: "150" });
  si(solo.ok && solo.monto === 150,
    "proyectarFila SIN clientes conserva el monto pedido", JSON.stringify(solo));
}

console.log("\n== Modo libre no se topa ==");
{
  const cat = [{ id: "lib", nombre: "Lulo", saldo_actual: 0, aval: 0, modo_juego: "libre" }];
  const r = (t: string) => cat.find((c) => c.nombre.toLowerCase() === t.trim().toLowerCase()) ?? null;
  const p = proyectarFilasEnOrden(
    [{ jugada: "2p", caballo: "3", monto: "999", cliente1: "Lulo", cliente2: "" }],
    r
  );
  si(p[0].proyeccion.ok && p[0].proyeccion.monto === 999, "libre autoriza los 999");
}

console.log(`\n${pasan} pasan, ${fallan} fallan.`);
if (fallan > 0) process.exit(1);
