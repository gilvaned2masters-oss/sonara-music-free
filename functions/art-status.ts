import { getEfiPixStatus, type EfiBridgeEnv } from './_shared/efi-bridge';
import { kvPutOrder } from './_shared/kv-helpers';

interface Env extends EfiBridgeEnv { ORDERS_KV: KVNamespace; }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const orderId = (new URL(request.url).searchParams.get('orderId') ?? '').replace(/[^A-Za-z0-9_.-]/g, '');
  if (!orderId) return json({ ok: false, error: 'missing_order_id' }, 400);
  const raw = await env.ORDERS_KV.get('order:' + orderId);
  if (!raw) return json({ ok: false, error: 'order_not_found' }, 404);
  const order = JSON.parse(raw) as Record<string, unknown>;
  if (order.artPaid) return json({ ok: true, paid: true, status: 'CONCLUIDA' });
  const txid = String(order.artTxid ?? '');
  if (!txid) return json({ ok: true, paid: false, status: 'NO_PAYMENT' });
  const result = await getEfiPixStatus(env, txid);
  if (!result.ok || !result.data) return json({ ok: true, paid: false, status: 'UNKNOWN' });
  if (result.data.paid && result.data.status === 'CONCLUIDA') {
    order.artPaid = true; order.updated_at = new Date().toISOString(); await kvPutOrder(env.ORDERS_KV, orderId, order);
  }
  return json({ ok: true, paid: result.data.paid, status: result.data.status });
};
