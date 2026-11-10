export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  from?: string;
  idempotencyKey?: string;
}

export async function sendEmail(
  apiKey: string,
  fromEmail: string,
  params: SendEmailParams,
): Promise<boolean> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    };
    if (params.idempotencyKey) {
      headers['Idempotency-Key'] = params.idempotencyKey;
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from: params.from ?? fromEmail,
        to: [params.to],
        subject: params.subject,
        html: params.html,
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.status.toString());
      console.error('[resend] send failed:', res.status, err);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[resend] exception:', String(e));
    return false;
  }
}

export function buildRecoveryEmail(order: Record<string, unknown>, pixPayload: string, encodedImage: string | null, ownerWhatsapp?: string, stage = 1): string {
  const name     = String(order['name'] ?? '').split(' ')[0];
  const value    = Number(order['value'] ?? 39.9).toFixed(2).replace('.', ',');
  const dest     = String(order['destinatario'] ?? '').split(' ')[0];
  const destTxt  = dest ? ` para ${dest}` : '';
  // Copy por estágio: 1=lembrete amigável, 2=urgência (PIX expira), 3=última chance
  const hero = ({
    1: { emoji: '🎵', title: `${name}, sua música está esperando por você!`, sub: 'Você gerou um PIX mas ainda não finalizou o pagamento' },
    2: { emoji: '⏳', title: `${name}, seu PIX está prestes a expirar!`, sub: 'Geramos um código novo pra você não perder sua música' },
    3: { emoji: '🚨', title: `Última chance, ${name}!`, sub: 'Este é o último lembrete — não deixe sua música passar' },
  } as Record<number, { emoji: string; title: string; sub: string }>)[stage] ?? { emoji: '🎵', title: `${name}, sua música está esperando!`, sub: '' };
  const intro = ({
    1: `Notamos que você começou a criar uma música personalizada, mas o pagamento ainda não foi confirmado.<br><br><strong style="color:#7c5cbf">A boa notícia:</strong> geramos um novo QR Code PIX pra você finalizar agora em segundos. É só escanear e pronto! 🎶`,
    2: `Sua música personalizada${destTxt} ainda está te esperando — mas o PIX que você gerou pode expirar a qualquer momento.<br><br>Por isso geramos um <strong style="color:#7c5cbf">código novo e válido</strong> aqui embaixo. Leva 30 segundos pra garantir. 🎶`,
    3: `Este é o nosso último lembrete. 💜<br><br>Sua música${destTxt} está a um passo de ficar pronta — falta só o pagamento. Não deixe essa homenagem única passar. Geramos um <strong style="color:#7c5cbf">PIX novo</strong> pra você finalizar agora.`,
  } as Record<number, string>)[stage] ?? '';
  const waNumber = (ownerWhatsapp ?? '').replace(/\D/g, '');
  const waMsg    = encodeURIComponent(`Olá! Preciso de ajuda para finalizar meu pagamento da Masters Music. 🎵\nNome: ${String(order['name'] ?? '')}`);
  const waUrl    = waNumber ? `https://wa.me/${waNumber.startsWith('55') ? waNumber : '55' + waNumber}?text=${waMsg}` : '';
  // QR via URL hospedada (Gmail bloqueia imagem base64/data-URI e clipa o email).
  // Gera a partir do próprio código PIX → sempre escaneável, e mantém o email leve.
  const qrImg    = pixPayload
    ? `<img src="https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=0&data=${encodeURIComponent(pixPayload)}" alt="QR Code PIX" width="200" height="200" style="width:200px;height:200px;border-radius:12px;border:3px solid #7c5cbf;padding:8px;background:#fff;display:block;margin:0 auto 20px">`
    : '';

  const destLine = dest ? `<p style="margin:0 0 16px;font-size:15px;color:#c9a8ff;text-align:center;font-style:italic">Sua música para <strong>${dest}</strong> está quase pronta — só falta o pagamento.</p>` : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Finalize seu pedido — Masters Music</title>
</head>
<body style="margin:0;padding:0;background:#f4f1fb;font-family:'Helvetica Neue',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1fb;padding:32px 16px">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%">

        <!-- Logo -->
        <tr><td align="center" style="padding-bottom:24px">
          <div style="font-size:28px;font-weight:900;color:#1a0a3c">🎵 <span style="color:#7c5cbf">Masters</span> Music</div>
        </td></tr>

        <!-- Hero card -->
        <tr><td style="background:#ffffff;border-radius:20px;padding:36px 32px;box-shadow:0 4px 24px rgba(124,92,191,0.10)">

          <!-- Urgência visual -->
          <div style="background:linear-gradient(135deg,#7c5cbf,#a855f7);border-radius:12px;padding:18px 20px;text-align:center;margin-bottom:28px">
            <div style="font-size:32px;margin-bottom:6px">${hero.emoji}</div>
            <p style="margin:0;font-size:18px;font-weight:900;color:#fff;line-height:1.3">${hero.title}</p>
            <p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.8)">${hero.sub}</p>
          </div>

          ${destLine}

          <!-- Mensagem principal -->
          <p style="margin:0 0 8px;font-size:16px;color:#1a0a3c;line-height:1.7">
            Olá, <strong>${name}</strong>! 👋
          </p>
          <p style="margin:0 0 20px;font-size:15px;color:#4a3d6a;line-height:1.7">
            ${intro}
          </p>

          <!-- Prova social -->
          <div style="background:#f9f5ff;border-left:4px solid #7c5cbf;border-radius:8px;padding:14px 18px;margin-bottom:28px">
            <p style="margin:0;font-size:13px;color:#4a3d6a;line-height:1.6;font-style:italic">
              "Fiz uma música para o aniversário da minha esposa e ela <strong>chorou de emoção</strong>. Valeu muito cada centavo!" <br>
              <span style="font-style:normal;font-size:12px;color:#7c5cbf;font-weight:700">— João D., cliente Masters Music ⭐⭐⭐⭐⭐</span>
            </p>
          </div>

          <!-- QR Code + PIX -->
          <div style="background:#f4f1fb;border:2px dashed #c9a8ff;border-radius:16px;padding:28px 20px;text-align:center;margin-bottom:24px">
            <p style="margin:0 0 16px;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:#7c5cbf">📱 Seu QR Code PIX</p>
            ${qrImg}
            <p style="margin:0 0 12px;font-size:22px;font-weight:900;color:#1a0a3c">R$ ${value}</p>
            <p style="margin:0 0 16px;font-size:12px;color:#6b5a8a">Ou copie o código abaixo para colar no app do seu banco:</p>
            <div style="background:#fff;border:1px solid #e2d9f3;border-radius:10px;padding:14px 16px;word-break:break-all;font-size:11px;color:#7c5cbf;font-family:'Courier New',monospace;line-height:1.5;text-align:left">${pixPayload}</div>
          </div>

          <!-- Garantia -->
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px 18px;text-align:center;margin-bottom:24px">
            <p style="margin:0;font-size:13px;color:#166534;font-weight:700">✅ Garantia de 7 dias — dinheiro de volta sem burocracia</p>
          </div>

          <!-- O que você vai receber -->
          <div style="margin-bottom:28px">
            <p style="margin:0 0 12px;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#4a3d6a">🎁 O que você vai receber:</p>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding:6px 0;font-size:14px;color:#1a0a3c;border-bottom:1px solid #e9e3f5">🎵 Música 100% personalizada com sua história</td></tr>
              <tr><td style="padding:6px 0;font-size:14px;color:#1a0a3c;border-bottom:1px solid #e9e3f5">🎤 Letra criada por IA + voz profissional</td></tr>
              <tr><td style="padding:6px 0;font-size:14px;color:#1a0a3c;border-bottom:1px solid #e9e3f5">⚡ Entrega automática em minutos</td></tr>
              <tr><td style="padding:6px 0;font-size:14px;color:#1a0a3c">📥 MP3 de alta qualidade para baixar</td></tr>
            </table>
          </div>

          <!-- CTA WhatsApp -->
          ${waUrl ? `
          <p style="margin:0 0 10px;font-size:13px;color:#6b5a8a;text-align:center">Ficou com dúvida ou precisa de ajuda?</p>
          <a href="${waUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#25d366,#128c7e);color:#fff;font-weight:800;font-size:15px;padding:14px 24px;border-radius:12px;text-decoration:none;letter-spacing:0.3px">📲 Falar com suporte no WhatsApp</a>
          ` : ''}

        </td></tr>

        <!-- Footer -->
        <tr><td align="center" style="padding-top:20px">
          <p style="margin:0;font-size:12px;color:#9b8ec4;line-height:1.8">
            Masters Music · <a href="https://mastersmusic.com.br" style="color:#7c5cbf;text-decoration:none">mastersmusic.com.br</a><br>
            Você recebeu este email porque iniciou um pedido em nosso site.<br>
            <span style="color:#c9a8ff">Atendimento: 07:00 às 21:00 todos os dias.</span>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildMusicDeliveryEmail(order: Record<string, unknown>, musicLink: string, ownerWhatsapp?: string): string {
  const name = String(order['name'] ?? '').split(' ')[0];
  const waNumber = (ownerWhatsapp ?? '').replace(/\D/g, '');
  const waMsg = encodeURIComponent(`Olá! Recebi o link da minha música da Masters Music! 🎵`);
  const waUrl = waNumber ? `https://wa.me/${waNumber.startsWith('55') ? waNumber : '55' + waNumber}?text=${waMsg}` : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:'Helvetica Neue',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:32px 16px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
        <tr><td align="center" style="padding-bottom:28px">
          <div style="font-size:26px;font-weight:900;color:#fff">🎵 <span style="background:linear-gradient(135deg,#a07ce8,#c9a8ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent">Masters Music</span></div>
        </td></tr>
        <tr><td style="background:#13111f;border:1px solid #2a2040;border-radius:16px;padding:32px 28px">
          <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#fff">Sua música está pronta! 🎶</p>
          <p style="margin:0 0 24px;font-size:15px;color:#9b8ec4;line-height:1.6">
            Olá, <strong style="color:#d4b8ff">${name}</strong>! Sua música personalizada ficou incrível.<br>
            Clique no botão abaixo para ouvir e baixar agora:
          </p>
          <a href="${musicLink}" style="display:block;text-align:center;background:linear-gradient(135deg,#7c5cbf,#a07ce8);color:#fff;font-weight:800;font-size:16px;padding:16px 24px;border-radius:12px;text-decoration:none;margin-bottom:24px">🎵 Ouvir minha música</a>
          <div style="background:#0f0d1a;border:1px solid #2a2040;border-radius:10px;padding:14px 18px;margin-bottom:24px;text-align:center">
            <p style="margin:0 0 8px;font-size:12px;color:#6b5a8a">Ou copie o link diretamente:</p>
            <div style="word-break:break-all;font-size:12px;color:#c9a8ff;font-family:monospace">${musicLink}</div>
          </div>
          <p style="margin:0 0 16px;font-size:13px;color:#9b8ec4;text-align:center">Gostou? Fale com a gente!</p>
          ${waUrl ? `<a href="${waUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#25d366,#128c7e);color:#fff;font-weight:800;font-size:15px;padding:14px 24px;border-radius:10px;text-decoration:none">📲 Falar no WhatsApp</a>` : ''}
        </td></tr>
        <tr><td align="center" style="padding-top:20px">
          <p style="margin:0;font-size:12px;color:#4a3d6a">Masters Music · mastersmusic.com.br</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function emailWrapper(content: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:'Helvetica Neue',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:32px 16px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
        <tr><td align="center" style="padding-bottom:28px">
          <div style="font-size:26px;font-weight:900;letter-spacing:-0.5px;color:#fff">
            🎵 <span style="background:linear-gradient(135deg,#a07ce8,#c9a8ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent">Masters Music</span>
          </div>
        </td></tr>
        <tr><td style="background:#13111f;border:1px solid #2a2040;border-radius:16px;padding:32px 28px">
          ${content}
        </td></tr>
        <tr><td align="center" style="padding-top:20px">
          <p style="margin:0;font-size:12px;color:#4a3d6a;line-height:1.6">
            Masters Music · mastersmusic.com.br<br>
            Suporte? Fale pelo WhatsApp se precisar de ajuda.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildWaSupport(waNumber: string, name: string, paymentId: string, value: string): string {
  const num = waNumber.replace(/\D/g, '');
  if (!num) return '';
  const msg = encodeURIComponent(
    `Olá, preciso de suporte com meu pedido.\n\nNome: ${name}\nPedido: ${paymentId}\nValor: R$ ${value}`
  );
  return `https://wa.me/${num.startsWith('55') ? num : '55' + num}?text=${msg}`;
}

export function buildConfirmationEmail(order: Record<string, unknown>, ownerWhatsapp?: string): string {
  const name      = String(order['name'] ?? '').split(' ')[0];
  const ref       = String(order['externalReference'] ?? order['paymentId'] ?? '');
  const paymentId = String(order['paymentId'] ?? ref);
  const value     = Number(order['value'] ?? 29.9).toFixed(2).replace('.', ',');
  const isAuto    = order['source'] === 'auto';
  const waUrl     = buildWaSupport(ownerWhatsapp ?? '', String(order['name'] ?? ''), paymentId, value);

  const products: string[] = ['Música personalizada'];
  if (order['orderBumpExtraVersion']) products.push('Versão extra da música (+1 versão)');
  if (order['orderBumpExtraSongs'])   products.push('2 músicas extras (+2 versões)');
  if (order['orderBumpVideo'])        products.push('Vídeo da música');
  if (order['orderBumpQrCode'])       products.push('QR Code personalizado');

  const productRows = products
    .map(p => `<tr><td style="padding:6px 0;font-size:14px;color:#d4b8ff;border-bottom:1px solid #2a2040">${p}</td></tr>`)
    .join('');

  const prontoUrl = `https://mastersmusic.com.br/pronto?id=${paymentId}`;

  const ctaAuto = `
    <p style="margin:0 0 8px;font-size:14px;color:#9b8ec4;text-align:center;line-height:1.6">
      Sua música está sendo gerada automaticamente. Em alguns minutos ela estará pronta para download.
    </p>
    <p style="margin:0 0 20px;font-size:13px;color:#6b5a8a;text-align:center">
      Você receberá outro email assim que estiver pronta. Ou acesse o link abaixo para acompanhar:
    </p>
    <a href="${prontoUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#7c5cbf,#a855f7);color:#fff;font-weight:800;font-size:15px;padding:14px 24px;border-radius:10px;text-decoration:none;letter-spacing:0.3px;margin-bottom:12px">🎵 Acessar minha música</a>
    ${waUrl ? `<a href="${waUrl}" style="display:block;text-align:center;background:#1a1a2e;border:1px solid #2a2040;color:#9b8ec4;font-size:13px;padding:12px 24px;border-radius:10px;text-decoration:none">📲 Suporte no WhatsApp</a>` : ''}
  `;

  const content = `
    <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#fff">Pagamento confirmado! 🎉</p>
    <p style="margin:0 0 24px;font-size:15px;color:#9b8ec4;line-height:1.6">
      Olá, <strong style="color:#d4b8ff">${name}</strong>! Recebemos seu pagamento com sucesso. ✨
    </p>
    <div style="background:#0f0d1a;border:1px solid #2a2040;border-radius:10px;padding:16px 20px;margin-bottom:24px">
      <p style="margin:0 0 12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b5a8a">Detalhes do pedido</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:13px;color:#9b8ec4;padding-bottom:6px">Pedido</td>
          <td align="right" style="font-size:13px;color:#d4b8ff;font-family:monospace;padding-bottom:6px">${ref}</td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#9b8ec4">Valor pago</td>
          <td align="right" style="font-size:15px;font-weight:800;color:#a07ce8">R$ ${value}</td>
        </tr>
      </table>
    </div>
    <div style="background:#0f0d1a;border:1px solid #2a2040;border-radius:10px;padding:16px 20px;margin-bottom:28px">
      <p style="margin:0 0 10px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b5a8a">Itens adquiridos</p>
      <table width="100%" cellpadding="0" cellspacing="0">${productRows}</table>
    </div>
    ${isAuto ? ctaAuto : (waUrl ? `<a href="${waUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#25d366,#128c7e);color:#fff;font-weight:800;font-size:15px;padding:14px 24px;border-radius:10px;text-decoration:none">📲 Falar no WhatsApp</a>` : '')}
  `;

  return emailWrapper(content);
}

export function buildDeliveryEmail(order: Record<string, unknown>, ownerWhatsapp?: string): string {
  const name      = String(order['name'] ?? '').split(' ')[0];
  const title     = String(order['lyricsTitle'] ?? '');
  const paymentId = String(order['paymentId'] ?? '');
  const value     = Number(order['value'] ?? 29.9).toFixed(2).replace('.', ',');
  const waUrl     = buildWaSupport(ownerWhatsapp ?? '', String(order['name'] ?? ''), paymentId, value);
  const prontoUrl = `https://mastersmusic.com.br/pronto?id=${paymentId}`;
  // Nº de versões compradas: base 1 + versão extra (+1) + 2 músicas extras (+2) → 1 a 4.
  // Suno sempre gera 2 áudios por task, mas só anunciamos o que o cliente realmente comprou.
  const versions  = Math.min(1 + (order['orderBumpExtraVersion'] ? 1 : 0) + (order['orderBumpExtraSongs'] ? 2 : 0), 4);
  const hasMulti  = versions > 1;
  const hasQr     = !!order['orderBumpQrCode'];
  const qrUrl     = `https://mastersmusic.com.br/qr?id=${paymentId}`;

  const qrSection = hasQr ? `
    <div style="background:#0f0d1a;border:1px solid #3a2060;border-radius:12px;padding:20px;margin-bottom:20px;text-align:center">
      <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#a855f7;text-transform:uppercase;letter-spacing:1px">📲 QR Code incluído no seu pedido</p>
      <p style="margin:0 0 14px;font-size:13px;color:#9b8ec4;line-height:1.5">
        Seu QR Code personalizado está pronto! Compartilhe ou imprima para surpreender quem você ama.
      </p>
      <a href="${qrUrl}" style="display:inline-block;background:linear-gradient(135deg,#4c1d95,#7c3aed);color:#fff;font-weight:700;font-size:14px;padding:12px 24px;border-radius:10px;text-decoration:none">
        📱 Ver e Baixar meu QR Code
      </a>
    </div>` : '';

  const content = `
    <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#fff">Sua música está pronta! 🎉</p>
    <p style="margin:0 0 8px;font-size:15px;color:#9b8ec4;line-height:1.6">
      Olá, <strong style="color:#d4b8ff">${name}</strong>! Sua música personalizada foi gerada com sucesso.
    </p>
    ${title ? `<p style="margin:0 0 24px;font-size:14px;color:#c9a8ff;font-style:italic">🎵 "${title}"</p>` : '<p style="margin:0 0 24px"></p>'}
    <a href="${prontoUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#7c5cbf,#a855f7);color:#fff;font-weight:800;font-size:16px;padding:16px 24px;border-radius:12px;text-decoration:none;letter-spacing:0.3px;margin-bottom:${hasMulti ? '12px' : '20px'}">⬇️ Baixar minha música</a>
    ${hasMulti ? `<p style="margin:0 0 20px;font-size:13px;color:#9b8ec4;text-align:center">Seu pedido inclui <strong style="color:#d4b8ff">${versions} versões</strong> — acesse o link acima para baixar todas.</p>` : ''}
    ${qrSection}
    <p style="margin:0 0 16px;font-size:13px;color:#6b5a8a;text-align:center;line-height:1.6">
      Problema no download ou quer solicitar uma edição?
    </p>
    ${waUrl ? `<a href="${waUrl}" style="display:block;text-align:center;background:#1a1a2e;border:1px solid #2a2040;color:#9b8ec4;font-size:13px;padding:12px 24px;border-radius:10px;text-decoration:none">📲 Suporte no WhatsApp</a>` : ''}
    <div style="margin-top:22px;padding-top:18px;border-top:1px solid #2a2040;text-align:center">
      <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#d4b8ff">🎁 Ganhe músicas grátis</p>
      <p style="margin:0 0 12px;font-size:13px;color:#9b8ec4;line-height:1.5">Indique amigos: a cada 3 que comprarem, você ganha 1 música grátis. Veja seus pedidos e seu link de indicação na sua conta.</p>
      <a href="https://mastersmusic.com.br/conta" style="display:inline-block;background:#1a1228;border:1px solid #7c5cbf;color:#c9a8ff;font-weight:700;font-size:14px;padding:11px 22px;border-radius:10px;text-decoration:none">👤 Acessar minha conta</a>
    </div>
  `;

  return emailWrapper(content);
}

// Versão ESPANHOL do email de entrega (mercado LatAm).
export function buildDeliveryEmailES(order: Record<string, unknown>, ownerWhatsapp?: string): string {
  const name      = String(order['name'] ?? '').split(' ')[0];
  const title     = String(order['lyricsTitle'] ?? '');
  const paymentId = String(order['paymentId'] ?? '');
  const value     = Number(order['value'] ?? 27).toFixed(2).replace('.', ',');
  const waUrl     = buildWaSupport(ownerWhatsapp ?? '', String(order['name'] ?? ''), paymentId, value);
  const prontoUrl = `https://mastersmusic.com.br/pronto?id=${paymentId}`;
  const versions  = Math.min(1 + (order['orderBumpExtraVersion'] ? 1 : 0) + (order['orderBumpExtraSongs'] ? 2 : 0), 4);
  const hasMulti  = versions > 1;

  const content = `
    <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#fff">¡Tu canción está lista! 🎉</p>
    <p style="margin:0 0 8px;font-size:15px;color:#9b8ec4;line-height:1.6">
      ¡Hola, <strong style="color:#d4b8ff">${name}</strong>! Tu canción personalizada se creó con éxito.
    </p>
    ${title ? `<p style="margin:0 0 24px;font-size:14px;color:#c9a8ff;font-style:italic">🎵 "${title}"</p>` : '<p style="margin:0 0 24px"></p>'}
    <a href="${prontoUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#7c5cbf,#a855f7);color:#fff;font-weight:800;font-size:16px;padding:16px 24px;border-radius:12px;text-decoration:none;letter-spacing:0.3px;margin-bottom:${hasMulti ? '12px' : '20px'}">⬇️ Descargar mi canción</a>
    ${hasMulti ? `<p style="margin:0 0 20px;font-size:13px;color:#9b8ec4;text-align:center">Tu pedido incluye <strong style="color:#d4b8ff">${versions} versiones</strong> — entra al enlace de arriba para descargarlas todas.</p>` : ''}
    <p style="margin:0 0 16px;font-size:13px;color:#6b5a8a;text-align:center;line-height:1.6">
      ¿Problemas con la descarga o quieres pedir una edición?
    </p>
    ${waUrl ? `<a href="${waUrl}" style="display:block;text-align:center;background:#1a1a2e;border:1px solid #2a2040;color:#9b8ec4;font-size:13px;padding:12px 24px;border-radius:10px;text-decoration:none">📲 Soporte por WhatsApp</a>` : ''}
  `;

  return emailWrapper(content);
}

// Versão ESPANHOL do email de COMPRA APROVADA (pagamento confirmado — mercado LatAm).
// Enviado assim que a Hotmart confirma o pagamento; a música segue por outro email (entrega).
export function buildConfirmationEmailES(order: Record<string, unknown>, ownerWhatsapp?: string): string {
  const name      = String(order['name'] ?? '').split(' ')[0];
  const ref       = String(order['hotmart_transaction'] ?? order['externalReference'] ?? order['paymentId'] ?? '');
  const paymentId = String(order['paymentId'] ?? ref);
  const value     = Number(order['value'] ?? 27).toFixed(2).replace('.', ',');
  const waUrl     = buildWaSupport(ownerWhatsapp ?? '', String(order['name'] ?? ''), paymentId, value);
  const prontoUrl = `https://mastersmusic.com.br/pronto?id=${paymentId}`;

  const content = `
    <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#fff">¡Pago confirmado! 🎉</p>
    <p style="margin:0 0 24px;font-size:15px;color:#9b8ec4;line-height:1.6">
      ¡Hola, <strong style="color:#d4b8ff">${name}</strong>! Recibimos tu pago con éxito. ✨
    </p>
    <div style="background:#0f0d1a;border:1px solid #2a2040;border-radius:10px;padding:16px 20px;margin-bottom:24px">
      <p style="margin:0 0 12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b5a8a">Detalles del pedido</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:13px;color:#9b8ec4;padding-bottom:6px">Pedido</td>
          <td align="right" style="font-size:13px;color:#d4b8ff;font-family:monospace;padding-bottom:6px">${ref}</td>
        </tr>
        <tr>
          <td style="font-size:13px;color:#9b8ec4">Valor pagado</td>
          <td align="right" style="font-size:15px;font-weight:800;color:#a07ce8">US$ ${value}</td>
        </tr>
      </table>
    </div>
    <p style="margin:0 0 8px;font-size:14px;color:#9b8ec4;text-align:center;line-height:1.6">
      Tu canción se está creando automáticamente. En unos minutos estará lista para descargar.
    </p>
    <p style="margin:0 0 20px;font-size:13px;color:#6b5a8a;text-align:center">
      Recibirás otro correo en cuanto esté lista. O entra al enlace de abajo para seguirla:
    </p>
    <a href="${prontoUrl}" style="display:block;text-align:center;background:linear-gradient(135deg,#7c5cbf,#a855f7);color:#fff;font-weight:800;font-size:15px;padding:14px 24px;border-radius:10px;text-decoration:none;letter-spacing:0.3px;margin-bottom:12px">🎵 Seguir mi canción</a>
    ${waUrl ? `<a href="${waUrl}" style="display:block;text-align:center;background:#1a1a2e;border:1px solid #2a2040;color:#9b8ec4;font-size:13px;padding:12px 24px;border-radius:10px;text-decoration:none">📲 Soporte por WhatsApp</a>` : ''}
  `;

  return emailWrapper(content);
}

// Email de novidade: área do cliente + programa de indicação (broadcast único).
export function buildAnnouncementEmail(firstName?: string): string {
  const nome = (firstName || '').trim();
  const ola = nome ? `Olá, <strong style="color:#d4b8ff">${nome}</strong>!` : 'Olá!';
  const content = `
    <p style="margin:0 0 8px;font-size:22px;font-weight:800;color:#fff">Novidade na Masters Music! 🎉</p>
    <p style="margin:0 0 18px;font-size:15px;color:#9b8ec4;line-height:1.6">
      ${ola} Agora você tem uma <strong style="color:#d4b8ff">Área do Cliente</strong> — um lugar só seu na Masters Music.
    </p>
    <div style="background:#0f0d1a;border:1px solid #2a2040;border-radius:12px;padding:18px 20px;margin-bottom:20px">
      <p style="margin:0 0 12px;font-size:15px;color:#fff;font-weight:700">Lá dentro você pode:</p>
      <p style="margin:0 0 8px;font-size:14px;color:#c9b8e8;line-height:1.6">🎵 Ver <strong>todos os seus pedidos</strong> e baixar suas músicas quando quiser</p>
      <p style="margin:0 0 8px;font-size:14px;color:#c9b8e8;line-height:1.6">🎁 Pegar seu <strong>link de indicação</strong></p>
      <p style="margin:0;font-size:14px;color:#c9b8e8;line-height:1.6">💬 Falar com o suporte</p>
    </div>
    <div style="background:#1a1228;border:1px solid #3a2060;border-radius:12px;padding:18px 20px;margin-bottom:22px;text-align:center">
      <p style="margin:0 0 6px;font-size:15px;font-weight:800;color:#a855f7">🎁 Indique e ganhe músicas grátis</p>
      <p style="margin:0;font-size:14px;color:#c9b8e8;line-height:1.6">A cada <strong style="color:#fff">3 amigos</strong> que comprarem pelo seu link, você ganha <strong style="color:#fff">1 música grátis</strong>!</p>
    </div>
    <a href="https://mastersmusic.com.br/conta" style="display:block;text-align:center;background:linear-gradient(135deg,#7c5cbf,#a855f7);color:#fff;font-weight:800;font-size:16px;padding:16px 24px;border-radius:12px;text-decoration:none;letter-spacing:0.3px;margin-bottom:14px">👤 Acessar minha conta</a>
    <p style="margin:0;font-size:12px;color:#6b5a8a;text-align:center;line-height:1.6">
      Acesse com o email desta mensagem em <strong style="color:#9b8ec4">mastersmusic.com.br/conta</strong> — é só pedir o código de acesso.
    </p>
  `;
  return emailWrapper(content);
}
