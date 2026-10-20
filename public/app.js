// ── Element handles ────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const textEl = $('text');
const titleEl = $('title');
const countsEl = $('counts');
const fileEl = $('file');
const dropEl = $('drop');
const fileStatusEl = $('fileStatus');
const providerEl = $('provider');
const voiceEl = $('voice');
const modelEl = $('model');
const modelField = $('modelField');
const speedEl = $('speed');
const speedValEl = $('speedVal');
const estimateEl = $('estimate');
const generateEl = $('generate');
const cancelEl = $('cancel');
const progressEl = $('progress');
const progressFill = $('progressFill');
const progressLabel = $('progressLabel');
const errorEl = $('error');
const resultEl = $('result');
const playerEl = $('player');
const downloadEl = $('download');

const gateEl = $('gate');
const gateFormEl = $('gateForm');
const gateInputEl = $('gateInput');
const gateErrorEl = $('gateError');

let currentJob = null;
let pollTimer = null;
let estimateTimer = null;

// ── Passcode handling ──────────────────────────────────────────
const PASS_KEY = 'mr_passcode';

function getPass() {
  try {
    return localStorage.getItem(PASS_KEY) || '';
  } catch {
    return window.__pass || '';
  }
}
function setPass(v) {
  try {
    localStorage.setItem(PASS_KEY, v);
  } catch {
    window.__pass = v;
  }
}

// All API calls go through here so they carry the passcode and surface the gate
// on a 401 (e.g. a wrong/expired passcode on a deployed instance).
async function api(url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const pass = getPass();
  if (pass) headers['x-app-passcode'] = pass;
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401) {
    showGate();
    throw new Error('Passcode required.');
  }
  return res;
}

function showGate() {
  gateEl.hidden = false;
  setTimeout(() => gateInputEl.focus(), 50);
}

gateFormEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  gateErrorEl.hidden = true;
  setPass(gateInputEl.value.trim());
  try {
    // Verify by making a real protected call (direct fetch so a 401 here just
    // shows an error rather than re-triggering the gate).
    const res = await fetch('/api/config', { headers: { 'x-app-passcode': getPass() } });
    if (res.ok) {
      gateEl.hidden = true;
      boot();
      return;
    }
    const data = await res.json().catch(() => ({}));
    gateErrorEl.textContent =
      res.status === 429
        ? data.error || 'Too many attempts. Please wait a few minutes and try again.'
        : "That passcode didn't work. Try again.";
    gateErrorEl.hidden = false;
  } catch {
    gateErrorEl.textContent = 'Could not reach the server. Try again.';
    gateErrorEl.hidden = false;
  }
});

// ── Tabs ───────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('is-active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('is-active'));
    tab.classList.add('is-active');
    document.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add('is-active');
  });
});

// ── Text input + counts ────────────────────────────────────────
textEl.addEventListener('input', onTextChanged);

function onTextChanged() {
  const text = textEl.value;
  const words = (text.trim().match(/\S+/g) || []).length;
  countsEl.textContent = `${words.toLocaleString()} words · ${text.length.toLocaleString()} characters`;
  generateEl.disabled = text.trim().length === 0;
  scheduleEstimate();
}

// ── File upload ────────────────────────────────────────────────
fileEl.addEventListener('change', () => fileEl.files[0] && uploadFile(fileEl.files[0]));

['dragenter', 'dragover'].forEach((evt) =>
  dropEl.addEventListener(evt, (e) => {
    e.preventDefault();
    dropEl.classList.add('is-drag');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  dropEl.addEventListener(evt, (e) => {
    e.preventDefault();
    dropEl.classList.remove('is-drag');
  })
);
dropEl.addEventListener('drop', (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (f) uploadFile(f);
});

async function uploadFile(file) {
  showError('');
  fileStatusEl.hidden = false;
  fileStatusEl.textContent = `Reading “${file.name}”…`;
  const form = new FormData();
  form.append('file', file);
  try {
    const res = await api('/api/extract', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not read that file.');
    textEl.value = data.text;
    onTextChanged();
    if (!titleEl.value) titleEl.value = file.name.replace(/\.[^.]+$/, '');
    fileStatusEl.textContent = `✓ Loaded “${data.filename}” — ${data.chars.toLocaleString()} characters. Review it below, then create the audio.`;
    // Jump to the paste tab so they can see/edit the extracted text.
    document.querySelector('[data-tab="paste"]').click();
  } catch (err) {
    fileStatusEl.hidden = true;
    showError(err.message);
  }
}

// ── Providers / voices / models ────────────────────────────────
async function loadConfig() {
  const res = await api('/api/config');
  const cfg = await res.json();
  providerEl.innerHTML = '';
  cfg.providers.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.key;
    opt.textContent = p.label;
    providerEl.appendChild(opt);
  });
  providerEl.value = cfg.default;
  await loadVoices();
}

async function loadVoices() {
  const provider = providerEl.value;
  voiceEl.innerHTML = '<option>Loading…</option>';
  const res = await api(`/api/voices?provider=${encodeURIComponent(provider)}`);
  const data = await res.json();

  voiceEl.innerHTML = '';
  data.voices.forEach((v) => {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.description ? `${v.name} — ${v.description}` : v.name;
    voiceEl.appendChild(opt);
  });

  if (data.models && data.models.length) {
    modelField.hidden = false;
    modelEl.innerHTML = '';
    data.models.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      modelEl.appendChild(opt);
    });
    if (data.defaultModel) modelEl.value = data.defaultModel;
  } else {
    modelField.hidden = true;
    modelEl.innerHTML = '';
  }

  providerNote(provider);
  scheduleEstimate();
}

function providerNote(provider) {
  const note = $('providerNote');
  if (provider === 'demo') {
    note.textContent =
      'Demo mode makes a placeholder murmur so you can test everything for free, offline. Add an API key in your .env file to unlock real voices.';
  } else {
    note.textContent = 'Your text is sent to this provider to generate the audio.';
  }
}

providerEl.addEventListener('change', loadVoices);
modelEl.addEventListener('change', scheduleEstimate);

// ── Speed ──────────────────────────────────────────────────────
speedEl.addEventListener('input', () => {
  speedValEl.textContent = `${Number(speedEl.value).toFixed(2)}×`;
});

// ── Estimate ───────────────────────────────────────────────────
function scheduleEstimate() {
  clearTimeout(estimateTimer);
  estimateTimer = setTimeout(updateEstimate, 300);
}

async function updateEstimate() {
  const text = textEl.value;
  if (!text.trim()) {
    estimateEl.innerHTML = 'Add some text to see an estimate.';
    return;
  }
  try {
    const res = await api('/api/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, provider: providerEl.value, model: modelEl.value || undefined }),
    });
    const data = await res.json();
    const parts = [`<strong>${data.words.toLocaleString()}</strong> words · <strong>${data.chars.toLocaleString()}</strong> characters`];
    if (data.note) parts.push(data.note);
    estimateEl.innerHTML = parts.join(' &nbsp;·&nbsp; ');
  } catch {
    estimateEl.textContent = '';
  }
}

// ── Generate ───────────────────────────────────────────────────
generateEl.addEventListener('click', startJob);
cancelEl.addEventListener('click', cancelJob);

async function startJob() {
  showError('');
  resultEl.hidden = true;
  const text = textEl.value.trim();
  if (!text) return;

  generateEl.disabled = true;
  cancelEl.hidden = false;
  progressEl.hidden = false;
  setProgress(0, 'Starting…');

  try {
    const res = await api('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        provider: providerEl.value,
        voice: voiceEl.value,
        model: modelEl.value || undefined,
        speed: Number(speedEl.value),
        title: titleEl.value,
      }),
    });
    const job = await res.json();
    if (!res.ok) throw new Error(job.error || 'Could not start.');
    currentJob = job.id;
    poll();
  } catch (err) {
    finishWithError(err.message);
  }
}

function poll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    if (!currentJob) return;
    try {
      const res = await api(`/api/jobs/${currentJob}`);
      const job = await res.json();
      if (!res.ok) throw new Error(job.error || 'Lost track of the job.');

      if (job.status === 'running') {
        const label =
          job.totalChunks > 1
            ? `Narrating part ${job.doneChunks} of ${job.totalChunks}…`
            : 'Narrating…';
        setProgress(Math.max(job.percent, 4), label);
        poll();
      } else if (job.status === 'done') {
        setProgress(100, 'Done!');
        showResult(job);
      } else if (job.status === 'canceled') {
        finishWithError('Canceled.');
      } else {
        finishWithError(job.error || 'Generation failed.');
      }
    } catch (err) {
      finishWithError(err.message);
    }
  }, 700);
}

async function cancelJob() {
  if (!currentJob) return;
  await api(`/api/jobs/${currentJob}/cancel`, { method: 'POST' }).catch(() => {});
  currentJob = null;
  clearTimeout(pollTimer);
  finishWithError('Canceled.');
}

function showResult(job) {
  currentJob = null;
  clearTimeout(pollTimer);
  cancelEl.hidden = true;
  generateEl.disabled = false;
  progressEl.hidden = true;

  const tokenQ = job.token ? `token=${encodeURIComponent(job.token)}` : '';
  const src = `/api/jobs/${job.id}/audio${tokenQ ? '?' + tokenQ : ''}`;
  playerEl.src = src;
  downloadEl.href = `/api/jobs/${job.id}/audio?download=1${tokenQ ? '&' + tokenQ : ''}`;
  const kb = job.bytes ? ` (${(job.bytes / 1024 / 1024).toFixed(1)} MB)` : '';
  downloadEl.textContent = `⬇ Download ${job.title || 'manuscript'}.${job.format}${kb}`;
  resultEl.hidden = false;
  resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function setProgress(percent, label) {
  progressFill.style.width = `${percent}%`;
  progressLabel.textContent = label;
}

function finishWithError(msg) {
  currentJob = null;
  clearTimeout(pollTimer);
  cancelEl.hidden = true;
  generateEl.disabled = textEl.value.trim().length === 0;
  progressEl.hidden = true;
  if (msg && msg !== 'Canceled.') showError(msg);
}

function showError(msg) {
  errorEl.hidden = !msg;
  errorEl.textContent = msg || '';
}

// ── Boot ───────────────────────────────────────────────────────
function boot() {
  loadConfig().catch((err) => {
    // A 401 already triggered the gate; only report other failures.
    if (err.message !== 'Passcode required.') showError('Could not load settings: ' + err.message);
  });
}

async function start() {
  onTextChanged();
  let auth = { required: false };
  try {
    auth = await (await fetch('/api/auth')).json();
  } catch {
    /* if this fails, loadConfig will surface the real problem */
  }
  if (auth.required && !getPass()) {
    showGate();
    return;
  }
  boot();
}

start();
