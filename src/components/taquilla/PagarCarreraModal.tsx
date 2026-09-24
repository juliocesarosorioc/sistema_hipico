"use client";

import { useState } from "react";
import { useTaquillaStore } from "@/store/useTaquillaStore";
import { useTablasFijasStore } from "@/store/useTablasFijasStore";
import { liquidarCarreraYCerrarTabla } from "@/lib/liquidacion/pagarYCerrar";
import { aplicarLiquidacionSaldos } from "@/lib/liquidacion/saldos";
import { upsertResultadoCentral } from "@/lib/carreras-dia";
import { CargaResultadosModal, type PizarraResultados } from "@/components/liquidacion/CargaResultadosModal";
import { Button } from "@/components/ui/Button";

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
    const res = await liquidarCarreraYCerrarTabla({
      hipodromo: hipodromo.trim().toUpperCase(),
      carrera: Number(carrera),
      pizarra: r.pizarra,
      dividendos: r.dividendos ?? null,
      tickets: tickets.map((t) => ({ comando: t.comando, monto: t.monto })),
    });
    if (res.ok) {
      // Centraliza el resultado en resultados_carreras (fuente de verdad) y
      // dispara el pago automático de las tablas vendidas (estado Liquidada).
      const tabla = tablas.find(
        (t) =>
          t.hipodromo === hipodromo.trim().toUpperCase() &&
          t.carrera === Number(carrera)
      );
      await upsertResultadoCentral({
        hipodromo: hipodromo.trim().toUpperCase(),
        carrera: Number(carrera),
        ganadores: [r.pizarra.primero],
        retirados: tabla?.retirados_oficiales ?? "NO HUBO RETIROS",
        premio_oficial: tabla?.premio_original ?? undefined,
        premio_recalculado: tabla?.premio_recalculado ?? undefined,
        detalle: { caballos: tabla?.caballos },
        cargado_por: "TAQUILLA",
        orden_llegada: ordenLlegadaDePizarra(r.pizarra),
        dividendos: r.dividendos ?? null,
      });
      // Bloque 3 · Saldos: aplica la liquidación universal al saldo real de
      // los clientes (transaccional, idempotente sobre tickets Pendientes).
      const s = await aplicarLiquidacionSaldos({
        hipodromo: hipodromo.trim().toUpperCase(),
        carrera: Number(carrera),
        pizarra: r.pizarra,
        dividendos: r.dividendos ?? null,
        premio_por_tabla: r.premio_por_tabla ?? tabla?.premio_recalculado ?? tabla?.premio_original ?? null,
      });
      if (!s.ok && s.errores.length) {
        toast("Aviso de saldos: " + s.errores[0], "warning");
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
        ? `Tabla Fija ${hipodromo.trim().toUpperCase()} C${carrera} → CERRADA automáticamente (${res.tablaCerrada.conteo ?? 0} fila). Resultado centralizado.`
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
            placeholder="LA RINCONADA"
            className="rounded-lg border border-line bg-surface px-2.5 py-2 text-xs font-bold uppercase text-slate-900 placeholder:font-normal"
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
            className="rounded-lg border border-line bg-surface px-2.5 py-2 text-xs font-bold text-slate-900"
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
                {t.hipodromo} C{t.carrera} · {t.cerrada ? "Cerrada" : t.estado ?? "Abierta"}
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

/** Orden de llegada oficial [{numero, puesto}] derivada de la pizarra. */
function ordenLlegadaDePizarra(p: PizarraResultados["pizarra"]): Array<{ numero: string; puesto: number }> {
  const orden = ["primero", "segundo", "tercero", "cuarto", "quinto", "sexto", "septimo", "octavo"] as const;
  const out: Array<{ numero: string; puesto: number }> = [];
  orden.forEach((k, i) => {
    const v = p[k];
    if (typeof v === "string" && v.trim() !== "") out.push({ numero: v.trim(), puesto: i + 1 });
  });
  return out;
}

export default PagarCarreraModal;