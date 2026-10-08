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
  /** Catálogo de hipódromos activos, para resolver `hipodromo_id` al guardar. */
  hipodromos: { id: string; nombre: string }[];
  /** Hipódromo elegido en el módulo: arranca filtrado en la misma sesión. */
  hipodromoInicial?: string;
  fecha: string;
  onCerrar: () => void;
  onConfirmar: (datos: DatosPolla) => Promise<boolean>;
};

/** Chip de hipódromo. El elegido va relleno para que se note sin abrir nada. */
function chipCls(activo: boolean): string {
  return `rounded-full border px-3 py-1 text-sm font-semibold transition-colors ${
    activo
      ? "border-primary-600 bg-primary-600 text-white"
      : "border-line bg-white text-slate-700 hover:bg-surfaceAlt"
  }`;
}

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
  hipodromos,
  hipodromoInicial,
  fecha,
  onCerrar,
  onConfirmar,
}: Props) {
  const [nombre, setNombre] = useState(polla?.nombre ?? "");
  const [hipSelId, setHipSelId] = useState<string>(
    polla?.hipodromo_id ?? hipodromoInicial ?? ""
  );
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

  /**
   * Hipódromos con carreras hoy, en el orden en que aparecen en el programa.
   *
   * El `id` sale del catálogo; si un hipódromo del programa no está en la tabla
   * se arma un id sintético `#NOMBRE` para poder filtrar igual, y al guardar
   * queda en null en vez de apuntar a un id inventado.
   *
   * El hipódromo de la Polla que se está editando se agrega aunque no tenga
   * carreras hoy: si no, la fila quedaría sin chip elegido y el filtro vacío
   * mostraba el programa entero como si nada hubiera pasado.
   */
  const chips = useMemo(() => {
    const porNombre = new Map(hipodromos.map((h) => [h.nombre.trim().toUpperCase(), String(h.id)]));
    const lista: { id: string; nombre: string }[] = [];
    const vistos = new Set<string>();
    for (const c of disponibles) {
      const nombreHipo = String(c.hipodromo ?? "").trim();
      const clave = nombreHipo.toUpperCase();
      if (!clave || vistos.has(clave)) continue;
      vistos.add(clave);
      lista.push({ id: porNombre.get(clave) ?? `#${clave}`, nombre: nombreHipo });
    }
    if (hipSelId && !lista.some((c) => c.id === hipSelId)) {
      const delCatalogo = hipodromos.find((h) => String(h.id) === hipSelId);
      lista.push({
        id: hipSelId,
        nombre: delCatalogo?.nombre ?? hipSelId.replace(/^#/, ""),
      });
    }
    // Sin carreras cargadas igual se muestra la sección: que el operador vea
    // los hipódromos del día y el motivo vacío, no un formulario que cambió
    // de forma sin explicación.
    if (lista.length === 0) {
      for (const h of hipodromos) lista.push({ id: String(h.id), nombre: h.nombre });
    }
    return lista;
  }, [disponibles, hipodromos, hipSelId]);

  /** Nombre del hipódromo filtrado, resuelto desde el id elegido. */
  const nombreSel =
    chips.find((c) => c.id === hipSelId)?.nombre ??
    hipodromos.find((h) => String(h.id) === hipSelId)?.nombre ??
    "";

  /** Solo las carreras del hipódromo elegido; sin elegir, todas. */
  const disponiblesFiltradas = useMemo(() => {
    if (!nombreSel) return disponibles;
    const clave = nombreSel.trim().toUpperCase();
    return disponibles.filter((c) => String(c.hipodromo ?? "").trim().toUpperCase() === clave);
  }, [disponibles, nombreSel]);

  /** Las ofrecidas, agrupadas por hipódromo, para mostrarlas en tarjetas. */
  const agrupadas = useMemo(() => {
    const por = new Map<string, CarreraPolla[]>();
    for (const c of disponiblesFiltradas) {
      const k = String(c.hipodromo ?? "").trim();
      const arr = por.get(k) ?? [];
      arr.push(c);
      por.set(k, arr);
    }
    return [...por.entries()];
  }, [disponiblesFiltradas]);

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
      hipodromo_id: hipSelId && !hipSelId.startsWith("#") ? hipSelId : null,
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
              HIPÓDROMO. Chips y no desplegable: el programa de un día suele
              traer dos o tres hipódromos y con un `<select>` no se ve cuál
              quedó elegido hasta abrirlo. Además el elegido se guarda en
              `hipodromo_id`, que antes quedaba siempre en null.
           * ---------------------------------------------------------- */}
          {chips.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-semibold text-slate-800">Hipódromo</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setHipSelId("")}
                  className={chipCls(!hipSelId)}
                >
                  Todos
                </button>
                {chips.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setHipSelId(c.id)}
                    className={chipCls(hipSelId === c.id)}
                  >
                    {c.nombre}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------
              CARRERAS. El orden se elige acá y es parte de la Polla.
           * ---------------------------------------------------------- */}
          <div>
            <p className="mb-1 text-sm font-semibold text-slate-800">
              Carreras ({carreras.length})
            </p>
            <p className="mb-2 text-xs text-slate-500">
              El jugador responde en este orden: el primer grupo de sus números es la primera
              carrera. Tocá una tarjeta para sumarla y reordená con ↑ ↓.
            </p>

            {/* El orden elegido, siempre a la vista: es lo que después el
                jugador tiene que leer como "primer grupo". */}
            {carreras.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5 rounded-lg border border-line bg-surfaceAlt p-2">
                {carreras.map((c, i) => (
                  <span
                    key={c.clave}
                    className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-xs font-bold text-slate-700 shadow-sm"
                  >
                    <span className="text-primary-600">{i + 1}.</span>
                    {c.hipodromo} {c.carrera}ª
                    <button
                      type="button"
                      onClick={() => mover(i, -1)}
                      disabled={i === 0}
                      aria-label={`Subir ${c.hipodromo} ${c.carrera}ª`}
                      className="px-0.5 text-slate-400 transition-colors hover:text-primary-600 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => mover(i, 1)}
                      disabled={i === carreras.length - 1}
                      aria-label={`Bajar ${c.hipodromo} ${c.carrera}ª`}
                      className="px-0.5 text-slate-400 transition-colors hover:text-primary-600 disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="max-h-56 overflow-y-auto rounded-lg border border-line p-2">
              {agrupadas.length === 0 ? (
                <p className="px-1 py-2 text-sm text-slate-500">
                  No hay carreras cargadas para{" "}
                  {nombreSel ? `el hipódromo ${nombreSel}` : "esta fecha"}.
                </p>
              ) : (
                <div className="space-y-2">
                  {agrupadas.map(([nom, cs]) => (
                    <div key={nom} className="overflow-hidden rounded-lg border border-line">
                      <div className="flex items-center justify-between border-b border-line bg-surfaceAlt px-3 py-1.5">
                        <span className="text-xs font-bold uppercase tracking-wide text-slate-600">
                          {nom}
                        </span>
                        <span className="text-xs text-slate-500">
                          {cs.filter((c) => elegidas.includes(c.clave)).length} de {cs.length}{" "}
                          elegidas
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3">
                        {cs.map((c) => {
                          const n = elegidas.indexOf(c.clave);
                          const marcada = n >= 0;
                          const inv = (c.invalidados ?? []).filter(Boolean);
                          return (
                            <button
                              key={c.clave}
                              type="button"
                              onClick={() => alternar(c.clave)}
                              aria-pressed={marcada}
                              title={`${c.hipodromo} ${c.carrera}ª`}
                              className={`rounded-lg border px-2 py-2 text-left transition-colors ${
                                marcada
                                  ? "border-primary-600 bg-primary-50 ring-1 ring-primary-600"
                                  : "border-line bg-white hover:bg-surfaceAlt"
                              }`}
                            >
                              <span className="flex items-center justify-between gap-1">
                                <span className="text-lg font-bold leading-none text-slate-900">
                                  {c.carrera}ª
                                </span>
                                <span
                                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                                    marcada
                                      ? "bg-primary-600 text-white"
                                      : "bg-slate-100 text-slate-500"
                                  }`}
                                >
                                  {marcada ? `#${n + 1}` : "—"}
                                </span>
                              </span>
                              <span className="mt-1 block truncate font-mono text-[11px] text-slate-500">
                                {c.ejemplares.map((e) => e.numero).join(" ")}
                              </span>
                              {inv.length > 0 && (
                                <span
                                  className="mt-0.5 block text-[10px] font-semibold text-danger-600"
                                  title="Inválidos para Pollas: no se pueden colocar"
                                >
                                  INV {inv.join(",")}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
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