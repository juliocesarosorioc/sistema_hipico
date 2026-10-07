"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { getHorseColor } from "@/lib/horseColors";
import {
  OPCIONES_NACIONALIDAD,
  colorDeNumero,
  textoDeNumero,
  type EjemplarTabla,
} from "@/lib/tablas/tipos";

/**
 * CRUD de UN cuadro suelto de una tabla fija publicada, abierto desde la
 * tarjeta del Monitor.
 *
 * Por que existe aparte y no dentro de "Corregir tabla": el grid
 * `EditorCaballos` ya resuelve el alta/edicion/baja de la lista COMPLETA, pero
 * obliga a abrir el modal grande de la tabla y a tocar campos que no se
 * quieren cambiar (cupos, premio, fecha, superficie). Para corregir el nombre o
 * el valor de un ejemplar, o para quitarlo, el operador no deberia tener que
 * pasar por ahi.
 *
 * El cuadro no tiene columna propia: vive dentro del array JSONB `caballos` de
 * `tablas_fijas`. Por eso este modal no escribe en la base; devuelve el cuadro
 * ya editado (o `null` si se pidio borrar) y es el Monitor quien lo mete en el
 * array y persiste el conjunto. Ver `persistirCaballos` en MonitorTablas.
 */
type Props = {
  /** El cuadro tal como esta hoy, o `null` cuando es un alta. */
  cuadro: EjemplarTabla | null;
  /** `indice === null` = alta. Cualquier otro numero = edicion de ese cuadro. */
  indice: number | null;
  /** Numeros ya usados por otros cuadros de la misma tabla, para no repetir. */
  numerosUsados: string[];
  onCancelar: () => void;
  onGuardar: (cuadro: EjemplarTabla) => void;
  onBorrar?: () => void;
  guardando?: boolean;
};

const inp =
  "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500";

export function CuadroModal({
  cuadro,
  indice,
  numerosUsados,
  onCancelar,
  onGuardar,
  onBorrar,
  guardando = false,
}: Props) {
  const esAlta = indice === null;
  const [numero, setNumero] = useState("");
  const [nombre, setNombre] = useState("");
  const [nacionalidad, setNacionalidad] = useState("VE");
  const [valor, setValor] = useState("");
  const [retirado, setRetirado] = useState(false);
  const [error, setError] = useState("");

  // El modal se reutiliza para altas y para cada cuadro, asi que el formulario
  // se (re)hidrata cada vez que cambia el cuadro mostrado. Sin esto, abrir el
  // alta tras editar el ultimo cuadro arrastraria los valores del anterior.
  useEffect(() => {
    setNumero(cuadro ? String(cuadro.numero ?? "") : "");
    setNombre(cuadro ? String(cuadro.nombre ?? "") : "");
    setNacionalidad(cuadro?.nacionalidad ? String(cuadro.nacionalidad) : "VE");
    setValor(cuadro?.valor_ejemplar != null ? String(cuadro.valor_ejemplar) : "");
    setRetirado(Boolean(cuadro?.retirado));
    setError("");
  }, [cuadro, indice]);

  const guardar = () => {
    const nom = nombre.trim().toUpperCase();
    if (!nom) {
      setError("El nombre del ejemplar es obligatorio.");
      return;
    }
    // El numero no es obligatorio (muchas carreras usan ficha por nombre), pero
    // si viene no puede estar repetido dentro de la misma tabla: con numeros
    // repetidos el color de la ficha y el cruce de vendidos se vuelven
    // ambiguos.
    const num = numero.trim();
    if (num) {
      const repetido = numerosUsados.some(
        (n) => n.trim() !== "" && n.trim().toUpperCase() === num.toUpperCase() && n.trim() !== String(cuadro?.numero ?? "").trim()
      );
      if (repetido) {
        setError(`El número ${num} ya lo tiene otro ejemplar de esta tabla.`);
        return;
      }
    }
    const valorNum = valor.trim() === "" ? null : Number(valor.replace(",", "."));
    if (valorNum != null && !Number.isFinite(valorNum)) {
      setError("El valor debe ser un número (se admite coma o punto decimal).");
      return;
    }
    onGuardar({
      // Se conservan `ganador` y `ejemplar_id` del cuadro original: editando
      // solo el nombre NO debe borrar el resultado ya cargado ni el vinculo con
      // el padron de ejemplares.
      ganador: Boolean(cuadro?.ganador),
      ejemplar_id: cuadro?.ejemplar_id ?? null,
      numero: num,
      nombre: nom,
      nacionalidad,
      valor_ejemplar: valorNum,
      retirado,
    });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={onCancelar}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm overflow-hidden rounded-xl border border-indigo-200 bg-white shadow-2xl"
      >
        <div
          className="px-3 py-2 text-white"
          style={{ background: "linear-gradient(135deg,#4f46e5 0%,#7c3aed 60%,#9333ea 100%)" }}
        >
          <h3 className="text-sm font-black uppercase tracking-wider">
            {esAlta ? "➕ Nuevo cuadro" : "✏️ Editar cuadro"}
          </h3>
        </div>

        <div className="space-y-2 p-3">
          <div className="grid grid-cols-[4.5rem_1fr] gap-2">
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Nº ficha</span>
              <input
                type="text"
                inputMode="numeric"
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                placeholder="—"
                className={`${inp} text-center font-black`}
                style={
                  numero.trim()
                    ? { backgroundColor: getHorseColor(numero).hex, borderColor: getHorseColor(numero).hex }
                    : undefined
                }
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Nombre del ejemplar</span>
              <input
                type="text"
                value={nombre}
                onChange={(e) => setNombre(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") guardar();
                }}
                placeholder="Nombre"
                className={inp}
                autoFocus
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Nacionalidad</span>
              <select value={nacionalidad} onChange={(e) => setNacionalidad(e.target.value)} className={inp}>
                {OPCIONES_NACIONALIDAD.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Valor / puntos</span>
              <input
                type="text"
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="—"
                className={`${inp} text-right font-black`}
              />
            </label>
          </div>

          <label className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
            <input
              type="checkbox"
              checked={retirado}
              onChange={(e) => setRetirado(e.target.checked)}
              className="h-4 w-4 accent-red-600"
            />
            <span className="text-xs font-bold text-slate-700">
              Retirado
              <span className="ml-1 font-semibold text-slate-400">(no suma a la base de la tabla)</span>
            </span>
          </label>

          {error ? (
            <p className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-bold text-red-700">{error}</p>
          ) : null}

          <p className="rounded bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800">
            Guardar reescribe la lista de ejemplares de la tabla y la sincroniza con la carrera central.
          </p>
        </div>

        <div className="flex items-center gap-1.5 border-t border-slate-100 px-3 py-2">
          {!esAlta && onBorrar ? (
            <Button variant="ghost" size="sm" onClick={onBorrar} disabled={guardando} className="shrink-0 border border-red-200 text-red-600 hover:bg-red-50">
              🗑️ Quitar
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onCancelar} disabled={guardando}>
            Cancelar
          </Button>
          <Button size="sm" onClick={guardar} disabled={guardando}>
            {guardando ? "Guardando…" : esAlta ? "➕ Añadir" : "💾 Guardar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
