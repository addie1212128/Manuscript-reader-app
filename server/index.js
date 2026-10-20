import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';

import { extractText } from './lib/extract.js';
import { availableProviders, getProvider, defaultProviderKey } from './tts/index.js';
import { createJob, getJob, cancelJob, publicJob } from './lib/jobs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

// Optional shared passcode. When set (e.g. on a public deployment), every API
// call must present it — this is what stops a stranger who finds your URL from
// spending your voice-provider credits. Left blank, the app is wide open, which
// is fine for running privately on your own machine.
const PASSCODE = (process.env.APP_PASSCODE || '').trim();

const app = express();
app.disable('x-powered-by');
// Only trust X-Forwarded-For when we're actually behind a proxy (e.g. Render),
// otherwise a direct client could spoof that header to dodge the rate limiter.
// Off by default; the Render blueprint sets TRUST_PROXY_HOPS=1.
const trustProxyHops = process.env.TRUST_PROXY_HOPS === '1' ? 1 : false;
app.set('trust proxy', trustProxyHops);
app.use(express.json({ limit: '12mb' }));
app.use(express.static(PUBLIC_DIR));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }, // 30 MB
});

const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Something went wrong.' });
});

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Throttle brute-force guessing of the passcode: after too many failed attempts
// from one IP within a window, that IP is blocked for the rest of the window.
// Successful auth clears the counter. In-memory is fine for a single instance.
const MAX_FAILS = 10;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const failures = new Map(); // ip -> { count, first }

function isRateLimited(ip) {
  const rec = failures.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > FAIL_WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return rec.count >= MAX_FAILS;
}
function noteFailure(ip) {
  const now = Date.now();
  const rec = failures.get(ip);
  if (!rec || now - rec.first > FAIL_WINDOW_MS) failures.set(ip, { count: 1, first: now });
  else rec.count += 1;
  if (failures.size > 5000) failures.clear(); // guard against unbounded growth
}
function noteSuccess(ip) {
  failures.delete(ip);
}

// ── Public routes (no passcode) ────────────────────────────────
// Platform health check.
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Tells the UI whether it needs to ask for a passcode.
app.get('/api/auth', (_req, res) => res.json({ required: Boolean(PASSCODE) }));

// Finished audio. Protected by a per-job token (in the URL) rather than the
// passcode header, because <audio> and download links can't send headers.
app.get('/api/jobs/:id/audio', wrap(async (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (PASSCODE && req.query.token !== job.token) {
    return res.status(401).json({ error: 'Invalid token.' });
  }
  if (job.status !== 'done' || !job.file) return res.status(409).json({ error: 'Audio not ready.' });

  const data = await fs.readFile(job.file);
  const mime = job.format === 'wav' ? 'audio/wav' : 'audio/mpeg';
  const filename = `${job.title || 'manuscript'}.${job.format}`;
  const disposition = req.query.download ? 'attachment' : 'inline';
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
  res.setHeader('Content-Length', data.length);
  res.send(data);
}));

// ── Passcode gate for everything else under /api ───────────────
app.use('/api', (req, res, next) => {
  if (!PASSCODE) return next();
  const ip = req.ip || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
  }
  if (safeEqual(req.get('x-app-passcode') || '', PASSCODE)) {
    noteSuccess(ip);
    return next();
  }
  noteFailure(ip);
  res.status(401).json({ error: 'Passcode required.' });
});

// Which providers are usable right now (keys present), plus Demo.
app.get('/api/config', wrap(async (_req, res) => {
  const providers = availableProviders().map((p) => ({ key: p.key, label: p.label }));
  res.json({ providers, default: defaultProviderKey() });
}));

// Voices + models + a cost note for a given provider.
app.get('/api/voices', wrap(async (req, res) => {
  const provider = getProvider(req.query.provider || defaultProviderKey());
  const voices = await provider.listVoices();
  res.json({
    provider: provider.key,
    format: provider.format,
    models: provider.models || [],
    defaultModel: provider.defaultModel || (provider.models?.[0]?.id ?? null),
    voices,
  });
}));

// Pull readable text out of an uploaded .txt/.docx/.pdf.
app.post('/api/extract', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const text = await extractText(req.file.buffer, req.file.originalname);
  if (!text) return res.status(422).json({ error: 'Could not find any readable text in that file.' });
  res.json({ text, chars: text.length, filename: req.file.originalname });
}));

// Pre-generation cost / length estimate.
app.post('/api/estimate', wrap(async (req, res) => {
  const { text = '', provider: key = defaultProviderKey(), model } = req.body || {};
  const provider = getProvider(key);
  const chars = text.length;
  const est = provider.estimate ? provider.estimate(chars, model) : {};
  res.json({ chars, words: countWords(text), ...est });
}));

// Kick off generation. Returns a job id (and token) to poll.
app.post('/api/jobs', wrap(async (req, res) => {
  const { text, provider = defaultProviderKey(), voice, model, speed = 1, title } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'No text to read.' });
  const job = createJob({ text, providerKey: provider, voice, model, speed: Number(speed) || 1, title });
  res.json(publicJob(job));
}));

app.get('/api/jobs/:id', wrap(async (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  res.json(publicJob(job));
}));

app.post('/api/jobs/:id/cancel', wrap(async (req, res) => {
  const job = cancelJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  res.json(publicJob(job));
}));

app.listen(PORT, () => {
  const names = availableProviders().map((p) => p.label).join(', ');
  console.log(`\n  📖→🔊  Manuscript Reader running at  http://localhost:${PORT}`);
  console.log(`  Voice providers available: ${names}`);
  console.log(`  Passcode protection: ${PASSCODE ? 'ON' : 'off (open access)'}`);
  if (!process.env.OPENAI_API_KEY && !process.env.ELEVENLABS_API_KEY) {
    console.log('  (No API key set — running in free Demo mode. Add a key for real voices.)');
  }
  console.log('');
});

function countWords(text) {
  const m = (text || '').trim().match(/\S+/g);
  return m ? m.length : 0;
}
