// ============================================================================
// «Corregir tablas fijas»: Enter baja al siguiente valor + casillas de retiros.
//
// El dueño pidió que, con el foco en el VALOR de un ejemplar, Enter baje al
// valor de la fila siguiente (y al del alta al llegar al final), y que la grilla
// quede alineada. La edición de ejemplares vive en `EditorCaballos`, que usan el
// modal «✏️ Corregir» del Monitor (tabla publicada) y el Ensamblaje (borrador).
//
// Sin navegador se blinda el cableado del componente (leído del fuente, como
// otras pruebas de UX).
//
// Corre con:  node pruebas/correr.cjs
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";

let pasan = 0;
let fallan = 0;
const ok = (m: string, c: boolean) => {
  if (c) {
    pasan++;
    console.log(`  ok   ${m}`);
  } else {
    fallan++;
    console.log(`  FALLA ${m}`);
  }
};

const src = readFileSync(
  join(process.cwd(), "src", "features", "tablas", "components", "EditorCaballos.tsx"),
  "utf8"
);

console.log("\n[1] Enter en Valor baja al siguiente valor");
ok("el valor de cada fila lleva `data-valor-fila={i}`", /data-valor-fila=\{i\}/.test(src));
ok(
  "Enter llama a `bajarSiguienteValor(i)`",
  /e\.key === "Enter"[\s\S]{0,80}bajarSiguienteValor\(i\)/.test(src)
);
ok(
  "busca el valor de la fila siguiente",
  /input\[data-valor-fila="\$\{indiceActual \+ 1\}"\]/.test(src)
);
ok(
  "en la última fila cae al valor del alta",
  /input\[data-valor-fila="nuevo"\]/.test(src)
);
ok("el input de valor es un `ref` de grilla", /useRef<HTMLDivElement>\(null\)/.test(src));

console.log("\n[2] Grilla alineada (encabezados y retiros)");
ok("una sola constante de columnas `COLS` para todas las filas", /const COLS = "grid grid-cols-\[/.test(src));
ok("el encabezado «Valor» va a la derecha (como el input)", /text-right text-\[9px\] font-black[^>]*>Valor</.test(src));
ok("el encabezado «Ret.» va centrado (como la casilla)", /text-center text-\[9px\] font-black[^>]*>\s*Ret\./.test(src));
ok(
  "la fila retirada se resalta y el nombre se tacha",
  /retirado \? "bg-red-50\/70"/.test(src) && /retirado \? "text-slate-400 line-through"/.test(src)
);
ok("la casilla de retirado tiene etiqueta accesible", /aria-label="Retirado"/.test(src));

console.log(`\n${pasan} pasaron, ${fallan} fallaron`);
process.exit(fallan > 0 ? 1 : 0);
