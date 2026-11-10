interface Env {
  ORDERS_KV: KVNamespace;
  KIE_API_KEY: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const orderId = (url.searchParams.get('orderId') ?? '').replace(/[^a-zA-Z0-9_.-]/g, '');
  if (!orderId) return json({ status: 'error', error: 'missing_order_id' }, 400);

  // 1. Buscar order no KV
  const raw = env.ORDERS_KV ? await env.ORDERS_KV.get('order:' + orderId) : null;
  if (!raw) return json({ status: 'error', error: 'order_not_found' }, 404);

  const order = JSON.parse(raw) as Record<string, unknown>;

  // 2. Se já tiver audioUrl, retornar imediatamente
  if (order['audioUrl']) {
    return json({
      status: 'ready',
      audioUrl:       String(order['audioUrl']),
      streamAudioUrl: String(order['streamAudioUrl'] ?? order['audioUrl']),
      duration:       order['duration'] ?? null,
    });
  }

  // 3. Se não tiver taskId, não há geração em andamento
  const taskId = String(order['generationTaskId'] ?? '').trim();
  if (!taskId) {
    return json({ status: String(order['generationStatus'] ?? 'pending') });
  }

  if (!env.KIE_API_KEY) return json({ status: 'error', error: 'missing_kie_api_key' }, 500);

  // 4. Consultar Kie.ai
  let kieResponse: Response;
  try {
    kieResponse = await fetch(
      `https://api.kie.ai/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${env.KIE_API_KEY}`,
          'Accept': 'application/json',
        },
      },
    );
  } catch (err) {
    return json({ status: 'error', error: 'kie_request_failed', detail: String(err) }, 502);
  }

  const kieData = await kieResponse.json().catch(() => ({})) as Record<string, unknown>;
  console.log('KIE STATUS FULL:', JSON.stringify({ status: kieResponse.status, body: kieData }, null, 2));

  if (!kieResponse.ok) {
    return json({ status: 'error', error: 'kie_api_error', detail: kieData }, 502);
  }

  // Estrutura do record-info: { code, data: { callbackType, task_id, data: [...] } }
  // (mesma estrutura confirmada no callback)
  const outer        = (kieData['data'] ?? kieData) as Record<string, unknown>;
  const callbackType = String(outer['callbackType'] ?? '').toLowerCase();
  const kieCode      = Number(kieData['code'] ?? 0);

  const isComplete = callbackType === 'complete'
    || String(kieData['msg'] ?? '').toLowerCase().includes('success');
  const isFailed   = callbackType === 'failed' || callbackType === 'error';

  if (isComplete) {
    const tracks = (outer['data'] ?? []) as Array<Record<string, unknown>>;
    const t1     = tracks[0] ?? outer; // fallback para objeto plano

    const audioUrl    = String(t1['stream_audio_url'] ?? t1['audio_url'] ?? t1['audioUrl'] ?? '');
    const downloadUrl = String(t1['audio_url']        ?? audioUrl);
    const imageUrl    = String(t1['image_url']        ?? '');
    const duration    = t1['duration'] ?? null;

    if (audioUrl) {
      order['audioUrl']         = audioUrl;
      order['streamAudioUrl']   = audioUrl;
      order['downloadUrl']      = downloadUrl;
      order['imageUrl']         = imageUrl;
      order['duration']         = duration;
      order['generationStatus'] = 'ready';
      order['updated_at']       = new Date().toISOString();

      const t2 = tracks[1] ?? null;
      if (t2) {
        order['audioUrl2']    = String(t2['stream_audio_url'] ?? t2['audio_url'] ?? '');
        order['downloadUrl2'] = String(t2['audio_url'] ?? order['audioUrl2']);
        order['duration2']    = t2['duration'] ?? null;
      }

      await env.ORDERS_KV.put('order:' + orderId, JSON.stringify(order), {
        expirationTtl: 86400 * 365,
      });
    }

    return json({ status: 'ready', audioUrl, streamAudioUrl: audioUrl, downloadUrl, duration, imageUrl });
  }

  if (isFailed) {
    order['generationStatus'] = 'failed';
    order['updated_at']       = new Date().toISOString();
    await env.ORDERS_KV.put('order:' + orderId, JSON.stringify(order), { expirationTtl: 86400 * 30 });
    return json({ status: 'failed' });
  }

  // code 200 mas sem callbackType = ainda processando
  return json({ status: 'generating', kieCode });
};
