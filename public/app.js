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

let currentJob = null;
let pollTimer = null;
let estimateTimer = null;

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
    const res = await fetch('/api/extract', { method: 'POST', body: form });
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
  const res = await fetch('/api/config');
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
  const res = await fetch(`/api/voices?provider=${encodeURIComponent(provider)}`);
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
    const res = await fetch('/api/estimate', {
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
    const res = await fetch('/api/jobs', {
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
      const res = await fetch(`/api/jobs/${currentJob}`);
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
  await fetch(`/api/jobs/${currentJob}/cancel`, { method: 'POST' }).catch(() => {});
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

  const src = `/api/jobs/${job.id}/audio`;
  playerEl.src = src;
  downloadEl.href = `${src}?download=1`;
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
loadConfig().catch((err) => showError('Could not load settings: ' + err.message));
onTextChanged();
