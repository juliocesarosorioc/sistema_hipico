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
import { encuestarTicket, listarMisTickets, type TicketDisputa } from "@/features/tickets/lib/tickets";
import {
  armarReporteDiario,
  esJugadaAnulada,
  type JugadaReporte,
} from "@/features/reportes/lib/reporte-diario";
import { ReporteDiarioTabla } from "@/features/reportes/components/ReporteDiarioTabla";
import { ModalRealizarJugadaUsuario } from "@/features/portal/components/ModalRealizarJugadaUsuario";
import { ModalJugadaNoRelacionada } from "@/features/portal/components/ModalJugadaNoRelacionada";
import { dentroDeVentana, type CicloGrupo } from "@/features/portal/lib/ventana-reclamos";

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

type TabPortal = "resumen" | "reporte" | "reportar" | "tickets" | "comprar" | "datos" | "externos";

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

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/30 text-lg">
              <span className="text-indigo-200">👔</span>
            </div>
            <div>
              <div className="text-sm font-black">{sesion.cliente.nombre || sesion.cliente.seudonimo}</div>
              <div className="text-[10px] text-indigo-200/70 uppercase tracking-wider">Portal del Cliente</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              className="bg-indigo-500 hover:bg-indigo-400"
              onClick={() => setJugadaAbierta(true)}
            >
              <span className="mr-1">🐎</span> Realizar Jugada
            </Button>
            <Button variant="ghost" size="sm" className="text-indigo-200 hover:bg-indigo-900" onClick={() => setPerfilAbierto(true)}>
              <span className="mr-1">👤</span> Mi Perfil
            </Button>
            <Button variant="ghost" size="sm" className="text-indigo-200 hover:bg-indigo-900" onClick={onSalir}>
              <span className="mr-1">🚪</span> Salir
            </Button>
          </div>
        </div>

        <div className="mx-auto max-w-5xl px-4 pb-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Kpi icon="🪙" lbl="Saldo / Total decidido" val={formatoMoneda("USD", sesion.resumen.saldo)} color="text-white" bg="bg-indigo-900/40" />
            <Kpi icon="％" lbl={`Incentivo (${num(sesion.cliente.devolucion)}%)`} val={formatoMoneda("USD", sesion.resumen.incentivo)} color="text-purple-200" bg="bg-purple-900/40" />
            <Kpi icon="🤲" lbl="Disponible" val={formatoMoneda("USD", sesion.resumen.disponible)} color="text-emerald-200" bg="bg-emerald-900/40" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5 space-y-4">
        <div className="flex flex-wrap gap-1 rounded-xl bg-white p-1 w-fit max-w-full shadow-sm border border-line">
          {(
            [
              ["resumen", "Resumen y movimientos"],
              ["reporte", "Reporte del día"],
              ["reportar", "Reportar jugada faltante"],
              ["tickets", "Mis tickets"],
              ["comprar", "Comprar tablas fijas"],
              ["datos", "Mis datos"],
              ["externos", "📓 Mi Control en Otros Grupos (Personal)"],
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
        {tab === "reporte" ? <ReporteDiarioView sesion={sesion} /> : null}
        {tab === "reportar" ? <ReportarView cliente={sesion.cliente} /> : null}
        {tab === "tickets" ? <MisTicketsView cliente={sesion.cliente} /> : null}
        {tab === "comprar" ? <ComprarView cliente={sesion.cliente} /> : null}
        {tab === "datos" ? <DatosView cliente={sesion.cliente} /> : null}
        {tab === "externos" ? <BitacoraExternaView cliente={sesion.cliente} /> : null}
      </main>

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
      <span className={`text-lg leading-none ${color}`}>{icon}</span>
      <div>
        <div className="text-[9px] uppercase tracking-wider font-black text-indigo-200/70">{lbl}</div>
        <div className={`text-lg font-black ${color}`}>{val}</div>
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
  const [fecha, setFecha] = useState(() => isoLocal(new Date()));

  const datos = useMemo(() => {
    const jugadas: JugadaReporte[] = sesion.arbolTickets.jugadas
      .filter((j) => (j.fechaCarrera ?? j.fecha ?? "").slice(0, 10) === fecha)
      .map((j) => ({
        hipodromo: j.hipodromo,
        carrera: j.carrera,
        montoJugado: j.montoJugado,
        premio: j.premio,
        devolucion: j.devolucion,
        anulada: esJugadaAnulada(j.estado, undefined),
      }));
    return armarReporteDiario(jugadas);
  }, [sesion, fecha]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 shadow-sm">
        <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Fecha del reporte</span>
        <input
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
        />
        <span className="text-xs text-slate-400">
          Jugado, premios, tu incentivo y el balance a tu favor por carrera.
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

  return (
    <div className="space-y-3">
      {/* ➕ Solicitar incluir una jugada que no aparece (PROMPT #6). La fecha
          está restringida por la ventana del grupo. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 shadow-sm">
        <div className="text-[11px] text-indigo-700 font-bold">
          ¿No te aparece una jugada que hiciste? Pedí que la incluyan.
        </div>
        <Button variant="default" size="sm" onClick={() => setNoRelAbierta(true)}>
          <span className="mr-1">➕</span> Solicitar Incluir Jugada No Relacionada
        </Button>
      </div>

      <div className="rounded-2xl border border-line bg-white overflow-hidden shadow-sm">
        <div className="bg-slate-50 px-4 py-3 text-xs font-black uppercase tracking-wider text-slate-500 border-b border-line">
          <span className="mr-1 text-indigo-600">🗒️</span> Últimos movimientos
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
              {jugadas.map((j) => {
                const reclamable = dentroDeVentana(j.fechaCarrera ?? j.fecha, hoy, ventana, ciclo);
                return (
                  <tr key={j.id} className="border-t border-line hover:bg-slate-50">
                    <td className="px-3 py-2 whitespace-nowrap text-slate-500">{j.fechaTexto}</td>
                    <td className="px-3 py-2 font-bold text-slate-700">
                      {nombreHipodromoParaMostrar(j.hipodromo)} <span className="text-slate-400 font-medium">· C{j.carrera}</span>
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
                  <td colSpan={9} className="px-3 py-10 text-center text-slate-400">
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
        <span className="mr-2 text-indigo-600">🧪</span> Actualizar mis datos
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
          {enviando ? <span className="mr-1">⏳</span> : <span className="mr-1">💾</span>} Enviar solicitud
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
  const [nombre, setNombre] = useState(cliente.nombre || "");
  const [codigoPais, setCodigoPais] = useState(cliente.codigo_pais || tel.codigo || "+58");
  const [telefono, setTelefono] = useState(tel.numero);
  const [email, setEmail] = useState(cliente.email || "");
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

    // PIN: el login del portal escribe la contraseña en MAYÚSCULAS, así que el
    // PIN se guarda así para que lo que ve el usuario al entrar sea lo mismo.
    const clave = String(claveNueva).trim().toUpperCase();
    if (claveNueva || claveRepetir) {
      const errClave = validarClaveAcceso(clave, { min: 4, max: 8 });
      if (errClave) return setError(errClave);
      if (clave !== String(claveRepetir).trim().toUpperCase())
        return setError("La confirmación no coincide con la contraseña / PIN nuevo.");
      if (!claveActual.trim()) return setError("Para cambiar el PIN hace falta el PIN actual.");
    }

    setGuardando(true);
    const r = await actualizarMiPerfil({
      nombre: nombreLimpio,
      codigo_pais: codigoPais,
      telefono: telefonoFormateado(),
      email: email.trim(),
      formas_pago: normalizarFormasPago(formas),
      clave_actual: claveActual.trim().toUpperCase(),
      clave_nueva: clave,
    });
    setGuardando(false);
    if (!r.ok) return setError(r.error ?? "No se pudieron guardar los datos.");
    toast("✅ Datos personales actualizados correctamente.", "success");
    onGuardado(r.cliente ?? cliente);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 p-4">
      <div className="mx-auto my-6 w-full max-w-2xl rounded-2xl border border-line bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-black text-slate-800">
              <span className="mr-2">👤</span> Mi Perfil — Actualizar Datos Personales
            </h2>
            <p className="text-[11px] text-slate-500">
              Tus datos se guardan directamente en tu ficha. Nada de saldo, comisiones ni grupos: solo identidad,
              contacto, PIN y formas de cobro/pago.
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
            <div className="md:col-span-3">
              <label className={lbl}>Nombre completo</label>
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                className={inp + " uppercase"}
                placeholder="JUAN PEREZ"
                data-testid="perfil-nombre"
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

  const inp =
    "w-full border border-line rounded-xl bg-surface px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-200";
  const lbl = "block text-[10px] font-black uppercase text-slate-500 mb-1";

  const grupo = grupos.find((g) => String(g.id) === grupoId) ?? null;
  const monedaGrupo = String(grupo?.moneda ?? "USD").toUpperCase() || "USD";
  const resumen = useMemo(() => resumenGrupoExterno(jugadas, grupo?.comision_pct ?? 0), [jugadas, grupo]);

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

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label className={lbl}>Fecha</label>
            <input type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} className={inp} data-testid="bitacora-fecha" />
          </div>
          <div>
            <label className={lbl}>Hipódromo</label>
            <input
              value={form.hipodromo}
              onChange={(e) => setForm({ ...form, hipodromo: e.target.value.toUpperCase() })}
              className={inp + " uppercase"}
              placeholder="LA PARAGUAITA"
              data-testid="bitacora-hipodromo"
            />
          </div>
          <div>
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
          <div>
            <label className={lbl}>Tipo de jugada</label>
            <select value={form.tipo_jugada} onChange={(e) => setForm({ ...form, tipo_jugada: e.target.value })} className={inp + " font-bold"} data-testid="bitacora-tipo">
              {["JUGADA", "TRIO", "SUPERTRIFECTA", "EXACTA", "QUINIELA", "WIN", "PLACE", "OTRO"].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className={lbl}>Ejemplares</label>
            <input
              value={form.ejemplares}
              onChange={(e) => setForm({ ...form, ejemplares: e.target.value.toUpperCase() })}
              className={inp + " uppercase"}
              placeholder="1-5 EL MAGO, 8 REYAZUL"
              data-testid="bitacora-ejemplares"
            />
          </div>
          <div>
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
          <div>
            <label className={lbl}>Estado</label>
            <select
              value={form.estado}
              onChange={(e) => setForm({ ...form, estado: e.target.value })}
              className={inp + " font-bold"}
              data-testid="bitacora-estado"
            >
              {ESTADOS_JUGADA_EXTERNA.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
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
        <h2 className="text-sm font-black text-slate-800">
          <span className="mr-2">📒</span> Mis jugadas anotadas
        </h2>

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
                  <th className="px-3 py-2">Tipo de jugada</th>
                  <th className="px-3 py-2">Ejemplares</th>
                  <th className="px-3 py-2 text-right">Monto</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {jugadas.map((j, i) => {
                  const estado = normalizarEstadoJugada(j.estado);
                  return (
                    <tr key={String(j.id)} className="hover:bg-slate-50/70" data-testid={`bitacora-fila-${i}`}>
                      <td className={FILA_JUGADA + " font-mono"}>{String(j.fecha ?? "").slice(0, 10)}</td>
                      <td className={FILA_JUGADA + " font-bold text-slate-700"}>{String(j.hipodromo ?? "") || "—"}</td>
                      <td className={FILA_JUGADA + " text-right font-mono"}>{j.carrera != null ? String(j.carrera) : "—"}</td>
                      <td className={FILA_JUGADA}>{String(j.tipo_jugada ?? "") || "—"}</td>
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