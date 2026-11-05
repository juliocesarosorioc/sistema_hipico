import { NextRequest } from "next/server";
import { GET, POST, esHipodromoVenezolano, normalizarCodigo } from "../src/app/api/sincronizar-usa/route";

let pasan = 0;
let fallan = 0;

function ok(nombre: string, condicion: boolean) {
  if (condicion) {
    pasan++;
    console.log(`  ✅ ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  ❌ FALLA ${nombre}`);
  }
}

async function testApiSincronizarUsa() {
  console.log("\n=======================================================");
  console.log("🏇 VALIDACIÓN END-TO-END DE API ROUTE /api/sincronizar-usa");
  console.log("=======================================================\n");

  // 1. Jurisdicción Anti-Venezuela
  console.log("[1] JURISDICCIÓN EXCLUSIVA USA EN API ROUTE");
  ok("esHipodromoVenezolano detecta 'La Rinconada'", esHipodromoVenezolano("La Rinconada") === true);
  ok("esHipodromoVenezolano detecta 'Valencia'", esHipodromoVenezolano("Valencia") === true);
  ok("esHipodromoVenezolano detecta 'Santa Rita'", esHipodromoVenezolano("Santa Rita") === true);
  ok("esHipodromoVenezolano aprueba 'Churchill Downs'", esHipodromoVenezolano("Churchill Downs") === false);
  ok("normalizarCodigo('CD') -> 'CD'", normalizarCodigo("CD") === "CD");
  ok("normalizarCodigo('Churchill Downs') -> 'CD'", normalizarCodigo("Churchill Downs") === "CD");

  // 2. Detección automática de hipódromos del día vía GET
  console.log("\n[2] DETECCIÓN AUTOMÁTICA DE HIPÓDROMOS DRF (GET)");
  const reqGet = new NextRequest("http://localhost:3000/api/sincronizar-usa?accion=detectar_tracks&fecha=2026-11-05");
  const resGet = await GET(reqGet);
  const dataGet = await resGet.json();

  ok("GET responde status 200", resGet.status === 200);
  ok("GET responde ok: true", dataGet.ok === true);
  ok("GET fecha es 2026-11-05", dataGet.fecha === "2026-11-05");
  ok("GET contiene lista de tracks", Array.isArray(dataGet.tracks) && dataGet.tracks.length > 0);
  ok("GET contiene Churchill Downs (CD) o Belmont (BEL)", dataGet.tracks.includes("CD") || dataGet.tracks.includes("BEL"));
  console.log(`     -> Detectados ${dataGet.tracks.length} hipódromos: ${dataGet.tracks.slice(0, 8).join(", ")}...`);

  // 3. Sincronización Real de Carreras USA desde DRF vía POST
  console.log("\n[3] DESCARGA Y PARSING DE CARRERAS USA REALES (POST)");
  const reqPost = new NextRequest("http://localhost:3000/api/sincronizar-usa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accion: "sincronizar",
      fecha: "2026-11-05",
      tracks: ["CD"],
    }),
  });

  const resPost = await POST(reqPost);
  const dataPost = await resPost.json();

  ok("POST responde status 200", resPost.status === 200);
  ok("POST responde ok: true", dataPost.ok === true);
  ok("POST totalCarreras > 0 (10 carreras CD)", dataPost.totalCarreras === 10);
  ok("POST totalEjemplares >= 70", dataPost.totalEjemplares >= 70);
  ok("POST totalRetirados > 0", dataPost.totalRetirados > 0);
  ok("POST tracksProcesados incluye 'Churchill Downs'", dataPost.tracksProcesados.includes("Churchill Downs"));

  const c1 = dataPost.carreras.find((c: any) => c.carrera === 1);
  ok("Carrera 1 de CD presente", !!c1);
  ok("Carrera 1 tiene hora en formato HH:MM", /^\d{2}:\d{2}$/.test(c1?.hora || ""));
  ok("Carrera 1 distancia 6 Furlongs es 1200 metros", c1?.distancia === 1200);
  ok("Carrera 1 superficie es ARENA", c1?.superficie === "ARENA");
  ok("Carrera 1 premio es 48000", c1?.premio === 48000);

  // Verificación de caballos y scratches
  const flMama = c1?.caballos.find((h: any) => h.nombre.includes("FLAMING MAMA"));
  ok("Flaming Mama presente en C1", !!flMama);
  ok("Flaming Mama NO está retirada (scratchIndicator = 'N')", flMama?.retirado === false);
  ok("Flaming Mama tiene jockey asignado", !!flMama?.jockey);
  ok("Flaming Mama tiene trainer asignado", !!flMama?.entrenador);
  ok("Flaming Mama tiene morning line odds", !!flMama?.ml);

  const flashAviator = c1?.caballos.find((h: any) => h.nombre.includes("FLASHY AVIATOR"));
  ok("Flashy Aviator presente en C1", !!flashAviator);
  ok("Flashy Aviator SÍ está retirado (scratchIndicator = 'Y')", flashAviator?.retirado === true);
  ok("Lista de retirados de C1 incluye el número de Flashy Aviator ('2')", (c1?.retirados || []).includes("2"));

  // 4. Bloqueo estricto de hipódromos venezolanos en POST
  console.log("\n[4] BLOQUEO ESTRICTO DE HIPÓDROMOS VENEZOLANOS");
  const reqPostVzla = new NextRequest("http://localhost:3000/api/sincronizar-usa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accion: "sincronizar",
      fecha: "2026-11-05",
      tracks: ["La Rinconada", "Valencia"],
    }),
  });

  const resPostVzla = await POST(reqPostVzla);
  const dataPostVzla = await resPostVzla.json();
  ok("POST con hipódromos venezolanos no importa carreras (totalCarreras = 0)", dataPostVzla.totalCarreras === 0);
  ok("POST con hipódromos venezolanos ok = false", dataPostVzla.ok === false);

  console.log("\n=======================================================");
  console.log(`📊 RESULTADO API ROUTE: ${pasan} pasaron, ${fallan} fallaron.`);
  console.log("=======================================================\n");

  if (fallan > 0) {
    process.exit(1);
  }
}

void testApiSincronizarUsa();
