import { redirect } from "next/navigation";

/**
 * Entrada unificada: el acceso al sistema se realiza desde la portada.
 */
export default function LoginPage() {
  redirect("/");
}
