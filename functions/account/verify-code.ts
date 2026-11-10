// POST /account/verify-code  body {email, code} → valida e devolve token de sessão.
import { normEmail, createSession } from '../_shared/account';

interface Env { ORDERS_KV: KVNamespace; }

function json(d: unknown, s = 200): Response {
  return new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return json({ ok: false, error: 'invalid' }, 400); }
  const email = normEmail(body['email']);
  const code = String(body['code'] ?? '').replace(/\D/g, '');
  if (!email || code.length !== 6) return json({ ok: false, error: 'dados_invalidos' }, 422);

  const raw = await env.ORDERS_KV.get('logincode:' + email);
  if (!raw) return json({ ok: false, error: 'codigo_expirado' }, 401);
  let stored = '';
  try { stored = String(JSON.parse(raw).code ?? ''); } catch { /* ignore */ }
  if (!stored || stored !== code) return json({ ok: false, error: 'codigo_incorreto' }, 401);

  await env.ORDERS_KV.delete('logincode:' + email); // uso único
  const token = await createSession(env.ORDERS_KV, email);
  return json({ ok: true, token });
};
