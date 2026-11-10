interface Env {
  ORDERS_KV: KVNamespace;
  AUDIO_BUCKET: R2Bucket;
  ADMIN_PASSWORD: string;
}

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

/** Extrai a key do R2 a partir do audioUrl armazenado.
 *  Funciona para paths locais: "/audio/pay_xxx.mp3" ou "audio/pay_xxx.mp3"
 *  URLs externas (Kie.ai CDN) retornam null — nada a deletar no R2.
 */
function extractR2Key(audioUrl: string): string | null {
  if (audioUrl.startsWith('/audio/') || audioUrl.startsWith('audio/')) {
    return audioUrl.replace(/^\//, '');
  }
  return null; // URLs externas (CDN Suno/KIE) — nada a deletar no R2
}

function nextCursor(list: { list_complete: boolean }): string | undefined {
  return list.list_complete ? undefined : (list as unknown as { cursor?: string }).cursor;
}

async function runCleanup(env: Env): Promise<{ cleaned: number; errors: number; skipped: number }> {
  const now = Date.now();
  let cleaned = 0, errors = 0, skipped = 0;
  let cursor: string | undefined;

  do {
    const list = await env.ORDERS_KV.list({ prefix: 'order:', cursor, limit: 100 });
    cursor = nextCursor(list);

    await Promise.all(list.keys.map(async (key) => {
      try {
        const raw = await env.ORDERS_KV.get(key.name);
        if (!raw) return;

        const order = JSON.parse(raw) as Record<string, unknown>;

        // Critérios: não pago + tem audioUrl + criado há mais de 3h
        const isPaid = order['paid'] === true;
        const audioUrl = String(order['audioUrl'] ?? '').trim();
        const createdAt = new Date(String(order['created_at'] ?? 0)).getTime();

        if (isPaid || !audioUrl || (now - createdAt) < THREE_HOURS_MS) {
          skipped++;
          return;
        }

        const orderId = String(order['paymentId'] ?? order['orderId'] ?? key.name);

        // 1. Tentar deletar do R2 (apenas para arquivos locais)
        const r2Key = extractR2Key(audioUrl);
        if (r2Key && env.AUDIO_BUCKET) {
          try {
            await env.AUDIO_BUCKET.delete(r2Key);
          } catch {
            // arquivo já inexistente — seguir adiante
          }
        }

        // 2. Atualizar order no KV
        order['audioUrl']         = null;
        order['streamAudioUrl']   = null;
        order['generationStatus'] = 'expired';
        order['updated_at']       = new Date().toISOString();

        await env.ORDERS_KV.put(key.name, JSON.stringify(order), { expirationTtl: 86400 * 7 });

        // 3. Log
        console.log(`Áudio expirado deletado: ${orderId}`);
        cleaned++;
      } catch (err) {
        console.error(`Erro ao processar ${key.name}:`, String(err));
        errors++;
      }
    }));
  } while (cursor);

  return { cleaned, errors, skipped };
}

// ── Modo 1: Scheduled Worker (Cron) ──────────────────────────────────────────
export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      const result = await runCleanup(env);
      console.log(`cleanup-unpaid-audio: cleaned=${result.cleaned} errors=${result.errors} skipped=${result.skipped}`);
    })());
  },
};

// ── Modo 2: Pages Function GET (trigger manual autenticado) ───────────────────
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = request.headers.get('Authorization') ?? '';
  const b64  = auth.replace(/^Basic\s+/i, '');
  let authed = false;
  try { const [, pass] = atob(b64).split(':'); authed = pass === (env.ADMIN_PASSWORD || ''); } catch { /* */ }
  if (!authed) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const result = await runCleanup(env);
  return new Response(JSON.stringify({ ok: true, ...result }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
};
