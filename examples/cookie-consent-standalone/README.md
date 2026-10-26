# cookie-consent-standalone

`@jini-ai/cookie-consent` on plain `node:http`, with no framework and no vendor.

```sh
pnpm --filter @jini-ai/cookie-consent run build
pnpm --filter @jini-example/cookie-consent-standalone start   # http://localhost:4321
```

What the page shows:

- **The banner.** It is rendered by `renderBanner`. Its evidence mode is `durable`, so a choice is posted to `/_consent`, and `handleReceipt` stores it in `./receipts`.
- **Queueing.** `fake-vendor.js` is held back for 2 seconds. It pushes a live adapter onto `window.jiniConsentQueue`. The push works whether the consent client has loaded yet or not. The adapter runs only after analytics is allowed and the receipt is stored. If you withdraw consent ("Privacy choices" → Reject), it stops.
- **An inert tag.** The marketing tag is `<script type="text/plain" data-consent-category="marketing">`. It runs only after Accept. If you withdraw consent after it ran, the page reloads, because a raw tag can't be stopped.
- **Region.** `region-plugins.json` holds data-only region readers (`{ kind: 'region-resolver', id, header }`) for hosts that put a visitor-country header on requests they proxy. Start with `CONSENT_INGRESS=cloudflare` (or `vercel`, `netlify`) only when that host really is in front of the server: the page then sets `jini_region=us` for US visitors (opt-out banner) and clears it for everyone else. Unset, or on Fly (no country header), every visitor gets the strict banner. Try it locally: `CONSENT_INGRESS=cloudflare npm start`, then `curl -si -H 'cf-ipcountry: US' localhost:4321/ | grep -i set-cookie`.
