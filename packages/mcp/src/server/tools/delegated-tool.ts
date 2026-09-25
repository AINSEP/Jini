/**
 * @module @jini-ai/mcp/server/tools/delegated-tool
 *
 * `execute_delegated_tool` and its read-only companion `execute_readonly_delegated_tool` — the
 * MCP-callback half of gap 3's continuation transport (see
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
 *
 * TWO defs, ONE code path. `createDelegatedGateway` builds both; the factories differ only in the
 * name/title/description they present and in whether the request carries `requireReadOnly: true`.
 * The read-only companion exists because MCP annotations are static per tool declaration — a
 * surface that promises "this only reads" can only be a second declaration, never a per-call mode —
 * and it ENFORCES that promise daemon-side rather than asserting it, because a `readOnlyHint: true`
 * tool that could still reach writes would launder a write past its caller's own safety gate. See
 * {@link createExecuteReadonlyDelegatedToolTool} for the failure that motivated it.
 */
import { randomUUID } from 'node:crypto';
import { postDaemonJson } from '../daemon-client.js';
import { daemonCallOptions, requireString, type McpToolDef } from '../tool-protocol.js';

/** Response shape `POST /api/delegated-tool-calls` (`packages/http-kit/src/delegated-tools.ts`) returns. */
interface DelegatedToolExecuteResponse {
  readonly result: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Unwraps a completed delegated call's `{executionId, status, output, ...}` envelope down to just
 * `output` when — and only when — `output` is itself an MCP content envelope (`{content: [...]}`).
 * Every other shape (a non-completed status, a plain JSON `output` like a string or a list, no
 * `output` at all) is returned byte-identical to `result` — this is an additive unwrap, not a new
 * general response shape, so the existing "surfaces the result envelope unchanged" contract for an
 * ordinary tool call is untouched.
 *
 * Why unwrap at all: `../tool-protocol.js`'s `okResult()` only recognizes an already-well-formed
 * content envelope AT THE TOP LEVEL of what a handler returns. Left wrapped inside
 * `{executionId, status, output}`, a genuine `image` block in `output.content` (kept there by
 * `@jini-ai/daemon`'s `delegated-tool-bridge.ts`, which treats `image` as model-safe — see that
 * package's `tool-result-surfaces.ts`) would still get JSON.stringified into inert text by
 * `okResult()`'s fallback path, because the wrapper object itself has no top-level `content` field
 * for it to recognize. Unwrapping here is what lets `okResult()`'s whitelist actually reach the
 * block the bridge already preserved.
 */
function unwrapMcpContentEnvelope(result: unknown): unknown {
  if (!isRecord(result) || result['status'] !== 'completed') return result;
  const output = result['output'];
  if (!isRecord(output) || !Array.isArray(output['content'])) return result;
  return output;
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
 * The half of a gateway def that differs between the two: how it presents itself, and whether it
 * asks the daemon to enforce a read-only constraint. Everything else — schema, timeout resolution,
 * `runId`/`toolUseId` handling, the route it posts to, the response unwrap — is shared below, so
 * the two gateways cannot drift into behaving differently.
 */
interface DelegatedGatewayVariant {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly readOnlyHint: boolean;
  readonly idempotentHint: boolean;
  /** Sent as `requireReadOnly: true`, which is what makes `readOnlyHint: true` a fact rather than a claim. Omitted entirely by the unconstrained gateway. */
  readonly requireReadOnly?: true;
}

/**
 * Builds one gateway def. Both exported factories call this; there is no second copy of the
 * request body, the timeout rule, or the unwrap.
 *
 * @param variant - The presentation/constraint half (see {@link DelegatedGatewayVariant}).
 * @param options - The per-process run scope and its optional overrides.
 * @returns The `McpToolDef` to host.
 * @complexity O(1) at construction; each call is one HTTP round trip.
 */
function createDelegatedGateway(
  variant: DelegatedGatewayVariant,
  options: CreateExecuteDelegatedToolToolOptions,
): McpToolDef {
  const { runId } = options;
  const generateToolUseId = options.generateToolUseId ?? randomUUID;
  const requested = options.delegatedToolTimeoutMs;
  const timeoutMs =
    typeof requested === 'number' && Number.isFinite(requested) && requested > 0
      ? requested
      : DEFAULT_DELEGATED_TOOL_TIMEOUT_MS;

  return {
    name: variant.name,
    description: variant.description,
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
      readOnlyHint: variant.readOnlyHint,
      idempotentHint: variant.idempotentHint,
      destructiveHint: false,
      openWorldHint: false,
      title: variant.title,
    },
    handler: async (args, ctx) => {
      requireString(args.toolId, 'toolId');
      const body: Record<string, unknown> = {
        runId,
        toolUseId: generateToolUseId(),
        toolId: args.toolId,
        input: args.input,
        ...(variant.requireReadOnly === undefined ? {} : { requireReadOnly: variant.requireReadOnly }),
      };
      const data = await postDaemonJson<DelegatedToolExecuteResponse>(ctx.baseUrl, '/api/delegated-tool-calls', body, {
        ...daemonCallOptions(ctx),
        timeoutMs,
      });
      return unwrapMcpContentEnvelope(data.result);
    },
  };
}

/**
 * Builds the `execute_delegated_tool` tool def for one specific `runId`. A fresh MCP server
 * process (one per spawned `claude` run, see `../../bin/serve.js`) calls this once at startup;
 * every `tools/call` for the returned def's `name` during that process's lifetime executes
 * against the same run.
 *
 * Declares `readOnlyHint: false`, which is the truth about a gateway that reaches the entire
 * registry — reads and writes alike. See {@link createExecuteReadonlyDelegatedToolTool} for what
 * that costs under a host that gates on the annotation, and for the companion that answers it.
 */
export function createExecuteDelegatedToolTool(options: CreateExecuteDelegatedToolToolOptions): McpToolDef {
  return createDelegatedGateway(
    {
      name: 'execute_delegated_tool',
      title: 'Execute a Jini-registered tool',
      description:
        'Execute a Jini-registered tool (never an agent-vendor-specific tool name) against the current run, routed through the daemon\'s ToolExecutor deny-by-default gate — the same authorization/confirmation/audit path every other tool-execution mechanism in this host uses. On a completed outcome, returns {result} normally. Any other outcome surfaces as an HTTP error the caller must catch, not a status field in a 200 body: denied/confirmation-denied raise a 403 TOOL_OPERATION_DENIED; timed-out/cancelled/failed raise a 500 INTERNAL_ERROR.',
      readOnlyHint: false,
      idempotentHint: false,
    },
    options,
  );
}

/**
 * Builds the `execute_readonly_delegated_tool` companion for one specific `runId` — the same
 * gateway, narrowed to tools whose registration declares them read-only, and annotated
 * `readOnlyHint: true`.
 *
 * WHY IT EXISTS. `execute_delegated_tool` is the sole route from an externally-injected MCP client
 * into this host's entire native tool catalog, and it correctly annotates itself
 * `readOnlyHint: false`. A runtime that auto-denies any MCP tool lacking `readOnlyHint: true`
 * (headless `codex exec`, observed) therefore kills 100% of delegated calls — reads included —
 * before they leave the client process. Nothing reaches the daemon, so no execution row is written
 * and no error surfaces; the model, given no grounding signal at all, narrates a tool call that
 * never happened. Meanwhile `search_tools`/`describe_tool` work, so discovery succeeds and only
 * execution silently dies, which is the worst possible shape for the failure.
 *
 * WHY IT ENFORCES RATHER THAN ASSERTS. MCP annotations are static per tool declaration — the
 * protocol has no way to vary one per call — so a read-only surface can only be a SECOND
 * declaration, never a mode of the first. And a tool that declared `readOnlyHint: true` while
 * still reaching writes would be worse than the bug it fixes: it would launder a write past a
 * caller's own safety gate, and that caller has no way to audit the claim. The check is therefore
 * made where it can be a fact rather than a claim — the daemon, via
 * `@jini-ai/http-kit`'s `requireReadOnly`, resolving the id against the live `ToolRegistry` and
 * `@jini-ai/core`'s `isReadOnlyTool`. Refusal is deny-by-default: an id that is unregistered, or
 * registered without a read-only classification, is refused with a message naming the tool and
 * pointing at `execute_delegated_tool`.
 *
 * Flipping the existing tool's annotation instead was rejected for the same reason: it would lie to
 * every caller, including the ones the annotation exists to protect.
 */
export function createExecuteReadonlyDelegatedToolTool(options: CreateExecuteDelegatedToolToolOptions): McpToolDef {
  return createDelegatedGateway(
    {
      name: 'execute_readonly_delegated_tool',
      title: 'Execute a read-only Jini-registered tool',
      description:
        'Execute a READ-ONLY Jini-registered tool (never an agent-vendor-specific tool name) against the current run. Identical to execute_delegated_tool — same ToolExecutor deny-by-default authorization/confirmation/audit path, same {result} envelope, same errors — except that the daemon first checks the requested toolId against the live registry and refuses anything not registered as read-only, with a 403 TOOL_OPERATION_DENIED naming the tool. Use this for any tool that only reads. For a tool that creates, updates, deletes, publishes, or mints anything, call execute_delegated_tool instead; this one will refuse it.',
      readOnlyHint: true,
      // A read-only call has no state to advance, so repeating it is the same call. Matches
      // `tool-catalog-tools.ts`'s and `run-tools.ts`'s own read annotations rather than inventing a
      // third convention for the same claim.
      idempotentHint: true,
      requireReadOnly: true,
    },
    options,
  );
}
