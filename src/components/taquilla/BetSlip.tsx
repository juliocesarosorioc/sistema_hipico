"use client";

import { useMemo, useState } from "react";
import { useTaquillaStore } from "@/store/useTaquillaStore";
import { validarComando } from "@/lib/taquilla/validar";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { DesgloseProyectado } from "@/components/taquilla/DesgloseProyectado";

const EJEMPLOS = ["100 2n", "50 3p", "200 1 y 2n", "100 10/PP", "400 1/2n y 2n"];

/** Ejemplares válidos: la pizarra va de 1 a 8. */
function caballoValido(v: string): string | null {
  const n = v.trim();
  if (!/^\d{1,2}$/.test(n)) return null;
  const i = Number(n);
  return i >= 1 && i <= 8 ? n : null;
}

/** Boleto de Apuestas — organismo: comando de jugada → motor en tiempo real → registro. */
export function BetSlip() {
  const [comando, setComando] = useState("");
  const [caballo, setCaballo] = useState("1");
  const [mensaje, setMensaje] = useState("");
  const agregarTicket = useTaquillaStore((s) => s.agregarTicket);

  const caballoOk = caballoValido(caballo);
  const validacion = useMemo(
    () => validarComando(comando, undefined, caballoOk ?? undefined),
    [comando, caballoOk]
  );

  const registrar = () => {
    if (!validacion.ok) return;
    // El comando que se guarda es el que escribió el operador, no uno
    // reconstruido: la nomenclatura ("2n", "1 y 2n", "2x3 10/8") ES la jugada,
    // y el motor la vuelve a parsear al liquidar.
    agregarTicket({
      comando,
      monto: validacion.monto,
      caballo: caballoOk ?? "1",
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
          NINI, Puesto, A Premio (PP o 10/X), Combinada, Compuesta y las Americanas <b>W</b>, <b>P</b> y <b>S</b>.
        </p>

        <Input
          label="Jugada"
          placeholder="Ej: 100 1 y 2n"
          value={comando}
          onChange={(e) => setComando(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && validacion.ok && caballoOk) registrar();
          }}
          autoFocus
          className="font-bold uppercase tracking-wide"
        />

        {/* El ejemplar es columna propia y NO va en el comando: las W/P/S se
            escriben "100 W" y el caballo se agrega aca. Sin esto, el motor
            liquidaba contra un ejemplar vacío. */}
        <div className="mt-3">
          <Input
            label="CABALLO (ejemplar)"
            value={caballo}
            onChange={(e) => setCaballo(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && validacion.ok && caballoOk) registrar();
            }}
            inputMode="numeric"
            placeholder="1"
            className="font-bold"
          />
          {!caballoOk ? (
            <p className="text-[10px] font-semibold text-danger-600">
              El ejemplar debe ser un número del 1 al 8.
            </p>
          ) : null}
        </div>

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
          {["100 W", "100 P", "100 S"].map((ej) => (
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
        variant={validacion.ok && caballoOk ? "success" : "default"}
        size="lg"
        disabled={!validacion.ok || !caballoOk}
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