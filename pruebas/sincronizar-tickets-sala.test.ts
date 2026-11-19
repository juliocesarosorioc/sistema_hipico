// Regresión: las concreciones de la Sala se registran con las condiciones de
// Taquilla (origen TAQUILLA, idempotencia por código, comisión y moneda del
// grupo) y se estructuran con el mismo normalizador de Carga Rápida.
import {
  sincronizarTicketsPropuestaATaquilla,
  leerNotaSala,
} from "../src/features/whatsapp-sala/lib/sincronizar-tickets-sala";
import {
  cargarContextoEstructuraSala,
  estructuraDesdeTicketSala,
  proyectarCargaSala,
} from "../src/features/whatsapp-sala/lib/estructurar-carga-sala";

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

function crearCliente(opciones: {
  tickets?: any[];
  grupo?: any;
  clientes?: any[];
  carreras?: any[];
  previas?: any[];
  candidatos?: any[];
  errorInsert?: any;
}) {
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const from = (tabla: string) => {
    const st: { tabla: string; metodo: string } = { tabla, metodo: "select" };
    const api: any = {
      select() {
        st.metodo = "select";
        return api;
      },
      eq() {
        return api;
      },
      ilike() {
        return api;
      },
      in() {
        return api;
      },
      limit() {
        return api;
      },
      neq() {
        return api;
      },
      maybeSingle() {
        return Promise.resolve({
          data:
            st.tabla === "grupos_venta"
              ? opciones.grupo ?? null
              : st.tabla === "tickets_apuestas"
              ? opciones.previas?.[0] ?? null
              : st.tabla === "carreras"
              ? opciones.carreras?.[0] ?? null
              : null,
          error: null,
        });
      },
      insert(filas: Array<Record<string, unknown>>) {
        st.metodo = "insert";
        inserts.push(...filas);
        return api;
      },
      update(filas: Record<string, unknown>) {
        st.metodo = "update";
        updates.push({ tabla, ...filas });
        return api;
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        let value: any = { data: null, error: null };
        if (st.metodo === "select") {
          if (st.tabla === "chat_tickets_fifo") value = { data: opciones.tickets ?? [] };
          else if (st.tabla === "clientes") value = { data: opciones.clientes ?? [] };
          else if (st.tabla === "carreras") value = { data: opciones.carreras ?? [] };
          else if (st.tabla === "tickets_apuestas") value = { data: opciones.candidatos ?? [] };
          else if (st.tabla === "grupos_venta") value = { data: opciones.grupo ? [opciones.grupo] : [] };
        } else if (st.metodo === "insert") {
          value = { data: [{ id: 901 }], error: opciones.errorInsert ?? null };
        } else if (st.metodo === "update") {
          value = { data: null, error: null };
        }
        return Promise.resolve(value).then(resolve, reject);
      },
    };
    return api;
  };
  return { from, inserts, updates };
}

const ticket = {
  codigo_ticket: "TK-E23B4EA9",
  proponente_id: "c2b86c79-f5f3-426d-a0b8-172adff10898",
  proponente_nombre: "SHAFLAN",
  aceptante_id: "bcf510ec-8c71-4503-bd8f-1db38335faa1",
  aceptante_nombre: "CLUB AMERICA",
  accion_proponente: "JUEGA",
  modalidad: "1P",
  ejemplar_numero: "6",
  caballos_bando_a: ["6"],
  caballos_bando_b: [],
  es_match: false,
  proporcion_premio: "1x1",
  monto_concretado: 1000,
  estado: "ACTIVO",
};

const sala = {
  id: "6cafa9e9-d6d4-4ff2-9b31-36ad176cdd7b",
  grupo_id: "b37f5104-5d38-44ab-b28a-5a546fe5fdb5",
  hipodromo_activo: "LA RINCONADA",
  numero_carrera_activa: 4,
  fecha_activa: "2026-11-23",
  estado_carrera: "Abierta",
  carrera_activa_id: "",
};

const params = {
  propuestaMsgId: "36c4e5e5-fd1d-46fd-8f45-540b5b439b8b",
  sala,
  grupoId: "b37f5104-5d38-44ab-b28a-5a546fe5fdb5",
  carreraAbierta: true,
};

const clientes = [
  {
    id: ticket.proponente_id,
    nombre: "SHAFLAN",
    seudonimo: "SHAFLAN",
    saldo_actual: 5000,
    aval: 0,
    libre: true,
    modo_juego: "libre",
    grupo_id: params.grupoId,
  },
  {
    id: ticket.aceptante_id,
    nombre: "CLUB AMERICA",
    seudonimo: "CLUB AMERICA",
    saldo_actual: 8000,
    aval: 0,
    libre: false,
    grupo_id: params.grupoId,
  },
];

(async () => {
  console.log("\n[1] la Sala se estructura con el normalizador de Carga Rápida");
  const clienteCtx = crearCliente({
    clientes,
    grupo: { comision_default: 2.5, moneda: "USD" },
    carreras: [{ id: "c-1", caballos: [{ numero: "6", nombre: "RELAMPAGO" }], retirados: [] }],
  });
  const ctx = await cargarContextoEstructuraSala(clienteCtx as any, {
    grupoId: params.grupoId,
    sala: sala as any,
    fecha: "2026-11-23",
    hipodromo: "LA RINCONADA",
    carrera: 4,
  });
  eq("comisión del grupo", ctx.comisionPct, 2.5);
  eq("catálogo de clientes", ctx.clientes.length, 2);
  eq("ejemplar del padrón", ctx.caballos[0]?.numero, "6");

  const estructurada = estructuraDesdeTicketSala(
    {
      clienteJuega: "SHAFLAN",
      clienteDa: "CLUB AMERICA",
      jugada: "1P",
      caballo: "6",
      monto: 1000,
    },
    ctx
  );
  eq("fila estructurada", estructurada?.fila, {
    jugada: "1P",
    caballo: "6",
    monto: "1000",
    cliente1: "SHAFLAN",
    cliente2: "CLUB AMERICA",
  });
  const proyectada = proyectarCargaSala(estructurada ? [estructurada.fila] : [], ctx)[0];
  eq("monto autorizado", proyectada?.montoAceptado, 1000);
  eq("modo libre sin tope", proyectada?.queda === Number.POSITIVE_INFINITY, true);

  console.log("\n[2] concreción registrada con condiciones de Taquilla");
  const clienteSync = crearCliente({
    tickets: [ticket],
    clientes,
    grupo: { comision_default: 2.5, moneda: "USD" },
    carreras: [{ id: "c-1", caballos: [{ numero: "6", nombre: "RELAMPAGO" }], retirados: [] }],
    candidatos: [],
  });
  await sincronizarTicketsPropuestaATaquilla(clienteSync as any, params);
  eq("un ticket insertado", clienteSync.inserts.length, 1);
  const fila = clienteSync.inserts[0] ?? {};
  eq("sin columna inexistente modalidad", Object.prototype.hasOwnProperty.call(fila, "modalidad"), false);
  eq("nota de taquilla", fila.nota_auditoria, {
    origen: "TAQUILLA",
    codigo_ticket: "TK-E23B4EA9",
    idempotencia: "TK-E23B4EA9",
    fecha_carrera: "2026-11-23",
  });
  eq("monto", fila.monto_jugado, 1000);
  eq("jugador", fila.cliente_juega_nombre, "SHAFLAN");
  eq("caballo", fila.caballo, "6");
  eq("jugada", fila.nombre_jugada, "1P");
  eq("comisión", fila.comision_porcentaje, 2.5);
  eq("moneda", fila.moneda, "USD");

  console.log("\n[3] carrera cerrada no registra");
  const clienteCerrado = crearCliente({
    tickets: [ticket],
    clientes,
    grupo: { comision_default: 2.5, moneda: "USD" },
  });
  await sincronizarTicketsPropuestaATaquilla(clienteCerrado as any, {
    ...params,
    carreraAbierta: false,
  });
  eq("sin inserciones", clienteCerrado.inserts.length, 0);

  console.log("\n[4] compatibilidad con el espejo legacy");
  eq("legacy SALA_P2P", leerNotaSala({ origen: "SALA_P2P", codigo_ticket: "TK-1" }), {
    origen: "SALA_P2P",
    codigo_ticket: "TK-1",
    idempotencia: "",
  });
  eq("TAQUILLA con código", leerNotaSala({ origen: "TAQUILLA", idempotencia: "TK-2", codigo_ticket: "TK-2" }), {
    origen: "TAQUILLA",
    codigo_ticket: "TK-2",
    idempotencia: "TK-2",
  });

  console.log(`\nRESUMEN: ${pasan} pasan, ${fallan} fallan`);
  if (fallan > 0) process.exitCode = 1;
})();
