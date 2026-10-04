# Source rationale retained

## ProvidersTab.tsx

/**
 * @file The Providers tab — `SourceControl.tsx`'s one tab today, and this feature's actual content.
 * Three always-visible rows — GitHub, GitLab, Bitbucket, in that order (GitHub is the one that
 * matters; the other two are real connectable rows, not "coming soon" stubs) — never a second-level
 * tab bar of their own. Moved here verbatim out of `SourceControl.tsx` in the 2026-08-16 page-shell
 * pass — see that file's own header for why the row content did not change, only what wraps it.
 *
 * ## No outer `.card` — owner-corrected the same pass
 *
 * The first cut of this file wrapped the row list in its own `.card` (icon + "Providers"
 * `card-title`) sitting under the `TabBar`. Owner's direct read: that is a card inside a card inside
 * a tab — each `.source-control-row` below is ALREADY its own bordered surface, so a second
 * bordered/background box around the whole list added a layer of chrome with no content of its own.
 * `features/pages/Pages.tsx` (a real `TabBar`-driven list screen) never wraps its rows in a card
 * either — `.card` there is reserved for an EMPTY state, not the populated list — so this tab now
 * matches that: the rows render directly under the tab, no enclosing card. `SourceControlIcon`
 * (`source-control-visuals.tsx`) lost its only call site here and is currently unused; left defined
 * rather than deleted in case a later pass finds it a home.
 *
 * ## Second density pass (2026-08-16) — an accordion, not three open forms
 *
 * The page-shell pass above shipped, the owner looked at it twice, and both times called it "a wall
 * of text" — the same complaint `deployment/StaticSiteTab.tsx`'s own "seventh pass" doc records for
 * the identical symptom (all four of ITS providers' full credential forms rendering at once). That
 * file's fix was a tab bar showing one provider's fields at a time; this page has no per-provider tab
 * bar by deliberate, still-standing decision (see the top of this file), so the equivalent fix here
 * is a native accordion: every row — connected or not — now renders behind `<details
 * name="source-control-provider">`. The shared `name` makes the three rows one EXCLUSIVE group
 * (Baseline since 2024 — Chrome 120, Safari 17.4, Firefox 129): opening one closes whichever other
 * row was open, no click handler or React state involved, so it stays presentation-layer.
 * {@link firstUnconnectedProviderId} decides which row starts open — the first one still needing a
 * token — so a first-time visitor already sees the one form they came to fill in, not three, and the
 * open row naturally advances to the next unconnected provider once the current one saves. This
 * supersedes {@link SourceControlRowTodo}'s old "always open, there is nothing to disclose FROM here"
 * reasoning (removed, not merely extended) — with three rows open at once that reasoning was exactly
 * what produced the wall the owner flagged twice.
 *
 * The per-row subtitle ("Save a personal access token so the host can use this account.") was identical
 * on all three rows and added nothing the heading plus the "Access token" field label didn't already
 * say — cut, along with its now-orphaned translation key across all 21 locale dictionaries. The
 * scope-guidance sentence stays exactly as owner-narrowed on 2026-08-15 (`rules.ts`'s own header) —
 * cutting ITS words was never the ask, only its default visibility — so it now sits behind its own
 * small nested "Which token do I need?" `<details>` inside {@link SourceControlCredentialFields},
 * reachable in one click rather than always-rendered.
 *
 * ## Two defects this page was briefed NOT to inherit
 *
 * 1. A connected/collapsed row needs a VISIBLE expand affordance — a text label plus a chevron —
 *    never a bare clickable row. See {@link SourceControlRowSummary}'s own doc.
 * 2. A saved-credential timestamp says "saved," never "updated" — "updated" falsely implies the
 *    token was recently re-verified, and a revoked token still shows that same timestamp. No
 *    token-liveness indicator is shown anywhere on this page either, for the same reason.
 *
 * This tab reuses `deployment/StaticSiteTab.tsx`'s `PublishCredentialFields` VISUAL pattern
 * deliberately (connected/not-connected split, same hint-below-input idiom) but owns no code
 * dependency on `features/deployment/` — two different agents were building the two features in the
 * same session, and this page's own icons (`source-control-visuals.tsx`), CSS
 * (`styles/source-control.css`), and hook plumbing are drawn fresh rather than imported
 * cross-feature.
 */

/** DI seam for tests — same convention as every other wired-hook prop in this app
   *  (`StaticSiteTabProps.usePublishCredentialsHook`). */

/** Resolves {@link ProvidersTabProps}'s one DI seam to its real hook when a caller passes none —
 *  same small-resolver shape `deployment/StaticSiteTab.tsx`'s `resolvePublishCredentialsHook`
 *  documents (a resolver counts one branch here rather than an inline `??` counting against the
 *  component body's own complexity budget). */

/**
 * Cross-link to the Access Tokens tab on the Security page — the same "ONE credential home" pattern
 * `deployment/StaticSiteTab.tsx`'s own `ManageAccessTokensLink` documents (2026-08-16 owner ruling,
 * `ADS-memory/reports/2026-08-17-source-control-ui.md`: "Security → Access Tokens is the ONE
 * credential home. Source Control keeps only real source hosts; Static Site picks a saved
 * credential."). The three rows above still handle the common case inline (one token per provider,
 * paste-and-save) — this is the escape hatch to what only Security's Access Tokens tab can do: save a
 * SECOND named token for GitHub/GitLab/Bitbucket, rename one, or manage every credential this install
 * holds (including the four publish providers) in one place.
 *
 * Deliberately NOT a 7-`VendorId` picker — a picker built from `VendorId` would list Netlify/Vercel/
 * Cloudflare/S3 as places to keep SOURCE CODE, which they are not; this page's own three rows
 * (the source-control hosts plugins declare, `rules.ts`'s `sourceControlProviders`) are the correct,
 * narrower provider set for what this page actually does.
 * @complexity O(1) — no branches.
 */

/** The host rows — loading/error states, then one row per listed host (and per saved connection's
 *  unlisted host). Split out of {@link ProvidersTab} purely for the complexity gate, same reasoning every
 *  other per-section split in this app documents: this repo's real `apps/admin` ESLint gate is a
 *  hard 9/9 cyclomatic/cognitive ceiling, and the loading/error branches plus the `.map()` counted
 *  directly in the tab component would have pushed it over budget alongside the header markup. */

/** The first listed host still missing a saved connection, in row order —
 *  the one row {@link SourceControlProviderRow} defaults open. `undefined` once every provider is
 *  connected, matching every row starting collapsed (this file's own header explains why an
 *  accordion exists at all). Pure and React-free like this page's `rules.ts` helpers, but kept here
 *  rather than moved there: this decides a disclosure default, a presentation choice, not a fact
 *  about a credential — `rules.ts` stays the file with no opinion about what is open on screen.
 *  @complexity O(n) in the fixed, size-3 provider list. */

/**
 * One provider's row — a native `<details name="source-control-provider">`, connected or not, so
 * the three rows form one exclusive accordion group (this file's own header explains why). Replaces
 * the old {@link SourceControlRowTodo}/{@link SourceControlRowDone} split: both states now share this
 * one shell, differing only in the marker glyph and {@link SourceControlRowSummary}'s content —
 * mirrors `PublishCredentialsSection`'s single-row-at-a-time shape in `deployment/StaticSiteTab.tsx`,
 * built for the identical density complaint.
 *
 * `open={defaultOpen}` is intentionally uncontrolled: React sets it once per computed value and
 * otherwise leaves the DOM alone (it never re-asserts a prop that hasn't itself changed), so a
 * reader's own manual expand/collapse clicks survive re-renders of sibling rows — typing a token
 * into THIS row does not fight the accordion state of another.
 *
 * ## Seam for the not-yet-built "reuse the publish token" affordance
 *
 * 2026-08-16 owner decision: when a not-yet-connected row's provider already has a matching
 * Deployment publish credential saved (checked directly against the database this session — e.g.
 * `publish_credential_sets` already has a `github-pages` row for a workspace whose
 * `source_control_credential_sets` is empty), this row should offer a one-click "reuse that
 * credential" path instead of asking the operator to paste the same token twice. NOT built here —
 * it needs a server-side read across both credential stores plus a decrypt-and-reseal from one
 * sealed store into the other, both squarely outside this feature's fence (`lib/api.ts` wire types,
 * `src/**`). Dispatched separately.
 *
 * The affordance's insertion point, once that data exists: directly below {@link
 * SourceControlRowSummary}, ABOVE {@link SourceControlCredentialFields} — same "settled fact first,
 * fields second" order the connected summary already establishes, so a reader sees "a GitHub Pages
 * credential already exists" before being asked to type a new token into the fields underneath. It
 * needs to read, per provider, from the controller: whether a matching publish credential exists,
 * and when it was saved (same shape `AdminSourceControlCredentialSummary.updatedAt` already carries
 * for THIS store's own rows) — `SourceControlCredentialsController`/`useSourceControlCredentialsHook`
 * (`hooks/use-source-control-credentials.hooks.ts`) has neither field today; adding them is that
 * follow-up's job, not this pass's. No placeholder button renders here in the meantime — an inert
 * "Reuse token" control pointing at nothing would be a worse defect than the wait.
 */

/* An unlisted host (plugin off or missing) takes no new token; Access tokens can remove it. */

/**
 * A row's `<summary>` — split out of {@link SourceControlProviderRow} purely for this app's
 * complexity gate, same reasoning every other per-state split in this file documents.
 *
 * Not-connected: an empty ring marker plus a heading ("Connect GitHub") — the heading text is
 * already the call to action, so no separate subtitle repeats it (the old subtitle line, identical
 * on all three rows, was cut for exactly this reason — see this file's own header).
 *
 * Connected: the same summary line this page has always shown — a filled checkmark marker, the
 * settled trust fact ("token stored, encrypted"), and the SAVED time, never "updated" ("updated"
 * would falsely imply the token was recently re-verified, and a revoked token still carries whatever
 * timestamp is stored here regardless). No liveness/verification indicator is shown anywhere on this
 * row — this admin has no way to check a token is still valid without trying to use it, and claiming
 * otherwise would be exactly the kind of unbacked trust signal `CredentialStepDone`'s own doc in
 * `deployment/StaticSiteTab.tsx` warns against.
 *
 * Both states end in a trailing chevron — connected pairs it with visible "Replace token" text,
 * REQUIRED rather than a bare clickable row: a settled `<summary>` with its native disclosure
 * triangle stripped and no replacement was owner-reported as undiscoverable on the Static Site tab's
 * own credential rows (a reader with a rotated token had no way to tell the row could be reopened).
 * The not-connected chevron carries no extra label — its own heading text is already the action, so a
 * second "Add token" label next to it would repeat, not clarify.
 */

/**
 * A row's fields — token input, the host's other declared fields, and the Save action. Shared between
 * both {@link SourceControlProviderRow} states, same split `PublishCredentialFields` uses in
 * `deployment/StaticSiteTab.tsx` and for the same reason: the fields and Save behavior are
 * identical in both states, only whether the reader has opened the row to see them differs.
 *
 * Every hint renders BELOW its input as `.field-hint`, never as placeholder text inside it — a
 * placeholder sitting in an empty box reads as a saved value at a glance, the exact confusion the
 * Static Site tab's own credential form was corrected out of. The inputs below
 * carry no `placeholder` prop at all, connected or not.
 *
 * The scope-guidance sentence (which token, which scopes) sits behind its own nested "Which token do
 * I need?" `<details>` rather than rendering by default — this file's own header records why: the
 * words themselves are the owner's own 2026-08-15 narrowing (`rules.ts`), untouched here, only their
 * default visibility changed. No `name` attribute on this inner `<details>` — it has nothing to stay
 * exclusive WITH, and giving it the outer accordion's own group name would fold it into that group by
 * mistake.
 */

// `new-password`, not `off` — Chrome ignores `off` on credential-shaped fields by

// design. See `security/AccessTokensTab.tsx`'s token input for the full reasoning.

## SourceControl.tsx

/**
 * @file The Source Control page (`/admin/source-control`) — a CONNECTION page, not git integration.
 * See `ProvidersTab.tsx`'s own header for the scope boundary: save a personal access token per
 * provider so the host can read (and later push to) repositories, nothing more yet.
 *
 * ## 2026-08-16 — page shell rebuilt on `TabBar`, superseding this file's own PREVIOUS "never a tab
 * bar" decision
 *
 * This file used to hold every provider row directly, under a doc comment arguing explicitly
 * against a tab bar: "three flat rows was the explicit brief... this page has no tab bar to begin
 * with." That was a real, considered decision the owner made the day before (2026-08-15) — a
 * same-week reversal, not drift or an agent's own judgment call — confirmed directly by the owner
 * after seeing this page next to `deployment/Deployment.tsx`. A future reader who finds a tab bar
 * here where a comment once forbade one should read THIS as the record of that reversal, not a sign
 * the old comment was ignored. The page read as a settings-dialog panel dropped onto a route, not a
 * page: it carried no `page-header`/`TabBar` shell at all, while its nearest neighbour,
 * `deployment/Deployment.tsx`, does. This file now mirrors `Deployment.tsx`'s shell exactly — same
 * `TabBar` (not `@jini-ai/ui`'s `SettingsDialogShell`, for the identical reason that file's own
 * header gives: a dialog-shaped shell bundling its own sidebar plus a kicker/title/subtitle header
 * fights a page's own `.page-header`), same {@link resolveSourceControlTabId} guard against a junk `?tab=`
 * value, same `navigate(..., { replace: true })` on tab switch so the URL stays a correct deep link
 * without growing back-button history one entry per click.
 *
 * The three provider rows themselves did NOT change — moved verbatim into `ProvidersTab.tsx`, this
 * page's one tab today. "Flat rows, not sub-tabs" is still true one level down: GitHub, GitLab, and
 * Bitbucket are still three parallel rows inside that one tab, never three tabs of their own — this
 * pass only wraps that existing content in the page-level shell every other built Operations screen
 * already has. Only one real tab exists because only one real thing is built here — commit history,
 * sync, diffing, and branch management are still a separate, not-yet-started feature (see
 * `ProvidersTab.tsx`'s header) — so {@link SOURCE_CONTROL_TAB_IDS} stays a list of one rather than
 * padding itself out with a disabled placeholder tab for a feature that has not been spec'd yet.
 * `panels.tsx`'s own "its own Operations entry, not a Deployment tab" reasoning is unaffected by any
 * of this — that argument was always about this page's place in the top-level nav, not about
 * whether it may have an internal tab bar of its own.
 */

/** Falls back to the one tab for an absent or unrecognized `?tab=` value. Delegates to the shared
 *  `../../lib/resolve-active-tab-id` guard `Deployment.tsx`/`Security.tsx`/`Database.tsx`/
 *  `Themes.tsx` all use, for the same reason (a stale link or a typo must not blank the panel).
 *  Kept as a real function rather than inlined even with one tab today: `Deployment.tsx` started
 *  at five tabs where this guard mattered immediately, and a second real tab landing here later
 *  should not have to reintroduce it. */

/** The `?tab=` query value from `panels.tsx`'s `source-control` route (`URLSearchParams.get`
   *  returns `null` when the param is absent). See {@link resolveSourceControlTabId}. */

/** DI seam for tests, threaded through to {@link ProvidersTab} — same convention
   *  `DeploymentProps` would carry if this shell owned any fetch/state of its own. It does not (each
   *  tab owns its own, same carve-out `Deployment.tsx`'s header documents), so this is the only prop
   *  besides {@link tabId}. */

## hooks/source-control-credentials-dependencies.hooks.ts

/**
 * @file The live {@link SourceControlCredentialsPort} binding.
 *
 * Calls the shared `api.*` methods (`listSourceControlCredentials`/`createSourceControlCredential`/
 * `updateSourceControlCredential`/`deleteSourceControlCredential`, `lib/api.ts`) instead of
 * reimplementing fetch plumbing locally — this file previously carried its own `sourceControlRequest`
 * built to match `request<T>()`'s observable behavior byte for byte, because `lib/api.ts` was
 * outside an earlier dispatch's file boundary before `POST/GET/PUT .../system/source-control/
 * credentials` existed server-side. Both now exist (this feature's backend slice, 2026-08-15), so
 * this file folds onto the same shared helper every other feature already uses — a mechanical move,
 * not a behavior change, since the four calls below are byte-identical in shape to what the local
 * reimplementation produced.
 */

/** The live implementation, as a module-level singleton — matches
 *  `publish-credentials-dependencies.hooks.ts`'s `defaultPublishCredentialsPort`. */

/** An in-memory {@link SourceControlCredentialsPort} for tests. Each of the four calls defaults to a
 *  neutral, overridable stub — matches `createFakePublishCredentialsPort`'s per-call override shape. */

## hooks/source-control-credentials-port.hooks.ts

/**
 * @file What `useSourceControlCredentials` needs from the outside world, as an interface rather
 * than a direct API import — same shape as `deployment/hooks/publish-credentials-port.hooks.ts`, so
 * a test can describe this hook's behavior against a fake port instead of stubbing global `fetch`.
 */

/** The hosts switched-on plugins declare, with their credential forms. */

/** Every configured connection for this workspace. */

/** Creates one named connection. Rejects with an `ApiError` (`code: "DUPLICATE_LABEL"`) if this
   *  workspace already has a connection with the same label. */

/** Updates a connection's label, secret, and/or default status. Omitting `connection` keeps the
   *  stored secret untouched — see `use-source-control-credentials.hooks.ts`'s header for why the
   *  form can never send a half-blank one. */

/** Idempotent — deleting an id that is already gone still resolves. Not called anywhere on this
   *  page today (there is no delete affordance in the UI — replacing a token PUTs over the existing
   *  row), kept on the port only for parity with `PublishCredentialsPort`'s own shape. */

## hooks/use-source-control-credentials.hooks.ts

/**
 * @file The Source Control page's credential-management hook — one always-visible row per host
 * (the hosts come from plugins, `GET .../system/source-control/providers`), each with its own token
 * (plus any other declared field) input, save action, and connected/not status. Mirrors `deployment/hooks/use-publish-credentials.hooks.ts` closely — same flat-row shape,
 * same optimistic local-state-after-write pattern, same create-vs-update-by-looking-at-what-exists
 * decision — with two differences: no `executionMode` (this page has no CLI-first alternative path
 * to branch on, unlike static publish), and `username` in place of `accountId` as the one provider
 * (Bitbucket, not Cloudflare Pages) that needs a field beyond the universal token.
 *
 * ## A stored credential is NEVER read back — this is why every row's inputs start blank
 *
 * `AdminSourceControlCredentialSummary` carries no token, no ciphertext, and no masked suffix. So a
 * row's `token`/`username` draft state can only ever start blank, connected or not — a blank token
 * at save time therefore means "nothing to change" on an already-connected row, not "the operator
 * left it empty by mistake" (`sourceControlCredentialRowReadyToSave`, `rules.ts`, disables Save in
 * that case rather than sending a no-op write).
 *
 * ## Save decides CREATE vs. UPDATE by looking at what is already there, not at UI mode
 *
 * {@link save} reads the provider's current DEFAULT connection via `rules.ts`'s
 * `defaultSourceControlCredentialForProvider`. If one exists, save PUTs to its id, replacing the
 * connection but leaving its own label untouched. If none exists, save POSTs a brand-new one
 * labeled {@link SOURCE_CONTROL_CREDENTIAL_ROW_LABEL} — the one fixed label this flat-list UI ever
 * writes.
 *
 * ## The row list is optimistically maintained locally, not refetched after every write
 *
 * `save` splices its own result into the local `credentials` array rather than re-running
 * `listCredentials()` — one round trip per write. Draft `token`/`username` are cleared back to
 * blank on a successful save.
 */

/** The host's label, guidance and declared fields; `listed: false` for a saved connection whose
   *  plugin is off or missing (shown, but no form). */

/** This provider's saved DEFAULT connection, if any — `undefined` means "not connected yet". */

/** The host's other declared fields, keyed by field name. */

/** Whether Save may be pressed, from `rules.ts`'s readiness gate. */

/** One entry per listed host, then one per saved connection's unlisted host — `undefined` until
   *  both the hosts and the saved connections first load. */

/** Sets one of the host's other declared fields. */

/** Creates or replaces one provider's saved connection from its own row's current draft — see
   *  this file's header for the create-vs-update decision. A no-op when the row is not ready.
   *  Resolves either way — a failure is surfaced through that row's own `error`. */

/** One row's draft input + busy/error state — kept in a map keyed by provider id so each row's own
 *  typing and in-flight save are fully independent of every other row's. */

/** Translates a rejected create/update into the exact string {@link useSourceControlCredentials}'s
 *  `save` stores as that row's `error` — pulled out of `save` for the same complexity-budget reason
 *  `use-publish-credentials.hooks.ts`'s own `publishCredentialSubmitErrorMessage` documents.
 *  @complexity O(1). */

// The hosts come from plugins. A failed load lists none; saved connections still show, unlisted.

// Seeds local state from the query's first successful load, exactly once — same shape

// `use-publish-credentials.hooks.ts`'s own `seededRef` uses. Later changes flow through `save`

// below, not through the query re-resolving.

// Each host's own text (label, guidance, field labels) in the viewer's locale.

/**
 * Binds the real `/api/.../system/source-control/credentials` client, and a `t` bound to the real
 * resolved locale — the zero-argument half of the `useX(dependencies)` / `useWiredX()` pair, same
 * shape `use-publish-credentials.hooks.ts`'s `useWiredPublishCredentials` documents.
 */

## index.ts

/**
 * @file Public surface of the `source-control` feature.
 *
 * `panels.tsx` imports from HERE, never from a file inside this folder — same feature-boundary
 * convention `deployment/index.ts`/`integrations/index.ts` document.
 */

## rules.ts

/**
 * @file Pure data and computation for the Source Control page — no React, no fetch, no `t()` calls
 * (every function here returns a dictionary key for a caller to translate). Same
 * `rules.ts`-holds-the-logic convention `deployment/rules.ts`/`integrations/rules.ts` follow.
 *
 * This page is a CONNECTION page, not git integration — see `SourceControl.tsx`'s own header for
 * the scope boundary. The hosts are data: each comes from a plugin's `host-source-control.json`
 * (`GET .../system/source-control/providers`), which also declares its credential form and guidance.
 * This file turns those descriptors into rows and holds the same connect/validate/build trio the
 * publish credential form needs.
 */

/** One host row this page can render, built from its plugin's descriptor. A saved connection whose
 *  host is not listed (its plugin off or missing) gets a bare `listed: false` entry named by its id:
 *  it stays visible, but takes no new token here. */

/** Proper noun — rendered verbatim, never translated. */

/** Where to create a token; `""` when the host names none (no link is rendered). */

/** The host's own guidance (which token, which scopes), passed through the translator; `""` when none. */

/** The declared field that holds the token. */

/** The token input's label from the descriptor; absent means the generic "Access token". */

/** The host's other declared credential fields; a `required` one gates Save. */

/** One listed host's entry. A descriptor with no credential form takes just a token.
 *  @complexity O(f) in its declared field count. */

/** The bare entry for a saved connection whose host is not listed. @complexity O(1). */

/**
 * This page's rows: every listed host in the server's order, then one `listed: false` entry per
 * saved connection's unlisted host (IRON RULE: a saved credential never drops off the page).
 * @complexity O(p + c * p) in the host and saved-connection counts (both small).
 */

/** One host row's typed fields: the token, plus its other declared fields by name. */

/**
 * Builds the wire {@link AdminSourceControlConnectionInput}: `providerId`, the trimmed token, and
 * each of `declaredFields` typed non-blank, trimmed. Always includes `token`, even when blank —
 * detecting "no new token typed" is {@link sourceControlCredentialRowReadyToSave}'s job.
 * @complexity O(f) in the declared field count.
 */

/** The single fixed label every connection saved through this page's flat per-provider row list
 *  uses — same "there is no picker left to order, every provider gets its own always-visible row,
 *  so there is nothing left to name" reasoning `PUBLISH_CREDENTIAL_ROW_LABEL` documents. If the
 *  backing table keeps a `(workspace_id, provider_id, label)` UNIQUE constraint the way
 *  `publish_credential_sets` does, this satisfies it without ever asking an operator to type one. */

/**
 * Every saved credential for one provider, in the order the server returned them.
 * @complexity O(n) in this workspace's total saved-credential count (small).
 */

/** Which saved connection (if any) a provider's flat row should treat as "connected" — the group's
 *  DEFAULT row. Falls back to the first saved row only as a defensive read; mirrors
 *  `defaultCredentialForProvider`'s exact reasoning in `deployment/rules.ts`.
 *  @complexity O(n) in this provider's own (small) saved-connection count. */

/**
 * Whether one host's row has enough typed to save: a token, and every required declared field. A
 * blank token always means "nothing to save", connected or not (leaving it blank on a connected row
 * keeps the stored secret untouched). An unlisted host takes no new token.
 * @complexity O(f) in the declared field count.
 */

/** What a rejected credential create/update means for the FORM — a dictionary-key-shaped result to
 *  translate and apply, mirroring `PublishCredentialSubmitFailure` exactly. `"generic"` is the
 *  catch-all every other kind falls back to. */

/**
 * Classifies a rejected create/update call. Checks BOTH `e.code` and `e.message` for the two known
 * markers, same reasoning `classifyPublishCredentialSubmitError` documents in `deployment/rules.ts`
 * — this page's own backend slice (not yet built, see this feature's handoff note) is expected to
 * follow the same `409 -> { error: "DUPLICATE_LABEL" }` / `400 -> { error: "VALIDATION", detail }`
 * shape every other admin write route in this app uses.
 * @complexity O(1).
 */

## source-control-i18n.ts

/**
 * @file Translations for the Source Control page (`/admin/source-control`). Same shape as
 * `deployment/deployment-i18n.tsx`: a flat `DICT[locale][englishKey] = translation` map, `t =
 * createDictionaryTranslator(DICT)`, and two `{error}`-carrying templates handled the same way that
 * file's own `publishCredentialsLoadErrorMessage`/`publishCredentialSaveErrorMessage` are — English
 * only, mirroring that exact same file's own documented "partial-coverage precedent" for its two
 * newest, most-recently-added error templates: an English banner in an otherwise-translated screen
 * degrades legibly (falls back through `createDictionaryTranslator`'s own `?? key` chain), it does
 * not break. The duplicate-label and generic-error strings are fully translated because they show
 * directly in credential rows.
 *
 * Every OTHER string here — headings, field labels, hints — gets the full locale set this app's nav
 * and every other stable feature dictionary carries, since those are read on every visit, not just
 * an error path. A host's own scope guidance is not here: its plugin ships it with its translations
 * (`lib/descriptor-i18n.ts`).
 */

/**
 * The row list's LOAD-error banner (`GET .../system/source-control/credentials`) — English only,
 * mirroring `deployment-i18n.tsx`'s own `publishCredentialsLoadErrorMessage` and its documented
 * "partial-coverage precedent": an English banner in an otherwise-translated page degrades legibly.
 */

/**
 * One row's save-error banner. Also carries a rejected VALIDATION failure's `detail` text, routed
 * here by `classifySourceControlCredentialSubmitError` (`rules.ts`) instead of the generic
 * `describeApiError` fallback — same shape `publishCredentialSaveErrorMessage` uses.
 */

## source-control-visuals.tsx

/**
 * @file This page's own small icon set — three inline SVGs, no icon dependency. Same rationale
 * `deployment/deployment-visuals.tsx`'s header gives for its own set: this app ships no icon
 * component library to `features/`, and importing icons cross-feature (from `deployment/`, which
 * this page deliberately avoids depending on — see `SourceControl.tsx`'s header) would tie this
 * page's rendering to a sibling feature another agent owns.
 *
 * No brand marks anywhere in this file, on purpose. This app draws zero brand logos anywhere —
 * every proper noun on screen (`STATIC_HOSTS` in `deployment/rules.ts`, this page's own provider
 * labels) renders as plain `translate="no"` text, never a mark — so GitHub/GitLab/Bitbucket get the
 * same treatment here: their names are text, and the marker beside each row is a generic
 * connection/checkmark glyph, not an octocat, fox, or Atlassian mark.
 *
 * All `aria-hidden` — every icon here sits next to text that already says the same thing, matching
 * `frontend-accessibility`: an icon that duplicates its own visible label is noise to a screen
 * reader, not information.
 */

/** Shared attributes for a decorative line icon — same 24px grid, 1.5 stroke, round joins as
 *  `deployment-visuals.tsx`'s `LINE_ICON`, so this page's marks read as the same family as the rest
 *  of this admin even though the two files share no code. */

/** The card header's own icon — two nodes joined by a line, the generic shape of "a connection,"
 *  not any one host's mark. Distinct from `deployment-visuals.tsx`'s `StaticSiteIcon`/`FullSiteIcon`
 *  (a document, a server rack) — this page connects an ACCOUNT, not a deploy target. */

/** A connected row's marker glyph — the same check-glyph path `deployment-visuals.tsx`'s
 *  `StepDoneIcon` uses, redrawn locally rather than imported (this page owns no dependency on the
 *  `deployment` feature — see `SourceControl.tsx`'s header) so the two "this step is done" marks
 *  still read as the same symbol meaning the same thing across the admin. Always `aria-hidden`: the
 *  row's own summary text already states "connected" in words. */

/**
 * The disclosure chevron beside a connected row's "Replace token" affordance, rotated 180° by CSS
 * when its `<details>` is open. Redrawn locally for the same reason {@link ConnectedMarkIcon} is —
 * same path `deployment-visuals.tsx`'s `DisclosureChevron` uses.
 *
 * Always paired with a VISIBLE text label ("Replace token"), never alone: a bare chevron on a
 * clickable row with no text was the exact defect this page was briefed not to inherit from the
 * Static Site tab's credential rows (owner-reported there: a settled row read as inert with no way
 * to discover it could be reopened). The chevron here is reinforcement of a label that already says
 * what opening does, not the only signifier.
 */
