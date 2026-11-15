import { refreshAutoOrder, type AutoStatusEnv } from './auto-status';

interface Env extends AutoStatusEnv {
  SONARA_SETTLEMENT_TOKEN: string;
}

const CURSOR_KEY = 'system:production-scan-cursor';
const PAGE_SIZE = 60;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

// Avoid early-return string comparison for the timer's internal credential.
function equalSecret(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left), b = new TextEncoder().encode(right);
  let diff = a.length ^ b.length;
  const size = Math.max(a.length, b.length);
  for (let i = 0; i < size; i++) diff |= (a[i % (a.length || 1)] ?? 0) ^ (b[i % (b.length || 1)] ?? 0);
  return diff === 0 && a.length > 0;
}

/**
 * Continues Sonara-only generation and delivery without a buyer's browser.
 * This is intentionally a separate authenticated endpoint so it cannot run
 * from public traffic and has no relationship to Nail's webhook or services.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const supplied = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!equalSecret(supplied, env.SONARA_SETTLEMENT_TOKEN || '')) return json({ ok: false }, 401);

  const savedCursor = await env.ORDERS_KV.get(CURSOR_KEY);
  const list = await env.ORDERS_KV.list({ prefix: 'order:', cursor: savedCursor || undefined, limit: PAGE_SIZE });
  const nextCursor = list.list_complete ? '' : (list as { cursor?: string }).cursor || '';
  await env.ORDERS_KV.put(CURSOR_KEY, nextCursor, { expirationTtl: 86400 });

  let scanned = 0, refreshed = 0, failed = 0;
  const origin = new URL(request.url).origin;
  for (const key of list.keys) {
    const raw = await env.ORDERS_KV.get(key.name);
    if (!raw) continue;
    let order: Record<string, unknown>;
    try { order = JSON.parse(raw) as Record<string, unknown>; } catch { continue; }
    if (order['provider'] !== 'efi' || order['paid'] !== true || order['source'] !== 'auto' || order['prodStatus'] === 'pronto') continue;
    scanned++;
    try {
      await refreshAutoOrder(env, key.name.slice('order:'.length), order, origin);
      refreshed++;
    } catch (error) {
      failed++;
      console.error('[sonara][production-scan] refresh failed', key.name.slice('order:'.length), error instanceof Error ? error.message : 'unknown');
    }
  }
  console.log('[sonara][production-scan]', JSON.stringify({ scanned, refreshed, failed }));
  return json({ ok: true, scanned, refreshed, failed, next: nextCursor ? 'more' : 'restart' });
};
