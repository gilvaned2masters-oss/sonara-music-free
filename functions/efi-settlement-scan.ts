import { settleEfiOrder, type EfiSettlementEnv } from './_shared/efi-settlement';

interface Env extends EfiSettlementEnv {
  SONARA_SETTLEMENT_TOKEN: string;
}

const CURSOR_KEY = 'system:efi-settlement-cursor';
const PAGE_SIZE = 100;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function equalSecret(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left), b = new TextEncoder().encode(right);
  let diff = a.length ^ b.length;
  const size = Math.max(a.length, b.length);
  for (let i = 0; i < size; i++) diff |= (a[i % (a.length || 1)] ?? 0) ^ (b[i % (b.length || 1)] ?? 0);
  return diff === 0 && a.length > 0;
}

/** Called only by the Sonara Cloudflare Cron Worker; it never accepts browser input. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const supplied = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!equalSecret(supplied, env.SONARA_SETTLEMENT_TOKEN || '')) return json({ ok: false }, 401);

  const savedCursor = await env.ORDERS_KV.get(CURSOR_KEY);
  const list = await env.ORDERS_KV.list<Record<string, unknown>>({ prefix: 'order:', cursor: savedCursor || undefined, limit: PAGE_SIZE });
  const nextCursor = list.list_complete ? '' : (list as { cursor?: string }).cursor || '';
  await env.ORDERS_KV.put(CURSOR_KEY, nextCursor, { expirationTtl: 86400 });

  const result: Record<string, number> = { scanned: 0, confirmed: 0, pending: 0, processing: 0, retry: 0, mismatch: 0 };
  const origin = new URL(request.url).origin;
  for (const key of list.keys) {
    const meta = key.metadata ?? {};
    if (meta['provider'] !== 'efi' || meta['paid'] === true || meta['refunded'] === true) continue;
    const raw = await env.ORDERS_KV.get(key.name);
    if (!raw) continue;
    let order: Record<string, unknown>;
    try { order = JSON.parse(raw) as Record<string, unknown>; } catch { continue; }
    if (order['paid'] || order['provider'] !== 'efi' || order['efiRetryExhausted'] === true) continue;
    const nextRetry = Date.parse(String(order['efiNextRetryAt'] ?? ''));
    if (Number.isFinite(nextRetry) && nextRetry > Date.now()) continue;
    const paymentId = key.name.slice('order:'.length);
    result.scanned++;
    try {
      const state = await settleEfiOrder(env, paymentId, order, origin);
      result[state] = (result[state] ?? 0) + 1;
    } catch (error) {
      result.retry++;
      console.error('[sonara][settlement-scan] order processing failed', paymentId, error instanceof Error ? error.message : 'unknown');
    }
  }
  console.log('[sonara][settlement-scan]', JSON.stringify(result));
  return json({ ok: true, ...result, next: nextCursor ? 'more' : 'restart' });
};
