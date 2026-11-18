import { describe, expect, it } from 'vitest';
import { redactSecretsWithCounts } from '../redact.js';

const run = (input: string) => redactSecretsWithCounts({ input }, { redactPii: false });

// Found by comparing the old chat rules with the engine on text from every package's tests: a credential
// inside JSON that was itself escaped into a string (`{\"password\":\"x\"}`), a command-line flag
// (`--token=x`), and an env-style name whose value follows a blank line.
describe('credential forms the old chat rules masked and the engine left visible', () => {
  it.each([
    ['{\\"password\\":\\"hunter2\\",\\"user\\":\\"bob\\"}', '{\\"password\\":\\"[REDACTED:labeled_secret]\\",\\"user\\":\\"bob\\"}'],
    ['{\\"token\\": \\"abc\\"}', '{\\"token\\": \\"[REDACTED:labeled_secret]\\"}'],
    ['{\\"api_key\\":\\"abc123\\",\\"page\\":2}', '{\\"api_key\\":\\"[REDACTED:labeled_secret]\\",\\"page\\":2}'],
    ['node.exe --token=must-never-be-returned', 'node.exe --token=[REDACTED:labeled_secret]'],
    ['run --password=hunter2 --user=bob', 'run --password=[REDACTED:labeled_secret] --user=bob'],
    ['run --secret=abc123 now', 'run --secret=[REDACTED:labeled_secret] now'],
    ['run --api-key=abc12345 now', 'run --api-key=[REDACTED:api_key_header] now'],
    ['DB_PASSWORD=\n\nhunter2', 'DB_PASSWORD=\n\n[REDACTED:labeled_secret]'],
  ])('%j', (input, expected) => {
    const first = run(input);
    expect(first.redacted).toBe(expected);
    expect(run(first.redacted).redacted).toBe(expected);
  });
  it.each(['--tokens=4096', '--token-count=12', '--passwordless=true', '--no-token', '{\\"user\\":\\"bob\\"}', '{\\"password manager\\":\\"x\\"}'])('keeps %j', input => {
    expect(run(input)).toEqual({ redacted: input, counts: {} });
  });
});
