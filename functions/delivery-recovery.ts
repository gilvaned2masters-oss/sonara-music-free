import { kvPutOrder } from './_shared/kv-helpers';
import { sendEmail, buildDeliveryEmail } from './_shared/resend';
import { sendWhatsAppReady } from './_shared/whatsapp';

interface Env {
  ORDERS_KV: KVNamespace;
  RESEND_API_KEY: string;
  FROM_EMAIL: string;
  OWNER_WHATSAPP: string;
  ADMIN_PASSWORD: string;
  CRON_SECRET: string;
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

// Janela: só pedidos das últimas 48h (carrinhos antigos não fazem sentido reenviar).
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

// ⛔ CORTE DO WHATSAPP: só pedidos criados DEPOIS deste instante recebem WhatsApp.
// Trava definitiva contra envio em massa de backlog — NENHUM pedido antigo é tocado, jamais,
// nem que o flag whatsappNotifSent falhe. (2026-06-21 14:56 UTC)
const WHATSAPP_CUTOFF_MS = 1782053765474;
function whatsappEligible(order: Record<string, unknown>): boolean {
  const createdMs = Date.parse(String(order['created_at'] ?? '')) || 0;
  return createdMs > WHATSAPP_CUTOFF_MS && !order['whatsappNotifSent'] && !!order['phone'];
}

/**
 * Recuperação de ENTREGA: pega pedidos pagos com a música pronta (mp3_url +
 * treblo_status=success) mas SEM email de entrega enviado e dispara o email.
 * Cobre o caso do cliente que fechou a página /pronto antes do poll que envia o email.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const secret = url.searchParams.get('secret') ?? '';
  const valid = (!!env.CRON_SECRET && secret === env.CRON_SECRET)
    || (!!env.ADMIN_PASSWORD && secret === env.ADMIN_PASSWORD);
  if (!secret || !valid) return json({ ok: false, error: 'unauthorized' }, 401);

  // Envia email E WhatsApp (cada um 1x). Roda no cron = SINGLE-THREAD → nunca duplica
  // (diferente do envio inline no auto-status/callback, onde o polling causava corrida).
  async function deliver(paymentId: string, order: Record<string, unknown>): Promise<boolean> {
    let changed = false;
    // Email
    if (!order['deliveryEmailSent'] && env.RESEND_API_KEY && order['email']) {
      const html = buildDeliveryEmail(order, env.OWNER_WHATSAPP);
      const ok = await sendEmail(env.RESEND_API_KEY, env.FROM_EMAIL || 'noreply@mastersmusic.com.br', {
        to: String(order['email']),
        subject: `Sua música está pronta — baixe agora! 🎵`,
        html,
        idempotencyKey: `delivery-${paymentId}`,
      });
      if (ok) { order['deliveryEmailSent'] = true; changed = true; }
    }
    // WhatsApp: independente do email, mas ainda 1x por pedido e single-thread via cron.
    // Se o Resend falhar ou atrasar, o cliente ainda recebe o link de entrega no WhatsApp.
    if (whatsappEligible(order)) {
      const wok = await sendWhatsAppReady(env, order, paymentId);
      if (wok) {
        Object.assign(order, {
          whatsappNotifSent: true,
          whatsappSentAt: new Date().toISOString(),
        });
        changed = true;
      }
    }
    if (changed) {
      // NÃO marca delivered: enviar não é "entregue". Entregue = cliente baixou.
      order['updated_at'] = new Date().toISOString();
      await kvPutOrder(env.ORDERS_KV, paymentId, order);
    }
    return changed;
  }

  // Modo forçado: um paymentId específico
  const forceId = url.searchParams.get('paymentId')?.replace(/[^a-zA-Z0-9_.-]/g, '') ?? '';
  if (forceId) {
    const raw = await env.ORDERS_KV.get('order:' + forceId);
    if (!raw) return json({ ok: false, error: 'not_found' }, 404);
    const o = JSON.parse(raw) as Record<string, unknown>;
    const ok = await deliver(forceId, o);
    return json({
      ok,
      sent: ok ? 1 : 0,
      deliveryEmailSent: !!o['deliveryEmailSent'],
      whatsappNotifSent: !!o['whatsappNotifSent'],
      whatsappSentAt: o['whatsappSentAt'] ?? '',
    });
  }

  // Scan geral — pré-filtra pela metadata (paid + música pronta + email + recente)
  const now = Date.now();
  const sent: string[] = [];
  let checked = 0;
  let cursor: string | undefined;
  do {
    const list = await env.ORDERS_KV.list({ prefix: 'order:', cursor, limit: 1000 });
    cursor = list.list_complete ? undefined : ((list as { cursor?: string }).cursor);
    for (const k of list.keys) {
      const m = (k.metadata ?? {}) as Record<string, unknown>;
      if (!m['paid'] || m['refunded'] || !m['email']) continue;
      // Pedidos ES (Hotmart/LatAm) têm fluxo próprio (esp-delivery-cron) com email em espanhol.
      // Nunca processar aqui — evita mandar email PT pra cliente ES.
      if (m['source'] === 'esp' || m['provider'] === 'hotmart') continue;
      // só pedidos com produção concluída (evita ler todos os pedidos)
      if (!m['delivered'] && m['prodStatus'] !== 'pronto') continue;
      const ca = new Date(String(m['created_at'] ?? 0)).getTime();
      if (isNaN(ca) || now - ca > MAX_AGE_MS) continue;

      const raw = await env.ORDERS_KV.get(k.name);
      if (!raw) continue;
      let o: Record<string, unknown>;
      try { o = JSON.parse(raw) as Record<string, unknown>; } catch { continue; }

      // só os realmente prontos; processa se faltar email OU WhatsApp elegível (pós-cutoff)
      if (!o['mp3_url'] || o['treblo_status'] !== 'success') continue;
      if (o['deliveryEmailSent'] && !whatsappEligible(o)) continue;
      checked++;
      const paymentId = k.name.replace(/^order:/, '');
      if (await deliver(paymentId, o)) sent.push(paymentId);
    }
  } while (cursor);

  return json({ ok: true, sent: sent.length, checked, ids: sent });
};
