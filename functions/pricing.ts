import { getPricing, DEFAULT_PRICING } from './_shared/pricing';

interface Env { ORDERS_KV: KVNamespace; }

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const pricing = env.ORDERS_KV ? await getPricing(env.ORDERS_KV) : DEFAULT_PRICING;
  return new Response(JSON.stringify({ ok: true, pricing }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=30' },
  });
};
