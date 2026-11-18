/**
 *Fuente única del Código de Sala que se muestra en el login y se entrega al
 *afiliar jugadores u operadores.
 *
 *Orden de resolución:
 *  1. `salas_juego.codigo_sala` cuando ya existe.
 *  2. `grupos.codigo` (tabla legacy, coincide por `id` con `grupos_venta`).
 *  3. `UPPER(REGEXP_REPLACE(nombre_grupo, '\s+', '', 'g'))`.
 */

export const URL_LOGIN_OFICIAL = "https://administracionhipica.ia.ve/login";

export function normalizarCodigoSala(valor?: string | null): string {
  return String(valor ?? "").trim().toUpperCase();
}

/** Equivalente en TS a UPPER(REGEXP_REPLACE(nombre_grupo, '\s+', '', 'g')). */
export function codigoSalaFallback(nombreGrupo?: string | null): string {
  return String(nombreGrupo ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, "");
}

export function urlLoginConSala(codigoSala: string): string {
  const codigo = normalizarCodigoSala(codigoSala);
  return `${URL_LOGIN_OFICIAL}?sala=${encodeURIComponent(codigo)}`;
}

/** Texto obligatorio de bienvenida / credenciales de la Sala de Juegos. */
export function mensajeBienvenidaSala(opts: {
  nombreGrupo: string;
  codigoSala: string;
  usuario: string;
  password: string;
}): string {
  const nombreGrupo = String(opts.nombreGrupo || "").trim();
  const codigoSala = normalizarCodigoSala(opts.codigoSala);
  const usuario = String(opts.usuario || "").trim();
  const password = String(opts.password || "").trim();

  return [
    `🏇 *BIENVENIDO A LA SALA DE JUEGOS: ${nombreGrupo}*`,
    `Sus credenciales oficiales de acceso a la plataforma son:`,
    ``,
    `🌐 *Enlace de Ingreso:* ${urlLoginConSala(codigoSala)}`,
    `🏷️ *Código de Sala:* ${codigoSala}`,
    `👤 *Usuario:* ${usuario}`,
    `🔑 *Contraseña:* ${password}`,
    ``,
    `📌 *Instrucciones:* Al abrir el enlace, verifique que en "Código de Sala" diga *${codigoSala}*, ingrese su usuario y contraseña.`,
  ].join("\n");
}

/**
 *Agrega el Código de Sala a cualquier respuesta privada del bot sin duplicarlo
 *si el mensaje ya lo trae.
 */
export function mensajeConCodigoSala(mensaje?: string | null, codigoSala?: string | null): string {
  const texto = String(mensaje ?? "").trim();
  const codigo = normalizarCodigoSala(codigoSala);
  if (!texto || !codigo) return texto;
  if (new RegExp(`Código de Sala\\s*:\\s*\\*?${codigo}`, "i").test(texto)) return texto;
  return `${texto}\n🏷️ Código de Sala: ${codigo}`;
}

export type DatosResolucionCodigoSala = {
  grupoId?: string | number | null;
  salaId?: string | number | null;
  nombre?: string | null;
  nombreGrupo?: string | null;
  codigo?: string | null;
  codigoSala?: string | null;
};

/**
 *Resuelve el código exacto usando el cliente que recibe (service role en el
 *servidor, cliente público en el navegador). Nunca lanza: ante fallo de BD se
 *usa el fallback determinista del nombre del grupo.
 */
export async function resolverCodigoSalaGrupo(
  client: any,
  datos: DatosResolucionCodigoSala
): Promise<string> {
  const explicito = normalizarCodigoSala(datos.codigoSala || datos.codigo);
  if (explicito) return explicito;

  let grupoId = datos.grupoId ? String(datos.grupoId) : "";
  let nombreGrupo = datos.nombreGrupo || datos.nombre || "";

  if (datos.salaId && client?.from) {
    try {
      const { data, error } = await client
        .from("salas_juego")
        .select("codigo_sala, grupo_id, nombre_grupo, nombre")
        .eq("id", String(datos.salaId))
        .maybeSingle();
      if (!error && data) {
        const codigoSala = normalizarCodigoSala((data as any).codigo_sala);
        if (codigoSala) return codigoSala;
        if (!grupoId && (data as any).grupo_id) grupoId = String((data as any).grupo_id);
        if (!nombreGrupo) nombreGrupo = String((data as any).nombre_grupo || (data as any).nombre || "");
      }
    } catch {
      /* columna o tabla opcional */
    }
  }

  if (grupoId && client?.from) {
    try {
      const { data, error } = await client
        .from("grupos")
        .select("id, codigo, codigo_sala, nombre_grupo, nombre")
        .eq("id", grupoId)
        .maybeSingle();
      if (!error && data) {
        const codigo = normalizarCodigoSala((data as any).codigo || (data as any).codigo_sala);
        if (codigo) return codigo;
        if (!nombreGrupo) nombreGrupo = String((data as any).nombre_grupo || (data as any).nombre || "");
      }
    } catch {
      /* tabla legacy opcional o columnas aún no creadas */
    }

    try {
      const { data, error } = await client
        .from("grupos_venta")
        .select("id, codigo_sala, nombre")
        .eq("id", grupoId)
        .maybeSingle();
      if (!error && data) {
        const codigo = normalizarCodigoSala((data as any).codigo_sala || (data as any).codigo);
        if (codigo) return codigo;
        if (!nombreGrupo) nombreGrupo = String((data as any).nombre || "");
      }
    } catch {
      /* columna opcional */
    }
  }

  if (nombreGrupo && client?.from) {
    try {
      const { data } = await client
        .from("grupos")
        .select("id, codigo, codigo_sala, nombre_grupo, nombre")
        .or(`nombre_grupo.ilike.${nombreGrupo},nombre.ilike.${nombreGrupo}`)
        .limit(1);
      const fila = Array.isArray(data) ? data[0] : data;
      const codigo = normalizarCodigoSala((fila as any)?.codigo || (fila as any)?.codigo_sala);
      if (codigo) return codigo;
    } catch {
      /* tabla legacy opcional */
    }
  }

  return codigoSalaFallback(nombreGrupo);
}
