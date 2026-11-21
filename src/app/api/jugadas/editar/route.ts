import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/features/seguridad/lib/require-session";

export const dynamic = "force-dynamic";

const COLUMNAS_OPCIONALES_TICKET = new Set([
  "fecha_carrera",
  "es_adelantada",
  "banquero_nombre",
  "grupo",
  "grupo_comision_nombre",
  "grupo_comision_id",
  "nota_auditoria",
]);
const COLUMNAS_SIN_CAS = new Set(["nota_auditoria"]);

type AdminClient = NonNullable<ReturnType<typeof getAdminClient>>;

type ResultadoEdicion =
  | { ok: true; auditError: string | null }
  | { ok: false; status: number; error: string };

type AjusteSaldo = { id: string; desde: number; hasta: number };

const EDICIONES_EN_VUELO = new Map<string, Promise<ResultadoEdicion>>();

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function extraerColumnaFaltante(error: { code?: string; message?: string } | null): string | null {
  if (!error) return null;
  const txt = `${error.code ?? ""} ${error.message ?? ""}`;
  if (!/(PGRST204|42703|does not exist|schema cache|Could not find)/i.test(txt)) return null;
  const m1 = txt.match(/Could not find the ['"]([^'"]+)['"] column/i);
  if (m1?.[1]) return m1[1];
  const m2 = txt.match(/column\s+["']?([a-zA-Z0-9_]+)["']?\s+(?:of relation|does not exist)/i);
  if (m2?.[1]) return m2[1];
  for (const col of COLUMNAS_OPCIONALES_TICKET) {
    if (txt.includes(col)) return col;
  }
  return null;
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function mismoMonto(a: unknown, b: number): boolean {
  return Math.abs(num(a) - b) < 0.005;
}

function mismoId(a: unknown, b: string): boolean {
  return String(a ?? "").trim() === b;
}

function claveIdempotencia(valores: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(valores)).digest("hex");
}

function aplicarIgualdades(query: any, valores: Record<string, unknown>): any {
  let q = query;
  for (const [col, valor] of Object.entries(valores)) {
    if (valor === undefined || COLUMNAS_SIN_CAS.has(col) || typeof valor === "object") continue;
    q = valor === null ? q.is(col, null) : q.eq(col, valor);
  }
  return q;
}

async function actualizarTicketConCAS(
  admin: AdminClient,
  id: string | number,
  valores: Record<string, unknown>,
  esperados: Record<string, unknown>
): Promise<
  | { ok: true; count: number; copia: Record<string, unknown> }
  | { ok: false; error: string }
> {
  const copia = { ...valores };
  const filtros = { ...esperados };
  let errorMsg: string | null = null;

  for (let intento = 0; intento < 6; intento++) {
    let query: any = admin.from("tickets_apuestas").update(copia).eq("id", id);
    query = aplicarIgualdades(query, filtros);
    const { data, error } = await query.select("id");

    if (!error) return { ok: true, count: data?.length ?? 0, copia };
    errorMsg = error.message;
    const col = extraerColumnaFaltante(error);
    if (col && col in copia && COLUMNAS_OPCIONALES_TICKET.has(col)) {
      delete copia[col];
      delete filtros[col];
      continue;
    }
    if (/(fecha_carrera|es_adelantada|banquero_nombre)/i.test(error.message)) {
      for (const c of ["fecha_carrera", "es_adelantada", "banquero_nombre"]) {
        delete copia[c];
        delete filtros[c];
      }
      continue;
    }
    break;
  }

  return { ok: false, error: errorMsg ?? "No se pudo actualizar la jugada." };
}

async function revertirSaldos(admin: AdminClient, aplicados: AjusteSaldo[]): Promise<void> {
  for (const ajuste of [...aplicados].reverse()) {
    await admin
      .from("clientes")
      .update({ saldo_actual: ajuste.desde })
      .eq("id", ajuste.id as never)
      .eq("saldo_actual", ajuste.hasta as never);
  }
}

function respuestaEdicion(resultado: ResultadoEdicion) {
  if (!resultado.ok) {
    return NextResponse.json(
      { ok: false, error: resultado.error },
      { status: resultado.status }
    );
  }
  return NextResponse.json({ ok: true, auditError: resultado.auditError }, { status: 200 });
}

/**
 * POST /api/jugadas/editar: exige hipico_session firmada, rol de staff y
 * actualización comparar-y-cambiar para no duplicar ajustes de saldo.
 */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && !origin.includes(host || "")) {
    return NextResponse.json({ error: "CSRF bloqueado" }, { status: 403 });
  }

  const autorizacion = await requireSession(req, ["superadmin", "admin_grupo"]);
  if (!autorizacion.ok) {
    return NextResponse.json(
      { ok: false, error: autorizacion.error },
      { status: autorizacion.status }
    );
  }
  const sesion = autorizacion.sesion;

  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: "Configuración de servidor incompleta para editar jugadas." },
      { status: 500 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    id?: string | number;
    payload?: Record<string, unknown>;
    ajusteSaldo?: {
      anulada?: boolean;
      idViejo?: string;
      idNuevo?: string;
      montoViejo?: number;
      montoNuevo?: number;
    };
    auditoria?: {
      ticket_id: string;
      hipodromo?: string | null;
      carrera?: number | null;
      accion: string;
      motivo?: string | null;
      detalle?: unknown;
      imagen?: string | null;
      usuario?: string | null;
    };
  };

  const id = body.id;
  if (id == null || String(id).trim() === "" || !body.payload || typeof body.payload !== "object") {
    return NextResponse.json({ ok: false, error: "Parámetros inválidos para editar jugada." }, { status: 400 });
  }

  const copia = { ...body.payload };
  if (
    copia.cliente_juega_id &&
    copia.cliente_consigue_id &&
    String(copia.cliente_juega_id) === String(copia.cliente_consigue_id)
  ) {
    return NextResponse.json(
      { ok: false, error: "⛔ El jugador y el banquero deben ser usuarios diferentes, nunca el mismo." },
      { status: 400 }
    );
  }

  const clave = claveIdempotencia([
    sesion.sub || sesion.usuario,
    sesion.rol,
    String(id),
    copia,
    body.ajusteSaldo ?? null,
  ]);

  const enVuelo = EDICIONES_EN_VUELO.get(clave);
  const promesa =
    enVuelo ??
    (async (): Promise<ResultadoEdicion> => {
      try {
        const { data: filas, error: errAntes } = await admin
          .from("tickets_apuestas")
          .select("*")
          .eq("id", id)
          .limit(1);
        if (errAntes) return { ok: false, status: 400, error: errAntes.message };
        const antes = (filas?.[0] ?? null) as Record<string, unknown> | null;
        if (!antes) {
          return { ok: false, status: 404, error: "La jugada no existe o no pudo actualizarse." };
        }

        const aj = body.ajusteSaldo;
        const idViejo = antes.cliente_juega_id == null ? "" : String(antes.cliente_juega_id).trim();
        const idNuevo =
          "cliente_juega_id" in copia
            ? String(copia.cliente_juega_id ?? "").trim()
            : idViejo;
        const montoViejo = num(antes.monto_jugado);
        const montoNuevo =
          "monto_jugado" in copia ? num(copia.monto_jugado) : montoViejo;

        if (
          aj &&
          antes.anulada !== true &&
          (!mismoId(aj.idViejo, idViejo) ||
            !mismoId(aj.idNuevo, idNuevo) ||
            !mismoMonto(aj.montoViejo, montoViejo) ||
            !mismoMonto(aj.montoNuevo, montoNuevo))
        ) {
          return {
            ok: false,
            status: 409,
            error: "El ajuste de saldo no coincide con el estado actual de la jugada.",
          };
        }

        const esperados: Record<string, unknown> = {};
        for (const col of Object.keys(copia)) {
          if (Object.prototype.hasOwnProperty.call(antes, col)) esperados[col] = antes[col];
        }

        const resUpdate = await actualizarTicketConCAS(admin, id, copia, esperados);
        if (!resUpdate.ok) {
          return { ok: false, status: 400, error: resUpdate.error };
        }
        if (resUpdate.count === 0) {
          return {
            ok: false,
            status: 409,
            error: "La jugada fue modificada por otra petición. Reintente con los datos actuales.",
          };
        }

        const copiaAplicada = resUpdate.copia;
        const ajustes: AjusteSaldo[] = [];

        if (aj && antes.anulada !== true) {
          const revertirTicket = async () => {
            const valores: Record<string, unknown> = {};
            const filtros: Record<string, unknown> = {};
            for (const col of Object.keys(copiaAplicada)) {
              valores[col] = Object.prototype.hasOwnProperty.call(antes, col) ? antes[col] : null;
              filtros[col] = copiaAplicada[col];
            }
            await actualizarTicketConCAS(admin, id, valores, filtros);
          };

          const aplicados: AjusteSaldo[] = [];
          const revertir = async (error: string): Promise<ResultadoEdicion> => {
            await revertirSaldos(admin, aplicados);
            await revertirTicket();
            return { ok: false, status: 409, error };
          };
          if (idViejo && idNuevo && idViejo === idNuevo) {
            const diff = montoNuevo - montoViejo;
            if (Math.abs(diff) >= 0.01) {
              const { data: cli, error: errCli } = await admin
                .from("clientes")
                .select("saldo_actual")
                .eq("id", idViejo as never)
                .maybeSingle();
              if (errCli) return revertir(errCli.message);
              if (cli) {
                const actual = num((cli as Record<string, unknown>).saldo_actual);
                ajustes.push({ id: idViejo, desde: actual, hasta: actual - diff });
              }
            }
          } else {
            if (idViejo && montoViejo > 0) {
              const { data: cliV, error: errV } = await admin
                .from("clientes")
                .select("saldo_actual")
                .eq("id", idViejo as never)
                .maybeSingle();
              if (errV) return revertir(errV.message);
              if (cliV) {
                const actualV = num((cliV as Record<string, unknown>).saldo_actual);
                ajustes.push({ id: idViejo, desde: actualV, hasta: actualV + montoViejo });
              }
            }
            if (idNuevo && montoNuevo > 0) {
              const { data: cliN, error: errN } = await admin
                .from("clientes")
                .select("saldo_actual")
                .eq("id", idNuevo as never)
                .maybeSingle();
              if (errN) return revertir(errN.message);
              if (cliN) {
                const actualN = num((cliN as Record<string, unknown>).saldo_actual);
                ajustes.push({ id: idNuevo, desde: actualN, hasta: actualN - montoNuevo });
              }
            }
          }

          for (const ajuste of ajustes) {
            const { data, error: errUpdate } = await admin
              .from("clientes")
              .update({ saldo_actual: ajuste.hasta })
              .eq("id", ajuste.id as never)
              .eq("saldo_actual", ajuste.desde as never)
              .select("id");
            if (errUpdate || !data?.length) {
              return revertir(
                errUpdate?.message ?? "El saldo cambió mientras se editaba la jugada."
              );
            }
            aplicados.push(ajuste);
          }
        }

        let auditError: string | null = null;
        if (body.auditoria) {
          const { error: errAud } = await admin.from("jugadas_auditoria").insert({
            ticket_id: String(id),
            hipodromo: antes.hipodromo ?? null,
            carrera: antes.carrera ?? null,
            accion: body.auditoria.accion,
            motivo: body.auditoria.motivo ?? null,
            detalle: { antes, despues: copiaAplicada },
            imagen: body.auditoria.imagen ?? null,
            usuario: sesion.usuario,
          });
          if (errAud) auditError = errAud.message;
        }

        return { ok: true, auditError };
      } catch (e) {
        return {
          ok: false,
          status: 500,
          error: e instanceof Error ? e.message : "Error inesperado editando la jugada.",
        };
      }
    })().finally(() => {
      EDICIONES_EN_VUELO.delete(clave);
    });

  if (!enVuelo) EDICIONES_EN_VUELO.set(clave, promesa);
  return respuestaEdicion(await promesa);
}
