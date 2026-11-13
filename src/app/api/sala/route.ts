import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/core/supabase-admin";
import {
  autenticarPeticionSala,
  iniciarSesionOperadorSala,
  puedeOperarSala,
  puedeLiquidarSala,
  puedeRetirarEjemplar,
  grupoPermitido,
  resolverGrupoEfectivo,
  type IdentidadSala,
} from "@/features/sala-juegos/lib/sala-auth";
import {
  analizarYEstandarizarJugada,
  analizarComandoRetiro,
} from "@/features/sala-juegos/lib/parser-pedagogico";
import { validarSolicitudRecargaServidor } from "@/features/sala-juegos/lib/recargas-server";
import {
  formatearMontoRegional,
  parsearMontoConK,
  prefijoMonedaGrupo,
} from "@/shared/lib/dinero";
import {
  construirMensajeCarreraAbierta,
  construirMensajeCarreraCerrada,
  parsearPizarraLlegadaTexto,
} from "@/features/sala-juegos/lib/mensajes-carrera";
import {
  sincronizarTicketsPropuestaATaquilla,
  actualizarTicketEspejoLiquidado,
  revertirTicketsEspejoSala,
  anularTicketsEspejoSala,
} from "@/features/whatsapp-sala/lib/sincronizar-tickets-sala";

export const dynamic = "force-dynamic";

/**
 * Notifica a los clientes vía Supabase Broadcast si está configurado
 */
async function emitirBroadcast(salaId: string, evento: string, payload: any) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;

    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic: `realtime:sala:${salaId}`,
            event: evento,
            payload,
          },
        ],
      }),
    }).catch(() => {});
  } catch {
    // Modo resiliente
  }
}

/**
 * Calcula el saldo disponible de un cliente
 */
function calcularDisponibleCliente(cliente: any): number {
  if (cliente.libre) return 999999;
  const saldo = Number(cliente.saldo_actual || 0);
  const aval = Number(cliente.aval || 0);
  const retenido = Number(cliente.saldo_retenido || 0);
  return Math.max(0, Number((saldo + aval - retenido).toFixed(2)));
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Valida si un string cumple el formato UUID canónico de Postgres
 */
function esUuidValido(val?: string | null): boolean {
  if (!val || typeof val !== "string") return false;
  return UUID_REGEX.test(val.trim());
}

/**
 * Sincroniza chat_estado_grupo de forma agregada
 */
async function sincronizarEstadoGrupo(grupoId: string) {
  try {
    const { data: salas } = await supabaseAdmin
      .from("salas_juego")
      .select("id, hipodromo_activo, numero_carrera_activa, carrera_activa_id, estado_carrera")
      .eq("grupo_id", grupoId)
      .eq("activa", true);

    if (!salas || salas.length === 0) return;

    const algunaAbierta = salas.some((s) => s.estado_carrera === "abierta");
    const salaPrincipal = salas.find((s) => s.estado_carrera === "abierta") || salas[0];

    await supabaseAdmin
      .from("chat_estado_grupo")
      .upsert(
        {
          grupo_id: grupoId,
          carrera_activa_id: salaPrincipal.carrera_activa_id,
          hipodromo_activo: salaPrincipal.hipodromo_activo,
          numero_carrera_activa: salaPrincipal.numero_carrera_activa,
          estado_carrera: algunaAbierta ? "ABIERTA" : "CERRADA",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "grupo_id" }
      );
  } catch {
    // Sincronización secundaria no bloqueante
  }
}

// ============================================================================
// GET: Bootstrap, Estado, Mensajes, Publicidad, Grupos, Cliente
// ============================================================================
export async function GET(req: Request) {
  const auth = await autenticarPeticionSala(req);
  const { searchParams } = new URL(req.url);
  const accion = searchParams.get("accion") || "bootstrap";
  const grupoIdSolicitado = searchParams.get("grupoId");

  let identidad: IdentidadSala;
  if (!auth.ok || !auth.identidad) {
    // Si no tiene sesión activa pero pide lectura (bootstrap, estado, mensajes),
    // permitir acceso en modo ESPECTADOR para garantizar que la pantalla nunca quede en negro en móviles
    if (accion === "bootstrap" || accion === "estado" || accion === "mensajes") {
      identidad = {
        tipo: "JUGADOR",
        usuarioId: "espectador",
        nombre: "Espectador",
        grupoId: grupoIdSolicitado || null,
        esAdmin: false,
        esOperador: false,
        permisos: ["ver"],
        clienteRow: {
          id: "espectador",
          nombre: "Espectador",
          saldo_actual: 0,
          saldo_retenido: 0,
          saldo_disponible: 0,
          libre: false,
          grupo_id: grupoIdSolicitado || "",
          activo: true,
        },
      };
    } else {
      return NextResponse.json({ ok: false, error: auth.error || "No autorizado" }, { status: auth.status || 401 });
    }
  } else {
    identidad = auth.identidad;
  }

  const grupoId = resolverGrupoEfectivo(identidad, grupoIdSolicitado);

  // Verificación de aislamiento estricto por grupo (solo para usuarios autenticados)
  if (identidad.usuarioId !== "espectador" && grupoId && !grupoPermitido(identidad, grupoId)) {
    return NextResponse.json(
      { ok: false, error: "Acceso denegado a este grupo de juego" },
      { status: 403 }
    );
  }

  try {
    // 1. BOOTSTRAP
    if (accion === "bootstrap") {
      let gruposDisponibles: any[] = [];
      if (identidad.tipo === "STAFF" || identidad.usuarioId === "espectador") {
        const { data: gList } = await supabaseAdmin
          .from("grupos_venta")
          .select("id, nombre, permite_cruces, comision_default, activo, moneda")
          .eq("activo", true)
          .order("nombre");
        gruposDisponibles = gList || [];
      } else if (identidad.grupoId) {
        const { data: g } = await supabaseAdmin
          .from("grupos_venta")
          .select("id, nombre, permite_cruces, comision_default, activo, moneda")
          .eq("id", identidad.grupoId)
          .maybeSingle();
        if (g) gruposDisponibles = [g];
      }

      if (!gruposDisponibles || gruposDisponibles.length === 0) {
        const { data: fallbackG } = await supabaseAdmin
          .from("grupos_venta")
          .select("id, nombre, permite_cruces, comision_default, activo, moneda")
          .eq("activo", true)
          .order("nombre");
        gruposDisponibles = fallbackG || [];
      }

      let grupoEfectivoId = grupoId || gruposDisponibles[0]?.id;
      if (!grupoEfectivoId) {
        const { data: nuevoGrupo } = await supabaseAdmin
          .from("grupos_venta")
          .insert({
            nombre: "Grupo Principal",
            slug: "principal",
            activo: true,
            permite_cruces: true,
            comision_default: 0,
            moneda: "USD",
          })
          .select()
          .single();
        if (nuevoGrupo) {
          gruposDisponibles = [nuevoGrupo];
          grupoEfectivoId = nuevoGrupo.id;
        }
      }
      if (!grupoEfectivoId) {
        return NextResponse.json({ ok: false, error: "No hay grupo de juego disponible" }, { status: 400 });
      }

      const { data: grupoActivo } = await supabaseAdmin
        .from("grupos_venta")
        .select("id, nombre, permite_cruces, comision_default, activo, moneda")
        .eq("id", grupoEfectivoId)
        .maybeSingle();

      // Máximo 2 salas activas por grupo
      let { data: salas } = await supabaseAdmin
        .from("salas_juego")
        .select("*")
        .eq("grupo_id", grupoEfectivoId)
        .eq("activa", true)
        .order("orden_sala", { ascending: true })
        .limit(2);

      // Si el grupo no tiene salas configuradas, auto-aprovisionar las 2 salas estándar inmediatamente
      if (!salas || salas.length === 0) {
        const nombreGrupo = grupoActivo?.nombre || "Oficial";
        await supabaseAdmin.from("salas_juego").insert([
          {
            grupo_id: grupoEfectivoId,
            nombre_sala: `Sala Principal · ${nombreGrupo}`,
            orden_sala: 1,
            activa: true,
            estado_carrera: "cerrada",
            tiempo_vigencia_segundos: 120,
            hipodromo_activo: "LA RINCONADA",
            numero_carrera_activa: 1,
          },
          {
            grupo_id: grupoEfectivoId,
            nombre_sala: `Sala 2 · ${nombreGrupo}`,
            orden_sala: 2,
            activa: true,
            estado_carrera: "cerrada",
            tiempo_vigencia_segundos: 120,
            hipodromo_activo: "LA RINCONADA",
            numero_carrera_activa: 1,
          },
        ]);

        const { data: salasCreadas } = await supabaseAdmin
          .from("salas_juego")
          .select("*")
          .eq("grupo_id", grupoEfectivoId)
          .eq("activa", true)
          .order("orden_sala", { ascending: true })
          .limit(2);

        salas = salasCreadas || [];
      }

      // Publicidad activa
      const { data: publicidad } = await supabaseAdmin
        .from("publicidad_sala")
        .select("*")
        .eq("grupo_id", grupoEfectivoId)
        .eq("activo", true)
        .order("fijado_en_tope", { ascending: false })
        .order("created_at", { ascending: false });

      // Estado global del grupo
      const { data: estadoGrupo } = await supabaseAdmin
        .from("chat_estado_grupo")
        .select("*")
        .eq("grupo_id", grupoEfectivoId)
        .maybeSingle();

      // Saldo fresco si es jugador autenticado
      let datosJugador = null;
      if (identidad.tipo === "JUGADOR" && identidad.usuarioId && identidad.usuarioId !== "espectador") {
        const { data: cl } = await supabaseAdmin
          .from("clientes")
          .select("*")
          .eq("id", identidad.usuarioId)
          .maybeSingle();

        if (cl) {
          const rec = cl as Record<string, unknown>;
          // Nunca devolver credenciales de portal al navegador: son secretos
          // del cliente y no los usa ninguna vista de la Sala.
          const recSeguro = { ...rec };
          delete recSeguro.portal_clave;
          delete recSeguro.portal_token;
          const libre = Boolean(recSeguro.libre || String(recSeguro.modo_juego ?? "").toLowerCase() === "libre");
          const disponible = calcularDisponibleCliente({ ...recSeguro, libre });
          datosJugador = {
            ...recSeguro,
            libre,
            saldo_retenido: Number(rec.saldo_retenido ?? 0) || 0,
            saldo_disponible: disponible,
          };
        }
      }

      return NextResponse.json({
        ok: true,
        identidad: {
          ...identidad,
          esOperador: puedeOperarSala(identidad, grupoEfectivoId),
          clienteRow: datosJugador || identidad.clienteRow,
        },
        grupos: gruposDisponibles,
        grupoActivo,
        salas: salas || [],
        publicidad: publicidad || [],
        estadoGrupo,
      });
    }

    // 2. ESTADO
    if (accion === "estado") {
      if (!grupoId) {
        return NextResponse.json({ ok: false, error: "grupoId es requerido" }, { status: 400 });
      }

      const { data: salas } = await supabaseAdmin
        .from("salas_juego")
        .select("*")
        .eq("grupo_id", grupoId)
        .eq("activa", true)
        .order("orden_sala", { ascending: true })
        .limit(2);

      const { data: estadoGrupo } = await supabaseAdmin
        .from("chat_estado_grupo")
        .select("*")
        .eq("grupo_id", grupoId)
        .maybeSingle();

      return NextResponse.json({ ok: true, salas: salas || [], estadoGrupo });
    }

    // 3. MENSAJES
    if (accion === "mensajes") {
      const salaId = searchParams.get("salaId");
      const limit = Math.min(100, Math.max(10, Number(searchParams.get("limit") || 50)));

      if (!salaId) {
        return NextResponse.json({ ok: false, error: "salaId es requerido" }, { status: 400 });
      }

      const { data: sala } = await supabaseAdmin
        .from("salas_juego")
        .select("id, grupo_id")
        .eq("id", salaId)
        .maybeSingle();

      if (!sala || (identidad.usuarioId !== "espectador" && !grupoPermitido(identidad, sala.grupo_id))) {
        return NextResponse.json({ ok: false, error: "Sala no encontrada o no autorizada" }, { status: 403 });
      }

      const { data: mensajes, error } = await supabaseAdmin
        .from("chat_mensajes")
        .select("*")
        .eq("sala_id", salaId)
        .eq("eliminado", false)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      // Filtrado de mensajes privados
      const mensajesFiltrados = (mensajes || []).filter((m) => {
        if (!m.destinatario_privado_id && m.tipo_mensaje !== "DM_PRIVADO") return true;
        if (identidad.esAdmin || identidad.esOperador) return true;
        if (m.remitente_id === identidad.usuarioId) return true;
        if (m.destinatario_privado_id === identidad.usuarioId) return true;
        return false;
      });

      // Adjuntar desglose de quiénes van jugando cada propuesta ("Eddie jugó 43,50")
      const idsPropuestas = mensajesFiltrados
        .filter((m) => m.tipo_mensaje === "propuesta_jugada" || m.tipo_mensaje === "PROPUESTA")
        .map((m) => m.id)
        .filter(Boolean);

      const desglosePorPropuesta = new Map<string, Array<{ jugador: string; monto: number; hora?: string }>>();
      if (idsPropuestas.length > 0) {
        try {
          const { data: ticketsProp } = await supabaseAdmin
            .from("chat_tickets_fifo")
            .select("propuesta_msg_id, aceptante_nombre, monto_concretado, created_at, estado")
            .in("propuesta_msg_id", idsPropuestas)
            .neq("estado", "ANULADO")
            .order("created_at", { ascending: true });

          for (const tk of ticketsProp || []) {
            if (!tk.propuesta_msg_id) continue;
            const arr = desglosePorPropuesta.get(tk.propuesta_msg_id) || [];
            arr.push({
              jugador: tk.aceptante_nombre || "Jugador",
              monto: Number(tk.monto_concretado || 0),
              hora: tk.created_at,
            });
            desglosePorPropuesta.set(tk.propuesta_msg_id, arr);
          }
        } catch {
          // Resiliente si la tabla no responde
        }
      }

      const mensajesEnriquecidos = mensajesFiltrados.reverse().map((m) => {
        if (m.tipo_mensaje === "propuesta_jugada" || m.tipo_mensaje === "PROPUESTA") {
          const desglose = desglosePorPropuesta.get(m.id) || [];
          const totalJugado = desglose.reduce((acc, item) => acc + Number(item.monto || 0), 0);
          return {
            ...m,
            desglose_jugaron: desglose,
            monto_jugado_total: totalJugado,
          };
        }
        return m;
      });

      return NextResponse.json({ ok: true, mensajes: mensajesEnriquecidos });
    }

    // 4. PUBLICIDAD
    if (accion === "publicidad") {
      if (!grupoId) return NextResponse.json({ ok: false, error: "grupoId es requerido" }, { status: 400 });
      const { data: publicidad } = await supabaseAdmin
        .from("publicidad_sala")
        .select("*")
        .eq("grupo_id", grupoId)
        .eq("activo", true)
        .order("fijado_en_tope", { ascending: false })
        .order("created_at", { ascending: false });

      return NextResponse.json({ ok: true, publicidad: publicidad || [] });
    }

    // 5. CLIENTE
    if (accion === "cliente") {
      const clienteId = searchParams.get("clienteId") || identidad.usuarioId;
      if (identidad.tipo === "JUGADOR" && clienteId !== identidad.usuarioId) {
        return NextResponse.json({ ok: false, error: "No autorizado para consultar otro cliente" }, { status: 403 });
      }

      const { data: cliente, error } = await supabaseAdmin
        .from("clientes")
        .select("id, nombre, seudonimo, telefono, saldo_actual, saldo_retenido, saldo_disponible, libre, modo_juego, grupo_id")
        .eq("id", clienteId)
        .maybeSingle();

      if (error || !cliente) {
        return NextResponse.json({ ok: false, error: "Cliente no encontrado" }, { status: 404 });
      }

      return NextResponse.json({
        ok: true,
        cliente: {
          ...cliente,
          saldo_disponible: calcularDisponibleCliente(cliente),
        },
      });
    }

    return NextResponse.json({ ok: false, error: "Acción GET no soportada" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "Error interno" }, { status: 500 });
  }
}

// ============================================================================
// FALLBACK DE LIQUIDACIÓN DE SALA (NETTING CONDICIONAL + LEDGER SEGURO)
// ============================================================================
async function liquidarCarreraFallback(
  grupoId: string,
  salaId: string,
  pizarra: {
    primero: string;
    segundo?: string;
    tercero?: string;
    cuarto?: string;
    quinto?: string;
    sexto?: string;
    septimo?: string;
    octavo?: string;
    ganadores?: string[];
    empates?: number[];
  },
  operadorNombre: string
) {
  // 1. Obtener sala y grupo
  const { data: sala } = await supabaseAdmin
    .from("salas_juego")
    .select("*")
    .eq("id", salaId)
    .single();

  if (!sala) throw new Error("Sala no encontrada");

  const hipodromo = sala.hipodromo_activo || "HIPÓDROMO";
  const numCarrera = sala.numero_carrera_activa || 1;
  const carreraId = sala.carrera_activa_id || sala.carrera_recien_cerrada_id;

  // Si la carrera estaba abierta y el operador manda la llegada o liquida:
  // cerramos la carrera inmediatamente para la recién cerrada
  if (sala.estado_carrera === "abierta") {
    await supabaseAdmin
      .from("salas_juego")
      .update({
        estado_carrera: "cerrada",
        carrera_recien_cerrada_id: sala.carrera_activa_id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", salaId);

    const textoCierre = construirMensajeCarreraCerrada(
      sala.hipodromo_activo || "HIPÓDROMO",
      sala.numero_carrera_activa || 1
    );

    await supabaseAdmin.from("chat_mensajes").insert({
      grupo_id: grupoId,
      sala_id: salaId,
      remitente_nombre: "Operador de Sala",
      es_operador: true,
      tipo_mensaje: "ESTADO_CARRERA",
      contenido: textoCierre,
      solo_borrable_operador: true,
    });
  }

  const { data: grupo } = await supabaseAdmin
    .from("grupos_venta")
    .select("permite_cruces, comision_default")
    .eq("id", grupoId)
    .single();

  const permiteCruces = grupo?.permite_cruces ?? true;
  const porcentajeComision = (grupo?.comision_default ?? 5) / 100;

  // Extraer lista completa de ganadores
  const ganadoresArray: string[] =
    Array.isArray(pizarra.ganadores) && pizarra.ganadores.length > 0
      ? pizarra.ganadores
      : [
          pizarra.primero,
          pizarra.segundo,
          pizarra.tercero,
          pizarra.cuarto,
          pizarra.quinto,
          pizarra.sexto,
          pizarra.septimo,
          pizarra.octavo,
        ]
          .filter((x): x is string => Boolean(x && String(x).trim()))
          .map((x) => String(x).trim());

  // Sincronizar llegada oficial a resultados_carreras y carreras de la plataforma
  const fechaHoy = new Date().toISOString().split("T")[0];
  try {
    const { data: resExistente } = await supabaseAdmin
      .from("resultados_carreras")
      .select("id")
      .eq("fecha", fechaHoy)
      .ilike("hipodromo", `%${hipodromo.trim()}%`)
      .eq("carrera", numCarrera)
      .maybeSingle();

    const payloadResultados = {
      fecha: fechaHoy,
      hipodromo: hipodromo.trim().toUpperCase(),
      carrera: numCarrera,
      ganadores: ganadoresArray,
      orden_llegada: ganadoresArray.map((n, idx) => ({ numero: n, puesto: idx + 1 })),
      cargado_por: operadorNombre || "OPERADOR-SALA",
      updated_at: new Date().toISOString(),
    };

    if (resExistente?.id) {
      await supabaseAdmin.from("resultados_carreras").update(payloadResultados).eq("id", resExistente.id);
    } else {
      await supabaseAdmin.from("resultados_carreras").insert(payloadResultados);
    }

    // Actualizar estado en carreras de la plataforma
    await supabaseAdmin
      .from("carreras")
      .update({
        estado: "Finalizada",
        pizarra_oficial: ganadoresArray,
        updated_at: new Date().toISOString(),
      })
      .eq("fecha", fechaHoy)
      .ilike("hipodromo", `%${hipodromo.trim()}%`)
      .eq("carrera", numCarrera);
  } catch (errRes) {
    console.error("Error sincronizando resultado a resultados_carreras:", errRes);
  }

  // 2. Obtener tickets pendientes de esta sala/carrera
  let queryTickets = supabaseAdmin
    .from("chat_tickets_fifo")
    .select("*")
    .eq("grupo_id", grupoId)
    .eq("sala_id", salaId)
    .in("estado", ["PENDIENTE", "ACTIVO", "ABIERTO"]);

  if (carreraId) {
    queryTickets = queryTickets.or(`carrera_id.eq.${carreraId},carrera_id.is.null`);
  }

  const { data: tickets, error: errTickets } = await queryTickets;
  if (errTickets) throw new Error("Error leyendo tickets: " + errTickets.message);

  const balancePorJugador: Record<
    string,
    {
      nombre: string;
      gananciasBrutas: number;
      perdidasBrutas: number;
      comisionIndividual: number;
      stakeTotal: number;
      ticketsCount: number;
    }
  > = {};

  const registrarJugador = (id: string, nombre: string) => {
    if (!balancePorJugador[id]) {
      balancePorJugador[id] = {
        nombre: nombre || "Jugador",
        gananciasBrutas: 0,
        perdidasBrutas: 0,
        comisionIndividual: 0,
        stakeTotal: 0,
        ticketsCount: 0,
      };
    }
  };

  // 3. Evaluar cada ticket con evaluar_jugada_universal
  for (const t of tickets || []) {
    registrarJugador(t.proponente_id, t.proponente_nombre);
    registrarJugador(t.aceptante_id, t.aceptante_nombre);

    balancePorJugador[t.proponente_id].ticketsCount++;
    balancePorJugador[t.aceptante_id].ticketsCount++;
    balancePorJugador[t.proponente_id].stakeTotal += Number(t.monto_concretado);
    balancePorJugador[t.aceptante_id].stakeTotal += Number(t.monto_concretado);

    const { data: evalRes, error: evalErr } = await supabaseAdmin.rpc("evaluar_jugada_universal", {
      p_es_match: Boolean(t.es_match),
      p_accion_proponente: t.accion_proponente || "JUEGA",
      p_modalidad: t.modalidad || "1P",
      p_caballos_a: t.caballos_bando_a || (t.ejemplar_numero ? [t.ejemplar_numero] : []),
      p_caballos_b: t.caballos_bando_b || [],
      p_p1: ganadoresArray[0] || pizarra.primero,
      p_p2: ganadoresArray[1] || pizarra.segundo || null,
      p_p3: ganadoresArray[2] || pizarra.tercero || null,
      p_p4: ganadoresArray[3] || pizarra.cuarto || null,
      p_p5: ganadoresArray[4] || pizarra.quinto || null,
    });

    const factor = evalErr ? 0 : Number(evalRes);
    const monto = Number(t.monto_concretado);

    let nuevoEstadoTicket = "EMPATE";
    if (factor > 0) {
      // Proponente gana
      nuevoEstadoTicket = "GANADOR_PROPONENTE";
      balancePorJugador[t.proponente_id].gananciasBrutas += monto;
      balancePorJugador[t.aceptante_id].perdidasBrutas += monto;
      balancePorJugador[t.proponente_id].comisionIndividual += monto * porcentajeComision;
    } else if (factor < 0) {
      // Aceptante gana
      nuevoEstadoTicket = "GANADOR_ACEPTANTE";
      balancePorJugador[t.aceptante_id].gananciasBrutas += monto;
      balancePorJugador[t.proponente_id].perdidasBrutas += monto;
      balancePorJugador[t.aceptante_id].comisionIndividual += monto * porcentajeComision;
    }

    await supabaseAdmin
      .from("chat_tickets_fifo")
      .update({ estado: nuevoEstadoTicket })
      .eq("id", t.id);

    await actualizarTicketEspejoLiquidado(supabaseAdmin, {
      codigoTicket: t.codigo_ticket,
      accionProponente: t.accion_proponente,
      factor,
      monto,
      porcentajeComision,
    });
  }

  // 4. Liquidar y asentar saldos
  const reportePositivos: string[] = [];
  const reporteNegativos: string[] = [];

  for (const [jugadorId, b] of Object.entries(balancePorJugador)) {
    let balanceNetoFinal = 0;

    if (permiteCruces) {
      // Netting Bruto: Comisión solo sobre el balance neto positivo
      const balanceBruto = b.gananciasBrutas - b.perdidasBrutas;
      if (balanceBruto > 0) {
        const comision = balanceBruto * porcentajeComision;
        balanceNetoFinal = balanceBruto - comision;
      } else {
        balanceNetoFinal = balanceBruto;
      }
    } else {
      // Sin cruces: Comisión deducida por jugada individual ganadora
      balanceNetoFinal = b.gananciasBrutas - b.comisionIndividual - b.perdidasBrutas;
    }

    balanceNetoFinal = Number(balanceNetoFinal.toFixed(2));

    // Obtener cliente para actualizar
    const { data: cl } = await supabaseAdmin
      .from("clientes")
      .select("saldo_actual, saldo_retenido, libre")
      .eq("id", jugadorId)
      .maybeSingle();

    if (cl) {
      const nuevoSaldo = Number(((cl.saldo_actual || 0) + balanceNetoFinal).toFixed(2));
      const nuevoRetenido = Math.max(0, Number(((cl.saldo_retenido || 0) - b.stakeTotal).toFixed(2)));

      await supabaseAdmin
        .from("clientes")
        .update({
          saldo_actual: nuevoSaldo,
          saldo_retenido: nuevoRetenido,
          saldo_disponible: cl.libre ? 999999 : Math.max(0, nuevoSaldo - nuevoRetenido),
        })
        .eq("id", jugadorId);

      // Asiento en libro_mayor_clientes respetando el CHECK de tipos permitidos
      if (balanceNetoFinal > 0) {
        await supabaseAdmin.from("libro_mayor_clientes").insert({
          cliente_id: jugadorId,
          cliente_nombre: b.nombre,
          grupo_id: grupoId,
          tipo_movimiento: "JUGADA_GANADA_NETO",
          monto_centavos: Math.round(balanceNetoFinal * 100),
          monto: balanceNetoFinal,
          hipodromo,
          carrera: numCarrera,
          fecha_carrera: fechaHoy,
          observacion: `Liquidación Sala ${sala.nombre_sala} (${permiteCruces ? "Netting con Cruces" : "Individual"})`,
          creado_por: operadorNombre,
        });
        reportePositivos.push(`🟢 ${b.nombre}: +$${balanceNetoFinal.toFixed(2)}`);
      } else if (balanceNetoFinal < 0) {
        const montoAbs = Math.abs(balanceNetoFinal);
        await supabaseAdmin.from("libro_mayor_clientes").insert({
          cliente_id: jugadorId,
          cliente_nombre: b.nombre,
          grupo_id: grupoId,
          tipo_movimiento: "JUGADA_PERDIDA",
          monto_centavos: Math.round(montoAbs * 100),
          monto: montoAbs,
          hipodromo,
          carrera: numCarrera,
          fecha_carrera: fechaHoy,
          observacion: `Liquidación Sala ${sala.nombre_sala} (${permiteCruces ? "Netting con Cruces" : "Individual"})`,
          creado_por: operadorNombre,
        });
        reporteNegativos.push(`🔴 ${b.nombre}: -$${montoAbs.toFixed(2)}`);
      }
    }
  }

  // 5. Actualizar estado de la sala y grupo
  await supabaseAdmin
    .from("salas_juego")
    .update({
      estado_carrera: "liquidada",
      carrera_recien_cerrada_id: carreraId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", salaId);

  await sincronizarEstadoGrupo(grupoId);

  // 6. Construir mensaje de reporte y pregunta al operador
  const empatesSet = new Set(pizarra.empates || []);
  const pizarraTexto = ganadoresArray
    .map((num, idx) => `${idx + 1}º: #${num}${empatesSet.has(idx + 1) ? " (Empate)" : ""}`)
    .join(" | ") || `1º: #${pizarra.primero}`;

  const mensajeReporte =
    `🏁 *RESULTADOS OFICIALES ${hipodromo.toUpperCase()} - C${numCarrera}*\n` +
    `Pizarra: ${pizarraTexto}\n\n` +
    `💬 *Relación de resultados — ${hipodromo.toUpperCase()} C${numCarrera}*\n` +
    (reportePositivos.length > 0 ? `${reportePositivos.join("\n")}\n` : "") +
    (reporteNegativos.length > 0 ? `${reporteNegativos.join("\n")}\n` : "") +
    (reportePositivos.length === 0 && reporteNegativos.length === 0 ? "Sin movimientos en esta carrera.\n" : "") +
    `\n👉 ¿Cuál es la próxima carrera a abrir?`;

  await supabaseAdmin.from("chat_mensajes").insert({
    grupo_id: grupoId,
    sala_id: salaId,
    remitente_nombre: "Operador de Sala",
    es_operador: true,
    tipo_mensaje: "PIZARRA",
    contenido: mensajeReporte,
    solo_borrable_operador: true,
  });

  await emitirBroadcast(salaId, "carrera_liquidada", { salaId, mensajeReporte });

  return {
    ok: true,
    mensajeReporte,
    preguntaOperador: "👉 ¿Cuál es la próxima carrera a abrir?",
    positivos: reportePositivos,
    negativos: reporteNegativos,
  };
}

/**
 * Reversa la liquidación de una carrera: revierte balances ganados/perdidos y restablece tickets y saldos.
 */
async function reversarCarrera(grupoId: string, salaId: string, operadorNombre: string) {
  const { data: sala } = await supabaseAdmin
    .from("salas_juego")
    .select("*")
    .eq("id", salaId)
    .single();

  if (!sala) throw new Error("Sala no encontrada");

  const hipodromo = sala.hipodromo_activo || "HIPÓDROMO";
  const numCarrera = sala.numero_carrera_activa || 1;
  const carreraId = sala.carrera_recien_cerrada_id || sala.carrera_activa_id;

  // 1. Obtener tickets liquidados de esta carrera
  let queryTickets = supabaseAdmin
    .from("chat_tickets_fifo")
    .select("*")
    .eq("grupo_id", grupoId)
    .eq("sala_id", salaId)
    .in("estado", ["GANADOR_PROPONENTE", "GANADOR_ACEPTANTE", "EMPATE"]);

  if (carreraId) {
    queryTickets = queryTickets.or(`carrera_id.eq.${carreraId},carrera_id.is.null`);
  }

  const { data: tickets, error: errTickets } = await queryTickets;
  if (errTickets) throw new Error("Error leyendo tickets: " + errTickets.message);

  // 2. Obtener movimientos de liquidación generados en libro_mayor_clientes
  const { data: movimientos } = await supabaseAdmin
    .from("libro_mayor_clientes")
    .select("*")
    .eq("grupo_id", grupoId)
    .eq("hipodromo", hipodromo)
    .eq("carrera", numCarrera)
    .in("tipo_movimiento", ["JUGADA_GANADA_NETO", "JUGADA_PERDIDA"]);

  // Revertir en clientes
  for (const mov of movimientos || []) {
    const { data: cl } = await supabaseAdmin
      .from("clientes")
      .select("saldo_actual, saldo_retenido, libre, aval")
      .eq("id", mov.cliente_id)
      .single();

    if (cl) {
      let ajusteSaldo = 0;
      if (mov.tipo_movimiento === "JUGADA_GANADA_NETO") {
        ajusteSaldo = -Number(mov.monto || 0);
      } else if (mov.tipo_movimiento === "JUGADA_PERDIDA") {
        ajusteSaldo = Number(mov.monto || 0);
      }

      const nuevoSaldo = Number(((cl.saldo_actual || 0) + ajusteSaldo).toFixed(2));
      await supabaseAdmin
        .from("clientes")
        .update({
          saldo_actual: nuevoSaldo,
          saldo_disponible: cl.libre ? 999999 : Math.max(0, Number((nuevoSaldo + (cl.aval || 0) - Number(cl.saldo_retenido || 0)).toFixed(2))),
        })
        .eq("id", mov.cliente_id);

      await supabaseAdmin.from("libro_mayor_clientes").insert({
        cliente_id: mov.cliente_id,
        cliente_nombre: mov.cliente_nombre,
        grupo_id: grupoId,
        tipo_movimiento: "ANULACION_RESTITUCION",
        monto_centavos: Math.round(Math.abs(ajusteSaldo) * 100),
        monto: Math.abs(ajusteSaldo),
        hipodromo,
        carrera: numCarrera,
        fecha_carrera: new Date().toISOString().split("T")[0],
        observacion: `Reversión de Liquidación Carrera ${hipodromo} C${numCarrera}`,
        creado_por: operadorNombre,
      });
    }
  }

  // 3. Restablecer estado de los tickets a ACTIVO y re-retener
  await revertirTicketsEspejoSala(
    supabaseAdmin,
    (tickets || []).map((t) => String(t.codigo_ticket || "")).filter(Boolean)
  );
  for (const t of tickets || []) {
    await supabaseAdmin
      .from("chat_tickets_fifo")
      .update({ estado: "ACTIVO" })
      .eq("id", t.id);

    for (const jId of [t.proponente_id, t.aceptante_id]) {
      const { data: cl } = await supabaseAdmin
        .from("clientes")
        .select("saldo_retenido, libre, saldo_actual, aval")
        .eq("id", jId)
        .single();
      if (cl && !cl.libre) {
        const ret = Number(((cl.saldo_retenido || 0) + Number(t.monto_concretado || 0)).toFixed(2));
        await supabaseAdmin
          .from("clientes")
          .update({
            saldo_retenido: ret,
            saldo_disponible: Math.max(0, Number(((cl.saldo_actual || 0) + (cl.aval || 0) - ret).toFixed(2))),
          })
          .eq("id", jId);
      }
    }
  }

  // 3b. Eliminar pizarra de resultados_carreras y volver carreras a "Programada"
  try {
    await supabaseAdmin
      .from("resultados_carreras")
      .delete()
      .ilike("hipodromo", `%${hipodromo.replace(/\s+/g, "%")}%`)
      .eq("carrera", numCarrera);
    await supabaseAdmin
      .from("carreras")
      .update({ estado: "Programada" })
      .ilike("hipodromo", `%${hipodromo.replace(/\s+/g, "%")}%`)
      .eq("carrera", numCarrera);
  } catch {
    /* best-effort */
  }

  // 4. Actualizar estado de sala a abierta (sin pizarra ni liquidación)
  await supabaseAdmin
    .from("salas_juego")
    .update({
      estado_carrera: "abierta",
      updated_at: new Date().toISOString(),
    })
    .eq("id", salaId);

  await sincronizarEstadoGrupo(grupoId);

  const textoAviso = `🔄 *LIQUIDACIÓN REVERSADA*\nEl operador ha reversado la liquidación de la carrera ${hipodromo} C${numCarrera} y eliminado la pizarra colocada. Se han restituido los saldos y tickets al estado previo a la liquidación.`;
  await supabaseAdmin.from("chat_mensajes").insert({
    grupo_id: grupoId,
    sala_id: salaId,
    remitente_nombre: "Operador de Sala",
    es_operador: true,
    tipo_mensaje: "ESTADO_CARRERA",
    contenido: textoAviso,
    solo_borrable_operador: true,
  });

  await emitirBroadcast(salaId, "carrera_reversada", { salaId, carreraId });

  return { ok: true, mensaje: textoAviso };
}

/**
 * Anula una carrera: devuelve el 100% del dinero comprometido a todos (reembolso total y anulación de tickets).
 */
async function anularCarrera(grupoId: string, salaId: string, operadorNombre: string) {
  const { data: sala } = await supabaseAdmin
    .from("salas_juego")
    .select("*")
    .eq("id", salaId)
    .single();

  if (!sala) throw new Error("Sala no encontrada");

  const hipodromo = sala.hipodromo_activo || "HIPÓDROMO";
  const numCarrera = sala.numero_carrera_activa || 1;
  const carreraId = sala.carrera_activa_id || sala.carrera_recien_cerrada_id;

  // 1. Obtener todos los tickets de esta carrera en chat_tickets_fifo
  let queryTickets = supabaseAdmin
    .from("chat_tickets_fifo")
    .select("*")
    .eq("grupo_id", grupoId)
    .eq("sala_id", salaId)
    .neq("estado", "ANULADO");

  if (carreraId) {
    queryTickets = queryTickets.or(`carrera_id.eq.${carreraId},carrera_id.is.null`);
  }

  const { data: tickets } = await queryTickets;

  // 2. Por cada ticket, anular y liberar saldo retenido a proponente y aceptante
  await anularTicketsEspejoSala(
    supabaseAdmin,
    (tickets || []).map((t) => String(t.codigo_ticket || "")).filter(Boolean)
  );
  for (const t of tickets || []) {
    await supabaseAdmin
      .from("chat_tickets_fifo")
      .update({ estado: "ANULADO" })
      .eq("id", t.id);

    const monto = Number(t.monto_concretado || 0);

    for (const [jId, jNombre] of [
      [t.proponente_id, t.proponente_nombre],
      [t.aceptante_id, t.aceptante_nombre],
    ]) {
      const { data: cl } = await supabaseAdmin
        .from("clientes")
        .select("saldo_retenido, saldo_actual, libre, aval")
        .eq("id", jId)
        .single();

      if (cl) {
        const nuevoRet = Math.max(0, Number(((cl.saldo_retenido || 0) - monto).toFixed(2)));
        await supabaseAdmin
          .from("clientes")
          .update({
            saldo_retenido: nuevoRet,
            saldo_disponible: cl.libre ? 999999 : Math.max(0, Number(((cl.saldo_actual || 0) + (cl.aval || 0) - nuevoRet).toFixed(2))),
          })
          .eq("id", jId);

        await supabaseAdmin.from("libro_mayor_clientes").insert({
          cliente_id: jId,
          cliente_nombre: jNombre,
          grupo_id: grupoId,
          tipo_movimiento: "ANULACION_RESTITUCION",
          monto_centavos: Math.round(monto * 100),
          monto,
          hipodromo,
          carrera: numCarrera,
          fecha_carrera: new Date().toISOString().split("T")[0],
          observacion: `Reembolso 100% por anulación de carrera ${hipodromo} C${numCarrera} (Ticket #${t.codigo_ticket})`,
          creado_por: operadorNombre,
        });
      }
    }
  }

  // 3. Cerrar y liberar todas las propuestas abiertas de esta carrera
  const { data: propuestasAbiertas } = await supabaseAdmin
    .from("chat_mensajes")
    .select("*")
    .eq("sala_id", salaId)
    .in("estado_propuesta", ["abierta", "parcial"]);

  for (const p of propuestasAbiertas || []) {
    const rem = Number(p.monto_disponible || 0);
    if (rem > 0 && p.remitente_id) {
      const { data: cl } = await supabaseAdmin
        .from("clientes")
        .select("saldo_retenido, saldo_actual, libre, aval")
        .eq("id", p.remitente_id)
        .single();
      if (cl && !cl.libre) {
        const nuevoRet = Math.max(0, Number(((cl.saldo_retenido || 0) - rem).toFixed(2)));
        await supabaseAdmin
          .from("clientes")
          .update({
            saldo_retenido: nuevoRet,
            saldo_disponible: Math.max(0, Number(((cl.saldo_actual || 0) + (cl.aval || 0) - nuevoRet).toFixed(2))),
          })
          .eq("id", p.remitente_id);
      }
    }
    await supabaseAdmin
      .from("chat_mensajes")
      .update({ estado_propuesta: "anulada", monto_disponible: 0 })
      .eq("id", p.id);
  }

  // 4. Actualizar sala a cerrada
  await supabaseAdmin
    .from("salas_juego")
    .update({
      estado_carrera: "cerrada",
      updated_at: new Date().toISOString(),
    })
    .eq("id", salaId);

  await sincronizarEstadoGrupo(grupoId);

  const textoAviso = `🚫 *CARRERA ANULADA*\nSe ha cancelado y anulado la carrera ${hipodromo} C${numCarrera}. Se ha reembolsado y restituido el 100% de los fondos y jugadas comprometidas a todos los participantes.`;

  await supabaseAdmin.from("chat_mensajes").insert({
    grupo_id: grupoId,
    sala_id: salaId,
    remitente_nombre: "Operador de Sala",
    es_operador: true,
    tipo_mensaje: "ESTADO_CARRERA",
    contenido: textoAviso,
    solo_borrable_operador: true,
  });

  await emitirBroadcast(salaId, "carrera_anulada", { salaId, carreraId });

  return { ok: true, mensaje: textoAviso };
}

// ============================================================================
// POST: Mensaje, Revisión LLM, Recarga Blindada, Operador, Sala
// ============================================================================
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const accion = body.accion || body.action;

  // Emisión de sesión de staff: es el único endpoint público de escritura.
  // Valida las credenciales reales contra `club_login_operador` y devuelve un
  // token HMAC que el navegador no puede fabricar.
  if (accion === "sesion-staff") {
    const reenviada = req.headers.get("x-forwarded-for") || "";
    const ip = reenviada.split(",")[0].trim() || req.headers.get("x-real-ip") || "127.0.0.1";
    const sesion = await iniciarSesionOperadorSala(
      String(body.identificador || body.usuario || ""),
      String(body.clave || body.password || ""),
      ip
    );
    if (!sesion.ok) {
      return NextResponse.json({ ok: false, error: sesion.error }, { status: sesion.status });
    }
    return NextResponse.json({
      ok: true,
      token: sesion.token,
      usuario: sesion.usuario,
    });
  }

  const auth = await autenticarPeticionSala(req);
  if (!auth.ok || !auth.identidad) {
    return NextResponse.json({ ok: false, error: auth.error || "No autorizado" }, { status: auth.status || 401 });
  }

  const identidad = auth.identidad;

  try {
    // ------------------------------------------------------------------------
    // 1. MENSAJE / PROPUESTA / ACEPTACIÓN
    // ------------------------------------------------------------------------
    if (accion === "mensaje") {
      const { salaId, texto, propuestaId, destinatarioPrivadoId, replyToMsgId, imagenUrl } = body;
      const grupoId = resolverGrupoEfectivo(identidad, body.grupoId);

      if (!salaId || !grupoId) {
        return NextResponse.json({ ok: false, error: "salaId y grupoId son requeridos" }, { status: 400 });
      }

      if (!grupoPermitido(identidad, grupoId)) {
        return NextResponse.json({ ok: false, error: "Aislamiento: Grupo no autorizado" }, { status: 403 });
      }

      // Validar sala
      const { data: sala } = await supabaseAdmin
        .from("salas_juego")
        .select("*")
        .eq("id", salaId)
        .eq("grupo_id", grupoId)
        .single();

      if (!sala) {
        return NextResponse.json({ ok: false, error: "Sala no encontrada en el grupo" }, { status: 404 });
      }

      // CASO A: Aceptación de propuesta existente (FIFO)
      if (propuestaId) {
        if (identidad.tipo !== "JUGADOR") {
          return NextResponse.json({ ok: false, error: "Solo los jugadores pueden aceptar propuestas" }, { status: 403 });
        }

        const { data: propMsg } = await supabaseAdmin
          .from("chat_mensajes")
          .select("*")
          .eq("id", propuestaId)
          .single();

        if (!propMsg) {
          return NextResponse.json({ ok: false, error: "Propuesta no encontrada" }, { status: 404 });
        }

        if (propMsg.remitente_id === identidad.usuarioId) {
          return NextResponse.json({ ok: false, error: "No puedes aceptar tu propia propuesta" }, { status: 400 });
        }

        if (sala.estado_carrera !== "abierta") {
          return NextResponse.json({ ok: false, error: "La carrera está cerrada para nuevas jugadas" }, { status: 400 });
        }

        // 1. Control estricto de vigencia de la jugada (tiempo configurable, default 120s)
        const tiempoVigencia = Number(sala.tiempo_vigencia_segundos || 120);
        const edadSegundos = (Date.now() - new Date(propMsg.created_at).getTime()) / 1000;
        const remanenteDisponible = Number(propMsg.monto_disponible ?? propMsg.monto_original ?? 0);

        // Una propuesta con tomas parciales queda en estado "parcial" y debe
        // seguir aceptando el remanente (cascada 100 -> 10 + 90) hasta que la
        // vigencia expire o el saldo llegue a cero.
        const estadoAceptaTomas =
          propMsg.estado_propuesta === "abierta" || propMsg.estado_propuesta === "parcial";

        if (edadSegundos > tiempoVigencia || !estadoAceptaTomas || remanenteDisponible <= 0) {
          if (estadoAceptaTomas) {
            await supabaseAdmin
              .from("chat_mensajes")
              .update({ estado_propuesta: "cerrada", monto_disponible: 0 })
              .eq("id", propuestaId);
          }
          return NextResponse.json({
            ok: false,
            error: "Jugada no concreta por estar vencida.",
          }, { status: 400 });
        }

        // 2. Control dinámico de saldo concurrente del proponente
        const { data: proponente } = await supabaseAdmin
          .from("clientes")
          .select("id, nombre, saldo_actual, saldo_retenido, libre, aval")
          .eq("id", propMsg.remitente_id)
          .single();

        const saldoDispProponente = calcularDisponibleCliente(proponente);
        if (!proponente?.libre && saldoDispProponente <= 0) {
          await supabaseAdmin
            .from("chat_mensajes")
            .update({ estado_propuesta: "cerrada", monto_disponible: 0 })
            .eq("id", propuestaId);

          return NextResponse.json({
            ok: false,
            error: "Jugada no concreta por falta de saldo disponible.",
          }, { status: 400 });
        }

        // 3. Obtener saldo disponible del aceptante
        const { data: aceptante } = await supabaseAdmin
          .from("clientes")
          .select("id, nombre, saldo_actual, saldo_retenido, libre, aval")
          .eq("id", identidad.usuarioId)
          .single();

        const saldoDispAceptante = calcularDisponibleCliente(aceptante);

        // Consultar moneda del grupo para formato y mensajes
        const { data: gMoneda } = await supabaseAdmin
          .from("grupos_venta")
          .select("moneda")
          .eq("id", grupoId)
          .maybeSingle();
        const prefijo = prefijoMonedaGrupo(gMoneda?.moneda);

        // Extraer monto solicitado de body.monto o del texto de respuesta (ej. "Juego 20", "Consigo 5k", "Ponte 10.000")
        let montoPedido = body.monto ? Number(body.monto) : remanenteDisponible;
        if (texto && typeof texto === "string") {
          const matchNum = texto.match(/([0-9kK\.,]+)/);
          if (matchNum) {
            const parsedK = parsearMontoConK(matchNum[1]);
            if (parsedK && parsedK.monto > 0) {
              montoPedido = parsedK.monto;
            } else {
              const val = parseFloat(matchNum[1].replace(",", "."));
              if (val > 0) montoPedido = val;
            }
          }
        }

        if (!montoPedido || isNaN(montoPedido) || montoPedido <= 0) {
          montoPedido = remanenteDisponible;
        }

        let excedioSaldoAceptante = false;
        if (!aceptante?.libre && montoPedido > saldoDispAceptante) {
          if (saldoDispAceptante <= 0) {
            return NextResponse.json({
              ok: false,
              error: `Saldo insuficiente (${prefijo}0.00) para tomar esta jugada.`,
            }, { status: 400 });
          }
          excedioSaldoAceptante = true;
          montoPedido = Math.min(montoPedido, saldoDispAceptante);
        }

        // Topar también al saldo disponible del proponente si no es libre
        if (!proponente?.libre && montoPedido > saldoDispProponente) {
          montoPedido = Math.min(montoPedido, saldoDispProponente);
        }

        montoPedido = Math.min(montoPedido, remanenteDisponible);

        let resFifo: any = null;
        let fifoExitoso = false;

        // Intentar primero RPC concretar_jugada_fifo_atomica
        if (
          esUuidValido(grupoId) &&
          esUuidValido(salaId) &&
          esUuidValido(propuestaId) &&
          esUuidValido(identidad.usuarioId)
        ) {
          try {
            const { data: resAtomico, error: errAtomico } = await supabaseAdmin.rpc("concretar_jugada_fifo_atomica", {
              p_grupo_id: grupoId,
              p_sala_id: salaId,
              p_propuesta_msg_id: propuestaId,
              p_aceptante_id: identidad.usuarioId,
              p_monto_pedido: montoPedido,
            });
            if (!errAtomico && resAtomico && (resAtomico as any).ok !== false) {
              resFifo = resAtomico;
              fifoExitoso = true;
            }
          } catch {
            // Continúa a fallback
          }
        }

        // Si no se concretó atómicamente, intentar procesar_respuesta_jugada_fifo
        if (!fifoExitoso && esUuidValido(grupoId) && esUuidValido(propuestaId) && esUuidValido(identidad.usuarioId)) {
          try {
            const { data: resResp, error: errResp } = await supabaseAdmin.rpc("procesar_respuesta_jugada_fifo", {
              p_grupo_id: grupoId,
              p_propuesta_msg_id: propuestaId,
              p_aceptante_id: identidad.usuarioId,
              p_aceptante_nombre: identidad.nombre,
              p_texto_respuesta: texto || "Acepto",
              p_saldo_disponible_aceptante: saldoDispAceptante,
            });

            if (!errResp && resResp && (resResp as any).ok !== false) {
              resFifo = resResp;
              fifoExitoso = true;
            }
          } catch {
            // Continúa a fallback
          }
        }

        // Fallback directo transaccional garantizado si los RPC fallaron por desincronización de estado
        if (!fifoExitoso) {
          const montoConcretado = Math.min(montoPedido, remanenteDisponible);
          const nuevoRemanente = Math.max(0, Number((remanenteDisponible - montoConcretado).toFixed(2)));

          if (!aceptante?.libre) {
            const retAceptante = Number((Number(aceptante?.saldo_retenido || 0) + montoConcretado).toFixed(2));
            await supabaseAdmin
              .from("clientes")
              .update({ saldo_retenido: retAceptante })
              .eq("id", identidad.usuarioId);
          }

          // Actualizar remanente y estado de la propuesta
          await supabaseAdmin
            .from("chat_mensajes")
            .update({
              monto_disponible: nuevoRemanente,
              estado_propuesta: nuevoRemanente <= 0 ? "cerrada" : "abierta",
            })
            .eq("id", propuestaId);

          const codigoTicket = `TKT-${Date.now().toString().slice(-6)}`;
          const rawFirma = `${codigoTicket}:${propMsg.remitente_id}:${identidad.usuarioId}:${montoConcretado}:${new Date().toISOString()}`;
          const firma = crypto.createHash("sha256").update(rawFirma).digest("hex");

          await supabaseAdmin.from("chat_tickets_fifo").insert({
            grupo_id: grupoId,
            sala_id: salaId,
            propuesta_msg_id: propuestaId,
            codigo_ticket: codigoTicket,
            proponente_id: propMsg.remitente_id,
            proponente_nombre: propMsg.remitente_nombre,
            aceptante_id: identidad.usuarioId,
            aceptante_nombre: identidad.nombre,
            carrera_id: propMsg.carrera_id || sala.carrera_activa_id,
            modalidad: propMsg.modalidad_jugada || "1P",
            ejemplar_numero: propMsg.ejemplar_numero || (propMsg.caballos_bando_a?.[0] ?? "1"),
            caballos_bando_a: propMsg.caballos_bando_a || [],
            caballos_bando_b: propMsg.caballos_bando_b || [],
            monto_concretado: montoConcretado,
            estado: "ABIERTO",
            firma_sha256: firma,
          });

          await sincronizarTicketsPropuestaATaquilla(supabaseAdmin, {
            propuestaMsgId: propuestaId,
            sala,
            grupoId,
            condicionProponente: propMsg.condicion_proponente,
          });

          // Consultar todos los tickets de esta propuesta para armar el desglose acumulado ("Eddie jugó 43,50")
          const { data: ticketsAcumulados } = await supabaseAdmin
            .from("chat_tickets_fifo")
            .select("aceptante_nombre, monto_concretado")
            .eq("propuesta_msg_id", propuestaId)
            .neq("estado", "ANULADO")
            .order("created_at", { ascending: true });

          const listaDesglose =
            ticketsAcumulados && ticketsAcumulados.length > 0
              ? ticketsAcumulados.map((tk) => ({
                  jugador: tk.aceptante_nombre || identidad.nombre,
                  monto: Number(tk.monto_concretado || 0),
                }))
              : [{ jugador: identidad.nombre, monto: montoConcretado }];

          const totalVanJugando = listaDesglose.reduce((acc, d) => acc + d.monto, 0);
          const lineasDesglose = listaDesglose
            .map((d) => `• ${d.jugador} jugó ${formatearMontoRegional(d.monto)}`)
            .join("\n");

          const textoVanJugando =
            `🤝 *Van jugando por ${formatearMontoRegional(totalVanJugando)}* (${propMsg.jugada_estandarizada || propMsg.contenido})\n` +
            `${lineasDesglose}` +
            (nuevoRemanente > 0 ? `\nDisponible: ${formatearMontoRegional(nuevoRemanente)}` : "");

          // Insertar mensaje de concreción en chat_mensajes ("Van jugando por X" + desglose)
          await supabaseAdmin.from("chat_mensajes").insert({
            grupo_id: grupoId,
            sala_id: salaId,
            remitente_id: identidad.usuarioId,
            remitente_nombre: identidad.nombre,
            es_operador: false,
            tipo_mensaje: "CONCRECION",
            contenido: textoVanJugando,
            reply_to_msg_id: propuestaId,
            carrera_id: propMsg.carrera_id || sala.carrera_activa_id,
          });

          resFifo = {
            ok: true,
            cruceConcretado: true,
            monto: montoConcretado,
            totalVanJugando,
            desglose: listaDesglose,
          };
        } else {
          // Firmar ticket server-side y asociar sala_id
          const { data: ticketsCreados } = await supabaseAdmin
            .from("chat_tickets_fifo")
            .select("*")
            .eq("propuesta_msg_id", propuestaId)
            .is("firma_sha256", null);

          for (const t of ticketsCreados || []) {
            const rawFirma = `${t.codigo_ticket}:${t.proponente_id}:${t.aceptante_id}:${t.monto_concretado}:${t.created_at}`;
            const firma = crypto.createHash("sha256").update(rawFirma).digest("hex");
            await supabaseAdmin
              .from("chat_tickets_fifo")
              .update({ firma_sha256: firma, sala_id: salaId })
              .eq("id", t.id);
          }

          await sincronizarTicketsPropuestaATaquilla(supabaseAdmin, {
            propuestaMsgId: propuestaId,
            sala,
            grupoId,
            condicionProponente: propMsg.condicion_proponente,
          });

          // Consultar todos los tickets de la propuesta para mostrar "Van jugando por X" y el desglose ("Eddie jugó 43,50")
          const { data: ticketsAcumulados } = await supabaseAdmin
            .from("chat_tickets_fifo")
            .select("aceptante_nombre, monto_concretado")
            .eq("propuesta_msg_id", propuestaId)
            .neq("estado", "ANULADO")
            .order("created_at", { ascending: true });

          const { data: propActualizada } = await supabaseAdmin
            .from("chat_mensajes")
            .select("monto_disponible, jugada_estandarizada, contenido")
            .eq("id", propuestaId)
            .maybeSingle();

          const listaDesglose =
            ticketsAcumulados && ticketsAcumulados.length > 0
              ? ticketsAcumulados.map((tk) => ({
                  jugador: tk.aceptante_nombre || identidad.nombre,
                  monto: Number(tk.monto_concretado || 0),
                }))
              : [{ jugador: identidad.nombre, monto: montoPedido }];

          const totalVanJugando = listaDesglose.reduce((acc, d) => acc + d.monto, 0);
          const remRestante = Number(propActualizada?.monto_disponible ?? 0);
          const lineasDesglose = listaDesglose
            .map((d) => `• ${d.jugador} jugó ${formatearMontoRegional(d.monto)}`)
            .join("\n");

          const textoVanJugando =
            `🤝 *Van jugando por ${formatearMontoRegional(totalVanJugando)}* (${propActualizada?.jugada_estandarizada || propActualizada?.contenido || propMsg.contenido})\n` +
            `${lineasDesglose}` +
            (remRestante > 0 ? `\nDisponible: ${formatearMontoRegional(remRestante)}` : "");

          // Actualizar cualquier mensaje derivado en chat_mensajes con el formato "Van jugando por X" + desglose
          const { data: msgsDerivados } = await supabaseAdmin
            .from("chat_mensajes")
            .select("id, contenido")
            .eq("reply_to_msg_id", propuestaId)
            .order("created_at", { ascending: false })
            .limit(1);

          if (msgsDerivados && msgsDerivados.length > 0) {
            await supabaseAdmin
              .from("chat_mensajes")
              .update({ sala_id: salaId, tipo_mensaje: "CONCRECION", contenido: textoVanJugando })
              .eq("id", msgsDerivados[0].id);
          } else {
            await supabaseAdmin.from("chat_mensajes").insert({
              grupo_id: grupoId,
              sala_id: salaId,
              remitente_id: identidad.usuarioId,
              remitente_nombre: identidad.nombre,
              es_operador: false,
              tipo_mensaje: "CONCRECION",
              contenido: textoVanJugando,
              reply_to_msg_id: propuestaId,
              carrera_id: propMsg.carrera_id || sala.carrera_activa_id,
            });
          }
        }

        // Aviso público + privado cuando el aceptante intentó tomar más de su
        // saldo disponible. El remanente queda abierto para la cascada
        // (ej. propuesta de 100 -> 90 el primero y 10 el segundo).
        if (excedioSaldoAceptante) {
          const montoConcretadoAviso = Number((resFifo as any)?.monto ?? (resFifo as any)?.monto_concretado ?? montoPedido);
          const disponibleAviso = Number((resFifo as any)?.saldo_disponible_aceptante ?? saldoDispAceptante);
          const textoPublicoAviso =
            `⚠️ ${identidad.nombre} solo disponía de ${prefijo}${formatearMontoRegional(disponibleAviso)} ` +
            `para esta jugada. Se concretaron ${prefijo}${formatearMontoRegional(montoConcretadoAviso)}.`;

          await supabaseAdmin.from("chat_mensajes").insert({
            grupo_id: grupoId,
            sala_id: salaId,
            remitente_nombre: "🤖 ASISTENTE DE SALA",
            es_operador: true,
            tipo_mensaje: "ALERTA_SALDO",
            contenido: textoPublicoAviso,
            reply_to_msg_id: propuestaId,
            solo_borrable_operador: true,
          });

          await supabaseAdmin.from("chat_mensajes").insert({
            grupo_id: grupoId,
            sala_id: salaId,
            remitente_id: esUuidValido(identidad.usuarioId) ? identidad.usuarioId : null,
            remitente_nombre: "🤖 ASISTENTE DE SALA",
            es_operador: true,
            tipo_mensaje: "DM_PRIVADO",
            destinatario_privado_id: esUuidValido(identidad.usuarioId) ? identidad.usuarioId : null,
            contenido:
              '"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo. ' +
              `Tu jugada quedó por ${prefijo}${formatearMontoRegional(montoConcretadoAviso)}.`,
            reply_to_msg_id: propuestaId,
            solo_borrable_operador: true,
          });
        }

        await emitirBroadcast(salaId, "nuevo_mensaje", { salaId });
        return NextResponse.json({ ok: true, resultadoFifo: resFifo });
      }

      // CASO B: Mensaje normal o nueva propuesta de jugador
      if (identidad.tipo === "JUGADOR") {
        // Consultar saldo disponible
        const { data: cl } = await supabaseAdmin
          .from("clientes")
          .select("saldo_actual, saldo_retenido, libre, aval")
          .eq("id", identidad.usuarioId)
          .single();

        const disponible = calcularDisponibleCliente(cl);
        const retirados = (sala as any).retirados || [];

        // 1. Detección de orden de cierre/retiro de jugadas abiertas ("Se fue", "sf", etc.)
        // Se cierran directamente cada una de las jugadas abiertas individualmente SIN enviar mensaje al chat para no saturar.
        const analisisRetiro = analizarComandoRetiro(texto);
        if (analisisRetiro.esComandoRetiro || body.cerrarPropuestaId) {
          if (analisisRetiro.esComandoRetiro && !analisisRetiro.esValido && !body.cerrarPropuestaId) {
            // Aclaratoria pedagógica obligatoria si fue similar
            return NextResponse.json({
              ok: true,
              esCorreccionPedagogica: true,
              mensajePedagogico: analisisRetiro.mensajeAclaratoria || "Por favor aclara si deseas retirar tus jugadas con: 'Se fue' o 'sf'",
              sugerencias: ["Se fue", "sf"],
            });
          }

          let queryAbiertas = supabaseAdmin
            .from("chat_mensajes")
            .select("id, monto_disponible, monto_original")
            .eq("sala_id", salaId)
            .eq("remitente_id", identidad.usuarioId)
            .in("estado_propuesta", ["abierta", "parcial"])
            .gt("monto_disponible", 0);

          if (body.cerrarPropuestaId) {
            queryAbiertas = queryAbiertas.eq("id", body.cerrarPropuestaId);
          }

          const { data: propuestasAbiertas } = await queryAbiertas;

          let totalRemanenteLiberado = 0;
          const idsCerrados: string[] = [];
          for (const prop of propuestasAbiertas || []) {
            totalRemanenteLiberado += Number(prop.monto_disponible || 0);
            idsCerrados.push(prop.id);
            await supabaseAdmin
              .from("chat_mensajes")
              .update({
                estado_propuesta: "cerrada",
                monto_disponible: 0,
              })
              .eq("id", prop.id);
          }

          // Liberar el saldo retenido no comprometido
          if (!cl?.libre && totalRemanenteLiberado > 0) {
            const retActual = Number(cl?.saldo_retenido || 0);
            const nuevoRetenido = Math.max(0, Number((retActual - totalRemanenteLiberado).toFixed(2)));
            await supabaseAdmin
              .from("clientes")
              .update({
                saldo_retenido: nuevoRetenido,
                saldo_disponible: Math.max(0, Number(((cl?.saldo_actual || 0) + (cl?.aval || 0) - nuevoRetenido).toFixed(2))),
              })
              .eq("id", identidad.usuarioId);
          }

          // No se inserta ningún mensaje al chat para no saturar el grupo: cada propuesta queda cerrada individualmente.
          await emitirBroadcast(salaId, "nuevo_mensaje", { salaId, idsCerrados });
          return NextResponse.json({
            ok: true,
            comandoRetiro: true,
            idsCerrados,
            totalLiberado: totalRemanenteLiberado,
          });
        }

        // Análisis mediante Parser Pedagógico Determinístico
        const { data: gDataJugada } = await supabaseAdmin
          .from("grupos_venta")
          .select("moneda")
          .eq("id", grupoId)
          .maybeSingle();
        const monedaGrupo = gDataJugada?.moneda || "USD";
        const analisis = analizarYEstandarizarJugada(texto, disponible, retirados, 16, identidad.nombre, monedaGrupo);

        // Si tuvo intención de jugada pero superó saldo, retirado o formato erróneo
        if (analisis.esIntencionDeJugada && !analisis.valido) {
          // Registrar en registro_revision_llm
          await supabaseAdmin.from("registro_revision_llm").insert({
            grupo_id: grupoId,
            sala_id: salaId,
            usuario_id: esUuidValido(identidad.usuarioId) ? identidad.usuarioId : null,
            usuario_nombre: identidad.nombre,
            mensaje_usuario_original: texto,
            jugada_corregida_sugerida: analisis.sugerenciasUnClic?.[0] || analisis.jugadaEstandarizada,
            intencion_detectada: analisis.modalidad,
            respuesta_ia_enviada: analisis.mensajePedagogicoPrivado || "Corrección pedagógica",
            nivel_confianza: analisis.confianza,
            requiere_intervencion_humana: analisis.requiereOperador,
            estado_ticket_soporte: analisis.requiereOperador ? "pendiente_operador" : "resuelto_ia",
          });

          return NextResponse.json({
            ok: true,
            esCorreccionPedagogica: true,
            mensajePedagogico: analisis.mensajePedagogicoPrivado,
            sugerencias: analisis.sugerenciasUnClic || [],
            jugadaEstandarizada: analisis.jugadaEstandarizada,
          });
        }

        // Si es una propuesta de jugada válida
        if (analisis.esIntencionDeJugada && analisis.valido) {
          if (sala.estado_carrera !== "abierta") {
            return NextResponse.json({ ok: false, error: "La carrera está cerrada para nuevas jugadas" }, { status: 400 });
          }

          // Resolver carrera activa de forma robusta
          let carreraIdActiva = sala.carrera_activa_id;
          if (!carreraIdActiva || !esUuidValido(carreraIdActiva)) {
            const { data: cOpen } = await supabaseAdmin
              .from("carreras")
              .select("id")
              .eq("hipodromo", sala.hipodromo_activo || "LA RINCONADA")
              .eq("numero_carrera", sala.numero_carrera_activa || 1)
              .maybeSingle();
            if (cOpen && esUuidValido(cOpen.id)) {
              carreraIdActiva = cOpen.id;
            }
          }

          let propId: string | null = null;

          // 1. Intentar creación atómica vía RPC publicar_propuesta_atomica
          if (
            esUuidValido(carreraIdActiva) &&
            esUuidValido(identidad.usuarioId) &&
            esUuidValido(salaId) &&
            esUuidValido(grupoId)
          ) {
            try {
              const { data: rpcResp, error: rpcErr } = await supabaseAdmin.rpc("publicar_propuesta_atomica", {
                p_grupo_id: grupoId,
                p_sala_id: salaId,
                p_carrera_id: carreraIdActiva,
                p_jugador_id: identidad.usuarioId,
                p_accion: analisis.accionProponente || "JUEGA",
                p_es_match: Boolean(analisis.esMatch),
                p_modalidad: analisis.modalidad,
                p_caballos_a: analisis.caballosBandoA || (analisis.ejemplarTexto ? [analisis.ejemplarTexto] : []),
                p_caballos_b: analisis.caballosBandoB || [],
                p_ejemplar_texto: analisis.ejemplarTexto || "",
                p_proporcion: "1x1",
                p_monto_solicitado: analisis.monto,
                p_texto_estandarizado: analisis.jugadaEstandarizada,
              });

              if (!rpcErr && rpcResp && (rpcResp as any).ok && (rpcResp as any).propuesta_id) {
                propId = (rpcResp as any).propuesta_id;
              }
            } catch {
              // Continúa a fallback
            }
          }

          // 2. Si el RPC no creó la propuesta (ej. carrera no mapeada en chat_estado_grupo), fallback directo garantizado
          if (!propId) {
            // Retener saldo de manera segura
            if (!cl?.libre) {
              const saldoRetenidoActual = Number(cl?.saldo_retenido || 0);
              const nuevoRetenido = Number((saldoRetenidoActual + Number(analisis.monto)).toFixed(2));
              await supabaseAdmin
                .from("clientes")
                .update({ saldo_retenido: nuevoRetenido })
                .eq("id", identidad.usuarioId);
            }

            const rawFirma = `PROPUESTA:${salaId}:${identidad.usuarioId}:${analisis.monto}:${Date.now()}`;
            const firma = crypto.createHash("sha256").update(rawFirma).digest("hex");

            const { data: nuevoMsg, error: errInsertDirecto } = await supabaseAdmin
              .from("chat_mensajes")
              .insert({
                grupo_id: grupoId,
                sala_id: salaId,
                remitente_id: esUuidValido(identidad.usuarioId) ? identidad.usuarioId : null,
                remitente_nombre: identidad.nombre,
                es_operador: false,
                tipo_mensaje: "propuesta_jugada",
                contenido: analisis.jugadaEstandarizada,
                carrera_id: esUuidValido(carreraIdActiva) ? carreraIdActiva : null,
                accion_proponente: analisis.accionProponente || "JUEGA",
                es_match: Boolean(analisis.esMatch),
                modalidad_jugada: analisis.modalidad,
                ejemplar_numero: analisis.ejemplarTexto,
                caballos_bando_a: analisis.caballosBandoA || (analisis.ejemplarTexto ? [analisis.ejemplarTexto] : []),
                caballos_bando_b: analisis.caballosBandoB || [],
                jugada_estandarizada: analisis.jugadaEstandarizada,
                monto_original: analisis.monto,
                monto_disponible: analisis.monto,
                estado_propuesta: "abierta",
                proporcion_premio: "1x1",
                firma_sha256: firma,
                solo_borrable_operador: false,
                eliminado: false,
              })
              .select()
              .single();

            if (errInsertDirecto) {
              return NextResponse.json({ ok: false, error: errInsertDirecto.message }, { status: 500 });
            }

            propId = nuevoMsg?.id;
          }

          await emitirBroadcast(salaId, "nuevo_mensaje", { salaId });
          return NextResponse.json({ ok: true, propuestaId: propId, jugadaEstandarizada: analisis.jugadaEstandarizada });
        }
      }

      // Mensaje de texto estándar (o emitido por Staff / Jugador)
      const esOperador = puedeOperarSala(identidad, grupoId);
      const pizarraLlegada = puedeLiquidarSala(identidad, grupoId)
        ? parsearPizarraLlegadaTexto(texto)
        : null;
      const remitenteUuid = esUuidValido(identidad.usuarioId) ? identidad.usuarioId : null;
      const destPrivadoUuid = esUuidValido(destinatarioPrivadoId) ? destinatarioPrivadoId : null;
      const replyMsgUuid = esUuidValido(replyToMsgId) ? replyToMsgId : null;

      const { data: msgInsertado, error: errInsert } = await supabaseAdmin
        .from("chat_mensajes")
        .insert({
          grupo_id: grupoId,
          sala_id: salaId,
          remitente_id: remitenteUuid,
          remitente_nombre: identidad.nombre,
          es_operador: esOperador,
          tipo_mensaje: pizarraLlegada ? "PIZARRA" : destPrivadoUuid ? "DM_PRIVADO" : "TEXTO",
          contenido: texto,
          destinatario_privado_id: destPrivadoUuid,
          reply_to_msg_id: replyMsgUuid,
          imagen_url: imagenUrl || null,
          solo_borrable_operador: esOperador,
        })
        .select()
        .single();

      if (errInsert) {
        return NextResponse.json({ ok: false, error: errInsert.message }, { status: 500 });
      }

      if (pizarraLlegada) {
        const resLiq = await liquidarCarreraFallback(grupoId, salaId, pizarraLlegada, identidad.nombre);
        await emitirBroadcast(salaId, "nuevo_mensaje", { salaId });
        return NextResponse.json({ ok: true, mensaje: msgInsertado, liquidacionAutomatica: resLiq });
      }

      await emitirBroadcast(salaId, "nuevo_mensaje", { salaId });
      return NextResponse.json({ ok: true, mensaje: msgInsertado });
    }

    // ------------------------------------------------------------------------
    // 2. REVISIÓN LLM / CORRECCIÓN PEDAGÓGICA MANUAL O REGISTRO
    // ------------------------------------------------------------------------
    if (accion === "revision-llm") {
      const { salaId, mensajeOriginal, jugadaSugerida, intencion, respuestaIa, confianza, requiereIntervencionHumana } = body;
      const grupoId = resolverGrupoEfectivo(identidad, body.grupoId);

      const { data: reg, error } = await supabaseAdmin.from("registro_revision_llm").insert({
        grupo_id: grupoId,
        sala_id: salaId,
        usuario_id: esUuidValido(identidad.usuarioId) ? identidad.usuarioId : null,
        usuario_nombre: identidad.nombre,
        mensaje_usuario_original: mensajeOriginal,
        jugada_corregida_sugerida: jugadaSugerida,
        intencion_detectada: intencion,
        respuesta_ia_enviada: respuestaIa,
        nivel_confianza: confianza,
        requiere_intervencion_humana: Boolean(requiereIntervencionHumana),
        estado_ticket_soporte: requiereIntervencionHumana ? "pendiente_operador" : "resuelto_ia",
      }).select().single();

      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, registro: reg });
    }

    // ------------------------------------------------------------------------
    // 3. RECARGA BLINDADA (5 CANDADOS)
    // ------------------------------------------------------------------------
    if (accion === "recarga") {
      // Compatibilidad: la validación OCR/IA ya NO se acepta desde el body.
      // Todo se calcula en el servidor (ver recargas-server.ts).
      const resultado = await validarSolicitudRecargaServidor(identidad, {
        grupoId: body.grupoId,
        clienteId: body.clienteId,
        metodoPago: body.metodoPago,
        bancoOrigen: body.bancoOrigen,
        referencia: body.referencia,
        montoReportado: body.montoReportado ?? body.monto,
        moneda: body.moneda,
        nombreArchivo: body.nombreArchivo,
        comprobanteUrl: body.comprobanteUrl,
        hashImagenSha256: body.hashImagenSha256,
      });

      if (!resultado.ok) {
        return NextResponse.json({ ok: false, error: resultado.error }, { status: resultado.status });
      }

      return NextResponse.json({
        ok: true,
        conciliacion: resultado.conciliacion,
        resultado: resultado.resultado,
      });
    }

    // ------------------------------------------------------------------------
    // 4. ACCIONES DE OPERADOR
    // ------------------------------------------------------------------------
    if (accion === "operador") {
      const { subaccion, salaId } = body;
      const grupoId = resolverGrupoEfectivo(identidad, body.grupoId);

      if (!grupoId || !puedeOperarSala(identidad, grupoId)) {
        return NextResponse.json({ ok: false, error: "No autorizado para operar salas de este grupo" }, { status: 403 });
      }

      // 4.a ABRIR CARRERA
      if (subaccion === "abrir-carrera") {
        const { hipodromo, numeroCarrera, distancia, carreraId } = body;
        const distNum = Number(distancia || 1200);
        const carreraNum = Number(numeroCarrera || 1);
        const hipoTexto = String(hipodromo || "LA RINCONADA").toUpperCase().trim();

        // Validar restricción geográfica de salas:
        // - En sala VENEZUELA: solo LA RINCONADA o VALENCIA
        // - En sala AMERICANAS: solo hipódromos americanos (no venezolanos)
        const { data: salaActual } = await supabaseAdmin
          .from("salas_juego")
          .select("id, nombre_sala, orden_sala")
          .eq("id", salaId)
          .maybeSingle();

        const nombreSalaUpper = String(salaActual?.nombre_sala || "").toUpperCase();
        const esChatVenezuela =
          nombreSalaUpper.includes("VENEZUELA") ||
          nombreSalaUpper.includes("RINCONADA");
        const esChatAmericanas =
          nombreSalaUpper.includes("AMERICANA") ||
          nombreSalaUpper.includes("USA");

        const esHipoVenezuela =
          hipoTexto.includes("RINCONADA") ||
          hipoTexto.includes("VALENCIA") ||
          hipoTexto === "LR" ||
          hipoTexto === "VAL";

        if (esChatVenezuela && !esHipoVenezuela) {
          return NextResponse.json(
            { ok: false, error: "En el chat de VENEZUELA solo pueden abrirse carreras de LA RINCONADA o VALENCIA." },
            { status: 400 }
          );
        }

        if (esChatAmericanas && esHipoVenezuela) {
          return NextResponse.json(
            { ok: false, error: "En el chat de AMERICANAS solo pueden abrirse hipódromos americanos." },
            { status: 400 }
          );
        }

        await supabaseAdmin
          .from("salas_juego")
          .update({
            carrera_activa_id: carreraId || null,
            hipodromo_activo: hipoTexto,
            numero_carrera_activa: carreraNum,
            distancia_activa: distNum,
            estado_carrera: "abierta",
            updated_at: new Date().toISOString(),
          })
          .eq("id", salaId);

        await sincronizarEstadoGrupo(grupoId);

        // Mensaje destacado exacto según especificación
        const textoDestacado = construirMensajeCarreraAbierta(hipoTexto, carreraNum);

        await supabaseAdmin.from("chat_mensajes").insert({
          grupo_id: grupoId,
          sala_id: salaId,
          remitente_nombre: "Operador de Sala",
          es_operador: true,
          tipo_mensaje: "ESTADO_CARRERA",
          contenido: textoDestacado,
          solo_borrable_operador: true,
        });

        await emitirBroadcast(salaId, "carrera_abierta", { salaId });
        return NextResponse.json({ ok: true });
      }

      // 4.b CERRAR CARRERA
      if (subaccion === "cerrar-carrera") {
        const { data: sala } = await supabaseAdmin.from("salas_juego").select("*").eq("id", salaId).single();

        await supabaseAdmin
          .from("salas_juego")
          .update({
            estado_carrera: "cerrada",
            carrera_recien_cerrada_id: sala?.carrera_activa_id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", salaId);

        await sincronizarEstadoGrupo(grupoId);

        const textoCierre = construirMensajeCarreraCerrada(
          sala?.hipodromo_activo || "HIPÓDROMO",
          sala?.numero_carrera_activa || 1
        );

        await supabaseAdmin.from("chat_mensajes").insert({
          grupo_id: grupoId,
          sala_id: salaId,
          remitente_nombre: "Operador de Sala",
          es_operador: true,
          tipo_mensaje: "ESTADO_CARRERA",
          contenido: textoCierre,
          solo_borrable_operador: true,
        });

        await emitirBroadcast(salaId, "carrera_cerrada", { salaId });
        return NextResponse.json({ ok: true });
      }

      // 4.c REABRIR CARRERA
      if (subaccion === "reabrir-carrera") {
        const { data: sala } = await supabaseAdmin.from("salas_juego").select("estado_carrera").eq("id", salaId).maybeSingle();
        if (sala?.estado_carrera === "liquidada") {
          return NextResponse.json({ ok: false, error: "Carrera liquidada: debes reversar la liquidación antes de reabrir." }, { status: 400 });
        }
        await supabaseAdmin
          .from("salas_juego")
          .update({
            estado_carrera: "abierta",
            updated_at: new Date().toISOString(),
          })
          .eq("id", salaId);

        await sincronizarEstadoGrupo(grupoId);
        await emitirBroadcast(salaId, "carrera_reabierta", { salaId });
        return NextResponse.json({ ok: true });
      }

      // 4.d RETIRADO EN VIVO
      if (subaccion === "retirado") {
        if (!puedeRetirarEjemplar(identidad, grupoId)) {
          return NextResponse.json({ ok: false, error: "No autorizado para procesar retirados" }, { status: 403 });
        }

        const { ejemplar, carreraId } = body;
        const { data: sala } = await supabaseAdmin.from("salas_juego").select("*").eq("id", salaId).single();
        if (sala?.estado_carrera === "liquidada") {
          return NextResponse.json({ ok: false, error: "Carrera liquidada: debes reversar la liquidación antes de procesar retirados." }, { status: 400 });
        }
        const carreraEfectivaId = carreraId || sala?.carrera_activa_id || sala?.carrera_recien_cerrada_id;

        const { data: retRes, error: errRet } = await supabaseAdmin.rpc("procesar_retirado_en_sala", {
          p_grupo_id: grupoId,
          p_sala_id: salaId,
          p_carrera_id: carreraEfectivaId,
          p_ejemplar_retirado: String(ejemplar).trim(),
        });

        if (errRet) {
          return NextResponse.json({ ok: false, error: errRet.message }, { status: 400 });
        }

        await supabaseAdmin.from("chat_mensajes").insert({
          grupo_id: grupoId,
          sala_id: salaId,
          remitente_nombre: "Operador de Sala",
          es_operador: true,
          tipo_mensaje: "ESTADO_CARRERA",
          contenido: `🚫 EJEMPLAR RETIRADO: Se ha procesado el retiro del ejemplar #${ejemplar}. Las jugadas pactadas han sido anuladas y los saldos restituidos.`,
          solo_borrable_operador: true,
        });

        await emitirBroadcast(salaId, "ejemplar_retirado", { salaId, ejemplar });
        return NextResponse.json({ ok: true, resultado: retRes });
      }

      // 4.e LIQUIDAR CARRERA (FALLBACK OFICIAL)
      if (subaccion === "liquidar") {
        if (!puedeLiquidarSala(identidad, grupoId)) {
          return NextResponse.json({ ok: false, error: "No autorizado para liquidar carreras" }, { status: 403 });
        }

        const { data: sala } = await supabaseAdmin.from("salas_juego").select("estado_carrera").eq("id", salaId).maybeSingle();
        if (sala?.estado_carrera === "liquidada") {
          return NextResponse.json({ ok: false, error: "Carrera ya liquidada: debes reversar la liquidación antes de volver a liquidar." }, { status: 400 });
        }

        const { pizarra } = body;
        if (!pizarra || !pizarra.primero) {
          return NextResponse.json({ ok: false, error: "La pizarra debe incluir al menos el 1º lugar" }, { status: 400 });
        }

        const resLiq = await liquidarCarreraFallback(grupoId, salaId, pizarra, identidad.nombre);
        return NextResponse.json({ ...resLiq });
      }

      // 4.e.1 REVERSAR LIQUIDACIÓN DE CARRERA
      if (subaccion === "reversar-carrera") {
        if (!puedeLiquidarSala(identidad, grupoId)) {
          return NextResponse.json({ ok: false, error: "No autorizado para reversar liquidaciones" }, { status: 403 });
        }

        const resRev = await reversarCarrera(grupoId, salaId, identidad.nombre);
        return NextResponse.json({ ...resRev });
      }

      // 4.e.2 ANULAR CARRERA (REEMBOLSO TOTAL 100%)
      if (subaccion === "anular-carrera") {
        if (!puedeLiquidarSala(identidad, grupoId)) {
          return NextResponse.json({ ok: false, error: "No autorizado para anular carreras" }, { status: 403 });
        }

        const resAnul = await anularCarrera(grupoId, salaId, identidad.nombre);
        return NextResponse.json({ ...resAnul });
      }

      // 4.f PUBLICIDAD
      if (subaccion === "publicidad") {
        const { titulo, contenido, enlace, imagen, fijado = false } = body;
        const { data: pub, error } = await supabaseAdmin.from("publicidad_sala").insert({
          grupo_id: grupoId,
          titulo,
          contenido_texto: contenido,
          enlace_accion: enlace || null,
          imagen_banner_url: imagen || null,
          fijado_en_tope: Boolean(fijado),
          activo: true,
        }).select().single();

        if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        await emitirBroadcast(salaId, "publicidad_actualizada", { grupoId });
        return NextResponse.json({ ok: true, publicidad: pub });
      }

      // 4.g ELIMINAR PUBLICIDAD
      if (subaccion === "publicidad-eliminar") {
        const { publicidadId } = body;
        await supabaseAdmin.from("publicidad_sala").update({ activo: false }).eq("id", publicidadId);
        await emitirBroadcast(salaId, "publicidad_actualizada", { grupoId });
        return NextResponse.json({ ok: true });
      }

      // 4.h DATOS PREJUGADAS
      if (subaccion === "prejugadas-data") {
        const { data: sala } = await supabaseAdmin.from("salas_juego").select("*").eq("id", salaId).single();
        const { data: tickets } = await supabaseAdmin
          .from("chat_tickets_fifo")
          .select("*")
          .eq("sala_id", salaId)
          .in("estado", ["PENDIENTE", "ACTIVO", "ABIERTO"]);

        return NextResponse.json({
          ok: true,
          sala,
          tickets: tickets || [],
        });
      }

      return NextResponse.json({ ok: false, error: "Subacción de operador no soportada" }, { status: 400 });
    }

    // ------------------------------------------------------------------------
    // 5. GESTIÓN DE SALAS Y MENSAJES (SUBACCIONES SALA)
    // ------------------------------------------------------------------------
    if (accion === "sala") {
      const { subaccion } = body;
      const grupoId = resolverGrupoEfectivo(identidad, body.grupoId);

      if (!grupoId) {
        return NextResponse.json({ ok: false, error: "grupoId es requerido" }, { status: 400 });
      }

      // 5.a CREAR SALA (Operador / Admin, máx 2 activas por grupo)
      if (subaccion === "crear") {
        if (!puedeOperarSala(identidad, grupoId)) {
          return NextResponse.json({ ok: false, error: "No autorizado para crear salas" }, { status: 403 });
        }

        const { data: salasExistentes } = await supabaseAdmin
          .from("salas_juego")
          .select("id")
          .eq("grupo_id", grupoId)
          .eq("activa", true);

        if (salasExistentes && salasExistentes.length >= 2) {
          return NextResponse.json(
            { ok: false, error: "Límite alcanzado: Máximo 2 salas activas simultáneas por grupo" },
            { status: 400 }
          );
        }

        const { nombreSala } = body;
        const orden = (salasExistentes?.length || 0) + 1;

        const { data: nuevaSala, error } = await supabaseAdmin
          .from("salas_juego")
          .insert({
            grupo_id: grupoId,
            nombre_sala: nombreSala || `Sala ${orden}`,
            orden_sala: orden,
            activa: true,
            estado_carrera: "cerrada",
          })
          .select()
          .single();

        if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true, sala: nuevaSala });
      }

      // 5.b EDITAR SALA (Operador / Admin)
      if (subaccion === "editar") {
        if (!puedeOperarSala(identidad, grupoId)) {
          return NextResponse.json({ ok: false, error: "No autorizado para editar salas" }, { status: 403 });
        }
        const { salaId, nombreSala, ordenSala, activa } = body;
        const updates: any = { updated_at: new Date().toISOString() };
        if (nombreSala !== undefined) updates.nombre_sala = nombreSala;
        if (ordenSala !== undefined) updates.orden_sala = ordenSala;
        if (activa !== undefined) updates.activa = activa;

        const { data: editada, error } = await supabaseAdmin
          .from("salas_juego")
          .update(updates)
          .eq("id", salaId)
          .eq("grupo_id", grupoId)
          .select()
          .single();

        if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true, sala: editada });
      }

      // 5.c ELIMINAR SALA (Operador / Admin)
      if (subaccion === "eliminar") {
        if (!puedeOperarSala(identidad, grupoId)) {
          return NextResponse.json({ ok: false, error: "No autorizado para eliminar salas" }, { status: 403 });
        }
        const { salaId } = body;
        await supabaseAdmin.from("salas_juego").update({ activa: false }).eq("id", salaId).eq("grupo_id", grupoId);
        return NextResponse.json({ ok: true });
      }

      // 5.d ELIMINAR MENSAJE (Operador o propio autor)
      if (subaccion === "eliminar-mensaje") {
        const { mensajeId } = body;
        const { data: msg } = await supabaseAdmin
          .from("chat_mensajes")
          .select("remitente_id, grupo_id")
          .eq("id", mensajeId)
          .single();

        if (!msg) return NextResponse.json({ ok: false, error: "Mensaje no encontrado" }, { status: 404 });

        const esPropio = msg.remitente_id === identidad.usuarioId;
        const esOperador = puedeOperarSala(identidad, msg.grupo_id);

        if (!esPropio && !esOperador) {
          return NextResponse.json({ ok: false, error: "No autorizado para eliminar este mensaje" }, { status: 403 });
        }

        await supabaseAdmin.from("chat_mensajes").update({ eliminado: true }).eq("id", mensajeId);
        return NextResponse.json({ ok: true });
      }

      // 5.e ANULAR PROPUESTA (Operador o propio proponente)
      if (subaccion === "anular-propuesta") {
        const { propuestaId } = body;
        const { data: prop } = await supabaseAdmin
          .from("chat_mensajes")
          .select("*")
          .eq("id", propuestaId)
          .single();

        if (!prop) return NextResponse.json({ ok: false, error: "Propuesta no encontrada" }, { status: 404 });

        const esPropio = prop.remitente_id === identidad.usuarioId;
        const esOperador = puedeOperarSala(identidad, prop.grupo_id);

        if (!esPropio && !esOperador) {
          return NextResponse.json({ ok: false, error: "No autorizado para anular esta propuesta" }, { status: 403 });
        }

        // Devolver remanente no concretado al proponente
        const remanente = Number(prop.monto_disponible || 0);
        if (remanente > 0 && prop.remitente_id) {
          const { data: cl } = await supabaseAdmin
            .from("clientes")
            .select("saldo_retenido, saldo_actual, libre")
            .eq("id", prop.remitente_id)
            .single();

          if (cl) {
            const nuevoRetenido = Math.max(0, Number(((cl.saldo_retenido || 0) - remanente).toFixed(2)));
            await supabaseAdmin
              .from("clientes")
              .update({
                saldo_retenido: nuevoRetenido,
                saldo_disponible: cl.libre ? 999999 : Math.max(0, (cl.saldo_actual || 0) - nuevoRetenido),
              })
              .eq("id", prop.remitente_id);

            await supabaseAdmin.from("libro_mayor_clientes").insert({
              cliente_id: prop.remitente_id,
              cliente_nombre: prop.remitente_nombre,
              grupo_id: prop.grupo_id,
              tipo_movimiento: "ANULACION_RESTITUCION",
              monto_centavos: Math.round(remanente * 100),
              monto: remanente,
              observacion: `Restitución por anulación de propuesta de juego #${prop.id.slice(0, 8)}`,
              creado_por: identidad.nombre,
            });
          }
        }

        await supabaseAdmin
          .from("chat_mensajes")
          .update({
            estado_propuesta: "anulada",
            monto_disponible: 0,
          })
          .eq("id", propuestaId);

        return NextResponse.json({ ok: true, remanenteDevuelto: remanente });
      }

      return NextResponse.json({ ok: false, error: "Subacción de sala no soportada" }, { status: 400 });
    }

    return NextResponse.json({ ok: false, error: "Acción no soportada" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || "Error interno del servidor" }, { status: 500 });
  }
}
