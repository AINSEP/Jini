import { describe, expect, it } from 'vitest';
import { redactUserText } from '../user-text-redaction.js';

describe('redactUserText', () => {
  it('still removes Slack tokens through the shared base rules', () => {
    const token = 'xox' + 'p-' + 'abcdefghijklmnopqrstu';
    const result = redactUserText({ text: `use ${token} please` });
    expect(result.text).not.toContain(token);
    expect(result.count).toBe(1);
    expect(result.secretRedacted).toBe(true);
  });

  it('keeps prose that happens to contain its internal marker prefix and an existing removal marker', () => {
    const text = 'see chat_literal_ and chat_literal__ beside [REDACTED:api_key] here';
    expect(redactUserText({ text })).toEqual({ text, secretRedacted: false, count: 0 });
  });
});
