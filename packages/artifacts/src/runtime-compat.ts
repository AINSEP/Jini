/**
 * @module artifacts/runtime-compat
 *
 * The runtime-compat injection seam: a hook that gets a chance to rewrite an
 * artifact's body before it's served, for CDN/library-loading quirks a host
 * knows about but the engine can't. Ported from OD's
 * `apps/daemon/src/artifacts/runtime-compat.ts`.
 *
 * De-branded: the origin, `normalizeArtifactRuntimeImports`, is entirely a
 * fix for one specific third-party CDN-bundle bug (the vanilla `dist/
 * motion.js` UMD script tag lacking React hooks, rewritten to `dist/
 * framer-motion.js`) that OD's own system prompt steers models toward
 * hitting. That rewrite rule is product/library-specific knowledge, not a
 * generic engine mechanism — per the task brief ("keep OD's specific logic
 * as adapter"), it is not ported. What *is* generic and kept is the
 * seam itself: a host may need to rewrite an artifact body for any number
 * of environment-specific reasons (a different CDN quirk, a different
 * runtime library entirely) before it reaches a renderer, so the engine
 * defines the hook type and a safe default (identity) rather than hardcode
 * any one library's fix.
 */

/**
 * Rewrites an artifact body before it is served, keyed by the artifact's
 * file name (a host typically gates on file extension, as OD's origin did
 * with `.html`/`.htm`). Returns the body unchanged when no rewrite applies.
 */
export type RuntimeCompatNormalizer = (required: { name: string; body: unknown }) => unknown;

/** Applies no rewrite — returns `body` unchanged. Safe default until a host supplies its own normalizer(s). */
export const noopRuntimeCompatNormalizer: RuntimeCompatNormalizer = ({ body }) => body;

/**
 * Composes several normalizers into one, applying each in order — the
 * output of one becomes the input to the next. Lets a host layer multiple
 * independent CDN/library fixes without each needing to know about the
 * others.
 */
export function composeRuntimeCompatNormalizers(
  { normalizers }: { normalizers: readonly RuntimeCompatNormalizer[] },
): RuntimeCompatNormalizer {
  return ({ name, body }) => normalizers.reduce((current, normalize) => normalize({ name, body: current }), body);
}
