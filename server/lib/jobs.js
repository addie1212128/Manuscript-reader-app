import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getProvider } from '../tts/index.js';
import { chunkText } from './chunk.js';
import { combineAudio } from './audio.js';

// Use a writable temp location by default so this works on hosts whose app
// directory is read-only. Override with OUTPUT_DIR if you want files kept.
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(os.tmpdir(), 'manuscript-reader-output');
const jobs = new Map();
const MAX_JOBS = 50; // keep memory/disk bounded

await fs.mkdir(OUTPUT_DIR, { recursive: true }).catch(() => {});

export function createJob({ text, providerKey, voice, model, speed, title }) {
  const provider = getProvider(providerKey);
  const chunks = chunkText(text, provider.maxChars);

  const id = randomUUID();
  const job = {
    id,
    token: randomUUID(), // guards the audio URL without exposing the passcode
    status: 'running', // running | done | error | canceled
    provider: providerKey,
    format: provider.format,
    voice,
    model,
    speed,
    title: sanitizeTitle(title),
    totalChunks: chunks.length,
    doneChunks: 0,
    chars: text.length,
    error: null,
    createdAt: Date.now(),
    file: null,
    canceled: false,
  };
  jobs.set(id, job);
  pruneOldJobs();

  // Run asynchronously; the client polls /progress.
  runJob(job, provider, chunks, { voice, model, speed }).catch((err) => {
    job.status = 'error';
    job.error = err.message || String(err);
  });

  return job;
}

async function runJob(job, provider, chunks, opts) {
  const buffers = [];
  for (let i = 0; i < chunks.length; i++) {
    if (job.canceled) {
      job.status = 'canceled';
      return;
    }
    const { buffer } = await withRetry(() =>
      provider.synthesize({ text: chunks[i], ...opts })
    );
    buffers.push(buffer);
    job.doneChunks = i + 1;
  }

  const combined = await combineAudio(buffers, job.format);
  const file = path.join(OUTPUT_DIR, `${job.id}.${job.format}`);
  await fs.writeFile(file, combined);
  job.file = file;
  job.bytes = combined.length;
  job.status = 'done';
}

async function withRetry(fn, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Back off on transient errors (rate limits, network blips).
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

export function getJob(id) {
  return jobs.get(id);
}

export function cancelJob(id) {
  const job = jobs.get(id);
  if (job && job.status === 'running') job.canceled = true;
  return job;
}

export function publicJob(job) {
  if (!job) return null;
  const { id, token, status, totalChunks, doneChunks, chars, error, format, bytes, title } = job;
  return {
    id,
    token,
    status,
    totalChunks,
    doneChunks,
    chars,
    error,
    format,
    bytes: bytes || 0,
    title,
    percent: totalChunks ? Math.round((doneChunks / totalChunks) * 100) : 0,
  };
}

function sanitizeTitle(title) {
  const base = (title || 'manuscript').toString().replace(/[^\w\- ]+/g, '').trim();
  return (base || 'manuscript').slice(0, 60);
}

async function pruneOldJobs() {
  if (jobs.size <= MAX_JOBS) return;
  const sorted = [...jobs.values()].sort((a, b) => a.createdAt - b.createdAt);
  while (jobs.size > MAX_JOBS) {
    const old = sorted.shift();
    if (!old) break;
    jobs.delete(old.id);
    if (old.file) await fs.rm(old.file, { force: true }).catch(() => {});
  }
}
