"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SearchableSelect, type OpcionSelect } from "@/components/ui/SearchableSelect";
import {
  etiquetaPremio,
  META_ACUMULADO_POR_DEFECTO,
  PUNTOS_POR_DEFECTO,
  type CarreraPolla,
  type DatosPolla,
  type Polla,
} from "@/lib/pollas";
import type { GrupoVenta } from "@/lib/grupos";

type Props = {
  abierto: boolean;
  /** `null` = Polla nueva. */
  polla: Polla | null;
  /** Carreras que el módulo ofrece hoy, en el orden en que se configure(n). */
  disponibles: CarreraPolla[];
  grupos: GrupoVenta[];
  fecha: string;
  onCerrar: () => void;
  onConfirmar: (datos: DatosPolla) => Promise<boolean>;
};

/**
 * ============================================================================
 * CONFIGURAR UNA POLLA
 * ============================================================================
 *
 * Acá la casa decide de qué trata la Polla. Casi todo tiene default sensato
 * (5/3/1, 30 puntos de meta) porque en un mostrador lo que se quiere es cargar y
 * cobrar, no configurar un formulario.
 *
 * EL ORDEN DE LAS CARRERAS ES PARTE DE LA POLLA
 * ---------------------------------------------
 * No es decorativo. El jugador contesta por posición — "el primer número es de
 * la primera carrera" — así que si mañana se reordena la lista, todas las ventas
 * ya cobradas quedan mal leídas y el ganador sale otro. Por eso el orden se
 * muestra numerado mientras se elige y la Polla guarda el orden, no solo el
 * conjunto.
 */
export function ModalConfiguracionPolla({
  abierto,
  polla,
  disponibles,
  grupos,
  fecha,
  onCerrar,
  onConfirmar,
}: Props) {
  const [nombre, setNombre] = useState(polla?.nombre ?? "");
  const [elegidas, setElegidas] = useState<string[]>(
    polla?.carreras.map((c) => c.clave) ?? []
  );
  const [p1, setP1] = useState(String(polla?.puntos.primero ?? PUNTOS_POR_DEFECTO.primero));
  const [p2, setP2] = useState(String(polla?.puntos.segundo ?? PUNTOS_POR_DEFECTO.segundo));
  const [p3, setP3] = useState(String(polla?.puntos.tercero ?? PUNTOS_POR_DEFECTO.tercero));
  const [precio, setPrecio] = useState(String(polla?.precioUnitario ?? 0));
  const [comision, setComision] = useState(String(polla?.comisionPct ?? 0));
  const [acumuladoPct, setAcumuladoPct] = useState(String(polla?.acumuladoPct ?? 0));
  const [meta, setMeta] = useState(String(polla?.metaPuntos ?? META_ACUMULADO_POR_DEFECTO));
  const [premio1, setPremio1] = useState(polla?.premios.primero?.toString() ?? "");
  const [premio2, setPremio2] = useState(polla?.premios.segundo?.toString() ?? "");
  const [premio3, setPremio3] = useState(polla?.premios.tercero?.toString() ?? "");
  const [txt1, setTxt1] = useState(polla?.premiosTexto.primero ?? "");
  const [txt2, setTxt2] = useState(polla?.premiosTexto.segundo ?? "");
  const [txt3, setTxt3] = useState(polla?.premiosTexto.tercero ?? "");
  const [grupoId, setGrupoId] = useState(polla?.grupo_id ?? "");
  const [notas, setNotas] = useState(polla?.notas ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Carreras de la Polla, en el orden en que quedaron elegidas.
   *
   * Se ordena por `elegidas` y no por como vin del maestro: si la casa desmarca
   * la 3ª y la 4ª, la que era 4ª pasa a ser la 3ª pregunta, y el jugador tiene
   * que ver exactamente eso.
   */
  const carreras = useMemo(() => {
    const porClave = new Map(disponibles.map((c) => [c.clave, c]));
    return elegidas
      .map((k) => porClave.get(k))
      .filter((c): c is CarreraPolla => !!c);
  }, [elegidas, disponibles]);

  const alternar = (clave: string) => {
    setElegidas((prev) =>
      prev.includes(clave) ? prev.filter((k) => k !== clave) : [...prev, clave]
    );
  };

  const mover = (indice: number, delta: number) => {
    setElegidas((prev) => {
      const destino = indice + delta;
      if (destino < 0 || destino >= prev.length) return prev;
      const copia = [...prev];
      const [x] = copia.splice(indice, 1);
      copia.splice(destino, 0, x);
      return copia;
    });
  };

  const confirmar = async () => {
    setError(null);
    const numero = (v: string, def: number) => {
      const n = Number(v);
      return Number.isFinite(n) && v.trim() !== "" ? n : def;
    };
    const premio = (v: string) => (v.trim() === "" ? null : numero(v, 0));
    const cant = (v: string, def: number) => {
      const n = numero(v, def);
      if (n < 0) return def;
      if (n > 100) return 100;
      return n;
    };

    if (!nombre.trim()) {
      setError("La Polla necesita un nombre.");
      return;
    }
    if (carreras.length === 0) {
      setError("Elegí al menos una carrera.");
      return;
    }

    setGuardando(true);
    const ok = await onConfirmar({
      nombre: nombre.trim().toUpperCase(),
      fecha,
      grupo_id: grupoId || null,
      carreras,
      puntos: { primero: numero(p1, PUNTOS_POR_DEFECTO.primero), segundo: numero(p2, PUNTOS_POR_DEFECTO.segundo), tercero: numero(p3, PUNTOS_POR_DEFECTO.tercero) },
      precioUnitario: numero(precio, 0),
      comisionPct: cant(comision, 0),
      acumuladoPct: cant(acumuladoPct, 0),
      metaPuntos: Math.round(numero(meta, META_ACUMULADO_POR_DEFECTO)),
      premios: { primero: premio(premio1), segundo: premio(premio2), tercero: premio(premio3) },
      premiosTexto: { primero: txt1.trim() || null, segundo: txt2.trim() || null, tercero: txt3.trim() || null },
      estado: polla?.estado ?? "Abierta",
      notas: notas.trim() || null,
    });
    setGuardando(false);
    if (ok) onCerrar();
  };

  if (!abierto) return null;

  const opcionesGrupo: OpcionSelect[] = grupos.map((g) => ({
    value: String(g.id),
    label: g.nombre,
  }));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4">
      <div className="my-8 w-full max-w-3xl rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-lg font-bold text-slate-900">
            {polla ? "Editar Polla" : "Nueva Polla"}
          </h2>
          <Button variant="ghost" size="sm" onClick={onCerrar}>
            Cerrar
          </Button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="POLLA DE LA NOCHE"
            />
            <div>
              <span className="mb-1 block text-sm font-semibold text-slate-800">Grupo</span>
              <SearchableSelect
                options={opcionesGrupo}
                value={grupoId}
                onChange={setGrupoId}
                placeholder="Sin grupo"
              />
            </div>
          </div>

          {/* ------------------------------------------------------------
              CARRERAS. El orden se elige acá y es parte de la Polla.
           * ---------------------------------------------------------- */}
          <div>
            <p className="mb-1 text-sm font-semibold text-slate-800">
              Carreras ({carreras.length})
            </p>
            <p className="mb-2 text-xs text-slate-500">
              El jugador responde en este orden: el primer grupo de sus números es la primera
              carrera. Usá las flechas para reordenar antes de cobrar.
            </p>

            <div className="max-h-44 overflow-y-auto rounded-lg border border-line">
              {disponibles.length === 0 ? (
                <p className="px-3 py-2 text-sm text-slate-500">
                  No hay carreras cargadas para esta fecha.
                </p>
              ) : (
                disponibles.map((c) => {
                  const n = elegidas.indexOf(c.clave);
                  const marcada = n >= 0;
                  return (
                    <div
                      key={c.clave}
                      className={`flex items-center gap-2 border-b border-line px-3 py-1.5 last:border-b-0 ${
                        marcada ? "bg-primary-50" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={marcada}
                        onChange={() => alternar(c.clave)}
                        className="h-4 w-4"
                        aria-label={`Usar ${c.hipodromo} ${c.carrera}`}
                      />
                      <span className="w-6 shrink-0 text-center font-bold text-slate-500">
                        {marcada ? n + 1 : ""}
                      </span>
                      <span className="flex-1 text-sm text-slate-800">
                        {c.hipodromo} {c.carrera}ª
                      </span>
                      <span className="font-mono text-xs text-slate-500">
                        {c.ejemplares.map((e) => e.numero).join(",")}
                      </span>
                      {c.invalidados && c.invalidados.length > 0 && (
                        <span
                          className="text-xs text-danger-600"
                          title="Inválidos para Pollas: no se pueden colocar"
                        >
                          INV {c.invalidados.join(",")}
                        </span>
                      )}
                      {marcada && (
                        <span className="flex gap-0.5">
                          <Button size="sm" variant="ghost" onClick={() => mover(n, -1)} aria-label="Subir">
                            ↑
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => mover(n, 1)} aria-label="Bajar">
                            ↓
                          </Button>
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Input label="Puntos 1.º" value={p1} onChange={(e) => setP1(e.target.value)} inputMode="numeric" />
            <Input label="Puntos 2.º" value={p2} onChange={(e) => setP2(e.target.value)} inputMode="numeric" />
            <Input label="Puntos 3.º" value={p3} onChange={(e) => setP3(e.target.value)} inputMode="numeric" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Precio por combinación"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              inputMode="decimal"
              hint="Lo que paga el jugador por cada combinación."
            />
            <Input
              label="Meta del acumulado (puntos)"
              value={meta}
              onChange={(e) => setMeta(e.target.value)}
              inputMode="numeric"
              hint="Quien llegue a esta cantidad en la jornada cobra el acumulado."
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Comisión de la casa (%)"
              value={comision}
              onChange={(e) => setComision(e.target.value)}
              inputMode="decimal"
              hint="Porcentaje de la venta que queda como ingreso."
            />
            <Input
              label="Aporte al acumulado (%)"
              value={acumuladoPct}
              onChange={(e) => setAcumuladoPct(e.target.value)}
              inputMode="decimal"
              hint="Porcentaje de la venta que se aparta al acumulado."
            />
          </div>

          {/* Premios: monto y, si no es dinero, la descripción. */}
          <div>
            <p className="mb-1 text-sm font-semibold text-slate-800">Premios</p>
            <div className="space-y-2">
              {[
                { et: "1.º", val: premio1, set: setPremio1, txt: txt1, setTxt: setTxt1 },
                { et: "2.º", val: premio2, set: setPremio2, txt: txt2, setTxt: setTxt2 },
                { et: "3.º", val: premio3, set: setPremio3, txt: txt3, setTxt: setTxt3 },
              ].map((r) => (
                <div key={r.et} className="grid grid-cols-[2.5rem_8rem_1fr] items-center gap-2">
                  <span className="text-sm font-semibold text-slate-700">{r.et}</span>
                  <Input
                    value={r.val}
                    onChange={(e) => r.set(e.target.value)}
                    placeholder="Monto"
                    inputMode="decimal"
                    aria-label={`Premio ${r.et} en dinero`}
                  />
                  <Input
                    value={r.txt}
                    onChange={(e) => r.setTxt(e.target.value)}
                    placeholder="Si no es dinero, describilo (ej: una caja de ron)"
                    aria-label={`Premio ${r.et} descripción`}
                  />
                </div>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Vacío = ese puesto no paga. Si el premio es en especie, dejá el monto en 0 y
              escribí la descripción: el reporte muestra {etiquetaPremio(0, "…")}.
            </p>
          </div>

          <Input
            label="Notas"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Opcional"
          />

          {error && <p className="text-sm font-semibold text-danger-600">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <Button variant="outline" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={guardando || carreras.length === 0}>
            {guardando ? "Guardando…" : polla ? "Guardar cambios" : "Crear Polla"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ModalConfiguracionPolla;