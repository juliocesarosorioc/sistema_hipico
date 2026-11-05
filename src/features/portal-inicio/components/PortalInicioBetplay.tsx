"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTema } from "@/shared/hooks/useTema";
import { SelectorTemas } from "@/shared/components/ui/SelectorTemas";
import { ModalLoginRapido } from "@/features/auth/components/ModalLoginRapido";
import { ModalRegistroUsuario } from "@/features/auth/components/ModalRegistroUsuario";
import { useAuthStore } from "@/shared/store/useAuthStore";

interface SlideBanner {
  id: number;
  tag: string;
  tagColor: string;
  titulo: string;
  subtitulo: string;
  descripcion: string;
  botonTexto: string;
  accion: "registro" | "login" | "carreras" | "promocion";
  imagen: string;
  gradiente: string;
}

const BANNERS: SlideBanner[] = [
  {
    id: 1,
    tag: "🏇 EN DIRECTO · FIN DE SEMANA",
    tagColor: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    titulo: "GRAN CLÁSICO HÍPICO NACIONAL E INTERNACIONAL",
    subtitulo: "La Rinconada · Gulfstream Park · Belmont Park",
    descripcion:
      "La mayor emoción de las carreras de caballos con Tablas Fijas, Marcas Ganadoras y Remates en vivo. Liquidación inmediata al cruzar la meta.",
    botonTexto: "JUGAR AHORA · EN VIVO",
    accion: "carreras",
    imagen: "🏇",
    gradiente: "from-amber-950/80 via-slate-950 to-slate-950",
  },
  {
    id: 2,
    tag: "🎁 OFERTA EXCLUSIVA PARA GRUPOS Y BANCAS",
    tagColor: "bg-purple-500/20 text-purple-300 border-purple-500/40",
    titulo: "REGISTRA TU SALA Y OBTÉN 2 SEMANAS DE PRUEBA GRATIS",
    subtitulo: "14 Días con Acceso Total sin Costo",
    descripcion:
      "Gestiona tus carreras, imprime tablas de apuestas, liquida con balance NIIF y administra banqueros sin pagar mensualidad inicial.",
    botonTexto: "ACTIVAR PRUEBA DE 2 SEMANAS",
    accion: "registro",
    imagen: "🎁",
    gradiente: "from-purple-950/80 via-slate-950 to-slate-950",
  },
  {
    id: 3,
    tag: "🎯 MÁXIMO RENDIMIENTO",
    tagColor: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    titulo: "MARCAS HÍPICAS: JUEGA 120 PARA GANAR 100",
    subtitulo: "Cálculo Neto Transparente · Sin Comisiones Ocultas",
    descripcion:
      "Gana 100 netos por cada 120 apostados en las mejores marcas seleccionadas de la jornada. Aplica a todas las válidas y clásicos.",
    botonTexto: "VER MARCAS DE HOY",
    accion: "login",
    imagen: "🎯",
    gradiente: "from-emerald-950/80 via-slate-950 to-slate-950",
  },
  {
    id: 4,
    tag: "🛡️ GARANTÍA DE JUEGO JUSTO",
    tagColor: "bg-blue-500/20 text-blue-300 border-blue-500/40",
    titulo: "SEGURO AUTOMÁTICO ANTE RETIROS Y REHABILITACIÓN",
    subtitulo: "Tu Dinero Siempre Protegido",
    descripcion:
      "Si un ejemplar es retirado, tu jugada se reembolsa al instante. Si se reactiva por error administrativo, tus tickets se rehabilitan automáticamente.",
    botonTexto: "CONOCER MÁS",
    accion: "promocion",
    imagen: "🛡️",
    gradiente: "from-blue-950/80 via-slate-950 to-slate-950",
  },
];

const PROXIMAS_CARRERAS = [
  {
    hipodromo: "La Rinconada (VEN)",
    carrera: "Carrera 4 · 1.400m",
    hora: "En 12 min",
    enVivo: true,
    favorito: "2 - El Gran Mario",
    dividendo: "2.40",
    pista: "Arena",
  },
  {
    hipodromo: "Gulfstream Park (USA)",
    carrera: "Carrera 7 · 1.600m",
    hora: "En 28 min",
    enVivo: true,
    favorito: "5 - Fast Runner",
    dividendo: "1.85",
    pista: "Grama",
  },
  {
    hipodromo: "La Rinconada (VEN)",
    carrera: "Carrera 5 (1ª Válida)",
    hora: "En 45 min",
    enVivo: false,
    favorito: "4 - Princesa Sofía",
    dividendo: "3.10",
    pista: "Arena",
  },
  {
    hipodromo: "Valencia (VEN)",
    carrera: "Carrera 2 · 1.200m",
    hora: "En 1h 15m",
    enVivo: false,
    favorito: "1 - Rey de Oro",
    dividendo: "2.10",
    pista: "Arena",
  },
];

const PREGUNTAS_FRECUENTES = [
  {
    pregunta: "¿Cómo funciona la Prueba Gratuita por 2 Semanas para mi Grupo o Sala?",
    respuesta:
      "Cualquier dueño de centro hípico, sala de remates o banquero puede solicitar una prueba completa de 14 días haciendo clic en 'Registrarse' y marcando la casilla de Prueba Gratuita. Tendrás acceso inmediato al software de gestión, tablas fijas, marcas, remates y módulo contable con soporte prioritario 24/7 sin ningún compromiso de permanencia.",
  },
  {
    pregunta: "¿Cómo se calculan las Marcas Hípicas (120 para ganar 100)?",
    respuesta:
      "Se juega un monto base de 120 para obtener una ganancia neta de 100 (la ganancia neta es equivalente a 100/120 del monto apostado). Si juegas $120 y tu ejemplar resulta ganador, recibes tus $120 de vuelta más $100 de premio neto (total $220).",
  },
  {
    pregunta: "¿Qué sucede si un caballo es retirado o si se retira por error y se reactiva?",
    respuesta:
      "Nuestro sistema cuenta con un motor automático de gestión de retiros: cuando un ejemplar es retirado, todas las jugadas asociadas se anulan y el saldo es devuelto inmediatamente a la cuenta del cliente. Si el ejemplar fue retirado por error y el juez lo rehabilita, el sistema reactiva automáticamente los tickets y recalcula el saldo contable sin intervención manual.",
  },
  {
    pregunta: "¿Qué métodos de pago y recarga están disponibles?",
    respuesta:
      "Aceptamos Pago Móvil nacional (todas las entidades bancarias), transferencias bancarias directas, Zelle y criptomonedas (USDT por red TRC20/BEP20) para depósitos y retiros rápidos.",
  },
  {
    pregunta: "¿Puedo jugar desde mi teléfono móvil o computadora?",
    respuesta:
      "Sí. Toda la plataforma está diseñada con tecnología web de última generación (Responsive Design) adaptada a teléfonos Android, iPhone, tablets y computadoras de escritorio sin necesidad de descargar apps pesadas.",
  },
];

export function PortalInicioBetplay() {
  const { tema, infoActual } = useTema();
  const usuario = useAuthStore((s) => s.usuario);
  const perfiles = useAuthStore((s) => s.perfiles);

  const [slideActivo, setSlideActivo] = useState(0);
  const [modalLoginAbierto, setModalLoginAbierto] = useState(false);
  const [modalRegistroAbierto, setModalRegistroAbierto] = useState(false);
  const [faqAbierto, setFaqAbierto] = useState<number | null>(0);
  const [terminosAbiertos, setTerminosAbiertos] = useState(false);

  // Auto-play del carrusel de banners
  useEffect(() => {
    const timer = setInterval(() => {
      setSlideActivo((prev) => (prev + 1) % BANNERS.length);
    }, 5500);
    return () => clearInterval(timer);
  }, []);

  const slide = BANNERS[slideActivo];

  const handleAccionBanner = (accion: SlideBanner["accion"]) => {
    if (accion === "registro") {
      setModalRegistroAbierto(true);
    } else if (accion === "login") {
      setModalLoginAbierto(true);
    } else if (accion === "carreras") {
      if (usuario) {
        window.location.href = "/inicio";
      } else {
        setModalLoginAbierto(true);
      }
    } else {
      const el = document.getElementById("promociones");
      if (el) el.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <div
      className={`min-h-screen text-slate-100 transition-colors duration-300 ${
        tema === "claro"
          ? "bg-slate-100 text-slate-900"
          : tema === "rojo"
          ? "bg-[#0d0507] text-white"
          : tema === "verde"
          ? "bg-[#04120a] text-white"
          : tema === "azul"
          ? "bg-[#060e1d] text-white"
          : tema === "astigmatismo"
          ? "bg-[#1c1813] text-[#f5ede1]"
          : "bg-[#090d16] text-white"
      }`}
    >
      {/* =========================================================================
          1. HEADER / NAVBAR ESTILO BETPLAY
          ========================================================================= */}
      <header
        className={`sticky top-0 z-50 border-b backdrop-blur-xl transition-colors ${
          tema === "claro"
            ? "border-slate-300/80 bg-white/90 text-slate-900"
            : tema === "astigmatismo"
            ? "border-[#4a3e31] bg-[#1d1914]/95 text-[#f5ede1]"
            : "border-slate-800/80 bg-slate-950/90 text-white"
        }`}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          {/* Logo y Marca */}
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 via-amber-600 to-amber-700 text-xl font-black text-slate-950 shadow-lg shadow-amber-500/20 group-hover:scale-105 transition-transform">
                🏇
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5 leading-none">
                  <span className="font-black text-base tracking-wider uppercase">
                    SISTEMA HÍPICO
                  </span>
                  <span className="rounded bg-amber-500/20 px-1 py-0.2 text-[9px] font-black tracking-widest text-amber-400 border border-amber-500/30">
                    OFICIAL
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 font-medium tracking-tight">
                  Sistema Hípico Oficial
                </span>
              </div>
            </Link>

            {/* Navegación Desktop */}
            <nav className="hidden lg:flex items-center gap-5 text-xs font-bold text-slate-300">
              <a href="#carreras" className="hover:text-amber-400 transition">
                🏇 Carreras en Vivo
              </a>
              <a href="#modalidades" className="hover:text-amber-400 transition">
                📊 Modalidades (Tablas / Marcas)
              </a>
              <a href="#promociones" className="hover:text-amber-400 transition">
                🎁 Promociones
              </a>
              <a href="#noticias" className="hover:text-amber-400 transition">
                📰 Noticias
              </a>
              <a href="#afiliados" className="hover:text-amber-400 transition">
                🤝 Afiliados & Bancas
              </a>
              <a href="#faq" className="hover:text-amber-400 transition">
                ❓ FAQ
              </a>
            </nav>
          </div>

          {/* Selector de Temas + Acciones de Autenticación */}
          <div className="flex items-center gap-2.5">
            {/* Selector de Tema */}
            <SelectorTemas />

            {/* Botones de Acceso */}
            {usuario ? (
              <Link
                href="/inicio"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 px-3.5 py-2 text-xs font-black uppercase text-slate-950 shadow-md hover:brightness-110 active:scale-95 transition"
              >
                <span>👤 Mi Panel</span>
                <span className="hidden sm:inline">({usuario})</span>
              </Link>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setModalLoginAbierto(true)}
                  className="rounded-xl border border-slate-700 bg-slate-900/80 px-3.5 py-2 text-xs font-bold text-slate-200 hover:border-slate-500 hover:bg-slate-800 transition shadow-xs"
                >
                  Iniciar Sesión
                </button>
                <button
                  type="button"
                  onClick={() => setModalRegistroAbierto(true)}
                  className="rounded-xl bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 px-3.5 py-2 text-xs font-black uppercase tracking-wider text-slate-950 shadow-md shadow-amber-500/20 hover:brightness-110 active:scale-95 transition"
                >
                  <span className="hidden sm:inline">🎁 Registro · </span>Prueba 2 Semanas
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* =========================================================================
          2. HERO SECTION / CARRUSEL DE BANNERS ESTILO BETPLAY
          ========================================================================= */}
      <section className="relative overflow-hidden border-b border-slate-800/60">
        <div
          className={`relative min-h-[460px] sm:min-h-[500px] flex items-center bg-gradient-to-r ${slide.gradiente} transition-all duration-700 px-4 sm:px-8 py-12`}
        >
          {/* Elementos decorativos de fondo */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(245,158,11,0.15),transparent_60%)] pointer-events-none" />
          <div className="absolute -bottom-10 right-4 sm:right-20 text-[140px] sm:text-[220px] opacity-15 select-none pointer-events-none">
            {slide.imagen}
          </div>

          <div className="relative mx-auto max-w-7xl w-full">
            <div className="max-w-2xl space-y-4">
              {/* Badge Tag */}
              <div className="inline-flex items-center gap-2">
                <span
                  className={`rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-widest backdrop-blur-md shadow-xs ${slide.tagColor}`}
                >
                  {slide.tag}
                </span>
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
              </div>

              {/* Título y Subtítulo */}
              <h1 className="text-3xl sm:text-5xl font-black uppercase tracking-tight text-white leading-none drop-shadow-md">
                {slide.titulo}
              </h1>

              <p className="text-base sm:text-lg font-bold text-amber-300">
                {slide.subtitulo}
              </p>

              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-xl">
                {slide.descripcion}
              </p>

              {/* Botón CTA Principal */}
              <div className="pt-2 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleAccionBanner(slide.accion)}
                  className="rounded-2xl bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 px-6 py-3.5 text-xs sm:text-sm font-black uppercase tracking-wider text-slate-950 shadow-xl shadow-amber-500/25 hover:brightness-110 active:scale-95 transition"
                >
                  ⚡ {slide.botonTexto}
                </button>

                <button
                  type="button"
                  onClick={() => setModalRegistroAbierto(true)}
                  className="rounded-2xl border border-slate-700 bg-slate-900/60 backdrop-blur-md px-5 py-3.5 text-xs sm:text-sm font-bold text-slate-200 hover:bg-slate-800 transition"
                >
                  🎁 Solicitar Afiliación
                </button>
              </div>
            </div>
          </div>

          {/* Flechas de navegación del Carrusel */}
          <button
            type="button"
            onClick={() =>
              setSlideActivo((prev) => (prev - 1 + BANNERS.length) % BANNERS.length)
            }
            aria-label="Banner anterior"
            className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/70 backdrop-blur-sm transition border border-white/10"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setSlideActivo((prev) => (prev + 1) % BANNERS.length)}
            aria-label="Banner siguiente"
            className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/70 backdrop-blur-sm transition border border-white/10"
          >
            ›
          </button>

          {/* Indicadores de diapositiva (Dots) */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2">
            {BANNERS.map((b, idx) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setSlideActivo(idx)}
                className={`h-2 rounded-full transition-all ${
                  idx === slideActivo
                    ? "w-8 bg-amber-400"
                    : "w-2 bg-slate-600 hover:bg-slate-400"
                }`}
                aria-label={`Ir al banner ${idx + 1}`}
              />
            ))}
          </div>
        </div>
      </section>

      {/* =========================================================================
          3. TICKER DE CARRERAS EN VIVO (LIVE RACING STRIP)
          ========================================================================= */}
      <section
        id="carreras"
        className={`border-b px-4 py-4 transition-colors ${
          tema === "claro"
            ? "border-slate-300 bg-slate-200/60"
            : "border-slate-800/80 bg-slate-950/80"
        }`}
      >
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
              </span>
              <span className="text-xs font-black uppercase tracking-wider text-slate-300">
                Pizarra Hípica en Vivo · Próximas Salidas
              </span>
            </div>
            <button
              type="button"
              onClick={() => (usuario ? (window.location.href = "/apuestas") : setModalLoginAbierto(true))}
              className="text-xs font-bold text-amber-400 hover:underline inline-flex items-center gap-1"
            >
              Ver todas las carreras →
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {PROXIMAS_CARRERAS.map((c, i) => (
              <div
                key={i}
                className="group relative overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/70 p-3.5 hover:border-amber-500/40 hover:bg-slate-900 transition-all shadow-sm cursor-pointer"
                onClick={() => (usuario ? (window.location.href = "/apuestas") : setModalLoginAbierto(true))}
              >
                <div className="flex items-center justify-between text-[11px] mb-1.5">
                  <span className="font-bold text-slate-400 truncate max-w-[150px]">
                    {c.hipodromo}
                  </span>
                  <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-black text-amber-300 border border-amber-500/30">
                    ⏱️ {c.hora}
                  </span>
                </div>
                <div className="font-black text-xs text-white group-hover:text-amber-300 transition-colors">
                  {c.carrera}
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] border-t border-slate-800 pt-2">
                  <span className="text-slate-400 truncate max-w-[130px]">
                    Fav: <b className="text-slate-200">{c.favorito}</b>
                  </span>
                  <span className="font-black text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                    {c.dividendo}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* =========================================================================
          4. LOBBY DE MODALIDADES HÍPICAS (LO QUE ESTÁ CREADO EN EL SISTEMA)
          ========================================================================= */}
      <section id="modalidades" className="py-16 px-4 sm:px-6 mx-auto max-w-7xl">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-black uppercase text-amber-400 mb-3">
            🏇 Especialistas en Hipismo
          </div>
          <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tight text-white">
            Modalidades de Apuesta Hípica
          </h2>
          <p className="mt-2 text-xs sm:text-sm text-slate-400">
            Todas las modalidades del sistema con cálculo automático de dividendos, soporte para banqueros y liquidación instantánea.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* 1. Tablas Fijas */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 flex flex-col justify-between hover:border-amber-500/50 hover:shadow-xl hover:shadow-amber-500/10 transition group">
            <div>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/20 text-3xl mb-4 group-hover:scale-110 transition-transform">
                📋
              </div>
              <h3 className="text-lg font-black uppercase text-white group-hover:text-amber-300 transition">
                Tablas Fijas Hípicas
              </h3>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                Juega a número con cuota garantizada. Matriz completa de ejemplares por carrera, hipódromo y bloqueo automático al partir la carrera.
              </p>
            </div>
            <button
              type="button"
              onClick={() => (usuario ? (window.location.href = "/tablas") : setModalLoginAbierto(true))}
              className="mt-6 w-full rounded-xl border border-amber-500/40 bg-amber-500/10 py-2.5 text-xs font-black uppercase text-amber-300 hover:bg-amber-500 hover:text-slate-950 transition"
            >
              Jugar Tablas →
            </button>
          </div>

          {/* 2. Marcas Hípicas */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 flex flex-col justify-between hover:border-emerald-500/50 hover:shadow-xl hover:shadow-emerald-500/10 transition group">
            <div>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/20 text-3xl mb-4 group-hover:scale-110 transition-transform">
                🎯
              </div>
              <h3 className="text-lg font-black uppercase text-white group-hover:text-emerald-300 transition">
                Marcas (120 para 100)
              </h3>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                Juega 120 para ganar 100 netos. Las marcas y datos oficiales de la jornada con pago exacto y liquidación transparente.
              </p>
            </div>
            <button
              type="button"
              onClick={() => (usuario ? (window.location.href = "/apuestas") : setModalLoginAbierto(true))}
              className="mt-6 w-full rounded-xl border border-emerald-500/40 bg-emerald-500/10 py-2.5 text-xs font-black uppercase text-emerald-300 hover:bg-emerald-500 hover:text-slate-950 transition"
            >
              Jugar Marcas →
            </button>
          </div>

          {/* 3. Remates en Vivo */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 flex flex-col justify-between hover:border-purple-500/50 hover:shadow-xl hover:shadow-purple-500/10 transition group">
            <div>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-500/20 text-3xl mb-4 group-hover:scale-110 transition-transform">
                🔨
              </div>
              <h3 className="text-lg font-black uppercase text-white group-hover:text-purple-300 transition">
                Remates en Directo
              </h3>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                Subasta ejemplar por ejemplar. Potes acumulados, cálculo de comisiones para la casa y pago inmediato al ganador oficial.
              </p>
            </div>
            <button
              type="button"
              onClick={() => (usuario ? (window.location.href = "/remates") : setModalLoginAbierto(true))}
              className="mt-6 w-full rounded-xl border border-purple-500/40 bg-purple-500/10 py-2.5 text-xs font-black uppercase text-purple-300 hover:bg-purple-500 hover:text-slate-950 transition"
            >
              Entrar al Remate →
            </button>
          </div>

          {/* 4. Pareos y Combinadas */}
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 flex flex-col justify-between hover:border-blue-500/50 hover:shadow-xl hover:shadow-blue-500/10 transition group">
            <div>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/20 text-3xl mb-4 group-hover:scale-110 transition-transform">
                ⚡
              </div>
              <h3 className="text-lg font-black uppercase text-white group-hover:text-blue-300 transition">
                Pareos & Dobles
              </h3>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                Cruza dos o más ejemplares para multiplicar tus ganancias. Si un ejemplar es retirado, el seguro automático protege tu inversión.
              </p>
            </div>
            <button
              type="button"
              onClick={() => (usuario ? (window.location.href = "/apuestas") : setModalLoginAbierto(true))}
              className="mt-6 w-full rounded-xl border border-blue-500/40 bg-blue-500/10 py-2.5 text-xs font-black uppercase text-blue-300 hover:bg-blue-500 hover:text-slate-950 transition"
            >
              Ver Pareos →
            </button>
          </div>
        </div>
      </section>

      {/* =========================================================================
          5. SECCIÓN DE PROMOCIONES
          ========================================================================= */}
      <section
        id="promociones"
        className={`py-16 px-4 sm:px-6 border-y transition-colors ${
          tema === "claro"
            ? "border-slate-300 bg-slate-200/40"
            : "border-slate-800/80 bg-slate-950/60"
        }`}
      >
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-10">
            <div>
              <span className="text-xs font-black uppercase tracking-wider text-amber-400">
                🎁 Beneficios Exclusivos
              </span>
              <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tight text-white mt-1">
                Promociones Destacadas
              </h2>
            </div>
            <p className="mt-2 md:mt-0 text-xs sm:text-sm text-slate-400 max-w-md">
              Aprovecha nuestras ofertas para jugadores y dueños de salas hípicas.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Promo 1 */}
            <div className="relative overflow-hidden rounded-3xl border border-purple-500/40 bg-gradient-to-br from-purple-950/40 via-slate-900 to-slate-950 p-6 shadow-xl">
              <span className="inline-block rounded-full bg-purple-500/20 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-purple-300 border border-purple-500/30 mb-3">
                ⭐ Más Solicitada
              </span>
              <h3 className="text-xl font-black text-white">
                Prueba 2 Semanas Gratis
              </h3>
              <p className="mt-2 text-xs text-slate-300 leading-relaxed">
                Para nuevos grupos, bancas y centros hípicos. Opera todas las carreras durante 14 días sin pagar comisión de plataforma.
              </p>
              <div className="mt-6 pt-4 border-t border-purple-500/20 flex items-center justify-between">
                <span className="text-xs font-bold text-purple-300">Cero Costo Inicial</span>
                <button
                  type="button"
                  onClick={() => setModalRegistroAbierto(true)}
                  className="rounded-xl bg-purple-600 hover:bg-purple-500 px-4 py-2 text-xs font-black uppercase text-white shadow-md transition"
                >
                  Solicitar →
                </button>
              </div>
            </div>

            {/* Promo 2 */}
            <div className="relative overflow-hidden rounded-3xl border border-amber-500/40 bg-gradient-to-br from-amber-950/40 via-slate-900 to-slate-950 p-6 shadow-xl">
              <span className="inline-block rounded-full bg-amber-500/20 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-amber-300 border border-amber-500/30 mb-3">
                🛡️ Seguro Total
              </span>
              <h3 className="text-xl font-black text-white">
                Reembolso 100% por Retiro
              </h3>
              <p className="mt-2 text-xs text-slate-300 leading-relaxed">
                Si tu caballo no corre, tu dinero regresa a tu cuenta en segundos. Y si el retiro fue un error y se reactiva, tu jugada vuelve a estar viva.
              </p>
              <div className="mt-6 pt-4 border-t border-amber-500/20 flex items-center justify-between">
                <span className="text-xs font-bold text-amber-300">Automático</span>
                <button
                  type="button"
                  onClick={() => setModalLoginAbierto(true)}
                  className="rounded-xl bg-amber-500 hover:bg-amber-400 px-4 py-2 text-xs font-black uppercase text-slate-950 shadow-md transition"
                >
                  Ver Reglas →
                </button>
              </div>
            </div>

            {/* Promo 3 */}
            <div className="relative overflow-hidden rounded-3xl border border-emerald-500/40 bg-gradient-to-br from-emerald-950/40 via-slate-900 to-slate-950 p-6 shadow-xl">
              <span className="inline-block rounded-full bg-emerald-500/20 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-300 border border-emerald-500/30 mb-3">
                💎 Comisión Preferencial
              </span>
              <h3 className="text-xl font-black text-white">
                Plan para Banqueros Hípicos
              </h3>
              <p className="mt-2 text-xs text-slate-300 leading-relaxed">
                Maneja tus propios banqueros por modalidad. Asigna límites de crédito, supervisa cajeros y audita las ganancias en tiempo real.
              </p>
              <div className="mt-6 pt-4 border-t border-emerald-500/20 flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-300">Soporte VIP</span>
                <button
                  type="button"
                  onClick={() => setModalRegistroAbierto(true)}
                  className="rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-xs font-black uppercase text-white shadow-md transition"
                >
                  Afiliarse →
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          6. SECCIÓN DE NOTICIAS & PRONÓSTICOS HÍPICOS
          ========================================================================= */}
      <section id="noticias" className="py-16 px-4 sm:px-6 mx-auto max-w-7xl">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-10">
          <div>
            <span className="text-xs font-black uppercase tracking-wider text-amber-400">
              📰 Actualidad del Turf
            </span>
            <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tight text-white mt-1">
              Noticias & Datos de Carreras
            </h2>
          </div>
          <span className="text-xs text-slate-400 mt-2 md:mt-0">
            Retrospectos oficiales, análisis de jinetes y reportes de pista
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 overflow-hidden hover:border-slate-700 transition">
            <div className="h-44 bg-gradient-to-br from-amber-800/40 via-slate-800 to-slate-950 flex items-center justify-center text-5xl">
              🏆
            </div>
            <div className="p-5">
              <span className="text-[10px] font-bold text-amber-400 uppercase">
                La Rinconada · Clásico
              </span>
              <h3 className="font-black text-base text-white mt-1">
                Análisis de los favoritos para la jornada de este domingo
              </h3>
              <p className="mt-2 text-xs text-slate-400 line-clamp-3">
                Conoce las condiciones de pista y los mejores aprontes registrados en los 1.600 metros de la prueba principal.
              </p>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 overflow-hidden hover:border-slate-700 transition">
            <div className="h-44 bg-gradient-to-br from-blue-800/40 via-slate-800 to-slate-950 flex items-center justify-center text-5xl">
              🏇
            </div>
            <div className="p-5">
              <span className="text-[10px] font-bold text-blue-400 uppercase">
                Internacional · Gulfstream Park
              </span>
              <h3 className="font-black text-base text-white mt-1">
                La grama de Hallandale Beach promete dividendos atractivos
              </h3>
              <p className="mt-2 text-xs text-slate-400 line-clamp-3">
                Revisión de los jinetes con mejor efectividad en tiros cortos y los debutantes de mayor proyección.
              </p>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900/60 overflow-hidden hover:border-slate-700 transition">
            <div className="h-44 bg-gradient-to-br from-emerald-800/40 via-slate-800 to-slate-950 flex items-center justify-center text-5xl">
              ⚡
            </div>
            <div className="p-5">
              <span className="text-[10px] font-bold text-emerald-400 uppercase">
                Tecnología Hípica
              </span>
              <h3 className="font-black text-base text-white mt-1">
                Reactivación automática de tickets: seguridad y justicia
              </h3>
              <p className="mt-2 text-xs text-slate-400 line-clamp-3">
                Explicación técnica de cómo el sistema rehabilita las apuestas cuando un juez corrige un retiro accidental.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          7. SECCIÓN DE AFILIADOS & CENTROS HÍPICOS
          ========================================================================= */}
      <section
        id="afiliados"
        className={`py-16 px-4 sm:px-6 border-y transition-colors ${
          tema === "claro"
            ? "border-slate-300 bg-white"
            : "border-slate-800/80 bg-slate-950/80"
        }`}
      >
        <div className="mx-auto max-w-7xl">
          <div className="rounded-3xl border border-amber-500/30 bg-gradient-to-r from-slate-900 via-amber-950/30 to-slate-900 p-8 sm:p-12 relative overflow-hidden">
            <div className="max-w-2xl space-y-4">
              <span className="inline-block rounded-full bg-amber-500/20 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-amber-300 border border-amber-500/30">
                🤝 Red de Socios & Afiliados
              </span>
              <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tight text-white">
                ¿Tienes una Sala, Agencia o Centro Hípico?
              </h2>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                Únete a la plataforma tecnológica más avanzada del hipismo. Te entregamos un panel completo para emitir tickets, configurar banqueros, imprimir tablas para la pared, liquidar carreras y cobrar tus ganancias con total seguridad contable.
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-2">
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
                  <div className="font-black text-amber-400 text-lg">100%</div>
                  <div className="text-[10px] text-slate-400">Automatizado NIIF</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3">
                  <div className="font-black text-emerald-400 text-lg">2 Semanas</div>
                  <div className="text-[10px] text-slate-400">Prueba Sin Costo</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3 col-span-2 sm:col-span-1">
                  <div className="font-black text-blue-400 text-lg">24/7</div>
                  <div className="text-[10px] text-slate-400">Soporte por WhatsApp</div>
                </div>
              </div>

              <div className="pt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setModalRegistroAbierto(true)}
                  className="rounded-2xl bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 px-6 py-3 text-xs font-black uppercase tracking-wider text-slate-950 shadow-lg hover:brightness-110 active:scale-95 transition"
                >
                  🚀 Iniciar Mi Prueba Gratuita
                </button>
                <a
                  href="https://wa.me/584120000000?text=Hola,%20deseo%20afiliar%20mi%20sala%20h%C3%ADpica%20a%20la%20plataforma"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-5 py-3 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 transition inline-flex items-center gap-1.5"
                >
                  <span>💬</span> Contactar Asesor VIP
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          8. SECCIÓN SOBRE NOSOTROS
          ========================================================================= */}
      <section id="nosotros" className="py-16 px-4 sm:px-6 mx-auto max-w-7xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
          <div>
            <span className="text-xs font-black uppercase tracking-wider text-amber-400">
              ℹ️ Sobre Nosotros
            </span>
            <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tight text-white mt-1">
              Tecnología de Punta al Servicio del Hipismo
            </h2>
            <p className="mt-4 text-xs sm:text-sm text-slate-300 leading-relaxed">
              Somos la plataforma líder en digitalización hípica. Diseñada por expertos en apuestas hípicas y programadores de clase mundial, nuestro sistema elimina el margen de error humano en las liquidaciones, garantizando pagos exactos y trazabilidad en cada ticket emitido.
            </p>
            <div className="mt-6 space-y-3 text-xs text-slate-300">
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 font-bold">✓</span>
                <span>Cálculo automático de premios en Tablas Fijas, Marcas y Remates.</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 font-bold">✓</span>
                <span>Servidores de ultra-alta velocidad con protección anti-ataques.</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 font-bold">✓</span>
                <span>Compatibilidad móvil instantánea desde cualquier navegador.</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 text-center">
              <div className="text-3xl mb-2">⚡</div>
              <div className="text-2xl font-black text-amber-400">&lt; 3 seg</div>
              <div className="text-xs text-slate-400 mt-1">Liquidación de carrera</div>
            </div>
            <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 text-center">
              <div className="text-3xl mb-2">🔒</div>
              <div className="text-2xl font-black text-emerald-400">100%</div>
              <div className="text-xs text-slate-400 mt-1">Seguridad en Fondos</div>
            </div>
            <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 text-center">
              <div className="text-3xl mb-2">🏆</div>
              <div className="text-2xl font-black text-purple-400">+50.000</div>
              <div className="text-xs text-slate-400 mt-1">Tickets procesados</div>
            </div>
            <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 text-center">
              <div className="text-3xl mb-2">📱</div>
              <div className="text-2xl font-black text-blue-400">24 / 7</div>
              <div className="text-xs text-slate-400 mt-1">Disponibilidad total</div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          9. PREGUNTAS FRECUENTES (FAQ INTERACTIVO)
          ========================================================================= */}
      <section
        id="faq"
        className={`py-16 px-4 sm:px-6 border-t transition-colors ${
          tema === "claro"
            ? "border-slate-300 bg-slate-200/50"
            : "border-slate-800/80 bg-slate-950/60"
        }`}
      >
        <div className="mx-auto max-w-4xl">
          <div className="text-center mb-10">
            <span className="text-xs font-black uppercase tracking-wider text-amber-400">
              ❓ Respuestas Claras
            </span>
            <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tight text-white mt-1">
              Preguntas Frecuentes
            </h2>
          </div>

          <div className="space-y-3">
            {PREGUNTAS_FRECUENTES.map((f, idx) => {
              const abierto = faqAbierto === idx;
              return (
                <div
                  key={idx}
                  className="rounded-2xl border border-slate-800 bg-slate-900/80 overflow-hidden transition shadow-xs"
                >
                  <button
                    type="button"
                    onClick={() => setFaqAbierto(abierto ? null : idx)}
                    className="w-full flex items-center justify-between p-4 sm:p-5 text-left font-bold text-xs sm:text-sm text-white hover:text-amber-400 transition"
                  >
                    <span>{f.pregunta}</span>
                    <span className="text-amber-400 text-lg ml-2">{abierto ? "−" : "+"}</span>
                  </button>
                  {abierto && (
                    <div className="px-4 pb-5 sm:px-5 text-xs text-slate-300 leading-relaxed border-t border-slate-800/60 pt-3">
                      {f.respuesta}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* =========================================================================
          10. TÉRMINOS Y CONDICIONES (MODAL O SECCIÓN COLAPSABLE)
          ========================================================================= */}
      <section className="py-8 px-4 text-center border-t border-slate-800/60">
        <div className="mx-auto max-w-3xl flex flex-wrap items-center justify-center gap-4 text-xs text-slate-400 font-medium">
          <button
            type="button"
            onClick={() => setTerminosAbiertos((v) => !v)}
            className="hover:text-amber-400 transition underline underline-offset-4"
          >
            📜 Ver Términos y Condiciones del Servicio
          </button>
          <span>·</span>
          <span>🛡️ Juego Responsable (+18)</span>
          <span>·</span>
          <span>🔒 Política de Privacidad de Datos</span>
        </div>

        {terminosAbiertos && (
          <div className="mt-4 mx-auto max-w-3xl rounded-2xl border border-slate-800 bg-slate-950 p-5 text-left text-[11px] text-slate-400 space-y-2 animate-fadeIn">
            <h4 className="font-bold text-amber-400 text-xs uppercase">
              Términos del Servicio Hípico & Reglas de Liquidación
            </h4>
            <p>
              1. <b>Validez de Carreras:</b> Todas las jugadas se liquidan con base en los resultados oficiales emitidos por los jueces de la carrera en el hipódromo correspondiente.
            </p>
            <p>
              2. <b>Retiros de Ejemplares:</b> Si un ejemplar es retirado antes de la partida, la jugada directa se reembolsa íntegramente. Si un ejemplar es reactivado por error en taquilla antes de la partida, los tickets retornan a estado activo.
            </p>
            <p>
              3. <b>Marcas:</b> Aplica la regla estándar hípica: se juega 120 para ganar 100 netos. No valen debutantes a menos que se indique explícitamente en la hoja de la carrera.
            </p>
            <p>
              4. <b>Mayoría de Edad:</b> El acceso al portal está estrictamente restringido a mayores de 18 años. Juega con responsabilidad.
            </p>
          </div>
        )}
      </section>

      {/* =========================================================================
          11. FOOTER CORPORATIVO ESTILO BETPLAY
          ========================================================================= */}
      <footer
        className={`border-t py-12 px-4 sm:px-6 transition-colors ${
          tema === "claro"
            ? "border-slate-300 bg-slate-200 text-slate-800"
            : "border-slate-800 bg-slate-950 text-slate-400"
        }`}
      >
        <div className="mx-auto max-w-7xl">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            {/* Columna 1: Marca y descripción */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🏇</span>
                <span className="font-black text-base text-white tracking-wider">
                  SISTEMA HÍPICO
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Plataforma tecnológica de gestión y apuestas hípicas en tiempo real. Tablas Fijas, Marcas 120/100 y Remates en vivo.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-slate-800 text-xs font-bold text-amber-400">
                  18+
                </span>
                <span className="text-[11px] text-slate-500 font-semibold">
                  Juego Responsable y Seguro
                </span>
              </div>
            </div>

            {/* Columna 2: Modalidades */}
            <div>
              <h4 className="font-black text-xs uppercase tracking-wider text-slate-200 mb-3">
                Modalidades Hípicas
              </h4>
              <ul className="space-y-2 text-xs">
                <li>
                  <a href="#modalidades" className="hover:text-amber-400 transition">
                    Tablas Fijas por Carrera
                  </a>
                </li>
                <li>
                  <a href="#modalidades" className="hover:text-amber-400 transition">
                    Marcas Ganadoras (120/100)
                  </a>
                </li>
                <li>
                  <a href="#modalidades" className="hover:text-amber-400 transition">
                    Remates de Ejemplares en Directo
                  </a>
                </li>
                <li>
                  <a href="#modalidades" className="hover:text-amber-400 transition">
                    Pareos & Dobles
                  </a>
                </li>
              </ul>
            </div>

            {/* Columna 3: Información y Soporte */}
            <div>
              <h4 className="font-black text-xs uppercase tracking-wider text-slate-200 mb-3">
                Enlaces Rápidos
              </h4>
              <ul className="space-y-2 text-xs">
                <li>
                  <button
                    type="button"
                    onClick={() => setModalRegistroAbierto(true)}
                    className="hover:text-amber-400 transition"
                  >
                    🎁 Prueba 2 Semanas Gratis
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => setModalLoginAbierto(true)}
                    className="hover:text-amber-400 transition"
                  >
                    🔐 Acceso al Sistema
                  </button>
                </li>
                <li>
                  <a href="#faq" className="hover:text-amber-400 transition">
                    Preguntas Frecuentes
                  </a>
                </li>
                <li>
                  <a href="#afiliados" className="hover:text-amber-400 transition">
                    Programa de Afiliados
                  </a>
                </li>
              </ul>
            </div>

            {/* Columna 4: Métodos de Pago */}
            <div>
              <h4 className="font-black text-xs uppercase tracking-wider text-slate-200 mb-3">
                Métodos de Pago
              </h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-center text-[11px] font-bold text-slate-300">
                  📱 Pago Móvil
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-center text-[11px] font-bold text-slate-300">
                  💵 Zelle
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-center text-[11px] font-bold text-slate-300">
                  🪙 USDT / Cripto
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-center text-[11px] font-bold text-slate-300">
                  🏛️ Bancos Directos
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-800 pt-6 flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-500 gap-2">
            <div>
              © {new Date().getFullYear()} SISTEMA HÍPICO · Todos los derechos reservados.
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span>Servidores y Liquidación en Línea</span>
            </div>
          </div>
        </div>
      </footer>

      {/* =========================================================================
          12. MODALES INTEGRADOS (LOGIN RÁPIDO & REGISTRO CON PRUEBA DE 2 SEMANAS)
          ========================================================================= */}
      <ModalLoginRapido
        abierto={modalLoginAbierto}
        onCerrar={() => setModalLoginAbierto(false)}
        onAbrirRegistro={() => setModalRegistroAbierto(true)}
      />

      <ModalRegistroUsuario
        abierto={modalRegistroAbierto}
        onCerrar={() => setModalRegistroAbierto(false)}
        onRegistroExitoso={() => {
          setModalRegistroAbierto(false);
          setModalLoginAbierto(true);
        }}
      />
    </div>
  );
}
