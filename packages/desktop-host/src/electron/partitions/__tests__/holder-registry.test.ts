import { describe, expect, it } from 'vitest';
import { createHolderRegistry, readHoldersStrict } from '../holder-registry.js';
import { FakeClock, FakeScheduler, MemoryFs } from './fakes.js';

const interlockDir = '/profile/partition-interlock';
const directory = `${interlockDir}/holders`;

function fixture() {
  const fs = new MemoryFs(), clock = new FakeClock(), scheduler = new FakeScheduler(clock);
  const process = { pid: 31, bootId: 'boot-3', hostname: 'test-host', isAlive: () => true, newToken: () => 'abc' };
  const registry = createHolderRegistry({ interlockDir, fs, process, clock });
  const read = () => readHoldersStrict({ interlockDir, fs, process, scheduler });
  return { fs, clock, registry, read };
}

describe('holder presence', () => {
  it('withdraws its own record on unregister without removing a sibling', async () => {
    const { fs, registry, read } = fixture();
    registry.register();
    const sibling = { v: 1, pid: 42, token: 'def', bootId: 'boot-3', hostname: 'test-host', profile: interlockDir,
      startedAt: 1700000000000, seq: 2, intents: ['site-b'], held: ['site-a'] };
    fs.writeFileSync({ path: `${directory}/42-def.json`, data: JSON.stringify(sibling) });
    expect(await read()).toMatchObject({ state: 'ok', value: [{ pid: 31 }, { pid: 42 }] });

    registry.unregister();
    expect(registry.registered).toBe(false);
    expect(await fs.readdir({ path: directory })).toEqual(['42-def.json']);
    expect(await read()).toEqual({ state: 'ok', value: [sibling] });
    registry.unregister();
    expect(await read()).toEqual({ state: 'ok', value: [sibling] });
  });

  it('drops a record that disappears between listing and reading without treating it as unreadable', async () => {
    const { fs, clock, registry, read } = fixture();
    registry.register();
    const file = `${directory}/31-abc.json`;
    fs.gate = async (op, target) => {
      if (op === 'read' && target === file) registry.unregister();
    };
    expect(await read()).toEqual({ state: 'ok', value: [] });
    expect(clock.mono()).toBe(0);
  });

  it('retries an unreadable holder once and does not report the profile as empty', async () => {
    const { fs, clock, registry, read } = fixture();
    registry.register();
    fs.failRead.add(`${directory}/31-abc.json`);
    expect(await read()).toEqual({ state: 'unknown', reason: 'holder 31-abc.json unreadable (EACCES)' });
    expect(clock.mono()).toBe(20);
  });

  it('distinguishes no holders directory from a directory that cannot be listed', async () => {
    const { fs, registry, read } = fixture();
    expect(await read()).toEqual({ state: 'ok', value: [] });
    registry.register();
    fs.failReaddir.add(directory);
    expect(await read()).toEqual({ state: 'unknown', reason: 'holders directory unreadable (EACCES)' });
  });
});
