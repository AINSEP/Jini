import { describe, expect, it } from 'vitest';
import { buildDiagnosticVocabulary } from '../diagnostic-vocabulary.js';
import { MASKED_IDENTIFIER_ROWS } from '../masked-identifier-rows.js';
import { sanitizeUntrustedText } from '../sanitize-untrusted-text.js';

const keep = (text: string, vocabulary: readonly string[]): string => sanitizeUntrustedText({ text }, { keepIdentifiers: true, diagnosticToolIds: vocabulary });
const row = (n: number): string => MASKED_IDENTIFIER_ROWS.find(entry => entry.row === n)!.text;
const SCREENSHOT_SCHEMA = { type: 'object', properties: { viewport: { type: 'string' }, fullPage: { type: 'boolean' }, dismissCookieBanners: { type: 'boolean' } } };
const EXECUTION = '3f2b8c1e-5d47-4a8e-9b1c-0d6e7f8a9b10';

describe('buildDiagnosticVocabulary: what stays readable', () => {
  it('row 1: a registered id', () => {
    expect(keep(row(1), buildDiagnosticVocabulary({ toolIds: ['publish_job_status_read'] }))).toBe(row(1));
  });
  it('row 2: property names of the called tool\'s schema', () => {
    expect(keep(row(2), buildDiagnosticVocabulary({ toolIds: [] }, { inputSchema: SCREENSHOT_SCHEMA }))).toBe(row(2));
  });
  it('row 2 for a gateway call with no held descriptor: only when the envelope carries details.inputNames', () => {
    const inputNames = ['viewport', 'fullPage', 'dismissCookieBanners'];
    expect(keep(row(2), buildDiagnosticVocabulary({ toolIds: [] }, { envelopeDetails: { inputNames } }))).toBe(row(2));
    expect(keep(row(2), buildDiagnosticVocabulary({ toolIds: [] }))).toBe('Declared inputs: viewport (optional), fullPage (optional), [redacted] (optional)');
  });
  it('row 4: details.executionId and details.toolId', () => {
    expect(keep(row(4), buildDiagnosticVocabulary({ toolIds: [] }, { envelopeDetails: { executionId: EXECUTION, toolId: 'theme_write_file' } }))).toBe(row(4));
  });
  it('row 5: details.toolId for an id that is not in the launch list', () => {
    expect(keep(row(5), buildDiagnosticVocabulary({ toolIds: [] }, { envelopeDetails: { toolId: 'agent_plugin_google-login__start_sign_in' } }))).toBe(row(5));
  });
  it('row 3: a slug that is a scalar argument of the same call', () => {
    const echoed = { input: { assetSlug: 'marquee-suit-2024-final-v2' }, schema: { properties: { assetSlug: { type: 'string' } } } };
    expect(keep(row(3), buildDiagnosticVocabulary({ toolIds: [] }, { echoed }))).toBe(row(3));
  });
  it('the envelope\'s requestId and errorId are kept', () => {
    const id = 'req-4f9a1c2e-7b3d-4e8a-9c5b-1d2e3f4a5b6c';
    expect(buildDiagnosticVocabulary({ toolIds: [] }, { envelopeDetails: { requestId: id, errorId: id } })).toEqual([id]);
  });
});

describe('buildDiagnosticVocabulary: what stays masked', () => {
  const masked = (text: string, vocabulary: readonly string[]): boolean => keep(text, vocabulary).includes('[redacted]');
  it('a bearer token and a labelled key, even when they are in the vocabulary', () => {
    const token = 'abcdefghijklmnopqrstuvwxyz0123456789ABCD';
    expect(masked(`Authorization: Bearer ${token}`, [token])).toBe(true);
    expect(masked(`apiKey: ${token}`, [token, 'apiKey'])).toBe(true);
  });
  it('a UUID that appears only in free text', () => {
    expect(masked(`session ${EXECUTION} expired`, buildDiagnosticVocabulary({ toolIds: [] }, { inputSchema: SCREENSHOT_SCHEMA }))).toBe(true);
  });
  it('the value of a schema-named property is not learned from the schema', () => {
    const value = 'aVeryLongMixedCaseValueThatIsOpaque1234';
    expect(masked(`viewport ${value} is not valid`, buildDiagnosticVocabulary({ toolIds: [] }, { inputSchema: SCREENSHOT_SCHEMA }))).toBe(true);
  });
  it('an argument whose property is writeOnly, has format password, or reads as a credential', () => {
    const value = 'my-private-value-2024-final-v2';
    for (const schema of [{ writeOnly: true }, { format: 'password' }, {}]) {
      const name = Object.keys(schema).length === 0 ? 'accessToken' : 'note';
      const vocabulary = buildDiagnosticVocabulary({ toolIds: [] }, { echoed: { input: { [name]: value }, schema: { properties: { [name]: schema } } } });
      expect(vocabulary, JSON.stringify(schema)).toEqual([]);
    }
  });
  it('an echoed value a secret rule would mask', () => {
    const vocabulary = buildDiagnosticVocabulary({ toolIds: [] }, { echoed: { input: { note: 'sk-abcdefghijklmnopqrstuvwx' } } });
    expect(vocabulary).toEqual([]);
  });
  it('an echoed value that is longer than 64 characters or is not a single slug', () => {
    const input = { long: 'a-b-c-'.repeat(12), sentence: 'two words here', url: 'https://example.com/a?b=c' };
    expect(buildDiagnosticVocabulary({ toolIds: [] }, { echoed: { input } })).toEqual([]);
  });
  it('a vocabulary entry glued to a suffix', () => {
    const vocabulary = buildDiagnosticVocabulary({ toolIds: [] }, { inputSchema: SCREENSHOT_SCHEMA });
    expect(keep('dismissCookieBannersXYZ123 failed', vocabulary)).toBe('[redacted] failed');
  });
  it('a 60-character token in details.jobId', () => {
    expect(buildDiagnosticVocabulary({ toolIds: [] }, { envelopeDetails: { jobId: 'j'.repeat(60) } })).toEqual([]);
  });
  it('inputNames entries outside the identifier shape, and names beyond the 64th', () => {
    const inputNames = ['good_name', 'has space', 'x'.repeat(65), '9starts', ...Array.from({ length: 70 }, (_, i) => `name_${i}`)];
    const vocabulary = buildDiagnosticVocabulary({ toolIds: [] }, { envelopeDetails: { inputNames } });
    expect(vocabulary).toContain('good_name');
    expect(vocabulary).not.toContain('has space');
    expect(vocabulary).not.toContain('9starts');
    expect(vocabulary).toHaveLength(64 - 3);
  });
  it('random 20 to 64 character tokens that are in none of the sources always come out masked', () => {
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let state = 12345;
    const vocabulary = buildDiagnosticVocabulary({ toolIds: ['known_tool_id'] }, { inputSchema: SCREENSHOT_SCHEMA, envelopeDetails: { toolId: 'theme_write_file' } });
    for (let i = 0; i < 300; i += 1) {
      let token = '';
      for (let n = 0; n < 20 + (i % 45); n += 1) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; token += alphabet[state % alphabet.length]; }
      expect(keep(`value ${token} rejected`, vocabulary), token).not.toContain(token);
    }
  });
  it('the schema walk stops at depth 6 and at 512 names', () => {
    let deep: Record<string, unknown> = { properties: { tooDeepName: {} } };
    for (let i = 0; i < 7; i += 1) deep = { properties: { [`level${i}`]: deep } };
    expect(buildDiagnosticVocabulary({ toolIds: [] }, { inputSchema: deep })).not.toContain('tooDeepName');
    const wide = { properties: Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`field_${i}`, {}])) };
    expect(buildDiagnosticVocabulary({ toolIds: [] }, { inputSchema: wide })).toHaveLength(512);
  });
});
