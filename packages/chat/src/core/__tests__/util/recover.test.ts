import { describe, expect, it } from 'vitest';
import {
  recoverHtmlArtifactFromPrecedingDocument,
  recoverHtmlDocumentFromMarkdownFence,
  recoverStandaloneHtmlDocument,
  resolvePersistedArtifactHtml,
} from '../../util/index.js';

const HTML_DOC = '<!doctype html><html><head></head><body><h1>Hello there, world</h1></body></html>';

describe('artifacts/recover', () => {
  it('recovers a standalone HTML document reply as-is', () => {
    expect(recoverStandaloneHtmlDocument({ sourceText: HTML_DOC })).toBe(HTML_DOC);
    expect(recoverStandaloneHtmlDocument({ sourceText: 'just some prose' })).toBeNull();
  });

  it('recoverStandaloneHtmlDocument treats null/undefined sourceText as empty (rejected, not a throw)', () => {
    expect(recoverStandaloneHtmlDocument({ sourceText: null })).toBeNull();
    expect(recoverStandaloneHtmlDocument({ sourceText: undefined })).toBeNull();
  });

  it('recoverStandaloneHtmlDocument rejects a candidate that ends in </html> but is too short to validate', () => {
    expect(recoverStandaloneHtmlDocument({ sourceText: '<html></html>' })).toBeNull();
  });

  it('recovers HTML from a single fenced ```html block but refuses when there are two candidates (ambiguous)', () => {
    const single = '```html\n' + HTML_DOC + '\n```';
    expect(recoverHtmlDocumentFromMarkdownFence({ sourceText: single })).toBe(HTML_DOC);

    const doubled = single + '\n\n' + single;
    expect(recoverHtmlDocumentFromMarkdownFence({ sourceText: doubled })).toBeNull();
  });

  it('recoverHtmlDocumentFromMarkdownFence treats null/undefined sourceText as empty, and returns null when there is no fence at all', () => {
    expect(recoverHtmlDocumentFromMarkdownFence({ sourceText: null })).toBeNull();
    expect(recoverHtmlDocumentFromMarkdownFence({ sourceText: undefined })).toBeNull();
    expect(recoverHtmlDocumentFromMarkdownFence({ sourceText: 'no fence here' })).toBeNull();
  });

  it('recoverHtmlDocumentFromMarkdownFence skips a fence whose body does not end in </html> and one that is too short to validate', () => {
    const notHtml = '```html\njust some prose, not a document at all really\n```';
    expect(recoverHtmlDocumentFromMarkdownFence({ sourceText: notHtml })).toBeNull();

    const tooShort = '```html\n<html></html>\n```';
    expect(recoverHtmlDocumentFromMarkdownFence({ sourceText: tooShort })).toBeNull();
  });

  it('recoverHtmlArtifactFromPrecedingDocument returns null when the artifact body already validates (no recovery needed)', () => {
    expect(recoverHtmlArtifactFromPrecedingDocument({ artifactHtml: HTML_DOC, sourceText: 'anything' })).toBeNull();
  });

  it('recoverHtmlArtifactFromPrecedingDocument returns null when sourceText is empty/absent', () => {
    expect(recoverHtmlArtifactFromPrecedingDocument({ artifactHtml: 'prose' })).toBeNull();
    expect(recoverHtmlArtifactFromPrecedingDocument({ artifactHtml: 'prose', sourceText: '' })).toBeNull();
  });

  it('recoverHtmlArtifactFromPrecedingDocument returns null when sourceText has no artifact tag at all', () => {
    const result = recoverHtmlArtifactFromPrecedingDocument({ artifactHtml: 'prose', sourceText: HTML_DOC });
    expect(result).toBeNull();
  });

  it('recoverHtmlArtifactFromPrecedingDocument returns null when the text before the artifact tag does not end with </html>', () => {
    const sourceText = `some intro text <artifact identifier="a" type="text/html" title="t">prose</artifact>`;
    expect(recoverHtmlArtifactFromPrecedingDocument({ artifactHtml: 'prose', identifier: 'a', sourceText })).toBeNull();
  });

  it('recoverHtmlArtifactFromPrecedingDocument returns null when the text ends with </html> but no <html open tag precedes it', () => {
    const sourceText = `some prose that happens to end with a close tag </html>\n<artifact identifier="a" type="text/html" title="t">too short</artifact>`;
    expect(recoverHtmlArtifactFromPrecedingDocument({ artifactHtml: 'too short', identifier: 'a', sourceText })).toBeNull();
  });

  it('recovers the complete <html>…</html> document immediately preceding the artifact tag, including a leading doctype', () => {
    const sourceText = `<!doctype html>${HTML_DOC.slice('<!doctype html>'.length)}\n<artifact identifier="a" type="text/html" title="t">too short</artifact>`;
    const result = recoverHtmlArtifactFromPrecedingDocument({ artifactHtml: 'too short', sourceText });
    expect(result).toBe(HTML_DOC);
  });

  it('recovers the preceding document without a doctype when none was present', () => {
    const doc = '<html><head></head><body><h1>No doctype but long enough to pass</h1></body></html>';
    const sourceText = `${doc}\n<artifact identifier="a" type="text/html" title="t">too short</artifact>`;
    const result = recoverHtmlArtifactFromPrecedingDocument({ artifactHtml: 'too short', sourceText });
    expect(result).toBe(doc);
  });

  it('rejects a recovered candidate that is too short to validate as HTML', () => {
    const sourceText = `<html></html>\n<artifact identifier="a" type="text/html" title="t">x</artifact>`;
    expect(recoverHtmlArtifactFromPrecedingDocument({ artifactHtml: 'x', sourceText })).toBeNull();
  });

  it('an identifier param targets the matching-identifier artifact tag, recovering the document immediately before IT, not an earlier one', () => {
    const other = '<html><body>document for the OTHER artifact, long enough to validate on its own</body></html>';
    const mine = '<html><body>document for the TARGET artifact, long enough to validate too</body></html>';
    const sourceText = [
      `${other}`,
      `<artifact identifier="other" type="text/html" title="t">too short</artifact>`,
      `${mine}`,
      `<artifact identifier="a" type="text/html" title="t">too short</artifact>`,
    ].join('\n');
    const result = recoverHtmlArtifactFromPrecedingDocument({ artifactHtml: 'too short', identifier: 'a', sourceText });
    expect(result).toBe(mine);
  });

  it('falls back to the last <artifact tag overall when no tag carries the requested identifier', () => {
    const doc = '<html><body>fallback document, long enough to pass validation on its own merit</body></html>';
    const sourceText = `${doc}\n<artifact type="text/html" title="t">too short</artifact>`;
    const result = recoverHtmlArtifactFromPrecedingDocument({ artifactHtml: 'too short', identifier: 'nope', sourceText });
    expect(result).toBe(doc);
  });

  it('resolvePersistedArtifactHtml prefers the recovered preceding document over the raw artifact body', () => {
    const doc = '<html><body>the real document, long enough to pass the validator on its own</body></html>';
    const sourceText = `${doc}\n<artifact identifier="a" type="text/html" title="t">too short</artifact>`;
    expect(resolvePersistedArtifactHtml({ artifactHtml: 'too short', identifier: 'a', sourceText })).toBe(doc);
  });

  it('resolvePersistedArtifactHtml falls back to the raw artifact body when nothing is recoverable', () => {
    expect(resolvePersistedArtifactHtml({ artifactHtml: HTML_DOC, sourceText: 'irrelevant' })).toBe(HTML_DOC);
    expect(resolvePersistedArtifactHtml({ artifactHtml: 'unrecoverable prose' })).toBe('unrecoverable prose');
  });
});

// Stryker L5 (2026-10-25): the identifier-tagged scan (last match must win), the unknown-identifier
// and empty-identifier fallbacks, and the regex escaping of the identifier were untested.
describe('recoverHtmlArtifactFromPrecedingDocument — tagged artifact scan (F3)', () => {
  const docA = '<!doctype html><html><head><title>A</title></head><body><h1>Document A content here</h1></body></html>';
  const docB = '<!doctype html><html><head><title>B</title></head><body><h1>Document B content here</h1></body></html>';
  const prose = 'Here is a short summary of the page.';
  const recover = (sourceText: string, identifier?: string) =>
    recoverHtmlArtifactFromPrecedingDocument({ artifactHtml: prose, sourceText, ...(identifier === undefined ? {} : { identifier }) });

  it('uses the LAST artifact tag carrying the identifier (double or single quotes)', () => {
    const text = `${docA}<artifact identifier="page">${prose}</artifact> ${docB}<artifact identifier='page'>${prose}</artifact>`;
    expect(recover(text, 'page')).toBe(docB);
  });

  it('prefers the tagged artifact over a later untagged one', () => {
    const text = `${docA}<artifact identifier="page">${prose}</artifact> intro <artifact identifier="other">x</artifact>`;
    expect(recover(text, 'page')).toBe(docA);
  });

  it('falls back to the last <artifact when the identifier matches no tag', () => {
    const text = `${docA}<artifact identifier="other">${prose}</artifact>`;
    expect(recover(text, 'missing')).toBe(docA);
  });

  it('an empty identifier means "the last artifact tag"', () => {
    const text = `${docA}<artifact identifier="x">${prose}</artifact>`;
    expect(recover(text, '')).toBe(docA);
    expect(recover(text)).toBe(docA);
  });

  it('escapes regex metacharacters in the identifier', () => {
    const text = `${docA}<artifact identifier="a.b">${prose}</artifact> ${docB}<artifact identifier="aXb">${prose}</artifact>`;
    expect(recover(text, 'a.b')).toBe(docA);
  });

  it('does not match an identifier that is only a prefix of the tag value', () => {
    const text = `${docA}<artifact identifier="page">${prose}</artifact> ${docB}<artifact identifier="page2">${prose}</artifact>`;
    expect(recover(text, 'page')).toBe(docA);
  });

  it('returns null when text sits between the document and the artifact tag', () => {
    expect(recover(`${docA} and then <artifact identifier="page">${prose}</artifact>`, 'page')).toBeNull();
  });

  it('returns null when the artifact body already validates', () => {
    expect(recoverHtmlArtifactFromPrecedingDocument({ artifactHtml: docB, sourceText: `${docA}<artifact>${docB}</artifact>` })).toBeNull();
  });
});
