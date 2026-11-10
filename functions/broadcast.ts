// Disparo de email em massa (broadcast único). Protegido por senha admin.
// Idempotente: lista fixada no KV + ponteiro de índice + Idempotency-Key por lote no Resend.
//   GET /broadcast?secret=...&test=email@x   → envia 1 teste
//   GET /broadcast?secret=...&campaign=area&limit=100   → processa o próximo lote
//   GET /broadcast?secret=...&campaign=area&reset=1      → recomeça a lista (não reenvia já enviados via Idempotency-Key)
import { buildAnnouncementEmail, sendEmail } from './_shared/resend';

interface Env {
  ORDERS_KV: KVNamespace;
  RESEND_API_KEY: string;
  FROM_EMAIL: string;
  ADMIN_PASSWORD: string;
  CRON_SECRET: string;
}

const SUBJECT = '🎁 Sua área do cliente + ganhe músicas grátis — Masters Music';

function json(d: unknown, s = 200): Response {
  return new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function nextCursor(list: { list_complete: boolean }): string | undefined {
  return list.list_complete ? undefined : (list as unknown as { cursor?: string }).cursor;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const secret = url.searchParams.get('secret') ?? '';
  const ok = (!!env.ADMIN_PASSWORD && secret === env.ADMIN_PASSWORD) || (!!env.CRON_SECRET && secret === env.CRON_SECRET);
  if (!ok) return json({ ok: false, error: 'unauthorized' }, 401);
  if (!env.RESEND_API_KEY) return json({ ok: false, error: 'no_resend_key' }, 500);
  const from = env.FROM_EMAIL || 'noreply@mastersmusic.com.br';

  // Modo teste
  const test = (url.searchParams.get('test') || '').trim().toLowerCase();
  if (test) {
    const sent = await sendEmail(env.RESEND_API_KEY, from, { to: test, subject: SUBJECT, html: buildAnnouncementEmail(''), idempotencyKey: 'bcast-test-' + test });
    return json({ ok: sent, test });
  }

  const campaign = (url.searchParams.get('campaign') || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!campaign) return json({ ok: false, error: 'missing_campaign' }, 400);
  const limit = Math.min(Number(url.searchParams.get('limit') || 100), 100);
  const listKey = 'bcastlist:' + campaign;
  const idxKey = 'bcastidx:' + campaign;

  if (url.searchParams.get('reset') === '1') {
    await env.ORDERS_KV.delete(listKey); await env.ORDERS_KV.delete(idxKey);
    return json({ ok: true, reset: true });
  }

  // Monta a lista (1x) — emails únicos de pedidos PAGOS, com nome
  let listRaw = await env.ORDERS_KV.get(listKey);
  if (!listRaw) {
    const map = new Map<string, string>();
    let cursor: string | undefined;
    do {
      const list = await env.ORDERS_KV.list<Record<string, unknown>>({ prefix: 'order:', cursor, limit: 1000 });
      cursor = nextCursor(list);
      for (const k of list.keys) {
        const m = (k.metadata ?? {}) as Record<string, unknown>;
        if (!m['paid']) continue;
        const e = String(m['email'] ?? '').trim().toLowerCase();
        if (!e || !e.includes('@')) continue;
        if (!map.has(e)) map.set(e, String(m['name'] ?? '').split(' ')[0] || '');
      }
    } while (cursor);
    const arr = Array.from(map.entries()).map(([email, name]) => ({ email, name }));
    listRaw = JSON.stringify(arr);
    await env.ORDERS_KV.put(listKey, listRaw);
    await env.ORDERS_KV.put(idxKey, '0');
  }
  const arr = JSON.parse(listRaw) as Array<{ email: string; name: string }>;
  const idx = Number((await env.ORDERS_KV.get(idxKey)) || '0');
  if (idx >= arr.length) return json({ ok: true, done: true, total: arr.length, idx });

  // Envio INDIVIDUAL (1 email ruim não derruba os outros) com idempotência por email.
  const batch = arr.slice(idx, idx + limit);
  let okCount = 0, failCount = 0;
  for (const b of batch) {
    if (!b.email.includes('@') || b.email.length < 6) { failCount++; continue; }
    const ok2 = await sendEmail(env.RESEND_API_KEY, from, {
      to: b.email, subject: SUBJECT, html: buildAnnouncementEmail(b.name),
      idempotencyKey: `bcast-${campaign}-${b.email}`,
    });
    ok2 ? okCount++ : failCount++;
    await sleep(120); // respeita rate limit do Resend
  }

  const newIdx = idx + batch.length;
  await env.ORDERS_KV.put(idxKey, String(newIdx));
  return json({ ok: true, sentNow: okCount, failed: failCount, idx: newIdx, total: arr.length, done: newIdx >= arr.length });
};
