interface Env {
  ORDERS_KV: KVNamespace;
}

const VALID = new Set([
  'funnel_open',
  'lyrics_generated',
  'preview_played',
  'preview_ended',
  'checkout_reached',
  'pix_generated',
]);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: Record<string, unknown> = {};
  try { body = await request.json() as Record<string, unknown>; } catch {}

  const event = String(body['event'] ?? '');
  if (!VALID.has(event)) {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_event' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const today = new Intl.DateTimeFormat('sv', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const key = `analytics:${today}`;

  const raw = await env.ORDERS_KV.get(key);
  const data: Record<string, number> = raw ? JSON.parse(raw) as Record<string, number> : {};
  data[event] = (data[event] || 0) + 1;

  await env.ORDERS_KV.put(key, JSON.stringify(data), { expirationTtl: 86400 * 90 });

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
