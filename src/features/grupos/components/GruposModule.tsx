"use client";

import Link from "next/link";



import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/shared/components/ui/Button";

import { LogoUploader } from "@/shared/components/ui/LogoUploader";

import { LogoDisplay } from "@/shared/components/ui/LogoDisplay";

import { ToastHost } from "@/shared/components/ui/ToastHost";

import { emitirLogosActualizados, emitirToast } from "@/shared/lib/mensajeria";

import { useConfirmar } from "@/shared/store/useConfirmStore";

import { BANCOS_VZLA, formatearCuenta } from "@/shared/lib/vzla";

import { DIAS_SEMANA, etiquetaDia } from "@/features/liquidacion/lib/semana";

import { supabase } from "@/core/supabase";

import {

  actualizarGrupo,

  actualizarVisibilidadPrincipal,
  actualizarVentanaReclamos,

  asignarPrincipalUnico,

  crearGrupo,

  crearTipoJugada,

  actualizarTipoJugada,

  toggleTipoJugadaActivo,

  eliminarGrupoRpc,

  emitirGruposActualizados,

  errorCargaGrupos,

  invalidarCacheGrupos,

  listarClientesLigeros,

  listarGruposAdmin,

  listarMembresias,

  listarTiposJugadas,

  porcentajeDeEntrada,

  toggleGrupoActivo,

  type ClienteLigero,

  type GrupoRow,

  type MembresiaClienteGrupo,

  type TipoJugadaRow,

} from "@/features/grupos/lib/grupos";

import {

  ETIQUETA_BASE,

  ETIQUETA_MODALIDAD,

  MODALIDADES_BANQUERO,

  eliminarBanquero,

  guardarBanquero,

  listarBanquerosGrupo,

  type BanqueroBase,

  type BanqueroConvenio,

  type ModalidadBanquero,

} from "@/features/liquidacion/lib/banqueros";

import { CamposComisionesConvenio } from "@/features/grupos/components/CamposComisionesConvenio";

import { PanelVisibilidadPrincipal } from "@/features/grupos/components/PanelVisibilidadPrincipal";

import { ReporteComisionesConvenioModal } from "@/features/grupos/components/ReporteComisionesConvenioModal";
import { PestanaOperadoresGrupo } from "@/features/grupos/components/PestanaOperadoresGrupo";

import {

  CONCEPTOS_CONVENIO,

  columnasConvenioCompletas,

  columnasConvenioDesde,

  conceptoDe,

  valoresConvenioDeGrupo,

  valoresConvenioInicial,

  type ProductoConvenio,

  type ValoresConvenio,

} from "@/features/grupos/lib/comisiones-convenio";



const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>

  emitirToast(msg, tipo);



const num = (v: string | number | null | undefined): number => {

  const n = parseFloat(String(v ?? ""));

  return Number.isNaN(n) ? 0 : n;

};



const strNum = (v: string | number | null | undefined): string => {

  // `0` es un porcentaje válido (0%): solo vacío/no numérico queda en blanco.

  const t = String(v ?? "").trim();

  if (!t) return "";

  const n = Number(t);

  return Number.isFinite(n) ? String(n) : "";

};



// "0102 · BANCO DE VENEZUELA / N° 1234" -> { banco, numero }

function desglosarCuenta(cuenta: string | null | undefined): { banco: string; numero: string } {

  const t = String(cuenta ?? "").trim();

  if (!t) return { banco: "", numero: "" };

  const idx = t.indexOf("N°");

  const numero = idx === -1 ? "" : formatearCuenta(t.slice(idx + 2));

  const banco = idx === -1 ? t : t.slice(0, idx).replace(/\s*\/?\s*$/, "");

  return { banco, numero };

}



function componerCuenta(banco: string, numero: string): string | null {

  const b = String(banco ?? "").trim();

  const n = formatearCuenta(numero);

  if (!b) return null;

  return n ? `${b} / N° ${n}` : b;

}



type FilaBanquero = {

  modalidad: ModalidadBanquero;

  banquero_cliente_id: string;

  cobra_comision: boolean;

  comision_porcentaje: string;

  comision_base: BanqueroBase;

  activo: boolean;

};



/**

 * GruposModule — Grupos de Venta y Convenios (clon 1:1 de js/grupos.js).

 *  - Crear / listar / editar / activar / eliminar grupos (grupos_venta).

 *  - Convenios por tipo de jugada y grupo (convenio_tipo_grupo).

 *  - Banquero por modalidad (banquero_convenio).

 */

export function GruposModule() {

  const [grupos, setGrupos] = useState<GrupoRow[]>([]);

  const [clientes, setClientes] = useState<ClienteLigero[]>([]);

  const [membresias, setMembresias] = useState<MembresiaClienteGrupo[]>([]);

  const [tipos, setTipos] = useState<TipoJugadaRow[]>([]);

  const [cargando, setCargando] = useState(true);



  /**
   * Pestaña activa del módulo. Antes las tres secciones convivían en dos
   * columnas (y se apretaban entre sí); ahora cada una vive en su propia
   * pestaña para que el listado de grupos respire a lo ancho.
   */
  const [pestana, setPestana] = useState<"grupos" | "tipos" | "banquero">("grupos");

  const [filtro, setFiltro] = useState("");

  const [grupoConvenio, setGrupoConvenio] = useState("");

  const [banqueros, setBanqueros] = useState<FilaBanquero[]>([]);



  const [editando, setEditando] = useState<GrupoRow | null>(null);
  const [pestanaModalGrupo, setPestanaModalGrupo] = useState<"convenio" | "participantes" | "operadores">("convenio");
  const [busquedaParticipante, setBusquedaParticipante] = useState("");

  const participantesDelGrupo = useMemo(() => {
    if (!editando) return [];
    const gid = String(editando.id);
    return clientes.filter((c) => String(c.grupo_id) === gid);
  }, [editando, clientes]);

  const participantesFiltrados = useMemo(() => {
    const q = busquedaParticipante.trim().toLowerCase();
    if (!q) return participantesDelGrupo;
    return participantesDelGrupo.filter(
      (c) => (c.nombre || "").toLowerCase().includes(q) || String(c.id).toLowerCase().includes(q)
    );
  }, [participantesDelGrupo, busquedaParticipante]);
  const [modalGrupo, setModalGrupo] = useState(false);

  const [guardando, setGuardando] = useState(false);

  const confirmar = useConfirmar();



  const [formNombre, setFormNombre] = useState("");

  const [formLogo, setFormLogo] = useState<string | null>(null);

  const [formMoneda, setFormMoneda] = useState("USD");

  const [formMonedaCuadre, setFormMonedaCuadre] = useState("USD");

  const [formCupo, setFormCupo] = useState("3");

  const cambiarFormMoneda = (nueva: string) => {
    setFormMoneda(nueva);
    if (nueva === "VES") {
      if (formCupo === "3" || formCupo === "100") setFormCupo("3000");
    } else if (nueva === "USD") {
      if (formCupo === "3000" || formCupo === "100") setFormCupo("3");
    }
  };

  /**

   * Comisión por convenio de cada producto en el alta. `entre_tercios` es la

   * comisión general (`comision_default`); el resto son los productos nuevos y

   * vacío = hereda la de Entre Tercios.

   */

  const [formConvenio, setFormConvenio] = useState<ValoresConvenio>(() => valoresConvenioInicial("2.5"));

  const [reporteAbierto, setReporteAbierto] = useState(false);

  /** Grupo preseleccionado al abrir el reporte desde la fila de un grupo. */
  const [reporteGrupo, setReporteGrupo] = useState<string | null>(null);

  /** Grupo al que apunta el botón «Comisiones» (abre la edición en la ficha). */
  const [editarComisiones, setEditarComisiones] = useState(false);

  const [formResponsable, setFormResponsable] = useState("");

  const [formBanco, setFormBanco] = useState("");

  const [formNumeroCuenta, setFormNumeroCuenta] = useState("");

  const [formPrincipal, setFormPrincipal] = useState(false);

  const [formCruceMismo, setFormCruceMismo] = useState(false);
  const [formCruceDiferente, setFormCruceDiferente] = useState(false);

  const [formDiaInicio, setFormDiaInicio] = useState("1");

  const [formDiaFin, setFormDiaFin] = useState("7");

  const [nuevoTipo, setNuevoTipo] = useState("");

  const [editandoTipo, setEditandoTipo] = useState<TipoJugadaRow | null>(null);



  const recargar = useCallback(async () => {

    setCargando(true);

    const [gs, cs, ms, ts] = await Promise.all([

      listarGruposAdmin(true),

      listarClientesLigeros(true),

      listarMembresias(true),

      listarTiposJugadas(false),

    ]);

    setGrupos(gs);

    setClientes(cs);

    setMembresias(ms);

    setTipos(ts);

    setCargando(false);

    const err = errorCargaGrupos();

    if (err && !gs.length) toast(err, "error");

  }, []);



  useEffect(() => {

    void recargar();

  }, [recargar]);



  useEffect(() => {

    const onActualizados = () => {

      void recargar();

    };

    if (typeof window !== "undefined") {

      window.addEventListener("grupos:actualizados", onActualizados);

      window.addEventListener("focus", onActualizados);

    }



    let canal: any = null;

    try {

      if (supabase) {

        canal = supabase

          .channel(`grupos-live-${Date.now()}`)

          .on("postgres_changes", { event: "*", schema: "public", table: "grupos_venta" }, () => {

            invalidarCacheGrupos();

            void recargar();

          })

          .subscribe();

      }

    } catch {

      /* sin realtime */

    }



    return () => {

      if (typeof window !== "undefined") {

        window.removeEventListener("grupos:actualizados", onActualizados);

        window.removeEventListener("focus", onActualizados);

      }

      if (canal) {

        try {

          canal.unsubscribe();

        } catch {

          /* noop */

        }

      }

    };

  }, [recargar]);



  const miembrosDe = useCallback(

    (grupoId: string): (ClienteLigero & { adicional: boolean })[] => {

      const principales = clientes.filter((c) => String(c.grupo_id) === String(grupoId));

      const extraIds = new Set(

        (membresias.filter((m) => String(m.grupo_id) === String(grupoId)) || [])

          .map((m) => String(m.cliente_id))

          .filter((id) => !principales.some((p) => String(p.id) === id))

      );

      const vistos = new Set<string>();

      const out: (ClienteLigero & { adicional: boolean })[] = [];

      for (const c of principales) {

        if (vistos.has(String(c.id))) continue;

        vistos.add(String(c.id));

        out.push({ ...c, adicional: false });

      }

      for (const c of clientes) {

        if (extraIds.has(String(c.id)) && !vistos.has(String(c.id))) {

          vistos.add(String(c.id));

          out.push({ ...c, adicional: true });

        }

      }

      return out;

    },

    [clientes, membresias]

  );



  const conteoPorGrupo = useMemo(() => {

    const mapa = new Map<string, number>();

    const contadores = new Map<string, number>();

    for (const g of grupos) contadores.set(String(g.id), 0);

    for (const c of clientes) {

      if (c.grupo_id != null) contadores.set(String(c.grupo_id), (contadores.get(String(c.grupo_id)) ?? 0) + 1);

    }

    for (const m of membresias) {

      const id = String(m.grupo_id);

      const esPrincipal = clientes.some((c) => String(c.id) === String(m.cliente_id) && String(c.grupo_id) === id);

      if (!esPrincipal) contadores.set(id, (contadores.get(id) ?? 0) + 1);

    }

    return contadores;

  }, [clientes, membresias, grupos]);



  const visiblesGrupos = useMemo(() => {

    const f = filtro.trim().toUpperCase();

    return grupos.filter((g) => !f || g.nombre.toUpperCase().includes(f));

  }, [grupos, filtro]);



  const gruposActivos = useMemo(() => grupos.filter((g) => g.activo !== false), [grupos]);



  const jugadoresGrupoConvenio = useMemo(

    () => (grupoConvenio ? miembrosDe(grupoConvenio) : []),

    [grupoConvenio, miembrosDe]

  );



  /** Cambia un % de convenio en el ALTA (Entre Tercios + los demás productos). */

  const setConvenioCampo = (clave: ProductoConvenio, valor: string) =>

    setFormConvenio((prev) => ({ ...prev, [clave]: valor }));



  /**

   * Cambia un % de convenio en la EDICIÓN: escribe la columna real del grupo

   * (`comision_marcas`, `comision_tablas`, …). Vacío = `null` = hereda.

   */

  const setConvenioEdicion = (clave: ProductoConvenio, valor: string) => {

    const campo = conceptoDe(clave)?.campo;

    if (!campo) return;

    setEditando((prev) =>

      prev ? ({ ...prev, [campo]: valor.trim() === "" ? null : num(valor) } as GrupoRow) : prev

    );

  };



  const guardarNuevo = async () => {

    const nombre = formNombre.trim().toUpperCase();

    if (!nombre) return toast("Indique el nombre del grupo.", "warning");

    setGuardando(true);

    const cuenta = componerCuenta(formBanco, formNumeroCuenta);

    const convenio = columnasConvenioDesde(formConvenio);

    const r = await crearGrupo({

      nombre,

      logo_url: formLogo,

      moneda: formMoneda,

      moneda_cuadre: formMonedaCuadre,

      cupo_tabla: parseInt(formCupo) || (formMoneda === "VES" ? 3000 : 3),

      comision_default: convenio.comision_default ?? porcentajeDeEntrada(formConvenio.entre_tercios),

      comision_marcas: convenio.comision_marcas,

      comision_tablas: convenio.comision_tablas,

      comision_remates: convenio.comision_remates,

      comision_polla: convenio.comision_polla,

      comision_wps: convenio.comision_wps,

      comision_dupletas: convenio.comision_dupletas,

      responsable: formResponsable.trim().toUpperCase() || null,

      cuenta_bancaria: cuenta,

      es_principal: formPrincipal,

      cruce_mismo_ejemplar: formCruceMismo,
      cruce_diferente_ejemplar: formCruceDiferente,

      dia_inicio_semana: parseInt(formDiaInicio) || 1,

      dia_fin_semana: parseInt(formDiaFin) || 7,

    });

    setGuardando(false);

    if (!r.ok) return toast(r.error ?? "Error al crear el grupo.", "error");

    toast(`Grupo "${nombre}" creado.`, "success");

    // Propagación reactiva del grupo y su logo: cabeceras/reportes al instante.
    emitirLogosActualizados({ grupoId: "" });
    invalidarCacheGrupos();
    emitirGruposActualizados();

    setFormNombre("");

    setFormLogo(null);

    setFormResponsable("");

    setFormNumeroCuenta("");

    setFormBanco("");

    setFormPrincipal(false);

    setFormCruceMismo(false);
    setFormCruceDiferente(false);

    setFormDiaInicio("1");

    setFormDiaFin("7");

    setFormConvenio(valoresConvenioInicial("2.5"));

    setFormMoneda("USD");

    setFormMonedaCuadre("USD");

    setFormCupo("3");

    setModalGrupo(false);

    void recargar();

  };



  const toggleGrupo = async (g: GrupoRow) => {

    const nuevo = g.activo !== true;

    const r = await toggleGrupoActivo(g.id, nuevo);

    if (!r.ok) return toast(r.error ?? "Error al cambiar estado.", "error");

    toast(`Grupo "${g.nombre}" ${nuevo ? "activo" : "desactivado"}.`, nuevo ? "success" : "warning");

    void recargar();

  };



  const eliminarGrupo = async (g: GrupoRow) => {

    const ok = await confirmar({

      titulo: "Eliminar grupo",

      mensaje: `¿Eliminar el grupo "${g.nombre}"?\nSus clientes pasarán al grupo PRINCIPAL.`,

      tipo: "error",

      textoConfirmar: "Eliminar",

      destructivo: true,

    });

    if (!ok) return;

    const r = await eliminarGrupoRpc(g.id);

    if (!r.ok) return toast(r.error ?? "Error al eliminar.", "error");

    toast(`Grupo "${g.nombre}" eliminado.`, "success");

    void recargar();

  };



  const guardarEdicion = async () => {

    if (!editando) return;

    const { id } = editando;

    const nombre = editando.nombre.trim().toUpperCase();

    if (!nombre) return toast("Indique el nombre del grupo.", "warning");

    /**

     * Payload COMPLETO de comisiones: las 7 columnas SIEMPRE presentes (null =

     * hereda) para que Supabase nunca reciba un porcentaje a medias. Se arma

     * desde el núcleo puro (`comisiones-convenio.ts`), igual que en el alta.

     */

    const comisiones = columnasConvenioCompletas(editando as unknown as Record<string, unknown>);

    const datos = {

      nombre,

      logo_url: editando.logo_url ?? null,

      moneda: editando.moneda ?? "USD",

      moneda_cuadre: editando.moneda_cuadre ?? "USD",

      cupo_tabla: parseInt(editando.cupo_tabla?.toString() ?? "100") || 100,

      // Comisión por convenio de producto (null = hereda la de Entre Tercios).

      comision_default: comisiones.comision_default ?? 5,

      comision_marcas: comisiones.comision_marcas,

      comision_tablas: comisiones.comision_tablas,

      comision_remates: comisiones.comision_remates,

      comision_polla: comisiones.comision_polla,

      comision_wps: comisiones.comision_wps,

      comision_dupletas: comisiones.comision_dupletas,

      responsable: String(editando.responsable ?? "").trim().toUpperCase() || null,

      cuenta_bancaria: editando.cuenta_bancaria || null,

      es_principal: editando.es_principal === true,

      cruce_mismo_ejemplar: editando.cruce_mismo_ejemplar === true,
      cruce_diferente_ejemplar: editando.cruce_diferente_ejemplar === true,

      dia_inicio_semana: editando.dia_inicio_semana ?? 1,

      dia_fin_semana: editando.dia_fin_semana ?? 7,

    };

    setGuardando(true);

    const r = await actualizarGrupo(id, datos as Record<string, unknown>);

    // ⏱️ Ventana de Revisión y Reclamos (PROMPT #6): va por RPC/update propio y es
    // mejor esfuerzo, para que la falta de la migración no tumbe el guardado del
    // grupo. Se guarda siempre (no solo en el principal).
    if (r.ok) {
      const rw = await actualizarVentanaReclamos(id, editando.ventana_reclamos ?? "SOLO_DIA_EN_CURSO");
      if (!rw.ok) {
        toast(
          "No se pudo guardar la ⏱️ Ventana de Revisión y Reclamos. Ejecutá sql/portal_jugadas_reclamos.sql en Supabase.",
          "warning"
        );
      }
    }

    if (r.ok && datos.es_principal) {

      await asignarPrincipalUnico(id);

      // Visibilidad compartida del principal (PROMPT #5): se guarda DESPUÉS de
      // marcar el principal (la RPC lo exige). Es mejor esfuerzo: si la migración
      // `sql/grupos_visibilidad_principal.sql` no está aplicada, el grupo y sus
      // comisiones igual quedan guardados y se avisa con un toast.

      const visGlobal = editando.visibilidad_global_principal === true;

      const visAutorizados = visGlobal ? [] : (editando.grupos_autorizados_ver_principal ?? []);

      const rv = await actualizarVisibilidadPrincipal(id, visGlobal, visAutorizados);

      if (!rv.ok) {

        toast(rv.error ?? "No se pudo guardar la visibilidad del principal.", "warning");

      }

    }

    setGuardando(false);

    if (!r.ok) return toast(r.error ?? "Error al guardar.", "error");

    // Recarga desde Supabase ANTES de cerrar: `actualizarGrupo` ya verificó en

    // base que los % quedaron escritos, y con la lista fresca el modal que se

    // reabra pinta los porcentajes recién guardados (antes se cerraba primero

    // y al reabrir se veían los valores viejos que aún estaban en memoria).

    await recargar();

    setEditando(null);

    setEditarComisiones(false);

    toast(`Grupo "${nombre}" actualizado. Comisiones por convenio guardadas.`, "success");

    // Propagación reactiva del logo del grupo: cabeceras/reportes al instante.
    emitirLogosActualizados({ grupoId: String(id) });

  };



  const cargarConvenios = async (grupoId: string) => {

    setGrupoConvenio(grupoId);

    if (!grupoId) {

      setBanqueros([]);

      return;

    }

    const bs = await listarBanquerosGrupo(grupoId);

    const mapaB = new Map<string, BanqueroConvenio>();

    bs.forEach((b) => mapaB.set(String(b.modalidad), b));

    setBanqueros(

      MODALIDADES_BANQUERO.map((m) => {

        const b = mapaB.get(m);

        return {

          modalidad: m,

          banquero_cliente_id: b?.banquero_cliente_id ? String(b.banquero_cliente_id) : "",

          cobra_comision: b?.cobra_comision ?? false,

          comision_porcentaje: b != null ? String(b.comision_porcentaje ?? 0) : "2.5",

          comision_base: (b?.comision_base as BanqueroBase) ?? "MONTO_DECIDIDO",

          activo: b?.activo ?? true,

        };

      })

    );

  };



  const guardarBanqueroFila = async (f: FilaBanquero) => {

    if (!grupoConvenio) return toast("Seleccione el grupo para configurar su banquero.", "warning");

    if (!f.banquero_cliente_id) {

      const r = await eliminarBanquero(grupoConvenio, f.modalidad);

      if (!r.ok) return toast(r.error ?? "Error al quitar el banquero.", "error");

      toast(`Banquero de ${ETIQUETA_MODALIDAD[f.modalidad]} quitado.`, "success");

      return;

    }

    const nombre = clientes.find((c) => String(c.id) === String(f.banquero_cliente_id))?.nombre ?? null;

    const r = await guardarBanquero({

      grupo_id: grupoConvenio,

      modalidad: f.modalidad,

      banquero_cliente_id: f.banquero_cliente_id,

      banquero_nombre: nombre,

      cobra_comision: f.cobra_comision,

      comision_porcentaje: num(f.comision_porcentaje),

      comision_base: f.comision_base,

      activo: f.activo,

    });

    if (!r.ok) return toast(r.error ?? "Error al guardar el banquero.", "error");

    toast(

      `Banquero de ${ETIQUETA_MODALIDAD[f.modalidad]}: ${nombre ?? "—"} · ${f.cobra_comision ? num(f.comision_porcentaje) + "%" : "sin comisión"}.`,

      "success"

    );

  };



  const crearTipo = async () => {

    const nombre = nuevoTipo.trim().toUpperCase();

    if (!nombre) return toast("Indique el nombre del tipo de jugada.", "warning");

    const r = await crearTipoJugada(nombre);

    if (!r.ok) return toast(r.error ?? "Error al crear el tipo de jugada.", "error");

    toast(`Tipo de jugada "${nombre}" creado.`, "success");

    setNuevoTipo("");

    void recargar();

  };



  const guardarTipo = async () => {

    if (!editandoTipo) return;

    const nombre = editandoTipo.nombre.trim().toUpperCase();

    if (!nombre) return toast("El nombre no puede quedar vacío.", "warning");

    const r = await actualizarTipoJugada(editandoTipo.id, { nombre });

    if (!r.ok) return toast(r.error ?? "Error al actualizar.", "error");

    toast(`Tipo de jugada renombrado a "${nombre}".`, "success");

    setEditandoTipo(null);

    void recargar();

  };



  const toggleTipo = async (t: TipoJugadaRow) => {

    const activo = t.activo !== true;

    const r = await toggleTipoJugadaActivo(t.id, activo);

    if (!r.ok) return toast(r.error ?? "Error al cambiar estado.", "error");

    toast(`Tipo de jugada "${t.nombre}" ${activo ? "activo" : "inactivo"}.`, activo ? "success" : "warning");

    void recargar();

  };



  const inp =

    "w-full border border-line rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary-500 bg-surface";

  const etiqueta = "block text-[10px] font-bold text-slate-600 mb-1 uppercase tracking-wider";



  return (

    <div className="space-y-4">

      <div className="flex flex-wrap items-center justify-between gap-3">

        <h1 className="text-xl font-black text-slate-800">

          <span className="mr-2 text-amber-500">🗃️</span> Grupos de Venta y Convenios

        </h1>

        <div className="flex items-center gap-2">

          <Button variant="default" size="sm" onClick={() => setModalGrupo(true)}>

            <span className="mr-1">➕</span> Registrar grupo

          </Button>

          <Button variant="outline" size="sm" onClick={() => setReporteAbierto(true)}>

            <span className="mr-1">📈</span> Reporte de comisiones

          </Button>

          <Button variant="outline" size="sm" onClick={() => void recargar()}>

            <span className="mr-1">🔄</span> Recargar

          </Button>

        </div>

      </div>



      {reporteAbierto ? (

        <ReporteComisionesConvenioModal
          grupos={grupos}
          grupoFijoId={reporteGrupo}
          onCerrar={() => {
            setReporteAbierto(false);
            setReporteGrupo(null);
          }}
        />

      ) : null}



      {/* Pestañas: cada sección en su propia vista para que el listado de
          grupos ocupe todo el ancho y quepa en una sola línea. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line pb-2">
        {(
          [
            { clave: "grupos", emoji: "📋", texto: "Grupos Registrados", n: grupos.length },
            { clave: "banquero", emoji: "👔", texto: "Banquero por Modalidad", n: null },
            { clave: "tipos", emoji: "🎲", texto: "Tipos de Jugada", n: tipos.length },
          ] as const
        ).map((t) => {
          const activa = pestana === t.clave;
          return (
            <button
              key={t.clave}
              type="button"
              onClick={() => setPestana(t.clave)}
              aria-selected={activa}
              role="tab"
              className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-wide transition ${
                activa
                  ? "bg-slate-800 text-white shadow"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <span>{t.emoji}</span>
              <span>{t.texto}</span>
              {t.n != null ? (
                <span
                  className={`ml-1 rounded-full px-1.5 py-0.5 text-[9px] ${
                    activa ? "bg-white/20 text-white" : "bg-white text-slate-500"
                  }`}
                >
                  {t.n}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-6">

        {/* ---------------- Crear / Listar Grupos ---------------- */}

        <div className={pestana === "grupos" ? "space-y-5" : "hidden"}>

          {modalGrupo ? (

          <div

            className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4"

            role="dialog"

            aria-modal="true"

            onClick={(e) => {

              if (e.target === e.currentTarget) setModalGrupo(false);

            }}

          >

          <div className="my-8 flex w-full max-w-2xl max-h-[85vh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">

            <div className="flex shrink-0 items-center justify-between bg-slate-800 px-5 py-4 text-xs font-black uppercase tracking-wider text-white">

              <span><span className="mr-2">➕</span> Registrar Grupo de Venta</span>

              <button className="text-slate-300 hover:text-white" onClick={() => setModalGrupo(false)} aria-label="Cerrar"><span>✕</span></button>

            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">

              <div className="col-span-3">

                <label className={etiqueta}>Nombre del Grupo</label>

                <input

                  value={formNombre}

                  onChange={(e) => setFormNombre(e.target.value.toUpperCase())}

                  placeholder="Ej: SUCURSAL COSTA"

                  className={inp + " font-black uppercase"}

                />

              </div>

              <div className="col-span-3">

                <LogoUploader
                  label="Logo del Grupo (PNG)"
                  value={formLogo}
                  onChange={setFormLogo}
                  hint="Se mostrará junto al nombre del grupo en el Reporte de Liquidación."
                />

              </div>

              <div>

                <label className={etiqueta}>Moneda de Venta</label>

                <select value={formMoneda} onChange={(e) => cambiarFormMoneda(e.target.value)} className={inp + " font-bold"}>

                  <option value="USD">USD ($)</option>

                  <option value="VES">VES (Bs)</option>

                </select>

              </div>

              <div>

                <label className={etiqueta}>Moneda de Cuadre</label>

                <select value={formMonedaCuadre} onChange={(e) => setFormMonedaCuadre(e.target.value)} className={inp + " font-bold"}>

                  <option value="USD">USD ($)</option>

                  <option value="VES">VES (Bs)</option>

                </select>

              </div>

              <div>

                <label className={etiqueta}>Cupos por Tabla</label>

                <input

                  value={formCupo}

                  onChange={(e) => setFormCupo(e.target.value)}

                  type="number"

                  min={1}

                  className={inp + " font-bold text-right"}

                />

              </div>

              <div className="col-span-3">

                <CamposComisionesConvenio

                  valores={formConvenio}

                  onCambio={setConvenioCampo}

                  ayuda="Comisión por convenio con el grupo principal, sobre el MONTO DECIDIDO. Vacío = hereda la de Entre Tercios."

                />

              </div>

              <div className="col-span-3">

                <label className={etiqueta}>Responsable del Grupo</label>

                <input

                  value={formResponsable}

                  onChange={(e) => setFormResponsable(e.target.value.toUpperCase())}

                  placeholder="Nombre de la persona encargada"

                  className={inp + " uppercase"}

                />

              </div>

              <div className="col-span-3">

                <label className={etiqueta}>Banco para el Cuadre</label>

                <select value={formBanco} onChange={(e) => setFormBanco(e.target.value)} className={inp + " uppercase"}>

                  <option value="">Seleccione el banco...</option>

                  {BANCOS_VZLA.map((b) => (

                    <option key={b.codigo} value={`${b.codigo} · ${b.nombre}`}>

                      {b.codigo} · {b.nombre}

                    </option>

                  ))}

                </select>

              </div>

              <div className="col-span-3">

                <label className={etiqueta}>

                  Número de Cuenta <span className="normal-case text-slate-400">(opcional)</span>

                </label>

                <input

                  value={formNumeroCuenta}

                  onChange={(e) => setFormNumeroCuenta(formatearCuenta(e.target.value))}

                  placeholder="Ej: 0102 1234567890"

                  maxLength={20}

                  className={inp + " uppercase"}

                />

              </div>

              <label className="col-span-3 flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">

                <input

                  type="checkbox"

                  checked={formPrincipal}

                  onChange={(e) => setFormPrincipal(e.target.checked)}

                  className="rounded accent-amber-500"

                />

                Es el grupo Principal (concentra la contabilidad)

              </label>

              <div className="col-span-1">

                <label className={etiqueta}>Día de Inicio de Facturación</label>

                <select

                  value={formDiaInicio}

                  onChange={(e) => setFormDiaInicio(e.target.value)}

                  className={inp + " uppercase"}

                >

                  {DIAS_SEMANA.map((d) => (

                    <option key={d.valor} value={d.valor}>

                      {d.nombre}

                    </option>

                  ))}

                </select>

              </div>

              <div className="col-span-1">

                <label className={etiqueta}>Día de Corte / Cierre</label>

                <select

                  value={formDiaFin}

                  onChange={(e) => setFormDiaFin(e.target.value)}

                  className={inp + " uppercase"}

                >

                  {DIAS_SEMANA.map((d) => (

                    <option key={d.valor} value={d.valor}>

                      {d.nombre}

                    </option>

                  ))}

                </select>

              </div>

              <div className="col-span-1 flex items-end">

                <p className="pb-1 text-[10px] italic leading-relaxed text-slate-400">

                  Define la semana fiscal (p. ej. Mar–Lun) que usarán los Saldos Consolidados.

                </p>

              </div>

              <section className="col-span-3 rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-amber-800">Configuración de Cruces (Tercios)</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-700">
                    <input type="checkbox" checked={formCruceMismo} onChange={(e) => setFormCruceMismo(e.target.checked)} className="rounded accent-amber-500" />
                    Cruzar Mismo Ejemplar
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-700">
                    <input type="checkbox" checked={formCruceDiferente} onChange={(e) => setFormCruceDiferente(e.target.checked)} className="rounded accent-amber-500" />
                    Cruzar Diferentes Ejemplares
                  </label>
                </div>
              </section>

            </div>

            </div>

            {/* Pie fijo del modal: el botón de alta queda SIEMPRE visible aunque

                el cuerpo (con las comisiones por convenio) rueda por dentro. */}

            <div className="shrink-0 border-t border-line bg-slate-50 p-4">

              <Button variant="default" className="w-full" onClick={() => void guardarNuevo()} disabled={guardando}>

                {guardando ? <span className="mr-1">⏳</span> : <span className="mr-1">➕</span>}

                Crear Grupo y su Convenio

              </Button>

            </div>

          </div>

          </div>

          ) : null}



          <div className="rounded-2xl border border-line bg-white p-4">

            <h3 className="mb-2 border-b border-line pb-2 text-xs font-black uppercase tracking-wider text-slate-700">

              <span className="mr-1 text-slate-400">📋</span> Grupos Registrados

            </h3>

            <div className="mb-2 flex items-center gap-2">

              <input

                value={filtro}

                onChange={(e) => setFiltro(e.target.value)}

                type="search"

                placeholder="Buscar grupo..."

                className={inp + " flex-1"}

              />

              <span className="whitespace-nowrap text-[10px] font-black text-slate-500">

                Total: <span className="text-amber-600">{grupos.length}</span> · Activos:{" "}

                <span className="text-emerald-600">{grupos.filter((g) => g.activo !== false).length}</span>

              </span>

            </div>

            <div className="flex flex-col gap-2">

              {visiblesGrupos.length > 0 && (
                <div className="hidden lg:grid lg:grid-cols-12 lg:items-center lg:gap-4 rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-600">
                  <div className="col-span-3">1 · Grupo / Convenio y Estado</div>
                  <div className="col-span-3">2 · Moneda y % Comisión</div>
                  <div className="col-span-2">3 · % Incentivo y Modalidad</div>
                  <div className="col-span-2">4 · Límites / Avales y Participantes</div>
                  <div className="col-span-2 text-right">5 · Acciones</div>
                </div>
              )}

              {visiblesGrupos.length === 0 ? (

                <p className="text-xs italic text-slate-400">

                  {grupos.length === 0 ? "Sin grupos. Cree el primero." : "Ningún grupo coincide con la búsqueda."}

                </p>

              ) : (

                visiblesGrupos.map((g) => {

                  const esVes = String(g.moneda ?? "").toUpperCase() === "VES";
                  const conCrucesGrupo = Boolean(g.cruce_mismo_ejemplar || g.cruce_diferente_ejemplar || g.permite_cruces !== false);
                  const incentivoGrupo = strNum((g as unknown as Record<string, unknown>).devolucion_porcentaje as string | number | null | undefined) || "0";
                  const cupoGrupo = strNum(g.cupo_tabla) || "100";

                  return (

                    <div
                      key={String(g.id)}
                      data-row-legacy="flex items-center justify-between gap-2 whitespace-nowrap rounded-lg border border-line bg-slate-50"
                      className="grid grid-cols-1 lg:grid-cols-12 items-center gap-3 lg:gap-4 rounded-xl border border-slate-200/90 bg-slate-50/90 px-3 py-2.5 transition-colors hover:bg-white hover:shadow-sm"
                    >
                      {/* Columna 1: Nombre del Grupo / Convenio y Estado */}
                      <div className="lg:col-span-3 flex min-w-0 items-center gap-2">
                        <LogoDisplay src={g.logo_url} alt={`Logo de ${g.nombre}`} tamano={28} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-black text-slate-800" title={g.nombre}>{g.nombre}</span>
                            {g.es_principal ? (
                              <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[8px] font-black text-white">PRINCIPAL</span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[9px] font-bold">
                            <span className={g.activo !== false ? "text-emerald-700" : "text-rose-600"}>
                              {g.activo !== false ? "● Activo" : "○ Inactivo"}
                            </span>
                            <span className="text-slate-400">·</span>
                            <span className="text-slate-500">
                              🗓️ {etiquetaDia(g.dia_inicio_semana ?? 1)}–{etiquetaDia(g.dia_fin_semana ?? 7)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Columna 2: Moneda interna de cálculo y % de Comisión */}
                      <div className="lg:col-span-3 flex flex-wrap items-center gap-1">
                        <span className={`rounded px-1.5 py-0.5 text-[9px] font-black ${esVes ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                          {g.moneda ?? "USD"}
                        </span>
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold text-slate-700" title="Moneda de cuadre">
                          Cuadre: {g.moneda_cuadre || g.moneda || "USD"}
                        </span>
                        <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[9px] font-black text-indigo-800" title="Comisión Entre Tercios (Puestos) sobre el monto decidido">
                          🎯 {strNum(g.comision_default) || "2.5"}%
                        </span>
                        {CONCEPTOS_CONVENIO.filter((c) => c.propio).map((c) => {
                          const propio = (g as unknown as Record<string, unknown>);
                          const valor = strNum(propio[c.campo] as string | number | null | undefined);
                          return (
                            <span
                              key={c.clave}
                              className={`rounded px-1 py-0.5 text-[8px] font-bold ${valor ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-400"}`}
                              title={valor ? `${c.etiqueta}: ${valor}% por convenio` : `${c.etiqueta}: hereda Puestos (${strNum(g.comision_default) || "2.5"}%)`}
                            >
                              {c.emoji} {valor ? `${valor}%` : "–"}
                            </span>
                          );
                        })}
                      </div>

                      {/* Columna 3: Configuración Operativa (Aval, Incentivo y Cruces) */}
                      <div className="lg:col-span-2 flex flex-wrap items-center gap-1.5">
                        <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[9px] font-black text-sky-800" title="Límite / Aval base por defecto del grupo">
                          🛡️ Aval: {cupoGrupo}
                        </span>
                        <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-black text-purple-800" title="Porcentaje de Incentivo / Devolución a favor">
                          🎁 Inc: +{incentivoGrupo}%
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] font-black ${
                            conCrucesGrupo ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"
                          }`}
                          title="Permisos de cruces de ejemplares"
                        >
                          {conCrucesGrupo ? "🔀 Cruces" : "🚫 Sin Cruces"}
                        </span>
                      </div>

                      {/* Columna 4: Accesos y Comunidad (Participantes y Operadores diferenciados) */}
                      <div className="lg:col-span-2 flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setPestanaModalGrupo("participantes");
                            setEditarComisiones(false);
                            setBusquedaParticipante("");
                            setEditando(g);
                          }}
                          className="rounded-lg bg-indigo-50 border border-indigo-200 px-2 py-1 text-[10.5px] font-black text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300 flex items-center gap-1 transition shadow-2xs cursor-pointer"
                          title="Ver participantes de este grupo en el modal"
                        >
                          <span>👥</span>
                          <span>{conteoPorGrupo.get(String(g.id)) ?? 0}</span>
                          <span className="hidden sm:inline">part.</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setPestanaModalGrupo("operadores");
                            setEditarComisiones(false);
                            setEditando(g);
                          }}
                          className="rounded-lg bg-emerald-50 border border-emerald-200 px-2 py-1 text-[10.5px] font-black text-emerald-700 hover:bg-emerald-100 hover:border-emerald-300 flex items-center gap-1 transition shadow-2xs cursor-pointer"
                          title="Gestionar operadores móviles de acceso celular"
                        >
                          <span>📱</span>
                          <span className="hidden sm:inline">Operadores</span>
                        </button>
                      </div>

                      {/* Columna 5: Acciones de Grupo alineadas a la derecha */}
                      <div className="lg:col-span-2 flex shrink-0 items-center justify-end gap-1">

                        <button

                          className="rounded px-1.5 py-1 text-[11px] font-bold bg-slate-200 text-slate-700 hover:bg-slate-300"

                          onClick={() => {

                            setPestanaModalGrupo("convenio");
                            setEditarComisiones(false);

                            setEditando(g);

                          }}

                          title="Editar grupo"

                        >

                          <span>✏️</span>

                        </button>

                        <button

                          className="rounded bg-indigo-50 px-1.5 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100"

                          onClick={() => {

                            setPestanaModalGrupo("convenio");
                            setEditando(g);

                            setEditarComisiones(true);

                          }}

                          title="Comisiones por convenio del grupo"

                        >

                          <span>💰</span>

                        </button>

                        <button

                          className="rounded bg-emerald-50 px-1.5 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100"

                          onClick={() => {

                            setReporteGrupo(String(g.id));

                            setReporteAbierto(true);

                          }}

                          title="Reporte de comisiones del grupo"

                        >

                          <span>📈</span>

                        </button>

                        <button

                          className={`rounded px-1.5 py-1 text-[11px] font-bold ${g.activo !== false ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" : "bg-red-100 text-red-600 hover:bg-red-200"}`}

                          onClick={() => void toggleGrupo(g)}

                          title={g.activo !== false ? "Desactivar" : "Activar"}

                        >

                          <span>{g.activo !== false ? "\u{1F7E2}" : "\u26AA"}</span>

                        </button>

                        {g.es_principal ? null : (

                          <button

                            className="rounded bg-red-50 px-1.5 py-1 text-[11px] text-red-600 hover:bg-red-100"

                            onClick={() => void eliminarGrupo(g)}

                            title="Eliminar"

                          >

                            <span>🗑️</span>

                          </button>

                        )}

                      </div>

                    </div>


                  );

                })

              )}

            </div>

          </div>



        </div>



        {/* ---------------- Tipos de Jugada (CRUD) — pestaña propia ---------------- */}

        <div className={pestana === "tipos" ? "space-y-5" : "hidden"}>

          <div className="rounded-2xl border border-line bg-white p-4">

            <h3 className="mb-2 border-b border-line pb-2 text-xs font-black uppercase tracking-wider text-slate-700">

              <span className="mr-1 text-amber-500">🎲</span> Tipos de Jugada

              <p className="mt-1 text-[10px] font-normal normal-case text-slate-400">

                Tipos que alimentan los convenios por grupo. Los inactivos no aparecen en la edición de convenios.

              </p>

            </h3>

            <div className="flex items-center gap-2">

              <input

                value={nuevoTipo}

                onChange={(e) => setNuevoTipo(e.target.value.toUpperCase())}

                onKeyDown={(e) => e.key === "Enter" && void crearTipo()}

                placeholder="Nuevo tipo (ej: POLLAS)"

                className={inp + " flex-1 uppercase"}

              />

              <Button size="sm" onClick={() => void crearTipo()}>

                <span className="mr-1">➕</span> Crear

              </Button>

            </div>

            <div className="mt-3 flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-1">

              {tipos.length === 0 ? (

                <p className="text-xs italic text-slate-400">Sin tipos de jugada.</p>

              ) : (

                tipos.map((t) => (

                  <div key={String(t.id)} className="flex items-center gap-2 rounded-lg border border-line bg-slate-50 px-2 py-1.5">

                    <div className="min-w-0 flex-1">

                      {editandoTipo && String(editandoTipo.id) === String(t.id) ? (

                        <input

                          value={editandoTipo.nombre}

                          onChange={(e) => setEditandoTipo({ ...editandoTipo, nombre: e.target.value.toUpperCase() })}

                          onKeyDown={(e) => e.key === "Enter" && void guardarTipo()}

                          className={inp + " py-1 uppercase"}

                          autoFocus

                        />

                      ) : (

                        <>

                          <span className="text-xs font-bold uppercase text-slate-700">{t.nombre}</span>

                          {t.activo !== false ? (

                            <span className="ml-1 rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-black text-emerald-700">ACTIVO</span>

                          ) : (

                            <span className="ml-1 rounded bg-red-100 px-1 py-0.5 text-[9px] font-black text-red-600">INACTIVO</span>

                          )}

                        </>

                      )}

                    </div>

                    {editandoTipo && String(editandoTipo.id) === String(t.id) ? (

                      <>

                        <Button size="sm" onClick={() => void guardarTipo()}>

                          <span >💾</span>

                        </Button>

                        <Button size="sm" variant="outline" onClick={() => setEditandoTipo(null)}>

                          <span >✕</span>

                        </Button>

                      </>

                    ) : (

                      <>

                        <button className="rounded px-1.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-200" onClick={() => setEditandoTipo(t)} title="Renombrar">

                          <span >✏️</span>

                        </button>

                        <button

                          className={`rounded px-1.5 py-1 text-xs font-bold ${t.activo !== false ? "text-emerald-600 hover:bg-emerald-50" : "text-red-500 hover:bg-red-50"}`}

                          onClick={() => void toggleTipo(t)}

                          title={t.activo !== false ? "Desactivar" : "Activar"}

                        >

                          <span>{t.activo !== false ? "\u{1F7E2}" : "\u26AA"}</span>

                        </button>

                      </>

                    )}

                  </div>

                ))

              )}

            </div>

          </div>

        </div>



        {/* ---------------- Banquero por Modalidad — pestaña propia ---------------- */}

        <div className={pestana === "banquero" ? "space-y-5" : "hidden"}>

        <div className="h-fit rounded-2xl border border-line bg-white p-4">

          <h3 className="mb-2 border-b border-line pb-2 text-xs font-black uppercase tracking-wider text-slate-700">

            <span className="mr-1 text-amber-500">👔</span> Banquero por Modalidad

            <p className="mt-1 text-[10px] font-normal normal-case text-slate-400">

              Cliente del grupo que toma el lado contrario de las jugadas. Al liquidar, su saldo se mueve en espejo

              (si pierde el jugador gana el banquero y viceversa) y paga la comisión sobre el monto decidido, que

              recibe el grupo. Sin banquero o con comisión en 0% no se le cobra nada.

            </p>

          </h3>

          <div className="mb-2">

            <label className={etiqueta}>Grupo</label>

            <select

              value={grupoConvenio}

              onChange={(e) => void cargarConvenios(e.target.value)}

              className={inp + " font-bold"}

            >

              <option value="">Seleccione un grupo...</option>

              {gruposActivos.map((g) => (

                <option key={String(g.id)} value={String(g.id)}>

                  {g.nombre} ({g.moneda ?? "USD"})

                </option>

              ))}

            </select>

          </div>

          {!grupoConvenio ? (

            <p className="text-xs italic text-slate-400">Seleccione un grupo para configurar su banquero.</p>

          ) : (

            <div className="space-y-1.5">

              {banqueros.map((f) => (

                <div key={f.modalidad} className="rounded-lg border border-line bg-white px-2 py-1.5">

                  <div className="flex items-center gap-2">

                    <span className="w-24 shrink-0 text-[10px] font-black uppercase text-slate-600">

                      {ETIQUETA_MODALIDAD[f.modalidad]}

                    </span>

                    <select

                      value={f.banquero_cliente_id}

                      onChange={(e) =>

                        setBanqueros((bs) =>

                          bs.map((x) => (x.modalidad === f.modalidad ? { ...x, banquero_cliente_id: e.target.value } : x))

                        )

                      }

                      className={inp + " flex-1 text-[11px] font-bold"}

                    >

                      <option value="">— Sin banquero —</option>

                      {jugadoresGrupoConvenio.map((c) => (

                        <option key={String(c.id)} value={String(c.id)}>

                          {c.nombre}

                        </option>

                      ))}

                    </select>

                    <Button

                      variant="outline"

                      size="sm"

                      onClick={() =>

                        setBanqueros((bs) => bs.map((x) => (x.modalidad === f.modalidad ? { ...x, activo: !x.activo } : x)))

                      }

                    >

                      {f.activo ? "Activo" : "Inactivo"}

                    </Button>

                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-2">

                    <label className="flex cursor-pointer items-center gap-1 text-[10px] font-bold text-slate-500">

                      <input

                        type="checkbox"

                        className="rounded accent-primary-600"

                        checked={f.cobra_comision}

                        onChange={(e) =>

                          setBanqueros((bs) =>

                            bs.map((x) => (x.modalidad === f.modalidad ? { ...x, cobra_comision: e.target.checked } : x))

                          )

                        }

                      />

                      Cobrar comisión

                    </label>

                    <input

                      type="number"

                      step="0.01"

                      min={0}

                      value={f.comision_porcentaje}

                      disabled={!f.cobra_comision}

                      onChange={(e) =>

                        setBanqueros((bs) =>

                          bs.map((x) => (x.modalidad === f.modalidad ? { ...x, comision_porcentaje: e.target.value } : x))

                        )

                      }

                      className="w-16 rounded border border-line px-1 py-0.5 text-right text-[11px] font-bold text-amber-700 outline-none focus:ring-1 focus:ring-amber-400 disabled:opacity-40"

                    />

                    <span className="text-[10px] font-black text-slate-400">%</span>

                    <select

                      value={f.comision_base}

                      disabled={!f.cobra_comision}

                      onChange={(e) =>

                        setBanqueros((bs) =>

                          bs.map((x) =>

                            x.modalidad === f.modalidad ? { ...x, comision_base: e.target.value as BanqueroBase } : x

                          )

                        )

                      }

                      className="flex-1 rounded border border-line px-1 py-0.5 text-[10px] text-slate-600 outline-none focus:ring-1 focus:ring-amber-400 disabled:opacity-40"

                    >

                      {(Object.keys(ETIQUETA_BASE) as BanqueroBase[]).map((b) => (

                        <option key={b} value={b}>

                          {ETIQUETA_BASE[b]}

                        </option>

                      ))}

                    </select>

                    <Button variant="success" size="sm" onClick={() => void guardarBanqueroFila(f)}>

                      <span className="mr-1">💾</span> Guardar

                    </Button>

                  </div>

                </div>

              ))}

            </div>

          )}

        </div>

        </div>

      </div>



      {/* ---------------- Modal Editar Grupo ---------------- */}

      {editando ? (

        <div

          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"

          role="dialog"

          aria-modal="true"

          onClick={(e) => {

            if (e.target === e.currentTarget) setEditando(null);

          }}

        >

          <div className="w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">

            <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-800 px-4 py-3 text-xs font-black uppercase tracking-wider text-white backdrop-blur sm:px-5">

              <span>

                <span className="mr-2">✏️</span> Grupo: {editando.nombre}

              </span>

              <button className="text-slate-300 hover:text-white" onClick={() => setEditando(null)} aria-label="Cerrar">

                <span>✕</span>

              </button>

            </div>

            {/* Pestañas del Modal */}
            <div className="flex border-b border-slate-200 bg-slate-100 px-4 pt-2 gap-2 sm:px-5 overflow-x-auto">
              <button
                type="button"
                onClick={() => setPestanaModalGrupo("convenio")}
                className={`px-3 py-2 text-xs font-black uppercase tracking-wider rounded-t-lg transition-colors border-b-2 flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                  pestanaModalGrupo === "convenio"
                    ? "bg-white text-indigo-700 border-indigo-600 shadow-sm"
                    : "text-slate-600 border-transparent hover:text-slate-900 hover:bg-slate-200/60"
                }`}
              >
                <span>🏢</span> Ficha y Convenio
              </button>
              <button
                type="button"
                onClick={() => {
                  setPestanaModalGrupo("participantes");
                  setBusquedaParticipante("");
                }}
                className={`px-3 py-2 text-xs font-black uppercase tracking-wider rounded-t-lg transition-colors border-b-2 flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                  pestanaModalGrupo === "participantes"
                    ? "bg-white text-indigo-700 border-indigo-600 shadow-sm"
                    : "text-slate-600 border-transparent hover:text-slate-900 hover:bg-slate-200/60"
                }`}
              >
                <span>👥</span> Participantes ({participantesDelGrupo.length})
              </button>
              <button
                type="button"
                onClick={() => setPestanaModalGrupo("operadores")}
                className={`px-3 py-2 text-xs font-black uppercase tracking-wider rounded-t-lg transition-colors border-b-2 flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                  pestanaModalGrupo === "operadores"
                    ? "bg-white text-indigo-700 border-indigo-600 shadow-sm"
                    : "text-slate-600 border-transparent hover:text-slate-900 hover:bg-slate-200/60"
                }`}
              >
                <span>📱</span> Operadores Celular
              </button>
            </div>

            {/* Contenido según la pestaña activa del modal */}
            {pestanaModalGrupo === "convenio" ? (
              <>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">

              <div>

                <label className={etiqueta}>Nombre</label>

                <input

                  value={editando.nombre}

                  onChange={(e) => setEditando({ ...editando, nombre: e.target.value.toUpperCase() })}

                  className={inp + " font-black uppercase"}

                />

              </div>

              <LogoUploader
                label="Logo del Grupo (PNG)"
                value={editando.logo_url ?? null}
                onChange={(logo_url) => setEditando({ ...editando, logo_url })}
                hint="Se mostrará junto al nombre del grupo en el Reporte de Liquidación."
              />

              <div className="grid grid-cols-3 gap-3">

                <div>

                  <label className={etiqueta}>Moneda Venta</label>

                  <select

                    value={editando.moneda ?? "USD"}

                    onChange={(e) => {
                      const m = e.target.value;
                      const esBs = m === "VES";
                      const cupoActual = editando.cupo_tabla;
                      const reajustar = cupoActual == null || cupoActual === 100 || cupoActual === 3 || cupoActual === 3000;
                      setEditando({
                        ...editando,
                        moneda: m,
                        cupo_tabla: reajustar ? (esBs ? 3000 : 3) : cupoActual,
                      });
                    }}

                    className={inp + " font-bold"}

                  >

                    <option value="USD">USD</option>

                    <option value="VES">VES</option>

                  </select>

                </div>

                <div>

                  <label className={etiqueta}>Moneda Cuadre</label>

                  <select

                    value={editando.moneda_cuadre ?? "USD"}

                    onChange={(e) => setEditando({ ...editando, moneda_cuadre: e.target.value })}

                    className={inp + " font-bold"}

                  >

                    <option value="USD">USD</option>

                    <option value="VES">VES</option>

                  </select>

                </div>

                <div>

                  <label className={etiqueta}>Cupos/Tabla</label>

                  <input

                    type="number"

                    min={1}

                    value={editando.cupo_tabla ?? (editando.moneda === "VES" ? 3000 : 3)}

                    onChange={(e) =>
                      setEditando({
                        ...editando,
                        cupo_tabla: parseInt(e.target.value) || (editando.moneda === "VES" ? 3000 : 3),
                      })
                    }

                    className={inp + " font-bold text-right"}

                  />

                </div>

              </div>

              <div className={editarComisiones ? "rounded-2xl ring-2 ring-indigo-400 ring-offset-2" : ""}>

                <CamposComisionesConvenio

                  valores={valoresConvenioDeGrupo(editando as unknown as Record<string, unknown>)}

                  onCambio={setConvenioEdicion}

                  ayuda="Comisión por convenio de este grupo, sobre el MONTO DECIDIDO. Vacío = hereda la de Entre Tercios."

                />

              </div>

              <div>

                <label className={etiqueta}>Responsable</label>

                <input

                  value={editando.responsable ?? ""}

                  onChange={(e) => setEditando({ ...editando, responsable: e.target.value.toUpperCase() })}

                  className={inp + " uppercase"}

                />

              </div>

              <div>

                <label className={etiqueta}>Banco (Cuadre)</label>

                <select

                  value={desglosarCuenta(editando.cuenta_bancaria).banco}

                  onChange={(e) =>

                    setEditando({

                      ...editando,

                      cuenta_bancaria: componerCuenta(e.target.value, desglosarCuenta(editando.cuenta_bancaria).numero),

                    })

                  }

                  className={inp + " uppercase"}

                >

                  <option value="">Seleccione el banco...</option>

                  {BANCOS_VZLA.map((b) => (

                    <option key={b.codigo} value={`${b.codigo} · ${b.nombre}`}>

                      {b.codigo} · {b.nombre}

                    </option>

                  ))}

                </select>

              </div>

              <div>

                <label className={etiqueta}>

                  Número de Cuenta <span className="normal-case text-slate-400">(opcional)</span>

                </label>

                <input

                  value={desglosarCuenta(editando.cuenta_bancaria).numero}

                  onChange={(e) =>

                    setEditando({

                      ...editando,

                      cuenta_bancaria: componerCuenta(

                        desglosarCuenta(editando.cuenta_bancaria).banco,

                        formatearCuenta(e.target.value)

                      ),

                    })

                  }

                  className={inp + " uppercase"}

                  maxLength={20}

                />

              </div>

              <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-700">

                <input

                  type="checkbox"

                  checked={editando.es_principal === true}

                  onChange={(e) => setEditando({ ...editando, es_principal: e.target.checked })}

                  className="rounded accent-amber-500"

                />

                Es el grupo Principal

              </label>

              {editando.es_principal === true ? (

                <PanelVisibilidadPrincipal

                  principal={editando}

                  grupos={grupos}

                  global={editando.visibilidad_global_principal === true}

                  autorizados={editando.grupos_autorizados_ver_principal ?? []}

                  onGlobal={(v) =>

                    setEditando({

                      ...editando,

                      visibilidad_global_principal: v,

                      // Con el global ON la lista no aporta: se limpia en memoria.

                      grupos_autorizados_ver_principal: v

                        ? []

                        : editando.grupos_autorizados_ver_principal ?? [],

                    })

                  }

                  onAutorizados={(ids) =>

                    setEditando({ ...editando, grupos_autorizados_ver_principal: ids })

                  }

                />

              ) : null}


              <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                <h3 className="mb-2 text-[10px] font-black uppercase tracking-widest text-amber-800">Configuración de Cruces (Tercios)</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-700">
                    <input type="checkbox" checked={editando.cruce_mismo_ejemplar === true} onChange={(e) => setEditando({ ...editando, cruce_mismo_ejemplar: e.target.checked })} className="rounded accent-amber-500" />
                    Cruzar Mismo Ejemplar
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-700">
                    <input type="checkbox" checked={editando.cruce_diferente_ejemplar === true} onChange={(e) => setEditando({ ...editando, cruce_diferente_ejemplar: e.target.checked })} className="rounded accent-amber-500" />
                    Cruzar Diferentes Ejemplares
                  </label>
                </div>
              </section>

              <div>

                <label className={etiqueta}>Día de Inicio de Facturación</label>

                <select

                  value={editando.dia_inicio_semana ?? 1}

                  onChange={(e) => setEditando({ ...editando, dia_inicio_semana: parseInt(e.target.value) || 1 })}

                  className={inp + " uppercase"}

                >

                  {DIAS_SEMANA.map((d) => (

                    <option key={d.valor} value={d.valor}>

                      {d.nombre}

                    </option>

                  ))}

                </select>

              </div>

              <div>

                <label className={etiqueta}>Día de Corte / Cierre</label>

                <select

                  value={editando.dia_fin_semana ?? 7}

                  onChange={(e) => setEditando({ ...editando, dia_fin_semana: parseInt(e.target.value) || 7 })}

                  className={inp + " uppercase"}

                >

                  {DIAS_SEMANA.map((d) => (

                    <option key={d.valor} value={d.valor}>

                      {d.nombre}

                    </option>

                  ))}

                </select>

              </div>

              <div>

                <label className={etiqueta}>⏱️ Ventana de Revisión y Reclamos</label>

                <select

                  value={editando.ventana_reclamos ?? "SOLO_DIA_EN_CURSO"}

                  onChange={(e) => setEditando({ ...editando, ventana_reclamos: e.target.value })}

                  className={inp + " uppercase"}

                >

                  <option value="SOLO_DIA_EN_CURSO">Solo el Día en Curso</option>

                  <option value="SEMANA_EN_CURSO">Toda la Semana en Curso</option>

                </select>

                <p className="mt-1 text-[10px] text-slate-400">

                  Hasta cuándo el jugador puede reclamar una jugada o pedir incluir una "no relacionada" desde el Portal.

                </p>

              </div>

            </div>

            <div className="flex shrink-0 justify-end gap-3 border-t border-line bg-slate-50 p-4">
              <Button variant="outline" size="sm" onClick={() => setEditando(null)}>

                Cancelar

              </Button>

              <Button size="sm" onClick={() => void guardarEdicion()} disabled={guardando}>

                {guardando ? <span className="mr-1">⏳</span> : <span className="mr-1">💾</span>} Guardar

                Grupo

              </Button>

            </div>
          </>
        ) : pestanaModalGrupo === "participantes" ? (
          <>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              {/* Banner informativo de participantes */}
              <div className="rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50/80 via-sky-50/60 to-white p-3.5 shadow-2xs">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <span className="text-2xl leading-none">👥</span>
                    <div>
                      <h4 className="text-xs font-black uppercase tracking-wider text-indigo-950">
                        Participantes y Clientes de {editando.nombre}
                      </h4>
                      <p className="text-[11px] text-indigo-800 leading-snug">
                        Jugadores con cuenta activa pertenecientes a este grupo. Sus jugadas y balances computan exclusivamente para {editando.nombre}.
                      </p>
                    </div>
                  </div>
                  <Link
                    href="/clientes"
                    className="rounded-lg bg-indigo-600 hover:bg-indigo-500 font-bold text-xs text-white px-3 py-1.5 shadow-xs flex items-center gap-1.5 transition"
                  >
                    <span>👥</span> Ir a Cartera de Clientes
                  </Link>
                </div>
              </div>

              {/* Buscador y estadísticas */}
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="relative flex-1 min-w-[220px] max-w-sm">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
                  <input
                    type="text"
                    value={busquedaParticipante}
                    onChange={(e) => setBusquedaParticipante(e.target.value)}
                    placeholder="Buscar participante por nombre…"
                    className="w-full rounded-lg border border-slate-300 py-1.5 pl-8 pr-7 text-xs outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 bg-white"
                  />
                  {busquedaParticipante && (
                    <button
                      onClick={() => setBusquedaParticipante("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs font-black text-slate-600">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 border border-slate-200">
                    Total: {participantesFiltrados.length} participante(s)
                  </span>
                </div>
              </div>

              {/* Listado limpio en cuadrícula */}
              {participantesFiltrados.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-10 text-center text-slate-400 rounded-xl border border-dashed border-slate-200 bg-slate-50/50">
                  <span className="text-3xl mb-2">👤</span>
                  <p className="text-xs font-bold text-slate-600">No se encontraron participantes en este grupo.</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Puedes crear o asignar clientes a este grupo desde el módulo de Clientes.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-[380px] overflow-y-auto pr-1">
                  {participantesFiltrados.map((c) => (
                    <div
                      key={String(c.id)}
                      className="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 hover:shadow-2xs transition"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="h-8 w-8 rounded-lg bg-indigo-100 text-indigo-700 font-black text-xs flex items-center justify-center shrink-0">
                          {c.nombre.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <h5 className="text-xs font-black text-slate-800 truncate" title={c.nombre}>
                            {c.nombre}
                          </h5>
                          <span className="text-[9.5px] text-slate-400 font-mono">
                            ID: {String(c.id).slice(0, 8)}
                          </span>
                        </div>
                      </div>
                      <span className="rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[9px] font-black border border-emerald-200 shrink-0">
                        ● Activo
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex shrink-0 justify-end gap-3 border-t border-line bg-slate-50 p-4">
              <Button size="sm" onClick={() => setEditando(null)} className="bg-slate-800 text-white font-bold cursor-pointer">
                Listo / Cerrar
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <PestanaOperadoresGrupo
                grupoId={editando.id}
                grupoNombre={editando.nombre}
                onActualizado={() => void recargar()}
              />
            </div>
            <div className="flex shrink-0 justify-end gap-3 border-t border-line bg-slate-50 p-4">
              <Button size="sm" onClick={() => setEditando(null)} className="bg-slate-800 text-white font-bold cursor-pointer">
                Listo / Cerrar
              </Button>
            </div>
          </>
        )}

          </div>

        </div>

      ) : null}



      <ToastHost />

    </div>

  );

}