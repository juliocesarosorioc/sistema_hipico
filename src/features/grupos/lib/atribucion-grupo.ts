/**
 * ============================================================================
 * ATRIBUCIÓN DE CUENTA ENTRE GRUPOS · núcleo puro
 * ============================================================================
 * La "Regla de Oro Contable" (dueño):
 *
 *   Cuando un usuario de un Grupo Secundario (Grupo B) toma o realiza una jugada
 *   sobre la cartelera/publicación del GRUPO PRINCIPAL, la jugada queda:
 *
 *     grupo_publicador_id = GRUPO PRINCIPAL   (quién publicó la jugada)
 *     grupo_cuenta_id     = Grupo B           (a quién le da cuenta el usuario)
 *
 *   Financieramente el jugador le da cuenta (cobra y paga su saldo/cuaderno)
 *   DIRECTAMENTE a su propio grupo (B). El sistema registra el cruce/comisión por
 *   convenio entre B y el Principal (ver `comisiones-convenio.ts`).
 *
 * Este archivo resuelve, sin tocar Supabase, QUÉ grupo publica y a QUÉ grupo se
 * le da cuenta, a partir de:
 *   - el grupo del usuario que vende (su grupo origen),
 *   - el grupo dueño de la publicación (la cartelera/oferta),
 *   - la config de visibilidad del principal.
 *
 * Reglas:
 *   1. Si la publicación es del principal y el que vende NO es del principal →
 *      publicador = principal, cuenta = grupo del usuario (B).
 *   2. Si el que vende es del mismo grupo que publica → publicador = cuenta =
 *      ese grupo (no hay cruce).
 *   3. Si la publicación es de otro grupo cualquiera → publicador = dueño de la
 *      publicación, cuenta = grupo del usuario.
 *   4. Sin publicación identificable → ambos = grupo del usuario (comportamiento
 *      histórico: la jugada se le da cuenta a quien la vende).
 *
 * Es PURO para blindarlo con pruebas. La escritura de las columnas vive en
 * `sql/grupos_visibilidad_principal.sql` (columnas + RPC) y en los RPC de venta.
 * ============================================================================
 */

import type { GrupoVisibilidad } from "./visibilidad-principal";
import { idTexto, principalDe } from "./visibilidad-principal";

/** Resultado del enrutamiento contable de una jugada. */
export type AtribucionJugada = {
  /** Grupo que publicó la jugada (cartelera/oferta). */
  publicadorId: string;
  /** Grupo al que el jugador le da cuenta (cobra y paga su saldo). */
  cuentaId: string;
  /**
   * `true` cuando hay un cruce real: el publicador y la cuenta son grupos
   * distintos (típicamente principal ↔ secundario). Es la señal para registrar
   * la comisión por convenio entre ambos.
   */
  cruzada: boolean;
  /** `true` cuando la jugada salió de la cartelera del grupo PRINCIPAL. */
  desdePrincipal: boolean;
};

/**
 * Enrutamiento contable de una jugada.
 *
 * @param grupoUsuario  Grupo al que pertenece el usuario/operador que vende.
 * @param grupoPublicacion  Grupo dueño de la publicación (puede ser null).
 * @param grupos  Lista de grupos, para detectar cuál es el principal.
 */
export function atribuirJugada(
  grupoUsuario: string | number | null | undefined,
  grupoPublicacion: string | number | null | undefined,
  grupos?: ReadonlyArray<GrupoVisibilidad>
): AtribucionJugada {
  const cuenta = idTexto(grupoUsuario);
  const publicacion = idTexto(grupoPublicacion);
  // Sin publicación identificable: se le da cuenta a quien vende (histórico).
  const publicador = publicacion || cuenta;
  const cruzada = publicador !== "" && cuenta !== "" && publicador !== cuenta;
  const principal = grupos ? principalDe(grupos) : null;
  const desdePrincipal = principal != null && publicador === idTexto(principal.id);
  return { publicadorId: publicador, cuentaId: cuenta, cruzada, desdePrincipal };
}

/**
 * Atajo para el caso estrella: el usuario es de un grupo secundario y la jugada
 * salió del principal. Devuelve el enrutamiento o `null` si no aplica.
 */
export function atribuirDesdePrincipal(
  grupoUsuario: string | number | null | undefined,
  grupoPublicacion: string | number | null | undefined,
  principalId: string | number | null | undefined
): AtribucionJugada | null {
  const publicador = idTexto(grupoPublicacion);
  const cuenta = idTexto(grupoUsuario);
  const pid = idTexto(principalId);
  if (!pid || publicador !== pid) return null;
  const cruzada = cuenta !== "" && cuenta !== pid;
  return { publicadorId: pid, cuentaId: cuenta, cruzada, desdePrincipal: true };
}

/**
 * ¿La jugada es un cruce entre grupos? Útil para decidir si se registra la
 * comisión por convenio. Sin publicador o sin cuenta → no hay cruce.
 */
export function esCruceDeGrupos(atribucion: AtribucionJugada | null | undefined): boolean {
  return atribucion != null && atribucion.cruzada === true;
}

/**
 * Columnas a escribir en `tickets_apuestas` para congelar la atribución. Si el
 * publicador coincide con la cuenta, el publicador se OMITE (queda NULL) para no
 * duplicar la información histórica: `grupo_cobro_id` ya dice a quién se le da
 * cuenta cuando no hay cruce.
 */
export function columnasAtribucion(
  atribucion: AtribucionJugada
): { grupo_cuenta_id?: string; grupo_publicador_id?: string } {
  const cols: { grupo_cuenta_id?: string; grupo_publicador_id?: string } = {};
  if (atribucion.cuentaId) cols.grupo_cuenta_id = atribucion.cuentaId;
  if (atribucion.publicadorId && atribucion.publicadorId !== atribucion.cuentaId) {
    cols.grupo_publicador_id = atribucion.publicadorId;
  }
  return cols;
}

/**
 * Grupo al que corresponde una jugada para el CUADERNO/saldos: la cuenta del
 * usuario (B). Cae al publicador y, por último, al cobro histórico si las
 * columnas nuevas vinieran vacías (migración a medias).
 */
export function grupoDeCuenta(
  grupoCuentaId: string | number | null | undefined,
  grupoPublicadorId: string | number | null | undefined,
  grupoCobroId: string | number | null | undefined
): string {
  return idTexto(grupoCuentaId) || idTexto(grupoPublicadorId) || idTexto(grupoCobroId);
}

/**
 * Grupo PUBLICADOR de una jugada (para el reporte de convenios). Cae a la cuenta
 * y al cobro histórico cuando las columnas nuevas están vacías.
 */
export function grupoPublicador(
  grupoPublicadorId: string | number | null | undefined,
  grupoCuentaId: string | number | null | undefined,
  grupoCobroId: string | number | null | undefined
): string {
  return idTexto(grupoPublicadorId) || idTexto(grupoCuentaId) || idTexto(grupoCobroId);
}
