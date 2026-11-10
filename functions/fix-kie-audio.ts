// Recupera músicas KIE cuja URL salva (musicfile.kie.ai = stream) expirou para 0 bytes.
// Busca a URL permanente (record-info → sourceAudioUrl), baixa e guarda no R2,
// e repõe mp3_url..mp3_url_4 apontando para /audio/{id} (nosso domínio).
import { kvPutOrder } from './_shared/kv-helpers';
import { versionsCount } from './_shared/generation';
import { storeMp3ToR2, kiePermanentUrls } from './_shared/audio-store';

interface Env {
  ORDERS_KV: KVNamespace;
  AUDIO_BUCKET: R2Bucket;
  KIE_API_KEY: string;
  CRON_SECRET: string;
  ADMIN_PASSWORD: string;
}

function json(d: unknown, s = 200): Response {
  return new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

const MP3_FIELDS = ['mp3_url', 'mp3_url_2', 'mp3_url_3', 'mp3_url_4'];

async function fixOrder(env: Env, paymentId: string, order: Record<string, unknown>): Promise<number> {
  const taskIds = [String(order['kie_task_id'] ?? ''), String(order['kie_task_id_2'] ?? '')].filter(Boolean);
  if (!taskIds.length) return 0;
  const urls: string[] = [];
  for (const t of taskIds) urls.push(...await kiePermanentUrls(t, env.KIE_API_KEY));
  if (!urls.length) return 0;

  const versions = versionsCount(order);
  let fixed = 0;
  for (let i = 0; i < Math.min(urls.length, versions); i++) {
    const key = 'audio/' + paymentId + '-v' + (i + 1) + '.mp3';
    if (await storeMp3ToR2(env.AUDIO_BUCKET, key, urls[i])) {
      order[MP3_FIELDS[i]] = '/' + key; // servido por functions/audio/[id].ts
      fixed++;
    }
  }
  if (fixed) {
    order['audioUrl'] = String(order['mp3_url'] ?? '');
    order['streamAudioUrl'] = String(order['mp3_url'] ?? '');
    order['treblo_status'] = 'success';
    order['prodStatus'] = 'pronto';
    order['updated_at'] = new Date().toISOString();
    await kvPutOrder(env.ORDERS_KV, paymentId, order);
  }
  return fixed;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const secret = url.searchParams.get('secret') ?? '';
  const valid = (!!env.CRON_SECRET && secret === env.CRON_SECRET) || (!!env.ADMIN_PASSWORD && secret === env.ADMIN_PASSWORD);
  if (!valid) return json({ ok: false, error: 'unauthorized' }, 401);

  // Modo 1: um pedido específico
  const pid = (url.searchParams.get('paymentId') ?? '').replace(/[^a-zA-Z0-9_.-]/g, '');
  if (pid) {
    const raw = await env.ORDERS_KV.get('order:' + pid);
    if (!raw) return json({ ok: false, error: 'not_found' }, 404);
    const order = JSON.parse(raw) as Record<string, unknown>;
    const fixed = await fixOrder(env, pid, order);
    return json({ ok: true, paymentId: pid, fixed, mp3_url: order['mp3_url'] });
  }

  // Modo 2: scan dos pagos recentes via KIE (limite p/ não estourar tempo)
  const hours = Math.min(Number(url.searchParams.get('hours') ?? 24), 72);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 15), 40);
  const cutoff = Date.now() - hours * 3600 * 1000;
  const out: Array<{ id: string; fixed: number }> = [];
  let cursor: string | undefined;
  let processed = 0;
  do {
    const list = await env.ORDERS_KV.list({ prefix: 'order:', cursor, limit: 1000 });
    cursor = list.list_complete ? undefined : ((list as { cursor?: string }).cursor);
    for (const k of list.keys) {
      if (processed >= limit) { cursor = undefined; break; }
      const m = (k.metadata ?? {}) as Record<string, unknown>;
      if (!m['paid']) continue;
      const ca = new Date(String(m['created_at'] ?? 0)).getTime();
      if (isNaN(ca) || ca < cutoff) continue;
      const raw = await env.ORDERS_KV.get(k.name);
      if (!raw) continue;
      const order = JSON.parse(raw) as Record<string, unknown>;
      // só os com KIE e cuja URL ainda aponta pro stream que expira
      const mp3 = String(order['mp3_url'] ?? '');
      if (!order['kie_task_id'] || !mp3.includes('musicfile.kie.ai')) continue;
      const fixed = await fixOrder(env, k.name.replace(/^order:/, ''), order);
      out.push({ id: k.name.replace(/^order:/, ''), fixed });
      processed++;
    }
  } while (cursor);

  return json({ ok: true, processed, results: out });
};
