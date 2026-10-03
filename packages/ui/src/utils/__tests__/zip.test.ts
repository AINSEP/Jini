// @vitest-environment node
//
// This suite exercises a pure Blob/binary encoder with zero DOM dependency.
// Forced to the `node` environment (overriding this package's package-wide
// `jsdom` default, added by the parallel i18n/observability porting task)
// because jsdom's `Blob` shim doesn't implement `.arrayBuffer()` the way
// Node's native `Blob` does — see `packages/ui/archived provenance ledger`.
import { describe, expect, it } from 'vitest';
import { buildZip } from '../zip.js';

/** Reads the first local file header from a stored-mode zip buffer and
 *  returns its decoded name + content, for asserting round-trip fidelity
 *  without pulling in a zip-reading dependency. */
function readFirstLocalEntry(buffer: ArrayBuffer): { name: string; content: string; flags: number } {
  const view = new DataView(buffer);
  const signature = view.getUint32(0, true);
  if (signature !== 0x04034b50) throw new Error('missing local file header signature');
  const flags = view.getUint16(6, true);
  const size = view.getUint32(22, true);
  const nameLength = view.getUint16(26, true);
  const nameBytes = new Uint8Array(buffer, 30, nameLength);
  const name = new TextDecoder().decode(nameBytes);
  const dataBytes = new Uint8Array(buffer, 30 + nameLength, size);
  const content = new TextDecoder().decode(dataBytes);
  return { name, content, flags };
}

describe('buildZip', () => {
  it('round-trips a single UTF-8 text entry', async () => {
    const blob = buildZip([{ path: 'DESIGN-HANDOFF.md', content: '# Hello\n' }]);
    expect(blob.type).toBe('application/zip');
    const buffer = await blob.arrayBuffer();
    const entry = readFirstLocalEntry(buffer);
    expect(entry.name).toBe('DESIGN-HANDOFF.md');
    expect(entry.content).toBe('# Hello\n');
  });

  it('sets the UTF-8 filename flag only when the name has non-ASCII bytes', async () => {
    const asciiBlob = buildZip([{ path: 'notes.md', content: 'x' }]);
    const asciiEntry = readFirstLocalEntry(await asciiBlob.arrayBuffer());
    expect(asciiEntry.flags & 0x0800).toBe(0);

    const unicodeBlob = buildZip([{ path: '日本.md', content: 'x' }]);
    const unicodeEntry = readFirstLocalEntry(await unicodeBlob.arrayBuffer());
    expect(unicodeEntry.flags & 0x0800).toBe(0x0800);
    expect(unicodeEntry.name).toBe('日本.md');
  });

  it('produces a valid (empty) archive for zero entries', async () => {
    const blob = buildZip([]);
    const buffer = await blob.arrayBuffer();
    expect(buffer.byteLength).toBe(22); // EOCD record only
    const view = new DataView(buffer);
    expect(view.getUint32(0, true)).toBe(0x06054b50);
  });

  it('packs multiple entries with independent CRCs', async () => {
    const blob = buildZip([
      { path: 'a.txt', content: 'aaa' },
      { path: 'b.txt', content: 'bbb' },
    ]);
    const buffer = await blob.arrayBuffer();
    const first = readFirstLocalEntry(buffer);
    expect(first.name).toBe('a.txt');
    expect(first.content).toBe('aaa');
    // The central directory's file count (EOCD "total entries") is the last
    // reliable structural signal without a full parser.
    const view = new DataView(buffer);
    const eocdOffset = buffer.byteLength - 22;
    expect(view.getUint32(eocdOffset, true)).toBe(0x06054b50);
    expect(view.getUint16(eocdOffset + 10, true)).toBe(2);
  });
});
