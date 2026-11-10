import type { OrderMeta } from './_shared/kv-helpers';

interface Env {
  ORDERS_KV: KVNamespace;
  ADMIN_SECRET: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function startOf(unit: 'day' | 'week' | 'month'): Date {
  const d = new Date();
  if (unit === 'day')   { d.setHours(0, 0, 0, 0); return d; }
  if (unit === 'week')  { d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); return d; }
  d.setHours(0, 0, 0, 0); d.setDate(1); return d;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = request.headers.get('x-admin-secret') ?? new URL(request.url).searchParams.get('secret') ?? '';
  if (auth !== env.ADMIN_SECRET) return json({ ok: false, error: 'unauthorized' }, 401);

  if (!env.ORDERS_KV) return json({ ok: false, error: 'kv_unavailable' }, 500);

  // ── Collect all orders via metadata (no per-key reads needed) ──────────────
  const metas: OrderMeta[] = [];
  let cursor: string | undefined;

  do {
    const page = await env.ORDERS_KV.list<OrderMeta>({ prefix: 'order:', cursor, limit: 1000 });
    for (const key of page.keys) {
      if (key.metadata) metas.push(key.metadata);
    }
    cursor = page.list_complete ? undefined : (page as { cursor?: string }).cursor;
  } while (cursor);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const dayStart   = startOf('day').getTime();
  const weekStart  = startOf('week').getTime();
  const monthStart = startOf('month').getTime();

  const paid      = metas.filter(m => m.paid && !m.refunded);
  const refunded  = metas.filter(m => m.refunded);
  const delivered = metas.filter(m => m.delivered);

  function byPeriod(list: OrderMeta[], from: number) {
    return list.filter(m => new Date(m.created_at).getTime() >= from);
  }
  function revenue(list: OrderMeta[]) { return list.reduce((s, m) => s + (m.value || 0), 0); }
  function avg(list: OrderMeta[])     { return list.length ? revenue(list) / list.length : 0; }
  function pct(n: number, d: number)  { return d ? Math.round((n / d) * 1000) / 10 : 0; }

  const paidToday  = byPeriod(paid, dayStart);
  const paidWeek   = byPeriod(paid, weekStart);
  const paidMonth  = byPeriod(paid, monthStart);

  // ── Order bump adoption (only on paid orders) ──────────────────────────────
  const bumps = {
    version:    paid.filter(m => m.bumpVersion).length,
    songs:      paid.filter(m => m.bumpSongs).length,
    video:      paid.filter(m => m.bumpVideo).length,
    qrCode:     paid.filter(m => m.bumpQrCode).length,
    backOffer:  paid.filter(m => m.bumpBackOffer).length,
  };

  // ── Provider split ──────────────────────────────────────────────────────────
  const providers: Record<string, number> = {};
  for (const m of paid) {
    const p = m.provider || 'unknown';
    providers[p] = (providers[p] ?? 0) + 1;
  }

  // ── Source split (auto vs manual) ──────────────────────────────────────────
  const autoCount   = paid.filter(m => m.source === 'auto').length;
  const manualCount = paid.length - autoCount;

  // ── Ticket distribution ────────────────────────────────────────────────────
  const values = paid.map(m => m.value || 0).sort((a, b) => a - b);
  const ticketMin = values[0] ?? 0;
  const ticketMax = values[values.length - 1] ?? 0;
  const ticketMed = values[Math.floor(values.length / 2)] ?? 0;

  return json({
    ok: true,
    generated_at: new Date().toISOString(),
    totals: {
      all:       metas.length,
      paid:      paid.length,
      refunded:  refunded.length,
      delivered: delivered.length,
    },
    rates: {
      conversion_pct:  pct(paid.length, metas.length),
      delivery_pct:    pct(delivered.length, paid.length),
      refund_pct:      pct(refunded.length, paid.length),
    },
    revenue: {
      total:        +revenue(paid).toFixed(2),
      today:        +revenue(paidToday).toFixed(2),
      this_week:    +revenue(paidWeek).toFixed(2),
      this_month:   +revenue(paidMonth).toFixed(2),
    },
    ticket: {
      average: +avg(paid).toFixed(2),
      median:  +ticketMed.toFixed(2),
      min:     +ticketMin.toFixed(2),
      max:     +ticketMax.toFixed(2),
    },
    period_count: {
      today:      paidToday.length,
      this_week:  paidWeek.length,
      this_month: paidMonth.length,
    },
    bumps: {
      version:    { count: bumps.version,   pct: pct(bumps.version,   paid.length) },
      songs:      { count: bumps.songs,     pct: pct(bumps.songs,     paid.length) },
      video:      { count: bumps.video,     pct: pct(bumps.video,     paid.length) },
      qr_code:    { count: bumps.qrCode,    pct: pct(bumps.qrCode,    paid.length) },
      back_offer: { count: bumps.backOffer, pct: pct(bumps.backOffer, paid.length) },
    },
    providers,
    source: {
      auto:   autoCount,
      manual: manualCount,
    },
  });
};
