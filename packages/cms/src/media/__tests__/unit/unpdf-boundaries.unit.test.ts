import { expect, it, vi } from 'vitest';
import { createUnpdfDocumentTextExtractor } from '../../plugins/document-text/unpdf.js';
import { MAX_DOCUMENT_BYTES } from '../../document-ingress.js';
import { DocumentTextExtractionError } from '../../document-text.js';
import { MediaValidationError } from '../../types.js';

it('extracts a PDF above the former 10 MiB cap within the shared upload limit', async () => {
  const getDocumentProxy = vi.fn(async (bytes: Uint8Array) => {
    expect(bytes.byteLength).toBe(10 * 1024 * 1024 + 1);
    return { numPages: 0, getPage: vi.fn(), loadingTask: { destroy: vi.fn(async () => {}) } };
  });
  const extractor = createUnpdfDocumentTextExtractor({}, { loadModule: async () => ({ getDocumentProxy }) });
  await expect(extractor.extract({ bytes: new Uint8Array(10 * 1024 * 1024 + 1), limits: { maxPages: 1, maxCharacters: 100 } }))
    .resolves.toEqual({ text: '', truncated: false, pagesRead: 0, totalPages: 0 });
  expect(getDocumentProxy).toHaveBeenCalledTimes(1);
});

it.each([1, 2])('does not report truncation when the character cap exactly fits all %i pages', async numPages => {
  const cleanup = vi.fn();
  const destroy = vi.fn(async () => {});
  const getPage = vi.fn(async (number: number) => ({
    getTextContent: async () => ({ items: [{}, { str: number === 1 ? 'ab' : 'cd' }] }), cleanup,
  }));
  const extractor = createUnpdfDocumentTextExtractor({}, { loadModule: async () => ({
    getDocumentProxy: async () => ({ numPages, getPage, loadingTask: { destroy } }),
  }) });
  const text = numPages === 1 ? 'ab' : 'ab\ncd';
  await expect(extractor.extract({ bytes: new Uint8Array([1]), limits: { maxPages: 3, maxCharacters: text.length } }))
    .resolves.toEqual({ text, truncated: false, pagesRead: numPages, totalPages: numPages });
  expect(getPage.mock.calls).toEqual(numPages === 1 ? [[1]] : [[1], [2]]);
  expect(cleanup).toHaveBeenCalledTimes(numPages);
  expect(destroy).toHaveBeenCalledTimes(1);
});

it('reports truncation at an exact character boundary if later pages remain, without reading them', async () => {
  const getPage = vi.fn(async () => ({ getTextContent: async () => ({ items: [{ str: 'ab' }] }), cleanup() {} }));
  const destroy = vi.fn(async () => {});
  const extractor = createUnpdfDocumentTextExtractor({}, { loadModule: async () => ({
    getDocumentProxy: async () => ({ numPages: 2, getPage, loadingTask: { destroy } }),
  }) });
  await expect(extractor.extract({ bytes: new Uint8Array([1]), limits: { maxPages: 2, maxCharacters: 2 } }))
    .resolves.toEqual({ text: 'ab', truncated: true, pagesRead: 1, totalPages: 2 });
  expect(getPage.mock.calls).toEqual([[1]]);
  expect(destroy).toHaveBeenCalledTimes(1);
});

it('rejects an oversized PDF before giving bytes to its parser', async () => {
  const getDocumentProxy = vi.fn();
  const loadModule = vi.fn(async () => ({ getDocumentProxy }));
  const extractor = createUnpdfDocumentTextExtractor({}, { loadModule });
  await expect(extractor.extract({ bytes: new Uint8Array(MAX_DOCUMENT_BYTES + 1), limits: { maxPages: 1, maxCharacters: 100 } }))
    .rejects.toMatchObject({ constructor: MediaValidationError, message: 'document exceeds the 50 MiB limit' });
  expect(loadModule).not.toHaveBeenCalled();
  expect(getDocumentProxy).not.toHaveBeenCalled();
});

it('wraps document teardown failures in the public extraction error', async () => {
  const cause = new Error('destroy failed');
  const extractor = createUnpdfDocumentTextExtractor({}, { loadModule: async () => ({ getDocumentProxy: async () => ({
    numPages: 0, getPage: vi.fn(), loadingTask: { destroy: async () => { throw cause; } },
  }) }) });
  await expect(extractor.extract({ bytes: new Uint8Array([1]), limits: { maxPages: 1, maxCharacters: 100 } }))
    .rejects.toBeInstanceOf(DocumentTextExtractionError);
});


it('cancellation destroys a PDF whose text operation is stalled', async () => {
  const controller = new AbortController();
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let stop!: (reason: unknown) => void;
  const held = new Promise<never>((_resolve, reject) => { stop = reject; });
  const destroy = vi.fn(async () => { stop(controller.signal.reason); });
  const extractor = createUnpdfDocumentTextExtractor({}, { loadModule: async () => ({ getDocumentProxy: async () => ({
    numPages: 1, getPage: async () => ({ getTextContent: () => { entered(); return held; }, cleanup() {} }),
    loadingTask: { destroy },
  }) }) });
  const extracting = extractor.extract({ bytes: new Uint8Array([1]), limits: { maxPages: 1, maxCharacters: 100 } }, { signal: controller.signal });
  await started;
  const result = extracting.catch(error => error);
  controller.abort(new Error('cancelled'));
  await Promise.resolve();
  expect(destroy).toHaveBeenCalledOnce();
  expect(await result).toBeInstanceOf(DocumentTextExtractionError);
});
