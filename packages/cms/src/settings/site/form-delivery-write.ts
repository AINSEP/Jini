import type { JsonValue } from "@jini-ai/core/primitives";
import type { FormDeliveryBinding } from "@jini-ai/core/contracts/site/cms-forms";
import { getEffective, type SetValueRequired, type SettingsRepoPort } from "@jini-ai/core/settings";

import { readFormDeliveryBindings } from "./form-delivery.js";
import { set, type SiteSettingsWritePolicies } from "./site-title-write.js";

/**
 * @file The typed write for `core.forms/deliveryBindings` that a later admin or plugin UI calls.
 * Kept apart from `form-delivery.ts` because it writes through the host settings chokepoint
 * (`site-title-write.ts`), which itself imports that file's validator: one file would close an
 * import cycle.
 */

/** A stale bindings snapshot; callers may read again and retry their small merge. */
export class FormDeliveryBindingsConflictError extends Error {}

/**
 * Guards the binding value save inside the chokepoint's existing transaction. The preceding
 * appendRevision holds the ledger write lock until commit, including on Postgres, so another
 * writer cannot commit between this comparison and the value save. A refusal rolls back the
 * appended revision too. Other repo methods keep their original receiver and behavior.
 * @complexity One bindings read and O(s) time/space for s serialized snapshot bytes.
 */
export function guardedBindingsRepo(
  required: { repo: SettingsRepoPort; workspaceId: string; expectedValue: readonly FormDeliveryBinding[] },
  _optional: Record<string, never> = {},
): SettingsRepoPort {
  return new Proxy(required.repo, { get(target, key) {
    if (key === "saveWorkspaceValue") return async (record: Parameters<SettingsRepoPort["saveWorkspaceValue"]>[0]) => {
      const current = await readFormDeliveryBindings({ settingsRepo: target, workspaceId: required.workspaceId, getEffective });
      if (JSON.stringify(current) !== JSON.stringify(required.expectedValue)) throw new FormDeliveryBindingsConflictError();
      await target.saveWorkspaceValue(record);
    };
    const member: unknown = Reflect.get(target, key, target);
    return typeof member === "function" ? member.bind(target) : member;
  } });
}

/**
 * Saves the bindings through the host chokepoint, which validates them and stores the cleaned list
 * (`enforceFormDeliveryBindingsWrite`), so an invalid or secret-carrying list never reaches the ledger.
 * @throws ValueValidationFailedError for any rule `parseFormDeliveryBindings` enforces;
 *   FormDeliveryBindingsConflictError for a stale optional.expectedValue;
 *   authorization and ledger errors from the settings write propagate.
 * @complexity `parseFormDeliveryBindings` plus one settings write; a guarded write adds one
 *   bindings read and O(s) time/space for s serialized snapshot bytes.
 */
export async function writeFormDeliveryBindings(
  required: {
    deps: SetValueRequired["deps"]; workspaceId: string; callerPrincipalId: string; value: unknown;
    /** The host's chokepoint policy, bound once where the host builds its settings writes. */
    writePolicies: SiteSettingsWritePolicies;
  },
  optional: { readonly expectedValue?: readonly FormDeliveryBinding[] } = {},
): Promise<{ value: JsonValue; revisionSeq: number }> {
  const deps = optional.expectedValue === undefined ? required.deps : { ...required.deps,
    repo: guardedBindingsRepo({ repo: required.deps.repo, workspaceId: required.workspaceId, expectedValue: optional.expectedValue }),
  };
  return set({ deps, writePolicies: required.writePolicies, input: {
    namespace: "core.forms", key: "deliveryBindings", scope: "workspace", workspaceId: required.workspaceId,
    callerPrincipalId: required.callerPrincipalId, value: required.value as JsonValue,
  } });
}
