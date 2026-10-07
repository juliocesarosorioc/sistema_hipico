"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ToastHost } from "@/components/ui/ToastHost";
import { getHorseColor } from "@/lib/horseColors";
import { listarHipodromos } from "@/lib/hipodromos/servicio";
import { listarClientes, type ClienteRow } from "@/lib/clientes";
import { listarGruposVenta, type GrupoVenta } from "@/lib/grupos";
import { listarCarrerasCentrales, type CarreraCentral } from "@/lib/carreras/central";
import { alternarRetiroCarrera } from "@/lib/carreras/retiros";
import { SearchableSelect, type OpcionSelect } from "@/components/ui/SearchableSelect";
import { plantillaPorId, reemplazarVarsTablas } from "@/lib/whatsapp";
import {
  listarRemates,
  crearRemate,
  eliminarRemate,
  listarCaballosRemate,
  asignarCaballosRemate,
  eliminarCaballoRemate,
  pujarCaballoRemate,
  guardarIncentivoRemate,
  guardarEscaleraRemate,
  cerrarRemateLiquidando,
  reabrirRemate,
  venderCaballoRemate,
  listarPujasRemate,
  listarSaldosBloqueados,
  candidatosDelPrograma,
  candidatosJugables,
  calcularFinanzasRemate,
  estaCerrado,
  esClienteLibreRemate,
  disponibleRemate,
  autorizarPujaRemate,
  explicacionEscalera,
  normalizarEscalera,
  textoDividendo,
  lineasPizarraRemate,
  mensajePizarraRemate,
  montoPizarraRemate,
  pujaMinimaSiguiente,
  planCierreRemate,
  edicionFilaRemate,
  type Remate,
  type CaballoRemate,
  type CandidatoRemate,
  type PujaHistorica,
  type EscalonPuja,
} from "@/lib/remates";

const usd = (n: number) =>
  `$${Number(n || 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/**
 * Sin decimales, solo para el TOTAL A PAGAR. Lo que la casa paga al ganador se
 * lee de un vistazo y los centavos ahí no aportan nada: con `,00` la cifra crece
 * dos caracteres y el operador tiene que leerla entera para compararla. El
 * resto de la pizarra y el desglose financiero SÍ conservan 2 decimales, que es
 * lo que hace comparables entre sí los parciales.
 */
const usdSinDecimales = (n: number) =>
  `$${Number(n || 0).toLocaleString("es-VE", { maximumFractionDigits: 0 })}`;
const hoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const selectCls =
  "rounded-lg border border-line bg-surface px-2 py-1 text-xs font-semibold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";

/**
 * Columnas de la pizarra, fijas a propósito.
 *
 * Con `flex` + `flex-1` el nombre del ejemplar 1 se comía el ancho que le
 * tocaba y quedaba desalineado del resto: todos los nombres tienen que ocupar
 * EXACTAMENTE la misma columna para que el operador lea la pizarra en vertical.
 * Por eso las filas de ejemplares, la de INCENTIVO y la de TOTAL A PAGAR
 * comparten esta misma grilla: ejemplar · comprador · valor · dividendo · acciones.
 *
 * Cada fila es su propia grilla, así que las columnas 3, 4 y 5 van con ancho FIJO:
 * si fuesen `auto`/intrínsecas, el ancho de acciones (Subir/✕ vs 💾 vs vacío)
 * cambiaría el reparto de los `fr` y el valor de incentivo/total no caería bajo
 * la columna "Valor".
 */
const GRILLA_PIZARRA =
  "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5.5rem_2.5rem_6.5rem] items-center gap-x-2 gap-y-0.5";


/**
 * Compradores que SÍ pueden pujar en este remate.
 *
 * Se filtran con la MISMA regla que valida el servidor (`autorizarPujaRemate`):
 * nada de modo Libre, nada de cliente sin saldo ni aval, nada de cliente que ya
 * tiene su plata comprometida en otros remates abiertos. Mostrar al que no puede
 * es lo que después hace que la puja rebote con un error.
 */
/**
 * Compradores de la pizarra.
 *
 * `miembros` es el set de clientes del GRUPO del remate (`clientes.grupo_id` +
 * `clientes_grupos`): el remate se cobra al banquero del grupo, así que la
 * puja tiene que ser de alguien de adentro. Sin grupo no se restringe (quien
 * arma el remate lo elige a mano). Un null = "sin grupo, no filtrar".
 */
function opcionesDe(
  clientes: ClienteRow[],
  bloqueos: Record<string, number>,
  miembros: Set<string> | null = null
): OpcionSelect[] {
  return clientes
    .filter((cl) => {
      if (!String(cl.id ?? "").trim()) return false;
      if (miembros && !miembros.has(String(cl.id))) return false;
      if (esClienteLibreRemate(cl)) return false;
      return disponibleRemate(cl, bloqueos) > 0;
    })
    .map((cl) => ({ value: String(cl.id), label: String(cl.nombre ?? "").trim() || `Cliente ${cl.id}` }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
}

/**
 * Igual que `opcionesDe`, pero el comprador YA ASIGNADO nunca se cae de la lista:
 * si se quedó sin saldo, igual hay que ver la fila como está (con el motivo al
 * lado) en vez de que el campo se vacíe solo y parezca que la puja es de nadie.
 */
function opcionesDeConComprador(
  clientes: ClienteRow[],
  actualId: string | null | undefined,
  bloqueos: Record<string, number>,
  base: OpcionSelect[]
): OpcionSelect[] {
  const id = String(actualId ?? "").trim();
  if (!id || base.some((o) => o.value === id)) return base;
  const cl = clientes.find((x) => String(x.id) === id);
  if (!cl) return base;
  const nombre = String(cl.nombre ?? "").trim() || `Cliente ${id}`;
  const motivo = esClienteLibreRemate(cl)
    ? " · Libre: no compra"
    : disponibleRemate(cl, bloqueos) <= 0
      ? " · sin saldo disponible"
      : "";
  return [{ value: id, label: `${nombre}${motivo}` }, ...base];
}


/** Chip del número de ejemplar con el color hípico canónico. */
function NumChip({ numero, size = "md" }: { numero: string | number; size?: "sm" | "md" }) {
  const color = getHorseColor(numero);
  const cls = size === "sm" ? "h-5 w-5 text-[10px]" : "h-7 w-7 text-[13px]";
  return (
    <span
      className={`flex ${cls} shrink-0 items-center justify-center rounded font-black leading-none shadow-sm`}
      style={{ backgroundColor: color.hex, color: color.hexText }}
      title={`Ejemplar ${numero} · ${color.label}`}
    >
      {numero}
    </span>
  );
}

/**
 * Módulo Remates — estilo Tablas Fijas.
 *
 * La lógica de fondo es la del remate: los ejemplares salen del PROGRAMA DEL DÍA
 * (mismas carreras que Carreras del Día / Tablas Fijas) y cada puja sube de
 * monto según la escalera de la casa (0–100 +10, 100–200 +20, …). El incentivo
 * es un aporte de la casa que NO paga comisión.
 */
export function RematesModule() {
  const [remates, setRemates] = useState<Remate[]>([]);
  const [cargando, setCargando] = useState(true);
  const [seleccionado, setSeleccionado] = useState<Remate | null>(null);
  const [caballos, setCaballos] = useState<CaballoRemate[]>([]);
  const [hipodromos, setHipodromos] = useState<{ id: string; nombre: string }[]>([]);
  const [grupos, setGrupos] = useState<GrupoVenta[]>([]);
  const [clientes, setClientes] = useState<ClienteRow[]>([]);

  const toast = useCallback((msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));
  }, []);

  const refrescar = useCallback(async () => {
    const res = await listarRemates();
    if (!res.ok) toast(res.error ?? "No pude cargar los remates.", "error");
    setRemates(res.datos ?? []);
    setCargando(false);
  }, [toast]);

  useEffect(() => {
    void refrescar();
    void (async () => {
      const h = await listarHipodromos();
      setHipodromos((h.data ?? []).map((x) => ({ id: String(x.id), nombre: x.nombre })));
      const g = await listarGruposVenta();
      setGrupos(g);
      const c = await listarClientes();
      setClientes(c);
    })();
  }, [refrescar]);

  const recargarCaballos = useCallback(async (remateId: string) => {
    const res = await listarCaballosRemate(remateId);
    setCaballos(res.datos ?? []);
  }, []);

  /**
   * Refresca TODO el detalle: los ejemplares Y el remate.
   *
   * Recargar solo los ejemplares dejaba el `estado` viejo en memoria, y por eso
   * un remate recién CERRADO seguía mostrando los campos editables: la pizarra
   * seguía como si estuviera abierta. El `update` de estado se confirma en la
   * base, pero la pantalla seguía mostrando el objeto anterior.
   */
  const refrescarDetalle = useCallback(async () => {
    const id = seleccionado?.id;
    if (!id) return;
    const lista = (await listarRemates()).datos ?? [];
    setRemates(lista);
    const actual = lista.find((r) => r.id === id);
    if (actual) setSeleccionado(actual);
    await recargarCaballos(id);
  }, [seleccionado?.id, recargarCaballos]);

  const abrirDetalle = useCallback(
    async (remate: Remate) => {
      setSeleccionado(remate);
      await recargarCaballos(remate.id);
    },
    [recargarCaballos]
  );

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-black uppercase tracking-wide text-slate-900">🔔 Remates</h1>
          <p className="text-xs text-slate-500">
            Ejemplares tomados del programa del día · {remates.length} remate(s).
          </p>
        </div>
        {seleccionado && (
          <Button
            variant="outline"
            size="md"
            onClick={() => {
              setSeleccionado(null);
              setCaballos([]);
            }}
          >
            ← Volver a la lista
          </Button>
        )}
      </div>

      {seleccionado ? (
        <DetalleRemate
          remate={seleccionado}
          caballos={caballos}
          hipodromos={hipodromos}
          clientes={clientes}
          toast={toast}
          onCambio={refrescarDetalle}
        />
      ) : (
        <ListaRemates
          remates={remates}
          cargando={cargando}
          hipodromos={hipodromos}
          grupos={grupos}
          toast={toast}
          onVer={abrirDetalle}
          onCreado={async (id) => {
            await refrescar();
            const lista = (await listarRemates()).datos ?? [];
            const nuevo = lista.find((r) => r.id === id) ?? ({ id } as Remate);
            await abrirDetalle(nuevo);
          }}
          onEliminar={async (r) => {
            if (!window.confirm(`¿Eliminar el remate "${r.nombre}" y sus ejemplares?`)) return;
            const res = await eliminarRemate(r.id);
            if (!res.ok) return toast(res.error ?? "No pude eliminar el remate.", "error");
            toast(`🗑️ Remate "${r.nombre}" eliminado.`, "success");
            void refrescar();
          }}
        />
      )}

      <ToastHost />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Lista + creación (Hipódromo → Fecha → Carrera → Ejemplares)
// ---------------------------------------------------------------------------
function ListaRemates({
  remates,
  cargando,
  hipodromos,
  grupos,
  toast,
  onVer,
  onCreado,
  onEliminar,
}: {
  remates: Remate[];
  cargando: boolean;
  hipodromos: { id: string; nombre: string }[];
  grupos: GrupoVenta[];
  toast: (m: string, t?: "success" | "warning" | "error" | "info") => void;
  onVer: (r: Remate) => void;
  onCreado: (id: string) => void;
  onEliminar: (r: Remate) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [hipodromoId, setHipodromoId] = useState("");
  const [fecha, setFecha] = useState(hoy());
  const [carrera, setCarrera] = useState("");
  const [comision, setComision] = useState("20");
  const [horaCierre, setHoraCierre] = useState("");
  const [distancia, setDistancia] = useState("");
  const [notas, setNotas] = useState("");
  const [grupoId, setGrupoId] = useState("");
  const [carreras, setCarreras] = useState<CarreraCentral[]>([]);
  const [cargandoCarreras, setCargandoCarreras] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const hipodromoNombre = useMemo(
    () => hipodromos.find((h) => h.id === hipodromoId)?.nombre ?? "",
    [hipodromos, hipodromoId]
  );

  useEffect(() => {
    let vivo = true;
    if (!hipodromoNombre || !fecha) {
      setCarreras([]);
      return;
    }
    setCargandoCarreras(true);
    void (async () => {
      const res = await listarCarrerasCentrales(fecha, hipodromoNombre);
      if (!vivo) return;
      const lista = [...(res.datos ?? [])].sort((a, b) => a.carrera - b.carrera);
      setCarreras(lista);
      setCargandoCarreras(false);
    })();
    return () => {
      vivo = false;
    };
  }, [hipodromoNombre, fecha, abierto]);

  useEffect(() => {
    if (carreras.length && !carrera) setCarrera(String(carreras[0].carrera));
  }, [carreras, carrera]);

  useEffect(() => {
    if (abierto && hipodromoId && !fecha) setFecha(hoy());
  }, [abierto, hipodromoId, fecha]);

  const carreraSel = useMemo(() => carreras.find((c) => String(c.carrera) === carrera) ?? null, [carreras, carrera]);
  const candidatos = useMemo(() => candidatosJugables(candidatosDelPrograma(carreraSel?.caballos)), [carreraSel]);

  const crear = async () => {
    setGuardando(true);
    const res = await crearRemate({
      nombre,
      hipodromo_id: hipodromoId || null,
      hipodromo: hipodromoNombre || null,
      carrera: carrera || null,
      fecha,
      hora_cierre: horaCierre || null,
      distancia: distancia || null,
      comision_pct: Number(comision) || 20,
      notas: notas || null,
      grupo_id: grupoId || null,
    });
    setGuardando(false);
    if (!res.ok || !res.id) return toast(res.error ?? "No pude crear el remate.", "error");
    toast("✅ Remate creado. Asigná los ejemplares del programa.", "success");
    setAbierto(false);
    setNombre("");
    setCarrera("");
    setGrupoId("");
    onCreado(res.id);
  };

  return (
    <>
      <div className="flex justify-end">
        <Button variant="success" size="md" onClick={() => setAbierto(true)}>
          ＋ Nuevo Remate
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-gray-50 text-[10px] uppercase tracking-widest text-slate-500">
                <th className="px-4 py-2.5 font-black">Nombre</th>
                <th className="px-4 py-2.5 font-black">Hipódromo</th>
                <th className="px-4 py-2.5 text-center font-black">Carrera</th>
                <th className="px-4 py-2.5 font-black">Fecha</th>
                <th className="px-4 py-2.5 font-black">Estado</th>
                <th className="px-4 py-2.5 text-right font-black">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {cargando && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-xs font-semibold text-slate-500">
                    Cargando remates…
                  </td>
                </tr>
              )}
              {!cargando && remates.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-xs italic text-slate-400">
                    No hay remates registrados todavía.
                  </td>
                </tr>
              )}
              {remates.map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-surfaceAlt">
                  <td className="px-4 py-2.5 font-black uppercase tracking-wide text-slate-800">{r.nombre}</td>
                  <td className="px-4 py-2.5 text-xs font-semibold text-slate-600">{r.hipodromo ?? "—"}</td>
                  <td className="px-4 py-2.5 text-center font-bold text-slate-700">{r.carrera ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs font-semibold text-slate-500">{r.fecha ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black uppercase leading-none text-emerald-700">
                      {r.estado ?? "Abierto"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button variant="outline" size="sm" onClick={() => onVer(r)}>
                        📊 Ver
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => onEliminar(r)} title="Eliminar remate">
                        🗑️
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {abierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <Card className="max-h-[90vh] w-full max-w-2xl overflow-y-auto p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-black uppercase tracking-wide text-slate-800">＋ Nuevo remate</h2>
              <button type="button" onClick={() => setAbierto(false)} className="text-slate-400 hover:text-slate-700" aria-label="Cerrar">
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input id="remate-nombre" label="Nombre" placeholder="Ej. REMATE C1" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />

              <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
                <span>Hipódromo</span>
                <select value={hipodromoId} onChange={(e) => setHipodromoId(e.target.value)} className={selectCls}>
                  <option value="">— Seleccione —</option>
                  {hipodromos.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.nombre}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
                <span>Fecha / Día del programa</span>
                <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={selectCls} />
              </label>

              <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
                <span>Carrera {cargandoCarreras ? "· cargando…" : `(${carreras.length})`}</span>
                <select value={carrera} onChange={(e) => setCarrera(e.target.value)} className={selectCls} disabled={!hipodromoId || cargandoCarreras}>
                  <option value="">— Seleccione —</option>
                  {carreras.map((c) => (
                    <option key={String(c.carrera)} value={String(c.carrera)}>
                      C{c.carrera} · {(c.caballos ?? []).length} ejemplar(es)
                    </option>
                  ))}
                </select>
              </label>

              <Input id="remate-comision" label="Comisión %" placeholder="20" value={comision} onChange={(e) => setComision(e.target.value)} />
              <Input id="remate-cierre" label="Hora de cierre" placeholder="Ej. 14:30" value={horaCierre} onChange={(e) => setHoraCierre(e.target.value)} />
              <Input id="remate-distancia" label="Distancia" placeholder="Ej. 1200 m" value={distancia} onChange={(e) => setDistancia(e.target.value)} />
              <Input id="remate-notas" label="Notas" placeholder="Configuración especial" value={notas} onChange={(e) => setNotas(e.target.value)} />

              <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600 md:col-span-2">
                <span>Grupo de venta (banquero de Remates)</span>
                <select value={grupoId} onChange={(e) => setGrupoId(e.target.value)} className={selectCls}>
                  <option value="">— Sin grupo (sin banquero) —</option>
                  {grupos.map((g) => (
                    <option key={String(g.id)} value={String(g.id)}>
                      {g.nombre}
                    </option>
                  ))}
                </select>
                <span className="font-normal text-slate-400">
                  Opcional. Si elegís un grupo, sus jugadas de remate usan el banquero configurado para la modalidad REMATES.
                </span>
              </label>
            </div>

            <div className="mt-4 rounded-lg border border-line bg-surfaceAlt p-3 text-[11px] text-slate-600">
              {!hipodromoId || !fecha ? (
                <p>Elegí hipódromo y fecha para ver las carreras del día.</p>
              ) : !carreraSel ? (
                <p>{carreras.length ? "Elegí la carrera para ver sus ejemplares." : "No hay carreras cargadas para ese día e hipódromo."}</p>
              ) : (
                <p>
                  <b>{candidatos.length}</b> ejemplar(es) del programa para <b>C{carreraSel.carrera}</b> ({hipodromoNombre}):{" "}
                  {candidatos.slice(0, 12).map((c) => c.ejemplar_numero).join(", ")}
                  {candidatos.length > 12 ? "…" : ""}
                </p>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2 border-t border-line pt-4">
              <Button variant="outline" size="md" onClick={() => setAbierto(false)}>
                Cancelar
              </Button>
              <Button variant="success" size="md" onClick={() => void crear()} disabled={guardando}>
                {guardando ? "Guardando…" : "💾 Crear remate"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Detalle: pizarra de pujas + escalera + finanzas + ejemplares del programa
// ---------------------------------------------------------------------------
function DetalleRemate({
  remate,
  caballos,
  hipodromos,
  clientes,
  toast,
  onCambio,
}: {
  remate: Remate;
  caballos: CaballoRemate[];
  hipodromos: { id: string; nombre: string }[];
  clientes: ClienteRow[];
  toast: (m: string, t?: "success" | "warning" | "error" | "info") => void;
  onCambio: () => void | Promise<void>;
}) {
  const [incentivo, setIncentivo] = useState(String(remate.incentivo ?? 0));
  const [incPct, setIncPct] = useState(String(remate.incentivo_pct ?? 0));
  /** Modo del incentivo. El % se guarda en `incentivo_pct` (0 = monto fijo). */
  const [modoInc, setModoInc] = useState<"monto" | "pct">((Number(remate.incentivo_pct) || 0) > 0 ? "pct" : "monto");
  const [historial, setHistorial] = useState<PujaHistorica[]>([]);
  const [candidatos, setCandidatos] = useState<CandidatoRemate[]>([]);
  const [cargandoProg, setCargandoProg] = useState(false);
  const [asignando, setAsignando] = useState(false);
  const [guardandoInc, setGuardandoInc] = useState(false);
  /** Ejemplar cuyas opciones están abiertas (se abren al PRESIONAR el caballo). */
  const [acciones, setAcciones] = useState<CaballoRemate | null>(null);
  /** Confirmación del cierre (muestra cuántos tickets y cuántos saldos toca). */
  const [confirmandoCierre, setConfirmandoCierre] = useState(false);
  const [liquidando, setLiquidando] = useState(false);
  const cerrado = estaCerrado(remate);
  /**
   * El remate ya se liquidó (tickets emitidos y saldos descontados). Al reabrir,
   * lo único editable es ASIGNARLES comprador a los ejemplares que siguen sin
   * comprador (CASA): los que ya tienen comprador están vendidos y quedan
   * bloqueados, porque su saldo ya se descontó.
   */
  const liquidado = Boolean(remate.liquidado_at);
  // Números INVALIDADOS solo para Remates (columna `carreras.invalidado_remate`).
  // No es lo mismo que retirado: el retirado saca el ejemplar de todos los
  // módulos; el INV solo le impide pujar acá, y sigue corriendo en la carrera.
  const [invalidados, setInvalidados] = useState<string[]>([]);
  /** Muestra la pizarra de WhatsApp con el texto a copiar (modal flotante con botón cerrar). */
  const [previewWsp, setPreviewWsp] = useState<{ abrir: boolean; texto: string }>({ abrir: false, texto: "" });
  // Números RETIRADOS de la carrera (lista central). Un retirado no puja, no
  // retiene saldo del comprador y se puede reactivar desde la pizarra.
  const [retirados, setRetirados] = useState<string[]>([]);
  // Distancia/superficie de la carrera central: son datos del programa, no del
  // remate, y por eso no se editan a mano acá.
  const [datosCarrera, setDatosCarrera] = useState<{ distancia?: string | null; superficie?: string | null }>({});
  // Selección de ejemplares del programa a asignar (por ejemplar_numero).
  const [filas, setFilas] = useState<Record<string, { on: boolean; monto: string; clienteId: string }>>({});
  /**
   * Montos que se están EDITANDO a mano, por fila (`remate_caballos.id`).
   *
   * No se guardan solos: solo recalculan la pizarra y las finanzas para que el
   * operador vea el efecto de lo que está escribiendo ANTES de confirmarlo, y se
   * limpian cuando la puja queda guardada.
   */
  const [montos, setMontos] = useState<Record<string, string>>({});
  /** `cliente_id → plata comprometida en remates ABIERTOS` (se deriva solo). */
  const [bloqueos, setBloqueos] = useState<Record<string, number>>({});

  const hipodromoNombre =
    hipodromos.find((h) => h.id === String(remate.hipodromo_id))?.nombre ?? remate.hipodromo ?? "";

  const recargarPrograma = useCallback(async () => {
    if (!hipodromoNombre || !remate.fecha) {
      setCandidatos([]);
      return;
    }
    setCargandoProg(true);
    const res = await listarCarrerasCentrales(remate.fecha, hipodromoNombre);
    const c = (res.datos ?? []).find((x) => Number(x.carrera) === Number(remate.carrera));
    setCandidatos(candidatosDelPrograma(c?.caballos));
    setInvalidados(c?.invalidados ?? []);
    setRetirados(c?.retirados ?? []);
    setDatosCarrera({ distancia: c?.distancia ?? null, superficie: c?.superficie ?? null });
    setCargandoProg(false);
  }, [hipodromoNombre, remate.fecha, remate.carrera]);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      await recargarPrograma();
      if (!vivo) return;
    })();
    return () => {
      vivo = false;
    };
  }, [recargarPrograma]);

  const recargarBloqueos = useCallback(async () => {
    const res = await listarSaldosBloqueados();
    setBloqueos(res.datos ?? {});
  }, []);

  // El bloqueo se relee con cada cambio de pujas y al cambiar el estado del
  // remate: si no, el "disponible" que ve el operador sería el viejo.
  useEffect(() => {
    void recargarBloqueos();
  }, [recargarBloqueos, caballos, cerrado]);

  const invSet = useMemo(() => new Set(invalidados.map(String)), [invalidados]);
  const retiroSet = useMemo(() => new Set(retirados.map(String)), [retirados]);

  /**
   * La PIZARRA es el programa: muestra TODOS los ejemplares de la carrera en su
   * orden, estén pujados o no. Cada renglón conserva su lugar: el que ya tiene
   * puja se edita como siempre; el que no, se abre desde la misma fila; y el
   * retirado o invalidado se marca EN SU LUGAR (sigue en la carrera, no puja).
   * Así la pizarra reemplaza la vieja sección aparte de "Ejemplares del programa".
   */
  const filasPizarra = useMemo(() => {
    const pujaPorNum = new Map(caballos.map((c) => [String(c.ejemplar_numero ?? c.numero), c]));
    const out: Array<
      | { tipo: "puja"; c: CaballoRemate }
      | { tipo: "disponible"; c: CandidatoRemate }
      | { tipo: "inv"; c: CandidatoRemate }
      | { tipo: "retirado"; c: CandidatoRemate }
    > = [];
    const usados = new Set<string>();
    for (const c of candidatos) {
      const n = String(c.ejemplar_numero);
      const puja = pujaPorNum.get(n);
      if (puja) {
        out.push({ tipo: "puja", c: puja });
        usados.add(n);
      } else if (invSet.has(n)) {
        out.push({ tipo: "inv", c });
      } else if (c.retirado || retiroSet.has(n)) {
        out.push({ tipo: "retirado", c });
      } else {
        out.push({ tipo: "disponible", c });
      }
    }
    for (const c of caballos) {
      const n = String(c.ejemplar_numero ?? c.numero);
      if (!usados.has(n)) out.push({ tipo: "puja", c });
    }
    return out;
  }, [candidatos, caballos, invSet, retiroSet]);

  /** Monto que se VE de un ejemplar: el editado a mano, si lo hay. */
  const montoEnPantalla = useCallback(
    (c: CaballoRemate) => {
      const k = String(c.id ?? c.numero);
      const raw = montos[k];
      return raw != null && String(raw).trim() !== "" ? Number(raw) || 0 : Number(c.monto_usd) || 0;
    },
    [montos]
  );
  const caballosVista = useMemo(
    () => caballos.map((c) => ({ ...c, monto_usd: montoEnPantalla(c) })),
    [caballos, montoEnPantalla]
  );
  const finanzas = useMemo(
    () => calcularFinanzasRemate(caballosVista, Number(incentivo) || 0, remate.comision_pct, Number(incPct) || 0),
    [caballosVista, incentivo, incPct, remate.comision_pct]
  );

  /**
   * Lo que cada cliente tiene comprometido FUERA de este remate.
   *
   * El bloqueo crudo (`listarSaldosBloqueados`) incluye las pujas de este mismo
   * remate; para calcular lo que le queda hay que restarlas, y además sacar las
   * de los ejemplares RETIRADOS, que ya no retienen nada (por eso un retirado
   * libera el saldo del comprador).
   */
  const bloqueosOtros = useMemo(() => {
    const propio: Record<string, number> = {};
    for (const c of caballosVista) {
      const id = String(c.cliente_id ?? "").trim();
      if (!id) continue;
      if (retiroSet.has(String(c.ejemplar_numero ?? c.numero))) continue;
      propio[id] = (propio[id] ?? 0) + (Number(c.monto_usd) || 0);
    }
    const out: Record<string, number> = {};
    for (const [id, n] of Object.entries(bloqueos)) out[id] = Math.max(0, n - (propio[id] ?? 0));
    return out;
  }, [bloqueos, caballosVista, retiroSet]);

  const clientePorId = useMemo(
    () => new Map(clientes.map((cl) => [String(cl.id), cl] as const)),
    [clientes]
  );

  /** Compradores que SÍ pueden comprar: ni Libre, ni sin saldo+aval, ni topped. */
  const opcionesComprador = useMemo(
    () => opcionesDe(clientes, bloqueosOtros),
    [clientes, bloqueosOtros]
  );

  // Historial de pujas: se recarga junto con los ejemplares.
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const res = await listarPujasRemate(remate.id);
      if (!vivo) return;
      setHistorial(res.datos ?? []);
    })();
    return () => {
      vivo = false;
    };
  }, [remate.id, caballos]);

  const filaDe = (k: string) => filas[k] ?? { on: false, monto: "", clienteId: "" };
  const setFila = (k: string, patch: Partial<{ on: boolean; monto: string; clienteId: string }>) =>
    setFilas((f) => ({ ...f, [k]: { ...filaDe(k), ...patch } }));

  const setMontoFila = (c: CaballoRemate, valor: string) =>
    setMontos((m) => ({ ...m, [String(c.id ?? c.numero)]: valor }));
  const limpiarMontoFila = (c: CaballoRemate) =>
    setMontos((m) => {
      const k = String(c.id ?? c.numero);
      if (!(k in m)) return m;
      const copia = { ...m };
      delete copia[k];
      return copia;
    });

  /** Quita el ejemplar del remate: la puja se borra y el saldo queda libre. */
  // Devuelve si el ejemplar QUEDO fuera del remate. El modal de opciones se
  // cierra solo cuando eso pasa: antes se cerraba siempre, y si la eliminación
  // fallaba el operador se quedaba sin la fila abierta y con un toast, sin
  // poder reintentar desde el mismo lugar.
  const quitarEjemplar = async (c: CaballoRemate): Promise<boolean> => {
    const n = c.ejemplar_numero ?? c.numero;
    const ok = window.confirm(
      `¿Quitar el ejemplar ${n} (${c.nombre}) del remate?\n\nSe elimina la puja y el saldo de ${
        c.cliente ?? "su comprador"
      } queda libre. El ejemplar NO se borra de la carrera: sigue corriendo y se puede volver a pujar.`
    );
    if (!ok) return false;
    // Sin id no hay fila que borrar. Antes salía en silencio, después de haber
    // hecho perder al operador la confirmación: parecía que el sistema no
    // respondía.
    if (!c.id) {
      toast("Este ejemplar no tiene puja guardada: no hay nada que quitar del remate.", "warning");
      return false;
    }
    const res = await eliminarCaballoRemate(c.id, remate.id);
    if (!res.ok) {
      toast(res.error ?? "No pude quitar del remate.", "error");
      return false;
    }
    toast(`🗑️ Ejemplar ${n} fuera del remate: su saldo quedó liberado.`, "success");
    await onCambio();
    await recargarBloqueos();
    return true;
  };

  /**
   * Mueve el foco al campo de puja siguiente o anterior de la pizarra.
   *
   * Se recorre el DOM y no una lista de índices porque las filas de la pizarra
   * son de tres tipos (puja, invalidado y retirado): solo unas tienen campo de
   * valor, y el índice del array incluye filas sin campo. Con el DOM se mueve
   * entre los que realmente se pueden editar, y un INV que se agregue en el
   * medio no rompe la cuenta.
   */
  const moverFocoPuja = useCallback((desde: HTMLInputElement | null, delta: number) => {
    const campos = Array.from(document.querySelectorAll<HTMLInputElement>("[data-remate-valor]"));
    if (!campos.length) return;
    const i = desde ? campos.indexOf(desde) : -1;
    // Sin origen se entra por el primer campo editable, no por uno bloqueado.
    const candidatos = delta > 0 ? campos.slice(i + 1) : campos.slice(0, i === -1 ? campos.length : i).reverse();
    const destino = candidatos.find((c) => !c.disabled);
    if (!destino) return;
    destino.focus();
    destino.select();
  }, []);

  /**
   * Opciones del ejemplar, al PRESIONAR el caballo (igual que Tablas Fijas).
   *
   * El retiro/reincorporación a la carrera SÍ se puede hacer desde acá: pasa por
   * el servicio central de retiros (`alternarRetiroCarrera`), que actualiza
   * carreras, tablas fijas, dupletas y reembolsa tickets pendientes. El ejemplar
   * NO se quita del remate: desde acá se cambia comprador y se quita la puja.
   */
  const accionesDe = (c: CaballoRemate) => setAcciones(c);

  /**
   * Retira o reactiva el ejemplar en su carrera, centralizado.
   *
   * No se toca `remate_caballos`: el caballo sigue en la pizarra, marcado como
   * retirado. Lo que cambia en todos los módulos lo aplica `retiros.ts`.
   */
  const toggleRetiro = async (c: CaballoRemate) => {
    const n = String(c.ejemplar_numero ?? c.numero).trim();
    const estaRetirado = retiroSet.has(n);
    const r = await alternarRetiroCarrera({
      fecha: remate.fecha ?? "",
      hipodromo: hipodromoNombre,
      carrera: remate.carrera != null ? remate.carrera : "",
      numero: n,
      retirado: !estaRetirado,
    });
    if (!r.ok) {
      return toast(
        `⚠️ No se pudo ${estaRetirado ? "reactivar" : "retirar"} el ejemplar: ${r.error ?? "sin conexión"}`,
        "error"
      );
    }
    toast(
      !estaRetirado
        ? `⛔ ${n} retirado de C${remate.carrera} — centralizado (${r.tablasAfectadas} tabla(s), ${r.reembolsos} reembolso(s)).`
        : `↩️ ${n} reactivado en C${remate.carrera} — centralizado.`,
      "success"
    );
    await recargarPrograma();
    await onCambio();
  };

  /** Sube la puja del renglón: valida saldo y estado antes de tocar. */
  const guardarPuja = async (c: CaballoRemate, monto: number, clienteId: string) => {
    const res = await pujarCaballoRemate(remate.id, String(c.id), {
      monto_usd: monto,
      cliente_id: clienteId || null,
    });
    if (!res.ok) return toast(res.error ?? "No pude guardar la puja.", "error");
    toast(`✅ ${c.nombre} sube a ${usd(monto)}.`, "success");
    limpiarMontoFila(c);
    await onCambio();
    await recargarBloqueos();
  };

  /**
   * Cambia el comprador de un ejemplar YA pujado, sin mover el monto.
   *
   * Va por el mismo servicio que subir la puja a propósito: así el cambio pasa
   * por la misma validación de saldo/aval/Libre que una puja nueva, y el saldo
   * del comprador anterior queda libre en el acto.
   */
  const onClienteCambio = async (c: CaballoRemate, clienteId: string) => {
    if (!c.id) return;
    // Remate YA liquidado y reabierto: asignarle comprador a un ejemplar que
    // estaba en CASA es una VENTA, así que también emite ticket y descuenta saldo
    // (mismo camino que el cierre, fila por fila).
    if (liquidado) {
      if (!clienteId) return toast("Este ejemplar ya se vendió: no se le puede quitar el comprador.", "warning");
      const res = await venderCaballoRemate(String(c.id), clienteId);
      if (!res.ok) return toast(res.error ?? "No pude registrar la venta.", "error");
      toast(`🎟️ ${c.nombre} vendido a ${clientePorId.get(clienteId)?.nombre ?? "—"}: ticket emitido y saldo descontado.`, "success");
      await onCambioEstado();
      return;
    }
    const res = await pujarCaballoRemate(remate.id, String(c.id), {
      monto_usd: montoEnPantalla(c),
      cliente_id: clienteId || null,
    });
    if (!res.ok) return toast(res.error ?? "No pude cambiar el comprador.", "error");
    toast(`👤 ${c.nombre} pasa a nombre de ${clientePorId.get(clienteId)?.nombre ?? "—"}.`, "success");
    await onCambio();
    await recargarBloqueos();
  };

  /** Cerrar/reabrir cambia los saldos bloqueados: hay que refrescar todo. */
  const onCambioEstado = async () => {
    await onCambio();
    await recargarBloqueos();
  };

  /**
   * Abre la puja de UN ejemplar del programa desde su propio renglón de la
   * pizarra. Reemplaza al viejo botón que asignaba en lote desde la sección
   * aparte: ahora se carga el comprador y el valor en la fila y se abre ahí.
   */
  const abrirPuja = async (c: CandidatoRemate) => {
    const f = filaDe(c.ejemplar_numero);
    const monto = Number(f.monto) || 0;
    if (monto <= 0) return toast("Cargá el valor de la puja.", "warning");
    // Mismo corte que el servidor: un Libre, o un cliente sin saldo ni aval,
    // no compra por mucho que el formulario se lo permita.
    const compra = autorizarPujaRemate(
      f.clienteId ? clientePorId.get(f.clienteId) : null,
      monto,
      bloqueosOtros
    );
    if (!compra.ok) return toast(compra.motivo ?? "El cliente no puede comprar.", "warning");
    setAsignando(true);
    const res = await asignarCaballosRemate(remate.id, [
      {
        numero: c.numero,
        nombre: c.nombre || `EJEMPLAR ${c.ejemplar_numero}`,
        monto_usd: monto,
        cliente_id: f.clienteId || null,
        ejemplar_numero: c.ejemplar_numero,
      },
    ]);
    setAsignando(false);
    if (!res.ok) return toast(res.error ?? "No pude abrir la puja.", "error");
    toast(`✅ Puja de ${c.ejemplar_numero} abierta.`, "success");
    setFilas((prev) => {
      const n = { ...prev };
      delete n[c.ejemplar_numero];
      return n;
    });
    await onCambio();
    await recargarBloqueos();
  };

  const copiarPizarra = async () => {
    if (!caballosVista.length) return toast("No hay pujas para compartir.", "warning");
    const filas = caballosVista.map((c) => ({
      numero: String(c.ejemplar_numero ?? c.numero),
      nombre: c.nombre || `EJEMPLAR ${c.ejemplar_numero ?? c.numero}`,
      comprador: c.cliente,
      monto_usd: c.monto_usd,
    }));
    const plantilla = plantillaPorId("remates_pizarra");
    // El cierre de la pizarra lo pide el grupo con un formato fijo (dos espacios,
    // línea en blanco, total en negrita). Se calcula UNA vez con la función del
    // núcleo y se pasa a la plantilla, para que la plantilla editada a mano y el
    // mensaje de respaldo no puedan terminar mostrando dos cosas distintas.
    const cierre = {
      incentivo: finanzas.incentivo,
      total: finanzas.premioGanador,
    };
    const texto = plantilla.trim()
      ? reemplazarVarsTablas(plantilla, {
          remate: String(remate.nombre ?? "").trim(),
          hipodromo: String(remate.hipodromo ?? "").trim(),
          carrera: remate.carrera != null ? String(remate.carrera) : "",
          fecha: remate.fecha ?? "",
          lineas: lineasPizarraRemate(filas, finanzas.premioGanador),
          incentivo: montoPizarraRemate(cierre.incentivo),
          total: montoPizarraRemate(cierre.total),
        })
      : mensajePizarraRemate(
          { ...remate, grupo: String(remate.grupo_id ?? "") },
          filas,
          finanzas.premioGanador,
          cierre
        );
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(texto);
    } catch {
      /* ignore */
    }
    setPreviewWsp({ abrir: true, texto });
  };

return (
    <div className="flex flex-col gap-4">
      {/* Cabecera del remate: nombre y estado. El hipódromo, la carrera y el día
          viven en la fila de la pizarra, que es donde el operador los mira. */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-indigo-600 px-4 py-2.5 text-white">
          <div className="min-w-0">
            <p className="truncate text-sm font-black uppercase tracking-wide">{remate.nombre}</p>
            <p className="text-[11px] font-semibold text-indigo-100">
              📏 {datosCarrera.distancia || remate.distancia || "sin distancia"}
              {datosCarrera.superficie ? ` · ${datosCarrera.superficie}` : ""} · Comisión{" "}
              {remate.comision_pct}% (no grava el incentivo) · {remate.notas || "Sin notas."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full border-2 px-2 py-0.5 text-[10px] font-black uppercase leading-none tracking-widest ${
                cerrado ? "border-red-200 bg-red-500 text-white" : "border-indigo-200 bg-white text-indigo-900"
              }`}
            >
              {cerrado ? "🔒 Cerrado" : (remate.estado ?? "Abierto")}
            </span>
            {cerrado ? (
              <button
                type="button"
                onClick={async () => {
                  const res = await reabrirRemate(remate.id);
                  if (!res.ok) return toast(res.error ?? "No pude reabrir el remate.", "error");
                  toast(
                    liquidado
                      ? "🔓 Remate abierto: solo se puede asignar comprador a los ejemplares que siguen en CASA. Los ya vendidos quedan bloqueados."
                      : "🔓 Remate abierto: los compradores vuelven a tener el saldo bloqueado.",
                    "success"
                  );
                  await onCambioEstado();
                }}
                className="rounded-full border-2 border-indigo-200 px-2 py-0.5 text-[10px] font-black uppercase leading-none tracking-widest text-white transition-colors hover:bg-indigo-500"
                title={
                  liquidado
                    ? "Reabrir para asignarle comprador a los ejemplares que siguen sin comprador (CASA)"
                    : "Reabrir: un administrador puede volver a editarlo"
                }
              >
                Reabrir
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmandoCierre(true)}
                className="rounded-full border-2 border-indigo-200 px-2 py-0.5 text-[10px] font-black uppercase leading-none tracking-widest text-white transition-colors hover:bg-indigo-500"
                title="Cerrar la subasta: emite un ticket por comprador y descuenta su saldo"
              >
                Cerrar
              </button>
            )}
          </div>
        </div>
        {cerrado && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-[11px] font-bold text-red-700">
            {liquidado ? (
              <>
                🔒 Remate cerrado y liquidado: cada comprador con asignado tiene su ticket de venta y el monto ya
                fue descontado de su saldo. Al reabrirlo solo se puede <b>asignar comprador a los ejemplares que
                siguen en CASA</b>: los ya vendidos quedan bloqueados.
              </>
            ) : (
              <>
                🔒 Remate cerrado: no se pueden subir pujas ni abrir pujas nuevas. El historial y los montos quedan
                como estaban, y las pujas <b>dejan de retener saldo</b> de los compradores. Un administrador puede
                reabrirlo con el botón de arriba.
              </>
            )}
          </div>
        )}
      </Card>

      {/* ---------------------------------------------------- PIZARRA · ESCALERA · FINANZAS
          Las tres van en la misma fila: pizarra a la izquierda (ocupa el doble),
          escalera a su derecha y finanzas a la derecha de la escalera. */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
          <div className="flex flex-col gap-4 xl:col-span-2">
            {/* ------------------------------------------------------- PIZARRA DE PUJAS */}
            <Card className="overflow-hidden">
        {/* Hipódromo · Carrera · Día van AQUÍ, no en la cabecera: es la línea que
            el operador lee siempre que mira las pujas. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line bg-slate-100 px-3 py-1.5">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-600">
            🏇 {remate.hipodromo ?? "—"}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-bold text-slate-600">
              C{remate.carrera ?? "—"} · {remate.fecha ?? "—"} · cierre {remate.hora_cierre || "—"}
            </p>
            <button
              type="button"
              onClick={() => void copiarPizarra()}
              disabled={caballos.length === 0}
              title="Copiar la pizarra para el grupo de WhatsApp"
              className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-black uppercase text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
            >
              💬 WhatsApp
            </button>
          </div>
        </div>

{filasPizarra.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs italic text-slate-400">
            {cargandoProg
              ? "Cargando el programa…"
              : "No hay ejemplares para esta carrera: todavía no cargaste el programa."}
          </p>
        ) : (
          <div className="w-full min-w-0 px-3 py-2">
            {/* Encabezado de columnas: repite la grilla de las filas para que el
                operador sepa qué hay en cada columna. */}
            <div
              className={`${GRILLA_PIZARRA} mb-1 border-b border-line pb-1 text-[9px] font-black uppercase tracking-widest text-slate-400`}
            >
              <span>Ejemplar</span>
              <span>Comprador</span>
              <span>Valor</span>
              <span className="text-center">DIV.</span>
              <span />
            </div>

            <div className="flex flex-col">
              {filasPizarra.map((fila) => {
                if (fila.tipo === "puja") {
                  const c = fila.c;
                  const numero = String(c.ejemplar_numero ?? c.numero);
                  return (
                    <FilaPujaCaballo
                      key={`puja-${c.id ?? c.numero}`}
                      c={c}
                      retiro={retiroSet.has(numero)}
                      inv={invSet.has(numero)}
                      vendido={liquidado && Boolean(c.cliente_id)}
                      soloAsignar={liquidado && !cerrado}
                      dividendo={textoDividendo(finanzas.premioGanador, montoEnPantalla(c))}
                      valor={montos[String(c.id ?? c.numero)] ?? ""}
                      onValor={(v) => setMontoFila(c, v)}
                      opciones={opcionesDeConComprador(clientes, c.cliente_id, bloqueosOtros, opcionesComprador)}
                      clienteId={c.cliente_id ?? ""}
                      cerrado={cerrado}
                      escalera={remate.escalera}
                      toast={toast}
                      onOpciones={() => accionesDe(c)}
                      onCliente={(v) => {
                        c.cliente_id = v;
                        void onClienteCambio(c, v);
                      }}
                      onSubir={(monto, clienteId) => guardarPuja(c, monto, clienteId)}
                      onMoverFoco={moverFocoPuja}
                    />
                  );
                }

                const c = fila.c;
                const numero = String(c.ejemplar_numero);

                if (fila.tipo === "inv" || fila.tipo === "retirado") {
                  const esInv = fila.tipo === "inv";
                  return (
                    <div
                      key={`${fila.tipo}-${numero}`}
                      className={`${GRILLA_PIZARRA} w-full min-w-0 overflow-hidden border-b border-line/60 py-1 ${
                        esInv ? "bg-amber-50/60" : "bg-slate-50"
                      }`}
                      title={
                        esInv
                          ? "Invalidado para Remates: sigue corriendo, pero no puja en este remate."
                          : "Retirado de la carrera: sigue en el programa, pero no puja en este remate."
                      }
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <NumChip numero={c.ejemplar_numero} size="sm" />
                        <span className="min-w-0 truncate text-[13px] font-bold uppercase leading-tight">
                          <span
                            className={
                              esInv
                                ? "text-amber-700 line-through decoration-amber-300"
                                : "text-slate-500 line-through decoration-slate-300"
                            }
                          >
                            {c.nombre || `EJEMPLAR ${c.ejemplar_numero}`}
                          </span>
                        </span>
                      </span>
                      <span className="min-w-0 truncate text-[10px] font-semibold text-slate-400">
                        {esInv ? "Invalidado · no puja" : "Retirado · no puja"}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-400">—</span>
                      <span className="min-w-0 truncate text-center text-xs font-bold text-slate-400">—</span>
                      <span className="flex items-center justify-end">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase ${
                            esInv ? "bg-amber-200 text-amber-900" : "bg-slate-300 text-slate-700"
                          }`}
                        >
                          {esInv ? "INV" : "RET"}
                        </span>
                      </span>
                    </div>
                  );
                }

                // disponible: todavía sin puja; se abre desde esta misma fila.
                const f = filaDe(c.ejemplar_numero);
                const montoFila = Number(f.monto) || 0;
                return (
                  <div
                    key={`disp-${numero}`}
                    className={`${GRILLA_PIZARRA} w-full min-w-0 overflow-hidden border-b border-line/60 py-1 ${
                      f.on ? "bg-emerald-50" : "hover:bg-surfaceAlt"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <NumChip numero={c.ejemplar_numero} size="sm" />
                      <span className="min-w-0 truncate text-[13px] font-bold uppercase leading-tight text-slate-800">
                        {c.nombre || `EJEMPLAR ${c.ejemplar_numero}`}
                      </span>
                    </span>
                    <div className="min-w-0">
                      <SearchableSelect
                        options={opcionesDeConComprador(clientes, f.clienteId, bloqueosOtros, opcionesComprador)}
                        value={f.clienteId}
                        onChange={(v) => setFila(c.ejemplar_numero, { clienteId: v, on: true })}
                        allowCustom={false}
                        placeholder="CASA"
                        className="w-full min-w-0"
                        inputClassName="h-7 w-full min-w-0 rounded border border-line bg-surface px-1.5 py-0.5 text-left text-[11px] font-bold normal-case text-slate-900 placeholder:font-black placeholder:text-slate-400"
                      />
                    </div>
                    <span className="flex min-w-0 items-center gap-1">
                      <span className="text-[11px] font-black text-slate-400">$</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={f.monto}
                        onChange={(e) => setFila(c.ejemplar_numero, { monto: e.target.value, on: true })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void abrirPuja(c);
                        }}
                        placeholder="0.00"
                        aria-label={`Valor de la puja de ${c.nombre || c.ejemplar_numero}`}
                        className="w-full min-w-0 rounded border border-line px-1.5 py-0.5 text-right text-sm font-black text-emerald-700 outline-none focus:border-emerald-500"
                      />
                    </span>
                    <span className="min-w-0 truncate text-center text-xs font-bold text-slate-400">—</span>
                    <span className="flex items-center justify-end">
                      <Button
                        variant="success"
                        size="sm"
                        onClick={() => void abrirPuja(c)}
                        disabled={asignando || montoFila <= 0}
                        title="Abrir la puja de este ejemplar"
                      >
                        {asignando ? "…" : "＋ Abrir"}
                      </Button>
                    </span>
                  </div>
                );
              })}
            </div>

            {/* ------------------------- INCENTIVO -------------------------
                Su propia línea completa en la pizarra: título a la izquierda y
                el campo para escribirlo en la columna de los valores. Antes
                estaba escondido arriba y había que abrir "Finanzas" para tocarlo. */}
            <div
              className={`${GRILLA_PIZARRA} mt-2 w-full min-w-0 border-t-2 border-dashed border-slate-300 pt-2`}
            >
              <label className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-black uppercase tracking-widest text-slate-700">
                Incentivo
                <span className="text-[11px] font-semibold normal-case tracking-normal text-slate-600">
                  de la casa
                </span>
                <select
                  value={modoInc}
                  onChange={(e) => {
                    const m = e.target.value === "pct" ? "pct" : "monto";
                    setModoInc(m);
                    if (m === "pct") {
                      if (!(Number(incPct) > 0)) setIncPct("10");
                    } else {
                      setIncPct("0");
                    }
                  }}
                  className="shrink-0 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold normal-case tracking-normal text-slate-700 shadow-sm focus:border-emerald-500 focus:outline-none"
                  title="Monto fijo o porcentaje del subtotal de las pujas"
                >
                  <option value="monto">Monto fijo ($)</option>
                  <option value="pct">% del subtotal</option>
                </select>
              </label>

              {modoInc === "pct" ? (
                <div className="flex min-w-0 items-center justify-end gap-1">
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={incPct}
                    disabled={cerrado}
                    onChange={(e) => setIncPct(e.target.value)}
                    aria-label="Porcentaje del incentivo sobre el subtotal"
                    className="w-20 rounded border border-line px-1.5 py-0.5 text-right text-sm font-black tabular-nums text-emerald-700 outline-none focus:border-emerald-500 disabled:opacity-50"
                  />
                  <span className="text-[11px] font-black text-slate-400">%</span>
                </div>
              ) : (
                <span />
              )}

              {modoInc === "pct" ? (
                <span className="min-w-0 truncate text-left text-sm font-black text-emerald-700">
                  {usd(finanzas.incentivo)}
                </span>
              ) : (
                <div className="flex min-w-0 items-center gap-1">
                  <span className="text-[11px] font-black text-slate-400">$</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={incentivo}
                    disabled={cerrado}
                    onChange={(e) => setIncentivo(e.target.value)}
                    aria-label="Monto del incentivo de la casa"
                    className="w-full min-w-0 rounded border border-line px-1.5 py-0.5 text-right text-sm font-black text-emerald-700 outline-none focus:border-emerald-500 disabled:opacity-50"
                  />
                </div>
              )}

              <span />
              <button
                type="button"
                disabled={guardandoInc || cerrado}
                onClick={async () => {
                  setGuardandoInc(true);
                  const res = await guardarIncentivoRemate(
                    remate.id,
                    Number(incentivo) || 0,
                    Number(incPct) || 0
                  );
                  setGuardandoInc(false);
                  if (!res.ok) return toast(res.error ?? "No pude guardar el incentivo.", "error");
                  toast("💾 Incentivo guardado.", "success");
                }}
                title="Guardar el incentivo en la base"
                className="rounded px-1.5 py-0.5 text-[10px] font-black uppercase text-slate-500 transition-colors hover:bg-surfaceAlt hover:text-slate-800 disabled:opacity-40"
              >
                {guardandoInc ? "…" : "💾"}
              </button>
            </div>

            {/* ------------------------- TOTAL A PAGAR ------------------------- */}
            <div className={`${GRILLA_PIZARRA} mt-1 w-full min-w-0 border-t border-line pt-1.5`}>
              <p className="min-w-0 truncate text-[11px] font-black uppercase tracking-widest text-emerald-800">
                Total a pagar
                <span className="ml-1 text-[9px] font-semibold normal-case tracking-normal text-slate-400">
                  pujas + incentivo − comisión
                </span>
              </p>
              <span className="text-[10px] font-semibold text-slate-400">
                {usd(finanzas.totalBruto)} − {usd(finanzas.descuentoComision)}
              </span>
              <span className="text-right text-sm font-black tabular-nums text-emerald-700">{usdSinDecimales(finanzas.premioGanador)}</span>
              <span />
              <span />
            </div>
          </div>
        )}

              </Card>

          </div>

          <div className="flex flex-col gap-4">
          {/* Escalera — EDITABLE, con la nota que la explica */}
          <Card className="p-4">
            <p className="mb-2 text-[11px] font-black uppercase tracking-widest text-slate-500">🪜 Escalera de pujas</p>
            <EscaleraEditable
              remateId={remate.id}
              escalera={remate.escalera}
              nota={remate.nota_escalera}
              toast={toast}
              onGuardado={onCambio}
            />
          </Card>
          </div>

          <div className="flex flex-col gap-4">
          {/* Finanzas — el TOTAL A PAGAR ya vive en la pizarra; acá solo el
              desglose, sin la cantidad de caballos (ya se ve arriba). */}
          <Card className="p-4">
            <p className="mb-2 text-[11px] font-black uppercase tracking-widest text-slate-500">💰 Finanzas del remate</p>
            <dl className="space-y-1.5 text-sm">
              <Fila k="Subtotal pujas" v={usd(finanzas.subtotal)} />
              <Fila k="Incentivo casa" v={`+ ${usd(finanzas.incentivo)}`} />
              <Fila k="Total bruto" v={usd(finanzas.totalBruto)} />
              <Fila k={`Comisión (${finanzas.comisionPct}% s/ pujas)`} v={`- ${usd(finanzas.descuentoComision)}`} />
              <div className="mt-2 border-t border-line pt-2">
                <Fila k="Total a pagar" v=                {modoInc === "pct" ? `${Math.round(Number(incPct) || 0)}%` : usdSinDecimales(Number(incentivo) || 0)}
 fuerte />
              </div>
            </dl>
            <p className="mt-2 text-[10px] leading-snug text-slate-400">
              Al <b>cerrar</b> el remate se genera un ticket de venta por cada comprador y se le descuenta el monto de
              la puja del saldo. Los ejemplares sin comprador (<b>CASA</b>) no generan ticket ni descuento.
            </p>
          </Card>
          </div>
        </div>

      {/* Historial de pujas */}
      <Card className="p-4">
        <p className="mb-2 text-[11px] font-black uppercase tracking-widest text-slate-500">
          🧾 Historial de pujas ({historial.length})
        </p>
        {historial.length === 0 ? (
          <p className="py-4 text-center text-xs italic text-slate-400">
            Sin pujas registradas todavía. Aplicá <b>sql/remate_pujas.sql</b> para que se guarden.
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line text-[9px] uppercase tracking-widest text-slate-400">
                  <th className="py-1 font-black">Cuándo</th>
                  <th className="py-1 text-center font-black">Nº</th>
                  <th className="py-1 font-black">Ejemplar</th>
                  <th className="py-1 font-black">Comprador</th>
                  <th className="py-1 text-right font-black">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {historial.map((p, i) => (
                  <tr key={p.id ?? `${p.caballo_id}-${i}`} className="hover:bg-surfaceAlt">
                    <td className="py-1 text-[10px] font-semibold text-slate-500">
                      {p.created_at ? new Date(p.created_at).toLocaleString("es-VE") : "—"}
                    </td>
                    <td className="py-1 text-center font-bold text-slate-500">{p.numero}</td>
                    <td className="py-1 font-bold uppercase text-slate-800">{p.nombre || "—"}</td>
                    <td className="py-1 text-xs font-semibold text-blue-600">{p.cliente ?? "—"}</td>
                    <td className="py-1 text-right font-bold text-emerald-700">{usd(p.monto_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ------------------------------------------------ OPCIONES DEL EJEMPLAR
          Se abren al presionar el caballo (como en Tablas Fijas). Desde acá se
          cambia comprador, valor y se quita la puja; el retiro del ejemplar de la
          carrera también se puede hacer acá, centralizado (se refleja en todos
          los módulos) sin quitarlo de la pizarra. */}
      {acciones && (
        <ModalOpcionesEjemplar
          c={acciones}
          retiro={retiroSet.has(String(acciones.ejemplar_numero ?? acciones.numero))}
          inv={invSet.has(String(acciones.ejemplar_numero ?? acciones.numero))}
          vendido={liquidado && Boolean(acciones.cliente_id)}
          soloAsignar={liquidado && !cerrado}
          cerrado={cerrado}
          proporcion={textoDividendo(finanzas.premioGanador, montoEnPantalla(acciones))}
          opciones={opcionesDeConComprador(clientes, acciones.cliente_id, bloqueosOtros, opcionesComprador)}
          onCerrar={() => setAcciones(null)}
          onCliente={(v) => void onClienteCambio(acciones, v)}
          onValor={(v) => void guardarPuja(acciones, Number(v) || 0, acciones.cliente_id ?? "")}
          onRetirar={() => void toggleRetiro(acciones)}
          onQuitar={async () => {
            // El modal se cierra SOLO si el ejemplar quedó fuera del remate.
            await quitarEjemplar(acciones).then((ok) => {
              if (ok) setAcciones(null);
            });
          }}
        />
      )}

      {/* ------------------------------------------------ CONFIRMAR EL CIERRE
          El cierre es el único momento en que se toca el dinero: por eso se
          muestra qué tickets se van a emitir y a quién se le descuenta saldo
          antes de hacerlo. */}
      {confirmandoCierre && (
        <ModalConfirmarCierre
          remate={remate}
          caballos={caballos}
          cerrando={liquidando}
          onCerrar={() => (liquidando ? undefined : setConfirmandoCierre(false))}
          onConfirmar={async () => {
            setLiquidando(true);
            const res = await cerrarRemateLiquidando(remate.id);
            setLiquidando(false);
            if (!res.ok) return toast(res.error ?? "No pude cerrar el remate.", "error");
            setConfirmandoCierre(false);
            const partes = [`${res.tickets ?? 0} ticket(s) emitido(s)`, `${usd(res.total ?? 0)} descontados del saldo`];
            if ((res.casa ?? 0) > 0) partes.push(`${res.casa} ejemplar(es) quedan en CASA`);
            toast(`🔒 Remate cerrado y liquidado: ${partes.join(" · ")}.`, "success");
            await onCambioEstado();
          }}
        />
      )}
      {previewWsp.abrir && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-emerald-200 bg-emerald-50 px-4 py-3">
              <h3 className="text-xs font-black uppercase text-emerald-800">Mensaje de WhatsApp · Pizarra del remate</h3>
              <button type="button" onClick={() => setPreviewWsp({ abrir: false, texto: "" })} className="text-slate-400 hover:text-slate-700" aria-label="Cerrar">
                ✕
              </button>
            </div>
            <div className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-slate-500">El texto fue copiado al portapapeles. Pégalo directamente en el grupo de WhatsApp.</p>
                <Button
                  size="sm"
                  variant="success"
                  onClick={async () => {
                    try {
                      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(previewWsp.texto);
                      toast("Mensaje copiado al portapapeles.", "success");
                    } catch {
                      toast("No se pudo copiar el mensaje.", "error");
                    }
                  }}
                >
                  Copiar
                </Button>
              </div>
              <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-900">{previewWsp.texto}</pre>
            </div>
            <div className="flex justify-end gap-2 border-t border-line bg-slate-50 px-4 py-3">
              <Button size="sm" variant="outline" onClick={() => setPreviewWsp({ abrir: false, texto: "" })}>Cerrar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Confirmación del cierre.
 *
 * Es el ÚNICO momento en que se toca el dinero, así que antes de hacerlo se dice
 * exactamente qué va a pasar: cuántos tickets se emiten, a quién se le descuenta
 * saldo y cuántos ejemplares quedan en CASA (que no generan ticket ni descuento).
 * Si a un comprador no le alcanza el saldo, el servidor aborta el cierre entero:
 * no se descuenta nada de nadie.
 */
function ModalConfirmarCierre({
  remate,
  caballos,
  cerrando,
  onCerrar,
  onConfirmar,
}: {
  remate: Remate;
  caballos: CaballoRemate[];
  cerrando: boolean;
  onCerrar: () => void;
  onConfirmar: () => void | Promise<void>;
}) {
  const plan = planCierreRemate(caballos);
  const total = plan.total;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Confirmar el cierre del remate"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-line bg-surface p-4 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="text-sm font-black uppercase tracking-wide text-slate-900">
            🔒 Cerrar y liquidar el remate
          </h3>
          <button
            type="button"
            onClick={onCerrar}
            className="text-slate-400 hover:text-slate-700"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <ul className="space-y-1.5 text-xs text-slate-700">
          <li>
            <b>{plan.aVender}</b> ejemplar(es) con comprador: cada uno recibe su ticket de venta y se le descuenta
            el monto de la puja del saldo.
          </li>
          <li>
            Total a descontar: <b>{usd(total)}</b>.
          </li>
          <li>
            <b>{plan.enCasa}</b> ejemplar(es) sin comprador quedan en <b>CASA</b>: no generan ticket ni descuento.
          </li>
          {plan.sinMonto > 0 && (
            <li className="rounded border border-red-200 bg-red-50 px-2 py-1 font-bold text-red-700">
              <b>{plan.sinMonto}</b> ejemplar(es) tienen comprador pero NO tienen valor: hay que ponerles el monto
              antes de cerrar o se quedan fuera de la venta.
            </li>
          )}
        </ul>

        <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] font-semibold text-amber-900">
          Todo pasa en una sola transacción: si a un comprador no le alcanza el saldo, no se descuenta nada de nadie y
          el remate sigue abierto. Si un ejemplar ya se había cobrado en un cierre anterior, no se cobra de nuevo.
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCerrar} disabled={cerrando}>
            Cancelar
          </Button>
          <Button variant="danger" size="sm" onClick={() => void onConfirmar()} disabled={cerrando || plan.vacio}>
            {cerrando ? "Cerrando…" : `Cerrar y descontar ${usd(total)}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Opciones del ejemplar.
 *
 * Solo lo que es del REMATE: comprador, valor y quitar la puja. El retiro (o la
 * reincorporación) del ejemplar a la carrera sí se puede hacer desde acá: pasa
 * por el servicio central, que lo refleja en Carreras, Tablas Fijas, Dupletas y
 * reembolsa los tickets pendientes. El ejemplar NO sale del remate.
 */
function ModalOpcionesEjemplar({
  c,
  retiro,
  inv,
  vendido,
  soloAsignar,
  cerrado,
  proporcion,
  opciones,
  onCerrar,
  onCliente,
  onValor,
  onRetirar,
  onQuitar,
}: {
  c: CaballoRemate;
  retiro: boolean;
  inv: boolean;
  /** Ya vendido en un cierre: bloqueado. */
  vendido?: boolean;
  /** Remate liquidado y reabierto: solo se le puede ASIGNAR un comprador. */
  soloAsignar?: boolean;
  cerrado: boolean;
  proporcion: string;
  opciones: OpcionSelect[];
  onCerrar: () => void;
  onCliente: (v: string) => void;
  onValor: (v: string) => void;
  onRetirar: () => void | Promise<void>;
  onQuitar: () => void | Promise<void>;
}) {
  const numero = String(c.ejemplar_numero ?? c.numero);
  const [valor, setValor] = useState(String(Number(c.monto_usd) || 0));
  const { bloqueado, soloAsignar: soloAsignarFila } = edicionFilaRemate({
    cerrado,
    vendido,
    retiro,
    inv,
    liquidado: soloAsignar,
  });
  /** Remate liquidado y reabierto: el valor ya se descontó, solo se asigna comprador. */
  const valorBloqueado = bloqueado || soloAsignarFila;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Opciones del ejemplar ${numero}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <Card className="w-full max-w-md p-5 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <NumChip numero={numero} />
            <div className="min-w-0">
              <p className="truncate text-sm font-black uppercase text-slate-800">{c.nombre || `EJEMPLAR ${numero}`}</p>
              <p className="text-[11px] font-semibold text-slate-400">
                Nº {numero} · dividendo {proporcion}
              </p>
            </div>
          </div>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        {inv && (
          <p className="mb-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800">
            Invalidado para Remates: no puja ni requiere valor.
          </p>
        )}
        {retiro && (
          <p className="mb-2 rounded border border-slate-300 bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-700">
            Retirado de la carrera: no puja. Reactivalo con el botón de abajo (se refleja en todos los módulos).
          </p>
        )}
        {vendido && (
          <p className="mb-2 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-800">
            Ya vendido: su saldo fue descontado al cerrar el remate, así que acá no se cambia nada.
          </p>
        )}
        {soloAsignar && !vendido && (
          <p className="mb-2 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-bold text-indigo-900">
            Remate liquidado y reabierto: solo se le puede asignar comprador. Al asignarlo se emite el ticket de venta
            y se le descuenta el saldo de una vez.
          </p>
        )}

        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
            <span>Comprador</span>
            <SearchableSelect
              options={opciones}
              value={c.cliente_id ?? ""}
              onChange={onCliente}
              allowCustom={false}
              placeholder="CASA"
              className="w-full"
              inputClassName="h-8 w-full rounded border border-line bg-surface px-2 text-left text-xs font-bold normal-case placeholder:font-black placeholder:text-slate-400"
            />
          </label>
          <span className="text-[10px] font-semibold text-slate-400">
            Si no tiene comprador, el campo dice <b className="text-slate-600">CASA</b> y al cerrar el remate no se
            genera ticket ni se descuenta saldo.
          </span>

          <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
            <span>Valor de la puja</span>
            <span className="flex items-center gap-1">
              <span className="font-black text-slate-400">$</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={valor}
                disabled={valorBloqueado}
                onChange={(e) => setValor(e.target.value)}
                className="w-full min-w-0 rounded border border-line px-2 py-1 text-right text-sm font-black text-emerald-700 outline-none focus:border-emerald-500 disabled:opacity-50"
              />
            </span>
          </label>

          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
            <Button variant="outline" size="sm" onClick={() => void onRetirar()}>
              {retiro ? "↩️ Reactivar en la carrera" : "⛔ Retirar de la carrera"}
            </Button>
            <Button variant="outline" size="sm" onClick={onCerrar}>
              Cerrar
            </Button>
            <Button
              variant="success"
              size="sm"
              disabled={valorBloqueado}
              onClick={() => {
                onValor(valor);
                onCerrar();
              }}
            >
              💾 Guardar
            </Button>
            <Button variant="danger" size="sm" disabled={cerrado || Boolean(vendido)} onClick={() => void onQuitar()}>
              ✕ Quitar del remate
            </Button>
          </div>
        </div>

        <p className="mt-3 border-t border-line pt-2 text-[10px] leading-snug text-slate-400">
          Quitar acá saca <b>la puja</b> y libera el saldo del comprador. El botón de retiro saca (o reintegra) el
          ejemplar de <b>la carrera</b> y lo refleja en todos los módulos: el ejemplar sigue en la pizarra, marcado.
        </p>
      </Card>
    </div>
  );
}

/**
 * Escalera de pujas editable + su nota de observación.
 *
 * Los tramos se editan como texto libre y se normalizan al guardar
 * (`normalizarEscalera`): el formulario puede dejar "100" o "mil" o un vacío, y
 * lo que llega a la base tiene que ser una escalera encadenada y con incrementos
 * positivos, porque de eso sale el monto que hay que pujar.
 */
function EscaleraEditable({
  remateId,
  escalera,
  nota,
  toast,
  onGuardado,
}: {
  remateId: string;
  escalera?: EscalonPuja[];
  nota?: string | null;
  toast: (m: string, t?: "success" | "warning" | "error" | "info") => void;
  onGuardado: () => void | Promise<void>;
}) {
  const inicial = useMemo(() => normalizarEscalera(escalera), [escalera]);
  const [tramos, setTramos] = useState<string[]>(() => inicial.map((e) => `${e.desde}-${e.hasta ?? ""}:${e.incremento}`));
  const [notaTexto, setNotaTexto] = useState(nota?.trim() ? nota : explicacionEscalera(inicial));
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    setTramos(inicial.map((e) => `${e.desde}-${e.hasta ?? ""}:${e.incremento}`));
    setNotaTexto(nota?.trim() ? nota : explicacionEscalera(inicial));
  }, [inicial, nota]);

  const cambiar = (i: number, valor: string) =>
    setTramos((t) => t.map((x, j) => (j === i ? valor : x)));

  const agregar = () => setTramos((t) => [...t, `${t.length * 100}-:50`]);
  const quitar = (i: number) => setTramos((t) => (t.length <= 1 ? t : t.filter((_, j) => j !== i)));

  const guardar = async () => {
    const parsed = tramos.map((t, i) => {
      const m = t.match(/^\s*([\d.,]*)\s*(?:-\s*([\d.,]*))?\s*:\s*([\d.,]*)\s*$/);
      const num = (s: string) => Number(String(s ?? "").replace(/[.,]/g, "")) || 0;
      if (!m) return null;
      return {
        desde: num(m[1]),
        hasta: m[2] === undefined || m[2] === "" ? null : num(m[2]),
        incremento: num(m[3]),
        _i: i,
      };
    });
    if (parsed.some((p) => p === null || !p.incremento)) {
      return toast('Cada tramo se escribe "desde-hasta:+incremento". Ej. "0-100:+10".', "warning");
    }
    const limpia = normalizarEscalera(parsed as EscalonPuja[]);
    setGuardando(true);
    const res = await guardarEscaleraRemate(remateId, limpia, notaTexto);
    setGuardando(false);
    if (!res.ok) return toast(res.error ?? "No pude guardar la escalera.", "error");
    toast("🪜 Escalera de pujas guardada.", "success");
    await onGuardado();
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] leading-snug text-slate-400">
        Un tramo por línea, como <b>desde-hasta:+incremento</b>. Dejá el final vacío para el último
        (ej. <b>1000-:+200</b>). Al guardar los tramos se encadenan solos: no pueden quedar huecos.
      </p>
      <div className="flex flex-col gap-1">
        {tramos.map((t, i) => (
          <div key={i} className="flex items-center gap-1">
            <input
              value={t}
              onChange={(e) => cambiar(i, e.target.value)}
              className="flex-1 rounded border border-line px-2 py-1 font-mono text-xs font-bold text-slate-800"
              aria-label={`Tramo ${i + 1}`}
            />
            <button
              type="button"
              onClick={() => quitar(i)}
              disabled={tramos.length <= 1}
              className="px-1 text-xs text-slate-400 hover:text-red-500 disabled:opacity-30"
              title="Quitar tramo"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={agregar} className="text-[11px] font-bold text-primary-700 hover:underline">
          ＋ Agregar tramo
        </button>
        <Button variant="success" size="sm" onClick={() => void guardar()} disabled={guardando}>
          {guardando ? "…" : "💾 Guardar escalera"}
        </Button>
      </div>
      <div className="rounded-lg border border-line bg-surfaceAlt p-2">
        <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
          📝 Nota de observación
        </p>
        <textarea
          value={notaTexto}
          onChange={(e) => setNotaTexto(e.target.value)}
          rows={3}
          className="w-full resize-y rounded border border-line bg-surface px-2 py-1 text-[11px] leading-snug text-slate-700"
          aria-label="Nota que explica la escalera"
        />
        <p className="mt-1 text-[10px] text-slate-400">
          Se muestra al usuario para que sepa cuánto tiene que subir y por qué no se acepta menos.
        </p>
      </div>
    </div>
  );
}

/**
 * Renglón de la pizarra: un ejemplar ya asignado, con su comprador y su valor.
 *
 * Va sobre la grilla compartida (`GRILLA_PIZARRA`) para que los nombres queden
 * en columna y el operador lea la pizarra de arriba hacia abajo. Tres botones y
 * nada más: retirar/reactivar (izquierda), subir y quitar del remate (derecha).
 */
/**
 * Renglón de la pizarra: un ejemplar del remate, con su comprador y su valor.
 *
 * El CABALLO es el botón: al presionarlo se abren las opciones del ejemplar
 * (igual que en Tablas Fijas), sin botones de retiro metidos en la fila.
 * El retiro del ejemplar de la carrera NO se hace acá: eso es del módulo de
 * Carreras y afecta a todos los módulos.
 */
function FilaPujaCaballo({
  c,
  retiro,
  inv,
  vendido,
  soloAsignar,
  dividendo,
  valor,
  onValor,
  opciones,
  clienteId,
  cerrado,
  escalera,
  toast,
  onOpciones,
  onCliente,
  onSubir,
  onMoverFoco,
}: {
  c: CaballoRemate;
  /** El ejemplar está RETIRADO de la carrera (lo define Carreras): no puja. */
  retiro: boolean;
  /** El ejemplar está INVALIDADO para Remates: no puja ni requiere valor. */
  inv: boolean;
  /** Ya se vendió en un cierre: su saldo se descontó, no se toca más. */
  vendido?: boolean;
  /** Remate liquidado y reabierto: solo se le puede ASIGNAR un comprador. */
  soloAsignar?: boolean;
  /** Dividendo tipo hipódromo ("1.11") que le toca a este ejemplar. */
  dividendo: string;
  /** Lo que el operador está escribiendo (vacío = el monto guardado). */
  valor: string;
  onValor: (v: string) => void;
  opciones: OpcionSelect[];
  clienteId: string;
  cerrado: boolean;
  escalera?: EscalonPuja[];
  toast: (m: string, t?: "success" | "warning" | "error" | "info") => void;
  onOpciones: () => void;
  onCliente: (v: string) => void;
  onSubir: (monto: number, clienteId: string) => void | Promise<void>;
  /** Mueve el foco a otro campo de puja (Enter = abajo, Alt+Enter = arriba). */
  onMoverFoco?: (desde: HTMLInputElement, delta: 1 | -1) => void;
}) {
  const [guardando, setGuardando] = useState(false);
  const numero = String(c.ejemplar_numero ?? c.numero);
  const guardado = Number(c.monto_usd) || 0;
  const editando = valor.trim() !== "" && (Number(valor) || 0) !== guardado;
  const cambiaCliente = String(clienteId) !== String(c.cliente_id ?? "");
  const sinComprador = !String(clienteId).trim();
  // Cerrado, retirado, invalidado o ya vendido: no se toca nada. Si el remate ya
  // se liquidó y se reabrió, en una fila en CASA solo se asigna el comprador.
  const { bloqueado, soloAsignar: soloAsignarFila } = edicionFilaRemate({
    cerrado,
    vendido,
    retiro,
    inv,
    liquidado: soloAsignar,
  });
  /** Con el remate ya liquidado y reabierto el valor no se toca: el total a
   *  pagar ya se descontó y solo falta saber a QUIÉN se le Casa. */
  const valorBloqueado = bloqueado || soloAsignarFila;

  const subir = async () => {
    if (retiro) return toast(`El ejemplar ${numero} está retirado de la carrera: no puja.`, "warning");
    // Dos formas de subir: si el operador escribió un monto a mano, se respeta
    // tal cual; si solo cambió el comprador, se guarda el monto que ya tenía; y
    // si no tocó nada, el botón sube lo que exista según la escalera de pujas.
    const n = editando
      ? Number(valor) || 0
      : cambiaCliente
        ? guardado
        : pujaMinimaSiguiente(guardado, escalera);
    if (n <= 0) return toast("Cargá el valor de la puja.", "warning");
    setGuardando(true);
    try {
      await onSubir(n, clienteId);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div
      className={`${GRILLA_PIZARRA} w-full min-w-0 overflow-hidden border-b border-line/60 py-1 ${
        retiro ? "bg-slate-50" : inv ? "bg-amber-50/60" : cerrado ? "opacity-70" : "hover:bg-surfaceAlt"
      }`}
    >
      {/* EJEMPLAR — es el botón de las opciones */}
      <button
        type="button"
        onClick={onOpciones}
        title="Opciones del ejemplar"
        className="flex min-w-0 items-center gap-1.5 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <NumChip numero={numero} size="sm" />
        <span className="min-w-0 text-left leading-tight">
          <span
            className={`block truncate text-[13px] font-bold uppercase leading-tight ${
              retiro
                ? "text-slate-500 line-through decoration-slate-300"
                : inv
                  ? "text-amber-700 line-through decoration-amber-300"
                  : "text-slate-800"
            }`}
          >
            {c.nombre || "—"}
          </span>
          {(retiro || inv || vendido) && (
            <span
              className={`block text-[10px] font-semibold ${
                retiro ? "text-slate-400" : inv ? "text-amber-700" : "text-slate-400"
              }`}
            >
              {retiro ? "Retirado de la carrera · no puja" : inv ? "Invalidado para Remates · no puja" : "Vendido"}
            </span>
          )}
        </span>
      </button>

      {/* COMPRADOR — sin comprador dice CASA */}
      {bloqueado ? (
        sinComprador ? (
          <span className="flex min-w-0">
            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-black uppercase text-slate-600">
              Casa
            </span>
          </span>
        ) : (
          <span className="min-w-0 truncate text-[11px] font-bold normal-case text-slate-700">
            {clientePorNombre({ cliente: c.cliente, cliente_id: c.cliente_id })}
          </span>
        )
      ) : (
        <div className="min-w-0">
          <SearchableSelect
            options={opciones}
            value={clienteId}
            data-remate-comprador onChange={onCliente}
            allowCustom={false}
            placeholder="CASA"
            className="w-full min-w-0"
            inputClassName="h-7 w-full min-w-0 rounded border border-line bg-surface px-1.5 py-0.5 text-left text-[11px] font-bold normal-case text-slate-900 placeholder:font-black placeholder:text-slate-400"
          />
        </div>
      )}

      {/* VALOR */}
      <span className="flex min-w-0 items-center gap-1">
        <span className="text-[11px] font-black text-slate-400">$</span>
        <input
          type="number"
          min={0}
          step="0.01"
          value={valor.trim() === "" ? (guardado ? String(guardado) : "") : valor}
          disabled={valorBloqueado}
          onChange={(e) => onValor(e.target.value)}
          onFocus={(e) => {
            // Al escribir la nueva puja se pisa el monto viejo de una, sin
            // tener que borrarlo a mano.
            e.currentTarget.select();
          }}
          data-remate-valor
          onKeyDown={(e) => {
            // Enter guarda la puja y baja a la fila siguiente, para que el
            // operador pueda recorrer la pizarra sin volver al ratón. Alt+Enter
            // sube. Con Shift+Enter se guarda sin mover el foco, cuando el
            // operador está corrigiendo una fila y no quiere que se vaya el foco.
            if (e.key !== "Enter") return;
            if (!e.altKey) void subir();
            if (e.shiftKey) return;
            e.preventDefault();
            onMoverFoco?.(e.currentTarget, e.altKey ? -1 : 1);
          }}
          aria-label={`Valor de la puja de ${c.nombre || numero}`}
          className="w-full rounded border border-line px-1.5 py-0.5 text-right text-sm font-black text-emerald-700 outline-none focus:border-emerald-500 disabled:opacity-50"
        />
      </span>

      {/* DIV. — cuota estilo hipódromo (fracción) de este ejemplar. */}
      <span className="min-w-0 truncate text-center text-xs font-bold text-slate-900">{dividendo}</span>

      {/* ACCIONES */}
      <span className="flex items-center justify-end gap-1">
        {cambiaCliente && !bloqueado && (
          <button
            type="button"
            onClick={() => void onCliente(c.cliente_id ?? "")}
            disabled={guardando}
            className="rounded px-1 py-0.5 text-[10px] font-black uppercase text-amber-600 transition-colors hover:bg-amber-50"
            title="Descartar el cambio de comprador"
          >
            ↺
          </button>
        )}
        <button
          type="button"
          onClick={() => void subir()}
          disabled={guardando || valorBloqueado}
          title="Guardar la puja de este ejemplar"
          className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-black uppercase text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
        >
          {guardando ? "…" : "▸ Subir"}
        </button>
        {!bloqueado && (
          <span aria-hidden hidden></span>
        )}
      </span>
    </div>
  );
}

/** Nombre del comprador tal como vino del remate (o el id, si no hay nombre). */
function clientePorNombre(cliente: { cliente?: string | null; cliente_id?: string | null } | null | undefined): string {
  const n = String(cliente?.cliente ?? "").trim();
  return n || (cliente?.cliente_id ? `Cliente ${cliente.cliente_id}` : "—");
}


function Fila({ k, v, fuerte = false }: { k: string; v: string; fuerte?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-xs font-semibold text-slate-500">{k}</dt>
      <dd className={`font-bold ${fuerte ? "text-base text-emerald-700" : "text-slate-800"}`}>{v}</dd>
    </div>
  );
}

export default RematesModule;
