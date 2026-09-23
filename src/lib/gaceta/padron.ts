import { supabase } from "@/lib/supabase";

export type EjemplarPadron = {
  nombre: string;
  nacionalidad: string;
  registrado: string;
  totalTablas: number;
  ultimaTabla: string;
};

export type ResLeerPadron = {
  ok: boolean;
  data: EjemplarPadron[];
  error?: string;
  rls?: boolean;
};

const PAISES: Record<string, string> = {
  VE: "Venezuela",
  USA: "Estados Unidos",
  BR: "Brasil",
  AR: "Argentina",
  CL: "Chile",
  MX: "México",
  PA: "Panamá",
  PE: "Perú",
  CO: "Colombia",
  EC: "Ecuador",
  UY: "Uruguay",
};

const NOMBRES_PAIS: Record<string, Set<string>> = {
  VE: new Set(["VE", "VENEZUELA", "VEN"]),
  USA: new Set(["USA", "US", "EEUU", "ESTADOS UNIDOS", "EUA"]),
  BR: new Set(["BR", "BRA", "BRASIL", "BRAZIL"]),
  AR: new Set(["AR", "ARG", "ARGENTINA"]),
  CL: new Set(["CL", "CHILE"]),
  MX: new Set(["MX", "MEX", "MEXICO"]),
  PA: new Set(["PA", "PAN", "PANAMA", "PANAMÁ"]),
  PE: new Set(["PE", "PER", "PERU", "PERÚ"]),
  CO: new Set(["CO", "COL", "COLOMBIA"]),
  EC: new Set(["EC", "ECU", "ECUADOR"]),
  UY: new Set(["UY", "URU", "URUGUAY"]),
};

/** Bandera emoji a partir del código ISO-2 (same as legacy clubUI.bandera). */
export function bandera(nac: string): string {
  const c = (nac ?? "VE").toUpperCase().slice(0, 2);
  if (!/^[A-Z]{2}$/.test(c)) return "🇻🇪";
  return String.fromCodePoint(...Array.from(c, (ch) => 127397 + ch.charCodeAt(0)));
}

export function nombrePais(nac: string): string {
  return PAISES[(nac ?? "VE").toUpperCase()] ?? (nac || "VE");
}

export function fmtFecha(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** Lee el padrón (RPC segura con fallback al SELECT directo) + conteo de tablas. */
export async function leerPadron(): Promise<ResLeerPadron> {
  if (!supabase) {
    return { ok: false, data: [], error: "Sin credenciales Supabase (.env.local)." };
  }
  const safe = async <T>(p: PromiseLike<T>): Promise<{ data: T | null; error: { message?: string; code?: string } | null }> => {
    try {
      const r = await p;
      const e = (r as { error?: { message?: string; code?: string } | null }).error;
      if (e) return { data: null, error: e };
      return { data: (r as { data?: T }).data ?? (r as T), error: null };
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
    }
  };

  const rpc = await safe(supabase.rpc("club_listar_ejemplares"));
  const rE = Array.isArray(rpc.data)
    ? rpc
    : await safe(supabase.from("ejemplares").select("id, nombre, nacionalidad, created_at").order("nombre"));

  const rT = await safe(supabase.from("tablas_fijas").select("id, hipodromo, carrera, caballos"));

  const rEdata = (rE.data ?? null) as
    | Array<{ id: string | number; nombre: string; nacionalidad?: string | null; created_at?: string | null }>
    | null;
  const rTdata = rT.data;

  const err = rE.error as { message?: string; code?: string } | null | undefined;
  if (err) {
    const msj = err.message || err.code || String(err);
    return {
      ok: false,
      data: [],
      error: msj,
      rls: /row-level security|permission denied|42501|401/i.test(msj),
    };
  }

  const ejemplares = rEdata ?? [];
  const tablas = (rTdata ?? []) as Array<{
    id: string | number;
    hipodromo?: string | null;
    carrera?: number | null;
    caballos?: Array<{ ejemplar_id?: string | number } | null> | null;
  }>;

  const conteo = new Map<string, { tablas: Set<unknown>; idMayor: number; txt: string }>();
  for (const t of tablas) {
    for (const c of t.caballos ?? []) {
      if (!c || c.ejemplar_id == null) continue;
      const k = String(c.ejemplar_id);
      const info = conteo.get(k) ?? { tablas: new Set<unknown>(), idMayor: 0, txt: "" };
      info.tablas.add(t.id);
      if (Number(t.id) > info.idMayor) {
        info.idMayor = Number(t.id);
        info.txt = `${t.hipodromo || "?"} C${t.carrera ?? "?"}`;
      }
      conteo.set(k, info);
    }
  }

  const data: EjemplarPadron[] = ejemplares.map((e) => {
    const info = conteo.get(String(e.id));
    return {
      nombre: e.nombre,
      nacionalidad: e.nacionalidad || "VE",
      registrado: e.created_at ?? "",
      totalTablas: info ? info.tablas.size : 0,
      ultimaTabla: info ? info.txt : "",
    };
  });

  return { ok: true, data };
}

/** Filtro de padrón con la misma lógica de países que el legacy (ISO exacto vs subcadena). */
export function filtrarPadron(
  lista: EjemplarPadron[],
  termino: string
): EjemplarPadron[] {
  const f = termino.trim().toUpperCase();
  if (!f) return [...lista].sort((a, b) => b.totalTablas - a.totalTablas || a.nombre.localeCompare(b.nombre));

  let nacExacta = "";
  for (const [cod, sinonimos] of Object.entries(NOMBRES_PAIS)) {
    if (sinonimos.has(f)) {
      nacExacta = cod;
      break;
    }
  }

  return lista
    .filter((e) => {
      if (nacExacta) return (e.nacionalidad ?? "VE").toUpperCase() === nacExacta;
      return (e.nombre ?? "").toUpperCase().includes(f) || (e.nacionalidad ?? "").toUpperCase().includes(f);
    })
    .sort((a, b) => b.totalTablas - a.totalTablas || a.nombre.localeCompare(b.nombre));
}

/** Exporta el padrón a CSV (BOM UTF-8). */
export function exportarPadronCSV(lista: EjemplarPadron[]): void {
  const lineas = [["Nombre", "Nacionalidad", "Apariciones en Tablas", "Ultima Aparicion"].join(";")];
  [...lista]
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
    .forEach((e) => lineas.push([e.nombre, e.nacionalidad, e.totalTablas, e.ultimaTabla].join(";")));
  const blob = new Blob(["\uFEFF" + lineas.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "padron_ejemplares.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}