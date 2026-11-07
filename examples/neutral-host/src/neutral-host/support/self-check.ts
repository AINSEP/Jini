/**
 * Runs the neutral host once, with no test runner: `node self-check.ts`. A packed consumer runs this
 * to prove the folder works outside the repo. It boots the host in a throwaway directory, lists the
 * (empty) installed plugins through the public lifecycle, prints the cost counters and exits non-zero
 * on any failure.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNeutralHost, NEUTRAL_PRODUCT_NAME, scansPerToolCall } from './index.ts';

const root = await mkdtemp(join(tmpdir(), 'neutral-host-'));
try {
  const host = createNeutralHost({ root });
  assert.equal(host.productName, NEUTRAL_PRODUCT_NAME);
  assert.deepEqual(await host.lifecycle.listInstalledPlugins({ workspaceRoot: host.workspaceRoot }), []);
  assert.equal(scansPerToolCall({ counts: host.counters.snapshot() }), 0);
  process.stdout.write(`${JSON.stringify({ productName: host.productName, counters: host.counters.snapshot() })}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
