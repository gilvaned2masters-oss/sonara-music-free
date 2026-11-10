import { sendMetaCapiPurchase } from './_shared/meta-capi';

interface Env {
  ORDERS_KV: KVNamespace;
  KIWIFY_WEBHOOK_TOKEN: string;
  META_PIXEL_ID: string;
  META_CAPI_TOKEN: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const PAID_EVENTS = ['PAID', 'pix_paid', 'payment_paid', 'compra_aprovada', 'PAYMENT_CONFIRMED'];

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let payload: Record<string, unknown>;
  try {
    payload = await request.json() as Record<string, unknown>;
  } catch {
    return json({ ok: false }, 400);
  }

  // Validate webhook token if configured
  if (env.KIWIFY_WEBHOOK_TOKEN) {
    const token = String(payload['token'] ?? request.headers.get('X-Kiwify-Token') ?? '');
    if (token !== env.KIWIFY_WEBHOOK_TOKEN) {
      return json({ ok: false, error: 'invalid_token' }, 401);
    }
  }

  const event = String(payload['event'] ?? payload['type'] ?? '');
  const isPaid = PAID_EVENTS.some(e => event.toLowerCase().includes(e.toLowerCase()))
    || payload['status'] === 'PAID'
    || payload['paid'] === true;

  if (!isPaid) {
    return json({ ok: true, ignored: true });
  }

  // Extract payment ID from various Kiwify webhook formats
  const paymentId = String(
    payload['id']
    ?? payload['qrcode_id']
    ?? payload['external_reference_id']
    ?? payload['order_id']
    ?? '',
  ).replace(/[^a-zA-Z0-9_.-]/g, '');

  if (!paymentId) {
    return json({ ok: true, ignored: true });
  }

  const raw = await env.ORDERS_KV.get('order:' + paymentId);
  if (!raw) return json({ ok: true });

  const order = JSON.parse(raw) as Record<string, unknown>;
  order['paid'] = true;
  order['status'] = 'PAID';
  order['updated_at'] = new Date().toISOString();
  order['kiwify_event'] = event;

  await env.ORDERS_KV.put('order:' + paymentId, JSON.stringify(order), {
    expirationTtl: 86400 * 30,
  });

  if (!order['metaCapiSent']) {
    await sendMetaCapiPurchase(env.META_PIXEL_ID, env.META_CAPI_TOKEN, {
      paymentId,
      externalReference: String(order['externalReference'] ?? ''),
      name: String(order['name'] ?? ''),
      email: String(order['email'] ?? ''),
      phone: String(order['phone'] ?? ''),
      value: Number(order['value'] ?? 39.9),
      fbp: String(order['fbp'] ?? ''),
      fbc: String(order['fbc'] ?? ''),
      clientIp: String(order['clientIp'] ?? ''),
      userAgent: String(order['userAgent'] ?? ''),
      pageUrl: String(order['pageUrl'] ?? ''),
    });
  }

  return json({ ok: true });
};
