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

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let input: Record<string, unknown>;
  try { input = await request.json() as Record<string, unknown>; }
  catch { return json({ ok: false, error: 'invalid_json' }, 400); }

  const orderId = String(input['orderId'] ?? '').replace(/[^a-zA-Z0-9_.-]/g, '');
  if (!orderId) return json({ ok: false, error: 'missing_order_id' }, 400);

  const raw = env.ORDERS_KV ? await env.ORDERS_KV.get('order:' + orderId) : null;
  if (!raw) return json({ ok: false, error: 'order_not_found' }, 404);

  const order = JSON.parse(raw) as Record<string, unknown>;

  // Se já existe um pagamento de arte pendente ou pago, reutilizar
  if (order['artPaymentId']) {
    const existingId = String(order['artPaymentId']);
    // Verificar se já foi pago
    if (order['artPaid'] === true) {
      return json({ ok: true, alreadyPaid: true });
    }
    // Buscar QR code do pagamento existente
    const qrRes = await asaas(env.ASAAS_API_KEY, 'GET', `/payments/${encodeURIComponent(existingId)}/pixQrCode`);
    if (qrRes.ok) {
      return json({
        ok: true,
        paymentId: existingId,
        encodedImage: qrRes.data['encodedImage'] ?? null,
        payload: qrRes.data['payload'] ?? null,
        expirationDate: qrRes.data['expirationDate'] ?? null,
      });
    }
  }

  // Usar customerId já existente no order
  const customerId = String(order['customerId'] ?? '');
  if (!customerId) return json({ ok: false, error: 'no_customer_id' }, 422);

  // Criar cobrança PIX de R$9,00 para a arte
  const paymentRes = await asaas(env.ASAAS_API_KEY, 'POST', '/payments', {
    customer: customerId,
    billingType: 'PIX',
    value: 9.00,
    dueDate: new Date().toISOString().slice(0, 10),
    description: 'Masters Music — Arte da letra personalizada',
    externalReference: 'art-' + orderId,
  });

  if (!paymentRes.ok || !paymentRes.data['id']) {
    return json({ ok: false, error: 'payment_failed', detail: paymentRes.data }, 422);
  }

  const artPaymentId = String(paymentRes.data['id']);

  // Buscar QR code
  const qrRes = await asaas(env.ASAAS_API_KEY, 'GET', `/payments/${encodeURIComponent(artPaymentId)}/pixQrCode`);
  if (!qrRes.ok) return json({ ok: false, error: 'qr_failed' }, 422);

  // Salvar artPaymentId no order
  order['artPaymentId'] = artPaymentId;
  order['updated_at'] = new Date().toISOString();
  await env.ORDERS_KV.put('order:' + orderId, JSON.stringify(order), { expirationTtl: 86400 * 30 });

  return json({
    ok: true,
    paymentId: artPaymentId,
    encodedImage: qrRes.data['encodedImage'] ?? null,
    payload: qrRes.data['payload'] ?? null,
    expirationDate: qrRes.data['expirationDate'] ?? null,
  });
};
