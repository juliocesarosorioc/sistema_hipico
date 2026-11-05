import PaginaComercial from "@/features/comercial/components/PaginaComercial";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sistema Hípico · Portal Comercial & Banca Digital",
  description:
    "Plataforma tecnológica profesional para gestión de apuestas hípicas, Tablas Fijas, Marcas 120/100, Banca Espejo 2.5%, Contabilidad NIIF y WhatsApp Bot.",
};

export default function ComercialPage() {
  return <PaginaComercial />;
}
