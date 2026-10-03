import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  execFileImpl: null as
    | ((file: string, args: string[], options: unknown, cb: (err: Error | null, result?: { stdout: string; stderr: string }) => void) => void)
    | null,
  spawnImpl: null as ((bin: string, args: string[]) => EventEmitter) | null,
}));

vi.mock('node:child_process', () => ({
  execFile: (file: string, args: string[], options: unknown, cb: (err: Error | null, result?: { stdout: string; stderr: string }) => void) => {
    if (mockState.execFileImpl) return mockState.execFileImpl(file, args, options, cb);
    cb(null, { stdout: '', stderr: '' });
  },
  spawn: (bin: string, args: string[]) => {
    if (mockState.spawnImpl) return mockState.spawnImpl(bin, args);
    const emitter = new EventEmitter() as EventEmitter & { unref: () => void };
    emitter.unref = () => {};
    queueMicrotask(() => emitter.emit('spawn'));
    return emitter;
  },
}));

import { launchAgentInSystemTerminal } from '../terminal-launch.js';

afterEach(() => {
  mockState.execFileImpl = null;
  mockState.spawnImpl = null;
  vi.restoreAllMocks();
});

describe('launchAgentInSystemTerminal — darwin', () => {
  it('returns ok:true via osascript on success', async () => {
    mockState.execFileImpl = (_file, _args, _options, cb) => cb(null, { stdout: '', stderr: '' });
    const result = await launchAgentInSystemTerminal({ command: 'agy' }, { platform: 'darwin' });
    expect(result).toEqual({ ok: true, platform: 'darwin', via: 'osascript' });
  });

  it('escapes embedded double quotes in the command before building the AppleScript', async () => {
    let capturedScript = '';
    mockState.execFileImpl = (_file, args, _options, cb) => {
      capturedScript = String(args[1]);
      cb(null, { stdout: '', stderr: '' });
    };
    await launchAgentInSystemTerminal({ command: 'echo "hi"' }, { platform: 'darwin' });
    expect(capturedScript).toContain('echo \\"hi\\"');
  });

  it('returns ok:false with the Error message when osascript fails', async () => {
    mockState.execFileImpl = (_file, _args, _options, cb) => cb(new Error('boom'));
    const result = await launchAgentInSystemTerminal({ command: 'agy' }, { platform: 'darwin' });
    expect(result).toEqual({ ok: false, platform: 'darwin', reason: 'osascript failed: boom' });
  });

  it('stringifies a non-Error rejection', async () => {
    mockState.execFileImpl = (_file, _args, _options, cb) => cb('plain failure' as unknown as Error);
    const result = await launchAgentInSystemTerminal({ command: 'agy' }, { platform: 'darwin' });
    expect(result).toEqual({ ok: false, platform: 'darwin', reason: 'osascript failed: plain failure' });
  });
});

describe('launchAgentInSystemTerminal — linux', () => {
  it('succeeds on the first attempt (x-terminal-emulator)', async () => {
    const seen: string[] = [];
    mockState.spawnImpl = (bin) => {
      seen.push(bin);
      const emitter = new EventEmitter() as EventEmitter & { unref: () => void };
      emitter.unref = () => {};
      queueMicrotask(() => emitter.emit('spawn'));
      return emitter;
    };
    const result = await launchAgentInSystemTerminal({ command: 'agy' }, { platform: 'linux' });
    expect(result).toEqual({ ok: true, platform: 'linux', via: 'x-terminal-emulator' });
    expect(seen).toEqual(['x-terminal-emulator']);
  });

  it('falls through to the next terminal when an earlier one errors', async () => {
    const seen: string[] = [];
    mockState.spawnImpl = (bin) => {
      seen.push(bin);
      const emitter = new EventEmitter() as EventEmitter & { unref: () => void };
      emitter.unref = () => {};
      if (bin === 'x-terminal-emulator' || bin === 'gnome-terminal') {
        queueMicrotask(() => emitter.emit('error', new Error(`${bin} missing`)));
      } else {
        queueMicrotask(() => emitter.emit('spawn'));
      }
      return emitter;
    };
    const result = await launchAgentInSystemTerminal({ command: 'agy' }, { platform: 'linux' });
    expect(result).toEqual({ ok: true, platform: 'linux', via: 'konsole' });
    expect(seen).toEqual(['x-terminal-emulator', 'gnome-terminal', 'konsole']);
  });

  it('reports an aggregated failure reason when every terminal fails', async () => {
    mockState.spawnImpl = (bin) => {
      const emitter = new EventEmitter() as EventEmitter & { unref: () => void };
      emitter.unref = () => {};
      queueMicrotask(() => emitter.emit('error', new Error(`${bin} not found`)));
      return emitter;
    };
    const result = await launchAgentInSystemTerminal({ command: 'agy' }, { platform: 'linux' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('no system terminal worked');
      expect(result.reason).toContain('x-terminal-emulator: x-terminal-emulator not found');
      expect(result.reason).toContain('xterm: xterm not found');
    }
  });

  it('stringifies a non-Error spawn error event', async () => {
    mockState.spawnImpl = () => {
      const emitter = new EventEmitter() as EventEmitter & { unref: () => void };
      emitter.unref = () => {};
      queueMicrotask(() => emitter.emit('error', 'raw string error'));
      return emitter;
    };
    const result = await launchAgentInSystemTerminal({ command: 'agy' }, { platform: 'linux' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('x-terminal-emulator: raw string error');
  });
});

describe('launchAgentInSystemTerminal — win32', () => {
  it('returns ok:true via cmd /c start on success, using the default window title', async () => {
    let capturedArgs: string[] = [];
    mockState.execFileImpl = (_file, args, _options, cb) => {
      capturedArgs = args;
      cb(null, { stdout: '', stderr: '' });
    };
    const result = await launchAgentInSystemTerminal({ command: 'agy' }, { platform: 'win32' });
    expect(result).toEqual({ ok: true, platform: 'win32', via: 'cmd /c start' });
    expect(capturedArgs).toEqual(['/c', 'start', 'Agent Sign-in', 'cmd.exe', '/k', 'agy']);
  });

  it('honors a custom window title', async () => {
    let capturedArgs: string[] = [];
    mockState.execFileImpl = (_file, args, _options, cb) => {
      capturedArgs = args;
      cb(null, { stdout: '', stderr: '' });
    };
    await launchAgentInSystemTerminal({ command: 'agy' }, { platform: 'win32', windowTitle: 'Custom Title' });
    expect(capturedArgs).toEqual(['/c', 'start', 'Custom Title', 'cmd.exe', '/k', 'agy']);
  });

  it('returns ok:false with the Error message when cmd /c start fails', async () => {
    mockState.execFileImpl = (_file, _args, _options, cb) => cb(new Error('access denied'));
    const result = await launchAgentInSystemTerminal({ command: 'agy' }, { platform: 'win32' });
    expect(result).toEqual({ ok: false, platform: 'win32', reason: 'cmd /c start failed: access denied' });
  });

  it('stringifies a non-Error rejection', async () => {
    mockState.execFileImpl = (_file, _args, _options, cb) => cb('plain failure' as unknown as Error);
    const result = await launchAgentInSystemTerminal({ command: 'agy' }, { platform: 'win32' });
    expect(result).toEqual({ ok: false, platform: 'win32', reason: 'cmd /c start failed: plain failure' });
  });
});

describe('launchAgentInSystemTerminal — unsupported platform', () => {
  it('returns ok:false without attempting any spawn', async () => {
    const result = await launchAgentInSystemTerminal({ command: 'agy' }, { platform: 'sunos' });
    expect(result).toEqual({
      ok: false,
      platform: 'sunos',
      reason: 'system-terminal launch is not supported on sunos',
    });
  });

  it('defaults platform to process.platform when omitted', async () => {
    mockState.execFileImpl = (_file, _args, _options, cb) => cb(null, { stdout: '', stderr: '' });
    mockState.spawnImpl = () => {
      const emitter = new EventEmitter() as EventEmitter & { unref: () => void };
      emitter.unref = () => {};
      queueMicrotask(() => emitter.emit('spawn'));
      return emitter;
    };
    const result = await launchAgentInSystemTerminal({ command: 'agy' });
    expect(result.platform).toBe(process.platform);
  });
});
