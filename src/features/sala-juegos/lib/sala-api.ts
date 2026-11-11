/**
 * Cliente API para la Sala de Juegos (/api/sala)
 * Gestiona automáticamente las cabeceras de autenticación (Portal Token o Staff Token).
 */

export interface CredencialesSala {
  portalToken?: string | null;
  clienteId?: string | null;
  staffToken?: string | null;
}

let _credenciales: CredencialesSala = {
  portalToken: null,
  clienteId: null,
  staffToken: null,
};

export function configurarCredencialesSala(creds: Partial<CredencialesSala>) {
  _credenciales = { ..._credenciales, ...creds };
  if (typeof window !== "undefined") {
    if (creds.portalToken) sessionStorage.setItem("sala_portal_token", creds.portalToken);
    if (creds.clienteId) sessionStorage.setItem("sala_cliente_id", creds.clienteId);
    if (creds.staffToken) sessionStorage.setItem("sala_staff_token", creds.staffToken);
  }
}

export function obtenerCredencialesGuardadas(): CredencialesSala {
  if (typeof window !== "undefined") {
    return {
      portalToken: _credenciales.portalToken || sessionStorage.getItem("sala_portal_token") || localStorage.getItem("portal_token"),
      clienteId: _credenciales.clienteId || sessionStorage.getItem("sala_cliente_id") || localStorage.getItem("portal_cliente_id"),
      staffToken: _credenciales.staffToken || sessionStorage.getItem("sala_staff_token") || localStorage.getItem("supabase_auth_token"),
    };
  }
  return _credenciales;
}

function headersAuth(): HeadersInit {
  const creds = obtenerCredencialesGuardadas();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (creds.portalToken && creds.clienteId) {
    headers["X-Sala-Portal-Token"] = creds.portalToken;
    headers["X-Sala-Cliente-Id"] = creds.clienteId;
  }

  if (creds.staffToken) {
    headers["Authorization"] = `Bearer ${creds.staffToken}`;
  }

  return headers;
}

async function requestApi<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const url = `/api/sala${endpoint}`;
    const mergedHeaders = { ...headersAuth(), ...(options.headers as Record<string, string> || {}) };
    const res = await fetch(url, { ...options, headers: mergedHeaders });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: json.error || `Error ${res.status}: ${res.statusText}` };
    }
    return { ok: true, data: json };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Error de conexión con /api/sala" };
  }
}

export const salaApi = {
  async bootstrap(grupoId?: string) {
    const q = grupoId ? `?accion=bootstrap&grupoId=${encodeURIComponent(grupoId)}` : "?accion=bootstrap";
    return requestApi(q);
  },

  async getEstado(grupoId?: string) {
    const q = grupoId ? `?accion=estado&grupoId=${encodeURIComponent(grupoId)}` : "?accion=estado";
    return requestApi(q);
  },

  async getMensajes(salaId: string, limit = 50) {
    return requestApi(`?accion=mensajes&salaId=${encodeURIComponent(salaId)}&limit=${limit}`);
  },

  async getPublicidad(grupoId: string) {
    return requestApi(`?accion=publicidad&grupoId=${encodeURIComponent(grupoId)}`);
  },

  async getGrupos() {
    return requestApi("?accion=grupos");
  },

  async getCliente(clienteId?: string) {
    const q = clienteId ? `?accion=cliente&clienteId=${encodeURIComponent(clienteId)}` : "?accion=cliente";
    return requestApi(q);
  },

  async enviarMensaje(payload: {
    salaId: string;
    grupoId: string;
    texto: string;
    tipo?: string;
    propuestaId?: string;
    destinatarioPrivadoId?: string;
    replyToMsgId?: string;
    imagenUrl?: string;
  }) {
    return requestApi("", {
      method: "POST",
      body: JSON.stringify({ accion: "mensaje", ...payload }),
    });
  },

  async registrarRevisionLLM(payload: {
    salaId: string;
    grupoId: string;
    mensajeOriginal: string;
    jugadaSugerida: string;
    intencion: string;
    respuestaIa: string;
    confianza: number;
    requiereIntervencionHumana: boolean;
  }) {
    return requestApi("", {
      method: "POST",
      body: JSON.stringify({ accion: "revision-llm", ...payload }),
    });
  },

  async procesarRecarga(payload: {
    grupoId: string;
    clienteId?: string;
    metodoPago: string;
    bancoOrigen: string;
    referencia: string;
    monto: number;
    moneda?: string;
    tasaCambio?: number;
    comprobanteUrl?: string;
    hashImagenSha256: string;
    datosOcrIa?: any;
    confianzaIa?: number;
  }) {
    return requestApi("", {
      method: "POST",
      body: JSON.stringify({ accion: "recarga", ...payload }),
    });
  },

  async accionOperador(subaccion: string, payload: Record<string, any>) {
    return requestApi("", {
      method: "POST",
      body: JSON.stringify({ accion: "operador", subaccion, ...payload }),
    });
  },

  async accionSala(subaccion: string, payload: Record<string, any>) {
    return requestApi("", {
      method: "POST",
      body: JSON.stringify({ accion: "sala", subaccion, ...payload }),
    });
  },
};
