import { TablasModule } from "@/components/tablas/TablasModule";

export const metadata = { title: "Tablas Fijas — Club del Dinero" };

export default function TablasFijasPage() {
  return (
    <div className="p-4 lg:p-6">
      <TablasModule />
    </div>
  );
}