import { sendMetaCapiPurchase } from './meta-capi';
import { sendEmail, buildConfirmationEmail } from './resend';
import { kvPutOrder } from './kv-helpers';
import { startKieGeneration, startSunorGeneration } from './generation';
import { shouldStartAutoGeneration } from './activation-guards';

export interface PaymentActivationEnv {
  ORDERS_KV: KVNamespace;
  META_PIXEL_ID: string;
  META_CAPI_TOKEN: string;
  SUNOR_API_KEY: string;
  KIE_API_KEY: string;
  RESEND_API_KEY: string;
  FROM_EMAIL: string;
  OWNER_WHATSAPP: string;
  ADMIN_PASSWORD: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  CALLMEBOT_API_KEY: string;
}

/**
 * Only call this after the payment provider has confirmed the payment on its
 * own API. It is idempotent so a status poll and a webhook may race safely.
 */
export async function activatePaidOrder(
  env: PaymentActivationEnv, paymentId: string, order: Record<string, unknown>, origin = '',
): Promise<Record<string, unknown>> {
  order['paid'] = true;
  // Preserve the provider's authoritative terminal status (Efí: CONCLUIDA).
  order['status'] = String(order['status'] || 'CONFIRMED');
  order['updated_at'] = new Date().toISOString();
  await kvPutOrder(env.ORDERS_KV, paymentId, order);

  if (!order['confirmationEmailSent'] && env.RESEND_API_KEY && order['email']) {
    const sent = await sendEmail(env.RESEND_API_KEY, env.FROM_EMAIL || 'noreply@mastersmusic.com.br', {
      to: String(order['email']),
      subject: 'Pedido confirmado — sua música está sendo criada 🎵',
      html: buildConfirmationEmail(order, env.OWNER_WHATSAPP),
      idempotencyKey: `confirm-${paymentId}`,
    });
    if (sent) {
      order['confirmationEmailSent'] = true;
      order['updated_at'] = new Date().toISOString();
      await kvPutOrder(env.ORDERS_KV, paymentId, order);
    }
  }

  if (!order['metaCapiSent']) {
    const sent = await sendMetaCapiPurchase(env.META_PIXEL_ID, env.META_CAPI_TOKEN, {
      paymentId,
      customerId: String(order['customerId'] ?? ''),
      externalReference: String(order['externalReference'] ?? ''),
      name: String(order['name'] ?? ''), email: String(order['email'] ?? ''),
      phone: String(order['phone'] ?? ''), value: Number(order['value'] ?? 0),
      fbp: String(order['fbp'] ?? ''), fbc: String(order['fbc'] ?? ''),
      clientIp: String(order['clientIp'] ?? ''), userAgent: String(order['userAgent'] ?? ''),
      pageUrl: String(order['pageUrl'] ?? ''), brief: String(order['brief'] ?? ''),
    });
    if (sent) {
      order['metaCapiSent'] = true;
      order['updated_at'] = new Date().toISOString();
      await kvPutOrder(env.ORDERS_KV, paymentId, order);
    }
  }

  // A venda continua aparecendo no painel e na notificação administrativa.
  // A ponte Efí serializa esta ativação por TXID; as flags protegem replays.
  if (origin && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && !order['pushNotifSent']) {
    order['pushNotifSent'] = true;
    order['updated_at'] = new Date().toISOString();
    await kvPutOrder(env.ORDERS_KV, paymentId, order);
    const bumps = [
      order['orderBumpVideo'] ? '🎬 Vídeo' : '',
      order['orderBumpExtraSongs'] ? '🎵 +2 músicas' : '',
      order['orderBumpExtraVersion'] ? '➕ Versão extra' : '',
      order['orderBumpQrCode'] ? '📲 QR Code' : '',
      order['orderBumpSpotify'] ? '🎧 Spotify' : '',
      order['orderBumpPlayback'] ? '▶️ Playback' : '',
    ].filter(Boolean).join(' · ');
    const auth = 'Basic ' + btoa(':' + (env.ADMIN_PASSWORD || ''));
    fetch(origin + '/push-notify', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({
        title: `💰 Venda confirmada — R$${Number(order['value'] ?? 0).toFixed(2).replace('.', ',')}`,
        message: `${String(order['name'] ?? 'Cliente').split(' ')[0]}${bumps ? ' · ' + bumps : ''}`,
      }),
    }).catch(() => {});
  }

  if (order['orderBumpExtraSongs'] === true && !order['extraSongsPending']) {
    order['extraSongsPending'] = true;
    order['updated_at'] = new Date().toISOString();
    await kvPutOrder(env.ORDERS_KV, paymentId, order);
  }

  if (order['orderBumpVideo'] === true && !order['videoPending']) {
    order['videoPending'] = true;
    order['updated_at'] = new Date().toISOString();
    await kvPutOrder(env.ORDERS_KV, paymentId, order);
    if (env.OWNER_WHATSAPP && env.CALLMEBOT_API_KEY) {
      const message = `🎬 NOVO PEDIDO COM VÍDEO\nCliente: ${String(order['name'] ?? '')}\nPedido: ${paymentId}`;
      fetch(`https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(env.OWNER_WHATSAPP)}&text=${encodeURIComponent(message)}&apikey=${env.CALLMEBOT_API_KEY}`)
        .then(r => { if (r.ok) { order['videoNotified'] = true; return kvPutOrder(env.ORDERS_KV, paymentId, order); } return undefined; })
        .catch(() => {});
    }
  }

  // These are fulfillment tasks, not automatic music-generation variants.
  // They remain visible in the admin order until a human completes delivery.
  if (order['orderBumpSpotify'] === true && !order['spotifyPending']) {
    order['spotifyPending'] = true;
    order['updated_at'] = new Date().toISOString();
    await kvPutOrder(env.ORDERS_KV, paymentId, order);
  }
  if (order['orderBumpPlayback'] === true && !order['playbackPending']) {
    order['playbackPending'] = true;
    order['updated_at'] = new Date().toISOString();
    await kvPutOrder(env.ORDERS_KV, paymentId, order);
  }

  if (shouldStartAutoGeneration(order, Boolean(env.SUNOR_API_KEY || env.KIE_API_KEY))) {
    order['sunorStartRequested'] = true;
    order['prodStatus'] = 'gerando_musica';
    order['updated_at'] = new Date().toISOString();
    await kvPutOrder(env.ORDERS_KV, paymentId, order);
    if (env.SUNOR_API_KEY) await startSunorGeneration(env.ORDERS_KV, env.SUNOR_API_KEY, paymentId, order);
    if (!order['sunor_task_id'] && env.KIE_API_KEY) {
      await startKieGeneration(env.ORDERS_KV, env.KIE_API_KEY, origin, paymentId, order);
    }
    // A provider failure before it returns a task must not permanently strand
    // the paid order. The authenticated background production scanner retries
    // it; task IDs remain the idempotency markers once a task exists.
    if (!order['sunor_task_id'] && !order['kie_task_id']) {
      order['sunorStartRequested'] = false;
      order['generationRetryCount'] = Math.min(Number(order['generationRetryCount'] ?? 0) + 1, 8);
      order['prodStatus'] = 'generation_retry';
      order['updated_at'] = new Date().toISOString();
      await kvPutOrder(env.ORDERS_KV, paymentId, order);
    }
  }
  return order;
}
