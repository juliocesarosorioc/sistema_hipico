/**
 * Múltiples formas de pago por cliente (PROMPT #7).
 *
 * Un mismo cliente puede tener varias formas de pago simultáneas —Pago Móvil,
 * Transferencia, Zelle, Binance/USDT, Efectivo, un banco…—, cada una con sus
 * datos específicos (banco, teléfono/correo, cédula/RIF, titular), su moneda y
 * una sola marcada como ⭐ Principal.
 *
 * Dónde vive la lista: la columna `clientes.formas_pago` (jsonb, ver
 * sql/formas_pago_clientes.sql), como arreglo de objetos
 * `{ metodo, moneda, principal, datos }`.
 *
 * COMPATIBILIDAD HACIA ATRÁS: antes solo existían `clientes.metodo_pago` +
 * `clientes.datos_pago` (UNA forma de pago). Estos helpers leen el arreglo
 * nuevo y, si está vacío o la columna todavía no existe en la fila, caen al
 * par legacy de forma transparente; `comun` en el ModalCliente escribe las dos
 * formas a la vez, de modo que los lectores viejos (tabla del Cuadre, tickets,
 * cualquier `select` de la cartera) siguen viendo la principal.
 *
 * Vive aparte de `clientes.ts` para que sea puro: este archivo solo importa
 * `vzla`, así que se puede probar sin tocar Supabase (pruebas/bitacora-externa.test.ts).
 */
import { resumenDatosPago, type DatosPago } from "@/shared/lib/vzla";

/** Una forma de pago del cliente. */
export type FormaPago = {
  /** Clave de UI (no se persiste: la saca `normalizarFormasPago`). */
  uid?: string;
  /** Método del catálogo (`listMetodosPago`): "PAGO MÓVIL", "ZELLE", "0134 · BANESCO"… */
  metodo: string;
  /** Moneda en la que se opera esta forma (USD, VES…). */
  moneda?: string;
  /** Exactamente una forma por cliente queda en `principal` (ver `normalizarFormasPago`). */
  principal?: boolean;
  /** Campos específicos del método (banco, teléfono/correo, cédula/RIF, titular…). */
  datos?: DatosPago | null;
};

/** Monedas ofrecidas en el selector de cada forma de pago. */
export const MONEDAS_PAGO = ["USD", "VES", "EUR", "ARS", "COP", "BRL"];

let secuencia = 0;

/**
 * Forma de pago nueva con `uid` fresco.
 *
 * El `uid` identifica la fila en el formulario: sirve para que `DatosPagoForm`
 * mantenga su propio "inicial" por fila (ver `FormasPagoLista`) y para que
 * agregar o quitar una fila no reutilice el estado de otra. Se genera acá para
 * que alta y edición arranquen con la misma rutina.
 */
export function nuevaFormaPago(p?: Partial<FormaPago>): FormaPago {
  secuencia += 1;
  return {
    uid: `fp-${Date.now().toString(36)}-${secuencia}`,
    metodo: p?.metodo ?? "",
    moneda: (p?.moneda ?? "USD").toUpperCase(),
    principal: p?.principal ?? false,
    datos: p?.datos ?? null,
  };
}

/** Lo que `clientes` puede traer en las columnas de pago. */
export type ClientePago = {
  formas_pago?: unknown;
  metodo_pago?: string | null;
  datos_pago?: DatosPago | null;
};

function aObjeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function aForma(v: unknown): FormaPago | null {
  const o = aObjeto(v);
  if (!o) return null;
  // `datos` es el nombre nuevo; `datos_pago` se acepta por si una fila se
  // escribió con el par legacy dentro del arreglo.
  const datos = (aObjeto(o.datos) ?? aObjeto(o.datos_pago) ?? null) as DatosPago | null;
  const metodo = String(o.metodo ?? "").trim();
  if (!metodo) return null;
  return nuevaFormaPago({
    metodo,
    moneda: String(o.moneda ?? "USD"),
    principal: o.principal === true,
    datos,
  });
}

/**
 * Lee las formas de pago de un cliente, con respaldo al formato legacy.
 *
 *  1. `formas_pago` con filas válidas → ese arreglo.
 *  2. `metodo_pago` (+ `datos_pago`) → una sola forma, marcada como principal.
 *  3. Nada → `[]`.
 *
 * El paso 2 es lo que mantiene compatibilidad hacia atrás: los clientes dados
 * de alta antes de sql/formas_pago_clientes.sql (y cualquier fila leída antes
 * de correr la migración) se comportan igual que siempre.
 */
export function formasPagoDe(c: ClientePago | null | undefined): FormaPago[] {
  if (!c) return [];
  let bruto: unknown = c.formas_pago;
  if (typeof bruto === "string") {
    try {
      bruto = JSON.parse(bruto);
    } catch {
      bruto = null;
    }
  }
  if (Array.isArray(bruto)) {
    const filas = bruto.map(aForma).filter((f): f is FormaPago => f !== null);
    if (filas.length) return filas;
  }
  const metodo = String(c.metodo_pago ?? "").trim();
  if (!metodo) return [];
  return [nuevaFormaPago({ metodo, principal: true, datos: c.datos_pago ?? null })];
}

/**
 * Normaliza antes de guardar:
 *  - descarta las filas sin método (una fila a medio cargar no es una forma),
 *  - marca UNA sola principal (la primero que venga marcada, o la primera),
 *  - pone moneda por defecto y vacía `datos` cuando no tiene contenido,
 *  - devuelve el arreglo sin `uid` (es estado de formulario, no dato).
 */
export function normalizarFormasPago(lista: FormaPago[] | null | undefined): FormaPago[] {
  const limpias = (lista ?? []).filter((f) => String(f?.metodo ?? "").trim() !== "");
  if (!limpias.length) return [];
  let principalIdx = limpias.findIndex((f) => f.principal === true);
  if (principalIdx < 0) principalIdx = 0;
  return limpias.map((f, i) => {
    const d = aObjeto(f.datos) as DatosPago | null;
    return {
      metodo: String(f.metodo).trim(),
      moneda: String(f.moneda ?? "").trim().toUpperCase() || "USD",
      principal: i === principalIdx,
      datos: d && Object.keys(d).length ? d : null,
    };
  });
}

/** La forma ⭐ Principal (o la primera, si ninguna viene marcada). */
export function formaPagoPrincipal(lista: FormaPago[] | null | undefined): FormaPago | null {
  const l = normalizarFormasPago(lista);
  return l.length ? l[0] : null;
}

/**
 * Etiqueta para mostrar al pagar o cobrar:
 * "PAGO MÓVIL · USD · BANESCO (0105) Telf •4567".
 */
export function resumenFormaPago(f: FormaPago | null | undefined): string {
  if (!f || !f.metodo) return "";
  const detalle = resumenDatosPago(f.datos ?? null);
  const moneda = String(f.moneda ?? "").trim().toUpperCase();
  return [f.metodo, moneda, detalle].filter(Boolean).join(" · ");
}

/**
 * Espejo de `resumenNotificacion` para el par legacy `metodo_pago`+`datos_pago`:
 * una línea legible de lo que trae esa notificación de datos del portal.
 */
export function resumenFormasPago(lista: FormaPago[] | null | undefined): string {
  const l = normalizarFormasPago(lista);
  return l.map((f, i) => `${i === 0 ? "⭐ " : ""}${resumenFormaPago(f)}`).join(" | ");
}
