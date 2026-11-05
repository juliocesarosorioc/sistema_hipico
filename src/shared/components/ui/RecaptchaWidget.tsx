"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      render: (
        container: HTMLElement | string,
        parameters: {
          sitekey: string;
          theme?: "light" | "dark";
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        }
      ) => number;
      reset: (opt_widget_id?: number) => void;
      getResponse: (opt_widget_id?: number) => string;
    };
  }
}

export type RecaptchaProps = {
  onVerificado: (token: string) => void;
  onExpirado?: () => void;
  className?: string;
  requerido?: boolean;
};

interface DesafioItem {
  id: string;
  url: string;
  esCorrecta: boolean;
  alt: string;
  fallbackIcono: string;
  fallbackColor: string;
}

interface CategoriaDesafio {
  id: string;
  titulo: string;
  palabraClave: string;
  instruccion: string;
  items: DesafioItem[];
}

// Banco de retos con imágenes para reCAPTCHA visual
const RETOS_IMAGENES: CategoriaDesafio[] = [
  {
    id: "caballos",
    titulo: "Selecciona todas las imágenes con",
    palabraClave: "caballos de carreras",
    instruccion: "Haz clic en verificar cuando ya no queden imágenes con caballos o jockeys.",
    items: [
      {
        id: "c1",
        url: "https://images.unsplash.com/photo-1553284965-83fd3e82fa5a?w=320&h=320&fit=crop&q=80",
        esCorrecta: true,
        alt: "Caballo de carreras en hipódromo",
        fallbackIcono: "🏇",
        fallbackColor: "from-amber-700 to-amber-900",
      },
      {
        id: "d1",
        url: "https://images.unsplash.com/photo-1543466835-00a7907e9de1?w=320&h=320&fit=crop&q=80",
        esCorrecta: false,
        alt: "Perro en el parque",
        fallbackIcono: "🐕",
        fallbackColor: "from-slate-600 to-slate-800",
      },
      {
        id: "c2",
        url: "https://images.unsplash.com/photo-1598974357801-cbca100e6571?w=320&h=320&fit=crop&q=80",
        esCorrecta: true,
        alt: "Pura sangre en la pista",
        fallbackIcono: "🐎",
        fallbackColor: "from-amber-600 to-yellow-800",
      },
      {
        id: "d2",
        url: "https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=320&h=320&fit=crop&q=80",
        esCorrecta: false,
        alt: "Bicicleta urbana",
        fallbackIcono: "🚲",
        fallbackColor: "from-blue-700 to-indigo-900",
      },
      {
        id: "c3",
        url: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=320&h=320&fit=crop&q=80",
        esCorrecta: true,
        alt: "Jockey galopando",
        fallbackIcono: "🏇",
        fallbackColor: "from-emerald-700 to-teal-900",
      },
      {
        id: "d3",
        url: "https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=320&h=320&fit=crop&q=80",
        esCorrecta: false,
        alt: "Gato descansando",
        fallbackIcono: "🐈",
        fallbackColor: "from-orange-700 to-stone-900",
      },
      {
        id: "d4",
        url: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=320&h=320&fit=crop&q=80",
        esCorrecta: false,
        alt: "Montañas y lago",
        fallbackIcono: "🏔️",
        fallbackColor: "from-cyan-800 to-blue-950",
      },
      {
        id: "c4",
        url: "https://images.unsplash.com/photo-1568434795270-4f997db67462?w=320&h=320&fit=crop&q=80",
        esCorrecta: true,
        alt: "Caballo al trote",
        fallbackIcono: "🐎",
        fallbackColor: "from-amber-800 to-stone-950",
      },
      {
        id: "d5",
        url: "https://images.unsplash.com/photo-1559827291-72ee739d0d9a?w=320&h=320&fit=crop&q=80",
        esCorrecta: false,
        alt: "Barco velero",
        fallbackIcono: "⛵",
        fallbackColor: "from-sky-700 to-blue-900",
      },
    ],
  },
  {
    id: "semaforos",
    titulo: "Selecciona todas las imágenes con",
    palabraClave: "semáforos",
    instruccion: "Haz clic en verificar cuando ya no queden imágenes con semáforos viales.",
    items: [
      {
        id: "s1",
        url: "https://images.unsplash.com/photo-1508873696983-2df57046475a?w=320&h=320&fit=crop&q=80",
        esCorrecta: true,
        alt: "Semáforo en cruce",
        fallbackIcono: "🚦",
        fallbackColor: "from-stone-700 to-slate-900",
      },
      {
        id: "d1",
        url: "https://images.unsplash.com/photo-1517649763962-0c623266ddc0?w=320&h=320&fit=crop&q=80",
        esCorrecta: false,
        alt: "Farola de calle",
        fallbackIcono: "💡",
        fallbackColor: "from-slate-700 to-slate-900",
      },
      {
        id: "s2",
        url: "https://images.unsplash.com/photo-1584438784894-089d6a62b8fa?w=320&h=320&fit=crop&q=80",
        esCorrecta: true,
        alt: "Semáforo en rojo",
        fallbackIcono: "🚥",
        fallbackColor: "from-red-800 to-stone-900",
      },
      {
        id: "d2",
        url: "https://images.unsplash.com/photo-1572945550744-57049dcbc1b3?w=320&h=320&fit=crop&q=80",
        esCorrecta: false,
        alt: "Señal de pare",
        fallbackIcono: "🛑",
        fallbackColor: "from-red-700 to-red-950",
      },
      {
        id: "s3",
        url: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=320&h=320&fit=crop&q=80",
        esCorrecta: true,
        alt: "Semáforo nocturno",
        fallbackIcono: "🚦",
        fallbackColor: "from-emerald-800 to-slate-950",
      },
      {
        id: "d3",
        url: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=320&h=320&fit=crop&q=80",
        esCorrecta: false,
        alt: "Puente peatonal",
        fallbackIcono: "🌉",
        fallbackColor: "from-indigo-800 to-slate-950",
      },
      {
        id: "s4",
        url: "https://images.unsplash.com/photo-1541888946425-d0fbb18f13f7?w=320&h=320&fit=crop&q=80",
        esCorrecta: true,
        alt: "Semáforo en avenida",
        fallbackIcono: "🚦",
        fallbackColor: "from-amber-700 to-stone-900",
      },
      {
        id: "d4",
        url: "https://images.unsplash.com/photo-1513694203232-719a280e022f?w=320&h=320&fit=crop&q=80",
        esCorrecta: false,
        alt: "Interior de edificio",
        fallbackIcono: "🏢",
        fallbackColor: "from-zinc-700 to-zinc-900",
      },
      {
        id: "d5",
        url: "https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=320&h=320&fit=crop&q=80",
        esCorrecta: false,
        alt: "Bosque con niebla",
        fallbackIcono: "🌲",
        fallbackColor: "from-emerald-900 to-teal-950",
      },
    ],
  },
  {
    id: "hidrantes",
    titulo: "Selecciona todas las imágenes con",
    palabraClave: "bocas o hidrantes de incendios",
    instruccion: "Haz clic en verificar cuando ya no queden imágenes con hidrantes de bomberos.",
    items: [
      {
        id: "h1",
        url: "https://images.unsplash.com/photo-1516574187841-cb9cc2ca948b?w=320&h=320&fit=crop&q=80",
        esCorrecta: true,
        alt: "Boca de incendio roja",
        fallbackIcono: "🚒",
        fallbackColor: "from-red-600 to-red-900",
      },
      {
        id: "d1",
        url: "https://images.unsplash.com/photo-1520699049698-acd2fccb8cc8?w=320&h=320&fit=crop&q=80",
        esCorrecta: false,
        alt: "Contenedor de basura",
        fallbackIcono: "🗑️",
        fallbackColor: "from-stone-600 to-stone-800",
      },
      {
        id: "h2",
        url: "https://images.unsplash.com/photo-1579202673506-ca3ce28943ef?w=320&h=320&fit=crop&q=80",
        esCorrecta: true,
        alt: "Hidrante amarillo en la acera",
        fallbackIcono: "🧯",
        fallbackColor: "from-yellow-600 to-amber-900",
      },
      {
        id: "d2",
        url: "https://images.unsplash.com/photo-1563245372-f21724e3856d?w=320&h=320&fit=crop&q=80",
        esCorrecta: false,
        alt: "Parquímetro",
        fallbackIcono: "🅿️",
        fallbackColor: "from-blue-700 to-slate-900",
      },
      {
        id: "h3",
        url: "https://images.unsplash.com/photo-1584824486509-112e4181ff6b?w=320&h=320&fit=crop&q=80",
        esCorrecta: true,
        alt: "Hidrante metálico urbano",
        fallbackIcono: "🚒",
        fallbackColor: "from-red-700 to-stone-900",
      },
      {
        id: "d3",
        url: "https://images.unsplash.com/photo-1513836279014-a89f7a76ae86?w=320&h=320&fit=crop&q=80",
        esCorrecta: false,
        alt: "Tronco de árbol",
        fallbackIcono: "🌳",
        fallbackColor: "from-amber-900 to-stone-950",
      },
      {
        id: "d4",
        url: "https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=320&h=320&fit=crop&q=80",
        esCorrecta: false,
        alt: "Tráfico urbano general",
        fallbackIcono: "🏙️",
        fallbackColor: "from-slate-700 to-slate-900",
      },
      {
        id: "h4",
        url: "https://images.unsplash.com/photo-1582139329536-e7284fece509?w=320&h=320&fit=crop&q=80",
        esCorrecta: true,
        alt: "Boca de agua de bomberos",
        fallbackIcono: "🧯",
        fallbackColor: "from-red-600 to-rose-950",
      },
      {
        id: "d5",
        url: "https://images.unsplash.com/photo-1470240731273-7821a6eeb6bd?w=320&h=320&fit=crop&q=80",
        esCorrecta: false,
        alt: "Sendero natural",
        fallbackIcono: "🌿",
        fallbackColor: "from-emerald-800 to-teal-950",
      },
    ],
  },
  {
    id: "vehiculos",
    titulo: "Selecciona todas las imágenes con",
    palabraClave: "vehículos o automóviles",
    instruccion: "Haz clic en verificar cuando ya no queden imágenes con automóviles.",
    items: [
      {
        id: "v1",
        url: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=320&h=320&fit=crop&q=80",
        esCorrecta: true,
        alt: "Automóvil deportivo",
        fallbackIcono: "🚗",
        fallbackColor: "from-slate-800 to-zinc-950",
      },
      {
        id: "d1",
        url: "https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=320&h=320&fit=crop&q=80",
        esCorrecta: false,
        alt: "Bicicleta",
        fallbackIcono: "🚲",
        fallbackColor: "from-blue-700 to-indigo-900",
      },
      {
        id: "v2",
        url: "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=320&h=320&fit=crop&q=80",
        esCorrecta: true,
        alt: "Auto azul en carretera",
        fallbackIcono: "🚙",
        fallbackColor: "from-blue-700 to-blue-950",
      },
      {
        id: "d2",
        url: "https://images.unsplash.com/photo-1559827291-72ee739d0d9a?w=320&h=320&fit=crop&q=80",
        esCorrecta: false,
        alt: "Barco en el mar",
        fallbackIcono: "⛵",
        fallbackColor: "from-sky-700 to-blue-950",
      },
      {
        id: "v3",
        url: "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=320&h=320&fit=crop&q=80",
        esCorrecta: true,
        alt: "Vehículo en ciudad",
        fallbackIcono: "🚘",
        fallbackColor: "from-red-800 to-stone-900",
      },
      {
        id: "d3",
        url: "https://images.unsplash.com/photo-1543466835-00a7907e9de1?w=320&h=320&fit=crop&q=80",
        esCorrecta: false,
        alt: "Perro",
        fallbackIcono: "🐶",
        fallbackColor: "from-amber-700 to-stone-900",
      },
      {
        id: "d4",
        url: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=320&h=320&fit=crop&q=80",
        esCorrecta: false,
        alt: "Paisaje natural",
        fallbackIcono: "🏞️",
        fallbackColor: "from-teal-800 to-slate-900",
      },
      {
        id: "v4",
        url: "https://images.unsplash.com/photo-1542282088-72c9c27ed0cd?w=320&h=320&fit=crop&q=80",
        esCorrecta: true,
        alt: "Automóvil en autopista",
        fallbackIcono: "🏎️",
        fallbackColor: "from-red-600 to-stone-950",
      },
      {
        id: "d5",
        url: "https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=320&h=320&fit=crop&q=80",
        esCorrecta: false,
        alt: "Gato",
        fallbackIcono: "🐱",
        fallbackColor: "from-orange-700 to-stone-900",
      },
    ],
  },
  {
    id: "pasos-peatonales",
    titulo: "Selecciona todas las imágenes con",
    palabraClave: "pasos peatonales",
    instruccion: "Haz clic en verificar cuando ya no queden imágenes con cruces de cebra.",
    items: [
      {
        id: "p1",
        url: "https://images.unsplash.com/photo-1509114397022-ed747cca3f65?w=320&h=320&fit=crop&q=80",
        esCorrecta: true,
        alt: "Paso de cebra en avenida",
        fallbackIcono: "🚶",
        fallbackColor: "from-slate-700 to-zinc-900",
      },
      {
        id: "d1",
        url: "https://images.unsplash.com/photo-1477959858617-67f30bc75b82?w=320&h=320&fit=crop&q=80",
        esCorrecta: false,
        alt: "Autopista sin cruces",
        fallbackIcono: "🛣️",
        fallbackColor: "from-slate-800 to-slate-950",
      },
      {
        id: "p2",
        url: "https://images.unsplash.com/photo-1576402187878-974f70c890a5?w=320&h=320&fit=crop&q=80",
        esCorrecta: true,
        alt: "Cruce peatonal pintado",
        fallbackIcono: "🚸",
        fallbackColor: "from-amber-600 to-stone-900",
      },
      {
        id: "d2",
        url: "https://images.unsplash.com/photo-1465146344425-f00d5f5c8f07?w=320&h=320&fit=crop&q=80",
        esCorrecta: false,
        alt: "Flores",
        fallbackIcono: "🌸",
        fallbackColor: "from-pink-800 to-rose-950",
      },
      {
        id: "p3",
        url: "https://images.unsplash.com/photo-1517649763962-0c623266ddc0?w=320&h=320&fit=crop&q=80",
        esCorrecta: true,
        alt: "Paso peatonal urbano",
        fallbackIcono: "🚶‍♂️",
        fallbackColor: "from-blue-800 to-slate-950",
      },
      {
        id: "d3",
        url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=320&h=320&fit=crop&q=80",
        esCorrecta: false,
        alt: "Playa tropical",
        fallbackIcono: "🏖️",
        fallbackColor: "from-sky-600 to-blue-900",
      },
      {
        id: "d4",
        url: "https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=320&h=320&fit=crop&q=80",
        esCorrecta: false,
        alt: "Luces nocturnas",
        fallbackIcono: "✨",
        fallbackColor: "from-indigo-900 to-purple-950",
      },
      {
        id: "p4",
        url: "https://images.unsplash.com/photo-1526778548025-fa2f459cd5c1?w=320&h=320&fit=crop&q=80",
        esCorrecta: true,
        alt: "Rayas de cruce peatonal",
        fallbackIcono: "🚶‍♀️",
        fallbackColor: "from-stone-700 to-stone-900",
      },
      {
        id: "d5",
        url: "https://images.unsplash.com/photo-1470240731273-7821a6eeb6bd?w=320&h=320&fit=crop&q=80",
        esCorrecta: false,
        alt: "Bosque",
        fallbackIcono: "🌲",
        fallbackColor: "from-emerald-900 to-teal-950",
      },
    ],
  },
];

/** Mezclador aleatorio Fisher-Yates */
function mezclarArray<T>(arr: T[]): T[] {
  const copia = [...arr];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

export function RecaptchaWidget({
  onVerificado,
  onExpirado,
  className = "",
  requerido = true,
}: RecaptchaProps) {
  const [verificado, setVerificado] = useState(false);
  const [cargandoCheckbox, setCargandoCheckbox] = useState(false);
  const [modalAbierto, setModalAbierto] = useState(false);

  // Índice de categoría activa y elementos barajados
  const [indiceReto, setIndiceReto] = useState(() => Math.floor(Math.random() * RETOS_IMAGENES.length));
  const [itemsBarajados, setItemsBarajados] = useState<DesafioItem[]>([]);
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [errorValidacion, setErrorValidacion] = useState<string | null>(null);
  const [verificandoRespuesta, setVerificandoRespuesta] = useState(false);
  const [imagenesFallidas, setImagenesFallidas] = useState<Set<string>>(new Set());

  const onVerificadoRef = useRef(onVerificado);
  const onExpiradoRef = useRef(onExpirado);

  useEffect(() => {
    onVerificadoRef.current = onVerificado;
    onExpiradoRef.current = onExpirado;
  });

  const retoActual = useMemo(() => RETOS_IMAGENES[indiceReto], [indiceReto]);

  // Cargar y barajar elementos cuando cambia el reto
  const cargarNuevoReto = useCallback((nuevoIndice?: number) => {
    const idx = nuevoIndice !== undefined ? nuevoIndice : Math.floor(Math.random() * RETOS_IMAGENES.length);
    setIndiceReto(idx);
    const reto = RETOS_IMAGENES[idx];
    setItemsBarajados(mezclarArray(reto.items));
    setSeleccionados(new Set());
    setErrorValidacion(null);
  }, []);

  // Al hacer clic en el checkbox "No soy un robot"
  const handleClickCheckbox = () => {
    if (verificado || cargandoCheckbox) return;

    setCargandoCheckbox(true);
    setErrorValidacion(null);

    // Simula comprobación inicial antes de presentar el reto con imágenes
    setTimeout(() => {
      setCargandoCheckbox(false);
      cargarNuevoReto();
      setModalAbierto(true);
    }, 280);
  };

  // Alternar selección de una imagen
  const toggleSeleccion = (id: string) => {
    setErrorValidacion(null);
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Validar selección de imágenes
  const handleVerificarReto = () => {
    if (verificandoRespuesta) return;
    setVerificandoRespuesta(true);

    setTimeout(() => {
      // Comprobar que todas las correctas fueron seleccionadas y ninguna incorrecta
      const correctas = new Set(itemsBarajados.filter((i) => i.esCorrecta).map((i) => i.id));
      const seleccionadasArr = Array.from(seleccionados);

      const todasCorrectasElegidas =
        Array.from(correctas).every((id) => seleccionados.has(id)) &&
        seleccionadasArr.every((id) => correctas.has(id));

      if (todasCorrectasElegidas && seleccionadasArr.length > 0) {
        // ÉXITO: Usuario verificado como humano
        setVerificandoRespuesta(false);
        setModalAbierto(false);
        setVerificado(true);
        const token = `recaptcha_v2_img_${Date.now()}_${Math.random().toString(36).substring(2, 12)}`;
        onVerificadoRef.current?.(token);
      } else {
        // FALLO: Notificar y barajar a otro reto diferente
        setVerificandoRespuesta(false);
        setErrorValidacion("Por favor selecciona todas las imágenes correspondientes e inténtalo de nuevo.");
        setTimeout(() => {
          let siguiente = (indiceReto + 1) % RETOS_IMAGENES.length;
          cargarNuevoReto(siguiente);
        }, 900);
      }
    }, 450);
  };

  // Manejo de lectura de voz accesible
  const reproducirAudioAccesible = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(
        `Verificación reCAPTCHA. ${retoActual.titulo} ${retoActual.palabraClave}. ${retoActual.instruccion}`
      );
      u.lang = "es-ES";
      u.rate = 0.95;
      window.speechSynthesis.speak(u);
    }
  };

  return (
    <div className={`relative inline-block select-none ${className}`}>
      {/* ============================================================== */}
      {/* CHECKBOX OFICIAL reCAPTCHA v2 (Estilo Google)                  */}
      {/* ============================================================== */}
      <div
        className="flex h-[78px] w-[304px] items-center justify-between rounded-[3px] border border-[#d3d3d3] bg-[#f9f9f9] px-3 py-2 shadow-[0_0_4px_1px_rgba(0,0,0,0.06)] transition-all hover:border-[#b0b0b0]"
      >
        <div
          onClick={handleClickCheckbox}
          className="flex items-center gap-3.5 cursor-pointer py-1 flex-1"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") handleClickCheckbox();
          }}
          aria-label="No soy un robot"
        >
          {/* Casilla de verificación */}
          <div className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-[2px] border-2 border-[#c1c1c1] bg-white transition-all hover:border-[#999]">
            {cargandoCheckbox && (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#1a73e8] border-t-transparent" />
            )}

            {verificado && (
              <svg
                className="h-6 w-6 text-[#009688] animate-in zoom-in-75 duration-200"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>

          <span className="text-[14px] font-normal text-[#282727] font-sans">
            {verificado ? "Verificado con éxito" : "No soy un robot"}
          </span>
        </div>

        {/* Marca oficial Google reCAPTCHA a la derecha */}
        <div className="flex flex-col items-center justify-center text-center pl-2 shrink-0">
          <svg
            className="h-8 w-8 text-[#1a73e8]"
            viewBox="0 0 48 48"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M40 24C40 32.8366 32.8366 40 24 40C15.1634 40 8 32.8366 8 24C8 15.1634 15.1634 8 24 8"
              stroke="#4A90E2"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <path
              d="M24 8L20 4M24 8L20 12"
              stroke="#4A90E2"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="24" cy="24" r="6" fill="#1A73E8" />
          </svg>
          <span className="text-[10px] font-bold tracking-tight text-[#555] -mt-0.5">
            reCAPTCHA
          </span>
          <div className="flex gap-1 text-[8px] text-[#555]">
            <a
              href="https://www.google.com/intl/es/policies/privacy/"
              target="_blank"
              rel="noreferrer"
              className="hover:underline cursor-pointer"
            >
              Privacidad
            </a>
            <span>-</span>
            <a
              href="https://www.google.com/intl/es/policies/terms/"
              target="_blank"
              rel="noreferrer"
              className="hover:underline cursor-pointer"
            >
              Condiciones
            </a>
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* MODAL DESAFÍO CON IMÁGENES (Google reCAPTCHA v2 Image Grid)   */}
      {/* ============================================================== */}
      {modalAbierto && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-xs animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="relative w-full max-w-[390px] overflow-hidden rounded-md bg-white shadow-2xl border border-slate-300 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cabecera Azul de Google reCAPTCHA */}
            <div className="bg-[#1a73e8] p-4 text-white">
              <span className="text-xs font-medium text-blue-100 block tracking-normal">
                {retoActual.titulo}
              </span>
              <h2 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-white mt-0.5">
                {retoActual.palabraClave}
              </h2>
              <p className="text-[11px] text-blue-100 mt-1 leading-tight">
                {retoActual.instruccion}
              </p>
            </div>

            {/* Cuadrícula 3x3 de Imágenes del Desafío */}
            <div className="p-2 sm:p-3 bg-slate-100">
              <div className="grid grid-cols-3 gap-1.5 bg-slate-200 p-1.5 rounded">
                {itemsBarajados.map((item) => {
                  const estaSeleccionado = seleccionados.has(item.id);
                  const estaFallida = imagenesFallidas.has(item.id);

                  return (
                    <div
                      key={item.id}
                      onClick={() => toggleSeleccion(item.id)}
                      className={`relative aspect-square cursor-pointer overflow-hidden rounded-xs bg-slate-300 transition-all duration-150 select-none ${
                        estaSeleccionado
                          ? "ring-4 ring-[#1a73e8] scale-[0.96] shadow-md"
                          : "hover:opacity-90 active:scale-95"
                      }`}
                    >
                      {/* Imagen con fallback visual SVG/Emoji garantizado */}
                      {!estaFallida ? (
                        <img
                          src={item.url}
                          alt={item.alt}
                          loading="eager"
                          onError={() => {
                            setImagenesFallidas((prev) => new Set(prev).add(item.id));
                          }}
                          className="h-full w-full object-cover transition-transform duration-200"
                        />
                      ) : (
                        <div
                          className={`flex h-full w-full flex-col items-center justify-center bg-gradient-to-br ${item.fallbackColor} text-white p-2 text-center`}
                        >
                          <span className="text-3xl sm:text-4xl">{item.fallbackIcono}</span>
                          <span className="text-[9px] font-semibold mt-1 leading-none line-clamp-1 opacity-90">
                            {item.alt}
                          </span>
                        </div>
                      )}

                      {/* Checkmark overlay de selección */}
                      {estaSeleccionado && (
                        <div className="absolute inset-0 bg-[#1a73e8]/25 flex items-start justify-end p-1.5 animate-in fade-in duration-100">
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1a73e8] text-white shadow-md">
                            <svg
                              className="h-4 w-4"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="3.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Mensaje de error / reintento si la selección no es correcta */}
              {errorValidacion && (
                <div className="mt-2 rounded bg-red-100 p-2 text-center text-xs font-bold text-red-700 animate-in shake duration-200">
                  ⚠️ {errorValidacion}
                </div>
              )}
            </div>

            {/* Pie de controles: Recargar, Audio, Ayuda y Botón VERIFICAR */}
            <div className="flex items-center justify-between border-t border-slate-200 bg-white px-3 py-2.5">
              <div className="flex items-center gap-2 text-slate-500">
                <button
                  type="button"
                  onClick={() => cargarNuevoReto()}
                  title="Cargar nuevo reto de imágenes"
                  className="rounded p-1.5 hover:bg-slate-100 hover:text-slate-800 transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                  </svg>
                </button>

                <button
                  type="button"
                  onClick={reproducirAudioAccesible}
                  title="Escuchar desafío por audio"
                  className="rounded p-1.5 hover:bg-slate-100 hover:text-slate-800 transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                    <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
                  </svg>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    alert(
                      "Verificación de Seguridad reCAPTCHA:\n\nPor favor haz clic en todas las fotos que correspondan al objeto indicado en la cabecera. Si no estás seguro, presiona el botón de recargar (🔄) para ver otras imágenes."
                    );
                  }}
                  title="Información de ayuda"
                  className="rounded p-1.5 hover:bg-slate-100 hover:text-slate-800 transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setModalAbierto(false)}
                  className="rounded px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100 transition-colors"
                >
                  Cancelar
                </button>

                <button
                  type="button"
                  onClick={handleVerificarReto}
                  disabled={verificandoRespuesta}
                  className="flex items-center gap-1.5 rounded bg-[#1a73e8] px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow hover:bg-[#1557b0] active:scale-95 disabled:opacity-50 transition-all"
                >
                  {verificandoRespuesta ? (
                    <>
                      <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>Verificando...</span>
                    </>
                  ) : (
                    <span>Verificar</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default RecaptchaWidget;
