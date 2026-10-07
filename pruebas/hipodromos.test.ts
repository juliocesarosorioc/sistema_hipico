// ============================================================================
// Pruebas de la logica PURA del modulo Hipodromos (src/lib/hipodromos/tipos.ts).
//
// El CRUD de hipodromos no es cosmetico: antes, `listarHipodromos` filtraba por
// una lista FIJA de nombres (VE + USA) y el "borrado" era un DELETE fisico que
// reventaba por FK en cuanto el hipodromo tenia una carrera. Estas pruebas
// fijan el comportamiento que se cambio:
//
//   - Todo hipodromo registrado se ve si esta Activo, sin listas fijas.
//   - Suspender/Inactivo no lo borra: sale de los selectores pero conserva id e
//     historial (por eso la clave sigue siendo la misma fila).
//   - La baja logica es un estado (`eliminado_en`), no una fila desaparecida.
//   - Reactivar un archivado conserva su id: es lo que mantiene vivos los
//     tickets, las mesas y las liquidaciones de ese hipodromo.
// ============================================================================
import {
  esOperativo,
  estaBorrado,
  etiquetaEstado,
  ESTADOS_HIPODROMO,
  formatearNombre,
  levenshteinNorm,
  normalizarEstado,
  type Hipodromo,
} from "../src/lib/hipodromos/tipos";

let pasan = 0;
let fallan = 0;

function prueba(nombre: string, fn: () => void): void {
  try {
    fn();
    pasan++;
    console.log(`  ok  ${nombre}`);
  } catch (e) {
    fallan++;
    console.log(`  FALLA  ${nombre}`);
    console.log(`        ${e instanceof Error ? e.message : String(e)}`);
  }
}

function eq(real: unknown, esperado: unknown, msg: string): void {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  if (a !== b) throw new Error(`${msg}\n        esperado: ${b}\n        real:     ${a}`);
}

const hip = (extra: Partial<Hipodromo>): Hipodromo => ({
  id: 1,
  nombre: "LA RINCONADA",
  pais: "VE",
  estado: "Activo",
  fecha_creacion: "2026-01-01T00:00:00Z",
  eliminado_en: null,
  ...extra,
});

console.log("\n== Hipodromos: estados del catalogo ==");

// Los tres estados que el CRUD ofrece. Si alguien agrega uno nuevo sin decidir
// si es operable, el default "Activo" lo meteria en los selectores sin querer.
prueba("los tres estados del CRUD son Activo / Inactivo / Suspendido", () => {
  eq([...ESTADOS_HIPODROMO], ["Activo", "Inactivo", "Suspendido"], "catalogo de estados");
});

prueba("normalizarEstado acepta cualquier caja y tolera vacio/null", () => {
  eq(normalizarEstado("activo"), "Activo", "minuscula");
  eq(normalizarEstado("  ACTIVO "), "Activo", "con espacios");
  eq(normalizarEstado("Suspendido"), "Suspendido", "ya canonico");
  eq(normalizarEstado("inactivo"), "Inactivo", "minuscula");
  eq(normalizarEstado(""), "Activo", "vacio -> Activo");
  eq(normalizarEstado(null), "Activo", "null -> Activo");
  eq(normalizarEstado("inventado"), "Activo", "desconocido -> Activo");
});

console.log("\n== Hipodromos:Archivado es baja LOGICA, no fila borrada ==");

prueba("una fila vigente NO esta archivada", () => {
  eq(estaBorrado(hip({})), false, "vigente");
  eq(estaBorrado(hip({ eliminado_en: null })), false, "vigente con null explicito");
});

prueba("una fila con eliminado_en es archivada (pero la fila sigue existiendo)", () => {
  const archivado = hip({ eliminado_en: "2026-10-02T12:00:00Z" });
  eq(estaBorrado(archivado), true, "archivado");
  // El punto de todo el cambio: la fila no desaparece, conserva su id.
  eq(archivado.id, 1, "el id sigue vivo");
});

prueba("el estado es ortogonal al archivado (archivado + Activo sigue archivado)", () => {
  // Si alguien deja el estado en 'Activo' y solo marca eliminado_en, la fila NO
  // debe reaparecer en los selectores: el archivado manda.
  eq(estaBorrado(hip({ estado: "Activo", eliminado_en: "2026-10-02T12:00:00Z" })), true, "archivado manda sobre estado");
});

console.log("\n== Hipodromos: que se ofrece en los modulos de juego ==");

prueba("solo un Activo sin baja logica es operable", () => {
  eq(esOperativo(hip({})), true, "Activo vigente");
  eq(esOperativo(hip({ estado: "Inactivo" })), false, "Inactivo fuera");
  eq(esOperativo(hip({ estado: "Suspendido" })), false, "Suspendido fuera");
  eq(esOperativo(hip({ eliminado_en: "2026-10-02T12:00:00Z" })), false, "archivado fuera");
  eq(esOperativo(hip({ estado: "Suspendido", eliminado_en: "2026-10-02T12:00:00Z" })), false, "ambos fuera");
});

prueba("un hipodromo ausente no es operable (no revienta en los filtros)", () => {
  eq(esOperativo(null), false, "null");
  eq(esOperativo(undefined), false, "undefined");
});

prueba("la fila archivada conserva exactamente el MISMO id que la vigente", () => {
  // Este es el requisito de negocio: "si lo elimino y lo vuelvo a agregar, se
  // reactiva" y lo ya registrado con ese nombre sigue apuntando al mismo id.
  const vigente = hip({ id: 42 });
  const archivado = { ...vigente, eliminado_en: "2026-10-02T12:00:00Z", estado: "Inactivo" as const };
  const reactivado = { ...archivado, eliminado_en: null, estado: "Activo" as const };
  eq(reactivado.id, vigente.id, "el id no cambia al archivar ni al reactivar");
  eq(esOperativo(vigente), true, "vigente operable");
  eq(esOperativo(archivado), false, "archivado no operable");
  eq(esOperativo(reactivado), true, "reactivado vuelve a los selectores");
});

console.log("\n== Hipodromos: chip de estado ==");

prueba("cada estado muestra su texto y su color", () => {
  eq(etiquetaEstado(hip({})).texto, "Activo", "Activo");
  eq(etiquetaEstado(hip({ estado: "Inactivo" })).texto, "Inactivo", "Inactivo");
  eq(etiquetaEstado(hip({ estado: "Suspendido" })).texto, "Suspendido", "Suspendido");
  eq(etiquetaEstado(hip({ eliminado_en: "2026-10-02T12:00:00Z" })).texto, "Archivado", "Archivado");
});

prueba("el chip de archivado gana aunque el estado diga Activo", () => {
  eq(etiquetaEstado(hip({ estado: "Activo", eliminado_en: "2026-10-02T12:00:00Z" })).texto, "Archivado", "archivado manda");
});

console.log("\n== Hipodromos: normalizacion del nombre (anti duplicados) ==");

prueba("formatearNombre aplica el toTitleCase del legacy (con articulos en minuscula)", () => {
  // Paridad con el legacy: se capitaliza cada palabra y despues BAJAN los
  // articulos. "la rinconada" -> "la Rinconada", no "La Rinconada". Es feo, pero
  // cambiarlo aqui duplicaria el hipodromo con el nombre que ya esta en la base.
  eq(formatearNombre("la rinconada"), "la Rinconada", "minusculas");
  eq(formatearNombre("  SANTA   ANITA  "), "Santa Anita", "mayusculas y espacios de mas");
  eq(formatearNombre("valencia"), "Valencia", "palabra simple");
  eq(formatearNombre("la trinidad"), "la Trinidad", "articulo baja");
});

prueba("el nombre se guarda estable: formatear dos veces no lo mueve mas", () => {
  // El alta valida el nombre YA formateado y guarda ese mismo texto. Si
  // formatear no fuera idempotente, la segunda pasada daria otro string y la
  // reactivacion por nombre dejaria de encontrar la fila.
  const una = formatearNombre("la trinidad");
  eq(formatearNombre(una), una, "idempotente");
});

prueba("levenshteinNorm separa el duplicado real del hipodromo distinto", () => {
  // El formulario bloquea similitud < 0.15 para no crear dos hipodromos que el
  // operador escribio igual.
  eq(levenshteinNorm("La Rinconada", "la rinconada"), 0, "identico ignorando caja/espacios");
  eq(levenshteinNorm("La Rinconada", "La Rinconadda"), 1 / 12, "una letra de diferencia");
  // Y un nombre de verdad distinto tiene que pasar el filtro.
  if (!(levenshteinNorm("La Rinconada", "Santa Anita") >= 0.15)) throw new Error("Santa Anita no debe.blockearse por similitud");
  if (!(levenshteinNorm("La Rinconada", "La Rinconada") < 0.15)) throw new Error("el mismo nombre debe bloquearse");
});

console.log(`\nHipodromos: ${pasan} pasaron, ${fallan} fallaron\n`);
if (fallan > 0) process.exit(1);
