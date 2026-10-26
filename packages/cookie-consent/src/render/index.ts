/** @file Universal render entry: the pure-string banner, its base CSS and the owner-CSS compiler. */
export { renderBanner, resolveCopy, safeHref, DEFAULT_COPY, CONSENT_PLACEMENTS } from './banner.js';
export type { BannerCopy, BannerCopyInput, ConsentPlacement, RenderBannerConfig, RenderBannerOptions, RenderedBanner } from './banner.js';
export { compileConsentCss, scopedSelector, parityCss, CONSENT_CSS_SCOPE, CONSENT_MAX_CSS_LENGTH } from './css.js';
export type { ConsentAppearanceTokens, ConsentCssProblem, ConsentCssResult } from './css.js';
export { BASE_CSS } from './base-css.js';
