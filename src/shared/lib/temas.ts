/**
 * Sistema Centralizado de Temas Visuales
 * 
 * Temas soportados:
 * - 'oscuro': Dark Betplay / Casino Cripto (Defecto moderno, fondo pizarra oscura con acentos dorados y neón).
 * - 'claro': Claro Diamante (Fondo blanco inmaculado, máxima luminosidad y limpieza).
 * - 'rojo': Rojo Rubí / Pasión Hípica (Acentos carmesí intenso, ideal para carreras y emoción).
 * - 'verde': Verde Esmeralda / Turf Pista (Inspirado en la grama de los hipódromos).
 * - 'azul': Azul Cobalto / Zafiro Real (Azul deportivo de alta elegancia).
 * - 'astigmatismo': Protección Visual Anti-Astigmatismo (Fondo mate cálido sepia-ámbar oscuro,
 *   libre de halos, resplandores y radiación azul excesiva. Contraste óptico balanceado para evitar fatiga).
 */

export type TipoTema = 'oscuro' | 'claro' | 'rojo' | 'verde' | 'azul' | 'astigmatismo';

export interface InfoTema {
  id: TipoTema;
  nombre: string;
  subtitulo: string;
  emoji: string;
  colorMuestra: string;
  colorAcento: string;
  colorBorde: string;
  descripcion: string;
  esProteccionVisual?: boolean;
}

export const TEMAS_DISPONIBLES: InfoTema[] = [
  {
    id: 'oscuro',
    nombre: 'Oscuro Casino',
    subtitulo: 'Estilo Betplay Dark',
    emoji: '🌙',
    colorMuestra: '#0b0f19',
    colorAcento: '#f59e0b',
    colorBorde: '#1e293b',
    descripcion: 'Fondo carbón profundo con destellos dorados y neón hípico.',
  },
  {
    id: 'claro',
    nombre: 'Claro Diamante',
    subtitulo: 'Limpio y luminoso',
    emoji: '☀️',
    colorMuestra: '#f8fafc',
    colorAcento: '#2563eb',
    colorBorde: '#cbd5e1',
    descripcion: 'Luz natural, contraste nítido y legibilidad empresarial.',
  },
  {
    id: 'rojo',
    nombre: 'Rojo Rubí',
    subtitulo: 'Pasión Hípica',
    emoji: '🔴',
    colorMuestra: '#140608',
    colorAcento: '#ef4444',
    colorBorde: '#3b1216',
    descripcion: 'Acentos carmesí vibrantes y adrenalina en cada carrera.',
  },
  {
    id: 'verde',
    nombre: 'Verde Turf',
    subtitulo: 'Pista de Grama',
    emoji: '🟢',
    colorMuestra: '#05180f',
    colorAcento: '#10b981',
    colorBorde: '#0f3825',
    descripcion: 'El verde tradicional del hipódromo y la recta final.',
  },
  {
    id: 'azul',
    nombre: 'Azul Cobalto',
    subtitulo: 'Zafiro Deportivo',
    emoji: '🔵',
    colorMuestra: '#081226',
    colorAcento: '#3b82f6',
    colorBorde: '#172554',
    descripcion: 'Azul real clásico de los grandes sportsbooks mundiales.',
  },
  {
    id: 'astigmatismo',
    nombre: 'Protección Visual',
    subtitulo: 'Anti-Astigmatismo & Halos',
    emoji: '👓',
    colorMuestra: '#1d1914',
    colorAcento: '#d4a373',
    colorBorde: '#4a3e31',
    descripcion: 'Tono sepia-ámbar mate anti-reflejo. Elimina la dispersión de luz, destellos y halos visuales.',
    esProteccionVisual: true,
  },
];

const CLAVE_STORAGE = 'club_tema_visual';

/** Obtiene el tema almacenado o 'oscuro' por defecto */
export function obtenerTemaActual(): TipoTema {
  if (typeof window === 'undefined') return 'oscuro';
  try {
    const guardado = localStorage.getItem(CLAVE_STORAGE) as TipoTema;
    if (guardado && TEMAS_DISPONIBLES.some((t) => t.id === guardado)) {
      return guardado;
    }
  } catch {
    /* ignore */
  }
  return 'oscuro';
}

/** Aplica el tema al elemento raíz html y lo persiste en localStorage */
export function aplicarTemaAlDocumento(tema: TipoTema): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CLAVE_STORAGE, tema);
    document.documentElement.setAttribute('data-theme', tema);
    
    // Si es modo claro, remover clase 'dark' si existiese
    if (tema === 'claro') {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light-theme');
    } else {
      document.documentElement.classList.remove('light-theme');
      document.documentElement.classList.add('dark');
    }

    // Notificar a todos los listeners reactivos en la ventana
    window.dispatchEvent(
      new CustomEvent('cambio_tema_visual', { detail: { tema } })
    );
  } catch {
    /* ignore */
  }
}
