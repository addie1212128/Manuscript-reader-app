import { encodeWav } from '../lib/audio.js';

// A zero-setup, offline "voice" so the whole app can be exercised without any
// API key. It doesn't speak words — it emits a soft, speech-like murmur whose
// length tracks the text, so you can watch and hear the full pipeline work
// (chunking, progress, stitching, playback, download) before paying for a key.

const VOICES = [
  { id: 'demo-warm', name: 'Demo — Warm murmur', description: 'Low, calm tone' },
  { id: 'demo-bright', name: 'Demo — Bright murmur', description: 'Higher tone' },
];

export const demo = {
  key: 'demo',
  label: 'Demo (no key needed)',
  format: 'wav',
  maxChars: 100000,
  isConfigured: () => true,
  listVoices: async () => VOICES,
  models: [],
  estimate: () => ({ note: 'Free — generated locally, no cost.' }),

  async synthesize({ text, voice = 'demo-warm', speed = 1 }) {
    const sampleRate = 22050;
    const baseFreq = voice === 'demo-bright' ? 240 : 150;

    // ~14 characters per second of speech, scaled by requested speed, capped
    // so demo runs stay snappy even for long chunks.
    const seconds = Math.min(8, Math.max(0.4, text.length / (14 * (speed || 1))));
    const total = Math.floor(sampleRate * seconds);
    const pcm = Buffer.alloc(total * 2);

    for (let i = 0; i < total; i++) {
      const t = i / sampleRate;
      // Wobble the pitch and amplitude a little so it reads as "talking"
      // rather than a flat test tone.
      const vibrato = 1 + 0.03 * Math.sin(2 * Math.PI * 5 * t);
      const syllable = 0.5 + 0.5 * Math.abs(Math.sin(2 * Math.PI * 3.5 * t));
      const envelope = Math.min(1, t * 6) * Math.min(1, (seconds - t) * 6); // fade in/out
      const sample =
        Math.sin(2 * Math.PI * baseFreq * vibrato * t) * syllable * envelope * 0.28;
      pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(sample * 32767))), i * 2);
    }

    return { buffer: encodeWav(pcm, { sampleRate, channels: 1, bitsPerSample: 16 }), format: 'wav' };
  },
};
