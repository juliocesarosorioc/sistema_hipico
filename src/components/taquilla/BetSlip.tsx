"use client";

import { useMemo, useState } from "react";
import { useTaquillaStore } from "@/store/useTaquillaStore";
import { validarComando } from "@/lib/taquilla/validar";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { DesgloseProyectado } from "@/components/taquilla/DesgloseProyectado";

const EJEMPLOS = ["100 2n", "50 3p", "200 1 y 2n", "100 10/PP", "400 1/2n y 2n"];

/** Boleto de Apuestas — organismo: comando de jugada → motor en tiempo real → registro. */
export function BetSlip() {
  const [comando, setComando] = useState("");
  const [mensaje, setMensaje] = useState("");
  const agregarTicket = useTaquillaStore((s) => s.agregarTicket);

  const validacion = useMemo(() => validarComando(comando), [comando]);

  const registrar = () => {
    if (!validacion.ok) return;
    agregarTicket({
      comando: `${validacion.monto} ${validacion.tipo}`,
      monto: validacion.monto,
      gananciaProyectada: validacion.proyeccion.gananciaProyectada,
      comision: validacion.proyeccion.comision,
    });
    setComando("");
    setMensaje(`Jugada registrada: $${validacion.monto} ${validacion.tipo}`);
    setTimeout(() => setMensaje(""), 2500);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-600">
          🎟️ Comando de Jugada
        </h3>
        <p className="mb-3 text-[11px] text-slate-500">
          Escriba el monto y la jugada (Ej: <b>100 1 y 2n</b>). El motor valida en tiempo real:
          NINI, Puesto, A Premio (PP o 10/X), Combinada y Compuesta.
        </p>

        <Input
          label="Jugada"
          placeholder="Ej: 100 1 y 2n"
          value={comando}
          onChange={(e) => setComando(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") registrar();
          }}
          autoFocus
          className="font-bold uppercase tracking-wide"
        />

        <div className="mt-2 flex flex-wrap gap-1.5">
          {EJEMPLOS.map((ej) => (
            <button
              key={ej}
              type="button"
              onClick={() => setComando(ej)}
              className="rounded-full border border-line bg-surfaceAlt px-2.5 py-1 text-[10px] font-bold text-slate-500 transition-colors hover:border-primary-500/60 hover:text-primary-600"
            >
              {ej}
            </button>
          ))}
        </div>
      </div>

      <DesgloseProyectado validacion={comando.trim() ? validacion : null} />

      <Button
        variant={validacion.ok ? "success" : "default"}
        size="lg"
        disabled={!validacion.ok}
        onClick={registrar}
        className="w-full"
      >
        💾 Registrar Apuesta
      </Button>

      {mensaje && (
        <p className="rounded-xl bg-success-500/10 p-3 text-center text-[11px] font-bold text-success-500">
          {mensaje}
        </p>
      )}
    </div>
  );
}

export default BetSlip;