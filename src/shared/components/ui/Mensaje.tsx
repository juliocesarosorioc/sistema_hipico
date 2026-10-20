import type { ReactNode } from "react";
import {
  CLASE_MENSAJE,
  ICONO_MENSAJE,
  type TipoMensaje,
} from "@/shared/lib/mensajeria";

type Props = {
  /** Tipo de mensaje: define el color y el ícono. */
  tipo?: TipoMensaje;
  /** Texto principal del aviso. */
  children: ReactNode;
  /** Línea secundaria opcional (explicación, alcance del cambio). */
  detalle?: ReactNode;
  /** Oculta el ícono si el contexto ya lo aporta. */
  sinIcono?: boolean;
  className?: string;
};

/**
 * ============================================================================
 * MENSAJE INLINE — el aviso en línea, con el estilo centralizado
 * ============================================================================
 *
 * Para cualquier mensaje que NO flota (un aviso dentro de un formulario, el
 * resultado de una validación, una nota de alcance). Usa las mismas clases
 * `.msg` + `.msg-*` que el ToastHost y el ConfirmModal, así que todo se ve
 * igual. Nunca se escriben colores a mano en la pantalla.
 */
export function Mensaje({ tipo = "info", children, detalle, sinIcono = false, className = "" }: Props) {
  return (
    <div role="status" className={`msg msg-inline ${CLASE_MENSAJE[tipo]} ${className}`}>
      {sinIcono ? null : (
        <span className="msg-icono" aria-hidden="true">
          {ICONO_MENSAJE[tipo]}
        </span>
      )}
      <span className="msg-texto">
        {children}
        {detalle ? <span className="msg-detalle">{detalle}</span> : null}
      </span>
    </div>
  );
}

export default Mensaje;
