# Cookie Consent screen

Administration → Cookie Consent (`?tab=overview|banner|look|rules`). Edits autosave as a draft
revision; the live site changes only on Publish.

## Wiring

**Needs injected** (all required, from the host):

- `CookieConsentProps.port: ConsentRevisionsPort`, built with `createConsentRevisionsPort({ request, workspaceId })`
  over the host's authenticated admin request (`ConsentRequest`).
- `CookieConsentProps.useTranslate: () => ConsentTranslation`: the host hook that resolves the admin locale
  and memoizes `consentTranslation({ locale })`.
- `CookieConsentProps.errors: ConsentErrors`: `isConflict` (HTTP 409) and `describe` over the host's error class.
- `CookieConsentProps.ui: ConsentScreenUi`: the consent engine's `BannerFields`, `LookFields`,
  `RulesFields`, `PreviewFrame`, `previewDesktopWidth` and `previewScale`.
- An `<AdminKitProvider>` above the page (kit `TabBar`, kit theme `defaultAdminTheme.light`).
- The stylesheet `consent-settings.css` (`jini-consent-*` classes, admin tokens only), loaded by the host.

**Provides**: `CookieConsent`, the revisions port factory and wire types (`settings.hooks`), autosave
(`consent-autosave`), pure page decisions (`rules`), the page hooks (`use-consent-page.hooks`) and the
21-locale dictionary (`consent-dictionary`, split into `consent-dictionary.locales-*.ts`).

```tsx
import { CookieConsent, type ConsentScreenUi } from '@jini-ai/admin/screens/consent/CookieConsent';
import { createConsentRevisionsPort } from '@jini-ai/admin/screens/consent/settings.hooks';
import '@jini-ai/admin/screens/consent/consent-settings.css';

const port = createConsentRevisionsPort({ request: hostRequest, workspaceId });
const errors = { isConflict: ({ error }) => isHttp409(error), describe: ({ error, fallback }) => describe(error, fallback) };
export const ConsentPage = ({ tabId }: { tabId: string | null }) =>
  <CookieConsent tabId={tabId} port={port} useTranslate={useHostConsentTranslate} errors={errors} ui={engineUi} />;
```

**Never imports**: the host's request/config modules, the host's locale hook, `@jini-ai/cookie-consent`
(its sections arrive through `ui`), or any host theme.
