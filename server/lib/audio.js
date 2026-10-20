import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let ffmpegAvailable = null;

/** Detect ffmpeg once; used to stitch MP3 chunks cleanly when present. */
export function hasFfmpeg() {
  if (ffmpegAvailable === null) {
    try {
      const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
      ffmpegAvailable = r.status === 0;
    } catch {
      ffmpegAvailable = false;
    }
  }
  return ffmpegAvailable;
}

/**
 * Combine per-chunk audio buffers into a single buffer.
 *   - mp3: use ffmpeg concat when available (gapless, clean headers); otherwise
 *          fall back to byte concatenation, which browsers play fine for
 *          same-settings MP3 streams.
 *   - wav: merge the PCM payloads and write one correct WAV header.
 */
export async function combineAudio(buffers, format) {
  const parts = buffers.filter((b) => b && b.length);
  if (parts.length === 0) return Buffer.alloc(0);
  if (parts.length === 1) return parts[0];

  if (format === 'wav') return combineWav(parts);

  if (hasFfmpeg()) {
    try {
      return await ffmpegConcat(parts, format);
    } catch {
      // fall through to naive concat
    }
  }
  return Buffer.concat(parts);
}

async function ffmpegConcat(parts, format) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mr-concat-'));
  try {
    const files = [];
    for (let i = 0; i < parts.length; i++) {
      const f = path.join(dir, `p${String(i).padStart(5, '0')}.${format}`);
      await fs.writeFile(f, parts[i]);
      files.push(f);
    }
    const listFile = path.join(dir, 'list.txt');
    await fs.writeFile(listFile, files.map((f) => `file '${f}'`).join('\n'));
    const out = path.join(dir, `out.${format}`);

    await new Promise((resolve, reject) => {
      const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', out];
      const ff = spawn('ffmpeg', args, { stdio: 'ignore' });
      ff.on('error', reject);
      ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg exit ' + code))));
    });

    return await fs.readFile(out);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function combineWav(parts) {
  const pcms = parts.map(readWavPcm).filter(Boolean);
  if (pcms.length === 0) return Buffer.concat(parts);
  const { sampleRate, channels, bitsPerSample } = pcms[0];
  const data = Buffer.concat(pcms.map((p) => p.pcm));
  return encodeWav(data, { sampleRate, channels, bitsPerSample });
}

function readWavPcm(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return null;
  // Walk chunks to find "fmt " and "data".
  let offset = 12;
  let fmt = null;
  let pcm = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      fmt = {
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      pcm = buf.subarray(body, body + size);
    }
    offset = body + size + (size % 2); // chunks are word-aligned
  }
  if (!fmt || !pcm) return null;
  return { ...fmt, pcm };
}

/** Build a 16-bit PCM mono/stereo WAV file from raw sample bytes. */
export function encodeWav(pcm, { sampleRate = 22050, channels = 1, bitsPerSample = 16 } = {}) {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
