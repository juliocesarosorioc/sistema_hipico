"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { esRolOperadorExclusivo } from "@/features/seguridad/lib/capacidades";
import WhatsAppOperatorPanel from "@/components/whatsapp/WhatsAppOperatorPanel";
import { emitirToast } from "@/shared/lib/mensajeria";

// ============================================================================
// TIPOS
// ============================================================================

interface GrupoWhatsApp {
  jid: string;
  nombre: string;
  conectado?: boolean;
  salaId?: string | null;
  salaNombre?: string | null;
  grupoId?: string | null;
  grupoNombre?: string | null;
  estadoConexion?: string;
}

interface GrupoSistemaItem {
  id: string;
  nombre: string;
  moneda?: string;
  activo?: boolean;
  totalSalas?: number;
  salasConectadas?: number;
  conectado?: boolean;
  gruposWhatsappNombres?: string[];
}

interface SalaJuego {
  id: string;
  grupo_id?: string;
  grupo_nombre?: string | null;
  nombre_sala: string;
  orden_sala?: number;
  hipodromo_activo?: string;
  numero_carrera_activa?: number;
  estado_carrera?: string;
  apuesta_minima?: number;
  tiempo_vencimiento_propuesta_min?: number;
  tiempo_vencimiento_min?: number;
  tope_caballos_marcas_nacional?: number;
  tope_marcas_nacional?: number;
  tope_caballos_marcas_internacional?: number;
  tope_marcas_americano?: number;
  comision_default?: number | null;
  cruce_mismo_ejemplar?: boolean;
  cruce_diferente_ejemplar?: boolean;
  whatsapp_group_jid?: string | null;
  whatsapp_group_nombre?: string | null;
  grupos_whatsapp?: Array<{
    id?: string;
    sala_id: string;
    whatsapp_group_jid: string;
    whatsapp_group_nombre?: string | null;
    estado_conexion?: string;
    motivo_estado?: string;
  }>;
}

interface RespaldoSala {
  groupJid?: string | null;
  groupNombre?: string | null;
  desconectadoEn?: string;
}

interface StatusResponse {
  ok?: boolean;
  conectado: boolean;
  qrDataUrl: string | null;
  numeroVinculado: string | null;
  grupos: GrupoWhatsApp[];
  daemonOnline?: boolean;
  salas?: SalaJuego[];
  salasDesconectadas?: Record<string, RespaldoSala>;
}

type Feedback = {
  tipo: "ok" | "error" | "info";
  texto: string;
  detalle?: string;
};

// Respaldo local para no perder el JID si el navegador se recarga justo cuando
// el demonio está caído. El respaldo "oficial" vive en el servidor.
const STORAGE_DESCONECTADAS = "hipico_whatsapp_salas_desconectadas_v1";

function leerRespaldoLocal(): Record<string, RespaldoSala> {
  if (typeof window === "undefined") return {};
  try {
    const crudo = window.localStorage.getItem(STORAGE_DESCONECTADAS);
    if (!crudo) return {};
    const parseado = JSON.parse(crudo);
    return parseado && typeof parseado === "object" && !Array.isArray(parseado)
      ? parseado
      : {};
  } catch {
    return {};
  }
}

function escribirRespaldoLocal(datos: Record<string, RespaldoSala>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_DESCONECTADAS, JSON.stringify(datos));
  } catch {
    /* almacenamiento lleno o bloqueado: el respaldo del servidor sigue vivo */
  }
}

function mensajeDeError(err: unknown, porDefecto: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return porDefecto;
}

function tituloCorto(sala: SalaJuego, index: number): string {
  if (sala?.nombre_sala) return sala.nombre_sala;
  return "Sala de Juegos";
}

function nombreGrupo(
  jid: string | null | undefined,
  salas: SalaJuego[],
  grupos: GrupoWhatsApp[],
  respaldo: Record<string, RespaldoSala>,
  salaId: string
): string | null {
  if (!jid) return null;
  const sala = salas.find((s) => s.id === salaId);
  if (sala?.whatsapp_group_nombre) return sala.whatsapp_group_nombre;
  const enGrupos = grupos.find((g) => g.jid === jid);
  if (enGrupos?.nombre) return enGrupos.nombre;
  if (respaldo[salaId]?.groupNombre) return respaldo[salaId].groupNombre || null;
  return null;
}

// ============================================================================
// PÁGINA
// ============================================================================

export default function WhatsappPage() {
  const perfiles = useAuthStore((s) => s.perfiles);
  const esPrincipal = useAuthStore((s) => s.esPrincipal);
  const storeGrupoId = useAuthStore((s) => s.grupoId);
  const esOperador = !esPrincipal && esRolOperadorExclusivo(perfiles);
  const grupoUsuarioId = storeGrupoId ? String(storeGrupoId) : "";
  const esSuperAdmin = !esOperador;

  const [status, setStatus] = useState<StatusResponse>({
    conectado: false,
    qrDataUrl: null,
    numeroVinculado: null,
    grupos: [],
    daemonOnline: false,
    salas: [],
  });
  const [cargandoStatus, setCargandoStatus] = useState(true);
  const [salas, setSalas] = useState<SalaJuego[]>([]);
  const [respaldoLocal, setRespaldoLocal] = useState<Record<string, RespaldoSala>>({});
  const [seleccionGrupoPorSala, setSeleccionGrupoPorSala] = useState<Record<string, string>>(
    {}
  );
  const [pizarraPorSala, setPizarraPorSala] = useState<Record<string, string>>({});
  const [hipodromoPorSala, setHipodromoPorSala] = useState<Record<string, string>>({});
  const [carreraPorSala, setCarreraPorSala] = useState<Record<string, string>>({});
  const [procesandoAccion, setProcesandoAccion] = useState<string | null>(null);
  const [filtroGrupo, setFiltroGrupo] = useState("");
  const [gruposSistema, setGruposSistema] = useState<GrupoSistemaItem[]>([]);
  const [gruposFiltroIds, setGruposFiltroIds] = useState<string[]>([]);

  const toggleGrupoFiltro = (id: string) => {
    if (esOperador && grupoUsuarioId && id !== grupoUsuarioId) return;
    setGruposFiltroIds((prev) => {
      if (prev.length === 0) {
        return [id];
      }
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id);
      }
      return [...prev, id];
    });
  };
  const [vinculosPorSala, setVinculosPorSala] = useState<Record<string, NonNullable<SalaJuego["grupos_whatsapp"]>>>({});
  const [vinculosGlobales, setVinculosGlobales] = useState<any[]>([]);
  const [filtroEstadoGrupo, setFiltroEstadoGrupo] = useState<"todos" | "conectados" | "desconectados">("todos");
  const [filtroGrupoDirectorio, setFiltroGrupoDirectorio] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [salaConfigurando, setSalaConfigurando] = useState<SalaJuego | null>(null);
  const [grupoParaVincularEnModal, setGrupoParaVincularEnModal] = useState<string>("");
  const [confApuestaMin, setConfApuestaMin] = useState<string>("10");
  const [confTiempoVenc, setConfTiempoVenc] = useState<string>("5");
  const [confTopeNac, setConfTopeNac] = useState<string>("5");
  const [confTopeInt, setConfTopeInt] = useState<string>("4");
  const [confComision, setConfComision] = useState<string>("5");
  const [confCruceMismo, setConfCruceMismo] = useState<boolean>(false);
  const [confCruceDiferente, setConfCruceDiferente] = useState<boolean>(false);
  const [guardandoParametros, setGuardandoParametros] = useState<boolean>(false);
  const [gruposDifusionSeleccionados, setGruposDifusionSeleccionados] = useState<string[]>([]);
  const [tipoDifusion, setTipoDifusion] = useState<"TEXTO" | "IMAGEN" | "NOTA_VOZ">("TEXTO");
  const [textoDifusion, setTextoDifusion] = useState<string>("");
  const [mediaBase64, setMediaBase64] = useState<string>("");
  const [mediaMimetype, setMediaMimetype] = useState<string>("");
  const [mediaNombre, setMediaNombre] = useState<string>("");
  const [fechaLimpiezaInicio, setFechaLimpiezaInicio] = useState<string>(
    () => new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  );
  const [fechaLimpiezaFin, setFechaLimpiezaFin] = useState<string>(
    () => new Date().toISOString().slice(0, 10)
  );

  const abrirConfigSala = async (sala: SalaJuego) => {
    setSalaConfigurando(sala);
    setGrupoParaVincularEnModal("");
    setConfApuestaMin(String(sala.apuesta_minima ?? 10));
    setConfTiempoVenc(String(sala.tiempo_vencimiento_propuesta_min ?? sala.tiempo_vencimiento_min ?? 5));
    setConfTopeNac(String(sala.tope_caballos_marcas_nacional ?? sala.tope_marcas_nacional ?? 5));
    setConfTopeInt(String(sala.tope_caballos_marcas_internacional ?? sala.tope_marcas_americano ?? 4));
    setConfComision(String(sala.comision_default ?? 5));
    setConfCruceMismo(Boolean(sala.cruce_mismo_ejemplar));
    setConfCruceDiferente(Boolean(sala.cruce_diferente_ejemplar));

    // La comisión y los permisos de cruce viven en `grupos_venta`, no en
    // `salas_juego`: se leen aparte para que el modal muestre el valor real.
    try {
      const res = await fetch("/api/whatsapp-sala/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "obtener_config_sala", salaId: sala.id }),
      });
      const json = await res.json().catch(() => ({}));
      const g = json?.grupo;
      if (json?.ok && g) {
        if (g.comision_default != null) setConfComision(String(g.comision_default));
        setConfCruceMismo(Boolean(g.cruce_mismo_ejemplar));
        setConfCruceDiferente(Boolean(g.cruce_diferente_ejemplar));
        setSalaConfigurando((prev) =>
          prev && prev.id === sala.id
            ? {
                ...prev,
                comision_default: g.comision_default,
                cruce_mismo_ejemplar: Boolean(g.cruce_mismo_ejemplar),
                cruce_diferente_ejemplar: Boolean(g.cruce_diferente_ejemplar),
              }
            : prev
        );
      }
    } catch {
      /* valores por defecto ya cargados desde la sala */
    }
  };

  const guardarParametrosSala = async () => {
    if (!salaConfigurando) return;
    setGuardandoParametros(true);
    try {
      const apMinNum = parseFloat(confApuestaMin) || 10;
      const tiempoNum = parseInt(confTiempoVenc, 10) || 5;
      const topeNacNum = parseInt(confTopeNac, 10) || 5;
      const topeIntNum = parseInt(confTopeInt, 10) || 4;
      const comisionNum = parseFloat(confComision);
      const res = await fetch("/api/whatsapp-sala/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accion: "actualizar_config_sala",
          salaId: salaConfigurando.id,
          apuestaMinima: apMinNum,
          tiempoVencimientoPropuestaMin: tiempoNum,
          topeCaballosMarcasNacional: topeNacNum,
          topeCaballosMarcasInternacional: topeIntNum,
          comisionDefault: Number.isFinite(comisionNum) ? comisionNum : 5,
          cruceMismoEjemplar: confCruceMismo,
          cruceDiferenteEjemplar: confCruceDiferente,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (json?.ok) {
        setFeedback({ tipo: "ok", texto: "✅ Parámetros de sala actualizados correctamente." });
        emitirToast("✅ Parámetros de sala guardados correctamente.", "success");
        setSalas((prev) =>
          prev.map((s) =>
            s.id === salaConfigurando.id
              ? {
                  ...s,
                  apuesta_minima: apMinNum,
                  tiempo_vencimiento_propuesta_min: tiempoNum,
                  tiempo_vencimiento_min: tiempoNum,
                  tope_caballos_marcas_nacional: topeNacNum,
                  tope_marcas_nacional: topeNacNum,
                  tope_caballos_marcas_internacional: topeIntNum,
                  tope_marcas_americano: topeIntNum,
                  comision_default: Number.isFinite(comisionNum) ? comisionNum : 5,
                  cruce_mismo_ejemplar: confCruceMismo,
                  cruce_diferente_ejemplar: confCruceDiferente,
                }
              : s
          )
        );
        setSalaConfigurando((prev) =>
          prev && prev.id === salaConfigurando.id
            ? {
                ...prev,
                apuesta_minima: apMinNum,
                tiempo_vencimiento_propuesta_min: tiempoNum,
                tiempo_vencimiento_min: tiempoNum,
                tope_caballos_marcas_nacional: topeNacNum,
                tope_marcas_nacional: topeNacNum,
                tope_caballos_marcas_internacional: topeIntNum,
                tope_marcas_americano: topeIntNum,
                comision_default: Number.isFinite(comisionNum) ? comisionNum : 5,
                cruce_mismo_ejemplar: confCruceMismo,
                cruce_diferente_ejemplar: confCruceDiferente,
              }
            : prev
        );
      } else {
        setFeedback({ tipo: "error", texto: json?.motivo || "Error al actualizar parámetros." });
        emitirToast(json?.motivo || "No se pudieron guardar los parámetros.", "error");
      }
    } catch (err: any) {
      setFeedback({ tipo: "error", texto: err?.message || "Error al actualizar parámetros de la sala." });
      emitirToast("Error al actualizar parámetros de la sala.", "error");
    } finally {
      setGuardandoParametros(false);
    }
  };
  const [pingPorSala, setPingPorSala] = useState<
    Record<string, { latenciaMs: number; conectado: boolean; participantes?: number; error?: string }>
  >({});
  const [haciendoPing, setHaciendoPing] = useState<Record<string, boolean>>({});

  // Respaldos locales iniciales
  useEffect(() => {
    setRespaldoLocal(leerRespaldoLocal());
  }, []);

  // Auto-cierre del aviso no bloqueante
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), feedback.tipo === "error" ? 12000 : 8000);
    return () => clearTimeout(timer);
  }, [feedback]);

  const consultarEstado = useCallback(async (silencioso = false, forzar = false) => {
    if (!silencioso) setCargandoStatus(true);
    try {
      const res = await fetch(`/api/whatsapp-sala/status${forzar ? "?force=true" : ""}`, { cache: "no-store" });
      if (!res.ok) return;
      const data: StatusResponse = await res.json();

      const salasServidor = Array.isArray(data.salas) ? data.salas : [];

      setStatus({
        conectado: Boolean(data.conectado),
        qrDataUrl: data.qrDataUrl || null,
        numeroVinculado: data.numeroVinculado || null,
        grupos: Array.isArray(data.grupos) ? data.grupos : [],
        daemonOnline: Boolean(data.daemonOnline),
        salas: salasServidor,
      });

      if (salasServidor.length > 0) {
        setSalas((prev) => {
          const map = new Map(prev.map((p) => [p.id, p]));
          for (const s of salasServidor) {
            const previo = map.get(s.id);
            const gWa = (s.grupos_whatsapp && s.grupos_whatsapp.length > 0)
              ? s.grupos_whatsapp
              : (previo?.grupos_whatsapp && previo.grupos_whatsapp.length > 0)
                ? previo.grupos_whatsapp
                : [];
            map.set(s.id, {
              ...previo,
              ...s,
              grupos_whatsapp: gWa,
              whatsapp_group_jid: s.whatsapp_group_jid || previo?.whatsapp_group_jid || gWa[0]?.whatsapp_group_jid || null,
              whatsapp_group_nombre: s.whatsapp_group_nombre || previo?.whatsapp_group_nombre || gWa[0]?.whatsapp_group_nombre || null,
            });
          }
          return Array.from(map.values());
        });
        setSeleccionGrupoPorSala((prev) => {
          const next = { ...prev };
          for (const s of salasServidor) {
            if (s.whatsapp_group_jid && !next[s.id]) {
              next[s.id] = s.whatsapp_group_jid;
            } else if (next[s.id] === undefined) {
              next[s.id] = "";
            }
          }
          return next;
        });
      }

      // Fusionar el respaldo del servidor con el local y podar las salas que ya
      // tengan un grupo activo (esas ya no necesitan "volver a conectar").
      const respaldoServidor =
        data.salasDesconectadas && typeof data.salasDesconectadas === "object"
          ? data.salasDesconectadas
          : {};
      const fusionado: Record<string, RespaldoSala> = {
        ...leerRespaldoLocal(),
        ...respaldoServidor,
      };
      const porId = new Map(salasServidor.map((s) => [s.id, s]));
      for (const id of Object.keys(fusionado)) {
        const sala = porId.get(id);
        if (sala?.whatsapp_group_jid) delete fusionado[id];
      }

      const previo = JSON.stringify(leerRespaldoLocal());
      setRespaldoLocal(fusionado);
      if (JSON.stringify(fusionado) !== previo) {
        escribirRespaldoLocal(fusionado);
      }
    } catch {
      // Se reintenta en el próximo ciclo; el respaldo local sigue disponible
    } finally {
      if (!silencioso) setCargandoStatus(false);
    }
  }, []);

  const cargarSalasGrupos = useCallback(async (gId?: string) => {
    try {
      const targetGrupo = esOperador && grupoUsuarioId
        ? grupoUsuarioId
        : gId !== undefined
        ? gId
        : "";
      const qs = targetGrupo ? `?grupoId=${encodeURIComponent(targetGrupo)}` : "";
      const res = await fetch(`/api/whatsapp-sala/salas-grupos${qs}`, { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      if (Array.isArray(json.gruposSistema)) {
        const listaGrupos = esOperador && grupoUsuarioId
          ? json.gruposSistema.filter((g: GrupoSistemaItem) => String(g.id) === grupoUsuarioId)
          : json.gruposSistema;
        setGruposSistema(listaGrupos);
        if (esOperador && grupoUsuarioId) {
          setGruposFiltroIds((prev) => (prev.length === 1 && prev[0] === grupoUsuarioId ? prev : [grupoUsuarioId]));
        }
      }
      if (Array.isArray(json.vinculosGlobales)) {
        setVinculosGlobales(json.vinculosGlobales);
      }
      if (Array.isArray(json.salas)) {
        const mapa: Record<string, NonNullable<SalaJuego["grupos_whatsapp"]>> = {};
        for (const s of json.salas) {
          mapa[s.id] = Array.isArray(s.grupos_whatsapp) ? s.grupos_whatsapp : [];
        }
        setVinculosPorSala((prev) => ({ ...prev, ...mapa }));
        setSalas((prev) => {
          const map = new Map(prev.map((item) => [item.id, item]));
          for (const s of json.salas) {
            const previo = map.get(s.id);
            const vinculosActivos = Array.isArray(s.grupos_whatsapp) ? s.grupos_whatsapp : (previo?.grupos_whatsapp || []);
            const primerJid = vinculosActivos[0]?.whatsapp_group_jid || null;
            const primerNombre = vinculosActivos[0]?.whatsapp_group_nombre || null;
            map.set(s.id, {
              ...previo,
              ...s,
              grupos_whatsapp: vinculosActivos,
              whatsapp_group_jid: s.whatsapp_group_jid || primerJid || previo?.whatsapp_group_jid || null,
              whatsapp_group_nombre: s.whatsapp_group_nombre || primerNombre || previo?.whatsapp_group_nombre || null,
            });
          }
          return Array.from(map.values());
        });
      }
    } catch {
      // No bloqueante
    }
  }, [esOperador, grupoUsuarioId]);

  useEffect(() => {
    consultarEstado(false);
    void cargarSalasGrupos();
    const timer = setInterval(() => {
      consultarEstado(true);
      void cargarSalasGrupos();
    }, 4000);
    return () => clearInterval(timer);
  }, [consultarEstado, cargarSalasGrupos]);

  const agregarSalaAlGrupo = async (grupoEspecificoId?: string) => {
    const gId = (esOperador && grupoUsuarioId)
      ? grupoUsuarioId
      : (grupoEspecificoId || (gruposFiltroIds.length === 1 ? gruposFiltroIds[0] : null) || salas[0]?.grupo_id || gruposSistema[0]?.id);
    if (!gId) return;
    const salasDelGrupo = salas.filter((s) => String(s.grupo_id) === String(gId));
    if (salasDelGrupo.length >= 2) {
      setFeedback({
        tipo: "error",
        texto: "❌ Límite estricto: Máximo 2 salas simultáneas permitidas por sesión/grupo.",
      });
      return;
    }
    setProcesandoAccion("crear-sala");
    try {
      const res = await fetch("/api/whatsapp-sala/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "crear_sala", grupoId: gId }),
      });
      const json = await res.json();
      if (json.ok) {
        setFeedback({ tipo: "ok", texto: `✅ ${json.motivo || "Sala agregada exitosamente"}` });
        await Promise.all([consultarEstado(true), cargarSalasGrupos()]);
      } else {
        setFeedback({ tipo: "error", texto: `❌ ${json.motivo || "No se pudo agregar la sala"}` });
      }
    } catch (e: any) {
      setFeedback({ tipo: "error", texto: `❌ ${e?.message || "Error de red"}` });
    } finally {
      setProcesandoAccion(null);
    }
  };

  const eliminarSalaDelGrupo = async (salaId: string) => {
    setProcesandoAccion(`eliminar-sala-${salaId}`);
    try {
      const res = await fetch("/api/whatsapp-sala/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "eliminar_sala", salaId }),
      });
      const json = await res.json();
      if (json.ok) {
        setFeedback({ tipo: "ok", texto: `✅ ${json.motivo || "Sala eliminada"}` });
        if (salaConfigurando?.id === salaId) {
          setSalaConfigurando(null);
        }
        await Promise.all([consultarEstado(true), cargarSalasGrupos()]);
      } else {
        setFeedback({ tipo: "error", texto: `❌ ${json.motivo || "No se pudo eliminar"}` });
      }
    } finally {
      setProcesandoAccion(null);
    }
  };

  const vincularMultiGrupo = async (sala: SalaJuego, groupJid: string) => {
    if (!groupJid) return;
    setProcesandoAccion(`vincular-multi-${sala.id}`);
    try {
      const gId = sala.grupo_id || (gruposFiltroIds[0] ?? "");
      const res = await fetch("/api/whatsapp-sala/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accion: "vincular_grupo_sala",
          grupoId: gId,
          salaId: sala.id,
          groupJid,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        const nombreGrupoFinal = json.nombreGrupo || status.grupos.find(g => g.jid === groupJid)?.nombre || groupJid;
        setSalas((prev) =>
          prev.map((s) => {
            if (s.id !== sala.id) return s;
            const nuevoVinculo = {
              sala_id: sala.id,
              whatsapp_group_jid: groupJid,
              whatsapp_group_nombre: nombreGrupoFinal,
              estado_conexion: "conectado",
              motivo_estado: "Conectado y verificado",
            };
            const listaV = (s.grupos_whatsapp || []).filter(v => v.whatsapp_group_jid !== groupJid);
            listaV.push(nuevoVinculo);
            return {
              ...s,
              whatsapp_group_jid: groupJid,
              whatsapp_group_nombre: nombreGrupoFinal,
              grupos_whatsapp: listaV,
            };
          })
        );
        setVinculosPorSala((prev) => {
          const list = (prev[sala.id] || []).filter(v => v.whatsapp_group_jid !== groupJid);
          list.push({
            sala_id: sala.id,
            whatsapp_group_jid: groupJid,
            whatsapp_group_nombre: nombreGrupoFinal,
            estado_conexion: "conectado",
            motivo_estado: "Conectado y verificado",
          });
          return { ...prev, [sala.id]: list };
        });
        setSeleccionGrupoPorSala((prev) => ({ ...prev, [sala.id]: groupJid }));
        setFeedback({ tipo: "ok", texto: `✅ Conectado: ${json.motivo || "Conectado correctamente al Motor Baileys 24/7"}` });
        await Promise.all([consultarEstado(true), cargarSalasGrupos(gId)]);
      } else {
        setFeedback({ tipo: "error", texto: `❌ No se pudo conectar: ${json.motivo || "Error desconocido"}` });
      }
    } catch (e: any) {
      setFeedback({ tipo: "error", texto: `❌ No se pudo conectar: ${e?.message || "Error de red"}` });
    } finally {
      setProcesandoAccion(null);
    }
  };

  const desvincularMultiGrupo = async (vinculoId: string | undefined, salaId: string, groupJid: string) => {
    setProcesandoAccion(`desvincular-multi-${salaId}-${groupJid}`);
    try {
      const res = await fetch("/api/whatsapp-sala/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "desvincular_grupo_sala", id: vinculoId, salaId, groupJid }),
      });
      const json = await res.json();
      if (json.ok) {
        setVinculosPorSala((prev) => ({
          ...prev,
          [salaId]: (prev[salaId] || []).filter(v => v.whatsapp_group_jid !== groupJid && v.id !== vinculoId),
        }));
        setSalas((prev) =>
          prev.map((s) => {
            if (s.id !== salaId) return s;
            const rest = (s.grupos_whatsapp || []).filter(v => v.whatsapp_group_jid !== groupJid && v.id !== vinculoId);
            const nextJid = rest[0]?.whatsapp_group_jid || (s.whatsapp_group_jid === groupJid ? null : s.whatsapp_group_jid);
            const nextNom = rest[0]?.whatsapp_group_nombre || (s.whatsapp_group_jid === groupJid ? null : s.whatsapp_group_nombre);
            return { ...s, whatsapp_group_jid: nextJid, whatsapp_group_nombre: nextNom, grupos_whatsapp: rest };
          })
        );
        setFeedback({ tipo: "ok", texto: `✅ Grupo desvinculado correctamente` });
        await Promise.all([consultarEstado(true), cargarSalasGrupos()]);
      } else {
        setFeedback({ tipo: "error", texto: `❌ ${json.motivo || "No se pudo desvincular"}` });
      }
    } finally {
      setProcesandoAccion(null);
    }
  };

  const guardarRespaldo = useCallback((salaId: string, datos: RespaldoSala | null) => {
    setRespaldoLocal((prev) => {
      const next = { ...prev };
      if (datos && (datos.groupJid || datos.groupNombre)) {
        next[salaId] = datos;
      } else {
        delete next[salaId];
      }
      escribirRespaldoLocal(next);
      return next;
    });
  }, []);

  // --------------------------------------------------------------------------
  // ACCIONES CONTRA EL API
  // --------------------------------------------------------------------------

  const ejecutarAdmin = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch("/api/whatsapp-sala/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      return { res, json } as { res: Response; json: any };
    },
    []
  );

  const probarPingGrupo = async (salaId: string, groupJid: string) => {
    if (!groupJid) return;
    setHaciendoPing((p) => ({ ...p, [salaId]: true }));
    try {
      const { json } = await ejecutarAdmin({
        accion: "ping-grupo",
        groupJid,
      });
      setPingPorSala((p) => ({
        ...p,
        [salaId]: {
          latenciaMs: json.latenciaMs ?? 0,
          conectado: Boolean(json.conectado),
          participantes: json.totalParticipantes,
          error: json.error,
        },
      }));
    } catch (e: any) {
      setPingPorSala((p) => ({
        ...p,
        [salaId]: {
          latenciaMs: 0,
          conectado: false,
          error: e?.message || "Error al conectar",
        },
      }));
    } finally {
      setHaciendoPing((p) => ({ ...p, [salaId]: false }));
    }
  };

  const desconectarSesion = async () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm("¿Desconectar la sesión actual de WhatsApp (sock.logout) y generar un nuevo QR?")
    ) {
      return;
    }
    setProcesandoAccion("desconectar-sesion");
    setFeedback(null);
    try {
      const res = await fetch("/api/whatsapp/disconnect", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.ok) {
        setFeedback({
          tipo: "ok",
          texto: json?.motivo || "Sesión de WhatsApp desconectada. Escanea el nuevo QR.",
        });
        await consultarEstado(false, true);
      } else {
        setFeedback({
          tipo: "error",
          texto: json?.motivo || "No se pudo desconectar la sesión de WhatsApp.",
        });
      }
    } catch (err: unknown) {
      setFeedback({
        tipo: "error",
        texto: mensajeDeError(err, "Error de red al desconectar la sesión."),
      });
    } finally {
      setProcesandoAccion(null);
    }
  };

  const toggleGrupoDifusion = (jid: string) => {
    setGruposDifusionSeleccionados((prev) =>
      prev.includes(jid) ? prev.filter((item) => item !== jid) : [...prev, jid]
    );
  };

  const cargarArchivoDifusion = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMediaNombre(file.name);
    setMediaMimetype(file.type || (tipoDifusion === "IMAGEN" ? "image/jpeg" : "audio/ogg"));
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setMediaBase64(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const enviarDifusionMultimedia = async () => {
    if (!esSuperAdmin) {
      setFeedback({ tipo: "error", texto: "Solo Super Admin puede difundir a múltiples grupos." });
      return;
    }
    if (gruposDifusionSeleccionados.length === 0) {
      setFeedback({ tipo: "error", texto: "Haz clic en el ícono de al menos 1 grupo de WhatsApp para difundir." });
      return;
    }
    if (tipoDifusion === "TEXTO" && !textoDifusion.trim()) {
      setFeedback({ tipo: "error", texto: "Escribe el texto a difundir." });
      return;
    }
    if ((tipoDifusion === "IMAGEN" || tipoDifusion === "NOTA_VOZ") && !mediaBase64) {
      setFeedback({ tipo: "error", texto: "Adjunta el archivo de imagen o nota de voz." });
      return;
    }

    setProcesandoAccion("difundir-multimedia");
    setFeedback(null);
    try {
      const { json } = await ejecutarAdmin({
        accion: "difundir_grupos",
        groupJids: gruposDifusionSeleccionados,
        tipo: tipoDifusion,
        texto: textoDifusion.trim(),
        mediaBase64,
        mimetype: mediaMimetype,
      });
      if (json?.ok) {
        setFeedback({ tipo: "ok", texto: `✅ ${json.motivo || "Difusión enviada."}` });
        setTextoDifusion("");
        setMediaBase64("");
        setMediaNombre("");
      } else {
        setFeedback({ tipo: "error", texto: json?.motivo || "No se pudo enviar la difusión." });
      }
    } catch (err: unknown) {
      setFeedback({ tipo: "error", texto: mensajeDeError(err, "Error al difundir.") });
    } finally {
      setProcesandoAccion(null);
    }
  };

  const limpiarMultimediaPorFechas = async () => {
    if (!fechaLimpiezaInicio || !fechaLimpiezaFin) {
      setFeedback({ tipo: "error", texto: "Selecciona fecha de inicio y fecha fin." });
      return;
    }
    setProcesandoAccion("limpiar-multimedia");
    setFeedback(null);
    try {
      const { json } = await ejecutarAdmin({
        accion: "limpiar_multimedia",
        fechaInicio: fechaLimpiezaInicio,
        fechaFin: fechaLimpiezaFin,
      });
      if (json?.ok) {
        setFeedback({
          tipo: "ok",
          texto: `🧹 ${json.motivo || `Limpieza completada (${json.eliminados ?? 0} registros)`}`,
        });
      } else {
        setFeedback({ tipo: "error", texto: json?.motivo || "No se pudo limpiar multimedia." });
      }
    } catch (err: unknown) {
      setFeedback({ tipo: "error", texto: mensajeDeError(err, "Error al limpiar multimedia.") });
    } finally {
      setProcesandoAccion(null);
    }
  };

  const refrescarGruposWhatsApp = async () => {
    setProcesandoAccion("refrescar-grupos");
    try {
      await consultarEstado(false, true);
      setFeedback({ tipo: "ok", texto: "Lista de grupos actualizada exitosamente desde WhatsApp." });
    } catch {
      setFeedback({ tipo: "error", texto: "No se pudo actualizar la lista de grupos." });
    } finally {
      setProcesandoAccion(null);
    }
  };

  const vincularGrupoASala = async (sala: SalaJuego, nuevoGroupJid: string) => {
    setSeleccionGrupoPorSala((prev) => ({ ...prev, [sala.id]: nuevoGroupJid }));
    setProcesandoAccion(`vincular-${sala.id}`);
    setFeedback(null);

    const grupoObj = status.grupos.find((g) => g.jid === nuevoGroupJid);

    try {
      const { json } = await ejecutarAdmin({
        accion: "vincular-sala",
        salaId: sala.id,
        groupJid: nuevoGroupJid || null,
        groupNombre: grupoObj?.nombre || null,
      });

      if (json.ok) {
        setSalas((prev) =>
          prev.map((s) =>
            s.id === sala.id
              ? {
                  ...s,
                  whatsapp_group_jid: nuevoGroupJid || null,
                  whatsapp_group_nombre: grupoObj?.nombre || null,
                }
              : s
          )
        );
        guardarRespaldo(sala.id, null);
        setFeedback({
          tipo: "ok",
          texto: nuevoGroupJid
            ? `Sala vinculada a "${grupoObj?.nombre || nuevoGroupJid}".`
            : `Se desvinculó el grupo de ${sala.nombre_sala}.`,
        });
        consultarEstado(true);
      } else {
        setFeedback({
          tipo: "error",
          texto: json.error || "No se pudo guardar la vinculación de la sala.",
        });
      }
    } catch (err: unknown) {
      setFeedback({
        tipo: "error",
        texto: mensajeDeError(err, "Error de red al vincular la sala."),
      });
    } finally {
      setProcesandoAccion(null);
    }
  };

  const desconectarSala = async (sala: SalaJuego) => {
    const jidActual = sala.whatsapp_group_jid || seleccionGrupoPorSala[sala.id] || "";
    const nombreActual =
      nombreGrupo(jidActual, salas, status.grupos, respaldoLocal, sala.id) || null;

    setProcesandoAccion(`desconectar-${sala.id}`);
    setFeedback(null);
    try {
      const { json } = await ejecutarAdmin({
        accion: "desconectar-sala",
        salaId: sala.id,
      });

      if (json.ok) {
        setSalas((prev) =>
          prev.map((s) => (s.id === sala.id ? { ...s, whatsapp_group_jid: null } : s))
        );
        setSeleccionGrupoPorSala((prev) => ({ ...prev, [sala.id]: "" }));
        guardarRespaldo(sala.id, {
          groupJid: json.groupJid || jidActual || null,
          groupNombre: json.groupNombre || nombreActual,
          desconectadoEn: new Date().toISOString(),
        });
        setFeedback({
          tipo: "ok",
          texto: `Grupo desconectado de ${sala.nombre_sala}. El bot dejó de publicar en esa sala.`,
        });
        consultarEstado(true);
      } else {
        setFeedback({
          tipo: "error",
          texto: json.error || "No se pudo desconectar el grupo de la sala.",
        });
      }
    } catch (err: unknown) {
      setFeedback({
        tipo: "error",
        texto: mensajeDeError(err, "Error de red al desconectar la sala."),
      });
    } finally {
      setProcesandoAccion(null);
    }
  };

  const reconectarSala = async (sala: SalaJuego) => {
    const respaldo = respaldoLocal[sala.id] || {};
    const jid =
      seleccionGrupoPorSala[sala.id] || respaldo.groupJid || sala.whatsapp_group_jid || "";
    const nombre =
      nombreGrupo(jid, salas, status.grupos, respaldoLocal, sala.id) ||
      respaldo.groupNombre ||
      null;

    if (!jid) {
      setFeedback({
        tipo: "error",
        texto:
          "No hay un grupo guardado para esta sala. Selecciona un grupo de la lista y pulsa Vincular.",
      });
      return;
    }

    setProcesandoAccion(`reconectar-${sala.id}`);
    setFeedback(null);
    try {
      const { json } = await ejecutarAdmin({
        accion: "reconectar-sala",
        salaId: sala.id,
        groupJid: jid,
        groupNombre: nombre,
      });

      if (json.ok) {
        setSalas((prev) =>
          prev.map((s) =>
            s.id === sala.id
              ? {
                  ...s,
                  whatsapp_group_jid: json.groupJid || jid,
                  whatsapp_group_nombre: json.groupNombre || nombre,
                }
              : s
          )
        );
        setSeleccionGrupoPorSala((prev) => ({
          ...prev,
          [sala.id]: json.groupJid || jid,
        }));
        guardarRespaldo(sala.id, null);
        setFeedback({
          tipo: "ok",
          texto: `Grupo reconectado a ${sala.nombre_sala}${
            nombre ? ` ("${nombre}")` : ""
          }. El bot vuelve a publicar en esa sala.`,
        });
        consultarEstado(true);
      } else {
        setFeedback({
          tipo: "error",
          texto: json.error || "No se pudo reconectar el grupo de la sala.",
        });
      }
    } catch (err: unknown) {
      setFeedback({
        tipo: "error",
        texto: mensajeDeError(err, "Error de red al reconectar la sala."),
      });
    } finally {
      setProcesandoAccion(null);
    }
  };

  const desconectarTodas = async () => {
    const vinculadas = salas.filter((s) => s.whatsapp_group_jid);
    if (vinculadas.length === 0) {
      setFeedback({ tipo: "info", texto: "No hay salas con grupo vinculado." });
      return;
    }
    if (
      !window.confirm(
        `¿Desconectar las ${vinculadas.length} sala(s) con grupo vinculado? El bot dejará de publicar hasta que las reconectes.`
      )
    ) {
      return;
    }
    setProcesandoAccion("desconectar-todas");
    try {
      for (const sala of vinculadas) {
        await desconectarSala(sala);
      }
    } finally {
      setProcesandoAccion(null);
    }
  };

  const reconectarTodas = async () => {
    const reconectables = salas.filter(
      (s) => !s.whatsapp_group_jid && (respaldoLocal[s.id]?.groupJid || seleccionGrupoPorSala[s.id])
    );
    if (reconectables.length === 0) {
      setFeedback({ tipo: "info", texto: "No hay salas pausadas con grupo guardado." });
      return;
    }
    setProcesandoAccion("reconectar-todas");
    try {
      for (const sala of reconectables) {
        await reconectarSala(sala);
      }
    } finally {
      setProcesandoAccion(null);
    }
  };

  const desvincularGrupoDirecto = async (groupJid: string, groupNombre?: string) => {
    if (!groupJid) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(`¿Desconectar y desvincular "${groupNombre || groupJid}" de todas las salas?`)
    ) {
      return;
    }
    setProcesandoAccion(`desvincular-dir-${groupJid}`);
    setFeedback(null);
    try {
      const res = await fetch("/api/whatsapp-sala/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accion: "desconectar_grupo_jid",
          groupJid,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (json?.ok) {
        setFeedback({ tipo: "ok", texto: `✅ Grupo "${groupNombre || groupJid}" desconectado con éxito.` });
        await Promise.all([consultarEstado(true, true), cargarSalasGrupos()]);
      } else {
        setFeedback({ tipo: "error", texto: json?.motivo || "No se pudo desconectar el grupo." });
      }
    } catch (err: any) {
      setFeedback({ tipo: "error", texto: err?.message || "Error al desconectar el grupo." });
    } finally {
      setProcesandoAccion(null);
    }
  };

  const abrirCarrera = async (sala: SalaJuego) => {
    const hipodromo = (hipodromoPorSala[sala.id] || sala.hipodromo_activo || "LA RINCONADA")
      .trim()
      .toUpperCase();
    const carrera = (carreraPorSala[sala.id] || sala.numero_carrera_activa || 1).toString();
    setProcesandoAccion(`abrir-${sala.id}`);
    setFeedback(null);
    try {
      const { json } = await ejecutarAdmin({
        accion: "abrir-carrera",
        salaId: sala.id,
        hipodromo,
        carrera,
      });
      if (json.ok) {
        setSalas((prev) =>
          prev.map((s) =>
            s.id === sala.id
              ? {
                  ...s,
                  estado_carrera: "abierta",
                  hipodromo_activo: hipodromo,
                  numero_carrera_activa: parseInt(carrera, 10),
                }
              : s
          )
        );
        setFeedback({
          tipo: "ok",
          texto: json.enviadoWhatsApp
            ? `Carrera abierta (${hipodromo} #${carrera}) y anunciada en el grupo.`
            : `Carrera abierta (${hipodromo} #${carrera}) en sala ${sala.nombre_sala}.`,
          detalle: json.textoApertura,
        });
      } else {
        setFeedback({ tipo: "error", texto: json.error || "No se pudo abrir la carrera." });
      }
    } catch (err: unknown) {
      setFeedback({ tipo: "error", texto: mensajeDeError(err, "Error al abrir la carrera.") });
    } finally {
      setProcesandoAccion(null);
    }
  };

  const cerrarCarrera = async (sala: SalaJuego) => {
    setProcesandoAccion(`cerrar-${sala.id}`);
    setFeedback(null);
    try {
      const { json } = await ejecutarAdmin({ accion: "cerrar-carrera", salaId: sala.id });
      if (json.ok) {
        setSalas((prev) =>
          prev.map((s) => (s.id === sala.id ? { ...s, estado_carrera: "cerrada" } : s))
        );
        setFeedback({
          tipo: "ok",
          texto: json.enviadoWhatsApp
            ? "Carrera cerrada y anunciada en el grupo."
            : `Carrera cerrada en sala ${sala.nombre_sala}.`,
          detalle: json.textoCierre,
        });
      } else {
        setFeedback({ tipo: "error", texto: json.error || "No se pudo cerrar la carrera." });
      }
    } catch (err: unknown) {
      setFeedback({ tipo: "error", texto: mensajeDeError(err, "Error al cerrar la carrera.") });
    } finally {
      setProcesandoAccion(null);
    }
  };

  const publicarPlanoJugadas = async (sala: SalaJuego) => {
    setProcesandoAccion(`plano-${sala.id}`);
    setFeedback(null);
    try {
      const { json } = await ejecutarAdmin({ accion: "publicar-plano", salaId: sala.id });
      if (json.ok) {
        setFeedback({
          tipo: "ok",
          texto: json.enviadoWhatsApp
            ? `Plano de Jugadas enviado al grupo (${sala.nombre_sala}).`
            : `Plano de Jugadas generado (${sala.nombre_sala}). Vincula un grupo para enviarlo.`,
          detalle: json.textoPlano,
        });
      } else {
        setFeedback({
          tipo: "error",
          texto: json.error || "No se pudo publicar el Plano de Jugadas.",
        });
      }
    } catch (err: unknown) {
      setFeedback({
        tipo: "error",
        texto: mensajeDeError(err, "Error al publicar el Plano de Jugadas."),
      });
    } finally {
      setProcesandoAccion(null);
    }
  };

  const publicarSentenciaPizarra = async (sala: SalaJuego) => {
    const pizarra = (pizarraPorSala[sala.id] || "").trim();
    if (!pizarra) {
      setFeedback({
        tipo: "error",
        texto: `Escribe el orden de llegada (ej. 10.5.1.2.7) antes de publicar en ${sala.nombre_sala}.`,
      });
      return;
    }

    setProcesandoAccion(`sentencia-${sala.id}`);
    setFeedback(null);
    try {
      const { json } = await ejecutarAdmin({
        accion: "publicar-sentencia",
        salaId: sala.id,
        pizarra,
      });
      if (json.ok) {
        setFeedback({
          tipo: "ok",
          texto: json.enviadoWhatsApp
            ? `Sentencia (${pizarra}) liquidada y publicada en el grupo.`
            : `Sentencia (${pizarra}) liquidada en Supabase.`,
          detalle: json.textoResultado,
        });
      } else {
        setFeedback({
          tipo: "error",
          texto: json.error || "No se pudo ejecutar la sentencia de la carrera.",
        });
      }
    } catch (err: unknown) {
      setFeedback({
        tipo: "error",
        texto: mensajeDeError(err, "Error al publicar la sentencia."),
      });
    } finally {
      setProcesandoAccion(null);
    }
  };

  // --------------------------------------------------------------------------
  // MÉTRICAS DERIVADAS
  // --------------------------------------------------------------------------
  const metricas = useMemo(() => {
    const vinculadas = salas.filter((s) => {
      const v = vinculosPorSala[s.id] || s.grupos_whatsapp || [];
      return Boolean(s.whatsapp_group_jid) || v.length > 0;
    }).length;
    const pausadas = salas.filter((s) => {
      const v = vinculosPorSala[s.id] || s.grupos_whatsapp || [];
      const tiene = Boolean(s.whatsapp_group_jid) || v.length > 0;
      return !tiene && Boolean(respaldoLocal[s.id]?.groupJid);
    }).length;
    const gruposConectados = (status.grupos || []).filter((g) => g.conectado).length;
    return {
      vinculadas,
      pausadas,
      sinGrupo: Math.max(0, salas.length - vinculadas - pausadas),
      grupos: status.grupos.length,
      gruposConectados,
    };
  }, [salas, vinculosPorSala, respaldoLocal, status.grupos]);

  const gruposDirectorioFiltrados = useMemo(() => {
    return (status.grupos || []).filter((g) => {
      const cumpleFiltroEstado =
        filtroEstadoGrupo === "todos"
          ? true
          : filtroEstadoGrupo === "conectados"
          ? Boolean(g.conectado)
          : !g.conectado;
      if (!cumpleFiltroEstado) return false;
      if (!filtroGrupoDirectorio.trim()) return true;
      const q = filtroGrupoDirectorio.trim().toLowerCase();
      return (
        g.nombre.toLowerCase().includes(q) ||
        g.jid.toLowerCase().includes(q) ||
        (g.salaNombre && g.salaNombre.toLowerCase().includes(q)) ||
        (g.grupoNombre && g.grupoNombre.toLowerCase().includes(q))
      );
    });
  }, [status.grupos, filtroEstadoGrupo, filtroGrupoDirectorio]);

  const ocupado = procesandoAccion !== null;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 pb-24">
      {/* ==================== ENCABEZADO ==================== */}
      <header className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm sm:p-6">
        <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-emerald-100 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-50 text-xl ring-1 ring-emerald-200">
                💬
              </span>
              <div>
                <h1 className="text-base font-black uppercase tracking-wide text-slate-900 sm:text-lg">
                  Motor Bot de WhatsApp en VivoBaileys 24/7
                </h1>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-600">
                  Vincula grupos a cada sala, abre y cierra carreras, publica el plano de
                  jugadas y liquida la sentencia oficial sin salir de este panel.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-black ${
                status.conectado
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : status.qrDataUrl
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-rose-200 bg-rose-50 text-rose-700"
              }`}
            >
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  status.conectado
                    ? "bg-emerald-400"
                    : status.qrDataUrl
                    ? "bg-amber-400 animate-pulse"
                    : "bg-rose-500"
                }`}
              />
              {status.conectado
                ? `🟢 Conectado${status.numeroVinculado ? ` · +${status.numeroVinculado}` : ""}`
                : status.qrDataUrl
                ? "🟡 QR Pendiente"
                : "🔴 Desconectado"}
            </span>

            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold ${
                status.daemonOnline
                  ? "border-slate-200 bg-slate-50 text-slate-700"
                  : "border-rose-200 bg-rose-50 text-rose-700"
              }`}
              title="Demonio HTTP en el puerto 3005"
            >
              ⚙️ {status.daemonOnline ? "Demonio en línea" : "Demonio sin respuesta"}
            </span>

            <button
              type="button"
              onClick={() => consultarEstado(false)}
              disabled={cargandoStatus}
              className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              {cargandoStatus ? "Actualizando…" : "⟳ Refrescar"}
            </button>
          </div>
        </div>

        {/* KPIs */}
        <div className="relative mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Kpi
            etiqueta="Salas vinculadas"
            valor={metricas.vinculadas}
            total={salas.length}
            color="emerald"
          />
          <Kpi
            etiqueta="Grupos WA Conectados"
            valor={metricas.gruposConectados}
            total={metricas.grupos}
            color="sky"
          />
          <Kpi etiqueta="Salas pausadas" valor={metricas.pausadas} color="amber" />
          <Kpi
            etiqueta="Sin grupo"
            valor={metricas.sinGrupo < 0 ? 0 : metricas.sinGrupo}
            color="slate"
          />
        </div>
      </header>

      {/* ==================== CUERPO ==================== */}
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* ---------- Columna: conexión / QR ---------- */}
        <div className="space-y-4">
          <WhatsAppOperatorPanel
            grupo_id={grupoUsuarioId || gruposFiltroIds[0] || (gruposSistema[0]?.id ? String(gruposSistema[0].id) : "")}
          />

          {/* Acciones globales */}
          <div className="rounded-3xl border border-slate-200 bg-white p-4 text-slate-900 shadow-xl">
            <h3 className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
              Acciones globales
            </h3>
            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={desconectarTodas}
                disabled={ocupado || metricas.vinculadas === 0}
                className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-[11px] font-black text-rose-200 transition hover:bg-rose-900/50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ⏸ Desconectar todas las salas
              </button>
              <button
                type="button"
                onClick={reconectarTodas}
                disabled={ocupado || metricas.pausadas === 0}
                className="rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-3 py-2 text-[11px] font-black text-emerald-800 transition hover:bg-emerald-900/50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ▶ Reconectar salas pausadas
              </button>
              <button
                type="button"
                onClick={refrescarGruposWhatsApp}
                disabled={ocupado}
                className="rounded-xl border border-sky-500/40 bg-sky-950/40 px-3 py-2 text-[11px] font-black text-sky-200 transition hover:bg-sky-900/50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {procesandoAccion === "refrescar-grupos" ? "Sincronizando…" : "🔄 Sincronizar Grupos de WhatsApp"}
              </button>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
              Desconectar pausa la sala sin salir del grupo: el bot deja de publicar ahí y el
              grupo queda guardado para reconectarlo cuando quieras.
            </p>
          </div>
        </div>

        {/* ---------- Columna: salas ---------- */}
        <div className="space-y-4 lg:col-span-2">
          {/* Selector de Grupo del Sistema + Agregar Sala (máx. 2 por grupo) */}
          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
                <span className="text-xs font-black text-slate-700 shrink-0 mr-1">Grupo:</span>
                {esSuperAdmin && (
                  <button
                    type="button"
                    onClick={() => setGruposFiltroIds([])}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-black transition ${
                      gruposFiltroIds.length === 0
                        ? "border-emerald-500 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-500/40 shadow-sm"
                        : "border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-200 hover:text-slate-200"
                    }`}
                  >
                    <span>🗂️</span>
                    <span>Todos ({gruposSistema.length})</span>
                  </button>
                )}
                {gruposSistema.map((g) => {
                  const seleccionado = gruposFiltroIds.includes(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => toggleGrupoFiltro(g.id)}
                      className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-[11px] font-bold transition ${
                        seleccionado
                          ? "border-emerald-500 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-500/40 shadow-sm font-black"
                          : "border-slate-200 bg-slate-50 text-slate-500 hover:border-slate-200 hover:text-slate-200"
                      }`}
                    >
                      {seleccionado && <span className="text-[10px] text-emerald-700 font-black">✓</span>}
                      <span>{g.nombre}</span>
                    </button>
                  );
                })}
              </div>
              {gruposFiltroIds.length === 1 &&
                salas.filter((s) => s.grupo_id === gruposFiltroIds[0]).length < 2 && (
                  <button
                    type="button"
                    onClick={() => void agregarSalaAlGrupo(gruposFiltroIds[0])}
                    disabled={ocupado}
                    className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-black text-white shadow transition hover:bg-emerald-500 disabled:opacity-40 shrink-0"
                  >
                    {procesandoAccion === "crear-sala" ? "Creando…" : "+ Agregar Sala (máx. 2)"}
                  </button>
                )}
            </div>
          </div>

          {salas.filter((s) => gruposFiltroIds.length === 0 || (s.grupo_id && gruposFiltroIds.includes(String(s.grupo_id)))).length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-10 text-center text-slate-500">
              <p className="text-2xl">🏇</p>
              <p className="mt-2 text-sm font-bold text-slate-200">
                No hay salas de juego activas
              </p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed">
                Crea o activa una sala desde el botón &quot;+ Agregar Sala&quot; para poder vincularle grupos de WhatsApp.
              </p>
            </div>
          ) : (
            salas
              .filter((s) => gruposFiltroIds.length === 0 || (s.grupo_id && gruposFiltroIds.includes(String(s.grupo_id))))
              .map((sala, index) => {
              const vinculosEstaSala = vinculosPorSala[sala.id] || sala.grupos_whatsapp || [];
              const primerVinculo = vinculosEstaSala[0];
              const jidEfectivo = sala.whatsapp_group_jid || primerVinculo?.whatsapp_group_jid || "";
              const respaldo = respaldoLocal[sala.id] || {};
              const nombreEfectivo =
                nombreGrupo(jidEfectivo, salas, status.grupos, respaldoLocal, sala.id) ||
                primerVinculo?.whatsapp_group_nombre ||
                sala.whatsapp_group_nombre ||
                respaldo.groupNombre ||
                null;
              const vinculada = Boolean(jidEfectivo) || vinculosEstaSala.length > 0;
              const pausada = !vinculada && Boolean(respaldo.groupJid);
              const jidActual = seleccionGrupoPorSala[sala.id] || jidEfectivo || "";
              const pizarraValor = pizarraPorSala[sala.id] ?? "";
              const estado = String(sala.estado_carrera || "abierta").toLowerCase();
              const abierta = estado === "abierta";
              const jidParaPing = jidEfectivo || primerVinculo?.whatsapp_group_jid || "";

              return (
                <article
                  key={sala.id}
                  className="min-w-0 overflow-hidden rounded-3xl border border-slate-200 bg-white p-4 text-slate-900 shadow-xl transition hover:border-slate-200 sm:p-5"
                >
                  {/* Cabecera de la sala */}
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200/80 pb-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-700">
                          {tituloCorto(sala, index)}
                        </span>
                        <h3 className="truncate text-sm font-black text-slate-900">
                          {sala.nombre_sala || `Sala ${index + 1}`}
                        </h3>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {sala.grupo_nombre ? (
                          <span className="font-bold text-sky-300">Grupo: {sala.grupo_nombre} · </span>
                        ) : null}
                        {sala.hipodromo_activo || "Sin hipódromo"} · Carrera #
                        {sala.numero_carrera_activa || 1}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <a
                        href={sala.grupo_id ? `/sala?grupoId=${sala.grupo_id}` : "/sala"}
                        className="rounded-full border border-indigo-500/40 bg-indigo-950/60 px-2.5 py-0.5 text-[10px] font-black text-indigo-200 transition hover:bg-indigo-900"
                        title="Abrir la Sala de Juegos en vivo de este grupo"
                      >
                        🎮 Ver Sala de Juegos
                      </a>
                      <a
                        href={sala.grupo_id ? `/sala?ui=whatsapp&grupoId=${sala.grupo_id}` : "/sala?ui=whatsapp"}
                        className="rounded-full border border-emerald-500/40 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-black text-emerald-800 transition hover:bg-emerald-900"
                        title="Abrir la vista tipo WhatsApp Web de este grupo"
                      >
                        📱 Sala WhatsApp
                      </a>
                      <button
                        type="button"
                        onClick={() => abrirConfigSala(sala)}
                        className="rounded-full border border-sky-500/40 bg-sky-950/60 px-2.5 py-0.5 text-[10px] font-black text-sky-200 transition hover:bg-sky-900"
                        title="Configurar y gestionar grupos de esta sala"
                      >
                        ⚙️ Configurar
                      </button>
                      <button
                        type="button"
                        onClick={() => void eliminarSalaDelGrupo(sala.id)}
                        disabled={ocupado}
                        className="rounded-full border border-rose-500/40 bg-rose-950/60 px-2.5 py-0.5 text-[10px] font-black text-rose-200 transition hover:bg-rose-900 disabled:opacity-40"
                        title="Eliminar esta sala del grupo"
                      >
                        🗑️ Eliminar
                      </button>
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase ${
                          abierta
                            ? "border-emerald-600/50 bg-emerald-950 text-emerald-700"
                            : "border-amber-600/50 bg-amber-950 text-amber-300"
                        }`}
                      >
                        ● {abierta ? "Carrera abierta" : "Carrera cerrada"}
                      </span>
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase ${
                          vinculada
                            ? "border-sky-500/50 bg-sky-950 text-sky-300"
                            : pausada
                            ? "border-amber-500/50 bg-amber-950 text-amber-300"
                            : "border-slate-200 bg-slate-50 text-slate-500"
                        }`}
                      >
                        {vinculada ? "Grupo vinculado" : pausada ? "Pausada" : "Sin grupo"}
                      </span>
                    </div>
                  </div>

                  {/* Estado del grupo + acciones de conexión */}
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/50 p-3">
                    {/* Indicador de conexión en vivo con pulso y socket ping */}
                    <div className={`mb-3 rounded-xl border p-2.5 transition-all ${
                      vinculada
                        ? "border-emerald-500/40 bg-gradient-to-r from-emerald-50/40 to-slate-900/60 shadow-md shadow-emerald-950/20"
                        : pausada
                        ? "border-amber-500/30 bg-amber-950/20"
                        : "border-slate-200 bg-slate-50"
                    }`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="relative flex h-2.5 w-2.5">
                            {vinculada && (
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                            )}
                            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                              vinculada ? "bg-emerald-500" : pausada ? "bg-amber-400" : "bg-slate-300"
                            }`}></span>
                          </span>
                          <span className={`text-[11px] font-black tracking-wide uppercase ${
                            vinculada ? "text-emerald-700" : pausada ? "text-amber-300" : "text-slate-500"
                          }`}>
                            {vinculada ? "🟢 ENLAZADO Y ESCUCHANDO EN VIVO" : pausada ? "⏸ PAUSADA (Desconectada temporalmente)" : "⚪ SIN GRUPO ENLAZADO"}
                          </span>
                        </div>

                        {vinculada && jidParaPing && (
                          <div className="flex items-center gap-2">
                            {pingPorSala[sala.id] ? (
                              <span className={`font-mono text-[10px] font-black ${
                                pingPorSala[sala.id].conectado ? "text-emerald-700" : "text-rose-400"
                              }`}>
                                ⚡ {pingPorSala[sala.id].latenciaMs}ms
                                {pingPorSala[sala.id].participantes ? ` (${pingPorSala[sala.id].participantes} miembros)` : ""}
                              </span>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => probarPingGrupo(sala.id, jidParaPing)}
                              disabled={ocupado || haciendoPing[sala.id]}
                              className="rounded-lg border border-emerald-500/50 bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-800 transition hover:bg-emerald-900 disabled:opacity-50"
                              title="Probar latencia y socket en vivo con este grupo de WhatsApp"
                            >
                              {haciendoPing[sala.id] ? "Midiendo…" : "⚡ Ping Socket"}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          Grupo de WhatsApp
                        </p>
                        {vinculada ? (
                          <div className="space-y-0.5">
                            <p className="truncate text-xs font-bold text-emerald-700">
                              {nombreEfectivo || "Grupo vinculado"}
                              <span className="ml-1 font-mono text-[10px] font-normal text-slate-500">
                                {jidEfectivo}
                              </span>
                            </p>
                            {vinculosEstaSala.length > 0 && (
                              <p className="text-[10px] text-emerald-700/90 font-semibold">
                                ✓ {vinculosEstaSala.length} {vinculosEstaSala.length === 1 ? "grupo verificado y activo" : "grupos verificados y activos"} en esta sala
                              </p>
                            )}
                          </div>
                        ) : pausada ? (
                          <p className="truncate text-xs font-bold text-amber-300">
                            Desconectado · guardado{" "}
                            {respaldo.groupNombre ? `("${respaldo.groupNombre}")` : ""}
                          </p>
                        ) : (
                          <p className="text-xs font-bold text-slate-500">
                            Sin grupo asignado a esta sala
                          </p>
                        )}
                      </div>

                      {vinculada ? (
                        <button
                          type="button"
                          onClick={() => desconectarSala(sala)}
                          disabled={ocupado}
                          className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 py-1.5 text-[11px] font-black text-rose-200 transition hover:bg-rose-900/50 disabled:cursor-not-allowed disabled:opacity-40"
                          title="Pausa la sala: el bot deja de publicar en este grupo"
                        >
                          {procesandoAccion === `desconectar-${sala.id}`
                            ? "Desconectando…"
                            : "⏸ Desconectar grupo"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => reconectarSala(sala)}
                          disabled={ocupado || !jidActual}
                          className="rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-3 py-1.5 text-[11px] font-black text-emerald-800 transition hover:bg-emerald-900/50 disabled:cursor-not-allowed disabled:opacity-40"
                          title="Restaura el grupo guardado y el bot vuelve a publicar"
                        >
                          {procesandoAccion === `reconectar-${sala.id}`
                            ? "Reconectando…"
                            : "▶ Volver a conectar"}
                        </button>
                      )}
                    </div>

                    {/* Selector de grupo */}
                    {status.grupos.length > 6 && (
                      <div className="mt-2">
                        <input
                          type="text"
                          value={filtroGrupo}
                          onChange={(e) => setFiltroGrupo(e.target.value)}
                          placeholder="🔍 Filtrar grupo por nombre..."
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] text-slate-900 placeholder-slate-500 outline-none focus:border-emerald-500"
                        />
                      </div>
                    )}
                    <div className="mt-2 space-y-2">
                      <div className="grid max-h-44 grid-cols-1 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                        {status.grupos
                          .filter(
                            (g) =>
                              !filtroGrupo.trim() ||
                              g.jid === jidActual ||
                              g.nombre.toLowerCase().includes(filtroGrupo.trim().toLowerCase())
                          )
                          .map((g) => {
                            const conectado = Boolean(g.conectado);
                            const esEstaSala =
                              vinculosEstaSala.some((v) => v.whatsapp_group_jid === g.jid) ||
                              g.jid === jidEfectivo;
                            const ocupadoOtraSala = conectado && !esEstaSala;
                            const seleccionado = jidActual === g.jid;

                            return (
                              <div
                                key={g.jid}
                                className={`flex items-center justify-between gap-2 rounded-xl border px-2.5 py-2 transition ${
                                  esEstaSala
                                    ? "border-emerald-500/60 bg-emerald-950/50"
                                    : seleccionado
                                    ? "border-sky-500/60 bg-sky-950/40"
                                    : ocupadoOtraSala
                                    ? "border-slate-200/80 bg-slate-50 opacity-55"
                                    : "border-slate-200 bg-white hover:border-slate-200"
                                }`}
                              >
                                <button
                                  type="button"
                                  disabled={ocupado || ocupadoOtraSala}
                                  onClick={() => {
                                    setSeleccionGrupoPorSala((prev) => ({
                                      ...prev,
                                      [sala.id]: g.jid,
                                    }));
                                  }}
                                  className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-not-allowed"
                                  title={
                                    ocupadoOtraSala
                                      ? `Ocupado por ${g.salaNombre || "otra sala"} (Regla 1 a 1)`
                                      : `Seleccionar ${g.nombre}`
                                  }
                                >
                                  <span
                                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border text-xs ${
                                      esEstaSala
                                        ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-700"
                                        : seleccionado
                                        ? "border-sky-400/60 bg-sky-500/20 text-sky-300"
                                        : "border-slate-200 bg-slate-50 text-slate-700"
                                    }`}
                                  >
                                    {esEstaSala ? "🟢" : ocupadoOtraSala ? "🔒" : "💬"}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[11px] font-black text-slate-900">
                                      {g.nombre}
                                    </span>
                                    <span className="block truncate text-[9px] text-slate-500">
                                      {esEstaSala
                                        ? "Conectado a esta sala"
                                        : ocupadoOtraSala
                                        ? `En ${g.salaNombre || "otra sala"}`
                                        : "Disponible"}
                                    </span>
                                  </span>
                                </button>

                                {esEstaSala ? (
                                  <button
                                    type="button"
                                    disabled={ocupado}
                                    onClick={() =>
                                      void desvincularMultiGrupo(undefined, sala.id, g.jid)
                                    }
                                    className="shrink-0 rounded-lg border border-rose-500/40 bg-rose-950/60 px-2 py-1 text-[10px] font-black text-rose-200 hover:bg-rose-900/70"
                                  >
                                    Desconectar
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={ocupado || ocupadoOtraSala}
                                    onClick={() => void vincularMultiGrupo(sala, g.jid)}
                                    className="shrink-0 rounded-lg bg-emerald-600 px-2 py-1 text-[10px] font-black text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    {procesandoAccion === `vincular-multi-${sala.id}`
                                      ? "…"
                                      : "Conectar"}
                                  </button>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    </div>

                    {(vinculosPorSala[sala.id] || []).length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {(vinculosPorSala[sala.id] || []).map((v) => (
                          <span
                            key={v.id || v.whatsapp_group_jid}
                            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-800"
                          >
                            <span>🟢 {v.whatsapp_group_nombre || v.whatsapp_group_jid}</span>
                            <button
                              type="button"
                              onClick={() => void desvincularMultiGrupo(v.id, sala.id, v.whatsapp_group_jid)}
                              disabled={ocupado}
                              className="ml-0.5 rounded-full px-1 text-rose-300 hover:bg-rose-900/60 hover:text-slate-900"
                              title="Desvincular este grupo"
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    {status.grupos.length === 0 && (
                      <p className="mt-2 text-[10px] leading-relaxed text-amber-300/80">
                        El bot aún no detecta grupos. Verifica que la sesión esté conectada y que
                        la cuenta esté dentro de los grupos.
                      </p>
                    )}
                  </div>

                  {/* Control de carrera */}
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        🏇 Carrera en curso
                      </span>
                      <span className="text-[10px] text-slate-500">
                        Atajos en WhatsApp:{" "}
                        <code className="font-mono text-emerald-700">!abrir hipódromo #</code> y{" "}
                        <code className="font-mono text-amber-400">!cerrar</code>
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                      <input
                        type="text"
                        value={
                          hipodromoPorSala[sala.id] ?? sala.hipodromo_activo ?? "LA RINCONADA"
                        }
                        onChange={(e) =>
                          setHipodromoPorSala((prev) => ({ ...prev, [sala.id]: e.target.value }))
                        }
                        placeholder="Hipódromo"
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold uppercase text-slate-900 outline-none transition focus:border-emerald-500 sm:col-span-2"
                        aria-label={`Hipódromo de ${sala.nombre_sala}`}
                      />
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={carreraPorSala[sala.id] ?? sala.numero_carrera_activa ?? 1}
                        onChange={(e) =>
                          setCarreraPorSala((prev) => ({ ...prev, [sala.id]: e.target.value }))
                        }
                        placeholder="Carrera #"
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-emerald-700 outline-none transition focus:border-emerald-500"
                        aria-label={`Número de carrera de ${sala.nombre_sala}`}
                      />
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => abrirCarrera(sala)}
                          disabled={ocupado}
                          className="flex-1 rounded-xl bg-emerald-600 px-2 py-2 text-[11px] font-black text-white shadow transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                          title="Abrir carrera y anunciar en WhatsApp"
                        >
                          {procesandoAccion === `abrir-${sala.id}` ? "…" : "🟢 Abrir"}
                        </button>
                        <button
                          type="button"
                          onClick={() => cerrarCarrera(sala)}
                          disabled={ocupado}
                          className="flex-1 rounded-xl bg-amber-600 px-2 py-2 text-[11px] font-black text-slate-900 shadow transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
                          title="Cerrar carrera y anunciar en WhatsApp"
                        >
                          {procesandoAccion === `cerrar-${sala.id}` ? "…" : "🔒 Cerrar"}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Publicaciones */}
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                    <div className="flex flex-col justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <span className="text-[11px] leading-relaxed text-slate-500">
                        Lista numerada de tickets activos de la carrera.
                      </span>
                      <button
                        type="button"
                        onClick={() => publicarPlanoJugadas(sala)}
                        disabled={ocupado}
                        className="w-full rounded-xl bg-indigo-600 px-3 py-2 text-[11px] font-black text-white shadow transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {procesandoAccion === `plano-${sala.id}`
                          ? "Publicando…"
                          : "📋 Publicar Plano de Jugadas"}
                      </button>
                    </div>

                    <div className="flex flex-col justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <input
                        type="text"
                        value={pizarraValor}
                        onChange={(e) =>
                          setPizarraPorSala((prev) => ({ ...prev, [sala.id]: e.target.value }))
                        }
                        placeholder="LLEGADA ej: 10.5.1.2.7"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs font-bold text-emerald-700 outline-none transition placeholder:text-slate-600 focus:border-emerald-500"
                        aria-label={`Orden de llegada de ${sala.nombre_sala}`}
                      />
                      <button
                        type="button"
                        onClick={() => publicarSentenciaPizarra(sala)}
                        disabled={ocupado}
                        className="w-full rounded-xl bg-emerald-600 px-3 py-2 text-[11px] font-black text-white shadow transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {procesandoAccion === `sentencia-${sala.id}`
                          ? "Liquidando…"
                          : "🏁 Publicar Llegada / Pizarra"}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>

      {/* ==================== DIRECTORIO DE ESTADO DE GRUPOS DE WHATSAPP ==================== */}
      <section className="rounded-3xl border border-slate-200 bg-white p-5 text-slate-900 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-500/15 text-lg ring-1 ring-emerald-500/30">
              📊
            </span>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-emerald-700">
                Directorio y Estado de Conexión de Grupos de WhatsApp
              </h3>
              <p className="text-[11px] text-slate-500">
                Visualiza de inmediato cuáles grupos de WhatsApp están conectados a la plataforma y cuáles están disponibles.
              </p>
            </div>
          </div>

          {/* Filtros: Todos / Conectados / Disponibles */}
          <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-xl border border-slate-200 text-xs">
            <button
              type="button"
              onClick={() => setFiltroEstadoGrupo("todos")}
              className={`px-3 py-1 rounded-lg font-bold transition ${
                filtroEstadoGrupo === "todos"
                  ? "bg-slate-100 text-slate-900 shadow"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              Todos ({status.grupos.length})
            </button>
            <button
              type="button"
              onClick={() => setFiltroEstadoGrupo("conectados")}
              className={`px-3 py-1 rounded-lg font-bold transition ${
                filtroEstadoGrupo === "conectados"
                  ? "bg-emerald-950 border border-emerald-500/40 text-emerald-700"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              🟢 Conectados ({(status.grupos || []).filter((g) => g.conectado).length})
            </button>
            <button
              type="button"
              onClick={() => setFiltroEstadoGrupo("desconectados")}
              className={`px-3 py-1 rounded-lg font-bold transition ${
                filtroEstadoGrupo === "desconectados"
                  ? "bg-slate-100 text-slate-200"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              ⚪ Disponibles ({(status.grupos || []).filter((g) => !g.conectado).length})
            </button>
          </div>
        </div>

        {/* Buscador de grupos */}
        <div className="mt-3">
          <input
            type="text"
            value={filtroGrupoDirectorio}
            onChange={(e) => setFiltroGrupoDirectorio(e.target.value)}
            placeholder="🔍 Buscar grupo en el directorio por nombre o JID..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs text-slate-900 placeholder-slate-500 outline-none focus:border-emerald-500"
          />
        </div>

        {/* Lista de grupos en tarjeta tipo grid */}
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-96 overflow-y-auto pr-1">
          {gruposDirectorioFiltrados.length === 0 ? (
            <div className="col-span-full py-8 text-center text-xs text-slate-500 italic">
              No hay grupos de WhatsApp que coincidan con el filtro.
            </div>
          ) : (
            gruposDirectorioFiltrados.map((g) => {
              const estaConectado = Boolean(g.conectado);
              const seleccionadoDifusion = gruposDifusionSeleccionados.includes(g.jid);
              return (
                <div
                  key={g.jid}
                  className={`p-3 rounded-2xl border transition-all ${
                    seleccionadoDifusion
                      ? "border-sky-400/70 bg-gradient-to-br from-sky-950/50 to-slate-900/80 ring-1 ring-sky-400/40"
                      : estaConectado
                      ? "border-emerald-500/30 bg-gradient-to-br from-emerald-50/30 to-slate-900/60 shadow-sm shadow-emerald-950/20"
                      : "border-slate-200 bg-slate-50 hover:border-slate-200"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-start gap-2">
                      {esSuperAdmin && (
                        <button
                          type="button"
                          onClick={() => toggleGrupoDifusion(g.jid)}
                          title={
                            seleccionadoDifusion
                              ? "Quitar de selección para difusión"
                              : "Seleccionar grupo para difusión"
                          }
                          className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl border text-sm transition ${
                            seleccionadoDifusion
                              ? "border-sky-400 bg-sky-500/25 text-sky-200 shadow"
                              : "border-slate-200 bg-white text-slate-500 hover:border-sky-500/60 hover:text-sky-300"
                          }`}
                        >
                          {seleccionadoDifusion ? "☑️" : "💬"}
                        </button>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`h-2 w-2 rounded-full shrink-0 ${
                              estaConectado ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
                            }`}
                          />
                          <h4 className="truncate text-xs font-black text-slate-900" title={g.nombre}>
                            {g.nombre}
                          </h4>
                        </div>
                        <p className="mt-0.5 truncate font-mono text-[9px] text-slate-500" title={g.jid}>
                          {g.jid}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase shrink-0 border ${
                        estaConectado
                          ? "border-emerald-500/50 bg-emerald-950 text-emerald-700"
                          : "border-slate-200 bg-slate-100 text-slate-500"
                      }`}
                    >
                      {estaConectado ? "🟢 Conectado" : "⚪ Disponible"}
                    </span>
                  </div>

                  {estaConectado ? (
                    <div className="mt-2 text-[10px] bg-white rounded-xl p-2 border border-slate-200/80 space-y-1">
                      <div className="flex items-center justify-between text-slate-500">
                        <span>Sala vinculada:</span>
                        <span className="font-bold text-emerald-700">{g.salaNombre || "Sala"}</span>
                      </div>
                      {g.grupoNombre ? (
                        <div className="flex items-center justify-between text-slate-500">
                          <span>Grupo del sistema:</span>
                          <span className="font-bold text-sky-300">{g.grupoNombre}</span>
                        </div>
                      ) : null}
                      <div className="pt-1 flex items-center justify-end">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            desvincularGrupoDirecto(g.jid, g.nombre);
                          }}
                          disabled={procesandoAccion === `desvincular-dir-${g.jid}`}
                          className="px-2 py-0.5 bg-rose-950/70 hover:bg-rose-900 border border-rose-800/70 text-rose-300 text-[10px] font-bold rounded-lg transition-colors flex items-center gap-1 shadow-sm disabled:opacity-50"
                        >
                          {procesandoAccion === `desvincular-dir-${g.jid}` ? "⏳ Desconectando..." : "🔌 Desconectar Grupo"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-[10px] text-slate-500 italic bg-slate-300 rounded-xl p-2 border border-slate-200/40">
                      Grupo detectado en WhatsApp pero no vinculado a ninguna sala activa
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Difusión Multimedia (Super Admin) + Limpiador por Rango de Fechas */}
        <div className="mt-4 grid grid-cols-1 gap-4 border-t border-slate-200 pt-4 lg:grid-cols-2">
          {esSuperAdmin && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-sky-300">
                    📣 Difusión Multimedia a Grupos Seleccionados ({gruposDifusionSeleccionados.length})
                  </h4>
                  <p className="text-[10px] text-slate-500">
                    Haz clic en el ícono 💬/☑️ de 1 o varios grupos arriba para enviar Texto, Imagen o Nota de Voz.
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setGruposDifusionSeleccionados(gruposDirectorioFiltrados.map((g) => g.jid))
                    }
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-700 hover:border-sky-500"
                  >
                    Todos
                  </button>
                  <button
                    type="button"
                    onClick={() => setGruposDifusionSeleccionados([])}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-500 hover:border-rose-500"
                  >
                    Limpiar
                  </button>
                </div>
              </div>

              <div className="flex gap-1.5">
                {(["TEXTO", "IMAGEN", "NOTA_VOZ"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTipoDifusion(t)}
                    className={`rounded-xl border px-3 py-1.5 text-[11px] font-black transition ${
                      tipoDifusion === t
                        ? "border-sky-400 bg-sky-950/70 text-sky-200"
                        : "border-slate-200 bg-white text-slate-500 hover:text-slate-900"
                    }`}
                  >
                    {t === "TEXTO" ? "📝 Texto" : t === "IMAGEN" ? "🖼️ Imagen" : "🎙️ Nota de Voz"}
                  </button>
                ))}
              </div>

              {tipoDifusion !== "NOTA_VOZ" && (
                <textarea
                  rows={2}
                  value={textoDifusion}
                  onChange={(e) => setTextoDifusion(e.target.value)}
                  placeholder={
                    tipoDifusion === "IMAGEN"
                      ? "Descripción / pie de foto opcional..."
                      : "Escribe el mensaje a difundir..."
                  }
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 placeholder-slate-500 outline-none focus:border-sky-500"
                />
              )}

              {(tipoDifusion === "IMAGEN" || tipoDifusion === "NOTA_VOZ") && (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="file"
                    accept={tipoDifusion === "IMAGEN" ? "image/*" : "audio/*"}
                    onChange={cargarArchivoDifusion}
                    className="text-[11px] text-slate-700 file:mr-2 file:rounded-lg file:border-0 file:bg-sky-600 file:px-3 file:py-1 file:text-[11px] file:font-black file:text-slate-900 hover:file:bg-sky-500"
                  />
                  {mediaNombre && (
                    <span className="text-[10px] font-bold text-emerald-700">📎 {mediaNombre}</span>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={enviarDifusionMultimedia}
                disabled={ocupado || gruposDifusionSeleccionados.length === 0}
                className="w-full rounded-xl bg-sky-600 px-4 py-2 text-xs font-black text-slate-900 shadow transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {procesandoAccion === "difundir-multimedia"
                  ? "Enviando difusión…"
                  : `🚀 Enviar ${tipoDifusion} a ${gruposDifusionSeleccionados.length} grupo(s)`}
              </button>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
            <div>
              <h4 className="text-xs font-black uppercase tracking-wider text-amber-300">
                🧹 Limpiador de Multimedia por Rango de Fechas
              </h4>
              <p className="text-[10px] text-slate-500">
                Elimina imágenes y notas de voz antiguas de WhatsApp para liberar espacio en base de datos.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Desde</label>
                <input
                  type="date"
                  value={fechaLimpiezaInicio}
                  onChange={(e) => setFechaLimpiezaInicio(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Hasta</label>
                <input
                  type="date"
                  value={fechaLimpiezaFin}
                  onChange={(e) => setFechaLimpiezaFin(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-amber-500"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={limpiarMultimediaPorFechas}
              disabled={ocupado}
              className="w-full rounded-xl border border-amber-500/40 bg-amber-950/60 px-4 py-2 text-xs font-black text-amber-200 transition hover:bg-amber-900/70 disabled:opacity-40"
            >
              {procesandoAccion === "limpiar-multimedia"
                ? "Limpiando…"
                : "🗑️ Limpiar Imágenes y Audios"}
            </button>
          </div>
        </div>
      </section>

      {/* ==================== COMANDOS ==================== */}
      <section className="rounded-3xl border border-slate-200 bg-white p-5 text-slate-900 shadow-xl">
        <h3 className="mb-3 text-[11px] font-black uppercase tracking-[0.14em] text-emerald-700">
          ⚡ Comandos directos del operador dentro del grupo
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Comando
            codigo="!abrir [hipódromo] [#]"
            color="text-emerald-700"
            descripcion={
              <>
                Abre la carrera y la anuncia. Ej:{" "}
                <code className="text-slate-900">!abrir La Rinconada 1</code>.
              </>
            }
          />
          <Comando
            codigo="!cerrar"
            color="text-rose-300"
            descripcion="Cierra la carrera y bloquea nuevas jugadas."
          />
          <Comando
            codigo="LLEGADA: 10.5.1.2.7"
            color="text-indigo-300"
            descripcion="Liquida la carrera, actualiza saldos y publica positivos/negativos."
          />
          <Comando
            codigo="!plano / !anular"
            color="text-amber-300"
            descripcion="Publica el plano numerado o anula tickets y retirados en vivo."
          />
        </div>
      </section>

      {/* ==================== TOAST NO BLOQUEANTE ==================== */}
      {feedback && (
        <div className="fixed inset-x-3 bottom-3 z-50 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[420px]">
          <div
            role="status"
            className={`rounded-2xl border p-4 text-xs shadow-2xl backdrop-blur ${
              feedback.tipo === "ok"
                ? "border-emerald-500/50 bg-emerald-50 text-emerald-50"
                : feedback.tipo === "error"
                ? "border-rose-500/50 bg-rose-950/90 text-rose-50"
                : "border-slate-200 bg-slate-50/95 text-slate-100"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="font-black leading-snug">{feedback.texto}</p>
              <button
                type="button"
                onClick={() => setFeedback(null)}
                className="shrink-0 rounded-lg border border-white/10 px-1.5 py-0.5 text-[11px] font-bold opacity-70 transition hover:opacity-100"
                aria-label="Cerrar aviso"
              >
                ✕
              </button>
            </div>
            {feedback.detalle && (
              <details className="mt-2 rounded-xl border border-black/30 bg-slate-100 p-2">
                <summary className="cursor-pointer text-[11px] font-bold opacity-80">
                  Ver mensaje enviado
                </summary>
                <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed opacity-90">
                  {feedback.detalle}
                </pre>
              </details>
            )}
          </div>
        </div>
      )}

      {/* Modal de Configuración de Sala */}
      {salaConfigurando && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-slate-50 p-3 py-5 backdrop-blur-sm sm:items-center">
          <div className="flex max-h-[calc(100dvh-2.5rem)] w-full max-w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl sm:max-w-2xl">
            <div className="flex shrink-0 flex-wrap items-start justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-sky-700">
                  Configuración de Sala
                </span>
                <h3 className="mt-1 text-base font-black text-slate-900 sm:text-lg">
                  {salaConfigurando.nombre_sala || "Sala de Juegos"}
                </h3>
                <p className="text-xs text-slate-500">
                  ID: <span className="font-mono text-[11px]">{salaConfigurando.id}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSalaConfigurando(null)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100"
              >
                ✕ Cerrar
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
              {/* Grupos de WhatsApp Vinculados a esta sala */}
              <div className="w-full max-w-full overflow-hidden">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Grupos de WhatsApp Conectados
                </h4>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Todos los mensajes emitidos por el Bot o el Oficial en esta sala se difundirán a estos grupos.
                </p>

                <div className="mt-3 max-h-40 space-y-2 overflow-y-auto pr-1">
                  {(vinculosPorSala[salaConfigurando.id] || []).length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-xs text-slate-500">
                      No hay grupos de WhatsApp vinculados a esta sala.
                    </div>
                  ) : (
                    (vinculosPorSala[salaConfigurando.id] || []).map((v) => (
                      <div
                        key={v.id || v.whatsapp_group_jid}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1 pr-1">
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                            <span className="truncate text-xs font-black text-emerald-700">
                              {v.whatsapp_group_nombre || v.whatsapp_group_jid}
                            </span>
                          </div>
                          <p className="ml-4 truncate font-mono text-[10px] text-slate-500">
                            {v.whatsapp_group_jid}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void desvincularMultiGrupo(v.id, salaConfigurando.id, v.whatsapp_group_jid)}
                          disabled={ocupado}
                          className="shrink-0 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-[10px] font-black text-rose-700 transition hover:bg-rose-100 disabled:opacity-40"
                        >
                          Desvincular
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Vincular nuevo grupo a esta sala */}
              <div className="w-full max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  + Vincular otro grupo a esta sala
                </h4>
                <div className="mt-2.5 grid max-h-36 grid-cols-1 gap-1.5 overflow-y-auto pr-1 md:grid-cols-2">
                  {status.grupos
                    .filter(
                      (g) =>
                        !g.conectado &&
                        !(vinculosPorSala[salaConfigurando.id] || []).some(
                          (v) => v.whatsapp_group_jid === g.jid
                        )
                    )
                    .map((g) => {
                      const sel = grupoParaVincularEnModal === g.jid;
                      return (
                        <button
                          key={g.jid}
                          type="button"
                          disabled={ocupado}
                          onClick={() => {
                            setGrupoParaVincularEnModal(g.jid);
                            void vincularMultiGrupo(salaConfigurando, g.jid);
                          }}
                          className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-bold transition ${
                            sel
                              ? "border-emerald-400 bg-emerald-50 text-emerald-800"
                              : "border-slate-200 bg-white text-slate-800 hover:border-emerald-400"
                          }`}
                        >
                          <span>💬</span>
                          <span className="min-w-0 flex-1 truncate">{g.nombre}</span>
                          <span className="shrink-0 text-[10px] font-black text-emerald-600">Conectar</span>
                        </button>
                      );
                    })}
                </div>
              </div>

              {/* Parámetros de Reglas de Juego y Marcas */}
              <div className="w-full max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                    ⚙️ Parámetros de Juego y Liquidación
                  </h4>
                  <button
                    type="button"
                    onClick={() => void guardarParametrosSala()}
                    disabled={guardandoParametros}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-black text-white transition hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {guardandoParametros ? "Guardando…" : "💾 Guardar Parámetros"}
                  </button>
                </div>

                <div className="grid w-full grid-cols-1 gap-3 text-xs md:grid-cols-2">
                  <div className="min-w-0">
                    <label className="mb-1 block text-[11px] font-bold text-slate-600">
                      Apuesta Mínima ($)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      min="1"
                      value={confApuestaMin}
                      onChange={(e) => setConfApuestaMin(e.target.value)}
                      className="w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-mono text-slate-900 outline-none focus:border-emerald-500"
                    />
                    <p className="mt-0.5 text-[10px] text-slate-500">Mínimo para proponer o cruzar (def: 10.00)</p>
                  </div>

                  <div className="min-w-0">
                    <label className="mb-1 block text-[11px] font-bold text-slate-600">
                      Vencimiento Propuesta (minutos)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={confTiempoVenc}
                      onChange={(e) => setConfTiempoVenc(e.target.value)}
                      className="w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-mono text-slate-900 outline-none focus:border-emerald-500"
                    />
                    <p className="mt-0.5 text-[10px] text-slate-500">Minutos antes de expirar parada abierta (def: 5)</p>
                  </div>

                  <div className="min-w-0">
                    <label className="mb-1 block text-[11px] font-bold text-slate-600">
                      Tope Marcas Nacional (La Rinconada)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={confTopeNac}
                      onChange={(e) => setConfTopeNac(e.target.value)}
                      className="w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-mono text-slate-900 outline-none focus:border-emerald-500"
                    />
                    <p className="mt-0.5 text-[10px] text-slate-500">Lugares de pizarra evaluados (def: 5)</p>
                  </div>

                  <div className="min-w-0">
                    <label className="mb-1 block text-[11px] font-bold text-slate-600">
                      Tope Marcas Internacional (Americanas)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={confTopeInt}
                      onChange={(e) => setConfTopeInt(e.target.value)}
                      className="w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-mono text-slate-900 outline-none focus:border-emerald-500"
                    />
                    <p className="mt-0.5 text-[10px] text-slate-500">Lugares de pizarra evaluados (def: 4)</p>
                  </div>

                  <div className="min-w-0">
                    <label className="mb-1 block text-[11px] font-bold text-slate-600">
                      Comisión por Convenio (%)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="50"
                      value={confComision}
                      onChange={(e) => setConfComision(e.target.value)}
                      className="w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-1.5 font-mono text-slate-900 outline-none focus:border-emerald-500"
                    />
                    <p className="mt-0.5 text-[10px] text-slate-500">Se guarda en `grupos_venta` del grupo dueño de la sala.</p>
                  </div>

                  <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-2.5">
                    <p className="mb-2 text-[11px] font-bold text-slate-600">Permisos de Cruces (Tercios)</p>
                    <label className="flex cursor-pointer items-center gap-2 py-0.5 text-[11px] font-bold text-slate-700">
                      <input
                        type="checkbox"
                        checked={confCruceMismo}
                        onChange={(e) => setConfCruceMismo(e.target.checked)}
                        className="h-3.5 w-3.5 accent-emerald-600"
                      />
                      ⚡ Mismo ejemplar
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 py-0.5 text-[11px] font-bold text-slate-700">
                      <input
                        type="checkbox"
                        checked={confCruceDiferente}
                        onChange={(e) => setConfCruceDiferente(e.target.checked)}
                        className="h-3.5 w-3.5 accent-emerald-600"
                      />
                      🔀 Distinto ejemplar
                    </label>
                  </div>
                </div>
              </div>
            </div>

            {/* Zona de peligro: Eliminar Sala */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
              <button
                type="button"
                onClick={() => {
                  if (confirm(`¿Estás seguro de eliminar la sala "${salaConfigurando.nombre_sala}"?`)) {
                    void eliminarSalaDelGrupo(salaConfigurando.id);
                  }
                }}
                disabled={ocupado}
                className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-700 transition hover:bg-rose-100 disabled:opacity-40"
              >
                🗑️ Eliminar Sala
              </button>
              <button
                type="button"
                onClick={() => void guardarParametrosSala()}
                disabled={guardandoParametros}
                className="rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-black text-white transition hover:bg-emerald-500 disabled:opacity-50"
              >
                {guardandoParametros ? "Guardando…" : "💾 Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// COMPONENTES AUXILIARES
// ============================================================================

function Kpi({
  etiqueta,
  valor,
  total,
  color,
}: {
  etiqueta: string;
  valor: number;
  total?: number;
  color: "emerald" | "amber" | "slate" | "sky";
}) {
  const estilos: Record<typeof color, string> = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    sky: "border-sky-200 bg-sky-50 text-sky-700",
  };
  return (
    <div className={`rounded-2xl border px-3 py-2.5 ${estilos[color]}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">{etiqueta}</p>
      <p className="mt-0.5 text-lg font-black leading-none">
        {valor}
        {typeof total === "number" && (
          <span className="ml-1 text-[11px] font-bold opacity-60">/ {total}</span>
        )}
      </p>
    </div>
  );
}

function Comando({
  codigo,
  descripcion,
  color,
}: {
  codigo: string;
  descripcion: React.ReactNode;
  color: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <code className={`font-mono text-xs font-black ${color}`}>{codigo}</code>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{descripcion}</p>
    </div>
  );
}
