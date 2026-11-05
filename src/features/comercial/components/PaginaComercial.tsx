"use client";

import { useState } from "react";
import Link from "next/link";
import { ModalRegistroUsuario } from "@/features/auth/components/ModalRegistroUsuario";

export default function PaginaComercial() {
  const [modalRegistroAbierto, setModalRegistroAbierto] = useState(false);
  const [calculadoraMonto, setCalculadoraMonto] = useState<number>(120);
  const [faqAbierto, setFaqAbierto] = useState<number | null>(0);

  // Cálculo en vivo regla 120 para ganar 100
  const gananciaNeta = Math.round((calculadoraMonto * 100) / 120 * 100) / 100;
  const pagoTotal = Math.round((calculadoraMonto + gananciaNeta) * 100) / 100;

  const faqs = [
    {
      q: "¿Cómo funciona la regla de Marcas de '120 para 100'?",
      a: "Se juega 120 para ganar 100: la ganancia neta equivale exactamente a 100/120 del monto jugado. Si juegas $120 y aciertas, recibes tus $120 de reintegro más $100 de ganancia neta (total cobro $220). Aplica a todas las marcas de la hoja con validación estricta de NO VALEN (NV) y debutantes.",
    },
    {
      q: "¿En qué consiste la Banca Espejo al 2.5% de comisión?",
      a: "La plataforma permite asignar banqueros independientes por cada tipo de jugada (Tablas, Marcas, Remates, Dupletas). El banquero asume el lado contrario de las jugadas en tiempo real y recibe una comisión estándar del 2.5%, con liquidación espejo inmediata al cierre de la carrera.",
    },
    {
      q: "¿Cómo se controla el riesgo de los jugadores (Libre, Aval, Pozo)?",
      a: "Un jugador con Saldo Libre no tiene límite para apostar. Un jugador con Aval solo puede jugar hasta el tope garantizado de su aval. Un jugador con Pozo solo puede apostar con el respaldo de su pozo prepagado disponible. El sistema valida esto antes de emitir cualquier ticket.",
    },
    {
      q: "¿Cómo se realiza el Cruce entre Jugadores?",
      a: "Cuando un jugador desea transferir parte de su saldo a otro jugador, el operador utiliza el módulo de cruces: se selecciona el jugador emisor, el jugador receptor, el monto y el soporte/capture. El sistema genera automáticamente el asiento contable con partida y contrapartida sin descuadre.",
    },
    {
      q: "¿Cómo se aprueba el registro de un nuevo usuario?",
      a: "Al completar el formulario en esta web, la solicitud queda en estado 'Pendiente de Aprobación'. El prospecto puede enviar un mensaje formal por WhatsApp al Administrador con un solo clic. El Administrador revisa los datos en el panel de Seguridad y activa la cuenta inmediatamente.",
    },
    {
      q: "¿Es compatible con impresoras térmicas de tickets?",
      a: "Sí. Toda la plataforma está optimizada para impresión en rollos térmicos de 58mm y 80mm tanto para tickets de taquilla como para hojas de liquidación y comprobantes contables.",
    },
  ];

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 selection:bg-amber-500 selection:text-slate-950">
      {/* ==================================================================== */}
      {/* BARRA SUPERIOR DE ANUNCIOS                                          */}
      {/* ==================================================================== */}
      <div className="bg-gradient-to-r from-amber-600 via-amber-500 to-emerald-600 px-4 py-2 text-center text-xs font-black uppercase tracking-wider text-slate-950 shadow-md">
        <span>🏆 Plataforma Hípica Profesional · Sistema de Gestión, Banca Espejo & Contabilidad NIIF en Tiempo Real</span>
      </div>

      {/* ==================================================================== */}
      {/* NAVEGACIÓN PRINCIPAL                                                 */}
      {/* ==================================================================== */}
      <header className="sticky top-0 z-50 border-b border-slate-800/80 bg-[#070b14]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-xl font-black text-slate-950 shadow-lg shadow-amber-500/20">
              🏇
            </span>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-base font-black tracking-wider text-white">SISTEMA HÍPICO</span>
                <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-black uppercase text-emerald-400 border border-emerald-500/30">
                  PRO v2.5
                </span>
              </div>
              <p className="text-[10px] font-semibold text-slate-400">Inversiones Club Sensación, C.A.</p>
            </div>
          </div>

          <nav className="hidden items-center gap-6 lg:flex text-xs font-bold text-slate-300">
            <a href="#modalidades" className="transition hover:text-amber-400">Modalidades</a>
            <a href="#regla-120" className="transition hover:text-amber-400">Marcas 120/100</a>
            <a href="#banca-espejo" className="transition hover:text-amber-400">Banca Espejo (2.5%)</a>
            <a href="#contabilidad" className="transition hover:text-amber-400">Contabilidad NIIF</a>
            <a href="#riesgo" className="transition hover:text-amber-400">Control de Jugadores</a>
            <a href="#faq" className="transition hover:text-amber-400">Preguntas</a>
          </nav>

          <div className="flex items-center gap-2.5">
            <Link
              href="/login"
              className="rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-2 text-xs font-bold text-white transition hover:border-slate-500 hover:bg-slate-800"
            >
              Iniciar Sesión
            </Link>

            <button
              type="button"
              onClick={() => setModalRegistroAbierto(true)}
              className="rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-4 py-2 text-xs font-black text-slate-950 shadow-lg shadow-amber-500/20 transition hover:from-amber-400 hover:to-amber-500 active:scale-95"
            >
              Solicitar Registro
            </button>
          </div>
        </div>
      </header>

      {/* ==================================================================== */}
      {/* HERO SECTION                                                         */}
      {/* ==================================================================== */}
      <section className="relative overflow-hidden px-4 pb-20 pt-16 sm:px-6 lg:pt-24">
        {/* Glow de fondo */}
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 blur-3xl opacity-20">
          <div className="h-96 w-[700px] bg-gradient-to-tr from-amber-500 via-emerald-500 to-indigo-600 rounded-full" />
        </div>

        <div className="relative mx-auto max-w-5xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3.5 py-1 text-xs font-black text-amber-400 shadow-sm backdrop-blur-xs">
            <span>✨</span>
            <span>NUEVA ARQUITECTURA FINANCIERA PARA LA BANCA HÍPICA</span>
          </div>

          <h1 className="mt-6 text-3xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl">
            Control Total de tu Sala Hípica:{" "}
            <span className="bg-gradient-to-r from-amber-400 via-amber-300 to-emerald-400 bg-clip-text text-transparent">
              Tablas Fijas, Marcas, Banca Espejo & NIIF
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-3xl text-sm leading-relaxed text-slate-300 sm:text-base">
            Diseñado especialmente para bancas, grupos y salas de apuestas de alto volumen. Administra
            carreras nacionales e internacionales con liquidación instantánea, balance contable en partida
            doble, cruces de saldos entre jugadores y comisiones del <strong>2.5%</strong> para banqueros asociados.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setModalRegistroAbierto(true)}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 px-6 py-3.5 text-sm font-black text-slate-950 shadow-xl shadow-amber-500/25 transition hover:brightness-110 active:scale-95"
            >
              <span>🚀 Solicitar Registro / Cuenta</span>
            </button>

            <Link
              href="/login"
              className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/90 px-6 py-3.5 text-sm font-bold text-white transition hover:border-slate-500 hover:bg-slate-800"
            >
              <span>🔑 Acceder al Sistema</span>
            </Link>

            <a
              href="https://api.whatsapp.com/send?text=Hola,%20deseo%20m%C3%A1s%20informaci%C3%B3n%20sobre%20la%20plataforma%20de%20Sistema%20H%C3%ADpico"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-5 py-3.5 text-sm font-black text-emerald-400 transition hover:bg-emerald-500/20"
            >
              <span>💬 Contactar por WhatsApp</span>
            </a>
          </div>

          {/* Badges de especificación técnica */}
          <div className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6 text-left">
            {[
              { t: "Tablas 5 Columnas", d: "Vista clásica & impresión", icon: "📋" },
              { t: "Marcas 120 / 100", d: "Ganancia neta 100/120", icon: "🎯" },
              { t: "Banca Espejo 2.5%", d: "Liquidación espejo directa", icon: "👔" },
              { t: "Contabilidad NIIF", d: "Partida doble en tiempo real", icon: "⚖️" },
              { t: "Cruces de Saldo", d: "Entre jugadores con soporte", icon: "🔄" },
              { t: "WhatsApp Bot", d: "Alertas & tickets limpios UTF-8", icon: "📲" },
            ].map((b, i) => (
              <div
                key={i}
                className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 backdrop-blur-xs transition hover:border-amber-500/40"
              >
                <div className="text-xl">{b.icon}</div>
                <div className="mt-1 text-xs font-black text-white">{b.t}</div>
                <div className="text-[10px] text-slate-400">{b.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ==================================================================== */}
      {/* SECCIÓN 1: MODALIDADES HÍPICAS COMPLETAS                            */}
      {/* ==================================================================== */}
      <section id="modalidades" className="border-t border-slate-800 bg-[#090e1c] py-16 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="text-center">
            <span className="text-xs font-black uppercase tracking-wider text-amber-400">Catálogo de Apuestas</span>
            <h2 className="mt-2 text-2xl font-black text-white sm:text-4xl">
              Todas las Modalidades del Hipismo en una Sola Plataforma
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-xs text-slate-400 sm:text-sm">
              Soporte nativo con reglas tradicionales, validaciones automáticas por hipódromo y límites por taquilla.
            </p>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                t: "Tablas Fijas (5 Columnas)",
                d: "Estructura tradicional en 5 columnas por carrera. Control de topes por ejemplar, impresión térmica rápida y liquidación inmediata.",
                badge: "Clásico Hípico",
                icon: "📊",
              },
              {
                t: "Marcas Especiales (120/100)",
                d: "Apuesta de marcas con regla de oro: se juega 120 para ganar 100 netos. Filtro automático de debutantes y caballos NO VALEN (NV).",
                badge: "Regla Oficial",
                icon: "🎯",
              },
              {
                t: "Dupletas & Combinadas",
                d: "Dupletas fijas y cruzadas entre carreras consecutivas o designadas, con multiplicadores transparentes y cálculo automático de cobro.",
                badge: "Alto Rendimiento",
                icon: "🔗",
              },
              {
                t: "Remates en Vivo",
                d: "Módulo dinámico de subasta y remate por ejemplar con adjudicación en vivo, comisión de tabla y cuadre de recaudación por carrera.",
                badge: "Interactividad",
                icon: "🔨",
              },
              {
                t: "WPS (Ganador, Placé, Show)",
                d: "Modalidad internacional completa para hipódromos americanos y locales (La Rinconada, Valencia, Gulfstream, Belmont, etc.).",
                badge: "Internacional",
                icon: "🥇",
              },
              {
                t: "Pollas & Taquilla en Sala",
                d: "Gestión de pollas acumuladas, venta por taquilla física, boletos con código de validación y control de efectivo por cajero.",
                badge: "Presencial & Sala",
                icon: "🎟️",
              },
            ].map((m, idx) => (
              <div
                key={idx}
                className="group relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80 p-6 transition hover:border-amber-500/50 hover:bg-slate-900"
              >
                <div className="flex items-center justify-between">
                  <span className="grid h-12 w-12 place-items-center rounded-xl bg-amber-500/10 text-2xl text-amber-400 border border-amber-500/20">
                    {m.icon}
                  </span>
                  <span className="rounded-full bg-slate-800 px-2.5 py-1 text-[10px] font-black uppercase text-amber-400">
                    {m.badge}
                  </span>
                </div>
                <h3 className="mt-4 text-base font-black text-white group-hover:text-amber-400 transition">
                  {m.t}
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                  {m.d}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ==================================================================== */}
      {/* SECCIÓN 2: MARCAS & CALCULADORA 120/100                              */}
      {/* ==================================================================== */}
      <section id="regla-120" className="border-t border-slate-800 bg-[#070b14] py-16 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="grid gap-12 lg:grid-cols-12 lg:items-center">
            <div className="lg:col-span-7">
              <span className="rounded-md bg-amber-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-amber-400 border border-amber-500/20">
                Regla Oficial de Liquidación
              </span>
              <h2 className="mt-4 text-2xl font-black text-white sm:text-4xl">
                Marcas Hípicas: Regla de 120 para Ganar 100
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">
                En la modalidad de Marcas, la relación matemática de pago es exacta:{" "}
                <strong className="text-amber-400">se juega 120 para ganar 100</strong>. La ganancia neta es{" "}
                <strong className="text-emerald-400">100/120 del monto apostado</strong>, retornando además el
                capital invertido.
              </p>

              <div className="mt-6 space-y-3">
                <div className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
                  <span className="text-lg">🛑</span>
                  <div>
                    <h4 className="text-xs font-black text-white">No Valen Debutantes</h4>
                    <p className="text-[11px] text-slate-400">
                      Los ejemplares debutantes no participan en el cobro a menos que la carrera indique expresamente lo contrario.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
                  <span className="text-lg">📏</span>
                  <div>
                    <h4 className="text-xs font-black text-white">Límite de Ancho de Columna</h4>
                    <p className="text-[11px] text-slate-400">
                      Los mensajes informativos y advertencias de marcas se ajustan al ancho de la columna de NO VALEN para garantizar una lectura limpia y sin cortes.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
                  <span className="text-lg">🚦</span>
                  <div>
                    <h4 className="text-xs font-black text-white">Semáforo de Carreras Dinámico</h4>
                    <p className="text-[11px] text-slate-400">
                      Las carreras solo cambian de color (Verde, Amarillo, Rojo, Gris) cuando se ha seleccionado un hipódromo válido con carreras programadas.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Calculadora Interactiva 120/100 */}
            <div className="lg:col-span-5">
              <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 p-6 shadow-2xl shadow-amber-500/10">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-500 text-slate-950 font-black text-sm">
                      🧮
                    </span>
                    <span className="text-xs font-black uppercase tracking-wider text-white">
                      Calculadora en Vivo (120/100)
                    </span>
                  </div>
                  <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                    Fórmula Oficial
                  </span>
                </div>

                <div className="mt-5 space-y-4">
                  <div>
                    <label className="text-xs font-bold text-slate-300">Monto Jugado ($ / Bs):</label>
                    <div className="mt-1.5 flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        step="10"
                        value={calculadoraMonto}
                        onChange={(e) => setCalculadoraMonto(Math.max(1, Number(e.target.value) || 0))}
                        className="w-full rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2.5 font-mono text-base font-black text-white outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-center text-xs">
                    {[60, 120, 240, 600].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setCalculadoraMonto(v)}
                        className={`rounded-lg border px-2 py-1.5 font-mono font-bold transition ${
                          calculadoraMonto === v
                            ? "border-amber-500 bg-amber-500/20 text-amber-400"
                            : "border-slate-800 bg-slate-800/50 text-slate-400 hover:text-white"
                        }`}
                      >
                        ${v}
                      </button>
                    ))}
                  </div>

                  <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/70 p-4 font-mono text-xs">
                    <div className="flex justify-between text-slate-400">
                      <span>Monto Apostado:</span>
                      <span className="font-bold text-white">${calculadoraMonto.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-emerald-400">
                      <span>Ganancia Neta (100/120):</span>
                      <span className="font-bold">+${gananciaNeta.toFixed(2)}</span>
                    </div>
                    <div className="border-t border-slate-800 pt-2 flex justify-between text-sm font-black text-amber-400">
                      <span>Pago Total al Jugador:</span>
                      <span>${pagoTotal.toFixed(2)}</span>
                    </div>
                  </div>

                  <p className="text-[10px] text-center text-slate-500">
                    * El cobro incluye el reintegro del monto apostado más la ganancia neta liquidada.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ==================================================================== */}
      {/* SECCIÓN 3: BANCA ESPEJO & COMISIÓN DEL 2.5%                          */}
      {/* ==================================================================== */}
      <section id="banca-espejo" className="border-t border-slate-800 bg-[#090e1c] py-16 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="text-center">
            <span className="text-xs font-black uppercase tracking-wider text-emerald-400">
              Red de Cobertura y Rentabilidad
            </span>
            <h2 className="mt-2 text-2xl font-black text-white sm:text-4xl">
              Banca Espejo al 2.5%: Asignación de Banqueros por Jugada
            </h2>
            <p className="mx-auto mt-3 max-w-3xl text-xs text-slate-400 sm:text-sm">
              Conecta múltiples banqueros a tus grupos de venta. Cada banquero asume el riesgo opuesto de las apuestas
              con una comisión fija del <strong>2.5%</strong>, protegiendo la liquidez de la casa central.
            </p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
              <div className="text-3xl">🤝</div>
              <h3 className="mt-3 text-base font-black text-white">Asignación Selectiva por Jugada</h3>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                Asigna banqueros específicos para Tablas, otros para Marcas o Remates. El sistema distribuye los
                tickets automáticamente según la configuración del grupo.
              </p>
            </div>

            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-6">
              <div className="text-3xl">💎</div>
              <h3 className="mt-3 text-base font-black text-emerald-400">2.5% de Comisión Transparente</h3>
              <p className="mt-2 text-xs text-slate-300 leading-relaxed">
                El cálculo de comisiones se realiza de forma estricta y auditable. El banquero liquida sus carreras con
                balance espejo instantáneo.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
              <div className="text-3xl">⚡</div>
              <h3 className="mt-3 text-base font-black text-white">Liquidación Espejo Inmediata</h3>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                Al finalizar la carrera oficial y emitir el resultado, los saldos del banquero y de la taquilla se
                concilian en un solo clic sin descuadres.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ==================================================================== */}
      {/* SECCIÓN 4: CONTABILIDAD NIIF & CRUCES DE SALDO                      */}
      {/* ==================================================================== */}
      <section id="contabilidad" className="border-t border-slate-800 bg-[#070b14] py-16 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="grid gap-12 lg:grid-cols-12 lg:items-center">
            <div className="lg:col-span-6">
              <span className="text-xs font-black uppercase tracking-wider text-amber-400">
                Auditoría Contable Rigurosa
              </span>
              <h2 className="mt-2 text-2xl font-black text-white sm:text-4xl">
                Contabilidad NIIF por Partida Doble en Tiempo Real
              </h2>
              <p className="mt-3 text-sm text-slate-300 leading-relaxed">
                No uses simples sumas y restas. Nuestra plataforma opera con un motor contable bajo estándares
                internacionales NIIF: cada transacción genera su asiento contable estricto con partida y contrapartida.
              </p>

              <div className="mt-6 space-y-4">
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                  <h4 className="text-xs font-black text-white flex items-center gap-2">
                    <span>🔄</span> Cruce Directo entre Jugadores
                  </h4>
                  <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                    Un jugador puede ceder saldo a otro jugador. El operador registra el emisor, receptor, monto y el
                    capture de respaldo, generando de inmediato el débito y crédito correspondiente sin descuadres.
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                  <h4 className="text-xs font-black text-white flex items-center gap-2">
                    <span>📖</span> Libro Mayor y Balance General
                  </h4>
                  <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                    Visualiza en vivo tus Cuentas por Cobrar, Cuentas por Pagar, Ingresos por Jugadas, Gastos por
                    Premios y Comisiones de Banquero con precisión de centavos.
                  </p>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <span className="text-xs font-black uppercase text-amber-400">Simulación Asiento Contable NIIF</span>
                  <span className="font-mono text-[10px] text-slate-500">ID: ASIENTO-78491</span>
                </div>

                <div className="mt-4 space-y-2 text-xs font-mono">
                  <div className="flex justify-between border-b border-slate-800/60 py-1 text-slate-400">
                    <span>Cuenta</span>
                    <span>Debe</span>
                    <span>Haber</span>
                  </div>
                  <div className="flex justify-between text-slate-200">
                    <span>1.1.01 Caja y Banco Taquilla</span>
                    <span className="text-emerald-400">$120.00</span>
                    <span>-</span>
                  </div>
                  <div className="flex justify-between text-slate-200">
                    <span>4.1.02 Ingresos Apuestas Marcas</span>
                    <span>-</span>
                    <span className="text-emerald-400">$120.00</span>
                  </div>
                  <div className="flex justify-between text-slate-400 pt-1 text-[11px] italic">
                    <span>Glosa: Venta ticket Marcas Carrera 5 La Rinconada</span>
                  </div>
                  <div className="border-t border-slate-700 pt-2 flex justify-between font-bold text-amber-400">
                    <span>SUMAS IGUALES:</span>
                    <span>$120.00</span>
                    <span>$120.00</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ==================================================================== */}
      {/* SECCIÓN 5: GESTIÓN DE RIESGO DE JUGADORES                           */}
      {/* ==================================================================== */}
      <section id="riesgo" className="border-t border-slate-800 bg-[#090e1c] py-16 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="text-center">
            <span className="text-xs font-black uppercase tracking-wider text-amber-400">Control de Crédito & Riesgo</span>
            <h2 className="mt-2 text-2xl font-black text-white sm:text-4xl">
              3 Perfiles de Apuesta Estrictos para Jugadores
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-xs text-slate-400 sm:text-sm">
              La plataforma valida en milisegundos si un jugador tiene cupo disponible antes de permitir la emisión de un ticket.
            </p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/10 p-6">
              <div className="flex items-center justify-between">
                <span className="text-2xl">🟢</span>
                <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-black text-emerald-400">
                  ILIMITADO
                </span>
              </div>
              <h3 className="mt-4 text-base font-black text-white">Jugador con Saldo Libre</h3>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                Jugador VIP o de confianza con línea de crédito abierta. No tiene restricciones de monto por carrera,
                sujeto a liquidación periódica.
              </p>
            </div>

            <div className="rounded-2xl border border-amber-500/30 bg-amber-950/10 p-6">
              <div className="flex items-center justify-between">
                <span className="text-2xl">🟡</span>
                <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-black text-amber-400">
                  HASTA EL TOPE
                </span>
              </div>
              <h3 className="mt-4 text-base font-black text-white">Jugador con Aval</h3>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                Garantizado por un tercero o fianza comercial. Solo puede realizar apuestas acumuladas hasta el monto
                máximo de su aval asignado.
              </p>
            </div>

            <div className="rounded-2xl border border-indigo-500/30 bg-indigo-950/10 p-6">
              <div className="flex items-center justify-between">
                <span className="text-2xl">🟣</span>
                <span className="rounded bg-indigo-500/20 px-2 py-0.5 text-[10px] font-black text-indigo-400">
                  PREPAGADO
                </span>
              </div>
              <h3 className="mt-4 text-base font-black text-white">Jugador con Pozo</h3>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                Fondo prepagado en taquilla. Cada jugada descuenta su saldo de pozo de inmediato, impidiendo sobregiros o
                deudas impagas.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ==================================================================== */}
      {/* SECCIÓN 6: PREGUNTAS FRECUENTES (FAQ)                                */}
      {/* ==================================================================== */}
      <section id="faq" className="border-t border-slate-800 bg-[#070b14] py-16 sm:py-24">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <div className="text-center">
            <span className="text-xs font-black uppercase tracking-wider text-amber-400">Preguntas Frecuentes</span>
            <h2 className="mt-2 text-2xl font-black text-white sm:text-3xl">
              Respuestas a las Preguntas más Habituales
            </h2>
          </div>

          <div className="mt-10 space-y-3">
            {faqs.map((f, i) => (
              <div
                key={i}
                className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 transition"
              >
                <button
                  type="button"
                  onClick={() => setFaqAbierto(faqAbierto === i ? null : i)}
                  className="flex w-full items-center justify-between p-4 text-left text-xs font-bold text-white hover:text-amber-400"
                >
                  <span>{f.q}</span>
                  <span className="text-base text-slate-500">{faqAbierto === i ? "−" : "+"}</span>
                </button>
                {faqAbierto === i ? (
                  <div className="border-t border-slate-800/60 p-4 text-xs leading-relaxed text-slate-400">
                    {f.a}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ==================================================================== */}
      {/* BANNER FINAL DE LLAMADO A LA ACCIÓN                                 */}
      {/* ==================================================================== */}
      <section className="relative overflow-hidden border-t border-slate-800 bg-gradient-to-b from-slate-900 via-slate-950 to-black py-16 text-center">
        <div className="relative mx-auto max-w-4xl px-4 sm:px-6">
          <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-black uppercase tracking-wider text-amber-400 border border-amber-500/20">
            ¡Comienza Hoy Mismo!
          </span>
          <h2 className="mt-4 text-3xl font-black text-white sm:text-4xl">
            Moderniza la Operación de tu Banca Hípica
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-xs text-slate-400 sm:text-sm">
            Solicita tu cuenta como Jugador, Banquero Comercial, Operador de Taquilla o Socio de Agencia.
            El administrador revisará y activará tu cuenta de forma inmediata.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setModalRegistroAbierto(true)}
              className="rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-7 py-3.5 text-sm font-black text-slate-950 shadow-xl shadow-amber-500/20 hover:from-amber-400 hover:to-amber-500 active:scale-95 transition"
            >
              ✨ Registrarse / Solicitar Acceso
            </button>

            <Link
              href="/login"
              className="rounded-xl border border-slate-700 bg-slate-900 px-7 py-3.5 text-sm font-bold text-white hover:border-slate-500 hover:bg-slate-800 transition"
            >
              Iniciar Sesión en Plataforma
            </Link>
          </div>
        </div>
      </section>

      {/* ==================================================================== */}
      {/* FOOTER CORPORATIVO                                                  */}
      {/* ==================================================================== */}
      <footer className="border-t border-slate-800/80 bg-black py-8 text-center text-xs text-slate-500">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <p className="font-bold text-slate-400">
            © {new Date().getFullYear()} Inversiones Club Sensación, C.A. · Todos los derechos reservados.
          </p>
          <p className="mt-1 text-[11px] text-slate-600">
            Propiedad Intelectual, Marca y Software Registrado · Diseñado para la gestión transparente de apuestas hípicas.
          </p>
        </div>
      </footer>

      {/* ==================================================================== */}
      {/* MODAL DE REGISTRO INTEGRADO                                         */}
      {/* ==================================================================== */}
      <ModalRegistroUsuario
        abierto={modalRegistroAbierto}
        onCerrar={() => setModalRegistroAbierto(false)}
      />
    </div>
  );
}
