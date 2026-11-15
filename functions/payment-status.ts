import { completePaymentActivation, claimPaymentActivation, getEfiPixStatus, type EfiBridgeEnv } from './_shared/efi-bridge';
import { activatePaidOrder, type PaymentActivationEnv } from './_shared/payment-activation';

interface Env extends EfiBridgeEnv, PaymentActivationEnv {
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
    if (order['provider'] === 'efi') {
      // A liberação depende de uma segunda confirmação, diretamente na EFI.
      // O browser nunca é fonte de verdade para pagamento.
      const res = await getEfiPixStatus(env, String(order['txid'] ?? paymentId));
      if (res.ok && res.data) {
        status = res.data.status;
        isPaid = res.data.paid && status === 'CONCLUIDA';
      }
    }
    if (isPaid) {
      order['status'] = status;
      const txid = String(order['txid'] ?? paymentId);
      const claim = await claimPaymentActivation(env, txid);
      if (claim.ok && claim.data?.claim === 'acquired') {
        try {
          await activatePaidOrder(env, paymentId, order, new URL(request.url).origin);
          await completePaymentActivation(env, txid);
        } catch (error) {
          console.error('[sonara][efi] activation failed', error instanceof Error ? error.message : 'unknown');
          return json({ ok: false, error: 'activation_pending' }, 503);
        }
      } else if (claim.ok && claim.data?.claim === 'busy') {
        return json({ ok: true, paid: false, status: 'PROCESSING' });
      } else if (claim.ok && claim.data?.claim === 'completed') {
        const fresh = await env.ORDERS_KV.get('order:' + paymentId);
        if (fresh) Object.assign(order, JSON.parse(fresh) as Record<string, unknown>);
      }
    }
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
