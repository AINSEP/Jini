import { describe, expect, it } from 'vitest';
import { redactUserText, redactUserMessage } from '../user-text-redaction.js';
import { buildTranscript, latestUserPromptFromHistory } from '../transcript.js';

const synthetic = 'aB3dE5fG7hI9jK2mN4pQ6rS8tU0vW1xY';
describe('user text paste guard', () => {
  const shapes = [
    ['API prefix', 'sk-' + synthetic + synthetic],
    ['repository prefix', 'ghp_' + synthetic + synthetic],
    ['chat prefix', 'xoxb-' + '1234567890-1234567890-' + synthetic],
    ['cloud access id', 'AKIA' + 'A1B2C3D4E5F6G7H8'],
    ['JWT', 'eyJ' + synthetic + '.eyJ' + synthetic + '.' + synthetic],
    ['opaque entropy', synthetic + synthetic],
    ['alphabetic entropy', 'aBcDeFgHiJkLmNoPqRsTuVwXyZaBcDeFgHiJkLmNoPqRsTuVwXyZ'],
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
