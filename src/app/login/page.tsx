import PantallaLogin from "@/components/auth/PantallaLogin";

/**
 * Acceso directo al login. La pantalla vive en `PantallaLogin` porque la RAÍZ
 * también la muestra: tener dos copias del formulario invitaba a que una
 * quedara vieja (el store ya no guardaba la identidad, y esta copia habría
 * seguido mostrando el usuario en localStorage).
 */
export default function LoginPage() {
  return <PantallaLogin />;
}
