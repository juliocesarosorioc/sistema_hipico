// ============================================================================
// Pruebas del CRUD de cuadros de Tablas Fijas.
//
// Los cuadros viven en el array JSONB `caballos` de `tablas_fijas` y NO tienen
// columna propia. Eso hace que cualquier edicion reescriba el array entero, y
// que los dos bugs mas graves del modulo no se vean en un build verde:
//
//  1) El normalizador de lectura soltaba `ganador` y `ejemplar_id`, asi que
//     corregir el nombre de un ejemplar dejaba a TODOS los cuadros de la tabla
//     sin resultado cargado y sin vinculo al padron.
//  2) La suma se calculaba de dos formas distintas (una summing retirados y otra
//     no), y el pie "Suma" podia no cuadrar con lo que el propio operador
//     acababa de guardar.
//
// Aqui se prueban las dos funciones puras que sostienen eso: `sumaBase` y
// `normalizarFilas`. El resto (el modal y el cableado del Monitor) no tiene
// pruebas unitarias porque depende de React y de Supabase; lo cubre la E2E.
// ============================================================================
import { normalizarFilas } from "../src/lib/tablas/normalizar";
import { sumaBase, parseNum, type EjemplarTabla } from "../src/lib/tablas/tipos";

let pasan = 0;
let fallan = 0;

function eq(nombre: string, obtenido: unknown, esperado: unknown) {
  const a = JSON.stringify(obtenido);
  const b = JSON.stringify(esperado);
  if (a === b) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}\n         obtenido:  ${a}\n         esperado:  ${b}`);
  }
}

function ok(nombre: string, cond: boolean, detalle = "") {
  if (cond) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}${detalle ? "\n         " + detalle : ""}`);
  }
}

const cab = (numero: string, valor: number | string | null, extra: Partial<EjemplarTabla> = {}): EjemplarTabla => ({
  numero,
  nombre: `EJEMPLAR ${numero}`,
  nacionalidad: "VE",
  valor_ejemplar: valor as number | null,
  retirado: false,
  ...extra,
});

console.log("\n[A] normalizarFilas conserva TODOS los campos del cuadro");

const [fila] = normalizarFilas([
  {
    id: 7,
    hipodromo: "LA ENCARNACION",
    carrera: 3,
    fecha: "2026-03-14",
    estado: "Abierta",
    caballos: [
      { numero: "1", nombre: "PRIMERO", nacionalidad: "US", valor_ejemplar: 10, retirado: false, ganador: true, ejemplar_id: "aa-1" },
      { numero: "2", nombre: "SEGUNDO", nacionalidad: "VE", valor_ejemplar: 20, retirado: true, ganador: false, ejemplar_id: "aa-2" },
      { numero: "3", nombre: "TERCERO", nacionalidad: "VE", valor_ejemplar: "30", retirado: false, ganador: false, ejemplar_id: null },
    ],
  },
]);

eq("lee los tres cuadros", fila.caballos?.length, 3);
eq("numero como texto", fila.caballos?.[0].numero, "1");
eq("valor numerico desde string", fila.caballos?.[2].valor_ejemplar, 30);

// BUG 1: estos dos campos se perdian antes.
eq("ganador del primer cuadro se conserva", fila.caballos?.[0].ganador, true);
eq("ganador false explicito se conserva", fila.caballos?.[1].ganador, false);
eq("ejemplar_id se conserva", fila.caballos?.[0].ejemplar_id, "aa-1");
eq("ejemplar_id null se conserva", fila.caballos?.[2].ejemplar_id, null);
eq("retirado se conserva", fila.caballos?.[1].retirado, true);
eq("nacionalidad se conserva", fila.caballos?.[0].nacionalidad, "US");

console.log("\n[B] normalizarFilas no inventa ganador ni ejemplar_id ausentes");

const [vacia] = normalizarFilas([
  { id: 1, hipodromo: "H", carrera: 1, fecha: "2026-01-01", estado: "Abierta", caballos: [{ numero: "1", nombre: "X" }] },
]);
eq("ganador ausente queda false (no undefined)", vacia.caballos?.[0].ganador, false);
eq("ejemplar_id ausente queda null", vacia.caballos?.[0].ejemplar_id, null);
eq("valor ausente queda null", vacia.caballos?.[0].valor_ejemplar, null);

console.log("\n[C] normalizarFilas tolera filas sin caballos");

const [sinCab] = normalizarFilas([{ id: 1, hipodromo: "H", carrera: 1, fecha: "2026-01-01", estado: "Abierta", caballos: null }]);
eq("caballos null no rompe", sinCab.caballos, null);
const [sinCol] = normalizarFilas([{ id: 1, hipodromo: "H", carrera: 1, fecha: "2026-01-01", estado: "Abierta" }]);
eq("columna caballos inexistente no rompe", sinCol.caballos, null);
ok("sumaBase(null) da 0", sumaBase(null) === 0);
ok("sumaBase(undefined) da 0", sumaBase(undefined) === 0);

console.log("\n[D] sumaBase EXCLUYE los retirados");

eq("sin retirados suma todo", sumaBase([cab("1", 10), cab("2", 20), cab("3", 30)]), 60);
eq(
  "un retirado no suma",
  sumaBase([cab("1", 10), cab("2", 20, { retirado: true }), cab("3", 30)]),
  40
);
eq("todos retirados da 0", sumaBase([cab("1", 10, { retirado: true }), cab("2", 20, { retirado: true })]), 0);
eq("lista vacia da 0", sumaBase([]), 0);

console.log("\n[E] sumaBase lee el valor como texto (lo que viene del input)");

// El modal de edicion deja `valor_ejemplar` como el string que se escribio. Si
// sumaBase hiciera `a + c.valor_ejemplar` concatenaria en vez de sumar.
eq('"10" + "20" suma 30 y no "1020"', sumaBase([cab("1", "10"), cab("2", "20")]), 30);
eq('string con coma decimal', sumaBase([cab("1", "12,5")]), 12.5);
eq("valor null cuenta 0", sumaBase([cab("1", null), cab("2", 20)]), 20);
eq("valor no numerico cuenta 0", sumaBase([cab("1", "N/A"), cab("2", 20)]), 20);

console.log("\n[F] parseNum acepta coma y punto");

eq("coma decimal", parseNum("12,5"), 12.5);
eq("punto decimal", parseNum("12.5"), 12.5);
eq("entero", parseNum("40"), 40);
eq("vacio", parseNum(""), 0);
eq("basura", parseNum("abc"), 0);

console.log("\n[G] el pie Suma cuadra con lo que se guarda");

// Reproduce el flujo del CRUD de cuadros: se edita un valor, se recalcula y se
// guarda. Lo que se guarda tiene que ser exactamente lo que muestra el pie.
// 1=10, 2=20, 3=30 pero RETIRADO. El retirado no entra en la base: 30.
const antes = [cab("1", 10), cab("2", 20), cab("3", 30, { retirado: true })];
const despues: EjemplarTabla[] = antes.map((c, i) => (i === 1 ? { ...c, valor_ejemplar: 25 } : c));
eq("el pie antes de editar", sumaBase(antes), 30);
eq("el pie despues de editar", sumaBase(despues), 35);
ok("el retirado sigue fuera de la base", !despues.some((c) => c.retirado && sumaBase([c]) > 0));

console.log("\n[H] alta y baja de un cuadro recalculan la base");

const conAlta = [...antes, cab("4", 15)];
eq("base con el cuadro nuevo (30+15)", sumaBase(conAlta), 45);
const sinBaja = conAlta.filter((_, i) => i !== 3);
eq("base sin el cuadro quitado (vuelve a 30)", sumaBase(sinBaja), 30);
eq("volver a quitar es idempotente", sumaBase(sinBaja.filter((_, i) => i !== 3)), 30);

console.log(`\n${fallan === 0 ? "TODO OK" : "HAY FALLAS"}: ${pasan} ok, ${fallan} fallas\n`);
if (fallan > 0) process.exit(1);
