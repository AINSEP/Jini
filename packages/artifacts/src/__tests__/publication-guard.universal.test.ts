import { afterEach, describe, expect, it, vi } from 'vitest';

// A universal entry must load without a Node built-in polyfill.
vi.mock('node:buffer', () => { throw new Error('Node buffer is unavailable'); });

afterEach(() => vi.unstubAllGlobals());

describe('publication guard in a browser host', () => {
  it('loads and guards UTF-8 byte views without Buffer, retaining a leading BOM and replacing malformed bytes', async () => {
    const { assertArtifactPublicationAllowed, findBlockedPlaceholders, ArtifactPublicationBlockedError } =
      await import('../index.js');
    vi.stubGlobal('Buffer', undefined);
    const encoded = new TextEncoder().encode('outside\uFEFF待確認�outside');
    const value = encoded.subarray('outside'.length, encoded.length - 'outside'.length);
    const config = { guardedKinds: new Set(['html']), blockedPlaceholders: ['\uFEFF待確認', '�', 'outside'] };

    expect(findBlockedPlaceholders({ value, config })).toEqual(['\uFEFF待確認', '�']);
    expect(findBlockedPlaceholders({ value: new Uint8Array([0xff]), config })).toEqual(['�']);
    expect(() => assertArtifactPublicationAllowed({ kind: 'html', value, config })).toThrow(ArtifactPublicationBlockedError);
    expect(() => assertArtifactPublicationAllowed({ kind: 'html', value: new TextEncoder().encode('clean'), config })).not.toThrow();
  });
});
