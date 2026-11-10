import { getPricing, sanitizePricing } from './_shared/pricing';

interface Env { ORDERS_KV: KVNamespace; ADMIN_PASSWORD: string; }

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function checkAuth(request: Request, env: Env): boolean {
  const auth = request.headers.get('Authorization') ?? '';
  const b64 = auth.replace(/^Basic\s+/i, '');
  if (!b64) return false;
  try {
    const decoded = atob(b64);
    const idx = decoded.indexOf(':');
    const pass = idx >= 0 ? decoded.slice(idx + 1) : decoded; // seguro p/ senha com ':'
    return pass === (env.ADMIN_PASSWORD || '');
  } catch { return false; }
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkAuth(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);
  if (request.method.toUpperCase() === 'GET') {
    return json({ ok: true, pricing: await getPricing(env.ORDERS_KV) });
  }
  if (request.method.toUpperCase() === 'POST') {
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return json({ ok: false, error: 'invalid_json' }, 400); }
    const next = sanitizePricing(body, await getPricing(env.ORDERS_KV));
    if (env.ORDERS_KV) await env.ORDERS_KV.put('config:pricing', JSON.stringify(next));
    return json({ ok: true, pricing: next });
  }
  return json({ ok: false, error: 'method_not_allowed' }, 405);
};
