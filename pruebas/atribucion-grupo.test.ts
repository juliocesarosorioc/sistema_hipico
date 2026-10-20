// ============================================================================
// PROMPT #5 · "REGLA DE ORO CONTABLE" — ATRIBUCIÓN DE CUENTA ENTRE GRUPOS
//
// Cuando un usuario de un Grupo Secundario (B) juega sobre la cartelera del
// GRUPO PRINCIPAL, la jugada queda:
//
//   grupo_publicador_id = PRINCIPAL   (quién publicó la jugada)
//   grupo_cuenta_id     = B           (a quién le da cuenta el jugador)
//
// Financieramente el jugador cobra y paga su saldo/cuaderno DIRECTAMENTE a su
// propio grupo (B). El sistema registra el cruce/comisión por convenio entre B
// y el Principal.
//
// Qué protege esta prueba:
//   1. El núcleo puro (`atribucion-grupo.ts`): el enrutamiento, la señal de
//      cruce, las columnas a escribir y las caídas tolerantes a la migración.
//   2. La escritura (`marcar-atribucion.ts`): NO escribe sin cruce real, NO
//      revienta la venta y avisa cuando falta la migración.
//   3. El Reporte de Comisiones (`reporte-comisiones.ts`): calcula el convenio
//      sobre el grupo de CUENTA (con respaldo a `grupo_cobro_id`).
//   4. El call site (`BetSlip.tsx`) enruta la cuenta al grupo del cliente.
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  atribuirJugada,
  atribuirDesdePrincipal,
  esCruceDeGrupos,
  columnasAtribucion,
  grupoDeCuenta,
  grupoPublicador,
} from "../src/features/grupos/lib/atribucion-grupo";
import type { GrupoVisibilidad } from "../src/features/grupos/lib/visibilidad-principal";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => { pasan++; console.log(`  ok   ${m}`); };
const mal = (m: string, d?: string) => { fallan++; console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`); };
const si = (c: boolean, m: string, d?: string) => (c ? ok(m) : mal(m, d));
const igual = (a: unknown, b: unknown, m: string) =>
  si(JSON.stringify(a) === JSON.stringify(b), m, `esperado ${JSON.stringify(b)} · recibido ${JSON.stringify(a)}`);

const raiz = process.cwd();
const leer = (...partes: string[]) => readFileSync(join(raiz, ...partes), "utf8");

const grupos: GrupoVisibilidad[] = [
  { id: "A", es_principal: false },
  { id: "P", es_principal: true },
  { id: "B", es_principal: false },
];

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 1 — el caso estrella: B juega sobre la cartelera del Principal");
// ---------------------------------------------------------------------------
const estrella = atribuirJugada("B", "P", grupos);
igual(estrella.publicadorId, "P", "publicador = Principal");
igual(estrella.cuentaId, "B", "cuenta = grupo del usuario (B)");
si(estrella.cruzada, "es un CRUCE real (B ≠ P)");
si(estrella.desdePrincipal, "marca que salió del Principal");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 2 — sin cruce: mismo grupo publica y cobra");
// ---------------------------------------------------------------------------
const mismo = atribuirJugada("P", "P", grupos);
igual(mismo.publicadorId, "P", "publicador = P");
igual(mismo.cuentaId, "P", "cuenta = P");
si(!mismo.cruzada, "no hay cruce cuando publicador == cuenta");
si(mismo.desdePrincipal, "sigue siendo del Principal");

const otro = atribuirJugada("B", "B", grupos);
igual(otro.publicadorId, "B", "publicador = B");
igual(otro.cuentaId, "B", "cuenta = B");
si(!otro.cruzada, "B sobre su propia cartelera: sin cruce");
si(!otro.desdePrincipal, "no salió del Principal");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 3 — publicación de un tercero y casos sin publicación");
// ---------------------------------------------------------------------------
const tercero = atribuirJugada("B", "A", grupos);
igual(tercero.publicadorId, "A", "publicador = dueño de la publicación (A)");
igual(tercero.cuentaId, "B", "cuenta = grupo del usuario (B)");
si(tercero.cruzada, "A ≠ B → cruce");
si(!tercero.desdePrincipal, "no es del Principal");

const sinPublicacion = atribuirJugada("B", null, grupos);
igual(sinPublicacion.publicadorId, "B", "sin publicación → publicador = quien vende");
igual(sinPublicacion.cuentaId, "B", "sin publicación → cuenta = quien vende (histórico)");
si(!sinPublicacion.cruzada, "sin publicación no hay cruce");

const vacios = atribuirJugada(null, null, grupos);
igual(vacios.publicadorId, "", "sin datos → publicador vacío");
igual(vacios.cuentaId, "", "sin datos → cuenta vacía");
si(!vacios.cruzada, "todo vacío → sin cruce");

const numericos = atribuirJugada(2, 1, [{ id: 1, es_principal: true }]);
igual(numericos.publicadorId, "1", "ids numéricos normalizados a texto");
igual(numericos.cuentaId, "2", "cuenta numérica normalizada");
si(numericos.cruzada, "1 ≠ 2 → cruce aunque vengan como números");
si(numericos.desdePrincipal, "detecta el principal numérico");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 4 — atajo atribuirDesdePrincipal");
// ---------------------------------------------------------------------------
const atajo = atribuirDesdePrincipal("B", "P", "P");
igual(atajo?.publicadorId, "P", "atajo: publicador = Principal");
igual(atajo?.cuentaId, "B", "atajo: cuenta = B");
si(atajo?.cruzada === true, "atajo: cruce");
si(atajo?.desdePrincipal === true, "atajo: desde el Principal");
igual(atribuirDesdePrincipal("B", "A", "P"), null, "publicación de A con principal P → NO aplica (null)");
igual(atribuirDesdePrincipal("B", "P", null), null, "sin principal conocido → null");
const atajoMismo = atribuirDesdePrincipal("P", "P", "P");
si(atajoMismo?.cruzada === false, "el principal jugando su propia cartelera no cruza");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 5 — señal de cruce y columnas a escribir");
// ---------------------------------------------------------------------------
si(esCruceDeGrupos(estrella), "esCruceDeGrupos: true en el caso estrella");
si(!esCruceDeGrupos(mismo), "esCruceDeGrupos: false sin cruce");
si(!esCruceDeGrupos(null), "esCruceDeGrupos: null → false");
si(!esCruceDeGrupos(undefined), "esCruceDeGrupos: undefined → false");

igual(
  columnasAtribucion(estrella),
  { grupo_cuenta_id: "B", grupo_publicador_id: "P" },
  "con cruce escribe cuenta Y publicador"
);
igual(
  columnasAtribucion(mismo),
  { grupo_cuenta_id: "P" },
  "sin cruce solo escribe la cuenta (no duplica grupo_cobro_id)"
);
igual(columnasAtribucion(atajoMismo!), { grupo_cuenta_id: "P" }, "el atajo sin cruce omite el publicador");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 6 — grupo de cuenta / publicador con respaldo histórico");
// ---------------------------------------------------------------------------
igual(grupoDeCuenta("B", "P", "P"), "B", "cuenta manda sobre publicador y cobro");
igual(grupoDeCuenta(null, "P", "P"), "P", "sin cuenta cae al publicador");
igual(grupoDeCuenta(null, null, "C"), "C", "sin cuenta ni publicador cae a grupo_cobro_id (migración a medias)");
igual(grupoDeCuenta(undefined, "", null), "", "todo vacío → cadena vacía");
igual(grupoDeCuenta(7, 9, 1), "7", "ids numéricos normalizados");

igual(grupoPublicador("P", "B", "B"), "P", "publicador manda sobre cuenta y cobro");
igual(grupoPublicador(null, "B", "B"), "B", "sin publicador cae a la cuenta");
igual(grupoPublicador(null, null, "C"), "C", "sin publicador ni cuenta cae al cobro histórico");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 7 — escritura: NO escribe sin cruce y no revienta la venta");
// ---------------------------------------------------------------------------
const marc = leer("src", "features", "grupos", "lib", "marcar-atribucion.ts");
si(/if \(!atribucion\.cruzada\)/.test(marc), "atribuirTrasVenta corta cuando no hay cruce");
si(/if \(!atribucion\) return \{ ok: true, marcados: 0 \}/.test(marc), "sin atribución no hace nada");
si(/columnasPresentes/.test(marc), "verifica que la migración esté aplicada antes de escribir");
si(/MENSAJE_SIN_MIGRACION/.test(marc), "avisa cuando faltan las columnas");
si(/NUNCA tira|MEJOR ESFUERZO/i.test(marc), "documenta el criterio de mejor esfuerzo (no revierte la venta)");
si(/\.update\(cols\)[\s\S]{0,120}\.in\("id", limpios\)/.test(marc), "actualiza por id en tickets_apuestas");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 8 — Reporte de Comisiones por grupo de CUENTA");
// ---------------------------------------------------------------------------
const rep = leer("src", "features", "grupos", "lib", "reporte-comisiones.ts");
si(/import \{ grupoDeCuenta \}/.test(rep), "el reporte importa grupoDeCuenta");
si(/grupoDeCuenta\(t\.grupo_cuenta_id, t\.grupo_publicador_id, t\.grupo_cobro_id\)/.test(rep), "usa la cuenta con respaldo al cobro histórico");
si(/grupo_cuenta_id\?:/.test(rep) && /grupo_publicador_id\?:/.test(rep), "FilaTicket expone las columnas nuevas");

// ---------------------------------------------------------------------------
console.log("\nBLOQUE 9 — call site: Taquilla enruta la cuenta al grupo del cliente");
// ---------------------------------------------------------------------------
const slip = leer("src", "features", "taquilla", "components", "BetSlip.tsx");
si(/import \{ atribuirTrasVenta \}/.test(slip), "BetSlip importa atribuirTrasVenta");
si(/import \{ atribuirDesdePrincipal \}/.test(slip), "BetSlip importa atribuirDesdePrincipal");
si(/atribuirDesdePrincipal\(grupoId, principal\.id, principal\.id\)/.test(slip), "la cuenta va al grupo del cliente y el publicador al Principal");
si(/atribuirTrasVenta\(\{ ids: \[venta\.ticketId\] \}, atr\)/.test(slip), "atribuye por el id del ticket recién vendido");
si(/sin atribuir cuenta/.test(slip), "avisa si no se pudo atribuir, sin romper la venta");

// ---------------------------------------------------------------------------
console.log(`\n${pasan} pasaron, ${fallan} fallaron`);
process.exit(fallan > 0 ? 1 : 0);
