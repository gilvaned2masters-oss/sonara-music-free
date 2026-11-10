interface Env { ORDERS_KV: KVNamespace; }

function html(content: string, cache = 60): Response {
  return new Response(content, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': `public, max-age=${cache}` },
  });
}

function parseBrief(brief: string): Record<string, string> {
  const r: Record<string, string> = {};
  const labels: [string, string][] = [
    ['Para quem','para'],['Relacionamento','rel'],['Ocasião','ocasiao'],
    ['Estilo','estilo'],['Voz','voz'],['História','historia'],
    ['Letra gerada/editada','letra'],
  ];
  let norm = brief;
  labels.forEach(([label]) => {
    norm = norm.replace(new RegExp(`(?<=[^ ]) (${label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}: )`,'g'),'\n$1');
  });
  const lines = norm.split('\n');
  let ck = '', buf: string[] = [];
  for (const line of lines) {
    let matched = false;
    for (const [label, key] of labels) {
      if (line.startsWith(label + ': ')) {
        if (ck) r[ck] = buf.join('\n').trim();
        ck = key; buf = [line.slice(label.length + 2)]; matched = true; break;
      }
    }
    if (!matched && ck) buf.push(line);
  }
  if (ck) r[ck] = buf.join('\n').trim();
  return r;
}

type Theme = { bg: string; accent: string; accentDark: string; emoji: string; label: string; particles: string };
function getTheme(ocasiao: string): Theme {
  const o = (ocasiao||'').toLowerCase();
  if (o.includes('namorad')) return { bg:'linear-gradient(135deg,#1a0010,#2d0020,#1a0010)', accent:'#ff4d8d', accentDark:'#c4005e', emoji:'❤️', label:'Dia dos Namorados', particles:'❤️💕🌹' };
  if (o.includes('anivers')) return { bg:'linear-gradient(135deg,#0a0a1a,#1a0a2e,#0a0a1a)', accent:'#f59e0b', accentDark:'#b45309', emoji:'🎂', label:'Feliz Aniversário', particles:'🎂🎈✨' };
  if (o.includes('casamento')||o.includes('pedido')) return { bg:'linear-gradient(135deg,#0f0f0f,#1a1a1a,#0f0f0f)', accent:'#e8d5b7', accentDark:'#9e7c4a', emoji:'💍', label:'Casamento', particles:'💍🌸🕊️' };
  if (o.includes('mã')||o.includes('mae')) return { bg:'linear-gradient(135deg,#1a0a14,#2a1020,#1a0a14)', accent:'#f472b6', accentDark:'#be185d', emoji:'🌸', label:'Dia das Mães', particles:'🌸💐🤍' };
  if (o.includes('pai')) return { bg:'linear-gradient(135deg,#0a1020,#0f1a30,#0a1020)', accent:'#60a5fa', accentDark:'#1d4ed8', emoji:'⭐', label:'Dia dos Pais', particles:'⭐🎖️💙' };
  if (o.includes('natal')) return { bg:'linear-gradient(135deg,#0a1a0a,#0f2010,#0a1a0a)', accent:'#ef4444', accentDark:'#991b1b', emoji:'🎄', label:'Natal', particles:'🎄⭐❄️' };
  return { bg:'linear-gradient(135deg,#0f0f13,#1a1228,#0f0f13)', accent:'#a07ce8', accentDark:'#6d28d9', emoji:'🎵', label:'Música Especial', particles:'🎵💜✨' };
}

function esc(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function notFoundPage(): Response {
  return html(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Masters Music</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0f0f13;color:#888;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px}</style>
</head><body><div><div style="font-size:52px;margin-bottom:16px">🎵</div><p style="font-size:18px;color:#ccc;margin-bottom:8px">Música ainda em produção</p><p style="font-size:14px">Nossa equipe está finalizando com carinho. Tente novamente em breve.</p><p style="margin-top:20px;font-size:13px"><a href="/" style="color:#a07ce8">Criar minha música</a></p></div></body></html>`);
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const id = (context.params.id as string || '').replace(/[^a-zA-Z0-9_.-]/g,'');
  if (!id) return notFoundPage();

  const raw = await context.env.ORDERS_KV.get('order:' + id);
  if (!raw) return notFoundPage();

  const order = JSON.parse(raw) as Record<string, unknown>;

  // Prioridade: audioUrl (Kie.ai) → mp3_url (Sunor) → musicLink (upload manual)
  const audioUrl  = String(order['audioUrl']  || order['mp3_url'] || order['musicLink'] || '');
  if (!audioUrl) return notFoundPage();

  // Marcar como entregue automaticamente ao acessar a página
  if (!order['delivered']) {
    order['delivered'] = true;
    order['deliveredAt'] = new Date().toISOString();
    context.waitUntil(
      context.env.ORDERS_KV.put('order:' + id, JSON.stringify(order), { expirationTtl: 86400 * 30 })
    );
  }

  const bumpVersion   = order['orderBumpExtraVersion'] === true;
  const bumpSongs     = order['orderBumpExtraSongs']   === true;
  const bumpVideo     = order['orderBumpVideo']        === true;
  const bumpQrCode    = order['orderBumpQrCode']       === true;

  // Versões compradas: base 1 + versão extra (+1) + 2 músicas extras (+2) → 1 a 4.
  const versions  = Math.min(1 + (bumpVersion ? 1 : 0) + (bumpSongs ? 2 : 0), 4);
  // URLs das versões extras (2..4), só as compradas
  const extraUrls = [
    String(order['mp3_url_2'] || order['audioUrl2'] || ''),
    String(order['mp3_url_3'] || ''),
    String(order['mp3_url_4'] || ''),
  ].slice(0, versions - 1).filter(Boolean);

  const b          = parseBrief(String(order['brief'] || ''));
  const savedLetra = String(order['savedLetra'] || b['letra'] || '').trim();
  const para       = b['para']    || 'você';
  const ocasiao    = b['ocasiao'] || '';
  const estilo     = b['estilo']  || '';
  const buyerName  = String(order['name']  || '').split(' ')[0] || 'cliente';
  const buyerEmail = String(order['email'] || '');
  const buyerPhone = String(order['phone'] || '');
  const theme      = getTheme(ocasiao);
  const duration   = order['duration'] ? String(order['duration']) : '';

  // Título da música
  let songTitle = 'Nossa História';
  if (savedLetra) {
    const m = savedLetra.match(/^T[íi]tulo:\s*(.+)/im);
    if (m) songTitle = m[1].trim().replace(/^T[íi]tulo:\s*/i,'');
  }

  // Letra limpa (sem linha de título)
  const letraLimpa = savedLetra.replace(/^T[íi]tulo:.*\n?/im,'').trim();

  const downloadName  = `masters-${esc(para).toLowerCase().replace(/\s+/g,'-')}.mp3`;

  // Para URLs relativas (pedidos manuais), usa direto; para absolutas, passa pelo proxy /download
  function dlHref(url: string, name: string): string {
    if (!url) return '#';
    if (url.startsWith('/')) return url;
    return `/download?url=${encodeURIComponent(url)}&title=${encodeURIComponent(name.replace('.mp3',''))}`;
  }

  // QR Code URL (api pública, sem key)
  const deliveryUrl  = `https://mastersmusic.com.br/m/${id}`;
  const qrCodeUrl    = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&color=ffffff&bgcolor=${theme.accent.replace('#','')}&data=${encodeURIComponent(deliveryUrl)}`;

  const page = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<meta property="og:title" content="🎵 Uma música criada para ${esc(para)}">
<meta property="og:description" content="Presente musical de ${esc(buyerName)} — Masters Music">
<title>${esc(songTitle)} — Masters Music</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;-webkit-font-smoothing:antialiased}
body{background:${theme.bg};color:#fff;display:flex;flex-direction:column;align-items:center;padding:20px 16px 60px;position:relative;overflow-x:hidden}

/* Particles */
.parts{position:fixed;inset:0;pointer-events:none;z-index:0;overflow:hidden}
.p{position:absolute;animation:fall linear infinite;opacity:.12}
@keyframes fall{0%{transform:translateY(-60px) rotate(0deg);opacity:.12}100%{transform:translateY(110vh) rotate(360deg);opacity:0}}

.wrap{position:relative;z-index:1;width:100%;max-width:420px;display:flex;flex-direction:column;gap:16px}

/* Header */
.success-header{text-align:center;padding:24px 0 8px}
.success-badge{display:inline-block;background:${theme.accent};color:#fff;font-size:11px;font-weight:900;letter-spacing:1.5px;padding:4px 14px;border-radius:999px;margin-bottom:12px;text-transform:uppercase}
.success-icon{font-size:48px;margin-bottom:10px;animation:pop .6s cubic-bezier(.17,.67,.35,1.3)}
@keyframes pop{0%{transform:scale(0)}100%{transform:scale(1)}}
.success-title{font-size:26px;font-weight:900;line-height:1.2;margin-bottom:8px;letter-spacing:-.3px}
.success-sub{font-size:15px;color:rgba(255,255,255,.65);line-height:1.6}
.success-sub strong{color:${theme.accent};font-weight:900}

/* Seção label */
.section-label{font-size:11px;font-weight:900;letter-spacing:1.5px;color:rgba(255,255,255,.4);text-transform:uppercase;margin-bottom:8px;padding-left:2px}

/* Card */
.card{background:rgba(255,255,255,.06);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.12);border-radius:22px;padding:22px}

/* Player */
.song-title{font-size:19px;font-weight:900;margin-bottom:16px;color:#fff;text-align:center;line-height:1.3}
.song-title span{color:${theme.accent}}
.vinyl-wrap{display:flex;justify-content:center;margin-bottom:16px;position:relative}
.vinyl{width:96px;height:96px;border-radius:50%;background:radial-gradient(circle,#444 28%,#111 28%,#111 42%,${theme.accent}55 42%,${theme.accent}55 44%,#111 44%,#111 52%,${theme.accent}25 52%,${theme.accent}25 54%,#111 54%);box-shadow:0 10px 40px rgba(0,0,0,.7),0 0 0 3px ${theme.accent}33}
.vinyl.playing{animation:spin 3s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.player-controls{display:flex;align-items:center;justify-content:center;gap:18px;margin-bottom:14px}
.play-btn{width:58px;height:58px;border-radius:50%;border:2.5px solid ${theme.accent};background:transparent;color:${theme.accent};font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0}
.play-btn:hover,.play-btn.playing{background:${theme.accent}33}
.time-info{text-align:left}
.time-cur{font-size:22px;font-weight:900;color:#fff;font-variant-numeric:tabular-nums;line-height:1}
.time-total{font-size:13px;color:rgba(255,255,255,.4);margin-top:2px}
.prog-wrap{margin-bottom:8px;cursor:pointer;padding:6px 0}
.prog-bar{height:5px;background:rgba(255,255,255,.12);border-radius:3px;overflow:hidden}
.prog-fill{height:100%;background:linear-gradient(90deg,${theme.accentDark},${theme.accent});width:0%;border-radius:3px;transition:width .4s linear}
.waves{display:flex;align-items:center;justify-content:center;gap:3px;height:28px;margin-bottom:10px}
.wave{width:3px;border-radius:2px;background:${theme.accent};opacity:.3;animation:wv 1.2s ease-in-out infinite}
.wave.on{opacity:.85}
@keyframes wv{0%,100%{height:3px}50%{height:20px}}
.wave:nth-child(1){animation-delay:0s}.wave:nth-child(2){animation-delay:.1s}.wave:nth-child(3){animation-delay:.2s}.wave:nth-child(4){animation-delay:.3s}.wave:nth-child(5){animation-delay:.4s}.wave:nth-child(6){animation-delay:.3s}.wave:nth-child(7){animation-delay:.2s}.wave:nth-child(8){animation-delay:.1s}
.version-badge{display:inline-block;background:${theme.accent}22;border:1px solid ${theme.accent}44;color:${theme.accent};font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;margin-bottom:10px}

/* Download */
.dl-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;padding:17px;border-radius:16px;border:0;background:linear-gradient(135deg,${theme.accentDark},${theme.accent});color:#fff;font-weight:900;font-size:17px;cursor:pointer;text-decoration:none;box-shadow:0 10px 30px rgba(0,0,0,.35);transition:opacity .15s;letter-spacing:-.2px}
.dl-btn:active{opacity:.85}
.dl-hint{text-align:center;font-size:13px;color:rgba(255,255,255,.4);margin-top:8px}

/* Bump cards */
.bump-card{background:rgba(255,255,255,.04);border:1px solid ${theme.accent}33;border-radius:18px;overflow:hidden}
.bump-head{background:linear-gradient(135deg,${theme.accent}22,${theme.accent}11);padding:14px 18px;display:flex;align-items:center;gap:12px;border-bottom:1px solid ${theme.accent}22}
.bump-icon{font-size:26px;flex-shrink:0}
.bump-head-title{font-size:15px;font-weight:900;color:#fff;line-height:1.2}
.bump-head-sub{font-size:12px;color:rgba(255,255,255,.5);margin-top:2px}
.bump-body{padding:16px 18px}

/* Arte upsell */
.lyrics-canvas-wrap{background:linear-gradient(160deg,#1a0f2e,#0f1628);border-radius:12px;padding:18px;min-height:140px;position:relative;margin-bottom:12px}
.lyrics-canvas-title{font-size:14px;font-weight:900;color:${theme.accent};margin-bottom:10px;letter-spacing:.5px}
.lyrics-canvas-text{font-size:13px;line-height:1.8;color:rgba(255,255,255,.8);white-space:pre-line;display:-webkit-box;-webkit-line-clamp:7;-webkit-box-orient:vertical;overflow:hidden}
.lyrics-watermark{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
.lyrics-watermark span{font-size:44px;font-weight:900;color:rgba(255,255,255,.06);transform:rotate(-28deg);letter-spacing:6px;user-select:none}
.lyrics-watermark.hidden{display:none}
.bump-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:14px;border-radius:14px;border:0;background:${theme.accent};color:#fff;font-weight:900;font-size:15px;cursor:pointer;transition:opacity .15s}
.bump-btn:hover{opacity:.85}
.bump-btn-outline{display:none;align-items:center;justify-content:center;gap:8px;width:100%;padding:14px;border-radius:14px;border:2px solid ${theme.accent};color:${theme.accent};font-weight:900;font-size:15px;cursor:pointer;background:transparent;transition:opacity .15s}
.bump-btn-outline.show{display:flex}

/* QR Code */
.qr-wrap{text-align:center;padding:8px 0 4px}
.qr-img{width:180px;height:180px;border-radius:16px;background:#fff;padding:10px;margin:0 auto 12px;display:block}
.qr-url{font-size:12px;color:rgba(255,255,255,.4);word-break:break-all;text-align:center;margin-bottom:12px}

/* WhatsApp */
.wa-link{display:flex;align-items:center;justify-content:center;gap:10px;padding:15px;border-radius:14px;background:rgba(37,211,102,.12);border:1px solid rgba(37,211,102,.25);color:#4ade80;text-decoration:none;font-weight:700;font-size:15px;transition:background .15s}
.wa-link:hover{background:rgba(37,211,102,.22)}

/* Footer */
.footer{text-align:center;font-size:12px;color:rgba(255,255,255,.18);margin-top:12px}
.footer a{color:${theme.accent};opacity:.5;text-decoration:none}
</style>
  <script>
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
  document,'script','https://connect.facebook.net/en_US/fbevents.js');
  fbq('init','4090193661124064');fbq('track','PageView');
  </script>
  <noscript><img height="1" width="1" style="display:none"
  src="https://www.facebook.com/tr?id=4090193661124064&ev=PageView&noscript=1"></noscript>
</head>
<body>
<div class="parts" id="parts"></div>
<audio id="audio" preload="metadata"><source src="${esc(audioUrl)}" type="audio/mpeg"></audio>

<div class="wrap">

  <!-- HEADER -->
  <div class="success-header">
    <div class="success-badge">${theme.label}</div>
    <div class="success-icon" style="animation:pop .7s cubic-bezier(.17,.67,.35,1.4)">${theme.emoji}</div>
    <div class="success-title">Uma música especial<br>para você, ${esc(para)}!</div>
    <div class="success-sub">Com todo amor de <strong>${esc(buyerName)}</strong> 💕</div>
  </div>

  <!-- PLAYER VERSÃO 1 -->
  <div class="section-label">🎵 ${extraUrls.length ? 'Versão 1' : 'Sua música'}</div>
  <div class="card">
    ${extraUrls.length ? '<div class="version-badge">Versão 1</div>' : ''}
    <div class="song-title"><span>${esc(songTitle)}</span></div>
    <div class="vinyl-wrap"><div class="vinyl" id="vinyl"></div></div>
    <div class="waves" id="waves">${Array(8).fill(0).map((_,i)=>`<div class="wave" style="animation-delay:${i*.1}s"></div>`).join('')}</div>
    <div class="player-controls">
      <button class="play-btn" id="playBtn" aria-label="Play">▶</button>
      <div class="time-info">
        <div class="time-cur" id="timeCur">0:00</div>
        <div class="time-total" id="timeTotal">${duration ? '/ ' + Math.floor(Number(duration)/60) + ':' + String(Math.floor(Number(duration)%60)).padStart(2,'0') : '--:--'}</div>
      </div>
    </div>
    <div class="prog-wrap" id="progWrap"><div class="prog-bar"><div class="prog-fill" id="progFill"></div></div></div>
  </div>
  <div>
    <a class="dl-btn" href="${dlHref(audioUrl, downloadName)}" download="${downloadName}">⬇ Baixar música completa</a>
    ${buyerEmail ? `<div class="dl-hint">📧 Download também enviado para ${esc(buyerEmail)}</div>` : ''}
  </div>

  ${extraUrls.map((u, i) => {
    const v = i + 2;
    const dlName = `masters-${esc(para).toLowerCase().replace(/\s+/g,'-')}-v${v}.mp3`;
    return `
  <!-- VERSÃO ${v} (comprada) -->
  <div class="section-label" style="margin-top:8px">🎵 Versão ${v}</div>
  <div class="card">
    <div class="version-badge">Versão ${v} — Alternativa</div>
    <div class="song-title" style="color:rgba(255,255,255,.8)"><span>${esc(songTitle)}</span></div>
    <audio controls preload="metadata" src="${esc(u)}" style="width:100%;margin-top:8px"></audio>
  </div>
  <div>
    <a class="dl-btn" href="${dlHref(u, dlName)}" download="${dlName}" style="background:linear-gradient(135deg,rgba(255,255,255,.1),rgba(255,255,255,.06));border:1px solid rgba(255,255,255,.15);box-shadow:none">⬇ Baixar versão ${v}</a>
  </div>`;
  }).join('')}

  ${letraLimpa ? `
  <!-- UPSELL ARTE DA LETRA -->
  <div class="section-label" style="margin-top:8px">🎨 Arte personalizada</div>
  <div class="bump-card">
    <div class="bump-head">
      <div class="bump-icon">🎨</div>
      <div>
        <div class="bump-head-title">Transforme a letra em arte para presentear</div>
        <div class="bump-head-sub">Imagem 9:16 com foto temática — salve no celular</div>
      </div>
    </div>
    <div class="bump-body">
      <div class="lyrics-canvas-wrap" id="lyricsCard">
        <div class="lyrics-canvas-title">♪ ${esc(songTitle)}</div>
        <div class="lyrics-canvas-text">${esc(letraLimpa)}</div>
        <div class="lyrics-watermark" id="artWatermark"><span>PRÉVIA</span></div>
      </div>
      <button class="bump-btn" id="artBuyBtn" onclick="handleArtBuy()">🎨 Comprar arte por R$9,00</button>
      <button class="bump-btn-outline" id="artDlBtn" onclick="downloadArt()">⬇ Baixar arte da letra</button>
    </div>
  </div>` : ''}

  ${bumpQrCode ? `
  <!-- QR CODE (bump) -->
  <div class="section-label" style="margin-top:8px">📲 QR Code personalizado</div>
  <div class="bump-card">
    <div class="bump-head">
      <div class="bump-icon">📲</div>
      <div>
        <div class="bump-head-title">QR Code para presentear ${esc(para)}</div>
        <div class="bump-head-sub">Aponte a câmera para ouvir a música diretamente</div>
      </div>
    </div>
    <div class="bump-body">
      <div class="qr-wrap">
        <img class="qr-img" src="${qrCodeUrl}" alt="QR Code" loading="lazy">
        <div class="qr-url">${deliveryUrl}</div>
        <a class="dl-btn" href="${qrCodeUrl}" download="qrcode-${esc(para).toLowerCase().replace(/\s+/g,'-')}-masters.png" style="font-size:15px;padding:14px">⬇ Baixar QR Code</a>
      </div>
    </div>
  </div>` : ''}

  ${bumpSongs ? `
  <!-- MÚSICAS EXTRAS (bump) -->
  <div class="section-label" style="margin-top:8px">🎵 Suas 2 músicas extras</div>
  <div class="bump-card">
    <div class="bump-head">
      <div class="bump-icon">🎁</div>
      <div>
        <div class="bump-head-title">2 músicas extras incluídas</div>
        <div class="bump-head-sub">Presenteie mais 2 pessoas com músicas personalizadas</div>
      </div>
    </div>
    <div class="bump-body">
      <p style="font-size:14px;color:rgba(255,255,255,.7);line-height:1.6;margin-bottom:14px">Para gerar suas 2 músicas extras, envie os briefings pelo WhatsApp. Nossa equipe irá criar cada música com carinho.</p>
      <a class="dl-btn" href="https://wa.me/554188869695?text=${encodeURIComponent('Olá! Comprei o pacote com 2 músicas extras. Pedido: ' + id + '. Quero enviar os detalhes das músicas.')}" target="_blank" rel="noopener" style="font-size:15px;padding:14px;background:linear-gradient(135deg,#16a34a,#22c55e)">📲 Solicitar músicas extras</a>
    </div>
  </div>` : ''}

  ${bumpVideo ? `
  <!-- VÍDEO (bump) — entrega manual -->
  <div class="section-label" style="margin-top:8px">🎬 Vídeo da música</div>
  <div class="bump-card">
    <div class="bump-head">
      <div class="bump-icon">🎬</div>
      <div>
        <div class="bump-head-title">Vídeo personalizado em produção</div>
        <div class="bump-head-sub">Será entregue pelo WhatsApp em até 24h</div>
      </div>
    </div>
    <div class="bump-body">
      <div style="background:rgba(255,255,255,.04);border-radius:12px;padding:14px;margin-bottom:14px;display:flex;align-items:center;gap:12px">
        <div style="font-size:28px">⏳</div>
        <div>
          <div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:3px">Produção em andamento</div>
          <div style="font-size:13px;color:rgba(255,255,255,.5);">Nossa equipe está montando o vídeo com sua música e imagens temáticas.</div>
        </div>
      </div>
      <a class="dl-btn" href="https://wa.me/554188869695?text=${encodeURIComponent('Olá! Quero verificar o status do meu vídeo. Pedido: ' + id)}" target="_blank" rel="noopener" style="font-size:15px;padding:14px;background:linear-gradient(135deg,#16a34a,#22c55e)">📲 Verificar status do vídeo</a>
    </div>
  </div>` : ''}

  <!-- Modal PIX Arte -->
  <div id="artPixModal" style="display:none;position:fixed;inset:0;z-index:999;background:rgba(0,0,0,.88);align-items:center;justify-content:center;padding:20px">
    <div style="background:#1a1228;border:1px solid ${theme.accent}55;border-radius:22px;padding:28px;width:100%;max-width:360px;text-align:center">
      <div style="font-size:28px;margin-bottom:8px">🎨</div>
      <div style="font-size:18px;font-weight:900;color:#fff;margin-bottom:4px">Arte da letra — R$9,00</div>
      <div style="font-size:13px;color:rgba(255,255,255,.5);margin-bottom:18px">Escaneie o QR ou copie o código PIX</div>
      <img id="artPixQr" src="" alt="QR Code" style="width:190px;height:190px;border-radius:14px;margin-bottom:16px;background:#fff;padding:8px;display:block;margin-left:auto;margin-right:auto">
      <input id="artPixPayload" readonly style="display:none">
      <button onclick="copyArtPix()" id="artCopyBtn" style="width:100%;padding:14px;border-radius:12px;border:0;background:${theme.accent};color:#fff;font-weight:900;font-size:15px;cursor:pointer;margin-bottom:10px">📋 Copiar código PIX</button>
      <div style="font-size:13px;color:rgba(255,255,255,.35);margin-bottom:16px">Aguardando confirmação do pagamento...</div>
      <button onclick="closeArtPix()" style="background:transparent;border:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.4);padding:10px 24px;border-radius:10px;font-size:13px;cursor:pointer">Cancelar</button>
    </div>
  </div>

  <!-- SUPORTE -->
  <a class="wa-link" href="https://wa.me/554188869695?text=${encodeURIComponent('Olá! Preciso de ajuda com minha música. Pedido: ' + id)}" target="_blank" rel="noopener">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.138.564 4.139 1.544 5.871L0 24l6.335-1.52A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.908 0-3.703-.498-5.258-1.373l-.375-.22-3.766.904.952-3.68-.244-.386A9.96 9.96 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
    Precisa de ajuda? Fale pelo WhatsApp
  </a>

  <div class="footer">Criado com ❤️ por <a href="/">Masters Music</a></div>
</div>

<script>
// Particles
(function(){
  var emojis='${theme.particles}'.split('');
  var wrap=document.getElementById('parts');
  for(var i=0;i<16;i++){
    var el=document.createElement('div');
    el.className='p';
    el.textContent=emojis[i%emojis.length];
    el.style.cssText='left:'+(Math.random()*100)+'%;font-size:'+(14+Math.random()*14)+'px;animation-duration:'+(7+Math.random()*10)+'s;animation-delay:'+(Math.random()*8)+'s';
    wrap.appendChild(el);
  }
})();

function fmt(s){var m=Math.floor(s/60),sec=Math.floor(s%60);return m+':'+(sec<10?'0':'')+sec;}

function makePlayer(audioId,playBtnId,vinylId,wavesId,progFillId,timeCurId,progWrapId){
  var audio=document.getElementById(audioId);
  var playBtn=document.getElementById(playBtnId);
  var vinyl=document.getElementById(vinylId);
  var waves=document.querySelectorAll('#'+wavesId+' .wave');
  var progFill=document.getElementById(progFillId);
  var timeCur=document.getElementById(timeCurId);
  var progWrap=document.getElementById(progWrapId);
  if(!audio||!playBtn)return;
  var playing=false;
  audio.addEventListener('timeupdate',function(){
    if(!audio.duration)return;
    if(progFill)progFill.style.width=(audio.currentTime/audio.duration*100)+'%';
    if(timeCur)timeCur.textContent=fmt(audio.currentTime);
  });
  audio.addEventListener('ended',function(){
    playing=false;playBtn.textContent='▶';playBtn.classList.remove('playing');
    if(vinyl)vinyl.classList.remove('playing');
    waves.forEach(function(w){w.classList.remove('on');});
  });
  playBtn.addEventListener('click',function(){
    if(playing){
      audio.pause();playBtn.textContent='▶';playBtn.classList.remove('playing');
      if(vinyl)vinyl.classList.remove('playing');
      waves.forEach(function(w){w.classList.remove('on');});
    }else{
      audio.play().catch(function(){});
      playBtn.textContent='⏸';playBtn.classList.add('playing');
      if(vinyl)vinyl.classList.add('playing');
      waves.forEach(function(w){w.classList.add('on');});
    }
    playing=!playing;
  });
  if(progWrap){
    progWrap.addEventListener('click',function(e){
      if(!audio.duration)return;
      var rect=progWrap.getBoundingClientRect();
      audio.currentTime=((e.clientX-rect.left)/rect.width)*audio.duration;
    });
  }
}

makePlayer('audio','playBtn','vinyl','waves','progFill','timeCur','progWrap');

// Art upsell — PIX real
var artUnlocked=false;
var artPollTimer=null;
var artPaymentId=null;

function handleArtBuy(){
  var btn=document.getElementById('artBuyBtn');
  if(btn){btn.disabled=true;btn.textContent='Gerando PIX...';}
  fetch('/art-payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:'${id}'})})
  .then(function(r){return r.json();})
  .then(function(d){
    if(d.alreadyPaid){unlockArt();return;}
    if(!d.ok||!d.payload){
      if(btn){btn.disabled=false;btn.textContent='🎨 Comprar arte por R\$9,00';}
      alert('Erro ao gerar PIX. Tente novamente.');return;
    }
    artPaymentId=d.paymentId;
    showArtPix(d.encodedImage,d.payload);
    startArtPolling();
  })
  .catch(function(){
    if(btn){btn.disabled=false;btn.textContent='🎨 Comprar arte por R\$9,00';}
    alert('Erro de conexão. Tente novamente.');
  });
}

function showArtPix(encodedImage,payload){
  var modal=document.getElementById('artPixModal');
  if(!modal)return;
  var img=document.getElementById('artPixQr');
  var inp=document.getElementById('artPixPayload');
  if(img&&encodedImage)img.src='data:image/png;base64,'+encodedImage;
  if(inp)inp.value=payload||'';
  modal.style.display='flex';
}

function closeArtPix(){
  var modal=document.getElementById('artPixModal');
  if(modal)modal.style.display='none';
  if(artPollTimer){clearInterval(artPollTimer);artPollTimer=null;}
  var btn=document.getElementById('artBuyBtn');
  if(btn&&!artUnlocked){btn.disabled=false;btn.textContent='🎨 Comprar arte por R\$9,00';}
}

function copyArtPix(){
  var inp=document.getElementById('artPixPayload');
  if(!inp)return;
  navigator.clipboard.writeText(inp.value).catch(function(){inp.select();document.execCommand('copy');});
  var btn=document.getElementById('artCopyBtn');
  if(btn){btn.textContent='✓ Copiado!';setTimeout(function(){btn.textContent='📋 Copiar código';},2000);}
}

function startArtPolling(){
  if(artPollTimer)clearInterval(artPollTimer);
  var attempts=0;
  artPollTimer=setInterval(function(){
    attempts++;
    fetch('/art-status?orderId=${id}',{cache:'no-store'})
    .then(function(r){return r.json();})
    .then(function(d){
      if(d.paid){
        clearInterval(artPollTimer);artPollTimer=null;
        closeArtPix();
        unlockArt();
      }
    }).catch(function(){});
    if(attempts>=36){clearInterval(artPollTimer);artPollTimer=null;}
  },6000);
}

function unlockArt(){
  artUnlocked=true;
  var wm=document.getElementById('artWatermark');
  var buyBtn=document.getElementById('artBuyBtn');
  var dlBtn=document.getElementById('artDlBtn');
  if(wm)wm.classList.add('hidden');
  if(buyBtn)buyBtn.style.display='none';
  if(dlBtn)dlBtn.classList.add('show');
}

// Fotos de fundo por ocasião (Unsplash — uso livre)
var ART_BACKGROUNDS={
  'namorad':'https://images.unsplash.com/photo-1518621736915-f3b1c41bfd00?w=800&q=80',
  'casamento':'https://images.unsplash.com/photo-1519741497674-611481863552?w=800&q=80',
  'pedido':'https://images.unsplash.com/photo-1519741497674-611481863552?w=800&q=80',
  'anivers':'https://images.unsplash.com/photo-1464349153735-7db50ed83c84?w=800&q=80',
  'mae':'https://images.unsplash.com/photo-1518621736915-f3b1c41bfd00?w=800&q=80',
  'pai':'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&q=80',
  'natal':'https://images.unsplash.com/photo-1512389142860-9c449e58a543?w=800&q=80',
  'default':'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&q=80'
};

function getArtBg(){
  var oc='${esc(ocasiao)}'.toLowerCase();
  for(var k in ART_BACKGROUNDS){if(k!=='default'&&oc.includes(k))return ART_BACKGROUNDS[k];}
  return ART_BACKGROUNDS['default'];
}

function wrapText(ctx,text,x,y,maxWidth,lineHeight){
  var words=text.split(' ');var line='';var lines=[];
  for(var i=0;i<words.length;i++){
    var test=line+(line?'  ':'')+words[i];
    if(ctx.measureText(test).width>maxWidth&&line){lines.push(line);line=words[i];}
    else{line=test;}
  }
  if(line)lines.push(line);
  lines.forEach(function(l,i){ctx.fillText(l,x,y+i*lineHeight);});
  return lines.length;
}

function downloadArt(){
  var dlBtn=document.getElementById('artDlBtn');
  if(dlBtn){dlBtn.disabled=true;dlBtn.textContent='Gerando arte...';}

  var img=new Image();
  img.crossOrigin='anonymous';
  img.onload=function(){
    var canvas=document.createElement('canvas');
    // Formato Stories (9:16)
    canvas.width=1080;canvas.height=1920;
    var ctx=canvas.getContext('2d');

    // 1. Foto de fundo — cobrir o canvas
    var scale=Math.max(canvas.width/img.width,canvas.height/img.height);
    var sw=img.width*scale,sh=img.height*scale;
    var sx=(canvas.width-sw)/2,sy=(canvas.height-sh)/2;
    ctx.drawImage(img,sx,sy,sw,sh);

    // 2. Overlay escuro degradê para legibilidade
    var ov=ctx.createLinearGradient(0,0,0,canvas.height);
    ov.addColorStop(0,'rgba(0,0,0,0.45)');
    ov.addColorStop(0.3,'rgba(0,0,0,0.55)');
    ov.addColorStop(1,'rgba(0,0,0,0.80)');
    ctx.fillStyle=ov;ctx.fillRect(0,0,canvas.width,canvas.height);

    // 3. Painel central semi-transparente
    var px=80,py=340,pw=canvas.width-160,ph=canvas.height-520;
    ctx.fillStyle='rgba(0,0,0,0.38)';
    roundRect(ctx,px,py,pw,ph,24);ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.18)';ctx.lineWidth=1.5;
    roundRect(ctx,px,py,pw,ph,24);ctx.stroke();

    // 4. Ícone de nota musical
    ctx.font='bold 52px serif';ctx.textAlign='center';ctx.fillStyle='${theme.accent}';
    ctx.fillText('♪',canvas.width/2,py+70);

    // 5. Título
    ctx.font='bold 44px Georgia,serif';ctx.fillStyle='#ffffff';ctx.textAlign='center';
    var title='${esc(songTitle).replace(/'/g,"\\'")}';
    if(title.length>38)title=title.slice(0,36)+'…';
    ctx.fillText(title,canvas.width/2,py+140);

    // 6. Linha separadora
    ctx.strokeStyle='${theme.accent}';ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(px+60,py+168);ctx.lineTo(px+pw-60,py+168);ctx.stroke();

    // 7. Letra
    ctx.font='28px Georgia,serif';ctx.fillStyle='rgba(255,255,255,0.90)';ctx.textAlign='left';
    var lines='${esc(letraLimpa).replace(/'/g,"\\'").replace(/\n/g,'\\n')}'.split('\\n');
    var ly=py+220;var lx=px+50;var lmax=pw-100;
    for(var i=0;i<lines.length;i++){
      if(ly>py+ph-100)break;
      var l=lines[i];
      if(l.startsWith('(')){
        ctx.font='bold 22px Georgia,serif';ctx.fillStyle='${theme.accent}';
        ctx.fillText(l,lx,ly);ly+=38;
        ctx.font='28px Georgia,serif';ctx.fillStyle='rgba(255,255,255,0.90)';
      } else if(l===''){ly+=20;}
      else{
        var n=wrapText(ctx,l,lx,ly,lmax,38);
        ly+=n*38;
      }
    }

    // 8. Rodapé Masters Music
    ctx.font='bold 24px -apple-system,sans-serif';ctx.fillStyle='rgba(255,255,255,0.35)';
    ctx.textAlign='center';ctx.fillText('Criado com ♥ por Masters Music — mastersmusic.com.br',canvas.width/2,canvas.height-60);

    if(dlBtn){dlBtn.disabled=false;dlBtn.textContent='⬇ Baixar arte da letra';}
    var a=document.createElement('a');
    a.download='arte-letra-${esc(para).toLowerCase().replace(/\s+/g,'-')}-masters.png';
    a.href=canvas.toDataURL('image/png',0.92);a.click();
  };
  img.onerror=function(){
    // Fallback sem foto
    downloadArtFallback();
    if(dlBtn){dlBtn.disabled=false;dlBtn.textContent='⬇ Baixar arte da letra';}
  };
  img.src=getArtBg();
}

function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);
  ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);
  ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);
  ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();
}

function downloadArtFallback(){
  var canvas=document.createElement('canvas');
  canvas.width=800;canvas.height=1000;
  var ctx=canvas.getContext('2d');
  var grad=ctx.createLinearGradient(0,0,800,1000);
  grad.addColorStop(0,'#1a0f2e');grad.addColorStop(1,'#0f1628');
  ctx.fillStyle=grad;ctx.fillRect(0,0,800,1000);
  ctx.strokeStyle='${theme.accent}';ctx.lineWidth=2;ctx.strokeRect(20,20,760,960);
  ctx.fillStyle='${theme.accent}';ctx.font='bold 28px serif';ctx.textAlign='center';
  ctx.fillText('♪ ${esc(songTitle).replace(/'/g,"\\'")}',400,80);
  ctx.fillStyle='rgba(255,255,255,0.85)';ctx.font='20px serif';ctx.textAlign='left';
  var lines='${esc(letraLimpa).replace(/'/g,"\\'").replace(/\n/g,'\\n')}'.split('\\n');
  var y=130;
  lines.forEach(function(l){if(y>920)return;ctx.fillText(l.slice(0,54),50,y);y+=32;});
  ctx.fillStyle='rgba(255,255,255,0.15)';ctx.font='16px serif';ctx.textAlign='center';
  ctx.fillText('Masters Music — mastersmusic.com.br',400,970);
  var a=document.createElement('a');
  a.download='arte-letra-${esc(para).toLowerCase().replace(/\s+/g,'-')}-masters.png';
  a.href=canvas.toDataURL('image/png');a.click();
}
</script>
</body>
</html>`;

  return html(page, 30);
};
