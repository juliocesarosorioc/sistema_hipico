import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const forwardedFor = req.headers.get("x-forwarded-for");
  const realIp = req.headers.get("x-real-ip");
  const cfIp = req.headers.get("cf-connecting-ip");

  let ip = cfIp || realIp || (forwardedFor ? forwardedFor.split(",")[0].trim() : null) || req.ip || "127.0.0.1";

  // Normalizar localhost ipv6
  if (ip === "::1" || ip === "::ffff:127.0.0.1") {
    ip = "127.0.0.1";
  }

  return NextResponse.json({ ip });
}
