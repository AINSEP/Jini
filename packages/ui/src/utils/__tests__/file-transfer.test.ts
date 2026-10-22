/**
 * Direct tests for `utils/file-transfer.ts`, filling what `asset-tree-browser/__tests__/rules.test.ts`
 * (which reaches it through a re-export) leaves open: the AVIF extension, and the exact synthetic
 * name, type and lastModified of an unnamed pasted file under a pinned clock.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extensionForMimeType, filesFromClipboardData, normalizePastedFile } from '../file-transfer.js';

afterEach(() => { vi.useRealTimers(); });

describe('extensionForMimeType', () => {
  it('maps image/avif to .avif', () => {
    expect(extensionForMimeType('image/avif')).toBe('.avif');
  });
  it('does not match by prefix or case', () => {
    expect(extensionForMimeType('image/png; charset=binary')).toBe('');
    expect(extensionForMimeType('IMAGE/PNG')).toBe('');
  });
});

describe('normalizePastedFile', () => {
  it('names an unnamed paste pasted-<UTC second stamp><ext>, keeping its bytes, type and lastModified', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-04T13:05:09.876Z') });
    const original = new File(['abc'], '', { type: 'image/avif', lastModified: 1_234_567 });
    const renamed = normalizePastedFile(original);
    expect(renamed.name).toBe('pasted-2026-10-04T13-05-09.avif');
    expect(renamed.type).toBe('image/avif');
    expect(renamed.lastModified).toBe(1_234_567);
    vi.useRealTimers(); // jsdom's FileReader schedules its load on a timer
    expect(await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(renamed); })).toBe('abc');
  });

  it('treats a whitespace-only name as unnamed and leaves no extension for an unknown type', () => {
    vi.useFakeTimers({ now: new Date('2026-01-02T03:04:05.000Z') });
    expect(normalizePastedFile(new File(['x'], '   ', { type: 'application/x-unknown' })).name).toBe('pasted-2026-01-02T03-04-05');
  });

  it('applies the rename to clipboard files from both the files list and the items list', () => {
    vi.useFakeTimers({ now: new Date('2026-01-02T03:04:05.000Z') });
    const unnamed = new File(['x'], '', { type: 'image/png' });
    const viaFiles = filesFromClipboardData({ files: [unnamed], items: [] } as unknown as DataTransfer);
    expect(viaFiles.map((f) => f.name)).toEqual(['pasted-2026-01-02T03-04-05.png']);
    const viaItems = filesFromClipboardData({ files: [], items: [
      { kind: 'string', getAsFile: () => null },
      { kind: 'file', getAsFile: () => null },
      { kind: 'file', getAsFile: () => unnamed },
    ] } as unknown as DataTransfer);
    expect(viaItems.map((f) => f.name)).toEqual(['pasted-2026-01-02T03-04-05.png']);
    expect(filesFromClipboardData(null)).toEqual([]);
  });
});
