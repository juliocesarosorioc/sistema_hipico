"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SearchableSelect, type OpcionSelect } from "@/components/ui/SearchableSelect";
import {
  parsearSeleccion,
  revisarVenta,
  totalVenta,
  textoCombinacion,
  type CarreraPolla,
  type Polla,
} from "@/lib/pollas";
import type { ClienteRow } from "@/lib/clientes";

type Props = {
  abierto: boolean;
  polla: Polla;
  clientes: ClienteRow[];
  onCerrar: () => void;
  onConfirmar: (datos: {
    clienteId: string | null;
    numeroTicket: string;
    texto: string;
  }) => Promise<boolean>;
};

/**
 * ============================================================================
 * COBRAR UNA POLLA
 * ============================================================================
 *
 * Acá está la parte del juego que el jugador hace en el papel: escribe sus
 * números y el módulo los convierte en combinaciones.
 *
 * LA REGLA DE LECTURA
 * ------------------
 * Los grupos se separan por coma o salto de línea, y dentro de un grupo el guion
 * separa alternativas. El grupo N es la carrera N de la Polla, en el orden en que
 * la casa configuró las carreras:
 *
 *     1, 2-3, 1-2, 4, 5, 6      →  4 combinaciones
 *     1 / 2-3 / 1 / 2-3 / 4 / 2-3 → 8 combinaciones
 *     1-2-3-4-5-6  (6 carreras)  →  1 sola combinación
 *
 * El último caso es el "corrida": un grupo con un guion por carrera no son seis
 * opciones, es un solo ejemplar en cada una.
 *
 * Cada combinación necesita un ejemplar por carrera y paga el precio de la Polla.
 * El jugador puede comprar las que quiera: no es una jugada por persona.
 *
 * TODO SE MUESTRA ANTES DE COBRAR. El conteo y el total se calculan mientras se
 * escribe, porque en un mostrador la diferencia entre 8 combinaciones y 80 es la
 * diferencia entre cobrar bien y cobrar mal.
 */
export function ModalVentaPolla({ abierto, polla, clientes, onCerrar, onConfirmar }: Props) {
  const [texto, setTexto] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [ticket, setTicket] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const carreras: CarreraPolla[] = polla.carreras;

  /**
   * Previsualización en vivo del texto escrito.
   *
   * `revisarVenta` devuelve las combinaciones Y las que no se pueden cobrar, así
   * que acá se puede decir "8 combinaciones, la tercera tiene el 7 que no corre"
   * en vez de un error genérico cuando se confirma.
   */
  const vista = useMemo(() => {
    if (!texto.trim()) {
      return { combinaciones: [], invalidas: [], total: 0, error: null as string | null };
    }
    const parseo = parsearSeleccion(texto, carreras);
    if (!parseo.ok) {
      return { combinaciones: [], invalidas: [], total: 0, error: parseo.error };
    }
    const rev = revisarVenta(parseo.combinaciones, carreras);
    return {
      combinaciones: rev.validas,
      invalidas: rev.invalidas,
      total: totalVenta(rev.validas.length, polla.precioUnitario),
      error: null,
    };
  }, [texto, carreras, polla.precioUnitario]);

  const cerrar = () => {
    setTexto("");
    setClienteId("");
    setTicket("");
    setError(null);
    onCerrar();
  };

  const confirmar = async () => {
    setError(null);
    if (vista.combinaciones.length === 0) {
      setError("No hay combinaciones válidas para cobrar.");
      return;
    }
    setGuardando(true);
    const ok = await onConfirmar({
      clienteId: clienteId || null,
      numeroTicket: ticket.trim(),
      texto,
    });
    setGuardando(false);
    if (ok) cerrar();
  };

  if (!abierto) return null;

  const opcionesCliente: OpcionSelect[] = clientes.map((c) => ({
    value: String(c.id),
    label: c.nombre ?? String(c.id),
  }));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4">
      <div className="my-8 w-full max-w-3xl rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Cobrar Polla</h2>
            <p className="text-sm text-slate-600">
              {polla.nombre} · {polla.carreras.length} carreras · {formato(polla.precioUnitario)} por combinación
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={cerrar} aria-label="Cerrar">
            Cerrar
          </Button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* Para qué carrera es cada número. Sin esto el jugador no tiene forma
              de saber qué se le pide en la segunda casilla. */}
          <div className="rounded-lg bg-surfaceAlt px-3 py-2 text-sm">
            <div className="font-semibold text-slate-800">En este orden:</div>
            <ol className="mt-1 list-inside list-decimal text-slate-700">
              {carreras.map((c) => (
                <li key={c.clave}>
                  <span className="font-medium">
                    {c.hipodromo} {c.carrera}ª
                  </span>{" "}
                  <span className="text-slate-500">
                    ({c.ejemplares.map((e) => e.numero).join(", ")})
                  </span>
                  {c.invalidados && c.invalidados.length > 0 && (
                    <span className="ml-1 text-danger-600">
                      · no corre: {c.invalidados.join(", ")}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>

          <div>
            <label htmlFor="polla-texto" className="mb-1 block text-sm font-semibold text-slate-800">
              Números del jugador
            </label>
            <textarea
              id="polla-texto"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={7}
              autoFocus
              placeholder={
                carreras.length === 6
                  ? "1, 2-3, 1-2, 4, 5, 6"
                  : "1, 2-3, 4, 5"
              }
              className="w-full rounded-lg border border-line px-3 py-2 font-mono text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            />
            <p className="mt-1 text-xs text-slate-500">
              Un grupo por carrera, separado por coma o salto de línea. El guion separa alternativas:{" "}
              <span className="font-mono">2-3</span> son los dos. Con 6 carreras,{" "}
              <span className="font-mono">1-2-3-4-5-6</span> es una sola combinación.
            </p>
          </div>

          {/* Conteo y total EN VIVO: es el control anti-error del mostrador. */}
          <div className="rounded-lg border border-line px-3 py-2">
            {vista.error ? (
              <p className="text-sm font-semibold text-danger-600">{vista.error}</p>
            ) : texto.trim() ? (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                <span>
                  <span className="font-bold text-slate-900">{vista.combinaciones.length}</span>{" "}
                  <span className="text-slate-600">combinaciones</span>
                </span>
                <span>
                  Total{" "}
                  <span className="font-bold text-slate-900">{formato(vista.total)}</span>
                </span>
                {vista.combinaciones.length > 1 && (
                  <span className="text-xs text-slate-500">
                    el jugador compró {vista.combinaciones.length} entradas
                  </span>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Esperando los números…</p>
            )}

            {vista.invalidas.length > 0 && (
              <ul className="mt-2 space-y-1 border-t border-line pt-2 text-xs text-danger-600">
                {vista.invalidas.map((i, n) => (
                  <li key={n}>No se puede cobrar: {i.error}</li>
                ))}
              </ul>
            )}

            {vista.combinaciones.length > 0 && (
              <details className="mt-2 border-t border-line pt-2 text-xs">
                <summary className="cursor-pointer text-slate-600">
                  Ver las {vista.combinaciones.length} combinaciones
                </summary>
                <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto font-mono text-slate-600">
                  {vista.combinaciones.map((c, n) => (
                    <li key={n}>{textoCombinacion(c, carreras)}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="mb-1 block text-sm font-semibold text-slate-800">Cliente</span>
              <SearchableSelect
                options={opcionesCliente}
                value={clienteId}
                onChange={setClienteId}
                placeholder="Buscar cliente (opcional)"
              />
            </div>
            <Input
              label="N° de ticket"
              value={ticket}
              onChange={(e) => setTicket(e.target.value)}
              placeholder="Opcional"
            />
          </div>

          {error && <p className="text-sm font-semibold text-danger-600">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <Button variant="outline" onClick={cerrar}>
            Cancelar
          </Button>
          <Button
            variant="success"
            onClick={confirmar}
            disabled={guardando || vista.combinaciones.length === 0 || !!vista.error}
          >
            {guardando
              ? "Guardando…"
              : `Cobrar ${vista.combinaciones.length > 0 ? formato(vista.total) : ""}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function formato(n: number): string {
  return n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default ModalVentaPolla;
