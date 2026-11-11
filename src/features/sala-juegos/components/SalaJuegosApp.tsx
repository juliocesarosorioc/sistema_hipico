"use client";

import React, { useState, useEffect, useCallback } from "react";
import { salaApi, configurarCredencialesSala } from "../lib/sala-api";
import { ChatSalaPanel } from "./ChatSalaPanel";
import { ModalOperadorSala } from "./ModalOperadorSala";
import { ModalRecargaBlindada } from "./ModalRecargaBlindada";
import { ModalPrejugadas } from "./ModalPrejugadas";

export interface PropsSalaJuegosApp {
  grupoIdInicial?: string;
  clienteIdInicial?: string;
  portalTokenInicial?: string;
  staffTokenInicial?: string;
  esEmbebido?: boolean;
}

export function SalaJuegosApp({
  grupoIdInicial,
  clienteIdInicial,
  portalTokenInicial,
  staffTokenInicial,
  esEmbebido = false,
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
  const [ocultarSaldo, setOcultarSaldo] = useState<boolean>(false);

  // Modales
  const [modalRecargaAbierto, setModalRecargaAbierto] = useState(false);
  const [modalOperadorAbierto, setModalOperadorAbierto] = useState(false);
  const [modalPrejugadasAbierto, setModalPrejugadasAbierto] = useState(false);

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

  if (cargando) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-[#0b141a] text-white p-6 space-y-3 font-mono">
        <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-bold text-emerald-400">Iniciando Sala de Juegos con Cifrado E2EE...</p>
        <p className="text-xs text-gray-500">Aislamiento de grupo y validación de credenciales</p>
      </div>
    );
  }

  if (errorCarga) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-[#0b141a] text-white p-6 space-y-3 text-center">
        <span className="text-4xl">🔒</span>
        <h2 className="text-base font-bold text-red-400">Acceso no autorizado o grupo no disponible</h2>
        <p className="text-xs text-gray-400 max-w-md">{errorCarga}</p>
        <button
          onClick={() => cargarBootstrap()}
          className="mt-3 bg-emerald-600 hover:bg-emerald-500 text-black font-bold text-xs px-4 py-2 rounded-lg"
        >
          Reintentar Conexión
        </button>
      </div>
    );
  }

  const salaActiva = salas.find((s) => s.id === salaSeleccionadaId) || salas[0];
  const saldoDisp = identidad?.clienteRow?.saldo_disponible ?? 0;
  const saldoAct = identidad?.clienteRow?.saldo_actual ?? 0;
  const saldoRet = identidad?.clienteRow?.saldo_retenido ?? 0;
  const esLibre = Boolean(identidad?.clienteRow?.libre);

  return (
    <div
      className={`flex flex-col bg-[#0b141a] text-[#e9edef] select-none overflow-hidden ${
        esEmbebido ? "h-full w-full" : "h-[100dvh] w-screen"
      }`}
    >
      {/* 1. SECCIÓN DE PUBLICIDAD EN TOPE */}
      {publicidad.length > 0 && (
        <div className="bg-gradient-to-r from-emerald-950 via-[#111b21] to-emerald-950 border-b border-emerald-800/40 px-4 py-1 flex items-center justify-between text-xs">
          <div className="truncate flex items-center gap-2">
            <span className="bg-emerald-500/20 text-emerald-300 font-bold px-1.5 py-0.5 rounded text-[10px]">
              📢 {publicidad[0].titulo}
            </span>
            <span className="text-gray-300 text-[11px] truncate">{publicidad[0].contenido_texto}</span>
            {publicidad[0].enlace_accion && (
              <a
                href={publicidad[0].enlace_accion}
                target="_blank"
                rel="noreferrer"
                className="text-emerald-400 hover:underline text-[11px] font-bold"
              >
                Ver más →
              </a>
            )}
          </div>
          <span className="text-[10px] text-emerald-400 font-mono hidden md:inline ml-2">
            🔒 E2EE SHA-256 Verificado
          </span>
        </div>
      )}

      {/* 2. CABECERA: WALLET + SELECTOR DE SALAS (HASTA 2) + HERRAMIENTAS */}
      <div className="bg-[#202c33] px-3 sm:px-4 py-2 flex flex-wrap items-center justify-between gap-2 border-b border-[#2a3942]">
        {/* Lado izquierdo: Grupo y Selector de salas */}
        <div className="flex items-center gap-2">
          {grupos.length > 1 && identidad?.esAdmin ? (
            <select
              value={grupoActivo?.id}
              onChange={(e) => cargarBootstrap(e.target.value)}
              className="bg-[#111b21] border border-emerald-600/60 text-emerald-400 font-bold text-xs rounded-lg px-2 py-1 outline-none"
            >
              {grupos.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nombre}
                </option>
              ))}
            </select>
          ) : (
            <span className="font-extrabold text-emerald-400 text-xs sm:text-sm tracking-wide">
              {grupoActivo?.nombre || "SALA OFICIAL"}
            </span>
          )}

          {/* Switcher de hasta 2 salas activas */}
          <div className="flex bg-[#111b21] rounded-lg p-0.5 border border-gray-800">
            {salas.slice(0, 2).map((s) => (
              <button
                key={s.id}
                onClick={() => setSalaSeleccionadaId(s.id)}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                  salaActiva?.id === s.id
                    ? "bg-[#00a884] text-black font-bold shadow"
                    : "text-gray-300 hover:text-white"
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
              className="hidden lg:inline-flex items-center gap-1 text-[11px] bg-[#111b21] hover:bg-gray-800 border border-gray-700 px-2.5 py-1 rounded-lg text-gray-200 transition"
            >
              <span>{vistaDual ? "🔲 1 Sala" : "👥 Vista Dual (2 Salas)"}</span>
            </button>
          )}
        </div>

        {/* Lado derecho: Billetera, Recarga, Tamaño Letra y Prejugadas */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Billetera */}
          <div className="flex items-center bg-[#111b21] px-2.5 py-1 rounded-lg border border-gray-700 text-xs font-mono tabular-nums">
            <span className="text-gray-400 mr-1 hidden sm:inline">Disponible:</span>
            <span className="text-emerald-400 font-black">
              {ocultarSaldo ? "$ ••••" : esLibre ? "ILIMITADO" : `$${saldoDisp.toFixed(2)}`}
            </span>
            <button
              onClick={() => setOcultarSaldo(!ocultarSaldo)}
              title="Ocultar/Mostrar saldo"
              className="ml-1.5 text-gray-400 hover:text-white text-[11px]"
            >
              {ocultarSaldo ? "👁️‍🗨️" : "👁️"}
            </button>
          </div>

          {/* Botón Recarga Blindada */}
          <button
            onClick={() => setModalRecargaAbierto(true)}
            className="bg-[#00a884] hover:bg-emerald-400 text-black font-black text-xs px-2.5 py-1 rounded-lg transition shadow"
          >
            + Recargar
          </button>

          {/* Botón Prejugadas */}
          <button
            onClick={() => setModalPrejugadasAbierto(true)}
            title="Ver reporte preliminar de jugadas pactadas"
            className="bg-[#202c33] hover:bg-[#2a3942] border border-amber-500/40 text-amber-300 font-bold text-xs px-2.5 py-1 rounded-lg transition"
          >
            📋 Prejugadas
          </button>

          {/* Zoom tamaño de letra */}
          <div className="hidden sm:flex items-center gap-0.5 bg-[#111b21] px-1.5 py-0.5 rounded border border-gray-800 text-[11px]">
            <button
              onClick={() => setTamanoLetra(Math.max(12, tamanoLetra - 1))}
              className="px-1 text-gray-400 hover:text-emerald-400"
            >
              A-
            </button>
            <button
              onClick={() => setTamanoLetra(Math.min(20, tamanoLetra + 1))}
              className="px-1 text-gray-400 hover:text-emerald-400"
            >
              A+
            </button>
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
              onActualizarSaldo={refrescarSaldo}
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
              onActualizarSaldo={refrescarSaldo}
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
              onActualizarSaldo={refrescarSaldo}
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
