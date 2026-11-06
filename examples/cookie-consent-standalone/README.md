# cookie-consent-standalone

`@jini-ai/cookie-consent` on plain `node:http`, with no framework and no vendor.

```sh
pnpm --filter @jini-ai/cookie-consent run build
pnpm --filter @jini-example/cookie-consent-standalone start   # http://localhost:4321
```

What the page shows:

- **The banner.** It is rendered by `renderBanner`. Its evidence mode is `durable`, so a choice is posted to `/_consent`, and `handleReceipt` stores it in `./receipts`.
- **Queueing.** `fake-vendor.js` is held back for 2 seconds. It pushes a live adapter onto `window.jiniConsentQueue`. The push works whether the consent client has loaded yet or not. The adapter runs only after analytics is allowed and the receipt is stored. If you withdraw consent ("Privacy choices" → Reject), it stops.
- **Declared scripts.** The page declares `/fake-vendor.js` without `consent`, so its adapter module loads automatically. `/marketing.js` declares `consent: ["marketing"]` and starts only after a grant. Withdrawal reloads after that arbitrary script ran. No page HTML is classified or rewritten for consent.
- **Region.** `region-plugins.json` holds data-only region readers (`{ kind: 'region-resolver', id, header }`) for hosts that put a visitor-country header on requests they proxy. Start with `CONSENT_INGRESS=cloudflare` (or `vercel`, `netlify`) only when that host really is in front of the server: the no-store `/_consent/context` request then sets `jini_region=us` for US visitors (opt-out banner) and clears it for everyone else. Unset, or on Fly (no country header), every visitor gets the strict banner. Try it locally: `CONSENT_INGRESS=cloudflare npm start`, then `curl -si -H 'cf-ipcountry: US' localhost:4321/_consent/context | grep -i set-cookie`.

The document renderer constructs the banner slot and emits both assets: `client.min.js` owns state/context and `extensions.min.js` binds the banner, declared scripts and bridges. Cached HTML contains no visitor region or choice. The context route reads the current published policy (a constant in this example), then resolves region once. Static hosts embed a policy snapshot with local evidence and omit the context URL.

A host with consent disabled omits config and both assets and delivers ordinary scripts through `renderScriptAssets`; it makes no consent requests or storage reads. The direct client API still supports its older anonymous-analytics mode for explicit library consumers.
