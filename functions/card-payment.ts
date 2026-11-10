import { asaas } from './_shared/asaas';

interface Env {
  ORDERS_KV: KVNamespace;
  ASAAS_API_KEY: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function digits(s: string) { return s.replace(/\D/g, ''); }
function clean(v: unknown, limit = 200) { return String(v ?? '').trim().slice(0, limit); }

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  let input: Record<string, unknown>;
  try { input = await request.json() as Record<string, unknown>; }
  catch { return json({ ok: false, error: 'invalid_json' }, 400); }

  const name       = clean(input['nome'], 120);
  const email      = clean(input['email'], 160);
  const phone      = digits(clean(input['whatsapp'], 40)).replace(/^55/, '');
  const cpf        = digits(clean(input['cpf'], 40));
  const cep        = digits(clean(input['cep'], 10));
  const numero     = clean(input['numero'], 20);
  const brief      = clean(input['brief'], 3000);
  const cardName   = clean(input['cardName'], 100);
  const cardNumber = digits(clean(input['cardNumber'], 20));
  const cardExpiry = clean(input['cardExpiry'], 7); // MM/AAAA
  const cardCvv    = clean(input['cardCvv'], 4);
  const clientIp   = request.headers.get('CF-Connecting-IP') || '127.0.0.1';

  if (!name || !email || !phone || !cpf || !cep || !numero) {
    return json({ ok: false, error: 'missing_fields' }, 422);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: 'invalid_email', message: 'E-mail inválido. Confira o endereço (ex.: nome@gmail.com).' }, 422);
  }
  if (!cardNumber || !cardExpiry || !cardCvv || !cardName) {
    return json({ ok: false, error: 'missing_card_fields' }, 422);
  }

  const [expMonth, expYear] = cardExpiry.includes('/') ? cardExpiry.split('/') : [cardExpiry.slice(0,2), cardExpiry.slice(2)];

  const externalRef = 'card-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const dueDate = new Date().toISOString().slice(0, 10);

  // 1. Criar cliente
  const custRes = await asaas(env.ASAAS_API_KEY, 'POST', '/customers', {
    name, email, cpfCnpj: cpf,
    mobilePhone: phone,
    externalReference: externalRef,
    notificationDisabled: true,
  });
  if (!custRes.ok && custRes.status !== 400) {
    return json({ ok: false, error: 'customer_error' }, 502);
  }
  const customerId = String(custRes.data['id'] || custRes.data['object'] || '');
  const finalCustomerId = customerId || (custRes.data['errors'] ? '' : '');

  // Tentar buscar cliente existente se falhou
  let cid = finalCustomerId;
  if (!cid) {
    const findRes = await asaas(env.ASAAS_API_KEY, 'GET', `/customers?cpfCnpj=${cpf}&limit=1`);
    const list = findRes.data['data'] as Array<Record<string, unknown>>;
    cid = list?.[0] ? String(list[0]['id']) : '';
  }
  if (!cid) return json({ ok: false, error: 'customer_not_found' }, 502);

  // 2. Criar pagamento cartão
  const payRes = await asaas(env.ASAAS_API_KEY, 'POST', '/payments', {
    customer: cid,
    billingType: 'CREDIT_CARD',
    value: 49.90,
    dueDate,
    description: 'Masters Music – Oferta Especial',
    externalReference: externalRef,
    creditCard: {
      holderName: cardName,
      number: cardNumber,
      expiryMonth: expMonth?.trim(),
      expiryYear: expYear?.trim(),
      ccv: cardCvv,
    },
    creditCardHolderInfo: {
      name,
      email,
      cpfCnpj: cpf,
      postalCode: cep,
      addressNumber: numero,
      phone,
    },
    remoteIp: clientIp,
  });

  if (!payRes.ok || !payRes.data['id']) {
    const errMsg = (payRes.data['errors'] as Array<{description?: string}>)?.[0]?.description || 'Pagamento recusado';
    return json({ ok: false, error: errMsg }, 402);
  }

  const paymentId = String(payRes.data['id']);
  const paid = payRes.data['status'] === 'CONFIRMED' || payRes.data['status'] === 'RECEIVED';

  // 3. Salvar no KV
  const order = {
    paymentId,
    customerId: cid,
    externalReference: externalRef,
    name, email, phone, cpf, brief,
    value: 49.90,
    billingType: 'CREDIT_CARD',
    orderBumpBackOffer: true,
    orderBumpVideo: true,
    paid,
    status: String(payRes.data['status'] || 'PENDING'),
    clientIp,
    userAgent: request.headers.get('User-Agent') || '',
    created_at: new Date().toISOString(),
  };
  if (env.ORDERS_KV) {
    await env.ORDERS_KV.put('order:' + paymentId, JSON.stringify(order), { expirationTtl: 86400 * 30 });
  }

  return json({ ok: true, paid, paymentId, status: payRes.data['status'] });
};
