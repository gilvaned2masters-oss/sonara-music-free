/**
 * Cliente da ponte Efí exclusiva da Sonara.
 * O Pages nunca recebe certificado mTLS ou credenciais Efí.
 */
export interface EfiBridgeEnv {
  EFI_BRIDGE_URL: string;
  EFI_BRIDGE_TOKEN: string;
}

export type PixCharge = { txid: string; payload: string; encodedImage: string; expiresAt: string | null };
export type PixStatus = { txid: string; status: string; paid: boolean; paidAt: string | null };
type BridgeResult<T> = { ok: boolean; status: number; data: T | null };

function baseUrl(env: EfiBridgeEnv): string { return String(env.EFI_BRIDGE_URL || '').replace(/\/+$/, ''); }

async function bridge<T>(env: EfiBridgeEnv, method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<BridgeResult<T>> {
  const base = baseUrl(env);
  if (!base || !env.EFI_BRIDGE_TOKEN) return { ok: false, status: 503, data: null };
  try {
    const response = await fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${env.EFI_BRIDGE_TOKEN}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
    let data: T | null = null;
    try { data = await response.json() as T; } catch { /* resposta inválida não vaza ao cliente */ }
    return { ok: response.ok, status: response.status, data };
  } catch { return { ok: false, status: 503, data: null }; }
}

export function newSonaraTxid(kind = 'sm'): string {
  // API Pix aceita TXIDs alfanuméricos de até 35 caracteres. O prefixo separa Sonara de outras ofertas.
  return `${kind}${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g, '')}`.slice(0, 35);
}

export async function createEfiPix(env: EfiBridgeEnv, input: { txid: string; value: number; expiration: number; description: string; reference: string; cpf?: string; name?: string }): Promise<BridgeResult<PixCharge>> {
  return bridge<PixCharge>(env, 'POST', '/v1/pix', input);
}
export async function getEfiPixStatus(env: EfiBridgeEnv, txid: string): Promise<BridgeResult<PixStatus>> {
  return bridge<PixStatus>(env, 'GET', `/v1/pix/${encodeURIComponent(txid)}`);
}
export async function claimPaymentActivation(env: EfiBridgeEnv, txid: string): Promise<BridgeResult<{ claim: 'acquired' | 'completed' | 'busy' }>> {
  return bridge(env, 'POST', `/v1/activation/${encodeURIComponent(txid)}/claim`);
}
export async function completePaymentActivation(env: EfiBridgeEnv, txid: string): Promise<void> {
  await bridge(env, 'POST', `/v1/activation/${encodeURIComponent(txid)}/complete`);
}
