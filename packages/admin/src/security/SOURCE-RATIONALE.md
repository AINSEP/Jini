# Preserved source rationale

Comments retained with this port, including deferred view-specific rationale. Product identity is generalized.

## AccessTokensTab.hooks.tsx

```ts
/**
 * @file `AccessTokensTab.tsx`'s two `forwardRef` `<dialog>` sub-components' own state and
 * handlers — `RemoveConfirmDialog`'s close/confirm, and `AddCustomCredentialDialog`'s show/hide
 * toggle, ready-to-save/base-URL validity, and close/save — split out per the
 * `<Name>.tsx`/`<Name>.hooks.tsx` extraction pattern (admin TSX-logic-sweep: deferred 2026-09-03,
 * fixed 2026-09-05). Also home to {@link useMergedSecretsOrder} (2026-09-21 round 2 of the owner's
 * ordering ruling), this page's other non-`.tsx` logic (house rule: no functions in a `.tsx`
 * component body).
 *
 * Each dialog receives its `ref` FROM `forwardRef` (the parent calls `ref.current?.showModal()`
 * imperatively) rather than owning one via its own `useRef` — these hooks take that same forwarded
 * ref as a parameter and cast it the same way the original inline code did
 * (`(ref as RefObject<HTMLDialogElement>).current`), rather than restructuring either dialog into
 * the controlled `open`-prop shape `ConfirmDialog`/`ImagePreviewModal` use elsewhere. That would
 * change this file's public dialog API — a rewrite, not the pure relocation this pass does.
 */
/**
 * `RemoveConfirmDialog`'s close/confirm — extracted verbatim, same two calls, same order.
 *
 * @param ref - The forwarded ref `RemoveConfirmDialog` receives from its caller.
 * @param row - The token row this confirm dialog is for.
 * @param controller - `AccessTokensController.removeToken` is the one call this hook makes.
 * @returns `close`/`confirm`, wired directly to the dialog's Cancel/"Remove from host" buttons.
 * @complexity O(1).
 */
/**
 * `AddCustomCredentialDialog`'s local show/hide toggle, its two save-readiness checks, and its
 * close/save handlers — extracted verbatim, same computation, same inputs/outputs.
 *
 * @param ref - The forwarded ref `AddCustomCredentialDialog` receives from its caller.
 * @param controller - Reads `controller.customAddForm`; calls `resetCustomAddForm`/
 *   `createCustomCredential`.
 * @returns `showToken`/`toggleShowToken` for the token field's Show/Hide button,
 *   `readyToSave`/`baseUrlInvalid` for the form's own validity checks, and `close`/`save`.
 * @complexity O(1).
 */
/**
 * One sortable unit in {@link useMergedSecretsOrder}'s merged list — a whole Tier-1 provider group
 * (`kind: "provider"`, one heading, possibly several named tokens underneath — `ProviderGroup`'s own
 * shape, unchanged) or one Tier-2 top-level entry (`kind: "other"`, one heading, zero or one row —
 * `OtherCredentialEntry`'s own shape). Both variants also carry `info`/`rows` so the union itself
 * satisfies `rules.ts`'s `AccessTokenGroupSortInput` structurally — {@link sortAccessTokenGroups} reads
 * only those two fields and returns whatever concrete type it was given, so the `kind`/`group`/
 * `store`/`row` fields ride along untouched.
 */
/** `undefined` for the store's own "Not configured" placeholder — mirrors
       *  `OtherCredentialEntry`'s own `row` prop exactly. */
/** One Tier-2 store's own sortable entries — a store with no configured items explodes into exactly
 *  one placeholder entry (`row: undefined`), a configured multi-item store (e.g. `media-provider`
 *  holding both Cloudinary and xAI Grok) explodes into one entry PER item, each ranked by its own
 *  item name rather than the store's generic label — same explosion `OtherCredentialGroup` used to do
 *  before this pass folded it into the merge step. @complexity O(n) in this store's own item count. */
/**
 * The Secrets page's ONE merged row order — owner's 2026-09-21 round-2 ruling: every row kind on the
 * page (a Tier-1 catalog/custom provider group, a Tier-2 configured item, a Tier-2 "Not configured"
 * placeholder) sorted together through the SAME {@link sortAccessTokenGroups} rule round 1 already
 * certified (saved-before-unsaved, then category-chip order, then alphabetical by label), instead of
 * round 1's "Tier 1 sorted, Tier 2 always appended after all of it" shape — see this repo's
 * `2026-09-21-host-94-secrets-order.md` handoff for the full "why Tier 2 never outranked Tier 1"
 * root cause.
 *
 * Visibility is resolved HERE, once, for both tiers — folding in what `MaybeProviderGroup`/
 * `MaybeOtherCredentialGroup` used to check independently (a group's own info matching the query, OR
 * it already has at least one query-matched row) — so a caller gets back exactly the entries that
 * should render, already in final order, with no separate visibility pass needed downstream.
 *
 * `query` is taken as an explicit parameter (rather than read off `controller.query` internally) so
 * this hook's own dependency array stays honest about what it actually reads — `AccessTokensTab.tsx`
 * passes `controller.query` at the call site, the same single search box both tiers already share.
 *
 * @complexity Time O(n log n) in the combined provider-group-plus-other-item count (small — same
 * bound {@link sortAccessTokenGroups} itself documents), space O(n) for the built entry list.
 */
```

## AccessTokensTab.tsx

```ts
/**
 * @file The Access Tokens tab — `Security.tsx`'s one tab and this feature's actual content. One
 * flat, searchable, category-filtered list of every credential this install holds across all eight
 * stores `development/todos.md:1208` names — the 2026-08-16 owner ruling that replaced this page's
 * original two-surface shape (seven Tier 1 providers here, a banner naming six unread Tier 2 stores)
 * with a single list: "from a person's point of view a Cloudinary key and a GitHub token are the
 * same kind of thing — a secret this install holds." See `ADS-memory/reports/design/
 * 2026-08-16-access-tokens-visual-spec.md`'s "OWNER RULING" section for the ruling in full.
 *
 * Tier 1 (`ACCESS_TOKEN_PROVIDERS`, `rules.ts`: GitHub Pages, Vercel, Netlify, Cloudflare Pages,
 * GitHub, GitLab, Bitbucket) still gets `[+ Add]` and multiple operator-named rows per provider — the
 * genuinely new capability this page adds (see `Security.tsx`'s own header for why "Create" living
 * here is not a repeat of what Static Site/Source Control already do). Tier 2
 * (`OTHER_CREDENTIAL_STORES`, `rules.ts`, rendered by `OtherCredentialsSection.tsx`) gets Replace/
 * Remove and a deep link to wherever Create actually lives, never a second Create — the tier split
 * survives only as that per-row CAPABILITY difference now, not as two separate surfaces. The
 * "showing 7 of 8" partial-inventory banner this page used to render is deleted; there is nothing
 * left to disclose once every store is read.
 *
 * ## Search
 *
 * Matches a provider's/store's brand label, its purpose subtitle ("Hosting"/"Source control"/
 * "AI"/… — the disambiguation `rules.ts`'s header calls "the two-store GitHub trap" for Tier 1, and
 * the same subtitle Tier 2 rows carry next to their own name), and a saved item's own name. A group
 * renders when EITHER its own info matches the query OR it has at least one matching saved row — so
 * typing "GitHub" surfaces both the GitHub Pages group (provider match) and the GitHub · Source
 * Control group (provider match), each rendering its own real rows, never merged into one card.
 *
 * ## Category filter
 *
 * `All / Source control / Hosting / Media / AI / Ops` (`rules.ts`'s `ACCESS_TOKEN_CATEGORIES`),
 * `All` default, borrowing Settings' wrapped icon-tab-row LOOK without adopting `SettingsDialogShell`
 * itself — that component bundles its own vertical sidebar plus a kicker/title/subtitle header that
 * fights this page's own `.page-header` (`Deployment.tsx`'s header documents the same rejection for
 * the identical reason). `.access-tokens-category-filter` is its own class, not an overload of
 * `.tab-bar` — a filter control, not a tab bar, and `.tab-bar` is shared by five other screens that
 * must not be affected by this page's own styling needs.
 *
 * ## Component split
 *
 * Per-scope ESLint complexity gate (hard 9/9 cyclomatic/cognitive) — same "extract, don't inline"
 * discipline `ProvidersTab.tsx`/`StaticSiteTab.tsx` already use for the identical reason.
 */
/** DI seams for tests — same convention as every other wired-hook prop in this app. */
// Tier 2 reads `query`/`category` FROM Tier 1's own controller rather than owning either — one
// search box, one category filter, across both tiers (this file's own header). See
// `use-other-credentials.hooks.ts`'s header for why that state isn't duplicated here instead.
/** Loading/error/populated split — pulled out of {@link AccessTokensTab} purely for the complexity
 *  gate, same reasoning `SourceControlCredentialsList` documents in `ProvidersTab.tsx`. Waits for
 *  BOTH tiers' first load: rendering Tier 1's list before Tier 2 has resolved would put the category
 *  filter and the row list on screen a beat before Tier 2's own rows could ever appear under it,
 *  which reads as those rows being silently absent rather than still loading.
 *
 * `useMergedSecretsOrder` (a hook) is called unconditionally, ahead of every early return below —
 * Rules of Hooks — even though its result is only rendered once the loading/error gates pass; it
 * tolerates either controller's `groups` still being `undefined` internally (`AccessTokensTab.hooks.tsx`'s
 * own doc), so calling it early costs nothing. */
/** The `All / Source control / Hosting / Media / AI / Ops` filter row, PLUS the "Add custom
 *  provider" button — see this file's header for why the filter row borrows Settings' wrapped
 *  icon-tab-row LOOK rather than the component itself. The button is a deliberately SEPARATE
 *  control after the mapped category pills (`margin-left: auto` in `access-tokens.css` pushes it to
 *  the far right of the row), not a pill itself — it opens a create form, it does not filter
 *  anything, so it must never read as an eighth category to a search/scan of this row. Pulled out
 *  of {@link AccessTokensBody} for the complexity gate; its own branching is a single `.map()` plus
 *  one static button, so this split is about readability/reuse rather than a budget this one
 *  function would otherwise exceed. */
// Reuses `TabBar.hooks.tsx`'s WAI-ARIA tabs keyboard helpers rather than reimplementing them —
// `ACCESS_TOKEN_CATEGORIES`'s `{ id, label }` shape structurally satisfies `TabBarTab`, and none
// of these categories are ever disabled. `[role="tab"]` scoping already skips the non-tab
// "+ Add custom provider" button below (this file's own header on why that button stays out of
// the tablist's tab order).
/** The search box and its own match-count line — counts are the SUM of both tiers'
 *  `totalCount`/`matchCount` (this file's header on why the combined count stays a GLOBAL fact,
 *  unaffected by the category filter below it). "token(s)" stays the noun even though the count now
 *  spans Tier 2's keys/credentials too — the existing e2e suite pins the exact string
 *  (`development/e2e/access-tokens.spec.ts`'s `/^0 tokens saved$/`), and nothing in this pass asked
 *  for new copy here; a person calling an API key a "token" loosely is the same shorthand this
 *  page's own tab name already uses for the whole install. The line itself is `rules.ts`'s
 *  `accessTokensCountText` — a whole translated sentence per plural form, not fragments glued in
 *  English word order (see that function's own doc for why). */
/* No `[+ Add another]` for a `"custom"` group — it has no shared provider identity a second
          saved row could join; a second custom credential is a wholly new one, created through the
          standalone "Add custom provider" dialog, not this per-provider affordance. */
/* Nor for an unlisted provider (plugin off or missing): it takes no new token. */
// `aria-label`, not just the visible "Connect" text: every not-yet-connected provider on
// this page renders this exact same bare word, so with two or more not-connected rows on
// screen at once (the common case — most installs have not connected every one of the
// seven providers), `getByRole("button", { name: "Connect" })` — or an agent resolving by
// accessible name — cannot tell GitHub's row from GitLab's. `label` here is already the
// provider's own display label (e.g. "GitHub Pages"), so this starts with the exact
// visible word (WCAG 2.5.3 Label in Name).
// Handle built from `ref.kind`/`ref.providerId` (already lowercase, hyphen-safe — every
// `AccessTokenProviderRef` in this app comes straight off `ACCESS_TOKEN_PROVIDERS`), never
// from `label` — `agentHandle()` rejects any handle that isn't lowercase words joined by
// single hyphens, and a proper-noun label like "GitHub Pages" (capitals, a space) throws
// at render time. Caught live: an uncaught throw here unmounted this whole row with no
// error boundary above it, which is worse than a defensive check — a crash, not a fallback.
/** The `isDefault` indicator + `Make default` link — only shown once a provider has 2+ saved
 *  tokens (`rules.ts`'s own doc on why a lone row has nothing to choose between). Split out purely
 *  for the complexity gate.
 *
 * This button lives inside `TokenRow`'s own `<summary>`, a descendant of the native disclosure
 * toggle, so its click would otherwise ALSO open/close the enclosing `<details>` (the browser runs
 * `<summary>`'s toggle as the click event's default action regardless of which descendant was
 * actually clicked, unless that default action is cancelled) — `preventDefault`/`stopPropagation`
 * in the handler below is what keeps a "Make default" click from also expanding the row, same
 * pattern as `deployment/StaticSiteTab.tsx`'s `CredentialVerifyAction`. */
// `aria-label`, not just the visible "Make default" text: this button renders once per
// non-default row in a provider group that has 2+ saved tokens (the ONLY case it renders at
// all — this function's own guard above), so with 3+ saved tokens for one provider, multiple
// identically-labeled "Make default" buttons are on screen simultaneously. `state.name` is
// this row's own operator-chosen display name, already unique enough to pick one out.
/** Shared input markup for BOTH the "add a new token" form and an existing row's "replace" fields —
 *  same split `PublishCredentialFields`/`SourceControlCredentialFields` use for the identical
 *  connected/not-connected duality. Every hint renders below its input as `.field-hint`, never as
 *  placeholder text — same "placeholder-as-label reads as a saved value" defect this app has already
 *  fixed twice (`ProvidersTab.tsx`'s own header). */
// Only a custom row shows Username, always optional (`rules.ts`'s `AccessTokenProviderInfo` doc).
/* `autoComplete="new-password"`, NOT `"off"` — Chrome deliberately ignores `off` on
            credential-shaped fields (a long-standing intentional decision, not a bug), and `off`
            here is what let the reported autofill through. `new-password` is the documented signal
            for "this field is not a saved-login field", which suppresses both the saved-credential
            dropdown and the silent fill.

            This input is why the SEARCH BOX at the top of the page was being filled with "admin":
            `TokenRow`'s `<details>` renders `ExistingTokenFields` unconditionally, so every saved
            token leaves a live password input in the DOM even while its row is collapsed. Chrome's
            formless credential heuristic groups a page's text-like fields with any password field
            by DOM proximity — no `<form>` required, and there is none in this feature — so the page
            read as a login surface and the first text-like field (the search box) got the site's
            saved username. Fixing the search box's own attribute could not work: the search box was
            the symptom, these fields are the trigger. */
/** A run of {@link ExtraFieldInput}s, in the order given. */
/** One of a provider's descriptor fields (a host's account ID, bucket, region…): the descriptor's
 *  label (a host term, verbatim) plus the translated "(optional)" suffix, and its help below. */
// `aria-label`, not just the visible "Save"/"Saving…" text: a provider group can hold
// several saved tokens (`AddAnotherButton` above), each opened via its own `<details>`
// (unlike `RowMenu`'s exclusive-open items, more than one can be expanded at once) — with
// two rows open, both show an identical bare "Save" button. `state.name` is this row's own
// display name, already visible in its `<summary>` heading, so it disambiguates the same
// way a sighted reader already can. Mirrors the visible text's own saving/idle split so the
// accessible name never says "Save" while the button reads "Saving…" (WCAG 2.5.3).
// Same multi-row-open ambiguity as Save above, on this page's one destructive action —
// see `rules.ts`'s `restoreButtonAccessibleName` (`recovery/rules.ts`) for the identical
// reasoning applied to a different screen's own always-visible destructive control.
// `aria-label`: more than one provider's "Add" form can be open at once (each provider
// group owns its own independent `addForm.visible`), and every one of them renders this
// same bare "Save"/"Saving…" text — `info.label` is the one thing that tells them apart
// here (there is no operator-chosen name yet to use, unlike `ExistingTokenFields`' own
// fix above, since this token has not been saved).
/**
 * Native `<dialog>` confirm — same `.confirm-dialog` foundation `styles.css:2880` documents (`[open]`-
 * scoped `display`, never a bare-class rule — that comment's own header records the live bug an
 * unscoped rule caused). "Remove from host," never "Revoke" — `rules.ts`'s own header, this page's
 * one load-bearing copy constraint: deleting host's row does not revoke the credential at the
 * provider, and this dialog is the one place that fact has to be stated in words, not implied by a
 * button label.
 *
 * Confirm button carries no `agentHandle` — destructive, same boundary
 * `StaticSiteTab.tsx`'s own credential-entry fields already draw (no agent read/act surface over a
 * credential action); the row's own SUMMARY stays tagged (`TokenRow`'s `agentHandle`), only this
 * dialog's destructive action does not.
 */
// `aria-labelledby`, not left implicit: a native `<dialog>` has no accessible name of its own
// from an `<h2>` sitting inside it — that link has to be stated, the same way the shared
// `ConfirmDialog` (`@jini-ai/admin/react`) already does via its own `titleId`. Without it, every
// one of this page's per-row remove dialogs reads to an accessibility tree as an unnamed
// "dialog", indistinguishable from any other open dialog on the page. Scoped by `row.id` (not a
// static id) because one `RemoveConfirmDialog` is mounted per token row, all in the DOM at once.
/* `info.vendorLabel`, NOT `info.label` — this line says WHERE to revoke, and "GitHub
              Pages"/"Cloudflare Pages" are destinations with no revoke console of their own. See
              `rules.ts`'s `AccessTokenProviderInfo.vendorLabel` doc for the full reasoning; every
              other `info.label` on this page still names the destination on purpose. */
/** The red-star marker on a required field's label — Name/API base URL/Access token in the form
 *  below (Username stays unmarked, Category always carries a value so it's never actually blank).
 *  `aria-label`, not `aria-hidden`, so a screen reader announces "required" — same convention
 *  `Authentication.tsx`'s own `source-config-field-required` marker uses. */
/** The "Additional hosts" field — split out of {@link AddCustomCredentialDialog} purely so that
 *  function's own complexity stays under this repo's gate; the inline-error branch below adds one
 *  more decision point to whichever function renders it, and `AddCustomCredentialDialog` already
 *  carries a full field set's worth. */
/**
 * The "Add custom provider" form (`AccessTokensCategoryFilter`'s own button opens it) — a
 * standalone native `<dialog>`, not a per-provider `AddTokenForm` (this file's own header on why a
 * custom row has no shared provider group to attach an inline add-form to). Collects the four
 * fields the brief specifies (API base URL, Access token with a show/hide toggle, optional
 * Username, Category) plus a Name field every other row on this page already requires (the display
 * name the list/search will show — `TokenInputFields`' own "Name" field doc gives the identical
 * reasoning). Deliberately does NOT reuse `TokenInputFields`: that shared component's field set
 * (Name/Token/AccountId/Username) has no Base URL or Category concept, and both of those are
 * create-only here (see `rules.ts`'s `accessTokenRowProviderInfo` doc for why Replace on an
 * existing custom row does not re-collect them) — bolting a fifth, create-only field onto a
 * component shared with the seven catalog providers' Replace flow would risk it leaking there too.
 */
// Same `aria-labelledby` fix as `RemoveConfirmDialog` above — one instance of this dialog per
// page, so a static id is fine (contrast the per-row `row.id`-scoped id there).
```

## OtherCredentialsSection.hooks.tsx

```ts
/**
 * @file `OtherCredentialsSection.tsx`'s `forwardRef` `<dialog>` sub-component's own handlers —
 * `OtherCredentialRemoveDialog`'s close/confirm — split out per the
 * `<Name>.tsx`/`<Name>.hooks.tsx` extraction pattern (admin TSX-logic-sweep: deferred 2026-09-03,
 * fixed 2026-09-05). Mirrors `AccessTokensTab.hooks.tsx`'s `useRemoveConfirmDialog` exactly, for
 * Tier 2's own row shape — see that file's header for why this takes the forwarded ref as a
 * parameter rather than restructuring the dialog into a controlled `open`-prop shape.
 */
/**
 * `OtherCredentialRemoveDialog`'s close/confirm — extracted verbatim, same two calls, same order.
 *
 * @param ref - The forwarded ref `OtherCredentialRemoveDialog` receives from its caller.
 * @param row - The credential row this confirm dialog is for.
 * @param controller - `OtherCredentialsController.remove` is the one call this hook makes.
 * @returns `close`/`confirm`, wired directly to the dialog's Cancel/"Remove from host" buttons.
 * @complexity O(1).
 */
```

## OtherCredentialsSection.tsx

```ts
/**
 * `agentHandle()` throws on anything that isn't lowercase words joined by single hyphens
 * (`@jini-ai/agentic`'s own `HANDLE_PATTERN`, `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` — no underscores, no
 * colons, no spaces). Tier 1's providers are all drawn from this app's own fixed tables, so every
 * id there is already handle-safe by construction. Tier 2's per-item ids are NOT: `media-provider`'s
 * ids come from a vendor catalog and `external-mcp`'s are operator- or plugin-chosen — this app does
 * not own either spelling, and either can carry underscores. The predecessor already caught the identical class of
 * bug once, for a raw provider LABEL fed into a Tier-1 handle (`AccessTokensTab.tsx`'s own
 * `NotConnectedRow` comment); this is the same trap for a raw ITEM ID here — caught live via a
 * headless-browser console check before this reached the owner's own screen, the same way it was
 * caught the first time. */
/**
 * @file Tier 2 of the Access Tokens list — {@link OtherCredentialEntry}, the one top-level entry
 * component for the six single-row/per-item credential stores (`rules.ts`'s
 * `OTHER_CREDENTIAL_STORES`), rendered inline in the SAME merged, sorted list Tier 1's provider
 * groups render in, per the 2026-08-16 owner ruling ("one list, not two surfaces") and the
 * 2026-09-21 round-2 ruling that made it one TRUE ordered list rather than "Tier 1 sorted, Tier 2
 * always appended after". `AccessTokensTab.hooks.tsx`'s `useMergedSecretsOrder` owns the visibility
 * check and the per-store explosion into individual entries that this file used to own itself
 * (`OtherCredentialsSection`/`MaybeOtherCredentialGroup`/`OtherCredentialGroup`, deleted this pass —
 * see that hook's own doc for where the identical logic now lives); `AccessTokensTab.tsx` renders
 * this component directly, one call per merged entry.
 *
 * ## Why a Tier-2 "entry" has no separate parent heading the way a Tier-1 provider group does
 *
 * Tier 1's `ProviderGroup` shows one `<h3>` (the PROVIDER's name, e.g. "GitHub") with multiple named
 * `TokenRow`s underneath it, because one provider can hold several operator-named tokens. Nothing on
 * Tier 2 is named that way — `media-provider`/`external-mcp` can each hold more
 * than one ITEM (a provider, a server), but never more than one CREDENTIAL per item, so
 * there is nothing to nest. The owner's own mock reflects this directly: "Cloudinary (media)" reads
 * at the SAME indentation as "GitHub"/"Cloudflare", not nested under a "Media provider keys" parent —
 * each configured item (or, when a store has none configured, the store itself) gets its own
 * top-level entry, heading and all. {@link OtherCredentialEntry} is that entry; it structurally
 * mirrors `ProviderGroup` (one heading, one row) with exactly zero or one row inside, never more.
 */
/** A DOM-id/`agentHandle()`-safe form of `row.key` — `row.key` itself is `${storeId}:${itemId}`
 *  (a colon-joined React/draft-state map key, fine for those two uses), but `agentHandle()` throws
 *  on anything that isn't lowercase words joined by single hyphens, and a colon is also a live CSS
 *  pseudo-class delimiter that would break any `#id` selector built from it. Caught live, the exact
 *  same class of bug `AccessTokensTab.tsx`'s own `NotConnectedRow` comment records for Tier 1 (a raw
 *  provider LABEL there; a raw ROW KEY here) — every `id`/`htmlFor`/`agentHandle()` call in this file
 *  must build from this helper, never from `row.key` directly.
 *  @complexity O(1). */
/** `agentHandle()`'s own spread, guarded against an unsafe id — mirrors `TabBar.tsx`'s own
 *  `tabHandleProps` ("omit the spread entirely when there is nothing safe to hand it"), extended
 *  from "handle is absent" to "handle is present but not safe": a media-provider or server id this
 *  app doesn't control just never gets tagged, rather than crashing the row that would have rendered
 *  it — see this file's header for why the id can be unsafe at all. @complexity O(1). */
/** One top-level Tier-2 entry — see this file's header for why this has no separate parent heading
 *  the way a Tier-1 `ProviderGroup` does. `row` is `undefined` for the not-configured placeholder.
 *  Exported (2026-09-21 round 2): `AccessTokensTab.tsx` now mounts this directly, one call per
 *  `useMergedSecretsOrder` entry, in place of the deleted `OtherCredentialsSection` wrapper. */
/** The entry's body — placeholder / static-configured / replaceable-configured, split out purely for
 *  the complexity gate (this repo's hard 9/9 cyclomatic/cognitive ceiling — `eslint.config.mjs`'s
 *  `F06 option B`). */
/** @param handleSuffix - Distinguishes this deep link from every other row's — a bare store id for
 *  the unconfigured placeholder (only one ever renders per store) or {@link rowHandleBase} for a
 *  real row, since a store like `media-provider` can hold more than one configured item. */
/** Nothing configured yet — same "always show it, invite the reader to go set it up" role Tier 1's
 *  `NotConnectedRow` plays, minus a `[Connect]` affordance: Tier 2 owns no Create flow (`rules.ts`'s
 *  own header on why), so the deep link IS this row's only action. */
/** Configured, but this store does not support inline Replace (`external-mcp`
 *  — see `rules.ts`'s `OtherCredentialStoreInfo.supportsReplace` doc for why) — just the value fact,
 *  Remove, and the deep link, no disclosure to expand. Remove asks first, through the same
 *  {@link OtherCredentialRemoveDialog} the replaceable row uses: this store is the most
 *  destructive on the page (an External MCP delete loses a sealed OAuth secret for good), and this button used to fire on the first click. */
// `aria-label`: a store can hold more than one configured item (this file's own
// `handleSuffix` doc comment above names `media-provider` as an example), and every row
// renders unconditionally — no accordion, no menu — so two configured items under the
// same store put two identically-labeled "Remove from host" buttons on screen at once.
// `row.name` is this row's own display name, already visible in its heading.
/** Configured, and this store supports retyping the key on its own dedicated screen (`DeepLink`) —
 *  always rendered open, no accordion: unlike Tier 1's `TokenRow`, there is no inline form here worth
 *  hiding behind a click. The Access token field shown below is the same masked `row.valueFact` the
 *  summary line already carries, rendered `disabled` — a natural, familiar "this is set, go elsewhere
 *  to change it" cue, not an editable draft. Deliberately carries no `agentHandle()` — a disabled
 *  field tagged as fillable would have an assistant try to type into it, find it inert, and get stuck;
 *  the `DeepLink` below is the one actionable path to actually change this value, same as a person
 *  reading this row would use. */
/* One shared block, not two independent rows — `align-items: stretch` in a column-direction
          inline-flex makes the (naturally narrow) token field stretch to match the actions row's own
          content width below it, so both edges line up instead of the field looking arbitrarily
          short next to a wider button group. */
/* `type="text"`, not `"password"` — `row.valueFact` is already a pre-masked display
                string (leading dots + last 4 real characters); a password-type input would mask the
                last 4 a second time, hiding the one part of this value that's meant to stay visible. */
// Same multi-item-per-store ambiguity as `OtherCredentialStaticRow`'s identical button
// above.
/**
 * Native `<dialog>` confirm, mirroring Tier 1's `RemoveConfirmDialog` — same "Remove from host,
 * never Revoke" load-bearing copy constraint (`rules.ts`'s own header) for the four replaceable
 * stores: deleting host's row does not revoke the credential at the provider, and this dialog is the
 * one place that fact gets stated in words. The two static-row stores state their own, different
 * fact instead (`otherCredentialRemoveDialogBody`). No equivalent "this is the last row for this provider" note: every Tier-2 store
 * already caps at one row per item, so removing it is always the only-row case — the sentence would
 * be true on every single Remove and therefore say nothing new.
 *
 * Confirm button carries no `agentHandle`, same destructive-action boundary Tier 1's own confirm
 * dialog draws.
 */
// `aria-labelledby`, not left implicit — same fix, same reasoning, as Tier 1's own
// `RemoveConfirmDialog` (`AccessTokensTab.tsx`): a native `<dialog>` gets no accessible name
// for free from an `<h2>` inside it, and this doc comment's own header already promises this
// dialog "mirrors Tier 1's `RemoveConfirmDialog` exactly" — this brings that true for the title
// link too. `rowHandleBase(row)` (already this row's DOM-id-safe base, used below by its own
// input/deep-link ids) keeps this id unique across every Tier-2 row's own dialog.
/* Per-store body — `otherCredentialRemoveDialogBody`'s own doc: the shared "does NOT
            revoke" sentence is kept for the replaceable stores; External MCP gets its own. */
```

## Security.tsx

```ts
/**
 * @file The Security page (`/admin/access-tokens`) — a consolidation, not a new store: every token
 * here already lives in `publish_credential_sets` (Static Site tab) or
 * `source_control_credential_sets` (Source Control page); this page is one central place to see,
 * name, replace, and remove them, per `development/todos.md:1208`'s original spec and its
 * 2026-08-16 supersession recorded in `ADS-memory/reports/continuity/2026-08-16-session-6-handoff.md`.
 *
 * ## Create lives HERE too — the third and final word on a decision that moved twice
 *
 * The 2026-08-15 spec: Security is READ + REMOVE only, Create stays on the feature flow. The
 * 2026-08-16 session-6 handoff superseded that once: Replace/rotate joins Security too (the owner's
 * rotation argument — a revoked token needs ONE place to put the new one). The owner then superseded
 * it a SECOND time, same session: Create belongs here as well, in their own words, "you have to
 * create the access token and paste it and then save it, or you can replace it, or you can just
 * remove it so other people who are logging in don't have it."
 *
 * This is NOT a contradiction of the original "two entry points is the which-row-is-authoritative
 * bug" objection, once what "Create" means on each screen is made precise (`AccessTokensTab.tsx`'s
 * own header works through this in full): Static Site/Source Control each create exactly ONE thing
 * per provider — the DEFAULT connection, via a flat always-visible row with no label picker. This
 * page's own Create is a DIFFERENT capability neither of those forms exposes at all: a SECOND,
 * THIRD, differently-named token for a provider that already has one (a 30-day test token alongside
 * a production token — the owner's own example). There is exactly one place that capability can live
 * — it does not duplicate what Static Site/Source Control already do, it is the thing neither of
 * them does. Static Site and Source Control are UNCHANGED by this page's existence: same one-row
 * accordion, same `isDefault` row they always wrote and still write, still reachable and functional
 * throughout — this page's writes go through the exact same two HTTP endpoints those pages already
 * use (`hooks/access-tokens-dependencies.hooks.ts`), never a new one.
 *
 * ## Scope: all eight credential stores, one list — the 2026-08-16 owner ruling
 *
 * `rules.ts`'s `ACCESS_TOKEN_PROVIDERS` (Tier 1: `publish_credential_sets`, `source_control_
 * credential_sets` — both label + `isDefault`, both full CRUD, multi-row per provider) and
 * `OTHER_CREDENTIAL_STORES` (Tier 2: the four single-row/per-item sealed-credential stores — BYOK x2,
 * media providers, external MCP) are ALL read and
 * rendered in one flat list, filtered by one search box and one category row
 * (`AccessTokensTab.tsx`'s own header has the ruling in full: "a Cloudinary key and a GitHub token
 * are the same kind of thing"). The tier split survives only as a per-row capability difference —
 * Tier 1 keeps `[+ Add]` and multiple named rows; Tier 2 gets Replace/Remove and a deep link, never a
 * second Create — not as two separate surfaces, and there is no partial-inventory disclosure left to
 * show once every store is read.
 *
 * Page shell mirrors `SourceControl.tsx`/`Deployment.tsx` exactly: `page-header` + `TabBar`. Two
 * real tabs as of 2026-09-09 — "Access Tokens" (above) and "Site Token" (`SiteTokenTab.tsx`) — not
 * padded with a disabled placeholder for a THIRD tab nothing here asks for yet (Activity Log and
 * Roles & Permissions already have their own top-level Operations/People nav entries, not sibling
 * tabs of this page).
 *
 * Page renamed "Security" -> "Secrets" the same day (owner naming decision, not this agent's
 * call): the most accurate label for what's actually here — access tokens, the Site Token,
 * credentials — matching what Fly/GitHub already call the same thing. The rename is cosmetic
 * (nav label + `<h1>` only, per `translateAdminNavLabel`'s "copy string is its own i18n key"
 * convention — `panels.tsx`'s nav entry and this file's own `t(locale, "Secrets")` calls are the
 * only two places the old "Security" literal lived); the module/file names, the route id
 * (`/admin/access-tokens`, independent of the label — see `panels.tsx`'s own comment), and every
 * internal identifier below (`SECURITY_TAB_IDS`, `security-i18n.ts`, `SecurityProps`, …) are
 * UNCHANGED — renaming those is a bigger, separate move this pass does not make.
 *
 * "Site Token" joined the same day: not another saved credential this page reads, but the ONE key
 * that (partially — see `SiteTokenTab.tsx`'s own header) protects every credential Access Tokens
 * lists. `admin.security.tokens.manage`-gated separately from every verb above (`features/
 * identity/site-token-permission.ts`) — a narrower trust boundary than ordinary content admin,
 * deliberately not reusing this page's existing permission checks.
 *
 * ## The Site Token tab is affordance-hidden, not just protected server-side (2026-09-10)
 *
 * Every site-token route already re-checks `admin.security.tokens.manage` server-side
 * (`site-token-permission.ts`'s own header) — that gate was never the gap. Until this pass, the
 * TAB itself rendered for every logged-in admin-panel user regardless of role, so an editor/viewer
 * saw a tab that would 403 on every action inside it. `useWiredSecurityPermissions` (`hooks/
 * use-security-permissions.hooks.ts`) reads the same permission client-side, UX-only
 * (`lib/permissions.ts`'s `hasPermission` — its own header states plainly this is not the security
 * boundary): the tab entry, the rendered `<SiteTokenTab />`, and a direct `?tab=site-token` link all
 * fall back to Access Tokens for a principal who does not hold it. `resolveSecurityTabId` treats a
 * still-loading permission read as "not permitted" (`hasPermission` naturally returns `false` for
 * empty/absent permissions), so the tab never flashes into view before disappearing.
 */
/** The tab-id list for a principal WITHOUT `admin.security.tokens.manage` — see this file's header
 *  ("The Site Token tab is affordance-hidden") for why {@link resolveSecurityTabId} needs a second,
 *  narrower list rather than only ever validating against {@link SECURITY_TAB_IDS}. */
/** Falls back to the Access Tokens tab for an absent or unrecognized `?tab=` value, delegating to
 *  the shared `../../lib/resolve-active-tab-id` guard `Deployment.tsx`/`SourceControl.tsx`/
 *  `Database.tsx`/`Themes.tsx` all use — AND, since 2026-09-10, for a `?tab=site-token` link
 *  followed by a principal who does not hold `admin.security.tokens.manage`: `validIds` narrows to
 *  {@link ACCESS_TOKENS_ONLY_TAB_IDS} for them, so `site-token` reads as just as "unrecognized" as a
 *  typo would, and they land on Access Tokens instead of an empty panel. */
/** The `?tab=` query value from `panels.tsx`'s `security` route. See {@link resolveSecurityTabId}. */
/** DI seam for tests, threaded through to {@link AccessTokensTab} — same convention
   *  `SourceControlProps.useSourceControlCredentialsHook` follows. */
/** DI seam for tests, threaded through to {@link SiteTokenTab} — same convention. */
/** DI seam for tests — decides whether the Site Token tab is even offered. See this file's
   *  header ("The Site Token tab is affordance-hidden"). */
```

## SiteTokenRecoveryCard.tsx

```ts
/**
 * @file The Site Token tab's recovery card for a locked site: "Paste your old token" and "Start
 * fresh" (one typed confirmation). Render only — state, copy and requests live in
 * `hooks/use-site-token-recovery.hooks.ts`.
 *
 * The token field is a password field marked agent-private, so the assistant can never read a
 * pasted key. The final Start fresh button has no agent handle: it removes saved credentials, so a
 * person confirms it.
 */
```

## SiteTokenTab.hooks.tsx

```ts
/**
 * @file `SiteTokenTab.tsx`'s reveal panel's own copy-to-clipboard state — split out per the
 * `<Name>.tsx`/`<Name>.hooks.tsx` extraction pattern (`AccessTokensTab.hooks.tsx`'s header). Mirrors
 * `use-dockerfile-source.hooks.ts`'s `copy`/`copied` shape (`setTimeout(..., 1500)` reset), scoped
 * to just this one value rather than that hook's whole load/save/copy controller.
 */
/** Swallows a denied clipboard permission (insecure context, blocked permission) the same way
   *  `use-dockerfile-source.hooks.ts`'s `copy` does — the key is still selectable/visible text on
   *  screen either way, so a failed copy never blocks the operator from saving it by hand. */
// Clipboard access denied — see this file's header.
```

## SiteTokenTab.tsx

```ts
/**
 * @file The Secrets page's Site Token tab — view/reveal/generate the file half of
 * `HOST_ROOT_KEY`'s resolution (`features/webhooks/keyring.env.ts`, server-side).
 *
 * ## What this tab covers, as of the 2026-09-09 durability fix
 *
 * A generated key file now genuinely protects production too: it lives on the durable Fly volume
 * (not the container's ephemeral rootfs), the production boot gate accepts it, and the keyring
 * that seals every real stored credential (BYOK, publish/source-control/custom creds,
 * media-provider secrets) can now read one. {@link SiteTokenScopeNotice} still discloses the one
 * remaining gap: webhook signing / newsletter tokens still require the env var in production —
 * that keyring's own construction is deliberately unchanged this pass (a committed regression
 * test pins it). See `server/inbound/admin-http/routes/system/site-token.ts`'s header for the
 * full account, including the accepted tradeoff (a key file now lives beside the database it
 * protects — a volume backup carries both).
 *
 * ## No rotate/replace
 *
 * `POST .../generate` only ever creates. Replacing an existing key would orphan every secret
 * already sealed under the old one, and a confirmation strong enough for that (not a generic "are
 * you sure") is a separate, NOT-built feature — reported as out of scope rather than half-built.
 * Once a key is active (`status.active`), {@link SiteTokenGenerateAction} shows no control that
 * could be mistaken for one.
 *
 * ## Reveal — one mechanism, available any time a key is active
 *
 * An earlier brief had generate show its new value once, at creation, fingerprint-only after
 * that. The owner superseded it: "i want that token to be visible to admins or else when it
 * breaks they have no idea whats going on." {@link SiteTokenRevealAction} is the ONE place this
 * tab ever renders a key VALUE — never on page load, only behind its own explicit click, and
 * usable at any time afterward (not just right after a generate), for exactly the diagnostic
 * reason the owner gave: confirming the value here matches what's set in `fly secrets`, or
 * figuring out why credentials stopped decrypting. No audit trail on reveal — this codebase has
 * no general-purpose sensitive-read audit mechanism to hook into (checked, not built here).
 */
/** DI seam for tests — same convention as every other wired-hook prop in this app. */
/** DI seam for the locked site's recovery card. */
/** Loading/error/loaded split — pulled out purely for the complexity gate, same reasoning
 *  `AccessTokensBody` documents in `AccessTokensTab.tsx`. */
/** The always-visible "what this covers" disclosure — see this file's header. Rendered
 *  unconditionally, not just on failure: the fact it states is true whether or not anything has
 *  gone wrong, and the owner's own "self-contained" framing is exactly what this exists to make
 *  precise before anyone clicks anything.
 *
 *  Rewritten 2026-09-09 per the owner's live review ("the site token content needs to be simpler
 *  ... users are not gonna know what this even is"): leads with one plain sentence any operator
 *  can act on, keeps the production-only storage tradeoff visible (it changes what someone should
 *  do, not just background trivia), and demotes the webhook/newsletter exception to a de-emphasized
 *  note — same `.jini-field-hint` convention `AgentPlugins.tsx`'s section footnotes use — since it's
 *  a real but secondary caveat, not something a first-time reader needs to parse up front. */
/** The status card — badge + fingerprint + source-specific note + Reveal + Generate. Split out
 *  purely for the complexity gate. */
/* Site-key plan (2026-09-24) §A.6: Generate is hidden by default, not deleted — the
          server route, `useSiteToken`'s `generate()`, and this tab's own `SiteTokenGenerateAction`
          all stay wired (see that component's own header) so a later slice can re-expose it (e.g.
          behind an "advanced" disclosure) without rebuilding the plumbing. There is no existing
          "advanced" disclosure pattern on this tab to tuck it into, so this pass just hides it. */
/** The source-specific explanatory line under the badge — one sentence per case, no `{path}`
 *  template needed (the path is rendered as its own `<code>`, not interpolated into translated
 *  prose). Reworded 2026-09-09 alongside {@link SiteTokenScopeNotice} so the badge's
 *  "environment variable" vs. "key file" distinction is explained in plain terms here rather than
 *  assumed — the badge itself stays terse, this line carries the plain-language context. The
 *  `HOST_ROOT_KEY` variable name stays in the invalid-env case since fixing it requires
 *  that exact name. The `"none"` case was reworded again for the site-key plan (2026-09-24) item 3:
 *  it used to promise that clicking Generate would save a key to `status.keyFilePath` — stale ever
 *  since Generate was hidden by default (§A.6) in favor of `ensureSiteKeyForBoot` minting one
 *  automatically at boot, and doubly so once no fixed path is even guaranteed to be the one that
 *  ends up used (per-site keys, §A.1). @complexity O(1). */
/** Reveal — never shown on page load; the button is present whenever a key is active, and clicking
 *  it fetches (and displays, with a copy control) the raw value. Human-only: Reveal carries no agent
 *  handle, so the assistant's page driver cannot click it. {@link SiteTokenRevealedValue}'s
 *  own Hide button toggles it back off, client-side only (no server call). @complexity O(1). */
/** The revealed value itself, plus Copy/Hide — the ONLY place in this tab that ever renders a key
 *  VALUE rather than a fingerprint. The value is `data-agent-private`, so no published ancestor's
 *  text carries it to the agent, and neither it nor Copy has a handle. @complexity O(1). */
/** The Generate button + its own error banner. Shown only for the genuinely decidable case — no
 *  key at all (`status.source === "none"`) — never once a key is active, and never for an
 *  existing-but-invalid file or env var either (sol packet-3 finding 3-1, 2026-09-16): the server
 *  route only ever CREATES a key file, so offering Generate against a file that already exists
 *  (valid or not) is a guaranteed 409 with no path to success. A confirmed replace/rotate flow for
 *  that state is a separate, deliberately NOT-built feature (this file's own header). Works in
 *  every runtime mode now (2026-09-09 durability fix) — no longer disabled in production.
 *  @complexity O(1). */
```

## hooks/access-tokens-dependencies.hooks.ts

```ts
/** The live implementation, as a module-level singleton — matches
 *  `publish-credentials-dependencies.hooks.ts`'s `defaultPublishCredentialsPort`. Every method is a
 *  thin bind onto an existing `api.*` call already used by `Static Site`/`Source Control` — this page
 *  adds no new HTTP surface, only a second reader/writer of the same two endpoints. */
/** {@link createFakeAccessTokensPort}'s `publish` half — split out purely so that function's own
 *  branch count (four `??` fallbacks per store, times two stores) stays under this repo's
 *  complexity gate; each half here is four fallbacks alone.
 *  @complexity O(1). */
/** {@link createFakeAccessTokensPort}'s `sourceControl` half — see {@link fakePublishPort}'s own doc.
 *  @complexity O(1). */
/** {@link createFakeAccessTokensPort}'s `custom` half — see {@link fakePublishPort}'s own doc.
 *  @complexity O(1). */
/** An in-memory {@link AccessTokensPort} for tests. Each call defaults to a neutral, overridable
 *  stub — matches `createFakePublishCredentialsPort`'s per-call override shape.
 *  @complexity O(1). */
// No hosts unless a test lists some: the admin names none of its own.
```

## hooks/access-tokens-port.hooks.ts

```ts
/**
 * @file What `useAccessTokens` needs from the outside world, as an interface rather than a direct
 * `lib/api` import — same shape as `deployment/hooks/publish-credentials-port.hooks.ts`/
 * `source-control/hooks/source-control-credentials-port.hooks.ts`. Two flat method groups (`publish`/
 * `sourceControl`), not one unified CRUD surface: the two stores' create/update calls take
 * differently-shaped connection inputs (`AdminPublishConnectionInput` vs
 * `AdminSourceControlConnectionInput`), and collapsing them into one generic method would just move
 * that distinction into a runtime branch this interface can otherwise let the type system carry.
 */
/** The deploy registry's hosts (`GET .../system/publish-targets`) — every host whose descriptor
   *  takes a credential is a publish provider on this page, with its label, fields and help. */
/** The source-control hosts plugins declare (`GET .../system/source-control/providers`), with
   *  their credential forms. */
/** Idempotent — deleting an id that is already gone still resolves. */
/** Idempotent — deleting an id that is already gone still resolves. */
/** Backs the "Add custom provider" capability — a THIRD, separate method group rather than
   *  folding into `publish`/`sourceControl` above, same "differently-shaped connection input"
   *  reasoning this interface's own header gives for keeping those two apart; `create`/`update` also
   *  carry `category`/`baseUrl`, which neither sibling group has at all. */
/** Independent of `connection` — see `lib/api.ts`'s `updateCustomCredential` doc for the
         *  omit/`null`/string tri-state and the server-side precedence when both are sent. */
/** Idempotent — deleting an id that is already gone still resolves. */
```

## hooks/other-credentials-dependencies.hooks.ts

```ts
/** The live implementation, as a module-level singleton — matches
 *  `access-tokens-dependencies.hooks.ts`'s `defaultAccessTokensPort`. Every method is a thin bind
 *  onto an existing `api.*` call already used by AI Assistant, Settings' Execution mode tab, Media's
 *  Providers tab, or Settings' External MCP tab — see `other-credentials-port.hooks.ts`'s
 *  own header for why this page adds no new HTTP surface. */
/** {@link createFakeOtherCredentialsPort}'s site-assistant slice — one small named helper per
 *  Tier-2 store, dispatched by composition rather than inlined, same "extract, don't inline"
 *  discipline this repo's complexity gate forces everywhere else (e.g. a widened
 *  `validateConnection` split into one small named validator per vendor). Each of these six helpers
 *  carries only ITS OWN store's `??` fallbacks, so no single function's branch count can climb back
 *  toward the cap the way one flat 15-field object literal did.
 *  @complexity O(1) — three independent `??` fallbacks. */
/** {@link createFakeOtherCredentialsPort}'s admin-BYOK slice — see {@link siteAssistantCredentialDefaults}'s doc.
 *  @complexity O(1) — three independent `??` fallbacks. */
/** {@link createFakeOtherCredentialsPort}'s media-providers slice — see {@link siteAssistantCredentialDefaults}'s doc.
 *  @complexity O(1) — two independent `??` fallbacks. */
/** {@link createFakeOtherCredentialsPort}'s external-MCP slice — see {@link siteAssistantCredentialDefaults}'s doc.
 *  @complexity O(1) — two independent `??` fallbacks. */
/** An in-memory {@link OtherCredentialsPort} for tests — every call defaults to a neutral,
 *  overridable stub, matching `createFakeAccessTokensPort`'s per-call override shape. Every
 *  "get" defaults to the honest empty/unconfigured state (nothing saved anywhere in this
 *  workspace), never to a fabricated connected one.
 *
 *  Composes the four per-store helpers above by plain object spread — zero branches of its own
 *  (spreading is not a conditional), which is what brings this function back under the complexity
 *  cap; the original flat version inlined all fifteen `??` fallbacks here directly and hit 17.
 *  @complexity O(1) — no branches, four spreads. */
```

## hooks/other-credentials-port.hooks.ts

```ts
/**
 * @file What `useOtherCredentials` needs from the outside world, as an interface rather than a
 * direct `lib/api` import — same `useX(dependencies)` / `useWiredX()` shape
 * `access-tokens-port.hooks.ts` uses for Tier 1. One method group per Tier-2 store
 * (`rules.ts`'s `OTHER_CREDENTIAL_STORES`), every one of them a thin bind onto an `api.*` call that
 * ALREADY exists and already backs a real settings screen — this page adds no new HTTP surface here
 * either, only a second reader (and, for three of the four, a second writer) of the same endpoints.
 *
 * Deliberately not one generic `get`/`set`/`remove` trio: the four stores return genuinely
 * different shapes (a single write-only credential view, a provider-keyed map, a server list), and a generic signature would just move that difference into a
 * runtime `unknown` cast at every call site — the same reasoning `AccessTokensPort` gives for keeping
 * `publish`/`sourceControl` as two flat method groups instead of one.
 */
/** Sends the WHOLE map — a provider absent from `providers` is deleted server-side (`put-providers.ts`'s
   *  own doc), so a caller replacing or removing ONE provider's key must still round-trip every other
   *  provider's own entry unchanged. See `use-other-credentials.hooks.ts`'s `replaceMediaProviderKey`/
   *  `removeMediaProviderKey` for where that reconstruction happens. */
```

## hooks/security-permissions-dependencies.hooks.ts

```ts
/**
 * @file The only place `use-security-permissions.hooks.ts` reaches `lib/api` — see
 * `security-permissions-port.hooks.ts` for why the split exists.
 */
/** The live implementation, as a module-level singleton — matches `comments-dependencies
 *  .hooks.ts`'s `defaultCommentsPort`. */
```

## hooks/security-permissions-port.hooks.ts

```ts
/**
 * @file What `use-security-permissions.hooks.ts` needs from the outside world, as an interface
 * rather than a direct `lib/api` import — same shape as `comments-port.hooks.ts`'s `CommentsPort`
 * and `use-external-mcp-admissions.hooks.ts`'s `ExternalMcpAdmissionsPort.me`.
 */
/** Narrowed to the one field this hook reads — the real `api.me()` also returns `user`, which
   *  this hook never uses. Matches `comments-port.hooks.ts`'s identical narrowing. */
```

## hooks/site-token-dependencies.hooks.ts

```ts
/** The live implementation, as a module-level singleton — matches
 *  `defaultAccessTokensPort`'s own convention. Every method is a thin bind onto an existing
 *  `api.*` call. */
```

## hooks/site-token-port.hooks.ts

```ts
/**
 * @file What `useSiteToken` needs from the outside world, as an interface rather than a direct
 * `lib/api` import — same shape as `access-tokens-port.hooks.ts`/`other-credentials-port.hooks.ts`.
 * No rotate/replace (see `SiteTokenTab.tsx`'s own header); the last three methods are the locked
 * site's recovery ("Paste your old token", "Start fresh").
 */
/** The raw key value, on demand — see `lib/api.ts`'s `revealSiteToken` doc. */
/** Throws (an `ApiError`) on a 409 refusal — see `lib/api.ts`'s `generateSiteToken` doc for the
   *  outcomes and codes. */
/** See `lib/api.ts`'s `importSiteToken`. Throws an `ApiError` on a refusal. */
/** See `lib/api.ts`'s `startFreshSiteToken`. Throws an `ApiError` on a refusal. */
```

## hooks/use-access-tokens.hooks.ts

```ts
/**
 * @file The Access Tokens tab's controller — the ONE place that reads and writes BOTH
 * `publish_credential_sets` and `source_control_credential_sets`, merges them into one
 * `kind`-tagged row list, and exposes the multi-row Create/Replace/Remove/default-selection surface
 * neither origin store's own page ever built (`rules.ts`'s own header explains why: both origin
 * pages only ever created ONE — the default — row per provider; this hook is where "a second, third,
 * differently-scoped token" and "which saved token does a publish actually use" get a UI for the
 * first time).
 *
 * ## Two independent fetches, two independent seed-once effects
 *
 * Same `useFetchQuery` + one-time `seededRef` shape `usePublishCredentials`/
 * `useSourceControlCredentials` each already use — duplicated here (not factored into a shared
 * helper) because the two queries have different keys, different snapshot shapes
 * (`AdminPublishCredentialsSnapshot` carries `executionMode`, the source-control one does not), and
 * different failure modes to report independently in {@link AccessTokensController.loadError}.
 *
 * ## No write-on-load migration — the legacy label is display-only, computed fresh every render
 *
 * An earlier pass fired a best-effort `PUT .../:id` on load to rewrite every row still carrying the
 * sentinel label (`"default"`) either origin page ever wrote. That write was rejected before it
 * shipped, for four reasons: it mutates data on a plain page OPEN, which is a surprising thing for a
 * read to do; `(workspaceId, providerId, label)` is UNIQUE, so two tabs open at once (or a React
 * StrictMode double-invoke in dev) can race and one PUT loses to a 409 with nothing to show for it;
 * an install nobody ever opens this page on never migrates, so "v1 transfers the tokens" was never
 * actually true for every workspace; and a failed PUT during a page load has nowhere good to surface
 * an error for what the reader didn't even ask this screen to do. `rules.ts`'s `buildAccessTokenRows`
 * already computes {@link AccessTokenRow.name} correctly on every call — a legacy row reads with its
 * friendly computed name from the very first render, with zero writes, and a REAL label is only ever
 * persisted when a human renames, replaces, or creates a row through this page's own forms.
 *
 * ## The category filter narrows `groups`, not the search count
 *
 * `category`/`setCategory` gate which PROVIDERS even enter {@link groups} (a provider outside the
 * active category is dropped before the query filter ever runs, same as if it didn't exist this
 * render) — {@link AccessTokensController.totalCount}/`matchCount` stay a GLOBAL count across every
 * category on purpose: the search-count line answers "how many tokens does this install hold",
 * which should not silently change meaning depending on which category tab happens to be selected.
 *
 * ## Optimistic Create/Replace, refetch-on-write for Remove/Make-default
 *
 * Create/Replace splice their own known result into local state (one round trip), same pattern
 * `usePublishCredentials.save` uses. Remove and Make-default do NOT — both can change which OTHER row
 * in the same provider group is `isDefault` (delete promotes the most-recently-updated remaining row;
 * `store.ts`'s own invariant, not reimplemented here), so both re-fetch that ONE store's full list
 * after the write rather than duplicating the server's promotion rule client-side. This workspace's
 * saved-credential count is small (`PublishCredentialSetRepoPort.listByWorkspace`'s own doc), so the
 * extra round trip is cheap and correct beats fast-but-possibly-wrong here.
 */
/** The provider's extra descriptor fields, keyed by field name. */
/** The standalone "Add custom provider" dialog's own draft — kept separate from {@link DraftFields}
 *  (used by the seven catalog providers' per-provider add forms) since it carries `category`/
 *  `baseUrl`, which nothing else in this hook's state shapes have. */
/** Raw textarea text — see `rules.ts`'s `CustomCredentialFormFields.additionalHosts` doc. */
/** The `addForms`/`existingDrafts` map key for one provider — a plain string join rather than a
 *  nested `Record<kind, Record<providerId, ...>>`, since every lookup already has both parts
 *  available and a flat map avoids an extra existence check on the outer key at every read.
 *  @complexity O(1). */
/** The provider's extra descriptor fields, keyed by field name. */
/** Whether this form's Save may be pressed, from `rules.ts`'s readiness gates. */
/** Merges one saved row with its own draft/busy state — defaults name to the row's current display
 *  name (Replace's "current Name pre-filled" behavior) and username to the row's own saved username
 *  (2026-09-01: a custom row's `username` is now a plaintext read-model field, {@link
 *  AccessTokenRow.username}'s own doc), with Token/Account left blank, same "never read a secret
 *  back" posture every credential form in this app already has.
 *  @complexity O(1). */
/** The provider's extra descriptor fields, keyed by field name. */
/** Whether this form's Save may be pressed, from `rules.ts`'s readiness gates. */
/** @complexity O(1). */
/** Already filtered against the active search query — see this file's header. */
/** The standalone "Add custom provider" dialog's own public state — a top-level controller field
 *  rather than a `ref`-keyed entry in {@link AccessTokenProviderGroupState.addForm}'s map, since a
 *  custom row is created with no existing provider group to attach the form to (this file's own
 *  header on why `"custom"` rows have no catalog entry at all). */
/** One entry per {@link accessTokenProviders} provider plus one per saved custom credential,
   *  ordered by `rules.ts`'s `sortAccessTokenGroups` (saved-before-unsaved, then category-chip
   *  order, then alphabetical by label — the owner's 2026-09-21 ruling) — `undefined` until BOTH
   *  stores' first load resolves. Unlike `PublishCredentialsController.rows`, a provider's own
   *  `rows` array here can hold more than one saved connection. */
/** The active category filter — `"all"` by default. See this file's header for why this narrows
   *  {@link groups} but not {@link totalCount}/{@link matchCount}. */
/** Every saved row across both stores, regardless of the active query OR category — the
   *  match-count line's denominator. */
/** Saved rows that match the active query, regardless of category — the match-count line's
   *  numerator; equals {@link totalCount} when `query` is blank. */
/** The "Add custom provider" dialog's own field state — see {@link AccessTokenCustomAddFormState}. */
/** Clears the dialog's fields — called on Cancel and after a successful save; does not itself
   *  close the native `<dialog>` (the caller's own ref does that, same split
   *  {@link RemoveConfirmDialog} already draws between this hook's state and DOM visibility). */
/** Translates a rejected create/update/delete into a form-ready string — pulled out of the hook body
 *  for the same complexity-budget reason `publishCredentialSubmitErrorMessage` documents in its own
 *  file. @complexity O(1). */
/** Translates a rejected remove/make-default into a row-ready string via `template` — the
 *  Remove/Make-default counterpart of {@link accessTokenSubmitErrorMessage}, kept separate rather
 *  than widened onto it: neither action has a "duplicate name"/"validation" failure mode to
 *  classify (`classifyAccessTokenSubmitError`'s two special cases are Create/Replace-only), so this
 *  is the plain `describeApiError` extraction alone, worded per-action by the caller's own template
 *  (Terra audit MEDIUM finding, 2026-08-19: neither action surfaced a rejected call at all before
 *  this fix). @complexity O(1). */
/** Combines the three independent list-fetch failures (publish, source-control, custom) into one
 *  user-facing message, publish taking priority — pulled out of the hook body for the same
 *  complexity-budget reason {@link accessTokenSubmitErrorMessage} documents. */
/** Returns the first rejected settlement's reason among `results`, or `undefined` if every one
 *  fulfilled — lets {@link reloadAllStores} surface a background reload's per-store failure to the
 *  user without going back to a `Promise.all` that would discard the OTHER two stores' successfully
 *  refreshed data just because one rejected (2026-09-05 Gemini audit, verified: a just-revoked token
 *  in a store that itself reloaded fine could keep rendering as active, because the ONE other
 *  store's transient failure erased all three). Priority matches {@link accessTokensLoadError}'s own
 *  publish-then-source-control-then-custom order, since `results` is always built in that order.
 *  @complexity O(n) in the settled-result count (always 3 here). */
/** Normalizes one store's update payload into the exact `{label?, connection?, isDefault?}` shape
 *  each port method wants, dispatching on `kind` — the one place a `connection`'s union type is cast
 *  down to the specific store's own type (see `rules.ts`'s `buildAccessTokenConnectionInput` doc for
 *  why this is safe). Split out of {@link useAccessTokens}'s action functions purely to keep each of
 *  those under this repo's complexity gate. */
// The deploy hosts are data from the deploy registry. A failed load leaves only source-control
// and custom providers named; saved publish rows still list, under their own ids.
// The source-control hosts come from plugins the same way; a failed load names none of them.
// Each host's own text (labels, guidance, extra-field labels) in the viewer's locale.
// Set from a background reload (below) — merged into `loadError` so a failed refresh is as
// visible as a failed initial load, instead of the unhandled rejection this used to produce (LOW
// audit finding, 2026-09-03: `reloadAllStores` awaited all three stores with no `catch`).
// Flips true the first time ANY background reload completes (success or failure) — lets
// `loadError` below stop consulting `publishQuery.error`/`sourceControlQuery.error`/
// `customQuery.error` once a reload has run at all, since those three are frozen at whatever they
// were on the INITIAL fetch and nothing ever clears them afterward (2026-09-05 Gemini audit,
// verified: without this, an initial fetch failure showed a permanent error banner even after a
// later background reload fixed the problem, because `accessTokensLoadError(...) ?? reloadError`
// always prefers that stale, never-reset initial error over `reloadError`'s honest "no error"
// `null` — reordering the `??` would not have helped, since a successful reload also produces
// `null`, the exact value `??` treats as "keep checking further"; only gating on "has a reload
// happened at all" tells the difference between "no reload has run yet" and "the last reload
// succeeded").
// Monotonic per-attempt id (extracted into `useSettlementGeneration` 2026-09-06; see that hook's
// doc for why `use-static-publish.hooks.ts`'s own `previewGenerationRef` did NOT adopt it): a
// content-refresh notification can fire again while a previous reload is still in flight
// (2026-09-05 Gemini audit, verified: `useContentRefreshSubscription` invokes `triggerReload` — a
// fresh, ungated `reloadAllStores()` call every time — with no de-dupe of overlapping reloads),
// and network completion order does not have to match start order.
/**
   * Re-reads all three stores directly, bypassing `useFetchQuery`'s cache — an out-of-band write
   * (today `custom_credential_set_username`/`custom_credential_set_token`,
   * `apps/website/src/features/custom-credentials/agent-tools.ts`) has nothing to invalidate that
   * this hook would ever re-read: `publishQuery`/`sourceControlQuery`/`customQuery` only ever feed
   * the ONE-TIME seed effects above (`publishSeededRef` et al.), and every subsequent read this hook
   * shows the operator comes from `publishCredentials`/`sourceControlCredentials`/`customCredentials`
   * local state instead — the same reason `removeToken`/`makeDefault` already call
   * `port.*.list()`/`refetchStore` directly rather than `invalidate()`ing a query nothing re-seeds
   * from. Safe to overwrite unconditionally, unlike `use-settings-slice.hooks.ts`'s guarded
   * `refresh()`: a row's `existingDrafts`/`existingBusy` entry is keyed by row id in its OWN state,
   * not carried on the row itself, so replacing the row list here cannot clobber an operator's
   * in-progress edit or in-flight save the way overwriting a settings tab's single edited `value`
   * could.
   *
   * `Promise.allSettled`, not `Promise.all` (2026-09-05 Gemini audit, CONFIRMED): a `Promise.all`
   * rejects as soon as ANY of the three rejects, discarding the other two stores' already-resolved,
   * genuinely fresher results — a revoked token in a store that itself reloaded fine could keep
   * rendering as active because an unrelated store merely blipped. Each store here is applied
   * independently on its own success, and the first failure (if any) still surfaces through
   * `reloadError` via {@link firstRejectionReason} — no store's failure is silently swallowed, it
   * just no longer holds the other two hostage.
   *
   * Guarded by `settlement` (2026-09-05 Gemini audit, CONFIRMED): with no ordering guard, an older
   * reload that happens to resolve AFTER a newer one already committed its results would overwrite
   * the newer, correct data with its own now-stale snapshot. Every commit below (`if
   * (!settlement.isCurrent(requestGeneration)) return;`) is skipped whenever a newer
   * `reloadAllStores()` call has started since this one began.
   *
   * No longer wrapped in `try`/`catch` (the per-store settlement above is what used to need it) —
   * `triggerReload` below still calls this fire-and-forget (`void reloadAllStores()`, required by
   * `useContentRefreshSubscription`'s `onRefresh: () => void` contract), but nothing in this function
   * can now throw: `Promise.allSettled` itself never rejects.
   */
// superseded by a newer reload
// Stable identity — see `use-media.hooks.ts`'s identical `invalidateList` note for why an inline
// arrow here would resubscribe `useContentRefreshSubscription` on every render for no benefit.
// Once a reload has completed at least once, `reloadError` alone is authoritative — see
// `hasReloadedOnce`'s own doc for why the initial-fetch errors below cannot be trusted past that
// point (they are never reset). Before any reload, this is unchanged from before: the initial
// load's own three-way priority, falling back to `reloadError` (still its initial `null`).
/** Seeds a row's FIRST draft update from the persisted row (name AND username included), not a
   *  blank draft — fixes a HIGH audit finding (2026-08-19 Codex sol bug/architecture audit): the
   *  previous `prev[rowId] ?? blankDraft()` fallback seeded `name: ""` whenever Token/Account/Username
   *  was the first field touched, so the very next render displayed a cleared Name field and disabled
   *  Save until the user retyped it — see {@link existingRowState}'s own analogous, already-correct
   *  fallback (`row.name`), which this now matches. Username joined this same fallback on 2026-09-01:
   *  once a custom row can carry a saved {@link AccessTokenRow.username}, touching Token first (before
   *  ever touching Username) would otherwise blank a saved username out of the draft the identical way
   *  it used to blank Name. @complexity O(1). */
/** {@link replaceToken}'s `kind: "custom"` branch — a custom row has no `AccessTokenFormFields`
   *  shape to build (no `ref`-keyed catalog lookup, no descriptor `values`), so it reuses only what genuinely
   *  applies: {@link customCredentialReplaceReadyToSave}'s readiness rule (rename-alone, username-alone,
   *  or either together is ready, same as a new token — see that function's own doc for why this is
   *  NOT {@link accessTokenReplaceReadyToSave}) and {@link customCredentialNameTaken}'s workspace-wide
   *  duplicate check (see that function's own doc for why it is NOT {@link accessTokenNameTaken}).
   *  Split out purely to keep {@link replaceToken} itself under this repo's complexity gate. */
// Reset to `result.username`, not `fields.username` or blank — `result` is the server's own
// post-write state, so it is correct whether the operator typed a new username, left it blank
// to PRESERVE the one already saved (`buildCustomProviderConnectionInput` omits a blank
// username from the payload rather than sending `""` — see this file's own header), or this
// save carried no `connection` at all (a rename-only patch). Seeding from `fields.username`
// instead would show a stale value whenever the omit-to-preserve path fired; seeding blank
// would resurrect the exact "saved username reads as empty" bug this file exists to fix.
// `row.username` is always undefined here (it is only ever set for `kind: "custom"` rows — see
// AccessTokenRow.username's own doc), so this is a no-op today. Kept for symmetry with
// replaceCustomCredential's identical fallback, so a future publish/source-control provider that
// grows a saved username inherits the correct prefill automatically instead of silently reading
// blank the same way custom rows used to.
// Same symmetry note as this function's draft fallback above: `result` (a publish/source-control
// summary) never carries a `username` fact, so `row.username ?? ""` — not `result.username` —
// is the only value available, and it is always "" today for these two kinds.
/** Removes a saved row, now with real error handling (Terra audit MEDIUM finding, 2026-08-19):
   *  this used to await the API call with no `try`/`catch`, per-row busy/error state, or caught
   *  rejection at all — a normal failure (auth, network, server error) produced an unhandled
   *  rejection and left the operator staring at a row that looked untouched, with no way to tell
   *  the remove had not applied. A rejection now lands in {@link existingBusy}, the SAME per-row
   *  state {@link replaceToken} already renders through `state.error` — no new UI surface needed.
   *  @complexity O(1) plus one network round trip. */
/** Splices the server-confirmed promotion into the right store's local state, via
   *  `deployment/rules.ts`'s `withPromotedDefault` — the `makeDefault` counterpart of
   *  {@link mergeCredential}. Reused rather than reimplemented (terra review 2026-09-20): the old
   *  `makeDefault` treated the write AND the reconcile refetch below as one unit inside a single
   *  try/catch, so a refetch that failed on its own (a real, separate network call) reported the
   *  WHOLE promotion as failed and left the pre-promotion list on screen, even though the server had
   *  already confirmed it. `custom` rows never reach `makeDefault` (`AccessTokensTab.tsx`'s
   *  `TokenRowDefaultIndicator` never renders a "Make default" control for a singleton custom group),
   *  so only the two branches `refetchStore` itself already handles are needed here.
   *  @complexity O(1) dispatch; O(n) inside `withPromotedDefault`. */
/** Best-effort re-read after a promotion the server already confirmed — same shape and reasoning as
   *  `use-publish-credentials.hooks.ts`'s `reconcileCredentials`: a failure here is swallowed because
   *  {@link applyPromotedDefault} already applied the server's own confirmed response, so surfacing an
   *  error would falsely tell the operator the promotion itself failed. */
// See this function's doc — the confirmed local promotion (applyPromotedDefault) stands.
/** Same error-handling fix as {@link removeToken}'s own doc, for the "Make default" action. */
/** One singleton group per saved custom row — no shared catalog entry to group under (this file's
   *  own header), so each row IS its own group. `addForm` is always the inert blank state: creation
   *  happens through the standalone dialog (`customAddForm` below), never through a per-group
   *  `[+ Add another]` affordance — `AccessTokensTab.tsx`'s `ProviderGroup` skips rendering that
   *  affordance for `kind: "custom"` groups for the identical reason. */
// A provider outside the active category is dropped here, before the query filter ever runs —
// see this file's header for why that keeps `totalCount`/`matchCount` a global fact instead.
// A saved row whose provider is not listed still gets its group, so it can be removed.
// Saved-before-unsaved, then category-chip order, then alphabetical by label — the owner's
// 2026-09-21 ordering ruling (`rules.ts`'s `sortAccessTokenGroups` doc). Applied to the
// already-category-and-query-filtered list above, so it holds for the "All" chip, any single
// category chip, and an active search query alike.
/** Returns whether the save succeeded — `AccessTokensTab.tsx`'s dialog uses this to decide whether
   *  to close itself (native `<dialog>` close is a DOM action this hook does not own, same split
   *  {@link RemoveConfirmDialog} already draws). */
/** @complexity O(n) in the provider's own (small) saved-row count. */
/**
 * Binds the real port, and a `t` bound to the real resolved locale — the zero-argument half of the
 * `useX(dependencies)` / `useWiredX()` pair, same shape `useWiredPublishCredentials`/
 * `useWiredSourceControlCredentials` document.
 *
 * `boundT` is a `useCallback` (matching `useWiredSites`'s identical `const t = useCallback(...)`),
 * not a plain arrow function recreated every render (2026-09-05 Gemini audit, CONFIRMED): `t` flows
 * into `reloadAllStores`'s own `useCallback` dependency array above, which is correct — `t` is a
 * genuine dependency there (`accessTokensLoadErrorMessage`/`describeApiError` both call it) — but a
 * dependency that changes identity every render still defeats the surrounding `useCallback` just the
 * same. That in turn gave `triggerReload` a new identity every render, and `triggerReload` is exactly
 * what `useContentRefreshSubscription`'s own header warns changes identity every render (see this
 * hook's own `triggerReload` comment): its effect deps are `[resource, onRefresh]`, so an unstable
 * `onRefresh` tore down and rebuilt the SSE subscription on every single render for no benefit. Only
 * `locale` changing should ever produce a new `boundT`.
 */
```

## hooks/use-other-credentials.hooks.ts

```ts
/**
 * @file The Security page's Tier-2 controller — reads all four single-row/per-item credential stores
 * (`rules.ts`'s `OTHER_CREDENTIAL_STORES`) and exposes Replace/Remove for the three that support it
 * (`store.supportsReplace` — see that constant's own doc for why `external-mcp` doesn't). Sibling to `use-access-tokens.hooks.ts` (Tier 1), not a merge with it: the two tiers read
 * from completely different endpoints with completely different wire shapes, and `AccessTokensTab.tsx`
 * is the one place that renders both controllers' `groups` as one visual list — see that file's
 * header for the 2026-08-16 owner ruling this split answers to.
 *
 * ## One `Promise.allSettled` fan-out, not six `useFetchQuery` mounts
 *
 * Every other hook in this app that reads more than one endpoint (`useAccessTokens` itself, two
 * stores) repeats `useFetchQuery` + a one-time `seededRef` per endpoint. Six stores would mean six
 * near-identical copies of that same eight-line shape for no behavioral difference — none of these
 * reads depend on each other, so there is nothing sequencing would buy. This hook fires all six GETs
 * together in one effect and settles them into one `StoreState` map instead; a single store's own
 * failure is captured on ITS OWN entry (`error`) rather than failing every store's read, which one
 * shared `useFetchQuery` call could not have done without inventing its own multi-key error shape.
 *
 * ## `query`/`category` are OWNED by `useAccessTokens`, not this hook
 *
 * The search box and category filter are one control each across both tiers (`AccessTokensTab.tsx`'s
 * own single list) — duplicating that state here would let Tier 1 and Tier 2 drift out of sync the
 * moment a caller forgot to keep two `query` values equal. This hook takes `filter` as a parameter
 * instead of owning `useState` for either value, the same "controlled from outside" shape a plain
 * `<input value onChange>` uses.
 */
/** `${storeId}:${itemId}` — stable across re-renders, and unique even though `media-provider`/
   *  `external-mcp` can each hold more than one item. */
/** The specific item within a multi-item store (a provider id or server id) — equal
   *  to `store.id` itself for the three single-scope stores, which only ever have one possible item. */
/** This row's own display name — the store's generic label for a single-scope store, or the
   *  item's own name (a media provider's catalog label, an MCP server's own label) for a multi-item one. */
/** What `§10`'s "never a reveal control" ceiling actually allows showing — a masked tail or an
   *  environment-variable-name count. See `rules.ts`'s `maskedTailFact`/`envNamesFact`. */
/** Already filtered against the active search query — mirrors
   *  `AccessTokenProviderGroupState.rows`'s exact contract in `use-access-tokens.hooks.ts`. */
/** One entry per {@link OTHER_CREDENTIAL_STORES} store whose category matches the active filter, in
   *  that fixed order — `undefined` until every store's first read has settled (success OR failure). */
/** Configured items across all six stores, regardless of query or category — pairs with
   *  `AccessTokensController.totalCount` so `AccessTokensTab.tsx` can report one combined count. */
/** Configured items across all six stores that match the active search query, regardless of
   *  category — pairs with `AccessTokensController.matchCount` the same way. */
/** One store's raw read result — `items` is `undefined` until this SPECIFIC store's read settles
 *  (independent of every other store's), so a slow media-provider call never blocks a fast BYOK one from
 *  rendering. `loadError` is this store's own failure, kept apart from every other store's so one
 *  down store never hides the rest. */
/** Reads one single-`apiKey` store's current value into its (0 or 1) row — `site-assistant`/
 *  `admin-byok` share this exact "isSet, plus a bare tail" shape; only the two GET calls' own field
 *  names differ, which the two small readers below normalize before this shared mapper ever runs. @complexity O(1). */
/** Every configured media-provider key — one row per provider whose `apiKeyConfigured` is true, not
 *  one row for the whole store (the owner's own mock names a SPECIFIC provider, "Cloudinary (media)",
 *  as its own row — see `rules.ts`'s `OtherCredentialStoreInfo.label` doc for the placeholder-vs-item
 *  heading split this produces). @complexity O(p) in this workspace's own (small) configured-provider
 *  count. */
/** Every configured external MCP server — @complexity O(s) in this workspace's own (small) server
 *  count. */
/** Dispatches one store's read by id — the one place `OtherCredentialStoreId` is switched over for
 *  reads, mirroring `rules.ts`'s `buildAccessTokenConnectionInput` dispatch-by-kind pattern.
 *  @complexity O(1) plus whichever reader's own complexity. */
/** Builds the full `{apiKey?, baseUrl?, model?}` map to PUT back for a media-provider Replace/Remove
 *  — every OTHER provider's entry is carried through with no `apiKey` (a blank `apiKey` PRESERVES the
 *  stored key, `put-providers.ts`'s own doc) but WITH its own `baseUrl`/`model`: the server writes
 *  those two from the submitted entry, not the stored row (`provider-credential-store.ts`'s
 *  `buildProviderUpsertRow`), so sending `{}` used to null them on every other provider. The target
 *  provider carries its new key plus its own `baseUrl`/`model` (Replace) or is omitted entirely
 *  (Remove). @complexity O(p) in this workspace's own (small) configured-provider count. */
/** The writable, non-secret settings of one provider's GET view — `baseUrl`/`model` when present,
 *  never the read-only markers (`apiKeyConfigured`/`apiKeyTail`/`source`), which are view facts the
 *  PUT does not take. @complexity O(1). */
/** Translates a rejected Tier-2 write into the same save-error string Tier 1 uses — no
 *  duplicate-label case here (nothing on this tier is named), so this is the plain
 *  `describeApiError`-wrapped base case only. @complexity O(1). */
// Fires once per mount — see this file's header for why six independent reads settle into one
// effect instead of six `useFetchQuery` mounts. Each store's own result lands on its own map entry
// as it settles, so a fast store renders before a slow one resolves.
// Intentionally empty deps beyond the mount guard above — `port`/`t`/`locale` are stable for the
// lifetime of one mounted controller (bound once in `useWiredOtherCredentials`), matching
// `useAccessTokens`'s own seed-once effects.
// biome-ignore lint/correctness/useExhaustiveDependencies: port/t/locale stable for the mounted controller's lifetime — see comment above; mount guard above prevents double-fetch.
// One lane for every Tier-2 write from this controller: a media-provider write is GET map →
// rebuild → PUT the WHOLE map, so two writes in flight at once would both rebuild from the same
// snapshot and the second PUT would re-create whatever the first one removed. The shared lane makes
// each write read the map only after the previous write (and its refetch) settled. Tab-local by
// nature — two browser sessions still race; closing that needs a server-side concurrency check.
/** Builds one store's group — filters its raw items by the active search query, same
 *  `otherCredentialMatchesQuery` contract `AccessTokensTab.tsx`'s own visibility check applies to the
 *  (possibly still-empty) result. Pulled out of {@link useOtherCredentials} purely for the complexity
 *  gate. @complexity O(n) in this store's own (small) item count. */
/** Re-reads one store after a successful write — Tier 2 has the same "a write can change more than
 *  the one field the form touched" reasoning `use-access-tokens.hooks.ts`'s own `removeToken`/
 *  `makeDefault` document for Tier 1, and every write here is already a full round trip (there is no
 *  optimistic splice to do instead — a media-provider Remove, for instance, has to know the CURRENT
 *  server-side map to rebuild it, so a stale local copy is not a safe base for a second consecutive
 *  write). @complexity O(1) plus whichever reader's own complexity. */
/** Dispatches one store's Replace write — the one place `OtherCredentialStoreId` is switched over
 *  for writes. `media-provider` rebuilds the whole map first (see {@link rebuildMediaProviderMap});
 *  every other supported store is a direct single-field PUT. `external-mcp`
 *  never reaches here (`replace` checks `supportsReplace` first). @complexity O(1) plus the
 *  media-provider rebuild's own O(p). */
/** Dispatches one store's Remove write — mirrors {@link writeReplace}'s dispatch, but every store
 *  here DOES support Remove (unlike Replace, §8/the owner ruling never narrows Remove to a subset).
 *  @complexity O(1) plus the media-provider rebuild's own O(p). */
/**
 * Binds the real port, and a `t` bound to the real resolved locale — the zero-argument-except-filter
 * half of the `useX(dependencies)` / `useWiredX()` pair, same shape `useWiredAccessTokens` documents.
 * Takes `filter` because `query`/`category` are owned by `useAccessTokens` — see this file's header.
 */
```

## hooks/use-security-permissions.hooks.ts

```ts
/**
 * @file `Security.tsx`'s own affordance-hiding controller: whether the current principal holds
 * `admin.security.tokens.manage` (`SITE_TOKEN_MANAGE_PERMISSION`), which decides whether the Site
 * Token tab is even offered. This is UX-only — `hasPermission`'s own header says so, and every
 * site-token route re-checks server-side regardless (`site-token-permission.ts`).
 *
 * `canManageSiteToken` is a plain `boolean`, never a tri-state: `hasPermission(undefined ?? [],
 * ...)` is `false` while the `/auth/me` read is still in flight, which is exactly the "treat
 * unknown as not-permitted" behavior the tab needs — there is no separate `loading` flag to
 * thread through `Security.tsx`'s render because the false-while-loading value already IS the
 * correct render (hidden), not a placeholder for one.
 */
/** `false` until the `/auth/me` read resolves AND the caller holds the permission — see this
   *  file's header for why loading and "confirmed absent" share the same value on purpose. */
// Namespaced under "security" — same convention `use-access-tokens.hooks.ts` uses for its own
// three list reads (`["security", "publish-credentials"]` etc.) and `comments/rules.ts`'s
// `KEYS.permissions` (`["comments", "permissions"]`) uses for this exact same `/auth/me` read.
/**
 * Binds the real `/auth/me` client — the zero-argument half of the `useX(port)` / `useWiredX()`
 * pair, same shape `useWiredComments`/`useWiredExternalMcpAdmissions` document.
 */
```

## hooks/use-site-token-recovery.hooks.ts

```ts
/**
 * @file The Site Token tab's last-resort recovery for a locked site (server:
 * `routes/system/site-token.ts`'s `import` / `start-fresh`): "Paste your old token" and "Start
 * fresh" with one typed confirmation. All state and copy live here; `SiteTokenTab.tsx` only renders.
 *
 * The pasted token is cleared from state as soon as it is accepted. Refusals show the server's own
 * plain sentence (`body.detail`), which always says whether anything changed.
 */
/** The exact phrase "Start fresh" needs typed — the server checks the same string. */
/** No-op for an empty paste or while a request is in flight. */
/** `loading` while the preview is fetched; `confirm` once it is shown. */
/** No-op unless {@link canConfirmStartFresh}. */
/** What the last successful recovery did, in plain words; `null` before one. */
/** Whether the tab should offer recovery: saved credentials need a key that is not in place.
 *  @complexity O(1). */
/** The status card's note for a locked site — replaces "A key is created automatically…", which
 *  is not true there (boot refuses to mint over saved credentials). `null` when not locked.
 *  @complexity O(1). */
/** The server's own sentence for a refusal, else the shared fallback. @complexity O(1). */
/**
 * @param onRecovered - re-reads the tab's status after a successful recovery.
 */
/** Binds the real port and the resolved locale — same `useWired*` shape as `useWiredSiteToken`. */
```

## hooks/use-site-token.hooks.ts

```ts
/**
 * @file The Site Token tab's controller — status + reveal + generate, no update/delete/rotate
 * (see `SiteTokenTab.tsx`'s own header for why a rotate/replace flow is deliberately not built).
 *
 * ## Reveal is ONE mechanism, not two
 *
 * An earlier brief had generate show its new value once, at creation, with a "will not be shown
 * again" warning, and every other read stay fingerprint-only. The owner superseded that ("i want
 * that token to be visible to admins or else when it breaks they have no idea whats going on"),
 * so this controller does not build a second, generate-specific reveal path — `reveal()` is the
 * one way this tab ever shows a key value, usable at any time a key is active, including
 * immediately after a successful `generate()` (which does NOT auto-populate `revealedHex` — the
 * operator clicks Reveal same as any other time, consistent with "never shown on page load, only
 * behind an explicit action" applying uniformly rather than making creation a special case).
 *
 * `revealedHex` is local state, not derived from `status`: the value exists nowhere else in this
 * controller (`AdminSiteTokenStatus` never carries it — see that type's own doc), and clearing it
 * (`hideRevealed`) only ever removes it from THIS state, never from the server.
 */
/** `undefined` until the first status read settles (success or failure). */
/** The revealed key value, or `null` before the first reveal / after {@link hideRevealed}. */
/** No-op when nothing is active to reveal. */
/** The classified failure (see {@link SiteTokenGenerateFailure}) — `SiteTokenTab.tsx` renders the
   *  server's own sentence for `"locked"`/`"refused"`, fixed copy for `"already-exists"`, and wraps
   *  `detail` in "Couldn't generate a key: …" only for `"generic"`. Kept as the classification
   *  itself, not a pre-rendered string, so a known refusal never reads as a genuine failure. */
/** No-op (and leaves `generateError` alone) unless `status.source === "none"` — the tab's own
   *  Generate control is hidden outside that state (sol packet-3 finding 3-1), this is a second,
   *  defensive guard against a stale click. */
/** Re-reads the status (after a recovery); clears a stale generate refusal. */
/** Classifies a rejected generate call against the 409 codes `POST .../generate` sends
 *  (`lib/api.ts`'s `generateSiteToken` doc) — same "check `e.code ?? e.message`" shape
 *  `rules.ts`'s `classifyAccessTokenSubmitError` documents for Tier 1, reimplemented locally
 *  rather than imported: this tab has no other reason to depend on that file's provider-catalog
 *  tables.
 *  - `locked`: saved credentials need a key that is not here (`KEY_DEPENDENT_DATA`, `KEY_MISMATCH`)
 *    — the tab offers the recovery screen.
 *  - `refused`: nothing was changed for another reason (`KEY_INVALID`, `SITE_META_UNREADABLE`).
 *  - `already-exists`: production only, a key file appeared mid-request.
 *  `detail` is the server's own plain-words sentence (`body.detail`). @complexity O(1). */
// biome-ignore lint/correctness/useExhaustiveDependencies: port/t/locale stable for the mounted controller's lifetime (bound once in useWiredSiteToken); mount guard above prevents double-fetch.
// Every success (`already-active`, `recovered`, `created`) leaves a key that matches the
// `.site-meta.json` stamp — the server refuses with a 409 rather than leave a mismatch.
/**
 * Binds the real port, and a `t` bound to the real resolved locale — the zero-argument
 * `useX(dependencies)` / `useWiredX()` pair, same shape `useWiredOtherCredentials` documents.
 */
```

## index.ts

```ts
/**
 * @file Public surface of the `security` feature.
 *
 * `panels.tsx` imports from HERE, never from a file inside this folder — same feature-boundary
 * convention `deployment/index.ts`/`source-control/index.ts` document.
 */
```

## rules.ts

```ts
/**
 * @file Pure data and computation for the Security page's Access Tokens tab — no React, no fetch,
 * no `t()` calls (every function here returns a dictionary key or plain fact for a caller to
 * translate/render). Same `rules.ts`-holds-the-logic convention `deployment/rules.ts`/
 * `source-control/rules.ts` follow.
 *
 * ## What this file does NOT reinvent
 *
 * This page is a UI consolidation over two credential stores that already exist and already work —
 * `publish_credential_sets` (hosts from the deploy registry's descriptors, `GET .../system/publish-targets`)
 * and `source_control_credential_sets` (hosts from plugins, `GET .../system/source-control/providers`). Every
 * provider's display label, token-creation URL, and scope-guidance copy is READ from those two
 * sources, never redeclared here — the owner's 2026-08-15 narrowing of that guidance text
 * (`source-control/rules.ts`'s own header records it) stays the one place it's written. Connection
 * shaping is the same story: {@link buildAccessTokenConnectionInput} below dispatches to
 * `buildCredentialConnectionInput`/`buildSourceControlConnectionInput` rather than re-deriving either
 * provider's wire shape.
 *
 * ## The two-store "GitHub" trap this file exists to not get wrong
 *
 * `github-pages` (a publish target, `publish_credential_sets`) and `github` (a source-control
 * identity, `source_control_credential_sets`) are two different tables, two different scopes, two
 * different tokens an operator creates separately on GitHub's own site — see
 * `ADS-memory/reports/continuity/2026-08-16-session-6-handoff.md`'s "Publish-credential reuse" note
 * for the exact mismatch this has already bitten once. Every {@link AccessTokenProviderRef} and
 * {@link AccessTokenRow} below carries an explicit `kind` precisely so a caller can never merge the
 * two into one row — {@link accessTokenProviders} lists both as separate entries even though they
 * share the "GitHub" proper noun.
 *
 * ## One list, all eight stores — the 2026-08-16 owner ruling
 *
 * The page used to split into a 7-provider "Tier 1" list plus a banner naming six more stores it
 * didn't read yet. The owner, shown that shape next to a single filtered list, chose the list: "from
 * a person's point of view a Cloudinary key and a GitHub token are the same kind of thing — a secret
 * this install holds." {@link ACCESS_TOKEN_CATEGORIES} is the filter that replaces the tier split —
 * every provider AND every {@link OtherCredentialStoreInfo} carries a `category`, and `AccessTokensTab.tsx`
 * renders both kinds of row through the same list, filtered by the same search box and the same
 * category row. The Tier 1 / Tier 2 vocabulary survives only as a CAPABILITY difference now (Tier 1
 * gets `[+ Add]` and multiple named rows; Tier 2 gets `[Replace]`/`[Remove]` and a deep link, never a
 * second Create), not as two separate surfaces — see `OTHER_CREDENTIAL_STORES`'s own doc below.
 */
/**
 * This screen's name on `lib/content-refresh-bus.ts` — see `../taxonomy/rules.ts`'s
 * `TAXONOMY_RESOURCE` for why this is a plain colocated constant rather than a shared registry.
 * `custom_credential_set_username`/`custom_credential_set_token`
 * (`apps/website/src/features/custom-credentials/agent-tools.ts`) are agent-callable — an assistant
 * repairing a saved credential's username after a 401 is exactly the "wrote something this screen
 * cannot see" case `use-taxonomy.hooks.ts` first fixed for taxonomies. One resource for all three
 * merged stores (publish/source-control/custom), matching that this is one screen with one list, per
 * this file's own "2026-08-16 owner ruling" section above.
 */
/** The permission that gates the Site Token tab's very visibility, not just its actions — mirrors
 *  `apps/website/src/features/identity/site-token-permission.ts`'s `SITE_TOKEN_MANAGE_PERMISSION`
 *  literal. Duplicated as a plain string rather than imported: this app cannot import server code,
 *  the same reason `use-external-mcp-admissions.hooks.ts` duplicates `"system.write"` rather than
 *  importing it. */
/** Which credential store a row belongs to. `"custom"` (2026-08-17) is the odd one out — see
 *  {@link AccessTokenRow.category}'s own doc: it has no fixed provider catalog behind it at all, an
 *  operator-typed row IS its own provider identity. */
/** The category filter row's own ids — `"all"` plus one bucket per real category. Every provider
 *  and every {@link OtherCredentialStoreInfo} lands in exactly one of the non-`"all"` ids (the owner's
 *  own requirement, 2026-08-16 ruling). `"general"` (2026-08-17) is the sixth bucket, added
 *  specifically for "Add custom provider" rows whose vendor doesn't fit the other five (that
 *  capability is also the only thing that can ever set it — no built-in provider uses it). */
/** The category actually stored on a row — never `"all"`, which exists only as the filter's own
 *  "show everything" option and would be meaningless as a row's own classification. */
/**
 * The filter row's fixed order — `All` first and default (owner's own list, 2026-08-16 ruling:
 * "All / Source control / Hosting / Media / AI / Ops"). Split from the seven Tier 1 providers'
 * `purposeLabel` ("Hosting"/"Source control"), which is a per-provider DISAMBIGUATOR shown next to
 * a name, not a filter bucket — `github-pages` and `vercel` share the `"hosting"` category here even
 * though only `github-pages` needed a purpose subtitle to tell it apart from source-control's own
 * `github`. `purposeLabel` used to read "Publishing" for the four hosting providers, and "Source
 * Control" (title case) for the three source-control providers — the owner's 2026-09-21 ruling
 * collapsed BOTH onto the exact same string as this filter chip's own label ("Hosting"/"Source
 * control"), so a row's subtitle and the category chip that filters it always agree, letter for
 * letter (round 2 of that same ruling caught the source-control half: a custom row's `purposeLabel`
 * already read this table's own "Source control" via {@link accessTokenCategoryLabel}, so only the
 * three hardcoded catalog entries below were still out of step).
 */
/** A category id's own display label — `"general"`'s row-heading counterpart to
 *  {@link AccessTokenProviderInfo.purposeLabel} for a custom row, which has no static catalog entry
 *  to read a `purposeLabel` from (see {@link accessTokenRowProviderInfo}). Falls back to the id
 *  itself only if the category table is somehow missing an entry (defensive — every
 *  {@link AccessTokenRowCategoryId} value has a matching row in {@link ACCESS_TOKEN_CATEGORIES} by
 *  construction). @complexity O(1) — six-entry table. */
/** Whether `rowCategory` should show under the active category filter — `"all"` matches everything,
 *  every other id matches only its own bucket. @complexity O(1). */
/** Identifies one provider across either store — the minimal shape enough to look up its
 *  {@link AccessTokenProviderInfo} entry or build its connection input. `providerId` is left as
 *  `string` (not the store's own strict union) deliberately: this ref is a client-side grouping key
 *  built exhaustively from {@link accessTokenProviders}' own two sources, never from
 *  free-form input, so the real type safety that matters — the wire shape a create/update actually
 *  sends — lives in {@link buildAccessTokenConnectionInput}'s dispatch to each store's own strictly
 *  typed builder, not in this grouping key. */
/** One provider row this page can render — a `kind`-tagged merge of a deploy host's descriptor /
 *  `SourceControlProviderInfo`, plus `purposeLabel` (new here): the subtitle that keeps `github-pages`
 *  and `github` from reading as the same credential (this file's own header, "the two-store GitHub
 *  trap"). Omitted (undefined) for a provider whose brand name is not shared with any other store
 *  today — showing a purpose subtitle only when a name actually needs disambiguating avoids the
 *  visual-spec's own "never merge into one card" rule reading as "always show extra chrome". */
/** Proper noun — rendered verbatim, never translated, same treatment every provider label in this
   *  app gets. */
/** The company an operator actually authenticates to when creating or revoking this token —
   *  deliberately a SEPARATE field from {@link label}. For most providers the two are the same
   *  string, but `github-pages` and `cloudflare-pages` name a PLACE the credential publishes to, not
   *  the company running the token console: there is no revoke page "at GitHub Pages" or "at
   *  Cloudflare Pages", only at github.com / cloudflare.com. Copy that tells an operator where to
   *  create or revoke a token must read this field; copy that says what a saved credential is FOR
   *  (row/group headings, "Add another X token" affordances) keeps reading {@link label} — collapsing
   *  the two into one field is exactly the bug this one exists to prevent. See
   *  For a deploy host this is its descriptor's `credential.vendorLabel` (falling back to its label). */
/** Set for every provider today: `github-pages`/`github` need it to disambiguate, and the other
   *  five get it anyway rather than making disambiguation conditional on which OTHER providers this
   *  workspace happens to have connected — a static fact per provider is simpler to reason about
   *  than one that depends on the rest of the list. */
/** The category-filter bucket this provider lands in — see {@link ACCESS_TOKEN_CATEGORIES}. All
   *  four publish providers are `"hosting"` (they publish a static export TO a host); all three
   *  source-control providers are `"source-control"` (they read/write a repository, never a
   *  deploy target) — the same axis {@link AccessTokenProviderInfo.purposeLabel} already names in
   *  prose for the one provider pair that needs disambiguating (github-pages vs github). */
/** Where to create (and revoke) a token; `""` when the provider names no page (the link is then
   *  not rendered). */
/** What kind of token the provider needs, passed through the translator; `""` when none. */
/** The secret input's label, a host term from its descriptor ("API token"); absent means the
   *  generic "Access token". */
/** Publish hosts only: the descriptor's credential spec — the token field's wire name and every
   *  field {@link buildAccessTokenConnectionInput} sends. */
/** Descriptor fields shown besides Name and the token (a host's non-token credential fields); a
   *  `required` one gates Save. Empty for custom rows. */
/** Custom rows only: the form shows an optional Username (brief's own requirement). */
/** Set on the bare entry for a saved row whose provider is not listed (its plugin switched off or
   *  missing). The row stays visible and removable, but nothing new can be added for it. */
/** One deploy host's Access Tokens entry, built from its descriptor. @complexity O(f). */
/** One source-control host's Access Tokens entry, built from its plugin's descriptor. @complexity O(f). */
/**
 * The providers this page can save a named token for: every deploy host whose descriptor takes a
 * credential (`publishTargets`, in registry order), then every source-control host plugins declare
 * (`sourceControlProviders`); none of either while it loads. Concatenated rather than interleaved
 * so a reader scanning top-to-bottom sees "deploy targets, then source identities" as two blocks.
 * @complexity O(t + s) in the host and source-control provider counts.
 */
/** Looks up one provider's entry in `providers` ({@link accessTokenProviders}). A saved row whose
 *  provider is not listed (its plugin switched off, or the host list still loading) gets a bare
 *  entry named by its own id — never another provider's label, guidance or token page.
 *  @complexity O(n) in the (small) provider count. */
/** `providers` plus a bare {@link accessTokenProviderInfo} entry for every saved publish or
 *  source-control row whose provider is not listed, so no saved credential ever drops off the page
 *  (IRON RULE: it must stay visible and removable). Custom rows group on their own.
 *  @complexity O(r * p) in the saved-row and provider counts (both small). */
/** {@link accessTokenProviderInfo}'s row-aware counterpart — the one `AccessTokensTab.tsx` call
 *  site (`TokenRow`) actually needs, since a `kind: "custom"` row has no catalog entry
 *  {@link accessTokenProviderInfo} could look up (its `providerId` is the row's own id, never
 *  reused by any other row). Every other kind delegates straight through, unchanged. Builds a
 *  SYNTHETIC info from the row's own {@link AccessTokenRow.category}/{@link AccessTokenRow.baseUrl}/
 *  `name` for `"custom"`: `label`/`vendorLabel` both read `row.name` (a custom row has no
 *  destination-vs-vendor split — see {@link AccessTokenProviderInfo.vendorLabel}'s own doc, which
 *  only applies to the two catalog providers it names), `purposeLabel` is the category's own
 *  display label, `tokenPageUrl` is the operator's own base URL (the closest analog this row has to
 *  "where would I go to get/revoke this token"), no extra fields and an optional `username` — a custom row's Replace form asks for Name + Token + an always-optional Username,
 *  never re-collects the base URL (see this file's own header on why baseUrl is create-only).
 *  @complexity O(1). */
/** The dictionary keys `ProviderGroup` shows after a group's name, joined with " · ". A custom
 *  credential gets "Custom credential" first, so one the operator named after a listed host
 *  ("github") never reads as that host's own group. @complexity O(1). */
/** A provider's extra fields split around the secret input, keeping the host's declared order: a
 *  deploy host's fields declared before its token field (S3's Access key ID before its Secret access
 *  key) render above it, the rest below. Other kinds declare no token position, so every extra field
 *  goes below. @complexity O(f) in the field count. */
/** `ProviderGroup`'s own `agentHandle` label (`AccessTokensTab.tsx`) — moved here alongside this
 *  file's other label/fact builders (house rule: no functions in a `.tsx` component; a pure
 *  formatter with no hook state belongs in `rules.ts`, not `*.hooks.ts`, matching
 *  {@link maskedTailFact}/{@link connectedAsFact}'s own placement below). */
/** `TokenRow`'s own `agentHandle` label (`AccessTokensTab.tsx`) — see {@link providerGroupHandleLabel}
 *  for why this lives here rather than in the component. */
/** The two stores' fixed sentinel label — every row Static Site/Source Control ever wrote before
 *  this page existed carries exactly this string (`PUBLISH_CREDENTIAL_ROW_LABEL`/
 *  `SOURCE_CONTROL_CREDENTIAL_ROW_LABEL`, both `"default"` today, kept as two separately-imported
 *  constants rather than one shared literal so a future divergence between the two stores' own
 *  constants is not silently missed here). */
/** The auto-generated display name for a legacy sentinel-labeled row — brief's own requirement
 *  ("give it whatever name you want", so nobody has to re-paste a token they already saved). First
 *  row for a provider gets "{Provider} token"; any additional legacy rows (not producible by any UI
 *  today, but the naming scheme must not collide if a future migration ever runs against more than
 *  one) get "{Provider} token 2", "{Provider} token 3", ...
 *  @complexity O(1). */
/** The wire shape both `AdminPublishCredentialSummary` and `AdminSourceControlCredentialSummary`
 *  already share field-for-field except `providerId`'s literal union — the common subset this file
 *  operates on so {@link buildAccessTokenRows} needs only one implementation for both stores. */
/** One saved token as this page renders it — `name` is always display-ready (the real saved label,
 *  or a computed {@link friendlyLegacyName} for a legacy sentinel-labeled row, resolved fresh on
 *  every render — see `AccessTokensTab.tsx`'s header for why this replaced a write-on-load rename);
 *  `rawLabel` is kept alongside it so a genuine uniqueness check can compare against what the server
 *  actually has stored rather than only against display names. */
/** Set only for `kind: "custom"` rows — a catalog provider's category lives on its
   *  {@link AccessTokenProviderInfo} entry instead ({@link accessTokenProviders}), since every one of
   *  its rows shares the same provider. A custom row has no catalog entry to read one from (its
   *  `providerId` IS its own row id — see {@link buildCustomCredentialRows}), so the category the
   *  operator picked at creation is carried on the row itself. */
/** Set only for `kind: "custom"` rows — the API base URL the operator typed at creation. */
/** Set only for `kind: "custom"` rows that actually have a saved username — the account login the
   *  operator typed at creation, carried on the row so the edit form can PREFILL it. Absent (never
   *  `""`) otherwise. Before 2026-09-01 this could not exist at any price: `username` lived inside
   *  the row's sealed ciphertext, the list route never decrypts, so every edit form rendered a saved
   *  username as blank and the operator had to retype it. It is a plaintext column now. */
/**
 * Builds every row for ONE store (all providers within it) from the server's own summaries, in the
 * order the server returned them. Legacy-name numbering is computed per PROVIDER, in the order rows
 * for that provider appear in `raws` — matches {@link friendlyLegacyName}'s own "first row, second
 * row, ..." framing.
 * @complexity O(n) in this store's total saved-credential count (small — see
 *   `PublishCredentialSetRepoPort.listByWorkspace`'s own doc for why no cap is needed).
 */
/** The wire shape `AdminCustomCredentialSummary` (`lib/api.ts`) carries — kept as a locally-declared
 *  structural subset (like {@link RawCredentialSummary}) so this file's pure functions stay
 *  independently testable without importing the API client's own type for its own sake. */
/** Absent when the credential has no saved username — see {@link AccessTokenRow.username}. */
/**
 * {@link buildAccessTokenRows}'s counterpart for custom-provider rows — much simpler, since a
 * custom row has no shared provider to group under (no legacy-sentinel numbering, no provider-id
 * lookup): `providerId` is set to the row's OWN `id` (unique by construction — see
 * {@link AccessTokenRow.providerId}'s doc on the `AccessTokenProviderRef` grouping-key contract this
 * satisfies trivially, one row per "provider"), `isDefault` is always `false` (no default concept
 * applies — see `types.ts`'s own header on this table's server side), and `category`/`baseUrl`/
 * `username` carry straight through as the row's own plaintext fields.
 * @complexity O(n) in this workspace's own (small) custom-credential count.
 */
// Spread conditionally so a credential without a username has no key at all, matching the
// server's own "absent, never empty string" contract end to end.
/** Whether `row` should show under an active search `query` — matches the provider's brand label
 *  ("GitHub", "Cloudflare Pages"), its purpose subtitle ("Hosting", "Source control"), and the
 *  row's own display name ("Production", "30-day test token"). Case-insensitive, whitespace-trimmed;
 *  an empty query matches everything (the "no filter active" state).
 *  @complexity O(1) per row — three substring checks against already-short strings. */
/** Whether ANY provider row in a `kind`/`providerId` group matches — a group with no saved rows
 *  (the "Not connected" state) still matches whenever its own provider label/purpose does, so an
 *  unconnected provider is still findable by searching its name (e.g. searching "Netlify" before
 *  ever connecting it should still surface the row inviting a first connection).
 *  @complexity O(1). */
/** Whether `name` collides with another saved row for the same provider — case-insensitive,
 *  whitespace-trimmed, same comparison the server's own `(workspace_id, provider_id, label)` UNIQUE
 *  constraint effectively enforces (this is a client-side pre-check so the field can show an inline
 *  `.field-error` before a round trip, not a replacement for the server's own 409). `excludeId` is
 *  the row being edited — replacing a row's OWN current name is not a collision with itself.
 *  @complexity O(n) in this provider's own (small) saved-row count. */
/** One token form's fields, kept together as one shape so {@link buildAccessTokenConnectionInput}
 *  and {@link accessTokenRowReadyToSave} share a single parameter type — mirrors
 *  `SourceControlCredentialFormFields`'s role, plus `name` (the one genuinely new field this page
 *  introduces — see `AccessTokenRow.name`'s own doc) and `values`, the draft of the provider's
 *  {@link AccessTokenProviderInfo.extraFields} keyed by field name. */
/** Whether the provider's required extra fields are filled. @complexity O(f). */
/** Whether a token form has enough typed to save — a non-empty Name (new here; neither origin store's
 *  own form ever asked for one) PLUS whatever `info` says this provider cannot function without
 *  (`token`, always; a host descriptor's required fields). Does not check name uniqueness — that is {@link accessTokenNameTaken}'s job, surfaced
 *  as its own inline error rather than folded into the Save button's disabled state, so a collision
 *  reads as a specific, fixable reason rather than an unexplained disabled button.
 *  @complexity O(k) in this provider's own required-field count (at most one). */
/**
 * The Replace-flow variant of {@link accessTokenRowReadyToSave} — an EXISTING row's Save button,
 * which this page can enable in one more case neither `StaticSiteTab.tsx` nor `ProvidersTab.tsx`
 * supports today: a rename with no new token typed. Both origin pages require a fresh token on every
 * save regardless of connected state (`credentialFormReadyToSave`/
 * `sourceControlCredentialRowReadyToSave` both unconditionally check `token.trim() !== ""`) — this
 * page's own new Name field makes "I just want to rename this, not rotate it" a real, common action
 * (the brief's own "give it whatever name you want" framing), so gating it behind a mandatory token
 * retype would make the rename feature it introduces effectively unusable for that case.
 *
 * Three cases: nothing typed at all → not ready (there is no diff to send). A new name only (token
 * blank) → ready, sent as a label-only `PUT` (no `connection` field, so the stored secret is
 * untouched — same "omitting `connection` keeps the secret" contract `updatePublishCredential`'s own
 * doc states). A new token (rename or not) → ready only once this provider's required extra fields
 * are ALSO filled, same as create — a token replace still needs its extra fields/`username` alongside it
 * because a fresh `connection` object is a full replacement, not a per-field patch.
 * @complexity O(k) in this provider's own required-field count (at most one).
 */
/**
 * Builds the wire connection input for a create/update call — dispatches to
 * `buildCredentialConnectionInput` (a host's descriptor fields, the typed token under its
 * `tokenField`) / `buildSourceControlConnectionInput` by `fields.ref.kind` rather than re-deriving
 * either provider's shape (this file's own header). A publish provider without a credential spec
 * (only the bare fallback entry {@link accessTokenProviderInfo} makes) sends the token as `token`.
 * @complexity O(f).
 */
/** The DOM/agent id suffix of one extra field's input. `accountId` keeps its old `account` suffix
 *  (pinned by agent tooling); every other field uses its own name, hyphenated. @complexity O(n). */
/** Every saved row for one provider, in the order the server returned them.
 *  @complexity O(n) in this workspace's total saved-credential count (small). */
/** The minimal shape {@link sortAccessTokenGroups} needs from a provider group — a structural
 *  subset of `AccessTokenProviderGroupState` (`use-access-tokens.hooks.ts`) so this pure sort has
 *  no dependency on that hook's own types (this file's own convention: `rules.ts` is never imported
 *  BY the reverse direction — see this file's header). `rows` is read only for its `.length` (is
 *  there at least one saved token for this group), never its contents. */
/**
 * The Secrets page's provider-group order — owner's 2026-09-21 ruling. Two tiers: every group with
 * at least one saved row (`rows.length > 0`) first, every "Not connected" group after. Within each
 * tier, grouped by category in the SAME order the filter chips render ({@link ACCESS_TOKEN_CATEGORIES},
 * minus `"all"`, which is the chip row's own "show everything" option and never a row's real
 * category — see {@link AccessTokenRowCategoryId}'s own doc), then alphabetical by the provider's
 * own `label`, locale-aware and case-insensitive (`toLocaleLowerCase()` before `localeCompare()` —
 * same "read like a human alphabetizing a shelf" convention `media/rules.ts`'s `sortMediaByOrder`
 * already uses for its own `"alphabetical"` order).
 *
 * A provider moving from zero saved rows to one (a Save that just succeeded) needs no special case
 * here: {@link AccessTokenGroupSortInput.rows}'s own length IS the tier a caller feeds in on every
 * render (`use-access-tokens.hooks.ts`'s `groups` is rebuilt from scratch whenever the underlying
 * row list changes), so a provider crossing that boundary simply sorts into the other tier the next
 * time this runs. Applies equally whether `groups` is the full catalog (`"All"` chip), narrowed to
 * one category (a single chip active), or narrowed by an active search query — this function only
 * ever reads each entry's own category/label/saved-count, never the set's size or the active
 * filter, so a smaller or single-category input sorts by the identical rule.
 *
 * Returns a NEW array — never mutates `groups` (same "caller's own array survives" contract
 * `sortMediaByOrder` documents for the identical reason: a caller may still need the unsorted list).
 *
 * @complexity Time O(n log n) in the group count (small — one entry per catalog provider plus one
 * per saved custom credential), space O(n) for the shallow copy.
 */
/** Builds an update patch's non-secret/secret halves independently — split out of the hook's own
 *  `replaceToken` purely so that function's own branch count (readiness guard, uniqueness guard,
 *  try/catch, kind dispatch) stays under this repo's complexity gate. `label` is included only when
 *  the operator actually changed the name (a same-value PUT is a no-op write neither store needs to
 *  see); `connection` is included only when a new token was typed — see
 *  {@link accessTokenReplaceReadyToSave}'s own doc for why either can be true alone.
 *  @complexity O(1). */
/** What a rejected credential create/update means for the FORM — a dictionary-key-shaped result to
 *  translate and apply. Mirrors `PublishCredentialSubmitFailure`/`SourceControlCredentialSubmitFailure`
 *  exactly (both stores' routes share the identical `409 -> DUPLICATE_LABEL` / `400 -> VALIDATION`
 *  wire shape — `publish-credentials.ts`'s own header says the source-control route "mirrors" it
 *  verbatim), reimplemented here rather than imported from either feature so this page owns no code
 *  dependency on `deployment/`/`source-control/` beyond their shared, provider-agnostic `rules.ts`
 *  data tables — same boundary `ProvidersTab.tsx`'s own header draws for the identical reason (two
 *  different agents building two different features in the same session). */
/**
 * Classifies a rejected create/update/delete call. Checks BOTH `e.code` and `e.message` for the two
 * known markers, same reasoning `classifyPublishCredentialSubmitError` documents.
 * @complexity O(1).
 */
/** One "Add custom provider" form's fields — the dedicated dialog's own shape, kept separate from
 *  {@link AccessTokenFormFields} (used by the seven catalog providers' Create/Replace) rather than
 *  widened onto it: a custom row collects `category`/`baseUrl`, which no catalog provider's form
 *  ever asks for, and has no `ref`/`values` to carry. */
/** Raw textarea input for extra allowed hosts beyond `baseUrl` (e.g. fly.io needs both
   *  `api.fly.io` and `api.machines.dev`) — one URL per line or comma-separated, operator's
   *  choice; see {@link parseAdditionalHostsInput}. Always optional: a blank value means "no
   *  extra hosts", matching `src/features/custom-credentials/types.ts`'s server-side
   *  `allowedOriginsFor`/`validateAdditionalHosts` omitted-is-not-an-error contract. */
/** Whether `value` parses as an absolute `http`/`https` URL — the client-side twin of
 *  `features/custom-credentials/store.ts`'s own `validateBaseUrl` (same accept/reject rule,
 *  duplicated rather than shared since server code never imports from the admin app). Checked
 *  explicitly rather than trusting "`new URL()` did not throw" — that constructor accepts far more
 *  schemes than this field should (`javascript:`, `mailto:`, a bare `file:`).
 *  @complexity O(1). */
/** Splits {@link CustomCredentialFormFields.additionalHosts}'s raw textarea text into individual
 *  candidate host strings — one per line OR comma-separated (operator's choice, so pasting a
 *  provider's own docs either way just works), trimmed, with blank entries dropped. Does NOT
 *  validate each entry as a URL — see {@link invalidAdditionalHostsEntries} for that, kept
 *  separate so a caller that only needs the parsed list (e.g. building the wire payload) does not
 *  pay for a validation pass it does not need.
 *  @complexity O(n) in the raw text's own length. */
/** The parsed entries that fail {@link isValidHttpUrl} — surfaced as the "Additional hosts" field's
 *  own inline `.field-error`, the same pattern `baseUrlInvalid` already uses for Base URL. An empty
 *  field parses to zero entries and is never invalid (this field is entirely optional).
 *  @complexity O(n) in the number of parsed entries. */
/** Whether the "Add custom provider" dialog has enough typed to save — Name, a valid `http(s)`
 *  Base URL, and a non-blank Access token are all required; Category always has a value (the select
 *  defaults to one, never blank); Username stays optional (this file's own header on why it can
 *  never gate readiness the way {@link accessTokenRowReadyToSave}'s per-provider required fields
 *  do); Additional hosts stays optional too, but every entry typed (if any) must itself be a valid
 *  `http(s)` URL — a half-typed host list should not silently save with the bad entry dropped.
 *  @complexity O(n) in the number of typed additional-host entries. */
/** Whether `name` collides with another saved custom credential — workspace-wide (unlike
 *  {@link accessTokenNameTaken}, which scopes by `providerId`): the server's own
 *  `(workspaceId, label)` UNIQUE constraint has no provider dimension for this table at all (every
 *  custom row's `providerId` is already unique — see {@link buildCustomCredentialRows}'s doc — so
 *  scoping by it the way {@link accessTokenNameTaken} does would never find a real collision). Same
 *  client-side-pre-check-not-a-replacement-for-the-server's-409 posture as that function.
 *  @complexity O(n) in this workspace's own (small) custom-credential count. */
/**
 * {@link accessTokenReplaceReadyToSave}'s counterpart for a saved CUSTOM credential row — a separate
 * function rather than a widening of that shared one, because the two gates diverge on a case the
 * shared one must never allow: a bare, no-token Username edit. For the seven catalog providers,
 * `fields.username` is never shown (only custom rows carry a Username)
 * (`replaceToken`'s own header note: `row.username` is always `undefined` for a non-custom row, so
 * there is no persisted value a lone Username edit could even be a change FROM); folding a
 * bare-username check into the shared gate would make a stray character typed into that field on a
 * rename-only Save incorrectly enable a `PUT` with nothing else to send. A custom row is the opposite:
 * `AccessTokenRow.username` (2026-09-01) is a REAL persisted, independently-editable fact, and
 * `use-access-tokens.hooks.ts`'s `replaceCustomCredential` needs a Save button that lights up for
 * "operator only fixed the username" the exact way it already does for "operator only renamed it" —
 * the live incident this whole field exists for (a saved credential with a wrong/missing username,
 * token already correct).
 *
 * Same three-way shape as {@link accessTokenReplaceReadyToSave} otherwise: nothing typed/changed →
 * not ready. A name change, a username change (typed OR cleared — see
 * {@link buildCustomCredentialUpdatePatch}'s own doc for how a cleared field becomes the server's
 * `null` clear sentinel), or both, with no token → ready. A new token → always ready; unlike the
 * catalog gate there is no required-field completeness check left to run here, since a custom
 * row's synthetic info (`accessTokenRowProviderInfo`) declares none.
 *
 * @complexity O(1).
 */
/** The Save-readiness gate for a SAVED row's Replace form, picked by row kind — the same split
 *  `use-access-tokens.hooks.ts`'s `replaceToken` makes before writing: a custom row uses
 *  {@link customCredentialReplaceReadyToSave} (a username-only change is a real edit), every catalog
 *  row keeps {@link accessTokenReplaceReadyToSave}. `ExistingTokenFields` used to call the catalog
 *  gate for every row, so a custom row's username-only fix left Save disabled even though the
 *  controller would have sent it. @complexity O(1). */
/** Builds the wire connection input for a custom-provider create/update call — just
 *  `{token, username?}`, no provider dispatch (this table has none — see `types.ts`'s own header on
 *  the server side). `username` is omitted entirely when blank, never sent as `""` (mirrors every
 *  other optional-field builder in this file). @complexity O(1). */
/**
 * {@link buildAccessTokenUpdatePatch}'s counterpart for a saved CUSTOM credential row — same "send
 * only what actually changed" shape, plus the one field a custom row's Replace form can now change
 * independently of a token retype: `username` (2026-09-01). `label`/`connection` inclusion follows
 * the shared builder's own rules verbatim (see that function's doc). `username` is included whenever
 * the draft's trimmed value differs from what this row currently has saved — a non-blank value sends
 * the new string, a blank value sends the server's documented clear sentinel (`null`, NOT `""` — see
 * `store.ts`'s `UpdateCustomCredentialInput.username` doc server-side for why a blank string is
 * rejected rather than treated as either "clear" or "leave alone"). Included even when `hasToken` is
 * also true and `connection` therefore already carries its own `username` member: the server's own
 * precedence rule makes the top-level field win in that case, and since both are built from the same
 * `fields.username` here, they always agree — see `store.ts`'s `updateCustomCredential` doc for the
 * full precedence writeup.
 *
 * @complexity O(1).
 */
/** Builds the wire `additionalHosts` value for a custom-provider create/update call —
 *  `undefined` when the field parses to no entries, so the request omits it entirely rather than
 *  sending `[]` (matches `buildCustomProviderConnectionInput`'s own "omit rather than send an
 *  empty/blank value" convention, and the server's own "omitted = no extra hosts" contract).
 *  @complexity O(n) in the raw text's own length. */
/** A stable id for one of the four Tier-2 credential stores — `AccessTokenRow.id`'s counterpart for
 *  the stores this page reads through a completely different set of endpoints (see
 *  `hooks/other-credentials-port.hooks.ts`). This id names the ROW this page renders, not the table. */
/**
 * One Tier-2 credential store — single connection per scope, or per-provider/per-server, but never
 * *named* the way Tier 1 is (no operator-typed label, so no Name field and no `[+ Add]` — see
 * `Security.tsx`'s own header for why Create stays on each store's OWN screen). Read + Replace +
 * Remove + a deep link is the 2026-08-16 owner ruling for every row this produces
 * (`ACCESS-TOKENS-VISUAL-SPEC.md`'s "OWNER RULING" section) — `supportsReplace` narrows that for the
 * one store where "replace" has no honest single-field meaning:
 *
 * - `external-mcp`: a multi-field server config (transport, command, args, allowed tools), not a
 *   single token — a real "Replace" would have to reproduce that whole form, which is exactly the
 *   second-entry-point risk the session-6 handoff warns against for a cross-cutting page. Remove
 *   (`deleteExternalMcpServer`) still applies; editing the rest stays on Settings → External MCP.
 *
 * The other three (`site-assistant`, `admin-byok`, `media-provider`) are all a
 * single `apiKey` field end to end — `supportsReplace: true`, wired through the same
 * retype-and-save shape Tier 1's own Replace already uses.
 */
/** The store's own generic label — shown as a row's heading only when the store has nothing
   *  configured yet (a "— none —" placeholder needs SOME name to search on); a configured row is
   *  headed by its OWN item name instead (a media provider's catalog label, an MCP server's own
   *  label) — see `use-other-credentials.hooks.ts` for where that split happens. */
/** The category-filter bucket this store's rows land in — see {@link ACCESS_TOKEN_CATEGORIES}. */
/** Shown next to a row's name the same way Tier 1's `purposeLabel` is (`" · {purposeLabel}"`) — the
   *  human-readable form of {@link category}, e.g. "Media", "AI", "Ops". */
/** Deep-link text, e.g. "Manage on AI Assistant". */
/** In-app route for the deep link (`lib/router.ts`'s route-path shape, e.g. `/ai-assistant`) —
   *  always this store's OWN screen, since Create/the full field set lives there and nowhere else. */
/**
 * The four Tier-2 stores, in the order this page renders them within each category. The two
 * Composio rows left on 2026-09-27 with the core Composio integration (now the `composio` agent
 * plugin, whose sign-in lives in the `external-mcp` row).
 */
/** Looks up one store's registry entry, falling back to the first — same "the row list can never
 *  render something absent from its own table" guarantee {@link accessTokenProviderInfo} gives Tier 1.
 *  @complexity O(1) — the array has exactly four entries. */
/** Whether a Tier-2 store (or, for a multi-item store, one of its own item names) matches an active
 *  search `query` — mirrors {@link accessTokenProviderMatchesQuery} exactly: the store's generic
 *  label, its purpose subtitle, or (when given) the specific configured item's own name.
 *  @complexity O(1). */
/** A media provider's human catalog label (e.g. `"grok"` → `"xAI Grok Imagine"`) — same
 *  `MEDIA_PROVIDER_CATALOG` lookup `Media.tsx` itself uses, so a media-provider row on this page
 *  reads with the identical name an operator already sees on the Media → External Providers tab. Falls
 *  back to the raw provider id for one this workspace has a stored key under but the catalog no
 *  longer lists (a removed vendor) — a stale id is still a fact worth showing, not a reason to hide
 *  the row. @complexity O(n) in the catalog's own (small, fixed) size. */
/** The masked-tail value fact for a configured single-`apiKey` row (`site-assistant`/`admin-byok`/
 *  `media-provider` — the three stores whose GET response carries a precomputed last-4, per the
 *  visual spec §10: "that's ALL they ever return"). `tail` is already the last 4 characters with no
 *  leading `••••` — those API shapes agree on the bare-tail contract, so this is the one place
 *  that prefix gets added. @complexity O(1). */
/** The value fact for an `external-mcp` row — there is no single token to characterize (§10: "no
 *  per-field tail"), so this reports how many environment variable NAMES are set instead (`envNames`,
 *  already plaintext — see `AdminExternalMcpServer.envNames`'s own doc in `lib/api.ts`). Zero reads as
 *  a fact, not an error: an MCP server can be fully configured with no secrets at all (a local stdio
 *  tool needing no credentials). @complexity O(1). */
/** `AccessTokensSearch`'s own count line (the search box's `role="status"` caption) — whole-sentence
 *  templates keyed by the plural of `totalCount`, not string-fragment concatenation. Gluing
 *  translated words in English order (`"${count} ${tokenWord} ${translate("saved")}"`) can't read
 *  naturally in a language that puts the verb, the count, or the quoted query somewhere else in the
 *  sentence (ja/ko/zh/th all reorder this), so each plural form is one full translated sentence
 *  instead. The plural is chosen by `totalCount` alone (never `matchCount`) — see this file's own
 *  callers for why the visible noun stays anchored to the total, not the filtered subset. `query` is
 *  interpolated raw (not trimmed) to match the box's own display of what was typed.
 *  @complexity O(1). */
```

## security-i18n.ts

```ts
/** Feature-specific Security copy. Shared chrome such as Save and Cancel falls back to COMMON_I18N. */
/** Load error banner — same `{error}`-interpolated template shape
 *  `publishCredentialsLoadErrorMessage`/`sourceControlCredentialsLoadErrorMessage` use. */
/** One row's save-error banner — mirrors `publishCredentialSaveErrorMessage`'s exact shape. */
/** A failed Remove — its own action-specific wording, distinct from
 *  {@link accessTokenSaveErrorMessage}'s "save" copy, so a failed removal never reads as a failed
 *  save (Terra audit MEDIUM finding, 2026-08-19: `removeToken` used to await its API call with no
 *  error handling at all, so a rejected call produced no visible change). */
/** A failed "Make default" — same action-specific reasoning as {@link accessTokenRemoveErrorMessage}. */
/** A duplicate-name rejection — this page's own case, since neither origin store's dictionary has a
 *  template naming a PROVIDER + a NAME the way this page's uniqueness check does (`rules.ts`'s
 *  `accessTokenNameTaken`). */
/** The Remove confirm dialog's three pieces of copy (`rules.ts`'s own "Remove from host, never
 *  Revoke" load-bearing constraint — `development/todos.md:1208`) — kept as templates rather than
 *  built from `t()` fragments plus raw JSX spans, since the load-bearing FACT here (removing here
 *  does not revoke there) is exactly the kind of sentence that must not fragment across a
 *  flat-dictionary boundary and risk a future translator reordering it into something that drops or
 *  inverts the claim. */
/** Two placeholders, not one: `{credentialLabel}` (what the saved row is FOR — `AccessTokenProviderInfo.label`,
 *  e.g. "GitHub Pages") and `{vendor}` (who actually issues/revokes it — `AccessTokenProviderInfo.vendorLabel`,
 *  e.g. "GitHub"). Collapsing both into one `{provider}` placeholder was the owner-reported bug: this
 *  sentence told an operator to revoke "on GitHub Pages", which has no revoke console of its own. See
 *  `rules.ts`'s `AccessTokenProviderInfo.vendorLabel` doc for the full reasoning. */
/** `external-mcp`'s Remove body — the shared {@link removeDialogBody} does not fit: there is no
 *  vendor console to revoke on, and what is lost (a sealed OAuth secret the read API never returns)
 *  cannot be restored. Fully translated, unlike this file's other templates (see its header's KNOWN
 *  GAP): this sentence guards an unrecoverable delete, so it must not degrade to English. */
/** The Tier-2 Remove dialog's body, per store — the non-replaceable `external-mcp` store gets its own
 *  wording (above), the other three keep {@link removeDialogBody} with `purposeLabel` for both
 *  placeholders, exactly as before (Tier 2 has no vendor/destination split — its deep links go to
 *  host's own screens). @complexity O(1). */
/** Site Token tab's load-error banner — same `{error}`-interpolated shape as
 *  {@link accessTokensLoadErrorMessage}. */
/** Site Token tab's generic generate-error banner — used only for a `"generic"` failure; a known
 *  409 (`KEY_DEPENDENT_DATA`/`KEY_MISMATCH`/`KEY_INVALID`/`SITE_META_UNREADABLE`/`ALREADY_EXISTS`)
 *  is shown with its own words in `SiteTokenTab.tsx`, not wrapped in this template. */
/** Site Token tab's reveal-error banner — same `{error}`-interpolated shape. Unlike generate,
 *  reveal has no known-marker cases to special-case (a reveal either works or fails outright), so
 *  this is the only error template that call site needs. */
```

## security-visuals.tsx

```ts
/**
 * @file This page's own small icon set — no icon dependency, same rationale
 * `source-control/source-control-visuals.tsx`'s header gives for its own set. This page owns no code
 * dependency on `deployment/`/`source-control/` beyond their shared `rules.ts` data tables (see
 * `rules.ts`'s own header), so its icons are redrawn locally rather than imported cross-feature too.
 *
 * No brand marks anywhere in this file — GitHub/GitLab/Bitbucket/Vercel/Netlify/Cloudflare Pages all
 * render as plain `translate="no"` text with a generic connection/checkmark glyph beside them, same
 * treatment every provider name in this app gets.
 */
/** The Access Tokens tab's own icon — a key, i.e. the shape a credential is. Added for the Security
 *  page's tab row (owner request, the same pass that added Deployment's five and Source Control's
 *  Providers tab their own icons); this page's two real tabs are this one and {@link SiteTokenIcon}. */
/** The Site Token tab's own icon — a shield, distinct from {@link AccessTokensIcon}'s plain key:
 *  this tab is about the ONE key that protects every OTHER credential, not a credential itself. */
/** The search field's leading icon — always `aria-hidden`, the field has its own visually-hidden
 *  `<label>` carrying the accessible name (`AccessTokensTab.tsx`'s `AccessTokensSearch`). */
/** A connected row's marker glyph — same check-glyph path `source-control-visuals.tsx`'s
 *  `ConnectedMarkIcon` uses, redrawn locally for the same "no cross-feature dependency" reason. */
/** The disclosure chevron beside a connected row's "Replace token" affordance, rotated 180° by CSS
 *  when its `<details>` is open — same path `source-control-visuals.tsx`'s `DisclosureChevronIcon`
 *  uses. Always paired with a visible text label, never alone (that file's own header explains why:
 *  a bare chevron on a settled row was owner-reported as undiscoverable on the Static Site tab). */
```
