import { describe, expect, it } from 'vitest';
import { redactUserMessage, redactUserText } from '../user-text-redaction.js';

describe('redactUserText', () => {
  it('still removes Slack tokens through the shared base rules', () => {
    const token = 'xox' + 'p-' + 'abcdefghijklmnopqrstu';
    const result = redactUserText({ text: `use ${token} please` });
    expect(result.text).not.toContain(token);
    expect(result.count).toBe(1);
    expect(result.secretRedacted).toBe(true);
  });

  // The shared base rule refuses a token preceded by `-`, and the entropy fallback exempts URLs, so a
  // hyphen-prefixed Slack token inside a URL is only caught by chat's own rule.
  const slackLike = (prefix: string) => 'xox' + prefix + '-' + '123456789012-123456789012-' + 'abcdefghijklmnopqrstuvwx';
  for (const [name, text, token] of [
    ['a URL path', 'see https://example.test/-' + slackLike('b') + ' now', slackLike('b')],
    ['a URL query value', 'open https://example.test/a?t=-' + slackLike('p') + '&x=1', slackLike('p')],
  ] as const) it('removes a hyphen-prefixed Slack token inside ' + name, () => {
    const result = redactUserText({ text });
    expect(result.text).not.toContain('xox');
    expect(result.text).not.toContain('abcdefghijklmnopqrstuvwx');
    expect(result.text).toBe(text.replace(token, '[token removed]'));
    expect(result).toMatchObject({ secretRedacted: true, count: 1 });
    const signals: unknown[] = [];
    const prepared = redactUserMessage({ message: { role: 'user', content: text } }, { onSecretRedacted: signal => signals.push(signal) });
    expect(prepared.message.content).not.toContain(token);
    expect(signals).toEqual([{ secretRedacted: true, count: 1 }]);
  });

  it('keeps prose that happens to contain its internal marker prefix and an existing removal marker', () => {
    const text = 'see chat_literal_ and chat_literal__ beside [REDACTED:api_key] here';
    expect(redactUserText({ text })).toEqual({ text, secretRedacted: false, count: 0 });
  });
});

// Stryker L5 (2026-10-25): the URL-span exemption, the entropy thresholds and entropy() itself were
// never pinned at their boundaries. Every candidate below is 40+ chars of the token alphabet.
describe('redactUserText — URL span and entropy boundaries (F3)', () => {
  const TOKEN = 'aZ9kQ2mX7pL4vB8nR1tY6wC3hJ5dF0gS2eU7iO4q'; // 40 chars, digits + mixed case

  it.each([
    ['alone', TOKEN, '[token removed]'],
    ['after a URL, separated by a space', `https://example.com/a ${TOKEN}`, 'https://example.com/a [token removed]'],
    ['inside a URL path', `https://example.com/${TOKEN}`, `https://example.com/${TOKEN}`],
    ['as the last URL segment before punctuation', `see https://example.com/x/${TOKEN}"`, `see https://example.com/x/${TOKEN}"`],
    ['starting exactly at the URL start (as its scheme)', `${TOKEN}://example.com`, `${TOKEN}://example.com`],
    ['after a quote that ends a URL', `https://e.com/"${TOKEN}`, 'https://e.com/"[token removed]'],
  ])('%s', (_label, text, expected) => {
    expect(redactUserText({ text }).text).toBe(expected);
  });

  // 16 equally frequent symbols = exactly 4.0 bits: the threshold is `< 4`, so 4.0 is removed.
  it.each([
    ['16 symbols, digits (4.0 bits) → removed', 'ghijklmn12345678'.repeat(3), true],
    ['15 symbols, digits (3.9 bits) → kept', 'ghijklmn1234567'.repeat(3), false],
    ['23 mixed-case letters, no digits (4.52 bits) → removed', 'ABCDEFGHIJKLabcdefghijk'.repeat(2), true],
    ['22 mixed-case letters, no digits (4.46 bits) → kept', 'ABCDEFGHIJKabcdefghijk'.repeat(2), false],
    ['26 lowercase letters, no digits, not mixed → kept', 'abcdefghijklmnopqrstuvwxyz'.repeat(2), false],
    ['26 uppercase letters, no digits, not mixed → kept', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(2), false],
    ['hex hash → kept', 'a3f9'.repeat(16), false],
    ['digits and symbols only → kept', '0123456789+/='.repeat(4), false],
    ['39 chars → never a candidate', TOKEN.slice(0, 39), false],
  ])('%s', (_label, text, removed) => {
    const out = redactUserText({ text });
    expect(out).toEqual(removed ? { text: '[token removed]', secretRedacted: true, count: 1 } : { text, secretRedacted: false, count: 0 });
  });

  it('two candidates are counted separately', () => {
    expect(redactUserText({ text: `${TOKEN} and ${TOKEN.toUpperCase()}x1` })).toMatchObject({ count: 2, secretRedacted: true });
  });
});
