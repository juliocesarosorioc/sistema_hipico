"use client";

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/core/supabase";
import { redondearCentavos, sumarDinero, restarDinero } from "@/shared/lib/dinero";
import { esSinTope } from "@/features/taquilla/lib/reparto";
import {
  parsearMensajeJugada,
  type DatosJugada,
} from "@/features/portal/lib/gramatica-concrecion-hipica";
import {
  EVENTO_ESTADO_CARRERA_CAMBIADO,
  alternarEstadoCarreraGlobal,
} from "@/features/portal/lib/bloqueo-jugadas";
import {
  consultarEstadoCarreraActual,
  ejecutarCierreCarrera,
  ejecutarAperturaCarrera,
} from "@/features/carreras/lib/cierre-simultaneo-carreras";

export interface ClienteSesionSala {
  id: string;
  nombre: string;
  seudonimo: string;
  telefono: string;
  saldo_actual: number;
  aval: number;
  libre: boolean;
  modo_juego: string;
  grupo_id?: string | null;
  esOperadorOAdmin?: boolean;
}

export interface MensajeChatSala {
  id: string;
  autor: string;
  autorId?: string;
  texto: string;
  hora: string;
  esMio: boolean;
  esIa: boolean;
  esConcrecion?: boolean;
  concrecionData?: {
    juega: string;
    da: string;
    monto: number;
    jugada: string;
    caballo: string;
    ticketId?: string | number;
  };
}

const STORAGE_KEY = "hipico_sala_session_v1";

export function SalaWhatsAppApp() {
  const [sesion, setSesion] = useState<ClienteSesionSala | null>(null);
  const [cargandoAuth, setCargandoAuth] = useState(true);

  // Formulario Onboarding
  const [formNombre, setFormNombre] = useState("");
  const [formTelefono, setFormTelefono] = useState("");
  const [pasoOtp, setPasoOtp] = useState(false);
  const [codigoOtp, setCodigoOtp] = useState("");
  const [codigoGenerado, setCodigoGenerado] = useState("");
  const [errorLogin, setErrorLogin] = useState<string | null>(null);

  // Estado del Chat y Carrera Activa
  const [mensajes, setMensajes] = useState<MensajeChatSala[]>([]);
  const [inputTexto, setInputTexto] = useState("");
  const [carreraActiva, setCarreraActiva] = useState({
    hipodromo: "LA RINCONADA",
    carrera: 7,
    estado: "ABIERTA" as "ABIERTA" | "CERRADA",
  });
  const [enviando, setEnviando] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // 1. Cargar sesión previa guardada en el dispositivo
  useEffect(() => {
    try {
      const guardada = localStorage.getItem(STORAGE_KEY);
      if (guardada) {
        const parsed = JSON.parse(guardada) as ClienteSesionSala;
        if (parsed && parsed.id && parsed.nombre) {
          setSesion(parsed);
          refrescarSaldoEnBase(parsed.id);
        }
      }
    } catch {
      /* ignore */
    } finally {
      setCargandoAuth(false);
    }
  }, []);

  // 2. Cargar carrera activa real desde Supabase para hoy
  useEffect(() => {
    async function sincronizarCarreraActiva() {
      if (!supabase) return;
      try {
        const hoy = new Date().toISOString().slice(0, 10);
        const { data } = await supabase
          .from("carreras")
          .select("hipodromo, carrera, estado, hora")
          .eq("fecha", hoy)
          .order("carrera", { ascending: true });

        if (data && data.length > 0) {
          const abierta = data.find((c) => String(c.estado).toUpperCase() === "ABIERTA");
          const cElegida = abierta || data[data.length - 1];
          const est = String(cElegida.estado || "ABIERTA").toUpperCase();
          const cerrada = est === "CERRADA" || est === "LIQUIDADA" || est === "RESULTADOS";
          setCarreraActiva({
            hipodromo: cElegida.hipodromo || "LA RINCONADA",
            carrera: Number(cElegida.carrera) || 1,
            estado: cerrada ? "CERRADA" : "ABIERTA",
          });
        }
      } catch {
        /* fallback */
      }
    }
    sincronizarCarreraActiva();
  }, []);

  // 3. Escuchar cambios de apertura/cierre de carrera en tiempo real (Simultáneo / Admin / Operador)
  useEffect(() => {
    const handlerEstado = (e: any) => {
      const detail = e.detail;
      if (!detail) return;
      const nuevoEst = String(detail.estado).toUpperCase();
      const esCerrada = nuevoEst === "CERRADA" || nuevoEst === "LIQUIDADA";
      const estadoFinal = esCerrada ? "CERRADA" : "ABIERTA";

      setCarreraActiva((prev) => ({
        ...prev,
        hipodromo: detail.hipodromo || prev.hipodromo,
        carrera: Number(detail.carrera) || prev.carrera,
        estado: estadoFinal,
      }));

      // Notificación del Agente IA en la sala
      const hora = new Date().toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit", hour12: true });
      if (esCerrada) {
        setMensajes((prev) => [
          ...prev,
          {
            id: `ia-cierre-${Date.now()}`,
            autor: "Agente IA Oficial",
            texto: `🚨 *¡CARRERA CERRADA!*\n\nLa Carrera ${detail.carrera || carreraActiva.carrera} de ${detail.hipodromo || carreraActiva.hipodromo} ha sido **CERRADA** (por el Operador/Administrador o por cierre oficial simultáneo DRF/TVG/TwinSpires).\n\n⛔ **Taquilla Bloqueada**: No se aceptan más jugadas para esta carrera.`,
            hora,
            esMio: false,
            esIa: true,
          },
        ]);
      } else {
        setMensajes((prev) => [
          ...prev,
          {
            id: `ia-apertura-${Date.now()}`,
            autor: "Agente IA Oficial",
            texto: `🟢 *¡CARRERA ABIERTA!*\n\nLa Carrera ${detail.carrera || carreraActiva.carrera} de ${detail.hipodromo || carreraActiva.hipodromo} está **ABIERTA** para recibir jugadas y propuestas.`,
            hora,
            esMio: false,
            esIa: true,
          },
        ]);
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener(EVENTO_ESTADO_CARRERA_CAMBIADO, handlerEstado);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener(EVENTO_ESTADO_CARRERA_CAMBIADO, handlerEstado);
      }
    };
  }, [carreraActiva]);

  // Refrescar saldo del cliente desde la base
  const refrescarSaldoEnBase = async (clienteId: string) => {
    if (!supabase) return;
    try {
      const { data } = await supabase
        .from("clientes")
        .select("id, nombre, seudonimo, saldo_actual, aval, libre, modo_juego, grupo_id")
        .eq("id", clienteId)
        .maybeSingle();
      if (data) {
        setSesion((prev) => {
          if (!prev) return null;
          const actualizado = {
            ...prev,
            saldo_actual: Number(data.saldo_actual || 0),
            aval: Number(data.aval || 0),
            libre: Boolean(data.libre || String(data.modo_juego).toLowerCase() === "libre"),
            modo_juego: String(data.modo_juego || "aval"),
          };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(actualizado));
          return actualizado;
        });
      }
    } catch {
      /* ignore */
    }
  };

  // Cargar mensajes iniciales de bienvenida
  useEffect(() => {
    if (!sesion) return;
    const hora = new Date().toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit", hour12: true });
    const esLibre = sesion.libre || String(sesion.modo_juego).toLowerCase() === "libre";
    const saldoTxt = esLibre
      ? "⭐ Tu cuenta tiene **Estatus LIBRE** (sin limitaciones de saldo para apostar)."
      : `💰 Tu disponible actual es **$${(sesion.saldo_actual + sesion.aval).toFixed(2)}** (Saldo $${sesion.saldo_actual.toFixed(2)} + Aval $${sesion.aval.toFixed(2)}).`;

    const estadoTxt =
      carreraActiva.estado === "ABIERTA"
        ? `🟢 Carrera en curso: **${carreraActiva.hipodromo} (Carrera ${carreraActiva.carrera})** · **ABIERTA**`
        : `🔴 Carrera en curso: **${carreraActiva.hipodromo} (Carrera ${carreraActiva.carrera})** · **CERRADA**`;

    setMensajes([
      {
        id: "msg-bienvenida-1",
        autor: "Agente IA Oficial",
        texto: `👋 ¡Hola @${sesion.seudonimo || sesion.nombre}! Bienvenido a la Sala de Jugadas Oficial.\n\n${saldoTxt}\n\n${estadoTxt}\nPuedes proponer jugadas libremente o responder a propuestas de otros compañeros.`,
        hora,
        esMio: false,
        esIa: true,
      },
    ]);
  }, [sesion?.id]);

  // Scroll automático hacia el final del chat
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes]);

  // Manejo de Onboarding / Login Móvil OTP
  const solicitarOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorLogin(null);
    const nomLimpio = formNombre.trim().toUpperCase();
    const telLimpio = formTelefono.replace(/\D+/g, "");

    if (!nomLimpio) {
      setErrorLogin("Por favor ingresa tu nombre o seudónimo.");
      return;
    }
    if (telLimpio.length < 7) {
      setErrorLogin("Por favor ingresa un número de celular válido.");
      return;
    }

    // Generar código OTP de 4 dígitos
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    setCodigoGenerado(otp);
    setPasoOtp(true);
  };

  const confirmarOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (codigoOtp.trim() !== codigoGenerado) {
      setErrorLogin("Código incorrecto. Ingresa el código mostrado.");
      return;
    }

    const nomLimpio = formNombre.trim().toUpperCase();
    const telLimpio = formTelefono.trim();
    const esAdminOperador = /ADMIN|OPERADOR|ARELY|JULIO/i.test(nomLimpio);

    const nuevaSesion: ClienteSesionSala = {
      id: crypto.randomUUID ? crypto.randomUUID() : `cli-${Date.now()}`,
      nombre: nomLimpio,
      seudonimo: nomLimpio,
      telefono: telLimpio,
      saldo_actual: 0,
      aval: 0,
      libre: true, // Default libre para jugadores directos
      modo_juego: "libre",
      grupo_id: "d290daa1-a44b-4ed4-bb8a-03db4ecc32b0",
      esOperadorOAdmin: esAdminOperador,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(nuevaSesion));
    setSesion(nuevaSesion);
    setPasoOtp(false);
  };

  const cerrarSesion = () => {
    localStorage.removeItem(STORAGE_KEY);
    setSesion(null);
    setPasoOtp(false);
    setFormNombre("");
    setFormTelefono("");
  };

  // Enviar mensaje en el chat
  const enviarMensaje = async (textoPersonalizado?: string) => {
    const texto = (textoPersonalizado ?? inputTexto).trim();
    if (!texto || !sesion || enviando) return;

    const hora = new Date().toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit", hour12: true });
    const nuevoMsgId = `usr-${Date.now()}`;

    const msgUsuario: MensajeChatSala = {
      id: nuevoMsgId,
      autor: sesion.seudonimo || sesion.nombre,
      autorId: sesion.id,
      texto,
      hora,
      esMio: true,
      esIa: false,
    };

    setMensajes((prev) => [...prev, msgUsuario]);
    setInputTexto("");
    setEnviando(true);

    // Procesar con el Agente IA de forma autónoma
    setTimeout(async () => {
      await procesarRespuestaIa(texto, sesion);
      setEnviando(false);
    }, 450);
  };

  // Procesamiento autónomo del Agente IA
  const procesarRespuestaIa = async (texto: string, cli: ClienteSesionSala) => {
    const hora = new Date().toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit", hour12: true });
    const tLower = texto.toLowerCase();

    // 0. Comandos de Operador/Admin: Cerrar o Abrir carrera
    if (/cerrar\s+carrera|cierra\s+carrera/i.test(tLower)) {
      await ejecutarCierreCarrera({
        hipodromo: carreraActiva.hipodromo,
        carrera: carreraActiva.carrera,
        fuente: cli.esOperadorOAdmin ? "OPERADOR" : "ADMIN",
        operadorNombre: cli.nombre,
        motivo: "Cierre manual solicitado desde la Sala",
      });
      return;
    }

    if (/abrir\s+carrera|abre\s+carrera/i.test(tLower)) {
      await ejecutarAperturaCarrera({
        hipodromo: carreraActiva.hipodromo,
        carrera: carreraActiva.carrera,
        operadorNombre: cli.nombre,
      });
      return;
    }

    // 1. Consulta de saldo
    if (/saldo|disponible|cuanto tengo/i.test(tLower)) {
      const libre = esSinTope({ libre: cli.libre, modo_juego: cli.modo_juego, saldo_actual: cli.saldo_actual, aval: cli.aval });
      const dispTotal = cli.saldo_actual + cli.aval;
      const resp = libre
        ? `⭐ @${cli.nombre}: Tu cuenta tiene **Estatus LIBRE** (puedes jugar lo que quieras sin limitaciones de saldo ni topes).`
        : `💰 @${cli.nombre}: Tu saldo es **$${cli.saldo_actual.toFixed(2)}** y cuentas con aval de **$${cli.aval.toFixed(2)}** (Disponible total: **$${dispTotal.toFixed(2)}**).`;

      setMensajes((prev) => [
        ...prev,
        {
          id: `ia-${Date.now()}`,
          autor: "Agente IA Oficial",
          texto: resp,
          hora,
          esMio: false,
          esIa: true,
        },
      ]);
      return;
    }

    // 2. Consulta de carrera
    if (/carrera|abierta|programa|que corre/i.test(tLower)) {
      const estColor = carreraActiva.estado === "ABIERTA" ? "🟢 ABIERTA" : "🔴 CERRADA";
      setMensajes((prev) => [
        ...prev,
        {
          id: `ia-${Date.now()}`,
          autor: "Agente IA Oficial",
          texto: `📍 Carrera Activa: **${carreraActiva.hipodromo} (Carrera ${carreraActiva.carrera})**.\nEstado: **${estColor}**.\n${
            carreraActiva.estado === "ABIERTA"
              ? "Hagan sus jugadas antes de la partida."
              : "⛔ Carrera cerrada. No se admiten más jugadas."
          }`,
          hora,
          esMio: false,
          esIa: true,
        },
      ]);
      return;
    }

    // 3. Parser de Jugada / Propuesta P2P
    const parsed = parsearMensajeJugada(texto);
    if (parsed.ok && parsed.datos) {
      // 🚨 VALIDACIÓN ESTRICTA: SI LA CARRERA ESTÁ CERRADA, RECHAZAR DE INMEDIATO
      if (carreraActiva.estado === "CERRADA") {
        setMensajes((prev) => [
          ...prev,
          {
            id: `ia-${Date.now()}`,
            autor: "Agente IA Oficial",
            texto: `⛔ @${cli.nombre}: La carrera **${carreraActiva.hipodromo} (Carrera ${carreraActiva.carrera})** está **CERRADA** por el Operador/Administrador o por cierre oficial simultáneo (DRF/TVG/TwinSpires).\n\nNo se admiten más jugadas para esta carrera.`,
            hora,
            esMio: false,
            esIa: true,
          },
        ]);
        return;
      }

      const d = parsed.datos;
      const libre = esSinTope({ libre: cli.libre, modo_juego: cli.modo_juego, saldo_actual: cli.saldo_actual, aval: cli.aval });
      const disponible = cli.saldo_actual + cli.aval;

      // Validación de fondos (omite completamente si es LIBRE)
      if (!libre && disponible < d.monto) {
        setMensajes((prev) => [
          ...prev,
          {
            id: `ia-${Date.now()}`,
            autor: "Agente IA Oficial",
            texto: `⚠️ @${cli.nombre}: Tu disponible es $${disponible.toFixed(2)}, no cubre el monto pedido de $${d.monto.toFixed(2)}.`,
            hora,
            esMio: false,
            esIa: true,
          },
        ]);
        return;
      }

      // Propuesta registrada en la sala
      const rolTexto = d.rol === "JUEGA" ? "JUEGA" : "DA";
      const contraparteMatch = /con\s+@?([a-zA-Z0-9_-]+)/i.exec(texto);
      const contraparte = contraparteMatch ? contraparteMatch[1].toUpperCase() : null;

      if (contraparte) {
        // Concreción directa contraparte
        const ticketId = Math.floor(100000 + Math.random() * 900000);
        const msgConcrecion: MensajeChatSala = {
          id: `ia-${Date.now()}`,
          autor: "Agente IA Oficial",
          texto: `✅ *¡Aquí jugaron!*\n\n🏇 **${d.jugada}** al ejemplar **${d.caballos}** por **$${d.monto.toFixed(2)}**\n👤 Juega: **@${cli.nombre}**\n🛡️ Da: **@${contraparte}**\n🎫 Ticket Oficial: \`#${ticketId}\`\n\nRegistrado y asentado en la plataforma en tiempo real.`,
          hora,
          esMio: false,
          esIa: true,
          esConcrecion: true,
          concrecionData: {
            juega: cli.nombre,
            da: contraparte,
            monto: d.monto,
            jugada: d.jugada,
            caballo: d.caballos,
            ticketId,
          },
        };

        setMensajes((prev) => [...prev, msgConcrecion]);

        // Registrar en Supabase en tiempo real
        if (supabase) {
          try {
            await supabase.from("apuestas_eventos_especiales").insert([
              {
                fecha: new Date().toISOString().slice(0, 10),
                evento: `[SALA IA] ${d.jugada} al ${d.caballos} (${cli.nombre} vs ${contraparte})`,
                cliente_id: cli.id,
                cliente_nombre: cli.nombre,
                monto: d.monto,
                pago_potencial: d.monto * 2,
                logro_cuota: "1P",
                estado: "PENDIENTE",
                ganador_seleccionado: false,
                nota: `EVENTO_LIBRE_P2P:${JSON.stringify({
                  id: `sala-${ticketId}`,
                  fecha: new Date().toISOString().slice(0, 10),
                  concepto: `${d.jugada} al ${d.caballos}`,
                  jugador1Nombre: cli.nombre,
                  riesgoJugador1: d.monto,
                  jugador2Nombre: contraparte,
                  riesgoJugador2: d.monto,
                  estado: "PENDIENTE",
                })}`,
              },
            ]);
          } catch {
            /* ignore */
          }
        }
      } else {
        // Propuesta abierta a la sala
        setMensajes((prev) => [
          ...prev,
          {
            id: `ia-${Date.now()}`,
            autor: "Agente IA Oficial",
            texto: `📢 Propuesta Abierta: **@${cli.nombre}** ${rolTexto} **${d.jugada}** al **${d.caballos}** por **$${d.monto.toFixed(2)}**.\n¿Quién la toma? (Responde "Voy" o "Doy" para concretar).`,
            hora,
            esMio: false,
            esIa: true,
          },
        ]);
      }
      return;
    }

    // 4. Conversación general
    setMensajes((prev) => [
      ...prev,
      {
        id: `ia-${Date.now()}`,
        autor: "Agente IA Oficial",
        texto: `🤖 Hola @${cli.nombre}, estoy atento a las jugadas. Puedes enviar jugadas como "100 al 5 con @SAM", consultar "Mi saldo" o "Carrera actual".`,
        hora,
        esMio: false,
        esIa: true,
      },
    ]);
  };

  // Toggle rápido de Operador / Administrador
  const toggleEstadoCarrera = async () => {
    if (carreraActiva.estado === "ABIERTA") {
      await ejecutarCierreCarrera({
        hipodromo: carreraActiva.hipodromo,
        carrera: carreraActiva.carrera,
        fuente: sesion?.esOperadorOAdmin ? "OPERADOR" : "ADMIN",
        operadorNombre: sesion?.nombre || "OPERADOR",
        motivo: "Cierre manual desde barra de control de la Sala",
      });
    } else {
      await ejecutarAperturaCarrera({
        hipodromo: carreraActiva.hipodromo,
        carrera: carreraActiva.carrera,
        operadorNombre: sesion?.nombre || "OPERADOR",
      });
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER: PANTALLA DE ONBOARDING / ACCESO MÓVIL
  // ──────────────────────────────────────────────────────────────────────────
  if (!sesion) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-[#111b21] p-4 text-white font-sans">
        <div className="w-full max-w-sm rounded-3xl bg-[#202c33] p-6 shadow-2xl border border-[#2a3942]">
          <div className="flex flex-col items-center gap-2 pb-6 text-center border-b border-[#2a3942]">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#00a884] text-white shadow-lg text-3xl">
              🐎
            </div>
            <h1 className="text-xl font-bold tracking-tight text-[#e9edef]">Sala WhatsApp Oficial</h1>
            <p className="text-xs text-[#8696a0]">
              Vincula tu teléfono para interactuar directamente con el Agente IA y tus jugadas.
            </p>
          </div>

          {!pasoOtp ? (
            <form onSubmit={solicitarOtp} className="mt-6 space-y-4">
              <div>
                <label className="block text-[11px] font-bold uppercase text-[#8696a0] mb-1">
                  Tu Seudónimo o Nombre
                </label>
                <input
                  type="text"
                  value={formNombre}
                  onChange={(e) => setFormNombre(e.target.value)}
                  placeholder="Ej. ARELY, SAM, LEYBA..."
                  className="w-full rounded-xl bg-[#111b21] px-4 py-3 text-sm text-[#e9edef] placeholder-[#8696a0] border border-[#2a3942] focus:border-[#00a884] focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-[#8696a0] mb-1">
                  Número Celular / WhatsApp
                </label>
                <input
                  type="tel"
                  value={formTelefono}
                  onChange={(e) => setFormTelefono(e.target.value)}
                  placeholder="+58 412 1234567"
                  className="w-full rounded-xl bg-[#111b21] px-4 py-3 text-sm text-[#e9edef] placeholder-[#8696a0] border border-[#2a3942] focus:border-[#00a884] focus:outline-none font-mono"
                  required
                />
              </div>

              {errorLogin && (
                <div className="rounded-xl bg-red-900/30 border border-red-500/50 p-3 text-xs text-red-200">
                  {errorLogin}
                </div>
              )}

              <button
                type="submit"
                className="w-full rounded-xl bg-[#00a884] py-3.5 text-sm font-bold text-white shadow-lg hover:bg-[#02906f] active:scale-[0.98] transition-all"
              >
                Vincular Celular
              </button>
            </form>
          ) : (
            <form onSubmit={confirmarOtp} className="mt-6 space-y-4">
              <div className="rounded-xl bg-[#111b21] p-3 border border-[#00a884]/40 text-center">
                <span className="text-[11px] text-[#8696a0] block">Código de confirmación generado:</span>
                <span className="font-mono text-2xl font-black text-[#00a884] tracking-widest">{codigoGenerado}</span>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-[#8696a0] mb-1 text-center">
                  Ingresa el código
                </label>
                <input
                  type="text"
                  maxLength={4}
                  value={codigoOtp}
                  onChange={(e) => setCodigoOtp(e.target.value)}
                  placeholder="0000"
                  className="w-full text-center tracking-[0.5em] font-mono text-2xl rounded-xl bg-[#111b21] px-4 py-3 text-[#e9edef] border border-[#2a3942] focus:border-[#00a884] focus:outline-none"
                  autoFocus
                  required
                />
              </div>

              {errorLogin && (
                <div className="rounded-xl bg-red-900/30 border border-red-500/50 p-3 text-xs text-red-200 text-center">
                  {errorLogin}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPasoOtp(false)}
                  className="flex-1 rounded-xl bg-[#2a3942] py-3 text-xs font-bold text-[#e9edef] hover:bg-[#32424b]"
                >
                  Atrás
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-[#00a884] py-3 text-xs font-bold text-white shadow-lg hover:bg-[#02906f]"
                >
                  Entrar a la Sala
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER: SALA DE CHAT WHATSAPP COMPLETA
  // ──────────────────────────────────────────────────────────────────────────
  const esLibre = sesion.libre || String(sesion.modo_juego).toLowerCase() === "libre";
  const dispTotal = sesion.saldo_actual + sesion.aval;
  const esCerrada = carreraActiva.estado === "CERRADA";

  return (
    <div className="flex h-screen w-full flex-col bg-[#efeae2] font-sans overflow-hidden">
      {/* ── 1. HEADER NATIVO WHATSAPP ── */}
      <header className="flex h-16 w-full items-center justify-between bg-[#008069] px-4 text-white shadow-md z-20">
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-[#128c7e] text-xl font-bold shadow-sm border border-white/20">
            🐎
            <span
              className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[#008069] ${
                esCerrada ? "bg-red-500" : "bg-emerald-400"
              }`}
            />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-white">SALA OFICIAL HÍPICA</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                  esCerrada ? "bg-red-600 text-white" : "bg-emerald-700 text-emerald-100"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${esCerrada ? "bg-white" : "bg-emerald-300 animate-pulse"}`}
                />
                {carreraActiva.hipodromo} C{carreraActiva.carrera} · {carreraActiva.estado}
              </span>
            </div>
          </div>
        </div>

        {/* Saldo Pill & Sesión */}
        <div className="flex items-center gap-2">
          {sesion.esOperadorOAdmin && (
            <button
              onClick={toggleEstadoCarrera}
              title={esCerrada ? "Abrir Carrera" : "Cerrar Carrera"}
              className={`rounded-full px-2.5 py-1 text-[10px] font-bold shadow-sm transition-all ${
                esCerrada
                  ? "bg-emerald-500 text-white hover:bg-emerald-600"
                  : "bg-red-600 text-white hover:bg-red-700 animate-pulse"
              }`}
            >
              {esCerrada ? "🟢 Abrir" : "🔴 Cerrar"}
            </button>
          )}

          <div className="rounded-full bg-black/20 px-3 py-1 text-right backdrop-blur-sm border border-white/10">
            <div className="text-[9px] uppercase font-bold text-emerald-200">
              {sesion.nombre}
            </div>
            <div className="text-xs font-mono font-black text-white">
              {esLibre ? (
                <span className="text-amber-300">⭐ LIBRE</span>
              ) : (
                `$${dispTotal.toFixed(2)}`
              )}
            </div>
          </div>
          <button
            onClick={cerrarSesion}
            title="Cerrar sesión / Cambiar móvil"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-black/20 hover:bg-black/30 text-white text-xs transition-colors"
          >
            🚪
          </button>
        </div>
      </header>

      {/* ── 2. CUERPO DE MENSAJES (WALLPAPER WHATSAPP) ── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#efeae2]">
        {/* Banner de Encriptación y Reglas */}
        <div className="mx-auto my-1 max-w-xs rounded-xl bg-[#ffeecd] px-3 py-1.5 text-center shadow-sm border border-[#ffdc9c]">
          <p className="text-[10px] text-[#54656f] leading-snug">
            🔒 <b>Control Centralizado:</b> Apertura y Cierre gestionados por Operador/Admin y sincronizados con DRF/TVG/TwinSpires.
          </p>
        </div>

        {/* Lista de Mensajes */}
        {mensajes.map((m) => {
          if (m.esIa) {
            return (
              <div key={m.id} className="flex flex-col items-start max-w-[85%] sm:max-w-[70%]">
                <div
                  className={`rounded-2xl rounded-tl-sm p-3.5 shadow-sm text-sm text-[#111b21] ${
                    m.esConcrecion
                      ? "bg-emerald-50 border-2 border-emerald-400 shadow-md"
                      : "bg-white border border-[#e9edef]"
                  }`}
                >
                  <div className="flex items-center gap-1.5 pb-1 text-[11px] font-bold text-[#00a884]">
                    <span>🤖 Agente IA Oficial</span>
                    <span className="text-xs">✓</span>
                  </div>
                  <div className="whitespace-pre-wrap leading-relaxed">{m.texto}</div>
                  <div className="pt-1 text-right text-[10px] text-[#667781] font-mono">{m.hora}</div>
                </div>
              </div>
            );
          }

          if (m.esMio) {
            return (
              <div key={m.id} className="flex flex-col items-end">
                <div className="max-w-[85%] sm:max-w-[70%] rounded-2xl rounded-tr-sm bg-[#d9fdd3] p-3 shadow-sm text-sm text-[#111b21]">
                  <div className="whitespace-pre-wrap leading-relaxed">{m.texto}</div>
                  <div className="flex items-center justify-end gap-1 pt-1 text-[10px] text-[#667781]">
                    <span className="font-mono">{m.hora}</span>
                    <span className="font-bold text-[#53bdeb]">✓✓</span>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div key={m.id} className="flex flex-col items-start max-w-[85%] sm:max-w-[70%]">
              <div className="rounded-2xl rounded-tl-sm bg-white p-3 shadow-sm text-sm text-[#111b21] border border-[#e9edef]">
                <div className="font-bold text-xs text-[#1f729f] pb-0.5">{m.autor}</div>
                <div className="whitespace-pre-wrap leading-relaxed">{m.texto}</div>
                <div className="pt-1 text-right text-[10px] text-[#667781] font-mono">{m.hora}</div>
              </div>
            </div>
          );
        })}
        <div ref={chatBottomRef} />
      </div>

      {/* ── 3. CHIPS RÁPIDOS DE JUGADAS ── */}
      <div className="flex gap-2 overflow-x-auto bg-[#f0f2f5] px-3 py-2 border-t border-[#e9edef] scrollbar-none">
        <button
          onClick={() => enviarMensaje("100 al 5 con @SAM")}
          disabled={esCerrada}
          className="whitespace-nowrap rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#00a884] shadow-sm border border-emerald-200 hover:bg-emerald-50 active:scale-95 disabled:opacity-40"
        >
          🏇 100 al 5 con @SAM
        </button>
        <button
          onClick={() => enviarMensaje("Doy 50 al 2")}
          disabled={esCerrada}
          className="whitespace-nowrap rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm border border-slate-200 hover:bg-slate-50 active:scale-95 disabled:opacity-40"
        >
          🛡️ Doy 50 al 2
        </button>
        <button
          onClick={() => enviarMensaje("Mi saldo")}
          className="whitespace-nowrap rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm border border-slate-200 hover:bg-slate-50 active:scale-95"
        >
          💰 Mi saldo
        </button>
        <button
          onClick={() => enviarMensaje("Carrera actual")}
          className="whitespace-nowrap rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm border border-slate-200 hover:bg-slate-50 active:scale-95"
        >
          📍 Carrera actual
        </button>
      </div>

      {/* ── 4. BARRA DE INPUT ESTILO WHATSAPP ── */}
      <div className="flex items-center gap-2 bg-[#f0f2f5] px-3 py-2 border-t border-[#e9edef]">
        <input
          type="text"
          value={inputTexto}
          onChange={(e) => setInputTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              enviarMensaje();
            }
          }}
          placeholder={
            esCerrada
              ? "⛔ Carrera cerrada (no se aceptan jugadas)..."
              : "Escribe una jugada (ej. 100 al 5 con @SAM)..."
          }
          className="flex-1 rounded-2xl bg-white px-4 py-2.5 text-sm text-[#111b21] placeholder-[#8696a0] border border-transparent shadow-sm focus:border-[#00a884] focus:outline-none"
        />
        <button
          onClick={() => enviarMensaje()}
          disabled={!inputTexto.trim() || enviando}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-[#00a884] text-white shadow-md hover:bg-[#02906f] active:scale-95 disabled:opacity-50 transition-all"
        >
          ➤
        </button>
      </div>
    </div>
  );
}
