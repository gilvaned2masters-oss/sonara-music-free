interface Env {
  ORDERS_KV: KVNamespace;
  ADMIN_PASSWORD: string;
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

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkAuth(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);

  let sub: Record<string, unknown>;
  try { sub = await request.json() as Record<string, unknown>; }
  catch { return json({ ok: false, error: 'invalid_json' }, 400); }

  const endpoint = String(sub['endpoint'] ?? '');
  if (!endpoint) return json({ ok: false, error: 'missing_endpoint' }, 400);

  // Chave única baseada no endpoint
  const hash = btoa(endpoint).slice(0, 40).replace(/[^a-zA-Z0-9]/g, '');
  const key  = 'push_sub:' + hash;

  await env.ORDERS_KV.put(key, JSON.stringify({
    endpoint,
    keys: sub['keys'] ?? {},
    created_at: new Date().toISOString(),
  }), { expirationTtl: 86400 * 60 }); // 60 dias

  return json({ ok: true });
};

// DELETE — remover subscription
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkAuth(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return json({ ok: false, error: 'invalid_json' }, 400); }

  const endpoint = String(body['endpoint'] ?? '');
  const hash = btoa(endpoint).slice(0, 40).replace(/[^a-zA-Z0-9]/g, '');
  await env.ORDERS_KV.delete('push_sub:' + hash);

  return json({ ok: true });
};
