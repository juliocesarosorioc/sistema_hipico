import { supabase } from "@/core/supabase";

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
    // Si la URL trae parámetros de cliente o token, tomarlos prioritariamente
    try {
      const sp = new URLSearchParams(window.location.search);
      const urlPortalToken = sp.get("token") || sp.get("portalToken") || sp.get("portal_token");
      const urlClienteId = sp.get("clienteId") || sp.get("cliente_id");
      const urlStaffToken = sp.get("staffToken") || sp.get("staff_token");

      if (urlPortalToken) {
        _credenciales.portalToken = urlPortalToken;
        sessionStorage.setItem("sala_portal_token", urlPortalToken);
      }
      if (urlClienteId) {
        _credenciales.clienteId = urlClienteId;
        sessionStorage.setItem("sala_cliente_id", urlClienteId);
      }
      if (urlStaffToken) {
        _credenciales.staffToken = urlStaffToken;
        sessionStorage.setItem("sala_staff_token", urlStaffToken);
      }
    } catch {
      // Ignorar fallos de URL
    }

    let pToken = _credenciales.portalToken || sessionStorage.getItem("sala_portal_token") || localStorage.getItem("portal_token");
    let cId = _credenciales.clienteId || sessionStorage.getItem("sala_cliente_id") || localStorage.getItem("portal_cliente_id");

    // Respaldo desde portal.cliente (usado por el Portal del Cliente)
    if (!pToken || !cId) {
      try {
        const rawPortal = localStorage.getItem("portal.cliente");
        if (rawPortal) {
          const parsed = JSON.parse(rawPortal);
          if (!pToken && parsed?.token) pToken = String(parsed.token);
          if (!cId && (parsed?.id || parsed?.cliente?.id)) {
            cId = String(parsed?.id || parsed?.cliente?.id);
          }
        }
      } catch {
        // noop
      }
    }

    const sToken =
      _credenciales.staffToken ||
      sessionStorage.getItem("sala_staff_token") ||
      localStorage.getItem("supabase_auth_token");

    return {
      portalToken: pToken || null,
      clienteId: cId || null,
      staffToken: sToken || null,
    };
  }
  return _credenciales;
}

async function headersAuth(): Promise<HeadersInit> {
  const creds = obtenerCredencialesGuardadas();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  let tokenStaff = creds.staffToken;
  if (!tokenStaff && typeof window !== "undefined" && supabase) {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) {
        const exp = data.session.expires_at;
        // Solo enviar token si no está vencido
        if (!exp || Date.now() / 1000 < exp - 10) {
          tokenStaff = data.session.access_token;
        }
      }
    } catch {
      // noop
    }
  }

  let tieneStaffLocal = Boolean(tokenStaff);
  if (typeof window !== "undefined" && !tieneStaffLocal) {
    try {
      tieneStaffLocal = Boolean(
        localStorage.getItem("hipico_usuario") ||
          localStorage.getItem("hipico_sesion_admin_local") ||
          localStorage.getItem("hipico_operador_actual") ||
          document.cookie.includes("hipico_usuario=")
      );
    } catch {
      /* noop */
    }
  }

  const portalExplicito = Boolean(_credenciales.portalToken && _credenciales.clienteId);
  if (creds.portalToken && creds.clienteId && (portalExplicito || !tieneStaffLocal)) {
    headers["X-Sala-Portal-Token"] = creds.portalToken;
    headers["X-Sala-Cliente-Id"] = creds.clienteId;
  }

  if (tokenStaff) {
    headers["Authorization"] = `Bearer ${tokenStaff}`;
  }

  // Enviar respaldo de identidad de sesión de la aplicación (Staff / Operador)
  if (typeof window !== "undefined") {
    try {
      let u =
        localStorage.getItem("hipico_usuario") ||
        localStorage.getItem("hipico_sesion_admin_local");
      let p = localStorage.getItem("hipico_perfil");
      let perm = localStorage.getItem("hipico_permisos");
      let g = localStorage.getItem("hipico_grupo_activo");

      if (!u) {
        const rawOp = localStorage.getItem("hipico_operador_actual");
        if (rawOp) {
          try {
            const parsedOp = JSON.parse(rawOp);
            u = parsedOp.nombre || parsedOp.usuario || parsedOp.id || "";
            if (!g && parsedOp.grupo_id) g = String(parsedOp.grupo_id);
          } catch {
            u = rawOp;
          }
        }
      }

      // Si localStorage no tiene alguno de los campos, extraer de document.cookie
      if (document.cookie) {
        const cookies: Record<string, string> = {};
        document.cookie.split(";").forEach((pair) => {
          const [k, ...v] = pair.trim().split("=");
          if (k) cookies[k] = decodeURIComponent(v.join("="));
        });
        if (!u && cookies["hipico_usuario"]) u = cookies["hipico_usuario"];
        if (!p && cookies["hipico_perfil"]) p = cookies["hipico_perfil"];
        if (!perm && cookies["hipico_permisos"]) perm = cookies["hipico_permisos"];
        if (!g && cookies["hipico_grupo_activo"]) g = cookies["hipico_grupo_activo"];
      }

      // Si es admin principal o sesión admin activa
      if (u === "josorioc" || localStorage.getItem("hipico_sesion_admin_local")) {
        u = "josorioc";
        p = "admin";
        perm = "*";
      }

      if (u) headers["X-Sala-Usuario"] = u;
      if (p) headers["X-Sala-Perfil"] = p;
      if (perm) headers["X-Sala-Permisos"] = perm;
      if (g) headers["X-Sala-Grupo"] = g;
    } catch {
      // noop
    }
  }

  return headers;
}

async function requestApi<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; data?: T; error?: string; status?: number }> {
  try {
    const url = `/api/sala${endpoint}`;
    const authH = await headersAuth();
    const mergedHeaders = { ...authH, ...(options.headers as Record<string, string> || {}) };
    const res = await fetch(url, {
      ...options,
      headers: mergedHeaders,
      credentials: "include", // Enviar cookies de sesión de forma garantizada
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: res.status, error: json.error || `Error ${res.status}: ${res.statusText}` };
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
