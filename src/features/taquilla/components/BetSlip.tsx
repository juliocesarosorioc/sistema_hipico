"use client";

import { useEffect, useMemo, useState } from "react";
import { useTaquillaStore } from "@/shared/store/useTaquillaStore";
import { validarComando, detectarModalidad, clasificarLineaRapida } from "@/features/taquilla/lib/validar";
import { resolverClientes } from "@/features/taquilla/lib/normalizar";
import { calcularReparto } from "@/features/taquilla/lib/reparto";
import { venderJugada, claveIdempotenciaJugada } from "@/features/taquilla/lib/venta";
import { Input } from "@/shared/components/ui/Input";
import { DateInput } from "@/shared/components/ui/DateInput";
import { Button } from "@/shared/components/ui/Button";
import { SearchableSelect } from "@/shared/components/ui/SearchableSelect";
import { DesgloseProyectado } from "@/features/taquilla/components/DesgloseProyectado";
import { useHipodromosActivos } from "@/shared/store/useHipodromosStore";
import { useRegistroCentralOpts } from "@/shared/store/useRegistroCentral";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import { usuarioVigente } from "@/features/seguridad/lib/vigente";
import { ToggleModalidadTiempo } from "@/features/jugadas/components/ToggleModalidadTiempo";
import { marcarAdelantadaTrasVenta } from "@/features/jugadas/lib/marcar-adelantadas";
import { atribuirTrasVenta } from "@/features/grupos/lib/marcar-atribucion";
import { atribuirDesdePrincipal } from "@/features/grupos/lib/atribucion-grupo";
import { principalDe } from "@/features/grupos/lib/visibilidad-principal";
import { WPS_PLANIFICACION } from "@/features/motores/lib/wps-planificacion";
import { useAuthStore } from "@/shared/store/useAuthStore";
import {
  listarClientesVenta,
  listarGruposVenta,
  comisionJugadasDeGrupo,
  saldoDeCliente,
  textoDisponible,
  clientePerteneceAGrupo,
  filtrarClientesPorGrupo,
  clientesPertenecenAlMismoGrupo,
  type ClienteVenta,
  type GrupoVenta,
} from "@/features/grupos/lib/grupos";

/**
 * Ejemplos de comando. Los "100 W / 100 P / 100 S" NO se ofrecen: W.P.S. está
 * 🚧 en planificación y no se promociona una jugada inactiva (el motor sigue
 * reconociendo el comando por atrás, intacto en motores/wps.ts).
 */
const EJEMPLOS = ["100 2n", "50 3p", "200 1 y 2n", "100 10/PP", "400 1/2n y 2n"];

/** Ejemplares válidos: la pizarra va de 1 a 8. */
function caballoValido(v: string): string | null {
  const n = v.trim();
  if (!/^\d{1,2}$/.test(n)) return null;
  const i = Number(n);
  return i >= 1 && i <= 8 ? n : null;
}

const clave = (s: unknown) => String(s ?? "").trim().toUpperCase();

/**
 * Boleto de Apuestas PERSISTENTE — Taquilla.
 *
 * Antes la Taquilla vivía SOLO en memoria (zustand/localStorage): el operador
 * cargaba la jugada, se quedaba en su sesión y nadie más la veía; al liquidar no
 * aparecía en `tickets_apuestas`. Ahora el BetSlip pide el CONTEXTO de la carrera
 * (fecha · hipódromo · carrera), el CLIENTE 1 (a quien se le cobra) y el dador
 * opcional, y llama a `club_vender_jugada` (RPC transaccional: valida tope
 * `saldo+aval`, cobra y crea el ticket 'Pendiente' en un solo viaje), espejo de
 * la Carga Individual de Gestión de Jugadas.
 *
 * El ticket real queda también en la sesión (`ticketId`), así que quitarlo desde
 * `ListaTickets` ANULA la venta y devuelve el saldo.
 */
export function BetSlip() {
  // ── Contexto de la jugada (carrera) ─────────────────────────────────────
  const [fecha, setFecha] = useState(() => hoyLocal());
  const [hipodromo, setHipodromo] = useState("LA RINCONADA");
  const [carrera, setCarrera] = useState("1");
  const [comision, setComision] = useState("5");

  // ── Partes ──────────────────────────────────────────────────────────────
  const [cliente1, setCliente1] = useState("");
  const [cliente2, setCliente2] = useState("");

  // ── Comando ─────────────────────────────────────────────────────────────
  const [comando, setComando] = useState("");
  const [caballo, setCaballo] = useState("1");
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");
  const [registrando, setRegistrando] = useState(false);

  const agregarTicket = useTaquillaStore((s) => s.agregarTicket);
  // Modalidad de TIEMPO (PROMPT #4): misma que pinta TaquillaModule en su barra.
  const modalidadTiempo = useTaquillaStore((s) => s.modalidadTiempo);
  const setModalidadTiempo = useTaquillaStore((s) => s.setModalidadTiempo);
  const hipodromos = useHipodromosActivos();
  const { carrerasDe } = useRegistroCentralOpts(fecha);
  const [clientes, setClientes] = useState<ClienteVenta[]>([]);
  const [grupos, setGrupos] = useState<GrupoVenta[]>([]);

  useEffect(() => {
    let vivo = true;
    listarClientesVenta().then((c) => {
      if (vivo) setClientes(c);
    });
    // La comisión de las jugadas entre tercios sale del grupo (comision_default).
    listarGruposVenta().then((g) => {
      if (vivo) setGrupos(g);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const opcionesHipodromos = useMemo(
    () => hipodromos.map((h) => ({ value: String(h.value), label: String(h.label) })),
    [hipodromos]
  );

  /** Números de carrera del día para el hipódromo elegido (1..N); si la matriz
   *  aún no responde, se ofrece 1..12 para no dejar al operador sin selector. */
  const opcionesCarreras = useMemo(() => {
    const nums = carrerasDe(hipodromo)
      .map((c) => Number(c.carrera))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
    const lista = nums.length ? nums : Array.from({ length: 12 }, (_, i) => i + 1);
    return lista.map((n) => ({ value: String(n), label: `Carrera ${n}` }));
  }, [carrerasDe, hipodromo]);

  const grupoActivo = useAuthStore((s) => s.grupoActivo);
  const miGrupoId = useAuthStore((s) => s.grupoId);

  const grupoSesion = useMemo(() => {
    if (grupoActivo && grupoActivo !== "null" && String(grupoActivo).trim() !== "") {
      return String(grupoActivo).trim();
    }
    if (miGrupoId && miGrupoId !== "null" && String(miGrupoId).trim() !== "") {
      return String(miGrupoId).trim();
    }
    return null;
  }, [grupoActivo, miGrupoId]);

  const nombreGrupoSesion = useMemo(() => {
    if (!grupoSesion) return "";
    const g = grupos.find((x) => String(x.id) === grupoSesion || String(x.nombre).toUpperCase() === grupoSesion.toUpperCase());
    return g?.nombre ?? grupoSesion;
  }, [grupos, grupoSesion]);

  const clientesDelGrupo = useMemo(() => {
    if (!grupoSesion) return [];
    return filtrarClientesPorGrupo(clientes, grupoSesion, grupos);
  }, [clientes, grupoSesion, grupos]);

  const opcionesClientes = useMemo(
    () =>
      [...new Map(clientesDelGrupo.map((c) => [clave(c.nombre), c])).values()]
        .map((c) => ({ value: String(c.nombre), label: String(c.nombre) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [clientesDelGrupo]
  );

  const opcionesCliente2 = useMemo(
    () => [
      { value: "BANCA", label: "🏛️ BANCA / CASA" },
      ...opcionesClientes,
    ],
    [opcionesClientes]
  );

  const c1 = useMemo(
    () =>
      clientesDelGrupo.find(
        (c) =>
          clave(c.nombre) === clave(cliente1) ||
          (c.seudonimo && clave(c.seudonimo) === clave(cliente1)) ||
          clave(c.id) === clave(cliente1)
      ) ?? null,
    [clientesDelGrupo, cliente1]
  );

  const c1EnOtroGrupo = useMemo(
    () =>
      !c1 && cliente1.trim()
        ? clientes.find(
            (c) =>
              clave(c.nombre) === clave(cliente1) ||
              (c.seudonimo && clave(c.seudonimo) === clave(cliente1)) ||
              clave(c.id) === clave(cliente1)
          ) ?? null
        : null,
    [c1, cliente1, clientes]
  );

  const c2 = useMemo(
    () =>
      clientesDelGrupo.find(
        (c) =>
          clave(c.nombre) === clave(cliente2) ||
          (c.seudonimo && clave(c.seudonimo) === clave(cliente2)) ||
          clave(c.id) === clave(cliente2)
      ) ?? null,
    [clientesDelGrupo, cliente2]
  );

  const c2EnOtroGrupo = useMemo(
    () =>
      !c2 && cliente2.trim() && !["BANCA", "CASA"].includes(cliente2.trim().toUpperCase())
        ? clientes.find(
            (c) =>
              clave(c.nombre) === clave(cliente2) ||
              (c.seudonimo && clave(c.seudonimo) === clave(cliente2)) ||
              clave(c.id) === clave(cliente2)
          ) ?? null
        : null,
    [c2, cliente2, clientes]
  );

  /** Grupo del Cliente 1: dueño de la comisión de las jugadas entre tercios. */
  const grupoDeC1 = useMemo(
    () =>
      c1?.grupo_id != null
        ? String(c1.grupo_id)
        : c1?.grupos[0] != null
          ? String(c1.grupos[0])
          : null,
    [c1]
  );

  /**
   * Prellena COM % con la comisión del grupo del Cliente 1 y la deja editable.
   * Es la ÚNICA comisión de las "jugadas entre tercios"; al cambiar de grupo se
   * refresca el valor pactado (el operador puede ajustarlo puntualmente).
   */
  useEffect(() => {
    const c = comisionJugadasDeGrupo(grupos, grupoDeC1);
    if (c != null) setComision(String(c));
  }, [grupoDeC1, grupos]);

  const comisionNum = useMemo(() => {
    const n = parseFloat(String(comision).replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : 5;
  }, [comision]);

  // Detección inteligente si el operador tipea los nombres de cliente dentro del comando (ej: "100 2n Pedro Juan")
  useEffect(() => {
    const t = String(comando ?? "").trim();
    if (!t) return;
    const clas = clasificarLineaRapida(t);
    if (clas && clas.ok && clas.restantes && clas.restantes.length > 0) {
      const res = resolverClientes(clas.restantes, clientes);
      if (res.cliente1 && !cliente1) setCliente1(res.cliente1);
      if (res.cliente2 && !cliente2) setCliente2(res.cliente2);
      if (clas.caballo && !caballo) setCaballo(clas.caballo);
    }
  }, [comando, clientes, cliente1, cliente2, caballo]);

  const caballoOk = caballoValido(caballo);

  const comandoNormalizado = useMemo(() => {
    const t = String(comando ?? "").trim();
    if (!t) return "";
    const vDirecta = validarComando(t, comisionNum, caballoOk ?? undefined);
    if (vDirecta.ok) return t;
    const clas = clasificarLineaRapida(t);
    if (clas && clas.ok && clas.monto && clas.jugada) {
      return `${clas.monto} ${clas.jugada}`;
    }
    return t;
  }, [comando, comisionNum, caballoOk]);

  const validacion = useMemo(
    () => validarComando(comandoNormalizado, comisionNum, caballoOk ?? undefined),
    [comandoNormalizado, caballoOk, comisionNum]
  );

  const reparto = useMemo(
    () =>
      validacion.ok
        ? calcularReparto({
            jugada: validacion.tipo,
            ejemplares: caballoOk ?? "",
            monto: validacion.monto,
            cliente1: c1,
            cliente2: c2,
          })
        : null,
    [validacion, caballoOk, c1, c2]
  );
  const montoAutorizado = validacion.ok
    ? reparto?.montoAutorizado ?? validacion.monto
    : 0;
  const montoRecortado = validacion.ok && montoAutorizado < validacion.monto;
  const validacionAutorizada = useMemo(
    () =>
      validacion.ok && montoRecortado
        ? validarComando(`${montoAutorizado} ${validacion.tipo}`, comisionNum, caballoOk ?? undefined)
        : validacion,
    [validacion, montoAutorizado, montoRecortado, comisionNum, caballoOk]
  );
  const hipodromoValido = useMemo(
    () =>
      opcionesHipodromos.some(
        (h) =>
          h.value.trim().toUpperCase() === hipodromo.trim().toUpperCase() ||
          h.label.trim().toUpperCase() === hipodromo.trim().toUpperCase()
      ),
    [opcionesHipodromos, hipodromo]
  );

  const interaccionGrupoValida = useMemo(() => {
    if (!grupoSesion) return false;
    if (!c1 || !clientePerteneceAGrupo(c1, grupoSesion, grupos)) return false;
    if (c1EnOtroGrupo || c2EnOtroGrupo) return false;
    if (c2 && !clientePerteneceAGrupo(c2, grupoSesion, grupos)) return false;
    if (c1 && c2 && !clientesPertenecenAlMismoGrupo(c1, c2, grupos)) return false;
    return true;
  }, [grupoSesion, c1, c2, c1EnOtroGrupo, c2EnOtroGrupo, grupos]);

  const puedeRegistrar =
    validacion.ok &&
    validacionAutorizada.ok &&
    !!caballoOk &&
    !!c1 &&
    montoAutorizado > 0 &&
    !registrando &&
    hipodromoValido &&
    interaccionGrupoValida;

  const registrar = async () => {
    setError("");
    if (!validacion.ok) return;
    if (!hipodromo.trim() || !hipodromoValido) {
      setError("Debe seleccionar un hipódromo registrado en la plataforma.");
      return;
    }
    if (!grupoSesion) {
      setError("Debe seleccionar un grupo activo antes de registrar jugadas.");
      return;
    }
    if (c1EnOtroGrupo) {
      setError(`⛔ El cliente 1 «${c1EnOtroGrupo.nombre}» está registrado en otro grupo. No se permite registrar jugadas de un jugador en ningún otro grupo.`);
      return;
    }
    if (!c1 || !clientePerteneceAGrupo(c1, grupoSesion, grupos)) {
      setError(`⛔ El cliente 1 «${cliente1}» no pertenece al grupo ${nombreGrupoSesion || "activo"}. Solo se permiten jugadores de este grupo.`);
      return;
    }
    if (c2EnOtroGrupo) {
      setError(`⛔ El cliente 2 «${c2EnOtroGrupo.nombre}» está registrado en otro grupo. No se permite interacción entre jugadores de distintos grupos.`);
      return;
    }
    if (c2 && !clientePerteneceAGrupo(c2, grupoSesion, grupos)) {
      setError(`⛔ El cliente 2 «${c2.nombre}» no pertenece al grupo ${nombreGrupoSesion || "activo"}. No se permite interacción entre jugadores de distintos grupos.`);
      return;
    }
    if (c1 && c2 && !clientesPertenecenAlMismoGrupo(c1, c2, grupos)) {
      setError("⛔ Los jugadores pertenecen a grupos distintos. No se permite que los jugadores de un grupo interactúen en otro para nada.");
      return;
    }
    if (!caballoOk) {
      setError("El ejemplar debe ser un número del 1 al 8.");
      return;
    }
    if (!c1) {
      setError("Elegí el CLIENTE 1 (a quien se le cobra) del catálogo.");
      return;
    }
    if (montoAutorizado <= 0) {
      setError("No se puede registrar la jugada: ningún cliente tiene saldo disponible.");
      return;
    }
    if (!validacionAutorizada.ok) {
      setError(validacionAutorizada.motivo);
      return;
    }
    const nCarrera = Number(String(carrera).replace(/[^0-9]/g, "")) || 1;
    setRegistrando(true);
    try {
      const grupoId = grupoSesion || grupoDeC1;
      const auto = detectarModalidad(comando);
      const venta = await venderJugada({
        hipodromo,
        fecha,
        carrera: nCarrera,
        jugada: validacion.tipo,
        caballo: caballoOk,
        monto: montoAutorizado,
        clienteId: String(c1.id),
        grupoId,
        clienteDador: cliente2.trim() || c2?.nombre || null,
        clienteDadorId: c2?.id ? String(c2.id) : null,
        comision: comisionNum,
        // El banquero se negocia por modalidad: las americanas W/P/S van como 'WPS'.
        modalidad: auto === "AMERICANAS" ? "WPS" : auto,
        usuario: usuarioVigente(),
        idempotencia: claveIdempotenciaJugada(),
      });
      if (!venta.ok) {
        setError(venta.error ?? "No se pudo registrar la venta.");
        return;
      }
      agregarTicket({
        comando: montoRecortado ? `${montoAutorizado} ${validacion.tipo}` : comando,
        monto: montoAutorizado,
        observacion: montoRecortado
          ? `Solicitó $${validacion.monto}; se autorizaron $${montoAutorizado} por saldo disponible.`
          : undefined,
        caballo: caballoOk,
        gananciaProyectada: validacionAutorizada.proyeccion.gananciaProyectada,
        comision: validacionAutorizada.proyeccion.comision,
        cliente1: c1.nombre,
        cliente2: cliente2.trim() || c2?.nombre || undefined,
        fecha,
        hipodromo,
        carrera: nCarrera,
        ticketId: venta.ticketId,
        cliente1Id: String(c1.id),
        cliente2Id: c2 ? String(c2.id) : undefined,
        grupoId: grupoId ?? undefined,
      });
      // Modalidad de TIEMPO: si la jugada se cargó ADELANTADA, se marca el
      // ticket recién creado (`tickets_apuestas.es_adelantada`). La venta YA está
      // registrada por la RPC, así que esto es mejor esfuerzo: si el UPDATE no
      // pasa (columna sin migrar, RLS) se avisa y NO se revierte nada.
      let marca = "";
      if (modalidadTiempo === "ADELANTADA" && venta.ticketId) {
        const r = await marcarAdelantadaTrasVenta({ ids: [venta.ticketId] });
        marca = r.ok ? " · ⏳ adelantada" : ` · ⚠️ sin marcar: ${r.error ?? "revisá sql/jugadas_adelantadas.sql"}`;
      }
      // REGLA DE ORO CONTABLE: si el cliente pertenece a un Grupo Secundario y
      // la jugada salió de la cartelera del PRINCIPAL (Taquilla la publica el
      // principal para todos), se congela a quién se le DA CUENTA (su grupo) y
      // quién la PUBLICÓ (el principal). Mejor esfuerzo: la venta ya está hecha.
      let enrutado = "";
      const principal = principalDe(grupos);
      if (venta.ticketId && principal) {
        const atr = atribuirDesdePrincipal(grupoId, principal.id, principal.id);
        if (atr && atr.cruzada) {
          const ra = await atribuirTrasVenta({ ids: [venta.ticketId] }, atr);
          if (!ra.ok) enrutado = ` · ⚠️ sin atribuir cuenta: ${ra.error ?? "revisá sql/grupos_visibilidad_principal.sql"}`;
          else {
            const nombreCuenta = grupos.find((g) => String(g.id) === String(grupoId))?.nombre;
            enrutado = ` · 🧾 cuenta a ${nombreCuenta ?? "su grupo"}`;
          }
        }
      }
      setComando("");
      const observacionRecorte = montoRecortado
        ? ` · Observación: pidió $${validacion.monto}; se cargaron $${montoAutorizado} por saldo disponible`
        : "";
      setMensaje(
        `✅ Jugada #${venta.ticketId ?? "?"} registrada: $${montoAutorizado} ${validacion.tipo} · ${c1.nombre}` +
          (venta.yaExistia ? " (ya existía)" : "") +
          observacionRecorte +
          marca +
          enrutado
      );
      if (!montoRecortado) setTimeout(() => setMensaje(""), 3500);
    } finally {
      setRegistrando(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ── Contexto: fecha · hipódromo · carrera · partes ─────────────────── */}
      <div className="rounded-2xl border border-line bg-surface p-4">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-600">🧭 Carrera</h3>
          {/* Modalidad de TIEMPO (PROMPT #4): decide si la jugada que se acaba
              de cargar queda registrada como ⚡ EN VIVO (comportamiento
              histórico) o como ⏳ ADELANTADA (cargada antes de la carrera). */}
          <ToggleModalidadTiempo valor={modalidadTiempo} onChange={setModalidadTiempo} />
        </div>
        <p className="mb-3 text-[11px] text-slate-500">
          La venta se guarda en <b>tickets_apuestas</b> (descuenta el saldo del CLIENTE 1).
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <span className="block text-[11px] font-black uppercase tracking-wider text-slate-500">Fecha</span>
            <DateInput
              value={fecha}
              onFechaChange={(val) => setFecha(val || hoyLocal())}
              className="w-full text-xs font-bold"
            />
          </div>
          <Input
            label="Carrera"
            value={String(carrera)}
            onChange={(e) => setCarrera(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
            inputMode="numeric"
            placeholder="1"
            list="carreras-betslip"
          />
          <datalist id="carreras-betslip">
            {opcionesCarreras.map((o) => (
              <option key={o.value} value={o.value} />
            ))}
          </datalist>
          <Input
            label="COM %"
            value={comision}
            onChange={(e) => setComision(e.target.value.replace(/[^0-9.,]/g, "").slice(0, 5))}
            inputMode="decimal"
            placeholder="5"
          />
          <div className="col-span-2">
            <div className="mb-1 text-[11px] font-semibold text-slate-600">Hipódromo</div>
            <SearchableSelect
              options={opcionesHipodromos}
              value={hipodromo}
              onChange={setHipodromo}
              placeholder="Hipódromo…"
              allowCustom={false}
            />
          </div>
          <div className="col-span-2">
            <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-600">
              <span>Cliente 1 (juega)</span>
              {c1 ? (
                <span className={saldoDeCliente(c1) < 0 ? "text-danger-600" : "text-slate-500"}>
                  saldo {saldoDeCliente(c1).toFixed(0)} · disp {textoDisponible(c1)}
                </span>
              ) : cliente1.trim() ? (
                <span className="text-danger-600">no está en el catálogo</span>
              ) : null}
            </div>
            <SearchableSelect
              options={opcionesClientes}
              value={cliente1}
              onChange={setCliente1}
              placeholder="Cliente 1 (a quien se cobra)…"
              allowCustom={false}
              displayValue={cliente1}
            />
          </div>
          <div className="col-span-2">
            <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-600">
              <span>Cliente 2 (da) <span className="font-normal text-slate-400">— opcional</span></span>
              {c2 ? (
                <span className={saldoDeCliente(c2) < 0 ? "text-danger-600" : "text-slate-500"}>
                  saldo {saldoDeCliente(c2).toFixed(0)} · disp {textoDisponible(c2)}
                </span>
              ) : null}
            </div>
            <SearchableSelect
              options={opcionesCliente2}
              value={cliente2}
              onChange={setCliente2}
              placeholder="Cliente 2 (dador o BANCA)…"
              allowCustom={false}
              displayValue={cliente2}
            />
          </div>
        </div>
      </div>

      {/* ── Comando de jugada ─────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-600">
          🎟️ Comando de Jugada
        </h3>
        <p className="mb-3 text-[11px] text-slate-500">
          Escriba el monto y la jugada (Ej: <b>100 1 y 2n</b>). El motor valida en tiempo real:
          NINI, Puesto, A Premio (PP o 10/X), Combinada y Compuesta.
        </p>

        <Input
          label="Jugada"
          placeholder="Ej: 100 1 y 2n"
          value={comando}
          onChange={(e) => setComando(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && puedeRegistrar) void registrar();
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
              if (e.key === "Enter" && puedeRegistrar) void registrar();
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

        {/* Los ejemplos NO incluyen "100 W / P / S": W.P.S. está 🚧 en
            planificación y no se promociona en la barra de carga. */}
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
        </div>
        <p className="mt-2 text-[10px] text-slate-400">
          🚧 Las americanas <b>W / P / S (W.P.S.)</b> están en planificación y no están habilitadas
          para la carga ({WPS_PLANIFICACION}).
        </p>
      </div>

      <DesgloseProyectado validacion={comando.trim() ? validacionAutorizada : null} />
      {montoRecortado && reparto ? (
        <p className="rounded-xl bg-amber-500/10 p-3 text-center text-[11px] font-bold text-amber-700">
          ⚠️ {reparto.avisos[0] ?? `Solo se autoriza $${montoAutorizado} de $${validacion.ok ? validacion.monto : 0}.`}
          {" "}La observación quedará en el mensaje de registro.
        </p>
      ) : null}
      {validacion.ok && c1 && montoAutorizado <= 0 ? (
        <p className="rounded-xl bg-danger-500/10 p-3 text-center text-[11px] font-bold text-danger-600">
          🟥 Sin saldo disponible: no se puede registrar esta jugada.
        </p>
      ) : null}

      <Button
        variant={puedeRegistrar ? "success" : "default"}
        size="lg"
        disabled={!puedeRegistrar}
        onClick={() => void registrar()}
        className="w-full"
      >
        {registrando ? "⏳ Registrando…" : "💾 Registrar Apuesta"}
      </Button>

      {error && (
        <p className="rounded-xl bg-danger-500/10 p-3 text-center text-[11px] font-bold text-danger-600">
          ⚠️ {error}
        </p>
      )}

      {mensaje && (
        <p className="rounded-xl bg-success-500/10 p-3 text-center text-[11px] font-bold text-success-500">
          {mensaje}
        </p>
      )}
    </div>
  );
}

export default BetSlip;
