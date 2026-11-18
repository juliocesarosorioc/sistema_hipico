import { IdleSessionTimer } from "@/features/auth/components/IdleSessionTimer";
import { GuardiaSesionNavegador } from "@/features/auth/components/GuardiaSesionNavegador";

export const dynamic = "force-dynamic";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      {/* El Bet Slip panel lateral NO va aquí: vive en el layout raíz,
          por eso persiste entre rutas sin recarga (requisito de la SPA). */}
      {children}
      <IdleSessionTimer timeoutMs={300000} warningMs={60000} />
      <GuardiaSesionNavegador />
    </div>
  );
}
