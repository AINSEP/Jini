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
