import path from 'node:path';
import type { AgentJob, AgentJobOptions, CodexInvocation, AgentCliRunnerPort, JobFilesystemPort, AgentEventDecoderPort, ParsedCodexRun, AgentJobResult } from './ports.js';

const jsonDecoder: AgentEventDecoderPort = { decode: ({ line }) => JSON.parse(line) };
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

interface CodexStreamState { completed: boolean; lastMessage: string | undefined; usage: unknown; readonly errors: string[] }
type CodexEventHandler = (state: CodexStreamState, event: Record<string, unknown>) => void;
/** Keyed by event type in a Map, so a `type` such as `constructor` never reaches a prototype member. */
const CODEX_EVENT_HANDLERS = new Map<unknown, CodexEventHandler>([
  ['turn.completed', (state, event) => { state.completed = true; state.usage = event.usage ?? null; }],
  ['turn.failed', (state, event) => { state.errors.push(`turn.failed: ${JSON.stringify(event.error ?? event)}`); }],
  ['error', (state, event) => { state.errors.push(`error: ${event.message ?? JSON.stringify(event)}`); }],
  ['item.completed', (state, event) => {
    if (record(event.item) && event.item.type === 'agent_message') state.lastMessage = typeof event.item.text === 'string' ? event.item.text : undefined;
  }],
]);
/** Undecodable and non-object lines carry no signal and are skipped. */
function decodeCodexEvent(required: { line: string; decoder: AgentEventDecoderPort }): Record<string, unknown> | undefined {
  let event: unknown;
  try { event = required.decoder.decode({ line: required.line }); } catch { return undefined; }
  return record(event) ? event : undefined;
}

/** Original stream rule: exit status cannot replace completion, no errors, and a final message. */
export function parseCodexRun({ jsonl }: { jsonl: string }, optional: { decoder?: AgentEventDecoderPort } = {}): ParsedCodexRun {
  const state: CodexStreamState = { completed: false, lastMessage: undefined, usage: null, errors: [] };
  const decoder = optional.decoder ?? jsonDecoder;
  for (const line of jsonl.split('\n')) {
    const event = line.trim() ? decodeCodexEvent({ line, decoder }) : undefined;
    if (event) CODEX_EVENT_HANDLERS.get(event.type)?.(state, event);
  }
  return codexVerdict(state);
}
/** Errors outrank a missing completion, which outranks a missing final message. */
function codexVerdict({ completed, errors, lastMessage, usage }: CodexStreamState): ParsedCodexRun {
  if (completed && errors.length === 0 && lastMessage) return { success: true, finalMessage: lastMessage.endsWith('\n') ? lastMessage : lastMessage + '\n', usage };
  if (errors.length) return { success: false, reason: errors.join('\n') };
  return { success: false, reason: completed ? 'no agent_message' : 'no turn.completed event' };
}

/** Construct argv without a shell; prompt content goes only on stdin. Effort is a TOML string. */
export function buildCodexInvocation({ options, prompt }: { options: AgentJobOptions; prompt: string }): CodexInvocation {
  validateOptions(options);
  return {
    executable: options.executable, cwd: options.repository,
    args: ['exec', '--ignore-rules', '--ignore-user-config', '--ephemeral', '--json', '-s', options.sandbox, '-m', options.model,
      '-c', `model_reasoning_effort=${JSON.stringify(options.effort)}`, ...options.addDirs.flatMap(dir => ['--add-dir', dir]), '-C', options.repository, '-'],
    stdin: options.dispatchPrefix + '\n\n' + prompt,
  };
}

/** Run a bounded batch. The host owns output-directory exclusivity across concurrent batches. */
export async function runAgentJobs(required: {
  jobs: readonly AgentJob[]; options: AgentJobOptions; fs: JobFilesystemPort; runner: AgentCliRunnerPort;
}, optional: { decoder?: AgentEventDecoderPort } = {}): Promise<{ success: boolean; results: AgentJobResult[] }> {
  const { jobs, options, fs, runner } = required;
  validateOptions(options);
  if (jobs.length === 0) throw new Error('No prompt jobs.');
  const ids = new Set<string>();
  for (const job of jobs) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(job.id) || ids.has(job.id)) throw new Error(`Unsafe or duplicate job id: ${job.id}`);
    ids.add(job.id);
  }
  await fs.mkdir({ path: options.outputDirectory });
  const results: AgentJobResult[] = new Array(jobs.length);
  let cursor = 0;
  async function runOne(job: AgentJob): Promise<AgentJobResult> {
    const base = path.join(options.outputDirectory, job.id);
    if (await fs.exists({ path: base + '.md' })) return { id: job.id, status: 'skipped' };
    let exitCode: number | null | undefined;
    let parsed: ParsedCodexRun;
    try {
      // Clear stale logs even when a custom runner fails before opening them.
      await fs.write({ path: base + '.jsonl', text: '' });
      await fs.write({ path: base + '.err', text: '' });
      ({ exitCode } = await runner.run({ ...buildCodexInvocation({ options, prompt: job.prompt }), jsonlPath: base + '.jsonl', stderrPath: base + '.err' }));
      parsed = parseCodexRun({ jsonl: await fs.read({ path: base + '.jsonl' }) }, optional);
    } catch (error) { parsed = { success: false, reason: `runner: ${error instanceof Error ? error.message : String(error)}` }; }
    const exit = exitCode === undefined ? {} : { exitCode };
    // Persistence belongs to this job: an unavailable artifact must not strand the worker pool.
    try {
      if (parsed.success) {
        await fs.write({ path: base + '.md', text: parsed.finalMessage });
        await fs.remove({ path: base + '.failed' });
        return { id: job.id, status: 'succeeded', ...exit };
      }
      await fs.remove({ path: base + '.md' });
      await fs.write({ path: base + '.failed', text: parsed.reason + '\n' });
      return { id: job.id, status: 'failed', reason: parsed.reason, ...exit };
    } catch (error) {
      // The filesystem may also reject a failure marker; retain the failure in the batch result.
      return { id: job.id, status: 'failed', reason: `artifact: ${error instanceof Error ? error.message : String(error)}`, ...exit };
    }
  }
  async function worker(): Promise<void> {
    while (cursor < jobs.length) {
      const index = cursor++;
      results[index] = await runOne(jobs[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency, jobs.length) }, worker));
  return { success: results.every(result => result.status !== 'failed'), results };
}
function validateOptions(options: AgentJobOptions): void {
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) throw new Error('concurrency must be a positive integer');
  if (!['read-only', 'workspace-write'].includes(options.sandbox)) throw new Error('sandbox must be read-only or workspace-write');
  if (!path.isAbsolute(options.repository) || !path.isAbsolute(options.outputDirectory) || options.addDirs.some(dir => !path.isAbsolute(dir))) throw new Error('repository, outputDirectory and addDirs must be absolute paths');
  for (const field of ['executable', 'model', 'effort', 'dispatchPrefix'] as const) if (!options[field].trim()) throw new Error(`${field} is required`);
}
