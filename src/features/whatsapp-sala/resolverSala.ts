import { supabaseAdmin } from "@/core/supabase-admin";
import { resolverCodigoSalaGrupo } from "@/features/grupos/lib/codigo-sala";
import type { ContextoSala } from "./types";

export const codigoSalaPorSalaId = new Map<string, string>();
export const codigoSalaPorGrupoId = new Map<string, string>();

export async function recordarCodigoSala(datos: {
  salaId?: string | number | null;
  grupoId?: string | number | null;
  nombre?: string | null;
}): Promise<string> {
  const salaId = datos.salaId ? String(datos.salaId) : "";
  const grupoId = datos.grupoId ? String(datos.grupoId) : "";
  if (salaId && codigoSalaPorSalaId.has(salaId)) return codigoSalaPorSalaId.get(salaId) || "";
  if (grupoId && codigoSalaPorGrupoId.has(grupoId)) return codigoSalaPorGrupoId.get(grupoId) || "";

  const codigo = await resolverCodigoSalaGrupo(supabaseAdmin, {
    salaId: datos.salaId,
    grupoId: datos.grupoId,
    nombre: datos.nombre || "PRINCIPAL",
  });
  if (salaId) codigoSalaPorSalaId.set(salaId, codigo);
  if (grupoId) codigoSalaPorGrupoId.set(grupoId, codigo);
  return codigo;
}

export function codigoSalaEnRespuesta(body: any): string {
  if (!body || typeof body !== "object") return "";
  const salaId = body.sala?.id ? String(body.sala.id) : body.salaId ? String(body.salaId) : "";
  const grupoId = body.grupoId ? String(body.grupoId) : "";
  return (
    (salaId ? codigoSalaPorSalaId.get(salaId) : "") ||
    (grupoId ? codigoSalaPorGrupoId.get(grupoId) : "") ||
    ""
  );
}

// Cierre VULN-15: Set en memoria de los últimos 1000 whatsappMsgId (por sala) para descartar reintentos en < 1ms
const ultimosWhatsappMsgIds = new Set<string>();
export function esWhatsappMsgIdDuplicado(msgId?: string | null, salaId?: string | null): boolean {
  if (!msgId) return false;
  const key = salaId ? `${msgId}:${salaId}` : msgId;
  if (ultimosWhatsappMsgIds.has(key)) return true;
  ultimosWhatsappMsgIds.add(key);
  if (ultimosWhatsappMsgIds.size > 1000) {
    const primer = ultimosWhatsappMsgIds.values().next().value;
    if (primer) ultimosWhatsappMsgIds.delete(primer);
  }
  return false;
}

export function normalizarNombreHipodromo(raw?: string | null): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/^HIPODROMO\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Resuelve un hipódromo contra la tabla oficial `public.hipodromos`. */
export async function resolverHipodromoEnTabla(
  nombre?: string | null
): Promise<{ id?: string; nombre: string } | null> {
  const buscado = normalizarNombreHipodromo(nombre);
  if (!buscado) return null;

  const { data, error } = await supabaseAdmin
    .from("hipodromos")
    .select("id, nombre")
    .order("nombre", { ascending: true });

  const filas: any[] = Array.isArray(data) ? (data as any[]) : [];

  if (error || filas.length === 0) {
    const { data: exacta } = await supabaseAdmin
      .from("hipodromos")
      .select("id, nombre")
      .ilike("nombre", String(nombre).trim())
      .limit(1)
      .maybeSingle();
    if (!exacta) return null;
    return {
      id: (exacta as any).id ? String((exacta as any).id) : undefined,
      nombre: String((exacta as any).nombre || nombre).trim().toUpperCase(),
    };
  }

  const exacta = filas.find(
    (h) => normalizarNombreHipodromo(h?.nombre) === buscado
  );
  if (exacta) {
    return {
      id: exacta.id ? String(exacta.id) : undefined,
      nombre: String(exacta.nombre || nombre).trim().toUpperCase(),
    };
  }

  const coincidencias = filas.filter((h) => {
    const norm = normalizarNombreHipodromo(h?.nombre);
    return Boolean(norm) && (norm.includes(buscado) || buscado.includes(norm));
  });
  if (coincidencias.length !== 1) return null;
  const unica = coincidencias[0];
  return {
    id: unica.id ? String(unica.id) : undefined,
    nombre: String(unica.nombre || nombre).trim().toUpperCase(),
  };
}

export function esUuidCarreraValido(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim())
  );
}

/**
 * Garantiza que una sala con carrera abierta tenga `carrera_activa_id`.
 * Si es null, busca la carrera (fecha de hoy + hipódromo + número) en `public.carreras`;
 * si no existe, la crea como "Abierta", y vincula el id a `salas_juego`.
 * Muta `sala.carrera_activa_id` y devuelve el id resuelto (o null si falló).
 */
export async function asegurarCarreraActivaSala(sala: any): Promise<string | null> {
  if (esUuidCarreraValido(sala?.carrera_activa_id)) return String(sala.carrera_activa_id);

  try {
    const hipodromo = normalizarNombreHipodromo(sala?.hipodromo_activo) || "LA RINCONADA";
    const numero = Number(sala?.numero_carrera_activa) || 1;
    const fecha = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Caracas",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    const buscar = async (): Promise<string | null> => {
      const { data, error } = await supabaseAdmin
        .from("carreras")
        .select("id")
        .eq("fecha", fecha)
        .ilike("hipodromo", hipodromo)
        .eq("carrera", numero)
        .limit(1)
        .maybeSingle();
      if (error) console.error("[CONCRETAR_ERROR] buscar carrera activa:", error);
      if (data && esUuidCarreraValido((data as any).id)) return String((data as any).id);

      // Buscar última carrera abierta para este hipódromo
      const { data: dataAbierta, error: errAbierta } = await supabaseAdmin
        .from("carreras")
        .select("id")
        .ilike("hipodromo", hipodromo)
        .ilike("estado", "abierta")
        .order("fecha", { ascending: false })
        .order("carrera", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!errAbierta && dataAbierta && esUuidCarreraValido((dataAbierta as any).id)) {
        return String((dataAbierta as any).id);
      }

      // Buscar cualquier última carrera abierta en el sistema
      const { data: anyAbierta, error: errAny } = await supabaseAdmin
        .from("carreras")
        .select("id")
        .ilike("estado", "abierta")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!errAny && anyAbierta && esUuidCarreraValido((anyAbierta as any).id)) {
        return String((anyAbierta as any).id);
      }

      return null;
    };

    let carreraId = await buscar();
    if (!carreraId) {
      const { data: creada, error: errCrear } = await supabaseAdmin
        .from("carreras")
        .insert({
          fecha,
          hipodromo,
          carrera: numero,
          estado: "Abierta",
          origen: "manual",
          registrado_por: "WHATSAPP_SALA",
        })
        .select("id")
        .maybeSingle();
      if (errCrear) {
        console.error("[CONCRETAR_ERROR] crear carrera activa:", errCrear);
        carreraId = await buscar(); // posible carrera concurrente (unique fecha/hipodromo/carrera)
      } else if (creada && esUuidCarreraValido((creada as any).id)) {
        carreraId = String((creada as any).id);
      }
    }

    if (carreraId) {
      const { error: errSala } = await supabaseAdmin
        .from("salas_juego")
        .update({ carrera_activa_id: carreraId, updated_at: new Date().toISOString() })
        .eq("id", sala.id);
      if (errSala) console.error("[CONCRETAR_ERROR] vincular carrera_activa_id a sala:", errSala);
      sala.carrera_activa_id = carreraId;
      return carreraId;
    }
  } catch (e) {
    console.error("[CONCRETAR_ERROR] asegurarCarreraActivaSala:", e);
  }
  return null;
}

export async function resolverSala(params: {
  groupJid: string;
  salaId?: string | null;
  grupoId?: string | number | null;
  whatsappGroupNombre?: string | null;
}): Promise<ContextoSala | null> {
  const { groupJid, salaId: salaIdBody, grupoId: grupoIdBody, whatsappGroupNombre } = params;
  let sala: any = null;

  if (salaIdBody) {
    const { data: sPorId } = await supabaseAdmin
      .from("salas_juego")
      .select("*")
      .eq("id", salaIdBody)
      .maybeSingle();
    sala = sPorId || null;
  }
  if (!sala && groupJid) {
    const { data: vinculo } = await supabaseAdmin
      .from("salas_whatsapp_grupos")
      .select("salas_juego(*)")
      .eq("whatsapp_group_jid", groupJid)
      .eq("activo", true)
      .limit(1)
      .maybeSingle();
    if ((vinculo as any)?.salas_juego) {
      sala = (vinculo as any).salas_juego;
    }
  }
  if (!sala && groupJid) {
    const { data: sLegacy } = await supabaseAdmin
      .from("salas_juego")
      .select("*")
      .eq("whatsapp_group_jid", groupJid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    sala = sLegacy || null;
  }
  if (!sala && grupoIdBody) {
    const { data: sGrp } = await supabaseAdmin
      .from("salas_juego")
      .select("*")
      .eq("grupo_id", String(grupoIdBody))
      .eq("activa", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (sGrp) {
      sala = sGrp;
      if (!sGrp.whatsapp_group_jid && groupJid) {
        await supabaseAdmin
          .from("salas_juego")
          .update({
            whatsapp_group_jid: groupJid,
            whatsapp_group_nombre: whatsappGroupNombre || sGrp.whatsapp_group_nombre || null,
          })
          .eq("id", sGrp.id);
        sala.whatsapp_group_jid = groupJid;
      }
    }
  }

  if (!sala) return null;

  const salaId = String(sala.id);
  const grupoId = String(sala.grupo_id);
  const codigoSala = await recordarCodigoSala({
    salaId,
    grupoId,
    nombre: sala.nombre_grupo || sala.nombre || whatsappGroupNombre || "PRINCIPAL",
  });
  const carreraAbierta = String(sala.estado_carrera || "").toLowerCase() === "abierta";

  if (carreraAbierta && !sala.carrera_activa_id) {
    await asegurarCarreraActivaSala(sala);
  }

  return {
    sala,
    salaId,
    grupoId,
    codigoSala,
    carreraAbierta,
    carreraActivaId: sala.carrera_activa_id || null,
    tiempoVencimientoMin: Number(sala.tiempo_vencimiento_propuesta_min || sala.tiempo_vencimiento_min || 5),
    apuestaMinima: Number(sala.apuesta_minima || 10.0),
    retirados: Array.isArray(sala.retirados) ? sala.retirados : [],
  };
}

export async function obtenerSalasUnicas() {
  const { data: salasExistentes } = await supabaseAdmin
    .from("salas_juego")
    .select("*")
    .eq("activa", true)
    .order("orden_sala", { ascending: true });

  const { data: gruposSistema } = await supabaseAdmin
    .from("grupos_venta")
    .select("id, nombre")
    .eq("activo", true);

  const grupoNombrePorId = new Map<string, string>();
  for (const g of gruposSistema || []) {
    if (g?.id) grupoNombrePorId.set(String(g.id), String(g.nombre || ""));
  }

  if (salasExistentes && salasExistentes.length > 0) {
    return salasExistentes.map((s: any) => ({
      ...s,
      grupo_nombre: grupoNombrePorId.get(String(s.grupo_id)) || null,
    }));
  }

  // Si no hay ninguna sala activa, crear una única "Sala de Juegos" para el grupo principal
  let { data: grupoPrincipal } = await supabaseAdmin
    .from("grupos_venta")
    .select("id, nombre")
    .eq("activo", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!grupoPrincipal) {
    const { data: creado } = await supabaseAdmin
      .from("grupos_venta")
      .insert({
        nombre: "Grupo Oficial",
        slug: "oficial",
        activo: true,
        permite_cruces: true,
        comision_default: 5,
        moneda: "USD",
      })
      .select("id, nombre")
      .single();
    grupoPrincipal = creado;
  }

  const grupoId = grupoPrincipal?.id || "default";

  const { data: salaCreada } = await supabaseAdmin
    .from("salas_juego")
    .insert({
      grupo_id: grupoId,
      nombre_sala: "Sala de Juegos",
      orden_sala: 1,
      activa: true,
      estado_carrera: "abierta",
      hipodromo_activo: "LA RINCONADA",
      numero_carrera_activa: 1,
    })
    .select("*")
    .single();

  return [
    {
      ...(salaCreada || {}),
      grupo_nombre: grupoPrincipal?.nombre || "Grupo Oficial",
    },
  ];
}
