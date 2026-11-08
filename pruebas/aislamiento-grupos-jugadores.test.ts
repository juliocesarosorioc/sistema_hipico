import {
  clientePerteneceAGrupo,
  filtrarClientesPorGrupo,
  clientesPertenecenAlMismoGrupo,
  type ClienteVenta,
  type GrupoVenta,
} from "../src/features/grupos/lib/grupos";

let pasan = 0;
let fallan = 0;

function ok(nombre: string, condicion: boolean, extra?: unknown) {
  if (condicion) {
    pasan++;
    console.log(`  ok   ${nombre}`);
  } else {
    fallan++;
    console.log(`  FALLA ${nombre}`, extra ?? "");
  }
}

console.log("\n--- TEST: Aislamiento estricto de jugadores por grupo ---");

const grupoArgentina: GrupoVenta = {
  id: "uuid-argentina",
  nombre: "Grupo Argentina",
  comision_default: 5,
};

const grupoMadrid: GrupoVenta = {
  id: "uuid-madrid",
  nombre: "Grupo Madrid",
  comision_default: 5,
};

const grupos = [grupoArgentina, grupoMadrid];

const jugadorArg1: ClienteVenta = {
  id: "cli-arg-1",
  nombre: "Carlos Gardel",
  grupo_id: "uuid-argentina",
  grupos: ["uuid-argentina"],
};

const jugadorArg2: ClienteVenta = {
  id: "cli-arg-2",
  nombre: "Diego Maradona",
  grupo_id: "uuid-argentina",
  grupos: ["uuid-argentina"],
};

const jugadorMadrid1: ClienteVenta = {
  id: "cli-mad-1",
  nombre: "Raul Gonzalez",
  grupo_id: "uuid-madrid",
  grupos: ["uuid-madrid"],
};

const jugadorMadrid2: ClienteVenta = {
  id: "cli-mad-2",
  nombre: "Iker Casillas",
  grupo_id: "uuid-madrid",
  grupos: ["uuid-madrid"],
};

const todosLosClientes = [jugadorArg1, jugadorArg2, jugadorMadrid1, jugadorMadrid2];

// 1. clientePerteneceAGrupo
ok("jugadorArg1 pertenece a Grupo Argentina por ID", clientePerteneceAGrupo(jugadorArg1, "uuid-argentina", grupos));
ok("jugadorArg1 pertenece a Grupo Argentina por Nombre", clientePerteneceAGrupo(jugadorArg1, "Grupo Argentina", grupos));
ok("jugadorArg1 NO pertenece a Grupo Madrid por ID", !clientePerteneceAGrupo(jugadorArg1, "uuid-madrid", grupos));
ok("jugadorArg1 NO pertenece a Grupo Madrid por Nombre", !clientePerteneceAGrupo(jugadorArg1, "Grupo Madrid", grupos));
ok("jugadorMadrid1 pertenece a Grupo Madrid", clientePerteneceAGrupo(jugadorMadrid1, "uuid-madrid", grupos));
ok("jugadorMadrid1 NO pertenece a Grupo Argentina", !clientePerteneceAGrupo(jugadorMadrid1, "uuid-argentina", grupos));
ok("cliente nulo devuelve false", !clientePerteneceAGrupo(null, "uuid-argentina", grupos));
ok("grupoId nulo devuelve false", !clientePerteneceAGrupo(jugadorArg1, null, grupos));
ok("grupoId vacío devuelve false", !clientePerteneceAGrupo(jugadorArg1, "", grupos));

// 2. filtrarClientesPorGrupo
const filtradosArg = filtrarClientesPorGrupo(todosLosClientes, "uuid-argentina", grupos);
ok("filtrar por Argentina devuelve exactamente 2 jugadores", filtradosArg.length === 2);
ok("filtrar por Argentina contiene cli-arg-1", filtradosArg.some((c) => c.id === "cli-arg-1"));
ok("filtrar por Argentina contiene cli-arg-2", filtradosArg.some((c) => c.id === "cli-arg-2"));
ok("filtrar por Argentina NO contiene jugadores de Madrid", !filtradosArg.some((c) => String(c.id).startsWith("cli-mad")));

const filtradosMadrid = filtrarClientesPorGrupo(todosLosClientes, "uuid-madrid", grupos);
ok("filtrar por Madrid devuelve exactamente 2 jugadores", filtradosMadrid.length === 2);
ok("filtrar por Madrid contiene cli-mad-1", filtradosMadrid.some((c) => c.id === "cli-mad-1"));
ok("filtrar por Madrid NO contiene jugadores de Argentina", !filtradosMadrid.some((c) => String(c.id).startsWith("cli-arg")));

const filtradosSinGrupo = filtrarClientesPorGrupo(todosLosClientes, null, grupos);
ok("filtrar sin grupo devuelve array vacío (no fuga clientes)", filtradosSinGrupo.length === 0);

// 3. clientesPertenecenAlMismoGrupo (prohibición de interacción entre jugadores de distintos grupos)
ok("dos jugadores de Argentina pertenecen al mismo grupo", clientesPertenecenAlMismoGrupo(jugadorArg1, jugadorArg2, grupos));
ok("dos jugadores de Madrid pertenecen al mismo grupo", clientesPertenecenAlMismoGrupo(jugadorMadrid1, jugadorMadrid2, grupos));
ok(
  "jugador de Argentina y jugador de Madrid NO pertenecen al mismo grupo (interacción bloqueada)",
  !clientesPertenecenAlMismoGrupo(jugadorArg1, jugadorMadrid1, grupos)
);
ok(
  "jugador de Madrid y jugador de Argentina NO pertenecen al mismo grupo (interacción bloqueada)",
  !clientesPertenecenAlMismoGrupo(jugadorMadrid2, jugadorArg2, grupos)
);
ok("jugador con banca genérica (null) se permite", clientesPertenecenAlMismoGrupo(jugadorArg1, null, grupos));

console.log(`\nResultado: ${pasan} pasaron, ${fallan} fallaron`);
if (fallan > 0) process.exit(1);
