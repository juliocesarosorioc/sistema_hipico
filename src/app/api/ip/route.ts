import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const forwarded = req.headers.get("x-forwarded-for");
  const realIp = req.headers.get("x-real-ip");
  const cfIp = req.headers.get("cf-connecting-ip");

  const ip =
    (forwarded ? forwarded.split(",")[0].trim() : null) ||
    realIp ||
    cfIp ||
    "127.0.0.1";

  return NextResponse.json({ ip });
}
