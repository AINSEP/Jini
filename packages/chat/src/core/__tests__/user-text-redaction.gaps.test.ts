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
