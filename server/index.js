import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';

import { extractText } from './lib/extract.js';
import { availableProviders, getProvider, defaultProviderKey } from './tts/index.js';
import { createJob, getJob, cancelJob, publicJob } from './lib/jobs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

const app = express();
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

// Kick off generation. Returns a job id to poll.
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

// Stream the finished audio (inline for the player, attachment for download).
app.get('/api/jobs/:id/audio', wrap(async (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
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

app.listen(PORT, () => {
  const names = availableProviders().map((p) => p.label).join(', ');
  console.log(`\n  📖→🔊  Manuscript Reader running at  http://localhost:${PORT}`);
  console.log(`  Voice providers available: ${names}`);
  if (!process.env.OPENAI_API_KEY && !process.env.ELEVENLABS_API_KEY) {
    console.log('  (No API key set — running in free Demo mode. Add a key in .env for real voices.)');
  }
  console.log('');
});

function countWords(text) {
  const m = (text || '').trim().match(/\S+/g);
  return m ? m.length : 0;
}
