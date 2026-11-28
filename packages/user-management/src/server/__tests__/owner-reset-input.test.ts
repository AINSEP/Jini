import { test, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { readHiddenPassword, ownerResetPassword } from '../owner-reset-input.js';

test('the env fallback wins without prompting and passwords are never trimmed', async () => {
  expect(await ownerResetPassword({ passwordEnvKey: 'HOST_RESET_SECRET', env: { HOST_RESET_SECRET: ' secret ' } }, {
    prompt: async () => { throw new Error('must not prompt'); },
  })).toBe(' secret ');
});

test('interactive passwords are confirmed and mismatch refuses before writes', async () => {
  const values = ['first', 'second'];
  await expect(ownerResetPassword({ passwordEnvKey: 'HOST_RESET_SECRET', env: {} }, { prompt: async () => values.shift()! })).rejects.toThrow('do not match');
});

test('hidden input writes only the prompt and restores the terminal on completion', async () => {
  const input = Object.assign(new PassThrough(), { isTTY: true });
  const output: string[] = [];
  const pending = readHiddenPassword({ prompt: 'New password: ' }, { input, output: { write: text => { output.push(String(text)); return true; } } });
  input.write('very-private-password\n');
  expect(await pending).toBe('very-private-password');
  expect(output.join('')).not.toContain('very-private-password');
});

test('nonterminal input and premature EOF refuse with no password', async () => {
  await expect(readHiddenPassword({ prompt: '' }, { input: new PassThrough() })).rejects.toThrow('terminal');
  const input = Object.assign(new PassThrough(), { isTTY: true });
  const pending = readHiddenPassword({ prompt: '' }, { input, output: { write: () => true } });
  input.end();
  await expect(pending).rejects.toThrow('cancelled');
});

test('a password the policy refuses is rejected with the policy reason, from env or prompt', async () => {
  await expect(ownerResetPassword({ passwordEnvKey: 'HOST_RESET_SECRET', env: { HOST_RESET_SECRET: '' } }))
    .rejects.toThrow('Password is required. Run the reset command again. Details: owner-reset-password');
  await expect(ownerResetPassword({ passwordEnvKey: 'HOST_RESET_SECRET', env: {} }, { prompt: async () => 'x'.repeat(2000) }))
    .rejects.toThrow('Details: owner-reset-password');
});

test('without an injected prompt the default reads the terminal and refuses a nonterminal stdin', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });
  try {
    await expect(ownerResetPassword({ passwordEnvKey: 'HOST_RESET_SECRET', env: {} })).rejects.toThrow('Details: owner-reset-terminal');
  } finally {
    if (descriptor) Object.defineProperty(process.stdin, 'isTTY', descriptor);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
  }
});
