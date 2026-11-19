/**
 * CERTIFICACIÓN EXHAUSTIVA: Integración Bot WhatsApp Baileys 24/7 + Sala + Taquilla + Liquidación
 *
 * Verifica:
 * 1. Proporciones A Premio: 10/5, 10a5, 10 a 5, 10a 5, 10 a5, hasta 10a9,99 y 10a9.99.
 * 2. Montos: 1.000 = 1k = 1000 y 10.000 = 10k = 10000 en bot, tabla y carga rápida.
 * 3. Escalera entre tercios y tolerancia a espacios:
 *    1p, 1p y 1/2n, 1/2n, 1/2 y 2n, 2n, 2n y 2/2n, 2/2n, 2/2n y 2p, 2p,
 *    1p = 1 p, 2 y 2 n = 2/2n = 2/ 2n = 2 /2 n.
 * 4. Enfrentamientos (PP y A Premio) con Juego vs Consigo/Doy, prohibición de "pido" y "match".
 * 5. Recorte de saldo de propuesta y cálculo real de saldo disponible (sin bloqueo por Math.max).
 * 6. Compatibilidad 100% del Plano Oficial de WhatsApp con Carga Rápida / Poblar Tabla y Liquidación.
 */

import {
  analizarYEstandarizarJugada,
  analizarComandoRetiro,
  calcularRiesgoReal,
  esIntentoConcrecionOMontoParcial,
  evaluarConcrecionEstricta,
  extraerMontoNumerico,
} from "../src/features/sala-juegos/lib/parser-pedagogico";
import { normalizarModalidadProgresiva } from "../src/features/sala-juegos/lib/modalidades-progresivas";
import { calcularSaldoDisponible } from "../src/features/whatsapp-sala/resolverCliente";
import { validarSaldo } from "../src/features/whatsapp-sala/validarSaldo";
import { clasificarLineaRapida, parsearLineaRapida, proyectarFila } from "../src/features/taquilla/lib/validar";
import { normalizarLineaRapida } from "../src/features/taquilla/lib/normalizar";
import { logicaGanancias, liquidarPuesto, validarPuesto } from "../src/features/motores/lib/puestos";

let pasan = 0;
let fallan = 0;
function si(cond: boolean, msg: string, detalle?: string) {
  if (cond) {
    pasan++;
    console.log(`  ok   ${msg}`);
  } else {
    fallan++;
    console.error(`  FALLA ${msg}${detalle ? `\n         ${detalle}` : ""}`);
  }
}

console.log("\n=== 1. PROPORCIONES A PREMIO (10/5, 10a5, 10 a 5, 10a 5, 10 a5 .. 10a9,99 / 10a9.99) ===");
for (const [variante, esperado] of [
  ["10/5", "10/5"],
  ["10a5", "10/5"],
  ["10 a 5", "10/5"],
  ["10a 5", "10/5"],
  ["10 a5", "10/5"],
  ["10a9,99", "10/9.99"],
  ["10a9.99", "10/9.99"],
  ["10 a 9,99", "10/9.99"],
  ["10a 9.99", "10/9.99"],
  ["10 a9,99", "10/9.99"],
] as const) {
  const normMod = normalizarModalidadProgresiva(variante);
  si(normMod === esperado, `normalizarModalidadProgresiva("${variante}") → "${esperado}"`, String(normMod));

  const botJuega = analizarYEstandarizarJugada(`Juego ${variante} del 4 con 100`, 1000);
  si(
    botJuega.valido && botJuega.modalidad === esperado && botJuega.proporcion === esperado && botJuega.caballosBandoA[0] === "4",
    `Bot analiza "Juego ${variante} del 4 con 100" → mod=${esperado}`,
    JSON.stringify(botJuega)
  );
}

console.log("\n=== 2. EQUIVALENCIA DE MONTOS (1.000 = 1k = 1000 y 10.000 = 10k = 10000) ===");
for (const [raw, esperado] of [
  ["1.000", 1000],
  ["1k", 1000],
  ["1000", 1000],
  ["10.000", 10000],
  ["10k", 10000],
  ["10000", 10000],
] as const) {
  const ext = extraerMontoNumerico(raw);
  si(ext.monto === esperado, `Bot extraerMontoNumerico("${raw}") === ${esperado}`, JSON.stringify(ext));

  const bot = analizarYEstandarizarJugada(`Juego 1p del 5 con ${raw}`, 50000);
  si(bot.valido && bot.monto === esperado, `Bot "Juego 1p del 5 con ${raw}" → monto=${esperado}`, JSON.stringify(bot));

  const proy = proyectarFila({ jugada: "1P", caballo: "5", monto: raw });
  si(proy.ok && proy.monto === esperado, `Taquilla proyectarFila(monto="${raw}") → ${esperado}`, JSON.stringify(proy));

  const lin = parsearLineaRapida(`Juega Juan 1p (5) con ${raw} da Pedro`);
  const numLin = lin && lin.ok ? Number(String(lin.monto).replace(/\./g, "").replace(",", ".")) : NaN;
  si(lin?.ok === true && numLin === esperado, `Carga Rápida "Juega Juan 1p (5) con ${raw} da Pedro" → ${esperado}`, JSON.stringify(lin));
}

console.log("\n=== 3. ORDEN DE JUGADAS ENTRE TERCIOS Y VARIACIONES DE ESPACIO ===");
const casosTercios: Array<[string, string]> = [
  ["1p", "1P"],
  ["1 p", "1P"],
  ["1p y 1/2n", "1P y 1/2N"],
  ["1 p y 1 / 2 n", "1P y 1/2N"],
  ["1/2n", "1/2N"],
  ["1 / 2 n", "1/2N"],
  ["1/ 2n", "1/2N"],
  ["1 /2 n", "1/2N"],
  ["1/2 y 2n", "1/2N y 2N"],
  ["1/2n y 2n", "1/2N y 2N"],
  ["1 / 2 y 2 n", "1/2N y 2N"],
  ["2n", "2N"],
  ["2 n", "2N"],
  ["2n y 2/2n", "2N y 2/2N"],
  ["2 n y 2 / 2 n", "2N y 2/2N"],
  ["2n y 2 y 2 n", "2N y 2/2N"],
  ["2/2n", "2/2N"],
  ["2 y 2 n", "2/2N"],
  ["2/ 2n", "2/2N"],
  ["2 /2 n", "2/2N"],
  ["2/2n y 2p", "2/2N y 2P"],
  ["2 y 2 n y 2 p", "2/2N y 2P"],
  ["2p", "2P"],
  ["2 p", "2P"],
];

for (const [entrada, canon] of casosTercios) {
  const norm = normalizarModalidadProgresiva(entrada);
  si(norm === canon, `normalizarModalidadProgresiva("${entrada}") → "${canon}"`, String(norm));

  const bot = analizarYEstandarizarJugada(`Juego ${entrada} del 5 con 100`, 1000);
  si(bot.valido && bot.modalidad === canon, `Bot "Juego ${entrada} del 5 con 100" → "${canon}"`, JSON.stringify(bot));

  const vp = validarPuesto(entrada, 8);
  si(vp.ok, `Motor Taquilla validarPuesto("${entrada}") es válida`, JSON.stringify(vp));
}

// Verificar que 2/2N (50/50) y 2/2N y 2P (25/75) liquidan distinto cuando el caballo llega 2°
{
  const liq50 = liquidarPuesto("2 y 2 n", 2, 100);
  const liq75 = liquidarPuesto("2/2n y 2p", 2, 100);
  const liq25 = liquidarPuesto("2n y 2/2n", 2, 100);
  si(liq50.netoJugadorBruto === 50, `"2 y 2 n" (2/2N) en 2° paga 50% bruto (+50)`, JSON.stringify(liq50));
  si(liq75.netoJugadorBruto === 75, `"2/2n y 2p" en 2° paga 75% bruto (+75)`, JSON.stringify(liq75));
  si(liq25.netoJugadorBruto === 25, `"2n y 2/2n" en 2° paga 25% bruto (+25)`, JSON.stringify(liq25));
}

console.log("\n=== 4. ENFRENTAMIENTOS (PP Y A PREMIO): JUEGO VS CONSIGO/DOY, SIN 'MATCH' NI 'PIDO' ===");
{
  // Prohibición de "pido" y "match"
  const conPido = analizarYEstandarizarJugada("Pido 3x5 100", 1000);
  si(conPido.esIntencionDeJugada && !conPido.valido, `"Pido 3x5 100" es rechazado (no se usa pido)`, JSON.stringify(conPido));

  const conMatch = analizarYEstandarizarJugada("Juego match 3x5 100", 1000);
  si(conMatch.esIntencionDeJugada && !conMatch.valido, `"Juego match 3x5 100" es rechazado (no debe reconocer match)`, JSON.stringify(conMatch));

  const sinVerbo = analizarYEstandarizarJugada("3x5 con 100", 1000);
  si(sinVerbo.esIntencionDeJugada && !sinVerbo.valido, `"3x5 con 100" sin verbo es rechazado (debe decir Juego, Consigo o Doy)`, JSON.stringify(sinVerbo));

  // Match sin proporción -> se entiende PP (10/10) y en transcripción es PP
  for (const frase of ["Juego 3x5 100", "Juego 3x5 con 100", "Consigo 3x5 100", "Doy 3x5 con 100"]) {
    const r = analizarYEstandarizarJugada(frase, 1000);
    const accEsp = /^(consigo|doy)/i.test(frase) ? "CONSIGUE" : "JUEGA";
    si(
      r.valido &&
        r.esMatch &&
        r.modalidad === "PP" &&
        r.proporcion === "1x1" &&
        r.accionProponente === accEsp &&
        r.caballosBandoA[0] === "3" &&
        r.caballosBandoB[0] === "5" &&
        r.monto === 100,
      `"${frase}" → esMatch=true, modalidad="PP", accion=${accEsp}, 3x5, monto=100`,
      JSON.stringify(r)
    );
  }

  // Match con proporción antes o después de los caballos -> 10/8 .. 10/9.99
  for (const [frase, accEsp, propEsp] of [
    ["Juego 3x5 10a8 100", "JUEGA", "10/8"],
    ["Juego 3x5 10a8 con 100", "JUEGA", "10/8"],
    ["Doy 3x5 10a8 100", "CONSIGUE", "10/8"],
    ["Doy 3x5 10a8 con 100", "CONSIGUE", "10/8"],
    ["Consigo 3x5 10a8 100", "CONSIGUE", "10/8"],
    ["Consigo 10a8 la 3x5 con 100", "CONSIGUE", "10/8"],
    ["Consigo 10a9,99 la 3x5 con 1.000", "CONSIGUE", "10/9.99"],
  ] as const) {
    const r = analizarYEstandarizarJugada(frase, 5000);
    si(
      r.valido &&
        r.esMatch &&
        r.modalidad === propEsp &&
        r.proporcion === propEsp &&
        r.accionProponente === accEsp &&
        r.caballosBandoA[0] === "3" &&
        r.caballosBandoB[0] === "5",
      `"${frase}" → esMatch=true, modalidad="${propEsp}", accion=${accEsp}, 3x5`,
      JSON.stringify(r)
    );
  }

  // Riesgo direccional 10/8 con 100: quien JUEGA arriesga 100; quien CONSIGUE/DA arriesga 80
  si(calcularRiesgoReal(100, "10/8", "JUEGA", "PROPONENTE") === 100, "Proponente JUEGA 10/8 con 100 arriesga 100");
  si(calcularRiesgoReal(100, "10/8", "JUEGA", "ACEPTANTE") === 80, "Aceptante (DA) ante propuesta JUEGA 10/8 con 100 arriesga 80");
  si(calcularRiesgoReal(100, "10/8", "CONSIGUE", "PROPONENTE") === 80, "Proponente CONSIGUE/DOY 10/8 con 100 arriesga 80");
  si(calcularRiesgoReal(100, "10/8", "CONSIGUE", "ACEPTANTE") === 100, "Aceptante (JUEGA) ante propuesta CONSIGUE 10/8 con 100 arriesga 100");
}

console.log("\n=== 5. CORTE DE SALDO DE PROPUESTAS Y CÁLCULO DE SALDO DISPONIBLE ===");
{
  // calcularSaldoDisponible debe disminuir cuando sube saldo_retenido, sin quedarse pegado al saldo_disponible viejo
  const disp = calcularSaldoDisponible({
    saldo_actual: 100,
    aval: 0,
    saldo_retenido: 60,
    saldo_disponible: 100, // valor viejo en BD
    libre: false,
  });
  si(disp === 40, `calcularSaldoDisponible descuenta saldo_retenido (100 - 60 = 40, dio ${disp})`);

  // Recorte automático de propuesta cuando el jugador tiene saldo 40 y propone 100
  const recPuesto = analizarYEstandarizarJugada("Juego 1p 5 100", 40);
  si(
    recPuesto.valido &&
      recPuesto.excedioSaldo === true &&
      recPuesto.montoDisponibleValido === 40 &&
      recPuesto.jugadaEstandarizada === "Juego 1P 5 40",
    `Propuesta "Juego 1p 5 100" con saldo 40 se recorta a 40 ("${recPuesto.jugadaEstandarizada}")`,
    JSON.stringify(recPuesto)
  );

  // Recorte automático cuando un banquero con saldo 40 da 10a8 con 100 (su riesgo máximo 40 equivale a nominal 50)
  const recBanco = analizarYEstandarizarJugada("Doy 3x5 10a8 con 100", 40);
  si(
    recBanco.valido &&
      recBanco.excedioSaldo === true &&
      recBanco.montoDisponibleValido === 50 &&
      recBanco.jugadaEstandarizada === "Doy 3 x 5 10/8 50",
    `Propuesta "Doy 3x5 10a8 con 100" con saldo 40 se recorta a nominal 50 (riesgo 40)`,
    JSON.stringify(recBanco)
  );

  const valS = validarSaldo({
    cliente: { saldo_actual: 40, aval: 0, saldo_retenido: 0, libre: false },
    montoRequerido: 100,
    proporcion: "10/8",
    accion: "CONSIGUE",
  });
  si(valS.excedioSaldo && valS.montoEfectivo === 50, `validarSaldo para CONSIGUE 10/8 con saldo 40 recorta a 50`, JSON.stringify(valS));
}

console.log("\n=== 6. COMPATIBILIDAD PLANO WHATSAPP -> POBLAR TABLA Y LIQUIDACIÓN ===");
{
  const clientes = [{ nombre: "Wisky" }, { nombre: "Gareth" }, { nombre: "Benelli" }, { nombre: "Sanchez" }];
  const l1 = normalizarLineaRapida("1) Juega Benelli (3x5) con 1.000 da Sanchez", { clientes });
  si(
    l1?.ok === true && l1.jugada === "PP" && l1.caballo === "3X5" && l1.monto === "1000" && l1.cliente1 === "Benelli" && l1.cliente2 === "Sanchez",
    `Plano Match PP "1) Juega Benelli (3x5) con 1.000 da Sanchez" -> PP · 3X5 · 1000`,
    JSON.stringify(l1)
  );

  const l2 = normalizarLineaRapida("2) Juega Wisky 10/9.99 (3x5) con 10k da Gareth", { clientes });
  si(
    l2?.ok === true && l2.jugada === "10/9.99" && l2.caballo === "3X5" && l2.monto === "10000" && l2.cliente1 === "Wisky" && l2.cliente2 === "Gareth",
    `Plano Match 10/9.99 con 10k -> 10/9.99 · 3X5 · 10000`,
    JSON.stringify(l2)
  );

  const lgMatch = logicaGanancias({
    jugada: "10/8",
    caballo: "3X5",
    monto: 100,
    pizarra: ["3", "5", "1"],
    comisionPct: 5,
  });
  si(
    lgMatch.ganaJugador1 && lgMatch.netoJugador1 === 76 && lgMatch.netoJugador2 === -80,
    `Liquidación Match 10/8 (3X5) con 100 cuando gana el 3 -> Juega gana +80 bruto (+76 neto), Da pierde -80`,
    JSON.stringify(lgMatch)
  );
}

console.log("\n=== 7. REGLAS DE 'SE FUE' Y RESPUESTAS A PROPUESTA RETIRADA ===");
{
  for (const exacto of ["Se fue", "sefue", "sf", "s fue", "cf", "cfue", "c fue"]) {
    const cmd = analizarComandoRetiro(exacto);
    si(cmd.esComandoRetiro && cmd.esValido, `Comando exacto "${exacto}" es válido`);
  }
  for (const dudoso of ["se fu", "sefve", "se va", "retirar", "cancelar"]) {
    const cmd = analizarComandoRetiro(dudoso);
    si(
      cmd.esComandoRetiro &&
        !cmd.esValido &&
        cmd.mensajeAclaratoria === "Por favor aclara si deseas retirar tus jugadas con: 'Se fue', 'sf' o 'cf'",
      `Término ambiguo "${dudoso}" pide aclaratoria privada`
    );
  }
  for (const intento of ["jugaron", "jugaron 50", "j", "j 50", "voy", "voy 30", "jugaste", "ponte", "50", "10k", "por 50", "con 50"]) {
    si(
      esIntentoConcrecionOMontoParcial(intento),
      `Respuesta "${intento}" sobre propuesta retirada activa "🚫Nada aquí, Se fue."`
    );
  }
  si(!esIntentoConcrecionOMontoParcial("hola amigos"), `Charla casual "hola amigos" no se trata como intento de concreción`);
}

console.log(`\n${pasan} pasaron, ${fallan} fallaron`);
if (fallan > 0) process.exit(1);
