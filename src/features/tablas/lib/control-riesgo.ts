"use client";

import { supabase } from "@/core/supabase";
import type { TablaFijaRow } from "@/features/tablas/lib/tablas-fijas";
import { parseNum, type EjemplarTabla } from "@/features/tablas/lib/tipos";
import { listarCuposTabla, guardarCuposTabla, listarGruposVenta, registrarAuditoria, type CupoTablaGrupo } from "@/features/grupos/lib/grupos";
import { diaDeCarrera } from "@/features/carreras/lib/agruparHipodromos";

export type CompradorEjemplar = {
  ticketId: string | number;
  clienteId?: string | number | null;
  clienteNombre: string;
  grupoId?: string | number | null;
  grupoNombre: string;
  cantidad: number;
  monto: number;
  premioPagar: number;
  fechaHora: string;
};

export type AnalisisCaballoRiesgo = {
  numero: string;
  nombre: string;
  nacionalidad?: string | null;
  valorUnitario: number;
  retirado: boolean;
  invalidado: boolean;
  maxTablas: number | null; // Límite máximo configurado para este ejemplar
  tablasVendidas: number;
  recaudadoCaballo: number;
  premioTabla: number;
  pagoPotencial: number; // tablasVendidas * premioTabla
  balanceNeto: number; // totalRecaudadoCarrera - pagoPotencial (negativo = pérdida si gana)
  cupoAgotado: boolean;
  nivelRiesgo: "SEGURO" | "MODERADO" | "CRITICO";
  compradores: CompradorEjemplar[];
};

export type AnalisisRiesgoCarrera = {
  tablaId: string | number;
  hipodromo: string;
  carrera: number;
  fecha: string;
  premioTabla: number;
  moneda: string;
  totalRecaudadoCarrera: number;
  totalTablasVendidas: number;
  caballos: AnalisisCaballoRiesgo[];
  peorEscenario: {
    caballoNumero: string;
    caballoNombre: string;
    perdidaMaxima: number;
  } | null;
  hayCupoAgotado: boolean;
  haySobreexposicion: boolean;
  cuposGrupos: CupoTablaGrupo[];
};

/** Extrae el número de caballo de cadenas como "#1 THE BROTHER", "1", "#1", etc. */
export function extraerNumeroCaballo(cab: string | null | undefined): string {
  if (!cab) return "";
  const match = String(cab).trim().match(/^#?(\d+)/);
  return match ? match[1] : String(cab).trim();
}

/**
 * Consulta `tickets_apuestas` y `tabla_grupos` para calcular en tiempo real:
 * - Recaudación total de la carrera
 * - Tablas vendidas por caballo y por grupo
 * - Pago potencial de la banca si gana cada caballo
 * - Pérdida máxima admisible y nivel de sobreexposición
 * - Lista de quién ha comprado qué en cada ejemplar
 */
export async function obtenerAnalisisRiesgoTabla(
  tabla: TablaFijaRow
): Promise<AnalisisRiesgoCarrera> {
  const hipo = String(tabla.hipodromo ?? "").trim().toUpperCase();
  const carr = Number(tabla.carrera ?? 1);
  const fecha = diaDeCarrera(tabla, "", "carrera");
  const premioTabla = Number(tabla.premio_recalculado ?? tabla.premio_original ?? 0);
  const moneda = tabla.moneda ?? "USD";

  // 1. Cargar tickets vendidos de la carrera
  let tickets: Array<Record<string, unknown>> = [];
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("tickets_apuestas")
        .select("*")
        .eq("hipodromo", hipo)
        .eq("carrera", carr)
        .ilike("nombre_jugada", "TABLA%");

      if (!error && data) {
        tickets = data as Array<Record<string, unknown>>;
      }
    } catch {
      tickets = [];
    }
  }

  // 2. Cargar cupos por grupo (con defaults según moneda: 3 para USD, 3.000 / 1.000 para VES)
  let cuposGrupos = await listarCuposTabla(tabla.id).catch(() => []);
  if (cuposGrupos.length === 0) {
    const grupos = await listarGruposVenta().catch(() => []);
    cuposGrupos = grupos.map((g) => {
      const esBs =
        String(g.moneda ?? moneda ?? "").toUpperCase().includes("VES") ||
        String(g.moneda ?? "").toUpperCase().includes("BS");
      return {
        tabla_id: tabla.id,
        grupo_id: g.id,
        grupo_nombre: g.nombre,
        cupos: g.cupo_tabla ?? (esBs ? 3000 : 3),
        max: esBs ? 1000 : 3,
        cantidad_vendida: 0,
      };
    });
  }

  // 3. Agrupar compras por caballo
  const comprasPorCaballo = new Map<string, CompradorEjemplar[]>();
  let totalRecaudadoCarrera = 0;
  let totalTablasVendidas = 0;

  for (const t of tickets) {
    if (t.anulada || t.estado === "ANULADA") continue;
    const numCab = extraerNumeroCaballo(String(t.caballo ?? t.ejemplar_numero ?? ""));
    const cant = Math.max(1, Math.floor(Number(t.cantidad_tablas ?? t.cantidad ?? 1)));
    const monto = Number(t.monto_jugado ?? 0);
    const premio = Number(t.premio_pagar ?? premioTabla * cant);

    totalRecaudadoCarrera += monto;
    totalTablasVendidas += cant;

    const filaComprador: CompradorEjemplar = {
      ticketId: String(t.id ?? ""),
      clienteId: t.cliente_juega_id ? String(t.cliente_juega_id) : null,
      clienteNombre: String(t.cliente_juega_nombre ?? "Cliente"),
      grupoId: t.grupo_cobro_id ? String(t.grupo_cobro_id) : null,
      grupoNombre: String(t.grupo_cobro_nombre ?? "General"),
      cantidad: cant,
      monto,
      premioPagar: premio,
      fechaHora: t.fecha_registro ? new Date(String(t.fecha_registro)).toLocaleString("es-VE") : "—",
    };

    const lista = comprasPorCaballo.get(numCab) ?? [];
    lista.push(filaComprador);
    comprasPorCaballo.set(numCab, lista);
  }

  // 4. Analizar cada caballo de la tabla
  const caballosTabla = (tabla.caballos ?? []) as (EjemplarTabla & { max_tablas?: number | null })[];
  const analisisCaballos: AnalisisCaballoRiesgo[] = [];
  let peorEscenario: AnalisisRiesgoCarrera["peorEscenario"] = null;
  let maxPerdidaGlobal = 0;
  let hayCupoAgotado = false;
  let haySobreexposicion = false;

  for (const c of caballosTabla) {
    const numStr = String(c.numero);
    const compradores = comprasPorCaballo.get(numStr) ?? [];
    const tablasVendidas = compradores.reduce((acc, x) => acc + x.cantidad, 0);
    const recaudadoCaballo = compradores.reduce((acc, x) => acc + x.monto, 0);
    const valorUnit = parseNum(c.valor_ejemplar);

    // Límite de tablas del caballo (si está configurado)
    const maxTablas = typeof c.max_tablas === "number" ? c.max_tablas : null;
    const cupoAgotado = maxTablas !== null && tablasVendidas >= maxTablas;
    if (cupoAgotado) hayCupoAgotado = true;

    // Si el caballo está retirado o invalidado, el pago potencial es 0
    const noGana = Boolean(c.retirado || c.invalidado);
    const pagoPotencial = noGana ? 0 : tablasVendidas * premioTabla;
    const balanceNeto = totalRecaudadoCarrera - pagoPotencial;

    let nivelRiesgo: AnalisisCaballoRiesgo["nivelRiesgo"] = "SEGURO";
    if (!noGana && balanceNeto < 0) {
      const perdida = Math.abs(balanceNeto);
      if (perdida > maxPerdidaGlobal) {
        maxPerdidaGlobal = perdida;
        peorEscenario = {
          caballoNumero: numStr,
          caballoNombre: c.nombre || `Ejemplar #${numStr}`,
          perdidaMaxima: perdida,
        };
      }
      if (perdida > premioTabla * 2) {
        nivelRiesgo = "CRITICO";
        haySobreexposicion = true;
      } else {
        nivelRiesgo = "MODERADO";
      }
    }

    analisisCaballos.push({
      numero: numStr,
      nombre: c.nombre || `Ejemplar #${numStr}`,
      nacionalidad: c.nacionalidad,
      valorUnitario: valorUnit,
      retirado: Boolean(c.retirado),
      invalidado: Boolean(c.invalidado),
      maxTablas,
      tablasVendidas,
      recaudadoCaballo,
      premioTabla,
      pagoPotencial,
      balanceNeto,
      cupoAgotado,
      nivelRiesgo,
      compradores,
    });
  }

  return {
    tablaId: tabla.id,
    hipodromo: hipo,
    carrera: carr,
    fecha,
    premioTabla,
    moneda,
    totalRecaudadoCarrera,
    totalTablasVendidas,
    caballos: analisisCaballos,
    peorEscenario,
    hayCupoAgotado,
    haySobreexposicion,
    cuposGrupos,
  };
}

/**
 * Guarda o actualiza el límite máximo de tablas permitidas para un ejemplar específico.
 */
export async function guardarMaximoPorEjemplar(
  tablaId: string | number,
  caballoNumero: string | number,
  maxTablas: number | null
): Promise<{ ok: boolean; error?: string; caballos?: any[] }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };

  try {
    const { data: tRow, error: errFetch } = await supabase
      .from("tablas_fijas")
      .select("id, caballos")
      .eq("id", Number(tablaId))
      .maybeSingle();

    if (errFetch || !tRow) return { ok: false, error: errFetch?.message ?? "Tabla no encontrada." };

    const caballos = (Array.isArray(tRow.caballos) ? tRow.caballos : []) as Array<Record<string, unknown>>;
    const actualizados = caballos.map((c) => {
      if (String(c.numero) === String(caballoNumero)) {
        return { ...c, max_tablas: maxTablas };
      }
      return c;
    });

    const { error: errUpd } = await supabase
      .from("tablas_fijas")
      .update({ caballos: actualizados })
      .eq("id", Number(tablaId));

    if (errUpd) return { ok: false, error: errUpd.message };

    void registrarAuditoria(
      "TABLAS_FIJAS",
      "LIMITE_EJEMPLAR",
      `Tabla ${tablaId}: Límite del caballo #${caballoNumero} fijado en ${maxTablas ?? "Sin tope"} tablas.`
    );

    return { ok: true, caballos: actualizados };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Autoriza vender más tablas en un ejemplar cuyo cupo se ha agotado o está restringido.
 * Incrementa `max_tablas` en la cantidad adicional autorizada.
 */
export async function autorizarMasTablasEjemplar(opts: {
  tablaId: string | number;
  caballoNumero: string | number;
  tablasAdicionales: number;
  motivo?: string;
}): Promise<{ ok: boolean; nuevoTope?: number; error?: string; caballos?: any[] }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };

  try {
    const { data: tRow, error: errFetch } = await supabase
      .from("tablas_fijas")
      .select("id, caballos")
      .eq("id", Number(opts.tablaId))
      .maybeSingle();

    if (errFetch || !tRow) return { ok: false, error: errFetch?.message ?? "Tabla no encontrada." };

    const caballos = (Array.isArray(tRow.caballos) ? tRow.caballos : []) as Array<Record<string, unknown>>;
    let nuevoTope = 0;

    const actualizados = caballos.map((c) => {
      if (String(c.numero) === String(opts.caballoNumero)) {
        const actual = typeof c.max_tablas === "number" ? c.max_tablas : 10;
        nuevoTope = actual + Math.max(1, opts.tablasAdicionales);
        return {
          ...c,
          max_tablas: nuevoTope,
          tablas_autorizadas_extra: (Number(c.tablas_autorizadas_extra) || 0) + opts.tablasAdicionales,
        };
      }
      return c;
    });

    const { error: errUpd } = await supabase
      .from("tablas_fijas")
      .update({ caballos: actualizados })
      .eq("id", Number(opts.tablaId));

    if (errUpd) return { ok: false, error: errUpd.message };

    // Marcar como atendida cualquier notificación de cupo agotado para este caballo
    await supabase
      .from("notificaciones")
      .update({
        estado: "Aplicada",
        atendida_por: "ADMIN_AUTORIZACION",
        atendida_at: new Date().toISOString(),
      })
      .eq("tipo", "alerta_cupo_agotado")
      .ilike("titulo", `%#${opts.caballoNumero}%`);

    void registrarAuditoria(
      "TABLAS_FIJAS",
      "AUTORIZAR_CUPO",
      `Tabla ${opts.tablaId}: Autorizadas +${opts.tablasAdicionales} tablas en caballo #${opts.caballoNumero} (Nuevo tope: ${nuevoTope}). Motivo: ${opts.motivo || "Autorización manual del administrador"}`
    );

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("cupo_autorizado_tabla", {
          detail: { tablaId: opts.tablaId, caballoNumero: opts.caballoNumero, nuevoTope },
        })
      );
    }

    return { ok: true, nuevoTope, caballos: actualizados };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Notifica al administrador principal que el cupo de un caballo se ha agotado,
 * incluyendo la lista detallada de QUIÉN HA COMPRADO QUÉ en ese ejemplar.
 */
export async function comunicarCupoAgotadoAdmin(opts: {
  tabla: TablaFijaRow;
  caballoNumero: string | number;
  caballoNombre: string;
  grupoId?: string | number | null;
  grupoNombre?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "Sin conexión a Supabase" };

  try {
    const hipo = String(opts.tabla.hipodromo ?? "").toUpperCase();
    const carr = Number(opts.tabla.carrera ?? 1);
    const numCab = String(opts.caballoNumero);

    // Obtener quién compró en este caballo
    const { data: tickets } = await supabase
      .from("tickets_apuestas")
      .select("id, cliente_juega_nombre, grupo_cobro_nombre, cantidad_tablas, monto_jugado, premio_pagar, fecha_registro, caballo")
      .eq("hipodromo", hipo)
      .eq("carrera", carr)
      .ilike("nombre_jugada", "TABLA%")
      .order("fecha_registro", { ascending: false });

    const filtrados = (tickets ?? []).filter((t) =>
      extraerNumeroCaballo(String(t.caballo ?? "")) === numCab
    );

    const comprasResumen = filtrados.map((t) => ({
      jugador: String(t.cliente_juega_nombre ?? "Cliente"),
      grupo: String(t.grupo_cobro_nombre ?? "General"),
      cantidad: Number(t.cantidad_tablas ?? 1),
      monto: Number(t.monto_jugado ?? 0),
      premio: Number(t.premio_pagar ?? 0),
      fecha: t.fecha_registro ? new Date(String(t.fecha_registro)).toLocaleTimeString("es-VE") : "",
    }));

    const totalTablas = comprasResumen.reduce((a, b) => a + b.cantidad, 0);

    const titulo = `🚨 Cupo Agotado: Caballo #${numCab} ${opts.caballoNombre} (${hipo} C${carr})`;
    const mensaje = `Se ha agotado el cupo de venta para el caballo #${numCab} en ${opts.grupoNombre || "el grupo"}. Se han registrado ${comprasResumen.length} compra(s) por un total de ${totalTablas} tabla(s). Se requiere gestionar cupos o autorizar venta adicional.`;

    // Evitar notificaciones duplicadas en los últimos 2 minutos
    const haceDosMin = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: existen } = await supabase
      .from("notificaciones")
      .select("id")
      .eq("tipo", "alerta_cupo_agotado")
      .eq("titulo", titulo)
      .gte("created_at", haceDosMin)
      .limit(1);

    if (existen && existen.length > 0) {
      return { ok: true };
    }

    const { error: errNoti } = await supabase.from("notificaciones").insert([
      {
        tipo: "alerta_cupo_agotado",
        titulo,
        mensaje,
        estado: "Pendiente",
        datos: {
          tabla_id: opts.tabla.id,
          hipodromo: hipo,
          carrera: carr,
          caballo_numero: numCab,
          caballo_nombre: opts.caballoNombre,
          grupo_id: opts.grupoId ?? null,
          grupo_nombre: opts.grupoNombre ?? null,
          total_tablas_vendidas: totalTablas,
          compras: comprasResumen,
        },
      },
    ]);

    if (errNoti) return { ok: false, error: errNoti.message };

    // Emitir evento para activar la herramienta en la pantalla del administrador
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("alerta_cupo_agotado_recibida", {
          detail: {
            tablaId: opts.tabla.id,
            caballoNumero: numCab,
            caballoNombre: opts.caballoNombre,
            grupoNombre: opts.grupoNombre,
            totalTablas,
          },
        })
      );
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
