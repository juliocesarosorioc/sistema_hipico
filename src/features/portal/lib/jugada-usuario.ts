/**
 * REALIZAR JUGADA DESDE EL PORTAL (PROMPT #6) — NÚCLEO PURO
 * =========================================================
 * El jugador, desde su Portal, arma una jugada y la registra. Son cuatro tipos,
 * los mismos que el prompt lista:
 *
 *   · TABLA_FIJA  → una tabla de un hipódromo/carrera, con sus ejemplares.
 *   · POLLA       → una polla (carreras 1ª a 6ª), por combinaciones.
 *   · DUPLETA     → un cruce de dos ejemplares de dos carreras (1ª y 2ª pata).
 *   · MARCA       → un caballo contra un rival.
 *
 * Este archivo NO llama a Supabase: valida la jugada, calcula un estimado y
 * arma el cuerpo que se le manda a la Edge Function `portal-auth`, que es la que
 * de verdad vende (con saldo, comisión y ticket, como cualquier venta de
 * taquilla). La separación importa: acá se prueba la lógica (montos, límites,
 * campos obligatorios) sin base de datos.
 *
 * ---------------------------------------------------------------------------
 * LA FRONTERA DE CONFIANZA
 * ---------------------------------------------------------------------------
 * El navegador no es la fuente de verdad. Todo lo que se valida acá es para dar
 * un mensaje lindo ANTES de molestar al servidor, y para no mandar basura. La
 * RPC de venta vuelve a validar grupo, cliente, saldo, aval y jerarquía, y es
 * ella —no este archivo— la que decide si la jugada existe.
 */

import type { CicloGrupo } from "@/features/portal/lib/ventana-reclamos";

/** Los cuatro tipos que ofrece el modal. */
export const TIPOS_JUGADA = ["TABLA_FIJA", "POLLA", "DUPLETA", "MARCA"] as const;
export type TipoJugada = (typeof TIPOS_JUGADA)[number];

/** Etiqueta humana + ícono de cada tipo (para el selector del modal). */
export const ETIQUETA_TIPO: Record<TipoJugada, { icono: string; etiqueta: string }> = {
  TABLA_FIJA: { icono: "\u{1F3C1}", etiqueta: "Tabla Fija" },
  POLLA: { icono: "\u{1F3AF}", etiqueta: "Polla" },
  DUPLETA: { icono: "\u{1F500}", etiqueta: "Dupleta" },
  MARCA: { icono: "\u{2694}\u{FE0F}", etiqueta: "Marca" },
};

/** Jugada en borrador, tal como la va llenando el modal. */
export type JugadaBorrador = {
  tipo: TipoJugada;
  /** Hipódromo (tablas, dupletas y marcas). */
  hipodromo?: string;
  /** Fecha de la carrera (YYYY-MM-DD). Todas las ventanas de venta la usan. */
  fecha?: string;
  /** Carrera principal (tablas y marcas). */
  carrera?: number | string;
  /** Tabla fija elegida. */
  tablaId?: string | number;
  /** Ejemplar elegido dentro de la tabla (vacío = tabla completa). */
  ejemplar?: string;
  /** Cantidad de tablas. */
  cantidad?: number | string;
  monto?: number | string;
  /** Polla: id de la polla y un ejemplar por carrera (clave de carrera → n°). */
  pollaId?: string | number;
  pollaSeleccion?: Record<string, string>;
  /** Combinaciones ya armadas (si el llamador las precalcula). */
  combinaciones?: string[][];
  /** Dupleta: clave de la dupleta guardada y carreras de las dos patas. */
  claveDupleta?: string;
  carrera1?: number | string;
  carrera2?: number | string;
  numero1?: string;
  numero2?: string;
  /** Marca: id/clave de la carrera con marcas y caballo/rival elegidos. */
  marcaId?: string;
  caballo?: string;
  rival?: string;
};

/** Resultado de validar: `ok:false` trae el primer problema encontrado. */
export type Validacion = { ok: true } | { ok: false; campo: string; error: string };

const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

const texto = (v: unknown): string => String(v ?? "").trim();

/**
 * Valida un borrador contra las reglas comunes y las de su tipo.
 *
 * `montoDisponible` es `saldo_actual + aval` cuando el grupo juega con aval;
 * sirve para cortar antes de mandar. La RPC vuelve a validar: acá es una cortesía,
 * allá es la regla.
 */
export function validarJugada(
  b: JugadaBorrador,
  opts: { montoDisponible?: number | null } = {}
): Validacion {
  const monto = num(b.monto);
  if (!(monto > 0)) return { ok: false, campo: "monto", error: "El monto tiene que ser mayor que cero." };
  const disp = opts.montoDisponible;
  if (disp != null && Number.isFinite(disp) && monto > disp) {
    return {
      ok: false,
      campo: "monto",
      error: "El monto supera tu saldo disponible (saldo + aval).",
    };
  }

  switch (b.tipo) {
    case "TABLA_FIJA": {
      if (!texto(b.hipodromo)) return { ok: false, campo: "hipodromo", error: "Elegí el hipódromo." };
      if (!(num(b.carrera) > 0)) return { ok: false, campo: "carrera", error: "Elegí la carrera." };
      if (b.tablaId == null || texto(b.tablaId) === "") {
        return { ok: false, campo: "tabla", error: "Elegí la tabla fija." };
      }
      if (!(num(b.cantidad) > 0)) return { ok: false, campo: "cantidad", error: "La cantidad tiene que ser mayor que cero." };
      return { ok: true };
    }
    case "POLLA": {
      if (b.pollaId == null || texto(b.pollaId) === "") {
        return { ok: false, campo: "polla", error: "Elegí la polla." };
      }
      const combos = combinacionesDe(b);
      if (!combos.length) {
        return { ok: false, campo: "combinaciones", error: "Marcá al menos un ejemplar por carrera." };
      }
      return { ok: true };
    }
    case "DUPLETA": {
      if (!texto(b.hipodromo)) return { ok: false, campo: "hipodromo", error: "Elegí el hipódromo." };
      if (!(num(b.carrera1) > 0) || !(num(b.carrera2) > 0)) {
        return { ok: false, campo: "carreras", error: "Elegí las dos carreras de la dupleta." };
      }
      if (b.carrera1 === b.carrera2) {
        return { ok: false, campo: "carreras", error: "Las dos patas tienen que ser carreras distintas." };
      }
      if (!texto(b.numero1) || !texto(b.numero2)) {
        return { ok: false, campo: "ejemplares", error: "Elegí un ejemplar en cada pata." };
      }
      return { ok: true };
    }
    case "MARCA": {
      if (!texto(b.hipodromo)) return { ok: false, campo: "hipodromo", error: "Elegí el hipódromo." };
      if (!(num(b.carrera) > 0)) return { ok: false, campo: "carrera", error: "Elegí la carrera." };
      if (!texto(b.caballo)) return { ok: false, campo: "caballo", error: "Elegí el caballo." };
      if (!texto(b.rival)) return { ok: false, campo: "rival", error: "Elegí el rival." };
      if (texto(b.caballo) === texto(b.rival)) {
        return { ok: false, campo: "rival", error: "El rival tiene que ser otro caballo." };
      }
      return { ok: true };
    }
    default:
      return { ok: false, campo: "tipo", error: "Ese tipo de jugada no existe." };
  }
}

/**
 * Arma el cuerpo que se manda a la Edge Function `portal-auth` (acción `vender`).
 *
 * El `cliente_id` y el `grupo_id` NO viajan acá: la función los pone con el
 * cliente del token y su grupo real. Mandarlos desde el navegador sería confiar
 * en lo que el navegador dice que es.
 */
export function cuerpoVenta(b: JugadaBorrador): Record<string, unknown> {
  const base: Record<string, unknown> = { tipo: b.tipo, monto: num(b.monto) };
  switch (b.tipo) {
    case "TABLA_FIJA":
      return {
        ...base,
        tabla_id: texto(b.tablaId),
        hipodromo: texto(b.hipodromo).toUpperCase(),
        carrera: Math.floor(num(b.carrera)),
        cantidad: Math.max(1, Math.floor(num(b.cantidad) || 1)),
        ejemplar: texto(b.ejemplar) || null,
      };
    case "POLLA":
      return {
        ...base,
        polla_id: texto(b.pollaId),
        combinaciones: combinacionesDe(b),
      };
    case "DUPLETA":
      return {
        ...base,
        hipodromo: texto(b.hipodromo).toUpperCase(),
        fecha: texto(b.fecha).slice(0, 10),
        carrera1: Math.floor(num(b.carrera1)),
        carrera2: Math.floor(num(b.carrera2)),
        numero1: texto(b.numero1),
        numero2: texto(b.numero2),
      };
    case "MARCA":
      return {
        ...base,
        hipodromo: texto(b.hipodromo).toUpperCase(),
        fecha: texto(b.fecha).slice(0, 10),
        carrera: Math.floor(num(b.carrera)),
        caballo: texto(b.caballo),
        rival: texto(b.rival),
      };
    default:
      return base;
  }
}

/**
 * Combinaciones de Polla listas para la RPC.
 *
 * `polla_combinaciones.posiciones` es un arreglo con un objeto por carrera, EN
 * EL ORDEN de `pollas.carreras`. Como el modal del portal arma UNA combinación
 * por jugada (un ejemplar por carrera), el resultado es un arreglo con un solo
 * elemento; el formato es el mismo que espera la RPC, que no cambia por tener
 * una sola combinación.
 *
 * Si el llamador ya trae `combinaciones` (arreglo de arreglos de números), se
 * respeta tal cual; si no, se deriva de `pollaSeleccion` (clave → número).
 */
export function combinacionesDe(b: JugadaBorrador): Array<Array<{ claveCarrera: string; numero: string }>> {
  if (Array.isArray(b.combinaciones) && b.combinaciones.length) {
    return b.combinaciones.map((combo) =>
      (Array.isArray(combo) ? combo : []).map((n) => ({ claveCarrera: "", numero: texto(n) })).filter((p) => p.numero)
    );
  }
  const sel = b.pollaSeleccion ?? {};
  const posiciones = Object.entries(sel)
    .map(([claveCarrera, numero]) => ({ claveCarrera: texto(claveCarrera), numero: texto(numero) }))
    .filter((p) => p.numero);
  return posiciones.length ? [posiciones] : [];
}

/**
 * Resumen humano de una jugada, para confirmar antes de mandarla y para el
 * mensaje de éxito. Es deliberadamente corto: cabe en un toast.
 */
export function resumenJugada(b: JugadaBorrador): string {
  const m = num(b.monto);
  const moneda = m.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  switch (b.tipo) {
    case "TABLA_FIJA": {
      const ej = texto(b.ejemplar) || "tabla completa";
      return `${ETIQUETA_TIPO.TABLA_FIJA.etiqueta} · ${texto(b.hipodromo)} ${texto(b.carrera)} · ${ej} · ${texto(b.cantidad) || 1}× · ${moneda}`;
    }
    case "POLLA":
      return `${ETIQUETA_TIPO.POLLA.etiqueta} · ${combinacionesDe(b).length} combinación(es) · ${moneda}`;
    case "DUPLETA":
      return `${ETIQUETA_TIPO.DUPLETA.etiqueta} · C${texto(b.carrera1)}:${texto(b.numero1)} × C${texto(b.carrera2)}:${texto(b.numero2)} · ${moneda}`;
    case "MARCA":
      return `${ETIQUETA_TIPO.MARCA.etiqueta} · ${texto(b.caballo)} vs ${texto(b.rival)} · ${moneda}`;
    default:
      return moneda;
  }
}

/**
 * Texto del rango de fechas que admite la "jugada no relacionada" según la
 * ventana del grupo. Se reusa en el modal de solicitud y en la explicación.
 */
export function rangoFechaSolicitud(
  hoyIso: string,
  ventana: unknown,
  grupo?: CicloGrupo | null
): { piso: string; tope: string } {
  // Import perezoso para no acoplar este núcleo a la implementación de ventana
  // más de lo necesario: `dentroDeVentana` sigue siendo la regla.
  const v = String(ventana ?? "").trim().toUpperCase();
  if (v === "SEMANA_EN_CURSO") {
    const diaInicio = normalizarDiaLocal(grupo?.diaInicio, 1);
    const diaFin = normalizarDiaLocal(grupo?.diaFin, 7);
    const df = diaFiscal(hoyIso);
    const retro = (df - diaInicio + 7) % 7;
    const inicio = sumarDiasIso(hoyIso, -retro);
    const span = diaFin >= diaInicio ? diaFin - diaInicio : 7 - diaInicio + diaFin;
    return { piso: inicio, tope: sumarDiasIso(inicio, span) };
  }
  return { piso: hoyIso, tope: hoyIso };
}

function diaFiscal(iso: string): number {
  const [y, m, d] = String(iso ?? "").slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return 1;
  const js = new Date(y, m - 1, d).getDay();
  return js === 0 ? 7 : js;
}

function sumarDiasIso(iso: string, n: number): string {
  const [y, m, d] = String(iso ?? "").slice(0, 10).split("-").map(Number);
  const t = new Date(y, m - 1, d);
  t.setDate(t.getDate() + n);
  const p = (v: number): string => String(v).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

function normalizarDiaLocal(v: unknown, porDefecto: number): number {
  const n = Math.floor(Number(v));
  return n >= 1 && n <= 7 ? n : porDefecto;
}
