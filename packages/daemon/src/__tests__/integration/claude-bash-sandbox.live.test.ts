import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import type { RunProtocolEvent } from '@jini-ai/protocol';

const COMMAND = 'pwd && echo REPRO_OK';

/** Return an explicit skip reason without starting Claude or loading the daemon. O(PATH entries). */
function skipReason(_input = {}, _options = {}): string | undefined {
  if (process.env.JINI_LIVE_CLI_TESTS !== '1') return 'set JINI_LIVE_CLI_TESTS=1 (spends model tokens)';
  if (process.platform !== 'darwin') return 'requires darwin to exercise the macOS sandbox';
  const found = (process.env.PATH ?? '').split(delimiter).some(dir => {
    try { const path = join(dir, 'claude'); accessSync(path, constants.X_OK); return statSync(path).isFile(); }
    catch { return false; }
  });
  return found ? undefined : 'claude binary is not executable on PATH';
}

/** Load the same production owners from source, or exclusively from another checkout's dist. */
async function loadDaemon(_input = {}, _options = {}) {
  const packagesDir = process.env.JINI_LIVE_PACKAGES_DIR;
  const root = packagesDir
    ? pathToFileURL(resolve(packagesDir, 'daemon/dist') + sep)
    : new URL('../../', import.meta.url);
  const extension = packagesDir ? '.js' : '.ts';
  const load = (name: string) => import(/* @vite-ignore */ new URL(name + extension, root).href);
  console.info(`[claude-bash-live] implementation: ${root.pathname}`);
  return await Promise.all([load('agent-executor'), load('event-log'), load('run-lifecycle')]) as [
    typeof import('../../agent-executor.js'),
    typeof import('../../event-log.js'),
    typeof import('../../run-lifecycle.js'),
  ];
}

/** Inspect only the generated path policy; never log argv, settings hooks, or the environment. */
function sandboxSnapshot({ args, options }: { args: readonly string[]; options: SpawnOptions }, _options = {}) {
  const index = args.indexOf('--settings');
  const settings = index < 0 ? {} : JSON.parse(args[index + 1]!);
  const filesystem = settings.sandbox?.filesystem ?? {};
  return {
    cwd: options.cwd,
    tempDir: options.env?.TMPDIR,
    claudeTempDir: options.env?.CLAUDE_CODE_TMPDIR,
    sandboxEnabled: settings.sandbox?.enabled,
    failIfUnavailable: settings.sandbox?.failIfUnavailable,
    allowUnsandboxedCommands: settings.sandbox?.allowUnsandboxedCommands,
    blockReadsOutsideWorkingDirectories: settings.permissions?.blockReadsOutsideWorkingDirectories,
    filesystem: Object.fromEntries(['allowRead', 'allowWrite', 'denyRead', 'denyWrite']
      .map(key => [key, filesystem[key]])),
  };
}

/** Assert observed tool output and process completion, never an assistant's echoed success text. */
function assertBashSucceeded({ events, stderr }: { events: RunProtocolEvent[]; stderr: string }, _options = {}) {
  const agentEvents = events.flatMap(event => event.kind === 'agent' ? [event.payload] : []);
  const calls = agentEvents.filter(event => event.type === 'tool_use');
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ name: 'Bash', input: { command: COMMAND } });
  expect(calls[0]!.input).not.toMatchObject({ dangerouslyDisableSandbox: true });
  const results = agentEvents.filter(event => event.type === 'tool_result');
  const bashResults = results.filter(result => result.toolUseId === calls[0]!.id);
  expect(bashResults).toHaveLength(1);
  // The incident's tell is a Bash result that ran (REPRO_OK) yet is flagged as an error — print
  // what Claude actually returned so a failure names its cause instead of "expected true".
  if (bashResults[0]!.isError === true) console.error(`[claude-bash-live] bash result: ${bashResults[0]!.content}`);
  expect(bashResults[0]!.content.split(/\r?\n/)).toContain('REPRO_OK');
  expect(bashResults[0]!.isError).not.toBe(true);
  expect(results.map(result => result.content).join('\n') + stderr).not.toMatch(/Operation not permitted/i);
  expect(events.filter(event => event.kind === 'error')).toEqual([]);
  expect(events.find(event => event.kind === 'end')?.payload).toMatchObject({ status: 'succeeded', code: 0 });
}

/** Exit zero alone can conceal a budget/turn-limit result; require the CLI's success receipt too. */
function assertCliSucceeded({ stdout }: { stdout: string }, _options = {}) {
  const records = stdout.split('\n').filter(Boolean).map(line => JSON.parse(line) as {
    type?: string; subtype?: string; is_error?: boolean; result?: string;
  });
  const results = records.filter(record => record.type === 'result');
  expect(results).toHaveLength(1);
  const failure = results[0]?.result ?? '';
  if (results[0]?.is_error) console.error('[claude-bash-live] CLI failure categories:', {
    network: /connection error|could not resolve|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed/i.test(failure),
    authentication: /not logged in|invalid api key|authentication|unauthorized|login required/i.test(failure),
    filesystem: /EACCES|EPERM|read-only file system|operation not permitted|permission denied/i.test(failure),
  });
  // Select only receipt fields so a failure cannot print unrelated CLI data or credentials.
  expect({ subtype: results[0]?.subtype, is_error: results[0]?.is_error })
    .toEqual({ subtype: 'success', is_error: false });
}

const reason = skipReason();
if (reason) console.info(`[claude-bash-live] SKIPPED: ${reason}`);

it.skipIf(Boolean(reason))('runs one real Claude Bash command inside the daemon filesystem sandbox', async () => {
  const [daemon, log, runs] = await loadDaemon();
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'jini-bash-live-')));
  const lifecycle = runs.createRunLifecycle({ eventLog: log.createInMemoryEventLog({}) });
  const { run } = await lifecycle.start({ contextRef: 'claude-bash-live' }, { agentId: 'claude' });
  const events: RunProtocolEvent[] = [];
  const subscription = await lifecycle.stream({ runId: run.id, onEvent: event => events.push(event) });
  let policy: ReturnType<typeof sandboxSnapshot> | undefined;
  let closed: Promise<void> = Promise.resolve();
  let stdout = '';
  let stderr = '';
  const controller = new AbortController();
  // Observe the actual production invocation. Only spend/turn limits are added; settings and
  // temp creation stay with createAgentExecutor. The cast matches its fixed three-argument port.
  const spawnLive = ((command: string, args: readonly string[], options: SpawnOptions) => {
    policy = sandboxSnapshot({ args, options });
    const child: ChildProcess = spawn(command, [...args, '--max-budget-usd', '0.10', '--max-turns', '3'], options);
    closed = new Promise<void>(done => child.once('close', () => done()));
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    return child;
  }) as typeof spawn;
  const executor = daemon.createAgentExecutor({ lifecycle }, { spawn: spawnLive });
  const timeout = setTimeout(() => {
    controller.abort(new Error('Claude live run exceeded 120 seconds'));
    void lifecycle.cancel({ runId: run.id, reason: 'live test timeout' });
  }, 120_000);
  try {
    await executor.run({ runId: run.id, agentId: 'claude', cwd: workspace,
      prompt: `Run exactly one Bash tool call with this exact command: ${COMMAND}\nThen reply done. Do not use any other tools, retry, or disable sandboxing.`,
    }, {
      filesystemRoot: workspace, model: 'haiku', permissionMode: 'bypass',
      nativeToolAccess: true, cliParity: true,
      nativeCapabilities: { shell: true, fileWrite: false, userMcp: false, subagents: false,
        userSettings: false, web: false, workflows: false, loginEnvironment: false },
      settingSources: [], allowedTools: ['Bash'],
    });
    const terminal = await lifecycle.waitForTerminal({ runId: run.id }, { signal: controller.signal });
    expect(policy).toMatchObject({ sandboxEnabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false,
      blockReadsOutsideWorkingDirectories: true });
    assertCliSucceeded({ stdout });
    assertBashSucceeded({ events, stderr });
    expect(terminal.state).toBe('succeeded');
  } catch (error) {
    console.error('[claude-bash-live] effective sandbox policy (paths only):', JSON.stringify(policy ?? { cwd: workspace }));
    throw error;
  } finally {
    clearTimeout(timeout);
    await lifecycle.cancel({ runId: run.id, reason: 'live test cleanup' });
    // Wait for the production cancellation/cleanup path before deleting its workspace.
    await closed;
    if (subscription.kind === 'ok') subscription.unsubscribe();
    await rm(workspace, { recursive: true, force: true });
  }
});
