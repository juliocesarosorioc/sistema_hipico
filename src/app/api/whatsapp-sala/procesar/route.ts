import { NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { supabaseAdmin } from "@/core/supabase-admin";
import {
  analizarYEstandarizarJugada,
  analizarBloqueJugadas,
  calcularRiesgoReal,
  evaluarMensajePedagogico,
  evaluarConcrecionEstricta,
  analizarComandoRetiro,
  evaluarAmpliacionPropuesta,
  normalizarParadaPremio,
  extraerMontoNumerico,
} from "@/features/sala-juegos/lib/parser-pedagogico";
import { formatearMontoRegional } from "@/shared/lib/dinero";
import { sincronizarTicketsPropuestaATaquilla } from "@/features/whatsapp-sala/lib/sincronizar-tickets-sala";
import {
  formatearModalidadMensaje,
  limpiarEtiquetasProhibidas,
} from "@/features/sala-juegos/lib/modalidades-progresivas";
import {
  mensajeConCodigoSala,
  resolverCodigoSalaGrupo,
} from "@/features/grupos/lib/codigo-sala";
import {
  cargarPlantillasGrupo,
  obtenerPlantillaGrupo,
} from "@/features/whatsapp/lib/plantillas-grupo-server";
import { variablesEncabezadoGrupo } from "@/features/whatsapp/lib/plantillas-grupo";
import { encabezadoGrupo } from "@/features/whatsapp/lib/encabezados-grupo";
import { mensajeJugaronPorSaldoParcial } from "@/features/whatsapp/lib/mensajes-concrecion";

export const dynamic = "force-dynamic";

function sanitizarTexto(str: unknown): string {
  if (typeof str !== "string") return "";
  return str
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/[^\w\s.,!¡?¿$*+=\-()\[\]/@ªáéíóúÁÉÍÓÚñÑ]/gi, "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean)
    .join("\n");
}

function normalizarTelefonoCompleto(codigoPais?: string | null, telefono?: string | null): string {
  const cp = String(codigoPais || "").replace(/\D/g, "");
  const tel = String(telefono || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!tel) return cp;
  if (!cp) return tel;
  if (tel.startsWith(cp)) return tel;
  return `${cp}${tel}`;
}

const BOT_DAEMON_URL = process.env.WHATSAPP_BOT_URL || "http://127.0.0.1:3005";
const INTERNAL_BOT_SECRET = process.env.INTERNAL_BOT_SECRET || "SH-BOT-SECRET-2026";

const codigoSalaPorSalaId = new Map<string, string>();
const codigoSalaPorGrupoId = new Map<string, string>();

async function recordarCodigoSala(datos: {
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

function codigoSalaEnRespuesta(body: any): string {
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
function esWhatsappMsgIdDuplicado(msgId?: string | null, salaId?: string | null): boolean {
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

// Respaldo de grupos desconectados. Usa el MISMO archivo que el demonio Baileys
// (AUTH_DIR/salas_desconectadas.json) para que ambos vean lo mismo tras un
// reinicio, aunque el demonio esté caído en el momento de desconectar.
const AUTH_DIR_WHATSAPP =
  process.env.WHATSAPP_AUTH_DIR ||
  (process.platform === "linux"
    ? "/root/sistema_hipico/whatsapp_auth"
    : path.join(process.cwd(), "whatsapp_auth"));
const ARCHIVO_SALAS_DESCONECTADAS = path.join(AUTH_DIR_WHATSAPP, "salas_desconectadas.json");

type RespaldoSalaDesconectada = {
  groupJid?: string | null;
  groupNombre?: string | null;
  desconectadoEn?: string;
};

function leerRespaldoDesconectadas(): Record<string, RespaldoSalaDesconectada> {
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

function escribirRespaldoDesconectadas(
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

function extraerUltimos10Digitos(raw?: string | null): string {
  if (!raw) return "";
  const soloDigitos = String(raw).replace(/@.*$/, "").replace(/:.*$/, "").replace(/\D/g, "");
  if (soloDigitos.length >= 10) return soloDigitos.slice(-10);
  return soloDigitos.length >= 7 ? soloDigitos : "";
}

function resolverTelefonoWhatsappCliente(cliente: any): string | null {
  const raw = cliente?.telefono_normalizado || cliente?.telefono || "";
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 12 && digits.startsWith("58")) return digits;
  const u10 = extraerUltimos10Digitos(digits);
  if (u10.length === 10 && /^[24]/.test(u10) && (!digits.startsWith("1") || digits.length > 11)) {
    return `58${u10}`;
  }
  return digits;
}

function calcularSaldoDisponible(cliente: any): number {
  if (!cliente) return 0;
  if (cliente.libre) return 999999;
  const saldo = Number(cliente.saldo_actual ?? 0);
  const aval = Number(cliente.aval ?? cliente.limite_credito ?? 0);
  const retenido = Number(cliente.saldo_retenido ?? 0);
  const dispCalculado = Math.max(0, Number((saldo + aval - retenido).toFixed(2)));
  const dispDb = Number(cliente.saldo_disponible ?? 0);
  return Math.max(dispCalculado, dispDb);
}

function normalizarNombreHipodromo(raw?: string | null): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/^HIPODROMO\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Resuelve un hipódromo contra la tabla oficial `public.hipodromos`. */
async function resolverHipodromoEnTabla(
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

function esUuidCarreraValido(v: unknown): v is string {
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
async function asegurarCarreraActivaSala(sala: any): Promise<string | null> {
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
      return data && esUuidCarreraValido((data as any).id) ? String((data as any).id) : null;
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

const AVISO_REDACCION_GRUPO = "⚠️¡Por favor, verificar redacción! ¡Gracias!";

/** Abreviatura humanizada de miles compartida por los comandos del bot. */
const RE_MONTO_INPUT = "(?:\\d+(?:[\\.,]\\d+)?\\s*(?:k|mil)?)";

function detallePublicoPropuesta(prop: any): string {
  if (prop?.es_match) {
    const bA = Array.isArray(prop.caballos_bando_a) ? prop.caballos_bando_a.join("-") : String(prop.caballos_bando_a || "");
    const bB = Array.isArray(prop.caballos_bando_b) ? prop.caballos_bando_b.join("-") : String(prop.caballos_bando_b || "");
    const propRaw = String(prop.proporcion_premio || prop.proporcion || "1x1").trim();
    const canon = limpiarEtiquetasProhibidas(propRaw);
    const sufijo = canon && canon !== "pp" && !/^1x1$/i.test(canon) ? ` ${canon}` : "";
    return `A Premio (${bA}x${bB})${sufijo}`.trim();
  }
  const mod = String(prop?.modalidad_propuesta || prop?.modalidad || "1P").trim();
  const ej = String(prop?.ejemplar_texto || (Array.isArray(prop?.caballos_bando_a) ? prop.caballos_bando_a[0] : "") || "").trim();
  return limpiarEtiquetasProhibidas(formatearModalidadMensaje(mod, ej));
}

function mensajeJugaronPorPozo(prop: any, monto: number, limitador: string): string {
  return `✅ Jugaron ${detallePublicoPropuesta(prop)} con ${formatearMontoRegional(monto)} por Pozo de ${limitador}`;
}

async function construirMensajeSaldoParcial(params: {
  sala: any;
  juega: string;
  da: string;
  monto: number;
  saldoDe: string;
  detalle?: string;
}): Promise<string> {
  const { sala, juega, da, monto, saldoDe, detalle } = params;
  const mapa = await cargarPlantillasGrupo(sala?.grupo_id);
  return obtenerPlantillaGrupo(
    mapa,
    "concrecion_saldo_parcial",
    {
      ...variablesEncabezadoGrupo(sala, "concrecion"),
      juega,
      da,
      monto: formatearMontoRegional(monto),
      saldo_de: saldoDe,
      detalle: detalle || "",
    },
    mensajeJugaronPorSaldoParcial({ juega, da, monto, saldoDe, detalle })
  );
}

function mensajeJugaronCompleto(nombreJuega: string, detalle: string, nombreDa: string, monto: number): string {
  return limpiarEtiquetasProhibidas(
    `✅ Jugaron: *${nombreJuega} Juega ${detalle} da ${nombreDa} $${formatearMontoRegional(monto)}*`
  );
}

function limitadorPorPozo(
  montoSolicitado: number,
  montoEfectivo: number,
  disponibleProponente: number,
  disponibleAceptante: number,
  nombreProponente: string,
  nombreAceptante: string
): string | null {
  if (montoEfectivo <= 0 || montoEfectivo >= montoSolicitado) return null;
  return disponibleProponente <= disponibleAceptante ? nombreProponente : nombreAceptante;
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
        messages: [
          { topic: `realtime:sala:${salaId}`, event: evento, payload },
          { topic: `realtime:sala-${salaId}`, event: evento, payload },
        ],
      }),
    }).catch(() => {});
  } catch {
    // No bloqueante
  }
}

async function construirResumenEstadoCuentaCliente(cliente: any, grupoId: string): Promise<string> {
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

async function generarTextoPlanoOficial(
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
      let jugadaDetalle = "";
      if (t.es_match) {
        const bA = (t.caballos_bando_a || []).join("-");
        const bB = (t.caballos_bando_b || []).join("-");
        const prop = String(t.proporcion_premio || t.proporcion || "").trim();
        let propStr = "";
        if (prop && !["1x1", "pp", "10/10", "10a10", "10@10"].includes(prop.toLowerCase())) {
          propStr = ` [${prop.replace("@", "/").replace(/a/i, "/")}]`;
        }
        jugadaDetalle = `(${bA}x${bB})${propStr}`;
      } else {
        const mod = t.modalidad || "1P";
        const ej = t.ejemplar_numero || (t.caballos_bando_a || []).join("-");
        jugadaDetalle = `${mod} ${ej}`;
      }
      const monto = formatearMontoRegional(Number(t.monto_concretado || 0));
      return `${idx + 1}) ${proponente} juega ${jugadaDetalle} con ${aceptante} $${monto}`;
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

async function verificarEsOperador(clienteId?: string | null, telefono?: string | null, grupoId?: string | null): Promise<boolean> {
  if (!telefono && !clienteId) return false;
  try {
    if (telefono) {
      const telClean = String(telefono).replace(/\D/g, "");
      const sufijo8 = telClean.slice(-8);
      const { data: usuario } = await supabaseAdmin
        .from("usuario_sistema")
        .select("id, activo, es_principal, grupo_id")
        .ilike("telefono", `%${sufijo8}%`)
        .limit(1)
        .maybeSingle();
      if (usuario && usuario.activo !== false) {
        if (usuario.es_principal) return true;
        if (grupoId && String(usuario.grupo_id) === String(grupoId)) return true;
      }
    }
  } catch {}
  return false;
}

async function intentarCruceAutomatico(params: {
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

async function obtenerSalasUnicas() {
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

// ============================================================================
// GET: Estado del Demonio Baileys + Salas Activas
// ============================================================================
export async function GET(req: Request) {
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
      headers: { "x-internal-bot-secret": INTERNAL_BOT_SECRET },
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

  // El respaldo en disco es la fuente más confiable (sobrevive a reinicios y a
  // que el demonio esté apagado). Se fusiona con lo que reporte el demonio.
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

  // Enriquecer cada grupo de WhatsApp con su estado de conexión real a la plataforma
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

      // Respaldo de compatibilidad con salas_juego.whatsapp_group_jid directo
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

async function liquidarYSentenciarCarreraPlataforma(params: {
  sala: any;
  pizarra: string;
  esRectificacion?: boolean;
  operadorNombre?: string;
  origenMsgId?: string | null;
}): Promise<{
  ok: boolean;
  textoResultado: string;
  positivos: string[];
  negativos: string[];
  pizarra: string[];
  enviadoWhatsApp: boolean;
  error?: string;
}> {
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
    .select("permite_cruces, comision_default")
    .eq("id", sala.grupo_id)
    .maybeSingle();

  const permiteCruces = grupo?.permite_cruces ?? true;
  const porcComision = Number(grupo?.comision_default ?? 5) / 100;

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

    t.estado = nuevoEstado;
    await supabaseAdmin
      .from("chat_tickets_fifo")
      .update({ estado: nuevoEstado, updated_at: new Date().toISOString() })
      .eq("id", t.id);
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
            saldo_disponible: cl.libre ? 999999 : Math.max(0, nuevoSaldo + Number(cl.aval || 0) - nuevoRet),
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
          "x-internal-bot-secret": INTERNAL_BOT_SECRET,
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

// ============================================================================
// POST: Procesamiento en vivo de Jugadas, Concreciones y Acciones de Sala
// ============================================================================
export async function POST(req: Request) {
  const _origin = req.headers.get("origin");
  const _host = req.headers.get("host");
  if (_origin && !_origin.includes(_host || "")) {
    return respuestaSala({ error: "CSRF bloqueado" }, { status: 403 });
  }
  try {
    // Blindaje SecOps Parche 1: Header de secreto interno estricto
    const authHeader = req.headers.get("x-internal-bot-secret");
    if (authHeader !== INTERNAL_BOT_SECRET) {
      return respuestaSala(
        {
          ok: false,
          error: "401 Unauthorized: Solicitud no autorizada. Header x-internal-bot-secret requerido.",
          respuestaGrupo: null,
          mensajePrivadoAutor: null,
        },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));

    // Sanitización estricta Anti-XSS: descartar etiquetas, SQL y caracteres de control
    if (typeof body.pushName === "string") {
      body.pushName = sanitizarTexto(body.pushName) || "Usuario";
    }
    if (typeof body.senderNombre === "string") {
      body.senderNombre = sanitizarTexto(body.senderNombre) || "Usuario";
    }
    if (typeof body.texto === "string") {
      body.texto = normalizarParadaPremio(sanitizarTexto(body.texto));
    }

    // Cierre VULN-15: Descartar reintentos en < 1ms por idempotencia de whatsappMsgId
    if (body.whatsappMsgId && esWhatsappMsgIdDuplicado(body.whatsappMsgId, body.salaId)) {
      return respuestaSala({
        ok: true,
        tipo: "REINTENTO_DESCARTADO",
        idempotente: true,
        respuestaGrupo: null,
        mensajePrivadoAutor: null,
      });
    }

    // ------------------------------------------------------------------------
    // ACCIONES ADMINISTRATIVAS DESDE LA PANTALLA /whatsapp
    // ------------------------------------------------------------------------
    if (body.accion === "abrir-carrera") {
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
        "apertura_carrera",
        {
          ...variablesEncabezadoGrupo(salaActualizada, "apertura"),
          hipodromo: hipoLimpio,
          carrera: ord,
          retirados: "",
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
              "x-internal-bot-secret": INTERNAL_BOT_SECRET,
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

    if (body.accion === "cerrar-carrera") {
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

      const hipo = String(salaActualizada?.hipodromo_activo || "HIPÓDROMO").toUpperCase();
      const numCarrera = salaActualizada?.numero_carrera_activa || 1;
      const ord = numCarrera === 1 ? "1ra" : numCarrera === 2 ? "2da" : numCarrera === 3 ? "3ra" : `${numCarrera}ta`;
      const mapaCierre = await cargarPlantillasGrupo(salaActualizada?.grupo_id || salaPrevia?.grupo_id || salaId);
      const textoCierre = obtenerPlantillaGrupo(
        mapaCierre,
        "cierre_carrera",
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
              "x-internal-bot-secret": INTERNAL_BOT_SECRET,
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

    if (body.accion === "vincular-sala") {
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

      // Notificar también al demonio local en :3005 si está activo
      try {
        await fetch(`${BOT_DAEMON_URL}/vincular-sala`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
          },
          body: JSON.stringify({ salaId, groupJid, groupNombre }),
        });
      } catch {
        // Demonio offline, pero ya quedó guardado en Supabase
      }

      // Al vincular manualmente ya no hay nada que reconectar.
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

    // ------------------------------------------------------------------------
    // DESCONECTAR SALA: guarda el grupo en el respaldo y deja la sala sin JID
    // ------------------------------------------------------------------------
    if (body.accion === "desconectar-sala") {
      const { salaId } = body;
      if (!salaId) {
        return respuestaSala({ ok: false, error: "salaId es requerido" }, { status: 400 });
      }

      let groupJid: string | null = null;
      let groupNombre: string | null = null;

      // 1) Intentar con el demonio (guarda el respaldo junto a la sesión Baileys)
      try {
        const rBot = await fetch(`${BOT_DAEMON_URL}/desconectar-sala`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
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
        // Demonio offline: se resuelve directo contra Supabase + respaldo en disco
      }

      // 2) Fallback directo contra Supabase
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

    // ------------------------------------------------------------------------
    // RECONECTAR SALA: restaura el grupo guardado (o el que envíe la UI)
    // ------------------------------------------------------------------------
    if (body.accion === "reconectar-sala") {
      const { salaId, groupJid, groupNombre } = body;
      if (!salaId) {
        return respuestaSala({ ok: false, error: "salaId es requerido" }, { status: 400 });
      }

      // 1) Intentar con el demonio
      try {
        const rBot = await fetch(`${BOT_DAEMON_URL}/reconectar-sala`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
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
        // Demonio offline: se resuelve directo contra Supabase + respaldo en disco
      }

      // 2) Fallback directo contra Supabase
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

    if (body.accion === "ping-grupo") {
      const { groupJid } = body;
      if (!groupJid) {
        return respuestaSala({ ok: false, error: "groupJid es requerido" }, { status: 400 });
      }

      try {
        const rBot = await fetch(`${BOT_DAEMON_URL}/ping-grupo?groupJid=${encodeURIComponent(groupJid)}`, {
          method: "GET",
          headers: {
            "x-internal-bot-secret": INTERNAL_BOT_SECRET,
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

    if (body.accion === "publicar-plano") {
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

      let qProps = supabaseAdmin
        .from("chat_mensajes")
        .select("remitente_nombre, jugada_estandarizada, contenido, monto_disponible, modalidad_propuesta, ejemplar_texto, es_match, caballos_bando_a, caballos_bando_b")
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
          const { data: cRow } = await supabaseAdmin.from("carreras").select("ejemplares_retirados").eq("id", carreraId).maybeSingle();
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
              "x-internal-bot-secret": INTERNAL_BOT_SECRET,
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

    if (body.accion === "publicar-sentencia" || body.accion === "liquidar-pizarra" || body.accion === "rectificar-pizarra") {
      const { salaId, pizarra } = body;
      const esRectificacion = body.accion === "rectificar-pizarra" || Boolean(body.esRectificacion);
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

    if (body.accion === "ajuste-saldo-operador") {
      const { grupoId, targetNombre, signo, monto, operadorNombre } = body;
      await recordarCodigoSala({ grupoId });
      if (!grupoId || !targetNombre || !signo || !monto) {
        return respuestaSala({ ok: false, error: "Datos incompletos para ajuste" }, { status: 400 });
      }

      const { data: candidatos } = await supabaseAdmin
        .from("clientes")
        .select("id, nombre, seudonimo, saldo_actual, saldo_retenido, saldo_disponible, libre, aval, whatsapp_jid, telefono, telefono_normalizado")
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
      const nuevoDisponible = match.libre ? 999999 : Math.max(0, Number((nuevoSaldo + Number(match.aval || 0) - Number(match.saldo_retenido || 0)).toFixed(2)));

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

    // ========================================================================
    // PROCESAMIENTO EN VIVO DE MENSAJES DESDE bot-whatsapp-server.mjs
    // ========================================================================
    const groupJid = String(body.groupJid || "").trim();
    const participantJid = String(body.participantJid || body.senderJid || "").trim();
    const texto = String(body.texto || "").trim();
    const whatsappMsgId = body.whatsappMsgId ? String(body.whatsappMsgId) : null;
    const quotedMsgId = body.quotedMsgId ? String(body.quotedMsgId) : null;

    if (!groupJid || !participantJid || !texto) {
      return respuestaSala(
        {
          ok: false,
          error: "groupJid, participantJid y texto son requeridos",
          respuestaGrupo: null,
          mensajePrivadoAutor: null,
        },
        { status: 400 }
      );
    }

    // 1. Buscar la Sala vinculada (por salaId explícito de multi-grupo, por salas_whatsapp_grupos, o por salas_juego.whatsapp_group_jid)
    const salaIdBody = body.salaId ? String(body.salaId) : null;
    const whatsappGroupNombre = body.whatsappGroupNombre ? String(body.whatsappGroupNombre) : null;
    let sala: any = null;

    if (salaIdBody) {
      const { data: sPorId } = await supabaseAdmin
        .from("salas_juego")
        .select("*")
        .eq("id", salaIdBody)
        .maybeSingle();
      sala = sPorId || null;
    }
    if (!sala) {
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
    if (!sala) {
      const { data: sLegacy } = await supabaseAdmin
        .from("salas_juego")
        .select("*")
        .eq("whatsapp_group_jid", groupJid)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      sala = sLegacy || null;
    }
    if (!sala && body.grupoId) {
      const { data: sGrp } = await supabaseAdmin
        .from("salas_juego")
        .select("*")
        .eq("grupo_id", String(body.grupoId))
        .eq("activa", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sGrp) {
        sala = sGrp;
        if (!sGrp.whatsapp_group_jid) {
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

    if (!sala) {
      return respuestaSala({
        ok: false,
        tipo: "IGNORADO",
        mensaje: "Grupo no vinculado a ninguna sala activa",
        respuestaGrupo: null,
        mensajePrivadoAutor: null,
      });
    }

    const salaId = sala.id;
    const grupoId = sala.grupo_id;
    const codigoSala = await recordarCodigoSala({
      salaId,
      grupoId,
      nombre: sala.nombre_grupo || sala.nombre || whatsappGroupNombre || "PRINCIPAL",
    });
    const carreraAbierta = String(sala.estado_carrera || "").toLowerCase() === "abierta";

    // ─────────────────────────────────────────────────────────────────────────
    // INMUNIDAD DEL OPERADOR / ADMINISTRADOR
    // El oficial NO es un jugador: su texto libre se ignora en silencio (sin
    // INSERT en chat_mensajes, sin broadcast y sin respuesta pública/privada).
    // Únicamente se procesan sus comandos exactos de control de carrera.
    // ─────────────────────────────────────────────────────────────────────────
    const esOperadorRemitente =
      Boolean(body.esMensajePropioTelefono) ||
      Boolean(body.esOperador) ||
      (await verificarEsOperador(null, participantJid, grupoId));
    const COMANDO_OPERADOR_EXACTO =
      /^!(?:abrir|abierta|cerrar|cerrad[ao]|pizarra|rectificar|plano|hip[óo]dromo|retirar|recargar|aval)(?:\s|$)/i;
    if (esOperadorRemitente && !COMANDO_OPERADOR_EXACTO.test(texto)) {
      return respuestaSala({
        ok: true,
        tipo: "IGNORADO_OPERADOR",
        respuestaGrupo: null,
        mensajePrivadoAutor: null,
        msg_publico: null,
        msg_publico_bot: null,
        respuestaPublica: null,
        msg_privado_bot: null,
      });
    }

    // Todo mensaje entrante del grupo (sea texto normal o jugada) debe registrarse
    // para que aparezca en el monitor en vivo de la Sala de Juegos Web
    const textoUsuarioLimpio = String(texto || "").trim();
    const esComandoOp = textoUsuarioLimpio.startsWith("!");
    const cmdRetiroPre = analizarComandoRetiro(textoUsuarioLimpio);
    const esAmpliacionPre = evaluarAmpliacionPropuesta(textoUsuarioLimpio).esAmpliacion;
    const esConsultaSaldo = /^(?:!?(?:saldo|mi\s+saldo|ver\s+saldo))$/i.test(textoUsuarioLimpio);
    const esConsultaCuenta = /^(?:!?(?:cuenta|mi\s+cuenta|resumen|mi\s+resumen|estado\s+de\s+cuenta))$/i.test(textoUsuarioLimpio);
    const esComandoSaldosAdmin = /^(?:!?(?:saldos|ver\s+saldos|lista\s+saldos|todos\s+los\s+saldos))$/i.test(textoUsuarioLimpio);
    const esComandoPlano = /^(?:!?(?:plano|prejugadas))$/i.test(textoUsuarioLimpio);
    const esComandoCerrar = /^(?:!?(?:cerrar(?:\s+carrera)?|cerrada|cerrado|trancar|no\s+va\s+m[aá]s))$/i.test(textoUsuarioLimpio);
    const matchAbrirComando = textoUsuarioLimpio.match(/^(?:!)?(?:abrir|abierta)(?:\s+carrera)?(?:\s+(.+?))?(?:\s+(?:c(?:arrera)?\s*|#\s*)?(\d{1,2}))?$/i);
    const matchHipodromoComando = textoUsuarioLimpio.match(/^!?hip[óo]dromo\s+(.+)$/i);
    const matchRetirarCarreraComando = textoUsuarioLimpio.match(/^!retirar\s+(.+)$/i);
    const matchCreditoOperador = textoUsuarioLimpio.match(
      new RegExp(`^!(recargar|aval)\\s+(.+?)\\s+(${RE_MONTO_INPUT})$`, "i")
    );
    const matchPizarraComando = textoUsuarioLimpio.match(/^(?:!)?(?:llegada|sentenciar|pizarra)\s*[:=\-]?\s*([0-9\s,./·\-_]+)$/i);
    const matchRectificarComando = textoUsuarioLimpio.match(/^(?:!)?rectificar(?:\s+pizarra)?\s*[:=\-]?\s*([0-9\s,./·\-_]+)$/i);
    const esSolicitudCajero = /^(?:!?(?:deposito|depósito|reportar\s+pago|retiro|solicito\s+retiro|quiero\s+retirar|recarga|solicito\s+recarga))\b/i.test(textoUsuarioLimpio);
    const esAceptacionSinCita =
      !quotedMsgId &&
      new RegExp(
        `^(?:j|voy|ponte|juego|jugamos|jugue|jugué|copiado|pago|entro)(?:\\s+(?:con\\s+|por\\s+|\\$)?(${RE_MONTO_INPUT}))?$`,
        "i"
      ).test(textoUsuarioLimpio);
    const matchAjusteOperador = textoUsuarioLimpio.match(
      new RegExp(
        `^(?:!)?(?:(?:recargar?|abonar?|ajuste|cargar?)\\s+)?([a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\\s._-]+?)\\s*([+-])\\s*(${RE_MONTO_INPUT})$`,
        "i"
      )
    );
    const preAnalisis = analizarYEstandarizarJugada(textoUsuarioLimpio, 999999, [], 16, undefined, undefined, codigoSala);

    const esAccionOJugada =
      Boolean(quotedMsgId) ||
      esComandoOp ||
      cmdRetiroPre.esComandoRetiro ||
      esAmpliacionPre ||
      esConsultaSaldo ||
      esConsultaCuenta ||
      esComandoSaldosAdmin ||
      esComandoPlano ||
      esComandoCerrar ||
      Boolean(matchAbrirComando) ||
      Boolean(matchPizarraComando) ||
      Boolean(matchRectificarComando) ||
      esSolicitudCajero ||
      esAceptacionSinCita ||
      Boolean(matchAjusteOperador) ||
      preAnalisis.esIntencionDeJugada;

    if (!esAccionOJugada) {
      const nombreRemitente = String(body.senderNombre || body.pushName || "Usuario").trim();
      await supabaseAdmin.from("chat_mensajes").insert({
        grupo_id: grupoId,
        sala_id: salaId,
        remitente_nombre: nombreRemitente,
        es_operador: Boolean(body.esMensajePropioTelefono),
        tipo_mensaje: "texto",
        contenido: textoUsuarioLimpio,
        whatsapp_msg_id: body.whatsappMsgId || null,
        whatsapp_group_jid: groupJid,
        whatsapp_group_nombre: whatsappGroupNombre,
        origen_canal: "WHATSAPP",
      });
      await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

      return respuestaSala({
        ok: true,
        tipo: "CHARLA",
        respuestaGrupo: null,
        mensajePrivadoAutor: null,
      });
    }

    // 2. Identificar al jugador estrictamente en `public.clientes` del `grupo_id` de la sala
    const participantAlt = String(body.participantAlt || "").trim();
    const telefonoRealProp = String(body.telefonoReal || body.participant_phone || "").trim();
    const pushNameLimpio = String(body.push_name || body.pushName || body.senderNombre || "")
      .trim()
      .replace(/\s+/g, " ")
      .toUpperCase();
    const pushNameValido =
      pushNameLimpio &&
      !["USUARIO", "JUGADOR", "OPERADOR", "OPERADOR (TELEFONO)", "ADMIN"].includes(pushNameLimpio)
        ? pushNameLimpio
        : "";

    const esLid = participantJid.endsWith("@lid");
    const esAltLid = participantAlt.endsWith("@lid");
    const telAlt = normalizarTelefono(participantAlt);
    let telReal = normalizarTelefono(telefonoRealProp);
    if (!telReal) {
      if (participantAlt && participantAlt.endsWith("@s.whatsapp.net")) {
        telReal = telAlt;
      } else if (participantJid && participantJid.endsWith("@s.whatsapp.net")) {
        telReal = normalizarTelefono(participantJid);
      } else if (!esLid && normalizarTelefono(participantJid).length >= 7 && normalizarTelefono(participantJid).length <= 15) {
        telReal = normalizarTelefono(participantJid);
      } else if (!esAltLid && telAlt && telAlt.length >= 7 && telAlt.length <= 15) {
        telReal = telAlt;
      }
    }

    const tel10 = extraerUltimos10Digitos(telReal || telefonoRealProp || (!esLid ? participantJid : "") || (!esAltLid ? participantAlt : ""));

    const CAMPOS_CLIENTE_SALA =
      "id, grupo_id, nombre, seudonimo, saldo_actual, saldo_retenido, saldo_disponible, libre, aval, whatsapp_jid, whatsapp_lid, codigo_pais, telefono, telefono_normalizado";

    let cliente: any =
      body.clientePreviamenteIdentificado?.id &&
      String(body.clientePreviamenteIdentificado?.grupo_id || "") === String(grupoId)
        ? body.clientePreviamenteIdentificado
        : null;

    // A. Búsqueda en `clientes` donde `grupo_id = sala.grupo_id` por whatsapp_jid o whatsapp_lid
    if (!cliente && (participantJid || participantAlt)) {
      const orJids: string[] = [];
      if (participantJid) {
        orJids.push(`whatsapp_jid.eq.${participantJid}`);
        orJids.push(`whatsapp_lid.eq.${participantJid}`);
      }
      if (participantAlt && participantAlt !== participantJid) {
        orJids.push(`whatsapp_jid.eq.${participantAlt}`);
        orJids.push(`whatsapp_lid.eq.${participantAlt}`);
      }
      if (orJids.length > 0) {
        const { data: clPorJid } = await supabaseAdmin
          .from("clientes")
          .select(CAMPOS_CLIENTE_SALA)
          .eq("grupo_id", grupoId)
          .or(orJids.join(","))
          .order("saldo_actual", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (clPorJid) cliente = clPorJid;
      }
    }

    // B. Normalización y búsqueda por últimos 10 dígitos (RIGHT(solo_digitos, 10))
    // Match exacto para +584241737612, 584241737612, 04241737612 -> 4241737612
    if (!cliente && tel10 && tel10.length >= 7) {
      const { data: clPor10 } = await supabaseAdmin
        .from("clientes")
        .select(CAMPOS_CLIENTE_SALA)
        .eq("grupo_id", grupoId)
        .or(`telefono.ilike.%${tel10}%,telefono_normalizado.ilike.%${tel10}%`)
        .order("saldo_actual", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (clPor10) cliente = clPor10;
    }

    // C. Búsqueda en memoria sobre todos los clientes del grupo (10 dígitos o pushName)
    if (!cliente) {
      const { data: candidatosGrupo } = await supabaseAdmin
        .from("clientes")
        .select(CAMPOS_CLIENTE_SALA)
        .eq("grupo_id", grupoId);

      if (Array.isArray(candidatosGrupo) && candidatosGrupo.length > 0) {
        if (tel10) {
          cliente = candidatosGrupo.find((c: any) => {
            const c10 = extraerUltimos10Digitos(c.telefono_normalizado || c.telefono);
            if (c10 && c10 === tel10) return true;
            const comp = normalizarTelefonoCompleto(c.codigo_pais, c.telefono);
            const comp10 = extraerUltimos10Digitos(comp);
            return Boolean(comp10 && comp10 === tel10);
          });
        }

        if (!cliente && pushNameValido) {
          cliente = candidatosGrupo.find((c: any) => {
            const nom = String(c.nombre || "").trim().replace(/\s+/g, " ").toUpperCase();
            const seu = String(c.seudonimo || "").trim().replace(/\s+/g, " ").toUpperCase();
            return (
              nom === pushNameValido ||
              (seu && seu === pushNameValido) ||
              nom.includes(pushNameValido) ||
              (seu && seu.includes(pushNameValido)) ||
              pushNameValido.includes(nom) ||
              (seu && pushNameValido.includes(seu))
            );
          });
        }
      }
    }

    // D. Pistas cruzadas entre grupos (si el jugador ya fue visto en otro grupo con ese JID/LID/teléfono)
    if (!cliente && (participantJid || participantAlt || tel10 || pushNameValido)) {
      const orPistas: string[] = [];
      if (participantJid) {
        orPistas.push(`whatsapp_jid.eq.${participantJid}`);
        orPistas.push(`whatsapp_lid.eq.${participantJid}`);
      }
      if (participantAlt && participantAlt !== participantJid) {
        orPistas.push(`whatsapp_jid.eq.${participantAlt}`);
        orPistas.push(`whatsapp_lid.eq.${participantAlt}`);
      }
      if (tel10) {
        orPistas.push(`telefono.ilike.%${tel10}%`);
        orPistas.push(`telefono_normalizado.ilike.%${tel10}%`);
      }
      if (orPistas.length > 0) {
        const { data: pistaRows } = await supabaseAdmin
          .from("clientes")
          .select("nombre, seudonimo, telefono, telefono_normalizado")
          .or(orPistas.join(","))
          .limit(5);

        if (Array.isArray(pistaRows) && pistaRows.length > 0) {
          const { data: candidatosGrupo } = await supabaseAdmin
            .from("clientes")
            .select(CAMPOS_CLIENTE_SALA)
            .eq("grupo_id", grupoId);

          if (Array.isArray(candidatosGrupo) && candidatosGrupo.length > 0) {
            for (const pista of pistaRows) {
              const p10 = extraerUltimos10Digitos(pista.telefono_normalizado || pista.telefono);
              const nomP = String(pista.nombre || "").trim().replace(/\s+/g, " ").toUpperCase();
              const seuP = String(pista.seudonimo || "").trim().replace(/\s+/g, " ").toUpperCase();

              const encontrado = candidatosGrupo.find((c: any) => {
                const c10 = extraerUltimos10Digitos(c.telefono_normalizado || c.telefono);
                if (p10 && c10 && p10 === c10) return true;
                const nomC = String(c.nombre || "").trim().replace(/\s+/g, " ").toUpperCase();
                const seuC = String(c.seudonimo || "").trim().replace(/\s+/g, " ").toUpperCase();
                if (nomP && (nomC === nomP || seuC === nomP)) return true;
                if (seuP && (nomC === seuP || seuC === seuP)) return true;
                return false;
              });
              if (encontrado) {
                cliente = encontrado;
                break;
              }
            }
          }
        }
      }
    }

    // E. Fallback a membresías `clientes_grupos`
    if (!cliente) {
      try {
        const { data: membresias } = await supabaseAdmin
          .from("clientes_grupos")
          .select("cliente_id")
          .eq("grupo_id", grupoId);

        const idsMembresia = (membresias || [])
          .map((m: any) => m?.cliente_id)
          .filter(Boolean);

        if (idsMembresia.length > 0) {
          const { data: candidatosMem } = await supabaseAdmin
            .from("clientes")
            .select(CAMPOS_CLIENTE_SALA)
            .in("id", idsMembresia);

          if (Array.isArray(candidatosMem) && candidatosMem.length > 0) {
            cliente = candidatosMem.find((c: any) => {
              if (participantJid && (c.whatsapp_jid === participantJid || c.whatsapp_lid === participantJid)) return true;
              if (participantAlt && (c.whatsapp_jid === participantAlt || c.whatsapp_lid === participantAlt)) return true;
              const c10 = extraerUltimos10Digitos(c.telefono_normalizado || c.telefono);
              if (tel10 && c10 && c10 === tel10) return true;
              const nomC = String(c.nombre || "").trim().replace(/\s+/g, " ").toUpperCase();
              const seuC = String(c.seudonimo || "").trim().replace(/\s+/g, " ").toUpperCase();
              if (pushNameValido && (nomC === pushNameValido || seuC === pushNameValido)) return true;
              return false;
            });
          }
        }
      } catch {}
    }

    // Si no existe en public.clientes para ese grupo_id, rechazar de inmediato sin tocar la BD
    if (!cliente) {
      return respuestaSala({
        ok: false,
        tipo: "SIN_REGISTRO",
        respuestaGrupo: "🚫 *Nada Aquí* — Jugador no registrado en la nómina oficial del grupo.",
        mensajePrivadoAutor: null,
      });
    }

    const nombreJugador = cliente.seudonimo || cliente.nombre;

    // F. Persistencia y auto-vinculación de whatsapp_lid y whatsapp_jid en public.clientes
    const updatesCl: Record<string, any> = {};
    if (participantJid) {
      if (participantJid.endsWith("@lid") && cliente.whatsapp_lid !== participantJid) {
        // Auto-guardado de @lid en segundo plano: las próximas jugadas hacen match instantáneo.
        const lidNuevo = participantJid;
        const clienteIdLid = cliente.id;
        const grupoIdLid = cliente.grupo_id;
        cliente.whatsapp_lid = lidNuevo;
        void (async () => {
          try {
            let qLid = supabaseAdmin
              .from("clientes")
              .update({ whatsapp_lid: lidNuevo, updated_at: new Date().toISOString() })
              .eq("id", clienteIdLid);
            if (grupoIdLid) qLid = qLid.eq("grupo_id", grupoIdLid);
            const { error: errLid } = await qLid;
            if (errLid) console.error("[LID_AUTOGUARDADO_ERROR]", errLid);
          } catch (e) {
            console.error("[LID_AUTOGUARDADO_ERROR]", e);
          }
        })();
      } else if (participantJid.endsWith("@s.whatsapp.net") && cliente.whatsapp_jid !== participantJid) {
        updatesCl.whatsapp_jid = participantJid;
        updatesCl.whatsapp_vinculado = true;
      }
    }
    if (participantAlt && participantAlt.endsWith("@s.whatsapp.net") && !cliente.whatsapp_jid) {
      updatesCl.whatsapp_jid = participantAlt;
      updatesCl.whatsapp_vinculado = true;
    }
    if (!cliente.telefono_normalizado && telReal && telReal.length >= 7) {
      updatesCl.telefono_normalizado = telReal;
    }
    if (Object.keys(updatesCl).length > 0) {
      updatesCl.updated_at = new Date().toISOString();
      let qUpd = supabaseAdmin.from("clientes").update(updatesCl).eq("id", cliente.id);
      if (cliente.grupo_id) {
        qUpd = qUpd.eq("grupo_id", cliente.grupo_id);
      }
      await qUpd;
      if (updatesCl.whatsapp_lid) cliente.whatsapp_lid = updatesCl.whatsapp_lid;
      if (updatesCl.whatsapp_jid) cliente.whatsapp_jid = updatesCl.whatsapp_jid;
      if (updatesCl.telefono_normalizado) cliente.telefono_normalizado = updatesCl.telefono_normalizado;
    }

    const saldoDisponible = calcularSaldoDisponible(cliente);
    if (!cliente.libre && (cliente.saldo_disponible == null || Number(cliente.saldo_disponible) !== saldoDisponible)) {
      let qDisp = supabaseAdmin.from("clientes").update({ saldo_disponible: saldoDisponible }).eq("id", cliente.id);
      if (cliente.grupo_id) {
        qDisp = qDisp.eq("grupo_id", cliente.grupo_id);
      }
      await qDisp;
      cliente.saldo_disponible = saldoDisponible;
    }

    // ========================================================================
    // 1. REGLAS ENTRENADAS DE LA SALA DE JUEGOS
    // Si no es comando de operador (!), consultar evaluar_respuesta_entrenada_sala
    // ========================================================================
    if (!texto.trim().startsWith("!")) {
      try {
        const { data: dataEntrenada } = await supabaseAdmin.rpc(
          "evaluar_respuesta_entrenada_sala",
          {
            p_grupo_id: grupoId,
            p_jugador_id: cliente.id,
            p_texto: texto,
          }
        );

        if (
          dataEntrenada?.coincidencia === true &&
          (dataEntrenada.accion_sistema === "respuesta_directa" ||
            dataEntrenada.accion_sistema === "consultar_saldo")
        ) {
          const msgPublico = dataEntrenada.msg_publico || null;
          const msgPrivado = dataEntrenada.msg_privado || null;

          if (msgPublico) {
            await supabaseAdmin.from("chat_mensajes").insert({
              grupo_id: grupoId,
              sala_id: salaId,
              remitente_nombre: "🤖 ASISTENTE DE SALA",
              es_operador: true,
              tipo_mensaje: "bot_entrenado",
              contenido: msgPublico,
              whatsapp_msg_id: whatsappMsgId || null,
              whatsapp_group_jid: groupJid || null,
              whatsapp_group_nombre: whatsappGroupNombre || null,
              origen_canal: "WHATSAPP",
            });
            await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });
          }

          return respuestaSala({
            ok: true,
            tipo: "RESPUESTA_ENTRENADA",
            respuestaGrupo: msgPublico,
            msg_publico: msgPublico,
            msg_publico_bot: msgPublico,
            respuestaPublica: msgPublico,
            mensajePrivadoAutor: msgPrivado,
            msg_privado_bot: msgPrivado,
            alertaPrivada: null,
            notificaciones_privadas: [],
            senderJid: participantJid,
          });
        }
      } catch (errRpcEntrenada) {
        console.warn("[procesar] Aviso evaluar_respuesta_entrenada_sala:", errRpcEntrenada);
      }

    if (matchAjusteOperador) {
      const esOp = Boolean(body.esMensajePropioTelefono) || Boolean(body.esOperador) || (await verificarEsOperador(cliente?.id, telReal || participantJid, grupoId));
      if (esOp) {
        const targetNombre = matchAjusteOperador[1].trim();
        const signo = matchAjusteOperador[2];
        const montoRaw = matchAjusteOperador[3];
        const { monto } = extraerMontoNumerico(montoRaw);

        if (monto > 0) {
          const { data: candidatos } = await supabaseAdmin
            .from("clientes")
            .select(CAMPOS_CLIENTE_SALA)
            .eq("grupo_id", grupoId);

          const targetLimpio = targetNombre.toUpperCase();
          const targetCliente = (candidatos || []).find((c: any) => {
            const n = String(c.nombre || "").trim().toUpperCase();
            const s = String(c.seudonimo || "").trim().toUpperCase();
            return n === targetLimpio || s === targetLimpio || n.includes(targetLimpio) || (s && s.includes(targetLimpio));
          });

          if (targetCliente) {
            const saldoActual = Number(targetCliente.saldo_actual || 0);
            const delta = signo === "+" ? monto : -monto;
            const nuevoSaldo = Number((saldoActual + delta).toFixed(2));
            const nuevoDisponible = targetCliente.libre ? 999999 : Math.max(0, Number((nuevoSaldo + Number(targetCliente.aval || 0) - Number(targetCliente.saldo_retenido || 0)).toFixed(2)));

            await supabaseAdmin
              .from("clientes")
              .update({
                saldo_actual: nuevoSaldo,
                saldo_disponible: nuevoDisponible,
                updated_at: new Date().toISOString(),
              })
              .eq("id", targetCliente.id);

            await supabaseAdmin.from("libro_mayor_clientes").insert({
              cliente_id: targetCliente.id,
              cliente_nombre: targetCliente.nombre,
              grupo_id: grupoId,
              tipo_movimiento: signo === "+" ? "DEPOSITO" : "RETIRO",
              monto_centavos: Math.round(monto * 100),
              monto: monto,
              observacion: "Ajuste operador WhatsApp",
              creado_por: body.pushName || "OPERADOR_WHATSAPP",
              fecha_carrera: new Date().toISOString().split("T")[0],
            });

            const nombreFinal = targetCliente.seudonimo || targetCliente.nombre;
            const msgPublico = `✅ Saldo actualizado para *${nombreFinal}*: Nuevo saldo $${formatearMontoRegional(nuevoSaldo)}`;
            const msgPrivado = `💰 Tu cuenta ha sido ${signo === "+" ? "acreditada" : "debitada"} con $${formatearMontoRegional(monto)}. Tu nuevo saldo disponible es $${formatearMontoRegional(nuevoDisponible)}.`;

            await supabaseAdmin.from("chat_mensajes").insert({
              grupo_id: grupoId,
              sala_id: salaId,
              remitente_nombre: "🤖 ASISTENTE DE SALA",
              es_operador: true,
              tipo_mensaje: "sistema",
              contenido: msgPublico,
              whatsapp_msg_id: whatsappMsgId || null,
              whatsapp_group_jid: groupJid || null,
              whatsapp_group_nombre: whatsappGroupNombre || null,
              origen_canal: "WHATSAPP",
            });
            await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

            const jidTarget = targetCliente.whatsapp_jid || (targetCliente.telefono_normalizado ? `${targetCliente.telefono_normalizado}@s.whatsapp.net` : null);

            return respuestaSala({
              ok: true,
              tipo: "AJUSTE_SALDO_OPERADOR",
              respuestaGrupo: msgPublico,
              msg_publico: msgPublico,
              msg_publico_bot: msgPublico,
              respuestaPublica: msgPublico,
              mensajePrivadoAutor: null,
              notificaciones_privadas: jidTarget ? [{ whatsapp_jid: jidTarget, mensaje: msgPrivado }] : [],
              senderJid: participantJid,
            });
          }
        }
      }
    }

    if (esAceptacionSinCita) {
      const msgPubNada = "Nada aquí, verifique";
      const msgPrivNada = "⚠️ Para aceptar una jugada debes citar (responder directamente) la propuesta original.";

      await supabaseAdmin.from("chat_mensajes").insert({
        grupo_id: grupoId,
        sala_id: salaId,
        remitente_nombre: "🤖 ASISTENTE DE SALA",
        es_operador: true,
        es_bot: true,
        tipo_mensaje: "sistema",
        contenido: msgPubNada,
        whatsapp_msg_id: whatsappMsgId || null,
        whatsapp_group_jid: groupJid || null,
        whatsapp_group_nombre: whatsappGroupNombre || null,
        origen_canal: "WHATSAPP",
      });
      await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

      return respuestaSala({
        ok: false,
        tipo: "ACEPTACION_SIN_CITA",
        nada_aqui: true,
        respuestaGrupo: msgPubNada,
        msg_publico: msgPubNada,
        msg_publico_bot: msgPubNada,
        respuestaPublica: msgPubNada,
        mensajePrivadoAutor: msgPrivNada,
        msg_privado_bot: msgPrivNada,
        senderJid: participantJid,
      });
    }

    if (esSolicitudCajero) {
      const esRetiro = /retiro|quiero\s+retirar|solicito\s+retiro/i.test(textoUsuarioLimpio);
      const tipoOp = esRetiro ? "Retiro" : "Depósito";
      const msgPriv = esRetiro
        ? `🏧 *Solicitud de Retiro*\n\nHola *${nombreJugador}*, tu solicitud de retiro ha sido notificada al operador.\nTu saldo disponible actual es *$${formatearMontoRegional(saldoDisponible)}*.\nEl operador se comunicará contigo a la brevedad.`
        : `🏦 *Solicitud de Recarga / Depósito*\n\nHola *${nombreJugador}*, hemos recibido tu solicitud. Por favor envía el comprobante de pago o capture por este medio.\nEl operador revisará y acreditará tu saldo a la brevedad.`;

      const notifOp = `🔔 *Solicitud de ${tipoOp} de Jugador:*\n👤 *${nombreJugador}* (${cliente.telefono || "Sin teléfono"})\n💰 Saldo Disponible: $${formatearMontoRegional(saldoDisponible)}\nPara procesar escribe: *${nombreJugador} +[MONTO]* o *${nombreJugador} -[MONTO]*`;

      return respuestaSala({
        ok: true,
        tipo: "SOLICITUD_CAJERO",
        respuestaGrupo: null,
        msg_publico: null,
        mensajePrivadoAutor: msgPriv,
        msg_privado_bot: msgPriv,
        notificaciones_privadas: [{ tipo: "operador", mensaje: notifOp }],
        senderJid: participantJid,
      });
    }

    if (esComandoSaldosAdmin) {
      const esOp = Boolean(body.esMensajePropioTelefono) || Boolean(body.esOperador) || (await verificarEsOperador(cliente?.id, telReal || participantJid, grupoId));
      if (esOp) {
        const { data: listaCl } = await supabaseAdmin
          .from("clientes")
          .select("id, nombre, seudonimo, saldo_actual, saldo_disponible, libre")
          .eq("grupo_id", grupoId)
          .order("nombre", { ascending: true });

        const lineas = (listaCl || []).map((c) => {
          const nom = c.seudonimo || c.nombre || "Jugador";
          const actual = formatearMontoRegional(Number(c.saldo_actual || 0));
          const disp = formatearMontoRegional(Number(c.saldo_disponible || 0));
          return `• *${nom}*: $${actual} ${c.libre ? "(Libre)" : `(Disp: $${disp})`}`;
        }).join("\n");

        const msgSaldos = `📊 *LISTADO OFICIAL DE SALDOS*\n━━━━━━━━━━━━━━━━━━━━━━\n${lineas || "_No hay jugadores registrados en este grupo._"}`;

        await supabaseAdmin.from("chat_mensajes").insert({
          grupo_id: grupoId,
          sala_id: salaId,
          remitente_nombre: "🤖 ASISTENTE DE SALA",
          es_operador: true,
          tipo_mensaje: "sistema",
          contenido: msgSaldos,
          whatsapp_msg_id: whatsappMsgId || null,
          whatsapp_group_jid: groupJid || null,
          whatsapp_group_nombre: whatsappGroupNombre || null,
          origen_canal: "WHATSAPP",
        });
        await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

        return respuestaSala({
          ok: true,
          tipo: "LISTADO_SALDOS",
          respuestaGrupo: msgSaldos,
          msg_publico: msgSaldos,
          msg_publico_bot: msgSaldos,
          respuestaPublica: msgSaldos,
          mensajePrivadoAutor: null,
          senderJid: participantJid,
        });
      }
    }

    if (esComandoPlano) {
      const { data: ticketsPlano } = await supabaseAdmin
        .from("chat_tickets_fifo")
        .select("*")
        .eq("sala_id", salaId)
        .in("estado", ["PENDIENTE", "ACTIVO", "ABIERTO"])
        .order("created_at", { ascending: true });

      const { data: propsPlano } = await supabaseAdmin
        .from("chat_mensajes")
        .select("remitente_nombre, jugada_estandarizada, contenido, monto_disponible")
        .eq("sala_id", salaId)
        .in("tipo_mensaje", ["propuesta_jugada", "PROPUESTA"])
        .in("estado_propuesta", ["abierta", "parcial"])
        .gt("monto_disponible", 0)
        .order("created_at", { ascending: true });

      let retiradosLista: string[] = [];
      if (sala.carrera_activa_id) {
        try {
          const { data: cRow } = await supabaseAdmin
            .from("carreras")
            .select("ejemplares_retirados")
            .eq("id", sala.carrera_activa_id)
            .maybeSingle();
          if (cRow?.ejemplares_retirados && Array.isArray(cRow.ejemplares_retirados)) {
            retiradosLista = cRow.ejemplares_retirados;
          }
        } catch {}
      }

      const planoTexto = await generarTextoPlanoOficial(sala, ticketsPlano || [], propsPlano || [], retiradosLista);

      await supabaseAdmin.from("chat_mensajes").insert({
        grupo_id: grupoId,
        sala_id: salaId,
        remitente_nombre: "🤖 ASISTENTE DE SALA",
        es_operador: true,
        tipo_mensaje: "sistema",
        contenido: planoTexto,
        whatsapp_msg_id: whatsappMsgId || null,
        whatsapp_group_jid: groupJid || null,
        whatsapp_group_nombre: whatsappGroupNombre || null,
        origen_canal: "WHATSAPP",
      });
      await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

      return respuestaSala({
        ok: true,
        tipo: "PLANO_OFICIAL",
        respuestaGrupo: planoTexto,
        msg_publico: planoTexto,
        msg_publico_bot: planoTexto,
        respuestaPublica: planoTexto,
        mensajePrivadoAutor: null,
        senderJid: participantJid,
      });
    }

    if (esComandoCerrar) {
      const esOp = Boolean(body.esMensajePropioTelefono) || Boolean(body.esOperador) || (await verificarEsOperador(cliente?.id, telReal || participantJid, grupoId));
      if (esOp) {
        await supabaseAdmin
          .from("salas_juego")
          .update({
            estado_carrera: "cerrada",
            carrera_recien_cerrada_id: sala.carrera_activa_id || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", salaId);

        const hipo = String(sala.hipodromo_activo || "HIPÓDROMO").toUpperCase();
        const numCarrera = sala.numero_carrera_activa || 1;
        const mapaCierreChat = await cargarPlantillasGrupo(sala?.grupo_id || grupoId);
        const msgCierre = obtenerPlantillaGrupo(
          mapaCierreChat,
          "cierre_carrera",
          {
            ...variablesEncabezadoGrupo(sala, "cierre"),
            hipodromo: hipo,
            carrera: numCarrera,
          },
          `${encabezadoGrupo(sala, "cierre")}\n🔒 *${hipo} CARRERA ${numCarrera} CERRADA* — No más jugadas. Suerte a todos.`
        );

        await supabaseAdmin.from("chat_mensajes").insert({
          grupo_id: grupoId,
          sala_id: salaId,
          remitente_nombre: "🤖 ASISTENTE DE SALA",
          es_operador: true,
          tipo_mensaje: "sistema",
          contenido: msgCierre,
          whatsapp_msg_id: whatsappMsgId || null,
          whatsapp_group_jid: groupJid || null,
          whatsapp_group_nombre: whatsappGroupNombre || null,
          origen_canal: "WHATSAPP",
        });
        await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

        return respuestaSala({
          ok: true,
          tipo: "CIERRE_CARRERA",
          respuestaGrupo: msgCierre,
          msg_publico: msgCierre,
          msg_publico_bot: msgCierre,
          respuestaPublica: msgCierre,
          mensajePrivadoAutor: null,
          senderJid: participantJid,
        });
      }
    }

    if (matchAbrirComando && (/^(?:!)?abrir/i.test(textoUsuarioLimpio) || /^(?:!)?abierta/i.test(textoUsuarioLimpio))) {
      const esOp = Boolean(body.esMensajePropioTelefono) || Boolean(body.esOperador) || (await verificarEsOperador(cliente?.id, telReal || participantJid, grupoId));
      if (esOp) {
        // Formato: !abrir [Hipódromo] [Nro] [ret X,Y]
        const parteArgumentos = textoUsuarioLimpio.replace(/^!?(?:abrir|abierta)(?:\s+carrera)?\s*/i, "").trim();
        const matchRetApertura = parteArgumentos.match(/(?:^|\s)ret(?:irados?)?\s*[:=]?\s*([0-9\s,./·#-]+)$/i);
        const retiradosApertura = matchRetApertura
          ? matchRetApertura[1]
              .split(/[\s,]+/)
              .map((x) => x.replace(/^#/, "").trim())
              .filter(Boolean)
          : [];
        const argumentosSinRet = matchRetApertura
          ? parteArgumentos.slice(0, matchRetApertura.index).trim()
          : parteArgumentos;
        const matchAbrirBase = argumentosSinRet
          ? `!abrir ${argumentosSinRet}`.match(/^(?:!)?(?:abrir|abierta)(?:\s+carrera)?(?:\s+(.+?))?(?:\s+(?:c(?:arrera)?\s*|#\s*)?(\d{1,2}))?$/i)
          : matchAbrirComando;

        let posibleHipo = ((matchAbrirBase as RegExpMatchArray | null)?.[1] || "").trim();
        let posibleCarrera = ((matchAbrirBase as RegExpMatchArray | null)?.[2] || "").trim();
        if (!posibleCarrera && /^\d{1,2}$/.test(posibleHipo)) {
          posibleCarrera = posibleHipo;
          posibleHipo = "";
        }
        const hipoSolicitado = String(posibleHipo || sala.hipodromo_activo || "LA RINCONADA").trim();
        const hipoTab = await resolverHipodromoEnTabla(hipoSolicitado);
        if (posibleHipo && !hipoTab) {
          const msgErrHipo = limpiarEtiquetasProhibidas(
            `⚠️ El hipódromo "${hipoSolicitado}" no está registrado en la tabla oficial. No se abrió la carrera.`
          );
          return respuestaSala({
            ok: false,
            tipo: "HIPODROMO_NO_REGISTRADO",
            respuestaGrupo: msgErrHipo,
            msg_publico: msgErrHipo,
            msg_publico_bot: msgErrHipo,
            respuestaPublica: msgErrHipo,
            mensajePrivadoAutor: null,
            senderJid: participantJid,
          });
        }
        const hipoLimpio = hipoTab?.nombre || hipoSolicitado.toUpperCase();
        const numCarrera = parseInt(posibleCarrera, 10) || parseInt(sala.numero_carrera_activa, 10) || 1;

        await supabaseAdmin
          .from("salas_juego")
          .update({
            hipodromo_activo: hipoLimpio,
            numero_carrera_activa: numCarrera,
            estado_carrera: "abierta",
            updated_at: new Date().toISOString(),
          })
          .eq("id", salaId);

        if (retiradosApertura.length > 0 && sala.carrera_activa_id) {
          try {
            await supabaseAdmin
              .from("carreras")
              .update({ ejemplares_retirados: retiradosApertura })
              .eq("id", sala.carrera_activa_id);
          } catch {
            // Best-effort: la apertura no depende de este metadato.
          }
        }

        const mapaAperturaChat = await cargarPlantillasGrupo(sala?.grupo_id || grupoId);
        const msgAbrir = limpiarEtiquetasProhibidas(
          obtenerPlantillaGrupo(
            mapaAperturaChat,
            "apertura_carrera",
            {
              ...variablesEncabezadoGrupo(sala, "apertura"),
              hipodromo: hipoLimpio,
              carrera: numCarrera,
              retirados:
                retiradosApertura.length > 0
                  ? `\n🚫 Retirados: ${retiradosApertura.map((r) => `#${r}`).join(", ")}`
                  : "",
            },
            `${encabezadoGrupo(sala, "apertura")}\n` +
              `🟢 *${hipoLimpio} CARRERA ${numCarrera} ABIERTA* — Hagan sus jugadas.` +
              (retiradosApertura.length > 0
                ? `\n🚫 Retirados: ${retiradosApertura.map((r) => `#${r}`).join(", ")}`
                : "")
          )
        );

        await supabaseAdmin.from("chat_mensajes").insert({
          grupo_id: grupoId,
          sala_id: salaId,
          remitente_nombre: "🤖 ASISTENTE DE SALA",
          es_operador: true,
          tipo_mensaje: "sistema",
          contenido: msgAbrir,
          whatsapp_msg_id: whatsappMsgId || null,
          whatsapp_group_jid: groupJid || null,
          whatsapp_group_nombre: whatsappGroupNombre || null,
          origen_canal: "WHATSAPP",
        });
        await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

        return respuestaSala({
          ok: true,
          tipo: "APERTURA_CARRERA",
          respuestaGrupo: msgAbrir,
          msg_publico: msgAbrir,
          msg_publico_bot: msgAbrir,
          respuestaPublica: msgAbrir,
          mensajePrivadoAutor: null,
          senderJid: participantJid,
        });
      }
    }

    if (matchHipodromoComando) {
      const esOp = Boolean(body.esMensajePropioTelefono) || Boolean(body.esOperador) || (await verificarEsOperador(cliente?.id, telReal || participantJid, grupoId));
      if (!esOp) {
        return respuestaSala({
          ok: false,
          tipo: "NO_AUTORIZADO",
          respuestaGrupo: null,
          mensajePrivadoAutor: "⚠️ No está autorizado para cambiar el hipódromo activo.",
          senderJid: participantJid,
        });
      }
      const nombreSolicitado = String(matchHipodromoComando[1] || "")
        .trim()
        .replace(/^["']|["']$/g, "");
      const hipoTab = await resolverHipodromoEnTabla(nombreSolicitado);
      if (!hipoTab) {
        const msgErrHipo = limpiarEtiquetasProhibidas(
          `⚠️ El hipódromo "${nombreSolicitado}" no está registrado en la tabla oficial.`
        );
        return respuestaSala({
          ok: false,
          tipo: "HIPODROMO_NO_REGISTRADO",
          respuestaGrupo: msgErrHipo,
          msg_publico: msgErrHipo,
          msg_publico_bot: msgErrHipo,
          respuestaPublica: msgErrHipo,
          mensajePrivadoAutor: null,
          senderJid: participantJid,
        });
      }
      await supabaseAdmin
        .from("salas_juego")
        .update({ hipodromo_activo: hipoTab.nombre, updated_at: new Date().toISOString() })
        .eq("id", salaId);
      sala.hipodromo_activo = hipoTab.nombre;

      const msgHipodromo = limpiarEtiquetasProhibidas(
        `📍 *HIPÓDROMO ACTIVO:* ${hipoTab.nombre} — Carrera ${sala.numero_carrera_activa || 1}.`
      );
      await supabaseAdmin.from("chat_mensajes").insert({
        grupo_id: grupoId,
        sala_id: salaId,
        remitente_nombre: "🤖 ASISTENTE DE SALA",
        es_operador: true,
        tipo_mensaje: "sistema",
        contenido: msgHipodromo,
        whatsapp_msg_id: whatsappMsgId || null,
        whatsapp_group_jid: groupJid || null,
        whatsapp_group_nombre: whatsappGroupNombre || null,
        origen_canal: "WHATSAPP",
      });
      await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

      return respuestaSala({
        ok: true,
        tipo: "HIPODROMO_ACTIVO",
        respuestaGrupo: msgHipodromo,
        msg_publico: msgHipodromo,
        msg_publico_bot: msgHipodromo,
        respuestaPublica: msgHipodromo,
        mensajePrivadoAutor: null,
        senderJid: participantJid,
      });
    }

    if (matchRetirarCarreraComando) {
      const esOp = Boolean(body.esMensajePropioTelefono) || Boolean(body.esOperador) || (await verificarEsOperador(cliente?.id, telReal || participantJid, grupoId));
      if (!esOp) {
        return respuestaSala({
          ok: false,
          tipo: "NO_AUTORIZADO",
          respuestaGrupo: null,
          mensajePrivadoAutor: "⚠️ No está autorizado para procesar retirados.",
          senderJid: participantJid,
        });
      }
      const ejemplar = String(matchRetirarCarreraComando[1] || "").trim().replace(/^#/, "");
      if (!ejemplar) {
        return respuestaSala({
          ok: false,
          tipo: "RETIRO_ARGUMENTOS",
          respuestaGrupo: limpiarEtiquetasProhibidas("⚠️ Uso correcto: !retirar [ejemplar]"),
          mensajePrivadoAutor: null,
          senderJid: participantJid,
        });
      }
      if (String(sala.estado_carrera || "").toLowerCase() === "liquidada") {
        return respuestaSala({
          ok: false,
          tipo: "CARRERA_LIQUIDADA",
          respuestaGrupo: limpiarEtiquetasProhibidas("⚠️ Carrera liquidada: reversa la liquidación antes de procesar retirados."),
          mensajePrivadoAutor: null,
          senderJid: participantJid,
        });
      }
      const carreraEfectivaId = sala.carrera_activa_id || sala.carrera_recien_cerrada_id || null;
      const { data: retRes, error: errRet } = await supabaseAdmin.rpc("procesar_retirado_en_sala", {
        p_grupo_id: grupoId,
        p_sala_id: salaId,
        p_carrera_id: carreraEfectivaId,
        p_ejemplar_retirado: ejemplar,
      });
      if (errRet || (retRes as any)?.ok === false) {
        const msgErrRetiro = limpiarEtiquetasProhibidas(
          `⚠️ No se pudo procesar el retiro del ejemplar #${ejemplar}: ${errRet?.message || (retRes as any)?.error || (retRes as any)?.motivo || "error desconocido"}`
        );
        return respuestaSala({
          ok: false,
          tipo: "ERROR_RETIRO_EJEMPLAR",
          respuestaGrupo: msgErrRetiro,
          msg_publico: msgErrRetiro,
          msg_publico_bot: msgErrRetiro,
          respuestaPublica: msgErrRetiro,
          mensajePrivadoAutor: null,
          senderJid: participantJid,
        });
      }
      const msgRetirado = limpiarEtiquetasProhibidas(
        `🚫 EJEMPLAR RETIRADO: Se ha procesado el retiro del ejemplar #${ejemplar}. Las jugadas pactadas han sido anuladas y los saldos restituidos.`
      );
      await supabaseAdmin.from("chat_mensajes").insert({
        grupo_id: grupoId,
        sala_id: salaId,
        remitente_nombre: "🤖 ASISTENTE DE SALA",
        es_operador: true,
        tipo_mensaje: "sistema",
        contenido: msgRetirado,
        whatsapp_msg_id: whatsappMsgId || null,
        whatsapp_group_jid: groupJid || null,
        whatsapp_group_nombre: whatsappGroupNombre || null,
        origen_canal: "WHATSAPP",
      });
      await emitirBroadcastSala(salaId, "ejemplar_retirado", { salaId, ejemplar });
      await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

      return respuestaSala({
        ok: true,
        tipo: "RETIRO_EJEMPLAR",
        respuestaGrupo: msgRetirado,
        msg_publico: msgRetirado,
        msg_publico_bot: msgRetirado,
        respuestaPublica: msgRetirado,
        mensajePrivadoAutor: null,
        senderJid: participantJid,
      });
    }

    if (matchCreditoOperador) {
      const esOp = Boolean(body.esMensajePropioTelefono) || Boolean(body.esOperador) || (await verificarEsOperador(cliente?.id, telReal || participantJid, grupoId));
      if (!esOp) {
        return respuestaSala({
          ok: false,
          tipo: "NO_AUTORIZADO",
          respuestaGrupo: null,
          mensajePrivadoAutor: "⚠️ No está autorizado para acreditar saldo o aval.",
          senderJid: participantJid,
        });
      }
      const esAval = String(matchCreditoOperador[1] || "").toLowerCase() === "aval";
      const targetNombre = String(matchCreditoOperador[2] || "").trim();
      const { monto } = extraerMontoNumerico(String(matchCreditoOperador[3] || ""));
      if (!targetNombre || !(monto > 0)) {
        const msgErrCredito = limpiarEtiquetasProhibidas(
          `⚠️ Uso correcto: !${esAval ? "aval" : "recargar"} [Jugador] [Monto]`
        );
        return respuestaSala({
          ok: false,
          tipo: "CREDITO_ARGUMENTOS",
          respuestaGrupo: msgErrCredito,
          msg_publico: msgErrCredito,
          msg_publico_bot: msgErrCredito,
          respuestaPublica: msgErrCredito,
          mensajePrivadoAutor: null,
          senderJid: participantJid,
        });
      }

      const { data: candidatos } = await supabaseAdmin
        .from("clientes")
        .select(CAMPOS_CLIENTE_SALA)
        .eq("grupo_id", grupoId);
      const targetLimpio = targetNombre.toUpperCase();
      const targetCliente = (candidatos || []).find((c: any) => {
        const n = String(c.nombre || "").trim().toUpperCase();
        const s = String(c.seudonimo || "").trim().toUpperCase();
        return n === targetLimpio || s === targetLimpio || n.includes(targetLimpio) || (s && s.includes(targetLimpio));
      });

      if (!targetCliente) {
        const msgNoCliente = limpiarEtiquetasProhibidas(
          `⚠️ Jugador "${targetNombre}" no encontrado en este grupo.`
        );
        return respuestaSala({
          ok: false,
          tipo: "JUGADOR_NO_ENCONTRADO",
          respuestaGrupo: msgNoCliente,
          msg_publico: msgNoCliente,
          msg_publico_bot: msgNoCliente,
          respuestaPublica: msgNoCliente,
          mensajePrivadoAutor: null,
          senderJid: participantJid,
        });
      }

      const saldoActual = Number(targetCliente.saldo_actual || 0);
      const avalActual = Number(targetCliente.aval || (targetCliente as any).limite_credito || 0);
      const retenido = Number(targetCliente.saldo_retenido || 0);
      const nuevoSaldo = esAval ? saldoActual : Number((saldoActual + monto).toFixed(2));
      const nuevoAval = esAval ? Number((avalActual + monto).toFixed(2)) : avalActual;
      const nuevoDisponible = targetCliente.libre
        ? 999999
        : Math.max(0, Number((nuevoSaldo + nuevoAval - retenido).toFixed(2)));

      await supabaseAdmin
        .from("clientes")
        .update({
          saldo_actual: nuevoSaldo,
          aval: nuevoAval,
          saldo_disponible: nuevoDisponible,
          updated_at: new Date().toISOString(),
        })
        .eq("id", targetCliente.id);

      await supabaseAdmin.from("libro_mayor_clientes").insert({
        cliente_id: targetCliente.id,
        cliente_nombre: targetCliente.nombre,
        grupo_id: grupoId,
        tipo_movimiento: "DEPOSITO",
        monto_centavos: Math.round(monto * 100),
        monto,
        observacion: esAval ? "Aval otorgado por operador WhatsApp" : "Recarga operador WhatsApp",
        creado_por: body.pushName || body.senderNombre || "OPERADOR_WHATSAPP",
        fecha_carrera: new Date().toISOString().split("T")[0],
      });

      const nombreFinal = targetCliente.seudonimo || targetCliente.nombre;
      const msgPublico = limpiarEtiquetasProhibidas(
        esAval
          ? `✅ Aval acreditado a *${nombreFinal}*: $${formatearMontoRegional(monto)}. Aval total: $${formatearMontoRegional(nuevoAval)}.`
          : `✅ Recarga acreditada a *${nombreFinal}*: $${formatearMontoRegional(monto)}. Nuevo saldo: $${formatearMontoRegional(nuevoSaldo)}.`
      );
      const msgPrivado = limpiarEtiquetasProhibidas(
        esAval
          ? `🛡️ Se ha acreditado un aval de $${formatearMontoRegional(monto)} a tu cuenta. Tu aval disponible es $${formatearMontoRegional(nuevoAval)} y tu saldo disponible es $${formatearMontoRegional(nuevoDisponible)}.`
          : `💰 Tu cuenta ha sido acreditada con $${formatearMontoRegional(monto)}. Tu nuevo saldo disponible es $${formatearMontoRegional(nuevoDisponible)}.`
      );

      await supabaseAdmin.from("chat_mensajes").insert({
        grupo_id: grupoId,
        sala_id: salaId,
        remitente_nombre: "🤖 ASISTENTE DE SALA",
        es_operador: true,
        tipo_mensaje: "sistema",
        contenido: msgPublico,
        whatsapp_msg_id: whatsappMsgId || null,
        whatsapp_group_jid: groupJid || null,
        whatsapp_group_nombre: whatsappGroupNombre || null,
        origen_canal: "WHATSAPP",
      });
      await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

      const jidTarget = targetCliente.whatsapp_jid || (targetCliente.telefono_normalizado ? `${targetCliente.telefono_normalizado}@s.whatsapp.net` : null);

      return respuestaSala({
        ok: true,
        tipo: esAval ? "AVAL_OPERADOR" : "RECARGA_OPERADOR",
        respuestaGrupo: msgPublico,
        msg_publico: msgPublico,
        msg_publico_bot: msgPublico,
        respuestaPublica: msgPublico,
        mensajePrivadoAutor: null,
        notificaciones_privadas: jidTarget ? [{ whatsapp_jid: jidTarget, mensaje: msgPrivado }] : [],
        senderJid: participantJid,
      });
    }

    if (matchPizarraComando || matchRectificarComando) {
      const esOp = Boolean(body.esMensajePropioTelefono) || Boolean(body.esOperador) || (await verificarEsOperador(cliente?.id, telReal || participantJid, grupoId));
      if (!esOp) {
        return respuestaSala({
          ok: false,
          tipo: "NO_AUTORIZADO",
          respuestaGrupo: null,
          mensajePrivadoAutor: "⚠️ No está autorizado para sentenciar o rectificar resultados oficiales.",
          senderJid: participantJid,
        });
      }

      const esRectificacion = Boolean(matchRectificarComando);
      const pizarraRaw = (matchPizarraComando?.[1] || matchRectificarComando?.[1] || "").trim();

      const resSentencia = await liquidarYSentenciarCarreraPlataforma({
        sala,
        pizarra: pizarraRaw,
        esRectificacion,
        operadorNombre: String(body.senderNombre || body.pushName || nombreJugador || "OPERADOR_WHATSAPP"),
        origenMsgId: whatsappMsgId || null,
      });

      if (!resSentencia.ok) {
        return respuestaSala({
          ok: false,
          tipo: "ERROR_PIZARRA",
          respuestaGrupo: `⚠️ ${resSentencia.error || "Formato de pizarra inválido"}`,
          mensajePrivadoAutor: null,
          senderJid: participantJid,
        });
      }

      return respuestaSala({
        ok: true,
        tipo: esRectificacion ? "RECTIFICACION_PIZARRA" : "SENTENCIA_PIZARRA",
        respuestaGrupo: resSentencia.textoResultado,
        msg_publico: resSentencia.textoResultado,
        msg_publico_bot: resSentencia.textoResultado,
        respuestaPublica: resSentencia.textoResultado,
        mensajePrivadoAutor: null,
        senderJid: participantJid,
      });
    }

    if (esConsultaSaldo) {
      const saldoActualFmt = formatearMontoRegional(Number(cliente.saldo_actual || 0));
      const avalFmt = formatearMontoRegional(Number(cliente.aval || cliente.limite_credito || 0));
      const retenidoFmt = formatearMontoRegional(Number(cliente.saldo_retenido || 0));
      const dispFmt = formatearMontoRegional(cliente.libre ? 999999 : Number(cliente.saldo_disponible || 0));

      const msgSaldoDm =
        `💰 *CONSULTA DE SALDO*\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 *Jugador:* ${nombreJugador}\n` +
        `💵 *Saldo Actual:* $${saldoActualFmt}\n` +
        `🛡️ *Aval / Crédito:* $${avalFmt}\n` +
        `⏳ *Retenido:* $${retenidoFmt}\n` +
        `🟢 *Saldo Disponible:* $${dispFmt}`;

      return respuestaSala({
        ok: true,
        tipo: "CONSULTA_SALDO",
        respuestaGrupo: null,
        msg_publico: null,
        msg_publico_bot: null,
        respuestaPublica: null,
        mensajePrivadoAutor: msgSaldoDm,
        msg_privado_bot: msgSaldoDm,
        alertaPrivada: null,
        notificaciones_privadas: [],
        senderJid: participantJid,
      });
    }

    if (esConsultaCuenta) {
      const resumenDm = await construirResumenEstadoCuentaCliente(cliente, grupoId);

      return respuestaSala({
        ok: true,
        tipo: "CONSULTA_CUENTA",
        respuestaGrupo: null,
        msg_publico: null,
        msg_publico_bot: null,
        respuestaPublica: null,
        mensajePrivadoAutor: resumenDm,
        msg_privado_bot: resumenDm,
        alertaPrivada: null,
        notificaciones_privadas: [],
        senderJid: participantJid,
      });
    }
    }

    const ejecutarAmpliacionCupo = async (
      quotedPropuestaId: string | null,
      nuevoTope: number | null
    ) => {
      const { data: dataAmp, error: errAmp } = await supabaseAdmin.rpc(
        "ampliar_cupo_propuesta_fifo_atomica",
        {
          p_grupo_id: grupoId,
          p_sala_id: salaId,
          p_proponente_id: cliente.id,
          p_propuesta_msg_id: quotedPropuestaId || null,
          p_nuevo_tope_total: nuevoTope,
        }
      );

      if (errAmp || !dataAmp || (dataAmp as any).ok === false) {
        const msgErrPublico = (dataAmp as any)?.msg_publico || (dataAmp as any)?.msg_publico_bot || (dataAmp as any)?.respuestaPublica || null;
        const msgErrPrivado =
          (dataAmp as any)?.msg_privado_proponente ||
          (dataAmp as any)?.msg_privado_bot ||
          (dataAmp as any)?.alertaPrivada ||
          (dataAmp as any)?.error ||
          (dataAmp as any)?.motivo ||
          errAmp?.message ||
          "No se pudo ampliar el cupo de la propuesta.";
        return respuestaSala({
          ok: false,
          tipo: "AMPLIACION_ERROR",
          respuestaGrupo: msgErrPublico,
          msg_publico: msgErrPublico,
          msg_publico_bot: msgErrPublico,
          respuestaPublica: msgErrPublico,
          mensajePrivadoAutor: msgErrPrivado,
          msg_privado_bot: (dataAmp as any)?.msg_privado_bot || msgErrPrivado,
          msg_privado_proponente: (dataAmp as any)?.msg_privado_proponente || msgErrPrivado,
          alertaPrivada: (dataAmp as any)?.alertaPrivada || null,
          notificaciones_privadas: (dataAmp as any)?.notificaciones_privadas || [],
          senderJid: participantJid,
        });
      }

      const msgPublico: string | null =
        (dataAmp as any).msg_publico ||
        (dataAmp as any).msg_publico_bot ||
        (dataAmp as any).respuestaPublica ||
        null;
      if (msgPublico) {
        await supabaseAdmin.from("chat_mensajes").insert({
          grupo_id: grupoId,
          sala_id: salaId,
          remitente_nombre: "🤖 ASISTENTE DE SALA",
          es_operador: true,
          tipo_mensaje: "concrecion_fifo",
          contenido: msgPublico,
          whatsapp_msg_id: whatsappMsgId || null,
          whatsapp_group_jid: groupJid || null,
          whatsapp_group_nombre: whatsappGroupNombre || null,
          origen_canal: "WHATSAPP",
        });
        await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });
      }

      const notificaciones: any[] = Array.isArray((dataAmp as any).notificaciones_privadas)
        ? (dataAmp as any).notificaciones_privadas
        : [];
      for (const notif of notificaciones) {
        const msgPriv = notif?.mensaje || notif?.msg || notif?.texto;
        if (!msgPriv) continue;
        let destinoJid = notif?.whatsapp_jid || notif?.jid || notif?.telefono || null;
        if (!destinoJid && (notif?.cliente_id || notif?.jugador_id)) {
          const { data: clDest } = await supabaseAdmin
            .from("clientes")
            .select("whatsapp_jid, telefono, telefono_normalizado")
            .eq("id", notif.cliente_id || notif.jugador_id)
            .maybeSingle();
          destinoJid =
            clDest?.whatsapp_jid ||
            (clDest?.telefono_normalizado ? `${clDest.telefono_normalizado}@s.whatsapp.net` : null) ||
            clDest?.telefono ||
            null;
        }
        if (destinoJid) {
          try {
            await fetch(`${BOT_DAEMON_URL}/enviar-privado`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-internal-bot-secret": INTERNAL_BOT_SECRET,
              },
              body: JSON.stringify({ telefonoOjid: destinoJid, texto: msgPriv }),
            });
          } catch {
            // No bloqueante si el bot daemon está offline
          }
        }
      }

      const msgPrivadoProponente =
        (dataAmp as any).msg_privado_proponente ||
        (dataAmp as any).msg_privado_bot ||
        (dataAmp as any).alertaPrivada ||
        null;

      return respuestaSala({
        ok: true,
        tipo: "AMPLIACION_CUPO",
        respuestaGrupo: msgPublico,
        msg_publico: msgPublico,
        msg_publico_bot: (dataAmp as any).msg_publico_bot || msgPublico,
        respuestaPublica: (dataAmp as any).respuestaPublica || msgPublico,
        mensajePrivadoAutor: msgPrivadoProponente,
        msg_privado_bot: (dataAmp as any).msg_privado_bot || msgPrivadoProponente,
        msg_privado_proponente: msgPrivadoProponente,
        alertaPrivada: (dataAmp as any).alertaPrivada || null,
        notificaciones_privadas: notificaciones,
        notificacionesPrivadas: notificaciones,
        senderJid: participantJid,
        data: dataAmp,
      });
    };

    // ========================================================================
    // FLUJO A: CONCRECIÓN SECUENCIAL POR RESPUESTA CITADA (quotedMsgId)
    // ========================================================================
    if (quotedMsgId) {
      const esUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(quotedMsgId);
      let queryProp = supabaseAdmin
        .from("chat_mensajes")
        .select("*")
        .eq("sala_id", salaId);

      if (esUuid) {
        queryProp = queryProp.or(`whatsapp_msg_id.eq.${quotedMsgId},id.eq.${quotedMsgId}`);
      } else {
        queryProp = queryProp.eq("whatsapp_msg_id", quotedMsgId);
      }

      const { data: propMsg, error: errProp } = await queryProp.limit(1).maybeSingle();

      if (
        !propMsg ||
        (propMsg.tipo_mensaje !== "propuesta_jugada" && propMsg.tipo_mensaje !== "PROPUESTA")
      ) {
        return respuestaSala({
          ok: false,
          tipo: "IGNORADO",
          respuestaGrupo: null,
          mensajePrivadoAutor: null,
        });
      }

      if (!carreraAbierta) {
        return respuestaSala({
          ok: false,
          tipo: "CARRERA_CERRADA",
          respuestaGrupo: `⛔ La carrera se encuentra ${String(sala.estado_carrera || "CERRADA").toUpperCase()}. No se admiten concreciones.`,
          mensajePrivadoAutor: null,
        });
      }

      // 1. Comando de retiro de propuesta citada por su autor ("Se Fue")
      const cmdRetiroCita = analizarComandoRetiro(texto);
      if (cmdRetiroCita.esComandoRetiro) {
        if (!cmdRetiroCita.esValido) {
          return respuestaSala({
            ok: false,
            tipo: "PEDAGOGICO",
            respuestaGrupo: null,
            mensajePrivadoAutor:
              cmdRetiroCita.mensajeAclaratoria ||
              "Por favor aclara si deseas retirar tu propuesta con: 'Se fue' o 'sf'",
          });
        }

        if (propMsg.remitente_id !== cliente.id) {
          return respuestaSala({
            ok: false,
            tipo: "NO_AUTORIZADO",
            respuestaGrupo: null,
            mensajePrivadoAutor: "⚠️ Solo el autor de la propuesta puede retirarla con 'Se fue'.",
          });
        }

        const { data: rpcSeFue, error: errSeFue } = await supabaseAdmin.rpc(
          "cerrar_propuestas_se_fue_atomica",
          {
            p_grupo_id: grupoId,
            p_sala_id: salaId,
            p_jugador_id: cliente.id,
            p_propuesta_id: propMsg.id,
          }
        );

        if (errSeFue || rpcSeFue?.ok === false) {
          return respuestaSala({
            ok: false,
            tipo: "ERROR_RETIRO",
            respuestaGrupo: rpcSeFue?.msg_publico_bot || null,
            msg_publico_bot: rpcSeFue?.msg_publico_bot || null,
            msg_privado_bot: rpcSeFue?.msg_privado_bot || null,
            clienteTelefono: resolverTelefonoWhatsappCliente(cliente),
            error: errSeFue?.message || rpcSeFue?.error || "No se pudo retirar la propuesta",
          });
        }

        const remanenteRetirar = Number(rpcSeFue?.monto_liberado ?? propMsg.monto_disponible ?? propMsg.monto_original ?? 0);
        const jugadaTexto = propMsg.jugada_estandarizada || propMsg.contenido || "propuesta";
        const msgRetiroCita = rpcSeFue?.msg_publico_bot || `🚫 *Se Fue* — ${nombreJugador} retiró su propuesta (${jugadaTexto}).`;
        const msgPrivadoCita = rpcSeFue?.msg_privado_bot || `✅ Tu propuesta (${jugadaTexto}) fue retirada ("Se fue"). Saldo liberado: $${formatearMontoRegional(remanenteRetirar)}.`;

        await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

        return respuestaSala({
          ok: true,
          tipo: "RETIRO_PROPUESTA_ESPECIFICA",
          respuestaGrupo: msgRetiroCita,
          msg_publico: msgRetiroCita,
          msg_publico_bot: msgRetiroCita,
          respuestaPublica: msgRetiroCita,
          msg_privado_bot: msgPrivadoCita,
          mensajePrivadoAutor: msgPrivadoCita,
          clienteTelefono: resolverTelefonoWhatsappCliente(cliente),
          senderJid: participantJid,
        });
      }

      if (propMsg.remitente_id === cliente.id) {
        const amp = evaluarAmpliacionPropuesta(texto);
        if (amp.esAmpliacion) {
          return await ejecutarAmpliacionCupo(propMsg.id, amp.nuevoTope);
        }
        return respuestaSala({
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

        // 2. Vencimiento por Tiempo (X minutos): Si superó el tiempo, expirada + devolver saldo retenido
        const tiempoVencimientoMin = Number(sala.tiempo_vencimiento_propuesta_min || sala.tiempo_vencimiento_min || 5);
        const fechaPropMs = propFresca?.created_at ? new Date(propFresca.created_at).getTime() : Date.now();
        const minutosTranscurridos = (Date.now() - fechaPropMs) / (1000 * 60);

        if (minutosTranscurridos > tiempoVencimientoMin && estadoProp !== "expirada") {
          await supabaseAdmin
            .from("chat_mensajes")
            .update({ estado_propuesta: "expirada", monto_disponible: 0 })
            .eq("id", propFresca.id);

          if (remanenteDisponible > 0) {
            const { data: propOwner } = await supabaseAdmin
              .from("clientes")
              .select("id, saldo_retenido, saldo_actual, aval, libre")
              .eq("id", propFresca.remitente_id)
              .maybeSingle();

            if (propOwner && !propOwner.libre) {
              const nuevoRet = Math.max(0, Number((Number(propOwner.saldo_retenido || 0) - remanenteDisponible).toFixed(2)));
              await supabaseAdmin
                .from("clientes")
                .update({
                  saldo_retenido: nuevoRet,
                  saldo_disponible: Math.max(
                    0,
                    Number((Number(propOwner.saldo_actual || 0) + Number(propOwner.aval || 0) - nuevoRet).toFixed(2))
                  ),
                })
                .eq("id", propOwner.id);
            }
          }

          const msgFueraTiempo = "❌⏰ Nada aquí, fuera de tiempo";
          await supabaseAdmin.from("chat_mensajes").insert({
            grupo_id: grupoId,
            sala_id: salaId,
            remitente_nombre: "🤖 ASISTENTE DE SALA",
            es_operador: true,
            tipo_mensaje: "concrecion_fifo",
            contenido: msgFueraTiempo,
            whatsapp_msg_id: whatsappMsgId || null,
            whatsapp_group_jid: groupJid || null,
            whatsapp_group_nombre: whatsappGroupNombre || null,
            origen_canal: "WHATSAPP",
          });

          await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

          return respuestaSala({
            ok: false,
            tipo: "FUERA_DE_TIEMPO",
            nada_aqui: true,
            respuestaGrupo: msgFueraTiempo,
            msg_publico: msgFueraTiempo,
            msg_publico_bot: msgFueraTiempo,
            respuestaPublica: msgFueraTiempo,
            mensajePrivadoAutor: "Esta propuesta superó el tiempo máximo de vigencia y ha expirado.",
            senderJid: participantJid,
          });
        }

        if (
          remanenteDisponible <= 0 ||
          (estadoProp !== "abierta" && estadoProp !== "parcial")
        ) {
          return respuestaSala({
            ok: false,
            tipo: "PROPUESTA_AGOTADA",
            respuestaGrupo: `⚠️ Esta parada ya fue tomada al 100% o no tiene saldo disponible.`,
            mensajePrivadoAutor: null,
          });
        }

        // Recalcular saldo fresco de ambos jugadores dentro del candado FIFO
        const { data: aceptanteFresco } = await supabaseAdmin
          .from("clientes")
          .select(
            "id, nombre, seudonimo, saldo_actual, saldo_retenido, libre, aval, whatsapp_jid, telefono"
          )
          .eq("id", cliente.id)
          .single();

        const { data: proponenteRow } = await supabaseAdmin
          .from("clientes")
          .select(
            "id, nombre, seudonimo, saldo_actual, saldo_retenido, libre, aval, whatsapp_jid, telefono, telefono_normalizado"
          )
          .eq("id", propFresca.remitente_id)
          .maybeSingle();

        const accionProp: "JUEGA" | "CONSIGUE" =
          String(propFresca.accion_proponente || "").toUpperCase() === "CONSIGUE" ||
          /^(consigo|doy)\b/i.test(String(propFresca.contenido || ""))
            ? "CONSIGUE"
            : "JUEGA";

        const propRawCheck = String(propFresca.proporcion_premio || propFresca.proporcion || "1x1").trim();
        const factorPropBilat = calcularRiesgoReal(1, propRawCheck, accionProp, "PROPONENTE") || 1;
        const factorAcepBilat = calcularRiesgoReal(1, propRawCheck, accionProp, "ACEPTANTE") || 1;

        const saldoDispAceptante = calcularSaldoDisponible(aceptanteFresco || cliente);
        const saldoDispProponente = proponenteRow ? calcularSaldoDisponible(proponenteRow) : remanenteDisponible;

        const maxBaseAceptante = (aceptanteFresco || cliente)?.libre
          ? remanenteDisponible
          : Math.floor((saldoDispAceptante / factorAcepBilat) * 100) / 100;
        const maxBaseProponente =
          !proponenteRow || proponenteRow.libre
            ? remanenteDisponible
            : Math.floor((saldoDispProponente / factorPropBilat) * 100) / 100;

        if (maxBaseAceptante <= 0) {
          const saldoFmt = formatearMontoRegional(Math.max(0, saldoDispAceptante));
          return respuestaSala({
            ok: false,
            tipo: "SIN_SALDO",
            respuestaGrupo: `⚠️ *${nombreJugador}* dispone de $${saldoFmt}`,
            msg_publico: `⚠️ *${nombreJugador}* dispone de $${saldoFmt}`,
            msg_publico_bot: `⚠️ *${nombreJugador}* dispone de $${saldoFmt}`,
            respuestaPublica: `⚠️ *${nombreJugador}* dispone de $${saldoFmt}`,
            mensajePrivadoAutor: `⚠️ Nos agrada tenerlo en el grupo, por favor no exceda su saldo, ajuste el monto de sus jugadas. Muchas gracias.`,
            msg_privado_bot: `⚠️ Nos agrada tenerlo en el grupo, por favor no exceda su saldo, ajuste el monto de sus jugadas. Muchas gracias.`,
            clienteTelefono: resolverTelefonoWhatsappCliente(cliente),
            senderJid: participantJid,
          });
        }

        if (maxBaseProponente <= 0) {
          const nomProp = proponenteRow?.seudonimo || proponenteRow?.nombre || propFresca.remitente_nombre || "Proponente";
          const saldoPropFmt = formatearMontoRegional(Math.max(0, saldoDispProponente));
          await supabaseAdmin
            .from("chat_mensajes")
            .update({ estado_propuesta: "cerrada", monto_disponible: 0 })
            .eq("id", propFresca.id);
          return NextResponse.json({
            ok: false,
            tipo: "SIN_SALDO_PROPONENTE",
            respuestaGrupo: `⚠️ *${nomProp}* ya no dispone de saldo suficiente ($${saldoPropFmt}). Propuesta cerrada.`,
            msg_publico: `⚠️ *${nomProp}* ya no dispone de saldo suficiente ($${saldoPropFmt}). Propuesta cerrada.`,
            msg_publico_bot: `⚠️ *${nomProp}* ya no dispone de saldo suficiente ($${saldoPropFmt}). Propuesta cerrada.`,
            senderJid: participantJid,
          });
        }

        // Evaluar palabras estrictas según diccionario direccional (recortando al Pozo real de ambos)
        const evalConcrecion = evaluarConcrecionEstricta(
          texto,
          accionProp,
          remanenteDisponible,
          Math.max(0, Math.min(maxBaseAceptante, maxBaseProponente)),
          nombreJugador,
          undefined,
          codigoSala,
          Boolean(quotedMsgId)
        );

        if (!evalConcrecion.valido) {
          // Si no tenía saldo en absoluto
          if (saldoDispAceptante <= 0 && evalConcrecion.montoSolicitado > 0) {
            const saldoFmt = formatearMontoRegional(Math.max(0, saldoDispAceptante));
            return respuestaSala({
              ok: false,
              tipo: "SIN_SALDO",
              respuestaGrupo: `⚠️ *${nombreJugador}* dispone de $${saldoFmt}`,
              msg_publico: `⚠️ *${nombreJugador}* dispone de $${saldoFmt}`,
              msg_publico_bot: `⚠️ *${nombreJugador}* dispone de $${saldoFmt}`,
              respuestaPublica: `⚠️ *${nombreJugador}* dispone de $${saldoFmt}`,
              mensajePrivadoAutor: `⚠️ Nos agrada tenerlo en el grupo, por favor no exceda su saldo, ajuste el monto de sus jugadas. Muchas gracias.`,
              msg_privado_bot: `⚠️ Nos agrada tenerlo en el grupo, por favor no exceda su saldo, ajuste el monto de sus jugadas. Muchas gracias.`,
              clienteTelefono: resolverTelefonoWhatsappCliente(cliente),
              senderJid: participantJid,
            });
          }

          // Palabra no autorizada -> Enseñanza pedagógica en privado sin ensuciar el grupo
          return respuestaSala({
            ok: false,
            tipo: "PEDAGOGICO",
            respuestaGrupo: null,
            mensajePrivadoAutor:
              evalConcrecion.motivoRechazo ||
              "Palabra no autorizada para concretar esta jugada.",
          });
        }

        // 3. Validación de Apuesta Mínima (salvo que el remanente sea menor)
        const apuestaMinima = Number(sala.apuesta_minima || 10.00);
        if (evalConcrecion.montoSolicitado < apuestaMinima && remanenteDisponible >= apuestaMinima) {
          const msgMinimoBot = `⛔ *Nada aquí* — El monto mínimo de apuesta es $${formatearMontoRegional(apuestaMinima)}`;
          await supabaseAdmin.from("chat_mensajes").insert({
            grupo_id: grupoId,
            sala_id: salaId,
            remitente_nombre: "🤖 ASISTENTE DE SALA",
            es_operador: true,
            tipo_mensaje: "concrecion_fifo",
            contenido: msgMinimoBot,
            whatsapp_msg_id: whatsappMsgId || null,
            whatsapp_group_jid: groupJid || null,
            whatsapp_group_nombre: whatsappGroupNombre || null,
            origen_canal: "WHATSAPP",
          });
          await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });
          return respuestaSala({
            ok: false,
            tipo: "APUESTA_MINIMA",
            nada_aqui: true,
            respuestaGrupo: msgMinimoBot,
            msg_publico: msgMinimoBot,
            msg_publico_bot: msgMinimoBot,
            respuestaPublica: msgMinimoBot,
            mensajePrivadoAutor: `El monto mínimo de apuesta configurado es $${formatearMontoRegional(apuestaMinima)}.`,
            senderJid: participantJid,
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
        let resRpcData: any = null;
        let errorConcretar: any = null;

        // Si la carrera está abierta pero la sala no tiene carrera_activa_id, resolverla/crearla antes del RPC.
        if (
          String(sala.estado_carrera || "").toLowerCase() === "abierta" &&
          !sala.carrera_activa_id
        ) {
          await asegurarCarreraActivaSala(sala);
        }

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
          resRpcData = resRpc;
          if (errRpc) errorConcretar = errRpc;
          if (!errRpc && resRpc && (resRpc as any).ok === false && (resRpc as any).nada_aqui !== true) {
            errorConcretar = resRpc;
          }
          if (!errRpc && resRpc && (resRpc as any).nada_aqui === true) {
            const msgPublicoNadaAqui =
              (resRpc as any).msg_publico ||
              (resRpc as any).msg_publico_bot ||
              (resRpc as any).respuestaPublica ||
              "*Nada Aquí*";
            await supabaseAdmin.from("chat_mensajes").insert({
              grupo_id: grupoId,
              sala_id: salaId,
              remitente_nombre: "🤖 ASISTENTE DE SALA",
              es_operador: true,
              tipo_mensaje: "concrecion_fifo",
              contenido: msgPublicoNadaAqui,
              whatsapp_msg_id: whatsappMsgId || null,
              whatsapp_group_jid: groupJid || null,
              whatsapp_group_nombre: whatsappGroupNombre || null,
              origen_canal: "WHATSAPP",
            });
            await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });
            return respuestaSala({
              ok: false,
              tipo: "NADA_AQUI",
              nada_aqui: true,
              respuestaGrupo: msgPublicoNadaAqui,
              msg_publico: msgPublicoNadaAqui,
              msg_publico_bot: (resRpc as any).msg_publico_bot || msgPublicoNadaAqui,
              respuestaPublica: (resRpc as any).respuestaPublica || msgPublicoNadaAqui,
              mensajePrivadoAutor:
                (resRpc as any).msg_privado_aceptante ||
                (resRpc as any).msg_privado_bot ||
                (resRpc as any).alertaPrivada ||
                null,
              msg_privado_bot: (resRpc as any).msg_privado_bot || null,
              msg_privado_aceptante: (resRpc as any).msg_privado_aceptante || null,
              alertaPrivada: (resRpc as any).alertaPrivada || null,
              notificaciones_privadas: (resRpc as any).notificaciones_privadas || [],
              senderJid: participantJid,
            });
          }
          if (!errRpc && resRpc && (resRpc as any).ok !== false) {
            rpcExitoso = true;
          }
        } catch (error) {
          errorConcretar = error;
          rpcExitoso = false;
        }

        // Fallback atómico si el RPC no fue exitoso
        if (!rpcExitoso) {
          const error = errorConcretar ?? "RPC concretar_jugada_fifo_atomica sin ok=true";
          console.error("[CONCRETAR_ERROR]", error);
          const msgErrPub = (resRpcData as any)?.msg_publico || (resRpcData as any)?.msg_publico_bot || (resRpcData as any)?.respuestaPublica || "🚫 *Error al concretar jugada* — Intente nuevamente.";
          const msgErrPriv =
            (resRpcData as any)?.msg_privado_aceptante ||
            (resRpcData as any)?.msg_privado_bot ||
            (resRpcData as any)?.alertaPrivada ||
            "La concreción no pudo ser procesada por el motor atómico.";
          return respuestaSala({
            ok: false,
            tipo: "CONCRECION_ERROR",
            respuestaGrupo: msgErrPub,
            msg_publico: msgErrPub,
            msg_publico_bot: (resRpcData as any)?.msg_publico_bot || msgErrPub,
            respuestaPublica: (resRpcData as any)?.respuestaPublica || msgErrPub,
            mensajePrivadoAutor: msgErrPriv,
            msg_privado_bot: (resRpcData as any)?.msg_privado_bot || msgErrPriv,
            msg_privado_aceptante: (resRpcData as any)?.msg_privado_aceptante || msgErrPriv,
            alertaPrivada: (resRpcData as any)?.alertaPrivada || null,
            notificaciones_privadas: (resRpcData as any)?.notificaciones_privadas || [],
            senderJid: participantJid,
          });
        }

        await sincronizarTicketsPropuestaATaquilla(supabaseAdmin, {
          propuestaMsgId: propFresca.id,
          sala,
          grupoId,
          condicionProponente: propFresca.condicion_proponente,
        });

        const esConsigueProp =
          accionProp === "CONSIGUE" ||
          /^(consigo|doy)\b/i.test(String(propFresca.contenido || ""));

        let nombreJuega = "";
        let nombreDa = "";
        if (esConsigueProp) {
          nombreDa = propFresca.remitente_nombre || "Proponente";
          nombreJuega = nombreJugador;
        } else {
          nombreJuega = propFresca.remitente_nombre || "Proponente";
          nombreDa = nombreJugador;
        }

        // Modalidad / Caballos y Proporción
        let detalleJugada = "";
        const propRaw = String(propFresca.proporcion_premio || propFresca.proporcion || "1x1").trim();
        if (propFresca.es_match) {
          const bA = Array.isArray(propFresca.caballos_bando_a)
            ? propFresca.caballos_bando_a.join("-")
            : String(propFresca.caballos_bando_a || "");
          const bB = Array.isArray(propFresca.caballos_bando_b)
            ? propFresca.caballos_bando_b.join("-")
            : String(propFresca.caballos_bando_b || "");
          let propTexto = "";
          const propParaMostrar = limpiarEtiquetasProhibidas(propRaw);
          if (propParaMostrar && !["1x1", "pp"].includes(propParaMostrar.toLowerCase())) {
            propTexto = ` ${propParaMostrar.replace("@", "/").replace(/a/i, "/")}`;
          }
          detalleJugada = `(${bA}x${bB})${propTexto}`;
        } else {
          const mod = propFresca.modalidad_propuesta || propFresca.modalidad || "";
          const ej =
            propFresca.ejemplar_texto ||
            (Array.isArray(propFresca.caballos_bando_a) ? propFresca.caballos_bando_a.join("-") : "") ||
            "";
          detalleJugada = `${mod} ${ej}`.trim() || propFresca.jugada_estandarizada || "JUGADA";
          // Puestos y ninis: NUNCA imprimen proporción
        }

        // Riesgos exactos: Proponente (Banquero Consigo/Doy o Jugador Juego) arriesga proporción (10/X); Aceptante va al 100%
        const riesgoProponente = calcularRiesgoReal(montoEfectivo, propRaw, accionProp, "PROPONENTE");
        const riesgoAceptante = calcularRiesgoReal(montoEfectivo, propRaw, accionProp, "ACEPTANTE");
        const riesgoJuega = esConsigueProp ? riesgoAceptante : riesgoProponente;
        const riesgoDa = esConsigueProp ? riesgoProponente : riesgoAceptante;

        const montoBaseFmt = formatearMontoRegional(montoEfectivo);
        const riesgoJuegaFmt = formatearMontoRegional(riesgoJuega);
        const riesgoDaFmt = formatearMontoRegional(riesgoDa);

        const montoSolicitadoTotal = Math.min(Number(evalConcrecion.montoSolicitado || montoEfectivo), remanenteDisponible);
        const pozoLimitadorBilateral =
          montoEfectivo > 0 && montoEfectivo < montoSolicitadoTotal
            ? maxBaseProponente <= maxBaseAceptante
              ? proponenteRow?.seudonimo || proponenteRow?.nombre || propFresca.remitente_nombre || "Proponente"
              : nombreJugador
            : limitadorPorPozo(
                Number(evalConcrecion.montoSolicitado || montoEfectivo),
                Number(montoEfectivo || 0),
                Number(remanenteDisponible || 0),
                Number(maxBaseAceptante || 0),
                propFresca.remitente_nombre || "Proponente",
                nombreJugador
              );

        const montoSolicitadoReal = Number(evalConcrecion.montoSolicitado || montoEfectivo);
        const esConcrecionSaldoParcial =
          llenoRemanenteParcial && montoEfectivo > 0 && montoEfectivo < montoSolicitadoReal;
        const nombreLimitador =
          pozoLimitadorBilateral ||
          (maxBaseAceptante <= maxBaseProponente ? nombreDa : nombreJuega);

        const msgPublicoFinal = esConcrecionSaldoParcial
          ? await construirMensajeSaldoParcial({
              sala,
              juega: nombreJuega,
              da: nombreDa,
              monto: montoEfectivo,
              saldoDe: nombreLimitador,
            })
          : pozoLimitadorBilateral
          ? mensajeJugaronPorPozo(propFresca, montoEfectivo, pozoLimitadorBilateral)
          : mensajeJugaronCompleto(nombreJuega, detalleJugada, nombreDa, montoEfectivo);

        const msgPrivAceptante = evalConcrecion.excedioSaldo
          ? `⚠️ Nos agrada tenerlo en el grupo, por favor no exceda su saldo, ajuste el monto de sus jugadas. Usted dispone de $${formatearMontoRegional(evalConcrecion.montoEfectivo)}. Muchas gracias.`
          : `✅ *Confirmación de Jugada*:\n` +
            `Pactaste con *${propFresca.remitente_nombre}* en *${detalleJugada}* por *$${montoBaseFmt}*.\n` +
            `Tu rol: *${nombreJugador === nombreJuega ? "Juega" : "Da"}* (Riesgo: $${nombreJugador === nombreJuega ? riesgoJuegaFmt : riesgoDaFmt}).`;

        const msgPrivProponente =
          `🔔 *Confirmación de Jugada*:\n` +
          `*${nombreJugador}* aceptó tu jugada en *${detalleJugada}* por *$${montoBaseFmt}*.\n` +
          `Tu rol: *${propFresca.remitente_nombre === nombreJuega ? "Juega" : "Da"}* (Riesgo: $${propFresca.remitente_nombre === nombreJuega ? riesgoJuegaFmt : riesgoDaFmt}).` +
          (nuevoRemanente > 0 ? `\n⏳ Quedan *$${formatearMontoRegional(nuevoRemanente)}* disponibles en tu propuesta.` : "");

        const notifs = (resRpcData as any)?.notificaciones_privadas || [];

        // Registrar mensaje de concreción en chat_mensajes
        await supabaseAdmin.from("chat_mensajes").insert({
          grupo_id: grupoId,
          sala_id: salaId,
          remitente_id: cliente.id,
          remitente_nombre: nombreJugador,
          es_operador: false,
          tipo_mensaje: "CONCRECION",
          contenido: msgPublicoFinal,
          reply_to_msg_id: propFresca.id,
          whatsapp_msg_id: whatsappMsgId,
          whatsapp_quoted_msg_id: quotedMsgId,
          whatsapp_group_jid: groupJid,
          whatsapp_group_nombre: whatsappGroupNombre,
          origen_canal: "WHATSAPP",
          carrera_id: propFresca.carrera_id || sala.carrera_activa_id,
        });

        await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

        return respuestaSala({
          ok: true,
          tipo: "CONCRECION",
          respuestaGrupo: msgPublicoFinal,
          msg_publico: msgPublicoFinal,
          msg_publico_bot: msgPublicoFinal,
          respuestaPublica: msgPublicoFinal,
          mensajePrivadoAutor: msgPrivAceptante,
          msg_privado_bot: (resRpcData as any)?.msg_privado_bot || msgPrivAceptante,
          msg_privado_aceptante: msgPrivAceptante,
          msg_privado_proponente: msgPrivProponente,
          alertaPrivada: (resRpcData as any)?.alertaPrivada || null,
          notificaciones_privadas: notifs,
          senderJid: participantJid,
          proponenteJid:
            proponenteRow?.whatsapp_jid ||
            (proponenteRow?.telefono_normalizado ? `${proponenteRow.telefono_normalizado}@s.whatsapp.net` : null) ||
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
    // FLUJO B: PROPUESTAS / CONTRAMARCHA / RETIRO DE JUGADAS
    // ========================================================================
    if (carreraAbierta) {
      const ampSinCita = evaluarAmpliacionPropuesta(texto);
      if (ampSinCita.esAmpliacion) {
        return await ejecutarAmpliacionCupo(null, ampSinCita.nuevoTope);
      }
    }

    const comandoRetiro = analizarComandoRetiro(texto);
    if (comandoRetiro.esComandoRetiro) {
      if (!comandoRetiro.esValido) {
        return respuestaSala({
          ok: false,
          tipo: "PEDAGOGICO",
          respuestaGrupo: null,
          mensajePrivadoAutor:
            comandoRetiro.mensajeAclaratoria ||
            "Por favor aclara si deseas retirar tus jugadas con: 'Se fue' o 'sf'",
        });
      }

      const { data: rpcSeFue, error: errSeFue } = await supabaseAdmin.rpc(
        "cerrar_propuestas_se_fue_atomica",
        {
          p_grupo_id: grupoId,
          p_sala_id: salaId,
          p_jugador_id: cliente.id,
          p_propuesta_id: null,
        }
      );

      if (errSeFue || rpcSeFue?.ok === false) {
        return respuestaSala({
          ok: false,
          tipo: "ERROR_RETIRO",
          respuestaGrupo: rpcSeFue?.msg_publico_bot || null,
          msg_publico_bot: rpcSeFue?.msg_publico_bot || null,
          msg_privado_bot: rpcSeFue?.msg_privado_bot || null,
          clienteTelefono: resolverTelefonoWhatsappCliente(cliente),
          error: errSeFue?.message || rpcSeFue?.error || "No se pudieron retirar las propuestas",
        });
      }

      const liberado = Number(rpcSeFue?.monto_liberado ?? 0);
      const msgPublicoRetiro = rpcSeFue?.msg_publico_bot || `🚫 *Se Fue* — Todas las propuestas abiertas de ${nombreJugador} fueron retiradas.`;
      const msgPrivadoRetiro = rpcSeFue?.msg_privado_bot || `✅ Todas tus propuestas abiertas fueron retiradas ("Se fue"). Saldo liberado: $${formatearMontoRegional(liberado)}.`;

      await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

      return respuestaSala({
        ok: true,
        tipo: "RETIRO_PROPUESTAS",
        respuestaGrupo: msgPublicoRetiro,
        msg_publico: msgPublicoRetiro,
        msg_publico_bot: msgPublicoRetiro,
        respuestaPublica: msgPublicoRetiro,
        msg_privado_bot: msgPrivadoRetiro,
        mensajePrivadoAutor: msgPrivadoRetiro,
        clienteTelefono: resolverTelefonoWhatsappCliente(cliente),
        senderJid: participantJid,
      });
    }

    // ------------------------------------------------------------------------
    // 3. APRENDIZAJE DINÁMICO: Consultar reglas y respuestas entrenadas en BD
    // para que WhatsApp responda idéntico a la Sala Web
    // ------------------------------------------------------------------------
    let respuestaAprendida: string | null = null;
    let jugadaAprendidaSugerida: string | null = null;
    try {
      const { data: revPrevia } = await supabaseAdmin
        .from("registro_revision_llm")
        .select("jugada_corregida_sugerida, respuesta_ia_enviada, intencion_detectada")
        .eq("grupo_id", grupoId)
        .ilike("mensaje_usuario_original", texto.trim())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (revPrevia) {
        respuestaAprendida = revPrevia.respuesta_ia_enviada || null;
        jugadaAprendidaSugerida = revPrevia.jugada_corregida_sugerida || null;
      }

      if (!respuestaAprendida && !jugadaAprendidaSugerida) {
        const { data: dictPrevio } = await supabaseAdmin
          .from("diccionario_aprendizaje_bot")
          .select("jugada_corregida, termino_original")
          .eq("grupo_id", grupoId)
          .ilike("termino_original", texto.trim())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (dictPrevio?.jugada_corregida) {
          jugadaAprendidaSugerida = dictPrevio.jugada_corregida;
        }
      }
    } catch {
      // Resiliente
    }

    // Analizar en bloque (multilínea o múltiples caballos separados por coma: "Juego 2p 3,5,8 con 100")
    const retirados = Array.isArray(sala.retirados) ? sala.retirados : [];
    const telefonoClienteCompleto = resolverTelefonoWhatsappCliente(cliente);

    const bloqueItems = analizarBloqueJugadas(
      texto,
      saldoDisponible,
      retirados,
      16,
      nombreJugador,
      undefined,
      codigoSala
    );
    const bloquesValidos = bloqueItems.filter((b) => b.esIntencionDeJugada && b.valido);

    if (bloquesValidos.length > 1) {
      if (!carreraAbierta) {
        const msgCerrada = `⛔ La carrera está ${String(sala.estado_carrera || "CERRADA").toUpperCase()}. No se reciben nuevas propuestas.`;
        return respuestaSala({
          ok: false,
          tipo: "CARRERA_CERRADA",
          respuestaGrupo: msgCerrada,
          msg_publico: msgCerrada,
          msg_publico_bot: msgCerrada,
          respuestaPublica: msgCerrada,
          clienteTelefono: telefonoClienteCompleto,
          senderJid: participantJid,
        });
      }

      if (saldoDisponible <= 0 && !cliente.libre) {
        const saldoFmt = formatearMontoRegional(Math.max(0, saldoDisponible));
        const msgSinSaldo = `⚠️ *${nombreJugador}* dispone de $${saldoFmt}`;
        const msgPrivSinSaldo = `⚠️ Nos agrada tenerlo en el grupo, por favor no exceda su saldo, ajuste el monto de sus jugadas. Muchas gracias.`;
        return respuestaSala({
          ok: false,
          tipo: "SIN_SALDO",
          respuestaGrupo: msgSinSaldo,
          msg_publico: msgSinSaldo,
          msg_publico_bot: msgSinSaldo,
          respuestaPublica: msgSinSaldo,
          mensajePrivadoAutor: msgPrivSinSaldo,
          msg_privado_bot: msgPrivSinSaldo,
          alertaPrivada: msgPrivSinSaldo,
          notificaciones_privadas: [],
          clienteTelefono: telefonoClienteCompleto,
          senderJid: participantJid,
        });
      }

      const pPropuestas = bloquesValidos.map((b) => ({
        accion: b.accionProponente,
        es_match: b.esMatch,
        modalidad: b.modalidad,
        caballos_a: b.caballosBandoA,
        caballos_b: b.caballosBandoB,
        ejemplar_texto: b.ejemplarTexto,
        proporcion: b.proporcion || "1x1",
        monto_solicitado: b.montoDisponibleValido ?? b.monto,
        texto_estandarizado: b.jugadaEstandarizada,
      }));

      let propIdsBloque: string[] = [];
      let excedioSaldoBloque = bloquesValidos.some((b) => Boolean(b.excedioSaldo));

      try {
        const { data: rpcBlk, error: errBlk } = await supabaseAdmin.rpc(
          "publicar_bloque_propuestas_atomica",
          {
            p_grupo_id: grupoId,
            p_sala_id: salaId,
            p_carrera_id: sala.carrera_activa_id || "00000000-0000-0000-2026-111400000001",
            p_jugador_id: cliente.id,
            p_propuestas: pPropuestas,
            p_whatsapp_msg_id: whatsappMsgId || null,
          }
        );
        if (!errBlk && rpcBlk && Array.isArray((rpcBlk as any).propuestas_ids)) {
          propIdsBloque = (rpcBlk as any).propuestas_ids;
        }
      } catch {
        // Fallback secuencial si la RPC de bloque no está en BD
      }

      if (propIdsBloque.length === 0) {
        for (const p of pPropuestas) {
          if ((p.monto_solicitado || 0) <= 0) continue;
          const { data: rpcInd } = await supabaseAdmin.rpc("publicar_propuesta_atomica", {
            p_grupo_id: grupoId,
            p_sala_id: salaId,
            p_carrera_id: sala.carrera_activa_id || "00000000-0000-0000-2026-111400000001",
            p_jugador_id: cliente.id,
            p_accion: p.accion,
            p_es_match: p.es_match,
            p_modalidad: p.modalidad,
            p_caballos_a: p.caballos_a,
            p_caballos_b: p.caballos_b,
            p_ejemplar_texto: p.ejemplar_texto,
            p_proporcion: p.proporcion,
            p_monto_solicitado: p.monto_solicitado,
            p_texto_estandarizado: p.texto_estandarizado,
          });
          if ((rpcInd as any)?.propuesta_id) {
            propIdsBloque.push((rpcInd as any).propuesta_id);
          }
        }
      }

      if (propIdsBloque.length > 0) {
        await supabaseAdmin
          .from("chat_mensajes")
          .update({
            whatsapp_msg_id: whatsappMsgId,
            whatsapp_group_jid: groupJid,
            whatsapp_group_nombre: whatsappGroupNombre,
            origen_canal: "WHATSAPP",
          })
          .in("id", propIdsBloque);
        await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });
      }

      const saldoBlkFmt = formatearMontoRegional(Math.max(0, saldoDisponible));
      const msgPubBlk = excedioSaldoBloque
        ? `⚠️ *${nombreJugador}* está jugando por encima de su saldo disponible ($${saldoBlkFmt}). Algunas jugadas fueron ajustadas.`
        : null;
      const msgPrivBlk = excedioSaldoBloque
        ? `⚠️ Hola *${nombreJugador}*, estás jugando por encima de tu saldo disponible ($${saldoBlkFmt}). Por favor ajusta el monto de tus jugadas o recarga saldo.`
        : null;

      return respuestaSala({
        ok: propIdsBloque.length > 0,
        tipo: "PROPUESTA_BLOQUE",
        propuestasIds: propIdsBloque,
        reaccionEmoji: null,
        respuestaGrupo: msgPubBlk,
        msg_publico: msgPubBlk,
        msg_publico_bot: msgPubBlk,
        respuestaPublica: msgPubBlk,
        mensajePrivadoAutor: msgPrivBlk,
        msg_privado_bot: msgPrivBlk,
        clienteTelefono: telefonoClienteCompleto,
        senderJid: participantJid,
      });
    }

    // Analizar con `evaluarMensajePedagogico`
    let analisis = evaluarMensajePedagogico(
      texto,
      saldoDisponible,
      retirados,
      16,
      nombreJugador
    );

    // Si con el texto original no fue válido pero hay sugerencia aprendida en BD, reintentar con la sugerencia
    if (!analisis.valido && jugadaAprendidaSugerida) {
      const intentoAprendido = evaluarMensajePedagogico(
        jugadaAprendidaSugerida,
        saldoDisponible,
        retirados,
        16,
        nombreJugador
      );
      if (intentoAprendido.valido) {
        analisis = intentoAprendido;
      }
    }

    // Si no tiene intención de jugada, registrar en chat_mensajes para la Sala de Juegos Web
    if (!analisis.esIntencionDeJugada) {
      await supabaseAdmin.from("chat_mensajes").insert({
        grupo_id: grupoId,
        sala_id: salaId,
        remitente_id: cliente?.id || null,
        remitente_nombre: nombreJugador || "Jugador",
        es_operador: false,
        tipo_mensaje: "texto",
        contenido: texto,
        whatsapp_msg_id: whatsappMsgId || null,
        whatsapp_group_jid: groupJid || null,
        whatsapp_group_nombre: whatsappGroupNombre || null,
        origen_canal: "WHATSAPP",      });
      await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

      return respuestaSala({
        ok: true,
        tipo: "CHARLA",
        respuestaGrupo: null,
        msg_publico: null,
        msg_publico_bot: null,
        respuestaPublica: null,
        mensajePrivadoAutor: null,
        msg_privado_bot: null,
        alertaPrivada: null,
        notificaciones_privadas: [],
        clienteTelefono: resolverTelefonoWhatsappCliente(cliente),
        senderJid: participantJid,
      });
    }

    // Bloqueo estricto de jugadas sin saldo (saldo_disponible <= 0)
    if (Number(saldoDisponible) <= 0) {
      const msgPubSinSaldo = `*Nada Aquí* — ${nombreJugador} no posee saldo disponible (${formatearMontoRegional(0)})`;
      const msgPrivSinSaldo = `"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo`;
      return respuestaSala({
        ok: false,
        tipo: "EXCESO_SALDO",
        respuestaGrupo: msgPubSinSaldo,
        msg_publico: msgPubSinSaldo,
        msg_publico_bot: msgPubSinSaldo,
        respuestaPublica: msgPubSinSaldo,
        mensajePrivadoAutor: msgPrivSinSaldo,
        msg_privado_bot: msgPrivSinSaldo,
        alertaPrivada: msgPrivSinSaldo,
        notificaciones_privadas: [],
        clienteTelefono: resolverTelefonoWhatsappCliente(cliente),
        senderJid: participantJid,
      });
    }

    // Caso: Publicó jugada por encima de su saldo y tiene $0 disponible
    if (!analisis.valido && analisis.excedioSaldo) {
      const saldoFmt = formatearMontoRegional(Math.max(0, saldoDisponible));
      const msgPubExceso = `⚠️ *${nombreJugador}* está jugando por encima de su saldo disponible ($${saldoFmt}). Debes recargar para proponer jugadas.`;
      const msgPrivExceso = `⚠️ Hola *${nombreJugador}*, estás jugando por encima de tu saldo disponible ($${saldoFmt}). Por favor recarga o ajusta el monto de tus jugadas.`;
      await supabaseAdmin.from("chat_mensajes").insert({
        grupo_id: grupoId,
        sala_id: salaId,
        remitente_nombre: "🤖 ASISTENTE DE SALA",
        es_operador: true,
        tipo_mensaje: "sistema",
        contenido: msgPubExceso,
        whatsapp_msg_id: whatsappMsgId || null,
        whatsapp_group_jid: groupJid || null,
        whatsapp_group_nombre: whatsappGroupNombre || null,
        origen_canal: "WHATSAPP",
        eliminado: false,
      });
      await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });
      return respuestaSala({
        ok: false,
        tipo: "EXCESO_SALDO",
        respuestaGrupo: msgPubExceso,
        msg_publico: msgPubExceso,
        msg_publico_bot: msgPubExceso,
        respuestaPublica: msgPubExceso,
        mensajePrivadoAutor: msgPrivExceso,
        msg_privado_bot: msgPrivExceso,
        alertaPrivada: msgPrivExceso,
        notificaciones_privadas: [],
        clienteTelefono: resolverTelefonoWhatsappCliente(cliente),
        senderJid: participantJid,
      });
    }

    // Caso: Enseñanza Pedagógica en Privado (mal escrita: falta Condición, Ejemplar, Jugada o Monto)
    if (!analisis.valido) {
      // Guardar en aprendizaje dinámico (idéntico a la Sala Web)
      try {
        await supabaseAdmin.from("registro_revision_llm").insert({
          grupo_id: grupoId,
          sala_id: salaId,
          usuario_id: cliente.id,
          usuario_nombre: nombreJugador,
          mensaje_usuario_original: texto.trim(),
          jugada_corregida_sugerida: analisis.sugerenciasUnClic?.[0] || analisis.jugadaEstandarizada || jugadaAprendidaSugerida,
          intencion_detectada: analisis.modalidad,
          respuesta_ia_enviada: respuestaAprendida || analisis.msgPrivadoBot || analisis.mensajePedagogicoPrivado || "Corrección pedagógica",
          nivel_confianza: analisis.confianza,
          requiere_intervencion_humana: analisis.requiereOperador,
          estado_ticket_soporte: analisis.requiereOperador ? "pendiente_operador" : "resuelto_ia",
        });

        await supabaseAdmin.from("diccionario_aprendizaje_bot").insert({
          grupo_id: grupoId,
          termino_original: texto.trim(),
          jugada_corregida: analisis.jugadaEstandarizada || analisis.mensajePedagogicoPrivado,
          usuario_id: cliente.id,        });
      } catch {
        // Resiliente
      }

      const msgPrivPedagogico =
        respuestaAprendida ||
        analisis.msgPrivadoBot ||
        analisis.mensajePedagogicoPrivado ||
        `🤖 Corrección Pedagógica: Para publicar una jugada indica Condición (Juego/Consigo), Jugada, Ejemplar y Monto. Ejemplo: Juego 1P 5 100`;

      // Silencio absoluto para el operador: nunca se le muestra el aviso
      // "⚠️¡Por favor, verificar redacción!" ni su versión privada.
      const avisoPublico = esOperadorRemitente ? null : AVISO_REDACCION_GRUPO;
      const avisoPrivado = esOperadorRemitente ? null : limpiarEtiquetasProhibidas(msgPrivPedagogico);
      return respuestaSala({
        ok: false,
        tipo: "PEDAGOGICO",
        respuestaGrupo: avisoPublico,
        msg_publico: avisoPublico,
        msg_publico_bot: avisoPublico,
        respuestaPublica: avisoPublico,
        mensajePrivadoAutor: avisoPrivado,
        msg_privado_bot: avisoPrivado,
        alertaPrivada: null,
        notificaciones_privadas: [],
        clienteTelefono: resolverTelefonoWhatsappCliente(cliente),
        senderJid: participantJid,
      });
    }

    if (!carreraAbierta) {
      const msgCerrada = `⛔ La carrera está ${String(sala.estado_carrera || "CERRADA").toUpperCase()}. No se reciben nuevas propuestas.`;
      return respuestaSala({
        ok: false,
        tipo: "CARRERA_CERRADA",
        respuestaGrupo: msgCerrada,
        msg_publico: msgCerrada,
        msg_publico_bot: msgCerrada,
        respuestaPublica: msgCerrada,
        mensajePrivadoAutor: null,
        msg_privado_bot: null,
        alertaPrivada: null,
        notificaciones_privadas: [],
        clienteTelefono: resolverTelefonoWhatsappCliente(cliente),
        senderJid: participantJid,
      });
    }

    // Bloqueo estricto: Si el cliente no posee saldo disponible
    if (saldoDisponible <= 0 && !cliente.libre) {
      const saldoFmt = formatearMontoRegional(Math.max(0, saldoDisponible));
      const msgSinSaldo = `⚠️ *${nombreJugador}* está jugando por encima de su saldo disponible ($${saldoFmt}). Debes recargar para proponer jugadas.`;
      const msgPrivSinSaldo = `⚠️ Hola *${nombreJugador}*, estás jugando por encima de tu saldo disponible ($${saldoFmt}). Por favor recarga o ajusta el monto de tus jugadas.`;
      await supabaseAdmin.from("chat_mensajes").insert({
        grupo_id: grupoId,
        sala_id: salaId,
        remitente_nombre: "🤖 ASISTENTE DE SALA",
        es_operador: true,
        tipo_mensaje: "sistema",
        contenido: msgSinSaldo,
        whatsapp_msg_id: whatsappMsgId || null,
        whatsapp_group_jid: groupJid || null,
        whatsapp_group_nombre: whatsappGroupNombre || null,
        origen_canal: "WHATSAPP",
        eliminado: false,
      });
      await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });
      return respuestaSala({
        ok: false,
        tipo: "SIN_SALDO",
        respuestaGrupo: msgSinSaldo,
        msg_publico: msgSinSaldo,
        msg_publico_bot: msgSinSaldo,
        respuestaPublica: msgSinSaldo,
        mensajePrivadoAutor: msgPrivSinSaldo,
        msg_privado_bot: msgPrivSinSaldo,
        alertaPrivada: msgPrivSinSaldo,
        notificaciones_privadas: [],
        clienteTelefono: telefonoClienteCompleto,
        senderJid: participantJid,
      });
    }

    // Regla: Apuesta Mínima para proponer
    const apuestaMinima = Number(sala.apuesta_minima || 10.00);
    if (analisis.monto < apuestaMinima) {
      const msgMinimoBot = `⛔ *Nada aquí* — El monto mínimo de apuesta es $${formatearMontoRegional(apuestaMinima)}`;
      await supabaseAdmin.from("chat_mensajes").insert({
        grupo_id: grupoId,
        sala_id: salaId,
        remitente_nombre: "🤖 ASISTENTE DE SALA",
        es_operador: true,
        tipo_mensaje: "concrecion_fifo",
        contenido: msgMinimoBot,
        whatsapp_msg_id: whatsappMsgId || null,
        whatsapp_group_jid: groupJid || null,
        whatsapp_group_nombre: whatsappGroupNombre || null,
        origen_canal: "WHATSAPP",
      });
      await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });
      return respuestaSala({
        ok: false,
        tipo: "APUESTA_MINIMA",
        nada_aqui: true,
        respuestaGrupo: msgMinimoBot,
        msg_publico: msgMinimoBot,
        msg_publico_bot: msgMinimoBot,
        respuestaPublica: msgMinimoBot,
        mensajePrivadoAutor: `El monto mínimo para publicar es $${formatearMontoRegional(apuestaMinima)}.`,
        clienteTelefono: telefonoClienteCompleto,
        senderJid: participantJid,
      });
    }

    // Determinar monto a publicar (topado según riesgo real 10/X vs saldoDisponible)
    const riesgoReal = calcularRiesgoReal(analisis.monto, analisis.proporcion, analisis.accionProponente);
    const excedioSaldo = Boolean(analisis.excedioSaldo || riesgoReal > saldoDisponible);
    const montoAPublicar = excedioSaldo
      ? Math.max(0, Number((analisis.montoDisponibleValido ?? saldoDisponible).toFixed(2)))
      : Number(analisis.monto);

    let propId: string | null = null;
    let rpcPublicado = false;
    let rpcResFinal: any = null;

    // Llamar a `publicar_propuesta_atomica` según especificación exclusiva
    try {
      let rpcRes: any = null;
      let rpcErr: any = null;

      // 1. Intentar con p_whatsapp_msg_id
      try {
        const intentoConWa = await supabaseAdmin.rpc("publicar_propuesta_atomica", {
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
          p_proporcion: analisis.proporcion || "1x1",
          p_monto_solicitado: montoAPublicar,
          p_texto_estandarizado: analisis.jugadaEstandarizada,
          p_whatsapp_msg_id: whatsappMsgId || null,
        });
        rpcRes = intentoConWa.data;
        rpcErr = intentoConWa.error;
      } catch (errConWa) {
        rpcErr = errConWa;
      }

      // 2. Si falla por schema cache (función sin p_whatsapp_msg_id en BD), invocar sin el parámetro
      if (rpcErr && (rpcErr.message?.includes("schema cache") || rpcErr.message?.includes("Could not find"))) {
        const intentoSinWa = await supabaseAdmin.rpc("publicar_propuesta_atomica", {
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
          p_proporcion: analisis.proporcion || "1x1",
          p_monto_solicitado: montoAPublicar,
          p_texto_estandarizado: analisis.jugadaEstandarizada,
        });
        rpcRes = intentoSinWa.data;
        rpcErr = intentoSinWa.error;
      }

      rpcResFinal = rpcRes;
      if (!rpcErr && rpcRes && (rpcRes as any).propuesta_id) {
        propId = (rpcRes as any).propuesta_id;
        rpcPublicado = true;
      }
    } catch {
      rpcPublicado = false;
    }

    // Fallback resiliente: inserción directa en chat_mensajes si el RPC falla (0 RETENCIÓN al proponer)
    if (!rpcPublicado || !propId) {
      try {
        const rawFirma = `PROPUESTA_WA:${salaId}:${cliente.id}:${montoAPublicar}:${Date.now()}`;
        const firma = crypto.createHash("sha256").update(rawFirma).digest("hex");

        const { data: nuevaPropuesta, error: errInsert } = await supabaseAdmin
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
            accion_proponente: analisis.accionProponente || "JUEGA",
            es_match: Boolean(analisis.esMatch),
            modalidad_jugada: analisis.modalidad,
            ejemplar_numero: analisis.ejemplarTexto,
            caballos_bando_a: analisis.caballosBandoA || (analisis.ejemplarTexto ? [analisis.ejemplarTexto] : []),
            caballos_bando_b: analisis.caballosBandoB || [],
            jugada_estandarizada: analisis.jugadaEstandarizada,
            monto_original: montoAPublicar,
            monto_disponible: montoAPublicar,
            estado_propuesta: "abierta",
            proporcion_premio: analisis.proporcion || "1x1",
            firma_sha256: firma,
            whatsapp_msg_id: whatsappMsgId || null,
            whatsapp_group_jid: groupJid || null,
            whatsapp_group_nombre: whatsappGroupNombre || null,
            origen_canal: "WHATSAPP",
          })
          .select()
          .single();

        if (!errInsert && nuevaPropuesta?.id) {
          propId = nuevaPropuesta.id;
          rpcPublicado = true;
        } else if (errInsert) {
          console.error("[procesar] Fallback inserción directa error:", errInsert);
        }
      } catch (errFb) {
        console.error("[procesar] Error en bloque fallback propuesta:", errFb);
      }
    }

    if (!rpcPublicado || !propId) {
      const msgErrPriv =
        `⚠️ Hola *${nombreJugador}*, tu mensaje "${texto}" no pudo procesarse porque ocurrió un problema registrando tu propuesta.\n\n✅ *Ejemplo correcto:* "Juego 1P 5 20.000" o "Juego 3x5 10a8 100".`;
      return respuestaSala({
        ok: false,
        tipo: "PROPUESTA_ERROR",
        respuestaGrupo: null,
        msg_publico: null,
        msg_publico_bot: null,
        respuestaPublica: null,
        mensajePrivadoAutor: msgErrPriv,
        msg_privado_bot: msgErrPriv,
        msg_privado_proponente: msgErrPriv,
        alertaPrivada: null,
        notificaciones_privadas: [],
        clienteTelefono: resolverTelefonoWhatsappCliente(cliente),
        senderJid: participantJid,
      });
    }

    await supabaseAdmin
      .from("chat_mensajes")
      .update({
        whatsapp_msg_id: whatsappMsgId,
        whatsapp_group_jid: groupJid,
        whatsapp_group_nombre: whatsappGroupNombre,
        origen_canal: "WHATSAPP",
      })
      .eq("id", propId);

    await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });

    // Advertencia explícita y ajuste automático cuando propone por encima de su saldo disponible
    if (excedioSaldo && montoAPublicar > 0) {
      const saldoFmt = formatearMontoRegional(Math.max(0, saldoDisponible));
      const montoAjustadoFmt = formatearMontoRegional(montoAPublicar);
      const propPublica = {
        es_match: analisis.esMatch,
        caballos_bando_a: analisis.caballosBandoA,
        caballos_bando_b: analisis.caballosBandoB,
        modalidad_propuesta: analisis.modalidad,
        ejemplar_texto: analisis.ejemplarTexto,
        proporcion_premio: analisis.proporcion,
      };
      const msgPubRecorte = `⚠️ *${nombreJugador}* está jugando por encima de su saldo disponible ($${saldoFmt}). Propuesta ajustada a $${montoAjustadoFmt}.`;
      const msgPrivRecorte = `⚠️ Hola *${nombreJugador}*, estás jugando por encima de tu saldo disponible ($${saldoFmt}). Tu propuesta en ${detallePublicoPropuesta(propPublica)} fue ajustada a $${montoAjustadoFmt}. ⚠️¡Por favor, verificar redacción! ¡Gracias!`;
      await supabaseAdmin.from("chat_mensajes").insert({
        grupo_id: grupoId,
        sala_id: salaId,
        remitente_nombre: "🤖 ASISTENTE DE SALA",
        es_operador: true,
        tipo_mensaje: "sistema",
        contenido: msgPubRecorte,
        whatsapp_msg_id: whatsappMsgId || null,
        whatsapp_group_jid: groupJid || null,
        whatsapp_group_nombre: whatsappGroupNombre || null,
        origen_canal: "WHATSAPP",
        eliminado: false,
      });
      await emitirBroadcastSala(salaId, "nuevo_mensaje", { salaId });
      return respuestaSala({
        ok: true,
        excedio_saldo: true,
        tipo: "PROPUESTA_CON_RECORTE_SALDO",
        propuestaId: propId,
        respuestaGrupo: msgPubRecorte,
        msg_publico: msgPubRecorte,
        msg_publico_bot: msgPubRecorte,
        respuestaPublica: msgPubRecorte,
        mensajePrivadoAutor: msgPrivRecorte,
        msg_privado_bot: msgPrivRecorte,
        msg_privado_proponente: msgPrivRecorte,
        alertaPrivada: (rpcResFinal as any)?.alertaPrivada || msgPrivRecorte,
        notificaciones_privadas: (rpcResFinal as any)?.notificaciones_privadas || [],
        clienteTelefono: resolverTelefonoWhatsappCliente(cliente),
        senderJid: participantJid,
      });
    }

    // Propuesta Exitosa con Saldo: SILENCIO en grupo público.
    // Cuando un jugador publica una jugada (ej. Juego 3x5 10a8 100) y tiene saldo,
    // el bot NO responde nada en el grupo público. Solo la registra en la memoria interna (BD).
    let resCruceAuto: any = null;
    if (sala.grupo_id) {
      const { data: gCruces } = await supabaseAdmin
        .from("grupos_venta")
        .select("permite_cruces")
        .eq("id", sala.grupo_id)
        .maybeSingle();

      if (gCruces?.permite_cruces) {
        resCruceAuto = await intentarCruceAutomatico({
          sala,
          grupoId,
          nuevaPropuestaId: propId,
          nuevoCliente: cliente,
          analisis,
          groupJid,
          whatsappGroupNombre,
          whatsappMsgId,
        });
      }
    }

    if (resCruceAuto?.cruzado || resCruceAuto?.esSugerencia) {
      const msgCrucePub = (resCruceAuto as any).msgCruce || (resCruceAuto as any).msgPublico || null;
      return respuestaSala({
        ok: true,
        tipo: resCruceAuto?.cruzado ? "PROPUESTA_CON_CRUCE" : "SUGERENCIA_CRUCE",
        propuestaId: propId,
        jugadaEstandarizada: analisis.jugadaEstandarizada,
        montoPublicado: montoAPublicar,
        reaccionEmoji: null,
        respuestaGrupo: msgCrucePub,
        msg_publico: msgCrucePub,
        msg_publico_bot: msgCrucePub,
        respuestaPublica: msgCrucePub,
        mensajePrivadoAutor: null,
        senderJid: participantJid,
      });
    }

    return respuestaSala({
      ok: true,
      tipo: "PROPUESTA",
      propuestaId: propId,
      jugadaEstandarizada: analisis.jugadaEstandarizada,
      montoPublicado: montoAPublicar,
      reaccionEmoji: null,
      respuestaGrupo: null,
      msg_publico: null,
      msg_publico_bot: null,
      respuestaPublica: null,
      mensajePrivadoAutor: null,
      msg_privado_bot: null,
      msg_privado_proponente: null,
      alertaPrivada: null,
      notificaciones_privadas: [],
      senderJid: participantJid,
    });
  } catch (err: any) {
    return respuestaSala(
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

/**
 *Toda respuesta del endpoint pasa por acá: los mensajes privados que el
 *demonio Baileys entrega por DM siempre incluyen el Código de Sala del tenant.
 */
function respuestaSala(body: any, init?: ResponseInit): NextResponse {
  const codigo = codigoSalaEnRespuesta(body);
  if (codigo && body && typeof body === "object") {
    const camposPrivados = [
      "mensajePrivadoAutor",
      "msg_privado_bot",
      "msg_privado_proponente",
      "msg_privado_aceptante",
      "msgPrivado",
      "alertaPrivada",
    ];
    for (const campo of camposPrivados) {
      if (typeof body[campo] === "string" && body[campo].trim()) {
        body[campo] = mensajeConCodigoSala(body[campo], codigo);
      }
    }
    if (Array.isArray(body.notificaciones_privadas)) {
      for (const notif of body.notificaciones_privadas) {
        if (!notif || typeof notif !== "object") continue;
        for (const clave of ["mensaje", "texto"]) {
          if (typeof notif[clave] === "string" && notif[clave].trim()) {
            notif[clave] = mensajeConCodigoSala(notif[clave], codigo);
          }
        }
      }
    }
  }
  return NextResponse.json(body, init);
}
