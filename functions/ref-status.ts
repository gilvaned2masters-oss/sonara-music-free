// GET /ref-status?c={codigo}  → estatísticas de indicação do dono (para a página /indique).
import { getOwnerStatus } from './_shared/referral';

interface Env { ORDERS_KV: KVNamespace; }

function json(d: unknown, s = 200): Response {
  return new Response(JSON.stringify(d), {
    status: s,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
  });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const code = (url.searchParams.get('c') || url.searchParams.get('code') || '').replace(/[^a-zA-Z0-9]/g, '');
  const pid = (url.searchParams.get('pid') || '').replace(/[^a-zA-Z0-9_.-]/g, '');

  let key: string | null = code || null;
  // Lookup por paymentId: pega o telefone do pedido (usado como chave do dono)
  if (!key && pid) {
    const raw = await env.ORDERS_KV.get('order:' + pid);
    if (raw) {
      try { key = String((JSON.parse(raw) as Record<string, unknown>)['phone'] ?? '') || null; } catch { /* ignore */ }
    }
  }
  if (!key) return json({ ok: false, error: 'missing_code' }, 400);

  const st = await getOwnerStatus(env.ORDERS_KV, key);
  if (!st) return json({ ok: false, error: 'not_found' }, 404);
  return json({ ok: true, ...st, link: `https://mastersmusic.com.br/?ref=${st.codigo}` });
};
