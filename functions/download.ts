export const onRequestGet: PagesFunction = async ({ request }) => {
  const url   = new URL(request.url);
  let src     = url.searchParams.get('url') ?? '';
  const title = (url.searchParams.get('title') ?? 'musica')
    .replace(/[^a-zA-Z0-9À-ú _-]/g, '').trim() || 'musica';

  // URLs do R2 vêm relativas (/audio/...) — resolve para o domínio atual.
  if (src.startsWith('/audio/')) src = url.origin + src;
  if (!src.startsWith('https://')) return new Response('invalid', { status: 400 });

  try {
    const res = await fetch(src, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'audio/mpeg,audio/*,*/*',
      },
    });

    if (!res.ok) throw new Error(`upstream ${res.status}`);

    const contentType = res.headers.get('content-type') || 'audio/mpeg';
    return new Response(res.body, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${title}.mp3"`,
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    // Fallback: força download via response com redirect transparente
    try {
      const res2 = await fetch(src);
      if (res2.ok) {
        return new Response(res2.body, {
          headers: {
            'Content-Type': 'audio/mpeg',
            'Content-Disposition': `attachment; filename="${title}.mp3"`,
            'Cache-Control': 'no-store',
          },
        });
      }
    } catch {}
    // Último recurso: redirect (perde o download attribute mas abre o áudio)
    return Response.redirect(src, 302);
  }
};
