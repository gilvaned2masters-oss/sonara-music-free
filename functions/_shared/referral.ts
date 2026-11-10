// Programa de indicação: a cada N compras indicadas, o indicador ganha 1 música grátis.
// Dados no KV (leve, sem banco):
//   ref:{codigo}   → { phone, email, name }            (código → dono)
//   refown:{phone} → { codigo, paidRefs:[paymentIds], used, ... }  (dono → estado)
// E no pedido de quem foi indicado: order.referredBy = "{codigo}".

export const REFERRALS_PER_FREE = 3;

function digits(s: unknown): string { return String(s ?? '').replace(/\D/g, ''); }
export function normPhone(p: unknown): string {
  let d = digits(p);
  if (d && !d.startsWith('55')) d = '55' + d;
  return d;
}

// Código curto sem caracteres ambíguos.
function randomCode(): string {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const arr = new Uint8Array(7);
  crypto.getRandomValues(arr);
  let s = '';
  for (const b of arr) s += a[b % a.length];
  return s;
}

// Garante que o dono (por telefone) tem um código. Retorna o código (ou '' se sem telefone).
export async function getOrCreateOwnerCode(
  kv: KVNamespace, phone: unknown, email: unknown, name: unknown,
): Promise<string> {
  const p = normPhone(phone);
  if (!p) return '';
  const existing = await kv.get('refown:' + p);
  if (existing) { try { return (JSON.parse(existing).codigo as string) || ''; } catch { /* recria */ } }
  let code = '';
  for (let i = 0; i < 6; i++) { code = randomCode(); if (!(await kv.get('ref:' + code))) break; }
  const owner = {
    codigo: code, phone: p, email: String(email ?? ''), name: String(name ?? ''),
    paidRefs: [] as string[], used: 0, created_at: new Date().toISOString(),
  };
  await kv.put('refown:' + p, JSON.stringify(owner));
  await kv.put('ref:' + code, JSON.stringify({ phone: p, email: String(email ?? ''), name: String(name ?? '') }));
  return code;
}

type CreditResult = {
  credited: boolean; total: number; earned?: number; milestone?: boolean;
  ownerPhone?: string; ownerName?: string; ownerEmail?: string; ownerCode?: string;
};

// Credita uma compra indicada (idempotente por paymentId, ignora auto-indicação).
export async function creditReferral(
  kv: KVNamespace, code: unknown, buyerOrder: Record<string, unknown>,
): Promise<CreditResult | null> {
  const c = String(code ?? '').trim().toUpperCase();
  if (!c) return null;
  const refRaw = await kv.get('ref:' + c);
  if (!refRaw) return null;
  const ref = JSON.parse(refRaw) as { phone: string; email?: string };
  const ownerPhone = ref.phone;

  // anti auto-indicação (mesmo telefone ou email)
  const buyerPhone = normPhone(buyerOrder['phone']);
  const buyerEmail = String(buyerOrder['email'] ?? '').toLowerCase();
  if (ownerPhone && ownerPhone === buyerPhone) return null;
  if (ref.email && ref.email.toLowerCase() === buyerEmail && buyerEmail) return null;

  const ownRaw = await kv.get('refown:' + ownerPhone);
  if (!ownRaw) return null;
  const owner = JSON.parse(ownRaw) as { codigo: string; name?: string; email?: string; paidRefs?: string[]; used?: number };
  const pid = String(buyerOrder['paymentId'] ?? '');
  const refs = owner.paidRefs ?? [];
  if (!pid || refs.includes(pid)) return { credited: false, total: refs.length };

  refs.push(pid);
  owner.paidRefs = refs;
  const total = refs.length;
  const milestone = Math.floor(total / REFERRALS_PER_FREE) > Math.floor((total - 1) / REFERRALS_PER_FREE);
  await kv.put('refown:' + ownerPhone, JSON.stringify(owner));
  return {
    credited: true, total, earned: Math.floor(total / REFERRALS_PER_FREE), milestone,
    ownerPhone, ownerName: owner.name, ownerEmail: owner.email, ownerCode: owner.codigo,
  };
}

// Status do dono (por código ou telefone) — para a página /indique.
export async function getOwnerStatus(
  kv: KVNamespace, codeOrPhone: unknown,
): Promise<Record<string, unknown> | null> {
  let ownerPhone = '';
  const c = String(codeOrPhone ?? '').trim().toUpperCase();
  const refRaw = c ? await kv.get('ref:' + c) : null;
  if (refRaw) ownerPhone = (JSON.parse(refRaw).phone as string) || '';
  else ownerPhone = normPhone(codeOrPhone);
  if (!ownerPhone) return null;
  const ownRaw = await kv.get('refown:' + ownerPhone);
  if (!ownRaw) return null;
  const o = JSON.parse(ownRaw) as { codigo: string; name?: string; paidRefs?: string[]; used?: number };
  const total = (o.paidRefs ?? []).length;
  const earned = Math.floor(total / REFERRALS_PER_FREE);
  const used = o.used ?? 0;
  return {
    codigo: o.codigo, name: o.name ?? '', total, perFree: REFERRALS_PER_FREE,
    earned, used, available: Math.max(0, earned - used),
    faltam: REFERRALS_PER_FREE - (total % REFERRALS_PER_FREE),
  };
}
