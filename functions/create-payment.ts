import { kvPutOrder } from './_shared/kv-helpers';
import { calculateOrderValue, getPricing } from './_shared/pricing';
import { createEfiPix, newSonaraTxid, type EfiBridgeEnv } from './_shared/efi-bridge';

interface Env extends EfiBridgeEnv {
  ORDERS_KV: KVNamespace;
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

/** Creates one EFI PIX charge. No fallback gateway is used in this project. */
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
  const bumpSpotify = input.orderBumpSpotify === true || input.orderBumpSpotify === 'true';
  const bumpPlayback = input.orderBumpPlayback === true || input.orderBumpPlayback === 'true';
  const backOffer = input.orderBumpBackOffer === true || input.orderBumpBackOffer === 'true';

  if (!name || !phone || cpf.length !== 11 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return response({ ok: false, error: 'missing_customer_fields', message: 'Preencha nome, e-mail, WhatsApp e CPF válidos.' }, 422);
  }
  if (!env.EFI_BRIDGE_URL || !env.EFI_BRIDGE_TOKEN) {
    return response({ ok: false, error: 'gateway_unavailable', message: 'O pagamento está temporariamente indisponível.' }, 503);
  }

  const pricing = await getPricing(env.ORDERS_KV);
  const value = calculateOrderValue(pricing, {
    backOffer, version: bumpVersion, songs: bumpSongs, video: bumpVideo,
    qrcode: bumpQrCode, spotify: bumpSpotify, playback: bumpPlayback,
  });
  const externalReference = `sonara-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

  // O txid é definido por nós para permitir vincular com segurança a cobrança,
  // o webhook e o pedido salvo. Não use dados do cliente como identificador.
  const txid = newSonaraTxid();
  const charge = await createEfiPix(env, {
    txid, value, expiration: 1800, reference: externalReference,
    description: 'Sonara Music — música personalizada', cpf, name,
  });
  const paymentId = String(charge.data?.txid ?? txid);
  if (!charge.ok || !charge.data?.payload) {
    console.error('[sonara][efi] PIX charge failed', charge.status);
    return response({ ok: false, error: 'payment_create_failed', message: 'Não foi possível gerar o Pix agora. Tente novamente em instantes.' }, 422);
  }

  const order = {
    paymentId, txid: paymentId, externalReference, provider: 'efi', paymentMethod: 'pix',
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
    orderBumpSpotify: bumpSpotify, orderBumpPlayback: bumpPlayback,
    fbp: text(attribution, 'fbp', 180), fbc: text(attribution, 'fbc', 260),
    fbclid: text(attribution, 'fbclid', 260), pageUrl: text(attribution, 'pageUrl', 900),
    utmSource: text(attribution, 'utmSource', 120), utmMedium: text(attribution, 'utmMedium', 120),
    utmCampaign: text(attribution, 'utmCampaign', 200), utmContent: text(attribution, 'utmContent', 200),
    utmTerm: text(attribution, 'utmTerm', 200),
    clientIp: request.headers.get('CF-Connecting-IP') || '', userAgent: request.headers.get('User-Agent') || '',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  await kvPutOrder(env.ORDERS_KV, paymentId, order, 86400 * 30);
  await env.ORDERS_KV.put(`efi:${paymentId}`, paymentId, { expirationTtl: 86400 * 30 });
  await env.ORDERS_KV.put(`ext:${externalReference}`, paymentId, { expirationTtl: 86400 * 30 });

  return response({
    ok: true, paymentId, externalReference, value, provider: 'efi',
    encodedImage: charge.data.encodedImage, payload: charge.data.payload,
    expirationDate: charge.data.expiresAt,
  });
};
