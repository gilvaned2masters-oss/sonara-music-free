export const ASAAS_BASE = 'https://api.asaas.com/v3';

export async function asaas(
  apiKey: string,
  method: string,
  path: string,
  payload?: unknown,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const body = payload != null ? JSON.stringify(payload) : undefined;
  const res = await fetch(ASAAS_BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'access_token': apiKey,
      'User-Agent': 'MastersMusic/1.0',
    },
    ...(body ? { body } : {}),
  });
  const data = await res.json().catch(() => ({})) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}
