// Pruebas de la VENTA INDIVIDUAL DE TAQUILLA (BetSlip → tickets_apuestas).
//
// La RPC no se puede ejercitar sin base de datos, así que aquí se prueba:
//   · los helpers PUROS del cliente (`numeroDeCaballo`, `claveIdempotencia`),
//   · que el SQL de la migración exista y declare lo que la venta necesita
//     (venta + anulación + índice de idempotencia + grants), para que un rename
//     accidental no deje la Taquilla escribiendo en el aire.
import { numeroDeCaballo, claveIdempotenciaJugada } from "../src/features/taquilla/lib/venta";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(join(process.cwd(), "sql", "taquilla_venta.sql"), "utf8");

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
  if (condicion) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}`);
  }
}

console.log("\nnumeroDeCaballo");
eq("un solo ejemplar pasa como número", numeroDeCaballo("1"), 1);
eq("con espacios toma el número", numeroDeCaballo(" 3 "), 3);
eq("un pareo NO es número", numeroDeCaballo("1-2"), null);
eq("un conjunto separado por espacios NO es número", numeroDeCaballo("12 13 x 14 15"), null);
eq("vacío NO es número", numeroDeCaballo(""), null);
eq("texto NO es número", numeroDeCaballo("abc"), null);

console.log("\nclaveIdempotenciaJugada");
const k1 = claveIdempotenciaJugada();
const k2 = claveIdempotenciaJugada();
ok("genera una clave no vacía", typeof k1 === "string" && k1.length > 0);
ok("dos jugadas distintas reciben claves distintas", k1 !== k2);

console.log("\nsql/taquilla_venta.sql");
ok("declara la función de venta", /function public\.club_vender_jugada\s*\(/.test(sql));
ok("declara la función de anulación", /function public\.club_anular_jugada\s*\(/.test(sql));
ok("la venta registra origen TAQUILLA", /'origen',\s*'TAQUILLA'/.test(sql));
ok("la venta guarda la modalidad para el banquero", /'modalidad',/.test(sql));
ok("inserta en tickets_apuestas", /insert into public\.tickets_apuestas/i.test(sql));
ok("descuenta saldo (update clientes)", /update public\.clientes/i.test(sql));
ok("tiene índice único de idempotencia", /create unique index if not exists tickets_taquilla_idem_unico/.test(sql));
ok("la anulación devuelve el saldo", /saldo_actual\s*=\s*coalesce\(v_saldo, 0\) \+ v_tk\.monto_jugado/.test(sql));
ok("expone la venta a anon/authenticated", /grant execute on function public\.club_vender_jugada[\s\S]*?to anon, authenticated, service_role;/.test(sql));
ok("expone la anulación a anon/authenticated", /grant execute on function public\.club_anular_jugada[\s\S]*?to anon, authenticated, service_role;/.test(sql));

console.log("\nBetSlip (Taquilla) persiste en tickets_apuestas");
{
  const slip = readFileSync(
    join(process.cwd(), "src", "features", "taquilla", "components", "BetSlip.tsx"),
    "utf8"
  );
  // El BetSlip dejó de ser solo-sesión: pide contexto y llama a la RPC de venta.
  ok("importa la venta transaccional", /from "@\/features\/taquilla\/lib\/venta"/.test(slip));
  ok("llama a venderJugada(", /venderJugada\(/.test(slip));
  ok("envía el cliente que juega (clienteId)", /clienteId:\s*String\(c1\.id\)/.test(slip));
  ok("manda la modalidad para el banquero", /modalidad:/.test(slip));
  ok("usa una clave de idempotencia", /claveIdempotenciaJugada\(\)/.test(slip));
  ok("guarda el ticket real en la sesión (ticketId)", /ticketId:\s*venta\.ticketId/.test(slip));
  // Contexto de la carrera (fecha · hipódromo · carrera).
  ok("tiene fecha/hipódromo/carrera", /const \[fecha/.test(slip) && /const \[hipodromo/.test(slip) && /const \[carrera/.test(slip));
  ok("carga el catálogo de clientes", /listarClientesVenta\(\)/.test(slip));
  ok("respeta el tope mostrando el disponible", /textoDisponible\(/.test(slip));
  // Un import roto de la venta no debe quedar silencioso.
  ok("no usa ya el registro solo-sesión sin contexto", /carrerasDe\(hipodromo\)/.test(slip));
}

console.log(`\n${pasan} pasaron, ${fallan} fallaron`);
process.exit(fallan > 0 ? 1 : 0);
