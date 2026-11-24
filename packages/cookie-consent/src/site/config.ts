/** Host-owned site copy/policy linkage; shared by server registration and its admin adapter.
 * Kept free of Node and engine imports: the admin bundle imports this file directly. */
export const SITE_CONSENT_NAMESPACE = 'core.consent';

/** Where the first-visit banner sits; the engine owns the matching CSS. */
export const SITE_CONSENT_PLACEMENTS = ['bottom-bar', 'bottom-left', 'bottom-right', 'top-bar'] as const;
export type SiteConsentPlacement = typeof SITE_CONSENT_PLACEMENTS[number];

/** Which banner the site shows: Jini's, the owner's own (built on window.jiniConsent), or none.
 * Absent in a saved config means "follow `enabled`": on = Jini banner, off = none. */
export const SITE_CONSENT_BANNER_MODES = ['jini', 'headless', 'off'] as const;
export type SiteConsentBannerMode = typeof SITE_CONSENT_BANNER_MODES[number];

export const SITE_CONSENT_REGION_MODES = ['auto', 'opt-in', 'opt-out'] as const;
export type SiteConsentRegionMode = typeof SITE_CONSENT_REGION_MODES[number];

export const SITE_CONSENT_DEFAULTS = {
  // Off by default (owner, 2026-11-02: the banner kept causing problems) until the owner turns it
  // on. Explicit owner on/off choices and published policies still win (settings.ts), so a site
  // that already chose enabled:true keeps its banner.
  enabled: false,
  // A configured trusted header resolves US opt-out; unknown stays strict (Reject shown).
  regionMode: 'auto' as SiteConsentRegionMode,
  policyVersion: '1',
  privacyPolicyUrl: '/privacy',
  secondaryLinkLabel: '',
  secondaryLinkUrl: '',
  title: 'Your cookie choices',
  message: 'We use necessary cookies to run this site. You can choose whether to allow functional, analytics, and marketing cookies.',
  acceptLabel: 'Accept all',
  rejectLabel: 'Reject non-essential',
  preferencesLabel: 'Cookie preferences',
  // A corner card covers far less of the page than a full-width bar (owner, 2026-10-22).
  placement: 'bottom-right' as SiteConsentPlacement,
};
export type SiteConsentSettings = typeof SITE_CONSENT_DEFAULTS & { allowUnsafeEval?: boolean; reopen?: 'link'; bannerMode?: SiteConsentBannerMode };

/** The host's default banner Custom CSS: live whenever the owner's field is empty, and shown in that
 * field so the owner edits it like their own. The engine allows only its banner selectors and a few
 * safe properties (no var(), alpha colors, layout or font sizes under 16px), so this sets shape and
 * spacing only; colors keep following the site theme in light and dark. */
export const SITE_CONSENT_DEFAULT_CSS = `/* Default cookie banner style. Edit it freely; "Reset to default" brings it back. */
#jini-consent {
  padding: 16px;
  border-radius: 14px;
}
#jini-consent button {
  border-radius: 8px;
}
#jini-consent a {
  border-radius: 6px;
}
`;

/** An empty or unset Custom CSS means "use the default"; an owner's own CSS is never replaced.
 * Shared by public delivery, the admin preview and the editor snapshot, so all three show the same
 * banner. @complexity O(css length). */
export function withSiteConsentDefaultCss<T extends object>({ config }: { config: T }, _options = {}): T {
  const { customCss } = config as { customCss?: unknown };
  const empty = customCss === undefined || (typeof customCss === 'string' && customCss.trim() === '');
  return empty ? { ...config, customCss: SITE_CONSENT_DEFAULT_CSS } : config;
}

/** Plain-text fields and their limits; config text is always rendered as text, never HTML. */
export const SITE_CONSENT_TEXT_LIMITS: Readonly<Record<'title' | 'message' | 'acceptLabel' | 'rejectLabel' | 'preferencesLabel' | 'secondaryLinkLabel', number>> = {
  title: 120, message: 600, acceptLabel: 40, rejectLabel: 40, preferencesLabel: 40, secondaryLinkLabel: 60,
};

/** Mirrors the engine's consentPolicyHref so the admin can say why a link is refused before saving:
 * a local path (/privacy) or an https URL without credentials. Empty means "no link".
 * @returns null when acceptable, else a sentence naming the fix. @complexity O(url length). */
export function siteConsentLinkProblem({ url }: { url: string }, _options = {}): string | null {
  if (url === '') return null;
  if (/^\/(?!\/)/.test(url)) return /[\\\x00-\x20]/.test(url) ? 'Remove spaces and backslashes from the link.' : null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return 'Use a page on this site, like /privacy, or an https:// address.';
    return parsed.username || parsed.password ? 'Remove the user name or password from the link.' : null;
  } catch {
    return 'Use a page on this site, like /privacy, or an https:// address.';
  }
}
