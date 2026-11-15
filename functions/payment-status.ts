import { settleEfiOrder, type EfiSettlementEnv } from './_shared/efi-settlement';

interface Env extends EfiSettlementEnv {
  ORDERS_KV: KVNamespace;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const paymentId = url.searchParams.get('paymentId')?.replace(/[^a-zA-Z0-9_.-]/g, '') ?? '';
  if (!paymentId) return json({ ok: false, error: 'missing_payment_id' }, 400);

  const raw = env.ORDERS_KV ? await env.ORDERS_KV.get('order:' + paymentId) : null;
  if (!raw) return json({ ok: true, paid: false, status: 'PENDING' });

  const order = JSON.parse(raw) as Record<string, unknown>;
  let isPaid = order['paid'] === true;
  let status = String(order['status'] ?? 'PENDING');

  if (!isPaid) {
    if (order['provider'] !== 'efi') return json({ ok: true, paid: false, status });
    const result = await settleEfiOrder(env, paymentId, order, new URL(request.url).origin);
    if (result === 'processing') return json({ ok: true, paid: false, status: 'PROCESSING' });
    if (result === 'retry') return json({ ok: true, paid: false, status: 'RETRYING' });
    if (result === 'mismatch') return json({ ok: true, paid: false, status: 'VALIDATION_ERROR' });
    isPaid = result === 'confirmed';
    status = String(order['status'] ?? status);
  }

  // Retorna apenas o mínimo necessário — sem PII (email, phone, cpf, brief, fbp, fbc, clientIp)
  return json({
    ok: true,
    paid: isPaid,
    status,
    name: order['name'] ? String(order['name']).split(' ')[0] : undefined,
    value: order['value'] ? Number(order['value']) : undefined,
    externalReference: order['externalReference'] ? String(order['externalReference']) : undefined,
    audioUrl:       order['audioUrl']       ? String(order['audioUrl'])       : undefined,
    audioUrl2:      order['audioUrl2']      ? String(order['audioUrl2'])      : undefined,
    streamAudioUrl: order['streamAudioUrl'] ? String(order['streamAudioUrl']) : undefined,
    downloadUrl:    order['downloadUrl']    ? String(order['downloadUrl'])    : undefined,
    imageUrl:       order['imageUrl']       ? String(order['imageUrl'])       : undefined,
    musicLink:      order['musicLink']      ? String(order['musicLink'])      : undefined,
    orderBumpExtraVersion: order['orderBumpExtraVersion'] ?? undefined,
    orderBumpVideo:        order['orderBumpVideo']        ?? undefined,
    orderBumpExtraSongs:   order['orderBumpExtraSongs']   ?? undefined,
    orderBumpQrCode:       order['orderBumpQrCode']       ?? undefined,
  });
};
