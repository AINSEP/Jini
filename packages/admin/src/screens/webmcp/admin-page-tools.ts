import type { CapabilityDef } from "@jini-ai/core/contracts/capabilities";

/** The WebMCP registration the injected `toWebMcpTool` returns, as far as this adapter reads it
 *  (structural restatement of `@jini-ai/agentic`'s `WebMcpToolRegistration`). */
export interface AdminPageToolRegistration { readonly name: string; readonly registerOptions?: unknown }

/** The page's model context, as far as this adapter uses it (structural restatement of
 *  `@jini-ai/agentic/dom`'s `AgentModelContextLike`). */
export interface AdminPageModelContext {
  registerTool(required: { tool: AdminPageToolRegistration }, options?: unknown): Promise<void> | void;
}

/** What the host injects: `@jini-ai/agentic`'s page-capability catalog, executor, WebMCP projection
 *  and model-context lookup (this package does not depend on `@jini-ai/agentic`), plus the host's
 *  own direct-vs-confirmed action policy, browser-agent preference and registration-error reporter. */
export interface AdminPageToolCollaborators<TDriver> {
  pageCapabilities: readonly CapabilityDef[];
  executePageCapability: (required: { driver: TDriver; capabilityId: string; input: Record<string, unknown> }) => Promise<unknown>;
  toWebMcpTool: (
    required: { capability: CapabilityDef; execute: (required: { id: string; args: Record<string, unknown> }) => Promise<unknown> },
    options?: { signal?: AbortSignal; annotations?: { untrustedContentHint?: boolean } },
  ) => AdminPageToolRegistration & { readonly execute: (args: Record<string, unknown>) => Promise<unknown> };
  getAgentModelContext: (required: { host: { candidates: () => unknown[] } }) => AdminPageModelContext | undefined;
  /** Whether the host's approval policy runs this capability call without chat confirmation. */
  directPageAction: (required: { capabilityId: string; input: Record<string, unknown> }) => boolean;
  /** The default for `isEnabled`: the host's current browser-agent preference. */
  isBrowserAgentEnabled: () => boolean;
  /** The default for `onError`: how the host reports a failed registration. */
  reportRegistrationError: (required: { name: string; error: unknown }) => void;
}

/** The authenticated host adapter owns confirmation and execution of opaque page effects. */
export type RequestAdminPageAction = (required: {
  capabilityId: string; input: Record<string, unknown>; signal: AbortSignal;
}, options?: Record<string, never>) => Promise<unknown>;

/** Thin CMS/admin policy adapter. Jini keeps projection, schema validation and direct page guards.
 * Protected actions use the authenticated ToolExecutor/card exchange; the browser agent never
 * receives a confirmation-answer capability or a local callback that can execute the action.
 * @complexity O(n) registrations for n page capabilities; O(input bytes) per captured call.
 * @overallScore 98
 * @tradeoffs Low: current browser access is rechecked locally; the host cancels the request when
 * the registration lifetime ends, and the server owns authorization and once-only execution. */
export function registerAdminPageWebMcpTools<TDriver>(
  { driver, signal, ...collaborators }: { driver: TDriver; signal: AbortSignal } & AdminPageToolCollaborators<TDriver>,
  {
    modelContext = collaborators.getAgentModelContext({ host: { candidates: () => [
      typeof document === "undefined" ? undefined : (document as unknown as { modelContext?: unknown }).modelContext,
      typeof navigator === "undefined" ? undefined : (navigator as unknown as { modelContext?: unknown }).modelContext,
    ] } }),
    requestPageAction,
    isEnabled = collaborators.isBrowserAgentEnabled,
    onError = collaborators.reportRegistrationError,
  }: {
    modelContext?: AdminPageModelContext | undefined;
    requestPageAction?: RequestAdminPageAction;
    isEnabled?: () => boolean;
    onError?: (required: { name: string; error: unknown }) => void;
  } = {},
): void {
  if (!modelContext || signal.aborted || !isEnabled()) return;
  const assertOpen = () => {
    if (signal.aborted || !isEnabled()) throw new Error("WebMCP admin access is disabled or closed");
  };
  const { pageCapabilities, executePageCapability, toWebMcpTool, directPageAction } = collaborators;
  const register = createToolRegistrationHandler(modelContext, signal, onError);
  for (const definition of pageCapabilities) {
    const registration = toWebMcpTool({
      // Owner 2026-10-07: ordinary edits run directly; opaque clicks require explicit consent.
      // Classification lives in the shared host table used by the daemon and WebMCP.
      capability: { ...definition, requiresConfirmation: false },
      execute: async ({ id, args }) => {
        assertOpen();
        const capturedArgs = structuredClone(args);
        const execute = async () => {
          assertOpen();
          return executePageCapability({ driver, capabilityId: id, input: capturedArgs });
        };
        if (directPageAction({ capabilityId: id, input: capturedArgs })) return execute();
        if (!requestPageAction) throw new Error("This page action requires an authenticated chat confirmation channel");
        const result = await requestPageAction({ capabilityId: id, input: capturedArgs, signal });
        assertOpen();
        return result;
      },
    }, { signal, annotations: { untrustedContentHint: true } });
    // Projection validates before the adapter can open a card. Each protected request captures
    // its input once; human decisions travel only through the server's authenticated callback.
    register(registration);
  }
}

function createToolRegistrationHandler(modelContext: AdminPageModelContext, signal: AbortSignal, onError: (required: { name: string; error: unknown; }) => void) {
  return (registration: AdminPageToolRegistration) => {
    try {
      const pending = modelContext.registerTool({ tool: registration }, registration.registerOptions);
      void Promise.resolve(pending).catch((error: unknown) => {
        if (!signal.aborted) onError({ name: registration.name, error });
      });
    } catch (error) {
      if (!signal.aborted) onError({ name: registration.name, error });
    }
  };
}

