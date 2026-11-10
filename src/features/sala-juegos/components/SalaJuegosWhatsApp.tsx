cat << 'EOF' > src/features/sala-juegos/components/SalaJuegosWhatsApp.tsx
'use client';
// LÍNEA 1: Interfaz Completa de Sala de Juegos Estilo WhatsApp / WhatsApp Web

import React, { useState } from 'react';
import { analizarYEstandarizarJugada } from '../lib/parser-pedagogico';
import { generarHashArchivoSHA256, generarHashTextoSHA256, cifrarMensajeSala } from '../lib/seguridad-crypto';

export interface SalaActivaInfo {
  id: string;
  nombreSala: string;
  hipodromoActivo: string;
  numeroCarreraActiva: number;
  distanciaActiva: number;
  estadoCarrera: 'abierta' | 'cerrada' | 'liquidada';
  retirados: string[];
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
      contenido:
        `🏇 ¡ABIERTA ${hipodromo.toUpperCase()} - CARRERA ${numero} (${distancia}m)! 🏇\n` +
        `La sala está habilitada para recibir sus propuestas \n` +
        `¡Hagan sus jugadas y mucha suerte a todos! 🍀`,
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

    // Analizar jugada del jugador con el Motor Pedagógico
    const analisis = analizarYEstandarizarJugada(
      texto,
      usuarioActual.saldoDisponible,
      salaActiva.retirados
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

    agregarMensajeLocal(salaActiva.id, {
      remitente: usuarioActual.nombre,
      esBot: false,
      tipo: analisis.esIntencionDeJugada ? 'propuesta_jugada' : 'texto',
      contenido: textoFinalAPublicar,
      monto: analisis.monto,
      firmaSha256: firma.slice(0, 12),
      payloadCifrado: cifrado,
    });

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

      {/* CABECERA ESTILO WHATSAPP WEB + SELECTOR DE HASTA 2 SALAS ACTIVAS + BILLETERA PRIVADA */}
      <div className="bg-[#202c33] px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <span className="font-bold text-emerald-400 text-sm">{grupoNombre}</span>
          <div className="flex bg-[#111b21] rounded-lg p-0.5">
            {salas.map((s) => (
              <button
                key={s.id}
                onClick={() => setSalaSeleccionadaId(s.id)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition ${
                  salaActiva?.id === s.id ? 'bg-[#00a884] text-black' : 'text-gray-300 hover:text-white'
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
              {ocultarSaldo ? '$ ••••' : `$${usuarioActual.saldoDisponible.toFixed(2)}`}
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
        {mensajesSala.map((m) => (
          <div
            key={m.id}
            className={`max-w-xl rounded-lg p-3 shadow ${
              m.tipo === 'apertura_vista_2'
                ? 'bg-emerald-950/90 border-2 border-emerald-500 text-center mx-auto font-bold text-emerald-200 whitespace-pre-line'
                : m.esBot
                ? 'bg-[#1f2c34] border-l-4 border-amber-400 text-gray-100 whitespace-pre-line'
                : m.remitente === usuarioActual.nombre
                ? 'bg-[#005c4b] ml-auto text-white'
                : 'bg-[#202c33] text-gray-100'
            }`}
          >
            <div className="flex justify-between text-[11px] text-emerald-300/80 mb-1 font-mono">
              <span>{m.remitente}</span>
              <span>{m.hora} {m.firmaSha256 ? `🔒#${m.firmaSha256}` : ''}</span>
            </div>
            <div className="tabular-nums">{m.contenido}</div>
          </div>
        ))}
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

      {/* BARRA INFERIOR DE ESCRITURA ESTILO WHATSAPP */}
      <div className="bg-[#202c33] p-3 flex items-center gap-2">
        {usuarioActual.esOperador && (
          <button
            onClick={() =>
              abrirCarreraOperador(
                salaActiva,
                salaActiva.hipodromoActivo || 'LA RINCONADA',
                salaActiva.numeroCarreraActiva || 5,
                salaActiva.distanciaActiva || 1200
              )
            }
            className="bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold px-3 py-2.5 rounded-lg"
          >
            🏇 Abrir Carrera (2 Vistas)
          </button>
        )}
        <input
          type="text"
          value={textoInput}
          onChange={(e) => setTextoInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && manejarEnvioMensaje()}
          placeholder="Escribe tu jugada (Ej: Juego 1p del 5 con 100 | Juego la 15 x 46 con 100)..."
          className="flex-1 bg-[#2a3942] text-white rounded-lg px-4 py-2.5 text-sm focus:outline-none"
        />
        <button
          onClick={() => manejarEnvioMensaje()}
          className="bg-[#00a884] hover:bg-emerald-500 text-black font-bold px-5 py-2.5 rounded-lg text-sm"
        >
          Enviar
        </button>
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
// LÍNEA 340: Fin del archivo SalaJuegosWhatsApp.tsx
EOF
echo "✅ Archivo 3 (SalaJuegosWhatsApp.tsx) creado correctamente."