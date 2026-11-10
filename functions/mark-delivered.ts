import { kvPutOrder } from './_shared/kv-helpers';

interface Env { ORDERS_KV: KVNamespace; }

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  try {
    const { paymentId } = await request.json() as { paymentId?: string };
    const pid = (paymentId || '').replace(/[^a-zA-Z0-9_.-]/g, '');
    if (!pid) return new Response(JSON.stringify({ ok: false }), { status: 400, headers });

    const raw = await env.ORDERS_KV.get('order:' + pid);
    if (!raw) return new Response(JSON.stringify({ ok: false }), { status: 404, headers });

    const order = JSON.parse(raw) as Record<string, unknown>;
    if (!order['paid'] || !order['mp3_url']) {
      return new Response(JSON.stringify({ ok: false }), { status: 400, headers });
    }
    if (!order['delivered']) {
      order['delivered']    = true;
      order['delivered_at'] = new Date().toISOString();
      order['updated_at']   = new Date().toISOString();
      await kvPutOrder(env.ORDERS_KV, pid, order);
    }
    return new Response(JSON.stringify({ ok: true }), { headers });
  } catch {
    return new Response(JSON.stringify({ ok: false }), { status: 500, headers });
  }
};
