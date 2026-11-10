interface Env {
  ORDERS_KV: KVNamespace;
  AUDIO_BUCKET: R2Bucket;
  ADMIN_PASSWORD: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function checkAuth(request: Request, env: Env): boolean {
  const auth = request.headers.get('Authorization') ?? '';
  const b64 = auth.replace(/^Basic\s+/i, '');
  if (!b64) return false;
  try {
    const [, pass] = atob(b64).split(':');
    return pass === (env.ADMIN_PASSWORD || '');
  } catch { return false; }
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkAuth(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const form = await request.formData();
  const paymentId = String(form.get('paymentId') || '').replace(/[^a-zA-Z0-9_.-]/g, '');
  const file = form.get('file') as File | null;

  if (!paymentId) return json({ ok: false, error: 'missing_payment_id' }, 400);
  if (!file) return json({ ok: false, error: 'missing_file' }, 400);

  const allowed = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/x-m4a', 'audio/aac'];
  if (!allowed.includes(file.type) && !file.name.match(/\.(mp3|wav|ogg|m4a|aac)$/i)) {
    return json({ ok: false, error: 'invalid_file_type' }, 400);
  }
  if (file.size > 30 * 1024 * 1024) return json({ ok: false, error: 'file_too_large_30mb' }, 400);

  const ext = file.name.split('.').pop()?.toLowerCase() || 'mp3';
  const key = `audio/${paymentId}.${ext}`;

  try {
    await env.AUDIO_BUCKET.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || 'audio/mpeg' },
    });
  } catch (e) {
    console.error('[upload-audio] R2 put failed:', String(e));
    return json({ ok: false, error: 'r2_failed', detail: String(e) }, 500);
  }

  // Salvar URL no KV
  const musicLink = `/audio/${paymentId}.${ext}`;
  try {
    const raw = await env.ORDERS_KV.get('order:' + paymentId);
    if (raw) {
      const order = JSON.parse(raw) as Record<string, unknown>;
      order['musicLink'] = musicLink;
      order['updated_at'] = new Date().toISOString();
      await env.ORDERS_KV.put('order:' + paymentId, JSON.stringify(order), { expirationTtl: 86400 * 365 });
    }
  } catch (e) {
    console.error('[upload-audio] KV update failed:', String(e));
  }

  return json({ ok: true, url: musicLink });
};
