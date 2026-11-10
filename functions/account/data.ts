// GET /account/data?token=  → pedidos do cliente + indicação + suporte.
import { verifySession, normEmail } from '../_shared/account';
import { getOwnerStatus, getOrCreateOwnerCode } from '../_shared/referral';

interface Env { ORDERS_KV: KVNamespace; }

function json(d: unknown, s = 200): Response {
  return new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function nextCursor(list: { list_complete: boolean }): string | undefined {
  return list.list_complete ? undefined : (list as unknown as { cursor?: string }).cursor;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const email = await verifySession(env.ORDERS_KV, token);
  if (!email) return json({ ok: false, error: 'unauthorized' }, 401);

  // Acha os pedidos do cliente pela metadata (email) — sem GET por pedido nessa etapa.
  const matches: Array<{ key: string; meta: Record<string, unknown> }> = [];
  let cursor: string | undefined;
  do {
    const list = await env.ORDERS_KV.list<Record<string, unknown>>({ prefix: 'order:', cursor, limit: 1000 });
    cursor = nextCursor(list);
    for (const k of list.keys) {
      const m = (k.metadata ?? {}) as Record<string, unknown>;
      if (normEmail(m['email']) === email) matches.push({ key: k.name, meta: m });
    }
  } while (cursor);

  matches.sort((a, b) => String(b.meta['created_at'] ?? '').localeCompare(String(a.meta['created_at'] ?? '')));

  // Detalha os pedidos (limite p/ não pesar)
  const orders: Array<Record<string, unknown>> = [];
  let phone = '';
  let name = '';
  let hasPaid = false;
  for (const m of matches.slice(0, 25)) {
    const raw = await env.ORDERS_KV.get(m.key);
    if (!raw) continue;
    let o: Record<string, unknown>;
    try { o = JSON.parse(raw) as Record<string, unknown>; } catch { continue; }
    if (!phone && o['phone']) phone = String(o['phone']);
    if (!name && o['name']) name = String(o['name']);
    if (o['paid']) hasPaid = true;
    const pid = String(o['paymentId'] ?? m.key.replace(/^order:/, ''));
    const ready = o['treblo_status'] === 'success' && !!o['mp3_url'];
    orders.push({
      paymentId: pid,
      created_at: o['created_at'] ?? '',
      title: o['lyricsTitle'] ?? '',
      estilo: o['estilo'] ?? '',
      destinatario: o['destinatario'] ?? '',
      paid: !!o['paid'],
      ready,
      prodStatus: o['prodStatus'] ?? '',
      delivered: !!o['delivered'],
      value: Number(o['value'] ?? 0),
      prontoLink: ready ? `https://mastersmusic.com.br/pronto?id=${pid}` : '',
    });
  }

  // Indicação (pelo telefone do cliente). Se já comprou e ainda não tem código, cria na hora
  // (clientes que compraram antes do programa de indicação existir).
  let referral: Record<string, unknown> | null = null;
  if (phone) {
    let st = await getOwnerStatus(env.ORDERS_KV, phone);
    if (!st && hasPaid) {
      await getOrCreateOwnerCode(env.ORDERS_KV, phone, email, name);
      st = await getOwnerStatus(env.ORDERS_KV, phone);
    }
    if (st) referral = { ...st, link: `https://mastersmusic.com.br/?ref=${st.codigo}` };
  }

  return json({ ok: true, email, orders, referral, supportWhatsapp: '554188869695' });
};
