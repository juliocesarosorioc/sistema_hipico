import { supabaseAdmin } from "@/core/supabase-admin";
import type { ClienteResuelto } from "./types";

export function normalizarTelefono(raw?: string | null): string {
  if (!raw) return "";
  return String(raw)
    .replace(/@.*$/, "")
    .replace(/:.*$/, "")
    .replace(/[^0-9]/g, "");
}

export function extraerUltimos10Digitos(raw?: string | null): string {
  if (!raw) return "";
  const soloDigitos = String(raw).replace(/@.*$/, "").replace(/:.*$/, "").replace(/\D/g, "");
  if (soloDigitos.length >= 10) return soloDigitos.slice(-10);
  return soloDigitos.length >= 7 ? soloDigitos : "";
}

export function normalizarTelefonoCompleto(codigoPais?: string | null, telefono?: string | null): string {
  const cp = String(codigoPais || "").replace(/\D/g, "");
  const tel = String(telefono || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!tel) return cp;
  if (!cp) return tel;
  if (tel.startsWith(cp)) return tel;
  return `${cp}${tel}`;
}

export function resolverTelefonoWhatsappCliente(cliente: any): string | null {
  const raw = cliente?.telefono_normalizado || cliente?.telefono || "";
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 12 && digits.startsWith("58")) return digits;
  const u10 = extraerUltimos10Digitos(digits);
  if (u10.length === 10 && /^[24]/.test(u10) && (!digits.startsWith("1") || digits.length > 11)) {
    return `58${u10}`;
  }
  return digits;
}

export function calcularSaldoDisponible(cliente: any): number {
  if (!cliente) return 0;
  if (cliente.libre) return 999999;
  const saldo = Number(cliente.saldo_actual ?? 0);
  const aval = Number(cliente.aval ?? cliente.limite_credito ?? 0);
  const retenido = Number(cliente.saldo_retenido ?? 0);
  const dispCalculado = Math.max(0, Number((saldo + aval - retenido).toFixed(2)));
  const dispDb = Number(cliente.saldo_disponible ?? 0);
  return Math.max(dispCalculado, dispDb);
}

export async function verificarEsOperador(
  clienteId?: string | null,
  telefono?: string | null,
  grupoId?: string | null,
  opciones?: {
    participantJid?: string | null;
    participantAlt?: string | null;
    telefonoReal?: string | null;
    salaId?: string | null;
  }
): Promise<boolean> {
  const telefonos = [
    telefono,
    opciones?.telefonoReal,
    opciones?.participantJid,
    opciones?.participantAlt,
  ]
    .map((v) => extraerUltimos10Digitos(v))
    .filter(Boolean);
  const unicosTelefonos = Array.from(new Set(telefonos));
  const jids = [opciones?.participantJid, opciones?.participantAlt]
    .map((v) => String(v || "").trim())
    .filter(Boolean);

  if (!clienteId && unicosTelefonos.length === 0 && jids.length === 0) return false;

  const esAutorizado = (usuario: any): boolean => {
    if (!usuario || usuario.activo === false) return false;
    if (usuario.es_principal) return true;
    if (grupoId && String(usuario.grupo_id || "") === String(grupoId)) return true;
    if (opciones?.salaId && String(usuario.sala_id || "") === String(opciones.salaId)) return true;
    return false;
  };

  try {
    for (const tel10 of unicosTelefonos) {
      const { data } = await supabaseAdmin
        .from("usuario_sistema")
        .select("id, activo, es_principal, grupo_id, sala_id")
        .ilike("telefono", `%${tel10}%`)
        .limit(1)
        .maybeSingle();
      if (esAutorizado(data)) return true;
    }
  } catch {}

  if (jids.length > 0) {
    try {
      const filtros = jids.flatMap((jid) => [
        `whatsapp_lid.eq.${jid}`,
        `whatsapp_jid.eq.${jid}`,
      ]);
      const { data } = await supabaseAdmin
        .from("usuario_sistema")
        .select("id, activo, es_principal, grupo_id, sala_id, whatsapp_lid, whatsapp_jid")
        .or(filtros.join(","))
        .limit(1)
        .maybeSingle();
      if (esAutorizado(data)) return true;
    } catch {}
  }

  return false;
}

/** Identidad simbólica para operadores que no están en la nómina de `clientes`. */
export function crearClienteOperadorSimbolico(params: {
  grupoId: string;
  participantJid: string;
  nombre?: string | null;
  telefono?: string | null;
  whatsappLid?: string | null;
}): ClienteResuelto {
  const nombre = String(params.nombre || "OPERADOR").trim().toUpperCase() || "OPERADOR";
  const telefono = String(params.telefono || "").trim() || null;
  return {
    id: "",
    grupo_id: params.grupoId,
    nombre,
    seudonimo: null,
    saldo_actual: 0,
    saldo_retenido: 0,
    saldo_disponible: 0,
    libre: true,
    aval: 0,
    whatsapp_jid: params.participantJid.endsWith("@s.whatsapp.net") ? params.participantJid : null,
    whatsapp_lid: params.whatsappLid || params.participantJid,
    codigo_pais: null,
    telefono,
    telefono_normalizado: telefono ? normalizarTelefono(telefono) : null,
    telefonoClienteCompleto: telefono ? resolverTelefonoWhatsappCliente({ telefono_normalizado: telefono }) : null,
    nombreJugador: nombre,
    esOperadorRemitente: true,
    rawCliente: { esOperadorSimbolico: true },
  };
}

export const CAMPOS_CLIENTE_SALA =
  "id, grupo_id, nombre, seudonimo, saldo_actual, saldo_retenido, saldo_disponible, libre, aval, whatsapp_jid, whatsapp_lid, codigo_pais, telefono, telefono_normalizado";

export async function resolverCliente(params: {
  grupoId: string;
  participantJid: string;
  participantAlt?: string | null;
  telefonoReal?: string | null;
  pushName?: string | null;
  senderNombre?: string | null;
  esMensajePropioTelefono?: boolean;
  esOperador?: boolean;
  esOperadorRemitente?: boolean;
  clientePreviamenteIdentificado?: any;
}): Promise<ClienteResuelto | null> {
  const {
    grupoId,
    participantJid,
    participantAlt: participantAltRaw = "",
    telefonoReal: telefonoRealPropRaw = "",
    pushName: pushNameRaw = "",
    senderNombre: senderNombreRaw = "",
    esMensajePropioTelefono = false,
    esOperador = false,
    esOperadorRemitente: esOperadorRemitenteParam,
    clientePreviamenteIdentificado = null,
  } = params;

  const participantAlt = String(participantAltRaw || "").trim();
  const telefonoRealProp = String(telefonoRealPropRaw || "").trim();
  const pushNameLimpio = String(pushNameRaw || senderNombreRaw || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
  const pushNameValido =
    pushNameLimpio &&
    !["USUARIO", "JUGADOR", "OPERADOR", "OPERADOR (TELEFONO)", "ADMIN"].includes(pushNameLimpio)
      ? pushNameLimpio
      : "";

  const esLid = participantJid.endsWith("@lid");
  const esAltLid = participantAlt.endsWith("@lid");
  const telAlt = normalizarTelefono(participantAlt);
  let telReal = normalizarTelefono(telefonoRealProp);
  if (!telReal) {
    if (participantAlt && participantAlt.endsWith("@s.whatsapp.net")) {
      telReal = telAlt;
    } else if (participantJid && participantJid.endsWith("@s.whatsapp.net")) {
      telReal = normalizarTelefono(participantJid);
    } else if (!esLid && normalizarTelefono(participantJid).length >= 7 && normalizarTelefono(participantJid).length <= 15) {
      telReal = normalizarTelefono(participantJid);
    } else if (!esAltLid && telAlt && telAlt.length >= 7 && telAlt.length <= 15) {
      telReal = telAlt;
    }
  }

  const tel10 = extraerUltimos10Digitos(telReal || telefonoRealProp || (!esLid ? participantJid : "") || (!esAltLid ? participantAlt : ""));

  const esOperadorRemitente =
    typeof esOperadorRemitenteParam === "boolean"
      ? esOperadorRemitenteParam
      : Boolean(esMensajePropioTelefono) ||
        Boolean(esOperador) ||
        (await verificarEsOperador(null, participantJid, grupoId));

  let cliente: any =
    clientePreviamenteIdentificado?.id &&
    String(clientePreviamenteIdentificado?.grupo_id || "") === String(grupoId)
      ? clientePreviamenteIdentificado
      : null;

  // A. Búsqueda en `clientes` donde `grupo_id = grupoId` por whatsapp_jid o whatsapp_lid
  if (!cliente && (participantJid || participantAlt)) {
    const orJids: string[] = [];
    if (participantJid) {
      orJids.push(`whatsapp_jid.eq.${participantJid}`);
      orJids.push(`whatsapp_lid.eq.${participantJid}`);
    }
    if (participantAlt && participantAlt !== participantJid) {
      orJids.push(`whatsapp_jid.eq.${participantAlt}`);
      orJids.push(`whatsapp_lid.eq.${participantAlt}`);
    }
    if (orJids.length > 0) {
      const { data: clPorJid } = await supabaseAdmin
        .from("clientes")
        .select(CAMPOS_CLIENTE_SALA)
        .eq("grupo_id", grupoId)
        .or(orJids.join(","))
        .order("saldo_actual", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (clPorJid) cliente = clPorJid;
    }
  }

  // B. Normalización y búsqueda por últimos 10 dígitos (RIGHT(solo_digitos, 10))
  if (!cliente && tel10 && tel10.length >= 7) {
    const { data: clPor10 } = await supabaseAdmin
      .from("clientes")
      .select(CAMPOS_CLIENTE_SALA)
      .eq("grupo_id", grupoId)
      .or(`telefono.ilike.%${tel10}%,telefono_normalizado.ilike.%${tel10}%`)
      .order("saldo_actual", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (clPor10) cliente = clPor10;
  }

  // C. Búsqueda en memoria sobre todos los clientes del grupo (10 dígitos o pushName)
  if (!cliente) {
    const { data: candidatosGrupo } = await supabaseAdmin
      .from("clientes")
      .select(CAMPOS_CLIENTE_SALA)
      .eq("grupo_id", grupoId);

    if (Array.isArray(candidatosGrupo) && candidatosGrupo.length > 0) {
      if (tel10) {
        cliente = candidatosGrupo.find((c: any) => {
          const c10 = extraerUltimos10Digitos(c.telefono_normalizado || c.telefono);
          if (c10 && c10 === tel10) return true;
          const comp = normalizarTelefonoCompleto(c.codigo_pais, c.telefono);
          const comp10 = extraerUltimos10Digitos(comp);
          return Boolean(comp10 && comp10 === tel10);
        });
      }

      if (!cliente && pushNameValido) {
        cliente = candidatosGrupo.find((c: any) => {
          const nom = String(c.nombre || "").trim().replace(/\s+/g, " ").toUpperCase();
          const seu = String(c.seudonimo || "").trim().replace(/\s+/g, " ").toUpperCase();
          return (
            nom === pushNameValido ||
            (seu && seu === pushNameValido) ||
            nom.includes(pushNameValido) ||
            (seu && seu.includes(pushNameValido)) ||
            pushNameValido.includes(nom) ||
            (seu && pushNameValido.includes(seu))
          );
        });
      }
    }
  }

  // D. Pistas cruzadas entre grupos (si el jugador ya fue visto en otro grupo)
  if (!cliente && (participantJid || participantAlt || tel10 || pushNameValido)) {
    const orPistas: string[] = [];
    if (participantJid) {
      orPistas.push(`whatsapp_jid.eq.${participantJid}`);
      orPistas.push(`whatsapp_lid.eq.${participantJid}`);
    }
    if (participantAlt && participantAlt !== participantJid) {
      orPistas.push(`whatsapp_jid.eq.${participantAlt}`);
      orPistas.push(`whatsapp_lid.eq.${participantAlt}`);
    }
    if (tel10) {
      orPistas.push(`telefono.ilike.%${tel10}%`);
      orPistas.push(`telefono_normalizado.ilike.%${tel10}%`);
    }
    if (orPistas.length > 0) {
      const { data: pistaRows } = await supabaseAdmin
        .from("clientes")
        .select("nombre, seudonimo, telefono, telefono_normalizado")
        .or(orPistas.join(","))
        .limit(5);

      if (Array.isArray(pistaRows) && pistaRows.length > 0) {
        const { data: candidatosGrupo } = await supabaseAdmin
          .from("clientes")
          .select(CAMPOS_CLIENTE_SALA)
          .eq("grupo_id", grupoId);

        if (Array.isArray(candidatosGrupo) && candidatosGrupo.length > 0) {
          for (const pista of pistaRows) {
            const p10 = extraerUltimos10Digitos(pista.telefono_normalizado || pista.telefono);
            const nomP = String(pista.nombre || "").trim().replace(/\s+/g, " ").toUpperCase();
            const seuP = String(pista.seudonimo || "").trim().replace(/\s+/g, " ").toUpperCase();

            const encontrado = candidatosGrupo.find((c: any) => {
              const c10 = extraerUltimos10Digitos(c.telefono_normalizado || c.telefono);
              if (p10 && c10 && p10 === c10) return true;
              const nomC = String(c.nombre || "").trim().replace(/\s+/g, " ").toUpperCase();
              const seuC = String(c.seudonimo || "").trim().replace(/\s+/g, " ").toUpperCase();
              if (nomP && (nomC === nomP || seuC === nomP)) return true;
              if (seuP && (nomC === seuP || seuC === nomP)) return true;
              return false;
            });
            if (encontrado) {
              cliente = encontrado;
              break;
            }
          }
        }
      }
    }
  }

  // E. Fallback a membresías `clientes_grupos`
  if (!cliente) {
    try {
      const { data: membresias } = await supabaseAdmin
        .from("clientes_grupos")
        .select("cliente_id")
        .eq("grupo_id", grupoId);

      const idsMembresia = (membresias || [])
        .map((m: any) => m?.cliente_id)
        .filter(Boolean);

      if (idsMembresia.length > 0) {
        const { data: candidatosMem } = await supabaseAdmin
          .from("clientes")
          .select(CAMPOS_CLIENTE_SALA)
          .in("id", idsMembresia);

        if (Array.isArray(candidatosMem) && candidatosMem.length > 0) {
          cliente = candidatosMem.find((c: any) => {
            if (participantJid && (c.whatsapp_jid === participantJid || c.whatsapp_lid === participantJid)) return true;
            if (participantAlt && (c.whatsapp_jid === participantAlt || c.whatsapp_lid === participantAlt)) return true;
            const c10 = extraerUltimos10Digitos(c.telefono_normalizado || c.telefono);
            if (tel10 && c10 && c10 === tel10) return true;
            const nomC = String(c.nombre || "").trim().replace(/\s+/g, " ").toUpperCase();
            const seuC = String(c.seudonimo || "").trim().replace(/\s+/g, " ").toUpperCase();
            if (pushNameValido && (nomC === pushNameValido || seuC === pushNameValido)) return true;
            return false;
          });
        }
      }
    } catch {}
  }

  if (!cliente) return null;

  // F. Persistencia y auto-vinculación de whatsapp_lid y whatsapp_jid en public.clientes
  const updatesCl: Record<string, any> = {};
  if (participantJid) {
    if (participantJid.endsWith("@lid") && cliente.whatsapp_lid !== participantJid) {
      const lidNuevo = participantJid;
      const clienteIdLid = cliente.id;
      const grupoIdLid = cliente.grupo_id;
      cliente.whatsapp_lid = lidNuevo;
      cliente.whatsapp_vinculado = true;
      void (async () => {
        try {
          let qLid = supabaseAdmin
            .from("clientes")
            .update({
              whatsapp_lid: lidNuevo,
              whatsapp_vinculado: true,
              updated_at: new Date().toISOString(),
            })
            .eq("id", clienteIdLid);
          if (grupoIdLid) qLid = qLid.eq("grupo_id", grupoIdLid);
          await qLid;
        } catch {
          // Silencioso para que un eventual conflicto no interrumpa el procesamiento
        }
      })();
    } else if (participantJid.endsWith("@s.whatsapp.net") && cliente.whatsapp_jid !== participantJid) {
      updatesCl.whatsapp_jid = participantJid;
      updatesCl.whatsapp_vinculado = true;
    }
  }
  if (participantAlt && participantAlt.endsWith("@s.whatsapp.net") && !cliente.whatsapp_jid) {
    updatesCl.whatsapp_jid = participantAlt;
    updatesCl.whatsapp_vinculado = true;
  }
  if (!cliente.telefono_normalizado && telReal && telReal.length >= 7) {
    updatesCl.telefono_normalizado = telReal;
  }
  if (Object.keys(updatesCl).length > 0) {
    updatesCl.updated_at = new Date().toISOString();
    let qUpd = supabaseAdmin.from("clientes").update(updatesCl).eq("id", cliente.id);
    if (cliente.grupo_id) {
      qUpd = qUpd.eq("grupo_id", cliente.grupo_id);
    }
    await qUpd;
    if (updatesCl.whatsapp_lid) cliente.whatsapp_lid = updatesCl.whatsapp_lid;
    if (updatesCl.whatsapp_jid) cliente.whatsapp_jid = updatesCl.whatsapp_jid;
    if (updatesCl.telefono_normalizado) cliente.telefono_normalizado = updatesCl.telefono_normalizado;
  }

  const saldoDisponible = calcularSaldoDisponible(cliente);
  if (!cliente.libre && (cliente.saldo_disponible == null || Number(cliente.saldo_disponible) !== saldoDisponible)) {
    let qDisp = supabaseAdmin.from("clientes").update({ saldo_disponible: saldoDisponible }).eq("id", cliente.id);
    if (cliente.grupo_id) {
      qDisp = qDisp.eq("grupo_id", cliente.grupo_id);
    }
    await qDisp;
    cliente.saldo_disponible = saldoDisponible;
  }

  const nombreJugador = cliente.seudonimo || cliente.nombre;
  const telefonoClienteCompleto = resolverTelefonoWhatsappCliente(cliente);

  return {
    id: String(cliente.id),
    grupo_id: cliente.grupo_id ? String(cliente.grupo_id) : undefined,
    nombre: String(cliente.nombre || ""),
    seudonimo: cliente.seudonimo || null,
    saldo_actual: Number(cliente.saldo_actual || 0),
    saldo_retenido: Number(cliente.saldo_retenido || 0),
    saldo_disponible: saldoDisponible,
    libre: Boolean(cliente.libre),
    aval: Number(cliente.aval || cliente.limite_credito || 0),
    whatsapp_jid: cliente.whatsapp_jid || null,
    whatsapp_lid: cliente.whatsapp_lid || null,
    codigo_pais: cliente.codigo_pais || null,
    telefono: cliente.telefono || null,
    telefono_normalizado: cliente.telefono_normalizado || null,
    telefonoClienteCompleto,
    nombreJugador,
    esOperadorRemitente,
    rawCliente: cliente,
  };
}
