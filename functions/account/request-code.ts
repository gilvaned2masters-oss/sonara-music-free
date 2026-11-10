// POST /account/request-code  body {email} → gera código e envia por email.
import { genCode, normEmail } from '../_shared/account';
import { sendEmail } from '../_shared/resend';

interface Env { ORDERS_KV: KVNamespace; RESEND_API_KEY: string; FROM_EMAIL: string; }

function json(d: unknown, s = 200): Response {
  return new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return json({ ok: false, error: 'invalid' }, 400); }
  const email = normEmail(body['email']);
  if (!email || !email.includes('@')) return json({ ok: false, error: 'email_invalido' }, 422);

  // Rate limit: 1 código por email a cada 60s
  const rl = await env.ORDERS_KV.get('loginrate:' + email);
  if (rl) return json({ ok: true, throttled: true });
  await env.ORDERS_KV.put('loginrate:' + email, '1', { expirationTtl: 60 }).catch(() => {});

  const code = genCode();
  await env.ORDERS_KV.put('logincode:' + email, JSON.stringify({ code }), { expirationTtl: 900 });

  if (env.RESEND_API_KEY) {
    const html = `<div style="font-family:sans-serif;max-width:420px;margin:auto;text-align:center">
      <h2 style="color:#7c3aed">Seu código de acesso</h2>
      <p>Use este código para entrar na sua conta Masters Music:</p>
      <div style="font-size:34px;font-weight:800;letter-spacing:6px;color:#111;background:#f3f0ff;border-radius:12px;padding:16px;margin:16px 0">${code}</div>
      <p style="color:#888;font-size:13px">Válido por 15 minutos. Se você não pediu, ignore este email.</p>
    </div>`;
    await sendEmail(env.RESEND_API_KEY, env.FROM_EMAIL || 'noreply@mastersmusic.com.br', {
      to: email, subject: `${code} é o seu código de acesso — Masters Music`, html,
    }).catch(() => {});
  }
  return json({ ok: true });
};
