import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

for (const brokenCleanup of [false, true]) {
  test(`caught forbidden fetch still fails after every cleanup; broken cleanup=${brokenCleanup}`, () => {
    const root = mkdtempSync(path.join(tmpdir(), 'jini-network-guard-'));
    const marker = name => path.join(root, name);
    const child = path.join(root, 'guard.test.mjs');
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    try {
      writeFileSync(child, `
        import { after, afterEach, test } from 'node:test';
        import { writeFileSync } from 'node:fs';
        import { installNetworkGuard } from ${JSON.stringify(new URL('./vitest-compat.mjs', import.meta.url).href)};
        import { onTeardown } from ${JSON.stringify(new URL('../../core/src/teardown.ts', import.meta.url).href)};
        installNetworkGuard();
        afterEach(t => writeFileSync(${JSON.stringify(marker('after-each-'))} + t.name, 'yes'));
        after(() => writeFileSync(${JSON.stringify(marker('file-cleanup'))}, 'yes'));
        test('caught forbidden fetch', async t => {
          onTeardown({ t, step: () => writeFileSync(${JSON.stringify(marker('queued-cleanup'))}, 'yes') });
          onTeardown({ t, step: () => { if (${brokenCleanup}) { writeFileSync(${JSON.stringify(marker('broken-cleanup-attempted'))}, 'yes'); throw new Error('cleanup canary'); } } });
          await fetch('https://guard.example.test/forbidden').catch(() => {});
        });
        test('clean following test', () => {});
      `);
      // These assertions inspect TAP; Node's default reporter can be spec instead.
      const run = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap', '--test-timeout=60000', '--test-concurrency=2', child], { env, encoding: 'utf8', timeout: 60_000 });
      assert.ifError(run.error);
      assert.equal(run.status, 1);
      if (brokenCleanup) {
        assert.match(run.stdout + run.stderr, /test teardown failed/);
        assert.equal(existsSync(marker('broken-cleanup-attempted')), true);
      } else assert.match(run.stdout + run.stderr, /no test may reach the real network/);
      for (const name of ['after-each-caught forbidden fetch', 'after-each-clean following test', 'queued-cleanup', 'file-cleanup']) assert.equal(existsSync(marker(name)), true, name);
      assert.match(run.stdout, /ok 2 - clean following test/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
