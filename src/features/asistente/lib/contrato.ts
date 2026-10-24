import {
  MODULOS_ESQUEMA,
  PUERTAS,
  rutaPermitida,
} from "@/features/seguridad/lib/capacidades";

export type RutaAsistente = { ruta: string; nombre: string };

export type CarreraAsistente = {
  hipodromo: string;
  fecha: string;
  carrera: number;
  distancia: string | null;
  superficie: string | null;
  ejemplares: Array<{ numero: string; nombre: string; retirado: boolean }>;
};

const ETIQUETAS_RUTA: Record<string, string> = {
  "/": "Inicio de sesión",
  "/dashboard": "Escritorio",
  "/inicio": "Inicio",
  "/carreras": "Carreras del Día",
  "/gestion-jugadas": "Gestión de Jugadas",
  "/jugadas": "Monitor de Jugadas",
  "/tablas-fijas": "Tablas Fijas",
  "/taquilla": "Taquilla",
  "/clientes": "Clientes y Saldos",
  "/grupos": "Grupos",
  "/ejemplares": "Ejemplares y Gaceta IA",
  "/inteligencia-hipica/proyecciones": "Inteligencia Hípica · Proyecciones",
  "/contabilidad": "Contabilidad",
  "/contabilidad/caja": "Caja",
  "/contabilidad/bancos": "Bancos",
  "/contabilidad/ingresos": "Ingresos",
  "/contabilidad/monedas": "Monedas",
  "/saldos-reportes": "Saldos y Reportes",
  "/reporte-diario": "Reporte Diario",
  "/seguridad": "Seguridad",
  "/portal": "Portal del Jugador",
};

const ETIQUETAS_MAESTRO = new Map(
  MODULOS_ESQUEMA.flatMap((modulo) =>
    modulo.capacidades.flatMap((capacidad) =>
      capacidad.ruta ? [[capacidad.ruta, capacidad.titulo] as const] : []
    )
  )
);

export function rutasDisponiblesPara(permisos: Iterable<string>): RutaAsistente[] {
  const set = new Set(permisos);
  return PUERTAS.filter((puerta) => !puerta.publica && rutaPermitida(puerta.ruta, set)).map(
    (puerta) => ({
      ruta: puerta.ruta,
      nombre: ETIQUETAS_RUTA[puerta.ruta] ?? ETIQUETAS_MAESTRO.get(puerta.ruta) ?? puerta.ruta,
    })
  );
}

export function rutaSugeridaAutorizada(
  sugerida: unknown,
  rutas: RutaAsistente[]
): string | null {
  if (typeof sugerida !== "string") return null;
  return rutas.some((ruta) => ruta.ruta === sugerida) ? sugerida : null;
}

export function esConsultaDeCarreras(texto: string): boolean {
  return /\b(carrera|carreras|hip[oó]dromo|programa|ejemplar|caballo|gaceta|pron[oó]stico|proyecci[oó]n)\b/i.test(
    texto
  );
}

export function fechaSolicitada(texto: string, hoy: string): string {
  const fecha = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(texto)?.[1];
  if (!fecha) return hoy;
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const validada = new Date(Date.UTC(anio, mes - 1, dia));
  return validada.getUTCFullYear() === anio &&
    validada.getUTCMonth() === mes - 1 &&
    validada.getUTCDate() === dia
    ? fecha
    : hoy;
}

export function resumirCarreras(
  carreras: Array<{
    hipodromo: string;
    fecha: string;
    carrera: number | string;
    distancia?: string | null;
    superficie?: string | null;
    caballos?: Array<{ numero?: string | number; nombre?: string | null; retirado?: boolean }>;
  }>
): CarreraAsistente[] {
  return carreras.slice(0, 30).map((carrera) => ({
    hipodromo: String(carrera.hipodromo).slice(0, 100),
    fecha: String(carrera.fecha).slice(0, 10),
    carrera: Number(carrera.carrera) || 0,
    distancia: carrera.distancia ? String(carrera.distancia).slice(0, 30) : null,
    superficie: carrera.superficie ? String(carrera.superficie).slice(0, 40) : null,
    ejemplares: (carrera.caballos ?? []).slice(0, 24).map((ejemplar) => ({
      numero: String(ejemplar.numero ?? "").slice(0, 6),
      nombre: String(ejemplar.nombre ?? "").slice(0, 100),
      retirado: ejemplar.retirado === true,
    })),
  }));
}
