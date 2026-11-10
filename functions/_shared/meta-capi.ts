interface Order {
  paymentId?: string;
  customerId?: string;
  externalReference?: string;
  name?: string;
  email?: string;
  phone?: string;
  value?: number;
  currency?: string;
  fbp?: string;
  fbc?: string;
  clientIp?: string;
  userAgent?: string;
  pageUrl?: string;
  metaCapiSent?: boolean;
  brief?: string;
}

async function sha256hex(value: string): Promise<string | null> {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256digits(value: string): Promise<string | null> {
  const digits = value.replace(/\D/g, '');
  if (!digits) return null;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(digits));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function sendMetaCapiPurchase(
  pixelId: string,
  capiToken: string,
  order: Order,
): Promise<boolean> {
  if (!pixelId || !capiToken) return false;

  const nameParts = (order.name || '').trim().split(/\s+/);
  const [em, ph, fn, ln] = await Promise.all([
    sha256hex(order.email || ''),
    sha256digits(order.phone || ''),
    sha256hex(nameParts[0] || ''),
    sha256hex(nameParts.length > 1 ? nameParts[nameParts.length - 1] : ''),
  ]);

  const eventId = 'purchase_' + (order.paymentId || '').replace(/[^a-zA-Z0-9_.-]/g, '');

  // Extrair estilo musical do brief para content_name mais preciso
  function extractEstilo(brief: string): string {
    const m = brief.match(/Estilo[:\s]+([^\n]+)/i);
    return m ? m[1].trim().slice(0, 60) : '';
  }
  const estilo = extractEstilo(order.brief || '');
  const contentName = estilo ? `Masters Music – ${estilo}` : 'Masters Music';

  const userData: Record<string, unknown> = {
    em: em ? [em] : undefined,
    ph: ph ? [ph] : undefined,
    fn: fn ? [fn] : undefined,
    ln: (ln && nameParts.length > 1) ? [ln] : undefined,
    external_id: order.customerId || order.paymentId || undefined,
    client_ip_address: order.clientIp || undefined,
    client_user_agent: order.userAgent || undefined,
    fbp: order.fbp || undefined,
    fbc: order.fbc || undefined,
  };

  // strip null/undefined
  Object.keys(userData).forEach(k => userData[k] == null && delete userData[k]);

  const payload = {
    data: [{
      event_name: 'Purchase',
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: 'website',
      event_source_url: order.pageUrl || 'https://mastersmusic.com.br/',
      user_data: userData,
      custom_data: {
        currency: order.currency || 'BRL',
        value: Number(order.value || 29.9),
        content_name: contentName,
        content_ids: ['masters_music'],
        content_type: 'product',
        order_id: order.externalReference || order.paymentId || '',
      },
    }],
  };

  try {
    const url = `https://graph.facebook.com/v21.0/${pixelId}/events?access_token=${capiToken}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const resBody = await res.json().catch(() => ({})) as Record<string, unknown>;
    console.log('[meta-capi] status:', res.status, 'body:', JSON.stringify(resBody));
    return res.ok;
  } catch(e) {
    console.log('[meta-capi] exception:', String(e));
    return false;
  }
}
