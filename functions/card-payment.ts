/** Sonara accepts Efí Pix only. Card collection is intentionally unavailable. */
export const onRequest: PagesFunction = async () => new Response(
  JSON.stringify({ ok: false, error: 'pix_only', message: 'Esta oferta aceita pagamento via Pix.' }),
  { status: 410, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } },
);
