"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/shared/components/ui/Card";
import { Button } from "@/shared/components/ui/Button";
import { Input } from "@/shared/components/ui/Input";
import { ToastHost } from "@/shared/components/ui/ToastHost";
import { Guard } from "@/shared/components/ui/Guard";
import { SearchableSelect, type OpcionSelect } from "@/shared/components/ui/SearchableSelect";
import { BuscadorJornada } from "@/shared/components/ui/BuscadorJornada";
import { useRegistroCentralOpts } from "@/shared/store/useRegistroCentral";
import { listarClientes, type ClienteRow } from "@/features/clientes/lib/clientes";
import { listarGruposVenta, type GrupoVenta } from "@/features/grupos/lib/grupos";
import { listarHipodromos } from "@/features/hipodromos/lib/servicio";
import { esOperativo } from "@/features/hipodromos/lib/tipos";
import { nombreHipodromoParaMostrar } from "@/features/hipodromos/lib/nombre";
import { hoyLocal } from "@/features/gaceta/lib/programa";
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
  liquidarPolla,
  etiquetaPremioPuesto,
  leyendasUnicas,
  textoCarreras,
  type CarreraPolla,
  type Polla,
  type VentaPolla,
  type Combinacion,
  type ResultadoCarrera,
  type VentaPuntuada,
} from "@/features/pollas/lib/pollas";
import { ModalVentaPolla } from "@/features/pollas/components/ModalVentaPolla";
import { ModalConfiguracionPolla } from "@/features/pollas/components/ModalConfiguracionPolla";
import { CargaResultadosRapida } from "@/features/liquidacion/components/CargaResultadosRapida";
import { cobradoNeto, comisionPctDeGrupo } from "@/features/grupos/lib/comisiones-convenio";
import { useReporteEnVivo } from "@/features/reportes/lib/useReporteEnVivo";
import { ToggleModalidadTiempo } from "@/features/jugadas/components/ToggleModalidadTiempo";
import { MODALIDAD_POR_DEFECTO, type ModalidadTiempo } from "@/features/jugadas/lib/modalidad-tiempo";
import { marcarVentaPollaAdelantada } from "@/features/jugadas/lib/marcar-adelantadas";
import {
  esPollaActivaEnPortal,
  alternarPollaActivaPortal,
} from "@/features/portal/lib/control-activas-portal";

/** Tablas que cambian cuando se vende, se paga o se liquida una Polla. */
const TABLAS_VIVO_POLLA = [
  "pollas",
  "polla_ventas",
  "polla_combinaciones",
  "polla_acumulado",
] as const;

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
  /** Sube con cada evento en vivo: las tarjetas releen sus ventas. */
  const [recargaVivo, setRecargaVivo] = useState(0);

  const [modalConfig, setModalConfig] = useState<{ abierto: boolean; polla: Polla | null }>({
    abierto: false,
    polla: null,
  });
  const [ventaPara, setVentaPara] = useState<Polla | null>(null);
  /**
   * Modalidad de TIEMPO de la venta de Polla (PROMPT #4): `EN_VIVO` (como
   * siempre) o `ADELANTADA` (se cargó antes de que corran las carreras). El
   * marcado va por RPC porque `polla_ventas` es de solo lectura para el cliente.
   */
  const [modalidadTiempo, setModalidadTiempo] = useState<ModalidadTiempo>(MODALIDAD_POR_DEFECTO);

  const toast = useCallback(
    (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
      window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));
    },
    []
  );

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true);
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
    // En una recarga silenciosa (evento en vivo) no se apaga el spinner de la
    // pantalla: las tarjetas siguen visibles mientras llega la data nueva.
    if (!silencioso) setCargando(false);
  }, [fecha]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /**
   * Resultados oficiales en vivo: al cargar/corregir la pizarra de una carrera,
   * o al vender/pagar/liquidar, se relee el programa y las tarjetas se
   * recalculan solas. `cargar(true)` no apaga la pantalla.
   */
  const enVivo = useReporteEnVivo({
    habilitado: true,
    fecha,
    tablas: TABLAS_VIVO_POLLA,
    onCambio: () => {
      setRecargaVivo((n) => n + 1);
      void cargar(true);
    },
  });

  /** Grupo de cada Polla, para resolver su % de convenio. */
  const grupoPorId = useMemo(
    () => new Map(grupos.map((g) => [String(g.id), g])),
    [grupos]
  );

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

  /**
   * Hipódromos con carreras cargadas ese día, según el registro central: se
   * muestran PRIMERO en el buscador (misma lectura que Gestión de Jugadas y el
   * semáforo). Pollas filtra por `hipodromo_id`, así que el `value` de cada
   * opción sigue siendo el id y el nombre se resuelve aparte para ordenar.
   */
  const { hipodromosDelDia } = useRegistroCentralOpts(fecha);

  const opcionesHipodromo = useMemo<OpcionSelect[]>(
    () => [
      { value: "", label: "Todos los hipódromos" },
      ...hipodromos.map((h) => ({ value: h.id, label: nombreHipodromoParaMostrar(h.nombre) })),
    ],
    [hipodromos]
  );

  const nombreDeOpcion = useCallback(
    (op: OpcionSelect) => hipodromos.find((h) => h.id === op.value)?.nombre ?? op.label,
    [hipodromos]
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900">Pollas</h1>
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${
                  enVivo
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-slate-50 text-slate-400"
                }`}
                title={
                  enVivo
                    ? "Conectado: los resultados oficiales y las ventas actualizan el ranking solos."
                    : "Sin canal en tiempo real: el ranking se actualiza al cambiar la fecha."
                }
              >
                <span className={enVivo ? "animate-pulse" : ""}>●</span>
                {enVivo ? "En vivo" : "Sin vivo"}
              </span>
            </div>
            <p className="text-sm text-slate-600">
              Juego de puntos sobre el programa. El jugador compra combinaciones y gana quien más
              puntos suma.
            </p>
          </div>
          <p className="text-xs font-semibold text-slate-500">
            {hipodromoId
              ? `${pollasFiltradas.length} polla(s) en ${nombreHipodromoParaMostrar(nombreHipodromo)} · ${fecha}`
              : `${pollasFiltradas.length} polla(s) el ${fecha}`}
          </p>
        </div>

        {/* BUSCADOR DE JORNADA — la misma grilla de Gestión de Jugadas. */}
        <div className="mt-3">
          <BuscadorJornada
            fecha={fecha}
            onFecha={(f) => setFecha(f || hoyLocal())}
            hipodromo={hipodromoId}
            onHipodromo={setHipodromoId}
            hipodromos={opcionesHipodromo}
            delDia={hipodromosDelDia}
            nombreDe={nombreDeOpcion}
            columnas={5}
            placeholderHipodromo="Buscar hipódromo… (Todos)"
            acciones={
              <>
                {/* Modalidad de TIEMPO de la venta de Polla (PROMPT #4). */}
                <ToggleModalidadTiempo valor={modalidadTiempo} onChange={setModalidadTiempo} />
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
              </>
            }
          />
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
            . Creá una para empezar a vender.
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
            pctConvenio={comisionPctDeGrupo(grupoPorId.get(String(p.grupo_id ?? "")) ?? null, "polla") ?? 0}
            recarga={recargaVivo}
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
            // Un ejemplar que no vale NO impide cobrar: se registra y se avisa.
            const avisos = leyendasUnicas(rev.avisos);
            if (avisos.length > 0) {
              toast(avisos[0], "warning");
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
            // Modalidad de TIEMPO (PROMPT #4): si la venta se cargó ⏳ adelantada
            // se marca por la RPC de `polla_ventas` (la tabla es de solo lectura
            // para authenticated). Mejor esfuerzo: la venta YA está registrada.
            if (modalidadTiempo === "ADELANTADA") {
              const marca = await marcarVentaPollaAdelantada(r.id);
              if (!marca.ok) {
                toast(
                  `⚠️ Venta registrada, pero sin marcar ⏳ adelantada: ${marca.error ?? "revisá sql/jugadas_adelantadas.sql"}`,
                  "warning"
                );
              }
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
  pctConvenio,
  recarga = 0,
  onEditar,
  onVender,
  onRecargar,
}: {
  polla: Polla;
  resultados: ResultadoCarrera[];
  clientes: ClienteRow[];
  toast: (m: string, t?: "success" | "warning" | "error" | "info") => void;
  /** % de convenio del grupo de la Polla (0 = sin convenio pactado). */
  pctConvenio: number;
  /** Sube con cada evento en vivo del módulo; relee ventas y combinaciones. */
  recarga?: number;
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
  const [activaPortalTick, setActivaPortalTick] = useState(0);

  useEffect(() => {
    const onCambio = () => setActivaPortalTick((t) => t + 1);
    window.addEventListener("config-activas-portal-cambio", onCambio);
    return () => window.removeEventListener("config-activas-portal-cambio", onCambio);
  }, []);

  const activaPortal = useMemo(() => esPollaActivaEnPortal(polla.id), [polla.id, activaPortalTick]);

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

  // Evento en vivo del módulo (resultado/pago/venta): se releen las ventas de
  // esta Polla sin desmontar la tarjeta ni perder lo que el operador escribió.
  useEffect(() => {
    if (recarga > 0) void cargar();
  }, [recarga, cargar]);

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

  /**
   * Columnas contables del ranking.
   *
   *   · Pagado      = premio de puesto + acumulado que cobra ese cliente;
   *   · Cobrado neto = lo que pagó × (1 − % convenio del grupo) si NO ganó.
   *
   * Se usa `liquidarPolla` (y no `ranking`, que viene con premio 0) porque acá
   * interesa el dinero final. Mientras no haya ningún resultado oficial el
   * ranking todavía no decidió nada y las dos columnas se muestran en "—".
   */
  const hayResultados = resultados.length > 0;
  const rankingPago = useMemo(
    () => liquidarPolla(puntuadas, config, stAcum.disponible),
    [puntuadas, config, stAcum.disponible]
  );
  const dinero = useMemo(() => {
    const pagos = new Map<string, number>();
    const aportes = new Map<string, number>();
    for (const f of rankingPago) pagos.set(f.clave, f.premio + f.acumulado);
    for (const p of puntuadas) {
      const clave = String(p.cliente_id ?? p.cliente ?? p.id ?? "");
      aportes.set(clave, (aportes.get(clave) ?? 0) + p.pagado);
    }
    let totalPagado = 0;
    let totalCobrado = 0;
    for (const f of rankingPago) {
      const pago = f.premio + f.acumulado;
      totalPagado += pago;
      if (pago <= 0) {
        totalCobrado += cobradoNeto(aportes.get(f.clave) ?? 0, pctConvenio);
      }
    }
    return { pagos, aportes, totalPagado, totalCobrado };
  }, [rankingPago, puntuadas, pctConvenio]);

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
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={activaPortal ? "success" : "outline"}
            className={
              activaPortal
                ? "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600"
                : "text-slate-600 border-slate-300 hover:bg-slate-100"
            }
            onClick={async () => {
              const nueva = await alternarPollaActivaPortal(polla.id);
              setActivaPortalTick((t) => t + 1);
              toast(
                nueva
                  ? `🟢 Polla "${polla.nombre}" activada en portal.`
                  : `⚪ Polla "${polla.nombre}" oculta en portal.`,
                nueva ? "success" : "info"
              );
            }}
            title={
              activaPortal
                ? "Polla visible en portal de clientes (clic para ocultar)"
                : "Polla oculta en portal de clientes (clic para activar)"
            }
          >
            {activaPortal ? "🟢 Portal: Activa" : "⚪ Portal: Oculta"}
          </Button>
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
            ["1.º", polla.premios.primero, polla.premiosPct.primero, polla.premiosTexto.primero],
            ["2.º", polla.premios.segundo, polla.premiosPct.segundo, polla.premiosTexto.segundo],
            ["3.º", polla.premios.tercero, polla.premiosPct.tercero, polla.premiosTexto.tercero],
          ] as const
        ).map(([puesto, monto, pct, txt]) => (
          <span key={puesto} className="text-slate-600">
            {puesto}{" "}
            <strong className="text-slate-900">{etiquetaPremioPuesto(monto, pct, txt)}</strong>
          </span>
        ))}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-4">
        <Dato titulo="Combinaciones vendidas" valor={String(comboTotal)} />
        <Dato titulo="Vendido" valor={formato(fin.ventaBruta)} />
        <Dato
          titulo="Bolsa de premios"
          valor={formato(fin.bolsaPremios)}
          pie={`Recaudado − ${config.comisionPct}% comisión`}
        />
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
                    <th className="py-1 text-right">Pagado</th>
                    <th
                      className="py-1 text-right"
                      title="Monto aportado × (1 − % de convenio del grupo) cuando el cliente no ganó"
                    >
                      Cobrado neto
                    </th>
                    <th className="py-1 text-right">Al acumulado</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((f) => {
                    const original = puntuadas.find((p) => p.id === f.clave);
                    const pago = hayResultados ? (dinero.pagos.get(f.clave) ?? 0) : 0;
                    const cobrado =
                      !hayResultados || pago > 0
                        ? 0
                        : cobradoNeto(dinero.aportes.get(f.clave) ?? 0, pctConvenio);
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
                        <td className="py-1">
                          {f.cliente ?? "Sin cliente"}
                          {/* Badge de modalidad de TIEMPO (PROMPT #4): la venta
                              se cargó ⏳ adelantada (antes de las carreras). */}
                          {ventas.some(
                            (v) =>
                              v.cliente_id === f.clave &&
                              String((v as { es_adelantada?: unknown }).es_adelantada ?? "").toLowerCase() === "true"
                          ) ? (
                            <span
                              title="Jugada adelantada: se cargó antes de que corran las carreras."
                              className="ml-1 rounded bg-amber-100 px-1 py-px text-[9px] font-black uppercase text-amber-700"
                            >
                              ⏳ ADELANTADA
                            </span>
                          ) : null}
                        </td>
                        <td className="py-1 text-right">
                          {original?.combinaciones.length ?? 0}
                        </td>
                        <td className="py-1 text-right font-bold">{f.puntos}</td>
                        <td className="py-1 text-right tabular-nums text-emerald-700">
                          {hayResultados && pago > 0 ? formato(pago) : "—"}
                        </td>
                        <td className="py-1 text-right tabular-nums text-sky-700">
                          {hayResultados && cobrado > 0 ? formato(cobrado) : "—"}
                        </td>
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
                {hayResultados && (
                  <tfoot>
                    <tr className="border-t-2 border-line font-bold">
                      <td colSpan={4} className="py-1 text-right text-xs uppercase text-slate-500">
                        Totales
                      </td>
                      <td className="py-1 text-right tabular-nums text-emerald-700">
                        {formato(dinero.totalPagado)}
                      </td>
                      <td className="py-1 text-right tabular-nums text-sky-700">
                        {formato(dinero.totalCobrado)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
            <p className="mt-2 text-[10px] font-semibold text-slate-500">
              💵 <b>Pagado</b> = premio de puesto + acumulado que cobra el cliente.{" "}
              <b>Cobrado neto</b> = lo que pagó × (1 − {pctConvenio}% de convenio del grupo) cuando no
              ganó.
              {!hayResultados && " Se completa cuando haya resultados oficiales cargados."}
              {hayResultados && polla.estado !== "Liquidada" &&
                " Provisional: se actualiza con cada resultado y se fija al liquidar la Polla."}
            </p>
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