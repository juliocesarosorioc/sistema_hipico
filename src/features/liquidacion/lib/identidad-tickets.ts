export type TicketConIdentidadCliente = {
  ticketId?: number;
  cliente1Id?: string;
};

/** La identidad persistida de la venta es la fuente de verdad contable. */
export function reconciliarIdentidadPersistida<T extends TicketConIdentidadCliente>(
  tickets: T[],
  clienteIdPorTicket: ReadonlyMap<string, string | null>
): T[] {
  return tickets.map((ticket) => {
    if (ticket.ticketId == null) return ticket;
    const clienteId = String(clienteIdPorTicket.get(String(ticket.ticketId)) ?? "").trim();
    return clienteId ? { ...ticket, cliente1Id: clienteId } : ticket;
  });
}
