"use client";

import { useState } from "react";
import { Flag } from "@/shared/components/ui/BanderaPais";
import {
  aNum,
  banderaGaceta,
  colorDeNumeroGac,
  nacEjemplar,
  SUPERFICIES,
  type CarreraRegistro,
  type EjemplarEditable,
} from "@/features/gaceta/lib/ui";
import { nombrePropioHipodromo } from "@/features/hipodromos/lib/nombre";
import type { OpcionHipodromo } from "@/features/tablas/lib/rpc";
import { validarCarrera, generarMensajeParaAgenteIA } from "@/features/gaceta/lib/validador";
import { emitirToast } from "@/shared/lib/mensajeria";

type Props = {
  index: number;
  carrera: CarreraRegistro;
  onChange: (c: CarreraRegistro) => void;
  onEnviar: (i: number) => void;
  onEliminar?: () => void;
  onReverificar?: (i: number) => void;
  reverificando?: boolean;
  /** Catálogo de hipódromos activos: para mostrar el NOMBRE PROPIO del hipódromo. */
  hipodromos?: OpcionHipodromo[];
};

export function CarreraGacetaCard({
  index,
  carrera,
  onChange,
  onEnviar,
  onEliminar,
  onReverificar,
  reverificando,
  hipodromos,
}: Props) {
  const [mostrarAlertas, setMostrarAlertas] = useState(false);
  const numCarrera = carrera.carrera || index + 1;
  const ejemplares = Array.isArray(carrera.ejemplares) ? carrera.ejemplares : [];
  const suma = ejemplares.reduce((a, ej) => a + (aNum(ej.valor) ?? aNum(ej.pts) ?? 0), 0);

  const diagnostico = validarCarrera(carrera);

  const set = (patch: Partial<CarreraRegistro>) => onChange({ ...carrera, ...patch });

  const setEj = (j: number, patch: Partial<EjemplarEditable>) =>
    set({ ejemplares: ejemplares.map((e, k) => (k === j ? { ...e, ...patch } : e)) });

  const agregarCaballo = () => {
    // Busca el primer número correlativo faltante o el siguiente
    const numerosExistentes = new Set(
      ejemplares.map((e) => parseInt(String(e.numero ?? "").replace(/\D/g, ""), 10)).filter((n) => !Number.isNaN(n))
    );
    let numSugerido = 1;
    while (numerosExistentes.has(numSugerido)) {
      numSugerido++;
    }

    const nuevo: EjemplarEditable = {
      numero: numSugerido,
      nombre: "",
      nacionalidad: nacEjemplar(null, carrera.hipodromo),
      valor: 0,
      pts: 0,
    };
    set({ ejemplares: [...ejemplares, nuevo] });
  };

  const eliminarCaballo = (pos: number) => {
    set({ ejemplares: ejemplares.filter((_, k) => k !== pos) });
  };

  const copiarInstruccionAgente = () => {
    const texto = generarMensajeParaAgenteIA(carrera, diagnostico, carrera.fecha || "");
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(texto).then(() => {
        emitirToast(`📋 Reporte de discrepancia copiado para la Carrera ${numCarrera}.`, "success");
      }).catch(() => {
        emitirToast("No se pudo copiar al portapapeles.", "warning");
      });
    }
  };

  const hipo = String(carrera.hipodromo || "").trim().toUpperCase();
  const nombreHipo = nombrePropioHipodromo(hipo, hipodromos ?? []);
  const dist = String(carrera.distancia ?? "");
  const superficie = String(carrera.superficie || "ARENA").toUpperCase();
  const premio = String(carrera.premio ?? 100);

  const inpIndigo =
    "rounded px-1 py-px text-[9px] font-black outline-none placeholder:text-white/40 focus:ring-1 focus:ring-indigo-300";
  const inpClaro = `bg-white/25 text-white ${inpIndigo}`;
  const inpEdit = "border border-slate-300 bg-white text-slate-700 " + inpIndigo;

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border bg-white shadow-sm transition-all ${
        diagnostico.nivel === "incompleta"
          ? "border-red-400 ring-1 ring-red-400/50"
          : diagnostico.nivel === "advertencia"
          ? "border-amber-400 ring-1 ring-amber-400/40"
          : "border-indigo-200"
      }`}
      data-carrera={index}
    >
      {/* Cabecera índigo (morada) con badge de validación */}
      <div className={`${diagnostico.nivel === "incompleta" ? "bg-red-800" : diagnostico.nivel === "advertencia" ? "bg-slate-800" : "bg-indigo-600"} px-2 py-1 text-white`}>
        <div className="flex items-center justify-between gap-1">
          <div className="min-w-0 flex-1">
            <input
              type="text"
              value={hipo}
              onChange={(e) => set({ hipodromo: e.target.value.toUpperCase() })}
              placeholder="Hipódromo"
              title="Hipódromo"
              className={`${inpClaro} w-full uppercase`}
            />
            {nombreHipo && nombreHipo !== hipo ? (
              <span className="block truncate leading-none text-[8px] font-bold normal-case text-indigo-100/90" title={nombreHipo}>
                {nombreHipo}
              </span>
            ) : null}
          </div>
          <span className="flex items-center gap-0.5 whitespace-nowrap text-[10px] font-black">
            🏁 C
            <input
              type="number"
              value={numCarrera}
              onChange={(e) => set({ carrera: e.target.value ? Number(e.target.value) : null })}
              placeholder="N°"
              title="Número de la carrera"
              className={`${inpClaro} w-12 text-center`}
            />
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => onEliminar?.()}
              title="Eliminar esta carrera del registro"
              aria-label="Eliminar esta carrera"
              className="rounded px-0.5 text-[11px] leading-none transition-colors hover:bg-white/20"
            >
              🗑️
            </button>
            <input
              type="checkbox"
              checked={!!carrera.seleccionada}
              onChange={(e) => set({ seleccionada: e.target.checked })}
              title="Incluir al enviar al Ensamblaje"
              className="h-3.5 w-3.5 shrink-0 accent-indigo-500"
            />
          </span>
        </div>

        {/* Barra de estado de validación y archivo de origen */}
        <div className="mt-1 flex items-center justify-between gap-1 border-t border-white/20 pt-1 text-[8px]">
          <button
            type="button"
            onClick={() => setMostrarAlertas(!mostrarAlertas)}
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-black uppercase transition-colors ${
              diagnostico.nivel === "completa"
                ? "bg-emerald-500/30 text-emerald-200 hover:bg-emerald-500/40"
                : diagnostico.nivel === "advertencia"
                ? "bg-amber-400 text-amber-950 hover:bg-amber-300"
                : "bg-red-500 text-white hover:bg-red-400 animate-pulse"
            }`}
            title="Ver/Ocultar detalles de validación de esta carrera"
          >
            {diagnostico.nivel === "completa" ? (
              <><span>✅</span> Verificada</>
            ) : diagnostico.nivel === "advertencia" ? (
              <><span>⚠️</span> Faltan datos ({diagnostico.incidencias.length})</>
            ) : (
              <><span>❌</span> Incompleta ({diagnostico.incidencias.length})</>
            )}
          </button>

          {carrera.archivoOrigen && (
            <span
              className="max-w-[120px] truncate text-[8px] font-bold opacity-80"
              title={`Archivo de origen: ${carrera.archivoOrigen}`}
            >
              📁 {carrera.archivoOrigen}
            </span>
          )}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-1 text-[8px] font-bold">
          <span className={`${inpClaro} inline-flex items-center gap-0.5 rounded px-1 py-px`}>
            Dist:
            <input
              type="number"
              value={dist}
              onChange={(e) => set({ distancia: e.target.value })}
              placeholder="m"
              title="Distancia"
              className="w-11 bg-transparent text-right font-black text-white outline-none placeholder:text-white/40"
            />
            m
          </span>
          <select
            value={superficie}
            onChange={(e) => set({ superficie: e.target.value })}
            aria-label="Superficie"
            className="rounded bg-white/25 px-0.5 py-px text-[8px] font-bold uppercase text-white outline-none"
          >
            {SUPERFICIES.map((s) => (
              <option key={s} value={s} className="bg-slate-900 text-white">
                {s}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={carrera.fecha || ""}
            onChange={(e) => set({ fecha: e.target.value || null })}
            className="hidden"
            aria-hidden
            tabIndex={-1}
          />
        </div>

        <div className="mt-1 flex items-center justify-between rounded bg-white/25 px-2 py-1">
          <span className="text-[9px] font-black uppercase tracking-wider opacity-95">💰 Monto a Pagar / Tabla</span>
          <span className="flex items-center gap-0.5 text-sm font-black text-white">
            $
            <input
              type="number"
              step="0.01"
              value={premio}
              onChange={(e) => set({ premio: e.target.value ? Number(e.target.value) : 0 })}
              title="Monto a pagar de la tabla"
              className="w-14 border-b-2 border-white/50 bg-transparent text-right font-black text-white outline-none"
            />
          </span>
        </div>
      </div>

      {/* Panel desplegable de diagnóstico y discrepancias */}
      {(mostrarAlertas || diagnostico.nivel === "incompleta") && diagnostico.incidencias.length > 0 && (
        <div className="border-b border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-950">
          <div className="mb-1 flex items-center justify-between font-bold">
            <span className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-amber-800">
              ⚠️ Observaciones de Integridad:
            </span>
            <button
              type="button"
              onClick={() => setMostrarAlertas(false)}
              className="text-[9px] text-amber-700 hover:underline"
            >
              Cerrar
            </button>
          </div>
          <ul className="space-y-0.5 pl-3 list-disc text-[9px]">
            {diagnostico.incidencias.map((inc, k) => (
              <li key={k} className={inc.tipo === "error" ? "font-bold text-red-700" : "text-amber-800"}>
                {inc.mensaje}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex flex-wrap gap-1">
            {onReverificar && (
              <button
                type="button"
                onClick={() => onReverificar(index)}
                disabled={reverificando}
                className="flex-1 rounded bg-indigo-600 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-white shadow-xs hover:bg-indigo-700 disabled:opacity-50"
              >
                {reverificando ? "Re-verificando con IA…" : "🤖 Re-verificar con IA"}
              </button>
            )}
            <button
              type="button"
              onClick={copiarInstruccionAgente}
              className="flex-1 rounded bg-amber-200 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-amber-900 hover:bg-amber-300"
              title="Copia el reporte con la discrepancia para informarle al agente o a los operadores"
            >
              📢 Reportar al Agente
            </button>
          </div>
        </div>
      )}

      {/* Subetiqueta ejemplares con botón de agregar caballo */}
      <div className="flex items-center justify-between px-2 pb-0.5 pt-1 text-[8px] font-black uppercase tracking-wider text-slate-400">
        <span className="flex items-center gap-1">
          <span>🐴 Ejemplares</span>
          <span className="rounded-full bg-slate-100 px-1.5 font-black text-slate-600">{ejemplares.length}</span>
        </span>
        <button
          type="button"
          onClick={agregarCaballo}
          className="rounded bg-indigo-50 px-1.5 py-0.5 text-[8px] font-black normal-case text-indigo-700 hover:bg-indigo-100 hover:text-indigo-900 transition-colors"
          title="Agregar un caballo faltante a esta carrera"
        >
          ➕ Agregar Caballo
        </button>
      </div>

      {/* Lista de ejemplares con nombres editables y opción para corregir */}
      <div className="flex-1 space-y-0.5 px-1.5 py-0.5">
        {ejemplares.length === 0 && (
          <div className="rounded-lg border border-dashed border-red-200 bg-red-50 p-2 text-center text-[10px] text-red-600">
            <p className="font-bold">Sin ejemplares detectados.</p>
            <button
              type="button"
              onClick={agregarCaballo}
              className="mt-1 inline-block rounded bg-red-600 px-2 py-0.5 text-[9px] font-bold text-white hover:bg-red-700"
            >
              + Agregar primer ejemplar
            </button>
          </div>
        )}
        {ejemplares.map((ej, j) => {
          const nac = nacEjemplar(ej, hipo);
          const color = colorDeNumeroGac(ej.numero);
          const badge = ej.ejemplar_id ? (ej.nuevo ? "★" : "✓") : "✗";
          const badgeTxt = ej.ejemplar_id ? (ej.nuevo ? "Nuevo en el padrón" : "Vinculado al padrón") : "Sin padrón";
          const faltaNombre = !String(ej.nombre || "").trim();

          return (
            <div
              key={`${ej.nombre}-${j}`}
              className={`flex items-center gap-0.5 rounded border px-1 py-0.5 transition-colors ${
                faltaNombre ? "border-red-300 bg-red-50/60" : "border-slate-200 bg-slate-50"
              }`}
              title={`${ej.nombre || "SIN NOMBRE"} · ${nac}${ej.jockey ? ` · Jinete: ${ej.jockey}` : ""}`}
            >
              <input
                type="text"
                inputMode="numeric"
                value={String(ej.numero ?? "")}
                onChange={(e) => setEj(j, { numero: e.target.value })}
                placeholder="Nº"
                title="Número de gualdrapa / partidor"
                tabIndex={-1}
                className={`w-5 shrink-0 rounded px-0 py-px text-center text-[8px] font-black outline-none focus:ring-1 focus:ring-indigo-400 ${inpEdit}`}
                style={{ backgroundColor: color.bg, color: color.fg, borderColor: color.bg }}
              />
              <input
                type="text"
                value={String(ej.nombre ?? "")}
                onChange={(e) => setEj(j, { nombre: e.target.value.toUpperCase() })}
                placeholder="Nombre del ejemplar (editable)"
                title="Nombre del ejemplar — Puede escribir o corregir directamente"
                className={`min-w-0 w-full flex-1 rounded border px-1 py-px text-[10px] font-bold uppercase outline-none focus:ring-1 focus:ring-indigo-400 ${
                  faltaNombre
                    ? "border-red-400 bg-white text-red-900 placeholder:text-red-400"
                    : "border-slate-200 bg-white text-slate-800"
                }`}
              />
              {banderaGaceta(nac) && (
                <span className="inline-flex w-4 shrink-0 justify-center leading-none" title={nac}>
                  <Flag nac={nac} size={13} withName={false} />
                </span>
              )}
              <input
                type="text"
                inputMode="decimal"
                value={ej.valor ?? ej.pts ?? ""}
                onChange={(e) => setEj(j, { valor: e.target.value.replace(/^0+(?=\d)/, "") })}
                onFocus={(e) => (e.target as HTMLInputElement).select()}
                placeholder="0"
                title="Valor / monta del ejemplar"
                data-gac-valor
                className="w-12 shrink-0 rounded border border-slate-200 px-0.5 py-px text-right text-[12px] font-black text-blue-700 outline-none focus:ring-1 focus:ring-indigo-400"
              />
              <span
                className={`w-3.5 shrink-0 text-center text-[9px] font-black ${
                  ej.ejemplar_id ? (ej.nuevo ? "text-emerald-600" : "text-slate-400") : "text-red-400"
                }`}
                title={badgeTxt}
              >
                {badge}
              </span>
              <button
                type="button"
                onClick={() => eliminarCaballo(j)}
                title="Quitar este ejemplar"
                aria-label="Quitar este ejemplar"
                className="shrink-0 px-0.5 text-[9px] text-slate-400 hover:text-red-600 transition-colors"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {/* Suma de la Tabla */}
      <div className="flex items-center justify-between border-t border-slate-200 bg-white px-2 py-1">
        <span className="text-[8px] font-black uppercase tracking-wider text-slate-400">🧮 Suma de la Tabla</span>
        <span className="text-[11px] font-black text-indigo-700" title="Sumatoria de los valores de todos los ejemplares">
          $ {suma.toLocaleString("es-VE", { maximumFractionDigits: 2 })}
        </span>
      </div>

      {/* Acciones principales y re-verificación */}
      <div className="flex flex-col gap-1 border-t border-slate-200 bg-white px-2 py-1.5">
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => onEnviar(index)}
            className="flex-1 rounded-lg bg-cyan-600 py-1.5 text-[10px] font-black uppercase tracking-wide text-white shadow transition-colors hover:bg-cyan-700"
            title="Lleva esta carrera al Ensamblaje para revisar sus VALORES y publicar"
          >
            ➡ Cargar en el Ensamblaje
          </button>
        </div>

        <div className="flex gap-1">
          {onReverificar && (
            <button
              type="button"
              onClick={() => onReverificar(index)}
              disabled={reverificando}
              className="flex-1 rounded border border-indigo-200 bg-indigo-50 py-1 text-[9px] font-bold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 transition-colors"
              title="Solicitar al Agente IA que vuelva a analizar esta carrera"
            >
              {reverificando ? "Re-analizando…" : "🤖 Re-verificar IA"}
            </button>
          )}
          <button
            type="button"
            onClick={copiarInstruccionAgente}
            className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[9px] font-bold text-slate-600 hover:bg-slate-100 transition-colors"
            title="Copiar reporte de discrepancia para el agente o chat"
          >
            📋 Discrepancia
          </button>
        </div>
      </div>
    </div>
  );
}

export default CarreraGacetaCard;
