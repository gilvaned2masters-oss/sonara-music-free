import { kvPutOrder } from './_shared/kv-helpers';
import { sendEmail, buildDeliveryEmail, buildDeliveryEmailES } from './_shared/resend';
import {
  versionsCount, tasksNeeded, collectMp3Urls, saveMp3Urls,
  sunorTaskIds, kieTaskIds, startSunorGeneration, pollSunorTasks,
  startKieGeneration, pollKieTasks,
} from './_shared/generation';
import { storeMp3ToR2 } from './_shared/audio-store';

interface Env {
  ORDERS_KV: KVNamespace;
  AUDIO_BUCKET: R2Bucket;
  SUNOR_API_KEY: string;
  KIE_API_KEY: string;
  RESEND_API_KEY: string;
  FROM_EMAIL: string;
  OWNER_WHATSAPP: string;
  EVOLUTION_API_URL?: string;
  EVOLUTION_API_KEY?: string;
  EVOLUTION_INSTANCE?: string;
}

// Baixa as músicas (URLs externas) e as guarda no R2, devolvendo /audio/{id}.
// URLs do KIE expiram; o R2 (nosso domínio) é permanente.
async function toR2(env: Env, paymentId: string, urls: string[]): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    if (u.startsWith('/audio/')) { out.push(u); continue; } // já no R2
    const key = 'audio/' + paymentId + '-v' + (i + 1) + '.mp3';
    if (await storeMp3ToR2(env.AUDIO_BUCKET, key, u)) out.push('/' + key);
    else out.push(u);
  }
  return out;
}

function orderMeta(order: Record<string, unknown>) {
  return {
    mp3_url:      String(order['mp3_url']        ?? ''),
    mp3_url_2:    String(order['mp3_url_2']       ?? ''),
    mp3_url_3:    String(order['mp3_url_3']       ?? ''),
    mp3_url_4:    String(order['mp3_url_4']       ?? ''),
    versions:     versionsCount(order),
    title:        String(order['lyricsTitle']     ?? ''),
    name:         String(order['name']            ?? ''),
    email:        String(order['email']           ?? ''),
    estilo:       String(order['estilo']          ?? ''),
    ocasiao:      String(order['ocasiao']         ?? ''),
    destinatario: String(order['destinatario']    ?? ''),
    extraVersion: !!order['orderBumpExtraVersion'],
    extraSongs:   !!order['orderBumpExtraSongs'],
    qrCode:       !!order['orderBumpQrCode'],
    video:        !!order['orderBumpVideo'],
    source:       String(order['source']           ?? ''),
    lang:         String(order['lang']             ?? ''),
  };
}

// Email de entrega no idioma do pedido (ES para cenário espanhol)
function deliveryHtml(order: Record<string, unknown>, wa: string): string {
  const isEs = order['lang'] === 'es' || order['source'] === 'esp';
  return isEs ? buildDeliveryEmailES(order, wa) : buildDeliveryEmail(order, wa);
}
function deliverySubject(order: Record<string, unknown>): string {
  const isEs = order['lang'] === 'es' || order['source'] === 'esp';
  return isEs ? '¡Tu canción está lista — descárgala ahora! 🎵' : 'Sua música está pronta — baixe agora! 🎵';
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// Finaliza: grava URLs (sempre no R2, nunca em CDN externo que pode expirar),
// marca sucesso e envia email de entrega.
async function finalize(
  env: Env, paymentId: string, order: Record<string, unknown>, urls: string[],
): Promise<Response> {
  const r2urls = await toR2(env, paymentId, urls); // baixa do Sunor/KIE → R2 (idempotente)
  saveMp3Urls(order, r2urls);
  order['treblo_status'] = 'success';
  order['prodStatus']    = 'pronto';
  // NÃO marca delivered aqui: "entregue" = cliente baixou (mark-delivered no clique de download).
  order['updated_at']    = new Date().toISOString();
  await kvPutOrder(env.ORDERS_KV, paymentId, order);

  if (!order['deliveryEmailSent'] && env.RESEND_API_KEY && order['email']) {
    const html = deliveryHtml(order, env.OWNER_WHATSAPP);
    const sent = await sendEmail(env.RESEND_API_KEY, env.FROM_EMAIL || 'noreply@mastersmusic.com.br', {
      to: String(order['email']),
      subject: deliverySubject(order),
      html,
      idempotencyKey: `delivery-${paymentId}`,
    });
    if (sent) {
      order['deliveryEmailSent'] = true;
      order['updated_at']        = new Date().toISOString();
      await kvPutOrder(env.ORDERS_KV, paymentId, order);
    }
  }

  // WhatsApp NÃO é enviado aqui (polling causa corrida → duplicava). Vai pelo cron
  // delivery-recovery (single-thread). Email continua aqui (Resend dedupa por idempotencyKey).
  return json({ ok: true, paid: true, status: 'success', ...orderMeta(order) });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const paymentId = (url.searchParams.get('paymentId') ?? '').replace(/[^a-zA-Z0-9_.-]/g, '');

  if (!paymentId) return json({ ok: false, error: 'missing_paymentId' }, 400);

  const raw = env.ORDERS_KV ? await env.ORDERS_KV.get('order:' + paymentId) : null;
  if (!raw) return json({ ok: false, error: 'not_found' }, 404);

  const order = JSON.parse(raw) as Record<string, unknown>;

  if (!order['paid']) {
    return json({ ok: true, paid: false, status: 'waiting_payment' });
  }

  const versions = versionsCount(order);

  // ── Resultado já entregue (cacheado no KV) ────────────────────────────────
  if (order['treblo_status'] === 'success' && collectMp3Urls(order).length >= versions) {
    // Retry email caso não tenha saído antes
    if (!order['deliveryEmailSent'] && env.RESEND_API_KEY && order['email']) {
      const html = deliveryHtml(order, env.OWNER_WHATSAPP);
      const sent = await sendEmail(env.RESEND_API_KEY, env.FROM_EMAIL || 'noreply@mastersmusic.com.br', {
        to: String(order['email']),
        subject: deliverySubject(order),
        html,
        idempotencyKey: `delivery-${paymentId}`,
      });
      if (sent) {
        order['deliveryEmailSent'] = true;
        order['updated_at'] = new Date().toISOString();
        await kvPutOrder(env.ORDERS_KV, paymentId, order);
      }
    }
    // OBS: WhatsApp NÃO é enviado aqui (branch de cache, roda a cada polling) — evita
    // duplicação. Quem envia é o kie-callback (KIE) / o finalize p/ Sunor, 1x por pedido.
    return json({ ok: true, paid: true, status: 'success', ...orderMeta(order) });
  }

  const createdAt = new Date(String(order['created_at'] ?? 0)).getTime();
  const minutos   = (Date.now() - createdAt) / 60000;
  const need      = tasksNeeded(order);

  // ── Modo KIE (fallback já acionado): poll de todas as tasks KIE ───────────
  if (kieTaskIds(order).length && env.KIE_API_KEY) {
    // Dispara tasks KIE que ainda faltam (ex.: 4 versões, só 1 task criada)
    if (need > kieTaskIds(order).length) {
      await startKieGeneration(env.ORDERS_KV, env.KIE_API_KEY, url.origin, paymentId, order);
    }
    const { state, urls } = await pollKieTasks(env.KIE_API_KEY, kieTaskIds(order));
    if (state === 'success' && urls.length >= versions) return finalize(env, paymentId, order, urls);
    if (state === 'failure') return json({ ok: true, paid: true, status: 'failed' });
    return json({ ok: true, paid: true, status: 'generating' });
  }

  // ── Garantir que as tasks Sunor necessárias foram disparadas ──────────────
  if (env.SUNOR_API_KEY && need > sunorTaskIds(order).length) {
    const lyrics = String(order['savedLetra'] || '');
    if (!lyrics && !sunorTaskIds(order).length) {
      // Sem letra e sem task: nada a gerar
      if (minutos > 20) return json({ ok: true, paid: true, status: 'failed' });
      return json({ ok: true, paid: true, status: 'queued' });
    }
    await startSunorGeneration(env.ORDERS_KV, env.SUNOR_API_KEY, paymentId, order);
  }

  if (!sunorTaskIds(order).length) {
    // Sunor não conseguiu criar task (ex.: 502 do lado deles). Cai pro KIE antes de desistir.
    if (env.KIE_API_KEY && !kieTaskIds(order).length) {
      await startKieGeneration(env.ORDERS_KV, env.KIE_API_KEY, url.origin, paymentId, order);
    }
    if (kieTaskIds(order).length) return json({ ok: true, paid: true, status: 'generating' });
    if (minutos > 20) return json({ ok: true, paid: true, status: 'failed' });
    return json({ ok: true, paid: true, status: 'queued' });
  }

  // ── Poll Sunor (todas as tasks) ───────────────────────────────────────────
  let sunorState: 'success' | 'generating' | 'failure' = 'failure';
  let urls: string[] = [];
  if (env.SUNOR_API_KEY) {
    const r = await pollSunorTasks(env.SUNOR_API_KEY, sunorTaskIds(order));
    sunorState = r.state; urls = r.urls;
  } else {
    console.error('[auto-status] SUNOR_API_KEY ausente — acionando KIE fallback:', paymentId);
  }

  if (sunorState === 'success' && urls.length >= versions) {
    return finalize(env, paymentId, order, urls);
  }
  if (sunorState === 'success' && urls.length > 0) {
    // Sucesso parcial (alguma task falhou) — entrega o que tem e registra
    console.error('[auto-status] Sunor parcial:', urls.length, 'de', versions, 'para', paymentId);
    return finalize(env, paymentId, order, urls);
  }
  if (sunorState === 'generating') {
    return json({ ok: true, paid: true, status: 'generating' });
  }

  // ── Sunor falhou (sem áudio) → fallback KIE ───────────────────────────────
  console.log('[auto-status] Sunor falhou, ativando KIE fallback para:', paymentId);
  if (env.KIE_API_KEY && !kieTaskIds(order).length) {
    await startKieGeneration(env.ORDERS_KV, env.KIE_API_KEY, url.origin, paymentId, order);
  }
  return json({ ok: true, paid: true, status: 'generating' });
};
