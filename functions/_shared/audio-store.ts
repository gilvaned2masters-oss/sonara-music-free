// Baixa um MP3 de uma URL externa e guarda no R2 (AUDIO_BUCKET).
// Usado para tornar a música PERMANENTE no nosso domínio — as URLs do KIE
// (musicfile.kie.ai = stream) expiram para 0 bytes em poucas horas.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

export async function storeMp3ToR2(bucket: R2Bucket, key: string, srcUrl: string): Promise<boolean> {
  try {
    const res = await fetch(srcUrl, { headers: { 'User-Agent': BROWSER_UA, 'Accept': 'audio/mpeg,audio/*,*/*' } });
    if (!res.ok) return false;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 50000) return false; // arquivo vazio/incompleto (stream morto vem com ~0)
    await bucket.put(key, buf, { httpMetadata: { contentType: 'audio/mpeg' } });
    return true;
  } catch {
    return false;
  }
}

// Consulta o record-info do KIE e devolve as URLs PERMANENTES (sourceAudioUrl/audioUrl
// = tempfile.aiquickdraw.com, com Range), na ordem das faixas.
export async function kiePermanentUrls(taskId: string, apiKey: string): Promise<string[]> {
  try {
    const r = await fetch(`https://api.kie.ai/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!r.ok) return [];
    const d = await r.json() as Record<string, unknown>;
    const data = (d['data'] ?? {}) as Record<string, unknown>;
    const resp = (data['response'] ?? {}) as Record<string, unknown>;
    const tracks = (resp['sunoData'] ?? []) as Array<Record<string, unknown>>;
    return tracks
      .map((t) => String(t['sourceAudioUrl'] ?? t['audioUrl'] ?? ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}
