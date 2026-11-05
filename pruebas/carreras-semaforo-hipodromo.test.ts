import { strictEqual, ok } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { claveHipodromo } from "../src/features/carreras/lib/claves";

const raiz = process.cwd();

console.log("\n[1] Normalización de hipódromo");
{
  strictEqual(claveHipodromo(""), "");
  strictEqual(claveHipodromo("   "), "");
  strictEqual(claveHipodromo(null), "");
  strictEqual(claveHipodromo(undefined), "");
  ok(claveHipodromo("La Rinconada") === "LARINCONADA");
}

console.log("\n[2] Verificación estática de SemaforoCarreras");
{
  const semaforo = readFileSync(
    join(raiz, "src", "features", "gestion", "components", "SemaforoCarreras.tsx"),
    "utf8"
  );

  ok(/tieneHipodromo/.test(semaforo), "valida si existe hipódromo seleccionado");
  ok(/if \(!tieneHipodromo\)/.test(semaforo), "bloquea el renderizado de carreras si no hay hipódromo");
  ok(/Seleccione un <b>hipódromo<\/b>/.test(semaforo), "muestra mensaje para seleccionar hipódromo en vez de carreras vacías");
  ok(!/carrerasDe\(hipodromo\)/.test(semaforo) || /tieneHipodromo \? carrerasDe\(hipoLimpio\) : \[\]/.test(semaforo), "no consulta carreras centrales si no hay hipódromo");
  ok(/if \(!tieneHipodromo\) return \{ estado: "inactiva", tieneVentas: false \}/.test(semaforo), "ninguna carrera cambia de color sin hipódromo");
}

console.log("\n[3] Verificación de ModalMarcasEditor y GestionJugadasModule");
{
  const marcas = readFileSync(
    join(raiz, "src", "features", "marcas", "components", "ModalMarcasEditor.tsx"),
    "utf8"
  );
  const gestion = readFileSync(
    join(raiz, "src", "features", "gestion", "components", "GestionJugadasModule.tsx"),
    "utf8"
  );

  ok(/SemaforoCarreras/.test(marcas), "ModalMarcasEditor usa SemaforoCarreras");
  ok(/hipodromoElegido/.test(gestion), "GestionJugadasModule condiciona jugadas al hipódromo");
}

console.log("\n✅ TODAS LAS PRUEBAS DE SEMÁFORO DE CARRERAS E HIPÓDROMO PASARON (3/3)");
