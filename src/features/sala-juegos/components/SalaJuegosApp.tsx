"use client";

import React, { useState, useEffect, useCallback } from "react";
import { salaApi, configurarCredencialesSala } from "../lib/sala-api";
import { ChatSalaPanel, FAMILIAS_FUENTE_SALA, type ClaveFuenteSala, type TemaSala } from "./ChatSalaPanel";
import { ModalOperadorSala } from "./ModalOperadorSala";
import { ModalRecargaBlindada } from "./ModalRecargaBlindada";
import { ModalPrejugadas } from "./ModalPrejugadas";
import { formatearMontoRegional } from "@/shared/lib/dinero";

export interface PropsSalaJuegosApp {
  grupoIdInicial?: string;
  clienteIdInicial?: string;
  portalTokenInicial?: string;
  staffTokenInicial?: string;
  esEmbebido?: boolean;
  onSalirPlataforma?: () => void;
}

export function SalaJuegosApp({
  grupoIdInicial,
  clienteIdInicial,
  portalTokenInicial,
  staffTokenInicial,
  esEmbebido = false,
  onSalirPlataforma,
}: PropsSalaJuegosApp) {
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const [identidad, setIdentidad] = useState<any>(null);
  const [grupos, setGrupos] = useState<any[]>([]);
  const [grupoActivo, setGrupoActivo] = useState<any>(null);
  const [salas, setSalas] = useState<any[]>([]);
  const [publicidad, setPublicidad] = useState<any[]>([]);

  const [salaSeleccionadaId, setSalaSeleccionadaId] = useState<string>("");
  const [vistaDual, setVistaDual] = useState<boolean>(false);
  const [tamanoLetra, setTamanoLetra] = useState<number>(14);
  const [fuenteId, setFuenteId] = useState<ClaveFuenteSala>("whatsapp");
  const [tema, setTema] = useState<TemaSala>("claro");
  const [menuFuenteAbierto, setMenuFuenteAbierto] = useState<boolean>(false);
  const [ocultarSaldo, setOcultarSaldo] = useState<boolean>(false);

  // Modales
  const [modalRecargaAbierto, setModalRecargaAbierto] = useState(false);
  const [modalOperadorAbierto, setModalOperadorAbierto] = useState(false);
  const [modalPrejugadasAbierto, setModalPrejugadasAbierto] = useState(false);

  // Cargar preferencias de tipografía y tema (predeterminado: WhatsApp + Tema Claro Hípico)
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const savedSize = window.localStorage.getItem("hipico_sala_font_size_v1");
      if (savedSize) {
        const n = Number(savedSize);
        if (n >= 12 && n <= 20) setTamanoLetra(n);
      }
      const savedFont = window.localStorage.getItem("hipico_sala_font_family_v1") as ClaveFuenteSala | null;
      if (savedFont && FAMILIAS_FUENTE_SALA[savedFont]) {
        setFuenteId(savedFont);
      }
      const savedTema = window.localStorage.getItem("hipico_sala_tema_v1") as TemaSala | null;
      if (savedTema === "claro" || savedTema === "oscuro") {
        setTema(savedTema);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const cambiarTamanoLetra = (nuevo: number) => {
    const val = Math.max(12, Math.min(20, nuevo));
    setTamanoLetra(val);
    try {
      window.localStorage.setItem("hipico_sala_font_size_v1", String(val));
    } catch {}
  };

  const cambiarFuente = (nueva: ClaveFuenteSala) => {
    setFuenteId(nueva);
    try {
      window.localStorage.setItem("hipico_sala_font_family_v1", nueva);
    } catch {}
  };

  const alternarTema = () => {
    const nuevo: TemaSala = tema === "claro" ? "oscuro" : "claro";
    setTema(nuevo);
    try {
      window.localStorage.setItem("hipico_sala_tema_v1", nuevo);
    } catch {}
  };

  const salirALaPlataforma = () => {
    if (onSalirPlataforma) {
      onSalirPlataforma();
      return;
    }
    if (typeof window !== "undefined") {
      const esJugador = identidad?.tipo === "JUGADOR" || Boolean(portalTokenInicial);
      window.location.href = esJugador ? "/portal" : "/inicio";
    }
  };

  // Inicializar credenciales
  useEffect(() => {
    configurarCredencialesSala({
      portalToken: portalTokenInicial,
      clienteId: clienteIdInicial,
      staffToken: staffTokenInicial,
    });
  }, [portalTokenInicial, clienteIdInicial, staffTokenInicial]);

  const cargarBootstrap = useCallback(async (gId?: string) => {
    setCargando(true);
    setErrorCarga(null);
    try {
      const res = await salaApi.bootstrap(gId || grupoIdInicial);
      if (!res.ok) {
        setErrorCarga(res.error || "No se pudo cargar la sala de juegos.");
        setCargando(false);
        return;
      }

      const d = res.data;
      setIdentidad(d.identidad);
      setGrupos(d.grupos || []);
      setGrupoActivo(d.grupoActivo);
      const salasActivas = d.salas || [];
      setSalas(salasActivas);
      setPublicidad(d.publicidad || []);

      if (salasActivas.length > 0) {
        setSalaSeleccionadaId((prev) => (salasActivas.some((s: any) => s.id === prev) ? prev : salasActivas[0].id));
      }
    } catch (err: any) {
      setErrorCarga(err?.message || "Error al conectar con el servidor.");
    } finally {
      setCargando(false);
    }
  }, [grupoIdInicial]);

  useEffect(() => {
    cargarBootstrap();
    const interval = setInterval(() => {
      if (grupoActivo?.id) {
        salaApi.getEstado(grupoActivo.id).then((res) => {
          if (res.ok && res.data?.salas) {
            setSalas(res.data.salas);
          }
        });
      }
    }, 6000);
    return () => clearInterval(interval);
  }, [cargarBootstrap, grupoActivo?.id]);

  const refrescarSaldo = async () => {
    if (!identidad?.usuarioId) return;
    const res = await salaApi.getCliente(identidad.usuarioId);
    if (res.ok && res.data?.cliente) {
      setIdentidad((prev: any) => ({
        ...prev,
        clienteRow: res.data.cliente,
      }));
    }
  };

  const esClaro = tema === "claro";
  const fontFamilyCss = FAMILIAS_FUENTE_SALA[fuenteId]?.css || FAMILIAS_FUENTE_SALA.whatsapp.css;

  if (cargando) {
    return (
      <div
        style={{ fontFamily: fontFamilyCss }}
        className={`h-full w-full flex flex-col items-center justify-center p-6 space-y-3 ${
          esClaro ? "bg-[#efeae2] text-[#111b21]" : "bg-[#0b141a] text-white"
        }`}
      >
        <div className="w-9 h-9 border-4 border-[#008069] border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-bold text-[#008069]">Cargando Sala Hípica en Vivo...</p>
        <p className="text-xs opacity-70">Sincronización instantánea y validación de credenciales</p>
      </div>
    );
  }

  if (errorCarga) {
    return (
      <div
        style={{ fontFamily: fontFamilyCss }}
        className={`h-full w-full flex flex-col items-center justify-center p-6 space-y-3 text-center ${
          esClaro ? "bg-[#efeae2] text-[#111b21]" : "bg-[#0b141a] text-white"
        }`}
      >
        <span className="text-4xl">🔒</span>
        <h2 className="text-base font-bold text-red-600">Acceso no autorizado o grupo no disponible</h2>
        <p className="text-xs opacity-80 max-w-md">{errorCarga}</p>
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={salirALaPlataforma}
            className="bg-slate-700 hover:bg-slate-600 text-white font-bold text-xs px-4 py-2 rounded-lg"
          >
            ← Salir a la Plataforma
          </button>
          <button
            onClick={() => cargarBootstrap()}
            className="bg-[#008069] hover:bg-[#017561] text-white font-bold text-xs px-4 py-2 rounded-lg"
          >
            Reintentar Conexión
          </button>
        </div>
      </div>
    );
  }

  const salaActiva = salas.find((s) => s.id === salaSeleccionadaId) || salas[0];
  const saldoDisp = identidad?.clienteRow?.saldo_disponible ?? 0;
  const esLibre = Boolean(identidad?.clienteRow?.libre);

  return (
    <div
      style={{ fontFamily: fontFamilyCss }}
      onClick={() => setMenuFuenteAbierto(false)}
      className={`flex flex-col select-none overflow-hidden ${
        esClaro ? "bg-[#efeae2] text-[#111b21]" : "bg-[#0b141a] text-[#e9edef]"
      } ${esEmbebido ? "h-full w-full" : "h-[100dvh] w-screen"}`}
    >
      {/* 1. SECCIÓN DE PUBLICIDAD EN TOPE (MÁRGENES MÍNIMOS) */}
      {publicidad.length > 0 && (
        <div
          className={`px-2 py-0.5 flex items-center justify-between text-[11px] border-b ${
            esClaro
              ? "bg-[#e7fce3] border-[#c1e8b8] text-[#111b21]"
              : "bg-gradient-to-r from-emerald-950 via-[#111b21] to-emerald-950 border-emerald-800/40 text-gray-200"
          }`}
        >
          <div className="truncate flex items-center gap-1.5">
            <span className="bg-[#008069] text-white font-bold px-1.5 py-0.2 rounded text-[10px]">
              📢 {publicidad[0].titulo}
            </span>
            <span className="truncate text-[11px]">{publicidad[0].contenido_texto}</span>
            {publicidad[0].enlace_accion && (
              <a
                href={publicidad[0].enlace_accion}
                target="_blank"
                rel="noreferrer"
                className="text-[#008069] font-bold hover:underline text-[11px]"
              >
                Ver →
              </a>
            )}
          </div>
        </div>
      )}

      {/* 2. CABECERA ESTILO WHATSAPP OFICIAL: SALIR A PLATAFORMA + SALAS + WALLET + FUENTE/TEMA */}
      <div
        className={`px-1.5 sm:px-2.5 py-1 flex flex-wrap items-center justify-between gap-1 border-b shadow-xs relative z-30 ${
          esClaro
            ? "bg-[#008069] text-white border-[#016b58]"
            : "bg-[#202c33] text-[#e9edef] border-[#2a3942]"
        }`}
      >
        {/* Lado izquierdo: Botón Salir a la Plataforma + Grupo + Selector de salas */}
        <div className="flex items-center gap-1 sm:gap-1.5 min-w-0">
          <button
            type="button"
            onClick={salirALaPlataforma}
            title="Salir de la Sala y volver a la Plataforma"
            className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-extrabold transition shadow-xs ${
              esClaro
                ? "bg-white/15 hover:bg-white/25 text-white border border-white/25"
                : "bg-[#111b21] hover:bg-gray-800 text-emerald-400 border border-emerald-600/40"
            }`}
          >
            <span>←</span>
            <span className="hidden xs:inline sm:inline">Salir a Plataforma</span>
            <span className="inline xs:hidden sm:hidden">Salir</span>
          </button>

          {grupos.length > 1 && identidad?.esAdmin ? (
            <select
              value={grupoActivo?.id}
              onChange={(e) => cargarBootstrap(e.target.value)}
              className={`font-bold text-[11px] rounded-lg px-1.5 py-1 outline-none max-w-[130px] sm:max-w-[180px] truncate ${
                esClaro
                  ? "bg-[#016b58] border border-white/25 text-white"
                  : "bg-[#111b21] border border-emerald-600/60 text-emerald-400"
              }`}
            >
              {grupos.map((g) => (
                <option key={g.id} value={g.id} className="text-black bg-white">
                  {g.nombre}
                </option>
              ))}
            </select>
          ) : (
            <span className="font-extrabold text-xs sm:text-sm tracking-tight truncate max-w-[110px] sm:max-w-[180px]">
              {grupoActivo?.nombre || "SALA HÍPICA"}
            </span>
          )}

          {/* Switcher de hasta 2 salas activas */}
          <div
            className={`flex rounded-lg p-0.5 ${
              esClaro ? "bg-[#016b58]" : "bg-[#111b21] border border-gray-800"
            }`}
          >
            {salas.slice(0, 2).map((s) => (
              <button
                key={s.id}
                onClick={() => setSalaSeleccionadaId(s.id)}
                className={`px-2 py-0.5 rounded-md text-[11px] font-bold transition ${
                  salaActiva?.id === s.id
                    ? esClaro
                      ? "bg-white text-[#008069] shadow-xs"
                      : "bg-[#00a884] text-black shadow-xs"
                    : "text-white/80 hover:text-white"
                }`}
              >
                {s.nombre_sala}
              </button>
            ))}
          </div>

          {/* Toggle Vista Dual en escritorio si hay 2 salas */}
          {salas.length >= 2 && (
            <button
              onClick={() => setVistaDual(!vistaDual)}
              className={`hidden lg:inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg font-bold transition ${
                esClaro
                  ? "bg-white/15 hover:bg-white/25 text-white border border-white/20"
                  : "bg-[#111b21] hover:bg-gray-800 border border-gray-700 text-gray-200"
              }`}
            >
              <span>{vistaDual ? "🔲 1 Sala" : "👥 2 Salas"}</span>
            </button>
          )}
        </div>

        {/* Lado derecho: Billetera, Recarga, Prejugadas, Configurador de Fuente y Tema */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          {/* Billetera compacta */}
          <div
            className={`flex items-center px-2 py-0.5 rounded-lg text-[11px] font-mono tabular-nums ${
              esClaro
                ? "bg-[#016b58] text-white border border-white/20"
                : "bg-[#111b21] text-emerald-400 border border-gray-700"
            }`}
          >
            <span className="opacity-80 mr-1 hidden md:inline">Disp:</span>
            <span className="font-black">
              {ocultarSaldo ? "•••" : esLibre ? "LIBRE" : formatearMontoRegional(saldoDisp)}
            </span>
            <button
              onClick={() => setOcultarSaldo(!ocultarSaldo)}
              title="Ocultar/Mostrar saldo"
              className="ml-1 opacity-80 hover:opacity-100 text-[10px]"
            >
              {ocultarSaldo ? "🙈" : "👁️"}
            </button>
          </div>

          {/* Botón Recarga Blindada */}
          <button
            onClick={() => setModalRecargaAbierto(true)}
            className={`font-black text-[11px] px-2 py-0.5 rounded-lg transition shadow-xs ${
              esClaro
                ? "bg-[#25d366] hover:bg-[#20bd5a] text-[#111b21]"
                : "bg-[#00a884] hover:bg-emerald-400 text-black"
            }`}
          >
            + Recargar
          </button>

          {/* Botón Prejugadas */}
          <button
            onClick={() => setModalPrejugadasAbierto(true)}
            title="Ver reporte preliminar de jugadas pactadas"
            className={`font-bold text-[11px] px-2 py-0.5 rounded-lg transition ${
              esClaro
                ? "bg-white/15 hover:bg-white/25 text-white border border-white/20"
                : "bg-[#202c33] hover:bg-[#2a3942] border border-amber-500/40 text-amber-300"
            }`}
          >
            📋 <span className="hidden sm:inline">Prejugadas</span>
          </button>

          {/* Selector de Fuente y Tamaño (Aa) + Tema */}
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setMenuFuenteAbierto((v) => !v)}
              title="Configurar fuente, tamaño de letra y tema del chat"
              className={`px-2 py-0.5 rounded-lg text-[11px] font-black transition flex items-center gap-1 ${
                esClaro
                  ? "bg-white/15 hover:bg-white/25 text-white border border-white/25"
                  : "bg-[#111b21] hover:bg-gray-800 text-emerald-400 border border-gray-700"
              }`}
            >
              <span>Aa</span>
              <span className="text-[9px] opacity-80">{tamanoLetra}</span>
            </button>

            {menuFuenteAbierto && (
              <div
                className={`absolute right-0 mt-1.5 w-64 rounded-xl shadow-2xl border p-3 z-50 space-y-2.5 text-xs ${
                  esClaro
                    ? "bg-white border-gray-200 text-[#111b21]"
                    : "bg-[#202c33] border-[#2a3942] text-[#e9edef]"
                }`}
              >
                <div className="flex items-center justify-between border-b pb-1.5 border-current/10">
                  <span className="font-black text-[11px] uppercase tracking-wider text-[#008069]">
                    Apariencia y Tipografía WhatsApp
                  </span>
                  <button
                    type="button"
                    onClick={() => setMenuFuenteAbierto(false)}
                    className="opacity-60 hover:opacity-100 font-bold"
                  >
                    ✕
                  </button>
                </div>

                {/* Tema Claro Hípico vs Oscuro */}
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[11px] font-semibold">Tema visual:</span>
                  <button
                    type="button"
                    onClick={alternarTema}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition ${
                      esClaro
                        ? "bg-[#efeae2] border-[#008069] text-[#008069]"
                        : "bg-[#111b21] border-emerald-500 text-emerald-400"
                    }`}
                  >
                    {esClaro ? "☀️ Claro Hípico (Activo)" : "🌙 Oscuro WhatsApp"}
                  </button>
                </div>

                {/* Tamaño de letra */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold">Tamaño de texto:</span>
                    <span className="font-mono font-bold text-[#008069]">{tamanoLetra}px</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => cambiarTamanoLetra(tamanoLetra - 1)}
                      className="px-2.5 py-1 rounded border border-current/20 font-bold text-xs hover:bg-[#008069]/10"
                    >
                      A-
                    </button>
                    <input
                      type="range"
                      min={12}
                      max={20}
                      value={tamanoLetra}
                      onChange={(e) => cambiarTamanoLetra(Number(e.target.value))}
                      className="flex-1 accent-[#008069]"
                    />
                    <button
                      type="button"
                      onClick={() => cambiarTamanoLetra(tamanoLetra + 1)}
                      className="px-2.5 py-1 rounded border border-current/20 font-bold text-xs hover:bg-[#008069]/10"
                    >
                      A+
                    </button>
                  </div>
                </div>

                {/* Familia de fuente */}
                <div className="space-y-1">
                  <span className="text-[11px] font-semibold block">Fuente del chat:</span>
                  <div className="space-y-1">
                    {(Object.keys(FAMILIAS_FUENTE_SALA) as ClaveFuenteSala[]).map((k) => {
                      const item = FAMILIAS_FUENTE_SALA[k];
                      const activa = fuenteId === k;
                      return (
                        <button
                          key={k}
                          type="button"
                          onClick={() => cambiarFuente(k)}
                          style={{ fontFamily: item.css }}
                          className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between transition ${
                            activa
                              ? "bg-[#d9fdd3] text-[#111b21] font-bold border border-[#008069]/40"
                              : esClaro
                                ? "hover:bg-gray-100 text-gray-800"
                                : "hover:bg-[#111b21] text-gray-200"
                          }`}
                        >
                          <span>{item.nombre}</span>
                          {activa && <span className="text-[#008069] text-xs font-black">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. CONTENIDO PRINCIPAL: 1 SALA O VISTA DUAL (2 SALAS SIMULTÁNEAS) */}
      <div className="flex-1 overflow-hidden">
        {vistaDual && salas.length >= 2 ? (
          <div className="grid grid-cols-2 h-full">
            <ChatSalaPanel
              sala={salas[0]}
              grupoId={grupoActivo?.id}
              grupoNombre={grupoActivo?.nombre || ""}
              identidad={identidad}
              tamanoLetra={tamanoLetra}
              fuenteId={fuenteId}
              tema={tema}
              onActualizarSaldo={refrescarSaldo}
              onSalirPlataforma={salirALaPlataforma}
              onAbrirOperador={() => {
                setSalaSeleccionadaId(salas[0].id);
                setModalOperadorAbierto(true);
              }}
            />
            <ChatSalaPanel
              sala={salas[1]}
              grupoId={grupoActivo?.id}
              grupoNombre={grupoActivo?.nombre || ""}
              identidad={identidad}
              tamanoLetra={tamanoLetra}
              fuenteId={fuenteId}
              tema={tema}
              onActualizarSaldo={refrescarSaldo}
              onSalirPlataforma={salirALaPlataforma}
              onAbrirOperador={() => {
                setSalaSeleccionadaId(salas[1].id);
                setModalOperadorAbierto(true);
              }}
            />
          </div>
        ) : (
          salaActiva && (
            <ChatSalaPanel
              sala={salaActiva}
              grupoId={grupoActivo?.id}
              grupoNombre={grupoActivo?.nombre || ""}
              identidad={identidad}
              tamanoLetra={tamanoLetra}
              fuenteId={fuenteId}
              tema={tema}
              onActualizarSaldo={refrescarSaldo}
              onSalirPlataforma={salirALaPlataforma}
              onAbrirOperador={() => setModalOperadorAbierto(true)}
            />
          )
        )}
      </div>

      {/* 4. MODALES */}
      {modalRecargaAbierto && (
        <ModalRecargaBlindada
          grupoId={grupoActivo?.id}
          clienteId={identidad?.usuarioId}
          onCerrar={() => setModalRecargaAbierto(false)}
          onExito={() => refrescarSaldo()}
        />
      )}

      {modalPrejugadasAbierto && salaActiva && (
        <ModalPrejugadas
          salaId={salaActiva.id}
          grupoNombre={grupoActivo?.nombre || ""}
          onCerrar={() => setModalPrejugadasAbierto(false)}
        />
      )}

      {modalOperadorAbierto && salaActiva && (
        <ModalOperadorSala
          sala={salaActiva}
          grupoId={grupoActivo?.id}
          grupoNombre={grupoActivo?.nombre || ""}
          onCerrar={() => setModalOperadorAbierto(false)}
          onActualizado={() => cargarBootstrap(grupoActivo?.id)}
          onAbrirPrejugadas={() => {
            setModalOperadorAbierto(false);
            setModalPrejugadasAbierto(true);
          }}
        />
      )}
    </div>
  );
}
