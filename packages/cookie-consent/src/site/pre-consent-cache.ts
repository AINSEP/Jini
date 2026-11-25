/**
 * @file G7-8 (owner decision): a public page rendered BEFORE the visitor made a consent choice, and
 * carrying consent-gated tracking scripts, must never be stored by a shared cache.
 *
 * The consent banner delivers consent-gated scripts inside its JSON page config (`CONFIG_ID`,
 * `@jini-ai/cookie-consent` `renderBanner`); the browser client activates them only after the visitor
 * opts in. A CDN copy of that pre-consent document would keep being replayed after the site's
 * tracking set or consent policy changes, so such responses are `private, no-store` instead.
 */
export const CACHE_CONTROL_PRE_CONSENT_TRACKING = "private, no-store";

/**
 * True when the page's consent config lists at least one consent-gated script. A config that does
 * not parse counts as gated: failing toward `no-store` costs a cache hit, failing the other way
 * could publish a tracking page to a shared cache.
 * @complexity O(html length).
 */
export function hasConsentGatedScripts({ html, configId }: { html: string; configId: string }, _optional = {}): boolean {
  const escapedConfigId = configId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<script type="application/json" id="${escapedConfigId}">([\\s\\S]*?)</script>`).exec(html);
  if (!match) return false;
  try {
    const config = JSON.parse(match[1] ?? "") as { scripts?: unknown };
    return Array.isArray(config.scripts) && config.scripts.length > 0;
  } catch {
    return true;
  }
}

/**
 * The `Cache-Control` to send: the route's own directive, tightened to
 * {@link CACHE_CONTROL_PRE_CONSENT_TRACKING} for a pre-consent request (no parsed consent choice yet)
 * whose page carries consent-gated scripts. Never loosens an already-private directive.
 * @complexity O(html length).
 */
export function preConsentCacheControl(
  { html, cacheControl, configId, hasConsentChoice }: { html: string; cacheControl: string; configId: string; hasConsentChoice: (required: Record<string, never>) => boolean },
  _optional = {},
): string {
  if (/\b(private|no-store)\b/.test(cacheControl)) return cacheControl;
  if (hasConsentChoice({})) return cacheControl;
  return hasConsentGatedScripts({ html, configId }) ? CACHE_CONTROL_PRE_CONSENT_TRACKING : cacheControl;
}
