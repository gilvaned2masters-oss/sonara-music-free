export const KIWIFY_BASE = 'https://conta-public-api.kiwify.com';

// PKCS#8 DER prefix for Ed25519 private key (32-byte seed)
const PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05,
  0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22,
  0x04, 0x20,
]);

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

async function signMessage(privateKeyHex: string, message: string): Promise<string> {
  const seed = hexToBytes(privateKeyHex);
  const pkcs8 = new Uint8Array(PKCS8_PREFIX.length + seed.length);
  pkcs8.set(PKCS8_PREFIX);
  pkcs8.set(seed, PKCS8_PREFIX.length);

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8.buffer,
    { name: 'Ed25519' },
    false,
    ['sign'],
  );

  const sig = await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(message));
  // Kiwify exige a assinatura em base64URL (não base64 padrão) no header X-PoP-Signature.
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function kiwifyHeaders(
  accessId: string,
  privateKeyHex: string,
  method: string,
  path: string,
  body: string,
): Promise<Record<string, string>> {
  const timestamp = Date.now().toString();
  const message = `${path}:${method}:${body}:${timestamp}`;
  const signature = await signMessage(privateKeyHex, message);

  return {
    'Content-Type': 'application/json',
    'x-access-id': accessId,
    'X-PoP-Challenge': timestamp,
    'X-PoP-Format': 'service-account',
    'X-PoP-Signature': signature,
  };
}

export async function kiwifyFetch(
  accessId: string,
  privateKeyHex: string,
  method: string,
  path: string,
  payload?: unknown,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const bodyStr = payload != null ? JSON.stringify(payload) : '';
  const headers = await kiwifyHeaders(accessId, privateKeyHex, method, path, bodyStr);

  const res = await fetch(KIWIFY_BASE + path, {
    method,
    headers,
    ...(bodyStr ? { body: bodyStr } : {}),
  });

  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}
