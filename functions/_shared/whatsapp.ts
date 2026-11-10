// Envio de WhatsApp via Evolution API (self-hosted, sem custo de mensagem).
// Dormente: se as envs EVOLUTION_* não estiverem setadas, vira no-op (não quebra nada).
interface EvoEnv {
  EVOLUTION_API_URL?: string;   // ex.: https://evo.seudominio.com
  EVOLUTION_API_KEY?: string;   // apikey (global ou da instância)
  EVOLUTION_INSTANCE?: string;  // nome da instância conectada ao número
}

// Envia "sua música está pronta" para o cliente. Retorna true se enviou.
export async function sendWhatsAppReady(
  env: EvoEnv, order: Record<string, unknown>, paymentId: string,
): Promise<boolean> {
  let base = (env.EVOLUTION_API_URL || '').replace(/\/+$/, '');
  const key  = env.EVOLUTION_API_KEY || '';
  const inst = env.EVOLUTION_INSTANCE || '';
  if (!base || !key || !inst) return false; // não configurado → no-op
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'apikey': key };
  try {
    const u = new URL(base);
    if (u.username || u.password) {
      headers.Authorization = 'Basic ' + btoa(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`);
      u.username = '';
      u.password = '';
      base = u.toString().replace(/\/+$/, '');
    }
  } catch {
    // Mantém base como veio; o fetch abaixo registra erro se a URL for inválida.
  }

  // Só PT-BR. O cenário ES (Hotmart/LatAm) tem outro fluxo/idioma.
  if (order['lang'] === 'es' || order['source'] === 'esp' || order['provider'] === 'hotmart') return false;

  let phone = String(order['phone'] || '').replace(/\D/g, '');
  if (phone.length < 10) return false;
  if (!phone.startsWith('55')) phone = '55' + phone;

  const nome   = String(order['name'] || '').split(' ')[0] || 'Olá';
  const titulo = String(order['lyricsTitle'] || 'sua música personalizada');
  const link   = `https://mastersmusic.com.br/pronto?id=${paymentId}`;
  const text =
    `Olá, ${nome}! 🎵\n\n` +
    `Sua música *"${titulo}"* ficou pronta! 🎉\n\n` +
    `Ouça e baixe agora aqui:\n${link}\n\n` +
    `Qualquer dúvida, é só responder esta mensagem. 💜\n_Masters Music_`;

  try {
    const r = await fetch(`${base}/message/sendText/${encodeURIComponent(inst)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ number: phone, text }),
    });
    if (!r.ok) {
      console.error('[whatsapp] Evolution erro', r.status, await r.text().catch(() => ''));
      return false;
    }
    return true;
  } catch (e) {
    console.error('[whatsapp] Evolution exceção', String(e));
    return false;
  }
}
