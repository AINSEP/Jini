import type { IdentityTransactionPort } from '../core/ports.js';
import type { UUID } from "@jini-ai/core/primitives";
import { IdentityTransactionRequiredError } from '../core/types.js';

/** Guarded writes never silently downgrade to independent asynchronous repository calls. */
export function inIdentityTransaction<T>(required: {
  transactions: IdentityTransactionPort;
  workspaceId: UUID;
  execute: () => Promise<T>;
}): Promise<T> {
  if (!required.transactions) throw new IdentityTransactionRequiredError({});
  return required.transactions.run({ workspaceId: required.workspaceId, execute: required.execute });
}
