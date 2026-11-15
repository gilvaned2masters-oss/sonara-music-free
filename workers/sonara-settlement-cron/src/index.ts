/**
 * Sonara-only scheduler. It contains no Efí credential and has no dependency
 * on Nail: every minute it invokes the two authenticated Pages scanners.
 */
export interface Env {
  SONARA_PAGES_ORIGIN: string;
  SONARA_SETTLEMENT_TOKEN: string;
}

async function scan(env: Env, pathname: string): Promise<void> {
  const origin = String(env.SONARA_PAGES_ORIGIN || '').replace(/\/+$/, '');
  if (!origin || !env.SONARA_SETTLEMENT_TOKEN) throw new Error('scheduler_not_configured');
  const response = await fetch(origin + pathname, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SONARA_SETTLEMENT_TOKEN}` },
  });
  if (!response.ok) throw new Error(`scanner_${pathname}_${response.status}`);
}

async function run(env: Env): Promise<void> {
  for (const path of ['/efi-settlement-scan', '/production-scan']) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await scan(env, path); break; }
      catch (error) {
        if (attempt === 1) console.error('[sonara-settlement-cron]', path, error instanceof Error ? error.message : 'unknown');
      }
    }
  }
}

export default {
  async fetch(): Promise<Response> { return Response.json({ ok: true, service: 'sonara-settlement-cron' }); },
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> { ctx.waitUntil(run(env)); },
} satisfies ExportedHandler<Env>;
