import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { construirEstadoCuenta } from "@/features/clientes/lib/clientes";
import { armarReporteDiario } from "@/features/reportes/lib/reporte-diario";

const tickets = [
  {
    id: 348,
    fecha_carrera: '2026-10-30',
    hipodromo: 'BELMONT PARK',
    carrera: 5,
    nombre_jugada: '4N',
    monto_jugado: 30,
    monto_decidido: 30,
    premio_pagar: 0,
    estado: 'Perdedor',
    comision_porcentaje: 5,
    comision_pagada: 0,
    cliente_juega_nombre: 'FORTUNA',
    cliente_consigue_nombre: 'ARELY'
  },
  {
    id: 314,
    fecha_carrera: '2026-10-30',
    hipodromo: 'KEENELAND',
    carrera: 1,
    nombre_jugada: '10/9',
    monto_jugado: 40,
    monto_decidido: 40,
    premio_pagar: 76,
    estado: 'Ganador',
    comision_porcentaje: 5,
    comision_pagada: 0,
    cliente_juega_nombre: 'GAETANO',
    cliente_consigue_nombre: 'ARELY'
  },
  {
    id: 277,
    fecha_carrera: '2026-10-29',
    hipodromo: 'DELTA DOWNS',
    carrera: 2,
    nombre_jugada: '2N',
    monto_jugado: 50,
    monto_decidido: 50,
    premio_pagar: 100,
    estado: 'Ganador',
    comision_porcentaje: 5,
    comision_pagada: 0,
    cliente_juega_nombre: 'SAM',
    cliente_consigue_nombre: 'ARELY'
  },
  {
    id: 274,
    fecha_carrera: '2026-10-29',
    hipodromo: 'CHURCHILL DOWNS',
    carrera: 10,
    nombre_jugada: '2N',
    monto_jugado: 50,
    monto_decidido: 50,
    premio_pagar: 0,
    estado: 'Pendiente',
    comision_porcentaje: 5,
    comision_pagada: 0,
    cliente_juega_nombre: 'SAM',
    cliente_consigue_nombre: 'ARELY'
  },
  {
    id: 284,
    fecha_carrera: '2026-10-29',
    hipodromo: 'REMINGTON PARK',
    carrera: 2,
    nombre_jugada: '10/7',
    monto_jugado: 30,
    monto_decidido: 30,
    premio_pagar: 51,
    estado: 'Ganador',
    comision_porcentaje: 5,
    comision_pagada: 0,
    cliente_juega_nombre: 'ARELY',
    cliente_consigue_nombre: 'SAM'
  },
  {
    id: 309,
    fecha_carrera: '2026-10-29',
    hipodromo: 'REMINGTON PARK',
    carrera: 3,
    nombre_jugada: '2Y3N',
    monto_jugado: 50,
    monto_decidido: 50,
    premio_pagar: 0,
    estado: 'Perdedor',
    comision_porcentaje: 5,
    comision_pagada: 0,
    cliente_juega_nombre: 'SAM',
    cliente_consigue_nombre: 'ARELY'
  },
  {
    id: 312,
    fecha_carrera: '2026-10-29',
    hipodromo: 'DELTA DOWNS',
    carrera: 7,
    nombre_jugada: '10/10',
    monto_jugado: 70,
    monto_decidido: 70,
    premio_pagar: 0,
    estado: 'Perdedor',
    comision_porcentaje: 5,
    comision_pagada: 0,
    cliente_juega_nombre: 'SAM',
    cliente_consigue_nombre: 'ARELY'
  },
  {
    id: 311,
    fecha_carrera: '2026-10-29',
    hipodromo: 'DELTA DOWNS',
    carrera: 7,
    nombre_jugada: '10/10',
    monto_jugado: 200,
    monto_decidido: 200,
    premio_pagar: 0,
    estado: 'Perdedor',
    comision_porcentaje: 5,
    comision_pagada: 0,
    cliente_juega_nombre: 'SAM',
    cliente_consigue_nombre: 'ARELY'
  },
  {
    id: 313,
    fecha_carrera: '2026-10-29',
    hipodromo: 'CHURCHILL DOWNS',
    carrera: 5,
    nombre_jugada: '10/10',
    monto_jugado: 50,
    monto_decidido: 50,
    premio_pagar: 0,
    estado: 'Perdedor',
    comision_porcentaje: 5,
    comision_pagada: 0,
    cliente_juega_nombre: 'SAM',
    cliente_consigue_nombre: 'ARELY'
  },
  {
    id: 280,
    fecha_carrera: '2026-10-29',
    hipodromo: 'HOLLYWOOD AT CHARLES TOWN',
    carrera: 2,
    nombre_jugada: '1P Y 1Y2N',
    monto_jugado: 40,
    monto_decidido: 40,
    premio_pagar: 10,
    estado: 'Perdedor',
    comision_porcentaje: 5,
    comision_pagada: 0,
    cliente_juega_nombre: 'FORTUNA',
    cliente_consigue_nombre: 'ARELY'
  },
  {
    id: 260,
    fecha_carrera: '2026-10-29',
    hipodromo: 'CHURCHILL DOWNS',
    carrera: 5,
    nombre_jugada: '10/10',
    monto_jugado: 50,
    monto_decidido: 50,
    premio_pagar: 0,
    estado: 'Perdedor',
    comision_porcentaje: 5,
    comision_pagada: 0,
    cliente_juega_nombre: 'ARELY',
    cliente_consigue_nombre: 'SAM'
  },
  {
    id: 479,
    fecha_carrera: '2026-10-30',
    hipodromo: 'REMINGTON PARK',
    carrera: 1,
    nombre_jugada: '1P',
    monto_jugado: 30,
    monto_decidido: 30,
    premio_pagar: 60,
    estado: 'Ganador',
    comision_porcentaje: 5,
    comision_pagada: 0,
    cliente_juega_nombre: 'EDDIE',
    cliente_consigue_nombre: 'ARELY'
  },
  {
    id: 246,
    fecha_carrera: '2026-10-29',
    hipodromo: 'CHURCHILL DOWNS',
    carrera: 2,
    nombre_jugada: '1Y2N Y 2N',
    monto_jugado: 50,
    monto_decidido: 50,
    premio_pagar: 100,
    estado: 'Ganador',
    comision_porcentaje: 5,
    comision_pagada: 0,
    cliente_juega_nombre: 'ARELY',
    cliente_consigue_nombre: 'SAM'
  },
  {
    id: 540,
    fecha_carrera: '2026-10-31',
    hipodromo: 'BELMONT PARK',
    carrera: 3,
    nombre_jugada: '2Y3N',
    monto_jugado: 200,
    monto_decidido: 200,
    premio_pagar: 100,
    estado: 'Perdedor',
    comision_porcentaje: 5,
    comision_pagada: 0,
    cliente_juega_nombre: 'SAM',
    cliente_consigue_nombre: 'ARELY'
  },
  {
    id: 485,
    fecha_carrera: '2026-10-30',
    hipodromo: 'HOLLYWOOD AT CHARLES TOWN',
    carrera: 2,
    nombre_jugada: '10/3',
    monto_jugado: 50,
    monto_decidido: 50,
    premio_pagar: 0,
    estado: 'Perdedor',
    comision_porcentaje: 5,
    comision_pagada: 0,
    cliente_juega_nombre: 'ARELY',
    cliente_consigue_nombre: 'SAM'
  },
  {
    id: 491,
    fecha_carrera: '2026-10-30',
    hipodromo: 'HOLLYWOOD AT CHARLES TOWN',
    carrera: 3,
    nombre_jugada: '10/8',
    monto_jugado: 40,
    monto_decidido: 40,
    premio_pagar: 72,
    estado: 'Ganador',
    comision_porcentaje: 5,
    comision_pagada: 0,
    cliente_juega_nombre: 'SPEEDY',
    cliente_consigue_nombre: 'ARELY'
  },
  {
    id: 612,
    fecha_carrera: '2026-11-01',
    hipodromo: 'LA RINCONADA',
    carrera: 5,
    nombre_jugada: '10/7',
    monto_jugado: 70,
    monto_decidido: 70,
    premio_pagar: 0,
    estado: 'Perdedor',
    comision_porcentaje: 5,
    comision_pagada: 0,
    cliente_juega_nombre: 'FEDERICO',
    cliente_consigue_nombre: 'ARELY'
  },
  {
    id: 558,
    fecha_carrera: '2026-11-01',
    hipodromo: 'LA RINCONADA',
    carrera: 1,
    nombre_jugada: 'PP',
    monto_jugado: 30,
    monto_decidido: 30,
    premio_pagar: 60,
    estado: 'Ganador',
    comision_porcentaje: 5,
    comision_pagada: 0,
    cliente_juega_nombre: 'ARELY',
    cliente_consigue_nombre: 'JOSEGREGORIO'
  },
  {
    id: 531,
    fecha_carrera: '2026-10-31',
    hipodromo: 'KEENELAND',
    carrera: 1,
    nombre_jugada: '2P',
    monto_jugado: 20,
    monto_decidido: 20,
    premio_pagar: 40,
    estado: 'Ganador',
    comision_porcentaje: 5,
    comision_pagada: 0,
    cliente_juega_nombre: 'ARELY',
    cliente_consigue_nombre: 'GAETANO'
  }
];

describe("Portal Arely Test", () => {
  it("reproduce la situacion de COM.DEV. 2.50", () => {
    const cliente = {
      id: '687eb4da-aeb3-496c-869c-9b19b95e84c6',
      nombre: 'ARELY',
      seudonimo: 'ARELY',
      devolucion: 0,
      incentivo_pct: 0,
      comision: 5
    };

    const arbol = construirEstadoCuenta(tickets as any, 0, cliente);

    const jugadas = arbol.jugadas.map((j) => ({
      id: j.id,
      fecha: j.fechaCarrera || j.fecha,
      horaCarga: j.horaCarga,
      rol: j.rol,
      cliente: "ARELY",
      jugada: j.jugada,
      caballo: j.caballo,
      estado: j.estado,
      hipodromo: j.hipodromo,
      carrera: j.carrera,
      montoJugado: j.montoJugado,
      premio: j.premio,
      resultadoNeto: j.resultadoNeto,
      devolucion: j.devolucion,
      anulada: false,
    }));

    const rep = armarReporteDiario(jugadas);
    console.log("Totales comisionDevuelta:", rep.totales.comisionDevuelta);
    for (const dia of rep.dias ?? []) {
      console.log(`Día ${dia.fecha}: comDev=${dia.comisionDevuelta}`);
      for (const h of dia.hipodromos) {
        if (h.comisionDevuelta > 0) {
          console.log(`  Hipo ${h.hipodromo}: comDev=${h.comisionDevuelta}`);
        }
        for (const c of h.carreras) {
          if (c.comisionDevuelta > 0) {
            console.log(`    Carrera ${c.carrera}: comDev=${c.comisionDevuelta}`);
            for (const det of c.jugadasDetalle) {
              console.log(`      det id=${det.id}, rol=${det.rol}, resNeto=${det.resultadoNeto}, comDev=${det.comisionDevuelta}`);
            }
          }
        }
      }
    }
  });
});
