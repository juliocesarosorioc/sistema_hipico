"use client";

import { useEffect, useState } from "react";
import { useTaquillaStore } from "@/shared/store/useTaquillaStore";
import { useTablasFijasStore } from "@/shared/store/useTablasFijasStore";
import { liquidarCarreraYCerrarTabla } from "@/features/liquidacion/lib/pagarYCerrar";
import { aplicarLiquidacionSaldos } from "@/features/liquidacion/lib/saldos";
import { dividendosDePizarra as dividendosDe } from "@/features/liquidacion/lib/posiciones";
import { nombreHipodromoParaMostrar } from "@/features/hipodromos/lib/nombre";
import { CargaResultadosModal, type PizarraResultados } from "@/features/liquidacion/components/CargaResultadosModal";
import { Button } from "@/shared/components/ui/Button";
import { carreraReporteDetalle } from "@/features/liquidacion/lib/reportes";
import { armarReporteCarrera } from "@/features/liquidacion/lib/reporte-carrera";
import { lookupDisponible } from "@/features/taquilla/lib/reparto";
import { listarClientes, type ClienteRow } from "@/features/clientes/lib/clientes";
import { exportarReporteCarreraImagen } from "@/features/liquidacion/lib/reporte-imagen";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import ReporteCarrera, { type ReporteCarreraDatos } from "@/features/saldos/components/ReporteCarrera";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));

const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

/**
 * Modal "Pagar Carrera": procesa los tickets de la sesión contra el motor y
 * auto-cierra la Tabla Fija. La pizarra se carga con el MISMO modal de 8
 * posiciones + Dead Heat que usa el Monitor de Tablas Fijas (CargaResultadosModal),
 * y el resultado se centraliza en resultados_carreras ("Carreras del Día") con
 * pago automático de las tablas vendidas.
 */
export function PagarCarreraModal() {
  const tickets = useTaquillaStore((s) => s.tickets);
  const limpiar = useTaquillaStore((s) => s.limpiarTickets);
  const tablas = useTablasFijasStore((s) => s.tablas);

  const [hipodromo, setHipodromo] = useState("");
  const [carrera, setCarrera] = useState("");
  const [cargandoResultados, setCargandoResultados] = useState(false);

  const [trabajando, setTrabajando] = useState(false);
  const [resultado, setResultado] = useState<string>("");
  const [resumen, setResumen] = useState<{
    totalInvertido: number;
    totalClienteNeto: number;
    balanceBanca: number;
    gananciaCasa: number;
  } | null>(null);
  const [tablaMensaje, setTablaMensaje] = useState("");
  const [reporteCarrera, setReporteCarrera] = useState<ReporteCarreraDatos | null>(null);
  const [cargandoReporte, setCargandoReporte] = useState(false);
  const [clientes, setClientes] = useState<ClienteRow[]>([]);

  // Ítem 10: cartera para el disponible (saldo + aval) del reporte de liquidación.
  useEffect(() => {
    let vivo = true;
    listarClientes()
      .then((cs) => vivo && setClientes(cs))
      .catch(() => vivo && setClientes([]));
    return () => {
      vivo = false;
    };
  }, []);

  const disponibleDe = lookupDisponible(clientes);

  /** Arma el «Reporte de Liquidación» con los datos REALES que dejó la liquidación. */
  const verReporte = async () => {
    setCargandoReporte(true);
    try {
      const c = await carreraReporteDetalle(hoyLocal(), hipodromo.trim().toUpperCase(), Number(carrera));
      setReporteCarrera(c ? armarReporteCarrera(c, undefined, disponibleDe) : null);
    } finally {
      setCargandoReporte(false);
    }
  };

  const detalle = (hipodromo || carrera || tablas.length)
    ? tablas.filter(
        (t) =>
          t.cerrada ||
          (hipodromo && t.hipodromo === hipodromo) ||
          (carrera && t.carrera === Number(carrera))
      )
    : [];

  const pagar = async (r: PizarraResultados) => {
    setCargandoResultados(false);
    setReporteCarrera(null);
    if (!hipodromo.trim() || !carrera.trim()) {
      setResultado("Indica Hipódromo y N° de Carrera.");
      return;
    }
    if (r.llenas < 1 || !r.pizarra.primero) {
      setResultado("Indica el 1er lugar de la pizarra.");
      return;
    }
    if (!tickets.length) {
      setResultado("No hay tickets registrados en la sesión.");
      return;
    }

    setTrabajando(true);
    setResultado("");
    setTablaMensaje("");
    // Los pools por caballo y la matriz W/P/S salen al motor en el mismo objeto.
    const divs = dividendosDe(r);
    const tabla = tablas.find(
      (t) =>
        t.hipodromo === hipodromo.trim().toUpperCase() &&
        t.carrera === Number(carrera)
    );
    const res = await liquidarCarreraYCerrarTabla({
      hipodromo: hipodromo.trim().toUpperCase(),
      carrera: Number(carrera),
      pizarra: r.pizarra,
      dividendos: divs,
      // El premio de la tabla viaja al resultado central para que el upsert no
      // lo deje en NULL: el objeto de la tabla solo lo conoce este modal.
      premio_oficial: tabla?.premio_original ?? null,
      premio_recalculado: tabla?.premio_recalculado ?? null,
      // `caballo` tiene que viajar: el motor resuelve el puesto del ejemplar
      // con ese campo, no parseándolo del comando (en las W/P/S el comando es
      // solo "100 W"). Sin esto, `pagarYCerrar` liquidaba contra "" y la
      // jugada se guardaba como Perdedor aunque hubiera ganado.
      tickets: tickets.map((t) => ({ comando: t.comando, monto: t.monto, caballo: t.caballo })),
    });
    if (res.ok) {
      // El resultado central (fuente de verdad) y el pago de tablas fijas,
      // marcas y dupletas ya los hizo `liquidarCarreraYCerrarTabla`: un solo
      // camino. Antes acá se hacía un `upsertResultadoCentral` propio —
      // la segunda manera de registrar— que competía por la misma fila.
      // Bloque 3 · Saldos: aplica la liquidación universal al saldo real de
      // los clientes (transaccional, idempotente sobre tickets Pendientes).
      const s = await aplicarLiquidacionSaldos({
        hipodromo: hipodromo.trim().toUpperCase(),
        carrera: Number(carrera),
        pizarra: r.pizarra,
        dividendos: divs,
        premio_por_tabla: r.premio_por_tabla ?? tabla?.premio_recalculado ?? tabla?.premio_original ?? null,
      });
      if (!s.ok && s.errores.length) {
        toast("Aviso de saldos: " + s.errores[0], "warning");
      }
      if (s.motivo.includes("PENDIENTES")) {
        setTablaMensaje("Aviso: " + s.motivo);
      }
    }
    setTrabajando(false);

    if (!res.ok) {
      setResultado(res.motivo);
      return;
    }
    setResumen({
      totalInvertido: res.totalInvertido,
      totalClienteNeto: res.totalClienteNeto,
      balanceBanca: res.balanceBanca,
      gananciaCasa: res.gananciaCasa,
    });
    setResultado(res.motivo);
    setTablaMensaje(
      res.tablaCerrada?.ok
        ? `Tabla Fija ${nombreHipodromoParaMostrar(hipodromo)} C${carrera} → CERRADA automáticamente (${res.tablaCerrada.conteo ?? 0} fila). Resultado centralizado.`
        : `Aviso: no se pudo cerrar la tabla (${res.tablaCerrada?.error ?? "RLS o sin credenciales"}).`
    );
    limpiar();
  };

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-600">
          💵 Pagar Carrera (cierra la Tabla Fija automáticamente)
        </h3>
        <span className="rounded-full bg-primary-500/10 px-2 py-0.5 text-[10px] font-bold text-primary-600">
          {tickets.length} ticket(s) por liquidar
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1 text-[10px] font-semibold text-slate-600">
          Hipódromo
          <input
            value={hipodromo}
            onChange={(e) => setHipodromo(e.target.value)}
            placeholder="La Rinconada"
            className="rounded-lg border border-line bg-surface px-2.5 py-2 text-xs font-bold normal-case text-slate-900 placeholder:font-normal"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-semibold text-slate-600">
          Carrera N°
          <input
            value={carrera}
            onChange={(e) => setCarrera(e.target.value)}
            type="number"
            min={1}
            placeholder="4"
            className="rounded-lg border border-line bg-surface px-2.5 py-2 text-right text-xs font-bold text-slate-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-semibold text-slate-600">
          Pizarra (llegada)
          <Button
            variant="outline"
            onClick={() => setCargandoResultados(true)}
            disabled={trabajando}
            className="justify-start border-dashed"
          >
            🏁 Cargar Resultados → 8 puestos
          </Button>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5 text-[10px] text-slate-500">
          {detalle.length > 0 ? (
            detalle.map((t) => (
              <span
                key={String(t.id)}
                className={`rounded-full border px-2 py-0.5 font-bold ${
                  t.cerrada
                    ? "border-danger-500/40 bg-danger-500/10 text-danger-500"
                    : "border-success-500/40 bg-success-500/10 text-success-500"
                }`}
              >
                {nombreHipodromoParaMostrar(t.hipodromo)} C{t.carrera} · {t.cerrada ? "Cerrada" : t.estado ?? "Abierta"}
              </span>
            ))
          ) : (
            <span className="italic">Sin tablas en caché — el cierre igual se aplica en la BD.</span>
          )}
        </div>
        <Button
          variant="success"
          onClick={() => {
            if (!hipodromo.trim() || !carrera.trim()) return setResultado("Indica Hipódromo y N° de Carrera.");
            setCargandoResultados(true);
          }}
          disabled={trabajando}
        >
          {trabajando ? "Liquidando..." : "Pagar Carrera"}
        </Button>
      </div>

      {resultado && (
        <p className="mt-3 rounded-xl bg-primary-500/10 p-3 text-[11px] font-semibold text-primary-600">
          {resultado}
        </p>
      )}
      {tablaMensaje && (
        <p
          className={`mt-2 rounded-xl p-3 text-[11px] font-bold ${
            tablaMensaje.startsWith("Aviso")
              ? "bg-warning-500/10 text-warning-500"
              : "bg-success-500/10 text-success-500"
          }`}
        >
          {tablaMensaje}
        </p>
      )}

      {resumen && (
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-line bg-surfaceAlt/40 p-3 text-[11px] sm:grid-cols-4">
          <div>
            <p className="text-slate-500">Invertido</p>
            <p className="font-bold text-slate-700">{COP.format(resumen.totalInvertido)}</p>
          </div>
          <div>
            <p className="text-slate-500">A pagar (neto)</p>
            <p className="font-bold text-success-500">{COP.format(resumen.totalClienteNeto)}</p>
          </div>
          <div>
            <p className="text-slate-500">Balance banca</p>
            <p className="font-bold text-warning-500">{COP.format(resumen.balanceBanca)}</p>
          </div>
          <div>
            <p className="text-slate-500">Comisión casa</p>
            <p className="font-bold text-primary-600">{COP.format(resumen.gananciaCasa)}</p>
          </div>
        </div>
      )}

      {resumen && !reporteCarrera && (
        <div className="mt-3">
          <Button variant="outline" disabled={cargandoReporte} onClick={() => void verReporte()}>
            {cargandoReporte ? "Armando reporte…" : "🔎 Ver Reporte de Liquidación"}
          </Button>
          {cargandoReporte && (
            <span className="ml-2 text-[10px] font-semibold text-slate-400">
              Leyendo la carrera recién liquidada…
            </span>
          )}
        </div>
      )}

      {reporteCarrera && (
        <div className="mt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-semibold text-slate-500">
              Reporte de liquidación · {hipodromo.trim().toUpperCase()} · Carrera {carrera}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const base = `reporte_liquidacion_${hipodromo
                    .trim()
                    .toUpperCase()
                    .replace(/[^a-z0-9]+/gi, "_")}_C${String(carrera).trim()}`;
                  void exportarReporteCarreraImagen("PNG", base).then((ok) =>
                    ok
                      ? toast("Imagen PNG del reporte generada.", "success")
                      : toast("No se pudo capturar el reporte como imagen.", "error")
                  );
                }}
              >
                🖼️ Imagen PNG
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const base = `reporte_liquidacion_${hipodromo
                    .trim()
                    .toUpperCase()
                    .replace(/[^a-z0-9]+/gi, "_")}_C${String(carrera).trim()}`;
                  void exportarReporteCarreraImagen("JPG", base).then((ok) =>
                    ok
                      ? toast("Imagen JPG del reporte generada.", "success")
                      : toast("No se pudo capturar el reporte como imagen.", "error")
                  );
                }}
              >
                🖼️ Imagen JPG
              </Button>
              <Button size="sm" onClick={() => window.print()}>
                🖨️ Imprimir a PDF
              </Button>
              <Button size="sm" variant="outline" onClick={() => setReporteCarrera(null)}>
                Cerrar reporte
              </Button>
            </div>
          </div>
          <ReporteCarrera datos={reporteCarrera} />
        </div>
      )}

      {cargandoResultados && (
        <CargaResultadosModal
          abierto
          onCerrar={() => setCargandoResultados(false)}
          hipodromo={hipodromo.trim().toUpperCase()}
          carrera={carrera.trim()}
          caballos={tablas.find((t) => t.hipodromo === hipodromo.trim().toUpperCase() && t.carrera === Number(carrera))?.caballos ?? null}
          onConfirmar={(r) => void pagar(r)}
        />
      )}
    </div>
  );
}

export default PagarCarreraModal;