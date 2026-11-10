import { extractMeta, kvPutOrder, type OrderMeta } from './_shared/kv-helpers';
import { sendEmail, buildConfirmationEmail, buildMusicDeliveryEmail } from './_shared/resend';
import { buildSunorPayload } from './_shared/treblo-helpers';
import { startKieGeneration } from './_shared/generation';

interface Env {
  ORDERS_KV: KVNamespace;
  ADMIN_PASSWORD: string;
  RESEND_API_KEY: string;
  FROM_EMAIL: string;
  OWNER_WHATSAPP: string;
  SUNOR_API_KEY: string;
  KIE_API_KEY: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function nextCursor(list: { list_complete: boolean }): string | undefined {
  return list.list_complete ? undefined : (list as unknown as { cursor?: string }).cursor;
}

function checkAuth(request: Request, env: Env): boolean {
  const auth = request.headers.get('Authorization') ?? '';
  const b64 = auth.replace(/^Basic\s+/i, '');
  if (!b64) return false;
  try {
    const decoded = atob(b64);
    const [, pass] = decoded.split(':');
    const expected = env.ADMIN_PASSWORD || '';
    return pass === expected;
  } catch {
    return false;
  }
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkAuth(request, env)) return unauthorized();

  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  // PATCH /admin-orders?paymentId=xxx  → update order fields
  if (method === 'PATCH') {
    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return json({ ok: false, error: 'invalid_body' }, 400);
    }

    const paymentId = url.searchParams.get('paymentId')?.replace(/[^a-zA-Z0-9_.-]/g, '') ?? '';
    if (!paymentId) return json({ ok: false, error: 'missing_payment_id' }, 400);

    try {
      const raw = await env.ORDERS_KV.get('order:' + paymentId);
      if (!raw) return json({ ok: false, error: 'not_found' }, 404);

      let order: Record<string, unknown>;
      try {
        order = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return json({ ok: false, error: 'order_corrupted' }, 500);
      }

      const wasPaid = Boolean(order['paid']);
      const allowed = [
        'delivered',
        'notes',
        'status',
        'prodStatus',
        'musicLink',
        'savedLetra',
        'videoDelivered',
        'videoPending',
        'paid',
        'refunded',
        'phone',
        'responsavel',
        'confirmationEmailSent',
        'deliveryEmailSent',
        'whatsappNotifSent',
        'whatsappSentAt',
      ];
      for (const key of allowed) {
        if (Object.prototype.hasOwnProperty.call(body, key)) order[key] = body[key];
      }
      order['updated_at'] = new Date().toISOString();

      await kvPutOrder(env.ORDERS_KV, paymentId, order);

      // Envia email de confirmação quando marcado como pago manualmente
      if (!wasPaid && order['paid'] && env.RESEND_API_KEY && order['email'] && !order['confirmationEmailSent']) {
        const html = buildConfirmationEmail(order, env.OWNER_WHATSAPP);
        const sent = await sendEmail(env.RESEND_API_KEY, env.FROM_EMAIL || 'noreply@mastersmusic.com.br', {
          to: String(order['email']),
          subject: `Pedido confirmado — sua música está sendo criada 🎵`,
          html,
        });
        if (sent) {
          order['confirmationEmailSent'] = true;
          order['updated_at'] = new Date().toISOString();
          await kvPutOrder(env.ORDERS_KV, paymentId, order);
        }
      }

      return json({ ok: true });
    } catch (e) {
      console.error('[admin-orders PATCH]', String(e));
      return json({ ok: false, error: 'internal', detail: String(e) }, 500);
    }
  }

  // GET /admin-orders?paymentId=xxx → fetch single order (full data for modal)
  if (method === 'GET' && url.searchParams.has('paymentId')) {
    let paymentId = url.searchParams.get('paymentId')?.replace(/[^a-zA-Z0-9_.-]/g, '') ?? '';
    if (!paymentId) return json({ ok: false, error: 'missing_payment_id' }, 400);
    try {
      let raw = await env.ORDERS_KV.get('order:' + paymentId);
      // Fallback 1: reverse lookup ext:{externalRef} → paymentId real (Asaas)
      if (!raw) {
        const realId = await env.ORDERS_KV.get('ext:' + paymentId);
        if (realId) {
          paymentId = realId;
          raw = await env.ORDERS_KV.get('order:' + paymentId);
        }
      }
      // Fallback 2: scan por externalReference (pedidos antigos sem reverse lookup)
      if (!raw && paymentId.startsWith('music-')) {
        let cursor: string | undefined;
        do {
          const list = await env.ORDERS_KV.list({ prefix: 'order:', cursor, limit: 1000 });
          for (const k of list.keys) {
            const r = await env.ORDERS_KV.get(k.name);
            if (!r) continue;
            try {
              const o = JSON.parse(r) as Record<string, unknown>;
              if (String(o['externalReference'] ?? '') === paymentId) {
                raw = r;
                paymentId = String(o['paymentId'] ?? k.name.replace(/^order:/, ''));
                // Criar reverse lookup para buscas futuras
                await env.ORDERS_KV.put('ext:' + String(o['externalReference']), paymentId, { expirationTtl: 86400 * 30 }).catch(() => {});
                break;
              }
            } catch { /* skip */ }
          }
          if (raw) break;
          cursor = nextCursor(list);
        } while (cursor);
      }
      if (!raw) return json({ ok: false, error: 'not_found' }, 404);
      return json({ ok: true, order: JSON.parse(raw) });
    } catch (e) {
      return json({ ok: false, error: 'internal', detail: String(e) }, 500);
    }
  }

  // GET /admin-orders  → list all orders
  if (method === 'GET') {
    try {
      const cursor = url.searchParams.get('cursor') ?? undefined;
      // limit 1000 = máximo do KV, menos round trips sequenciais
      const list = await env.ORDERS_KV.list<OrderMeta>({ prefix: 'order:', cursor, limit: 1000 });

      const orders = await Promise.all(
        list.keys.map(async (k) => {
          // Fast path: usar metadata gravada junto com a chave — zero gets adicionais
          if (k.metadata && k.metadata.paymentId) {
            return k.metadata as Record<string, unknown>;
          }
          // Fallback para pedidos antigos sem metadata
          const raw = await env.ORDERS_KV.get(k.name);
          if (!raw) return null;
          try {
            return JSON.parse(raw) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
      );

      return json({
        ok: true,
        orders: orders.filter(Boolean),
        cursor: nextCursor(list) ?? null,
      });
    } catch (e) {
      console.error('[admin-orders GET]', String(e));
      return json({ ok: false, error: 'internal', detail: String(e) }, 500);
    }
  }

  // POST /admin-orders?action=force-generate&paymentId=xxx → disparar geração Sunor manualmente
  if (method === 'POST' && url.searchParams.get('action') === 'force-generate') {
    const paymentId = url.searchParams.get('paymentId')?.replace(/[^a-zA-Z0-9_.-]/g, '') ?? '';
    if (!paymentId) return json({ ok: false, error: 'missing_payment_id' }, 400);
    try {
      const raw = await env.ORDERS_KV.get('order:' + paymentId);
      if (!raw) return json({ ok: false, error: 'not_found' }, 404);
      const order = JSON.parse(raw) as Record<string, unknown>;
      if (!order['paid']) return json({ ok: false, error: 'not_paid' }, 400);
      if (order['mp3_url']) return json({ ok: false, error: 'already_has_music' }, 400);
      if (order['sunor_task_id'] || order['kie_task_id']) return json({ ok: false, error: 'already_generating', detail: String(order['sunor_task_id'] || order['kie_task_id']) }, 400);
      const lyrics = String(order['savedLetra'] || '');
      if (!lyrics) return json({ ok: false, error: 'no_lyrics' }, 400);
      const voz          = String(order['voz']          || 'Feminina');
      const estilo       = String(order['estilo']       || 'Sertanejo Universitário');
      const destinatario = String(order['destinatario'] || '');
      const title        = String(order['lyricsTitle']  || `Para ${destinatario}`);
      const sunorStyle   = String(order['sunorStyle']   || '');

      // 1. Tenta Sunor
      let sunorTaskId = '';
      if (env.SUNOR_API_KEY) {
        try {
          const sunorRes = await fetch('https://sunor.cc/api/v1/task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': env.SUNOR_API_KEY },
            body: JSON.stringify(buildSunorPayload({ estilo, voz, lyrics, title, sunorStyle })),
          });
          if (sunorRes.ok) {
            const sunorData = await sunorRes.json() as { data?: { task_id?: string } };
            sunorTaskId = String(sunorData?.data?.task_id ?? '');
          } else {
            console.error('[admin force-generate] Sunor erro', sunorRes.status, await sunorRes.text().catch(() => ''));
          }
        } catch (e) { console.error('[admin force-generate] Sunor exceção', String(e)); }
      }
      if (sunorTaskId) {
        order['sunor_task_id'] = sunorTaskId;
        order['treblo_status'] = 'generating';
        order['prodStatus']    = 'gerando_musica';
        order['updated_at']    = new Date().toISOString();
        await kvPutOrder(env.ORDERS_KV, paymentId, order);
        console.log('[admin force-generate] Sunor task:', sunorTaskId, 'para:', paymentId);
        return json({ ok: true, sunor_task_id: sunorTaskId });
      }

      // 2. Fallback KIE (quando o Sunor falha, ex.: 502)
      if (env.KIE_API_KEY) {
        const origin = new URL(request.url).origin;
        await startKieGeneration(env.ORDERS_KV, env.KIE_API_KEY, origin, paymentId, order);
        if (order['kie_task_id']) {
          order['treblo_status'] = 'generating';
          order['prodStatus']    = 'gerando_musica';
          order['updated_at']    = new Date().toISOString();
          await kvPutOrder(env.ORDERS_KV, paymentId, order);
          console.log('[admin force-generate] KIE task:', order['kie_task_id'], 'para:', paymentId);
          return json({ ok: true, kie_task_id: String(order['kie_task_id']) });
        }
      }
      return json({ ok: false, error: 'gen_failed', detail: 'Sunor (502) e KIE indisponíveis' }, 502);
    } catch (e) {
      return json({ ok: false, error: 'internal', detail: String(e) }, 500);
    }
  }

  // POST /admin-orders?action=send-music-email&paymentId=xxx
  if (method === 'POST' && url.searchParams.get('action') === 'send-music-email') {
    const paymentId = url.searchParams.get('paymentId')?.replace(/[^a-zA-Z0-9_.-]/g, '') ?? '';
    if (!paymentId) return json({ ok: false, error: 'missing_payment_id' }, 400);
    try {
      const raw = await env.ORDERS_KV.get('order:' + paymentId);
      if (!raw) return json({ ok: false, error: 'not_found' }, 404);
      const order = JSON.parse(raw) as Record<string, unknown>;
      const musicLink = String(order['musicLink'] ?? '');
      if (!musicLink) return json({ ok: false, error: 'no_music_link' }, 400);
      if (!order['email']) return json({ ok: false, error: 'no_email' }, 400);
      const html = buildMusicDeliveryEmail(order, musicLink, env.OWNER_WHATSAPP);
      const sent = await sendEmail(env.RESEND_API_KEY, env.FROM_EMAIL || 'noreply@mastersmusic.com.br', {
        to: String(order['email']),
        subject: '🎵 Sua música personalizada está pronta!',
        html,
      });
      return json({ ok: sent, error: sent ? undefined : 'email_failed' });
    } catch (e) {
      return json({ ok: false, error: 'internal', detail: String(e) }, 500);
    }
  }

  return json({ ok: false, error: 'method_not_allowed' }, 405);
};
