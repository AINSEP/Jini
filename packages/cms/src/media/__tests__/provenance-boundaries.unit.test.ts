import { describe, expect, it } from 'vitest';
import { safeMediaProvenance } from '../provenance.js';
import { MediaValidationError, type MediaProvenance } from '../types.js';

describe('safe media origin metadata', () => {
  it('defaults to upload and keeps explicit origins without adding a path', () => {
    expect(safeMediaProvenance({})).toEqual({ kind: 'upload' });
    expect(safeMediaProvenance({ source: { kind: 'upload' } })).toEqual({ kind: 'upload' });
    expect(safeMediaProvenance({ source: { kind: 'generated' } })).toEqual({ kind: 'generated' });
  });

  it.each(['upload', 'generated', 'picked-folder'] as const)('normalizes safe relative %s paths without mutating input', kind => {
    const source = { kind, path: 'brand\\caf%C3%A9.png' };
    expect(safeMediaProvenance({ source })).toEqual({ kind, path: 'brand/café.png' });
    expect(source).toEqual({ kind, path: 'brand\\caf%C3%A9.png' });
  });

  it.each(['%', '/private/file', '~/file', 'C:\\file', '../file', './file', 'a/../file',
    'a//file', 'a/', 'a%00file', 'a%7ffile', 'a?secret', 'a#secret', 'a%252efile', ''])
    ('rejects unsafe local path %j', path => {
      expect(() => safeMediaProvenance({ source: { kind: 'picked-folder', path } })).toThrow(MediaValidationError);
      expect(() => safeMediaProvenance({ source: { kind: 'generated', path } }))
        .toThrow('source path must be a safe relative path');
    });

  it.each(['http', 'https'])('removes credentials, query and fragment from %s origins', protocol => {
    const source = { kind: 'url' as const, url: `${protocol}://user:password@example.com/a%20b?token=secret#private` };
    expect(safeMediaProvenance({ source })).toEqual({ kind: 'url', url: `${protocol}://example.com/a%20b` });
    expect(source.url).toContain('user:password@');
  });

  it.each(['not a URL', 'file:///private/file', 'data:text/plain,secret'])('rejects invalid URL origin %j', url => {
    expect(() => safeMediaProvenance({ source: { kind: 'url', url } })).toThrow('source URL must be HTTP or HTTPS');
  });

  it('rejects an unknown runtime kind', () => {
    expect(() => safeMediaProvenance({ source: { kind: 'external' } as unknown as MediaProvenance }))
      .toThrow('unknown source kind');
  });
});
