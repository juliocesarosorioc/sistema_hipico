import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/core/supabase-admin";

export const dynamic = "force-dynamic";

/**
 * POST /api/whatsapp/upload
 *
 * El bucket `whatsapp_media` es público para LECTURA, pero `storage.objects`
 * tiene RLS y el navegador no tiene política de INSERT. Este endpoint hace el
 * upload con service_role (que bypassa RLS) y devuelve la URL pública que luego
 * usa `/api/whatsapp/send` para entregar la imagen a Baileys.
 */
const BUCKET = "whatsapp_media";
const MAX_BYTES = 12 * 1024 * 1024;

const EXTENSION_POR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/heic": "heic",
  "image/heif": "heif",
};

function segmentoSeguro(valor: string): string {
  const limpio = valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return limpio.slice(0, 80) || "general";
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && !origin.includes(host || "")) {
    return NextResponse.json({ ok: false, error: "CSRF bloqueado" }, { status: 403 });
  }

  try {
    const form = await req.formData();
    const archivo = form.get("file");
    if (!archivo || typeof archivo === "string") {
      return NextResponse.json({ ok: false, error: "file es requerido" }, { status: 400 });
    }

    const mime = String(archivo.type || "image/jpeg").split(";")[0].trim().toLowerCase();
    if (!mime.startsWith("image/")) {
      return NextResponse.json({ ok: false, error: "Solo se admiten imágenes" }, { status: 400 });
    }
    if (archivo.size > MAX_BYTES) {
      return NextResponse.json({ ok: false, error: "La imagen supera el límite de 12 MB" }, { status: 413 });
    }

    const grupoId = segmentoSeguro(String(form.get("grupoId") || form.get("grupo_id") || "general"));
    const nombre = String(archivo.name || "").split(".").pop() || "";
    const extension =
      EXTENSION_POR_MIME[mime] ||
      nombre.replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 8) ||
      "jpg";
    const ruta = `${grupoId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;

    const bytes = new Uint8Array(await archivo.arrayBuffer());
    const { error } = await getSupabaseAdmin()
      .storage.from(BUCKET)
      .upload(ruta, bytes, {
        contentType: mime,
        cacheControl: "3600",
        upsert: false,
      });
    if (error) throw error;

    const { data } = getSupabaseAdmin().storage.from(BUCKET).getPublicUrl(ruta);
    const publicUrl = String(data?.publicUrl || "");
    if (!publicUrl) throw new Error("No se obtuvo URL pública del archivo");

    return NextResponse.json({ ok: true, path: ruta, publicUrl, media_url: publicUrl });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "No se pudo subir la imagen" },
      { status: 500 },
    );
  }
}
