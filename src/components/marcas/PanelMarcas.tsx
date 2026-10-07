"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { getHorseColor } from "@/lib/horseColors";
import { hoyLocal } from "@/lib/gaceta/programa";
import { type CarreraCentral, type EjemplarCarreraCentral } from "@/lib/carreras/central";
import { useRegistroCentralOpts } from "@/store/useRegistroCentral";
import {
  buscarEjemplar,
  cambiarEstadoMarcas,
  eliminarConfigMarcas,
  PROPORCION,
  revisarConfig,
  separarNumeros,
  type ConfigMarcas,
} from "@/lib/marcas";
import { ModalMarcas } from "@/components/marcas/ModalMarcas";
import { ModalMarcasEditor } from "@/components/marcas/ModalMarcasEditor";
import { usePizarraOficial } from "@/lib/marcas/usePizarraOficial";
import type { PizarraMarca } from "@/lib/marcas";

const inputLbl = "text-[10px] font-bold uppercase tracking-wider text-slate-500";

/**
 * HOJA RESUMEN: TABLA DE CONTENIDO, NO CUADRICULA DE `fr`.
 *
 * Antes cada fila era una cuadricula `grid` con las columnas repartidas en `fr`,
 * y eso obliga a elegir un ancho A MANO: la pista se estira lo que le toca y el
 * contenido queda flotando en el medio de la celda. Para que las columnas midieran
 * lo que necesitan habia que adivinar cuantos caballos caben, y el que se pasaba
 * de la cuenta empujaba a las demas o recortaba los numeros de dos digitos.
 *
 * Ahora es una `<table>` real. Eso resuelve las tres cosas de un tiro:
 *
 *   1) ANCHO SEGUN CONTENIDO. Cada columna mide lo que mide su celda MAS ANCHA de
 *      toda la tabla, no una fraccion del espacio libre. Sin numeros magicos y
 *      sin adivinar.
 *   2) ALINEACION PERFECTA. La tabla calcula los anchos UNA vez para todas sus
 *      filas, asi que la "Marca" de la carrera 1 cae en el mismo pixel que la de
 *      la carrera 12. Con una cuadricula por fila eso no se puede garantizar.
 *   3) A LA IZQUIERDA. Las celdas se alinean a la izquierda y las listas de
 *      caballos se apoyan en el separador de columna, no flotan centradas.
 *
 * `w-max` + el envoltorio `overflow-x-auto`: la tabla toma el ancho que necesita
 * y, si esa carrera trae doce caballos marcados y no cabe en la pantalla, aparece
 * la barra de desplazamiento. NUNCA se recorta ni se pisa un numero.
 */

/**
 * Separador vertical de columna. Sin esto los titulos pegados se leen como una
 * frase sola y se pierde de vista donde esta cada dato.
 */
const sepCls = "border-l border-line";

/**
 * Pastilla de caballo. Alto y tipografia FIJOS para que todas midan igual y las
 * filas conserven la misma altura tenga 2 caballos o 6.
 *
 * `shrink-0`: en una celda angosta el navegador intentaria encoger las pastillas
 * para que quepan, y una pastilla de "14" es justo la que se deforma: el numero
 * de dos digitos se aprieta y se ve cortado. Con `shrink-0` la pastilla mantiene
 * su ancho y la que no cabe BAJA de linea (la celda envuelve), que es lo legible.
 */
const chipCls =
  "inline-flex h-[19px] shrink-0 items-center justify-center rounded-[3px] border px-[5px] text-[13px] font-bold leading-none tabular-nums";

/**
 * Los botones de la fila miden TODOS lo mismo, activo o no. Antes el de abrir/
 * cerrar y el de borrar solo aparecian con configuracion, y esa fila se corria
 * hacia la izquierda: el caja pulsaba el de la venta de la fila de al lado.
 */
const botonCls =
  "grid h-[20px] w-[20px] shrink-0 place-items-center rounded text-[11px] leading-none transition-colors";

/**
 * El mando de la fila se separa con una linea MAS gruesa que las columnas de
 * datos, para que se lea como "otra cosa", pero pegado a la fila: si se separa
 * de mas se pierde de vista a que carrera pertenece cada boton.
 *
 * SIN `ml-auto`: antes el mando se empujaba al extremo derecho con `ml-auto` y
 * dejaba un bloque de aire entre los datos y los botones. Ahora la fila se lee
 * de corrido de izquierda a derecha, sin hueco en el medio.
 */
const mandoCls = "flex items-center justify-start gap-[2px] border-l-2 border-slate-300 pl-2.5";

/**
 * MODULO MARCAS - panel del menu hípico.
 *
 * Es el mismo modulo que el botón 🏷️ de cada fila en "Carreras del Día", pero
 * alcanzado desde el menu: aqui se ve de un vistazo qué carreras del día YA
 * tienen marcas cargadas, cuáles están abiertas para vender y cuáles hay que
 * configurar todavía.
 *
 * No duplica ninguna lógica: la tabla arma el estado con `revisarConfig` (la
 * misma función pura que valida la carrera en el modal) y la venta sigue
 * entrando por `club_vender_marca`.
 */
export function PanelMarcas() {
  const [hipodromo, setHipodromo] = useState("");
  const [fecha, setFecha] = useState(() => hoyLocal());

  /**
   * Catálogo de hipódromos desde el REGISTRO CENTRAL, no con
   * `listarHipodromos()` propio: así un alta o baja en el CRUD de Hipódromos se
   * refleja aquí al instante y Marcas no puede quedar con una lista vieja que
   * ya no coincide con la de Gestión, Tablas o Dupletas.
   */
  const { hipodromos } = useRegistroCentralOpts(fecha);

  const [abierta, setAbierta] = useState<CarreraCentral | null>(null);
  /** Carrera cuya config se va a borrar, esperando confirmación. */
  const [porBorrar, setPorBorrar] = useState<{ carrera: CarreraCentral; cfg: ConfigMarcas } | null>(
    null
  );
  const [borrando, setBorrando] = useState(false);
  /**
   * Editor de marcas abierto. `carrera: null` significa "sin carrera elegida":
   * el operador entra a arreglar la jornada completa desde el boton general.
   */
  const [editor, setEditor] = useState<{ hipodromo: string; carrera: number | null } | null>(null);

  const toast = useCallback((msg: string, tipo: "success" | "warning" | "error" | "info" = "info") => {
    window.dispatchEvent(new CustomEvent("toast", { detail: { msg, tipo } }));
  }, []);

  /**
   * La pizarra oficial trae las carreras centrales y su configuracion de
   * marcas ya cruzadas por la misma clave. Este panel antes se cruzaba las dos
   * tablas a mano, que es justo el cruce que `usePizarraOficial` hace una vez
   * para toda la app: dos copias del mismo merge divergen en cuanto una de las
   * dos se actualiza y la otra no.
   *
   * El filtro por hipodromo se aplica sobre el array, igual que en Carreras del
   * Dia, para que cambiarlo no vuelva a pegarle a la base.
   */
  const { filas, cargando, error, recargar: recargarPizarra } = usePizarraOficial(fecha);

  useEffect(() => {
    if (error) toast(error, "error");
  }, [error, toast]);

  const refrescar = useCallback(async () => {
    await recargarPizarra();
  }, [recargarPizarra]);

  const visibles = useMemo(
    () => (hipodromo ? filas.filter((f) => f.hipodromo === hipodromo) : filas),
    [filas, hipodromo]
  );

  /**
   * HIPODROMOS ACTIVOS DEL DIA.
   *
   * El selector antes ofrecia la lista estatica de `listarHipodromos()` (la
   * whitelist VE+USA del negocio): todos los hipodromos operativos, corran o no
   * ese dia. Al cambiar de fecha el filtro se quedaba apuntando a un
   * hipodromo sin carreras y la tabla salia vacia, sin forma de saber si era
   * que no corria o que el filtro estaba mal.
   *
   * Aqui un hipodromo esta ACTIVO para una fecha si tiene al menos una carrera
   * EN la jornada. Se arma desde `filas` —la pizarra que ya esta cargada— para
   * no pegarle a la base otra vez; `listarHipodromos()` queda solo para poner
   * el nombre con su capitalizacion.
   *
   * Las filas huerfanas (`sinCarreraCentral`) NO cuentan: su carrera ya no esta
   * en la jornada, asi que el hipodromo no esta corriendo ese dia. Esas se
   * reportan aparte, en su propio panel de abajo.
   */
  const activos = useMemo(() => {
    const porNombre = new Map<string, number>();
    for (const f of filas) {
      if (f.sinCarreraCentral) continue;
      const h = String(f.hipodromo ?? "").trim().toUpperCase();
      if (!h) continue;
      porNombre.set(h, (porNombre.get(h) ?? 0) + 1);
    }
    return [...porNombre.entries()]
      .map(([valor, carreras]) => ({ valor, carreras }))
      .sort((a, b) => a.valor.localeCompare(b.valor));
  }, [filas]);

  /** `LAUREL` -> `Laurel`: el id del selector va upper, la etiqueta legible. */
  const nombreDe = useCallback(
    (valor: string) => hipodromos.find((h) => h.value === valor)?.label ?? valor,
    [hipodromos]
  );

  /**
   * Cambiar de fecha deja el filtro apuntando a un hipodromo que puede no existir
   * ese dia, y el operador veria "sin carreras" sin entender por que. Se limpia
   * solo cuando ya termino de leer, para no borrar la seleccion durante la
   * recarga (mientras `filas` Todavia es la del dia anterior).
   */
  useEffect(() => {
    if (cargando) return;
    if (!hipodromo) return;
    if (activos.some((a) => a.valor === hipodromo)) return;
    setHipodromo("");
  }, [activos, cargando, hipodromo]);

  /** La carrera central completa de una fila, para las columnas de la tabla. */
  const centralDe = useCallback((f: PizarraMarca) => f.central, []);

  /**
   * `configDe` ya no cruza nada: la fila de la pizarra ya trae su config. Se
   * deja el helper para no reescribir toda la tabla.
   */
  const configDe = useCallback((f: PizarraMarca) => f.config, []);

  /**
   * Revisión de una carrera ya configurada. `revisarConfig` recibe listas, no
   * el objeto de configuración, así que se separan aquí con `separarNumeros`,
   * igual que hace el modal.
   */
  const revisar = useCallback(
    (cfg: ConfigMarcas, caballos: EjemplarCarreraCentral[]) =>
      revisarConfig(
        caballos,
        separarNumeros(cfg.marcas),
        separarNumeros(cfg.nv),
        separarNumeros(cfg.debutantes)
      ),
    []
  );

  /** Carreras con problemas de configuración que el operador debe corregir. */
  const conAvisos = useMemo(
    () =>
      visibles.filter((c) => {
        const cfg = configDe(c);
        if (!cfg) return false;
        return !revisar(cfg, c.central.caballos ?? c.caballos ?? []).valida;
      }),
    [visibles, configDe, revisar]
  );

  /**
   * Configuraciones que NO tienen carrera en la jornada actual. La pizarra las
   * trae como filas propias (`sinCarreraCentral`), asi que ya no hace falta
   * cruzar nada aqui para encontrarlas.
   */
  const huerfanas = useMemo(() => filas.filter((f) => f.sinCarreraCentral), [filas]);

  /**
   * AGRUPACION PARA LA TABLA RESUMEN.
   *
   * La tabla no se lee hipodromo por hipodromo cuando la jornada tiene varios:
   * son filas de carreras identicas y el operador pierde de vista en cual esta.
   * Se agrupa y cada bloque abre con una banda que resalta el hipodromo y sus
   * totales, que es el "de un vistazo" que pide la hoja resumen.
   */
  const bloques = useMemo(() => {
    const por = new Map<string, PizarraMarca[]>();
    for (const f of visibles) {
      const h = String(f.hipodromo ?? "").trim().toUpperCase() || "SIN HIPODROMO";
      const lista = por.get(h);
      if (lista) lista.push(f);
      else por.set(h, [f]);
    }
    return [...por.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([h, carreras]) => ({
        hipodromo: h,
        carreras: [...carreras].sort((a, b) => a.carrera - b.carrera),
        conMarcas: carreras.filter((c) => !!configDe(c)).length,
        abiertas: carreras.filter((c) => configDe(c)?.estado === "Abierta").length,
      }));
  }, [visibles, configDe]);

  const cerrar = useCallback(() => {
    setAbierta(null);
    void refrescar();
  }, [refrescar]);

  /**
   * Borrar la configuración NO toca los tickets ya vendidos: la jerarquía de cada
   * jugada quedó congelada en el snapshot del ticket (`nota_auditoria`) y
   * `club_liquidar_marca` lee ese snapshot, no `marcas_carrera`. Lo que sí se
   * pierde es la posibilidad de seguir vendiendo en esa carrera hasta volver a
   * configurarla, por eso se pide confirmación explícita.
   */
  const borrar = useCallback(async () => {
    if (!porBorrar) return;
    setBorrando(true);
    const r = await eliminarConfigMarcas(porBorrar.cfg.id);
    setBorrando(false);
    if (!r.ok) {
      toast(r.error ?? "No se pudo borrar la configuración.", "error");
      return;
    }
    toast(
      `Marcas de la carrera ${porBorrar.carrera.carrera} borradas. Los tickets ya vendidos conservan sus rivales.`,
      "success"
    );
    setPorBorrar(null);
    void refrescar();
  }, [porBorrar, refrescar, toast]);

  /** Abre/cierra las ventas sin pasar por el modal: atajo de la lista. */
  const alternarEstado = useCallback(
    async (cfg: ConfigMarcas) => {
      const nuevo = cfg.estado === "Abierta" ? "Cerrada" : "Abierta";
      const r = await cambiarEstadoMarcas(cfg.id, nuevo as "Abierta" | "Cerrada");
      if (!r.ok) toast(r.error ?? "No se pudo cambiar el estado.", "error");
      else toast(`Ventas ${nuevo === "Abierta" ? "abiertas" : "cerradas"}.`, "success");
      void refrescar();
    },
    [refrescar, toast]
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className={inputLbl}>Fecha</span>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-bold text-slate-900"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={inputLbl}>Hipódromo</span>
          <select
            value={hipodromo}
            onChange={(e) => setHipodromo(e.target.value)}
            disabled={activos.length === 0}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-bold text-slate-900 disabled:opacity-50"
          >
            <option value="">Todos los activos</option>
            {activos.map((h) => (
              <option key={h.valor} value={h.valor}>
                {nombreDe(h.valor)} · {h.carreras} carrera{h.carreras === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </label>
        <Button onClick={() => void refrescar()} disabled={cargando}>
          {cargando ? "Cargando…" : "Actualizar"}
        </Button>
        <Button
          variant="default"
          onClick={() => setEditor({ hipodromo, carrera: null })}
          className="bg-violet-600 hover:bg-violet-500"
          title="Abrir el editor de marcas, NV y debutantes de la jornada"
        >
          🏷️ Configurar jornada
        </Button>
        <div className="ml-auto text-xs text-slate-500">
          {visibles.length} carrera{visibles.length === 1 ? "" : "s"} ·{" "}
          {visibles.filter((c) => configDe(c)).length} con marcas ·{" "}
          <span className={conAvisos.length ? "font-bold text-amber-600" : ""}>
            {conAvisos.length} por corregir
          </span>
        </div>
      </div>

      {/* OBSERVACION DE LA CASA.
          `PROPORCION` es la MISMA constante que usan `calcularRivales` y la RPC
          `club_vender_marca`, asi que el cartel no puede desincronizarse del
          calculo real. Antes esta proporcion solo vivia como texto de 11px
          pegado al campo "Monto", dentro del modal de venta: en plena ventana
          el operador no lo veia y vendia sin saber la proporcion. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border-2 border-amber-400 bg-gradient-to-r from-amber-50 via-amber-50 to-yellow-100 px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] font-bold uppercase tracking-widest text-amber-700">
            Observación
          </span>
          <span className="text-2xl font-black leading-none text-amber-900">
            {PROPORCION} para 100
          </span>
        </div>
        <p className="text-xs font-semibold text-amber-800">
          Se juega <b className="font-black">{PROPORCION}</b> para ganar{" "}
          <b className="font-black">100</b>: la ganancia neta es 100/{PROPORCION} del monto. Aplica a
          todas las carreras de la hoja.
        </p>
      </div>

      {conAvisos.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <b>{conAvisos.length} carrera{conAvisos.length === 1 ? "" : "s"}</b> con marcas ya
          cargadas pero con problemas:{" "}
          {conAvisos
            .map((c) => {
              const rev = revisar(configDe(c)!, c.caballos ?? []);
              return `C${c.carrera} (${rev.mensaje ?? "revisar marcas"})`;
            })
            .join(" · ")}
        </div>
      )}

      {cargando && filas.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-500">Cargando carreras…</div>
      ) : visibles.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-500">
          No hay carreras registradas para {fecha}. Crégalas primero en la pestaña “Carreras del
          Día”.
        </div>
      ) : (
        <div className="space-y-2.5">
          {bloques.map((b) => (
            <div key={b.hipodromo} className="overflow-hidden rounded-lg border border-line">
              {/* CABECERA DEL CUADRO: un recuadro por hipodromo, con el nombre
                  arriba de sus carreras y no perdido en una columna mas. */}
              <div className="flex items-center gap-2 bg-amber-500 px-2 py-[3px]">
                <span className="text-[11px] font-black uppercase tracking-wider text-white">
                  🏟 {nombreDe(b.hipodromo)}
                </span>
                <span className="text-[9px] font-bold text-amber-50">
                  {b.carreras.length} carrera{b.carreras.length === 1 ? "" : "s"} · {b.conMarcas} con
                  marcas · {b.abiertas} abierta{b.abiertas === 1 ? "" : "s"}
                </span>
              </div>

              {/* HOJA DEL HIPODROMO: tabla de verdad. El ancho de cada columna lo
                  da su contenido (y no una fraccion del espacio libre), asi que
                  todo queda pegado a la izquierda y alineado sin adivinar anchos.
                  El envoltorio scrollea en horizontal SOLO si una fila trae mas
                  caballos de los que caben: nada se recorta ni se apila. */}
              <div className="overflow-x-auto">
                <table className="w-max border-collapse text-left">
                  {/* ROTULO DE LAS CINCO COLUMNAS. Se repite en cada cuadro para que
                      la marca, el NV y los debutantes caigan SIEMPRE en la misma
                      columna al pasar de un hipodromo al siguiente: es lo que hace
                      que la jornada se pueda leer de un vistazo. */}
                  <thead>
                    <tr className="border-b border-line bg-surface text-[9px] uppercase tracking-wider text-slate-500">
                      <th className="px-2.5 py-1 text-left font-bold">Carrera</th>
                      <th className={`px-2.5 py-1 text-left font-bold ${sepCls}`}>Marca</th>
                      <th className={`px-2.5 py-1 text-left font-bold ${sepCls}`}>NV</th>
                      <th className={`px-2.5 py-1 text-left font-bold ${sepCls}`}>No valen</th>
                      <th className={`px-2.5 py-1 text-left font-bold ${sepCls}`}>Deb.</th>
                      <th className="border-l-2 border-slate-300 py-1 pl-2.5 pr-2.5 text-left font-bold">
                        Acciones
                      </th>
                    </tr>
                  </thead>

                  {/* Filas alternas con contraste suave. Con veinte carreras en una
                      pantalla, todas las filas del mismo color se leen como un bloque
                      y se pierde el caballo de la fila de arriba. */}
                  <tbody>
                    {b.carreras.map((c, i) => {
                      const cfg = configDe(c);
                      const rev = cfg ? revisar(cfg, c.caballos ?? []) : null;
                      const marcas = cfg ? separarNumeros(cfg.marcas) : [];
                      const nvs = cfg ? separarNumeros(cfg.nv) : [];
                      const deb = cfg ? separarNumeros(cfg.debutantes) : [];
                      const noValenDeb = cfg?.debutantes_valen === false;
                      const cerrada = cfg?.estado === "Cerrada";
                      const problema = Boolean(cfg && rev && !rev.valida);
                      return (
                        <tr
                          key={`${c.hipodromo}-${c.carrera}`}
                          onClick={() => setAbierta(c)}
                          title={problema ? (rev?.mensaje ?? "Configuracion con problemas") : "Abrir ventas de esta carrera"}
                          className={`h-[26px] cursor-pointer text-[10px] leading-tight transition-colors hover:bg-amber-50 [&+tr]:border-t [&+tr]:border-line/70 ${
                            !cfg
                              ? i % 2 === 0
                                ? "bg-slate-50 text-slate-400"
                                : "bg-white text-slate-400"
                              : cerrada
                                ? i % 2 === 0
                                  ? "bg-slate-100 text-slate-500"
                                  : "bg-slate-50 text-slate-500"
                                : i % 2 === 0
                                  ? "bg-white text-slate-800"
                                  : "bg-slate-50/70 text-slate-800"
                          }`}
                        >
                          <td className="whitespace-nowrap px-2.5 py-[3px]">
                            <span className="flex items-center justify-start gap-[1px] font-black tabular-nums text-[12px] leading-none">
                              {c.carrera}
                              {problema ? (
                                <span className="text-[9px] font-bold leading-none text-amber-600">
                                  !
                                </span>
                              ) : null}
                            </span>
                          </td>

                          <td className={`px-2.5 py-[3px] ${sepCls}`}>
                            <span className="flex min-h-[19px] flex-wrap items-center justify-start gap-[2px]">
                              {marcas.length === 0 ? (
                                <span className="text-[11px] text-slate-400">—</span>
                              ) : (
                                marcas.map((n) => {
                                  const g = getHorseColor(n);
                                  return (
                                    <span key={n} className={`${chipCls} ${g.border} ${g.bg} ${g.text}`}>
                                      {n}
                                    </span>
                                  );
                                })
                              )}
                            </span>
                          </td>

                          <td className={`px-2.5 py-[3px] ${sepCls}`}>
                            <span className="flex min-h-[19px] items-center justify-start">
                              {nvs.length > 0 ? (
                                <span className={`${chipCls} border-red-300 bg-red-100 text-red-700`}>
                                  NV
                                </span>
                              ) : (
                                <span className="text-[11px] text-slate-300">—</span>
                              )}
                            </span>
                          </td>

                          {/* El color del que NO VALE es el de su gualdrapa, igual
                              que el de la marca: el jinete reconoce al caballo por
                              el color de la linea grafica de la carta y no tiene
                              que buscar el numero en otra columna. La columna se
                              titula "No valen", asi que el color ya no tiene que
                              codificar el veto ademas del caballo. */}
                          <td className={`px-2.5 py-[3px] ${sepCls}`}>
                            <span className="flex min-h-[19px] flex-wrap items-center justify-start gap-[2px]">
                              {nvs.length === 0 ? (
                                <span className="text-[11px] text-slate-400">—</span>
                              ) : (
                                nvs.map((n) => {
                                  const g = getHorseColor(n);
                                  return (
                                    <span
                                      key={n}
                                      className={`${chipCls} ${g.border} ${g.bg} ${g.text} opacity-70`}
                                    >
                                      {n}
                                    </span>
                                  );
                                })
                              )}
                            </span>
                          </td>

                          <td className={`px-2.5 py-[3px] ${sepCls}`}>
                            <span className="flex min-h-[1.4rem] flex-col items-start justify-center">
                              {!cfg ? (
                                <span className="text-[11px] text-slate-400">—</span>
                              ) : noValenDeb ? (
                                <span
                                  className={`${chipCls} justify-center border-red-300 bg-red-100 text-red-700`}
                                >
                                  NV DEB.
                                </span>
                              ) : (
                                <span
                                  className={`${chipCls} justify-center border-emerald-300 bg-emerald-100 text-emerald-700`}
                                >
                                  VALEN
                                </span>
                              )}
                              {deb.length > 0 ? (
                                <span className="mt-[2px] text-[9px] font-semibold leading-none text-violet-700">
                                  {deb.join(" ")}
                                </span>
                              ) : null}
                            </span>
                          </td>

                          {/* Las acciones no son una sexta columna de datos: son el
                              mando de la fila. La linea gruesa las separa del dato
                              sin soltarlas de la carrera a la que pertenecen, y la
                              fila entera abre las ventas.

                              Los CUATRO botones se dibujan siempre, activo o no.
                              Antes el de abrir/cerrar y el de borrar solo
                              aparecian con configuracion, y esa fila se corria: el
                              caja acababa pulsando el boton de la venta de la fila
                              de al lado. */}
                          <td
                            className="border-l-2 border-slate-300 py-[3px] pl-2.5 pr-2.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className={mandoCls}>
                              <button
                                type="button"
                                onClick={() => setAbierta(c)}
                                title="Vender jugadas y cargar el resultado"
                                className={`${botonCls} bg-cyan-600 text-white hover:bg-cyan-500`}
                              >
                                💵
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditor({ hipodromo: c.hipodromo, carrera: c.carrera })}
                                title={
                                  cfg
                                    ? "Editar marcas, NV y debutantes de esta carrera"
                                    : "Configurar marcas, NV y debutantes de esta carrera"
                                }
                                className={`${botonCls} bg-violet-600 text-white hover:bg-violet-500`}
                              >
                                {cfg ? "✏️" : "🏷️"}
                              </button>
                              <button
                                type="button"
                                onClick={() => cfg && void alternarEstado(cfg)}
                                disabled={!cfg}
                                title={
                                  !cfg
                                    ? "Configure las marcas para poder abrir o cerrar la venta"
                                    : cfg.estado === "Abierta"
                                      ? "Cerrar las ventas de esta carrera"
                                      : "Abrir las ventas de esta carrera"
                                }
                                className={`${botonCls} text-white disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 ${
                                  cfg && cfg.estado === "Abierta"
                                    ? "bg-emerald-600 hover:bg-emerald-500"
                                    : "bg-slate-400 hover:bg-slate-500"
                                }`}
                              >
                                {cfg ? (cfg.estado === "Abierta" ? "🔓" : "🔒") : "🔒"}
                              </button>
                              <button
                                type="button"
                                onClick={() => cfg && setPorBorrar({ carrera: c, cfg })}
                                disabled={!cfg}
                                title={
                                  cfg ? "Borrar la configuración de marcas" : "No hay configuración que borrar"
                                }
                                className={`${botonCls} text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent`}
                              >
                                🗑
                              </button>
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {/* COLETILLA: el default del modulo. Sin esto el operador tiene que
              abrir el editor de cada carrera para saber si los debutantes
              cuentan, que es justo lo que cambia el resultado. */}
          <p className="px-1 text-[10px] font-semibold text-slate-500">
            No valen debutantes a menos que se indique lo contrario en la carrera.
          </p>
        </div>
      )}

      {huerfanas.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <div className="text-xs font-bold uppercase text-amber-800">
            Marcas huérfanas — {huerfanas.length} sin carrera en la jornada
          </div>
          <p className="mt-1 text-[11px] font-semibold text-amber-700">
            La carrera ya no está en "Carreras del Día" pero su configuración sigue guardada. Se
            puede borrar para limpiar, o dejarla: no afecta a ninguna jugada ya liquidada.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {huerfanas.map((f) => {
              const cfg = f.config;
              if (!cfg) return null;
              return (
              <div
                key={cfg.id}
                className="flex items-center gap-2 rounded-lg border border-amber-200 bg-white px-2 py-1 text-[11px]"
              >
                <b className="text-slate-800">
                  {cfg.hipodromo} C{cfg.carrera}
                </b>
                <span className="text-slate-600">marcas: {cfg.marcas}</span>
                {cfg.nv ? <span className="text-slate-600">NV: {cfg.nv}</span> : null}
                <span
                  className={`rounded px-1.5 py-0.5 font-bold ${
                    cfg.estado === "Abierta"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {cfg.estado}
                </span>
                <button
                  type="button"
                  onClick={() => setPorBorrar({ carrera: f.central, cfg })}
                  title="Borrar esta configuración huérfana"
                  className="rounded px-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                >
                  🗑
                </button>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {abierta && (
        <ModalMarcas
          carrera={abierta}
          fecha={abierta.fecha}
          onCerrar={cerrar}
          onToast={toast}
          onCambio={() => void refrescar()}
        />
      )}

      {/* El editor de configuracion va aparte del de ventas: uno administra la
          jornada, el otro opera una carrera. */}
      {editor && (
        <ModalMarcasEditor
          hipodromoInicial={editor.hipodromo}
          carreraInicial={editor.carrera ?? undefined}
          onCerrar={() => setEditor(null)}
          onToast={toast}
          onCambio={() => void refrescar()}
        />
      )}

      {/* Borrar la configuración: es destructivo, así que se pregunta. */}
      {porBorrar && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          onClick={() => setPorBorrar(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-red-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between rounded-t-2xl border-b border-red-200 bg-red-50 px-4 py-3">
              <h3 className="text-xs font-black uppercase text-red-700">
                🗑 Borrar marcas de la carrera {porBorrar.carrera.carrera}
              </h3>
              <button
                type="button"
                onClick={() => setPorBorrar(null)}
                className="text-red-400 hover:text-red-600"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2 p-4">
              <p className="text-sm font-bold text-slate-800">
                ¿Borrar las marcas de la carrera {porBorrar.carrera.carrera} de{" "}
                {porBorrar.carrera.hipodromo} — {fecha}?
              </p>
              <p className="text-[11px] font-semibold text-slate-500">
                Se borran las marcas ({porBorrar.cfg.marcas}) y el NV ({porBorrar.cfg.nv || "—"}).
              </p>
              <p className="text-[11px] font-semibold text-slate-500">
                Las jugadas ya vendidas <b>no se tocan</b>: cada una guardó sus rivales en su
                ticket y la liquidación lee ese snapshot, no esta tabla. Lo que se pierde es poder
                vender en esa carrera hasta volver a configurarla.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-red-100 bg-gray-50 px-4 py-3">
              <Button variant="ghost" size="sm" onClick={() => setPorBorrar(null)}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={borrando}
                onClick={() => void borrar()}
              >
                {borrando ? "Borrando…" : "🗑 Borrar marcas"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
