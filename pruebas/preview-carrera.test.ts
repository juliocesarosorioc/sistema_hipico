// ============================================================================
// BLOQUE 2 — PRE-VISUALIZACIÓN PERMANENTE DE JUGADAS CARGADAS.
//
// El panel debe mostrar SIEMPRE las jugadas de la carrera que ya están en la
// base, no solo las de la sesión:
//   · las persistidas llevan ✅ Validada / Cargada;
//   · las ventas de sesión se fusionan sin duplicarse;
//   · tabla fija / marca / dupleta / remate / polla no entran al panel;
//   · el resultado muestra premio (Ganador) o saldo en contra (Perdedor).
//
// Corre con: node pruebas/correr.cjs
// ============================================================================
import {
  armarFilasPreview,
  esJugadaDeTaquilla,
  estadoLiquidacionDe,
  jugadaSinMonto,
  resumenPreview,
  type JugadaPersistida,
  type TicketSesion,
} from "../src/features/gestion/lib/preview-carrera";
import {
  generarTextoPrejugadasWhatsapp,
  generarTextoSaldosWhatsapp,
} from "../src/features/liquidacion/lib/reporte-imagen";
import { relacionResultados } from "../src/features/impresion/lib/reportGenerator";
import { jugadaInvolucraRetirado } from "../src/features/carreras/lib/retiros-nucleo";
import { anularJugadasMesaPorRetiro, crearMesa, proponer } from "../src/features/portal/lib/propuestas-puestos";
import { liquidarOficial } from "../src/features/motores/lib/oficiales";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => { pasan++; console.log(`  ok   ${m}`); };
const mal = (m: string, d?: string) => { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };
const si = (c: boolean, m: string, d?: string) => (c ? ok(m) : mal(m, d));
const igual = (a: unknown, b: unknown, m: string) =>
  si(JSON.stringify(a) === JSON.stringify(b), m, `esperado ${JSON.stringify(b)} · recibido ${JSON.stringify(a)}`);

console.log("\nBLOQUE 2 — pre-visualización permanente (núcleo puro)");

// ── 1. Clasificación de jugadas ────────────────────────────────────────────
si(esJugadaDeTaquilla("2P"), "una jugada de puestos es de taquilla");
si(esJugadaDeTaquilla("100 W"), "WPS es de taquilla");
si(!esJugadaDeTaquilla("TABLA FIJA (HIPO C4)"), "la tabla fija no es de taquilla");
si(!esJugadaDeTaquilla("MARCA 8"), "la marca no es de taquilla");
si(!esJugadaDeTaquilla("DUPLETA 3-5"), "la dupleta no es de taquilla");
si(!esJugadaDeTaquilla("REMATE LOTE 1"), "el remate no es de taquilla");
si(!esJugadaDeTaquilla("POLLA 123"), "la polla no es de taquilla");
si(!esJugadaDeTaquilla(""), "una jugada vacía no entra al panel");

igual(jugadaSinMonto("100 2P"), "2P", "se quita el monto del comando");
igual(jugadaSinMonto("2P"), "2P", "un comando sin monto queda igual");

// ── 2. Persistidas: siempre visibles y validadas ───────────────────────────
const persistida = (over: Partial<JugadaPersistida> = {}): JugadaPersistida => ({
  id: "101",
  nombre_jugada: "2P",
  caballo: "7",
  monto_jugado: 100,
  estado: "Pendiente",
  cliente_juega_nombre: "ANA",
  cliente_consigue_nombre: "LUIS",
  ...over,
});

const filasBase = armarFilasPreview([persistida()], []);
igual(filasBase.length, 1, "una jugada persistida se pinta aunque la sesión esté vacía");
si(filasBase[0].validada, "la jugada persistida lleva ✅ Validada");
si(!filasBase[0].soloSesion, "la jugada persistida no es solo de sesión");
igual(filasBase[0].cliente1, "ANA", "conserva el cliente que juega");
igual(filasBase[0].cliente2, "LUIS", "conserva el cliente que da");
igual(filasBase[0].jugada, "2P", "conserva la nomenclatura");

// ── 3. Fusion con la sesión sin duplicar ───────────────────────────────────
const ticketSesion = (over: Partial<TicketSesion> = {}): TicketSesion => ({
  id: "s-1",
  comando: "100 2P",
  monto: 100,
  caballo: "7",
  cliente1: "ANA",
  cliente2: "LUIS",
  ticketId: 101,
  cobro1: 250,
  cobro2: 0,
  gananciaProyectada: 150,
  ...over,
});

const fusion = armarFilasPreview([persistida()], [ticketSesion()]);
igual(fusion.length, 1, "el ticket de sesión que ya está en la base no se duplica");
igual(fusion[0].ticketId, "101", "la fila fusionada conserva el id del ticket");
igual(fusion[0].premioSaldo, 150, "la proyección de la sesión completa la fila pendiente");
si(fusion[0].esPremio, "la proyección positiva se pinta como premio");

const soloSesion = armarFilasPreview([], [ticketSesion({ ticketId: undefined })]);
igual(soloSesion.length, 1, "una venta que aún no se refleja en la base se pinta");
si(!soloSesion[0].validada, "una venta sin ticketId no está validada");
si(soloSesion[0].soloSesion, "se marca como solo de sesión");
igual(soloSesion[0].monto, 100, "conserva el monto");

const ventaConId = armarFilasPreview([], [ticketSesion({ ticketId: 500 })]);
si(ventaConId[0].validada, "una venta de sesión con ticketId ya está validada");

// ── 4. Modalidades adelantadas clasificadas en el panel ────────────────────
const especiales = armarFilasPreview(
  [
    persistida({ id: "1", nombre_jugada: "TABLA FIJA (HIPO C4)" }),
    persistida({ id: "2", nombre_jugada: "MARCA 8" }),
    persistida({ id: "3", nombre_jugada: "DUPLETA 1-2" }),
    persistida({ id: "4", nombre_jugada: "REMATE LOTE 1" }),
    persistida({ id: "5", nombre_jugada: "POLLA 9" }),
    persistida({ id: "6", nombre_jugada: "2N" }),
  ],
  []
);
const enVivoEspeciales = especiales.filter((f) => !f.esAdelantada);
const adelantadasEspeciales = especiales.filter((f) => f.esAdelantada);
igual(enVivoEspeciales.length, 1, "solo la jugada de taquilla en vivo (2N) entra a Jugadas en Vivo");
igual(enVivoEspeciales[0].jugada, "2N", "la jugada en vivo que queda es 2N");
igual(adelantadasEspeciales.length, 5, "las 5 jugadas adelantadas entran a JUGADAS ADELANTADAS (PRE-JUGADAS)");

// ── 5. Resultado: premio vs saldo ──────────────────────────────────────────
const ganador = armarFilasPreview([persistida({ estado: "Ganador", premio_pagar: 320 })], []);
igual(ganador[0].estado, "Ganador", "el estado Ganador se normaliza");
igual(ganador[0].premioSaldo, 320, "el ganador muestra el premio");
si(ganador[0].esPremio, "el premio se pinta en positivo");

const perdedor = armarFilasPreview([persistida({ estado: "Perdedor", premio_pagar: 0 })], []);
igual(perdedor[0].estado, "Perdedor", "el estado Perdedor se normaliza");
igual(perdedor[0].premioSaldo, -100, "el perdedor muestra el saldo en contra");
si(!perdedor[0].esPremio, "el saldo en contra se pinta en negativo");

const retirado = armarFilasPreview([persistida({ estado: "Retirado" })], []);
igual(retirado[0].estado, "Retirado", "el retirado se normaliza");
igual(retirado[0].premioSaldo, 0, "el retirado no suma premio ni saldo");

const anulada = armarFilasPreview([persistida({ anulada: true, estado: "Pendiente" })], []);
igual(anulada[0].estado, "Anulada", "la anulada gana sobre el estado crudo");
si(anulada[0].anulada, "la fila anulada queda marcada");
igual(anulada[0].premioSaldo, 0, "la anulada no proyecta dinero");

const pendienteSinSesion = armarFilasPreview([persistida()], []);
si(!pendienteSinSesion[0].tieneProyeccion, "una pendiente sin sesión no inventa proyección");

// ── 6. Resumen del panel ───────────────────────────────────────────────────
const resumen = resumenPreview(
  armarFilasPreview(
    [persistida({ id: "1", monto_jugado: 100 }), persistida({ id: "2", monto_jugado: 50, estado: "Ganador", premio_pagar: 80 })],
    [ticketSesion({ id: "s-9", ticketId: undefined, monto: 25 })]
  )
);
igual(resumen.jugadas, 3, "el resumen cuenta todas las filas");
igual(resumen.validadas, 2, "el resumen cuenta las validadas");
igual(resumen.soloSesion, 1, "el resumen cuenta las que solo están en sesión");
igual(resumen.monto, 175, "el resumen suma los montos");

// Una ANULADA no suma al monto del panel (capital devuelto), pero sí se cuenta
// como jugada (está en la lista).
const resumenConAnulada = resumenPreview(
  armarFilasPreview(
    [
      persistida({ id: "1", monto_jugado: 100 }),
      persistida({ id: "2", monto_jugado: 999, anulada: true }),
    ],
    []
  )
);
igual(resumenConAnulada.jugadas, 2, "la anulada cuenta como jugada en el panel");
igual(resumenConAnulada.monto, 100, "la anulada NO suma al monto del panel");

// ── 7. Símbolo ✅/✖ y saldo por CADA jugador ───────────────────────────────
// El dueño pidió que, a la derecha de cada nombre, se vea si ese jugador ganó
// (✅) o perdió (✖) y su saldo: lo que ARRIESGA si la carrera no está liquidada,
// o lo que GANÓ/PERDIÓ si ya lo está.
{
  // Carrera PENDIENTE: ambos arriesgan el monto, sin símbolo.
  const pend = armarFilasPreview([persistida()], []);
  igual(pend[0].lado1.estado, "ARRIESGA", "pendiente: el que juega arriesga");
  igual(pend[0].lado2.estado, "ARRIESGA", "pendiente: el que da arriesga");
  igual(pend[0].lado1.monto, 100, "pendiente: arriesga el monto");
  si(!pend[0].lado1.liquidada, "pendiente: el resultado no es definitivo");

  // GANADOR: el que juega gana el NETO (premio bruto − comisión − monto).
  const gan = armarFilasPreview(
    [persistida({ estado: "Ganador", premio_pagar: 320, comision_porcentaje: 10 })],
    []
  );
  igual(gan[0].lado1.estado, "GANO", "ganador: el que juega GANÓ");
  // ganancia bruta = 220 · comisión 10% = 22 · neto = 220 − 22 = 198
  igual(gan[0].lado1.monto, 198, "ganador: gana el neto (bruto − comisión)");
  igual(gan[0].lado1.signo, 1, "ganador: saldo positivo");
  si(gan[0].lado1.liquidada, "ganador: resultado definitivo");
  igual(gan[0].lado2.estado, "PERDIO", "ganador: el que da PERDIÓ");
  igual(gan[0].lado2.monto, 220, "ganador: el que da entrega la ganancia bruta");

  // GANADOR sin premio cargado (break-even): sigue siendo ✅ — antes se pintaba
  // como perdedor "y no se le pagaba al ganador".
  const ganSinPremio = armarFilasPreview([persistida({ estado: "Ganador", premio_pagar: 0 })], []);
  igual(ganSinPremio[0].lado1.estado, "GANO", "ganador sin premio: sigue siendo ganador");
  igual(ganSinPremio[0].lado1.monto, 0, "ganador sin premio: gana 0 (no pierde)");

  // PERDEDOR: el que juega pierde el monto; el que da cobra el monto menos comisión.
  const per = armarFilasPreview(
    [persistida({ estado: "Perdedor", premio_pagar: 0, comision_porcentaje: 10 })],
    []
  );
  igual(per[0].lado1.estado, "PERDIO", "perdedor: el que juega PERDIÓ");
  igual(per[0].lado1.monto, 100, "perdedor: pierde el monto");
  igual(per[0].lado1.signo, -1, "perdedor: saldo en contra");
  igual(per[0].lado2.estado, "GANO", "perdedor: el que da GANÓ");
  igual(per[0].lado2.monto, 90, "perdedor: el que da cobra el monto menos la comisión");

  // ANULADA / RETIRADO: sin símbolo ni saldo.
  const anu = armarFilasPreview([persistida({ anulada: true, estado: "Pendiente" })], []);
  igual(anu[0].lado1.estado, "ANULADA", "anulada: el que juega queda anulado");
  igual(anu[0].lado1.monto, 0, "anulada: no proyecta dinero");
  igual(anu[0].lado2.estado, "ANULADA", "anulada: el que da queda anulado");

  const ret = armarFilasPreview([persistida({ estado: "Retirado" })], []);
  igual(ret[0].lado1.estado, "RETIRADO", "retirado: el que juega queda retirado");

  // Una pendiente con proyección de la sesión NO anticipa ganador/perdedor: la
  // carrera todavía no se liquidó, así que se sigue mostrando el monto en riesgo.
  const proy = armarFilasPreview([persistida({ comision_porcentaje: 10 })], [ticketSesion({ cobro1: 250 })]);
  igual(proy[0].lado1.estado, "ARRIESGA", "pendiente con proyección: NO se anticipa ganador");
  igual(proy[0].lado1.monto, 100, "pendiente con proyección: muestra el monto en riesgo");
  si(!proy[0].lado1.liquidada, "pendiente con proyección: no es definitivo");
}

// ── 8. Columna «Estado»: SOLO Liquidada / Pendiente / Anulada ──────────────
// El panel no debe mostrar Ganador ni Perdedor en la columna de estado: eso se
// refleja en las columnas de cliente (✅/✖ + saldo).
{
  igual(estadoLiquidacionDe("Ganador"), "Liquidada", "un Ganador ya está Liquidada");
  igual(estadoLiquidacionDe("Perdedor"), "Liquidada", "un Perdedor ya está Liquidada");
  igual(estadoLiquidacionDe("Retirado"), "Liquidada", "un Retirado se resolvió: Liquidada");
  igual(estadoLiquidacionDe("Pendiente"), "Pendiente", "una jugada sin decidir está Pendiente");
  igual(estadoLiquidacionDe("Anulada"), "Anulada", "una jugada anulada se muestra Anulada");

  const filas = armarFilasPreview(
    [
      persistida({ id: "1", estado: "Ganador", premio_pagar: 300 }),
      persistida({ id: "2", estado: "Perdedor" }),
      persistida({ id: "3", estado: "Pendiente" }),
      persistida({ id: "4", anulada: true }),
    ],
    []
  );
  igual(filas.map((f) => f.estadoLiquidacion), ["Liquidada", "Liquidada", "Pendiente", "Anulada"],
    "la columna Estado resume el ciclo de vida, nunca ganó/perdió");
  si(!filas.some((f) => /Ganador|Perdedor/.test(f.estadoLiquidacion)), "nunca aparece Ganador/Perdedor en el estado");
}

// ── 9. Empate NINI (2N en 2°, 3N en 3°), Tablas Fijas (TF) y Marcas (5/6) ──
{
  // Empate NINI: 2N llega 2° -> 0 / 0 (RETIRADO / Empate), ni gana ni pierde nadie
  const empateNini = armarFilasPreview(
    [persistida({ id: "n1", nombre_jugada: "2N", caballo: "4", monto_jugado: 1000, estado: "Perdedor", premio_pagar: 1000, comision_porcentaje: 5 })],
    [],
    ["7", "4", "1", "2", "5"]
  );
  igual(empateNini[0].estado, "Retirado", "2N en 2° puesto se corrige a Retirado (Empate 0/0)");
  igual(empateNini[0].lado1.estado, "RETIRADO", "2N en 2° puesto: lado1 es RETIRADO (0)");
  igual(empateNini[0].lado2.estado, "RETIRADO", "2N en 2° puesto: lado2 es RETIRADO (0)");
  igual(empateNini[0].lado1.monto, 0, "2N en 2° puesto: lado1 monto 0");
  igual(empateNini[0].lado2.monto, 0, "2N en 2° puesto: lado2 monto 0");

  // Tabla Fija (TF): Jugador apuesta 100, premio 500, comisión 5%
  const tfPierde = armarFilasPreview(
    [persistida({ id: "tf1", nombre_jugada: "TABLA FIJA", caballo: "3", monto_jugado: 100, premio_pagar: 500, estado: "Perdedor", cliente_consigue_nombre: "", comision_porcentaje: 5 })],
    []
  );
  igual(tfPierde[0].cliente2, "TF", "Tabla Fija sin contraparte asignada usa TF");
  igual(tfPierde[0].aposto1, 100, "Tabla Fija: jugador apostó 100");
  igual(tfPierde[0].aposto2, 500, "Tabla Fija: TF arriesga el premio a pagar (500)");
  igual(tfPierde[0].lado1.monto, 100, "Tabla Fija perdedora: jugador pierde 100");
  igual(tfPierde[0].lado2.monto, 95, "Tabla Fija perdedora: TF gana 100 menos 5% comisión (95)");

  const tfGana = armarFilasPreview(
    [persistida({ id: "tf2", nombre_jugada: "TABLA FIJA", caballo: "7", monto_jugado: 100, premio_pagar: 500, estado: "Ganador", cliente_consigue_nombre: "BANCA_TF", comision_porcentaje: 5 })],
    []
  );
  igual(tfGana[0].cliente2, "TF", "Tabla Fija imputa siempre al usuario del sistema TF");
  igual(tfGana[0].lado1.monto, 500, "Tabla Fija ganadora: jugador gana 500 íntegros");
  igual(tfGana[0].lado2.monto, 525, "Tabla Fija ganadora: TF pierde 500 más 5% comisión (525)");

  // Marcas (proporción 5/6): Jugador juega 6, paga 5, comisión 5%
  const marcaGana = armarFilasPreview(
    [persistida({ id: "m1", nombre_jugada: "MARCA 1", caballo: "1", monto_jugado: 6, premio_pagar: 11, estado: "Ganador", cliente_consigue_nombre: "", comision_porcentaje: 5 })],
    []
  );
  igual(marcaGana[0].cliente2, "MARCAS", "Marca sin contraparte asignada usa MARCAS");
  igual(marcaGana[0].aposto1, 6, "Marca: jugador apostó 6");
  igual(marcaGana[0].aposto2, 5, "Marca: Marcas arriesga proporción 5/6 (5)");
  igual(marcaGana[0].lado1.monto, 5, "Marca ganadora: jugador gana proporción 5/6 (5)");
  igual(marcaGana[0].lado2.monto, 5.25, "Marca ganadora: Marcas pierde 5 más 5% comisión (5.25)");

  const marcaPierde = armarFilasPreview(
    [persistida({ id: "m2", nombre_jugada: "MARCA 2", caballo: "2", monto_jugado: 6, premio_pagar: 0, estado: "Perdedor", cliente_consigue_nombre: "", comision_porcentaje: 5 })],
    []
  );
  igual(marcaPierde[0].lado1.monto, 6, "Marca perdedora: jugador pierde 6");
  igual(marcaPierde[0].lado2.monto, 5.7, "Marca perdedora: Marcas gana 6 menos 5% comisión (5.70)");

  // Marcas evaluadas contra pizarra (pago y cobro según resultado, aun con rival fuera de los 5 primeros)
  const marcaPizarraGana = armarFilasPreview(
    [
      persistida({
        id: "m3",
        nombre_jugada: "MARCA 2",
        caballo: "2",
        monto_jugado: 60,
        premio_pagar: 0,
        estado: "Pendiente",
        cliente_consigue_nombre: "",
        comision_porcentaje: 5,
        nota_auditoria: JSON.stringify({ rivales_snapshot: ["8"] }),
      }),
    ],
    [],
    ["1", "2", "3", "4", "5"] // #2 llegó 2° y #8 fuera de pizarra → gana #2
  );
  igual(marcaPizarraGana[0].cliente2, "MARCAS", "Marca se imputa al usuario MARCAS");
  igual(marcaPizarraGana[0].estado, "Ganador", "Marca donde elegido entra en pizarra y rival no → Ganador");
  igual(marcaPizarraGana[0].lado1.monto, 50, "Marca ganadora por pizarra: jugador cobra 50 (5/6 de 60)");
  igual(marcaPizarraGana[0].lado2.monto, 52.5, "Marca ganadora por pizarra: MARCAS paga 50 + 5% comisión (52.5)");

  const marcaPizarraPierde = armarFilasPreview(
    [
      persistida({
        id: "m4",
        nombre_jugada: "MARCA 8",
        caballo: "8",
        monto_jugado: 60,
        premio_pagar: 0,
        estado: "Pendiente",
        cliente_consigue_nombre: "",
        comision_porcentaje: 5,
        nota_auditoria: JSON.stringify({ rivales_snapshot: ["2"] }),
      }),
    ],
    [],
    ["1", "2", "3", "4", "5"] // #2 llegó 2° y #8 fuera de pizarra → pierde #8
  );
  igual(marcaPizarraPierde[0].estado, "Perdedor", "Marca donde rival entra en pizarra y elegido no → Perdedor");
  igual(marcaPizarraPierde[0].lado1.monto, 60, "Marca perdedora por pizarra: jugador pierde 60");
  igual(marcaPizarraPierde[0].lado2.monto, 57, "Marca perdedora por pizarra: MARCAS cobra 60 - 5% comisión (57)");

  // Imputación de usuarios por modalidad: TF, REMATES, DUPLETA, POLLAS
  const modalidades = armarFilasPreview(
    [
      persistida({ id: "mod1", nombre_jugada: "TABLA FIJA", caballo: "1", monto_jugado: 10, estado: "Pendiente", cliente_consigue_nombre: "" }),
      persistida({ id: "mod2", nombre_jugada: "REMATE 1", caballo: "1", monto_jugado: 10, estado: "Pendiente", cliente_consigue_nombre: "" }),
      persistida({ id: "mod3", nombre_jugada: "DUPLETA 1-2", caballo: "1-2", monto_jugado: 10, estado: "Pendiente", cliente_consigue_nombre: "" }),
      persistida({ id: "mod4", nombre_jugada: "POLLA", caballo: "1", monto_jugado: 10, estado: "Pendiente", cliente_consigue_nombre: "" }),
    ],
    []
  );
  igual(modalidades[0].cliente2, "TF", "Tablas se imputan a TF");
  igual(modalidades[1].cliente2, "REMATES", "Remates se imputan a REMATES");
  igual(modalidades[2].cliente2, "DUPLETA", "Dupletas se imputan a DUPLETA");
  igual(modalidades[3].cliente2, "POLLAS", "Pollas se imputan a POLLAS");

  // Visualización de Marcas (Ejemplar A x Ejemplar B) y Tablas Fijas (Ejemplar A a Precio)
  igual(marcaPizarraPierde[0].caballo, "8x2", "Marca preserva ambos ejemplares (8x2) desde rivales_snapshot");

  const tablaConPrecio = armarFilasPreview(
    [
      persistida({
        id: "tf5",
        nombre_jugada: "TABLA FIJA (LA RINCONADA C5)",
        caballo: "GRAN AVELINA",
        ejemplar_numero: 5,
        monto_jugado: 114,
        cantidad_tablas: 3,
        pts_ejemplar: 38,
        premio_por_tabla: 100,
        estado: "Pendiente",
        cliente_juega_nombre: "SHAFLAN",
        cliente_consigue_nombre: "",
      }),
    ],
    []
  );
  igual(tablaConPrecio[0].caballo, "5", "Tabla Fija expone número del ejemplar (5) en vez del nombre");
  igual(tablaConPrecio[0].precioTabla, 38, "Tabla Fija expone precio unitario (38)");
  igual(tablaConPrecio[0].cantidadTablas, 3, "Tabla Fija expone cantidad de tablas (3)");

  // Mensajes de WhatsApp resumidos (Pre-jugadas y Resultados)
  const txtPreWsp = generarTextoPrejugadasWhatsapp({
    grupo: "PRINCIPAL",
    hipodromo: "La Rinconada",
    carrera: 5,
    fecha: "2026-10-25",
    jugadasEnVivo: [],
    jugadasAdelantadas: [
      {
        juega: "NADAL",
        jugada: "MARCA",
        caballo: "8x2",
        monto: 60,
        da: "MARCAS",
      },
      {
        juega: "SHAFLAN",
        jugada: "TABLA FIJA (LA RINCONADA C5)",
        caballo: "5",
        precioTabla: 38,
        cantidadTablas: 3,
        monto: 114,
        da: "TF",
      },
    ],
  });
  si(
    txtPreWsp.includes("1) Juega NADAL MARCA 8 X 2 con 60,00"),
    "WhatsApp Prejugadas muestra Marca resumida: 1) Juega NADAL MARCA 8 X 2 con 60,00"
  );
  si(
    txtPreWsp.includes("1) Juega SHAFLAN TABLA FIJA DEL 5 a 38 c/u 114,00 da TF"),
    "WhatsApp Prejugadas muestra Tabla Fija resumida: 1) Juega SHAFLAN TABLA FIJA DEL 5 a 38 c/u 114,00 da TF"
  );

  const txtResWsp = relacionResultados(
    {
      grupo: "PRINCIPAL",
      hipodromo: "La Rinconada",
      carrera: 5,
      fecha: new Date("2026-10-25T12:00:00"),
      pizarra: "6 · 7 · 5 · 2 · 4",
      pizarraPuestos: ["6", "7", "5", "2", "4"],
    },
    [
      {
        clienteJuega: "SHAFLAN",
        jugada: "TABLA FIJA",
        caballo: "5",
        monto: 114,
        cantidadTablas: 3,
        premioPorTabla: 100,
        precioPorTablaUnitario: 38,
        comisionPct: 5,
        esAdelantada: true,
        ganador: false,
      },
      {
        clienteJuega: "NADAL",
        jugada: "MARCA",
        caballo: "8x2",
        monto: 60,
        comisionPct: 0,
        esAdelantada: true,
        ganador: false,
      },
      {
        clienteJuega: "GAETANO",
        clienteConsigue: "SAM",
        jugada: "2Y3",
        caballo: "7",
        monto: 50,
        comisionPct: 5,
        ganador: true,
      },
    ]
  );
  si(
    txtResWsp.includes("JUGADAS ADELANTADAS\n1) TABLA FIJA DEL 5 A 38\nJuega SHAFLAN $ -114,00\nDa TF $ +108,30\n2) MARCA 8 X 2 con 60,00\nJuega NADAL $ -60,00\nDa MARCAS $ +60,00"),
    "WhatsApp Resultados agrupa JUGADAS ADELANTADAS al final con formato resumido exacto"
  );
}

// ── 10. Retiros de ejemplar (anulación transversal) y Reporte Saldos WhatsApp ──
{
  si(jugadaInvolucraRetirado("7", null, "2P", ["7"]), "jugada simple del ejemplar 7 detecta retiro del 7");
  si(jugadaInvolucraRetirado("8x2", null, "MARCA", ["2"]), "pareo 8x2 detecta retiro del 2");
  si(!jugadaInvolucraRetirado("8x2", null, "MARCA", ["5"]), "pareo 8x2 NO se anula si se retira el 5");

  const filasConRetirado = armarFilasPreview(
    [
      persistida({ id: "r1", nombre_jugada: "2P", caballo: "7", monto_jugado: 100, estado: "Pendiente" }),
      persistida({ id: "r2", nombre_jugada: "2P", caballo: "4", monto_jugado: 100, estado: "Pendiente" }),
    ],
    [ticketSesion({ id: "s-ret", ticketId: undefined, caballo: "7", monto: 50 })],
    [],
    ["7"]
  );
  igual(filasConRetirado[0].estado, "Retirado", "persistida con ejemplar retirado pasa a estado Retirado (Empate)");
  si(!filasConRetirado[0].anulada, "persistida con ejemplar retirado queda visible como Empate (no se oculta como anulada)");
  igual(filasConRetirado[0].lado1.estado, "RETIRADO", "persistida con ejemplar retirado muestra RETIRADO / Empate en lado 1");
  igual(filasConRetirado[0].estadoLiquidacion, "Liquidada", "persistida con ejemplar retirado queda resuelta como Empate");
  igual(filasConRetirado[1].estado, "Pendiente", "persistida de otro ejemplar (4) permanece Pendiente");
  igual(filasConRetirado[2].estado, "Retirado", "ticket en sesión con ejemplar retirado también queda como Retirado (Empate)");
  si(!filasConRetirado[2].anulada, "ticket en sesión con ejemplar retirado permanece visible como Empate");

  const resMotorRet = liquidarOficial({
    id: "t1",
    hipodromo: "La Rinconada",
    carrera: "1",
    fechas: ["2026-10-25"],
    tipo_jugada: "100 2P",
    monto: 100,
    cruces: 1,
    cuota: null,
    total: 100,
    addedAt: 0,
    caballo: "7",
    puesto_final: 99,
    dividendos: null,
    pizarra: { primero: "1", segundo: "2", tercero: "3", retirados: ["7"] },
  });
  si(!resMotorRet.ok && Boolean(resMotorRet.motivo?.includes("RETIRADO")), "liquidarOficial anula jugada cuando el ejemplar está en retirados");
  igual(resMotorRet.totalClienteNeto, 100, "liquidarOficial devuelve el capital al cliente cuando se retira el ejemplar");

  const mesa0 = crearMesa({ PEDRO: 500 });
  const prop1 = proponer(mesa0, {
    autor: "PEDRO",
    rol: "JUEGA",
    jugada: "2P",
    caballos: "7",
    monto: 100,
  });
  const resMesa = anularJugadasMesaPorRetiro(prop1.estado, ["7"]);
  igual(resMesa.propuestasAnuladas, 1, "anularJugadasMesaPorRetiro cancela propuestas abiertas del ejemplar retirado");
  igual(resMesa.estado.propuestas.length, 0, "la propuesta del ejemplar retirado se elimina de la mesa");
  igual(resMesa.estado.disponibles.PEDRO, 500, "anularJugadasMesaPorRetiro restituye el saldo comprometido a PEDRO");

  // WhatsApp Saldos con íconos de modalidad (💎 Avalado, 🔓 Libre, 💰 Pozo), ocultando 0 y mostrando Disp. XXXX
  const wspSaldos = generarTextoSaldosWhatsapp({
    grupo: "PRINCIPAL",
    filtro: "sin_ceros",
    clientes: [
      { nombre: "CERO", saldoContable: 0, aval: 0, disponible: 0, libre: false },
      { nombre: "POZO_POS", saldoContable: 250, aval: 0, disponible: 250, libre: false },
      { nombre: "LIBRE_NEG", saldoContable: -80, aval: 0, disponible: 999999, libre: true },
      { nombre: "AVAL_HOLGADO", saldoContable: -100, aval: 1000, disponible: 900, libre: false },
      { nombre: "AVAL_POR_AGOTAR", saldoContable: -850, aval: 1000, disponible: 150, libre: false },
    ],
  });
  si(!wspSaldos.includes("CERO"), "WhatsApp Saldos oculta clientes con saldo 0");
  si(wspSaldos.includes("💰 POZO_POS: *+250,00*"), "WhatsApp Saldos muestra ícono 💰 y saldo positivo");
  si(wspSaldos.includes("🔓 LIBRE_NEG: *-80,00*"), "WhatsApp Saldos muestra ícono 🔓 para cliente libre");
  si(wspSaldos.includes("💎 AVAL_HOLGADO: *-100,00*") && !wspSaldos.includes("AVAL_HOLGADO: *-100,00* · Disp."), "WhatsApp Saldos muestra ícono 💎 y saldo del avalado sin Disp. cuando no está próximo a agotarse");
  si(wspSaldos.includes("💎 AVAL_POR_AGOTAR: *-850,00* · Disp. 150,00"), "WhatsApp Saldos agrega Disp. XXXX cuando el avalado se aproxima a agotar su aval");
}

console.log(`\n${pasan} ok / ${fallan} fallaron`);
if (fallan > 0) process.exitCode = 1;