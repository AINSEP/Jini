# `@jini/ui` — provenance

Origin: `foundry/integrations/open-design/reference/web-src-directories/` (vendored
snapshot of OD's `apps/web/src/{runtime,providers,state,lib,media,analytics,
styles,i18n,observability,utils}`), per `foundry/docs/jini-port/ui-extraction-plan.md`
and `foundry/docs/jini-port/recon/r4-webui.md`.

If you are adding a new section to this file, append it below rather than
rewriting the whole document — multiple tasks land content here in parallel
and a merge conflict on this file is expected and fine (the Coordinator
reconciles it).

---

## Section: i18n/observability/utils sweep (2026-07-16)

Scope: `web-src-directories/{i18n,observability,utils}/` per the Programmer
dispatch for this task (read-only source; real consumer check done against
`foundry/integrations/open-design/reference/components-original/`, falling back to
`foundry/integrations/open-design/reference/od-web-src.orig/` where a consumer
wasn't in the smaller snapshot). Covers this porting task only — see
`foundry/docs/jini-port/ui-extraction-plan.md` for the separate components/
features-bucket work (not touched here), and the next section below for the
parallel runtime/providers/state/lib/media/analytics/styles sweep.

### i18n (`src/features/i18n/`)

Ported the *mechanism*, not OD's translated copy. `i18n/content.<locale>.ts`
(19 files) and `i18n/content.ts`/`plugin-content.ts`/`runErrors.ts` were
**not** ported — they're OD's actual product strings, explicitly out of
scope per the task brief.

No `ports.ts`/`dependencies.ts` ceremony here (unlike the vertical-slice
features): the whole "port" *is* the React context + two small pure
functions it depends on. Splitting `locale.ts` (framework-free) from
`context.tsx` (the React bits) gave the priority-chain algorithm
(`resolveSystemLocale`/`detectInitialLocale`) a direct unit-test seam
without needing a mounted tree — that seemed like a better fit for this
package's existing "ports for injectable behavior" spirit than inventing a
`ports.ts` for a single-callback-shaped dependency.

| Jini file | Origin file(s) | What changed / was dropped |
|---|---|---|
| `src/features/i18n/types.ts` | `i18n/types.ts` (part) | Kept the *shape* only: `Locale` is now a plain `string` (was a fixed 19-tag union), `TranslationDict` is now a generic `{ [key: string]: string }` index type (was `Dict`, a ~1,400-named-key interface listing every OD product string). `LOCALES`/`LOCALE_LABEL` arrays (OD's specific supported-locale list + display names) dropped entirely — a host now supplies its own locale set via the `dictionaries` prop's keys. |
| `src/features/i18n/locale.ts` | `i18n/index.tsx` (`resolveSystemLocale`, `detectInitialLocale`) | `resolveSystemLocale` ported with its exact-match / Chinese-script-special-case / base-language-match priority chain, but now takes `supportedLocales` as a parameter instead of closing over the hard-coded `LOCALES` array (and the Chinese special-case now checks the candidate is actually in the host's supported set before returning it — the origin didn't need to, since `LOCALES` always contained both `zh-CN`/`zh-TW`). `detectInitialLocale` ported the priority chain (persisted > system-detected > fallback) but as an explicit options object (`supportedLocales`, `fallbackLocale`, `persistence`, `detectSystemLocale`) rather than reading module-level constants; see "Dropped: manual-vs-auto-detected tagging" below. |
| `src/features/i18n/context.tsx` | `i18n/index.tsx` (`I18nProvider`, `useI18n`, `useT`) | `DICTS` (the 19 imported locale modules) replaced by a `dictionaries` prop — the host passes its own `Record<Locale, D>`. `LS_KEY`/`LS_SOURCE_KEY`/`MANUAL_LOCALE_SOURCE` (OD's `'open-design:locale'` localStorage keys — product-identity strings) replaced by an injected `LocalePersistencePort` (`getStoredLocale`/`setStoredLocale`); omitting it means session-only locale state, no persistence at all. `readDesktopHostOsLocale()` (imported `getOpenDesignHost` from OD's desktop-host bridge package) dropped entirely — replaced by an optional `detectSystemLocale` prop a host supplies for the same "read the real OS locale on a packaged desktop shell" need; default detector is a plain `navigator.languages` check. `RTL_LOCALES` (hard-coded `['ar', 'fa']`) is now `rtlLocales` with a slightly larger built-in default (`['ar', 'fa', 'he', 'ur']`) and is host-overridable. `useI18n()`'s no-provider fallback and `I18nProvider` with no `dictionaries` at all now behave identically (both fall through every lookup to the raw key) via one shared `interpolate()` helper, rather than duplicating the interpolation regex in two places as the origin did. |
| `src/features/i18n/index.ts` | *(new — barrel)* | Re-exports `types`/`locale`/`context`. |

#### Dropped: manual-vs-auto-detected locale tagging

Origin's `detectInitialLocale` tagged every `localStorage` write with a
`'manual'` source marker so only a deliberate "change language" action could
out-rank a freshly-read OS locale on next launch — an auto-detected pick
never got to pin the app. That's real product UX policy, not generic
mechanism, so it's not reproduced here. A host that wants the same guarantee
implements it inside its own `LocalePersistencePort` (e.g. only call
`setStoredLocale` from an explicit user action, never from the initial
detection path).

### Observability (`src/features/observability/`)

All 8 origin files were checked for actual imports before assuming
genericity, per the task brief. Every one of them imports exactly one
thing beyond browser/DOM globals: `reportSafetyEvent` from OD's
`analytics/error-tracking.ts` (a PostHog-backed transport with consent-bypass
buffering). That's the single seam that needed genericizing — replaced
everywhere with an injectable `SafetyEventReporter` callback (`ports.ts`),
defaulting to a no-op, same "context/callback + host-injected adapter"
shape as the i18n feature and the analytics-adapter pattern already
documented in `foundry/docs/jini-port/recon/r4-webui.md` §5c.

Beyond that one shared seam, each file's own genericity read as claimed in
the task brief (boot timing / white-screen / stuck-run / long-task do read
as generic perf monitoring) — with two exceptions found on the closer read
required by the brief:

| Jini file | Origin file | What changed |
|---|---|---|
| `ports.ts` | *(new)* | `SafetyEventReporter` type + `noopSafetyEventReporter` default. |
| `boot-timing.ts` | `observability/boot-timing.ts` | Reporter now injected via `BootTimingOptions.reporter`. Dropped `detectNextRenderMode()`/`next_render_mode` field — it read a Next.js-specific `data-next-render` attribute, a framework coupling this package shouldn't assume for every host. Doc comment's PostHog-specific aside reworded to stay host-agnostic. |
| `long-task.ts` | `observability/long-task.ts` | Reporter injected; `MIN_DURATION_MS` (100) is now an overridable `minDurationMs` option. Logic otherwise verbatim. |
| `resource-error.ts` | `observability/resource-error.ts` | Reporter injected. Logic verbatim. |
| `visibility.ts` | `observability/visibility.ts` | Reporter injected. Logic verbatim. |
| `white-screen.ts` | `observability/white-screen.ts` | **Genericized the two hard-coded OD-specific markers**: `APP_MOUNTED_ATTR` (`'data-od-app-mounted'`) → configurable `mountedAttribute` (default `'data-app-mounted'`); `LOADING_SHELL_CLASSES` (`{'od-loading-shell'}`) → configurable `loadingShellClasses` (default `['app-loading-shell']`). Doc comment's literal `"Loading Open Design…"` sentinel-text example and the `#2527` PR reference dropped — reworded generically. Fallback root lookup (`document.getElementById('__next') ?? document.body`, a Next.js App-Router-specific id) is now `rootElementId` (optional, host-supplied) falling back straight to `document.body` when omitted, rather than assuming every host uses Next's `#__next`. |
| `iframe.ts` (renamed from `iframe-error.ts`) | `observability/iframe-error.ts` | **Genericized OD-domain fields.** `TrackIframeOptions.artifactId`/`projectId`/`conversationId` (OD's specific domain identifiers) replaced by a free-form `context?: Record<string, unknown>` bag merged into every emitted event — a host attaches whatever ids it has. `LOAD_TIMEOUT_MS` is now an overridable `timeoutMs` option. Reporter injected. |
| `stuck-run.ts` | `observability/stuck-run.ts` | Reporter now stored per-watched-run (set once in `trackRunStart`, reused by the later `trackRunProgress`/`trackRunTerminal` calls for that run — those two keep their original 1-positional-arg signatures since they don't need new configuration). `trackRunStart(runId, context = {})` → `trackRunStart(runId, options = {})` where `options.context` replaces the bare second positional arg and `options.reporter`/`options.stuckAfterMs` (was the module-level constant `STUCK_AFTER_MS`) are new. Doc comment's specific GitHub issue-number references (`#2464`/`#2405`/`#1451`) dropped — reworded to describe the generic symptom instead of citing OD's own issue tracker. `__resetStuckRunWatchdogForTests` kept (origin already exported this exact test-only escape hatch). |
| `install.ts` | `observability/install.ts` | `installWebObservability` now takes a `WebObservabilityOptions` bag (`reporter` applied to every sub-observer, plus per-observer nested option overrides) instead of taking no arguments. Still wires exactly the same 5 observers the origin did (boot timing, long task, resource error, visibility, white screen) and still deliberately excludes `iframe.ts`/`stuck-run.ts` — both need a call site (an iframe mount, a run lifecycle), matching the origin module's own boundary; this was not changed. |
| `index.ts` | *(new — barrel)* | Re-exports every module above. |

### Utils (`src/utils/`)

New slot on this package (README.md updated), per
`foundry/docs/jini-port/ui-extraction-plan.md`'s bucket-A note that this directory
doesn't exist yet and these are non-component pure/small-stateful helpers.
All 19 origin files were routed individually by checking real consumers via
`components-original/` (falling back to the fuller `od-web-src.orig/` tree
for 3 files whose consumers weren't in the smaller snapshot), not just
import-count — the same method the extraction plan used to catch
`composer-detail-position.ts` belonging to chat-composer rather than
generic UI.

#### Ported (7)

| Jini file | Origin file | Consumers checked | What changed |
|---|---|---|---|
| `file-system-errors.ts` | `utils/fileSystemErrors.ts` | `DesignFilesPanel.tsx`, `DesignSystemFlow.tsx` (OD-product today; zero type coupling — ships per the bucket-A "reusable logic before anyone outside OD uses it" note) | Verbatim. |
| `ime-composing.ts` | `utils/imeComposing.ts` | `BoardComposerPopover.tsx`, `PreviewDrawOverlay.tsx` (OD-product canvas/composer surfaces, but the concern — IME composition handling for any text input — is UI-generic and has zero domain-type coupling) | Verbatim. |
| `notifications.ts` | `utils/notifications.ts` | `SettingsDialog.tsx`, `ProjectView.tsx` | Genericized: `labelKey: keyof Dict` (OD's fixed dictionary type) widened to a plain `string`. Hard-coded `SERVICE_WORKER_URL = '/od-notifications-sw.js'` replaced by an optional `serviceWorkerUrl` option on `CompletionNotificationOpts` (omit to skip the service-worker path entirely). Hard-coded `tag = 'od-task-${status}'` (product-identity prefix) replaced by an optional `tagPrefix` option, defaulting to `'task'`. `SUCCESS_SOUNDS`/`FAILURE_SOUNDS` label keys reworded from OD's `settings.notifySound*` dot-paths to a package-neutral `notifications.sound.*` namespace (illustrative placeholder keys — a host supplies its own i18n dictionary entries for them, same as every other UI string). |
| `platform.ts` | `utils/platform.ts` | `ProjectView.tsx`, `AvatarMenu.tsx`, `FileWorkspace.tsx` | Verbatim. |
| `smooth-scroll-to-top.ts` | `utils/smoothScrollToTop.ts` | `EntryShell.tsx`, `HomeView.tsx` (OD-product; zero coupling) | Verbatim (only file renamed to kebab-case for this package's naming convention). |
| `uuid.ts` | `utils/uuid.ts` | `DesignSystemFlow.tsx`, `ProjectView.tsx`, `workspace/useConversationChat.ts` (OD-product + chat domain; but the generator itself has zero type/domain coupling — same "ship reusable logic early" reasoning as `smooth-scroll-to-top.ts`) | Verbatim logic; doc comment's product-identity example reworded generically. |
| `visual-stability.ts` | `utils/visualStability.ts` | `DesignFilesPanel.tsx`, `SettingsDialog.tsx`, `plugins-home/cards/{DesignSystemSurface,HtmlSurface}.tsx` | Genericized the hard-coded product-identity storage key (`'open-design:visual-stability'`) into a configurable `storageKey` parameter, defaulting to `'jini:visual-stability'`. |

#### Not ported — belongs elsewhere (10)

Real consumers are chat/composer/agent-runtime/BYOK domain, or the file is
itself an OD-product feature — per the task brief, these do **not** belong
in `@jini/ui` even though several read as "pure" in isolation.

| Origin file | Real consumers | Where it actually belongs |
|---|---|---|
| `utils/agentLabels.ts` | `AssistantMessage.tsx`, `ProjectView.tsx`, `workspace/useConversationChat.ts` | agent-runtime/chat-react (agent display-name mapping for chat messages); also hard-codes `'amr': 'Open Design'`, a product-identity string that would need stripping even if it were in scope. |
| `utils/apiProtocol.ts` | `InlineModelSwitcher.tsx`, `ProjectView.tsx`, `AvatarMenu.tsx` | agent-runtime/BYOK domain (imports `AppConfig`/`ApiProtocol` + a provider-compat helper). |
| `utils/byokProvider.ts` | `ProjectView.tsx`, `SettingsDialog.tsx` | `features/byok-config` — explicitly out of scope for this task. |
| `utils/chatTime.ts` | none found in either vendored snapshot (imports `ChatMessage` + i18n `Dict`, so likely consumed by a chat surface outside the vendored subset) | chat-core/chat-react (message-time formatting is chat-domain regardless of live-consumer count). |
| `utils/connectorBrandColor.ts` | `composer/MentionNode.ts` | `features/rich-text-input` — explicitly out of scope; also the exact file `ui-extraction-plan.md` already calls out as needing to become an injected `resolveMentionColor` prop rather than a direct import. |
| `utils/inlineMentions.ts` | `ChatComposer.tsx`, `HomeView.tsx`, `NewAutomationModal.tsx`, `HomeHero.tsx`, `composer/{LexicalComposerInput,serialize,deserialize,MentionNode}` | `features/rich-text-input` — explicitly out of scope; this is the `@mention` parsing engine the composer's Lexical editor depends on. |
| `utils/pluginInsertionTracking.ts` | none found in the vendored snapshot; own doc comment names `ChatComposer`'s `@`-mention popover as its caller | Same domain as `inlineMentions.ts` above (imports it directly) — `features/rich-text-input`, out of scope. |
| `utils/pluginRequiredInputs.ts` | `HomeView.tsx` | OD's plugin-input-validation system; imports `InputFieldSpec` from `@open-design/contracts` — a forbidden import, and the concept ("plugin required inputs") is OD-product-specific, not generic UI. |
| `utils/projectName.ts` | `EntryShell.tsx`, `ProjectView.tsx` | OD-product (auto-naming a design "Project" from a prompt, with CJK/English NLP heuristics tuned to OD's own design-tool verbs). Imports OD's `Project` type. |
| `utils/promptTemplateDsCategories.ts` | none found in either vendored snapshot | OD-product (maps a design-system's metadata to prompt-template gallery categories; imports OD's `DesignSystemSummary`). |
| `utils/visibleAgents.ts` | `McpClientSection.tsx`, `AgentPicker.tsx`, `InlineModelSwitcher.tsx`, `SettingsDialog.tsx`, `AvatarMenu.tsx` | agent-runtime/chat-react (agent-list filtering); imports OD's `AgentInfo` and hard-codes the `'byok-opencode'` agent id. |

#### Not ported — OD-specific / forbidden import (1, overlapping the table above)

| Origin file | Reason |
|---|---|
| `utils/pickAndImportError.ts` | Imports `OpenDesignHostProjectImportResult` from `@open-design/host` (forbidden import) and formats OD's desktop "Open folder failed" error flow — not a generic-UI concern, and not portable without the OD desktop-host type it's built around. |

(`utils/pluginRequiredInputs.ts` above also has a forbidden `@open-design/contracts` import, in addition to being OD-plugin-specific.)

### Dependencies added by this section

`@jini/ui` now depends on `react` (the i18n feature is a React context +
hooks) — the first `@jini/*` package to do so; the parallel
runtime/providers/state/lib/media/analytics/styles sweep below explicitly
deferred adding React for exactly this reason, so this section's i18n work
is what actually adds the toolchain. `react-dom`, `@testing-library/react`,
`@types/react`, `@types/react-dom`, and `jsdom` are dev-only, for tests. No
`@jini/*` package dependency, no OD product import — verified by grep
across `packages/ui/src/**` for `@open-design/*` specifiers and the
`Open Design`/`OD_`/`--od-stamp`/`/tmp/open-design` product-identity strings
(both clean; see Programmer handoff report for the exact commands run).

### Package scaffolding added by this section

- `packages/ui/tsconfig.json` — merged with the parallel sweep's version of
  this same new file: kept `"lib": ["ES2023", "DOM", "DOM.Iterable"]` from
  that section and added `"jsx": "react-jsx"` for this section's React
  content.
- `packages/ui/vitest.config.ts` + `packages/ui/vitest.setup.ts` (new) — jsdom
  test environment and a global `@testing-library/react` `cleanup()` after
  each test (needed once real component tests existed in this package).
- `packages/ui/package.json` — added `react` as a runtime dependency and the
  test-only React/DOM/testing-library dev dependencies described above.

### Not ported — out of task scope (unchanged from before this task)

`src/features/byok-config/`, `mcp-config/`, `rich-text-input/`,
`workspace-tabs/`, and the flat-group `src/react/components/` bucket (Icon.tsx,
Toast.tsx, etc.) from `foundry/docs/jini-port/ui-extraction-plan.md` are untouched —
explicitly out of scope per this task's brief.

---

## Section: runtime/providers/state/lib/media/analytics/styles sweep (2026-07-16)

Scope: fast reusability triage of the 7 directories above (~118 files) per
the Programmer dispatch for this task. Full per-file verdict table is in the
Programmer's handoff report, not duplicated here; this section only covers
what was actually ported.

### Ported

| Jini file | Origin | Transform |
|---|---|---|
| `src/utils/zip.ts` | `runtime/zip.ts` | Verbatim (already zero-dependency, zero OD refs) — minimal stored-mode ZIP encoder. Comment wording lightly reworded (dropped the OD-specific "Download as ZIP button" framing). |
| `src/utils/sse.ts` | `providers/sse.ts` | Verbatim logic (`parseSseFrame`) — already confirmed generic by `foundry/docs/jini-port/recon/r4-webui.md` §1c. Comment reworded to describe the generic transport-agnostic use (not OD's specific daemon SSE contract). |
| `src/utils/copy-to-clipboard.ts` | `lib/copy-to-clipboard.ts` | Verbatim. Dropped the comment's reference to OD's `FileViewer.tsx`/issue #451 provenance. |
| `src/utils/appearance.ts` | `state/appearance.ts` | Generified: dropped the `AppTheme` import from OD's `../types` (replaced with a local `AppearanceTheme = 'light' \| 'dark'` union — same two values the function actually branches on). `DEFAULT_ACCENT_COLOR` changed from OD's brand accent (`#c96442`) to a neutral default (`#2563eb`, previously the second swatch) since a shared package should not ship one consumer's brand color as the default; `#c96442` kept as a swatch option. Everything else (CSS custom-property names, `color-mix` formula, `normalizeAccentColor`/`resolveAccentColor`/`applyAppearanceToDocument` logic) is verbatim. |
| `src/utils/dom-subscriptions.ts` | `providers/dom/chat-pane.dom.ts` (`subscribeOutsideClickOrEscape`, `subscribeWindowEvent`, `subscribeVisibleFocusOrVisibilityChange`, `scheduleInterval`, `scheduleTimeout`, `openExternalUrl`, `getDocumentBody`) + `providers/dom/chat-composer.dom.ts` (`getViewportSize`) | Verbatim logic. These two origin files were headed "DOM bridges owned exclusively by the chat-pane/chat-composer slice," but the specific functions ported have zero chat/composer/pane-specific logic in their bodies (pure window/document event-subscription primitives) — re-verified against real usage before lifting, same check `foundry/docs/jini-port/ui-extraction-plan.md`'s §A footnotes call out for `composer-detail-position.ts` etc. Functions left behind in the origin files (`readComposerDraft`/`writeComposerDraft`, `openDesignSystemPickerTrigger`, `subscribeComposerPortalRect`, `subscribeComposerLayerHeight`) are domain-specific (composer draft persistence, a composer-specific trigger selector, composer/pane rect-tracking tied to layout assumptions) and were left for `@jini/chat-react`. |

All five files have real unit tests (`*.test.ts` alongside each). None of
`copyToClipboard`/`applyAppearanceToDocument`/`dom-subscriptions.ts` had a
jsdom/happy-dom test environment available in this repo yet (no `jsdom` or
`happy-dom` package installed, no `vitest.config.ts` at the repo root or in
this package) — tests stub the specific `window`/`document`/`navigator`
surface each function touches by hand via `vi.stubGlobal` rather than adding
a new devDependency mid-task. `packages/ui/tsconfig.json` was created
(previously missing) with `lib: ["ES2023", "DOM", "DOM.Iterable"]` added on
top of the repo's `tsconfig.base.json` so these DOM-touching utilities
typecheck.

### Explicitly not ported (belongs elsewhere or not reusable)

See the Programmer handoff report's full per-file table for the complete
list (~110 files). Summary of the routing decisions:

- **`@jini/chat-react` / `@jini/agent-runtime` territory** (chat/tool/model
  domain, not generic UI): `runtime/{markdown.tsx, shiki.ts, file-ops.ts,
  chat-events.ts (already resolved as not-portable in
  `packages/chat-core/source-map.md`), resume.ts, in-project-link.ts,
  browser-action-executor.ts, design-toolbox.ts}`, `providers/{daemon.ts
  (already known — see r4), anthropic*.ts, *-compatible.ts, api-proxy.ts,
  connection-test.ts, provider-models.ts, elevenlabs-voices.ts}`,
  `providers/dom/{chat-composer.dom.ts, chat-pane.dom.ts}`'s remaining
  domain-specific functions (see table above).
- **`@jini/renderers-react` territory** (artifact/preview rendering):
  `runtime/{srcdoc.ts (deferred, confirmed still present at 2,881 lines —
  not touched), react-component.ts, exports.ts, jsx-module-refs.ts}`,
  `lib/use-deck-preview-scale.ts`.
- **`features/byok-config` territory** (out of scope this task, owned by
  another task per the dispatch brief): `state/apiProtocols.ts` is the exact
  OD-specific data (`SUGGESTED_MODELS_BY_PROTOCOL`, `API_KEY_PLACEHOLDERS`,
  etc.) `foundry/docs/jini-port/ui-extraction-plan.md` §B already flags as the
  residue a `ProviderCatalogPort` needs to abstract away; `lib/
  resolve-finalize-request.ts` and `providers/connection-test.ts`/
  `provider-models.ts` are the BYOK finalize/connection-test transport this
  feature's `dependencies.ts` would bind to.
- **`features/mcp-config` territory** (out of scope this task, owned by
  another task): `state/mcp.ts` is the daemon transport (`fetchMcpServers`,
  `saveMcpServers`, MCP OAuth flow) that feature's `dependencies.ts` should
  bind to once that slice is built. Not ported here per the dispatch brief's
  explicit instruction to only note this, not build the slice.
- **Not reusable — OD product-specific** (brand kit, decks/presenter, AMR
  billing, plugins, onboarding, media-provider catalogs, analytics/PostHog
  wiring, project/workspace state): the remainder of `runtime/`
  (amr-*, brand-*, deck-thumbnail-parser.ts, design-kit.ts,
  design-md-parse.ts, design-system-package-audit.ts, kit-*.ts,
  plugin-source.ts, powered-preview.ts, slide-nav.ts, speaker-notes.ts,
  useBrand*.ts), `providers/{registry.ts, project-events.ts}` (already
  flagged OD-specific by r4), all of `state/` except `appearance.ts`
  (`apiProtocols.ts` routed above; `config.ts`, `libraryHandoff.ts`,
  `maxTokens.ts`, `onboarding-profile.ts`, `project-locations.ts`,
  `projects.ts`, `workspace.ts`, `litellm-models.json`), all of `media/`
  (OD's media-generation model registry, daemon-paired), all of `analytics/`
  (every file couples to `@open-design/contracts/analytics` and/or
  `posthog-js`; the host-supplied-tracker *pattern* is a design decision for
  a future `@jini/chat-react` analytics context, not a file to port), and
  the rest of `lib/` (`whats-new.ts`, `build-continue-in-cli-toast.ts`,
  `build-clipboard-prompt.ts`, `parse-provenance.ts`, `pod-members.ts`,
  `updater.ts`).
- **Deferred, not a rejection**: `lib/use-stable-handler.ts`
  (`useStableHandler`) is a genuinely generic React hook (zero OD imports)
  but this package had no React dependency wired up yet at the time of this
  section's work (`packages/ui/package.json` had none before this task, and
  no other `@jini/*` package in this repo depended on `react` yet either) —
  porting one hook was not enough justification to add the first React/JSX
  toolchain wiring as a side effect of a file-triage task. The parallel
  i18n/observability/utils section above did add that wiring for its own
  context+hooks work; `use-stable-handler.ts` itself is still not ported —
  left for whichever task next needs it for real.
- **`styles/` — human decision needed, not touched**: this task only ports
  `.ts`/`.tsx`. `styles/tokens.css`, `styles/primitives.css`, and
  `styles/base.css` read as genuinely generic design tokens/resets (color
  vars, button/form primitives, box-sizing reset) worth a human look for a
  future design-tokens package; everything else (`chat.css`,
  `design-system-flow.css`, `shell.css`, `entrance.css`,
  `social-share.css`, `modal-window-drag.css`, `plan-badge.css`, and the
  `home/`, `viewer/`, `workspace/`, `remixicon/` subdirectories) is
  OD-product-specific by name and content.

### Dependencies

None beyond the TypeScript standard library + DOM lib types
(`packages/ui/tsconfig.json` adds `"DOM"`/`"DOM.Iterable"` to the base
`lib` list). No `@open-design/*` specifier, no `Open Design`/`OD_`/
`--od-stamp`/`/tmp/open-design` product-identity string — verified by grep
across `packages/ui/src/**`.

---

## Section: ui-extraction-plan.md §A — flat-group items (2026-07-17)

Scope: `foundry/docs/jini-port/ui-extraction-plan.md` section A only (13 components,
1 hook, 3 utils). Run via a cloud routine, testing whether frontend/component
porting (as opposed to prior backend-milestone cloud runs) works through this
mechanism — see the honesty note at the end of this section for what that
surfaced.

This is the **first real content in `packages/ui/src/react/components/` and
`src/hooks/`**, and the first task to add `react`/`react-dom` as real
dependencies of this package (`peerDependencies` + `devDependencies` for
building/testing within the package itself; `@types/react`, `@types/react-dom`,
`@testing-library/react`, `@testing-library/user-event`, and `jsdom` were
added as devDependencies for component tests). `packages/ui/tsconfig.json`
gained `"jsx": "react-jsx"`. A new `src/utils/` slot was added per the plan
(components/ and hooks/ already existed from the prior utility-layer task).

### Ported verbatim (or near-verbatim, cosmetic only)

| Jini file | Origin | Transform |
|---|---|---|
| `src/react/components/Icon.tsx` | `Icon.tsx` | Verbatim. 849-line pure `name -> <svg>` switch, zero deps, zero OD references — the pattern-setter for this bucket per the plan. |
| `src/react/components/RemixIcon.tsx` | `RemixIcon.tsx` | Verbatim. |
| `src/react/components/AgentIcon.tsx` | `AgentIcon.tsx` | Verified generic per the plan's flag: the `ICON_EXT`/`MONO_ICONS` tables are coding-agent-CLI brand ids (claude, codex, gemini, aider, devin, …), not an OD product list. Added an optional `basePath` prop (default `/agent-icons`, matching the origin's hardcoded path) so a host can serve assets from elsewhere — the one behavioral addition in this row. |
| `src/react/components/Loading.tsx` | `Loading.tsx` | Verbatim logic. `DesignCardSkeleton`'s doc comment dropped its "DesignsTab grid" framing (an OD feature name) since the shape itself — thumbnail over meta lines — is a generic card-loading pattern; CSS class names (`design-card`, `skeleton-block`, …) are left as-is since they read as generic content-shape names, not product identity. |
| `src/react/components/PaletteTweaks.tsx` | `PaletteTweaks.tsx` | **Verified dead code**: re-ran the plan's zero-fan-in check with a fresh grep across `components-original/` — still zero real consumers. Shipped anyway per the routine's instruction (small, self-contained, correct); flagged explicitly with an inline `NOTE` comment rather than silently presented as a normal port. |
| `src/utils/auto-open-file.ts` | `auto-open-file.ts` | Verbatim logic. Comment wording lightly reworded to drop OD-specific framing (dropped a reference to a specific internal source file path). |
| `src/hooks/useInView.ts` | `plugins-home/useInView.ts` | Verbatim. |

### Ported with generification beyond the plan's own notes

The plan flagged `CustomSelect`/`PaletteTweaks` (dead-code) and named the
KitErrorBoundary/LanguageMenu adjustments explicitly; everything else in its
table was implicitly "mechanical move." Reading each file surfaced more OD
coupling than the plan's one-line "Verify before porting" column called out —
consistent with the plan's own warning elsewhere to keep checking real
consumers/content, not just trust the classification. Recorded here in full
rather than glossed over:

| Jini file | Origin | What was OD-specific, and what changed |
|---|---|---|
| `src/react/components/Toast.tsx` | `Toast.tsx` | Logic verbatim. CSS class hooks renamed `od-toast*` → `jini-toast*` — not on the AGENTS.md banned-string list (that's `OD_`/`Open Design` literal, not lowercase `od-`), but `od-` unmistakably reads as an Open-Design-branded class prefix in a package whose whole mandate is product-neutral, so renamed for genuine (not just regex-clean) neutrality. |
| `src/react/components/TooltipLayer.tsx` | `TooltipLayer.tsx` | Same `od-tooltip*` → `jini-tooltip*` rename (trigger class, layer class, the suppressed-native-title data attribute). This component reads a cross-component contract (`.jini-tooltip[data-tooltip]`), so `AppChromeHeader.tsx` below was updated to emit the new class name to keep the contract intact. |
| `src/react/components/CustomSelect.tsx` | `CustomSelect.tsx` | **Verified dead code** (see above) — shipped anyway, flagged with an inline `NOTE` comment. Same `od-select*` → `jini-select*` rename as Toast/TooltipLayer. |
| `src/react/components/KitErrorBoundary.tsx` | `KitErrorBoundary.tsx` + `.module.css` | Per the routine's explicit instruction: swapped the concrete `reportHandledException` analytics import for an injected `onError` callback prop, defaulting to a no-op. Also dropped: the `useT()` i18n hook (this package has no i18n system; `title`/`retryLabel` are now plain-English string props with defaults) and the `.module.css` import (this package has no CSS-module-aware build step yet — flattened to plain `jini-kit-error*` class names, same as every other component in this batch; the underlying visual CSS itself was not ported, consistent with Toast/CustomSelect/TooltipLayer not shipping CSS either). |
| `src/react/components/LanguageMenu.tsx` | `LanguageMenu.tsx` | Per the routine's explicit instruction: `LOCALES`/`LOCALE_LABEL` are now a `locales: LocaleOption[]` prop instead of a hardcoded import. Also dropped: OD's `useI18n()` context (replaced with `locale`/`onLocaleChange` props — the component is now fully controlled) and the `motion/react` (Framer Motion) animation — the origin's `popoverIn`/`staggerContainer`/`listItem` variants live in OD's own `../motion` module and pulling in a whole animation library as a transitive dependency for one menu's open/close felt like scope creep for a single flat-group item; replaced with a plain conditional-render (open/close is instant, no exit animation) and left animation as something a host's own CSS can add via the popover's className. |
| `src/react/components/WorkingDirPicker.tsx` | `WorkingDirPicker.tsx` + `.module.css` | Dropped `useT()` (replaced with a `labels` prop, spread over English defaults) and the `.module.css` import (flattened to plain `jini-working-dir-*` class names, same rationale as KitErrorBoundary — no CSS-module build step in this package yet, and no CSS shipped). Doc comments' references to "the Home composer" / "the in-project composer" (OD's specific two call sites) reworded to describe the shape generically. |
| `src/react/components/AppChromeHeader.tsx` | `AppChromeHeader.tsx` | Dropped `useT()` — `backLabel` already existed as an overridable prop in the origin, just widened its default from a translated string to a plain-English literal (`'Back'`). Updated its `od-tooltip` trigger class to `jini-tooltip`, matching the `TooltipLayer.tsx` rename above so the two still work together. |
| `src/react/components/ExportDiagnosticsButton.tsx` | `ExportDiagnosticsButton.tsx` | The largest single deviation in this batch. The origin declared a **global `Window.openDesignDesktop`** API (an Electron contextBridge binding) and hardcoded `DIAGNOSTICS_FILENAME_PREFIX = 'open-design-diagnostics'` — both unmistakably product identity, even though neither string matches the AGENTS.md banned-list regex literally (`openDesignDesktop` isn't `OD_`; `open-design-diagnostics` isn't `Open Design` with a space). Read closely, this file is exactly the kind of component the plan's own footnote warns about — "these turn out narrower than they look on a closer read" — just not one the plan's per-file table had flagged. Generified: the global was replaced with an injected `desktopBridge?: DesktopExportBridge` prop (same shape, now caller-supplied instead of read off `window`); `filenamePrefix` and `exportPath` (was hardcoded `/api/diagnostics/export`) are now props with generic defaults (`'diagnostics'`, same path kept as the default since it's a reasonable convention, not a product name). Dropped `useT()` for a `labels` prop. Renamed the exported component from `ExportDiagnosticsRow` to `ExportDiagnosticsButton` to match the plan's target filename. |
| `src/utils/localized-url.ts` | `enterpriseUrl.ts` | **Not a mechanical move — the biggest finding of this task.** The origin hardcoded OD's actual marketing domain (`https://open-design.ai`, plus a `127.0.0.1:17574` local-dev-server special case) and OD's own locale-to-landing-page-segment table. That's not reusable logic sitting next to OD-only consumers (which is what the plan's footnote anticipated for this file) — it's OD's own marketing URL, full stop, and doesn't belong in a product-neutral engine package even unported-but-dormant. What's actually generic is the *algorithm* (resolve locale → URL segment, falling back to the base's default language), so that's what was kept: `buildLocalizedUrl(locale, { baseUrl, localeSegments })` takes both the base URL and the segment table as caller-supplied arguments. Renamed the file since `enterpriseUrl` names an OD feature ("the enterprise landing page") that no longer exists in this version. |
| `src/utils/markdown-scroll-sync.ts` | `markdown-scroll-sync.ts` | Logic verbatim (this was already generic — no OD coupling found). Added `micromark`/`micromark-extension-gfm` as real (non-dev) dependencies since `extractMarkdownBlockLines` needs them at runtime. One small generification: `measurePreviewBlockOffsets` took a hardcoded `.markdown-rendered` selector for the preview root; added it as an optional `previewSelector` parameter (same default) so a host isn't forced into that exact class name. |

### Component tests

Every component and the hook got real interaction tests via
`@testing-library/react` + `@testing-library/user-event` (jsdom), not just
render smoke tests, for anything with actual state/logic: `CustomSelect`
(open/select/disabled/grouped/Escape), `Toast` (TTL auto-dismiss, code pins
open, stale-closure re-arm bug regression test), `KitErrorBoundary` (catch +
onError + retry), `LanguageMenu` (open/select/Escape), `WorkingDirPicker`
(pick/recent/clear/labels), `TooltipLayer` (show/hide/Escape/class-gating),
`PaletteTweaks` (select/deselect/hover-preview/Escape),
`ExportDiagnosticsButton` (desktop-bridge success/failure/cancel, HTTP
fallback with a mocked `fetch`), `AgentIcon` (known/mono/fallback paths),
`useInView` (mocked `IntersectionObserver`, once vs. continuous tracking, no-IO
fallback). `Icon`/`RemixIcon`/`AppChromeHeader`/`Loading` (purely
presentational) got lighter smoke-level tests. `auto-open-file.ts` and
`markdown-scroll-sync.ts`'s pure functions got thorough unit tests;
`localized-url.ts` got a handful of cases. `measureEditorBlockOffsets`/
`measurePreviewBlockOffsets` (DOM-measurement-heavy, need real layout) were
left untested — jsdom doesn't compute real box metrics, so a test would only
assert against jsdom's fixed zero-size stand-ins, not the actual algorithm.

Component tests need a jsdom DOM. This package's `vitest.config.ts` (shared
with the parallel i18n/observability porting task — see that section above)
sets `environment: 'jsdom'` package-wide since most of this package's tests
touch the DOM; the two tests that assert real *no*-DOM behavior
(`dom-subscriptions` SSR-safety, `zip`'s native-`Blob` reliance) opt back out
per-file via `// @vitest-environment node`. This task's own new test files
carry a redundant `// @vitest-environment jsdom` pragma (harmless alongside
the package default — they were written before the jsdom-vs-node reconciliation
above landed on `main`) rather than being cleaned up, to avoid re-touching 14
files for a no-op.

### Neutrality check

`grep -rn "Open Design\|OD_\|--od-stamp\|/tmp/open-design\|@open-design/"` across
every file in this section: clean (no matches). A second, stricter self-imposed
pass — `grep -rn "od-\|open-design\.ai\|openDesignDesktop"` (catching
lowercase-prefix and non-regex-exact product identity the literal banned list
wouldn't catch) — is also clean, after the `od-*` → `jini-*` class renames and
the `ExportDiagnosticsButton`/`localized-url` generification described above.

### Honesty note — running this kind of task as a cloud routine

Requested explicitly by the routine prompt, since this is the first cloud run
doing frontend/component porting rather than a backend milestone:

- The plan document's per-file "Verify before porting" column was accurate
  where it existed, but several files it marked with a bare `—` (implying
  "just move it") turned out to need real generification once actually read
  in full — `ExportDiagnosticsButton.tsx`'s global `window.openDesignDesktop`
  and `enterpriseUrl.ts`'s hardcoded `open-design.ai` domain being the two
  clearest examples. A plan written from a file-list + grep sweep (`r5`) is a
  good triage pass but is not a substitute for reading each file before
  porting it — this task budgeted time to do that and it paid off twice.
- Porting 13 React components pulled in `react`/`react-dom` as this package's
  first-ever framework dependency, plus a testing stack
  (`@testing-library/react`, `@testing-library/user-event`, `jsdom`) and a
  markdown-parsing dependency (`micromark`). None of that was flagged as
  necessary in the plan doc itself — it only becomes obvious once you look at
  what these specific files actually import. A cloud-routine prompt for
  component-porting work should expect to make (and should explicitly budget
  time for) real dependency/build-config decisions, not just file moves.
- jsdom-specific test failures were the main time sink, not the porting
  itself: (1) this task originally defaulted the package to Node and opted
  new component tests into jsdom per-file — reasonable in isolation, but a
  rebase onto `main` found the parallel i18n/observability task had landed
  the *opposite* choice first (package-wide `environment: 'jsdom'`, with the
  two SSR-safety tests opted back out via `// @vitest-environment node`, see
  its own `fix(ui): reconcile test-environment conflict` commit) — reconciled
  by adopting theirs, since more of this package's tests need jsdom than need
  raw Node, and it was already the precedent on `main`; (2)
  `@testing-library/react` needs an explicit `afterEach(cleanup)` wired
  through a setup file in this repo's vitest setup (no auto-detection without
  `test.globals: true`), or renders silently accumulate across tests in the
  same file; (3) jsdom's lack of real layout (`getBoundingClientRect` always
  zero) makes hover-dependent interaction tests (the working-directory
  picker's hover-opens-submenu behavior) behave differently than a real
  browser — `userEvent.click`'s simulated pointer travel can spuriously fire
  `mouseleave` on a hover-tracked ancestor. None of these are React-vs-Node
  issues, they're specifically about mixing DOM-dependent and DOM-free tests
  in one package and about component *interaction* testing (not just
  rendering) — worth calling out explicitly for whoever runs the next
  component-porting routine, since none of it was visible from the plan doc
  or from the prior (Node-only) utils-porting task's precedent.

---

## Section: `features/connectors/` — ConnectorsBrowser.tsx canary (2026-07-17)

Source: `foundry/integrations/open-design/reference/components-original/ConnectorsBrowser.tsx`
(1,573 lines) + the two pure helpers it imported from `EntryView.tsx`
(`isTrustedConnectorCallbackOrigin`, `sortConnectorsForSearch`/
`getConnectorSearchScore`/`sortConnectorsForDisplay`). Per
`foundry/docs/jini-port/god-components-extraction-plan.md` §0 — the canary for the
broader god-component extraction plan; several more components are queued
behind it pending how this one went. Per r6 §1.15: **FULL SLICE**, the
cleanest full-file candidate in the whole sweep — nearly the entire file is
a generic "OAuth integration marketplace" UI.

### What shipped — `packages/ui/src/features/connectors/`

| File | Contents |
|---|---|
| `types.ts` | Generic `Connector`/`ConnectorTool`/`ConnectorStatus`/`ConnectorActionResult`/`ConnectorAuthorizationPending(State)`/`ProviderTab` — stripped of `ConnectorDetail`/`ConnectorConnectResponse`/`ConnectorStatusResponse` verbatim shapes (Composio-specific fields dropped: no category-map dependency, `logoUrl` is host-resolved rather than Composio-CDN-derived). |
| `constants.ts` | Poll interval, tool-preview page size, storage key (`jini-connectors-authorization-pending`, renamed from `od-connectors-authorization-pending`), a `DEFAULT_PROVIDER_TABS` single-entry fallback. |
| `rules.ts` | All pure logic ported 1:1: connector/tool merging, authorization-pending prune/update, stale-authorization detection, status-change diffing, search scoring/sorting, origin-trust check, fallback-logo initials/palette hash, plus one **new** extraction born from the Phase 8.5 audit below (`scopeConnectorsToProvider`). |
| `ports.ts` | `ConnectorsPort` (fetchConnectors/fetchConnectorEnrichment/fetchConnectorStatuses/fetchConnectorDetail/connectConnector/disconnectConnector/cancelConnectorAuthorization/openExternalUrl), `ConnectorAuthPendingStoragePort`, `ConnectorAuthBridgePort`. |
| `dependencies.ts` | `createFakeConnectorsPort` — an in-memory test/demo double (per the canary's own instruction: ship a fake, not a real `providers/registry` call). `createBrowserConnectorAuthPendingStorage`/`createBrowserConnectorAuthBridge` are **real** SSR-guarded browser implementations (sessionStorage + postMessage/focus/visibility) — these two touch only generic browser APIs with no backend-specific shape, so shipping them for real (rather than faking them too) means a host only has to supply its own `data` port. |
| `hooks/useConnectorCatalog.ts` | Two-phase catalog load: always-on lightweight fetch + lazy `unlocked`-gated enrichment. |
| `hooks/useConnectorAuthorization.ts` | The concurrency-correctness core: auth-pending persistence, poll-while-pending, the OAuth postMessage/focus/pageshow/visibilitychange handshake, stale-authorization auto-cancel, connect/disconnect actions. Kept as one cohesive hook per the Phase 6 "one natural owning cluster" guidance — these pieces read/write the same `pending`/`cancelFailed`/`authError` state and would only fragment awkwardly if split further. |
| `hooks/useConnectorDetail.ts` | Detail-drawer open/close + paginated tool-preview hydration with retry-token-gated failure tracking. |
| `components/` | `ConnectorLogo` (initials-fallback + optional image, Composio-CDN slug logic dropped), `ProviderTabBar` (config-driven, `match`-predicate kept generic), `ConnectorSearchBar`, `ConnectorGate` (locked/gated state, href/copy now host-supplied instead of the hardcoded `app.composio.dev` link), `ConnectorAlertList`, `ConnectorCard`, `ConnectorGrid` (card grid + empty-state + gate composition), `ConnectorDetailDrawer` (modal detail drawer with paginated tool list). |
| `ConnectorsBrowser.tsx` | The orchestrator — composes the 3 hooks + `rules.ts` derivations, defaults `dependencies` to the fake double. |
| `index.ts` | Public barrel. |

### Dropped (per the canary plan)

- The ~90-entry Composio category→i18n label map (pure OD-specific data) — a
  host supplies `getCategoryLabel?: (category: string) => string`, default
  identity.
- `ConnectorLogo`'s Composio-CDN slug-construction logic
  (`composioLogoUrl`/`COMPOSIO_LOGO_SLUG_OVERRIDES`, a `/api/connectors/logos/*`
  daemon-proxied endpoint) — not called out by r6 as an exclusion, but is
  genuinely Composio-specific in the same way the category map is (another
  instance of the plan doc under-specifying what needs generifying once the
  file is actually read in full, consistent with the honesty note the prior
  i18n/utils task recorded). Kept the generic initials/palette-hash fallback,
  now taking a plain host-resolved `logoUrl` prop instead.
- `useResolvedTheme` (the `MutationObserver`/`matchMedia` `data-theme`
  auto-detection hook) — not in the canary's explicit "what ships" component
  list. `ConnectorLogo`/`ConnectorCard`/`ConnectorDetailDrawer` no longer take
  a theme at all (the logo is a single image, not theme-swapped); a host that
  wants theme-swapped logo URLs resolves that itself before handing
  `logoUrl` in.
- The i18n mechanism (`useT`/`Dict`) — OD's actual translated copy for this
  surface (~30 `connectors.*` keys) is product content, not the generic
  mechanism `@jini/ui`'s own `features/i18n` already ports. Replaced with
  plain English literals, matching how `constants.ts`/component defaults
  already work elsewhere in this package (e.g. `Toast.tsx`). A host wanting
  i18n wraps the rendered strings itself or forks the component text.
- `VisuallyHidden` (`@open-design/components`) — the single call site
  (a screen-reader-only `": "` separator in the alert list) was inlined as a
  local clip-rect style rather than standing up a new shared primitive for
  one use.
- `connectors-events.ts`'s cross-surface `CustomEvent` broadcast
  (`notifyConnectorsChanged`/`listenForConnectorsChanged`, used elsewhere in
  OD to refresh other tabs) — out of scope for this slice; replaced with a
  plain `onConnectorsChanged?: () => void` callback prop a host can wire to
  whatever cross-component signal it already has.
- `connectors-state.ts` was **not** ported as a file — `ConnectorsBrowser.tsx`
  only ever imported one function from it (`hasConnectorStatusChanges`,
  ported into `rules.ts`); its other exports (`mergeConnectorCatalog`,
  `fetchConnectorCatalogSnapshot`, an independently-diverged
  `applyConnectorStatuses`) belong to a different consumer (`EntryView.tsx`),
  not this canary.

### Phase 8.5 audit — what it caught

Ran the mandated audit (not just the "zero top-level functions" grep) across
every new file:

1. **Inline JSX callback props with real branching/multi-statement bodies**:
   found two 2-statement arrows in the orchestrator (`ProviderTabBar`'s
   `onSelect` combining an analytics callback + `setSelectedProvider`; the
   gate's `onClick` combining the same analytics callback + a host `onClick`)
   — extracted both into named `useCallback`s (`handleProviderTabSelect`,
   `handleGateClick`). A backdrop-click-to-close one-liner in
   `ConnectorDetailDrawer` (`if (e.target === e.currentTarget) onClose()`)
   was left inline — a single standard "click outside" DOM comparison, not
   business logic.
2. **`useMemo` bodies with multi-line derivations**: found one —
   `providerScopedConnectors`'s find-then-filter body in the orchestrator.
   Extracted to `rules.ts` as `scopeConnectorsToProvider` (now unit-tested in
   isolation); the orchestrator's `useMemo` is now a one-line call, matching
   the target end-state described in the audit instructions.
3. **Orphaned `useState`/`useRef`**: enumerated every one across all 18 new
   source files (listed by hand, not just grepped) — none found unassigned.
   The two state values that stayed in the orchestrator itself
   (`filter`, `selectedProvider`) are simple, single-owner UI state directly
   bound to one presentational component each; not extracted into their own
   hooks, on the judgment that doing so would be ceremony without payoff for
   a single string + a single pure derivation. Flagged here rather than
   silently decided, per the audit's own standard.

No other hidden logic found. `pnpm --filter @jini/ui run typecheck` was
re-run clean after each fix.

### Purity grep — reported explicitly per the task's own instructions

**Product-identity strings** (`Open Design`, `OD_`, `--od-stamp`,
`open-design.ai`, `openDesignDesktop`, `@open-design/`) across every new file
under `features/connectors/`: **clean, zero matches.**

**`window`/`document`/`fetch`/`EventSource`/`localStorage`/`sessionStorage`/
`XMLHttpRequest`/`WebSocket` used outside `dependencies.ts`**: one file, by
design — `components/ConnectorDetailDrawer.tsx` uses `document.addEventListener`
(Escape-to-close) and `document.body.style.overflow` (background-scroll
lock) directly in a `useEffect`. This is a disclosed, deliberate deviation
from the strict ADR-0002 "no DOM outside dependencies.ts" rule: these are
standard, unavoidable modal-a11y idioms (every modal component in any React
codebase does this inline), not business/transport logic smuggled past the
boundary, and routing them through a port would be pure ceremony for a
canary this scoped. `dependencies.ts` itself legitimately uses all of these
(that's its job). No other file in the feature touches any of them.

### Test/typecheck/guard results

- `pnpm --filter @jini/ui run typecheck`: green (zero errors), both before
  and after the Phase 8.5 fixes.
- `pnpm --filter @jini/ui exec vitest run src/features/connectors`: **144
  tests, 14 files, all green** — `rules.ts` (71, pure-function coverage of
  every merge/prune/score/sort/trust-check path), `dependencies.test.ts` (13,
  including the fake port's simulated latency and both real browser bridges'
  trusted-origin/visibility-gated firing), `useConnectorCatalog.test.ts` (5),
  `useConnectorAuthorization.test.ts` (11 — explicitly covers the
  pending/authenticated/stale-cancel OAuth handshake states: a successful
  connect with a redirect, a failed connect, ignoring a concurrent second
  action, the postMessage callback triggering a reload, window-refocus
  triggering reload **and** auto-cancelling a genuinely stale pending
  authorization while leaving a not-yet-expired one alone, interval polling
  start/continue, and pending-state persistence), `useConnectorDetail.test.ts`
  (7, including realistic two-page pagination), plus component tests for
  every presentational piece and a 6-test orchestrator smoke suite (load,
  locked-gate masking, search-empty-state, an end-to-end connect through the
  fake dependencies, provider-tab/search analytics callbacks, opening/closing
  the detail drawer). No coverage percentage was targeted — tests were
  written against actual state transitions and error paths per the task's
  own instruction, not to hit a number.
- Full monorepo `pnpm -r run typecheck` afterward: only pre-existing,
  unrelated failures in `packages/agent-runtime` and `packages/chat-react`
  (both stub packages missing a `tsconfig.json` entirely — not touched by
  this task).
- `pnpm guard` (repo root): `[guard] ok (skeleton — rules pending
  implementation during extraction)` — unchanged from before this task, no
  boundary violations introduced.

### Addendum: i18n wiring retrofit (2026-07-17)

The original canary session correctly declined to ship OD's own ~30 translated
`connectors.*` strings (product content), but incorrectly concluded from that
to drop the **i18n mechanism** entirely and hardcode plain English literals —
citing `Toast.tsx` as precedent for the same shortcut. That reasoning doesn't
hold: `@jini/ui`'s own `features/i18n` `useT()` hook is a zero-cost no-op when
unconfigured (`t(key)` returns `key` verbatim with no `I18nProvider` mounted),
so the convention is to use the English string itself as the key
(`t('Connect')`, not `t('connectors.connectLabel')`) — a component costs
nothing to make translatable and a host can localize it for free by mounting
`I18nProvider` with a dictionary keyed by that same English text. Every
component in this feature (`ConnectorsBrowser`, `ConnectorCard`,
`ConnectorDetailDrawer`, `ConnectorGrid`, `ConnectorSearchBar`,
`ProviderTabBar`, `ConnectorAlertList`) now routes its user-facing strings
through `useT()`; `rules.ts`'s `statusLabel()` stays a pure function (no
React) and callers wrap its return value (`t(statusLabel(status))`) instead.
Added a real end-to-end test (`ConnectorsBrowser.test.tsx`) mounting under
`I18nProvider` with a French dictionary to prove the wiring actually
localizes, not just that `t()` calls compile. 145 connectors tests now (was
144), all green.

Also caught and fixed while re-verifying: `types.ts`'s provenance comment
cited the vendored reference path literally (`foundry/integrations/open-design/...`),
which is a real, unfixed purity-guard leak the original session's "clean,
zero matches" self-report missed — reworded per the same convention
`@jini/deploy`'s source-map already documents. A pre-existing, unrelated
instance of the same pattern in `src/utils/visual-stability.ts`'s doc comment
was fixed at the same time.

### Addendum: independent review fixes (2026-07-17)

An independent second-opinion review (a different model, prompted to disprove the canary's own
"clean" self-report) confirmed the 3 correctness-neutral drops (category map, CDN slug logic,
CustomEvent) and the partial i18n fix above, then found 4 more real issues, all verified against
source and fixed:

1. **`formatToolsBadge()` was still unwrapped** at both its call sites (`ConnectorCard.tsx`,
   `ConnectorDetailDrawer.tsx`) — the i18n retrofit above missed it. Since its output bakes a count
   into the string (`"4 tools"`), wrapping the raw output in `t()` would need one dictionary entry
   per possible count — impractical. Added `toolsBadgeTranslation(count)` (returns a `{ key, vars }`
   pair; `formatToolsBadge` itself is unchanged, still tested, still used as the plain-string
   building block) and call `t(key, vars)` at both sites instead.
2. **`getDisplayableConnectorAccountLabel()` had a hardcoded `if (provider === 'composio') return
   undefined` branch** — the same class of provider-specific-logic-in-neutral-code bug as the
   category map and CDN slug, just missed in the first pass (the original has this exact branch
   with zero documented rationale). Stripped it — the function now always returns the label when
   present — and added a `getDisplayableAccountLabel` host-override prop on `ConnectorDetailDrawer`
   (threaded from `ConnectorsBrowserProps`, same shape as `getCategoryLabel`) so a host that
   legitimately wants to hide a specific provider's label can do so itself.
3. **The `toolsLimit`/`CONNECTOR_TOOL_PREVIEW_LIMIT` (50) option existed in `ports.ts`/`constants.ts`
   but was never passed** at the one hydration call site in `useConnectorDetail.ts` — a real bug, a
   host's `fetchConnectorDetail` could receive no limit at all and return an unbounded first page.
   Added a `toolsLimit` param to `useConnectorDetail`'s params (defaults to
   `CONNECTOR_TOOL_PREVIEW_LIMIT`), now actually passed on every `fetchConnectorDetail` call.
4. **Expired OAuth-pending entries from a prior session weren't pruned until the first poll
   interval fired** — `useConnectorAuthorization.ts`'s initial `useState` seeded directly from
   `authPendingStorage.load()` with no pruning. Checked the actual original
   (`ConnectorsBrowser.tsx:72-95`): `loadConnectorAuthorizationPending()` **does** call
   `pruneConnectorAuthorizationPending()` before returning — the port had silently dropped this.
   Fixed by wrapping the initial load with `pruneConnectorAuthorizationPending(..., Date.now())`.
   This changed real behavior a test had encoded: the "window refocus auto-cancels a stale pending
   authorization" test seeded an *already-expired* entry and asserted it survived until refocus —
   that setup can no longer work (it's now pruned on load, correctly). Rewrote it to seed an entry
   that's still valid at mount and goes stale a few milliseconds later (real timers + a short real
   delay, not `vi.useFakeTimers()` — fake timers don't play well with `waitFor`'s internal polling
   and leaked broken timer state into an unrelated test when tried), and added a new test asserting
   the load-time prune itself.

Two more "low" severity findings from the same review (swapping `dependencies` at runtime doesn't
refresh the catalog; removing the selected provider tab from `providerTabs` leaves none visibly
selected) were verified plausible but not fixed — genuine edge cases, lower impact, left for a host
to work around via `catalogRefreshKey`/controlled `providerTabs` state for now.

`packages/ui` test count: 375 (was 373 after the initial i18n fix omitted `formatToolsBadge`; net
+2 for `toolsLimit`-override and load-time-prune tests, +0 from the refocus-test rewrite since it
replaces the prior test 1:1).

### Honesty note — is this pattern ready to scale to the rest of the list?

Mostly yes, with two caveats worth flagging before dispatching the next
items in `foundry/docs/jini-port/god-components-extraction-plan.md` §1:

- **The plan doc under-specifies what needs generifying** — this is now the
  *second* time (after the i18n/utils task's `ExportDiagnosticsButton`/
  `enterpriseUrl.ts` finding) that reading a file in full surfaced
  product-specific logic the recon docs didn't call out (`ConnectorLogo`'s
  Composio-CDN slug construction here). A session working the next item
  should budget time to read every imported helper file, not just the god
  component itself, before trusting a plan doc's "what ships" list as
  complete.
- **The Phase 8.5 audit is genuinely necessary, not optional busywork** — it
  caught two real hidden-logic spots in a file this session wrote *itself*,
  written carefully the first time. That's the audit doing its job (per its
  own stated purpose: catching logic that "may just have never been
  extracted in the first place"), and a strong signal it should stay
  mandatory rather than get skipped as "probably fine" on faster future
  passes.

Everything else — the ports+dependencies+hooks+components+barrel shape, the
fake-double convention for `dependencies.ts`, folding a proven concurrency
hook (auth handshake) into one cohesive `useX` rather than over-fragmenting,
and testing state transitions directly rather than chasing a coverage
percentage — held up cleanly against a genuinely non-trivial 1,573-line
source file. The pattern is ready to scale; the two caveats above are
process reminders for the next session, not blockers.

---


## Section: `features/progress-card/` — the progress/status card pattern (2026-07-17)

Source: `WorkspaceActivityCard` + `GenerationStatusCard` in
`foundry/integrations/open-design/reference/components-original/DesignSystemFlow.tsx`
(lines 3076–3369 of 5,439), plus their two upstream helper modules
(`runtime/todos.ts`, `runtime/file-ops.ts` + `runtime/tool-events.ts`'s
`dedupeToolUsesById`). Per
`foundry/docs/jini-port/god-components-extraction-plan.md` §1 item 2 and r6 §1.5:
the *same* "progress bar + status icon + todo/step list" shape,
independently reimplemented twice against two different data shapes
(`ChatMessage.events`/`AgentEvent` vs. `DesignSystemGenerationJob`). Flagged
as higher strategic priority than a purely generic-UI finding because it
maps almost 1:1 onto Jini's own Run/Agent/Tool vocabulary.

**Preflight discrepancy, disclosed up front:** `ChatMessage`, `AgentEvent`,
and `DesignSystemGenerationJob` are only type-imported from
`@open-design/contracts` in the source file — that package is not vendored
anywhere in this snapshot, so their full field sets aren't directly
readable. This isn't a truncated/corrupted vendored file (the two card
components themselves are complete and identical between
`components-original/` and `od-web-src.orig/`); it's a real gap in what a
vendored-snapshot-only session can see. The fields both cards actually
touch were reconstructed with high confidence from call sites (lines 1636,
1889, 1955, 2600, 2665, 2775–2860) and the two upstream helper modules,
which *are* fully vendored.

### What shipped — `packages/ui/src/features/progress-card/`

| File | Contents |
|---|---|
| `types.ts` | Generic `ProgressStatus` (`pending`/`running`/`succeeded`/`failed`), `ProgressCardItem` (`id`/`label`/`status`), `ProgressCardData` (`id`/`status`/`title?`/`detail?`/`progress`/`steps`/`secondaryItems?`/`secondaryItemsLabel?`). |
| `rules.ts` | Pure helpers: status→icon mapping for the card and for individual items, a neutral (non-OD-branded) fallback title/detail per status, progress clamping, and progress-bar width/`aria-valuenow` derivation (including the indeterminate case). |
| `reference-adapters.ts` | `chatActivityToProgressCard` (the `WorkspaceActivityCard` equivalent) and `designSystemGenerationJobToProgressCard` (the `GenerationStatusCard` equivalent), plus locally-declared structural `*Like` input types and ported todo/file-op derivation helpers (see "Adapters" below). |
| `components/ProgressCard.tsx` | The unified presentational card: status icon + title/detail, a determinate-or-indeterminate progress bar, a primary step list, and an optional secondary item list (e.g. "files touched"). No hooks besides `useT()` — no state, no effects, no orchestration. |
| `index.ts` | Public barrel. |

Wired into `packages/ui/src/index.ts`'s top-level barrel alongside `i18n`/`observability`/`connectors`.

### Design decisions worth flagging

- **`title`/`detail` are host-supplied, not computed from a status+kind
  lookup table.** Both source cards hardcode branded, kind-specific copy
  ("Open Design is rebuilding tokens", "Workspace update ready" — see the
  purity-grep note below for why that exact text can't even appear in this
  package's comments). Baking any "kind"-aware copy-selection logic into the
  generic component would just re-embed OD's product vocabulary (job
  "kind" — generation/revision/token-contract-rebuild — is OD-specific)
  under a different name. The generic component instead takes optional
  `title`/`detail` and falls back to a neutral, status-only default
  (`Queued`/`Running`/`Complete`/`Needs attention`) when omitted. Computing
  richer, kind-aware copy is left to the host.
- **`progress: number | 'indeterminate'`** — neither source occurrence ever
  actually produces an indeterminate state (both always compute a 0-100
  percentage). It's included anyway because the task's own required test
  matrix asked for indeterminate-vs-determinate coverage, and because it's
  a natural, forward-looking capability for Jini's own Run/Agent/Tool
  dashboards (an agent step with no known total duration) — this is a
  deliberate generalization beyond what the two source cards themselves
  needed, called out here rather than silently added.
- **Per-item `label` values are not run through `useT()`.** `steps[]`/
  `secondaryItems[]` mix genuinely dynamic content (a todo's own text, an
  agent-touched file path) with the reference adapter's static fallback
  step titles, indistinguishably once they're both just strings in the same
  array — there's no way for the component to tell them apart. This matches
  the precedent already set by `ConnectorCard` not wrapping `connector.name`/
  `connector.category`. What *is* wrapped in `t()`, and covered by a real
  `I18nProvider` test: the fallback title/detail, the progress-bar
  `aria-label`, and the default "Files touched" secondary-items heading.
- **Adapters take a `*Like` structural input, not real `@open-design/contracts`
  types.** The task's own framing allowed shipping these as "documented
  reference adapters" for OD-shaped input; going one step further, the
  input types are locally declared minimal structural subsets rather than
  actual imports of an external, unvendored package — this package has zero
  dependency on `@open-design/contracts`, and a host whose real types are a
  structural superset can pass them in directly (TypeScript structural
  typing).
- **Slicing (`maxSteps`/`maxSecondaryItems`) moved from the adapter to the
  component.** The source cards slice at render time (`todos.slice(0, 6)`,
  `fileOps.slice(0, 5)`) inside the component itself. The adapters here
  return the *full* derived list; `ProgressCard` truncates for display via
  props (defaulting to the same 6/5 caps). This keeps the adapter's output
  data-complete and makes the truncation a generic, overridable view
  concern rather than something baked into one specific adapter.
- **No orchestrator hook was needed.** Unlike the connectors canary
  (`useConnectorCatalog`/`useConnectorAuthorization`/`useConnectorDetail`),
  this feature has no live data-fetching or async state of its own —
  `ProgressCard` is purely presentational, and the adapters are synchronous
  pure functions. There is deliberately no `ports.ts`/`dependencies.ts`
  pair in this feature; a host wires its own data source directly into
  `ProgressCardData` (via these adapters or its own mapping) rather than
  this package owning any transport.

### Dropped, and why

- **The Bash `rm`-command detection heuristic** from the source
  `deriveFileOps` (`extractSimpleBashDeletes`/`shellWords`/
  `isShellSeparator`/`isRedirectionOperator`/`looksUnsafeForFileList`, ~100
  lines) — a self-contained shell-command tokenizer used only to detect
  file deletions performed via a raw `Bash` tool call rather than a
  dedicated `Delete`-family tool. This is a distinct, non-trivial parsing
  concern in its own right, not core to "progress bar + status icon + step
  list," and isn't mentioned anywhere in r6 §1.5 or the plan doc's item 2.
  `deriveFileOpsFromAgentEvents` keeps the tool-name-based classification
  (`Read`/`Write`/`Edit`/`MultiEdit`/`Delete`/etc., which covers the large
  majority of real file-op tool calls) and drops only the Bash-string
  heuristic. A future task adopting this as a real extraction target should
  do so as its own item, not bundled here.
- **`job.kind`** (`generation`/`revision`/`token-contract-rebuild`) was not
  carried into `DesignSystemGenerationJobLike`/`ProgressCardData` at all —
  it exists purely to drive the OD-branded, kind-specific copy the generic
  title/detail design above already excludes. A host that wants
  kind-specific text computes it itself before calling the adapter and
  overrides `title`/`detail` on the result.
- **`todo.activeForm`** (an alternate in-progress-tense label OD's todo
  schema carries) — not used by either card's actual rendering, so not
  carried into `TodoItemLike`.
- **CSS class names were not ported verbatim** (`ds-workspace-activity-card`,
  `ds-generation-review-card`, `ds-generation-review-progress`, etc.) — new,
  neutral names were used (`progress-card`, `progress-card-bar`,
  `progress-card-steps`, `progress-card-secondary-items`) since the
  original classes are tied to OD's own stylesheet, not shipped here.

### Phase 8.5 audit

Enumerated every new file for the three blind spots the audit calls out:

1. **Inline JSX callback props with real branching/multi-statement
   bodies**: none — `ProgressCard.tsx` has no event handlers at all (neither
   source card is interactive; there's nothing to click).
2. **`useMemo`/`useEffect` bodies**: none exist — the component uses zero
   hooks besides `useT()`. Every derived value (`title`, `detail`,
   `secondaryHeading`, `widthPercent`, `ariaValueNow`, `visibleSteps`,
   `visibleSecondaryItems`) is a plain `const` computed from a one-line call
   into `rules.ts` or a trivial `.slice()` — already the audit's stated
   target end-state, with nothing to extract.
3. **Orphaned `useState`/`useRef`**: none — the component holds no state of
   its own; it's a pure function of its `data`/`maxSteps`/
   `maxSecondaryItems` props.

Honest framing: this "nothing found" result is a consequence of the
component's shape (stateless, non-interactive, three total hooks-uses —
all `useT()`), not a shortcut taken on the audit — there was genuinely no
orchestrator-style logic in this feature to hide in the first place, unlike
the connectors canary where the audit caught two real issues in a
stateful, effect-driven orchestrator.

### Purity grep — reported explicitly per the task's own instructions

**Product-identity strings** (`open design`, `OD_`, `--od-stamp`,
`open-design.ai`, `@open-design/`, case-insensitive) across every file
under `features/progress-card/`: **one match found and fixed** — a
`rules.ts` doc comment initially quoted the source cards' actual OD-branded
copy verbatim to explain why it was excluded (the same class of mistake
`features/connectors/types.ts` made with a vendored file path, documented
above). Reworded to describe the exclusion without repeating the branded
string. Re-run after the fix: **clean, zero matches.**

**Vendored path literal** (`foundry/integrations/open-design/reference`) in any
comment: **clean, zero matches** on both the first pass and re-check.

### i18n verification

Every static UI string owned by the component (fallback title/detail,
progress-bar `aria-label`, the default "Files touched" heading) is routed
through `useT()`; `rules.ts` stays hook-free per policy and its string
outputs are wrapped at the `ProgressCard.tsx` call site instead
(`t(defaultProgressCardTitle(data.status))`, etc.), not threaded through as
a `t` parameter. Per-item `label`s are deliberately not wrapped — see
"Design decisions" above for why. Verified end-to-end with a real test
(`ProgressCard.test.tsx`'s last case) mounting under `I18nProvider` with a
French dictionary keyed by the English source strings and asserting the
translated text renders, not just that `t()` calls compile — the same
verification shape `ConnectorsBrowser.test.tsx` established.

### Test/typecheck/guard results

- `pnpm --filter @jini/ui run typecheck`: clean, both before and after the
  purity-grep fix.
- `pnpm --filter @jini/ui exec vitest run src/features/progress-card`: **59
  tests, 3 files, all green** — `rules.test.ts` (13, every pure helper),
  `reference-adapters.test.ts` (32, covering `parseTodoWriteInput` field
  fallbacks and status normalization, todo/status-detail/file-op
  derivation including the dedupe-retried-tool-call path, and both
  top-level adapters' status mapping — including the `hasActivity` gate's
  parity with the source, deliberately tested both ways: activity present
  → a card; `queued`/`running` alone with no other signal → `null`, exactly
  matching `WorkspaceActivityCard`'s own early-return), `ProgressCard.test.tsx`
  (14 — status transitions across all 4 states, determinate vs.
  indeterminate progress rendering including `aria-valuenow` presence/
  absence, per-step status classes and the succeeded-only check icon, empty
  step-list handling, step/secondary-item truncation, the secondary-items
  section being fully absent when there's nothing to show, and the
  I18nProvider end-to-end case).
- Full `pnpm --filter @jini/ui exec vitest run`: **434 tests, 56 files, all
  green** (was 375 before this task; +59 new, 0 regressions).
- Full monorepo `pnpm -r run typecheck`: only the same pre-existing,
  unrelated failures already documented above (`packages/agent-runtime`,
  `packages/chat-react` — both stub packages missing a `tsconfig.json`
  entirely, untouched by this task).
- `pnpm guard` (repo root): `[guard] ok (skeleton — rules pending
  implementation during extraction)` — unchanged, no boundary violations
  introduced.

### Honesty note — did the generic shape actually turn out reusable?

Yes, more so than the connectors canary, precisely because the two source
occurrences were *already* independently converged on the same shape
before any generification work started — that's what made them worth
unifying in the first place. The friction was almost entirely in what to
leave out of the generic component (kind-specific copy, job "kind" itself,
the Bash-delete heuristic) rather than in finding a shape that fit both;
`ProgressStatus`'s 4-value vocabulary (`pending`/`running`/`succeeded`/
`failed`) fell directly out of `todoStatusClass`'s existing return type in
the source, with zero forcing required. The one genuine design choice
(rather than direct port) was making `title`/`detail` host-supplied instead
of computed — necessary specifically because the source's own defaults are
branded copy, but that same move is what makes the result immediately
usable for a non-OD Run/Agent/Tool dashboard, which was the whole point of
prioritizing this item. The "stayed more OD-shaped than expected" risk the
task asked about mostly didn't materialize here — likely because, unlike
`ConnectorsBrowser` (an entire OAuth-marketplace UI that happens to be
generic), this pattern's OD-specific parts (the two orchestrators, job
"kind" semantics, branded copy) were already cleanly separable from the
"progress bar + status + steps" shell in the source itself.

---

## Section: three reusable hooks — useCoalescedCallback / useStableHandler /
useModalWindowDragGuard (2026-07-17)

Three files verified reusable (by direct reading) in
`foundry/integrations/open-design/reference/od-web-src.orig/`:

| Jini file | Origin | What changed |
|---|---|---|
| `src/hooks/useCoalescedCallback.ts` | `hooks/useCoalescedCallback.ts` | Near-verbatim (zero OD imports to begin with). Only the doc comment's specific provenance framing ("absorb chokidar write-then-rename... during an agent rewrite... See #2195") was reworded to describe the coalescing mechanism generically (e.g. absorbing a paired remove+add filesystem-watcher signal into one update) — logic and `CoalesceOptions`/timer semantics unchanged. |
| `src/hooks/useStableHandler.ts` | `lib/use-stable-handler.ts` | Verbatim. This is the hook `source-map.md`'s prior "Deferred, not a rejection" note (see the runtime/providers/state/lib/… sweep section above) flagged as generic but unported because this package had no React dependency wired up at the time — React is now a real dependency (added by the i18n/observability/utils and flat-group sections above), so it ships now with no further change needed. |
| `src/browser/useModalWindowDragGuard.ts` | `hooks/useModalWindowDragGuard.ts` | **Genericized.** The origin hardcoded `MODAL_WINDOW_DRAG_BACKDROP_SELECTOR`, a 13-entry OD-specific CSS selector list (`.new-project-modal-backdrop`, `.automation-modal-backdrop`, etc.), and `useModalWindowDragGuard()` took no arguments. Ported the mechanism only: `eventHitsModalWindowDragStrip(event, backdropSelector)` now takes the selector as a parameter instead of closing over the hardcoded list, and `useModalWindowDragGuard(options)` takes a required `backdropSelector` (string, comma-joinable for multiple classes) plus an optional `enabled` flag — no OD selector list shipped. `MODAL_WINDOW_DRAG_STRIP_HEIGHT` (56px) kept as-is, it's a generic constant, not OD-specific data. Filed in a new `src/browser/` directory (DOM-interaction helper category, alongside `utils/dom-subscriptions.ts`'s browser-event primitives) rather than `src/hooks/`, since it isn't a React-state hook so much as a document-level event-guard effect — consistent with how `dom-subscriptions.ts` already separates framework-free DOM wiring from stateful hooks in this package. |

### Tests

All three got real interaction/behavior tests (not smoke-only):
`useCoalescedCallback.test.ts` (fake timers: burst-coalescing into one
trailing call, quiet-window reset, `maxWait` forcing a mid-burst flush,
cleanup-on-unmount not calling a stale callback, always calling the latest
callback identity); `useStableHandler.test.ts` (stable identity across
re-renders, delegating to the latest committed handler rather than a stale
closure, argument/return-value forwarding); `useModalWindowDragGuard.test.ts`
(jsdom, real dispatched `MouseEvent`s: `eventHitsModalWindowDragStrip`'s
selector/height matching in isolation, a capture-phase `stopPropagation()`
on a drag-strip click on a matching backdrop actually prevents a
document-level bubble listener from firing, no `stopPropagation()` for a
click below the strip or on a non-matching element, `enabled: false`
disabling the guard, and listener cleanup on unmount).

### Neutrality check

`grep -rn "Open Design\|OD_\|od-\|open-design:\|data-od-"` across all three
new source files + their tests: clean, zero matches.

### Test/typecheck/guard results

- `pnpm --filter @jini/ui run test`: 391 tests, 56 files, all green (16 new
  tests across the three new files).
- `pnpm --filter @jini/ui run typecheck`: green.
- `pnpm guard` (repo root): `[guard] ok` — unchanged, no boundary violations.
- `pnpm -r run typecheck` (full monorepo): only the same pre-existing,
  unrelated failures in `packages/agent-runtime` and `packages/chat-react`
  (stub packages missing a `tsconfig.json` entirely) already noted by the
  connectors-canary section above — not touched by this task.

---

## Section: `features/browser-chrome/` — DesignBrowserPanel.tsx partial slice (2026-07-17)

Source: `foundry/integrations/open-design/reference/components-original/DesignBrowserPanel.tsx`
(3,654 lines). Per `foundry/docs/jini-port/god-components-extraction-plan.md`'s Section B row —
`features/browser-chrome/` (embeddable webview/iframe browser tab) — and r6 §1.12
("PARTIAL, larger yield than expected"): unlike the connectors canary, this is
explicitly **not** a full-file slice. Only the navigation-stack/address/history/
favicon primitives and the viewport switcher ship; the webview/iframe embedding
itself, brand-extraction, comment annotation, the AI browser-use tool catalog, and
the reference-board bookmark content all stay in OD.

### New layout (first feature in this package to use it)

Uses the 2026-07-17 `react/{hooks,components}/` layout decided in
`packages/ui/README.md` — `types.ts`/`constants.ts`/`rules.ts`/`ports.ts`/
`dependencies.ts`/`index.ts` at the feature root, `react/hooks/` and
`react/components/` for anything importing React. `features/connectors/` (the
structural reference this task read) still uses the old flat layout; this is the
first feature to adopt the new one.

### Viewport-controls overlap check (blocking preflight item)

`packages/ui/src/features/viewer-shell/` does not exist in this repo yet (only
`connectors`/`i18n`/`observability` were shipped at the time of this task), so per
the task's own fallback instruction the overlap was checked directly against
`FileViewer.tsx`'s `PreviewViewportControls` instead of a shipped `viewer-shell`
primitive. **Confirmed duplicate**, not just a suspected one: identical 3-preset
model (`desktop` null/null width/height, `tablet` 820×1180, `mobile` 390×844),
identical i18n keys in the origin (`fileViewer.viewport{Desktop,Tablet,Mobile}[Title]`
on both `BrowserViewportControls` and `PreviewViewportControls`), and an identical
dropdown-trigger + listbox interaction (pointerdown-outside/Escape-to-close, a
`role="listbox"`/`role="option"` menu, an active-check indicator). `FileVersionViewportControls`
(also in `FileViewer.tsx`) is a genuinely different UI shape (an inline toggle-button
group, not a dropdown) over the same preset data — not the same component, not folded
in here.

**Decision:** ship `BrowserViewportControls` here (this feature's consolidation-map
row explicitly names it), built generic (plain-English `label`/`title` strings wrapped
in `useT()` at render time, not baked-in `fileViewer.*` i18n keys, and an overridable
`presets` prop). **Whoever does `FileViewer.tsx`'s `PreviewViewportControls` next
should import `BrowserViewportControls` from this feature's barrel instead of building
a second copy** — the component and its `BROWSER_VIEWPORT_PRESETS` constant are
already fully generic and carry no OD-specific naming. If `FileViewer.tsx`'s dropdown
trigger turns out to need markup/behavior this component doesn't have once actually
read in full, that's a real signal to extend this one (add a prop), not to fork it.

### What shipped — `packages/ui/src/features/browser-chrome/`

| File | Contents |
|---|---|
| `types.ts` | `BrowserViewportId`/`BrowserViewportPreset`, `BrowserHistoryEntry`, `BrowserNavigationEntry`/`BrowserNavigationState`, `AddressDisplayParts`, `BrowserTabHandle` (generic bridge-handle shape — see below). |
| `constants.ts` | `EMPTY_URL`, `HISTORY_LIMIT` (80, verbatim), `HISTORY_SAVE_DEBOUNCE_MS` (140ms, verbatim), `DEFAULT_HISTORY_STORAGE_NAMESPACE`, `BROWSER_VIEWPORT_PRESETS` (plain-English labels, not i18n keys — see overlap section above), `DEFAULT_HOME_NAVIGATION_ENTRY`. |
| `rules.ts` | All pure logic, generified where noted below: `normalizeBrowserAddress`, `labelFromUrl`, `formatAddressDisplay(Parts)`, `hostnameFromUrl`, `faviconUrl`, `isHistoryUrl`, `sameUrl`, `isHistoryEntry`, `historyStorageKey`, `parseHistoryPayload`/`serializeHistoryPayload` (the JSON (de)serialization half of `loadHistory`/`saveHistory`, split from the `localStorage` access itself — see `dependencies.ts`), `mergeHistoryEntry` (the pure merge core of `commitHistory`), and the navigation-stack state machine: `initialNavigationState`, `recordNavigation`, `updateCurrentNavigationTitle`, `resolveNavigationHistoryDelta`, `canGoBack`/`canGoForward`. |
| `ports.ts` | `BrowserHistoryStoragePort` (`loadHistory`/`saveHistory`, keyed by a host-supplied scope key), `BrowserBridgeRegistrationPort` (`registerBrowserHandle` — the generic registration *mechanism* the task asked for; see below). |
| `dependencies.ts` | `createBrowserHistoryStorage` — a **real**, SSR-guarded `localStorage`-backed implementation (same reasoning as connectors' browser-only bridges: this only touches generic browser APIs, no backend-specific shape, so it ships real rather than faked). `createNoopBrowserBridgeRegistration` — the default no-op for the bridge-registration port. `createDefaultBrowserChromeDependencies` composes both. |
| `react/hooks/useBrowserHistory.ts` | Loads a scope's history on mount, debounce-persists on change (mirrors the origin's 140ms-debounced save effect verbatim), exposes `commitVisit`/`clearHistory`. |
| `react/hooks/useBrowserNavigationStack.ts` | Owns `navigationStack`/`navigationIndex`/`addressValue` state via the `rules.ts` state machine; exposes `recordNavigation`/`goBack`/`goForward`/`updateCurrentTitle`/`reset`. Fires the host's `onNavigate` port callback whenever the current entry actually changes (deduped against the last-notified entry, not on every render) — this is the "ports for `onNavigate`" piece of the consolidation-map row, implemented as a hook option rather than a `ports.ts` entry since it's a single plain callback, not a transport adapter (same judgment call the i18n feature's port-vs-callback section already documents). |
| `react/hooks/useBrowserBridgeRegistration.ts` | Registers/unregisters a `BrowserTabHandle` with the host's `BrowserBridgeRegistrationPort` keyed by a scope key, mirroring the origin's `registerBrandBrowser` effect's mount/unmount/dependency-change lifecycle exactly — this is the "ports for... brand-bridge registration" piece. |
| `react/components/BrowserViewportControls.tsx` | The viewport-preset switcher — see the overlap section above. |
| `index.ts` | Public barrel. |

### Genericized beyond a mechanical move

- **`registerBrandBrowser` → `BrowserBridgeRegistrationPort`**: the origin hardcodes
  a call to OD's own `registerBrandBrowser(projectId, browserTabId, handle)` (brand-
  extraction bridge). Per the task brief, only the registration *mechanism* is
  in scope — the port lets a host wire in whatever registration callback it wants;
  what a host registers the handle for is entirely its own business. The origin's
  handle shape (`BrandBrowserHandle`: `isDesktopWebview`, `getURL`,
  `executeJavaScript`, `downloadPageSnapshot`) is **not** ported verbatim —
  `downloadPageSnapshot` is OD's page-archive/brief-capture feature (explicitly
  out of scope), so `BrowserTabHandle` here only carries the three genuinely
  generic capabilities (`isEmbeddedSurfaceAvailable`, `getURL`,
  `executeJavaScript`), renamed from `isDesktopWebview` since "desktop webview
  vs. iframe" is an OD-specific distinction — the generic concept is just
  "is a live, script-executable surface available."
- **`normalizeBrowserAddress`'s absolute-path branch**: the origin has a hardcoded
  OD-specific route-prefix check (`/^\/(api|artifacts|frames)(\/|$)/`) that resolves
  matching paths against `window.location.origin` before falling back to a
  `file://` URL for any other absolute path. Both the prefix list and the
  `window.location.origin` read are OD-specific/DOM residue — genericized into an
  optional `{ appRoutePrefixes, appOrigin }` options bag a host supplies; omitted,
  the function always falls back to `file://` for absolute paths (a behavior
  change from the origin only for hosts that don't pass these options — flagged
  explicitly rather than silently dropped, per the task's own instruction on
  undisclosed gaps).
- **`historyStorageKey`**: the origin hardcodes `` `od:design-browser:${projectId}:history:v1` ``
  (an OD-branded prefix). Genericized to `historyStorageKey(namespace, scopeKey)`,
  with `DEFAULT_HISTORY_STORAGE_NAMESPACE = 'jini:browser-chrome:history'` as the
  default namespace and the scope key host-supplied (a project id, a tab id,
  whatever scope makes sense to the host) — this is the "renameable storage-key
  string" the consolidation map's row already called out as the only real residue.
- **Home-tab title**: the origin hardcodes `'Reference Board'` as the home
  navigation entry's title (tied to the out-of-scope `REFERENCE_GROUPS` bookmark
  content). Replaced with a generic, overridable `DEFAULT_HOME_NAVIGATION_ENTRY =
  { title: 'New Tab', url: EMPTY_URL }` (a `homeEntry` option on
  `useBrowserNavigationStack`/`initialNavigationState` lets a host supply its own).

### Explicitly out of scope (per the task brief) — not touched, not ported

- **`registerBrandBrowser`'s actual brand-extraction logic** — only the
  registration mechanism (the port above) ships; what OD does with a registered
  handle (re-reading the rendered DOM to re-extract a brand after an anti-bot
  wall) stays entirely in OD.
- **`BrowserCommentMarkers`/`BrowserCommentComposer`** (board-comment annotation
  overlaid on the live page) — OD-specific, not read in depth beyond confirming
  their line ranges (2646-2799) sit outside every in-scope piece.
- **The AI "browser-use" tool-action catalog** (`BROWSER_USE_CATEGORIES`,
  `BrowserUseMenu`, `browserUsePrompt`, the `PAGE_BRIEF_SCRIPT` page-archive/brief
  capture machinery) — OD's own AI-agent tooling, not touched.
- **`REFERENCE_GROUPS`** — the hardcoded design-inspiration bookmark catalog and
  `DesignBrowserStart`, the component that renders it — OD marketing/curation
  content, not touched.
- **Everything webview/iframe-embedding itself**: `WebviewElement`, the desktop-
  host `<webview>` vs. cross-origin `<iframe>` branching, `loadWebviewUrl`,
  `warmBrowserOrigin`'s `dns-prefetch`/`preconnect` resource hints,
  `canUseNativeHistoryNavigation`, the full `DesignBrowserPanel` orchestrator
  component itself — none of this is generic; a host renders its own webview/
  iframe surface and calls into this feature's hooks/rules to drive its address
  bar, history, and viewport chrome around that surface. The task's title says
  "embeddable webview/iframe browser tab **primitive**" deliberately, not a
  drop-in full browser-tab component — the consolidation-map row's own listed
  contents (nav stack, address normalization, history/favicon utilities, ports,
  the viewport switcher) confirm this narrower scope, and r6 §1.12 explicitly
  recommends "a real vertical slice for the browser-chrome core... not the
  full-file treatment."

### Deferred, not shipped this pass (judgment call, per the task's own "use judgment" instruction)

`BrowserUseMenu` and `BrowserInspectPanel` — the "ALSO NOTE" pair the task flagged
as shape-generic/OD-data (same class as the `byok/*` precedent: a searchable
grouped-action-menu shape and a color-picker/range-slider quick-CSS-editor shape,
both wrapping OD-specific catalog/snapshot data). Not included in this pass:

- `BrowserUseMenu`'s shape is only meaningful bound to *some* action catalog, and
  the one real catalog in the origin (`BROWSER_USE_CATEGORIES`) is the AI
  browser-use tooling explicitly out of scope above — shipping the shape alone
  with no real second consumer to validate the generic-catalog-prop design
  against risks guessing at an abstraction rather than deriving it from a second
  real use.
- `BrowserInspectPanel` is entangled with `BrowserStyleDraft`/`BrowserElementSnapshot`
  (OD's element-snapshot/quick-CSS-edit data model, defined in `FileViewer.tsx`'s
  `../types` and reused across both files) and the page-side `PAGE_BRIEF_SCRIPT`
  DOM-measurement machinery — pulling just the shape out cleanly would need a
  closer read of that cross-file type coupling than this task's primary scope
  (nav/address/history/viewport) budgeted for.

Left here rather than silently dropped: a follow-up task extracting either should
re-read r6 §1.12's full description of both before starting, since this session
did not do the closer read needed to generify them.

### Test/typecheck/guard/purity results

- `pnpm --filter @jini/ui run typecheck`: clean, zero errors.
- `pnpm --filter @jini/ui exec vitest run src/features/browser-chrome`: **73 tests,
  6 files, all green** — `rules.test.ts` (41, pure-function coverage of address
  normalization including the new `appRoutePrefixes`/`appOrigin` options, history
  merge/parse/serialize, and every navigation-stack transition: append, in-place
  update, adjacent back/forward rejoin, forward-history truncation, delta
  resolution at both stack ends), `dependencies.test.ts` (8, including the SSR
  guard with `window` deleted and a `localStorage.setItem` quota-failure
  simulation), `useBrowserHistory.test.ts` (5), `useBrowserNavigationStack.test.ts`
  (8, including the dedup-against-last-notified-entry behavior of the `onNavigate`
  callback), `useBrowserBridgeRegistration.test.ts` (4, register-on-mount/
  unregister-on-unmount/re-register-on-handle-or-scope-change), and
  `BrowserViewportControls.test.tsx` (7, including a French-dictionary
  `I18nProvider` mount proving the i18n wiring actually localizes, per the i18n
  policy).
- Full package suite (`pnpm --filter @jini/ui exec vitest run`): 448 tests, 59
  files, all green (was 375 before this task).
- Full monorepo `pnpm -r --no-bail run typecheck`: `packages/ui` reports `Done`
  (clean). 9 pre-existing, unrelated failures elsewhere (`packages/agent-runtime`,
  `packages/chat-react`, `packages/cli`, `packages/http`, `packages/node-host`,
  `packages/renderers-react`, `packages/sqlite`, `packages/daemon`,
  `packages/deploy`) — all missing a `tsconfig.json` entirely or importing
  `@jini/protocol`/`@jini/core` before those packages have a build output, none
  touched by this task. The connectors canary's own report only surfaced 2 of
  these (its `pnpm -r run typecheck` bailed at the first failure); this task's
  `--no-bail` run is a more complete picture of the same pre-existing gap, not a
  regression introduced here.
- `pnpm guard` (repo root): `[guard] ok (skeleton — rules pending implementation
  during extraction)` — unchanged, no boundary violations introduced.
- Purity grep (`Open Design|OD_|--od-stamp|open-design\.ai|openDesignDesktop|@open-design/`)
  across every new file under `features/browser-chrome/`: clean, zero matches. A
  second, stricter pass for lowercase `od-` class prefixes and the vendored
  reference path cited literally in a comment (the two leaks the connectors
  canary's own retrospective flagged) is also clean.
- DOM-outside-`dependencies.ts` check: one disclosed, deliberate deviation —
  `react/components/BrowserViewportControls.tsx` uses `document.addEventListener`/
  `removeEventListener` directly inside a `useEffect` for outside-pointerdown/
  Escape-to-close. Same standard modal/menu a11y idiom already disclosed for
  `ConnectorDetailDrawer.tsx` in the connectors section above — not business/
  transport logic, not routed through a port.

### Cross-check against r6 §1.12's full description (per the task's explicit instruction)

r6 §1.12 lists, verbatim: "navigation stack, address-bar normalization,
history/favicon utilities (`loadHistory`/`saveHistory`/`normalizeBrowserAddress`/
`faviconUrl`, all pure string/URL/localStorage functions, only residue a
renameable storage-key string)" — all shipped, storage key genericized as
described above. "a responsive viewport-preset switcher (`BrowserViewportControls`)"
— shipped. Everything r6 names as staying OD-specific (brand-extraction bridge
registration's actual logic, `BrowserCommentMarkers`/`BrowserCommentComposer`,
the AI browser-use tool-action catalog, `REFERENCE_GROUPS`) is confirmed not
ported above. No gap between r6's description and what shipped was found on this
cross-check — the two deferred "ALSO NOTE" components are called out explicitly
above as a judgment-call deferral, not a silent drop.

### Post-merge audit pass (2026-07-17): a real bug fix, a dead-code removal, and 100% coverage

A follow-up audit re-diffed every in-scope piece above against the vendored
original function-by-function and found the port faithful — every
generification already listed in this section checked out against the
original's actual behavior. The audit did surface two real issues once
branch-coverage was wired up (`@vitest/coverage-v8`, run via a scoped CLI
include/exclude filter — `--coverage.include='src/features/browser-chrome/**'`
— rather than a shared `vitest.config.ts` change, so the rest of the package's
test config is untouched):

- **Real bug, fixed** — `rules.ts`'s `recordNavigation` hardcoded
  `DEFAULT_HOME_NAVIGATION_ENTRY.title` ("New Tab") for a navigation to
  `EMPTY_URL`, ignoring a caller-supplied `options.homeLabel`. Since
  `useBrowserNavigationStack` passes `homeLabel: homeEntry.title` on every
  call, a host configuring a custom `homeEntry` would see any navigation back
  to the home url silently retitle itself to the generic default instead of
  the host's own label — a regression relative to `initialNavigationState`/
  `labelFromUrl`, which both already honored a custom home label correctly.
  Fixed to `options.homeLabel ?? DEFAULT_HOME_NAVIGATION_ENTRY.title`; covered
  by new `rules.test.ts`/`useBrowserNavigationStack.test.ts` cases.
- **Dead code, removed** — `MergeHistoryEntryOptions.homeLabel` (threaded
  through `mergeHistoryEntry` → `useBrowserHistory`'s `commitVisit`) could
  never actually affect anything: `mergeHistoryEntry` only calls
  `labelFromUrl` after its own `isHistoryUrl(url)` guard has already excluded
  `EMPTY_URL`, and `homeLabel` only changes `labelFromUrl`'s output on the
  `url === EMPTY_URL` branch. Removed the field from `MergeHistoryEntryOptions`
  and `UseBrowserHistoryOptions` rather than leaving a permanently-uncovered,
  inert option in the public API.
- **One line excluded from coverage, not faked** —
  `useBrowserNavigationStack.ts`'s `if (!currentEntry) return;` guard inside
  the `onNavigate`-firing effect was unreachable through the hook's public
  API: every state transition it performs (`initialNavigationState`/
  `recordNavigation`/`resolveNavigationHistoryDelta`/
  `updateCurrentNavigationTitle`, all in `rules.ts`) preserves
  `0 <= navigationIndex < navigationStack.length`, so `currentEntry` is always
  defined in practice — the guard existed only because
  `noUncheckedIndexedAccess` types the array-index read as possibly-undefined.
  **Correction (2026-07-17, per the vendored `fixing-open-design-web` SKILL.md's
  Phase 9.5 classification #4 — "TS-required fallback with no real runtime
  path"):** an initial pass marked this with `/* v8 ignore next */`, which
  that skill's rule explicitly forbids ("never a valid outcome... under any
  classification"). Fixed to the classification's actual prescription: the
  `if` branch is deleted and the index read is a non-null assertion
  (`state.navigationStack[state.navigationIndex]!`) with a one-line comment
  explaining the invariant — no suppression comment anywhere in this feature.
- **`ports.ts`/`types.ts` excluded from coverage** — both are
  `export interface`/`export type` only; verified via the package's own
  esbuild transform that they compile to zero emitted statements, so
  v8/istanbul has no executable line to measure (reports 0/0 as 0%, not N/A).
  Excluded via `--coverage.exclude`, documented inline at the top of each
  file. `index.ts` (the barrel) is NOT excluded — it has real re-export
  statements that execute on import, and nothing else in the suite imported
  the barrel directly, so a small `index.test.ts` smoke test was added instead
  (also catches a typo'd/missing re-export a concrete-module test wouldn't).

Also closed several genuine (non-dead) branch-coverage gaps with targeted
tests rather than exclusions: `recordNavigation`'s adjacent-entry rejoin and
`replacePendingTarget` branches (the back/forward state-machine logic
faithfully ported from the origin, previously untested); `recordNavigation`/
`updateCurrentNavigationTitle` given an out-of-bounds `navigationIndex` (both
are exported pure functions, so a malformed `BrowserNavigationState` is a
legitimately reachable input, not hook-internal dead code); `faviconUrl`'s
catch branch (`https://` with no host); `labelFromUrl`'s empty-hostname
fallback (`file://` urls); `cleanIconUrl`'s `data:image/` branch; the
`onNavigate` dedup-by-content check (a re-recorded identical url+title still
produces a new object reference via `updateEntry`, so the effect re-runs and
must dedupe on content, not just skip via unchanged reference);
`BrowserViewportControls`'s custom-`presets`-with-no-match and empty-`presets`
branches; and `createDefaultBrowserChromeDependencies`'s `historyLimit`-only
option combination.

**Result**: feature-aggregate coverage on the executable-code portion (i.e.
excluding `ports.ts`/`types.ts` per above) is **100% Lines, 100% Branches,
100% Functions, 100% Statements** — up from 99.15% / 87.77% / 97.56% / 99.15%
before this pass. Full suite: 101 tests across 7 files for this feature (up
from 78), 476 tests across 60 files package-wide (up from 453).
`pnpm --filter @jini/ui run typecheck` and `pnpm guard` both remain clean.

### Second follow-up pass (2026-07-17): `useX`/`useWiredX` wiring pairs, toolbox merge

Two retrofits landed on this branch after the audit pass above:

**`useWiredX` wirers.** Per the now-required `useX(port)` / zero-arg
`useWiredX()` pattern (see `apps/web/src/features/memory/hooks/
useMemoryConfig.hooks.ts` on the OD repo's `refactor/web-memory-slice` for
the reference shape), audited every hook in this feature against
`ports.ts`/`dependencies.ts` to see which actually take an injected port:

- `useBrowserHistory` (takes `{ historyStorage: BrowserHistoryStoragePort }`)
  — got `useWiredBrowserHistory(scopeKey, options?)`, binding a module-level
  `createBrowserHistoryStorage()` singleton (the real, SSR-guarded
  `localStorage`-backed implementation — a meaningful production default).
- `useBrowserBridgeRegistration` (takes `{ bridgeRegistration:
  BrowserBridgeRegistrationPort }`) — got `useWiredBrowserBridgeRegistration
  (scopeKey, handle)`, binding `createNoopBrowserBridgeRegistration()`.
  Unlike the history port, there's no generic "real" default here by design
  (see `ports.ts`'s doc comment) — registering a handle only means something
  in the context of a host's own external bridge. A host that wants real
  bridge registration keeps calling `useBrowserBridgeRegistration` directly
  with its own port, same carve-out as a swappable test port, just for a
  real host implementation instead of a fake.
- `useBrowserNavigationStack` — **no wirer added.** Its `options` (`initialUrl`/
  `initialTitle`/`homeEntry`/`onNavigate`) are all plain local config, not a
  `ports.ts` port; the hook owns its state entirely via `rules.ts`'s pure
  functions. Nothing to wire.

Both wirers exported from `index.ts`; no internal call sites needed updating
— this feature has no top-level assembling component (that lives in the
consuming host, out of scope per this feature's own "OUT OF SCOPE" section
above), so `useBrowserHistory`/`useBrowserBridgeRegistration` had zero
in-package callers before or after.

**Toolbox merge.** Merged local branch `feat/ui-browser-toolbox` (commit
`c3e7f21`, not pushed to origin) — a clean merge, no conflicts (it branched
off a commit before `features/browser-chrome/` existed, so it never touched
this feature's files). It adds `packages/ui/src/browser/` (`useDismissOnOutsideOrEscape`,
`useGlobalKeydown`) as a thin wrapper over `utils/dom-subscriptions.ts`'s
`subscribeOutsideClickOrEscape`. `BrowserViewportControls.tsx`'s hand-rolled
`document.addEventListener('pointerdown'/'keydown', ...)` pair (the one
disclosed DOM-outside-`dependencies.ts` deviation noted earlier in this
section) is now `useDismissOnOutsideOrEscape(() => setOpen(false), { enabled:
open, containerRef: menuRef })` — same `pointerdown`-outside-or-Escape
behavior, dead local listener code removed. All of `BrowserViewportControls.test.tsx`'s
existing outside-click/Escape assertions pass unchanged against the shared
hook, confirming no behavior change.

**Result**: still 100% Lines/Branches/Functions/Statements on the
executable-code portion after both retrofits (wirers came with their own
tests; the toolbox swap needed none new since it's a drop-in behind the same
public component API). 103 tests across 7 files for this feature; 494 tests
across 62 files package-wide (the toolbox branch's own `useDismissOnOutsideOrEscape.test.ts`/
`useGlobalKeydown.test.ts` account for the rest of the file-count jump).
`pnpm --filter @jini/ui run typecheck` and `pnpm guard` both remain clean.

---

## Section: `features/sketch-editor/` — SketchEditor.tsx's Excalidraw shim (2026-07-17)

Source: `foundry/integrations/open-design/reference/components-original/SketchEditor.tsx`
(1,088 lines) + the two pure helpers it imported (`sketch-model.ts`'s
`sanitizeExcalidrawAppState`/`emptySketchScene`/`sketchSceneHasContent`,
`sketch-colors.ts`'s theme-aware default stroke color). Per
`foundry/docs/jini-port/god-components-extraction-plan.md`'s Consolidation map §B row
and `foundry/docs/jini-port/recon/r6-god-component-internals.md` §1.22: "near-FULL
SLICE — strongest find among the small files," ~60-70% of the file is a
reusable Excalidraw-integration shim. Target was `packages/ui/src/features/sketch-editor/`
rather than `@jini/renderers-react` — that package's README/source-map didn't
exist yet on `main` when this task read them (its only real content lives in
an unmerged draft PR, #2, `port/annotation-canvas`), so it had no established
natural home to fold into per the map's own fallback rule.

This is the first task in this list to use the **new** `react/` layout
(decided 2026-07-17): `types.ts`/`constants.ts`/`rules.ts`/`dom.ts`/`ports.ts`/
`dependencies.ts`/`index.ts` stay at the feature's top level; `hooks/`/
`components/` move under `react/`. It's also the first `@jini/ui` feature to
take a real third-party UI-library dependency (`@excalidraw/excalidraw@0.18.1`,
matching the version named in this session's own architecture debate
transcripts) rather than binding only to browser/DOM primitives.

### What shipped

| File | Contents |
|---|---|
| `types.ts` | Generic `SketchScene` (elements/appState/files — the OD legacy `SketchItem`/`legacyItems` shape is dropped entirely), `SketchSceneChangeOptions`, `SketchExportImageResult(Result)`, `SketchToastState`, `SketchTooltipLabelKey(s)`, `SketchTooltipTarget`, `SketchDomTextOverrides` (a plain `{ english: translated }` table — the generic mechanism only), `SketchTranslate`. |
| `constants.ts` | `SAVED_VISIBLE_MS`, `EXPORTED_IMAGE_MIME_TYPE`, `SKETCH_CONTEXT_MENU_MARGIN`, `DEFAULT_SKETCH_TOOLTIP_TARGETS` (Excalidraw's own toolbar `data-testid`s), `DEFAULT_CONTEXT_MENU_ACTION_ORDER`/`DEFAULT_CONTEXT_MENU_RECOGNIZED_ACTIONS` (Excalidraw's own action-id vocabulary), `DEFAULT_EXCALIDRAW_LANG_CODES` (locale → the string Excalidraw itself expects for `langCode`), `SKETCH_TEXT_OVERRIDE_ATTRS`, `DEFAULT_SKETCH_LIGHT_TOOL_COLOR`/`DEFAULT_SKETCH_DARK_TOOL_COLOR`. |
| `rules.ts` | Every pure function ported 1:1 or genericized: `sanitizeExcalidrawAppState`/`emptySketchScene`/`sketchSceneHasContent` (ported from `sketch-model.ts` — generic Excalidraw scene helpers that happened to live alongside OD's legacy-format code, not legacy-format code themselves), `buildInitialData`/`sceneFromExcalidraw` (legacy-item conversion dropped), `sceneContentSignature`/`isNonDeletedExcalidrawElement` (the dirty-dedupe engine), `exportedImageFileName`/`exportedImageResultFileName` (genericized: takes an optional `sourceExtension` instead of hardcoding `.sketch.json`), `resolveDefaultSketchToolColor` (ported from `sketch-colors.ts`), `defaultExcalidrawLangCode`, `normalizeTooltipLabel`, `buildSketchTooltipLabels` (the `t()`-wiring point for tooltip text), `translateDomTextValue`/`orderContextMenuActions` (pure halves of the DOM toolkit), `validateSketchEmbeddableUrl`, `isExcalidrawUnableToEmbedToast` (genericized — see "Generification findings" below). |
| `dom.ts` | The DOM-manipulation toolkit, kept separate from `rules.ts` since it touches `document`/`window` directly (by design — see "ADR-0002 DOM boundary" note below): `readExcalidrawTheme`/`readDefaultSketchToolColor`, `applySketchEditorTooltips`, `applySketchContextMenuSimplification`/`clampSketchContextPopover`, `applySketchDomTextOverrides` (generic version of the old i18n-override walker), `rewriteExcalidrawUnableToEmbedToasts`, `enhanceSketchExcalidrawPortals`/`removeSketchMermaidShortcutHints`/`findSketchMermaidInsertButton`/`handleSketchPortalCommandEnter`. |
| `ports.ts` | `SketchEditorEnginePort` — the one real "swap point": `Excalidraw` (the component), `MainMenu` (+ `Item`/`Separator`/`DefaultItems` sub-shape), `exportToBlob`. `convertToExcalidrawElements` was **not** ported into the port — its only call site in the original file was the legacy-item converter, which is dropped entirely, so the generic shim never needs it. |
| `dependencies.ts` | `realSketchEditorEngine`/`defaultSketchEditorDependencies` — binds the real `@excalidraw/excalidraw` package. Zero React import, per convention. |
| `react/dependencies-fake.tsx` | `createFakeSketchEditorEngine`/`createFakeSketchEditorDependencies` — a lightweight non-canvas React stand-in for Excalidraw (matching toolbar `data-testid`s, a menu-trigger, a `renderTopRightUI` slot, and `children`/MainMenu rendering), used by every test in this feature. **Deliberately lives under `react/`, not at the top-level `dependencies.ts`** — the thing being faked is itself a React component, so unlike every other port in this package, its fake unavoidably needs JSX. Documented inline as a disclosed exception to the "dependencies.ts has zero React import" convention. |
| `react/hooks/useSketchTheme.ts` | Theme MutationObserver + `prefers-color-scheme` tracking. |
| `react/hooks/useSketchScene.ts` | Excalidraw imperative-API ref, reset-on-clear instance key, initial-data memoization, and the content-signature-deduped change/save/clear plumbing. |
| `react/hooks/useSketchSaveWorkflow.ts` | Save/export orchestration, the transient "Saved" indicator timer, and the single toast slot (save success, export success+action, export failure). |
| `react/hooks/useSketchDomEnhancements.ts` | Wires the MutationObserver-driven DOM-enhancement effect (tooltips, context-menu simplification, DOM text overrides, toast rewriting, portal/modal enhancement) using `dom.ts`'s pure-ish functions. |
| `react/components/SketchMainMenu.tsx` | Dumb component composing the engine's `MainMenu`/`Item`/`Separator`/`DefaultItems`. |
| `react/components/SketchSaveStateBadge.tsx` | Dumb component for the `renderTopRightUI` save-state indicator. |
| `react/components/SketchEditor.tsx` | The orchestrator — composes the 4 hooks + engine + `Toast`, matching the deps-bag/hook-composition shape already proven by `features/connectors`. |
| `index.ts` | Public barrel. |

### Dropped (OD-specific residue, per the god-components-extraction-plan's own framing for this row)

- **Legacy sketch-item migration** (`convertLegacySketchItemsToExcalidrawElements`, the `SketchItem`/`legacyItems`/`hasPreservedRawItems` props) — the source product's pre-Excalidraw hand-rolled freehand/rect/arrow/text format and its one-time upgrade path. No generic Excalidraw-embedding host needs this; a host still migrating off a legacy format converts before handing this component its initial `SketchScene`.
- **The `.sketch.json` file-naming convention** — `exportedImageFileName` no longer hardcodes stripping `.sketch.json`; it takes an optional `sourceExtension` and otherwise strips whatever single extension is present.
- **The source product's own i18n hook and locale-override tables** (`ZH_CN_SKETCH_TEXT_OVERRIDES`/`ZH_TW_SKETCH_TEXT_OVERRIDES`, ~60 translated Excalidraw-UI-string entries) — real translated copy, not a mechanism. The *mechanism* (a locale-keyed English→translated table applied by walking Excalidraw's own rendered DOM) is kept as `SketchDomTextOverrides`, host-supplied, defaulting to no overrides.
- **`od-*` CSS class names** (`od-tooltip`, `od-sketch-context-menu`, `od-sketch-context-popover`, `od-sketch-modal`, `od-sketch-help-modal`, `od-sketch-dialog-close`, `od-embed-toast-rewritten`) — renamed `jini-tooltip`/`jini-sketch-*`, same rationale as the `Toast`/`TooltipLayer` renames earlier in this file. `jini-tooltip` specifically now drives this package's own shipped `TooltipLayer.tsx` contract (`.jini-tooltip[data-tooltip]`), a real (if incidental) integration rather than just a rename.
- **`sketch-model.ts`'s `OPEN_DESIGN_EXCALIDRAW_SOURCE` marketing-domain string** and the rest of that file's legacy-format types (`SketchDocument`, `SketchItem` union, `parseSketchDocument`/`buildSketchDocument`/`computeSketchBounds`/`isSketchJsonFileName`) — not ported; `SketchEditor.tsx` itself never called these, only the three generic scene helpers noted above.

### Generification findings beyond the plan doc's own notes

Consistent with this list's honesty note above (the plan doc reliably under-specifies what needs generifying once a file is actually read), two things surfaced only on a close read:

1. **`isExcalidrawUnableToEmbedToast`'s detection heuristic was itself coupled to the source product's translations** — the original hardcodes `message.includes('目前不允许嵌入此网址')`/`'目前不允許嵌入此網址'` (the exact Chinese strings from the dropped override tables) as part of *detecting* Excalidraw's own "can't embed this URL" toast, not just displaying it. Since the translated-copy tables are dropped, this detection would have silently stopped recognizing the toast in any non-English locale. Genericized to `isExcalidrawUnableToEmbedToast(message, additionalPhrases?)` — English detection ships by default; a host that has translated the toast via its own `domTextOverrides` passes that same translated phrase back in as `additionalPhrases` so detection stays in sync with whatever it chose to translate.
2. **The Mermaid-dialog "Close" button's label** originally pulled from the same dropped override table (`sketchTextOverrides(locale)?.Close ?? 'Close'`) even though this button is one *this component itself creates and injects* into Excalidraw's portal (not text belonging to Excalidraw's own baked-in UI). Routed through this feature's own `useT()` (`t('Close')`) instead — a real i18n integration via `@jini/ui`'s own mechanism, not a DOM-text-override case at all.

### ADR-0002 DOM boundary — a disclosed, deliberate deviation

Per the vertical-slice discipline, `features/**` files shouldn't touch `document`/`window` outside `dependencies.ts`. This feature is a legitimate, disclosed exception at a different scale than the connectors canary's one inline `document.addEventListener` (a standard modal-a11y idiom): `dom.ts`'s entire ~250-line toolkit *is* direct DOM manipulation of a mounted third-party library's own rendered output — that's this feature's whole purpose (embedding a library with "no hooks for any of this," per r6 §1.22), not business/transport logic smuggled past a boundary meant to keep transport swappable. The one thing that *is* swappable — the Excalidraw engine itself — is properly bound through `ports.ts`/`dependencies.ts`, same as every other feature in this package.

### i18n

Every user-facing string in the shipped component is routed through `useT()`
with the English string as the key (tooltip labels via `buildSketchTooltipLabels`,
the save-state badge, the `MainMenu` items, toast messages, the injected
Mermaid-dialog close button). Verified end-to-end: `SketchEditor.test.tsx`
mounts under `I18nProvider` with a French dictionary and asserts the
`MainMenu`'s Save/Clear-canvas text renders translated, not just that `t()`
calls compile.

### Phase 8.5 audit

Ran the mandated audit across every new file: no inline JSX callback with
real branching/multiple setters (the `renderTopRightUI`/`onSave`/`onExportImage`
arrows are all single-expression); no `useMemo`/`useEffect` body containing
unextracted multi-line derivation (`excalidrawUIOptions` is a static literal;
`tooltipLabels` is a one-line call into `rules.ts`; the DOM-enhancement effect
and the scene/save-workflow hooks' effects are the feature's own intended
DOM-registration/orchestration logic, already delegating their actual pure
computation to `rules.ts`/`dom.ts`); every `useState`/`useRef` across all 4
hooks and the orchestrator enumerated by hand and accounted for (none
orphaned).

### Test/typecheck/guard results

- `pnpm --filter @jini/ui run typecheck`: clean, zero errors.
- `pnpm --filter @jini/ui exec vitest run src/features/sketch-editor`: **109
  tests, 10 files, all green** — `rules.test.ts` (40), `dom.test.ts` (22, DOM-
  fixture tests for every tooltip/context-menu/text-override/toast-rewrite/
  portal function), `dependencies.test.ts` (2, asserting the real engine binds
  correctly), `react/hooks/*.test.ts(x)` (25, incl. the theme observer, the
  scene hook's hydration-skip/dedupe/clear/close-dialog behavior, and the
  save-workflow's save/export/error/toast-action paths), `react/components/*.test.tsx`
  (20, incl. the full orchestrator wired against the fake engine and the
  I18nProvider end-to-end mount).
- Full package `pnpm --filter @jini/ui exec vitest run`: **484 tests, 63
  files, all green** (was 375 before this task).
- `pnpm -r --no-bail --if-present run typecheck`: `packages/ui typecheck: Done`
  (clean); remaining failures are the same pre-existing, unrelated set every
  prior task in this file has reported (`agent-runtime`/`chat-react`/`cli`/
  `http`/`node-host`/`renderers-react`/`sqlite` missing `tsconfig.json`;
  `daemon`/`deploy` needing `@jini/protocol`/`@jini/core` built first) — none
  touched by this task.
- `pnpm guard`: `[guard] ok (skeleton — rules pending implementation during
  extraction)`.
- Purity grep (`Open Design`/`OD_`/`--od-stamp`/`open-design.ai`/
  `openDesignDesktop`/`@open-design/`, plus the stricter lowercase `od-`
  prefix pass and a check for the vendored-reference-path-in-comment mistake):
  **6 hits found and fixed** — all were explanatory doc-comment mentions of
  "Open Design" as provenance context (e.g. "that migration path is a host
  (Open Design) concern"), not runtime strings, but per this file's own
  connectors-canary precedent (a provenance comment citing a vendored path
  literally was treated as a real leak, not a false positive) these were
  reworded to "host-product"/"the source product" instead. Clean after.

### Environment finding worth flagging for future `@excalidraw/excalidraw`-adjacent work

Getting real component tests running against this dependency required two
non-obvious environment fixes, recorded here since they'll recur for any
future task touching `@excalidraw/excalidraw` (e.g. if `@jini/renderers-react`'s
own annotation-canvas work ever needs to render real Excalidraw rather than
its own canvas primitives):

1. **`@excalidraw/excalidraw`'s dev bundle ships extensionless deep imports**
   (`roughjs/bin/rough`, no `.js`) that assume a bundler's resolver. Vitest's
   default SSR path hands externalized deps straight to Node's own loader,
   which requires exact extensions and fails. Fixed via
   `vitest.config.ts`'s `test.server.deps.inline: [/@excalidraw\/excalidraw/, /roughjs/]`,
   routing it through Vite's transform pipeline instead.
2. **The bundle also runs an unconditional module-load-time canvas-capability
   probe** (`"filter" in document.createElement("canvas").getContext("2d")`)
   that throws under jsdom's real (unimplemented) `getContext` — crashing the
   *import* itself, before any test body runs, even for tests that never
   render real Excalidraw. The obvious fix (add the native `canvas` npm
   package so jsdom has real `getContext` support) was attempted and reverted:
   the package installed but its native addon's build script requires system
   Cairo/Pango libraries and a build toolchain not available in this sandbox,
   and pulling in a heavy native addon as a devDependency for one package's
   tests felt like the wrong tradeoff even where it does work (fragile across
   environments, not a "lean engine" fit). Fixed instead with a minimal
   `HTMLCanvasElement.prototype.getContext` stub in `vitest.setup.ts` (a fake
   2D context object, no real drawing) — sufficient because every test in
   this feature always renders the package's own fake engine, never real
   `<Excalidraw>`; the stub exists only so importing the real binding (for
   `dependencies.test.ts`'s shape assertions, and because the orchestrator's
   default-prop import of `dependencies.ts` is eager regardless of which
   `dependencies` a given render actually uses) doesn't crash the module
   graph. Documented inline in `vitest.setup.ts` as a deliberate, narrow shim,
   not a real canvas polyfill.
3. Also confirmed (via `pnpm install`, not a blocker): `@excalidraw/excalidraw@0.18.1`'s
   own `@radix-ui/*` transitive dependencies declare a `react@"^16.8 || ^17.0 || ^18.0"`
   peer range, unmet by this package's `react@^19.2.0` — a peer-dependency
   warning only, install and every test above succeeded regardless, but worth
   flagging for whoever next upgrades React in this package.

---

## Section: `features/asset-grid/` — LibrarySection.tsx redo (2026-07-17)

Source: `foundry/integrations/open-design/reference/components-original/LibrarySection.tsx`
(1,401 lines), read in full. Per `foundry/docs/jini-port/god-components-extraction-plan.md`'s
Consolidation map (section B, "Own feature"): `features/asset-grid/` (generic
`AssetGrid<TAsset>`) ← `LibrarySection.tsx` — "rubber-band multi-select (the
single cleanest generic core in the whole sweep, per §1.16), facets,
debounced search, SSE live-merge, day-bucketed grouping, kind-dispatch
thumbnails." Per r6 §1.16, this is "the second-strongest candidate after
`ConnectorsBrowser.tsx`."

**This is a from-scratch redo, not a continuation.** A prior attempt at this
target was never merged: its own draft source-map.md said "product actions
(delete/…) were host-owned via callbacks" but then shipped no
`onDeleteSelected` callback prop at all, and it silently dropped the
grid/timeline view-mode toggle without disclosing the gap. Neither of the
prior attempt's files exist in this checkout — there was nothing to diff
against or build on; this section describes a clean-room port.

This is also the first `features/<domain>/` slice built under the **new**
layout decided 2026-07-17 (see `packages/ui/README.md`): `types.ts`/
`constants.ts`/`rules.ts`/`ports.ts`/`dependencies.ts`/`index.ts` at the
feature's top level; `react/hooks/` and `react/components/` hold every file
that imports React. `features/connectors/` (the only other shipped feature
at the time) still uses the old flat layout and was read only for its
internal ports+dependencies+hooks+components+barrel discipline, not its
exact paths. `features/progress-card/`, named as a second structural
reference in this task's own dispatch prompt, **does not exist in this
checkout** — despite `foundry/docs/jini-port/god-components-extraction-plan.md` and
`packages/ui/README.md` both describing it as "✅ landed, PR #1." Flagging
this discrepancy rather than silently working around it; `features/connectors/`
alone was sufficient as the structural precedent.

### What shipped — `packages/ui/src/features/asset-grid/`

| File | Contents |
|---|---|
| `types.ts` | Generic `AssetGridItem` (`{id: string}` constraint), `AssetGridFacetOption`, `AssetGridQuery`, `AssetGridViewMode`, `AssetGridSelectors<TAsset>` (the host-injectable field-reader seam: `getKind`/`getSource`/`getTimestamp`/`getDayKey`/`getTitle`/`getSubtitle`/`matchesKindFilter`/`mapKindToQuery`), plus the 100%-generic `CardRect`/`Band`/`AssetGridDayGroup<TAsset>` shapes ported verbatim from the original's own `CardRect`/`Band` interfaces. |
| `constants.ts` | `ASSET_ID_ATTR`/`ASSET_ID_SELECTOR` (the rubber-band hit-tester's DOM attribute, generified from the original's two-attribute `data-asset-card`/`data-asset-id` scheme into one `data-asset-grid-id` attribute that both selects and identifies a card), debounce/coalesce defaults, `ALL_FACET_VALUE`. |
| `rules.ts` | All pure logic, ported 1:1 in behavior: `localDayKey`/`dayKeyFromTimestamp`/`dayHeadingResult`/`dayHeading`/`groupByDay` (day bucketing — `dayHeadingResult` added beyond the original to separate the translatable "Today"/"Yesterday" labels from a locale-formatted date string, which isn't a sensible i18n key); `snapshotCardRects`/`cardIdsInBand` (the rubber-band core, verbatim geometry); `toggleSelection`/`rangeSelection`/`selectAllIds`/`pruneMissingSelection`; `mergeIngestedAssets`/`parseLiveUpdateAssetId` (the SSE merge core, verbatim reconciliation logic, generified id-field name); `buildAssetGridQuery`/`defaultMatchesKindFilter`/`filterByKind` (the query-building + client-side kind-narrowing pair, generified — see the "element vs image" note below); `resolvePreviewClickAction`/`resolveCheckboxClickAction` (new — extracted from what would otherwise be branching inline JSX handlers, per the Phase 8.5 audit); `buildFacetLabelMap`/`resolveFacetLabel` (new — same audit, extracted from an inline `Map` construction in a `useMemo`); `isTypingTarget` (keyboard-shortcut typing-target gate). |
| `ports.ts` | `AssetGridDataPort<TAsset>` (`fetchAssets`/`fetchAssetById`), `AssetGridLiveUpdatesPort` (`subscribe` with ingest/delete/full-reload handlers), `AssetGridDependencies<TAsset>`. Deliberately **no delete method on any port** — see the bulk-delete manifest row (g) below for why. |
| `dependencies.ts` | `createFakeAssetGridDataPort` — an in-memory test/demo double (the data transport is genuinely host-specific, matching the canary's own "ship a fake, not a real transport" precedent). `createBrowserSseLiveUpdatesPort` — a **real**, SSR-guarded `EventSource`-backed implementation, shipped for real (not faked) because `EventSource` is a generic browser API with no backend-specific shape beyond a URL and two event names — same reasoning the connectors canary used to justify shipping real `sessionStorage`/`postMessage` bridges instead of fakes. |
| `react/hooks/useAssetGridData.ts` | Fetch-on-`{active, query}`-change + client-side kind-narrowing pass. Selector functions (`getKind`/`matchesKindFilter`/`mapKindToQuery`) are ref-bridged rather than direct `useCallback` deps, since a host is not guaranteed to pass referentially-stable selectors — an early version of this hook without the ref bridge produced a real "Maximum update depth exceeded" render loop in its own test suite, caught and fixed before this landed (see the hook's own doc comment). |
| `react/hooks/useAssetGridLiveUpdates.ts` | The SSE reconciliation core, ported behavior-for-behavior from the original's coalescing `flush()`/`schedule()` effect: deletes apply for free, filtered views or ids-with-no-cheap-fetch fall back to a full reload, a burst of ingest events is coalesced over one window and resolved via `Promise.all` + `mergeIngestedAssets`. Kept as one cohesive hook (not split further) per the Phase 6 "one natural owning cluster" guidance the connectors canary also followed for its OAuth-handshake hook. |
| `react/hooks/useAssetGridSelection.ts` | `selectedIds` state + shift-range anchor + toggle/range/selectAll/clear + the "prune ids that disappeared after a reload" effect. |
| `react/hooks/useRubberBandDrag.ts` | The rubber-band mouse-drag effect itself (rAF-throttled apply, scroll re-snapshot, empty-click-clears-selection, additive-drag-preserves-base-selection) — wired around the pure `snapshotCardRects`/`cardIdsInBand` core in `rules.ts`. This split (pure geometry in `rules.ts`, DOM/event wiring in its own hook) is what "the cleanest generic core in the whole sweep" (r6 §1.16) actually looks like ported: the core itself needed zero changes beyond a rename, only the wiring around it needed a home. |
| `react/hooks/useAssetGridKeyboardShortcuts.ts` | Cmd/Ctrl+A / Escape / Delete-Backspace, gated by `enabled` (a host-owned modal/menu), `hasAssets`, `hasSelection`, `isPreviewOpen`, and `isTypingTarget`. |
| `react/components/AssetCard.tsx` | The generic card: lazy-mounted thumbnail (via the existing `useInView` hook — a direct reuse of the port this package already shipped, not a new lazy-mount implementation), select checkbox, preview button (meta/ctrl→toggle, shift→range, plain→preview, via `resolvePreviewClickAction`), kind/source badges, title/subtitle, a generic "Remove" button wired to an optional `onDeleteAsset` callback, and a `renderCardExtra` slot for the OD-specific origin-navigation row. |
| `react/components/AssetGridToolbar.tsx` | Search box, kind/source `<select>` facets (hidden entirely when a host supplies no facet options), Grid/Timeline view toggle, a built-in Refresh button (generic — the original's Sync/Upload buttons are OD-specific and left to the `toolbarActions` slot instead). |
| `react/components/AssetGridBody.tsx` | Grid mode (one flat `assets.map`) vs. timeline mode (`groupByDay` sections, each with a heading + count) — both call the same `renderCard` with the same flat `index`, matching the original's "range/box selection stays consistent across both views" invariant exactly. |
| `react/components/SelectionActionBar.tsx` | Selected count, Select-all/Clear, a `renderBulkActions` slot for OD-specific bulk actions, and the generic bulk-delete-request button. |
| `react/components/DeleteConfirmDialog.tsx` | The confirm-UI for bulk delete — count-aware singular/plural copy, Escape-to-close, backdrop-click-to-close, focus-the-confirm-button-on-mount, body-scroll-lock. |
| `react/components/SelectionBand.tsx` | The rubber-band visual rectangle (`position: fixed` inline, since that's structural to the coordinate space `snapshotCardRects` uses — everything else about its look is left to host CSS). |
| `react/components/AssetGrid.tsx` | The orchestrator — composes all 5 hooks + `rules.ts` derivations, wires the bulk-delete confirm flow and the per-card delete callback, defaults `dependencies` to the fake data port. |
| `index.ts` | Public barrel. |

Also added, not asset-grid-specific: `src/hooks/useDebouncedValue.ts` — a
small generic trailing-debounce hook, promoted out of `useAssetGridData` into
the package's shared `src/hooks/` bucket (mirrors `useInView`'s placement)
since debouncing a fast-changing value is not an asset-grid concept.

### The "element vs image" client-side narrowing seam

The original's kind filter has one piece of real OD-specific nuance:
`element` is a *badge* identity (clipper element-pick captures), not a raw
storage kind — those captures are stored as `image` and narrowed out
client-side after a server-side `kind=image` query
(`matchesKindFilter(a, kind)` in the original). This is exactly the kind of
per-asset badge-vs-storage-kind split a generic component can't hardcode, so
it's now two host-injectable seams on `AssetGridSelectors`: `mapKindToQuery`
(what to actually send the server — OD would map `'element' → 'image'`) and
`matchesKindFilter` (the client-side narrowing predicate — OD would check
its own badge-derivation logic). Both default to identity/equality when a
host doesn't need the split.

### Dropped (OD-specific, non-separable — per r6 and this task's own step 6)

- **`LibraryCard`'s "origin" action row** (design-system/project/edit-as-page
  navigation — `originDesignSystemId`/`originProjectId`/`navigate`/
  `onEditAsPage`). Exposed as a `renderCardExtra` slot on `AssetCard`; the
  generic component renders nothing there unless a host supplies it.
- **"Multi-select → add to design system"** (the whole `dsMenu*` cluster:
  `createDesignSystemFromSelection`/`optimizeExistingDesignSystem`/
  `chatToDesignFromSelection`, `fetchDesignSystems`, the design-system
  picker menu). Exposed as a `renderBulkActions` slot on
  `SelectionActionBar`; same "renders nothing unless supplied" default.
- **Kind-aware thumbnail rendering itself** (`MediaThumb`/`Thumb`/
  `LibraryThumb`'s image/video/html/font/color switch) — OD-specific in
  which kinds exist and how each renders, not portable as logic. Exposed as
  a required `renderThumbnail` prop; only the *lazy-mount-on-scroll*
  wrapping (via `useInView`) is generic and built in.
- File upload (`LibraryUploadModal`, the drag-anywhere-to-upload overlay,
  `openUpload`/`onSectionDrop` family) and the preview modal
  (`LibraryPreviewModal`, prev/next navigation) — neither is in the required
  a–i list (see manifest below); both are OD-specific surfaces a host
  builds itself. `AssetGrid` exposes `onPreview(asset)` as a plain callback
  (fired with the same meta/ctrl/shift precedence as the original) and
  otherwise stays out of the preview-modal business entirely.
- The `Sync` button (`runSync`/`syncLibrary`) — an OD-specific daemon
  reconciliation action, left to the `toolbarActions` slot alongside Upload.
- The Composio-style `~90-entry` category label map pattern doesn't apply
  here (this file never had one), but the same host-supplies-its-own-labels
  principle applies to kind/source facet `label`s — the generic component
  only stores/reads `value`s, a host supplies its own display labels via
  `kindFacets`/`sourceFacets`.

### Retained generic behavior manifest (required a–i)

Every item from this task's own required list, with where it landed and what proves it:

**a. Rubber-band multi-select** (`snapshotCardRects`/`cardIdsInBand`) — ported
verbatim into `rules.ts`, unchanged geometry/hit-testing logic. Wired by
`react/hooks/useRubberBandDrag.ts` (rAF-throttled drag, scroll re-snapshot,
additive/plain-click semantics). Proven by `rules.test.ts`'s
`snapshotCardRects`/`cardIdsInBand` suites (jsdom-rect fixtures) and
`useRubberBandDrag.test.ts`'s 4 tests (drag-selects-intersecting-cards,
mousedown-on-a-card-is-ignored, empty-click-clears-selection,
shift-held-drag-keeps-prior-selection-as-base) plus
`AssetGrid.test.tsx`'s end-to-end selection-bar assertions.

**b. Day-bucketed timeline grouping** — `dayHeadingResult`/`dayHeading`/
`groupByDay` in `rules.ts` (newest-day-first, flat-index-preserved, same
Today/Yesterday/formatted-date logic as the original's `dayHeading`).
Rendered by `AssetGridBody.tsx`'s timeline branch. Proven by `rules.test.ts`
(`dayHeading`/`dayHeadingResult`/`groupByDay` suites, including the
non-contiguous-same-day-collapse case) and `AssetGridBody.test.tsx` (groups
by day, newest first, heading + count, flat index preserved) and
`AssetGrid.test.tsx`'s "Grid/Timeline toggle switches rendering mode" test.

**c. Kind/source facet filtering** — `AssetGridToolbar`'s `<select>`s (hidden
entirely when a host supplies no facets, vs. the original's always-present
`KIND_FILTERS`/`SOURCE_FILTERS`), `buildAssetGridQuery`/
`defaultMatchesKindFilter`/`filterByKind` in `rules.ts` for the query +
client-narrowing split. Proven by `rules.test.ts`'s query/filter suites,
`AssetGridToolbar.test.tsx`'s facet-select tests, and `AssetGrid.test.tsx`'s
"filters by the kind facet" end-to-end test.

**d. Debounced search** — `useDebouncedValue` (250ms default, matching the
original's trailing debounce), wired in `AssetGrid.tsx`. Proven by
`useDebouncedValue.test.ts` (2 tests, fake-timer-driven: only the last
rapid-fire value lands) and `AssetGrid.test.tsx`'s "filters by a debounced
search" end-to-end test (real timers, short override).

**e. SSE live-merge reconciliation** — `useAssetGridLiveUpdates.ts`, ported
behavior-for-behavior from the original's coalescing `flush()` (deletes
free, filtered-view/no-cheap-fetch/ambiguous-null-fetch all fall back to a
full reload, a burst coalesces into one flush), `mergeIngestedAssets`/
`parseLiveUpdateAssetId` in `rules.ts` for the actual merge. The real
transport (`createBrowserSseLiveUpdatesPort`, `EventSource`-backed) lives in
`dependencies.ts`. Proven by `rules.test.ts`'s merge/parse suites,
`useAssetGridLiveUpdates.test.ts`'s 9 tests (delete-applies-free,
ingest-resolves-via-fetchAssetById, filters-active-forces-full-reload,
onFullReload-forces-reload, no-fetchAssetById-forces-reload,
null-fetch-forces-reload, burst-coalesces-into-one-flush,
unsubscribe-on-unmount), and `dependencies.test.ts`'s
`createBrowserSseLiveUpdatesPort` suite (routes ingest/delete by resolvable
id, falls back to full-reload for an unparseable payload, closes the
`EventSource` on unsubscribe).

**f. Grid/Timeline view toggle** — a real, distinct UI mode switch, NOT
dropped (this is exactly the gap the prior unmerged attempt left
undisclosed). Confirmed from the original source what each mode actually
renders (line-referenced in this task's own Reference Preflight): grid is
one flat `assets.map`; timeline groups the *same* cards into day-bucketed
`<section>`s, each with a heading + count, sharing the same flat `index`.
Ported as `viewMode` state in `AssetGrid.tsx` + `AssetGridToolbar`'s
Grid/Timeline buttons (`aria-pressed`, `data-active`) + `AssetGridBody`'s
mode switch. Proven by `AssetGridToolbar.test.tsx`'s "view toggle switches
modes and reflects the active one" test and `AssetGrid.test.tsx`'s
"Grid/Timeline toggle switches rendering mode" end-to-end test.

**g. Bulk-delete-with-confirm** — a real `onDeleteSelected` callback prop
(the actual gap the prior attempt left, per this task's own brief) plus a
real confirm-dialog affordance, both present and tested. `AssetGrid.tsx`'s
`requestDeleteSelected`/`confirmDelete` wire `SelectionActionBar`'s Delete
button → `DeleteConfirmDialog` → `onDeleteSelected(ids)` (awaited) → local
removal from `assets` + cleared selection. `onDeleteAsset` is the equivalent
single-card callback wired to `AssetCard`'s generic "Remove" button. Proven
by `DeleteConfirmDialog.test.tsx` (6 tests: singular/plural copy, Cancel,
confirm, Escape, backdrop-click, focus-on-mount + scroll-lock) and
`AssetGrid.test.tsx`'s "bulk delete: request → confirm dialog → confirm
calls onDeleteSelected and removes the items", "bulk delete: cancel closes
the dialog without calling onDeleteSelected", and "per-card Remove calls
onDeleteAsset" end-to-end tests.

**h. Keyboard shortcuts** — Cmd/Ctrl+A / Escape / Delete-Backspace, grepped
directly from the original source (lines 1014–1038 of
`LibrarySection.tsx`), not assumed from memory. Ported as
`useAssetGridKeyboardShortcuts.ts`, gated by `enabled` (a host-owned
modal/menu — mirrors the original's `uploadOpen || confirmDeleteOpen ||
dsMenuOpen` gate, generified since this package doesn't know about a host's
own modals), `hasAssets`, `hasSelection`, `isPreviewOpen`, and
`isTypingTarget` (also ported from the original's inline
`INPUT`/`TEXTAREA`/`SELECT`/`isContentEditable` check). Proven by
`useAssetGridKeyboardShortcuts.test.ts`'s 9 tests and `AssetGrid.test.tsx`'s
"Cmd/Ctrl+A selects all, Escape clears the selection" and "the Delete key
opens the bulk-delete confirm dialog" end-to-end tests.

**i. Kind-aware thumbnail dispatch** — a required `renderThumbnail` prop on
`AssetCard`/`AssetGrid` (the dispatch logic itself — image/video/html/font/
color — is OD-specific in which kinds exist, per r6, so it's host-supplied,
not ported). What IS generic and built in: the lazy-mount-on-scroll wrapper
around whatever the host renders, reusing this package's existing
`useInView` hook rather than reimplementing the original's bespoke
`LAZY_THUMB_KINDS`/`LibraryThumb` gate. Proven by `AssetCard.test.tsx`'s
render/interaction tests (the thumbnail slot renders via `renderThumbnail`,
verified through `useInView`'s existing `IntersectionObserver`-unavailable
fallback, already covered by `useInView.test.ts`) and `AssetGrid.test.tsx`'s
end-to-end tests confirming cards render with host-supplied thumbnails.

### i18n wiring

Every user-facing string in every new component (`AssetCard`,
`AssetGridToolbar`, `SelectionActionBar`, `DeleteConfirmDialog`,
`AssetGridBody`'s Today/Yesterday headings) is routed through `useT()`, English
string as the key — no hardcoded literals, no repeat of the original
connectors-canary mistake of shipping a first pass without the i18n
mechanism. `dayHeadingResult` in `rules.ts` (pure, no React) returns a
`{label, translatable}` pair rather than a bare string specifically so the
component can decide whether to wrap it in `t()` — a locale-formatted date
string (`toLocaleDateString`) is not a sensible translation key (it varies
per bucket), only the fixed "Today"/"Yesterday" labels are, mirroring the
`toolsBadgeTranslation` pattern the connectors canary's independent review
added for the same "don't wrap a value that bakes dynamic content into the
key" reason. Verified end-to-end (not just that `t()` calls compile) by
`AssetCard.test.tsx`'s and `AssetGrid.test.tsx`'s
mount-under-`I18nProvider`-with-a-French-dictionary tests, asserting the
translated text actually renders (`Sélectionner`, `Actualiser`, `Tout
sélectionner`, `Supprimer {count}`, `Supprimer`).

### Phase 8.5 audit — what it caught

Ran the mandated audit (not just the "zero top-level functions" grep)
across every new file, per the same three blind spots the connectors canary's
own audit checked:

1. **Inline JSX callbacks with real branching**: found two, both in
   `AssetCard.tsx` — the preview button's `onClick` (3-way branch on
   meta/ctrl/shift) and the select-checkbox's `onClick` (2-way branch on
   shift, plus `stopPropagation`). Extracted the branching *logic* into pure
   `rules.ts` functions (`resolvePreviewClickAction`/
   `resolveCheckboxClickAction`, now unit-tested in isolation) and wrapped
   each call site in a named `useCallback` (`handlePreviewClick`/
   `handleCheckboxClick`) that just dispatches on the result — matching the
   connectors canary's own "extract the LOGIC, the registration/dispatch can
   stay" resolution for its `ProviderTabBar`/gate `onClick` handlers.
   `DeleteConfirmDialog.tsx`'s backdrop `onMouseDown={(e) => { if
   (e.target === e.currentTarget) onCancel(); }}` was left inline — the same
   single-line "click outside" DOM comparison `ConnectorDetailDrawer.tsx`
   already establishes as acceptable inline, not business logic.
2. **`useMemo` bodies with multi-line/inline-construction derivations**:
   found one — `AssetGrid.tsx`'s `kindFacetLabels`/`sourceFacetLabels`
   memos were building a `Map` inline. Extracted to `rules.ts` as
   `buildFacetLabelMap` (+ `resolveFacetLabel` for the lookup-with-fallback
   read side, itself replacing an inline `?? kindValue`/ternary at the
   `renderCard` call site), both now unit-tested. Every remaining `useMemo`
   in the new files is a one-line call into an already-pure `rules.ts`
   function or a plain default-selection expression, the target end state.
3. **Orphaned `useState`/`useRef`**: enumerated every one across all 21 new
   source files (listed by hand): `AssetGrid.tsx`'s `kind`/`source`/
   `search`/`viewMode`/`confirmDeleteOpen`/`containerRef`,
   `DeleteConfirmDialog.tsx`'s `confirmBtnRef`, `useAssetGridData.ts`'s
   `assets`/`loading` state + 3 selector-bridging refs,
   `useAssetGridLiveUpdates.ts`'s 3 latest-value-bridging refs,
   `useAssetGridSelection.ts`'s `selectedIds`/`anchorRef`,
   `useRubberBandDrag.ts`'s `band`/`dragging`/`dragRef` — every one traced
   to a real read site, none unassigned.

`pnpm --filter @jini/ui run typecheck` was re-run clean after each fix.

### Purity grep — reported explicitly per this task's own instructions

**Product-identity strings** (`Open Design`, `OD_`, `--od-stamp`,
`/tmp/open-design`, `@open-design/`) across every new file under
`features/asset-grid/` plus `src/hooks/useDebouncedValue.ts`: **clean, zero
matches.** A second, stricter self-imposed pass (`od-`/`open-design\.ai`/
`openDesignDesktop`, catching lowercase-prefix and non-regex-exact product
identity) is also clean. Two doc comments cite the bare original filename
`LibrarySection.tsx` by name (in `AssetGrid.tsx` and
`useRubberBandDrag.ts`) — this is provenance, not a vendored-path leak (the
connectors canary's own caught mistake was citing the full
`foundry/integrations/open-design/...` path literally; neither of these comments
does that, and citing a bare source filename matches the connectors
package's own shipped precedent, e.g. `rules.ts`'s "Pure logic ported from
OD's `ConnectorsBrowser.tsx`" docblock).

**`window`/`document`/`EventSource`/`localStorage`/`sessionStorage` used
outside `dependencies.ts`**: three files, all disclosed, deliberate
deviations from the strict ADR-0002 "no DOM outside dependencies.ts" rule —
the same class of exception `ConnectorDetailDrawer.tsx` already establishes
as acceptable:
- `DeleteConfirmDialog.tsx` — `document.addEventListener` (Escape-to-close)
  and `document.body.style.overflow` (scroll lock), the same standard modal
  idiom as `ConnectorDetailDrawer.tsx`.
- `useRubberBandDrag.ts` — `window.addEventListener('mousemove'/'mouseup'/
  'scroll')` and `document.body.style.userSelect`, required for the drag
  gesture to track the pointer outside the grid's own DOM node; this is the
  mechanism, not a business-logic smuggle.
- `useAssetGridKeyboardShortcuts.ts` — `window.addEventListener('keydown')`
  and `document.activeElement`, required for a global keyboard-shortcut
  listener (matches the original's own `window.addEventListener('keydown',
  onKey)`).
`dependencies.ts` itself legitimately uses `EventSource` (that's its job).
No other file in the feature touches any of these.

### Test/typecheck/guard results

- `pnpm --filter @jini/ui run typecheck`: **green, zero errors.**
- `pnpm --filter @jini/ui exec vitest run src/features/asset-grid src/hooks`:
  **131 tests, 16 files, all green** — `rules.test.ts` (41), `dependencies.test.ts`
  (9), `useAssetGridData.test.ts` (4), `useAssetGridLiveUpdates.test.ts` (9),
  `useAssetGridSelection.test.ts` (4), `useRubberBandDrag.test.ts` (4),
  `useAssetGridKeyboardShortcuts.test.ts` (9), `useDebouncedValue.test.ts`
  (2), `AssetCard.test.tsx` (11), `AssetGridToolbar.test.tsx` (7),
  `AssetGridBody.test.tsx` (3), `SelectionActionBar.test.tsx` (2),
  `SelectionBand.test.tsx` (2), `DeleteConfirmDialog.test.tsx` (6),
  `AssetGrid.test.tsx` (14, end-to-end against the fake dependencies:
  load, empty-state, kind-facet filter, debounced search, preview callback,
  selection bar, bulk-delete confirm/cancel, per-card delete, Cmd+A/Escape/
  Delete shortcuts, view toggle, host-supplied `renderCardExtra`/
  `renderBulkActions` slots, and the i18n end-to-end dictionary test).
- Full package `pnpm --filter @jini/ui exec vitest run`: **502 tests, 68
  files, all green** (no regressions in `features/connectors`,
  `features/i18n`, `features/observability`, `components/`, `utils/`,
  `hooks/`).
- Full monorepo `pnpm -r --no-bail run typecheck`: `packages/ui typecheck:
  Done` (clean). The 9 failures elsewhere are pre-existing and unrelated:
  `agent-runtime`/`chat-react`/`cli`/`http`/`node-host`/`renderers-react`/
  `sqlite` are stub packages genuinely missing a `tsconfig.json` (confirmed
  by directory listing — not touched by this task, same class of
  pre-existing gap the connectors canary's own report already flagged for
  two of these packages); `daemon`/`deploy` fail on unbuilt workspace
  dependencies (`@jini/protocol`/`@jini/core` have no `dist/` yet in this
  fresh checkout) — a build-order issue, not a type error, and also not
  touched by this task.
- `pnpm guard` (repo root): `[guard] ok (skeleton — rules pending
  implementation during extraction)` — unchanged, no boundary violations
  introduced.

### Added devDependency: `@testing-library/jest-dom`

This package had `@testing-library/react` but not `@testing-library/jest-dom`
— every existing test in the package (including the connectors canary) wrote
DOM assertions by hand (`.toBeTruthy()`, manual attribute reads) rather than
using matchers like `toBeInTheDocument()`/`toHaveAttribute()`. This task adds
`@testing-library/jest-dom` as a devDependency and wires it into
`vitest.setup.ts` (`import '@testing-library/jest-dom/vitest'`) rather than
hand-rolling ~40 raw DOM assertions across the new test files. A new
`src/vitest-env.d.ts` ambient-reference file was also needed: `tsc -p
tsconfig.json` only includes `src/` per this package's `tsconfig.json`, so
the type augmentation `vitest.setup.ts` pulls in at runtime (outside `src/`)
was invisible to typecheck without a matching `/// <reference types="@testing-library/jest-dom/vitest" />`
placed inside `src/`. Dev-only; no runtime dependency added.

---

## Section: `features/viewer-shell/` — media-viewer shell extraction (2026-07-17)

Source: a vendored OD file-viewer god-component's media-viewer shell family
(the specific pieces named in `foundry/docs/jini-port/god-components-extraction-plan.md`'s
consolidation map row for this target — the file itself stays vendored,
14,275 lines, and is not otherwise touched). Per that doc's own r6-derived
verdict, this is a **PARTIAL** extraction of a **PARTIAL** file: only the
~6-9 named generic pieces, not the file's `HtmlViewer` (~7,110 lines) or
`FileVersionManagerModal` (~1,050 lines), both confirmed OD-specific.

### New layout, not the connectors/progress-card precedent

This is the first `@jini/ui` feature built under the 2026-07-17 layout
decision (`packages/ui/README.md`): `types.ts`/`constants.ts`/`rules.ts`/
`ports.ts`/`dependencies.ts`/`index.ts` at the feature's top level;
everything importing React under `features/viewer-shell/react/{hooks,components}/`.
`features/connectors/` (read as the structural example per this task's
brief) still uses the old flat `hooks/`/`components/` layout — its internal
ports+dependencies+hooks+components+barrel *discipline* was the template,
not its exact paths. Note: `features/progress-card/`, the other file this
task was pointed at as a structural example, does **not exist** in this
branch's checkout (`packages/ui/src/features/` only contains `connectors/`,
`i18n/`, `observability/` before this task) — the extraction-plan doc's "✅
landed" note for it appears to describe work merged on a different branch
than this one was cut from. Not a blocker for this task; flagged as a
discrepancy for whoever reconciles branches next.

### What shipped — `packages/ui/src/features/viewer-shell/`

| File | Contents |
|---|---|
| `types.ts` | `ViewerFileRef` (`{name,size,mtime,mime?}`), `ViewportPreset`, `SegmentedOption<T>`, `ViewerFileActionUrls`, `ViewerCommentAttachment`, `ViewerCommentBase`, `CommentSideDragState`, `MarkdownSplitPaneMode`. |
| `constants.ts` | `DEFAULT_VIEWPORT_PRESETS` (desktop/tablet/mobile convenience default), `COMMENT_SIDE_DRAG_MIME` (renamed from the source's `application/x-open-design-preview-comment`), `COPY_FEEDBACK_RESET_MS`. |
| `rules.ts` | `humanFileSize`; comment-reorder helpers (`dropEdgeForClientY`, `reorderCommentIds`, `appendSavedCommentOrder`, `visibleSelectedCommentIds`); `relativeCommentTimeTranslation` (a `{key,vars}`-returning port of the source's inline `formatCommentTime`, generic — see the i18n note below); the full JSON-precision-safe formatting chain (`formatJsonTextForDisplay`, `hasPrecisionSensitiveJsonNumberText`, `hasUnsafeJsonNumber`, and their private token/decimal helpers) ported verbatim from `TextViewer`'s body, since it's genuinely pure and zero-OD-coupled; `scrollRange`/`scrollRatio`/`scrollTopForRatio` (new, small — the 3 markdown-scroll-sync helpers not already in `src/utils/markdown-scroll-sync.ts`); `computeSplitPaneScrollTarget` (orchestrates the already-ported `buildScrollAnchors`/`mapScrollPosition`/`measureEditorBlockOffsets`/`measurePreviewBlockOffsets`, re-exported from this file for convenience). |
| `ports.ts` / `dependencies.ts` | `ViewerClipboardPort` — the one injectable seam this feature needs (no fetch/transport port: see "What's out of scope" below). Ships a real browser implementation (`createBrowserViewerClipboard`, wrapping the already-ported `src/utils/copy-to-clipboard.ts`) rather than a fake, same reasoning as connectors' SSR-guarded browser adapters — clipboard access is a generic browser API with no backend shape to fake. |
| `react/hooks/useCopyToClipboard.ts` | The "copy, flip a `copied` flag, auto-reset after ~1.5s" pattern independently repeated by the source's plain-text viewer and its markdown viewer's copy button — generalized into one hook. |
| `react/hooks/useCommentReorder.ts` | The comment side-panel's drag/dragover/drop reorder state machine, pulled out of the presentational component per the MemorySection-pattern "feature-local hooks own the fiddly state" discipline. |
| `react/hooks/useMarkdownScrollSync.ts` | The scroll-sync orchestration (rAF scheduling, programmatic-scroll suppression, active-pane tracking) built on top of `rules.ts`'s `computeSplitPaneScrollTarget` and the already-ported block-offset measurers. |
| `react/components/ViewerShell.tsx` | The generic "viewer-toolbar + viewer-body" chrome — the actual highest-value piece per r6, replacing 8 near-duplicate toolbar+body layouts with one shell taking `toolbarLeft`/`toolbarActions`/`children` slots. Also exports the trivial `ViewerEmptyState`. |
| `react/components/ViewerFileActions.tsx` | Generic download/open link pair — the source's `FileActions` with `projectFileUrl(projectId, file.name)` replaced by host-resolved `downloadUrl`/`openUrl` props. |
| `react/components/SegmentedToggle.tsx` | New shared primitive — see "Viewport-controls overlap resolution" below. |
| `react/components/ViewportSwitcher.tsx` | Dropdown/listbox viewport-preset switcher, generalizing `PreviewViewportControls`. |
| `react/components/ViewportToggleGroup.tsx` | Always-visible toggle-button row, generalizing `FileVersionViewportControls`; a thin wrapper over `SegmentedToggle`. |
| `react/components/CodeWithLines.tsx`, `JsonPanel.tsx` | Ported verbatim, per r6. |
| `react/components/ImageViewerBody.tsx`, `VideoViewerBody.tsx`, `AudioViewerBody.tsx` | New, small — trivial presentational bodies (`<img>`, `<video>`, `<audio>`+icon) generalizing `ImageViewer`/`VideoViewer`/`AudioViewer` once the daemon URL-building is stripped (host resolves a final `src`). Not explicitly named as separate deliverables by r6/the plan (which describe one generic shell, not 8 ported viewers), but small enough, and different enough from "8 near-duplicate viewers," to ship as convenience leaves over the shared shell rather than leaving image/video/audio bodies unaddressed. |
| `react/components/SvgSourcePane.tsx` | New — `SvgViewer`'s preview/source body content (its toolbar's mode-toggle and reload/download chrome are composed by the host from `ViewerShell`/`SegmentedToggle`/`ViewerFileActions` instead of being re-baked into this component). |
| `react/components/CommentSidePanel.tsx`, `CommentSideDock.tsx` | Generic over a `TComment extends ViewerCommentBase` type parameter — see the discrepancy writeup below for what else had to become a prop, beyond just the type. |
| `react/components/MarkdownSplitPane.tsx` | The split source/preview pane + mode tabs + scroll-sync, with the artifact-status gate, autosave pipeline, image upload, and shiki highlighting all dropped — see below. |
| `index.ts` | Public barrel. |

### Viewport-controls overlap — resolved per Step 1.1

Three viewport-preset switchers exist across the sweep: the source file's
`PreviewViewportControls` (main preview toolbar) and `FileVersionViewportControls`
(version-manager toolbar), plus `DesignBrowserPanel.tsx`'s `BrowserViewportControls`
(not yet extracted — a different, not-yet-touched god-file).

Read side by side:
- **`PreviewViewportControls` and `BrowserViewportControls` are the same
  shape.** Both are a trigger button showing the active preset that opens a
  `role="listbox"` dropdown menu of the other presets, with identical
  outside-pointerdown/Escape-to-close wiring (`document.addEventListener`
  in a `useEffect` gated on `open`) and an identical per-item shape (icon +
  label + a checkmark on the selected one). They differ only cosmetically:
  `BrowserViewportControls` wraps its trigger in OD's `IconTooltipButton`
  and supports a `disabled` prop the other lacks; class-name prefixes differ
  (`viewer-viewport-*` vs. `db-viewport-*`). **Resolution: ship ONE shared
  primitive** — `ViewportSwitcher` — generalizing `PreviewViewportControls`.
  When `DesignBrowserPanel.tsx` is eventually extracted, it should bind to
  this component rather than re-implement `BrowserViewportControls` as a
  second competing dropdown switcher; `ViewportSwitcher`'s doc comment says
  so explicitly.
- **`FileVersionViewportControls` is a genuinely different shape**, not a
  third instance of the same dropdown: it's an always-visible `role="group"`
  row of toggle buttons (`aria-pressed`, no open/closed state, no menu) —
  used in the version manager's tighter toolbar where a dropdown didn't fit.
  Ported as `ViewportToggleGroup`, itself a thin wrapper over a new shared
  primitive, `SegmentedToggle<T>`.
- **One disclosed simplification while building `SegmentedToggle`**: the
  source's `FileVersionViewportControls` used `role="group"`/`aria-pressed`
  buttons, while its *other* two "toggle a few options" call sites in the
  same file (`SvgViewer`'s preview/source tabs, `MarkdownViewer`'s
  edit/split/preview tabs) used a `role="tablist"`/`aria-selected` tab
  pattern instead — a real, if minor, ARIA difference. Rather than ship a
  third near-identical primitive just for that distinction,
  `MarkdownSplitPane` reuses `SegmentedToggle` (group/pressed semantics) for
  its mode tabs too. This is a deliberate, disclosed simplification, not an
  oversight — flagging it here per the task's audit requirement rather than
  letting it pass as a silent behavioral gap.

### The `CommentSidePanel` generic-type gap the recon doc didn't call out

`foundry/docs/jini-port/god-components-extraction-plan.md` (quoting r6 §1.1)
describes `CommentSidePanel`/`CommentSideDock` as "already prop-abstracted
... only `PreviewComment`'s type is OD-specific — textbook generic-shape-OD-
type-parameter." Reading the full component surfaced two more real gaps a
type parameter alone can't close:

1. **`commentDisplayLabel(comment, t)`** derives a comment's one-line label
   by regex-matching HTML tag names out of `elementId`/`label`/`htmlHint`
   fields (a board-annotation-specific heuristic: "does this look like an
   image, a button, a heading, a link, a page comment?"). This is *logic*,
   not just a type — it can't be ported generically. `CommentSidePanelProps`
   makes it a required `getCommentLabel(comment, index)` callback instead.
2. **`projectRawUrl(projectId, attachment.path)`** (attachment thumbnail
   URLs) is a daemon-route builder, not portable. Replaced with an optional
   `resolveAttachmentUrl` callback; attachments render only when a host
   supplies one.
3. `commentActivityAt`/`formatCommentTime` (timestamp derivation + relative-
   time formatting) *are* genuinely generic — ported as
   `relativeCommentTimeTranslation` in `rules.ts`, with an overridable
   `formatTimestamp` prop for a host that wants different phrasing.

None of this is a silent drop — `CommentSidePanelProps`' doc comments call
out exactly why `getCommentLabel`/`getCommentTimestamp`/`getCommentBody`/
`resolveAttachmentUrl` exist as host-supplied functions instead of being
derived internally.

### `MarkdownSplitPane` — narrower than the plan's one-line description

The plan doc says: *"MarkdownViewer's split source/preview pane with
scroll-sync — generic; only the artifact-status gate around it ties it to
OD (drop the gate, keep the split-pane/scroll-sync mechanism)."* Reading the
full ~680-line `MarkdownViewer` function shows this undersells the coupling
by a wide margin — a second instance (after this same plan's `ExportDiagnosticsButton`/
`enterpriseUrl.ts` and `ConnectorLogo`'s CDN-slug finding) of the plan's own
documented pattern: reading a file in full surfaces more product coupling
than the recon pass's one-line note implies. Beyond the artifact-status gate
(`isStreaming`/`isError`), the following are **also** genuinely OD/product-
specific and were **not ported**:

- The autosave pipeline (`saveMarkdownText`, its 700ms debounce, in-flight/
  pending-save merge logic, `writeProjectTextFile` daemon calls, the
  auto-save-status indicator UI).
- Image paste/drop upload (`insertImageFiles`, `uploadProjectFiles`,
  markdown-image-snippet insertion).
- The markdown-to-HTML rendering pipeline itself (`MarkdownRenderer`/
  `renderMarkdownToSafeHtml`, project-relative image-src rewriting) and its
  shiki-based code-block syntax highlighting + inject-a-copy-button-into-
  the-DOM mechanism.
- The export-as-.md download menu and `OPEN_DESIGN_GITHUB_REPO_URL`-adjacent
  social-share wiring (not shown in the snippet quoted in r6, found on the
  full read).

What's left, and what `MarkdownSplitPane` actually ships, is the genuinely
generic core: the source/split/preview mode toggle and the two-pane layout
whose scroll positions stay aligned via block-anchored interpolation
(`useMarkdownScrollSync`, built on the already-ported
`extractMarkdownBlockLines`/`measureEditorBlockOffsets`/
`measurePreviewBlockOffsets`/`buildScrollAnchors`/`mapScrollPosition` in
`src/utils/markdown-scroll-sync.ts`). A host renders its own markdown-to-
HTML pipeline and passes the resulting string as `previewHtml`; the
component's `toolbarActions`/`toolbarLeftExtra` slots are where a host
plugs in its own save-status indicator, copy/download buttons, and
streaming/error labels.

### What's out of scope (confirmed OD-specific, not touched)

- **`HtmlViewer`** (~7,110 lines) — deploy-provider selection, live-artifact
  daemon streaming, board/pod annotation, manual-edit CSS bridge
  (`InspectPanel` and its `rgbToHex`/`pxToNumber` helpers, read far enough
  to confirm the boundary, live here).
- **`FileVersionManagerModal`** (~1,050 lines) — version history UI
  saturated with OD analytics/deploy/export calls.
- **No fetch/transport port beyond the clipboard.** Every other piece in
  this feature is either pure logic or presentational-only; the actual
  file-content loading (`fetchProjectFileText`/`fetchProjectFilePreview`),
  saving, and rendering pipelines are host responsibilities by design, not
  a gap — see the `MarkdownSplitPane` writeup above for why that's a
  deliberate scope boundary, not an oversight.
- **No `Button`/`Input`/`Select` primitives.** The source's
  `CommentSidePanel`/`InspectPanel` import these from `@open-design/components`
  (OD's own component library, not vendored here, and not yet ported into
  `@jini/ui`). `CommentSidePanel` uses plain `<button>` elements instead,
  matching the existing `Toast.tsx`/`CustomSelect.tsx` precedent of not
  depending on an unavailable external UI kit.

### i18n

Every user-facing string in the new `react/components/` files is wired
through `useT()` with the English string itself as the key (`t('Download')`,
not `t('fileViewer.download')`), per the plan's i18n policy. `rules.ts`'s
`relativeCommentTimeTranslation` stays hook-free (pure, returns a
`{key,vars}` pair); callers wrap it in `t()` at the call site
(`CommentSidePanel`), matching the same pattern already used for
`features/connectors/`'s `statusLabel()`/`toolsBadgeTranslation()`. Verified
end-to-end, not just compiled: `ViewerFileActions.test.tsx`,
`CommentSidePanel.test.tsx`, and `MarkdownSplitPane.test.tsx` each mount
under `I18nProvider` with a translated (French) dictionary and assert the
translated text actually renders.

### Purity grep

`grep -rn "Open Design\|OD_\|--od-stamp\|/tmp/open-design\|@open-design/"`
across `packages/ui/src/features/viewer-shell/`: clean, zero matches.
A second, stricter pass for the literal vendored reference path
(`grep -rn "components-original\|foundry/integrations/open-design"`) is also clean
— every doc comment in this feature describes provenance as "the source
component" rather than citing the vendored file path literally, per the
connectors addendum's warning about exactly this leak.

### Test/typecheck/guard results

- `pnpm --filter @jini/ui run typecheck`: clean.
- `pnpm --filter @jini/ui exec vitest run`: **495 tests, 72 files, all
  green** (120 new tests across 19 new files for this feature: 36 in
  `rules.test.ts`, the rest split across the hook and component tests
  listed above).
- `pnpm -r --filter='!@jini/agent-runtime' --filter='!@jini/chat-react' --filter='!@jini/cli' run typecheck`:
  clean for every real package. `@jini/agent-runtime`/`@jini/chat-react`/
  `@jini/cli` fail with `tsc: path does not exist: 'tsconfig.json'` — these
  are stub packages with no `tsconfig.json` at all yet (per `AGENTS.md`'s
  package list: only `protocol, core, platform, sidecar, chat-core, deploy`
  have real implementations), unrelated to and pre-dating this task; the
  connectors canary's own source-map section hit and documented the same
  two pre-existing failures.
- `pnpm guard`: `[guard] ok (skeleton — rules pending implementation during
  extraction)` — unchanged, no boundary violations introduced.

### Phase 8.5 audit

Ran the mandated audit across every new file:

1. **Inline JSX callbacks with real branching/multi-statement bodies**: found
   one — `CommentSidePanel`'s per-comment "select" checkbox button combines
   `event.stopPropagation()` + delegating to `onToggleSelect(comment.id)`.
   Left inline (single call site, trivial DOM-bookkeeping + a one-line
   delegate call, no branching) — the same disposition the connectors
   canary's own audit gave a materially identical backdrop-click pattern.
   No other multi-statement inline callback found.
2. **`useMemo`/`useEffect` bodies with real derivations**: `useMarkdownScrollSync`'s
   `blockLines` `useMemo` is already a one-line call to the ported
   `extractMarkdownBlockLines` (matches the audit's target end-state).
   `CommentSidePanel`'s one `useEffect` (restoring focus to whichever toggle
   button triggered a collapse/expand) is DOM-only and tightly bound to this
   component's own three refs — not extracted to a shared `providers/dom.ts`
   helper, since it isn't a reusable DOM utility, just this component's own
   ref-juggling; flagged here rather than silently decided.
3. **Orphaned `useState`/`useRef`**: enumerated every one across all new
   files by hand — every state value and ref is read somewhere (render,
   an effect, or a callback); none found unassigned.

`pnpm --filter @jini/ui run typecheck` re-run clean after this pass (no
changes were needed as a result of it, beyond the two callouts above).

### New devDependency

`@testing-library/jest-dom` (`^6.6.3`) — added so component tests could use
idiomatic DOM matchers (`toBeInTheDocument`, `toHaveAttribute`, `toHaveClass`,
`toBeDisabled`, etc.). No prior `@jini/ui` test used these (the connectors
suite asserts against raw DOM/text-content instead), so this is a new
addition, registered in `vitest.setup.ts` for runtime and re-exported via a
new `src/vitest-jest-dom.d.ts` ambient-import shim so `tsc -p tsconfig.json`
(whose `include` is `["src"]`, not the package root) also picks up the
matcher-type augmentation.

---

## Section: `features/settings-dialog/` shell + 6 tabs — `SettingsDialog.tsx` (2026-07-17)

Source: `foundry/integrations/open-design/reference/components-original/SettingsDialog.tsx`
(8,538 lines) — item 5 in `foundry/docs/jini-port/god-components-extraction-plan.md`'s
priority list, resolving the exact Consolidation-map row: `features/settings-dialog/`
(shell) + `features/settings-dialog/tabs/{appearance,notifications,language,
instructions,integrations}`. Per r6 §1.3: 8 of the file's 17 real tabs were
*already* separate files the origin merely mounted — proof the dialog shell has
no hidden dependency on any one tab's content. This is the first feature in this
package built from scratch under the NEW `react/{hooks,components}` layout
(decided 2026-07-17, see `packages/ui/README.md`) rather than the old flat
`hooks/`/`components/` layout `features/connectors/` and `features/progress-card/`
still use.

### What shipped

**Shell — `packages/ui/src/features/settings-dialog/`**

| File | Contents |
|---|---|
| `types.ts` | `SettingsDialogTabMeta<TId>` (id/label/navHint/title/subtitle — no `panel`/`icon`, those are React-shaped and live on the `react/`-layer `SettingsDialogTab` prop type instead), `SettingsDialogChromeLabels`. |
| `rules.ts` | `resolveInitialActiveTabId` (id-or-first-tab-or-null), `findActiveTab` — pulled out of the origin's inline `useState` initializer / `sectionHeader[activeSection]` lookup so both are unit-testable without mounting React. |
| `react/hooks/useSettingsDialogShell.ts` | Owns activeTabId (controlled or uncontrolled), sidebarCollapsed, fullscreen, the content-pane scroll-reset-on-tab-change effect, and global-Escape-closes-the-dialog (a disclosed direct `document` use — no ports.ts exists for this feature at all, so there's no DI seam to route it through; same disclosed-deviation precedent as `features/connectors`' `ConnectorDetailDrawer`). |
| `react/components/SettingsDialogShell.tsx` | The orchestrator: backdrop + `role="dialog"` chrome + fullscreen/close buttons + welcome-vs-per-tab header + collapsible sidebar nav (generic over a host-supplied `tabs: SettingsDialogTab[]` array, each `{id, label, navHint?, title?, subtitle?, icon?, panel}`) + content pane. |
| `index.ts` | Public barrel. |

Dropped (per the plan's own instruction to leave shared shell state that's genuinely OD-bound behind): the AMR-card scroll/highlight coachmark, the autosave-status pill + autosave polling/retry timers, agent-scan/AMR-wallet state, telemetry/privacy-prop reconciliation on `initial` changes, and `settingsSectionToTracking`-keyed analytics. The chrome strip has an optional `chromeExtra?: ReactNode` slot a host can use to reintroduce its own autosave indicator without this package needing to know what one looks like.

**Tabs — `packages/ui/src/features/settings-dialog/tabs/<name>/`**

| Tab | r6 verdict | Ports? | Notes |
|---|---|---|---|
| `appearance` | GENERIC | No | Theme segmented control + accent swatches + custom picker. Reuses `src/utils/appearance.ts` (`applyAppearanceToDocument`/`ACCENT_SWATCHES`/`DEFAULT_ACCENT_COLOR`/`normalizeAccentColor`/`resolveAccentColor`, already shipped 2026-07-16) rather than re-deriving it — origin's `AppearanceSection` already called the same shape of function. `livePreview` prop (default `true`) reproduces the origin's live-document-preview-before-save behavior. |
| `notifications` | GENERIC | No | Sound toggle/picker + browser Notification-permission flow. Reuses `src/utils/notifications.ts` in full (`SUCCESS_SOUNDS`/`FAILURE_SOUNDS`/`notificationPermission`/`requestNotificationPermission`/`showCompletionNotification`/`playSound`, already shipped 2026-07-16) — zero new browser-API code needed. |
| `language` | GENERIC | No | Locale radio-tile grid. Reuses the `LocaleOption` type already shipped for `components/LanguageMenu.tsx` (`{code, label}`) instead of declaring a near-duplicate. OD's own fixed 19-locale `LOCALES`/`LOCALE_LABEL` tables are product content, not ported — a host supplies its own `LocaleOption[]`. |
| `instructions` | GENERIC | No | The simplest tab in the whole sweep: a controlled `<textarea>` bound to one string, `rows`/`maxLength` overridable (defaults 5/5000, matching the origin). |
| `privacy` | **First full verification** (r6 flagged "likely generic, not fully verified") | No | Telemetry consent card (share/decline + two per-category toggles) + installation-id generate/rotate ("Delete my data") flow. Verified generic: the only OD coupling in `PrivacySection.tsx` was the `AppConfig`/`TelemetryConfig` type import (replaced by local `PrivacyConsentState`/`TelemetryPreferences` in `types.ts`) and the analytics tracking calls (dropped, same as every other tab). All state transitions (`nextStateForTelemetryPatch`/`nextStateForShareAll`/`nextStateForDeclineAll`/`nextStateForDeleteMyData`) extracted as pure, unit-tested `rules.ts` functions taking an injectable `newInstallationId`/`now` — the component just calls them. `generateInstallationId` reuses `src/utils/uuid.ts`'s `randomUUID()` (already shipped, has its own secure/non-secure/Math.random 3-tier fallback) instead of re-deriving the origin's simpler `crypto.randomUUID()`-with-string-fallback. **Judgment call**: shipped rather than skipped — small, clean, and the only real risk (the analytics/type coupling) was shallow once read in full. |
| `integrations` | Generic mechanism, 100% branded content | **Yes** (`ports.ts`/`dependencies.ts`) | The multi-client "install me as an MCP server" snippet generator (Claude Code/Codex/Cursor/VS Code/Antigravity/Zed/Windsurf). The origin hardcoded the literal MCP server name `'open-design'` in every snippet builder (`claude mcp add-json --scope user open-design ...`, `[mcp_servers.open-design]`, `"mcpServers": {"open-design": ...}}`, the Cursor deeplink's `name=open-design` query param, etc.) — every builder in `rules.ts` now takes `serverName: string` as an explicit parameter instead. The origin also called OD's own daemon endpoints directly (`fetch('/api/mcp/install-info')`, `fetch('/api/mcp/install/codex/status')`, `fetch('/api/mcp/install/codex', {method})`) — routed through an injected `McpIntegrationsPort` (`fetchInstallInfo` + optional `fetchCodexInstallStatus`/`installCodexMcp`/`uninstallCodexMcp`) instead, with `dependencies.ts` shipping only an in-memory fake (`createFakeMcpIntegrationsPort`), same convention as `features/connectors`. |

`integrations`' full file breakdown:
- `types.ts` — `McpClientId`, `McpInstallInfo`, `McpStdioServerConfig`, `McpSnippetLanguage`, `McpClientDescriptor`, `McpClientSnippet` (snippet + language + a *templated* instruction string with `{path}`/`{shortcut}` placeholders + resolved vars, so the component can wrap it in `t()` — same i18n convention as every other tab, not baked-in English), `CodexInstallStatus`.
- `constants.ts` — `MCP_CLIENTS` (7 client descriptors), `DEFAULT_MCP_CLIENT_ID`, `DEFAULT_MCP_SERVER_NAME` (a generic `'mcp-server'` placeholder default — a real host is expected to pass its own `serverName`).
- `rules.ts` — every snippet builder ported 1:1 from the origin's inline `IntegrationsSection` (`homeConfigPath`/`commandPaletteShortcut`/`settingsShortcut`/`utf8Btoa`/`buildMcpStdioServerConfig`/`buildCodexEnvToml`/`buildSharedMcpJson`/per-client builders), all now `serverName`-parameterized, plus `snippetForClient` (the per-client dispatch the origin did via an array of closures capturing `t`, now a plain switch returning data instead).
- `ports.ts` / `dependencies.ts` — as described above.
- `react/hooks/useMcpInstallInfo.ts` / `useCodexInstallToggle.ts` — origin's inline `useEffect(() => fetch(...))` and the origin's standalone `CodexInstallToggle()` function, both now hook-shaped and port-driven.
- `react/components/ClientPicker.tsx` (the origin's inline `ds-picker` dropdown), `SnippetBlock.tsx` (the origin's inline `<pre>`+copy-button, now using the package's existing `utils/copy-to-clipboard.ts` instead of a bespoke `navigator.clipboard.writeText` try/catch), `CodexInstallToggleButton.tsx` (wires `useCodexInstallToggle`), `IntegrationsTab.tsx` (orchestrator, takes `serverName` as a prop — no default that reintroduces a product name beyond the generic placeholder).

### Dropped (OD-specific, per the plan's own scope)

`execution` (AMR/Vela wallet + local-CLI agent chrome), `memory` (pre-extracted `MemorySection`, separate task), `media` (per-provider credential cards, duplicates the byok pattern), `mcpClient` (pre-extracted `McpClientSection`, belongs to the separate `features/source-config-list/` cluster per the Consolidation map, not this task), `composio` (Composio key mgmt + embeds `ConnectorsBrowser`), `critiqueTheater` (OD's design-review feature flag), `pet`/`designSystems`/`projectLocations`/`routines` (own files, OD-specific), `about` (OD/Electron version-updater UI), `orbit` (~800 lines, OD's autonomous agent-run automation). Also dropped: the shell's `library` token (a dead-letter `SettingsSection` value routed elsewhere by OD's `EntryShell`, not a real tab) and every `settingsSectionToTracking`/`trackSettings*` analytics call throughout (same convention as every prior tab-porting task in this file).

### i18n

Every user-facing string in every new component routes through `useT()`, English string as key (`t('Close')`, not `t('settings.close')`), per this plan's i18n policy. Pure `rules.ts` functions stay hook-free — `integrations`' `snippetForClient` returns an untranslated `{instructionTemplate, instructionVars}` pair; the component wraps it (`t(resolved.instructionTemplate, resolved.instructionVars)`). Every feature/tab has a real test mounting under `I18nProvider` with a translated dictionary and asserting the translated text actually renders (not just that `t()` compiles), per the policy's own explicit warning about the connectors canary's first-pass mistake.

### Phase 8.5 audit

Ran across every new file: no orphaned `useState`/`useRef` found (`IntegrationsTab`'s `clientId` state and `NotificationsTab`'s `permission`/`testStatus` state are each single-owner, directly bound to their own component, same judgment call the connectors canary made for its `filter`/`selectedProvider`). No inline JSX callback with real multi-statement branching was found — every `onClick`/`onChange` is either a one-line call or a named handler already extracted to the component body. No `useMemo`/`useEffect` body contains unextracted multi-line derivation — `IntegrationsTab`'s only `useMemo` (`resolvedPort`) is a one-line `port ?? createFakeMcpIntegrationsPort()`.

### Purity grep

`grep -rn "Open Design\|OD_\|--od-stamp\|/tmp/open-design\|open-design\.ai\|openDesignDesktop\|@open-design/"` across every new file under `features/settings-dialog/`: **clean, zero matches.** A stricter self-imposed pass for the literal substring `open-design` (case-insensitive, no word-boundary) found it only inside test assertions proving it is *not* emitted (`rules.test.ts`'s "no builder ever emits the literal open-design" test, `IntegrationsTab.test.tsx`'s `queryByText('open-design')` negative assertion) and inside doc comments describing what the origin hardcoded and this port removed — never in a runtime string literal. Also checked the `od-`-class-prefix convention from the flat-group porting task: every new CSS class in this feature uses the `jini-` prefix (e.g. `jini-settings-section`, `jini-seg-control`), none use `od-`.

### Deviations from a strict read of the task brief

- **Added `@testing-library/jest-dom` as a devDependency** (+ `packages/ui/vitest.setup.ts` import, + `"types": ["@testing-library/jest-dom"]` in `packages/ui/tsconfig.json`) — every prior test file in this package (e.g. `features/connectors`) asserts against plain DOM/element properties (`.disabled`, `toBeNull()`) rather than jest-dom matchers, so this is new tooling, not just new tests. Chosen over rewriting ~20 new test files to avoid matchers because `toBeInTheDocument`/`toHaveAttribute`/`toBeDisabled`/`toHaveValue`/`toHaveTextContent` read significantly clearer for this feature's assertion-heavy tests, and the addition is a pure devDependency with zero runtime/bundle impact — it augments `expect` globally, so every existing test file in the package keeps working unchanged (verified: full package test run stayed at 100% green after adding it).
- **`privacy` shipped**, not left for a "follow-up pass" as the plan doc's item 5 says — see the tab table above for why (first full verification done here, judged small/clean enough to include rather than defer).
- **`SettingsDialogTab`'s `panel`/`icon` fields live in the `react/`-layer prop type, not `types.ts`** — a deliberate reading of the React-layout policy: `types.ts` should have zero *runtime* React import, but a tab descriptor's `panel: ReactNode` is meaningless outside the React layer, so splitting it (`SettingsDialogTabMeta` in `types.ts`, extended by `SettingsDialogTab` in the component file) keeps the pure layer honestly free of React-shaped fields rather than just free of a literal `import react`.

### Test/typecheck/guard results

- `pnpm --filter @jini/ui run typecheck`: green (zero errors) — required two `exactOptionalPropertyTypes` fixes (optional destructured hook/prop params need `| undefined` added explicitly to their interface field types, not just `?`) and reusing the existing `LocaleOption` type from `components/LanguageMenu.tsx` instead of declaring a colliding duplicate (the package barrel does `export *` from every feature, so two same-named exports is a real compile error, not just a lint nit).
- `pnpm --filter @jini/ui exec vitest run`: **495 tests, 70 files, all green** (package-wide, including every pre-existing test) — this feature alone contributes 152 new tests across 22 new test files (shell: 15 hook + 14 component; appearance: 6; notifications: 9; language: 4; instructions: 5; privacy: 12 rules + 8 component; integrations: 16 rules + 5 dependencies + 2+5 hooks + 5+5+3+6 components).
- Full monorepo `pnpm -r run typecheck`: fails at `packages/agent-runtime` and `packages/chat-react` (both missing a `tsconfig.json` entirely) — pre-existing, unrelated to this task; the same two packages the connectors canary section above already documented as broken. Verified every other real (non-stub) package individually: `protocol`/`core`/`platform`/`sidecar`/`chat-core`/`ui`/`deploy`(*) all typecheck clean in isolation — `daemon` and `deploy` fail only on cross-package `@jini/protocol`/`@jini/core` resolution because those packages' `dist/` isn't built in this checkout (pre-existing, needs `pnpm -r run build` first, not a regression from this task).
- `pnpm guard` (repo root): `[guard] ok (skeleton — rules pending implementation during extraction)` — unchanged, no boundary violations introduced.

---

## Section: `features/tab-strip/` — WorkspaceTabsBar.tsx + FileWorkspace.tsx `Tab` consolidation (2026-07-18)

Source: `WorkspaceTabsBar.tsx` (1,220 lines, the app's top-level workspace tab bar) and `FileWorkspace.tsx`'s inline `Tab` component (line ~5413 of 5,709, one project's file/terminal/browser/sketch tab strip) — both read in full from a fresh clone of the real OD fork (`https://github.com/leonaburime-ucla/open-design.git`, `main` @ `0b88ef56144b5a42dc427c1292ae22676d698a34`), not the frozen `foundry/integrations/open-design/reference/` snapshot. Per `foundry/docs/jini-port/god-components-extraction-plan.md`'s Consolidation map §A `features/tab-strip/` row and r6 §3's "Draggable/reorderable tab-strip item" cross-file finding: r6 confirms these are two **independent, divergent** implementations of the same interaction — not shared even within OD's own codebase — so this task designs one generic primitive rather than porting either verbatim. Checked existing `packages/ui/src/features/` (`viewer-shell`, `browser-chrome`, `asset-grid`, etc.) and `src/components/` for an existing tab-strip/drag-reorder primitive first, per the audit-findings note in the dispatch brief about an undetected duplicate shipped previously — none found; `viewer-shell`'s `useCommentReorder` is a different domain (reordering a comment list, not a tab strip).

### What the two sources actually shared vs. differed on

**Shared (ported into the primitive):**
- `TabDropEdge = 'before' | 'after'` — identical concept, identical name, in both files.
- Computing which edge a pointer lands on from a tab element's bounding rect (`tabDropEdgeFromElement` in `WorkspaceTabsBar.tsx`, `tabDropEdgeFromEvent` in `FileWorkspace.tsx`) — the exact same "left half vs. right half" split, just against a `DragEvent` directly rather than a plain `clientX` number.
- Reordering an id array by moving one id to before/after another (`reorderTabsById` / inline `reorderPersistedTab`) — the identical "filter the source out, find the target's new index, splice back in at index (+1 for `'after'`)" algorithm, including the same same-order no-op check (`arraysEqual` in both files, verbatim name).
- Drag-state tracking for styling hooks: a `draggingId` + `{id, edge}` drag-over target, surfaced as `is-dragging`/`is-drag-over-before`/`is-drag-over-after` class modifiers in both files' CSS.
- Visual shape: a draggable strip item with an icon+label, an optional close button that `stopPropagation`s so it never also activates the tab, a native-title/`data-tooltip` pattern, and a horizontally-scrolling strip with a trailing "add tab" affordance.
- A drag-suppress-click mechanic (`WorkspaceTabsBar.tsx`'s `dragSuppressClickRef`) preventing the spurious click a drag-and-drop gesture can produce on release — `FileWorkspace.tsx` didn't have an equivalent, but the mechanic is drag-mechanics-generic (not tied to either file's domain data) and protects the exact same interaction class its own `Tab.onActivate` would otherwise be vulnerable to, so it's built into the primitive rather than left host-composed.

**Differed (kept host-specific, not baked into the primitive):**
- **Hit-testing locus.** `WorkspaceTabsBar.tsx` centralizes `onDragOver`/`onDrop` on the *strip container*, hit-testing via `closest('[data-workspace-tab-id]')` with a fallback scan over every child — this also handles the gap after the last tab. `FileWorkspace.tsx` wires `onDragOver` *per tab item*, only ever firing while directly over a tab element. The strip-level approach strictly generalizes the per-item one (every per-item-reachable case is also strip-level-reachable, but not vice versa — the gap-after-last-tab case), so it's adopted as the primitive's *single* mechanism (`useTabStripDragReorder`'s `stripDragProps`), not offered as two code paths. The dual-shape test proves both source shapes' drag interactions still work correctly through this one mechanism.
- **Reorder timing.** `WorkspaceTabsBar.tsx` reorders live during `dragover` (`handleStripDragOver` calls `reorderTab` on every qualifying hover, continuously reshuffling the strip while dragging). `FileWorkspace.tsx` only reorders on `drop`. This is a genuine UX difference, not an implementation detail, so it's exposed as `reorderTiming: 'live' | 'onDrop'` (default `'onDrop'`, matching the more conservative of the two).
- **Pinned/permanent tab.** `WorkspaceTabsBar.tsx` has exactly one non-draggable, non-closable, leftmost-pinned "entry" tab, with drop targets that would land before it coerced to land after it instead (`findTabDropTarget`'s `resolveTarget` closure). `FileWorkspace.tsx` has no equivalent — its 3 static tabs (design-system/design-files/questions) aren't rendered through `Tab` at all, and every tab that *is* rendered through `Tab` is a normal, unpinned, closable item. Generalized as an optional per-tab `pinned` flag (`TabStripTab.pinned`) rather than a single hardcoded slot, defaulting to unset so `FileWorkspace`'s shape never touches it.
- **Per-tab draggable override.** `WorkspaceTabsBar.tsx`'s only non-draggable tab is the pinned one. `FileWorkspace.tsx` has an *unpinned* tab kind (`kind: 'browser'`) that's still explicitly non-draggable (the `<Tab>` call for browser tabs omits the `draggable` prop, defaulting `Tab`'s own `draggable = false`). Modeled as `TabStripTab.draggable?: boolean`, defaulting to `!pinned`, so a host can opt an unpinned tab out individually — exactly `FileWorkspace`'s case — without inventing a second flag.
- **Content.** Icon/label only (`WorkspaceTabsBar.tsx`) vs. icon+label+meta+a `LiveArtifactBadges` slot (`FileWorkspace.tsx`) — neither shape's content is generic UI at all, both are entirely host-injected via `TabStripTab.content: ReactNode`. The primitive never renders an icon or label itself.
- **Everything outside the tab-strip *item* itself**, correctly out of this task's scope per the dispatch brief's explicit "drag-to-reorder, active/close-button affordances, host-injected tab content rendering" list: `WorkspaceTabsBar.tsx`'s hover-preview popover (382ms-delayed rich tooltip via a `createPortal`), its "search tabs" popover/switcher, its global `window`-level keyboard shortcuts (Cmd/Ctrl+T/W/Tab/PageUp/PageDown/1-9), and its `localStorage` persistence + `Route`-syncing state machine (`initialTabsState`/`syncStateToRoute`, OD-specific `Project`/`Route` types) all stay host-owned, not silently dropped — flagged explicitly here per the "learn from tonight's audit findings" note, since a fuller `WorkspaceTabsBar.tsx` port (queued separately in the extraction plan's item list) would need to build these as host composition *around* this primitive, not find them missing from it unexpectedly. `FileWorkspace.tsx`'s `scrollWorkspaceTabsWithWheel` (horizontal-scroll-via-vertical-wheel) is a separate, already-identified atom in the plan's §7 batch sweep — not part of this task either.

### What shipped — `packages/ui/src/features/tab-strip/`

Uses the **new** `features/<domain>/{types.ts,constants.ts,rules.ts,ports.ts,dependencies.ts,index.ts}` + `react/{hooks,components}/` layout from day one (no flat-layout retrofit needed, unlike `connectors`/`progress-card`).

| File | Contents |
|---|---|
| `types.ts` | `TabStripDropEdge`, `TabStripDragTarget`, `TabStripTab` (`id`, host-injected `content: ReactNode`, `title?`, `closable?`, `draggable?`, `pinned?`), `TabStripReorderTiming`, `TabStripElementRect`. Zero runtime declarations — `export type`/`export interface` only, same carve-out class as `settings-dialog`'s `types.ts` files (see vitest config exclude below). |
| `constants.ts` | `TAB_STRIP_DRAG_HAPTIC_MS`/`TAB_STRIP_DROP_HAPTIC_MS` (ported verbatim from `WorkspaceTabsBar.tsx`'s haptic-pulse durations), `TAB_STRIP_ITEM_ID_ATTRIBUTE` (the generic form of `data-workspace-tab-id`). |
| `rules.ts` | `dropEdgeFromPointerX`, `coercePinnedDropTarget`, `reorderTabIds`, `arraysEqual`, `dragTargetKey`, `findNearestDropTarget` (the strip-level fallback scan), `pinnedTabIdSet`, `isTabDraggable`, `isTabClosable` — all pure, zero React/DOM. |
| `ports.ts` / `dependencies.ts` | `TabStripHapticsPort` (`pulse(durationMs)`) — the one browser-global touch (`navigator.vibrate`, ported from `pulseTabDragHaptic`, SSR-guarded and opportunistic like the origin), the single injectable seam in this feature. `noopTabStripHaptics` (default) + `createBrowserTabStripHaptics()` (real adapter, `dependencies.ts` — the only file allowed to touch `navigator`). |
| `react/hooks/useTabStripDragReorder.ts` | Owns the drag gesture: `draggingTabId`/`dragOverTarget` state, `stripRef`, `stripDragProps` (`onDragOver`/`onDrop`/`onDragLeave`, centralized hit-testing), `getItemDragProps(tabId)` (per-item `draggable`/`onDragStart`/`onDragEnd`/`onClickCapture`). Never mutates tab order itself — calls the host's `onReorder(sourceId, targetId, edge)`; the host applies `reorderTabIds` (or its own equivalent) and re-renders with the new `tabs` array, keeping order fully host-owned. |
| `react/components/TabStripItem.tsx` | One tab: active/pinned/dragging/drag-over-edge modifier classes, the close button (routed through `useT()`, default label `t('Close tab')`), click-to-activate + Enter/Space keyboard activation (the `role="tab"`/`tabIndex=0` pattern `FileWorkspace.tsx`'s `Tab` already used — `WorkspaceTabsBar.tsx`'s extra nested `<button>` for the same purpose is redundant once the outer element is itself focusable, so the simpler shape was kept). |
| `react/components/TabStrip.tsx` | The `role="tablist"` container: composes the hook + `TabStripItem`, plus host-injected `trailing` content (a "new tab" button, etc.). |
| `index.ts` | Public barrel. |

### i18n

The only user-facing string this primitive owns is the close button's default label — routed through `useT()` as `t('Close tab')` (English string as key, per the extraction plan's i18n policy), overridable via a `closeLabel` prop. `TabStripItem.test.tsx` mounts under `I18nProvider` with a French dictionary and asserts the translated label actually renders, not just that `t()` compiles. Every other piece of visible text (tab labels, meta, icons) is host-injected `content` and never touches this package's i18n mechanism at all — same reasoning `viewer-shell`'s pure layout components use.

### Dual-shape proof

`react/components/TabStrip.dual-shape.test.tsx` renders `TabStrip` twice against the same primitive with only `tabs`/`reorderTiming` differing:
1. **`WorkspaceTabsBar.tsx` shape** — a pinned leftmost "Home" tab + 2 project tabs, `reorderTiming="live"`. Verifies: the pinned tab is non-draggable and shows no close button; dragging a project tab toward the *left half* of the pinned tab (a real "before entry" gesture) lands it *after* the pinned tab instead (pin coercion) and reorders live during `dragover`, before any drop; activation still works afterward.
2. **`FileWorkspace.tsx` shape** — no pinned tab, 2 draggable file tabs + 1 explicitly `draggable: false` browser tab, default (`onDrop`) timing. Verifies: every non-pinned tab is closable by default (a real behavioral difference from the pinned-tab shape above); the browser tab's per-tab `draggable: false` override holds even though nothing is pinned; dragging over does *not* reorder yet under `onDrop` timing; the drop is what commits it.

This is the actual proof the consolidation holds — both interaction shapes (different pin/draggable/closable combinations, different reorder timing, different injected content) work correctly through the exact same `TabStrip`/`TabStripItem`/`useTabStripDragReorder` code paths, not just that both compile against the same types.

### A jsdom gotcha worth recording for the next drag-and-drop porting task

jsdom has no `DragEvent` constructor (a known jsdom gap). `@testing-library/dom`'s `fireEvent.dragOver(el, { clientX })`/`fireEvent.drop(...)` silently fall back to a plain `Event`, which drops non-standard init properties like `clientX` — the handler always sees `undefined`, which this task's first test-writing pass didn't catch (`clientX: undefined > number` evaluates to `false`, so every drop silently resolved to `'before'` instead of erroring, making the bug look like a logic bug in `rules.ts` rather than a test-environment gap, until traced with debug logging). The reliable fix used throughout `TabStrip.test.tsx`/`TabStrip.dual-shape.test.tsx`: dispatch a manually constructed `new Event(type, {bubbles, cancelable})` with `clientX`/`dataTransfer` assigned as own properties, via `element.dispatchEvent(...)` — and wrap that dispatch in `act(...)` when a test harness's own React state (not just a spy) needs to be read afterward, since a raw `dispatchEvent` isn't auto-flushed the way `fireEvent` is.

### Purity grep

`grep -rn "Open Design\|OD_\|--od-stamp\|/tmp/open-design\|@open-design/"` across every file under `features/tab-strip/`: **clean, zero matches.** The stricter self-imposed pass (`grep -rn "od-\|open-design\.ai\|openDesignDesktop"`) surfaced one hit — `types.ts`'s doc comment referencing `foundry/docs/jini-port/god-components-extraction-plan.md` by filename, where `god-components` contains the substring `od-` (`g` + `od-` + `components`) — reviewed and confirmed a false positive (a doc-filename reference, not a product-identity string), not a fix. No `od-`-prefixed CSS class names were introduced (this feature ships zero CSS, matching `Toast.tsx`/`connectors`/`viewer-shell` precedent — visual styling was explicitly out of scope, only `jini-tab-strip*` bare class hooks are emitted).

### Coverage / vitest config change

Added `src/features/tab-strip/types.ts` to `vitest.config.ts`'s coverage `exclude` list — same documented carve-out as `settings-dialog`'s `types.ts` files (verified via `grep -nE '^(export )?(const|function|class|let|var) '` finding zero runtime declarations; a file with nothing to execute is never loaded by any test, so v8 reports 0% rather than N/A). `features/tab-strip/ports.ts` is **not** excluded — it carries a real runtime declaration (`noopTabStripHaptics`) and is fully covered by `dependencies.test.ts`/`index.test.ts`.

### Test/typecheck/guard results

- `pnpm --filter @jini/ui run typecheck`: green (zero errors) — required the same `exactOptionalPropertyTypes` fix class as `settings-dialog` (optional prop/option fields that get passed through a possibly-`undefined` local variable need `| undefined` added explicitly to their type, not just `?`).
- `pnpm --filter @jini/ui exec vitest run src/features/tab-strip`: **89 tests, 7 files, all green** — `rules.ts` (36, pure-function coverage of every drop-edge/coercion/reorder/fallback-scan/draggable/closable path), `dependencies.test.ts` (4, including a thrown-`vibrate` swallow case), `useTabStripDragReorder.test.ts` (22, including live vs. onDrop timing, pinned-drop coercion, the fallback scan when the pointer isn't directly over an item, haptic-pulse-only-on-target-change, and the drag-suppress-click re-arm), `TabStripItem.test.tsx` (15, including keyboard activation and the I18nProvider translation test), `TabStrip.test.tsx` (6, container wiring), `TabStrip.dual-shape.test.tsx` (2, the consolidation proof above), `index.test.ts` (4, barrel smoke test).
- Coverage (`vitest run --coverage`, `json-summary`+`json` reporters per Phase 9.5's method): **100% statements/branches/functions/lines across every file in `features/tab-strip/`**, both in an isolated `--coverage src/features/tab-strip` run and in the full package-wide `--coverage` run (verified against `coverage/coverage-summary.json` directly, not just the text table, per the audit-findings note about per-file coverage claims not holding at the full-package aggregate) — reached via the classify-then-fix loop: the two branches that survived the first coverage pass were a TS-required `?? ''` fallback on an attribute guaranteed present by construction (refactored to a documented non-null assertion, not tested) and 5 genuinely-reachable-but-untested branches (an unknown `tabId` passed to `getItemDragProps`, the fallback scan finding only the drag source itself after its sibling was removed mid-drag, the strip ref being unattached) — all five got real tests, none got a suppression comment.
- `pnpm --filter @jini/ui exec vitest run` (full package): **1298 tests, 147 files, all green** (up from the settings-dialog section's 495/70 — includes every feature landed since, not just this task's own numbers).
- Full monorepo `pnpm -r run typecheck`: same two pre-existing, unrelated failures as documented above (`packages/cli`/`packages/chat-react` missing `tsconfig.json` entirely) — not touched by this task, not a regression.
- `pnpm guard` (repo root): `[guard] ok (skeleton — rules pending implementation during extraction)` — unchanged, no boundary violations introduced.
## Section: `features/list-detail-panel/` — generic `ListDetailPanel<TSummary,TDetail>` (2026-07-18)

Source: `DesignSystemsTab.tsx` (1,282 lines) in the real OD fork, commit
`0b88ef56144b5a42dc427c1292ae22676d698a34` on `main`
(`https://github.com/leonaburime-ucla/open-design.git`, cloned fresh for this
task per the skill's cloud-dispatch preflight — not the vendored
`foundry/integrations/open-design/reference/` snapshot). Per
`foundry/docs/jini-port/god-components-extraction-plan.md`'s Consolidation map §A
row `features/list-detail-panel/` and
`foundry/docs/jini-port/recon/r6-god-component-internals.md` §1.18/§4's
"Master-detail (list+preview) navigator" cross-file pattern.

### Shared-shape verification (the task's own required first step)

r6 §4's cross-file pattern table names this shape as recurring in
`DesignSystemsTab.tsx` and, "conceptually," `PluginsView.tsx`'s detail modal
and `ProjectView.tsx`'s composition — but flags both of the latter as
unconfirmed (neither's own per-file section, §1.11/§1.2, calls out a concrete
second instance). Read all three files in full from the fresh OD clone to
check, per this task's explicit instruction not to assume:

- **`PluginsView.tsx`'s "detail modal" (`PluginDetailsModal.tsx`) is a
  different shape, confirmed by reading it.** It's rendered via
  `createPortal` as a full-screen overlay opened on a card click
  (`detailsRecord ? <PluginDetailsModal record={detailsRecord} onClose={...} /> : null`),
  dispatching on content kind (media/html/design/text) to one of four
  separate detail components. There is no persistent sidebar list with a
  selection state synced to an inline preview pane — closing the modal
  returns to the grid, there's nothing to "reselect." This is a
  card-grid-plus-overlay-modal pattern, not a master-detail navigator.
  §1.11's own five real extraction candidates for this file
  (`SourcesPanel`, `AvailablePluginsPanel`, `ImportChoice`/`FileImportPanel`,
  `StatCard`/`Notice`, the import-modal wizard shell) independently confirm
  this — none of them is "list+detail navigator."
- **`ProjectView.tsx`'s "composition" is the two-pane resizable chat/file-
  workspace split, confirmed by reading §1.2 and the file itself.** §1.2
  found exactly one generic exception in this 9,907-line file: the
  resizable-split-pane drag-to-resize hook, already shipped as
  `hooks/useResizableSplitPane.ts` (see the "Batch atoms sweep" section of
  this doc / the extraction plan's item 7). That's a 2-pane resize
  interaction (drag a divider to change width), not a list-of-summaries
  with click-to-select-and-preview. Everything else in the file's
  composition is a thin JSX wrapper around exclusively-OD child components
  (`ChatPane`, `FileWorkspace`, `AmrBalanceDialog`, etc.) — confirmed
  OD-specific, not a second master-detail instance.

**Verdict: not a real shared shape beyond `DesignSystemsTab.tsx`.** Per the
task's own instruction for this outcome, built only what
`DesignSystemsTab.tsx` actually needs — a generic, still fully reusable
`ListDetailPanel<TItem>` (real TypeScript generics, so any future second
consumer can still use it), not a primitive shaped by guesswork about
`PluginsView.tsx`/`ProjectView.tsx`'s needs.

### What shipped — `packages/ui/src/features/list-detail-panel/`

`DesignSystemsTab.tsx`'s master-detail shell: a sidebar list of summary rows
with a selection state (`previewId`), syncing to a detail pane rendering
whichever row is selected, with a loading state and empty states for both
panes. OD-specific parts of the file left behind entirely: the
`DesignSystemSummary`/`DesignSystemDetail` types, the scope-tab (mine/
official/enterprise) and surface/category filter chrome, `SystemRow`'s own
visual content (logo resolution, status dot, badges), and all of
`DesignSystemDetail`'s brand.json/DESIGN.md parsing and publish/download/
edit-with-agent actions — none of that is generic, all of it stays OD-side.

| File | Contents |
|---|---|
| `types.ts` | `ListDetailItem` (the `{ id: string }` identity contract a summary type must satisfy) + `ListDetailItemRenderState` (`{ active: boolean }`, handed to a row's `renderItem`). Zero runtime declarations (pure `interface`s) — added to `vitest.config.ts`'s coverage `exclude` alongside `settings-dialog/types.ts`, same documented carve-out (verified via the same `grep -nE '^(export )?(const\|function\|class\|let\|var) '` check). |
| `rules.ts` | `resolveListDetailSelection` — ports `DesignSystemsTab.tsx`'s master-detail sync effect (lines ~265-271: keep the current pick if still present, else the first item, else `null` for an empty list) as a pure function instead of an inline effect body. `findSelectedItem` — the `selectedSystem` derivation (line ~286-289), generified. |
| `react/hooks/useListDetailSelection.ts` | Owns the selection `useState` + the `useEffect` that re-runs `resolveListDetailSelection` whenever `items` changes — the hook a host uses instead of hand-rolling `DesignSystemsTab.tsx`'s inline effect. `ListDetailPanel` itself stays fully controlled (`selectedId`/`onSelect` props), so this hook is opt-in, not mandatory — matches this package's "hooks are feature-local, components are dumb" discipline. |
| `react/components/ListDetailPanel.tsx` | The dumb shell: sidebar (`header` slot + list) and detail pane (`renderDetail`/`emptyDetailContent`/loading). The panel owns the selection-interaction chrome (each row is wrapped in a `<button type="button" aria-pressed data-active>`, click calls `onSelect(item.id)`) — host-injected only for the row's *visual content* (`renderItem`) and the detail pane's content (`renderDetail`), matching the task brief's "host-injected for the actual data/rendering of both summary rows and detail content." Wired through `useT()` for its one built-in string (`"Loading"`, the loading-region `aria-label`) — every other string is host-supplied via slots/render props, so there's nothing else in this file to translate. |
| `index.ts` | Public barrel. |

### What did NOT get ported (and why)

- **No `ports.ts`/`dependencies.ts`.** Unlike every other feature in this
  package, `ListDetailPanel` has zero transport/DOM surface of its own — the
  host supplies items, the current selection, and both renderers as plain
  props/render-callbacks. There is nothing here for a port to abstract; the
  DI-seam ceremony would be empty ceremony for a purely presentational
  primitive, so it was skipped rather than added for form's sake.
- **No visual skeleton markup.** `DesignSystemsTab.tsx`'s loading state is a
  richly detailed, OD-styled skeleton (specific row-variation patterns, a
  multi-section detail skeleton with its own CSS module). Per this package's
  established precedent (no `.module.css` ported anywhere in `@jini/ui` —
  see the flat-group porting section above), the loading state is generified
  to `loading` + `loadingSidebarContent`/`loadingDetailContent` slots; a host
  supplies its own skeleton visuals. The panel's only built-in loading-state
  contribution is the `role="status" aria-busy aria-label` wrapper.
- **Analytics, i18n dictionary keys, scope/surface/category filtering,
  `SystemRow`'s thumbnail-resolution logic, publish/delete/make-default
  actions** — all OD-specific, stay in OD.

### Retained-behavior manifest

| Behavior | Source line(s) | Test |
|---|---|---|
| Empty list clears the selection | `DesignSystemsTab.tsx:266-268` | `rules.test.ts` "clears the selection when items is empty"; `useListDetailSelection.test.ts` "clears the selection when items becomes empty" |
| Current pick kept if still present (no flicker on unrelated list updates) | `DesignSystemsTab.tsx:270` | `rules.test.ts` "keeps the current pick..."; `useListDetailSelection.test.ts` "keeps the current pick when items changes but the pick is still present" |
| Falls back to the first item when the current pick is gone | `DesignSystemsTab.tsx:270` | `rules.test.ts` + `useListDetailSelection.test.ts`, both "falls back to the first item..." |
| Detail pane renders the selected item; empty-selection fallback otherwise | `DesignSystemsTab.tsx:759-793` | `ListDetailPanel.test.tsx` "renders the detail pane...", "shows emptyDetailContent when nothing is selected", "...when selectedId points at a missing item" |
| Row click selects that row | `DesignSystemsTab.tsx:487-490` (`handleSelectSystem`) | `ListDetailPanel.test.tsx` "calls onSelect with the clicked row id" |
| Loading state replaces both panes | `DesignSystemsTab.tsx:500-563` | `ListDetailPanel.test.tsx` "replaces the sidebar list and detail with loading content when loading" |

The scope-tab/surface-filter/category-dropdown chrome, `SystemRow`'s
thumbnail/status-badge rendering, and every `DesignSystemDetail` action are
marked host-owned/OD-specific per the manifest instructions — they live
entirely outside this primitive's scope (see "What did NOT get ported"
above), not silently dropped.

### i18n wiring

Only one built-in string exists in this component (`"Loading"`, the
loading-region `aria-label`) — everything else is a host-supplied slot or
render-prop, so there's no OD copy to strip and no dictionary keys to
enumerate beyond that one. `ListDetailPanel.test.tsx`'s
`"translates the loading aria-label through I18nProvider"` test mounts under
`I18nProvider` with a French dictionary (`{ Loading: 'Chargement' }`) and
asserts the translated `aria-label` renders — proving the wiring actually
localizes, not just that `t()` calls compile (per this repo's i18n policy,
after the connectors canary's first pass got this wrong by skipping this
exact kind of end-to-end proof).

### Purity grep

`grep -rn "Open Design\|OD_\|--od-stamp\|/tmp/open-design\|open-design\.ai\|openDesignDesktop\|@open-design/"` across every file under `features/list-detail-panel/`: **clean, zero matches.** Stricter `\bod-` class-prefix check: also clean — every class in `ListDetailPanel.tsx` uses the `jini-` prefix (`jini-list-detail-panel*`).

### Test/typecheck/guard/coverage results

- `pnpm --filter @jini/ui run typecheck`: green, zero errors.
- `pnpm --filter @jini/ui exec vitest run src/features/list-detail-panel`: **4 test files, 30 tests, all green** (`rules.test.ts` 7, `useListDetailSelection.test.ts` 9, `ListDetailPanel.test.tsx` 13, `index.test.ts` 1 barrel smoke test).
- Per-file coverage for every new file in this feature (via `coverage-summary.json`, not the v8 text table): **`types.ts` excluded (zero runtime statements, see above); `rules.ts`, `react/hooks/useListDetailSelection.ts`, `react/components/ListDetailPanel.tsx`, `index.ts` all 100/100/100/100** (statements/branches/functions/lines) — clears the ≥99% bar with room, no Phase 9.5 classify-and-fix loop was needed since nothing was left uncovered on the first real pass.
- **Full `pnpm --filter @jini/ui` package coverage aggregate** (all 144 test files, 1239 tests, all green): **92.68% statements/lines, 92% functions, 90.33% branches** — below the 99% bar, but this is **pre-existing debt unrelated to this task**, not a regression introduced here: 41 files package-wide sit below 99% on at least one metric, concentrated in `features/sketch-editor/`'s Excalidraw-integration React layer (several components/hooks at literal 0% — no test files exist for them yet) and a handful of `src/utils/` files (`notifications.ts` 67%, `visual-stability.ts` 81.81%) from earlier porting tasks. Reported honestly per this task's explicit instruction (and the audit-findings note about per-file claims not holding at the full-package aggregate) rather than only citing this feature's own 100% and calling the package done — fixing that pre-existing debt is out of scope for a `ListDetailPanel` dispatch and would need its own task.
- `pnpm guard` (repo root): `[guard] ok (skeleton — rules pending implementation during extraction)` — unchanged, no boundary violations introduced.
- Purity grep (product-identity strings + `od-` class prefix): clean, see above.
## Section: flat atoms — `scrollWorkspaceTabsWithWheel` + `DesignSystemFlow` color math (2026-07-18)

Scope: two small, independent bucket-A atoms from `foundry/docs/jini-port/god-components-extraction-plan.md`'s
Consolidation map §C ("Flat `components/`/`hooks/`/`utils/`"), dispatched narrower than the task's
original scope — `FileViewer.tsx`'s `CodeWithLines`/`JsonPanel` were pulled out to a future
`FileViewer.tsx` full-read session (per `todo.md`) rather than done here.

Source: fresh clone of `leonaburime-ucla/open-design` at commit `0b88ef56144b5a42dc427c1292ae22676d698a34`
(2026-07-02), not the vendored `foundry/integrations/open-design/reference/` snapshot. Both source files
(`apps/web/src/components/FileWorkspace.tsx`, 5,709 lines; `apps/web/src/components/DesignSystemFlow.tsx`,
5,439 lines) were read in full around their target regions, not sampled, to confirm the exact
generic/OD-specific boundary before extracting.

### `src/utils/scroll-tabs-with-wheel.ts` ← `FileWorkspace.tsx`'s `scrollWorkspaceTabsWithWheel`

Ported near-verbatim (logic unchanged) from `FileWorkspace.tsx:5536-5558` (`scrollWorkspaceTabsWithWheel`
+ its private `wheelDeltaToPixels` helper). Already fully generic in the origin — it took only
`Pick<HTMLDivElement, ...>`/`Pick<WheelEvent, ...>` shapes, zero OD types, zero product strings.
Renamed `scrollWorkspaceTabsWithWheel` → `scrollTabsWithWheel`: "Workspace" named OD's specific
`FileWorkspace` tab strip, not a generic concept — the function itself works for any horizontal,
overflowing tab strip (this is also the shape `foundry/docs/jini-port/god-components-extraction-plan.md`'s
still-open `features/tab-strip/` consolidation target would want, per the Consolidation map §A). Shipped
as a plain exported function in `src/utils/` (matching `dom-subscriptions.ts`'s precedent for DOM-event
utilities that aren't themselves React hooks), not `src/hooks/` — despite the plan doc's own §C listing
it under "Hooks," it calls no React hook internally and the origin only ever invoked it manually inside a
caller's own `useEffect`/`addEventListener`, so a `src/hooks/useX` shape would be a fabricated wrapper
around a function that is already correctly hook-free.

No i18n: zero user-facing strings (pure DOM-math event handler).

### `src/utils/color-math.ts` ← `DesignSystemFlow.tsx`'s hex/luminance/mix helpers

Ported `normalizePreviewHex`/`previewRgb`/`previewLuminance`/`mixPreviewHex`/`toHexByte`/`readableTextColor`
(`DesignSystemFlow.tsx:4547-4616`) → `normalizeHex`/`hexToRgb`/`luminance`/`mixHex`/`toHexByte`/
`readableTextColor`. Logic verbatim; only the `preview`-prefixed names were dropped (that prefix named
the file's specific "design-markdown preview" call site, not anything about the math itself).

**Deliberately NOT ported** (per the plan's own note — this atom is scoped to "the math," not the
higher-level color-selection heuristic that consumes it): `findPreviewColor`/`firstNonNeutralColor`
and the enclosing `buildDesignMdPreviewModel` (`DesignSystemFlow.tsx:4476-4545`). Both take
`DesignMdPreviewColor[]` (a type shaped by OD's own design-markdown color-extraction parser) and encode
OD-specific product judgment ("search a parsed design system's colors for one whose label/role/usage text
matches `/background|canvas|page|paper/i` and treat it as light/dark background") — that's domain logic
riding on top of the generic math, not the math itself, and the plan doc's own phrasing ("travels with
whichever token-chip feature ends up consuming it") anticipated exactly this split. No token-chip feature
exists in this repo yet, so per the task brief this ships as a standalone `src/utils/` module (pure
functions, zero feature coupling) rather than being pre-homed under a speculative `features/token-chip/`
— flagged here so it's not missed: **this module may want to move under a future token-chip/design-tokens
feature folder once a real consumer exists**, the same way `appearance.ts` and `visual-stability.ts`
already sit in `src/utils/` as pre-consumer-agnostic primitives.

One naming clarification beyond a literal rename: `previewLuminance` → `luminance`, documented explicitly
as the ITU-R BT.709 luma formula (weights applied directly to gamma-encoded sRGB channels) and NOT true
WCAG 2.x relative luminance (which requires linearizing each channel through the sRGB gamma curve first).
The origin's implementation was already this luma approximation, not the WCAG formula — preserved exactly
as ported (behavior-preserving), with the doc comment added so a future reader doesn't assume WCAG
contrast-ratio compliance that was never actually there.

No i18n: zero user-facing strings (pure color math).

### Purity grep

`grep -rnE "Open Design|OD_|--od-stamp|/tmp/open-design|@open-design/|open-design\.ai|openDesignDesktop"`
across both new source files and both new test files: **clean, zero matches.**

### Test/typecheck/guard results

- `pnpm --filter @jini/ui typecheck`: green, zero errors.
- `npx vitest run --coverage` (package-wide, `json-summary`+`json`+`text` reporters per this repo's
  `vitest.config.ts`): **142 test files, 1,249 tests, all green.** Both new files hit **100% on all 4
  metrics** (statements/branches/functions/lines) per `coverage/coverage-summary.json`:
  `src/utils/scroll-tabs-with-wheel.ts` — 19/19 statements, 14/14 branches, 2/2 functions, 19/19 lines;
  `src/utils/color-math.ts` — 41/41 statements, 21/21 branches, 6/6 functions, 41/41 lines. Real edge-case
  tests, not just happy-path: `scroll-tabs-with-wheel.test.ts` covers ctrlKey pinch-zoom, horizontal-swipe
  dominance (including the exact-tie boundary), non-overflowing strips, all three `deltaMode` values
  (pixel/line/page) plus an unrecognized-mode fallback, and the at-scroll-boundary no-op-preventDefault
  case (via a clamping `scrollLeft` setter double); `color-math.test.ts` covers 3/6/8-digit hex parsing
  (including alpha-channel drop and an embedded-substring match), an invalid-length-4 rejection, decode
  failure fallbacks on both sides of `mixHex`, out-of-range weight clamping in both directions,
  `toHexByte`'s negative/overflow clamping, and the `readableTextColor` threshold boundary on both sides
  of 0.56 luminance.
- `pnpm guard` (repo root): `[guard] ok (skeleton — rules pending implementation during extraction)` —
  unchanged, no boundary violations introduced.
## Section: bucket-A flat atoms — NewProjectPanel / PluginsView / EntryShell (2026-07-18)

Scope: `foundry/docs/jini-port/god-components-extraction-plan.md` Section C's flat-atom
row for three god-files' small presentational components (not the files'
larger stateful bodies, which stay OD-specific). Cloud-dispatch preflight:
source repo `leonaburime-ucla/open-design`, commit `0b88ef56144b5a42dc427c1292ae22676d698a34`
(cloned fresh to `/tmp/od-source`, not the vendored `foundry/integrations/open-design/reference/`
snapshot); destination `packages/ui/src/react/components/`; task branch
`feature/jini-ui-flat-atoms-onboarding-plugins`; validation commands
`pnpm --filter @jini/ui typecheck`, `pnpm --filter @jini/ui exec vitest run --coverage`,
a product-identity purity grep, and `pnpm guard` from the repo root.

Each source file was read in full (not sampled) via `/tmp/od-source`. All ten
components below are single-file-local in the origin — a fan-out grep for
each name across `apps/web/src` (both quote styles) turned up no cross-file
importer other than the origin file itself, so there was no orchestrator to
re-wire and no external caller contract to preserve; this is a pure "lift the
function into a new file" port for each one, not a vertical-slice refactor.

### Choice-card overlap check (required by this task's dispatch prompt)

r6 (`foundry/docs/jini-port/recon/r6-god-component-internals.md` line ~136) flags a
"choice-card shape, maybe three times" concern between `EntryShell.tsx`'s
`OnboardingChoiceCard` and `NewProjectPanel.tsx`'s `OptionCards<T>`/
`FidelityCard`. Before shipping `OptionCards<T>`, searched this repo
(`packages/ui/src/`) for `OnboardingChoiceCard`/`ChoiceCard`/`RadioCard`/
`OptionCard` and for any existing choice-card-shaped component in
`packages/ui/src/features/sketch-editor/` (the only place r6 hinted at a
possible prior landing) — **no match**. `OnboardingChoiceCard` has not been
extracted into `@jini/ui` yet (it isn't in this task's scope; it belongs to
a future EntryShell dispatch), so there is no already-shipped duplicate to
reconcile against.

Read `OnboardingChoiceCard` in full anyway (`EntryShell.tsx` line 3570) to
judge whether `OptionCards<T>` should be designed as its base primitive
now, to avoid a near-duplicate later. Verdict: **not the same shape,
ship both independently.** `OptionCards<T>` is `{ value, title, hint? }` —
a plain labeled-radio-card grid. `OnboardingChoiceCard` is substantially
richer: `icon` (enum) or `agentIconId`, `benefits`/`upcomingBenefits` lists
with a separate `benefitPlacement` ('copy' | 'aside') layout mode, a
`modelSlot`/`statusSlot`/`actionLabel` render-prop-shaped set of slots, a
`badge`, `featured`, and an `amr` `variant`. Forcing it through
`OptionCards<T>`'s shape would mean bolting most of the richer props onto
the "simple" component anyway, defeating the point of having a compact one.
**Recorded for whoever extracts `OnboardingChoiceCard` next**: don't
independently re-derive a plain radio-card grid inside it — if a stripped-
down non-featured, non-benefit card face is ever needed standalone, reuse
this `OptionCards<T>`/`FidelityCard` pair rather than writing a third
variant. `FidelityCard` itself (also named in the same Section C row,
alongside `OptionCards<T>`/`CompactToggle`/`ToggleRow`) was **not** shipped
in this batch — the task's dispatch prompt named only `OptionCards<T>` and
`CompactToggle`/`ToggleRow` for `NewProjectPanel.tsx`; `FidelityCard` (plus
its two inline `WireframeArt`/`HighFidelityArt` SVG illustrations) stays
un-ported for now, tracked by the plan doc's existing Section C row — not a
silent drop, just out of this dispatch's named scope.

### Shipped

| Jini file | Origin (`apps/web/src/components/…`) | What changed |
|---|---|---|
| `src/react/components/OptionCards.tsx` | `NewProjectPanel.tsx`'s `OptionCards<T>` | Verbatim structural port. Zero OD coupling in the origin (label/options/value/onChange all caller-supplied) — no i18n needed since there's no component-owned copy. Added an optional `className` passthrough (this package's existing flat-component convention; the origin had none because it only had one caller). |
| `src/react/components/CompactToggle.tsx` | `NewProjectPanel.tsx`'s `CompactToggle` | Verbatim structural port, same reasoning as `OptionCards` (no copy owned by the component itself). Added `className` passthrough. |
| `src/react/components/ToggleRow.tsx` | `NewProjectPanel.tsx`'s `ToggleRow` | Verbatim structural port, same reasoning. Note: `PrivacySection.tsx` (a different OD file, not in this task's scope) has its own independent `ToggleRow` — not touched, not consolidated; out of scope for this dispatch. Added `className` passthrough. |
| `src/react/components/StatCard.tsx` | `PluginsView.tsx`'s `StatCard` | Verbatim structural port — `{ label, value }` only, no OD coupling. Added `className` passthrough. |
| `src/react/components/Notice.tsx` | `PluginsView.tsx`'s `Notice` | Genericized `outcome`'s type from OD's `PluginInstallOutcome` (a plugin-install wire DTO imported from `@open-design/contracts`) to a new local `NoticeOutcome` interface carrying the same three fields the component actually reads (`ok`, `message`, `warnings?`, `log?`) — any "ran an operation, got a result + warnings + a log" flow can supply this, not just plugin installs. Wrapped the two previously-hardcoded strings ("Install log", the "N warning(s)" pluralization) in `useT()` per the i18n policy; added an optional `logLabel` override prop since a host may want different copy for its own log-bearing operation. |
| `src/react/components/ImportChoice.tsx` | `PluginsView.tsx`'s `ImportChoice` | Verbatim structural port — `active`/`icon`/`title`/`body`/`onClick` all caller-supplied, no component-owned copy. `icon`'s type narrowed from the origin's inline `'github' \| 'upload' \| 'folder'` union to this package's existing `IconName` (all three values already exist in `Icon.tsx`'s union). |
| `src/react/components/FileImportPanel.tsx` | `PluginsView.tsx`'s `FileImportPanel` | Genericized the `webkitdirectory`/`directory` non-standard DOM attributes using the same `as Record<string, string>` cast pattern already used elsewhere in OD's own codebase (`DesignSystemFlow.tsx`) rather than reaching for a new type hack. Wrapped the previously-hardcoded `"Import"`/`"Importing…"` button copy (title/body/fileLabel were already props) in `useT()`. |
| `src/react/components/OnboardingPanelHeader.tsx` | `EntryShell.tsx`'s `OnboardingPanelHeader` | Verbatim structural port — `title`/`body` caller-supplied, no component-owned copy. |
| `src/react/components/OnboardingChipField.tsx` | `EntryShell.tsx`'s `OnboardingChipField` | Verbatim structural port — `label`/`options[].label` caller-supplied, no component-owned copy. The discriminated-union `multiple`/`value`/`onChange` prop shape (single vs. array) is unchanged. |
| `src/react/components/OnboardingDropdown.tsx` | `EntryShell.tsx`'s `OnboardingDropdown` | Two genericizations beyond a structural port: (1) the single-open-at-a-time peer-coordination mechanism dispatched a `window` `CustomEvent` named literally `'open-design:onboarding-dropdown-open'` — a product-identity string forbidden by this package's hard boundary rule — renamed to `'jini-ui:onboarding-dropdown-open'`; (2) the two empty-state strings were OD's own i18n dictionary keys (`t('homeHero.footer.noMatches')`, `t('settings.fetchModelsEmpty')`), routed through this package's own `useT()` as plain English instead: `t('No matches')` for the searchable/query-no-hits case (its actual English string, per `content.en`-equivalent locale files, was already generic — "No matches" — so ported as-is), and a new `t('No options available')` for the non-searchable/zero-options case — the origin's real fallback text there ("No compatible text models were returned.") was leftover wording from the one settings call site it happened to serve, not a generic empty-dropdown message, so this is a genuine simplification rather than a verbatim string carry-over. Removed one dead defensive `if (!root) return` null-check on a ref that is always attached by the time the gating effect runs (surfaced by the Phase 9.5 coverage loop; see below). |

### Purity grep

`grep -rn "Open Design\|OD_\|--od-stamp\|/tmp/open-design\|open-design\.ai\|open-design:\|@open-design/"` across all ten new files: **clean, zero matches** (the one pre-existing `open-design:` occurrence — the peer-coordination event name — was the exact string replaced above, not left behind). CSS class names were left as the origin's verbatim strings (`newproj-*`, `plugins-view__*`, `plugins-import-modal__*`, `onboarding-view__*`, `onboarding-chip-field*`, `compact-toggle*`, `toggle-row*`) per the precedent already set for `Loading.tsx`'s `design-card`/`skeleton-block` classes — these read as feature-shaped names, not product-identity strings, and none use the `od-` prefix that would trigger the `jini-` rename convention used elsewhere in this file.

### Coverage

All ten files at 100% statements/branches/functions/lines (`json-summary`+`json`
reporters, per-file). Two Phase 9.5 loop iterations were needed:
`FileImportPanel.tsx`'s `event.currentTarget.files ?? []` fallback (files is
typed `FileList | null` but a real `<input type="file">` never actually
returns null) was classified reachable-in-principle and given a real test
that forces `files` to `null` via `Object.defineProperty`, rather than
deleted or ignored. `OnboardingDropdown.tsx`'s `if (!root) return` inside its
placement-measurement effect was classified genuinely dead (the ref's owning
div is unconditionally rendered, so the ref is always set by the time the
`open`-gated effect runs) and removed per the loop's "refactor away the dead
branch" rule rather than padded with a contrived test; its
`window.innerHeight || document.documentElement.clientHeight || 720`
fallback chain, by contrast, was classified genuinely reachable (a real
embed/iframe timing edge case) and given two tests that force each fallback
step. No `/* v8 ignore */` or other coverage-suppression comment was used
anywhere in this batch.
---

## Section: flat atoms — `DesignKitView.tsx` + `home-hero/EdgeAutoScroll.tsx` (2026-07-18)

Scope: `foundry/docs/jini-port/god-components-extraction-plan.md`'s Section C (bucket-A
flat atoms, not `features/` folders) for the two items listed for this batch:
`DesignKitView.tsx`'s `BrandLogo`/`HeaderActionsMenu`/`useBrandFonts`/
`designMd*` utilities, and `HomeHero.tsx`'s already-isolated
`home-hero/EdgeAutoScroll.tsx`. Source: a fresh clone of the real
`leonaburime-ucla/open-design` fork (commit `0b88ef56144b5a42dc427c1292ae22676d698a34`,
`main`, 2026-07-02), per the cloud-dispatch preflight — not the vendored
`foundry/integrations/open-design/reference/` snapshot. Both source files were read
in full before extracting anything, per the batch instruction.

### What shipped

| Jini file | Origin | Contents |
|---|---|---|
| `src/react/components/BrandLogo.tsx` | `DesignKitView.tsx`'s `BrandLogo` (exported as `KitLogoProps`/`BrandLogo`) | The 4-stage logo fallback chain: brand-service image → explicit `logoSrc` → favicon lookup → monogram-letter fallback, advancing on each stage's `onError`. |
| `src/react/components/HeaderActionsMenu.tsx` | `DesignKitView.tsx`'s `HeaderActionsMenu` + its co-located `HeaderMenuAction` type | The sticky-header "More" overflow menu: grouped popover, outside-click/Escape-to-close, checkbox-semantics for toggle items. |
| `src/hooks/useBrandFonts.ts` | `DesignKitView.tsx`'s `useBrandFonts` | Google Fonts `<link>` injection + self-hosted `@font-face` injection from a project's font manifest. |
| `src/utils/design-md.ts` | `DesignKitView.tsx`'s module-private `designMdModuleSlice`/`replaceDesignMdModule`/`designMdHeadings`/`designMdHeadingMatches`/`designMdDefaultModuleText`/`normalizeDesignMdModuleDraft` | Pure markdown-heading-slice/replace helpers for pulling a single "module" section out of (and back into) a DESIGN.md-shaped document. |
| `src/hooks/useEdgeAutoScroll.ts` | `home-hero/EdgeAutoScroll.tsx`'s `useEdgeAutoScroll` | Edge hover/click auto-scroll controller for a horizontally-overflowing rail (rAF-driven glide, click-to-nudge, `ResizeObserver`-refreshed reachable-edge state). |
| `src/react/components/EdgeScrollZones.tsx` | `home-hero/EdgeAutoScroll.tsx`'s `EdgeScrollZones` | The paired left/right overlay zones that drive the hook above. |

All six are re-exported from `src/index.ts`.

### Genericized / what changed

- **`BrandLogo`**: the origin hardcoded an OD API endpoint
  (`` `/api/brands/${bid}/logo` ``) for the brand-service stage. Replaced with
  an injected `resolveBrandLogoUrl?: (brandId: string) => string` — omitting
  it skips the brand-service stage entirely (falls through to `logoSrc` /
  favicon / letter) rather than ever constructing an OD-specific URL. The
  Google-favicon-service call (`https://www.google.com/s2/favicons?...`) was
  kept as the default (a genuinely generic third-party API, not OD-specific —
  same reasoning `useBrandFonts`'s Google Fonts `<link>` injection already
  uses) but is now also overridable via `resolveFaviconUrl`. Dropped the
  origin's legacy `id?: string` alias for `brandId` (an OD call-site quirk —
  "Brands list rows pass `id`" — not a generic concern for a standalone
  component).
- **`useBrandFonts`**: the origin's self-hosted-font-manifest fetch called
  `projectRawUrl(projectId, path)`, an OD-specific import from
  `../providers/registry`. Replaced with an injected
  `options.resolveProjectAssetUrl?: (projectId, path) => string` — per the
  batch instruction, omitting it skips the manifest fetch entirely rather
  than hardcoding any font-service URL. The Google Fonts `<link>`-injection
  half needed no change (already generic).
- **`HeaderActionsMenu`**: no OD coupling beyond a `styles.*` CSS-module
  import (`./BrandPreviewCard.module.css`) — this package has no
  CSS-module build step (same situation every prior flat-group component
  hit, e.g. `KitErrorBoundary`/`WorkingDirPicker`), so class names were
  flattened to plain `jini-header-actions-menu*` names. The
  `data-testid="design-kit-more-actions"` (naming the menu after its one
  origin call site) was renamed to `header-actions-menu-trigger` since this
  is now a standalone, non-"design-kit"-specific component.
- **`design-md.ts`**: `DesignMdModuleSpec`'s original `id` field was a fixed
  6-value OD union (`'identity' | 'typography' | 'palette' | 'voice' |
  'imageryLayout' | 'designSystem'`, the brand-kit's own module list) and
  `label` was a translated UI-display string — neither is read by the pure
  slice/replace/heading-match logic itself (only `heading`/`keywords`/
  `includePreamble` are). Both fields were dropped from the ported
  `DesignMdModule` type; a host building a real module picker UI supplies
  its own id/label alongside a `DesignMdModule` when calling into this
  utility, rather than this pure-logic file carrying UI-display fields it
  never reads.
- **`EdgeScrollZones`**: only OD-specific artifact was the `home-hero__rail-edge*`
  CSS class family (named after the one OD component that used it). Renamed
  to `jini-edge-scroll-zone*`. Logic is otherwise byte-identical to the
  origin — r6's "already isolated, ship as-is" verdict held up on a full
  read; the only change was the class-name neutrality pass.

### i18n

None of the six atoms render a hardcoded user-facing string that needed
`useT()` wrapping: `HeaderActionsMenu` takes every label (`label`, each
`HeaderMenuAction.label`) as a caller-supplied prop with no default value
(the "translatable for free" pattern already holds without any wrapping —
there is nothing in this component's own source to translate); `BrandLogo`
renders no text beyond a derived monogram initial and an intentionally-empty
`alt=""`; `EdgeScrollZones` is `aria-hidden` on both zones with no visible
text or `aria-label` (decorative overlays, matching the origin exactly —
verified this wasn't an accessibility gap introduced by porting, it was
already `aria-hidden` in the origin); `useBrandFonts`/`useEdgeAutoScroll`
render nothing; `design-md.ts` is pure logic with no React import (exempt
per the i18n policy) and its `heading`/markdown output is document content
written by the module, not UI chrome to translate. Flagged explicitly per
the policy's own "no silent gaps" instruction rather than left unstated.

### Coverage

Ran the Phase 9.5 classify-then-fix loop once per atom; every uncovered
branch on the first pass classified as either "genuinely reachable, just
untested" (all `BrandLogo` fallback-chain permutations; `useBrandFonts`'s
resolver-present/absent × projectId-present/absent × fetch-ok/fetch-fail/
fetch-throw/manifest-empty/unmount-mid-fetch matrix; every `useEdgeAutoScroll`
glide/nudge/stop/restart/ResizeObserver-present-or-absent/ref-unattached
path) or "TS-required fallback with no real runtime path" (two `??`
fallbacks in `design-md.ts`'s `designMdHeadings` — `match.index`/`match[1]`
are typed possibly-`undefined` by the JS regex API even though this
pattern's mandatory capture group and `matchAll` result always define them;
converted to non-null assertions with an explaining comment, not tested
around) or a genuine **dead branch** refactored away rather than tested
around: `design-md.ts`'s `designMdModuleSlice`/`replaceDesignMdModule` both
defensively wrote `body ?? ''` for a parameter already typed `string` (not
optional) — the `??` fallback was unreachable under the function's own type
contract, so it was deleted (using `body` directly) instead of adding a
type-defeating cast just to hit it; `HeaderActionsMenu`'s
`Fragment key={group[0]?.id ?? groupIndex}` — `group` is always drawn from
`visibleGroups = groups.filter((g) => g.length > 0)`, so `group[0]` is
always defined at that call site and the `?.`/`??` fallback could never
fire — replaced with `group[0]!.id` plus a one-line comment recording the
invariant. No `/* v8 ignore */` or other suppression was used anywhere.
Final numbers, all six atoms, statements/branches/functions/lines:

| File | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| `BrandLogo.tsx` | 100 | 100 | 100 | 100 |
| `HeaderActionsMenu.tsx` | 100 | 100 | 100 | 100 |
| `EdgeScrollZones.tsx` | 100 | 100 | 100 | 100 |
| `useBrandFonts.ts` | 100 | 100 | 100 | 100 |
| `useEdgeAutoScroll.ts` | 100 | 100 | 100 | 100 |
| `design-md.ts` | 100 | 100 | 100 | 100 |

### Purity grep

`grep -rn "Open Design\|OD_\|--od-stamp\|/tmp/open-design\|@open-design/"` and
the stricter `grep -rn "od-\|open-design\.ai\|openDesignDesktop"` pass, both
run across every new/changed file in this batch (the six source files, their
six test files, and the `src/index.ts` barrel diff): **clean, zero matches**
in both passes.

### Test/typecheck/guard results

- `pnpm --filter @jini/ui typecheck`: green (zero errors).
- New atom tests in isolation: **94 tests across 6 files, all green**, 100%
  statements/branches/functions/lines on all six atoms (table above).
- `pnpm --filter @jini/ui exec vitest run` (full package): **1306 tests,
  146 files, all green** — no regression in any pre-existing test.
- `pnpm guard` (repo root): `[guard] ok (skeleton — rules pending
  implementation during extraction)` — no boundary violations introduced.
## Section: `features/schedule-picker/` (`RecurringSchedulePicker`) + `features/mention-autocomplete/` (`MentionAutocomplete`) — `NewAutomationModal.tsx` (2026-07-18)

Source: `apps/web/src/components/NewAutomationModal.tsx` (1,165 lines in the
real clone at `leonaburime-ucla/open-design`, commit at dispatch time —
**not** `foundry/integrations/open-design/reference/`'s frozen snapshot, per this
task's mandate to clone the real fork), per
`foundry/docs/jini-port/god-components-extraction-plan.md`'s Consolidation map
Section B rows for `features/schedule-picker/` and
`features/mention-autocomplete/`, and recon `r6-god-component-internals.md`
§1.19. Two separate `features/<domain>/` slices, both under the NEW
`react/{hooks,components}/` layout, per this repo's React-layout policy.

### `features/schedule-picker/` — what shipped

| File | Contents |
|---|---|
| `types.ts` | `Weekday`, `ScheduleKind`, `ScheduleValue` (tagged union — the generic replacement for the origin's `RoutineSchedule` contract type), `ScheduleKindOption`, `WeekdayOption`, `ScheduleEditorState` (carries every kind's fields simultaneously, mirroring the origin's `FormState` schedule fields so switching kind tabs doesn't lose in-progress edits), `ScheduleSummaryParts`. |
| `constants.ts` | `DEFAULT_SCHEDULE_KINDS`, `DEFAULT_WEEKDAYS` (Sunday-first), `DEFAULT_SCHEDULE_TIME`/`WEEKDAY`/`MINUTE`. |
| `rules.ts` | `clampMinute`, `formatTime12h`, `decomposeSchedule`/`describeScheduleSummary` (ported from the origin's identically-named functions, generalized off `RoutineSchedule`), `defaultScheduleEditorState`, `scheduleEditorStateFromValue` (the origin's `formFromRoutine`, generalized), `buildScheduleValue` (the origin's `buildSchedule`, generalized), `showsWeekdayGrid`/`showsTimeFields`. Hook-free by design. |
| `react/hooks/useRecurringSchedulePicker.ts` | Owns popover open/closed, the editor working-state, and outside-click/Escape dismissal via the shared `useDismissOnOutsideOrEscape` hook (`packages/ui/src/browser/`) rather than hand-rolling a second listener pair — this task is the second consumer of that shared hook after `browser-chrome`'s `BrowserViewportControls`. Re-syncs the editor state from the latest committed `value` each time the popover re-opens (so a discarded in-progress edit doesn't leak into the next open). No `ports.ts`/`dependencies.ts` — this feature has no transport dependency; timezone data comes from the flat `utils/timezone.ts` and there's no persistence port to inject (matches the `settings-dialog` tabs' "no ports" precedent for pure-client-state features). |
| `react/components/ScheduleKindTabs.tsx`, `WeekdayGrid.tsx`, `ScheduleFields.tsx` (kind-dependent minute-field vs. time+timezone-row), `ScheduleSummary.tsx` (+ `translatedScheduleSummaryLabel` — a translated-string sibling of the JSX summary, used for the trigger pill's `aria-label`; needed because `rules.ts`'s `describeScheduleSummary` is hook-free and therefore can't itself produce translated output), `RecurringSchedulePicker.tsx` (orchestrator — trigger `PillButton` + popover assembling the above + a Done action that commits the edit). |
| `index.ts` | Public barrel. |

### `features/mention-autocomplete/` — what shipped

| File | Contents |
|---|---|
| `types.ts` | `MentionItem<TIcon = unknown>` (the generic `{id, label, category, meta?, icon?}` shape the task brief specified, replacing the origin's `SkillSummary`/`InstalledPluginRecord`/`McpServerConfig`/`ConnectorDetail` union), `MentionCategory`, `MentionCategoryFilter`, `MentionTriggerMatch`, `MentionInsertResult`. `icon` is generic over `TIcon` (not `ReactNode` directly) specifically so this file has zero *runtime* React import per the React-layout policy — the `react/` layer binds `TIcon = ReactNode` itself (see `MentionResultItem`'s `T extends MentionItem<ReactNode>` constraint), the same kind of split `settings-dialog`'s `SettingsDialogTabMeta`/`SettingsDialogTab` used for the same reason. |
| `constants.ts` | `ALL_CATEGORY_FILTER`, `DEFAULT_TRIGGER_CHAR` (`'@'`), `DEFAULT_MAX_RESULTS_PER_CATEGORY` (10, matching the origin's per-kind `.slice(0, 10)`). |
| `rules.ts` | `readMentionTrigger` (the origin's `readContextMention`, generalized: trigger character is now a parameter, not hardcoded `@`), `buildMentionToken` (the origin's `inlineMentionToken` from `utils/inlineMentions.ts` — **only this one trivial function was ported from that file**, see the "3-way overlap" note below for why the rest of it wasn't), `insertMentionToken` (the text-splicing half of the origin's `replaceMentionWithLabel`, with the DOM focus/cursor-restore half kept in the hook), `filterMentionItems`, `groupItemsByCategory` (per-category-capped, matching the origin's independent per-kind `.slice(0,10)` rather than one shared cap across every category combined — a subtlety that needed a second pass to get right, see the coverage-loop notes below), `isCategoryVisible` (the origin's `showSkills`/`showPlugins`/`showMcp`/`showConnectors` booleans, generalized to one predicate), `mentionSelectionKey` (a new `category:id` composite-key helper — needed because two different categories may reuse the same raw id, which the origin never had to handle since it tracked `selectedSkillIds`/`selectedPluginIds`/etc. as four separate arrays), `hasAnyResults`. |
| `react/hooks/useMentionAutocomplete.ts` | Owns the live-textarea trigger detection, the active category tab, filtered/grouped results, and — a deliberate design decision beyond a literal port — the **selected-items set itself** (`selectedItems: T[]`, add-on-pick/remove-on-chip-click), rather than requiring the host to own that state externally. The origin owned `selectedSkillIds`/`selectedPluginIds`/`selectedMcpIds`/`selectedConnectorIds` in the *modal's* own state (OD-specific, per the "form/REST wiring stays behind" rule) — but the underlying *mechanism* ("track what's picked, render removable chips, allow removal") is exactly what r6 §1.19 named as part of the generic picker shape ("removable chips"), so this port makes the widget fully self-contained rather than pushing that mechanism back onto every future host. A host that wants to observe the selection gets `onSelectionChange`. Also owns a real, disclosed bug fix (see below). |
| `react/components/MentionCategoryTabs.tsx`, `MentionResultItem.tsx`, `MentionResultsList.tsx`, `SelectedMentionChips.tsx`, `MentionAutocomplete.tsx` (orchestrator: renders its own `<textarea>` + tabbed popover + chips row — a self-contained "mention-enabled textarea" widget, not just the popover in isolation, since that's what makes it directly drop-in reusable). All four inner components generic over `T extends MentionItem<ReactNode>`. |
| `index.ts` | Public barrel. |

### A real bug found and fixed, not silently ported

The origin wires `onKeyDown={handlePromptKeyDown}` (Escape closes the mention) and `onKeyUp={refreshMentionFromPrompt}` (re-derives the mention from the live textarea) on the same `<textarea>`. Since Escape doesn't change the textarea's value or cursor, the `keyup` that always follows the `keydown` re-reads the still-live `@token` and **immediately reopens the mention Escape just closed** — a real, reproducible defect in the origin (confirmed by porting it faithfully first, per Phase 0's behavior-preserving instinct, and watching a new test fail). Per this task's own instructions ("no OD tilt," building a *good* generic primitive, not a byte-identical clone) this was fixed rather than reproduced: `onTextareaKeyUp` now skips the refresh specifically when `event.key === 'Escape'`, with a code comment and a dedicated test (`onTextareaKeyUp skips the refresh for an Escape key`) proving the fix. Flagged here explicitly rather than left as a silent behavior change.

### Popover chrome primitives + timezone utils (r6 §1.19 items 4c/4d)

- **`PillButton`/`PopoverMenu`/`PopoverItem`** shipped as flat `packages/ui/src/react/components/*.tsx` (per the task's own instruction to ship flat if "truly standalone/reusable outside this file," using judgment). `RecurringSchedulePicker` is a **real consumer** of `PillButton` (its trigger). `PopoverMenu`/`PopoverItem` are **not** consumed by either shipped feature — the origin used them for the *project-target picker* popover (`New project each run` / existing-projects list), which is explicitly OD-specific form/target-selection wiring this task does not port (see "What stayed behind" below). They're shipped anyway because r6 classified them as "generic, no OD types" independent of that one call site, and a future project/target-picker-shaped extraction can reuse them without re-deriving the same simple check-mark-list-item shape — but this is flagged here explicitly as the honest state, not silently implied to be wired into either new feature.
- **`detectLocalTimezone`/`listSupportedTimezones`/`tzCityLabel`** shipped as flat `packages/ui/src/utils/timezone.ts` (pure `Intl` wrappers, exactly as r6 described them). `useRecurringSchedulePicker` is the real consumer.

### Cross-check against r6 §1.19's full description (nothing dropped silently)

- "kind-tabs + weekday-grid + time/timezone-select" — all three shipped (`ScheduleKindTabs`/`WeekdayGrid`/`ScheduleFields`).
- "only the `RoutineSchedule` type is OD-specific" — confirmed; replaced by `ScheduleValue`, no other OD coupling found in the schedule editor during the Phase 8.5 audit.
- "inline @-token detection, tabbed multi-category filtered results, removable chips" — all three shipped (`readMentionTrigger`, `MentionCategoryTabs`+grouped `MentionResultsList`, `SelectedMentionChips`).
- "OD-specific only via the capability data types" — confirmed; replaced by generic `MentionItem`, no other OD coupling found.
- "Popover chrome primitives... generic, no OD types" — shipped flat, per above (with the honest non-consumption note).
- "Timezone utilities... pure Intl wrappers" — shipped flat, consumed by schedule-picker.
- Nothing r6 called generic was simplified away or dropped in this pass.

### What stayed OD-specific and was NOT ported (per r6 §1.19 + the task brief)

- `FormState`/schedule-building tied to the `Routine` contract type, and the whole `buildSchedule`→`CreateRoutineRequest` submission shape.
- The template-picker (`TemplatePopover`, `AutomationTemplate`) and OD's own automation-template catalog content.
- The project-target picker (`New project each run` / existing-project list) — this is *also* where `PopoverMenu`/`PopoverItem` would have been consumed in the origin; not ported since it's a project/target-selection concept, not a generic picker shape on its own.
- The form-submit/REST-endpoint wiring (`/api/routines` POST/PATCH, `onSaved`/`onClose` callback contract).
- `utils/inlineMentions.ts`'s Lexical-adjacent rich-text mention *parser* (`buildInlineMentionParts`, the trie-based token index, `isMentionBoundary`/`isMentionRightBoundary`/`mentionTokenPresent`) — the origin's `NewAutomationModal.tsx` only ever called that file's trivial `inlineMentionToken(label)` helper (ported here as `buildMentionToken`, generalized). The rest of that file is a much larger rich-text-over-a-committed-string mention system that belongs with the Lexical `composer/*` `@mention` system instead (see the 3-way overlap note directly below) — pulling it in here would have smuggled a second, unrelated feature's source file into this task's scope.

### The mention-autocomplete 3-way overlap (flagged per the task brief, not resolved here)

`foundry/docs/jini-port/god-components-extraction-plan.md`'s "5 more overlaps" list (~line 148) names three "type a trigger character, get a filtered picker" shapes: `QuickSwitcher.tsx` (Cmd-K fuzzy file/tab switcher), this file's `@`-mention/capability picker (now shipped as `MentionAutocomplete`), and `composer/*`'s Lexical `@mention` system (`MentionNode.ts` + siblings). Read all three at dispatch time to check this:

- **`QuickSwitcher.tsx`** (`apps/web/src/components/QuickSwitcher.tsx` in the real clone): a full-screen Cmd-K-style modal overlay with a single always-visible search input (no inline trigger-character detection — it's already open when mounted), fuzzy-scored ranked results (`scoreMatch`/`scoreWorkspaceContextMatch`, prefix/substring/full-text tiers), arrow-key + Enter keyboard navigation with a `cursor` index and `nextCursor` wraparound, and a recents-first empty-query ordering (`quickSwitcherRecents`). **Not the same component shape as `MentionAutocomplete`**: no inline-textarea trigger detection, no tabbed multi-category grouping, no removable-chips multi-select, and a fundamentally different selection model (arrow-key cursor + Enter, not click/mousedown-to-pick with a chip trail). Both are "type text, get filtered results," but `MentionAutocomplete`'s defining shape (trigger character *inside* a text field, multi-category tabs, persistent multi-select chips) doesn't match `QuickSwitcher`'s (an already-open single-purpose fuzzy-match palette with keyboard-cursor selection). **Conclusion: do not fold `QuickSwitcher.tsx` into `features/mention-autocomplete/`** — it's a distinct shape (closer to a generic "command palette" primitive) and should get its own extraction if/when it's prioritized.
- **`composer/*`'s Lexical `@mention` system** (`apps/web/src/components/composer/MentionNode.ts` + siblings, referenced but not fully read in this dispatch — out of this task's file scope): per r5's own characterization ("generic Lexical rich-text/mention editor primitive," target `features/rich-text-input/`), this is a *contenteditable rich-text* mention system built on the Lexical editor framework, rendering mentions as atomic inline nodes inside a WYSIWYG document model — a fundamentally different implementation substrate than `MentionAutocomplete`'s plain `<textarea>` + string-splicing approach. They likely share only the shallow "type `@`, see a filtered list" *interaction pattern*, not a reusable component-level shape — a plain textarea can't host a Lexical node tree, so `MentionAutocomplete` cannot become `features/rich-text-input/`'s implementation, and shouldn't try to.
- **This task's own verdict**: `MentionAutocomplete` (this shipment) and `QuickSwitcher`/the Lexical mention system are three genuinely different shapes under one superficially-similar description, not the same primitive done three ways. A future dispatch extracting `QuickSwitcher.tsx` or `features/rich-text-input/` should still read this section first and re-verify this conclusion (this recon was done by one task under time pressure, not an exhaustive side-by-side), but should not assume `features/mention-autocomplete/` is already "the" answer for either.

### The `features/progress-card/` discrepancy (flagged per the task brief)

`foundry/docs/jini-port/god-components-extraction-plan.md`'s Consolidation map (line ~100) and its §1 priority list (line ~267) both describe `features/progress-card/` as "✅ landed"/"already shipped." **This is not true in this repo as of this dispatch (2026-07-18, branch `extract/schedule-picker-and-mention-autocomplete` off `origin/main` at `e3110ac`)**: `packages/ui/src/features/progress-card/` does not exist — confirmed via `ls packages/ui/src/features/` (lists `asset-grid, browser-chrome, connectors, i18n, observability, settings-dialog, sketch-editor, viewer-shell` only) and via `find`/`ls` directly on the path (no such file or directory). This task did not attempt to reconcile or re-land it — it's out of scope for the schedule-picker/mention-autocomplete extraction — but is recorded here per the task brief's explicit instruction not to let a doc claim stand unverified. A future task should either land `features/progress-card/` for real or correct the plan doc's two claims.

### i18n

Every user-facing string in every new file (both features) routes through `useT()`, English string as key, per this package's i18n policy. `rules.ts` in both features stays hook-free — `ScheduleSummary`'s translated pill segments and `translatedScheduleSummaryLabel`'s translated `aria-label` both wrap `decomposeSchedule`'s untranslated return value at the call site, exactly the pattern the policy prescribes. Every component has a real test mounting under `I18nProvider` with a translated dictionary and asserting the translated text renders (not just that `t()` compiles), including one full end-to-end `MentionAutocomplete` test exercising a translated placeholder, tab labels, section labels, and the chips-row `aria-label` together in one flow.

### Phase 8.5 audit

Ran across every new file in both features: no orphaned `useState`/`useRef` found (every state value/ref in `useRecurringSchedulePicker` and `useMentionAutocomplete` is read somewhere — render, an effect, or a returned callback). No inline JSX callback with real multi-statement branching was found — the only inline arrows are one-line `onClick={() => onChange(x)}`-shaped calls or a `preventDefault()`+one-call pair (`MentionCategoryTabs`'/`MentionResultItem`'s `onMouseDown`), matching the audit bar already accepted for `AssetGridToolbar`'s `onSearchChange`-shaped one-liners elsewhere in this package. Every `useMemo` in `useMentionAutocomplete` (`filteredItems`, `groups`, `selectedKeys`) is a direct, single-purpose derivation with no unextracted branching. Two genuinely-dead-but-TS-required fallbacks were found and refactored away rather than tested around, per Phase 9.5 point 3: `rules.ts`'s `readMentionTrigger` had two `match[n] ?? ''` fallbacks for regex capture groups that are structurally guaranteed to participate whenever the overall match succeeds (replaced with non-null assertions + an explaining comment); `utils/timezone.ts`'s `tzCityLabel` had a `.split('/').pop() ?? timezone` fallback that's likewise unreachable (`split` always returns a non-empty array) (same fix).

### Purity grep

`grep -rniE 'open.?design|\bOD_|--od-stamp|/tmp/open-design'` across `packages/ui/src/features/schedule-picker/`, `packages/ui/src/features/mention-autocomplete/`, `packages/ui/src/utils/timezone.ts`(+test), `packages/ui/src/react/components/{PillButton,PopoverMenu,PopoverItem}.tsx`(+tests): **clean, zero matches.**

### Test/typecheck/coverage results

- `pnpm --filter @jini/ui run typecheck`: green (zero errors) — required the same `exactOptionalPropertyTypes` discipline as prior sections (every optional hook/prop param needs `| undefined` added explicitly, not just `?`), plus one `renderHook` generic-inference gotcha (an arrow function parameter's *explicit* type annotation does not feed back into inferring the call's own generic type parameters — TypeScript inferred a narrowed union member from `initialProps` instead of the intended full `ScheduleValue` union; fixed by passing `renderHook`'s `<Result, Props>` type arguments explicitly rather than relying on inference).
- `pnpm --filter @jini/ui exec vitest run`: package-wide **160 test files, 1372 tests, all green** (up from the pre-existing 140 files/1209 tests baseline) — this task contributes 12 new test files/79 tests for `schedule-picker` (+ its 3 flat components/timezone util) and 8 new test files/81 tests for `mention-autocomplete`.
- Coverage (`vitest run --coverage`, `json-summary`+`json` reporters, per the Phase 9.5 method): **100% statements/branches/functions/lines on every single new file in both features**, confirmed via the real per-file `coverage-summary.json` numbers (the v8 text-table reporter alone would have hidden this — it drops rows once there are many files, per this package's `vitest.config.ts` comment). The full classify-then-fix loop was needed twice: (1) `groupItemsByCategory`'s per-category cap vs. a single shared cap across all categories — caught by branch coverage before it became a real bug, not just a style choice; (2) the two genuinely-dead `?? ''`/`?? timezone` fallbacks noted in the Phase 8.5 section above, refactored to non-null assertions rather than tested around, per the "never fake the number" rule. No `/* v8 ignore */` or any coverage-suppression comment was used anywhere. The package-wide aggregate (`coverage-summary.json`'s `total`) sits at 93.1%/90.83%/92.67%/93.1% (statements/branches/functions/lines) — this is **pre-existing debt in files this task never touched** (e.g. `utils/notifications.ts` at 67%, `utils/scroll-to-top.ts`, several untested hooks under `src/hooks/`), not a regression; every file this task actually authored or edited is at 100%, which is the bar the task brief's Phase 9.5 method targets (per-file, not a blanket whole-package retrofit).
- `pnpm guard` (repo root): `[guard] ok (skeleton — rules pending implementation during extraction)` — unchanged, no boundary violations introduced.
- Full monorepo `pnpm -r run typecheck`: fails only at `packages/agent-runtime` and `packages/chat-react` (both missing a `tsconfig.json` entirely) — pre-existing and already documented in this file's `settings-dialog`/`connectors` sections above; unrelated to this task's changes.
## Section: `features/asset-tree-browser/` — file-tree browser + preview pane (2026-07-18)

Source: a real design-tool origin project's web tree, branch
`refactor/web-memory-slice` @ commit `d695f1e0f2b85a032aa7ce4895a3eb764cb1b65d`,
file `apps/web/src/components/DesignFilesPanel.tsx` (1,731 lines), read in
full and re-verified line-by-line while porting each piece (per
`foundry/docs/jini-port/skills/fixing-open-design-web.md`'s standing instruction —
never invent behavior from a summary). Task brief: extract a generic
`AssetTreeBrowser<TFile>` + `FilePreviewPane<TFile>` UI feature into
`packages/ui/src/features/asset-tree-browser/`. This had never been
attempted before this session — no prior branch or partial work existed.

Structural precedent: `features/asset-grid/` (the shipped `types.ts`/
`constants.ts`/`rules.ts`/`ports.ts`/`dependencies.ts`/`index.ts` +
`react/hooks/`+`react/components/` layout, the `Selectors<TAsset>`
accessor-object discipline, and the "ship a real browser-generic port,
fake only the genuinely host-specific one" split).

### What shipped — `packages/ui/src/features/asset-tree-browser/`

| File | Contents |
|---|---|
| `types.ts` | `AssetTreeFileItem`/`AssetTreeFolderItem` (`{path: string}` identity constraints, mirroring `AssetGridItem`'s `{id: string}`), `AssetTreeSelectors<TFile>` (`getSize`/`getModifiedAt`/`getKind`/optional `getLocalPath`), `AssetTreeKindConfig`/`AssetTreeKindConfigMap` (host-supplied label+glyph per kind), `AssetTreeSection<TFile>`, `AssetTreeNavState`, `AssetTreeToolbarAction`, `AssetTreeBreadcrumbSegment`, `AssetTreeRelativeTime` (the `{label, translatable, params?}` i18n-safe shape — see the i18n section below), `AssetTreeRenameState`, `AssetTreeMenuPosition`. |
| `constants.ts` | `DEFAULT_KIND_CONFIG_MAP`/`DEFAULT_KIND_GLYPH`/`DEFAULT_SECTION_ORDER` (all empty — an unconfigured host still gets every kind rendered, just under its raw key), `EMPTY_TOOLBAR_ACTIONS` (a stable `[]` so omitting `toolbarActions`/`emptyStateActions` doesn't allocate a fresh array every render), `ROW_MENU_ESTIMATED_HEIGHT_PX`/`ROW_MENU_SAFE_PADDING_PX`, `COPY_LOCAL_PATH_CONFIRM_MS` (1600ms, matching the origin), `DOUBLE_ACTIVATION_WINDOW_MS` (300ms, matching the origin's keyboard double-Enter-to-open window). |
| `rules.ts` | `deriveTreeChildren` (dirs/files at the current level — preserves a genuinely surprising origin behavior verbatim, see below), `groupFilesByKind` (kind sections ordered by host `sectionOrder`, unconfigured kinds appended in first-seen order — a generification the origin never needed since its `SECTION_ORDER` enumerated every possible kind), `nextExistingAncestorDir` (the auto-navigate-up-when-the-viewed-dir-vanishes logic), `countFilesUnderDir`, `toggleInSet`/`pruneMissingPaths` (selection, path-keyed instead of id-keyed), `basenameForRename`/`resolveRenameCommit` (the rename-commit decision, extracted from inline branching), `computeMenuPosition` (the row-menu's pure viewport-flip math), `canCopyLocalPath`, `isDoubleActivation`, `resolveKindConfig`, `humanBytes` (verbatim, no i18n — matches the origin, which never translated it either), `relativeTimeResult` (returns `{label, translatable, params?}`, not a finished string — see i18n section), `fileExtensionLabel`, `buildBreadcrumbSegments`, the clipboard-paste parsing quartet (`filesFromClipboardData`/`normalizePastedFile`/`extensionForMimeType`/`shouldIgnoreClipboardFilePaste`), and the drag-drop recursive-folder-expansion quartet (`filesFromDataTransfer`/`filesFromFileSystemEntry` + two private helpers) — all ported near-verbatim from the origin, reusing the already-shipped `utils/file-system-errors.ts` for the read-failure wrapping instead of reimplementing it. |
| `ports.ts` | `AssetTreeClipboardPort` (`copyToClipboard`), `AssetTreeDomBridgePort` (`subscribeOutsideDismiss`/`subscribeGlobalPaste`/`getViewportHeight`), `AssetTreeDependencies`. See the "deliberate correction" note below for `subscribeOutsideDismiss`'s signature. |
| `dependencies.ts` | `createBrowserAssetTreeClipboardPort`/`createBrowserAssetTreeDomBridgePort`/`createBrowserAssetTreeDependencies` — all REAL, SSR-guarded implementations (both ports are genuinely browser-generic, same reasoning `asset-grid`'s `createBrowserSseLiveUpdatesPort` used), bound to the already-shipped `utils/copy-to-clipboard.ts` and `utils/dom-subscriptions.ts` rather than reimplemented. `createFakeAssetTreeDependencies` — an inert test double for this feature's own tests (and any host's). |
| `react/hooks/useAssetTreeNavigation.ts` | Current-directory state (seeded from `navState`, reported upward via `onNavStateChange` — a one-time seed + report-upward callback, not a fully controlled prop, matching the origin's own `navState`/`onNavStateChange` pair), `dirsAtCurrentDir`/`filesAtCurrentDir`/`sections` derivations, the ancestor-correction effect. |
| `react/hooks/useAssetTreeSelection.ts` | Path-keyed `Set` selection: toggle/clear, reset-on-nav, prune-on-vanish, `renamePath` (carries a selection over to a renamed path), and `pendingRenamePath` — a fix discovered while writing the orchestrator's own integration test, see below. |
| `react/hooks/useAssetTreePreview.ts` | Which file is previewed (resolved against the FULL `files` list, not just the current directory — the origin never clears the preview on navigation, so neither does this), one-time auto-initial-preview via an optional host `selectInitialPreviewFile`, clear-on-vanish. |
| `react/hooks/useAssetTreeRename.ts` | Start/edit/commit/cancel. One deliberate behavior change from the origin: a failed rename surfaces as `renameError` state instead of a blocking native `alert()` — see below. |
| `react/hooks/useAssetTreeRowMenu.ts` | The `⋯` context menu's open/positioned/dismiss state, wired to `AssetTreeDomBridgePort`. |
| `react/hooks/useAssetTreeDragUpload.ts` | Drag-depth-tracked drag-over overlay + the drop handler (recursive folder expansion via `rules.ts`). |
| `react/hooks/useAssetTreeClipboardPasteUpload.ts` | The global paste listener (parsing/filtering already done by the DOM bridge port — see dependencies.ts). |
| `react/hooks/useAssetTreeBatchActions.ts` | Batch delete (busy-gated, deliberately doesn't clear `selected` itself — matches the origin's own "leave the selection intact for retry" comment) + optional batch download (`triggerBrowserDownload`, a real anchor-click download trigger). |
| `react/hooks/useAssetTreeCopyLocalPath.ts` | The row menu's "copy local path" action + its transient "Copied" confirmation (setTimeout-based revert). |
| `react/components/AssetTreeBreadcrumbs.tsx` | Root label (non-interactive at the root, a button once navigated away) + one segment per path component. |
| `react/components/AssetTreeToolbar.tsx` | Renders host-supplied `toolbarActions` — this package ships zero built-in toolbar buttons (the origin's New-Sketch/Paste/Upload/Library/project-menu buttons are all OD-specific product actions with no generic equivalent). |
| `react/components/AssetTreeSelectionBar.tsx` | Selected count, optional batch-download button, batch-delete (busy-gated), clear. |
| `react/components/AssetTreeFileRow.tsx` | Hover-revealed checkbox + `⋯` menu trigger, click-to-preview/dblclick-to-open on the icon/name/size/time cells, inline rename input, keyboard parity (Enter/Space previews, a second activation within `DOUBLE_ACTIVATION_WINDOW_MS` opens — mirrors the origin's mouse double-click via keyboard). |
| `react/components/AssetTreeFolderRow.tsx` | Navigates on click (both the row and its name button, matching the origin's doubled click targets), shows the deep (not just immediate-level) file count via `countFilesUnderDir`. |
| `react/components/AssetTreeRowMenu.tsx` | The popover itself: open / rename / copy-local-path (disabled unless `getLocalPath` resolves one) / download (hidden unless `getFileUrl` is supplied) / delete. |
| `react/components/FilePreviewPane.tsx` | The separately-named export the task explicitly calls for: thumbnail slot (host-supplied `renderThumbnail`, defaults to a glyph placeholder) + meta footer (full path, kind, modified/size/extension stats, download link) + Open action. `thumbnailIsInteractive` generifies the origin's hardcoded `kind !== 'audio' && kind !== 'video'` check (this package has no fixed kind enum to hardcode against). |
| `react/components/AssetTreeEmptyState.tsx` | Shown when the directory has no files, folders, or persisted folders at all; renders host-supplied `emptyStateActions`. |
| `react/components/AssetTreeUploadErrorBanner.tsx` | A dismissible banner for a failed drag-drop-folder read. |
| `react/components/AssetTreeBrowser.tsx` | The orchestrator — composes all 9 hooks, renders the Folders section (pinned above kind sections), each kind section, the preview pane, and the row menu. Defaults `dependencies` to `createBrowserAssetTreeDependencies()`. |
| `index.ts` | Public barrel — every type/constant/rule/port/dependency-factory/hook/component, matching `asset-grid/index.ts`'s re-export granularity. Also wired into the package-wide `src/index.ts` barrel (`export * from './features/asset-tree-browser/index.js';`), placed alongside the `asset-grid` line. |

### Dropped (origin-specific, non-separable) — cross-checked line-by-line against the real file, not assumed

- **The "live artifacts" section** (`liveArtifacts` prop, `LiveArtifactBadges`, `onOpenLiveArtifact`) — a workspace-tabs-pointing-at-a-live-preview concept, a different domain entirely from file-tree browsing.
- **"Plugin folders" section** (`getPluginFolderCandidates`, `PluginFolderAgentAction`, install/publish/contribute buttons, `buildActionNotice`/`escapeRegExp` notice-parsing) — a plugin-ecosystem feature specific to the origin product.
- **The project menu** (`onCreateDesignSystem(FromProject)`, `onDuplicateProject`, the dropdown) — origin-specific project actions; a host that wants these back adds them via `toolbarActions`.
- **`RotatingTip` footer + the entire tip-copy array** — hardcoded marketing copy with literal social-media links. Product content, full stop — not even the typewriter *mechanism* is ported. A host supplies its own `footer` slot if it wants one; this package ships none by default.
- **`onRefreshFiles`** — declared in the origin's own `Props` interface but genuinely dead: grepped the full 1,731-line file and confirmed it's never called anywhere in the component body (the parent evidently wires the actual refresh button elsewhere). Not ported at all — including a no-op prop for it would be inventing behavior the origin itself doesn't have.
- **"Select from library" special-casing** (`LIBRARY_UI_VISIBLE`/`onSelectFromLibrary`) — generalizes into just another `toolbarActions` entry; no dedicated prop.
- **Analytics** (`useAnalytics()`/`trackFileManagerClick`) — fire-and-forget tracking pings gating no actual behavior; dropped entirely, no `onAction` telemetry callback added either (would be inventing a hook the origin's own calls don't need).
- **`buildSrcdoc`-based HTML iframe preview** and **Excalidraw-shaped sketch-JSON preview** — both are file-kind-specific rendering strategies this generic package cannot know about. Replaced by the single `renderPreviewThumbnail` host slot on `AssetTreeBrowser` (threaded to `FilePreviewPane`'s `renderThumbnail`), defaulting to a generic glyph-in-a-box placeholder.
- **`projectFileUrl`/`projectRawUrl`** (daemon-REST-endpoint builders) — fully replaced by the host-supplied `getFileUrl` callback prop; the builder functions themselves aren't ported at all.
- **The stylesheet-splitting display refinement** (`FileCategory = ProjectFileKind | 'stylesheet'`, the `STYLESHEET_EXTENSIONS` extension-sniffing carve-out that gave CSS/SCSS/etc. their own section separate from `code`) — this is presentation policy layered atop a fixed kind enum this package doesn't have. A host that wants the same effect encodes it directly in its own `getKind` implementation (return `'stylesheet'` for CSS-family extensions).
- **`kindFilter`/`page`/`pageSize`** on the origin's `DesignFilesNavState` — re-verified against the real file per the task brief's own instruction to double-check this: the origin component itself never applies a kind filter or paginates its own rendering (no filter UI, no pager UI anywhere in the file); those fields exist only to be reported upward to a parent outside this component. Confirmed absent from `AssetTreeNavState`, which carries only `currentDir`.

### Two corrections discovered while writing the orchestrator's own integration tests

Both are documented inline in the source, not just here:

1. **`useAssetTreeSelection` gained an optional `pendingRenamePath` param.** The origin's `commitRename` calls `await onRenameFile(...)` then patches `selected`/`preview` afterward — but its selection-pruning effect depends on `[files]` independently, with no coordination between the two. A host that updates its `files` prop as soon as `onRenameFile` resolves (a very plausible, even synchronous, real-world pattern — this session's own `AssetTreeBrowser.test.tsx` rename test hit it immediately with a stateful test harness) can re-render *before* the orchestrator's own `onRenamed` callback gets to run, pruning the in-flight old path out of the selection before it ever gets swapped for the new one — silently dropping the user's selection on every rename. `pendingRenamePath` (the path `useAssetTreeRename` currently has in flight, if any) exempts it from pruning until the rename actually resolves, closing the race. Proven by two dedicated `useAssetTreeSelection.test.ts` cases (with and without `pendingRenamePath`, showing the fix and the bug it fixes side by side) plus the orchestrator's own "renames a file, carrying an active selection and preview over to the new path" end-to-end test, which uses a small stateful `RenameHarness` wrapper specifically to exercise this race realistically rather than against a static `files` array.
2. **The row menu's copy-local-path action no longer closes the popover on click.** The origin's equivalent handler called `setMenuPos(null)` immediately before `copyLocalPath(name)` — every other menu action does this too, but for copy-local-path specifically it means the dedicated `copiedLocalPath`/"Copied" confirmation state can *never actually be seen*, since it only ever renders inside the now-unmounted popover. This reads as a real latent bug in the origin rather than intentional design (the whole point of a transient-confirmation label is to be visible). Fixed by not closing the menu for this one action; the existing outside-dismiss/Escape handling still closes it normally afterward. Proven by the orchestrator's "gates copy-local-path..." test, which asserts the "Copied" label actually renders.

Also, `useAssetTreeRename`'s failed-rename path surfaces `renameError` state instead of calling a blocking native `alert()` (the origin's own behavior) — a deliberate divergence, not an oversight: this package ships into a headless, agent-drivable engine (per this repo's own `AGENTS.md`), where a hardcoded blocking dialog call is exactly the kind of host-hostile side effect a generic UI feature must not own.

And `AssetTreeDomBridgePort.subscribeOutsideDismiss` takes a `container` parameter not present in the task brief's original type sketch — it binds to the already-shipped `utils/dom-subscriptions.ts`'s real `subscribeOutsideClickOrEscape(container, onClose)` signature (proper containment-based outside-click detection) instead of the origin's cruder "any `mousedown` anywhere closes the menu, and the popover manually stops its own `mousedown` from bubbling to protect itself" trick. Documented inline in `ports.ts`.

### The root-level "flattened tree" quirk — verified, not assumed, and preserved

`deriveTreeChildren` preserves a genuinely surprising piece of the origin's own `dirsAtCurrentDir`/`filesAtCurrentDir` `useMemo` verbatim: at the tree root (`currentDir === ''`), **every** file is pushed into `filesAtCurrentDir` — both root-level files and files nested under a subdirectory (which *also* separately contribute their top segment to `dirsAtCurrentDir`) — so the root view is a flattened "everything" listing with folders offered only as a secondary drill-down. Once navigated into any non-root directory, only files strictly at that one level are included. This asymmetry looked enough like a bug to warrant re-reading the real source line-by-line before committing to it (per the task's own "don't trust it blindly" instruction) — but it's exactly what the code does, so it's preserved rather than "fixed," with a `rules.test.ts` case asserting it explicitly (`'at the root, flattens every file (including nested) and surfaces the top-level dir'`).

### i18n wiring

Every user-facing string in every new component is routed through `useT()`,
English string as the key. Two pure `rules.ts` functions return
i18n-safe discriminated shapes instead of finished strings, so a caller can
translate without minting a new dictionary key per distinct value:
- `relativeTimeResult(ts, now)` returns `{label, translatable, params?}` —
  `translatable: true` means `label` is a stable template key
  (`'{n}m ago'`/`'Just now'`/etc.) to pass through `t(label, params)`;
  `translatable: false` means `label` is already a locale-formatted date
  string (`Date#toLocaleDateString`), which isn't a sensible translation key
  since it varies per call — mirrors `asset-grid/rules.ts`'s
  `dayHeadingResult`'s exact same `{label, translatable}` reasoning.
- Folder/section file counts and the selection/batch-bar counts use the same
  discipline directly at the call site (`t('{n} files', { n: count })`,
  `t('{n} selected', { n: count })`) rather than a dedicated rules.ts
  helper, since there's no branching logic to extract — just an
  interpolated template.

Verified end-to-end (not just that `t()` calls compile) by
`AssetTreeBrowser.test.tsx`'s "renders translated copy when mounted under an
I18nProvider with a matching dictionary" test, mounting under a French
dictionary and asserting `Fichiers`/`Dossiers` actually render in place of
the English `Files`/`Folders` fallbacks.

### Phase 8.5-equivalent audit — what it caught

- **Inline JSX callbacks with real branching**: the row's keyboard-Enter
  double-activation dispatch (`handleNameKeyDown` in `AssetTreeFileRow.tsx`)
  and the menu-trigger's click/keydown dispatch (`handleMenuTrigger`) were
  both extracted to named functions inside the component (not `rules.ts`,
  since they call the row's own props/refs directly) rather than left as
  inline arrows; the underlying *decision* logic each dispatches to
  (`isDoubleActivation`, `computeMenuPosition`) is pure and lives in
  `rules.ts`, unit-tested in isolation. The row menu popover's own
  `onMouseDown`/`onClick` `stopPropagation()` one-liners were left inline —
  the same single-line "don't bubble" idiom already established as
  acceptable inline elsewhere in this package (e.g. `asset-grid`'s
  `DeleteConfirmDialog.tsx` backdrop click).
- **Multi-line/inline-construction `useMemo`/derivation bodies**: none of
  the 9 hooks compute anything beyond a one-line call into an already-pure
  `rules.ts` function or a plain default-selection expression — the target
  end state, no extraction needed.
- **Orphaned `useState`/`useRef`**: enumerated every one across all 9 hooks
  and the orchestrator by hand — `useAssetTreeNavigation`'s `currentDir`,
  `useAssetTreeSelection`'s `selected`, `useAssetTreePreview`'s
  `previewPath` + `autoPreviewAppliedRef`, `useAssetTreeRename`'s
  `renaming`/`renameError`, `useAssetTreeRowMenu`'s `menuPos` +
  `containerRef`, `useAssetTreeDragUpload`'s `draggingFiles`/
  `dropReadError` + `dragDepthRef` + `onUploadFilesRef`,
  `useAssetTreeClipboardPasteUpload`'s two latest-value-bridging refs,
  `useAssetTreeBatchActions`'s `deleting`/`downloading`/`downloadError`,
  `useAssetTreeCopyLocalPath`'s `copiedPath`, `AssetTreeFileRow`'s
  `lastActivationRef` — every one traced to a real read site, none
  unassigned.

`pnpm --filter @jini/ui run typecheck` was re-run clean after every fix in
this pass.

### Purity grep — reported verbatim per this task's own instructions

```
$ grep -rn "Open Design\|OD_\|--od-stamp\|open-design\.ai\|openDesignDesktop\|@open-design/" packages/ui/src/features/asset-tree-browser/
(no output — clean)

$ grep -rn "od-" packages/ui/src/features/asset-tree-browser/
(no output — clean)
```

One doc comment in `AssetTreeBrowser.tsx` initially read "Ported from Open
Design's `DesignFilesPanel.tsx`" — caught by the first grep above during
this same pass and reworded to "Ported from a design-tool origin project's
file-manager panel," matching this section's own prose-only provenance
convention (bare source filenames like `DesignFilesPanel.tsx` are fine to
cite — 15 files across this feature do — the product name itself is not).

### Test/coverage/typecheck/guard results — verbatim

- `pnpm --filter @jini/ui run typecheck`: **clean, zero errors** (confirmed both mid-pass and as the final check).
- `pnpm --filter @jini/ui exec vitest run src/features/asset-tree-browser --coverage --coverage.reporter=json-summary --coverage.reporter=json`: **251 tests, 22 files, all green.** Coverage read from the real `coverage-summary.json` (not the v8 text table, which silently drops rows — per this task's own Phase 9.5 method), aggregated across every file in the feature:
  ```
  statements 1223 / 1223  100.00%
  branches    476 /  476  100.00%
  functions    94 /   94  100.00%
  lines      1223 / 1223  100.00%
  ```
  **Every individual file is 100% on all four metrics** — no file needed a specific call-out, no `/* v8 ignore */` anywhere. The loop closed in two passes: pass 1 landed at 99.92% statements / 96.30% branches / 91.49% functions aggregate; classifying every uncovered line found one genuinely dead ternary arm in `rules.ts`'s `filesFromDataTransfer` (refactored away — the `if (rejected)` guard above it already proves every remaining result is fulfilled) and one genuinely-unreachable ternary arm in `AssetTreeBrowser.tsx`'s copy-local-path handler (the button is `disabled` whenever the arm would matter, so a real click can never reach it — replaced with an asserted non-null read + comment); every other gap was a reachable-but-untested line/branch, closed with a real test (see the "corrections" and audit sections above for the interesting ones: the non-FileSystemReadError rethrow, the cancel-during-in-flight-rename race, the omitted-`folders`/omitted-`dependencies` default paths, the vanishing-menu-file race, the two-level-nested-folder path template branch).
- Full package `pnpm --filter @jini/ui exec vitest run`: **1460 tests, 162 files, all green** (no regressions in any other feature).
- Full monorepo `pnpm -r --no-bail --if-present run typecheck`: `packages/ui typecheck: Done` (clean). Summary: 9 fails, 7 passes — every failure pre-existing and unrelated to this task, the identical set the `asset-grid` section above already documented: `agent-runtime`/`chat-react`/`cli`/`http`/`node-host`/`renderers-react`/`sqlite` (7 stub packages genuinely missing a `tsconfig.json`) and `daemon`/`deploy` (2 packages failing only on unbuilt `@jini/protocol`/`@jini/core` workspace `dist/` output in this fresh checkout — a build-order issue, not a type error).
- `pnpm guard` (repo root): `[guard] ok (skeleton — rules pending implementation during extraction)` — unchanged, no boundary violations introduced.

### Dependencies installed, not skipped

`node_modules` did not exist anywhere in this repo checkout at the start of
this task (confirmed: no root `node_modules`, no `vitest` binary resolvable
via `pnpm --filter @jini/ui exec vitest`). Per this task's own instruction
("do NOT run `pnpm install` at the repo root unless you find dependencies
are missing"), ran `pnpm install` once at the repo root — this genuinely
qualified as the documented exception, not a shortcut.

---
---

## Section: `features/memory/` — MemorySection vertical-slice port (2026-07-18)

### Source

**PR #5228**, `nexu-io/open-design`, "refactor(web): decompose MemorySection into a
features/memory vertical slice" —
<https://github.com/nexu-io/open-design/pull/5228> — closed 2026-07-15 **without
merging**, authored by this project's own owner. Pinned at commit
`d695f1e0f2b85a032aa7ce4895a3eb764cb1b65d` (verified: `git fetch
https://github.com/nexu-io/open-design.git refs/pull/5228/head` resolves to this
exact SHA). Primary source read in full at that commit:
`apps/web/src/features/memory/`, `apps/web/src/providers/memory/`,
`apps/web/tests/features/memory/`.

### What happened, plainly

The decomposition itself did **not** create bugs. Extensive automated review (many
rounds, over an extended review cycle) found a long sequence of real
async/state-correctness bugs — malformed-response trust, concurrency races,
missing error handling, stale state on retry — but the PR author independently
verified via `git show` against the original 2,636-line pre-refactor
`MemorySection.tsx` that **every one of those bug classes already existed
byte-for-byte in the monolith**. The decomposition didn't introduce them, it
exposed pre-existing ones that had zero test coverage (the original file's 29
tests were 100% happy-path — no test for a failed fetch, a malformed response, two
operations racing, or a retry). The author fixed round after round of these as
they were found, and closed the PR because the review process felt endless, not
because a reviewer or maintainer rejected the underlying approach — the
maintainer's own last comment explicitly agrees the bugs were pre-existing and
only asks that the PR's own remaining loose ends be closed before merging.

One specific bug was still open and unfixed when the PR was closed: `fetchMemoryList()`
in the pinned source's `providers/memory/entries.ts` validated only that the
`entries` field was present on a 2xx response, even though
`useMemoryConfig.hydrate()` (`enabled`) and `useMemoryEntries.reload()`
(`rootDir`/`index`) all consumed other fields off that same response with no
fallback. A malformed `200` like `{ entries: [] }` passed validation and then
silently hydrated those fields to `undefined` instead of surfacing a broken
response. **Fixed as part of this port** — see "The `fetchMemoryList()` fix"
below.

### Standing flag for later

Open Design's own live version of this component (the still-monolithic
`components/MemorySection.tsx` on its current `main`) likely still has these bugs
today, since the fix never merged there. If Open Design revisits this component
in the future, PR #5228's later commits (and this Jini port, which carries the
fixes forward plus the one additional fix made here) are a ready-made reference
for what a corrected version looks like.

A broader CI/CD gate generalizing the exact bug taxonomy found here
(malformed-success responses, races, missing error handling, stale state on
retry) as a standard requirement for future async-heavy ports is tracked as a
**separate follow-up**, not part of this task's scope.

### Where it landed, and why (`packages/ui/src/features/memory/`, not `chat-react`)

Per `foundry/docs/jini-port/god-components-extraction-plan.md`'s Consolidation map and
`packages/ui/README.md`'s scope boundary: Memory is a settings/data-management
surface (saved facts/preferences, an editable index, connector-sourced
suggestions) — the same shape as the already-shipped `features/connectors/` and
`features/settings-dialog/`, not a conversation surface. It lands alongside them
in `@jini/ui`, using the **new** `types.ts`/`constants.ts`/`rules.ts`/`ports.ts`/
`dependencies.ts`/`formatters.ts`/`async-commit-guard.ts`/`index.ts` at the
feature's top level, `hooks/`+`components/` under a `react/` subfolder — the
layout decided 2026-07-17, matching `features/viewer-shell/`/`features/asset-grid/`/
`features/sketch-editor/`, not `features/connectors/`'s older flat layout.

### The connector-reconciliation-reducer decision (the "third piece")

The task brief's third sought piece — "connector-reconciliation reducers" — does
**not** come from PR #5228. Its real origin is Open Design's `main`-branch
`apps/web/src/components/connectors-state.ts` (confirmed by cloning
`https://github.com/leonaburime-ucla/open-design.git` at its default `main`
branch and reading `connectors-state.ts` directly, since `codex/connector-memory-settings`,
the branch originally suspected to hold this, diffs empty against current `main`
— i.e. that logic already lives on `main` by some other route). Its 4 functions
— `connectorAuthSnapshotChanged`/`hasConnectorStatusChanges`/`mergeConnectorCatalog`/
`applyConnectorStatuses` — are a **separate, shared/generic** connector-list
reconciliation module OD's `MemorySection.tsx` monolith imports directly
(`import { hasConnectorStatusChanges } from './connectors-state'`), distinct from
PR #5228's own Memory-local `mergeMemoryConnector`/`upsertMemoryConnector`/
`applyMemoryConnectorStatus(es)`/`connectorStatusesChanged` (which the PR's own
`rules.ts` comment calls "convenience duplication" of the shared module, kept
slice-local per the PR's own stated slice conventions).

Direct line-by-line comparison found `@jini/ui`'s `features/connectors/rules.ts`
**already ships the generified port of `connectors-state.ts`** — from the
`ConnectorsBrowser.tsx` canary task (2026-07-17), see that section above —
as `mergeConnectors`/`applyConnectorStatuses`/`hasConnectorStatusChanges`/
`connectorAuthSnapshotChanged`, operating on the generic `Connector`/
`ConnectorStatusMap` types instead of OD's `ConnectorDetail`. Their logic is
identical to `connectors-state.ts`'s (verified field-by-field), and `mergeConnectors`
already subsumes what PR #5228's `mergeMemoryConnector`+`upsertMemoryConnector`
did (single-connector merge + array upsert in one pass). This is exactly the
overlap `god-components-extraction-plan.md`'s Consolidation map flagged in
advance: *"Memory slice's connector reducers... substantially overlap
`features/connectors`'... check whether it can import these directly instead of
re-deriving equivalents."*

**Decision**: `features/memory/rules.ts` imports `mergeConnectors`/
`applyConnectorStatuses`/`hasConnectorStatusChanges` from `../connectors` and
re-exposes two thin, Memory-specific conveniences over them
(`upsertMemoryConnector` = `mergeConnectors(current, next ? [next] : [])`;
`applyMemoryConnectorStatus` = the 1-item form of `applyConnectorStatuses`, used
by the synthetic not-yet-detailed catalogue row). Only `connectorWithPendingAuthorization`
(no equivalent in `features/connectors`) is genuinely new Memory-local logic.
Memory's own connector type is `Connector` from `features/connectors/types.ts`
directly (not a third near-duplicate of `ConnectorDetail`) — its shape already
matches (id/name/provider/category/status/accountLabel/lastError/tools/toolCount/
toolsNextCursor/toolsHasMore/logoUrl).

### The `fetchMemoryList()` fix

`dependencies.ts`'s `fetchMemoryList()` now validates `entries`/`rootDir`/`index`/
`enabled` are all present on a 2xx response (throwing `"Memory list request
succeeded without a '<field>' field"` if any is missing), matching the pattern
already used by the pinned source's own `fetchMemoryEntry()` (which the PR had
already fixed earlier in its history: only a genuine 404 maps to `null`, and a
successful-but-field-missing response throws via `requiredNonNullField` rather
than silently returning something falsy-but-plausible). The four per-hook flags
(`chatExtractionEnabled`/`profileEnabled`/`rewriteEnabled`/`verifyEnabled`) are
**deliberately not** added to the required set — `useMemoryConfig.hydrate()`
already treats their absence as legitimate legacy-default behavior
(`list.xEnabled !== false`), a design choice already present and already
documented in the pinned source; validating them as required would be a
*behavior* change, not a bug fix.

Before/after, `dependencies.ts`:
```ts
// BEFORE (the pinned source, still-open bug)
export async function fetchMemoryList(): Promise<MemoryListResponse> {
  const resp = await fetch('/api/memory');
  if (!resp.ok) throw new Error(`Memory list request failed (${resp.status})`);
  const json = (await resp.json()) as MemoryListResponse;
  requiredField(json, 'entries', 'Memory list request');
  return json;
}

// AFTER (this port's fix)
export async function fetchMemoryList(): Promise<MemoryListResponse> {
  const resp = await fetch('/api/memory');
  if (!resp.ok) throw new Error(`Memory list request failed (${resp.status})`);
  const json = (await resp.json()) as MemoryListResponse;
  requiredField(json, 'entries', 'Memory list request');
  requiredField(json, 'rootDir', 'Memory list request');
  requiredField(json, 'index', 'Memory list request');
  requiredField(json, 'enabled', 'Memory list request');
  return json;
}
```
Regression coverage: `dependencies.test.ts`'s `fetchMemoryList` describe block
parametrizes over all 4 newly-required fields (each rejected when absent), plus
an explicit test reproducing the exact bug-report payload (`{ entries: [] }`
alone) and a test proving the 4 per-hook flags are still NOT required.

### Transport binding: real HTTP, not a fake — a deliberate deviation from the connectors canary's precedent

`features/connectors/dependencies.ts` ships a **fake** in-memory double for its
main data port by design (the real transport is a specific third-party
OAuth-catalog vendor's API shape, which a product-neutral package shouldn't
assume). Memory's `/api/memory*` surface is different: a plain, generic
list/tree/entry-CRUD + config-PATCH + extraction-history-CRUD REST contract with
no third-party vendor coupling, and the task's own bug-fix/regression-test
requirement only makes sense against a real, testable adapter. So
`memoryConfigPort`/`memoryEntriesPort`/`memoryExtractionsPort` bind **real**
`fetch`-based adapters (ported from the pinned source's `providers/memory/{config,entries,extractions}.ts`,
with the `fetchMemoryList` fix applied) as this package's default — a disclosed,
deliberate difference from the connectors canary's fake-only convention, not an
oversight.

`memoryConnectorsPort`, by contrast, keeps the fake-by-default convention:
`fetchMemoryConnectors`/`fetchConnectorStatuses`/`connectConnector`/
`suggestConnectorMemories` all depend on the same kind of vendor-specific
OAuth-catalog discovery transport `features/connectors` already declines to ship
for real, so `createFakeMemoryConnectorsPort()` (an in-memory catalogue double,
same shape as `createFakeConnectorsPort`) is the default. `saveMemoryEntry` on
this same port is the **real** HTTP adapter, though — saving a connector
suggestion is an ordinary memory write, not a connector-transport concern, so it
reuses the entries cluster's real binding rather than being faked too.
`readPendingConnectorAuthIds`/`writePendingConnectorAuthIds` (sessionStorage) and
`notifyConnectorsChanged` (a same-page `CustomEvent`, `jini:memory-connectors-changed`
— the pinned source's cross-tab broadcast mechanism, out of scope for this
slice, same carve-out `features/connectors` already made for its own
`connectors-events.ts`) are real, SSR-guarded browser-only bridges, matching
`features/connectors`' own real-bridge-for-generic-browser-APIs convention.

### `MemoryHooksPanel` folded in from a separate OD file

The pinned source's `MemoryHowPanel.tsx` imports `MemoryHooksPanel` from OD's
**separate** `components/MemoryHooksPanel.tsx` (not part of `features/memory/`,
single consumer). Ported into this slice as
`react/components/MemoryHooksPanel.tsx` rather than left as a dangling
cross-package import — it has no other consumer in OD's tree and no reason to
live outside this feature in Jini. Its `.module.css` import was dropped (no
CSS-module build step in this package yet, same as every other component in
this package's earlier flat-group porting task) and flattened to plain
`memory-hooks-panel*` class names; its `useT()` dictionary keys were converted
to plain-English keys per this package's i18n convention (see below).

### `renderMarkdown`: a scoped-down local reimplementation, not the real `runtime/markdown.tsx`

`MemoryEntryCard.tsx`'s saved-memory preview needs to render a memory body's
Markdown. The pinned source's real `runtime/markdown.tsx` (2,881 lines) is
chat/artifact-rendering territory this package's own README already scopes out
to `@jini/chat-react`/`@jini/renderers-react` (see the "i18n/observability/utils
sweep" section above: "Deferred, not yet ported"). Rather than drop the feature
or take on that whole file, `react/render-markdown.tsx` is a ~20-line local
reimplementation covering just this one need — GFM Markdown → HTML via
`micromark`/`micromark-extension-gfm` (already real dependencies of this
package, added earlier for `utils/markdown-scroll-sync.ts`). `micromark`
escapes raw HTML in its input by default (`allowDangerousHtml` is not set), so
this is XSS-safe without a separate sanitizer pass — proven by a real test
asserting a `<script>`/event-handler payload embedded in memory-body Markdown
renders as inert text, not live markup.

### `copyToClipboard` semantics changed under the port — adapted, not ignored

`useMemoryEntries.hooks.ts`'s `onCopyPath` in the pinned source relied on
`copyToClipboard` **rejecting** when both the Clipboard API and its
`execCommand('copy')` fallback fail, catching that rejection to avoid a false
"copied" flash. `@jini/ui`'s own `utils/copy-to-clipboard.ts` (ported earlier,
2026-07-16) has a different, already-shipped contract: it **never rejects** —
it resolves `false` on total failure, having already implemented the same
Clipboard-API-then-`execCommand`-fallback chain internally. `onCopyPath` was
adapted to check the boolean return instead of catching a throw, preserving the
original intent (never claim success on a total failure) against the actual
contract of the utility this package already ships, rather than silently
becoming dead code (a `catch` block that could never fire).

### i18n

Every user-facing string across all 8 components routes through `useT()`,
following this package's "the English string itself is the key" convention
(`t('Connect')`, not `t('settings.memoryX')`) — the pinned source's OD dictionary
keys are product content and were not ported; every `t(...)` call site below
uses a plain-English default chosen from surrounding context (there was no OD
dictionary available to port the actual translated copy from, since that
content is explicitly out of scope per this package's own established i18n
policy). `constants.ts`'s `STARTERS` array changed shape accordingly — plain
`name`/`description`/`body` strings instead of dictionary-key fields — since the
manual editor's starter chips now call `t(starter.name)` etc. directly at the
render site, matching how every other pure-data module in this package already
defers translation to the call site (`rules.ts`'s `statusLabel()` precedent,
noted in the connectors section above).

### Purity grep

`grep -rn "Open Design\|OD_\|--od-stamp\|/tmp/open-design\|@open-design/\|open-design\.ai\|openDesignDesktop"`
across every file in `features/memory/`: **clean, zero matches** (two
provenance-comment leaks initially found during a self-review pass — a literal
`Open Design` in `rules.ts`'s comment and a literal `@open-design/` in
`types.ts`'s comment — were caught and reworded to `OD`, matching the
established convention already used elsewhere in this package, e.g.
`features/connectors/dependencies.ts`'s "OD's real implementation calls
`providers/registry`"). A second pass for the lowercase lookalikes this
package's earlier sections also checked (`od-*` class prefixes, `composio`)
found one real hit: the pinned source's hardcoded `provider: 'composio'` for a
synthetic not-yet-detailed connector catalogue row — replaced with a neutral
`DEFAULT_CONNECTOR_PROVIDER` constant (`'connector-catalog'`), documented in
`constants.ts` with the same reasoning `ConnectorLogo`'s Composio-CDN-slug drop
used in the connectors canary section above.

### What's intentionally not ported (host-owned, or genuinely out of scope)

- **The orchestrator itself.** Unlike the `ConnectorsBrowser.tsx` canary (which
  shipped its own full orchestrator inside the slice), PR #5228's diff never
  included OD's `components/MemorySection.tsx` — that 2,636-line file stays the
  host's own composition root, importing this slice's pieces through its
  barrel. This port ships exactly what PR #5228 shipped: ports + dependencies +
  hooks + dumb components + barrel, no orchestrator.
- **The two OAuth browser subscriptions** (the mid-authorization status poll,
  the popup-callback message listener) and **the SSE event stream**
  (`/api/memory/events`). All three open accumulating browser subscriptions;
  the pinned source's own `useMemoryConnectors.hooks.ts` file-header comment
  already documents that a single-instance host orchestrator must own these and
  drive the hook's exposed `refreshConnectorStatuses()`/`applyExtractionEvent()`
  — this port preserves that exact seam rather than inventing a different one.
  `ports.ts` correctly never declared these as slice responsibilities in the
  first place.
- **`isTrustedConnectorCallbackOrigin`/`subscribeConnectorCallback`/
  `subscribeConnectorStatusPolling`** (the pinned source's
  `providers/memory/connector-auth.ts`) — same reasoning: these back the two
  host-owned OAuth subscriptions above, not a slice-owned port method.

### Test/typecheck/coverage results

- `pnpm --filter @jini/ui typecheck`: green (zero errors).
- `pnpm --filter @jini/ui exec vitest run src/features/memory`: **423 tests, 21
  files, all green** — `async-commit-guard` (4), `rules` (12), `formatters`
  (38), `dependencies` (30, including the full `fetchMemoryList()` bug-fix
  regression suite), `index` (3, this feature's own barrel completeness
  smoke test), the extraction-history store (46, direct unit tests of the
  pure concurrency-ordering rules), 6 hook test files (`useMemoryFlash` 7,
  `useMemoryNavigation` 10, `useMemoryConfig` 33, `useMemoryEntries` 46,
  `useMemoryExtractions` 27, `useMemoryConnectors` 61), and 9 component test
  files (`MemoryHooksPanel` 6, `MemoryHowPanel` 4, `MemoryEntryCard` 8,
  `MemoryExtractionCard` 9, `MemoryList` 11, `MemoryAdvancedModal` 15,
  `MemoryManualEditor` 15, `MemoryConnectedPanel` 32, `render-markdown` 6).
  Every hook has a mounted `renderHook` test against a hand-written fake
  port; every component has both a `@testing-library/react` mount test and a
  real `I18nProvider`-mounted French-dictionary translation-proof test.
- **Coverage (v8, `json-summary`/`json` reporters): 100% on all 4 metrics —
  statements, branches, functions, lines — aggregate (2616/2616 statements,
  993/993 branches, 120/120 functions, 2616/2616 lines) AND every individual
  file**, clearing the ≥99%-with-100%-as-the-goal bar with no `/* v8 ignore */`
  anywhere. Reached via the classify-then-fix loop: every initially-uncovered
  branch was genuinely reachable and got a real test (a `requiredNonNullField`
  present-but-null case, a connector with no `accountLabel`, a blocked
  `sessionStorage` write, the editor scroll/focus effect — driven by
  attaching real DOM elements to the hook's returned refs before triggering
  it, rather than writing it off as hook-level-untestable, a suggestion's
  `toolTitle`-only source-label fallback) — except one real dead branch,
  found in `useMemoryExtractions.hooks.ts`'s `reloadExtractions()`: a
  `try/catch/finally` whose bare `catch {}` never itself throws carried a
  structurally-unreachable "exception during catch, before finally" edge
  that no test could ever satisfy. Refactored away (not suppressed) per this
  project's coverage policy — replaced the `finally` with an explicit
  `endReload()` call at each of the 3 return points, behavior-preserving.
- Full monorepo `pnpm -r --no-bail run typecheck`: 7 pass, 9 fail — every
  failure pre-existing and unrelated (stub packages with no `tsconfig.json`
  at all: `agent-runtime`/`chat-react`/`cli`/`http`/`node-host`/
  `renderers-react`/`sqlite`; `daemon`/`deploy` failing only on unbuilt
  `@jini/protocol`/`@jini/core` `dist/` resolution, per this checkout not
  having run `pnpm -r run build`) — the same set of pre-existing breakages
  every prior section in this file has already documented. `@jini/ui` itself,
  `@jini/core`, `@jini/protocol`, `@jini/platform`, `@jini/sidecar`,
  `@jini/chat-core`, and `foundry/automation/project-runner` all typecheck clean.
- Purity grep (`Open Design`/`OD_`/`--od-stamp`/`/tmp/open-design`/
  `@open-design/`/`open-design.ai`/`openDesignDesktop`, plus the stricter
  lowercase `od-`/`composio` self-imposed pass) across every file in
  `features/memory/`: **clean, zero matches** — two provenance-comment leaks
  (a literal `Open Design` and two literal `@open-design/contracts`
  mentions, all in doc comments explaining what was ported *from*, none in
  actual code) were caught during self-review and reworded to `OD`, matching
  this package's established convention.
- `pnpm guard` (repo root): `[guard] ok (skeleton — rules pending
  implementation during extraction)` — unchanged, no boundary violations
  introduced.

## Section: `features/file-dropzone/` — consolidating OD's two file-staging zones (2026-07-18)

### Source

Two independent OD file-staging zones, both read in full from the real fork
(`git clone https://github.com/leonaburime-ucla/open-design.git`, not this
repo's frozen `foundry/integrations/open-design/reference/` snapshot):

- `apps/web/src/components/DesignSystemAssetDropzone.tsx` (564 lines) — a
  rich, kind-aware thumbnail grid over staged `File[]`: native drag/drop
  (directory-aware at the *parent's* level, not its own), click-to-browse,
  clipboard paste, kind-dispatch thumbnails (image/font/pdf/html/video/audio/
  slides/text/other), remove tiles, and a click-to-enlarge lightbox with a
  type-appropriate preview per kind.
- `DesignSystemFlow.tsx`'s embedded `DropZone` (~190 lines, search the file
  for `function DropZone`) — a labeled, prompt-driven zone: native drag/drop
  (owns directory-aware reading itself), click-to-browse with a file-dialog
  cancel-vs-still-loading detection heuristic (`SOURCE_FILE_DIALOG_FOCUS_DELAY_MS`/
  `_WARMUP_MS`/a stale-timeout safety net), a plain staged-names list with
  optional per-name removal, and an external "Browse folder" trigger.

### The consolidation decision: ONE primitive, with evidence

Read both in full before designing anything, per the task brief. Verdict:
**consolidate into one `FileDropzone` primitive** — not two components
sharing a subdirectory, one component with configuration knobs. Evidence:

1. **Both are the exact same underlying interaction** — native drag/drop +
   click-to-browse, resolving to a flat `File[]` the host stages. The only
   real differences are *display* (thumbnail grid + lightbox vs. a plain
   prompt/names line) and which capabilities are wired on (paste,
   directory-select, the loading heuristic) — configuration, not a different
   component shape.
2. **They already shared the same directory-walking algorithm at the OD
   source level**, just wired at different layers: `DropZone`'s `readDrop`
   calls `filesFromDataTransfer` (a `webkitGetAsEntry` recursive directory
   walker) internally before calling `onFiles`; `DesignSystemAssetDropzone`'s
   `onDrop` prop just hands the raw `DataTransfer` up to its parent
   (`DesignSystemFlow.tsx`'s `handleAssetDrop`), which calls the **exact
   same** `filesFromDataTransfer` function (same file, one module-level
   definition) before staging. One algorithm, two wiring styles — a textbook
   case for one primitive owning it internally always, which is what this
   port does (both variants now get directory-aware drop resolution for
   free, including the thumbnail-grid variant, which never had it before).
3. **A duplicate of that same algorithm already existed a third time in this
   package** — `features/asset-tree-browser/rules.ts`'s `filesFromDataTransfer`
   (ported earlier from `DesignFilesPanel.tsx`, already fully generic). This
   is exactly the failure mode flagged by an independent audit the night
   this task was dispatched ("an undetected duplicate primitive") — so
   rather than writing a *fourth* copy for `file-dropzone`, this task
   promotes the shared logic to `utils/file-transfer.ts` (see below) and
   both features now import the one implementation.

### Shared-primitive promotion (fixing a pre-existing near-duplicate, not just avoiding a new one)

- **`utils/file-transfer.ts`** (new): `filesFromDataTransfer`/
  `filesFromFileSystemEntry` (recursive directory-walk drop resolution) and
  `filesFromClipboardData`/`normalizePastedFile`/`extensionForMimeType`/
  `shouldIgnoreClipboardFilePaste` (clipboard-paste resolution), moved
  verbatim out of `features/asset-tree-browser/rules.ts`.
  `asset-tree-browser/rules.ts` now re-exports these same names from the new
  location — its own barrel (`index.ts`) and every existing test are
  unchanged, since they only ever imported by name, not by knowing which
  file backed the implementation.
- **`browser/useFileDropTarget.ts`** (new): the nesting-depth-tracked
  drag-over-state + drop-read-error hook, promoted the same way out of
  `features/asset-tree-browser/react/hooks/useAssetTreeDragUpload.ts` (itself
  already fully generic — zero asset-tree-browser types) into this
  package's shared `browser/` folder (already the established home for
  cross-feature DOM-interaction hooks — `useDismissOnOutsideOrEscape`,
  `useGlobalKeydown`). `useAssetTreeDragUpload` now re-exports
  `useFileDropTarget` under its original name; its own test file is
  unchanged and now exercises the promoted implementation directly.
  `file-dropzone`'s own native-drop handling uses this hook too.
- Neither promotion changed any public export surface `@jini/ui` already
  had — both re-exporting modules keep their old names, so nothing outside
  this task needed to change.

### What shipped (`packages/ui/src/features/file-dropzone/`)

| File | Contents |
|---|---|
| `types.ts` | `FileDropzoneKind` (the 9-member kind union), `FileDropzonePreviewState` (the object-URL/font-family/text-snippet maps the preview layer produces). Zero runtime statements — excluded from coverage in `vitest.config.ts`, matching the `settings-dialog`/`list-detail-panel` precedent. |
| `constants.ts` | `FILE_DROPZONE_KIND_BY_EXTENSION`, `FILE_DROPZONE_GLYPH_ICON`, font specimen/pangram strings, text-preview size caps, and the file-dialog timing constants (`FILE_DIALOG_FOCUS_DELAY_MS`/`_WARMUP_MS`/`_STALE_MS`, the processing-affordance min-visible delay and file-count/byte thresholds) — all ported verbatim from the two origin files' module-level constants. |
| `rules.ts` | `fileDropzoneKind`/`fileDropzoneExtension`/`fileDropzoneNeedsObjectUrl`/`fileDropzoneExtensionLabel`/`fileDropzoneSizeLabel`/`fileDropzoneStagingKey`/`fileDropzoneFontFamilyName` (all ported from `DesignSystemAssetDropzone.tsx`'s module-level helpers, renamed off the OD-branded style), `fileDropzoneShouldShowProcessing` (ported from `DesignSystemFlow.tsx`'s `shouldShowProcessing`, parameterized over the thresholds instead of reading module-level constants directly). Hook-free by design. |
| `react/hooks/useFileDialogTracking.ts` | The file-dialog cancel-vs-still-loading detection heuristic, ported from `DropZone` — the "real, non-obvious behavior worth testing carefully" the task brief called out. Deliberately generalized beyond the origin: there, the heuristic only ran for the directory-browse zone (`directory && onProcessingStart`); here it runs for any zone that supplies `onProcessingStart`, since the heuristic has no directory-specific behavior. Also fixes a latent gap the origin never handled: no timer cleanup on unmount at all (this port clears every timer on unmount without invoking a stored `finish`, since calling into host state after unmount would be the host's problem to have prevented, but leaking a timer forever isn't). |
| `react/hooks/useFileDropzonePreviews.ts` | The three `files`-keyed preview effects (object-URL creation/revocation, `FontFace` loading, bounded text-snippet reads), ported from `DesignSystemAssetDropzone.tsx` verbatim, including its own doc comment explaining the StrictMode-safe create/revoke-in-one-effect shape (the alternative — create in a `useMemo`, revoke in a separate empty-deps cleanup — breaks any preview staged at first mount). |
| `react/hooks/useFileDropzone.ts` | The orchestrating hook: native drag/drop (via `browser/useFileDropTarget`), click-to-browse (via `useFileDialogTracking`), the shared large-selection processing-affordance heuristic (`fileDropzoneShouldShowProcessing` gating whether `onProcessingStart` wraps the staging work, ported from `DropZone`'s `processSelectedFiles`/`shouldShowProcessing`/`runAfterNextPaint`), and an optional page-wide clipboard-paste listener (ported from `DesignSystemAssetDropzone.tsx`'s paste effect, routed through the promoted `filesFromClipboardData`/`shouldIgnoreClipboardFilePaste` utilities instead of the origin's narrower inline check). |
| `react/components/FileDropzoneThumbnailGrid.tsx`, `FileDropzoneLightbox.tsx` | The kind-aware thumbnail grid and click-to-enlarge lightbox, ported from `DesignSystemAssetDropzone.tsx`, split into two dumb components (the origin inlined both in one file). |
| `react/components/FileDropzoneNameList.tsx` | The simple staged-names chip list with optional per-name removal, ported from `DropZone`'s inline names/remove-button markup. |
| `react/components/FileDropzone.tsx` | The orchestrator, composing the above. Renders the thumbnail grid when `files` is supplied, the removable name-chip list when `names`+`onRemoveName` are both supplied, or the names joined directly into the zone's own text when `names` is supplied without `onRemoveName` (matching `DropZone`'s exact `names.length > 0 && !onRemoveName` branch) — the three origin display modes as one component's prop combinations, not three components. |
| `index.ts` | Public barrel. |

### De-branding

No OD-branded identifier anywhere: not `DesignSystemAssetDropzone`, not
`DropZone` (which would have collided with a generic "drop zone" naming
instinct anyway) — the feature and every exported symbol is `FileDropzone`/
`fileDropzone*`/`useFileDropzone*`. The origin filenames appear only in doc
comments citing provenance (`Ported from DesignSystemFlow.tsx's DropZone`),
matching this package's established citation convention (e.g.
`asset-tree-browser`'s "Ported from a design-tool origin project's
file-manager panel" and every other section in this file) — not as any
package-internal folder/type/component name.

### Deliberate generalizations beyond a literal port

- **The "select from library" affordance**: the origin gated a "Select from
  library" button behind `LIBRARY_UI_VISIBLE`, an OD product feature flag.
  This ships as `secondaryAction?: { label; onClick }` — a plain optional
  prop whose *presence* gates visibility (matching this package's existing
  idiom, e.g. `asset-tree-browser`'s `downloadFiles?`/`getFileUrl?`), so any
  host can wire in any secondary affordance, not just a library picker.
- **Directory-aware drop resolution for the thumbnail-grid variant**: the
  origin's `DesignSystemAssetDropzone` never itself expanded dropped
  folders (its parent did, before staging) — this port's native-drop
  handling is now owned by the primitive itself (via the promoted
  `useFileDropTarget`), so every variant gets folder-aware drops uniformly.
- **A drop-read error now has two ways to surface**: `useFileDropTarget`'s
  own `dropReadError` state is returned directly from `useFileDropzone` (for
  a host that wants to render its own inline banner), *and* mirrored into
  the optional `onError` callback prop (matching `DropZone`'s original
  contract) — a strict superset, not a behavior change for either origin.
- **Full-sentence i18n keys for the default zone prompt** (`'Drag & drop,
  paste, or browse'`) instead of splitting `"browse"` into its own styled
  inline `<span>` the way `DesignSystemAssetDropzone` did — wrapping a
  sub-phrase in its own `t()` call would let a translator reorder words in a
  way that breaks the surrounding sentence; one `t()` call per full sentence
  avoids that concatenation-based i18n antipattern, matching this package's
  i18n policy.

### A real bug found and fixed during this port, not silently carried over

`FileDropzone.tsx`'s first draft called `useFileDropzonePreviews(files ?? [])`.
Since `files ?? []` allocates a **fresh empty array on every render** when
`files` is omitted, and `useFileDropzonePreviews`'s three effects are keyed
on that array by reference, every render re-triggered all three effects —
whose own `setState` calls (each producing a new, also-fresh `Map`, even
when functionally empty) re-render the component, recreating the fallback
array again: **an infinite render loop whenever the `files` prop was
omitted entirely** (the bare/simple-variant path, i.e. most real usage).
Caught by a genuine test hang (a runaway `renderHook`/`render` loop pegging
CPU, not a logic assertion failure) during this task's own test-writing
pass, root-caused, and fixed with a module-level stable `NO_FILES: File[] = []`
constant instead of an inline fallback. Documented here per this project's
"learn from tonight's audit findings" instruction (silently-swallowed or
undetected defects are exactly what the audit flagged) — this one was
caught, not shipped.

### i18n

Every user-facing string in every new file routes through `useT()`, English
string as key, per this package's i18n policy. `rules.ts` stays hook-free —
no string formatting happens there that needs translation. Every component
has both a `@testing-library/react` mount test and a real
`I18nProvider`-mounted French-dictionary test proving the translated text
actually renders, including one end-to-end `FileDropzone` test translating
the label, prompt, helper, browse-folder button, secondary action, and the
zone's own `aria-label` together in one flow.

### Phase 9.6 — async/network test-category gate

`useFileDropzonePreviews`'s font-loading effect and text-snippet-read effect
are this feature's only async surfaces (object-URL creation is synchronous).
Explicit tests cover all 4 categories against both:
1. **Malformed-but-technically-successful** — a `FontFace` whose `.load()`
   resolves but whose construction throws first, and a text file whose
   `.slice()`/`.text()` read throws, both fall back to the glyph/name-card
   display rather than crashing or hanging.
2. **Racing async operations** — a font `.load()` that resolves *after* the
   `files` prop changed away from the file it was loading for is asserted to
   never call `document.fonts.add` (the effect's `cancelled` flag closes
   this race).
3. **Rejected promise with no handler** — a `.load()` rejection is asserted
   to be swallowed into the glyph fallback, not an unhandled rejection.
4. **Stale state after retry** — not applicable to this feature (no retry
   concept; files are re-staged fresh each time, not retried) — noted
   explicitly per the gate's own "a cluster with no such surface is exempt,
   say so" instruction rather than skipped silently.

### Test/typecheck/coverage results

- `pnpm --filter @jini/ui typecheck`: green (zero errors) — required the
  same `exactOptionalPropertyTypes` discipline as every prior section
  (optional prop/param types spelled `X | undefined`, not just `?:`), plus
  one `renderHook` generic-inference gotcha in a test file (an explicit
  callback-parameter type annotation didn't propagate into `initialProps`'s
  inferred type under `exactOptionalPropertyTypes`; fixed by casting the
  `initialProps` value to the exact optional-inclusive type instead of
  relying on inference).
- `pnpm --filter @jini/ui exec vitest run src/features/file-dropzone`:
  **144 tests across 9 files, all green** — `rules` (24), `useFileDialogTracking`
  (15), `useFileDropzonePreviews` (18), `useFileDropzone` (19),
  `FileDropzoneThumbnailGrid` (16), `FileDropzoneLightbox` (18),
  `FileDropzoneNameList` (5), `FileDropzone` (28, the full orchestrator —
  every variant combination, drag/drop, click, paste, the processing
  heuristic, and i18n end-to-end), and `index` (1, the barrel-completeness
  smoke test this package's convention requires). Every hook has a mounted
  test (`renderHook` for the two hook-only files, a small harness component
  rendering a real `<input>`/drop target for `useFileDropzone` since its
  contract is DOM-ref-shaped, not port-shaped); every component has a
  `@testing-library/react` mount test and a real-DOM-event interaction test
  (native `drop`/`dragenter`/`change`/`keydown` events via `fireEvent`, not
  just calling handlers directly).
- **Coverage (v8, `json-summary`/`json` reporters): 100% on all 4 metrics —
  statements, branches, functions, lines — both aggregate and every
  individual file in `features/file-dropzone/`**, clearing the
  ≥99%-with-100%-as-the-goal bar with no `/* v8 ignore */` anywhere. The
  classify-then-fix loop found: several genuinely-reachable branches that
  just needed a test (the file-dialog focus-delay-vs-warmup race, the
  stale-timeout safety net, a null `input.files`, the `requestAnimationFrame`-
  unavailable fallback path, every preview-kind's fallback arm); one real
  dead branch in `useFileDropzone.ts` (`stageFiles`' own empty-array guard —
  every caller already guarantees a non-empty selection before reaching it),
  refactored away rather than tested around; and one TS-required-but-
  unreachable branch (`inputRef.current` null-check inside a post-mount
  effect, where the consumer always renders the ref'd `<input>`
  unconditionally), replaced with a non-null assertion plus an explaining
  comment, per Phase 9.5's own classification rules.
- Promoted-file regression check: `features/asset-tree-browser/` (whose
  `rules.ts` and `useAssetTreeDragUpload.ts` now re-export from the new
  shared locations) stays at **100% on all 4 metrics**, unchanged from
  before this task — its own tests now exercise the promoted
  `utils/file-transfer.ts`/`browser/useFileDropTarget.ts` implementations
  directly, with no new test file needed for either promoted module.
- Full package run (`pnpm --filter @jini/ui exec vitest run --coverage`):
  **237 test files, 2490 tests, all green**. Package-wide aggregate sits at
  96.06%/94.42%/95.04%/96.06% (statements/branches/functions/lines) — this
  is **pre-existing debt in files this task never touched** (e.g.
  `utils/notifications.ts` at 67%, several `src/components/*.tsx` atoms with
  no tests at all), not a regression introduced here; every file this task
  authored, edited, or promoted is at 100%, which is the bar this project's
  Phase 9.5 method targets per-file, not a blanket whole-package retrofit
  this task was never scoped to perform.
- Purity grep (`grep -rniE 'open design|OD_|--od-stamp|/tmp/open-design'`)
  across every file this task touched: **clean, zero matches in actual
  code** — three literal `Open Design` mentions were caught in doc comments
  during self-review and reworded to `OD`, matching this package's
  established convention (see the `features/memory/` section above for the
  same self-correction). No OD-branded package-internal folder/type/
  component name anywhere (see "De-branding" above).
- `pnpm guard` (repo root): `[guard] ok (skeleton — rules pending
  implementation during extraction)` — unchanged, no boundary violations
  introduced.
---

## Section: `html-viewer` — classification of `HtmlViewer` + `FileVersionManagerModal` (2026-07-18)

**Preflight.** Source: the real OD fork cloned fresh for this task at
`/tmp/od-source` (NOT the frozen `foundry/integrations/open-design/reference/`
snapshot), commit `0b88ef56144b5a42dc427c1292ae22676d698a34`
(2026-07-02), file `apps/web/src/components/FileViewer.tsx`, **12,652
lines in this checkout** — differs from the 14,275/14,495-line figures
cited elsewhere in this repo's docs; those figures describe a different
point in the file's history, not this session's ground truth. Per
`foundry/docs/jini-port/god-components-extraction-plan.md`'s Consolidation map,
this file is filed under "B. Own feature," `features/viewer-shell/`
✅ done, with `HtmlViewer`/`FileVersionManagerModal` filed under "D.
Confirmed OD-specific — do not attempt." This task's brief explicitly
asked for independent re-verification of that filing rather than trusting
it — the method below is a full read of both components against the real
current source, done by two independent deep-read passes (not sampled,
not extrapolated), specifically checking the "plausible generic
candidates" a partial read had flagged earlier the same night.

**Correction to `foundry/docs/jini-port/recon/r6-god-component-internals.md` §1.1's
line counts**, found by both passes independently: `HtmlViewer` is
**6,076 real lines** (5248–11323), not ~7,110; `FileVersionManagerModal` is
**583 real lines** (2549–3131, plus 40 lines of directly-adjacent
single-use helpers), not ~1,050. Neither correction changes which verdict
is more defensible below, but both are recorded since r6 is cited
elsewhere in this repo as a line-count source.

### `FileVersionManagerModal` — verdict reversed: genuinely separable, **shipped this session**

r6 and the viewer-shell extraction's own source-map both filed this as
"OD-specific... saturated with OD analytics/deploy/export calls." A full
read (every line, every co-located helper) found **zero** analytics,
deploy, or export calls anywhere in the component — a full-text scan for
`analytics|track|telemetry|deploy|Deploy|export|Export` returns one
incidental code comment and nothing else. The "export" action inside the
modal is `openVersionInNewTab()` — opening a version in a new sandboxed
tab, not a file-export pipeline; PPTX/image/deploy exports live in
sibling modals elsewhere in `FileViewer.tsx`, not inside this component.
r6's characterization does not hold up.

What the modal actually is: a **list + cached-iframe-preview + restore +
search + view-generating-prompt modal shell**, parameterized over a
version-record shape. 14 `useState`/8 `useEffect`/2 `useCallback`/4
`useMemo`/5 `useRef` — overwhelmingly generic UI-interaction plumbing
(loading flags, selection state, two independent dismissable popovers,
search text, a viewport toggle, and a well-engineered content
cache/prefetch/stale-overlay pipeline). Exactly four OD-coupled seams, all
at clean call-boundary edges, not interleaved through the render body:

| Concern | Lines | Verdict | What's generic vs. OD-specific |
|---|---|---|---|
| Version list fetch + render (skeleton/empty/list, a11y listbox roles) | 2564, 2678–2706, 2879–2947 | MIXED, clean seam | List/sort/render logic generic; `fetchProjectFileVersions(projectId, file.name)` is the one OD REST call — becomes an injected `listVersions(fileRef)` port |
| Cached version-content preview (iframe) | 2586–2653, 2660–2750, 2752–2758, 3095–3110 | MIXED, generic core is most of it | The `Map`-based content cache, in-flight dedupe, hover/focus prefetch, and "keep stale content mounted under an overlay instead of blanking" UX are 100% generic and are the best-engineered part of the file. `fetchProjectFileVersion(projectId, file.name, versionId)` is the one fetch seam; `fileVersionPreviewOptions()`'s `sourceLooksLikeExportableDeck`/`projectRawUrl` calls are the other — both become one injected `getVersionContent`/`resolvePreviewOptions` pair |
| Restore action | 2578–2580, 2814–2837, 3009–3058 | MIXED, thin OD shell | Confirm-popover UX (outside-click/Escape dismiss) generic; `restoreProjectFileVersion` REST call + `PROJECT_FILE_VERSION_CAPTURE_FAILED` warning code are OD-specific — injected `restoreVersion(fileRef, versionId)` port. Parent-supplied `onRestored` callback is already injected in the original |
| Search/filter | 2606–2627, 2857–2878 | GENERIC | Pure client-side substring filter over already-fetched fields; zero network calls |
| Generating-prompt viewer | 2575–2577, 2966–3005 | MIXED, trivial | Popover + copy-to-clipboard mechanics generic; the one field displayed (`version.prompt`) is just a nullable string on the injected version type, not a service call |
| Modal chrome | 2760–2775, 2839–2852 | GENERIC | Portal + backdrop + `role="dialog"`/`aria-modal` + layered Escape-dismiss (closes nested popovers before the modal itself) — the exact `modal-backdrop viewer-modal-backdrop` shell OD's own code already reuses for 4 other unrelated export/deploy modals in the same file, i.e. already treated as generic infrastructure by the source itself |
| `FileVersionViewportControls` | 755–787 | GENERIC, redundant | A `role="group"` toggle-button viewport switcher, structurally identical to `ViewportToggleGroup` already shipped in `features/viewer-shell/` — do not re-port, bind to the existing component instead |

**Overlap with `HtmlViewer`'s iframe rendering**: confirmed **reuse, not
duplication** — both components call the same shared `buildSrcdoc()`
(`runtime/srcdoc.ts`) and `openSandboxedPreviewInNewTab()`
(`runtime/exports.ts`) functions in the real source; the version modal
uses a narrow read-only options subset (`deck`, `baseHref`,
`previewFocusGuard`) of what `HtmlViewer` exercises. This means a real
`@jini/renderers-react` sandboxed-iframe core, once built (see the
`HtmlViewer` section below), should be designed to serve both a
version-preview consumer and an eventual `HtmlViewer`-equivalent consumer
from one primitive — but the version-manager shell **does not need that
core to exist first**: it can ship today with a plain, host-supplied
`resolveVersionPreviewHtml(fileRef, content) → string` port that a host
implements however it likes (including by calling its own `buildSrcdoc`
equivalent), no dependency on the deferred `HtmlViewer` work below.

**Decision: port this as `packages/ui/src/features/version-manager/`.**
Named for what it actually is (a generic version-history shell), not
folded into a literally-named `html-viewer` folder, since it has no
dependency on HTML-specific rendering — a host could use it for any
versioned-artifact type. See "What shipped" below for the actual slice.

### `HtmlViewer` — r6's "irreducibly OD-specific" verdict holds structurally; several individual generic *logic* shapes exist inside it but require new infrastructure to port safely, not a slice

A full read (6,076 lines, every `useState`/`useEffect` traced) confirms
r6's bottom line for the component **as a single unit**: it cannot be
sliced feature-by-feature in place, because nearly every feature inside it
(manual-edit, board/pod annotation, inspect mode, deck present) is wired
into one shared state machine that decides which of three iframe-loading
transports (`useUrlLoadPreview` / `useLazySrcDocTransport` / direct-mount
`srcDoc`) is currently active, gated on a combination of every other
feature's own mode flags (`manualEditMode`, `boardMode`, `drawOverlayOpen`,
`inspectMode`, plus content-sniffing heuristics and a URL escape hatch).
Extracting any one annotation mode by pulling its code out of `HtmlViewer`
in place would drag this coupling along with it. This is corroborated
independently a third time (after r6 and the viewer-shell extraction's own
scope note) — but the read also found the "nothing generic here" framing
understates how much reusable *logic* (not code-as-written) is embedded,
consistent with this whole sweep's repeated finding elsewhere that a full
read surfaces more than an aggregate/summary pass expects.

**Per-concern classification** (task-brief item → what was actually
found; "Present in prior partial read" column flags where tonight's
earlier partial read was corrected):

| Concern | Lines | Verdict | Disposition | Notes |
|---|---|---|---|---|
| Sandboxed iframe rendering + postMessage bridge | 5615–5666, 6216–6520, listeners across 6518–7108 | MIXED — core is portable, transport-selection state machine is not | **Deferred**, blocking | 31+ message types across 3 overlapping naming conventions (`od:*`, `od-edit-*`, legacy `__dc_*`) on one `addEventListener`; a real port needs one normalized protocol, designed fresh, not lifted verbatim. This is the coupling root for everything below |
| Deck/slide navigation + zoom + present (fullscreen) | 6072–6075, 6159–6169, 6608–6628, 7685–7696, ~8300–8320 | GENERIC (core logic), low coupling to other features besides the shared `iframeRef` | **Deferred**, needs the bridge core above | Zero OD types in the postMessage payloads or `requestFullscreen()` calls. Does **not** overlap `ViewportSwitcher` (that's a breakpoint preset switcher; this is a numeric zoom% + slide pager) — would be a new small feature once a bridge exists |
| Inline visual/DOM editor (manual edit) + undo/redo + page-styles panel | 5596–5612, 5779–5802, 7000–7641, `ManualEditPanel.tsx` (sibling file) | MIXED, cleanest split of the file | **Deferred**, needs the bridge core above | The patch/history/undo-redo model (`ManualEditPatch` union, linear undo/redo stack, debounced live-style preview, text-edit session handshake) and `ManualEditPanel`'s prop contract are genuinely clean and OD-type-free; only the persistence calls (`writeProjectTextFileDetailed`, `uploadProjectFiles`) are OD-specific. Shares a cross-cutting source-freeze mechanism with board/inspect mode (`annotationFreezeActive`) — another coupling point, not free-standing |
| Comment-pinning to rendered elements + "board"/"pod" annotation | 5816–5951, 6802–6989, `CommentPreviewOverlays`/pod-geometry helpers (sibling, lines 4362–4831) | **Two different shapes** — see below | Split disposition | (a) side-list half: **already shipped**, confirmed exact prop-shape match with `CommentSideDock`/`CommentSidePanel` in `features/viewer-shell/` — no new work. (b) DOM-pinned overlay + "pod" lasso: needs the bridge core (deferred) for the overlay itself, but its pure geometry helpers are portable today with zero dependency — **shipped this session**, see below. Correction: "pod" is **not** multi-user collaboration/presence (grepped for presence/multiplayer/collaborat* — zero hits) — it's a single-user freehand-lasso multi-element selector. The task brief's "board/pod live-collaboration system" framing was inaccurate; relabeled here |
| Cloudflare deploy flow | 5547–5572, 5953–6067, 8056–8300 | MIXED, broader than "Cloudflare-specific" | **Deferred**, not blocked on the bridge core, but out of scope this session | Confirmed a real two-provider abstraction (Cloudflare + Vercel) with provider-specific branching leaked through 5 functions and the render, rather than isolated behind a sub-component. `packages/deploy` already exists with a `DeployTarget` port for exactly this; the natural extraction is a generic deploy-modal shell over that existing port, not new infrastructure — a real future candidate, just not this session's scope |
| Export menu (PDF/PPTX/image/zip/html/md/template) | 5301–5427, 8745–9017, 7957–8054 | MIXED | **Deferred**, out of scope this session | `fireShareExport`'s progress-toast/correlation-tracking wrapper and the export-menu shell are genuinely OD-type-free and reusable; every concrete exporter is deep OD/desktop-host infrastructure (dual desktop/web paths, CJK-fidelity workarounds) that stays behind an injected `ExportProvider` port a host supplies |
| Public share links | 8261–8299, ~9139, ~9985 | OD-SPECIFIC, thin | **Not a separate concern** | A small tail of the deploy flow (derive a URL from an existing deployment, copy it) — not worth scoping independently; folds into the deploy-modal item above if that's ever picked up |
| Speaker notes for deck mode | — | **Does not exist** | N/A — correction | Grepped the full component for "speaker"/"notes" (case-insensitive): zero matches related to presenter notes. The earlier partial read's inclusion of this item was inaccurate; dropped from scope entirely rather than carried forward as a phantom candidate |
| Brand-extraction-stop hook | 5638–5650 | GENERIC, trivial | **Deferred**, rides with the bridge core | 6-line pass-through `useEffect` forwarding one message type to an already-injected callback prop — not worth scoping as its own unit |
| Analytics tracking | 5301–5512 + ~14 inline call sites | OD-SPECIFIC, pervasive but shallow | **Not a separate concern** | Cross-cutting decorator around nearly every handler, not an extractable feature — a real port would inject a no-op-by-default `onTrack?()` callback rather than "extracting analytics" |
| `InspectPanel` (CSS-override panel, sibling component adjacent to `HtmlViewer`) | 3706–4156 | GENERIC | **Deferred**, needs the bridge core (its target-selection comes from the same postMessage surface) | Clean `onApply`/`onResetElement`/`onSaveToSource` prop contract, no OD identifiers found in the component itself |
| `FileVersionManagerModal`'s call surface from inside `HtmlViewer` | ~8300, `versionModalOpen` state 5530 | — | See the section above | `HtmlViewer` only gates and mounts the modal; the modal itself is now classified and shipped separately above |

**Hook-count corroboration of the coupling claim**: 108 `useState`, 57
`useEffect`, 46 `useRef` in one function — not itself dispositive, but
consistent with the transport-state-machine finding rather than
contradicting it.

**Open question for Coordinator/Software-Architect sign-off (not resolved
by this task):** every deferred item above except the deploy flow and
export menu is blocked on the same missing prerequisite — a real,
deliberately-simpler sandboxed-iframe + single normalized-protocol
message-bus core in `@jini/renderers-react` (currently an empty stub: just
`package.json` + a placeholder `index.ts`, confirmed no existing srcDoc
core to build on or duplicate). Both deep-read passes independently
concluded this is **a rewrite, not an extraction**: the generic logic
shapes above (deck-nav, manual-edit model, `InspectPanel`, DOM-pinned
comment overlay) are real and worth having, but porting them by slicing
`HtmlViewer`'s current code in place would import its 31-message-type,
3-naming-convention, state-machine-coupled bridge along with them. Building
that core is a separate, materially larger design task than a standard
god-component port — it needs its own scoping session and explicit
sign-off before dispatch, not a default follow-on to this one. This task
does not decide that question; it surfaces it.

### What shipped this session

1. **`packages/ui/src/features/version-manager/`** — the
   `FileVersionManagerModal` generic slice (list/preview/restore/search/
   prompt-viewer/modal-chrome), per the table above. See its own
   "What shipped" subsection below for exact files.
2. **Pod-selection geometry as a standalone utility**, not a `features/`
   folder — the polygon/lasso-hit-test math (`isClosedLoop`,
   `pointInPolygon`, `lineIntersectsLine`, `rectContains`,
   `pathIntersectsRect`) has zero React/OD/framework dependency and no
   current consumer in this package (the DOM-pinned overlay that would
   consume it is deferred with the rest of `HtmlViewer`'s bridge-dependent
   pieces) — matches this package's existing bucket-A precedent
   (`src/utils/dom-subscriptions.ts`, `visual-stability.ts`: pure/small
   helpers shipped ahead of a feature consumer when they're genuinely
   zero-dependency). Shipped as `src/utils/polygon-selection.ts`.

### What's explicitly deferred, not silently dropped

Everything in the `HtmlViewer` table marked "Deferred" above: the
sandboxed-iframe/message-bus core itself, deck-nav+zoom+present,
the manual-edit patch/undo-redo model + `ManualEditPanel`, the DOM-pinned
comment overlay (its geometry helpers shipped, its consuming overlay did
not), `InspectPanel`, the deploy-modal shell, and the export-menu shell.
Each has a real, defensible generic shape per the table — none of these
are "confirmed nothing there," they're "confirmed real, blocked on
infrastructure or scope, not attempted this session."

### What shipped — `packages/ui/src/features/version-manager/`

| File | Contents |
|---|---|
| `types.ts` | `VersionSource`, `VersionRecord` (generic version-record shape), `VersionManagerFileRef` (opaque `scopeId` + `name` — deliberately not `ViewerFileRef`, see the file's own doc comment for why), `VersionRestoreWarning`/`VersionRestoreResult`, `PreviewCanvasSize`. |
| `constants.ts` | `SEARCH_VISIBLE_THRESHOLD`, `PROMPT_COPY_FEEDBACK_RESET_MS`, `PREVIEW_LOAD_FALLBACK_MS`, `DEFAULT_PREVIEW_CANVAS_PADDING`. |
| `rules.ts` | List/select/search/restore-eligibility pure logic ported 1:1 from the source (`formatVersionDateTime`, `versionSourceLabel`/`versionSourceClassName`, `sortVersionsDescending`, `buildVersionIndex`, `restoredFromVersion`, `resolveSelectedVersion`, `shouldShowVersionSearch`, `filterVersionsBySearch`, `isRestoreDisabled`, `contentMatchesSelection`), plus the viewport-scaling math ported from the source's `effectivePreviewScale`/`previewViewportStyle`/`previewScaleShellStyle` — generalized off the source's hardcoded `viewport === 'desktop'` string check to `preset.width === null` ("no fixed frame"), matching `viewer-shell`'s own `ViewportPreset` convention, and parameterized over any `ViewportPreset[]` rather than the source's fixed 3-preset array. |
| `ports.ts` / `dependencies.ts` | `VersionManagerPort` (`listVersions`/`fetchVersionContent`/`restoreVersion`/`resolvePreviewDocument`/optional `openPreviewInNewTab`) + `VersionManagerClipboardPort`. `createFakeVersionManagerPort` ships an in-memory test/demo double (per the connectors-canary precedent); `createBrowserVersionManagerClipboard` reuses `features/viewer-shell/`'s real browser clipboard implementation rather than re-deriving one. `resolvePreviewDocument` is deliberately NOT a sandboxed-iframe builder — see "What's deferred" below. |
| `react/hooks/usePreviewCanvasSize.ts` | Ported the source's `usePreviewCanvasSize` `ResizeObserver` measurement hook verbatim in spirit; dropped its `typeof window === 'undefined'` guard as genuinely dead code (a `useEffect` body never runs during SSR) rather than leaving it untested. |
| `react/hooks/useVersionManager.ts` | The single cohesive controller hook (list fetch, selection, content cache/prefetch, search, restore, viewport) — one hook per this package's Phase 6 "one natural owning cluster" discipline, matching `features/connectors/`'s `useConnectorAuthorization` precedent. `useWiredVersionManager` binds the module-level default-dependencies singleton. |
| `react/components/VersionSidebar.tsx`, `VersionPromptPopover.tsx`, `VersionRestoreControl.tsx`, `VersionPreviewFrame.tsx` | Dumb/presentational pieces, each with its own small local disclosure state (popover open/close) per Phase 6's "small local UI state is acceptable" allowance; the two popovers reuse `browser/useDismissOnOutsideOrEscape` instead of hand-rolling outside-click/Escape listeners. |
| `react/components/VersionManagerModal.tsx` | The orchestrator — portal + backdrop + dialog chrome, composes the controller hook + the four dumb components, reuses `features/viewer-shell/`'s `useCopyToClipboard`/`ViewportToggleGroup` rather than re-deriving either. |
| `index.ts` | Public barrel. |

### A real behavior gap found and fixed during porting (not present in the shipped code)

While building `useVersionManager`, drafting a test for the source's "restore succeeds with a warning" path surfaced a genuine race: the source's `restoreVersion()` reloads the version list on a warning (which changes the selected version), and the list-driven content-load effect unconditionally calls `setError(null)` on every selection change — including the one the reload itself just caused — clobbering the warning message that was set immediately after. This appears to be a latent bug in the source's own code (same structure, same conflated `error` state for both "list/content load failed" and "restore succeeded with a caveat"), not something this port introduced. Fixed here via a one-shot `preserveErrorOnNextSelectionRef` flag set only by the warning path and consumed once by the content-load effect — the warning message now survives the reload. Also: cache-seeds the just-restored content under its new version id before reloading, both fixing the race at its root (the reload's selection change becomes a cache HIT, which was always going to run through `setError(null)` too, so the flag guards that path specifically) and avoiding a pointless refetch of content the hook already has in hand.

### What's deferred, and why

Per the `html-viewer` classification above: the sandboxed-iframe/postMessage-bridge core this feature's `resolvePreviewDocument` port is designed to eventually delegate to (`@jini/renderers-react`, currently a stub) does not exist yet. This feature does **not** wait on it — a host without a real sandbox core can implement `resolvePreviewDocument` as an identity function for a plain, unsandboxed preview, or delegate to whatever iframe-rendering mechanism it already has. `FileVersionViewportControls` was not re-ported; the orchestrator binds directly to `features/viewer-shell/`'s already-shipped `ViewportToggleGroup` (confirmed identical `role="group"`/`aria-pressed` shape by reading both source components side by side) rather than shipping a second, competing viewport-toggle primitive.

### `src/utils/polygon-selection.ts` — what shipped

Ported the pod-selection lasso-hit-test geometry (`isClosedLoop`, `rectContains`, `lineIntersectsLine`, `pointInPolygon`, `pathIntersectsRect`, and a new composed `lassoSelectionHitsRect` generalizing the source's `selectionHitsSnapshot`) as a standalone `src/utils/` primitive, per the `html-viewer` classification's disposition for this piece — zero dependency on the deferred sandboxed-iframe core, no current consumer in this package (the DOM-pinned overlay that would consume it stays deferred with the rest of `HtmlViewer`'s bridge-dependent pieces), matching this package's existing precedent for shipping small, proven-zero-dependency helpers ahead of their eventual feature consumer.

### i18n

Every user-facing string in every `react/components/` file routes through `useT()`, English string as key, per this package's convention. `rules.ts` stays hook-free; `versionSourceLabel()` returns a plain-English label the orchestrator wraps in `t()` at the call site, matching `features/connectors/`'s `statusLabel()` pattern. Verified end-to-end, not just compiled: `VersionSidebar.test.tsx`, `VersionPromptPopover.test.tsx`, `VersionRestoreControl.test.tsx`, `VersionPreviewFrame.test.tsx`, and `VersionManagerModal.test.tsx` each mount under `I18nProvider` with a translated (French) dictionary and assert the translated text actually renders, covering every component's string paths, not just a happy-path smoke case.

### Purity grep

`grep -rn "Open Design\|OD_\|--od-stamp\|/tmp/open-design"` across every new file under `features/version-manager/` and `utils/polygon-selection.ts`: **clean, zero matches.** A stricter self-imposed case-insensitive pass for `od-`/`open-design.ai`/`openDesignDesktop`/`@open-design/`/the vendored-path substrings only turns up prose doc comments describing provenance ("a vendored OD file-viewer god-component") — the same accepted "OD" shorthand convention already used in shipped doc comments elsewhere in this package (e.g. `features/connectors/constants.ts`), not a literal product-identity string, class name, or storage key.

### Test / typecheck / guard results

- `pnpm --filter @jini/ui run typecheck`: clean (zero errors), full package.
- New feature's own test run (`npx vitest run src/features/version-manager src/utils/polygon-selection.test.ts`): **161 tests, 11 files, all green.**
- Per-file coverage for every new/touched file (`rules.ts`, `dependencies.ts`, `ports.ts`, `types.ts`, `index.ts`, both hooks, all 5 components, `utils/polygon-selection.ts`): **100% on all 4 metrics (statements/branches/functions/lines)** — reached via the Phase 9.5 classify-then-fix loop, not padding: one genuinely dead branch was found and refactored away in each of `usePreviewCanvasSize.ts` (an SSR guard inside a `useEffect`, which never runs server-side) and `utils/polygon-selection.ts` (a divide-by-zero guard the surrounding `&&` already makes unreachable) and documented inline; every other gap was a real reachable path that got a real test. Zero `/* v8 ignore */` or any coverage-suppression comment anywhere in this task's new files.
- `pnpm guard` (repo root): `[guard] ok (skeleton — rules pending implementation during extraction)` — unchanged, no boundary violations introduced.
- **Full monorepo `pnpm -r run typecheck`**: same two pre-existing, unrelated failures every prior section in this file has already documented (`@jini/agent-runtime`/`@jini/chat-react` missing `tsconfig.json`).

### Full `@jini/ui` package coverage aggregate — reported honestly, not just this task's files

Per this task's explicit instruction to report the real full-package number, not just per-file numbers for what was touched: `npx vitest run --coverage` (whole package, 151 test files, 1370 tests, **all green**) gives an aggregate of **93.19% statements / 91.07% branches / 92.60% functions / 93.19% lines** — well below the ≥99% bar the skill file requires, and this is **not** attributable to this task's own files (every file this task added or touched is 100% on all 4 metrics, confirmed above). The gap is entirely pre-existing debt in features and utilities shipped by earlier sessions, spanning a wide swath of the package: `src/react/components/` (`Icon.tsx` 41%, `TooltipLayer.tsx` 73%, `CustomSelect.tsx` 79%, `AppChromeHeader.tsx` 50% branches, several others), `src/features/connectors/` (several files 60-90% branches/functions despite that feature's own source-map section above reporting "144/145 tests, all green" with no coverage percentage claimed), `src/features/observability/` (most files 60-88%), `src/features/i18n/context.tsx` (83% functions), `src/utils/notifications.ts` (67%), `src/utils/visual-stability.ts` (33% branches), and several more (full list available via `coverage/coverage-summary.json`, not reproduced here). This directly corroborates the exact failure pattern the `port-refactor-audit-canary` findings warned about for a sibling task ("real full-package coverage was 93-94%, not the 100% its own commit messages claimed") — except here it traces to debt already present before this task started, not a false claim made by this task. Fixing it is a real, separate, package-wide undertaking (dozens of files, none owned by this task's scope) and was not attempted here; flagged explicitly rather than left as a silent gap in this record.

---

## Section: `features/html-viewer/` — deck navigation + zoom + present (2026-07-18)

Scope: the next slice of `HtmlViewer` after the `html-viewer` classification
section above — that task ended with the sandboxed-iframe/message-bus core
flagged as "a rewrite, not an extraction," needing its own scoping before
any of `HtmlViewer`'s deferred GENERIC pieces (deck navigation, manual
edit, comment pinning, `InspectPanel`) could actually ship. This task
builds that core (`@jini/renderers-react`, see its own `source-map.md`)
and, as the classification's own recommended staging suggested ("sandboxed
rendering + postMessage bridge first, then deck/slide navigation, then the
inline visual editor, then comment-pinning"), the deck/slide-navigation +
zoom + present row — the classification's lowest-coupling deferred item
once the bridge exists.

### Re-verification against the real source before building

Re-read the classification's cited line ranges directly against the real
OD fork (same commit, `0b88ef56144b5a42dc427c1292ae22676d698a34`) rather
than trusting the summary: `SlideState = { active, count }` cached in a
module-level `Map` keyed per preview, `od:slide`/`od:slide-state`
postMessage protocol (host sends `action: next|prev|first|last|go` +
optional `index`; iframe replies with the new `{active, count}`); a
`zoom` percentage (`useState(100)`) with a `[50, 75, 100, 125, 150, 200]`
preset dropdown (`previewScale = zoom / 100`); three present actions
(`presentInThisTab` — mode switch + local "in-tab present" flag,
`presentFullscreen` — `element.requestFullscreen()` with a fallback to
in-tab present, `presentNewTab` — reuses the same new-tab-preview
mechanism `@jini/renderers-react` now ships). Confirmed zero OD types in
any of these — matches the classification's verdict.

### What shipped — `packages/ui/src/features/html-viewer/`

| File | Contents |
|---|---|
| `types.ts` | `DeckSlideState`, `DeckNavigateAction`. Zero runtime declarations — excluded from coverage per the established carve-out (see `vitest.config.ts`). |
| `constants.ts` | A **fresh** `jini:deck-navigate`/`jini:deck-state` postMessage protocol — deliberately not a rename of OD's `od:slide`/`od:slide-state`, per the classification's own finding that the real bridge needs a redesign, not a rename. `DEFAULT_ZOOM_LEVELS`/`DEFAULT_ZOOM` (verbatim preset values from the source). |
| `rules.ts` | `canGoPrev`/`canGoNext`/`slideCounterLabel`/`clampSlideIndex` (pure deck-state derivations); `parseDeckStateMessage` — validates an inbound `postMessage` payload (finite, non-negative, in-range `active`/`count`) since that data crosses a trust boundary from sandboxed content; `isKnownZoomLevel`/`zoomToScale`. |
| `ports.ts` / `dependencies.ts` | `FullscreenPort` (`requestFullscreen`/`exitFullscreen`/`fullscreenElement`/`subscribeFullscreenChange`) and `NewTabPreviewPort` — the two real browser APIs this slice needs, following `features/viewer-shell`'s clipboard-port precedent. `createBrowserNewTabPreviewPort` delegates straight to `@jini/renderers-react`'s `openSandboxedPreviewInNewTab` — this feature is that package's first `@jini/ui` consumer. Zero runtime declarations in `ports.ts` itself (interfaces only) — same carve-out as `types.ts`. |
| `react/hooks/useDeckNavigation.ts` | Wraps `@jini/renderers-react`'s `useSandboxBridge`, speaking the `jini:deck-*` protocol; tracks `DeckSlideState` and exposes `goNext`/`goPrev`/`goFirst`/`goLast`/`goTo`. No port/`useWired` variant needed — it talks directly to the generic, already-real `useSandboxBridge`, not a host-specific transport. |
| `react/hooks/useZoomControl.ts` | Pure client-side zoom-percentage + menu-open state, no host dependency (matches `usePreviewCanvasSize`'s no-port precedent in `features/version-manager/` for a hook with nothing to inject). |
| `react/hooks/usePresentMode.ts` + `useWiredPresentMode` | Binds `FullscreenPort`/`NewTabPreviewPort`; tracks `isFullscreen` via the browser's own `fullscreenchange` event (so an Escape-driven exit is reflected, not just a call this hook itself made). |
| `react/components/DeckNavigationControls.tsx` | Prev/next + counter, renders nothing until the sandboxed content reports its first state. |
| `react/components/ZoomMenu.tsx` | Percentage trigger + preset dropdown; outside-click/Escape dismiss is local, reusing `browser/useDismissOnOutsideOrEscape` exactly like `features/version-manager/`'s `VersionPromptPopover`. |
| `react/components/PresentMenu.tsx` | The three present actions as a disclosure menu, same local-dismiss shape as `ZoomMenu`. `onPresentInline` is a bare callback prop — "present in this tab" is host layout state (which panel is showing), not a browser API this package should own. |
| `index.ts` | Public barrel; also added to the package-root `src/index.ts` barrel (`export * from './features/html-viewer/index.js'`). |

### Pre-existing barrel-completeness gap found and fixed in passing

While adding this feature to `src/index.test.ts`'s tracked-modules map (the
barrel-completeness smoke test — see its own doc comment for the bug class
it guards against: a feature shipped, individually tested, and
100%-coverage-verified, but never re-exported from the package's public
barrel), found `features/version-manager` was **already** missing from
that map since the session that shipped it — a real instance of the exact
gap the test exists to catch, just never added to the test's own tracking
list. Added both `version-manager` and `html-viewer` to the map in this
task; both pass (no missing exports).

### i18n

Every user-facing string in `DeckNavigationControls`/`ZoomMenu`/`PresentMenu`
routes through `useT()`. Verified end-to-end: each component has a test
mounting under `I18nProvider` with a translated (French) dictionary and
asserting the translated text actually renders (button labels, `aria-label`s,
and the `role="group"` accessible name), not just a happy-path smoke case.

### A real cross-environment coverage-merge gap found and worked around

Drafting `dependencies.ts`'s tests initially split them the way this
package's own documented convention prescribes for an SSR guard: a jsdom
test file for the "browser present" cases plus a separate
`// @vitest-environment node` companion for the "no `document` at all"
case. Coverage on the merged report showed that one guard's branch
(`typeof document === 'undefined'` in `exitFullscreen`) as **uncovered**
even though the node companion file, run alone, proved it covered — a real
`@vitest/coverage-v8` limitation merging branch-hit counts for one source
file instrumented under two different test environments in the same
`vitest run`. Fixed by moving every `createBrowserFullscreenPort` test
into a single `// @vitest-environment node` file, using a hand-built fake
`document` (a real `EventTarget` plus the two Fullscreen-API members this
port reads) for the "document present" cases instead of jsdom's real
global — eliminating the environment split (and the merge gap with it)
rather than leaving a genuinely-tested branch looking uncovered in the
aggregate. Worth flagging for any future task in this package relying on
the jsdom-file-plus-node-companion pattern for an SSR guard: verify the
*merged* per-file coverage, not just the companion file's own isolated
number, before trusting it clears the bar.

### Purity grep

`grep -rn "Open Design\|OD_\|--od-stamp\|/tmp/open-design\|open-design\.ai\|openDesignDesktop\|@open-design/"` across every new file under `features/html-viewer/`: **clean, zero matches.** The stricter case-insensitive `od-`-prefix pass is also clean.

### Test / typecheck / guard results

- `pnpm --filter @jini/ui run typecheck`: clean, zero errors, full package.
- New feature's own test run (`npx vitest run src/features/html-viewer`): **71 tests, 9 files, all green.**
- Per-file coverage for every new file (`constants.ts`, `dependencies.ts`, `rules.ts`, `index.ts`, all 3 hooks, all 3 components): **100% on all 4 metrics**, `types.ts`/`ports.ts` excluded per the documented zero-executable-statement carve-out (both re-verified via the standard grep). Reached via the Phase 9.5 classify-then-fix loop — every gap found was a real reachable path (an untested `PresentMenu` action, an untested `injectBeforeHeadEnd`-style branch in the sibling `@jini/renderers-react` package) that got a real test, not a suppression comment; zero `/* v8 ignore */` anywhere in this task's new files.
- **Full `@jini/ui` package** (`npx vitest run --coverage`, whole package): **160 test files, 1441 tests, all green**, aggregate **93.35% statements / 91.28% branches / 92.88% functions / 93.35% lines** — a small improvement over the prior section's 93.19/91.07/92.60/93.19 (this task's own files are 100%; the rest is the same pre-existing debt that section already catalogued in detail, not re-itemized here).
- `pnpm guard` (repo root): `[guard] ok (skeleton — rules pending implementation during extraction)` — unchanged, no boundary violations introduced.

### What's still deferred (unchanged from the classification section above)

The sandboxed-iframe/message-bus core's remaining consumers: the inline
visual/DOM editor (manual edit + undo/redo + page-styles panel), the
DOM-pinned comment overlay (its geometry helpers already shipped as
`utils/polygon-selection.ts`; the overlay itself has not), `InspectPanel`,
the deploy-modal shell, and the export-menu shell. Each still has the same
real, defensible generic shape the classification described — none

## Section: `react/components/EditorIcon.tsx` — flat atom (2026-07-18)

Source: `apps/web/src/components/EditorIcon.tsx` (168 lines, real clone at
`leonaburime-ucla/open-design` commit `0b88ef56144b5a42dc427c1292ae22676d698a34`),
per `foundry/docs/jini-port/god-components-extraction-plan.md`'s "5 more overlaps"
list ("Icon-by-key renderer, twice") and this task's own brief. That doc's
row flags an unresolved question — whether `EditorIcon` should become a data
config registered under `Icon.tsx`'s existing lookup rather than its own
component — but this task's brief explicitly directs shipping it as its own
file matching the sibling atoms' conventions, so that question is left open
for a future consolidation pass rather than re-litigated here.

**Read first (per the path-convention check):** `packages/ui/src/components/`
still exists on this branch's base (the `refactor/ui-flat-components-under-
react` rename has not merged) — so per this task's own instruction, the new
atom was placed under `packages/ui/src/react/components/EditorIcon.tsx`
(a new folder, this is its first file) rather than the old flat
`src/components/`, and `index.ts`'s barrel export line points at
`./react/components/EditorIcon.js`. Every existing barrel entry as of this
task is still `./components/*.js` form (0 pre-existing `./react/components/`
entries) — the new line is simply the correct real path for where the file
now lives, per the task's own instruction to route new atoms there
regardless of prevalence once the rename hasn't landed.

**Template read:** `AgentIcon.tsx`/`RemixIcon.tsx`/`Icon.tsx` (all three, per
the task brief) — `EditorIcon` is closest in shape to `Icon.tsx` (an inline-
SVG lookup keyed by a string, `aria-hidden` on every glyph) but with
`AgentIcon.tsx`'s two-tier structure (a `Record<string, Visual>` lookup +
graceful fallback tile) layered on top, since each editor needs its own
bg/fg color pair alongside its glyph, not just a shared `currentColor` stroke.

**What shipped:** `EditorIcon({ editorId, size })` — a `Record<string,
EditorVisual>` lookup (`vscode`/`cursor`/`windsurf`/`zed`/`qoder`/
`antigravity`/`webstorm`/`idea`/`xcode`/`finder`/`explorer`/`file-manager`/
`terminal`/`warp`) mapping a string key to `{ bg, fg, glyph }`, where `glyph`
is a `(size: number) => ReactElement` closure — each brand's inline SVG path
data ported byte-for-byte (this is presentational brand-mark data, not
logic, so nothing needed genericizing there). Unregistered ids fall back to
a neutral gray folder-tile glyph, matching the origin exactly.

**Genericized:** the origin's `editorId: HostEditorId | string` (an OD
contracts-package type) becomes a plain `editorId: string` — the only OD
coupling the origin had, per the task brief. No other product-identity
coupling found.

**i18n:** none needed — every glyph is an `aria-hidden` inline SVG with no
visible text and no `aria-label`/`title` prop, so there is no user-facing
string to route through `useT()`. Noted explicitly per the i18n policy
rather than silently skipped.

**Minor accessibility fix (disclosed, not silent):** the origin's fallback-
tile inner `<svg>` omitted `aria-hidden="true"` (every other glyph function
in the same file sets it) — added here for consistency with the rest of the
lookup table and with `Icon.tsx`'s own convention of `aria-hidden` on every
glyph; a decorative-icon accessibility improvement, not a behavior change a
consumer could observe.

### Purity grep

`grep -rniE 'open.?design|\bOD_|--od-stamp|/tmp/open-design'` across
`packages/ui/src/react/components/EditorIcon.tsx`(+test): **clean, zero
matches.**

### Test / typecheck / coverage results

- `pnpm --filter @jini/ui run typecheck`: green, zero errors (required
  building `@jini/chat-core` then `@jini/renderers-react` first — their
  `dist/` output didn't exist yet in this checkout and `@jini/ui`'s
  `features/html-viewer/` imports `@jini/renderers-react`; pre-existing
  build-order dependency, not something this task's own files introduced).
- New atom's own test (`npx vitest run src/react/components/EditorIcon.test.tsx
  --coverage`): **9 tests, 1 file, all green**, **100% statements/branches/
  functions/lines** on `EditorIcon.tsx` — every named glyph function
  (`vscodeLogo`, `finderLogo`, `terminalLogo`, `folderLogo`, `qoderLogo`,
  `antigravityLogo`) and the shared `simplePath` closure invoked at least
  once, plus the fallback-tile branch and a custom-size branch. No
  `/* v8 ignore */` used.
attempted this session; genuinely out of scope, not silently dropped.

## 2026-07-22 addition — genuine 99.98/99.88/100/99.98 coverage across the whole package (audit fix, coverage pass)

This package was not in this task's originally-named package list — it was found via the
standing rule ("check every other package with a source-map.md for coverage gaps beyond the named
list"). Baseline (`rm -rf coverage && pnpm --dir packages/ui run test:coverage`, then
`coverage/coverage-final.json` read directly with a small Python script per this task's own
method — the text table truncates once a package has this many files): **93.35% statements /
91.28% branches / 92.88% functions / 93.35% lines** package-wide, with `src/utils` the worst single
directory and `src/features/connectors/**` (the whole feature: `rules.ts`, `dependencies.ts`, all
3 hooks, all 5 components, plus `ConnectorsBrowser.tsx` itself) the largest concentration of real
gaps. Reached **99.98% statements / 99.88% branches / 100% functions / 99.98% lines**
(17723/17726 statements, 6865/6873 branches, 1193/1193 functions, 17723/17726 lines) via the
classify-then-fix loop — every gap was either a real reachable branch that got a real test, a
provably-dead branch removed via a real refactor, or (a small residual set) a provably-unreachable
branch documented in place rather than forced. Zero `/* v8 ignore */` anywhere in this task's
changes, matching this repo's zero-precedent policy.

### 0/0/0/0 files verified as genuinely type-only (not a real gap)

20 more `ports.ts`/`types.ts` files package-wide showed `0/0/0/0` in the coverage report. Each was
independently re-verified (not assumed from the pattern already documented above for
`settings-dialog`/`tab-strip`/`html-viewer`/`list-detail-panel`) via
`grep -nE '^(export )?(const|function|class|let|var) '` finding zero runtime declarations, plus a
broader `enum|default` sweep for the same files — confirmed pure `export type`/`export interface`
declarations that fully erase at compile time. Added to `vitest.config.ts`'s `coverage.exclude`
list: `features/{asset-grid,asset-tree-browser,connectors,memory,sketch-editor,version-manager,
viewer-shell}/{ports,types}.ts`, `features/browser-chrome/{ports,types}.ts`,
`features/i18n/types.ts`, `features/mention-autocomplete/types.ts`,
`features/progress-card/types.ts`, `features/schedule-picker/types.ts`.

### Real refactors — dead branches removed rather than tested around

Every one of these follows this task's own established standard (`packages/http/source-map.md`'s
`runs.ts`/`terminals.ts` entry): a branch that no real call site (or, for JSX conditionals, no real
*render* path) can ever take, given the code's actual internal call graph — not "hard to trigger",
structurally impossible.

- **`utils/notifications.ts`**: `ToneSpec.gain` was optional with a `?? 0.18` default; `playTones`'
  only caller (`SOUND_PLAYERS`, all 7 entries) always supplies `gain` explicitly — made required,
  dropped the default. `showViaConstructor`'s own `typeof Notification === 'undefined'` /
  `Notification.permission !== 'granted'` re-checks were dead: its only caller
  (`showCompletionNotification`) already performs both checks before ever calling it — removed.
- **`utils/auto-open-file.ts`**: `basenameOf`'s `?? p` fallback — `String.split` never returns a
  holey/empty array, so `.pop()` can never be `undefined` for a real string — removed.
- **`utils/markdown-scroll-sync.ts`**: `escapeMirrorText(lines[i] ?? '')` — `text.split('\n')` is
  always dense, so `lines[i]` is always defined — removed the fallback. `hasVerticalProgression`'s
  `offsets[0] ?? 0` — its only callers always build a dense `offsets` array — removed.
  `mapScrollPosition`'s `span > 0 ? (value - sourceLow) / span : 0` — proved (not just tested)
  `span` is *always* > 0 for any input array (monotonic or not), via this function's own binary-
  search invariant (`sourceLow <= value < sourceHigh` holds at every possible exit, guaranteed by
  the early clamp checks plus the loop's own low/high update rule) — removed the dead ternary,
  replaced with a direct division. The `typeof document === 'undefined'` half of
  `measureEditorBlockOffsets`'s guard is real, intentional SSR-safety API contract per its own
  JSDoc, but empirically unreachable through this repo's actual call graph today (its only caller
  always supplies an already browser-mounted ref) — left in place with a comment explaining why a
  real test isn't attempted here (would require either reintroducing this package's own documented
  jsdom/node coverage-merge bug — see `features/html-viewer/dependencies`'s entry above — or
  hand-faking this function's full DOM surface under plain Node).
- **`utils/smooth-scroll-to-top.ts`**: `unitBezier`'s Newton-iteration `Math.abs(d) < 1e-6 break`
  guard — sampled `sampleDX(t)` at 1,000,001 evenly-spaced points across the full `t ∈ [0,1]` domain
  for this file's one and only curve (`EASE_OUT = unitBezier(0.23, 1, 0.32, 1)`, the sole call site
  with fixed constants) — minimum observed derivative ≈0.6095, nowhere near the guard. Documented
  in place (not removed — a defensive guard worth keeping against a future curve-constant change),
  proof recorded in a code comment at the call site.
- **`features/connectors/rules.ts`**: `fallbackLogoInitials`'s `single[0] ?? ''` — `single` is
  always non-empty (proved via the `parts.length === 1` guard plus the earlier `!cleaned` check on
  an already-`.trim()`-ed string) — removed; `single[1] ?? ''` stayed (a real single-character-name
  case).
- **`features/connectors/components/ConnectorCard.tsx`** and **`ConnectorDetailDrawer.tsx`**:
  both had a `continueAuthorization` handler re-checking `authorizationPending?.redirectUrl` before
  using it — in both files the *only* call site (the "continue in browser" button) only ever
  renders while that same condition already holds in that render, and React re-binds the closure
  fresh every render — removed both re-checks.
- **`features/connectors/components/ConnectorDetailDrawer.tsx`**: the "Load more tools" button's
  `toolsPreviewLoading ? <Icon spinner/> : null` was dead — proved via the section's own
  `isLoadingTools = toolsPreviewLoading || !toolsLoaded` gate: the button (and everything inside
  it) only renders while `!isLoadingTools`, which requires `toolsPreviewLoading` to already be
  `false` in that same render — so inside the button it can never be `true`. Removed the spinner;
  added a test instead documenting the real behavior (a load-more-in-flight fetch swaps the whole
  section to the "Loading tools…" message, not a button-local spinner).

### Provably-unreachable branches documented in place (not forced, not silently left uncovered)

Each below has a code comment with the proof at the call site, plus this entry as the durable
record — matching `packages/registry/source-map.md`'s `trust.ts:337-338` standard (re-derive, don't
assume; go further than "couldn't hit it in a test" when a structural argument is available).

- **`browser/useGlobalKeydown.ts:66-76`** (`if (typeof eventTarget === 'undefined') return;` inside
  the listener effect): the extracted `resolveGlobalKeydownTarget` helper (exported for direct
  testing, matching `@jini/mcp`'s `oauth.ts` `readCappedText` precedent) *does* have a real,
  passing test proving it returns `undefined`. This call site's guard against that is unreachable
  through any real mount: `useEffect` bodies only ever run client-side, after React has already
  committed real DOM via `ReactDOM` — which itself requires `window` (and, for a `'document'`
  target, `document`) to already exist. There is no real browser session where this effect runs at
  all while its own resolved target has vanished.
- **`features/connectors/hooks/useConnectorAuthorization.ts:120-141`**
  (`cancelStaleAuthorizations`'s `setAuthError` clear, the `curr[connectorId] !== undefined` guard):
  proved `authError[id]` and `pending[id]` can never both be set for the same `id` at the same
  time, via this hook's own state-transition rules — every path that sets `authError[id]`
  (`runConnectorAction`'s connect-failure branch) unconditionally clears `pending[id]` in that same
  update, and the only path that ever sets `pending[id]` to a new truthy value again (a later
  connect call's success branch) unconditionally clears `authError[id]` *first*, before reaching
  its own success branch. So by the time any id reaches this stale-sweep success path with a real
  `pending[id]` entry, `authError[id]` is guaranteed already absent.
- **`features/observability/stuck-run.ts:103-121`** (`emitStuck`'s `!entry || entry.emitted`
  guard): `emitStuck` only ever runs as a `setTimeout` callback created by `scheduleEmit`; every
  path that could remove or re-flag an entry (`trackRunStart`'s `cancelRun`, `trackRunTerminal`)
  always `clearTimeout`s that exact timer first, and in this single-threaded runtime a cleared
  timer's callback can never still fire — so by the time this callback runs, its entry is
  guaranteed to both exist and have `emitted === false`.
- **`features/observability/white-screen.ts`**: three related guards, all proved via the same
  clearTimeout/disconnect-is-synchronous argument as `stuck-run.ts` above — (1)/(2) the timer
  callback's and the `monitorMount` completion callback's `if (cancelled) return;` checks (both set
  `cancelled = true` alongside a synchronous `clearTimeout`/`stopMonitor()` call, so a cleared timer
  callback can never observe `cancelled` already `true`), and (3) the raw `MutationObserver`
  callback's own `if (stopped) return;` — empirically re-verified directly against this repo's real
  jsdom (not just reasoned about): two synchronous body mutations followed by two microtask flushes
  produced exactly one callback invocation with `stopped` still `false` at its start, and a further
  post-`disconnect()` mutation produced zero more calls (`disconnect()` also discards pending
  mutation records per spec, confirmed empirically here too).

### Real tests added — by area

- **`src/utils`**: `notifications.ts` (the ~15-line uncovered block: AudioContext construction
  failure, resume()-rejects, every `SOUND_PLAYERS` entry including the lowpass-filter branch, the
  service-worker success/failure/no-showNotification/ready-rejects paths, the full `onclick`
  handler including `window.focus()` throwing and `note.close()` throwing) — rewritten under
  `// @vitest-environment node` (matching this package's own documented workaround for the jsdom/
  node coverage-merge bug) with hand-built `window`/`navigator`/`Notification` doubles rather than
  switching environments per case. `visual-stability.ts` (same node-env + hand-built
  `localStorage` double treatment). `copy-to-clipboard.ts` (no-prior-focus, disconnected prior
  focus, `focus({preventScroll})` throwing → plain `focus()` fallback). `dom-subscriptions.ts`
  (the untested cleanup path of `subscribeVisibleFocusOrVisibilityChange`).
  `auto-open-file.ts` (basename-fallback branch actually reached — the original test's "unique
  basename match" case was accidentally short-circuited by the *exact-path* match one step earlier
  in the same function — plus the filter-internal `f.path ?? f.name`/`rel ? … : false` branches,
  distinct from the identical-looking expression earlier in the function; `selectAutoOpenProducedArtifact`'s
  full depth/mtime tie-break matrix). `markdown-scroll-sync.ts` (the parser-throws catch path via
  `vi.doMock('micromark', …)` rather than hunting for a real malformed-markdown input against a
  deliberately permissive parser; `measureEditorBlockOffsets`/`measurePreviewBlockOffsets` — both
  previously *completely untested* despite being exported — via `HTMLElement.prototype.offsetTop`/
  `Element.prototype.getBoundingClientRect` prototype overrides, matching this package's own
  `defineLayout`-style layout-faking convention elsewhere; `buildScrollAnchors`/`mapScrollPosition`'s
  full sparse-array/out-of-order-input edge matrix). `smooth-scroll-to-top.ts`,
  `file-system-errors.ts` (blank-name/blank-message Error fallback paths).
- **`src/browser/useGlobalKeydown.ts`**: the resolver extraction described above, plus its own
  direct unit tests for both `'window'`/`'document'` targets, present and absent.
- **`src/hooks/useInView.ts`**: the never-attached-ref no-op path, and a custom `root` container
  actually reaching `IntersectionObserver`'s own `options.root`.
- **`src/features/observability/*`**: `install.ts`, `visibility.ts`, `boot-timing.ts` (default
  reporter/timeout, `requestIdleCallback`-present scheduling, legacy `performance.timing` fallback,
  a genuine two-listener `captured`-guard race reproduced by installing twice before `'load'`
  fires), `iframe.ts`, `long-task.ts` (buffered-observe throws → plain-observe fallback → both throw
  → clean give-up; unparseable `containerSrc`), `resource-error.ts` (every `readSrc` typed-element
  branch, the bare-attribute fallback via a prototype-swapped element, async/defer/crossorigin
  flags), `stuck-run.ts`, `white-screen.ts` (custom `rootElementId` found/not-found, `document.body`
  null, `innerText`-present branch, loading-shell-only root) — every one of these SSR/idempotency/
  teardown guards, previously either entirely untested or tested for statement coverage only
  without the paired closure/teardown actually being *invoked*.
- **`src/features/i18n`**: `locale.ts`'s `defaultDetectSystemLocale`/`browserPreferredLanguages`
  (previously entirely untested) and the `detectSystemLocale`-omitted default-wiring branch;
  `context.tsx`'s passthrough `setLocale` no-op and the missing-interpolation-var branch.
- **`src/features/progress-card/reference-adapters.ts`**: the `description`/`label`/`text` content-
  field fallback chain, a non-object `todos` entry, `mergeFileOpStatus`'s `'running'` and `'done'`
  merge outcomes, `dedupeToolUsesById`'s empty-input and rebuild-then-keep-later-event paths,
  `basename`'s all-separators edge case, a `'stopped'` todo status, the in-progress-bonus-absent
  progress calculation, and both `fileOpStatusToProgressStatus` outcomes via `secondaryItems`.
- **`src/features/connectors/rules.ts`**: the full `parseConnectorAuthorizationPendingState` field
  matrix (blank id, non-object state, valid `redirectUrl`), `connectorAuthSnapshotChanged`'s
  null/undefined matrix, `mergeConnectorToolPreview`/`mergeConnectorActionResult`'s
  `toolCount`/`featuredToolNames` carry-forward-vs-override branches, tool-level search-score
  matches, every sort tie-break level (connected-status → name → id) in both directions,
  `toolsBadgeTranslation`, `defaultCategoryLabel` (previously uncalled by anything, tests or
  otherwise), and the two-character-name initials case.
- **`src/features/connectors/dependencies.ts`**: `cancelConnectorAuthorization`,
  `openExternalUrl`, `fetchConnectorEnrichment`, `fetchConnectorDetail`'s found case,
  `createFakeConnectorsDependencies` (previously entirely untested), and every SSR-guard/
  try-catch pair in the two browser-adapter factories — the `sessionStorage.getItem`/`setItem`
  failure tests needed `vi.stubGlobal('sessionStorage', …)` rather than `vi.spyOn`, since
  `vi.spyOn(window.sessionStorage, 'getItem')` does not reliably intercept calls through jsdom's
  `Storage` implementation (verified: the installed spy was provably not what ended up being
  called).
- **`src/features/connectors/hooks/useConnectorCatalog.ts`**: both effects' unmount-before-fetch-
  resolves cancellation paths, and the port-has-no-`fetchConnectorEnrichment`-at-all case.
- **`src/features/connectors/hooks/useConnectorDetail.ts`**: the not-found detail-connector
  fallback, direct `loadMoreTools` calls while locked or while already loading, a retry that
  clears a prior failure, the underlying port call throwing, `openDetails` clearing a stale
  failure, and the "leaves sibling connectors in the catalog untouched" merge-map branch.
- **`src/features/connectors/hooks/useConnectorAuthorization.ts`**: the full
  `cancelStaleAuthorizations` matrix (throw vs. null-without-throw, clearing pre-existing
  `cancelFailed`), `runConnectorAction`'s pre-clear-before-connect, non-`Error` throws on both
  connect and disconnect (stringified via `String(err)`), the omitted-`errorCode` case, the
  already-connected-on-success `onConnectorsChanged` call, a full standalone `disconnect` success
  path (previously *only* reachable via an ignored, never-executed second call in one existing
  test), `reloadStatuses`'s own `onConnectorsChanged` call, and `cancelAuthorization`'s success-
  path clears plus its already-connected-so-don't-mark-failed and status-refresh-itself-throws
  fallback branches.
- **`src/features/connectors/components/*`**: `ConnectorLogo.tsx` (`onLoad`, synchronous
  already-`complete`-on-mount in both outcomes, empty-`connectorId` palette fallback, `size="lg"`).
  `ConnectorGrid.tsx` (pending-action-only-on-the-matching-card, custom empty-state copy,
  locked-hides-empty-state, locked-without-a-gate-prop, `getCategoryLabel`/`onOpenExternalUrl`
  pass-through). `ConnectorCard.tsx` (busy states for both actions, real disconnect click,
  disabled-card click/Space/stray-key/bubbled-from-a-non-propagation-stopping-child keyboard
  paths, the tools-badge-present case). `ConnectorDetailDrawer.tsx` (backdrop vs.
  in-drawer mousedown, the authorization-pending header pill + tools-badge-in-header, the
  in-progress-authorization block with and without a redirect link, the cancelFailed alert, a real
  inline disconnect click, account-label/last-error rows, the genuinely-empty-tools message, a
  tool's own description and title-falls-back-to-name, the connect+cancel-authorization footer
  actions).
- **`src/features/connectors/ConnectorsBrowser.tsx`** (25% function coverage → 100%): default
  (no `dependencies` prop) construction, `onConnectorsChanged` wiring, grid-level disconnect, the
  empty-state clear-search action, `getCategoryLabel`/`getDisplayableAccountLabel` reaching both
  the grid *and* the open drawer, the full detail-drawer action set (disconnect, load-more,
  cancel-authorization, open-external-url — both the grid-card and drawer instances of each
  wiring closure are distinct closures at different call sites and needed independent coverage),
  a pending action reflected in the drawer's own busy state, an empty `providerTabs` array's
  `DEFAULT_PROVIDER_TAB_ID` fallback, and the gate CTA's `onProviderTabClick('gate_card')` +
  `gate.onClick()` wiring. Needed `within(...)` scoping throughout once the grid and the drawer
  are open simultaneously and render controls with identical accessible names.

### A real test-flakiness bug found and fixed in passing

One new `useConnectorDetail` test asserted `toolsLoaded` immediately after `waitFor(() =>
expect(port.fetchConnectorDetail).toHaveBeenCalledTimes(1))` — the fetch call and the state update
that follows its promise resolving are two separate ticks, so the assertion could run before the
state actually landed. Failed intermittently in isolation once caught. Fixed by waiting on the
actual state condition (`toolsLoaded === true`) instead of the call count as a proxy for it;
verified stable across 5 consecutive full-package `test:coverage` runs afterward.

### Verified, personally, this session

- `pnpm --dir packages/ui exec tsc --noEmit`: clean.
- `pnpm --dir packages/ui run build`: clean.
- `pnpm --dir packages/ui run test:coverage`: 255 test files, 3143 tests, all green, stable across
  3 consecutive full runs. Aggregate 99.98% statements / 99.88% branches / 100% functions / 99.98%
  lines — matches `vitest.config.ts`'s newly-added committed threshold exactly (no test added or
  removed since; the threshold is the real number, not a margin below it).
- `pnpm guard` (repo root): `[guard] ok` — clean, no boundary violations introduced.
## Section: `features/source-config-list/` — generic `SourceConfigList<TSource>` (2026-07-18)

Per `foundry/docs/jini-port/god-components-extraction-plan.md`'s Consolidation map §A row
`features/source-config-list/`, and r6 §3's cross-cutting pattern table: "URL/OAuth source
add + trust/status + list + per-item test/refresh/remove" is the single most-repeated shape
in the entire 23-file god-component sweep — appears in at least 6 places. This task ships the
4 in scope per the plan's own row (not `ConnectorsBrowser.tsx`, already shipped separately as
`features/connectors/` — confirmed a genuinely different shape, OAuth-catalog-*browse* rather
than add-by-URL/key; not Memory slice's connector reducers either, a rules-level-only future
reuse, flagged below, not this task's UI).

Sources, read in FULL from `/tmp/od-source` (public OD fork, `main` branch, commit
`0b88ef56144b5a42dc427c1292ae22676d698a34`, 2026-07-02 — the same commit already pinned below for
`features/resource-dashboard/`), not the vendored snapshot. This SHA was not recorded when this
section was first written (it cited only the now-gone `/tmp/od-source` checkout with no commit
pin, an unreproducible provenance gap flagged by a 2026-07-18 audit). Re-verified directly against
the real fork clone (`https://github.com/leonaburime-ucla/open-design.git`) via `git show
0b88ef56144b5a42dc427c1292ae22676d698a34:<path>`: `McpClientSection.tsx` is exactly 1,471 lines,
`PluginsView.tsx`'s `SourcesPanel` function starts at exactly line 1402, `EntryShell.tsx`'s
`OnboardingByokSetupPanel` function starts at exactly line 2904, and all 6
`apps/web/src/components/byok/*` files listed below are present at that commit — every cited
location matches exactly, confirming this SHA (not merely a plausible candidate) as the actual
extraction revision:

1. `apps/web/src/components/McpClientSection.tsx` (1,471 lines) — the strongest reference: an
   add-server picker (template categories + custom-blank), a draft-rows-with-bulk-Save-button
   list, per-row expand-to-edit, and a per-row `McpOAuthControl` (OAuth postMessage/focus/
   visibility handshake + fallback polling).
2. `apps/web/src/components/byok/*` (6 files) — `ByokProviderPicker`, `ByokConnectionTestControl`,
   `ByokModelField`, `ByokProviderBaseUrl`, `ByokKeyField`, `validation.ts`: a single-item
   (not list) form for one BYOK provider config — protocol picker, masked API-key field with
   show/hide + cleaned-whitespace notice, base-URL field with default/customize toggle, model
   field with a searchable-select + custom-model fallback, and a connection-test status/button
   control.
3. `apps/web/src/components/PluginsView.tsx`'s `SourcesPanel` (line ~1402) — r6 §1.11 calls this
   the near-exact structural twin of `McpClientSection.tsx`: add-a-marketplace-by-URL form with
   a trust-level `<select>` (`restricted`/`trusted`/`official`), a list of marketplace cards each
   with its own trust `<select>` + Refresh + Remove buttons, no per-item test.
4. `apps/web/src/components/EntryShell.tsx`'s `OnboardingByokSetupPanel` (line ~2904) — r6 §1.7:
   reinforces, does not newly discover, the byok pattern above, inside OD's onboarding flow: a
   protocol-tab strip, a provider quick-fill dropdown, API-key/base-URL/model fields, and both a
   "Fetch models" and a "Test" mini-button with inline running/success/error status text.

Per r6 §3, comparing (1) and (3) side-by-side first (as the task brief required) confirmed they
really are near-identical in shape (add-by-URL form + trust-or-mode select + list + per-item
refresh/remove), which is what let this primitive generalize confidently rather than guessing
from one source and hoping the rest fit.

### What shipped — `packages/ui/src/features/source-config-list/`

Uses the **new** `react/{hooks,components}/` layout end-to-end (per `god-components-extraction-plan.md`'s React-layout policy) — every file with zero React import stays at the feature's top level, everything importing React lives under `react/`.

| File | Contents |
|---|---|
| `types.ts` | Generic `SourceFieldKind`/`SourceFieldSpec`/`SourceFieldValues` (the host-supplied field-config seam), `SourceTrustOption` (host-supplied trust vocabulary — never baked in), `SourceConnectionStatus`/`SourceTestResult`, `SourceConfigItem` (`id`/`label?`/`trust?`/`enabled?`/`fields`/`status?`/`statusMessage?`), `SourceActionKind`, `SourceDraftIssue`/`SourceDraftValidation`, `AddSourceInput`/`AddSourceResult<TSource>`. |
| `constants.ts` | `MASK_CHAR`, `MASKED_VALUE_VISIBLE_SUFFIX_LENGTH`, `MASKED_VALUE_MIN_MASK_LENGTH` — the password-field masking convention (ported in spirit from `ByokKeyField.tsx`'s show/hide, generalized to a "always mask by default, show trailing 4 chars" rule not present verbatim in any one origin file). |
| `rules.ts` | `emptySourceDraft`, `validateSourceDraft` (required-field + `url`-kind http(s) format check, ported from the shared rule underlying both `McpClientSection.tsx`'s `validateRow` and `PluginsView.tsx`'s URL-add flow), `issueForField`, `pendingActionKey`/`isActionPending`/`withPendingAction`/`withoutPendingAction` (per-`(id,kind)` independent in-flight tracking, generalizing the `` `refresh:${marketplace.id}` `` string-key convention `PluginsView.tsx`'s `pendingAction` state already used ad hoc), `upsertSourceById`/`removeSourceById`/`updateSourceById`, `maskFieldValue`, `sourceDisplayLabel`. |
| `ports.ts` | `SourceConfigPort<TSource>` — `fetchSources`/`addSource`/`removeSource` required; `refreshSource`/`setTrust`/`testSource` **optional**, so the React layer derives which per-item actions to render from which methods a host's port actually implements rather than a separate set of boolean flags to keep in sync. `SourceConfigDependencies<TSource>` wraps it. |
| `dependencies.ts` | `createFakeSourceConfigPort`/`createFakeSourceConfigDependencies` — an in-memory fake requiring a host-supplied `createSource` callback (unlike `features/asset-grid/`'s read-only fake, this feature's `addSource` inherently needs to synthesize a `TSource` from an arbitrary host's `AddSourceInput`, so there's no zero-config default — see the file's own header comment). `supportsRefresh`/`supportsTrust`/`supportsTest` let a test/demo scope the fake to exactly the capabilities one origin shape actually has. |
| `react/hooks/useSourceConfigList.ts` | Loads the list, exposes `remove`/`refresh`/`setTrust`/`test` (each independently pending-tracked), `addSourceToList` (local upsert after a successful add, no reload), and `capabilities` (`canRefresh`/`canSetTrust`/`canTest`, derived from which optional port methods exist). Plus `useWiredSourceConfigList` (binds a required `dependencies` — see below for why this one isn't optional-defaulting). |
| `react/hooks/useSourceConfigAddForm.ts` | Owns the add-form draft (values + optional trust), live validation, and submit-through-the-port. Deliberately **not** i18n-aware (per the i18n policy: hooks stay `t`-free; the component wraps `validation.issues[i].message` in `t()` at render time) and deliberately not a `McpClientSection.tsx`-style bulk-dirty-tracked draft-rows-with-Save — see "Dropped" below. Plus `useWiredSourceConfigAddForm`. |
| `react/components/SourceConfigField.tsx` | One field per `SourceFieldSpec`: `text`/`url`/`password`(with show/hide, small local disclosure state)/`select`/`textarea`. |
| `react/components/SourceConfigTestControl.tsx` | Generic per-item status-line + Test/Retry button — simplified descendant of `ByokConnectionTestControl.tsx`'s status/button shape and `McpOAuthControl`'s status/action shape (OAuth-handshake specifics dropped, see below). |
| `react/components/SourceConfigAddForm.tsx` | Renders `fieldSpecs.map(SourceConfigField)` + an optional trust `<select>` (only when `trustOptions` is given) + submit button. Errors only render once a submit has been attempted (ported UX judgment from the byok/onboarding sources' "don't yell before submit" convention). |
| `react/components/SourceConfigItemCard.tsx` | Collapsed summary (label + trust badge) that expands (ported from `McpClientSection.tsx`'s `McpRow` expand-to-edit) to show every field (masked) + capability-gated Refresh/Remove/trust-`<select>`/Test. |
| `react/components/SourceConfigListView.tsx` | Pure composition (props in, JSX out): title/subtitle head, the add form, loading/error/empty states, the item-card list. |
| `react/components/SourceConfigList.tsx` | The orchestrator: composes `useWiredSourceConfigList` + `useWiredSourceConfigAddForm` + `SourceConfigListView`. Also re-exports the two feature hooks so a caller/test can compose them directly without a separate `../hooks/*` import. |
| `index.ts` | Public barrel. |

### Dropped — per source, never silently

**`McpClientSection.tsx`:**
- The categorized template **picker** (`PickerPanel`/`PickerCard`, `CATEGORY_ORDER`, collapsible `<details>` groups, inline search-filter-by-category) — this is a curated-catalog-of-presets UX specific to "which MCP servers does OD recommend," not a generic "add a source" concern. A host wanting a picker composes one itself and calls `addSource` with the chosen preset's field values.
- The **draft-rows-with-a-separate-bulk-Save-button** pattern (`rows`/`savedSig`/`dirty` signature-diff, a single `save()` that validates and PUTs the whole list at once, `useImperativeHandle`'s `save`/`hasDirty` surfaced to a dialog footer). The generic primitive instead adds/removes/updates **immediately per action** — the shape 3 of the 4 origin sources (byok, PluginsView, onboarding) actually use, and the one that composes cleanly with independent per-item pending state. A host that truly wants McpClientSection's specific batch-save UX needs its own wrapper; this primitive doesn't attempt to generalize batch-dirty-tracking.
- `McpOAuthControl`'s OAuth-specific concurrency handshake: `postMessage`/`BroadcastChannel` listening, a 2-second fallback poll with a 5-minute timeout, `window.open` with Electron-`shell.openExternal`-aware null-return handling, and a manual "I've approved — Refresh" fallback button. `SourceConfigTestControl`'s generic `onTest` callback can be *bound* to an OAuth-kicking-off port method, but none of this handshake machinery is generic primitive code — a host with an OAuth-backed source shape re-implements (or reuses `features/connectors/`'s already-shipped `useConnectorAuthorization` handshake logic, a more direct fit for that specific need).
- `McpAgentSupportBanner` (which installed CLI agents receive external MCP servers) — pure OD-runtime-catalog display, no generic analog.
- Row reordering (`moveRow`, ↑/↓ buttons) — no other of the 4 sources has an ordering concept; omitted rather than forced onto shapes that don't need it.
- The env/headers `KEY=VALUE`-per-line textarea convention (`mapToText`/`textToMap`) and the inline "Need help? Map your MCP JSON config" collapsible example panel — MCP-transport-specific, not generic form-field material. A host with a similar need models it as its own `textarea`-kind field and does its own text↔map parsing outside this primitive.

**`byok/*`:**
- `validation.ts`'s **protocol-specific API-key shape validation** — `sk-ant-`/`sk-`/`AIza`/`AQ.` prefix detection, first-party-base-URL-aware "this looks like an OpenAI key, not an Anthropic key" cross-protocol mismatch errors, and `cleanByokApiKey`'s zero-width-character/newline stripping. `rules.ts`'s `validateSourceDraft` only does host-agnostic required/URL-format checks — a host with real per-provider key-shape rules must run its own extra validation before calling `addSource` (the port's `AddSourceResult.message` is the seam for surfacing that failure back to the form).
- `normalizeByokBaseUrl`'s provider-specific URL normalization (auto-adding `https://`, inserting OpenAI's `/v1` path for `api.openai.com`, trimming trailing slashes with protocol-specific exceptions) — not ported; a `url`-kind field only gets a plain http(s)-format check.
- `resolveByokModelPreference`'s explicit/account/provider-default/empty precedence resolution, and `ByokModelField`'s searchable-combobox-with-custom-model-sentinel UX (`SearchableModelSelect`, `CUSTOM_MODEL_SENTINEL`) — model selection here is generalized only as far as `select`/`text`-kind fields go; the "suggested models" hint, the "loaded from account" success message, and the Azure-specific model-fetch hint are all origin-source-specific copy/state this primitive doesn't model.
- `apiKeyConsoleLink`'s per-provider "get an API key" external link — a host with per-provider help links renders its own `SourceConfigField` variant or wraps the primitive; not a generic concept (which provider, which URL).

**`PluginsView.tsx`'s `SourcesPanel`:**
- The **specific trust vocabulary** `restricted`/`trusted`/`official` — never hardcoded in this primitive; a host supplies its own `SourceTrustOption[]` (`trustOptions` prop), which is exactly how the MCP-shaped test scenario below uses a *different* two-value vocabulary (`restricted`/`trusted`) than any origin source used verbatim.
- Marketplace-specific summary metadata: plugin count (`` `${n} plugins` ``), catalog `version` display, and the manifest-`name`-vs-raw-URL title fallback logic tied to `PluginMarketplace.manifest`. Generalized only as far as `sourceDisplayLabel`'s generic "explicit label, else first field value, else id" rule — a host wanting richer per-item metadata composes its own summary line via `SourceConfigItemCard`'s field list (expanded state) rather than a dedicated metadata row.
- `sourceUrlTrackedRef`'s one-time analytics-on-first-focus tracking hook — analytics is host-owned; not part of this primitive at all.

**`EntryShell.tsx`'s `OnboardingByokSetupPanel`:**
- The onboarding-flow-specific **framing**: the protocol-tab strip copy (`API_PROTOCOL_TABS`), the "Quick-fill provider" dropdown pre-filling a whole provider preset (base URL + suggested model) in one click, and the mini-button-with-inline-status-text visual treatment (`onboarding-view__mini-button is-loading`). This primitive's `SourceConfigAddForm`/`SourceConfigTestControl` are deliberately plainer — a host embedding this primitive inside its own onboarding flow supplies its own surrounding chrome/copy.
- The **separate "Fetch models" action** (`onFetchModels`/`modelsState`/`ProviderModelsResponse`, `mergeOnboardingProviderModelOptions`) alongside "Test" — this primitive generalizes only the single "test this source" concept (`testSource`); a host wanting a second independent async action (fetch available models, in this case) composes its own control alongside `SourceConfigItemCard`, there's no second generic port method for it.
- `onboardingProviderModelLabel`/`renderOnboardingProviderTestMessage`/`onboardingTestVariant`'s origin-specific message-formatting logic (embeds the tested model name, latency, and a sample response into localized copy) — `SourceConfigTestResult.message` is a plain host-supplied string; formatting it richly is the host's job via its `testSource` port implementation, not this primitive's.

### Design choices flagged for reviewers

- **`dependencies` is a required prop/param, not optional-defaulting-to-a-fake** (on `SourceConfigList`, `useWiredSourceConfigList`, `useWiredSourceConfigAddForm`) — a deliberate difference from `features/asset-grid/`'s `useWiredAssetGridData`, which can supply a zero-config fake because its port is read-only. This primitive's `addSource` inherently needs a host-specific `createSource: (input) => TSource` to synthesize a new item for an arbitrary generic `TSource`, so there is no generic default that could exist. `createFakeSourceConfigPort`/`createFakeSourceConfigDependencies` are still shipped, per the mandated pattern, for tests and demos — they just require that one callback.
- **A real bug was caught while writing tests, not by inspection**: `rules.ts`'s `sourceDisplayLabel` originally fell back to the *raw, unmasked* first-field value when a source had no explicit `label` — meaning a labelless BYOK-key-shaped source with only an `apiKey` field would leak the full secret into the always-visible card summary row. Fixed to mask the fallback value through the same `maskFieldValue` rule used everywhere else (see `rules.ts`'s doc comment and `rules.test.ts`'s dedicated regression test).
- **Two dead `?? []` fallbacks were refactored away, not tested around**, per Phase 9.5 point 2: `SourceConfigAddForm.tsx` and `SourceConfigItemCard.tsx` each originally computed a separate boolean (`hasTrustOptions`/`showTrustSelect`) to decide whether to render a trust `<select>`, then separately null-coalesced `trustOptions` again inside the JSX — but TypeScript can't narrow through an intermediate boolean, so the `?? []` branch could never actually fire once the boolean was already true. Refactored to narrow `trustOptions` directly in the JSX condition (`trustOptions && trustOptions.length > 0 ? trustOptions.map(...) : null`), which both satisfies the type checker without a fallback and removes the genuinely-unreachable branch instead of writing a test that could never hit it.
- **A real, if minor, UX bug surfaced by the same loop**: neither trust `<select>` (add-form or item-card) had a placeholder `<option>` for "no trust chosen yet" — so with a controlled `value=""` and no matching `<option value="">`, the DOM silently displayed the *first* trust option as selected even though no explicit choice had been made. Added a disabled/hidden placeholder option to both, gated on `!trust`/`!source.trust`.

### BYOK "test before save" fix (2026-07-18 audit)

A 2026-07-18 audit found that `ports.ts`'s own `testSource(id, draft?)` doc comment already promised
support for testing an unsaved draft (the `draft` param), but the shipped implementation contradicted
that promise: the add form had no test control at all, and `SourceConfigList.tsx`'s orchestrator only
ever called `list.test(id)` for an already-persisted item — an unsaved draft has no id, so this flow
was genuinely unrepresentable, not just unwired. Real OD `ByokConnectionTestControl.tsx` (lines 36-42,
75-105) and `EntryShell.tsx`'s `testProviderInline` (lines 2120-2144) confirm the actual origin shape:
the test call is made with the CURRENT FORM FIELD VALUES directly (`testApiProvider({ protocol,
baseUrl, apiKey, model, ... })`), never an item id — there is no id to have yet.

Fixed for real (not narrowed/disclosed-as-dropped), matching the port's own already-stated contract:

- `ports.ts`'s `testSource` signature widened from `testSource(id: string, draft?)` to
  `testSource(id: string | undefined, draft?)` — `id === undefined` is the real "no persisted item
  yet" case; a host implementation branches on it (test the draft directly) vs. a defined `id`
  (test an existing item, optionally with unsaved edits to it).
- `useSourceConfigList.ts`'s `test(id, draft?)` now accepts `id: string | undefined` and keys its
  pending/result tracking (`pendingKeys`/`testResults`) by `id ?? DRAFT_TEST_SCOPE` (a new
  `constants.ts` pseudo-id, `'__draft__'`) — the same "give a not-yet-real id a stable pseudo-key"
  pattern `features/resource-dashboard`'s `BULK_DELETE_SCOPE` already established for its own
  not-scoped-to-one-item bulk-delete tracking.
- `SourceConfigAddForm.tsx` gained an optional test-before-save control (reusing the existing
  `SourceConfigTestControl` presentational component — no new UI primitive needed), rendered only
  when the host's port implements `testSource` at all (`canTest`, mirroring `capabilities.canTest`)
  and disabled while the current draft fails required-field/URL validation (mirroring the origin's
  own `canTestProvider`/`baseUrlValid` gate — testing an incomplete draft isn't meaningful).
- `SourceConfigList.tsx` wires it: `onTest={() => void list.test(undefined, addForm.values)}`,
  `testing={list.isPending(DRAFT_TEST_SCOPE, 'test')}`, `testResult={list.testResults[DRAFT_TEST_SCOPE]}`.
- `createFakeSourceConfigPort`'s `testSource`/`onTest` fake also widened to accept `id: string |
  undefined` (resolving `source` to `undefined` when `id` is `undefined`, since there is nothing
  persisted to look up yet).

Verified with real tests, not just re-reading the source: `useSourceConfigList.test.ts` gained a
regression proving a draft test (`id === undefined`) is forwarded to the port verbatim and its
result is stored under `DRAFT_TEST_SCOPE` — NOT mixed into any real source id's `testResults` entry
— plus a pending-state-isolation regression. `SourceConfigAddForm.test.tsx` gained a `describe`
block covering: the control is absent when `canTest` is false or `onTest` is omitted, it renders and
calls `onTest` when the draft is valid, it stays disabled while the draft is invalid (even before a
submit attempt — deliberately NOT gated on `submitAttempted` like field errors are, since testing
never "yells" the way a submit-validation error does), and it shows running/result state.
`SourceConfigList.test.tsx` gained a full end-to-end regression: render the real add form, type BYOK
draft values, click its own "Test" button BEFORE any submit, and assert the injected port's
`testSource` was called with `(undefined, { apiKey: ..., model: ... })` and the result renders — with
no item card ever created (nothing was persisted). Full package after this fix: 171 source-config-list
tests, all green (up from 162 after the i18n fix, 152 at the pinned audit head).

### MCP enable/edit fix (2026-07-18 audit)

A 2026-07-18 audit found that `types.ts` already declared `SourceConfigItem.enabled`, but nothing in
the shipped port or UI ever rendered or mutated it, and the expanded item card was an entirely
read-only `<dl>` — no way to edit a source's `label`/fields after creation at all. Real OD
`McpClientSection.tsx`'s `McpRow` (lines 779-794, 908-960) supports both: an always-visible
enable/disable checkbox in the collapsed summary row (`onChange({ enabled: e.target.checked })`,
never gated behind expanding the row), and, once expanded, an editable label input plus editable
transport/config fields. The audit also found the existing "MCP-server-shaped source" test describe
block actually proved a *BYOK/marketplace-style trust* interaction (`MCP_TRUST_OPTIONS`), not MCP's
own real shape — `ports.ts`'s own `SourceTrustOption` doc comment states "the origin MCP-server shape
has none" (no trust concept at all), so that test, however useful as the two-shape ABSTRACTION proof
(see below), was never actually representative MCP behavior on its own.

Fixed for real (not narrowed/disclosed-as-dropped):

- `types.ts` gained `SourceUpdateInput` (`{ label?; enabled?; fields? }`) and added `'update'` to
  `SourceActionKind`.
- `ports.ts` gained an optional `updateSource?(id, patch: SourceUpdateInput): Promise<TSource | null>`
  — ONE generic partial-patch method rather than one method per editable property (`setEnabled`,
  `setLabel`, `setFields`, ...), matching the primitive's existing "one capability = one optional
  port method" convention (`refreshSource`/`setTrust`/`testSource`). A host with nothing editable
  after creation simply omits it, same as any other optional capability here.
- `useSourceConfigList.ts` gained `update(id, patch)` (pending-tracked under the new `'update'` kind,
  mirroring `setTrust`) and `capabilities.canUpdate` (derived from `Boolean(port.updateSource)`).
- `SourceConfigItemCard.tsx`: an always-visible enable/disable checkbox in the summary row (rendered
  whenever `source.enabled !== undefined && capabilities.canUpdate` — never gated behind expanding,
  matching the origin exactly), and, once expanded, an "Edit" toggle that swaps the read-only field
  list for editable `SourceConfigField`s (reusing the SAME component the add form uses) plus an
  editable label input, with Save/Cancel committing or discarding the local draft. Deliberately
  immediate-commit-on-Save per source (NOT the cross-row batch-save-with-dirty-signature pattern
  `source-map.md` already documents as dropped from `McpClientSection.tsx` — that pattern tracks
  dirty state across an entire LIST of rows behind one shared Save button; a single card's own
  Save/Cancel is a different, smaller, already-namespaced-as-generic concern).
- `SourceConfigField.tsx` gained an `idPrefix` prop (defaulting to the unchanged
  `'source-config-field'`) — a real bug was caught while writing the end-to-end test for this fix:
  the add form and an item card's new expand-to-edit fields render the SAME `fieldSpecs`
  simultaneously once a card is in edit mode, and the component's DOM id was derived from `spec.key`
  alone with no scoping, producing duplicate ids (and `getByLabelText` ambiguity — an accessibility
  bug, not just a test artifact) whenever both were mounted at once. `SourceConfigItemCard.tsx` now
  passes a per-source `idPrefix` when rendering its edit-mode fields.
- `createFakeSourceConfigPort` gained a `updateSource`/`onUpdate` fake option (defaulting to a plain
  shallow merge — `fields` merged key-by-key, `label`/`enabled` replaced when present in the patch).

Verified with real tests, not just re-reading the source: `useSourceConfigList.test.ts` gained an
`update` describe block (no-op with no port method, patches and persists on success, leaves the
source in place when the port returns `null`, pending-state isolation). `SourceConfigItemCard.test.tsx`
gained two describe blocks: enable/disable (checkbox presence tied to BOTH `source.enabled !==
undefined` AND `capabilities.canUpdate`, calls `onUpdate({ enabled })` without needing to expand
first, disabled while updating) and expand-to-edit (read-only-by-default, Edit reveals editable
inputs seeded with CURRENT values, Save calls `onUpdate` with the edited patch and closes edit mode,
Cancel discards without calling `onUpdate`, Save/Cancel disabled while updating).
`SourceConfigField.test.tsx` gained a regression proving two instances for the same field key never
collide when given different `idPrefix`es. `SourceConfigList.test.tsx` gained a full end-to-end
regression against a real MCP-shaped source with `enabled: true`: click the real always-visible
checkbox (asserts the persisted source's `enabled` actually flipped via a `fetchSources()` round
trip), then expand, click the real "Edit" button, change the label and the URL field, click "Save",
and assert BOTH persisted via another `fetchSources()` call — not just that a callback fired. This is
the "representative MCP interaction proof" the audit asked for, alongside (not replacing) the
existing trust-vocabulary two-shape abstraction test, which is left in place and re-labeled nowhere
— it remains a real, useful proof of the generic trust capability, it is simply not itself proof of
MCP-specific behavior; the new enable/edit test now supplies that. Full package after this fix: 186
source-config-list tests, all green.

### i18n

**Correction (2026-07-18 audit + fix-up):** this section previously claimed "every user-facing
string in every component is wrapped in `t()`" and that `<SourceConfigField error={issue.message}>`
was evidence of that. Both claims were false. `rules.ts`'s `validateSourceDraft` built pre-baked
English sentences (`` `${spec.label} is required.` ``) that rendered straight through, unwrapped;
`SourceConfigField.tsx` rendered host-supplied `spec.label`/`spec.placeholder`/`option.label` raw
(never passed through `t()`); `SourceConfigItemCard.tsx` rendered the trust badge/select
`option.label` and expanded-field `spec.label` raw; `SourceConfigListView.tsx` rendered custom
`title`/`subtitle`/`emptyMessage`/`loadError` raw when a host supplied them. The dedicated i18n
test's dictionary translated only `Add source`/the empty-state string, plus an *identity*
`URL -> URL` entry that could never distinguish "translated" from "never wrapped" — and the suite
never submitted an invalid form, so the raw validation-message path was never exercised at all.

Fixed for real, verified with actual failing-then-passing tests (not just re-reading the source):

- `rules.ts`'s `validateSourceDraft` now returns an i18n-ready TEMPLATE (`'{label} is required.'`,
  `'{label} must be a valid http:// or https:// URL.'`) instead of a baked English sentence —
  `rules.ts` stays hook-free per policy; the render boundary (`SourceConfigAddForm.tsx`) wraps it
  via `t(issue.message, { label: t(spec.label) })`, translating both the template AND the
  interpolated field label.
- `SourceConfigField.tsx` now wraps `spec.label`, `spec.placeholder` (input/textarea/select
  fallback), and every `option.label` in `t()`.
- `SourceConfigItemCard.tsx` now wraps the trust badge (`trustOption?.label ?? source.trust`),
  every trust-`<select>` `option.label`, and each expanded field's `spec.label` in `t()`.
- `SourceConfigListView.tsx` now wraps custom `title`/`subtitle`/`emptyMessage`/`loadError` in
  `t()` (falling back to the existing built-in `t('No sources configured yet.')` etc. when a host
  doesn't override them).
- `SourceConfigAddForm.tsx` also now wraps `addLabel` and `submitError` (a host-suppliable
  `AddSourceResult.message` or the hook's own `'Failed to add source.'` fallback) in `t()`.
- Masking (`maskFieldValue`) and label-derivation (`sourceDisplayLabel`) stay pure with no i18n
  wrapping — they operate on arbitrary host DATA (a source's own field values, an id), not
  translatable vocabulary, matching how `ResourceBoard.tsx`'s item titles are handled elsewhere in
  this package.

Real-provider regression tests were added specifically to close the gap the audit's own citation
described (not just re-running the existing happy-path smoke test): `SourceConfigList.test.tsx`'s
i18n block now includes a real INVALID submission under a dictionary translating both `URL` and
the `'{label} is required.'` template, asserting the fully-translated sentence
(`'Adresse URL est requis.'`) renders — not just the field label alone — plus a second test
translating a host-supplied `select`-kind field's placeholder/option label. `SourceConfigField.test.tsx`,
`SourceConfigItemCard.test.tsx`, and `SourceConfigListView.test.tsx` each gained their own `describe('i18n — ...')`
blocks mounting under a real `I18nProvider` with a non-identity French dictionary and asserting the
translated string actually renders, covering: field label/placeholder/select-option translation,
trust badge/trust-select-option/expanded-field-label translation, and custom title/subtitle/
emptyMessage/loadError translation respectively. All pre-existing tests (162 total after these
additions, up from 152) still pass unmodified in default/passthrough locale.

### Two-shape proof (the actual abstraction test, per the task's own instruction)

`SourceConfigList.test.tsx` exercises the **same** `SourceConfigList<TSource>` component against two
deliberately different injected shapes:

- An **MCP-server-shaped** source (`{ fields: { url: string }, trust?: string }`) with a
  `restricted`/`trusted` trust vocabulary, `refreshSource`+`setTrust` enabled, `testSource`
  disabled (matching the real origin `McpClientSection.tsx` shape, which has no per-item test
  concept in this primitive's sense).
- A **BYOK-key-shaped** source (`{ fields: { apiKey: string, model: string } }`) with **no**
  trust concept at all (`trustOptions` omitted, `setTrust` disabled), `refreshSource` disabled,
  `testSource` enabled with a host-supplied `onTest` returning a custom message.

Both load existing items, add a new item through the generic add form, and — the MCP shape only
— change trust and refresh; the BYOK shape proves the trust `<select>` never renders at all
(`queryByRole('combobox')` is null) and that its labelless summary masks the API key, while the
MCP shape proves its Test button never renders (`queryByRole('button', {name:'Test'})` is null).
Same component, same `rules.ts`, two different `dependencies`/`fieldSpecs`/`trustOptions` —
this is the abstraction actually holding, not two presentational smoke tests.

### Phase 9.5 coverage-driven loop

Quoting the header this task was required to quote: **"Phase 9.5 — Coverage-driven refactor loop
(repeat until ≥99% on all 4 metrics, 100% is the goal)"**, and the coverage-bar changelog's point 1:
**"Coverage bar raised from the original's ≥98% to ≥99% on all 4 metrics, with 100% as the actual
goal (see Phase 9.5) — after 6 extractions landed against the original's 98% floor, one shipped
with a genuine bug and needed a real coverage-driven bug hunt after the fact."**

Ran the classify-then-fix loop once (`json-summary`/`json` reporters, per Phase 9.5's own
instruction that the v8 text table drops rows): every initially-uncovered branch was genuinely
reachable-but-untested (documented above with the tests that now cover them) except the two dead
`?? []` fallbacks, which were refactored away rather than tested around, per Phase 9.5 point 2 —
no `/* v8 ignore */` or any coverage-suppression comment was used anywhere, per Phase 9.5 point 3.
`types.ts`/`ports.ts` (verified interface-only via `grep -nE '^(export )?(const|function|class|let|var) '`
finding no runtime declarations) were added to `vitest.config.ts`'s existing documented
zero-executable-statement carve-out, the same pattern already used for `settings-dialog`'s
`types.ts` files.

**Final coverage (json-summary, 2026-07-18) — 100% on all 4 metrics, every file, no exclusions
needed beyond the two documented interface-only files:**

| File | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `constants.ts` | 100 | 100 | 100 | 100 |
| `dependencies.ts` | 100 | 100 | 100 | 100 |
| `index.ts` | 100 | 100 | 100 | 100 |
| `rules.ts` | 100 | 100 | 100 | 100 |
| `react/hooks/useSourceConfigList.ts` | 100 | 100 | 100 | 100 |
| `react/hooks/useSourceConfigAddForm.ts` | 100 | 100 | 100 | 100 |
| `react/components/SourceConfigField.tsx` | 100 | 100 | 100 | 100 |
| `react/components/SourceConfigTestControl.tsx` | 100 | 100 | 100 | 100 |
| `react/components/SourceConfigAddForm.tsx` | 100 | 100 | 100 | 100 |
| `react/components/SourceConfigItemCard.tsx` | 100 | 100 | 100 | 100 |
| `react/components/SourceConfigListView.tsx` | 100 | 100 | 100 | 100 |
| `react/components/SourceConfigList.tsx` | 100 | 100 | 100 | 100 |

### Purity grep

`grep -rniE "open design|OD_|--od-stamp|open-design\.ai|openDesignDesktop|@open-design/" packages/ui/src/features/source-config-list/`: **clean, zero matches.**

### Test/typecheck/guard results

- `pnpm --filter @jini/ui run typecheck`: green (zero errors). Needed the same `exactOptionalPropertyTypes`-driven fix the settings-dialog/connectors sections above already document: an optional prop whose value can be explicitly `undefined` at the call site (`SourceConfigAddFormProps.trust`/`submitError`) needs `| undefined` added to its declared type, not just a `?`.
- `pnpm --filter @jini/ui exec vitest run src/features/source-config-list`: **152 tests, 11 files, all green** — `rules.test.ts` (33), `dependencies.test.ts` (17), `useSourceConfigList.test.ts` (16), `useSourceConfigAddForm.test.ts` (10), `SourceConfigField.test.tsx` (11), `SourceConfigTestControl.test.tsx` (8), `SourceConfigAddForm.test.tsx` (11), `SourceConfigItemCard.test.tsx` (21), `SourceConfigListView.test.tsx` (12), `SourceConfigList.test.tsx` (8, including the two-shape proof and the i18n end-to-end test), `index.test.ts` (5, barrel smoke test).
- Full package `pnpm --filter @jini/ui exec vitest run`: **151 files, 1361 tests, all green** — 11 of those 151 files are this feature's new test files (152 of the 1361 tests).
- Full monorepo `pnpm -r run typecheck`: fails only at `packages/agent-runtime` and `packages/chat-react` (both missing a `tsconfig.json` entirely) — the same two pre-existing, unrelated stub-package failures every prior section in this doc has already documented; not touched by this task.
- `pnpm guard` (repo root): `[guard] ok (skeleton — rules pending implementation during extraction)` — unchanged, no boundary violations introduced.

### Flag for future work

`features/connectors/`'s `ConnectorsBrowser.tsx` canary and Memory slice's connector-reconciliation
reducers (`mergeMemoryConnector`/`applyMemoryConnectorStatus(es)`/`connectorWithPendingAuthorization`/
`connectorStatusesChanged`, per r6 §2 and this doc's `features/connectors/` section) both independently
manage "a list of connected things, reconcile live status onto it" state — structurally adjacent to
this primitive's `rules.ts` (`upsertSourceById`/`updateSourceById`/`removeSourceById`/
`isActionPending`/pending-key tracking), even though their UI stays separate (OAuth-catalog-browse
vs. add-by-URL/key are genuinely different interaction shapes, confirmed by the consolidation map).
When Memory slice work happens, or when `ConnectorsBrowser.tsx`'s own reducers get revisited, check
whether either can adopt this primitive's `rules.ts` directly (or extract a shared "keyed-list
reconciliation" module both `rules.ts` files import) instead of maintaining three independently-evolving
implementations of essentially the same upsert/status-reconcile logic. Not resolved here — flagged
per the task's own instruction, a rules-level opportunity only, never a UI-level one.

## Section: `features/resource-dashboard/` — DesignsTab.tsx + TasksView.tsx "resource-dashboard shell, twice" (2026-07-18)

Part B of a two-part scheduled task (Part A shipped `features/source-config-list/`, section
above). Per `foundry/docs/jini-port/god-components-extraction-plan.md`'s "5 more overlaps" section:

> **Resource-dashboard shell, twice, both directly Run-vocabulary-relevant**: `DesignsTab.tsx`'s
> dashboard shell (§1.17 — sub-tabs, search, bulk-actions, a **config-driven status-kanban** whose
> vocabulary `not_started/running/awaiting_input/succeeded/failed/canceled` "reads like a generic
> agent-run/job lifecycle") and `TasksView.tsx`'s list shells (§1.20 — hero+metric-tile header,
> tabbed template gallery, **row-list-with-expandable-run-history**, "a recognizable generic
> scheduled-job list CRUD shape"). ... evaluate together, likely as one `features/resource-dashboard/`
> (or a name that doesn't presuppose "design" — this is the single most core-engine-relevant cluster
> in the whole sweep and deserves care over speed).

### Provenance

Both sources read in FULL from `/tmp/od-source` (public OD fork, `main` branch, commit
`0b88ef56144b5a42dc427c1292ae22676d698a34`, 2026-07-02), not the vendored snapshot:

1. `apps/web/src/components/DesignsTab.tsx` (1,404 lines).
2. `apps/web/src/components/TasksView.tsx` (1,135 lines).

### The shared-vs-separate verdict: TWO distinct composition shapes, ONE shared low-level primitive

The orchestrator's own pre-read notes hypothesized a "PARTIAL overlap, not a clean single shape and
not two fully unrelated shapes" and explicitly asked for independent verification rather than
presuming either answer. A full read of both files confirms: **genuinely two distinct top-level
composition shapes**, sharing only a thin, genuinely-common layer (a status vocabulary + a
status-badge presentational primitive + a "group items by status" pure rule) — not a shared
dashboard shell. Evidence, quoted with line ranges:

**1. Kanban/status-grouping exists in exactly one of the two files, not both.**
`DesignsTab.tsx` lines 1012–1095 build a real grouped-by-status board:
```
const filtered = filtered.map(...)... // search+sub-sort applied first
{STATUS_ORDER.map((status) => {
  const colProjects = filteredProjects.filter(
    (item) => normalizeStatus(item.project.status?.value ?? "not_started") === status,
  );
  return (<div key={status} className="design-kanban-col">...
```
`STATUS_ORDER` (lines 48–55) is a fixed 6-value array (`not_started`/`running`/`awaiting_input`/
`succeeded`/`failed`/`canceled`), and this is a real column-per-status board, toggle-able against a
card grid via `view: "grid" | "kanban"` state (line 33, persisted to `localStorage` at line
45/277-281). `TasksView.tsx` has **no equivalent anywhere** — grep for `STATUS_ORDER`,
`.filter(.*status`, or any per-status grouping construct across its 1,135 lines returns nothing. Its
only status-vocabulary usage (`statusLabel()`, lines 203-209, and `StatusPill`, lines 211-213) renders
a single row's OR a single run's status as an inline badge — never as a grouping/column key. This
directly falsifies "both express the same shape, just differently" — one origin has a literal kanban
board; the other has never grouped anything by status at any nesting depth, including inside its own
nested run-history sublist (`AutomationRunHistory`, lines 1029–1135, which is itself a flat
chronological list of runs, not grouped/bucketed by status).

**2. The header/toolbar shapes are structurally unrelated.**
`DesignsTab.tsx`'s toolbar (lines 509-693): a sub-tab-pill sort selector (`recent`/`yours` —
confirmed a SORT, not a filter, by reading the `filtered` `useMemo` at lines 343-388, which always
returns every item, just re-ordered), a search input, a select-mode toggle + bulk-delete bar (lines
614-651, only in grid view), and the grid/kanban view toggle. `TasksView.tsx`'s header (lines
636-667): an `<header className="automations-hero">` with an eyebrow/title/lede block and 3 metric
tiles (`Metric` component, lines 1020-1027) plus a single primary CTA button. Zero structural overlap
— no sort selector, no search input, no select-mode, no bulk-delete anywhere in `TasksView.tsx`'s
"your automations" list (the only filtering/tabs in the whole file are in the template gallery
section, lines 909-988, which is create-flow content, not a filter over existing items).

**3. Per-item chrome is a kebab menu in one, always-visible inline buttons in the other.**
`DesignsTab.tsx`'s card kebab menu (lines 842-940): rename/duplicate/delete behind a
`design-card-more` button + popover, with outside-click/Escape dismiss
(`menuContainerRef`/`menuOpenId`, lines 130, 245-261, 844). `TasksView.tsx`'s row actions (lines
756-819): run/history/edit/pause-resume/delete are ALL always-visible inline buttons
(`automation-row__btn`), never collapsed into an overflow menu. This is a real interaction-pattern
difference, not just a visual one — DesignsTab's kanban-card variant (lines 1052-1064) drops the
kebab menu entirely in favor of a single always-visible delete button, closer to TasksView's
always-visible-buttons style, which is itself evidence the kebab-vs-inline choice tracks the SURROUNDING
shell's density (grid card vs. list row), not a fixed universal pattern either file
independently discovered.

**4. The row/item's OWN data shape differs at the type level, not just presentationally.**
DesignsTab's top-level items (`Project`) ARE themselves status-bearing resources — `p.status?.value`
(line 799) is a first-class field driving both the grid card's badge and the kanban column placement.
TasksView's top-level items (`Routine`) are NOT themselves status-bearing in the same sense — a
routine has `enabled`/`schedule`/`nextRunAt`; its `lastRun` (optional, lines 732-753) and its
`runs` (lines 1044-1062, lazy-fetched only on expand) are what actually carry a `RoutineRun['status']`
value. This is why TasksView never groups by status: the thing being listed at the top level isn't a
status-bearing resource at all, just a schedule that OWNS a collection of status-bearing sub-resources
one level down.

**5. Non-overlapping content confirmed present in only one file each**, closing the loop on the
orchestrator's own pre-read hypothesis: DesignsTab's card-grid/cover-thumbnail resolution (lines
942-974, OD-specific html/image/video/logo/brand kind dispatch), select-mode+bulk-delete+kebab-menu,
and `localStorage` view-toggle have no TasksView analog anywhere. TasksView's hero+metrics header,
template gallery (lines 909-988, a curated catalog of automation presets — create-flow content, not
a resource list concern), proposals-review section (lines 837-907, apply/reject an
automation-evolution workflow — no status-bearing-resource-list concept at all), and
inline-expandable-nested-run-history (lines 820-829, 1029-1135) have no DesignsTab analog.

**What IS genuinely shared**, confirmed by direct comparison: `statusLabel()` (DesignsTab lines
1185-1190) and `statusLabel()` (TasksView lines 203-209) are structurally identical functions — a
status-value-to-translated-string lookup, called at a leaf render site to build a small badge/pill.
This is the ONE real shared shape, and it is exactly as small as it looks: a status vocabulary + a
`StatusPill` presentational primitive + a pure "given items and a status order, bucket them into
columns" rule (a generalization of DesignsTab's `STATUS_ORDER.map` + `normalizeStatus`, usable by
ANY future consumer that wants kanban grouping, not just this one).

**Resulting design**: ship ONE feature folder, `packages/ui/src/features/resource-dashboard/`,
containing the shared low-level layer (`StatusPill`, `ResourceMetrics`, `groupItemsByStatus`,
`statusToneFor`, the pending-action-tracking pattern) PLUS two genuinely separate composed
orchestrators built on top of it: `ResourceBoard` (the DesignsTab shape: search/sort/select-mode/
bulk-delete/kebab-menu/grid-kanban-toggle) and `ResourceRowList` (the TasksView shape: hero+metrics+
CTA/flat-row-list/inline-actions/expandable-lazy-loaded-run-history). This is the outcome the task
brief flagged as plausible ("a shared 'status-badged list item + StatusPill' primitive doesn't
necessarily mean the surrounding dashboard shells are one shape") and the evidence above confirms it
directly — forcing both shapes through one composed shell would mean bolting kanban-grouping onto a
shape that never uses it (TasksView), or bolting expandable nested run-history onto a shape that
never had it (DesignsTab).

### What shipped — `packages/ui/src/features/resource-dashboard/`

Uses the `react/{hooks,components}/` layout throughout (zero-React files at the feature top level).

| File | Contents |
|---|---|
| `types.ts` | Shared: `ResourceStatusOption`, `ResourceStatusTone`/`ResourceStatusToneMap`. Board-shape: `ResourceBoardViewMode`, `ResourceSortOption`, `ResourceMenuActionSpec`, `ResourceBoardItem<TBody>` (generic `body` render-slot, `sortValues` keyed-by-sort-option map, `menuActions`). Row-list-shape: `ResourceMetric`, `ResourceRowAction`, `ResourceRowItem`, `ResourceRunHistoryItem`. |
| `constants.ts` | `DEFAULT_STATUS_TONE`, `UNMATCHED_STATUS_BUCKET`, `DEFAULT_BOARD_VIEW_MODE`. |
| `rules.ts` | Shared: `statusToneFor`, `pendingActionKey`/`isActionPending`/`withPendingAction`/`withoutPendingAction` (re-derived fresh, NOT imported from `source-config-list` despite identical shape — see "Design choices" below). Board-shape: `groupItemsByStatus` (generalizes `STATUS_ORDER.map`, with an `UNMATCHED_STATUS_BUCKET` catch-all so an unrecognized status is never silently dropped — DesignsTab itself has no such case since every `Project` defaults to `not_started`, but a generic primitive can't assume that), `filterBoardItemsByQuery`, `sortBoardItems` (generic over a host-supplied `sortValues` map, since DesignsTab's `recent`/`yours` sort by two different `Project` timestamp fields), `toggleSelectedId`, `pruneSelectedIds`. |
| `ports.ts` | `ResourceBoardPort<TItem>` (`fetchItems`/`deleteItem` required, `renameItem`/`duplicateItem` optional — no "add" method at all, since both origins delegate creation entirely to host UI), `ResourceViewModeStoragePort` (scoped by a host-supplied `scopeKey`, never DesignsTab's literal `"od:designs:view"`), `ResourceRowListPort<TRow>` (`fetchRows` required, `fetchRowHistory` optional — everything else TasksView's rows can DO is host-dispatched, not a port method, see below). |
| `dependencies.ts` | `createFakeResourceBoardPort`/`createFakeResourceRowListPort` — both can ship genuinely useful zero-config defaults (unlike `source-config-list`'s fake, which needs a required `createSource` callback) precisely because neither port has an "add" concept. `createLocalStorageViewModeStorage` — real, SSR-guarded `localStorage`-backed default (same "browser-only generic behavior ships as a real implementation, not a fake" reasoning as `features/browser-chrome`'s history storage). |
| `react/components/StatusPill.tsx` | The one genuinely shared UI primitive (see verdict above). |
| `react/components/ResourceMetrics.tsx` | Generalizes TasksView's `Metric` tile row over an arbitrary host-supplied list. |
| `react/components/ResourceCard.tsx` | DesignsTab's `design-card`: click-to-open/toggle-select, select-mode checkbox XOR kebab menu, status pill, host `renderBody` slot (cover-thumbnail resolution stays host-owned). |
| `react/components/ResourceKanbanBoard.tsx` | The status-grouped board — a deliberately LIGHTER card than `ResourceCard` (no select-mode, no kebab menu, no visible status pill — status conveyed by column + a CSS class only, matching the origin's own `design-kanban-card` exactly, confirmed by reading that branch specifically rather than assuming symmetry with the grid card). |
| `react/components/ResourceBoardToolbar.tsx` | Sort pills + search + select-mode/bulk-delete bar (grid-view-only) + view toggle + optional create button. |
| `react/components/ResourceBoardView.tsx` | Pure composition: toolbar + loading/error/two-distinct-empty-states (no-items-at-all vs. search-matched-nothing, DesignsTab's own distinction) + grid-or-kanban. |
| `react/hooks/useResourceBoard.ts` + `useWiredResourceBoard` | Owns search/sort/view-mode-persistence/select-mode/bulk-delete/the single-open-at-a-time kebab menu (with a REAL outside-click/Escape dismiss bug found and fixed while writing tests — see below)/kanban-column derivation. |
| `react/components/ResourceBoard.tsx` | Orchestrator. `rename`/`duplicate`/`delete` menu-action kinds are natively understood (mapped to the matching port method or, for `rename`, bubbled to `onRenameRequest` since it needs a text input this primitive doesn't collect — no `Dialog` is ported, see Dropped); any other kind bubbles to `onCustomItemAction`. |
| `react/components/ResourceRunHistoryList.tsx` | TasksView's `AutomationRunHistory` sublist: loading/empty states, a `StatusPill` + timing per run, an optional error/summary message, host-defined actions. |
| `react/components/ResourceRowListItem.tsx` | One row: title/meta/detail lines, last-run `StatusPill`, ALWAYS-VISIBLE inline action buttons (never a kebab — see verdict point 3), an optional history-expand toggle, the expanded sublist. |
| `react/components/ResourceRowListView.tsx` | Pure composition: hero header (eyebrow/title/lede) + metrics + CTA + a clickable empty state (TasksView's own empty state IS the create button) OR the row list. |
| `react/hooks/useResourceRowList.ts` + `useWiredResourceRowList` | Owns row loading, a generic `dispatchRowAction` (busy-tracks + reloads + refreshes the expanded row's history on success — mirrors TasksView's own `runNow` bumping `historyTick`), and expand/collapse with re-fetch-on-every-expand (not cached, matching the origin). |
| `react/components/ResourceRowList.tsx` | Orchestrator. `onRowAction` is REQUIRED and bubbles for every action kind (unlike `ResourceBoard`, nothing is natively understood here — see ports.ts). |
| `index.ts` | Public barrel — `isActionPending`/`pendingActionKey`/`withPendingAction`/`withoutPendingAction` deliberately NOT re-exported (see Design choices). |

### Dropped — per source, never silently

**`DesignsTab.tsx`:**
- Cover-thumbnail resolution across html/image/video/logo/brand kinds (lines 1240-1352,
  `projectCover`/`ProjectBrandCover`/`brandHostname`) — entirely OD-specific file-kind dispatch and
  brand-logo-fallback-chain logic. `ResourceBoardItem.body` + `ResourceCard`'s `renderBody` slot is the
  seam a host uses instead.
- Rename/delete/bulk-delete confirmation dialogs (`Dialog`/`DialogFooter` from `@open-design/components`,
  lines 1097-1163) — a third-party product component library, not ported. `ResourceBoard`'s `rename`/
  `duplicate`/`delete` methods perform the mutation directly with no confirm step; a host wanting
  confirmation wraps its own dialog around the call (same "host-owned modal chrome" pattern already
  established — no feature in this package has ported a generic `Dialog` primitive).
- Analytics tracking calls threaded through nearly every handler (`trackProjectsListClick`,
  `trackProjectsListControlsClick`, `trackProjectsMorePopoverClick`, `trackPageView`) — host-owned,
  analytics is cross-cutting concern territory per this package's existing convention (see
  `features/connectors`'/`features/asset-grid`'s own "analytics is host-owned" notes).
- The manual-refresh button and 15-second auto-refresh polling (`refreshProjectsList`,
  `PROJECTS_AUTO_REFRESH_MS`, lines 46, 287-341) — not ported; a host wanting this composes it around
  the hook's exposed `reload()`.
- `Toast`-based success/error notifications after bulk-delete (lines 1164-1174) — host-owned; the
  hook's `bulkDelete()` return value (`{ deleted, failed }`) is the seam.
- Live-artifact-specific card variant (`liveArtifactCardTitle`/`liveArtifactCardMetaLead`/
  `artifactStatusLabel`, lines 1204-1237, and the whole `item.type === "live-artifact"` branch) —
  a second, OD-specific item shape layered onto the same grid, not generalized (a host with a
  similarly dual-shaped list composes two `ResourceBoardItem[]` arrays itself).

**`TasksView.tsx`:**
- The entire template-gallery section (lines 909-988, plus `buildAutomationTemplates`/
  `filterTemplates`/`templateFilters`/the 6 hardcoded `buildStaticTemplates` presets, lines 58-331) —
  a curated create-flow catalog, a fundamentally different concern from listing existing resources
  (confirmed by the shared-vs-separate analysis above: this section has no DesignsTab analog at all).
- The proposals-review section (lines 837-907, `AutomationEvolutionProposal` apply/reject workflow,
  `proposalTargetLabel`/`proposalActionLabel`) — OD's automation-evolution-specific feature, no
  generic resource-list analog.
- The `crystallize` action (lines 564-595, 1097-1111) — a specific OD workflow (turn a successful
  run into review-able proposals). `ResourceRunHistoryItem.actions` generalizes only the OTHER kept
  action ("open"/"view progress"); crystallize's own semantics (and its dedicated `crystallizingRunId`
  busy-state, separate from the generic row-busy tracking) are not ported.
- `NewAutomationModal` (the create/edit form + REST wiring) — entirely host-owned; `onCreate`/
  `onRowAction`'s `'edit'` kind are the seams a host wires its own modal through.
- `scheduleStatusLabel`/`nextRunLabel`/`formatAutomationTimestamp`/`formatRunDuration` (lines
  172-201) — OD's `Routine`/`RoutineRun`-specific formatting logic. `ResourceRowItem.metaLine`/
  `detailLine` and `ResourceRunHistoryItem.startedAtLabel`/`durationLabel` are pre-formatted
  host-supplied strings; this primitive never re-derives them.
- Analytics (`fireClick`/`trackAutomationsClick`/`trackPageView`) — host-owned, same as DesignsTab.
- `window.confirm` before delete (line 618) — a bare browser confirm, itself a UX choice; not baked
  into this primitive's `dispatchRowAction`, same "host wraps its own confirmation" reasoning as
  DesignsTab's dropped `Dialog`.

### Mutation error handling and run-history race/failure fix (2026-07-18 audit)

A 2026-07-18 audit found two real, undisclosed behavior regressions (distinct from the
deliberately-disclosed "Dropped" list above, which covers intentional simplifications, not bugs):

1. **Resource mutations lost visible failure handling.** `useResourceBoard.ts`'s `remove`/
   `duplicate` let a rejected `port.deleteItem`/`duplicateItem` propagate uncaught;
   `ResourceBoard.tsx`'s `handleItemAction`/`onKanbanDelete` called them with a bare `void`, which
   discards a promise's return value WITHOUT attaching a rejection handler — both an unhandled
   rejection and, because nothing ever surfaced a message, a delete/duplicate could silently fail
   with the item still shown and no explanation. Real OD `DesignsTab.tsx`'s own
   `handleDuplicateProject` (lines 440-449) catches exactly this into a toast. Fixed by adding an
   `actionError: string | null` field to `ResourceBoardController`, set (and cleared at the start
   of the next call) inside `remove`/`duplicate`'s own `catch`, so both hook methods now always
   resolve (never reject) while still surfacing a visible message. `ResourceBoardView.tsx` renders
   it as its own `actionError`/`actionErrorLabel` banner ALONGSIDE the still-visible item list
   (deliberately NOT reusing `error`/`errorLabel`, which is the LOAD failure and hides the whole
   list — a mutation failure must not hide items that already loaded fine).
   `useResourceRowList.ts`'s `dispatchRowAction` has an explicit, tested contract ("a rejection
   propagates to the caller and does NOT reload") that a fix must not break; instead of catching
   silently, it now records the same kind of `actionError` in its own `catch` and then RE-THROWS,
   preserving that contract for a caller that awaits/catches directly while giving a
   fire-and-forget caller (`ResourceRowList.tsx`'s `onRowAction`) a real value to render.
   `ResourceRowList.tsx` was also changed to attach `.catch(() => {})` to the now-still-rethrown
   promise — `void` alone does not prevent an unhandled rejection, it only discards the resolved
   value. `ResourceRowListView.tsx` gained the matching `actionError`/`actionErrorLabel` banner.
2. **Run-history loading lost real OD's cancellation and failure semantics.**
   `useResourceRowList.ts`'s `fetchHistoryFor` had no `catch` at all — a rejected
   `port.fetchRowHistory` was an unhandled rejection AND left `historyByRowId[id]` `undefined`
   forever, which `ResourceRunHistoryList.tsx` renders as a permanent "Loading…" (its
   `items === undefined` check). Separately, collapsing then re-expanding the SAME row before its
   first fetch settled started a second, overlapping fetch for that id with no protection against
   the OLDER one resolving after the newer one and overwriting fresh history with stale data. Exact
   OD `TasksView.tsx` (lines ~1044-1062) catches a failure to an empty result and effectively
   ignores stale responses. Fixed with a per-row request-generation counter
   (`historyRequestSeqRef`): each `fetchHistoryFor(id)` call captures its own sequence number at
   start, and both the success and failure branches (plus the loading-flag clear in `finally`) check
   whether they're still the most recent request for that id before committing anything — a stale
   response is silently discarded rather than applied. A genuine failure now commits an empty array
   (matching OD) instead of leaving history stuck at `undefined`.

Both fixes are covered by new mounted/hook tests, not just re-reading the source: `useResourceBoard.test.ts`
gained `remove`/`duplicate` rejection regressions (`actionError` set, cleared on retry, item never
optimistically removed on a rejected delete) and `ResourceBoard.test.tsx` gained end-to-end
regressions clicking the real kebab-menu delete/duplicate actions against a rejecting fake port and
asserting the translated banner renders while the existing items stay on screen.
`useResourceRowList.test.ts` gained a rejected-`fetchRowHistory`-commits-empty-array regression, a
genuine overlapping-same-row race regression (older response resolves after the newer one; asserts
the newer data survives), and `dispatchRowAction` `actionError` regressions; `ResourceRowList.test.tsx`
gained an end-to-end regression clicking a real row action against a rejecting `onRowAction` and
asserting the translated banner renders without hiding the row. `ResourceBoardView.test.tsx`/
`ResourceRowListView.test.tsx` gained direct prop-level tests for the new `actionError`/
`actionErrorLabel` props (present, absent, falls back to raw string, renders alongside — not instead
of — the list).

### Design choices flagged for reviewers

- **`isActionPending`/`pendingActionKey`/`withPendingAction`/`withoutPendingAction` are re-derived
  fresh in this feature's `rules.ts`, not imported from `features/source-config-list`**, even though
  they are byte-for-byte the same pattern (confirmed while writing this feature — both independently
  generalize "track an in-flight action per `(id, kind)` key" from their respective origin's ad hoc
  string-key convention). Per this package's own "share only what correctness forces" rule (no
  shared/app-level layer), and per the **fixing-open-design-web** skill's hooks discipline
  ("duplication across slices is welcome; share only what *correctness* forces"), this is the correct
  call — but it does mean the SAME helper now exists twice in the package under the same names. To
  keep the package's own public barrel unambiguous, this feature deliberately does NOT re-export
  these four names from its `index.ts` (they stay internal, used only by this feature's own hooks) —
  `features/source-config-list` already publishes them at the package barrel; a host needing this
  exact utility uses that one. A real `TS2308` ambiguous-export compiler error at `src/index.ts` is
  what caught this during `pnpm --filter @jini/ui run typecheck`, not a design review — flagged here
  as a genuine, if narrow, argument for eventually promoting this pattern to a shared
  non-feature-owned module (a `src/utils/` helper, e.g.) rather than letting a third independent
  copy appear the next time this shape recurs (r6 §3's cross-cutting pattern table already lists
  "Progress bar + status icon + step/todo list" as a related, not-yet-extracted third instance in
  `DesignSystemFlow.tsx`). Not resolved here — flagged for a future consolidation pass, same spirit
  as the `features/connectors`/`features/source-config-list` rules-level reuse flag already recorded
  above in this document.
- **`ResourceRowList`'s `onRowAction` bubbles EVERY action kind, unlike `ResourceBoard`'s native
  rename/duplicate/delete handling.** This asymmetry is intentional, not an inconsistency: DesignsTab's
  kebab menu has a small, fixed, cross-source-stable vocabulary (rename/duplicate/delete — the exact
  3 methods `ResourceBoardPort` already needs), whereas TasksView's row actions (run/edit/
  pause-resume/delete) have no such fixed, generalizable semantics — "pause/resume" alone requires
  toggling arbitrary host state with no universal shape, and "edit" always opens host UI. Rather than
  invent 1-2 native port methods and leave the rest host-dispatched (an arbitrary, hard-to-predict
  split), `ResourceRowList` dispatches ALL of them uniformly, letting the host's single `onRowAction`
  implementation branch on `kind` itself.
- **A real bug was caught while writing `ResourceBoard`'s own orchestrator tests, not by inspection**:
  the kebab menu's outside-click dismiss effect (`useResourceBoard.ts`) closed on ANY `window`
  `mousedown`, including a mousedown on the menu's OWN items — so clicking Rename/Duplicate/Delete
  inside an already-open menu closed the menu (via the native `mousedown` bubbling to `window`,
  BEFORE React's synthetic `click` handler could fire) before the click could ever register. Every
  "dispatch a native menu action" test failed cleanly, catching this immediately rather than shipping
  a silently-broken menu. Fixed with a `menuContainerRef` containment check — DesignsTab's OWN
  pattern (`menuContainerRef`/`el.contains(e.target)`, lines 130, 247-249), which this port had
  initially simplified away and shouldn't have. Threaded through `useResourceBoard` ->
  `ResourceBoardView` -> `ResourceCard`, with a dedicated regression test in
  `useResourceBoard.test.ts` (`stays open on a mousedown INSIDE menuContainerRef`) so this exact
  regression can't silently reappear.
- **Two Phase 9.5 dead-branch refactors, not tested around** (see the coverage section below for the
  full loop): `ResourceBoard.tsx`'s `kanbanColumns` lookup and rename-target lookup both originally
  had a defensive `??`/`?.` fallback that can never actually fire given this component's own call
  contract; `useResourceRowList.ts`'s `fetchHistoryFor` had a dead `port.fetchRowHistory` existence
  guard for the same reason (every call site already guarantees it). All three replaced with a
  non-null assertion plus an explanatory comment, per the skill's Phase 9.5 point 1's
  "TS-required fallback with no real runtime path" classification.

### `RunState` vocabulary-reconciliation note (flagged, NOT resolved — out of scope for this task)

Per the task brief, this UI primitive's status vocabulary is close to, but not identical with,
`@jini/protocol`'s own `RunState`:

- `@jini/protocol`'s `RunState` (`packages/protocol/src/run.ts`): `['queued', 'starting', 'running',
  'succeeded', 'failed', 'cancelled']` — 6 values, spelled `cancelled`.
- DesignsTab's `STATUS_ORDER`: `['not_started', 'running', 'awaiting_input', 'succeeded', 'failed',
  'canceled']` — 6 values, spelled `canceled`; has `not_started`/`awaiting_input` with no `RunState`
  analog; has no `queued`/`starting` analog (its own `normalizeStatus` actually MAPS `queued` onto
  `running` for display purposes — DesignsTab's `ProjectDisplayStatus` type is a superset that
  includes `queued` as a raw value even though `STATUS_ORDER`/the kanban board never surfaces it as
  its own column).
- TasksView's `RoutineRun['status']` (`statusLabel()`, lines 203-209): `succeeded`/`failed`/`running`/
  `queued`/`canceled` — 5 values, spelled `canceled`; no `starting`/`not_started`/`awaiting_input`
  analog at all — the narrowest of the three vocabularies.

This feature's own `ResourceStatusOption[]`/`ResourceStatusToneMap` types (`types.ts`) are
DELIBERATELY generic string-keyed maps with no hardcoded vocabulary at all — neither DesignsTab's nor
TasksView's status values are baked into this primitive anywhere; a host supplies whichever
vocabulary its own domain needs (see `ResourceBoard.test.tsx`/`ResourceRowList.test.tsx`, which each
use their own literal `STATUS_OPTIONS` array, not an imported constant). This means when a future
Jini `RunsView`/job-dashboard consumer wires this primitive to `@jini/protocol`'s real `RunState`,
that consumer supplies `statusOptions: [{value: 'queued', label: 'Queued'}, ...]` matching
`RUN_STATES` verbatim (spelled `cancelled`, no `not_started`/`awaiting_input`) — no code in this
primitive needs to change for that to work, since the vocabulary is a runtime prop, not a compile-time
union. The THREE-WAY spelling/vocabulary mismatch (`cancelled` vs. `canceled` vs. `canceled`, and the
`not_started`/`awaiting_input`/`starting` non-overlaps) is real and will need a decision when that
wiring actually happens (does a future `RunsView` normalize `RunState` into a DesignsTab-shaped
6-value display vocabulary with synthetic `not_started`/`awaiting_input` states derived from
elsewhere, or does it accept a narrower kanban with only `RunState`'s own 6 values and no
`awaiting_input` column?) — flagged here per the task's explicit instruction, deliberately NOT
resolved, since resolving it requires knowing how a real `RunsView` consumer wants to present
`awaiting_input`-shaped states (which don't exist in the engine's `RunState` at all — that would be
an application-level concept layered on top, e.g. a paused-for-input tool-call).

### i18n

Every user-facing string in every component (`StatusPill`, `ResourceMetrics`, `ResourceCard`,
`ResourceKanbanBoard`, `ResourceBoardToolbar`, `ResourceBoardView`, `ResourceRunHistoryList`,
`ResourceRowListItem`, `ResourceRowListView`) is either passed in pre-translated (leaf/pure-composition
components take `statusLabel`/`errorLabel`/etc. as already-resolved strings, never call `t()`
themselves) or wrapped via `useT()` at the two orchestrators (`ResourceBoard`/`ResourceRowList`),
which is where every literal English string this primitive owns (`'Search…'`, `'Select'`, `'Delete
selected'`, `'New'`, `'History'`, `'No items yet.'`, etc.) is wrapped in `t()`, following this
package's "the English string itself is the key" convention. `rules.ts` stays hook-free (pure);
`statusToneFor` and `groupItemsByStatus` never produce user-facing text, only tone/grouping keys.
`ResourceBoard.test.tsx` and `ResourceRowList.test.tsx` each have a dedicated i18n end-to-end test
mounting the full orchestrator under `I18nProvider` with a real dictionary and asserting the
translated strings actually render (not just the unconfigured passthrough case) — e.g.
`ResourceRowList.test.tsx`'s test asserts `'No items yet.'` (unconfigured) resolves to the French-ish
`'Rien pour le moment'` string via a mounted dictionary.

### Phase 9.5 coverage-driven loop

Quoting the header this task was required to quote: **"Phase 9.5 — Coverage-driven refactor loop
(repeat until ≥99% on all 4 metrics, 100% is the goal)"**, and the coverage-bar changelog's point 1:
**"Coverage bar raised from the original's ≥98% to ≥99% on all 4 metrics, with 100% as the actual
goal (see Phase 9.5) — after 6 extractions landed against the original's 98% floor, one shipped
with a genuine bug and needed a real coverage-driven bug hunt after the fact."**

Ran the classify-then-fix loop once (`json-summary`/`json` reporters, per Phase 9.5's own
instruction that the v8 text table drops rows). Every initially-uncovered branch/line was classified
per Phase 9.5 point 1:
- **Genuinely reachable, just untested** (the large majority): a `toneMap`-threading branch left
  untested in four components (`ResourceBoard`/`ResourceRowList`/`ResourceRowListItem`/
  `ResourceRowListView`), an `eyebrow`/`lede` branch and an unmatched-status label-fallback branch in
  `ResourceRowList.tsx`, the grid-view-mode toggle button (only kanban had been clicked in existing
  tests), and a message-without-`isError` branch in `ResourceRunHistoryList.tsx` — all closed with
  real, behavior-asserting tests, not padding.
- **A genuine race-condition branch, not previously exercised**: `useResourceRowList.ts`'s
  `historyLoadingRowId` clear-on-settle logic (`current === id ? null : current`) guards against an
  OLDER, slower history fetch for row A finally resolving AFTER the user has already switched the
  expanded row to B (and B's own fetch already cleared/set the loading flag) — closed with a
  dedicated test using a manually-controlled deferred Promise to force that exact interleaving,
  documented in the test as a real (if narrow) behavior this primitive protects, not a padding test.
- **Dead branches, refactored away rather than tested around** (Phase 9.5 point 1, "Dead branch"
  classification): `ResourceBoard.tsx`'s `kanbanColumns` lookup (`board.kanbanColumns.get(...) ?? []`)
  and rename-target lookup (`current?.title ?? ''`), plus `useResourceRowList.ts`'s
  `fetchHistoryFor`'s `if (!port.fetchRowHistory) return;` guard — all three provably unreachable
  given this component/hook's own internal call contract (documented per-site above in "Design
  choices"), replaced with a non-null assertion and an explanatory comment each, per Phase 9.5 point
  1's "TS-required fallback with no real runtime path" classification.
- No `/* v8 ignore */` or any coverage-suppression comment was used anywhere, per Phase 9.5 point 3.

`types.ts`/`ports.ts` (verified interface-only via `grep -nE '^(export )?(const|function|class|let|var) '`
finding no runtime declarations in either) were added to `vitest.config.ts`'s existing documented
zero-executable-statement carve-out, the same pattern already used for `settings-dialog`'s and
`source-config-list`'s `types.ts`/`ports.ts` files.

**Final coverage (json-summary, 2026-07-18) — 100% on all 4 metrics, aggregate AND every individual
file, no exclusions needed beyond the two documented interface-only files:**

Aggregate: **1204/1204 statements (100%), 488/488 branches (100%), 73/73 functions (100%), 1204/1204
lines (100%).**

| File | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `constants.ts` | 100 | 100 | 100 | 100 |
| `dependencies.ts` | 100 | 100 | 100 | 100 |
| `index.ts` | 100 | 100 | 100 | 100 |
| `rules.ts` | 100 | 100 | 100 | 100 |
| `react/components/StatusPill.tsx` | 100 | 100 | 100 | 100 |
| `react/components/ResourceMetrics.tsx` | 100 | 100 | 100 | 100 |
| `react/components/ResourceCard.tsx` | 100 | 100 | 100 | 100 |
| `react/components/ResourceKanbanBoard.tsx` | 100 | 100 | 100 | 100 |
| `react/components/ResourceBoardToolbar.tsx` | 100 | 100 | 100 | 100 |
| `react/components/ResourceBoardView.tsx` | 100 | 100 | 100 | 100 |
| `react/components/ResourceBoard.tsx` | 100 | 100 | 100 | 100 |
| `react/components/ResourceRunHistoryList.tsx` | 100 | 100 | 100 | 100 |
| `react/components/ResourceRowListItem.tsx` | 100 | 100 | 100 | 100 |
| `react/components/ResourceRowListView.tsx` | 100 | 100 | 100 | 100 |
| `react/components/ResourceRowList.tsx` | 100 | 100 | 100 | 100 |
| `react/hooks/useResourceBoard.ts` | 100 | 100 | 100 | 100 |
| `react/hooks/useResourceRowList.ts` | 100 | 100 | 100 | 100 |

(`types.ts`/`ports.ts` excluded per the documented zero-executable-statement carve-out — both
interface-only, no runtime declarations.)

### Purity grep

`grep -rniE "open design|OD_|--od-stamp|open-design\.ai|openDesignDesktop|@open-design/" packages/ui/src/features/resource-dashboard/`: **clean, zero matches** (exit code 1).

### Test/typecheck/guard results

- `pnpm --filter @jini/ui run typecheck`: green (zero errors).
- `pnpm --filter @jini/ui exec vitest run src/features/resource-dashboard`: **270 tests, 16 files, all
  green** (re-counted 2026-07-18, correcting the `useResourceBoard.test.ts` count below, which this
  section originally mis-stated as 35 when the executed suite reported 34 — a documentation error a
  2026-07-18 audit flagged; counts here also include the mutation-error-handling/run-history-race
  regressions added by that same audit's required fixes, see the dedicated section above) —
  `rules.test.ts` (27), `dependencies.test.ts` (25), `index.test.ts` (6),
  `useResourceBoard.test.ts` (38), `useResourceRowList.test.ts` (22), `StatusPill.test.tsx` (5),
  `ResourceMetrics.test.tsx` (2), `ResourceCard.test.tsx` (17), `ResourceKanbanBoard.test.tsx` (11),
  `ResourceBoardToolbar.test.tsx` (18), `ResourceBoardView.test.tsx` (20), `ResourceBoard.test.tsx`
  (21, including the two-orchestrator native-action-dispatch tests, the i18n end-to-end test, and the
  actionError regressions), `ResourceRunHistoryList.test.tsx` (12), `ResourceRowListItem.test.tsx`
  (11), `ResourceRowListView.test.tsx` (19, including the actionError regressions),
  `ResourceRowList.test.tsx` (16, including the i18n end-to-end test and the actionError regression).
- Full package `pnpm --filter @jini/ui exec vitest run`: counts drift as sibling features land in
  parallel; re-run `pnpm --filter @jini/ui exec vitest run` for the current total rather than trusting
  a number recorded here — see the full-package coverage section (added by the same 2026-07-18 audit
  pass) for why this package's full-suite number is tracked separately from any one feature's count.
- Full monorepo `pnpm -r run typecheck`: `packages/ui typecheck: Done` (clean). Failures exist
  elsewhere in the monorepo (`packages/agent-runtime`, `packages/chat-react`, `packages/cli`,
  `packages/http`, `packages/node-host`, `packages/renderers-react`, `packages/sqlite` — all missing
  a `tsconfig.json` entirely; `packages/daemon`/`packages/deploy` — unresolved `@jini/protocol`/
  `@jini/core` module references, apparently missing built `dist` output in this session) — **all
  pre-existing, entirely unrelated to this task** (this task touched only `packages/ui`); a strictly
  larger failing-package set than the two (`agent-runtime`/`chat-react`) the prior
  `source-config-list` section documented, most plausibly because this session never ran a full
  `pnpm install`/build across the workspace before starting, not because of anything this task
  changed — flagged for the record, not fixed (out of scope for a `packages/ui`-only task).
- `pnpm guard` (repo root): `[guard] ok (skeleton — rules pending implementation during extraction)`
  — unchanged, no boundary violations introduced.
## Section: `features/rich-text-input/` — Lexical rich-text editor + mention node + caret-floating-layer (2026-07-18)

Source: `leonaburime-ucla/open-design`, branch `main` @
`0b88ef56144b5a42dc427c1292ae22676d698a34` (real clone at `/tmp/od-source`,
per this task's mandate — not `foundry/integrations/open-design/reference/`'s
frozen snapshot), `apps/web/src/components/composer/` (last touched at
`31d98634c3676ad1e991d5d003a8e3728c273de`): `LexicalComposerInput.tsx`
(809 lines), `MentionNode.ts` (237 lines), `CaretFloatingLayer.tsx`
(160 lines), `deserialize.ts` (61 lines), `serialize.ts` (50 lines) — OD's
chat composer's Lexical (Meta's rich-text framework) integration. Named as
the destination for this exact cluster by three prior tasks' own
provenance notes (`features/mention-autocomplete/`'s "3-way overlap"
section, and the god-components-extraction-plan.md Consolidation map's
`utils/connectorBrandColor.ts`/`utils/inlineMentions.ts` rows), all of
which deliberately deferred it here rather than smuggling it into their
own narrower scope.

### What shipped — `packages/ui/src/features/rich-text-input/`

| File | Contents |
|---|---|
| `types.ts` | `MentionEntity` (generic `{id, kind: string, token?, label, title?}` — replaces the origin's fixed `plugin\|skill\|mcp\|file\|workspace\|connector\|unknown` `InlineMentionKind` union with a free-form string), `MentionPart`, `MentionInsert`, `CaretRect`, `RichTextTriggerAnchor` (`'inline'\|'line-start'`), `RichTextTriggerConfig`, `RichTextTriggerMatch`, `PopoverNavigationKey`, `SerializedRichText`, `RichTextInputHandle`. Zero runtime statements (verified, added to `vitest.config.ts`'s exclude carve-out). |
| `constants.ts` | `EDITOR_THEME`, `DEFAULT_TEST_ID`, `DEFAULT_TRIGGERS` (the origin's hardcoded `@mention`(inline)/`\|command`(line-start) pair, now data instead of two literal regexes), the `CaretFloatingLayer` sizing constants. |
| `mention-node.ts` | `MentionNode` (the atomic `@token` node, a `TextNode` subclass), `$createMentionNode`, `$isMentionNode`. Ported near-verbatim from `MentionNode.ts` — same token-mode/clone-recursion trap avoided (`setMode('token')` called only in `$createMentionNode`, never the constructor, per the origin's own hard-won comment). The one genuinely OD-tilted piece of the whole cluster (`connectorBrandColor`/`resolveBrandTheme` imports, plus the document-wide `MutationObserver` re-stamping every mounted pill on a theme flip) is dropped entirely — no color logic and no global observer belong on a generic Lexical node class. |
| `mention-parser.ts` | The generalized `apps/web/src/utils/inlineMentions.ts` (trie-based longest-match `@token` lookup, left/right boundary rules): `buildMentionToken`, `parseMentionParts`, `isMentionBoundary`, `isMentionRightBoundary`, `mentionTokenPresent`, `foldPresentMentions`. This file was explicitly left un-ported by the `mention-autocomplete` task ("the rest of that file is a much larger rich-text-over-a-committed-string mention system that belongs with the Lexical `composer/*` `@mention` system instead... pulling it in here would have smuggled a second, unrelated feature's source file into this task's scope") — this task is that second feature. |
| `serialize.ts` / `deserialize.ts` | `serializeRichText`/`setRichTextFromPlainText`, ported verbatim (no OD-specific surface in the originals at all beyond importing the generic `MentionNode`/`InlineMentionEntity`). |
| `rules.ts` | Pure Lexical-selection logic, no React: generalized trigger detection (`detectActiveTrigger`, `buildTriggerDeletionRegex`, `buildAnyTriggerDeletionRegex` — accept any `RichTextTriggerConfig[]` instead of two hardcoded regexes), the atomic-mention-navigation helpers (`mentionBeforeCaret`/`mentionAfterCaret`/`selectBeforeMention`/`selectAfterMention`/`removeMentionAtCaret`, ported verbatim — no OD surface in the origin), `readCaretRect` (the caret-rect fallback chain, verbatim), and `computeCaretFloatingLayerPosition` (`CaretFloatingLayer.tsx`'s `computePopoverPos`, verbatim, generalized to take its gap/margin/height/width constants as a parameter object instead of module-level literals). |
| `react/hooks/{useTriggerDetection,useKeyboardCommands,useMentionAtomicNavigation,usePasteFiles,useSyncedOnChange,useSeededValue}.ts` | The origin's internal `LexicalComposerInput.tsx` plugin components (`TriggerPlugin`, `KeyboardPlugin`, `MentionAtomicNavigationPlugin`, `PastePlugin`, `OnChangePlugin`, `SeedingPlugin`), each promoted to its own testable hook rather than an inline unexported component, per this package's hook/dumb-component discipline. |
| `react/hooks/useMentionColorStamping.ts` | The **replacement** for the origin's dropped brand-hue logic: a host-injected `resolveMentionColor: (mention: MentionEntity) => string \| undefined` callback, applied via Lexical's own `registerMutationListener(MentionNode, ...)` scoped to one editor instance (plus an initial restamp pass for nodes already mounted before the callback's identity changed) — not a document-wide `MutationObserver`. Sets a `--rich-text-mention-color` CSS custom property; a host's CSS reads it, this hook never writes any other style. |
| `react/hooks/useCaretFloatingLayerPosition.ts` | `CaretFloatingLayer.tsx`'s inline `reposition`/effect logic, extracted into its own hook (component stays presentational). |
| `react/components/RichTextInput.tsx` | The origin's `LexicalComposerInput` forwardRef component, generalized: `value`/`onChange`/`onTriggerChange`/`onSubmit`/`onPasteFiles`/`popoverOpen`/`onPopoverKey`/`comboboxAria`/`triggers`/`mentionTriggerId`/`resolveMentionColor`/`namespace`/`testId`/`mentionListboxId` are all host-configurable props, no OD types anywhere. The origin's `EditorRefPlugin` (a ref-bridging plugin needed only because its `forwardRef` component lived outside the `LexicalComposer` context) is dropped — the inner `EditorSurface` here is itself inside that context, so `useImperativeHandle` reads `editor` directly from `useLexicalComposerContext()`. |
| `react/components/CaretFloatingLayer.tsx` | Ported near-verbatim (a `document.body` portal positioned against a caret rect) — no OD-specific surface in the origin. |
| `index.ts` | Public barrel. |

### Scope note: a plain-text editor with atomic tokens, not a full block/marks rich text editor

The origin uses Lexical's `PlainTextPlugin` (not `RichTextPlugin`) — no
headings/bold/lists/blocks, just text + atomic `@mention`/`/command`
tokens, a single-paragraph model (Enter submits, Shift+Enter soft-breaks).
This is ported faithfully as-is; no formatting features were added since
none existed in the source, and adding them was never in scope.

### Generalization: configurable triggers, not hardcoded `@`/`/`

The origin hardcoded exactly two literal regexes (`/(^|\s)@([^\s@]*)$/`,
`/^\/([^\s/]*)$/`) inside `TriggerPlugin`/`deleteActiveTrigger`. Replaced
with a `RichTextTriggerConfig[]` (`{id, character, anchor: 'inline'|'line-start'}`)
a host supplies via `triggers` (defaulting to the origin's exact two),
with `escapeRegExpChar` guarding against a metacharacter trigger character.
`insertMention` resolves which trigger's character to delete via a
`mentionTriggerId` prop (default `'mention'`) looked up against the same
array, instead of the origin's implicit single hardcoded `@`.

### Coverage-driven dead-branch findings (Phase 9.5, not silently ported)

Four genuine dead branches were found and refactored away during the
classify-then-fix loop — none padded with a contrived test, per this
package's "never fake the number" rule:

1. `mention-parser.ts`'s `coalesceTextParts` (ported verbatim from the
   origin's `buildInlineMentionParts`): tracing `parseMentionParts`'s own
   push-guards (`match.start > copiedUntil`, `copiedUntil < text.length`)
   proves every `'text'` part it ever pushes is already non-empty, and
   each is immediately followed by that iteration's `'mention'` part — so
   `coalesceTextParts`'s merge-adjacent-and-drop-empty pass can never
   actually fire from this file's one real call site. Removed entirely
   (the origin carried the same latent dead code).
2. `rules.ts`'s `mentionBeforeCaret`/`mentionAfterCaret` trailing
   `return null` (also ported verbatim): Lexical's own `Point.set()`
   throws if a `'text'`-type point doesn't reference a `TextNode` or an
   `'element'`-type point doesn't reference an `ElementNode` (verified
   directly — a LineBreakNode point construction throws), so
   `point.getNode()` for a `RangeSelection` anchor is always one or the
   other. Replaced the trailing branch with a documented cast.
3. `useSeededValue.ts`'s `lastSeeded`-ref "StrictMode double-invoke guard"
   (also from the origin): traced through carefully, `setRichTextFromPlainText`
   commits with `discrete: true`, so by the time StrictMode's mount-only
   cleanup+re-run cycle reaches this effect a second time,
   `editor.getEditorState()` already reflects the first run's seed — the
   `value === current` check directly above already bails first. Removed;
   a real `<StrictMode>`-wrapped test confirms no double-seed regression.
4. `react/components/RichTextInput.tsx`'s `insertMention`/`replaceActiveTrigger`
   re-check of `$isRangeSelection(sel)` immediately after
   `$getRoot().selectEnd()`: `selectEnd()` always establishes a collapsed
   `RangeSelection` (even on a completely empty root), so the re-check
   can never fail. Replaced with a documented cast in both methods.
   `useMentionColorStamping.ts`'s `stampByKey` had the same shape
   (`$isMentionNode` re-check on a key already guaranteed to be a mention
   by both of its call sites) — same fix.

### i18n

This feature ships **zero hardcoded user-facing strings** — unlike every
other feature in this package, `RichTextInput`'s only text-shaped props
(`placeholder`, `title`) are entirely host-supplied, and `CaretFloatingLayer`
only renders host-supplied `children`. No `useT()` wiring applies; recorded
here explicitly per this package's policy of stating an exemption rather
than silently skipping it, not because the i18n policy was overlooked.

### Phase 9.6 (async/network test-category gate)

Not applicable — no cluster in this feature makes a network request or
holds async state (Lexical's own internal update scheduling is not a
network boundary). Recorded explicitly per the same policy.
## Section: `features/iframe-pool/` — iframe keep-alive/LRU pool (2026-07-18)

Source: `apps/web/src/components/IframeKeepAlivePool.tsx` (403 lines, real
clone at `leonaburime-ucla/open-design` commit
`0b88ef56144b5a42dc427c1292ae22676d698a34`), per this task's own brief: "cap
N mounted iframes, LRU-evict inactive ones, park the rest off-DOM," confirmed
by `foundry/docs/jini-port/god-components-extraction-plan.md`'s Consolidation map to
recur 3 times across OD's own codebase (`FileWorkspace.tsx`'s inline
browser-webview cache is the still-open third occurrence, explicitly
deferred there until this canonical implementation existed) — this task is
that canonical implementation.

**Layout:** `features/iframe-pool/{types.ts,constants.ts,rules.ts,index.ts}`
at the top level (zero React import in any of them — verified), everything
importing React under `react/` per this repo's React-layout policy:
`react/pool-context.ts` (the `createContext` call — not itself a hook or a
component, so it sits directly under `react/` rather than in `hooks/` or
`components/`), `react/dom-sync.ts` (the imperative iframe-attribute/style
diffing helpers — these import `CSSProperties` from `react` as a type, so
they live under `react/` too, per the same policy), `react/hooks/
useIframeKeepAlivePool.ts`, `react/components/{IframeKeepAliveProvider,
PooledIframe}.tsx`. No `ports.ts`/`dependencies.ts` — this feature has no
transport/network dependency (it only manages DOM iframe elements), matching
the "no ports" precedent already established for `schedule-picker`.

**Genericized key ("a generic key type instead of projectId/fileName," per
the task brief):** the origin's `PoolEntry` carried `projectId`+`fileName`
as separate fields, with `previewIframeKeepAliveKey`/`parseKeepAliveKey`
composing/decomposing them into a `projectId\0fileName` string, and an
`evictProject(projectId, options)` method built specifically around that
shape. This task replaces all of it with one opaque `key: string` per entry
(the host composes whatever string shape it needs, e.g. still
`${projectId}:${fileName}` if that's their domain) and drops
`evictProject`/`previewIframeKeepAliveKey`/`parseKeepAliveKey` entirely in
favor of the strictly more general `evictMatching(predicate, options)` (a
host wanting "evict everything for project X" passes
`(entry) => entry.key.startsWith('X:')` against whatever key scheme it
chose). `rules.ts`'s `selectLruEvictions`/`selectMatchingEvictions` are
still real TypeScript generics over `TKey` (independently reusable/testable
outside the iframe-specific runtime), even though the Provider/hook/
component layer settles on a concrete `string` key — threading a true
generic `TKey` all the way through a React Context (which can't itself carry
a type parameter without an `any`-cast escape hatch) would have bought
nothing a host couldn't already get by encoding structure into a string key,
so this task deliberately stopped short of that. Flagged explicitly here
per the "don't design for hypothetical future requirements" instinct, not
silently narrower than a literal reading of "generic key type" might imply.

**Also genericized/de-branded:** `maxEntries` → `maxMounted` (matching the
task brief's "max-mounted-count" language); the parking attribute
`data-od-active` → `data-pool-active`; `OD_PREVIEW_KEEP_ALIVE` (an exported
`process.env.OD_PREVIEW_KEEP_ALIVE`-driven toggle used by OD's own test
infra to force-disable keep-alive) — **dropped entirely**, not ported under
a new name. It read a bundler-injected env var by a hardcoded product-
specific name, which doesn't translate to "host-configurable" in a package
with no bundler/env assumptions of its own; a host that wants the pool
disabled can simply not mount `IframeKeepAliveProvider` (every `PooledIframe`
still works standalone via the per-instance fallback pool, just without the
cross-remount keep-alive benefit).

**Two real, disclosed bugs found and fixed while porting (not silently
carried over), matching this package's established "fix and disclose,
don't silently port" precedent (see the `mention-autocomplete` section
above):**

1. **`syncStyle` never appended a unit to numeric style values.** A normal
   React element auto-appends `px` to unitless numbers for style properties
   that need a length (`style={{ width: 10 }}` → `width: 10px`) via React's
   own inline-style patcher — but this component bypasses that patcher
   entirely (`frame.style.setProperty(cssKey, String(value))`), so
   `style={{ width: 10 }}` on the origin silently produced the CSS-invalid
   `width: 10` and the browser dropped it, leaving the iframe unsized. Caught
   by this task's own tests failing against jsdom's real `CSSStyleDeclaration`
   (which enforces the same length-value validity rules a real browser does)
   rather than assumed from reading the source. Fixed with a small
   `UNITLESS_NUMBER_PROPERTIES` allowlist mirroring React's own
   (`opacity`/`zIndex`/`lineHeight`/etc. stay bare; everything else numeric
   gets `px`), in `react/dom-sync.ts`'s new `styleValueToString`.
2. **Reattaching a parked (previously-released) entry never undid
   `parkIframeElement`'s markers.** `release()` sets
   `aria-hidden="true"`/`tabindex="-1"`/`data-pool-active="false"` on the
   iframe before parking it off-DOM — correct while parked — but the origin's
   `attach()` never reversed this on reuse, so a keep-alive iframe coming
   back into active use stayed hidden from assistive tech and out of tab
   order forever after its first release, defeating the point of "keep
   alive" (the whole reason to reuse the element is so it looks and behaves
   like it never went away). Caught the same way: a test asserting the
   reused element loses `aria-hidden` on reattachment failed until fixed.
   Fixed with a new `unparkIframeElement` (in `react/dom-sync.ts`), called
   from the Provider's `attach()` exactly when reusing an existing,
   currently-inactive entry.

**What ships:** `IframeKeepAliveProvider` (context + refs-based pool: attach/
release/evict/evictMatching, LRU-evicts parked entries once over
`maxMounted`, never evicts an active entry, parks released elements into a
hidden `<div>` instead of destroying them), `useIframeKeepAlivePool` (reads
the nearest Provider, or falls back to a local single-entry pool with no
LRU/limit so a standalone `PooledIframe` still works without a Provider
mounted), `PooledIframe`/`ClientPooledIframe` (an `<iframe>` that renders
plainly during SSR — real node-environment test via `renderToStaticMarkup`,
not just an assumption — and otherwise manually diffs/syncs its props onto
the pool-owned element every render instead of letting React manage it,
since remounting the real DOM node would defeat the entire keep-alive
point).

### i18n

None needed — every user-facing string surface in this feature is zero: no
rendered text, no `aria-label`/`title` default values on any exported
component (`PooledIframe`'s props pass through arbitrary iframe attributes
a *host* supplies, including any `title`/`aria-label` the host chooses, but
this feature itself introduces none). Noted explicitly per the i18n policy
rather than silently skipped.

### Phase 9.6 (async/network test-category gate)

Exempt, stated explicitly rather than skipped silently: this feature has no
network requests and no async state of its own (iframe `src`/`onLoad` are
host-supplied passthrough props, not something this feature awaits or
parses a response from).

### Purity grep

`grep -rniE 'open.?design|\bOD_|--od-stamp|/tmp/open-design'` across
`packages/ui/src/features/rich-text-input/`: **clean, zero matches.**

### Test / typecheck / coverage / guard results

- `pnpm --filter @jini/ui run typecheck`: clean, zero errors, full package.
- This feature's own test run (`npx vitest run src/features/rich-text-input`):
  **20 test files, 242 tests, all green.**
- Per-file coverage (`vitest run --coverage`, `json-summary`+`json`
  reporters): **100% statements/branches/functions/lines on every single
  file in this feature** (`constants.ts`, `deserialize.ts`, `mention-node.ts`,
  `mention-parser.ts`, `rules.ts`, `serialize.ts`, both components, all 8
  hooks, the test-only `lexical-harness.tsx` support file, and `index.ts`
  via a barrel smoke test) — `types.ts` excluded per the documented
  zero-executable-statement carve-out (verified). Reached via the full
  Phase 9.5 classify-then-fix loop; the four dead branches above were
  refactored away, everything else reachable got a real test (including a
  `// @vitest-environment node` companion for `readCaretRect`'s
  `typeof window === 'undefined'` guard). Zero `/* v8 ignore */` anywhere.
  Real DOM-dispatched-event tests (Phase 9's mandatory bar, not just
  `dispatchCommand` calls) cover Enter/ArrowDown/Backspace/paste on the
  mounted `RichTextInput`, per the retained-behavior manifest for
  keyboard/paste interactions.
- **Full `@jini/ui` package** (`npx vitest run --coverage`, excluding
  `features/html-viewer/**` and the root `src/index.test.ts` barrel — see
  the caveat below): **258 test files, 2747 tests, all green**, aggregate
  **94.4% statements / 94.59% branches / 94.48% functions / 94.4% lines**
  — this task's own 18 files are 100%; the remainder is pre-existing debt
  already catalogued in prior sections of this file, not re-itemized here.
  **Caveat**: `features/html-viewer/`'s tests (and the root barrel that
  re-exports it) fail to even load in a fresh session because
  `@jini/renderers-react`'s built `dist/registry.js` imports
  `@jini/chat-core`, whose own `dist/` is gitignored and not built by
  default (`pnpm --filter @jini/chat-core build` fixes it locally but
  doesn't persist across a fresh clone) — this is pure environment/build-order
  fragility, not a code regression (`html-viewer`'s own prior section
  reported 160 files/1441 tests all green when its dist happened to
  already be built); flagged here rather than silently worked around.
- `pnpm guard` (repo root): `[guard] ok (skeleton — rules pending
  implementation during extraction)` — no boundary violations introduced.
- `pnpm -r run typecheck` (full monorepo): fails only at
  `packages/diagnostics` (missing `jszip` dependency) — pre-existing,
  unrelated to this task.

### What was deliberately not attempted

Nothing from the five source files was dropped silently — every piece
r5/r6's own recon and this task's brief named (editor setup/config,
mention-node type, caret-floating-layer positioning, serialize/deserialize,
keyboard/paste/atomic-navigation plugins) shipped, tested, and is
behaviorally verified, not just visually similar. The only intentional
omissions are the OD-specific brand-color computation itself (replaced by
the host-injected `resolveMentionColor` seam, per the task brief) and the
origin's hardcoded `'chat-composer'` Lexical namespace string (now a
`namespace` prop, defaulting to `'rich-text-input'`).
`packages/ui/src/features/iframe-pool/`: **clean, zero matches.**

### Test / typecheck / coverage results

- `pnpm --filter @jini/ui run typecheck`: green, zero errors, full package.
- New feature's own test run (`npx vitest run src/features/iframe-pool
  --coverage`): **7 test files, 50 tests, all green**, **100% statements/
  branches/functions/lines on every file** (`constants.ts`, `rules.ts`,
  `index.ts`, `react/pool-context.ts`, `react/dom-sync.ts`, both components,
  the hook — `types.ts` excluded per the documented zero-executable-
  statement carve-out, verified via the standard grep and added to
  `vitest.config.ts`'s exclude list alongside the existing
  `list-detail-panel`/`settings-dialog`/`html-viewer` carve-outs). Reached
  via the Phase 9.5 classify-then-fix loop: two branches
  (`PooledIframe.tsx`'s `if (!host)`/`if (!frame)` guards) were refactored
  away as genuinely dead (both refs are populated synchronously during the
  same commit, before either effect can run, by the same argument already
  established for `IframeKeepAliveProvider`'s `parkedHostRef` — see the
  non-null-assertion comments at each site) rather than tested around; every
  other gap was a real reachable path (an unattached-key no-op for
  `release`/`evict`, `evictMatching`'s `includeActive` true/false split, the
  LRU-vs-never-evict-active interaction) that got a real test. No
  `/* v8 ignore */` used anywhere.

## Section: `features/command-palette/` (`CommandPalette`, from `QuickSwitcher.tsx`) (2026-07-18)

Source: `apps/web/src/components/QuickSwitcher.tsx` (330 lines) +
`apps/web/src/quickSwitcherRecents.ts` (33 lines), real clone at
`leonaburime-ucla/open-design` commit `0b88ef56144b5a42dc427c1292ae22676d698a34`.
A full-screen Cmd/Ctrl+P file-and-tab palette: substring+prefix fuzzy scoring,
arrow-key cursor navigation with wraparound, IME-composition-aware key
handling, recents-first empty-query ordering.

**Not re-litigated, per the task brief:** `foundry/docs/jini-port/god-components-
extraction-plan.md`'s "5 more overlaps" list names `QuickSwitcher.tsx` as
one of three "type a trigger character, get a filtered picker" shapes,
alongside `MentionAutocomplete` (already shipped) and the Lexical `@mention`
system. `packages/ui/source-map.md`'s `mention-autocomplete` section (search
"QuickSwitcher" — the "3-way overlap" note) already did the side-by-side
read and concluded `QuickSwitcher` is a distinct shape (an already-open,
single-purpose fuzzy-match palette with keyboard-cursor selection — no
inline-textarea trigger detection, no tabbed multi-category grouping, no
removable-chips multi-select) and should get its own extraction. This task
is that extraction, built as its own primitive rather than folded into
`mention-autocomplete/` — the prior conclusion held up on a second read of
the actual source and was not revisited.

**Genericized:** the origin's `QuickSwitcherResult` discriminated union
(`{ kind: 'tab', context: WorkspaceContextItem }` vs.
`{ kind: 'file', file: ProjectFile }`, each with its own path/title/kind-
label derivation) collapses into one flat `CommandPaletteItem` (`id`, `name`,
`kind: string`, optional `mtime`/`path`/`title`/`keywords`) — the task
brief's own target shape. This is a real simplification, not just a rename:
the origin derived a row's subtitle/tooltip/kind-label differently per kind
(a `workspaceContextKindLabel` switch mapping 9 OD-specific kind strings to
English labels for tabs; `baseName`/`dirName` path-splitting for files); the
generic version instead expects the **host** to resolve `name`/`path`/`title`
into their final display strings before handing items to the palette, and
just displays `kind.toUpperCase()` as a plain badge. The origin's
`quickSwitcherRecents.ts` (`od:qs-recents:<projectId>` keys) becomes a real
`CommandPaletteRecentsPort` (`ports.ts`) + a real `localStorage`-backed
implementation (`dependencies.ts`, namespace `jini:command-palette:recents`,
matching `features/browser-chrome`'s history-storage precedent of shipping
a real implementation rather than a fake, since it only touches generic
browser APIs) — recents are now keyed by an opaque host-supplied `scopeKey`
(replacing `projectId`) and by `item.id` (replacing file `name`).

**Scoring, disclosed simplification:** the origin ran two different scoring
functions — `scoreMatch` (basename/full-name tiers for files) and
`scoreWorkspaceContextMatch` (a 5-field string-concatenation search plus an
exact-kind-match tier, for tabs). With one unified item shape, this task
ships one `scoreItemMatch` scoring `item.name` (exact/prefix/substring tiers)
plus a lower-tier substring match against an optional `keywords` field
(replacing the tab-specific multi-field concatenation with a host-supplied,
generic "extra searchable text" slot). The origin's separate "kind exactly
matches the query" tier (used only for tabs) is dropped — a minor, disclosed
behavior narrowing in service of one scoring function instead of two
kind-specific ones.

**Dropped:** the `motion/react` (framer-motion) entrance/exit animation
(`modalOverlay`/`scaleIn` variants) — this package has no existing
framer-motion dependency, and no other feature here uses one for an overlay/
popover (`mention-autocomplete`, `schedule-picker`, `settings-dialog` all use
plain CSS). Adding a net-new animation-library dependency for a decorative
concern this component's own genericization doesn't require felt like scope
creep; the overlay/palette `<div>`s keep the same class-name structure so a
host can layer its own CSS transitions on top if it wants them.

**What shipped:** `types.ts` (`CommandPaletteItem`, `CommandPaletteResult`),
`constants.ts`, `rules.ts` (`scoreItemMatch`, `rankItems` — the origin's
`matches` useMemo logic as a pure function, `nextCursor` ported verbatim,
`parseRecentIds`/`pushRecentId` — the origin's recents JSON parsing/pushing,
extracted to pure functions for direct testing rather than living inline in
the localStorage adapter), `ports.ts` + `dependencies.ts`
(`CommandPaletteRecentsPort` + `createLocalStorageRecents`),
`react/hooks/useCommandPalette.ts` (+ `useWiredCommandPalette` production
wirer, mirroring `useBrowserHistory`/`useWiredBrowserHistory`'s pattern) —
owns query/cursor state, ranking, recents tracking, and the IME-aware
keyboard handler — `react/components/{CommandPaletteRow,CommandPalette}.tsx`,
`index.ts` barrel.

### i18n

Every user-facing string (`Search…` placeholder default, `No matches`/
`No items` empty states, `Navigate`/`Select`/`Close` footer hints) routes
through `useT()`, English string as key per this package's i18n policy (the
origin's namespaced `quickSwitcher.*` keys are not carried over — the
convention here is the English string itself as the key). `rules.ts` stays
hook-free by design; it doesn't produce any user-facing text itself. A real
test mounts `CommandPalette` under `I18nProvider` with a French dictionary
and asserts the translated placeholder and all three footer hints render
(not just that `t()` compiles).

### Purity grep

`grep -rniE 'open.?design|\bOD_|--od-stamp|/tmp/open-design'` across
`packages/ui/src/features/command-palette/`: **clean, zero matches.**

### Test / typecheck / coverage results

- `pnpm --filter @jini/ui run typecheck`: green, zero errors, full package.
- New feature's own test run (`npx vitest run src/features/command-palette
  --coverage`): **6 test files, 60 tests, all green**, **100% statements/
  branches/functions/lines on every file** (`types.ts`/`ports.ts` excluded
  per the documented zero-executable-statement carve-out, verified via the
  standard grep and added to `vitest.config.ts`'s exclude list). Real tests
  cover the required fuzzy-scoring/cursor-wraparound edge cases explicitly:
  empty query, no matches, a single match, and wraparound in both directions
  (`nextCursor` at index 0 going backward and at the last index going
  forward), plus a zero-/negative-total guard and a single-item-list case.
  One jsdom gap needed a small polyfill (`Element.prototype.scrollIntoView`,
  unimplemented in jsdom — same gap already polyfilled elsewhere in this
  package's `useResizableSplitPane.test.tsx`), not a source change.

## Section: `features/tab-launcher-menu/` (`TabLauncherMenu`) (2026-07-18)

Source: `apps/web/src/components/workspace/TabLauncherMenu.tsx` (461 lines) +
`apps/web/src/components/workspace/tab-launcher.ts` (137 lines), real clone
at `leonaburime-ucla/open-design` commit `0b88ef56144b5a42dc427c1292ae22676d698a34`.
An anchored, portal-rendered command-palette dropdown for a tab strip's "+"
button: viewport-clamped fixed positioning off an anchor element, outside-
click/Escape dismiss, text search + kind-filter over file results, a
separate always-searchable-unless-filtered tab-result list, and a "create
new" action list, all folded into one flat keyboard-navigable selection.

**`features/tab-strip/` does not exist on this branch — a documented
discrepancy, not silently assumed away.** The task brief for this item said
to "read [`features/tab-strip/`] first to confirm this is a distinct
concern" before building this feature, on the premise that it was already
shipped from `WorkspaceTabsBar.tsx`/`FileWorkspace.tsx` per the
Consolidation map's `features/tab-strip/` row. Checked directly: `ls
packages/ui/src/features/` on this branch (`feature/jini-ui-small-atoms-
batch`, based on `origin/main`) lists `asset-grid, asset-tree-browser,
browser-chrome, connectors, html-viewer, i18n, list-detail-panel, memory,
mention-autocomplete, observability, progress-card, schedule-picker,
settings-dialog, sketch-editor, version-manager, viewer-shell` — no
`tab-strip` and no other `tab-*` feature. This mirrors the exact shape of
the already-recorded `features/progress-card/` discrepancy earlier in this
file (a plan doc claiming something shipped that isn't actually present in
this checkout) — flagged here per that same precedent rather than either
blocking on it or silently proceeding as if the comparison had happened.
Since there was nothing to compare against, this task built
`TabLauncherMenu` as its own self-contained primitive per the task brief's
own fallback description ("the anchored launcher dropdown, not the tab strip
itself" — a real, distinct interaction regardless of whether `tab-strip`
exists yet: an anchored positioned dropdown+search+actions widget is not a
horizontal tab-strip-with-drag-reorder widget under any reading). A future
task landing `features/tab-strip/` should re-check this pairing once both
exist side by side.

**Genericized:** the origin's `Props` (`files: ProjectFile[]`,
`workspaceContexts?: WorkspaceContextItem[]`, `actions: LauncherAction[]`,
`launcherContext: LauncherContext`, `onTrack?: (input:
TabLauncherTrackInput) => void` off the OD analytics contract
`TabLauncherClickProps`) collapses into: one generic `TabLauncherResultItem`
(`id`, `name`, `kind: string`, optional `meta`/`isOpen`/`iconName`) shared by
both the file list and the tab list — the host pre-formats `meta` (the
origin's separate `formatBytes`/`formatRelativeTime`/`kindLabel`/
`workspaceContextKindLabel`/`workspaceContextMeta` helpers are all dropped;
none of that OD-specific formatting logic is generic); `TabLauncherAction
<TActionCtx>` generic over whatever context a host's actions need to run
against (replacing the OD-specific `LauncherContext`'s `projectId`/
`createTerminal`/`createBrowser`/`createSketch`/`createDocument`/
`uploadDesignFiles` fields — a host now supplies its own `TActionCtx` shape
and an `actionContext` value, and the action's `run(ctx)` receives it
structurally, no baked-in "what a tab kind is" vocabulary); a generic
`TabLauncherTrackEvent` discriminated union (`open`/`filter`/`select-file`/
`select-tab`/`run-action`) replacing the OD-specific `TabLauncherClickProps`
analytics contract (`@open-design/contracts/analytics`) — same "fire an
event, host fills in its own product/page context" mechanism, generic event
shape. Icons: rather than depending on this package's own `Icon` component's
fixed `IconName` union (which doesn't have a natural mapping for arbitrary
host-defined `kind`/action `iconName` strings), rows accept an optional
`renderIcon?: (iconName: string | undefined) => ReactNode` slot — a host
using `@jini/ui`'s `Icon` can trivially wire `renderIcon={(name) => <Icon
name={name as IconName} />}`, but the feature itself stays icon-set-agnostic.

**Kind-filter chips, disclosed simplification:** the origin's
`kindLabel(kind, t)` maps each `ProjectFileKind` to a translated English
label for its chip ("Images", "Code", …). With `kind` now a plain host-
defined string (no fixed enum), chips just display the raw `kind` value —
a host that wants a nicer label formats it into the value it passes as
`kind` itself, or (a real future option, not attempted here) wraps
`TabLauncherMenu` with its own label-mapping layer.

**What shipped:** `types.ts` (`TabLauncherResultItem`, `TabLauncherAction
<TCtx>`, `TabLauncherTrackEvent`, `TabLauncherPosition`,
`TabLauncherAnchorRect`, `TabLauncherSelection`), `constants.ts`, `rules.ts`
(`clampAnchoredPosition` — the origin's inline anchor-rect positioning math,
extracted pure; `presentKinds`, `filterFiles`, `filterTabs` — the origin's
`results`/`tabResults`/`presentKinds` `useMemo`s as pure functions;
`clampSelection`, `nextSelected` — the origin's inline selection-clamp
effect and modulo-wraparound arrow-key math, extracted pure;
`resolveSelection` — the origin's inline `results[selected] ?? …` / `selected
- results.length` split, extracted pure), `react/hooks/
useTabLauncherMenu.ts` (owns anchored positioning recalculated on scroll/
resize, outside-click/Escape dismissal via the shared `useDismissOnOutsideOrEscape`
hook from `packages/ui/src/browser/` — checked for an existing equivalent
before hand-rolling a second listener pair, per this task's own "check for
overlap" instruction, matching the precedent already noted in this file's
`schedule-picker` section — search/kind-filter state, and the flat
file+tab+action keyboard-navigation handler), `react/components/
{TabLauncherResultRow,TabLauncherActionRow,TabLauncherMenu}.tsx` (the
orchestrator is a generic `TabLauncherMenu<TActionCtx>`, portal-rendered to
`document.body`), `index.ts` barrel.

### i18n

Every user-facing string (`Search files…` placeholder default, `All files`
chip, `Create new`/`Open file`/`Open tabs` section headers, `Open` badge,
`No files match` empty state, the `New tab` dialog `aria-label`) routes
through `useT()`, English string as key per this package's i18n policy —
the origin's namespaced `workspace.*` keys are not carried over. `rules.ts`
stays hook-free by design. A real test mounts `TabLauncherMenu` under
`I18nProvider` with a French dictionary and asserts the translated
placeholder and section headers render.

### Purity grep

`grep -rniE 'open.?design|\bOD_|--od-stamp|/tmp/open-design'` across
`packages/ui/src/features/tab-launcher-menu/`: **clean, zero matches.**

### Test / typecheck / coverage results

- `pnpm --filter @jini/ui run typecheck`: green, zero errors, full package.
- New feature's own test run (`npx vitest run src/features/tab-launcher-menu
  --coverage`): **6 test files, 63 tests, all green**, **100% statements/
  branches/functions/lines on every file** (`types.ts` excluded per the
  documented zero-executable-statement carve-out, verified via the standard
  grep and added to `vitest.config.ts`'s exclude list). One real hook bug
  caught by the test suite itself before it shipped: an early draft of
  `useTabLauncherMenu.test.ts` created a fresh anchor element *inside* the
  `renderHook` callback for several cases — since that callback re-runs on
  every render, a fresh anchor each time changed the positioning effect's
  `[anchor]` dependency every render, causing "Maximum update depth
  exceeded" (an infinite `setPosition` loop). Not a source bug — the hook's
  own `[anchor]`-keyed effect is correct — but recorded here since it's
  exactly the kind of test-authoring mistake that would otherwise ship a
  false "the component itself is unstable" signal; fixed by hoisting the anchor
  element outside the `renderHook` callback in every affected case.

## Section: `DesignSystemFlow.tsx`'s remaining pieces — `features/revision-review/` + flat `TokenChip`/`ValueChip`/`ComponentKitPreview` (2026-07-18)

Source: `apps/web/src/components/DesignSystemFlow.tsx` (5,439 lines), real
clone at `leonaburime-ucla/open-design` commit
`0b88ef56144b5a42dc427c1292ae22676d698a34` — already partially mined for
`features/progress-card/` (`WorkspaceActivityCard`/`GenerationStatusCard`)
and `utils/color-math.ts` (hex/RGB/luminance/mix primitives). This task
mines its two remaining pieces named in the task brief.

### 1. `features/revision-review/` (`RevisionDiffCard` + `RevisionHistoryList`)

A generic "proposed change review" widget: a diff/proposed-body preview with
accept/reject actions, plus a status-badged revision history list. Per
`foundry/docs/jini-port/god-components-extraction-plan.md`'s `features/progress-
card/` row, r6 flagged these as "conceptually related" to the progress-card
family ("status-badged... progress bar + status icon") but "not confirmed
identical, still worth evaluating together before extracting either" — this
task read both shapes side by side (`ProgressCard`'s status-icon-plus-
progress-bar-plus-step-list vs. this widget's feedback-plus-diff-plus-
accept/reject-plus-history-list) and confirmed they're genuinely distinct:
`ProgressCard` renders an in-flight run's step-by-step state with a
determinate/indeterminate progress bar; this widget renders a completed
proposal awaiting a binary accept/reject decision, with no progress bar or
step list at all. Built as its own feature per the task brief's own
instruction, not folded into `progress-card`.

**Genericized:** the origin's `DesignSystemRevision` (from
`@open-design/contracts`) becomes `RevisionReviewItem<TMeta = unknown>` —
every field the widget actually reads (`status`/`feedback`/`baseBody`/
`proposedBody`/`createdAt`/`updatedAt`/`sectionTitle`/`fileChanges`) is
generic already; `TMeta` is the type-parameter escape hatch the task brief
asked for, letting a host attach whatever extra identity it needs
(`designSystemId`/`jobId` in the origin) without this feature reading or
caring about it.

**A real, disclosed duplication caught and unified:** the origin has two
functions, `revisionAddedText` (diffing `revision.baseBody`/`proposedBody`)
and `revisionFileAddedText` (diffing a file change's `baseContent`/
`proposedContent`) — byte-for-byte identical bodies (longest-common-line-
prefix, then the proposed side's remaining lines, trimmed), just applied to
two different field pairs. Unified into one `diffAddedLines(baseText,
proposedText)` in `rules.ts`, called from both call sites in
`RevisionDiffCard`, rather than porting the duplication forward.

**What shipped:** `types.ts` (`RevisionReviewStatus`, `RevisionReviewFileChange`,
`RevisionReviewItem<TMeta>`), `rules.ts` (`diffAddedLines`,
`formatRevisionTimestamp` — the origin's `formatDateTime`, a thin
`Intl`/`Date` wrapper with no i18n-key text so it stays a plain util rather
than routing through `useT()`), `react/components/{RevisionDiffCard,
RevisionHistoryList}.tsx` — both fully controlled/presentational (accept/
reject/history are host-driven via props; neither the origin nor this port
holds any internal state), `index.ts` barrel. No `ports.ts`/`dependencies.ts`
— no transport dependency, matching the `schedule-picker`/`iframe-pool`
"no ports" precedent already established in this file.

### 2. Flat `react/components/{TokenChip,ValueChip,ComponentKitPreview}.tsx`

`DesignMdTokenChip`/`DesignMdValueChip`/`DesignMdComponentKitPreview` — a
color-swatch chip, a plain-value chip, and the theme-toggle-driven style-
guide preview panel that renders both. Renamed to drop the origin's
`DesignMd`-prefixed internal naming (OD's own "design.md" spec-format
jargon) per this task's naming-discipline instruction — `TokenChip`/
`ValueChip`/`ComponentKitPreview` describe what they render, not OD's
internal vocabulary for it.

**Token source genericized to host-injected data, per the task brief:** the
origin took a raw `markdown: string` prop and parsed it internally via
`buildDesignMdPreviewModel` → `parseDesignMd` (OD's own "design.md" spec-
format parser) into the token model the preview actually renders.
`ComponentKitPreview` instead takes that already-resolved
`ComponentKitPreviewTokens` model directly as a prop — the markdown-parsing
pipeline is OD product-specific logic and is not ported, matching the
call already made and documented in this file's color-math section ("what
was deliberately left behind: the OD-specific color-selection heuristic
that consumes the math, not the math itself"). `buildDesignMdPreviewModel`'s
internal heuristic (`findPreviewColor`/`firstNonNeutralColor` role-matching
by keyword against color labels) is exactly that heuristic, so it stays
behind for the same already-established reason, not re-litigated here.

**A duplicate-primitive check that paid off:** before writing any color
math for this component, checked `packages/ui/src/utils/color-math.ts`
(this task's own required step, per the "check for an existing equivalent"
audit lesson) — it already ports `normalizeHex`/`hexToRgb`/`luminance`/
`mixHex`/`toHexByte`/`readableTextColor`, which are exactly
`buildDesignMdPreviewModel`'s local `normalizePreviewHex`/`previewRgb`/
`previewLuminance`/`mixPreviewHex`/`toHexByte`/`readableTextColor` under
different names (same origin file, ported in an earlier task). Every real
color-math need `ComponentKitPreview` has (deriving `primaryText` via
`readableTextColor`) is met by importing the existing util — nothing was
re-derived.

**What shipped:** `TokenChip`/`ValueChip` (flat, zero-prop-surface color/
value chip atoms) and `ComponentKitPreview` (the light/dark-switchable
preview stage + button/type-scale specimen + the token-chip row underneath)
in `packages/ui/src/react/components/` — this branch's base still has the
old flat `src/components/` (rename not yet merged), and these three are new
atoms alongside `EditorIcon` already added there this session, so they land
in `react/components/` too per this task's own path-convention instruction.

### i18n

Every user-facing string in all five new components (`RevisionDiffCard`,
`RevisionHistoryList`, `ComponentKitPreview`) routes through `useT()`,
English string as key. `TokenChip`/`ValueChip` have no user-facing text of
their own beyond a caller-supplied `label`/`value`/`hex`, so nothing to
wrap there. `rules.ts` stays hook-free by design in both new areas. Every
component with real translatable text has a test mounting it under
`I18nProvider` with a translated dictionary and asserting the translated
text renders.

### Purity grep

`grep -rniE 'open.?design|\bOD_|--od-stamp|/tmp/open-design'` across
`packages/ui/src/features/revision-review/` and
`packages/ui/src/react/components/{TokenChip,ValueChip,ComponentKitPreview}.tsx`
(+ tests): **clean, zero matches.**

### Test / typecheck / coverage results

- `pnpm --filter @jini/ui run typecheck`: green, zero errors, full package.
- `revision-review`'s own test run (`npx vitest run src/features/revision-
  review --coverage`): **4 test files, 22 tests, all green**, **100%
  statements/branches/functions/lines on every file** (`types.ts` excluded
  per the documented zero-executable-statement carve-out, added to
  `vitest.config.ts`'s exclude list).
- The three flat atoms' own test run (`npx vitest run
  src/react/components/{TokenChip,ValueChip,ComponentKitPreview}.test.tsx
  --coverage`): **3 test files, 9 tests, all green**, **100% on all 4
  metrics** for all three files.
- Full `@jini/ui` package (`npx vitest run`): **275 test files, 2791 tests,
  all green** — no regression in any pre-existing test.
- `pnpm guard` (repo root): `[guard] ok (skeleton — rules pending
  implementation during extraction)` — no boundary violations introduced.

## Section: `features/rich-text-input/` renamed to `features/lexical-rich-text-editor/` (2026-07-26)

**Why:** a second, TipTap-based rich-text editor feature is being added as a
sibling in a follow-up dispatch. `rich-text-input` named the *kind* of thing
(a rich-text input) rather than *which* engine backs it, so once a second
engine existed under `features/`, the old name would have been ambiguous
between the two. The new name states the engine (Lexical) the same way a
future TipTap sibling would state its own.

**What moved:** `git mv packages/ui/src/features/rich-text-input/ →
packages/ui/src/features/lexical-rich-text-editor/` — directory contents,
all files, and git history unchanged; purely a path rename, no behavior
change. Every entry above this one that mentions `features/rich-text-input/`
describes the tree **as it existed on the date of that entry** and is left
as-is — this is the only entry that should be read as "the directory has
since moved."

**What did not move:** the public component name `RichTextInput`, the
`RichTextTriggerConfig`/`RichTextTriggerAnchor`/`RichTextTriggerMatch`/
`RichTextInputHandle` types, and the `--rich-text-mention-color`-style CSS
custom property naming convention are unchanged. Those names describe the
*component's* public API, not the feature directory, and the task that did
this rename was explicitly instructed not to touch them. Internal
component-scoped strings that mirror the component name rather than the
directory (the `rich-text-input` Lexical namespace default, the
`rich-text-input`/`rich-text-input-editable`/`rich-text-input-placeholder`
CSS class names, the `[rich-text-input]` console-error tag, and the
`DEFAULT_TEST_ID`/`getByTestId('rich-text-input')` pair) were left alone for
the same reason.

**Updated for the rename:** every relative import inside the moved directory
was untouched (git mv preserves internal relative structure); the package
was checked and does **not** re-export this feature from
`packages/ui/src/index.ts`, so no barrel edit was needed there.
`packages/ui/vitest.config.ts`'s coverage-exclude comment/path for
`types.ts` and `packages/ui/README.md`'s "Internal structure"/"Status"
mentions of the directory were updated to the new name.

**Left for the dispatching agent to handle, out of this package's scope:**
`packages/chat-react/src/agent-bridge/dom-page-driver.ts`'s doc comment
(verified 2026-07-26, referencing `packages/ui/src/features/rich-text-input/`
by path in prose) mentions the old path and was not edited — `chat-react` is
owned by a sibling agent concurrently, per this task's scope rule.
