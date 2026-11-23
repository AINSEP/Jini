import { PAGE_CAPABILITIES } from '../page-capabilities.js';
import { executePageCapability } from '../page-executor.js';
import type { PageDriver } from '../page-driver.js';
import { toWebMcpTool, type WebMcpToolRegistration } from '../webmcp.js';
import { getAgentModelContext, type AgentModelContextLike } from './model-context.js';

/** The authenticated host adapter owns confirmation and execution of opaque page effects. */
export type RequestAdminPageAction = (required: {
  capabilityId: string; input: Record<string, unknown>; signal: AbortSignal;
}, options?: Record<string, never>) => Promise<unknown>;

/** Host approval table: true when a page capability call runs directly without a chat card. */
export type DirectPageAction = (required: { capabilityId: string; input: Record<string, unknown> }, options?: Record<string, never>) => boolean;

/** Required host collaborators for {@link registerAdminPageWebMcpTools}. */
export interface AdminPageWebMcpToolsArgs {
  driver: PageDriver;
  signal: AbortSignal;
  /** Host action-approval classification (reviewed direct handles vs. opaque effects). */
  directPageAction: DirectPageAction;
  /** Current browser-agent access preference; rechecked before and after every call. */
  isEnabled: () => boolean;
  /** Host reporting for a native registration failure while the lifetime is still open. */
  onError: (required: { name: string; error: unknown }) => void;
}

/** Thin CMS/admin policy adapter. Jini keeps projection, schema validation and direct page guards.
 * Protected actions use the authenticated ToolExecutor/card exchange; the browser agent never
 * receives a confirmation-answer capability or a local callback that can execute the action.
 * @complexity O(n) registrations for n page capabilities; O(input bytes) per captured call.
 * @overallScore 98
 * @tradeoffs Low: current browser access is rechecked locally; the host cancels the request when
 * the registration lifetime ends, and the server owns authorization and once-only execution. */
export function registerAdminPageWebMcpTools(
  { driver, signal, directPageAction, isEnabled, onError }: AdminPageWebMcpToolsArgs,
  {
    modelContext = getAgentModelContext({ host: { candidates: () => [
      typeof document === 'undefined' ? undefined : (document as unknown as { modelContext?: unknown }).modelContext,
      typeof navigator === 'undefined' ? undefined : (navigator as unknown as { modelContext?: unknown }).modelContext,
    ] } }),
    requestPageAction,
  }: {
    modelContext?: AgentModelContextLike;
    requestPageAction?: RequestAdminPageAction;
  } = {},
): void {
  if (!modelContext || signal.aborted || !isEnabled()) return;
  const assertOpen = () => {
    if (signal.aborted || !isEnabled()) throw new Error('WebMCP admin access is disabled or closed');
  };
  const register = createToolRegistrationHandler(modelContext, signal, onError);
  for (const definition of PAGE_CAPABILITIES) {
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
        if (!requestPageAction) throw new Error('This page action requires an authenticated chat confirmation channel');
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

function createToolRegistrationHandler(modelContext: AgentModelContextLike, signal: AbortSignal, onError: (required: { name: string; error: unknown; }) => void) {
  return (registration: WebMcpToolRegistration) => {
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
