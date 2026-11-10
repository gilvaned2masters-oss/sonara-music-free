import { kvPutOrder } from './kv-helpers';
import { buildSunorPayload, buildKiePayload } from './treblo-helpers';

// ── Contagem de versões compradas ───────────────────────────────────────────
// Base = 1 versão. Bump "versão extra" (+1). Bump "2 músicas extras" (+2).
// Total possível: 1, 2, 3 ou 4 versões.
export function versionsCount(order: Record<string, unknown>): number {
  let n = 1;
  if (order['orderBumpExtraVersion']) n += 1;
  if (order['orderBumpExtraSongs'])   n += 2;
  return Math.min(Math.max(n, 1), 4);
}

// Cada task Sunor/KIE gera 2 áudios → nº de tasks = teto(versões / 2): 1 ou 2.
export function tasksNeeded(order: Record<string, unknown>): number {
  return Math.ceil(versionsCount(order) / 2);
}

const MP3_FIELDS = ['mp3_url', 'mp3_url_2', 'mp3_url_3', 'mp3_url_4'];

export function collectMp3Urls(order: Record<string, unknown>): string[] {
  return MP3_FIELDS.map((k) => String(order[k] ?? '')).filter(Boolean);
}

// Grava as URLs (limitado ao nº de versões compradas) em mp3_url..mp3_url_4
export function saveMp3Urls(order: Record<string, unknown>, urls: string[]): void {
  const versions = versionsCount(order);
  urls.slice(0, versions).forEach((u, i) => { if (u) order[MP3_FIELDS[i]] = u; });
}

export function sunorTaskIds(order: Record<string, unknown>): string[] {
  return [String(order['sunor_task_id'] ?? ''), String(order['sunor_task_id_2'] ?? '')].filter(Boolean);
}

export function kieTaskIds(order: Record<string, unknown>): string[] {
  return [String(order['kie_task_id'] ?? ''), String(order['kie_task_id_2'] ?? '')].filter(Boolean);
}

type PollResult = { state: 'success' | 'generating' | 'failure'; urls: string[] };

// ── Disparo Sunor (1 ou 2 tasks conforme versões) ───────────────────────────
export async function startSunorGeneration(
  kv: KVNamespace, sunorApiKey: string, paymentId: string, order: Record<string, unknown>,
): Promise<void> {
  const lyrics = String(order['savedLetra'] || '');
  if (!lyrics) return;
  const voz          = String(order['voz']          || 'Feminina');
  const estilo       = String(order['estilo']       || 'Sertanejo Universitário');
  const destinatario = String(order['destinatario'] || '');
  const title        = String(order['lyricsTitle']  || `Para ${destinatario}`);
  const sunorStyle   = String(order['sunorStyle']   || '');
  const payload = buildSunorPayload({ estilo, voz, lyrics, title, sunorStyle });

  const need   = tasksNeeded(order);
  const fields = ['sunor_task_id', 'sunor_task_id_2'];
  for (let i = 0; i < need; i++) {
    if (order[fields[i]]) continue; // já disparada
    try {
      const res = await fetch('https://sunor.cc/api/v1/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': sunorApiKey },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const d = await res.json() as { data?: { task_id?: string } };
        const tid = d?.data?.task_id;
        if (tid) {
          order[fields[i]]    = tid;
          order['updated_at'] = new Date().toISOString();
          await kvPutOrder(kv, paymentId, order);
          console.log('[gen] Sunor task', i + 1, 'iniciada:', tid, 'para', paymentId);
        }
      } else {
        console.error('[gen] Sunor erro task', i + 1, res.status, await res.text().catch(() => ''));
      }
    } catch (e) {
      console.error('[gen] Sunor exceção task', i + 1, String(e));
    }
  }
}

// Faz poll de todas as tasks Sunor e agrega o resultado.
export async function pollSunorTasks(sunorApiKey: string, taskIds: string[]): Promise<PollResult> {
  const urls: string[] = [];
  let anyFail = false, anyGen = false;
  for (const tid of taskIds) {
    try {
      const res = await fetch(`https://sunor.cc/api/v1/task/${tid}`, { headers: { 'x-api-key': sunorApiKey } });
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500) anyFail = true; else anyGen = true;
        continue;
      }
      const pd = await res.json() as { data?: { status?: string; output?: { result?: Array<{ audio_url?: string }> } } };
      const st = (pd?.data?.status ?? '').toLowerCase();
      if (st === 'success') {
        for (const r of (pd?.data?.output?.result ?? [])) if (r?.audio_url) urls.push(String(r.audio_url));
      } else if (st === 'failure' || st === 'timeout') {
        anyFail = true;
      } else {
        anyGen = true;
      }
    } catch { anyGen = true; }
  }
  if (anyGen) return { state: 'generating', urls };
  if (urls.length > 0) return { state: 'success', urls };
  return { state: 'failure', urls };
}

// ── Disparo KIE (fallback) — 1 ou 2 tasks conforme versões ───────────────────
export async function startKieGeneration(
  kv: KVNamespace, kieApiKey: string, origin: string, paymentId: string, order: Record<string, unknown>,
): Promise<void> {
  const lyrics = String(order['savedLetra'] || '');
  if (!lyrics) return;
  const voz          = String(order['voz']          || 'Feminina');
  const estilo       = String(order['estilo']       || 'Sertanejo Universitário');
  const destinatario = String(order['destinatario'] || '');
  const ocasiao      = String(order['ocasiao']      || 'Especial');
  const title        = String(order['lyricsTitle']  || `Para ${destinatario}`);
  const callBackUrl  = `${origin}/kie-callback?orderId=${encodeURIComponent(paymentId)}`;
  const payload = buildKiePayload({ estilo, voz, ocasiao, destinatario, lyrics, title, callBackUrl });

  const need   = tasksNeeded(order);
  const fields = ['kie_task_id', 'kie_task_id_2'];
  for (let i = 0; i < need; i++) {
    if (order[fields[i]]) continue;
    // Retry com backoff: KIE limita a 20 gerações/10s → 429 (não enfileira).
    // Também cobre 5xx transitório. Até 4 tentativas (~0+1.5+3+5s).
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch('https://api.kie.ai/api/v1/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${kieApiKey}` },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const d = await res.json() as { data?: { taskId?: string } };
          const tid = d?.data?.taskId;
          if (tid) {
            order[fields[i]]    = tid;
            order['updated_at'] = new Date().toISOString();
            await kvPutOrder(kv, paymentId, order);
            console.log('[gen] KIE task', i + 1, 'iniciada:', tid, 'para', paymentId);
          }
          break; // ok (mesmo sem tid não reenviar pra não duplicar)
        }
        // 429 (rate limit) ou 5xx → espera e tenta de novo; outros erros → desiste
        if (res.status === 429 || res.status >= 500) {
          console.error('[gen] KIE', res.status, 'task', i + 1, 'tentativa', attempt + 1);
          if (attempt < 3) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
        } else {
          console.error('[gen] KIE erro task', i + 1, res.status, await res.text().catch(() => ''));
        }
        break;
      } catch (e) {
        console.error('[gen] KIE exceção task', i + 1, 'tentativa', attempt + 1, String(e));
        if (attempt < 3) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
        break;
      }
    }
  }
}

// Faz poll (record-info) de todas as tasks KIE e agrega o resultado.
export async function pollKieTasks(kieApiKey: string, taskIds: string[]): Promise<PollResult> {
  const urls: string[] = [];
  let anyFail = false, anyGen = false;
  for (const tid of taskIds) {
    try {
      const res = await fetch(
        `https://api.kie.ai/api/v1/generate/record-info?taskId=${encodeURIComponent(tid)}`,
        { headers: { 'Authorization': `Bearer ${kieApiKey}` } },
      );
      if (!res.ok) { anyGen = true; continue; }
      const kd     = await res.json() as Record<string, unknown>;
      const data   = (kd['data'] ?? kd) as Record<string, unknown>;
      const status = String(data['status'] ?? '').toUpperCase();
      const resp   = (data['response'] ?? {}) as Record<string, unknown>;
      const sunoData = (resp['sunoData'] ?? []) as Array<Record<string, unknown>>;
      if (status.includes('SUCCESS')) {
        // URLs permanentes (tempfile), não a de stream (musicfile.kie.ai) que expira
        for (const t of sunoData) {
          const u = String(t['sourceAudioUrl'] ?? t['audioUrl'] ?? '');
          if (u) urls.push(u);
        }
        if (!sunoData.length) anyGen = true; // success sem faixas ainda → segue aguardando
      } else if (status.includes('FAIL') || status.includes('ERROR')) {
        anyFail = true;
      } else {
        anyGen = true; // PENDING/TEXT_SUCCESS/FIRST_SUCCESS etc. → ainda gerando
      }
    } catch { anyGen = true; }
  }
  if (anyGen) return { state: 'generating', urls };
  if (urls.length > 0) return { state: 'success', urls };
  return { state: 'failure', urls };
}
