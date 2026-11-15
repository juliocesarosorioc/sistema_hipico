"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

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
  if (index === 0) return "Sala 1";
  if (index === 1) return "Sala 2";
  return `Sala ${index + 1}`;
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
  const [grupoFiltroId, setGrupoFiltroId] = useState<string>("");
  const [vinculosPorSala, setVinculosPorSala] = useState<Record<string, NonNullable<SalaJuego["grupos_whatsapp"]>>>({});
  const [vinculosGlobales, setVinculosGlobales] = useState<any[]>([]);
  const [filtroEstadoGrupo, setFiltroEstadoGrupo] = useState<"todos" | "conectados" | "desconectados">("todos");
  const [filtroGrupoDirectorio, setFiltroGrupoDirectorio] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [salaConfigurando, setSalaConfigurando] = useState<SalaJuego | null>(null);
  const [grupoParaVincularEnModal, setGrupoParaVincularEnModal] = useState<string>("");
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
      const targetGrupo = gId !== undefined ? gId : grupoFiltroId;
      const qs = targetGrupo ? `?grupoId=${encodeURIComponent(targetGrupo)}` : "";
      const res = await fetch(`/api/whatsapp-sala/salas-grupos${qs}`, { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      if (Array.isArray(json.gruposSistema)) {
        setGruposSistema(json.gruposSistema);
        if (!grupoFiltroId && !gId && json.gruposSistema.length > 0) {
          setGrupoFiltroId(json.gruposSistema[0].id);
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
  }, [grupoFiltroId]);

  useEffect(() => {
    consultarEstado(false);
    void cargarSalasGrupos();
    const timer = setInterval(() => {
      consultarEstado(true);
      void cargarSalasGrupos();
    }, 4000);
    return () => clearInterval(timer);
  }, [consultarEstado, cargarSalasGrupos]);

  const agregarSalaAlGrupo = async () => {
    const gId = grupoFiltroId || salas[0]?.grupo_id || gruposSistema[0]?.id;
    if (!gId) return;
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
        await Promise.all([consultarEstado(true), cargarSalasGrupos(gId)]);
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
      const gId = sala.grupo_id || grupoFiltroId;
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
        await Promise.all([consultarEstado(true), cargarSalasGrupos(grupoFiltroId)]);
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
      <header className="relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950/70 p-5 text-white shadow-2xl sm:p-6">
        <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-500/15 text-xl ring-1 ring-emerald-500/30">
                💬
              </span>
              <div>
                <h1 className="text-base font-black uppercase tracking-wide sm:text-lg">
                  Motor Bot de WhatsApp en Vivo
                  <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-black tracking-wider text-emerald-300 ring-1 ring-emerald-500/30">
                    Baileys 24/7
                  </span>
                </h1>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">
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
                  ? "border-emerald-500/40 bg-emerald-950/70 text-emerald-300"
                  : "border-amber-500/40 bg-amber-950/60 text-amber-300"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  status.conectado ? "bg-emerald-400" : "bg-amber-400 animate-pulse"
                }`}
              />
              {status.conectado
                ? `Conectado${status.numeroVinculado ? ` · +${status.numeroVinculado}` : ""}`
                : status.qrDataUrl
                ? "Esperando escaneo QR"
                : "Bot desconectado"}
            </span>

            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold ${
                status.daemonOnline
                  ? "border-slate-700 bg-slate-900/80 text-slate-300"
                  : "border-rose-500/40 bg-rose-950/50 text-rose-300"
              }`}
              title="Demonio HTTP en el puerto 3005"
            >
              ⚙️ {status.daemonOnline ? "Demonio en línea" : "Demonio sin respuesta"}
            </span>

            <button
              type="button"
              onClick={() => consultarEstado(false)}
              disabled={cargandoStatus}
              className="rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-[11px] font-bold text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
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
          <div className="rounded-3xl border border-slate-800 bg-slate-950 p-5 text-white shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[11px] font-black uppercase tracking-[0.14em] text-emerald-400">
                Sesión de WhatsApp
              </h2>
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  status.conectado ? "bg-emerald-400" : "bg-amber-400 animate-pulse"
                }`}
              />
            </div>

            {status.conectado ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <div className="grid h-20 w-20 place-items-center rounded-full border-2 border-emerald-400/60 bg-emerald-500/15 text-3xl">
                  🟢
                </div>
                <p className="text-sm font-black text-emerald-400">Sesión activa 24/7</p>
                {status.numeroVinculado && (
                  <span className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-1 font-mono text-xs font-bold text-slate-200">
                    +{status.numeroVinculado}
                  </span>
                )}
                <p className="text-[11px] leading-relaxed text-slate-400">
                  El demonio mantiene la sesión persistente en{" "}
                  <code className="rounded bg-slate-900 px-1.5 py-0.5 text-emerald-300">
                    whatsapp_auth
                  </code>
                  . Si el servidor se reinicia, se reconecta solo.
                </p>
              </div>
            ) : status.qrDataUrl ? (
              <div className="flex flex-col items-center gap-3">
                <div className="rounded-2xl bg-white p-3 shadow-2xl">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={status.qrDataUrl}
                    alt="Código QR para vincular WhatsApp"
                    className="h-52 w-52 object-contain sm:h-56 sm:w-56"
                  />
                </div>
                <ol className="w-full space-y-1 rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-[11px] leading-relaxed text-slate-300">
                  <li>1. Abre WhatsApp en tu teléfono.</li>
                  <li>2. Entra en Dispositivos vinculados.</li>
                  <li>3. Toca Vincular un dispositivo y escanea el QR.</li>
                </ol>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <div className="grid h-12 w-12 place-items-center rounded-full border-2 border-dashed border-slate-600 text-xl">
                  📱
                </div>
                <p className="text-xs font-bold text-slate-300">
                  {status.daemonOnline
                    ? "Generando código QR desde Baileys…"
                    : "El demonio del bot no responde en el puerto 3005"}
                </p>
                <p className="max-w-xs text-[11px] leading-relaxed text-slate-500">
                  En el servidor ejecuta{" "}
                  <code className="text-emerald-400">pm2 restart bot-whatsapp</code> y vuelve a
                  cargar esta pantalla.
                </p>
              </div>
            )}
          </div>

          {/* Acciones globales */}
          <div className="rounded-3xl border border-slate-800 bg-slate-950 p-4 text-white shadow-xl">
            <h3 className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">
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
                className="rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-3 py-2 text-[11px] font-black text-emerald-200 transition hover:bg-emerald-900/50 disabled:cursor-not-allowed disabled:opacity-40"
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
          <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="text-xs font-black text-slate-300 shrink-0">Grupo:</span>
                <select
                  value={grupoFiltroId}
                  onChange={(e) => {
                    const val = e.target.value;
                    setGrupoFiltroId(val);
                    void cargarSalasGrupos(val);
                  }}
                  className="min-w-0 flex-1 max-w-xs rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-bold text-white outline-none focus:border-emerald-500"
                >
                  <option value="">Todos los grupos ({gruposSistema.length})</option>
                  {gruposSistema.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.conectado ? "🟢 " : "⚪ "}
                      {g.nombre} {g.conectado ? "(Conectado)" : "(Sin WhatsApp)"}
                    </option>
                  ))}
                </select>
              </div>
              {grupoFiltroId &&
                salas.filter((s) => !grupoFiltroId || s.grupo_id === grupoFiltroId).length < 2 && (
                  <button
                    type="button"
                    onClick={() => void agregarSalaAlGrupo()}
                    disabled={ocupado}
                    className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-black text-white shadow transition hover:bg-emerald-500 disabled:opacity-40"
                  >
                    {procesandoAccion === "crear-sala" ? "Creando…" : "+ Agregar Sala (máx. 2)"}
                  </button>
                )}
            </div>

            {/* Accesos rápidos de grupos del sistema con indicador en vivo */}
            {gruposSistema.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2.5 pt-2.5 border-t border-slate-800/80">
                <button
                  type="button"
                  onClick={() => {
                    setGrupoFiltroId("");
                    void cargarSalasGrupos("");
                  }}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-black transition ${
                    !grupoFiltroId
                      ? "bg-slate-800 text-white border border-slate-600 shadow-sm"
                      : "bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800"
                  }`}
                >
                  Todos ({gruposSistema.length})
                </button>
                {gruposSistema.map((g) => {
                  const seleccionado = grupoFiltroId === g.id;
                  const conectado = Boolean(g.conectado);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => {
                        setGrupoFiltroId(g.id);
                        void cargarSalasGrupos(g.id);
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-black transition border ${
                        seleccionado
                          ? "border-emerald-400 bg-emerald-950 text-white shadow-md shadow-emerald-950/40"
                          : conectado
                          ? "border-emerald-500/40 bg-slate-900 text-emerald-300 hover:bg-slate-800"
                          : "border-slate-800 bg-slate-900/60 text-slate-400 hover:bg-slate-800 hover:text-white"
                      }`}
                      title={conectado ? `Grupo ${g.nombre}: Conectado a WhatsApp (${g.salasConectadas || 1} sala activa)` : `Grupo ${g.nombre}: Sin WhatsApp conectado`}
                    >
                      <span className={`h-2 w-2 rounded-full shrink-0 ${conectado ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
                      <span>{g.nombre}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {salas.filter((s) => !grupoFiltroId || s.grupo_id === grupoFiltroId).length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-950/60 p-10 text-center text-slate-400">
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
              .filter((s) => !grupoFiltroId || s.grupo_id === grupoFiltroId)
              .slice(0, grupoFiltroId ? 2 : undefined)
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
                  className="min-w-0 overflow-hidden rounded-3xl border border-slate-800 bg-slate-950 p-4 text-white shadow-xl transition hover:border-slate-700 sm:p-5"
                >
                  {/* Cabecera de la sala */}
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800/80 pb-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-300">
                          {tituloCorto(sala, index)}
                        </span>
                        <h3 className="truncate text-sm font-black text-white">
                          {sala.nombre_sala || `Sala ${index + 1}`}
                        </h3>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-400">
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
                        className="rounded-full border border-emerald-500/40 bg-emerald-950/60 px-2.5 py-0.5 text-[10px] font-black text-emerald-200 transition hover:bg-emerald-900"
                        title="Abrir la vista tipo WhatsApp Web de este grupo"
                      >
                        📱 Sala WhatsApp
                      </a>
                      <button
                        type="button"
                        onClick={() => {
                          setSalaConfigurando(sala);
                          setGrupoParaVincularEnModal("");
                        }}
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
                            ? "border-emerald-600/50 bg-emerald-950 text-emerald-300"
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
                            : "border-slate-700 bg-slate-900 text-slate-400"
                        }`}
                      >
                        {vinculada ? "Grupo vinculado" : pausada ? "Pausada" : "Sin grupo"}
                      </span>
                    </div>
                  </div>

                  {/* Estado del grupo + acciones de conexión */}
                  <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-900/50 p-3">
                    {/* Indicador de conexión en vivo con pulso y socket ping */}
                    <div className={`mb-3 rounded-xl border p-2.5 transition-all ${
                      vinculada
                        ? "border-emerald-500/40 bg-gradient-to-r from-emerald-950/40 to-slate-900/60 shadow-md shadow-emerald-950/20"
                        : pausada
                        ? "border-amber-500/30 bg-amber-950/20"
                        : "border-slate-800 bg-slate-900/40"
                    }`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="relative flex h-2.5 w-2.5">
                            {vinculada && (
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                            )}
                            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                              vinculada ? "bg-emerald-500" : pausada ? "bg-amber-400" : "bg-slate-600"
                            }`}></span>
                          </span>
                          <span className={`text-[11px] font-black tracking-wide uppercase ${
                            vinculada ? "text-emerald-300" : pausada ? "text-amber-300" : "text-slate-400"
                          }`}>
                            {vinculada ? "🟢 ENLAZADO Y ESCUCHANDO EN VIVO" : pausada ? "⏸ PAUSADA (Desconectada temporalmente)" : "⚪ SIN GRUPO ENLAZADO"}
                          </span>
                        </div>

                        {vinculada && jidParaPing && (
                          <div className="flex items-center gap-2">
                            {pingPorSala[sala.id] ? (
                              <span className={`font-mono text-[10px] font-black ${
                                pingPorSala[sala.id].conectado ? "text-emerald-300" : "text-rose-400"
                              }`}>
                                ⚡ {pingPorSala[sala.id].latenciaMs}ms
                                {pingPorSala[sala.id].participantes ? ` (${pingPorSala[sala.id].participantes} miembros)` : ""}
                              </span>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => probarPingGrupo(sala.id, jidParaPing)}
                              disabled={ocupado || haciendoPing[sala.id]}
                              className="rounded-lg border border-emerald-500/50 bg-emerald-950/60 px-2 py-0.5 text-[10px] font-black text-emerald-200 transition hover:bg-emerald-900 disabled:opacity-50"
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
                            <p className="truncate text-xs font-bold text-emerald-300">
                              {nombreEfectivo || "Grupo vinculado"}
                              <span className="ml-1 font-mono text-[10px] font-normal text-slate-500">
                                {jidEfectivo}
                              </span>
                            </p>
                            {vinculosEstaSala.length > 0 && (
                              <p className="text-[10px] text-emerald-400/90 font-semibold">
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
                          <p className="text-xs font-bold text-slate-400">
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
                          className="rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-3 py-1.5 text-[11px] font-black text-emerald-200 transition hover:bg-emerald-900/50 disabled:cursor-not-allowed disabled:opacity-40"
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
                          className="w-full rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-1.5 text-[11px] text-white placeholder-slate-500 outline-none focus:border-emerald-500"
                        />
                      </div>
                    )}
                    <div className="mt-2 flex min-w-0 flex-col gap-2 sm:flex-row">
                      <select
                        value={jidActual}
                        onChange={(e) => {
                          const nuevo = e.target.value;
                          setSeleccionGrupoPorSala((prev) => ({
                            ...prev,
                            [sala.id]: nuevo,
                          }));
                        }}
                        disabled={ocupado}
                        className="w-full min-w-0 max-w-full flex-1 truncate rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-bold text-white outline-none transition focus:border-emerald-500 disabled:opacity-50"
                        aria-label={`Grupo de WhatsApp para ${sala.nombre_sala}`}
                      >
                        <option value="">— Seleccionar grupo de WhatsApp —</option>
                        {status.grupos
                          .filter(
                            (g) =>
                              !filtroGrupo.trim() ||
                              g.jid === jidActual ||
                              g.nombre.toLowerCase().includes(filtroGrupo.trim().toLowerCase())
                          )
                          .map((g) => {
                            const conectado = Boolean(g.conectado);
                            const esEstaSala = vinculosEstaSala.some(v => v.whatsapp_group_jid === g.jid) || g.jid === jidEfectivo;
                            const estadoTxt = conectado
                              ? esEstaSala
                                ? " · [🟢 Conectado a esta sala]"
                                : ` · [🟢 Conectado a ${g.salaNombre || 'otra sala'}${g.grupoNombre ? ` (${g.grupoNombre})` : ''}]`
                              : " · [⚪ Disponible]";
                            return (
                              <option key={g.jid} value={g.jid}>
                                {conectado ? "🟢 " : "⚪ "}
                                {g.nombre.length > 36 ? `${g.nombre.slice(0, 36)}…` : g.nombre}
                                {estadoTxt}
                              </option>
                            );
                          })}
                        {jidActual && !status.grupos.some((g) => g.jid === jidActual) && (
                          <option value={jidActual}>
                            Grupo guardado ({nombreEfectivo || jidActual})
                          </option>
                        )}
                      </select>

                      <button
                        type="button"
                        onClick={() => void vincularMultiGrupo(sala, jidActual)}
                        disabled={ocupado || !jidActual}
                        className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2 text-[11px] font-black text-white shadow transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {procesandoAccion === `vincular-multi-${sala.id}` ? "Verificando…" : "🔗 Verificar y Agregar"}
                      </button>
                    </div>

                    {(vinculosPorSala[sala.id] || []).length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {(vinculosPorSala[sala.id] || []).map((v) => (
                          <span
                            key={v.id || v.whatsapp_group_jid}
                            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-950/60 px-2.5 py-1 text-[10px] font-bold text-emerald-200"
                          >
                            <span>🟢 {v.whatsapp_group_nombre || v.whatsapp_group_jid}</span>
                            <button
                              type="button"
                              onClick={() => void desvincularMultiGrupo(v.id, sala.id, v.whatsapp_group_jid)}
                              disabled={ocupado}
                              className="ml-0.5 rounded-full px-1 text-rose-300 hover:bg-rose-900/60 hover:text-white"
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
                  <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        🏇 Carrera en curso
                      </span>
                      <span className="text-[10px] text-slate-500">
                        Atajos en WhatsApp:{" "}
                        <code className="font-mono text-emerald-400">!abrir hipódromo #</code> y{" "}
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
                        className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-bold uppercase text-white outline-none transition focus:border-emerald-500 sm:col-span-2"
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
                        className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-bold text-emerald-300 outline-none transition focus:border-emerald-500"
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
                          className="flex-1 rounded-xl bg-amber-600 px-2 py-2 text-[11px] font-black text-white shadow transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
                          title="Cerrar carrera y anunciar en WhatsApp"
                        >
                          {procesandoAccion === `cerrar-${sala.id}` ? "…" : "🔒 Cerrar"}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Publicaciones */}
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                    <div className="flex flex-col justify-between gap-2 rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
                      <span className="text-[11px] leading-relaxed text-slate-400">
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

                    <div className="flex flex-col justify-between gap-2 rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
                      <input
                        type="text"
                        value={pizarraValor}
                        onChange={(e) =>
                          setPizarraPorSala((prev) => ({ ...prev, [sala.id]: e.target.value }))
                        }
                        placeholder="LLEGADA ej: 10.5.1.2.7"
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-xs font-bold text-emerald-300 outline-none transition placeholder:text-slate-600 focus:border-emerald-500"
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
      <section className="rounded-3xl border border-slate-800 bg-slate-950 p-5 text-white shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-500/15 text-lg ring-1 ring-emerald-500/30">
              📊
            </span>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-emerald-400">
                Directorio y Estado de Conexión de Grupos de WhatsApp
              </h3>
              <p className="text-[11px] text-slate-400">
                Visualiza de inmediato cuáles grupos de WhatsApp están conectados a la plataforma y cuáles están disponibles.
              </p>
            </div>
          </div>

          {/* Filtros: Todos / Conectados / Disponibles */}
          <div className="flex items-center gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              type="button"
              onClick={() => setFiltroEstadoGrupo("todos")}
              className={`px-3 py-1 rounded-lg font-bold transition ${
                filtroEstadoGrupo === "todos"
                  ? "bg-slate-800 text-white shadow"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Todos ({status.grupos.length})
            </button>
            <button
              type="button"
              onClick={() => setFiltroEstadoGrupo("conectados")}
              className={`px-3 py-1 rounded-lg font-bold transition ${
                filtroEstadoGrupo === "conectados"
                  ? "bg-emerald-950 border border-emerald-500/40 text-emerald-300"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              🟢 Conectados ({(status.grupos || []).filter((g) => g.conectado).length})
            </button>
            <button
              type="button"
              onClick={() => setFiltroEstadoGrupo("desconectados")}
              className={`px-3 py-1 rounded-lg font-bold transition ${
                filtroEstadoGrupo === "desconectados"
                  ? "bg-slate-800 text-slate-200"
                  : "text-slate-400 hover:text-white"
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
            className="w-full rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-emerald-500"
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
              return (
                <div
                  key={g.jid}
                  className={`p-3 rounded-2xl border transition-all ${
                    estaConectado
                      ? "border-emerald-500/30 bg-gradient-to-br from-emerald-950/30 to-slate-900/60 shadow-sm shadow-emerald-950/20"
                      : "border-slate-800 bg-slate-900/40 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`h-2 w-2 rounded-full shrink-0 ${
                            estaConectado ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
                          }`}
                        />
                        <h4 className="truncate text-xs font-black text-white" title={g.nombre}>
                          {g.nombre}
                        </h4>
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[9px] text-slate-500" title={g.jid}>
                        {g.jid}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase shrink-0 border ${
                        estaConectado
                          ? "border-emerald-500/50 bg-emerald-950 text-emerald-300"
                          : "border-slate-700 bg-slate-800 text-slate-400"
                      }`}
                    >
                      {estaConectado ? "🟢 Conectado" : "⚪ Disponible"}
                    </span>
                  </div>

                  {estaConectado ? (
                    <div className="mt-2 text-[10px] bg-slate-950/60 rounded-xl p-2 border border-slate-800/80 space-y-0.5">
                      <div className="flex items-center justify-between text-slate-400">
                        <span>Sala vinculada:</span>
                        <span className="font-bold text-emerald-300">{g.salaNombre || "Sala"}</span>
                      </div>
                      {g.grupoNombre ? (
                        <div className="flex items-center justify-between text-slate-400">
                          <span>Grupo del sistema:</span>
                          <span className="font-bold text-sky-300">{g.grupoNombre}</span>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="mt-2 text-[10px] text-slate-500 italic bg-slate-950/40 rounded-xl p-2 border border-slate-800/40">
                      Grupo detectado en WhatsApp pero no vinculado a ninguna sala activa
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* ==================== COMANDOS ==================== */}
      <section className="rounded-3xl border border-slate-800 bg-slate-950 p-5 text-white shadow-xl">
        <h3 className="mb-3 text-[11px] font-black uppercase tracking-[0.14em] text-emerald-400">
          ⚡ Comandos directos del operador dentro del grupo
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Comando
            codigo="!abrir [hipódromo] [#]"
            color="text-emerald-300"
            descripcion={
              <>
                Abre la carrera y la anuncia. Ej:{" "}
                <code className="text-white">!abrir La Rinconada 1</code>.
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
                ? "border-emerald-500/50 bg-emerald-950/90 text-emerald-50"
                : feedback.tipo === "error"
                ? "border-rose-500/50 bg-rose-950/90 text-rose-50"
                : "border-slate-700 bg-slate-900/95 text-slate-100"
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
              <details className="mt-2 rounded-xl border border-black/30 bg-black/30 p-2">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-xl rounded-3xl border border-slate-700 bg-slate-950 p-6 text-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-800 pb-4">
              <div>
                <span className="rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-sky-300">
                  Configuración de Sala
                </span>
                <h3 className="mt-1 text-lg font-black text-white">
                  {salaConfigurando.nombre_sala || "Sala de Juegos"}
                </h3>
                <p className="text-xs text-slate-400">
                  ID: <span className="font-mono text-[11px] text-slate-500">{salaConfigurando.id}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSalaConfigurando(null)}
                className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-bold text-slate-300 transition hover:bg-slate-800 hover:text-white"
              >
                ✕ Cerrar
              </button>
            </div>

            {/* Grupos de WhatsApp Vinculados a esta sala */}
            <div className="mt-5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Grupos de WhatsApp Conectados
              </h4>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Todos los mensajes emitidos por el Bot o el Oficial en esta sala se difundirán a estos grupos.
              </p>

              <div className="mt-3 space-y-2 max-h-48 overflow-y-auto pr-1">
                {(vinculosPorSala[salaConfigurando.id] || []).length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-4 text-center text-xs text-slate-500">
                    No hay grupos de WhatsApp vinculados a esta sala.
                  </div>
                ) : (
                  (vinculosPorSala[salaConfigurando.id] || []).map((v) => (
                    <div
                      key={v.id || v.whatsapp_group_jid}
                      className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/80 px-3.5 py-2.5"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-emerald-400"></span>
                          <span className="truncate text-xs font-black text-emerald-300">
                            {v.whatsapp_group_nombre || v.whatsapp_group_jid}
                          </span>
                        </div>
                        <p className="font-mono text-[10px] text-slate-500 truncate ml-4">
                          {v.whatsapp_group_jid}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void desvincularMultiGrupo(v.id, salaConfigurando.id, v.whatsapp_group_jid)}
                        disabled={ocupado}
                        className="shrink-0 rounded-lg border border-rose-500/40 bg-rose-950/60 px-2.5 py-1 text-[10px] font-black text-rose-200 transition hover:bg-rose-900 disabled:opacity-40"
                      >
                        Desvincular
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Vincular nuevo grupo a esta sala */}
            <div className="mt-5 rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                + Vincular otro grupo a esta sala
              </h4>
              <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
                <select
                  value={grupoParaVincularEnModal}
                  onChange={(e) => setGrupoParaVincularEnModal(e.target.value)}
                  disabled={ocupado}
                  className="flex-1 truncate rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-bold text-white outline-none focus:border-emerald-500"
                >
                  <option value="">— Seleccionar grupo de WhatsApp —</option>
                  {status.grupos
                    .filter(
                      (g) =>
                        !(vinculosPorSala[salaConfigurando.id] || []).some(
                          (v) => v.whatsapp_group_jid === g.jid
                        )
                    )
                    .map((g) => (
                      <option key={g.jid} value={g.jid}>
                        {g.conectado ? "🟢 " : "⚪ "} {g.nombre}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    if (grupoParaVincularEnModal) {
                      void vincularMultiGrupo(salaConfigurando, grupoParaVincularEnModal);
                      setGrupoParaVincularEnModal("");
                    }
                  }}
                  disabled={ocupado || !grupoParaVincularEnModal}
                  className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white shadow transition hover:bg-emerald-500 disabled:opacity-40"
                >
                  🔗 Vincular
                </button>
              </div>
            </div>

            {/* Zona de peligro: Eliminar Sala */}
            <div className="mt-6 flex items-center justify-between border-t border-slate-800 pt-4">
              <button
                type="button"
                onClick={() => {
                  if (confirm(`¿Estás seguro de eliminar la sala "${salaConfigurando.nombre_sala}"?`)) {
                    void eliminarSalaDelGrupo(salaConfigurando.id);
                  }
                }}
                disabled={ocupado}
                className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 py-1.5 text-xs font-black text-rose-300 transition hover:bg-rose-900/60 disabled:opacity-40"
              >
                🗑️ Eliminar Sala
              </button>
              <button
                type="button"
                onClick={() => setSalaConfigurando(null)}
                className="rounded-xl bg-slate-800 px-4 py-1.5 text-xs font-bold text-white transition hover:bg-slate-700"
              >
                Cerrar
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
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    slate: "border-slate-700 bg-slate-900/60 text-slate-300",
    sky: "border-sky-500/30 bg-sky-500/10 text-sky-300",
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
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
      <code className={`font-mono text-xs font-black ${color}`}>{codigo}</code>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{descripcion}</p>
    </div>
  );
}
