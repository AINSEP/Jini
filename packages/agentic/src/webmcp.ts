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
 */
import type { CapabilityDef, CapabilityInputSchema } from './capability.js';

/** The registration object `registerTool` accepts. WebMCP names the schema field `inputSchema`. */
export interface WebMcpToolRegistration {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: CapabilityInputSchema;
  readonly execute: (args: Record<string, unknown>) => Promise<unknown>;
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
 */
export type RequestUserInteraction = (interaction: WebMcpUserInteraction) => Promise<boolean>;

export interface ToWebMcpToolOptions {
  readonly requestUserInteraction?: RequestUserInteraction;
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
 * @param execute - Runs the capability. Receives the raw argument object; the caller is
 * responsible for validating it against `capability.inputSchema` — WebMCP does not.
 * @param options - Optional confirmation handler; required in practice for any capability
 * declaring `requiresConfirmation`.
 * @returns The registration object to hand to `registerTool`.
 * @throws {@link WebMcpConfirmationRequiredError} from `execute`, when confirmation is required
 * and is either declined or unobtainable.
 */
export function toWebMcpTool(
  capability: CapabilityDef,
  execute: (id: string, args: Record<string, unknown>) => Promise<unknown>,
  options: ToWebMcpToolOptions = {},
): WebMcpToolRegistration {
  return {
    name: capability.id,
    description: capability.description,
    inputSchema: capability.inputSchema,
    execute: async (args) => {
      const input = args ?? {};
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
  };
}

/**
 * Projects a whole manifest.
 *
 * @param capabilities - Capabilities to expose, already filtered by whatever policy applies.
 * @param execute - Shared dispatcher, keyed by capability id.
 * @returns One registration per capability, in manifest order.
 */
export function toWebMcpTools(
  capabilities: readonly CapabilityDef[],
  execute: (id: string, args: Record<string, unknown>) => Promise<unknown>,
  options: ToWebMcpToolOptions = {},
): readonly WebMcpToolRegistration[] {
  return capabilities.map((capability) => toWebMcpTool(capability, execute, options));
}
