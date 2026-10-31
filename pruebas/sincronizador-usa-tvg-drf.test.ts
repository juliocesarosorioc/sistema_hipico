// ============================================================================
// PRUEBAS DE AUTOMATIZACIÓN: MOTOR DE SINCRONIZACIÓN USA (TVG + DRF)
// ============================================================================
// Verifica:
//   1. Aislamiento Jurisdiccional (Prohibido Venezuela: La Rinconada y Valencia).
//   2. Parser Heurístico y Multi-Fuente (TVG + DRF entries y scratches).
//   3. Poblado y Normalización de Ejemplares y Carreras con Metadatos.
//   4. Sincronización y Propagación de Retirados (Scratches).
//   5. Herramienta del Agente IA Copiloto y Soporte Transaccional.
//
// Corre con: npx tsx pruebas/sincronizador-usa-tvg-drf.test.ts
// ============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  esHipodromoVenezolano,
  parsearTextoPegadoUsa,
  sincronizarCarrerasAmericanasDia,
  HIPODROMOS_USA_DISPONIBLES,
  extraerFechaDeTexto,
  extraerHipodromoDeTexto,
} from "../src/features/carreras/lib/sincronizar-usa-tvg-drf";
import { herramienta_sincronizar_carreras_usa } from "../src/features/ia-copiloto/lib/agente-transaccional";

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

async function ejecutarPruebas() {
  console.log("\n=======================================================");
  console.log("🏁 INICIANDO PRUEBAS DEL MOTOR SINCRONIZADOR USA (TVG / DRF)");
  console.log("=======================================================\n");

  const raiz = process.cwd();

  // --------------------------------------------------------------------------
  // 1. AISLAMIENTO JURISDICCIONAL ESTRICTO (PROHIBIDO VENEZUELA)
  // --------------------------------------------------------------------------
  console.log("[1] AISLAMIENTO JURISDICCIONAL ESTRICTO");

  ok("La Rinconada detectada como hipódromo venezolano", esHipodromoVenezolano("La Rinconada") === true);
  ok("Valencia detectada como hipódromo venezolano", esHipodromoVenezolano("Valencia") === true);
  ok("Santa Rita detectada como hipódromo venezolano", esHipodromoVenezolano("Santa Rita") === true);
  ok("Gulfstream Park NO es venezolano", esHipodromoVenezolano("Gulfstream Park") === false);
  ok("Santa Anita NO es venezolano", esHipodromoVenezolano("Santa Anita") === false);
  ok("Saratoga NO es venezolano", esHipodromoVenezolano("Saratoga") === false);
  ok("Tampa Bay Downs NO es venezolano", esHipodromoVenezolano("Tampa Bay Downs") === false);

  let errorLanzado = false;
  try {
    parsearTextoPegadoUsa("1 Speightstown", "La Rinconada");
  } catch (err: unknown) {
    errorLanzado = true;
    const msg = err instanceof Error ? err.message : String(err);
    ok("parsearTextoPegadoUsa bloquea La Rinconada con excepción", msg.includes("Jurisdicción exclusiva USA"));
  }
  ok("parsearTextoPegadoUsa lanzó error con hipódromo venezolano", errorLanzado);

  const resBloqueoSync = await sincronizarCarrerasAmericanasDia({
    hipodromoPegado: "Valencia",
    htmlOTextoPegado: "1 Fierceness",
  });
  ok("sincronizarCarrerasAmericanasDia rechaza hipódromo venezolano", resBloqueoSync.ok === false);
  ok("sincronizarCarrerasAmericanasDia mensaje de error menciona exclusión", (resBloqueoSync.error ?? "").includes("excluido"));

  // Verificar que la Edge Function tiene guardia jurisdiccional
  const edgeFunctionPath = join(raiz, "supabase", "functions", "sync-usa-races", "index.ts");
  const edgeFunctionSrc = readFileSync(edgeFunctionPath, "utf8");
  ok("Edge Function contiene guardia esHipodromoVenezolano", edgeFunctionSrc.includes("esHipodromoVenezolano"));
  ok("Edge Function excluye La Rinconada", edgeFunctionSrc.includes("La Rinconada") && edgeFunctionSrc.includes("403"));

  // --------------------------------------------------------------------------
  // 2. PARSER HEURÍSTICO / ASISTIDO MULTI-FUENTE (TVG / DRF)
  // --------------------------------------------------------------------------
  console.log("\n[2] PARSER HEURÍSTICO Y EXTRACCIÓN DE ENTRADAS DESESTRUCTURADAS");

  const textoTvgSimulado = `
Race 1 - 12:35 PM - Gulfstream Park
1 Fierceness (PP: 1, ML: 4/5, Jockey: John R. Velazquez, Trainer: Todd A. Pletcher, Weight: 124)
2 Sierra Leone (PP: 2, ML: 3/1, Jockey: Tyler Gaffalione, Trainer: Chad C. Brown)
3 Forever Young (PP: 3, ML: 8/1, Jockey: Ryusei Sakai, Trainer: Yoshito Yahagi)
4 Dornoch (SCRATCHED)

Race 2 - 1:07 PM - Gulfstream Park
1 Thorpedo Anna (PP: 1, ML: 6/5, Jockey: Brian J. Hernandez Jr., Trainer: Kenneth G. McPeek)
1A Tarifa (PP: 2, ML: 4/1, Jockey: Flavien Prat, Trainer: Brad H. Cox)
2 Leslie's Rose (SCR)
3 Ways and Means (PP: 3, ML: 5/2, Jockey: Irad Ortiz Jr., Trainer: Chad C. Brown)
`;

  const carrerasParseadas = parsearTextoPegadoUsa(textoTvgSimulado, "Gulfstream Park", "2026-10-31");

  ok("Extrajo exactamente 2 carreras", carrerasParseadas.length === 2);
  const c1 = carrerasParseadas.find((c) => c.carrera === 1);
  const c2 = carrerasParseadas.find((c) => c.carrera === 2);

  ok("Carrera 1 encontrada", !!c1);
  ok("Carrera 2 encontrada", !!c2);
  ok("Carrera 1 tiene hora 12:35 PM", (c1?.hora ?? "").includes("12:35"));
  ok("Carrera 1 tiene 4 ejemplares parseados", c1?.caballos.length === 4);

  const fierceness = c1?.caballos.find((cb) => cb.numero === "1");
  ok("Fierceness tiene nombre correcto", fierceness?.nombre === "FIERCENESS");
  ok("Fierceness tiene jockey John R. Velazquez", (fierceness?.jockey ?? "").includes("Velazquez"));
  ok("Fierceness tiene ML 4/5", fierceness?.ml === "4/5");
  ok("Fierceness no está retirado", fierceness?.retirado === false);

  const dornoch = c1?.caballos.find((cb) => cb.numero === "4");
  ok("Dornoch detectado como retirado", dornoch?.retirado === true);
  ok("Lista de retirados de C1 incluye el 4", (c1?.retirados ?? []).includes("4"));

  // Llave/acoplado 1A en Carrera 2
  const tarifa = c2?.caballos.find((cb) => cb.numero === "1A");
  ok("Acoplado 1A reconocido limpiamente", tarifa?.nombre === "TARIFA");
  const leslie = c2?.caballos.find((cb) => cb.numero === "2");
  ok("Leslie's Rose detectada como SCR", leslie?.retirado === true);
  ok("Lista de retirados de C2 incluye el 2", (c2?.retirados ?? []).includes("2"));

  // --------------------------------------------------------------------------
  // 3. NORMALIZACIÓN DE PAYLOAD MULTI-TRACK Y CATÁLOGO USA
  // --------------------------------------------------------------------------
  console.log("\n[3] CATÁLOGO DE HIPÓDROMOS AMERICANOS Y NORMALIZACIÓN");

  ok("Catálogo contiene Gulfstream Park (GP)", HIPODROMOS_USA_DISPONIBLES.some((h) => h.codigo === "GP" && h.nombre === "Gulfstream Park"));
  ok("Catálogo contiene Santa Anita (SA)", HIPODROMOS_USA_DISPONIBLES.some((h) => h.codigo === "SA" && h.nombre === "Santa Anita"));
  ok("Catálogo contiene Saratoga (SAR)", HIPODROMOS_USA_DISPONIBLES.some((h) => h.codigo === "SAR" && h.nombre === "Saratoga"));
  ok("Catálogo contiene Churchill Downs (CD)", HIPODROMOS_USA_DISPONIBLES.some((h) => h.codigo === "CD" && h.nombre === "Churchill Downs"));
  ok("Catálogo contiene Tampa Bay Downs (TAM)", HIPODROMOS_USA_DISPONIBLES.some((h) => h.codigo === "TAM" && h.nombre === "Tampa Bay Downs"));
  ok("Catálogo contiene Aqueduct (AQU)", HIPODROMOS_USA_DISPONIBLES.some((h) => h.codigo === "AQU" && h.nombre === "Aqueduct"));
  ok("Ningún hipódromo del catálogo es venezolano", HIPODROMOS_USA_DISPONIBLES.every((h) => !esHipodromoVenezolano(h.nombre)));

  // --------------------------------------------------------------------------
  // 4. INTEGRACIÓN CON AGENTE IA COPILOTO Y HERRAMIENTA
  // --------------------------------------------------------------------------
  console.log("\n[4] HERRAMIENTA Y AGENTE IA COPILOTO");

  ok("herramienta_sincronizar_carreras_usa está exportada y tipada", typeof herramienta_sincronizar_carreras_usa === "function");

  // Verificar el contenido de agente-transaccional.ts y asistenteIa.ts
  const agenteSrc = readFileSync(join(raiz, "src", "features", "ia-copiloto", "lib", "agente-transaccional.ts"), "utf8");
  ok("agente-transaccional maneja tipoAccion SINCRONIZACION_USA", agenteSrc.includes('"SINCRONIZACION_USA"'));
  ok("agente-transaccional reconoce intención de sincronizar americanas", agenteSrc.includes("carreras\\s+americanas?"));
  ok("agente-transaccional formatea mensaje con disponibilidad universal", agenteSrc.includes("Ya disponibles en Apuestas, Tablas, Marcas y Portal"));

  const asistenteSrc = readFileSync(join(raiz, "src", "features", "soporte", "lib", "asistenteIa.ts"), "utf8");
  ok("asistenteIa registra accion sincronizar_usa en catálogo", asistenteSrc.includes('"sincronizar_usa"'));
  ok("asistenteIa intercepta comandos de carreras americanas", asistenteSrc.includes("carreras\\s+americanas?"));

  // --------------------------------------------------------------------------
  // 5. COMPONENTES DE INTERFAZ DE USUARIO
  // --------------------------------------------------------------------------
  console.log("\n[5] COMPONENTES DE INTERFAZ DE USUARIO");

  const modalUsaSrc = readFileSync(join(raiz, "src", "features", "carreras", "components", "ModalSincronizadorUsa.tsx"), "utf8");
  ok("ModalSincronizadorUsa existe y tiene pestaña de sincronización automática", modalUsaSrc.includes("Sincronización Automática TVG / DRF"));
  ok("ModalSincronizadorUsa tiene pestaña de Pegar Rápido", modalUsaSrc.includes("Pegar Rápido desde TVG / DRF"));
  ok("ModalSincronizadorUsa tiene interruptor de auto-actualizar retirados cada 15 min", modalUsaSrc.includes("Auto-Actualizar Retirados (Scratches) cada 15 min"));
  ok("ModalSincronizadorUsa refleja disponibilidad en Apuestas, Tablas, Marcas, Pollas, Remates y Portal", 
    modalUsaSrc.includes("Apuestas") &&
    modalUsaSrc.includes("Tablas Fijas") &&
    modalUsaSrc.includes("Marcas / 5y6") &&
    modalUsaSrc.includes("Pollas & Remates") &&
    modalUsaSrc.includes("Portal Clientes") &&
    modalUsaSrc.includes("Proyecciones IA")
  );

  const carrerasDiaSrc = readFileSync(join(raiz, "src", "features", "carreras", "components", "CarrerasDiaModule.tsx"), "utf8");
  ok("CarrerasDiaModule tiene el botón 'Sincronizar USA Hoy (TVG / DRF)'", carrerasDiaSrc.includes("Sincronizar USA Hoy (TVG / DRF)"));
  ok("CarrerasDiaModule renderiza ModalSincronizadorUsa", carrerasDiaSrc.includes("<ModalSincronizadorUsa"));

  const hipodromosSrc = readFileSync(join(raiz, "src", "features", "hipodromos", "components", "HipodromosModule.tsx"), "utf8");
  ok("HipodromosModule tiene el botón 'Sincronizar USA Hoy (TVG / DRF)'", hipodromosSrc.includes("Sincronizar USA Hoy (TVG / DRF)"));
  ok("HipodromosModule renderiza ModalSincronizadorUsa", hipodromosSrc.includes("<ModalSincronizadorUsa"));

  // --------------------------------------------------------------------------
  // 6. IMPORTADOR MULTI-FUENTE (EQUIBASE, DRF, TVG) Y PROGRAMACIÓN DÍAS FUTUROS
  // --------------------------------------------------------------------------
  console.log("\n[6] IMPORTADOR MULTI-FUENTE (EQUIBASE, DRF, TVG) Y DÍAS FUTUROS");

  // Detección automática de fechas futuras
  ok("extraerFechaDeTexto detecta 'Saturday, October 31, 2026'", extraerFechaDeTexto("Gulfstream Park - Saturday, October 31, 2026") === "2026-10-31");
  ok("extraerFechaDeTexto detecta 'Friday, Nov 6, 2026'", extraerFechaDeTexto("Churchill Downs Entries for Friday, Nov 6, 2026") === "2026-11-06");
  ok("extraerFechaDeTexto detecta formato USA '11/07/2026'", extraerFechaDeTexto("Aqueduct - 11/07/2026") === "2026-11-07");
  ok("extraerFechaDeTexto detecta formato ISO '2026-11-15'", extraerFechaDeTexto("Santa Anita - 2026-11-15") === "2026-11-15");
  ok("extraerFechaDeTexto retorna null si no hay fecha", extraerFechaDeTexto("Texto sin ninguna fecha") === null);

  // Detección de hipódromos en el texto pegado
  ok("extraerHipodromoDeTexto reconoce Gulfstream Park", extraerHipodromoDeTexto("Gulfstream Park - Race 1") === "Gulfstream Park");
  ok("extraerHipodromoDeTexto reconoce Woodbine", extraerHipodromoDeTexto("Woodbine Entries for Friday") === "Woodbine");
  ok("extraerHipodromoDeTexto reconoce Penn National", extraerHipodromoDeTexto("Penn National - Saturday") === "Penn National");

  // Parser con cartelera Equibase y fecha futura
  const textoEquibaseFuturo = `
Gulfstream Park - Saturday, October 31, 2026
Race 1 - 1:05 PM
6 1/2 Furlongs Dirt
1 (1) Forte (KY) 122 I. Ortiz, Jr. Todd A. Pletcher 8-5
2 (2) Fierceness (FL) 124 J. Velazquez T. Pletcher 2-1
3 (3) Dornoch (SCRATCHED) 122 L. Saez Danny Gargan 15-1
`;

  const carrsEquibase = parsearTextoPegadoUsa(textoEquibaseFuturo, "Gulfstream Park");
  ok("Equibase futuro: extrajo 1 carrera", carrsEquibase.length === 1);
  const eqC1 = carrsEquibase[0];
  ok("Equibase futuro: fecha detectada es 2026-10-31 (día futuro)", eqC1.fecha === "2026-10-31");
  ok("Equibase futuro: distancia 6 1/2 Furlongs calculada a 1308m", eqC1.distancia === 1308);
  ok("Equibase futuro: 3 ejemplares parseados", eqC1.caballos.length === 3);

  const forte = eqC1.caballos.find((c) => c.numero === "1");
  ok("Forte parseado con nombre limpio", forte?.nombre === "FORTE");
  ok("Forte tiene PP 1 extraído de '(1)'", forte?.pp === 1);
  ok("Forte tiene ML normalizado a '8/5'", forte?.ml === "8/5");
  ok("Forte no retirado", forte?.retirado === false);

  const dornochEq = eqC1.caballos.find((c) => c.numero === "3");
  ok("Dornoch detectado como retirado", dornochEq?.retirado === true);
  ok("Retirados de C1 incluye el 3", eqC1.retirados.includes("3"));

  // Hipódromos americanos ampliados en catálogo
  ok("Catálogo contiene Woodbine (WO)", HIPODROMOS_USA_DISPONIBLES.some((h) => h.codigo === "WO" && h.nombre === "Woodbine"));
  ok("Catálogo contiene Horseshoe Indianapolis (IND)", HIPODROMOS_USA_DISPONIBLES.some((h) => h.codigo === "IND" && h.nombre === "Horseshoe Indianapolis"));
  ok("Catálogo contiene Penn National (PEN)", HIPODROMOS_USA_DISPONIBLES.some((h) => h.codigo === "PEN" && h.nombre === "Penn National"));
  ok("Catálogo contiene Los Alamitos (LRC)", HIPODROMOS_USA_DISPONIBLES.some((h) => h.codigo === "LRC" && h.nombre === "Los Alamitos"));
  ok("Catálogo contiene Delta Downs (DED)", HIPODROMOS_USA_DISPONIBLES.some((h) => h.codigo === "DED" && h.nombre === "Delta Downs"));

  // Modal UI para días futuros y multi-fuente
  ok("ModalSincronizadorUsa incluye selector de fecha rápida Mañana (+1d)", modalUsaSrc.includes("Mañana (+1d)"));
  ok("ModalSincronizadorUsa incluye selector de fecha rápida +2 Días", modalUsaSrc.includes("+2 Días"));
  ok("ModalSincronizadorUsa incluye selector de fecha rápida Sábado", modalUsaSrc.includes("Sábado"));
  ok("ModalSincronizadorUsa incluye selector de fecha rápida Domingo", modalUsaSrc.includes("Domingo"));
  ok("ModalSincronizadorUsa incluye banner de Programación para Jornada Futura", modalUsaSrc.includes("Programación para Jornada Futura"));
  ok("ModalSincronizadorUsa incluye opción de Equibase en selector de fuentes", modalUsaSrc.includes("Equibase (Entries & Fast Entries)"));
  ok("ModalSincronizadorUsa incluye opción de Multi-Fuente recomendada", modalUsaSrc.includes("Multi-Fuente: DRF + TVG + Equibase"));
  ok("ModalSincronizadorUsa incluye botón 'Todos los de la Jornada'", modalUsaSrc.includes("Todos los de la Jornada"));

  // --------------------------------------------------------------------------
  // RESUMEN FINAL
  // --------------------------------------------------------------------------
  console.log("\n=======================================================");
  console.log(`📊 RESULTADO DE LA SUITE: ${pasan} pasaron, ${fallan} fallaron.`);
  console.log("=======================================================\n");

  if (fallan > 0) {
    process.exit(1);
  }
}

void ejecutarPruebas();
