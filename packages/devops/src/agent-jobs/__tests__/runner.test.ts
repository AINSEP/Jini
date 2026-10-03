import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parseCodexRun, buildCodexInvocation, runAgentJobs } from '../jobs.js';
import type { JobFilesystemPort, AgentCliRunnerPort, AgentJobOptions } from '../ports.js';
const event = (value: unknown) => JSON.stringify(value);
const message = event({ type: 'item.completed', item: { type: 'agent_message', text: 'final' } });
const complete = event({ type: 'turn.completed', usage: { input_tokens: 3 } });
const successful = message + '\n' + complete;
const options: AgentJobOptions = { repository: '/repo', executable: '/bin/codex', model: 'chosen-model', effort: 'chosen-effort', sandbox: 'workspace-write', addDirs: ['/extra'], concurrency: 2, dispatchPrefix: 'dispatch', outputDirectory: '/out' };
function memoryFs() {
  const files = new Map<string, string>();
  const fs: JobFilesystemPort = {
    exists: async ({ path }) => files.has(path),
    read: async ({ path }) => { if (!files.has(path)) throw new Error('missing'); return files.get(path)!; },
    write: async ({ path, text }) => { files.set(path, text); },
    remove: async ({ path }) => { files.delete(path); },
    mkdir: async () => {},
  };
  return { files, fs };
}
test('success requires all three stream signals and retains the last final message and usage', () => {
  const result = parseCodexRun({ jsonl: event({ type: 'item.completed', item: { type: 'agent_message', text: 'earlier' } }) + '\n' + successful });
  assert.deepEqual(result, { success: true, finalMessage: 'final\n', usage: { input_tokens: 3 } });
  for (const jsonl of ['', message, complete, complete + '\n' + event({ type: 'item.completed', item: { type: 'agent_message', text: '' } })]) assert.equal(parseCodexRun({ jsonl }).success, false);
});
test('error and failed events override completed and a final message; malformed lines do not fabricate success', () => {
  for (const failure of [{ type: 'error', message: 'denied' }, { type: 'turn.failed', error: { message: 'crash' } }]) {
    const result = parseCodexRun({ jsonl: successful + '\n' + event(failure) });
    assert.ok(!result.success, 'error events must reject an otherwise completed run');
    assert.match(result.reason, /denied|crash/);
  }
  assert.deepEqual(parseCodexRun({ jsonl: 'bad json\nnull\n' + successful }), { success: true, finalMessage: 'final\n', usage: { input_tokens: 3 } });
});
test('model, effort, sandbox, cwd and extra directories are argv; dispatch and prompt are stdin', () => {
  assert.deepEqual(buildCodexInvocation({ options, prompt: 'private prompt' }), {
    executable: '/bin/codex', cwd: '/repo', args: ['exec', '--ignore-rules', '--ignore-user-config', '--ephemeral', '--json', '-s', 'workspace-write', '-m', 'chosen-model', '-c', 'model_reasoning_effort="chosen-effort"', '--add-dir', '/extra', '-C', '/repo', '-'], stdin: 'dispatch\n\nprivate prompt',
  });
});
test('bounded workers retain raw logs, skip final results and preserve original exit-independent success rule', async () => {
  const { fs, files } = memoryFs(); files.set('/out/done.md', 'earlier\n');
  let active = 0; let peak = 0; const seen: string[] = [];
  let release!: () => void;
  const firstPairStarted = new Promise<void>(resolve => { release = resolve; });
  const runner: AgentCliRunnerPort = { async run(request) {
    active++; peak = Math.max(peak, active); seen.push(request.stdin);
    if (seen.length === 2) release();
    await firstPairStarted;
    files.set(request.jsonlPath, successful); files.set(request.stderrPath, 'diagnostic'); active--;
    return { exitCode: 17 };
  } };
  const report = await runAgentJobs({ jobs: [{ id: 'done', prompt: 'skip' }, ...['one', 'two', 'three'].map(id => ({ id, prompt: id }))], options, fs, runner });
  assert.equal(peak, 2); assert.equal(seen.length, 3);
  assert.deepEqual(report.results.map(x => x.status), ['skipped', 'succeeded', 'succeeded', 'succeeded']);
  assert.equal(report.success, true); assert.equal(files.get('/out/one.md'), 'final\n'); assert.equal(files.get('/out/one.err'), 'diagnostic');
});
test('zero exit with partial stream fails; one spawn error does not stop remaining jobs', async () => {
  const { fs, files } = memoryFs();
  const runner: AgentCliRunnerPort = { async run(request) {
    if (request.stdin.endsWith('throw')) throw new Error('spawn unavailable');
    files.set(request.jsonlPath, request.stdin.endsWith('partial') ? message : successful);
    files.set(request.stderrPath, ''); return { exitCode: 0 };
  } };
  const report = await runAgentJobs({ jobs: ['throw', 'partial', 'okay'].map(id => ({ id, prompt: id })), options, fs, runner });
  assert.equal(report.success, false);
  assert.deepEqual(report.results.map(x => x.status), ['failed', 'failed', 'succeeded']);
  assert.equal(files.has('/out/partial.md'), false); assert.equal(files.get('/out/partial.failed'), 'no turn.completed event\n');
  assert.equal(files.get('/out/throw.failed'), 'runner: spawn unavailable\n');
});
test('rerun clears failed marker on success and rejects duplicate/unsafe IDs before any writes', async () => {
  const { fs, files } = memoryFs(); files.set('/out/one.failed', 'old');
  const runner: AgentCliRunnerPort = { async run(request) { files.set(request.jsonlPath, successful); return { exitCode: 0 }; } };
  await runAgentJobs({ jobs: [{ id: 'one', prompt: 'one' }], options, fs, runner });
  assert.equal(files.has('/out/one.failed'), false);
  const before = [...files];
  for (const jobs of [[], [{ id: '../escape', prompt: '' }], [{ id: 'one', prompt: '' }, { id: 'one', prompt: '' }]]) await assert.rejects(runAgentJobs({ jobs, options, fs, runner }));
  for (const concurrency of [0, -1, 1.5, Infinity]) await assert.rejects(runAgentJobs({ jobs: [{ id: 'x', prompt: '' }], options: { ...options, concurrency }, fs, runner }));
  assert.deepEqual([...files], before);
});
