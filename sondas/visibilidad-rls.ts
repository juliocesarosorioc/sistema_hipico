/* Sonda: distinguir "no hay huerfanas" de "la RLS no me deja ver la tabla". */
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

const TABLAS = [
  "carreras",
  "tablas_fijas",
  "tablas_fijas_pendientes",
  "resultados_carreras",
  "tickets_apuestas",
  "tickets_jugadas",
  "saldos",
  "dupletas",
  "hipodromos",
];

const run = async () => {
  console.log("tabla".padEnd(24), "visibles".padStart(9), "sin hipodromo_id".padStart(17), " fk_existe");
  for (const t of TABLAS) {
    const todas = await sb.from(t).select("*", { count: "exact", head: true });
    if (todas.error) {
      console.log(t.padEnd(24), "ERROR".padStart(9), ` ${todas.error.message}`.padEnd(18));
      continue;
    }
    const total = todas.count ?? 0;
    const sin = await sb.from(t).select("*", { count: "exact", head: true }).is("hipodromo_id", null);
    const nSin = sin.error ? `ERR:${sin.error.message.slice(0, 20)}` : String(sin.count ?? 0);
    const fk = await sb.from(t).select("*", { count: "exact", head: true }).not("hipodromo_id", "is", null);
    const nFk = fk.error ? "ERR" : String(fk.count ?? 0);
    console.log(
      t.padEnd(24),
      String(total).padStart(9),
      nSin.padStart(17),
      `  ${nFk} con FK / ${total - (Number(nSin) || 0)} sin FK`
    );
  }
};

void run();
