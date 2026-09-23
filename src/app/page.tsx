import { redirect } from "next/navigation";

/**
 * Ruta raíz "/" → redirige al contenedor (dashboard), igual que el sistema
 * legacy (index.html → portal). El Bet Slip del layout nunca se pierde.
 */
export default function RootPage() {
  redirect("/dashboard");
}
