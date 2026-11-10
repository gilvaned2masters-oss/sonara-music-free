import { kvPutOrder } from './_shared/kv-helpers';
import { sendEmail, buildDeliveryEmail, buildDeliveryEmailES } from './_shared/resend';
import { versionsCount, collectMp3Urls, saveMp3Urls } from './_shared/generation';
import { storeMp3ToR2, kiePermanentUrls } from './_shared/audio-store';

interface Env {
  ORDERS_KV: KVNamespace;
  AUDIO_BUCKET: R2Bucket;
  KIE_API_KEY: string;
  RESEND_API_KEY: string;
  FROM_EMAIL: string;
  OWNER_WHATSAPP: string;
  EVOLUTION_API_URL?: string;
  EVOLUTION_API_KEY?: string;
  EVOLUTION_INSTANCE?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/**
 * Payload da Kie.ai: { code, msg, data: { callbackType, task_id, data: [ {stream_audio_url, audio_url, ...} ] } }
 * stream_audio_url é permanente (preferir). Cada task traz até 2 faixas.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const url     = new URL(request.url);
  const orderId = url.searchParams.get('orderId')?.replace(/[^a-zA-Z0-9_.-]/g, '') ?? '';

  let payload: Record<string, unknown> = {};
  try { payload = await request.json() as Record<string, unknown>; } catch { /* ignora */ }

  console.log('KIE CALLBACK:', JSON.stringify({ orderId, payload }, null, 2));

  if (!orderId) return json({ ok: false, error: 'missing_order_id' }, 400);

  const raw = env.ORDERS_KV ? await env.ORDERS_KV.get('order:' + orderId) : null;
  if (!raw) return json({ ok: true, ignored: 'order_not_found' });

  const order = JSON.parse(raw) as Record<string, unknown>;

  // Anti-spoofing: só processar se este pedido realmente iniciou alguma geração KIE
  if (!order['kie_task_id'] && !order['kie_task_id_2']) {
    console.warn('[kie-callback] orderId sem kie_task_id — possível spoofing, ignorando:', orderId);
    return json({ ok: true });
  }

  const outer        = (payload['data']       ?? payload)       as Record<string, unknown>;
  const callbackType = String(outer['callbackType'] ?? '').toLowerCase();
  const isComplete   = callbackType === 'complete'
    || String(payload['msg'] ?? '').toLowerCase().includes('success');

  if (isComplete) {
    const tracks = (outer['data'] ?? []) as Array<Record<string, unknown>>;
    const taskId = String(outer['task_id'] ?? '');

    // URLs PERMANENTES: a do callback (musicfile.kie.ai = stream) EXPIRA p/ 0 bytes em horas.
    // Pega a permanente via record-info (tempfile) e, se não vier, usa o audio_url do callback.
    let srcUrls = taskId ? await kiePermanentUrls(taskId, env.KIE_API_KEY) : [];
    if (!srcUrls.length) {
      srcUrls = tracks
        .map((t) => String(t['audio_url'] ?? t['source_audio_url'] ?? t['stream_audio_url'] ?? ''))
        .filter(Boolean);
    }
    // Baixa e guarda no R2 (nosso domínio) → URL nunca expira e toca no player.
    const newUrls: string[] = [];
    for (let i = 0; i < srcUrls.length; i++) {
      const key = 'audio/' + orderId + '-' + (taskId || 't') + '-' + i + '.mp3';
      if (await storeMp3ToR2(env.AUDIO_BUCKET, key, srcUrls[i])) newUrls.push('/' + key);
      else newUrls.push(srcUrls[i]); // fallback: usa a URL direta se o R2 falhar
    }

    if (newUrls.length) {
      const versions = versionsCount(order);
      // Acumula URLs já salvas + novas (sem duplicar), grava até o nº de versões
      const merged = Array.from(new Set([...collectMp3Urls(order), ...newUrls]));
      saveMp3Urls(order, merged);

      // Metadados de compatibilidade (primeira faixa)
      const t1 = tracks[0] ?? {};
      order['audioUrl']         = String(order['mp3_url'] ?? '');
      order['streamAudioUrl']   = String(order['mp3_url'] ?? '');
      order['imageUrl']         = String(t1['image_url'] ?? order['imageUrl'] ?? '');
      order['generationStatus'] = 'ready';
      order['updated_at']       = new Date().toISOString();

      const haveAll = collectMp3Urls(order).length >= versions;
      if (haveAll) {
        order['treblo_status'] = 'success';
        order['prodStatus']    = 'pronto';
        // NÃO marca delivered: "entregue" = cliente baixou (mark-delivered).
      }
      await kvPutOrder(env.ORDERS_KV, orderId, order);

      // Só envia email quando TODAS as versões compradas estão prontas
      if (haveAll && !order['deliveryEmailSent'] && env.RESEND_API_KEY && order['email']) {
        const isEs = order['lang'] === 'es' || order['source'] === 'esp';
        const html = isEs ? buildDeliveryEmailES(order, env.OWNER_WHATSAPP) : buildDeliveryEmail(order, env.OWNER_WHATSAPP);
        const sent = await sendEmail(env.RESEND_API_KEY, env.FROM_EMAIL || 'noreply@mastersmusic.com.br', {
          to: String(order['email']),
          subject: isEs ? '¡Tu canción está lista — descárgala ahora! 🎵' : 'Sua música está pronta — baixe agora! 🎵',
          html,
          idempotencyKey: `delivery-${orderId}`,
        });
        if (sent) {
          order['deliveryEmailSent'] = true;
          order['updated_at'] = new Date().toISOString();
          await kvPutOrder(env.ORDERS_KV, orderId, order);
        }
      }

      // WhatsApp NÃO é enviado aqui — vai pelo cron (delivery-recovery), single-thread,
      // pra nunca duplicar (callback pode disparar mais de uma vez).
      console.log(`KIE CALLBACK OK: ${orderId} → ${collectMp3Urls(order).length}/${versions} versões`);
    }
  } else if (callbackType === 'failed') {
    order['generationStatus'] = 'failed';
    order['updated_at']       = new Date().toISOString();
    await kvPutOrder(env.ORDERS_KV, orderId, order);
  }

  return json({ ok: true });
};
