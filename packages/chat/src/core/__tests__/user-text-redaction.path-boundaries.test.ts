import { describe, expect, it } from 'vitest';
import { buildTranscript } from '../transcript.js';
import { guardUserText, redactUserMessage, redactUserText } from '../user-text-redaction.js';

// Synthetic 40-character base64 value: '/' must remain part of the entropy candidate.
const opaque = 'S9/1f5t6iSk3NTpllCEkVRlaIe9YRXPKlkx7f0JO';
const identifier = 'customer-portal-production-source-file-and-ui';
const camel = 'CustomerPortal2026ProductionSourceFilesAndDocuments';

describe('typed path and credential boundary corpus', () => {
  const paths = [
    `/Users/alex/Client Work/${identifier}`,
    `/Users/alex/Client Work/${camel}`,
    'C:\\Users\\A B\\' + identifier,
    'C:\\Users\\A B\\' + camel,
    '\\\\server\\share\\Client Work\\' + identifier,
    '\\\\server\\share\\Client Work\\' + camel,
    '/home/alex/customer-portal/production_source_files_and_documents_2026',
    // Ordinary rooted paths with short caps, dates and temp ids stay exempt as a whole.
    '/Users/LA/Programming/tovu-integration-clones/prov2-jini/packages/chat/src',
    '~/Programming/Tovu/ADS-memory/reports/2026-11-01-design-debate.md',
    '/var/folders/x7/9fkq2r3j1bs7_l8nkh0000gn/T/tovu-abc/123',
    '/Users/alex/Projects/ACME-Corp/Q4_Report_FINAL_v3_2026-10-31_reviewed.pdf',
  ];
  for (const quote of ['', '"', "'", '`']) {
    it.each(paths)('preserves a typed path with quote ' + JSON.stringify(quote) + ': %s', path => {
      const text = `Inspect ${quote}${path}${quote} please`;
      expect(redactUserText({ text })).toEqual({ text, secretRedacted: false, count: 0 });
      expect(redactUserMessage({ message: { role: 'user', content: text } }).message.content).toBe(text);
      expect(guardUserText({ text }, { modelNote: 'Rotate the key.' })).toBe(text);
      expect(buildTranscript({ history: [{ id: 'typed', role: 'user', content: text }] })).toBe(`## user\n${text}`);
    });
  }

  for (const root of ['/proj/a', String.raw`C:\proj\a`, String.raw`\\server\share\a`, 'https://example.test/a']) {
    it.each([',', '|', ';', '\u200B', '\u200C', '\u200D', '\uFEFF'])('redacts a glued key after ' + root + ' and boundary %j', boundary => {
      const text = `${root}${boundary}${opaque}`;
      const safe = `${root}${boundary}[token removed]`;
      expect(redactUserText({ text })).toEqual({ text: safe, secretRedacted: true, count: 1 });
      expect(redactUserMessage({ message: { role: 'user', content: text } }).message.content).toBe(safe);
      expect(guardUserText({ text }, { modelNote: 'Rotate the key.' })).toBe(`${safe}\n\nRotate the key.`);
      expect(buildTranscript({ history: [{ id: 'glued', role: 'user', content: text }] })).toBe(`## user\n${safe}`);
    });
  }

  it.each(['(URL)', '[asset](URL)', 'URL'])('preserves existing URL exemptions inside prose markup: %s', template => {
    const text = template.replace('URL', `https://example.test/assets/${opaque}.png`);
    expect(redactUserText({ text })).toEqual({ text, secretRedacted: false, count: 0 });
  });

  it.each([
    opaque, `/${opaque}`, `/proj/${opaque}`, 'C:\\proj\\' + opaque,
    // Repeated digit-mixed runs must not qualify as CamelCase words.
    '/proj/aB3dE5fG7hI9jK2mN4pQ6rS8tU0vW1xYaB3dE5fG7hI9jK2mN4pQ6rS8tU0vW1xY',
  ])('redacts opaque path segments without splitting slash-bearing keys: %s', text => {
    const result = redactUserText({ text });
    expect(result).toMatchObject({ secretRedacted: true, count: 1 });
    expect(result.text).not.toContain(text.replace(/^(?:C:\\proj\\|\/proj\/|\/)/, ''));
    expect(result.text).toContain('[token removed]');
  });

  it.each(['sk-', 'ghp_', 'xoxb-'])('keeps known-prefix detection inside quoted and unquoted paths: %s', prefix => {
    const key = prefix + 'aB3dE5fG7hI9jK2mN4pQ6rS8tU0vW1xYaB3dE5fG7hI9jK2mN4pQ6rS8tU0vW1xY';
    for (const text of [`/proj/${key}`, `"/Users/alex/Client Work/${key}"`, 'C:\\proj\\' + key]) {
      expect(redactUserText({ text })).toEqual({ text: text.replace(key, '[token removed]'), secretRedacted: true, count: 1 });
    }
  });
});
