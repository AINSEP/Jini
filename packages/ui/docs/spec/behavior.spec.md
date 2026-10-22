Spec ID: SPEC-JINI-UI-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:f383c1c5fe695f645b39facc3fc7ff536c719d55bacd0359684bd593102a3966
spec_mode: reverse_spec


# Behavior contract: @jini-ai/ui

## Boundaries

The root is a browser React surface. `/core`, `/mcp-ui/surfaces` and `/interactive-ui/manifests` are framework-free entry points. Heavy editors require their own subpaths and peers. A consumer supplies application data, persistence, navigation, permission enforcement, provider credentials, tool execution and translations through props/ports. Public fake dependencies supply fixtures, not production transport.

The package sets no universal request timeout, retry policy, concurrency limit, durable cache or authentication guard. Individual behavior below is scoped to its named module. A boolean permission check is an affordance filter, not server authorization.

## Queries, writes and async settlement

- Queries share one provider cache by structural primitive-array key (`JSON.stringify`). Ordinary loads and initial in-flight reads deduplicate. Explicit forced background refresh with existing data may supersede the prior transport; older callers follow the newer result. Freshness defaults to 10 seconds; equality at the freshness boundary is stale.
- Enabled reads load automatically. Disabled reads skip automatic loads and retain data; a disabled read without data reports loading and hides an earlier error. A disabled read with data may still expose a refresh error. Explicit `refetch()` calls the loader even when disabled.
- Background refresh keeps earlier data and the previous status until settlement. A failed refresh publishes error status while retaining earlier data. Non-Error failures are normalized for the error channel; awaited mutation/loader promises reject with the original failure.
- Successful mutations invalidate configured prefixes; failed mutations do not. Empty prefix matches every key. Enabled observers force refresh; a pending initial read still deduplicates, while an existing-data refresh may be restarted. In-flight transports are not aborted. A read resolving undefined rejects rather than installing successful data.
- Loader replacement supersedes the data value from an older successful in-flight read. An older failed read can still publish error status after replacement. Replacement is cache state, not persisted data or cancellation.
- Provider defaults to browser connectivity/focus signals; a custom structural environment port can replace them. Offline reads wait until online and report isFetching false while paused. Reconnection resumes paused reads and reloads stale enabled reads; failures are not automatically retried. Mutation run is invoked directly and is not queued by this connectivity mechanism.
- Mutation status tracks the newest invocation. `reset()` advances its generation and returns status to idle; an older success can still invalidate keys. Concurrent mutations are not serialized by the mutation hook.
- `useSerialWrites` executes each lane's tasks in invocation order, one at a time. Rejection releases the lane. Different keys and the default lane proceed independently. Queued tasks continue after unmount; tasks are not deduplicated, cancelled or persisted by the queue.
- `useSettlementGeneration` returns a stable handle; every `next()` increments a counter and `isCurrent({generation})` checks equality. It does not abort work or automatically mark unmount stale.
- `useAsyncAction` reports saving/error, swallows action rejection after formatting it, and keeps `AbortError` silent. It supplies no lock or generation guard; callers must coordinate overlapping calls.
- Retry uses the injected unreachable predicate only. Default waits are 1, 2, 4, 8, 15 and 30 seconds: up to seven load attempts, with a final unclassified attempt after the six waits. Abort stops an outstanding default wait; it does not cancel the caller's request or pre-check the signal before loading.

Evidence: `src/features/panel-kit/fetch-query/{cache.ts,adapter.react.tsx,__tests__/fetch-query.test.tsx}` and the panel hook/helper source and tests.

## UI guards and defaults

- `hasPermission` accepts exact grants or the literal `*`; it does not parse hierarchical wildcard grants.
- Dirty guard compares `JSON.stringify(current)` with original, including key order. Null original is clean. Dirty state installs `beforeunload`; caller navigation must invoke `confirmLeave`. Non-JSON values/cycles are outside its input contract.
- Focus trap handles Tab/Shift+Tab for the most recently activated container. Disabled, hidden, inert and CSS-hidden descendants are excluded. Cleanup resumes the outer trap. It neither sets initial focus nor restores focus; an empty container is not forcibly focused.
- Select is controlled by `value` and `onChange`; opening/closing/search/highlight are local. It portals outside clipping ancestors, uses a listbox and closes when its trigger leaves view. Disabled inputs cannot open it. Caller `t` takes precedence over `translate`, then source copy.
- SeeMore defaults to two lines; its hook rounds and clamps finite counts to a positive integer. It does not validate NaN/Infinity. Measured overflow greater than one pixel gets an expand/collapse control; while expanded, the previous overflow result is retained until collapse. The hook observes resizing where available.
- ComingSoonPanel keeps children mounted inside an inert subtree. Inert prevents user interaction; it does not stop child effects or backend requests.
- ImagePreviewModal is controlled by `open`; close/cancel/backdrop interactions notify `onClose`. The native dialog owns modal behavior. Caller owns image alt text and close copy.
- TabbedDialog defaults to modal when `onClose` exists, inline otherwise. Active tab may be controlled; panels and extra chrome are caller slots. Fullscreen defaults enabled, welcome/collapsed/fullscreen state defaults false. Escape calls the optional close callback; absent callback means no dismissal action. Only the active panel is rendered.

Evidence: admin-widget source/tests and `src/features/tabbed-dialog/react/{components/TabbedDialog.tsx,hooks/useTabbedDialog.ts}`.

## Framework-free rules and host outcomes

- Endpoint policy allows HTTP/HTTPS and loopback model servers, rejects malformed/scheme-disallowed and blocked literal private/network hosts. This synchronous policy does not resolve DNS or guard the actual connection; a host must enforce its outbound policy where requests are sent.
- `randomUUID` prefers native Web Crypto UUID, then `getRandomValues` v4 generation, then Math.random v4-shaped identifiers. It does not guarantee cryptographic entropy in the last tier; confirmation tokens use a separate fail-closed source.
- Execution detection rejects transport failure; resolved empty detection means no agents found. Connection/agent tests may resolve `{ok:false}` for a reached but rejected domain outcome; unavailable tests reject. Optional port methods determine available controls.
- Project-location folder cancellation resolves null; saves replace the non-built-in set and return authoritative locations. Skills writes reject failure; updating a built-in may return a user-owned shadow with a different id.
- Media provider reads distinguish null (unreachable) from `{}` (reachable, empty). Whole-map saves must not overlap; payloads are built when sent. No revision precondition is present in that port.
- Source-config actions derive capabilities from optional port method presence. The package imposes no universal schema or route vocabulary on source items.
- Memory ports have domain-specific null/boolean outcomes. Entry null is a genuine not-found on reads; malformed successful adapter envelopes reject instead of becoming empty data. Consumer adapters must preserve these distinctions.

Evidence: `src/utils/{endpoint-policy.ts,uuid.ts}`, feature `ports.ts` contracts and their rules/dependencies/tests.

## Localization and theming

- Root i18n is uncontrolled: initialLocale is read once. Otherwise browser initialization tries supported stored locale, supported system result, then fallback (`en` by default). Without window, initialization returns fallback. Later external locale changes require calling `setLocale` or remounting.
- Translation lookup is active dictionary, fallback dictionary, then source key; interpolation retains missing placeholders. No provider gives an English passthrough context and a no-op setter. By default the provider writes document lang/dir; default RTL list is ar/fa/he/ur. Those document attributes are not restored on unmount.
- Dictionary translators use own-property lookup: feature copy, common copy, source key. `pickPlural` uses one only for count exactly 1. Split-on-placeholders processes tokens in caller order.
- Theme validation occurs before DOM/font effects. Both palettes must include exactly ten declared color keys; values must be accepted concrete colors, not var/url expressions. Density is finite 0.5–2, radius a nonnegative supported CSS length, font stylesheet list at most 16 entries of at most 4096 characters.
- Theme application writes palette/font/radius/density variables and theme name only to the injected target. It shares font stylesheet leases per document, deduplicates URLs and preserves pre-existing links. Cleanup restores prior values/priority/name and removes only owned unleased links; cleanup is idempotent. Concurrent applications to the same target need caller-owned disposal order.
- Resolving explicit light/dark needs no media port. System requires injected matchMedia; resolution is a snapshot, not a subscription. Applying a theme does not choose or persist a scheme.

Evidence: i18n context/locale, panel translator helpers, and `src/theme/` source/tests.

## MCP resources, confirmation and hosting

- Builders emit `text/html;profile=mcp-app` inline UI resources. Parsing also accepts text/html and text/html+skybridge, returning undefined for unsupported or malformed input. Tool results put model-readable text before the UI resource; caller metadata can override generated resource metadata.
- Confirmation-store tokens are single use, five-minute TTL by default, and bound to exact key sets, value types and values. Redemption deletes before expiry/binding checks; mismatch burns the token. Unknown, expired and replay share `unknown-or-expired`. Mint copies binding. Default tokens use 32 Web Crypto random bytes; no Math.random fallback. Optional digest affects storage keys only.
- Secrets belong only in human-rendered HTML. Store/builders cannot prevent a caller putting them into model text, URI, metadata, diagnostics or logs. Tool execution and redeem-before-side-effect remain host obligations.
- Confirmation affirmative actions have a 1500ms visible dwell gate, restarted on visibility changes; cancel is not affirmative. Buttons and choice changes require browser-trusted events; synthetic clicks/changes are ignored. Alternatives cannot duplicate each other or reserved confirm/cancel ids; choices cannot duplicate ids or overwrite the selected-choices parameter. The generated surface disables actions during execution; ordinary failure permits retry, while `SURFACE_NOT_PENDING` marks expiry and keeps controls disabled.
- Generated surfaces escape ordinary text/attributes and serialized JS values; field names must match the document module's safe-name pattern. Low-level bodyHtml/script/extraCss/token overrides are trusted consumer inputs, not an HTML sanitizer.
- The current React host needs a proxy URL. It considers the first size report ready, times out after 4000ms by default, and cannot observe the underlying client's teardown acknowledgment (`null` always). Missing executor rejects tools; missing open-link handler returns refusal. Executor results are not validated by this wrapper.
- Host timeout/error/teardown does not add application authorization or automatically cancel executor promises. Underlying client owns transport/handshake mechanics. Late size reports update size but do not recover a settled timeout/error state.
- Early-message buffer defaults to 200 backlog messages; oldest is evicted when full. With subscribers it broadcasts a snapshot in registration order; first subscription drains the backlog in arrival order. Subscribers own source filtering; it is not the current AppRenderer transport.

Evidence: `src/features/mcp-ui/` source/tests and `src/react/mcp-ui/useMcpUiHost.ts` and tests.

## Interactive UI, A2UI and artifacts

- Registry lookup uses exact id/capability strings and preserves registration order. `register` returns a new registry, removes earlier same-id entries, then appends replacement; it can change preference order. Constructor/list retain the supplied array reference; readonly is a type contract, not a frozen snapshot.
- Default interactive/manifests order prefers shadcn table over native table, followed by six shadcn primitives and three charts (eleven entries total). Reading manifests does not mount React; a registry alone does not validate arbitrary component props.
- Registry-to-A2UI catalog merges base components, then registry ids (registry wins collisions); function map comes from base or is empty. Each registry entry uses its own props schema and container hint. Interpreter clock and ids are caller ports.
- A2UI rendering implements Text, Column, Row, Card and Button, then exact registry ids. Missing nodes/cycles/unknown types/template child lists render placeholders. Basic Button actions call interpreter.buildAction, but this component does not send its returned agent message. Registry feedback is wired only through onRowClick, not a universal onAction/onChange mapping.
- The surface hook subscribes to all interpreter notifications but uses the root object's identity as its snapshot. Updates confined to descendants or data model may not re-render a mounted tree if root identity stays equal; no blanket reactive-update guarantee applies.
- Artifact registry requires an explicit manifest; it does not infer one from extension. First accepting renderer wins. Register returns a new registry with replacement appended. ArtifactView slots are selected by renderer id.
- Srcdoc builder wraps fragments and adds title sanitization, CSP (unless disabled), optional base, storage shim, optional focus guard, ordered host bridges and activation listener. Lazy mode returns only the transport shell. Default artifact CSP permits network resources/connect/frame access; it is not an offline guarantee.
- Host iframe sandbox omits allow-same-origin. String-only insertion aliases and DOMParser-fallback helpers deliberately differ for headless fragments. Lazy activation requires content, inline/lazy mode, shell-ready and changed content; it is a decision helper, not a sender.

Evidence: interactive registries/manifests, A2UI adapter/renderer/hook/tests, renderer registry/srcdoc/source tests.

## Deliberately outside this contract

No application shell/router, backend authorization, tool allowlist, global credential store, schedule runner, native file access, revision database, translation service, persistence backend, automatic action-message transport, blanket XSS sanitization for raw HTML, or universal accessibility certification is supplied. Editor callbacks report edits; consumers decide what becomes saved content. Limits and error recovery remain module-specific.

Decision rationale: [Reusable navigation hooks own state while the host owns effects](../decisions/DR-001-state-hooks-effect-ownership.md).

## Browser request deadlines

Memory REST ports, font-manifest loading and diagnostics export use the host-supplied fetch when present. Their browser deadline composes AbortSignal.timeout with an existing signal through AbortSignal.any. Native fetch rejection/abort reasons propagate; these paths no longer import the Node platform timeout wrapper.
