import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { createNodeAgentCliRunner, readPromptJobs } from '../node.js';
test('Node adapter sends stdin and waits for persisted stdout/stderr before resolving', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-jobs-'));
  try {
    const script = path.join(root, 'fake.mjs');
    await writeFile(script, 'let data = ""; for await (const chunk of process.stdin) data += chunk; process.stdout.write(data); process.stderr.write("diagnostic");');
    const runner = createNodeAgentCliRunner({ env: {} });
    const jsonlPath = path.join(root, 'stdout'); const stderrPath = path.join(root, 'stderr');
    assert.deepEqual(await runner.run({ executable: process.execPath, args: [script], cwd: root, stdin: 'dispatch\n\nprompt', jsonlPath, stderrPath }), { exitCode: 0 });
    assert.equal(await readFile(jsonlPath, 'utf8'), 'dispatch\n\nprompt');
    assert.equal(await readFile(stderrPath, 'utf8'), 'diagnostic');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('prompt discovery reads regular files in sorted order and preserves dot-containing shard IDs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-prompts-'));
  try {
    await writeFile(path.join(root, 'b.part.md'), 'second'); await writeFile(path.join(root, 'a.md'), 'first');
    assert.deepEqual(await readPromptJobs({ directory: root }), [{ id: 'a', prompt: 'first' }, { id: 'b.part', prompt: 'second' }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
