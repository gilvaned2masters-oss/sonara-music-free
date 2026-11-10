interface Env {
  ORDERS_KV: KVNamespace;
  ADMIN_PASSWORD: string;
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

function dateStr(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return new Intl.DateTimeFormat('sv', { timeZone: 'America/Sao_Paulo' }).format(d);
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkAuth(request, env)) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  // Buscar últimos 7 dias
  const days: Array<{ date: string; data: Record<string, number> }> = [];
  for (let i = 0; i < 7; i++) {
    const date = dateStr(i);
    const raw = await env.ORDERS_KV.get(`analytics:${date}`);
    const data = raw ? JSON.parse(raw) as Record<string, number> : {};
    days.push({ date, data });
  }

  return new Response(JSON.stringify({ ok: true, days }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
