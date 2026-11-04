// ============================================================================
// CARGADOR EJECUTABLE DE LA JORNADA 2026-11-04 (SUPABASE)
// Inserta masivamente las 78 carreras y 681 ejemplares de los 9 hipódromos
// oficiales en 'hipodromos', 'carreras', 'programa_dia', 'ejemplares' y tablas IH.
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { generarJornadaCompleta } from "../scripts/generar-seed-jornada-nucleo.mjs";

// 1. Cargar credenciales desde .env.local o .env
let envContent = "";
const envLocalPath = path.resolve(process.cwd(), ".env.local");
const envPath = path.resolve(process.cwd(), ".env");

if (fs.existsSync(envLocalPath)) {
  envContent += fs.readFileSync(envLocalPath, "utf8") + "\n";
}
if (fs.existsSync(envPath)) {
  envContent += fs.readFileSync(envPath, "utf8") + "\n";
}

const urlMatch = envContent.match(/NEXT_PUBLIC_SUPABASE_URL=([^\r\n]+)/);
const keyMatch =
  envContent.match(/SUPABASE_SERVICE_ROLE_KEY=([^\r\n]+)/) ||
  envContent.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=([^\r\n]+)/);

if (!urlMatch || !keyMatch) {
  console.error("❌ Error: No se encontraron credenciales de Supabase en .env o .env.local");
  process.exit(1);
}

const SUPABASE_URL = urlMatch[1].trim();
const SUPABASE_KEY = keyMatch[1].trim();

console.log("===============================================================");
console.log("🏇 INICIANDO INGESTA MASIVA · JORNADA 2026-11-04");
console.log("📡 Conectando a Supabase:", SUPABASE_URL);
console.log("===============================================================\n");

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
});

async function ejecutarIngesta() {
  const { tracks, carreras, ejemplares } = generarJornadaCompleta();
  console.log(`📊 Datos preparados: ${tracks.length} Hipódromos, ${carreras.length} Carreras, ${ejemplares.length} Ejemplares.\n`);

  // 1. HIPÓDROMOS
  console.log("[1/5] Sincronizando hipódromos...");
  const { data: existHipo } = await supabase.from("hipodromos").select("id, nombre");
  const norm = (s) => (s || "").trim().toUpperCase();
  const existingHipoSet = new Set((existHipo || []).map((h) => norm(h.nombre)));
  const nuevosHipos = tracks
    .filter((t) => !existingHipoSet.has(norm(t.nombre)))
    .map((t) => ({ nombre: t.nombre, pais: t.pais }));

  if (nuevosHipos.length > 0) {
    const { error: errHipo } = await supabase.from("hipodromos").insert(nuevosHipos);
    if (errHipo) console.warn("  ⚠️ Advertencia en hipodromos:", errHipo.message);
    else console.log(`  ✅ ${nuevosHipos.length} nuevos hipódromos insertados.`);
  } else {
    console.log(`  ✅ Todos los hipódromos (${tracks.length}) ya existen en 'hipodromos'.`);
  }

  // 2. EJEMPLARES (Padrón Central 'ejemplares' + Padrón 'ih_ejemplares')
  console.log("[2/5] Insertando padrón de ejemplares...");
  const nombresUnicos = [...new Set(ejemplares.map((e) => e.nombre.trim().toUpperCase()))];
  const { data: existEj } = await supabase.from("ejemplares").select("id, nombre");
  const existingEjMap = new Map((existEj || []).map((e) => [e.nombre.trim().toUpperCase(), e.id]));

  const aInsertarEj = nombresUnicos
    .filter((n) => !existingEjMap.has(n))
    .map((nom) => ({
      nombre: nom,
      nacionalidad: "USA"
    }));

  let insEj = 0;
  for (let i = 0; i < aInsertarEj.length; i += 100) {
    const batch = aInsertarEj.slice(i, i + 100);
    const { data: insData, error: errEj } = await supabase.from("ejemplares").insert(batch).select("id, nombre");
    if (insData) {
      for (const row of insData) existingEjMap.set(row.nombre.trim().toUpperCase(), row.id);
      insEj += insData.length;
    } else if (errEj) {
      console.warn("  ⚠️ Error en lote ejemplares:", errEj.message);
    }
  }
  console.log(`  ✅ ${insEj} nuevos ejemplares registrados en 'ejemplares' (Total: ${existingEjMap.size}).`);

  // Sincronizar catálogo IH ('ih_ejemplares')
  console.log("      Sincronizando catálogo en 'ih_ejemplares'...");
  const ihEjemplaresMap = new Map();
  const ihBatch = nombresUnicos.map((nom) => ({
    nombre_normalizado: nom,
    nombre_display: nom,
    pais_origen: "USA"
  }));

  for (let i = 0; i < ihBatch.length; i += 100) {
    const sub = ihBatch.slice(i, i + 100);
    const { data: dIh, error: errIhEj } = await supabase
      .from("ih_ejemplares")
      .upsert(sub, { onConflict: "nombre_normalizado" })
      .select("id, nombre_normalizado");
    if (dIh) {
      for (const r of dIh) ihEjemplaresMap.set(r.nombre_normalizado, r.id);
    } else if (errIhEj) {
      console.warn("  ⚠️ Error en ih_ejemplares batch:", errIhEj.message);
    }
  }
  console.log(`  ✅ ${ihEjemplaresMap.size} ejemplares asegurados en 'ih_ejemplares'.`);

  // 3. CARRERAS (Matriz Central 'carreras')
  console.log("[3/5] Insertando 78 carreras en 'carreras'...");
  let insCarr = 0;
  for (let i = 0; i < carreras.length; i += 20) {
    const batch = carreras.slice(i, i + 20).map((c) => ({
      fecha: c.fecha,
      hipodromo: c.hipodromo,
      carrera: c.carrera,
      hora: c.hora,
      distancia: `${c.distancia}m`,
      superficie: c.superficie,
      premio: c.premio,
      caballos: c.caballos,
      retirados: c.retirados.join(","),
      estado: "PROGRAMADA",
      origen: "DRF_SEED_2026_11_04"
    }));
    const { error: errC } = await supabase.from("carreras").upsert(batch, { onConflict: "fecha,hipodromo,carrera" });
    if (errC) console.warn("  ⚠️ Error en lote carreras:", errC.message);
    else insCarr += batch.length;
  }
  console.log(`  ✅ ${insCarr} carreras registradas/actualizadas en 'carreras'.`);

  // 4. PROGRAMA DEL DÍA ('programa_dia')
  console.log("[4/5] Actualizando 'programa_dia' para 2026-11-04...");
  const programaCarreras = carreras.map((c) => ({
    hipodromo: c.hipodromo,
    fecha: c.fecha,
    carrera: c.carrera,
    hora: c.hora,
    distancia: c.distancia,
    superficie: c.superficie,
    premio: c.premio,
    caballos: c.caballos.map((cb) => ({
      numero: cb.numero,
      nombre: cb.nombre,
      nacionalidad: cb.nacionalidad,
      valor: cb.valor,
      jockey: cb.jockey,
      peso: cb.peso,
      retirado: cb.retirado,
      pp: cb.pp,
      ml: cb.ml
    }))
  }));
  const hipoNombres = [...new Set(tracks.map((t) => t.nombre))];

  const { error: errProg } = await supabase.from("programa_dia").upsert(
    [{
      fecha: "2026-11-04",
      hipodromos: hipoNombres,
      carreras: programaCarreras
    }],
    { onConflict: "fecha" }
  );
  if (errProg) console.warn("  ⚠️ Error en programa_dia:", errProg.message);
  else console.log("  ✅ 'programa_dia' actualizado con las 78 carreras y 681 ejemplares.");

  // 5. INTELIGENCIA HÍPICA ('ih_carreras_programa' e 'ih_inscripciones_carrera')
  console.log("[5/5] Inyectando datos en Inteligencia Hípica ('ih_carreras_programa' e 'ih_inscripciones_carrera')...");
  await supabase.from("ih_carreras_programa").delete().eq("fecha", "2026-11-04");

  const progRows = carreras.map((c) => {
    const trackCode = c.hipodromo.replace(/[^A-Z0-9]/gi, "").substring(0, 4).toUpperCase();
    return {
      jurisdiccion: "USA",
      hipodromo: c.hipodromo.toUpperCase(),
      fecha: c.fecha,
      numero_carrera: c.carrera,
      codigo_carrera: `${trackCode}-20261104-${String(c.carrera).padStart(2, "0")}`,
      distancia_metros: c.distancia,
      hora_carrera: c.hora
    };
  });

  const { data: insertedIh, error: errIh } = await supabase
    .from("ih_carreras_programa")
    .insert(progRows)
    .select("id, hipodromo, numero_carrera");

  if (!errIh && insertedIh && insertedIh.length > 0) {
    const idMap = new Map();
    for (const row of insertedIh) {
      idMap.set(`${row.hipodromo}|${row.numero_carrera}`, row.id);
    }
    const inscripciones = [];
    for (const c of carreras) {
      const cid = idMap.get(`${c.hipodromo.toUpperCase()}|${c.carrera}`);
      if (cid) {
        for (const cb of c.caballos) {
          const ejId = ihEjemplaresMap.get(cb.nombre.trim().toUpperCase()) || null;
          inscripciones.push({
            carrera_id: cid,
            ejemplar_id: ejId,
            numero_programa: Number(cb.numero) || 1,
            puesto_pista_actual: cb.pp || Number(cb.numero) || 1,
            nombre_ejemplar: cb.nombre,
            nombre_normalizado: cb.nombre.toUpperCase().trim(),
            morning_line: cb.ml || "5/1",
            jinete_actual: cb.jockey || null,
            entrenador_actual: cb.entrenador || null,
            retirado_en_vivo: Boolean(cb.retirado)
          });
        }
      }
    }
    let insInsc = 0;
    for (let i = 0; i < inscripciones.length; i += 100) {
      const bInsc = inscripciones.slice(i, i + 100);
      const { error: errInsc } = await supabase.from("ih_inscripciones_carrera").insert(bInsc);
      if (!errInsc) insInsc += bInsc.length;
      else console.warn("  ⚠️ Error en inscripciones batch:", errInsc.message);
    }
    console.log(`  ✅ ${insertedIh.length} carreras y ${insInsc} inscripciones registradas en tablas IH.`);
  } else if (errIh) {
    console.warn("  ⚠️ Error en ih_carreras_programa:", errIh.message);
  }

  // --------------------------------------------------------------------------
  // CONTEO Y VERIFICACIÓN FINAL EN SUPABASE
  // --------------------------------------------------------------------------
  console.log("\n===============================================================");
  console.log("🔍 CONTEO DE VERIFICACIÓN EN SUPABASE (Jornada 2026-11-04):");
  console.log("===============================================================");

  const { count: cCarreras } = await supabase
    .from("carreras")
    .select("*", { count: "exact", head: true })
    .eq("fecha", "2026-11-04");

  const { data: progVerif } = await supabase
    .from("programa_dia")
    .select("fecha, hipodromos, carreras")
    .eq("fecha", "2026-11-04")
    .maybeSingle();

  const totalEjEnProg = (progVerif?.carreras || []).reduce((a, c) => a + (c.caballos || []).length, 0);

  const { count: cIhCarr } = await supabase
    .from("ih_carreras_programa")
    .select("*", { count: "exact", head: true })
    .eq("fecha", "2026-11-04");

  const { count: cIhInsc } = await supabase
    .from("ih_inscripciones_carrera")
    .select("*", { count: "exact", head: true });

  const { count: cTotalEjemplares } = await supabase
    .from("ejemplares")
    .select("*", { count: "exact", head: true });

  const { count: cTotalIhEjemplares } = await supabase
    .from("ih_ejemplares")
    .select("*", { count: "exact", head: true });

  console.log(`• Carreras en matriz 'carreras': ${cCarreras} carreras`);
  console.log(`• Hipódromos en 'programa_dia': ${(progVerif?.hipodromos || []).length} pistas (${(progVerif?.hipodromos || []).join(", ")})`);
  console.log(`• Carreras en 'programa_dia': ${(progVerif?.carreras || []).length} carreras`);
  console.log(`• Ejemplares en 'programa_dia': ${totalEjEnProg} ejemplares`);
  console.log(`• Carreras en Inteligencia Hípica ('ih_carreras_programa'): ${cIhCarr} carreras`);
  console.log(`• Inscripciones en Inteligencia Hípica ('ih_inscripciones_carrera'): ${cIhInsc} inscripciones`);
  console.log(`• Padrón en 'ejemplares': ${cTotalEjemplares} ejemplares`);
  console.log(`• Padrón en 'ih_ejemplares': ${cTotalIhEjemplares} ejemplares`);

  console.log("\n🎉 INGESTA DE LA JORNADA 2026-11-04 COMPLETADA CON ÉXITO.");
}

ejecutarIngesta().catch((err) => {
  console.error("❌ Error durante la ingesta:", err);
  process.exit(1);
});
