/** @module amr-profile-resolver
 * Profile scoping is an AMR/vela account/link concept, not a generic runtime rule. detection.ts
 * consults this host port only for amr; the default constant scope leaves its cache unsplit.
 */
export interface AmrProfileResolver {
  /** Return a scope key for the `amr` agent's remembered-live-models cache, derived from the spawn env. */
  resolveProfile(requiredArgs: { env: NodeJS.ProcessEnv }): string;
}

export const noopAmrProfileResolver: AmrProfileResolver = {
  resolveProfile: () => 'default',
};
