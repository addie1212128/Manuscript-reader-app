// OpenAI text-to-speech. Very natural, good value. Docs:
//   https://platform.openai.com/docs/guides/text-to-speech

const VOICES = [
  { id: 'alloy', name: 'Alloy', description: 'Neutral, balanced' },
  { id: 'ash', name: 'Ash', description: 'Warm, expressive' },
  { id: 'ballad', name: 'Ballad', description: 'Soft, storytelling' },
  { id: 'coral', name: 'Coral', description: 'Bright, friendly' },
  { id: 'echo', name: 'Echo', description: 'Calm, measured' },
  { id: 'fable', name: 'Fable', description: 'Expressive, narration' },
  { id: 'nova', name: 'Nova', description: 'Energetic, clear' },
  { id: 'onyx', name: 'Onyx', description: 'Deep, authoritative' },
  { id: 'sage', name: 'Sage', description: 'Gentle, grounded' },
  { id: 'shimmer', name: 'Shimmer', description: 'Light, airy' },
];

const MODELS = [
  { id: 'gpt-4o-mini-tts', name: 'GPT-4o mini TTS (newest, natural)' },
  { id: 'tts-1', name: 'TTS-1 (fast, cheapest)' },
  { id: 'tts-1-hd', name: 'TTS-1 HD (higher fidelity)' },
];

// Rough $/million characters, for a pre-generation estimate only.
const PRICE_PER_MILLION = { 'tts-1': 15, 'tts-1-hd': 30, 'gpt-4o-mini-tts': 12 };

export const openai = {
  key: 'openai',
  label: 'OpenAI',
  format: 'mp3',
  maxChars: 3800, // API limit is 4096; stay safely under
  models: MODELS,
  defaultModel: 'gpt-4o-mini-tts',

  isConfigured: () => Boolean(process.env.OPENAI_API_KEY),
  listVoices: async () => VOICES,

  estimate: (chars, model = 'gpt-4o-mini-tts') => {
    const rate = PRICE_PER_MILLION[model] ?? 15;
    return {
      dollars: (chars / 1_000_000) * rate,
      note: `≈ $${((chars / 1_000_000) * rate).toFixed(2)} at current ${model} rates (estimate).`,
    };
  },

  async synthesize({ text, voice = 'fable', model = 'gpt-4o-mini-tts', speed = 1 }) {
    const body = {
      model,
      voice,
      input: text,
      response_format: 'mp3',
    };
    // Classic tts models accept a speed param; gpt-4o-mini-tts does not.
    if (model !== 'gpt-4o-mini-tts' && speed && speed !== 1) body.speed = speed;

    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await safeError(res);
      throw new Error(`OpenAI TTS failed (${res.status}): ${detail}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { buffer: buf, format: 'mp3' };
  },
};

async function safeError(res) {
  try {
    const data = await res.json();
    return data?.error?.message || JSON.stringify(data);
  } catch {
    return res.statusText;
  }
}
