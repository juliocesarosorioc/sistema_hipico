"use client";

import { supabase } from "@/core/supabase";
import { registrarAuditoria } from "@/features/grupos/lib/grupos";
import {
  numeroCaballoMarca,
  separarNumeros,
  type ConfigMarcas,
} from "@/features/marcas/lib/marcas";
import { filtroDiaJornada, perteneceADiaJornada } from "@/features/liquidacion/lib/fecha";
import {
  grupoActivoVigente,
  grupoVigente,
  veTodosLosGruposVigente,
} from "@/features/seguridad/lib/vigente";

export type LimitesMarcas = {
  limite_general_plataforma?: number | null; // Tope máximo global en $ por marca para la carrera
  limite_por_grupo?: number | null;          // Tope máximo en $ por grupo para la marca
  cupos_por_marca?: Record<
    string,
    {
      max_monto?: number | null;
      ampliacion_autorizada?: number;
      motivo_ampliacion?: string;
    }
  >;
  cupos_por_grupo?: Record<
    string,
    {
      max_monto?: number | null;
    }
  >;
};

export type CompradorMarca = {
  ticketId: string | number;
  jugadorNombre: string;
  grupoNombre: string;
  caballo: string;
  rival: string;
  monto: number;
  premioPotencial: number;
  fecha: string;
};

export type AnalisisMarcaItem = {
  jugadaKey: string;
  caballoNumero: string;
  rivalNumero: string;
  etiquetaJugada: string;
  limitePersonalizado?: number | null;
  esPrimeraMarca: boolean;
  esNV: boolean;
  ordenJerarquia: number; // 1 = 1ra jugada (a por b), 2 = 2da jugada (b por c), etc.
  montoJugadoTotal: number;
  pagoPotencialBanca: number;
  balanceNetoBanca: number;
  semaforo: "SEGURO" | "MODERADO" | "CRITICO";
  limitePlataforma: number;
  disponiblePlataforma: number;
  limiteGrupoDefault: number;
  cupoAgotado: boolean;
  ampliacionAutorizada: number;
  compradores: CompradorMarca[];
};

export type AnalisisRiesgoMarcas = {
  hipodromo: string;
  carrera: number;
  fecha: string;
  moneda?: string;
  totalRecaudado: number;
  totalJugadas: number;
  marcasConfiguradas: string[];
  nvConfigurados: string[];
  marcas: AnalisisMarcaItem[];
  peorEscenario: {
    caballoNumero: string;
    balanceNeto: number;
    semaforo: "SEGURO" | "MODERADO" | "CRITICO";
  };
  hayCupoAgotado: boolean;
  limites: LimitesMarcas;
};

/** Valores por defecto si la carrera no tiene límites fijados para grupos en Dólares (USD: 120 para 100) */
export const LIMITES_MARCAS_DEFECTO: LimitesMarcas = {
  limite_general_plataforma: 120, // $120 por marca en la plataforma
  limite_por_grupo: 120,          // $120 por grupo (proporción 120 para 100)
  cupos_por_marca: {},
  cupos_por_grupo: {},
};

/** Valores por defecto para grupos en Bolívares (VES / Bs.: 120.000 para 100.000) */
export const LIMITES_MARCAS_DEFECTO_BS: LimitesMarcas = {
  limite_general_plataforma: 120000, // Bs. 120.000 por marca en la plataforma
  limite_por_grupo: 120000,          // Bs. 120.000 por grupo (proporción 120.000 para 100.000)
  cupos_por_marca: {},
  cupos_por_grupo: {},
};

/** Determina si una moneda corresponde a Bolívares */
export function esMonedaBolivares(moneda?: string | null): boolean {
  const m = String(moneda ?? "").trim().toUpperCase();
  return m === "VES" || m === "BS" || m === "BOLIVARES" || m.includes("VES") || m.includes("BS");
}

/**
 * Calcula el pago bruto de una jugada de Marcas (120/100 o 120.000/100.000, proporción 11/6).
 */
export function calcularPagoBrutoMarca(monto: number): number {
  const gananciaNeta = (monto * 100) / 120;
  return Math.round((monto + gananciaNeta) * 100) / 100;
}

/**
 * Normaliza los límites de una carrera combinando valores guardados con los de defecto según la moneda.
 */
export function normalizarLimitesMarcas(raw: unknown, moneda?: string): LimitesMarcas {
  const def = esMonedaBolivares(moneda) ? LIMITES_MARCAS_DEFECTO_BS : LIMITES_MARCAS_DEFECTO;
  if (!raw || typeof raw !== "object") return { ...def };
  const obj = raw as Record<string, unknown>;
  return {
    limite_general_plataforma:
      typeof obj.limite_general_plataforma === "number"
        ? obj.limite_general_plataforma
        : def.limite_general_plataforma,
    limite_por_grupo:
      typeof obj.limite_por_grupo === "number"
        ? obj.limite_por_grupo
        : def.limite_por_grupo,
    cupos_por_marca: (obj.cupos_por_marca ?? {}) as LimitesMarcas["cupos_por_marca"],
    cupos_por_grupo: (obj.cupos_por_grupo ?? {}) as LimitesMarcas["cupos_por_grupo"],
  };
}

export function normalizarNumeroMarca(valor: unknown, ejemplarNumero?: unknown): string {
  const n = numeroCaballoMarca(valor, ejemplarNumero).trim();
  if (!n || !/\d/.test(n)) return "";
  return n;
}

/** Clave única para un enfrentamiento de marcas: `${rival}_x_${caballo}`. */
export function claveJugadaMarca(
  rival: string | number | null | undefined,
  caballo: string | number | null | undefined
): string {
  const riv = normalizarNumeroMarca(rival);
  const cab = normalizarNumeroMarca(caballo);
  if (riv && cab && riv !== cab) return `${riv}_x_${cab}`;
  return cab || riv;
}

/** Etiqueta legible para un enfrentamiento de marcas: `#A por #B`. */
export function etiquetaJugadaMarca(
  rival?: string | number | null,
  caballo?: string | number | null
): string {
  const riv = normalizarNumeroMarca(rival);
  const cab = normalizarNumeroMarca(caballo);
  if (riv && cab && riv !== cab) return `#${riv} por #${cab}`;
  if (cab) return `#${cab}`;
  if (riv) return `#${riv}`;
  return "—";
}

/**
 * Comprueba si dos jugadas corresponden al mismo cruce `{A, B}`.
 * Como la jerarquía solo habilita una dirección entre dos caballos, el par es unívoco.
 */
export function coincideParMarca(
  cabA: string,
  rivA: string,
  cabB: string,
  rivB: string
): boolean {
  const cA = normalizarNumeroMarca(cabA);
  const rA = normalizarNumeroMarca(rivA);
  const cB = normalizarNumeroMarca(cabB);
  const rB = normalizarNumeroMarca(rivB);
  if (cA && rA && cB && rB) {
    return (cA === cB && rA === rB) || (cA === rB && rA === cB);
  }
  if (!rA && !rB && cA && cB) return cA === cB;
  return false;
}

/**
 * Extrae el caballo jugado y su rival desde un ticket de `tickets_apuestas`.
 * Respalda tickets antiguos sin `rivales_snapshot` usando la jerarquía configurada.
 */
export function extraerParTicketMarca(
  t: Record<string, unknown>,
  marcasConfiguradas?: string[]
): { caballo: string; rival: string } {
  const cabStr = normalizarNumeroMarca(t.caballo, t.ejemplar_numero);
  let nota: unknown = t.nota_auditoria;
  if (typeof nota === "string") {
    try {
      nota = JSON.parse(nota);
    } catch {
      nota = null;
    }
  }

  let rivStr = "";
  if (nota && typeof nota === "object") {
    const snap = (nota as Record<string, unknown>).rivales_snapshot;
    if (Array.isArray(snap)) {
      const encontrado = snap
        .map((x) => normalizarNumeroMarca(x))
        .find((n) => Boolean(n && n !== cabStr));
      if (encontrado) rivStr = encontrado;
    }
  }

  if (!rivStr) {
    const numsCab = (String(t.caballo ?? "").match(/\d+/g) ?? []).map((x) => x.trim());
    const enCab = numsCab.find((n, idx) => idx > 0 && n !== cabStr);
    if (enCab) rivStr = enCab;
  }

  if (!rivStr) {
    const numsJug = (String(t.nombre_jugada ?? "").match(/\d+/g) ?? []).map((x) => x.trim());
    const enJug = numsJug.find((n) => n !== cabStr);
    if (enJug) rivStr = enJug;
  }

  if (!rivStr && cabStr && Array.isArray(marcasConfiguradas) && marcasConfiguradas.length > 1) {
    const normMarcas = marcasConfiguradas.map((m) => normalizarNumeroMarca(m)).filter(Boolean);
    const idx = normMarcas.indexOf(cabStr);
    if (idx > 0) rivStr = normMarcas[idx - 1];
  }

  return { caballo: cabStr, rival: rivStr };
}

type CupoMarcaConfig = NonNullable<LimitesMarcas["cupos_por_marca"]>[string];

function obtenerCupoConfiguradoPar(
  cuposPorMarca: LimitesMarcas["cupos_por_marca"],
  rival: string,
  caballo: string
): CupoMarcaConfig | undefined {
  if (!cuposPorMarca) return undefined;
  const riv = normalizarNumeroMarca(rival);
  const cab = normalizarNumeroMarca(caballo);
  const claves = [
    riv && cab ? `${riv}_x_${cab}` : "",
    riv && cab ? `${cab}_x_${riv}` : "",
    riv && cab ? `${riv}_${cab}` : "",
    riv && cab ? `${cab}_${riv}` : "",
    cab,
  ].filter(Boolean);
  for (const k of claves) {
    if (cuposPorMarca[k]) return cuposPorMarca[k];
  }
  return undefined;
}

function esTicketMarcaActivo(t: Record<string, unknown>): boolean {
  if (t.monto_jugado == null || !(Number(t.monto_jugado) > 0)) return false;
  const st = String(t.estado ?? "").trim().toLowerCase();
  if (!st) return true;
  return !["anulado", "anulada", "cancelado", "cancelada", "eliminado", "eliminada", "retirado", "retirada"].includes(st);
}

/**
 * Realiza el análisis completo de riesgo financiero para una carrera de Marcas
 * evaluando cada enfrentamiento (`A por B`, `B por C`, `C por D`, `D por E`, etc.).
 */
export async function obtenerAnalisisRiesgoMarcas(
  hipodromo: string,
  carrera: number,
  fecha: string
): Promise<AnalisisRiesgoMarcas | null> {
  if (!supabase) return null;

  const hipo = String(hipodromo ?? "").trim().toUpperCase();
  const carr = Number(carrera) || 0;

  // 1. Obtener la configuración de marcas_carrera
  const { data: cfgRow } = await supabase
    .from("marcas_carrera")
    .select("*")
    .ilike("hipodromo", hipo)
    .eq("fecha", fecha)
    .eq("carrera", carr)
    .maybeSingle();

  const cfg = (cfgRow ?? {}) as ConfigMarcas & { limites?: unknown };
  const marcasLista = separarNumeros(cfg.marcas ?? "").map((m) => normalizarNumeroMarca(m) || m);
  const nvLista = separarNumeros(cfg.nv ?? "").map((m) => normalizarNumeroMarca(m) || m);
  const activo = veTodosLosGruposVigente()
    ? grupoActivoVigente() || grupoVigente() || null
    : grupoVigente() || grupoActivoVigente() || null;

  // Moneda del grupo activo (por si aún no existen tickets en la carrera)
  let monedaGrupoActivo = "";
  if (activo) {
    try {
      const { data: grpRow } = await supabase
        .from("grupos_venta")
        .select("moneda")
        .eq("id", activo)
        .maybeSingle();
      if (grpRow?.moneda) monedaGrupoActivo = String(grpRow.moneda);
    } catch {
      /* fallback */
    }
  }

  // 2. Obtener tickets jugados de Marcas en esta carrera y fecha (aislados al grupo activo)
  let tickets: Array<Record<string, unknown>> | null = [];
  if (activo || veTodosLosGruposVigente()) {
    let qTickets = supabase
      .from("tickets_apuestas")
      .select(
        "id, cliente_juega_nombre, grupo_cobro_id, grupo_cobro_nombre, caballo, ejemplar_numero, nombre_jugada, monto_jugado, premio_pagar, fecha_registro, fecha_carrera, estado, nota_auditoria, moneda"
      )
      .eq("hipodromo", hipo)
      .eq("carrera", carr)
      .or(filtroDiaJornada(fecha))
      .ilike("nombre_jugada", "%MARCA%")
      .order("fecha_registro", { ascending: false });
    if (activo) {
      qTickets = qTickets.eq("grupo_cobro_id", String(activo));
    }
    const resT = await qTickets;
    tickets = (resT.data ?? []) as Array<Record<string, unknown>>;
  }

  const ticketsValidos = (tickets ?? []).filter(
    (t) => perteneceADiaJornada(t, fecha) && esTicketMarcaActivo(t)
  );

  const esBs =
    ticketsValidos.length > 0
      ? ticketsValidos.some((t) => esMonedaBolivares(t.moneda as string))
      : esMonedaBolivares(monedaGrupoActivo);
  const moneda = esBs ? "VES" : "USD";
  const limites = normalizarLimitesMarcas(cfg.limites, moneda);

  const totalRecaudado = ticketsValidos.reduce((acc, t) => acc + Number(t.monto_jugado || 0), 0);
  const totalJugadas = ticketsValidos.length;

  // 3. Construir lista de enfrentamientos: consecutivos (a por b, b por c, c por d, d por e) + cualquier otro cruce apostado
  const paresAnalizar: Array<{ rival: string; caballo: string; orden: number }> = [];
  for (let idx = 1; idx < marcasLista.length; idx++) {
    const rival = marcasLista[idx - 1];
    const caballo = marcasLista[idx];
    if (rival && caballo && rival !== caballo) {
      paresAnalizar.push({ rival, caballo, orden: paresAnalizar.length + 1 });
    }
  }

  for (const t of ticketsValidos) {
    const { caballo, rival } = extraerParTicketMarca(t, marcasLista);
    if (!caballo) continue;
    const yaExiste = paresAnalizar.some((p) => coincideParMarca(p.caballo, p.rival, caballo, rival));
    if (!yaExiste) {
      paresAnalizar.push({
        rival,
        caballo,
        orden: paresAnalizar.length + 1,
      });
    }
  }

  // 4. Analizar cada enfrentamiento de forma independiente
  const marcasAnalizadas: AnalisisMarcaItem[] = paresAnalizar.map((par) => {
    const ticketsPar = ticketsValidos.filter((t) => {
      const pTicket = extraerParTicketMarca(t, marcasLista);
      return coincideParMarca(pTicket.caballo, pTicket.rival, par.caballo, par.rival);
    });

    const compradores: CompradorMarca[] = [];
    let monto = 0;
    let pago = 0;

    for (const t of ticketsPar) {
      const m = Number(t.monto_jugado || 0);
      const premio = Number(t.premio_pagar) > 0 ? Number(t.premio_pagar) : calcularPagoBrutoMarca(m);
      monto += m;
      pago += premio;
      compradores.push({
        ticketId: typeof t.id === "number" ? t.id : String(t.id ?? ""),
        jugadorNombre: String(t.cliente_juega_nombre ?? "Cliente"),
        grupoNombre: String(t.grupo_cobro_nombre ?? "General"),
        caballo: par.caballo,
        rival: par.rival,
        monto: m,
        premioPotencial: premio,
        fecha: t.fecha_registro ? new Date(String(t.fecha_registro)).toLocaleTimeString("es-VE") : "",
      });
    }

    const balanceNeto = totalRecaudado - pago;
    const jugadaKey = claveJugadaMarca(par.rival, par.caballo);
    const etiquetaJugada = etiquetaJugadaMarca(par.rival, par.caballo);
    const cupoEspecifico = obtenerCupoConfiguradoPar(limites.cupos_por_marca, par.rival, par.caballo);
    const limitePersonalizado =
      typeof cupoEspecifico?.max_monto === "number" && cupoEspecifico.max_monto > 0
        ? cupoEspecifico.max_monto
        : null;
    const limiteDefaultCarrera =
      limites.limite_por_grupo ?? limites.limite_general_plataforma ?? (esBs ? 120000 : 120);
    const limiteBase = limitePersonalizado ?? limiteDefaultCarrera;
    const extraAutorizado = Number(cupoEspecifico?.ampliacion_autorizada) || 0;
    const limiteEfectivo = limiteBase + extraAutorizado;
    const disponible = Math.max(0, limiteEfectivo - monto);
    const cupoAgotado = monto >= limiteEfectivo;

    let semaforo: "SEGURO" | "MODERADO" | "CRITICO" = "SEGURO";
    if (balanceNeto < 0) {
      if (Math.abs(balanceNeto) > (totalRecaudado || 50)) {
        semaforo = "CRITICO";
      } else {
        semaforo = "MODERADO";
      }
    }

    return {
      jugadaKey,
      caballoNumero: par.caballo,
      rivalNumero: par.rival,
      etiquetaJugada,
      limitePersonalizado,
      esPrimeraMarca: false,
      esNV: nvLista.includes(par.caballo),
      ordenJerarquia: par.orden,
      montoJugadoTotal: monto,
      pagoPotencialBanca: pago,
      balanceNetoBanca: balanceNeto,
      semaforo,
      limitePlataforma: limiteEfectivo,
      disponiblePlataforma: disponible,
      limiteGrupoDefault: limites.limite_por_grupo ?? (esBs ? 120000 : 120),
      cupoAgotado,
      ampliacionAutorizada: extraAutorizado,
      compradores,
    };
  });

  // Identificar peor escenario
  let peorBalance = Infinity;
  let peorCaballo = marcasAnalizadas[0]?.etiquetaJugada || marcasLista[0] || "";
  let peorSemaforo: "SEGURO" | "MODERADO" | "CRITICO" = "SEGURO";

  for (const m of marcasAnalizadas) {
    if (m.balanceNetoBanca < peorBalance) {
      peorBalance = m.balanceNetoBanca;
      peorCaballo = m.etiquetaJugada;
      peorSemaforo = m.semaforo;
    }
  }

  const hayCupoAgotado = marcasAnalizadas.some((m) => m.cupoAgotado);

  return {
    hipodromo: hipo,
    carrera: carr,
    fecha,
    moneda,
    totalRecaudado,
    totalJugadas,
    marcasConfiguradas: marcasLista,
    nvConfigurados: nvLista,
    marcas: marcasAnalizadas,
    peorEscenario: {
      caballoNumero: peorCaballo,
      balanceNeto: peorBalance === Infinity ? 0 : peorBalance,
      semaforo: peorSemaforo,
    },
    hayCupoAgotado,
    limites,
  };
}

/**
 * Guarda o actualiza la configuración de límites de riesgo para una carrera de Marcas.
 */
export async function guardarLimitesMarcas(
  hipodromo: string,
  carrera: number,
  fecha: string,
  nuevosLimites: LimitesMarcas
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };

  try {
    const hipo = String(hipodromo).trim().toUpperCase();
    const carr = Number(carrera);

    const { error } = await supabase
      .from("marcas_carrera")
      .update({
        limites: nuevosLimites,
        updated_at: new Date().toISOString(),
      })
      .ilike("hipodromo", hipo)
      .eq("fecha", fecha)
      .eq("carrera", carr);

    if (error) {
      // Si la columna no existe aún, se reporta claramente
      return { ok: false, error: error.message };
    }

    void registrarAuditoria(
      "MARCAS",
      "LIMITES_ACTUALIZADOS",
      `Límites de marcas actualizados para ${hipo} C${carr} (${fecha}). Tope general: $${nuevosLimites.limite_general_plataforma}, Por grupo: $${nuevosLimites.limite_por_grupo}`
    );

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Amplía el cupo permitido para un enfrentamiento o marca específica (autorización del administrador).
 */
export async function ampliarCupoMarca(opts: {
  hipodromo: string;
  carrera: number;
  fecha: string;
  caballoNumero: string | number;
  rivalNumero?: string | number;
  jugadaKey?: string;
  montoAdicional: number;
  motivo?: string;
  moneda?: string;
}): Promise<{ ok: boolean; nuevoLimite?: number; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };

  try {
    const hipo = String(opts.hipodromo).trim().toUpperCase();
    const carr = Number(opts.carrera);
    const cabStr = normalizarNumeroMarca(opts.caballoNumero) || String(opts.caballoNumero).trim();
    const rivStr = opts.rivalNumero != null ? normalizarNumeroMarca(opts.rivalNumero) : "";
    const clave =
      String(opts.jugadaKey ?? "").trim() ||
      (rivStr ? claveJugadaMarca(rivStr, cabStr) : cabStr);
    const etiqueta = etiquetaJugadaMarca(rivStr, cabStr);

    const { data: row, error: fetchErr } = await supabase
      .from("marcas_carrera")
      .select("id, limites")
      .ilike("hipodromo", hipo)
      .eq("fecha", opts.fecha)
      .eq("carrera", carr)
      .maybeSingle();

    if (fetchErr || !row) {
      return { ok: false, error: fetchErr?.message ?? "Carrera de marcas no encontrada." };
    }

    const limites = normalizarLimitesMarcas(row.limites, opts.moneda);
    const cuposMarca = limites.cupos_por_marca ?? {};
    const marcaActual =
      cuposMarca[clave] ?? obtenerCupoConfiguradoPar(cuposMarca, rivStr, cabStr) ?? {};

    const ampliacionPrevia = Number(marcaActual.ampliacion_autorizada) || 0;
    const nuevaAmpliacion = ampliacionPrevia + Math.max(1, opts.montoAdicional);

    limites.cupos_por_marca = {
      ...cuposMarca,
      [clave]: {
        ...marcaActual,
        ampliacion_autorizada: nuevaAmpliacion,
        motivo_ampliacion: opts.motivo || "Autorización manual del administrador",
      },
    };

    const { error: updErr } = await supabase
      .from("marcas_carrera")
      .update({
        limites,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    if (updErr) return { ok: false, error: updErr.message };

    // Cerrar alertas pendientes de cupo agotado para esta jugada específica
    let qNotif = supabase
      .from("notificaciones")
      .update({
        estado: "Aplicada",
        atendida_por: "ADMIN_AMPLIACION_MARCA",
        atendida_at: new Date().toISOString(),
      })
      .eq("tipo", "alerta_cupo_marca_agotado");
    if (rivStr) {
      qNotif = qNotif.ilike("titulo", `%#${rivStr} por #${cabStr}%`);
    } else {
      qNotif = qNotif.ilike("titulo", `%#${cabStr}%`);
    }
    await qNotif;

    void registrarAuditoria(
      "MARCAS",
      "AMPLIACION_CUPO",
      `Jugada ${etiqueta} en ${hipo} C${carr}: Cupo ampliado en +$${opts.montoAdicional}. Motivo: ${opts.motivo || "Demanda de jugadores"}`
    );

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("cupo_marca_ampliado", {
          detail: { hipodromo: hipo, carrera: carr, caballo: cabStr, rival: rivStr, jugadaKey: clave, nuevaAmpliacion },
        })
      );
    }

    const limiteBase =
      typeof marcaActual.max_monto === "number" && marcaActual.max_monto > 0
        ? marcaActual.max_monto
        : (limites.limite_por_grupo ?? limites.limite_general_plataforma ?? (esMonedaBolivares(opts.moneda) ? 120000 : 120));
    return { ok: true, nuevoLimite: limiteBase + nuevaAmpliacion };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Modifica el orden de marcas actual para reajustar la jerarquía posicional.
 * Permite cambiar el orden (ej. mover una marca de posición) para equilibrar el matchup.
 */
export async function modificarOrdenMarcas(opts: {
  hipodromo: string;
  carrera: number;
  fecha: string;
  nuevasMarcas: string;
  motivo?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };

  try {
    const hipo = String(opts.hipodromo).trim().toUpperCase();
    const carr = Number(opts.carrera);
    const marcasTrim = String(opts.nuevasMarcas).trim();

    if (!marcasTrim) return { ok: false, error: "El orden de marcas no puede estar vacío." };

    const { error } = await supabase
      .from("marcas_carrera")
      .update({
        marcas: marcasTrim,
        updated_at: new Date().toISOString(),
      })
      .ilike("hipodromo", hipo)
      .eq("fecha", opts.fecha)
      .eq("carrera", carr);

    if (error) return { ok: false, error: error.message };

    void registrarAuditoria(
      "MARCAS",
      "MODIFICAR_ORDEN",
      `Nuevo orden de marcas para ${hipo} C${carr}: ${marcasTrim}. Motivo: ${opts.motivo || "Ajuste de jerarquía por riesgo"}`
    );

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("orden_marcas_modificado", {
          detail: { hipodromo: hipo, carrera: carr, nuevasMarcas: marcasTrim },
        })
      );
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Comunica al Administrador Principal que un enfrentamiento de marcas ha superado su límite,
 * detallando exactamente qué jugadores han comprado en ese cruce y qué montos se han registrado.
 */
export async function comunicarCupoMarcaAgotadoAdmin(opts: {
  hipodromo: string;
  carrera: number;
  fecha: string;
  caballoNumero: string | number;
  rival?: string;
  grupoId?: string | number | null;
  grupoNombre?: string;
  jugadorNombre?: string;
  montoIntentado?: number;
  tipoLimite?: "GRUPO" | "PLATAFORMA";
}): Promise<void> {
  if (!supabase) return;

  try {
    const hipo = String(opts.hipodromo).trim().toUpperCase();
    const carr = Number(opts.carrera);
    const cabStr = normalizarNumeroMarca(opts.caballoNumero) || String(opts.caballoNumero).trim();
    const rivStr = normalizarNumeroMarca(opts.rival);
    const etiquetaPar = etiquetaJugadaMarca(rivStr, cabStr);
    const grupoEfectivo =
      opts.grupoId ??
      (veTodosLosGruposVigente()
        ? grupoActivoVigente() || grupoVigente() || null
        : grupoVigente() || grupoActivoVigente() || null);
    if (!grupoEfectivo && !veTodosLosGruposVigente()) return;

    const { data: cfgRow } = await supabase
      .from("marcas_carrera")
      .select("marcas")
      .ilike("hipodromo", hipo)
      .eq("fecha", opts.fecha)
      .eq("carrera", carr)
      .maybeSingle();
    const marcasLista = separarNumeros(cfgRow?.marcas ?? "").map((m) => normalizarNumeroMarca(m) || m);

    // 1. Obtener historial de compradores de este cruce en la carrera y fecha (aislado al grupo)
    let qTickets = supabase
      .from("tickets_apuestas")
      .select(
        "id, cliente_juega_nombre, grupo_cobro_nombre, monto_jugado, premio_pagar, fecha_registro, fecha_carrera, estado, caballo, ejemplar_numero, nombre_jugada, nota_auditoria"
      )
      .eq("hipodromo", hipo)
      .eq("carrera", carr)
      .or(filtroDiaJornada(opts.fecha))
      .ilike("nombre_jugada", "%MARCA%")
      .order("fecha_registro", { ascending: false });
    if (grupoEfectivo) {
      qTickets = qTickets.eq("grupo_cobro_id", String(grupoEfectivo));
    }
    const { data: tickets } = await qTickets;

    const filtrados = (tickets ?? []).filter((t) => {
      if (!perteneceADiaJornada(t as Record<string, unknown>, opts.fecha)) return false;
      if (!esTicketMarcaActivo(t as Record<string, unknown>)) return false;
      const pTicket = extraerParTicketMarca(t as Record<string, unknown>, marcasLista);
      return coincideParMarca(pTicket.caballo, pTicket.rival, cabStr, rivStr);
    });

    const compradoresResumen = filtrados.map((t) => ({
      jugador: String(t.cliente_juega_nombre ?? "Cliente"),
      grupo: String(t.grupo_cobro_nombre ?? "General"),
      monto: Number(t.monto_jugado ?? 0),
      premio: Number(t.premio_pagar ?? 0),
      fecha: t.fecha_registro ? new Date(String(t.fecha_registro)).toLocaleTimeString("es-VE") : "",
    }));

    const totalJugado = compradoresResumen.reduce((acc, b) => acc + b.monto, 0);
    const listaCompradoresStr = compradoresResumen
      .map((c) => `${c.jugador} (${c.grupo}, $${c.monto})`)
      .slice(0, 5)
      .join(", ");

    const tipoDesc = opts.tipoLimite === "GRUPO" ? "Límite del Grupo" : "Límite General de Plataforma";
    const titulo = `🚨 Límite de Marca Superado: ${etiquetaPar} en ${hipo} C${carr}`;
    const mensaje = `La jugada ${etiquetaPar} superó el tope (${tipoDesc}) en ${hipo} C${carr}. Acumulado en el cruce: $${totalJugado}. Últimos jugadores: ${listaCompradoresStr || "Sin apuestas registradas"}. El jugador ${opts.jugadorNombre || "Jugador"} (${opts.grupoNombre || "Grupo"}) intentó apostar $${opts.montoIntentado || 0}. El Administrador puede autorizar o ampliar el cupo de esta jugada.`;

    await supabase.from("notificaciones").insert({
      tipo: "alerta_cupo_marca_agotado",
      titulo,
      mensaje,
      datos: {
        hipodromo: hipo,
        carrera: carr,
        fecha: opts.fecha,
        caballo_numero: cabStr,
        rival_numero: rivStr || null,
        etiqueta_jugada: etiquetaPar,
        tipo_limite: opts.tipoLimite || "PLATAFORMA",
        total_acumulado: totalJugado,
        monto_intentado: opts.montoIntentado,
        jugador_intentando: opts.jugadorNombre,
        grupo_id: grupoEfectivo ?? null,
        grupo_intentando: opts.grupoNombre,
        compradores: compradoresResumen,
      },
      estado: "Pendiente",
      created_at: new Date().toISOString(),
    });

    void registrarAuditoria(
      "MARCAS",
      "ALERTA_CUPO_AGOTADO",
      `Alerta de límite enviada al Admin: Jugada ${etiquetaPar} en ${hipo} C${carr}. ${tipoDesc} superado.`
    );
  } catch (e) {
    console.error("Error al comunicar límite superado de marca:", e);
  }
}

/**
 * Verifica si una jugada de marcas (`A por B`) cumple con su límite independiente.
 * Solo cuando `(acumulado en el cruce A por B + monto) > límite` retorna `permitido: false`
 * para solicitar autorización del Administrador.
 */
export async function verificarCupoMarcaDisponible(opts: {
  hipodromo: string;
  carrera: number;
  fecha: string;
  caballoNumero: string | number;
  rivalNumero?: string | number | null;
  grupoId?: string | number | null;
  grupoNombre?: string;
  jugadorNombre?: string;
  montoAComprar: number;
  moneda?: string;
  notificarAdmin?: boolean;
}): Promise<{
  permitido: boolean;
  motivo?: string;
  etiquetaJugada?: string;
  acumuladoPar?: number;
  limitePlataforma?: number;
  limiteGrupo?: number;
  disponiblePlataforma?: number;
  disponibleGrupo?: number;
}> {
  if (!supabase) return { permitido: true };

  try {
    const hipo = String(opts.hipodromo).trim().toUpperCase();
    const carr = Number(opts.carrera);
    const monto = Number(opts.montoAComprar) || 0;
    const grupoEfectivo =
      opts.grupoId ??
      (veTodosLosGruposVigente()
        ? grupoActivoVigente() || grupoVigente() || null
        : grupoVigente() || grupoActivoVigente() || null);

    // Determinar moneda del grupo / apuesta
    let moneda = opts.moneda;
    if (!moneda && grupoEfectivo) {
      try {
        const { data: grpRow } = await supabase
          .from("grupos_venta")
          .select("moneda")
          .eq("id", grupoEfectivo)
          .maybeSingle();
        if (grpRow?.moneda) moneda = grpRow.moneda;
      } catch {
        /* fallback */
      }
    }
    const esBs = esMonedaBolivares(moneda);
    const defaultGen = esBs ? 120000 : 120;
    const defaultGrp = esBs ? 120000 : 120;
    const simbolo = esBs ? "Bs. " : "$";

    // 1. Obtener la configuración de marcas y límites de la carrera
    const { data: cfgRow } = await supabase
      .from("marcas_carrera")
      .select("marcas, limites")
      .ilike("hipodromo", hipo)
      .eq("fecha", opts.fecha)
      .eq("carrera", carr)
      .maybeSingle();

    const marcasLista = separarNumeros(cfgRow?.marcas ?? "").map((m) => normalizarNumeroMarca(m) || m);
    const cabStr = normalizarNumeroMarca(opts.caballoNumero) || String(opts.caballoNumero).trim();
    let rivStr = normalizarNumeroMarca(opts.rivalNumero);
    if (!rivStr && cabStr && marcasLista.length > 1) {
      const idx = marcasLista.indexOf(cabStr);
      if (idx > 0) rivStr = marcasLista[idx - 1];
    }
    const etiquetaPar = etiquetaJugadaMarca(rivStr, cabStr);

    const limites = normalizarLimitesMarcas(cfgRow?.limites, esBs ? "VES" : "USD");
    const cupoEspecifico = obtenerCupoConfiguradoPar(limites.cupos_por_marca, rivStr, cabStr);
    const extraAutorizado = Number(cupoEspecifico?.ampliacion_autorizada) || 0;
    const tieneLimitePar = typeof cupoEspecifico?.max_monto === "number" && cupoEspecifico.max_monto > 0;

    const limitePlatBase = tieneLimitePar
      ? Number(cupoEspecifico!.max_monto)
      : (limites.limite_general_plataforma ?? defaultGen);
    const limitePlataformaEfectivo = limitePlatBase + extraAutorizado;

    const cupoGrupoEspecifico = grupoEfectivo ? limites.cupos_por_grupo?.[String(grupoEfectivo)] : null;
    const limiteGrupoBase = tieneLimitePar
      ? Number(cupoEspecifico!.max_monto)
      : typeof cupoGrupoEspecifico?.max_monto === "number" && cupoGrupoEspecifico.max_monto > 0
        ? cupoGrupoEspecifico.max_monto
        : (limites.limite_por_grupo ?? defaultGrp);
    const limiteGrupoEfectivo = limiteGrupoBase + extraAutorizado;

    // 2. Consultar acumulado ya jugado SOLO en este enfrentamiento y grupo en la fecha
    let qTickets = supabase
      .from("tickets_apuestas")
      .select(
        "id, monto_jugado, caballo, ejemplar_numero, nombre_jugada, grupo_cobro_id, grupo_cobro_nombre, fecha_registro, fecha_carrera, estado, nota_auditoria"
      )
      .eq("hipodromo", hipo)
      .eq("carrera", carr)
      .or(filtroDiaJornada(opts.fecha))
      .ilike("nombre_jugada", "%MARCA%");
    if (grupoEfectivo) {
      qTickets = qTickets.eq("grupo_cobro_id", String(grupoEfectivo));
    }
    const { data: tickets } = await qTickets;

    let totalParPlataforma = 0;
    let totalParGrupo = 0;

    for (const rawT of tickets ?? []) {
      const t = rawT as Record<string, unknown>;
      if (!perteneceADiaJornada(t, opts.fecha) || !esTicketMarcaActivo(t)) continue;
      const pTicket = extraerParTicketMarca(t, marcasLista);
      if (!coincideParMarca(pTicket.caballo, pTicket.rival, cabStr, rivStr)) continue;

      const m = Number(t.monto_jugado || 0);
      totalParPlataforma += m;
      if (!grupoEfectivo || String(t.grupo_cobro_id) === String(grupoEfectivo)) {
        totalParGrupo += m;
      }
    }

    const disponiblePlat = Math.max(0, limitePlataformaEfectivo - totalParPlataforma);
    const disponibleGrp = Math.max(0, limiteGrupoEfectivo - totalParGrupo);

    // Verificar límite estricto por jugada (solo exige autorización si acumulado + monto > límite)
    if (totalParGrupo + monto > limiteGrupoEfectivo) {
      if (opts.notificarAdmin !== false) {
        void comunicarCupoMarcaAgotadoAdmin({
          hipodromo: hipo,
          carrera: carr,
          fecha: opts.fecha,
          caballoNumero: cabStr,
          rival: rivStr || undefined,
          grupoId: grupoEfectivo,
          grupoNombre: opts.grupoNombre,
          jugadorNombre: opts.jugadorNombre,
          montoIntentado: monto,
          tipoLimite: "GRUPO",
        });
      }

      return {
        permitido: false,
        motivo: `La jugada ${etiquetaPar} supera el límite de grupo (${simbolo}${limiteGrupoEfectivo.toLocaleString("es-VE")}). Acumulado: ${simbolo}${totalParGrupo.toLocaleString("es-VE")} + ${simbolo}${monto.toLocaleString("es-VE")}. Disponible: ${simbolo}${disponibleGrp.toLocaleString("es-VE")}.`,
        etiquetaJugada: etiquetaPar,
        acumuladoPar: totalParGrupo,
        limitePlataforma: limitePlataformaEfectivo,
        limiteGrupo: limiteGrupoEfectivo,
        disponiblePlataforma: disponiblePlat,
        disponibleGrupo: disponibleGrp,
      };
    }

    if (totalParPlataforma + monto > limitePlataformaEfectivo) {
      if (opts.notificarAdmin !== false) {
        void comunicarCupoMarcaAgotadoAdmin({
          hipodromo: hipo,
          carrera: carr,
          fecha: opts.fecha,
          caballoNumero: cabStr,
          rival: rivStr || undefined,
          grupoId: grupoEfectivo,
          grupoNombre: opts.grupoNombre,
          jugadorNombre: opts.jugadorNombre,
          montoIntentado: monto,
          tipoLimite: "PLATAFORMA",
        });
      }

      return {
        permitido: false,
        motivo: `La jugada ${etiquetaPar} supera el límite de plataforma (${simbolo}${limitePlataformaEfectivo.toLocaleString("es-VE")}). Acumulado: ${simbolo}${totalParPlataforma.toLocaleString("es-VE")} + ${simbolo}${monto.toLocaleString("es-VE")}. Disponible: ${simbolo}${disponiblePlat.toLocaleString("es-VE")}.`,
        etiquetaJugada: etiquetaPar,
        acumuladoPar: totalParPlataforma,
        limitePlataforma: limitePlataformaEfectivo,
        limiteGrupo: limiteGrupoEfectivo,
        disponiblePlataforma: disponiblePlat,
        disponibleGrupo: disponibleGrp,
      };
    }

    return {
      permitido: true,
      etiquetaJugada: etiquetaPar,
      acumuladoPar: totalParGrupo,
      limitePlataforma: limitePlataformaEfectivo,
      limiteGrupo: limiteGrupoEfectivo,
      disponiblePlataforma: disponiblePlat,
      disponibleGrupo: disponibleGrp,
    };
  } catch (e) {
    console.error("Error al verificar cupo de marca:", e);
    return { permitido: true };
  }
}
