// ============================================================================
// NORMALIZADOR DIFUSO DE CARGA RÁPIDA + REGRESIÓN DEL PARSER LEGACY.
//
// Protege el contrato del 09-10-2026: el texto dictado por un transcriptor
// (con errores) debe aterrizar ORDENADO en la Carga Individual, detectando en
// cada línea quién juega (CL1), quién da (CL2), cuánto (MONTO), qué jugada
// (JUGADA) y qué caballo (CABALLO) — sin partir nombres compuestos, leyendo
// números y nomenclatura hablados y matcheando el catálogo real de clientes.
//
// Corre con:  node pruebas/correr.cjs   (o npx tsx pruebas/normalizar-carga.test.ts)
// ============================================================================
import {
  normalizarLineaRapida,
  expandirLineaHablada,
  jaroWinkler,
  resolverClientes,
} from "../src/lib/taquilla/normalizar";
import { parsearLineaRapida, clasificarLineaRapida } from "../src/lib/taquilla/validar";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => { pasan++; console.log(`  ok   ${m}`); };
const mal = (m: string, d?: string) => { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };
const si = (c: boolean, m: string, d?: string) => (c ? ok(m) : mal(m, d));

// Catálogo de clientes fijo para que los tests sean deterministas.
const CLIENTES = [
  { nombre: "Perrito Molinas" },
  { nombre: "Emy" },
  { nombre: "Mar" },
  { nombre: "Lolo" },
  { nombre: "Marlene" },
  { nombre: "Eddie" },
  { nombre: "Manuel" },
  { nombre: "Juan" },
  { nombre: "Pedro" },
];

// ---------------------------------------------------------------------------
// 1. REGRESIÓN DEL PARSER LEGACY (no se rompe nada de lo que ya funcionaba)
// ---------------------------------------------------------------------------
console.log("\n== Regresión del parser legacy (parsearLineaRapida) ==");

{
  const p = parsearLineaRapida("3y3 9 40 emy mar");
  si(p?.ok === true && p.ok && p.jugada === "3Y3" && p.caballo === "9" && p.monto === "40" && p.cliente1 === "emy" && p.cliente2 === "mar",
    'parsearLineaRapida("3y3 9 40 emy mar") → 3Y3·9·40·emy·mar', JSON.stringify(p));
}
{
  const p = parsearLineaRapida("Juega Lolo 2p (1) con 300 da Mar");
  si(p?.ok === true && p.ok && p.jugada === "2P" && p.caballo === "1" && p.monto === "300" && p.cliente1 === "Lolo" && p.cliente2 === "Mar",
    'parsearLineaRapida("Juega Lolo 2p (1) con 300 da Mar") → 2P·1·300·Lolo·Mar', JSON.stringify(p));
}
{
  const p = parsearLineaRapida("2x3 10/8 2 100 Juan Pedro");
  si(p?.ok === true && p.ok && p.jugada === "2X3 10/8" && p.caballo === "2" && p.monto === "100" && p.cliente1 === "Juan" && p.cliente2 === "Pedro",
    'parsearLineaRapida("2x3 10/8 2 100 Juan Pedro") → 2X3 10/8·2·100·Juan·Pedro', JSON.stringify(p));
}
{
  const p = parsearLineaRapida("1/2 y 2n 7 100 Eddie Manuel");
  si(p?.ok === true && p.ok && p.jugada === "1/2 Y 2N" && p.caballo === "7" && p.cliente1 === "Eddie" && p.cliente2 === "Manuel",
    'parsearLineaRapida("1/2 y 2n 7 100 Eddie Manuel") → compuesta + caballo 7', JSON.stringify(p));
}
{
  // El sobrante queda intacto para el normalizador (nueva salida de clasificar).
  const c = clasificarLineaRapida("2p 1 100 Perrito molinas");
  si(c?.ok === true && c.ok && c.restantes.length === 2 && c.restantes[0] === "Perrito" && c.restantes[1] === "molinas",
    'clasificarLineaRapida devuelve el sobrante sin asignar clientes', JSON.stringify(c));
}
{
  // A Premio tipeado "10a8" ahora sí se detecta como jugada (gramática de la casa).
  const p = parsearLineaRapida("10a8 3 200 mar");
  si(p?.ok === true && p.ok && p.jugada === "10A8" && p.caballo === "3" && p.monto === "200",
    'parsearLineaRapida("10a8 3 200 mar") → jugada 10A8 detectada', JSON.stringify(p));
}
{
  const p = parsearLineaRapida("# comentario");
  si(p === null, "las líneas comentario (#) se ignoran → null", String(p));
}

// ---------------------------------------------------------------------------
// 2. NÚMEROS HABLADOS → DÍGITOS
// ---------------------------------------------------------------------------
console.log("\n== Expansión numérica (palabras → dígitos) ==");

const casosNumeros: Array<[string, string]> = [
  ["cuarenta", "40"],
  ["cincuenta y cinco", "55"],
  ["cien", "100"],
  ["ciento veinte", "120"],
  ["mil", "1000"],
  ["mil doscientos", "1200"],
  ["dos mil", "2000"],
  ["tres mil quinientos", "3500"],
  ["dos mil trescientos cuarenta y cinco", "2345"],
  ["quinientos", "500"],
  ["quinientos cinco", "505"],
  ["doscientos cincuenta", "250"],
  ["veintiuno", "21"],
  ["treinta y ocho", "38"],
  ["cien mil", "100000"],
  ["100", "100"], // dígito crudo pasa igual
];
for (const [frase, esperado] of casosNumeros) {
  const e = expandirLineaHablada(frase);
  si(e.texto === esperado, `"${frase}" → "${esperado}" (dio "${e.texto}")`);
}
{
  // ¡El caso estrella del dictado real! "cinco doscientos" = caballo 5 + monto
  // 200, JAMÁS 205.
  const e = expandirLineaHablada("el cinco doscientos a la par");
  si(e.texto === "el 5 200 pp", '"el cinco doscientos a la par" → "el 5 200 pp"', e.texto);
  si(e.huboNumeroPalabra === true, "marca huboNumeroPalabra");
}

// ---------------------------------------------------------------------------
// 3. NOMENCLATURA HABLADA → CANÓNICA
// ---------------------------------------------------------------------------
console.log("\n== Nomenclatura hablada → canónica ==");

const casosNomenclatura: Array<[string, string]> = [
  ["a la par", "pp"],
  ["puesto por puesto", "pp"],
  ["par", "pp"],
  ["dos p", "2p"],
  ["un p", "1p"],
  ["dos n", "2n"],
  ["tres y tres", "3y3"],
  ["uno y dos n", "1y2n"],
  ["diez a ocho", "10/8"],
  ["quince a diez", "15/10"],
];
for (const [frase, esperado] of casosNomenclatura) {
  const e = expandirLineaHablada(frase);
  si(e.texto === esperado, `"${frase}" → "${esperado}" (dio "${e.texto}")`);
}
{
  const e = expandirLineaHablada("dos p");
  si(e.huboNomenclatura === true, "marca huboNomenclatura en hablado");
}

// ---------------------------------------------------------------------------
// 4. JARO-WINKLER
// ---------------------------------------------------------------------------
console.log("\n== Jaro-Winkler ==");

si(jaroWinkler("mar", "mar") === 1, "idénticos → 1");
si(jaroWinkler("perrito molinas", "perrito molinas") === 1, "nombres idénticos → 1");
si(jaroWinkler("perito molina", "perrito molinas") > 0.85, "typo del transcriptor sigue matcheando (>0.85)");
si(jaroWinkler("juan", "maria") < 0.6, "nombres distintos quedan por debajo del umbral");

// ---------------------------------------------------------------------------
// 5. NORMALIZADOR: LOS NOMBRES COMPUESTOS YA NO SE PARTEN
// ---------------------------------------------------------------------------
console.log("\n== Normalizador: nombres compuestos contra el catálogo ==");

{
  // El bug histórico: "Perrito molinas" se partía en PERRITO + MOLINAS.
  const r = normalizarLineaRapida("2p 1 100 Perrito molinas", { clientes: CLIENTES });
  si(r?.ok === true && r.ok && r.cliente1 === "Perrito Molinas" && r.cliente2 === "",
    '"2p 1 100 Perrito molinas" → CL1 "Perrito Molinas" (entero), CL2 ""', JSON.stringify(r));
  si(r?.ok === true && r.ok && r.confianza.cliente1 === "exacto" && r.confianza.caballo === "exacto",
    "confianzas: cliente1 exacto (catálogo), caballo exacto (número)");
}
{
  // Mensaje dictado lleno de ruido del transcriptor.
  const r = normalizarLineaRapida(
    "señores juega perito molinas con el cinco doscientos a la par y da marlene",
    { clientes: CLIENTES }
  );
  si(
    r?.ok === true && r.ok &&
      r.jugada === "PP" && r.caballo === "5" && r.monto === "200" &&
      r.cliente1 === "Perrito Molinas" && r.cliente2 === "Marlene",
    'dictado ruidoso → PP·5·200·"Perrito Molinas"·Marlene', JSON.stringify(r)
  );
  si(r?.ok === true && r.ok && r.correcciones.some((x) => x.includes("Perrito Molinas")),
    "la corrección del nombre se reporta en legible");
}
{
  const r = normalizarLineaRapida("tres y tres el nueve cuarenta emy y mar", { clientes: CLIENTES });
  si(r?.ok === true && r.ok && r.jugada === "3Y3" && r.caballo === "9" && r.monto === "40" && r.cliente1 === "Emy" && r.cliente2 === "Mar",
    '"tres y tres el nueve cuarenta emy y mar" → 3Y3·9·40·Emy·Mar', JSON.stringify(r));
}
{
  const r = normalizarLineaRapida("1/2 y 2n 7 100 Eddie Manuel", { clientes: CLIENTES });
  si(r?.ok === true && r.ok && r.jugada === "1/2 Y 2N" && r.cliente1 === "Eddie" && r.cliente2 === "Manuel",
    'placeholder compuesta: "1/2 y 2n 7 100 Eddie Manuel"', JSON.stringify(r));
}
{
  const r = normalizarLineaRapida("Juega Lolo 2p (1) con 300 da Mar", { clientes: CLIENTES });
  si(r?.ok === true && r.ok && r.cliente1 === "Lolo" && r.cliente2 === "Mar" && r.monto === "300",
    "formato explicito con 'da' → Lolo·Mar·300", JSON.stringify(r));
}
{
  // El caballo dicho por NOMBRE se resuelve contra el padrón de la carrera.
  const r = normalizarLineaRapida("juega perrito molinas con relampago doscientos a la par", {
    clientes: CLIENTES,
    caballos: [
      { numero: 1, nombre: "Relámpago" },
      { numero: 7, nombre: "Furia" },
    ],
  });
  si(r?.ok === true && r.ok && r.caballo === "1" && r.cliente1 === "Perrito Molinas",
    '"…con relampago…" → caballo N°1 + cliente entero', JSON.stringify(r));
  si(r?.ok === true && r.ok && r.confianza.caballo === "aproximado" && r.correcciones.some((x) => x.includes("N°1")),
    "caballo por nombre: confianza aproximado + corrección N°1");
}
{
  // Proporción hablada en la jugada.
  const r = normalizarLineaRapida("10 a 8 4 200 marlene", { clientes: CLIENTES });
  si(r?.ok === true && r.ok && r.jugada === "10/8" && r.caballo === "4" && r.monto === "200" && r.cliente1 === "Marlene",
    '"10 a 8 4 200 marlene" → 10/8·4·200·Marlene', JSON.stringify(r));
}
{
  // Sin catálogo cargado: comportamiento legacy (1° → CL1, resto → CL2).
  const r = normalizarLineaRapida("2p 1 100 Perrito molinas", { clientes: [] });
  si(r?.ok === true && r.ok && r.cliente1 === "Perrito" && r.cliente2 === "molinas",
    "sin catálogo → legacy: CL1 Perrito, CL2 molinas (no rompe el flujo actual)", JSON.stringify(r));
  si(r?.ok === true && r.ok && r.confianza.cliente1 === "sin",
    "sin catálogo → confianza cliente1 'sin' (el caller decide si marcar)");
}
{
  // Línea ilegible: NO se descarta, vuelve con motivo para la fila roja.
  const r = normalizarLineaRapida("hola mundo sin jugada", { clientes: CLIENTES });
  si(r?.ok === false && "motivo" in r && typeof r.motivo === "string",
    'línea ilegible → { ok:false, motivo } para pincelarla en rojo', JSON.stringify(r));
}
{
  const r = normalizarLineaRapida("   ", { clientes: CLIENTES });
  si(r === null, "línea en blanco → null");
}

// ---------------------------------------------------------------------------
// 6. RESOLUCIÓN DE CLIENTES (segmentación fina)
// ---------------------------------------------------------------------------
console.log("\n== Segmentación de clientes ==");

{
  const r = resolverClientes(["perito", "molinas", "y", "marlene"], CLIENTES);
  si(r.cliente1 === "Perrito Molinas" && r.cliente2 === "Marlene",
    '"perito molinas y marlene" → CL1 entero + CL2', JSON.stringify(r));
}
{
  const r = resolverClientes(["juan", "pedro"], CLIENTES);
  si(r.cliente1 === "Juan" && r.cliente2 === "Pedro", "dos nombres simples → Juan·Pedro");
}
{
  const r = resolverClientes(["xyzzy", "noexiste"], CLIENTES);
  si(r.cliente1 === "xyzzy noexiste" && r.cliente1Norm === null,
    "material irreconocible → queda entero en CL1 marcado 'sin' (jamás se parte)", JSON.stringify(r));
}

// ---------------------------------------------------------------------------
// 7. SIMULACIÓN: UN BLOQUE DE DICTADO REAL, LÍNEA POR LÍNEA
// ---------------------------------------------------------------------------
console.log("\n== Simulación: bloque de dictado real (transcriptor ruidoso) ==");

// Catálogo y padrón del día para la simulación (como los carga la app).
const CLIENTES_DICTADO = [
  { nombre: "Perrito Molinas" },
  { nombre: "Marlene" },
  { nombre: "Emy" },
  { nombre: "Mar" },
  { nombre: "Lolo" },
  { nombre: "Ana María" },
  { nombre: "Luis Suárez" },
  { nombre: "Carlos Pérez" },
  { nombre: "Juan Pedro" },
  { nombre: "Eddie Manuel" },
];
const CABALLOS_DICTADO = [
  { numero: 1, nombre: "Relámpago" },
  { numero: 2, nombre: "Furia" },
  { numero: 3, nombre: "Trueno" },
  { numero: 4, nombre: "Galán" },
  { numero: 5, nombre: "Estrella" },
  { numero: 7, nombre: "Centella" },
  { numero: 9, nombre: "Brisa" },
];

const casosDictado: Array<[string, string, string, string, string, string]> = [
  // [línea dictada, CL1, CL2, MONTO, JUGADA, CABALLO]
  ["señores buenas juega perito molinas a la par con el cinco doscientos y da marlene",
    "Perrito Molinas", "Marlene", "200", "PP", "5"],
  ["2p 1 100 Perrito molinas",
    "Perrito Molinas", "", "100", "2P", "1"],
  ["Juega Lolo 2p (1) con 300 da Mar",
    "Lolo", "Mar", "300", "2P", "1"],
  ["tres y tres el nueve cuarenta emy y mar",
    "Emy", "Mar", "40", "3Y3", "9"],
  ["señores siga la jugada dos p el cinco cien para ana maria y da perrito molinas",
    "Ana María", "Perrito Molinas", "100", "2P", "5"],
  ["un p con el galan noventa para luis suarez y da carlos perez",
    "Luis Suárez", "Carlos Pérez", "90", "1P", "4"],
  ["diez a ocho el caballo numero cuatro doscientos marlene y emy",
    "Marlene", "Emy", "200", "10/8", "4"],
  ["dos n el siete quinientos para juan pedro y da eddie manuel",
    "Juan Pedro", "Eddie Manuel", "500", "2N", "7"],
];
for (const [linea, cl1, cl2, monto, jugada, caballo] of casosDictado) {
  const r = normalizarLineaRapida(linea, { clientes: CLIENTES_DICTADO, caballos: CABALLOS_DICTADO });
  si(
    r?.ok === true && r.ok &&
      r.cliente1 === cl1 && r.cliente2 === cl2 &&
      r.monto === monto && r.jugada === jugada && r.caballo === caballo,
    `"${linea}" → ${cl1}·${cl2}·${monto}·${jugada}·${caballo}`, JSON.stringify(r)
  );
}
{
  // El caballo dicho por nombre se resuelve contra el padrón (Galán → N°4)
  // y la corrección queda reportada en legible para la vista previa.
  const r = normalizarLineaRapida("un p con el galan noventa para luis suarez y da carlos perez", {
    clientes: CLIENTES_DICTADO,
    caballos: CABALLOS_DICTADO,
  });
  si(r?.ok === true && r.ok && r.caballo === "4" && r.confianza.caballo === "aproximado",
    "caballo por nombre en dictado → N°4 con confianza aproximado", JSON.stringify(r));
  si(r?.ok === true && r.ok && r.correcciones.some((x) => x.includes("N°4")),
    "y la corrección del caballo llega a la vista previa (🔧 N°4)");
}
{
  // La línea ininteligible del bloque NO se descarta: queda para la fila roja editable.
  const r = normalizarLineaRapida("señores que pasa con el tiempo hoy", {
    clientes: CLIENTES_DICTADO,
    caballos: CABALLOS_DICTADO,
  });
  si(r !== null && r.ok === false,
    'línea irreconocible → { ok:false, motivo } para pincelarla en rojo (no se pierde)', JSON.stringify(r));
}

console.log(`\n${pasan} pasan, ${fallan} fallan.`);
process.exit(fallan > 0 ? 1 : 0);