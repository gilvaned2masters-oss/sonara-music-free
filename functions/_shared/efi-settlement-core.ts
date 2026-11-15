export type EfiChargeSnapshot = { txid: string; status: string; paid: boolean; value: number | null };

export function isSonaraTxid(value: unknown): boolean {
  return /^sm[A-Za-z0-9]{1,33}$/.test(String(value ?? ''));
}

export function sameCents(left: unknown, right: unknown): boolean {
  const a = Number(left), b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.round(a * 100) === Math.round(b * 100);
}

/** The only condition that may unlock a Sonara order. */
export function isApprovedEfiSettlement(order: Record<string, unknown>, charge: EfiChargeSnapshot): boolean {
  const txid = String(order['txid'] ?? order['paymentId'] ?? '');
  return order['provider'] === 'efi'
    && order['paid'] !== true
    && isSonaraTxid(txid)
    && charge.txid === txid
    && charge.status === 'CONCLUIDA'
    && charge.paid === true
    && sameCents(order['value'], charge.value);
}

export function settlementDecision(
  order: Record<string, unknown>, charge: EfiChargeSnapshot | null,
): 'confirmed' | 'pending' | 'mismatch' | 'retry' | 'duplicate' {
  if (order['paid'] === true) return 'duplicate';
  if (!charge) return 'retry';
  if (charge.status !== 'CONCLUIDA') return 'pending';
  return isApprovedEfiSettlement(order, charge) ? 'confirmed' : 'mismatch';
}
