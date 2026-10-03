import type { FederationMessages } from "./messages.js";
import { ToolInputError, type ToolExecutionContext, type ToolExecutionOptions, type ToolHandler, type ToolRegistration } from "@jini-ai/core";
import { McpAuthFailedError } from "./mcp-protocol.js";
import type {
  FederatedCallConfirmationOutcome,
  FederatedCallConfirmationRequest,
  FederatedCallTarget,
  FederatedMcpConnectionConfig,
  McpSessionPort,
  RemoteToolResult,
} from "./ports.js";
import {
  admitRemoteTools,
  isOperatorDeclaredReadOnly,
  assertNoNativeCollision,
  extractFederatedImageBlocks,
  FEDERATED_ENTITY_TYPE,
  FEDERATED_TOOL_PERMISSION,
  wrapUntrustedResult,
  writeShapedInputNames,
  federatedCallConfirmationForAction,
  type AdmittedFederatedTool,
  type FederatedAdmissionReport,
} from "./trust.js";

/**
 * @file Turns one connected external MCP server into `ToolRegistration`s — the federated
 * counterpart of a domain's `tool-registrations.ts`, and deliberately NOT one of them.
 *
 * The structural point of this file is what it does not do. It does not call
 * `buildDomainRegistrations`, it does not appear in `assistant/tool-registrations.ts`'s
 * `DOMAIN_SLICES`, and it contributes nothing to `DERIVED_RISK_BY_TOOL_ID`. Those three mechanisms
 * are the native tier's guarantees — a reviewed static catalog, an independently-derived risk
 * classification, a build that fails on any entry that is neither wired nor explicitly excused —
 * and a runtime-discovered third-party tool can satisfy none of them. Routing federated tools
 * through them would not extend those guarantees to federated tools; it would only stop them
 * meaning anything for the native ones. So federation gets its own construction path, with its own
 * gates (`trust.ts`), and the two surfaces stay separable by id, by permission, and by audit source.
 *
 * They do converge in exactly one place, and it is unavoidable: the single `ToolRegistry` the
 * daemon's `ToolExecutor` executes against (`agent-daemon-server.ts`). A tool the executor cannot
 * see cannot be called. Convergence there is mechanical, and everything that makes the tiers
 * distinct — namespacing, the operator allowlist, the one-way hint rule, the untrusted-data
 * envelope, the coarse `admin.integrations.manage` gate — is applied on this side of it, before
 * anything is handed over. The audit trail stays separable for free: `tool-executor-audit.ts` wraps
 * the executor, so federated attempts are recorded like any other, distinguishable by their
 * `mcp__` id prefix.
 *
 * Authorization shape, in this file's own terms (the question every domain file answers): the
 * remote has no `authorize` call of its own and never will, so the handler here performs the
 * check itself via the host's `permissionGate` — the same shape as
 * `features/database/tool-registrations.ts`'s read handlers, which gate inline because their domain
 * functions carry no gate to inherit. It is one evaluator, not two.
 * See docs/decisions/DR-003-trusted-federation-composition.md.
 */

/** What `federate` needs from a composition root. A narrow slice of `RouteDeps`, deliberately —
 * federation touches no repo, no clock, no id generator, and asking for the whole bag would imply
 * otherwise. */
/** The host's one permission evaluator. Throws to deny; checked before a remote sees arguments.
 * @complexity Determined by the injected evaluator.
 */
export type FederatedToolPermissionGate = (request: {
  readonly context: ToolExecutionContext;
  readonly permission: string;
  readonly entityType: string;
  readonly entityId: string;
}, optional?: { scope?: string }) => void | Promise<void>;

export interface FederationDeps {
  readonly permissionGate: FederatedToolPermissionGate;
  readonly messages: FederationMessages;
  readonly errorCode: string;
  readonly scope?: string;
  /**
   * A LIVENESS gate, checked before every federated call. Optional; when absent, behaviour is
   * exactly what it was before this existed.
   *
   * ## Why a gate rather than unregistering the tools
   *
   * Nothing in this subtree unregisters anything, and that is structural rather than an omission:
   * `buildToolCatalogQuery` snapshots `registry.list({})` into a ONE-SHOT FTS index at boot, so a tool
   * removed from the registry afterwards would still be discoverable by `search_tools` and
   * `describe_tool` while no longer being executable — strictly worse than leaving it registered.
   * `trust.ts` R5's "frozen at connect" guarantee rests on the same snapshot.
   *
   * So a connection that dies mid-run cannot be taken out of the catalog. What it CAN do is refuse
   * at the call, with an error the model can act on. Without that, the failure surfaces as
   * `mcp-federation: session is closed (<reason>)` — which reads like a transient fault, so the
   * model searches, selects the same tool, fails, and searches again, burning the rest of the run on
   * a server that cannot work until a human re-authorizes it.
   *
   * The gate is checked BEFORE the permission check for one reason: "this server is disconnected"
   * is true regardless of who is asking, and reporting a permission failure to a principal who does
   * have the permission would send them looking in the wrong place.
   *
   * This is ALSO where operator REVOCATION is enforced, not just liveness: a connection deleted,
   * disabled, narrowed (allowlist or write list), or otherwise changed since admission has no way to
   * be un-registered (see this doc's own paragraph above), so every one of those must be caught here
   * instead, on every call, by re-reading the connection's current row.
   * `assistant/external-mcp-oauth.ts`'s `createExternalMcpConnectionGate` is the composition root
   * that does both jobs — the original liveness check plus this revocation re-check
   * (`assistant/external-mcp-revocation.ts`'s `rosterRefusalFor`) — and it is NOT a `ToolPolicy` deny:
   * see that gate's own doc for why a handler-side refusal, not a policy one, is what lets the model
   * see WHY rather than a fixed "denied by policy" string.
   *
   * @param call - The tool's identity as admitted (remote name, declared annotations) plus the
   *   connection's origin, so the gate can tell a preset (no row to compare against) from a roster
   *   connection (re-checked against its current row every call).
   * @throws Whatever the composition root's terminal error is — for OAuth connections,
   * `assistant/external-mcp-oauth.ts`'s `ExternalMcpReauthRequiredError`, whose message tells the
   * model in words not to retry. For a revoked roster connection,
   * `assistant/external-mcp-revocation.ts`'s `ExternalMcpConnectionRevokedError`.
   */
  readonly assertConnectionUsable?: ((required: { connectionId: string; call: FederatedCallTarget }) => void | Promise<void>) | undefined;
  /**
   * Called when a live call throws {@link McpAuthFailedError} — the remote itself rejected our
   * authentication (HTTP 401), discovered mid-session rather than at boot. HTTP 403 is a call-level
   * authorization refusal and does not invalidate credentials. Optional; when absent,
   * the `McpAuthFailedError` propagates unchanged, which is a `McpProtocolError` and reads to a
   * model like any other transient transport fault (see `assertConnectionUsable` above for why that
   * shape invites a retry loop).
   *
   * A composition root that KNOWS what "authorization" means for this connection (an OAuth-backed
   * row, today — `assistant/external-mcp-oauth.ts`) wires this to record the durable state — so
   * `assertConnectionUsable`'s cheap row read catches the NEXT call instead of this module reaching
   * the network again — and to throw the same terminal, non-retryable error that path already uses.
   * Always throws; this module does not decide what replaces the original error.
   */
  readonly onAuthFailed?: ((required: { connectionId: string; error: McpAuthFailedError }) => Promise<never>) | undefined;
  /**
   * G3 (`trust.ts` R3): asks a human to Confirm or Cancel ONE call to a tool that is not marked
   * read-only, before anything reaches the remote. Wired by the composition root to the held-open
   * MCP-UI card (`assistant/external-mcp-call-confirmation.ts`).
   *
   * Optional only so a root with no human in the loop still type-checks: when it is absent, every
   * tool whose confirmation is not `"none"` is refused at the call and nothing is sent — fail closed,
   * never "run it anyway".
   */
  readonly confirmCall?: ((required: { context: ToolExecutionContext & ToolExecutionOptions; request: FederatedCallConfirmationRequest }) => Promise<FederatedCallConfirmationOutcome>) | undefined;
}

export interface FederatedRegistrationResult {
  readonly registrations: ToolRegistration[];
  /** The full accounting of what was admitted and refused, for the caller to log. */
  readonly report: FederatedAdmissionReport;
}

/**
 * Builds the `ToolRegistration`s for one federated connection from its already-listed tool surface.
 *
 * Split from the connect/list I/O on purpose: this function is pure given a session, so every trust
 * rule and every handler behaviour is testable without a transport.
 *
 * @param params.tools - The remote's advertised surface, verbatim and untrusted.
 * @param params.session - The live session, used only to forward `tools/call`.
 * @param params.config - The site owner's connection config — the trusted side of admission.
 * @param params.nativeToolIds - Every id already registered natively, for the R1 collision assertion.
 * @throws {Error} If a federated id would collide with a native one, or the connection id is invalid.
 * @complexity O(t) in the advertised tool count.
 */
export function buildFederatedMcpRegistrations(params: {
  tools: Parameters<typeof admitRemoteTools>[0]["tools"];
  session: McpSessionPort;
  config: FederatedMcpConnectionConfig;
  deps: FederationDeps;
  nativeToolIds: ReadonlySet<string>;
}): FederatedRegistrationResult {
  const { session, config, deps } = params;
  const report = admitRemoteTools({ tools: params.tools, config });

  assertNoNativeCollision({ federatedToolIds: report.admitted.map((tool) => tool.toolId), nativeToolIds: params.nativeToolIds, messages: deps.messages });

  const registrations = report.admitted.map((tool): ToolRegistration => {
    const handler: ToolHandler = async (ctx, options = {}) => {
      // Liveness AND revocation first — see `FederationDeps.assertConnectionUsable` for why this
      // precedes the permission check rather than following it.
      await deps.assertConnectionUsable?.({ connectionId: config.connectionId, call: {
        remoteName: tool.remoteName,
        declaredAnnotations: tool.declaredAnnotations,
        origin: config.origin,
      } });

      // ONE evaluator, run before anything crosses the network — not after, so a denied principal's
      // arguments are never even sent to a third party. `entityId` is the connection, so a
      // deployment can grant per-connection rather than all-or-nothing.
      await deps.permissionGate({
        context: ctx,
        permission: FEDERATED_TOOL_PERMISSION,
        entityType: FEDERATED_ENTITY_TYPE,
        entityId: config.connectionId,
      }, deps.scope === undefined ? {} : { scope: deps.scope });

      // Fixed ONCE, before any card is drawn: the frozen copy the human sees is the same object that
      // is sent, so nothing that happens to `ctx.input` while the card waits can change what runs.
      const args = frozenArguments(ctx.input);
      const declined = await askBeforeCall({ ...ctx, ...options }, deps, config, tool, args);
      if (declined) return declined;

      let result: RemoteToolResult;
      try {
        result = await session.callTool({ name: tool.remoteName, arguments: args }, { signal: ctx.signal });
      } catch (error) {
        // A token valid at boot can die mid-session; nothing here re-probes it proactively (no
        // periodic refresh exists), so this is where that discovery actually happens. Handed to
        // `onAuthFailed` so the SAME durable state and terminal, non-retryable error this file's
        // `assertConnectionUsable` doc already promises apply here too — not just to a connection
        // already known dead at the call's start.
        if (error instanceof McpAuthFailedError && deps.onAuthFailed) await deps.onAuthFailed({ connectionId: config.connectionId, error: error });
        throw error;
      }

      // R7's media carve-out (trust.ts): image blocks are pulled out of `result.content` BEFORE the
      // untrusted-data envelope is built, so they reach the model through the daemon's typed
      // `media` channel (`extractResultMedia`) intact — see `extractFederatedImageBlocks`'s own doc
      // for why stringifying them into the byte-capped text boundary instead would corrupt them.
      const { images, remainder } = extractFederatedImageBlocks({
        content: result.content,
        maxResultBytes: config.maxResultBytes,
      });

      // R7. Every federated result reaches the model inside an untrusted-data boundary, including
      // the remote's own `isError` claim — which is reported as data rather than acted on, because
      // a remote lying about its own success is not a case this side can adjudicate.
      return {
        federated: { connectionId: config.connectionId, tool: tool.remoteName, remoteReportedError: result.isError === true },
        untrusted: wrapUntrustedResult({
          connectionLabel: config.label,
          remoteName: tool.remoteName,
          result: { content: remainder, structuredContent: result.structuredContent },
          maxResultBytes: config.maxResultBytes,
        }),
        // The ONLY field `@jini-ai/daemon`'s `extractResultMedia` reads to hoist inline media onto
        // the `tool_result` wire event — see `demo-image-tool.ts` for the identical shape proven
        // end to end through the chat pane. Omitted (not an empty array) when there is nothing to
        // hoist, so a text-only result's return shape is byte-identical to before this existed.
        ...(images.length > 0 ? { content: images } : {}),
      };
    };

    return {
      descriptor: {
        id: tool.toolId,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(isOperatorDeclaredReadOnly({ remoteName: tool.remoteName, annotations: tool.declaredAnnotations, readList: config.readOnlyRemoteNames }) ? { readOnly: true } : {}),
      },
      // Pass-through, matching `buildDomainRegistrations`'s identical choice and for the identical
      // §2 reason: the handler above IS this tool's one gate, and a `ToolPolicy` check would. See docs/decisions/DR-003-trusted-federation-composition.md.
      // be a second evaluator of the same rule.
      policy: { authorize: () => "allow" },
      handler,
    };
  });

  return { registrations, report };
}

/**
 * Connects nothing and lists nothing itself — takes a session, drains its tool list, and returns
 * registrations. The one place `listTools` is called, so `trust.ts` R5's "frozen at connect" is a
 * property of the code rather than a convention: there is no other path that could re-list.
 *
 * @throws {Error} If `listTools` rejects — a connection that cannot enumerate is not usable, and
 * `bootstrap.ts` is where that is turned into "carry on without federation".
 * @complexity O(t) in the advertised tool count.
 */
export async function federateSession(params: {
  session: McpSessionPort;
  config: FederatedMcpConnectionConfig;
  deps: FederationDeps;
  nativeToolIds: ReadonlySet<string>;
}): Promise<FederatedRegistrationResult> {
  const tools = await params.session.listTools();
  return buildFederatedMcpRegistrations({ ...params, tools });
}

/**
 * G3: the per-call human gate for protected actions (`trust.ts` R3): permanent deletion, delivery
 * to people, and changes to assistant privacy/instructions/access. Write-shaped input names
 * (`WRITE_SHAPED_INPUT_WORDS`) describe required cards without independently requiring one. Returns
 * `null` when the call may proceed — an ordinary action, or an explicit Confirm — and otherwise the
 * model-facing result that replaces the call. One card per call: the card is opened here, inside the
 * call it guards, and closes when answered, so one Confirm authorizes exactly one call.
 *
 * @throws {ToolInputError} `${errorCode}_NO_CONFIRMATION_CHANNEL` when the root wired no confirmer —
 *   nothing is sent.
 * @complexity O(1) plus the wait for the human.
 */
async function askBeforeCall(
  ctx: ToolExecutionContext & ToolExecutionOptions,
  deps: FederationDeps,
  config: FederatedMcpConnectionConfig,
  tool: AdmittedFederatedTool,
  args: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown> | null> {
  const confirmation = federatedCallConfirmationForAction({ remoteName: tool.remoteName, annotations: tool.declaredAnnotations, args: args });
  if (confirmation === "none") return null;
  const writeShapedInputs = [...new Set([...tool.writeShapedInputs, ...writeShapedInputNames({ args: args })])].sort();
  if (!deps.confirmCall) {
    throw new ToolInputError(
      { message: `${deps.errorCode}_NO_CONFIRMATION_CHANNEL: ${tool.toolId}: this protected action requires confirmation, ` +
        "and nothing here can ask a person. Nothing was sent." },
    );
  }
  const outcome = await deps.confirmCall({ context: ctx, request: {
    toolId: tool.toolId,
    remoteName: tool.remoteName,
    connectionId: config.connectionId,
    connectionLabel: config.label,
    arguments: args,
    destructive: confirmation === "confirm-destructive",
    declaredAnnotations: tool.declaredAnnotations,
    origin: config.origin,
    description: tool.description,
    inputSchema: tool.inputSchema,
    writeShapedInputs,
  } });
  if (outcome.confirmed) return null;
  return { federated: { connectionId: config.connectionId, tool: tool.remoteName }, ran: false, ...outcome.result };
}

/** {@link normalizeArguments}, then a deep, frozen copy — the one object both shown and sent (G3). */
function frozenArguments(input: unknown): Readonly<Record<string, unknown>> {
  return deepFreeze(structuredClone(normalizeArguments(input)));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Narrows `ToolExecutionContext.input` to the `arguments` object a `tools/call` carries.
 *
 * Undefined and `{}` both become `{}` — MCP servers routinely publish parameterless tools, and the
 * kit's own `requireNoInput` establishes that "omit it or pass `{}`" is this codebase's convention
 * for one. Anything else is refused rather than coerced: forwarding an array or a string as
 * `arguments` would produce a remote-side error the model cannot act on, and silently dropping it
 * would teach the model its argument was accepted.
 */
function normalizeArguments(input: unknown): Record<string, unknown> {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error("input must be an object — federated MCP tools take a JSON object of arguments, or omit input entirely");
  }
  return input as Record<string, unknown>;
}
