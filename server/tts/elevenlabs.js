// ElevenLabs text-to-speech. The most human / audiobook-grade voices. Docs:
//   https://elevenlabs.io/docs/api-reference/text-to-speech

// A few of ElevenLabs' stable premade voices, used as a fallback when we can't
// fetch the account's own voice list.
const FALLBACK_VOICES = [
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', description: 'Calm, narration' },
  { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', description: 'Strong, confident' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', description: 'Soft, warm' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', description: 'Deep, British' },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', description: 'Deep, narration' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', description: 'Young, American' },
];

const MODELS = [
  { id: 'eleven_multilingual_v2', name: 'Multilingual v2 (quality)' },
  { id: 'eleven_turbo_v2_5', name: 'Turbo v2.5 (faster, cheaper)' },
  { id: 'eleven_flash_v2_5', name: 'Flash v2.5 (fastest)' },
];

export const elevenlabs = {
  key: 'elevenlabs',
  label: 'ElevenLabs',
  format: 'mp3',
  maxChars: 4800, // generous; ElevenLabs allows large inputs but we keep chunks sane
  models: MODELS,
  defaultModel: 'eleven_multilingual_v2',

  isConfigured: () => Boolean(process.env.ELEVENLABS_API_KEY),

  listVoices: async () => {
    try {
      const res = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
      });
      if (res.ok) {
        const data = await res.json();
        const voices = (data.voices || []).map((v) => ({
          id: v.voice_id,
          name: v.name,
          description: v.labels ? Object.values(v.labels).join(', ') : v.category || '',
        }));
        if (voices.length) return voices;
      }
    } catch {
      // fall through to fallback list
    }
    return FALLBACK_VOICES;
  },

  estimate: (chars) => ({
    note: `Uses ${chars.toLocaleString()} ElevenLabs credits (about 1 per character). Check your plan's balance.`,
  }),

  async synthesize({ text, voice = '21m00Tcm4TlvDq8ikWAM', model = 'eleven_multilingual_v2' }) {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({ text, model_id: model }),
      }
    );

    if (!res.ok) {
      const detail = await safeError(res);
      throw new Error(`ElevenLabs TTS failed (${res.status}): ${detail}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { buffer: buf, format: 'mp3' };
  },
};

async function safeError(res) {
  try {
    const data = await res.json();
    return data?.detail?.message || data?.detail || JSON.stringify(data);
  } catch {
    return res.statusText;
  }
}
