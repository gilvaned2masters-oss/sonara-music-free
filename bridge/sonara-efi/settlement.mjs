/** Calls Sonara-only Pages scanners. No Efí credential is present here. */
const url = String(process.env.SONARA_SETTLEMENT_URL || '').replace(/\/+$/, '');
const productionUrl = String(process.env.SONARA_PRODUCTION_SCAN_URL || '').replace(/\/+$/, '');
const token = String(process.env.SONARA_SETTLEMENT_TOKEN || '');
if (!url || !productionUrl || !token) throw new Error('SONARA_SETTLEMENT_URL, SONARA_PRODUCTION_SCAN_URL and SONARA_SETTLEMENT_TOKEN are required');

let lastError = null;
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    const headers = { Authorization: `Bearer ${token}` };
    const settlement = await fetch(url, { method: 'POST', headers, signal: AbortSignal.timeout(25_000) });
    if (!settlement.ok) throw new Error(`settlement scanner returned ${settlement.status}`);
    const production = await fetch(productionUrl, { method: 'POST', headers, signal: AbortSignal.timeout(25_000) });
    if (!production.ok) throw new Error(`production scanner returned ${production.status}`);
    const paid = await settlement.json().catch(() => ({}));
    const generating = await production.json().catch(() => ({}));
    console.log('[sonara-efi-settlement] completed', JSON.stringify({ scanned: paid.scanned, confirmed: paid.confirmed, retry: paid.retry, production: generating.refreshed }));
    process.exit(0);
  } catch (error) {
    lastError = error instanceof Error ? error.message : 'unknown';
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 2_000));
  }
}
console.error('[sonara-efi-settlement] failed after retries:', lastError);
process.exit(1);
