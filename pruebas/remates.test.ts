// ============================================================================
// Pruebas de la lógica PURA de Remates (src/lib/remates/core.ts).
//
// Cubre lo que no puede fallar sin plata de por medio:
//   - La derivación de ejemplares del programa central: que los candidatos
//     salgan numerados 1..n (no con el Nº crudo, que puede tener huecos) y que
//     un retirado NO se ofrezca pero se siga viendo con su motivo.
//   - El motor financiero del remate: subtotal + incentivo, comisión y premio.
//   - Las probabilidades implícitas: el peso de cada puja en el pozo.
//   - El cierre: quién genera ticket y descuento, quién queda en CASA, y qué se
//     puede editar en la pizarra cuando el remate ya se liquidó y se reabrió.
// ============================================================================
import {
  candidatosDelPrograma,
  candidatosJugables,
  calcularFinanzasRemate,
  probabilidades,
  resumenPrograma,
  incrementoPuja,
  incentivoDe,
  normalizarEscalera,
  pujaMinimaSiguiente,
  traducirProporcion,
  fraccionHipodromo,
  calcularDividendoHipodromo,
  textoDividendo,
  lineasPizarraRemate,
  mensajePizarraRemate,
  cierrePizarraRemate,
  montoPizarraRemate,
  planCierreRemate,
  edicionFilaRemate,
  ESCALONES_PUJA,
} from "../src/lib/remates/core";

let pasan = 0;
let fallan = 0;

function eq(nombre: string, obtenido: unknown, esperado: unknown) {
  const a = JSON.stringify(obtenido);
  const b = JSON.stringify(esperado);
  if (a === b) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}\n         obtenido:  ${a}\n         esperado:  ${b}`);
  }
}

console.log("\n[1] candidatosDelPrograma: numeración 1..n y retirados");
// ---------------------------------------------------------------------------
eq("null", candidatosDelPrograma(null), []);
eq("undefined", candidatosDelPrograma(undefined), []);
eq("vacio", candidatosDelPrograma([]), []);
eq(
  "dos ejemplares validos se numeran 1..n",
  candidatosDelPrograma([
    { numero: "1", nombre: "DUKE" },
    { numero: "2", nombre: "VICTORIA" },
  ]),
  [
    { numero: 1, nombre: "DUKE", ejemplar_numero: "1", retirado: false },
    { numero: 2, nombre: "VICTORIA", ejemplar_numero: "2", retirado: false },
  ]
);
// El Nº del programa puede traer huecos (retiros): la posición en el remate es
// 1..n de los que sí corren, pero se conserva el Nº original en ejemplar_numero.
eq(
  "salta los numeros vacios o en cero y conserva el Nº original",
  candidatosDelPrograma([
    { numero: "1", nombre: "A" },
    { numero: "", nombre: "B" },
    { numero: "0", nombre: "C" },
    { numero: "00", nombre: "D" },
    { numero: "7", nombre: "E" },
  ]),
  [
    { numero: 1, nombre: "A", ejemplar_numero: "1", retirado: false },
    { numero: 2, nombre: "E", ejemplar_numero: "7", retirado: false },
  ]
);
eq(
  "recorta espacios del nombre y del numero",
  candidatosDelPrograma([{ numero: "  3  ", nombre: "  LUNA  " }]),
  [{ numero: 1, nombre: "LUNA", ejemplar_numero: "3", retirado: false }]
);
eq(
  "marca al retirado",
  candidatosDelPrograma([
    { numero: "1", nombre: "A", retirado: true },
    { numero: "2", nombre: "B", retirado: false },
  ]),
  [
    { numero: 1, nombre: "A", ejemplar_numero: "1", retirado: true },
    { numero: 2, nombre: "B", ejemplar_numero: "2", retirado: false },
  ]
);
eq(
  "nombre ausente queda como cadena vacia",
  candidatosDelPrograma([{ numero: "1", nombre: null }]),
  [{ numero: 1, nombre: "", ejemplar_numero: "1", retirado: false }]
);

console.log("\n[2] candidatosJugables: fuera los retirados");
// ---------------------------------------------------------------------------
eq("null", candidatosJugables(null), []);
eq(
  "solo los que corren",
  candidatosJugables([
    { numero: 1, nombre: "A", ejemplar_numero: "1", retirado: false },
    { numero: 2, nombre: "B", ejemplar_numero: "2", retirado: true },
    { numero: 3, nombre: "C", ejemplar_numero: "3", retirado: false },
  ]),
  [
    { numero: 1, nombre: "A", ejemplar_numero: "1", retirado: false },
    { numero: 3, nombre: "C", ejemplar_numero: "3", retirado: false },
  ]
);

console.log("\n[3] calcularFinanzasRemate: comision sobre el subtotal, incentivo aparte");
// ---------------------------------------------------------------------------
eq("sin caballos", calcularFinanzasRemate(null, 0, 20), {
  caballos: 0,
  subtotal: 0,
  incentivo: 0,
  incentivoPct: 0,
  totalBruto: 0,
  comisionPct: 20,
  descuentoComision: 0,
  premioGanador: 0,
});
// La comisión se calcula sobre el SUBTOTAL (150), no sobre el bruto (160): el
// incentivo (10) no paga comisión y se suma entero al premio.
eq("subtotal, comision y premio", calcularFinanzasRemate([{ monto_usd: 100 }, { monto_usd: 50 }], 10, 20), {
  caballos: 2,
  subtotal: 150,
  incentivo: 10,
  incentivoPct: 0,
  totalBruto: 160,
  comisionPct: 20,
  descuentoComision: 30,
  premioGanador: 130,
});
eq("comision 0 paga el bruto completo", calcularFinanzasRemate([{ monto_usd: 100 }], 0, 0), {
  caballos: 1,
  subtotal: 100,
  incentivo: 0,
  incentivoPct: 0,
  totalBruto: 100,
  comisionPct: 0,
  descuentoComision: 0,
  premioGanador: 100,
});
eq("solo incentivo, sin pujas", calcularFinanzasRemate([], 25, 10), {
  caballos: 0,
  subtotal: 0,
  incentivo: 25,
  incentivoPct: 0,
  totalBruto: 25,
  comisionPct: 10,
  descuentoComision: 0,
  premioGanador: 25,
});
eq("redondea a 2 decimales", calcularFinanzasRemate([{ monto_usd: 33.33 }, { monto_usd: 66.67 }], 0, 15), {
  caballos: 2,
  subtotal: 100,
  incentivo: 0,
  incentivoPct: 0,
  totalBruto: 100,
  comisionPct: 15,
  descuentoComision: 15,
  premioGanador: 85,
});
eq("un monto no numerico cuenta como 0", calcularFinanzasRemate([{ monto_usd: 100 }, { monto_usd: NaN }], 0, 20), {
  caballos: 2,
  subtotal: 100,
  incentivo: 0,
  incentivoPct: 0,
  totalBruto: 100,
  comisionPct: 20,
  descuentoComision: 20,
  premioGanador: 80,
});

console.log("\n[3b] incentivo: monto fijo o % del subtotal");
// ---------------------------------------------------------------------------
eq("sin % manda el monto fijo", incentivoDe(200, 25, 0), 25);
eq("sin % ignora el subtotal", incentivoDe(999, 25, 0), 25);
eq("con % manda el porcentaje", incentivoDe(200, 25, 10), 20);
eq("con % el monto fijo se ignora", incentivoDe(2000, 999, 5), 100);
eq("con % y subtotal 0 da 0", incentivoDe(0, 25, 10), 0);
// Incentive del 10% sobre 200: incentivo 20, comision 40 SOLO sobre las pujas,
// premio 220 - 40 = 180 (el incentivo no se grava).
eq("motivo completo con incentivo porcentual", calcularFinanzasRemate([{ monto_usd: 200 }], 25, 20, 10), {
  caballos: 1,
  subtotal: 200,
  incentivo: 20,
  incentivoPct: 10,
  totalBruto: 220,
  comisionPct: 20,
  descuentoComision: 40,
  premioGanador: 180,
});
eq("incentivo 5% sobre 1000", calcularFinanzasRemate([{ monto_usd: 1000 }], 0, 10, 5), {
  caballos: 1,
  subtotal: 1000,
  incentivo: 50,
  incentivoPct: 5,
  totalBruto: 1050,
  comisionPct: 10,
  descuentoComision: 100,
  premioGanador: 950,
});

console.log("\n[4] probabilidades: peso de cada puja en el pozo");
// ---------------------------------------------------------------------------
eq("sin caballos", probabilidades(null), []);
eq("pozo parejo", probabilidades([{ monto_usd: 100 }, { monto_usd: 100 }]), [
  { prob_porcentaje: 50, prob_implicita: 2 },
  { prob_porcentaje: 50, prob_implicita: 2 },
]);
eq("pozo desparejo", probabilidades([{ monto_usd: 75 }, { monto_usd: 25 }]), [
  { prob_porcentaje: 75, prob_implicita: 1.33 },
  { prob_porcentaje: 25, prob_implicita: 4 },
]);
eq("pozo en cero no divide", probabilidades([{ monto_usd: 0 }, { monto_usd: 0 }]), [
  { prob_porcentaje: 0, prob_implicita: 0 },
  { prob_porcentaje: 0, prob_implicita: 0 },
]);
eq("una puja con monto 0 no rompe a las demas", probabilidades([{ monto_usd: 100 }, { monto_usd: 0 }]), [
  { prob_porcentaje: 100, prob_implicita: 1 },
  { prob_porcentaje: 0, prob_implicita: 0 },
]);
eq("tercios redondeados", probabilidades([{ monto_usd: 1 }, { monto_usd: 1 }, { monto_usd: 1 }]), [
  { prob_porcentaje: 33.33, prob_implicita: 3 },
  { prob_porcentaje: 33.33, prob_implicita: 3 },
  { prob_porcentaje: 33.33, prob_implicita: 3 },
]);

console.log("\n[5] resumenPrograma: texto de la jornada");
// ---------------------------------------------------------------------------
eq("sin carreras con fecha", resumenPrograma([], "2026-10-04"), "Sin carreras cargadas para el 2026-10-04.");
eq("sin carreras sin fecha", resumenPrograma(null, ""), "Sin carreras cargadas para el día elegido.");
eq("tres carreras", resumenPrograma([{ carrera: 1 }, { carrera: 2 }, { carrera: 3 }], "2026-10-04"), "3 carrera(s) cargada(s) para el 2026-10-04.");

console.log("\n[6] escalera de incrementos: como suben los ejemplares");
// ---------------------------------------------------------------------------
eq("la escalera tiene 5 tramos", ESCALONES_PUJA.length, 5);
// Limites: el tramo es semiabierto por arriba. 99 sube de 10; 100 ya de 20.
eq("incremento 0   -> 10", incrementoPuja(0), 10);
eq("incremento 99  -> 10", incrementoPuja(99), 10);
eq("incremento 100 -> 20", incrementoPuja(100), 20);
eq("incremento 199 -> 20", incrementoPuja(199), 20);
eq("incremento 200 -> 50", incrementoPuja(200), 50);
eq("incremento 499 -> 50", incrementoPuja(499), 50);
eq("incremento 500 -> 100", incrementoPuja(500), 100);
eq("incremento 999 -> 100", incrementoPuja(999), 100);
eq("incremento 1000 -> 200", incrementoPuja(1000), 200);
eq("incremento 5000 -> 200", incrementoPuja(5000), 200);
eq("incremento de un no numerico no rompe", incrementoPuja(Number.NaN), 10);
// Puja minima siguiente: monto actual + incremento de su tramo.
eq("puja minima desde 0   -> 10", pujaMinimaSiguiente(0), 10);
eq("puja minima desde 90  -> 100", pujaMinimaSiguiente(90), 100);
eq("puja minima desde 100 -> 120", pujaMinimaSiguiente(100), 120);
eq("puja minima desde 470 -> 520", pujaMinimaSiguiente(470), 520);
eq("puja minima desde 500 -> 600", pujaMinimaSiguiente(500), 600);
eq("puja minima desde 1000 -> 1200", pujaMinimaSiguiente(1000), 1200);

console.log("\n[7] escalera EDITABLE: una escalera dañada no puede rebajar la puja mínima");
// ---------------------------------------------------------------------------
// El monto que hay que poner para pujar sale de la escalera, así que una escalera
// guardada con huecos o incrementos en cero aceptaría pujas de menos. Estos son
// los casos que normalizarEscalera tiene que tapar.
eq(
  "sin escalera mandada usa la de la casa",
  incrementoPuja(100, null),
  incrementoPuja(100)
);
eq(
  "una escalera propia manda sobre la de la casa",
  incrementoPuja(100, [{ desde: 0, hasta: null, incremento: 5 }]),
  5
);
eq(
  "hueco entre tramos se encadena (no queda monto sin incremento)",
  incrementoPuja(
    300,
    [
      { desde: 0, hasta: 100, incremento: 10 },
      { desde: 500, hasta: null, incremento: 100 },
    ]
  ),
  100
);
eq(
  "incremento en cero se sube a 1 en vez de dejar la puja gratis",
  incrementoPuja(0, [{ desde: 0, hasta: null, incremento: 0 }]),
  1
);
eq(
  "el ultimo tramo siempre queda abierto",
  normalizarEscalera([{ desde: 0, hasta: 100, incremento: 10 }]).slice(-1)[0].hasta,
  null
);
eq(
  "el primer tramo siempre arranca en 0",
  normalizarEscalera([{ desde: 250, hasta: null, incremento: 10 }])[0].desde,
  0
);
eq("escalera vacia cae en la de la casa", normalizarEscalera([]).length, ESCALONES_PUJA.length);
eq(
  "escalera toda basura cae en la de la casa",
  normalizarEscalera([{ desde: Number.NaN, hasta: 0, incremento: -5 }]).length,
  ESCALONES_PUJA.length
);
eq(
  "la escalera por defecto sobrevive el round-trip",
  normalizarEscalera(ESCALONES_PUJA),
  ESCALONES_PUJA
);

console.log("\n[8] traducirProporcion: el porcentaje en palabras");
// ---------------------------------------------------------------------------
eq("25% son 1 de cada 4", traducirProporcion(25), "1 de cada 4");
eq("50% son 1 de cada 2", traducirProporcion(50), "1 de cada 2");
eq("33.33% son 1 de cada 3", traducirProporcion(33.33), "1 de cada 3");
eq("10% son 1 de cada 10", traducirProporcion(10), "1 de cada 10");
eq("100% es 1 de cada 1", traducirProporcion(100), "1 de cada 1");
// Un porcentaje minimo produciria "1 de cada 40000": no es un error, pero el
// piso de 1 evita el "1 de cada 0", que si lo seria.
eq("porcentaje bajísimo no produce una proporción inútil", traducirProporcion(0.01), "1 de cada 10.000");
eq("cero no es proporcion", traducirProporcion(0), "sin proporción");
eq("negativo no es proporcion", traducirProporcion(-5), "sin proporción");
eq("nulo no es proporcion", traducirProporcion(null), "sin proporción");
eq("basura no es proporcion", traducirProporcion(Number.NaN), "sin proporción");

console.log("\n[9] planCierreRemate: quién se vende y quién queda en CASA");
// ---------------------------------------------------------------------------
// La regla del cierre: tiene comprador = ticket + descuento de saldo.
// No tiene comprador = CASA: ni ticket ni descuento.
eq("sin filas no hay nada que liquidar", planCierreRemate([]), {
  aVender: 0,
  enCasa: 0,
  sinMonto: 0,
  total: 0,
  vacio: true,
});
eq("null no rompe", planCierreRemate(null).vacio, true);
eq(
  "con comprador suma ticket y saldo",
  planCierreRemate([
    { cliente_id: "a", monto_usd: 100 },
    { cliente_id: "b", monto_usd: 250.5 },
  ]),
  { aVender: 2, enCasa: 0, sinMonto: 0, total: 350.5, vacio: false }
);
eq(
  "sin comprador queda en CASA y no suma al descuento",
  planCierreRemate([
    { cliente_id: null, monto_usd: 500 },
    { cliente_id: "", monto_usd: 100 },
    { cliente_id: "a", monto_usd: 200 },
  ]),
  { aVender: 1, enCasa: 2, sinMonto: 0, total: 200, vacio: false }
);
eq(
  "comprador sin monto se avisa aparte en vez de venderse en 0",
  planCierreRemate([
    { cliente_id: "a", monto_usd: 0 },
    { cliente_id: "b", monto_usd: null },
    { cliente_id: null, monto_usd: 0 },
  ]),
  { aVender: 0, enCasa: 0, sinMonto: 2, total: 0, vacio: true }
);
eq("montos no numéricos cuentan como 0", planCierreRemate([{ cliente_id: "a", monto_usd: Number.NaN }]).sinMonto, 1);
eq("el total se redondea a 2 decimales", planCierreRemate([{ cliente_id: "a", monto_usd: 0.1 }, { cliente_id: "b", monto_usd: 0.2 }]).total, 0.3);

console.log("\n[10] edicionFilaRemate: qué se puede tocar en la pizarra");
// ---------------------------------------------------------------------------
eq("remate abierto: todo editable", edicionFilaRemate({ cerrado: false }), {
  bloqueado: false,
  soloAsignar: false,
  vendido: false,
});
eq("remate cerrado: nada se toca", edicionFilaRemate({ cerrado: true }).bloqueado, true);
eq("retirado: nada se toca", edicionFilaRemate({ cerrado: false, retiro: true }).bloqueado, true);
eq("invalidado: nada se toca", edicionFilaRemate({ cerrado: false, inv: true }).bloqueado, true);
eq("ya vendido: nada se toca", edicionFilaRemate({ cerrado: false, vendido: true }).bloqueado, true);
// Reabierto después de liquidar: la fila en CASA solo recibe comprador.
eq(
  "reabierto y liquidado: en CASA solo se asigna comprador",
  edicionFilaRemate({ cerrado: false, liquidado: true }),
  { bloqueado: false, soloAsignar: true, vendido: false }
);
eq(
  "reabierto y liquidado: lo ya vendido queda bloqueado",
  edicionFilaRemate({ cerrado: false, liquidado: true, vendido: true }),
  { bloqueado: true, soloAsignar: false, vendido: true }
);
eq(
  "cerrado gana siempre: no se asigna aunque esté liquidado",
  edicionFilaRemate({ cerrado: true, liquidado: true }).soloAsignar,
  false
);
eq(
  "sin liquidar no hay modo 'solo asignar'",
  edicionFilaRemate({ cerrado: false, liquidado: false }).soloAsignar,
  false
);

console.log("\n[11] dividendo del tote: fracción tradicional y redondeo hacia abajo");
// ---------------------------------------------------------------------------
eq("una ganancia por debajo de la primera fracción no paga nada", fraccionHipodromo(0.04), { valor: 0, etiqueta: "0" });
eq("0.15 baja a 1/9", fraccionHipodromo(0.15), { valor: 0.11, etiqueta: "1/9" });
eq("0.10 baja a 1/20", fraccionHipodromo(0.1), { valor: 0.05, etiqueta: "1/20" });
eq("el borde exacto entra", fraccionHipodromo(0.11), { valor: 0.11, etiqueta: "1/9" });
eq("ganancia entera es 1/1", fraccionHipodromo(1), { valor: 1, etiqueta: "1/1" });
eq("3.99 baja a 7/2", fraccionHipodromo(3.99), { valor: 3.5, etiqueta: "7/2" });
eq("desde 4.00 la fracción es entera", fraccionHipodromo(4.2), { valor: 4, etiqueta: "4/1" });
eq(
  "pozo 200 sobre puja 100: retorno 2.00",
  calcularDividendoHipodromo(200, 100),
  { ganancia: 1, fraccion: "1/1", dividendo: 2 }
);
eq(
  "pozo 115 sobre puja 100: dividendo 1.11",
  calcularDividendoHipodromo(115, 100),
  { ganancia: 0.11, fraccion: "1/9", dividendo: 1.11 }
);
eq("pozo igual a la puja no da ganancia", calcularDividendoHipodromo(100, 100), { ganancia: 0, fraccion: "0", dividendo: 1 });
eq("sin puja o sin pozo el dividendo es 1.00", calcularDividendoHipodromo(0, 100), { ganancia: 0, fraccion: "0", dividendo: 1 });
eq("texto con dividendo", textoDividendo(115, 100), "1/9");
eq("texto sin ganancia", textoDividendo(100, 100), "—");

console.log("\n[12] mensaje de la pizarra para el grupo de WhatsApp");
// ---------------------------------------------------------------------------
const wsp = mensajePizarraRemate(
  { nombre: "remate 5", hipodromo: "La Rinconada", carrera: 3, fecha: "2026-10-04" },
  [
    { numero: "1", nombre: "Duke", comprador: "Ana", monto_usd: 100 },
    { numero: "2", nombre: "Victoria", comprador: null, monto_usd: 100 },
  ],
  115
);
eq("mensaje: arranca con el titulo y el lugar", wsp.startsWith("*REMATE 5*\n🏇 La Rinconada · C3 · 2026-10-04"), true);
eq("mensaje: una linea por ejemplar", wsp.split("\n").filter((l) => /^\d+\./.test(l)).length, 2);
eq("mensaje: incluye comprador y CASA", wsp.includes("DUKE - Ana") && wsp.includes("VICTORIA - CASA"), true);
eq("mensaje: incluye el dividendo", wsp.includes("(1/9)"), true);
const lineas = lineasPizarraRemate(
  [
    { numero: "1", nombre: "Duke", comprador: "Ana", monto_usd: 100 },
    { numero: "2", nombre: "Victoria", comprador: null, monto_usd: 100 },
  ],
  115
);
eq("lineas: una linea por ejemplar", lineas.split("\n").length, 2);
eq("lineas: primera con comprador", lineas.startsWith("1. DUKE - Ana - "), true);
eq("lineas: segunda sin comprador dice CASA", lineas.includes("2. VICTORIA - CASA - "), true);
eq("lineas: incluye el dividendo", lineas.includes("(1/9)"), true);

// ---------------------------------------------------------------------------
console.log("\n[13] cierre de la pizarra: el formato EXACTO que pide el grupo");
// ---------------------------------------------------------------------------
// "Incentivo de la casa" con DOS espacios antes del monto, una línea en blanco
// y el total en negrita de WhatsApp. Se compara el texto entero, no un
// `includes`: si alguien cambia un espacio o quita la línea en blanco, el
// mensaje llega al grupo con otro formato y hay que enterarse acá.
eq(
  "cierre: formato exacto del grupo",
  cierrePizarraRemate(62, 558),
  "Incentivo de la casa  62\n\n*Total a pagar 558*"
);
eq("cierre: dos espacios antes del monto de incentivo", /^Incentivo de la casa {2}\d+$/m.test(cierrePizarraRemate(62, 558)), true);
eq("cierre: linea en blanco entre incentivo y total", cierrePizarraRemate(62, 558).includes("62\n\n*Total"), true);
eq("cierre: el total va en negrita", cierrePizarraRemate(62, 558).endsWith("*Total a pagar 558*"), true);
eq("monto: entero sin decimales", montoPizarraRemate(62), "62");
eq("monto: con centavos los muestra", montoPizarraRemate(62.5), "62.50");
eq("monto: cero", montoPizarraRemate(0), "0");
eq("monto: nulo o indefinido es cero", montoPizarraRemate(null), "0");

const wspConCierre = mensajePizarraRemate(
  { nombre: "remate 5", hipodromo: "La Rinconada", carrera: 3, fecha: "2026-10-04" },
  [
    { numero: "1", nombre: "Duke", comprador: "Ana", monto_usd: 100 },
    { numero: "2", nombre: "Victoria", comprador: null, monto_usd: 100 },
  ],
  115,
  { incentivo: 62, total: 558 }
);
eq("mensaje: termina con el cierre exacto", wspConCierre.endsWith(cierrePizarraRemate(62, 558)), true);
eq("mensaje: el cierre va despues de las lineas, no pegado", /\n\nIncentivo de la casa  62/.test(wspConCierre), true);
eq("mensaje: sin cierre no aparece el pie", wsp.includes("Incentivo de la casa"), false);
eq("mensaje: el cierre no altera las lineas de ejemplares", wspConCierre.split("\n")[4], wsp.split("\n")[4]);

console.log(`\n${fallan === 0 ? "TODO OK" : "HAY FALLAS"}: ${pasan} pasaron, ${fallan} fallaron\n`);
if (fallan > 0) process.exit(1);
