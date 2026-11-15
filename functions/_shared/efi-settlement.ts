import { claimPaymentActivation, completePaymentActivation, getEfiPixStatus, type EfiBridgeEnv } from './efi-bridge';
import { isSonaraTxid, settlementDecision } from './efi-settlement-core';
import { activatePaidOrder, type PaymentActivationEnv } from './payment-activation';
import { kvPutOrder } from './kv-helpers';

export interface EfiSettlementEnv extends EfiBridgeEnv, PaymentActivationEnv {}
export type SettlementResult = 'confirmed' | 'pending' | 'processing' | 'mismatch' | 'retry';

/**
 * Shared by browser polling and the scheduled settlement scanner. The caller
 * never supplies a paid flag; the Efí bridge is queried for every settlement.
 */
export async function settleEfiOrder(
  env: EfiSettlementEnv, paymentId: string, order: Record<string, unknown>, origin: string,
): Promise<SettlementResult> {
  if (order['paid'] === true) return 'confirmed';
  if (order['efiRetryExhausted'] === true) return 'retry';
  const txid = String(order['txid'] ?? paymentId);
  if (!isSonaraTxid(txid)) {
    order['efiValidationError'] = 'invalid_txid';
    order['updated_at'] = new Date().toISOString();
    await kvPutOrder(env.ORDERS_KV, paymentId, order);
    console.error('[sonara][settlement] invalid txid', paymentId);
    return 'mismatch';
  }

  const remote = await getEfiPixStatus(env, txid);
  if (!remote.ok || !remote.data) {
    const attempts = Math.min(Number(order['efiRetryCount'] ?? 0) + 1, 8);
    order['efiRetryCount'] = attempts;
    if (attempts >= 8) order['efiRetryExhausted'] = true;
    order['efiNextRetryAt'] = new Date(Date.now() + Math.min(2 ** attempts * 60_000, 15 * 60_000)).toISOString();
    order['updated_at'] = new Date().toISOString();
    await kvPutOrder(env.ORDERS_KV, paymentId, order);
    console.warn('[sonara][settlement] Efí query unavailable', paymentId, 'attempt', attempts, attempts >= 8 ? 'exhausted' : '');
    return 'retry';
  }

  const decision = settlementDecision(order, remote.data);
  if (decision === 'pending') return 'pending';
  if (decision !== 'confirmed') {
    order['efiValidationError'] = 'txid_or_value_mismatch';
    order['updated_at'] = new Date().toISOString();
    await kvPutOrder(env.ORDERS_KV, paymentId, order);
    console.error('[sonara][settlement] rejected settlement', paymentId);
    return 'mismatch';
  }

  const claim = await claimPaymentActivation(env, txid);
  if (!claim.ok) return 'retry';
  if (claim.data?.claim === 'busy') return 'processing';
  if (claim.data?.claim === 'completed') return 'confirmed';
  if (claim.data?.claim !== 'acquired') return 'retry';

  order['status'] = remote.data.status;
  order['efiPaidAt'] = remote.data.paidAt;
  order['efiRetryCount'] = 0;
  order['efiNextRetryAt'] = '';
  await activatePaidOrder(env, paymentId, order, origin);
  await completePaymentActivation(env, txid);
  return 'confirmed';
}
