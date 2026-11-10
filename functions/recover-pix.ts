import { asaas } from './_shared/asaas';
import { kvPutOrder } from './_shared/kv-helpers';

interface Env {
  ORDERS_KV: KVNamespace;
  ASAAS_API_KEY: string;
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
  const b64 = auth.replace(/^Basic\s+/i, '');
  if (!b64) return false;
  try {
    const decoded = atob(b64);
    const [, pass] = decoded.split(':');
    return pass === (env.ADMIN_PASSWORD || '');
  } catch { return false; }
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkAuth(request, env)) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  const url = new URL(request.url);
  const paymentId = url.searchParams.get('paymentId')?.replace(/[^a-zA-Z0-9_.-]/g, '') ?? '';
  if (!paymentId) return json({ ok: false, error: 'missing_payment_id' }, 400);

  // Buscar order no KV
  const raw = await env.ORDERS_KV.get('order:' + paymentId);
  if (!raw) return json({ ok: false, error: 'order_not_found' }, 404);
  const order = JSON.parse(raw) as Record<string, unknown>;

  if (order['paid']) return json({ ok: false, error: 'already_paid' }, 400);

  // Tentar buscar QR code do pagamento existente no Asaas
  const qrRes = await asaas(env.ASAAS_API_KEY, 'GET', `/payments/${paymentId}/pixQrCode`);

  if (qrRes.ok && qrRes.data['payload']) {
    return json({
      ok: true,
      reused: true,
      payload: qrRes.data['payload'],
      encodedImage: qrRes.data['encodedImage'] ?? null,
      name: order['name'],
      phone: order['phone'],
      value: order['value'],
    });
  }

  // PIX expirado — criar novo pagamento Asaas para o mesmo cliente
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 1);
  const dueDateStr = dueDate.toISOString().slice(0, 10);

  const newPay = await asaas(env.ASAAS_API_KEY, 'POST', '/payments', {
    customer: order['customerId'],
    billingType: 'PIX',
    value: Number(order['value'] ?? 29.9),
    dueDate: dueDateStr,
    description: 'Masters Music – recuperação de pedido',
    externalReference: String(order['externalReference'] ?? paymentId),
  });

  if (!newPay.ok || !newPay.data['id']) {
    return json({ ok: false, error: 'asaas_error', detail: newPay.data }, 502);
  }

  const newId = String(newPay.data['id']);
  const newQr = await asaas(env.ASAAS_API_KEY, 'GET', `/payments/${newId}/pixQrCode`);

  if (!newQr.ok || !newQr.data['payload']) {
    return json({ ok: false, error: 'qr_not_ready' }, 502);
  }

  // Salvar novo paymentId no KV (mantém dados do pedido original)
  order['recoveryPaymentId'] = newId;
  order['updated_at'] = new Date().toISOString();
  // kvPutOrder preserva a metadata (email/created_at) — put cru zerava e tornava
  // o pedido invisível pro cron de recuperação (pix-recovery).
  await kvPutOrder(env.ORDERS_KV, paymentId, order);

  return json({
    ok: true,
    reused: false,
    payload: newQr.data['payload'],
    encodedImage: newQr.data['encodedImage'] ?? null,
    newPaymentId: newId,
    name: order['name'],
    phone: order['phone'],
    value: order['value'],
  });
};
