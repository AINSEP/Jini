import type { Principal } from "@jini-ai/core";
import type { SettingsPrincipalLookupPort } from "../principal-lookup.js";

// REGRESSION: fails if the policy port's method is changed back to ordinary findById.
const ordinaryRepository: { findById(required: { workspaceId: string; id: string }): Promise<Principal | null> } = {
  findById: async () => null,
};
// @ts-expect-error A raw lookup has not promised the host's active-principal policy.
const policyLookup: SettingsPrincipalLookupPort = ordinaryRepository;
void policyLookup;
