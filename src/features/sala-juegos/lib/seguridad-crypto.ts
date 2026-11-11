// LÍNEA 1: Motor de Cifrado Punto a Punto (AES-256-GCM) y Huella SHA-256 Nativa

export async function generarHashTextoSHA256(texto: string): Promise<string> {
  if (typeof window === 'undefined' || !window.crypto?.subtle) return '';
  const encoder = new TextEncoder();
  const data = encoder.encode(texto);
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function generarHashArchivoSHA256(archivo: File): Promise<string> {
  const arrayBuffer = await archivo.arrayBuffer();
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', arrayBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function derivarClaveGrupoAES(grupoId: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(`SH-E2EE-${grupoId}-KEY-2026`),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(`SALT-${grupoId}`),
      iterations: 10000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function cifrarMensajeSala(textoPlano: string, grupoId: string): Promise<string> {
  try {
    const key = await derivarClaveGrupoAES(grupoId);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(textoPlano);
    const ciphertext = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

    const combinado = new Uint8Array(iv.length + ciphertext.byteLength);
    combinado.set(iv, 0);
    combinado.set(new Uint8Array(ciphertext), iv.length);

    return btoa(String.fromCharCode(...combinado));
  } catch {
    return '';
  }
}

export async function descifrarMensajeSala(payloadBase64: string, grupoId: string): Promise<string> {
  try {
    const key = await derivarClaveGrupoAES(grupoId);
    const binario = atob(payloadBase64);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);

    const iv = bytes.slice(0, 12);
    const data = bytes.slice(12);
    const decrypted = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(decrypted);
  } catch {
    return '[Mensaje protegido]';
  }
}