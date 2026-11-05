import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { validatePasswordPolicy } from './password-policy.js';

/** Read one terminal secret through a muted readline output; never print input or accept argv.
 * @throws On a nonterminal, EOF, Ctrl-C, or input error. Always closes readline to restore raw mode.
 * @complexity O(p) memory/time for p entered characters; password policy bounds the accepted result.
 */
export async function readHiddenPassword(
  { prompt }: { prompt: string },
  { input = process.stdin, output = process.stderr }: {
    input?: NodeJS.ReadableStream & { isTTY?: boolean };
    output?: Pick<NodeJS.WritableStream, 'write'>;
  } = {},
): Promise<string> {
  if (!input.isTTY) throw new Error('Password input needs a terminal. Run interactively or set the owner reset password in the host secret environment. Details: owner-reset-terminal');
  const muted = new Writable({ write: (_chunk, _encoding, done) => done() });
  const rl = createInterface({ input, output: muted, terminal: true });
  output.write(prompt);
  try {
    return await new Promise<string>((resolve, reject) => {
      const cancelled = () => reject(new Error('Password entry was cancelled. Run the reset command again. Details: owner-reset-input'));
      rl.once('line', resolve);
      rl.once('close', cancelled);
      rl.once('SIGINT', cancelled);
      rl.once('error', reject);
    });
  } finally { rl.close(); output.write('\n'); }
}

/** Resolve the host-secret fallback or two hidden prompts; validate before opening a writable store.
 * @throws On mismatch or invalid password. Passwords are preserved exactly as entered.
 * @complexity O(p) for password validation; at most two terminal reads, no database I/O.
 */
export async function ownerResetPassword(
  { env, passwordEnvKey }: { env: Readonly<Record<string, string | undefined>>; passwordEnvKey: string },
  { prompt = (label: string) => readHiddenPassword({ prompt: label }) }: { prompt?: (label: string) => Promise<string> } = {},
): Promise<string> {
  const password = env[passwordEnvKey] ?? await prompt('New owner password (not shown): ');
  if (env[passwordEnvKey] === undefined && password !== await prompt('Confirm owner password (not shown): ')) {
    throw new Error('The passwords do not match. Run the reset command again. Details: owner-reset-confirmation');
  }
  const error = validatePasswordPolicy({ password });
  if (error) throw new Error(`${error} Run the reset command again. Details: owner-reset-password`);
  return password;
}
