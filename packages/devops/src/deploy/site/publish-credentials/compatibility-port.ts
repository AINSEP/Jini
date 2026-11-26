import type { CredentialSetSummary } from "@jini-ai/core/contracts/credentials";
import type { DeployTargetRegistry } from "@jini-ai/devops/deploy/site/deploy-targets/types";

/** The two optional host values the invalidation has always read. Read at call time, never at bind time. */
export interface PublishCompatibilitySource {
  readonly loadDeployTargets?: (required: { workspaceId: string }, optional?: Record<string, never>) => Promise<DeployTargetRegistry>;
  readonly publishCredentialVerificationCache?: { delete(input: { workspaceId: string; target: string }): void };
}

/**
 * Binds `custom-credentials`' `PublishCompatibilityPort` over the invalidation this feature owns. The return type is inferred, not
 * annotated with that port, so `deployments` takes no import from `custom-credentials`; the host's assignment to
 * `RouteDeps.publishCompatibility` and `extract-s8-c2p1-ports.type-pin.ts` hold the two shapes together. `required.source` is read inside
 * `prepareInvalidation`, never when the port is bound: the composition roots bind from inside the literal that builds the
 * source, which is not readable yet. No `catch`: a rejected registry load propagates to the save, as before.
 * @complexity O(1) to bind; one registry load per credential write when both values are present.
 */
export function bindPublishCompatibility(required: { readonly source: PublishCompatibilitySource;
  invalidatePublishCredentialCompatibility(input: { workspaceId: string; registry: DeployTargetRegistry; cache: NonNullable<PublishCompatibilitySource['publishCredentialVerificationCache']>; after: CredentialSetSummary }): void;
}, _optional: Record<string, never> = {}) {
  return { prepareInvalidation: async ({ workspaceId }: { workspaceId: string }, _optional: Record<string, never> = {}) => {
    const source = required.source;
    const registry = source.loadDeployTargets && source.publishCredentialVerificationCache ? await source.loadDeployTargets({ workspaceId }) : undefined;
    return ({ after }: { after: CredentialSetSummary }) => {
      if (registry && source.publishCredentialVerificationCache) required.invalidatePublishCredentialCompatibility({ workspaceId, registry, cache: source.publishCredentialVerificationCache, after });
    };
  } };
}
