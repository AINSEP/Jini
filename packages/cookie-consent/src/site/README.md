# `@jini-ai/cookie-consent/site/*`

Site-level consent policy pieces a host builds its consent settings, admin preview and publish
checks from: the settings shape and defaults (`config`), the saved-config → banner converter
(`cookie-consent`), strict config validation (`validation`), the revision-store contract
(`revisions`), the initial privacy-page copy (`privacy-page-template`), and the settings-ledger
binding plus boot readiness (`settings`).

## Wiring

- **Needs injected:** nothing at import time. Every function takes plain args (`{ config }`,
  `{ value }`, `{ siteTitle, email }`). Storage arrives as a host implementation of the
  `SiteConsentStore` port (`./site/revisions`); the host keeps its SQL adapter.
  `./site/settings` takes the `@jini-ai/core/settings` ports (`EnsureSettingDefinitionsDeps`,
  `SettingsRepoPort`). `createSiteConsentReadiness`'s optional repair is a `SiteConsentPrivacyRepair`:
  passing `ensurePrivacyDefaults` makes `reportPrivacyDefaultsFailure({ error })` REQUIRED — the
  host logs (and redacts) the failure; this package never writes to a console.
- **Provides:** `SITE_CONSENT_*` constants and `SiteConsentSettings`, `withSiteConsentDefaultCss`,
  `siteConsentLinkProblem`, `toSiteCookieConsent`/`renderSiteConsentPreview`/`siteBannerMode`,
  `parseConsentConfig`/`consentConfigProblems` (problems typed by
  `@jini-ai/core/contracts/site/core-consent-refusal`), `SiteConsentStore`/`SiteConsentConflict`,
  `privacyPageTemplate`, `ensureSiteConsentDefinitions`/`createSiteConsentReadiness`/
  `createSiteConsentConfig`/`resolveSiteConsentActivation`/`readSiteConsentAuthoringSettings`.
- **Must never import:** host DB kernels or drivers, host logging/redaction formatters, product
  copy or env, or any server framework. Same-package code is imported relatively.

```ts
import { parseConsentConfig, consentConfigProblems } from '@jini-ai/cookie-consent/site/validation';
import { withSiteConsentDefaultCss } from '@jini-ai/cookie-consent/site/config';
import { toSiteCookieConsent } from '@jini-ai/cookie-consent/site/cookie-consent';
import type { SiteConsentStore } from '@jini-ai/cookie-consent/site/revisions';

const store: SiteConsentStore = createHostConsentStore({ kernel, workspaceId }); // host-owned SQL adapter
const published = await store.readPublished({});
const config = withSiteConsentDefaultCss({ config: parseConsentConfig({ value: published?.config }) });
const problems = consentConfigProblems({ config, trustedRegion: false });
const { banner, options } = toSiteCookieConsent({ config, policy: `${config.policyVersion}:${published?.id}` });

const ready = createSiteConsentReadiness({ ...settingsDeps, after: bootSettingsReady, systemPrincipalId }, {
  ensurePrivacyDefaults: () => ensureHostPrivacyPage(),
  reportPrivacyDefaultsFailure: ({ error }) => hostLog.error(`[consent] privacy defaults failed: ${redact(error)}`),
});
```

Boundary rationale: `docs/decisions/DR-005-portable-package-boundaries.md`.
