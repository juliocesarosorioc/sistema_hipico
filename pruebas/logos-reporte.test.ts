// ============================================================================
// LOGOS DE HIPÓDROMOS Y GRUPOS + REPORTE DE LIQUIDACIÓN.
//
// Protege las piezas sin navegador:
//   · validación/nombre del archivo del logo (núcleo puro `shared/lib/logos`);
//   · `armarReporteCarrera` respeta `liquidada` y viaja con los logos;
//   · el reporte oculta pizarra / resultado / resumen cuando NO está liquidada
//     y muestra la columna «Jugada» (nunca «Jugó»);
//   · la cabecera azul, los badges cuadrados y el gestor de logo están
//     cableados en los componentes reales (leídos del fuente).
//   · la migración SQL agrega `logo_url` a hipódromos y grupos_venta.
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nombreArchivoLogo, validarArchivoLogo, LOGO_MAX_BYTES } from "../src/shared/lib/logos";
import { armarReporteCarrera } from "../src/features/liquidacion/lib/reporte-carrera";
import { logoDeHipodromo, logoDeGrupo } from "../src/features/liquidacion/lib/logos-reporte";
import type { CarreraReporte } from "../src/features/liquidacion/lib/reportes";

let pasan = 0;
let fallan = 0;
const ok = (m: string) => {
  pasan++;
  console.log(`  ok   ${m}`);
};
const mal = (m: string, d?: string) => {
  fallan++;
  console.log(`  FALLA ${m}${d ? `\n         ${d}` : ""}`);
};
const si = (c: boolean, m: string, d?: string) => (c ? ok(m) : mal(m, d));
const igual = (a: unknown, b: unknown, m: string) =>
  si(
    JSON.stringify(a) === JSON.stringify(b),
    m,
    `esperado ${JSON.stringify(b)} · recibido ${JSON.stringify(a)}`
  );

console.log("\nLOGOS — validación y nombre de archivo (núcleo puro)");

si(validarArchivoLogo(null) !== null, "sin archivo devuelve error");
si(validarArchivoLogo({ type: "image/gif", size: 1000 }) !== null, "GIF no está soportado");
si(
  validarArchivoLogo({ type: "image/png", size: LOGO_MAX_BYTES + 1 }) !== null,
  "un PNG de más de 4 MB se rechaza"
);
igual(validarArchivoLogo({ type: "image/png", size: 1200 }), null, "PNG válido");
igual(validarArchivoLogo({ type: "image/webp", size: 1200 }), null, "WEBP válido");
igual(validarArchivoLogo({ type: "image/jpeg", size: 1200 }), null, "JPG válido");
igual(nombreArchivoLogo("Hipódromo La Rinconada"), "hipodromo_la_rinconada_logo.png", "nombre de archivo sin acentos");
igual(nombreArchivoLogo(""), "logo_logo.png", "nombre vacío cae a 'logo'");

console.log("\nREPORTE — liquidada y logos (armarReporteCarrera)");

const carrera: CarreraReporte = {
  numero: 4,
  hipodromo: "SANTA ANITA",
  fecha: "2026-10-12",
  pizarra: "5 · 3 · 8",
  subtotal: 0,
  filas: [
    {
      id: "x-j-1",
      rol: "Juega",
      cliente: "ANA",
      jugada: "TABLA 2",
      caballo: "5",
      monto: 10,
      resultado: null,
    },
    {
      id: "x-c-1",
      rol: "Consigue",
      cliente: "LUIS",
      jugada: "TABLA 2",
      caballo: "5",
      monto: 10,
      resultado: null,
    },
  ],
};

const porDefecto = armarReporteCarrera(carrera, "GRUPO X", undefined, {
  logoHipodromo: "data:image/png;base64,AAA",
  logoGrupo: "data:image/png;base64,BBB",
});
igual(porDefecto.liquidada, true, "por defecto la carrera se considera liquidada (compatibilidad)");
igual(porDefecto.encabezado.logoHipodromo, "data:image/png;base64,AAA", "logo del hipódromo viaja al encabezado");
igual(porDefecto.encabezado.logoGrupo, "data:image/png;base64,BBB", "logo del grupo viaja al encabezado");

const sinLiquidar = armarReporteCarrera(carrera, "GRUPO X", undefined, { liquidada: false });
igual(sinLiquidar.liquidada, false, "liquidada:false se respeta");
igual(sinLiquidar.encabezado.logoHipodromo, null, "sin logo del hipódromo queda null");
igual(sinLiquidar.jugadasVivo.length, 1, "las jugadas se siguen armando sin liquidar");
igual(sinLiquidar.jugadasVivo[0].jugo, "TABLA 2", "la jugada en vivo se conserva");

// ---------------------------------------------------------------------------
// Cableado de la capa de presentación y de la base (fuente)
// ---------------------------------------------------------------------------
const raiz = process.cwd();
const leer = (...partes: string[]) => readFileSync(join(raiz, ...partes), "utf8");

const reporte = leer("src", "features", "saldos", "components", "ReporteCarrera.tsx");
si(reporte.includes(">Jugada<"), "la columna se llama «Jugada»");
si(!/Jug[oó]<\/th>/.test(reporte), "no queda el encabezado viejo «Jugó»");
si(/bg-gradient-to-r from-blue-900 via-blue-700 to-blue-600/.test(reporte), "cabecera azul ejecutiva");
si(/w-14 h-14/.test(reporte) && /rounded-xl/.test(reporte), "contenedor de logo 56×56 con esquinas curveadas");
si(/crossOrigin="anonymous"/.test(reporte), "los logos usan crossOrigin para html2canvas");
si(/w-9 h-9 rounded-lg/.test(reporte), "los discos de llegada son cuadrados con esquinas curveadas");
si(!/rounded-full/.test(reporte), "no quedan discos redondos en el reporte");
si(/mostrarResultado/.test(reporte) && /liquidada \?/.test(reporte), "pizarra/resultado se condicionan a liquidada");
si(/const liquidada = datos\.liquidada !== false/.test(reporte), "el reporte respeta el flag liquidada");

const modal = leer("src", "features", "gestion", "components", "ReporteLiquidacionModal.tsx");
si(/liquidada/.test(modal) && /armarReporteCarrera\([^)]*liquidada/.test(modal), "el modal calcula y pasa liquidada");
si(/logoHipodromo/.test(modal) && /logoGrupo/.test(modal), "el modal pasa los dos logos");
si(/listarHipodromos/.test(modal), "el modal lee el catálogo de hipódromos para el logo");

const chips = leer("src", "shared", "components", "ui", "HorseChips.tsx");
si(/rounded-md/.test(chips) && /rounded-lg/.test(chips), "los chips de ejemplar son cuadrados curveados");
si(!/rounded-full/.test(chips), "no quedan chips redondos");

const uploader = leer("src", "shared", "components", "ui", "LogoUploader.tsx");
si(/canvas\.toDataURL\("image\/png"\)/.test(uploader), "el uploader redimensiona y exporta PNG con canvas");
si(/onDrop/.test(uploader) && /dataTransfer/.test(uploader), "el uploader acepta arrastrar y soltar");
si(/onChange\(null\)/.test(uploader), "el uploader permite quitar el logo");

const hipoModulo = leer("src", "features", "hipodromos", "components", "HipodromosModule.tsx");
si(/LogoUploader/.test(hipoModulo) && /logo_url/.test(hipoModulo), "Hipódromos integra el gestor de logo");

const gruposModulo = leer("src", "features", "grupos", "components", "GruposModule.tsx");
si(/LogoUploader/.test(gruposModulo) && /logo_url/.test(gruposModulo), "Grupos (edición) integra el gestor de logo");

const creacion = leer("src", "features", "grupos", "components", "CreacionGruposModule.tsx");
si(/LogoUploader/.test(creacion) && /logo_url/.test(creacion), "Creación de grupos integra el gestor de logo");

const servicio = leer("src", "features", "hipodromos", "lib", "servicio.ts");
si(/logo_url/.test(servicio), "el servicio de hipódromos lee/escribe logo_url");
const tipos = leer("src", "features", "hipodromos", "lib", "tipos.ts");
si(/logo_url/.test(tipos), "el tipo Hipodromo expone logo_url");
const gruposLib = leer("src", "features", "grupos", "lib", "grupos.ts");
si(/logo_url/.test(gruposLib), "GrupoRow y las RPC de grupos contemplan logo_url");

const sql = leer("sql", "logos_hipodromos_grupos.sql");
si(/alter table public\.hipodromos[\s\S]*logo_url/.test(sql), "SQL: hipodromos.logo_url");
si(/alter table public\.grupos_venta[\s\S]*logo_url/.test(sql), "SQL: grupos_venta.logo_url");
si(/club_actualizar_grupo/.test(sql) && /p_datos \? 'logo_url'/.test(sql), "SQL: la RPC de edición guarda logo_url");

// ---------------------------------------------------------------------------
// LOGO SIEMPRE FRESCO: resolución en el momento de armar el reporte
// ---------------------------------------------------------------------------
// El logo se resolvía desde catálogos cargados una sola vez al montar la
// pantalla: si el operador incorporaba el logo después, el reporte seguía
// mostrando el viejo (o ninguno) hasta recargar la página. Estas pruebas
// protegen el núcleo puro y el cableado de los TRES puntos que arman el
// reporte, para que el logo viaje fresco sin importar cuándo se cargó.
console.log("\nLOGOS FRESCOS — transporte y cableado de los reportes");

si(logoDeHipodromo([{ nombre: "SANTA ANITA", logo_url: "AAA" }], "santa anita") === "AAA", "logoDeHipodromo ignora mayúsculas/espacios");
si(logoDeHipodromo([{ nombre: "OTRO", logo_url: "AAA" }], "SANTA ANITA") === null, "logoDeHipodromo sin match → null");
si(logoDeHipodromo([{ nombre: "SANTA ANITA", logo_url: null }], "SANTA ANITA") === null, "hipódromo sin logo → null");
si(logoDeHipodromo([], "") === null, "lista vacía / nombre vacío → null");

const gruposLogo = [
  { id: 1, nombre: "PRINCIPAL", es_principal: true, logo_url: "PRIN" },
  { id: 2, nombre: "CLIENTE", es_principal: false, logo_url: "CLI" },
];
si(logoDeGrupo(gruposLogo, 2) === "CLI", "logoDeGrupo resuelve por id");
si(logoDeGrupo(gruposLogo, null) === "PRIN", "sin id cae al grupo principal");
si(logoDeGrupo(gruposLogo, 99) === null, "id inexistente → null");
si(logoDeGrupo([], 1) === null, "sin grupos → null");

// El helper `logosFrescosDeCarrera` lee la base en el momento (fuerza el salto
// del caché de grupos) y nunca lanza.
const logosLib = leer("src", "features", "liquidacion", "lib", "logos-reporte.ts");
si(/export async function logosFrescosDeCarrera/.test(logosLib), "existe logosFrescosDeCarrera");
si(/listarHipodromos\(\)/.test(logosLib), "lee el catálogo de hipódromos fresco");
si(/listarGruposAdmin\(true\)/.test(logosLib), "fuerza el salto del caché de grupos");

// Los tres puntos que arman el reporte usan el helper y pasan los logos.
const modal2 = leer("src", "features", "gestion", "components", "ReporteLiquidacionModal.tsx");
si(/logosFrescosDeCarrera/.test(modal2), "ReporteLiquidacionModal resuelve logos frescos");
si(/\[abierto(, versionLogos)?\]/.test(modal2), "ReporteLiquidacionModal relee catálogos al abrir (y al actualizar un logo)");
si(/useVersionLogos\(\)/.test(modal2), "ReporteLiquidacionModal reacciona al evento global de logos");

const pagar = leer("src", "features", "taquilla", "components", "PagarCarreraModal.tsx");
si(/logosFrescosDeCarrera/.test(pagar), "PagarCarreraModal resuelve logos frescos");
si(/logoHipodromo: frescos\.logoHipodromo/.test(pagar), "PagarCarreraModal pasa el logo del hipódromo");

const selector = leer("src", "features", "saldos", "components", "SelectorReporteCarrera.tsx");
si(/logosFrescosDeCarrera/.test(selector), "SelectorReporteCarrera resuelve logos frescos");
si(/logoGrupo: frescos\.logoGrupo/.test(selector), "SelectorReporteCarrera pasa el logo del grupo");

// ---------------------------------------------------------------------------
// EL LOGO NO SE PIERDE EN SILENCIO: verificación de lectura de vuelta
// ---------------------------------------------------------------------------
// Bug real reportado: el operador subía el logo del hipódromo o del grupo, la
// pantalla decía "actualizado" y al reabrir NO había logo. Tres causas:
//   (a) `actualizarGrupo` caía a la RPC `club_actualizar_grupo`, que en su
//       versión VIEJA ignoraba `logo_url` en silencio;
//   (b) la Edge Function `crear-grupo` NO incluía `logo_url` en el alta;
//   (c) `actualizarHipodromo` reintentaba SIN el logo y devolvía `ok: true`
//       (falso éxito).
// Ahora los tres caminos leen de vuelta y devuelven un error CLARO si el logo
// no quedó, en vez de un falso "guardado".
console.log("\nLOGOS PERSISTENTES — verificación y alta (grupo, hipódromo y edge)");

// (a) El servicio de grupos verifica el logo tras guardar.
si(
  /select\("logo_url"\)[\s\S]*El logo no quedó guardado/.test(gruposLib),
  "actualizarGrupo lee de vuelta logo_url y falla claro si no quedó"
);
si(
  /la tabla no tiene la columna logo_url[\s\S]*logos_hipodromos_grupos\.sql/.test(gruposLib),
  "actualizarGrupo avisa si falta la columna logo_url"
);

// (b) La Edge Function de alta de grupo propaga logo_url (antes lo omitía y el
//     logo del grupo nunca llegaba a la base en el alta desde el asistente).
const edgeGrupo = leer("supabase", "functions", "crear-grupo", "index.ts");
si(/logo_url\?:\s*string\s*\|\s*null/.test(edgeGrupo), "la edge function tipa logo_url en el cuerpo");
si(/cuerpo\.grupo\?\.logo_url/.test(edgeGrupo), "la edge function lee logo_url del cuerpo");
si(/filaGrupo\.logo_url\s*=\s*logoUrl/.test(edgeGrupo), "la edge function copia logo_url a la fila del grupo");

// (c) El servicio de hipódromos NO canta éxito cuando falta la columna: antes
//     reintentaba sin logo y devolvía ok:true (el logo se perdía en silencio).
si(
  /El resto de la ficha sí se guardó/.test(servicio),
  "actualizarHipodromo avisa que el logo no se guardó (sin falso éxito)"
);
si(
  /select\("logo_url"\)[\s\S]*El logo no quedó guardado/.test(servicio),
  "actualizarHipodromo lee de vuelta logo_url y falla claro si no quedó"
);
si(
  /la tabla hipodromos no tiene la columna logo_url/.test(servicio),
  "actualizarHipodromo avisa si falta la columna logo_url"
);

console.log(`\n${pasan} ok / ${fallan} fallaron`);
if (fallan > 0) process.exit(1);
