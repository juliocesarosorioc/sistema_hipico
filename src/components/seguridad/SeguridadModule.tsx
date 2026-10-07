"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buscarCapacidades,
  CAPACIDADES,
  ETIQUETA_RIESGO,
  ETIQUETA_TIPO,
  MODULOS_ESQUEMA,
} from "@/lib/seguridad/capacidades";
import { baseDeTipo, expandirConRequisitos, resolverAccesos, USUARIO_PRINCIPAL } from "@/lib/seguridad/resolver";
import { ATRIBUTOS, ATRIBUTOS_POR_CLAVE, REGLAS_ABAC, reglasDeCapacidad, type ReglaAbac } from "@/lib/seguridad/abac";
import { puedeConContexto } from "@/lib/seguridad/vigente";
import {
  crearTipoUsuario,
  guardarExcepcionesDeUsuario,
  guardarMatrizDeTipo,
  guardarUsuarioSistema,
  leerTiposUsuario,
  leerUsuariosDelSistema,
  tiposPorDefecto,
  type UsuarioAlta,
} from "@/lib/seguridad/accesos";
import type { Decision, ExcepcionUsuario, TipoCapacidad, TipoUsuario } from "@/lib/seguridad/tipos";
import { Guard } from "@/components/ui/Guard";
import { AuditoriaPanel } from "@/components/seguridad/AuditoriaPanel";
import { useAuthStore } from "@/store/useAuthStore";

type Pestana = "esquema" | "reglas" | "tipos" | "usuarios" | "auditoria";

const CHOICES_TIPO: TipoCapacidad[] = ["ruta", "boton", "modal", "celda", "campo", "funcion"];

const COLOR_RIESGO: Record<string, string> = {
  lectura: "bg-slate-100 text-slate-600",
  escritura: "bg-amber-100 text-amber-700",
  critico: "bg-red-100 text-red-700",
};

const COLOR_CLASE: Record<string, string> = {
  integridad: "bg-red-50 text-red-700 border-red-200",
  limite: "bg-amber-50 text-amber-700 border-amber-200",
};

const ETIQUETA_OPERADOR: Record<string, string> = {
  igual: "es",
  diferente: "no es",
  en: "está en",
  no_en: "no está en",
  mayor_igual: "es mayor o igual que",
  menor_igual: "es menor o igual que",
  entre: "está entre",
  no_vacio: "no está vacío",
  vacio: "está vacío",
  en_atributo: "está entre los",
};

/**
 * La regla escrita como la entendería el admin. Sin esto el maestro obliga a
 * leer el código para saber por qué un botón está apagado.
 */
function describirRegla(r: ReglaAbac): string {
  const nombre = ATRIBUTOS_POR_CLAVE.get(r.atributo)?.nombre ?? r.atributo;
  const ops = ETIQUETA_OPERADOR[r.operador] ?? r.operador;
  if (r.operador === "en_atributo") {
    const otros = ATRIBUTOS_POR_CLAVE.get(String(r.valor));
    return `${nombre} ${ops} ${otros?.nombre ?? r.valor} del usuario`;
  }
  if (r.operador === "no_vacio" || r.operador === "vacio") return `${nombre} ${ops}`;
  const valor = Array.isArray(r.valor) ? r.valor.join(" y ") : r.valor;
  return `${nombre} ${ops} ${valor}`;
}

/**
 * Un valor que la regla DEBERÍA aceptar, para que el simulador arranque en
 * verde y se vea qué es lo que la rompe.
 */
function ejemploDeValor(r: ReglaAbac): unknown {
  switch (r.operador) {
    case "entre":
      return Array.isArray(r.valor) ? Number(r.valor[0]) : 0;
    case "mayor_igual":
      return Number(r.valor);
    case "menor_igual":
      return Number(r.valor);
    case "en":
    case "no_en":
      return Array.isArray(r.valor) ? r.valor[0] : r.valor;
    case "no_vacio":
      return "x";
    case "vacio":
      return "";
    default:
      return r.valor;
  }
}

/** Chip corto con el tipo de la capacidad. */
function Chip({ tipo }: { tipo: string }) {
  return (
    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-slate-500">
      {ETIQUETA_TIPO[tipo as TipoCapacidad] ?? tipo}
    </span>
  );
}

function ChipRiesgo({ riesgo }: { riesgo: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase ${COLOR_RIESGO[riesgo] ?? ""}`}>
      {ETIQUETA_RIESGO[riesgo as "lectura"] ?? riesgo}
    </span>
  );
}

export default function SeguridadModule() {
  const esPrincipal = useAuthStore((s) => s.esPrincipal);
  const miUsuario = useAuthStore((s) => s.usuario);

  const [pestana, setPestana] = useState<Pestana>("esquema");
  // Permite abrir una pestaña directa: /seguridad?pestana=auditoria (lo usa el
  // acceso rápido "Auditoría" del dashboard). Se lee del window y no con
  // useSearchParams para no obligar a la página a renderizarse en dynamic.
  useEffect(() => {
    const pedida = new URLSearchParams(window.location.search).get("pestana");
    if (pedida && (["esquema", "reglas", "tipos", "usuarios", "auditoria"] as string[]).includes(pedida)) {
      setPestana(pedida as Pestana);
    }
  }, []);
  const [busqueda, setBusqueda] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<TipoCapacidad | "">("");
  const [tipos, setTipos] = useState<TipoUsuario[]>(tiposPorDefecto());
  const [usuarios, setUsuarios] = useState<UsuarioAlta[]>([]);
  const [tipoSel, setTipoSel] = useState<string>("");
  const [borrador, setBorrador] = useState<Set<string>>(new Set());
  const [usuarioSel, setUsuarioSel] = useState<string>("");
  const [excepciones, setExcepciones] = useState<ExcepcionUsuario>({});
  const [nuevoTipo, setNuevoTipo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState<{ texto: string; ok: boolean } | null>(null);

  // --- reglas ABAC: filtro y simulador -----------------------------------
  // El simulador existe por una razón concreta: una regla de ABAC es código
  // disfrazado de dato, y sin poder probarla el admin la descubre cuando le
  // bloquea una operación de verdad. Acá se ve la respuesta con los valores de
  // ejemplo de la propia regla, sin tocar la base.
  const [reglaSel, setReglaSel] = useState<string>(REGLAS_ABAC[0]?.id ?? "");
  const [contextoSim, setContextoSim] = useState<Record<string, unknown>>({});
  const regla = REGLAS_ABAC.find((r) => r.id === reglaSel) ?? null;

  const reglasFiltradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return REGLAS_ABAC;
    return REGLAS_ABAC.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.capacidad.toLowerCase().includes(q) ||
        r.mensaje.toLowerCase().includes(q)
    );
  }, [busqueda]);

  const porCapacidad = useMemo(() => {
    const mapa = new Map<string, ReglaAbac[]>();
    for (const r of REGLAS_ABAC) {
      const l = mapa.get(r.capacidad) ?? [];
      l.push(r);
      mapa.set(r.capacidad, l);
    }
    return [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, []);

  // Cuando cambia de regla, el simulador arranca con los valores que la regla
  // espera, para que el operador vea un caso que la APROBA y otro que la
  // bloquea. Sin esto el simulador siempre dice "no".
  useEffect(() => {
    if (!regla) {
      setContextoSim({});
      return;
    }
    const base: Record<string, unknown> = { [regla.atributo]: ejemploDeValor(regla) };
    if (regla.operador === "en_atributo") base[String(regla.valor)] = "ejemplo";
    setContextoSim(base);
  }, [regla]);

  const veredictoSim = useMemo(() => {
    if (!regla) return null;
    return puedeConContexto(regla.capacidad, contextoSim);
  }, [regla, contextoSim]);

  const avisar = (texto: string, ok = true) => {
    setMensaje({ texto, ok });
    window.setTimeout(() => setMensaje(null), 4000);
  };

  useEffect(() => {
    (async () => {
      const [t, u] = await Promise.all([leerTiposUsuario(), leerUsuariosDelSistema()]);
      setTipos(t);
      setUsuarios(u);
      if (t[0]) setTipoSel(t[0].nombre);
    })();
  }, []);

  // Al cambiar de tipo, se carga su matriz en el borrador.
  useEffect(() => {
    if (!tipoSel) return;
    const t = tipos.find((x) => x.nombre === tipoSel);
    if (t) setBorrador(new Set(expandirConRequisitos(t.capacidades)));
  }, [tipoSel, tipos]);

  const resultados = useMemo(
    () => buscarCapacidades(busqueda, filtroTipo || undefined),
    [busqueda, filtroTipo]
  );

  const porModulo = useMemo(() => {
    const mapa = new Map<string, typeof resultados>();
    for (const c of resultados) {
      const l = mapa.get(c.modulo) ?? [];
      l.push(c);
      mapa.set(c.modulo, l);
    }
    return [...mapa.entries()];
  }, [resultados]);

  const alternar = (clave: string) => {
    setBorrador((prev) => {
      const n = new Set(prev);
      if (n.has(clave)) {
        n.delete(clave);
        // Si se quita una capacidad, se quitan las que la exigen.
        for (const c of CAPACIDADES) {
          if (c.requiere?.includes(clave)) n.delete(c.clave);
        }
      } else {
        n.add(clave);
        // Marcar una capacidad arrastra lo que exige para poder usarse.
        for (const r of CAPACIDADES.find((c) => c.clave === clave)?.requiere ?? []) n.add(r);
      }
      return n;
    });
  };

  const guardarTipo = async () => {
    const t = tipos.find((x) => x.nombre === tipoSel);
    if (!t) return;
    setOcupado(true);
    const r = await guardarMatrizDeTipo(t.id, [...borrador]);
    setOcupado(false);
    if (r.ok) {
      setTipos(await leerTiposUsuario());
      avisar(`Matriz de "${t.nombre}" guardada (${borrador.size} capacidades).`);
    } else {
      avisar(r.error ?? "No se pudo guardar.", false);
    }
  };

  const crearTipo = async () => {
    const nombre = nuevoTipo.trim().toLowerCase();
    if (!nombre) return;
    setOcupado(true);
    const r = await crearTipoUsuario(nombre, `Tipo creado desde el maestro`);
    setOcupado(false);
    if (r.ok) {
      const t = await leerTiposUsuario();
      setTipos(t);
      setTipoSel(nombre);
      setNuevoTipo("");
      avisar(`Tipo "${nombre}" creado con su base genérica.`);
    } else {
      avisar(r.error ?? "No se pudo crear el tipo.", false);
    }
  };

  const alternarExcepcion = (clave: string) => {
    setExcepciones((prev) => {
      const n = { ...prev };
      const actual = n[clave] ?? "heredado";
      const siguiente: Decision = actual === "heredado" ? "permitido" : actual === "permitido" ? "denegado" : "heredado";
      if (siguiente === "heredado") delete n[clave];
      else n[clave] = siguiente;
      return n;
    });
  };

  const guardarUsuario = async () => {
    // Solo se persisten las EXCEPCIONES. La base es la matriz del tipo, que se
    // edita en la pestaña "Tipos de usuario": así personalizar a una persona no
    // le pisa el acceso a todos los demás de su mismo tipo.
    if (!usuarioSel) {
      avisar("Elegí un usuario.", false);
      return;
    }
    setOcupado(true);
    const r = await guardarExcepcionesDeUsuario(usuarioSel, excepciones);
    setOcupado(false);
    avisar(r.ok ? "Personalización guardada." : r.error ?? "No se pudo guardar.", r.ok);
  };

  // Vista previa de cómo quedaría el tipo, sin tocar la BD.
  const simulacion = useMemo(
    () => resolverAccesos({ tipo: { id: tipoSel, nombre: tipoSel, capacidades: [...borrador] }, excepciones: {} }),
    [tipoSel, borrador]
  );

  const cuenta = (t: TipoUsuario) => expandirConRequisitos(t.capacidades).size;

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-sm font-black uppercase tracking-wide text-slate-700">Módulo de Seguridad</h1>
          <p className="text-[10px] text-slate-400">
            Maestro del sistema: {CAPACIDADES.length} capacidades en {MODULOS_ESQUEMA.length} módulos.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">
            Sesión: <strong className="text-slate-700">{miUsuario || "sin sesión"}</strong>
            {esPrincipal ? " · ACCESO TOTAL" : ""}
          </span>
          <button
            onClick={salirDeLaSesion}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] font-black uppercase text-slate-500 hover:bg-slate-50"
          >
            Salir
          </button>
        </div>
      </header>

      <nav className="flex gap-1 border-b border-slate-200">
        {(
          [
            ["esquema", `Esquema del sistema (${CAPACIDADES.length})`],
            ["reglas", `Reglas de contexto (${REGLAS_ABAC.length})`],
            ["tipos", "Tipos de usuario"],
            ["usuarios", "Usuarios"],
            ["auditoria", "Auditoría"],
          ] as Array<[Pestana, string]>
        ).map(([id, texto]) => (
          <button
            key={id}
            onClick={() => setPestana(id)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide transition-colors ${
              pestana === id
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-slate-400 hover:text-slate-600"
            }`}
          >
            {texto}
          </button>
        ))}
      </nav>

      {mensaje ? (
        <p
          role="status"
          className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold ${
            mensaje.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-600"
          }`}
        >
          {mensaje.texto}
        </p>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* PESTAÑA 1 — ESQUEMA                                                  */}
      {/* ------------------------------------------------------------------ */}
      {pestana === "esquema" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar ruta, botón, modal, celda o función..."
              className="min-w-56 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-[11px] outline-none focus:border-indigo-500"
            />
            <select
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value as TipoCapacidad | "")}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-bold text-slate-600"
            >
              <option value="">Todos los tipos</option>
              {CHOICES_TIPO.map((t) => (
                <option key={t} value={t}>
                  {ETIQUETA_TIPO[t]}
                </option>
              ))}
            </select>
            <span className="text-[10px] font-bold text-slate-400">
              {resultados.length} de {CAPACIDADES.length}
            </span>
          </div>

          {porModulo.map(([modulo, caps]) => {
            const m = MODULOS_ESQUEMA.find((x) => x.clave === modulo);
            return (
              <details key={modulo} className="rounded-lg border border-slate-200 bg-white">
                <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[11px] font-black uppercase text-slate-700">
                  <span>{m?.nombre ?? modulo}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500">{caps.length}</span>
                  <span className="ml-auto truncate text-[10px] font-normal normal-case text-slate-400">
                    {m?.descripcion}
                  </span>
                </summary>
                <div className="border-t border-slate-100">
                  {caps.map((c) => (
                    <div key={c.clave} className="flex flex-wrap items-center gap-2 border-b border-slate-50 px-3 py-1.5 last:border-0">
                      <Chip tipo={c.tipo} />
                      <ChipRiesgo riesgo={c.riesgo} />
                      <span className="text-[11px] font-bold text-slate-700">{c.titulo}</span>
                      {c.descripcion ? (
                        <span className="text-[10px] text-slate-400">{c.descripcion}</span>
                      ) : null}
                      <code className="ml-auto rounded bg-slate-50 px-1.5 py-0.5 text-[9px] text-slate-400">{c.clave}</code>
                    </div>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* PESTAÑA 2 — TIPOS DE USUARIO                                         */}
      {/* ------------------------------------------------------------------ */}
      {pestana === "tipos" ? (
        <div className="grid gap-2 lg:grid-cols-[15rem_1fr]">
          <aside className="space-y-2">
            <div className="rounded-lg border border-slate-200 bg-white p-2">
              <p className="mb-1.5 text-[10px] font-black uppercase text-slate-400">Tipo de usuario</p>
              {tipos.map((t) => (
                <button
                  key={String(t.id)}
                  onClick={() => setTipoSel(t.nombre)}
                  className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                    tipoSel === t.nombre ? "bg-indigo-50 ring-1 ring-indigo-300" : "hover:bg-slate-50"
                  }`}
                >
                  <span className="text-[11px] font-black uppercase text-slate-700">{t.nombre}</span>
                  <span className="ml-auto text-[9px] font-bold text-slate-400">{cuenta(t)}</span>
                </button>
              ))}
            </div>

            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-2">
              <p className="mb-1 text-[10px] font-black uppercase text-slate-400">Crear tipo nuevo</p>
              <input
                value={nuevoTipo}
                onChange={(e) => setNuevoTipo(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && crearTipo()}
                placeholder="nombre del tipo"
                className="mb-1.5 w-full rounded border border-slate-300 px-2 py-1 text-[11px] outline-none focus:border-indigo-500"
              />
              <button
                onClick={crearTipo}
                disabled={ocupado || !nuevoTipo.trim()}
                className="w-full rounded bg-slate-800 py-1 text-[10px] font-black uppercase text-white disabled:opacity-40"
              >
                Crear con base genérica
              </button>
            </div>
          </aside>

          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
              <h2 className="text-[11px] font-black uppercase text-slate-700">
                Matriz de {tipoSel || "—"}
              </h2>
              <span className="text-[10px] font-bold text-slate-400">
                {borrador.size} de {CAPACIDADES.length} capacidades · la vista previa dejaría{" "}
                {simulacion.permitidas.size} efectivas
              </span>
              <div className="ml-auto flex gap-1.5">
                <button
                  onClick={() => setBorrador(new Set(expandirConRequisitos(baseDeTipo(tipoSel))))}
                  className="rounded border border-slate-300 px-2 py-1 text-[10px] font-black uppercase text-slate-500 hover:bg-slate-50"
                >
                  Base genérica
                </button>
                <button
                  onClick={() => setBorrador(new Set(CAPACIDADES.map((c) => c.clave)))}
                  className="rounded border border-slate-300 px-2 py-1 text-[10px] font-black uppercase text-slate-500 hover:bg-slate-50"
                >
                  Todo
                </button>
                <button
                  onClick={guardarTipo}
                  disabled={ocupado}
                  className="rounded bg-indigo-600 px-3 py-1 text-[10px] font-black uppercase text-white disabled:opacity-40"
                >
                  Guardar
                </button>
              </div>
            </div>

            <div className="max-h-[32rem] overflow-y-auto">
              {MODULOS_ESQUEMA.map((m) => (
                <section key={m.clave} className="border-b border-slate-100 last:border-0">
                  <h3 className="sticky top-0 bg-slate-50 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-slate-500">
                    {m.nombre}
                  </h3>
                  {m.capacidades.map((c) => {
                    const marcado = borrador.has(c.clave);
                    return (
                      <label
                        key={c.clave}
                        className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={marcado}
                          onChange={() => alternar(c.clave)}
                          className="h-3.5 w-3.5 accent-indigo-600"
                        />
                        <Chip tipo={c.tipo} />
                        <ChipRiesgo riesgo={c.riesgo} />
                        <span className={`text-[11px] ${marcado ? "font-bold text-slate-700" : "text-slate-400"}`}>
                          {c.titulo}
                        </span>
                        {c.requiere?.length ? (
                          <span className="text-[9px] text-amber-600">requiere {c.requiere.length}</span>
                        ) : null}
                        <code className="ml-auto hidden text-[9px] text-slate-300 sm:block">{c.clave}</code>
                      </label>
                    );
                  })}
                </section>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* PESTAÑA 2 — REGLAS DE CONTEXTO (ABAC)                                */}
      {/* ------------------------------------------------------------------ */}
      {pestana === "reglas" ? (
        <div className="grid gap-2 lg:grid-cols-[1fr_23rem]">
          <div className="space-y-2">
            <p className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-[11px] leading-relaxed text-indigo-900">
              El permiso dice <strong>qué</strong> puede hacer un tipo de usuario. Estas reglas dicen{" "}
              <strong>bajo qué condiciones</strong> le está permitido: el registro que va a tocar, el monto
              que pasa, el hipódromo del otro lado. Todas las que apliquen tienen que cumplirse. Si falta el
              dato con el que se evalúa una regla, la operación se bloquea.
            </p>

            <div className="flex flex-wrap gap-1.5">
              <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[9px] font-black uppercase text-red-700">
                integridad — no se puede levantar
              </span>
              <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-black uppercase text-amber-700">
                límite — el dueño lo puede levantar
              </span>
            </div>

            {porCapacidad.map(([cap, reglas]) => (
              <section key={cap} className="overflow-hidden rounded-lg border border-slate-200">
                <header className="flex items-center justify-between gap-2 bg-slate-50 px-3 py-1.5">
                  <code className="text-[11px] font-bold text-slate-700">{cap}</code>
                  <span className="text-[10px] text-slate-400">
                    {reglas.length} regla{reglas.length === 1 ? "" : "s"}
                  </span>
                </header>
                <table className="w-full text-left text-[11px]">
                  <tbody>
                    {reglasFiltradas
                      .filter((r) => r.capacidad === cap)
                      .map((r) => (
                        <tr
                          key={r.id}
                          onClick={() => setReglaSel(r.id)}
                          className={`cursor-pointer border-t border-slate-100 align-top ${
                            r.id === reglaSel ? "bg-indigo-50" : "hover:bg-slate-50"
                          }`}
                        >
                          <td className="w-4 px-2 py-1.5 align-middle">
                            <input
                              type="radio"
                              checked={r.id === reglaSel}
                              onChange={() => setReglaSel(r.id)}
                              className="accent-indigo-600"
                            />
                          </td>
                          <td className="px-1 py-1.5">
                            <div className="font-semibold text-slate-800">{describirRegla(r)}</div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1">
                              <span
                                className={`rounded border px-1.5 py-0.5 text-[9px] font-black uppercase ${
                                  COLOR_CLASE[r.clase] ?? ""
                                }`}
                              >
                                {r.clase}
                              </span>
                              <ChipRiesgo riesgo={r.riesgo} />
                              <span className="text-[10px] text-slate-400">
                                {r.ambito === "global" ? "todos los usuarios" : `solo tipo ${r.ambito.slice(5)}`}
                              </span>
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-right align-middle">
                            <p className="max-w-[16rem] text-[10px] leading-snug text-slate-500">{r.mensaje}</p>
                            <p className="mt-0.5 text-[9px] text-slate-400">{r.fuente}</p>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </section>
            ))}

            {porCapacidad.length === 0 && (
              <p className="rounded-lg border border-slate-200 p-4 text-center text-[11px] text-slate-400">
                No hay reglas que coincidan con la búsqueda.
              </p>
            )}

            <section className="rounded-lg border border-slate-200">
              <header className="bg-slate-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-slate-500">
                Catálogo de atributos ({ATRIBUTOS.length})
              </header>
              <ul className="divide-y divide-slate-100">
                {ATRIBUTOS.map((a) => (
                  <li key={a.clave} className="px-3 py-1.5 text-[11px]">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold text-slate-800">{a.nombre}</span>
                      <code className="text-[10px] text-slate-400">{a.origen}</code>
                    </div>
                    <p className="text-[10px] leading-snug text-slate-500">{a.descripcion}</p>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {/* simulador */}
          <aside className="h-fit rounded-lg border border-slate-200 bg-white p-3 lg:sticky lg:top-2">
            <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Probar una regla</p>
            {!regla ? (
              <p className="mt-2 text-[11px] text-slate-400">Elegí una regla de la lista.</p>
            ) : (
              <>
                <code className="mt-1.5 block text-[10px] break-all text-slate-500">{regla.id}</code>
                <p className="mt-1.5 text-[11px] leading-snug text-slate-700">{describirRegla(regla)}</p>

                <div className="mt-2.5 space-y-1.5">
                  {Object.keys(contextoSim).map((k) => (
                    <label key={k} className="block">
                      <span className="text-[10px] font-semibold text-slate-600">
                        {ATRIBUTOS_POR_CLAVE.get(k)?.nombre ?? k}
                      </span>
                      <input
                        value={String(contextoSim[k] ?? "")}
                        onChange={(e) => setContextoSim((s) => ({ ...s, [k]: e.target.value }))}
                        className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-[11px]"
                      />
                    </label>
                  ))}
                  <button
                    onClick={() =>
                      setContextoSim((s) => {
                        const copia = { ...s };
                        delete copia[regla.atributo];
                        return copia;
                      })
                    }
                    className="text-[10px] font-semibold text-slate-500 underline hover:text-slate-700"
                  >
                    Borrar el atributo y ver qué pasa
                  </button>
                </div>

                <div
                  className={`mt-2.5 rounded border px-2 py-1.5 text-[11px] leading-snug ${
                    veredictoSim
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-red-200 bg-red-50 text-red-800"
                  }`}
                >
                  <strong>{veredictoSim ? "Se permite" : "Se bloquea"}</strong>
                  {!veredictoSim && <span className="block"> — {regla.mensaje}</span>}
                </div>

                <p className="mt-2 text-[10px] leading-snug text-slate-400">
                  El simulador usa <em>tus</em> permisos y atributos, no los del usuario seleccionado. Lo que
                  prueba es la condición de la regla, no tu sesión.
                </p>
              </>
            )}
          </aside>
        </div>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* PESTAÑA 4 — USUARIOS                                                 */}
      {/* ------------------------------------------------------------------ */}
      {pestana === "usuarios" ? (
        <div className="grid gap-2 lg:grid-cols-[17rem_1fr]">
          <aside className="rounded-lg border border-slate-200 bg-white p-2">
            <p className="mb-1.5 text-[10px] font-black uppercase text-slate-400">Usuarios del sistema</p>
            {usuarios.map((u) => (
              <button
                key={u.id}
                onClick={() => setUsuarioSel(u.id)}
                className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                  usuarioSel === u.id ? "bg-indigo-50 ring-1 ring-indigo-300" : "hover:bg-slate-50"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-bold text-slate-700">
                    {u.nombre || u.id}
                  </span>
                  <span className="block truncate text-[9px] text-slate-400">{u.id}</span>
                </span>
                {u.esPrincipal ? (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-amber-700">
                    Principal
                  </span>
                ) : (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-black uppercase text-slate-500">
                    {u.tipo}
                  </span>
                )}
              </button>
            ))}

            <p className="mt-3 mb-1 text-[10px] font-black uppercase text-slate-400">Alta de usuario</p>
            <AltaUsuario tipos={tipos} onGuardar={async (u) => {
              const r = await guardarUsuarioSistema(u);
              if (r.ok) setUsuarios(await leerUsuariosDelSistema());
              avisar(r.ok ? `Usuario ${u.id} dado de alta.` : r.error ?? "No se pudo dar de alta.", r.ok);
              return r;
            }} />
          </aside>

          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-3 py-2">
              <h2 className="text-[11px] font-black uppercase text-slate-700">
                Personalizar {usuarioSel || "—"}
              </h2>
              <p className="text-[10px] text-slate-400">
                Elegí el tipo base y después marcá las excepciones. Lo que no toques queda como lo define el tipo.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-3 py-2">
              {(["heredado", "permitido", "denegado"] as Decision[]).map((d) => (
                <span
                  key={d}
                  className={`rounded px-2 py-0.5 text-[9px] font-black uppercase ${
                    d === "permitido"
                      ? "bg-emerald-100 text-emerald-700"
                      : d === "denegado"
                        ? "bg-red-100 text-red-700"
                        : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {d}
                </span>
              ))}
              <button
                onClick={guardarUsuario}
                disabled={ocupado || !usuarioSel}
                className="ml-auto rounded bg-indigo-600 px-3 py-1 text-[10px] font-black uppercase text-white disabled:opacity-40"
              >
                Guardar personalización
              </button>
            </div>

            <div className="max-h-[30rem] overflow-y-auto">
              {CAPACIDADES.map((c) => {
                const d = excepciones[c.clave] ?? "heredado";
                return (
                  <div key={c.clave} className="flex items-center gap-2 border-b border-slate-50 px-3 py-1.5 last:border-0">
                    <Chip tipo={c.tipo} />
                    <span className="text-[11px] text-slate-600">{c.titulo}</span>
                    <button
                      onClick={() => alternarExcepcion(c.clave)}
                      className={`ml-auto rounded px-2 py-0.5 text-[9px] font-black uppercase transition-colors ${
                        d === "permitido"
                          ? "bg-emerald-100 text-emerald-700"
                          : d === "denegado"
                            ? "bg-red-100 text-red-700"
                            : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                      }`}
                    >
                      {d}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* PESTAÑA 5 — AUDITORÍA                                               */}
      {/* ------------------------------------------------------------------ */}
      {pestana === "auditoria" ? (
        <Guard permiso="seguridad:celda_auditoria">
          <AuditoriaPanel />
        </Guard>
      ) : null}
    </div>
  );
}

/** Formulario de alta de usuario con su tipo. */
function AltaUsuario({
  tipos,
  onGuardar,
}: {
  tipos: TipoUsuario[];
  onGuardar: (u: UsuarioAlta) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [id, setId] = useState("");
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState("operador");
  const [ocupado, setOcupado] = useState(false);

  return (
    <div className="space-y-1.5">
      <input
        value={id}
        onChange={(e) => setId(e.target.value)}
        placeholder="usuario"
        className="w-full rounded border border-slate-300 px-2 py-1 text-[11px] outline-none focus:border-indigo-500"
      />
      <input
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        placeholder="nombre y apellido"
        className="w-full rounded border border-slate-300 px-2 py-1 text-[11px] outline-none focus:border-indigo-500"
      />
      <select
        value={tipo}
        onChange={(e) => setTipo(e.target.value)}
        className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-bold text-slate-600"
      >
        {tipos.map((t) => (
          <option key={String(t.id)} value={t.nombre}>
            {t.nombre}
          </option>
        ))}
      </select>
      <button
        onClick={async () => {
          if (!id.trim()) return;
          setOcupado(true);
          await onGuardar({ id: id.trim().toLowerCase(), nombre: nombre.trim() || null, tipo });
          setOcupado(false);
          setId("");
          setNombre("");
        }}
        disabled={ocupado || !id.trim()}
        className="w-full rounded bg-slate-800 py-1 text-[10px] font-black uppercase text-white disabled:opacity-40"
      >
        Dar de alta
      </button>
      <p className="text-[9px] leading-tight text-slate-400">
        El usuario principal ({USUARIO_PRINCIPAL}) tiene acceso total siempre. A los demás se les asigna un tipo.
      </p>
    </div>
  );
}

async function salirDeLaSesion() {
  const { useAuthStore } = await import("@/store/useAuthStore");
  await useAuthStore.getState().salir();
  if (typeof window !== "undefined") window.location.assign("/login");
}
