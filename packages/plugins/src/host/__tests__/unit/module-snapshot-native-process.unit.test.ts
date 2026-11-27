/** The lifecycle's default process probe (no injected `process`): boot reaping asks the real OS
 * whether a snapshot's owner PID is alive. A PID the OS reports as gone (ESRCH) is reaped; this
 * process's own PID is alive, so its stale-looking snapshot is retained. */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, utimes } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createPluginModuleSnapshotLifecycle } from '../../node/module-snapshot.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

/** A PID above Linux's 2^22 ceiling can never be allocated, so `kill(pid, 0)` reports ESRCH. */
const DEAD_PID = 4194304 + 17;

test('default process probe: a dead owner PID is reaped, a live one is kept', async () => {
  const runtimeRoot = await mkdtemp(path.join(tmpdir(), 'snap-native-'));
  roots.push(runtimeRoot);
  const prefix = `load-${createHash('sha256').update(hostname()).digest('hex').slice(0, 16)}-`;
  const dead = `${prefix}${DEAD_PID}-abc`;
  const live = `${prefix}${process.pid}-def`;
  for (const name of [dead, live]) {
    const dir = path.join(runtimeRoot, name);
    await mkdir(dir);
    // Older than this process's start, so only liveness decides.
    await utimes(dir, new Date('2001-01-01T00:00:00Z'), new Date('2001-01-01T00:00:00Z'));
  }
  const owner = createPluginModuleSnapshotLifecycle({ runtimeRoot });
  await owner.ready;
  expect((await readdir(runtimeRoot)).sort()).toEqual([live]);
  await owner.dispose({}, {});
});
