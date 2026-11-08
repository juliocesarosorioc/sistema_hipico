// ============================================================================
// SEMÁFORO DE CARRERAS — certificación de la derivación a partir de la DATA.
//
// La máquina de estados (4 colores + transiciones) está certificada en
// `semaforo-estados-estrictos.test.ts`. Aquí se certifica la capa que traduce
// la data técnica de una carrera (central/tablas/ledger) a los tres booleanos
// de esa máquina, con dos garantías:
//
//   1. ROJO solo significa LIQUIDADA. Tener ganadores ("Resultados") no es
//      rojo: mientras no se aplique a tablas sigue AMARILLO/VERDE.
//   2. El color NO depende de la carrera seleccionada. La derivación no recibe
//      la carrera activa y es determinista para el mismo estado de datos.
// ============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  estadoSemaforoCarrera,
  esPlaceholderManual,
  type EntradaEstadoSemaforo,
} from "../src/features/gestion/lib/semaforo-estado";

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
    console.log(`  FALLA ${nombre}\n        obtenido:  ${a}\n        esperado:  ${b}`);
  }
}

function ok(nombre: string, condicion: boolean) {
  if (condicion) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}`);
  }
}

/** Entrada base: carrera 3 registrada con ejemplares y sin jugadas. */
function entrada(over: Partial<EntradaEstadoSemaforo> = {}): EntradaEstadoSemaforo {
  return {
    carrera: 3,
    central: { estado: "Programada", aplicado_a_tablas: false, ganadores: [], caballos: [{}, {}] },
    tabla: null,
    registro: null,
    tieneJugadas: false,
    tieneCaballos: true,
    ...over,
  };
}

/** Helper: evalúa el color con la entrada base + cambios. */
function color(over: Partial<EntradaEstadoSemaforo> = {}) {
  return estadoSemaforoCarrera(entrada(over));
}

console.log("\n[1] Los 4 colores oficiales");
// ---------------------------------------------------------------------------
eq("GRIS: sin jugadas y sin caballos", color({ central: null, tieneCaballos: false }), "inactiva");
eq(
  "GRIS: placeholder manual vacío (aunque exista la fila) no es VERDE",
  color({
    central: { estado: "Programada", origen: "manual", caballos: [], hora: null, distancia: null },
    tieneCaballos: false,
  }),
  "inactiva"
);
ok(
  "el placeholder manual vacío se reconoce explícitamente",
  esPlaceholderManual({ origen: "manual", caballos: [], hora: null, distancia: null })
);
eq("VERDE: tiene caballos y no tiene jugadas", color(), "abierta");
eq("VERDE: caballos precargados, aunque el central no tenga fila", color({ central: null }), "abierta");
eq("AMARILLO: tiene jugadas y no está liquidada", color({ tieneJugadas: true }), "con_jugadas");
eq(
  "AMARILLO: jugadas incluso sin caballos (modo manual)",
  color({ tieneJugadas: true, tieneCaballos: false, central: null }),
  "con_jugadas"
);
eq(
  "ROJO: liquidada (aplicada a tablas) aunque tenga jugadas",
  color({ tieneJugadas: true, central: { estado: "Liquidada", aplicado_a_tablas: true } }),
  "cerrada"
);
eq(
  "ROJO: liquidada sin jugadas también es ROJO",
  color({ tieneJugadas: false, central: { estado: "Liquidada", aplicado_a_tablas: true } }),
  "cerrada"
);

console.log("\n[2] ROJO significa LIQUIDADA, no 'tiene resultados'");
// ---------------------------------------------------------------------------
eq(
  "con ganadores pero SIN aplicar a tablas sigue AMARILLO",
  color({
    tieneJugadas: true,
    central: { estado: "Resultados", aplicado_a_tablas: false, ganadores: ["1", "4", "7"] },
  }),
  "con_jugadas"
);
eq(
  "con ganadores, sin aplicar y sin jugadas sigue VERDE (nunca rojo)",
  color({
    tieneJugadas: false,
    central: { estado: "Resultados", aplicado_a_tablas: false, ganadores: ["1", "4", "7"] },
  }),
  "abierta"
);
eq(
  "una copia local cerrada NO pinta rojo si el central dice 'Resultados'",
  color({
    central: { estado: "Resultados", aplicado_a_tablas: false, ganadores: ["1"] },
    tabla: { cerrada: true, estado: "cerrada" },
    registro: { estado: "Liquidada" },
    tieneJugadas: true,
  }),
  "con_jugadas"
);
eq(
  "aplicado_a_tablas manda aunque el estado textual diga Programada",
  color({ central: { estado: "Programada", aplicado_a_tablas: true } }),
  "cerrada"
);
eq(
  "estado central 'Liquidada' sin la bandera también pinta ROJO",
  color({ central: { estado: "Liquidada", aplicado_a_tablas: false } }),
  "cerrada"
);
eq(
  "estado central 'Cerrada' (apuestas cerradas) NO es liquidada: sigue AMARILLO",
  color({ tieneJugadas: true, central: { estado: "Cerrada", aplicado_a_tablas: false } }),
  "con_jugadas"
);

console.log("\n[3] ROJO persistente: seleccionar/deseleccionar no lo cambia");
// ---------------------------------------------------------------------------
const liquidadaConJugadas = entrada({
  tieneJugadas: true,
  central: { estado: "Liquidada", aplicado_a_tablas: true, ganadores: ["1", "2"], caballos: [{}, {}] },
});
eq("liquidada + jugadas = ROJO", estadoSemaforoCarrera(liquidadaConJugadas), "cerrada");
eq(
  "el mismo estado evaluado dos veces da el mismo color",
  estadoSemaforoCarrera(liquidadaConJugadas),
  estadoSemaforoCarrera(liquidadaConJugadas)
);
eq(
  "una copia local vieja NO le quita el ROJO a una liquidada",
  color({
    tieneJugadas: true,
    central: { estado: "Liquidada", aplicado_a_tablas: true },
    tabla: { cerrada: false, estado: "abierta" },
    registro: { estado: "Programada" },
  }),
  "cerrada"
);
eq(
  "quitar/poner jugadas no cambia el ROJO de una liquidada",
  color({ tieneJugadas: false, central: { estado: "Liquidada", aplicado_a_tablas: true } }),
  "cerrada"
);

console.log("\n[4] Transiciones certificadas");
// ---------------------------------------------------------------------------
{
  // GRIS → VERDE: se registra la carrera / se precargan ejemplares.
  eq(
    "GRIS antes de precargar",
    color({ central: null, tieneCaballos: false, tieneJugadas: false }),
    "inactiva"
  );
  eq(
    "GRIS → VERDE al precargar ejemplares",
    color({
      central: { estado: "Programada", aplicado_a_tablas: false, caballos: [{ numero: "1" }] },
      tieneCaballos: true,
    }),
    "abierta"
  );

  // VERDE → AMARILLO: aparece la primera jugada.
  eq("VERDE antes de la jugada", color({ tieneJugadas: false }), "abierta");
  eq("VERDE → AMARILLO con jugadas", color({ tieneJugadas: true }), "con_jugadas");

  // AMARILLO → ROJO: se liquida y se aplica a tablas.
  eq("AMARILLO antes de liquidar", color({ tieneJugadas: true }), "con_jugadas");
  eq(
    "AMARILLO → ROJO al liquidar",
    color({ tieneJugadas: true, central: { estado: "Liquidada", aplicado_a_tablas: true } }),
    "cerrada"
  );

  // ROJO → AMARILLO: SOLO por reversión de la liquidación.
  eq(
    "ROJO → AMARILLO al reversar (central vuelve a Programada)",
    color({
      tieneJugadas: true,
      central: { estado: "Programada", aplicado_a_tablas: false, ganadores: [] },
      // copias locales viejas que NO deben mantener el rojo
      tabla: { cerrada: true, estado: "cerrada" },
      registro: { estado: "Liquidada" },
    }),
    "con_jugadas"
  );

  // AMARILLO → VERDE: se anulan/borran TODAS las jugadas.
  eq("AMARILLO antes de anular la última jugada", color({ tieneJugadas: true }), "con_jugadas");
  eq("AMARILLO → VERDE al borrar todas las jugadas", color({ tieneJugadas: false }), "abierta");

  // VERDE → GRIS: se elimina la carrera / todos sus ejemplares.
  eq("VERDE antes de eliminar la carrera", color(), "abierta");
  eq(
    "VERDE → GRIS al eliminar los ejemplares",
    color({ central: null, tieneCaballos: false, tieneJugadas: false }),
    "inactiva"
  );
}

console.log("\n[5] Reversión: las copias locales viejas no reviven el ROJO");
// ---------------------------------------------------------------------------
eq(
  "central reabierto + tabla.cerrada vieja + sin jugadas = VERDE",
  color({
    central: { estado: "Programada", aplicado_a_tablas: false, ganadores: [] },
    tabla: { cerrada: true, estado: "cerrada" },
    registro: { estado: "Liquidada" },
    tieneJugadas: false,
  }),
  "abierta"
);
eq(
  "respaldo local cuando el central no conoce la carrera: tabla cerrada = ROJO",
  color({ central: null, tabla: { cerrada: true } }),
  "cerrada"
);
eq(
  "respaldo local cuando el central no conoce la carrera: ledger Liquidada = ROJO",
  color({ central: null, registro: { estado: "Liquidada" } }),
  "cerrada"
);
eq(
  "respaldo de la lista del padre cuando el central no conoce la carrera",
  color({ central: null, carrerasLiquidadas: [3] }),
  "cerrada"
);
eq(
  "respaldo de BD (aplicado_a_tablas) cuando el central no conoce la carrera",
  color({ central: null, carrerasBdLiquidadas: [3] }),
  "cerrada"
);
eq(
  "una reversión explícita de la sesión manda sobre listas y copias viejas",
  color({
    tieneJugadas: true,
    central: { estado: "Liquidada", aplicado_a_tablas: true },
    tabla: { cerrada: true, estado: "cerrada" },
    registro: { estado: "Liquidada" },
    carrerasLiquidadas: [3],
    carrerasBdLiquidadas: [3],
    carrerasReversadas: [3],
  }),
  "con_jugadas"
);
eq(
  "reversión sin jugadas y con caballos = VERDE (no ROJO)",
  color({ tieneJugadas: false, carrerasLiquidadas: [3], carrerasReversadas: [3] }),
  "abierta"
);
eq(
  "al re-liquidar (ya sin reversión) la carrera vuelve a ROJO",
  color({
    tieneJugadas: true,
    central: { estado: "Liquidada", aplicado_a_tablas: true },
    carrerasReversadas: [],
  }),
  "cerrada"
);

console.log("\n[6] El color NO depende de la selección (verificación estática)");
// ---------------------------------------------------------------------------
{
  const raiz = process.cwd();
  const puro = readFileSync(
    join(raiz, "src", "features", "gestion", "lib", "semaforo-estado.ts"),
    "utf8"
  );
  const semaforo = readFileSync(
    join(raiz, "src", "features", "gestion", "components", "SemaforoCarreras.tsx"),
    "utf8"
  );
  const gestion = readFileSync(
    join(raiz, "src", "features", "gestion", "components", "GestionJugadasModule.tsx"),
    "utf8"
  );

  ok(
    "la derivación pura no recibe la carrera activa/seleccionada",
    !/\bactiva\b|\bseleccionad/i.test(
      puro.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
    )
  );

  const llamada = semaforo.match(/estadoSemaforoCarrera\(\{([\s\S]*?)\}\)/);
  ok("SemaforoCarreras usa la derivación pura", llamada != null);
  ok("la llamada a la derivación no incluye `activa`", llamada != null && !/\bactiva\b/.test(llamada[1]));
  ok(
    "el cálculo de jugadas no tiene ramas por carrera activa",
    (() => {
      const bloque = semaforo.match(/const porCarrera = ([\s\S]*?)\n  \};/);
      if (!bloque) return false;
      const limpio = bloque[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      return !/\bactiva\b/.test(limpio);
    })()
  );
  ok(
    "SemaforoCarreras solo usa `activa` para el anillo de resaltado",
    /activaEsta \? "ring-2 ring-indigo-600/.test(semaforo)
  );

  const propJugadas = gestion.match(/carrerasConJugadas=\{([^}]*)\}/);
  ok("Gestión pasa las jugadas sin inyectar la carrera activa", propJugadas != null);
  ok(
    "la prop carrerasConJugadas no usa filasPreview",
    propJugadas != null && !/filasPreview/.test(propJugadas[1])
  );
  ok(
    "Gestión pasa las carreras reversadas al semáforo",
    /carrerasReversadas=\{\[\.\.\.carrerasReversadas\]\}/.test(gestion)
  );

  const bloqueSeleccion = gestion.match(/setCarrera\(n\);\s*setCarreraConfirmada\(true\);([\s\S]{0,500})/);
  ok(
    "seleccionar una carrera NO la agrega al catálogo (carrerasPorDia)",
    bloqueSeleccion != null && !/setCarrerasPorDia/.test(bloqueSeleccion[1])
  );

  const bloqueLiquidadas = gestion.match(
    /const carrerasLiquidadasDelDia = useMemo\(\(\) => \{([\s\S]*?)\n  \}, \[([^\]]*)\]\);/
  );
  ok("carrerasLiquidadasDelDia existe", bloqueLiquidadas != null);
  const cuerpoLiquidadas = (bloqueLiquidadas?.[1] ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const depsLiquidadas = bloqueLiquidadas?.[2] ?? "";
  ok(
    "carrerasLiquidadasDelDia NO depende de la carrera seleccionada ni de la pizarra",
    bloqueLiquidadas != null &&
      !/carreraLiquidada|pizarraCentral|filasPreview/.test(cuerpoLiquidadas) &&
      !/(^|[^.\w])carrera\b/.test(cuerpoLiquidadas) &&
      !/carreraLiquidada|pizarraCentral|filasPreview|(^|[^.\w])carrera\b/.test(depsLiquidadas)
  );
  ok(
    "carrerasLiquidadasDelDia exige liquidación real (no solo ganadores)",
    bloqueLiquidadas != null && !/ganadores/.test(cuerpoLiquidadas)
  );
}

console.log(`\nTODO OK: ${pasan} pasaron, ${fallan} fallaron`);
if (fallan > 0) process.exit(1);
