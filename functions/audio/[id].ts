interface Env {
  AUDIO_BUCKET: R2Bucket;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const id = (context.params.id as string || '').replace(/[^a-zA-Z0-9_.-]/g, '');
  if (!id) return new Response('Not found', { status: 404 });

  const obj = await context.env.AUDIO_BUCKET.get('audio/' + id);
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  headers.set('Content-Type', obj.httpMetadata?.contentType || 'audio/mpeg');
  headers.set('Cache-Control', 'public, max-age=31536000');
  headers.set('Accept-Ranges', 'bytes');

  return new Response(obj.body, { headers });
};
