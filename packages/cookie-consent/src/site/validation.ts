/** @file Site copy bounds plus Jini's policy-link and appearance validators. */
import type { ConsentConfig } from '../contract.js';
import { compileConsentCss, safeHref } from '../render/index.js';
import { ToolInputError } from '@jini-ai/core';
import { SITE_CONSENT_BANNER_MODES, SITE_CONSENT_DEFAULTS, SITE_CONSENT_PLACEMENTS, SITE_CONSENT_REGION_MODES, SITE_CONSENT_TEXT_LIMITS, type SiteConsentSettings } from './config.js';
import type { ConsentProblem } from '@jini-ai/core/contracts/site/core-consent-refusal';

const FIELDS = [...Object.keys(SITE_CONSENT_DEFAULTS), 'appearance', 'customCss', 'allowUnsafeEval', 'reopen', 'bannerMode'];

/** Strict full configuration input; every host field is explicit, including the on/off choice.
 * Missing fields, unknown fields and type mismatches never reach persistence.
 * Appearance values remain untrusted until Jini compiles them. O(n), n <= 32 KiB.
 * @example parseConsentConfig({ value: { ...SITE_CONSENT_DEFAULTS, message: 'Our cookie policy.' } }) */
export function parseConsentConfig(
  { value, bannerModeRefusal }: { value: unknown; bannerModeRefusal?: string | undefined },
  _options = {},
): ConsentConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ToolInputError({ message: 'config must be a JSON object.' });
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(key => !FIELDS.includes(key))) throw new ToolInputError({ message: 'Unknown consent configuration field. Categories are fixed by the consent engine.' });
  for (const [key, fallback] of Object.entries(SITE_CONSENT_DEFAULTS)) {
    if (!Object.prototype.hasOwnProperty.call(raw, key) || typeof raw[key] !== typeof fallback) throw new ToolInputError({ message: `Invalid consent field: ${key}.` });
  }
  validateConsentOptions({ raw, bannerModeRefusal });
  const config = { ...raw } as SiteConsentSettings;
  validateConsentCopy({ config });
  validateConsentAppearanceShape({ raw });
  if (JSON.stringify(config).length > 32_768) throw new ToolInputError({ message: 'Consent configuration exceeds 32 KiB.' });
  return config as ConsentConfig;
}

/** Host copy has bounded plain text and fixed engine-supported presets; never trusted markup. */
function validateConsentCopy({ config }: { config: SiteConsentSettings }, _options = {}): void {
  if (!SITE_CONSENT_REGION_MODES.includes(config.regionMode) || !SITE_CONSENT_PLACEMENTS.includes(config.placement)) throw new ToolInputError({ message: 'Choose a supported region mode and placement.' });
  if (config.policyVersion.trim().length < 1 || config.policyVersion.length > 64) throw new ToolInputError({ message: 'policyVersion must contain 1–64 characters.' });
  validateConsentTextFields({ config });
  if (config.privacyPolicyUrl.length > 2000 || config.secondaryLinkUrl.length > 2000) throw new ToolInputError({ message: 'Policy links must be at most 2000 characters.' });
}

/** Banner fields share copy bounds; only the secondary link label may be empty. */
function validateConsentTextFields({ config }: { config: SiteConsentSettings }, _options = {}): void {
  for (const [key, max] of Object.entries(SITE_CONSENT_TEXT_LIMITS)) {
    const text = config[key as keyof typeof SITE_CONSENT_TEXT_LIMITS];
    const emptyAllowed = key === 'secondaryLinkLabel' && text.length === 0;
    if (text.length > max || (!emptyAllowed && !text.trim())) throw new ToolInputError({ message: `${key} must contain 1–${max} characters.` });
  }
}

/** The engine diagnoses CSS semantics; the boundary caps its input and refuses non-object tokens. */
function validateConsentAppearanceShape({ raw }: { raw: Record<string, unknown> }, _options = {}): void {
  if (raw.customCss !== undefined && (typeof raw.customCss !== 'string' || raw.customCss.length > 16_384)) throw new ToolInputError({ message: 'customCss must be a string of at most 16384 characters.' });
  if (raw.appearance !== undefined && (!raw.appearance || typeof raw.appearance !== 'object' || Array.isArray(raw.appearance))) throw new ToolInputError({ message: 'appearance must be a token object.' });
}

/** The compiler's own defaults ('' and {}), spelled out for exact optional property types. O(1). */
const cssSource = ({ config }: { config: ConsentConfig }, _optional = {}) => ({ css: config.customCss ?? '', tokens: config.appearance ?? {} });

/** Readiness and publication share this decision. Jini is the only CSS/link authority. O(n). */
/** `cssBlocks: false` (cookie-consent engine): a bad CSS rule is dropped on its own and reported by the
 * preview, so it never blocks publishing. */
export function consentConfigProblems({ config }: { config: ConsentConfig; trustedRegion: boolean }, { cssBlocks = true }: { cssBlocks?: boolean } = {}): ConsentProblem[] {
  const problems: ConsentProblem[] = cssBlocks ? compileConsentCss(cssSource({ config })).problems.map(problem => ({ ...problem, field: 'appearance' })) : [];
  if (config.enabled && !safeHref({ url: config.privacyPolicyUrl })) problems.push({ code: 'PRIVACY_LINK_REQUIRED', field: 'privacyPolicyUrl', message: 'Link a published privacy page or a credential-free HTTPS privacy policy.' });
  if (Boolean(config.secondaryLinkLabel) !== Boolean(config.secondaryLinkUrl) || (config.secondaryLinkUrl && !safeHref({ url: config.secondaryLinkUrl }))) problems.push({ code: 'SECONDARY_LINK_INVALID', field: 'secondaryLinkUrl', message: 'Supply both a secondary link label and a local or HTTPS link.' });
  if (config.regionMode === 'opt-out') problems.push({ code: 'GLOBAL_OPT_OUT_REFUSED', field: 'regionMode', message: 'Use automatic region mode for US opt-out. EU, UK and unknown regions must keep Reject.' });
  return problems;
}

/** Optional engine fields stay outside required defaults so older snapshots still parse. */
function validateConsentOptions({ raw, bannerModeRefusal }: { raw: Record<string, unknown>; bannerModeRefusal?: string | undefined }, _options = {}): void {
  if ('allowUnsafeEval' in raw && typeof raw.allowUnsafeEval !== 'boolean') throw new ToolInputError({ message: 'allowUnsafeEval must be a boolean.' });
  if ('reopen' in raw && raw.reopen !== 'link') throw new ToolInputError({ message: 'Cookie preferences reopen through a link.' });
  if ('bannerMode' in raw && !SITE_CONSENT_BANNER_MODES.includes(raw.bannerMode as never)) throw new ToolInputError({ message: bannerModeRefusal ?? 'Choose the built-in banner, your own banner, or none.' });
}
