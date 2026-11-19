import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false }).redacted;

// A YAML block scalar (`password: |` then indented lines) holds its value on the indented lines below the indicator; a
// Markdown label (`**Password:**`) closes its emphasis after the colon, before the value. Values are obviously fake.
describe('values in YAML block scalars and after Markdown emphasis', () => {
  it.each([
    ['password: |\n  hunter2\nnext: 1', 'password: [REDACTED:labeled_secret]\nnext: 1'],
    ['db:\n  password: >-\n    two words\n    more\n  user: app', 'db:\n  password: [REDACTED:labeled_secret]\n  user: app'],
    ['token: |\r\n  abc\r\n\r\n  def\r\nmode: x', 'token: [REDACTED:labeled_secret]\r\nmode: x'],
  ])('masks the body of a block scalar: %j', (input, expected) => {
    expect(run(input)).toBe(expected);
  });

  it('keeps the next field when the block indicator has no indented body', () => {
    expect(run('password: |\nnext: 1')).toBe('password: [REDACTED:labeled_secret]\nnext: 1');
  });

  it.each([
    ['**Password:** hunter2', '**Password:** [REDACTED:labeled_secret]'],
    ['**Password**: hunter2', '**Password**: [REDACTED:labeled_secret]'],
  ])('masks the value after an emphasised label: %j', (input, expected) => {
    expect(run(input)).toBe(expected);
  });

  it('keeps a masked display after an emphasised label', () => {
    expect(run('**Password:** ******')).toBe('**Password:** ******');
  });
});
