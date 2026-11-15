/**
 * Sonara-only Efí gateway and scheduler.
 *
 * The Worker presents the account mTLS client certificate through EFI_MTLS;
 * Pages never receives a certificate, private key, OAuth credential or Pix key.
 * It has no webhook endpoint and no dependency on any Nail component.
 */
export interface Env {
  EFI_MTLS: Fetcher;
  SONARA_ACTIVATIONS: DurableObjectNamespace;
  EFI_CLIENT_ID: string;
  EFI_CLIENT_SECRET: string;
  EFI_PIX_KEY: string;
  SONARA_EFI_GATEWAY_TOKEN: string;
  SONARA_SETTLEMENT_TOKEN: string;
  SONARA_PAGES_ORIGIN: string;
  EFI_API_ORIGIN?: string;
}

type OAuthCache = { token: string; until: number };
type StoredActivation = { state: 'processing' | 'completed'; leasedAt: number; completedAt?: number };
let oauth: OAuthCache = { token: '', until: 0 };

const MAX_BODY = 20_000;
const LEASE_MS = 10 * 60_000;

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function equalSecret(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left), b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  const size = Math.max(a.length, b.length);
  for (let i = 0; i < size; i++) difference |= (a[i % (a.length || 1)] ?? 0) ^ (b[i % (b.length || 1)] ?? 0);
  return difference === 0 && a.length > 0;
}

function authenticated(request: Request, env: Env): boolean {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  return equalSecret(token, env.SONARA_EFI_GATEWAY_TOKEN || '');
}

function validTxid(value: unknown): boolean {
  return /^sm[A-Za-z0-9]{1,33}$/.test(String(value ?? ''));
}

function apiOrigin(env: Env): string {
  return String(env.EFI_API_ORIGIN || 'https://pix.api.efipay.com.br').replace(/\/+$/, '');
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (Number.isFinite(length) && length > MAX_BODY) return null;
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body as Record<string, unknown> : null;
  } catch { return null; }
}

async function efiRaw(env: Env, path: string, init: RequestInit): Promise<Response> {
  // `EFI_MTLS.fetch` attaches only the client certificate configured as a
  // Cloudflare binding. pix.api.efipay.com.br is not a proxied customer zone.
  return env.EFI_MTLS.fetch(apiOrigin(env) + path, init);
}

async function efiToken(env: Env): Promise<string> {
  if (oauth.token && Date.now() < oauth.until) return oauth.token;
  const basic = btoa(`${env.EFI_CLIENT_ID}:${env.EFI_CLIENT_SECRET}`);
  const response = await efiRaw(env, '/oauth/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials' }),
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  const token = String(data['access_token'] ?? '');
  if (!response.ok || !token) throw new Error('oauth_failed');
  const expires = Math.max(60, Number(data['expires_in'] ?? 300) - 60);
  oauth = { token, until: Date.now() + expires * 1000 };
  return token;
}

async function efi(env: Env, path: string, init: RequestInit = {}): Promise<{ response: Response; data: Record<string, unknown> }> {
  const token = await efiToken(env);
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Content-Type', 'application/json');
  const response = await efiRaw(env, path, { ...init, headers });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { response, data };
}

async function createPix(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const txid = String(body?.['txid'] ?? '');
  const value = Number(body?.['value'] ?? 0);
  if (!body || !validTxid(txid) || !Number.isFinite(value) || value < 0.01 || value > 10_000) {
    return json({ ok: false, error: 'invalid_charge' }, 422);
  }
  const expiration = Math.min(Math.max(Number(body['expiration'] ?? 1800), 60), 86400);
  const reference = String(body['reference'] ?? '').slice(0, 140);
  const description = String(body['description'] ?? 'Sonara Music').slice(0, 140);
  const cob = await efi(env, `/v2/cob/${encodeURIComponent(txid)}`, {
    method: 'PUT',
    body: JSON.stringify({
      calendario: { expiracao: expiration }, valor: { original: value.toFixed(2) }, chave: env.EFI_PIX_KEY,
      solicitacaoPagador: description, infoAdicionais: [{ nome: 'Pedido', valor: reference }],
    }),
  });
  const locationId = String((cob.data['loc'] as Record<string, unknown> | undefined)?.['id'] ?? '');
  if (!cob.response.ok || !locationId) return json({ ok: false, error: 'efi_charge_failed' }, 502);
  const qr = await efi(env, `/v2/loc/${encodeURIComponent(locationId)}/qrcode`);
  const payload = String(qr.data['qrcode'] ?? '');
  if (!qr.response.ok || !payload) return json({ ok: false, error: 'efi_qr_failed' }, 502);
  const calendar = cob.data['calendario'] as Record<string, unknown> | undefined;
  return json({ ok: true, txid, payload, encodedImage: String(qr.data['imagemQrcode'] ?? '').replace(/^data:image\/\w+;base64,/, ''), expiresAt: String(calendar?.['criacao'] ?? '') || null });
}

async function pixStatus(txid: string, env: Env): Promise<Response> {
  if (!validTxid(txid)) return json({ ok: false }, 404);
  const cob = await efi(env, `/v2/cob/${encodeURIComponent(txid)}`);
  if (!cob.response.ok) return json({ ok: false, error: 'efi_status_failed' }, 502);
  const status = String(cob.data['status'] ?? 'ATIVA');
  const pix = Array.isArray(cob.data['pix']) ? cob.data['pix'][0] as Record<string, unknown> : {};
  const value = Number((cob.data['valor'] as Record<string, unknown> | undefined)?.['original']);
  return json({ ok: true, txid, status, paid: status === 'CONCLUIDA', paidAt: String(pix?.['horario'] ?? '') || null, value: Number.isFinite(value) ? value : null });
}

export class SonaraActivationLock implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const action = new URL(request.url).pathname.replace(/^\//, '');
    const current = await this.state.storage.get<StoredActivation>('activation');
    const now = Date.now();
    if (action === 'claim') {
      if (current?.state === 'completed') return json({ ok: true, claim: 'completed' });
      if (current?.state === 'processing' && now - current.leasedAt < LEASE_MS) return json({ ok: true, claim: 'busy' });
      await this.state.storage.put('activation', { state: 'processing', leasedAt: now } satisfies StoredActivation);
      return json({ ok: true, claim: 'acquired' });
    }
    if (action === 'complete') {
      await this.state.storage.put('activation', { state: 'completed', leasedAt: current?.leasedAt ?? now, completedAt: now } satisfies StoredActivation);
      return json({ ok: true });
    }
    return json({ ok: false }, 404);
  }
}

async function activation(request: Request, env: Env, txid: string, action: 'claim' | 'complete'): Promise<Response> {
  if (!validTxid(txid) || request.method !== 'POST') return json({ ok: false }, 404);
  const id = env.SONARA_ACTIVATIONS.idFromName(txid);
  return env.SONARA_ACTIVATIONS.get(id).fetch(`https://activation.internal/${action}`, { method: 'POST' });
}

async function runScans(env: Env): Promise<void> {
  const origin = String(env.SONARA_PAGES_ORIGIN || '').replace(/\/+$/, '');
  if (!origin || !env.SONARA_SETTLEMENT_TOKEN) throw new Error('scheduler_not_configured');
  const headers = { Authorization: `Bearer ${env.SONARA_SETTLEMENT_TOKEN}` };
  for (const path of ['/efi-settlement-scan', '/production-scan']) {
    let completed = false;
    for (let attempt = 0; attempt < 2 && !completed; attempt++) {
      try {
        const response = await fetch(origin + path, { method: 'POST', headers });
        if (!response.ok) throw new Error(`status_${response.status}`);
        const summary = await response.json().catch(() => ({})) as Record<string, unknown>;
        console.log('[sonara-efi-cron]', path, JSON.stringify({ scanned: summary['scanned'], confirmed: summary['confirmed'], refreshed: summary['refreshed'], retry: summary['retry'] }));
        completed = true;
      } catch (error) {
        if (attempt === 1) console.error('[sonara-efi-cron] scanner failed', path, error instanceof Error ? error.message : 'unknown');
      }
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!authenticated(request, env)) return json({ ok: false }, 401);
    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/v1/pix') return createPix(request, env);
      const pix = url.pathname.match(/^\/v1\/pix\/([A-Za-z0-9]+)$/);
      if (request.method === 'GET' && pix) return pixStatus(pix[1], env);
      const lock = url.pathname.match(/^\/v1\/activation\/([A-Za-z0-9]+)\/(claim|complete)$/);
      if (lock) return activation(request, env, lock[1], lock[2] as 'claim' | 'complete');
      return json({ ok: false }, 404);
    } catch (error) {
      console.error('[sonara-efi] request failed', error instanceof Error ? error.message : 'unknown');
      return json({ ok: false, error: 'upstream_unavailable' }, 502);
    }
  },
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScans(env));
  },
} satisfies ExportedHandler<Env>;
