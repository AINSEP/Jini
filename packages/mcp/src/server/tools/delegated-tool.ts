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
import { requireString, type McpToolDef } from '../tool-protocol.js';

/** Response shape `POST /api/delegated-tool-calls` (`packages/http/src/delegated-tools.ts`) returns. */
interface DelegatedToolExecuteResponse {
  readonly result: unknown;
}

export interface CreateExecuteDelegatedToolToolOptions {
  /** The one run this MCP server process — and therefore this tool instance — is scoped to. */
  readonly runId: string;
  /** Generates each call's `toolUseId`. @default node:crypto randomUUID */
  readonly generateToolUseId?: () => string;
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
        fetchImpl: ctx.fetchImpl,
      });
      return data.result;
    },
  };
}
