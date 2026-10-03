import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { runAgentJobs } from '../jobs.js';
import { createNodeJobFilesystem } from '../node.js';
import type { AgentCliRunnerPort, AgentJobOptions, JobFilesystemPort } from '../ports.js';

const successful = [
  { type: 'item.completed', item: { type: 'agent_message', text: 'final' } },
  { type: 'turn.completed' },
].map(event => JSON.stringify(event)).join('\n');

function options(root: string): AgentJobOptions {
  return { repository: root, executable: '/bin/unused', model: 'chosen-model', effort: 'medium', sandbox: 'workspace-write', addDirs: [], concurrency: 1, dispatchPrefix: 'dispatch', outputDirectory: root };
}

test('resume accepts regular files and file symlinks, but a report directory still runs its job', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-resume-'));
  try {
    const fs = createNodeJobFilesystem({});
    await writeFile(path.join(root, 'done.md'), '');
    await mkdir(path.join(root, 'directory.md'));
    await symlink(path.join(root, 'done.md'), path.join(root, 'file-link.md'));
    await symlink(path.join(root, 'directory.md'), path.join(root, 'directory-link.md'));
    await symlink(path.join(root, 'missing'), path.join(root, 'dangling.md'));
    assert.equal(await fs.exists({ path: path.join(root, 'done.md') }), true);
    assert.equal(await fs.exists({ path: path.join(root, 'file-link.md') }), true);
    for (const relative of ['directory.md', 'directory-link.md', 'dangling.md', 'missing.md', 'done.md/child']) {
      assert.equal(await fs.exists({ path: path.join(root, relative) }), false, relative);
    }
    const seen: string[] = [];
    const runner: AgentCliRunnerPort = { async run(request) {
      seen.push(path.basename(request.jsonlPath));
      await fs.write({ path: request.jsonlPath, text: successful });
      return { exitCode: 0 };
    } };
    const report = await runAgentJobs({ jobs: ['done', 'file-link', 'directory', 'next'].map(id => ({ id, prompt: id })), options: options(root), fs, runner });
    assert.deepEqual(seen, ['directory.jsonl', 'next.jsonl']);
    assert.deepEqual(report.results.map(result => result.status), ['skipped', 'skipped', 'failed', 'succeeded']);
    assert.equal(report.success, false);
    assert.equal(await readFile(path.join(root, 'next.md'), 'utf8'), 'final\n');
  } finally { await rm(root, { recursive: true, force: true }); }
});

// With one worker, any escaping persistence error strands every later job.
for (const failure of [
  { method: 'write', suffix: '.md', jsonl: successful },
  { method: 'remove', suffix: '.failed', jsonl: successful },
  { method: 'remove', suffix: '.md', jsonl: '' },
  { method: 'write', suffix: '.failed', jsonl: '' },
] as const) {
  test(`artifact ${failure.method} ${failure.suffix} failure stays with its job and the next job completes`, async () => {
    const files = new Map<string, string>();
    const seen: string[] = [];
    const fs: JobFilesystemPort = {
      mkdir: async () => {},
      exists: async ({ path }) => files.has(path),
      read: async ({ path }) => files.get(path)!,
      write: async ({ path, text }) => {
        if (failure.method === 'write' && path === '/out/broken' + failure.suffix) throw new Error('disk unavailable');
        files.set(path, text);
      },
      remove: async ({ path }) => {
        if (failure.method === 'remove' && path === '/out/broken' + failure.suffix) throw new Error('disk unavailable');
        files.delete(path);
      },
    };
    const runner: AgentCliRunnerPort = { async run(request) {
      seen.push(request.jsonlPath);
      files.set(request.jsonlPath, request.jsonlPath === '/out/broken.jsonl' ? failure.jsonl : successful);
      return { exitCode: 17 };
    } };
    const report = await runAgentJobs({ jobs: ['broken', 'next'].map(id => ({ id, prompt: id })), options: options('/out'), fs, runner });
    assert.deepEqual(seen, ['/out/broken.jsonl', '/out/next.jsonl']);
    assert.deepEqual(report, {
      success: false,
      results: [
        { id: 'broken', status: 'failed', reason: 'artifact: disk unavailable', exitCode: 17 },
        { id: 'next', status: 'succeeded', exitCode: 17 },
      ],
    });
    assert.equal(files.get('/out/next.md'), 'final\n');
    assert.equal(files.has('/out/next.failed'), false);
  });
}
