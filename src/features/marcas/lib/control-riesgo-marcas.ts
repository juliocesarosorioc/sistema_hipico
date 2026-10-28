"use client";

import { supabase } from "@/core/supabase";
import { registrarAuditoria } from "@/features/grupos/lib/grupos";
import { separarNumeros, type ConfigMarcas } from "@/features/marcas/lib/marcas";

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
  caballoNumero: string;
  esPrimeraMarca: boolean;
  esNV: boolean;
  ordenJerarquia: number; // 1 = 1ra marca, 2 = 2da marca, etc.
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

/** Valores por defecto si la carrera no tiene límites fijados */
export const LIMITES_MARCAS_DEFECTO: LimitesMarcas = {
  limite_general_plataforma: 120, // $120 por marca en la plataforma
  limite_por_grupo: 60,           // $60 por grupo
  cupos_por_marca: {},
  cupos_por_grupo: {},
};

/**
 * Calcula el pago bruto de una jugada de Marcas (120/100, proporción 11/6).
 */
export function calcularPagoBrutoMarca(monto: number): number {
  const gananciaNeta = (monto * 100) / 120;
  return Math.round((monto + gananciaNeta) * 100) / 100;
}

/**
 * Normaliza los límites de una carrera combinando valores guardados con los de defecto.
 */
export function normalizarLimitesMarcas(raw: unknown): LimitesMarcas {
  if (!raw || typeof raw !== "object") return { ...LIMITES_MARCAS_DEFECTO };
  const obj = raw as Record<string, unknown>;
  return {
    limite_general_plataforma:
      typeof obj.limite_general_plataforma === "number"
        ? obj.limite_general_plataforma
        : LIMITES_MARCAS_DEFECTO.limite_general_plataforma,
    limite_por_grupo:
      typeof obj.limite_por_grupo === "number"
        ? obj.limite_por_grupo
        : LIMITES_MARCAS_DEFECTO.limite_por_grupo,
    cupos_por_marca: (obj.cupos_por_marca ?? {}) as LimitesMarcas["cupos_por_marca"],
    cupos_por_grupo: (obj.cupos_por_grupo ?? {}) as LimitesMarcas["cupos_por_grupo"],
  };
}

/**
 * Realiza el análisis completo de riesgo financiero para una carrera de Marcas.
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
  const marcasLista = separarNumeros(cfg.marcas ?? "");
  const nvLista = separarNumeros(cfg.nv ?? "");
  const limites = normalizarLimitesMarcas(cfg.limites);

  // 2. Obtener tickets jugados de Marcas en esta carrera
  const { data: tickets } = await supabase
    .from("tickets_apuestas")
    .select("id, cliente_juega_nombre, grupo_cobro_nombre, caballo, monto_jugado, premio_pagar, fecha_registro, nota_auditoria")
    .eq("hipodromo", hipo)
    .eq("carrera", carr)
    .ilike("nombre_jugada", "MARCA%")
    .order("fecha_registro", { ascending: false });

  const ticketsValidos = (tickets ?? []).filter((t) => {
    // Excluir cancelados o anulados si aplica
    return t.monto_jugado != null && Number(t.monto_jugado) > 0;
  });

  const totalRecaudado = ticketsValidos.reduce((acc, t) => acc + Number(t.monto_jugado || 0), 0);
  const totalJugadas = ticketsValidos.length;

  // 3. Procesar compradores por caballo
  const compradoresPorCaballo: Record<string, CompradorMarca[]> = {};
  const montoPorCaballo: Record<string, number> = {};
  const pagoPorCaballo: Record<string, number> = {};

  for (const t of ticketsValidos) {
    const cabStr = String(t.caballo ?? "").replace(/\D/g, "");
    if (!cabStr) continue;

    const monto = Number(t.monto_jugado || 0);
    const premio = Number(t.premio_pagar) > 0 ? Number(t.premio_pagar) : calcularPagoBrutoMarca(monto);

    // Extraer rival si está en la nota de auditoría o texto
    let rivalStr = "";
    if (t.nota_auditoria && typeof t.nota_auditoria === "object") {
      const snap = (t.nota_auditoria as Record<string, unknown>).rivales_snapshot;
      if (Array.isArray(snap) && snap.length > 0) {
        rivalStr = String(snap[0]);
      }
    }

    if (!compradoresPorCaballo[cabStr]) {
      compradoresPorCaballo[cabStr] = [];
      montoPorCaballo[cabStr] = 0;
      pagoPorCaballo[cabStr] = 0;
    }

    compradoresPorCaballo[cabStr].push({
      ticketId: t.id,
      jugadorNombre: String(t.cliente_juega_nombre ?? "Cliente"),
      grupoNombre: String(t.grupo_cobro_nombre ?? "General"),
      caballo: cabStr,
      rival: rivalStr,
      monto,
      premioPotencial: premio,
      fecha: t.fecha_registro ? new Date(String(t.fecha_registro)).toLocaleTimeString("es-VE") : "",
    });

    montoPorCaballo[cabStr] += monto;
    pagoPorCaballo[cabStr] += premio;
  }

  // 4. Analizar cada marca y su balance neto
  const marcasAnalizadas: AnalisisMarcaItem[] = marcasLista.map((num, idx) => {
    const esPrimera = idx === 0;
    const esNv = nvLista.includes(num);
    const monto = montoPorCaballo[num] || 0;
    const pago = pagoPorCaballo[num] || 0;
    const balanceNeto = totalRecaudado - pago;

    // Calcular límites para esta marca
    const cupoEspecifico = limites.cupos_por_marca?.[num];
    const limiteBase =
      typeof cupoEspecifico?.max_monto === "number"
        ? cupoEspecifico.max_monto
        : (limites.limite_general_plataforma ?? 120);
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
      caballoNumero: num,
      esPrimeraMarca: esPrimera,
      esNV: esNv,
      ordenJerarquia: idx + 1,
      montoJugadoTotal: monto,
      pagoPotencialBanca: pago,
      balanceNetoBanca: balanceNeto,
      semaforo,
      limitePlataforma: limiteEfectivo,
      disponiblePlataforma: disponible,
      limiteGrupoDefault: limites.limite_por_grupo ?? 60,
      cupoAgotado,
      ampliacionAutorizada: extraAutorizado,
      compradores: compradoresPorCaballo[num] || [],
    };
  });

  // Identificar peor escenario
  let peorBalance = Infinity;
  let peorCaballo = marcasLista[0] || "";
  let peorSemaforo: "SEGURO" | "MODERADO" | "CRITICO" = "SEGURO";

  for (const m of marcasAnalizadas) {
    if (m.balanceNetoBanca < peorBalance) {
      peorBalance = m.balanceNetoBanca;
      peorCaballo = m.caballoNumero;
      peorSemaforo = m.semaforo;
    }
  }

  const hayCupoAgotado = marcasAnalizadas.some((m) => m.cupoAgotado);

  return {
    hipodromo: hipo,
    carrera: carr,
    fecha,
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
 * Amplía el cupo permitido para una marca específica (autorización del administrador).
 */
export async function ampliarCupoMarca(opts: {
  hipodromo: string;
  carrera: number;
  fecha: string;
  caballoNumero: string | number;
  montoAdicional: number;
  motivo?: string;
}): Promise<{ ok: boolean; nuevoLimite?: number; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };

  try {
    const hipo = String(opts.hipodromo).trim().toUpperCase();
    const carr = Number(opts.carrera);
    const cabStr = String(opts.caballoNumero);

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

    const limites = normalizarLimitesMarcas(row.limites);
    const cuposMarca = limites.cupos_por_marca ?? {};
    const marcaActual = cuposMarca[cabStr] ?? {};

    const ampliacionPrevia = Number(marcaActual.ampliacion_autorizada) || 0;
    const nuevaAmpliacion = ampliacionPrevia + Math.max(1, opts.montoAdicional);

    limites.cupos_por_marca = {
      ...cuposMarca,
      [cabStr]: {
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

    // Cerrar alertas pendientes de cupo agotado para este caballo
    await supabase
      .from("notificaciones")
      .update({
        estado: "Aplicada",
        atendida_por: "ADMIN_AMPLIACION_MARCA",
        atendida_at: new Date().toISOString(),
      })
      .eq("tipo", "alerta_cupo_marca_agotado")
      .ilike("titulo", `%#${cabStr}%`);

    void registrarAuditoria(
      "MARCAS",
      "AMPLIACION_CUPO",
      `Marca #${cabStr} en ${hipo} C${carr}: Cupo ampliado en +$${opts.montoAdicional}. Motivo: ${opts.motivo || "Demanda de jugadores"}`
    );

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("cupo_marca_ampliado", {
          detail: { hipodromo: hipo, carrera: carr, caballo: cabStr, nuevaAmpliacion },
        })
      );
    }

    const limiteBase = typeof marcaActual.max_monto === "number" ? marcaActual.max_monto : (limites.limite_general_plataforma ?? 120);
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
 * Comunica al Administrador Principal que una marca ha llegado al tope de cupo o límite,
 * detallando exactamente qué jugadores han comprado y qué montos se han registrado.
 */
export async function comunicarCupoMarcaAgotadoAdmin(opts: {
  hipodromo: string;
  carrera: number;
  fecha: string;
  caballoNumero: string | number;
  rival?: string;
  grupoNombre?: string;
  jugadorNombre?: string;
  montoIntentado?: number;
  tipoLimite?: "GRUPO" | "PLATAFORMA";
}): Promise<void> {
  if (!supabase) return;

  try {
    const hipo = String(opts.hipodromo).trim().toUpperCase();
    const carr = Number(opts.carrera);
    const cabStr = String(opts.caballoNumero);

    // 1. Obtener historial de compradores de esta marca en la carrera
    const { data: tickets } = await supabase
      .from("tickets_apuestas")
      .select("id, cliente_juega_nombre, grupo_cobro_nombre, monto_jugado, premio_pagar, fecha_registro, caballo")
      .eq("hipodromo", hipo)
      .eq("carrera", carr)
      .ilike("nombre_jugada", "MARCA%")
      .order("fecha_registro", { ascending: false });

    const filtrados = (tickets ?? []).filter((t) => {
      const num = String(t.caballo ?? "").replace(/\D/g, "");
      return num === cabStr;
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
    const titulo = `🚨 Cupo de Marca Agotado: #${cabStr} en ${hipo} C${carr}`;
    const mensaje = `El caballo #${cabStr} ha llegado al tope (${tipoDesc}) en ${hipo} C${carr}. Total acumulado: $${totalJugado}. Últimos jugadores: ${listaCompradoresStr || "Sin apuestas registradas"}. El jugador ${opts.jugadorNombre || "Jugador"} (${opts.grupoNombre || "Grupo"}) intentó apostar $${opts.montoIntentado || 0}. El Administrador puede ampliar cupo o modificar el orden de marcas.`;

    await supabase.from("notificaciones").insert({
      tipo: "alerta_cupo_marca_agotado",
      titulo,
      mensaje,
      datos: {
        hipodromo: hipo,
        carrera: carr,
        fecha: opts.fecha,
        caballo_numero: cabStr,
        tipo_limite: opts.tipoLimite || "PLATAFORMA",
        total_acumulado: totalJugado,
        monto_intentado: opts.montoIntentado,
        jugador_intentando: opts.jugadorNombre,
        grupo_intentando: opts.grupoNombre,
        compradores: compradoresResumen,
      },
      estado: "Pendiente",
      created_at: new Date().toISOString(),
    });

    void registrarAuditoria(
      "MARCAS",
      "ALERTA_CUPO_AGOTADO",
      `Alerta de cupo enviada al Admin: Marca #${cabStr} en ${hipo} C${carr}. ${tipoDesc} alcanzado.`
    );
  } catch (e) {
    console.error("Error al comunicar cupo agotado de marca:", e);
  }
}

/**
 * Verifica si un jugador puede comprar una marca según los límites de su grupo
 * y el límite general de la plataforma.
 */
export async function verificarCupoMarcaDisponible(opts: {
  hipodromo: string;
  carrera: number;
  fecha: string;
  caballoNumero: string | number;
  grupoId?: string | number | null;
  grupoNombre?: string;
  jugadorNombre?: string;
  montoAComprar: number;
}): Promise<{
  permitido: boolean;
  motivo?: string;
  limitePlataforma?: number;
  limiteGrupo?: number;
  disponiblePlataforma?: number;
  disponibleGrupo?: number;
}> {
  if (!supabase) return { permitido: true };

  try {
    const hipo = String(opts.hipodromo).trim().toUpperCase();
    const carr = Number(opts.carrera);
    const cabStr = String(opts.caballoNumero);
    const monto = Number(opts.montoAComprar) || 0;

    // 1. Obtener la configuración de la carrera y sus límites
    const { data: cfgRow } = await supabase
      .from("marcas_carrera")
      .select("limites")
      .ilike("hipodromo", hipo)
      .eq("fecha", opts.fecha)
      .eq("carrera", carr)
      .maybeSingle();

    const limites = normalizarLimitesMarcas(cfgRow?.limites);
    const cupoEspecifico = limites.cupos_por_marca?.[cabStr];

    const limitePlatBase =
      typeof cupoEspecifico?.max_monto === "number"
        ? cupoEspecifico.max_monto
        : (limites.limite_general_plataforma ?? 120);
    const extraAutorizado = Number(cupoEspecifico?.ampliacion_autorizada) || 0;
    const limitePlataformaEfectivo = limitePlatBase + extraAutorizado;

    // Límite por grupo
    const cupoGrupoEspecifico = opts.grupoId ? limites.cupos_por_grupo?.[String(opts.grupoId)] : null;
    const limiteGrupoEfectivo =
      typeof cupoGrupoEspecifico?.max_monto === "number"
        ? cupoGrupoEspecifico.max_monto
        : (limites.limite_por_grupo ?? 60);

    // 2. Consultar acumulado ya jugado en esta marca
    const { data: tickets } = await supabase
      .from("tickets_apuestas")
      .select("monto_jugado, caballo, grupo_cobro_id, grupo_cobro_nombre")
      .eq("hipodromo", hipo)
      .eq("carrera", carr)
      .ilike("nombre_jugada", "MARCA%");

    let totalPlataforma = 0;
    let totalGrupo = 0;

    for (const t of tickets ?? []) {
      const num = String(t.caballo ?? "").replace(/\D/g, "");
      if (num === cabStr) {
        const m = Number(t.monto_jugado || 0);
        totalPlataforma += m;
        if (opts.grupoId && String(t.grupo_cobro_id) === String(opts.grupoId)) {
          totalGrupo += m;
        }
      }
    }

    const disponiblePlat = Math.max(0, limitePlataformaEfectivo - totalPlataforma);
    const disponibleGrp = Math.max(0, limiteGrupoEfectivo - totalGrupo);

    // Verificar límite de grupo
    if (totalGrupo + monto > limiteGrupoEfectivo) {
      void comunicarCupoMarcaAgotadoAdmin({
        hipodromo: hipo,
        carrera: carr,
        fecha: opts.fecha,
        caballoNumero: cabStr,
        grupoNombre: opts.grupoNombre,
        jugadorNombre: opts.jugadorNombre,
        montoIntentado: monto,
        tipoLimite: "GRUPO",
      });

      return {
        permitido: false,
        motivo: `Límite de grupo alcanzado para la Marca #${cabStr}. Disponible para tu grupo: $${disponibleGrp}.`,
        limitePlataforma: limitePlataformaEfectivo,
        limiteGrupo: limiteGrupoEfectivo,
        disponiblePlataforma: disponiblePlat,
        disponibleGrupo: disponibleGrp,
      };
    }

    // Verificar límite general de plataforma
    if (totalPlataforma + monto > limitePlataformaEfectivo) {
      void comunicarCupoMarcaAgotadoAdmin({
        hipodromo: hipo,
        carrera: carr,
        fecha: opts.fecha,
        caballoNumero: cabStr,
        grupoNombre: opts.grupoNombre,
        jugadorNombre: opts.jugadorNombre,
        montoIntentado: monto,
        tipoLimite: "PLATAFORMA",
      });

      return {
        permitido: false,
        motivo: `Cupo de la plataforma agotado para la Marca #${cabStr}. Disponible: $${disponiblePlat}.`,
        limitePlataforma: limitePlataformaEfectivo,
        limiteGrupo: limiteGrupoEfectivo,
        disponiblePlataforma: disponiblePlat,
        disponibleGrupo: disponibleGrp,
      };
    }

    return {
      permitido: true,
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
