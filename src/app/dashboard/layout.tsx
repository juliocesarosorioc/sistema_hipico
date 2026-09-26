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
    </div>
  );
}