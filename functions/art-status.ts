import { asaas } from './_shared/asaas';

interface Env {
  ORDERS_KV: KVNamespace;
  ASAAS_API_KEY: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const PAID_STATUSES = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const orderId = (url.searchParams.get('orderId') ?? '').replace(/[^a-zA-Z0-9_.-]/g, '');
  if (!orderId) return json({ ok: false, error: 'missing_order_id' }, 400);

  const raw = env.ORDERS_KV ? await env.ORDERS_KV.get('order:' + orderId) : null;
  if (!raw) return json({ ok: false, error: 'order_not_found' }, 404);

  const order = JSON.parse(raw) as Record<string, unknown>;

  if (order['artPaid'] === true) return json({ ok: true, paid: true });

  const artPaymentId = String(order['artPaymentId'] ?? '');
  if (!artPaymentId) return json({ ok: true, paid: false, status: 'NO_PAYMENT' });

  const res = await asaas(env.ASAAS_API_KEY, 'GET', `/payments/${encodeURIComponent(artPaymentId)}`);
  if (!res.ok) return json({ ok: true, paid: false, status: 'UNKNOWN' });

  const status = String(res.data['status'] ?? '');
  const isPaid = PAID_STATUSES.includes(status);

  if (isPaid) {
    order['artPaid'] = true;
    order['updated_at'] = new Date().toISOString();
    await env.ORDERS_KV.put('order:' + orderId, JSON.stringify(order), { expirationTtl: 86400 * 30 });
  }

  return json({ ok: true, paid: isPaid, status });
};
