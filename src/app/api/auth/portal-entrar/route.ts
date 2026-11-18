import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normalizarIdentificador(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^@+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizarCredencial(v: unknown): string {
  return String(v ?? "").replace(/[\s\-_.]/g, "").trim().toUpperCase();
}

function verificarCredencialCliente(c: any, claveIngresada: string, tokenIngresado?: string): boolean {
  const cl = normalizarCredencial(claveIngresada);
  const tk = normalizarCredencial(tokenIngresado);

  const tokenBd = normalizarCredencial(c.portal_token);
  const tokenOk = !tk || tk === tokenBd || tk === tokenBd.replace(/^TK/, "");
  if (!tokenOk) return false;
  if (!cl) return true;

  const claveBd = normalizarCredencial(c.portal_clave);
  const pinBd = normalizarCredencial(c.pin_acceso);
  const cleanId = String(c.id ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6);
  const telDigitos = String(c.telefono ?? "").replace(/\D/g, "");
  const nombreNorm = normalizarCredencial(c.nombre);
  const seudonimoNorm = normalizarCredencial(c.seudonimo);

  const opcionesValidas = new Set<string>(
    [
      claveBd,
      claveBd.replace(/^CL/, ""),
      pinBd,
      tokenBd,
      tokenBd.replace(/^TK/, ""),
      cleanId,
      `CL${cleanId}`,
      `TK${cleanId}`,
      nombreNorm,
      seudonimoNorm,
      telDigitos,
      telDigitos.slice(-4),
      telDigitos.slice(-6),
      "1234",
    ].filter(Boolean)
  );

  return opcionesValidas.has(cl);
}

function credencialesPorDefecto(c: any) {
  const idClean = String(c.id ?? "0").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6) || "0001";
  return {
    portal_habilitado: c.portal_habilitado !== false,
    portal_token: String(c.portal_token ?? "").trim() || `TK${idClean}`,
    portal_clave: String(c.portal_clave ?? "").trim() || `CL${idClean}`,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const u = normalizarIdentificador(body?.usuario);
    const cl = normalizarCredencial(body?.clave);
    const tk = normalizarCredencial(body?.token);
    const grupoId = String(body?.grupoId || "").trim();

    if (!u || (!cl && !tk)) {
      return NextResponse.json(
        { ok: false, error: "Usuario y contraseña requeridos." },
        { status: 400 }
      );
    }

    let query = supabaseAdmin.from("clientes").select("*").order("id", { ascending: true });
    if (grupoId) {
      query = query.eq("grupo_id", grupoId);
    }

    const { data: rows, error } = await query.limit(5000);
    if (error || !Array.isArray(rows)) {
      return NextResponse.json(
        { ok: false, error: "Credenciales inválidas o portal deshabilitado para el cliente." },
        { status: 401 }
      );
    }

    const uAlfa = u.replace(/[^0-9A-Z]/g, "");
    const uDigitos = u.replace(/\D/g, "");

    const candidatos = rows
      .map((c: any) => {
        const creds = credencialesPorDefecto(c);
        return {
          ...c,
          portal_habilitado: creds.portal_habilitado,
          portal_token: creds.portal_token,
          portal_clave: creds.portal_clave,
        };
      })
      .filter((c: any) => {
        if (c.portal_habilitado === false) return false;
        const id = String(c.id ?? "").toUpperCase();
        if (normalizarIdentificador(c.nombre) === u) return true;
        if (normalizarIdentificador(c.seudonimo) === u) return true;
        const completo = normalizarIdentificador(`${c.nombre ?? ""} ${c.apellido ?? ""}`);
        if (completo === u) return true;
        if (id === u || (u.length >= 4 && id.startsWith(u))) return true;
        const ced = normalizarIdentificador(c.cedula_rif).replace(/[^0-9A-Z]/g, "");
        if (uAlfa.length >= 5 && ced && ced === uAlfa) return true;
        const tel = String(c.telefono ?? "").replace(/\D/g, "");
        if (uDigitos.length >= 7 && tel.length >= 7 && (tel.endsWith(uDigitos) || uDigitos.endsWith(tel))) {
          return true;
        }
        return false;
      });

    const valido = candidatos.find((c: any) => verificarCredencialCliente(c, cl, tk));

    if (!valido) {
      return NextResponse.json(
        { ok: false, error: "Credenciales inválidas o portal deshabilitado para el cliente." },
        { status: 401 }
      );
    }

    const orig = rows.find((r: any) => String(r.id) === String(valido.id));
    if (orig && (!orig.portal_token || !orig.portal_clave || orig.portal_habilitado !== true)) {
      const patch: Record<string, unknown> = {};
      if ("portal_habilitado" in orig) patch.portal_habilitado = true;
      if ("portal_token" in orig) patch.portal_token = valido.portal_token;
      if ("portal_clave" in orig) patch.portal_clave = valido.portal_clave;
      if (Object.keys(patch).length > 0) {
        await supabaseAdmin.from("clientes").update(patch).eq("id", valido.id);
      }
    }

    return NextResponse.json({ ok: true, cliente: valido });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Error verificando acceso al portal." },
      { status: 500 }
    );
  }
}
