interface Env {
  ORDERS_KV: KVNamespace;
  KIE_API_KEY: string;
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

function parseBrief(brief: string): Record<string, string> {
  const result: Record<string, string> = {};
  const labels: [string, string][] = [
    ['Estilo', 'style'],
    ['Voz', 'voice'],
    ['Para quem', 'para'],
    ['Relacionamento', 'rel'],
    ['Ocasião', 'ocasiao'],
    ['História', 'historia'],
  ];
  for (const [label, key] of labels) {
    const match = brief.match(new RegExp(`${label}:\\s*([^\\n]+)`, 'i'));
    if (match) result[key] = match[1].trim();
  }
  return result;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let input: Record<string, unknown>;
  try { input = await request.json() as Record<string, unknown>; }
  catch { return json({ success: false, error: 'invalid_json' }, 400); }

  const isPreviewMode = input['previewMode'] === true;
  if (!isPreviewMode && !checkAuth(request, env)) return json({ success: false, error: 'unauthorized' }, 401);

  const orderId = String(input['orderId'] ?? '').replace(/[^a-zA-Z0-9_.-]/g, '');
  if (!orderId) return json({ success: false, error: 'missing_order_id' }, 400);

  if (!env.KIE_API_KEY) return json({ success: false, error: 'missing_kie_api_key' }, 500);

  // ── Rate limit por IP (somente preview mode) ────────────────────────────────
  if (isPreviewMode) {
    const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const rlKey = `ratelimit:preview:${ip}:${today}`;

    const rlRaw = await env.ORDERS_KV.get(rlKey);
    const rlCount = rlRaw ? parseInt(rlRaw) : 0;

    if (rlCount >= 3) {
      console.log('[ratelimit] IP bloqueado:', ip, 'tentativas:', rlCount);
      return json({ success: false, error: 'rate_limit', message: 'Limite de prévias atingido. Tente novamente amanhã.' }, 429);
    }

    // Incrementa contador — TTL de 25h para garantir reset no dia seguinte
    await env.ORDERS_KV.put(rlKey, String(rlCount + 1), { expirationTtl: 90000 });
    console.log('[ratelimit] IP:', ip, 'prévias hoje:', rlCount + 1);
  }

  // 1. Buscar order no KV (ou criar entrada temporária em preview mode)
  let order: Record<string, unknown>;
  const raw = await env.ORDERS_KV.get('order:' + orderId);
  if (!raw) {
    const directLetra = String(input['savedLetra'] ?? '').trim();
    if (!directLetra) return json({ success: false, error: 'order_not_found' }, 404);
    order = {
      orderId,
      savedLetra: directLetra,
      brief: `Estilo: ${String(input['style'] ?? '')}\nVoz: ${String(input['voice'] ?? '')}`,
      isPreview: true,
      generationStatus: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await env.ORDERS_KV.put('order:' + orderId, JSON.stringify(order), { expirationTtl: 86400 * 2 });
  } else {
    order = JSON.parse(raw) as Record<string, unknown>;
  }

  // Evitar geração duplicada
  if (order['generationTaskId']) {
    return json({ success: true, taskId: String(order['generationTaskId']), reused: true });
  }

  // 2. Extrair campos necessários
  const savedLetra = String(order['savedLetra'] ?? input['savedLetra'] ?? '').trim();
  if (!savedLetra) return json({ success: false, error: 'missing_letra' }, 422);

  const brief = parseBrief(String(order['brief'] ?? ''));
  const rawStyle = brief['style'] || 'Pop romântico';
  const rawVoice = (brief['voice'] || '').toLowerCase();
  const voice = rawVoice.includes('masc') ? 'male' : 'female';
  const voiceTag = voice === 'male' ? 'male vocals' : 'female vocals';

  // Mapa de tags técnicas para o Kie.ai/Chirp V4 — garante fidelidade ao estilo
  const STYLE_TAGS: Record<string, string> = {
    'arrocha':                      'arrocha, baiao, northeastern brazilian, romantic, slow, emotional, accordion, bass guitar',
    'axé':                          'axe music, brazilian carnival, upbeat, festive, percussion, cheerful, energetic',
    'brega / brega funk':           'brega funk, brazilian funk, electronic beats, bass heavy, 130bpm, urban, catchy hook',
    'eletrônica / edm':             'electronic, edm, synth, build up, drop, euphoric, 128bpm, emotional',
    'forró':                        'forro, northeastern brazilian, accordion, triangle, zabumba, upbeat, dançante, romantic',
    'funk carioca / funk brasileiro':'baile funk, brazilian funk, 150bpm, bass heavy, carioca, catchy, urban, repetitive hook',
    'gospel / música cristã':       'gospel, christian music, uplifting, choir, emotional, praise, worship, inspirational',
    'jazz / instrumental':          'jazz, sophisticated, piano, double bass, smooth, soulful, complex harmony',
    'mpb':                          'mpb, brazilian popular music, acoustic guitar, poetic, emotional, sophisticated, melodic',
    'pagode':                       'pagode, samba, brazilian, percussion, cavaquinho, emotional, romantic, syncopated',
    'pop':                          'pop, catchy, upbeat, modern, commercial, melodic hook, radio-friendly',
    'pop romântico acústico':       'acoustic pop, romantic, acoustic guitar, intimate, emotional, soft, heartfelt',
    'rap nacional':                 'brazilian rap, hip hop, storytelling, rhymes, urban, beat, spoken word',
    'r&b / soul':                   'r&b, soul, smooth, sensual, groove, emotional, slow tempo, melodic',
    'reggae':                       'reggae, chill, positive, offbeat rhythm, bass, spiritual, peaceful, romantic',
    'rock nacional':                'rock, electric guitar, drums, energetic, powerful, distortion, anthem',
    'romântico':                    'romantic, love song, emotional, soft, heartfelt, slow tempo, melodic, tender',
    'samba':                        'samba, brazilian, percussion, cheerful, syncopated, celebratory, acoustic guitar',
    'sertanejo raiz':               'sertanejo raiz, viola caipira, acoustic, countryside, traditional, nostalgic, heartfelt',
    'sertanejo universitário':      'sertanejo universitario, pop sertanejo, uptempo, electric guitar, romantic, modern country, catchy',
    'sertanejo romântico':          'sertanejo romantico, viola, acoustic guitar, romantic, emotional, heartfelt, slow, declaration of love',
    'trap / trap brasileiro':       'trap, hi-hats, 808 bass, brazilian trap, urban, dark, moody, hook',
  };

  function getStyleTags(estilo: string): string {
    const key = estilo.toLowerCase().trim();
    if (STYLE_TAGS[key]) return STYLE_TAGS[key];
    for (const [k, v] of Object.entries(STYLE_TAGS)) {
      if (key.includes(k) || k.includes(key)) return v;
    }
    return estilo.toLowerCase();
  }

  const style = `${getStyleTags(rawStyle)}, ${voiceTag}`;

  // 3. Chamar Kie.ai
  const origin = new URL(request.url).origin;
  const callBackUrl = `${origin}/kie-callback?orderId=${encodeURIComponent(orderId)}`;

  // Título baseado na ocasião + destinatário
  const destMatch = String(order['brief'] ?? '').match(/Para quem:\s*([^\n]+)/i);
  const dest = (destMatch?.[1] ?? '').trim().split(' ')[0]; // primeiro nome
  const ocasiao = (brief['ocasiao'] || '').toLowerCase();
  const rel = (brief['rel'] || '').toLowerCase();

  function buildTitle(dest: string, ocasiao: string, rel: string): string {
    const n = dest ? ` pra ${dest}` : '';
    if (ocasiao.includes('aniver')) return dest ? `Parabéns${n}` : 'Feliz Aniversário';
    if (ocasiao.includes('casamento') || ocasiao.includes('bodas')) return dest ? `Para Sempre${n}` : 'Para Sempre';
    if (ocasiao.includes('namora') || rel.includes('namora')) return dest ? `Feito pra Você${n}` : 'Feito pra Você';
    if (ocasiao.includes('mãe') || rel.includes('mãe') || ocasiao.includes('mae') || rel.includes('mae')) return dest ? `Pra Você, Mãe` : 'Pra Minha Mãe';
    if (ocasiao.includes('pai') || rel.includes('pai')) return dest ? `Pra Você, Pai` : 'Pra Meu Pai';
    if (ocasiao.includes('natal')) return dest ? `Feliz Natal${n}` : 'Feliz Natal';
    if (ocasiao.includes('form') || ocasiao.includes('forma')) return dest ? `Parabéns, Formando${n}` : 'Parabéns, Formando';
    if (ocasiao.includes('amig')) return dest ? `Um Brinde${n}` : 'Um Brinde';
    return dest ? `Feito pra Você, ${dest}` : 'Feita do Coração';
  }

  const title = buildTitle(dest, ocasiao, rel);

  const kieBody = {
    prompt: savedLetra,
    customMode: true,
    instrumental: false,
    model: 'V4',
    style: `${style}, voz ${voice === 'male' ? 'masculina' : 'feminina'}`,
    title,
    callBackUrl,
  };
  console.log('KIE REQUEST BODY:', JSON.stringify({ orderId, style, voice, titleUsed: title, savedLetraLen: savedLetra.length, callBackUrl }));

  let kieResponse: Response;
  try {
    kieResponse = await fetch('https://api.kie.ai/api/v1/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.KIE_API_KEY}`,
      },
      body: JSON.stringify(kieBody),
    });
  } catch (err) {
    return json({ success: false, error: 'kie_request_failed', detail: String(err) }, 502);
  }

  const kieData = await kieResponse.json().catch(() => ({})) as Record<string, unknown>;
  console.log('KIE GENERATE FULL:', JSON.stringify({ status: kieResponse.status, body: kieData }, null, 2));

  if (!kieResponse.ok) {
    return json({
      success: false,
      error: 'kie_api_error',
      detail: kieData,
      kie_status: kieResponse.status,
    }, 502);
  }

  // 4. Extrair taskId — Kie.ai retorna { code, msg, data: { taskId } }
  const kieResponseBody = (kieData['data'] ?? kieData) as Record<string, unknown>;
  const taskId  = String(kieResponseBody['taskId'] ?? kieResponseBody['task_id'] ?? kieResponseBody['id'] ?? '');
  if (!taskId) {
    return json({ success: false, error: 'no_task_id', detail: kieData }, 502);
  }

  // 5. Atualizar order no KV
  order['generationTaskId']  = taskId;
  order['generationStatus']  = 'generating';
  order['updated_at']        = new Date().toISOString();

  await env.ORDERS_KV.put('order:' + orderId, JSON.stringify(order), {
    expirationTtl: 86400 * 30,
  });

  // 6. Retornar sucesso
  return json({ success: true, taskId });
};
