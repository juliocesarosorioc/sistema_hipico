"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { salaApi, configurarCredencialesSala } from "../lib/sala-api";
import { ChatSalaPanel, FAMILIAS_FUENTE_SALA, type ClaveFuenteSala, type TemaSala } from "./ChatSalaPanel";
import { ModalOperadorSala } from "./ModalOperadorSala";
import { ModalRecargaBlindada } from "./ModalRecargaBlindada";
import { ModalPrejugadas } from "./ModalPrejugadas";
import {
  formatearMontoRegional,
  esGrupoBolivares,
  prefijoMonedaGrupo,
} from "@/shared/lib/dinero";

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
  const [bannerDescartadoId, setBannerDescartadoId] = useState<string | null>(null);

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
  const [tabOperadorInicial, setTabOperadorInicial] = useState<"carrera" | "retirados" | "liquidacion" | "publicidad">("carrera");
  const [modalPrejugadasAbierto, setModalPrejugadasAbierto] = useState(false);
  const [menuMovilAbierto, setMenuMovilAbierto] = useState(false);
  const [modalLoginEspectadorAbierto, setModalLoginEspectadorAbierto] = useState(false);

  const abrirOperadorConTab = useCallback((tab: "carrera" | "retirados" | "liquidacion" | "publicidad" = "carrera") => {
    setTabOperadorInicial(tab);
    setModalOperadorAbierto(true);
  }, []);

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

  // Inicializar credenciales solo cuando vengan explícitamente por props/URL,
  // evitando borrar una sesión válida guardada en storage al abrir /sala.
  useEffect(() => {
    if (portalTokenInicial && clienteIdInicial) {
      configurarCredencialesSala({
        portalToken: portalTokenInicial,
        clienteId: clienteIdInicial,
        staffToken: null,
      });
    } else if (staffTokenInicial) {
      configurarCredencialesSala({
        portalToken: null,
        clienteId: null,
        staffToken: staffTokenInicial,
      });
    }
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

  const salaActiva = salas.find((s) => s.id === salaSeleccionadaId) || salas[0];
  const saldoDisp = identidad?.clienteRow?.saldo_disponible ?? 0;
  const esLibre = Boolean(identidad?.clienteRow?.libre);
  const esEspectador = identidad?.usuarioId === "espectador" || identidad?.tipo === "INVITADO";

  // Resolver publicidad activa y destino para clics hacia Tablas Fijas, Remates, Marcas, etc.
  // Todos los hooks deben ejecutarse incondicionalmente antes de cualquier return temprano.
  const pubActiva = publicidad.find((p) => String(p.id) !== bannerDescartadoId) || null;

  const destinoPublicidad = useMemo(() => {
    if (!pubActiva) return null;
    const enlace = String(pubActiva.enlace_accion || "").trim();
    const titulo = String(pubActiva.titulo || "").toLowerCase();
    const texto = String(pubActiva.contenido_texto || "").toLowerCase();
    const todo = `${titulo} ${texto} ${enlace.toLowerCase()}`;

    if (todo.includes("tabla")) {
      return { url: enlace || "/tablas-fijas", label: "Ir a Tablas Fijas", icono: "📊" };
    }
    if (todo.includes("remate")) {
      return { url: enlace || "/remates", label: "Ir a Remates", icono: "🔨" };
    }
    if (todo.includes("marca")) {
      return { url: enlace || "/marcas", label: "Ir a Marcas", icono: "⭐" };
    }
    if (todo.includes("polla")) {
      return { url: enlace || "/pollas", label: "Ir a Polla", icono: "🎟️" };
    }
    if (todo.includes("taquilla") || todo.includes("jugada")) {
      return { url: enlace || "/taquilla", label: "Ir a Taquilla", icono: "🏇" };
    }
    if (enlace) {
      return { url: enlace, label: "Ver Promoción", icono: "🚀" };
    }
    return null;
  }, [pubActiva]);

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

  const navegarPublicidad = (url: string) => {
    if (!url) return;
    window.open(url, "_blank");
  };

  return (
    <div
      style={{ fontFamily: fontFamilyCss }}
      onClick={() => setMenuFuenteAbierto(false)}
      className={`flex flex-col select-none overflow-hidden ${
        esClaro ? "bg-[#efeae2] text-[#111b21]" : "bg-[#0b141a] text-[#e9edef]"
      } ${esEmbebido ? "h-full w-full" : "min-h-[100dvh] h-[100dvh] w-full max-w-full"}`}
    >
      {/* 1. SECCIÓN DE PUBLICIDAD DESTACADA Y CLICKEABLE HACIA MODALIDADES (ALTA UX/UI) */}
      {pubActiva && (
        <div
          onClick={() => {
            if (destinoPublicidad) {
              navegarPublicidad(destinoPublicidad.url);
            }
          }}
          className={`px-3 py-1.5 flex items-center justify-between gap-2 text-xs border-b transition-all duration-200 select-none ${
            destinoPublicidad ? "cursor-pointer hover:brightness-110 active:scale-[0.995]" : ""
          } ${
            esClaro
              ? "bg-gradient-to-r from-emerald-100 via-amber-50 to-emerald-100 border-emerald-300 text-slate-900 shadow-xs"
              : "bg-gradient-to-r from-emerald-950 via-[#111b21] to-amber-950/70 border-emerald-600/40 text-white shadow-sm"
          }`}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>

            <span className="shrink-0 bg-emerald-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded uppercase tracking-wide flex items-center gap-1 shadow-xs">
              <span>{destinoPublicidad?.icono || "📢"}</span>
              <span className="truncate max-w-[120px] sm:max-w-none">{pubActiva.titulo}</span>
            </span>

            <span className="truncate text-[11px] font-medium opacity-90">
              {pubActiva.contenido_texto}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {destinoPublicidad && (
              <span className="bg-amber-400 hover:bg-amber-300 text-slate-950 text-[10px] font-black px-2 py-0.5 rounded-full shadow-xs transition flex items-center gap-1">
                <span>{destinoPublicidad.label}</span>
                <span className="text-xs">➔</span>
              </span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setBannerDescartadoId(String(pubActiva.id));
              }}
              title="Ocultar anuncio"
              className="text-gray-400 hover:text-white text-xs px-1 hover:bg-white/10 rounded transition"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* 2.A: CABECERA NATIVA MÓVIL ESTILO WHATSAPP (Pantallas < sm) */}
      <div
        className={`flex sm:hidden px-2 py-1.5 items-center justify-between gap-1.5 border-b shadow-xs relative z-30 select-none ${
          esClaro
            ? "bg-[#008069] text-white border-[#016b58]"
            : "bg-[#202c33] text-[#e9edef] border-[#2a3942]"
        }`}
      >
        {/* Lado izquierdo: Botón Volver + Avatar 🏇 + Título Sala */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <button
            type="button"
            onClick={salirALaPlataforma}
            className="w-8 h-8 rounded-full flex items-center justify-center bg-white/15 active:bg-white/30 text-white text-sm font-black transition shrink-0"
            title="Salir a la Plataforma"
          >
            ←
          </button>

          <div className="w-8 h-8 rounded-full bg-white/20 text-white flex items-center justify-center text-sm font-bold shrink-0 shadow-xs">
            🏇
          </div>

          <div className="min-w-0 flex-1 leading-tight">
            <h3 className="font-black text-xs text-white truncate">
              {grupoActivo?.nombre || "SALA OFICIAL"}
            </h3>
            <button
              type="button"
              onClick={() => {
                if (salas.length >= 2) {
                  const proxima = salas.find((s) => s.id !== salaActiva?.id) || salas[0];
                  setSalaSeleccionadaId(proxima.id);
                } else {
                  setMenuMovilAbierto(true);
                }
              }}
              className="text-[10px] text-emerald-100/90 truncate flex items-center gap-1 hover:underline"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 inline-block"></span>
              <span className="truncate">{salaActiva?.nombre_sala || "Sala Principal"}</span>
              {salas.length >= 2 && <span className="opacity-75 text-[9px]">⇄</span>}
            </button>
          </div>
        </div>

        {/* Lado derecho Móvil: Saldo / Rol Operador + Botón Acción + Menú Tres Puntos ⋮ */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Badge Saldo o Rol */}
          <div
            onClick={() => {
              if (identidad?.esOperador) {
                abrirOperadorConTab("carrera");
              } else {
                setOcultarSaldo(!ocultarSaldo);
              }
            }}
            className={`px-2 py-1 rounded-lg text-[11px] font-mono tabular-nums font-black cursor-pointer transition ${
              identidad?.esOperador
                ? "bg-amber-400 text-slate-950 border border-amber-300 shadow-2xs font-sans"
                : esClaro
                  ? "bg-[#016b58] text-white border border-white/20"
                  : "bg-[#111b21] text-emerald-400 border border-gray-700"
            }`}
          >
            {identidad?.esOperador
              ? "🛠️ OPERADOR"
              : ocultarSaldo
              ? "•••"
              : esEspectador
              ? "ESPECTADOR"
              : esLibre
              ? "LIBRE"
              : `${prefijoMonedaGrupo(grupoActivo?.moneda)}${formatearMontoRegional(saldoDisp)}`}
          </div>

          {/* Botón Acción Rápida (Operador: Gestionar / Jugador: Recargar / Espectador: Entrar) */}
          {identidad?.esOperador ? (
            <button
              type="button"
              onClick={() => abrirOperadorConTab("carrera")}
              className="bg-emerald-500 hover:bg-emerald-400 text-black font-black text-[11px] px-2 py-1 rounded-lg shadow-xs transition active:scale-95 flex items-center gap-0.5"
              title="Panel de Control de Operador"
            >
              <span>⚙️</span>
            </button>
          ) : esEspectador ? (
            <button
              type="button"
              onClick={() => setModalLoginEspectadorAbierto(true)}
              className="bg-[#25d366] active:bg-[#20bd5a] text-[#111b21] font-black text-[11px] px-2 py-1 rounded-lg shadow-xs transition"
            >
              Entrar
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setModalRecargaAbierto(true)}
              className="bg-[#25d366] active:bg-[#20bd5a] text-[#111b21] font-black text-[11px] px-2 py-1 rounded-lg shadow-xs transition"
            >
              +
            </button>
          )}

          {/* Menú Tres Puntos Móvil ⋮ */}
          <button
            type="button"
            onClick={() => setMenuMovilAbierto(true)}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-base font-black hover:bg-white/15 active:bg-white/25 transition"
            title="Opciones de la sala"
          >
            ⋮
          </button>
        </div>
      </div>

      {/* 2.B: CABECERA ESCRITORIO (Pantallas >= sm) */}
      <div
        className={`hidden sm:flex px-2.5 py-1 items-center justify-between gap-1 border-b shadow-xs relative z-30 ${
          esClaro
            ? "bg-[#008069] text-white border-[#016b58]"
            : "bg-[#202c33] text-[#e9edef] border-[#2a3942]"
        }`}
      >
        {/* Lado izquierdo: Botón Salir a la Plataforma + Grupo + Selector de salas */}
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={salirALaPlataforma}
            title="Salir de la Sala y volver a la Plataforma"
            className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-extrabold transition shadow-xs ${
              esClaro
                ? "bg-white/15 hover:bg-white/25 text-white border border-white/25"
                : "bg-[#111b21] hover:bg-gray-800 text-emerald-400 border border-emerald-600/40"
            }`}
          >
            <span>←</span>
            <span>Salir a Plataforma</span>
          </button>

          {grupos.length > 1 && identidad?.esAdmin ? (
            <select
              value={grupoActivo?.id}
              onChange={(e) => cargarBootstrap(e.target.value)}
              className={`font-bold text-xs rounded-lg px-2 py-1 outline-none max-w-[180px] truncate ${
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
            <span className="font-extrabold text-sm tracking-tight truncate max-w-[180px]">
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
                className={`px-2.5 py-0.5 rounded-md text-xs font-bold transition ${
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
              className={`hidden lg:inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-lg font-bold transition ${
                esClaro
                  ? "bg-white/15 hover:bg-white/25 text-white border border-white/20"
                  : "bg-[#111b21] hover:bg-gray-800 border border-gray-700 text-gray-200"
              }`}
            >
              <span>{vistaDual ? "🔲 1 Sala" : "👥 2 Salas"}</span>
            </button>
          )}
        </div>

        {/* Lado derecho: Billetera/Operador, Acción rápida, Prejugadas, Aa y Tema */}
        <div className="flex items-center gap-1.5">
          {/* Billetera compacta / Identificación Operador */}
          <div
            className={`flex items-center px-2.5 py-1 rounded-lg text-xs font-mono tabular-nums ${
              identidad?.esOperador
                ? "bg-amber-400 text-slate-950 border border-amber-300 font-sans shadow-2xs"
                : esClaro
                  ? "bg-[#016b58] text-white border border-white/20"
                  : "bg-[#111b21] text-emerald-400 border border-gray-700"
            }`}
          >
            {identidad?.esOperador ? (
              <span className="font-black flex items-center gap-1">
                <span>🛠️</span>
                <span>OPERADOR</span>
              </span>
            ) : (
              <>
                <span className="opacity-80 mr-1">Disp:</span>
                <span className="font-black">
                  {ocultarSaldo
                    ? "•••"
                    : esEspectador
                    ? "ESPECTADOR"
                    : esLibre
                    ? "LIBRE"
                    : `${prefijoMonedaGrupo(grupoActivo?.moneda)}${formatearMontoRegional(saldoDisp)}`}
                </span>
                <button
                  onClick={() => setOcultarSaldo(!ocultarSaldo)}
                  title="Ocultar/Mostrar saldo"
                  className="ml-1 opacity-80 hover:opacity-100 text-[11px]"
                >
                  {ocultarSaldo ? "🙈" : "👁️"}
                </button>
              </>
            )}
          </div>

          {/* Botones de Acción: Operador -> Control Operador; Jugador -> Recargar; Espectador -> Iniciar Sesión */}
          {identidad?.esOperador ? (
            <button
              onClick={() => abrirOperadorConTab("carrera")}
              className="bg-emerald-500 hover:bg-emerald-400 text-black font-black text-xs px-3 py-1 rounded-lg transition shadow-xs flex items-center gap-1 active:scale-95"
              title="Panel de Control de Operador"
            >
              <span>⚙️</span>
              <span>Control Operador</span>
            </button>
          ) : esEspectador ? (
            <button
              onClick={() => setModalLoginEspectadorAbierto(true)}
              className="bg-[#25d366] hover:bg-[#20bd5a] text-[#111b21] font-black text-xs px-3 py-1 rounded-lg transition shadow-xs"
            >
              🔑 Iniciar Sesión
            </button>
          ) : (
            <button
              onClick={() => setModalRecargaAbierto(true)}
              className={`font-black text-xs px-2.5 py-1 rounded-lg transition shadow-xs ${
                esClaro
                  ? "bg-[#25d366] hover:bg-[#20bd5a] text-[#111b21]"
                  : "bg-[#00a884] hover:bg-emerald-400 text-black"
              }`}
            >
              + Recargar
            </button>
          )}

          {/* Botón Prejugadas */}
          <button
            onClick={() => setModalPrejugadasAbierto(true)}
            title="Ver reporte preliminar de jugadas pactadas"
            className={`font-bold text-xs px-2.5 py-1 rounded-lg transition ${
              esClaro
                ? "bg-white/15 hover:bg-white/25 text-white border border-white/20"
                : "bg-[#202c33] hover:bg-[#2a3942] border border-amber-500/40 text-amber-300"
            }`}
          >
            📋 Prejugadas
          </button>

          {/* Selector de Fuente y Tamaño (Aa) + Tema */}
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setMenuFuenteAbierto((v) => !v)}
              title="Configurar fuente, tamaño de letra y tema del chat"
              className={`px-2 py-1 rounded-lg text-xs font-black transition flex items-center gap-1 ${
                esClaro
                  ? "bg-white/15 hover:bg-white/25 text-white border border-white/25"
                  : "bg-[#111b21] hover:bg-gray-800 text-emerald-400 border border-gray-700"
              }`}
            >
              <span>Aa</span>
              <span className="text-[10px] opacity-80">{tamanoLetra}</span>
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
      <div className="flex-1 overflow-hidden relative">
        {vistaDual && salas.length >= 2 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 h-full min-h-0 overflow-hidden">
            <ChatSalaPanel
              sala={salas[0]}
              grupoId={grupoActivo?.id}
              grupoNombre={grupoActivo?.nombre || ""}
              identidad={identidad}
              tamanoLetra={tamanoLetra}
              fuenteId={fuenteId}
              tema={tema}
              moneda={grupoActivo?.moneda || "USD"}
              onActualizarSaldo={refrescarSaldo}
              onSalirPlataforma={salirALaPlataforma}
              onAbrirOperador={(tab = "carrera") => {
                setSalaSeleccionadaId(salas[0].id);
                abrirOperadorConTab(tab);
              }}
              onAbrirPrejugadas={() => {
                setSalaSeleccionadaId(salas[0].id);
                setModalPrejugadasAbierto(true);
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
              moneda={grupoActivo?.moneda || "USD"}
              onActualizarSaldo={refrescarSaldo}
              onSalirPlataforma={salirALaPlataforma}
              onAbrirOperador={(tab = "carrera") => {
                setSalaSeleccionadaId(salas[1].id);
                abrirOperadorConTab(tab);
              }}
              onAbrirPrejugadas={() => {
                setSalaSeleccionadaId(salas[1].id);
                setModalPrejugadasAbierto(true);
              }}
            />
          </div>
        ) : salaActiva ? (
          <ChatSalaPanel
            sala={salaActiva}
            grupoId={grupoActivo?.id}
            grupoNombre={grupoActivo?.nombre || ""}
            identidad={identidad}
            tamanoLetra={tamanoLetra}
            fuenteId={fuenteId}
            tema={tema}
            moneda={grupoActivo?.moneda || "USD"}
            onActualizarSaldo={refrescarSaldo}
            onSalirPlataforma={salirALaPlataforma}
            onAbrirOperador={abrirOperadorConTab}
            onAbrirPrejugadas={() => setModalPrejugadasAbierto(true)}
          />
        ) : (
          <div className="flex-1 h-full flex flex-col items-center justify-center p-6 text-center space-y-3">
            <span className="text-4xl animate-bounce">🏇</span>
            <h3 className="text-sm font-extrabold text-[#008069]">Conectando a la Sala de Juegos...</h3>
            <p className="text-xs text-gray-500 max-w-xs">
              Sincronizando información de carreras y tablero en vivo.
            </p>
            <button
              onClick={() => cargarBootstrap(grupoActivo?.id)}
              className="px-4 py-2 bg-[#008069] text-white rounded-lg text-xs font-bold shadow hover:bg-[#017561] active:scale-95 transition"
            >
              Reintentar Conexión
            </button>
          </div>
        )}
      </div>

      {/* 4. MODALES */}
      {modalRecargaAbierto && (
        <ModalRecargaBlindada
          grupoId={grupoActivo?.id}
          clienteId={identidad?.usuarioId}
          moneda={grupoActivo?.moneda}
          onCerrar={() => setModalRecargaAbierto(false)}
          onExito={() => refrescarSaldo()}
        />
      )}

      {modalPrejugadasAbierto && salaActiva && (
        <ModalPrejugadas
          salaId={salaActiva.id}
          grupoNombre={grupoActivo?.nombre || ""}
          moneda={grupoActivo?.moneda}
          onCerrar={() => setModalPrejugadasAbierto(false)}
        />
      )}

      {modalOperadorAbierto && salaActiva && (
        <ModalOperadorSala
          sala={salaActiva}
          grupoId={grupoActivo?.id}
          grupoNombre={grupoActivo?.nombre || ""}
          tabInicial={tabOperadorInicial}
          onCerrar={() => setModalOperadorAbierto(false)}
          onActualizado={() => cargarBootstrap(grupoActivo?.id)}
          onAbrirPrejugadas={() => {
            setModalOperadorAbierto(false);
            setModalPrejugadasAbierto(true);
          }}
        />
      )}

      {/* Menú Desplegable Móvil WhatsApp */}
      {menuMovilAbierto && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-xs animate-in fade-in"
          onClick={() => setMenuMovilAbierto(false)}
        >
          <div
            className={`w-full max-h-[85vh] overflow-y-auto rounded-t-3xl p-4 shadow-2xl space-y-3.5 ${
              esClaro ? "bg-white text-[#111b21]" : "bg-[#111b21] text-[#e9edef] border-t border-gray-800"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header del menú */}
            <div className="flex items-center justify-between border-b pb-2.5 border-current/10">
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 rounded-full bg-[#008069] text-white flex items-center justify-center text-sm font-bold shadow-xs">
                  🏇
                </span>
                <div>
                  <h4 className="font-black text-xs text-[#008069]">{grupoActivo?.nombre || "SALA HÍPICA"}</h4>
                  <p className="text-[10px] opacity-70">Opciones y configuración rápida</p>
                </div>
              </div>
              <button
                onClick={() => setMenuMovilAbierto(false)}
                className="w-7 h-7 rounded-full bg-current/10 flex items-center justify-center font-bold text-xs"
              >
                ✕
              </button>
            </div>

            {/* Selector de Salas */}
            <div className="space-y-1">
              <span className="text-[10px] font-black uppercase text-gray-500 tracking-wider">Salas Disponibles</span>
              <div className="grid grid-cols-2 gap-2">
                {salas.slice(0, 2).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setSalaSeleccionadaId(s.id);
                      setMenuMovilAbierto(false);
                    }}
                    className={`py-2 px-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 border transition ${
                      salaActiva?.id === s.id
                        ? "bg-[#008069] text-white border-[#008069] shadow-sm"
                        : esClaro
                          ? "bg-gray-100 text-gray-800 border-gray-200"
                          : "bg-[#202c33] text-gray-200 border-gray-700"
                    }`}
                  >
                    <span>●</span>
                    <span className="truncate">{s.nombre_sala}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Selector de Grupo si es Admin */}
            {grupos.length > 1 && identidad?.esAdmin && (
              <div className="space-y-1">
                <span className="text-[10px] font-black uppercase text-gray-500 tracking-wider">Grupo Activo</span>
                <select
                  value={grupoActivo?.id}
                  onChange={(e) => {
                    cargarBootstrap(e.target.value);
                    setMenuMovilAbierto(false);
                  }}
                  className={`w-full font-bold text-xs rounded-xl p-2.5 border outline-none ${
                    esClaro ? "bg-gray-50 border-gray-300 text-black" : "bg-[#202c33] border-gray-700 text-white"
                  }`}
                >
                  {grupos.map((g) => (
                    <option key={g.id} value={g.id} className="text-black bg-white">
                      {g.nombre}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Accesos Rápidos: Operador dinámico vs Jugador */}
            {identidad?.esOperador ? (
              <div className="space-y-1.5 border-t pt-2 border-current/10">
                <span className="text-[10px] font-black uppercase text-emerald-600 dark:text-emerald-400 tracking-wider flex items-center gap-1">
                  <span>🛠️</span> Opciones Rápidas de Operador
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuMovilAbierto(false);
                      abrirOperadorConTab("carrera");
                    }}
                    className="py-2.5 px-3 rounded-xl font-black text-xs bg-amber-500 hover:bg-amber-400 text-slate-950 flex items-center justify-center gap-1.5 shadow-sm transition active:scale-95"
                  >
                    <span>🏁</span>
                    <span>Carrera (Abrir/Cerrar)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuMovilAbierto(false);
                      abrirOperadorConTab("retirados");
                    }}
                    className="py-2.5 px-3 rounded-xl font-black text-xs bg-red-600 hover:bg-red-500 text-white flex items-center justify-center gap-1.5 shadow-sm transition active:scale-95"
                  >
                    <span>🚫</span>
                    <span>Retirar Ejemplar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuMovilAbierto(false);
                      abrirOperadorConTab("liquidacion");
                    }}
                    className="py-2.5 px-3 rounded-xl font-black text-xs bg-[#008069] hover:bg-[#017561] text-white flex items-center justify-center gap-1.5 shadow-sm transition active:scale-95"
                  >
                    <span>🏆</span>
                    <span>Liquidar Pizarra</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuMovilAbierto(false);
                      setModalPrejugadasAbierto(true);
                    }}
                    className="py-2.5 px-3 rounded-xl font-black text-xs bg-amber-100 hover:bg-amber-200 text-amber-950 border border-amber-300 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-600/40 flex items-center justify-center gap-1.5 shadow-sm transition active:scale-95"
                  >
                    <span>📋</span>
                    <span>Ver Prejugadas</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuMovilAbierto(false);
                      abrirOperadorConTab("publicidad");
                    }}
                    className="col-span-2 py-2 px-3 rounded-xl font-bold text-xs bg-slate-800 text-white flex items-center justify-center gap-1.5 shadow-xs transition active:scale-95"
                  >
                    <span>📢</span>
                    <span>Publicar / Fijar Aviso en la Sala</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setMenuMovilAbierto(false);
                    setModalPrejugadasAbierto(true);
                  }}
                  className={`py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 border shadow-xs transition active:scale-95 ${
                    esClaro
                      ? "bg-amber-50 text-amber-900 border-amber-300"
                      : "bg-amber-950/60 text-amber-300 border-amber-600/40"
                  }`}
                >
                  <span>📋</span>
                  <span>Prejugadas</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuMovilAbierto(false);
                    setModalRecargaAbierto(true);
                  }}
                  className="py-2 px-3 rounded-xl font-black text-xs bg-[#25d366] text-[#111b21] flex items-center justify-center gap-2 shadow-sm transition active:scale-95"
                >
                  <span>💳</span>
                  <span>Recargar Saldo</span>
                </button>
              </div>
            )}

            {/* Ajustes de Tema y Fuente */}
            <div className="space-y-2 border-t pt-2.5 border-current/10">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">Tema visual:</span>
                <button
                  type="button"
                  onClick={alternarTema}
                  className={`px-3 py-1 rounded-xl text-xs font-bold border transition ${
                    esClaro ? "bg-gray-100 border-gray-300 text-gray-800" : "bg-[#202c33] border-gray-700 text-white"
                  }`}
                >
                  {esClaro ? "☀️ Modo Claro" : "🌙 Modo Oscuro"}
                </button>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">Tamaño de letra:</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => cambiarTamanoLetra(tamanoLetra - 1)}
                    className="w-7 h-7 rounded-lg border flex items-center justify-center font-bold active:scale-95"
                  >
                    -
                  </button>
                  <span className="font-mono font-bold text-[#008069] text-xs">{tamanoLetra}px</span>
                  <button
                    onClick={() => cambiarTamanoLetra(tamanoLetra + 1)}
                    className="w-7 h-7 rounded-lg border flex items-center justify-center font-bold active:scale-95"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* Si es Espectador, botón para identificarse */}
            {esEspectador && (
              <button
                type="button"
                onClick={() => {
                  setMenuMovilAbierto(false);
                  setModalLoginEspectadorAbierto(true);
                }}
                className="w-full bg-[#008069] text-white py-2 rounded-xl text-xs font-black flex items-center justify-center gap-2 shadow-sm active:scale-95"
              >
                <span>🔑</span>
                <span>Identificarse / Iniciar Sesión</span>
              </button>
            )}

            {/* Botón Salir */}
            <button
              type="button"
              onClick={salirALaPlataforma}
              className={`w-full py-2.5 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 border transition ${
                esClaro ? "bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300" : "bg-[#202c33] text-gray-200 border-gray-700"
              }`}
            >
              <span>←</span>
              <span>Salir a la Plataforma</span>
            </button>
          </div>
        </div>
      )}

      {/* Modal Identificación para Espectadores */}
      {modalLoginEspectadorAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in">
          <div className={`w-full max-w-sm rounded-2xl p-5 shadow-2xl border ${
            esClaro ? "bg-white border-gray-200 text-[#111b21]" : "bg-[#111b21] border-gray-800 text-white"
          }`}>
            <div className="flex items-center justify-between pb-3 border-b border-current/10">
              <div className="flex items-center gap-2">
                <span className="text-xl">🏇</span>
                <h3 className="font-black text-sm text-[#008069]">Identificarse en la Sala</h3>
              </div>
              <button
                onClick={() => setModalLoginEspectadorAbierto(false)}
                className="opacity-70 hover:opacity-100 font-bold text-sm px-1.5"
              >
                ✕
              </button>
            </div>

            <div className="py-4 space-y-3 text-xs">
              <p className="opacity-80 leading-relaxed">
                Para apostar en vivo y enviar mensajes debes identificarte con tu cuenta de taquilla o staff.
              </p>

              <button
                type="button"
                onClick={() => {
                  window.location.href = "/portal";
                }}
                className="w-full bg-[#008069] hover:bg-[#017561] text-white font-extrabold py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 shadow-sm transition active:scale-95"
              >
                <span>📱</span>
                <span>Ingresar a mi Taquilla / Portal</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  window.location.href = "/login";
                }}
                className={`w-full py-2.5 px-3 rounded-xl font-bold flex items-center justify-center gap-2 border transition active:scale-95 ${
                  esClaro
                    ? "bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300"
                    : "bg-[#202c33] hover:bg-gray-800 text-emerald-400 border-gray-700"
                }`}
              >
                <span>⚙️</span>
                <span>Acceso Operador / Administrador</span>
              </button>
            </div>

            <button
              onClick={() => setModalLoginEspectadorAbierto(false)}
              className="w-full text-center text-xs opacity-70 hover:opacity-100 py-1"
            >
              Continuar como Espectador
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
