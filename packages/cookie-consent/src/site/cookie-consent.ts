/** @file Site consent settings → `@jini-ai/cookie-consent` banner input. The converter runs on read, so
 * every saved revision (old snapshots included) renders without a re-save.
 * Field names are unchanged: title, message, acceptLabel,
 * rejectLabel, preferencesLabel, privacyPolicyUrl, secondaryLink*, placement, appearance and
 * customCss map one to one. No Node, no engine state: preview, live pages and exports share it. */
import { renderBanner, CONSENT_PLACEMENTS, type ConsentPlacement, type RenderBannerConfig, type RenderBannerOptions, type RenderedBanner } from '../render/index.js';
import type { RawContribution } from '../contract.js';
import type { SiteConsentBannerMode } from './config.js';

/** The saved site config fields the converter reads (a superset is fine). */
export interface SiteConsentSource {
  enabled: boolean; regionMode: string; policyVersion: string; privacyPolicyUrl: string;
  title: string; message: string; acceptLabel: string; rejectLabel: string; preferencesLabel: string;
  secondaryLinkLabel?: string; secondaryLinkUrl?: string; placement?: string;
  appearance?: object; customCss?: string; bannerMode?: SiteConsentBannerMode;
}

export interface SiteCookieConsent { banner: RenderBannerConfig; options: Pick<RenderBannerOptions, 'placement' | 'reopen' | 'appearance' | 'customCss'> }

/** The on/off switch still rules: off = no banner. On, the saved mode applies, and an older config
 * without one gets the Jini banner. @complexity O(1). */
export function siteBannerMode({ config }: { config: Pick<SiteConsentSource, 'enabled' | 'bannerMode'> }, _optional = {}): SiteConsentBannerMode {
  return config.enabled ? config.bannerMode ?? 'jini' : 'off';
}

/** One site config → `renderBanner` input. `policy` is the published policy id (owner
 * version + revision), so a new publication asks visitors again. A global opt-out is read as `auto`:
 * EU, UK and unknown visitors always keep Reject. @complexity O(fields). */
export function toSiteCookieConsent({ config, policy }: { config: SiteConsentSource; policy: string }, { plugins }: { plugins?: readonly RawContribution[] } = {}): SiteCookieConsent {
  return {
    banner: {
      mode: siteBannerMode({ config }),
      client: { contract: 1, policy, regionMode: config.regionMode === 'opt-in' ? 'opt-in' : 'auto', ...(plugins?.length ? { plugins } : {}) },
      copy: {
        title: config.title, message: config.message, acceptLabel: config.acceptLabel, rejectLabel: config.rejectLabel,
        preferencesLabel: config.preferencesLabel, privacyPolicyUrl: config.privacyPolicyUrl,
        ...(config.secondaryLinkLabel && config.secondaryLinkUrl ? { secondaryLinkLabel: config.secondaryLinkLabel, secondaryLinkUrl: config.secondaryLinkUrl } : {}),
      },
    },
    options: siteBannerOptions({ config }),
  };
}

/** Placement, reopen and the owner's styling; an unknown placement falls back to the renderer's. @complexity O(1). */
function siteBannerOptions({ config }: { config: SiteConsentSource }, _optional = {}): SiteCookieConsent['options'] {
  const placement = CONSENT_PLACEMENTS.includes(config.placement as ConsentPlacement) ? config.placement as ConsentPlacement : undefined;
  return {
    // The host adds its own footer "Cookie settings" link, so the corner button stays off.
    reopen: 'link',
    ...(placement ? { placement } : {}),
    ...(config.appearance ? { appearance: config.appearance } : {}),
    ...(config.customCss ? { customCss: config.customCss } : {}),
  };
}

/** The scriptless admin preview of one config for a region: the same markup live pages get.
 * @complexity O(copy + CSS length). */
export function renderSiteConsentPreview({ config, policy }: { config: SiteConsentSource; policy: string }, { region = 'opt-in' }: { region?: 'opt-in' | 'opt-out' } = {}): RenderedBanner {
  const { banner, options } = toSiteCookieConsent({ config, policy });
  // "None" still previews the Jini banner, so the owner can see what switching it on would show.
  return renderBanner({ ...banner, mode: banner.mode === 'off' ? 'jini' : banner.mode }, { ...options, preview: { region } });
}
