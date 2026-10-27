"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/shared/components/ui/Button";
import { ToastHost } from "@/shared/components/ui/ToastHost";
import { listarTablasPublicadas } from "@/features/tablas/lib/rpc";
import type { TablaFijaRow } from "@/features/tablas/lib/tablas-fijas";
import {
  actualizarDatosCliente,
  actualizarMiPerfil,
  cerrarSesion,
  disputarJugada,
  eliminarGrupoExterno,
  eliminarJugadaExterna,
  entrarPortal,
  ESTADO_POR_DEFECTO,
  ESTADOS_JUGADA_EXTERNA,
  guardarGrupoExterno,
  guardarJugadaExterna,
  listarGruposExternos,
  listarJugadasExternas,
  normalizarEstadoJugada,
  premioGrupoExterno,
  reanudarSesion,
  reportarJugadaFaltante,
  reclamarJugada,
  resolverImagenReclamo,
  resumenGrupoExterno,
  solicitarCompraTabla,
  type GrupoExterno,
  type JugadaExterna,
  type SesionPortal,
} from "@/features/portal/lib/portal";
import { validarClaveAcceso } from "@/features/auth/lib/sesion";
import { FormasPagoLista } from "@/features/clientes/components/DatosPagoForm";
import { formasPagoDe, normalizarFormasPago, type FormaPago } from "@/features/clientes/lib/clientes";
import { codigosPaisUnicos, desglosarTelefono, formatoMoneda, listMetodosPago } from "@/shared/lib/vzla";
import { nombreHipodromoParaMostrar } from "@/features/hipodromos/lib/nombre";
import { listarHipodromos } from "@/features/hipodromos/lib/servicio";
import { encuestarTicket, listarMisTickets, type TicketDisputa } from "@/features/tickets/lib/tickets";
import {
  armarReporteDiario,
  esJugadaAnulada,
  type JugadaReporte,
} from "@/features/reportes/lib/reporte-diario";
import { ReporteDiarioTabla } from "@/features/reportes/components/ReporteDiarioTabla";
import { ModalRealizarJugadaUsuario } from "@/features/portal/components/ModalRealizarJugadaUsuario";
import { SeccionJugadasPortal } from "@/features/portal/components/SeccionJugadasPortal";
import { ModalJugadaNoRelacionada } from "@/features/portal/components/ModalJugadaNoRelacionada";
import { dentroDeVentana, type CicloGrupo } from "@/features/portal/lib/ventana-reclamos";
import { PieDerechosAutor } from "@/shared/components/ui/PieDerechosAutor";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

const num = (v: number | string | null | undefined): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

/** Fecha local en YYYY-MM-DD (sin desfase por UTC). */
function isoLocal(d: Date): string {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

type TabPortal = "resumen" | "jugadas" | "reporte" | "reportar" | "tickets" | "comprar" | "datos" | "externos";

const BADGE: Record<string, string> = {
  Ganador: "bg-emerald-100 text-emerald-700",
  Perdedor: "bg-red-100 text-red-700",
  Pendiente: "bg-amber-100 text-amber-700",
  EN_REVISION: "bg-amber-100 text-amber-700",
  Retirado: "bg-slate-200 text-slate-600",
};

/**
 * PortalModule — Portal de Consulta del Cliente (clon de js/portal.js).
 * Ruta externa /portal (AppShell la renderiza standalone, sin menú admin).
 */
export function PortalModule() {
  const [sesion, setSesion] = useState<SesionPortal | null>(null);
  const [cargando, setCargando] = useState(true);

  const [autoId, setAutoId] = useState("");
  const [autoToken, setAutoToken] = useState("");
  const [usuario, setUsuario] = useState("");
  const [token, setToken] = useState("");
  const [clave, setClave] = useState("");
  const [errorLogin, setErrorLogin] = useState("");

  useEffect(() => {
    let vivo = true;
    const cargar = async () => {
      setCargando(true);
      const limite = setTimeout(() => {
        if (vivo) {
          setCargando(false);
          setErrorLogin("El portal tardó demasiado en cargar. Probá recargar la página.");
        }
      }, 10000);
      try {
        const qs = new URLSearchParams(window.location.search);
        const c = qs.get("c") ?? "";
        const k = qs.get("k") ?? "";
        // 1) Entrada automática vía enlace del admin (?c=&k=)
        if (c && k) {
          const r = await entrarPortal({ linkId: c, linkToken: k });
          if (r.ok && r.sesion) {
            if (vivo) {
              setSesion(r.sesion!);
              return;
            }
          }
          if (vivo) {
            setAutoId(c);
            setAutoToken(k);
          }
        }
        // 2) Sesión guardada (recargas)
        const re = await reanudarSesion();
        if (re && vivo) {
          setSesion(re);
          return;
        }
      } catch (e) {
        if (vivo) setErrorLogin(e instanceof Error ? e.message : "No se pudo cargar el portal.");
      } finally {
        clearTimeout(limite);
        if (vivo) setCargando(false);
      }
    };
    void cargar();
    return () => {
      vivo = false;
    };
  }, []);

  const loguear = async () => {
    setErrorLogin("");
    try {
      if (autoId && autoToken) {
        const r = await entrarPortal({ linkId: autoId, linkToken: autoToken });
        return aplicarLogin(r.ok, r.error, r.sesion);
      }
      if (!usuario.trim()) {
        return setErrorLogin("Indique el seudónimo o nombre del cliente para entrar.");
      }
      const r = await entrarPortal({ usuario, token, clave });
      aplicarLogin(r.ok, r.error, r.sesion);
    } catch (e) {
      setErrorLogin(e instanceof Error ? e.message : "No se pudo iniciar sesión.");
    } finally {
      setCargando(false);
    }
  };

  const aplicarLogin = (ok: boolean, error?: string, s?: SesionPortal) => {
    if (!ok || !s) return setErrorLogin(error ?? "No se pudo iniciar sesión.");
    setErrorLogin("");
    setSesion(s);
    toast("¡Bienvenido a tu Portal! ", "success");
  };

  const salir = () => {
    cerrarSesion();
    setSesion(null);
    setUsuario("");
    setToken("");
    setClave("");
    setAutoId("");
    setAutoToken("");
  };

  useEffect(() => {
    // Limpia la barra de direcciones: el enlace del admin trae las credenciales
    // en la query (`?c=...&k=...`) y no deben quedar visibles ni en el historial
    // una vez consumidas. Se quita SOLO la query.
    //
    // OJO: antes decía `replaceState({}, "", "/portal")`, una ruta ABSOLUTA sin
    // el basePath. En GitHub Pages la app se sirve bajo `/sistema_hipico`, así
    // que ese literal saltaba a la RAÍZ del dominio (`/portal`, donde no hay
    // nada → 404). Peor: el guard de rutas públicas ya había dejado pasar la
    // página, y el navegador terminaba en una URL inexistente. Se conserva la
    // ruta ACTUAL —que ya incluye el prefijo— y se descarta únicamente el `?`.
    // `pathname` preserva el subpath y `search: ""` borra la query.
    window.history.replaceState({}, "", window.location.pathname);
  }, [sesion]);

  if (cargando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center text-slate-500">
          <span className="text-2xl">⏳</span>
          <p className="mt-2 text-xs font-bold uppercase tracking-wider">Cargando portal…</p>
        </div>
      </div>
    );
  }

  if (!sesion) {
    return <LoginScreen usuario={usuario} setUsuario={setUsuario} token={token} setToken={setToken} clave={clave} setClave={setClave} error={errorLogin} onEntrar={() => void loguear()} autoEntrar={Boolean(autoId && autoToken)} />;
  }

  return <SesionView sesion={sesion} onActualizar={(s) => setSesion(s)} onSalir={salir} />;
}

// ---------------------------------------------------------------------------
// Pantalla de entrada
// ---------------------------------------------------------------------------

/**
 * Topes de los campos de acceso.
 *
 * `MAX_CLAVE` es la misma cota que ya usa el servidor para LEER la clave
 * (`texto(e.clave, 128)`): una contraseña de portal puede ser más larga que el
 * rango 4–8 que se exige al CAMBIARLA, y recortarla en el navegador rompía el
 * login de cualquier clave larga (era el caso de `JUGADOR123`). Acá el tope
 * existe solo para no mandar un texto absurdo, no para truncar credenciales.
 */
const MAX_TOKEN = 128;
const MAX_CLAVE = 128;

function LoginScreen(props: {
  usuario: string;
  setUsuario: (v: string) => void;
  token: string;
  setToken: (v: string) => void;
  clave: string;
  setClave: (v: string) => void;
  error: string;
  onEntrar: () => void;
  autoEntrar: boolean;
}) {
  const inp = "w-full border border-indigo-200 rounded-xl bg-white px-4 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 font-mono";
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center text-white">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500/20 text-3xl">
            <span className="text-indigo-300">👔</span>
          </div>
          <h1 className="text-2xl font-black tracking-tight">Portal del Cliente</h1>
          <p className="mt-1 text-xs text-indigo-200/80">Consulta tu estado de cuenta, devoluciones y reclamos.</p>
        </div>

        <div className="rounded-2xl bg-white/95 p-6 shadow-2xl backdrop-blur space-y-3">
          <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500">Seudónimo / Nombre</label>
          <input value={props.usuario} onChange={(e) => props.setUsuario(e.target.value.toUpperCase())} className={inp} placeholder="ej. EL MAGO" />

          <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500">Código del enlace (te lo dio el administrador)</label>
          <input value={props.token} onChange={(e) => props.setToken(e.target.value.toUpperCase())} className={inp} placeholder="XXXXXX" maxLength={MAX_TOKEN} />

          {/*
            SIN maxLength: el campo de contraseña NO se recorta.
            Antes tenía maxLength={8}, copiado de la regla del cambio de PIN, y
            eso cortaba en silencio contraseñas válidas más largas: "JUGADOR123"
            (10) quedaba en "JUGADOR1" y el login fallaba sin decir por qué.
            Un tope en la contraseña solo convierte credenciales correctas en
            errores indescifrables; el largo lo valida la función del servidor.
          */}
          <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500">Contraseña</label>
          <input value={props.clave} onChange={(e) => props.setClave(e.target.value.toUpperCase())} className={inp} placeholder="XXXX" maxLength={MAX_CLAVE} autoComplete="current-password" />

          {props.error ? (
            <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs font-bold text-red-600">
              <span className="mr-1">⚠️</span> {props.error}
            </p>
          ) : null}

          <Button variant="default" size="lg" className="w-full bg-indigo-600 hover:bg-indigo-500" onClick={props.onEntrar}>
            <span className="mr-1">🔑</span> Entrar al Portal
          </Button>

          <p className="text-center text-[10px] text-slate-400">
            {props.autoEntrar ? "Enlace detectado: entre con el botón para validar el acceso." : "Acceso con las credenciales entregadas por el hipódromo."}
          </p>
        </div>
        <div className="mt-4">
          <PieDerechosAutor variante="compacto" className="text-indigo-200/70" />
        </div>
      </div>
      <ToastHost />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sesión activa
// ---------------------------------------------------------------------------

const OPCIONES_MENU_PORTAL: { key: TabPortal; icono: string; label: string; badge?: string }[] = [
  { key: "reporte", icono: "📊", label: "Reporte del Día" },
  { key: "resumen", icono: "🗒️", label: "Resumen y movimientos" },
  { key: "externos", icono: "📓", label: "Mi Control en Otros Grupos" },
  { key: "jugadas", icono: "⚔️", label: "Marcas" },
  { key: "tickets", icono: "🛟", label: "Mis tickets" },
];

function SesionView({ sesion, onActualizar, onSalir }: { sesion: SesionPortal; onActualizar: (s: SesionPortal) => void; onSalir: () => void }) {
  // 1ra pestaña por defecto: Reporte del Día
  const [tab, setTab] = useState<TabPortal>("reporte");
  // Menú ocultable a la izquierda para todas las opciones
  const [menuAbierto, setMenuAbierto] = useState(true);
  // 👤 Mi Perfil (PROMPT #7): autogestión de datos personales en un modal.
  const [perfilAbierto, setPerfilAbierto] = useState(false);
  // 🐎 Realizar Jugada + ➕ Jugada No Relacionada (PROMPT #6).
  const [jugadaAbierta, setJugadaAbierta] = useState(false);
  const [noRelAbierta, setNoRelAbierta] = useState(false);

  const ciclo: CicloGrupo = {
    diaInicio: num(sesion.grupo?.dia_inicio_semana) || 1,
    diaFin: num(sesion.grupo?.dia_fin_semana) || 7,
  };

  const recargar = () => {
    void reanudarSesion().then((s) => {
      if (s) onActualizar(s);
    });
  };

  const nombreGrupoActivo =
    String(sesion.grupo?.nombre ?? "").trim() ||
    String((sesion.cliente as unknown as { grupo?: string }).grupo ?? "").trim() ||
    "Club del Dinero";

  const logoGrupoUrl = String(
    (sesion.grupo as unknown as { logo_url?: string; logo?: string })?.logo_url ??
      (sesion.grupo as unknown as { logo?: string })?.logo ??
      ""
  ).trim();

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      <div className="mx-auto flex w-full max-w-[1600px] flex-1 gap-4 px-4 py-5">
        {/* Menú ocultable a la izquierda para todas las opciones */}
        {menuAbierto ? (
          <aside className="w-64 shrink-0 space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              {/* Encabezado del menu: el logo del grupo llena todo el espacio */}
              <div className="-m-3 mb-3 flex h-24 items-center justify-center overflow-hidden rounded-t-2xl bg-slate-950 p-2">
                {logoGrupoUrl ? (
                  <img
                    src={logoGrupoUrl}
                    alt={nombreGrupoActivo}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <span className="px-2 text-center text-xs font-black uppercase tracking-widest text-white">
                    {nombreGrupoActivo}
                  </span>
                )}
              </div>
              <div className="mb-2 flex justify-center">
                <CapsulaUsuarioConTorta sesion={sesion} nombreGrupo={nombreGrupoActivo} />
              </div>
              <div className="mb-2 flex items-center justify-between px-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Menú de Navegación
                </span>
                <button
                  type="button"
                  onClick={() => setMenuAbierto(false)}
                  className="rounded-lg px-1.5 py-0.5 text-[10px] font-bold text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  title="Ocultar menú"
                >
                  Ocultar ◀
                </button>
              </div>
              <nav className="space-y-1">
                {OPCIONES_MENU_PORTAL.map((op) => {
                  const activa = tab === op.key;
                  return (
                    <button
                      key={op.key}
                      type="button"
                      onClick={() => setTab(op.key)}
                      className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs font-extrabold transition ${
                        activa
                          ? "bg-indigo-600 text-white shadow-md"
                          : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="text-base leading-none">{op.icono}</span>
                        <span>{op.label}</span>
                      </span>
                      {op.badge ? (
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase ${
                            activa
                              ? "bg-amber-300 text-slate-950"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {op.badge}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </nav>

              <div className="mt-3 border-t border-slate-200 pt-3 space-y-1.5">
                <button
                  type="button"
                  onClick={() => setJugadaAbierta(true)}
                  className="flex w-full items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-left text-[11px] font-extrabold text-white hover:bg-indigo-500 transition"
                >
                  <span>🐎</span>
                  <span>Realizar Jugada</span>
                </button>
                <button
                  type="button"
                  onClick={() => setNoRelAbierta(true)}
                  className="flex w-full items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2 text-left text-[11px] font-extrabold text-indigo-800 hover:bg-indigo-100 transition"
                >
                  <span>➕</span>
                  <span>Solicitar Incluir Jugada No Relacionada</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPerfilAbierto(true)}
                  className="flex w-full items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-left text-[11px] font-extrabold text-slate-800 hover:bg-slate-200 transition"
                >
                  <span>👤</span>
                  <span>Mi Perfil</span>
                </button>
                <button
                  type="button"
                  onClick={onSalir}
                  className="flex w-full items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-left text-[11px] font-extrabold text-rose-700 hover:bg-rose-100 transition"
                >
                  <span>🚪</span>
                  <span>Salir</span>
                </button>
              </div>
            </div>
          </aside>
        ) : null}

        {/* Área central de contenido */}
        <main className="min-w-0 flex-1 space-y-4">
          {/* Totales: saldo, incentivo y disponible (antes vivian en la barra superior) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Kpi
              icon="🪙"
              lbl="Saldo / Total Decidido"
              val={formatoMoneda("USD", sesion.resumen.saldo)}
              color="text-slate-900"
              bg="bg-white"
            />
            <Kpi
              icon="％"
              lbl={`Incentivo (${num(sesion.cliente.devolucion)}%)`}
              val={formatoMoneda("USD", sesion.resumen.incentivo)}
              color="text-amber-600"
              bg="bg-white"
            />
            <Kpi
              icon="🤲"
              lbl="Disponible para Jugar"
              val={formatoMoneda("USD", sesion.resumen.disponible)}
              color="text-emerald-700"
              bg="bg-white"
            />
          </div>

          {/* Barra compacta superior de pestañas (sincronizada con el menú izquierdo) */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-2xl bg-white p-1.5 shadow-sm border border-slate-200">
            {!menuAbierto ? (
              <button
                type="button"
                onClick={() => setMenuAbierto(true)}
                className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white hover:bg-slate-800"
              >
                ☰ Menú
              </button>
            ) : null}
            {OPCIONES_MENU_PORTAL.map((op) => (
              <button
                key={op.key}
                type="button"
                onClick={() => setTab(op.key)}
                className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-extrabold transition-colors ${
                  tab === op.key
                    ? "bg-indigo-600 text-white shadow"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                <span>{op.icono}</span>
                <span>{op.label}</span>
                {op.badge ? (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase ${
                      tab === op.key
                        ? "bg-amber-300 text-slate-950"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {op.badge}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          {/* Vista principal con el Panel del Grupo (Logo en grande fijo a la derecha + QR Grupo + QR Perfil) */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
            <div className="xl:col-span-9 min-w-0 space-y-4">
              {tab === "reporte" ? <ReporteDiarioView sesion={sesion} /> : null}
              {tab === "resumen" ? <ResumenView sesion={sesion} onCambio={onActualizar} /> : null}
              {tab === "externos" ? <BitacoraExternaView cliente={sesion.cliente} /> : null}
              {tab === "jugadas" || tab === "comprar" ? (
                <SeccionJugadasPortal
                  sesion={sesion}
                  modalidadInicial="marcas"
                  onJugadaRealizada={recargar}
                />
              ) : null}
              {tab === "tickets" ? <MisTicketsView cliente={sesion.cliente} /> : null}
            </div>

            {/* Columna derecha fija: Logo del grupo en grande + QR de su grupo + QR de su perfil */}
            <div className="xl:col-span-3 xl:sticky xl:top-4">
              <PanelGrupoFijoDerecha
                sesion={sesion}
                nombreGrupo={nombreGrupoActivo}
                logoUrl={logoGrupoUrl}
                onAbrirPerfil={() => setPerfilAbierto(true)}
              />
            </div>
          </div>
        </main>
      </div>

      {/* 👤 Mi Perfil — autogestión (PROMPT #7). Al guardar se actualiza la
          sesión con la fila devuelta por la Edge Function, así el encabezado
          refleja el nombre nuevo sin recargar. */}
      {perfilAbierto ? (
        <MiPerfilModal
          cliente={sesion.cliente}
          onCerrar={() => setPerfilAbierto(false)}
          onGuardado={(c) => {
            setPerfilAbierto(false);
            onActualizar({ ...sesion, cliente: c });
          }}
        />
      ) : null}

      {/* 🐎 Realizar Jugada (PROMPT #6): vende directo contra el grupo del
          jugador; al terminar se recarga la sesión para ver el saldo y las
          jugadas nuevas. */}
      {jugadaAbierta ? (
        <ModalRealizarJugadaUsuario
          sesion={sesion}
          onCerrar={() => setJugadaAbierta(false)}
          onRealizada={recargar}
          onPedirNoRelacionada={() => {
            setJugadaAbierta(false);
            setNoRelAbierta(true);
          }}
        />
      ) : null}

      {/* ➕ Solicitar Incluir Jugada No Relacionada (PROMPT #6). */}
      {noRelAbierta ? (
        <ModalJugadaNoRelacionada
          sesion={sesion}
          ventana={sesion.grupo?.ventana_reclamos ?? "SOLO_DIA_EN_CURSO"}
          ciclo={ciclo}
          onCerrar={() => setNoRelAbierta(false)}
        />
      ) : null}

      <PieDerechosAutor variante="claro" />
      <ToastHost />
    </div>
  );
}

function Kpi({ icon, lbl, val, color, bg }: { icon: string; lbl: string; val: string; color: string; bg: string }) {
  return (
    <div className={`rounded-2xl ${bg} border px-5 py-3.5 flex items-center gap-3.5 shadow-md`}>
      <span className={`text-2xl leading-none ${color}`}>{icon}</span>
      <div>
        <div className="text-[10px] uppercase tracking-widest font-black text-slate-500">{lbl}</div>
        <div className={`text-2xl sm:text-3xl font-black font-mono tracking-tight ${color}`}>{val}</div>
      </div>
    </div>
  );
}

/**
 * Cápsula con el nombre del jugador y un gráfico de torta (pie/donut chart)
 * que ilustra visualmente la composición de su saldo (Disponible vs Jugado/Riesgo).
 */
function CapsulaUsuarioConTorta({
  sesion,
  nombreGrupo,
}: {
  sesion: SesionPortal;
  nombreGrupo: string;
}) {
  const f = sesion.fichaUnificada;
  const disponible = Math.max(0, num(sesion.resumen.disponible));
  const enRiesgo = Math.max(
    0,
    num(f?.riesgoEnCurso) + num(f?.jugadasPerdidas)
  );
  const incentivo = Math.max(0, num(sesion.resumen.incentivo));
  const totalBase = Math.max(1, disponible + enRiesgo + incentivo);
  const pctDisp = Math.min(100, Math.round((disponible / totalBase) * 100));
  const pctRiesgo = Math.min(100 - pctDisp, Math.round((enRiesgo / totalBase) * 100));

  const r = 16;
  const c = 2 * Math.PI * r;
  const dashDisp = (pctDisp / 100) * c;
  const dashRiesgo = (pctRiesgo / 100) * c;

  return (
    <div className="flex items-center gap-3 rounded-full border-2 border-indigo-400/50 bg-slate-900/90 px-4 py-1.5 shadow-lg">
      {/* Gráfico de torta SVG */}
      <div className="relative flex h-11 w-11 shrink-0 items-center justify-center" title={`Saldo Disponible: ${pctDisp}%`}>
        <svg viewBox="0 0 40 40" className="h-11 w-11 -rotate-90">
          <circle cx="20" cy="20" r={r} fill="transparent" stroke="#1e293b" strokeWidth="6" />
          {/* Segmento Riesgo / Jugado */}
          <circle
            cx="20"
            cy="20"
            r={r}
            fill="transparent"
            stroke="#f59e0b"
            strokeWidth="6"
            strokeDasharray={`${dashRiesgo} ${c}`}
            strokeDashoffset={-dashDisp}
          />
          {/* Segmento Disponible */}
          <circle
            cx="20"
            cy="20"
            r={r}
            fill="transparent"
            stroke="#10b981"
            strokeWidth="6"
            strokeDasharray={`${dashDisp} ${c}`}
          />
        </svg>
        <span className="absolute text-[9px] font-black font-mono text-emerald-300">
          {pctDisp}%
        </span>
      </div>

      <div className="pr-2">
        <div className="flex items-center gap-2">
          <span className="text-sm sm:text-base font-black tracking-tight text-white uppercase">
            {sesion.cliente.nombre || sesion.cliente.seudonimo}
          </span>
          <span className="rounded-full bg-emerald-500/20 border border-emerald-400/40 px-2 py-0.5 text-[10px] font-black text-emerald-300 font-mono">
            {formatoMoneda("USD", sesion.resumen.disponible)}
          </span>
        </div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-300">
          🪙 {nombreGrupo} · Portal del Jugador
        </div>
      </div>
    </div>
  );
}

/**
 * Generador determinístico de matriz QR en SVG (21x21 con patrones de posición
 * estándar ISO/IEC 18004) para acceso rápido a Grupo y Perfil del Jugador.
 */
function QrSvgMatrix({ valor, size = 116 }: { valor: string; size?: number }) {
  const N = 21;
  const celdas = useMemo(() => {
    const grid: boolean[][] = Array.from({ length: N }, () => Array(N).fill(false));
    const reservado: boolean[][] = Array.from({ length: N }, () => Array(N).fill(false));

    const ponerFinder = (r0: number, c0: number) => {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const rr = r0 + r;
          const cc = c0 + c;
          if (rr < 0 || rr >= N || cc < 0 || cc >= N) continue;
          reservado[rr][cc] = true;
          const borde7 = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6);
          const centro3 = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          grid[rr][cc] = borde7 || centro3;
        }
      }
    };

    ponerFinder(0, 0);
    ponerFinder(0, N - 7);
    ponerFinder(N - 7, 0);

    for (let i = 8; i < N - 8; i++) {
      reservado[6][i] = true;
      reservado[i][6] = true;
      grid[6][i] = i % 2 === 0;
      grid[i][6] = i % 2 === 0;
    }

    let hash = 2166136261;
    const texto = valor || "SISTEMA_HIPICO";
    for (let i = 0; i < texto.length; i++) {
      hash ^= texto.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    let idx = 0;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (reservado[r][c]) continue;
        const charCode = texto.charCodeAt(idx % texto.length);
        const bit = ((hash >>> (idx % 24)) ^ (charCode * (r + 1) + c * 17)) & 1;
        grid[r][c] = bit === 1;
        idx++;
      }
    }
    return grid;
  }, [valor]);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${N + 2} ${N + 2}`}
      className="rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
      role="img"
      aria-label="Código QR"
    >
      <rect width={N + 2} height={N + 2} fill="#ffffff" />
      {celdas.map((fila, r) =>
        fila.map((activo, c) =>
          activo ? (
            <rect key={`${r}-${c}`} x={c + 1} y={r + 1} width={1} height={1} fill="#0f172a" />
          ) : null
        )
      )}
    </svg>
  );
}

/**
 * Panel derecho fijo para reportes de usuario: muestra de manera grande y fija
 * el logo del grupo con el que juega, el código QR de su grupo y el código QR
 * para acceder directamente a su perfil.
 */
function PanelGrupoFijoDerecha({
  sesion,
  nombreGrupo,
  logoUrl,
  onAbrirPerfil,
}: {
  sesion: SesionPortal;
  nombreGrupo: string;
  logoUrl: string;
  onAbrirPerfil: () => void;
}) {
  const origen = typeof window !== "undefined" ? window.location.origin + window.location.pathname : "https://juliocesarosorioc.github.io/sistema_hipico/portal";
  const urlGrupo = `${origen}?grupo=${encodeURIComponent(nombreGrupo)}`;
  const tokenCliente = String((sesion.cliente as unknown as { link_token?: string }).link_token ?? "");
  const urlPerfil = tokenCliente
    ? `${origen}?c=${encodeURIComponent(sesion.cliente.id)}&k=${encodeURIComponent(tokenCliente)}`
    : `${origen}?c=${encodeURIComponent(sesion.cliente.id)}`;

  const iniciales = nombreGrupo
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-md space-y-4">
      {/* Logo grande y fijo del grupo */}
      <div className="rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-5 text-center text-white shadow-inner">
        <div className="text-[10px] font-black uppercase tracking-widest text-amber-300">
          Grupo Oficial Activo
        </div>
        <div className="mx-auto my-3 flex h-28 w-28 items-center justify-center overflow-hidden rounded-3xl border-2 border-amber-400/60 bg-white/10 shadow-xl">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={nombreGrupo}
              className="h-full w-full object-contain p-1.5"
            />
          ) : (
            <div className="flex flex-col items-center justify-center">
              <span className="text-3xl leading-none">🪙</span>
              <span className="mt-1 text-lg font-black tracking-wider text-amber-300">
                {iniciales || "CD"}
              </span>
            </div>
          )}
        </div>
        <div className="text-base font-black tracking-tight text-white">
          {nombreGrupo}
        </div>
        <div className="mt-0.5 text-[11px] font-bold text-indigo-200">
          Jugador: {sesion.cliente.seudonimo || sesion.cliente.nombre}
        </div>
      </div>

      {/* QR del Grupo y QR de Mi Perfil */}
      <div className="grid grid-cols-2 xl:grid-cols-1 gap-3">
        <div className="flex flex-col items-center rounded-2xl border border-slate-200 bg-slate-50 p-3 text-center">
          <div className="mb-1.5 text-[10px] font-black uppercase tracking-wider text-slate-700">
            📱 QR de tu Grupo
          </div>
          <QrSvgMatrix valor={urlGrupo} size={112} />
          <div className="mt-1.5 text-[10px] font-bold text-slate-600">
            {nombreGrupo}
          </div>
        </div>

        <div className="flex flex-col items-center rounded-2xl border border-indigo-200 bg-indigo-50/50 p-3 text-center">
          <div className="mb-1.5 text-[10px] font-black uppercase tracking-wider text-indigo-900">
            👤 QR Acceso a Mi Perfil
          </div>
          <QrSvgMatrix valor={urlPerfil} size={112} />
          <button
            type="button"
            onClick={onAbrirPerfil}
            className="mt-2 w-full rounded-xl bg-indigo-600 px-3 py-1.5 text-[11px] font-extrabold text-white shadow hover:bg-indigo-500 transition"
          >
            Abrir Mi Perfil
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reporte del día (por hipódromo + carrera, en formato cliente)
// ---------------------------------------------------------------------------

/**
 * Reporte Diario desde la óptica del cliente. Es el mismo cálculo que el módulo
 * del personal (`armarReporteDiario`), pero con la perspectiva invertida: acá el
 * "balance a favor" es lo que el cliente GANA (premios + incentivo − jugado).
 *
 * La fecha se toma de la carrera (`fechaCarrera`) con respaldo del registro:
 * si el portal todavía no devuelve `fecha_carrera`, cae a la fecha de venta.
 */
function ReporteDiarioView({ sesion }: { sesion: SesionPortal }) {
  const fechasDisponibles = useMemo(() => {
    const set = new Set<string>();
    for (const j of sesion.arbolTickets.jugadas) {
      const f = String(j.fechaCarrera ?? j.fecha ?? "").slice(0, 10);
      if (f) set.add(f);
    }
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [sesion.arbolTickets.jugadas]);

  const [fecha, setFecha] = useState(() => fechasDisponibles[0] || isoLocal(new Date()));
  const [verTodasFechas, setVerTodasFechas] = useState(false);

  const datos = useMemo(() => {
    const filtradas = verTodasFechas
      ? sesion.arbolTickets.jugadas
      : sesion.arbolTickets.jugadas.filter(
          (j) => (j.fechaCarrera ?? j.fecha ?? "").slice(0, 10) === fecha
        );
    const jugadas: JugadaReporte[] = filtradas.map((j) => {
      const fStr = String(j.fechaCarrera ?? j.fecha ?? fecha).slice(0, 10);
      const mHora = /(\d{2}:\d{2})/.exec(String(j.fecha ?? ""));
      return {
        id: j.id,
        fecha: fStr,
        horaCarga: mHora ? mHora[1] : null,
        cliente: sesion.cliente.seudonimo || sesion.cliente.nombre || "CLIENTE",
        jugada: j.jugada,
        caballo: j.caballo,
        estado: j.estado,
        hipodromo: j.hipodromo,
        carrera: j.carrera,
        montoJugado: j.montoJugado,
        premio: j.premio,
        devolucion: j.devolucion,
        anulada: esJugadaAnulada(j.estado, undefined),
      };
    });
    return armarReporteDiario(jugadas);
  }, [sesion, fecha, verTodasFechas]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
            Fecha del reporte
          </span>
          <input
            type="date"
            value={fecha}
            disabled={verTodasFechas}
            onChange={(e) => {
              setVerTodasFechas(false);
              setFecha(e.target.value);
            }}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => setVerTodasFechas((v) => !v)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              verTodasFechas
                ? "bg-indigo-600 text-white shadow"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {verTodasFechas ? "📅 Viendo todas mis jornadas" : "📊 Ver todas mis jornadas"}
          </button>
          {fechasDisponibles.slice(0, 4).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => {
                setVerTodasFechas(false);
                setFecha(f);
              }}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-mono font-bold ${
                !verTodasFechas && fecha === f
                  ? "bg-amber-500 text-slate-950"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-400">
          Abrí el día → hipódromo → carrera para ver cada jugada, su resultado y la comisión devuelta.
        </span>
      </div>

      <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
        <ReporteDiarioTabla datos={datos} perspectiva="cliente" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resumen y movimientos (con Reclamar)
// ---------------------------------------------------------------------------

function ResumenView({ sesion, onCambio }: { sesion: SesionPortal; onCambio: (s: SesionPortal) => void }) {
  const jugadas = useMemo(
    () => sesion.arbolTickets.jugadas.slice(0, 60),
    [sesion.arbolTickets.jugadas]
  );
  const [disputa, setDisputa] = useState<(typeof jugadas)[number] | null>(null);
  const [noRelAbierta, setNoRelAbierta] = useState(false);

  const ventana = sesion.grupo?.ventana_reclamos ?? "SOLO_DIA_EN_CURSO";
  const ciclo: CicloGrupo = {
    diaInicio: num(sesion.grupo?.dia_inicio_semana) || 1,
    diaFin: num(sesion.grupo?.dia_fin_semana) || 7,
  };
  const hoy = isoLocal(new Date());

  const reclamar = async (id: string) => {
    const r = await reclamarJugada(id);
    if (!r.ok) return toast(r.error ?? "No se pudo reclamar.", "error");
    toast("Reclamo enviado. La casa lo revisará.", "success");
    const re = await reanudarSesion();
    if (re) onCambio(re);
  };

  const confirmarDisputa = async (d: { motivo: string; image?: File | null }) => {
    if (!disputa) return;
    toast("Enviando tu disputa…", "info");
    const r = await disputarJugada({
      cliente: sesion.cliente,
      jugada_id: disputa.id,
      jugada_origen: disputa.jugada,
      hipodromo: disputa.hipodromo,
      carrera: disputa.carrera,
      monto: disputa.montoJugado,
      motivo: d.motivo,
      image: d.image,
    });
    if (!r.ok) return toast(r.error ?? "No se pudo enviar la disputa.", "error");
    toast("Disputa registrada. La casa la revisará y te responderá por WhatsApp.", "success");
    setDisputa(null);
    const re = await reanudarSesion();
    if (re) onCambio(re);
  };

  const f = sesion.fichaUnificada;
  const mostrarIncentivo =
    num(sesion.cliente.devolucion) > 0 ||
    num(sesion.resumen.incentivo) > 0 ||
    num(f?.devolucionIncentivo) > 0 ||
    jugadas.some((j) => num(j.devolucion) > 0);

  return (
    <div className="space-y-3">
      {f ? (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 rounded-2xl border border-slate-200 bg-white p-3.5 text-xs shadow-sm">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
            <div className="text-[10px] font-black uppercase text-slate-600">1. Saldo Inicial / Anterior</div>
            <div className="mt-0.5 text-base sm:text-lg font-mono font-black text-slate-900">{formatoMoneda("USD", f.saldoInicial)}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
            <div className="text-[10px] font-black uppercase text-slate-600">2. Depósitos (+) / Retiros (-)</div>
            <div className="mt-0.5 text-sm sm:text-base font-mono font-black text-slate-900">
              +{formatoMoneda("USD", f.depositos)} / -{formatoMoneda("USD", f.retiros)}
            </div>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5">
            <div className="text-[10px] font-black uppercase text-amber-800">3. Aval Vigente</div>
            <div className="mt-0.5 text-base sm:text-lg font-mono font-black text-amber-900">{formatoMoneda("USD", f.avalVigente)}</div>
          </div>
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-2.5">
            <div className="text-[10px] font-black uppercase text-indigo-800">4. En Vivo / Adelantadas</div>
            <div className="mt-0.5 text-sm sm:text-base font-mono font-black text-indigo-900">
              {f.jugadasEnVivoCount} en vivo · {f.jugadasAdelantadasCount} adel.
            </div>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-2.5">
            <div className="text-[10px] font-black uppercase text-emerald-800">5. Ganadas / Com. / Reemb. Cruce</div>
            <div className="mt-0.5 text-sm sm:text-base font-mono font-black text-emerald-900">
              {formatoMoneda("USD", f.jugadasGanadasBruto)} (-{formatoMoneda("USD", f.comisionesCobradas)} / +{formatoMoneda("USD", f.reembolsoCruce)})
            </div>
          </div>
          {mostrarIncentivo ? (
            <div className="rounded-xl border border-emerald-300 bg-emerald-100/70 p-2.5">
              <div className="text-[10px] font-black uppercase text-emerald-900">6. 🎁 Devolución / Incentivo a favor</div>
              <div className="mt-0.5 text-base sm:text-lg font-mono font-black text-emerald-900">+{formatoMoneda("USD", f.devolucionIncentivo)}</div>
            </div>
          ) : null}
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-2.5">
            <div className="text-[10px] font-black uppercase text-rose-800">7. Jugadas Perdidas (-)</div>
            <div className="mt-0.5 text-base sm:text-lg font-mono font-black text-rose-900">-{formatoMoneda("USD", f.jugadasPerdidas)}</div>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5">
            <div className="text-[10px] font-black uppercase text-amber-800">8. Riesgo en Curso (-)</div>
            <div className="mt-0.5 text-base sm:text-lg font-mono font-black text-amber-900">-{formatoMoneda("USD", f.riesgoEnCurso)}</div>
          </div>
          <div className="rounded-xl border border-slate-300 bg-slate-100 p-2.5">
            <div className="text-[10px] font-black uppercase text-slate-700">9. Saldo Contable Neto</div>
            <div className="mt-0.5 text-lg sm:text-xl font-mono font-black text-slate-950">{formatoMoneda("USD", f.saldoContable)}</div>
          </div>
          <div className="rounded-xl border border-indigo-300 bg-indigo-100/80 p-2.5">
            <div className="text-[10px] font-black uppercase text-indigo-900">10. Disponible Total para Apostar</div>
            <div className="mt-0.5 text-lg sm:text-xl font-mono font-black text-indigo-950">
              {Number.isFinite(f.disponibleParaJugar) ? formatoMoneda("USD", f.disponibleParaJugar) : "LIBRE"}
            </div>
          </div>
        </div>
      ) : null}

      {/* ➕ Solicitar incluir una jugada que no aparece (PROMPT #6). La fecha
          está restringida por la ventana del grupo. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 shadow-sm">
        <div className="text-xs text-indigo-900 font-extrabold">
          ¿No te aparece una jugada que hiciste? Solicitá que la incluyan aquí:
        </div>
        <Button variant="default" size="sm" onClick={() => setNoRelAbierta(true)}>
          <span className="mr-1">➕</span> Solicitar Incluir Jugada No Relacionada
        </Button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="bg-slate-900 px-4 py-3 text-xs font-black uppercase tracking-wider text-white border-b border-slate-800">
          <span className="mr-1 text-amber-400">🗒️</span> Últimos movimientos
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] font-black uppercase tracking-wider text-slate-700 bg-slate-100">
                <th className="px-3 py-2.5">Fecha</th>
                <th className="px-3 py-2.5">Hipódromo / Carrera</th>
                <th className="px-3 py-2.5">Jugada</th>
                <th className="px-3 py-2.5">Caballo</th>
                <th className="px-3 py-2.5 text-right">Jugado</th>
                <th className="px-3 py-2.5 text-right">Decidido</th>
                {mostrarIncentivo ? (
                  <th className="px-3 py-2.5 text-right text-purple-800">Incentivo</th>
                ) : null}
                <th className="px-3 py-2.5">Estado</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {jugadas.map((j) => {
                const reclamable = dentroDeVentana(j.fechaCarrera ?? j.fecha, hoy, ventana, ciclo);
                return (
                  <tr key={j.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-3 py-2 whitespace-nowrap font-medium text-slate-700">{j.fechaTexto}</td>
                    <td className="px-3 py-2 font-extrabold text-slate-900">
                      {nombreHipodromoParaMostrar(j.hipodromo)} <span className="text-slate-600 font-bold">· C{j.carrera}</span>
                    </td>
                    <td className="px-3 py-2 font-bold text-slate-800">{j.jugada}</td>
                    <td className="px-3 py-2 font-bold text-slate-900">{j.caballo}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">{formatoMoneda(j.moneda, j.montoJugado)}</td>
                    <td className="px-3 py-2 text-right font-mono font-black text-slate-950">{formatoMoneda(j.moneda, j.montoDecidido)}</td>
                    {mostrarIncentivo ? (
                      <td className="px-3 py-2 text-right font-mono font-black text-purple-800">{formatoMoneda(j.moneda, j.devolucion)}</td>
                    ) : null}
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${BADGE[j.estado] ?? "bg-slate-200 text-slate-800"}`}>
                        {j.estado}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="outline" size="sm" onClick={() => setDisputa(j)} title="Disputar esta jugada">
                          <span className="text-amber-600">⚖️</span> Disputar
                        </Button>
                        {reclamable ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void reclamar(j.id)}
                            title="Reclamar esta jugada"
                          >
                            <span className="text-red-500">🛡️</span> Reclamar Jugada
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {jugadas.length === 0 ? (
                <tr>
                  <td colSpan={mostrarIncentivo ? 9 : 8} className="px-3 py-10 text-center text-slate-500 font-semibold">
                    <span className="mr-2">📥</span> Sin movimientos registrados.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {disputa ? (
        <DisputarModal jugada={disputa} onCerrar={() => setDisputa(null)} onEnviar={(d) => void confirmarDisputa(d)} />
      ) : null}

      {noRelAbierta ? (
        <ModalJugadaNoRelacionada
          sesion={sesion}
          ventana={ventana}
          ciclo={ciclo}
          onCerrar={() => setNoRelAbierta(false)}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Disputar jugada (Ctrl+V para pegar imagen de soporte)
// ---------------------------------------------------------------------------

function DisputarModal({
  jugada,
  onCerrar,
  onEnviar,
}: {
  jugada: { id: string; hipodromo: string; carrera: number; jugada: string; caballo: string; montoJugado: number; moneda: string };
  onCerrar: () => void;
  onEnviar: (d: { motivo: string; image?: File | null }) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [imagen, setImagen] = useState<File | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");

  const areaRef = (el: HTMLDivElement | null) => {
    if (el) el.focus();
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of items) {
      if (it.type.startsWith("image/")) {
        const archivo = it.getAsFile();
        if (archivo) {
          setImagen(archivo);
          setPrevia(URL.createObjectURL(archivo));
          setAviso("📸 Imagen capturada del portapapeles.");
          e.preventDefault();
          return;
        }
      }
    }
    setAviso("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" role="dialog" aria-modal>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-800">
            <span className="mr-1 text-amber-600">⚖️</span> Disputar jugada
          </h3>
          <button onClick={onCerrar} className="text-slate-400 hover:text-slate-600" aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <b>{nombreHipodromoParaMostrar(jugada.hipodromo)} · Carrera {jugada.carrera}</b> · {jugada.jugada} · {jugada.caballo} ·{" "}
          <span className="font-mono">{formatoMoneda(jugada.moneda, jugada.montoJugado)}</span>
        </div>

        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Motivo de la disputa *</label>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value.toUpperCase())}
            className="w-full border border-line rounded-xl bg-surface px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-200 resize-none uppercase"
            rows={2}
            placeholder="Ej. EL PREMIO PAGADO NO CORRESPONDE A MI JUGADA…"
          />
        </div>

        <div
          ref={areaRef}
          tabIndex={0}
          onPaste={onPaste}
          className="rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/40 p-4 text-center outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
        >
          <div className="text-[11px] font-black uppercase tracking-wide text-amber-700">
            {imagen ? <span className="mr-1">🖼️</span> : <span className="mr-1">📋</span>}
            {imagen ? "Imagen adjunta" : "Pegá el comprobante (Ctrl+V)"}
          </div>
          <p className="mx-auto mt-1 max-w-[24ch] text-[10px] text-amber-600/80">
            Hacé clic aquí y presioná Ctrl+V con la captura en el portapapeles.
          </p>
          {previa ? (
            <img src={previa} alt="Comprobante" className="mx-auto mt-2 max-h-32 rounded-lg border border-amber-200 shadow-sm" />
          ) : null}
          {aviso ? <p className="mt-1 text-[10px] font-bold text-emerald-600">{aviso}</p> : null}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button
            variant="default"
            size="sm"
            className="bg-amber-600 hover:bg-amber-500"
            disabled={!motivo.trim()}
            onClick={() => onEnviar({ motivo, image: imagen })}
          >
            <span className="mr-1">📤</span> Enviar disputa
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reportar jugada faltante
// ---------------------------------------------------------------------------

function ReportarView({ cliente }: { cliente: SesionPortal["cliente"] }) {
  const [hipodromo, setHipodromo] = useState("");
  const [carrera, setCarrera] = useState("");
  const [nombreJugada, setNombreJugada] = useState("");
  const [caballo, setCaballo] = useState("");
  const [monto, setMonto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [imagen, setImagen] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    if (!hipodromo.trim() || !carrera.trim() || !motivo.trim()) return toast("Hipódromo, carrera y motivo son requeridos.", "warning");
    setEnviando(true);
    const r = await reportarJugadaFaltante({
      cliente,
      hipodromo: hipodromo.toUpperCase(),
      carrera: parseInt(carrera, 10) || 0,
      nombre_jugada: nombreJugada.trim().toUpperCase() || "JUGADA",
      caballo: caballo.trim().toUpperCase() || "—",
      monto: num(monto),
      motivo: motivo.trim().toUpperCase(),
      image: imagen,
    });
    setEnviando(false);
    if (!r.ok) return toast(r.error ?? "No se pudo reportar.", "error");
    toast("Jugada reportada. La casa la revisará y responderá.", "success");
    setMotivo("");
    setImagen(null);
  };

  const inp = "w-full border border-line rounded-xl bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-200 bg-surface"; 

  return (
    <div className="rounded-2xl border border-line bg-white p-5 shadow-sm space-y-3">
      <h2 className="text-sm font-black text-slate-800">
        <span className="mr-2 text-red-500">🚩</span> Reportar jugada faltante
      </h2>
      <p className="text-[11px] text-slate-500">Si tu jugada no aparece en los movimientos, repórtala con el comprobante (si aplica).</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Hipódromo *</label>
          <input value={hipodromo} onChange={(e) => setHipodromo(e.target.value.toUpperCase())} className={inp + " uppercase"} placeholder="ej. la Rinconada" />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Carrera *</label>
          <input value={carrera} onChange={(e) => setCarrera(e.target.value.replace(/\D/g, ""))} className={inp} placeholder="ej. 4" inputMode="numeric" />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Monto (USD)</label>
          <input value={monto} onChange={(e) => setMonto(e.target.value)} className={inp + " text-right font-mono"} placeholder="ej. 5" inputMode="decimal" />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Tipo de jugada</label>
          <input value={nombreJugada} onChange={(e) => setNombreJugada(e.target.value.toUpperCase())} className={inp + " uppercase"} placeholder="ej. PRIMERO" />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Caballo</label>
          <input value={caballo} onChange={(e) => setCaballo(e.target.value.toUpperCase())} className={inp + " uppercase"} placeholder="ej. PELUSA (3)" />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Imagen de soporte (opcional)</label>
          <input type="file" accept="image/*" onChange={(e) => setImagen(e.target.files?.[0] ?? null)} className={inp + " text-xs"} />
        </div>
        <div className="md:col-span-2">
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Motivo *</label>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value.toUpperCase())}
            className={inp + " uppercase resize-none"}
            rows={2}
            placeholder="Describa qué pasó (ej. ME PAGARON MENOS DE LO APOSTADO)…"
          />
        </div>
        <div className="flex items-end">
          <Button variant="danger" size="sm" className="w-full" disabled={enviando} onClick={() => void enviar()}>
            {enviando ? <span className="mr-1">⏳</span> : <span className="mr-1">📤</span>} Enviar reporte
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mis tickets (reclamos y disputas + encuesta 1-5)
// ---------------------------------------------------------------------------

function MisTicketsView({ cliente }: { cliente: SesionPortal["cliente"] }) {
  const [tickets, setTickets] = useState<TicketDisputa[]>([]);
  const [cargando, setCargando] = useState(true);

  const cargar = async () => {
    setCargando(true);
    setTickets(await listarMisTickets(cliente.id));
    setCargando(false);
  };

  useEffect(() => {
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliente.id]);

  const encuestar = async (t: TicketDisputa, puntuacion: number, comentario: string) => {
    const r = await encuestarTicket(t.id, puntuacion, comentario);
    if (!r.ok) return toast(r.error ?? "No se pudo guardar la encuesta.", "error");
    toast("¡Gracias por tu valoración!", "success");
    void cargar();
  };

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
        <h2 className="text-sm font-black text-slate-800">
          <span className="mr-2 text-sky-600">🛟</span> Mis tickets y reclamos
        </h2>
        <p className="mt-1 text-[11px] text-slate-500">
          Estado de tus reportes de jugada faltante y disputas. Cuando la casa responda, podrás valorar la atención con 1 a 5 estrellas.
        </p>
      </div>

      {cargando ? (
        <div className="rounded-2xl bg-white p-8 text-center text-slate-400">
          <span className="text-xl">⏳</span>
        </div>
      ) : tickets.length === 0 ? (
        <div className="rounded-2xl bg-white p-8 text-center text-slate-400">
          <span className="mr-2">📥</span> No tienes tickets abiertos.
        </div>
      ) : (
        tickets.map((t) => <MtCard key={String(t.id)} t={t} onEncuesta={(p, c) => void encuestar(t, p, c)} />)
      )}
    </div>
  );
}

function MtCard({ t, onEncuesta }: { t: TicketDisputa; onEncuesta: (puntuacion: number, comentario: string) => void }) {
  const [estrella, setEstrella] = useState(0);
  const [hover, setHover] = useState(0);
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);

  const badge =
    t.estado === "SOLUCIONADO"
      ? "bg-emerald-100 text-emerald-700"
      : t.estado === "EN_REVISION"
      ? "bg-amber-100 text-amber-700"
      : "bg-sky-100 text-sky-700";

  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-sm space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
            <span className="text-xs leading-none">{t.tipo_jugada === "REPORTE_FALTANTE" ? "\u{1F6A9}" : "\u2696\uFE0F"}</span>
          </span>
          <div>
            <div className="text-xs font-black text-slate-800">
              T-{t.numero_ticket ?? String(t.id).slice(0, 6)} · {t.motivo || t.tipo_jugada}
            </div>
            <div className="text-[10px] text-slate-400">
              {t.hipodromo ? `${nombreHipodromoParaMostrar(t.hipodromo)}${t.carrera ? ` · Carrera ${t.carrera}` : ""}` : t.fecha_jugada ? String(t.fecha_jugada).slice(0, 10) : ""}
              {t.hipodromo && t.fecha_jugada ? ` · ${String(t.fecha_jugada).slice(0, 10)}` : ""}
            </div>
          </div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${badge}`}>
          {t.estado?.replace("_", " ") ?? "—"}
        </span>
      </div>

        {t.imagen_soporte ? (
          <button
            type="button"
            onClick={async () => {
              const url = await resolverImagenReclamo(t.imagen_soporte as string);
              if (url) window.open(url, "_blank", "noreferrer");
            }}
            className="block text-left text-[11px] font-bold text-sky-600 underline"
          >
            <span className="mr-1">🖼️</span> Ver comprobante adjunto
          </button>
        ) : null}

      {t.estado === "SOLUCIONADO" ? (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs">
          <div className="font-bold text-emerald-800">
            {t.accion_aplicada ? `${t.accion_aplicada}${num(t.monto_resuelto) > 0 ? ` de ${formatoMoneda("USD", num(t.monto_resuelto))}` : ""}` : "Atendido"}
            {t.respuesta_casa ? ` — ${t.respuesta_casa}` : ""}
          </div>

          {t.encuesta_satisfaccion != null ? (
            <div className="mt-1.5 text-slate-600">
              <span className="text-amber-500">{Array.from({ length: t.encuesta_satisfaccion }).map((_, i) => <span key={i} className="text-xs">⭐</span>)}</span>
              {t.encuesta_comentario ? <span className="ml-1">· “{t.encuesta_comentario}”</span> : null}
            </div>
          ) : (
            <div className="mt-2">
              <div className="mb-1 text-[9px] font-black uppercase text-emerald-600">¿Cómo calificas la atención?</div>
              <div className="flex gap-1 text-xl">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onMouseEnter={() => setHover(n)}
                    onMouseLeave={() => setHover(0)}
                    onClick={() => setEstrella(n)}
                    className={n <= (hover || estrella) ? "text-amber-400" : "text-slate-300"}
                    aria-label={`${n} estrellas`}
                  >
                    <span >⭐</span>
                  </button>
                ))}
              </div>
              <input
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
                className="mt-2 w-full border border-line rounded-xl bg-white px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-emerald-200 uppercase"
                placeholder="Comentario (opcional)…"
              />
              <button
                type="button"
                disabled={estrella === 0 || enviando}
                onClick={() => {
                  setEnviando(true);
                  onEncuesta(estrella, comentario);
                }}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
              >
                {enviando ? <span >⏳</span> : <span >⭐</span>} Enviar valoración
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-slate-500">
          <span className="mr-1 text-amber-500">⏳</span> La casa está revisando este ticket. Te avisaremos con la respuesta.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comprar tablas fijas (solicitud → valida el admin)
// ---------------------------------------------------------------------------

function ComprarView({ cliente }: { cliente: SesionPortal["cliente"] }) {
  const [tablas, setTablas] = useState<TablaFijaRow[]>([]);
  const [tablaId, setTablaId] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    void listarTablasPublicadas().then((t) => {
      setTablas(t);
      if (t[0]) setTablaId(String(t[0].id));
    });
  }, []);

  const tabla = tablas.find((t) => String(t.id) === String(tablaId)) ?? null;

  const pedir = async () => {
    if (!tabla) return toast("No hay tablas publicadas para comprar.", "warning");
    const ejemplar = Array.isArray(tabla.caballos) && tabla.caballos[0] ? tabla.caballos[0] : null;
    const premio = tabla.premio_recalculado ?? tabla.premio_original ?? 0;
    if (!ejemplar) return toast("La tabla no tiene ejemplares cargados.", "warning");
    setEnviando(true);
    const r = await solicitarCompraTabla({
      cliente,
      tablaId: tabla.id,
      hipodromo: tabla.hipodromo ?? "—",
      carrera: tabla.carrera ?? 0,
      ejemplarNumero: String(ejemplar.numero),
      ejemplarNombre: ejemplar.nombre,
      cantidad: parseInt(cantidad, 10) || 1,
      premioPorTabla: premio,
      moneda: tabla.moneda ?? "USD",
      costoUsd: premio * (parseInt(cantidad, 10) || 1),
    });
    setEnviando(false);
    if (!r.ok) return toast(r.error ?? "No se pudo solicitar.", "error");
    toast("Solicitud enviada. El administrador la validará.", "success");
    setCantidad("1");
  };

  const costo = (tabla?.premio_recalculado ?? tabla?.premio_original ?? 0) * (parseInt(cantidad, 10) || 1);

  return (
    <div className="rounded-2xl border border-line bg-white p-5 shadow-sm space-y-3">
      <h2 className="text-sm font-black text-slate-800">
        <span className="mr-2 text-indigo-600">🛒</span> Comprar tablas fijas
      </h2>
      <p className="text-[11px] text-slate-500">Solicita tu tabla; la casa la valida y confirma por los canales de pago registrados.</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Carrera publicada</label>
          <select value={tablaId} onChange={(e) => setTablaId(e.target.value)} className="w-full border border-line rounded-xl bg-surface px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-200">
            <option value="">— Seleccione —</option>
            {tablas.map((t) => (
              <option key={String(t.id)} value={String(t.id)}>
                {nombreHipodromoParaMostrar(t.hipodromo)} · Carrera {t.carrera} · Premio {formatoMoneda(t.moneda, t.premio_original)} {t.caballos ? `(${t.caballos.length} ejemplares)` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Cantidad de tablas</label>
          <input value={cantidad} onChange={(e) => setCantidad(e.target.value.replace(/\D/g, ""))} className="w-full border border-line rounded-xl bg-surface px-3 py-2.5 text-right text-sm outline-none focus:ring-2 focus:ring-indigo-200 font-mono" inputMode="numeric" />
        </div>
        <div className="flex items-end">
          <div className="w-full rounded-xl bg-indigo-50 border border-indigo-100 px-3 py-2.5">
            <div className="text-[9px] font-black uppercase text-indigo-400">Costo estimado</div>
            <div className="text-base font-black text-indigo-700">{tabla ? formatoMoneda(tabla.moneda, costo) : "—"}</div>
          </div>
        </div>
      </div>

      {tabla && Array.isArray(tabla.caballos) && tabla.caballos.length ? (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[9px] font-black uppercase tracking-wider text-slate-400 bg-slate-50">
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Ejemplar</th>
                <th className="px-3 py-2 text-right">Valor</th>
                <th className="px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {tabla.caballos.map((e) => (
                <tr key={String(e.numero)} className="border-t border-line">
                  <td className="px-3 py-2 font-black">{e.numero}</td>
                  <td className="px-3 py-2 font-bold text-slate-700">{e.nombre}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatoMoneda(tabla.moneda, e.valor_ejemplar)}</td>
                  <td className="px-3 py-2">
                    {e.retirado ? <span className="rounded-full bg-red-100 px-2 py-0.5 text-[9px] font-black text-red-600 uppercase">Retirado</span> : <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black text-emerald-700 uppercase">Activo</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button variant="default" size="sm" disabled={enviando || !tabla} onClick={() => void pedir()}>
          {enviando ? <span className="mr-1">⏳</span> : <span className="mr-1">📤</span>} Solicitar compra
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mis datos (envía notificación al admin)
// ---------------------------------------------------------------------------

function DatosView({
  cliente,
  onActualizado,
}: {
  cliente: SesionPortal["cliente"];
  onActualizado?: (c: SesionPortal["cliente"]) => void;
}) {
  const tel = desglosarTelefono(cliente.telefono);
  const [seudonimo, setSeudonimo] = useState(cliente.seudonimo || "");
  const [nombre, setNombre] = useState(cliente.nombre || "");
  const [apellido, setApellido] = useState(cliente.apellido || "");
  const [cedulaRif, setCedulaRif] = useState(cliente.cedula_rif || "");
  const [codigoPais, setCodigoPais] = useState(cliente.codigo_pais || tel.codigo || "+58");
  const [telefono, setTelefono] = useState(tel.numero);
  const [email, setEmail] = useState(cliente.email || "");
  const [direccion, setDireccion] = useState(cliente.direccion || "");
  const [diaCuadre, setDiaCuadre] = useState(cliente.dia_cuadre || "Lunes");
  const [formaCuadre, setFormaCuadre] = useState(cliente.forma_cuadre || "Semanal");
  const [formasPago, setFormasPago] = useState<FormaPago[]>(() => formasPagoDe(cliente));
  const [claveNueva, setClaveNueva] = useState("");
  const [enviando, setEnviando] = useState(false);

  const telefonoFormateado = () => {
    const dig = telefono.replace(/[^\d]/g, "");
    const t = codigoPais + " " + dig;
    return codigoPais === "+58" && dig.startsWith("0") ? codigoPais + " " + dig.slice(1) : t;
  };

  const enviar = async () => {
    if (!nombre.trim() && !seudonimo.trim()) {
      return toast("El nombre o seudónimo es obligatorio.", "warning");
    }
    setEnviando(true);
    const limFormas = normalizarFormasPago(formasPago);
    const r = await actualizarDatosCliente(cliente, {
      seudonimo: seudonimo.trim().toUpperCase() || null,
      nombre: nombre.trim().toUpperCase() || seudonimo.trim().toUpperCase(),
      apellido: apellido.trim().toUpperCase() || null,
      cedula_rif: cedulaRif.trim().toUpperCase() || null,
      codigo_pais: codigoPais,
      telefono: telefonoFormateado(),
      email: email.trim() || null,
      direccion: direccion.trim().toUpperCase() || null,
      dia_cuadre: diaCuadre || null,
      forma_cuadre: formaCuadre || null,
      formas_pago: limFormas,
      metodo_pago: limFormas[0]?.metodo || cliente.metodo_pago || null,
      datos_pago: limFormas[0]?.datos || cliente.datos_pago || null,
      ...(claveNueva.trim() ? { portal_clave: claveNueva.trim().toUpperCase() } : {}),
    });
    setEnviando(false);
    if (!r.ok) return toast(r.error ?? "No se pudo actualizar.", "error");
    if (r.cliente && onActualizado) onActualizado(r.cliente);
    setClaveNueva("");
    toast("✅ Todos tus datos de registro fueron actualizados y vinculados con la administración.", "success");
  };

  const inp =
    "w-full border border-line rounded-xl bg-surface px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-200";

  return (
    <div className="rounded-2xl border border-line bg-white p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-black text-slate-800">
            <span className="mr-2 text-indigo-600">🪪</span> Mis Datos de Registro (Sincronizado con tu Ficha Oficial)
          </h2>
          <p className="text-[11px] text-slate-500">
            Actualizá todos los datos solicitados en el registro directo del portal: identidad, contacto, cuadre, métodos de pago y PIN.
          </p>
        </div>
        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-800">
          🔗 Vinculado en tiempo real
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
            Seudónimo / Usuario
          </label>
          <input
            value={seudonimo}
            onChange={(e) => setSeudonimo(e.target.value.toUpperCase())}
            className={inp + " font-black uppercase"}
            placeholder="EJ: EL REY"
          />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
            Nombres
          </label>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value.toUpperCase())}
            className={inp + " uppercase"}
            placeholder="JUAN CARLOS"
          />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
            Apellidos
          </label>
          <input
            value={apellido}
            onChange={(e) => setApellido(e.target.value.toUpperCase())}
            className={inp + " uppercase"}
            placeholder="PÉREZ"
          />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
            Cédula / RIF / Pasaporte
          </label>
          <input
            value={cedulaRif}
            onChange={(e) => setCedulaRif(e.target.value.toUpperCase())}
            className={inp + " font-mono uppercase"}
            placeholder="V-12.345.678"
          />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
            Código de país
          </label>
          <select
            value={codigoPais}
            onChange={(e) => setCodigoPais(e.target.value)}
            className={inp + " font-bold"}
          >
            {codigosPaisUnicos().map((p) => (
              <option key={p.codigo} value={p.codigo}>
                {p.codigo} {p.pais}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
            Teléfono / WhatsApp
          </label>
          <input
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            className={inp + " font-mono"}
            placeholder="412 123 4567"
          />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
            Correo electrónico
          </label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inp}
            type="email"
            placeholder="cliente@correo.com"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
            Dirección / Ciudad
          </label>
          <input
            value={direccion}
            onChange={(e) => setDireccion(e.target.value.toUpperCase())}
            className={inp + " uppercase"}
            placeholder="CARACAS, VENEZUELA"
          />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
            Día de Cuadre Preferido
          </label>
          <select
            value={diaCuadre}
            onChange={(e) => setDiaCuadre(e.target.value)}
            className={inp + " font-bold"}
          >
            {["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
            Frecuencia / Forma de Cuadre
          </label>
          <select
            value={formaCuadre}
            onChange={(e) => setFormaCuadre(e.target.value)}
            className={inp + " font-bold"}
          >
            {["Semanal", "Diario", "Por Jornada", "Quincenal"].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
            Cambiar Contraseña / PIN Portal (Opcional)
          </label>
          <input
            value={claveNueva}
            onChange={(e) => setClaveNueva(e.target.value.toUpperCase().slice(0, 8))}
            className={inp + " font-mono uppercase"}
            placeholder="4 a 8 caracteres (dejar vacío si no cambia)"
          />
        </div>
      </div>

      {/* Formas de Pago y Cobro vinculadas */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
        <FormasPagoLista prefijo="datos" formas={formasPago} onChange={setFormasPago} />
      </div>

      <div className="flex justify-end">
        <Button variant="default" size="sm" disabled={enviando} onClick={() => void enviar()}>
          {enviando ? <span className="mr-1">⏳</span> : <span className="mr-1">💾</span>} Guardar y sincronizar mis datos
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 👤 Mi Perfil — autogestión de datos personales (PROMPT #7)
// ---------------------------------------------------------------------------

/**
 * Modal de autogestión: el cliente actualiza su nombre completo, teléfono /
 * WhatsApp, correo, PIN de acceso y sus formas de cobro/pago PERSONALES.
 *
 * A diferencia de `DatosView` (que deja una solicitud para que el admin la
 * aplique), acá los cambios se guardan directo en Supabase vía la acción
 * `perfil` de la Edge Function, que aplica una lista blanca de columnas: nada
 * de saldo, comisión, aval, devolución ni credenciales del portal. Se avisa con
 * toast de éxito y se devuelve la fila actualizada a la sesión.
 */
function MiPerfilModal({
  cliente,
  onCerrar,
  onGuardado,
}: {
  cliente: SesionPortal["cliente"];
  onCerrar: () => void;
  onGuardado: (c: SesionPortal["cliente"]) => void;
}) {
  const tel = desglosarTelefono(cliente.telefono);
  const [seudonimo, setSeudonimo] = useState(cliente.seudonimo || "");
  const [nombre, setNombre] = useState(cliente.nombre || "");
  const [apellido, setApellido] = useState(cliente.apellido || "");
  const [cedulaRif, setCedulaRif] = useState(cliente.cedula_rif || "");
  const [codigoPais, setCodigoPais] = useState(cliente.codigo_pais || tel.codigo || "+58");
  const [telefono, setTelefono] = useState(tel.numero);
  const [email, setEmail] = useState(cliente.email || "");
  const [direccion, setDireccion] = useState(cliente.direccion || "");
  const [diaCuadre, setDiaCuadre] = useState(cliente.dia_cuadre || "Lunes");
  const [formaCuadre, setFormaCuadre] = useState(cliente.forma_cuadre || "Semanal");
  const [formas, setFormas] = useState<FormaPago[]>(() => formasPagoDe(cliente));
  const [claveActual, setClaveActual] = useState("");
  const [claveNueva, setClaveNueva] = useState("");
  const [claveRepetir, setClaveRepetir] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const inp =
    "w-full border border-indigo-200 rounded-xl bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";
  const lbl = "block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1";

  const telefonoFormateado = () => {
    const dig = telefono.replace(/[^\d]/g, "");
    const t = codigoPais + " " + dig;
    return codigoPais === "+58" && dig.startsWith("0") ? codigoPais + " " + dig.slice(1) : t;
  };

  const guardar = async () => {
    setError("");
    const nombreLimpio = nombre.trim().toUpperCase();
    if (!nombreLimpio) return setError("El nombre completo es obligatorio.");
    if (email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()))
      return setError("El correo no tiene un formato válido (ej. juan@correo.com).");
    if (formas.some((f) => !String(f.metodo ?? "").trim()))
      return setError("Cada forma de pago necesita un método seleccionado (o quitela con 🗑️).");

    const clave = String(claveNueva).trim().toUpperCase();
    if (claveNueva || claveRepetir) {
      const errClave = validarClaveAcceso(clave, { min: 4, max: 8 });
      if (errClave) return setError(errClave);
      if (clave !== String(claveRepetir).trim().toUpperCase())
        return setError("La confirmación no coincide con la contraseña / PIN nuevo.");
    }

    setGuardando(true);
    const r = await actualizarMiPerfil({
      seudonimo: seudonimo.trim().toUpperCase() || undefined,
      nombre: nombreLimpio,
      apellido: apellido.trim().toUpperCase() || undefined,
      cedula_rif: cedulaRif.trim().toUpperCase() || undefined,
      codigo_pais: codigoPais,
      telefono: telefonoFormateado(),
      email: email.trim(),
      direccion: direccion.trim().toUpperCase() || undefined,
      dia_cuadre: diaCuadre,
      forma_cuadre: formaCuadre,
      formas_pago: normalizarFormasPago(formas),
      clave_actual: claveActual.trim().toUpperCase(),
      clave_nueva: clave,
    });
    setGuardando(false);
    if (!r.ok) return setError(r.error ?? "No se pudieron guardar los datos.");
    toast("✅ Datos personales actualizados y sincronizados correctamente.", "success");
    onGuardado(r.cliente ?? cliente);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 p-4">
      <div className="mx-auto my-6 w-full max-w-2xl rounded-2xl border border-line bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-black text-slate-800">
              <span className="mr-2">👤</span> Mi Perfil — Actualizar Todos los Datos de Registro
            </h2>
            <p className="text-[11px] text-slate-500">
              Tus datos se guardan directamente en tu ficha oficial y quedan vinculados con el sistema.
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="rounded-lg border border-line px-2 py-1 text-sm text-slate-500 transition hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className={lbl}>Seudónimo / Usuario</label>
              <input
                value={seudonimo}
                onChange={(e) => setSeudonimo(e.target.value.toUpperCase())}
                className={inp + " font-black uppercase"}
                placeholder="EJ: EL REY"
              />
            </div>
            <div>
              <label className={lbl}>Nombres</label>
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                className={inp + " uppercase"}
                placeholder="JUAN"
                data-testid="perfil-nombre"
              />
            </div>
            <div>
              <label className={lbl}>Apellidos</label>
              <input
                value={apellido}
                onChange={(e) => setApellido(e.target.value.toUpperCase())}
                className={inp + " uppercase"}
                placeholder="PÉREZ"
              />
            </div>
            <div>
              <label className={lbl}>Cédula / RIF</label>
              <input
                value={cedulaRif}
                onChange={(e) => setCedulaRif(e.target.value.toUpperCase())}
                className={inp + " font-mono uppercase"}
                placeholder="V-12.345.678"
              />
            </div>
            <div>
              <label className={lbl}>Código de país</label>
              <select value={codigoPais} onChange={(e) => setCodigoPais(e.target.value)} className={inp + " font-bold"}>
                {codigosPaisUnicos().map((p) => (
                  <option key={p.codigo} value={p.codigo}>
                    {p.codigo} {p.pais}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={lbl}>Teléfono / WhatsApp</label>
              <input
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                className={inp + " font-mono"}
                placeholder="412 123 4567"
                data-testid="perfil-telefono"
              />
            </div>
            <div>
              <label className={lbl}>Correo electrónico</label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inp}
                type="email"
                placeholder="juan@correo.com"
                data-testid="perfil-email"
              />
            </div>
            <div className="md:col-span-2">
              <label className={lbl}>Dirección</label>
              <input
                value={direccion}
                onChange={(e) => setDireccion(e.target.value.toUpperCase())}
                className={inp + " uppercase"}
                placeholder="CARACAS"
              />
            </div>
            <div>
              <label className={lbl}>Día de Cuadre</label>
              <select value={diaCuadre} onChange={(e) => setDiaCuadre(e.target.value)} className={inp + " font-bold"}>
                {["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={lbl}>Forma de Cuadre</label>
              <select value={formaCuadre} onChange={(e) => setFormaCuadre(e.target.value)} className={inp + " font-bold"}>
                {["Semanal", "Diario", "Por Jornada", "Quincenal"].map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
            <div className="text-[10px] font-black uppercase tracking-wider text-indigo-700">
              🔑 Contraseña / PIN de acceso (opcional)
            </div>
            <p className="mt-0.5 text-[10px] text-slate-500">
              Déjalo vacío para no cambiarlo. Si lo cambias, escribe el PIN actual. Se guarda en mayúsculas (igual
              que lo escribe el login). El PIN nuevo debe tener de 4 a 8 caracteres.
            </p>
            <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <label className={lbl}>PIN actual</label>
                {/*
                  SIN maxLength: el PIN actual es el que ya está guardado y puede
                  ser más largo que 8 (p. ej. "JUGADOR123"). Recortarlo acá hacía
                  imposible cambiar el PIN: la comparación del servidor fallaba
                  contra el valor truncado. El tope 4–8 aplica al PIN NUEVO, no
                  al vigente.
                */}
                <input
                  value={claveActual}
                  onChange={(e) => setClaveActual(e.target.value.toUpperCase())}
                  className={inp + " font-mono uppercase"}
                  placeholder="XXXX"
                  maxLength={MAX_CLAVE}
                  autoComplete="current-password"
                  data-testid="perfil-clave-actual"
                />
              </div>
              <div>
                <label className={lbl}>PIN nuevo</label>
                <input
                  value={claveNueva}
                  onChange={(e) => setClaveNueva(e.target.value.toUpperCase())}
                  className={inp + " font-mono uppercase"}
                  placeholder="XXXX"
                  maxLength={8}
                  autoComplete="new-password"
                  data-testid="perfil-clave-nueva"
                />
              </div>
              <div>
                <label className={lbl}>Repetir PIN nuevo</label>
                <input
                  value={claveRepetir}
                  onChange={(e) => setClaveRepetir(e.target.value.toUpperCase())}
                  className={inp + " font-mono uppercase"}
                  placeholder="XXXX"
                  maxLength={8}
                  autoComplete="new-password"
                  data-testid="perfil-clave-repetir"
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
            <div className="text-[10px] font-black uppercase tracking-wider text-emerald-700">
              💳 Formas de cobro / pago personales
            </div>
            <p className="mt-0.5 text-[10px] text-slate-500">
              Una o más: Pago Móvil, Transferencia, Zelle, Binance/USDT, Efectivo… La ⭐ es la que se usa para
              pagarte / cobrarte.
            </p>
            <div className="mt-2">
              <FormasPagoLista prefijo="perfil" formas={formas} onChange={setFormas} />
            </div>
          </div>

          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
              <span className="mr-1">⚠️</span>
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onCerrar}>
              Cancelar
            </Button>
            <Button variant="default" size="sm" disabled={guardando} onClick={() => void guardar()} data-testid="perfil-guardar">
              {guardando ? <span className="mr-1">⏳</span> : <span className="mr-1">💾</span>} Guardar cambios
            </Button>
          </div>
        </div>
      </div>
      <ToastHost />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 📓 Bitácora personal en otros grupos externos (PROMPT #7)
// ---------------------------------------------------------------------------

type FormJugadaExterna = {
  fecha: string;
  hipodromo: string;
  carrera: string;
  tipo_jugada: string;
  ejemplares: string;
  monto: string;
  estado: string;
};

const formaJugadaVacia = (): FormJugadaExterna => ({
  fecha: isoLocal(new Date()),
  hipodromo: "",
  carrera: "",
  tipo_jugada: "JUGADA",
  ejemplares: "",
  monto: "",
  estado: ESTADO_POR_DEFECTO,
});

/**
 * 📓 Mi Control en Otros Grupos (Personal) — libro privado del usuario para
 * grupos que NO están en la plataforma.
 *
 * El usuario crea sus grupos externos (nombre, moneda, % de comisión), anota
 * sus jugadas (fecha, hipódromo, carrera, tipo de jugada, ejemplares, monto y
 * estado PENDIENTE / GANÓ / PERDIÓ / ANULADA) y ve el resumen calculado con la
 * comisión de ese grupo.
 *
 * AISLAMIENTO: todo vive en `portal_grupos_externos` / `portal_jugadas_externas`
 * (RLS sin políticas, solo la Edge Function con service_role). No hay ninguna
 * relación con `tickets_apuestas`, `grupos_*`, `cuaderno_jugadas`, las cajas ni
 * los reportes oficiales: anotar acá no mueve un saldo ni cambia un total.
 */
function BitacoraExternaView({ cliente }: { cliente: SesionPortal["cliente"] }) {
  const [grupos, setGrupos] = useState<GrupoExterno[]>([]);
  const [cargandoGrupos, setCargandoGrupos] = useState(true);
  const [grupoId, setGrupoId] = useState("");
  const [jugadas, setJugadas] = useState<JugadaExterna[]>([]);
  const [cargandoJugadas, setCargandoJugadas] = useState(false);

  const [panelGrupo, setPanelGrupo] = useState(false);
  const [editGrupo, setEditGrupo] = useState<GrupoExterno | null>(null);
  const [gNombre, setGNombre] = useState("");
  const [gMoneda, setGMoneda] = useState("USD");
  const [gComision, setGComision] = useState("0");
  const [guardandoGrupo, setGuardandoGrupo] = useState(false);

  const [form, setForm] = useState<FormJugadaExterna>(formaJugadaVacia);
  const [editJugadaId, setEditJugadaId] = useState<string | number | null>(null);
  const [guardandoJugada, setGuardandoJugada] = useState(false);
  const [filtroHipodromo, setFiltroHipodromo] = useState("");
  const [catalogoHipodromos, setCatalogoHipodromos] = useState<string[]>([]);

  const inp =
    "w-full border border-line rounded-xl bg-surface px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-200";
  const lbl = "block text-[10px] font-black uppercase text-slate-500 mb-1";

  const grupo = grupos.find((g) => String(g.id) === grupoId) ?? null;
  const monedaGrupo = String(grupo?.moneda ?? "USD").toUpperCase() || "USD";
  const resumen = useMemo(() => resumenGrupoExterno(jugadas, grupo?.comision_pct ?? 0), [jugadas, grupo]);

  const hipodromosRegistrados = useMemo(() => {
    const set = new Set<string>();
    // Los registrados en el catálogo de hipódromos (fuente principal)...
    for (const h of catalogoHipodromos) {
      const n = String(h ?? "").trim().toUpperCase();
      if (n) set.add(n);
    }
    // ...más los que ya aparecen en las jugadas anotadas (datos viejos).
    for (const j of jugadas) {
      const h = String(j.hipodromo ?? "").trim().toUpperCase();
      if (h) set.add(h);
    }
    return Array.from(set).sort();
  }, [catalogoHipodromos, jugadas]);

  // Catálogo de hipódromos registrados (el filtro solo ofrece los registrados).
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const r = await listarHipodromos();
      if (!vivo || !r.ok) return;
      setCatalogoHipodromos((r.data ?? []).map((h) => String(h.nombre ?? "")));
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const jugadasFiltradas = useMemo(() => {
    if (!filtroHipodromo) return jugadas;
    return jugadas.filter((j) => String(j.hipodromo ?? "").trim().toUpperCase() === filtroHipodromo);
  }, [jugadas, filtroHipodromo]);

  // Grupos externos del cliente (una sola vez al montar).
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const r = await listarGruposExternos();
      if (!vivo) return;
      setCargandoGrupos(false);
      if (!r.ok) return toast(r.error ?? "No se pudieron cargar tus grupos externos.", "error");
      const gs = r.grupos ?? [];
      setGrupos(gs);
      if (gs.length) setGrupoId(String(gs[0].id));
    })();
    return () => {
      vivo = false;
    };
  }, []);

  // Jugadas del grupo seleccionado.
  useEffect(() => {
    if (!grupoId) {
      setJugadas([]);
      return;
    }
    let vivo = true;
    void (async () => {
      setCargandoJugadas(true);
      const r = await listarJugadasExternas(grupoId);
      if (!vivo) return;
      setCargandoJugadas(false);
      if (!r.ok) return toast(r.error ?? "No se pudieron cargar las jugadas.", "error");
      setJugadas(r.jugadas ?? []);
    })();
    return () => {
      vivo = false;
    };
  }, [grupoId]);

  const recargarGrupos = async (seleccionar?: string | number) => {
    const r = await listarGruposExternos();
    if (!r.ok) return toast(r.error ?? "No se pudieron cargar tus grupos externos.", "error");
    const gs = r.grupos ?? [];
    setGrupos(gs);
    if (seleccionar != null) setGrupoId(String(seleccionar));
    else if (!gs.length) setGrupoId("");
    else if (!gs.some((g) => String(g.id) === grupoId)) setGrupoId(String(gs[0].id));
  };

  const recargarJugadas = async () => {
    if (!grupoId) return;
    const r = await listarJugadasExternas(grupoId);
    if (!r.ok) return toast(r.error ?? "No se pudieron cargar las jugadas.", "error");
    setJugadas(r.jugadas ?? []);
  };

  const abrirAltaGrupo = () => {
    setEditGrupo(null);
    setGNombre("");
    setGMoneda(grupo?.moneda ?? "USD");
    setGComision(grupo?.comision_pct != null ? String(grupo.comision_pct) : "0");
    setPanelGrupo(true);
  };

  const abrirEdicionGrupo = (g: GrupoExterno) => {
    setEditGrupo(g);
    setGNombre(g.nombre);
    setGMoneda(g.moneda ?? "USD");
    setGComision(String(g.comision_pct ?? "0"));
    setPanelGrupo(true);
  };

  const guardarGrupo = async () => {
    setGuardandoGrupo(true);
    const r = await guardarGrupoExterno({
      id: editGrupo?.id,
      nombre: gNombre,
      moneda: gMoneda,
      comision_pct: gComision,
    });
    setGuardandoGrupo(false);
    if (!r.ok) return toast(r.error ?? "No se pudo guardar el grupo.", "error");
    setPanelGrupo(false);
    setEditGrupo(null);
    await recargarGrupos(editGrupo ? undefined : r.id);
    toast(editGrupo ? "Grupo externo actualizado." : "📓 Grupo externo creado.", "success");
  };

  const borrarGrupo = async () => {
    if (!grupo) return;
    const seguro = window.confirm(
      `¿Eliminar el grupo "${grupo.nombre}" y TODAS sus jugadas? Esta bitácora es personal y privada: no toca ningún grupo oficial.`
    );
    if (!seguro) return;
    const r = await eliminarGrupoExterno(grupo.id);
    if (!r.ok) return toast(r.error ?? "No se pudo eliminar el grupo.", "error");
    setGrupoId("");
    await recargarGrupos();
    toast("Grupo externo eliminado.", "success");
  };

  const guardarJugada = async () => {
    if (!grupo) return toast("Primero seleccioná o creá un grupo externo.", "warning");
    setGuardandoJugada(true);
    const r = await guardarJugadaExterna({
      id: editJugadaId ?? undefined,
      grupo_externo_id: grupo.id,
      fecha: form.fecha,
      hipodromo: form.hipodromo,
      carrera: form.carrera,
      tipo_jugada: form.tipo_jugada,
      ejemplares: form.ejemplares,
      monto: form.monto,
      estado: form.estado,
    });
    setGuardandoJugada(false);
    if (!r.ok) return toast(r.error ?? "No se pudo registrar la jugada.", "error");
    const eraEdicion = editJugadaId != null;
    setForm(formaJugadaVacia());
    setEditJugadaId(null);
    await recargarJugadas();
    toast(eraEdicion ? "Jugada actualizada." : "📓 Jugada registrada en tu bitácora personal.", "success");
  };

  const cargarJugada = (j: JugadaExterna) => {
    setEditJugadaId(j.id);
    setForm({
      fecha: String(j.fecha ?? "").slice(0, 10),
      hipodromo: String(j.hipodromo ?? ""),
      carrera: j.carrera != null ? String(j.carrera) : "",
      tipo_jugada: String(j.tipo_jugada ?? "JUGADA"),
      ejemplares: String(j.ejemplares ?? ""),
      monto: j.monto != null ? String(num(j.monto)) : "",
      estado: normalizarEstadoJugada(j.estado),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cambiarEstado = async (j: JugadaExterna, estado: string) => {
    const r = await guardarJugadaExterna({
      id: j.id,
      grupo_externo_id: j.grupo_externo_id,
      fecha: String(j.fecha ?? "").slice(0, 10),
      hipodromo: String(j.hipodromo ?? ""),
      carrera: j.carrera ?? undefined,
      tipo_jugada: String(j.tipo_jugada ?? ""),
      ejemplares: String(j.ejemplares ?? ""),
      monto: j.monto ?? undefined,
      estado,
    });
    if (!r.ok) return toast(r.error ?? "No se pudo cambiar el estado.", "error");
    await recargarJugadas();
  };

  const borrarJugada = async (j: JugadaExterna) => {
    if (!window.confirm("¿Eliminar esta jugada de tu bitácora personal?")) return;
    const r = await eliminarJugadaExterna(j.id);
    if (!r.ok) return toast(r.error ?? "No se pudo eliminar la jugada.", "error");
    await recargarJugadas();
    if (editJugadaId === j.id) {
      setEditJugadaId(null);
      setForm(formaJugadaVacia());
    }
    toast("Jugada eliminada.", "success");
  };

  const FILA_JUGADA = "border-t border-line px-3 py-2";

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-white p-5 shadow-sm space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-black text-slate-800">
              <span className="mr-2">📓</span> Mi Control en Otros Grupos (Personal)
            </h2>
            <p className="text-[11px] text-slate-500">
              Tu libro privado para jugar en grupos que no están en el sistema. Creá tus grupos (nombre, moneda y %
              de comisión) y anotá cada jugada con su estado.
            </p>
          </div>
          <Button variant="default" size="sm" onClick={abrirAltaGrupo} data-testid="bitacora-alta-grupo">
            <span className="mr-1">➕</span> Nuevo grupo externo
          </Button>
        </div>

        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
          <span className="mr-1">🔒</span>
          <b>Privado y aislado:</b> esta bitácora vive en tablas propias y <b>NO modifica la caja, los saldos ni
          los reportes de los grupos oficiales</b>. Solo la ves tú.
        </div>

        {/* Panel de alta / edición de grupo externo */}
        {panelGrupo ? (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 space-y-3" data-testid="bitacora-panel-grupo">
            <div className="text-[10px] font-black uppercase tracking-wider text-indigo-700">
              {editGrupo ? "✏️ Editar grupo externo" : "➕ Nuevo grupo externo"}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="md:col-span-1">
                <label className={lbl}>Nombre del grupo</label>
                <input
                  value={gNombre}
                  onChange={(e) => setGNombre(e.target.value.toUpperCase())}
                  className={inp + " uppercase"}
                  placeholder="EL CLUB DE JUAN"
                  maxLength={60}
                  data-testid="bitacora-grupo-nombre"
                />
              </div>
              <div>
                <label className={lbl}>Moneda</label>
                <input
                  value={gMoneda}
                  onChange={(e) => setGMoneda(e.target.value.toUpperCase())}
                  className={inp + " uppercase"}
                  placeholder="USD / VES"
                  maxLength={8}
                  data-testid="bitacora-grupo-moneda"
                />
              </div>
              <div>
                <label className={lbl}>Comisión del grupo (%)</label>
                <input
                  value={gComision}
                  onChange={(e) => setGComision(e.target.value.replace(/[^\d.]/g, ""))}
                  className={inp + " text-right font-mono"}
                  placeholder="10"
                  inputMode="decimal"
                  data-testid="bitacora-grupo-comision"
                />
              </div>
            </div>
            <p className="text-[10px] text-slate-500">
              La comisión se usa para calcular el premio: <b>premio = monto × (2 − comisión%)</b>. Ej.: con 10% y
              $10 apostados, el grupo devuelve $19.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPanelGrupo(false);
                  setEditGrupo(null);
                }}
              >
                Cancelar
              </Button>
              <Button variant="default" size="sm" disabled={guardandoGrupo} onClick={() => void guardarGrupo()}>
                {guardandoGrupo ? <span className="mr-1">⏳</span> : <span className="mr-1">💾</span>} Guardar grupo
              </Button>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className={lbl}>Grupo externo</label>
            <select
              value={grupoId}
              onChange={(e) => setGrupoId(e.target.value)}
              className={inp + " font-bold"}
              data-testid="bitacora-grupo-select"
            >
              <option value="">
                {cargandoGrupos ? "Cargando grupos…" : grupos.length ? "— Seleccione —" : "— Todavía no hay grupos —"}
              </option>
              {grupos.map((g) => (
                <option key={String(g.id)} value={String(g.id)}>
                  {g.nombre} · {String(g.moneda ?? "USD").toUpperCase()} · com. {num(g.comision_pct)}%
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled={!grupo} onClick={() => grupo && abrirEdicionGrupo(grupo)}>
              <span className="mr-1">✏️</span> Editar
            </Button>
            <Button variant="ghost" size="sm" disabled={!grupo} onClick={() => void borrarGrupo()}>
              <span className="mr-1">🗑️</span> Eliminar
            </Button>
          </div>
        </div>

        {/* Resumen de la bitácora del grupo seleccionado */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <ResumenBitacora icon="💸" lbl="Apostado (sin anuladas)" val={formatoMoneda(monedaGrupo, resumen.apostado)} color="text-slate-800" />
          <ResumenBitacora icon="🏆" lbl="Premios (par − comisión)" val={formatoMoneda(monedaGrupo, resumen.premios)} color="text-emerald-700" />
          <ResumenBitacora
            icon="⚖️"
            lbl="Neto"
            val={formatoMoneda(monedaGrupo, resumen.neto)}
            color={resumen.neto >= 0 ? "text-emerald-700" : "text-red-600"}
          />
          <ResumenBitacora icon="⏳" lbl="Pendiente" val={formatoMoneda(monedaGrupo, resumen.pendiente)} color="text-amber-600" />
        </div>
        <div className="text-[10px] text-slate-400">
          {resumen.jugadas} jugada(s) · {resumen.ganadas} ganada(s) · {resumen.perdidas} perdida(s) ·{" "}
          {resumen.anuladas} anulada(s) · Neto = premios − apostado.
        </div>
      </div>

      {/* Registro de jugadas */}
      <div className="rounded-2xl border border-line bg-white p-5 shadow-sm space-y-3">
        <h2 className="text-sm font-black text-slate-800">
          <span className="mr-2">🧾</span> {editJugadaId ? "Editar jugada" : "Registrar jugada"}
        </h2>

        <div className="flex flex-wrap items-end gap-2">
          <div className="w-36">
            <label className={lbl}>Fecha</label>
            <input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} className={inp} data-testid="bitacora-fecha" />
          </div>
          <div className="w-40">
            <label className={lbl}>Hipódromo</label>
            <input
              value={form.hipodromo}
              onChange={(e) => setForm({ ...form, hipodromo: e.target.value.toUpperCase() })}
              className={inp + " uppercase"}
              placeholder="LA PARAGUAITA"
              list="bitacora-hipodromos"
              data-testid="bitacora-hipodromo"
            />
            <datalist id="bitacora-hipodromos">
              {hipodromosRegistrados.map((h) => (
                <option key={h} value={h} />
              ))}
            </datalist>
          </div>
          <div className="w-24">
            <label className={lbl}>Carrera</label>
            <input
              value={form.carrera}
              onChange={(e) => setForm({ ...form, carrera: e.target.value.replace(/\D/g, "") })}
              className={inp + " text-right font-mono"}
              placeholder="5"
              inputMode="numeric"
              data-testid="bitacora-carrera"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className={lbl}>Ejemplares</label>
            <input
              value={form.ejemplares}
              onChange={(e) => setForm({ ...form, ejemplares: e.target.value.toUpperCase() })}
              className={inp + " uppercase"}
              placeholder="1-5 EL MAGO"
              data-testid="bitacora-ejemplares"
            />
          </div>
          <div className="w-32">
            <label className={lbl}>Monto</label>
            <input
              value={form.monto}
              onChange={(e) => setForm({ ...form, monto: e.target.value.replace(/[^\d.]/g, "") })}
              className={inp + " text-right font-mono"}
              placeholder="10"
              inputMode="decimal"
              data-testid="bitacora-monto"
            />
          </div>
          <div className="w-64">
            <label className={lbl}>Monto + Lo que gana - Lo que pierde</label>
            <div
              className="flex items-center justify-between gap-1.5 rounded-xl border border-line bg-slate-50 px-3 py-2.5 text-[11px] font-mono text-slate-700"
              data-testid="bitacora-resumen-jugada"
            >
              <span title="Monto apostado" className="font-black">
                {formatoMoneda(monedaGrupo, num(form.monto))}
              </span>
              <span className="text-slate-300">+</span>
              <span title="Lo que gana si acierta" className="font-black text-emerald-600">
                {formatoMoneda(monedaGrupo, premioGrupoExterno(form.monto, grupo?.comision_pct ?? 0))}
              </span>
              <span className="text-slate-300">-</span>
              <span title="Lo que pierde si falla" className="font-black text-red-500">
                {formatoMoneda(monedaGrupo, num(form.monto))}
              </span>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          {editJugadaId ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditJugadaId(null);
                setForm(formaJugadaVacia());
              }}
            >
              Cancelar edición
            </Button>
          ) : null}
          <Button variant="default" size="sm" disabled={guardandoJugada || !grupo} onClick={() => void guardarJugada()} data-testid="bitacora-guardar-jugada">
            {guardandoJugada ? <span className="mr-1">⏳</span> : <span className="mr-1">📓</span>}{" "}
            {editJugadaId ? "Guardar cambios" : "Registrar jugada"}
          </Button>
        </div>
        {!grupo ? <p className="text-[10px] text-slate-400">Seleccioná o creá un grupo externo para registrar jugadas.</p> : null}
      </div>

      {/* Listado de jugadas */}
      <div className="rounded-2xl border border-line bg-white p-5 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-black text-slate-800">
            <span className="mr-2">📒</span> Mis jugadas anotadas
          </h2>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Hipódromo</label>
            <select
              value={filtroHipodromo}
              onChange={(e) => setFiltroHipodromo(e.target.value)}
              className="rounded-xl border border-line bg-surface px-3 py-1.5 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-200"
              data-testid="bitacora-filtro-hipodromo"
            >
              <option value="">Todos</option>
              {hipodromosRegistrados.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>
        </div>

        {cargandoJugadas ? (
          <p className="text-[11px] text-slate-400">Cargando jugadas…</p>
        ) : !jugadas.length ? (
          <p className="rounded-xl border border-dashed border-line bg-slate-50 px-3 py-4 text-center text-[11px] text-slate-400">
            {grupoId ? "Todavía no anotaste jugadas en este grupo." : "Elegí un grupo (o creá uno) para empezar tu control."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr className="text-left text-[9px] font-black uppercase tracking-wider text-slate-400">
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Hipódromo</th>
                  <th className="px-3 py-2">Carrera</th>
                  <th className="px-3 py-2">Ejemplares</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {jugadasFiltradas.map((j, i) => {
                  const estado = normalizarEstadoJugada(j.estado);
                  return (
                    <tr key={String(j.id)} className="hover:bg-slate-50/70" data-testid={`bitacora-fila-${i}`}>
                      <td className={FILA_JUGADA + " font-mono"}>{String(j.fecha ?? "").slice(0, 10)}</td>
                      <td className={FILA_JUGADA + " font-bold text-slate-700"}>{String(j.hipodromo ?? "") || "—"}</td>
                      <td className={FILA_JUGADA + " text-right font-mono"}>{j.carrera != null ? String(j.carrera) : "—"}</td>
                      <td className={FILA_JUGADA + " max-w-[220px] truncate"} title={String(j.ejemplares ?? "")}>
                        {String(j.ejemplares ?? "") || "—"}
                      </td>
                      <td className={FILA_JUGADA + " text-right font-mono font-bold"}>{formatoMoneda(monedaGrupo, num(j.monto))}</td>
                      <td className={FILA_JUGADA}>
                        <select
                          value={estado}
                          onChange={(e) => void cambiarEstado(j, e.target.value)}
                          className={`rounded-lg border px-2 py-1 text-[10px] font-black uppercase tracking-wider outline-none ${
                            estado === "GANÓ"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : estado === "PERDIÓ"
                                ? "border-red-200 bg-red-50 text-red-600"
                                : estado === "ANULADA"
                                  ? "border-slate-200 bg-slate-100 text-slate-500"
                                  : "border-amber-200 bg-amber-50 text-amber-700"
                          }`}
                          data-testid={`bitacora-${i}-estado`}
                        >
                          {ESTADOS_JUGADA_EXTERNA.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={FILA_JUGADA + " text-right whitespace-nowrap"}>
                        <button
                          type="button"
                          onClick={() => cargarJugada(j)}
                          title="Editar jugada"
                          className="mr-1 rounded border border-line px-1.5 py-1 transition hover:bg-slate-100"
                          data-testid={`bitacora-${i}-editar`}
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          onClick={() => void borrarJugada(j)}
                          title="Eliminar jugada"
                          className="rounded border border-red-200 px-1.5 py-1 text-red-500 transition hover:bg-red-50"
                          data-testid={`bitacora-${i}-borrar`}
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {jugadas.length ? (
          <p className="text-[10px] text-slate-400">
            {resumen.jugadas} anotación(es) · Apostado {formatoMoneda(monedaGrupo, resumen.apostado)} · Neto{" "}
            {formatoMoneda(monedaGrupo, resumen.neto)} · Pendiente {formatoMoneda(monedaGrupo, resumen.pendiente)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Caja de resumen de la bitácora (Apostado / Premios / Neto / Pendiente). */
function ResumenBitacora({ icon, lbl, val, color }: { icon: string; lbl: string; val: string; color: string }) {
  return (
    <div className="rounded-xl border border-line bg-slate-50 px-3 py-2">
      <div className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-slate-400">
        <span>{icon}</span> {lbl}
      </div>
      <div className={`text-sm font-black ${color}`}>{val}</div>
    </div>
  );
}
