Software Architect(Direct): **Keep the JSON declaration and extend `@jini-ai/cookie-consent`. No converter, replacement engine, or new package is needed.** The real gaps are undeclared executable HTML and full-document themes without a runtime slot. Those cannot receive automatic protection under all your rules.

I loaded both requested skills. Inspected `origin/cloud/combine`: Tovu `a5be70ca8`, Jini `3a86f98ba`. Graph tools were unavailable, so evidence uses bounded `git show` and `git grep` reads. Nothing changed; no tests, builds, installs, or servers ran.

**Findings**

- Jini already has the permission state and subscription API: [contract.ts:123](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cookie-consent/src/contract.ts:123). `ConsentAdapter` is a **consumer lifecycle**—grant/revoke—not an interchangeable banner or consent-tool provider.
- Its client already handles receipts, withdrawal races, aborts and reload when code cannot stop: [client/index.ts:50](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cookie-consent/src/client/index.ts:50). Its HTML activation only handles already-inert resources: [dom.ts:45](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/cookie-consent/src/client/dom.ts:45). This explains the earlier conversion plan’s blocker.
- The replacement still buffers and scans complete responses to insert its banner: [site-cookie-consent.ts:79](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/public-http/middleware/site-cookie-consent.ts:79), `:107`, `:298`. That must go too.
- Theme `scripts` declarations are currently unread; the validator explicitly flags them as unimplemented: [manifest-v2.ts:26](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/theme/validation/manifest-v2.ts:26). This needs actual loader support.
- Tovu’s contribution loader accepts region resolvers; analytics adapters arrive through analytics providers: [region-plugins.ts:17](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/consent/region-plugins.ts:17), [provider-plugins.ts:273](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/runtime/composition/provider-plugins.ts:273). A custom banner/CMP cannot yet register through that complete route.
- Readiness still runs the old gate and parses its output: [readiness.ts:56](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/consent/readiness.ts:56). Replacing this with an empty “detected” list would give false assurance.

**The recommended design**

Keep your declaration exactly:

```json
{ "scripts": [
  { "src": "/scripts/menu.js" },
  { "src": "/scripts/stats.js", "requires": ["analytics"] },
  { "src": "https://example.com/pixel.js",
    "requires": ["analytics", "marketing"] }
] }
```

The normal theme/plugin/package loaders collect declarations when those sources load. A shared Jini validator resolves asset URLs and rejects malformed or unknown requirements. No script body is inspected.

Unconditional scripts use ordinary asset delivery. Conditional entries remain JSON until the consent client starts them. Its check is:

```ts
requires.every(category => state.allowed[category] === true)
```

Use `allowed`, never `choices`: durable grants currently wait for a receipt. Recheck immediately before starting each script; start each entry once.

Use array order for currently eligible scripts, preserving ordered loading. Do not add dependency IDs or a graph now. A genuine SDK dependency can stay inside its existing `ConsentAdapter`, which already awaits loading.

On later grant, start newly eligible scripts. On withdrawal, abort pending work and invoke existing revokers. An arbitrary script cannot be “unexecuted”; persist denial and reload when it has no reliable cleanup. Already transmitted data remains transmitted.

Reuse the comments provider’s existing `consentCategory` as `[consentCategory]` for its optional assets—[definitions.ts:6](/Users/la/Programming/tovu-integration-clones/prov2-jini/packages/capability-providers/src/comments/definitions.ts:6)—and retain provider-created inert frames/templates. Do not hide ordinary stored comments merely because their provider has that metadata.

Keep all US regions opt-out in auto mode; unknown regions remain strict. That rule already exists in Jini’s `contracts/policy.ts:16`.

One inconsistency needs acknowledgement: your explicit “no `requires` means always” also permits an external declaration without `requires`. That conflicts with the earlier blanket external rule. I recommend treating omission as an explicit always-on declaration, with a conspicuous warning for external URLs, rather than silently inventing its category.

**One interface**

Extend the existing interface; add only `allows`. The relevant interface remains under 20 lines:

```ts
interface JiniConsentApi {
  readonly contract: 1;
  readonly plugins: PluginRegistry;
  get(): ConsentState;
  allows(required: { requires: readonly Category[] },
         optional?: object): boolean;
  subscribe(required: { listener: (state: ConsentState) => void },
            optional?: object): () => void;
  set(required: { action: ConsentAction },
      optional?: { choices?: Partial<Flags> }): Promise<ConsentState>;
  open(): void;
  setOpen(required: { open: boolean }): void;
}
```

`plugins.ts` already exposes an open registry. Add one always-active UI/bridge contribution kind using it. Move the existing `bindBanner` registration behind that kind; the built-in banner becomes its default plugin without creating another bundle or package.

A replacement banner drives `set`, reads `get`, and subscribes. An outside CMP plugin maps its purposes and change events into this same API. Jini continues enforcing effective policy, GPC and receipt requirements. This supports an outside tool without introducing a competing permission state.

Analytics and marketing adapters use the same check. Server readers return the existing `ConsentState` and call the same pure `allows` implementation. Preserve `analyticsLevel`: ordinary analytics providers require `full`; only explicitly anonymous-capable adapters may use `anonymous`. Keep receipt verification immediately before detached server delivery.

**Undeclared scripts**

| Measure | What it catches | What it misses or costs |
|---|---|---|
| Enforced pre-consent `script-src` | Disallowed external script URLs | `'self'` permits same-origin trackers. Allowing inline code permits pasted inline trackers. Blocking inline code breaks existing own scripts. It does not cover pixels, frames or other network channels. |
| Save-time warning, without changing bytes | Recognizable raw scripts, inline handlers and labelled-but-executable content | Dynamic loaders, obfuscated behavior, imports/restores outside the warning path, and ignored warnings. |
| Assistant authoring instructions | Agents can consistently declare optional scripts and avoid raw tracker tags | Humans, other agents, existing content and mistakes. Instructions are not enforcement. |

A restrictive header cannot be loosened inside the current document. Supporting newly permitted external origins requires a navigation with a different header. A hash/nonce-based trusted loader with `strict-dynamic` can avoid that reload, but denies unapproved ordinary scripts and therefore changes the earlier first-party behavior. A permissive source list lets pasted scripts from those sources run too. [CSP specification](https://www.w3.org/TR/CSP3/#multiple-policies).

For static hosts without headers, an early CSP meta element can enforce a fixed policy. It misses preceding content and cannot be relaxed after Accept. Report-only CSP is unavailable in meta. Therefore static export cannot offer an equivalent visitor-dependent header gate. [CSP meta rules](https://www.w3.org/TR/CSP3/#meta-element).

**Recommendation:** declarations provide the execution guarantee for managed assets; warnings expose unmanaged content. Do not present either as blanket protection for pasted HTML. A consent-dependent CSP rollout should be a separate, deliberate compatibility choice.

**Existing pages, static export and caches**

Managed pages can adopt this without rewriting stored bodies. Their document renderer emits generic asset contributions as it constructs the document.

Full-document static themes bypass that shell: [render.ts:3124](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/server/inbound/public-http/http/site/render.ts:3124). Their current head contribution path also splices completed HTML. Reusing that for consent would violate your rule. They need a normal runtime/assets slot in their theme source, or must remain outside the new integration until updated. There is no automatic, byte-preserving insertion trick.

Existing raw trackers do not become declared merely by adding JSON elsewhere; that would leave the original running and potentially run it twice. Sites with such content need explicit author edits or must defer cutover. Old deployments retain their existing behavior until upgraded.

Removing the old engine can release previously gated scripts, frames, pixels, handlers and CSS requests. Unlabelled first-party code may also track. First-party origin does not establish a consent exemption; purpose and applicable exceptions matter. [ICO guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-storage-and-access-technologies/). Keep your first-party behavior decision, but describe this limitation honestly.

For shared cached HTML, emit visitor-independent declarations/bootstrap only. A small `/_consent/context` response supplies current policy and trusted region, with `no-store`; move region-cookie writes there. This avoids visitor-dependent HTML and page-response cookies.

Static export embeds a policy snapshot with `evidence: local`. Explicitly copy local declared scripts, client and adapter assets: the current HTML crawler cannot discover URLs inside JSON—[site-exporter.ts:50](/Users/la/Programming/tovu-integration-clones/prov2-tovu/apps/website/src/features/site-export/site-exporter.ts:50). Do not export live-only collectors. Re-export when policy changes; invalidate cached documents when enabling/disabling the runtime or changing declarations.

**Deletion scope**

In Jini, delete these 15 production files under `packages/cms/src/consent/` after replacement consumers pass:

`index.ts`, `types.ts`, `policy.ts`, `css.ts`, `css-parser.ts`;  
`express/{index,response}.ts`;  
`html/{index,client,gate,render,resources,static,styles}.ts`;  
`node/index.ts`.

Also remove their obsolete tests/docs, four package exports, entry/layer metadata, Express hint and Knip entries. Replace cookie-consent’s `cms-resource-release.integration.test.ts`, then remove its CMS test alias/dev dependency.

Tovu’s 13 direct production importers are:

- `features/consent/{readiness,validation,service,revisions}.ts`
- `features/analytics/contracts.ts`, `features/forms/analytics-provenance.ts`
- public middleware `site-consent.ts`, and `visitor-analytics.ts`
- composition `{deps,analytics-providers,browser-analytics-http,browser-analytics,site-consent}.ts`

Remove the engine selector/fallback, `features/consent/host.ts`, legacy settings-link detection and public analytics bridge. Update affected tests, commerce fixtures, journey types and documentation.

Keep policy revisions, saved settings, receipts, rate/origin checks, privacy-page validation, region plugins and analytics admission/delivery checks. Preserve admin telemetry by relocating its generic response-capture helper into Jini HTTP kit before deleting the old import. Keep `parse5`: forms, navigation and fragment validation still use it.

Replace readiness’s rewrite dry run with declaration validation, allowance simulation and separately labelled unmanaged-content warnings. Keep storage checks, limits, redaction and failure reporting. Preview the banner separately; never claim that a rendered sample proves all scripts are controlled.

**Implementation steps — estimates, not changes made**

| Step | Files and rough production lines | Planned tests | Why it cannot be smaller |
|---|---|---|---|
| 1. Shared check and declared-script lifecycle | Jini cookie-consent `contract.ts`, policy, client and a small scripts module: **+160–240, −20–40** | All-of, absent/unknown requirements, order, once-only start, withdrawal during loading | Existing adapter accepts one category and the client has no JSON-script loader. |
| 2. Pluggable banner/CMP bridge | Existing registry, client entry, Tovu contribution wiring: **+90–150, −20–40** | Built-in and custom banner parity; CMP changes; disposal; GPC/receipt enforcement | Headless API exists, but host plugin registration is incomplete. |
| 3. Asset declarations and document delivery | Jini CMS generic asset contract; Tovu theme loader/validator, shell, plugin contributions, consent context route and export asset list: **+220–350, −180–260** | Managed shell, full-document eligibility, comments assets, live/static parity, cached HTML | This replaces response scanning and makes declarations actually usable. |
| 4. Diagnostics and authoring guidance | Consent readiness/service/preview; existing page/theme validation owners and assistant guidance: **+100–180, −100–180** | Warning leaves bytes unchanged; no false readiness; bounded/truncated diagnostics | Old readiness depends directly on the deleted gate. |
| 5. Rewire consumers and delete legacy | The files listed above, package metadata and locks: **+60–120, roughly −2,500–2,900** | Server analytics, retired proofs, settings compatibility, admin telemetry, export and off-mode | Deleting first breaks consumers and changes protection silently. |

Add roughly **450–700 focused test lines** across these steps; retire obsolete engine suites after replacement behavior is covered.

**Cost**

Let `P` be page boots, `S` declaration bytes, `N` scripts, `K` requirements per script, `H` cookie-header bytes, `C` choices and `E` server events. These are proposed operation counts, not benchmarks.

| Hot path | Consent on | Consent off |
|---|---|---|
| Source activation/change | One read per changed manifest, total `S`; no content writes | Same ordinary asset-manifest work |
| Page serving | No consent HTML scan/buffer; bootstrap/declarations emitted during construction | No consent module, bootstrap, cookies or consent-specific page reads |
| Browser boot/context | `P × S` JSON processing; one context request/boot, one policy-store read and region resolution; two initial cookie reads of `H` | Zero consent requests/storage |
| Permission checks | Initial/change reconciliation: `N × K` in-memory booleans; no I/O; each eligible asset fetched normally once | Ordinary script delivery |
| Visitor choice | `C ×` one ≤2 KiB POST; 1–2 cookie writes, each verified by reading `H`; one ≤4 KiB receipt write; replacement may archive the old ≤4 KiB receipt | Zero |
| Server event | Per request, one policy read plus `H` parsing; reuse state within request. Detached delivery adds one policy and one ≤4 KiB receipt read | Zero consent I/O |
| Visibility/pageshow | One cookie read of `H` per notification; no polling | Zero |
| Export | Per page output write, plus each declared local asset copied once; no consent conversion | Ordinary export |

Today one policy-store read can fetch a head plus **both** draft and published rows, up to approximately **64 KiB**, despite the public caller needing only publication: `revisions.repo.ts:20`. The current page middleware calls policy reading twice. Consolidate to one context read before considering further caching.

Receipt storage performs an initial directory/stat inventory and amortized maintenance; it is not literally one filesystem operation per choice. Disabling consent must also bypass today’s banner-off anonymous-analytics runtime, which currently still downloads code.

I will **not** add automatic HTML conversion, tracker classification, vendor logic in core, a dependency graph, a second consent interface, or a new polling/cache framework.

Estimate: **16–24 Codex hours**, excluding site-by-site content/theme remediation and a separately selected CSP rollout.

Only owner decisions remain:

1. Should existing sites wait for explicit author fixes when unmanaged trackers or missing runtime slots are found, or may reviewed sites move with disclosed gaps?
2. Is an external declaration without `requires` an intentional always-on exception, following the JSON rule?
3. Is consent-dependent CSP—with reload and compatibility costs—wanted as an additional live-site option?