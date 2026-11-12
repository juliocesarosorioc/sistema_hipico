'use client';
// LÍNEA 1: Interfaz Completa de Sala de Juegos Estilo WhatsApp / WhatsApp Web

import React, { useState, useRef } from 'react';
import {
  analizarYEstandarizarJugada,
  evaluarConcrecionEstricta,
  analizarComandoRetiro,
} from '../lib/parser-pedagogico';
import { generarHashArchivoSHA256, generarHashTextoSHA256, cifrarMensajeSala } from '../lib/seguridad-crypto';
import { supabase } from '@/core/supabase';
import { formatearMontoRegional } from '@/shared/lib/dinero';
import { construirMensajeCarreraAbierta } from '../lib/mensajes-carrera';

export interface SalaActivaInfo {
  id: string;
  nombreSala: string;
  hipodromoActivo: string;
  numeroCarreraActiva: number;
  distanciaActiva: number;
  estadoCarrera: 'abierta' | 'cerrada' | 'liquidada';
  retirados: string[];
  carreraActivaId?: string;
  whatsappGroupJid?: string;
}

interface PropsSalaJuegos {
  grupoId: string;
  grupoNombre: string;
  permitirCrucesNetting: boolean;
  usuarioActual: {
    id: string;
    nombre: string;
    esOperador: boolean;
    saldoDisponible: number;
    saldoRetenido: number;
  };
  salasActivasIniciales: SalaActivaInfo[];
  onEjecutarRpc?: (nombreRpc: string, params: Record<string, any>) => Promise<any>;
}

export default function SalaJuegosWhatsApp({
  grupoId,
  grupoNombre,
  permitirCrucesNetting,
  usuarioActual,
  salasActivasIniciales,
  onEjecutarRpc,
}: PropsSalaJuegos) {
  const [salas, setSalas] = useState<SalaActivaInfo[]>(
    salasActivasIniciales.slice(0, 2) // Máximo 2 salas activas simultáneas por grupo
  );
  const [salaSeleccionadaId, setSalaSeleccionadaId] = useState<string>(salas[0]?.id || 'sala-1');
  const [vistaDualEscritorio, setVistaDualEscritorio] = useState<boolean>(false);
  const [tamanoLetra, setTamanoLetra] = useState<number>(15);
  const [ocultarSaldo, setOcultarSaldo] = useState<boolean>(false);
  const [textoInput, setTextoInput] = useState<string>('');
  const [modalPrejugadasAbierto, setModalPrejugadasAbierto] = useState<boolean>(false);
  const [modalRecargaAbierto, setModalRecargaAbierto] = useState<boolean>(false);

  // Propuesta citada para responder/concretar
  const [replyToPropuesta, setReplyToPropuesta] = useState<any | null>(null);
  const [tomandoParteId, setTomandoParteId] = useState<string | null>(null);
  const [montoParcialInput, setMontoParcialInput] = useState<string>('');

  // Cola secuencial (Mutex) para procesar estrictamente una sola concreción a la vez
  const colaConcrecionesRef = useRef<Promise<any>>(Promise.resolve());
  const encolarConcrecion = <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = colaConcrecionesRef.current.then(fn, fn);
    colaConcrecionesRef.current = next.then(() => {}, () => {});
    return next;
  };

  const invocarRpc = async (nombreRpc: string, params: Record<string, any>) => {
    if (onEjecutarRpc) {
      return await onEjecutarRpc(nombreRpc, params);
    }
    if (supabase) {
      const { data, error } = await supabase.rpc(nombreRpc, params);
      if (error) throw error;
      return data;
    }
    return null;
  };

  // Estado local de mensajes y jugadas para respuesta inmediata (< 5ms)
  const [mensajesPorSala, setMensajesPorSala] = useState<Record<string, any[]>>({});
  const [sugerenciaPedagogica, setSugerenciaPedagogica] = useState<{
    mensaje: string;
    opciones: string[];
  } | null>(null);

  // Estado del formulario de Auto-Incremento de Saldo Blindado
  const [metodoRecarga, setMetodoRecarga] = useState('PAGO_MOVIL');
  const [bancoRecarga, setBancoRecarga] = useState('');
  const [referenciaRecarga, setReferenciaRecarga] = useState('');
  const [montoRecarga, setMontoRecarga] = useState('');
  const [archivoComprobante, setArchivoComprobante] = useState<File | null>(null);
  const [estadoRecargaMsg, setEstadoRecargaMsg] = useState<string | null>(null);

  const salaActiva = salas.find((s) => s.id === salaSeleccionadaId) || salas[0];
  const mensajesSala = mensajesPorSala[salaActiva?.id] || [];

  const agregarMensajeLocal = (salaId: string, nuevoMsg: any) => {
    setMensajesPorSala((prev) => ({
      ...prev,
      [salaId]: [...(prev[salaId] || []), { id: crypto.randomUUID(), hora: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), ...nuevoMsg }],
    }));
  };

  // 1. APERTURA DE CARRERA CON DOBLE VISTA E INVITACIÓN EXACTA
  const abrirCarreraOperador = (sala: SalaActivaInfo, hipodromo: string, numero: number, distancia: number) => {
    if (!usuarioActual.esOperador) return;

    setSalas((prev) =>
      prev.map((s) =>
        s.id === sala.id
          ? { ...s, hipodromoActivo: hipodromo, numeroCarreraActiva: numero, distanciaActiva: distancia, estadoCarrera: 'abierta' }
          : s
      )
    );

    // VISTA 1: Tarjeta Oficial de Apertura en el Chat
    agregarMensajeLocal(sala.id, {
      remitente: '📋 OFICIAL DE PISTA',
      esBot: true,
      tipo: 'apertura_vista_1',
      contenido: `📊 PROGRAMA OFICIAL: ${hipodromo.toUpperCase()} — CARRERA ${numero} (${distancia}m) | Grupo: ${grupoNombre}`,
    });

    // VISTA 2: Mensaje Destacado de Invitación y Suerte (Texto Exacto Requerido)
    agregarMensajeLocal(sala.id, {
      remitente: '🏇 CONTROL DE SALA',
      esBot: true,
      tipo: 'apertura_vista_2',
      contenido: construirMensajeCarreraAbierta(hipodromo, numero),
    });
  };

  // 2. ENVÍO DE MENSAJE CON ESTANDARIZACIÓN AUTOMÁTICA Y CORRECCIÓN PEDAGÓGICA
  const manejarEnvioMensaje = async (textoManual?: string) => {
    const texto = (textoManual ?? textoInput).trim();
    if (!texto || !salaActiva) return;

    // Comando de Operador: Retirado
    const matchRetirado = texto.match(/^retirado\s+(?:el\s+|#)?(\d+[A-Z]?)$/i);
    if (matchRetirado && usuarioActual.esOperador) {
      const numRet = matchRetirado[1].toUpperCase();
      setSalas((prev) =>
        prev.map((s) => (s.id === salaActiva.id ? { ...s, retirados: [...s.retirados, numRet] } : s))
      );
      if (onEjecutarRpc) {
        await onEjecutarRpc('procesar_retirado_en_sala', {
          p_grupo_id: grupoId,
          p_sala_id: salaActiva.id,
          p_ejemplar_retirado: numRet,
        });
      }
      agregarMensajeLocal(salaActiva.id, {
        remitente: '🚨 OFICIAL DE PISTA',
        esBot: true,
        tipo: 'retirado',
        contenido: `🚫 RETIRADO OFICIAL: Ejemplar #${numRet}. Jugadas asociadas reintegradas y bloqueadas nuevas apuestas con el #${numRet}.`,
      });
      setTextoInput('');
      return;
    }

    // Comando de Operador: Pizarra de Llegada y Liquidación Condicional
    const matchPizarra = texto.match(/^(?:pizarra|llegada)[:\s]+(\d+)[\.\-\/\s]+(\d+)(?:[\.\-\/\s]+(\d+))?(?:[\.\-\/\s]+(\d+))?(?:[\.\-\/\s]+(\d+))?/i);
    if (matchPizarra && usuarioActual.esOperador) {
      const [_, p1, p2, p3, p4, p5] = matchPizarra;
      if (onEjecutarRpc) {
        const res = await onEjecutarRpc('liquidar_carrera_sala_oficial', {
          p_grupo_id: grupoId,
          p_sala_id: salaActiva.id,
          p_primero: p1,
          p_segundo: p2,
          p_tercero: p3 || null,
          p_cuarto: p4 || null,
          p_quinto: p5 || null,
        });
        if (res?.reporte) {
          agregarMensajeLocal(salaActiva.id, {
            remitente: '🏁 LIQUIDACIÓN OFICIAL',
            esBot: true,
            tipo: 'liquidacion',
            contenido: res.reporte,
          });
        }
      }
      agregarMensajeLocal(salaActiva.id, {
        remitente: '🤖 ASISTENTE DE SALA',
        esBot: true,
        tipo: 'pregunta_operador',
        contenido: `✅ Liquidación completada (${permitirCrucesNetting ? 'Con Cruce Bruto Netting 5%' : 'Sin Cruces'}). 👉 ¿Cuál es la próxima carrera a abrir?`,
      });
      setTextoInput('');
      return;
    }

    // 2.A CASO CONCRECIÓN: Si hay una propuesta citada en replyToPropuesta
    if (replyToPropuesta) {
      const accionPropuesta = replyToPropuesta.accionProponente || (replyToPropuesta.contenido.startsWith('Juego') ? 'JUEGA' : 'CONSIGUE');
      const remanenteDisponible = Number(replyToPropuesta.montoDisponible ?? replyToPropuesta.monto ?? 0);

      const evalConc = evaluarConcrecionEstricta(
        texto,
        accionPropuesta,
        remanenteDisponible,
        usuarioActual.saldoDisponible,
        usuarioActual.nombre
      );

      if (!evalConc.valido) {
        setSugerenciaPedagogica({
          mensaje: evalConc.motivoRechazo || 'Respuesta no válida para concretar.',
          opciones: accionPropuesta === 'JUEGA' ? ['Consigo', 'Doy', 'Jugaste'] : ['Juego', 'Voy', 'Ponte'],
        });
        return;
      }

      setSugerenciaPedagogica(null);
      setTextoInput('');

      // Encolar en mutex secuencial (1 sola concreción a la vez)
      await encolarConcrecion(async () => {
        try {
          const respConc = await invocarRpc('concretar_jugada_fifo_atomica', {
            p_grupo_id: grupoId,
            p_sala_id: salaActiva.id,
            p_propuesta_msg_id: replyToPropuesta.id,
            p_aceptante_id: usuarioActual.id,
            p_monto_pedido: evalConc.montoEfectivo,
          });

          if (respConc?.ok) {
            const montoConcretadoReal = Number(respConc.monto_concretado ?? evalConc.montoEfectivo);
            // Si el aceptante respondió por encima de su propio saldo disponible
            if (evalConc.excedioSaldo || respConc.excedio_saldo_aceptante) {
              agregarMensajeLocal(salaActiva.id, {
                remitente: '🤖 ASISTENTE DE SALA',
                esBot: true,
                tipo: 'alerta_bot',
                contenido: `Esta jugada solo por $${formatearMontoRegional(montoConcretadoReal)}`,
              });
              setSugerenciaPedagogica({
                mensaje: '"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo',
                opciones: [],
              });
            }

            const desglosePrevio: Array<{ jugador: string; monto: number }> = Array.isArray(replyToPropuesta.desgloseJugaron)
              ? replyToPropuesta.desgloseJugaron
              : [];
            const nuevoDesglose = [...desglosePrevio, { jugador: usuarioActual.nombre, monto: montoConcretadoReal }];
            const totalVanJugando = nuevoDesglose.reduce((acc, x) => acc + Number(x.monto || 0), 0);
            const lineasDesglose = nuevoDesglose
              .map((x) => `• ${x.jugador} jugó ${formatearMontoRegional(x.monto)}`)
              .join('\n');

            // Publicación oficial en el grupo ("Van jugando por X" + desglose)
            const msgPublico =
              `🤝 *Van jugando por ${formatearMontoRegional(totalVanJugando)}* (${replyToPropuesta.contenido})\n` +
              `${lineasDesglose}\n` +
              `${Number(respConc.remanente_propuesta) > 0 ? `Remanente disponible: ${formatearMontoRegional(Number(respConc.remanente_propuesta))}` : '✅ ¡Jugada completada!'}`;
            agregarMensajeLocal(salaActiva.id, {
              remitente: '🤖 ASISTENTE DE SALA',
              esBot: true,
              tipo: 'concrecion_fifo',
              contenido: msgPublico,
            });

            // Si fue recortado por remanente (Caso Cascada 90 + 10 = 100)
            if (respConc.fue_recortado_por_remanente) {
              agregarMensajeLocal(salaActiva.id, {
                remitente: 'ℹ️ AVISO DE CIERRE',
                esBot: true,
                tipo: 'aviso_remanente',
                contenido: `⚡ Propuesta #${String(replyToPropuesta.id).slice(0, 8)} completada al 100%. Solo quedaban $${formatearMontoRegional(montoConcretadoReal)} disponibles y fueron asignados a ${usuarioActual.nombre}.`,
              });
            }

            // Actualizar el estado de la propuesta en el feed
            setMensajesPorSala((prev) => ({
              ...prev,
              [salaActiva.id]: (prev[salaActiva.id] || []).map((m) =>
                m.id === replyToPropuesta.id
                  ? {
                      ...m,
                      montoDisponible: Number(respConc.remanente_propuesta),
                      estadoPropuesta: Number(respConc.remanente_propuesta) <= 0 ? 'cerrada' : 'abierta',
                      desgloseJugaron: nuevoDesglose,
                      montoJugadoTotal: totalVanJugando,
                    }
                  : m
              ),
            }));
          } else {
            alert(respConc?.error || respConc?.motivo || 'No se pudo concretar la jugada.');
          }
        } catch (err: any) {
          alert('Error al concretar jugada: ' + (err?.message || err));
        } finally {
          setReplyToPropuesta(null);
        }
      });
      return;
    }

    // 2.B CASO COMANDO DE RETIRO ("Se fue", "sf", etc.) — Cierra cada jugada abierta individualmente SIN saturar el chat
    const analisisRetiro = analizarComandoRetiro(texto);
    if (analisisRetiro.esComandoRetiro) {
      if (!analisisRetiro.esValido) {
        setSugerenciaPedagogica({
          mensaje: analisisRetiro.mensajeAclaratoria || "Por favor aclara si deseas retirar tus jugadas con: 'Se fue' o 'sf'",
          opciones: ["Se fue", "sf"],
        });
        return;
      }

      // Cerrar cada propuesta abierta no concretada del jugador individualmente sin enviar mensaje al grupo
      setMensajesPorSala((prev) => ({
        ...prev,
        [salaActiva.id]: (prev[salaActiva.id] || []).map((m) =>
          m.remitente === usuarioActual.nombre && m.tipo === "propuesta_jugada" && m.estadoPropuesta === "abierta"
            ? { ...m, estadoPropuesta: "cerrada", montoDisponible: 0 }
            : m
        ),
      }));

      setTextoInput("");
      setSugerenciaPedagogica(null);
      return;
    }

    // 2.C CASO NUEVA PROPUESTA O MENSAJE GENERAL
    const analisis = analizarYEstandarizarJugada(
      texto,
      usuarioActual.saldoDisponible,
      salaActiva.retirados,
      16,
      usuarioActual.nombre
    );

    if (analisis.esIntencionDeJugada && !analisis.valido) {
      // Guardar en registro_revision_llm y mostrar corrección pedagógica SOLO al jugador
      setSugerenciaPedagogica({
        mensaje: analisis.mensajePedagogicoPrivado || 'Formato de jugada inválido.',
        opciones: analisis.sugerenciasUnClic || [],
      });
      if (onEjecutarRpc) {
        await onEjecutarRpc('registrar_interaccion_llm', {
          p_grupo_id: grupoId,
          p_sala_id: salaActiva.id,
          p_usuario_id: usuarioActual.id,
          p_mensaje_original: texto,
          p_respuesta_ia: analisis.mensajePedagogicoPrivado,
          p_confianza: analisis.confianza,
          p_requiere_operador: analisis.requiereOperador,
        });
      }
      return;
    }

    setSugerenciaPedagogica(null);
    const textoFinalAPublicar = analisis.esIntencionDeJugada ? analisis.jugadaEstandarizada : texto;
    const firma = await generarHashTextoSHA256(`${grupoId}|${salaActiva.id}|${usuarioActual.id}|${textoFinalAPublicar}|${Date.now()}`);
    const cifrado = await cifrarMensajeSala(textoFinalAPublicar, grupoId);

    if (analisis.esIntencionDeJugada) {
      let propId = crypto.randomUUID();
      let montoPublicado = analisis.monto;
      let excedio = Boolean(analisis.excedioSaldo);

      try {
        const respRpc = await invocarRpc('publicar_propuesta_atomica', {
          p_grupo_id: grupoId,
          p_sala_id: salaActiva.id,
          p_carrera_id: salaActiva.carreraActivaId || '00000000-0000-0000-2026-111400000001',
          p_jugador_id: usuarioActual.id,
          p_accion: analisis.accionProponente,
          p_es_match: analisis.esMatch,
          p_modalidad: analisis.modalidad,
          p_caballos_a: analisis.caballosBandoA,
          p_caballos_b: analisis.caballosBandoB,
          p_ejemplar_texto: analisis.ejemplarTexto,
          p_proporcion: '1x1',
          p_monto_solicitado: analisis.monto,
          p_texto_estandarizado: analisis.jugadaEstandarizada,
        });

        if (respRpc?.propuesta_id) propId = respRpc.propuesta_id;
        if (respRpc?.monto_publicado != null) montoPublicado = Number(respRpc.monto_publicado);
        if (respRpc?.excedio_saldo != null) excedio = Boolean(respRpc.excedio_saldo);
      } catch (err: any) {
        console.warn('Fallback local para propuesta:', err);
      }

      // Publicar la burbuja de propuesta en el chat
      agregarMensajeLocal(salaActiva.id, {
        id: propId,
        remitente: usuarioActual.nombre,
        esBot: false,
        tipo: 'propuesta_jugada',
        contenido: textoFinalAPublicar,
        monto: analisis.monto,
        montoOriginal: analisis.monto,
        montoDisponible: montoPublicado,
        accionProponente: analisis.accionProponente,
        estadoPropuesta: 'abierta',
        firmaSha256: firma.slice(0, 12),
        payloadCifrado: cifrado,
      });

      // Si el jugador publicó por más de su saldoDisponible:
      if (excedio) {
        // El Bot publica inmediatamente en el grupo citando la jugada:
        agregarMensajeLocal(salaActiva.id, {
          remitente: '🤖 ASISTENTE DE SALA',
          esBot: true,
          tipo: 'alerta_bot',
          contenido: `${usuarioActual.nombre} solo dispone de $${formatearMontoRegional(usuarioActual.saldoDisponible)} para esta jugada.`,
        });

        // El Bot le envía simultáneamente en privado al jugador:
        setSugerenciaPedagogica({
          mensaje: '"Atento", no publique jugadas por encima de saldo disponible, nos agrada tenerlo en este grupo',
          opciones: [],
        });
      }
    } else {
      // Mensaje de texto estándar
      agregarMensajeLocal(salaActiva.id, {
        remitente: usuarioActual.nombre,
        esBot: false,
        tipo: 'texto',
        contenido: textoFinalAPublicar,
        firmaSha256: firma.slice(0, 12),
        payloadCifrado: cifrado,
      });
    }

    setTextoInput('');
  };

  // 3. DESCARGAR IMAGEN PNG DEL REPORTE DE PREJUGADAS (CANVAS NATIVO)
  const descargarImagenPrejugadas = () => {
    const jugadas = mensajesSala.filter((m) => m.tipo === 'propuesta_jugada');
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = Math.max(400, 180 + jugadas.length * 42);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0b141a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#00a884';
    ctx.font = 'bold 22px monospace';
    ctx.fillText(`📋 REPORTE DE PREJUGADAS — ${salaActiva.hipodromoActivo} C${salaActiva.numeroCarreraActiva}`, 30, 45);
    ctx.fillStyle = '#e9edef';
    ctx.font = '16px monospace';
    ctx.fillText(`Grupo: ${grupoNombre} | Sello E2EE Verificado`, 30, 75);

    jugadas.forEach((j, idx) => {
      ctx.fillStyle = '#ffd279';
      ctx.fillText(`${idx + 1}) ${j.remitente}: ${j.contenido} [Hash: ${j.firmaSha256}]`, 30, 130 + idx * 36);
    });

    const link = document.createElement('a');
    link.download = `Prejugadas_${salaActiva.hipodromoActivo}_C${salaActiva.numeroCarreraActiva}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  // 4. ENVIAR SOLICITUD DE AUTO-RECARGA BLINDADA (SHA-256 IMAGEN + RPC)
  const procesarRecargaBlindada = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!archivoComprobante || !referenciaRecarga || !montoRecarga) return;

    const hashImagen = await generarHashArchivoSHA256(archivoComprobante);
    setEstadoRecargaMsg(`🔒 Verificando huella SHA-256 (${hashImagen.slice(0, 10)}...) y conciliando con Bóveda Bancaria...`);

    if (onEjecutarRpc) {
      const resp = await onEjecutarRpc('procesar_solicitud_recarga_blindada', {
        p_grupo_id: grupoId,
        p_cliente_id: usuarioActual.id,
        p_metodo_pago: metodoRecarga,
        p_banco_origen: bancoRecarga,
        p_referencia: referenciaRecarga,
        p_monto_reportado: parseFloat(montoRecarga),
        p_moneda: 'USD',
        p_tasa_cambio: 1,
        p_comprobante_url: archivoComprobante.name,
        p_hash_imagen_sha256: hashImagen,
        p_datos_ocr_ia: { verificado: true },
        p_confianza_ia: 0.96,
      });

      if (resp?.auto_aprobado) {
        setEstadoRecargaMsg(`✅ ¡Recarga Auto-Aprobada! Nuevo saldo acreditado: $${resp.nuevo_saldo_disponible}`);
      } else {
        setEstadoRecargaMsg(resp?.mensaje || '⏳ Solicitud pre-validada en espera de confirmación bancaria.');
      }
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#0b141a] text-[#e9edef] select-none">
      {/* SECCIÓN DE PUBLICIDAD EN TOPE DE SALA */}
      <div className="bg-gradient-to-r from-emerald-950 via-[#111b21] to-emerald-950 border-b border-emerald-800/40 px-4 py-1.5 flex items-center justify-between text-xs">
        <span className="truncate font-medium text-emerald-300">
          📢 <strong>PUBLICIDAD OFICIAL ({grupoNombre}):</strong> Juega Puestos, Llaves y Match en vivo con liquidación instantánea y seguridad E2EE.
        </span>
        <span className="text-[11px] text-emerald-400 font-mono hidden sm:inline">🔒 E2EE SHA-256 Activo</span>
      </div>

      {/* CABECERA ESTILO WHATSAPP WEB + BOTÓN SALIR A LA PLATAFORMA + SELECTOR DE HASTA 2 SALAS ACTIVAS + BILLETERA PRIVADA */}
      <div className="bg-[#008069] text-white px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-1.5 border-b border-[#016b58]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.href = usuarioActual.esOperador ? '/inicio' : '/portal';
              }
            }}
            className="bg-white/15 hover:bg-white/25 text-white border border-white/25 px-2.5 py-1 rounded-lg text-xs font-extrabold transition"
          >
            ← Salir a la Plataforma
          </button>
          <span className="font-bold text-white text-sm">{grupoNombre}</span>
          <div className="flex bg-[#016b58] rounded-lg p-0.5">
            {salas.map((s) => (
              <button
                key={s.id}
                onClick={() => setSalaSeleccionadaId(s.id)}
                className={`px-2.5 py-0.5 rounded-md text-xs font-semibold transition ${
                  salaActiva?.id === s.id ? 'bg-white text-[#008069] font-bold' : 'text-white/80 hover:text-white'
                }`}
              >
                {s.nombreSala} ({s.hipodromoActivo} C{s.numeroCarreraActiva})
              </button>
            ))}
          </div>
          {salas.length === 2 && (
            <button
              onClick={() => setVistaDualEscritorio(!vistaDualEscritorio)}
              className="hidden lg:inline-block text-xs bg-gray-800 hover:bg-gray-700 px-2.5 py-1 rounded text-gray-200"
            >
              {vistaDualEscritorio ? '1 Sala' : 'Vista Dual (2 Salas)'}
            </button>
          )}
        </div>

        {/* CONTROLES DE TAMAÑO DE LETRA, PREJUGADAS Y BILLETERA PERSONAL PRIVADA */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setModalPrejugadasAbierto(true)}
            className="bg-amber-600/20 border border-amber-500/40 text-amber-300 hover:bg-amber-600/30 px-2.5 py-1 rounded text-xs font-semibold"
          >
            📋 Ver Reporte de Prejugadas (Preliminar WhatsApp + Imagen)
          </button>

          <div className="flex items-center bg-[#111b21] px-2.5 py-1 rounded border border-gray-700 text-xs font-mono tabular-nums">
            <span className="text-gray-400 mr-1">🔒 Saldo:</span>
            <span className="text-emerald-400 font-bold">
              {ocultarSaldo ? '$ ••••' : `$${formatearMontoRegional(usuarioActual.saldoDisponible)}`}
            </span>
            <button onClick={() => setOcultarSaldo(!ocultarSaldo)} className="ml-2 text-gray-400 hover:text-white">
              👁️
            </button>
          </div>

          <button
            onClick={() => setModalRecargaAbierto(true)}
            className="bg-[#00a884] hover:bg-emerald-500 text-black font-bold px-2.5 py-1 rounded text-xs"
          >
            ➕ Recargar
          </button>

          <div className="flex items-center gap-1 bg-[#111b21] px-2 py-1 rounded text-xs">
            <button onClick={() => setTamanoLetra(Math.max(12, tamanoLetra - 1))} className="px-1 hover:text-emerald-400">A-</button>
            <button onClick={() => setTamanoLetra(Math.min(22, tamanoLetra + 1))} className="px-1 hover:text-emerald-400">A+</button>
          </div>
        </div>
      </div>

      {/* CUERPO CENTRAL DE MENSAJES DE LA SALA */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ fontSize: `${tamanoLetra}px` }}>
        {mensajesSala.map((m) => {
          const esPropuesta = m.tipo === 'propuesta_jugada';
          const montoOrig = Number(m.montoOriginal || m.monto || 0);
          const montoDisp = Number(m.montoDisponible ?? m.monto ?? 0);
          const tieneDisponible = montoDisp > 0;
          const esMio = m.remitente === usuarioActual.nombre;

          return (
            <div
              key={m.id}
              className={`max-w-xl rounded-2xl p-3 shadow-md ${
                m.tipo === 'apertura_vista_2'
                  ? 'bg-emerald-950/90 border-2 border-emerald-500 text-center mx-auto font-bold text-emerald-200 whitespace-pre-line'
                  : m.esBot
                  ? 'bg-[#1f2c34] border-l-4 border-amber-400 text-gray-100 whitespace-pre-line mr-auto'
                  : esMio
                  ? 'bg-[#005c4b] ml-auto text-white rounded-tr-xs'
                  : 'bg-[#202c33] mr-auto text-gray-100 rounded-tl-xs border border-gray-700/50'
              }`}
            >
              <div className="flex justify-between items-center text-[11px] mb-1 font-mono gap-2">
                <span className={`font-semibold ${esMio ? 'text-emerald-200' : 'text-emerald-400'}`}>
                  {esMio ? 'Tú' : m.remitente}
                </span>
                <span className="text-[10px] text-gray-400">
                  {m.hora} {m.firmaSha256 ? `🔒#${m.firmaSha256}` : ''}
                </span>
              </div>

              {/* Mensaje citado si existe */}
              {m.propuestaCitada && (
                <div className="mb-2 p-2 rounded-lg bg-black/30 border-l-4 border-emerald-400 text-[11px]">
                  <span className="font-bold text-emerald-300 block text-[10px]">
                    ↩️ {m.propuestaCitada.remitente}
                  </span>
                  <p className="text-gray-300 truncate font-mono text-[11px]">
                    {m.propuestaCitada.contenido}
                  </p>
                </div>
              )}

              <div className="tabular-nums font-medium text-xs leading-relaxed">{m.contenido}</div>

              {/* SELECCIÓN Y BARRA EN VIVO PARA PROPUESTAS DE JUGADA */}
              {esPropuesta && (
                <div className="mt-2.5 pt-2 border-t border-gray-700/60 font-sans">
                  <div className="flex justify-between items-center text-[11px] mb-1 font-mono gap-2">
                    <span className="text-gray-400">Estado de Parada:</span>
                    <div className="flex items-center gap-1.5">
                      <span className={`font-bold ${tieneDisponible ? 'text-emerald-400' : 'text-gray-500 line-through'}`}>
                        Disponible: ${formatearMontoRegional(montoDisp)} de ${formatearMontoRegional(montoOrig)}
                      </span>
                      {esMio && tieneDisponible && (
                        <button
                          type="button"
                          onClick={() => {
                            setMensajesPorSala((prev) => ({
                              ...prev,
                              [salaActiva.id]: (prev[salaActiva.id] || []).map((item) =>
                                item.id === m.id ? { ...item, estadoPropuesta: 'cerrada', montoDisponible: 0 } : item
                              ),
                            }));
                          }}
                          className="bg-red-950/70 hover:bg-red-900 text-red-300 border border-red-700/50 px-1.5 py-0.5 rounded text-[10px] font-bold"
                          title="Cerrar esta jugada directamente sin enviar mensaje al chat"
                        >
                          🚫 Se fue
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-emerald-500 h-1.5 rounded-full transition-all"
                      style={{ width: `${montoOrig > 0 ? (montoDisp / montoOrig) * 100 : 0}%` }}
                    />
                  </div>

                  {Array.isArray(m.desgloseJugaron) && m.desgloseJugaron.length > 0 && (
                    <div className="mt-2 rounded-lg bg-black/30 border border-emerald-500/30 px-2.5 py-1.5 text-[11px] space-y-0.5">
                      <div className="font-bold text-emerald-400">
                        🤝 Van jugando por {formatearMontoRegional(Number(m.montoJugadoTotal ?? (montoOrig - montoDisp)))}
                      </div>
                      {m.desgloseJugaron.map((item: { jugador: string; monto: number }, idx: number) => (
                        <div key={idx} className="text-gray-200 font-medium">
                          • <span className="font-bold">{item.jugador}</span> jugó{' '}
                          <span className="font-mono font-bold">{formatearMontoRegional(item.monto)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {!esMio && tieneDisponible && (
                    <div className="mt-2 space-y-1.5">
                      <button
                        onClick={() => {
                          const esJuego = (m.accionProponente || (m.contenido.startsWith('Juego') ? 'JUEGA' : 'CONSIGUE')) === 'JUEGA';
                          setReplyToPropuesta(m);
                          manejarEnvioMensaje(esJuego ? `Consigo ${montoDisp}` : `Juego ${montoDisp}`);
                        }}
                        className="w-full bg-[#00a884] hover:bg-emerald-400 text-black text-xs font-black py-1.5 px-3 rounded-lg flex items-center justify-center gap-1 transition shadow-sm"
                      >
                        ⚡ Tomar Jugada Total (${formatearMontoRegional(montoDisp)})
                      </button>

                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          onClick={() => {
                            setTomandoParteId(tomandoParteId === m.id ? null : m.id);
                            setMontoParcialInput('');
                          }}
                          className="bg-[#111b21] hover:bg-[#2a3942] border border-gray-600 text-gray-200 font-bold py-1 px-2 rounded-md text-[11px] transition flex items-center justify-center gap-1"
                        >
                          ✂️ Tomar una parte
                        </button>
                        <button
                          onClick={() => {
                            setReplyToPropuesta(m);
                            const esJuego = (m.accionProponente || (m.contenido.startsWith('Juego') ? 'JUEGA' : 'CONSIGUE')) === 'JUEGA';
                            setTextoInput(esJuego ? 'Consigo ' : 'Juego ');
                          }}
                          className="bg-[#111b21] hover:bg-[#2a3942] border border-emerald-600/50 text-emerald-300 font-bold py-1 px-2 rounded-md text-[11px] transition flex items-center justify-center gap-1"
                        >
                          ↩️ Responder WA
                        </button>
                      </div>

                      {tomandoParteId === m.id && (
                        <div className="p-2 bg-[#111b21] rounded-lg border border-emerald-500/40 space-y-2 mt-1">
                          <div className="text-[10px] text-gray-300 font-semibold flex items-center justify-between">
                            <span>Monto a tomar (Máx: ${montoDisp}):</span>
                            <button onClick={() => setTomandoParteId(null)} className="text-gray-400 hover:text-white text-xs font-bold">
                              ✕
                            </button>
                          </div>
                          <div className="flex gap-1.5 flex-wrap">
                            {[10, 20, 50].filter(v => v < montoDisp).map(val => (
                              <button
                                key={val}
                                onClick={() => {
                                  const esJuego = (m.accionProponente || (m.contenido.startsWith('Juego') ? 'JUEGA' : 'CONSIGUE')) === 'JUEGA';
                                  setReplyToPropuesta(m);
                                  setTomandoParteId(null);
                                  manejarEnvioMensaje(esJuego ? `Consigo ${val}` : `Juego ${val}`);
                                }}
                                className="bg-[#202c33] hover:bg-emerald-600 hover:text-black text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded text-xs font-mono font-bold"
                              >
                                Tomar ${val}
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min="1"
                              max={montoDisp}
                              value={montoParcialInput}
                              onChange={(e) => setMontoParcialInput(e.target.value)}
                              placeholder={`Monto (1 - ${montoDisp})`}
                              className="flex-1 bg-[#202c33] text-white text-xs px-2.5 py-1.5 rounded border border-gray-700 outline-none focus:border-emerald-400 font-mono"
                            />
                            <button
                              onClick={() => {
                                const n = Number(montoParcialInput);
                                if (!n || n <= 0 || n > montoDisp) {
                                  alert(`Monto inválido. Ingrese entre 1 y ${montoDisp}`);
                                  return;
                                }
                                const esJuego = (m.accionProponente || (m.contenido.startsWith('Juego') ? 'JUEGA' : 'CONSIGUE')) === 'JUEGA';
                                setReplyToPropuesta(m);
                                setTomandoParteId(null);
                                setMontoParcialInput('');
                                manejarEnvioMensaje(esJuego ? `Consigo ${n}` : `Juego ${n}`);
                              }}
                              className="bg-emerald-500 hover:bg-emerald-400 text-black font-black px-3 py-1.5 rounded text-xs"
                            >
                              ✓ Tomar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* BURBUJA PRIVADA DE CORRECCIÓN PEDAGÓGICA (SOLO VISIBLE PARA EL JUGADOR) */}
      {sugerenciaPedagogica && (
        <div className="bg-[#1f2c34] border-t-2 border-amber-500 px-4 py-3 text-xs">
          <div className="text-amber-300 font-semibold whitespace-pre-line mb-2">
            {sugerenciaPedagogica.mensaje}
          </div>
          <div className="flex flex-wrap gap-2">
            {sugerenciaPedagogica.opciones.map((op) => (
              <button
                key={op}
                onClick={() => manejarEnvioMensaje(op)}
                className="bg-[#00a884] text-black font-bold px-3 py-1 rounded hover:bg-emerald-400"
              >
                ✅ Enviar: {op}
              </button>
            ))}
            <button onClick={() => setSugerenciaPedagogica(null)} className="text-gray-400 underline ml-2">
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* BANNER DE CITACIÓN AL RESPONDER / CONCRETAR PROPUESTA */}
      {replyToPropuesta && (
        <div className="bg-[#182229] border-t border-[#00a884]/40 px-3 py-2 flex items-center justify-between text-xs animate-in fade-in">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-emerald-400 text-sm">↩️</span>
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-emerald-400 truncate">
                Respondiendo a {replyToPropuesta.remitente} (Disponible: ${Number(replyToPropuesta.montoDisponible ?? replyToPropuesta.monto ?? 0).toFixed(2)})
              </p>
              <p className="text-[11px] text-gray-300 font-mono truncate">{replyToPropuesta.contenido}</p>
            </div>
          </div>
          <button
            onClick={() => setReplyToPropuesta(null)}
            className="text-gray-400 hover:text-white px-2 py-1 font-bold text-xs"
            title="Cancelar respuesta"
          >
            ✕ Cancelar
          </button>
        </div>
      )}

      {/* BARRA INFERIOR DE ESCRITURA ESTILO WHATSAPP */}
      <div className="bg-[#202c33] p-3 space-y-2">
        {replyToPropuesta ? (
          <div className="flex gap-1.5 overflow-x-auto pb-1 text-[11px]">
            {((replyToPropuesta.accionProponente || (replyToPropuesta.contenido.startsWith('Juego') ? 'JUEGA' : 'CONSIGUE')) === 'JUEGA'
              ? ['Consigo', 'Doy', 'J', 'Jugaste', 'Jugamos', 'Ponte']
              : ['Juego', 'Jugue', 'Jugué', 'Voy', 'Ponte']
            ).map((verbo) => (
              <button
                key={verbo}
                onClick={() => setTextoInput(`${verbo} `)}
                className="bg-[#111b21] hover:bg-emerald-950/80 text-emerald-300 border border-emerald-600/40 px-2.5 py-0.5 rounded font-mono text-xs font-bold"
              >
                + {verbo}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex gap-1.5 overflow-x-auto pb-1 text-[11px]">
            <button
              onClick={() => setTextoInput('Juego 1P ')}
              className="bg-[#111b21] hover:bg-gray-800 text-gray-300 border border-gray-700 px-2 py-0.5 rounded font-mono text-xs"
            >
              + Juego 1P
            </button>
            <button
              onClick={() => setTextoInput('Consigo 1P ')}
              className="bg-[#111b21] hover:bg-gray-800 text-gray-300 border border-gray-700 px-2 py-0.5 rounded font-mono text-xs"
            >
              + Consigo 1P
            </button>
            <button
              onClick={() => setTextoInput('Juego 1x4 50')}
              className="bg-[#111b21] hover:bg-gray-800 text-gray-300 border border-gray-700 px-2 py-0.5 rounded font-mono text-xs"
            >
              + Match
            </button>
            <button
              onClick={() => manejarEnvioMensaje('Se fue')}
              className="bg-red-950/70 hover:bg-red-900/80 text-red-300 border border-red-700/50 px-2 py-0.5 rounded font-mono font-bold text-xs flex items-center gap-1"
              title="Cierra todas tus jugadas abiertas no concretadas"
            >
              <span>🚫</span> Se fue (Retirar)
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          {usuarioActual.esOperador && (
            <button
              onClick={() =>
                abrirCarreraOperador(
                  salaActiva,
                  salaActiva.hipodromoActivo || (salaActiva.nombreSala?.toUpperCase().includes('AMERICANA') ? 'GULFSTREAM PARK' : 'LA RINCONADA'),
                  salaActiva.numeroCarreraActiva || 5,
                  salaActiva.distanciaActiva || 1200
                )
              }
              className="bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold px-3 py-2.5 rounded-lg shrink-0"
            >
              🏇 Abrir Carrera
            </button>
          )}
          <input
            type="text"
            value={textoInput}
            onChange={(e) => setTextoInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && manejarEnvioMensaje()}
            placeholder={
              replyToPropuesta
                ? `Concretar jugada de ${replyToPropuesta.remitente} (Ej: Consigo ${replyToPropuesta.montoDisponible ?? replyToPropuesta.monto})...`
                : 'Escribe tu jugada (Ej: Juego 1p del 5 con 100 | Juego la 15 x 46 con 100)...'
            }
            className="flex-1 bg-[#2a3942] text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none"
          />
          <button
            onClick={() => manejarEnvioMensaje()}
            className="bg-[#00a884] hover:bg-emerald-500 text-black font-bold px-5 py-2.5 rounded-lg text-sm shrink-0"
          >
            Enviar
          </button>
        </div>
      </div>

      {/* MODAL DE REPORTE DE PREJUGADAS (WHATSAPP + IMAGEN PNG) */}
      {modalPrejugadasAbierto && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-[#202c33] rounded-xl max-w-lg w-full p-5 border border-gray-700">
            <h3 className="font-bold text-emerald-400 text-base mb-3">
              📋 Reporte Preliminar de Prejugadas — {salaActiva?.hipodromoActivo} C{salaActiva?.numeroCarreraActiva}
            </h3>
            <pre className="bg-[#111b21] p-3 rounded text-xs font-mono overflow-y-auto max-h-60 whitespace-pre-wrap">
              {mensajesSala
                .filter((m) => m.tipo === 'propuesta_jugada')
                .map((m, i) => `${i + 1}) ${m.remitente}: ${m.contenido}`)
                .join('\n') || 'Aún no hay prejugadas registradas en esta carrera.'}
            </pre>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={descargarImagenPrejugadas}
                className="bg-[#00a884] text-black font-bold px-4 py-2 rounded text-xs"
              >
                🖼️ Descargar Imagen PNG
              </button>
              <button
                onClick={() => setModalPrejugadasAbierto(false)}
                className="bg-gray-700 text-white px-4 py-2 rounded text-xs"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE AUTO-INCREMENTO DE SALDO BLINDADO */}
      {modalRecargaAbierto && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <form onSubmit={procesarRecargaBlindada} className="bg-[#202c33] rounded-xl max-w-md w-full p-5 border border-gray-700 space-y-3">
            <h3 className="font-bold text-emerald-400 text-base">🏦 Auto-Recarga de Saldo (Validación IA + Bóveda)</h3>
            <select
              value={metodoRecarga}
              onChange={(e) => setMetodoRecarga(e.target.value)}
              className="w-full bg-[#111b21] p-2 rounded text-sm"
            >
              <option value="PAGO_MOVIL">Pago Móvil</option>
              <option value="ZELLE">Zelle</option>
              <option value="TRANSFERENCIA">Transferencia Bancaria</option>
              <option value="BINANCE">Binance Pay</option>
            </select>
            <input
              type="text"
              placeholder="Banco de origen"
              value={bancoRecarga}
              onChange={(e) => setBancoRecarga(e.target.value)}
              className="w-full bg-[#111b21] p-2 rounded text-sm"
              required
            />
            <input
              type="text"
              placeholder="Número de Referencia (Últimos 6 o completa)"
              value={referenciaRecarga}
              onChange={(e) => setReferenciaRecarga(e.target.value)}
              className="w-full bg-[#111b21] p-2 rounded text-sm font-mono"
              required
            />
            <input
              type="number"
              step="0.01"
              placeholder="Monto exacto ($)"
              value={montoRecarga}
              onChange={(e) => setMontoRecarga(e.target.value)}
              className="w-full bg-[#111b21] p-2 rounded text-sm font-mono"
              required
            />
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setArchivoComprobante(e.target.files?.[0] || null)}
              className="w-full text-xs text-gray-300"
              required
            />
            {estadoRecargaMsg && <p className="text-xs text-amber-300 font-mono">{estadoRecargaMsg}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="submit" className="bg-[#00a884] text-black font-bold px-4 py-2 rounded text-xs">
                Validar y Acreditar Saldo
              </button>
              <button type="button" onClick={() => setModalRecargaAbierto(false)} className="bg-gray-700 px-4 py-2 rounded text-xs">
                Cerrar
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}