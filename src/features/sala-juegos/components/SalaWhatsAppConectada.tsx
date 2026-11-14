"use client";

import React, { useEffect, useState } from "react";
import SalaJuegosWhatsApp, { type SalaActivaInfo } from "./SalaJuegosWhatsApp";
import { configurarCredencialesSala, obtenerCredencialesGuardadas, salaApi } from "../lib/sala-api";

interface Props {
  grupoIdInicial?: string;
  clienteIdInicial?: string;
  portalTokenInicial?: string;
  staffTokenInicial?: string;
}

interface IdentidadSalaUI {
  id: string;
  nombre: string;
  esOperador: boolean;
  saldoDisponible: number;
  saldoRetenido: number;
}

function mapearSalas(salas: any[]): SalaActivaInfo[] {
  return (salas || []).slice(0, 2).map((s: any) => ({
    id: String(s.id),
    nombreSala: String(s.nombre_sala || "Sala"),
    hipodromoActivo: String(s.hipodromo_activo || "LA RINCONADA"),
    numeroCarreraActiva: Number(s.numero_carrera_activa || 1),
    distanciaActiva: Number(s.distancia_activa || 1200),
    estadoCarrera:
      s.estado_carrera === "abierta" || s.estado_carrera === "liquidada"
        ? s.estado_carrera
        : "cerrada",
    retirados: Array.isArray(s.retirados) ? s.retirados.map(String) : [],
    carreraActivaId: s.carrera_activa_id || undefined,
    whatsappGroupJid: s.whatsapp_group_jid || undefined,
  }));
}

/**
 * Envoltorio conectado del tablero WhatsApp.
 *
 * Carga la identidad real (cliente con token de portal o staff con JWT/HMAC),
 * el perfil desde `clientes` vía bootstrap server-side y las 2 salas activas de
 * `salas_juego` filtradas por el grupo autorizado. La UI no inventa `esOperador`:
 * lo resuelve el servidor con `puedeOperarSala`.
 */
export function SalaWhatsAppConectada({
  grupoIdInicial,
  clienteIdInicial,
  portalTokenInicial,
  staffTokenInicial,
}: Props) {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [grupoActivo, setGrupoActivo] = useState<any>(null);
  const [usuarioActual, setUsuarioActual] = useState<IdentidadSalaUI | null>(null);
  const [salas, setSalas] = useState<SalaActivaInfo[]>([]);

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
    const creds = obtenerCredencialesGuardadas();
    const esPortal = Boolean(
      (portalTokenInicial && clienteIdInicial) ||
        (creds.portalToken && creds.clienteId && !creds.staffToken)
    );

    let cancelado = false;
    const cargar = async () => {
      setCargando(true);
      setError(null);
      const res = await salaApi.bootstrap(grupoIdInicial);
      if (cancelado) return;
      if (!res.ok || !res.data?.identidad) {
        setError(res.error || "No se pudo cargar la sesión de la Sala.");
        setCargando(false);
        return;
      }

      const d = res.data;
      const id = d.identidad;
      const clienteRow = id.clienteRow || {};
      setGrupoActivo(d.grupoActivo || null);
      setUsuarioActual({
        // Para un jugador el id del cliente es el que autoriza la recarga;
        // para staff se conserva el id de la sesión.
        id: String(clienteRow?.id || id.usuarioId || ""),
        nombre: String(id.nombre || clienteRow.nombre || "Jugador"),
        esOperador: Boolean(id.esOperador),
        saldoDisponible: Number(clienteRow.saldo_disponible ?? 0),
        saldoRetenido: Number(clienteRow.saldo_retenido ?? 0),
      });
      setSalas(mapearSalas(d.salas || []));
      setCargando(false);
    };
    void cargar();

    // Refresco periódico del saldo/perfil: el resto del estado lo mantiene Realtime.
    // Solo aplica a jugadores con portal: `getCliente()` resuelve por identidad.
    const intervalo = !esPortal ? null : setInterval(async () => {
      const res = await salaApi.getCliente();
      if (!cancelado && res.ok && res.data?.cliente) {
        const cl = res.data.cliente;
        setUsuarioActual((prev) =>
          prev
            ? {
                ...prev,
                saldoDisponible: Number(cl.saldo_disponible ?? cl.saldo_actual ?? prev.saldoDisponible),
                saldoRetenido: Number(cl.saldo_retenido ?? prev.saldoRetenido),
              }
            : prev
        );
      }
    }, 8000);

    return () => {
      cancelado = true;
      if (intervalo) clearInterval(intervalo);
    };
  }, [grupoIdInicial, clienteIdInicial, portalTokenInicial, staffTokenInicial]);

  if (cargando) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-[#0b141a] text-emerald-400 gap-3 select-none">
        <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm font-bold">Cargando sesión real de la Sala...</span>
      </div>
    );
  }

  if (error || !usuarioActual) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-[#0b141a] text-gray-200 p-6 text-center gap-3">
        <span className="text-4xl">🔒</span>
        <h2 className="text-base font-bold text-red-400">Acceso no autorizado</h2>
        <p className="text-xs opacity-80 max-w-md">{error || "No hay una sesión válida para la Sala."}</p>
        <a href="/login" className="bg-[#00a884] text-black font-bold text-xs px-4 py-2 rounded-lg">
          Iniciar sesión
        </a>
      </div>
    );
  }

  return (
    <SalaJuegosWhatsApp
      key={`${usuarioActual.id}-${grupoActivo?.id || ""}`}
      grupoId={String(grupoActivo?.id || "")}
      grupoNombre={String(grupoActivo?.nombre || "Sala Hípica")}
      moneda={grupoActivo?.moneda}
      permitirCrucesNetting={Boolean(grupoActivo?.permite_cruces)}
      usuarioActual={usuarioActual}
      salasActivasIniciales={salas}
    />
  );
}
