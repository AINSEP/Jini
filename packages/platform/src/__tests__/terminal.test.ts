import { chmodSync, statSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createTerminalService,
  ensureSpawnHelperExecutable,
  resolveShell,
  spawnHelperCandidatePaths,
  type CreateTerminalServiceOptions,
  type PtyProcess,
  type PtySpawn,
  type TerminalEventData,
  type TerminalSseSink,
} from '../terminal.js';

class FakePty implements PtyProcess {
  dataCb: ((chunk: string) => void) | null = null;
  exitCb: ((event: { exitCode: number; signal?: number }) => void) | null = null;
  writeCalls: string[] = [];
  resizeCalls: Array<[number, number]> = [];
  killCalls: string[] = [];
  writeShouldThrow = false;
  resizeShouldThrow = false;
  killShouldThrow = false;

  onData(cb: (chunk: string) => void): void {
    this.dataCb = cb;
  }
  onExit(cb: (event: { exitCode: number; signal?: number }) => void): void {
    this.exitCb = cb;
  }
  write(input: string): void {
    if (this.writeShouldThrow) throw new Error('write failed');
    this.writeCalls.push(input);
  }
  resize(cols: number, rows: number): void {
    if (this.resizeShouldThrow) throw new Error('resize failed');
    this.resizeCalls.push([cols, rows]);
  }
  kill(signal?: string): void {
    if (this.killShouldThrow) throw new Error('kill failed');
    this.killCalls.push(signal ?? '');
  }
  emitData(chunk: string): void {
    this.dataCb?.(chunk);
  }
  emitExit(exitCode: number, signal?: number): void {
    this.exitCb?.(signal === undefined ? { exitCode } : { exitCode, signal });
  }
}

class FakeSink implements TerminalSseSink {
  events: Array<{ event: string; data: TerminalEventData; id: number }> = [];
  ended = false;
  send(event: string, data: TerminalEventData, id: number): void {
    this.events.push({ event, data, id });
  }
  end(): void {
    this.ended = true;
  }
}

const tempDirsToClean: string[] = [];

afterEach(async () => {
  while (tempDirsToClean.length > 0) {
    const dir = tempDirsToClean.pop();
    if (dir) await rm(dir, { force: true, recursive: true });
  }
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirsToClean.push(dir);
  return dir;
}

describe('@jini-ai/platform — terminal — spawnHelperCandidatePaths', () => {
  it('returns empty on win32', () => {
    expect(spawnHelperCandidatePaths({ platform: 'win32' })).toEqual([]);
  });

  it('defaults platform to process.platform when omitted', () => {
    // Whichever platform this test runs on, omitting `platform` must behave
    // identically to passing it explicitly (node-pty still isn't installed,
    // so both resolve to the not-found path unless running on win32).
    expect(spawnHelperCandidatePaths({ resolve: () => '/pkg/node-pty/lib/index.js' })).toEqual(
      spawnHelperCandidatePaths({ platform: process.platform, resolve: () => '/pkg/node-pty/lib/index.js' }),
    );
  });

  it('returns empty when node-pty cannot be resolved', () => {
    expect(
      spawnHelperCandidatePaths({
        platform: 'linux',
        resolve: () => {
          throw new Error('not found');
        },
      }),
    ).toEqual([]);
  });

  it('uses the real require.resolve-based default resolver, whichever way it resolves in this workspace', () => {
    // This package deliberately does not depend on node-pty (see the module docblock) — but
    // whether `require.resolve('node-pty')` actually throws from this file depends on the test
    // runner's own module resolution and on which sibling packages currently declare node-pty as
    // a real dependency (e.g. @jini-ai/daemon, added 2026-07-21), not on anything this package or
    // this test controls. Verified directly, not assumed: a plain `node -e
    // "require.resolve('node-pty')"` run from this package's own directory still throws (real
    // production Node resolution is unaffected by a sibling package's dependency) — only
    // vitest/Vite's broader test-time resolver can differ. Rather than hardcoding an outcome that
    // depends on ambient workspace composition (and silently going stale — exactly the kind of
    // now-false "not installed" assumption that used to make this test fail outright once
    // @jini-ai/daemon added node-pty), this asserts the real default resolver's behavior is
    // internally consistent in whichever state actually holds right now.
    const result = spawnHelperCandidatePaths({ platform: 'linux' });
    if (result.length === 0) {
      // The common case for this package: node-pty is not resolvable, the graceful-degradation
      // path the adjacent injected-throw test above also covers, exercised here via the real
      // resolver instead of a fake one.
      return;
    }
    // node-pty happens to be resolvable through the test runner's own resolution right now — real
    // coverage of the default resolver's success path, previously never exercised for real.
    expect(result).toHaveLength(2);
    expect(result[0]).toMatch(/spawn-helper$/);
    expect(result[1]).toMatch(/spawn-helper$/);
  });

  it('derives the two candidate paths from a resolved package entry point', () => {
    const paths = spawnHelperCandidatePaths({
      platform: 'linux',
      resolve: () => '/pkg/node-pty/lib/index.js',
    });
    expect(paths).toEqual([
      join('/pkg/node-pty', 'build', 'Release', 'spawn-helper'),
      join('/pkg/node-pty', 'prebuilds', `linux-${process.arch}`, 'spawn-helper'),
    ]);
  });
});

describe('@jini-ai/platform — terminal — ensureSpawnHelperExecutable', () => {
  it('chmods a file missing the executable bit, leaves an executable one alone, and ignores a missing file', async () => {
    const dir = await makeTempDir('jini-terminal-helper-');
    const nonExec = join(dir, 'spawn-helper-nonexec');
    const alreadyExec = join(dir, 'spawn-helper-exec');
    const missing = join(dir, 'does-not-exist');
    writeFileSync(nonExec, '', { mode: 0o644 });
    writeFileSync(alreadyExec, '', { mode: 0o755 });

    expect(() => ensureSpawnHelperExecutable([nonExec, alreadyExec, missing])).not.toThrow();

    expect(statSync(nonExec).mode & 0o111).toBeTruthy();
    expect(statSync(alreadyExec).mode & 0o100).toBeTruthy();
  });
});

describe('@jini-ai/platform — terminal — resolveShell', () => {
  it('honors an explicit request', () => {
    expect(resolveShell('  /bin/zsh  ')).toBe('/bin/zsh');
  });

  it('falls back to SHELL on posix', () => {
    expect(resolveShell(null, { platform: 'linux', env: { SHELL: '/bin/fish' } })).toBe('/bin/fish');
  });

  it('falls back to /bin/bash on posix with no SHELL', () => {
    expect(resolveShell(undefined, { platform: 'linux', env: {} })).toBe('/bin/bash');
  });

  it('falls back to ComSpec on win32', () => {
    expect(resolveShell(null, { platform: 'win32', env: { ComSpec: 'C:\\cmd.exe' } })).toBe('C:\\cmd.exe');
  });

  it('falls back to powershell.exe on win32 with no ComSpec', () => {
    expect(resolveShell(null, { platform: 'win32', env: {} })).toBe('powershell.exe');
  });
});

function makeService(overrides: Partial<CreateTerminalServiceOptions> = {}) {
  const ptys: FakePty[] = [];
  const spawnPty: PtySpawn = () => {
    const pty = new FakePty();
    ptys.push(pty);
    return pty;
  };
  const loadSpawnPty = vi.fn(async () => spawnPty);
  const service = createTerminalService({
    loadSpawnPty,
    maxEvents: 5,
    maxBufferBytes: 100,
    exitTailBytes: 20,
    flushIntervalMs: 5,
    flushThresholdBytes: 10,
    ttlMs: 40,
    shutdownGraceMs: 10,
    ...overrides,
  });
  return { service, ptys, loadSpawnPty };
}

describe('@jini-ai/platform — terminal — createTerminalService lifecycle', () => {
  it('creates a session, loading the pty spawner lazily and only once', async () => {
    const { service, loadSpawnPty } = makeService();
    const session = await service.create({ cwd: '/work' });
    expect(session.status).toBe('running');
    expect(session.cols).toBe(80);
    expect(session.rows).toBe(24);
    await service.create({ cwd: '/work' });
    expect(loadSpawnPty).toHaveBeenCalledTimes(1);
  });

  it('clamps cols/rows and threads through an explicit projectId and shell', async () => {
    const { service } = makeService();
    const session = await service.create({ cwd: '/work', cols: -5, rows: 5000, projectId: 'proj-1', shell: 'zsh' });
    expect(session.cols).toBe(1);
    expect(session.rows).toBe(1000);
    expect(session.projectId).toBe('proj-1');
    expect(session.shell).toBe('zsh');
  });

  it('get/list find sessions by id and filter by projectId', async () => {
    const { service } = makeService();
    const a = await service.create({ cwd: '/work', projectId: 'p1' });
    const b = await service.create({ cwd: '/work', projectId: 'p2' });

    expect(service.get(a.id)?.id).toBe(a.id);
    expect(service.get('missing')).toBeNull();
    expect(service.list().map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
    expect(service.list({ projectId: 'p1' }).map((s) => s.id)).toEqual([a.id]);
  });

  it('writes to a running session and reports failure for a missing one', async () => {
    const { service, ptys } = makeService();
    const session = await service.create({ cwd: '/work' });
    expect(service.write(session.id, 'ls\n')).toBe(true);
    expect(ptys[0]?.writeCalls).toEqual(['ls\n']);
    expect(service.write('missing', 'ls\n')).toBe(false);
  });

  it('reports write failure when the pty throws', async () => {
    const { service, ptys } = makeService();
    const session = await service.create({ cwd: '/work' });
    ptys[0]!.writeShouldThrow = true;
    expect(service.write(session.id, 'ls\n')).toBe(false);
  });

  it('resizes a running session, clamping requested dimensions', async () => {
    const { service, ptys } = makeService();
    const session = await service.create({ cwd: '/work' });
    expect(service.resize(session.id, 120, -1)).toBe(true);
    expect(ptys[0]?.resizeCalls).toEqual([[120, 1]]);
    expect(service.get(session.id)?.cols).toBe(120);
    expect(service.resize('missing', 10, 10)).toBe(false);
  });

  it('reports resize failure when the pty throws', async () => {
    const { service, ptys } = makeService();
    const session = await service.create({ cwd: '/work' });
    ptys[0]!.resizeShouldThrow = true;
    expect(service.resize(session.id, 10, 10)).toBe(false);
  });

  it('kills a running session with the default signal, which is fire-and-forget until the pty reports exit', async () => {
    const { service, ptys } = makeService();
    const session = await service.create({ cwd: '/work' });
    expect(service.kill(session.id)).toBe(true);
    expect(ptys[0]?.killCalls).toEqual(['SIGTERM']);
    // kill() only sends the signal; the session transitions to 'exited' when
    // the pty's own onExit callback later fires (simulated here), not synchronously.
    expect(service.get(session.id)?.status).toBe('running');
    ptys[0]!.emitExit(0, os.constants.signals.SIGTERM);
    expect(service.get(session.id)?.status).toBe('exited');
    expect(service.kill('missing')).toBe(false);
    expect(service.kill(session.id)).toBe(false);
  });

  it('force-finishes the session when kill throws', async () => {
    const { service, ptys } = makeService();
    const session = await service.create({ cwd: '/work' });
    ptys[0]!.killShouldThrow = true;
    expect(service.kill(session.id, 'SIGKILL')).toBe(false);
    expect(service.get(session.id)?.status).toBe('exited');
    expect(service.get(session.id)?.signal).toBe('SIGKILL');
  });

  it('isTerminal reflects the exited-status set', () => {
    const { service } = makeService();
    expect(service.isTerminal('exited')).toBe(true);
    expect(service.isTerminal('running')).toBe(false);
  });

  it('attach reports not-found for an unknown id', async () => {
    const { service } = makeService();
    const sink = new FakeSink();
    expect(service.attach('missing', 0, sink)).toBe('not-found');
  });
});

describe('@jini-ai/platform — terminal — data flow, buffering, and exit', () => {
  it('flushes small chunks after the frame timer and large chunks immediately', async () => {
    const { service, ptys } = makeService();
    const session = await service.create({ cwd: '/work' });
    const sink = new FakeSink();
    service.attach(session.id, 0, sink);

    ptys[0]!.emitData('hi');
    expect(sink.events).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({ event: 'data', data: { data: 'hi' } });

    ptys[0]!.emitData('this-chunk-is-at-least-ten-bytes');
    expect(sink.events).toHaveLength(2);
    expect(sink.events[1]).toMatchObject({ event: 'data' });
  });

  it('trims the ring buffer once byte/count ceilings are exceeded', async () => {
    const { service, ptys } = makeService();
    const session = await service.create({ cwd: '/work' });
    const sink = new FakeSink();
    service.attach(session.id, 0, sink);

    for (let i = 0; i < 10; i++) {
      ptys[0]!.emitData(`chunk-${i}-padding-to-force-eviction`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));

    // A fresh attach replays only what remains in the trimmed ring buffer.
    const replaySink = new FakeSink();
    service.attach(session.id, 0, replaySink);
    expect(replaySink.events.length).toBeLessThan(10);
  });

  it('emits an exit event, ends and clears attached sinks, and trims to the exit tail', async () => {
    const { service, ptys } = makeService();
    const session = await service.create({ cwd: '/work' });
    const sink = new FakeSink();
    service.attach(session.id, 0, sink);

    for (let i = 0; i < 5; i++) ptys[0]!.emitData(`padding-chunk-${i}`);
    await new Promise((resolve) => setTimeout(resolve, 20));

    ptys[0]!.emitExit(0, os.constants.signals.SIGTERM);

    expect(sink.ended).toBe(true);
    expect(sink.events.at(-1)).toMatchObject({ event: 'exit', data: { code: 0, signal: 'SIGTERM' } });
    expect(service.get(session.id)?.status).toBe('exited');
    expect(service.get(session.id)?.signal).toBe('SIGTERM');

    // Re-attaching after exit at the last-seen id still surfaces the exit event.
    const lastId = sink.events.at(-1)!.id;
    const lateSink = new FakeSink();
    expect(service.attach(session.id, lastId, lateSink)).toBe('ended');
    expect(lateSink.events).toHaveLength(1);
    expect(lateSink.events[0]).toMatchObject({ event: 'exit' });
    expect(lateSink.ended).toBe(true);
  });

  it('reports an unmatched exit signal number generically', async () => {
    const { service, ptys } = makeService();
    const session = await service.create({ cwd: '/work' });
    ptys[0]!.emitExit(1, 999999);
    expect(service.get(session.id)?.signal).toBe('SIG999999');
  });

  it('reports a null signal when the pty exits without one', async () => {
    const { service, ptys } = makeService();
    const session = await service.create({ cwd: '/work' });
    ptys[0]!.emitExit(0);
    expect(service.get(session.id)?.signal).toBeNull();
  });

  it('ignores a redundant second exit report for an already-finished session', async () => {
    const { service, ptys } = makeService();
    const session = await service.create({ cwd: '/work' });
    const sink = new FakeSink();
    service.attach(session.id, 0, sink);

    ptys[0]!.emitExit(0, os.constants.signals.SIGTERM);
    const exitEventsAfterFirst = sink.events.filter((e) => e.event === 'exit').length;
    expect(exitEventsAfterFirst).toBe(1);

    // A second, redundant exit report (e.g. a duplicate node-pty callback)
    // must not re-run finish(): no second 'exit' event, and the recorded
    // exit code/signal from the first report is preserved.
    ptys[0]!.emitExit(1, 999);
    expect(sink.events.filter((e) => e.event === 'exit').length).toBe(1);
    expect(service.get(session.id)?.exitCode).toBe(0);
    expect(service.get(session.id)?.signal).toBe('SIGTERM');
  });

  it('detach removes a sink from a running session, and is a no-op for an unknown session', async () => {
    const { service } = makeService();
    const session = await service.create({ cwd: '/work' });
    const sink = new FakeSink();
    service.attach(session.id, 0, sink);
    expect(() => service.detach(session.id, sink)).not.toThrow();
    expect(() => service.detach('missing', sink)).not.toThrow();
  });

  it('drops an exited session from the registry after the ttl window', async () => {
    const { service, ptys } = makeService();
    const session = await service.create({ cwd: '/work' });
    ptys[0]!.emitExit(0);
    expect(service.get(session.id)).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(service.get(session.id)).toBeNull();
  });
});

describe('@jini-ai/platform — terminal — shutdownActive', () => {
  it('kills every active session and waits out the grace window', async () => {
    const { service, ptys } = makeService();
    await service.create({ cwd: '/work' });
    await service.create({ cwd: '/work' });

    await service.shutdownActive();

    for (const pty of ptys) expect(pty.killCalls).toEqual(['SIGTERM']);
    for (const session of service.list()) expect(session.status).toBe('exited');
  });

  it('is a no-op wait when there are no active sessions', async () => {
    const { service } = makeService();
    await expect(service.shutdownActive()).resolves.toBeUndefined();
  });

  it('skips the wait when graceMs is 0', async () => {
    const { service } = makeService();
    await service.create({ cwd: '/work' });
    await expect(service.shutdownActive({ graceMs: 0 })).resolves.toBeUndefined();
  });

  it('tolerates a pty whose kill() throws during shutdown', async () => {
    const { service, ptys } = makeService();
    await service.create({ cwd: '/work' });
    ptys[0]!.killShouldThrow = true;
    await expect(service.shutdownActive({ graceMs: 0 })).resolves.toBeUndefined();
    expect(service.list()[0]?.status).toBe('exited');
  });
});
