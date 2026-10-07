"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { ToastHost } from "@/components/ui/ToastHost";
import { listarTablasPublicadas } from "@/lib/tablas/rpc";
import { useRegistroCentralOpts, claveHipodromo } from "@/store/useRegistroCentral";
import { normalizarDia } from "@/lib/carreras/agruparHipodromos";
import type { TablaFijaRow } from "@/lib/tablas-fijas";
import { alternarRetiroCarrera } from "@/lib/carreras/retiros";
import { listarClientesVenta, listarGruposVenta, esClienteLibre, type ClienteVenta, type GrupoVenta } from "@/lib/grupos";
import { colorDeNumeroGac } from "@/lib/gaceta/ui";
import { Flag, normalizarNacionalidad } from "@/components/ui/BanderaPais";
import { claveCelda, guardarDupleta, listarDupletasGuardadas, type CaballoDupleta, type DupletaEstado } from "@/lib/dupletas";
import {
  venderDupleta,
  liquidarDupleta,
  reasignarJugadorDupleta,
  anularDupleta,
  claveIdempotenciaDupleta,
  eliminarDupleta,
  type VentaDupleta,
} from "@/lib/dupletas";
import { listarBanquerosGrupo } from "@/lib/banqueros";
import { hoyLocal } from "@/lib/gaceta/programa";
import { TicketVentaPreview, type TicketVentaModel } from "@/components/tickets/TicketVentaPreview";
import { capturarNodo, componerA4Paisaje, guardarLienzos, A4_PAISAGE, type ImgFormato } from "@/lib/impresion/exportar";

const inputLbl = "text-[10px] font-bold uppercase tracking-wider text-slate-500";
const inputSel =
  "w-full rounded-lg border border-line bg-surface px-2 py-1 text-xs font-bold uppercase text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";
/** Igual que `inputSel`, pero para MONTOS: se alinean a la derecha, que es la
 *  convención que hace comparables dos cifras de largo distinto sin contar
 *  dígitos. */
const inputMonto =
  "w-full rounded-lg border border-line bg-surface px-2 py-1 text-right text-xs font-bold uppercase text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";

const esHipoAmericano = (h: string) => /PARK|DOWNS|AQUEDUCT|SARATOGA|TAMPA|MEADOWS|WOODBINE|GOLDEN|SANTA ANITA|DEL MAR|OAKLAWN/i.test(h);
const casaDe = (h: string) => (esHipoAmericano(h) ? "USA" : "VE");

/** True si el ejemplar es de otra nacionalidad que el hipódromo (mostrar bandera). */
const banderaNoCasa = (nac?: string | null, hipo = "") => normalizarNacionalidad(nac) !== casaDe(hipo);

/** Sigla abreviada del país entre paréntesis: (VE), (USA), (OTRA). */
const siglaDe = (nac?: string | null) => normalizarNacionalidad(nac);

/** Tamaño base de la bandera en la matriz, antes del recargo (px). */
const TAM_BANDERA_BASE = 12;

/** La bandera se muestra un 80% más grande que el tamaño base. */
const TAM_BANDERA = Math.round(TAM_BANDERA_BASE * 1.8);

/**
 * Fondo de la celda de la primera columna por posición: 1 blanco, 2 azul
 * clarito, 3 blanco, 4 azul clarito... y así hasta el último ejemplar.
 */
const FONDO_FILA_DUPLA = ["bg-white", "bg-indigo-50"] as const;

/**
 * Clave con la que se identifica una dupleta guardada.
 *
 * Las filas viejas VINIERON sin `clave`, y se armaba la clave al vuelo en el JSX
 * con el mismo criterio. Queda en una función para que el desplegable, la
 * búsqueda y el borrado no puedan discrepar: si se armaran distinto, cargar una
 * dupleta y borrarla apuntarían a registros distintos.
 */
const claveDeDupleta = (g: DupletaEstado): string =>
  g.clave ?? `${claveCelda(String(g.carrera1), String(g.carrera2))}${g.hipodromo}${g.fecha}`;

export function DupletaModule() {
  const [carreras, setCarreras] = useState<TablaFijaRow[]>([]);
  const [guardadas, setGuardadas] = useState<DupletaEstado[]>([]);
  const [clientes, setClientes] = useState<ClienteVenta[]>([]);
  const [grupos, setGrupos] = useState<GrupoVenta[]>([]);

  // El día arranca en HOY, no vacío. El módulo se usa para vender en el momento
  // y con el campo en blanco la pantalla abría sin hipódromo ni carreras: había
  // que elegir la fecha a mano antes de poder hacer nada. La jornada sigue
  // siendo editable para vender o liquidar un día anterior.
  const [hipodromo, setHipodromo] = useState("");
  const [dia, setDia] = useState(hoyLocal());
  const [carrera1, setCarrera1] = useState("");
  const [carrera2, setCarrera2] = useState("");
  const [premio, setPremio] = useState("200");
  const [precio, setPrecio] = useState("10");

  const [matriz, setMatriz] = useState<DupletaEstado | null>(null);
  const tablaRef = useRef<HTMLTableElement | null>(null);
  const areaRef = useRef<HTMLDivElement | null>(null);
  const [ajuste, setAjuste] = useState<{ w: number; h: number; escala: number } | null>(null);

  // Ancho uniforme de cada columna horizontal: nombre distribuido en 2 líneas y, si aplica, bandera+nacionalidad.
  const anchoCol = useMemo(() => {
    if (!matriz || typeof document === "undefined") return 90;
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return 90;
    ctx.font = "900 17px Inter, ui-sans-serif, system-ui, sans-serif";
    let w = 70;
    for (const c of matriz.caballos1) {
      const txt = ctx.measureText(String(c.nombre || "").trim()).width * 1.12;
      w = Math.max(w, Math.ceil(txt / 2) + 14);
      if (banderaNoCasa(c.nacionalidad, matriz.hipodromo)) {
        // Debajo del ejemplar va "(SIGLA)" y la bandera al lado.
        ctx.font = "700 11px Inter, ui-sans-serif, system-ui, sans-serif";
        w = Math.max(w, Math.ceil(ctx.measureText(`(${siglaDe(c.nacionalidad)})`).width + TAM_BANDERA + 14));
        ctx.font = "900 17px Inter, ui-sans-serif, system-ui, sans-serif";
      }
    }
    return w;
  }, [matriz]);

  // Ancho de la columna vertical: número, nombre y país en UNA sola línea
  // (a la derecha del número) y centrados verticalmente, así que el ancho es
  // la SUMA de las tres partes, no el máximo.
  const anchoIzq = useMemo(() => {
    if (!matriz || typeof document === "undefined") return 200;
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return 200;
    ctx.font = "900 17px Inter, ui-sans-serif, system-ui, sans-serif";
    let max = 0;
    for (const c of matriz.caballos2) {
      // Número (24) + hueco + nombre
      let w = 24 + 6 + ctx.measureText(String(c.nombre || "").trim()).width * 1.04;
      if (banderaNoCasa(c.nacionalidad, matriz.hipodromo)) {
        // En una línea, solo la bandera al final (la abreviatura quedó solo en
        // la primera fila): hueco + bandera.
        w += 6 + TAM_BANDERA;
        ctx.font = "900 17px Inter, ui-sans-serif, system-ui, sans-serif";
      }
      max = Math.max(max, w);
    }
    return Math.max(200, Math.ceil(max + 14));
  }, [matriz]);

  // Ajusta la tabla al área visible para nunca tener barras de desplazamiento.
  useEffect(() => {
    if (!matriz || !tablaRef.current || !areaRef.current) return;
    const area = areaRef.current;
    const tabla = tablaRef.current;
    let vivos = 0;
    const medir = () => {
      const f = ++vivos;
      const cw = area.clientWidth;
      const ch = area.clientHeight;
      const nw = tabla.scrollWidth;
      const nh = tabla.scrollHeight;
      if (!cw || !ch || !nw || !nh) return;
      const escala = Math.min(1, cw / nw, ch / nh);
      if (f !== vivos) return;
      setAjuste({ w: nw, h: nh, escala });
    };
    const raf = requestAnimationFrame(medir);
    const ro = new ResizeObserver(medir);
    ro.observe(area);
    document.fonts?.ready?.then(medir).catch(() => undefined);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [matriz, anchoCol, anchoIzq]);
  const [modal, setModal] = useState<{ c1: string; c2: string } | null>(null);
  const [q, setQ] = useState("");
  const [abiertoCli, setAbiertoCli] = useState(false);
  const [precioCelda, setPrecioCelda] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [liquidando, setLiquidando] = useState(false);
  const [selGuardada, setSelGuardada] = useState<string>("");
  const [previewDupleta, setPreviewDupleta] = useState<{ ticket: TicketVentaModel; venta: VentaDupleta } | null>(null);
  const [vendiendoDupleta, setVendiendoDupleta] = useState(false);

  const toast = useCallback((msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));
  }, []);

  useEffect(() => {
    let v = true;
    void listarTablasPublicadas().then((cs) => v && setCarreras(cs));
    void listarDupletasGuardadas().then((gs) => v && setGuardadas(gs));
    void listarClientesVenta().then((cl) => v && setClientes(cl));
    void listarGruposVenta().then((gr) => v && setGrupos(gr));
    return () => {
      v = false;
    };
  }, []);

  // DATA CENTRAL: hipódromos + carreras del día, desde el REGISTRO CENTRAL
  // compartido con Marcas, Gestión y Tablas. Antes Dupletas tenía su propia
  // carga (`listarHipodromos({incluirTodos:true})` + dos `useCarrerasCentrales`),
  // de modo que podía ver hipódromos y carreras distintos de los demás módulos
  // con la misma fecha abierta. Las tablas fijas mandan cuando existen (traen
  // más datos); la central completa lo que no esté publicado.
  const registro = useRegistroCentralOpts(dia);
  const centralTodas = registro.carreras;
  const centralCarreras = registro.carrerasDe(hipodromo);
  const recargarCentrales = registro.recargar;

  /**
   * Hipódromos REGISTRADOS, y solo esos.
   *
   * Antes se armaba la lista con la UNION de las tablas publicadas y el
   * catálogo, así que cualquier hipódromo que hubiera quedado escrito en
   * `tablas_fijas` entraba a la matriz aunque NO estuviera registrado en la
   * tabla `hipodromos` (nombres viejos, con espacios, abreviaturas o erratas).
   *
   * Ahora: los candidatos son los hipódromos que tienen datos (tablas publicadas
   * + carreras centrales) y se intersecan con el catálogo REGISTRADO. Si la
   * intersección queda vacía (catálogo no cargado, o nada del día está
   * registrado) se cae al catálogo completo en vez de inventar nombres.
   *
   * Todo el cruce usa `claveHipodromo`, la misma clave que el Monitor y el
   * registro central. El `norm()` local de antes solo hacía trim+uppercase y
   * dejaba pasar "LA urel" como un hipódromo distinto de "LAUREL".
   */
  const hipodromos = useMemo(() => {
    const catalogo = [...registro.registrados].filter(Boolean).sort((a, b) => a.localeCompare(b));
    if (!dia) return catalogo;
    const conCarreras = new Set<string>();
    for (const c of carreras) {
      if (normalizarDia(c.fecha) === dia) {
        const h = claveHipodromo(c.hipodromo);
        if (h) conCarreras.add(h);
      }
    }
    for (const c of centralTodas) {
      if (normalizarDia(c.fecha) === dia) {
        const h = claveHipodromo(c.hipodromo);
        if (h) conCarreras.add(h);
      }
    }
    // Primero los que tienen carreras del día, después el resto del catálogo.
    const delDia = [...conCarreras].filter((h) => registro.registrados.has(h)).sort((a, b) => a.localeCompare(b));
    const resto = catalogo.filter((h) => !conCarreras.has(h));
    return delDia.length ? [...delDia, ...resto] : catalogo;
  }, [carreras, centralTodas, registro.registrados, dia]);

  // La selección no puede quedar en un hipódromo que ya no está en la lista
  // (por ejemplo, tras cambiar de día o de catálogo).
  useEffect(() => {
    if (!hipodromo || !hipodromos.length) return;
    if (!hipodromos.includes(hipodromo)) setHipodromo(hipodromos[0]);
  }, [hipodromo, hipodromos]);

  // Opciones del buscador: los hipódromos del día (al enfocar se ven todos).
  const hipodromoOpts = useMemo(
    () => (dia ? hipodromos : []).map((h) => ({ value: h, label: h })),
    [hipodromos, dia]
  );

  // Las dupletas guardadas se ofrecen con la misma regla: solo las de
  // hipódromos registrados, para no cargar en la matriz una que no existe.
  const guardadasVisibles = useMemo(() => {
    if (!registro.registrados.size) return guardadas;
    return guardadas.filter((g) => registro.registrados.has(claveHipodromo(g.hipodromo)));
  }, [guardadas, registro.registrados]);

  /** La dupleta guardada elegida en el desplegable, o null si no hay ninguna. */
  const dupletaSeleccionada = useMemo(
    () => (selGuardada ? (guardadasVisibles.find((x) => claveDeDupleta(x) === selGuardada) ?? null) : null),
    [selGuardada, guardadasVisibles]
  );

  /** Elimina la dupleta guardada elegida y limpia la matriz si estaba cargada. */
  const borrarGuardada = async () => {
    const g = dupletaSeleccionada;
    if (!g) return;
    if (!window.confirm(`¿Eliminar la dupleta ${g.hipodromo} C${g.carrera1}×C${g.carrera2} del ${g.fecha}?`)) {
      return;
    }
    const r = await eliminarDupleta(claveDeDupleta(g));
    if (!r.ok) {
      toast(`No se pudo eliminar: ${r.error ?? "sin conexión"}`, "error");
      return;
    }
    toast("🗑️ Dupleta eliminada.", "success");
    setSelGuardada("");
    setGuardadas(await listarDupletasGuardadas());
    if (matriz && claveDeDupleta(matriz) === claveDeDupleta(g)) setMatriz(null);
  };

  /** Carreras de ese día/hipódromo: unión de tabla publicada y carrera central. */
  const carrerasDelDia = useMemo(() => {
    const mapa = new Map<string, TablaFijaRow>();
    for (const c of carreras) {
      if (String(c.hipodromo || "").trim().toUpperCase() !== hipodromo) continue;
      if ((c.fecha || "") !== dia) continue;
      mapa.set(String(c.carrera), c);
    }
    for (const c of centralCarreras) {
      const k = String(c.carrera);
      if (mapa.has(k)) continue;
      mapa.set(k, {
        id: `central-${k}`,
        hipodromo: c.hipodromo,
        carrera: c.carrera,
        fecha: c.fecha,
        distancia_carrera: c.distancia ?? null,
        superficie: c.superficie ?? null,
        premio_original: c.premio ?? null,
        caballos: (c.caballos ?? []).map((cb) => ({
          numero: cb.numero,
          nombre: cb.nombre ?? "",
          nacionalidad: cb.nacionalidad ?? null,
          retirado: Boolean(cb.retirado),
        })),
      });
    }
    return [...mapa.values()].sort((a, b) => (Number(a.carrera) || 0) - (Number(b.carrera) || 0));
  }, [carreras, centralCarreras, hipodromo, dia]);

  const ejemplaresDe = (carrera: string): CaballoDupleta[] => {
    const fila = carrerasDelDia.find((c) => String(c.carrera) === String(carrera));
    const central = centralCarreras.find((c) => String(c.carrera) === String(carrera));
    const lista = (fila?.caballos ?? []) as Array<{
      numero: number | string;
      nombre?: string | null;
      nacionalidad?: string | null;
      retirado?: boolean;
    }>;
    const retiradosCentral = new Set(central?.retirados ?? []);
    return lista
      .map((c) => ({
        numero: String(c.numero ?? ""),
        nombre: String(c.nombre || "").trim().toUpperCase(),
        nacionalidad: c.nacionalidad ?? null,
        retirado: Boolean(c.retirado) || retiradosCentral.has(String(c.numero ?? "")),
      }))
      .filter((c) => c.numero);
  };

  const generar = () => {
    if (!hipodromo) return toast("Elija el hipódromo.", "warning");
    if (!dia) return toast("Elija el día.", "warning");
    if (!carrera1 || !carrera2) return toast("Seleccione las dos carreras de la dupleta.", "warning");
    if (String(carrera1) === String(carrera2)) return toast("Carrera 1 y Carrera 2 deben ser distintas.", "warning");
    const cab1 = ejemplaresDe(carrera1);
    const cab2 = ejemplaresDe(carrera2);
    if (!cab1.length || !cab2.length) return toast("Una de las carreras no tiene ejemplares publicados.", "warning");
    const p = Number(premio) || 0;
    const pr = Number(precio) || 0;
    setMatriz({
      hipodromo: hipodromo.toUpperCase(),
      fecha: dia,
      carrera1: Number(carrera1) || carrera1,
      carrera2: Number(carrera2) || carrera2,
      premio: p,
      precio: pr,
      caballos1: cab1,
      caballos2: cab2,
      celdas: {},
      updatedAt: new Date().toISOString(),
    });
    toast(`✅ Matriz C${carrera1}×C${carrera2} generada: ${cab1.length}×${cab2.length} = ${cab1.length * cab2.length} cuadros.`, "success");
  };

  // Firma de los ejemplares disponibles: si llega la data central (o la tabla
  // publicada) después de elegir las carreras, la matriz se reconstruye.
  const firmaEjemplares = useMemo(
    () =>
      carrerasDelDia
        .map((c) => `${c.carrera}:${(c.caballos ?? []).length}:${(c.caballos ?? []).filter((x) => x.retirado).length}`)
        .join("|"),
    [carrerasDelDia]
  );

  // Auto-genera la matriz apenas eligen las dos carreras (sin pisar una matriz
  // ya generada/guardada con las mismas carreras). Si falta alguna selección,
  // la matriz (columnas/filas) queda en blanco hasta que se elijan las carreras.
  useEffect(() => {
    if (!hipodromo || !dia || !carrera1 || !carrera2) {
      if (matriz) setMatriz(null);
      return;
    }
    if (String(carrera1) === String(carrera2)) return;
    const cab1 = ejemplaresDe(carrera1);
    const cab2 = ejemplaresDe(carrera2);
    if (!cab1.length || !cab2.length) return;
    const misma =
      matriz &&
      matriz.hipodromo === hipodromo.toUpperCase() &&
      matriz.fecha === dia &&
      String(matriz.carrera1) === String(carrera1) &&
      String(matriz.carrera2) === String(carrera2);
    // No se pisa una matriz ya generada con las mismas carreras, salvo que la
    // matriz actual esté vacía (o le falten ejemplares) y ahora haya más data.
    if (misma && matriz.caballos1.length === cab1.length && matriz.caballos2.length === cab2.length) return;
    setMatriz({
      hipodromo: hipodromo.toUpperCase(),
      fecha: dia,
      carrera1: Number(carrera1) || carrera1,
      carrera2: Number(carrera2) || carrera2,
      premio: Number(premio) || 0,
      precio: Number(precio) || 0,
      caballos1: cab1,
      caballos2: cab2,
      celdas: {},
      updatedAt: new Date().toISOString(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hipodromo, dia, carrera1, carrera2, firmaEjemplares]);

  const abrirCelda = (c1: string, c2: string) => {
    if (!matriz) return;
    const celda = matriz.celdas[claveCelda(c1, c2)];
    setPrecioCelda(String(celda?.precio ?? matriz.precio ?? ""));
    setQ(celda?.cliente_nombre ?? "");
    setModal({ c1, c2 });
  };

  const venderCelda = async () => {
    if (!matriz || !modal) return;
    const precioFinal = Number(precioCelda) || matriz.precio || 0;
    if (!(precioFinal > 0)) return toast("El precio del cuadro debe ser mayor a cero.", "warning");
    const nombre = q.trim().toUpperCase();
    if (!nombre) return toast("Escriba o busque el nombre del cliente.", "warning");
    const cliente = clientes.find((cl) => cl.nombre.toUpperCase() === nombre);
    if (!cliente) return toast("Seleccione un cliente de la lista.", "warning");
    // El grupo se deduce del cliente, no se elige suelto: es lo que fija la
    // moneda y el convenio de comision de la venta.
    const gid = cliente.grupo_id ?? cliente.grupos?.[0] ?? null;
    const grupo = grupos.find((g) => String(g.id) === String(gid));
    if (!grupo) return toast(`El cliente ${cliente.nombre} no tiene grupo de venta asignado.`, "warning");

    const cb1 = matriz.caballos1.find((c) => String(c.numero) === modal.c1);
    const cb2 = matriz.caballos2.find((c) => String(c.numero) === modal.c2);
    const saldo = Number(cliente.saldo_actual ?? 0);
    const bq = (await listarBanquerosGrupo(grupo.id)).find(
      (b) => b.modalidad === "DUPLETA" && b.activo !== false && b.banquero_cliente_id
    );
    setAbiertoCli(false);
    setPreviewDupleta({
      venta: {
        hipodromo: matriz.hipodromo,
        fecha: matriz.fecha,
        carrera1: matriz.carrera1,
        carrera2: matriz.carrera2,
        numero1: modal.c1,
        numero2: modal.c2,
        monto: precioFinal,
        clienteId: String(cliente.id),
        grupoId: String(grupo.id),
        premio: matriz.premio,
        idempotencia: claveIdempotenciaDupleta(),
      },
      ticket: {
        modalidad: "DUPLETA",
        hipodromo: matriz.hipodromo,
        fecha: matriz.fecha,
        carrera: matriz.carrera1,
        titulo: `DUPLETA ${modal.c1} × ${modal.c2} · C${matriz.carrera1} × C${matriz.carrera2}`,
        detalle: `${cb1?.nombre ?? ""} × ${cb2?.nombre ?? ""}`,
        jugador: cliente.nombre,
        grupo: grupo.nombre,
        monto: precioFinal,
        moneda: grupo.moneda ?? "USD",
        pago: matriz.premio,
        saldoAntes: saldo,
        saldoDespues: saldo - precioFinal,
        banquero: bq?.banquero_nombre ?? null,
        banqueroCobra: bq?.cobra_comision ?? false,
        banqueroComision: bq?.comision_porcentaje ?? null,
        banqueroBase: bq?.comision_base ?? null,
      },
    });
  };

  const confirmarVentaDupleta = async () => {
    if (!previewDupleta || !matriz) return;
    setVendiendoDupleta(true);
    const r = await venderDupleta(previewDupleta.venta);
    setVendiendoDupleta(false);
    if (!r.ok) return toast(r.error ?? "No se pudo registrar la jugada.", "error");

    const { numero1, numero2, monto, clienteId, grupoId } = previewDupleta.venta;
    const cliente = clientes.find((c) => String(c.id) === String(clienteId));
    const grupo = grupos.find((g) => String(g.id) === String(grupoId));
    const nuevo: DupletaEstado = {
      ...matriz,
      updatedAt: new Date().toISOString(),
      celdas: {
        ...matriz.celdas,
        [claveCelda(numero1, numero2)]: {
          vendida: true,
          cliente_id: clienteId,
          cliente_nombre: cliente?.nombre ?? previewDupleta.ticket.jugador,
          grupo_id: grupoId,
          grupo_nombre: grupo?.nombre ?? null,
          precio: monto,
          ticket_id: r.ticketId ?? null,
        },
      },
    };
    setMatriz(nuevo);
    // La combinación queda CERRADA con su ticket y se persiste sola: al
    // recargar, la venta SIEMPRE aparece (no hay que acordarse de "Guardar").
    const g = await guardarDupleta(nuevo);
    toast(
      `Vendido ${cliente?.nombre ?? ""} · ${grupo?.nombre ?? ""} · $${monto.toLocaleString("es-VE", { maximumFractionDigits: 2 })} · ticket #${r.ticketId ?? "?"} creado.`,
      "success"
    );
    if (!g.ok) toast(`⚠️ La venta quedó, pero no se pudo persistir la matriz: ${g.error ?? "sin conexión"}`, "warning");
    else setGuardadas(await listarDupletasGuardadas());
    setPreviewDupleta(null);
    setModal(null);
    setQ("");
  };

  /**
   * Reasigna el JUGADOR de una combinación ya vendida. No se revende: se cambia
   * de dueño. La RPC devuelve el monto al anterior, cobra al nuevo y transfiere
   * el ticket. El nuevo debe pertenecer al mismo grupo de la venta.
   */
  const editarJugador = async () => {
    if (!matriz || !modal) return;
    const clave = claveCelda(modal.c1, modal.c2);
    const celda = matriz.celdas[clave];
    if (!celda?.vendida) return toast("Esa combinación no está vendida.", "warning");
    const nombre = q.trim().toUpperCase();
    if (!nombre) return toast("Escriba o busque el nombre del cliente.", "warning");
    const cliente = clientes.find((cl) => cl.nombre.toUpperCase() === nombre);
    if (!cliente) return toast("Seleccione un cliente de la lista.", "warning");
    if (String(cliente.id) === String(celda.cliente_id)) return toast("Ese ya es el jugador de la combinación.", "info");
    if (!celda.ticket_id)
      return toast("Esta venta no tiene ticket asociado: no se puede reasignar. Anulala y vendé de nuevo.", "error");
    setVendiendoDupleta(true);
    const r = await reasignarJugadorDupleta({ ticketId: celda.ticket_id, clienteId: String(cliente.id) });
    setVendiendoDupleta(false);
    if (!r.ok) return toast(r.error ?? "No se pudo cambiar el jugador.", "error");
    const nuevo: DupletaEstado = {
      ...matriz,
      updatedAt: new Date().toISOString(),
      celdas: {
        ...matriz.celdas,
        [clave]: { ...celda, cliente_id: cliente.id, cliente_nombre: cliente.nombre },
      },
    };
    setMatriz(nuevo);
    const g = await guardarDupleta(nuevo);
    toast(`👤 Jugador actualizado: ${cliente.nombre}.`, "success");
    if (!g.ok) toast(`⚠️ Cambió el jugador, pero no se pudo persistir: ${g.error ?? "sin conexión"}`, "warning");
    else setGuardadas(await listarDupletasGuardadas());
    setModal(null);
    setQ("");
  };

  /** Anula una combinación vendida: devuelve el monto y libera el cuadro. */
  const quitarVenta = async () => {
    if (!matriz || !modal) return;
    const clave = claveCelda(modal.c1, modal.c2);
    const celda = matriz.celdas[clave];
    if (!celda?.vendida) return;
    if (celda.ticket_id) {
      setVendiendoDupleta(true);
      const r = await anularDupleta({ ticketId: celda.ticket_id, motivo: "Anulada desde Dupleta" });
      setVendiendoDupleta(false);
      if (!r.ok) return toast(r.error ?? "No se pudo anular la venta.", "error");
    }
    const celdas = { ...matriz.celdas };
    delete celdas[clave];
    const nuevo: DupletaEstado = { ...matriz, updatedAt: new Date().toISOString(), celdas };
    setMatriz(nuevo);
    const g = await guardarDupleta(nuevo);
    toast("Venta anulada y monto devuelto.", "info");
    if (!g.ok) toast(`⚠️ Se anuló, pero no se pudo persistir: ${g.error ?? "sin conexión"}`, "warning");
    else setGuardadas(await listarDupletasGuardadas());
    setModal(null);
    setQ("");
  };

  /**
   * Marca/quita el retirado en la matriz. El retiro es de la CARRERA, no de la
   * dupleta: se registra también en la data central para que incida en todos
   * los módulos (Tablas Fijas, Taquilla, Carreras del Día).
   */
  const toggleRetirado = async (eje: 1 | 2, numero: string) => {
    if (!matriz) return;
    const lista = (eje === 1 ? matriz.caballos1 : matriz.caballos2).map((c) => ({ ...c }));
    const i = lista.findIndex((c) => String(c.numero) === String(numero));
    if (i === -1) return;
    const ahoraRetirado = !lista[i].retirado;
    lista[i] = { ...lista[i], retirado: ahoraRetirado };
    setMatriz({ ...matriz, [eje === 1 ? "caballos1" : "caballos2"]: lista });

    const carrera = eje === 1 ? matriz.carrera1 : matriz.carrera2;
    const r = await alternarRetiroCarrera({
      fecha: matriz.fecha,
      hipodromo: matriz.hipodromo,
      carrera,
      numero,
      retirado: ahoraRetirado,
    });
    if (!r.ok) {
      toast(`⚠️ Retiro local aplicado, pero no se centralizó: ${r.error ?? "sin conexión"}`, "warning");
      return;
    }
    toast(
      ahoraRetirado
        ? `⛔ ${numero} retirado de C${carrera} — centralizado (${r.tablasAfectadas} tabla(s) sincronizada(s)${r.reembolsos ? `, ${r.reembolsos} ticket(s) reembolsado(s)` : ""}).`
        : `↩ ${numero} rehabilitado en C${carrera} — centralizado.`,
      "success"
    );
    void recargarCentrales();
  };

  const guardar = async () => {
    if (!matriz) return toast("Genere la matriz antes de guardar.", "warning");
    setGuardando(true);
    const r = await guardarDupleta({ ...matriz, updatedAt: new Date().toISOString() });
    setGuardando(false);
    if (r.ok) {
      toast(`💾 Dupleta ${matriz.hipodromo} C${matriz.carrera1}×C${matriz.carrera2} guardada en Supabase.`, "success");
      setGuardadas(await listarDupletasGuardadas());
    } else {
      toast(`Error al guardar: ${r.error}. Ejecute sql/crear_tabla_dupletas.sql`, "error");
    }
  };

  const liquidar = async () => {
    if (!matriz) return toast("Genere la matriz antes de liquidar.", "warning");
    setLiquidando(true);
    const r = await liquidarDupleta({
      hipodromo: matriz.hipodromo,
      fecha: matriz.fecha,
      carrera1: matriz.carrera1,
      carrera2: matriz.carrera2,
    });
    setLiquidando(false);
    if (!r.ok) return toast(r.error ?? "No se pudo liquidar la dupleta.", "error");
    toast(
      `Liquidada ${matriz.hipodromo} C${matriz.carrera1}×C${matriz.carrera2}: ${r.ganadores ?? 0} ganadores, ${r.perdedores ?? 0} perdedores, ${r.anulados ?? 0} anulados · pagado $${(r.pagado ?? 0).toLocaleString("es-VE", { maximumFractionDigits: 2 })}.`,
      "success"
    );
  };

  const celdaModal = matriz && modal ? matriz.celdas[claveCelda(modal.c1, modal.c2)] : undefined;
  const editandoCelda = Boolean(celdaModal?.vendida);
  const clienteFiltrados = useMemo(() => {
    const t = q.trim().toUpperCase();
    let base = clientes;
    // Al reasignar solo se ofrecen clientes del MISMO grupo de la venta: el
    // convenio (moneda/comisión/banquero) queda congelado en el ticket.
    if (celdaModal?.vendida && celdaModal.grupo_id != null) {
      base = base.filter(
        (c) => String(c.grupo_id ?? c.grupos?.[0] ?? "") === String(celdaModal.grupo_id)
      );
    }
    if (!t) return base;
    return base.filter((c) => c.nombre.toUpperCase().includes(t));
  }, [clientes, q, celdaModal?.vendida, celdaModal?.grupo_id]);

  const vendidas = matriz ? Object.values(matriz.celdas).filter((c) => c.vendida) : [];
  const totalVentas = vendidas.reduce((a, c) => a + (c.precio ?? matriz?.precio ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-line bg-surface p-3">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-600">🎯 Dupleta — Matriz de apuestas cruzadas</h3>

        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          <label
            className="flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-black uppercase text-slate-600"
            title="Jornada: filtra los hipódromos registrados ese día (formato ISO)."
          >
            📅
            <input
              type="date"
              autoFocus
              value={dia}
              onChange={(e) => { setDia(e.target.value); setHipodromo(""); setCarrera1(""); setCarrera2(""); }}
              className="bg-transparent text-xs font-bold text-slate-700 outline-none"
            />
          </label>

          <div className="block min-w-[220px]">
            <span className={inputLbl}>2 · Hipódromo</span>
            <SearchableSelect
              options={hipodromoOpts}
              value={hipodromo}
              onChange={(v) => { setHipodromo(v); setCarrera1(""); setCarrera2(""); }}
              placeholder={dia ? "Buscar hipódromo…" : "Elija el día primero"}
              allowCustom={false}
              inputClassName={inputSel}
            />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50/40 p-2">
            <span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-indigo-700">
              <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-indigo-600 text-[10px] leading-none text-white">→</span>
              3 · Carrera 1 · horizontal
            </span>
            {!hipodromo ? (
              <p className="text-[10px] font-bold uppercase text-slate-400">Elija el hipódromo</p>
            ) : carrerasDelDia.length === 0 ? (
              <p className="text-[10px] font-bold uppercase text-slate-400">Sin carreras del día</p>
            ) : (
              <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(2.75rem, 1fr))" }}>
                {carrerasDelDia.filter((c) => String(c.carrera) !== String(carrera2)).map((c) => {
                  const num = String(c.carrera);
                  const activa = carrera1 === num;
                  return (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setCarrera1(num)}
                      title={`Carrera ${num}`}
                      className={`inline-flex h-7 w-full items-center justify-center rounded-lg border text-[11px] font-black tabular-nums tracking-wide transition-all ${activa ? "border-indigo-600 bg-indigo-600 text-white shadow-sm" : "border-indigo-200 bg-white text-indigo-700 hover:border-indigo-400 hover:bg-indigo-100"}`}
                    >
                      C{num}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-xl border-2 border-violet-200 bg-violet-50/40 p-2">
            <span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-violet-700">
              <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-violet-600 text-[10px] leading-none text-white">↓</span>
              4 · Carrera 2 · vertical
            </span>
            {!hipodromo ? (
              <p className="text-[10px] font-bold uppercase text-slate-400">Elija el hipódromo</p>
            ) : carrerasDelDia.length === 0 ? (
              <p className="text-[10px] font-bold uppercase text-slate-400">Sin carreras del día</p>
            ) : (
              <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(2.75rem, 1fr))" }}>
                {carrerasDelDia.filter((c) => String(c.carrera) !== String(carrera1)).map((c) => {
                  const num = String(c.carrera);
                  const activa = carrera2 === num;
                  return (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setCarrera2(num)}
                      title={`Carrera ${num}`}
                      className={`inline-flex h-7 w-full items-center justify-center rounded-lg border text-[11px] font-black tabular-nums tracking-wide transition-all ${activa ? "border-violet-600 bg-violet-600 text-white shadow-sm" : "border-violet-200 bg-white text-violet-700 hover:border-violet-400 hover:bg-violet-100"}`}
                    >
                      C{num}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1.5">
          <label className="block">
            <span className={inputLbl}>💵 Premio (PAGA X)</span>
            <input type="number" value={premio} onChange={(e) => setPremio(e.target.value)} placeholder="200" className={inputMonto} />
          </label>
          <label className="block">
            <span className={inputLbl}>Precio por cuadro</span>
            <input type="number" value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="10" className={inputMonto} />
          </label>
          <Button variant="default" size="md" onClick={generar}>🧮 Generar Matriz</Button>
          <Button variant="success" size="md" onClick={() => void guardar()} disabled={guardando || !matriz}>
            {guardando ? "Guardando…" : "💾 Guardar en Supabase"}
          </Button>
          <Button
            variant="danger"
            size="md"
            onClick={() => void liquidar()}
            disabled={liquidando || !matriz || vendidas.length === 0}
            title={vendidas.length === 0 ? "No hay celdas vendidas para liquidar." : "Paga ganadores y anula retiros según las dos carreras."}
          >
            {liquidando ? "Liquidando…" : "🧮 Liquidar dupleta"}
          </Button>
          <label className="block min-w-[220px]">
            <span className={inputLbl}>Dupletas guardadas</span>
            <select
              className={inputSel}
              value={selGuardada}
              onChange={(e) => {
                const val = e.target.value;
                setSelGuardada(val);
                const g = guardadasVisibles.find((x) => claveDeDupleta(x) === val);
                if (g) {
                  setMatriz(g);
                  setHipodromo(g.hipodromo);
                  setDia(g.fecha);
                  setCarrera1(String(g.carrera1));
                  setCarrera2(String(g.carrera2));
                  setPremio(String(g.premio ?? ""));
                  setPrecio(String(g.precio ?? ""));
                  toast(`📂 Cargada ${g.hipodromo} C${g.carrera1}×C${g.carrera2}.`, "info");
                }
              }}
            >
              <option value="">— cargar —</option>
              {guardadasVisibles.map((g) => (
                <option key={claveDeDupleta(g)} value={claveDeDupleta(g)}>
                  {g.hipodromo} · {g.fecha} · C{g.carrera1}×C{g.carrera2} ·{" "}
                  {Object.values(g.celdas).filter((c) => c.vendida).length} ventas
                </option>
              ))}
            </select>
          </label>
          {/* Borrar va en un botón propio, no en opciones del mismo desplegable:
              antes "🗑️ Eliminar ..." vivía dentro de la lista y el `onChange`
              tenía que adivinar por el prefijo "DEL:" si estaba cargando o
              borrando. Con la lista cargada, un clic en la opción de borrar
              salía como una dupleta más y no pasaba nada. */}
          <Button
            variant="danger"
            size="md"
            disabled={!dupletaSeleccionada}
            title={dupletaSeleccionada ? `Eliminar ${dupletaSeleccionada.hipodromo} C${dupletaSeleccionada.carrera1}×C${dupletaSeleccionada.carrera2}` : "Elegí una dupleta guardada"}
            onClick={() => void borrarGuardada()}
          >
            🗑️ Eliminar
          </Button>
        </div>
      </div>

      {matriz && (
        <div className="rounded-2xl border border-line bg-surface p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-700">
              {matriz.hipodromo} · {matriz.fecha} · Carrera {matriz.carrera1} × Carrera {matriz.carrera2} — PAGA {matriz.premio.toLocaleString("es-VE")}
            </h4>
            <span className="flex items-center gap-2">
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-black text-orange-700">
                🧾 {vendidas.length} cuadro(s) vendido(s) · {totalVentas.toLocaleString("es-VE", { maximumFractionDigits: 2 })}
              </span>
              <Button variant="default" size="sm" onClick={() => void exportarMatriz("PNG")} className="!bg-indigo-600 hover:!bg-indigo-500">🖼️ PNG</Button>
              <Button variant="outline" size="sm" onClick={() => void exportarMatriz("PDF")}>📄 PDF</Button>
            </span>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-line bg-white shadow-sm" style={{ height: "calc(100vh - 300px)" }}>
            <div ref={areaRef} className="absolute inset-0 flex items-start justify-start">
              <div style={ajuste ? { width: Math.round(ajuste.w * ajuste.escala), height: Math.round(ajuste.h * ajuste.escala), transform: `scale(${ajuste.escala})`, transformOrigin: "top left" } : undefined}>
                <table ref={tablaRef} className="min-w-max border-separate border-spacing-0 text-[10px] leading-tight">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-40 min-w-[120px] border-b border-r border-slate-300 bg-indigo-600 p-1 text-left align-top text-[9px] font-black text-white" style={{ verticalAlign: "top" }}>
                    <span className="block">DUPLETA</span>
                    <span className="block text-[14px] text-emerald-300">PAGA {matriz.premio.toLocaleString("es-VE")}</span>
                    <span className="mt-0.5 block text-[7px] font-bold uppercase leading-tight text-indigo-200">
                      <span className="block">→ Carrera {matriz.carrera1} (horizontal)</span>
                      <span className="block">↓ Carrera {matriz.carrera2} (vertical)</span>
                    </span>
                    <span className="mt-0.5 block text-[7px] font-bold uppercase text-indigo-200">clic en ejemplar = retira</span>
                  </th>
                  {matriz.caballos1.map((cb, i1) => {
                    const col = colorDeNumeroGac(cb.numero);
                    return (
                      <th key={`h1-${cb.numero}`} className={`sticky top-0 z-30 border-b border-r border-slate-300 p-0.5 align-top ${i1 % 2 ? "bg-indigo-700" : "bg-indigo-600"}`} style={{ width: anchoCol, maxWidth: anchoCol, verticalAlign: "top" }}>
                        <button
                          type="button"
                          onClick={() => toggleRetirado(1, cb.numero)}
                          title={cb.retirado ? "Quitar retirado" : "Marcar retirado"}
                          className={`flex w-full flex-col items-center justify-start self-start rounded px-0.5 pt-0.5 pb-1 ${cb.retirado ? "bg-yellow-400 text-slate-900" : "text-white"}`}
                        >
                          <span className="flex items-center justify-center gap-1">
                            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[14px] font-black" style={{ backgroundColor: col.bg, color: col.fg }}>
                              {cb.numero}
                            </span>
                            {cb.retirado && <span className="text-[13px] font-black">✖</span>}
                          </span>
                          <span className="block break-words text-[17px] font-black leading-tight" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                            {cb.nombre}
                          </span>
                          {banderaNoCasa(cb.nacionalidad, matriz.hipodromo) && (
                            <span className="mt-0.5 flex items-center justify-center gap-1 whitespace-nowrap text-[11px] font-bold leading-none text-indigo-100">
                              <span>({siglaDe(cb.nacionalidad)})</span>
                              <Flag nac={cb.nacionalidad} size={TAM_BANDERA} withName={false} />
                            </span>
                          )}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {matriz.caballos2.map((cb2, i2) => {
                  const izq = colorDeNumeroGac(cb2.numero);
                  return (
                    <tr key={`f-${cb2.numero}`}>
                      <th
                        className={`sticky left-0 z-20 border-b border-r border-slate-300 p-0.5 align-middle text-left ${FONDO_FILA_DUPLA[i2 % FONDO_FILA_DUPLA.length]}`}
                        style={{ width: anchoIzq, maxWidth: anchoIzq, verticalAlign: "middle" }}
                      >
                        <button
                          type="button"
                          onClick={() => toggleRetirado(2, cb2.numero)}
                          title={cb2.retirado ? "Quitar retirado" : "Marcar retirado"}
                          className={`flex w-full items-center gap-1.5 self-center rounded px-1 py-1 text-left align-middle ${cb2.retirado ? "bg-yellow-400 text-slate-900" : "text-slate-800"}`}
                        >
                          <span className="flex shrink-0 items-center gap-0.5">
                            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[14px] font-black" style={{ backgroundColor: izq.bg, color: izq.fg }}>
                              {cb2.numero}
                            </span>
                            {cb2.retirado && <span className="text-[13px] font-black">✖</span>}
                          </span>
                          <span className="min-w-0 flex-1 truncate whitespace-nowrap text-[17px] font-black leading-none">
                            {cb2.nombre}
                          </span>
                          {banderaNoCasa(cb2.nacionalidad, matriz.hipodromo) && (
                            <Flag nac={cb2.nacionalidad} size={TAM_BANDERA} withName={false} />
                          )}
                        </button>
                      </th>
                      {matriz.caballos1.map((cb1, i1) => {
                        const bloqueada = cb1.retirado || cb2.retirado;
                        const celda = matriz.celdas[claveCelda(cb1.numero, cb2.numero)];
                        const mezcla = !bloqueada && !celda?.vendida && (i1 + i2) % 2 === 1;
                        return (
                          <td key={`c-${cb1.numero}-${cb2.numero}`} className={`w-[72px] min-w-[72px] border-b border-r border-slate-400 p-0.5 ${bloqueada ? "bg-slate-200" : celda?.vendida ? "bg-orange-400" : mezcla ? "bg-slate-100" : "bg-white"}`}>
                            {bloqueada ? (
                              <div className="flex h-12 items-center justify-center px-0.5 text-center text-[11px] font-black leading-none tracking-tight text-slate-600">
                                RETIRADO
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => abrirCelda(cb1.numero, cb2.numero)}
                                title={`${cb1.nombre} × ${cb2.nombre}`}
                                className={`block h-12 w-full text-center transition-colors ${mezcla ? "hover:bg-indigo-50" : "hover:bg-indigo-100"} ${celda?.vendida ? "text-slate-900" : "text-slate-600"}`}
                              >
                                <span className="block text-[18px] font-black leading-none">
                                  {celda?.vendida ? (celda.precio ?? matriz.precio).toLocaleString("es-VE", { maximumFractionDigits: 2 }) : matriz.precio.toLocaleString("es-VE", { maximumFractionDigits: 2 })}
                                </span>
                                <span className="block truncate text-[11px] font-bold leading-tight">{celda?.vendida ? (celda.cliente_nombre || "—") : "clic ▼"}</span>
                                {celda?.vendida && celda.grupo_nombre ? (
                                  <span className="block truncate text-[9px] font-bold uppercase leading-tight text-violet-600">
                                    {celda.grupo_nombre}
                                  </span>
                                ) : null}
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
              </table>
              </div>
            </div>
          </div>

          <p className="mt-2 text-[10px] italic text-slate-500">
            💡 Las filas/columnas amarillas o grises corresponden a ejemplares retirados y no se venden (RETIRADO). Cada cuadro se vende con un clic; la dupleta se guarda en la tabla `dupletas` de Supabase y se recarga en cualquier sesión.
          </p>

          <div className="mt-2 rounded-lg border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-[10px] font-semibold leading-relaxed text-amber-900">
            <p>⚠️ Nota marginal — Retiro en la carrera: si un ejemplar se retira, su incidencia sobre el monto a pagar se recalcula porcentualmente.</p>
            <p>🔁 Retiros y resultados unificados: el retiro/resultado de un ejemplar incide en TODAS las jugadas que lo incluyan: dupletas, remates, tablas y puestos.</p>
          </div>
        </div>
      )}

      {modal && matriz && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" onClick={() => setModal(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h4 className="mb-1 text-sm font-black uppercase text-slate-800">
              {editandoCelda ? "Editar jugador de la combinación" : "Venta de Combinación"}
            </h4>
            <p className="mb-2 text-xs font-bold text-slate-500">
              {matriz.caballos1.find((c) => String(c.numero) === modal.c1)?.nombre} × {matriz.caballos2.find((c) => String(c.numero) === modal.c2)?.nombre}
            </p>
            {editandoCelda && (
              <p className="mb-3 rounded-lg border border-orange-300 bg-orange-50 px-2 py-1.5 text-[10px] font-semibold leading-snug text-orange-900">
                🔒 Combinación ya vendida. No se revende: cambiá el jugador (se devuelve el monto al anterior y se
                cobra al nuevo) o anulá la venta.
              </p>
            )}

            <label className="mb-2 block">
              <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Cliente</span>
              <div className="relative">
                <input
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setAbiertoCli(true); }}
                  onFocus={() => setAbiertoCli(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setAbiertoCli(false);
                  }}
                  placeholder="Buscar cliente…"
                  className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-bold uppercase text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                />
                {abiertoCli && clienteFiltrados.length > 0 && (
                  <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-44 overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-xl">
                    {clienteFiltrados.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); setQ(c.nombre); setAbiertoCli(false); }}
                          className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[11px] font-semibold uppercase text-slate-700 transition-colors hover:bg-primary-500/10"
                        >
                          <span className="truncate">{c.nombre}</span>
                          <span className="ml-2 shrink-0 text-[9px] font-black text-slate-400">${saldoDe(c)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </label>

            <label className="mb-4 block">
              <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Precio del cuadro</span>
              <input
                type="number"
                value={precioCelda}
                disabled={editandoCelda}
                onChange={(e) => setPrecioCelda(e.target.value)}
                placeholder={`${matriz.precio}`}
                className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-right text-xs font-black text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50"
              />
              {editandoCelda && (
                <span className="mt-1 block text-[10px] font-semibold text-slate-400">
                  El monto no cambia al reasignar el jugador.
                </span>
              )}
            </label>

            <div className="flex flex-wrap gap-2">
              {editandoCelda ? (
                <>
                  <Button
                    variant="success"
                    size="md"
                    className="flex-1"
                    disabled={vendiendoDupleta}
                    onClick={() => void editarJugador()}
                  >
                    {vendiendoDupleta ? "Guardando…" : "👤 Guardar jugador"}
                  </Button>
                  <Button variant="danger" size="md" disabled={vendiendoDupleta} onClick={() => void quitarVenta()}>
                    ✖ Anular venta
                  </Button>
                </>
              ) : (
                <Button variant="success" size="md" className="flex-1" onClick={() => void venderCelda()}>
                  💸 Vender
                </Button>
              )}
              <Button variant="ghost" size="md" onClick={() => { setModal(null); setQ(""); }}>Cerrar</Button>
            </div>
          </div>
        </div>
      )}

      <TicketVentaPreview
        abierto={previewDupleta !== null}
        ticket={previewDupleta?.ticket ?? null}
        confirmando={vendiendoDupleta}
        onCorregir={() => setPreviewDupleta(null)}
        onConfirmar={() => void confirmarVentaDupleta()}
      />

      <ToastHost />
    </div>
  );

  /**
   * Saldo del cliente en el selector de la matriz.
   *
   * Muestra el saldo EN MANO, que es lo que se le debe al banco, pero añade el
   * disponible cuando hay aval: un cliente en mora con aval no está tan
   * bloqueado como parece, y si el caja solo ve "-300" topsa toda jugada sin
   * ver que tiene $300 de crédito autorizado.
   */
  function saldoDe(c: ClienteVenta): string {
    const s = c.saldo_actual != null ? Number(c.saldo_actual) : 0;
    const aval = c.aval != null ? Number(c.aval) : 0;
    const fmt = (n: number) => n.toLocaleString("es-VE", { maximumFractionDigits: 2 });
    if (esClienteLibre(c)) return `libre`;
    if (aval > 0) return `${fmt(s)} · disp ${fmt(s + aval)}`;
    return fmt(s);
  }

  /** Exporta la matriz en UNA hoja horizontal (A4 paisaje): pdf o png. */
  async function exportarMatriz(formato: ImgFormato) {
    if (!matriz || !tablaRef.current) return;
    const tabla = tablaRef.current;
    let root: HTMLDivElement | null = null;
    try {
      // medidas naturales de la `<table>` (todo el contenido, sin scroll).
      const natW = tabla.scrollWidth;
      const natH = tabla.scrollHeight;

      // Hoja A4 paisaje @150dpi (210×148 mm) con cabecera y nota marginal.
      const PAGE_W = A4_PAISAGE.w;
      const PAGE_H = A4_PAISAGE.h;
      const PAD = 28;
      const FONDO = 58;
      const NOTA = 34;
      const areaW = PAGE_W - PAD * 2;
      const areaH = PAGE_H - PAD * 2 - FONDO - NOTA;
      // La tabla NO se reduce con `transform:scale()` (html2canvas no escala el
      // texto de forma coherente con el ancestro escalado y lo deja cortado).
      // Se captura a tamaño natural y se reduce al componer el lienzo A4.
      const escala = Math.min(areaW / natW, areaH / natH, 1);

      root = document.createElement("div");
      root.style.cssText = "position:absolute;left:-99999px;top:0;z-index:-1;";

      const header = document.createElement("div");
      header.style.cssText = `width:${areaW}px;height:${FONDO}px;display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:12px;`;
      const titulo = document.createElement("div");
      titulo.style.cssText =
        "width:60px;height:60px;background:#4f46e5;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:15px;line-height:1.4em;letter-spacing:0.06em;";
      titulo.textContent = "DUPLETA";
      const info = document.createElement("div");
      info.style.cssText = "flex:1;min-width:0;font-family:Inter,ui-sans-serif,system-ui,sans-serif;";
      const infoT = document.createElement("div");
      infoT.style.cssText = "font-size:16px;font-weight:800;text-transform:uppercase;letter-spacing:0.02em;color:#0f172a;line-height:1.4em;";
      infoT.textContent = `${matriz.hipodromo} · ${matriz.fecha} · Carrera ${matriz.carrera1} × Carrera ${matriz.carrera2}`;
      const infoS = document.createElement("div");
      infoS.style.cssText = "font-size:12px;font-weight:700;color:#64748b;margin-top:3px;line-height:1.4em;";
      infoS.textContent = `PAGA ${matriz.premio.toLocaleString("es-VE")} · ${vendidas.length} cuadro(s) vendido(s) · ${totalVentas.toLocaleString("es-VE", { maximumFractionDigits: 2 })}`;
      info.append(infoT, infoS);
      header.append(titulo, info);

      // Caja de la tabla a TAMAÑO NATURAL: sin transform, sin overflow:hidden.
      const tablaBox = document.createElement("div");
      tablaBox.style.cssText = `width:${natW}px;height:${natH}px;overflow:visible;background:#fff;line-height:1.4em;`;
      const clon = tabla.cloneNode(true) as HTMLElement;
      clon.style.width = `${natW}px`;
      tablaBox.appendChild(clon);

      const nota = document.createElement("div");
      nota.style.cssText = `width:${areaW}px;min-height:${NOTA}px;border-left:3px solid #f59e0b;background:#fffbeb;padding:5px 8px;font-family:Inter,ui-sans-serif,system-ui,sans-serif;font-size:8px;font-weight:700;color:#b45309;line-height:1.5em;`;
      nota.innerHTML =
        "NOTA MARGINAL — RETIROS: si un ejemplar se retira en la carrera, su incidencia sobre el monto a pagar se recalcula porcentualmente.&nbsp;&nbsp;·&nbsp;&nbsp;El retiro y el resultado de un ejemplar inciden en TODAS las jugadas que lo incluyan: dupletas, remates, tablas y puestos.";

      root.append(header, tablaBox, nota);
      document.body.appendChild(root);

      // Cada pieza se captura sola a tamaño natural (300dpi efectivo).
      const S = 2;
      const cvHeader = await capturarNodo(header, S);
      const cvTabla = await capturarNodo(tablaBox, S);
      const cvNota = await capturarNodo(nota, S);

      const hoja = componerA4Paisaje(
        [
          { canvas: cvHeader, x: PAD, y: PAD, w: areaW, h: FONDO },
          { canvas: cvTabla, x: PAD, y: PAD + FONDO + 12, w: natW * escala, h: natH * escala },
          { canvas: cvNota, x: PAD, y: PAGE_H - PAD - NOTA, w: areaW, h: NOTA },
        ],
        S
      );

      const base = `dupleta_${matriz.hipodromo.replace(/[^a-z0-9]+/gi, "_")}_C${matriz.carrera1}xC${matriz.carrera2}`;
      await guardarLienzos([hoja], formato, base, true);
      root.remove();
    } catch {
      root?.remove?.();
      toast("No se pudo exportar la dupleta.", "error");
    }
  }
}

export default DupletaModule;