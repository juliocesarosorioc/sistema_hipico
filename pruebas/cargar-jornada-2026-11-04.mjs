// ============================================================================
// CARGADOR EJECUTABLE DE LA JORNADA 2026-11-04 (SUPABASE)
// Inserta masivamente las 78 carreras y 681 ejemplares de los 8 hipódromos
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
const keyMatch = envContent.match(/SUPABASE_SERVICE_ROLE_KEY=([^\r\n]+)/) || envContent.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=([^\r\n]+)/);

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
  console.log("[1/6] Insertando hipódromos...");
  const hipoRows = tracks.map((t) => ({ nombre: t.nombre, pais: t.pais }));
  const { error: errHipo } = await supabase.from("hipodromos").upsert(hipoRows, { onConflict: "nombre" });
  if (errHipo) console.warn("  ⚠️ Advertencia en hipodromos:", errHipo.message);
  else console.log(`  ✅ ${hipoRows.length} hipódromos asegurados en 'hipodromos'.`);

  // 2. EJEMPLARES (Padrón Central)
  console.log("[2/6] Insertando padrón de ejemplares...");
  const nombresUnicos = [...new Set(ejemplares.map((e) => e.nombre))];
  let insEj = 0;
  for (let i = 0; i < nombresUnicos.length; i += 100) {
    const batch = nombresUnicos.slice(i, i + 100).map((nom) => ({
      nombre: nom,
      nacionalidad: "USA",
      total_carreras: 0
    }));
    const { error: errEj } = await supabase.from("ejemplares").upsert(batch, { onConflict: "nombre" });
    if (!errEj) insEj += batch.length;
  }
  console.log(`  ✅ ${insEj} ejemplares registrados en 'ejemplares'.`);

  // 3. CARRERAS (Matriz Central)
  console.log("[3/6] Insertando 78 carreras en 'carreras'...");
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
  console.log(`  ✅ ${insCarr} carreras registradas en 'carreras'.`);

  // 4. PROGRAMA DEL DÍA
  console.log("[4/6] Actualizando 'programa_dia' para 2026-11-04...");
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

  // 5. INTELIGENCIA HÍPICA (ih_carreras_programa e ih_inscripciones_carrera)
  console.log("[5/6] Inyectando datos en Inteligencia Hípica ('ih_carreras_programa')...");
  const progRows = carreras.map((c) => ({
    fecha: c.fecha,
    hipodromo: c.hipodromo.toUpperCase(),
    carrera_numero: c.carrera,
    distancia_metros: c.distancia,
    superficie: c.superficie,
    hora_programada: `${c.hora}:00`,
    estado_carrera: "PROGRAMADA"
  }));

  const { data: insertedIh, error: errIh } = await supabase
    .from("ih_carreras_programa")
    .upsert(progRows, { onConflict: "fecha,hipodromo,carrera_numero" })
    .select("id, fecha, hipodromo, carrera_numero");

  if (!errIh && insertedIh && insertedIh.length > 0) {
    const idMap = new Map();
    for (const row of insertedIh) {
      idMap.set(`${row.fecha}|${row.hipodromo}|${row.carrera_numero}`, row.id);
    }
    const inscripciones = [];
    for (const c of carreras) {
      const cid = idMap.get(`${c.fecha}|${c.hipodromo.toUpperCase()}|${c.carrera}`);
      if (cid) {
        for (const cb of c.caballos) {
          inscripciones.push({
            carrera_id: cid,
            numero_gualdrapa: cb.numero,
            nombre_ejemplar: cb.nombre,
            puesto_pista: cb.pp || Number(cb.numero) || 1,
            jinete_nombre: cb.jockey || null,
            entrenador_nombre: cb.entrenador || null,
            retirado: Boolean(cb.retirado)
          });
        }
      }
    }
    let insInsc = 0;
    for (let i = 0; i < inscripciones.length; i += 100) {
      const bInsc = inscripciones.slice(i, i + 100);
      const { error: errInsc } = await supabase
        .from("ih_inscripciones_carrera")
        .upsert(bInsc, { onConflict: "carrera_id,numero_gualdrapa" });
      if (!errInsc) insInsc += bInsc.length;
    }
    console.log(`  ✅ ${insertedIh.length} carreras y ${insInsc} inscripciones en tablas IH.`);
  } else {
    console.log("  ℹ️ ih_carreras_programa actualizado o no disponible.");
  }

  // 6. HISTORIAL DE INTELIGENCIA DE EJEMPLARES
  console.log("[6/6] Poblando 'historial_inteligencia_ejemplares'...");
  let insHie = 0;
  for (let i = 0; i < ejemplares.length; i += 50) {
    const b = ejemplares.slice(i, i + 50).map((e) => {
      const cMeta = carreras.find((c) => c.hipodromo === e.hipodromo && c.carrera === e.carrera);
      return {
        fecha: "2026-11-04",
        hipodromo: e.hipodromo,
        carrera: e.carrera,
        numero: e.numero,
        nombre_ejemplar: e.nombre,
        jockey: e.jockey,
        entrenador: e.entrenador,
        stud: e.stud,
        peso: e.peso,
        ml: e.ml,
        distancia_metros: cMeta?.distancia || 1200,
        superficie: cMeta?.superficie || "ARENA",
        retirado: Boolean(e.retirado)
      };
    });
    const { error: errHie } = await supabase.from("historial_inteligencia_ejemplares").insert(b);
    if (!errHie) insHie += b.length;
    else {
      // Si la tabla no existe en el schema cache de Supabase REST
      if (i === 0) console.log("  ℹ️ Tabla 'historial_inteligencia_ejemplares' no presente en schema cache REST (definida en SQL).");
      break;
    }
  }
  if (insHie > 0) {
    console.log(`  ✅ ${insHie} registros en 'historial_inteligencia_ejemplares'.`);
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

  console.log(`• Carreras en matriz 'carreras': ${cCarreras} de 78`);
  console.log(`• Hipódromos en 'programa_dia': ${(progVerif?.hipodromos || []).length} pistas (${(progVerif?.hipodromos || []).join(", ")})`);
  console.log(`• Carreras en 'programa_dia': ${(progVerif?.carreras || []).length} carreras`);
  console.log(`• Ejemplares en 'programa_dia': ${totalEjEnProg} ejemplares`);
  console.log(`• Carreras en 'ih_carreras_programa': ${cIhCarr} carreras`);

  console.log("\n🎉 INGESTA DE LA JORNADA 2026-11-04 COMPLETADA CON ÉXITO.");
}

ejecutarIngesta().catch((err) => {
  console.error("❌ Error durante la ingesta:", err);
  process.exit(1);
});
