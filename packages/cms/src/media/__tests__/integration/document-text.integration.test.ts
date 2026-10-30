import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'vitest';
import { createUnpdfDocumentTextExtractor } from '../../plugins/document-text/unpdf.js';
import { createMammothDocumentTextExtractor } from '../../plugins/document-text/mammoth.js';
import { tinyPdf, tinyDocx, fixtureArchiveReader } from '../fixtures/document-text.js';

/** Skip only absent optional packages. Broken installations and extraction failures must fail. */
function installed(name: string): boolean {
  try { createRequire(import.meta.url).resolve(name); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') return false;
    throw error;
  }
}
const limits = { maxPages: 2, maxCharacters: 1000 };

test.skipIf(!installed('unpdf'))('real optional PDF adapter reads the tiny text fixture', async () => {
  const result = await createUnpdfDocumentTextExtractor({}).extract({ bytes: tinyPdf, limits });
  assert.equal(result.text.trim(), 'Hello Library');
  assert.equal(result.truncated, false);
  assert.equal(result.pagesRead, 1);
  assert.equal(result.totalPages, 1);
});

test.skipIf(!installed('mammoth'))('real optional Word adapter reads the tiny DOCX fixture', async () => {
  const result = await createMammothDocumentTextExtractor({ archiveReader: fixtureArchiveReader }).extract({ bytes: tinyDocx, limits });
  assert.equal(result.text, 'Hello Library\n\n');
  assert.equal(result.truncated, false);
});
