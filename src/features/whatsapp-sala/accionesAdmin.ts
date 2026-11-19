import fs from "fs";
import path from "path";
import { supabaseAdmin } from "@/core/supabase-admin";
import { formatearMontoRegional } from "@/shared/lib/dinero";
import {
  cargarPlantillasGrupo,
  obtenerPlantillaGrupo,
} from "@/features/whatsapp/lib/plantillas-grupo-server";
import { variablesEncabezadoGrupo } from "@/features/whatsapp/lib/plantillas-grupo";
import { encabezadoGrupo } from "@/features/whatsapp/lib/encabezados-grupo";
import { emitirBroadcastSala, respuestaSala } from "./notificador";
import { obtenerSalasUnicas, recordarCodigoSala } from "./resolverSala";
import { logicaGanancias } from "@/features/motores/lib/puestos";
import { calcularRiesgoReal } from "@/features/sala-juegos/lib/parser-pedagogico";
import {
  actualizarTicketEspejoLiquidado,
  anularTicketsEspejoSala,
  revertirTicketsEspejoSala,
} from "@/features/whatsapp-sala/lib/sincronizar-tickets-sala";
import { cerrarParadasAbiertasDeSala } from "./concretarJugada";
import { obtenerSecretoInternoBot } from "./lib/bot-secret";
import type { RespaldoSalaDesconectada, ResultadoSentencia } from "./types";

const BOT_DAEMON_URL = process.env.WHATSAPP_BOT_URL || "http://127.0.0.1:3005";

const AUTH_DIR_WHATSAPP =
  process.env.WHATSAPP_AUTH_DIR ||
  (process.platform === "linux"
    ? "/root/sistema_hipico/whatsapp_auth"
    : path.join(process.cwd(), "whatsapp_auth"));
const ARCHIVO_SALAS_DESCONECTADAS = path.join(AUTH_DIR_WHATSAPP, "salas_desconectadas.json");

export function leerRespaldoDesconectadas(): Record<string, RespaldoSalaDesconectada> {
  try {
    if (!fs.existsSync(ARCHIVO_SALAS_DESCONECTADAS)) return {};
    const crudo = fs.readFileSync(ARCHIVO_SALAS_DESCONECTADAS, "utf8");
    const parseado = JSON.parse(crudo);
    return parseado && typeof parseado === "object" && !Array.isArray(parseado)
      ? parseado
      : {};
  } catch {
    return {};
  }
}

export function escribirRespaldoDesconectadas(
  datos: Record<string, RespaldoSalaDesconectada>
): void {
  try {
    fs.mkdirSync(AUTH_DIR_WHATSAPP, { recursive: true });
    fs.writeFileSync(
      ARCHIVO_SALAS_DESCONECTADAS,
      JSON.stringify(datos, null, 2),
      "utf8"
    );
  } catch {
    // El respaldo en disco es best-effort; no debe romper la acción.
  }
}

export async function generarTextoPlanoOficial(
  sala: any,
  tickets: any[],
  propsAbiertas: any[] = [],
  retirados: string[] = []
): Promise<string> {
  const diasSemana = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const meses = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ];
  const now = new Date();
  const fechaStr = `${diasSemana[now.getDay()]}, ${now.getDate()} de ${meses[now.getMonth()]} de ${now.getFullYear()}`;

  const hipo = String(sala.hipodromo_activo || "La Rinconada").trim();
  const numCarrera = sala.numero_carrera_activa || 1;
  const ordCarrera = `${numCarrera}era`;

  const retiradosStr =
    Array.isArray(retirados) && retirados.length > 0
      ? retirados.map((r) => `#${String(r).replace(/^#/, "")}`).join(", ")
      : "";

  const listaCasadas = (tickets || [])
    .map((t, idx) => {
      const proponente = t.proponente_nombre || "Jugador A";
      const aceptante = t.aceptante_nombre || "Jugador B";
      const accProp = String(t.accion_proponente || "JUEGA").trim().toUpperCase();
      const esConsigueProp = accProp === "CONSIGUE" || accProp === "CONSIGO" || accProp === "DA" || accProp === "DOY";
      const jugadorJuega = esConsigueProp ? aceptante : proponente;
      const jugadorDa = esConsigueProp ? proponente : aceptante;

      const prop = String(t.proporcion_premio || t.proporcion || "").trim();
      const tieneProp10 = /^10\s*[\/aAª@\-]\s*\d+(?:[.,]\d+)?$/i.test(prop) && !/^10\s*[\/aAª@\-]\s*10$/i.test(prop);
      const propCanon = tieneProp10 ? prop.toUpperCase().replace(/\s+/g, "").replace(/[aAª@\-]/g, "/").replace(",", ".") : "";

      let jugadaToken = "";
      let caballoToken = "";
      if (t.es_match || (Array.isArray(t.caballos_bando_b) && t.caballos_bando_b.length > 0)) {
        const bA = (t.caballos_bando_a || []).join("-") || t.ejemplar_numero || "1";
        const bB = (t.caballos_bando_b || []).join("-");
        caballoToken = `${bA}x${bB}`;
        jugadaToken = propCanon; // Si no hay proporción, "(3x5)" se clasifica como PP en Carga Rápida
      } else {
        const mod = String(t.modalidad || "1P").trim().toUpperCase();
        caballoToken = String(t.ejemplar_numero || (t.caballos_bando_a || []).join("-") || "1").trim();
        jugadaToken = propCanon || (mod === "MATCH" ? "PP" : mod);
      }
      const monto = formatearMontoRegional(Number(t.monto_concretado || 0));
      return `${idx + 1}) Juega ${jugadorJuega} ${jugadaToken ? `${jugadaToken} ` : ""}(${caballoToken}) con ${monto} da ${jugadorDa}`;
    })
    .join("\n");

  const lineasCasadas = listaCasadas || "_No hay jugadas concretadas en esta carrera._";

  const mapaPlantillas = await cargarPlantillasGrupo(sala?.grupo_id);
  const encabezadoPlano = obtenerPlantillaGrupo(
    mapaPlantillas,
    "plano_encabezado",
    {
      ...variablesEncabezadoGrupo(sala, "plano"),
      fecha: fechaStr,
      hipodromo: hipo,
      carrera: ordCarrera,
      retirados: retiradosStr || "—",
    },
    `${encabezadoGrupo(sala, "plano")}\n` +
      `${fechaStr}\n` +
      `${hipo}, ${ordCarrera} Carrera\n` +
      `Retirado: ${retiradosStr}`
  );

  let textoFinal =
    `${encabezadoPlano}\n\n` +
    `[Listado de jugadas y propuestas concretadas]\n` +
    `${lineasCasadas}`;

  if (propsAbiertas && propsAbiertas.length > 0) {
    const lineasProps = propsAbiertas
      .map((p) => {
        const det = p.jugada_estandarizada || p.contenido || "Propuesta";
        const disp = formatearMontoRegional(Number(p.monto_disponible || 0));
        return `• ${p.remitente_nombre}: ${det} (Disp: $${disp})`;
      })
      .join("\n");
    textoFinal += `\n\n[Propuestas abiertas en cola]\n${lineasProps}`;
  }

  const totalPactado = (tickets || []).reduce(
    (acc, t) => acc + Number(t.monto_concretado || 0),
    0
  );
  if (tickets && tickets.length > 0) {
    textoFinal += `\n\n💰 Total Casado: $${formatearMontoRegional(totalPactado)} (${tickets.length} tickets)`;
  }

  return textoFinal;
}

export async function construirResumenEstadoCuentaCliente(cliente: any, grupoId: string): Promise<string> {
  const nombreJugador = cliente.seudonimo || cliente.nombre || "Jugador";
  const saldoActual = Number(cliente.saldo_actual || 0);
  const aval = Number(cliente.aval || cliente.limite_credito || 0);
  const retenido = Number(cliente.saldo_retenido || 0);
  const disponible = cliente.libre ? 999999 : Math.max(0, Number((saldoActual + aval - retenido).toFixed(2)));

  const hoyStr = new Date().toISOString().split("T")[0];
  const inicioDia = `${hoyStr}T00:00:00.000Z`;

  const { data: ticketsHoy } = await supabaseAdmin
    .from("chat_tickets_fifo")
    .select("*")
    .eq("grupo_id", grupoId)
    .or(`proponente_id.eq.${cliente.id},aceptante_id.eq.${cliente.id}`)
    .gte("created_at", inicioDia);

  const lista = ticketsHoy || [];
  let ganadas = 0;
  let perdidas = 0;
  let empatadas = 0;
  let netoDia = 0;
  let vivasRiesgo = 0;
  let montoEnRiesgo = 0;

  for (const t of lista) {
    const estado = String(t.estado || "").toUpperCase();
    const esProponente = String(t.proponente_id) === String(cliente.id);
    const monto = Number(t.monto_concretado || 0);

    if (["PENDIENTE", "ACTIVO", "ABIERTO"].includes(estado)) {
      vivasRiesgo++;
      montoEnRiesgo += monto;
    } else if (estado === "GANADOR_PROPONENTE") {
      if (esProponente) {
        ganadas++;
        netoDia += monto;
      } else {
        perdidas++;
        netoDia -= monto;
      }
    } else if (estado === "GANADOR_ACEPTANTE") {
      if (!esProponente) {
        ganadas++;
        netoDia += monto;
      } else {
        perdidas++;
        netoDia -= monto;
      }
    } else if (estado === "EMPATE") {
      empatadas++;
    }
  }

  netoDia = Number(netoDia.toFixed(2));
  const signoNeto = netoDia >= 0 ? `+$${formatearMontoRegional(netoDia)}` : `-$${formatearMontoRegional(Math.abs(netoDia))}`;

  return (
    `💰 *ESTADO DE CUENTA ACTUAL*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 *Jugador:* ${nombreJugador}\n` +
    `💵 *Saldo Actual:* $${formatearMontoRegional(saldoActual)}\n` +
    `🛡️ *Aval / Crédito:* $${formatearMontoRegional(aval)}\n` +
    `⏳ *Retenido:* $${formatearMontoRegional(retenido)}\n` +
    `🟢 *Saldo Disponible:* $${formatearMontoRegional(disponible)}\n\n` +
    `📊 *RESUMEN DE OPERACIONES DEL DÍA*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🎯 *Jugadas Casadas Hoy:* ${lista.length}\n` +
    `🏆 *Ganadas:* ${ganadas}\n` +
    `❌ *Perdidas:* ${perdidas}\n` +
    `🤝 *Empatadas:* ${empatadas}\n` +
    `⚖️ *Neto del Día:* ${signoNeto}\n` +
    `⚠️ *Jugadas Vivas en Riesgo:* ${vivasRiesgo} ($${formatearMontoRegional(montoEnRiesgo)})`
  );
}

export async function intentarCruceAutomatico(params: {
  sala: any;
  grupoId: string;
  nuevaPropuestaId: string;
  nuevoCliente: any;
  analisis: any;
  groupJid?: string | null;
  whatsappGroupNombre?: string | null;
  whatsappMsgId?: string | null;
}) {
  const { sala, grupoId, nuevaPropuestaId, nuevoCliente, analisis, groupJid, whatsappGroupNombre, whatsappMsgId } = params;

  let queryInversas = supabaseAdmin
    .from("chat_mensajes")
    .select("*")
    .eq("sala_id", sala.id)
    .in("tipo_mensaje", ["propuesta_jugada", "PROPUESTA"])
    .in("estado_propuesta", ["abierta", "parcial"])
    .gt("monto_disponible", 0)
    .neq("remitente_id", nuevoCliente.id)
    .neq("id", nuevaPropuestaId)
    .order("created_at", { ascending: true })
    .limit(10);

  if (sala.carrera_activa_id) {
    queryInversas = queryInversas.or(`carrera_id.eq.${sala.carrera_activa_id},carrera_id.is.null`);
  }

  const { data: candidatas } = await queryInversas;
  if (!candidatas || candidatas.length === 0) return null;

  for (const cand of candidatas) {
    const candAccion = String(cand.accion_proponente || "").toUpperCase();
    const nuevaAccion = String(analisis.accionProponente || "").toUpperCase();
    let esCalce = false;

    if (analisis.esMatch && cand.es_match) {
      const candA = (cand.caballos_bando_a || []).join("-");
      const candB = (cand.caballos_bando_b || []).join("-");
      const nuevoA = (analisis.caballosBandoA || []).join("-");
      const nuevoB = (analisis.caballosBandoB || []).join("-");

      if (candA === nuevoB && candB === nuevoA && candAccion === nuevaAccion) {
        esCalce = true;
      } else if (candA === nuevoA && candB === nuevoB && candAccion !== nuevaAccion) {
        esCalce = true;
      }
    } else if (!analisis.esMatch && !cand.es_match) {
      const modCand = String(cand.modalidad_propuesta || cand.modalidad || "1P").toUpperCase();
      const modNueva = String(analisis.modalidad || "1P").toUpperCase();
      const ejCand = String(cand.ejemplar_texto || (cand.caballos_bando_a || [])[0] || "").trim();
      const ejNuevo = String(analisis.ejemplarTexto || (analisis.caballosBandoA || [])[0] || "").trim();

      if (modCand === modNueva && ejCand === ejNuevo && candAccion !== nuevaAccion) {
        esCalce = true;
      }
    }

    if (esCalce) {
      let modalidadStr = "";
      if (cand.es_match) {
        const bA = (cand.caballos_bando_a || []).join("-");
        const bB = (cand.caballos_bando_b || []).join("-");
        modalidadStr = `(${bA}x${bB})`;
      } else {
        const m = cand.modalidad_propuesta || cand.modalidad || "1P";
        const e = cand.ejemplar_texto || (cand.caballos_bando_a || [])[0] || "";
        modalidadStr = `${m} (${e})`.trim();
      }

      const j1 = cand.remitente_nombre || "Jugador 1";
      const j2 = nuevoCliente.seudonimo || nuevoCliente.nombre || "Jugador 2";
      const msgSugerencia = `⚠️ *${j1} y ${j2} pueden jugar ${modalidadStr} si se concretan.*`;

      await supabaseAdmin.from("chat_mensajes").insert({
        grupo_id: grupoId,
        sala_id: sala.id,
        remitente_nombre: "🤖 ASISTENTE DE SALA",
        es_operador: true,
        tipo_mensaje: "sugerencia_cruce",
        contenido: msgSugerencia,
        whatsapp_msg_id: whatsappMsgId || null,
        whatsapp_group_jid: groupJid || null,
        whatsapp_group_nombre: whatsappGroupNombre || null,
        origen_canal: "WHATSAPP",
      });

      await emitirBroadcastSala(sala.id, "nuevo_mensaje", { salaId: sala.id });

      return {
        ok: true,
        esSugerencia: true,
        msgPublico: msgSugerencia,
      };
    }
  }

  return null;
}

export async function liquidarYSentenciarCarreraPlataforma(params: {
  sala: any;
  pizarra: string;
  esRectificacion?: boolean;
  operadorNombre?: string;
  origenMsgId?: string | null;
}): Promise<ResultadoSentencia> {
  const { sala, pizarra, esRectificacion = false, operadorNombre = "Operador", origenMsgId = null } = params;
  const numeros = String(pizarra).match(/\b\d+[A-Za-z]?\b/g) || [];
  if (numeros.length === 0) {
    return {
      ok: false,
      textoResultado: "",
      positivos: [],
      negativos: [],
      pizarra: [],
      enviadoWhatsApp: false,
      error: "Formato de pizarra inválido (ej. 10.5.1.2.7)",
    };
  }

  const [p1, p2 = null, p3 = null, p4 = null, p5 = null] = numeros;
  const hipodromo = String(sala.hipodromo_activo || "La Rinconada").trim();
  const numCarrera = sala.numero_carrera_activa || 1;
  const ordCarrera = `${numCarrera}era`;
  const carreraId = sala.carrera_activa_id || sala.carrera_recien_cerrada_id || null;

  const diasSemana = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const meses = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ];
  const now = new Date();
  const fechaStr = `${diasSemana[now.getDay()]}, ${now.getDate()} de ${meses[now.getMonth()]} de ${now.getFullYear()}`;

  let retiradosStr = "";
  if (carreraId) {
    try {
      const { data: cRow } = await supabaseAdmin
        .from("carreras")
        .select("ejemplares_retirados")
        .eq("id", carreraId)
        .maybeSingle();
      if (cRow?.ejemplares_retirados && Array.isArray(cRow.ejemplares_retirados) && cRow.ejemplares_retirados.length > 0) {
        retiradosStr = cRow.ejemplares_retirados.map((r: any) => `#${String(r).replace(/^#/, "")}`).join(", ");
      }
    } catch {}
  }

  const { data: grupo } = await supabaseAdmin
    .from("grupos_venta")
    .select("permite_cruces, cruce_mismo_ejemplar, cruce_diferente_ejemplar, comision_default")
    .eq("id", sala.grupo_id)
    .maybeSingle();

  const permiteCruces = Boolean(
    grupo?.permite_cruces ?? (grupo?.cruce_mismo_ejemplar || grupo?.cruce_diferente_ejemplar) ?? true
  );
  const comisionPct = Number(grupo?.comision_default ?? 5);
  const porcComision = comisionPct / 100;

  // Si es rectificación, revertir primero cualquier asiento previo de esta carrera en la sala
  if (esRectificacion && sala.grupo_id) {
    try {
      const { data: movsPrevios } = await supabaseAdmin
        .from("libro_mayor_clientes")
        .select("id, cliente_id, tipo_movimiento, monto")
        .eq("grupo_id", sala.grupo_id)
        .eq("hipodromo", hipodromo)
        .eq("carrera", numCarrera)
        .in("tipo_movimiento", ["JUGADA_GANADA_NETO", "JUGADA_PERDIDA"]);

      if (movsPrevios && movsPrevios.length > 0) {
        const idsBorrar: string[] = [];
        for (const mov of movsPrevios) {
          idsBorrar.push(mov.id);
          const mVal = Number(mov.monto || 0);
          if (!mov.cliente_id || mVal <= 0) continue;
          const deltaRev = mov.tipo_movimiento === "JUGADA_GANADA_NETO" ? -mVal : mVal;
          const { data: clRev } = await supabaseAdmin
            .from("clientes")
            .select("saldo_actual, saldo_retenido, libre, aval")
            .eq("id", mov.cliente_id)
            .maybeSingle();
          if (clRev) {
            const sNuevo = Number((Number(clRev.saldo_actual || 0) + deltaRev).toFixed(2));
            const rAct = Number(clRev.saldo_retenido || 0);
            await supabaseAdmin
              .from("clientes")
              .update({
                saldo_actual: sNuevo,
                saldo_disponible: clRev.libre ? 999999 : Math.max(0, Number((sNuevo + Number(clRev.aval || 0) - rAct).toFixed(2))),
              })
              .eq("id", mov.cliente_id);
          }
        }
        await supabaseAdmin.from("libro_mayor_clientes").delete().in("id", idsBorrar);
      }
    } catch (errRevRect) {
      console.warn("[accionesAdmin] Aviso revirtiendo asientos previos en rectificación:", errRevRect);
    }
  }

  let queryTickets = supabaseAdmin
    .from("chat_tickets_fifo")
    .select("*")
    .eq("sala_id", sala.id)
    .in("estado", ["PENDIENTE", "ACTIVO", "ABIERTO", "GANADOR_PROPONENTE", "GANADOR_ACEPTANTE", "EMPATE"]);

  if (carreraId) {
    queryTickets = queryTickets.or(`carrera_id.eq.${carreraId},carrera_id.is.null`);
  }

  const { data: tickets } = await queryTickets;
  const listaTickets = tickets || [];

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

  for (const t of listaTickets) {
    asegurar(t.proponente_id, t.proponente_nombre);
    asegurar(t.aceptante_id, t.aceptante_nombre);

    const monto = Number(t.monto_concretado || 0);
    const accProp = String(t.accion_proponente || "JUEGA").trim().toUpperCase();
    const esJuegaProponente = accProp !== "CONSIGUE" && accProp !== "CONSIGO" && accProp !== "DA" && accProp !== "DOY";
    const accionCanon: "JUEGA" | "CONSIGUE" = esJuegaProponente ? "JUEGA" : "CONSIGUE";
    const propRaw = String(t.proporcion_premio || t.proporcion || "1x1").trim();

    const estabaActivo = ["PENDIENTE", "ACTIVO", "ABIERTO"].includes(String(t.estado || "").toUpperCase());
    if (estabaActivo) {
      balance[t.proponente_id].stake += calcularRiesgoReal(monto, propRaw, accionCanon, "PROPONENTE");
      balance[t.aceptante_id].stake += calcularRiesgoReal(monto, propRaw, accionCanon, "ACEPTANTE");
    }

    const bandoA =
      Array.isArray(t.caballos_bando_a) && t.caballos_bando_a.length > 0
        ? t.caballos_bando_a.filter(Boolean)
        : t.ejemplar_numero
        ? [String(t.ejemplar_numero)]
        : [];
    const bandoB = Array.isArray(t.caballos_bando_b) ? t.caballos_bando_b.filter(Boolean) : [];
    const esMatch = Boolean(t.es_match || (bandoA.length > 0 && bandoB.length > 0));
    const tieneProp10 = /^10\s*[\/aAª@\-]\s*\d+(?:[.,]\d+)?$/i.test(propRaw) && !/^10\s*[\/aAª@\-]\s*10$/i.test(propRaw);
    const propCanon = tieneProp10 ? propRaw.toUpperCase().replace(/\s+/g, "").replace(/[aAª@\-]/g, "/").replace(",", ".") : "";

    const caballoMotor = esMatch
      ? `${bandoA.join("-") || t.ejemplar_numero || "1"}X${bandoB.join("-")}`
      : String(t.ejemplar_numero || bandoA[0] || "1").trim();
    const modBase = String(t.modalidad || "1P").trim().toUpperCase();
    const jugadaMotor = esMatch
      ? propCanon || "PP"
      : propCanon || (modBase === "MATCH" ? "PP" : modBase);

    const resLg = logicaGanancias({
      jugada: jugadaMotor,
      caballo: caballoMotor,
      monto,
      pizarra: numeros,
      comisionPct,
    });

    const n1 = Number(resLg.netoJugador1 || 0);
    const n2 = Number(resLg.netoJugador2 || 0);
    const brutoJuega = n1 > 0 ? Math.abs(n2) : n1;
    const brutoDa = n2 > 0 ? Math.abs(n1) : n2;
    const comisionJuega = n1 > 0 ? Number((Math.abs(n2) - n1).toFixed(2)) : 0;
    const comisionDa = n2 > 0 ? Number((Math.abs(n1) - n2).toFixed(2)) : 0;
    const comisionTotal = Number((comisionJuega + comisionDa).toFixed(2));

    const brutoProp = esJuegaProponente ? brutoJuega : brutoDa;
    const brutoAcep = esJuegaProponente ? brutoDa : brutoJuega;
    const comisionProp = esJuegaProponente ? comisionJuega : comisionDa;
    const comisionAcep = esJuegaProponente ? comisionDa : comisionJuega;

    let nuevoEstado = "EMPATE";
    if (brutoProp > 0) {
      nuevoEstado = "GANADOR_PROPONENTE";
      balance[t.proponente_id].ganancias += brutoProp;
      balance[t.aceptante_id].perdidas += Math.abs(brutoAcep);
      balance[t.proponente_id].comisionInd += comisionProp;
    } else if (brutoProp < 0) {
      nuevoEstado = "GANADOR_ACEPTANTE";
      balance[t.aceptante_id].ganancias += brutoAcep;
      balance[t.proponente_id].perdidas += Math.abs(brutoProp);
      balance[t.aceptante_id].comisionInd += comisionAcep;
    }

    t.estado = nuevoEstado;
    await supabaseAdmin
      .from("chat_tickets_fifo")
      .update({ estado: nuevoEstado, updated_at: new Date().toISOString() })
      .eq("id", t.id);

    await actualizarTicketEspejoLiquidado(supabaseAdmin, {
      codigoTicket: t.codigo_ticket,
      accionProponente: t.accion_proponente,
      factor: monto > 0 ? brutoProp / monto : 0,
      monto,
      porcentajeComision: porcComision,
      netoClienteJuega: n1,
      comisionTotal,
      estadoTicket: brutoJuega > 0 ? "Ganador" : brutoJuega < 0 ? "Perdedor" : "Empate",
    });
  }

  const positivos: string[] = [];
  const negativos: string[] = [];

  for (const [jugadorId, b] of Object.entries(balance)) {
    let neto = 0;
    if (permiteCruces) {
      const bruto = b.ganancias - b.perdidas;
      neto = bruto > 0 ? bruto - bruto * porcComision : bruto;
    } else {
      neto = b.ganancias - b.comisionInd - b.perdidas;
    }
    neto = Number(neto.toFixed(2));

    if (jugadorId) {
      const { data: cl } = await supabaseAdmin
        .from("clientes")
        .select("saldo_actual, saldo_retenido, libre, aval")
        .eq("id", jugadorId)
        .maybeSingle();

      if (cl) {
        const nuevoSaldo = Number((Number(cl.saldo_actual || 0) + neto).toFixed(2));
        const nuevoRet = Math.max(0, Number((Number(cl.saldo_retenido || 0) - b.stake).toFixed(2)));
        await supabaseAdmin
          .from("clientes")
          .update({
            saldo_actual: nuevoSaldo,
            saldo_retenido: nuevoRet,
            saldo_disponible: cl.libre
              ? 999999
              : Math.max(0, Number((nuevoSaldo + Number(cl.aval || 0) - nuevoRet).toFixed(2))),
            updated_at: new Date().toISOString(),
          })
          .eq("id", jugadorId);

        if (neto > 0) {
          await supabaseAdmin.from("libro_mayor_clientes").insert({
            cliente_id: jugadorId,
            cliente_nombre: b.nombre,
            grupo_id: sala.grupo_id,
            tipo_movimiento: "JUGADA_GANADA_NETO",
            monto_centavos: Math.round(neto * 100),
            monto: neto,
            hipodromo,
            carrera: numCarrera,
            fecha_carrera: new Date().toISOString().split("T")[0],
            observacion: `Sentencia Oficial Sala ${sala.nombre_sala}`,
            creado_por: operadorNombre,
          });
        } else if (neto < 0) {
          const montoAbs = Math.abs(neto);
          await supabaseAdmin.from("libro_mayor_clientes").insert({
            cliente_id: jugadorId,
            cliente_nombre: b.nombre,
            grupo_id: sala.grupo_id,
            tipo_movimiento: "JUGADA_PERDIDA",
            monto_centavos: Math.round(montoAbs * 100),
            monto: montoAbs,
            hipodromo,
            carrera: numCarrera,
            fecha_carrera: new Date().toISOString().split("T")[0],
            observacion: `Sentencia Oficial Sala ${sala.nombre_sala}`,
            creado_por: operadorNombre,
          });
        }
      }
    }

    if (neto > 0) {
      positivos.push(`${b.nombre}: +$${formatearMontoRegional(neto)}`);
    } else if (neto < 0) {
      negativos.push(`${b.nombre}: -$${formatearMontoRegional(Math.abs(neto))}`);
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

  const bloqueResumenJugadas =
    listaTickets.length > 0
      ? listaTickets
          .map((t: any, idx: number) => {
            let detalle = "";
            if (t.es_match) {
              const bA = (t.caballos_bando_a || []).join("-");
              const bB = (t.caballos_bando_b || []).join("-");
              const prop = String(t.proporcion_premio || t.proporcion || "").trim();
              let propStr = "";
              if (prop && !["1x1", "pp", "10/10", "10a10", "10@10"].includes(prop.toLowerCase())) {
                propStr = ` [${prop.replace("@", "/").replace(/a/i, "/")}]`;
              }
              detalle = `(${bA}x${bB})${propStr}`;
            } else {
              const mod = t.modalidad || "1P";
              const ej = t.ejemplar_numero || (t.caballos_bando_a || []).join("-");
              detalle = `${mod} ${ej}`;
            }
            const montoStr = `$${formatearMontoRegional(Number(t.monto_concretado || 0))}`;
            const ganador =
              t.estado === "GANADOR_PROPONENTE"
                ? `✅ Gana ${t.proponente_nombre}`
                : t.estado === "GANADOR_ACEPTANTE"
                ? `✅ Gana ${t.aceptante_nombre}`
                : "🤝 Empate";
            return `${idx + 1}) *${t.proponente_nombre}* vs *${t.aceptante_nombre}* · ${detalle} · *${montoStr}* (${ganador})`;
          })
          .join("\n")
      : "_Sin jugadas concretadas en esta carrera._";

  const pizarraFormateada = numeros.map((n, i) => `${i + 1}º: #${n}`).join(" · ");
  const prefijoRectificado = esRectificacion ? "🔄 *PIZARRA RECTIFICADA OFICIALMENTE*\n\n" : "";

  const lineasPositivos = positivos.length > 0 ? positivos.join("\n") : "_Sin saldos positivos en esta carrera_";
  const lineasNegativos = negativos.length > 0 ? negativos.join("\n") : "_Sin saldos negativos en esta carrera_";

  const mapaPlantillasResultado = await cargarPlantillasGrupo(sala?.grupo_id);
  const cuerpoResultado = obtenerPlantillaGrupo(
    mapaPlantillasResultado,
    "resultado_liquidacion",
    {
      ...variablesEncabezadoGrupo(sala, "resultado"),
      fecha: fechaStr,
      hipodromo,
      carrera: ordCarrera,
      retirados: retiradosStr || "—",
      pizarra: pizarraFormateada,
      total_jugadas: listaTickets.length,
      resumen: bloqueResumenJugadas,
      positivos: lineasPositivos,
      negativos: lineasNegativos,
    },
    `${encabezadoGrupo(sala, "resultado")}\n` +
      `${fechaStr}\n` +
      `${hipodromo}, ${ordCarrera} Carrera\n` +
      `Retirado: ${retiradosStr}\n` +
      `📊 Pizarra Oficial: *${pizarraFormateada}*\n\n` +
      `📑 RESUMEN DE LIQUIDACIÓN (${listaTickets.length} JUGADAS):\n` +
      `${bloqueResumenJugadas}\n\n` +
      `🔄BALANCE TOTAL (Compensando Ganancias vs. Pérdidas antes de con cruces el monto total):\n` +
      `POSITIVOS\n` +
      `${lineasPositivos}\n` +
      `NEGATIVOS\n` +
      `${lineasNegativos}`
  );
  const textoResultado = `${prefijoRectificado}🏆 RESULTADO Y LIQUIDACIÓN OFICIAL\n${cuerpoResultado}`;

  await supabaseAdmin.from("chat_mensajes").insert({
    grupo_id: sala.grupo_id,
    sala_id: sala.id,
    remitente_nombre: "🤖 ASISTENTE DE SALA",
    es_operador: true,
    tipo_mensaje: "sistema",
    contenido: textoResultado,
    whatsapp_msg_id: origenMsgId || null,
    whatsapp_group_jid: sala.whatsapp_group_jid || null,
    whatsapp_group_nombre: sala.whatsapp_group_nombre || null,
    origen_canal: "WHATSAPP",
  });

  await emitirBroadcastSala(sala.id, "sentencia_oficial", {
    salaId: sala.id,
    pizarra: numeros,
    textoResultado,
  });

  let enviadoWhatsApp = false;
  if (sala.whatsapp_group_jid) {
    try {
      const rBot = await fetch(`${BOT_DAEMON_URL}/publicar-grupo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-bot-secret": obtenerSecretoInternoBot(),
        },
        body: JSON.stringify({
          groupJid: sala.whatsapp_group_jid,
          texto: textoResultado,
        }),
      });
      enviadoWhatsApp = rBot.ok;
    } catch {
      enviadoWhatsApp = false;
    }
  }

  return {
    ok: true,
    textoResultado,
    positivos,
    negativos,
    pizarra: numeros,
    enviadoWhatsApp,
  };
}

export async function obtenerEstadoDemonioYSalas(req: Request) {
  let estadoBot = {
    conectado: false,
    qrDataUrl: null as string | null,
    numeroVinculado: null as string | null,
    grupos: [] as Array<{ jid: string; nombre: string }>,
    daemonOnline: false,
    salasDesconectadas: {} as Record<string, RespaldoSalaDesconectada>,
  };

  const url = new URL(req.url);
  const forzar = url.searchParams.get("force") === "true";

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`${BOT_DAEMON_URL}/status${forzar ? "?force=true" : ""}`, {
      cache: "no-store",
      headers: { "x-internal-bot-secret": obtenerSecretoInternoBot() },
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
        salasDesconectadas:
          json.salasDesconectadas &&
          typeof json.salasDesconectadas === "object" &&
          !Array.isArray(json.salasDesconectadas)
            ? json.salasDesconectadas
            : {},
      };
    }
  } catch {
    // Si el demonio local en :3005 aún no está encendido, responder estado desconectado limpio
  }

  const respaldoDisco = leerRespaldoDesconectadas();
  estadoBot.salasDesconectadas = {
    ...respaldoDisco,
    ...estadoBot.salasDesconectadas,
  };

  let salas: any[] = [];
  try {
    salas = await obtenerSalasUnicas();
  } catch {
    salas = [];
  }

  let gruposEnriquecidos = estadoBot.grupos;
  try {
    const { data: vinculosActivos } = await supabaseAdmin
      .from("salas_whatsapp_grupos")
      .select("whatsapp_group_jid, whatsapp_group_nombre, sala_id, grupo_id, estado_conexion")
      .eq("activo", true);

    const { data: todasSalas } = await supabaseAdmin
      .from("salas_juego")
      .select("id, nombre_sala, grupo_id, whatsapp_group_jid")
      .eq("activa", true);

    const { data: gruposVenta } = await supabaseAdmin
      .from("grupos_venta")
      .select("id, nombre");

    const grupoNombreMap = new Map<string, string>();
    for (const g of gruposVenta || []) {
      if (g?.id) grupoNombreMap.set(String(g.id), String(g.nombre || ""));
    }

    const salaInfoMap = new Map<string, { id: string; nombre_sala: string; grupo_id: string; grupo_nombre: string }>();
    for (const s of todasSalas || []) {
      salaInfoMap.set(String(s.id), {
        id: String(s.id),
        nombre_sala: String(s.nombre_sala || ""),
        grupo_id: String(s.grupo_id || ""),
        grupo_nombre: grupoNombreMap.get(String(s.grupo_id)) || "",
      });
    }

    gruposEnriquecidos = (estadoBot.grupos || []).map((g) => {
      const vinc = (vinculosActivos || []).find((v: any) => v.whatsapp_group_jid === g.jid);
      let sInfo = vinc ? salaInfoMap.get(String(vinc.sala_id)) : null;

      if (!sInfo) {
        const sDirecta = (todasSalas || []).find((s: any) => s.whatsapp_group_jid === g.jid);
        if (sDirecta) {
          sInfo = salaInfoMap.get(String(sDirecta.id)) || null;
        }
      }

      const estaConectado = Boolean(sInfo);

      return {
        ...g,
        conectado: estaConectado,
        salaId: sInfo?.id || null,
        salaNombre: sInfo?.nombre_sala || null,
        grupoId: sInfo?.grupo_id || null,
        grupoNombre: sInfo?.grupo_nombre || null,
        estadoConexion: vinc?.estado_conexion || (estaConectado ? "conectado" : "desconectado"),
      };
    });

    const vinculosPorSalaId = new Map<string, any[]>();
    for (const v of vinculosActivos || []) {
      const sId = String(v.sala_id);
      if (!vinculosPorSalaId.has(sId)) vinculosPorSalaId.set(sId, []);
      vinculosPorSalaId.get(sId)!.push(v);
    }

    salas = (salas || []).map((s: any) => {
      const sVinculos = vinculosPorSalaId.get(String(s.id)) || [];
      const primerV = sVinculos[0];
      return {
        ...s,
        grupos_whatsapp: sVinculos,
        whatsapp_group_jid: s.whatsapp_group_jid || primerV?.whatsapp_group_jid || null,
        whatsapp_group_nombre: s.whatsapp_group_nombre || primerV?.whatsapp_group_nombre || null,
      };
    });
  } catch {
    // Si falla el enriquecimiento, conservar grupos originales
  }

  const metricasGrupos = {
    total: gruposEnriquecidos.length,
    conectados: gruposEnriquecidos.filter((g: any) => g.conectado).length,
    desconectados: gruposEnriquecidos.filter((g: any) => !g.conectado).length,
  };

  return respuestaSala({
    ok: true,
    ...estadoBot,
    grupos: gruposEnriquecidos,
    metricasGrupos,
    salas,
  });
}

export async function ejecutarAccionAdmin(body: any): Promise<any | null> {
  const accion = body?.accion;
  if (!accion) return null;

  if (accion === "abrir-carrera") {
    const { salaId, hipodromo, carrera } = body;
    if (!salaId) {
      return respuestaSala({ ok: false, error: "salaId es requerido" }, { status: 400 });
    }

    const hipoLimpio = String(hipodromo || "LA RINCONADA").toUpperCase().trim();
    const numCarrera = parseInt(carrera, 10) || 1;
    const ord = numCarrera === 1 ? "1ra" : numCarrera === 2 ? "2da" : numCarrera === 3 ? "3ra" : `${numCarrera}ta`;

    const { data: salaActualizada, error } = await supabaseAdmin
      .from("salas_juego")
      .update({
        hipodromo_activo: hipoLimpio,
        numero_carrera_activa: numCarrera,
        estado_carrera: "abierta",
        updated_at: new Date().toISOString(),
      })
      .eq("id", salaId)
      .select()
      .maybeSingle();

    if (error) {
      return respuestaSala({ ok: false, error: error.message }, { status: 500 });
    }

    const mapaApertura = await cargarPlantillasGrupo(salaActualizada?.grupo_id || salaId);
    const textoApertura = obtenerPlantillaGrupo(
      mapaApertura,
      "carrera_apertura",
      {
        ...variablesEncabezadoGrupo(salaActualizada, "apertura"),
        hipodromo: hipoLimpio,
        carrera: ord,
      },
      `${encabezadoGrupo(salaActualizada, "apertura")}\n` +
        `🏆🏇${hipoLimpio}, ${ord} Carrera🏆🏇\nCARRERA ABIERTA Y EN JUEGO\nMucha suerte a todos.`
    );

    if (salaActualizada?.grupo_id) {
      await supabaseAdmin.from("chat_mensajes").insert({
        grupo_id: salaActualizada.grupo_id,
        sala_id: salaId,
        remitente_nombre: "Operador de Sala",
        es_operador: true,
        tipo_mensaje: "ESTADO_CARRERA",
        contenido: textoApertura,
        whatsapp_group_jid: salaActualizada.whatsapp_group_jid || null,
        origen_canal: "WEB",
        eliminado: false,
      });
    }

    let enviadoWhatsApp = false;
    if (salaActualizada?.whatsapp_group_jid) {
      try {
        const rBot = await fetch(`${BOT_DAEMON_URL}/publicar-grupo`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": obtenerSecretoInternoBot(),
          },
          body: JSON.stringify({
            groupJid: salaActualizada.whatsapp_group_jid,
            texto: textoApertura,
          }),
        });
        enviadoWhatsApp = rBot.ok;
      } catch {
        enviadoWhatsApp = false;
      }
    }

    await emitirBroadcastSala(salaId, "carrera_abierta", {
      salaId,
      hipodromo: hipoLimpio,
      carrera: numCarrera,
    });
    await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

    return respuestaSala({
      ok: true,
      sala: salaActualizada,
      textoApertura,
      enviadoWhatsApp,
    });
  }

  if (accion === "cerrar-carrera") {
    const { salaId } = body;
    if (!salaId) {
      return respuestaSala({ ok: false, error: "salaId es requerido" }, { status: 400 });
    }

    const { data: salaPrevia } = await supabaseAdmin
      .from("salas_juego")
      .select("*")
      .eq("id", salaId)
      .maybeSingle();

    const { data: salaActualizada, error } = await supabaseAdmin
      .from("salas_juego")
      .update({
        estado_carrera: "cerrada",
        carrera_recien_cerrada_id: salaPrevia?.carrera_activa_id || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", salaId)
      .select()
      .maybeSingle();

    if (error) {
      return respuestaSala({ ok: false, error: error.message }, { status: 500 });
    }

    // Al cerrar la carrera se van todas las paradas abiertas de la sala
    await cerrarParadasAbiertasDeSala(salaId, salaActualizada?.grupo_id || salaPrevia?.grupo_id || null);

    const hipo = String(salaActualizada?.hipodromo_activo || "HIPÓDROMO").toUpperCase();
    const numCarrera = salaActualizada?.numero_carrera_activa || 1;
    const ord = numCarrera === 1 ? "1ra" : numCarrera === 2 ? "2da" : numCarrera === 3 ? "3ra" : `${numCarrera}ta`;

    const mapaCierre = await cargarPlantillasGrupo(salaActualizada?.grupo_id || salaPrevia?.grupo_id || salaId);
    const textoCierre = obtenerPlantillaGrupo(
      mapaCierre,
      "carrera_cierre",
      {
        ...variablesEncabezadoGrupo(salaActualizada || salaPrevia, "cierre"),
        hipodromo: hipo,
        carrera: ord,
      },
      `${encabezadoGrupo(salaActualizada || salaPrevia, "cierre")}\n` +
        `${hipo}, ${ord} Carrera\nCARRERA CERRADA\n\nPUEDE ESCRIBIR LA PIZARRA: LLEGADA: 1RO.2DO.3RO.4TO.5TO`
    );

    if (salaActualizada?.grupo_id) {
      await supabaseAdmin.from("chat_mensajes").insert({
        grupo_id: salaActualizada.grupo_id,
        sala_id: salaId,
        remitente_nombre: "Operador de Sala",
        es_operador: true,
        tipo_mensaje: "ESTADO_CARRERA",
        contenido: textoCierre,
        whatsapp_group_jid: salaActualizada.whatsapp_group_jid || null,
        origen_canal: "WEB",
        eliminado: false,
      });
    }

    let enviadoWhatsApp = false;
    if (salaActualizada?.whatsapp_group_jid) {
      try {
        const rBot = await fetch(`${BOT_DAEMON_URL}/publicar-grupo`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": obtenerSecretoInternoBot(),
          },
          body: JSON.stringify({
            groupJid: salaActualizada.whatsapp_group_jid,
            texto: textoCierre,
          }),
        });
        enviadoWhatsApp = rBot.ok;
      } catch {
        enviadoWhatsApp = false;
      }
    }

    await emitirBroadcastSala(salaId, "carrera_cerrada", { salaId });
    await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

    return respuestaSala({
      ok: true,
      sala: salaActualizada,
      textoCierre,
      enviadoWhatsApp,
    });
  }

  if (accion === "vincular-sala") {
    const { salaId, groupJid, groupNombre } = body;
    if (!salaId) {
      return respuestaSala({ ok: false, error: "salaId es requerido" }, { status: 400 });
    }

    const updatePayload: Record<string, any> = {
      whatsapp_group_jid: groupJid || null,
      updated_at: new Date().toISOString(),
    };
    if (!groupJid) {
      updatePayload.whatsapp_group_nombre = null;
    } else if (groupNombre) {
      updatePayload.whatsapp_group_nombre = groupNombre;
    }

    const { data: salaActualizada, error } = await supabaseAdmin
      .from("salas_juego")
      .update(updatePayload)
      .eq("id", salaId)
      .select()
      .maybeSingle();

    if (error) {
      return respuestaSala({ ok: false, error: error.message }, { status: 500 });
    }

    try {
      await fetch(`${BOT_DAEMON_URL}/vincular-sala`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-bot-secret": obtenerSecretoInternoBot(),
        },
        body: JSON.stringify({ salaId, groupJid, groupNombre }),
      });
    } catch {
      // Demonio offline, pero ya quedó guardado en Supabase
    }

    const respaldo = leerRespaldoDesconectadas();
    if (respaldo[salaId]) {
      delete respaldo[salaId];
      escribirRespaldoDesconectadas(respaldo);
    }

    return respuestaSala({
      ok: true,
      sala: salaActualizada,
      groupJid: groupJid || null,
      groupNombre: groupNombre || null,
    });
  }

  if (accion === "desconectar-sala") {
    const { salaId } = body;
    if (!salaId) {
      return respuestaSala({ ok: false, error: "salaId es requerido" }, { status: 400 });
    }

    let groupJid: string | null = null;
    let groupNombre: string | null = null;

    try {
      const rBot = await fetch(`${BOT_DAEMON_URL}/desconectar-sala`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-bot-secret": obtenerSecretoInternoBot(),
        },
        body: JSON.stringify({ salaId }),
      });
      const json = await rBot.json().catch(() => ({}));
      if (rBot.ok && json?.ok) {
        return respuestaSala({
          ok: true,
          salaId,
          desconectado: true,
          puedeReconectar: Boolean(json.puedeReconectar),
          groupJid: json.groupJid || null,
          groupNombre: json.groupNombre || null,
          viaDaemon: true,
        });
      }
      groupJid = json?.groupJid || null;
      groupNombre = json?.groupNombre || null;
    } catch {
      // Fallback directo
    }

    const { data: sala, error: errorLectura } = await supabaseAdmin
      .from("salas_juego")
      .select("id, whatsapp_group_jid, whatsapp_group_nombre")
      .eq("id", salaId)
      .maybeSingle();

    if (errorLectura) {
      return respuestaSala({ ok: false, error: errorLectura.message }, { status: 500 });
    }
    if (!sala) {
      return respuestaSala({ ok: false, error: "Sala no encontrada" }, { status: 404 });
    }

    const respaldoActual = leerRespaldoDesconectadas();
    const jidRespaldo = groupJid || sala.whatsapp_group_jid || respaldoActual[salaId]?.groupJid || null;
    const nombreRespaldo =
      groupNombre || sala.whatsapp_group_nombre || respaldoActual[salaId]?.groupNombre || null;

    if (jidRespaldo) {
      respaldoActual[salaId] = {
        groupJid: jidRespaldo,
        groupNombre: nombreRespaldo,
        desconectadoEn: new Date().toISOString(),
      };
      escribirRespaldoDesconectadas(respaldoActual);
    }

    const { error } = await supabaseAdmin
      .from("salas_juego")
      .update({
        whatsapp_group_jid: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", salaId);

    if (error) {
      return respuestaSala({ ok: false, error: error.message }, { status: 500 });
    }

    return respuestaSala({
      ok: true,
      salaId,
      desconectado: true,
      puedeReconectar: Boolean(jidRespaldo),
      groupJid: jidRespaldo,
      groupNombre: nombreRespaldo,
      viaDaemon: false,
    });
  }

  if (accion === "reconectar-sala") {
    const { salaId, groupJid, groupNombre } = body;
    if (!salaId) {
      return respuestaSala({ ok: false, error: "salaId es requerido" }, { status: 400 });
    }

    try {
      const rBot = await fetch(`${BOT_DAEMON_URL}/reconectar-sala`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-bot-secret": obtenerSecretoInternoBot(),
        },
        body: JSON.stringify({ salaId, groupJid, groupNombre }),
      });
      const json = await rBot.json().catch(() => ({}));
      if (rBot.ok && json?.ok) {
        return respuestaSala({
          ok: true,
          salaId,
          reconectado: true,
          groupJid: json.groupJid || null,
          groupNombre: json.groupNombre || null,
          viaDaemon: true,
        });
      }
    } catch {
      // Fallback directo
    }

    const { data: sala, error: errorLectura } = await supabaseAdmin
      .from("salas_juego")
      .select("id, whatsapp_group_jid, whatsapp_group_nombre")
      .eq("id", salaId)
      .maybeSingle();

    if (errorLectura) {
      return respuestaSala({ ok: false, error: errorLectura.message }, { status: 500 });
    }
    if (!sala) {
      return respuestaSala({ ok: false, error: "Sala no encontrada" }, { status: 404 });
    }

    const respaldoActual = leerRespaldoDesconectadas();
    const respaldoSala = respaldoActual[salaId] || {};
    const jidFinal =
      groupJid || sala.whatsapp_group_jid || respaldoSala.groupJid || null;
    const nombreFinal =
      groupNombre || sala.whatsapp_group_nombre || respaldoSala.groupNombre || null;

    if (!jidFinal) {
      return respuestaSala(
        {
          ok: false,
          error:
            "No hay un grupo de WhatsApp guardado para esta sala. Vincúlala de nuevo desde el selector.",
        },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("salas_juego")
      .update({
        whatsapp_group_jid: jidFinal,
        whatsapp_group_nombre: nombreFinal,
        updated_at: new Date().toISOString(),
      })
      .eq("id", salaId);

    if (error) {
      return respuestaSala({ ok: false, error: error.message }, { status: 500 });
    }

    if (respaldoActual[salaId]) {
      delete respaldoActual[salaId];
      escribirRespaldoDesconectadas(respaldoActual);
    }

    return respuestaSala({
      ok: true,
      salaId,
      reconectado: true,
      groupJid: jidFinal,
      groupNombre: nombreFinal,
      viaDaemon: false,
    });
  }

  if (accion === "ping-grupo") {
    const { groupJid } = body;
    if (!groupJid) {
      return respuestaSala({ ok: false, error: "groupJid es requerido" }, { status: 400 });
    }

    try {
      const rBot = await fetch(`${BOT_DAEMON_URL}/ping-grupo?groupJid=${encodeURIComponent(groupJid)}`, {
        method: "GET",
        headers: {
          "x-internal-bot-secret": obtenerSecretoInternoBot(),
        },
        signal: AbortSignal.timeout(6000),
      });
      const json = await rBot.json().catch(() => ({}));
      return respuestaSala(json, { status: rBot.status });
    } catch (errPing: any) {
      return respuestaSala({
        ok: false,
        conectado: false,
        latenciaMs: 0,
        error: errPing?.message || "Daemon offline o no respondió",
      });
    }
  }

  if (accion === "publicar-plano") {
    const { salaId } = body;
    if (!salaId) {
      return respuestaSala({ ok: false, error: "salaId es requerido" }, { status: 400 });
    }

    const { data: sala } = await supabaseAdmin
      .from("salas_juego")
      .select("*")
      .eq("id", salaId)
      .maybeSingle();

    if (!sala) {
      return respuestaSala({ ok: false, error: "Sala no encontrada" }, { status: 404 });
    }

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

    let qProps = supabaseAdmin
      .from("chat_mensajes")
      .select(
        "remitente_nombre, jugada_estandarizada, contenido, monto_disponible, modalidad_propuesta, ejemplar_texto, es_match, caballos_bando_a, caballos_bando_b"
      )
      .eq("sala_id", sala.id)
      .in("tipo_mensaje", ["propuesta_jugada", "PROPUESTA"])
      .in("estado_propuesta", ["abierta", "parcial"])
      .gt("monto_disponible", 0)
      .order("created_at", { ascending: true });

    if (carreraId) {
      qProps = qProps.or(`carrera_id.eq.${carreraId},carrera_id.is.null`);
    }
    const { data: propsAbiertas } = await qProps;
    const listaProps = propsAbiertas || [];

    let retiradosLista: string[] = [];
    if (carreraId) {
      try {
        const { data: cRow } = await supabaseAdmin
          .from("carreras")
          .select("ejemplares_retirados")
          .eq("id", carreraId)
          .maybeSingle();
        if (cRow?.ejemplares_retirados && Array.isArray(cRow.ejemplares_retirados)) {
          retiradosLista = cRow.ejemplares_retirados;
        }
      } catch {}
    }

    const textoPlano = await generarTextoPlanoOficial(sala, lista, listaProps, retiradosLista);

    let enviadoWhatsApp = false;
    if (sala.whatsapp_group_jid) {
      try {
        const rBot = await fetch(`${BOT_DAEMON_URL}/publicar-grupo`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": obtenerSecretoInternoBot(),
          },
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

    return respuestaSala({
      ok: true,
      textoPlano,
      totalTickets: lista.length,
      totalPactado,
      enviadoWhatsApp,
    });
  }

  if (accion === "publicar-sentencia" || accion === "liquidar-pizarra" || accion === "rectificar-pizarra") {
    const { salaId, pizarra } = body;
    const esRectificacion = accion === "rectificar-pizarra" || Boolean(body.esRectificacion);
    if (!salaId || !pizarra) {
      return respuestaSala(
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
      return respuestaSala({ ok: false, error: "Sala no encontrada" }, { status: 404 });
    }

    const resSentencia = await liquidarYSentenciarCarreraPlataforma({
      sala,
      pizarra,
      esRectificacion: Boolean(esRectificacion),
      operadorNombre: body.operadorNombre || "OPERADOR_WEB",
    });

    if (!resSentencia.ok) {
      return respuestaSala({ ok: false, error: resSentencia.error }, { status: 400 });
    }

    return respuestaSala(resSentencia);
  }

  if (accion === "ajuste-saldo-operador") {
    const { grupoId, targetNombre, signo, monto, operadorNombre } = body;
    await recordarCodigoSala({ grupoId });
    if (!grupoId || !targetNombre || !signo || !monto) {
      return respuestaSala({ ok: false, error: "Datos incompletos para ajuste" }, { status: 400 });
    }

    const { data: candidatos } = await supabaseAdmin
      .from("clientes")
      .select(
        "id, nombre, seudonimo, saldo_actual, saldo_retenido, saldo_disponible, libre, aval, whatsapp_jid, telefono, telefono_normalizado"
      )
      .eq("grupo_id", grupoId);

    const targetLimpio = String(targetNombre).trim().toUpperCase();
    const match = (candidatos || []).find((c: any) => {
      const n = String(c.nombre || "").trim().toUpperCase();
      const s = String(c.seudonimo || "").trim().toUpperCase();
      return n === targetLimpio || s === targetLimpio || n.includes(targetLimpio) || (s && s.includes(targetLimpio));
    });

    if (!match) {
      return respuestaSala({ ok: false, error: `Jugador "${targetNombre}" no encontrado en este grupo.` }, { status: 404 });
    }

    const montoNum = Number(monto);
    const saldoActual = Number(match.saldo_actual || 0);
    const delta = signo === "+" ? montoNum : -montoNum;
    const nuevoSaldo = Number((saldoActual + delta).toFixed(2));
    const nuevoDisponible = match.libre
      ? 999999
      : Math.max(0, Number((nuevoSaldo + Number(match.aval || 0) - Number(match.saldo_retenido || 0)).toFixed(2)));

    await supabaseAdmin
      .from("clientes")
      .update({
        saldo_actual: nuevoSaldo,
        saldo_disponible: nuevoDisponible,
        updated_at: new Date().toISOString(),
      })
      .eq("id", match.id);

    await supabaseAdmin.from("libro_mayor_clientes").insert({
      cliente_id: match.id,
      cliente_nombre: match.nombre,
      grupo_id: grupoId,
      tipo_movimiento: signo === "+" ? "DEPOSITO" : "RETIRO",
      monto_centavos: Math.round(montoNum * 100),
      monto: montoNum,
      observacion: "Ajuste operador WhatsApp",
      creado_por: operadorNombre || "OPERADOR_WHATSAPP",
      fecha_carrera: new Date().toISOString().split("T")[0],
    });

    const nombreFinal = match.seudonimo || match.nombre;
    const msgPublico = `✅ Saldo actualizado para *${nombreFinal}*: Nuevo saldo $${formatearMontoRegional(nuevoSaldo)}`;
    const msgPrivado = `💰 Tu cuenta ha sido ${signo === "+" ? "acreditada" : "debitada"} con $${formatearMontoRegional(montoNum)}. Tu nuevo saldo disponible es $${formatearMontoRegional(nuevoDisponible)}.`;

    return respuestaSala({
      ok: true,
      clienteId: match.id,
      nombre: nombreFinal,
      nuevoSaldo,
      nuevoDisponible,
      msgPublico,
      msgPrivado,
      clienteJid: match.whatsapp_jid || (match.telefono_normalizado ? `${match.telefono_normalizado}@s.whatsapp.net` : null),
    });
  }

  return null;
}
