// Autenticação leve da área do cliente: login por email + código de 6 dígitos.
// KV: logincode:{email} → {code} (TTL 15min) ; session:{token} → {email} (TTL 30 dias).

export function normEmail(e: unknown): string {
  return String(e ?? '').trim().toLowerCase();
}

function randBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

export function genCode(): string {
  const a = randBytes(4);
  const n = ((a[0] << 16) | (a[1] << 8) | a[2]) % 1000000;
  return String(n).padStart(6, '0');
}

export function genToken(): string {
  return Array.from(randBytes(24)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createSession(kv: KVNamespace, email: string): Promise<string> {
  const token = genToken();
  await kv.put('session:' + token, JSON.stringify({ email, created: new Date().toISOString() }), { expirationTtl: 86400 * 30 });
  return token;
}

export async function verifySession(kv: KVNamespace, token: unknown): Promise<string | null> {
  const t = String(token ?? '').replace(/[^a-f0-9]/g, '');
  if (!t) return null;
  const raw = await kv.get('session:' + t);
  if (!raw) return null;
  try { return (JSON.parse(raw).email as string) || null; } catch { return null; }
}
