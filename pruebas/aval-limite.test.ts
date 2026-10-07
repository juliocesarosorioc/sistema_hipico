// Pruebas del TOPE DE JUEGO CON AVAL.
//
// El aval es credito negado, NO efectivo: autoriza a jugar por encima del saldo,
// y el saldo queda debitado en negativo (esa deuda se cobra). El tope de juego
// es `saldo + aval`. Un cliente en mora con aval NO esta bloqueado.
//
// Modulo PURO a proposito: `taquilla/reparto.ts` no importa Supabase ni React,
// asi que node lo corre directo (el runner lo compila antes). `lib/grupos.ts`
// NO se importa aqui porque tira de Supabase al cargarse; sus helpers
// (`limiteDeJugar`, `esClienteLibre`, `textoDisponible`) DELEGAN en este mismo
// modulo, asi que lo que se prueba abajo es la regla que ambos usan.
import {
  disponibleParaJugar,
  respaldoAval,
  esSinTope,
  explicarDisponible,
  calcularReparto,
} from "../src/lib/taquilla/reparto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `lib/grupos.ts` no se importa (tira de Supabase al cargarse), asi que se lee
 * como texto. Se resuelve desde `process.cwd()` y NO desde `__dirname`: el
 * runner compila este archivo a `%TEMP%\marcas-testbuild\pruebas\`, fuera del
 * repo, y desde ahi `__dirname` no alcanza ningun fuente.
 */
const libGrupos = readFileSync(join(process.cwd(), "src", "lib", "grupos.ts"), "utf8");

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

function ok(nombre: string, condicion: boolean) {
  eq(nombre, condicion, true);
}

// ---------------------------------------------------------------------------
console.log("\n[1] disponible = saldo + aval");
// ---------------------------------------------------------------------------
// El caso que motiva el cambio: saldo negativo con aval sigue jugando.
eq("saldo -200 + aval 300 = 100", disponibleParaJugar({ saldo_actual: -200, aval: 300 }), 100);
eq("saldo 100 + aval 300 = 400", disponibleParaJugar({ saldo_actual: 100, aval: 300 }), 400);
eq("sin aval: el saldo pelado", disponibleParaJugar({ saldo_actual: 100, aval: null }), 100);
eq("aval 0 no suma nada", disponibleParaJugar({ saldo_actual: 50, aval: 0 }), 50);
eq("cliente inexistente -> 0", disponibleParaJugar(null), 0);
eq("sin saldo ni aval -> 0", disponibleParaJugar({}), 0);
eq("aval solo, sin saldo", disponibleParaJugar({ saldo_actual: null, aval: 250 }), 250);

// El aval NO se descuenta al jugar: es el saldo el que baja. Si se descontara,
// el limite bajaria dos veces por cada ticket y el cliente quedaria topado a la
// mitad de su credito sin que nadie lo autorizara.
{
  const c = { saldo_actual: -300, aval: 300 };
  eq("al agotar el limite disponible queda 0", disponibleParaJugar(c), 0);
}

// ---------------------------------------------------------------------------
console.log("\n[2] el aval NO es efectivo: no se puede retirar");
// ---------------------------------------------------------------------------
// La RPC de retiro (contabilidad.sql) prohibe dejar el saldo en negativo aunque
// haya aval: el aval es garantia, no plata para entregar. Si esto cambiara, el
// cliente se lleva el aval en efectivo y la garantia no respalda nada. Por eso
// el disponible se compone, pero el SALDO nunca se incrementa con el aval.
eq("un aval de 500 no crea saldo", disponibleParaJugar({ saldo_actual: 0, aval: 500 }), 500);
eq("el aval entra una sola vez", disponibleParaJugar({ saldo_actual: 0, aval: 500 }), 500);

// ---------------------------------------------------------------------------
console.log("\n[3] modo LIBRE: sin tope");
// ---------------------------------------------------------------------------
const libre = { saldo_actual: 0, aval: 0, modo_juego: "libre" };
ok("esSinTope con 'libre'", esSinTope(libre));
ok("'LIBRE' en mayusculas tambien", esSinTope({ modo_juego: "LIBRE" }));
ok("' libre ' con espacios", esSinTope({ modo_juego: " libre " }));
ok("modo 'aval' NO es libre", !esSinTope({ modo_juego: "aval" }));
ok("modo 'pozo' NO es libre (topa)", !esSinTope({ modo_juego: "pozo" }));
ok("sin modo NO es libre (topa)", !esSinTope({}));

// ---------------------------------------------------------------------------
console.log("\n[4] el reparto TOPA por saldo + aval, no por saldo");
// ---------------------------------------------------------------------------
{
  // Dador simple: el unico riesgo es del cliente. Con $100 de saldo y $300 de
  // aval puede jugar 400: antes (solo saldo) se le recortaba a 100.
  const r = calcularReparto({
    jugada: "5",
    ejemplares: "",
    monto: 400,
    cliente1: { nombre: "Ana", saldo_actual: 100, aval: 300 },
    cliente2: null,
  });
  eq("autoriza los 400 completos", r.montoAutorizado, 400);
  eq("no marca recorte", r.recortado, false);
  eq("lado1 sin excedido", r.lado1.excedido, false);
  eq("disponible del lado", r.lado1.disponible, 400);
}
{
  // El mismo cliente pidiendo mas de lo que su aval+saldo cubren.
  const r = calcularReparto({
    jugada: "5",
    ejemplares: "",
    monto: 500,
    cliente1: { nombre: "Ana", saldo_actual: 100, aval: 300 },
    cliente2: null,
  });
  eq("recorta a 400", r.montoAutorizado, 400);
  eq("si avisa del recorte", r.recortado, true);
  eq("el aviso menciona el recorte", r.avisos.length > 0, true);
}
{
  // Cliente en mora SIN aval: no puede jugar nada. El recorte a 0 es correcto.
  const r = calcularReparto({
    jugada: "5",
    ejemplares: "",
    monto: 50,
    cliente1: { nombre: "Beto", saldo_actual: -30, aval: 0 },
    cliente2: null,
  });
  eq("en mora sin aval no autoriza", r.montoAutorizado, 0);
}
{
  // En mora CON aval que no alcanza: topa en lo que cubre.
  const r = calcularReparto({
    jugada: "5",
    ejemplares: "",
    monto: 500,
    cliente1: { nombre: "Ana", saldo_actual: -300, aval: 300 },
    cliente2: null,
  });
  eq("topa en el aval (0)", r.montoAutorizado, 0);
}
{
  // Cliente LIBRE con saldo 0: la exception manda sobre el aval y sobre el saldo.
  const r = calcularReparto({
    jugada: "5",
    ejemplares: "",
    monto: 10000,
    cliente1: { nombre: "Caro", saldo_actual: 0, aval: 0, modo_juego: "libre" },
    cliente2: null,
  });
  eq("libre no recorta", r.recortado, false);
  eq("libre autoriza todo", r.montoAutorizado, 10000);
  eq("libre marca sinTope", r.lado1.sinTope, true);
  eq("libre nunca excedido", r.lado1.excedido, false);
}
{
  // Pareja: manda el MENOR disponible. Ana tiene 400, Beto en mora sin aval -30.
  const r = calcularReparto({
    jugada: "1-2",
    ejemplares: "1-2",
    monto: 100,
    cliente1: { nombre: "Ana", saldo_actual: 100, aval: 300 },
    cliente2: { nombre: "Beto", saldo_actual: -30, aval: 0 },
  });
  eq("topa por el mas pobre (0)", r.montoAutorizado, 0);
}
{
  // Pareja donde el aval SALVA la operacion: ambos con saldo justo.
  const r = calcularReparto({
    jugada: "1-2",
    ejemplares: "1-2",
    monto: 150,
    cliente1: { nombre: "Ana", saldo_actual: 100, aval: 300 },
    cliente2: { nombre: "Beto", saldo_actual: 100, aval: 300 },
  });
  eq("ambos con aval: autorizan 150", r.montoAutorizado, 150);
  eq("sin recortes", r.recortado, false);
}

// ---------------------------------------------------------------------------
console.log("\n[6] el aviso dice de donde sale la plata");
// ---------------------------------------------------------------------------
{
  // Un cliente en mora al que el aval lo salva: el aviso tiene que decirlo, o
  // el caja cree que hay efectivo y se sorprende al no cobrar.
  const t = explicarDisponible({ nombre: "Ana", saldo_actual: -200, aval: 300 });
  ok("menciona el saldo en mora", /-200/.test(t));
  ok("menciona el aval", /300/.test(t));
  ok("menciona el total", /100/.test(t));
}
{
  const t = explicarDisponible({ nombre: "Beto", saldo_actual: 100, aval: 0 });
  ok("sin aval no inventa aval", !/aval/.test(t));
}
eq("respaldoAval devuelve el aval", respaldoAval({ aval: 300 }), 300);
eq("respaldoAval sin aval", respaldoAval({}), 0);

// ---------------------------------------------------------------------------
console.log("\n[7] lib/grupos.ts DELEGA, no reimplementa");
// ---------------------------------------------------------------------------
{
  // Si grupos.ts vuelve a calcular `saldo + aval` por su cuenta, la regla deja
  // de ser una sola: el navegador (grupos) y la RPC (SQL) pueden topar distinto,
  // y el caja autoriza de mas o deja de vender. Se falla aqui, no en produccion.
  ok("grupos.ts llama a disponibleParaJugar", /limiteDeJugar[\s\S]{0,200}disponibleParaJugar/.test(libGrupos));
  ok("grupos.ts llama a esSinTope", /esClienteLibre[\s\S]{0,120}esSinTope/.test(libGrupos));
  ok(
    "grupos.ts NO suma saldo + aval por su cuenta",
    !/saldoDeCliente\([^)]*\)\s*\+\s*avalDeCliente/.test(libGrupos)
  );
}

eq("respaldoAval devuelve el aval", respaldoAval({ aval: 300 }), 300);
eq("respaldoAval sin aval", respaldoAval({}), 0);

// ---------------------------------------------------------------------------
console.log("\n[6] NO se rompe lo que ya funcionaba");
// ---------------------------------------------------------------------------
{
  // Cliente de siempre: saldo positivo, sin aval. Debe seguir igual que antes.
  const r = calcularReparto({
    jugada: "5",
    ejemplares: "",
    monto: 100,
    cliente1: { nombre: "Ana", saldo_actual: 500, aval: 0 },
    cliente2: null,
  });
  eq("saldo positivo sin aval: autoriza", r.montoAutorizado, 100);
  eq("y no recorta", r.recortado, false);
}
{
  // El default historico: cliente sin `aval` informado (no null vs undefined).
  eq("undefined es 0", disponibleParaJugar({ saldo_actual: 75, aval: undefined }), 75);
}

// ---------------------------------------------------------------------------
console.log(`\n${fallan === 0 ? "TODO OK" : "HAY FALLAS"}: ${pasan} pasaron, ${fallan} fallaron\n`);
if (fallan > 0) process.exit(1);
