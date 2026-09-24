"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ToastHost } from "@/components/ui/ToastHost";
import { listarTablasPublicadas } from "@/lib/tablas/rpc";
import type { TablaFijaRow } from "@/lib/tablas-fijas";
import {
  actualizarDatosCliente,
  cerrarSesion,
  entrarPortal,
  reanudarSesion,
  reportarJugadaFaltante,
  reclamarJugada,
  solicitarCompraTabla,
  type SesionPortal,
} from "@/lib/portal";
import { codigosPaisUnicos, desglosarTelefono, formatoMoneda, listMetodosPago } from "@/lib/vzla";
import { encuestarTicket, listarMisTickets, type TicketDisputa } from "@/lib/tickets";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

const num = (v: number | string | null | undefined): number => {
  const n = parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

type TabPortal = "resumen" | "reportar" | "tickets" | "comprar" | "datos";

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
      const qs = new URLSearchParams(window.location.search);
      const c = qs.get("c") ?? "";
      const k = qs.get("k") ?? "";
      setCargando(true);
      // 1) Entrada automática vía enlace del admin (?c=&k=)
      if (c && k) {
        const r = await entrarPortal({ linkId: c, linkToken: k });
        if (r.ok && r.sesion) {
          if (vivo) {
            setSesion(r.sesion!);
            setCargando(false);
            return;
          }
        }
        setAutoId(c);
        setAutoToken(k);
      }
      // 2) Sesión guardada (recargas)
      const re = await reanudarSesion();
      if (re && vivo) {
        setSesion(re);
        setCargando(false);
        return;
      }
      if (vivo) setCargando(false);
    };
    void cargar();
    return () => {
      vivo = false;
    };
  }, []);

  const loguear = async () => {
    setErrorLogin("");
    if (autoId && autoToken) {
      const r = await entrarPortal({ linkId: autoId, linkToken: autoToken });
      return aplicarLogin(r.ok, r.error, r.sesion);
    }
    if (!usuario.trim() || !token.trim() || !clave.trim()) {
      return setErrorLogin("Complete los tres campos para entrar.");
    }
    const r = await entrarPortal({ usuario, token, clave });
    aplicarLogin(r.ok, r.error, r.sesion);
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
    window.history.replaceState({}, "", "/portal");
  }, [sesion]);

  if (cargando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center text-slate-500">
          <i className="fas fa-spinner fa-spin text-2xl"></i>
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
            <i className="fas fa-user-tie text-indigo-300"></i>
          </div>
          <h1 className="text-2xl font-black tracking-tight">Portal del Cliente</h1>
          <p className="mt-1 text-xs text-indigo-200/80">Consulta tu estado de cuenta, devoluciones y reclamos.</p>
        </div>

        <div className="rounded-2xl bg-white/95 p-6 shadow-2xl backdrop-blur space-y-3">
          <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500">Seudónimo / Nombre</label>
          <input value={props.usuario} onChange={(e) => props.setUsuario(e.target.value.toUpperCase())} className={inp} placeholder="ej. EL MAGO" />

          <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500">Código del enlace (te lo dio el administrador)</label>
          <input value={props.token} onChange={(e) => props.setToken(e.target.value.toUpperCase())} className={inp} placeholder="XXXXXX" maxLength={12} />

          <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500">Contraseña</label>
          <input value={props.clave} onChange={(e) => props.setClave(e.target.value.toUpperCase())} className={inp} placeholder="XXXX" maxLength={8} />

          {props.error ? (
            <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs font-bold text-red-600">
              <i className="fas fa-triangle-exclamation mr-1"></i> {props.error}
            </p>
          ) : null}

          <Button variant="default" size="lg" className="w-full bg-indigo-600 hover:bg-indigo-500" onClick={props.onEntrar}>
            <i className="fas fa-sign-in-alt mr-1"></i> Entrar al Portal
          </Button>

          <p className="text-center text-[10px] text-slate-400">
            {props.autoEntrar ? "Enlace detectado: entre con el botón para validar el acceso." : "Acceso con las credenciales entregadas por el hipódromo."}
          </p>
        </div>
      </div>
      <ToastHost />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sesión activa
// ---------------------------------------------------------------------------

function SesionView({ sesion, onActualizar, onSalir }: { sesion: SesionPortal; onActualizar: (s: SesionPortal) => void; onSalir: () => void }) {
  const [tab, setTab] = useState<TabPortal>("resumen");

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/30 text-lg">
              <i className="fas fa-user-tie text-indigo-200"></i>
            </div>
            <div>
              <div className="text-sm font-black">{sesion.cliente.nombre || sesion.cliente.seudonimo}</div>
              <div className="text-[10px] text-indigo-200/70 uppercase tracking-wider">Portal del Cliente</div>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="text-indigo-200 hover:bg-indigo-900" onClick={onSalir}>
            <i className="fas fa-sign-out-alt mr-1"></i> Salir
          </Button>
        </div>

        <div className="mx-auto max-w-5xl px-4 pb-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Kpi icon="fa-coins" lbl="Saldo / Total decidido" val={formatoMoneda("USD", sesion.resumen.saldo)} color="text-white" bg="bg-indigo-900/40" />
            <Kpi icon="fa-percent" lbl={`Incentivo (${num(sesion.cliente.devolucion)}%)`} val={formatoMoneda("USD", sesion.resumen.incentivo)} color="text-purple-200" bg="bg-purple-900/40" />
            <Kpi icon="fa-hand-holding-dollar" lbl="Disponible" val={formatoMoneda("USD", sesion.resumen.disponible)} color="text-emerald-200" bg="bg-emerald-900/40" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5 space-y-4">
        <div className="flex flex-wrap gap-1 rounded-xl bg-white p-1 w-fit shadow-sm border border-line">
          {(
            [
              ["resumen", "Resumen y movimientos"],
              ["reportar", "Reportar jugada faltante"],
              ["tickets", "Mis tickets"],
              ["comprar", "Comprar tablas fijas"],
              ["datos", "Mis datos"],
            ] as [TabPortal, string][]
          ).map(([k, lbl]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                tab === k ? "bg-indigo-600 text-white shadow" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>

        {tab === "resumen" ? <ResumenView sesion={sesion} onCambio={onActualizar} /> : null}
        {tab === "reportar" ? <ReportarView cliente={sesion.cliente} /> : null}
        {tab === "tickets" ? <MisTicketsView cliente={sesion.cliente} /> : null}
        {tab === "comprar" ? <ComprarView cliente={sesion.cliente} /> : null}
        {tab === "datos" ? <DatosView cliente={sesion.cliente} /> : null}
      </main>

      <footer className="py-6 text-center text-[10px] text-slate-400">
        Sistema Hípico — Portal de Consulta del Cliente · {new Date().getFullYear()}
      </footer>
      <ToastHost />
    </div>
  );
}

function Kpi({ icon, lbl, val, color, bg }: { icon: string; lbl: string; val: string; color: string; bg: string }) {
  return (
    <div className={`rounded-2xl ${bg} border border-white/10 px-4 py-3 flex items-center gap-3`}>
      <i className={`fas ${icon} text-lg ${color}`}></i>
      <div>
        <div className="text-[9px] uppercase tracking-wider font-black text-indigo-200/70">{lbl}</div>
        <div className={`text-lg font-black ${color}`}>{val}</div>
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

  const reclamar = async (id: string) => {
    const r = await reclamarJugada(id);
    if (!r.ok) return toast(r.error ?? "No se pudo reclamar.", "error");
    toast("Reclamo enviado. La casa lo revisará.", "success");
    const re = await reanudarSesion();
    if (re) onCambio(re);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-line bg-white overflow-hidden shadow-sm">
        <div className="bg-slate-50 px-4 py-3 text-xs font-black uppercase tracking-wider text-slate-500 border-b border-line">
          <i className="fas fa-list-alt mr-1 text-indigo-600"></i> Últimos movimientos
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[9px] font-black uppercase tracking-wider text-slate-400 bg-white">
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Hipódromo / Carrera</th>
                <th className="px-3 py-2">Jugada</th>
                <th className="px-3 py-2">Caballo</th>
                <th className="px-3 py-2 text-right">Jugado</th>
                <th className="px-3 py-2 text-right">Decidido</th>
                <th className="px-3 py-2 text-right text-purple-600">Incentivo</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {jugadas.map((j) => (
                <tr key={j.id} className="border-t border-line hover:bg-slate-50">
                  <td className="px-3 py-2 whitespace-nowrap text-slate-500">{j.fechaTexto}</td>
                  <td className="px-3 py-2 font-bold text-slate-700">
                    {j.hipodromo} <span className="text-slate-400 font-medium">· C{j.carrera}</span>
                  </td>
                  <td className="px-3 py-2">{j.jugada}</td>
                  <td className="px-3 py-2">{j.caballo}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatoMoneda(j.moneda, j.montoJugado)}</td>
                  <td className="px-3 py-2 text-right font-mono font-bold">{formatoMoneda(j.moneda, j.montoDecidido)}</td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-purple-600">{formatoMoneda(j.moneda, j.devolucion)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${BADGE[j.estado] ?? "bg-slate-100 text-slate-600"}`}>
                      {j.estado}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {j.estado === "Pendiente" ? (
                      <Button variant="outline" size="sm" onClick={() => void reclamar(j.id)} title="Reclamar esta jugada">
                        <i className="fas fa-flag text-red-500"></i> Reclamar
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {jugadas.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-slate-400">
                    <i className="fas fa-inbox mr-2"></i> Sin movimientos registrados.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
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
        <i className="fas fa-flag mr-2 text-red-500"></i> Reportar jugada faltante
      </h2>
      <p className="text-[11px] text-slate-500">Si tu jugada no aparece en los movimientos, repórtala con el comprobante (si aplica).</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Hipódromo *</label>
          <input value={hipodromo} onChange={(e) => setHipodromo(e.target.value.toUpperCase())} className={inp + " uppercase"} placeholder="ej. LA RINCONADA" />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Carrera *</label>
          <input value={carrera} onChange={(e) => setCarrera(e.target.value.replace(/\D/g, ""))} className={inp} placeholder="ej. 4" inputMode="numeric" />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Monto (USD)</label>
          <input value={monto} onChange={(e) => setMonto(e.target.value)} className={inp + " font-mono"} placeholder="ej. 5" inputMode="decimal" />
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
            {enviando ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-paper-plane mr-1"></i>} Enviar reporte
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
          <i className="fas fa-life-ring mr-2 text-sky-600"></i> Mis tickets y reclamos
        </h2>
        <p className="mt-1 text-[11px] text-slate-500">
          Estado de tus reportes de jugada faltante y disputas. Cuando la casa responda, podrás valorar la atención con 1 a 5 estrellas.
        </p>
      </div>

      {cargando ? (
        <div className="rounded-2xl bg-white p-8 text-center text-slate-400">
          <i className="fas fa-spinner fa-spin text-xl"></i>
        </div>
      ) : tickets.length === 0 ? (
        <div className="rounded-2xl bg-white p-8 text-center text-slate-400">
          <i className="fas fa-inbox mr-2"></i> No tienes tickets abiertos.
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
            <i className={`fas ${t.tipo_jugada === "REPORTE_FALTANTE" ? "fa-flag" : "fa-scale-balanced"} text-xs`}></i>
          </span>
          <div>
            <div className="text-xs font-black text-slate-800">
              T-{t.numero_ticket ?? String(t.id).slice(0, 6)} · {t.motivo || t.tipo_jugada}
            </div>
            <div className="text-[10px] text-slate-400">
              {t.hipodromo ? `${t.hipodromo}${t.carrera ? ` · Carrera ${t.carrera}` : ""}` : t.fecha_jugada ? String(t.fecha_jugada).slice(0, 10) : ""}
              {t.hipodromo && t.fecha_jugada ? ` · ${String(t.fecha_jugada).slice(0, 10)}` : ""}
            </div>
          </div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${badge}`}>
          {t.estado?.replace("_", " ") ?? "—"}
        </span>
      </div>

      {t.imagen_soporte ? (
        <a href={t.imagen_soporte} target="_blank" rel="noreferrer" className="block text-[11px] font-bold text-sky-600 underline">
          <i className="fas fa-image mr-1"></i> Ver comprobante adjunto
        </a>
      ) : null}

      {t.estado === "SOLUCIONADO" ? (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs">
          <div className="font-bold text-emerald-800">
            {t.accion_aplicada ? `${t.accion_aplicada}${num(t.monto_resuelto) > 0 ? ` de ${formatoMoneda("USD", num(t.monto_resuelto))}` : ""}` : "Atendido"}
            {t.respuesta_casa ? ` — ${t.respuesta_casa}` : ""}
          </div>

          {t.encuesta_satisfaccion != null ? (
            <div className="mt-1.5 text-slate-600">
              <span className="text-amber-500">{Array.from({ length: t.encuesta_satisfaccion }).map((_, i) => <i key={i} className="fas fa-star text-xs"></i>)}</span>
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
                    <i className="fas fa-star"></i>
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
                {enviando ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-star"></i>} Enviar valoración
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-slate-500">
          <i className="fas fa-hourglass-half mr-1 text-amber-500"></i> La casa está revisando este ticket. Te avisaremos con la respuesta.
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
        <i className="fas fa-shopping-cart mr-2 text-indigo-600"></i> Comprar tablas fijas
      </h2>
      <p className="text-[11px] text-slate-500">Solicita tu tabla; la casa la valida y confirma por los canales de pago registrados.</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Carrera publicada</label>
          <select value={tablaId} onChange={(e) => setTablaId(e.target.value)} className="w-full border border-line rounded-xl bg-surface px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-200">
            <option value="">— Seleccione —</option>
            {tablas.map((t) => (
              <option key={String(t.id)} value={String(t.id)}>
                {t.hipodromo} · Carrera {t.carrera} · Premio {formatoMoneda(t.moneda, t.premio_original)} {t.caballos ? `(${t.caballos.length} ejemplares)` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Cantidad de tablas</label>
          <input value={cantidad} onChange={(e) => setCantidad(e.target.value.replace(/\D/g, ""))} className="w-full border border-line rounded-xl bg-surface px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-200 font-mono" inputMode="numeric" />
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
          {enviando ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-paper-plane mr-1"></i>} Solicitar compra
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mis datos (envía notificación al admin)
// ---------------------------------------------------------------------------

function DatosView({ cliente }: { cliente: SesionPortal["cliente"] }) {
  const tel = desglosarTelefono(cliente.telefono);
  const [codigoPais, setCodigoPais] = useState(cliente.codigo_pais || tel.codigo || "+58");
  const [telefono, setTelefono] = useState(tel.numero);
  const [email, setEmail] = useState(cliente.email || "");
  const [cedulaRif, setCedulaRif] = useState(cliente.cedula_rif || "");
  const [direccion, setDireccion] = useState(cliente.direccion || "");
  const [metodoPago, setMetodoPago] = useState(cliente.metodo_pago || "");
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    setEnviando(true);
    const r = await actualizarDatosCliente(cliente, {
      codigo_pais: codigoPais,
      telefono: telefonoFormateado(),
      email: email.trim() || null,
      cedula_rif: cedulaRif.trim().toUpperCase() || null,
      direccion: direccion.trim().toUpperCase() || null,
      metodo_pago: metodoPago || null,
    });
    setEnviando(false);
    if (!r.ok) return toast(r.error ?? "No se pudo enviar.", "error");
    toast("Solicitud de actualización enviada. La casa la aplicará.", "success");
  };

  const telefonoFormateado = () => {
    const dig = telefono.replace(/[^\d]/g, "");
    const t = codigoPais + " " + dig;
    return codigoPais === "+58" && dig.startsWith("0") ? codigoPais + " " + dig.slice(1) : t;
  };

  const inp = "w-full border border-line rounded-xl bg-surface px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-200";

  return (
    <div className="rounded-2xl border border-line bg-white p-5 shadow-sm space-y-3">
      <h2 className="text-sm font-black text-slate-800">
        <i className="fas fa-id-card mr-2 text-indigo-600"></i> Actualizar mis datos
      </h2>
      <p className="text-[11px] text-slate-500">Los cambios se envían al administrador para validación antes de aplicarse.</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Código de país</label>
          <select value={codigoPais} onChange={(e) => setCodigoPais(e.target.value)} className={inp + " font-bold"}>
            {codigosPaisUnicos().map((p) => (
              <option key={p.codigo} value={p.codigo}>
                {p.codigo} {p.pais}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Teléfono</label>
          <input value={telefono} onChange={(e) => setTelefono(e.target.value)} className={inp + " font-mono"} placeholder="412 123 4567" />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} className={inp} type="email" />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Cédula / RIF</label>
          <input value={cedulaRif} onChange={(e) => setCedulaRif(e.target.value.toUpperCase())} className={inp + " font-mono uppercase"} placeholder="V-12.345.678" />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Método de pago</label>
          <select value={metodoPago} onChange={(e) => setMetodoPago(e.target.value)} className={inp + " font-bold"}>
            <option value="">— Sin cambio —</option>
            {listMetodosPago(true).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Dirección</label>
          <input value={direccion} onChange={(e) => setDireccion(e.target.value.toUpperCase())} className={inp + " uppercase"} />
        </div>
      </div>

      <div className="flex justify-end">
        <Button variant="default" size="sm" disabled={enviando} onClick={() => void enviar()}>
          {enviando ? <i className="fas fa-spinner fa-spin mr-1"></i> : <i className="fas fa-save mr-1"></i>} Enviar solicitud
        </Button>
      </div>
    </div>
  );
}