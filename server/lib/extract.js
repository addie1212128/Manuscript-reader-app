import { createRequire } from 'node:module';
import mammoth from 'mammoth';

// pdf-parse is CommonJS and, when required as its package index, runs a little
// self-test if it thinks it's the main module. Pull in the inner lib directly
// to avoid that, and load it lazily so a missing/odd PDF never breaks startup.
const require = createRequire(import.meta.url);

/**
 * Normalise extracted text so it reads well aloud:
 *  - strip a leading byte-order mark
 *  - collapse Windows line endings
 *  - join lines that were hard-wrapped mid-sentence (common in PDFs)
 *  - keep paragraph breaks (blank lines)
 *  - squeeze runs of spaces
 */
export function cleanText(raw) {
  let text = String(raw || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');

  // Rejoin words split across a line break by a hyphen: "beau-\ntiful" -> "beautiful"
  text = text.replace(/(\w)-\n(\w)/g, '$1$2');

  // Collapse single line breaks inside a paragraph into spaces, but preserve
  // blank-line paragraph separators (two or more newlines).
  text = text.replace(/\n{2,}/g, '\u0000'); // mark paragraph breaks
  text = text.replace(/\n/g, ' '); // soft wraps -> spaces
  text = text.replace(/\u0000/g, '\n\n'); // restore paragraph breaks

  text = text.replace(/[ \t]{2,}/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

/**
 * Extract plain text from an uploaded manuscript file buffer.
 * Supports .txt / .md, .docx, and .pdf. Returns cleaned, readable text.
 */
export async function extractText(buffer, filename = '') {
  const name = filename.toLowerCase();

  if (name.endsWith('.docx')) {
    const { value } = await mammoth.extractRawText({ buffer });
    return cleanText(value);
  }

  if (name.endsWith('.pdf')) {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return cleanText(data.text);
  }

  if (name.endsWith('.doc')) {
    throw new Error(
      'Old-style .doc files are not supported. Please re-save the document as .docx, .pdf, or .txt.'
    );
  }

  // Treat everything else (.txt, .md, unknown) as UTF-8 text.
  return cleanText(buffer.toString('utf8'));
}
