// ============================================================================
// AGENTE DE TAQUILLA — sintaxis simplificada, bloques, límites de saldo y pizarra
//
// Cubre las 5 reglas operativas:
//   1. "2y5" ≡ "2-5" y bloques "1p y 1/2" / "1p-1/2" → 1PY1Y2N (toda la familia).
//   2. Descuento progresivo y frases EXACTAS de límite de saldo.
//   3. Pizarra → anulación por variación → nueva pizarra (mensaje de WhatsApp).
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import assert from "node:assert";
import { normalizarBloquePuestos, normalizarEjemplaresCombinados } from "../src/features/taquilla/lib/nomenclatura";
import { TABLA_JUGADAS, logicaGanancias } from "../src/features/motores/lib/puestos";
import {
  parsearConcrecion,
  parsearMensajeJugada,
  resolverDobleJugada,
} from "../src/features/portal/lib/gramatica-concrecion-hipica";
import {
  concretar,
  crearMesa,
  disponibleDe,
  observacionesDeLimites,
  procesarMensajeMesa,
  proponer,
} from "../src/features/portal/lib/propuestas-puestos";
import {
  construirMensajeResultadosAgente,
  ejecutarComandoPizarra,
  ESTADO_PIZARRA_INICIAL,
  MENSAJE_PIZARRA_ANULADA,
  parsearComandoPizarra,
  type EstadoPizarraAgente,
  type PuertoPizarra,
} from "../src/features/liquidacion/lib/agente-pizarra";

let pasan = 0;
let fallan = 0;
function ok(nombre: string, condicion: boolean) {
  if (condicion) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}`);
  }
}
function igual(nombre: string, actual: unknown, esperado: unknown) {
  try {
    assert.deepStrictEqual(actual, esperado);
    pasan++;
    console.log(`  ok   ${nombre}`);
  } catch {
    fallan++;
    console.log(`  FALLA ${nombre}\n         actual:   ${JSON.stringify(actual)}\n         esperado: ${JSON.stringify(esperado)}`);
  }
}
const datos = (texto: string) => {
  const r = parsearMensajeJugada(texto);
  return r.ok ? r.datos : { error: r.faltante };
};

async function main() {
  // ==========================================================================
  console.log("\n[1] Sintaxis simplificada de ejemplares y jugadas en bloque");
  // ==========================================================================
  const esperadoDa = { rol: "DA", jugada: "1P", caballos: "2y5", monto: 300 };
  igual('"Consigo 1p de 2y5 con 300" → DA 1P 2y5 300', datos("Consigo 1p de 2y5 con 300"), esperadoDa);
  igual('"consigo 1p 2-5 300" → idéntico', datos("consigo 1p 2-5 300"), esperadoDa);
  igual('ambas expresiones son 100% equivalentes', datos("Consigo 1p de 2y5 con 300"), datos("consigo 1p 2-5 300"));
  igual('"juego 2p 3-4 500" → 2P 3y4', datos("juego 2p 3-4 500"), { rol: "JUEGA", jugada: "2P", caballos: "3y4", monto: 500 });
  igual('"juego 2p 3,4 500" (coma) → 3y4', datos("juego 2p 3,4 500"), { rol: "JUEGA", jugada: "2P", caballos: "3y4", monto: 500 });
  igual('"juego 1p y 1/2 del 5 con 300" → 1PY1Y2N', datos("juego 1p y 1/2 del 5 con 300"), {
    rol: "JUEGA",
    jugada: "1PY1Y2N",
    caballos: "5",
    monto: 300,
  });
  igual('"juego 1p-1/2 2-5 400" → 1PY1Y2N 2y5', datos("juego 1p-1/2 2-5 400"), {
    rol: "JUEGA",
    jugada: "1PY1Y2N",
    caballos: "2y5",
    monto: 400,
  });
  igual('normalizarEjemplaresCombinados("de 2 y 5") → 2y5', normalizarEjemplaresCombinados("de 2 y 5"), {
    ok: true,
    caballos: "2y5",
    lista: [2, 5],
  });
  ok('"2 5" (solo espacio) es ambiguo y se rechaza', !normalizarEjemplaresCombinados("2 5").ok);

  // Familia completa de bloques (forma "A y B" y forma "A-B").
  const BLOQUES: Array<[string, string, string]> = [
    ["1p", "1/2", "1PY1Y2N"],
    ["1/2", "2n", "1Y2NY2N"],
    ["2n", "2/2", "2NY2Y2N"],
    ["2/2", "2p", "2Y2NY2P"],
    ["2p", "2/3", "2PY2Y3N"],
    ["2/3", "3n", "2Y3NY3N"],
    ["3n", "3/3", "3NY3Y3N"],
    ["3/3", "3p", "3Y3NY3P"],
    ["3p", "3/4", "3PY3Y4N"],
    ["3/4", "4n", "3Y4NY4N"],
    ["4n", "4/4", "4NY4Y4N"],
    ["4/4", "4p", "4Y4NY4P"],
    ["4p", "4/5", "4PY4Y5N"],
    ["4/5", "5n", "4Y5NY5N"],
    ["5n", "5/5", "5NY5Y5N"],
    ["5/5", "5p", "5Y5NY5P"],
    ["5p", "5/6", "5PY5Y6N"],
    ["5/6", "6n", "5Y6NY6N"],
    ["6p", "6/7", "6PY6Y7N"],
    ["6/7", "7n", "6Y7NY7N"],
  ];
  let bloquesOk = true;
  for (const [a, b, codigo] of BLOQUES) {
    const conY = normalizarBloquePuestos(`${a} y ${b}`);
    const conGuion = normalizarBloquePuestos(`${a}-${b}`);
    const frase = parsearMensajeJugada(`juego ${a} y ${b} del 5 con 300`);
    const bien =
      conY.ok && conY.codigo === codigo &&
      conGuion.ok && conGuion.codigo === codigo &&
      Boolean(TABLA_JUGADAS[codigo]) &&
      frase.ok && frase.datos.jugada === codigo;
    if (!bien) {
      bloquesOk = false;
      console.log(`         bloque con problema: ${a} / ${b} → ${codigo}`);
    }
  }
  ok("los 20 bloques de la tabla (A y B · A-B · frase completa) dan el código oficial de TABLA_JUGADAS", bloquesOk);

  // Dos jugadas independientes: se pregunta el reparto.
  const doble = parsearMensajeJugada("juego 1p y 3p del 5 con 200");
  ok('"1p y 3p" no es un bloque: pide confirmar el reparto', !doble.ok && doble.faltante === "DOBLE_JUGADA");
  ok(
    "la aclaratoria ofrece 200 en total (100 y 100) o 200 cada una",
    !doble.ok && doble.aclaratoria.includes("200") && doble.aclaratoria.includes("100")
  );
  if (!doble.ok && doble.doble) {
    igual(
      "TOTAL reparte 100 y 100",
      resolverDobleJugada(doble.doble, "TOTAL").map((d) => [d.jugada, d.monto]),
      [["1P", 100], ["3P", 100]]
    );
    igual(
      "CADA_UNA pone 200 en cada una",
      resolverDobleJugada(doble.doble, "CADA_UNA").map((d) => [d.jugada, d.monto]),
      [["1P", 200], ["3P", 200]]
    );
  } else {
    ok("la doble jugada trae el detalle para repartir", false);
  }

  // Aclaratorias: NO inventa.
  const sinMontoNiEjemplar = parsearMensajeJugada("juego 1p");
  ok('"juego 1p" → pide ejemplar y monto', !sinMontoNiEjemplar.ok && sinMontoNiEjemplar.faltante === "EJEMPLAR_Y_MONTO");
  const unSoloNumero = parsearMensajeJugada("juego 1p 300");
  ok('"juego 1p 300" → ambiguo (¿ejemplar o monto?), no registra a ciegas', !unSoloNumero.ok && unSoloNumero.faltante === "AMBIGUO");
  const sinJugada = parsearMensajeJugada("juego del 5 con 300");
  ok('"juego del 5 con 300" → pide la jugada', !sinJugada.ok && sinJugada.faltante === "JUGADA");
  const varios = parsearMensajeJugada("juego 1p 2 5 300");
  ok('"juego 1p 2 5 300" (números sueltos) → ambiguo', !varios.ok && varios.faltante === "AMBIGUO");
  const montoComoEjemplar = parsearMensajeJugada("juego 1p 300 5");
  ok('"juego 1p 300 5" (monto antes del ejemplar) → ambiguo', !montoComoEjemplar.ok && montoComoEjemplar.faltante === "AMBIGUO");
  const sinRol = parsearMensajeJugada("1p 2-5 300");
  ok("sin «juego/consigo» pregunta el rol", !sinRol.ok && sinRol.faltante === "ROL");
  ok("la aclaratoria nombra el dato que falta", !sinMontoNiEjemplar.ok && /ejemplar/i.test(sinMontoNiEjemplar.aclaratoria) && /monto/i.test(sinMontoNiEjemplar.aclaratoria));

  ok('concreción "J"', parsearConcrecion("J").ok);
  ok('concreción "Ponte"', parsearConcrecion("Ponte").ok);
  ok('concreción "Jugué"', parsearConcrecion("Jugué").ok);
  ok('concreción "Jugaste"', parsearConcrecion("Jugaste").ok);
  igual('concreción con monto "ponte 400"', parsearConcrecion("ponte 400"), { ok: true, monto: 400 });
  ok('"juego 1p 5 300" NO es una concreción', !parsearConcrecion("juego 1p 5 300").ok);

  // ==========================================================================
  console.log("\n[2] Descuento progresivo y frases exactas de límite de saldo");
  // ==========================================================================
  const propo = (mesa: ReturnType<typeof crearMesa>, autor: string, monto: number, rol: "JUEGA" | "DA" = "JUEGA") =>
    proponer(mesa, { autor, rol, jugada: "1P", caballos: "5", monto });

  // 2.1 Pedro (500) propone 700 → publica 500.
  const r1 = propo(crearMesa({ Pedro: 500, Juan: 1000 }), "Pedro", 700);
  igual("Pedro propone 700 con disponible 500 → publica 500", r1.propuesta?.montoAbierto, 500);
  igual('aviso exacto: Atento "Pedro", disponible 500', r1.mensajes, ['Atento "Pedro", disponible 500']);
  igual("el exceso nunca se publica y Pedro queda en 0", disponibleDe(r1.estado, "Pedro"), 0);

  // 2.1b Lo mismo dictado en lenguaje natural.
  const rTxt = procesarMensajeMesa(crearMesa({ Pedro: 500 }), { jugador: "Pedro", texto: "juego 1p del 5 con 700" });
  igual("dictado «juego 1p del 5 con 700» → publica 500 y avisa", [rTxt.monto, rTxt.mensajes], [500, ['Atento "Pedro", disponible 500']]);

  // 2.2 Descuento en caliente: concreta 400 → queda 100.
  let mesa = crearMesa({ Pedro: 500, Juan: 1000 });
  mesa = propo(mesa, "Juan", 400, "DA").estado;
  const rConc = concretar(mesa, { jugador: "Pedro" });
  igual("Pedro concreta 400 y no hay mensaje de límite", [rConc.monto, rConc.mensajes], [400, []]);
  igual("el disponible de Pedro baja en el acto a 100 (500 - 400)", disponibleDe(rConc.estado, "Pedro"), 100);
  igual("la concreción toma el lado contrario al autor", [rConc.concrecion?.rolAutor, rConc.concrecion?.rolJugador], ["DA", "JUEGA"]);

  // 2.3 En otra propuesta de 300 concreta con sus 100 restantes → 'Pedro hasta 100'.
  mesa = propo(rConc.estado, "Juan", 300, "DA").estado;
  const rHasta = concretar(mesa, { jugador: "Pedro" });
  igual("Pedro concreta solo 100 de los 300", rHasta.monto, 100);
  igual("mensaje exacto: Pedro hasta 100", rHasta.mensajes, ["Pedro hasta 100"]);
  igual("Pedro queda con disponible 0", disponibleDe(rHasta.estado, "Pedro"), 0);
  igual("quedan 200 abiertos en la propuesta", rHasta.propuesta?.montoAbierto, 200);

  // 2.4 Sin saldo: bloquea proponer y concretar.
  const rBloqProponer = propo(rHasta.estado, "Pedro", 50);
  igual("Pedro (0) no puede proponer: «Pedro sin saldo disponible»", rBloqProponer.mensajes, ["Pedro sin saldo disponible"]);
  ok("la propuesta bloqueada no se publica", rBloqProponer.bloqueado && !rBloqProponer.ok && rBloqProponer.estado.propuestas.length === rHasta.estado.propuestas.length);
  const rBloqConcretar = concretar(rHasta.estado, { jugador: "Pedro" });
  igual("Pedro (0) no puede concretar: «Pedro sin saldo disponible»", rBloqConcretar.mensajes, ["Pedro sin saldo disponible"]);
  ok("la concreción bloqueada no mueve el estado", rBloqConcretar.bloqueado && rBloqConcretar.estado.concreciones.length === rHasta.estado.concreciones.length);

  // 2.5 Ejemplo del enunciado: propuesta de 500 y Juan con 300 responde "J".
  let mesa2 = crearMesa({ Pedro: 500, Juan: 300 });
  mesa2 = propo(mesa2, "Pedro", 500).estado;
  const rJuan = procesarMensajeMesa(mesa2, { jugador: "Juan", texto: "J" });
  igual("Juan responde J con 300: amarra 300", rJuan.monto, 300);
  igual("mensaje exacto: Juan hasta 300", rJuan.mensajes, ["Juan hasta 300"]);
  igual("quedan 200 abiertos en la propuesta", rJuan.propuesta?.montoAbierto, 200);
  igual("los límites alcanzados viajan a las observaciones del reporte", observacionesDeLimites(rJuan.estado), "Juan hasta 300");
  const rPonte = procesarMensajeMesa(crearMesa({ Pedro: 500, Juan: 1000 }), { jugador: "Juan", texto: "Ponte" });
  igual("sin propuesta abierta no inventa nada", rPonte.ok, false);
  const rAclara = procesarMensajeMesa(crearMesa({ Pedro: 500 }), { jugador: "Pedro", texto: "juego 1p 300" });
  ok("un dictado ambiguo devuelve la aclaratoria y NO publica", !rAclara.ok && rAclara.estado.propuestas.length === 0 && rAclara.mensajes[0].includes("300"));

  // ==========================================================================
  console.log("\n[3] Ciclo de pizarra → anulación por variación → nueva pizarra");
  // ==========================================================================
  const saldos: Record<string, number> = { Pedro: 1000, Juan: 1000 };
  const aplicados: Array<{ nombre: string; delta: number }> = [];
  const redondear = (n: number) => Math.round(n * 100) / 100;
  const aplicar = (nombre: string, delta: number) => {
    saldos[nombre] = redondear(saldos[nombre] + delta);
    aplicados.push({ nombre, delta });
  };
  let reabiertas = 0;
  const OBSERVACION = "Juan hasta 300";

  // Libro en memoria sobre el MISMO motor de puestos que usa la liquidación.
  const puerto: PuertoPizarra = {
    async liquidar(llegada) {
      const g = logicaGanancias({ jugada: "1P", caballo: "5", monto: 400, pizarra: llegada, comisionPct: 5 });
      aplicar("Pedro", g.netoJugador1);
      aplicar("Juan", g.netoJugador2);
      return { ok: true };
    },
    async reversar() {
      for (const a of aplicados.splice(0).reverse()) saldos[a.nombre] = redondear(saldos[a.nombre] - a.delta);
      reabiertas++;
      return { ok: true };
    },
    async mensajeResultados(_llegada, pizarra) {
      return construirMensajeResultadosAgente({
        hipodromo: "LA RINCONADA",
        carrera: 3,
        fecha: "2026-10-29",
        grupo: "GRUPO PRUEBA",
        pizarra,
        tickets: [{ comando: "400 1P", monto: 400, caballo: "5", cliente1: "Pedro", cliente2: "Juan" }],
        tasaComision: 5,
        observaciones: OBSERVACION,
        saldosFinales: { ...saldos },
      });
    },
  };

  igual("«Pizarra: 5 - 2 - 8 - 1 - 4»", parsearComandoPizarra("Pizarra: 5 - 2 - 8 - 1 - 4"), {
    tipo: "LIQUIDAR", nueva: false, llegada: ["5", "2", "8", "1", "4"],
  });
  igual("«Llegada 5,2,8,1,4»", parsearComandoPizarra("Llegada 5,2,8,1,4"), {
    tipo: "LIQUIDAR", nueva: false, llegada: ["5", "2", "8", "1", "4"],
  });
  igual("«Oficial C3: 1° 5, 2° 2, 3° 8, 4° 1, 5° 4»", parsearComandoPizarra("Oficial C3: 1° 5, 2° 2, 3° 8, 4° 1, 5° 4"), {
    tipo: "LIQUIDAR", nueva: false, llegada: ["5", "2", "8", "1", "4"], carrera: 3,
  });
  igual("«Nueva pizarra: 2 - 5 - 8 - 1 - 4»", parsearComandoPizarra("Nueva pizarra: 2 - 5 - 8 - 1 - 4"), {
    tipo: "LIQUIDAR", nueva: true, llegada: ["2", "5", "8", "1", "4"],
  });
  igual("«Anular pizarra por variación»", parsearComandoPizarra("Anular pizarra por variación").tipo, "ANULAR");
  igual("«Reversar pizarra»", parsearComandoPizarra("Reversar pizarra").tipo, "ANULAR");
  igual("charla normal no es comando", parsearComandoPizarra("juego 1p del 5 con 300").tipo, "NINGUNO");
  igual("llegada con ejemplar repetido es inválida", parsearComandoPizarra("Pizarra: 5-5-8").tipo, "INVALIDO");
  igual("llegada con menos de 3 puestos es inválida", parsearComandoPizarra("Pizarra: 5-2").tipo, "INVALIDO");

  let estado: EstadoPizarraAgente = ESTADO_PIZARRA_INICIAL;

  // 3.1 Pizarra 5-2-8-1-4 → gana el #5.
  const p1 = await ejecutarComandoPizarra("Pizarra: 5-2-8-1-4", puerto, estado);
  estado = p1.estado;
  ok("liquida la pizarra", p1.ok && p1.accion === "LIQUIDADA" && estado.liquidada);
  igual("Pedro sube a 1380 (gana 400 − 5% de comisión)", saldos.Pedro, 1380);
  igual("Juan baja a 600", saldos.Juan, 600);
  const wa1 = p1.mensajeWhatsapp ?? "";
  ok("entrega el mensaje de WhatsApp de resultados", wa1.length > 0);
  ok("el mensaje trae la pizarra oficial 5-2-8-1-4", wa1.includes("5-2-8-1-4"));
  ok("el mensaje trae el resumen 🟢 POSITIVOS (+) y 🔴 NEGATIVOS (-)", wa1.includes("POSITIVOS (+)") && wa1.includes("NEGATIVOS (-)"));
  ok("Pedro figura en POSITIVOS con +380", /POSITIVOS[\s\S]*Pedro \+380/.test(wa1));
  ok("Juan figura en NEGATIVOS con -400", /NEGATIVOS[\s\S]*Juan -400/.test(wa1));
  ok("el mensaje trae la observación de límite «Juan hasta 300»", wa1.includes(OBSERVACION));
  ok("el mensaje cierra con el bloque *💰 SALDOS* actualizado (Pedro 1380 · Juan 600)", wa1.includes("*💰 SALDOS*") && /Pedro 1\.?380/.test(wa1) && /Juan 600/.test(wa1));
  ok("los incentivos no aparecen en el resumen de jugadas", !/incentivo/i.test(wa1));

  // 3.1b Repetir la pizarra sin anular no vuelve a pagar.
  const pRepe = await ejecutarComandoPizarra("Pizarra: 5-2-8-1-4", puerto, estado);
  ok("una pizarra ya liquidada no se paga dos veces", !pRepe.ok && pRepe.accion === "RECHAZADA" && saldos.Pedro === 1380 && saldos.Juan === 600);

  // 3.2 Anular por variación → todo vuelve al estado previo.
  const pAnula = await ejecutarComandoPizarra("Anular pizarra por variación", puerto, estado);
  estado = pAnula.estado;
  ok("anula la pizarra", pAnula.ok && pAnula.accion === "ANULADA" && !estado.liquidada && reabiertas === 1);
  igual("mensaje exacto de anulación", pAnula.respuesta, MENSAJE_PIZARRA_ANULADA);
  igual("Pedro vuelve a 1000", saldos.Pedro, 1000);
  igual("Juan vuelve a 1000", saldos.Juan, 1000);
  const pAnulaVacia = await ejecutarComandoPizarra("Anular pizarra por variación", puerto, estado);
  ok("sin pizarra liquidada no hay nada que anular", !pAnulaVacia.ok && saldos.Pedro === 1000);

  // 3.3 Nueva pizarra 2-5-8-1-4: el 5 queda 2° → pierde el 1P.
  const p2 = await ejecutarComandoPizarra("Nueva pizarra: 2-5-8-1-4", puerto, estado);
  estado = p2.estado;
  ok("liquida la pizarra rectificada", p2.ok && estado.liquidada && estado.llegada?.join("-") === "2-5-8-1-4");
  igual("Pedro baja a 600", saldos.Pedro, 600);
  igual("Juan sube a 1380", saldos.Juan, 1380);
  const wa2 = p2.mensajeWhatsapp ?? "";
  ok("entrega el nuevo mensaje de WhatsApp rectificado (2-5-8-1-4)", wa2.includes("2-5-8-1-4") && !wa2.includes("5-2-8-1-4"));
  ok("Juan pasa a POSITIVOS con +380 y Pedro a NEGATIVOS con -400", /POSITIVOS[\s\S]*Juan \+380/.test(wa2) && /NEGATIVOS[\s\S]*Pedro -400/.test(wa2));
  ok("el nuevo bloque de saldos refleja Pedro 600 · Juan 1380", /Pedro 600/.test(wa2) && /Juan 1\.?380/.test(wa2));

  // 3.4 «Nueva pizarra» sobre una pizarra vigente: revierte sola y recalcula sobre saldos limpios.
  const p3 = await ejecutarComandoPizarra("Nueva pizarra: 5-2-8-1-4", puerto, estado);
  estado = p3.estado;
  ok("rectifica sin pasos intermedios", p3.ok && p3.accion === "RELIQUIDADA" && reabiertas === 2);
  igual("Pedro 1380 (saldos limpios + nuevo resultado, sin doble pago)", saldos.Pedro, 1380);
  igual("Juan 600", saldos.Juan, 600);
  igual("la suma de saldos se conserva (juego de suma cero menos comisión)", redondear(saldos.Pedro + saldos.Juan), 1980);

  // 3.5 Fallas del puerto: no cambian el estado.
  const puertoRoto: PuertoPizarra = {
    ...puerto,
    async liquidar() {
      return { ok: false, error: "sin conexión" };
    },
  };
  const pFalla = await ejecutarComandoPizarra("Pizarra: 1-2-3", puertoRoto, ESTADO_PIZARRA_INICIAL);
  ok("si falla la liquidación lo informa y no marca la carrera como liquidada", !pFalla.ok && !pFalla.estado.liquidada && pFalla.respuesta.includes("sin conexión"));

  console.log("\n" + "=".repeat(76));
  console.log(`AGENTE BLOQUES, LÍMITES Y PIZARRA: ${pasan} ok / ${fallan} fallaron`);
  if (fallan > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
