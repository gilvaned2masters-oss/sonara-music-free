import { asaas } from './_shared/asaas';
import { createMpPixPayment } from './_shared/mercadopago';
import { kvPutOrder } from './_shared/kv-helpers';
import { sendEmail, buildRecoveryEmail } from './_shared/resend';
import { kiwifyFetch } from './_shared/kiwify-auth';

interface Env {
  ORDERS_KV: KVNamespace;
  ASAAS_API_KEY: string;
  MERCADO_PAGO_ACCESS_TOKEN: string;
  KIWIFY_ACCESS_ID: string;
  KIWIFY_PRIVATE_KEY_HEX: string;
  RESEND_API_KEY: string;
  FROM_EMAIL: string;
  OWNER_WHATSAPP: string;
  ADMIN_PASSWORD: string;
  CRON_SECRET: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const MIN = 60 * 1000, H = 60 * MIN;
// Cadência da sequência (intenção decai rápido em compra emocional/impulso):
//  • Stage 1: 30min após gerar o PIX (ainda quente, "seu PIX está te esperando")
//  • Stage 2: +4h (mesmo dia, à noite — "seu PIX pode expirar, gere um novo")
//  • Stage 3: +20h (manhã seguinte — última chance)
// Cada email gera um PIX NOVO e válido, então não há trava de expiração do código.
const STAGE1_AFTER = 30 * MIN;   // 1º email: 30min após criar
const STAGE2_AFTER = 4 * H;      // 2º email: 4h após o 1º (mesmo dia)
const STAGE3_AFTER = 20 * H;     // 3º email: 20h após o 2º (dia seguinte)
const MAX_AGE = 96 * H;          // não recupera carrinho com mais de 4 dias

function subjectFor(stage: number, name: string, title: string): string {
  const t = title ? `"${title}" ` : '';
  if (stage === 1) return `🎵 ${name}, sua música ${t}está quase pronta`;
  if (stage === 2) return `⏳ ${name}, seu PIX vai expirar — finalize sua música`;
  return `🚨 Última chance, ${name} — não perca sua música`;
}

// Gera um PIX NOVO (códigos PIX expiram) e envia o email do estágio. Kiwify (sem taxa) primeiro.
async function sendRecovery(env: Env, paymentId: string, order: Record<string, unknown>, stage: number): Promise<boolean> {
  const now = Date.now();
  const value = Number(order['value'] ?? 39.9);
  let pixPayload = '';
  let encodedImage: string | null = null;

  const isKiwify = order['provider'] === 'kiwify' || !!order['kiwify_qr_id'] || paymentId.startsWith('music-');

  // 1. Kiwify — QR dinâmico novo, SEM taxa por venda
  if (isKiwify && env.KIWIFY_ACCESS_ID && env.KIWIFY_PRIVATE_KEY_HEX) {
    try {
      const kw = await kiwifyFetch(env.KIWIFY_ACCESS_ID, env.KIWIFY_PRIVATE_KEY_HEX, 'POST', '/v1/dynamic-qrcode', {
        amount_in_cents: Math.round(value * 100), type: 'INSTANT', description: 'Masters Music - finalize seu pedido',
      });
      const qrId = String(kw.data['id'] ?? '');
      if (kw.ok && qrId && kw.data['copy_paste']) {
        pixPayload = String(kw.data['copy_paste']);
        encodedImage = String(kw.data['picture_code_base64'] ?? '') || null;
        order['recovery_kiwify_qr_id'] = qrId;
        // reverse lookup: webhook do novo pagamento acha este pedido
        await env.ORDERS_KV.put('kqr:' + qrId, paymentId, { expirationTtl: 86400 * 7 }).catch(() => {});
      }
    } catch (e) { console.error('[pix-recovery] kiwify exceção', String(e)); }
  }

  // 2. Fallback Asaas (pedidos antigos com customerId)
  if (!pixPayload && order['customerId']) {
    const newPay = await asaas(env.ASAAS_API_KEY, 'POST', '/payments', {
      customer: order['customerId'], billingType: 'PIX', value,
      dueDate: new Date(now + 86400000).toISOString().slice(0, 10),
      description: 'Masters Music – recuperação', externalReference: String(order['externalReference'] ?? paymentId),
    });
    if (newPay.ok && newPay.data['id']) {
      const newId = String(newPay.data['id']);
      const qr2 = await asaas(env.ASAAS_API_KEY, 'GET', `/payments/${encodeURIComponent(newId)}/pixQrCode`);
      if (qr2.ok && qr2.data['payload']) {
        pixPayload = String(qr2.data['payload']); encodedImage = String(qr2.data['encodedImage'] ?? '');
        order['recoveryPaymentId'] = newId;
        await env.ORDERS_KV.put('ext:' + newId, paymentId, { expirationTtl: 86400 * 7 }).catch(() => {});
      }
    }
  }

  // 3. Fallback Mercado Pago
  if (!pixPayload && env.MERCADO_PAGO_ACCESS_TOKEN) {
    const mp = await createMpPixPayment(env.MERCADO_PAGO_ACCESS_TOKEN, {
      amount: value, email: String(order['email']), name: String(order['name'] ?? 'Cliente'),
      cpf: String(order['cpf'] ?? ''), description: 'Masters Music – recuperação',
      externalRef: String(order['externalReference'] ?? paymentId) + '-rec' + stage,
    });
    if (mp.ok && mp.payload) { pixPayload = mp.payload; encodedImage = mp.encodedImage ?? null; order['recoveryMpPaymentId'] = mp.mpPaymentId; }
  }

  if (!pixPayload) { console.log('[pix-recovery] sem payload', paymentId); return false; }

  // Marca o estágio ANTES de enviar (evita duplicata em corrida)
  order['recoveryStage'] = stage;
  order['recoveryLastSentAt'] = new Date().toISOString();
  order['recoveryEmailSent'] = true;
  order['updated_at'] = new Date().toISOString();
  try { await kvPutOrder(env.ORDERS_KV, paymentId, order); }
  catch (e) { console.error('[pix-recovery] erro KV', String(e), paymentId); return false; }

  const fn = String(order['name'] ?? '').split(' ')[0];
  const html = buildRecoveryEmail(order, pixPayload, encodedImage, env.OWNER_WHATSAPP, stage);
  const sent = await sendEmail(env.RESEND_API_KEY, env.FROM_EMAIL || 'noreply@mastersmusic.com.br', {
    to: String(order['email']),
    subject: subjectFor(stage, fn, String(order['lyricsTitle'] ?? '')),
    html,
    idempotencyKey: `recovery-${paymentId}-s${stage}`,
  });
  console.log('[pix-recovery] estágio', stage, sent ? 'enviado' : 'FALHOU', order['email'], paymentId);
  return sent;
}

// Decide qual estágio enviar agora (0 = nenhum)
function nextStage(order: Record<string, unknown>, ageMs: number): number {
  const cur = Number(order['recoveryStage'] ?? (order['recoveryEmailSent'] ? 1 : 0));
  const lastSent = order['recoveryLastSentAt'] ? new Date(String(order['recoveryLastSentAt'])).getTime() : 0;
  const sinceLast = Date.now() - lastSent;
  if (cur === 0 && ageMs >= STAGE1_AFTER && ageMs <= MAX_AGE) return 1;
  if (cur === 1 && sinceLast >= STAGE2_AFTER && ageMs <= MAX_AGE) return 2;
  if (cur === 2 && sinceLast >= STAGE3_AFTER && ageMs <= MAX_AGE) return 3;
  return 0;
}

// Pedidos ES (Hotmart/LatAm) pagam via Hotmart, NÃO PIX — nunca recuperar por aqui.
function isEs(o: Record<string, unknown>): boolean {
  return o['source'] === 'esp' || o['provider'] === 'hotmart';
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const secret = url.searchParams.get('secret') ?? '';
  const valid = (!!env.CRON_SECRET && secret === env.CRON_SECRET) || (!!env.ADMIN_PASSWORD && secret === env.ADMIN_PASSWORD);
  if (!secret || !valid) return json({ ok: false, error: 'unauthorized' }, 401);

  const now = Date.now();
  const forceId = url.searchParams.get('paymentId')?.replace(/[^a-zA-Z0-9_.-]/g, '') ?? '';

  // Disparo manual em massa de um estágio específico (ex.: forceStage=2&sinceHours=48):
  // manda o email do estágio X pra todos os pendentes na janela que AINDA não chegaram
  // nesse estágio (trava anti-repetição: recoveryStage>=X é pulado + idempotencyKey no Resend).
  const forceStage = Math.min(Math.max(Number(url.searchParams.get('forceStage') ?? 0), 0), 3);
  const sinceHours = Number(url.searchParams.get('sinceHours') ?? 0);
  const maxAge = (forceStage && sinceHours > 0) ? sinceHours * H : MAX_AGE;

  if (forceId) {
    const raw = await env.ORDERS_KV.get('order:' + forceId);
    if (!raw) return json({ ok: false, error: 'not_found' }, 404);
    const order = JSON.parse(raw) as Record<string, unknown>;
    if (order['paid']) return json({ ok: false, error: 'already_paid' }, 400);
    if (!order['email']) return json({ ok: false, error: 'no_email' }, 400);
    const st = Math.min(Number(order['recoveryStage'] ?? 0) + 1, 3);
    const sent = await sendRecovery(env, forceId, order, st);
    return json({ ok: sent, stage: st });
  }

  const processed: string[] = [];
  let cursor: string | undefined;
  do {
    const list = await env.ORDERS_KV.list({ prefix: 'order:', cursor, limit: 1000 });
    cursor = list.list_complete ? undefined : ((list as { cursor?: string }).cursor);
    for (const k of list.keys) {
      const m = (k.metadata ?? {}) as Record<string, unknown>;
      // Caminho rápido: metadata completa → filtra sem ler o valor.
      if (m['created_at']) {
        if (m['paid'] || m['refunded'] || !m['email'] || isEs(m)) continue;
        const ageMsM = now - new Date(String(m['created_at'])).getTime();
        if (isNaN(ageMsM) || ageMsM < STAGE1_AFTER || ageMsM > maxAge) continue;
      } else {
        // Metadata ausente/incompleta (ex.: pedido reescrito por put cru no passado):
        // usa o timestamp embutido na chave (music-<ts>) pra datar barato. Sem ts → pula.
        const tsMatch = k.name.match(/-(\d{13})-/);
        if (!tsMatch) continue;
        const ageMsK = now - Number(tsMatch[1]);
        if (ageMsK < STAGE1_AFTER || ageMsK > maxAge) continue;
      }

      const raw = await env.ORDERS_KV.get(k.name);
      if (!raw) continue;
      const order = JSON.parse(raw) as Record<string, unknown>;
      if (order['paid'] || isEs(order) || !order['email']) continue;

      // Idade autoritativa pelo valor (created_at real), não pela metadata.
      const ageMs = now - new Date(String(order['created_at'] ?? 0)).getTime();
      if (isNaN(ageMs) || ageMs < STAGE1_AFTER || ageMs > maxAge) continue;

      let stage: number;
      if (forceStage) {
        // Modo manual: pula quem já recebeu esse estágio (ou superior) — não repete.
        if (Number(order['recoveryStage'] ?? 0) >= forceStage) continue;
        stage = forceStage;
      } else {
        stage = nextStage(order, ageMs);
        if (!stage) continue;
      }
      const paymentId = k.name.replace(/^order:/, '');
      if (await sendRecovery(env, paymentId, order, stage)) processed.push(`${paymentId}#${stage}`);
    }
  } while (cursor);

  return json({ ok: true, processed: processed.length, ids: processed });
};
