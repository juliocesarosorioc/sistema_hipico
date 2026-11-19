"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ============================================================================
// TIPOS (contrato de /api/whatsapp-sala/centro-conexiones)
// ============================================================================

interface SalaFila {
  id: string;
  grupo_id: string;
  grupo_nombre: string | null;
  nombre_sala: string;
  orden_sala: number | null;
  estado_carrera: string | null;
  carrera_activa_id: string | null;
  hipodromo_activo: string | null;
  numero_carrera_activa: number | null;
  whatsapp_group_jid: string | null;
  whatsapp_group_nombre: string | null;
}

interface Vinculo {
  id?: string;
  sala_id: string;
  grupo_id: string | null;
  whatsapp_group_jid: string;
  whatsapp_group_nombre: string | null;
  estado_conexion?: string | null;
  sala_nombre: string | null;
  bloqueado: boolean;
}

interface GrupoBot {
  jid: string;
  nombre: string;
  participantes: number;
}

interface EstadoBot {
  online: boolean;
  conectado: boolean;
  numero: string | null;
  grupos: GrupoBot[];
  error?: string;
}

interface Panorama {
  ok: boolean;
  error?: string;
  salas: SalaFila[];
  vinculos: Vinculo[];
  clientesPorGrupo: Record<string, number>;
  bot: EstadoBot;
}

interface CheckPrueba {
  nombre: string;
  ok: boolean;
  detalle: string;
}

interface ResultadoPrueba {
  ok: boolean;
  latenciaMs: number;
  checks: CheckPrueba[];
  error?: string;
}

interface Confirmacion {
  sala: SalaFila;
  grupo: GrupoBot;
  desdeSala: string;
}

const API = "/api/whatsapp-sala/centro-conexiones";
const REFRESCO_AUTOMATICO_MS = 30_000;

function cabecerasSesion(): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const t = typeof window !== "undefined" ? window.sessionStorage.getItem("sala_staff_token") : null;
    if (t) h["x-sala-staff-token"] = t;
  } catch {
    /* sin sessionStorage */
  }
  return h;
}

function etiquetaSala(orden: number | null | undefined): string {
  if (orden === 1) return "Sala 1 · Nacionales";
  if (orden === 2) return "Sala 2 · Americanas";
  return `Sala ${orden ?? "?"}`;
}

// ============================================================================
// PIEZAS VISUALES
// ============================================================================

type Tono = "ok" | "warn" | "bad" | "idle";

const TONOS: Record<Tono, string> = {
  ok: "border-emerald-600 bg-emerald-100 text-emerald-950 font-black",
  warn: "border-amber-600 bg-amber-100 text-amber-950 font-black",
  bad: "border-rose-600 bg-rose-100 text-rose-950 font-black",
  idle: "border-slate-400 bg-slate-200 text-slate-900 font-bold",
};

function Insignia({ tono, children, titulo }: { tono: Tono; children: React.ReactNode; titulo?: string }) {
  return (
    <span
      title={titulo}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-bold ${TONOS[tono]}`}
    >
      {children}
    </span>
  );
}

// ============================================================================
// COMPONENTE
// ============================================================================

export default function CentroConexionesWhatsApp() {
  const [datos, setDatos] = useState<Panorama | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accion, setAccion] = useState<string | null>(null);
  const [pruebas, setPruebas] = useState<Record<string, ResultadoPrueba>>({});
  const [confirmacion, setConfirmacion] = useState<Confirmacion | null>(null);
  const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const montado = useRef(true);

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true);
    try {
      const res = await fetch(API, { cache: "no-store", headers: cabecerasSesion() });
      const json = (await res.json().catch(() => null)) as Panorama | null;
      if (!montado.current) return;
      if (!res.ok || !json?.ok) {
        setError(json?.error || `No se pudo cargar (HTTP ${res.status}).`);
      } else {
        setDatos(json);
        setError(null);
      }
    } catch (e: any) {
      if (montado.current) setError(e?.message || "Error de red al cargar el centro de conexiones.");
    } finally {
      if (montado.current && !silencioso) setCargando(false);
    }
  }, []);

  useEffect(() => {
    montado.current = true;
    void cargar();
    const t = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void cargar(true);
    }, REFRESCO_AUTOMATICO_MS);
    return () => {
      montado.current = false;
      clearInterval(t);
    };
  }, [cargar]);

  const vinculoPorSala = useMemo(() => {
    const m = new Map<string, Vinculo>();
    for (const v of datos?.vinculos || []) m.set(String(v.sala_id), v);
    return m;
  }, [datos]);

  const vinculoPorJid = useMemo(() => {
    const m = new Map<string, Vinculo>();
    for (const v of datos?.vinculos || []) m.set(v.whatsapp_group_jid, v);
    return m;
  }, [datos]);

  const post = useCallback(async (payload: Record<string, unknown>) => {
    const res = await fetch(API, {
      method: "POST",
      headers: cabecerasSesion(),
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => null);
    return { res, json };
  }, []);

  const vincular = useCallback(
    async (sala: SalaFila, grupo: GrupoBot) => {
      setAccion(`vincular-${sala.id}`);
      setMensaje(null);
      try {
        const { res, json } = await post({
          accion: "vincular",
          salaId: sala.id,
          grupoId: sala.grupo_id,
          whatsappGroupJid: grupo.jid,
          whatsappGroupNombre: grupo.nombre,
        });
        if (!res.ok || !json?.ok) {
          setMensaje({ tipo: "error", texto: json?.error || "No se pudo vincular el grupo." });
        } else {
          setMensaje({ tipo: "ok", texto: `"${grupo.nombre}" vinculado a ${sala.nombre_sala}.` });
          setPruebas((p) => {
            const { [sala.id]: _omit, ...resto } = p;
            return resto;
          });
        }
        await cargar(true);
      } catch (e: any) {
        setMensaje({ tipo: "error", texto: e?.message || "Error de red al vincular." });
      } finally {
        setAccion(null);
      }
    },
    [cargar, post]
  );

  const desvincular = useCallback(
    async (sala: SalaFila) => {
      if (typeof window !== "undefined" && !window.confirm(`¿Desvincular el grupo de ${sala.nombre_sala}?`)) return;
      setAccion(`desvincular-${sala.id}`);
      setMensaje(null);
      try {
        const { res, json } = await post({ accion: "desvincular", salaId: sala.id });
        if (!res.ok || !json?.ok) {
          setMensaje({ tipo: "error", texto: json?.error || "No se pudo desvincular." });
        } else {
          setMensaje({ tipo: "ok", texto: `${sala.nombre_sala} quedó sin grupo de WhatsApp.` });
          setPruebas((p) => {
            const { [sala.id]: _omit, ...resto } = p;
            return resto;
          });
        }
        await cargar(true);
      } catch (e: any) {
        setMensaje({ tipo: "error", texto: e?.message || "Error de red al desvincular." });
      } finally {
        setAccion(null);
      }
    },
    [cargar, post]
  );

  const probar = useCallback(
    async (sala: SalaFila) => {
      setAccion(`probar-${sala.id}`);
      try {
        const { res, json } = await post({ accion: "probar", salaId: sala.id });
        setPruebas((p) => ({
          ...p,
          [sala.id]:
            json && Array.isArray(json.checks)
              ? (json as ResultadoPrueba)
              : { ok: false, latenciaMs: 0, checks: [], error: json?.error || `HTTP ${res.status}` },
        }));
      } catch (e: any) {
        setPruebas((p) => ({
          ...p,
          [sala.id]: { ok: false, latenciaMs: 0, checks: [], error: e?.message || "Error de red." },
        }));
      } finally {
        setAccion(null);
      }
    },
    [post]
  );

  const alElegirGrupo = (sala: SalaFila, jid: string) => {
    if (!jid) return;
    const grupo = datos?.bot.grupos.find((g) => g.jid === jid);
    if (!grupo) return;
    const actual = vinculoPorSala.get(sala.id);
    if (actual?.whatsapp_group_jid === jid) return;
    const dueno = vinculoPorJid.get(jid);
    if (dueno && dueno.sala_id !== sala.id) {
      setConfirmacion({ sala, grupo, desdeSala: dueno.sala_nombre || "otra sala" });
      return;
    }
    void vincular(sala, grupo);
  };

  const bot = datos?.bot;
  const ocupado = accion !== null;

  return (
    <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-4 text-slate-900 shadow-sm sm:p-5">
      {/* ==================== BANNER EN VIVO ==================== */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-900">
            Centro de Conexiones 1-a-1
          </h2>
          <p className="text-[11px] text-slate-500">
            Cada sala activa se conecta a un único grupo de WhatsApp. Un grupo no puede estar en dos salas.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {bot ? (
            bot.online && bot.conectado ? (
              <Insignia tono="ok" titulo={bot.numero ? `+${bot.numero}` : undefined}>
                🟢 Baileys Conectado{bot.numero ? ` · +${bot.numero}` : ""}
              </Insignia>
            ) : (
              <Insignia tono="bad" titulo={bot.error}>
                🔴 Baileys Desconectado
              </Insignia>
            )
          ) : (
            <Insignia tono="idle">⏳ Consultando…</Insignia>
          )}
          <button
            type="button"
            onClick={() => void cargar()}
            disabled={cargando || ocupado}
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-[11px] font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cargando ? "Actualizando…" : "Refrescar Grupos"}
          </button>
        </div>
      </div>

      {bot && !(bot.online && bot.conectado) && bot.error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">
          {bot.error} El semáforo se muestra con los últimos datos de la base de datos.
        </p>
      )}
      {error && (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">
          ⚠️ {error}
        </p>
      )}
      {mensaje && (
        <p
          className={`rounded-xl border px-3 py-2 text-[11px] font-semibold ${
            mensaje.tipo === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {mensaje.tipo === "ok" ? "✅ " : "❌ "}
          {mensaje.texto}
        </p>
      )}

      {/* ==================== MATRIZ ==================== */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200">
        <table className="w-full min-w-[960px] border-collapse text-left text-xs">
          <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2.5">Banca / Grupo</th>
              <th className="px-3 py-2.5">Sala</th>
              <th className="px-3 py-2.5">Grupo de WhatsApp</th>
              <th className="px-3 py-2.5">Semáforo de salud</th>
              <th className="px-3 py-2.5">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cargando && !datos && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  Cargando salas…
                </td>
              </tr>
            )}
            {datos && datos.salas.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  No hay salas activas. Crea una sala para poder vincularle un grupo de WhatsApp.
                </td>
              </tr>
            )}

            {(datos?.salas || []).map((sala) => {
              const vinculo = vinculoPorSala.get(sala.id);
              const jidActual = vinculo?.whatsapp_group_jid || "";
              const gruposBot = bot?.grupos || [];
              const enBot = Boolean(jidActual) && gruposBot.some((g) => g.jid === jidActual);
              const botOk = Boolean(bot?.online && bot?.conectado && enBot);

              const abierta = String(sala.estado_carrera || "").toLowerCase() === "abierta";
              const tieneCarreraId = Boolean(sala.carrera_activa_id);
              const telefonos = datos?.clientesPorGrupo?.[sala.grupo_id] ?? 0;
              const prueba = pruebas[sala.id];

              // Opciones del selector: grupos de Baileys + el vinculado actual si el bot no lo lista.
              const opciones: GrupoBot[] = [...gruposBot];
              if (jidActual && !enBot) {
                opciones.unshift({
                  jid: jidActual,
                  nombre: vinculo?.whatsapp_group_nombre || sala.whatsapp_group_nombre || jidActual,
                  participantes: 0,
                });
              }

              return (
                <React.Fragment key={sala.id}>
                  <tr className="align-top hover:bg-slate-50/60">
                    <td className="px-3 py-3 font-bold text-slate-800">
                      {sala.grupo_nombre || <span className="text-slate-400">Sin nombre</span>}
                    </td>

                    <td className="px-3 py-3">
                      <div className="font-semibold text-slate-800">{sala.nombre_sala}</div>
                      <span className="mt-1 inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-black text-sky-700">
                        {etiquetaSala(sala.orden_sala)}
                      </span>
                    </td>

                    <td className="px-3 py-3">
                      <select
                        value={jidActual}
                        disabled={ocupado || !bot?.online}
                        onChange={(e) => alElegirGrupo(sala, e.target.value)}
                        className="w-full max-w-[280px] rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <option value="">— Seleccionar grupo —</option>
                        {opciones.map((g) => {
                          const dueno = vinculoPorJid.get(g.jid);
                          const enOtraSala = Boolean(dueno && dueno.sala_id !== sala.id);
                          return (
                            <option key={g.jid} value={g.jid} disabled={Boolean(enOtraSala && dueno?.bloqueado)}>
                              {enOtraSala ? `${g.nombre} (En uso por: ${dueno?.sala_nombre || "otra sala"})` : g.nombre}
                            </option>
                          );
                        })}
                      </select>
                      {!bot?.online && (
                        <p className="mt-1 text-[10px] text-rose-600">Sin demonio: no se puede listar grupos.</p>
                      )}
                    </td>

                    <td className="px-3 py-3">
                      <div className="flex flex-col items-start gap-1.5">
                        {!jidActual ? (
                          <Insignia tono="idle">⚪ Bot: sin grupo</Insignia>
                        ) : botOk ? (
                          <Insignia tono="ok">🟢 Bot OK</Insignia>
                        ) : (
                          <Insignia
                            tono="bad"
                            titulo={enBot ? "Baileys sin sesión" : "El bot no aparece en este grupo"}
                          >
                            🔴 Bot: sin conexión
                          </Insignia>
                        )}

                        {abierta && tieneCarreraId ? (
                          <Insignia tono="ok">🟢 Carrera abierta</Insignia>
                        ) : abierta ? (
                          <Insignia tono="warn" titulo="Se resolverá al concretar la primera jugada">
                            🟡 Abierta (sin ID)
                          </Insignia>
                        ) : (
                          <Insignia tono="bad" titulo={sala.estado_carrera || undefined}>
                            🔴 Cerrada
                          </Insignia>
                        )}

                        {telefonos > 0 ? (
                          <Insignia tono="ok">👥 {telefonos} teléfonos</Insignia>
                        ) : (
                          <Insignia tono="bad" titulo="Sin teléfonos las jugadas devuelven SIN_REGISTRO">
                            ⚠️ 0 teléfonos
                          </Insignia>
                        )}
                      </div>
                    </td>

                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void probar(sala)}
                          disabled={ocupado}
                          className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[11px] font-black text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {accion === `probar-${sala.id}` ? "Probando…" : "Probar Bot"}
                        </button>
                        {jidActual && (
                          <button
                            type="button"
                            onClick={() => void desvincular(sala)}
                            disabled={ocupado}
                            className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-1.5 text-[11px] font-black text-rose-800 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {accion === `desvincular-${sala.id}` ? "Desvinculando…" : "Desvincular"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {prueba && (
                    <tr className="bg-slate-50/70">
                      <td colSpan={5} className="px-3 py-3">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] font-black">
                          <Insignia tono={prueba.ok ? "ok" : "bad"}>
                            {prueba.ok ? "✅ Prueba superada" : "❌ Prueba con fallos"}
                          </Insignia>
                          <span className="text-slate-500">⏱ {prueba.latenciaMs} ms · sin guardar jugadas</span>
                          <button
                            type="button"
                            onClick={() =>
                              setPruebas((p) => {
                                const { [sala.id]: _omit, ...resto } = p;
                                return resto;
                              })
                            }
                            className="ml-auto text-slate-400 hover:text-slate-700"
                            aria-label="Cerrar resultado"
                          >
                            ✕
                          </button>
                        </div>
                        {prueba.error && <p className="mt-2 text-[11px] text-rose-700">{prueba.error}</p>}
                        <ul className="mt-2 grid grid-cols-1 gap-1.5 md:grid-cols-2">
                          {prueba.checks.map((c) => (
                            <li
                              key={c.nombre}
                              className={`rounded-xl border px-3 py-2 text-[11px] ${
                                c.ok ? TONOS.ok : TONOS.bad
                              }`}
                            >
                              <span className="font-black">
                                {c.ok ? "✅" : "❌"} {c.nombre}
                              </span>
                              <span className="block font-medium opacity-90">{c.detalle}</span>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ==================== CONFIRMAR MOVER GRUPO ==================== */}
      {confirmacion && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <h3 className="text-sm font-black text-slate-900">Mover grupo de WhatsApp</h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-600">
              ¿Mover este grupo desde <b>{confirmacion.desdeSala}</b> hacia aquí (
              <b>{confirmacion.sala.nombre_sala}</b>)? <b>{confirmacion.desdeSala}</b> quedará sin grupo.
            </p>
            <p className="mt-1 truncate text-[11px] font-semibold text-slate-500">{confirmacion.grupo.nombre}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmacion(null)}
                className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const c = confirmacion;
                  setConfirmacion(null);
                  void vincular(c.sala, c.grupo);
                }}
                className="rounded-xl bg-emerald-600 px-3.5 py-2 text-[11px] font-black text-white hover:bg-emerald-700"
              >
                Sí, mover
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
