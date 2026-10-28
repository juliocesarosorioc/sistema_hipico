"use client";

import { useEffect, useState, useMemo } from "react";
import { Button } from "@/shared/components/ui/Button";
import { getHorseColor } from "@/shared/lib/horseColors";
import { nombreHipodromoParaMostrar } from "@/features/hipodromos/lib/nombre";
import { TicketVentaPreview, type TicketVentaModel } from "@/features/tickets/components/TicketVentaPreview";
import type { SesionPortal } from "@/features/portal/lib/portal";
import {
  calcularRivales,
  venderMarca,
  claveIdempotencia,
  separarNumeros,
  type ConfigMarcas,
} from "@/features/marcas/lib/marcas";
import {
  verificarCupoMarcaDisponible,
  calcularPagoBrutoMarca,
  esMonedaBolivares,
} from "@/features/marcas/lib/control-riesgo-marcas";

type CarreraData = {
  hipodromo: string;
  carrera: number;
  fecha: string;
  cfg: ConfigMarcas;
  caballos?: Array<{ numero: number | string; nombre: string; retirado?: boolean }>;
};

type Props = {
  abierto: boolean;
  carreraData: CarreraData | null;
  sesion: SesionPortal;
  onCerrar: () => void;
  onComprado?: () => void;
};

export function ModalCompraMarcasCliente({
  abierto,
  carreraData,
  sesion,
  onCerrar,
  onComprado,
}: Props) {
  const [caballo, setCaballo] = useState("");
  const [rival, setRival] = useState("");
  const [monto, setMonto] = useState("12");
  const [saldoJugador, setSaldoJugador] = useState<number | null>(null);

  // Cupos y verificación
  const [verificandoCupo, setVerificandoCupo] = useState(false);
  const [cupoPermitido, setCupoPermitido] = useState(true);
  const [cupoMotivo, setCupoMotivo] = useState("");
  const [cupoDisponible, setCupoDisponible] = useState<number | null>(null);

  // Preview de venta
  const [preview, setPreview] = useState<TicketVentaModel | null>(null);
  const [errorPreview, setErrorPreview] = useState<string | null>(null);
  const [comprando, setComprando] = useState(false);

  const cfg = carreraData?.cfg;
  const hipo = carreraData?.hipodromo ?? "";
  const carr = carreraData?.carrera ?? 1;
  const fecha = carreraData?.fecha ?? "";

  const clienteId = sesion.cliente.id;
  const nombreJugador = sesion.cliente.nombre || sesion.cliente.seudonimo || "Cliente";
  const grupoId = (sesion as unknown as { grupo?: { id?: string | number; nombre?: string; moneda?: string } }).grupo?.id ?? sesion.cliente.grupo_id;
  const nombreGrupo = (sesion as unknown as { grupo?: { id?: string | number; nombre?: string; moneda?: string } }).grupo?.nombre ?? "Mi Grupo";
  const monedaGrupo = (sesion as unknown as { grupo?: { id?: string | number; nombre?: string; moneda?: string } }).grupo?.moneda ?? "USD";
  const esBs = esMonedaBolivares(monedaGrupo);
  const simboloMoneda = esBs ? "Bs. " : "$";
  const proporcionTexto = esBs ? "Proporción 120.000 para 100.000" : "Proporción 120 para 100";

  // Inicializar monto según la moneda al abrir
  useEffect(() => {
    if (abierto) {
      setMonto(esBs ? "60000" : "12");
    }
  }, [abierto, esBs]);

  // Lista de marcas y NV
  const listaMarcas = useMemo(() => (cfg ? separarNumeros(cfg.marcas) : []), [cfg]);
  const listaNv = useMemo(() => (cfg ? separarNumeros(cfg.nv) : []), [cfg]);
  const listaDeb = useMemo(() => (cfg ? separarNumeros(cfg.debutantes) : []), [cfg]);

  // Caballos que se pueden jugar: NO en NV, NO si son debutantes con debutantes_valen=false, y NO la 1ª marca
  const candidatosJugables = useMemo(() => {
    if (listaMarcas.length <= 1) return [];
    return listaMarcas.filter((num, idx) => {
      if (idx === 0) return false; // 1ª marca bloqueada
      if (listaNv.includes(num)) return false; // NV bloqueado
      if (cfg?.debutantes_valen === false && listaDeb.includes(num)) return false; // Debutante no vale
      return true;
    });
  }, [listaMarcas, listaNv, listaDeb, cfg]);

  // Rivales legales del caballo elegido
  const rivalesLegales = useMemo(() => {
    if (!caballo || !cfg) return [];
    const rivs = calcularRivales(
      caballo,
      cfg.marcas,
      cfg.nv,
      cfg.debutantes,
      cfg.debutantes_valen !== false
    );
    return rivs.candidatos.filter((r: string) => r !== caballo);
  }, [caballo, cfg]);

  // Preseleccionar primer rival si hay varios
  useEffect(() => {
    if (rivalesLegales.length > 0) {
      if (!rival || !rivalesLegales.includes(rival)) {
        setRival(rivalesLegales[0]);
      }
    } else {
      setRival("");
    }
  }, [rivalesLegales, rival]);

  // Saldo disponible del jugador desde su sesión
  useEffect(() => {
    if (!abierto) return;
    const disp = Number(sesion.resumen?.disponible ?? (sesion.resumen?.saldo ?? 0) + (sesion.resumen?.aval ?? 0));
    setSaldoJugador(disp);
  }, [abierto, sesion.resumen]);

  // Verificar cupo cada vez que cambia el caballo o monto
  useEffect(() => {
    if (!abierto || !caballo || !hipo || !fecha) return;
    const m = parseFloat(monto) || 6;
    let cancel = false;
    setVerificandoCupo(true);

    verificarCupoMarcaDisponible({
      hipodromo: hipo,
      carrera: carr,
      fecha,
      caballoNumero: caballo,
      grupoId,
      grupoNombre: nombreGrupo,
      jugadorNombre: nombreJugador,
      montoAComprar: m,
      moneda: monedaGrupo,
    }).then((res) => {
      if (cancel) return;
      setCupoPermitido(res.permitido);
      setCupoMotivo(res.motivo ?? "");
      setCupoDisponible(res.disponiblePlataforma ?? null);
      setVerificandoCupo(false);
    });

    return () => {
      cancel = true;
    };
  }, [abierto, caballo, monto, hipo, carr, fecha, grupoId, nombreGrupo, nombreJugador]);

  if (!abierto || !carreraData) return null;

  const montoNum = parseFloat(monto) || 0;
  // Regla de proporción: ganancia neta y premio potencial
  const pagoPotencial = calcularPagoBrutoMarca(montoNum);
  const gananciaNeta = (montoNum * 100) / 120;

  const iniciarCompra = () => {
    setErrorPreview(null);
    if (!caballo || !rival) {
      setErrorPreview("Selecciona tu ejemplar y el rival para el matchup.");
      return;
    }
    if (!(montoNum > 0)) {
      setErrorPreview("Indica un monto válido mayor a cero.");
      return;
    }
    if (esBs) {
      if (montoNum % 6000 !== 0 && montoNum % 6 !== 0) {
        setErrorPreview("En Marcas en Bolívares las jugadas deben ser en múltiplos de Bs. 6.000 (ej. Bs. 6.000, 12.000, 24.000, 60.000, 120.000).");
        return;
      }
    } else {
      if (montoNum % 6 !== 0) {
        setErrorPreview("En Marcas las jugadas deben ser en múltiplos de $6 (ej. $6, $12, $18, $24, $30, $60, $120).");
        return;
      }
    }
    if (!cupoPermitido) {
      setErrorPreview(cupoMotivo || "Cupo agotado para esta marca.");
      return;
    }
    if (saldoJugador !== null && montoNum > saldoJugador) {
      setErrorPreview(`Saldo insuficiente. Tu saldo/aval disponible es ${simboloMoneda}${saldoJugador.toLocaleString("es-VE", { minimumFractionDigits: 2 })}.`);
      return;
    }

    const cabData = carreraData.caballos?.find((c) => String(c.numero) === String(caballo));
    const rivData = carreraData.caballos?.find((c) => String(c.numero) === String(rival));

    const tkt: TicketVentaModel = {
      modalidad: "MARCAS",
      hipodromo: nombreHipodromoParaMostrar(hipo),
      fecha,
      carrera: carr,
      titulo: `MARCA #${caballo} vs #${rival}`,
      detalle: `Matchup: #${caballo} (${cabData?.nombre || "Ejemplar"}) vs #${rival} (${rivData?.nombre || "Rival"}) · ${proporcionTexto}`,
      jugador: nombreJugador,
      grupo: nombreGrupo,
      monto: montoNum,
      moneda: esBs ? "VES" : "USD",
      pago: pagoPotencial,
      saldoAntes: saldoJugador ?? undefined,
      saldoDespues: saldoJugador !== null ? Math.max(0, saldoJugador - montoNum) : undefined,
    };

    setPreview(tkt);
  };

  const confirmarCompra = async () => {
    if (!preview) return;
    setComprando(true);
    setErrorPreview(null);

    const res = await venderMarca({
      hipodromo: hipo,
      carrera: carr,
      fecha,
      caballo,
      rival,
      monto: montoNum,
      clienteId: String(clienteId ?? ""),
      grupoId: String(grupoId ?? ""),
      usuario: nombreJugador,
      idempotencia: claveIdempotencia(),
    });

    setComprando(false);
    if (!res.ok) {
      setErrorPreview(res.error ?? "No se pudo procesar la compra.");
      return;
    }

    setPreview(null);
    onComprado?.();
    onCerrar();
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 sm:p-5 overflow-y-auto"
        role="dialog"
        aria-modal
      >
        <div className="my-auto w-full max-w-xl rounded-2xl bg-white shadow-2xl overflow-hidden border border-slate-200">
          {/* CABECERA (ESTILO MONITOR TABLAS / MARCAS) */}
          <div className="bg-gradient-to-r from-indigo-900 via-blue-900 to-slate-900 px-5 py-3.5 text-white flex items-center justify-between">
            <div>
              <div className="text-[10px] font-black uppercase tracking-wider text-cyan-300">
                Compra de Marcas · {proporcionTexto}
              </div>
              <h3 className="text-base font-black">
                {nombreHipodromoParaMostrar(hipo)} · Carrera {carr}
              </h3>
            </div>
            <button
              type="button"
              onClick={onCerrar}
              className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-bold text-white hover:bg-white/20"
            >
              ✕ Cerrar
            </button>
          </div>

          {/* CUERPO DEL MODAL (GRUPO Y JUGADOR OCULTOS SEGUN REQUERIMIENTO) */}
          <div className="p-5 space-y-4">
            {/* Banner de Proporción y Saldo */}
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="text-amber-900">
                <span className="font-black">⚔️ Regla de Marcas:</span> Juega{" "}
                <b>{esBs ? "Bs. 120.000" : "$120"}</b> para ganar{" "}
                <b>{esBs ? "Bs. 100.000" : "$100"}</b> netos (en múltiplos de {esBs ? "Bs. 6.000" : "6"}). Tu ejemplar debe llegar por delante del rival elegido.
              </div>
              {saldoJugador !== null && (
                <div className="rounded-lg bg-white px-2.5 py-1 font-black text-slate-800 border border-amber-200">
                  Saldo: {simboloMoneda}{saldoJugador.toLocaleString("es-VE", { minimumFractionDigits: 2 })}
                </div>
              )}
            </div>

            {/* PASO 1: SELECCIONAR TU EJEMPLAR */}
            <div>
              <label className="text-xs font-black uppercase tracking-wider text-slate-700 block mb-1.5">
                1. Selecciona tu Ejemplar (Marca a Jugar)
              </label>
              {candidatosJugables.length === 0 ? (
                <div className="rounded-lg bg-slate-100 p-3 text-xs text-slate-500">
                  Esta carrera no tiene marcas disponibles para apostar (la 1ª marca y los no válidos no se pueden jugar).
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {candidatosJugables.map((num) => {
                    const col = getHorseColor(num);
                    const sel = caballo === num;
                    const cabData = carreraData.caballos?.find((c) => String(c.numero) === String(num));
                    return (
                      <button
                        key={num}
                        type="button"
                        onClick={() => setCaballo(num)}
                        className={`flex items-center gap-1.5 rounded-xl px-3 py-2 border-2 transition-all ${
                          sel
                            ? "border-indigo-600 bg-indigo-50 shadow-md ring-2 ring-indigo-400"
                            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        <span
                          className={`inline-flex h-6 w-6 items-center justify-center rounded font-mono font-black text-xs ${col.bg} ${col.text} ${col.border} border`}
                        >
                          {num}
                        </span>
                        <span className="text-xs font-bold text-slate-900">
                          {cabData?.nombre || `Caballo #${num}`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* PASO 2: SELECCIONAR EL RIVAL LEGAL */}
            {caballo && (
              <div>
                <label className="text-xs font-black uppercase tracking-wider text-slate-700 block mb-1.5">
                  2. Selecciona el Rival del Match (a la izquierda de #{caballo})
                </label>
                {rivalesLegales.length === 0 ? (
                  <div className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">
                    No hay rivales legales a la izquierda para este ejemplar.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {rivalesLegales.map((rivNum: string) => {
                      const col = getHorseColor(rivNum);
                      const sel = rival === rivNum;
                      const rivData = carreraData.caballos?.find((c) => String(c.numero) === String(rivNum));
                      return (
                        <button
                          key={rivNum}
                          type="button"
                          onClick={() => setRival(rivNum)}
                          className={`flex items-center gap-1.5 rounded-xl px-3 py-2 border-2 transition-all ${
                            sel
                              ? "border-amber-500 bg-amber-50 shadow-md ring-2 ring-amber-400"
                              : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                          }`}
                        >
                          <span
                            className={`inline-flex h-6 w-6 items-center justify-center rounded font-mono font-black text-xs ${col.bg} ${col.text} ${col.border} border`}
                          >
                            {rivNum}
                          </span>
                          <span className="text-xs font-bold text-slate-900">
                            {rivData?.nombre || `Rival #${rivNum}`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* PASO 3: MONTO */}
            {caballo && rival && (
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-wider text-slate-700 block">
                  3. Monto a Jugar ({simboloMoneda.trim()}) · {esBs ? "Múltiplos de Bs. 6.000" : "Múltiplos de 6"}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={esBs ? "6000" : "6"}
                    step={esBs ? "6000" : "6"}
                    value={monto}
                    onChange={(e) => setMonto(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-base font-black text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <span className="text-xs font-bold text-slate-500 whitespace-nowrap">{esBs ? "VES" : "USD"}</span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {(esBs
                    ? [6000, 12000, 24000, 30000, 60000, 120000]
                    : [6, 12, 18, 24, 30, 60, 120]
                  ).map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setMonto(String(val))}
                      className={`rounded-lg px-2.5 py-1 text-xs font-black border transition-colors ${
                        monto === String(val)
                          ? "border-indigo-600 bg-indigo-600 text-white"
                          : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {simboloMoneda}{val.toLocaleString("es-VE")}
                    </button>
                  ))}
                </div>

                {/* RESUMEN DEL MATCHUP */}
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-3 text-xs space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-slate-600">Matchup:</span>
                    <span className="font-black text-indigo-950">
                      #{caballo} vence a #{rival}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-slate-600">Premio a cobrar si gana:</span>
                    <span className="text-sm font-black text-emerald-700">
                      {simboloMoneda}{pagoPotencial.toLocaleString("es-VE", { minimumFractionDigits: 2 })} (+
                      {simboloMoneda}{gananciaNeta.toLocaleString("es-VE", { minimumFractionDigits: 2 })} neta)
                    </span>
                  </div>
                </div>

                {/* ESTADO DEL CUPO / ADVERTENCIA AL JUGADOR */}
                {verificandoCupo ? (
                  <div className="text-[11px] font-bold text-slate-500">
                    Verificando disponibilidad de cupo…
                  </div>
                ) : !cupoPermitido ? (
                  <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800 space-y-1">
                    <div className="font-black flex items-center gap-1.5">
                      <span>🚫</span>
                      <span>CUPO AGOTADO PARA ESTA MARCA</span>
                    </div>
                    <p>{cupoMotivo}</p>
                    <p className="text-[10px] text-rose-700">
                      Se ha notificado al Administrador Principal para que evalúe ampliar el cupo o ajustar la jerarquía.
                    </p>
                  </div>
                ) : cupoDisponible !== null ? (
                  <div className="text-[11px] font-bold text-emerald-700">
                    ✓ Cupo disponible para jugar (${cupoDisponible} restante en plataforma).
                  </div>
                ) : null}
              </div>
            )}

            {errorPreview && (
              <div className="rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700 border border-rose-200">
                {errorPreview}
              </div>
            )}
          </div>

          {/* BOTONES DE ACCIÓN */}
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
            <Button variant="ghost" size="md" onClick={onCerrar}>
              Cancelar
            </Button>
            <Button
              size="md"
              disabled={!caballo || !rival || !cupoPermitido || verificandoCupo}
              onClick={iniciarCompra}
            >
              🛒 Comprar Marcas (${montoNum})
            </Button>
          </div>
        </div>
      </div>

      {/* PREVIEW DE CONFIRMACION DE COMPRA */}
      <TicketVentaPreview
        abierto={preview !== null}
        ticket={preview}
        confirmando={comprando}
        error={errorPreview}
        tituloModal="Confirmar Compra de Marcas"
        textoBotonConfirmar="🛒 Confirmar y Comprar"
        onConfirmar={() => void confirmarCompra()}
        onCorregir={() => setPreview(null)}
      />
    </>
  );
}
