/**
 * @module amr-profile-resolver
 *
 * Port replacing OD's `resolveAmrProfile` import
 * (`apps/daemon/src/integrations/vela.js`) inside `detection.ts`. OD uses
 * this to scope the remembered-live-models cache for the `amr` agent id by
 * "profile" — an AMR/vela-vendor concept (which OpenRouter-compatible
 * account/link config is active) that has no generic runtime meaning.
 *
 * `detection.ts` accepts an `AmrProfileResolver` and calls it only for the
 * `amr` def id; every other agent's scoping is unaffected. The default
 * no-op resolver returns a constant scope (equivalent to "no profile
 * scoping"), so a non-OD consumer's AMR-model cache degrades gracefully —
 * it just doesn't split by profile — until it supplies a real resolver.
 */
export interface AmrProfileResolver {
  /** Return a scope key for the `amr` agent's remembered-live-models cache, derived from the spawn env. */
  resolveProfile(requiredArgs: { env: NodeJS.ProcessEnv }): string;
}

export const noopAmrProfileResolver: AmrProfileResolver = {
  resolveProfile: () => 'default',
};
