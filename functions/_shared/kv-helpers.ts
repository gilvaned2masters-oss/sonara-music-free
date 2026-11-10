export type OrderMeta = {
  name: string;
  email: string;
  phone: string;
  value: number;
  paid: boolean;
  delivered: boolean;
  artPaid: boolean;
  refunded: boolean;
  prodStatus: string;
  notes: string;
  provider: string;
  responsavel: string;
  created_at: string;
  paymentId: string;
  bumpVersion: boolean;
  bumpSongs: boolean;
  bumpVideo: boolean;
  bumpQrCode: boolean;
  bumpBackOffer: boolean;
  source: string;
  utmSource: string;
  utmCampaign: string;
  utmContent: string;
  utmTerm: string;
  hasFbclid: boolean;
};

// Trunca strings para a metadata caber no limite de 1024 bytes do KV
function trunc(v: unknown, n: number): string {
  const s = String(v ?? '');
  return s.length > n ? s.slice(0, n) : s;
}

export function extractMeta(order: Record<string, unknown>): OrderMeta {
  return {
    name:       String(order['name']       ?? ''),
    email:      String(order['email']      ?? ''),
    phone:      String(order['phone']      ?? ''),
    value:      Number(order['value']      ?? 0),
    paid:       Boolean(order['paid']),
    delivered:  Boolean(order['delivered']),
    artPaid:    Boolean(order['artPaid']),
    refunded:   Boolean(order['refunded']),
    prodStatus: String(order['prodStatus'] ?? ''),
    notes:      String(order['notes']      ?? ''),
    provider:    String(order['provider']    ?? ''),
    responsavel: String(order['responsavel'] ?? ''),
    created_at: String(order['created_at'] ?? ''),
    paymentId:  String(order['paymentId']  ?? ''),
    bumpVersion:    Boolean(order['orderBumpExtraVersion']),
    bumpSongs:      Boolean(order['orderBumpExtraSongs']),
    bumpVideo:      Boolean(order['orderBumpVideo']),
    bumpQrCode:     Boolean(order['orderBumpQrCode']),
    bumpBackOffer:  Boolean(order['orderBumpBackOffer']),
    source:     String(order['source'] ?? ''),
    utmSource:   trunc(order['utmSource'],   40),
    utmCampaign: trunc(order['utmCampaign'], 90),
    utmContent:  trunc(order['utmContent'],  70),
    utmTerm:     trunc(order['utmTerm'],     70),
    hasFbclid:   !!(order['fbclid'] || order['fbc']),
  };
}

export function kvPutOrder(
  kv: KVNamespace,
  paymentId: string,
  order: Record<string, unknown>,
  ttl = 86400 * 30,
): Promise<void> {
  return kv.put('order:' + paymentId, JSON.stringify(order), {
    expirationTtl: ttl,
    metadata: extractMeta(order),
  });
}
