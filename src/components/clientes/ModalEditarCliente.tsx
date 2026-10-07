"use client";

import { ModalCliente } from "@/components/clientes/ModalCliente";
import type { ClienteRow } from "@/lib/clientes";

type Props = {
  cliente: ClienteRow | null;
  onClose: () => void;
  onGuardado: () => void;
};

/**
 * Modal de edición de un cliente.
 *
 * Antes mantenía su propio formulario (331 líneas) duplicando el de alta, y ya
 * divergían: no validaba, no ligaba "mostrar saldo" a "es socio" y su rejilla
 * colocaba los campos en otro orden. Ahora delega en `ModalCliente`, que es el
 * único formulario del CRUD y aplica las mismas reglas en alta y edición.
 */
export function ModalEditarCliente({ cliente, onClose, onGuardado }: Props) {
  return <ModalCliente cliente={cliente} onClose={onClose} onGuardado={onGuardado} />;
}
