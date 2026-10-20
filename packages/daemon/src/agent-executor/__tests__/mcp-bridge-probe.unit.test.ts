import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { spawn as nodeSpawn, ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeMcpBridge } from '../mcp-bridge-probe.js';
import { bridgeUnavailableMessage } from '../mcp-bridge.js';

function fakeBridge() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill: vi.fn(() => true),
  });
  const calls: unknown[][] = [];
  const spawn = ((...args: unknown[]) => {
    calls.push(args);
    return child as unknown as ChildProcess;
  }) as typeof nodeSpawn;
  const writes: string[] = [];
  child.stdin.on('data', (chunk) => writes.push(chunk.toString()));
  return { child, spawn, calls, writes };
}

const entry = { command: '/node', args: ['bridge.js'] };
const missingSdk = "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@modelcontextprotocol/sdk'";

afterEach(() => vi.useRealTimers());

describe('probeMcpBridge', () => {
  it('sends initialize and accepts the matching result after chatter and fragmented lines', async () => {
    vi.useFakeTimers();
    const fake = fakeBridge();
    let time = 100;
    const pending = probeMcpBridge({ entry }, { spawn: fake.spawn, baseEnv: {}, now: () => time });
    expect(fake.writes).toEqual([
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"jini-bridge-probe","version":"0"}}}\n',
    ]);
    fake.child.stdout.write('booting\n{"id":2,"result":{}}\n{"id":1,"error":{}}\n{"id":');
    time = 125;
    fake.child.stdout.write('1,"result":{}}\n');
    expect(await pending).toEqual({ ok: true, exitCode: null, signal: null, stderrTail: '', elapsedMs: 25 });
    expect(fake.child.kill.mock.calls).toEqual([['SIGKILL']]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns the exact missing-package diagnostic and exit code', async () => {
    const fake = fakeBridge();
    const pending = probeMcpBridge({ entry }, { spawn: fake.spawn, baseEnv: {}, now: () => 0 });
    fake.child.stderr.write(`${missingSdk}\n`);
    fake.child.emit('exit', 1, null);
    expect(await pending).toEqual({ ok: false, exitCode: 1, signal: null, stderrTail: missingSdk, elapsedMs: 0 });
    expect(fake.child.kill.mock.calls).toEqual([['SIGKILL']]);
  });

  it('times out and kills a bridge that never replies', async () => {
    vi.useFakeTimers();
    const fake = fakeBridge();
    const pending = probeMcpBridge({ entry }, { spawn: fake.spawn, baseEnv: {}, timeoutMs: 5 });
    await vi.advanceTimersByTimeAsync(5);
    expect(await pending).toEqual({ ok: false, exitCode: null, signal: null, stderrTail: '', elapsedMs: 5 });
    expect(fake.child.kill.mock.calls).toEqual([['SIGKILL']]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('merges the base and entry env while stripping credentials from both and using a diagnostic run id', async () => {
    const fake = fakeBridge();
    const pending = probeMcpBridge({ entry: { ...entry, env: {
      ELECTRON_RUN_AS_NODE: '1', PATH: '/bridge/bin', JINI_RUN_ID: 'real-run', JINI_DAEMON_TOKEN: 'entry-fixture',
    } } }, { spawn: fake.spawn, baseEnv: { PATH: '/bin', HOME: '/home', JINI_DAEMON_TOKEN: 'base-fixture' } });
    fake.child.stdout.write('{"id":1,"result":{}}\n');
    await pending;
    expect(fake.calls).toEqual([['/node', ['bridge.js'], { stdio: 'pipe', env: {
      PATH: '/bridge/bin', HOME: '/home', ELECTRON_RUN_AS_NODE: '1', JINI_RUN_ID: 'bridge-probe',
    } }]]);
  });

  it('keeps exactly the last 2000 stderr bytes across chunks', async () => {
    const fake = fakeBridge();
    const pending = probeMcpBridge({ entry }, { spawn: fake.spawn, baseEnv: {}, now: () => 0 });
    fake.child.stderr.write('discard'.repeat(500));
    fake.child.stderr.write('z'.repeat(1999) + '!');
    fake.child.emit('exit', 1, null);
    expect((await pending).stderrTail).toBe('z'.repeat(1999) + '!');
  });

  it('uses only the baseline launch environment by default', async () => {
    const fake = fakeBridge();
    const pending = probeMcpBridge({ entry }, { spawn: fake.spawn });
    fake.child.stdout.write('{"id":1,"result":{}}\n');
    await pending;
    const options = fake.calls[0]?.[2] as { env: Record<string, string> };
    const baselineKeys = ['PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TEMP', 'TMP', 'SHELL',
      'LANG', 'LC_ALL', 'LC_CTYPE', 'USER', 'SystemRoot', 'windir', 'ComSpec', 'PATHEXT'];
    expect(Object.keys(options.env).sort()).toEqual([
      ...baselineKeys.filter((key) => typeof process.env[key] === 'string'), 'JINI_RUN_ID',
    ].sort());
  });

  it('redacts credential assignments and bearer values even when split across chunks', async () => {
    const fake = fakeBridge();
    const pending = probeMcpBridge({ entry }, { spawn: fake.spawn, baseEnv: {} });
    fake.child.stderr.write('JINI_DAEMON_TOKEN=fixture-');
    fake.child.stderr.write('token\nBearer fixture-bearer\n');
    fake.child.emit('exit', 1, null);
    expect((await pending).stderrTail).toBe('[REDACTED:daemon_token]\nBearer [REDACTED:bearer_token]');
  });

  it('reports an asynchronous ENOENT spawn error', async () => {
    const fake = fakeBridge();
    const pending = probeMcpBridge({ entry }, { spawn: fake.spawn, baseEnv: {}, now: () => 0 });
    fake.child.emit('error', new Error('spawn /node ENOENT'));
    expect(await pending).toEqual({ ok: false, exitCode: null, signal: null, stderrTail: 'spawn /node ENOENT', elapsedMs: 0 });
    expect(fake.child.kill.mock.calls).toEqual([['SIGKILL']]);
  });

  it('reports close with its signal even without an exit event', async () => {
    const fake = fakeBridge();
    const pending = probeMcpBridge({ entry }, { spawn: fake.spawn, baseEnv: {}, now: () => 0 });
    fake.child.emit('close', null, 'SIGTERM');
    expect(await pending).toEqual({ ok: false, exitCode: null, signal: 'SIGTERM', stderrTail: '', elapsedMs: 0 });
  });

  it('reports a synchronous spawn throw and clears its timer', async () => {
    vi.useFakeTimers();
    const spawn = (() => { throw new Error('spawn EACCES'); }) as typeof nodeSpawn;
    expect(await probeMcpBridge({ entry }, { spawn, baseEnv: {}, now: () => 0 })).toEqual({
      ok: false, exitCode: null, signal: null, stderrTail: 'spawn EACCES', elapsedMs: 0,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports stdin failure rather than leaving an unhandled stream error', async () => {
    const fake = fakeBridge();
    const pending = probeMcpBridge({ entry }, { spawn: fake.spawn, baseEnv: {}, now: () => 0 });
    fake.child.stdin.emit('error', new Error('write EPIPE'));
    expect((await pending).stderrTail).toBe('write EPIPE');
    expect(fake.child.kill.mock.calls).toEqual([['SIGKILL']]);
  });
});

describe('bridgeUnavailableMessage', () => {
  const original = 'The assistant\'s tools did not load (MCP bridge "jini" status: failed). The run was stopped instead of continuing without them.';
  const failed = { ok: false, exitCode: 1, signal: null, stderrTail: `preamble\n${missingSdk}\nstack frame`, elapsedMs: 2 };
  it('keeps the existing message without a probe or when probing succeeds', () => {
    expect(bridgeUnavailableMessage('failed')).toBe(original);
    expect(bridgeUnavailableMessage('failed', { ...failed, ok: true })).toBe(original);
  });
  it('chooses the first Error line, falling back to the last stderr line', () => {
    expect(bridgeUnavailableMessage('failed', failed)).toBe(`${original} Bridge exited with code 1: ${missingSdk}`);
    expect(bridgeUnavailableMessage('failed', { ...failed, stderrTail: 'first\nlast\n' })).toBe(`${original} Bridge exited with code 1: last`);
  });
});

describe('probeMcpBridge (characterization)', () => {
  it('still returns the original diagnostic when killing the bridge throws', async () => {
    const fake = fakeBridge();
    fake.child.kill.mockImplementation(() => { throw new Error('kill ESRCH'); });
    const pending = probeMcpBridge({ entry }, { spawn: fake.spawn, baseEnv: {}, now: () => 0 });
    fake.child.emit('exit', 3, null);
    expect(await pending).toEqual({ ok: false, exitCode: 3, signal: null, stderrTail: '', elapsedMs: 0 });
    expect(fake.child.kill.mock.calls).toEqual([['SIGKILL']]);
  });

  it('tolerates a child without stdio streams and reports its exit', async () => {
    const child = Object.assign(new EventEmitter(), { stdin: null, stdout: null, stderr: null, kill: vi.fn(() => true) });
    // Malformed-input fixture: a ChildProcess whose stdio pipes are all absent.
    const spawn = (() => child as unknown as ChildProcess) as typeof nodeSpawn;
    const pending = probeMcpBridge({ entry }, { spawn, baseEnv: {}, now: () => 0 });
    child.emit('exit', 0, null);
    expect(await pending).toEqual({ ok: false, exitCode: 0, signal: null, stderrTail: '', elapsedMs: 0 });
    expect(child.kill.mock.calls).toEqual([['SIGKILL']]);
  });

  it('keeps waiting past non-object and result-less id 1 replies', async () => {
    vi.useFakeTimers();
    const fake = fakeBridge();
    const pending = probeMcpBridge({ entry }, { spawn: fake.spawn, baseEnv: {}, timeoutMs: 5, now: () => 0 });
    fake.child.stdout.write('1\n[{"id":1,"result":{}}]\n{"id":"1","result":{}}\n{"id":1}\nnull\n');
    await vi.advanceTimersByTimeAsync(5);
    expect((await pending).ok).toBe(false);
  });

  it('accepts an id 1 reply whose result is null', async () => {
    const fake = fakeBridge();
    const pending = probeMcpBridge({ entry }, { spawn: fake.spawn, baseEnv: {}, now: () => 0 });
    fake.child.stdout.write('{"id":1,"result":null}\n');
    expect((await pending).ok).toBe(true);
  });

  it('reports a stdout stream error through the line reader', async () => {
    const fake = fakeBridge();
    const pending = probeMcpBridge({ entry }, { spawn: fake.spawn, baseEnv: {}, now: () => 0 });
    fake.child.stdout.emit('error', new Error('read EIO'));
    expect(await pending).toEqual({ ok: false, exitCode: null, signal: null, stderrTail: 'read EIO', elapsedMs: 0 });
  });

  it('keeps the first outcome when the bridge exits after replying', async () => {
    const fake = fakeBridge();
    const pending = probeMcpBridge({ entry }, { spawn: fake.spawn, baseEnv: {}, now: () => 0 });
    fake.child.stdout.write('{"id":1,"result":{}}\n');
    fake.child.emit('exit', 9, null);
    expect((await pending).ok).toBe(true);
  });

  it('appends an error message after existing stderr and redacts a daemon token assignment in any case', async () => {
    const fake = fakeBridge();
    const pending = probeMcpBridge({ entry }, { spawn: fake.spawn, baseEnv: {}, now: () => 0 });
    fake.child.stderr.write(['jini_daemon_token', '=abc'].join(''));
    fake.child.emit('error', new Error('boom'));
    expect((await pending).stderrTail).toBe('[REDACTED:daemon_token]\nboom');
  });
});
