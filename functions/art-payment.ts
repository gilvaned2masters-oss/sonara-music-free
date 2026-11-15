import { createEfiPix, getEfiPixStatus, newSonaraTxid, type EfiBridgeEnv } from './_shared/efi-bridge';
import { kvPutOrder } from './_shared/kv-helpers';
import { getPricing } from './_shared/pricing';

interface Env extends EfiBridgeEnv { ORDERS_KV: KVNamespace; }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

/** Extra artwork is a new Efí Pix tied to the original Sonara order, never Asaas. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let input: Record<string, unknown>;
  try { input = await request.json() as Record<string, unknown>; } catch { return json({ ok: false, error: 'invalid_json' }, 400); }
  const orderId = String(input.orderId ?? '').replace(/[^A-Za-z0-9_.-]/g, '');
  if (!orderId) return json({ ok: false, error: 'missing_order_id' }, 400);
  const raw = await env.ORDERS_KV.get('order:' + orderId);
  if (!raw) return json({ ok: false, error: 'order_not_found' }, 404);
  const order = JSON.parse(raw) as Record<string, unknown>;
  if (!order.paid) return json({ ok: false, error: 'order_not_paid' }, 422);
  if (order.artPaid) return json({ ok: true, alreadyPaid: true });

  const existingTxid = String(order.artTxid ?? '');
  if (existingTxid) {
    const existing = await getEfiPixStatus(env, existingTxid);
    if (existing.ok && existing.data?.paid) {
      order.artPaid = true; order.updated_at = new Date().toISOString(); await kvPutOrder(env.ORDERS_KV, orderId, order);
      return json({ ok: true, alreadyPaid: true });
    }
  }

  const artPrice = (await getPricing(env.ORDERS_KV)).art;
  const charge = await createEfiPix(env, { txid: newSonaraTxid('sma'), value: artPrice, expiration: 1800, reference: `art-${orderId}`, description: 'Sonara Music — arte personalizada' });
  if (!charge.ok || !charge.data) return json({ ok: false, error: 'payment_failed' }, 502);
  order.artPaymentId = charge.data.txid; order.artTxid = charge.data.txid; order.artProvider = 'efi'; order.artValue = artPrice; order.updated_at = new Date().toISOString();
  await kvPutOrder(env.ORDERS_KV, orderId, order);
  return json({ ok: true, paymentId: charge.data.txid, encodedImage: charge.data.encodedImage, payload: charge.data.payload, expirationDate: charge.data.expiresAt });
};
