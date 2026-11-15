import { createEfiPix, newSonaraTxid, type EfiBridgeEnv } from './_shared/efi-bridge';
import { kvPutOrder } from './_shared/kv-helpers';

interface Env extends EfiBridgeEnv { ORDERS_KV: KVNamespace; ADMIN_PASSWORD: string; }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
function allowed(request: Request, env: Env) { try { return atob((request.headers.get('Authorization') ?? '').replace(/^Basic\s+/i, '')).split(':')[1] === env.ADMIN_PASSWORD; } catch { return false; } }

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (!allowed(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);
  const paymentId = new URL(request.url).searchParams.get('paymentId')?.replace(/[^A-Za-z0-9_.-]/g, '') ?? '';
  if (!paymentId) return json({ ok: false, error: 'missing_payment_id' }, 400);
  const raw = await env.ORDERS_KV.get('order:' + paymentId);
  if (!raw) return json({ ok: false, error: 'order_not_found' }, 404);
  const order = JSON.parse(raw) as Record<string, unknown>;
  if (order.paid) return json({ ok: false, error: 'already_paid' }, 400);
  const charge = await createEfiPix(env, { txid: newSonaraTxid('smr'), value: Number(order.value ?? 0), expiration: 1800, reference: String(order.externalReference ?? paymentId), description: 'Sonara Music — recuperação de pedido' });
  if (!charge.ok || !charge.data) return json({ ok: false, error: 'efi_unavailable' }, 502);
  order.recoveryPaymentId = charge.data.txid; order.txid = charge.data.txid; order.provider = 'efi'; order.status = 'ATIVA'; order.updated_at = new Date().toISOString();
  await kvPutOrder(env.ORDERS_KV, paymentId, order);
  return json({ ok: true, reused: false, payload: charge.data.payload, encodedImage: charge.data.encodedImage, newPaymentId: charge.data.txid, name: order.name, phone: order.phone, value: order.value });
};
