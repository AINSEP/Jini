import { describe, expect, it } from 'vitest';
import { validateHtmlArtifact } from '../../util/index.js';

const HTML_DOC = '<!doctype html><html><head></head><body><h1>Hello there, world</h1></body></html>';

describe('artifacts/validate', () => {
  it('accepts a complete HTML document', () => {
    expect(validateHtmlArtifact(HTML_DOC)).toEqual({ ok: true });
  });

  it('rejects prose that merely mentions <html> mid-sentence', () => {
    const result = validateHtmlArtifact('I updated the <html lang> attribute for you, all set!');
    expect(result.ok).toBe(false);
  });

  it('rejects a too-short empty-body document (fixture-grade, not a real deliverable)', () => {
    const result = validateHtmlArtifact('<!doctype html><html><body></body></html>');
    expect(result.ok).toBe(false);
  });

  it('rejects a document whose asset URL points at a reserved workspace-storage path', () => {
    const doc = '<!doctype html><html><body><img src=".workspace/secret.png" alt="leaked-asset-reference-padding"></body></html>';
    const result = validateHtmlArtifact(doc);
    expect(result.ok).toBe(false);
  });

  it('rejects genuinely empty content (distinct from "too short")', () => {
    expect(validateHtmlArtifact('')).toEqual({ ok: false, reason: 'empty content' });
    expect(validateHtmlArtifact('   \n\t  ')).toEqual({ ok: false, reason: 'empty content' });
  });

  it('rejects long prose that never starts with <!doctype html> or <html (distinct from the too-short case)', () => {
    const prose = 'This is a long explanation about what I changed in the document, well over the minimum length threshold.';
    const result = validateHtmlArtifact(prose);
    expect(result).toEqual({
      ok: false,
      reason: 'content does not start with <!doctype html> or <html — looks like prose, not a complete HTML document',
    });
  });

  it('rejects a reserved workspace path referenced from a style="" attribute', () => {
    const doc = `<!doctype html><html><body><div style="background: url('.workspace/secret.png')">padding to clear the minimum length threshold</div></body></html>`;
    expect(validateHtmlArtifact(doc).ok).toBe(false);
  });

  it('rejects a reserved workspace path referenced from a <style> block via url(...)', () => {
    const doc = `<!doctype html><html><head><style>body { background: url(.tmp/secret.png); }</style></head><body>padding to clear the minimum length threshold</body></html>`;
    expect(validateHtmlArtifact(doc).ok).toBe(false);
  });

  it('rejects a reserved workspace path referenced from a <style> block via @import', () => {
    const doc = `<!doctype html><html><head><style>@import ".live-artifacts/theme.css";</style></head><body>padding to clear the minimum length threshold</body></html>`;
    expect(validateHtmlArtifact(doc).ok).toBe(false);
  });

  it('rejects a reserved workspace path buried among multiple srcset candidates', () => {
    const doc = `<!doctype html><html><body><img srcset="a.png 1x, .workspace/b.png 2x" src="a.png" alt="padding to clear the minimum length threshold"></body></html>`;
    expect(validateHtmlArtifact(doc).ok).toBe(false);
  });

  it('still rejects a reserved workspace path even when the attribute value carries a query string', () => {
    const doc = `<!doctype html><html><body><img src=".workspace/secret.png?cachebust=1" alt="padding to clear the minimum length threshold"></body></html>`;
    expect(validateHtmlArtifact(doc).ok).toBe(false);
  });

  it('accepts a document whose URLs are ordinary external/relative paths, not reserved ones', () => {
    const doc = `<!doctype html><html><head><style>body { background: url(https://example.com/x.png); }</style></head><body><img srcset="a.png 1x, b.png 2x" src="c.png" alt="padding to clear the minimum length threshold"></body></html>`;
    expect(validateHtmlArtifact(doc)).toEqual({ ok: true });
  });

  it('detects a reserved workspace path in single-quoted and unquoted URL attribute values, not just double-quoted', () => {
    const singleQuoted = `<!doctype html><html><body><img src='.workspace/secret.png' alt="padding to clear the minimum length threshold"></body></html>`;
    expect(validateHtmlArtifact(singleQuoted).ok).toBe(false);

    const unquoted = `<!doctype html><html><body><img src=.workspace/secret.png alt="padding to clear the minimum length threshold"></body></html>`;
    expect(validateHtmlArtifact(unquoted).ok).toBe(false);
  });

  it('detects a reserved workspace path in a single-quoted or unquoted style="" attribute value', () => {
    const singleQuoted = `<!doctype html><html><body><div style='background:url(".workspace/secret.png")'>padding to clear the minimum length threshold</div></body></html>`;
    expect(validateHtmlArtifact(singleQuoted).ok).toBe(false);

    const unquoted = `<!doctype html><html><body><div style=background:url(.workspace/secret.png)>padding to clear the minimum length threshold</div></body></html>`;
    expect(validateHtmlArtifact(unquoted).ok).toBe(false);
  });

  it('does not let a comma embedded in a data: URI srcset candidate cause a false split, but still flags a later reserved candidate', () => {
    const doc = `<!doctype html><html><body><img srcset="data:image/png;base64,ABCD== 1x, .workspace/leak.png 2x" src="a.png" alt="padding to clear the minimum length threshold"></body></html>`;
    expect(validateHtmlArtifact(doc).ok).toBe(false);
  });
});
