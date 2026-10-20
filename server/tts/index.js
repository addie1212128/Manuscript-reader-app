import { openai } from './openai.js';
import { elevenlabs } from './elevenlabs.js';
import { demo } from './demo.js';

const ALL = { openai, elevenlabs, demo };

/** The providers that are usable right now (have a key, plus always Demo). */
export function availableProviders() {
  return Object.values(ALL).filter((p) => p.isConfigured());
}

export function getProvider(key) {
  const p = ALL[key];
  if (!p) throw new Error(`Unknown voice provider: ${key}`);
  if (!p.isConfigured()) throw new Error(`Provider "${key}" is not configured (missing API key).`);
  return p;
}

/** Pick a sensible default provider: a real one if configured, else Demo. */
export function defaultProviderKey() {
  if (openai.isConfigured()) return 'openai';
  if (elevenlabs.isConfigured()) return 'elevenlabs';
  return 'demo';
}
