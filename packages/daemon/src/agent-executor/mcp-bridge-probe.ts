import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface } from 'node:readline';
import { redactSecrets } from '@jini-ai/core';
import { buildAgentEnv } from './agent-env.js';
import { errorMessage, isRecord } from './values.js';

export interface McpBridgeProbeResult {
  readonly ok: boolean;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stderrTail: string;
  readonly elapsedMs: number;
}

const STDERR_TAIL_BYTES = 2000;

/** Bounded stderr tail: keeps only the last STDERR_TAIL_BYTES bytes, redacted when read. */
function createStderrTail(): { append: (chunk: Buffer | string) => void; text: () => string } {
  let stderr = Buffer.alloc(0);
  return {
    append: (chunk) => {
      stderr = Buffer.concat([stderr, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]).subarray(-STDERR_TAIL_BYTES);
    },
    text: () => redactSecrets({ input: stderr.toString('utf8') }, {
      extraPatterns: [{ name: 'daemon_token', regex: /JINI_DAEMON_TOKEN\s*=\s*\S+/gi }],
    }).trim(),
  };
}

/** Resolve on the first stdout line that is the initialize (id 1) result. */
function watchInitializeReply(lines: Interface, onReply: () => void): void {
  lines.on('line', (line) => {
    try {
      const reply: unknown = JSON.parse(line);
      if (isRecord(reply) && reply.id === 1 && Object.hasOwn(reply, 'result')) onReply();
    } catch {
      // Startup chatter is not an initialize response; keep waiting for the matching reply.
    }
  });
}

/** Always reap the probe child; cleanup failures never replace the probe's own diagnostic. */
function reapProbe({ timer, lines, child }: {
  readonly timer: ReturnType<typeof setTimeout> | undefined; readonly lines: Interface | undefined; readonly child: ChildProcess | undefined;
}): void {
  clearTimeout(timer);
  lines?.close();
  try {
    child?.kill('SIGKILL');
  } catch {
    // A process already gone or refusing cleanup must not discard the original probe diagnostic.
  }
}

/** Initialize a disposable bridge without a run credential; always reap it after the bounded probe.
 * Spawn/errors/exits/timeouts return diagnostics rather than rejecting. Stderr retains 2000 bytes.
 * @complexity O(n) in received bytes; stderr storage is bounded independently of child output.
 */
export async function probeMcpBridge(
  { entry }: { readonly entry: { readonly command: string; readonly args: readonly string[]; readonly env?: Readonly<Record<string, string>> } },
  { spawn = nodeSpawn, hostEnv = process.env, baseEnv = buildAgentEnv({ hostEnv }), timeoutMs = 15_000, now = Date.now }: {
    readonly spawn?: typeof nodeSpawn;
    readonly hostEnv?: Readonly<Record<string, string | undefined>>;
    readonly baseEnv?: Readonly<Record<string, string>>;
    readonly timeoutMs?: number;
    readonly now?: () => number;
  } = {},
): Promise<McpBridgeProbeResult> {
  const startedAt = now();
  const env: Record<string, string> = { ...baseEnv, ...entry.env, JINI_RUN_ID: 'bridge-probe' };
  // Initialize needs no callback: never delegate a real run's authority to this diagnostic child.
  delete env.JINI_DAEMON_TOKEN;
  let child: ChildProcess | undefined;
  let lines: Interface | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stderr = createStderrTail();
  const result = (ok: boolean, exitCode: number | null = null, signal: string | null = null): McpBridgeProbeResult => ({
    ok, exitCode, signal, stderrTail: stderr.text(), elapsedMs: now() - startedAt,
  });
  let outcome: McpBridgeProbeResult;
  try {
    child = spawn(entry.command, [...entry.args], { env, stdio: 'pipe' });
    const bridge = child;
    lines = bridge.stdout ? createInterface({ input: bridge.stdout, crlfDelay: Infinity }) : undefined;
    const reader = lines;
    outcome = await new Promise<McpBridgeProbeResult>((resolve) => {
      const fail = (error: unknown): void => {
        stderr.append(`\n${errorMessage(error)}`);
        resolve(result(false));
      };
      timer = setTimeout(() => resolve(result(false)), timeoutMs);
      bridge.once('error', fail);
      bridge.once('exit', (code, signal) => resolve(result(false, code, signal)));
      bridge.once('close', (code, signal) => resolve(result(false, code, signal)));
      bridge.stderr?.on('data', stderr.append);
      bridge.stdin?.once('error', fail);
      reader?.once('error', fail);
      if (reader) watchInitializeReply(reader, () => resolve(result(true)));
      bridge.stdin?.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'jini-bridge-probe', version: '0' },
      } })}\n`);
    });
  } catch (error) {
    stderr.append(`\n${errorMessage(error)}`);
    outcome = result(false);
  } finally {
    reapProbe({ timer, lines, child });
  }
  return outcome;
}
