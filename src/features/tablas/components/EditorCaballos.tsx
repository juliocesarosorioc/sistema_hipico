"use client";

import { getHorseColor } from "@/shared/lib/horseColors";
import { useRef, useState } from "react";
import { OPCIONES_NACIONALIDAD, type EjemplarTabla } from "@/features/tablas/lib/tipos";
import { colorDeNumero, textoDeNumero } from "@/features/tablas/lib/tipos";

/**
 * Grid compacto para CORREGIR las tablas (ejemplares): nº, nombre,
 * nacionalidad, valor y retirado — la base de los modales de edición
 * del Monitor (tabla publicada) y del Ensamblaje (borrador).
 *
 * Flujo del teclado: con el foco en un VALOR, Enter baja al valor de la fila
 * siguiente (y en la última fila, al valor del alta de abajo). Es la corrección
 * típica de la jornada — repasar los valores uno por uno — y así se hace sin
 * soltar el teclado ni ir al ratón.
 */
type Props = {
  caballos: EjemplarTabla[];
  onChange: (indice: number, patch: Partial<EjemplarTabla>) => void;
  onQuitar?: (indice: number) => void;
  onAgregar?: (caballo: EjemplarTabla) => void;
  /**
   * Alterna el estado INVALIDADO del ejemplar.
   *
   * Se llama ADEMAS del `onChange` (que deja el parche en el estado local del
   * editor) para que el cambio quede registrado en la base por la RPC, que es
   * la unica que valida la capacidad del operador en el servidor. Sin este
   * callback el boton sigue funcionando: solo queda en el parche local, que
   * se guarda al presionar "Corregir y guardar".
   */
  onAlternarInvalidado?: (indice: number, invalidado: boolean) => void;
};

const inp =
  "w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs font-bold text-slate-900 outline-none focus:border-indigo-400";

/** Una sola grilla para encabezado, filas y alta: columnas siempre alineadas. */
const COLS = "grid grid-cols-[2.5rem_1fr_4.5rem_4.5rem_4.75rem_2.25rem] gap-1";

export function EditorCaballos({ caballos, onChange, onQuitar, onAgregar, onAlternarInvalidado }: Props) {
  const [nuevoNum, setNuevoNum] = useState("");
  const [nuevoNom, setNuevoNom] = useState("");
  const [nuevaNac, setNuevaNac] = useState("VE");
  const [nuevoValor, setNuevoValor] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);

  /** Enfoca el próximo input de valor (o el del alta al llegar al final). */
  const bajarSiguienteValor = (indiceActual: number | "nuevo") => {
    const cont = gridRef.current;
    if (!cont) return;
    const selector =
      indiceActual === "nuevo" ? null : `input[data-valor-fila="${indiceActual + 1}"]`;
    const siguiente =
      (selector ? cont.querySelector<HTMLInputElement>(selector) : null) ??
      cont.querySelector<HTMLInputElement>('input[data-valor-fila="nuevo"]');
    if (siguiente) {
      siguiente.focus();
      siguiente.select?.();
    }
  };

  const agregar = () => {
    const nombre = nuevoNom.trim().toUpperCase();
    if (!nombre) {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg: "Escriba el nombre del ejemplar para añadirlo.", tipo: "warning" } }));
      return;
    }
    onAgregar?.({ numero: nuevoNum.trim(), nombre, nacionalidad: nuevaNac, valor_ejemplar: nuevoValor.trim() });
    setNuevoNum("");
    setNuevoNom("");
    setNuevaNac("VE");
    setNuevoValor("");
  };

  return (
    <div className="space-y-1" ref={gridRef}>
      <div className={COLS}>
        <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Nº</span>
        <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Ejemplar</span>
        <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">Nac.</span>
        <span className="text-right text-[9px] font-black uppercase tracking-wider text-slate-400">Valor</span>
        <span
          className="text-center text-[9px] font-black uppercase tracking-wider text-slate-400"
          title="Invalidado: el ejemplar esta descalificado, no puede ganar ni ser pagado como ganador"
        >
          Inv.
        </span>
        <span className="text-center text-[9px] font-black uppercase tracking-wider text-slate-400" title="Retirado: no suma a la base de la tabla">
          Ret.
        </span>
      </div>
      {caballos.length === 0 && (
        <p className="rounded border border-dashed border-slate-300 p-3 text-center text-[11px] font-semibold text-slate-400">
          Sin ejemplares. Añádelos abajo.
        </p>
      )}
      {caballos.map((c, i) => {
        const retirado = Boolean(c.retirado);
        const invalidado = Boolean(c.invalidado);
        return (
          <div
            key={i}
            className={`${COLS} items-center rounded ${retirado ? "bg-red-50/70" : invalidado ? "bg-purple-50/70" : "hover:bg-slate-50"}`}
          >
            <input
              type="text"
              inputMode="numeric"
              value={String(c.numero ?? "")}
              onChange={(e) => onChange(i, { numero: e.target.value })}
              placeholder="Nº"
              title={retirado ? "Ejemplar retirado" : invalidado ? "Ejemplar invalidado (no puede ganar)" : undefined}
              className={`${inp} text-center font-black ${retirado ? "opacity-60" : ""}`}
              style={{ backgroundColor: colorDeNumero(c.numero), color: textoDeNumero(c.numero) }}
            />
            <input
              type="text"
              value={String(c.nombre ?? "")}
              onChange={(e) => onChange(i, { nombre: e.target.value.toUpperCase() })}
              placeholder="Nombre del ejemplar"
              className={`${inp} ${retirado ? "text-slate-400 line-through" : invalidado ? "text-purple-700 line-through" : ""}`}
            />
            <select
              value={String(c.nacionalidad ?? "VE")}
              onChange={(e) => onChange(i, { nacionalidad: e.target.value })}
              className={inp}
            >
              {OPCIONES_NACIONALIDAD.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <input
              type="text"
              inputMode="decimal"
              data-valor-fila={i}
              value={c.valor_ejemplar != null ? String(c.valor_ejemplar) : ""}
              onChange={(e) => onChange(i, { valor_ejemplar: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  bajarSiguienteValor(i);
                }
              }}
              placeholder="—"
              className={`${inp} text-right font-black`}
            />
            {/*
              Boton INVALIDADO: alterna el estado del ejemplar (descalificado).
              Es un boton PROPIO, no el input del nombre ni el del valor, asi
              que no dispara el onChange de la edicion: solo el parche del
              invalidamiento. El texto dice la ACCION que hace ("INVALIDADO"
              cuando el ejemplar es valido y hay que descalificarlo; "VALIDO"
              cuando ya esta descalificado y hay que habilitarlo).
            */}
            <button
              type="button"
              onClick={() => {
                onChange(i, {
                  invalidado: !Boolean(c.invalidado),
                  motivo_invalidacion: !c.invalidado ? "Invalidado en Tabla Fija" : undefined,
                });
                onAlternarInvalidado?.(i, !Boolean(c.invalidado));
              }}
              title={
                invalidado
                  ? `${String(c.nombre ?? "").trim() || `Ejemplar ${i + 1}`}: INVALIDADO (no puede ganar). Pulse para habilitarlo y que vuelva a repartir.`
                  : `${String(c.nombre ?? "").trim() || `Ejemplar ${i + 1}`}: marcar como INVALIDADO (no puede ganar ni ser pagado como ganador).`
              }
              aria-label={
                invalidado
                  ? `Habilitar ${String(c.nombre ?? "").trim() || `ejemplar ${i + 1}`} (quitar invalidacion)`
                  : `Invalidar ${String(c.nombre ?? "").trim() || `ejemplar ${i + 1}`}`
              }
              className={`w-full rounded px-1 py-0.5 text-[8px] font-black uppercase leading-none transition ${
                invalidado
                  ? "bg-purple-600 text-white hover:bg-purple-700"
                  : "border border-purple-300 bg-white text-purple-700 hover:bg-purple-100"
              }`}
            >
              {invalidado ? "✔ VÁLIDO" : "🚫 INVALIDADO"}
            </button>
            <div className="flex items-center justify-center gap-0.5">
              <input
                type="checkbox"
                checked={retirado}
                onChange={(e) => onChange(i, { retirado: e.target.checked })}
                title={retirado ? "Retirado (no suma a la base)" : "Marcar como retirado"}
                aria-label="Retirado"
                className="h-4 w-4 cursor-pointer accent-red-600"
              />
              {onQuitar ? (
                <button
                  type="button"
                  onClick={() => onQuitar(i)}
                  title="Quitar ejemplar"
                  aria-label="Quitar ejemplar"
                  className="rounded px-0.5 text-sm leading-none text-slate-400 hover:bg-red-100 hover:text-red-600"
                >
                  🗑️
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
      {onAgregar && (
        <div className={`${COLS} items-center rounded border-t border-dashed border-slate-200 pt-1`}>
          <input
            type="text"
            inputMode="numeric"
            value={nuevoNum}
            onChange={(e) => setNuevoNum(e.target.value)}
            placeholder="Nº"
            style={{ backgroundColor: colorDeNumero(nuevoNum), color: textoDeNumero(nuevoNum) }}
            className={`${inp} border-2 text-center font-black`}
          />
          <input
            type="text"
            value={nuevoNom}
            onChange={(e) => setNuevoNom(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && agregar()}
            placeholder="Nuevo ejemplar…"
            className={inp}
          />
          <select value={nuevaNac} onChange={(e) => setNuevaNac(e.target.value)} className={inp}>
            {OPCIONES_NACIONALIDAD.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <input
            type="text"
            inputMode="decimal"
            data-valor-fila="nuevo"
            value={nuevoValor}
            onChange={(e) => setNuevoValor(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                agregar();
              }
            }}
            placeholder="—"
            className={`${inp} text-right font-black`}
          />
          {/* Columna del boton INVALIDADO: en el alta no aplica (un ejemplar
              nuevo no nasce descalificado), pero el hueco mantiene el "+" en
              la misma columna que en las filas. */}
          <span />
          <button
            type="button"
            onClick={agregar}
            className="h-full rounded bg-indigo-600 text-xs font-black text-white hover:bg-indigo-700"
            title="Añadir ejemplar"
            aria-label="Añadir ejemplar"
          >
            ＋
          </button>
        </div>
      )}
      <span className="block text-right text-[9px] font-bold text-slate-400">
        ✏️ Enter en Valor baja al siguiente. La moneda de la tabla se estipula según el grupo (no se muestra símbolo en la edición ni impresión).
      </span>
    </div>
  );
}
