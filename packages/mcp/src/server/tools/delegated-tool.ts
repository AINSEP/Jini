/**
 * @module @jini-ai/mcp/server/tools/delegated-tool
 *
 * `execute_delegated_tool` — the MCP-callback half of gap 3's continuation transport (see
 * `packages/daemon/source-map.md`'s "run/chat orchestration gap 3, part 1" addition and this
 * package's own dated section in `source-map.md` for the rest of the spike). The swarm-consensus
 * Final Recommendation asked for exactly this: "inject the already-shipped MCP host into one
 * MCP-capable CLI's launch config, prove a tool round-trip through the existing
 * `delegated-tool-bridge.ts`." Where `../tools/run-tools.js`'s tools proxy generic
 * run-lifecycle HTTP endpoints, this tool proxies the new `POST /api/delegated-tool-calls`
 * daemon route (`packages/http/src/delegated-tools.ts`), which is the one and only thing that
 * calls into `createDelegatedToolBridge` (`packages/daemon/src/delegated-tool-bridge.ts`) — the
 * same `ToolExecutor` deny-by-default gate every other tool-execution path in this codebase
 * already uses. No parallel authorization mechanism is introduced anywhere on this path.
 *
 * Unlike every other tool this package ships (`run-tools.ts`'s five tools, plain static
 * objects), this one is a **factory**. The MCP server subprocess a `claude` run spawns via
 * `.mcp.json` (see `../../bin/serve.js`) is scoped to exactly one `runId` for its entire
 * lifetime — the daemon injected that run id into the subprocess's own environment at spawn
 * time, before the model ever said a word. `runId` is therefore closed over at construction
 * time, not accepted as a per-call tool argument: a model has no legitimate way to pick, or
 * need to know, which run it is currently inside, and letting it supply one would open a
 * confused-deputy path (one run's MCP subprocess executing a tool call "as" a different run).
 * `toolUseId` is likewise generated per call (`randomUUID` by default), not model-supplied — a
 * model has no legitimate reason to choose its own correlation id either.
 */
import { randomUUID } from 'node:crypto';
import { postDaemonJson } from '../daemon-client.js';
import { daemonCallOptions, requireString, type McpToolDef } from '../tool-protocol.js';

/** Response shape `POST /api/delegated-tool-calls` (`packages/http-kit/src/delegated-tools.ts`) returns. */
interface DelegatedToolExecuteResponse {
  readonly result: unknown;
}

/**
 * Request deadline for one delegated tool call, overriding `daemon-client.ts`'s 15 s default.
 *
 * That default is sized for "a slow tool call" — a tool doing work. It is the wrong shape for this
 * route, which is the one path in the system where a registered handler may legitimately be waiting
 * on a *person*: a tool that raises an MCP-UI surface parks until the human answers it, and a human
 * reading a dialog does not answer in fifteen seconds. Left at the default, every human-in-the-loop
 * tool call fails at 15 s regardless of what the human eventually clicks.
 *
 * Six minutes is a *backstop*, not a budget. It assumes the host runs a tighter total-lifetime
 * ceiling on the exchange itself, which ends the call with an explicit "no answer" outcome first;
 * the extra headroom here just guarantees the exchange is always what gives up. Six minutes also
 * stays inside every measured agent-CLI ceiling (Claude Code 30 min idle, Gemini CLI 10 min),
 * which is what keeps this hop from becoming the binding constraint.
 *
 * A host whose exchange ceiling differs should override it via `delegatedToolTimeoutMs` rather
 * than have its number encoded here — the engine has no way to know a given host's exchange
 * policy, and hard-coding one host's value in generic engine source is what this default replaced.
 *
 * This is also, transitively, the hard cap on a multi-turn human conversation driven from one tool
 * call: however many turns an exchange takes, they all happen inside this one request. Raising that
 * ceiling starts here, not in the exchange store.
 *
 * The cost is real and accepted: a genuinely hung daemon now hangs this call for six minutes rather
 * than fifteen seconds. The daemon-side alternative does not exist to lean on — `ToolDescriptor.timeoutMs`
 * is unset on every registration today, so `ToolExecutor` arms no timer of its own.
 */
export const DEFAULT_DELEGATED_TOOL_TIMEOUT_MS = 6 * 60 * 1000;

export interface CreateExecuteDelegatedToolToolOptions {
  /** The one run this MCP server process — and therefore this tool instance — is scoped to. */
  readonly runId: string;
  /** Generates each call's `toolUseId`. @default node:crypto randomUUID */
  readonly generateToolUseId?: () => string;
  /**
   * Request deadline for one delegated tool call, in milliseconds. Set this to match the host's
   * own exchange total-lifetime ceiling plus headroom, so the exchange — not this request — is
   * what ends a call the human never answers.
   *
   * Must be a finite number greater than zero; anything else falls back to the default rather
   * than arming a nonsensical (or immediately-firing) timer.
   *
   * @default DEFAULT_DELEGATED_TOOL_TIMEOUT_MS (6 min)
   */
  readonly delegatedToolTimeoutMs?: number;
}

/**
 * Builds the `execute_delegated_tool` tool def for one specific `runId`. A fresh MCP server
 * process (one per spawned `claude` run, see `../../bin/serve.js`) calls this once at startup;
 * every `tools/call` for the returned def's `name` during that process's lifetime executes
 * against the same run.
 */
export function createExecuteDelegatedToolTool(options: CreateExecuteDelegatedToolToolOptions): McpToolDef {
  const { runId } = options;
  const generateToolUseId = options.generateToolUseId ?? randomUUID;
  const requested = options.delegatedToolTimeoutMs;
  const timeoutMs =
    typeof requested === 'number' && Number.isFinite(requested) && requested > 0
      ? requested
      : DEFAULT_DELEGATED_TOOL_TIMEOUT_MS;

  return {
    name: 'execute_delegated_tool',
    description:
      'Execute a Jini-registered tool (never an agent-vendor-specific tool name) against the current run, routed through the daemon\'s ToolExecutor deny-by-default gate — the same authorization/confirmation/audit path every other tool-execution mechanism in this host uses. Returns {result}, a ToolExecutionResult: {status, output?, truncated?, error?} where status is one of completed|denied|confirmation-denied|timed-out|cancelled|failed.',
    inputSchema: {
      type: 'object',
      properties: {
        toolId: {
          type: 'string',
          description: 'Jini registry tool id to invoke. Required.',
        },
        input: {
          // `type` is load-bearing, not decoration. Declared without one, an MCP client has no
          // signal that this property carries structured data, and at least one real client
          // (Claude Code, observed 2026-07-26) then delivers the model's object as a raw JSON
          // *string* — which every Jini tool rejects, because a tool's input is a record or
          // absent (`@jini-ai/daemon`'s `toCapabilityInput` refuses a string by name rather than
          // coercing it). The effect was that only no-input tools were callable at all.
          //
          // Object-only is narrower than "arbitrary JSON" and deliberately so: it is exactly
          // what every registered tool accepts today, it matches MCP's own convention that tool
          // arguments are objects, and widening it later (a union type, say) is additive.
          type: 'object',
          additionalProperties: true,
          description: 'JSON object of input fields for the tool. Optional; omit for a tool that takes no input. Must be an object, not a JSON-encoded string.',
        },
      },
      required: ['toolId'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      destructiveHint: false,
      openWorldHint: false,
      title: 'Execute a Jini-registered tool',
    },
    handler: async (args, ctx) => {
      requireString(args.toolId, 'toolId');
      const body: Record<string, unknown> = {
        runId,
        toolUseId: generateToolUseId(),
        toolId: args.toolId,
        input: args.input,
      };
      const data = await postDaemonJson<DelegatedToolExecuteResponse>(ctx.baseUrl, '/api/delegated-tool-calls', body, {
        ...daemonCallOptions(ctx),
        timeoutMs,
      });
      return data.result;
    },
  };
}
