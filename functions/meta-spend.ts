interface Env {
  ADMIN_PASSWORD: string;
  META_ACCESS_TOKEN: string;
  META_AD_ACCOUNT_ID: string;
}

function authorized(request: Request, env: Env): boolean {
  const encoded = (request.headers.get('Authorization') || '').replace(/^Basic\s+/i, '');
  if (!encoded) return false;
  try {
    const [, password] = atob(encoded).split(':');
    return Boolean(env.ADMIN_PASSWORD) && password === env.ADMIN_PASSWORD;
  } catch { return false; }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!authorized(request, env)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  if (!env.META_ACCESS_TOKEN || !env.META_AD_ACCOUNT_ID) {
    return Response.json({ ok: false, error: 'meta_not_configured' }, { status: 503 });
  }

  const account = env.META_AD_ACCOUNT_ID.replace(/^act_/, '');
  const params = new URLSearchParams({
    level: 'campaign',
    date_preset: 'today',
    fields: 'campaign_id,campaign_name,spend,impressions,clicks',
    limit: '100',
    access_token: env.META_ACCESS_TOKEN,
  });
  try {
    const upstream = await fetch(`https://graph.facebook.com/v22.0/act_${encodeURIComponent(account)}/insights?${params}`, {
      headers: { Accept: 'application/json' },
    });
    const payload = await upstream.json() as { data?: Array<Record<string, string>>; error?: { message?: string } };
    if (!upstream.ok) {
      console.warn('Meta insights failed:', payload.error?.message || upstream.status);
      return Response.json({ ok: false, error: 'meta_unavailable' }, { status: 502 });
    }
    const campaigns = (payload.data || []).map((row) => ({
      id: row.campaign_id || '',
      name: row.campaign_name || 'Sem nome',
      spend: Number(row.spend || 0),
      impressions: Number(row.impressions || 0),
      clicks: Number(row.clicks || 0),
    }));
    const spend = campaigns.reduce((sum, campaign) => sum + campaign.spend, 0);
    return Response.json({ ok: true, spend, campaigns, updatedAt: new Date().toISOString() }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return Response.json({ ok: false, error: 'meta_unavailable' }, { status: 502 });
  }
};
