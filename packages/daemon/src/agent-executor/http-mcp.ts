import { randomBytes } from 'node:crypto';
import type { RuntimeAgentDef } from '@jini-ai/agent-runtime';
import type { RunLifecycle } from '../run-lifecycle.js';
import type { McpHttpEndpoint, McpJsonInjectionOptions } from './contracts.js';
import { prepareClaudeHttpMcpConfig } from './claude/mcp-config.js';
import { supportsMessageRelay } from './message-relay.js';

/** Owned transport resources; cleanup is idempotent and also armed on cancellation/termination. */
export interface PreparedHttpMcp {
  readonly endpoint: McpHttpEndpoint;
  readonly mcpJsonPath?: string;
  cleanup(): Promise<void>;
}

/** Close admission on cancellation/terminal transition without waiting for the CLI pipes.
 * The shared close promise also handles explicit pre-spawn cleanup exactly once.
 * @complexity O(1), one cancellable terminal waiter and one cancel subscription per live listener.
 */
function watchEndpoint({ endpoint, lifecycle, runId, cleanupConfig }: {
  endpoint: McpHttpEndpoint; lifecycle: RunLifecycle; runId: string; cleanupConfig?: () => Promise<void>;
}): () => Promise<void> {
  const waiting = new AbortController();
  let closing: Promise<void> | undefined;
  let unsubscribe = () => {};
  const close = () => {
    waiting.abort();
    unsubscribe();
    closing ??= endpoint.close({}).finally(cleanupConfig);
    return closing;
  };
  const closeSafely = () => { void close().catch(() => console.warn('[agent-executor] MCP HTTP cleanup failed')); };
  unsubscribe = lifecycle.onCancelRequested({ runId, listener: closeSafely });
  // onCancelRequested replays a prior cancellation before returning its unsubscribe handle.
  if (closing) unsubscribe();
  void lifecycle.waitForTerminal({ runId }, { signal: waiting.signal }).then(closeSafely, () => {});
  return close;
}

/** Snapshot host-selected metadata once at launch; it is never learned from model arguments. */
function httpLaunchOptions({ def, runId, injection }: {
  def: RuntimeAgentDef; runId: string; injection: McpJsonInjectionOptions;
}): Parameters<NonNullable<McpJsonInjectionOptions['prepareHttp']>>[1] {
  return {
    ...(supportsMessageRelay({ def }) ? { messageRelayNonce: randomBytes(24).toString('hex') } : {}),
    ...(injection.startupToolIds ? { startupToolIds: injection.startupToolIds({ runId }) } : {}),
    ...(injection.diagnosticToolIds ? { diagnosticToolIds: injection.diagnosticToolIds() } : {}),
  };
}

/** Claude's path is staged before argv; other vendors use their existing env/home carriers. */
async function stageHttpConfig({ cwd, def, injection, endpoint, inheritUserMcp }: {
  cwd: string; def: RuntimeAgentDef; injection: McpJsonInjectionOptions;
  endpoint: McpHttpEndpoint; inheritUserMcp: boolean;
}): Promise<{ mcpJsonPath?: string; cleanupConfig?: () => Promise<void> }> {
  if (def.externalMcpInjection !== 'claude-mcp-json') return {};
  const config = await prepareClaudeHttpMcpConfig({ cwd, endpoint }, { inheritUserMcp,
    ...(injection.readFile ? { readFile: injection.readFile } : {}),
  });
  return { mcpJsonPath: config.path, cleanupConfig: config.cleanup };
}

/** Refuse a host-required transport without exposing listener errors or credentials. */
function stdioFallback(injection: McpJsonInjectionOptions | undefined, reason: string): null {
  if (injection?.httpPolicy === 'required') throw new Error(`MCP HTTP is required for this chat, but ${reason}. The assistant could not start its tools; try again or choose an agent supporting HTTP MCP.`);
  return null;
}

/** Prepare HTTP before launch; optional HTTP falls back only before work is dispatched.
 * @returns Null for stdio, otherwise a run-owned endpoint and optional private Claude config.
 * @throws Configuration staging errors after closing the endpoint; never retries dispatched work.
 * @complexity O(config bytes) for Claude; O(1) otherwise, plus the injected host preparation.
 */
export async function prepareHttpMcpForRun({ runId, cwd, def, lifecycle, injection, inheritUserMcp = true }: {
  runId: string; cwd: string; def: RuntimeAgentDef; lifecycle: RunLifecycle;
  injection: McpJsonInjectionOptions | undefined; inheritUserMcp?: boolean;
}, _options = {}): Promise<PreparedHttpMcp | null> {
  if (!injection?.prepareHttp || !def.externalMcpInjection) return stdioFallback(injection, 'HTTP preparation is unavailable');
  if (def.mcpHttp !== true) {
    const fallback = stdioFallback(injection, `${def.name} does not support HTTP MCP`);
    console.warn('[agent-executor] MCP HTTP unsupported for this agent; using stdio');
    return fallback;
  }
  const launchOptions = httpLaunchOptions({ def, runId, injection });
  let endpoint: McpHttpEndpoint;
  try {
    endpoint = await injection.prepareHttp({ runId }, launchOptions);
  } catch {
    const fallback = stdioFallback(injection, 'the HTTP listener could not start');
    console.warn('[agent-executor] MCP HTTP listener unavailable; using stdio');
    return fallback;
  }
  try {
    const config = await stageHttpConfig({ cwd, def, injection, endpoint, inheritUserMcp });
    const cleanup = watchEndpoint({ endpoint, lifecycle, runId, ...config });
    return { endpoint, ...(config.mcpJsonPath ? { mcpJsonPath: config.mcpJsonPath } : {}), cleanup };
  } catch (error) { await endpoint.close({}); throw error; }
}
