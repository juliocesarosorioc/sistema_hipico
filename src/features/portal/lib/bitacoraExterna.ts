/**
 * BITÁCORA PERSONAL DE JUGADAS EN OTROS GRUPOS EXTERNOS (PROMPT #7).
 *
 * El usuario del Portal también juega por su cuenta en grupos que NO están en
 * la plataforma (un amigo, una agencia, un "grupo" de palabra). Esta bitácora
 * es su libro de control PRIVADO: cada usuario crea sus grupos externos
 * (nombre, moneda, % de comisión) y anota sus jugadas con fecha, hipódromo,
 * carrera, tipo de jugada, ejemplares, monto y estado.
 *
 * AISLAMIENTO (lo importante):
 *  - vive en tablas propias (`portal_grupos_externos` y `portal_jugadas_externas`,
 *    ver sql/portal_grupos_externos.sql), no en `tickets_apuestas` ni en `cuaderno_jugadas`;
 *  - NO toca `tickets_apuestas`, la caja, los saldos ni ningún reporte de los
 *    grupos oficiales: es un libro de anotación, igual que el Cuaderno del admin;
 *  - nadie más la ve: las tablas tienen RLS sin políticas y solo la Edge
 *    Function `portal-auth` (service_role) las lee, siempre anclada al cliente
 *    que validó su token.
 *
 * Este módulo es PURO (sin Supabase): contiene los tipos, las validaciones y
 * el cálculo del resumen, para poder probarlo sin red
 * (pruebas/bitacora-externa.test.ts). La entrada y salida de datos vive en
 * `portal.ts`.
 */

/** Estados posibles de una jugada externa (los pide el PROMPT #7). */
export const ESTADOS_JUGADA_EXTERNA = ["PENDIENTE", "GANÓ", "PERDIÓ", "ANULADA"] as const;

export type EstadoJugadaExterna = (typeof ESTADOS_JUGADA_EXTERNA)[number];

export const ESTADO_POR_DEFECTO: EstadoJugadaExterna = "PENDIENTE";

/** Grupos externos que creó el usuario en su portal. */
export type GrupoExterno = {
  id: string | number;
  nombre: string;
  /** Moneda en la que se juega en ese grupo (USD, VES…). */
  moneda?: string | null;
  /** % de comisión que se lleva ese grupo (0–100). */
  comision_pct?: number | string | null;
  creado_at?: string | null;
};

/** Una jugada registrada en un grupo externo. */
export type JugadaExterna = {
  id: string | number;
  grupo_externo_id: string | number;
  fecha?: string | null;
  hipodromo?: string | null;
  carrera?: number | string | null;
  tipo_jugada?: string | null;
  ejemplares?: string | null;
  monto?: number | string | null;
  estado?: string | null;
  creado_at?: string | null;
};

const num = (v: number | string | null | undefined): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

/** Acepta el valor tal cual (tildes y mayúsculas incluidas) o cae al default. */
export function normalizarEstadoJugada(v: unknown): EstadoJugadaExterna {
  const t = String(v ?? "")
    .trim()
    .toUpperCase();
  return (ESTADOS_JUGADA_EXTERNA as readonly string[]).includes(t)
    ? (t as EstadoJugadaExterna)
    : ESTADO_POR_DEFECTO;
}

export function esEstadoJugadaExterna(v: unknown): v is EstadoJugadaExterna {
  const t = String(v ?? "").trim().toUpperCase();
  return (ESTADOS_JUGADA_EXTERNA as readonly string[]).includes(t);
}

/**
 * Lo que se le paga al ganar en un grupo externo: el "par" (2×) menos la
 * comisión de ese grupo.
 *
 * Con monto M y comisión C%:  ganancia = M × (100 − C) / 100, y el grupo te
 * devuelve el monto apostado + la ganancia. Con C = 0 es un par exacto (2M);
 * con C = 10 un M de $10 rinde $19 (+$9). Es la convención que la bitácora
 * muestra en la UI junto al resumen, para que el "Neto" no sea un misterio.
 */
export function premioGrupoExterno(
  monto: number | string | null | undefined,
  comisionPct: number | string | null | undefined
): number {
  const m = Math.max(0, num(monto));
  const c = Math.min(100, Math.max(0, num(comisionPct)));
  return Math.round((m + (m * (100 - c)) / 100) * 100) / 100;
}

/** Totales del resumen de una bitácora (por grupo o global). */
export type ResumenGrupoExterno = {
  jugadas: number;
  /** Monto apostado: todo menos las ANULADAS (una anulada no mueve dinero). */
  apostado: number;
  /** Premios de las GANÓ, con la comisión del grupo ya descontada. */
  premios: number;
  /** premios − apostado. */
  neto: number;
  /** Monto todavía en riesgo (PENDIENTE). */
  pendiente: number;
  ganadas: number;
  perdidas: number;
  anuladas: number;
};

/**
 * Resumen de la bitácora personal.
 *
 * Reglas:
 *  - `apostado` = Σ monto de las que NO están ANULADA (una anulada se devuelve,
 *    así que no es plata en riesgo).
 *  - `premios`  = Σ `premioGrupoExterno` de las GANÓ (con la comisión del grupo).
 *  - `neto`     = premios − apostado; `pendiente` = Σ monto de las PENDIENTE.
 *  - Un estado desconocido (tilde mal puesta, texto heredado) se cuenta como
 *    PENDIENTE, no como perdida: la plata sigue en riesgo y no hay premio.
 *    Así el total `pendiente` nunca contradice a la fila, que en la tabla se
 *    muestra como PENDIENTE (mismo criterio defensivo que el Cuaderno).
 */
export function resumenGrupoExterno(
  jugadas: JugadaExterna[] | null | undefined,
  comisionPct: number | string | null | undefined
): ResumenGrupoExterno {
  const r: ResumenGrupoExterno = {
    jugadas: 0,
    apostado: 0,
    premios: 0,
    neto: 0,
    pendiente: 0,
    ganadas: 0,
    perdidas: 0,
    anuladas: 0,
  };
  for (const j of jugadas ?? []) {
    r.jugadas += 1;
    const monto = Math.max(0, num(j.monto));
    const estado = normalizarEstadoJugada(j.estado);
    if (estado === "ANULADA") {
      r.anuladas += 1;
      continue;
    }
    r.apostado += monto;
    if (estado === "GANÓ") {
      r.ganadas += 1;
      r.premios += premioGrupoExterno(monto, comisionPct);
    } else if (estado === "PERDIÓ") {
      r.perdidas += 1;
    } else if (estado === "PENDIENTE") {
      r.pendiente += monto;
    }
  }
  r.apostado = Math.round(r.apostado * 100) / 100;
  r.premios = Math.round(r.premios * 100) / 100;
  r.neto = Math.round((r.premios - r.apostado) * 100) / 100;
  r.pendiente = Math.round(r.pendiente * 100) / 100;
  return r;
}

/**
 * Validación de un grupo externo (alta y edición).
 * Devuelve el mensaje de error, o `null` si está bien.
 */
export function validarGrupoExterno(g: {
  nombre?: string | null;
  comision_pct?: number | string | null;
}): string | null {
  const nombre = String(g.nombre ?? "").trim();
  if (!nombre) return "Poné un nombre al grupo externo (ej. EL CLUB DE JUAN).";
  if (nombre.length > 60) return "El nombre del grupo no puede superar 60 caracteres.";
  const com = num(g.comision_pct);
  if (String(g.comision_pct ?? "").trim() !== "" && (Number.isNaN(com) || com < 0 || com > 100)) {
    return "La comisión debe estar entre 0 y 100.";
  }
  return null;
}

/**
 * Validación de una jugada externa. Devuelve el mensaje, o `null` si sirve.
 *
 * La fecha es obligatoria (es la que ordena el libro), el monto tiene que ser
 * positivo y el estado tiene que ser uno de los cuatro del catálogo.
 */
export function validarJugadaExterna(j: {
  fecha?: string | null;
  monto?: number | string | null;
  estado?: string | null;
}): string | null {
  const fecha = String(j.fecha ?? "").trim();
  if (!fecha) return "Poné la fecha de la carrera.";
  if (Number.isNaN(new Date(fecha).getTime())) return "La fecha no es válida.";
  const monto = num(j.monto);
  if (!(monto > 0)) return "El monto tiene que ser mayor que cero.";
  if (!esEstadoJugadaExterna(j.estado)) return `Estado inválido: use ${ESTADOS_JUGADA_EXTERNA.join(" / ")}.`;
  return null;
}
