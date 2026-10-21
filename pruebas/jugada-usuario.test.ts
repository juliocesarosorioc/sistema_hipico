// ============================================================================
// PROMPT #6 · MODAL 🐎 REALIZAR JUGADA — NÚCLEO PURO
//
// El jugador arma una jugada (Tabla Fija, Polla, Dupleta o Marca) y el núcleo
// la valida y arma el cuerpo que va a la Edge Function, que es la que de verdad
// vende. Este archivo prueba la lógica de forma (campos, montos, límites) sin
// base de datos.
//
// Qué protege esta prueba:
//   1. `validarJugada`: monto > 0, tope de saldo+aval, y las reglas de cada tipo.
//   2. `cuerpoVenta`: que NO viajen cliente_id ni grupo_id (frontera de confianza),
//      y que cada tipo arme su payload correcto.
//   3. `combinacionesDe`: que la selección por carrera se transforme en el arreglo
//      `[{ claveCarrera, numero }]` que espera la RPC de Polla.
//   4. `rangoFechaSolicitud`: el rango de fechas del input de "jugada no relacionada".
//   5. Que el modal use el núcleo y no reinvente las reglas.
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TIPOS_JUGADA,
  ETIQUETA_TIPO,
  validarJugada,
  cuerpoVenta,
  combinacionesDe,
  resumenJugada,
  rangoFechaSolicitud,
  type JugadaBorrador,
} from "../src/features/portal/lib/jugada-usuario";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => { pasan++; console.log(`  ok   ${m}`); };
const mal = (m: string, d?: string) => { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };
const si = (c: boolean, m: string, d?: string) => (c ? ok(m) : mal(m, d));
const igual = (a: unknown, b: unknown, m: string) =>
  si(JSON.stringify(a) === JSON.stringify(b), m, `esperado ${JSON.stringify(b)} · recibido ${JSON.stringify(a)}`);

const raiz = process.cwd();
const leer = (...partes: string[]) => readFileSync(join(raiz, ...partes), "utf8");

const valido = (b: JugadaBorrador, opts?: { montoDisponible?: number | null }): boolean =>
  validarJugada(b, opts).ok;

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 1 — tipos y etiquetas");
// ---------------------------------------------------------------------------
igual([...TIPOS_JUGADA], ["TABLA_FIJA", "POLLA", "DUPLETA", "MARCA"], "los cuatro tipos, en orden");
si(TIPOS_JUGADA.every((t) => ETIQUETA_TIPO[t]?.icono && ETIQUETA_TIPO[t]?.etiqueta), "cada tipo tiene ícono y etiqueta");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 2 — reglas comunes (monto)");
// ---------------------------------------------------------------------------
si(!validarJugada({ tipo: "TABLA_FIJA", hipodromo: "X", carrera: 1, tablaId: "t", cantidad: 1, monto: 0 }).ok, "monto 0 → inválido");
si(!validarJugada({ tipo: "TABLA_FIJA", hipodromo: "X", carrera: 1, tablaId: "t", cantidad: 1, monto: "" }).ok, "monto vacío → inválido");
si(!validarJugada({ tipo: "TABLA_FIJA", hipodromo: "X", carrera: 1, tablaId: "t", cantidad: 1, monto: -5 }).ok, "monto negativo → inválido");
si(validarJugada({ tipo: "TABLA_FIJA", hipodromo: "X", carrera: 1, tablaId: "t", cantidad: 1, monto: 10 }).ok, "monto válido → ok");
// Tope saldo + aval.
si(!validarJugada({ tipo: "TABLA_FIJA", hipodromo: "X", carrera: 1, tablaId: "t", cantidad: 1, monto: 150 }, { montoDisponible: 100 }).ok, "monto > disponible → inválido");
si(validarJugada({ tipo: "TABLA_FIJA", hipodromo: "X", carrera: 1, tablaId: "t", cantidad: 1, monto: 100 }, { montoDisponible: 100 }).ok, "monto = disponible → ok");
si(validarJugada({ tipo: "TABLA_FIJA", hipodromo: "X", carrera: 1, tablaId: "t", cantidad: 1, monto: 9999 }, { montoDisponible: null }).ok, "disponible null (modo libre) → sin tope");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 3 — Tabla Fija");
// ---------------------------------------------------------------------------
si(valido({ tipo: "TABLA_FIJA", hipodromo: "LA RINCONADA", carrera: 3, tablaId: "7", cantidad: 2, monto: 20 }), "completa → ok");
si(!valido({ tipo: "TABLA_FIJA", carrera: 3, tablaId: "7", cantidad: 1, monto: 20 }), "sin hipódromo → inválido");
si(!valido({ tipo: "TABLA_FIJA", hipodromo: "X", tablaId: "7", cantidad: 1, monto: 20 }), "sin carrera → inválido");
si(!valido({ tipo: "TABLA_FIJA", hipodromo: "X", carrera: 3, cantidad: 1, monto: 20 }), "sin tabla → inválido");
si(!valido({ tipo: "TABLA_FIJA", hipodromo: "X", carrera: 3, tablaId: "7", cantidad: 0, monto: 20 }), "cantidad 0 → inválido");
const cTabla = cuerpoVenta({ tipo: "TABLA_FIJA", hipodromo: "la rinconada", carrera: 3, tablaId: "7", cantidad: 2, monto: 20, ejemplar: "5" });
igual(cTabla.hipodromo, "LA RINCONADA", "cuerpo: hipódromo en mayúsculas");
igual(cTabla.carrera, 3, "cuerpo: carrera numérica");
igual(cTabla.cantidad, 2, "cuerpo: cantidad numérica");
igual(cTabla.ejemplar, "5", "cuerpo: ejemplar");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 4 — Polla");
// ---------------------------------------------------------------------------
si(!valido({ tipo: "POLLA", monto: 10 }), "sin polla → inválido");
si(!valido({ tipo: "POLLA", pollaId: "p1", monto: 10 }), "sin combinaciones → inválido");
si(valido({ tipo: "POLLA", pollaId: "p1", monto: 10, pollaSeleccion: { "2026-10-21|X|1": "3" } }), "con una selección → ok");
igual(
  combinacionesDe({ tipo: "POLLA", pollaSeleccion: { "C1": "3", "C2": "7" } }),
  [[{ claveCarrera: "C1", numero: "3" }, { claveCarrera: "C2", numero: "7" }]],
  "combinacionesDe: una combinación con un objeto por carrera"
);
igual(
  combinacionesDe({ tipo: "POLLA", combinaciones: [["3", "7"], ["1", "2"]] }),
  [
    [{ claveCarrera: "", numero: "3" }, { claveCarrera: "", numero: "7" }],
    [{ claveCarrera: "", numero: "1" }, { claveCarrera: "", numero: "2" }],
  ],
  "combinacionesDe: respeta combinaciones ya armadas (arreglo de arreglos)"
);
igual(combinacionesDe({ tipo: "POLLA", pollaSeleccion: { C1: "", C2: "  " } }), [], "selecciones vacías → sin combinaciones");
const cPolla = cuerpoVenta({ tipo: "POLLA", pollaId: "p1", monto: 10, pollaSeleccion: { C1: "3" } });
igual(cPolla.polla_id, "p1", "cuerpo: polla_id");
igual(Array.isArray(cPolla.combinaciones), true, "cuerpo: combinaciones como arreglo");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 5 — Dupleta");
// ---------------------------------------------------------------------------
si(valido({ tipo: "DUPLETA", hipodromo: "X", carrera1: 1, carrera2: 2, numero1: "3", numero2: "5", monto: 10 }), "completa → ok");
si(!valido({ tipo: "DUPLETA", hipodromo: "X", carrera1: 1, carrera2: 2, numero1: "3", monto: 10 }), "sin ejemplar en la 2ª pata → inválido");
si(!valido({ tipo: "DUPLETA", hipodromo: "X", carrera1: 1, carrera2: 1, numero1: "3", numero2: "5", monto: 10 }), "misma carrera en las dos patas → inválido");
const cDup = cuerpoVenta({ tipo: "DUPLETA", hipodromo: "x", fecha: "2026-10-21", carrera1: 1, carrera2: 2, numero1: "3", numero2: "5", monto: 10 });
igual(cDup.carrera1, 1, "cuerpo: carrera1");
igual(cDup.carrera2, 2, "cuerpo: carrera2");
igual(cDup.numero1, "3", "cuerpo: numero1");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 6 — Marca");
// ---------------------------------------------------------------------------
si(valido({ tipo: "MARCA", hipodromo: "X", carrera: 1, caballo: "3", rival: "5", monto: 10 }), "completa → ok");
si(!valido({ tipo: "MARCA", hipodromo: "X", carrera: 1, caballo: "3", monto: 10 }), "sin rival → inválido");
si(!valido({ tipo: "MARCA", hipodromo: "X", carrera: 1, caballo: "3", rival: "3", monto: 10 }), "caballo = rival → inválido");
const cMarca = cuerpoVenta({ tipo: "MARCA", hipodromo: "x", fecha: "2026-10-21", carrera: 1, caballo: "3", rival: "5", monto: 10 });
igual(cMarca.caballo, "3", "cuerpo: caballo");
igual(cMarca.rival, "5", "cuerpo: rival");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 7 — frontera de confianza: NO viajan cliente_id / grupo_id");
// ---------------------------------------------------------------------------
const cuerpos = [
  cuerpoVenta({ tipo: "TABLA_FIJA", hipodromo: "X", carrera: 1, tablaId: "t", cantidad: 1, monto: 10 }),
  cuerpoVenta({ tipo: "POLLA", pollaId: "p", monto: 10, pollaSeleccion: { C1: "3" } }),
  cuerpoVenta({ tipo: "DUPLETA", hipodromo: "X", carrera1: 1, carrera2: 2, numero1: "3", numero2: "5", monto: 10 }),
  cuerpoVenta({ tipo: "MARCA", hipodromo: "X", carrera: 1, caballo: "3", rival: "5", monto: 10 }),
];
si(cuerpos.every((c) => !("cliente_id" in c) && !("grupo_id" in c)), "ningún cuerpo trae cliente_id ni grupo_id");
si(cuerpos.every((c) => c.tipo && c.monto === 10), "todos traen tipo y monto");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 8 — resumen humano");
// ---------------------------------------------------------------------------
si(/Tabla Fija/.test(resumenJugada({ tipo: "TABLA_FIJA", hipodromo: "X", carrera: 1, ejemplar: "5", cantidad: 2, monto: 20 })), "resumen de tabla nombra el tipo");
si(/combinación/.test(resumenJugada({ tipo: "POLLA", monto: 10, pollaSeleccion: { C1: "3" } })), "resumen de polla cuenta combinaciones");
si(/vs/.test(resumenJugada({ tipo: "MARCA", caballo: "3", rival: "5", monto: 10 })), "resumen de marca muestra el cruce");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 9 — rango de fechas de la 'jugada no relacionada'");
// ---------------------------------------------------------------------------
igual(rangoFechaSolicitud("2026-10-21", "SOLO_DIA_EN_CURSO"), { piso: "2026-10-21", tope: "2026-10-21" }, "día: piso = tope = hoy");
igual(
  rangoFechaSolicitud("2026-10-21", "SEMANA_EN_CURSO", { diaInicio: 1, diaFin: 7 }),
  { piso: "2026-10-19", tope: "2026-10-25" },
  "semana: rango Lun→Dom"
);

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 10 — el modal usa el núcleo (sin reglas propias)");
// ---------------------------------------------------------------------------
const modal = leer("src", "features", "portal", "components", "ModalRealizarJugadaUsuario.tsx");
si(/validarJugada/.test(modal), "el modal valida con validarJugada");
si(/cuerpoVenta/.test(modal), "el modal arma el body con cuerpoVenta");
si(/resumenJugada/.test(modal), "el modal resume con resumenJugada");
si(/realizarJugada/.test(modal), "el modal vende por la lib del portal (realizarJugada)");
si(/calcularRivales/.test(modal), "el modal resuelve el rival de Marca con la jerarquía (misma que el server)");

const lib = leer("src", "features", "portal", "lib", "portal.ts");
si(/export async function realizarJugada/.test(lib), "portal.ts expone realizarJugada");
si(/export async function solicitarJugadaNoRelacionada/.test(lib), "portal.ts expone solicitarJugadaNoRelacionada");

const fn = leer("supabase", "functions", "portal-auth", "index.ts");
si(/accion === "vender"/.test(fn), "la Edge Function atiende la acción vender");
si(/accion === "solicitud-jugada"/.test(fn), "la Edge Function atiende la acción solicitud-jugada");
si(/SOLICITUD_JUGADA/.test(fn), "la Edge Function crea el reclamo tipo SOLICITUD_JUGADA");
si(!/cliente_id:\s*e\./.test(fn), "la Edge Function no toma cliente_id del body");

// ---------------------------------------------------------------------------
console.log(`\n${pasan} pasaron, ${fallan} fallaron`);
process.exit(fallan > 0 ? 1 : 0);
