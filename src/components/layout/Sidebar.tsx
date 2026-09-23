import { BetSlipPanel } from "@/components/betting/BetSlipPanel";

/**
 * Panel lateral derecho persistente (Organismo).
 * Envuelve el Bet Slip futuro; vive en el layout raíz para que la SPA
 * nunca pierda el contexto del boleto al navegar entre rutas.
 */
export function Sidebar() {
  return <BetSlipPanel />;
}

export default Sidebar;