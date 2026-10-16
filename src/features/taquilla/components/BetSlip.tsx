"use client";

import { useEffect, useMemo, useState } from "react";
import { useTaquillaStore } from "@/shared/store/useTaquillaStore";
import { validarComando, detectarModalidad } from "@/features/taquilla/lib/validar";
import { venderJugada, claveIdempotenciaJugada } from "@/features/taquilla/lib/venta";
import { Input } from "@/shared/components/ui/Input";
import { Button } from "@/shared/components/ui/Button";
import { SearchableSelect } from "@/shared/components/ui/SearchableSelect";
import { DesgloseProyectado } from "@/features/taquilla/components/DesgloseProyectado";
import { useHipodromosActivos } from "@/shared/store/useHipodromosStore";
import { useRegistroCentralOpts } from "@/shared/store/useRegistroCentral";
import { hoyLocal } from "@/features/gaceta/lib/programa";
import { usuarioVigente } from "@/features/seguridad/lib/vigente";
import {
  listarClientesVenta,
  listarGruposVenta,
  comisionJugadasDeGrupo,
  saldoDeCliente,
  textoDisponible,
  type ClienteVenta,
  type GrupoVenta,
} from "@/features/grupos/lib/grupos";

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

  const opcionesClientes = useMemo(
    () =>
      [...new Map(clientes.map((c) => [clave(c.nombre), c])).values()]
        .map((c) => ({ value: String(c.nombre), label: String(c.nombre) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [clientes]
  );

  const c1 = useMemo(() => clientes.find((c) => clave(c.nombre) === clave(cliente1)) ?? null, [clientes, cliente1]);
  const c2 = useMemo(() => clientes.find((c) => clave(c.nombre) === clave(cliente2)) ?? null, [clientes, cliente2]);

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

  const caballoOk = caballoValido(caballo);
  const validacion = useMemo(
    () => validarComando(comando, comisionNum, caballoOk ?? undefined),
    [comando, caballoOk, comisionNum]
  );

  const puedeRegistrar = validacion.ok && !!caballoOk && !!c1 && !registrando;

  const registrar = async () => {
    setError("");
    if (!validacion.ok) return;
    if (!caballoOk) {
      setError("El ejemplar debe ser un número del 1 al 8.");
      return;
    }
    if (!c1) {
      setError("Elegí el CLIENTE 1 (a quien se le cobra) del catálogo.");
      return;
    }
    const nCarrera = Number(String(carrera).replace(/[^0-9]/g, "")) || 1;
    setRegistrando(true);
    try {
      const grupoId = grupoDeC1;
      const auto = detectarModalidad(comando);
      const venta = await venderJugada({
        hipodromo,
        fecha,
        carrera: nCarrera,
        jugada: validacion.tipo,
        caballo: caballoOk,
        monto: validacion.monto,
        clienteId: String(c1.id),
        grupoId,
        clienteDador: cliente2.trim() || c2?.nombre || null,
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
        comando,
        monto: validacion.monto,
        caballo: caballoOk,
        gananciaProyectada: validacion.proyeccion.gananciaProyectada,
        comision: validacion.proyeccion.comision,
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
      setComando("");
      setMensaje(
        `✅ Jugada #${venta.ticketId ?? "?"} registrada: $${validacion.monto} ${validacion.tipo} · ${c1.nombre}` +
          (venta.yaExistia ? " (ya existía)" : "")
      );
      setTimeout(() => setMensaje(""), 3500);
    } finally {
      setRegistrando(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ── Contexto: fecha · hipódromo · carrera · partes ─────────────────── */}
      <div className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-600">
          🧭 Carrera
        </h3>
        <p className="mb-3 text-[11px] text-slate-500">
          La venta se guarda en <b>tickets_apuestas</b> (descuenta el saldo del CLIENTE 1).
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Input
            label="Fecha"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value || hoyLocal())}
          />
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
              allowCustom
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
            <div className="mb-1 text-[11px] font-semibold text-slate-600">
              Cliente 2 (da) <span className="font-normal text-slate-400">— opcional</span>
            </div>
            <SearchableSelect
              options={opcionesClientes}
              value={cliente2}
              onChange={setCliente2}
              placeholder="Cliente 2 (dador)…"
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
          NINI, Puesto, A Premio (PP o 10/X), Combinada, Compuesta y las Americanas <b>W</b>, <b>P</b> y <b>S</b>.
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

        <div className="mt-2 flex flex-wrap gap-1.5">
          {[...EJEMPLOS, "100 W", "100 P", "100 S"].map((ej) => (
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
      </div>

      <DesgloseProyectado validacion={comando.trim() ? validacion : null} />

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
