/** How the Swift helper's compile and output failures are reported when they arrive in unusual shapes. */
import { expect, it } from 'vitest';
import { ensureHelperCompiled, parseHelperJson, type CompileDeps } from '../mac-on-device-transcriber.js';

const messages = {
  compilerMissing: 'no swiftc',
  compilerFailed: ({ stderr }: { stderr: string }) => `swiftc failed: [${stderr}]`,
  invalidOutput: ({ stdout }: { stdout: string }) => `bad helper output: ${stdout}`,
  cannotTranscribe: ({ reason }: { reason: string }) => reason,
  recognitionFailed: ({ reason }: { reason: string }) => reason,
};

/** A fresh in-memory filesystem per call: the compile cache is keyed by filesystem port. */
function deps(failure: unknown): CompileDeps {
  return {
    fs: { existsSync: () => false, mkdirSync: () => undefined },
    execFileAsync: async () => { throw failure; },
    sourcePath: '/helper.swift', binaryPath: '/cache/helper', compilerPath: 'swiftc', messages,
  };
}

it.each([
  { label: 'a thrown string', failure: 'segfault' },
  { label: 'a thrown null', failure: null },
  { label: 'an error whose stderr is neither text nor bytes', failure: Object.assign(new Error('exit 1'), { stderr: 42 }) },
  { label: 'an error with no stderr at all', failure: new Error('exit 1') },
])('reports a compile failure carried by $label with empty diagnostics', async ({ failure }) => {
  expect(await ensureHelperCompiled(deps(failure))).toEqual({ ok: false, error: 'swiftc failed: []' });
});

it('trims a compiler diagnostic delivered as a string', async () => {
  expect(await ensureHelperCompiled(deps(Object.assign(new Error('exit 1'), { stderr: '  error: bad token\n' })))).toEqual({ ok: false, error: 'swiftc failed: [error: bad token]' });
});

it('refuses helper output that is a JSON array rather than an object', () => {
  expect(() => parseHelperJson({ stdout: '[{"ok":true}]\n', invalidOutput: messages.invalidOutput })).toThrow('bad helper output: [{"ok":true}]\n');
  expect(parseHelperJson({ stdout: ' {"ok":true,"text":"hi"} ', invalidOutput: messages.invalidOutput })).toEqual({ ok: true, text: 'hi' });
});
