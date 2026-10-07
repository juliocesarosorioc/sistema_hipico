/* Sonda de SOLO LECTURA: cuantas carreras de la matriz estan sin hipodromo_id
   y como se ven sus nombres contra el catalogo de hipodromos. */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const run = async () => {
  const catalogo = await sb.from("hipodromos").select("id, nombre");
  console.log("hipodromos ->", catalogo.error ? `ERROR ${catalogo.error.message}` : `${catalogo.data?.length ?? 0} filas`);

  const sueltas = await sb
    .from("carreras")
    .select("id, fecha, carrera, hipodromo, hipodromo_id, estado")
    .is("hipodromo_id", null)
    .limit(2000);
  console.log("carreras sin hipodromo_id ->", sueltas.error ? `ERROR ${sueltas.error.message}` : `${sueltas.data?.length ?? 0} filas`);
  if (sueltas.error || !sueltas.data) return;

  const conNombre = sueltas.data.filter((c) => String(c.hipodromo ?? "").trim() !== "");
  console.log(`de ellas, con nombre de hipodromo: ${conNombre.length}`);

  const norm = (s: string) =>
    String(s ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/gi, "")
      .toUpperCase();
  const porNombre = new Map<string, { id: string; nombre: string }[]>();
  for (const h of catalogo.data ?? []) {
    const k = norm(h.nombre);
    porNombre.set(k, [...(porNombre.get(k) ?? []), { id: h.id, nombre: h.nombre }]);
  }

  const exactas: string[] = [];
  const ambiguas: string[] = [];
  const sinMatch: string[] = [];
  for (const c of conNombre) {
    const k = norm(c.hipodromo);
    const hits = porNombre.get(k) ?? [];
    if (hits.length === 1) exactas.push(c.hipodromo as string);
    else if (hits.length > 1) ambiguas.push(`${c.hipodromo} -> ${hits.length} candidatos`);
    else sinMatch.push(c.hipodromo as string);
  }
  const uniq = (a: string[]) => [...new Set(a)].sort();
  console.log("\n== MATCH EXACTO (enlazables sin ambiguedad) ==");
  console.log(uniq(exactas).join(" | ") || "(ninguno)");
  console.log("\n== AMBIGUOS (mismo nombre normalizado, >1 hipodromo) ==");
  console.log(uniq(ambiguas).join(" | ") || "(ninguno)");
  console.log("\n== SIN MATCH en el catalogo ==");
  console.log(uniq(sinMatch).join(" | ") || "(ninguno)");
  console.log(`\nfilas enlazables: ${exactas.length} de ${conNombre.length}`);
  console.log(`filas con hipodromo vacio/NULL: ${sueltas.data.length - conNombre.length}`);
};

void run();
