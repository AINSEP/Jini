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

// --- Characterization pins (written on the pre-refactor code) ---

test('a final message that already ends in a newline is not given a second one', () => {
  assert.deepEqual(parseCodexRun({ jsonl: event({ type: 'item.completed', item: { type: 'agent_message', text: 'done\n' } }) + '\n' + complete }), { success: true, finalMessage: 'done\n', usage: { input_tokens: 3 } });
});

test('a completed turn without usage reports null usage', () => {
  assert.deepEqual(parseCodexRun({ jsonl: message + '\n' + event({ type: 'turn.completed' }) }), { success: true, finalMessage: 'final\n', usage: null });
});

test('blank and whitespace-only lines are skipped', () => {
  assert.deepEqual(parseCodexRun({ jsonl: '\n   \n' + message + '\n\t\n' + complete + '\n' }), { success: true, finalMessage: 'final\n', usage: { input_tokens: 3 } });
});

test('a later agent message with non-string text clears the earlier final message', () => {
  assert.deepEqual(parseCodexRun({ jsonl: successful + '\n' + event({ type: 'item.completed', item: { type: 'agent_message', text: 5 } }) }), { success: false, reason: 'no agent_message' });
});

test('completed items that are not agent messages, or have a non-object item, are ignored', () => {
  const noise = [event({ type: 'item.completed', item: { type: 'reasoning', text: 'x' } }), event({ type: 'item.completed', item: 'str' }), event({ type: 'item.completed' }), event({ type: 'other' }), event([1])].join('\n');
  assert.deepEqual(parseCodexRun({ jsonl: successful + '\n' + noise }), { success: true, finalMessage: 'final\n', usage: { input_tokens: 3 } });
});

test('missing completion is reported before a missing message', () => {
  assert.deepEqual(parseCodexRun({ jsonl: '' }), { success: false, reason: 'no turn.completed event' });
  assert.deepEqual(parseCodexRun({ jsonl: complete }), { success: false, reason: 'no agent_message' });
});

test('every error event is reported in stream order, with the whole event when no detail field exists', () => {
  const jsonl = [successful, event({ type: 'turn.failed', error: { message: 'crash' } }), event({ type: 'turn.failed' }), event({ type: 'error', message: 'denied' }), event({ type: 'error' })].join('\n');
  assert.deepEqual(parseCodexRun({ jsonl }), { success: false, reason: 'turn.failed: {"message":"crash"}\nturn.failed: {"type":"turn.failed"}\nerror: denied\nerror: {"type":"error"}' });
});

test('an error event without completion still reports the error rather than the missing completion', () => {
  assert.deepEqual(parseCodexRun({ jsonl: event({ type: 'error', message: 'denied' }) }), { success: false, reason: 'error: denied' });
});

test('a supplied decoder replaces JSON parsing and a throwing decode skips only that line', () => {
  const decoded: string[] = [];
  const decoder = { decode: ({ line }: { line: string }) => { decoded.push(line); if (line === 'bad') throw new Error('bad'); return line === 'm' ? { type: 'item.completed', item: { type: 'agent_message', text: 'hi' } } : { type: 'turn.completed', usage: 1 }; } };
  assert.deepEqual(parseCodexRun({ jsonl: 'm\nbad\nc' }, { decoder }), { success: true, finalMessage: 'hi\n', usage: 1 });
  assert.deepEqual(decoded, ['m', 'bad', 'c']);
});

test('option validation names the failing option', () => {
  const cases: [Partial<AgentJobOptions>, string][] = [
    [{ concurrency: 0 }, 'concurrency must be a positive integer'], [{ concurrency: 1.5 }, 'concurrency must be a positive integer'],
    // Malformed-input fixture: the sandbox type only allows the two supported modes.
    [{ sandbox: 'danger-full-access' as AgentJobOptions['sandbox'] }, 'sandbox must be read-only or workspace-write'],
    [{ repository: 'repo' }, 'repository, outputDirectory and addDirs must be absolute paths'], [{ outputDirectory: 'out' }, 'repository, outputDirectory and addDirs must be absolute paths'], [{ addDirs: ['/a', 'b'] }, 'repository, outputDirectory and addDirs must be absolute paths'],
    [{ executable: ' ' }, 'executable is required'], [{ model: '' }, 'model is required'], [{ effort: '\t' }, 'effort is required'], [{ dispatchPrefix: '' }, 'dispatchPrefix is required'],
  ];
  for (const [change, messageText] of cases) assert.throws(() => buildCodexInvocation({ options: { ...options, ...change }, prompt: 'p' }), { message: messageText });
});

test('non-Error runner and artifact failures are stringified into the job reason', async () => {
  const { fs } = memoryFs();
  const runner: AgentCliRunnerPort = { run: async () => { throw 'spawn refused'; } };
  const first = await runAgentJobs({ jobs: [{ id: 'a', prompt: 'p' }], options, fs, runner });
  assert.deepEqual(first.results, [{ id: 'a', status: 'failed', reason: 'runner: spawn refused' }]);
  const failingFs: JobFilesystemPort = { ...memoryFs().fs, write: async ({ path }) => { if (path.endsWith('.failed')) throw 'disk full'; } };
  const second = await runAgentJobs({ jobs: [{ id: 'a', prompt: 'p' }], options, fs: failingFs, runner: { run: async () => ({ exitCode: 1 }) } });
  assert.deepEqual(second.results, [{ id: 'a', status: 'failed', reason: 'artifact: disk full', exitCode: 1 }]);
});
