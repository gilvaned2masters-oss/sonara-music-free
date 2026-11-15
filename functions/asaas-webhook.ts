/**
 * Legacy endpoint deliberately retired: Sonara creates no Asaas payments.
 * Historical KV orders are retained and may be handled from the admin panel.
 */
export const onRequest: PagesFunction = async () => new Response(
  JSON.stringify({ ok: false, error: 'gateway_retired' }),
  { status: 410, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } },
);
