import { asaas } from './_shared/asaas';
import { getMpPaymentStatus } from './_shared/mercadopago';
import { sendMetaCapiPurchase } from './_shared/meta-capi';
import { kvPutOrder } from './_shared/kv-helpers';
import { kiwifyFetch } from './_shared/kiwify-auth';

interface Env {
  ORDERS_KV: KVNamespace;
  ASAAS_API_KEY: string;
  MERCADO_PAGO_ACCESS_TOKEN: string;
  META_PIXEL_ID: string;
  META_CAPI_TOKEN: string;
  KIWIFY_ACCESS_ID: string;
  KIWIFY_PRIVATE_KEY_HEX: string;
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
  const paymentId = url.searchParams.get('paymentId')?.replace(/[^a-zA-Z0-9_.-]/g, '') ?? '';
  if (!paymentId) return json({ ok: false, error: 'missing_payment_id' }, 400);

  const raw = env.ORDERS_KV ? await env.ORDERS_KV.get('order:' + paymentId) : null;
  if (!raw) return json({ ok: true, paid: false, status: 'PENDING' });

  const order = JSON.parse(raw) as Record<string, unknown>;
  let isPaid = order['paid'] === true;
  let status = String(order['status'] ?? 'PENDING');

  if (!isPaid) {
    const provider = String(order['provider'] ?? '');
    const isMp = provider === 'mercadopago';
    const isKiwify = provider === 'kiwify';
    const mpId = String(order['mpPaymentId'] ?? '');

    if (isKiwify && env.KIWIFY_ACCESS_ID && env.KIWIFY_PRIVATE_KEY_HEX) {
      // Pedido Kiwify — consulta o status do QR (backup do webhook)
      const qrId = String(order['kiwify_qr_id'] ?? '');
      if (qrId) {
        const kw = await kiwifyFetch(env.KIWIFY_ACCESS_ID, env.KIWIFY_PRIVATE_KEY_HEX, 'GET', '/v1/dynamic-qrcode/' + qrId);
        if (kw.ok && String(kw.data['status'] ?? '').toLowerCase() === 'paid') {
          isPaid = true;
          status = 'CONFIRMED';
          order['paid'] = true;
          order['status'] = 'CONFIRMED';
          order['updated_at'] = new Date().toISOString();
          if (env.ORDERS_KV) await kvPutOrder(env.ORDERS_KV, paymentId, order);
        }
      }
    } else if (isMp && mpId && env.MERCADO_PAGO_ACCESS_TOKEN) {
      // Pedido MP — consultar status diretamente na API do MP
      const mpStatus = await getMpPaymentStatus(env.MERCADO_PAGO_ACCESS_TOKEN, mpId);
      if (mpStatus === 'approved') {
        isPaid = true;
        status = 'CONFIRMED';
        order['paid'] = true;
        order['status'] = 'CONFIRMED';
        order['updated_at'] = new Date().toISOString();
        if (env.ORDERS_KV) await kvPutOrder(env.ORDERS_KV, paymentId, order);
      }
    } else if (!isMp && !isKiwify) {
      // Pedido Asaas — consultar status no Asaas
      const res = await asaas(env.ASAAS_API_KEY, 'GET', `/payments/${encodeURIComponent(paymentId)}`);
      if (res.ok && res.data['status']) {
        status = String(res.data['status']);
        isPaid = PAID_STATUSES.includes(status);
        if (isPaid) {
          order['paid'] = true;
          order['status'] = status;
          order['updated_at'] = new Date().toISOString();
          if (env.ORDERS_KV) await kvPutOrder(env.ORDERS_KV, paymentId, order);
        }
      }
    }
  }

  if (isPaid && !order['metaCapiSent']) {
    const sent = await sendMetaCapiPurchase(env.META_PIXEL_ID, env.META_CAPI_TOKEN, {
      paymentId,
      customerId: String(order['customerId'] ?? ''),
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
      brief: String(order['brief'] ?? ''),
    });
    if (sent) {
      order['metaCapiSent'] = true;
      order['updated_at'] = new Date().toISOString();
      if (env.ORDERS_KV) await kvPutOrder(env.ORDERS_KV, paymentId, order);
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
