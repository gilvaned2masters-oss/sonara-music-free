import { sendMetaCapiPurchase } from './_shared/meta-capi';

interface Env {
  META_PIXEL_ID: string;
  META_CAPI_TOKEN: string;
  ADMIN_PASSWORD: string;
  ORDERS_KV: KVNamespace;
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
  try { const [, pass] = atob(b64).split(':'); return pass === (env.ADMIN_PASSWORD || ''); }
  catch { return false; }
}

// GET /test-capi — dispara um Purchase de teste e retorna o resultado
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkAuth(request, env)) return json({ ok: false, error: 'unauthorized' }, 401);

  const pixelId = env.META_PIXEL_ID;
  const token   = env.META_CAPI_TOKEN;

  const testPaymentId = 'TEST_' + Date.now();

  const sent = await sendMetaCapiPurchase(pixelId, token, {
    paymentId: testPaymentId,
    name: 'Teste Masters Music',
    email: 'teste@mastersmusic.com.br',
    phone: '5511999999999',
    value: 29.90,
    fbp: '',
    fbc: '',
    clientIp: request.headers.get('CF-Connecting-IP') || '',
    userAgent: request.headers.get('User-Agent') || '',
    pageUrl: 'https://mastersmusic.com.br/',
    brief: 'Estilo: Sertanejo Romântico',
  });

  return json({
    ok: sent,
    pixelId_set: !!pixelId,
    token_set: !!token,
    pixelId_value: pixelId ? pixelId.slice(0, 6) + '...' : 'MISSING',
    result: sent ? 'CAPI funcionando ✅' : 'CAPI falhou ❌ — verifique token e pixelId no Cloudflare',
    event_id: testPaymentId,
  });
};
