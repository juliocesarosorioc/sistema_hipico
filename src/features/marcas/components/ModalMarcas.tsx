"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/shared/components/ui/Button";
import { TicketVentaPreview, type TicketVentaModel } from "@/features/tickets/components/TicketVentaPreview";
import { nombreHipodromoParaMostrar } from "@/features/hipodromos/lib/nombre";
import { HorseBadge } from "@/shared/components/ui/HorseChips";
import type { CarreraCentral, EjemplarCarreraCentral } from "@/features/carreras/lib/central";
import { listarClientesVenta, listarGruposVenta, grupoDeVentaVigente, esClienteLibre, type ClienteVenta, type GrupoVenta } from "@/features/grupos/lib/grupos";
import { listarBanquerosGrupo } from "@/features/liquidacion/lib/banqueros";
import {
  buscarEjemplar,
  calcularMonto,
  calcularRivales,
  clientesDelGrupo,
  leerConfigMarcas,
  venderMarca,
  claveIdempotencia,
  separarNumeros,
  etiquetaCaballo,
  type ConfigMarcas,
} from "@/features/marcas/lib/marcas";
import { ReporteMarcasJugadasModal } from "@/features/marcas/components/ReporteMarcasJugadasModal";
import { ModalAutorizacionAdmin } from "@/features/seguridad/components/ModalAutorizacionAdmin";
import { verificarCupoMarcaDisponible } from "@/features/marcas/lib/control-riesgo-marcas";
import { SearchableSelect } from "@/shared/components/ui/SearchableSelect";
import { ToggleModalidadTiempo } from "@/features/jugadas/components/ToggleModalidadTiempo";
import { MODALIDAD_POR_DEFECTO, type ModalidadTiempo } from "@/features/jugadas/lib/modalidad-tiempo";
import { marcarTicketsAdelantados } from "@/features/jugadas/lib/marcar-adelantadas";

const inputLbl = "mb-1 block h-3.5 text-[10px] font-bold uppercase leading-none tracking-wide text-slate-500";
const inputCls =
  "w-full h-9 rounded-lg border border-line bg-surface px-3 text-xs font-bold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-slate-400";

/**
 * Solo venta y resultado. La CONFIGURACION de marcas, NV y debutantes vive en su
 * propia ventana (`ModalMarcasEditor`), que administra la jornada completa y no
 * una carrera suelta: abrirla desde la fila de una carrera ataba la
 * configuracion a la pantalla en la que se estaba trabajando.
 */
/**
 * Solo VENTA. La CONFIGURACION de marcas, NV y debutantes vive en su propia
 * ventana (`ModalMarcasEditor`), que administra la jornada completa y no una
 * carrera suelta. El RESULTADO y la liquidación de las marcas YA NO se cargan
 * acá: se centralizaron en el flujo único de resultados (Gestión de Jugadas /
 * Taquilla → `liquidarCarreraYCerrarTabla`), que escribe el orden de llegada en
 * `resultados_carreras` y, acto seguido, liquida las marcas con
 * `club_liquidar_marca`. Así el resultado se carga UNA vez para todos los
 * módulos y no queda un cargador por modalidad.
 */
export type ModalMarcasProps = {
  carrera: CarreraCentral;
  fecha: string;
  onCerrar: () => void;
  onToast: (msg: string, tipo?: "success" | "warning" | "error" | "info") => void;
  /** Se llama tras vender o liquidar, para que el modulo hípico refresque. */
  onCambio?: () => void;
};

/**
 * MODULO MARCAS — dentro del modal del módulo hípico.
 *
 * Se abre desde la fila de la carrera en "Carreras del Día". Este modal solo
 * VENDE: la configuración (MARCAS y NV) vive en `ModalMarcasEditor` y el
 * resultado se carga en el flujo único de liquidación.
 *
 *   VENTA — grupo -> cliente -> caballo -> rival del match -> monto, con la
 *           previsualización del matchup en vivo. El débito y el ticket los
 *           hace `club_vender_marca` en una transacción.
 *
 * La jerarquía se previsualiza aquí pero la VERDAD la calcula el servidor, que
 * vuelve a derivarla de la configuración: si divergieran, la caja vería un
 * matchup y la banca aceptaría otro.
 */
export function ModalMarcas({ carrera, fecha, onCerrar, onToast, onCambio }: ModalMarcasProps) {
  /**
   * La configuracion VIGENTE de la carrera. Este modal no la edita: la lee, para
   * previsualizar el matchup y para saber si la carrera acepta ventas. Se
   * vuelve a leer despues de cada venta y de cada liquidacion.
   */
  const [cfg, setCfg] = useState<ConfigMarcas | null>(null);
  const [cargando, setCargando] = useState(true);

  // Venta
  const [grupos, setGrupos] = useState<GrupoVenta[]>([]);
  const [clientes, setClientes] = useState<ClienteVenta[]>([]);
  const [grupoId, setGrupoId] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [caballo, setCaballo] = useState("");
  /**
   * EL RIVAL DEL MATCH. La jugada es de un caballo contra UN caballo: elegir el
   * caballo no lo pone a pelear contra el resto. Este estado es el que el
   * operador elige del menu de legales, y es lo que viaja al ticket.
   */
  const [rival, setRival] = useState("");
  const [monto, setMonto] = useState("");
  const [vendiendo, setVendiendo] = useState(false);
  const [modalAdminReq, setModalAdminReq] = useState<{
    motivo: string;
    limiteEstablecido?: string | number;
    grupoNombre: string;
    jugadorNombre: string;
    monto: number;
    onAutorizar: (adminUser: string) => Promise<void> | void;
  } | null>(null);
  /**
   * Clave de idempotencia de la jugada en curso. Se genera una sola vez y
   * sobrevive a los reintentos: si la venta falla por red y el operador vuelve
   * a pulsar, la RPC reconoce la clave y NO cobra dos veces. Se renueva al
   * cambiar de cliente, grupo, caballo o monto, porque eso ya es otra jugada.
   */
  const [idem, setIdem] = useState(() => claveIdempotencia());
  const [preview, setPreview] = useState<TicketVentaModel | null>(null);
  const [errorPreview, setErrorPreview] = useState<string | null>(null);
  /** Reporte de marcas jugadas (misma vista que el reporte de Tablas Fijas). */
  const [reporteAbierto, setReporteAbierto] = useState(false);
  /**
   * Modalidad de TIEMPO de la marca que se está cargando: en Marcas arranca por
   * defecto en `ADELANTADA` (`⏳ Jugada Adelantada`, `esAdelantada = true`) salvo
   * que el operador cambie manualmente a `⚡ En Vivo`.
   */
  const [modalidadTiempo, setModalidadTiempo] = useState<ModalidadTiempo>("ADELANTADA");

  const caballos: EjemplarCarreraCentral[] = useMemo(() => carrera.caballos ?? [], [carrera.caballos]);
  const etiqueta = `${nombreHipodromoParaMostrar(carrera.hipodromo)} N${carrera.carrera}`;

  const cargarConfig = useCallback(async () => {
    setCargando(true);
    const c = await leerConfigMarcas(carrera.hipodromo, fecha, carrera.carrera);
    setCfg(c);
    setCargando(false);
  }, [carrera.hipodromo, fecha, carrera.carrera]);

  useEffect(() => {
    void cargarConfig();
  }, [cargarConfig]);

  useEffect(() => {
    void (async () => {
      const [g, c] = await Promise.all([listarGruposVenta(), listarClientesVenta()]);
      setGrupos(g);
      setClientes(c);
      /* Grupo por defecto: el del usuario logueado; si es super administrador
         (que ve varios), el elegido en el filtro «🗂️ Grupo» de la barra
         superior. Solo se autoselecciona si el operador no eligió uno todavía
         y el grupo existe en la lista cargada. */
      setGrupoId((actual) => {
        if (actual) return actual;
        const porDefecto = grupoDeVentaVigente();
        return porDefecto && g.some((x) => String(x.id) === String(porDefecto)) ? porDefecto : actual;
      });
    })();
  }, []);

  // Al cambiar de grupo se limpia el cliente: si se queda el anterior, la venta
  // es de un cliente que no pertenece al grupo elegido.
  useEffect(() => {
    setClienteId("");
  }, [grupoId]);

  const clientesFiltrados = useMemo(() => clientesDelGrupo(clientes, grupoId), [clientes, grupoId]);
  const cliente = useMemo(
    () => clientes.find((c) => String(c.id) === String(clienteId)) ?? null,
    [clientes, clienteId]
  );

  /** Opciones del BUSCADOR de grupo (por nombre): en grupos con muchos no se recorre lista. */
  const opcionesGrupo = useMemo(
    () => grupos.map((g) => ({ value: String(g.id), label: g.nombre })),
    [grupos]
  );
  /** Opciones del BUSCADOR de cliente del grupo (por nombre, con su saldo a la vista). */
  const opcionesCliente = useMemo(
    () =>
      clientesFiltrados.map((c) => ({
        value: String(c.id),
        label: `${c.nombre} · $${Number(c.saldo_actual ?? 0).toFixed(2)}`,
      })),
    [clientesFiltrados]
  );

  /**
   * La jerarquia se deriva de la configuracion GUARDADA, nunca de un borrador
   * local: este modal ya no edita marcas, asi que lo unico que debe previsualizar
   * es lo que la RPC va a derivar de verdad. Los tres textos se pasan por
   * separado (marcas, nv, debutantes) porque la venta necesita que los
   * debutantes con el switch apagado se comporten como NV.
   */
  const marcasGuardadas = useMemo(() => separarNumeros(cfg?.marcas), [cfg?.marcas]);
  const nvGuardadas = useMemo(() => separarNumeros(cfg?.nv), [cfg?.nv]);
  const debutantesGuardados = useMemo(() => separarNumeros(cfg?.debutantes), [cfg?.debutantes]);
  const analisis = useMemo(
    () =>
      calcularRivales(
        caballo,
        marcasGuardadas.join("/"),
        nvGuardadas.join("/"),
        debutantesGuardados.join("/"),
        cfg?.debutantes_valen !== false,
        rival
      ),
    [caballo, marcasGuardadas, nvGuardadas, debutantesGuardados, cfg?.debutantes_valen, rival]
  );

  const jugables = useMemo(
    () =>
      caballos.filter(
        (c) =>
          !c.retirado &&
          calcularRivales(
            c.numero,
            marcasGuardadas.join("/"),
            nvGuardadas.join("/"),
            debutantesGuardados.join("/"),
            cfg?.debutantes_valen !== false
          ).valido
      ),
    [caballos, marcasGuardadas, nvGuardadas, debutantesGuardados, cfg?.debutantes_valen]
  );

  /**
   * Motivo de la lista de "Caballo a jugar": no es un bug que falten caballos.
   * La jerarquía deja FUERA de la venta a la PRIMERA marca (no tiene rivales a su
   * izquierda) y a los NV (y a los debutantes cuando el switch está apagado).
   * Se explicita en pantalla para que el operador no lea la lista como un error
   * de datos — es la misma regla del servidor (`sql/marcas_venta.sql`).
   */
  const marcaBase = marcasGuardadas[0] ?? "";
  const noJugables = useMemo(() => {
    const nv = cfg?.debutantes_valen === false
      ? [...new Set([...nvGuardadas, ...debutantesGuardados])]
      : nvGuardadas;
    const set = new Set<string>(nv);
    if (marcaBase) set.add(marcaBase);
    return [...set];
  }, [marcaBase, nvGuardadas, debutantesGuardados, cfg?.debutantes_valen]);

  /**
   * Cambiar de caballo deja el rival viejo apontando a un numero que puede no
   * ser legal para el nuevo, asi que se suelta. `calcularRivales` cae al
   * primero de la lista mientras tanto, para que el modal nunca muestre un
   * matchup imposible.
   */
  useEffect(() => {
    setRival("");
  }, [caballo]);
  const numeros = useMemo(() => calcularMonto(monto), [monto]);
  /* El tope es saldo + aval (misma regla que la RPC). Un cliente en mora con
     avalTodavia puede comprar hasta donde se lo da el aval, y el saldo queda
     debitado en negativo: eso es la deuda. Un cliente "libre" no topa. */
  const saldo = Number(cliente?.saldo_actual ?? 0);
  const aval = Number(cliente?.aval ?? 0) || 0;
  const disponible = esClienteLibre(cliente) ? Number.POSITIVE_INFINITY : saldo + aval;
  const faltaSaldo = Number(monto) > 0 && disponible < Number(monto);
  const configurada = cfg?.estado === "Abierta";
  /**
   * ¿Esta jugada se está financiando con el aval?
   *
   * Antes comparaba `disponible < monto`, o sea `saldo + aval < monto`, que es
   * exactamente la condición de RECHAZO (`faltaSaldo`). Como `faltaSaldo` bloquea
   * la venta antes de llegar al botón, el aviso "Esta jugada usa el aval" era
   * literalmente inalcanzable: nunca se veía ni una vez.
   *
   * Lo que se quiere decir es "el saldo no alcanza por sí solo, pero el aval
   * salva la jugada": `saldo < monto` y a la vez `disponible >= monto`.
   */
  const jugandoConAval = !esClienteLibre(cliente) && aval > 0 && saldo < Number(monto) && disponible >= Number(monto);

  // =========================================================================
  // VENTA
  // =========================================================================
  const nombreDe = (n: string): string => {
    const ej = buscarEjemplar(caballos, n);
    return ej ? etiquetaCaballo(ej) : `Caballo ${n}`;
  };

  const solicitarVenta = async () => {
    if (!grupoId) return onToast("Seleccione el grupo de venta.", "warning");
    if (!clienteId) return onToast("Seleccione el cliente.", "warning");
    if (!analisis.valido) return onToast(analisis.mensaje, "warning");
    if (!analisis.rival) return onToast("Elija el rival del match.", "warning");
    if (!Number(monto) || Number(monto) <= 0) return onToast("Indique el monto.", "warning");
    if (faltaSaldo) {
      const detalle = esClienteLibre(cliente)
        ? "no tiene saldo suficiente"
        : `tiene ${saldo} de saldo y ${aval} de aval (disponible ${disponible})`;
      return onToast(`Saldo insuficiente: ${cliente?.nombre} ${detalle}.`, "warning");
    }
    const g = grupos.find((x) => String(x.id) === String(grupoId));
    const m = Number(monto);
    const bq = (await listarBanquerosGrupo(grupoId)).find(
      (b) => b.modalidad === "MARCAS" && b.activo !== false && b.banquero_cliente_id
    );
    setErrorPreview(null);
    setPreview({
      modalidad: "MARCAS",
      hipodromo: carrera.hipodromo,
      fecha,
      carrera: carrera.carrera,
      titulo: `MARCA ${caballo} vs ${analisis.rival}`,
      detalle: `${nombreDe(caballo)} vs ${nombreDe(analisis.rival)}`,
      jugador: cliente?.nombre ?? "",
      grupo: g?.nombre ?? null,
      monto: m,
      moneda: "USD",
      pago: numeros.pagoBruto,
      saldoAntes: saldo,
      saldoDespues: saldo - m,
      banquero: bq?.banquero_nombre ?? null,
      banqueroCobra: bq?.cobra_comision ?? false,
      banqueroComision: bq?.comision_porcentaje ?? null,
      banqueroBase: bq?.comision_base ?? null,
    });
  };

  const confirmarVenta = async (autorizadoPorAdmin?: boolean) => {
    if (!analisis.valido || !analisis.rival) return;
    const g = grupos.find((x) => String(x.id) === String(grupoId));

    if (!autorizadoPorAdmin) {
      const cupoCheck = await verificarCupoMarcaDisponible({
        hipodromo: carrera.hipodromo,
        carrera: carrera.carrera,
        fecha,
        caballoNumero: caballo.trim(),
        grupoId,
        grupoNombre: g?.nombre,
        jugadorNombre: cliente?.nombre,
        montoAComprar: Number(monto),
      });

      if (!cupoCheck.permitido) {
        setModalAdminReq({
          motivo: cupoCheck.motivo ?? "La jugada supera el límite establecido para este grupo o la plataforma.",
          limiteEstablecido: cupoCheck.limiteGrupo ? `${cupoCheck.limiteGrupo}` : undefined,
          grupoNombre: g?.nombre ?? `Grupo ${grupoId}`,
          jugadorNombre: cliente?.nombre ?? "Jugador",
          monto: Number(monto),
          onAutorizar: async () => {
            setModalAdminReq(null);
            await confirmarVenta(true);
          },
        });
        return;
      }
    }

    setVendiendo(true);
    setErrorPreview(null);
    const r = await venderMarca({
      hipodromo: carrera.hipodromo,
      carrera: carrera.carrera,
      fecha,
      caballo: caballo.trim(),
      rival: analisis.rival,
      monto: Number(monto),
      clienteId,
      grupoId,
      comisionPorcentaje: g?.comision_marcas ?? g?.comision_default ?? 2.5,
      idempotencia: idem,
    });
    setVendiendo(false);

    if (!r.ok) {
      setErrorPreview(r.error ?? "No se pudo registrar la jugada.");
      return;
    }
    // Modalidad de TIEMPO: si la marca se cargó ADELANTADA se marca el ticket
    // recién creado. La venta ya quedó registrada por la RPC, así que esto es
    // mejor esfuerzo: si el UPDATE no pasa se avisa y no se revierte nada.
    if (modalidadTiempo === "ADELANTADA" && r.ticketId) {
      const marca = await marcarTicketsAdelantados([r.ticketId]);
      if (!marca.ok) {
        onToast(
          `⚠️ Marca vendida, pero sin marcar ⏳ adelantada: ${marca.error ?? "revisá sql/jugadas_adelantadas.sql"}`,
          "warning"
        );
      }
    }
    onToast(
      `✅ MARCA ${caballo} contra ${analisis.rival} por $${Number(monto)} · paga $${r.pagoBruto ?? numeros.pagoBruto} · saldo $${r.saldoRestante ?? 0}`,
      "success"
    );
    setPreview(null);
    setMonto("");
    setCaballo("");
    setRival("");
    onCambio?.();
    // Emitido el ticket, la venta se cierra y se vuelve a la lista de Marcas:
    // la jugada ya quedo registrada, no hay nada mas que hacer aca.
    onCerrar();
  };

  /**
   * La clave se renueva SOLO cuando cambia la identidad de la jugada (cliente,
   * grupo, caballo, rival o monto), nunca entre un intento fallido y su
   * reintento: eso es justamente lo que la clave debe sobrevivir para que un
   * timeout de red no cobre dos veces.
   *
   * El rival entra en la identidad porque `4 contra 7` y `4 contra 2` son dos
   * jugadas distintas: mismo caballo, mismo monto, y sin embargo pagan distinto.
   *
   * Tras una venta fallida los campos siguen-filled, el efecto no se dispara y
   * la clave se conserva: pulsar otra vez reintenta sin doble cobro. Tras una
   * venta buena los campos se vacian, el efecto se dispara y la siguiente jugada
   * arranca con clave nueva.
   */
  useEffect(() => {
    setIdem(claveIdempotencia());
  }, [clienteId, grupoId, caballo, analisis.rival, monto]);

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3" onClick={onCerrar}>
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-cyan-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-cyan-800 to-teal-800 px-4 py-3 text-white">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-base">🏷️</span>
            <div>
              <h3 className="text-sm font-extrabold uppercase tracking-wide">Marcas · <span className="normal-case">{etiqueta}</span></h3>
              <p className="text-[10px] font-semibold text-cyan-200">
                {fecha} · {caballos.length} ejemplar(es) registrado(s)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Modalidad de TIEMPO de la marca que se va a vender (PROMPT #4). */}
            <ToggleModalidadTiempo valor={modalidadTiempo} onChange={setModalidadTiempo} />
            <button
              type="button"
              onClick={() => setReporteAbierto(true)}
              title="Reporte de marcas jugadas"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/30 bg-white/10 px-2.5 text-xs font-bold uppercase tracking-wide transition-colors hover:bg-white/20"
            >
              <span>📈</span>
              <span>Reporte</span>
            </button>
            <button
              type="button"
              onClick={onCerrar}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white/80 hover:bg-white/10 hover:text-white"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {/* ============================== VENTA ============================== */}
          <div className="space-y-3">
              {!configurada ? (
                <p className="rounded-lg bg-amber-50 px-3 py-3 text-xs font-bold text-amber-700">
                  ⚠️ {etiqueta} no tiene marcas publicadas. Configure y abra la carrera en la pestaña “Marcas y NV”.
                </p>
              ) : grupos.length === 0 ? (
                <p className="rounded-lg bg-amber-50 px-3 py-3 text-xs font-bold text-amber-700">
                  ⚠️ No hay grupos de venta cargados. Crealos en el módulo de Grupos para poder vender.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <label className="block">
                      <span className={inputLbl}>Grupo</span>
                      <SearchableSelect
                        options={opcionesGrupo}
                        value={grupoId}
                        onChange={setGrupoId}
                        allowCustom={false}
                        placeholder="Buscar grupo…"
                        inputClassName={inputCls}
                      />
                    </label>
                    <label className="block">
                      <span className={inputLbl}>Cliente</span>
                      <SearchableSelect
                        options={opcionesCliente}
                        value={clienteId}
                        onChange={setClienteId}
                        allowCustom={false}
                        disabled={!grupoId}
                        placeholder={grupoId ? "Buscar cliente…" : "Elija grupo primero"}
                        inputClassName={inputCls}
                      />
                    </label>
                    <div className="block sm:col-span-2">
                      <span className={inputLbl}>Caballo a jugar</span>
                      <p className="mt-0.5 text-[10px] leading-snug text-slate-500">
                        Marcas (orden de jerarquía): <b className="text-slate-700">{marcasGuardadas.join(" / ") || "—"}</b>
                        {nvGuardadas.length > 0 && (
                          <>
                            {" · "}NV: <b className="text-slate-700">{nvGuardadas.join(" / ")}</b>
                          </>
                        )}
                        {noJugables.length > 0 && (
                          <>
                            {" · "}No se juegan: <b className="text-slate-700">{noJugables.join(", ")}</b>
                            {" "}(la 1ª marca no tiene rival a su izquierda y los NV están bloqueados)
                          </>
                        )}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {jugables.length === 0 ? (
                          <span className="text-[11px] font-semibold text-slate-400">Sin caballos jugables</span>
                        ) : (
                          jugables.map((c) => {
                            const activo = String(caballo) === String(c.numero);
                            return (
                              <button
                                key={c.numero}
                                type="button"
                                onClick={() => setCaballo(c.numero)}
                                title={etiquetaCaballo(c)}
                                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-bold transition-all ${
                                  activo
                                    ? "border-cyan-600 bg-cyan-700 text-white shadow-xs"
                                    : "border-line bg-surface text-slate-700 hover:bg-cyan-50"
                                }`}
                              >
                                <HorseBadge num={c.numero} size="sm" />
                                <span className="max-w-[9rem] truncate">{c.nombre ?? `Caballo ${c.numero}`}</span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {/*
                      RIVAL DEL MATCH. Solo ofrece los caballos que el elegido
                      tiene legales a su IZQUIERDA, asi que un caballo de la
                      izquierda nunca se puede medir contra uno de la derecha:
                      el menu hace imposible el cruce que la norma prohibe.
                    */}
                    <div className="block sm:col-span-2">
                      <span className={inputLbl}>Rival del match</span>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {analisis.candidatos.length === 0 ? (
                          <span className="text-[11px] font-semibold text-slate-400">Sin rival legal</span>
                        ) : (
                          analisis.candidatos.map((n) => {
                            const ej = buscarEjemplar(caballos, n);
                            const activo = String(analisis.rival) === String(n);
                            return (
                              <button
                                key={n}
                                type="button"
                                onClick={() => setRival(n)}
                                title={ej ? etiquetaCaballo(ej) : `Caballo ${n}`}
                                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-bold transition-all ${
                                  activo
                                    ? "border-cyan-600 bg-cyan-700 text-white shadow-xs"
                                    : "border-line bg-surface text-slate-700 hover:bg-cyan-50"
                                }`}
                              >
                                <HorseBadge num={n} size="sm" />
                                <span className="max-w-[9rem] truncate">{ej?.nombre ?? `Caballo ${n}`}</span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>

                    <label className="block sm:col-span-2">
                      <span className={inputLbl}>Monto (se juega 120 para ganar 100)</span>
                      <div className="relative">
                        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-xs font-bold text-slate-400">
                          $
                        </span>
                        <input
                          value={monto}
                          onChange={(e) => setMonto(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void solicitarVenta();
                            }
                          }}
                          inputMode="decimal"
                          placeholder="0.00"
                          className={`${inputCls} pl-7`}
                        />
                      </div>
                    </label>
                  </div>

                  {/* Previsualización del matchup */}
                  <div
                    className={`rounded-xl border p-3 text-xs font-bold transition-all ${
                      analisis.valido
                        ? "border-emerald-300 bg-emerald-50/80 text-emerald-900 shadow-2xs"
                        : "border-amber-300 bg-amber-50/80 text-amber-900 shadow-2xs"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-base">{analisis.valido ? "⚔️" : "ℹ️"}</span>
                      <div className="flex-1">
                        <div>{analisis.mensaje || "Elija el caballo para ver contra quién juega."}</div>
                        {analisis.valido && analisis.candidatos.length > 1 && (
                          <div className="mt-1 text-[11px] font-semibold text-emerald-700">
                            Rivales legales: <b>{analisis.candidatos.join(" · ")}</b>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5 rounded-xl border border-line bg-surfaceAlt/60 p-3 text-xs font-semibold text-slate-700">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1 text-slate-500">💵 Monto</span>
                      <span className="font-extrabold text-slate-900">${numeros.monto.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1 text-emerald-700">✨ Ganancia neta (100/120)</span>
                      <span className="font-extrabold text-emerald-700">${numeros.gananciaNeta.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-line/60 pt-1.5">
                      <span className="flex items-center gap-1 font-bold text-slate-800">🏆 Pago bruto si gana</span>
                      <span className="text-sm font-black text-slate-900">${numeros.pagoBruto.toFixed(2)}</span>
                    </div>
                    {cliente && !esClienteLibre(cliente) ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">💳 Saldo del cliente</span>
                          <span className={saldo < 0 ? "font-extrabold text-red-600" : "font-extrabold text-slate-800"}>
                            ${saldo.toFixed(2)}
                          </span>
                        </div>
                        {/*
                          La fila del aval solo aparece si lo hay, pero
                          "Disponible para jugar" se muestra SIEMPRE para un
                          cliente con regla: es el número que decide si la venta
                          pasa. Con aval 0 se veía solo "-50 de saldo" sin
                          explicación de por qué el botón está bloqueado.
                        */}
                        {aval > 0 && (
                          <div className="flex items-center justify-between text-amber-700">
                            <span>🛡️ + Aval (crédito)</span>
                            <span className="font-extrabold">${aval.toFixed(2)}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between border-t border-line/60 pt-1.5">
                          <span className="font-bold text-slate-700">✅ Disponible para jugar</span>
                          <span className={faltaSaldo ? "font-extrabold text-red-600" : "font-extrabold text-emerald-700"}>
                            ${disponible.toFixed(2)}
                          </span>
                        </div>
                        {jugandoConAval && (
                          <p className="mt-1 text-[11px] font-bold text-amber-700">
                            ⚠️ Esta jugada usa el aval: el saldo quedará en ${(saldo - Number(monto)).toFixed(2)}.
                          </p>
                        )}
                        {faltaSaldo && (
                          <p className="mt-1 text-[11px] font-bold text-red-600">
                            Falta ${(Number(monto) - disponible).toFixed(2)} para esta jugada.
                          </p>
                        )}
                      </>
                    ) : (
                      <div className="flex items-center justify-between border-t border-line/60 pt-1.5">
                        <span className="text-slate-500">💳 Saldo del cliente</span>
                        <span className={faltaSaldo ? "font-extrabold text-red-600" : "font-extrabold text-slate-800"}>
                          ${esClienteLibre(cliente) ? "libre" : saldo.toFixed(2)}
                        </span>
                      </div>
                    )}
                  </div>

                  {faltaSaldo && <p className="text-[11px] font-bold text-red-600">⚠️ Saldo insuficiente para esta jugada.</p>}

                  <Button
                    variant="success"
                    className="h-10 w-full font-bold shadow-md"
                    onClick={solicitarVenta}
                    disabled={vendiendo || !analisis.valido || !grupoId || !clienteId || !Number(monto) || faltaSaldo}
                  >
                    <span>{vendiendo ? "⏳" : "🧾"}</span>
                    <span>{vendiendo ? "Registrando…" : "Revisar jugada"}</span>
                  </Button>
                </>
              )}
          </div>
        </div>
      </div>
    </div>
    <TicketVentaPreview
      abierto={preview !== null}
      ticket={preview}
      confirmando={vendiendo}
      error={errorPreview}
      onCorregir={() => {
        setPreview(null);
        setErrorPreview(null);
      }}
      onConfirmar={() => void confirmarVenta()}
    />
    <ReporteMarcasJugadasModal
      abierto={reporteAbierto}
      onCerrar={() => setReporteAbierto(false)}
      fechaInicial={fecha}
      hipodromoInicial={carrera.hipodromo.trim().toUpperCase()}
      carreraInicial={`${carrera.hipodromo.trim().toUpperCase()}|${carrera.carrera}`}
    />
    {modalAdminReq && (
      <ModalAutorizacionAdmin
        abierto={true}
        onCerrar={() => setModalAdminReq(null)}
        onAutorizado={modalAdminReq.onAutorizar}
        motivo={modalAdminReq.motivo}
        modalidad="MARCAS"
        grupoNombre={modalAdminReq.grupoNombre}
        jugadorNombre={modalAdminReq.jugadorNombre}
        monto={modalAdminReq.monto}
        limiteEstablecido={modalAdminReq.limiteEstablecido}
      />
    )}
    </>
  );
}

export default ModalMarcas;
