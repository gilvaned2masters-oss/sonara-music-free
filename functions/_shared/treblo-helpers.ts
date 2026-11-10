// Mapeia estilo do formulário Masters Music → tags do Treblo
export function estiloToTags(estilo: string): string[] {
  const e = estilo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (e.includes('sertanejo'))                       return ['sertanejo', 'country', 'romantic', 'acoustic guitar'];
  if (e.includes('pagode'))                          return ['pagode', 'samba', 'percussion', 'upbeat'];
  if (e.includes('samba'))                           return ['samba', 'percussion', 'upbeat', 'tropical'];
  if (e.includes('forro') || e.includes('forró'))    return ['forro', 'accordion', 'upbeat', 'dance'];
  if (e.includes('funk'))                            return ['funk', 'bass', 'upbeat'];
  if (e.includes('axe') || e.includes('axé'))        return ['tropical', 'upbeat', 'dance', 'percussion'];
  if (e.includes('rock nacional') || e.includes('rock')) return ['rock', 'electric guitar', 'energetic'];
  if (e.includes('bossa'))                           return ['bossa nova', 'jazz', 'acoustic', 'guitar'];
  if (e.includes('mpb'))                             return ['mpb', 'acoustic', 'guitar', 'poetic'];
  if (e.includes('gospel') || e.includes('religioso')) return ['gospel', 'choir', 'uplifting', 'piano'];
  if (e.includes('romantico') || e.includes('romântico')) return ['romantic', 'slow', 'emotional', 'piano'];
  if (e.includes('infantil'))                        return ['happy', 'playful', 'upbeat', 'simple'];
  if (e.includes('pop'))                             return ['pop', 'upbeat', 'catchy'];
  return ['pop', 'emotional', 'acoustic']; // fallback
}

function estiloToInstruments(estilo: string): string {
  const e = estilo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (e.includes('sertanejo'))  return 'acoustic guitar, violão, viola caipira';
  if (e.includes('pagode'))     return 'cavaquinho, pandeiro, percussion';
  if (e.includes('samba'))      return 'pandeiro, cavaquinho, percussion';
  if (e.includes('forro') || e.includes('forró')) return 'accordion, triangle, zabumba';
  if (e.includes('funk'))       return 'bass, drums, synth';
  if (e.includes('rock'))       return 'electric guitar, drums, bass';
  if (e.includes('bossa'))      return 'acoustic guitar, piano, bass';
  if (e.includes('mpb'))        return 'acoustic guitar, piano';
  if (e.includes('gospel'))     return 'piano, choir, organ';
  if (e.includes('pop'))        return 'piano, synth, drums';
  return 'acoustic guitar, piano';
}

const KIE_STYLE_TAGS: Record<string, string> = {
  'arrocha':                       'arrocha, baiao, northeastern brazilian, romantic, slow, emotional, accordion, bass guitar',
  'axé':                           'axe music, brazilian carnival, upbeat, festive, percussion, cheerful, energetic',
  'brega funk':                    'brega funk, brazilian funk, electronic beats, bass heavy, 130bpm, urban, catchy hook',
  'eletrônica':                    'electronic, edm, synth, build up, drop, euphoric, 128bpm, emotional',
  'forró':                         'forro, northeastern brazilian, accordion, triangle, zabumba, upbeat, dançante, romantic',
  'funk':                          'baile funk, brazilian funk, 150bpm, bass heavy, carioca, catchy, urban',
  'gospel':                        'gospel, christian music, uplifting, choir, emotional, praise, worship, inspirational',
  'jazz':                          'jazz, sophisticated, piano, double bass, smooth, soulful, complex harmony',
  'mpb':                           'mpb, brazilian popular music, acoustic guitar, poetic, emotional, sophisticated, melodic',
  'pagode':                        'pagode, samba, brazilian, percussion, cavaquinho, emotional, romantic, syncopated',
  'pop romântico':                 'acoustic pop, romantic, acoustic guitar, intimate, emotional, soft, heartfelt',
  'pop':                           'pop, catchy, upbeat, modern, commercial, melodic hook, radio-friendly',
  'rap':                           'brazilian rap, hip hop, storytelling, rhymes, urban, beat, spoken word',
  'reggae':                        'reggae, chill, positive, offbeat rhythm, bass, spiritual, peaceful, romantic',
  'rock':                          'rock, electric guitar, drums, energetic, powerful, distortion, anthem',
  'romântico':                     'romantic, love song, emotional, soft, heartfelt, slow tempo, melodic, tender',
  'samba':                         'samba, brazilian, percussion, cheerful, syncopated, celebratory, acoustic guitar',
  'sertanejo raiz':                'sertanejo raiz, viola caipira, acoustic, countryside, traditional, nostalgic, heartfelt',
  'sertanejo universitário':       'sertanejo universitario, pop sertanejo, uptempo, electric guitar, romantic, modern country, catchy',
  'sertanejo romântico':           'sertanejo romantico, viola, acoustic guitar, romantic, emotional, heartfelt, slow, declaration of love',
  'sertanejo':                     'sertanejo, acoustic guitar, violão, romantic, emotional, heartfelt',
  'cantiga infantil':              'children song, nursery rhyme, playful, sweet, simple melody, cheerful, sing-along, lighthearted',
  'música infantil':               'children music, kids song, playful, cheerful, upbeat, simple catchy melody, happy, sing-along',
  'k-pop':                         'k-pop, korean pop, energetic, catchy hook, polished production, danceable, modern, synth, youthful',
  'música da copa':                'world cup anthem, festive, anthemic, crowd chant, stadium, upbeat, celebratory, brazilian, patriotic, energetic',
};

function getKieStyleTags(estilo: string): string {
  const key = estilo.toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const [k, v] of Object.entries(KIE_STYLE_TAGS)) {
    const kn = k.normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (key.includes(kn) || kn.includes(key)) return v;
  }
  return estilo.toLowerCase();
}

export function buildSunorPayload(params: {
  estilo: string;
  voz: string;
  lyrics: string;
  title: string;
  sunorStyle?: string;
}) {
  const { estilo, voz, lyrics, title, sunorStyle } = params;
  const voiceTag = voz === 'Masculina' ? 'male vocals only, male singer' : 'female vocals only, female singer';
  // Usar style gerado pela IA se disponível, senão fallback para mapa de tags
  let tags = sunorStyle || `${getKieStyleTags(estilo)}, ${voiceTag}`;
  // Blindagem: a voz escolhida pelo cliente SEMPRE prevalece, mesmo se a IA gerou voz errada no style.
  // Remove menções de voz do style e injeta a correta com base em `voz`.
  if (sunorStyle) {
    const stripped = sunorStyle
      .replace(/\b(fe)?male\s+(vocals?|singer|voice)(\s+only)?\b/gi, '')
      .replace(/\bvoz\s+(masculina|feminina)\b/gi, '')
      .replace(/\s*,\s*,\s*/g, ', ')
      .replace(/^\s*,\s*|\s*,\s*$/g, '')
      .trim();
    tags = `${stripped}, ${voiceTag}`;
  }

  return {
    model: 'suno',
    task_type: 'music',
    input: {
      prompt: lyrics,
      tags,
      title,
      make_instrumental: false,
    },
  };
}

export function buildKiePayload(params: {
  estilo: string;
  voz: string;
  ocasiao: string;
  destinatario: string;
  lyrics: string;
  title: string;
  callBackUrl: string;
}) {
  const { estilo, voz, ocasiao, destinatario, lyrics, title, callBackUrl } = params;
  const voice = voz === 'Masculina' ? 'male' : 'female';
  const voiceTag = voice === 'male' ? 'male vocals, voz masculina' : 'female vocals, voz feminina';
  const styleTags = getKieStyleTags(estilo);

  return {
    prompt: lyrics,
    customMode: true,
    instrumental: false,
    model: 'V5',
    style: `${styleTags}, ${voiceTag}`,
    title,
    callBackUrl,
  };
}

// Monta prompt e tags para Treblo com base no pedido
export function buildTrebloPayload(params: {
  estilo: string;
  voz: string;
  ocasiao: string;
  destinatario: string;
  lyrics: string;
}) {
  const { estilo, voz, ocasiao, destinatario, lyrics } = params;
  const voiceDesc = voz === 'Masculina' ? 'male voice' : 'female voice';
  const tags = estiloToTags(estilo);

  const instruments = estiloToInstruments(estilo);

  const prompt = [
    `Brazilian ${estilo} song`,
    voiceDesc,
    'emotional',
    'sung in Brazilian Portuguese',
    ocasiao ? `about ${ocasiao}` : '',
    destinatario ? `for ${destinatario}` : '',
    instruments,
    'high quality production',
  ].filter(Boolean).join(', ');

  return {
    prompt,
    lyrics,
    output_format: 'mp3',
    bit_rate: 192,
  };
}
