/** Compile-time proof that the shared agent-runtime binding matches the daemon's port, with no cast. A mismatch in
 * any member (argument object, optional bag, return type, null-ness) is a `tsc` error in this file. */
import { createAgentRuntimeBindings, createNativeAgentRuntime } from '@jini-ai/agent-runtime';
import type { AgentRuntimePort, BaseUrlGuardPort } from '@jini-ai/daemon/ports/agent-runtime';
import { validateBaseUrl } from '@jini-ai/agent-runtime';

export function bindForTypecheck(required: { env: Record<string, string | undefined> }, _optional: Record<string, never> = {}): AgentRuntimePort {
  return createAgentRuntimeBindings({ runtime: createNativeAgentRuntime({ env: required.env }) }) satisfies AgentRuntimePort;
}

export const baseUrlGuard = { validate: (required: { baseUrl: string }) => validateBaseUrl(required) } satisfies BaseUrlGuardPort;
