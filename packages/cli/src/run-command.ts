/**
 * @module run-command
 *
 * `run start` / `run list` / `run get` / `run cancel` / `run watch` — the
 * first concrete commands registered against this package's
 * `CommandRegistry` (`command-registry.ts`'s own docblock notes none existed
 * yet because no HTTP-client-mode pack had landed to call). Built directly
 * against `@jini-ai/http`'s real run transport (`packages/http/src/runs.ts`:
 * `POST /api/runs`, `GET /api/runs`, `GET /api/runs/:runId`,
 * `POST /api/runs/:runId/cancel`, `GET /api/runs/:runId/events` SSE) — a
 * thin HTTP-transport-mode CLI over the kernel's own `Run` noun, with no
 * project/agent/plugin vocabulary anywhere in this file.
 *
 * Every network call goes through this package's already-hardened
 * `postJsonToDaemon`/`getJsonFromDaemon` (bounded timeout, response-size cap,
 * structured-error mapping, redaction) — nothing here re-implements that.
 * `run watch`'s SSE consumption is new (this package's own `source-map.md`
 * calls the mechanics — GET an SSE endpoint, translate frames to one NDJSON
 * line per event on stdout, stop at a terminal `'end'` event — a clean
 * pattern that had no route to call until now).
 */
import { parseFlags, positionalArgs } from './flags.js';
import { exitWithStructuredError, structuredHttpFailure, type ExitCodeTable } from './errors.js';
import { getJsonFromDaemon, postJsonToDaemon } from './http.js';
import { sanitizeUntrustedText, stripControlSequences } from './redact.js';
import { renderUsage } from './usage.js';
import type { CommandRegistry } from './command-registry.js';

export interface RunCommandDeps {
  /** Resolves the daemon HTTP base URL once per command invocation (e.g. wraps `resolveDaemonUrl`). */
  resolveBaseUrl: () => Promise<string> | string;
  /** Defaults to `process.stdout.write`; inject for tests. Used for successful command output. */
  write?: (text: string) => void;
  /** Defaults to `process.stderr.write`; inject for tests. Used for usage/validation errors. */
  writeErr?: (text: string) => void;
  /** Defaults to the global `fetch`; inject for tests. */
  fetchImpl?: typeof fetch;
  /** Defaults to `process.exit`; inject for tests (must not return). */
  exit?: (code: number) => never;
  /** Extra/overriding `code -> exitCode` entries layered on the package default table. */
  exitCodes?: ExitCodeTable;
}

function defaultWrite(text: string): void {
  process.stdout.write(text);
}

function defaultWriteErr(text: string): void {
  process.stderr.write(text);
}

const RUN_START_USAGE = renderUsage({
  usage: ['run start --context-ref <ref> [--agent-id <id>] [--idempotency-key <key>]'],
  description: 'Starts a new run for the given contextRef.',
  options: [
    { flag: '--context-ref', description: 'Opaque caller-supplied identity the run belongs to (required).' },
    { flag: '--agent-id', description: 'Which registered agent should drive this run.' },
    { flag: '--idempotency-key', description: 'Starting twice with the same key returns the original run.' },
  ],
});

const RUN_LIST_USAGE = renderUsage({
  usage: ['run list [--context-ref <ref>]'],
  description: 'Lists runs, optionally scoped to a contextRef.',
  options: [{ flag: '--context-ref', description: 'Only list runs belonging to this contextRef.' }],
});

const RUN_GET_USAGE = renderUsage({
  usage: ['run get <runId>'],
  description: 'Fetches a single run by id.',
});

const RUN_CANCEL_USAGE = renderUsage({
  usage: ['run cancel <runId> [--reason <text>]'],
  description: 'Requests cancellation of an in-progress run. A no-op on an already-terminal run.',
  options: [{ flag: '--reason', description: 'Optional human-readable cancellation reason.' }],
});

const RUN_WATCH_USAGE = renderUsage({
  usage: ['run watch <runId> [--after-cursor <cursor>]'],
  description: 'Streams a run\'s protocol events as one NDJSON line per event on stdout until a terminal event arrives.',
  options: [{ flag: '--after-cursor', description: 'Resume streaming after this event cursor (reconnect support).' }],
});

const RUN_USAGE = renderUsage({
  usage: ['run <start|list|get|cancel|watch> ...'],
  description: 'Manage runs against a Jini daemon over HTTP.',
});

/** Builds `{write, exit, exitCodes?}` for `errors.ts`'s structured-error helpers, never assigning `exitCodes` when unset (required under `exactOptionalPropertyTypes`). */
function errorOptions(deps: RunCommandDeps): { write: (text: string) => void; exit: (code: number) => never; exitCodes?: ExitCodeTable } {
  return {
    write: deps.writeErr ?? defaultWriteErr,
    exit: deps.exit ?? ((code: number) => process.exit(code)),
    ...(deps.exitCodes !== undefined ? { exitCodes: deps.exitCodes } : {}),
  };
}

/** Builds the transport-call options object for `postJsonToDaemon`/`getJsonFromDaemon`, only ever including a key when its value is actually set. */
function transportOptions(deps: RunCommandDeps): {
  fetchImpl?: typeof fetch;
  write?: (text: string) => void;
  exit?: (code: number) => never;
  exitCodes?: ExitCodeTable;
} {
  return {
    ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps.writeErr !== undefined ? { write: deps.writeErr } : {}),
    ...(deps.exit !== undefined ? { exit: deps.exit } : {}),
    ...(deps.exitCodes !== undefined ? { exitCodes: deps.exitCodes } : {}),
  };
}

function missingInput(deps: RunCommandDeps, message: string): never {
  return exitWithStructuredError({ code: 'missing-input', message }, errorOptions(deps));
}

function invalidFlag(deps: RunCommandDeps, message: string): never {
  return exitWithStructuredError({ code: 'invalid-flag', message }, errorOptions(deps));
}

function printJsonResult(deps: RunCommandDeps, value: unknown): void {
  (deps.write ?? defaultWrite)(`${JSON.stringify(value)}\n`);
}

async function resolveBaseUrl(deps: RunCommandDeps): Promise<string> {
  return deps.resolveBaseUrl();
}

/** `run start --context-ref <ref> [--agent-id <id>] [--idempotency-key <key>]` */
export async function runStartCommand(args: readonly string[], deps: RunCommandDeps): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    (deps.write ?? defaultWrite)(`${RUN_START_USAGE}\n`);
    return;
  }
  const flags = parseFlags(args, { string: new Set(['context-ref', 'agent-id', 'idempotency-key']) });
  const contextRef = flags['context-ref'];
  if (typeof contextRef !== 'string' || contextRef.length === 0) {
    missingInput(deps, '--context-ref is required');
  }
  const body: Record<string, unknown> = { contextRef };
  if (typeof flags['agent-id'] === 'string') body.agentId = flags['agent-id'];
  if (typeof flags['idempotency-key'] === 'string') body.idempotencyKey = flags['idempotency-key'];

  const baseUrl = await resolveBaseUrl(deps);
  const result = await postJsonToDaemon(baseUrl, '/api/runs', body, transportOptions(deps));
  printJsonResult(deps, result);
}

/** `run list [--context-ref <ref>]` */
export async function runListCommand(args: readonly string[], deps: RunCommandDeps): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    (deps.write ?? defaultWrite)(`${RUN_LIST_USAGE}\n`);
    return;
  }
  const flags = parseFlags(args, { string: new Set(['context-ref']) });
  const contextRef = flags['context-ref'];
  const route = typeof contextRef === 'string' && contextRef.length > 0
    ? `/api/runs?contextRef=${encodeURIComponent(contextRef)}`
    : '/api/runs';

  const baseUrl = await resolveBaseUrl(deps);
  const result = await getJsonFromDaemon(baseUrl, route, transportOptions(deps));
  printJsonResult(deps, result);
}

/** `run get <runId>` */
export async function runGetCommand(args: readonly string[], deps: RunCommandDeps): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    (deps.write ?? defaultWrite)(`${RUN_GET_USAGE}\n`);
    return;
  }
  const runId = positionalArgs(args)[0];
  if (typeof runId !== 'string' || runId.length === 0) {
    missingInput(deps, 'runId is required: run get <runId>');
  }

  const baseUrl = await resolveBaseUrl(deps);
  const result = await getJsonFromDaemon(baseUrl, `/api/runs/${encodeURIComponent(runId)}`, transportOptions(deps));
  printJsonResult(deps, result);
}

/** `run cancel <runId> [--reason <text>]` */
export async function runCancelCommand(args: readonly string[], deps: RunCommandDeps): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    (deps.write ?? defaultWrite)(`${RUN_CANCEL_USAGE}\n`);
    return;
  }
  const flags = parseFlags(args, { string: new Set(['reason']) });
  const runId = positionalArgs(args, { string: new Set(['reason']) })[0];
  if (typeof runId !== 'string' || runId.length === 0) {
    missingInput(deps, 'runId is required: run cancel <runId>');
  }
  const body: Record<string, unknown> = {};
  if (typeof flags.reason === 'string') body.reason = flags.reason;

  const baseUrl = await resolveBaseUrl(deps);
  const result = await postJsonToDaemon(baseUrl, `/api/runs/${encodeURIComponent(runId)}/cancel`, body, transportOptions(deps));
  printJsonResult(deps, result);
}

/** Cap on total buffered-but-not-yet-frame-terminated SSE bytes — a daemon that never sends a blank-line frame terminator must not grow this without bound (mirrors `http.ts`'s `readJsonWithLimit` byte cap). */
const MAX_SSE_BUFFER_BYTES = 10 * 1024 * 1024;

/** One parsed SSE frame: the `data:` line(s) joined, plus optional `id`/`event` fields. */
interface SseFrame {
  readonly id?: string;
  readonly event?: string;
  readonly data: string;
}

function parseSseFrame(rawFrame: string): SseFrame | null {
  let id: string | undefined;
  let eventName: string | undefined;
  const dataLines: string[] = [];
  for (const line of rawFrame.split('\n')) {
    if (line.startsWith('id: ')) id = line.slice(4);
    else if (line.startsWith('event: ')) eventName = line.slice(7);
    else if (line.startsWith('data: ')) dataLines.push(line.slice(6));
  }
  if (dataLines.length === 0) return null;
  return { ...(id !== undefined ? { id } : {}), ...(eventName !== undefined ? { event: eventName } : {}), data: dataLines.join('\n') };
}

/** Reads `body` as an SSE byte stream and yields one {@link SseFrame} per blank-line-terminated frame. */
async function* readSseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) buffer += decoder.decode(value, { stream: true });
      if (buffer.length > MAX_SSE_BUFFER_BYTES) {
        throw new Error(`SSE stream exceeded the ${MAX_SSE_BUFFER_BYTES}-byte unterminated-frame buffer limit`);
      }
      let sepIndex: number;
      while ((sepIndex = buffer.indexOf('\n\n')) >= 0) {
        const rawFrame = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        const frame = parseSseFrame(rawFrame);
        if (frame !== null) yield frame;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** True when a parsed SSE frame's `data` is the canonical `RunProtocolEvent` terminal `'end'` event. */
function isTerminalEventFrame(frame: SseFrame): boolean {
  try {
    const parsed = JSON.parse(frame.data) as { kind?: unknown };
    return parsed.kind === 'end';
  } catch {
    return false;
  }
}

/**
 * Streams `GET /api/runs/:runId/events` and writes one NDJSON line per event to `deps.write`,
 * stopping once a terminal `'end'` event arrives (or the stream closes on its own). Each frame's
 * `data` is stripped of terminal control sequences before being written — it originates from a
 * prompt-influenced agent run and is not trusted to be safe to print verbatim (same posture as
 * `redact.ts`'s other daemon-sourced-text handling), though it is not truncated or secret-redacted
 * the way a diagnostic error message is, since it is the run's actual event payload, not incidental
 * error detail.
 */
export async function watchRunEvents(baseUrl: string, runId: string, args: readonly string[], deps: RunCommandDeps): Promise<void> {
  const flags = parseFlags(args, { string: new Set(['after-cursor']) });
  const afterCursor = flags['after-cursor'];
  const fetchImpl = deps.fetchImpl ?? fetch;
  const write = deps.write ?? defaultWrite;

  const headers: Record<string, string> = {};
  if (typeof afterCursor === 'string' && afterCursor.length > 0) headers['last-event-id'] = afterCursor;

  const resp = await fetchImpl(`${baseUrl}/api/runs/${encodeURIComponent(runId)}/events`, { headers });
  if (!resp.ok || resp.body === null) {
    return structuredHttpFailure(resp, 'daemon-not-running', errorOptions(deps));
  }
  try {
    for await (const frame of readSseFrames(resp.body)) {
      write(`${stripControlSequences(frame.data)}\n`);
      if (isTerminalEventFrame(frame)) return;
    }
  } catch (error) {
    // A broken/hostile stream (e.g. the unbounded-buffer guard above) must exit through the same
    // structured contract as every other failure here, not surface as an unhandled rejection.
    const message = error instanceof Error ? error.message : String(error);
    return exitWithStructuredError({ code: 'daemon-not-running', message: sanitizeUntrustedText(message) }, errorOptions(deps));
  }
}

/** `run watch <runId> [--after-cursor <cursor>]` */
export async function runWatchCommand(args: readonly string[], deps: RunCommandDeps): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    (deps.write ?? defaultWrite)(`${RUN_WATCH_USAGE}\n`);
    return;
  }
  const runId = positionalArgs(args, { string: new Set(['after-cursor']) })[0];
  if (typeof runId !== 'string' || runId.length === 0) {
    missingInput(deps, 'runId is required: run watch <runId>');
  }
  const baseUrl = await resolveBaseUrl(deps);
  await watchRunEvents(baseUrl, runId, args, deps);
}

/** Registers `run` (dispatching `start`/`list`/`cancel`/`watch` on the first remaining token) against `registry`. */
export function registerRunCommands(registry: CommandRegistry, deps: RunCommandDeps): void {
  registry.add(
    'run',
    async (args) => {
      const [sub, ...rest] = args;
      switch (sub) {
        case 'start':
          return runStartCommand(rest, deps);
        case 'list':
          return runListCommand(rest, deps);
        case 'get':
          return runGetCommand(rest, deps);
        case 'cancel':
          return runCancelCommand(rest, deps);
        case 'watch':
          return runWatchCommand(rest, deps);
        case undefined:
        case '--help':
        case '-h':
          (deps.write ?? defaultWrite)(`${RUN_USAGE}\n`);
          return;
        default:
          invalidFlag(deps, `unknown "run" subcommand: ${sub}`);
      }
    },
    { usage: RUN_USAGE },
  );
}
