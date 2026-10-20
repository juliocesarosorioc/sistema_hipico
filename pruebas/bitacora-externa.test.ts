// ============================================================================
// BITÁCORA PERSONAL EN GRUPOS EXTERNOS + MÚLTIPLES FORMAS DE PAGO (PROMPT #7)
//
// Fija las dos reglas de cálculo y de formato que agregan los dos ítems:
//
//   A. Bitácora externa (libro PRIVADO del usuario del Portal):
//        · premio = monto × (2 − comisión%/100), es decir el par menos la
//          comisión del grupo (comisión 0 → par exacto 2×);
//        · `apostado` = todo menos las ANULADAS, `premios` = solo las GANÓ,
//          `neto` = premios − apostado, `pendiente` = solo las PENDIENTE
//          (mismas reglas que `resumenCuaderno`, para que no haya dos libros);
//        · estados y validaciones no se rompen con tildes, espacios o basura.
//   B. Formas de pago múltiples (FormaPago):
//        · `formasPagoDe` respalda al formato viejo (`metodo_pago` +
//          `datos_pago`) cuando `formas_pago` está vacío → nadie pierde datos;
//        · `normalizarFormasPago` deja UNA sola principal, sin `uid` y con
//          `datos` en null si no aporta nada → jsonb siempre limpio.
//
//   C. Aislamiento (leído del fuente y del SQL): la bitácora vive en tablas
//      propias con RLS SIN policies, toda escritura se ancla al cliente del
//      token, y ni el SQL ni la Edge Function tocan los grupos oficiales.
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ESTADOS_JUGADA_EXTERNA,
  normalizarEstadoJugada,
  premioGrupoExterno,
  resumenGrupoExterno,
  validarGrupoExterno,
  validarJugadaExterna,
  type JugadaExterna,
} from "../src/features/portal/lib/bitacoraExterna";
import {
  formasPagoDe,
  formaPagoPrincipal,
  normalizarFormasPago,
  nuevaFormaPago,
  resumenFormaPago,
  type FormaPago,
} from "../src/features/clientes/lib/formasPago";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => { pasan++; console.log(`  ok   ${m}`); };
const mal = (m: string, d?: string) => { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };
/** Condición booleana + mensaje: `verifica(cond, "qué cumple")`. */
const verifica = (cond: boolean, m: string) => (cond ? ok(m) : mal(m));
const igual = (real: unknown, esperado: unknown, m: string) =>
  JSON.stringify(real) === JSON.stringify(esperado)
    ? ok(`${m} -> ${JSON.stringify(real)}`)
    : mal(m, `esperado ${JSON.stringify(esperado)}, llego ${JSON.stringify(real)}`);

const jugada = (p: Partial<JugadaExterna>): JugadaExterna => ({
  id: 1,
  grupo_externo_id: 10,
  fecha: "2026-10-14",
  monto: 10,
  estado: "PENDIENTE",
  ...p,
});

console.log("\n== premio de un grupo externo: par menos la comisión ==");
igual(premioGrupoExterno(10, 0), 20, "comisión 0% → par exacto (2×)");
igual(premioGrupoExterno(10, 10), 19, "comisión 10% → $10 rinden $19");
igual(premioGrupoExterno(10, 100), 10, "comisión 100% → solo devuelve lo apostado");
igual(premioGrupoExterno("12.5", 5), 24.38, "monto como string (numeric de PostgREST)");
igual(premioGrupoExterno(null, null), 0, "null → 0");
igual(premioGrupoExterno(-50, -10), 0, "negativos → 0");

console.log("\n== resumen de la bitácora (mismas reglas que el Cuaderno) ==");
const js: JugadaExterna[] = [
  jugada({ id: 1, monto: 10, estado: "GANÓ" }),
  jugada({ id: 2, monto: 20, estado: "PERDIÓ" }),
  jugada({ id: 3, monto: 8, estado: "PENDIENTE" }),
  jugada({ id: 4, monto: 5, estado: "ANULADA" }),
  jugada({ id: 5, monto: "12", estado: "Pasada" }), // estado desconocido: no rompe
];
const r = resumenGrupoExterno(js, 10);
igual(r.jugadas, 5, "cuenta todas las jugadas");
igual(r.apostado, 50, "apostado = todo MENOS la anulada (10+20+8+12)");
igual(r.premios, 19, "premios = solo GANÓ, con la comisión del grupo ya descontada");
igual(r.neto, -31, "neto = premios − apostado");
igual(r.pendiente, 20, "pendiente = todo lo que no está resuelto (8 + 12 de estado desconocido)");
igual([r.ganadas, r.perdidas, r.anuladas], [1, 1, 1], "conteo por estado");

console.log("\n== estados y validaciones ==");
igual(normalizarEstadoJugada("ganó"), "GANÓ", "minúsculas y sin tilde → GANÓ");
igual(normalizarEstadoJugada(" pendiente "), "PENDIENTE", "con espacios → PENDIENTE");
igual(normalizarEstadoJugada("Pasada"), "PENDIENTE", "estado desconocido → PENDIENTE");
igual(normalizarEstadoJugada(undefined), "PENDIENTE", "vacío → PENDIENTE");
igual(ESTADOS_JUGADA_EXTERNA.length, 4, "los cuatro estados del PROMPT #7");
verifica(validarJugadaExterna({ fecha: "", monto: 10, estado: "PENDIENTE" }) !== null, "sin fecha → error");
verifica(validarJugadaExterna({ fecha: "2026-10-14", monto: 0, estado: "PENDIENTE" }) !== null, "monto 0 → error");
verifica(validarJugadaExterna({ fecha: "2026-10-14", monto: 5, estado: "PAGADA" }) !== null, "estado fuera del catálogo → error");
igual(validarJugadaExterna({ fecha: "2026-10-14", monto: 5, estado: "GANÓ" }), null, "jugada válida → null");
verifica(validarGrupoExterno({ nombre: "   ", comision_pct: 10 }) !== null, "grupo sin nombre → error");
verifica(validarGrupoExterno({ nombre: "EL CLUB", comision_pct: 150 }) !== null, "comisión mayor a 100 → error");
igual(validarGrupoExterno({ nombre: "EL CLUB", comision_pct: "10" }), null, "grupo válido → null");

console.log("\n== formas de pago: respaldo al formato legacy ==");
igual(formasPagoDe(null).length, 0, "cliente null → []");
igual(formasPagoDe({}).length, 0, "sin datos de pago → []");
const legacy = formasPagoDe({ metodo_pago: "PAGO MÓVIL", datos_pago: { codigo: "0134", nombre: "BANESCO" } });
igual(legacy.length, 1, "legacy: una sola forma de pago");
igual(legacy[0].metodo, "PAGO MÓVIL", "toma el método viejo");
verifica(legacy[0].principal === true, "la del legacy queda como ⭐ principal");
verifica(typeof legacy[0].uid === "string" && legacy[0].uid!.length > 0, "recibe uid de UI para el formulario");
igual(legacy[0].datos?.codigo, "0134", "arrastra los datos viejos");

const nuevo = formasPagoDe({
  formas_pago: [
    { metodo: "ZELLE", moneda: "USD", principal: false, datos: { tipo_contacto: "correo", dato: "a@b.com" } },
    { metodo: "PAGO MÓVIL", moneda: "VES", principal: true, datos: { codigo: "0105" } },
  ],
  metodo_pago: "PAGO MÓVIL",
  datos_pago: null,
});
igual(nuevo.length, 2, "prefiere el arreglo nuevo cuando existe");
igual(nuevo.map((f) => f.metodo), ["ZELLE", "PAGO MÓVIL"], "respeta el orden guardado");

const cae = formasPagoDe({ formas_pago: [{ sin_metodo: true }], metodo_pago: "ZELLE" });
igual(cae.length, 1, "arreglo sin ningún método válido cae al legacy");
igual(cae[0].metodo, "ZELLE", "…y en ese caso manda el par viejo");

console.log("\n== normalizarFormasPago (lo que se guarda en jsonb) ==");
igual(normalizarFormasPago([]), [], "lista vacía → []");
igual(normalizarFormasPago(null), [], "null → []");
const sucias: FormaPago[] = [
  { uid: "a", metodo: "", principal: true, datos: null }, // sin método: se descarta
  { uid: "b", metodo: " ZELLE ", moneda: "usd", principal: false, datos: { tipo_contacto: "correo", dato: "a@b.com" } },
  { uid: "c", metodo: "EFECTIVO", principal: true, datos: {} },
];
const limpia = normalizarFormasPago(sucias);
igual(limpia.length, 2, "descarta la fila sin método");
igual(limpia.map((f) => f.principal), [false, true], "exactamente una principal (la marcada que sobrevivió)");
verifica(limpia.every((f) => f.uid === undefined), "el uid de UI no se persiste");
igual(limpia[0].metodo, "ZELLE", "metodo recortado");
igual(limpia[0].moneda, "USD", "moneda a mayúsculas con default");
igual(limpia[1].datos, null, "datos sin contenido → null");
const ninguna = normalizarFormasPago([{ metodo: "A" }, { metodo: "B" }]);
igual(ninguna.map((f) => f.principal), [true, false], "sin ninguna marcada, la primera queda principal");
igual(formaPagoPrincipal([]), null, "principal de lista vacía → null");
igual(formaPagoPrincipal([{ metodo: "A" }, { metodo: "B" }])?.metodo, "A", "principal = primera");
const etiqueta = resumenFormaPago({ metodo: "ZELLE", moneda: "USD", datos: { tipo_contacto: "correo", dato: "juan@correo.com" } });
verifica(etiqueta.includes("ZELLE") && etiqueta.includes("USD"), `etiqueta método + moneda -> "${etiqueta}"`);
igual(resumenFormaPago(null), "", "sin forma → etiqueta vacía");
verifica(nuevaFormaPago().uid !== nuevaFormaPago().uid, "cada forma nueva recibe un uid distinto");
igual(nuevaFormaPago({ metodo: "BINANCE" }).moneda, "USD", "moneda por defecto al agregar");

// ----------------------------------------------------------------------------
// C. Aislamiento: la bitácora personal no toca los grupos oficiales.
// ----------------------------------------------------------------------------
console.log("\n== aislamiento: SQL de la bitácora ==");
const raiz = process.cwd();
const sinComentariosSql = (t: string) => t.replace(/--[^\n]*/g, "");
const sqlGrupos = readFileSync(join(raiz, "sql", "portal_grupos_externos.sql"), "utf8");
const sqlGruposCodigo = sinComentariosSql(sqlGrupos);
verifica(/enable row level security/.test(sqlGrupos), "RLS habilitado en las dos tablas");
verifica(!/create policy/i.test(sqlGrupos), "SIN policy: anon y authenticated no ven nada, solo service_role");
verifica(/on delete cascade/.test(sqlGruposCodigo), "borrar al cliente o al grupo se lleva su bitácora");
verifica(
  !/tickets_apuestas|grupos_venta|cuaderno_jugadas|saldo/.test(sqlGruposCodigo),
  "sin ninguna clave hacia tickets, grupos oficiales ni saldos"
);
verifica(/portal_grupos_externos/.test(sqlGruposCodigo) && /portal_jugadas_externas/.test(sqlGruposCodigo), "crea las dos tablas propias");

console.log("\n== aislamiento: Edge Function portal-auth ==");
const edge = readFileSync(join(raiz, "supabase", "functions", "portal-auth", "index.ts"), "utf8");
const sinComentarios = (t: string) =>
  t
    .split(/\r?\n/)
    .map((l) => (l.trim().startsWith("//") ? "" : l.split("//")[0]))
    .join("\n");

const iniBit = edge.indexOf("// --- 📓 Grupos externos");
const finBit = edge.indexOf("// --- imagen de reclamo");
verifica(iniBit >= 0 && finBit > iniBit, "las acciones de la bitácora existen en la Edge Function");
const bloqueBit = sinComentarios(edge.slice(iniBit, finBit));
verifica(
  !/tickets_apuestas|grupos_venta|cuaderno_jugadas|saldo_actual/.test(bloqueBit),
  "esas acciones no tocan tickets, grupos oficiales ni saldos"
);
verifica(
  (bloqueBit.match(/\.eq\("cliente_id", cid\)/g) ?? []).length >= 5,
  "toda lectura/escritura se ancla al cliente que validó su token"
);
verifica(/insert\(\[\{ cliente_id: cid/.test(bloqueBit), "el alta también cuelga el cliente_id del servidor");

const iniPerfil = edge.indexOf("// --- 👤 Mi Perfil");
const bloquePerfil = sinComentarios(edge.slice(iniPerfil, iniBit));
verifica(iniPerfil >= 0 && iniPerfil < iniBit, "la acción `perfil` (autogestión) existe");
const prohibidas = ['"saldo_actual"', '"comision"', '"devolucion"', '"aval"', '"portal_token"', '"portal_habilitado"', '"grupo_id"'];
verifica(prohibidas.every((c) => !bloquePerfil.includes(c)), "perfil: ninguna columna financiera ni de permisos en la lista blanca");
verifica(
  bloquePerfil.includes('"nombre"') && bloquePerfil.includes('"email"') && bloquePerfil.includes('"telefono"') && bloquePerfil.includes("formas_pago"),
  "perfil: acepta identidad, contacto y formas de pago"
);
verifica(bloquePerfil.includes("portal_clave") && bloquePerfil.includes("clave_actual"), "perfil: cambiar el PIN exige el PIN actual");
verifica(bloquePerfil.includes("sanitizarFormasPago"), "perfil: el jsonb pasa por un sanitizador del lado del servidor");

console.log("\n== pantallas del PROMPT #7 ==");
const portalMod = readFileSync(join(raiz, "src", "features", "portal", "components", "PortalModule.tsx"), "utf8");
verifica(portalMod.includes("Mi Control en Otros Grupos"), "existe la pestaña 📓 Mi Control en Otros Grupos (Personal)");
verifica(portalMod.includes("MiPerfilModal") && portalMod.includes("actualizarMiPerfil"), "existe 👤 Mi Perfil con guardado directo");
verifica(portalMod.includes("🔒"), "la bitácora avisa que está aislada de los grupos oficiales");
const modal = readFileSync(join(raiz, "src", "features", "clientes", "components", "ModalCliente.tsx"), "utf8");
verifica(modal.includes("FormasPagoLista"), "ModalCliente usa el listado dinámico (➕/🗑️)");
verifica(modal.includes("formas_pago: formasGuardables"), "ModalCliente persiste formas_pago");
verifica(modal.includes("metodo_pago: principal?.metodo"), "…y espeja la principal en metodo_pago (compatibilidad)");
const cuadre = readFileSync(join(raiz, "src", "features", "clientes", "components", "ClientesModule.tsx"), "utf8");
verifica(cuadre.includes("celdaFormasPago"), "el Cuadre Semanal muestra las formas de pago al pagar/cobrar");

console.log(`\n  ${pasan} ok, ${fallan} fallaron`);
if (fallan > 0) process.exit(1);
