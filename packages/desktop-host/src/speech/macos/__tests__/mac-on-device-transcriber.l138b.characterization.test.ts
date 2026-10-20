import { describe, expect, it, vi } from 'vitest';
import { transcribeWav, type MacTranscriberDeps } from '../mac-on-device-transcriber.js';

function fixture({ stdout }: { stdout: string }, _options = {}) {
  const fs: MacTranscriberDeps['fs'] = {
    existsSync: () => true, mkdirSync: vi.fn(), writeFileSync: vi.fn(), rmSync: vi.fn(),
  };
  const deps: MacTranscriberDeps = {
    fs, execFileAsync: vi.fn(async () => ({ stdout })), sourcePath: '/source.swift',
    binaryPath: '/helper', compilerPath: '/swiftc', locale: 'fr-FR', tempFilePath: () => '/scratch.wav',
    messages: {
      compilerMissing: 'missing', compilerFailed: ({ stderr }) => `compile: ${stderr}`,
      invalidOutput: ({ stdout }) => `invalid: ${stdout}`, cannotTranscribe: ({ reason }) => `unavailable: ${reason}`,
      recognitionFailed: ({ reason }) => `recognition: ${reason}`,
    },
  };
  return deps;
}

describe('native transcription result characterization', () => {
  it.each([
    ['{"ok":true,"text":"hello","elapsedMs":12}', { text: 'hello', elapsedMs: 12 }],
    ['{"ok":true}', { text: '', elapsedMs: 0 }],
    ['{"ok":true,"text":"","elapsedMs":0}', { text: '', elapsedMs: 0 }],
    ['{"ok":true,"elapsedMs":-1.5}', { text: '', elapsedMs: -1.5 }],
  ] as const)('returns helper defaults and values for %s', async (stdout, expected) => {
    const deps = fixture({ stdout });
    const wavBuffer = Buffer.from('wav');
    expect(await transcribeWav({ ...deps, wavBuffer })).toEqual(expected);
    expect(deps.fs.writeFileSync).toHaveBeenCalledWith({ path: '/scratch.wav', data: wavBuffer });
    expect(deps.execFileAsync).toHaveBeenCalledTimes(1);
    expect(deps.execFileAsync).toHaveBeenCalledWith({ file: '/helper', args: ['transcribe', '/scratch.wav', 'fr-FR'] });
    expect(deps.fs.rmSync).toHaveBeenCalledTimes(1);
    expect(deps.fs.rmSync).toHaveBeenCalledWith({ path: '/scratch.wav' }, { force: true });
  });

  it.each([
    ['{"ok":false,"error":"denied"}', 'recognition: denied'],
    ['{"ok":false}', 'recognition: '],
    ['{"ok":"true","error":"wrong flag"}', 'recognition: wrong flag'],
    ['{}', 'recognition: '],
    ...[null, 1, false].map(text => {
      const stdout = JSON.stringify({ ok: true, text });
      return [stdout, `invalid: ${stdout}`];
    }),
    ...[null, '1', false].map(elapsedMs => {
      const stdout = JSON.stringify({ ok: true, elapsedMs });
      return [stdout, `invalid: ${stdout}`];
    }),
    ['{"ok":true,"elapsedMs":1e400}', 'invalid: {"ok":true,"elapsedMs":null}'],
    ['{"ok":true,"elapsedMs":-1e400}', 'invalid: {"ok":true,"elapsedMs":null}'],
  ])('rejects helper result %s and removes the recording', async (stdout, message) => {
    const deps = fixture({ stdout: stdout! });
    await expect(transcribeWav({ ...deps, wavBuffer: Buffer.from('wav') })).rejects.toThrow(message);
    expect(deps.fs.rmSync).toHaveBeenCalledTimes(1);
    expect(deps.fs.rmSync).toHaveBeenCalledWith({ path: '/scratch.wav' }, { force: true });
  });

  it('keeps compile failure ahead of scratch allocation', async () => {
    const deps = fixture({ stdout: '' });
    deps.fs.existsSync = () => false;
    deps.execFileAsync = async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); };
    deps.tempFilePath = vi.fn(() => '/scratch.wav');
    await expect(transcribeWav({ ...deps, wavBuffer: Buffer.from('wav') })).rejects.toThrow('unavailable: missing');
    expect(deps.tempFilePath).not.toHaveBeenCalled();
    expect(deps.fs.writeFileSync).not.toHaveBeenCalled();
    expect(deps.fs.rmSync).not.toHaveBeenCalled();
  });
});
