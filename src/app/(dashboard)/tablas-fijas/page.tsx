"use client";

import { TablasModule } from "@/components/tablas/TablasModule";
import type { StoredTablaFija } from "@/store/useTablasFijasStore";
import type { VentaTablaItem } from "@/components/tablas/MonitorTablas";
import type { PizarraResultados } from "@/components/liquidacion/CargaResultadosModal";
import { publicarTabla, publicarTablasLote, actualizarTabla, venderTablaFija, liquidarTablaFija } from "@/lib/tablas/rpc";
import { cerrarTablaFija } from "@/lib/tablas-fijas";
import { upsertResultadoCentral } from "@/lib/carreras-dia";
import { posicionesDePizarra } from "@/lib/liquidacion/posiciones";

/**
 * Ruta Tablas Fijas — integración con Supabase y Zustand:
 *  - publicar  → upsert en tablas_fijas (estado 'Abierta') + refresh de caché
 *  - editar    → UPDATE de solo columnas seguras
 *  - vender    → ticket en useTaquillaStore + contador cantidad_vendida
 *  - liquidar  → guarda la pizarra (8 posiciones + dead heat) y cierra la
 *                tabla en BD; marcarCerrada() la quita del Monitor en vivo.
 */
export default function TablasFijasPage() {
  return (
    <div className="p-4 lg:p-6">
      <TablasModule
        persistirPublicacion={async (t: StoredTablaFija) => {
          const r = await publicarTabla(t);
          return { ok: r.ok, id: r.id ?? t.id, error: r.error };
        }}
        persistirLote={async (lote: StoredTablaFija[]) => {
          const r = await publicarTablasLote(lote);
          return { ok: r.ok, okCount: r.okCount, errores: r.errores };
        }}
        persistirEdicion={async (t: StoredTablaFija, patch: Record<string, unknown>) => {
          const r = await actualizarTabla(t.id, patch);
          return r.ok;
        }}
        persistirVenta={async (t: StoredTablaFija, v: VentaTablaItem) => {
          // Sin jugador o sin grupo no hay venta: el ticket necesita ambos para
          // el estado de cuenta y el convenio de comision.
          if (!v.jugador?.id) return { ok: false, error: "Seleccione el jugador que compra." };
          if (!v.grupo?.id) return { ok: false, error: "Seleccione el grupo de venta." };
          const r = await venderTablaFija({
            tablaId: t.id,
            clienteId: String(v.jugador.id),
            grupoId: String(v.grupo.id),
            monto: v.monto,
            cantidad: v.cantidad ?? 1,
            // "TABLA" es la opcion de tabla completa; la RPC espera null.
            ejemplarNumero: v.numero === "TABLA" ? null : v.numero,
          });
          return { ok: r.ok, error: r.error };
        }}
        persistirLiquidacion={async (t: StoredTablaFija, r: PizarraResultados) => {
          // 1) Resolver los tickets ANTES de cerrar. Si esto falla, la tabla
          //    queda abierta y se puede reintentar; cerrarla primero dejaria
          //    ventas sin pagar sin forma de retomarlas.
          const ganador = String(r.pizarra.primero ?? "").trim();
          if (!ganador) return false;
          const liq = await liquidarTablaFija({ tablaId: t.id, ganadores: ganador });
          if (!liq.ok) return false;

          // 2) Resultados centrales. Aqui van las 8 posiciones, que es lo que
          //    necesitan las demas jugadas de la carrera.
          //    Antes se llamaba ademas a `guardarPizarraCarrera`, que escribia
          //    en la RPC `club_guardar_pizarra_carrera`: esa RPC no existe en
          //    ningun .sql del repo y la funcion devolvia `false` tragandose el
          //    error, asi que la pizarra NUNCA se guardo por ahi. Todo lo que
          //    hace falta lo escribe el upsert de abajo.
          const posiciones = posicionesDePizarra(r.pizarra);
          await upsertResultadoCentral({
            hipodromo: t.hipodromo ?? "",
            carrera: t.carrera ?? 0,
            ganadores: posiciones,
            retirados: t.retirados_oficiales ?? "NO HUBO RETIROS",
            premio_oficial: t.premio_original ?? undefined,
            premio_recalculado: t.premio_recalculado ?? undefined,
            detalle: { caballos: t.caballos },
            cargado_por: "TABLAS-FIJAS",
          });

          // 3) Cerrar la tabla para que salga del Monitor.
          const cierre = await cerrarTablaFija(t.hipodromo ?? "", t.carrera ?? 0);
          return cierre.ok;
        }}
      />
    </div>
  );
}