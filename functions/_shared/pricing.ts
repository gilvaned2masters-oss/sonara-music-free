export interface Pricing {
  base: number;      // produto principal
  original: number;  // preço "de" riscado
  version: number;   // bump: +1 versão extra
  songs: number;     // bump: +2 músicas
  video: number;     // bump: vídeo
  qrcode: number;    // bump: QR code
  backOffer: number; // oferta de saída
}

// Defaults = preços ATUAIS da Masters Music (espelham create-payment.ts e o funil).
// OBS: video = 49.90 (o label do bump e o backend cobram 49,90; o antigo 79,90 no JS era bug).
export const DEFAULT_PRICING: Pricing = {
  base: 39.90, original: 97.00, version: 19.90, songs: 29.90,
  video: 49.90, qrcode: 14.90, backOffer: 49.90,
};

export const PRICING_KEYS = Object.keys(DEFAULT_PRICING) as (keyof Pricing)[];

export async function getPricing(kv: KVNamespace | undefined): Promise<Pricing> {
  if (kv) {
    try {
      const raw = await kv.get('config:pricing');
      if (raw) return { ...DEFAULT_PRICING, ...JSON.parse(raw) };
    } catch { /* usa default */ }
  }
  return { ...DEFAULT_PRICING };
}

export function sanitizePricing(input: Record<string, unknown>, current: Pricing): Pricing {
  const out = { ...current };
  for (const k of PRICING_KEYS) {
    const v = Number(input[k]);
    if (isFinite(v) && v >= 0 && v <= 99999) out[k] = Math.round(v * 100) / 100;
  }
  return out;
}
