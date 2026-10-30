"use client";

/**
 * ============================================================================
 * CreacionGruposModule — asistente de alta de franquicias (NIVEL 0 → 3)
 * ============================================================================
 * Módulo EXCLUSIVO del super administrador (josorioc). Crea, en una sola
 * operación, el ecosistema completo de una banca:
 *
 *   Paso 1 · EL GRUPO        → grupos_venta (NIVEL 1)
 *   Paso 2 · EL ADMINISTRADOR→ cuenta de login + usuario_sistema admin (NIVEL 2)
 *   Paso 3 · LOS OPERADORES  → cuentas de login + usuario_sistema operador (NIVEL 3)
 *
 * La escritura real va por la edge function `crear-grupo` (service_role), porque
 * crear cuentas de Supabase Auth no puede hacerse desde el navegador. Si la
 * función no está desplegada, el módulo cae a un modo degradado que crea el
 * grupo y las filas de usuario_sistema, y avisa que las credenciales quedaron
 * pendientes (ver src/lib/grupos.ts::crearEcosistemaGrupo).
 *
 * Diseño: wizard de tarjetas, Keyboard-First — Enter avanza, Escape retrocede,
 * el primer campo de cada paso se enfoca solo. Inter / leading-tight, borde
 * sutil (border-line) y estados vacíos del Design System.
 * ============================================================================
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuthStore } from "@/shared/store/useAuthStore";
import { Button } from "@/shared/components/ui/Button";
import { Card } from "@/shared/components/ui/Card";
import { Input } from "@/shared/components/ui/Input";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import { ToastHost } from "@/shared/components/ui/ToastHost";
import { LogoUploader } from "@/shared/components/ui/LogoUploader";
import { emitirLogosActualizados, emitirToast } from "@/shared/lib/mensajeria";
import {
  correoDeLogin,
  crearEcosistemaGrupo,
  actualizarGrupo,
  emitirGruposActualizados,
  invalidarCacheGrupos,
  porcentajeDeEntrada,
  type EcosistemaGrupoResultado,
  type EcosistemaGrupoEntrada,
  type NuevoUsuarioDeGrupo,
  type UsuarioDeGrupoCreado,
} from "@/features/grupos/lib/grupos";
import { CamposComisionesConvenio } from "@/features/grupos/components/CamposComisionesConvenio";
import {
  columnasConvenioDesde,
  valoresConvenioInicial,
  type ProductoConvenio,
  type ValoresConvenio,
} from "@/features/grupos/lib/comisiones-convenio";

const toast = (msg: string, tipo: "success" | "warning" | "error" | "info" = "info") =>
  emitirToast(msg, tipo);

const PASOS = [
  { n: 1, titulo: "El grupo", descripcion: "Nombre, moneda y comisión" },
  { n: 2, titulo: "Administrador", descripcion: "El dueño de la banca" },
  { n: 3, titulo: "Operadores", descripcion: "Las taquillas" },
] as const;

type OperadorForm = {
  usuario: string;
  nombre: string;
  correo: string;
  clave: string;
  clave2: string;
};

const operadorVacio = (): OperadorForm => ({ usuario: "", nombre: "", correo: "", clave: "", clave2: "" });

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Falta el usuario, la clave es corta o la confirmación no coincide. */
function problemaDeUsuario(u: { usuario: string; clave: string; clave2: string; correo?: string }): string | null {
  const usuario = u.usuario.trim();
  if (!usuario) return "Indicá el nombre de acceso.";
  if (/\s/.test(usuario)) return "El nombre de acceso no puede llevar espacios.";
  if (u.clave.length < 6) return "La clave debe tener al menos 6 caracteres.";
  if (u.clave !== u.clave2) return "La clave y su confirmación no coinciden.";
  if (u.correo && !EMAIL_OK.test(u.correo.trim())) return "El correo no es válido.";
  return null;
}

export function CreacionGruposModule() {
  const esPrincipal = useAuthStore((s) => s.esPrincipal);

  const [paso, setPaso] = useState<1 | 2 | 3>(1);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<EcosistemaGrupoResultado | null>(null);

  // Paso 1 — datos del grupo
  const [nombre, setNombre] = useState("");
  const [logo, setLogo] = useState<string | null>(null);
  const [moneda, setMoneda] = useState("USD");
  const [monedaCuadre, setMonedaCuadre] = useState("USD");
  const [convenio, setConvenio] = useState<ValoresConvenio>(() => valoresConvenioInicial("2.5"));
  const [cupo, setCupo] = useState("3");
  const [responsable, setResponsable] = useState("");

  const cambiarMoneda = (nueva: string) => {
    setMoneda(nueva);
    if (nueva === "VES") {
      if (cupo === "3" || cupo === "100") setCupo("3000");
    } else if (nueva === "USD") {
      if (cupo === "3000" || cupo === "100") setCupo("3");
    }
  };

  // Paso 2 — administrador
  const [admin, setAdmin] = useState<OperadorForm>(operadorVacio());

  // Paso 3 — operadores
  const [nOperadores, setNOperadores] = useState(2);
  const [operadores, setOperadores] = useState<OperadorForm[]>(() => [
    operadorVacio(),
    operadorVacio(),
  ]);

  const refs = {
    1: useRef<HTMLInputElement>(null),
    2: useRef<HTMLInputElement>(null),
    3: useRef<HTMLInputElement>(null),
  };

  // Keyboard-First: al entrar a un paso, el primer campo toma el foco.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (paso === 1) refs[1].current?.focus();
      if (paso === 2) refs[2].current?.focus();
      if (paso === 3) refs[3].current?.focus();
    }, 60);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paso, esPrincipal]);

  const ajustarNOperadores = (n: number) => {
    const cantidad = Math.min(Math.max(n, 1), 20);
    setNOperadores(cantidad);
    setOperadores((prev) =>
      Array.from({ length: cantidad }, (_, i) => prev[i] ?? operadorVacio())
    );
    // El foco salta al primer operador nuevo que falte llenar.
    if (paso === 3) {
      window.setTimeout(() => refs[3].current?.focus(), 60);
    }
  };

  const puedeAvanzar = useMemo(() => {
    if (paso === 1) return nombre.trim().length > 0;
    if (paso === 2) return problemaDeUsuario(admin) === null;
    return (
      operadores.length > 0 &&
      operadores.filter((o) => o.usuario.trim() || o.clave).every((o) => problemaDeUsuario(o) === null)
    );
  }, [paso, nombre, admin, operadores]);

  const errorPaso = useMemo(() => {
    if (paso === 2) return problemaDeUsuario(admin);
    if (paso === 3) {
      const conDatos = operadores.filter((o) => o.usuario.trim() || o.clave);
      for (const o of conDatos) {
        const err = problemaDeUsuario(o);
        if (err) return err;
      }
    }
    return null;
  }, [paso, admin, operadores]);

  const siguiente = () => {
    if (!puedeAvanzar) {
      toast(errorPaso ?? "Completá los campos requeridos del paso actual.", "warning");
      return;
    }
    if (paso < 3) setPaso((p) => (p + 1) as 1 | 2 | 3);
    else void enviar();
  };

  const anterior = () => {
    if (paso > 1) setPaso((p) => (p - 1) as 1 | 2 | 3);
  };

  const setConvenioCampo = (clave: ProductoConvenio, valor: string) =>
    setConvenio((prev) => ({ ...prev, [clave]: valor }));

  const armarEntrada = (): EcosistemaGrupoEntrada => {
    const c = columnasConvenioDesde(convenio);
    return {
      grupo: {
        nombre,
        moneda,
        moneda_cuadre: monedaCuadre,
        comision_default: c.comision_default ?? porcentajeDeEntrada(convenio.entre_tercios),
        comision_marcas: c.comision_marcas,
        comision_tablas: c.comision_tablas,
        comision_remates: c.comision_remates,
        comision_polla: c.comision_polla,
        comision_wps: c.comision_wps,
        comision_dupletas: c.comision_dupletas,
        cupo_tabla: parseInt(cupo, 10) || 100,
        responsable: responsable.trim() || null,
        logo_url: logo,
      },
    admin: {
      usuario: admin.usuario.trim(),
      nombre: admin.nombre.trim() || admin.usuario.trim(),
      tipo: "admin",
      clave: admin.clave,
      correo: admin.correo.trim() || undefined,
    },
      operadores: operadores
        .filter((o) => o.usuario.trim())
        .map<NuevoUsuarioDeGrupo>((o) => ({
          usuario: o.usuario.trim(),
          nombre: o.nombre.trim() || o.usuario.trim(),
          tipo: "operador",
          clave: o.clave,
          correo: o.correo.trim() || undefined,
        })),
    };
  };

  const enviar = async () => {
    if (enviando) return;
    setEnviando(true);
    setResultado(null);
    try {
      const r = await crearEcosistemaGrupo(armarEntrada());
      // El logo se confirma sobre el grupo ya creado: la edge function puede
      // ignorar `logo_url`, así que se escribe por la vía normal de edición.
      if (r.ok && r.grupoId && logo) {
        const guardado = await actualizarGrupo(r.grupoId, { logo_url: logo });
        if (!guardado.ok) toast(`El grupo se creó, pero el logo no se guardó: ${guardado.error ?? "error desconocido"}.`, "warning");
      }
      setResultado(r);
      if (r.ok) {
        toast(`Grupo "${r.grupoNombre ?? ""}" creado.`, "success");
        if (r.aviso) toast(r.aviso, "warning");
        // Propagación reactiva: el logo del grupo recién creado aparece ya.
        emitirLogosActualizados({ grupoId: r.grupoId ? String(r.grupoId) : "" });
        invalidarCacheGrupos(r.grupoId ? String(r.grupoId) : undefined);
        emitirGruposActualizados({ grupoId: r.grupoId ? String(r.grupoId) : "" });
      } else {
        toast(r.error ?? "No se pudo crear el grupo.", "error");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setEnviando(false);
    }
  };

  const reiniciar = () => {
    setPaso(1);
    setResultado(null);
    setNombre("");
    setMoneda("USD");
    setMonedaCuadre("USD");
    setConvenio(valoresConvenioInicial("2.5"));
    setCupo("3");
    setResponsable("");
    setAdmin(operadorVacio());
    setNOperadores(2);
    setOperadores([operadorVacio(), operadorVacio()]);
  };

  // -------------------------------------------------------------------------
  // Acceso: NIVEL 0 únicamente
  // -------------------------------------------------------------------------
  if (!esPrincipal) {
    return (
      <div className="mx-auto max-w-3xl py-10">
        <EmptyState
          icono="🔐"
          titulo="Solo el super administrador"
          descripcion="Este módulo es exclusivo de josorioc: crea grupos, administradores y operadores de cada banca."
        />
        <ToastHost />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Pantalla de éxito: credenciales generadas
  // -------------------------------------------------------------------------
  if (resultado?.ok && resultado.creados && resultado.creados.length) {
    return (
      <div className="mx-auto max-w-3xl pt-6">
        <Card className="p-6 sm:p-8">
          <div className="mb-6 flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success-100 text-2xl">
              ✅
            </div>
            <div>
              <h2 className="text-lg font-bold leading-tight text-slate-900">
                Grupo {resultado.grupoNombre} creado
              </h2>
              <p className="text-sm leading-tight text-slate-500">
                Anotá estas credenciales: las cuentas ya pueden iniciar sesión
                <span className="font-semibold text-slate-700"> solo en este grupo</span>.
              </p>
            </div>
          </div>

          {resultado.aviso ? (
            <div className="mb-6 rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-xs leading-tight text-warning-800">
              ⚠️ {resultado.aviso}
            </div>
          ) : null}

          <div className="overflow-hidden rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surfaceAlt text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2 font-semibold">Rol</th>
                  <th className="px-4 py-2 font-semibold">Acceso</th>
                  <th className="px-4 py-2 font-semibold">Clave inicial</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {(resultado.creados as UsuarioDeGrupoCreado[]).map((c) => (
                  <tr key={c.usuario} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5">
                      <span
                        className={[
                          "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                          c.tipo === "admin" ? "bg-primary-100 text-primary-800" : "bg-surfaceAlt text-slate-600",
                        ].join(" ")}
                      >
                        {c.tipo}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-800">
                      {c.usuario} · <span className="text-slate-500">{c.correo}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-800">{c.clave}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        className="text-[11px] font-semibold text-primary-700 hover:text-primary-500"
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(`${c.usuario} · ${c.correo} · ${c.clave}`)
                            .then(() => toast(`Credenciales de ${c.usuario} copiadas.`, "info"));
                        }}
                      >
                        Copiar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-[11px] leading-tight text-slate-400">
            Sugerencia: pedí cambiar la clave en el primer inicio de sesión
            (opción “Recuperar clave” del login cambia la contraseña de la cuenta).
          </p>

          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <Link href="/grupos">
              <Button variant="outline">
                Ver en Lista de Grupos →
              </Button>
            </Link>
            <Button variant="default" onClick={reiniciar}>
              Crear otro grupo
            </Button>
          </div>
        </Card>
        <ToastHost />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Wizard
  // -------------------------------------------------------------------------
  return (
    <div className="mx-auto max-w-3xl pt-6">
      {/* Cabecera */}
      <div className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-widest text-primary-600">
          Super Administrador
        </p>
        <h1 className="text-2xl font-extrabold leading-tight text-slate-900">
          Creación de Grupos
        </h1>
        <p className="mt-1 text-sm leading-tight text-slate-500">
          Franquicia nueva en un solo paso: el grupo, su administrador y sus taquillas.
        </p>
      </div>

      {/* Stepper */}
      <ol className="mb-6 grid grid-cols-3 gap-2">
        {PASOS.map((p) => {
          const activo = p.n === paso;
          const hecho = p.n < paso;
          return (
            <li key={p.n}>
              <button
                type="button"
                disabled={!hecho && !activo}
                onClick={() => setPaso(p.n as 1 | 2 | 3)}
                className={[
                  "flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors",
                  activo ? "border-primary-300 bg-primary-50" : "border-line bg-surface",
                  hecho ? "cursor-pointer hover:border-primary-200" : "cursor-default",
                ].join(" ")}
              >
                <span
                  className={[
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                    hecho
                      ? "bg-success-500 text-white"
                      : activo
                        ? "bg-primary-600 text-white"
                        : "bg-surfaceAlt text-slate-500",
                  ].join(" ")}
                >
                  {hecho ? "✓" : p.n}
                </span>
                <span className="min-w-0">
                  <span className={["block text-xs font-bold leading-tight", activo ? "text-primary-900" : "text-slate-700"].join(" ")}>
                    {p.titulo}
                  </span>
                  <span className="block truncate text-[10px] leading-tight text-slate-400">
                    {p.descripcion}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <Card className="p-6 sm:p-8">
        {/* ---------------- Paso 1: el grupo ---------------- */}
        {paso === 1 ? (
          <div
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                siguiente();
              }
              if (e.key === "Escape") e.preventDefault();
            }}
          >
            <div className="sm:col-span-2">
              <Input
                ref={refs[1]}
                label="Nombre del grupo (ej. Banca Los Vencedores)"
                placeholder="Banca Los Vencedores"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <LogoUploader
                label="Logo del Grupo (PNG)"
                value={logo}
                onChange={setLogo}
                hint="Se mostrará junto al nombre del grupo en el Reporte de Liquidación."
              />
            </div>
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
              Moneda
              <select
                value={moneda}
                onChange={(e) => cambiarMoneda(e.target.value)}
                className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <option value="USD">USD</option>
                <option value="VES">VES</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-600">
              Moneda de cuadre
              <select
                value={monedaCuadre}
                onChange={(e) => setMonedaCuadre(e.target.value)}
                className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <option value="USD">USD</option>
                <option value="VES">VES</option>
              </select>
            </label>
            <Input
              label="Cupos por tabla (inventario)"
              type="number"
              min="1"
              value={cupo}
              onChange={(e) => setCupo(e.target.value)}
            />
            <div className="sm:col-span-2">
              <CamposComisionesConvenio
                valores={convenio}
                onCambio={setConvenioCampo}
                ayuda="Comisión por convenio con el grupo principal, sobre el MONTO DECIDIDO. Vacío = hereda la de Entre Tercios (default 2,5%)."
              />
            </div>
            <div className="sm:col-span-2">
              <Input
                label="Responsable (opcional)"
                placeholder="Nombre del encargado de la banca"
                value={responsable}
                onChange={(e) => setResponsable(e.target.value)}
              />
            </div>
          </div>
        ) : null}

        {/* ---------------- Paso 2: administrador ---------------- */}
        {paso === 2 ? (
          <div
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                siguiente();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                anterior();
              }
            }}
          >
            <Input
              ref={refs[2]}
              label="Nombre de acceso (usuario)"
              hint="Sin espacios, sin correo. Ej. admin.vencedores"
              value={admin.usuario}
              onChange={(e) => setAdmin({ ...admin, usuario: e.target.value })}
            />
            <Input
              label="Nombre visible"
              value={admin.nombre}
              onChange={(e) => setAdmin({ ...admin, nombre: e.target.value })}
            />
            <Input
              label="Correo (opcional)"
              hint="Si lo dejas vacío, se genera <usuario>@sistemahipico.local"
              value={admin.correo}
              onChange={(e) => setAdmin({ ...admin, correo: e.target.value })}
            />
            <div />
            <Input
              label="Clave inicial"
              hint="Mínimo 6 caracteres"
              type="password"
              value={admin.clave}
              onChange={(e) => setAdmin({ ...admin, clave: e.target.value })}
            />
            <Input
              label="Confirmar clave"
              type="password"
              value={admin.clave2}
              onChange={(e) => setAdmin({ ...admin, clave2: e.target.value })}
            />
            <p className="text-[11px] leading-tight text-slate-400 sm:col-span-2">
              El administrador es el dueño de la banca (NIVEL 2): gestiona jugadas, saldos
              y clientes <span className="font-semibold">solo de su grupo</span>.
            </p>
          </div>
        ) : null}

        {/* ---------------- Paso 3: operadores ---------------- */}
        {paso === 3 ? (
          <div
            className="flex flex-col gap-5"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                siguiente();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                anterior();
              }
            }}
          >
            <div className="flex items-center justify-between gap-4">
              <label className="text-[11px] font-semibold text-slate-600">
                ¿Cuántas taquillas tendrá el grupo?
                <input
                  ref={refs[3]}
                  type="number"
                  min={1}
                  max={20}
                  value={nOperadores}
                  onChange={(e) => ajustarNOperadores(parseInt(e.target.value, 10) || 1)}
                  className="ml-2 w-16 rounded-lg border border-line bg-surface px-2 py-1 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                />
              </label>
              <p className="hidden text-[11px] leading-tight text-slate-400 sm:block">
                Cada operador (taquillero) solo ve su grupo — Enter para enviar, Escape para volver.
              </p>
            </div>

            {operadores.map((o, i) => (
              <div key={i} className="rounded-xl border border-line bg-surfaceAlt/40 p-4">
                <p className="mb-3 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Operador {i + 1}
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input
                    label="Nombre de acceso"
                    value={o.usuario}
                    onChange={(e) =>
                      setOperadores(operadores.map((x, j) => (j === i ? { ...x, usuario: e.target.value } : x)))
                    }
                  />
                  <Input
                    label="Nombre visible"
                    value={o.nombre}
                    onChange={(e) =>
                      setOperadores(operadores.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))
                    }
                  />
                  <Input
                    label="Correo (opcional)"
                    value={o.correo}
                    onChange={(e) =>
                      setOperadores(operadores.map((x, j) => (j === i ? { ...x, correo: e.target.value } : x)))
                    }
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      label="Clave inicial"
                      type="password"
                      value={o.clave}
                      onChange={(e) =>
                        setOperadores(operadores.map((x, j) => (j === i ? { ...x, clave: e.target.value } : x)))
                      }
                    />
                    <Input
                      label="Confirmar"
                      type="password"
                      value={o.clave2}
                      onChange={(e) =>
                        setOperadores(operadores.map((x, j) => (j === i ? { ...x, clave2: e.target.value } : x)))
                      }
                    />
                  </div>
                </div>
              </div>
            ))}

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => ajustarNOperadores(nOperadores + 1)}
              >
                + Agregar operador
              </Button>
              <span className="text-[11px] text-slate-400">
                Máximo 20 taquillas por grupo.
              </span>
            </div>
          </div>
        ) : null}

        {/* Pie del wizard */}
        <div className="mt-7 flex items-center justify-between gap-3 border-t border-line pt-5">
          <div>
            {errorPaso ? <p className="text-xs font-medium text-danger-600">⚠️ {errorPaso}</p> : null}
          </div>
          <div className="flex gap-3">
            {paso > 1 ? (
              <Button variant="ghost" onClick={anterior} disabled={enviando}>
                ← Atrás
              </Button>
            ) : null}
            <Button variant="default" onClick={siguiente} disabled={enviando || !puedeAvanzar}>
              {paso === 3 ? (enviando ? "Creando…" : "Crear franquicia") : "Continuar →"}
            </Button>
          </div>
        </div>
      </Card>

      <ToastHost />
    </div>
  );
}

export default CreacionGruposModule;