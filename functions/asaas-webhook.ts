import { sendMetaCapiPurchase } from './_shared/meta-capi';
import { sendEmail, buildConfirmationEmail } from './_shared/resend';
import { kvPutOrder } from './_shared/kv-helpers';
import { startKieGeneration, startSunorGeneration } from './_shared/generation';

interface Env {
  ORDERS_KV: KVNamespace;
  META_PIXEL_ID: string;
  META_CAPI_TOKEN: string;
  SUNOR_API_KEY: string;
  KIE_API_KEY: string;
  ADMIN_PASSWORD: string;
  OWNER_WHATSAPP: string;
  CALLMEBOT_API_KEY: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  RESEND_API_KEY: string;
  FROM_EMAIL: string;
  ASAAS_WEBHOOK_TOKEN: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const PAID_EVENTS = ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED_IN_CASH'];
const PAID_STATUSES = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  // Asaas forwards the per-webhook authToken in this header. Never accept
  // anonymous payment notifications: a forged event must not unlock an order.
  const suppliedToken = request.headers.get('asaas-access-token') || '';
  if (!env.ASAAS_WEBHOOK_TOKEN || suppliedToken !== env.ASAAS_WEBHOOK_TOKEN) {
    return json({ ok: false }, 401);
  }

  let payload: Record<string, unknown>;
  try { payload = await request.json() as Record<string, unknown>; }
  catch { return json({ ok: false }, 400); }

  const event = String(payload['event'] ?? '');
  const payment = (payload['payment'] ?? {}) as Record<string, unknown>;
  const paymentId = String(payment['id'] ?? '').replace(/[^a-zA-Z0-9_.-]/g, '');

  if (!paymentId) return json({ ok: true });

  const isPaid = PAID_EVENTS.includes(event)
    || PAID_STATUSES.includes(String(payment['status'] ?? ''));

  console.log('[webhook] event:', event, 'paymentId:', paymentId, 'isPaid:', isPaid, 'status:', String(payment['status'] ?? ''));

  const raw = await env.ORDERS_KV.get('order:' + paymentId);
  if (!raw) {
    // Verificar se é pagamento de arte (externalReference = 'art-{orderId}')
    const extRef = String(payment['externalReference'] ?? '');
    if (extRef.startsWith('art-')) {
      const orderId = extRef.replace(/^art-/, '').replace(/[^a-zA-Z0-9_.-]/g, '');
      const artOrderRaw = await env.ORDERS_KV.get('order:' + orderId);
      if (artOrderRaw) {
        const artOrder = JSON.parse(artOrderRaw) as Record<string, unknown>;
        if (isPaid && !artOrder['artPaid']) {
          artOrder['artPaid'] = true;
          artOrder['artPaymentId'] = paymentId;
          artOrder['updated_at'] = new Date().toISOString();
          await env.ORDERS_KV.put('order:' + orderId, JSON.stringify(artOrder), { expirationTtl: 86400 * 30 });
          console.log('[webhook] arte paga para orderId:', orderId);
          // Push notification para arte vendida
          if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
            const origin = new URL(request.url).origin;
            const auth   = 'Basic ' + btoa(':' + (env.ADMIN_PASSWORD || ''));
            const nome   = String(artOrder['name'] ?? 'Cliente').split(' ')[0];
            context.waitUntil(
              fetch(origin + '/push-notify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': auth },
                body: JSON.stringify({
                  title: '🎨 Arte da letra vendida — R$9,00',
                  message: nome,
                }),
              }).catch(() => {}),
            );
          }
        }
      } else {
        console.log('[webhook] art order NOT FOUND for orderId:', orderId);
      }
    } else {
      // Tentar ext: reverse lookup (recovery payments, etc.)
      const origId = await env.ORDERS_KV.get('ext:' + paymentId);
      if (origId && isPaid) {
        const origRaw = await env.ORDERS_KV.get('order:' + origId);
        if (origRaw) {
          const origOrder = JSON.parse(origRaw) as Record<string, unknown>;
          if (!origOrder['paid']) {
            origOrder['paid']             = true;
            origOrder['recoveryPaid']     = true;
            origOrder['recoveryPaymentId'] = paymentId;
            origOrder['updated_at']       = new Date().toISOString();
            await kvPutOrder(env.ORDERS_KV, origId, origOrder);
            console.log('[webhook] recovery payment confirmado, order original:', origId);
          }
        }
      } else {
        console.log('[webhook] order NOT FOUND in KV for paymentId:', paymentId);
      }
    }
    return json({ ok: true });
  }

  const order = JSON.parse(raw) as Record<string, unknown>;
  order['status'] = String(payment['status'] ?? event);
  // Nunca reverter paid=true para false — Asaas pode disparar eventos subsequentes não-pagos
  if (isPaid) order['paid'] = true;
  order['updated_at'] = new Date().toISOString();
  order['asaas_event'] = event;

  await kvPutOrder(env.ORDERS_KV, paymentId, order);

  // Email de confirmação de pedido
  if (isPaid && !order['confirmationEmailSent'] && env.RESEND_API_KEY && order['email']) {
    const html = buildConfirmationEmail(order, env.OWNER_WHATSAPP);
    const sent = await sendEmail(env.RESEND_API_KEY, env.FROM_EMAIL || 'noreply@mastersmusic.com.br', {
      to: String(order['email']),
      subject: `Pedido confirmado — sua música está sendo criada 🎵`,
      html,
      idempotencyKey: `confirm-${paymentId}`,
    });
    if (sent) {
      order['confirmationEmailSent'] = true;
      order['updated_at'] = new Date().toISOString();
      await kvPutOrder(env.ORDERS_KV, paymentId, order);
    }
  }

  if (isPaid && !order['metaCapiSent']) {
    console.log('[capi] attempting Purchase — pixelId:', env.META_PIXEL_ID ? 'SET' : 'MISSING', 'token:', env.META_CAPI_TOKEN ? 'SET' : 'MISSING');
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
    console.log('[capi] Purchase result:', sent ? 'SUCCESS' : 'FAILED');
    if (sent) {
      order['metaCapiSent'] = true;
      order['updated_at'] = new Date().toISOString();
      await kvPutOrder(env.ORDERS_KV, paymentId, order);
    }
  } else if (isPaid && order['metaCapiSent']) {
    console.log('[capi] Purchase already sent, skipping');
  }

  if (isPaid) {
    const origin = new URL(request.url).origin;
    const auth   = 'Basic ' + btoa(':' + (env.ADMIN_PASSWORD || ''));

    // 0. Push notification de nova venda (uma vez por pedido)
    if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && !order['pushNotifSent']) {
      order['pushNotifSent'] = true;
      order['updated_at']    = new Date().toISOString();
      await kvPutOrder(env.ORDERS_KV, paymentId, order);
      const name   = String(order['name']  ?? 'Cliente').split(' ')[0];
      const value  = Number(order['value'] ?? 29.9).toFixed(2).replace('.', ',');
      const bumps  = [
        order['orderBumpVideo']        ? '🎬 Vídeo' : '',
        order['orderBumpExtraSongs']   ? '🎵 +2 músicas' : '',
        order['orderBumpExtraVersion'] ? '➕ Versão extra' : '',
        order['orderBumpQrCode']       ? '📲 QR Code' : '',
      ].filter(Boolean).join(' · ');
      context.waitUntil(
        fetch(origin + '/push-notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': auth },
          body: JSON.stringify({
            title: `💰 Venda confirmada — R$${value}`,
            message: `${name}${bumps ? ' · ' + bumps : ''}`,
          }),
        }).catch(() => {}),
      );
    }

    // 1. Notificação de vídeo pendente (WhatsApp via CallMeBot — opcional)
    if (order['orderBumpVideo'] === true && !order['videoNotified']) {
      order['videoPending']  = true;
      order['videoNotified'] = false;
      order['updated_at']    = new Date().toISOString();
      await kvPutOrder(env.ORDERS_KV, paymentId, order);

      if (env.OWNER_WHATSAPP && env.CALLMEBOT_API_KEY) {
        const name  = String(order['name'] ?? '');
        const para2 = String(order['brief'] ?? '').match(/Para quem:\s*([^\n]+)/i)?.[1] ?? '';
        const msg   = `🎬 NOVO PEDIDO COM VÍDEO\nCliente: ${name}\nPara: ${para2}\nPedido: ${paymentId}\nAcesse: ${origin}/m/${paymentId}`;
        context.waitUntil(
          fetch(`https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(env.OWNER_WHATSAPP)}&text=${encodeURIComponent(msg)}&apikey=${env.CALLMEBOT_API_KEY}`)
            .then(r => { if (r.ok) { order['videoNotified'] = true; return env.ORDERS_KV.put('order:' + paymentId, JSON.stringify(order), { expirationTtl: 86400 * 30 }); } })
            .catch(() => {}),
        );
      }
    }

    // 3. Músicas extras — marcar como pendente para acompanhamento
    if (order['orderBumpExtraSongs'] === true && !order['extraSongsPending']) {
      order['extraSongsPending'] = true;
      order['updated_at']        = new Date().toISOString();
      await kvPutOrder(env.ORDERS_KV, paymentId, order);
    }

    // 4. Geração automática (pedidos /auto) — Sunor principal, KIE fallback/alternativa.
    if (order['source'] === 'auto' && !order['sunor_task_id'] && !order['kie_task_id'] && !order['sunorStartRequested'] && (env.SUNOR_API_KEY || env.KIE_API_KEY)) {
      // Flag preemptiva: reduz janela de dupla geração se dois webhooks chegarem em paralelo
      order['sunorStartRequested'] = true;
      order['prodStatus']          = 'gerando_musica';
      order['updated_at']          = new Date().toISOString();
      await kvPutOrder(env.ORDERS_KV, paymentId, order);
      if (env.SUNOR_API_KEY) {
        await startSunorGeneration(env.ORDERS_KV, env.SUNOR_API_KEY, paymentId, order);
      }
      if (!order['sunor_task_id'] && env.KIE_API_KEY) {
        const origin = new URL(request.url).origin;
        await startKieGeneration(env.ORDERS_KV, env.KIE_API_KEY, origin, paymentId, order);
      }
    }
  }

  return json({ ok: true });
};
