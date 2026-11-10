interface Env {
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  ORDERS_KV: KVNamespace;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function clean(obj: Record<string, unknown>, key: string, limit = 800): string {
  return String(obj[key] ?? '').trim().replace(/\s+/g, ' ').slice(0, limit);
}

// ─── Mapa de estilo para o agente de letra ───────────────────────────────────
const STYLE_CONTEXT: Record<string, string> = {
  'arrocha':                      'Arrocha baiano: ritmo lento e arrastado, letra sofrida e apaixonada, vocabulário simples nordestino, refrão grudento.',
  'axé':                          'Axé music: animado e festivo, letras alegres, vocabulário baiano, refrão fácil de cantar em grupo.',
  'brega / brega funk':           'Brega funk: batida eletrônica pesada, letras de amor e sensualidade, linguagem urbana informal, refrão repetitivo e direto.',
  'eletrônica / edm':             'Eletrônica/EDM: clima de euforia ou emoção intensa, refrão longo e marcante, poucos versos mas muito impactantes.',
  'forró':                        'Forró nordestino: animado, letras de amor e saudade, vocabulário regional simples, refrão fácil e dançante.',
  'funk carioca / funk brasileiro':'Funk brasileiro: batida 150bpm, linguagem urbana carioca informal, refrão repetitivo e curto.',
  'gospel / música cristã':       'Gospel: letra de fé, gratidão e superação com Deus, vocabulário cristão, refrão celebrativo e emocionante.',
  'jazz / instrumental':          'Jazz: letra sofisticada e poética, temática de amor complexo, vocabulário refinado.',
  'mpb':                          'MPB: letra poética e narrativa, vocabulário culto mas acessível, mistura emoção e cotidiano.',
  'pagode':                       'Pagode: letra de amor, saudade e amizade, vocabulário informal carioca, refrão contagiante.',
  'pop':                          'Pop: letra direta e comercial, vocabulário moderno, refrão marcante que fica na cabeça.',
  'pop romântico acústico':       'Pop romântico acústico: letra íntima e delicada, clima de violão, emoção no verso e explosão no refrão.',
  'rap nacional':                 'Rap nacional: letra narrativa rimada, vocabulário urbano, versos longos com rimas internas.',
  'r&b / soul':                   'R&B/Soul: letra sensual e emocional, vocabulário suave, groove lento, refrão intenso.',
  'reggae':                       'Reggae: ritmo tranquilo e positivo, letra de amor e superação, vocabulário simples, refrão fácil.',
  'rock nacional':                'Rock nacional: letra intensa, vocabulário direto, refrão explosivo, pode ter metáforas fortes.',
  'romântico':                    'Romântico: letra suave e emocionante, vocabulário apaixonado, foco nos sentimentos, refrão que emociona.',
  'samba':                        'Samba: ritmo alegre e sincopado, letra de amor e celebração, vocabulário carioca informal.',
  'sertanejo raiz':               'Sertanejo raiz: viola e acordeão, vocabulário caipira autêntico, letra de amor e saudade do campo.',
  'sertanejo universitário':      'Sertanejo universitário: pop-sertanejo acelerado, vocabulário moderno e informal, letra de amor intenso, refrão grudenento.',
  'sertanejo romântico':          'Sertanejo romântico: batida média, declaração de amor, saudade e parceria, vocabulário simples e sentimental.',
  'trap / trap brasileiro':       'Trap: batida pesada com hi-hats, letras de conquista ou amor com linguagem urbana, refrão hook curto.',
  'cantiga infantil':             'Cantiga infantil: melodia simples e doce, vocabulário fácil para crianças, versos curtos e repetitivos, clima lúdico e carinhoso, refrão fácil de cantar junto.',
  'música infantil':              'Música infantil: alegre e divertida, vocabulário simples e positivo, refrão grudento e repetitivo, clima leve e brincalhão.',
  'k-pop':                        'K-Pop: energético e moderno, refrão chiclete em destaque, mistura partes melódicas e ritmadas, vocabulário jovem, clima vibrante.',
  'música da copa':               'Música da copa: hino festivo e empolgante, espírito de torcida e união, vocabulário patriótico e celebrativo, refrão de cantar em coro no estádio.',
};

function getStyleContext(estilo: string): string {
  const key = estilo.toLowerCase().trim();
  if (STYLE_CONTEXT[key]) return STYLE_CONTEXT[key];
  for (const [k, v] of Object.entries(STYLE_CONTEXT)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return `Estilo ${estilo}: letra emocional em português, estrutura musical natural, vocabulário acessível.`;
}

// ─── Prompt principal ─────────────────────────────────────────────────────────
function buildPrompt(
  destinatario: string, relacao: string, ocasiao: string, estilo: string,
  voz: string, historia: string, correcoes: string, currentLyrics: string,
): string {
  // Inferir voz do relacionamento se não explicitamente definida
  function inferVoz(v: string, rel: string): string {
    if (v === 'Masculina' || v === 'Feminina') return v;
    const r = rel.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (/esposa|namorada|noiva|filha\b|irma\b|avo\b|amiga/.test(r)) return 'Masculina';
    if (/marido|namorado|noivo|filho\b|irmao\b|avô|avo\b|amigo/.test(r)) return 'Feminina';
    return 'Feminina';
  }
  const vozFinal  = inferVoz(voz, relacao);
  const voiceType = vozFinal === 'Masculina' ? 'male vocals only, male singer, deep male voice' : 'female vocals only, female singer, female voice';
  const perspectiva = vozFinal === 'Masculina'
    ? `VOZ MASCULINA — homem cantando em primeira pessoa para ${relacao || 'sua parceira'}. O cantor é DO GÊNERO MASCULINO. Use pronomes masculinos para o narrador.`
    : `VOZ FEMININA — mulher cantando em primeira pessoa para ${relacao || 'seu parceiro'}. A cantora é DO GÊNERO FEMININO. Use pronomes femininos para a narradora.`;

  let ajustes = '', reescrita = '';
  if (correcoes && currentLyrics) {
    // Modo CORREÇÃO: aplicar exatamente o ajuste pedido NA letra existente, preservando o resto.
    ajustes   = `\n\n⚠️ CORREÇÃO SOLICITADA PELO CLIENTE (PRIORIDADE MÁXIMA): aplique EXATAMENTE este ajuste e mantenha intacto tudo que o cliente NÃO pediu para mudar → "${correcoes}"`;
    reescrita = `\n\nLETRA ATUAL (reescreva aplicando a correção acima, preservando o que não foi pedido para alterar):\n${currentLyrics}`;
  } else {
    if (correcoes)     ajustes   = `\n\nAJUSTES OBRIGATÓRIOS: ${correcoes}`;
    if (currentLyrics) reescrita = `\n\nRESCREVER E MELHORAR ESTA LETRA (mantenha a essência, melhore a qualidade):\n${currentLyrics}`;
  }

  return `Você é um compositor profissional especializado em músicas personalizadas para presentes emocionais.

Sua tarefa é criar uma letra original baseada no briefing abaixo.

REGRAS IMPORTANTES:
* A música deve ter duração entre 2 e 3 minutos.
* Deve citar os nomes das pessoas ao longo da música de forma natural.
* Transforme fatos simples em momentos emocionantes.
* Não copie frases do briefing literalmente; reescreva poeticamente.
* A música deve soar como uma canção comercial pronta para gravação.
* Evite clichês repetitivos.
* Crie imagens emocionais e memórias específicas.
* Priorize storytelling.
* O refrão deve ser simples, memorável e emocional.
* O tom deve combinar com o estilo musical escolhido.
* A letra deve parecer escrita exclusivamente para aquela pessoa.
* Sempre mencionar filhos, datas, locais e acontecimentos importantes quando fornecidos.
* Encerrar com um final emocionante.
* VOZ/PERSPECTIVA: ${perspectiva}

ESTRUTURA OBRIGATÓRIA:
[Intro]

[Verse 1]
(Início da história)

[Pre-Chorus]
(Cria expectativa emocional)

[Chorus]
(Mensagem principal da música)

[Verse 2]
(Evolução da história)

[Bridge]
(Momento mais profundo e emocionante)

[Final Chorus]
(Refrão final mais forte)

[Outro]
(Encerramento emocional)

DADOS:
Cliente: (quem encomendou)
Para Quem: ${destinatario}
Relacionamento: ${relacao}
Ocasião: ${ocasiao}
Estilo: ${estilo}
História: ${historia}${ajustes}${reescrita}

Antes de escrever a letra:
1. Identifique os acontecimentos mais importantes.
2. Identifique as emoções predominantes.
3. Transforme os fatos em narrativa musical.
4. Escolha palavras compatíveis com o estilo musical.
5. Crie uma letra profissional pronta para uso no Suno.

---

Também crie um STYLE para Suno seguindo este formato:
Gênero musical principal, tipo de voz, instrumentos predominantes, atmosfera emocional, tema da música, tipo de produção, referências de interpretação.

REGRAS DO STYLE:
* Máximo de 300 caracteres.
* Sempre usar "${voiceType}".
* Descrever instrumentos.
* Descrever emoção e temática.
* Não usar nomes de artistas.

FORMATO DE RESPOSTA — JSON válido:
{"title":"Título da música","lyrics":"letra completa com marcadores [Verse 1] [Chorus] etc","style":"style para suno aqui"}`;
}

// ─── Agente de pronúncia de nomes ─────────────────────────────────────────────
// Aplica acentuação fonética em nomes próprios não-padrão para o Kie.ai pronunciar corretamente
const PRONUNCIATION_MAP: Record<string, string> = {
  // Nomes estrangeiros / grafias incomuns
  'brayan': 'Bráian', 'brian': 'Bráian', 'bryan': 'Bráian',
  'jhon': 'Jôn', 'jhonatan': 'Jônatan', 'jhonatas': 'Jônatas',
  'john': 'Jôn', 'jonathan': 'Jônatan',
  'kaique': 'Kaíque', 'kayque': 'Kaíque',
  'raique': 'Raíque', 'rayque': 'Raíque',
  'laique': 'Laíque',
  'yasmim': 'Iásmim', 'yasmin': 'Iásmin',
  'yago': 'Iago', 'yuri': 'Iúri',
  'weslley': 'Uésli', 'wesley': 'Uésli',
  'willian': 'Uílian', 'william': 'Uíliam',
  'wilson': 'Uílson',
  'wadson': 'Uádson', 'wadison': 'Uádison',
  'kevin': 'Kévin',
  'kelvin': 'Kélvin',
  'daiane': 'Daiane', // já fonético
  'dayane': 'Daiane',
  'dayana': 'Daiana',
  'raiane': 'Raiane',
  'rayane': 'Raiane',
  'thaiane': 'Taiane',
  'thayane': 'Taiane',
  'thayna': 'Taina',
  'thaís': 'Taís',
  'thais': 'Taís',
  'thuany': 'Tuani',
  'thuane': 'Tuane',
  'layne': 'Laine',
  'laysa': 'Laisa',
  'laísa': 'Laísa',
  'rhuan': 'Ruan',
  'rhuam': 'Ruam',
  'rhenan': 'Rénan',
  'kauê': 'Kauê',
  'cauê': 'Cauê',
  'kaue': 'Kauê',
  'caue': 'Cauê',
  'abner': 'Ábner',
  'edson': 'Édson',
  'nelson': 'Nélson',
  'elton': 'Élton',
  'everton': 'Éverton',
  'welton': 'Uélton',
  'walton': 'Uálton',
  'cleiton': 'Cléiton',
  'cleyton': 'Cléiton',
  'clayton': 'Cléiton',
  'leandro': 'Leândro',
  'leandre': 'Leândre',
  'suelen': 'Suélen',
  'sueli': 'Suéli',
  'nubia': 'Núbia',
  'nubya': 'Núbia',
  'lyvia': 'Lívia',
  'lyandra': 'Liândra',
  'mylena': 'Milena',
  'mylenna': 'Milena',
  'mylene': 'Milene',
};

function applyPronunciation(lyrics: string): string {
  let result = lyrics;
  for (const [original, phonetic] of Object.entries(PRONUNCIATION_MAP)) {
    // Substituição case-insensitive, palavra inteira
    const regex = new RegExp(`\\b${original}\\b`, 'gi');
    result = result.replace(regex, (match) => {
      // Preserva capitalização da primeira letra
      if (match[0] === match[0].toUpperCase()) {
        return phonetic.charAt(0).toUpperCase() + phonetic.slice(1);
      }
      return phonetic.toLowerCase();
    });
  }
  return result;
}

// ─── Chamadas de IA ───────────────────────────────────────────────────────────
type LyricsResult = { title: string; lyrics: string; style: string };

function parseResult(raw: string): LyricsResult | null {
  try {
    const j = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    if (!j) return null;
    const parsed = JSON.parse(j) as { title?: string; lyrics?: string; style?: string };
    const title  = String(parsed.title  || '').trim();
    const lyrics = String(parsed.lyrics || '').trim();
    const style  = String(parsed.style  || '').trim().slice(0, 300);
    if (lyrics.length < 40) return null;
    return { title, lyrics, style };
  } catch { return null; }
}

async function tryAnthropic(apiKey: string, prompt: string): Promise<LyricsResult | null> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1800,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) { console.log('[lyrics] Anthropic error:', res.status); return null; }
    const data = await res.json() as { content?: Array<{ type: string; text?: string }> };
    const text = data?.content?.find(b => b.type === 'text')?.text ?? '';
    const result = parseResult(text);
    if (result) console.log('[lyrics] Anthropic OK, len:', result.lyrics.length);
    return result;
  } catch(e) { console.log('[lyrics] Anthropic exception:', String(e)); return null; }
}

async function tryOpenAI(apiKey: string, prompt: string): Promise<LyricsResult | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.88,
        max_tokens: 1800,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) { console.log('[lyrics] OpenAI error:', res.status); return null; }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data?.choices?.[0]?.message?.content ?? '';
    const result = parseResult(content);
    if (result) console.log('[lyrics] OpenAI OK, len:', result.lyrics.length);
    return result;
  } catch(e) { console.log('[lyrics] OpenAI exception:', String(e)); return null; }
}

function fallbackLyrics(destinatario: string, voz: string, estilo: string): LyricsResult {
  const nome = destinatario || 'meu amor';
  const voiceTag = voz === 'Masculina'
    ? 'male vocals only, male singer, deep male voice'
    : 'female vocals only, female singer, female voice';
  const genero = (estilo || 'romântico').toLowerCase();
  return {
    title: `Para ${nome}`,
    style: `${genero}, ${voiceTag}, acoustic guitar, piano, emotional, romantic, heartfelt love song, high production quality`,
    lyrics: `[Verse 1]\nTem momentos que a gente não esquece\nQue ficam guardados dentro do peito\nE quando a saudade aparece\nTudo volta, tão bonito, tão perfeito\n\n[Pre-Chorus]\nVocê chegou e mudou tudo\nTrouxe luz pra cada dia meu\n\n[Chorus]\n${nome}, essa música é sua\nFeita da nossa história, feita de verdade\nQue onde eu for, onde eu esteja\nVocê vai ser sempre minha metade\n\n[Verse 2]\nO tempo passa, a vida muda\nMas o que sinto por você fica igual\nMeu coração quando te escuta\nSabe que você é meu bem, meu lar\n\n[Bridge]\nE não precisa de mais nada\nSó a sua voz, o seu olhar\nNessa vida tão corrida\nVocê me ensinou a descansar\n\n[Final Chorus]\n${nome}, essa música é sua\nFeita da nossa história, feita de verdade\nQue onde eu for, onde eu esteja\nVocê vai ser sempre minha metade\n\n[Outro]\nPara sempre, ${nome}`,
  };
}

// ═══════════════════ ESPANHOL / LATAM (versão ES) ═══════════════════════════
const STYLE_CONTEXT_ES: Record<string, string> = {
  'balada romántica':   'Balada romántica: melodía lenta y emotiva, declaración de amor, estribillo que emociona.',
  'pop latino':         'Pop latino: moderno y pegadizo, estribillo comercial, energía positiva, vocabulario actual.',
  'pop':                'Pop: directo y comercial, estribillo memorable, moderno.',
  'reggaetón':          'Reggaetón: ritmo dembow urbano y bailable, romántico o de fiesta, estribillo pegajoso.',
  'bachata':            'Bachata: guitarra dominicana, romántica y sensual, ritmo bailable, amor y desamor.',
  'salsa':              'Salsa: percusión y metales tropicales, alegre y bailable, amor y celebración.',
  'cumbia':             'Cumbia: ritmo tropical pegajoso, festivo y bailable, letra sencilla y emotiva.',
  'ranchera / mariachi':'Ranchera con mariachi: trompetas y guitarrón, sentimiento mexicano, amor intenso y orgullo.',
  'banda / norteño':    'Banda/Norteño: tambora, acordeón y metales, estilo mexicano festivo, amor y fiesta.',
  'vallenato':          'Vallenato: acordeón colombiano, romántico y narrativo, historias de la vida y amor.',
  'bolero':             'Bolero: clásico y elegante, romántico y nostálgico, letra poética de amor profundo.',
  'corridos tumbados':  'Corridos tumbados: guitarras y estilo norteño moderno, narrativo, sentimiento mexicano actual.',
  'rock en español':    'Rock en español: guitarras eléctricas, intenso y emotivo, letra directa con fuerza.',
  'trap latino':        'Trap latino: beats urbanos con hi-hats, romántico o de conquista, estribillo gancho.',
  'música cristiana':   'Música cristiana: fe, gratitud y esperanza, vocabulario cristiano, estribillo celebrativo.',
  'tango':              'Tango: bandoneón, dramático y apasionado, elegante y nostálgico, poesía intensa.',
};
function getStyleContextES(estilo: string): string {
  const key = estilo.toLowerCase().trim();
  if (STYLE_CONTEXT_ES[key]) return STYLE_CONTEXT_ES[key];
  for (const [k, v] of Object.entries(STYLE_CONTEXT_ES)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return `Estilo ${estilo}: letra emotiva en español, estructura musical natural, vocabulario accesible.`;
}

function buildPromptES(
  destinatario: string, relacao: string, ocasiao: string, estilo: string,
  voz: string, historia: string, correcoes: string, currentLyrics: string,
): string {
  function inferVoz(v: string, rel: string): string {
    if (v === 'Masculina' || v === 'Feminina') return v;
    const r = rel.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (/esposa|novia|hija\b|madre|mama|amiga|hermana|abuela/.test(r)) return 'Masculina';
    if (/esposo|marido|novio|hijo\b|padre|papa|amigo|hermano|abuelo/.test(r)) return 'Feminina';
    return 'Feminina';
  }
  const vozFinal  = (voz === 'Masculina' || voz === 'Femenina' || voz === 'Feminina') ? voz : inferVoz(voz, relacao);
  const isMale    = vozFinal === 'Masculina';
  const voiceType = isMale ? 'male vocals only, male singer, deep male voice' : 'female vocals only, female singer, female voice';
  const perspectiva = isMale
    ? `VOZ MASCULINA — un hombre canta en primera persona para ${relacao || 'su pareja'}. Usa pronombres masculinos para el narrador.`
    : `VOZ FEMENINA — una mujer canta en primera persona para ${relacao || 'su pareja'}. Usa pronombres femeninos para la narradora.`;
  const ctx = getStyleContextES(estilo);

  let ajustes = '', reescrita = '';
  if (correcoes && currentLyrics) {
    ajustes   = `\n\n⚠️ CORRECCIÓN SOLICITADA POR EL CLIENTE (PRIORIDAD MÁXIMA): aplica EXACTAMENTE este ajuste y mantén intacto lo que el cliente NO pidió cambiar → "${correcoes}"`;
    reescrita = `\n\nLETRA ACTUAL (reescribe aplicando la corrección, preservando lo demás):\n${currentLyrics}`;
  } else if (currentLyrics) {
    reescrita = `\n\nREESCRIBE Y MEJORA ESTA LETRA (mantén la esencia, mejora la calidad):\n${currentLyrics}`;
  }

  return `Eres un compositor profesional especializado en canciones personalizadas para regalos emocionales.

Tu tarea es crear una letra original EN ESPAÑOL basada en el briefing de abajo.

REGLAS IMPORTANTES:
* La canción debe durar entre 2 y 3 minutos.
* Menciona los nombres de las personas a lo largo de la canción de forma natural.
* Transforma hechos simples en momentos emocionantes; no copies frases del briefing literalmente.
* Debe sonar como una canción comercial lista para grabar; evita clichés.
* Crea imágenes emocionales y recuerdos específicos; prioriza el storytelling.
* El estribillo debe ser simple, memorable y emotivo.
* El tono debe combinar con el estilo musical elegido: ${ctx}
* La letra debe parecer escrita exclusivamente para esa persona.
* Menciona hijos, fechas, lugares y acontecimientos importantes cuando se proporcionen.
* Termina con un final emocionante.
* VOZ/PERSPECTIVA: ${perspectiva}

ESTRUCTURA OBLIGATORIA:
[Intro]

[Verse 1]
(Inicio de la historia)

[Pre-Chorus]
(Crea expectativa emocional)

[Chorus]
(Mensaje principal de la canción)

[Verse 2]
(Evolución de la historia)

[Bridge]
(Momento más profundo y emotivo)

[Final Chorus]
(Estribillo final más fuerte)

[Outro]
(Cierre emocional)

DATOS:
Para quién: ${destinatario}
Relación: ${relacao}
Ocasión: ${ocasiao}
Estilo: ${estilo}
Historia: ${historia}${ajustes}${reescrita}

También crea un STYLE para Suno (en inglés, máximo 300 caracteres):
Género musical principal, tipo de voz, instrumentos, atmósfera emocional, tema, tipo de producción.
* Siempre usar "${voiceType}".
* Describir instrumentos y emoción. No usar nombres de artistas.

FORMATO DE RESPUESTA — JSON válido:
{"title":"Título de la canción","lyrics":"letra completa con marcadores [Verse 1] [Chorus] etc","style":"style para suno aquí"}`;
}

function fallbackLyricsES(destinatario: string, voz: string, estilo: string): LyricsResult {
  const nombre = destinatario || 'mi amor';
  const voiceTag = voz === 'Masculina'
    ? 'male vocals only, male singer, deep male voice'
    : 'female vocals only, female singer, female voice';
  return {
    title: `Para ${nombre}`,
    style: `${(estilo || 'balada romántica').toLowerCase()}, ${voiceTag}, acoustic guitar, piano, emotional, romantic, heartfelt, high production quality`,
    lyrics: `[Verse 1]\nHay momentos que uno no olvida\nque se guardan en el corazón\ny cuando vuelve el recuerdo\ntodo regresa, tan bello, tan real\n\n[Pre-Chorus]\nLlegaste tú y todo cambió\ntrajiste luz a mi vivir\n\n[Chorus]\n${nombre}, esta canción es tuya\nhecha de nuestra historia, de verdad\ndonde yo vaya, donde yo esté\ntú siempre serás mi otra mitad\n\n[Verse 2]\nEl tiempo pasa, la vida cambia\npero lo que siento sigue igual\nmi corazón cuando te escucha\nsabe que tú eres mi hogar\n\n[Bridge]\nY no hace falta nada más\nsolo tu voz, solo tu mirar\nen esta vida tan de prisa\ntú me enseñaste a descansar\n\n[Final Chorus]\n${nombre}, esta canción es tuya\nhecha de nuestra historia, de verdad\ndonde yo vaya, donde yo esté\ntú siempre serás mi otra mitad\n\n[Outro]\nPara siempre, ${nombre}`,
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let input: Record<string, unknown>;
  try { input = await request.json() as Record<string, unknown>; }
  catch { return json({ ok: false, error: 'invalid_json' }, 400); }

  // ── Rate limit por IP: 5 letras por hora ────────────────────────────────────
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const hour = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
  const rlKey = `ratelimit:lyrics:${ip}:${hour}`;
  if (env.ORDERS_KV) {
    const rlRaw = await env.ORDERS_KV.get(rlKey);
    const rlCount = rlRaw ? parseInt(rlRaw) : 0;
    if (rlCount >= 20) {
      console.log('[ratelimit] lyrics IP bloqueado:', ip, 'tentativas:', rlCount);
      return json({ ok: false, error: 'rate_limit', message: 'Muitas gerações. Aguarde alguns minutos.' }, 429);
    }
    await env.ORDERS_KV.put(rlKey, String(rlCount + 1), { expirationTtl: 3600 });
  }

  const destinatario  = clean(input, 'destinatario', 80);
  const relacao       = clean(input, 'relacao', 80);
  const ocasiao       = clean(input, 'ocasiao', 80);
  const estilo        = clean(input, 'estilo', 80);
  const voz           = clean(input, 'voz', 30);
  const historia      = clean(input, 'historia', 900);
  const currentLyrics = clean(input, 'currentLyrics', 1500);
  const correcoes     = clean(input, 'correcoes', 400);

  if (!destinatario || !relacao || !ocasiao || !estilo || historia.length < 8) {
    return json({ ok: false, error: 'missing_fields' }, 422);
  }

  const lang = (clean(input, 'lang', 5) || 'pt').toLowerCase();
  const prompt = lang === 'es'
    ? buildPromptES(destinatario, relacao, ocasiao, estilo, voz, historia, correcoes, currentLyrics)
    : buildPrompt(destinatario, relacao, ocasiao, estilo, voz, historia, correcoes, currentLyrics);

  // 1. Tenta Claude (Anthropic) — principal
  if (env.ANTHROPIC_API_KEY) {
    const result = await tryAnthropic(env.ANTHROPIC_API_KEY, prompt);
    if (result) {
      result.lyrics = applyPronunciation(result.lyrics);
      return json({ ok: true, ...result, source: 'anthropic' });
    }
  }

  // 2. Fallback: GPT-4o-mini
  if (env.OPENAI_API_KEY) {
    const result = await tryOpenAI(env.OPENAI_API_KEY, prompt);
    if (result) {
      result.lyrics = applyPronunciation(result.lyrics);
      return json({ ok: true, ...result, source: 'openai' });
    }
  }

  // 3. Fallback local
  const result = lang === 'es'
    ? fallbackLyricsES(destinatario, voz, estilo)
    : fallbackLyrics(destinatario, voz, estilo);
  result.lyrics = applyPronunciation(result.lyrics);
  return json({ ok: true, ...result, source: 'fallback' });
};
