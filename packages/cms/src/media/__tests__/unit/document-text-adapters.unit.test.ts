import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createUnpdfDocumentTextExtractor } from '../../plugins/document-text/unpdf.js';
import { createMammothDocumentTextExtractor } from '../../plugins/document-text/mammoth.js';
import { DocumentTextExtractionError } from '../../document-text.js';
import { MediaValidationError } from '../../types.js';
import { tinyDocx, fixtureArchiveReader } from '../fixtures/document-text.js';

const limits = { maxPages: 2, maxCharacters: 100 };

test('optional libraries are lazy and missing peers produce typed install guidance', async () => {
  let loads = 0;
  const loadModule = async () => { loads++; throw new Error('module missing'); };
  const extractors = [createUnpdfDocumentTextExtractor({}, { loadModule }),
    createMammothDocumentTextExtractor({ archiveReader: fixtureArchiveReader }, { loadModule })];
  assert.equal(loads, 0);
  for (const [i, extractor] of extractors.entries()) {
    const install = ['unpdf', 'mammoth'][i];
    await assert.rejects(extractor.extract({ bytes: tinyDocx, limits }), (error: unknown) => {
      assert.ok(error instanceof DocumentTextExtractionError);
      assert.equal(error.code, 'DOCUMENT_TEXT_UNAVAILABLE');
      assert.equal(error.install, install);
      assert.equal(error.message, `extraction unavailable — install ${install}`);
      return true;
    });
  }
  assert.equal(loads, 2);
});

test('PDF visits only bounded pages, cleans up and reports omitted pages', async () => {
  const visited: number[] = [];
  let destroyed = 0;
  let cleaned = 0;
  const extractor = createUnpdfDocumentTextExtractor({}, { loadModule: async () => ({
    async getDocumentProxy(bytes, options) {
      assert.equal(options.isEvalSupported, false);
      assert.equal(options.useWorkerFetch, false);
      assert.equal(options.useWasm, false);
      assert.notEqual(bytes, tinyDocx);
      return { numPages: 3, async getPage(number) {
        visited.push(number);
        return { async getTextContent() { return { items: [{ str: `page${number}`, hasEOL: true }] }; }, cleanup() { cleaned++; } };
      }, loadingTask: { async destroy() { destroyed++; } } };
    },
  }) });
  assert.deepEqual(await extractor.extract({ bytes: tinyDocx, limits }), {
    text: 'page1\n\npage2\n', truncated: true, pagesRead: 2, totalPages: 3 });
  assert.deepEqual(visited, [1, 2]);
  assert.equal(cleaned, 2);
  assert.equal(destroyed, 1);
});

test('PDF character cap preserves Unicode and destroys the document on parser failure', async () => {
  let destroyed = 0;
  let fail = false;
  const extractor = createUnpdfDocumentTextExtractor({}, { loadModule: async () => ({ async getDocumentProxy() {
    return { numPages: 1, async getPage() { return {
      async getTextContent() { if (fail) throw new Error('invalid PDF'); return { items: [{ str: 'a🙂b' }] }; }, cleanup() {},
    }; }, loadingTask: { async destroy() { destroyed++; } } };
  } }) });
  assert.deepEqual(await extractor.extract({ bytes: tinyDocx, limits: { ...limits, maxCharacters: 2 } }), {
    text: 'a', truncated: true, pagesRead: 1, totalPages: 1 });
  fail = true;
  await assert.rejects(extractor.extract({ bytes: tinyDocx, limits }), (error: unknown) =>
    error instanceof DocumentTextExtractionError && error.code === 'DOCUMENT_TEXT_FAILED');
  assert.equal(destroyed, 2);
});

test('DOCX returns capped raw text and reuses archive validation before parsing', async () => {
  let calls = 0;
  const extractor = createMammothDocumentTextExtractor({ archiveReader: fixtureArchiveReader }, { loadModule: async () => ({ default: {
    async extractRawText(input) {
      calls++;
      assert.deepEqual(input.buffer, tinyDocx);
      return { value: 'Hello 🙂 Library\n\n' };
    },
  } }) });
  assert.deepEqual(await extractor.extract({ bytes: tinyDocx, limits: { ...limits, maxCharacters: 7 } }), { text: 'Hello ', truncated: true });
  await assert.rejects(extractor.extract({ bytes: Buffer.from('not a zip'), limits }), MediaValidationError);
  assert.equal(calls, 1);
});

test('Word parser failures are typed and archive expansion bombs never reach the parser', async () => {
  const extractor = createMammothDocumentTextExtractor({ archiveReader: fixtureArchiveReader }, { loadModule: async () => ({
    async extractRawText() { throw new Error('invalid Word document'); },
  }) });
  await assert.rejects(extractor.extract({ bytes: tinyDocx, limits }), (error: unknown) =>
    error instanceof DocumentTextExtractionError && error.code === 'DOCUMENT_TEXT_FAILED');
  let calls = 0;
  const bomb = createMammothDocumentTextExtractor({ archiveReader: { async *entries() {
    yield { kind: 'file', entryPath: 'word/document.xml', declaredSize: 40 * 1024 * 1024 + 1,
      compressedSize: 1, async *openReadStream() { throw new Error('must reject before decompressing'); } };
  } } }, { loadModule: async () => ({ async extractRawText() { calls++; return { value: '' }; } }) });
  await assert.rejects(bomb.extract({ bytes: tinyDocx, limits }), MediaValidationError);
  assert.equal(calls, 0);
});
