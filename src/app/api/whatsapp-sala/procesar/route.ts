import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/core/supabase-admin";
import {
  analizarYEstandarizarJugada,
  evaluarConcrecionEstricta,
  analizarComandoRetiro,
} from "@/features/sala-juegos/lib/parser-pedagogico";
import { formatearMontoRegional } from "@/shared/lib/dinero";
import { sincronizarTicketsPropuestaATaquilla } from "@/features/whatsapp-sala/lib/sincronizar-tickets-sala";

export const dynamic = "force-dynamic";

const BOT_DAEMON_URL = process.env.WHATSAPP_BOT_URL || "http://127.0.0.1:3005";

// Mutex FIFO en memoria por propuesta para garantizar ejecución secuencial (1 a la vez: Caso 90 + 10 = 100)
const colasConcrecionFifo = new Map<string, Promise<any>>();

function encolarConcrecionSecuencial<T>(propuestaId: string, tarea: () => Promise<T>): Promise<T> {
  const previa = colasConcrecionFifo.get(propuestaId) || Promise.resolve();
  const actual = previa.then(tarea, tarea);
  colasConcrecionFifo.set(
    propuestaId,
    actual.then(
      () => {},
      () => {}
    )
  );
  return actual;
}

function normalizarTelefono(raw?: string | null): string {
  if (!raw) return "";
  return String(raw)
    .replace(/@.*$/, "")
    .replace(/:.*$/, "")
    .replace(/[^0-9]/g, "");
}

function calcularSaldoDisponible(cliente: any): number {
  if (!cliente) return 0;
  if (cliente.libre) return 999999;
  const saldo = Number(cliente.saldo_actual ?? 0);
  const aval = Number(cliente.aval ?? 0);
  const retenido = Number(cliente.saldo_retenido ?? 0);
  return Math.max(0, Number((saldo + aval - retenido).toFixed(2)));
}

async function emitirBroadcastSala(salaId: string, evento: string, payload: any) {
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
        messages: [{ topic: `realtime:sala:${salaId}`, event: evento, payload }],
      }),
    }).catch(() => {});
  } catch {
    // No bloqueante
  }
}

async function asegurarDosSalasPrincipales() {
  const { data: salasExistentes } = await supabaseAdmin
    .from("salas_juego")
    .select("*")
    .eq("activa", true)
    .order("orden_sala", { ascending: true })
    .limit(2);

  if (salasExistentes && salasExistentes.length >= 2) {
    return salasExistentes;
  }

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

  if (!salasExistentes || salasExistentes.length === 0) {
    await supabaseAdmin.from("salas_juego").insert([
      {
        grupo_id: grupoId,
        nombre_sala: "Sala 1 - Nacionales",
        orden_sala: 1,
        activa: true,
        estado_carrera: "abierta",
        hipodromo_activo: "LA RINCONADA",
        numero_carrera_activa: 1,
      },
      {
        grupo_id: grupoId,
        nombre_sala: "Sala 2 - Americanas",
        orden_sala: 2,
        activa: true,
        estado_carrera: "abierta",
        hipodromo_activo: "GULFSTREAM PARK",
        numero_carrera_activa: 1,
      },
    ]);
  } else if (salasExistentes.length === 1) {
    await supabaseAdmin.from("salas_juego").insert({
      grupo_id: salasExistentes[0].grupo_id || grupoId,
      nombre_sala: "Sala 2 - Americanas",
      orden_sala: 2,
      activa: true,
      estado_carrera: "abierta",
      hipodromo_activo: "GULFSTREAM PARK",
      numero_carrera_activa: 1,
    });
  }

  const { data: salasFinales } = await supabaseAdmin
    .from("salas_juego")
    .select("*")
    .eq("activa", true)
    .order("orden_sala", { ascending: true })
    .limit(2);

  return salasFinales || [];
}

// ============================================================================
// GET: Estado del Demonio Baileys + Salas Activas
// ============================================================================
export async function GET() {
  let estadoBot = {
    conectado: false,
    qrDataUrl: null as string | null,
    numeroVinculado: null as string | null,
    grupos: [] as Array<{ jid: string; nombre: string }>,
    daemonOnline: false,
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${BOT_DAEMON_URL}/status`, {
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const json = await res.json();
      estadoBot = {
        conectado: Boolean(json.conectado),
        qrDataUrl: json.qrDataUrl || null,
        numeroVinculado: json.numeroVinculado || null,
        grupos: Array.isArray(json.grupos) ? json.grupos : [],
        daemonOnline: true,
      };
    }
  } catch {
    // Si el demonio local en :3005 aún no está encendido, responder estado desconectado limpio
  }

  let salas: any[] = [];
  try {
    salas = await asegurarDosSalasPrincipales();
  } catch {
    salas = [];
  }

  return NextResponse.json({
    ok: true,
    ...estadoBot,
    salas,
  });
}

// ============================================================================
// POST: Procesamiento en vivo de Jugadas, Concreciones y Acciones de Sala
// ============================================================================
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    // ------------------------------------------------------------------------
    // ACCIONES ADMINISTRATIVAS DESDE LA PANTALLA /whatsapp
    // ------------------------------------------------------------------------
    if (body.accion === "vincular-sala") {
      const { salaId, groupJid, groupNombre } = body;
      if (!salaId) {
        return NextResponse.json({ ok: false, error: "salaId es requerido" }, { status: 400 });
      }

      const { data: salaActualizada, error } = await supabaseAdmin
        .from("salas_juego")
        .update({
          whatsapp_group_jid: groupJid || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", salaId)
        .select()
        .maybeSingle();

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      // Notificar también al demonio local en :3005 si está activo
      try {
        await fetch(`${BOT_DAEMON_URL}/vincular-sala`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ salaId, groupJid, groupNombre }),
        });
      } catch {
        // Demonio offline, pero ya quedó guardado en Supabase
      }

      return NextResponse.json({
        ok: true,
        sala: salaActualizada,
        groupJid: groupJid || null,
        groupNombre: groupNombre || null,
      });
    }

    if (body.accion === "publicar-plano") {
      const { salaId } = body;
      if (!salaId) {
        return NextResponse.json({ ok: false, error: "salaId es requerido" }, { status: 400 });
      }

      const { data: sala } = await supabaseAdmin
        .from("salas_juego")
        .select("*")
        .eq("id", salaId)
        .maybeSingle();

      if (!sala) {
        return NextResponse.json({ ok: false, error: "Sala no encontrada" }, { status: 404 });
      }

      const hipodromo = String(sala.hipodromo_activo || "HIPÓDROMO").toUpperCase();
      const numCarrera = sala.numero_carrera_activa || 1;
      const carreraId = sala.carrera_activa_id || null;

      let query = supabaseAdmin
        .from("chat_tickets_fifo")
        .select("*")
        .eq("sala_id", sala.id)
        .in("estado", ["PENDIENTE", "ACTIVO", "ABIERTO"])
        .order("created_at", { ascending: true });

      if (carreraId) {
        query = query.or(`carrera_id.eq.${carreraId},carrera_id.is.null`);
      }

      const { data: tickets } = await query;
      const lista = tickets || [];
      const totalPactado = lista.reduce((acc, t) => acc + Number(t.monto_concretado || 0), 0);

      const lineas =
        lista.length > 0
          ? lista
              .map((t, idx) => {
                const codigo = (t.codigo_ticket || String(t.id || "").slice(0, 6)).toUpperCase();
                const detalle = t.es_match
                  ? `Match ${(t.caballos_bando_a || []).join("-")} x ${(t.caballos_bando_b || []).join("-")}`
                  : `${t.modalidad || "1P"} #${t.ejemplar_numero || (t.caballos_bando_a || []).join("-")}`;
                return `${idx + 1}. [${codigo}] *${t.proponente_nombre}* vs *${t.aceptante_nombre}* — ${detalle} por *$${formatearMontoRegional(Number(t.monto_concretado || 0))}*`;
              })
              .join("\n")
          : "_No hay jugadas activas pactadas en esta carrera._";

      const textoPlano =
        `📋 *PLANO DE JUGADAS / PREJUGADAS*\n` +
        `🏇 *${hipodromo}* — Carrera #${numCarrera}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${lineas}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `💰 *Total Jugado:* $${formatearMontoRegional(totalPactado)} (${lista.length} tickets)`;

      let enviadoWhatsApp = false;
      if (sala.whatsapp_group_jid) {
        try {
          const rBot = await fetch(`${BOT_DAEMON_URL}/publicar-grupo`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              groupJid: sala.whatsapp_group_jid,
              texto: textoPlano,
              quotedMsgId: null,
            }),
          });
          enviadoWhatsApp = rBot.ok;
        } catch {
          enviadoWhatsApp = false;
        }
      }

      return NextResponse.json({
        ok: true,
        textoPlano,
        totalTickets: lista.length,
        totalPactado,
        enviadoWhatsApp,
      });
    }

    if (body.accion === "publicar-sentencia") {
      const { salaId, pizarra } = body;
      if (!salaId || !pizarra) {
        return NextResponse.json(
          { ok: false, error: "salaId y pizarra son requeridos" },
          { status: 400 }
        );
      }

      const { data: sala } = await supabaseAdmin
        .from("salas_juego")
        .select("*")
        .eq("id", salaId)
        .maybeSingle();

      if (!sala) {
        return NextResponse.json({ ok: false, error: "Sala no encontrada" }, { status: 404 });
      }

      const numeros = String(pizarra).match(/\b\d+[A-Za-z]?\b/g) || [];
      if (numeros.length === 0) {
        return NextResponse.json(
          { ok: false, error: "Formato de pizarra inválido (ej. 10.5.1.2.7)" },
          { status: 400 }
        );
      }

      // Intentar delegar al demonio si está en línea, o liquidar directamente desde aquí
      try {
        const rDaemon = await fetch(`${BOT_DAEMON_URL}/publicar-sentencia`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            salaId,
            groupJid: sala.whatsapp_group_jid,
            pizarra,
          }),
        });
        if (rDaemon.ok) {
          const jsonDaemon = await rDaemon.json();
          return NextResponse.json({ ...jsonDaemon, enviadoWhatsApp: true });
        }
      } catch {
        // Fallback local si el demonio no está activo
      }

      const [p1, p2 = null, p3 = null, p4 = null, p5 = null] = numeros;
      const hipodromo = String(sala.hipodromo_activo || "HIPÓDROMO").toUpperCase();
      const numCarrera = sala.numero_carrera_activa || 1;
      const carreraId = sala.carrera_activa_id || sala.carrera_recien_cerrada_id || null;

      let positivos: string[] = [];
      let negativos: string[] = [];
      let rpcLiquidado = false;

      try {
        const { data: resRpc, error: errRpc } = await supabaseAdmin.rpc(
          "liquidar_carrera_sala_oficial",
          {
            p_grupo_id: sala.grupo_id,
            p_sala_id: sala.id,
            p_carrera_id: carreraId,
            p_p1: p1,
            p_p2: p2,
            p_p3: p3,
            p_p4: p4,
            p_p5: p5,
          }
        );
        if (!errRpc && resRpc) {
          rpcLiquidado = true;
          if (Array.isArray((resRpc as any).positivos)) positivos = (resRpc as any).positivos;
          if (Array.isArray((resRpc as any).negativos)) negativos = (resRpc as any).negativos;
        }
      } catch {
        rpcLiquidado = false;
      }

      if (!rpcLiquidado || (positivos.length === 0 && negativos.length === 0)) {
        const { data: grupo } = await supabaseAdmin
          .from("grupos_venta")
          .select("permite_cruces, comision_default")
          .eq("id", sala.grupo_id)
          .maybeSingle();

        const permiteCruces = grupo?.permite_cruces ?? true;
        const porcComision = Number(grupo?.comision_default ?? 5) / 100;

        let queryTickets = supabaseAdmin
          .from("chat_tickets_fifo")
          .select("*")
          .eq("sala_id", sala.id)
          .in("estado", ["PENDIENTE", "ACTIVO", "ABIERTO"]);

        if (carreraId) {
          queryTickets = queryTickets.or(`carrera_id.eq.${carreraId},carrera_id.is.null`);
        }

        const { data: tickets } = await queryTickets;
        const balance: Record<
          string,
          { nombre: string; ganancias: number; perdidas: number; comisionInd: number; stake: number }
        > = {};

        const asegurar = (id: string, nombre: string) => {
          if (!balance[id]) {
            balance[id] = {
              nombre: nombre || "Jugador",
              ganancias: 0,
              perdidas: 0,
              comisionInd: 0,
              stake: 0,
            };
          }
        };

        for (const t of tickets || []) {
          asegurar(t.proponente_id, t.proponente_nombre);
          asegurar(t.aceptante_id, t.aceptante_nombre);

          const monto = Number(t.monto_concretado || 0);
          balance[t.proponente_id].stake += monto;
          balance[t.aceptante_id].stake += monto;

          const { data: evalData, error: evalErr } = await supabaseAdmin.rpc(
            "evaluar_jugada_universal",
            {
              p_es_match: Boolean(t.es_match),
              p_accion_proponente: t.accion_proponente || "JUEGA",
              p_modalidad: t.modalidad || "1P",
              p_caballos_a: t.caballos_bando_a || (t.ejemplar_numero ? [t.ejemplar_numero] : []),
              p_caballos_b: t.caballos_bando_b || [],
              p_p1: p1,
              p_p2: p2,
              p_p3: p3,
              p_p4: p4,
              p_p5: p5,
            }
          );

          const factor = evalErr ? 0 : Number(evalData || 0);
          let nuevoEstado = "EMPATE";

          if (factor > 0) {
            nuevoEstado = "GANADOR_PROPONENTE";
            balance[t.proponente_id].ganancias += monto;
            balance[t.aceptante_id].perdidas += monto;
            balance[t.proponente_id].comisionInd += monto * porcComision;
          } else if (factor < 0) {
            nuevoEstado = "GANADOR_ACEPTANTE";
            balance[t.aceptante_id].ganancias += monto;
            balance[t.proponente_id].perdidas += monto;
            balance[t.aceptante_id].comisionInd += monto * porcComision;
          }

          if (!rpcLiquidado) {
            await supabaseAdmin
              .from("chat_tickets_fifo")
              .update({ estado: nuevoEstado })
              .eq("id", t.id);
          }
        }

        for (const [jugadorId, b] of Object.entries(balance)) {
          let neto = 0;
          if (permiteCruces) {
            const bruto = b.ganancias - b.perdidas;
            neto = bruto > 0 ? bruto - bruto * porcComision : bruto;
          } else {
            neto = b.ganancias - b.comisionInd - b.perdidas;
          }
          neto = Number(neto.toFixed(2));

          if (!rpcLiquidado && jugadorId) {
            const { data: cl } = await supabaseAdmin
              .from("clientes")
              .select("saldo_actual, saldo_retenido, libre, aval")
              .eq("id", jugadorId)
              .maybeSingle();

            if (cl) {
              const nuevoSaldo = Number((Number(cl.saldo_actual || 0) + neto).toFixed(2));
              const nuevoRet = Math.max(
                0,
                Number((Number(cl.saldo_retenido || 0) - b.stake).toFixed(2))
              );
              await supabaseAdmin
                .from("clientes")
                .update({
                  saldo_actual: nuevoSaldo,
                  saldo_retenido: nuevoRet,
                  saldo_disponible: cl.libre
                    ? 999999
                    : Math.max(0, nuevoSaldo + Number(cl.aval || 0) - nuevoRet),
                })
                .eq("id", jugadorId);
            }
          }

          if (neto > 0) {
            positivos.push(`🟢 *${b.nombre}*: +$${formatearMontoRegional(neto)}`);
          } else if (neto < 0) {
            negativos.push(`🔴 *${b.nombre}*: -$${formatearMontoRegional(Math.abs(neto))}`);
          }
        }

        await supabaseAdmin
          .from("salas_juego")
          .update({
            estado_carrera: "liquidada",
            carrera_recien_cerrada_id: carreraId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", sala.id);
      }

      const pizarraFormateada = numeros.map((n, i) => `${i + 1}º: #${n}`).join(" · ");
      const textoResultado =
        `🏁 *SENTENCIA OFICIAL — ${hipodromo} C${numCarrera}*\n` +
        `📊 *Pizarra Oficial:* ${pizarraFormateada}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📈 *POSITIVOS (+):*\n` +
        `${positivos.length > 0 ? positivos.join("\n") : "_Sin saldos positivos en esta carrera_"}\n\n` +
        `📉 *NEGATIVOS (-):*\n` +
        `${negativos.length > 0 ? negativos.join("\n") : "_Sin saldos negativos en esta carrera_"}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━`;

      return NextResponse.json({
        ok: true,
        textoResultado,
        positivos,
        negativos,
        pizarra: numeros,
        enviadoWhatsApp: false,
      });
    }

    // ========================================================================
    // PROCESAMIENTO EN VIVO DE MENSAJES DESDE bot-whatsapp-server.mjs
    // ========================================================================
    const groupJid = String(body.groupJid || "").trim();
    const participantJid = String(body.participantJid || body.senderJid || "").trim();
    const texto = String(body.texto || "").trim();
    const whatsappMsgId = body.whatsappMsgId ? String(body.whatsappMsgId) : null;
    const quotedMsgId = body.quotedMsgId ? String(body.quotedMsgId) : null;

    if (!groupJid || !participantJid || !texto) {
      return NextResponse.json(
        {
          ok: false,
          error: "groupJid, participantJid y texto son requeridos",
          respuestaGrupo: null,
          mensajePrivadoAutor: null,
        },
        { status: 400 }
      );
    }

    // 1. Buscar la Sala vinculada a este groupJid
    const { data: sala } = await supabaseAdmin
      .from("salas_juego")
      .select("*")
      .eq("whatsapp_group_jid", groupJid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!sala) {
      return NextResponse.json({
        ok: false,
        tipo: "IGNORADO",
        mensaje: "Grupo no vinculado a ninguna sala activa",
        respuestaGrupo: null,
        mensajePrivadoAutor: null,
      });
    }

    const salaId = sala.id;
    const grupoId = sala.grupo_id;
    const carreraAbierta = String(sala.estado_carrera || "").toLowerCase() === "abierta";

    // 2. Identificar al jugador en `public.clientes` (por telefono_normalizado o whatsapp_jid)
    const telNormalizado = normalizarTelefono(participantJid);
    let cliente: any = null;

    const { data: clPorJidOTel } = await supabaseAdmin
      .from("clientes")
      .select(
        "id, nombre, seudonimo, saldo_actual, saldo_retenido, saldo_disponible, libre, aval, whatsapp_jid, telefono, telefono_normalizado"
      )
      .or(`whatsapp_jid.eq.${participantJid},telefono_normalizado.eq.${telNormalizado}`)
      .limit(1)
      .maybeSingle();

    if (clPorJidOTel) {
      cliente = clPorJidOTel;
    } else if (telNormalizado.length >= 8) {
      const { data: clPorSufijo } = await supabaseAdmin
        .from("clientes")
        .select(
          "id, nombre, seudonimo, saldo_actual, saldo_retenido, saldo_disponible, libre, aval, whatsapp_jid, telefono, telefono_normalizado"
        )
        .ilike("telefono", `%${telNormalizado.slice(-8)}%`)
        .limit(1)
        .maybeSingle();
      cliente = clPorSufijo;
    }

    const nombreJugador =
      cliente?.seudonimo || cliente?.nombre || body.senderNombre || "Jugador";

    if (!cliente) {
      return NextResponse.json({
        ok: false,
        tipo: "SIN_REGISTRO",
        respuestaGrupo: null,
        mensajePrivadoAutor: `Hola ${nombreJugador}, tu número de WhatsApp no está vinculado en el sistema. Contacta al administrador para habilitar tu cuenta.`,
      });
    }

    // Vincular automáticamente el whatsapp_jid si aún no lo tenía guardado
    if (!cliente.whatsapp_jid && participantJid.includes("@")) {
      await supabaseAdmin
        .from("clientes")
        .update({ whatsapp_jid: participantJid })
        .eq("id", cliente.id);
    }

    const saldoDisponible = calcularSaldoDisponible(cliente);

    // ========================================================================
    // FLUJO A: CONCRECIÓN SECUENCIAL POR RESPUESTA CITADA (quotedMsgId)
    // ========================================================================
    if (quotedMsgId) {
      const { data: propMsg } = await supabaseAdmin
        .from("chat_mensajes")
        .select("*")
        .or(`whatsapp_msg_id.eq.${quotedMsgId},id.eq.${quotedMsgId}`)
        .eq("sala_id", salaId)
        .limit(1)
        .maybeSingle();

      if (
        !propMsg ||
        (propMsg.tipo_mensaje !== "propuesta_jugada" && propMsg.tipo_mensaje !== "PROPUESTA")
      ) {
        return NextResponse.json({
          ok: false,
          tipo: "IGNORADO",
          respuestaGrupo: null,
          mensajePrivadoAutor: null,
        });
      }

      if (!carreraAbierta) {
        return NextResponse.json({
          ok: false,
          tipo: "CARRERA_CERRADA",
          respuestaGrupo: `⛔ La carrera se encuentra ${String(sala.estado_carrera || "CERRADA").toUpperCase()}. No se admiten concreciones.`,
          mensajePrivadoAutor: null,
        });
      }

      if (propMsg.remitente_id === cliente.id) {
        return NextResponse.json({
          ok: false,
          tipo: "AUTO_CONCRECION",
          respuestaGrupo: null,
          mensajePrivadoAutor: "⚠️ No puedes concretar tu propia propuesta de jugada.",
        });
      }

      // Ejecutar secuencialmente (1 a la vez por propuesta, Caso 90 + 10 = 100)
      return await encolarConcrecionSecuencial(propMsg.id, async () => {
        const { data: propFresca } = await supabaseAdmin
          .from("chat_mensajes")
          .select("*")
          .eq("id", propMsg.id)
          .single();

        const remanenteDisponible = Number(
          propFresca?.monto_disponible ?? propFresca?.monto_original ?? 0
        );
        const estadoProp = String(propFresca?.estado_propuesta || "abierta").toLowerCase();

        if (
          remanenteDisponible <= 0 ||
          (estadoProp !== "abierta" && estadoProp !== "parcial")
        ) {
          return NextResponse.json({
            ok: false,
            tipo: "PROPUESTA_AGOTADA",
            respuestaGrupo: `⚠️ Esta parada ya fue tomada al 100% o no tiene saldo disponible.`,
            mensajePrivadoAutor: null,
          });
        }

        // Recalcular saldo fresco del aceptante dentro del candado FIFO
        const { data: aceptanteFresco } = await supabaseAdmin
          .from("clientes")
          .select(
            "id, nombre, seudonimo, saldo_actual, saldo_retenido, libre, aval, whatsapp_jid, telefono"
          )
          .eq("id", cliente.id)
          .single();

        const saldoDispAceptante = calcularSaldoDisponible(aceptanteFresco || cliente);

        const accionProp: "JUEGA" | "CONSIGUE" =
          String(propFresca.accion_proponente || "").toUpperCase() === "CONSIGUE" ||
          /^(consigo|doy)\b/i.test(String(propFresca.contenido || ""))
            ? "CONSIGUE"
            : "JUEGA";

        // Evaluar palabras estrictas:
        // Contra Juego -> Consigo, Doy, J, Jugaste, Jugamos, Ponte
        // Contra Consigo -> Juego, Jugue, J, Voy, Ponte
        const evalConcrecion = evaluarConcrecionEstricta(
          texto,
          accionProp,
          remanenteDisponible,
          saldoDispAceptante,
          nombreJugador
        );

        if (!evalConcrecion.valido) {
          // Si no tenía saldo en absoluto
          if (saldoDispAceptante <= 0 && evalConcrecion.montoSolicitado > 0) {
            return NextResponse.json({
              ok: false,
              tipo: "SIN_SALDO",
              respuestaGrupo: `${nombreJugador} solo dispone de $0 para esta jugada.`,
              mensajePrivadoAutor: `"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo`,
            });
          }

          // Palabra no autorizada -> Enseñanza pedagógica en privado sin ensuciar el grupo
          return NextResponse.json({
            ok: false,
            tipo: "PEDAGOGICO",
            respuestaGrupo: null,
            mensajePrivadoAutor:
              evalConcrecion.motivoRechazo ||
              "Palabra no autorizada para concretar esta jugada.",
          });
        }

        // Determinar si el aceptante pidió más de lo que quedaba disponible en el remanente (ej. quedaban $10 de $100)
        const llenoRemanenteParcial =
          remanenteDisponible < Number(propFresca.monto_original || remanenteDisponible) ||
          evalConcrecion.montoSolicitado > remanenteDisponible;

        const montoEfectivo = evalConcrecion.montoEfectivo;
        const nuevoRemanente = Math.max(
          0,
          Number((remanenteDisponible - montoEfectivo).toFixed(2))
        );

        // Ejecutar RPC oficial `concretar_jugada_fifo_atomica`
        let rpcExitoso = false;
        try {
          const { data: resRpc, error: errRpc } = await supabaseAdmin.rpc(
            "concretar_jugada_fifo_atomica",
            {
              p_grupo_id: grupoId,
              p_sala_id: salaId,
              p_propuesta_msg_id: propFresca.id,
              p_aceptante_id: cliente.id,
              p_monto_pedido: montoEfectivo,
            }
          );
          if (!errRpc && resRpc && (resRpc as any).ok !== false) {
            rpcExitoso = true;
          }
        } catch {
          rpcExitoso = false;
        }

        // Fallback atómico si el RPC no está activo en la instancia
        if (!rpcExitoso) {
          if (!aceptanteFresco?.libre) {
            const nuevoRetenido = Number(
              (Number(aceptanteFresco?.saldo_retenido || 0) + montoEfectivo).toFixed(2)
            );
            await supabaseAdmin
              .from("clientes")
              .update({
                saldo_retenido: nuevoRetenido,
                saldo_disponible: Math.max(
                  0,
                  Number(
                    (
                      Number(aceptanteFresco?.saldo_actual || 0) +
                      Number(aceptanteFresco?.aval || 0) -
                      nuevoRetenido
                    ).toFixed(2)
                  )
                ),
              })
              .eq("id", cliente.id);
          }

          await supabaseAdmin
            .from("chat_mensajes")
            .update({
              monto_disponible: nuevoRemanente,
              estado_propuesta: nuevoRemanente <= 0 ? "cerrada" : "parcial",
            })
            .eq("id", propFresca.id);

          const codigoTicket = `WA-${Date.now().toString().slice(-6)}`;
          const firma = crypto
            .createHash("sha256")
            .update(
              `${codigoTicket}:${propFresca.remitente_id}:${cliente.id}:${montoEfectivo}:${Date.now()}`
            )
            .digest("hex");

          await supabaseAdmin.from("chat_tickets_fifo").insert({
            grupo_id: grupoId,
            sala_id: salaId,
            propuesta_msg_id: propFresca.id,
            codigo_ticket: codigoTicket,
            proponente_id: propFresca.remitente_id,
            proponente_nombre: propFresca.remitente_nombre,
            aceptante_id: cliente.id,
            aceptante_nombre: nombreJugador,
            carrera_id: propFresca.carrera_id || sala.carrera_activa_id,
            accion_proponente: accionProp,
            es_match: Boolean(propFresca.es_match),
            modalidad: propFresca.modalidad_jugada || "1P",
            ejemplar_numero:
              propFresca.ejemplar_numero || (propFresca.caballos_bando_a?.[0] ?? "1"),
            caballos_bando_a: propFresca.caballos_bando_a || [],
            caballos_bando_b: propFresca.caballos_bando_b || [],
            monto_concretado: montoEfectivo,
            estado: "ABIERTO",
            firma_sha256: firma,
          });
        }

        await sincronizarTicketsPropuestaATaquilla(supabaseAdmin, {
          propuestaMsgId: propFresca.id,
          sala,
          grupoId,
          condicionProponente: propFresca.condicion_proponente,
        });

        // Obtener datos de contacto del proponente para notificación privada a ambos jugadores
        const { data: proponenteRow } = await supabaseAdmin
          .from("clientes")
          .select("id, nombre, whatsapp_jid, telefono, telefono_normalizado")
          .eq("id", propFresca.remitente_id)
          .maybeSingle();

        const jugadaTexto = propFresca.jugada_estandarizada || propFresca.contenido;
        let respuestaGrupo = "";
        let mensajePrivadoAutor = "";

        if (evalConcrecion.excedioSaldo) {
          // Regla estricta: si el aceptante supera su saldo
          respuestaGrupo = `Esta jugada solo por $${formatearMontoRegional(saldoDispAceptante)} — *Aquí Jugaron*`;
          mensajePrivadoAutor = `"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo`;
        } else if (llenoRemanenteParcial && nuevoRemanente === 0) {
          // Regla estricta: si llena un remanente parcial (ej. quedaban $10 de $100)
          respuestaGrupo =
            `Solo quedaban $${formatearMontoRegional(remanenteDisponible)} disponibles en esta jugada — *Aquí Jugaron*\n` +
            `✅ *${nombreJugador}* completó los últimos *$${formatearMontoRegional(montoEfectivo)}* con *${propFresca.remitente_nombre}* (${jugadaTexto}). ¡Jugada 100% pactada!`;
          mensajePrivadoAutor =
            `✅ *Confirmación de Jugada*: Tomaste el remanente final de *$${formatearMontoRegional(montoEfectivo)}* contra *${propFresca.remitente_nombre}* en *${jugadaTexto}*.`;
        } else {
          respuestaGrupo =
            `🤝 *Aquí Jugaron* — *${nombreJugador}* jugó *$${formatearMontoRegional(montoEfectivo)}* con *${propFresca.remitente_nombre}* (${jugadaTexto}).` +
            (nuevoRemanente > 0
              ? `\n⏳ Quedan *$${formatearMontoRegional(nuevoRemanente)}* disponibles en esta parada.`
              : `\n✅ ¡Parada completada al 100%!`);
          mensajePrivadoAutor =
            `✅ *Confirmación de Jugada*: Pactaste *$${formatearMontoRegional(montoEfectivo)}* contra *${propFresca.remitente_nombre}* en *${jugadaTexto}*.`;
        }

        const mensajePrivadoProponente =
          `🔔 *Confirmación de Jugada*: *${nombreJugador}* tomó *$${formatearMontoRegional(montoEfectivo)}* de tu propuesta (*${jugadaTexto}*). ` +
          (nuevoRemanente > 0
            ? `Quedan *$${formatearMontoRegional(nuevoRemanente)}* disponibles.`
            : `¡Tu jugada de $${formatearMontoRegional(Number(propFresca.monto_original || montoEfectivo))} fue completada al 100%!`);

        // Registrar mensaje de concreción en chat_mensajes
        await supabaseAdmin.from("chat_mensajes").insert({
          grupo_id: grupoId,
          sala_id: salaId,
          remitente_id: cliente.id,
          remitente_nombre: nombreJugador,
          es_operador: false,
          tipo_mensaje: "CONCRECION",
          contenido: respuestaGrupo,
          reply_to_msg_id: propFresca.id,
          whatsapp_msg_id: whatsappMsgId,
          whatsapp_quoted_msg_id: quotedMsgId,
          origen_canal: "whatsapp",
          carrera_id: propFresca.carrera_id || sala.carrera_activa_id,
        });

        await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

        return NextResponse.json({
          ok: true,
          tipo: "CONCRECION",
          respuestaGrupo,
          mensajePrivadoAutor,
          mensajePrivadoProponente,
          proponenteJid:
            proponenteRow?.whatsapp_jid ||
            proponenteRow?.telefono_normalizado ||
            proponenteRow?.telefono ||
            null,
          datos: {
            propuestaId: propFresca.id,
            montoConcretado: montoEfectivo,
            remanenteDisponible: nuevoRemanente,
            excedioSaldo: evalConcrecion.excedioSaldo,
          },
        });
      });
    }

    // ========================================================================
    // FLUJO B: MENSAJE SIN CITAR -> RETIRO DE PARADA ("Se fue") O PROPUESTA NUEVA
    // ========================================================================
    const comandoRetiro = analizarComandoRetiro(texto);
    if (comandoRetiro.esComandoRetiro) {
      if (!comandoRetiro.esValido) {
        return NextResponse.json({
          ok: false,
          tipo: "PEDAGOGICO",
          respuestaGrupo: null,
          mensajePrivadoAutor:
            comandoRetiro.mensajeAclaratoria ||
            "Por favor aclara si deseas retirar tus jugadas con: 'Se fue' o 'sf'",
        });
      }

      const { data: abiertas } = await supabaseAdmin
        .from("chat_mensajes")
        .select("id, monto_disponible")
        .eq("sala_id", salaId)
        .eq("remitente_id", cliente.id)
        .in("estado_propuesta", ["abierta", "parcial"])
        .gt("monto_disponible", 0);

      let liberado = 0;
      for (const p of abiertas || []) {
        liberado += Number(p.monto_disponible || 0);
        await supabaseAdmin
          .from("chat_mensajes")
          .update({ estado_propuesta: "cerrada", monto_disponible: 0 })
          .eq("id", p.id);
      }

      if (!cliente.libre && liberado > 0) {
        const nuevoRet = Math.max(0, Number((Number(cliente.saldo_retenido || 0) - liberado).toFixed(2)));
        await supabaseAdmin
          .from("clientes")
          .update({
            saldo_retenido: nuevoRet,
            saldo_disponible: Math.max(
              0,
              Number((Number(cliente.saldo_actual || 0) + Number(cliente.aval || 0) - nuevoRet).toFixed(2))
            ),
          })
          .eq("id", cliente.id);
      }

      await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

      return NextResponse.json({
        ok: true,
        tipo: "RETIRO_PROPUESTAS",
        respuestaGrupo: null,
        mensajePrivadoAutor: `✅ Tus propuestas abiertas fueron cerradas ("Se fue"). Saldo liberado: $${formatearMontoRegional(liberado)}.`,
      });
    }

    // Analizar con `analizarYEstandarizarJugada` de `parser-pedagogico.ts`
    const retirados = Array.isArray(sala.retirados) ? sala.retirados : [];
    const analisis = analizarYEstandarizarJugada(
      texto,
      saldoDisponible,
      retirados,
      16,
      nombreJugador
    );

    // Si no tiene intención de jugada, ignorar para no ensuciar el grupo
    if (!analisis.esIntencionDeJugada) {
      return NextResponse.json({
        ok: true,
        tipo: "CHARLA",
        respuestaGrupo: null,
        mensajePrivadoAutor: null,
      });
    }

    // Caso: Publicó jugada por encima de su saldo y tiene $0 disponible
    if (!analisis.valido && analisis.excedioSaldo) {
      return NextResponse.json({
        ok: false,
        tipo: "EXCESO_SALDO",
        respuestaGrupo: `${nombreJugador} solo dispone de $${formatearMontoRegional(saldoDisponible)} para esta jugada.`,
        mensajePrivadoAutor: `"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo`,
      });
    }

    // Caso: Enseñanza Pedagógica en Privado (mal escrita: falta Condición, Ejemplar, Jugada o Monto)
    if (!analisis.valido) {
      return NextResponse.json({
        ok: false,
        tipo: "PEDAGOGICO",
        respuestaGrupo: null,
        mensajePrivadoAutor:
          analisis.mensajePedagogicoPrivado ||
          `🤖 Corrección Pedagógica: Para publicar una jugada indica Condición (Juego/Consigo), Jugada, Ejemplar y Monto. Ejemplo: Juego 1P 5 100`,
      });
    }

    if (!carreraAbierta) {
      return NextResponse.json({
        ok: false,
        tipo: "CARRERA_CERRADA",
        respuestaGrupo: `⛔ La carrera está ${String(sala.estado_carrera || "CERRADA").toUpperCase()}. No se reciben nuevas propuestas.`,
        mensajePrivadoAutor: null,
      });
    }

    // Determinar monto a publicar (topado a saldoDisponible si excedió su saldo)
    const excedioSaldo = Boolean(analisis.excedioSaldo || analisis.monto > saldoDisponible);
    const montoAPublicar = excedioSaldo
      ? Math.max(0, Number(saldoDisponible.toFixed(2)))
      : Number(analisis.monto);

    let propId: string | null = null;
    let rpcPublicado = false;

    // Llamar a `publicar_propuesta_atomica` según especificación
    try {
      const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc(
        "publicar_propuesta_atomica",
        {
          p_grupo_id: grupoId,
          p_sala_id: salaId,
          p_carrera_id: sala.carrera_activa_id || "00000000-0000-0000-2026-111400000001",
          p_jugador_id: cliente.id,
          p_accion: analisis.accionProponente,
          p_es_match: analisis.esMatch,
          p_modalidad: analisis.modalidad,
          p_caballos_a: analisis.caballosBandoA,
          p_caballos_b: analisis.caballosBandoB,
          p_ejemplar_texto: analisis.ejemplarTexto,
          p_proporcion: "1x1",
          p_monto_solicitado: analisis.monto,
          p_texto_estandarizado: analisis.jugadaEstandarizada,
        }
      );

      if (!rpcErr && rpcRes && (rpcRes as any).propuesta_id) {
        propId = (rpcRes as any).propuesta_id;
        rpcPublicado = true;
      }
    } catch {
      rpcPublicado = false;
    }

    if (rpcPublicado && propId) {
      await supabaseAdmin
        .from("chat_mensajes")
        .update({
          whatsapp_msg_id: whatsappMsgId,
          origen_canal: "whatsapp",
        })
        .eq("id", propId);
    } else if (montoAPublicar > 0) {
      // Fallback atómico en chat_mensajes + retención de saldo en clientes
      if (!cliente.libre) {
        const nuevoRet = Number((Number(cliente.saldo_retenido || 0) + montoAPublicar).toFixed(2));
        await supabaseAdmin
          .from("clientes")
          .update({
            saldo_retenido: nuevoRet,
            saldo_disponible: Math.max(
              0,
              Number((Number(cliente.saldo_actual || 0) + Number(cliente.aval || 0) - nuevoRet).toFixed(2))
            ),
          })
          .eq("id", cliente.id);
      }

      const firma = crypto
        .createHash("sha256")
        .update(`PROPUESTA_WA:${salaId}:${cliente.id}:${montoAPublicar}:${Date.now()}`)
        .digest("hex");

      const { data: insertada } = await supabaseAdmin
        .from("chat_mensajes")
        .insert({
          grupo_id: grupoId,
          sala_id: salaId,
          remitente_id: cliente.id,
          remitente_nombre: nombreJugador,
          es_operador: false,
          tipo_mensaje: "propuesta_jugada",
          contenido: analisis.jugadaEstandarizada,
          carrera_id: sala.carrera_activa_id || null,
          accion_proponente: analisis.accionProponente,
          es_match: analisis.esMatch,
          modalidad_jugada: analisis.modalidad,
          ejemplar_numero: analisis.ejemplarTexto,
          caballos_bando_a: analisis.caballosBandoA,
          caballos_bando_b: analisis.caballosBandoB,
          jugada_estandarizada: analisis.jugadaEstandarizada,
          monto_original: montoAPublicar,
          monto_disponible: montoAPublicar,
          estado_propuesta: "abierta",
          proporcion_premio: "1x1",
          firma_sha256: firma,
          whatsapp_msg_id: whatsappMsgId,
          origen_canal: "whatsapp",
        })
        .select("id")
        .maybeSingle();

      propId = insertada?.id || null;
    }

    await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

    // Si publicó por encima de su saldo_disponible, devolver los textos exactos requeridos
    if (excedioSaldo) {
      return NextResponse.json({
        ok: true,
        tipo: "PROPUESTA_CON_RECORTE_SALDO",
        propuestaId: propId,
        respuestaGrupo: `${nombreJugador} solo dispone de $${formatearMontoRegional(saldoDisponible)} para esta jugada.`,
        mensajePrivadoAutor: `"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo`,
      });
    }

    return NextResponse.json({
      ok: true,
      tipo: "PROPUESTA",
      propuestaId: propId,
      jugadaEstandarizada: analisis.jugadaEstandarizada,
      montoPublicado: montoAPublicar,
      respuestaGrupo: null,
      mensajePrivadoAutor: null,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || "Error interno en /api/whatsapp-sala/procesar",
        respuestaGrupo: null,
        mensajePrivadoAutor: null,
      },
      { status: 500 }
    );
  }
}
