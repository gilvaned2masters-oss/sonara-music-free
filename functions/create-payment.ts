import { asaas } from './_shared/asaas';
import { kvPutOrder } from './_shared/kv-helpers';
import { getPricing } from './_shared/pricing';

interface Env {
  ORDERS_KV: KVNamespace;
  ASAAS_API_KEY: string;
}

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function text(input: Record<string, unknown>, key: string, limit: number): string {
  return String(input[key] ?? '').trim().replace(/\s+/g, ' ').slice(0, limit);
}

function digits(value: string): string { return value.replace(/\D/g, ''); }

/** Creates one Asaas PIX charge. No fallback gateway is used in this project. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let input: Record<string, unknown>;
  try { input = await request.json() as Record<string, unknown>; }
  catch { return response({ ok: false, error: 'invalid_json' }, 400); }

  const name = text(input, 'nome', 120);
  const email = text(input, 'email', 160).toLowerCase();
  const phone = digits(text(input, 'whatsapp', 40)).replace(/^55/, '');
  const cpf = digits(text(input, 'cpf', 20));
  const attribution = input.attribution && typeof input.attribution === 'object'
    ? input.attribution as Record<string, unknown> : {};
  const bumpVersion = input.orderBumpExtraVersion === true || input.orderBumpExtraVersion === 'true';
  const bumpSongs = input.orderBumpExtraSongs === true || input.orderBumpExtraSongs === 'true';
  const bumpVideo = input.orderBumpVideo === true || input.orderBumpVideo === 'true';
  const bumpQrCode = input.orderBumpQrCode === true || input.orderBumpQrCode === 'true';
  const backOffer = input.orderBumpBackOffer === true || input.orderBumpBackOffer === 'true';

  if (!name || !phone || cpf.length !== 11 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return response({ ok: false, error: 'missing_customer_fields', message: 'Preencha nome, e-mail, WhatsApp e CPF válidos.' }, 422);
  }
  if (!env.ASAAS_API_KEY) return response({ ok: false, error: 'gateway_unavailable' }, 503);

  const pricing = await getPricing(env.ORDERS_KV);
  const value = backOffer ? pricing.backOffer : pricing.base
    + (bumpVersion ? pricing.version : 0)
    + (bumpSongs ? pricing.songs : 0)
    + (bumpVideo ? pricing.video : 0)
    + (bumpQrCode ? pricing.qrcode : 0);
  const externalReference = `sonara-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

  const customer = await asaas(env.ASAAS_API_KEY, 'POST', '/customers', {
    name, email, cpfCnpj: cpf, mobilePhone: phone, externalReference, notificationDisabled: true,
  });
  const customerId = String(customer.data.id ?? '');
  if (!customer.ok || !customerId) {
    console.error('[sonara] customer creation failed', customer.status);
    return response({ ok: false, error: 'payment_create_failed', message: 'Não foi possível preparar o pagamento agora.' }, 422);
  }

  const charge = await asaas(env.ASAAS_API_KEY, 'POST', '/payments', {
    customer: customerId,
    billingType: 'PIX',
    value,
    dueDate: new Date().toISOString().slice(0, 10),
    description: 'Sonara Music — Música personalizada',
    externalReference,
  });
  const paymentId = String(charge.data.id ?? '');
  if (!charge.ok || !paymentId) {
    console.error('[sonara] PIX charge failed', charge.status);
    return response({ ok: false, error: 'payment_create_failed', message: 'Não foi possível gerar o Pix agora. Tente novamente em instantes.' }, 422);
  }
  const qr = await asaas(env.ASAAS_API_KEY, 'GET', `/payments/${encodeURIComponent(paymentId)}/pixQrCode`);
  const payload = String(qr.data.payload ?? '');
  if (!qr.ok || !payload) {
    console.error('[sonara] PIX QR retrieval failed', qr.status);
    return response({ ok: false, error: 'pix_unavailable', message: 'O Pix está indisponível no momento. Tente novamente em instantes.' }, 422);
  }

  const order = {
    paymentId, customerId, externalReference, provider: 'asaas', paymentMethod: 'pix',
    name, email, phone, cpf, value, paid: false, status: 'PENDING',
    // Preserve the creation form used by the generation worker.  The webhook
    // must receive the same order context that was supplied before the PIX
    // was generated; otherwise a paid automatic order has no lyrics to create.
    source: text(input, 'source', 40) || 'auto',
    brief: text(input, 'brief', 5000),
    savedLetra: text(input, 'savedLetra', 12000),
    sunorStyle: text(input, 'sunorStyle', 400),
    destinatario: text(input, 'destinatario', 120),
    relacao: text(input, 'relacao', 120),
    ocasiao: text(input, 'ocasiao', 120),
    estilo: text(input, 'estilo', 200),
    voz: text(input, 'voz', 80),
    lyricsSource: text(input, 'lyricsSource', 80),
    lyricsTitle: text(input, 'lyricsTitle', 240),
    lang: text(input, 'lang', 8),
    orderBumpExtraVersion: bumpVersion, orderBumpExtraSongs: bumpSongs,
    orderBumpVideo: bumpVideo, orderBumpQrCode: bumpQrCode, orderBumpBackOffer: backOffer,
    fbp: text(attribution, 'fbp', 180), fbc: text(attribution, 'fbc', 260),
    fbclid: text(attribution, 'fbclid', 260), pageUrl: text(attribution, 'pageUrl', 900),
    utmSource: text(attribution, 'utmSource', 120), utmMedium: text(attribution, 'utmMedium', 120),
    utmCampaign: text(attribution, 'utmCampaign', 200), utmContent: text(attribution, 'utmContent', 200),
    utmTerm: text(attribution, 'utmTerm', 200),
    clientIp: request.headers.get('CF-Connecting-IP') || '', userAgent: request.headers.get('User-Agent') || '',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  await kvPutOrder(env.ORDERS_KV, paymentId, order, 86400 * 30);
  await env.ORDERS_KV.put(`ext:${externalReference}`, paymentId, { expirationTtl: 86400 * 30 });

  return response({
    ok: true, paymentId, externalReference, value, provider: 'asaas',
    encodedImage: String(qr.data.encodedImage ?? ''), payload,
    expirationDate: String(qr.data.expirationDate ?? '') || null,
  });
};
