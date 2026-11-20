import { describe, expect, it } from 'vitest';
import { guardUserText, redactUserText, redactUserMessage } from '../user-text-redaction.js';
import { buildTranscript, latestUserPromptFromHistory } from '../transcript.js';

const synthetic = 'aB3dE5fG7hI9jK2mN4pQ6rS8tU0vW1xY';
describe('user text paste guard', () => {
  const shapes = [
    ['API prefix', 'sk-' + synthetic + synthetic],
    ['repository prefix', 'ghp_' + synthetic + synthetic],
    ['chat prefix', 'xoxb-' + '1234567890-1234567890-' + synthetic],
    ['cloud access id', 'AKIA' + 'A1B2C3D4E5F6G7H8'],
    ['JWT', 'eyJ' + synthetic + '.eyJ' + synthetic + '.' + synthetic],
    ['short authorization', 'Bearer x'],
    ['short assignment', 'api_key=x'],
  ];
  for (const [name, value] of shapes) it('removes ' + name + ' and preserves surrounding prose', () => {
    const result = redactUserText({ text: 'Please save ' + value + ' for later.' });
    expect(result.secretRedacted).toBe(true);
    expect(result.count).toBe(1);
    expect(result.text).toBe('Please save ' + (name === 'short authorization' ? 'Bearer ' : name === 'short assignment' ? 'api_key=' : '') + '[token removed] for later.');
    expect(redactUserText({ text: result.text })).toEqual({ text: result.text, secretRedacted: false, count: 0 });
  });
  const ordinary = [
    synthetic + synthetic,
    'aBcDeFgHiJkLmNoPqRsTuVwXyZaBcDeFgHiJkLmNoPqRsTuVwXyZ',
    'The secret to success is practice. Bearer token authentication is supported.',
    'https://example.test/docs?q=hello#section',
    'https://example.test/assets/' + synthetic + synthetic + '.png',
    '123e4567-e89b-12d3-a456-426614174000',
    '#abcdef #ABC123 123456 OTP',
    'const result = items.map(item => item.name); // normal code',
    'const label = "[REDACTED:credential]"; // ordinary example marker',
    'const sha256 = "' + 'abcdef0123456789'.repeat(4) + '";',
  ];
  for (const [index, text] of ordinary.entries()) it('keeps ordinary example ' + index + ' byte for byte', () => {
    expect(redactUserText({ text })).toEqual({ text, secretRedacted: false, count: 0 });
  });
  it('returns only safe metadata, preserves markup and does not mutate input', () => {
    const message = { id: 'u', role: 'user' as const, content: '<question-form>quoted</question-form> api_key=x' };
    const prepared = redactUserMessage({ message });
    expect(prepared.message.content).toBe('<question-form>quoted</question-form> api_key=[token removed]');
    expect(prepared.secretRedacted).toBe(true);
    expect(prepared.count).toBe(1);
    expect(message.content.endsWith('api_key=x')).toBe(true);
  });
  it('guards model replay and latest prompt without truncating a credential first', () => {
    const history = [{ id: 'u', role: 'user' as const, content: 'Please save api_key=x' }];
    expect(buildTranscript({ history })).toBe('## user\nPlease save api_key=[token removed]');
    expect(latestUserPromptFromHistory({ history })).toBe('Please save api_key=[token removed]');
    expect(buildTranscript({ history }, { maxMessageChars: 22 })).not.toContain('api_key=x');
  });
  it('supports an injected text-redaction port and a non-secret signal', () => {
    const seen: unknown[] = [];
    const history = [{ id: 'u', role: 'user' as const, content: 'host-owned-format' }];
    expect(buildTranscript({ history }, {
      redactUserText: () => ({ text: '[token removed]', secretRedacted: true, count: 1 }),
      onSecretRedacted: signal => seen.push(signal),
    })).toBe('## user\n[token removed]');
    expect(seen).toEqual([{ secretRedacted: true, count: 1 }]);
  });
  it('counts independent matches once and keeps an existing removal marker', () => {
    expect(redactUserText({ text: 'api_key=x password=y [token removed]' })).toEqual({
      text: 'api_key=[token removed] password=[token removed] [token removed]', secretRedacted: true, count: 2,
    });
  });
});

describe('shared rule classification corpus', () => {
  const mustKeep = [
    ['avif file name', 'please open aZ9kQ2mX7pL4vB8nR1tY6wC3h.avif'],
    ['unlabelled 40-character run', 'aZ9kQ2mX7pL4vB8nR1tY6wC3hJ5dF0gS2eU7iO4q'],
    ['macOS folder', '/Users/la/Documents/Tovu/Some-Folder2026'],
    ['Linux folder', '/home/alex/Projects/Customer-Portal2026/SourceFiles'],
    ['home-relative folder', '~/Documents/Customer-Portal2026/SourceFiles'],
    ['Windows drive', String.raw`C:\Users\Alex\Documents\Customer-Portal2026\SourceFiles`],
    ['Windows forward slashes', 'D:/Users/Alex/Documents/Customer-Portal2026/SourceFiles'],
    ['UNC folder', String.raw`\\FileServer\SharedProjects\Customer-Portal2026\SourceFiles`],
    ['long Windows segment', String.raw`C:\Projects\CustomerPortal2026ProductionSourceFilesAndDocuments`],
    ['long UNC segment', String.raw`\\FileServer\Projects\CustomerPortal2026ProductionSourceFilesAndDocuments`],
    // Whitespace-containing folders survive only when quoted (folder drops quote them); an unquoted
    // path ends at whitespace so an adjacent slash-bearing secret cannot inherit the exemption.
    ['quoted POSIX folder with a tab', '"/Users/alex/Client\tWork/CustomerPortal2026ProductionSourceFilesAndDocuments"'],
    ['single-quoted Windows folder with spaces', String.raw`'C:\Users\Alex\Client Work\CustomerPortal2026ProductionSourceFilesAndDocuments'`],
    ['quoted POSIX folder with spaces', '"/Users/alex/Client Work/CustomerPortal2026ProductionSourceFilesAndDocuments"'],
    ['quoted Windows folder with spaces', String.raw`"C:\Users\Alex\Client Work\CustomerPortal2026ProductionSourceFilesAndDocuments"`],
    ['backtick path', '`~/Client Work/CustomerPortal2026ProductionSourceFilesAndDocuments`'],
    ['single-quoted path', "'/home/alex/Client Work/CustomerPortal2026ProductionSourceFilesAndDocuments'"],
    ['URL', 'https://example.test/assets/' + synthetic + synthetic + '.png'],
    ['git SHA', 'abcdef0123456789'.repeat(2) + 'abcdef01'],
    ['UUID', '123e4567-e89b-12d3-a456-426614174000'],
  ];
  it.each(mustKeep)('keeps %s without a redaction signal or model warning', (_name, value) => {
    const text = `Please inspect ${value} for me.`;
    expect(redactUserText({ text })).toEqual({ text, secretRedacted: false, count: 0 });
    expect(guardUserText({ text }, { modelNote: 'Rotate a removed key.' })).toBe(text);
    expect(buildTranscript({ history: [{ id: 'folder', role: 'user', content: text }] })).toBe('## user\n' + text);
  });

  const mustRedact = [
    ['API key', 'sk-' + synthetic + synthetic],
    ['repository key', 'ghp_' + synthetic + synthetic],
    ['Slack token', 'xoxb-' + '1234567890-1234567890-' + synthetic],
    ['AWS access key', 'AKIA' + 'A1B2C3D4E5F6G7H8'],
    ['JWT', 'eyJ' + synthetic + '.eyJ' + synthetic + '.' + synthetic],
    ['PEM', '-----BEGIN PRIVATE KEY-----\n' + synthetic + '\n-----END PRIVATE KEY-----'],
    ['Bearer token', 'Bearer ' + synthetic],
    ['labelled secret', 'api_key=x'],
  ];
  for (const root of ['/Users/alex/Documents/', '~/', 'C:\\Users\\Alex\\', '\\\\FileServer\\Share\\', 'https://example.test/']) {
    it.each(mustRedact)('still redacts %s inside ' + root, (_name, value) => {
      const result = redactUserText({ text: root + value });
      expect(result.secretRedacted).toBe(true);
      expect(result.count).toBe(1);
      expect(result.text).not.toContain(value);
      expect(result.text).toContain('[token removed]');
      expect(redactUserText({ text: result.text })).toEqual({ text: result.text, secretRedacted: false, count: 0 });
    });
  }
  it('still redacts a path submitted as an explicitly secret field', () => {
    expect(redactUserText({ text: '/Users/la/Documents/Tovu/Some-Folder2026' }, { secretField: true })).toEqual({
      text: '[token removed]', secretRedacted: true, count: 1,
    });
  });
});
