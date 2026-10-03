import { defaultFederationMessages } from "../messages.js";
import type { FederatedToolPermissionGate } from "../registrations.js";
export const messages = defaultFederationMessages;
export const clientInfo = { name: "example-assistant", version: "0.1.0" };
export class TestPermissionDeniedError extends Error {}
/** Converts this suite's recording evaluator into the injected host permission gate. */
export function testPermissionGate({ authorize, scope }: {
  authorize: (request: Record<string, unknown>) => Promise<{ allowed: boolean; reason: string }>;
  scope: string;
}): FederatedToolPermissionGate {
  return async ({ context, permission, entityType, entityId }, optional) => {
    if (optional?.scope !== scope) throw new Error("scope was not forwarded");
    const result = await authorize({ principalId: context.principal.id, permission, scope, entityType, entityId });
    if (!result.allowed) throw new TestPermissionDeniedError(result.reason);
  };
}
