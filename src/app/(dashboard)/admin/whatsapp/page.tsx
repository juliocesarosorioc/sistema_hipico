"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminWhatsAppRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/whatsapp");
  }, [router]);

  return (
    <div className="flex h-64 items-center justify-center text-slate-400">
      <p>Redirigiendo a Configuración de Bot WhatsApp...</p>
    </div>
  );
}
