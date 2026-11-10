interface Env {
  ORDERS_KV: KVNamespace;
  ADMIN_PASSWORD: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function checkAuth(request: Request, env: Env): boolean {
  const auth = request.headers.get('Authorization') ?? '';
  const b64  = auth.replace(/^Basic\s+/i, '');
  if (!b64) return false;
  try {
    const [, pass] = atob(b64).split(':');
    return pass === (env.ADMIN_PASSWORD || '');
  } catch { return false; }
}

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...u8)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g,'+').replace(/_/g,'/');
  const padded = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=');
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

async function makeVapidJWT(privateKeyB64u: string, publicKeyB64u: string, endpoint: string): Promise<string> {
  const pubBytes = fromB64url(publicKeyB64u); // 65 bytes: 04 | x(32) | y(32)
  const x = b64url(pubBytes.slice(1, 33));
  const y = b64url(pubBytes.slice(33, 65));

  const jwk = { kty: 'EC', crv: 'P-256', d: privateKeyB64u, x, y, key_ops: ['sign'], ext: true };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

  const origin    = new URL(endpoint).origin;
  const header    = btoa(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const payload   = btoa(JSON.stringify({ aud: origin, exp: Math.floor(Date.now()/1000) + 43200, sub: 'mailto:contato@mastersmusic.com.br' })).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const input     = `${header}.${payload}`;
  const sig       = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(input));

  return `${input}.${b64url(sig)}`;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkAuth(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);

  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return json({ ok: false, error: 'vapid_not_configured' }, 500);
  }

  let body: Record<string, unknown> = {};
  try { body = await request.json() as Record<string, unknown>; } catch {}

  const title   = String(body['title']   ?? '🎵 Nova venda!');
  const message = String(body['message'] ?? 'Masters Music — toque para ver o pedido');

  // Buscar todas as subscriptions
  const list = await env.ORDERS_KV.list({ prefix: 'push_sub:', limit: 100 });
  console.log('[push] subscriptions found:', list.keys.length);
  if (list.keys.length === 0) return json({ ok: true, sent: 0 });

  // Guardar detalhes da notificação em KV por 5 min para o SW buscar
  const notifKey = 'push_notif:' + Date.now();
  await env.ORDERS_KV.put(notifKey, JSON.stringify({ title, body: message }), { expirationTtl: 300 });

  let sent = 0;
  await Promise.allSettled(
    list.keys.map(async k => {
      const raw = await env.ORDERS_KV.get(k.name);
      if (!raw) return;

      const sub = JSON.parse(raw) as { endpoint: string; keys: { p256dh?: string; auth?: string } };
      const { endpoint } = sub;

      try {
        const jwt = await makeVapidJWT(env.VAPID_PRIVATE_KEY, env.VAPID_PUBLIC_KEY, endpoint);

        // Envia SEM body — evita necessidade de criptografia AES-128-GCM
        // O SW usa mensagem padrão; detalhes ficam em KV
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `vapid t=${jwt},k=${env.VAPID_PUBLIC_KEY}`,
            'TTL': '86400',
            'Content-Length': '0',
          },
        });

        console.log('[push] endpoint:', endpoint.slice(0, 60), 'status:', res.status);

        if (res.status === 201 || res.status === 200 || res.status === 202) {
          sent++;
        } else if (res.status === 410 || res.status === 404) {
          await env.ORDERS_KV.delete(k.name);
          console.log('[push] removed expired subscription:', k.name);
        } else {
          const errBody = await res.text().catch(() => '');
          console.log('[push] unexpected status:', res.status, 'body:', errBody.slice(0, 200));
        }
      } catch(e) {
        console.log('[push] exception for', k.name, ':', String(e));
      }
    })
  );

  return json({ ok: true, sent, total: list.keys.length });
};
