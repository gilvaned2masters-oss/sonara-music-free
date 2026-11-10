interface Env {
  ORDERS_KV: KVNamespace;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const id = (context.params.id as string || '').replace(/[^a-zA-Z0-9_.-]/g, '');
  if (!id) return new Response('Not found', { status: 404 });

  const raw = await context.env.ORDERS_KV.get('order:' + id);
  if (!raw) return new Response('Not found', { status: 404 });

  const order = JSON.parse(raw) as Record<string, unknown>;
  const v = context.request.url.includes('v2') || new URL(context.request.url).searchParams.get('v') === '2';
  const audioUrl = v
    ? String(order['downloadUrl2'] || order['audioUrl2'] || '')
    : String(order['downloadUrl']  || order['audioUrl']  || order['musicLink'] || '');

  if (!audioUrl) return new Response('Música ainda não gerada', { status: 404 });

  // Extrair nome para o arquivo
  let para = 'musica';
  try {
    const brief = String(order['brief'] || '');
    const m = brief.match(/Para quem:\s*([^\n]+)/i);
    if (m) para = m[1].trim().split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  } catch {}
  const filename = `masters-${para}${v ? '-v2' : ''}.mp3`;

  // Proxy do áudio com headers corretos para download
  let upstream: Response;
  try {
    upstream = await fetch(audioUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'audio/mpeg,audio/*,*/*' },
    });
  } catch {
    return new Response('Erro ao buscar áudio', { status: 502 });
  }

  if (!upstream.ok) return new Response('Áudio não disponível', { status: 502 });

  const headers = new Headers({
    'Content-Type': upstream.headers.get('Content-Type') || 'audio/mpeg',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'public, max-age=86400',
    'Access-Control-Allow-Origin': '*',
  });

  const contentLength = upstream.headers.get('Content-Length');
  if (contentLength) headers.set('Content-Length', contentLength);

  return new Response(upstream.body, { status: 200, headers });
};
