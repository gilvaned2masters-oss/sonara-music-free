/**
 * Sonara Efí bridge — deploy separately from Nail.
 * It has no webhook route: Pages confirms payment by an authenticated Efí status query.
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const required = ['EFI_CLIENT_ID', 'EFI_CLIENT_SECRET', 'EFI_PIX_KEY', 'EFI_P12_PATH', 'EFI_BRIDGE_TOKEN'];
for (const key of required) if (!process.env[key]) throw new Error(`Missing ${key}`);
const port = Number(process.env.PORT || 8081);
const dbPath = process.env.SONARA_EFI_DB || '/var/lib/sonara-efi/idempotency.sqlite';
fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(dbPath);
db.exec("CREATE TABLE IF NOT EXISTS activations (txid TEXT PRIMARY KEY, state TEXT NOT NULL, leased_at INTEGER NOT NULL, completed_at INTEGER)");

let oauth = { token: '', until: 0 };
const apiHost = process.env.EFI_API_HOST || 'pix.api.efipay.com.br';
const agent = new https.Agent({ pfx: fs.readFileSync(process.env.EFI_P12_PATH), passphrase: process.env.EFI_P12_PASSPHRASE || undefined, minVersion: 'TLSv1.2', keepAlive: true });
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const isSonaraTxid = (txid) => /^sm[a-zA-Z0-9]{1,33}$/.test(txid);

function requestEfi(method, pathname, body, token = '') {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = https.request({ hostname: apiHost, path: pathname, method, agent, headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : { Authorization: `Basic ${Buffer.from(`${process.env.EFI_CLIENT_ID}:${process.env.EFI_CLIENT_SECRET}`).toString('base64')}` }),
      'content-type': 'application/json', ...(data ? { 'content-length': Buffer.byteLength(data) } : {}),
    } }, (response) => {
      let raw = ''; response.setEncoding('utf8'); response.on('data', c => { raw += c; }); response.on('end', () => {
        let parsed = {}; try { parsed = raw ? JSON.parse(raw) : {}; } catch { /* malformed upstream */ }
        resolve({ ok: (response.statusCode || 500) >= 200 && (response.statusCode || 500) < 300, status: response.statusCode || 502, data: parsed });
      });
    });
    req.setTimeout(12_000, () => req.destroy(new Error('EFI timeout'))); req.on('error', reject); if (data) req.write(data); req.end();
  });
}
async function token() {
  if (oauth.token && Date.now() < oauth.until) return oauth.token;
  const result = await requestEfi('POST', '/oauth/token', { grant_type: 'client_credentials' });
  const next = String(result.data.access_token || '');
  if (!result.ok || !next) throw new Error(`EFI OAuth failed (${result.status})`);
  oauth = { token: next, until: Date.now() + Math.max(60, Number(result.data.expires_in || 300) - 60) * 1000 }; return next;
}
async function efi(method, pathname, body) { return requestEfi(method, pathname, body, await token()); }
function readBody(req) { return new Promise((resolve, reject) => { let raw = ''; req.setEncoding('utf8'); req.on('data', c => { raw += c; if (raw.length > 20_000) req.destroy(); }); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('invalid_json')); } }); req.on('error', reject); }); }
function authenticated(req) { return req.headers.authorization === `Bearer ${process.env.EFI_BRIDGE_TOKEN}`; }
function claim(txid) {
  const now = Date.now(), current = db.prepare('SELECT state, leased_at FROM activations WHERE txid = ?').get(txid);
  if (current?.state === 'completed') return 'completed';
  if (current?.state === 'processing' && now - Number(current.leased_at) < 600_000) return 'busy';
  db.prepare("INSERT INTO activations (txid, state, leased_at) VALUES (?, 'processing', ?) ON CONFLICT(txid) DO UPDATE SET state = 'processing', leased_at = excluded.leased_at").run(txid, now);
  return 'acquired';
}

const server = http.createServer(async (req, res) => {
  if (!authenticated(req)) return json(res, 401, { ok: false });
  const url = new URL(req.url || '/', 'http://bridge.local');
  try {
    if (req.method === 'POST' && url.pathname === '/v1/pix') {
      const body = await readBody(req), txid = String(body.txid || ''), value = Number(body.value || 0);
      if (!isSonaraTxid(txid) || !Number.isFinite(value) || value < 0.01 || value > 10000) return json(res, 422, { ok: false, error: 'invalid_charge' });
      const cob = await efi('PUT', `/v2/cob/${encodeURIComponent(txid)}`, { calendario: { expiracao: Math.min(Math.max(Number(body.expiration || 1800), 60), 86400) }, valor: { original: value.toFixed(2) }, chave: process.env.EFI_PIX_KEY, solicitacaoPagador: String(body.description || 'Sonara Music').slice(0, 140), infoAdicionais: [{ nome: 'Pedido', valor: String(body.reference || '').slice(0, 140) }] });
      const locationId = String(cob.data?.loc?.id || ''); if (!cob.ok || !locationId) return json(res, 502, { ok: false, error: 'efi_charge_failed' });
      const qr = await efi('GET', `/v2/loc/${encodeURIComponent(locationId)}/qrcode`), payload = String(qr.data?.qrcode || '');
      if (!qr.ok || !payload) return json(res, 502, { ok: false, error: 'efi_qr_failed' });
      return json(res, 200, { ok: true, txid, payload, encodedImage: String(qr.data?.imagemQrcode || '').replace(/^data:image\/\w+;base64,/, ''), expiresAt: String(cob.data?.calendario?.criacao || '') || null });
    }
    const statusMatch = url.pathname.match(/^\/v1\/pix\/([A-Za-z0-9]+)$/);
    if (req.method === 'GET' && statusMatch) {
      const txid = statusMatch[1]; if (!isSonaraTxid(txid)) return json(res, 404, { ok: false });
      const cob = await efi('GET', `/v2/cob/${encodeURIComponent(txid)}`); if (!cob.ok) return json(res, 502, { ok: false, error: 'efi_status_failed' });
      const status = String(cob.data?.status || 'ATIVA'); return json(res, 200, { ok: true, txid, status, paid: status === 'CONCLUIDA', paidAt: String(cob.data?.pix?.[0]?.horario || '') || null });
    }
    const activationMatch = url.pathname.match(/^\/v1\/activation\/([A-Za-z0-9]+)\/(claim|complete)$/);
    if (req.method === 'POST' && activationMatch) {
      const [, txid, action] = activationMatch; if (!isSonaraTxid(txid)) return json(res, 404, { ok: false });
      if (action === 'claim') return json(res, 200, { ok: true, claim: claim(txid) });
      db.prepare("UPDATE activations SET state = 'completed', completed_at = ? WHERE txid = ?").run(Date.now(), txid); return json(res, 200, { ok: true });
    }
    return json(res, 404, { ok: false });
  } catch (error) { console.error('[sonara-efi] request failed', error instanceof Error ? error.message : 'unknown'); return json(res, 502, { ok: false, error: 'upstream_unavailable' }); }
});
server.listen(port, '127.0.0.1', () => console.log(`[sonara-efi] listening on 127.0.0.1:${port}`));
