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
  it.each(['Bearer token.', 'see [REDACTED:custom] here'])('keeps %j byte for byte', text => {
    expect(redactUserText({ text })).toEqual({ text, secretRedacted: false, count: 0 });
  });
  // The chat redactor before the move masked whatever followed the scheme word inside an Authorization header.
  it('masks a description word used as the value of an Authorization header', () => {
    expect(redactUserText({ text: 'Authorization: Bearer token' })).toEqual({ text: 'Authorization: Bearer [token removed]', secretRedacted: true, count: 1 });
  });
  // Chat once kept this placeholder away from the engine because the engine read it as a credential; the
  // engine now keeps a parenthesised placeholder after a colon readable (core redact.prose-values.test.ts).
  it('keeps its own (skipped) placeholder readable', () => {
    const form = { id: 'f', title: 'F', questions: [{ id: 'password', label: 'Password', type: 'text' as const }] };
    expect(formatFormAnswers({ form, answers: {} }).split('\n')[1]).toBe('- Password: (skipped)');
  });
  // The formatter chat used before kept a column-name answer of any length; core kept only 11 characters after a
  // qualified key, so a transcript line such as "Sort key: customerLastName" lost its answer.
  it.each(['id', 'created_at', 'customerLastName', 'orderPlacedAtTimestamp'])('keeps the sort-key answer %j in a transcript', answer => {
    const form = { id: 'f', title: 'F', questions: [{ id: 'notes', label: 'Notes', type: 'textarea' as const }] };
    expect(formatFormAnswers({ form, answers: { notes: `Sort key: ${answer}` } }).split('\n')[1]).toBe(`- Notes: Sort key: ${answer}`);
  });
});
