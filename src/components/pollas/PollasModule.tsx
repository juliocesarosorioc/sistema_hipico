"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ToastHost } from "@/components/ui/ToastHost";
import { Guard } from "@/components/ui/Guard";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { listarClientes, type ClienteRow } from "@/lib/clientes";
import { listarGruposVenta, type GrupoVenta } from "@/lib/grupos";
import { listarHipodromos } from "@/lib/hipodromos/servicio";
import { esOperativo } from "@/lib/hipodromos/tipos";
import { hoyLocal } from "@/lib/gaceta/programa";
import {
  listarPollas,
  guardarPolla,
  cambiarEstadoPolla,
  leerProgramaDePolla,
  listarVentas,
  registrarVentaPolla,
  listarCombinaciones,
  listarAcumulados,
  aportarAcumulado,
  pagarAcumulado,
  configDePolla,
  parsearSeleccion,
  revisarVenta,
  puntuarVentas,
  ordenarRanking,
  estadoAcumulado,
  calcularFinanzasPolla,
  etiquetaPremio,
  textoCarreras,
  type CarreraPolla,
  type Polla,
  type VentaPolla,
  type Combinacion,
  type ResultadoCarrera,
  type VentaPuntuada,
} from "@/lib/pollas";
import { ModalVentaPolla } from "@/components/pollas/ModalVentaPolla";
import { ModalConfiguracionPolla } from "@/components/pollas/ModalConfiguracionPolla";
import { CargaResultadosRapida } from "@/components/liquidacion/CargaResultadosRapida";

/**
 * Chip de hipódromo. El elegido se ve relleno; el resto, con borde. No es un
 * `<select>`: el operador tiene que saber sin abrir nada qué hipódromo está
 * filtrando la lista.
 */
function chipCls(activo: boolean): string {
  return `rounded-full border px-3 py-1 text-sm font-semibold transition-colors ${
    activo
      ? "border-primary-600 bg-primary-600 text-white"
      : "border-line bg-white text-slate-700 hover:bg-surfaceAlt"
  }`;
}

/**
 * ============================================================================
 * POLLAS
 * ============================================================================
 *
 * Módulo independiente. No cuelga de Taquilla ni de Gestión de Jugadas: son
 * reglas distintas —acá se gana por PUNTOS acumulados y no por Carrera— y
 * mezclarlas terminaría puntuando una Polla con la lógica de otro juego.
 *
 * EL RESULTADO NUNCA SE GUARDA ACÁ
 * ------------------------------
 * Al liquidar se lee la pizarra del momento. Si la Polla guardara una copia,
 * corregir la pizarra después daría dos verdades y el ganador dependería de cuál
 * se lea. Lo que sí queda congelado es lo que se VENDIÓ: las carreras con sus
 * inválidos, tal como estaban cuando se cobró.
 *
 * TODO EL CÁLCULO ESTÁ EN EL CORE
 * -------------------------------
 * Este archivo arma `VentaPuntuada[]` y se la pasa a `puntuarVentas` /
 * `ordenarRanking`. No recalcula un solo punto: la regla vive en
 * `src/lib/pollas/core.ts` y está cubierta por `pruebas/pollas.test.ts`.
 */
export function PollasModule() {
  const [fecha, setFecha] = useState(hoyLocal());
  const [hipodromos, setHipodromos] = useState<{ id: string; nombre: string }[]>([]);
  const [hipodromoId, setHipodromoId] = useState("");
  const [pollas, setPollas] = useState<Polla[]>([]);
  const [carrerasHoy, setCarrerasHoy] = useState<CarreraPolla[]>([]);
  const [resultados, setResultados] = useState<ResultadoCarrera[]>([]);
  const [grupos, setGrupos] = useState<GrupoVenta[]>([]);
  const [clientes, setClientes] = useState<ClienteRow[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalConfig, setModalConfig] = useState<{ abierto: boolean; polla: Polla | null }>({
    abierto: false,
    polla: null,
  });
  const [ventaPara, setVentaPara] = useState<Polla | null>(null);

  const toast = useCallback(
    (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));
    },
    []
  );

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    const [programa, lista, g, c] = await Promise.all([
      leerProgramaDePolla(fecha),
      listarPollas(fecha),
      listarGruposVenta(),
      listarClientes(),
    ]);
    if (programa.ok) {
      setCarrerasHoy(programa.datos?.carreras ?? []);
      setResultados(programa.datos?.resultados ?? []);
    }
    if (lista.ok) setPollas(lista.datos ?? []);
    else setError(lista.error ?? "No pude cargar las Pollas.");
    // `listarClientes` y `listarGruposVenta` devuelven el arreglo directo (no
    // envuelto en {ok, datos}) y ya traen caché propia.
    setGrupos(g);
    setClientes(c);
    setCargando(false);
  }, [fecha]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /**
   * El catálogo de hipódromos no depende de la fecha, así que se trae una sola
   * vez: recargarlo en cada cambio de día no aportaría nada y re-renderizaría
   * los chips mientras el operador elige.
   */
  useEffect(() => {
    void (async () => {
      const h = await listarHipodromos();
      if (!h.ok) return;
      setHipodromos(
        (h.data ?? [])
          .filter(esOperativo)
          .map((x) => ({ id: String(x.id), nombre: String(x.nombre) }))
      );
    })();
  }, []);

  const nombreHipodromo = useMemo(
    () => hipodromos.find((h) => h.id === hipodromoId)?.nombre ?? "",
    [hipodromos, hipodromoId]
  );

  /** Las Pollas del día. Con hipódromo elegido, solo las de ese hipódromo. */
  const pollasFiltradas = useMemo(
    () =>
      hipodromoId
        ? pollas.filter((p) => String(p.hipodromo_id ?? "") === hipodromoId)
        : pollas,
    [pollas, hipodromoId]
  );

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Pollas</h1>
            <p className="text-sm text-slate-600">
              Juego de puntos sobre el programa. El jugador compra combinaciones y gana quien más
              puntos suma.
            </p>
          </div>
          <div className="flex items-end gap-2">
            <Input
              label="Fecha"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value || hoyLocal())}
            />
            <CargaResultadosRapida
              cargadoPor="POLLAS"
              fecha={fecha}
              hipodromo={nombreHipodromo || undefined}
              carreras={carrerasHoy.map((c2) => ({
                carrera: c2.carrera,
                caballos: c2.ejemplares.map((e) => ({
                  numero: e.numero,
                  nombre: e.nombre ?? "",
                })),
              }))}
              onGuardado={() => void cargar()}
            />
            <Guard permiso="pollas:btn_crear_polla">
              <Button onClick={() => setModalConfig({ abierto: true, polla: null })}>
                Nueva Polla
              </Button>
            </Guard>
          </div>
        </div>

        {/* ------------------------------------------------------------
            HIPÓDROMO. No había selector: `hipodromo_id` quedaba en null y no
            se podía acotar la lista a un hipódromo del día. Son chips y no un
            `<select>` porque con el elegido siempre a la vista no hace falta
            abrirlo para acordarse qué se estaba filtrando.
         * ---------------------------------------------------------- */}
        <div className="mt-3">
          <span className="mb-1.5 block text-sm font-semibold text-slate-800">Hipódromo</span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setHipodromoId("")}
              className={chipCls(hipodromoId === "")}
            >
              Todos
            </button>
            {hipodromos.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => setHipodromoId(h.id)}
                className={chipCls(hipodromoId === h.id)}
              >
                {h.nombre}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            {hipodromoId
              ? `${pollasFiltradas.length} polla(s) en ${nombreHipodromo} · ${fecha}`
              : `${pollasFiltradas.length} polla(s) el ${fecha}`}
          </p>
        </div>

        {error && (
          <p className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-sm font-semibold text-danger-700">
            {error}
          </p>
        )}
      </Card>

      {cargando ? (
        <Card>
          <p className="text-sm text-slate-500">Cargando…</p>
        </Card>
      ) : pollasFiltradas.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
            No hay Pollas para el {fecha}
            {hipodromoId ? ` en ${nombreHipodromo}` : ""}. Creá una para empezar a vender.
          </p>
        </Card>
      ) : (
        pollasFiltradas.map((p) => (
          <TarjetaPolla
            key={p.id}
            polla={p}
            resultados={resultados}
            clientes={clientes}
            toast={toast}
            onEditar={() => setModalConfig({ abierto: true, polla: p })}
            onVender={() => setVentaPara(p)}
            onRecargar={cargar}
          />
        ))
      )}

      {/* Se monta solo abierto: el modal guarda su estado en `useState` con el
          valor inicial de las props, así que si quedaba colgado entre aperturas,
          "Editar" abría un formulario en blanco y una nueva Polla arrancaba con
          la selección de la anterior. */}
      {modalConfig.abierto && (
        <ModalConfiguracionPolla
          key={modalConfig.polla?.id ?? "nueva"}
          abierto
          polla={modalConfig.polla}
          disponibles={carrerasHoy}
          grupos={grupos}
          hipodromos={hipodromos}
          hipodromoInicial={hipodromoId}
          fecha={fecha}
          onCerrar={() => setModalConfig({ abierto: false, polla: null })}
          onConfirmar={async (datos) => {
            const r = await guardarPolla(modalConfig.polla?.id ?? null, datos);
            if (!r.ok) {
              toast(r.error ?? "No pude guardar la Polla.", "error");
              return false;
            }
            toast(modalConfig.polla ? "Polla actualizada." : "Polla creada.", "success");
            await cargar();
            return true;
          }}
        />
      )}

      {ventaPara && (
        <ModalVentaPolla
          abierto
          polla={ventaPara}
          clientes={clientes}
          onCerrar={() => setVentaPara(null)}
          onConfirmar={async ({ clienteId, numeroTicket, texto }) => {
            // Se revalida acá y no solo en el modal: entre que se abrió y se
            // confirmó la carrera pudo invalidarse, y lo que se cobra tiene que
            // ser lo que estaba válido al momento del cobro.
            const parseo = parsearSeleccion(texto, ventaPara.carreras);
            if (!parseo.ok) {
              toast(parseo.error, "error");
              return false;
            }
            const rev = revisarVenta(parseo.combinaciones, ventaPara.carreras);
            if (rev.invalidas.length > 0) {
              toast(rev.invalidas[0].error, "error");
              return false;
            }
            const r = await registrarVentaPolla({
              pollaId: ventaPara.id,
              clienteId,
              numeroTicket,
              combinaciones: rev.validas,
              textoOriginal: texto,
            });
            if (!r.ok) {
              toast(r.error ?? "No pude registrar la venta.", "error");
              return false;
            }
            toast(`Venta de ${rev.validas.length} combinaciones registrada.`, "success");
            await cargar();
            return true;
          }}
        />
      )}

      <ToastHost />
    </div>
  );
}

// ============================================================================
// TARJETA DE UNA POLLA
// ============================================================================

function TarjetaPolla({
  polla,
  resultados,
  clientes,
  toast,
  onEditar,
  onVender,
  onRecargar,
}: {
  polla: Polla;
  resultados: ResultadoCarrera[];
  clientes: ClienteRow[];
  toast: (m: string, t?: "success" | "warning" | "error" | "info") => void;
  onEditar: () => void;
  onVender: () => void;
  onRecargar: () => Promise<void> | void;
}) {
  const [ventas, setVentas] = useState<VentaPolla[]>([]);
  const [combinaciones, setCombinaciones] = useState<Map<string, Combinacion[]>>(new Map());
  const [saldo, setSaldo] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [cobraA, setCobraA] = useState("");
  const [montoAporte, setMontoAporte] = useState("");

  const config = useMemo(() => configDePolla(polla), [polla]);

  const cargar = useCallback(async () => {
    setCargando(true);
    const [v, combis, ac] = await Promise.all([
      listarVentas(polla.id),
      listarCombinaciones(polla.id),
      listarAcumulados(polla.id),
    ]);

    const lv = v.ok ? (v.datos ?? []) : [];
    setVentas(lv);

    // Se arman las combinaciones por venta y se las puntúa con el core. Las
    // anuladas se dejan afuera: un ejemplar que se invalidó DESPUÉS de la venta
    // no puede seguir sumando.
    const porVenta = new Map<string, Combinacion[]>();
    for (const c of combis.ok ? (combis.datos ?? []) : []) {
      if (c.anulada) continue;
      const lista = porVenta.get(c.venta_id) ?? [];
      lista.push(c.posiciones);
      porVenta.set(c.venta_id, lista);
    }
    setCombinaciones(porVenta);

    setSaldo(
      (ac.ok ? (ac.datos ?? []) : [])
        .filter((a) => !a.pagado_at)
        .reduce((s, a) => s + a.disponible, 0)
    );

    setCargando(false);
  }, [polla.id]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /**
   * El ranking. Se arma con `puntuarVentas`, que agrupa por cliente y suma los
   * puntos de TODAS sus combinaciones: compite la persona, no la combinación.
   */
  const puntuadas = useMemo<VentaPuntuada[]>(
    () =>
      puntuarVentas(
        ventas.map((v) => ({
          id: v.id,
          cliente_id: v.cliente_id,
          cliente: v.clienteNombre,
          combinaciones: combinaciones.get(v.id) ?? [],
          puntosTotales: 0,
          pagado: v.pagado,
        })),
        resultados,
        polla.carreras,
        polla.puntos
      ),
    [ventas, combinaciones, resultados, polla.carreras, polla.puntos]
  );

  const ranking = useMemo(() => ordenarRanking(puntuadas), [puntuadas]);
  const stAcum = useMemo(
    () => estadoAcumulado(ranking, config, saldo),
    [ranking, config, saldo]
  );

  const comboTotal = useMemo(
    () => ventas.reduce((s, v) => s + v.combinaciones, 0),
    [ventas]
  );
  const fin = useMemo(
    () => calcularFinanzasPolla(comboTotal, config, stAcum.disponible, ranking),
    [comboTotal, config, stAcum.disponible, ranking]
  );

  const cerrada = polla.estado !== "Abierta";
  const cobrarAcumulado = stAcum.alcanzado;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-slate-900">{polla.nombre}</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                polla.estado === "Abierta"
                  ? "bg-success-100 text-success-700"
                  : polla.estado === "Liquidada"
                    ? "bg-primary-100 text-primary-700"
                    : "bg-slate-200 text-slate-600"
              }`}
            >
              {polla.estado}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600">{textoCarreras(polla.carreras)}</p>
          <p className="mt-1 text-xs text-slate-500">
            {polla.puntos.primero}/{polla.puntos.segundo}/{polla.puntos.tercero} por puesto ·{" "}
            {formato(polla.precioUnitario)} por combinación
          </p>
        </div>
        <div className="flex gap-2">
          <Guard permiso="pollas:btn_crear_polla">
            <Button size="sm" variant="outline" onClick={onEditar}>
              Configurar
            </Button>
          </Guard>
          <Guard permiso="pollas:btn_registrar_venta">
            <Button size="sm" disabled={cerrada} onClick={onVender}>
              Vender
            </Button>
          </Guard>
        </div>
      </div>

      {/* Premios siempre visibles: es lo primero que pregunta el jugador antes de
          comprar, y abrir un modal para verlo es una fricción innecesaria. */}
      <div className="mt-3 flex flex-wrap gap-4 border-y border-line py-2 text-sm">
        {(
          [
            ["1.º", polla.premios.primero, polla.premiosTexto.primero],
            ["2.º", polla.premios.segundo, polla.premiosTexto.segundo],
            ["3.º", polla.premios.tercero, polla.premiosTexto.tercero],
          ] as const
        ).map(([puesto, monto, txt]) => (
          <span key={puesto} className="text-slate-600">
            {puesto}{" "}
            <strong className="text-slate-900">{etiquetaPremio(monto, txt)}</strong>
          </span>
        ))}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Dato titulo="Combinaciones vendidas" valor={String(comboTotal)} />
        <Dato titulo="Vendido" valor={formato(fin.ventaBruta)} />
        <Dato titulo="Acumulado disponible" valor={formato(saldo)} pie={`Meta ${config.metaPuntos} pts`} />
      </div>

      {cargando ? (
        <p className="mt-3 text-sm text-slate-500">Cargando ventas…</p>
      ) : (
        <>
          <div className="mt-4">
            <h3 className="mb-2 text-sm font-bold text-slate-800">Ranking</h3>
            {ranking.length === 0 ? (
              <p className="text-sm text-slate-500">Todavía no hay ventas en esta Polla.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase text-slate-500">
                    <th className="py-1">Puesto</th>
                    <th className="py-1">Cliente</th>
                    <th className="py-1 text-right">Combinaciones</th>
                    <th className="py-1 text-right">Puntos</th>
                    <th className="py-1 text-right">Al acumulado</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((f) => {
                    const original = puntuadas.find((p) => p.id === f.clave);
                    return (
                      <tr
                        key={f.clave}
                        className={`border-b border-line last:border-b-0 ${
                          f.puesto === 1 ? "bg-success-50 font-semibold" : ""
                        }`}
                      >
                        <td className="py-1">
                          {f.puesto ?? "—"}
                          {f.empatado && (
                            <span className="ml-1 text-xs text-slate-500" title="Empate">
                              =
                            </span>
                          )}
                        </td>
                        <td className="py-1">{f.cliente ?? "Sin cliente"}</td>
                        <td className="py-1 text-right">
                          {original?.combinaciones.length ?? 0}
                        </td>
                        <td className="py-1 text-right font-bold">{f.puntos}</td>
                        <td className="py-1 text-right">
                          {f.acumulado > 0 ? (
                            <span className="text-success-700">
                              cobra {formato(f.acumulado)}
                            </span>
                          ) : f.faltantesAcumulado > 0 ? (
                            <span className="text-slate-500">
                              faltan {f.faltantesAcumulado}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {fin.avisos.length > 0 && (
            <ul className="mt-3 space-y-1 rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-800">
              {fin.avisos.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          )}

          <div className="mt-4 border-t border-line pt-3">
            <h3 className="mb-2 text-sm font-bold text-slate-800">Acumulado</h3>
            <p className="mb-2 text-sm text-slate-600">
              {ranking.length === 0 ? (
                "Todavía no hay jugadores."
              ) : cobrarAcumulado ? (
                <>
                  {ranking
                    .filter((f) => f.acumulado > 0)
                    .map((f) => f.cliente ?? "sin cliente")
                    .join(" y ")}{" "}
                  cobra{formato(saldo)}.
                </>
              ) : (
                <>
                  Faltan {stAcum.faltantes} puntos para la meta: el más alto está en{" "}
                  {stAcum.liderPuntos} de {config.metaPuntos}.
                </>
              )}
            </p>

            <Guard permiso="pollas:fn_liquidar_polla">
              <div className="flex flex-wrap items-end gap-2">
                <Input
                  label="Aportar al acumulado"
                  value={montoAporte}
                  onChange={(e) => setMontoAporte(e.target.value)}
                  inputMode="decimal"
                />
                <Button
                  variant="outline"
                  onClick={async () => {
                    const r = await aportarAcumulado(polla.id, Number(montoAporte));
                    if (!r.ok) return toast(r.error ?? "No pude aportar.", "error");
                    toast(`Aportado. Saldo: ${formato(r.saldo ?? 0)}`, "success");
                    setMontoAporte("");
                    await cargar();
                  }}
                >
                  Aportar
                </Button>

                <div>
                  <span className="mb-1 block text-sm font-semibold text-slate-800">Pagar a</span>
                  <SearchableSelect
                    options={clientes.map((c) => ({
                      value: String(c.id),
                      label: c.nombre ?? String(c.id),
                    }))}
                    value={cobraA}
                    onChange={setCobraA}
                    placeholder="Elegí quién cobra"
                  />
                </div>
                <Button
                  variant="success"
                  disabled={!cobraA || saldo <= 0}
                  onClick={async () => {
                    const r = await pagarAcumulado(polla.id, cobraA);
                    if (!r.ok) return toast(r.error ?? "No pude pagar el acumulado.", "error");
                    toast(`Acumulado pagado: ${formato(r.monto ?? 0)}`, "success");
                    setCobraA("");
                    await cargar();
                  }}
                >
                  Pagar acumulado
                </Button>
              </div>
            </Guard>
          </div>
        </>
      )}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
        <Guard permiso="pollas:fn_guardar_polla">
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              const siguiente = polla.estado === "Abierta" ? "Cerrada" : "Abierta";
              const r = await cambiarEstadoPolla(polla.id, siguiente);
              if (!r.ok) return toast(r.error ?? "No pude cambiar el estado.", "error");
              toast(`Polla ${siguiente.toLowerCase()}.`, "success");
              await onRecargar();
            }}
          >
            {polla.estado === "Abierta" ? "Cerrar" : "Reabrir"}
          </Button>
        </Guard>
        {polla.estado !== "Liquidada" && (
          <Guard permiso="pollas:btn_liquidar">
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const r = await cambiarEstadoPolla(polla.id, "Liquidada");
                if (!r.ok) return toast(r.error ?? "No pude liquidar.", "error");
                toast("Polla liquidada.", "success");
                await onRecargar();
              }}
            >
              Marcar liquidada
            </Button>
          </Guard>
        )}
      </div>
    </Card>
  );
}

function Dato({ titulo, valor, pie }: { titulo: string; valor: string; pie?: string }) {
  return (
    <div className="rounded-lg bg-surfaceAlt px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-slate-500">{titulo}</div>
      <div className="text-lg font-bold text-slate-900">{valor}</div>
      {pie && <div className="text-xs text-slate-500">{pie}</div>}
    </div>
  );
}

function formato(n: number): string {
  return n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default PollasModule;