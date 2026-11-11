import { describe, expect, it } from 'vitest';
import { validateHtmlArtifact } from '../index.js';

const HTML_DOC = '<!doctype html><html><head></head><body><h1>Hello there, world</h1></body></html>';

describe('artifacts/validate', () => {
  it('accepts a complete HTML document', () => {
    expect(validateHtmlArtifact({ content: HTML_DOC })).toEqual({ ok: true });
  });

  it('rejects prose that merely mentions <html> mid-sentence', () => {
    const result = validateHtmlArtifact({ content: 'I updated the <html lang> attribute for you, all set!' });
    expect(result.ok).toBe(false);
  });

  it('rejects a too-short empty-body document (fixture-grade, not a real deliverable)', () => {
    const result = validateHtmlArtifact({ content: '<!doctype html><html><body></body></html>' });
    expect(result.ok).toBe(false);
  });

  it('rejects a document whose asset URL points at a reserved workspace-storage path', () => {
    const doc = '<!doctype html><html><body><img src=".workspace/secret.png" alt="leaked-asset-reference-padding"></body></html>';
    const result = validateHtmlArtifact({ content: doc });
    expect(result.ok).toBe(false);
  });

  it('rejects genuinely empty content (distinct from "too short")', () => {
    expect(validateHtmlArtifact({ content: '' })).toEqual({ ok: false, reason: 'empty content' });
    expect(validateHtmlArtifact({ content: '   \n\t  ' })).toEqual({ ok: false, reason: 'empty content' });
  });

  it('rejects long prose that never starts with <!doctype html> or <html (distinct from the too-short case)', () => {
    const prose = 'This is a long explanation about what I changed in the document, well over the minimum length threshold.';
    const result = validateHtmlArtifact({ content: prose });
    expect(result).toEqual({
      ok: false,
      reason: 'content does not start with <!doctype html> or <html — looks like prose, not a complete HTML document',
    });
  });

  it('rejects a reserved workspace path referenced from a style="" attribute', () => {
    const doc = `<!doctype html><html><body><div style="background: url('.workspace/secret.png')">padding to clear the minimum length threshold</div></body></html>`;
    expect(validateHtmlArtifact({ content: doc }).ok).toBe(false);
  });

  it('rejects a reserved workspace path referenced from a <style> block via url(...)', () => {
    const doc = `<!doctype html><html><head><style>body { background: url(.tmp/secret.png); }</style></head><body>padding to clear the minimum length threshold</body></html>`;
    expect(validateHtmlArtifact({ content: doc }).ok).toBe(false);
  });

  it('rejects a reserved workspace path referenced from a <style> block via @import', () => {
    const doc = `<!doctype html><html><head><style>@import ".live-artifacts/theme.css";</style></head><body>padding to clear the minimum length threshold</body></html>`;
    expect(validateHtmlArtifact({ content: doc }).ok).toBe(false);
  });

  it('rejects a reserved workspace path buried among multiple srcset candidates', () => {
    const doc = `<!doctype html><html><body><img srcset="a.png 1x, .workspace/b.png 2x" src="a.png" alt="padding to clear the minimum length threshold"></body></html>`;
    expect(validateHtmlArtifact({ content: doc }).ok).toBe(false);
  });

  it('still rejects a reserved workspace path even when the attribute value carries a query string', () => {
    const doc = `<!doctype html><html><body><img src=".workspace/secret.png?cachebust=1" alt="padding to clear the minimum length threshold"></body></html>`;
    expect(validateHtmlArtifact({ content: doc }).ok).toBe(false);
  });

  it('accepts a document whose URLs are ordinary external/relative paths, not reserved ones', () => {
    const doc = `<!doctype html><html><head><style>body { background: url(https://example.com/x.png); }</style></head><body><img srcset="a.png 1x, b.png 2x" src="c.png" alt="padding to clear the minimum length threshold"></body></html>`;
    expect(validateHtmlArtifact({ content: doc })).toEqual({ ok: true });
  });

  it('detects a reserved workspace path in single-quoted and unquoted URL attribute values, not just double-quoted', () => {
    const singleQuoted = `<!doctype html><html><body><img src='.workspace/secret.png' alt="padding to clear the minimum length threshold"></body></html>`;
    expect(validateHtmlArtifact({ content: singleQuoted }).ok).toBe(false);

    const unquoted = `<!doctype html><html><body><img src=.workspace/secret.png alt="padding to clear the minimum length threshold"></body></html>`;
    expect(validateHtmlArtifact({ content: unquoted }).ok).toBe(false);
  });

  it('detects a reserved workspace path in a single-quoted or unquoted style="" attribute value', () => {
    const singleQuoted = `<!doctype html><html><body><div style='background:url(".workspace/secret.png")'>padding to clear the minimum length threshold</div></body></html>`;
    expect(validateHtmlArtifact({ content: singleQuoted }).ok).toBe(false);

    const unquoted = `<!doctype html><html><body><div style=background:url(.workspace/secret.png)>padding to clear the minimum length threshold</div></body></html>`;
    expect(validateHtmlArtifact({ content: unquoted }).ok).toBe(false);
  });

  it('does not let a comma embedded in a data: URI srcset candidate cause a false split, but still flags a later reserved candidate', () => {
    const doc = `<!doctype html><html><body><img srcset="data:image/png;base64,ABCD== 1x, .workspace/leak.png 2x" src="a.png" alt="padding to clear the minimum length threshold"></body></html>`;
    expect(validateHtmlArtifact({ content: doc }).ok).toBe(false);
  });

  describe('srcset candidate splitting', () => {
    const RESERVED = { ok: false, reason: 'content references a reserved internal workspace-storage path' };
    const withSrcset = (srcset: string) =>
      validateHtmlArtifact({ content: `<!doctype html><html><body><img srcset="${srcset}" alt="padding to clear the minimum length threshold"></body></html>` });

    it('keeps a data: URI candidate whole across its embedded comma (no false reserved candidate after it)', () => {
      expect(withSrcset('data:image/png;base64,.workspace/x 1x')).toEqual({ ok: true });
    });

    it('splits plain candidates on a comma even with no whitespace between them', () => {
      expect(withSrcset('a.png,.workspace/b.png')).toEqual(RESERVED);
    });

    it('skips leading commas and whitespace before the first candidate', () => {
      expect(withSrcset(' , ,  .tmp/a.png 1x')).toEqual(RESERVED);
    });

    it('ends a data: URI candidate at a comma that follows whitespace', () => {
      expect(withSrcset('data:image/png;base64,AA 1x,.live-artifacts/c.png 2x')).toEqual(RESERVED);
    });

    it('re-detects a data: URI for each new candidate after a split (no false split inside a later data: URI)', () => {
      expect(withSrcset('a.png 1x, data:image/png;base64,.workspace/x 2x')).toEqual({ ok: true });
    });

    it('accepts a srcset of ordinary candidates with a trailing comma', () => {
      expect(withSrcset('a.png 1x, b.png 2x,')).toEqual({ ok: true });
    });
  });
});

// Stryker L5 (2026-10-25): the min-length boundary, the BOM strip, and each reserved-path site
// (srcset splitting, style attribute, <style> block, @import, isLocalPathLike) survived on its own.
describe('validateHtmlArtifact — boundaries and reserved-path sites (F3)', () => {
  const doc = (inner: string) => `<!doctype html><html><head></head><body>${inner}</body></html>`.padEnd(80, ' ');
  const reserved = { ok: false, reason: 'content references a reserved internal workspace-storage path' };

  it('63 chars is too short, 64 is enough; a leading BOM is not counted', () => {
    const base = '<!doctype html>';
    const at = (n: number) => base + 'x'.repeat(n - base.length);
    expect(validateHtmlArtifact({ content: at(63) })).toEqual({ ok: false, reason: 'content too short to be HTML (got 63 chars, need ≥64)' });
    expect(validateHtmlArtifact({ content: at(64) })).toEqual({ ok: true });
    expect(validateHtmlArtifact({ content: '﻿' + at(64) })).toEqual({ ok: true });
    expect(validateHtmlArtifact({ content: '﻿' + at(63) })).toMatchObject({ ok: false, reason: expect.stringContaining('got 63') });
    expect(validateHtmlArtifact({ content: ' \n﻿' })).toMatchObject({ ok: false });
    expect(validateHtmlArtifact({ content: '﻿  ' })).toEqual({ ok: false, reason: 'empty content' });
  });

  it.each([
    ['img src', '<img src=".workspace/a.png">'],
    ['unquoted href', '<a href=./.tmp/x>x</a>'],
    ['single-quoted poster', "<video poster='/.live-artifacts/p.png'></video>"],
    ['srcset second candidate', '<img srcset="ok.png 1x, .tmp/b.png 2x">'],
    ['srcset after a data: url with commas', '<img srcset="data:image/png;base64,AA,BB 1x, .workspace/c.png 2x">'],
    ['style attribute url()', '<div style="background:url(.tmp/bg.png)"></div>'],
    ['style attribute single-quoted', "<div style='background:url(\".workspace/x.png\")'></div>"],
    ['<style> block url()', '<style>body{background:url(\'.tmp/a.png\')}</style>'],
    ['<style> block @import string', '<style>@import ".workspace/x.css";</style>'],
    ['<style> block @import url()', '<style>@import url(.live-artifacts/x.css);</style>'],
    ['reserved dir followed by query', '<img src=".tmp?x=1">'],
    ['case-insensitive', '<img src=".TMP/a.png">'],
  ])('rejects a reserved path in %s', (_label, inner) => {
    expect(validateHtmlArtifact({ content: doc(inner) })).toEqual(reserved);
  });

  it.each([
    ['absolute URL with the segment', '<img src="https://cdn.example/.tmp/a.png">'],
    ['protocol-relative', '<img src="//cdn.example/.tmp/a.png">'],
    ['fragment-only', '<a href="#.tmp">x</a>'],
    ['segment only in the query', '<img src="a.png?p=.tmp/x">'],
    ['segment only in the fragment', '<a href="page.html#/.workspace">x</a>'],
    ['lookalike segment', '<img src=".tmpfile/a.png">'],
    ['lookalike prefix', '<img src="x.tmp/a.png">'],
    ['empty src', '<img src="">'],
    ['srcset of safe candidates only', '<img srcset="a.png 1x, b.png 2x">'],
    ['srcset data: url containing the word', '<img srcset="data:text/plain,.tmp/x 1x">'],
    ['text, not an attribute', '<p>see .tmp/a.png</p>'],
  ])('allows %s', (_label, inner) => {
    expect(validateHtmlArtifact({ content: doc(inner) })).toEqual({ ok: true });
  });
});
