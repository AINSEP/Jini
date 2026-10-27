# @jini-ai/cookie-consent

Cookie consent with no dependencies and no vendor code. It has five parts:

- a consent-state contract that any banner can drive,
- a small browser client (`dist/client.min.js`),
- a banner renderer that returns plain strings, with owner CSS,
- web-standard receipts (`Request` → `Response`),
- open plugin slots.

Vendors (analytics, ads, region lookups) plug in from their own packages.

## Install

```sh
npm install @jini-ai/cookie-consent
```

## Standalone use

Render on the server (or at build time), serve the client and mount the receipt endpoint.

```ts
import { renderBanner } from '@jini-ai/cookie-consent/render';

const { head, body, problems } = renderBanner(
  { mode: 'jini', client: { contract: 1, policy: '2026-10-26', regionMode: 'auto' }, copy: { privacyPolicyUrl: '/privacy' } },
  { clientSrc: '/consent/client.min.js', evidence: { mode: 'durable', endpoint: '/_consent' } },
);
// Put `head` in <head> and `body` at the end of <body>. Serve
// node_modules/@jini-ai/cookie-consent/dist/client.min.js at /consent/client.min.js.
```

```ts
import { handleReceipt } from '@jini-ai/cookie-consent/server';
import { createConsentFileRecords, createNodeConsentFiles } from '@jini-ai/cookie-consent/node';

const store = createConsentFileRecords({ directory: './consent-receipts', files: createNodeConsentFiles({ atomicWrite }) });
// POST /_consent, with request.url built from the site's PUBLIC origin:
const response = await handleReceipt({ request, ports: { store, policy: () => '2026-10-26', ids: () => crypto.randomUUID(), now: Date.now } });
```

- **Modes:**
  - `jini` is the built-in banner.
  - `headless` is your own banner. It drives `window.jiniConsent` (`get`, `set`, `subscribe`, `open`, `setOpen`).
  - `off` renders the client config without banner UI and permits anonymous analytics only. It writes no consent cookie or receipt and ignores earlier choices. Raw inert tags stay blocked.
- **Evidence:**
  - `durable`: a grant only takes effect once the server has stored its receipt.
  - `local`: the record stays in the browser (static export, Electron, `file:`) and is labelled as browser-only.
- Denial applies before any network call. Global Privacy Control or DNT turns off analytics and marketing (including anonymous analytics), and nothing can turn them back on. The receipt response never sets a cookie.
- Choices use `jini_choices`, separate from the older CMS engine's HttpOnly `jini_consent`. Old cookies are never imported as consent; returning visitors choose once under this engine. Hosts may expire the old host-only cookie when switching engines.
- **Server-side gate:** `readConsent({ cookieHeader, policy, regionMode }, { secGpc, dnt, anonymous })` from `./server`. Bind `anonymous: true` when the banner is off. The historical `gpc` state/receipt field records the effective GPC-or-DNT opt-out.
- **Inert tags:**
  - `<script type="text/plain" data-consent-category="analytics">` runs only once its category is allowed.
  - `<iframe data-consent-category data-src>` loads only once its category is allowed.

A runnable example is in `examples/cookie-consent-standalone` (it includes a slow fake vendor that shows queueing).

## Plugin slots

The slot set is open. Each kind is a string. A contribution for a kind that no slot defines yet waits until `defineSlot` arrives. Every register or inject call takes `(required, optional)` objects.

- **Browser adapters** (`kind: 'consent-adapter'`, category `functional` | `analytics` | `marketing`). There are two forms:
  - Lazy: `{ id, kind, category, src, config }` goes in the page config's `plugins`, and the module at `src` is imported on grant, or for cleanup in off mode when `supportsAnonymous: true`.
  - Live: the module is pushed before or after the client loads:

    ```js
    (window.jiniConsentQueue ||= []).push({ id: 'stats', kind: 'consent-adapter', category: 'analytics',
      grant({ config, state, signal }) { /* start the vendor */ return { revoke() { /* stop it */ return true; } }; } });
    ```

  In off mode `allowed.analytics` is always `false`; `state.analyticsLevel` is `anonymous` (or `none` under GPC/DNT). Adapters must read `state.analyticsLevel` (`none` | `anonymous` | `full`). Only adapters declaring `supportsAnonymous: true` can run in off mode. Anonymous means no cookies/localStorage/sessionStorage created, no cross-page identifier, person profiles, IP geolocation, replay or form-input capture. Adapters remove their own leftover identity at anonymous/none levels; off-mode adapters may be imported for this cleanup without a grant. Hosts must pass the server decision to collectors; a browser payload never sets its own level.

  If `revoke()` returns false (or is missing), the page reloads so that it ends up clean.
- **Server region resolvers** (`kind: 'region-resolver'`). There are two forms:
  - Live: `resolve({ request })`.
  - Data only: `{ header, usValues }`. `REGION_SLOT` turns this into a header resolver.

  `resolveRegion` takes the first definite answer. A resolver that throws or times out, or no resolver knowing the answer, gives `strict`. An unknown region always gets the strict banner, with Reject on the first layer. There is no geo file.
- **Any other kind:** call `createPluginRegistry({}, { slots: [mySlot] })`, or `registry.defineSlot({ slot })` at any time.

## Editing the banner CSS

Owners can write any selector under `#jini-consent`, `.jini-consent` or `.jini-consent-reopen`. The compiler handles bad input like this:

- A bad rule is dropped and reported in `problems`. The other rules still apply.
- A syntax error drops only the custom CSS. Appearance tokens still apply.
- Text whose contrast is below 4.5:1 drops only the root colors.

Some selectors are refused, so that Reject always looks like Accept:

- attribute selectors,
- structural pseudo-classes (`:first-child`, `:not`, ...),
- pseudo-elements,
- `+` and `~`.

An engine parity block is always added after the owner's CSS. `compileConsentCss({ css, tokens })` (from `./render`) gives an editor the same result as the live page. The admin preview renders with `preview: { region }` and puts `htmlAttrs` on the preview iframe's `<html>`.

## Size

`dist/client.min.js` is about 4.4 KB gzipped, and that includes the built-in banner binding. The build fails above 4,608 bytes (`npm run build` prints the size). The design target was about 3 KB. The gate is set to stop further growth, not to bless the current size.
