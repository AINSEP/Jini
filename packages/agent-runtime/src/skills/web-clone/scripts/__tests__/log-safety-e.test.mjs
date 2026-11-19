import { expect, it } from 'vitest';
import { runIfMain as runGuardEntry } from '../lib/main-guard.mjs';
import { runIfMain as runScriptEntry } from '../lib/script-cli.mjs';

it.each([
  { name: 'main-guard', runEntry: runGuardEntry },
  { name: 'script-cli', runEntry: runScriptEntry },
])('$name reports a non-usage thrown string safely and exits exactly once', async ({ runEntry }) => {
  const stdout = [];
  const stderr = [];
  const exits = [];
  const sentinel = 'PRIVATE_THROWN_STRING_SENTINEL\n    at PRIVATE_STACK_SENTINEL';
  const ran = await runEntry({ moduleUrl: 'file:///scripts/tool.mjs', main: async () => { throw sentinel; } }, {
    argv: ['node', '/scripts/tool.mjs'], realpath: (file) => file,
    stdout: { write: (line) => stdout.push(line) },
    stderr: { write: (line) => stderr.push(line) },
    onExit: ({ code }) => exits.push(code),
    setExitCode: (code) => exits.push(code),
  });
  expect(ran).toBe(true);
  expect(stdout).toEqual([]);
  expect(stderr).toEqual(['web-clone failed: string\n']);
  expect(exits).toEqual([1]);
  expect(stderr.join('')).not.toMatch(/PRIVATE_THROWN_STRING_SENTINEL|PRIVATE_STACK_SENTINEL|\n\s+at /);
});
