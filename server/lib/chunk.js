/**
 * Split a manuscript into chunks that stay under a provider's per-request
 * character limit, breaking on natural boundaries wherever possible:
 * paragraphs first, then sentences, then (only if a single sentence is
 * enormous) on whitespace. Order is always preserved.
 */
export function chunkText(text, maxChars = 3500) {
  const clean = String(text || '').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const paragraphs = clean.split(/\n{2,}/);
  const chunks = [];
  let current = '';

  const push = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = '';
  };

  for (const para of paragraphs) {
    const piece = para.trim();
    if (!piece) continue;

    // Paragraph fits in whatever room is left in the current chunk.
    if (current && current.length + piece.length + 2 <= maxChars) {
      current += '\n\n' + piece;
      continue;
    }

    // Paragraph fits on its own.
    if (piece.length <= maxChars) {
      push();
      current = piece;
      continue;
    }

    // Paragraph too big: flush what we have, then break it by sentence.
    push();
    for (const sentence of splitSentences(piece)) {
      if (sentence.length > maxChars) {
        // A single pathological sentence: hard-split on whitespace.
        for (const part of splitBySize(sentence, maxChars)) {
          if (current && current.length + part.length + 1 > maxChars) push();
          current = current ? current + ' ' + part : part;
        }
      } else if (current && current.length + sentence.length + 1 > maxChars) {
        push();
        current = sentence;
      } else {
        current = current ? current + ' ' + sentence : sentence;
      }
    }
  }

  push();
  return chunks;
}

function splitSentences(text) {
  // Break after sentence-ending punctuation followed by whitespace.
  const parts = text.match(/[^.!?]+(?:[.!?]+(?:["')\]]+)?|\s*$)/g);
  return (parts || [text]).map((s) => s.trim()).filter(Boolean);
}

function splitBySize(text, maxChars) {
  const words = text.split(/\s+/);
  const out = [];
  let buf = '';
  for (const w of words) {
    if (buf && buf.length + w.length + 1 > maxChars) {
      out.push(buf);
      buf = '';
    }
    // A single word longer than the limit still has to be cut.
    if (w.length > maxChars) {
      if (buf) {
        out.push(buf);
        buf = '';
      }
      for (let i = 0; i < w.length; i += maxChars) out.push(w.slice(i, i + maxChars));
      continue;
    }
    buf = buf ? buf + ' ' + w : w;
  }
  if (buf) out.push(buf);
  return out;
}
