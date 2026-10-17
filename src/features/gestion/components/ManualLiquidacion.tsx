"use client";

import React from "react";

/**
 * MANUAL DEL MOTOR DE LIQUIDACIÓN — documento vivo de la plataforma.
 *
 * Regla estricta de nomenclatura: TODA jugada relacionada con posiciones se
 * denomina, se procesa y se muestra ÚNICA Y EXCLUSIVAMENTE como "Jugadas de
 * Puestos". Está prohibido categorizarlas como "fijas", "fraccionadas",
 * "con nini" o "de bloques". La única otra etiqueta es "Jugadas a Premio"
 * (las pactadas con una relación de pago fija).
 *
 * Este componente es la cara visible del contrato del motor. Si cambia una
 * regla de cálculo, se cambia acá Y en el motor (`src/features/motores/lib/*`).
 */

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 border-b border-emerald-200 pb-1 text-sm font-black uppercase tracking-wide text-emerald-800">
        {titulo}
      </h3>
      <div className="space-y-2 text-[12px] leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

function Codigo({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-bold text-slate-800">
      {children}
    </code>
  );
}

export default function ManualLiquidacion() {
  return (
    <div className="mx-auto max-w-4xl bg-white px-6 py-8 font-sans text-slate-800 shadow-lg">
      <header className="mb-6 border-b-4 border-[#8B4513] pb-4">
        <h1 className="text-2xl font-extrabold text-[#1a3822]">Manual del Motor de Liquidación</h1>
        <p className="mt-1 text-xs text-slate-500">
          Reglas de cálculo, nomenclatura estricta, comisión de la casa y estructura del reporte.
        </p>
      </header>

      <Bloque titulo="0 · Regla estricta de nomenclatura">
        <p>
          En la plataforma, <b>TODAS</b> las jugadas relacionadas con posiciones se denominan
          única y exclusivamente como <b>“Jugadas de Puestos”</b>.
        </p>
        <p>
          Está <b>prohibido</b> categorizarlas o mostrarlas en los reportes bajo nombres como{" "}
          <i>fijas</i>, <i>fraccionadas</i>, <i>con nini</i> o <i>de bloques</i>. El sistema solo lee
          el código, hace la matemática y muestra el resultado bajo la etiqueta universal.
        </p>
        <p>
          La única otra etiqueta es <b>“Jugadas a Premio”</b>: las que se pactan con una relación de
          pago fija.
        </p>
      </Bloque>

      <Bloque titulo="1 · Jugadas de Puestos">
        <p>
          No dependen de los dividendos de pista: se pagan por proporción y monto pactado. La letra{" "}
          <b>n</b> (nini) significa “ni ganas ni pierdes” (devolución del monto de esa fracción).
        </p>

        <h4 className="pt-2 font-bold text-slate-800">Códigos de 1 factor</h4>
        <div className="overflow-hidden rounded border border-slate-200">
          <table className="w-full text-[11px]">
            <thead className="bg-slate-100 text-slate-500">
              <tr>
                <th className="px-2 py-1 text-left font-bold">Código</th>
                <th className="px-2 py-1 text-left font-bold">Llega 1°</th>
                <th className="px-2 py-1 text-left font-bold">Llega 2°</th>
                <th className="px-2 py-1 text-left font-bold">Llega 3° o peor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[
                ["1p", "Gana 100%", "Pierde", "Pierde"],
                ["2p", "Gana 100%", "Gana 100%", "Pierde"],
                ["2n", "Gana 100%", "Devuelve (nini)", "Pierde"],
                ["3n", "Gana 100%", "Gana 100%", "Devuelve (nini) si llega 3° · pierde el resto"],
              ].map((fila) => (
                <tr key={fila[0]} className="bg-white">
                  <td className="px-2 py-1 font-mono font-bold text-slate-800">{fila[0]}</td>
                  <td className="px-2 py-1">{fila[1]}</td>
                  <td className="px-2 py-1">{fila[2]}</td>
                  <td className="px-2 py-1">{fila[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h4 className="pt-2 font-bold text-slate-800">Códigos de 2 factores</h4>
        <p>
          Ej. <Codigo>1/2</Codigo>, <Codigo>2/2</Codigo>, <Codigo>2/3</Codigo>. El <b>50%</b> del
          monto se evalúa bajo la lógica del número a la izquierda de la barra y el otro{" "}
          <b>50%</b> bajo la lógica del número a la derecha.
        </p>

        <h4 className="pt-2 font-bold text-slate-800">Códigos unidos por “y”</h4>
        <p>
          Ej. <Codigo>1p y 1/2</Codigo>, <Codigo>1/2 y 2n</Codigo>, <Codigo>2n y 2/2</Codigo>,{" "}
          <Codigo>2/2 y 2p</Codigo>, <Codigo>2p y 2/3</Codigo>. El monto total se divide en dos
          partes iguales (50% / 50%): la primera se juega a la condición de la izquierda de la
          “y” y la segunda a la de la derecha.
        </p>
      </Bloque>

      <Bloque titulo="2 · Jugadas a Premio">
        <h4 className="font-bold text-slate-800">Modalidad A · Caballo Ganador (proporción fija)</h4>
        <p>
          Formatos: <Codigo>10/1</Codigo>, <Codigo>10/1.5</Codigo>, <Codigo>10/2</Codigo>,{" "}
          <Codigo>10/2,5</Codigo>, <Codigo>10/3</Codigo>, <Codigo>10A3</Codigo>,{" "}
          <Codigo>10a3</Codigo>, <Codigo>10/9.75</Codigo>, <Codigo>10a9,75</Codigo>…
        </p>
        <p>
          El cliente apuesta a que el caballo llega <b>1°</b>. La nomenclatura indica la relación de
          pago: se juegan 10 unidades para ganar la cantidad indicada después de la barra{" "}
          <Codigo>/</Codigo> o de la letra <Codigo>A</Codigo>/<Codigo>a</Codigo> (ej.: en{" "}
          <Codigo>10/2.5</Codigo> se juega 10 para ganar 2.5). <b>Pierde el 100%</b> si el caballo
          llega 2° o peor.
        </p>

        <h4 className="pt-2 font-bold text-slate-800">Modalidad B · Matchs de Ejemplares (duelos)</h4>
        <p>
          Formato: relación de pago, espacio, <i>Ejemplar(es) A</i> <Codigo>x</Codigo>{" "}
          <i>Ejemplar(es) B</i>. Los ejemplares se agrupan con guion <Codigo>-</Codigo>, coma{" "}
          <Codigo>,</Codigo> o espacio.
        </p>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            Individual: <Codigo>10/8 10x3</Codigo>
          </li>
          <li>
            Agrupados: <Codigo>10/7 10-9x3-2</Codigo> · <Codigo>10/7 10,9x3,2</Codigo> ·{" "}
            <Codigo>10/7 10 9x3 2</Codigo>
          </li>
        </ul>
        <p>
          La relación inicial (ej. <Codigo>10/8</Codigo>) define la proporción: el jugador que
          respalda a los ejemplares de la izquierda juega 10 para ganar 8; el que respalda a los de
          la derecha juega ese segundo número (8) para ganar 10. <b>Gana</b> el jugador cuyo ejemplar
          (o uno de los suyos, si están agrupados) llegue más cerca del 1° lugar en la pizarra
          oficial.
        </p>
      </Bloque>

      <Bloque titulo="3 · Comisión de la casa">
        <p>
          Se aplica una retención exacta del <b>5%</b> únicamente sobre las <b>ganancias netas</b> de
          la jugada, sin importar si es de Puestos o a Premio. Si la jugada pierde o devuelve (nini),
          no hay comisión.
        </p>
        <p className="rounded bg-emerald-50 px-3 py-2 font-mono text-[11px] text-emerald-800">
          comisión = gananciaNeta × 0.05 &nbsp;·&nbsp; saldo = gananciaNeta − comisión
        </p>
      </Bloque>

      <Bloque titulo="4 · Estructura del reporte">
        <p>
          <b>Encabezado (contexto):</b> Grupo hípico, hipódromo, carrera, fecha y pizarra oficial
          (orden de llegada 1°…5°).
        </p>
        <p>
          <b>Cuerpo (tabla de jugadas):</b> Juega · Apostó (monto que arriesga el que juega) · Jugó
          (código exacto) · Da · Apostó (monto que arriesga el que da) · Resultado. El monto de cada
          lado del pareo se muestra en su propia columna, y el resultado solo aparece cuando la
          jugada se decide: positivo (verde), negativo (rojo) o nulo (verde claro,{" "}
          <Codigo>+0,00</Codigo> para los ninis); mientras está pendiente, la celda queda vacía.
        </p>
        <p>
          <b>Jugadas adelantadas / especiales:</b> Parada Adelantadas, Tablas Fijas, Marcas
          Adelantadas y Jugadas Entre Tercios Adelantadas.
        </p>
        <p>
          <b>Resumen de saldos:</b> GANAN (verde, nulos al final) y PIERDEN (rojo), consolidados por
          participante.
        </p>
      </Bloque>

      <Bloque titulo="5 · Filtros del reporte">
        <p>
          El reporte es dinámico y filtrable en cascada: <b>temporal</b> (fecha; días recientes o
          pasados), <b>ubicación</b> (hipódromo y carrera) y <b>clasificación</b> (las secciones de
          adelantadas). Elegir una carrera fija su hipódromo y su fecha; cambiar el hipódromo
          reencuadra las carreras disponibles.
        </p>
      </Bloque>

      <footer className="mt-8 border-t border-slate-200 pt-3 text-center text-[10px] text-slate-400">
        Motor de liquidación · las jugadas de posición se muestran siempre como Jugadas de Puestos.
      </footer>
    </div>
  );
}
