/**
 * @file Whether THIS instance may publish content to a live site at all.
 *
 * The live site (the host's runtime mode resolves to `production`, set by the hosting plugin's generated config) is the publish
 * DESTINATION — there is nothing further for it to push to. It still RECEIVES pushes (the import,
 * bundle and blob routes), so only the outbound push routes consult this. `/auth/me` echoes it as
 * `canPublishToLive` so the admin hides every Publish entry point there; the push routes refuse
 * with {@link PUBLISH_FROM_LIVE_SITE_ERROR} in case a stale tab or direct call gets through anyway.
 */

export const PUBLISH_FROM_LIVE_SITE_CODE = "PUBLISH_FROM_LIVE_SITE";

export const PUBLISH_FROM_LIVE_SITE_ERROR =
  "This is the live site, so there is nowhere to publish to. Publish from your local copy of the site instead.";

/** The env override slice the host's runtime-mode resolver reads (structural; the resolver is host policy). */
export interface RuntimeModeEnvOptions {
  /** Defaults to the real process environment when this whole options object is omitted. */
  env?: Record<string, string | undefined>;
}

export interface CanPublishToLiveOptions extends RuntimeModeEnvOptions {
  /** The host's runtime-mode resolver; only its `production` answer marks the live site. */
  readonly resolveRuntimeMode: (options?: RuntimeModeEnvOptions) => string;
}

/**
 * @param options The host's `resolveRuntimeMode` plus the same env override it takes; an omitted
 *   `env` calls the resolver with no options, so it reads the real process environment.
 * @returns `false` only when the runtime mode is `production`.
 * @complexity O(1).
 */
export function canPublishToLive(options: CanPublishToLiveOptions, _optional = {}): boolean {
  const modeOptions = options.env === undefined ? undefined : { env: options.env };
  return options.resolveRuntimeMode(modeOptions) !== "production";
}
