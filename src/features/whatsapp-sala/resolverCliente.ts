import { supabaseAdmin } from "@/core/supabase-admin";
import type { ClienteResuelto } from "./types";

export function normalizarTelefono(raw?: string | null): string {
  if (!raw) return "";
  // Soporta JID WhatsApp (5842...@s.whatsapp.net / @lid), sufijos de dispositivo (:12),
  // formatos internacionales (+58, 0058), espacios, guiones, paréntesis y puntos.
  return String(raw)
    .replace(/@.*$/, "")
    .replace(/:.*$/, "")
    .replace(/\D/g, "");
}

/** Quita prefijos internacionales/portadores comunes para obtener el número nacional base. */
export function normalizarDigitosTelefonoBase(raw?: string | null): string {
  let digits = normalizarTelefono(raw);
  if (!digits) return "";
  // 0058... -> 58...
  if (digits.startsWith("00")) digits = digits.replace(/^00+/, "");
  return digits;
}

export function extraerUltimos10Digitos(raw?: string | null): string {
  if (!raw) return "";
  const soloDigitos = normalizarDigitosTelefonoBase(raw);
  if (soloDigitos.length >= 10) return soloDigitos.slice(-10);
  return soloDigitos.length >= 7 ? soloDigitos : "";
}

/**
 * Variantes canónicas de un teléfono para comparación robusta (sin formato).
 * Incluye: dígitos completos, sin prefijo 00, sin 0 nacional, con/sin 58,
 * últimos 10 dígitos y forma 58+10 cuando aplica (Venezuela y similares).
 */
export function variantesTelefono(raw?: string | null, codigoPaisDefecto = "58"): string[] {
  const base = normalizarDigitosTelefonoBase(raw);
  if (!base) return [];
  const cp = String(codigoPaisDefecto || "58").replace(/\D/g, "") || "58";
  const set = new Set<string>();
  const add = (v?: string | null) => {
    const d = String(v || "").replace(/\D/g, "");
    if (d.length >= 7) set.add(d);
  };

  add(base);
  add(base.replace(/^0+/, ""));

  if (base.startsWith(cp)) {
    add(base.slice(cp.length));
    add(base.slice(cp.length).replace(/^0+/, ""));
  } else {
    add(`${cp}${base.replace(/^0+/, "")}`);
  }

  const u10 = base.length >= 10 ? base.slice(-10) : base;
  add(u10);
  add(u10.replace(/^0+/, ""));
  if (u10.length === 10) {
    add(`${cp}${u10}`);
    add(`0${u10}`);
  }

  // Caso frecuente: 11 dígitos con 0 nacional (0424...) -> 10 significativos
  if (base.length === 11 && base.startsWith("0")) {
    add(base.slice(1));
    add(`${cp}${base.slice(1)}`);
  }

  return Array.from(set).filter((d) => d.length >= 7 && d.length <= 15);
}

export function telefonosCoinciden(a?: string | null, b?: string | null, codigoPaisDefecto = "58"): boolean {
  const va = variantesTelefono(a, codigoPaisDefecto);
  const vb = new Set(variantesTelefono(b, codigoPaisDefecto));
  if (va.length === 0 || vb.size === 0) return false;
  for (const v of va) if (vb.has(v)) return true;
  // Respaldo: comparar núcleo de últimos 10 dígitos si ambos son suficientemente largos
  const a10 = extraerUltimos10Digitos(a);
  const b10 = extraerUltimos10Digitos(b);
  return Boolean(a10 && b10 && a10.length >= 10 && b10.length >= 10 && a10 === b10);
}

export function normalizarTelefonoCompleto(codigoPais?: string | null, telefono?: string | null): string {
  const cp = String(codigoPais || "").replace(/\D/g, "");
  const telBase = normalizarDigitosTelefonoBase(telefono).replace(/^0+/, "");
  if (!telBase) return cp;
  if (!cp) return telBase;
  if (telBase.startsWith(cp)) return telBase;
  // Si ya parece número internacional de otro país, no forzar prefijo
  if (telBase.length > 11) return telBase;
  return `${cp}${telBase}`;
}

export function resolverTelefonoWhatsappCliente(cliente: any): string | null {
  const codigoPais = String(cliente?.codigo_pais || "58").replace(/\D/g, "") || "58";
  const raw =
    cliente?.telefono_normalizado ||
    normalizarTelefonoCompleto(cliente?.codigo_pais, cliente?.telefono) ||
    cliente?.telefono ||
    "";
  const digits = normalizarDigitosTelefonoBase(raw);
  if (!digits) return null;

  if (digits.startsWith(codigoPais) && digits.length >= 10) return digits;
  if (digits.length === 12 && digits.startsWith("58")) return digits;

  const u10 = extraerUltimos10Digitos(digits);
  // Venezuela: móviles suelen iniciar en 4/2 (0412, 0424, 0414, 0416, 0426, 0212, etc.)
  if (u10.length === 10 && /^[24]/.test(u10)) {
    return `${codigoPais}${u10}`;
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    return `${codigoPais}${digits.slice(1)}`;
  }
  return digits.startsWith(codigoPais) ? digits : (digits.length >= 10 ? `${codigoPais}${digits}` : digits);
}

export function calcularSaldoDisponible(cliente: any): number {
  if (!cliente) return 0;
  if (cliente.libre) return 999999;
  const saldo = Number(cliente.saldo_actual ?? 0);
  const aval = Number(cliente.aval ?? cliente.limite_credito ?? 0);
  const retenido = Number(cliente.saldo_retenido ?? 0);
  const dispCalculado = Math.max(0, Number((saldo + aval - retenido).toFixed(2)));
  if (saldo > 0 || aval > 0 || retenido > 0) {
    return dispCalculado;
  }
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
  const telAlt = normalizarDigitosTelefonoBase(participantAlt);
  let telReal = normalizarDigitosTelefonoBase(telefonoRealProp);
  if (!telReal) {
    if (participantAlt && participantAlt.endsWith("@s.whatsapp.net")) {
      telReal = telAlt;
    } else if (participantJid && participantJid.endsWith("@s.whatsapp.net")) {
      telReal = normalizarDigitosTelefonoBase(participantJid);
    } else if (!esLid && normalizarDigitosTelefonoBase(participantJid).length >= 7 && normalizarDigitosTelefonoBase(participantJid).length <= 15) {
      telReal = normalizarDigitosTelefonoBase(participantJid);
    } else if (!esAltLid && telAlt && telAlt.length >= 7 && telAlt.length <= 15) {
      telReal = telAlt;
    }
  }

  const candidatosTel = [
    telReal,
    telefonoRealProp,
    !esLid ? participantJid : "",
    !esAltLid ? participantAlt : "",
    telAlt,
  ].filter(Boolean);
  const tel10 =
    candidatosTel.map((v) => extraerUltimos10Digitos(v)).find((v) => v.length >= 10) ||
    extraerUltimos10Digitos(telReal || telAlt || participantJid || participantAlt || "");
  const variantesTel = Array.from(
    new Set(candidatosTel.flatMap((v) => variantesTelefono(v, "58")))
  );
  const patronesTelIlike = Array.from(
    new Set(
      [tel10, tel10 ? `0${tel10}` : "", tel10 ? `58${tel10}` : "", telReal, telAlt]
        .map((v) => String(v || "").replace(/\D/g, ""))
        .filter((v) => v.length >= 7)
        .flatMap((v) => {
          const out = [v];
          const u = extraerUltimos10Digitos(v);
          if (u.length >= 10) out.push(u, `0${u}`, `58${u}`);
          return out;
        })
        .filter((v) => v.length >= 7)
    )
  ).slice(0, 8);

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
  // B. Normalización y búsqueda por dígitos (últimos 10 / variantes completas)
  if (!cliente && patronesTelIlike.length > 0) {
    const filtrosTel = Array.from(
      new Set(
        patronesTelIlike.flatMap((p) => [
          `telefono.ilike.%${p}%`,
          `telefono_normalizado.ilike.%${p}%`,
        ])
      )
    );
    const { data: clPorTel } = await supabaseAdmin
      .from("clientes")
      .select(CAMPOS_CLIENTE_SALA)
      .eq("grupo_id", grupoId)
      .or(filtrosTel.join(","))
      .order("saldo_actual", { ascending: false })
      .limit(20);

    if (Array.isArray(clPorTel) && clPorTel.length > 0) {
      cliente =
        clPorTel.find((c: any) =>
          candidatosTel.some((t) =>
            telefonosCoinciden(c.telefono_normalizado || c.telefono, t, c.codigo_pais || "58")
          ) ||
          (tel10 ? telefonosCoinciden(c.telefono_normalizado || c.telefono, tel10, c.codigo_pais || "58") : false)
        ) ||
        clPorTel[0] ||
        null;
    }
  }

  // C. Búsqueda en memoria sobre todos los clientes del grupo (10 dígitos o pushName)
  if (!cliente) {
    const { data: candidatosGrupo } = await supabaseAdmin
      .from("clientes")
      .select(CAMPOS_CLIENTE_SALA)
      .eq("grupo_id", grupoId);

    if (Array.isArray(candidatosGrupo) && candidatosGrupo.length > 0) {
      if (!cliente && (tel10 || variantesTel.length > 0 || candidatosTel.length > 0)) {
        cliente = candidatosGrupo.find((c: any) => {
          const telC = c.telefono_normalizado || normalizarTelefonoCompleto(c.codigo_pais, c.telefono) || c.telefono;
          if (candidatosTel.some((t) => telefonosCoinciden(telC, t, c.codigo_pais || "58"))) return true;
          if (tel10 && telefonosCoinciden(telC, tel10, c.codigo_pais || "58")) return true;
          const c10 = extraerUltimos10Digitos(telC);
          return Boolean(tel10 && c10 && c10 === tel10);
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
    if (patronesTelIlike.length > 0) {
      for (const p of patronesTelIlike.slice(0, 4)) {
        orPistas.push(`telefono.ilike.%${p}%`);
        orPistas.push(`telefono_normalizado.ilike.%${p}%`);
      }
    } else if (tel10) {
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
              const telC = c.telefono_normalizado || normalizarTelefonoCompleto(c.codigo_pais, c.telefono) || c.telefono;
              const c10 = extraerUltimos10Digitos(telC);
              if (p10 && c10 && p10 === c10) return true;
              if (p10 && telefonosCoinciden(telC, p10, c.codigo_pais || "58")) return true;
              const telPistaRaw = pista.telefono_normalizado || pista.telefono;
              if (telPistaRaw && telefonosCoinciden(telC, telPistaRaw, c.codigo_pais || "58")) return true;
              const nomC = String(c.nombre || "").trim().replace(/\s+/g, " ").toUpperCase();
              const seuC = String(c.seudonimo || "").trim().replace(/\s+/g, " ").toUpperCase();
              if (nomP && (nomC === nomP || seuC === nomP)) return true;
              if (seuP && (nomC === seuP || seuC === seuP)) return true;
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
            const telC = c.telefono_normalizado || normalizarTelefonoCompleto(c.codigo_pais, c.telefono) || c.telefono;
            if (candidatosTel.some((t) => telefonosCoinciden(telC, t, c.codigo_pais || "58"))) return true;
            const c10 = extraerUltimos10Digitos(telC);
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
