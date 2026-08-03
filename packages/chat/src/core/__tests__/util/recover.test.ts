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
    expect(recoverStandaloneHtmlDocument(HTML_DOC)).toBe(HTML_DOC);
    expect(recoverStandaloneHtmlDocument('just some prose')).toBeNull();
  });

  it('recoverStandaloneHtmlDocument treats null/undefined sourceText as empty (rejected, not a throw)', () => {
    expect(recoverStandaloneHtmlDocument(null)).toBeNull();
    expect(recoverStandaloneHtmlDocument(undefined)).toBeNull();
  });

  it('recoverStandaloneHtmlDocument rejects a candidate that ends in </html> but is too short to validate', () => {
    expect(recoverStandaloneHtmlDocument('<html></html>')).toBeNull();
  });

  it('recovers HTML from a single fenced ```html block but refuses when there are two candidates (ambiguous)', () => {
    const single = '```html\n' + HTML_DOC + '\n```';
    expect(recoverHtmlDocumentFromMarkdownFence(single)).toBe(HTML_DOC);

    const doubled = single + '\n\n' + single;
    expect(recoverHtmlDocumentFromMarkdownFence(doubled)).toBeNull();
  });

  it('recoverHtmlDocumentFromMarkdownFence treats null/undefined sourceText as empty, and returns null when there is no fence at all', () => {
    expect(recoverHtmlDocumentFromMarkdownFence(null)).toBeNull();
    expect(recoverHtmlDocumentFromMarkdownFence(undefined)).toBeNull();
    expect(recoverHtmlDocumentFromMarkdownFence('no fence here')).toBeNull();
  });

  it('recoverHtmlDocumentFromMarkdownFence skips a fence whose body does not end in </html> and one that is too short to validate', () => {
    const notHtml = '```html\njust some prose, not a document at all really\n```';
    expect(recoverHtmlDocumentFromMarkdownFence(notHtml)).toBeNull();

    const tooShort = '```html\n<html></html>\n```';
    expect(recoverHtmlDocumentFromMarkdownFence(tooShort)).toBeNull();
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
