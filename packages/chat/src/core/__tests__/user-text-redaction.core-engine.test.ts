import { describe, expect, it } from 'vitest';
import { redactUserText } from '../user-text-redaction.js';
import { formatFormAnswers } from '../question-form/format.js';

// C-CHAT-DEPS E2 (2026-11-18): chat's user text runs on core's engine with no chat rule.
// Each case pins one answer that changed or must not change when diagnostics' engine left.
describe('user text on the shared engine', () => {
  it.each([
    ['short sk- key (core now masks 16+)', 'key sk-abcdefghijklmnop end', 'key [token removed] end'],
    ['Slack token after a dash in a URL path', 'see https://x.test/-xoxb-1234567890-abcdefghij now', 'see https://x.test/-[token removed] now'],
    ['Bearer value that only starts with a prose word', 'Bearer auth-1a2b3c ok', 'Bearer [token removed] ok'],
    ['foreign marker in a credential position', 'api_key=[REDACTED:custom] ok', 'api_key=[token removed] ok'],
    ['foreign marker after Bearer', 'Bearer [REDACTED:custom] ok', 'Bearer [token removed] ok'],
    ['spaced label with a value', 'API key: abc', 'API key: [token removed]'],
    ['Bearer keeps its own whitespace', 'Bearer\tabc', 'Bearer\t[token removed]'],
  ])('%s', (_name, text, expected) => {
    const result = redactUserText({ text });
    expect(result).toEqual({ text: expected, secretRedacted: true, count: 1 });
    expect(redactUserText({ text: result.text })).toEqual({ text: result.text, secretRedacted: false, count: 0 });
  });
  it.each(['Authorization: Bearer token', 'Bearer token.', 'see [REDACTED:custom] here'])('keeps %j byte for byte', text => {
    expect(redactUserText({ text })).toEqual({ text, secretRedacted: false, count: 0 });
  });
  it('never feeds its own (skipped) placeholder to the engine', () => {
    const form = { id: 'f', title: 'F', questions: [{ id: 'password', label: 'Password', type: 'text' as const }] };
    expect(formatFormAnswers({ form, answers: {} }).split('\n')[1]).toBe('- Password: (skipped)');
  });
});
