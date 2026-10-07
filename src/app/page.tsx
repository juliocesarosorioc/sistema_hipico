import PantallaLogin from "@/components/auth/PantallaLogin";

/**
 * RAÍZ = LOGIN.
 *
 * Antes esta ruta hacía `redirect("/dashboard")`, que en un build estático se
 * traduce en un salto extra y, sin sesión, terminaba en el mismo redirect de
 * vuelta: la página "cargando" sin llegar a mostrar nada.
 *
 * Ahora la raíz ES la puerta, igual que en el sistema legacy (index.html era el
 * login). Con sesión ya abierta, `PantallaLogin` manda a /dashboard sola, así
 * que el operador que recarga la página no ve el formulario.
 */
export default function RootPage() {
  return <PantallaLogin />;
}
