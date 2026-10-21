/**
 * ============================================================================
 * FASE 1 · 1.2 — ESTRUCTURADOR DE JUGADAS CON IA (núcleo PURO)
 * ============================================================================
 *
 * La Capa 2 (Edge Function `normalizar-jugadas`) antes solo REESCRIBÍA el texto
 * dictado y devolvía `{ lineas: string[] }`. Con eso la IA no aportaba
 * estructura: el cliente volvía a parsear con el normalizador local difuso, que
 * es exactamente lo que ya hace la Capa 1 — la IA quedaba de adorno.
 *
 * Acá vive el núcleo de la versión ESTRUCTURADA: define el shape que el modelo
 * debe devolver, lo NORMALIZA (tolera strings, números, campos ausentes) y
 * calcula la CONFIANZA GLOBAL de cada jugada. Con esa confianza decide si la
 * fila se puede PRE-ARMAR sola (>95% y sin aval-límite) o si necesita revisión
 * de 1 clic.
 *
 * REGLA DE ORO: esto NUNCA vende. Solo deja el BetSlip pre-armado; un humano
 * confirma con 1 clic. Si algo no cuadra, la fila vuelve a "revisar".
 *
 * Módulo determinista y sin I/O: lo consumen tanto la Edge Function (misma
 * lógica) como la UI y las pruebas de node.
 */

import { validarComando } from "@/features/taquilla/lib/validar";

/** Umbral de confianza global para pre-armar sin revisión (95%). */
export const UMBRAL_PRE_ARMAR = 0.95;

/** Confianza por campo que reporta el modelo (0..1). */
export type ConfianzaCampoIA = {
  jugada: number;
  caballo: number;
  monto: number;
  cliente1: number;
  cliente2: number;
};

/**
 * Una jugada ya estructurada por la IA, lista para pre-armar el BetSlip.
 * `avisos` son observaciones legibles (campos no resueltos, dudas del modelo).
 */
export type JugadaEstructurada = {
  /** Texto original de la línea (para mostrar de dónde salió). */
  linea: string;
  monto: string;
  jugada: string;
  caballo: string;
  cliente1: string;
  cliente2: string;
  confianza: ConfianzaCampoIA;
  /** Confianza global: el mínimo de los campos presentes (lo más débil manda). */
  confianzaGlobal: number;
  avisos: string[];
};

/** Resultado de una fila tras evaluar coherencia y umbral. */
export type EvaluacionJugada =
  | { accion: "pre-armar"; jugada: JugadaEstructurada }
  | { accion: "revisar"; jugada: JugadaEstructurada; motivo: string };

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** Texto seguro y acotado (el modelo a veces mete saltos o comillas raras). */
const texto = (v: unknown, max = 200): string => String(v ?? "").trim().slice(0, max);

/**
 * Lee una confianza tolerante: acepta número (0..1), porcentaje ("97" · "97%"),
 * texto ("alta" → 0.9) o ausente (→ 0). Nunca lanza.
 */
export function leerConfianza(v: unknown): number {
  if (typeof v === "number") return clamp01(v > 1 ? v / 100 : v);
  const s = texto(v).toLowerCase().replace("%", "").replace(",", ".");
  if (!s) return 0;
  const n = parseFloat(s);
  if (Number.isFinite(n)) return clamp01(n > 1 ? n / 100 : n);
  if (/^(alta|exacto|exacta|si|sí)$/.test(s)) return 0.9;
  if (/^(media|medio|aproximad[oa])$/.test(s)) return 0.6;
  return 0;
}

/**
 * Normaliza UNA fila cruda del modelo a `JugadaEstructurada`. Nunca lanza:
 * lo que falte queda vacío y baja la confianza. Un campo sin confianza explícita
 * hereda 1 si vino con dato no vacío, o 0 si vino vacío.
 */
export function normalizarJugadaIA(cruda: unknown): JugadaEstructurada | null {
  if (!cruda || typeof cruda !== "object") return null;
  const o = cruda as Record<string, unknown>;
  const conf = (o.confianza ?? {}) as Record<string, unknown>;

  const monto = texto(o.monto, 40);
  const jugada = texto(o.jugada, 40);
  const caballo = texto(o.caballo, 8);
  const cliente1 = texto(o.cliente1, 120);
  const cliente2 = texto(o.cliente2, 120);

  // Si el modelo no reportó confianza de un campo, se infiere de si trajo dato.
  const auto = (campo: string, valor: string): number =>
    campo in conf ? leerConfianza(conf[campo]) : valor ? 1 : 0;

  const confianza: ConfianzaCampoIA = {
    jugada: auto("jugada", jugada),
    caballo: auto("caballo", caballo),
    monto: auto("monto", monto),
    cliente1: auto("cliente1", cliente1),
    cliente2: auto("cliente2", cliente2),
  };

  const avisos: string[] = [];
  if (Array.isArray(o.avisos)) for (const a of o.avisos) {
    const t = texto(a, 160);
    if (t) avisos.push(t);
  }

  // La confianza global es el MÍNIMO de los campos que la fila necesita para
  // venderse: monto, jugada y caballo. El cliente2 es opcional (dador), así que
  // solo penaliza si el modelo dijo algo de él y quedó flojo.
  const obligatorios = [confianza.monto, confianza.jugada, confianza.caballo, confianza.cliente1];
  const confianzaGlobal = obligatorios.length ? Math.min(...obligatorios) : 0;

  return {
    linea: texto(o.linea ?? o.texto ?? "", 400),
    monto,
    jugada,
    caballo,
    cliente1,
    cliente2,
    confianza,
    confianzaGlobal: clamp01(confianzaGlobal),
    avisos,
  };
}

/** Normaliza el array completo que devolvió la Edge Function. */
export function normalizarJugadasIA(crudas: unknown): JugadaEstructurada[] {
  if (!Array.isArray(crudas)) return [];
  const out: JugadaEstructurada[] = [];
  for (const c of crudas) {
    const j = normalizarJugadaIA(c);
    if (j) out.push(j);
  }
  return out;
}

/**
 * ¿La jugada es COHERENTE? El monto y la jugada tienen que pasar el MISMO motor
 * que usa la venta real (`validarComando`): si el estructurador devolvió algo que
 * el motor rechaza, la fila no se pre-arma. Esto evita que la IA "invente" una
 * jugada que después revienta al cobrar.
 */
export function esJugadaCoherente(j: JugadaEstructurada): { ok: boolean; motivo?: string } {
  const comando = [j.monto, j.jugada].map((s) => s.trim()).filter(Boolean).join(" ");
  if (!comando) return { ok: false, motivo: "La IA no devolvió monto ni jugada." };
  const caballo = /^\d{1,2}$/.test(j.caballo) ? j.caballo : undefined;
  const v = validarComando(comando, undefined, caballo);
  if (!v.ok) return { ok: false, motivo: v.motivo || "La jugada no es coherente según el motor." };
  return { ok: true };
}

/**
 * Decide qué hacer con una jugada estructurada: PRE-ARMAR sola (confianza >95%,
 * coherente y con cliente) o dejarla para REVISIÓN de 1 clic.
 *
 * `avalOk` llega de la capa de saldos (avisar si el aval-límite topa): el
 * pre-armado NUNCA pisa el tope. Si el disponible no alcanza, se revisa.
 */
export function evaluarJugadaIA(j: JugadaEstructurada, avalOk = true): EvaluacionJugada {
  const coherencia = esJugadaCoherente(j);
  if (!coherencia.ok) return { accion: "revisar", jugada: j, motivo: coherencia.motivo ?? "Incoherente." };
  if (!j.cliente1) return { accion: "revisar", jugada: j, motivo: "Falta el cliente que juega." };
  if (!j.caballo) return { accion: "revisar", jugada: j, motivo: "Falta el ejemplar." };
  if (!avalOk) return { accion: "revisar", jugada: j, motivo: "El disponible del cliente no alcanza el monto." };
  if (j.confianzaGlobal <= UMBRAL_PRE_ARMAR) {
    return {
      accion: "revisar",
      jugada: j,
      motivo: `Confianza ${(j.confianzaGlobal * 100).toFixed(0)}% ≤ ${UMBRAL_PRE_ARMAR * 100}%.`,
    };
  }
  return { accion: "pre-armar", jugada: j };
}

/** Evalúa un lote completo (para la vista previa del modal). */
export function evaluarLoteIA(jugadas: JugadaEstructurada[], avalPorJugada?: boolean[]): EvaluacionJugada[] {
  return jugadas.map((j, i) => evaluarJugadaIA(j, avalPorJugada ? avalPorJugada[i] !== false : true));
}

/**
 * El SHAPE que el modelo debe devolver (espejo del `response_format` de la Edge
 * Function). Se expone para mantener una sola fuente de verdad entre el servidor
 * y la UI: si el schema cambia, cambia en un lugar.
 */
export const SCHEMA_JUGADAS_IA = {
  type: "object",
  properties: {
    jugadas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          linea: { type: "string" },
          monto: { type: "string" },
          jugada: { type: "string" },
          caballo: { type: "string" },
          cliente1: { type: "string" },
          cliente2: { type: "string" },
          confianza: {
            type: "object",
            properties: {
              jugada: { type: "number" },
              caballo: { type: "number" },
              monto: { type: "number" },
              cliente1: { type: "number" },
              cliente2: { type: "number" },
            },
            required: ["jugada", "caballo", "monto", "cliente1", "cliente2"],
            additionalProperties: false,
          },
          avisos: { type: "array", items: { type: "string" } },
        },
        required: ["linea", "monto", "jugada", "caballo", "cliente1", "cliente2", "confianza", "avisos"],
        additionalProperties: false,
      },
    },
  },
  required: ["jugadas"],
  additionalProperties: false,
} as const;
