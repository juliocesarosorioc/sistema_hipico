import VerificacionCloudflare from "@/features/auth/components/VerificacionCloudflare";

export const metadata = {
  title: "Verificación de seguridad en curso — Cloudflare",
  description: "Verificando el navegador antes de acceder a la plataforma.",
};

export default function PaginaVerificacionCloudflare() {
  return <VerificacionCloudflare redireccionUrl="/login" autoVerificar={false} />;
}
