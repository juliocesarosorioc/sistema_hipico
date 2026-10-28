"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import type { TablaFijaRow } from "@/features/tablas/lib/tablas-fijas";
import { colorDeNumero, textoDeNumero, parseNum, type EjemplarTabla } from "@/features/tablas/lib/tipos";
import { nombreHipodromoParaMostrar } from "@/features/hipodromos/lib/nombre";
import { diaDeCarrera, type EjeFecha } from "@/features/carreras/lib/agruparHipodromos";
import { Flag } from "@/shared/components/ui/BanderaPais";
import { HorseBadge } from "@/shared/components/ui/HorseChips";
import { Button } from "@/shared/components/ui/Button";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import { Card } from "@/shared/components/ui/Card";
import { formatoMoneda } from "@/shared/lib/vzla";
import { TicketVentaPreview, type TicketVentaModel } from "@/features/tickets/components/TicketVentaPreview";
import { realizarJugada, solicitarCompraTabla, type SesionPortal } from "@/features/portal/lib/portal";
import { listarCuposTabla, type CupoTablaGrupo } from "@/features/grupos/lib/grupos";
import {
  comunicarCupoAgotadoAdmin,
  extraerNumeroCaballo,
} from "@/features/tablas/lib/control-riesgo";
import { esTablaActivaEnPortal } from "@/features/portal/lib/control-activas-portal";
import { supabase } from "@/core/supabase";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));
  }
};

/** Formatea números sin decimales (monto de la tabla y puntos de ejemplar) */
function fmtValor(n: number | null | undefined): string {
  const num = typeof n === "number" && isFinite(n) ? n : 0;
  return num.toLocaleString("es-VE", { maximumFractionDigits: 0 });
}

function fmtPts(n: number | null | undefined): string {
  const num = typeof n === "number" && isFinite(n) ? n : 0;
  return num.toLocaleString("es-VE", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function diaDeLaTabla(t: TablaFijaRow, eje: EjeFecha = "carrera"): string {
  return diaDeCarrera(t, "", eje);
}

type Props = {
  sesion: SesionPortal;
  tablas: TablaFijaRow[];
  bloqueada?: boolean;
  onPedirDesbloqueo?: () => Promise<void>;
  onRealizada: () => Promise<void> | void;
};

type CompraBorrador = {
  tabla: TablaFijaRow;
  ejemplar: EjemplarTabla;
  cantidad: number;
  costoTotal: number;
  premioPagar: number;
  ticket: TicketVentaModel;
};

type TicketGenerado = TicketVentaModel & {
  codigo: string;
  fechaHora: string;
};

export function MonitorTablasCliente({
  sesion,
  tablas,
  bloqueada = false,
  onPedirDesbloqueo,
  onRealizada,
}: Props) {
  const [ejeFecha, setEjeFecha] = useState<EjeFecha>("carrera");
  const [hipodromoFiltro, setHipodromoFiltro] = useState("");
  const [fechaFiltro, setFechaFiltro] = useState("");
  const [carreraFiltro, setCarreraFiltro] = useState("");

  // Modal de Ejemplar (para configurar la compra)
  const [ejemplarSeleccionado, setEjemplarSeleccionado] = useState<{
    tabla: TablaFijaRow;
    ejemplar: EjemplarTabla;
  } | null>(null);

  // Previsualización y confirmación de la compra
  const [previewCompra, setPreviewCompra] = useState<CompraBorrador | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Ticket final generado
  const [ticketGenerado, setTicketGenerado] = useState<TicketGenerado | null>(null);

  // Tablas abiertas
  const abiertas = useMemo(
    () => tablas.filter((t) => t.estado === "Abierta" || !t.estado),
    [tablas]
  );

  // Opciones de filtros
  const hipodromosDisponibles = useMemo(() => {
    const hips = new Set<string>();
    abiertas.forEach((t) => {
      if (t.hipodromo) hips.add(t.hipodromo);
    });
    return Array.from(hips).sort();
  }, [abiertas]);

  const fechasDisponibles = useMemo(() => {
    const f = new Set<string>();
    abiertas.forEach((t) => {
      if (!hipodromoFiltro || t.hipodromo === hipodromoFiltro) {
        const dia = diaDeLaTabla(t, ejeFecha);
        if (dia) f.add(dia);
      }
    });
    return Array.from(f).sort().reverse();
  }, [abiertas, hipodromoFiltro, ejeFecha]);

  const carrerasDisponibles = useMemo(() => {
    const c = new Set<string>();
    abiertas.forEach((t) => {
      if (hipodromoFiltro && t.hipodromo !== hipodromoFiltro) return;
      if (fechaFiltro && diaDeLaTabla(t, ejeFecha) !== fechaFiltro) return;
      const num = String(t.carrera ?? "").trim();
      if (num) c.add(num);
    });
    return Array.from(c).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));
  }, [abiertas, hipodromoFiltro, fechaFiltro, ejeFecha]);

  // Tablas filtradas
  const filtradas = useMemo(() => {
    return abiertas
      .filter((t) => {
        if (!esTablaActivaEnPortal(t.id)) return false;
        if (fechaFiltro && diaDeLaTabla(t, ejeFecha) !== fechaFiltro) return false;
        if (hipodromoFiltro && t.hipodromo !== hipodromoFiltro) return false;
        if (carreraFiltro && String(t.carrera ?? "").trim() !== carreraFiltro) return false;
        return true;
      })
      .sort((a, b) => {
        const hComp = (a.hipodromo ?? "").localeCompare(b.hipodromo ?? "", "es");
        if (hComp !== 0) return hComp;
        const ca = Number(a.carrera) || 0;
        const cb = Number(b.carrera) || 0;
        return ca - cb;
      });
  }, [abiertas, fechaFiltro, hipodromoFiltro, carreraFiltro, ejeFecha]);

  const abrirModalEjemplar = (tabla: TablaFijaRow, ejemplar: EjemplarTabla) => {
    if (ejemplar.retirado) {
      toast("El ejemplar está retirado y no se encuentra disponible para compra.", "warning");
      return;
    }
    if (ejemplar.invalidado) {
      toast("El ejemplar se encuentra invalidado para esta tabla.", "warning");
      return;
    }
    if (bloqueada) {
      toast("La venta de Tablas Fijas está bloqueada temporalmente por el Administrador.", "warning");
      return;
    }
    setEjemplarSeleccionado({ tabla, ejemplar });
  };

  const prepararCompraDesdeModal = (datos: {
    cantidad: number;
    costoTotal: number;
    premioPagar: number;
  }) => {
    if (!ejemplarSeleccionado) return;
    const { tabla, ejemplar } = ejemplarSeleccionado;
    const num = String(ejemplar.numero ?? "");
    const nomCaballo = ejemplar.nombre || `Ejemplar #${num}`;
    const hipo = tabla.hipodromo ?? "";
    const numCarrera = tabla.carrera ?? 1;
    const saldoActual = Number(sesion.resumen?.saldo ?? 0);
    const saldoFinal = saldoActual - datos.costoTotal;

    const ticket: TicketVentaModel = {
      modalidad: "TABLA FIJA",
      hipodromo: hipo,
      fecha: diaDeLaTabla(tabla, "carrera"),
      carrera: numCarrera,
      titulo: `TABLA ${nombreHipodromoParaMostrar(hipo)} C${numCarrera} · Nº ${num}`,
      detalle: `${nomCaballo}${datos.cantidad > 1 ? ` × ${datos.cantidad} tablas` : ""}`,
      jugador: sesion.cliente.nombre || sesion.cliente.seudonimo || "Cliente",
      grupo: sesion.grupo?.nombre ?? "GRUPO",
      monto: datos.costoTotal,
      moneda: tabla.moneda || "USD",
      pago: datos.premioPagar,
      saldoAntes: saldoActual,
      saldoDespues: saldoFinal,
      banquero: "TF",
    };

    setPreviewError(null);
    setPreviewCompra({
      tabla,
      ejemplar,
      cantidad: datos.cantidad,
      costoTotal: datos.costoTotal,
      premioPagar: datos.premioPagar,
      ticket,
    });
    setEjemplarSeleccionado(null);
  };

  const confirmarCompra = async () => {
    if (!previewCompra) return;
    setConfirmando(true);
    setPreviewError(null);

    const { tabla, ejemplar, cantidad, costoTotal, premioPagar, ticket } = previewCompra;
    const hipo = String(tabla.hipodromo ?? "").toUpperCase();
    const carr = Number(tabla.carrera ?? 1);
    const num = String(ejemplar.numero ?? "");
    const premioPorTabla = Number(tabla.premio_recalculado ?? tabla.premio_original ?? 0);

    const r = await realizarJugada({
      tipo: "TABLA_FIJA",
      tabla_id: String(tabla.id),
      hipodromo: hipo,
      carrera: carr,
      ejemplar: num,
      ejemplar_nombre: ejemplar.nombre || `Ejemplar #${num}`,
      cantidad,
      monto: costoTotal,
      premio_por_tabla: premioPorTabla,
      premio_pagar: premioPagar,
      moneda: String(tabla.moneda ?? "USD"),
    });

    await solicitarCompraTabla({
      cliente: sesion.cliente,
      tablaId: tabla.id,
      hipodromo: hipo || "—",
      carrera: carr,
      ejemplarNumero: num,
      ejemplarNombre: ejemplar.nombre ?? `Ejemplar #${num}`,
      cantidad,
      premioPorTabla,
      ptsEjemplar: parseNum(ejemplar.valor_ejemplar),
      moneda: String(tabla.moneda ?? "USD"),
      costoUsd: costoTotal,
    }).catch(() => undefined);

    setConfirmando(false);

    if (!r.ok) {
      setPreviewError(r.error ?? "No se pudo registrar la compra de la tabla fija.");
      return;
    }

    const codigoGenerado = "TF-" + Date.now().toString(36).toUpperCase();
    const fechaHora = new Date().toLocaleString("es-VE");

    setPreviewCompra(null);
    setTicketGenerado({
      ...ticket,
      codigo: codigoGenerado,
      fechaHora,
    });

    await onRealizada();
    toast(`✅ ¡Compra confirmada! Se generó el Ticket #${codigoGenerado}`, "success");
  };

  if (!tablas.length) {
    return (
      <Card>
        <EmptyState
          icono="🏁"
          titulo="No hay Tablas Fijas publicadas en este momento"
          descripcion="Cuando el Administrador publique las tablas de la jornada aparecerán aquí para la compra directa."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Banner si la modalidad está bloqueada */}
      {bloqueada && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 flex flex-wrap items-center justify-between gap-3 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="text-2xl leading-none">🔒</span>
            <div>
              <h3 className="text-sm font-black text-amber-950 uppercase">
                Venta de Tablas Fijas bloqueada temporalmente por el Administrador
              </h3>
              <p className="text-xs text-amber-800 mt-0.5">
                Podés visualizar toda la programación y solicitar al Administrador que habilite la compra.
              </p>
            </div>
          </div>
          {onPedirDesbloqueo && (
            <Button
              size="sm"
              onClick={() => void onPedirDesbloqueo()}
              className="bg-amber-600 hover:bg-amber-500 text-white font-black"
            >
              🔓 Solicitar Desbloqueo al Administrador
            </Button>
          )}
        </div>
      )}

      {/* FILTROS EN CASCADA (IDÉNTICO A MONITOR DE TABLAS PUBLICADAS) */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200 shadow-sm">
        <p className="text-xs font-bold text-slate-600">
          {filtradas.length} tabla(s) disponible(s)
        </p>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Eje del día */}
          <div className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-1.5 py-1 shadow-sm">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">🧭 Eje</span>
            <button
              type="button"
              onClick={() => setEjeFecha("carrera")}
              title="Agrupar y filtrar por la fecha en que CORRE la carrera"
              className={`cursor-pointer rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-wide transition ${
                ejeFecha === "carrera" ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              🏇 Carrera
            </button>
            <button
              type="button"
              onClick={() => setEjeFecha("venta")}
              title="Agrupar y filtrar por la fecha en que se VENDIÓ/publicó la tabla"
              className={`cursor-pointer rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-wide transition ${
                ejeFecha === "venta" ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              🧾 Venta
            </button>
          </div>

          {/* Filtro Hipódromo */}
          <label className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1 shadow-sm">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">🏛️ Hipódromo</span>
            <select
              value={hipodromoFiltro}
              onChange={(e) => {
                setHipodromoFiltro(e.target.value);
                setCarreraFiltro("");
              }}
              className="bg-transparent text-xs font-bold text-slate-900 focus:outline-none"
            >
              <option value="">TODOS</option>
              {hipodromosDisponibles.map((h) => (
                <option key={h} value={h}>
                  {nombreHipodromoParaMostrar(h)}
                </option>
              ))}
            </select>
          </label>

          {/* Filtro Fecha */}
          <label className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1 shadow-sm">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
              {ejeFecha === "venta" ? "🧾 Venta" : "📅 Carrera"}
            </span>
            <select
              value={fechaFiltro}
              onChange={(e) => {
                setFechaFiltro(e.target.value);
                setCarreraFiltro("");
              }}
              className="bg-transparent text-xs font-bold text-slate-900 focus:outline-none"
            >
              <option value="">TODAS</option>
              {fechasDisponibles.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>

          {/* Filtro Carrera */}
          <label className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1 shadow-sm">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">🏇 Carrera</span>
            <select
              value={carreraFiltro}
              onChange={(e) => setCarreraFiltro(e.target.value)}
              disabled={carrerasDisponibles.length === 0}
              className="bg-transparent text-xs font-bold text-slate-900 focus:outline-none"
            >
              <option value="">TODAS</option>
              {carrerasDisponibles.map((c) => (
                <option key={c} value={c}>
                  C{c}
                </option>
              ))}
            </select>
          </label>

          {(fechaFiltro !== "" || hipodromoFiltro || carreraFiltro) && (
            <button
              type="button"
              onClick={() => {
                setFechaFiltro("");
                setHipodromoFiltro("");
                setCarreraFiltro("");
              }}
              className="text-[10px] font-black uppercase text-red-500 hover:text-red-600 border border-red-200 bg-red-50 px-2 py-1 rounded"
            >
              ✕ Limpiar
            </button>
          )}
        </div>
      </div>

      {/* GRILLA DE TARJETAS DE TABLAS PUBLICADAS */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {filtradas.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="text-sm font-semibold text-slate-500">No hay tablas que coincidan con los filtros.</p>
          </div>
        )}

        {filtradas.map((t) => (
          <div
            key={String(t.id)}
            className="flex flex-col overflow-hidden rounded-xl border border-indigo-200 bg-white shadow-sm transition hover:shadow-md"
          >
            {/* CABECERA CON GRADIENTE — SIN NINGÚN ÍCONO ARRIBA */}
            <div
              className="px-2 py-1 text-white"
              style={{ background: "linear-gradient(135deg,#4f46e5 0%,#7c3aed 60%,#9333ea 100%)" }}
            >
              <div className="flex items-center justify-between gap-1 leading-none">
                <span className="min-w-0 truncate rounded bg-white/20 px-2 py-1 text-[15px] font-bold normal-case tracking-wider">
                  🏛️ {nombreHipodromoParaMostrar(t.hipodromo)}
                </span>
                <span className="inline-flex items-center rounded-md border-4 border-white bg-indigo-900 px-3.5 py-1 text-[15px] font-black uppercase leading-none tracking-widest text-white shadow-lg md:text-[18px]">
                  C{t.carrera ?? ""}
                </span>
              </div>

              {/* Distancia, superficie y fechas */}
              <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] font-bold leading-none">
                <span className="rounded bg-white/20 px-1 py-px">📏 {t.distancia_carrera ?? ""} m</span>
                <span className="rounded bg-white/20 px-1 py-px uppercase">{t.superficie || "ARENA"}</span>
                <span
                  className={`rounded px-1 py-px ${ejeFecha === "carrera" ? "bg-white/40 ring-1 ring-white/60" : "bg-white/20"}`}
                  title="Fecha de carrera (cuándo corre)"
                >
                  🏇 {diaDeLaTabla(t, "carrera") || "—"}
                </span>
                <span
                  className={`rounded px-1 py-px ${ejeFecha === "venta" ? "bg-white/40 ring-1 ring-white/60" : "bg-white/20"}`}
                  title="Fecha de venta (cuándo se publicó)"
                >
                  🧾 {diaDeLaTabla(t, "venta") || "—"}
                </span>
              </div>

              {/* Monto a pagar tabla */}
              <div className="mt-1 flex items-center justify-between rounded bg-white/20 px-2 py-0.5 leading-none">
                <span className="text-[11px] font-black uppercase tracking-wider opacity-90">
                  💰 MONTO A PAGAR TABLA
                </span>
                <span className="whitespace-nowrap text-sm font-black">
                  {fmtValor(t.premio_recalculado ?? t.premio_original ?? null)}
                </span>
              </div>
            </div>

            {/* LISTA DE EJEMPLARES */}
            <div className="flex items-center justify-between px-2 pb-0.5 pt-1 text-[9px] font-black uppercase tracking-wider text-slate-400 leading-none">
              <span>🐴 Ejemplares (Hacé clic en uno para comprar)</span>
              <span className="rounded-full bg-slate-100 px-1.5 text-[9px] font-black text-slate-600">
                {(t.caballos ?? []).length}
              </span>
            </div>

            <div className="flex-1 px-1 py-1 space-y-0.5">
              {(t.caballos ?? []).map((c, i) => {
                let nac = c.nacionalidad ? String(c.nacionalidad).toUpperCase() : "";
                if (!nac) {
                  const esAmericano = /PARK|DOWNS|AQUEDUCT|SARATOGA|TAMPA|MEADOWS|WOODBINE|GOLDEN|SANTA ANITA|DEL MAR|OAKLAWN/i.test(
                    t.hipodromo || ""
                  );
                  nac = esAmericano ? "US" : "VE";
                }
                const valor = parseNum(c.valor_ejemplar);
                const deshabilitado = Boolean(c.retirado || c.invalidado);

                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => abrirModalEjemplar(t, c)}
                    title={
                      c.retirado
                        ? "Ejemplar retirado"
                        : c.invalidado
                          ? "Ejemplar invalidado"
                          : `Comprar tabla en el ejemplar ${c.nombre || `#${c.numero}`}`
                    }
                    className={`grid w-full items-center rounded px-1.5 py-1 text-left transition-colors ${
                      c.invalidado
                        ? "bg-purple-50 hover:bg-purple-100"
                        : i % 2 === 1
                          ? "bg-slate-50"
                          : "bg-white"
                    } ${
                      deshabilitado
                        ? "opacity-60 cursor-not-allowed"
                        : "hover:bg-indigo-100 cursor-pointer"
                    }`}
                    style={{ gridTemplateColumns: "1.75rem 1fr 1.25rem 4.5rem" }}
                  >
                    {/* Badge del número del caballo */}
                    <span
                      className="flex h-6 w-6 shrink-0 flex-none items-center justify-center rounded text-center text-[10px] font-bold leading-none shadow-sm"
                      style={{
                        backgroundColor: colorDeNumero(c.numero),
                        color: textoDeNumero(c.numero),
                      }}
                    >
                      {c.numero}
                    </span>

                    {/* Nombre del caballo */}
                    <span className="flex min-w-0 items-center gap-1 px-1 text-[13px] font-bold uppercase leading-none text-slate-800">
                      <span className="min-w-0 truncate">{c.nombre || "Sin nombre"}</span>
                      {c.invalidado ? (
                        <span className="shrink-0 rounded bg-purple-600 px-1 py-px text-[8px] font-black uppercase tracking-wide text-white">
                          INV.
                        </span>
                      ) : null}
                    </span>

                    {/* Bandera */}
                    <span className="flex justify-center text-center leading-none">
                      {nac !== "VE" && <Flag nac={nac} size={12} withName={false} />}
                    </span>

                    {/* Puntos / Valor */}
                    <span
                      className={`whitespace-nowrap text-right text-[15px] font-black leading-none ${
                        c.retirado
                          ? "text-red-500 line-through"
                          : c.invalidado
                            ? "text-purple-700 line-through"
                            : "text-blue-700"
                      }`}
                    >
                      {c.retirado ? "RET." : c.invalidado ? "INV." : `${fmtPts(valor)}`}
                    </span>
                  </button>
                );
              })}
            </div>

            {/*
              IMPORTANTE (REQUISITO EXPLICITO DEL USUARIO):
              "NO VAS A MOSTRAR CUANTO SUMA"
              Por eso no se renderiza ninguna fila de suma o total acá.
            */}
          </div>
        ))}
      </div>

      {/* MODAL DE EJEMPLAR PARA CLIENTE (CONFIGURAR COMPRA) */}
      {ejemplarSeleccionado && (
        <ModalEjemplarCliente
          abierto={Boolean(ejemplarSeleccionado)}
          tabla={ejemplarSeleccionado.tabla}
          ejemplar={ejemplarSeleccionado.ejemplar}
          sesion={sesion}
          onCerrar={() => setEjemplarSeleccionado(null)}
          onComprar={prepararCompraDesdeModal}
        />
      )}

      {/* VENTANA DE CONFIRMACIÓN DE COMPRA (PREVIEW TICKET) */}
      {previewCompra && (
        <TicketVentaPreview
          abierto={Boolean(previewCompra)}
          ticket={previewCompra.ticket}
          confirmando={confirmando}
          error={previewError}
          tituloModal="Ticket de compra"
          textoBotonConfirmar="✅ Confirmar compra"
          onCorregir={() => {
            setPreviewCompra(null);
            setPreviewError(null);
          }}
          onConfirmar={() => void confirmarCompra()}
        />
      )}

      {/* MODAL DE TICKET DE COMPRA GENERADO */}
      {ticketGenerado && (
        <TicketGeneradoModal
          ticket={ticketGenerado}
          onCerrar={() => setTicketGenerado(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MODAL DE EJEMPLAR PARA EL CLIENTE
// ---------------------------------------------------------------------------

function ModalEjemplarCliente({
  abierto,
  tabla,
  ejemplar,
  sesion,
  onCerrar,
  onComprar,
}: {
  abierto: boolean;
  tabla: TablaFijaRow;
  ejemplar: EjemplarTabla;
  sesion: SesionPortal;
  onCerrar: () => void;
  onComprar: (datos: { cantidad: number; costoTotal: number; premioPagar: number }) => void;
}) {
  const [cantidad, setCantidad] = useState("1");
  const [aviso, setAviso] = useState("");
  const [limiteGrupoTablas, setLimiteGrupoTablas] = useState<number | null>(null);
  const [maxTablasJugador, setMaxTablasJugador] = useState<number | null>(null);
  const [vendidasGrupo, setVendidasGrupo] = useState<number>(0);
  const [vendidasCaballo, setVendidasCaballo] = useState<number>(0);
  const [cargandoLimites, setCargandoLimites] = useState(true);
  const [notificadoAgotado, setNotificadoAgotado] = useState(false);

  const num = String(ejemplar.numero ?? "");
  const valorUnitario = parseNum(ejemplar.valor_ejemplar);
  const premioTabla = Number(tabla.premio_recalculado ?? tabla.premio_original ?? 0);
  const cantNum = Math.max(1, parseInt(cantidad, 10) || 1);
  const costoTotal = valorUnitario * cantNum;
  const premioPagar = premioTabla * cantNum;

  // Cargar límites del grupo y ventas actuales del caballo
  useEffect(() => {
    let activo = true;
    async function cargarLimites() {
      setCargandoLimites(true);
      try {
        const [cupos, ticketsRes] = await Promise.all([
          listarCuposTabla(tabla.id).catch(() => [] as CupoTablaGrupo[]),
          supabase
            ? supabase
                .from("tickets_apuestas")
                .select("caballo, cantidad_tablas, grupo_cobro_id, estado, anulada")
                .eq("hipodromo", String(tabla.hipodromo ?? "").toUpperCase())
                .eq("carrera", Number(tabla.carrera ?? 1))
                .ilike("nombre_jugada", "TABLA%")
            : Promise.resolve({ data: null, error: null }),
        ]);

        if (!activo) return;

        // Cupos del grupo del usuario (por defecto: 3 para USD; 3.000 grupo y 1.000 jugador para VES)
        const gid = sesion.grupo?.id ? String(sesion.grupo.id) : String(sesion.cliente.grupo_id ?? "");
        const miGrupoCupo = cupos.find((g) => String(g.grupo_id) === gid);
        const esBs =
          String(sesion.grupo?.moneda ?? tabla.moneda ?? "").toUpperCase().includes("VES") ||
          String(sesion.grupo?.moneda ?? "").toUpperCase().includes("BS");
        const defaultCupoGrupo = esBs ? 3000 : 3;
        const defaultMaxJugador = esBs ? 1000 : 3;

        if (miGrupoCupo) {
          setLimiteGrupoTablas(
            miGrupoCupo.cupos !== null && miGrupoCupo.cupos !== undefined
              ? Number(miGrupoCupo.cupos)
              : defaultCupoGrupo
          );
          setMaxTablasJugador(
            miGrupoCupo.max !== null && miGrupoCupo.max !== undefined
              ? Number(miGrupoCupo.max)
              : defaultMaxJugador
          );
          setVendidasGrupo(Number(miGrupoCupo.cantidad_vendida ?? 0));
        } else {
          setLimiteGrupoTablas(defaultCupoGrupo);
          setMaxTablasJugador(defaultMaxJugador);
          setVendidasGrupo(0);
        }

        // Conteo de tablas vendidas en este caballo
        let totalVendidasCab = 0;
        let vendidasEsteGrupo = 0;
        if (ticketsRes?.data) {
          for (const t of ticketsRes.data as Array<Record<string, unknown>>) {
            if (t.anulada || t.estado === "ANULADA") continue;
            const cNum = extraerNumeroCaballo(String(t.caballo ?? ""));
            const cCant = Math.max(1, Math.floor(Number(t.cantidad_tablas ?? 1)));
            if (cNum === num) {
              totalVendidasCab += cCant;
            }
            if (gid && String(t.grupo_cobro_id ?? "") === gid) {
              vendidasEsteGrupo += cCant;
            }
          }
        }
        setVendidasCaballo(totalVendidasCab);
        if (vendidasEsteGrupo > 0) setVendidasGrupo(vendidasEsteGrupo);
      } catch {
        /* best-effort */
      } finally {
        if (activo) setCargandoLimites(false);
      }
    }
    void cargarLimites();
    return () => {
      activo = false;
    };
  }, [tabla.id, tabla.hipodromo, tabla.carrera, sesion.grupo, sesion.cliente.grupo_id, num]);

  if (!abierto || !tabla || !ejemplar) return null;

  // Control de saldo y límites autorizados por el grupo
  const esLibre = Boolean(sesion.cliente?.libre);
  const disponible = Number(sesion.resumen?.disponible ?? 0);
  const maxMonto = esLibre ? Number.POSITIVE_INFINITY : Math.max(0, disponible);

  // Cupo máximo por ejemplar (si se configuró en la tabla)
  const maxCaballo = typeof (ejemplar as Record<string, unknown>).max_tablas === "number"
    ? Number((ejemplar as Record<string, unknown>).max_tablas)
    : null;
  const cupoRestanteCaballo = maxCaballo !== null ? Math.max(0, maxCaballo - vendidasCaballo) : null;
  const cupoRestanteGrupo = limiteGrupoTablas !== null && limiteGrupoTablas > 0 ? Math.max(0, limiteGrupoTablas - vendidasGrupo) : null;
  const maxPorJugador = maxTablasJugador !== null && maxTablasJugador > 0 ? maxTablasJugador : null;

  // Límite de compra efectivo
  const limitesEfectivos: number[] = [];
  if (cupoRestanteCaballo !== null) limitesEfectivos.push(cupoRestanteCaballo);
  if (cupoRestanteGrupo !== null) limitesEfectivos.push(cupoRestanteGrupo);
  if (maxPorJugador !== null) limitesEfectivos.push(maxPorJugador);
  if (!esLibre && valorUnitario > 0) limitesEfectivos.push(Math.floor(disponible / valorUnitario));

  const limiteEfectivoTablas = limitesEfectivos.length > 0 ? Math.max(0, Math.min(...limitesEfectivos)) : 999;
  const caballoAgotado = cupoRestanteCaballo !== null && cupoRestanteCaballo <= 0;
  const grupoAgotado = cupoRestanteGrupo !== null && cupoRestanteGrupo <= 0;

  // Notificar al admin si el cupo del caballo está agotado
  useEffect(() => {
    if (caballoAgotado && !notificadoAgotado) {
      setNotificadoAgotado(true);
      void comunicarCupoAgotadoAdmin({
        tabla,
        caballoNumero: num,
        caballoNombre: ejemplar.nombre || `Ejemplar #${num}`,
        grupoId: sesion.grupo?.id,
        grupoNombre: sesion.grupo?.nombre,
      });
    }
  }, [caballoAgotado, notificadoAgotado, tabla, num, ejemplar.nombre, sesion.grupo?.id, sesion.grupo?.nombre]);

  const superaLimiteSaldo = !esLibre && costoTotal > maxMonto;
  const superaLimiteCupo = cantNum > limiteEfectivoTablas;
  const bloqueado = caballoAgotado || grupoAgotado || superaLimiteSaldo || superaLimiteCupo || cantNum <= 0;

  const procederCompra = () => {
    if (cantNum <= 0) {
      setAviso("La cantidad de tablas debe ser mayor a 0.");
      return;
    }
    if (caballoAgotado) {
      setAviso("El cupo para este ejemplar está agotado. Se ha notificado al Administrador.");
      return;
    }
    if (grupoAgotado) {
      setAviso("El cupo de tablas asignado a tu grupo para esta carrera se ha agotado.");
      return;
    }
    if (superaLimiteCupo) {
      setAviso(
        `Solo podés comprar hasta ${limiteEfectivoTablas} tabla(s) según el límite disponible de tu grupo para el momento de la compra.`
      );
      return;
    }
    if (superaLimiteSaldo) {
      setAviso(
        `El costo total (${formatoMoneda(tabla.moneda || "USD", costoTotal)}) supera el monto disponible autorizado por tu grupo (${formatoMoneda(tabla.moneda || "USD", maxMonto)}).`
      );
      return;
    }
    setAviso("");
    onComprar({ cantidad: cantNum, costoTotal, premioPagar });
  };

  const nombreGrupo = sesion.grupo?.nombre || "GRUPO OFICIAL";
  const nombreJugador = sesion.cliente.nombre || sesion.cliente.seudonimo || "CLIENTE";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 no-print">
      <div className="flex max-h-[94vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Cabecera índigo */}
        <div className="flex shrink-0 items-center justify-between bg-indigo-600 px-4 py-3 text-sm font-bold uppercase tracking-wide text-white">
          <span>🐎 Ejemplar · Comprar Tabla Fija</span>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="text-indigo-200 hover:text-white">
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {aviso && (
            <p className="rounded-xl bg-amber-500/10 border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-800">
              {aviso}
            </p>
          )}

          {/* Banner de cupo agotado para el caballo */}
          {caballoAgotado && (
            <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800 space-y-1">
              <div className="flex items-center gap-1.5 font-black uppercase text-rose-900">
                <span>🚫</span> Cupo Agotado para este Ejemplar
              </div>
              <p className="text-[11px] leading-tight">
                Se alcanzó el cupo máximo de tablas autorizadas para este caballo. Ya se le comunicó al Administrador Principal quién ha comprado y cuántas tablas para gestionar la autorización de venta adicional.
              </p>
            </div>
          )}

          {/* Banner de cupo agotado para el grupo */}
          {!caballoAgotado && grupoAgotado && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 space-y-1">
              <div className="flex items-center gap-1.5 font-black uppercase">
                <span>⚠️</span> Límite de Grupo Agotado
              </div>
              <p className="text-[11px] leading-tight">
                Tu grupo ({nombreGrupo}) ha completado su cupo total de tablas para esta carrera ({limiteGrupoTablas} tablas).
              </p>
            </div>
          )}

          {/* Identidad del ejemplar */}
          <div className="flex items-center gap-3">
            <span
              className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border-2 text-xl font-black shadow"
              style={{
                backgroundColor: colorDeNumero(num),
                color: textoDeNumero(num),
                borderColor: colorDeNumero(num),
              }}
            >
              {num}
            </span>
            <div className="min-w-0 flex-1">
              <span className="block truncate text-base font-black uppercase text-slate-800">
                {ejemplar.nombre || "Sin nombre"}
              </span>
              <span className="block text-xs font-bold text-slate-500">
                <Flag nac={ejemplar.nacionalidad} size={13} /> N° {num ? <HorseBadge num={num} /> : "—"}
              </span>
            </div>
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black uppercase ${
                ejemplar.retirado
                  ? "bg-red-100 text-red-600"
                  : ejemplar.invalidado
                    ? "bg-purple-100 text-purple-700"
                    : caballoAgotado
                      ? "bg-rose-100 text-rose-700 border border-rose-300"
                      : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {ejemplar.retirado ? "Retirado" : ejemplar.invalidado ? "Invalidado" : caballoAgotado ? "Cupo Agotado" : "Activo"}
            </span>
          </div>

          {/* Valores de la tabla */}
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
            <div>
              <span className="block text-[10px] font-black uppercase tracking-wider text-slate-500">
                Valor por Tabla
              </span>
              <span className="block text-base font-black text-blue-700">
                {formatoMoneda(tabla.moneda || "USD", valorUnitario)}
              </span>
            </div>
            <div>
              <span className="block text-[10px] font-black uppercase tracking-wider text-slate-500">
                Premio por Tabla
              </span>
              <span className="block text-base font-black text-emerald-700">
                {formatoMoneda(tabla.moneda || "USD", premioTabla)}
              </span>
            </div>
          </div>

          {/* SECCIÓN DE COMPRA */}
          <div className="border-t border-slate-100 pt-3 space-y-3">
            <span className="block text-xs font-black uppercase tracking-wider text-slate-600">
              🛒 Datos de la Compra y Límites
            </span>

            {/* GRUPO PRESELECCIONADO */}
            <div>
              <label className="mb-0.5 block text-[10px] font-bold uppercase text-slate-500">
                Grupo de venta
              </label>
              <div
                className="flex items-center justify-between rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900"
                title="El grupo al que pertenecés en el sistema"
              >
                <span className="min-w-0 truncate">{nombreGrupo}</span>
                <span className="ml-2 shrink-0 rounded bg-indigo-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-indigo-700">
                  Tu grupo
                </span>
              </div>
            </div>

            {/* JUGADOR PRESELECCIONADO (USUARIO DEL SISTEMA) */}
            <div>
              <label className="mb-0.5 block text-[10px] font-bold uppercase text-slate-500">
                Jugador de ese grupo
              </label>
              <div
                className="flex items-center justify-between rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900"
                title="Tu usuario activo en el sistema"
              >
                <span className="min-w-0 truncate">{nombreJugador}</span>
                <span className="ml-2 shrink-0 rounded bg-emerald-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-emerald-700">
                  Tu usuario
                </span>
              </div>
            </div>

            {/* INFORMACIÓN DE CUPOS Y LÍMITES VIGENTES */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-600 font-semibold">Disponible financiero:</span>
                <span className="font-mono font-black text-slate-900">
                  {esLibre ? "LIBRE (Sin límite)" : formatoMoneda("USD", disponible)}
                </span>
              </div>

              {/* Límite de grupo al momento de la compra */}
              {limiteGrupoTablas !== null && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 font-semibold">Cupo restante del grupo:</span>
                  <span className={`font-mono font-black ${cupoRestanteGrupo === 0 ? "text-rose-600" : "text-indigo-700"}`}>
                    {cupoRestanteGrupo} de {limiteGrupoTablas} tablas
                  </span>
                </div>
              )}

              {/* Límite por jugador si aplica */}
              {maxPorJugador !== null && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 font-semibold">Máximo por jugador:</span>
                  <span className="font-mono font-black text-slate-800">
                    hasta {maxPorJugador} tabla(s)
                  </span>
                </div>
              )}

              {/* Límite del ejemplar si aplica */}
              {maxCaballo !== null && (
                <div className="flex items-center justify-between border-t border-slate-200 pt-1">
                  <span className="text-slate-600 font-semibold">Cupo restante en este caballo:</span>
                  <span className={`font-mono font-black ${caballoAgotado ? "text-rose-600" : "text-purple-700"}`}>
                    {cupoRestanteCaballo} de {maxCaballo} tablas ({vendidasCaballo} vendidas)
                  </span>
                </div>
              )}

              {/* Límite máximo permitido para esta compra */}
              <div className="flex items-center justify-between border-t border-slate-200 pt-1 text-[11px]">
                <span className="text-slate-700 font-black uppercase">Máximo a comprar en este momento:</span>
                <span className="font-mono font-black text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded">
                  {limiteEfectivoTablas} tabla(s)
                </span>
              </div>
            </div>

            {/* CANTIDAD DE TABLAS */}
            <div>
              <label className="mb-0.5 block text-[10px] font-bold uppercase text-slate-500">
                Cantidad de Tablas a Comprar (Máx: {limiteEfectivoTablas})
              </label>
              <input
                type="number"
                min={1}
                max={limiteEfectivoTablas > 0 ? limiteEfectivoTablas : 1}
                value={cantidad}
                disabled={bloqueado && limiteEfectivoTablas <= 0}
                onChange={(e) => setCantidad(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  if (!bloqueado) procederCompra();
                }}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-right text-sm font-bold text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100 disabled:text-slate-400"
              />
            </div>

            {/* Resumen de costos y premio */}
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-3 space-y-1.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-slate-600">Total a debitar:</span>
                <b className="font-mono text-base font-black text-indigo-950">
                  {formatoMoneda(tabla.moneda || "USD", costoTotal)}
                </b>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-semibold text-slate-600">Premio si gana este caballo:</span>
                <b className="font-mono text-base font-black text-emerald-700">
                  {formatoMoneda(tabla.moneda || "USD", premioPagar)}
                </b>
              </div>
            </div>

            {superaLimiteCupo && (
              <p className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-700">
                ⚠️ Solo podés comprar hasta {limiteEfectivoTablas} tabla(s) según el límite de grupo y ejemplar disponible para este momento.
              </p>
            )}

            {!superaLimiteCupo && superaLimiteSaldo && (
              <p className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-700">
                ⚠️ El costo total ({formatoMoneda(tabla.moneda || "USD", costoTotal)}) supera el monto máximo que autoriza tu grupo ({formatoMoneda(tabla.moneda || "USD", maxMonto)}).
              </p>
            )}
          </div>
        </div>

        {/* Pie con botón "Comprar ahora" */}
        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-xl bg-slate-200 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-300 transition"
          >
            Cancelar
          </button>
          <Button
            variant="success"
            size="md"
            disabled={bloqueado || cantNum <= 0 || Boolean(ejemplar.retirado || ejemplar.invalidado)}
            onClick={procederCompra}
            className="bg-emerald-600 hover:bg-emerald-500 font-black text-xs disabled:opacity-50"
          >
            {caballoAgotado ? "🚫 Cupo agotado" : "🛒 Comprar ahora"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MODAL DE TICKET DE COMPRA GENERADO
// ---------------------------------------------------------------------------

function TicketGeneradoModal({
  ticket,
  onCerrar,
}: {
  ticket: TicketGenerado;
  onCerrar: () => void;
}) {
  const imprimir = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal>
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl border border-emerald-300">
        <div className="flex items-center justify-between bg-emerald-600 px-4 py-3 text-white">
          <div className="flex items-center gap-2">
            <span className="text-xl">🎟️</span>
            <div>
              <h3 className="text-sm font-black uppercase tracking-wide">Ticket de Compra Generado</h3>
              <p className="text-[10px] text-emerald-100">Jugada registrada con éxito</p>
            </div>
          </div>
          <span className="rounded-full bg-white/20 px-2 py-0.5 font-mono text-[10px] font-black uppercase">
            {ticket.codigo}
          </span>
        </div>

        <div className="p-4 space-y-2.5 text-xs">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-1.5 font-mono">
            <div className="flex justify-between text-[11px] text-slate-500 border-b pb-1">
              <span>FECHA / HORA:</span>
              <span>{ticket.fechaHora}</span>
            </div>
            <div className="flex justify-between text-[11px] border-b pb-1">
              <span className="text-slate-500 font-sans">HIPÓDROMO:</span>
              <span className="font-black text-slate-800">{nombreHipodromoParaMostrar(ticket.hipodromo)}</span>
            </div>
            <div className="flex justify-between text-[11px] border-b pb-1">
              <span className="text-slate-500 font-sans">CARRERA:</span>
              <span className="font-black text-slate-800">CARRERA {ticket.carrera}</span>
            </div>
            <div className="flex justify-between text-[11px] border-b pb-1">
              <span className="text-slate-500 font-sans">JUGADA:</span>
              <span className="font-black text-indigo-700">{ticket.titulo}</span>
            </div>
            <div className="flex justify-between text-[11px] border-b pb-1">
              <span className="text-slate-500 font-sans">EJEMPLAR:</span>
              <span className="font-black text-slate-900">{ticket.detalle}</span>
            </div>
            <div className="flex justify-between text-[11px] border-b pb-1">
              <span className="text-slate-500 font-sans">JUGADOR:</span>
              <span className="font-bold text-slate-800">{ticket.jugador} ({ticket.grupo || "GRUPO"})</span>
            </div>
            <div className="flex justify-between text-xs pt-1">
              <span className="text-slate-600 font-sans font-bold">MONTO PAGADO:</span>
              <span className="font-black text-slate-950">${ticket.monto.toFixed(2)}</span>
            </div>
            {ticket.pago != null && (
              <div className="flex justify-between text-xs text-emerald-700">
                <span className="font-sans font-bold">PREMIO SI GANA:</span>
                <span className="font-black">${ticket.pago.toFixed(2)}</span>
              </div>
            )}
            {ticket.saldoDespues != null && (
              <div className="flex justify-between text-[11px] text-slate-500 pt-1 border-t">
                <span className="font-sans">SALDO RESTANTE:</span>
                <span className="font-bold">${ticket.saldoDespues.toFixed(2)}</span>
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={imprimir}
              className="flex-1 rounded-xl border border-slate-300 bg-white py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 transition shadow-sm"
            >
              🖨️ Imprimir ticket
            </button>
            <Button
              variant="success"
              size="sm"
              onClick={onCerrar}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 font-black text-xs"
            >
              ✓ Aceptar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default MonitorTablasCliente;
