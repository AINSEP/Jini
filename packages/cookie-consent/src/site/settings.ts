import { observed } from "@jini-ai/core/errors/idioms";
import { ensureSettingDefinitions, getEffective, type EnsureSettingDefinitionsDeps, type SettingsRepoPort, type SettingDefinitionSpec } from '@jini-ai/core/settings';

import { SITE_CONSENT_DEFAULTS, SITE_CONSENT_NAMESPACE, SITE_CONSENT_PLACEMENTS, SITE_CONSENT_REGION_MODES, type SiteConsentSettings } from './config.js';

const ENUM_VALUES: Partial<Record<keyof SiteConsentSettings, readonly string[]>> = { regionMode: SITE_CONSENT_REGION_MODES, placement: SITE_CONSENT_PLACEMENTS };

/** What a site serves when consent is not on: the default copy with the banner off. */
export const SITE_CONSENT_OFF: SiteConsentSettings = { ...SITE_CONSENT_DEFAULTS, enabled: false };

/** The ledger's `enabled` default stays OFF: its default layer only means "no owner choice yet",
 * which {@link resolveSiteConsentActivation} turns into the product default (off since 2026-11-02).
 * Keeping it unchanged also means no boot-time rewrite of existing sites' enabled ledgers.
 * The blank privacy ledger lets bootstrap choose an existing site page before saving its URL. */
const LEDGER_DEFAULTS: SiteConsentSettings = { ...SITE_CONSENT_OFF, privacyPolicyUrl: '' };

/** The shared registrar owns legacy scalar definitions and their ledger revisions.
 * Complete published policies use the site snapshot adapter, avoiding partial field publication.
 * @complexity O(1), thirteen bounded settings definitions. */
export async function ensureSiteConsentDefinitions(required: EnsureSettingDefinitionsDeps, { systemPrincipalId }: { systemPrincipalId: string }): Promise<void> {
  const definitions: SettingDefinitionSpec[] = Object.entries(LEDGER_DEFAULTS).map(([key, defaultValue]) => {
    const values = ENUM_VALUES[key as keyof SiteConsentSettings];
    return { key, schema: values ? { type: 'enum', values: [...values] } : { type: typeof defaultValue === 'boolean' ? 'boolean' : 'string' }, defaultValue };
  });
  await ensureSettingDefinitions(required, { namespace: SITE_CONSENT_NAMESPACE, definitions, systemPrincipalId });
}

/** The optional privacy-page repair. Passing the repair makes its failure reporter REQUIRED: the
 * host owns the log channel, line format and redaction, so a failure is never silently dropped. */
export type SiteConsentPrivacyRepair =
  | { ensurePrivacyDefaults?: undefined; reportPrivacyDefaultsFailure?: undefined }
  | { ensurePrivacyDefaults: () => Promise<void>; reportPrivacyDefaultsFailure: (required: { error: unknown }) => void };

/** Consent owns readiness, without extending WebMCP's failure chain.
 * The shared boot chain serializes ledger writes on the site's single connection.
 * Definition failures block readiness; CMS defaults failures are reported and retried next open.
 * @complexity Registration is O(1); injected CMS defaults inherit their workspace scan cost. */
export function createSiteConsentReadiness({ after, systemPrincipalId, ...required }: EnsureSettingDefinitionsDeps & { after: Promise<void>; systemPrincipalId: string }, repair: SiteConsentPrivacyRepair = {}): Promise<void> {
  // Visitor cookie consent's `core.consent.*` definitions; registration never writes an owner choice.
  const ready = after.then(() => ensureSiteConsentDefinitions(required, { systemPrincipalId })).then(async () => {
    if (!repair.ensurePrivacyDefaults) return;
    // An optional content repair must not prevent the owner opening consent settings to fix it.
    try { await repair.ensurePrivacyDefaults(); }
    catch (error) { repair.reportPrivacyDefaultsFailure({ error }); }
  });
  // Attach a rejection observer now; a request may arrive long after registration fails.
  observed({ promise: ready });
  return ready;
}

/** Explicit owner on/off overrides the default for every site. */
export type SiteConsentActivation = { enabled: boolean; source: 'owner' | 'default' };

type Deps = { settingsRepo: SettingsRepoPort; workspaceId: string };

/** @complexity O(1), one ledger read. */
async function readSetting({ settingsRepo, workspaceId }: Deps, key: keyof SiteConsentSettings) {
  return getEffective({ deps: { repo: settingsRepo }, namespace: SITE_CONSENT_NAMESPACE, key, scopeContext: { workspaceId } });
}

/** Resolve whether consent applies, honoring an explicit owner choice over the product default.
 * The privacy link is not a precondition for activation; publishing still requires one (validation.ts).
 * @throws Error when the stored flag is not a boolean (never guesses on or off).
 * @complexity O(1), one ledger read. */
export async function resolveSiteConsentActivation(deps: Deps, _options = {}): Promise<SiteConsentActivation> {
  const enabled = await readSetting(deps, 'enabled');
  if (enabled !== null && enabled.sourceLayer !== 'default') {
    if (typeof enabled.value !== 'boolean') throw new Error('Invalid cookie consent setting: enabled.');
    return { enabled: enabled.value, source: 'owner' };
  }
  return { enabled: SITE_CONSENT_DEFAULTS.enabled, source: 'default' };
}

/** Read every non-flag value with type and length checks. @complexity O(1), twelve ledger reads. */
async function readValues(deps: Deps): Promise<Omit<SiteConsentSettings, 'enabled'>> {
  const entries = await Promise.all(Object.entries(SITE_CONSENT_DEFAULTS).filter(([key]) => key !== 'enabled').map(async ([key, fallback]) => {
    const resolved = await readSetting(deps, key as keyof SiteConsentSettings);
    const value = resolved === null || (['regionMode', 'privacyPolicyUrl'].includes(key) && resolved.sourceLayer === 'default') ? fallback : resolved.value;
    if (typeof value !== typeof fallback) throw new Error(`Invalid cookie consent setting: ${key}.`);
    if (typeof value === 'string' && value.length > 2000) throw new Error(`Cookie consent setting ${key} exceeds 2000 characters.`);
    return [key, value] as const;
  }));
  return Object.fromEntries(entries) as Omit<SiteConsentSettings, 'enabled'>;
}

/** Bind workspace settings to the mechanism. Missing definitions use the product default.
 * Malformed values throw rather than bypass an enabled policy. @complexity O(1), thirteen reads. */
export function createSiteConsentConfig({ settingsRepo, workspaceId }: Deps, _options = {}) {
  return {
    async get(_input: Record<string, never> = {}, _optional = {}): Promise<SiteConsentSettings> {
      // Disabling remains a working rollback even if another consent setting is malformed.
      const activation = await resolveSiteConsentActivation({ settingsRepo, workspaceId });
      if (!activation.enabled) return { ...SITE_CONSENT_OFF, reopen: 'link' };
      const values = await readValues({ settingsRepo, workspaceId });
      if (!SITE_CONSENT_REGION_MODES.includes(values.regionMode)) throw new Error('Choose automatic, opt-in, or opt-out cookie consent region mode.');
      if (!SITE_CONSENT_PLACEMENTS.includes(values.placement)) throw new Error(`Choose a cookie banner placement: ${SITE_CONSENT_PLACEMENTS.join(', ')}.`);
      if (!values.policyVersion.trim() || values.policyVersion.length > 128) throw new Error('Cookie consent policy version must contain 1–128 characters.');
      return { ...values, enabled: true, reopen: 'link' };
    },
  };
}

/** Authoring reads retain saved copy even while consent is disabled; public rollback still uses get().
 * @example readSiteConsentAuthoringSettings({ settingsRepo, workspaceId })
 * @complexity O(1), one bounded set of existing ledger reads; performs no writes. */
export async function readSiteConsentAuthoringSettings(deps: Deps, _options = {}): Promise<SiteConsentSettings> {
  const activation = await resolveSiteConsentActivation(deps);
  return { ...await readValues(deps), enabled: activation.enabled };
}
