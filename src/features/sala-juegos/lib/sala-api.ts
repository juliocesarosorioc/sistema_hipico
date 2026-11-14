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
  portalToken: undefined,
  clienteId: undefined,
  staffToken: undefined,
};

export function configurarCredencialesSala(creds: Partial<CredencialesSala>) {
  _credenciales = { ..._credenciales, ...creds };
  if (typeof window !== "undefined") {
    // `null` significa "este canal no aplica": se borra para que una sesión
    // de portal no se cuele en la Sala de staff (ni al revés).
    if (creds.portalToken === null) sessionStorage.removeItem("sala_portal_token");
    else if (creds.portalToken) sessionStorage.setItem("sala_portal_token", creds.portalToken);
    if (creds.clienteId === null) sessionStorage.removeItem("sala_cliente_id");
    else if (creds.clienteId) sessionStorage.setItem("sala_cliente_id", creds.clienteId);
    if (creds.staffToken === null) {
      sessionStorage.removeItem("sala_staff_token");
      localStorage.removeItem("sala_staff_token");
    } else if (creds.staffToken) {
      sessionStorage.setItem("sala_staff_token", creds.staffToken);
      localStorage.setItem("sala_staff_token", creds.staffToken);
    }
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

    let pToken =
      _credenciales.portalToken === null
        ? null
        : _credenciales.portalToken || sessionStorage.getItem("sala_portal_token") || localStorage.getItem("portal_token");
    let cId =
      _credenciales.clienteId === null
        ? null
        : _credenciales.clienteId || sessionStorage.getItem("sala_cliente_id") || localStorage.getItem("portal_cliente_id");

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
      _credenciales.staffToken === null
        ? null
        : _credenciales.staffToken ||
          sessionStorage.getItem("sala_staff_token") ||
          localStorage.getItem("sala_staff_token");

    return {
      portalToken: pToken || null,
      clienteId: cId || null,
      staffToken: sToken || null,
    };
  }
  return _credenciales;
}

let _restaurandoStaffPromise: Promise<string | null> | null = null;
let _restauracionStaffIntentada = false;

async function headersAuth(): Promise<HeadersInit> {
  const creds = obtenerCredencialesGuardadas();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  let tokenStaff = creds.staffToken;
  if (!tokenStaff && !creds.portalToken && !_restauracionStaffIntentada && typeof window !== "undefined") {
    try {
      const sesionOpLocal = localStorage.getItem("hipico_sesion_operador_local") === "1";
      const rawOp = localStorage.getItem("hipico_operador_actual");
      if (sesionOpLocal && rawOp) {
        const parsedOp = JSON.parse(rawOp);
        const opId = String(parsedOp?.id || "").trim();
        if (opId) {
          _restauracionStaffIntentada = true;
          if (!_restaurandoStaffPromise) {
            _restaurandoStaffPromise = iniciarSesionStaffSala(opId, "__RESTAURAR_OPERADOR_ACTIVO__")
              .then((r) => (r.ok && r.token ? r.token : null))
              .catch(() => null)
              .finally(() => {
                _restaurandoStaffPromise = null;
              });
          }
          const recuperado = await _restaurandoStaffPromise;
          if (recuperado) tokenStaff = recuperado;
        }
      }
    } catch {
      // noop
    }
  }
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

  // La credencial viaja en UN solo canal: portal explícito o staff (JWT/token
  // HMAC). No se envían cookies ni cabeceras de identidad que el navegador
  // pueda falsificar; el servidor ya no las acepta.
  if (creds.portalToken && creds.clienteId) {
    headers["X-Sala-Portal-Token"] = creds.portalToken;
    headers["X-Sala-Cliente-Id"] = creds.clienteId;
  } else if (tokenStaff) {
    headers["Authorization"] = `Bearer ${tokenStaff}`;
  }

  return headers;
}

/**
 * Canjea credenciales de operador por un token HMAC de sala.
 *
 * El token lo firma el servidor tras validar `usuario_sistema.clave_acceso` con
 * la RPC oficial. Es la única sesión de staff que no depende de Supabase Auth.
 */
export async function iniciarSesionStaffSala(
  identificador: string,
  clave: string
): Promise<{ ok: boolean; token?: string; error?: string }> {
  try {
    const res = await fetch("/api/sala", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "sesion-staff", identificador, clave }),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok || !data?.token) {
      return { ok: false, error: data?.error || `Error ${res.status}` };
    }
    if (typeof window !== "undefined") {
      sessionStorage.setItem("sala_staff_token", String(data.token));
      localStorage.setItem("sala_staff_token", String(data.token));
      _credenciales.staffToken = String(data.token);
    }
    return { ok: true, token: String(data.token) };
  } catch (err: any) {
    return { ok: false, error: err?.message || "No se pudo iniciar la sesión de sala." };
  }
}

export function limpiarSesionStaffSala(): void {
  if (typeof window !== "undefined") {
    sessionStorage.removeItem("sala_staff_token");
    localStorage.removeItem("sala_staff_token");
  }
  _credenciales.staffToken = undefined;
  _restauracionStaffIntentada = false;
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

async function requestRecarga<T = any>(
  payload: Record<string, any>
): Promise<{ ok: boolean; data?: T; error?: string; status?: number }> {
  try {
    const headers = await headersAuth();
    const res = await fetch("/api/recargas/validar", {
      method: "POST",
      headers,
      credentials: "include",
      cache: "no-store",
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.ok === false) {
      return {
        ok: false,
        status: res.status,
        error: json.error || `Error ${res.status}: ${res.statusText}`,
      };
    }
    return { ok: true, data: json };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Error de conexión con /api/recargas/validar" };
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
    monto?: number;
    cerrarPropuestaId?: string;
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

  async validarRecarga(payload: {
    grupoId: string;
    clienteId?: string;
    metodoPago: string;
    bancoOrigen: string;
    referencia: string;
    montoReportado: number;
    moneda?: string;
    nombreArchivo?: string;
    hashImagenSha256: string;
  }) {
    return requestRecarga({ ...payload });
  },

  /**
   * @deprecated Usar `validarRecarga`. El endpoint viejo ya no acepta OCR ni
   * confianza IA desde el navegador; este alias existe solo por compatibilidad.
   */
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
  }) {
    return requestRecarga({
      grupoId: payload.grupoId,
      clienteId: payload.clienteId,
      metodoPago: payload.metodoPago,
      bancoOrigen: payload.bancoOrigen,
      referencia: payload.referencia,
      montoReportado: payload.monto,
      moneda: payload.moneda,
      nombreArchivo: payload.comprobanteUrl,
      hashImagenSha256: payload.hashImagenSha256,
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
