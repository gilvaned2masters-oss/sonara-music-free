import { kvPutOrder } from './_shared/kv-helpers';
import { getMpPaymentStatus } from './_shared/mercadopago';
import { sendMetaCapiPurchase } from './_shared/meta-capi';
import { sendEmail, buildConfirmationEmail } from './_shared/resend';
import { startKieGeneration, startSunorGeneration } from './_shared/generation';

interface Env {
  ORDERS_KV: KVNamespace;
  MERCADO_PAGO_ACCESS_TOKEN: string;
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
}

function nextCursor(list: { list_complete: boolean }): string | undefined {
  return list.list_complete ? undefined : (list as unknown as { cursor?: string }).cursor;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  let payload: Record<string, unknown>;
  try { payload = await request.json() as Record<string, unknown>; }
  catch { return json({ ok: false }, 400); }

  const action = String(payload['action'] ?? '');
  const data   = (payload['data'] ?? {}) as Record<string, unknown>;
  const mpId   = String(data['id'] ?? '');

  // MP notifica payment.created e payment.updated
  if (!action.startsWith('payment.') || !mpId) return json({ ok: true });

  // Buscar status real no MP
  const status = await getMpPaymentStatus(env.MERCADO_PAGO_ACCESS_TOKEN, mpId);
  const isPaid = status === 'approved';

  if (!isPaid) return json({ ok: true });

  // Buscar order pelo mpPaymentId — reverse lookup primeiro, depois scan paginado
  let order: Record<string, unknown> | null = null;
  let orderKey = '';

  // Fast path: reverse lookup mp:{id} → externalRef
  const reverseKey = await env.ORDERS_KV.get('mp:' + mpId);
  if (reverseKey) {
    const raw = await env.ORDERS_KV.get('order:' + reverseKey);
    if (raw) {
      try {
        const o = JSON.parse(raw) as Record<string, unknown>;
        if (String(o['mpPaymentId'] ?? '') === mpId) {
          order = o;
          orderKey = reverseKey;
        }
      } catch { /* skip */ }
    }
  }

  // Fallback: scan paginado (pedidos sem reverse lookup)
  if (!order) {
    let cursor: string | undefined;
    do {
      const list = await env.ORDERS_KV.list({ prefix: 'order:', cursor, limit: 1000 });
      for (const k of list.keys) {
        const raw = await env.ORDERS_KV.get(k.name);
        if (!raw) continue;
        try {
          const o = JSON.parse(raw) as Record<string, unknown>;
          if (String(o['mpPaymentId'] ?? '') === mpId) {
            order = o;
            orderKey = k.name.replace(/^order:/, '');
            // Criar reverse lookup para próximas vezes
            await env.ORDERS_KV.put('mp:' + mpId, orderKey, { expirationTtl: 86400 * 7 }).catch(() => {});
            break;
          }
        } catch { /* skip */ }
      }
      if (order) break;
      cursor = nextCursor(list);
    } while (cursor);
  }

  if (!order || !orderKey) {
    console.log('[mp-webhook] order not found for mpId:', mpId);
    return json({ ok: true });
  }

  if (order['paid']) return json({ ok: true }); // já processado

  order['paid']       = true;
  order['status']     = 'APPROVED';
  order['mp_event']   = action;
  order['updated_at'] = new Date().toISOString();

  await kvPutOrder(env.ORDERS_KV, orderKey, order);

  // Email de confirmação
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

  // Meta CAPI
  if (!order['metaCapiSent']) {
    const sent = await sendMetaCapiPurchase(env.META_PIXEL_ID, env.META_CAPI_TOKEN, {
      paymentId: orderKey,
      customerId: String(order['customerId'] ?? ''),
      externalReference: String(order['externalReference'] ?? ''),
      name:   String(order['name']  ?? ''),
      email:  String(order['email'] ?? ''),
      phone:  String(order['phone'] ?? ''),
      value:  Number(order['value'] ?? 39.9),
      fbp:    String(order['fbp']  ?? ''),
      fbc:    String(order['fbc']  ?? ''),
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

  // Push notification (uma vez por pedido)
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && !order['pushNotifSent']) {
    order['pushNotifSent'] = true;
    order['updated_at']    = new Date().toISOString();
    await kvPutOrder(env.ORDERS_KV, orderKey, order);
    const origin = new URL(request.url).origin;
    const auth   = 'Basic ' + btoa(':' + (env.ADMIN_PASSWORD || ''));
    const name   = String(order['name'] ?? 'Cliente').split(' ')[0];
    const value  = Number(order['value'] ?? 29.9).toFixed(2).replace('.', ',');
    context.waitUntil(
      fetch(origin + '/push-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': auth },
        body: JSON.stringify({
          title: `💰 Venda MP — R$${value}`,
          message: name,
        }),
      }).catch(() => {}),
    );
  }

  // Geração automática (pedidos /auto) — Sunor principal, KIE fallback/alternativa.
  if (order['source'] === 'auto' && !order['sunor_task_id'] && !order['kie_task_id'] && !order['sunorStartRequested'] && (env.SUNOR_API_KEY || env.KIE_API_KEY)) {
    order['sunorStartRequested'] = true;
    order['prodStatus']          = 'gerando_musica';
    order['updated_at']          = new Date().toISOString();
    await kvPutOrder(env.ORDERS_KV, orderKey, order);
    if (env.SUNOR_API_KEY) {
      await startSunorGeneration(env.ORDERS_KV, env.SUNOR_API_KEY, orderKey, order);
    }
    if (!order['sunor_task_id'] && env.KIE_API_KEY) {
      const origin = new URL(request.url).origin;
      await startKieGeneration(env.ORDERS_KV, env.KIE_API_KEY, origin, orderKey, order);
    }
  }

  return json({ ok: true });
};
