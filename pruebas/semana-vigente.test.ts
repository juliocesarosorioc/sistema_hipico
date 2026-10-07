/**
 * Pruebas del CICLO SEMANAL y de la SEMANA VIGENTE.
 *
 * Lo que se rompe acá es silencioso: la semana que muestra la grilla, el rango
 * que consolida el balance y el que aparece en el histórico. Si estas funciones
 * se desvían un día, nadie ve un error: se ve una semana consolidada que no
 * corresponde. Por eso se comparan fechas exactas, no "está cerca".
 */
import {
  cicloSemanalDe,
  rangoSemanaDeGrupo,
  rangoSemanaDesde,
  semanaVigenteDe,
} from "../src/lib/liquidacion/semana";
import { rangoACerrar } from "../src/lib/liquidacion/cierres";

/** Días que abarca un rango, ambos extremos incluidos. */
function diasDe(r: { inicio: string; fin: string }): number {
  const d = (s: string) => new Date(...(s.split("-").map(Number) as [number, number, number])).getTime();
  return Math.round((d(r.fin) - d(r.inicio)) / 86400000) + 1;
}

let ok = 0;
let fallos = 0;
function eq(nombre: string, real: unknown, esperado: unknown) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  if (a === b) {
    ok++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallos++;
    console.log(`  FALLA ${nombre}\n         esperado ${b}\n         real     ${a}`);
  }
}

const LUN = { diaInicio: 1, diaFin: 7 };

console.log("[1] ciclo por defecto y normalización de datos sucios");
eq("sin datos: lunes a domingo", cicloSemanalDe({}), { diaInicio: 1, diaFin: 7 });
eq("válido se respeta", cicloSemanalDe({ dia_inicio_semana: 4, dia_fin_semana: 3 }), { diaInicio: 4, diaFin: 3 });
eq("inicio 0 (basura) vuelve a lunes", cicloSemanalDe({ dia_inicio_semana: 0, dia_fin_semana: 5 }), { diaInicio: 1, diaFin: 5 });
eq("inicio 8 (fuera de rango) vuelve a lunes", cicloSemanalDe({ dia_inicio_semana: 8, dia_fin_semana: 2 }), { diaInicio: 1, diaFin: 2 });
// El corte cae al default (domingo), no al inicio. Antes caía al inicio y una
// semana sin `dia_fin_semana` duraba 24 horas: el cierre semanal consolidaba un
// solo día y la grilla mostraba una sola casilla.
eq("fin ausente cae al domingo, no al inicio", cicloSemanalDe({ dia_inicio_semana: 4 }), { diaInicio: 4, diaFin: 7 });
eq("fin 99 (fuera de rango) cae al domingo", cicloSemanalDe({ dia_inicio_semana: 3, dia_fin_semana: 99 }), { diaInicio: 3, diaFin: 7 });
eq("inicio ausente y fin puesto: lunes→ese día", cicloSemanalDe({ dia_fin_semana: 3 }), { diaInicio: 1, diaFin: 3 });
// Un ciclo Jue→Dom son 4 días, y eso es una elección válida del grupo: no se
// fuerza a 7. Lo que NO puede pasar es que el ciclo caiga a un solo día, que
// era el bug del corte ausente.
eq("ciclo jueves→domingo dura 4 días", diasDe(rangoSemanaDeGrupo("2026-10-08", cicloSemanalDe({ dia_inicio_semana: 4 }))), 4);
eq("ciclo por defecto dura 7 días", diasDe(rangoSemanaDeGrupo("2026-10-08", cicloSemanalDe({}))), 7);

console.log("\n[2] semana que contiene hoy (Lunes→Domingo)");
eq("lunes", rangoSemanaDeGrupo("2026-10-05", LUN), { inicio: "2026-10-05", fin: "2026-10-11" });
eq("domingo (misma semana)", rangoSemanaDeGrupo("2026-10-11", LUN), { inicio: "2026-10-05", fin: "2026-10-11" });
eq("lunes siguiente (semana nueva)", rangoSemanaDeGrupo("2026-10-12", LUN), { inicio: "2026-10-12", fin: "2026-10-18" });
eq("domingo anterior (semana vieja)", rangoSemanaDeGrupo("2026-10-04", LUN), { inicio: "2026-09-28", fin: "2026-10-04" });

console.log("\n[3] ciclo corrido: jueves→miércoles");
// El caso que un if ingenuo rompe: el fin (3) es MENOR que el inicio (4), así que
// la semana salta al mes siguiente.
const jueMie = { diaInicio: 4, diaFin: 3 };
eq("jueves de apertura", rangoSemanaDeGrupo("2026-10-08", jueMie), { inicio: "2026-10-08", fin: "2026-10-14" });
eq("miércoles de corte (misma semana)", rangoSemanaDeGrupo("2026-10-14", jueMie), { inicio: "2026-10-08", fin: "2026-10-14" });
eq("miércoles siguiente = semana nueva", rangoSemanaDeGrupo("2026-10-15", jueMie), { inicio: "2026-10-15", fin: "2026-10-21" });
eq("miércoles anterior = semana vieja", rangoSemanaDeGrupo("2026-10-07", jueMie), { inicio: "2026-10-01", fin: "2026-10-07" });

console.log("\n[4] rangoSemanaDesde: la semana que empieza en una fecha");
eq("desde el lunes", rangoSemanaDesde("2026-10-05", LUN), { inicio: "2026-10-05", fin: "2026-10-11" });
eq("desde un miércoles se ancla al lunes anterior", rangoSemanaDesde("2026-10-07", LUN), { inicio: "2026-10-05", fin: "2026-10-11" });
eq("desde un jueves, con ciclo jueves→miércoles", rangoSemanaDesde("2026-10-08", jueMie), { inicio: "2026-10-08", fin: "2026-10-14" });
eq("el rango tiene 7 días exactos", 7, diasDe(rangoSemanaDesde("2026-10-05", LUN)));

console.log("\n[5] semana vigente: sin fijar, manda el calendario");
eq("null = deduce de hoy", semanaVigenteDe("2026-10-13", LUN, null), { inicio: "2026-10-12", fin: "2026-10-18", fijada: false });
eq("undefined = deduce de hoy", semanaVigenteDe("2026-10-13", LUN, undefined), { inicio: "2026-10-12", fin: "2026-10-18", fijada: false });
eq("vacío = deduce de hoy", semanaVigenteDe("2026-10-13", LUN, ""), { inicio: "2026-10-12", fin: "2026-10-18", fijada: false });

console.log("\n[6] semana vigente: fijada gana sobre el calendario");
eq("fijada la anterior", semanaVigenteDe("2026-10-13", LUN, "2026-10-05"), { inicio: "2026-10-05", fin: "2026-10-11", fijada: true });
eq("fijada la siguiente", semanaVigenteDe("2026-10-13", LUN, "2026-10-19"), { inicio: "2026-10-19", fin: "2026-10-25", fijada: true });
eq("fijada aunque hoy esté en otra semana", semanaVigenteDe("2026-12-30", LUN, "2026-10-05").inicio, "2026-10-05");
eq("con timestamp se recorta a la fecha", semanaVigenteDe("2026-10-13", LUN, "2026-10-05T00:00:00Z").inicio, "2026-10-05");
eq("respeta el ciclo del grupo", semanaVigenteDe("2026-10-20", jueMie, "2026-10-08"), { inicio: "2026-10-08", fin: "2026-10-14", fijada: true });

console.log("\n[7] datos de semana vigente que no sirven: se ignoran");
// Un dato roto tiene que caer en la deducción, no dejar la pantalla sin semana.
for (const basura of ["no-es-fecha", "2026-13-45", "2026/10/05", "05-10-2026", "  "]) {
  const r = semanaVigenteDe("2026-10-13", LUN, basura);
  eq(`"${basura}" se descarta y deduce del calendario`, r, { inicio: "2026-10-12", fin: "2026-10-18", fijada: false });
}

console.log("\n[8] «Cerrar Semana» consolida la semana VIGENTE, no la del reloj");
// Este es el motivo de que la columna exista: si el botón cerrara otra semana,
// el histórico contradice a la pantalla.
eq("sin fijar, cierra la semana de hoy", rangoACerrar({}, "SEMANA", "2026-10-13"), { inicio: "2026-10-12", fin: "2026-10-18" });
eq("fijada, cierra la fijada", rangoACerrar({ semana_vigente_inicio: "2026-10-05" }, "SEMANA", "2026-10-13"), {
  inicio: "2026-10-05",
  fin: "2026-10-11",
});
eq("fijada + ciclo corrido, cierra el rango del ciclo", rangoACerrar({ dia_inicio_semana: 4, dia_fin_semana: 3, semana_vigente_inicio: "2026-10-08" }, "SEMANA", "2026-10-20"), {
  inicio: "2026-10-08",
  fin: "2026-10-14",
});

console.log("\n[9] el cierre del DÍA no se mueve al fijar la semana");
// Fijar la semana no debe cambiar la jornada: se cierra el día que se pasó.
eq("el día es el de la fecha", rangoACerrar({ semana_vigente_inicio: "2026-10-05" }, "DIA", "2026-10-13"), {
  inicio: "2026-10-13",
  fin: "2026-10-13",
});
eq("el cierre del día y el de la semana son rangos distintos", rangoACerrar({}, "DIA", "2026-10-13").inicio !== rangoACerrar({}, "SEMANA", "2026-10-13").inicio, true);

console.log(`\nTODO ${fallos === 0 ? "OK" : "FALLA"}: ${ok} pasaron, ${fallos} fallaron`);
if (fallos > 0) process.exit(1);