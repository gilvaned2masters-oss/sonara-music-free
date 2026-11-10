// Webhook do PIX bancário da Kiwify (Conta).
// Ao receber CASHIN.PIX.QRCODES.PAID, casa o qrcode_id com o pedido (reverse lookup
// kqr:{qrcode_id} → externalRef), marca pago e dispara o mesmo fluxo do Asaas/MP:
// email de confirmação + Meta CAPI + push + geração no Sunor.
import { kvPutOrder } from './_shared/kv-helpers';
import { sendMetaCapiPurchase } from './_shared/meta-capi';
import { sendEmail, buildConfirmationEmail } from './_shared/resend';
import { startSunorGeneration, startKieGeneration } from './_shared/generation';
import { kiwifyFetch } from './_shared/kiwify-auth';
import { getOrCreateOwnerCode, creditReferral } from './_shared/referral';

interface Env {
  ORDERS_KV: KVNamespace;
  META_PIXEL_ID: string;
  META_CAPI_TOKEN: string;
  ADMIN_PASSWORD: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  RESEND_API_KEY: string;
  FROM_EMAIL: string;
  OWNER_WHATSAPP: string;
  SUNOR_API_KEY: string;
  KIE_API_KEY: string;
  KIWIFY_ACCESS_ID: string;
  KIWIFY_PRIVATE_KEY_HEX: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(b64.length + (4 - (b64.length % 4)) % 4, '=');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

// Busca (com cache 24h no KV) a chave pública ativa de webhook da Kiwify.
async function getWebhookPublicKeyPem(env: Env): Promise<string | null> {
  const cached = await env.ORDERS_KV.get('kiwify_webhook_pubkey');
  if (cached) return cached;
  try {
    const r = await kiwifyFetch(env.KIWIFY_ACCESS_ID, env.KIWIFY_PRIVATE_KEY_HEX, 'GET', '/v1/webhooks-keys');
    const keys = (r.data['public_keys'] ?? []) as Array<Record<string, unknown>>;
    const active = keys.find((k) => k['is_active']) ?? keys[0];
    const pem = active ? String(active['content'] ?? '') : '';
    if (pem) { await env.ORDERS_KV.put('kiwify_webhook_pubkey', pem, { expirationTtl: 86400 }).catch(() => {}); return pem; }
  } catch (e) { console.error('[kiwify-pix] erro buscando webhook key:', String(e)); }
  return null;
}

// Verifica a assinatura Ed25519 (prehashed SHA-256) do webhook da Kiwify.
async function verifySignature(env: Env, path: string, rawBody: string, signature: string, timestamp: string): Promise<boolean> {
  try {
    if (Math.abs(Date.now() - Number(timestamp)) > 300_000) return false; // > 5 min
    const pem = await getWebhookPublicKeyPem(env);
    if (!pem) return false;
    const der = pemToDer(pem);
    const key = await crypto.subtle.importKey('spki', der as unknown as ArrayBuffer, { name: 'Ed25519' }, false, ['verify']);
    const message = `${path}:POST:${rawBody}:${timestamp}`;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
    const sigBytes = b64urlToBytes(signature);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, sigBytes as unknown as BufferSource, new Uint8Array(digest) as unknown as BufferSource);
  } catch (e) { console.error('[kiwify-pix] erro verificando assinatura:', String(e)); return false; }
}

export const onRequestGet: PagesFunction<Env> = async () =>
  json({ ok: true, service: 'kiwify-pix-webhook', status: 'online' });

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  // Lê o corpo CRU (necessário pra validar a assinatura — sem re-serializar)
  const rawBody = await request.text();
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(rawBody) as Record<string, unknown>; } catch { /* ignora */ }

  const sigHeader = request.headers.get('x-kiwify-digital-signature') || '';
  const tsHeader  = request.headers.get('x-kiwify-timestamp') || '';
  const sigValid  = await verifySignature(env, '/kiwify-pix-webhook', rawBody, sigHeader, tsHeader);

  // Log do evento (TTL 7 dias) para auditoria
  const ts = Date.now();
  if (env.ORDERS_KV) {
    await env.ORDERS_KV.put('kiwify_pix_event:' + ts, JSON.stringify({ ts, sigValid, payload }), { expirationTtl: 86400 * 7 }).catch(() => {});
  }

  // Segurança: só processa eventos com assinatura Ed25519 válida da Kiwify.
  if (!sigValid) {
    console.warn('[kiwify-pix] assinatura inválida — evento ignorado');
    return json({ ok: true, ignored: 'invalid_signature' });
  }

  const type = String(payload['type'] ?? '');
  const data = (payload['data'] ?? {}) as Record<string, unknown>;

  // Só processa pagamento de QR code dinâmico
  if (type !== 'CASHIN.PIX.QRCODES.PAID' || String(data['status'] ?? '').toLowerCase() !== 'paid') {
    return json({ ok: true });
  }

  const qrId = String(data['qrcode_id'] ?? '');
  if (!qrId || !env.ORDERS_KV) return json({ ok: true });

  // Reverse lookup: kqr:{qrcode_id} → externalRef (= chave do pedido)
  const orderKey = await env.ORDERS_KV.get('kqr:' + qrId);
  if (!orderKey) { console.log('[kiwify-pix] sem pedido para qrcode_id:', qrId); return json({ ok: true }); }

  const raw = await env.ORDERS_KV.get('order:' + orderKey);
  if (!raw) return json({ ok: true });
  const order = JSON.parse(raw) as Record<string, unknown>;

  if (order['paid']) return json({ ok: true }); // idempotente — já processado

  order['paid']          = true;
  order['status']        = 'CONFIRMED';
  order['kiwify_paid']   = true;
  order['updated_at']    = new Date().toISOString();
  await kvPutOrder(env.ORDERS_KV, orderKey, order);

  // 1. Email de confirmação
  if (!order['confirmationEmailSent'] && env.RESEND_API_KEY && order['email']) {
    const html = buildConfirmationEmail(order, env.OWNER_WHATSAPP);
    const sent = await sendEmail(env.RESEND_API_KEY, env.FROM_EMAIL || 'noreply@mastersmusic.com.br', {
      to: String(order['email']),
      subject: `Pedido confirmado — sua música está sendo criada 🎵`,
      html,
      idempotencyKey: `confirm-${orderKey}`,
    });
    if (sent) {
      order['confirmationEmailSent'] = true;
      order['updated_at'] = new Date().toISOString();
      await kvPutOrder(env.ORDERS_KV, orderKey, order);
    }
  }

  // 2. Meta CAPI
  if (!order['metaCapiSent']) {
    const sent = await sendMetaCapiPurchase(env.META_PIXEL_ID, env.META_CAPI_TOKEN, {
      paymentId: orderKey,
      customerId: String(order['customerId'] ?? ''),
      externalReference: String(order['externalReference'] ?? ''),
      name:  String(order['name']  ?? ''),
      email: String(order['email'] ?? ''),
      phone: String(order['phone'] ?? ''),
      value: Number(order['value'] ?? 39.9),
      fbp:   String(order['fbp']  ?? ''),
      fbc:   String(order['fbc']  ?? ''),
      clientIp:  String(order['clientIp']  ?? ''),
      userAgent: String(order['userAgent'] ?? ''),
      pageUrl:   String(order['pageUrl']   ?? ''),
      brief:     String(order['brief']     ?? ''),
    });
    if (sent) {
      order['metaCapiSent'] = true;
      order['updated_at']   = new Date().toISOString();
      await kvPutOrder(env.ORDERS_KV, orderKey, order);
    }
  }

  // 3. Push notification (uma vez por pedido)
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && !order['pushNotifSent']) {
    order['pushNotifSent'] = true;
    order['updated_at']    = new Date().toISOString();
    await kvPutOrder(env.ORDERS_KV, orderKey, order);
    const origin = new URL(request.url).origin;
    const auth   = 'Basic ' + btoa(':' + (env.ADMIN_PASSWORD || ''));
    const nome   = String(order['name'] ?? 'Cliente').split(' ')[0];
    const valor  = Number(order['value'] ?? 39.9).toFixed(2).replace('.', ',');
    context.waitUntil(
      fetch(origin + '/push-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': auth },
        body: JSON.stringify({ title: `💰 Venda Kiwify — R$${valor}`, message: nome }),
      }).catch(() => {}),
    );
  }

  // 4. Geração automática (pedidos /auto) — Sunor principal, KIE fallback/alternativa.
  if (order['source'] === 'auto' && !order['sunor_task_id'] && !order['kie_task_id'] && !order['sunorStartRequested'] && (env.SUNOR_API_KEY || env.KIE_API_KEY)) {
    order['sunorStartRequested'] = true;
    order['prodStatus']          = 'gerando_musica';
    order['updated_at']          = new Date().toISOString();
    await kvPutOrder(env.ORDERS_KV, orderKey, order);
    if (env.SUNOR_API_KEY) {
      await startSunorGeneration(env.ORDERS_KV, env.SUNOR_API_KEY, orderKey, order);
    }
    // Se o Sunor não estiver configurado ou não criar task (ex.: 502), cai pro KIE.
    if (!order['sunor_task_id'] && env.KIE_API_KEY) {
      const origin = new URL(request.url).origin;
      await startKieGeneration(env.ORDERS_KV, env.KIE_API_KEY, origin, orderKey, order);
    }
  }

  // 5. Programa de indicação (nunca pode quebrar o processamento do pagamento)
  try {
    // O comprador ganha seu próprio código de indicação (pra indicar outros)
    await getOrCreateOwnerCode(env.ORDERS_KV, order['phone'], order['email'], order['name']);
    // Credita quem indicou este comprador (idempotente)
    if (order['referredBy'] && !order['referralCredited']) {
      const r = await creditReferral(env.ORDERS_KV, order['referredBy'], order);
      if (r && r.credited) {
        order['referralCredited'] = true;
        order['updated_at'] = new Date().toISOString();
        await kvPutOrder(env.ORDERS_KV, orderKey, order);
        if (r.milestone && r.ownerEmail && env.RESEND_API_KEY) {
          const nome = String(r.ownerName ?? '').split(' ')[0] || 'Olá';
          const html = `<div style="font-family:sans-serif;max-width:480px;margin:auto">
            <h2 style="color:#7c3aed">🎉 Você ganhou uma música grátis!</h2>
            <p>Olá, ${nome}! Suas indicações na Masters Music renderam — você completou ${r.earned! * 3} amigos que compraram e ganhou <b>${r.earned} música(s) grátis</b>.</p>
            <p>Acesse seu painel pra resgatar: <a href="https://mastersmusic.com.br/indique?c=${r.ownerCode}">mastersmusic.com.br/indique</a></p>
            <p style="color:#888;font-size:13px">Continue indicando: a cada 3 amigos que comprarem, +1 música grátis. 💜</p>
          </div>`;
          context.waitUntil(sendEmail(env.RESEND_API_KEY, env.FROM_EMAIL || 'noreply@mastersmusic.com.br', {
            to: r.ownerEmail, subject: '🎁 Você ganhou uma música grátis na Masters Music!', html,
            idempotencyKey: `refbonus-${r.ownerCode}-${r.earned}`,
          }).catch(() => {}));
        }
      }
    }
  } catch (e) { console.error('[kiwify-pix] referral erro (ignorado):', String(e)); }

  console.log('[kiwify-pix] pago processado:', orderKey, 'qrId:', qrId);
  return json({ ok: true });
};
