/**
 * @module webmcp
 *
 * Projection: {@link CapabilityDef} → a WebMCP tool registration.
 *
 * WebMCP (`document.modelContext.registerTool`) is the browser API by which a *page* offers
 * tools to an agent running inside the browser. It is a W3C Community Group draft, not a
 * standards-track spec, and it moves: the API relocated from `navigator.modelContext` to
 * `document.modelContext` on 2026-07-21, Chrome 150 deprecated the `navigator` location while
 * still serving it during the origin trial (Chrome 149–156), Edge ships it behind a flag, and
 * Firefox and Safari have made no commitment. Feature detection must therefore check `document`
 * first and fall back to `navigator`.
 *
 * That detection is deliberately NOT here: it touches browser globals, and this package holds
 * none. Framework bindings own host access; this file owns only the shape translation, so when
 * the registration shape changes again there is exactly one place to change it.
 *
 * Re-verified 2026-07-28 against the primary spec source
 * (https://webmachinelearning.github.io/webmcp/, `index.bs`). Four real gaps closed this pass,
 * all additive — none change the confirmation gate below, which is Jini's own addition and has
 * no spec counterpart:
 *
 * 1. **`signal`/`exposedTo`** — `ModelContextRegisterToolOptions`, the *second* positional
 *    argument to `registerTool(tool, options)`. `signal` is the spec's ONLY unregistration
 *    mechanism (there is no `unregisterTool()`); aborting it removes the tool and fires
 *    `toolchange`. `exposedTo` scopes which cross-origin documents in the same tree may see the
 *    tool. Neither belongs on the `ModelContextTool` dict itself, so they are not fields of
 *    {@link WebMcpToolRegistration} — they ride along on its optional `registerOptions`, computed
 *    from {@link ToWebMcpToolOptions}, so a caller has exactly one object to destructure:
 *    `modelContext.registerTool(reg, reg.registerOptions)`.
 * 2. **`title`/`annotations`** — real `ModelContextTool` dict fields (`USVString title`,
 *    `ToolAnnotations annotations`), now on {@link WebMcpToolRegistration}. `annotations.readOnlyHint`
 *    defaults from {@link CapabilityDef.risk} (`'read'` → `true`) since Jini's manifests already
 *    carry that judgment; a caller may override or add `untrustedContentHint` via `options.annotations`.
 * 3. **Tool name validation** — the spec's `registerTool` algorithm rejects (with an
 *    `InvalidStateError` `DOMException`) a name that is empty, over 128 code points, or contains
 *    anything outside ASCII alphanumeric plus `_`, `-`, `.`. `capability.id` becomes `name`
 *    verbatim, so a malformed manifest entry previously surfaced as a cryptic browser-side
 *    rejection days later; {@link toWebMcpTool} now checks it at projection time and names the
 *    offending capability.
 * 4. **Schema-on-error** — WebMCP defines no input validation of its own (the spec's
 *    `ToolExecuteCallback` is just `Promise<any> (object input)`), and this module's own doc used
 *    to say so ("the caller is responsible for validating it... WebMCP does not"). That left a
 *    wrong-schema call to fail deep inside whatever `execute` does, with no way for the caller to
 *    self-correct in the same turn. `execute` now runs the manifest's own
 *    {@link findCapabilityInputError} first and, on failure, throws the same
 *    `"<id>: <reason>. Expected input: <schema>"` shape `page-executor.ts` already uses for
 *    `page.*` — one discipline, not two.
 */
import { findCapabilityInputError, type CapabilityDef, type CapabilityInputSchema } from './capability.js';

/** The registration object `registerTool` accepts. WebMCP names the schema field `inputSchema`. */
export interface WebMcpToolRegistration {
  readonly name: string;
  /**
   * `ModelContextTool.title` — an optional human-readable label, distinct from `name` (the
   * machine identifier) and `description` (what an agent reads to decide whether to call it). The
   * spec recommends localizing it to the user's language; this projection makes no attempt at
   * that; a caller wanting a localized title supplies it via `options.title`.
   */
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: CapabilityInputSchema;
  readonly execute: (args: Record<string, unknown>) => Promise<unknown>;
  /** `ModelContextTool.annotations` — behavior hints. See {@link WebMcpToolAnnotations}. */
  readonly annotations?: WebMcpToolAnnotations;
  /**
   * The SECOND positional argument `registerTool(tool, options)` expects — the spec's
   * `ModelContextRegisterToolOptions`, not part of the `ModelContextTool` dict this object
   * otherwise models. Present only when `options.signal` or `options.exposedTo` was supplied.
   * Bundled here rather than returned as a second value so `toWebMcpTool`'s output stays a single
   * object a caller can pass straight through: `modelContext.registerTool(reg, reg.registerOptions)`.
   */
  readonly registerOptions?: WebMcpRegisterToolOptions;
}

/**
 * `ToolAnnotations` — optional behavior hints a host UI or agent may use to decide how to treat a
 * tool without calling it. Both default to `false` in the spec; this projection only ever sets
 * `readOnlyHint` by default (from {@link CapabilityDef.risk}) and leaves `untrustedContentHint`
 * unset unless a caller supplies one, since nothing in {@link CapabilityDef} implies it.
 */
export interface WebMcpToolAnnotations {
  /** True when the tool never mutates state. Defaults from `capability.risk === 'read'`. */
  readonly readOnlyHint?: boolean;
  /** True when the tool's return value may contain content from outside the page's trust boundary. */
  readonly untrustedContentHint?: boolean;
}

/**
 * `ModelContextRegisterToolOptions` — the second positional argument to the real
 * `registerTool(tool, options)`, per the spec IDL:
 * `dictionary ModelContextRegisterToolOptions { AbortSignal signal; sequence<USVString> exposedTo; }`.
 */
export interface WebMcpRegisterToolOptions {
  /**
   * Aborting this unregisters the tool and rejects the in-flight `registerTool()` promise with the
   * signal's abort reason — the spec's ONLY unregistration mechanism. There is no `unregisterTool()`
   * in the current draft; a host that wants to drop a tool later must have registered it with a
   * signal in the first place.
   */
  readonly signal?: AbortSignal;
  /** Origins (besides same-origin, always allowed) that may see and call this tool from other documents in the same tree. */
  readonly exposedTo?: readonly string[];
}

/** What a confirmation handler is asked to approve. */
export interface WebMcpUserInteraction {
  readonly capability: CapabilityDef;
  readonly args: Record<string, unknown>;
}

/**
 * Asks the human to approve one call before it runs. Resolve `true` to proceed, `false` to refuse.
 *
 * **This is Jini's hook, not the browser's.** Earlier WebMCP drafts floated a
 * `requestUserInteraction()` on the page's model-context surface; the current draft
 * (https://webmachinelearning.github.io/webmcp/) does not define one, so there is nothing to
 * feature-detect and nothing standard to call. A host that wants a confirmed WebMCP tool supplies
 * this itself.
 *
 * Independently re-confirmed 2026-07-28: the reference polyfill `@mcp-b/webmcp-polyfill` (the
 * `MCP-B`/`WebMCP-org` community project, not the W3C CG spec) DOES pass a second
 * `client: { requestUserInteraction(callback) }` argument to `execute`, as one of its own
 * non-standard "MCPB extensions". That is further evidence the idea is real and wanted, and
 * further confirmation it is NOT part of the standardized `ToolExecuteCallback` — whose IDL is
 * `Promise<any> (object input)`, one argument. This module's `execute` wrapper below takes one
 * argument for exactly that reason; a second, ignored argument from a polyfill is harmless.
 */
export type RequestUserInteraction = (interaction: WebMcpUserInteraction) => Promise<boolean>;

export interface ToWebMcpToolOptions {
  readonly requestUserInteraction?: RequestUserInteraction;
  /**
   * `ModelContextTool.title`. Meaningful per-capability, so pass this through {@link toWebMcpTool}
   * (one capability) rather than {@link toWebMcpTools} (a whole manifest) — the latter shares one
   * `options` object across every capability in the batch, and a shared title would repeat
   * verbatim across dissimilar tools.
   */
  readonly title?: string;
  /**
   * Overrides or extends the default `annotations` (`{ readOnlyHint: capability.risk === 'read' }`).
   * Fields set here win over the default.
   */
  readonly annotations?: WebMcpToolAnnotations;
  /** See {@link WebMcpRegisterToolOptions.signal}. Safe to share across a whole {@link toWebMcpTools} batch — one `AbortController` per registration session, aborted once on teardown. */
  readonly signal?: AbortSignal;
  /** See {@link WebMcpRegisterToolOptions.exposedTo}. Safe to share across a whole {@link toWebMcpTools} batch when every capability in it gets the same scoping. */
  readonly exposedTo?: readonly string[];
}

/** Thrown in place of executing, when a call needed confirmation and did not get it. */
export class WebMcpConfirmationRequiredError extends Error {
  constructor(readonly capabilityId: string, readonly reason: 'declined' | 'no-handler') {
    super(
      reason === 'declined'
        ? `WebMCP: "${capabilityId}" was declined by the user`
        : `WebMCP: "${capabilityId}" requires confirmation, but no requestUserInteraction handler was supplied`,
    );
    this.name = 'WebMcpConfirmationRequiredError';
  }
}

/**
 * The spec's tool-name rule, verbatim: "The tool definition's name's length must be between 1 and
 * 128, inclusive, and only consist of ASCII alphanumeric code points, U+005F LOW LINE (_), U+002D
 * HYPHEN-MINUS (-), and U+002E FULL STOP (.)." A name outside this is rejected by `registerTool`
 * with an `InvalidStateError` `DOMException` — this projection checks it earlier, at manifest time.
 */
const WEBMCP_TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

/** Whether `name` satisfies the spec's tool-name rule. Exported so a caller can pre-check a manifest without registering anything. */
export function isValidWebMcpToolName(name: string): boolean {
  return WEBMCP_TOOL_NAME_PATTERN.test(name);
}

/**
 * Thrown synchronously by {@link toWebMcpTool} for a capability whose `id` cannot legally become a
 * WebMCP tool name. Distinct from {@link WebMcpConfirmationRequiredError}: this is a manifest
 * defect caught before any registration is attempted, not a runtime refusal of a call.
 */
export class InvalidWebMcpToolNameError extends Error {
  constructor(readonly capabilityId: string) {
    super(
      `WebMCP: capability id "${capabilityId}" is not a valid tool name — the spec requires 1-128 `
      + 'ASCII alphanumeric characters plus "_", "-", "." '
      + '(https://webmachinelearning.github.io/webmcp/#dom-modelcontext-registertool)',
    );
    this.name = 'InvalidWebMcpToolNameError';
  }
}

/**
 * Projects one capability into a WebMCP registration.
 *
 * **The confirmation gate is fail-closed.** A capability with `requiresConfirmation` will not run
 * unless `options.requestUserInteraction` is supplied *and* resolves `true`. Omitting the handler
 * does not silently downgrade to "just run it" — it makes the tool permanently refuse, which is
 * the only safe reading of a manifest that asked for confirmation.
 *
 * This does not make WebMCP governed. It is a page-local gate over a path that still has no run,
 * no principal, no `ToolExecutor` and no audit trail (see this package's `frontend-session-registry`
 * note and §11 of the capability report). It closes the *accidental* case — a destructive
 * capability reaching the page with nothing in front of it — not the authorization gap.
 *
 * @param capability - The capability to expose.
 * @param execute - Runs the capability. Receives the raw argument object, already checked against
 * `capability.inputSchema` — a caller-supplied value that fails validation never reaches this.
 * @param options - Optional confirmation handler, title/annotations, and registration options
 * (`signal`/`exposedTo`); required in practice for any capability declaring `requiresConfirmation`.
 * @returns The registration object to hand to `registerTool`.
 * @throws {@link InvalidWebMcpToolNameError} synchronously, if `capability.id` cannot be a WebMCP
 * tool name.
 * @throws {@link WebMcpConfirmationRequiredError} from `execute`, when confirmation is required
 * and is either declined or unobtainable.
 */
export function toWebMcpTool(
  capability: CapabilityDef,
  execute: (id: string, args: Record<string, unknown>) => Promise<unknown>,
  options: ToWebMcpToolOptions = {},
): WebMcpToolRegistration {
  if (!isValidWebMcpToolName(capability.id)) {
    throw new InvalidWebMcpToolNameError(capability.id);
  }
  const { title, annotations, signal, exposedTo } = options;
  const resolvedAnnotations: WebMcpToolAnnotations = {
    readOnlyHint: capability.risk === 'read',
    ...annotations,
  };
  const registerOptions: WebMcpRegisterToolOptions | undefined =
    signal !== undefined || exposedTo !== undefined
      ? { ...(signal !== undefined ? { signal } : {}), ...(exposedTo !== undefined ? { exposedTo } : {}) }
      : undefined;

  return {
    name: capability.id,
    ...(title !== undefined ? { title } : {}),
    description: capability.description,
    inputSchema: capability.inputSchema,
    execute: async (args) => {
      const input = args ?? {};

      // Schema-on-error, matching page-executor.ts's discipline for page.* — WebMCP defines no
      // input validation of its own, so a wrong-schema call would otherwise reach `execute` (or a
      // confirmation prompt for one) with bad arguments instead of a same-turn correctable error.
      const inputError = findCapabilityInputError(capability, input);
      if (inputError !== null) {
        throw new Error(`${capability.id}: ${inputError}. Expected input: ${JSON.stringify(capability.inputSchema)}`);
      }

      if (capability.requiresConfirmation === true) {
        const { requestUserInteraction } = options;
        if (!requestUserInteraction) {
          throw new WebMcpConfirmationRequiredError(capability.id, 'no-handler');
        }
        const approved = await requestUserInteraction({ capability, args: input });
        if (approved !== true) {
          throw new WebMcpConfirmationRequiredError(capability.id, 'declined');
        }
      }
      return execute(capability.id, input);
    },
    annotations: resolvedAnnotations,
    ...(registerOptions !== undefined ? { registerOptions } : {}),
  };
}

/**
 * Projects a whole manifest.
 *
 * `options` is shared across every capability — safe for `requestUserInteraction`, `signal`, and
 * `exposedTo`, which are naturally uniform for one registration session; do not pass `title`
 * through this one, since it would repeat verbatim across every tool in the manifest (see
 * {@link ToWebMcpToolOptions.title}).
 *
 * @param capabilities - Capabilities to expose, already filtered by whatever policy applies.
 * @param execute - Shared dispatcher, keyed by capability id.
 * @returns One registration per capability, in manifest order.
 * @throws {@link InvalidWebMcpToolNameError} synchronously, for the first capability whose `id`
 * cannot be a WebMCP tool name.
 */
export function toWebMcpTools(
  capabilities: readonly CapabilityDef[],
  execute: (id: string, args: Record<string, unknown>) => Promise<unknown>,
  options: ToWebMcpToolOptions = {},
): readonly WebMcpToolRegistration[] {
  return capabilities.map((capability) => toWebMcpTool(capability, execute, options));
}
