# SEO source rationale

Verbatim historical why-comments from the authoritative working-tree input. Active destinations and superseding contracts are in PORT.md.


## MediaRefField.hooks.tsx

/**
 * @file `MediaRefField`'s picker-open state, selection, and clear/preview wiring — colocated with
 * the component per the `<Name>.tsx`/`<Name>.hooks.tsx` extraction pattern (`SitemapModal.tsx`/
 * `SitemapModal.hooks.tsx`, `TabBar.tsx`/`TabBar.hooks.tsx`), so `MediaRefField.tsx` stays
 * props-and-JSX only.
 *
 * `value`/`onChange` are the field's OWN controlled value, not something this hook owns — the
 * three call sites (`Seo.tsx`'s `defaultOgImage`, and `SeoEntryPanel`'s `ogImage`/`twitterImage`)
 * each already have their own state (`useState`, or `fieldValue`/`setField`); this hook only adds
 * the picker dialog's visibility and the two ways a selection/clear can change that value.
 *
 * `port` is injected the same `useX(dependencies)` / `useWiredX()` way every other hook in this
 * app is (see `media-picker-port.hooks.ts`) so a test can describe "selecting this item writes this
 * exact ref" against `createFakeMediaPickerPort` without a real `api.mediaOriginalUrl` call.
 */

/** Whether `MediaPickerDialog` is open. */

/** `MediaPickerDialog`'s `onSelect` — writes the exact `{slug}:public` ref
   *  (`buildMediaRef`, `rules.ts`, readable-slugs S5b) into the field and closes the dialog. */

/** Clears the field to `""` — an OG image must be removable (SPEC intent). */

/** The field's current value resolved to a thumbnail `<img src>`, or `null` when the value is
   *  empty or unparseable — see `resolveMediaRefPreviewUrl`'s own doc. */

/** `MediaPickerDialog`'s `accept` — images only: every field this backs is an og:image /
   *  twitter:image, and a crawler cannot use a video there (2026-10-05, same filter the post
   *  featured-image chooser passes). */

/*"];

export function useMediaRefField(
  value: string,
  onChange: (value: string) => void,
  deps: { port: MediaPickerPort }
): MediaRefFieldController {
  const [pickerOpen, setPickerOpen] = useState(false);

  function handleSelect(item: AdminMedia) {
    onChange(buildMediaRef(item));
    setPickerOpen(false);
  }

  return {
    pickerOpen,
    openPicker: () => setPickerOpen(true),
    closePicker: () => setPickerOpen(false),
    handleSelect,
    clear: () => onChange(""),
    previewUrl: resolveMediaRefPreviewUrl(value, deps.port.mediaOriginalUrl),
    accept: SHARE_IMAGE_ACCEPT,
  };
}

/**
 * Binds the real `/api/.../media` client — see `media-picker-dependencies.hooks.ts`. The
 * zero-argument-dependencies half of the `useX(dependencies)` / `useWiredX()` pair, so
 * `MediaRefField.tsx` composes this and a test composes {@link useMediaRefField} with
 * `createFakeMediaPickerPort`.
 */

## MediaRefField.tsx

/**
 * @file `MediaRefField` — a text input for an `{assetId}:{transformName}` media reference (or a
 * pasted absolute URL), plus a "Choose image" affordance that opens the existing
 * `MediaPickerDialog`, a thumbnail preview of the current value, and a Remove control.
 *
 * Built for `Seo.tsx`'s `defaultOgImage`/`ogImage`/`twitterImage` fields (SPEC intent: "make the OG
 * image selectable, with a preview") — the text input keeps working unchanged (an addition, not a
 * replacement: anyone scripting or pasting a raw ref/URL still can), the picker is the new path.
 *
 * State — the dialog's open/closed flag, the selection handler, and the preview URL — lives in
 * `MediaRefField.hooks.tsx`, split out the same way `MediaPickerDialog`/`MediaPickerDialog.hooks
 * .tsx` does; this file stays props-and-JSX only. `MediaPickerDialog` itself is reused unchanged
 * (`components/MediaPickerDialog/MediaPickerDialog.tsx`) — no fork, no new picker UI.
 */

/** `{...(base ? agentHandle(\`${base}-<suffix>\`, opts) : {})}` as a named helper — same
 *  complexity-budget rationale as `EmbedInsertControl.tsx`'s identical `handleSpread`: each inline
 *  conditional spread below was its own nested ternary inside an already-conditional button
 *  (the `sonarjs/no-nested-conditional` rule this codebase enforces). `{}` (no markup) when `base`
 *  is unset, same as every inline occurrence it replaces. */

/** `<input id>`/`<label htmlFor>` pairing — same `getByLabelText`-friendly shape `Seo.tsx`'s
   *  other explicit-`htmlFor` fields already use. */

/** Forwarded to the `<input name>` only when set — `defaultOgImage` needs this (its `<form>` reads
   *  `FormData` by name on submit); the per-entry `ogImage`/`twitterImage` fields do not (they save
   *  through `fieldValue`/`setField`, never `FormData`), so it stays optional. */

/** This field's own base handle — appended `-choose`/`-clear`/`-dialog` for its own controls, and
   *  forwarded as-is to the `<input>` itself. Omit to leave every element here untagged. */

/** Injectable seam for the picker's own state — same convention as `MediaPickerDialog`'s own
   *  `useDialog` prop. Defaults to the real {@link useWiredMediaRefField}. */

## Seo.hooks.tsx

/**
 * @file The `/admin/seo` tab system's non-JSX logic, plus the three tab glyphs.
 *
 * Everything derived lives here rather than in `Seo.tsx`: the tab-id list and its `?tab=` guard,
 * the tab descriptors, the navigation callback, and the `FormData` -> settings-patch mapping the
 * defaults form used to build inline in its own `onSubmit` (standing rule — a component's derived
 * logic belongs in a sibling `*.hooks.ts(x)`, not in the `.tsx`).
 *
 * `.tsx`, not `.ts`, because {@link resolveSeoTabs} returns `TabBarTab[]` whose `icon` field is a
 * `ReactNode` — the same reason `Sites.hooks.tsx` and this feature's own
 * `MediaRefField.hooks.tsx`/`SitemapModal.hooks.tsx` carry the `x`.
 *
 * ## Why three tabs, and why these three
 *
 * The screen was one long scroll holding three unrelated jobs, and an operator arrives wanting
 * exactly one of them:
 *
 *   - **Site defaults** — "what should search engines and social see for this site by default?"
 *     Set once, at setup, then rarely touched.
 *   - **Sitemap** — "is my sitemap current?" An occasional operations action, not a setting.
 *   - **Pages & posts** — "fix the SEO on this one page." The recurring, per-content job, and the
 *     only part of the screen anyone opens weekly.
 *
 * The split is by cadence and by object, not by markup: site-wide-and-static, ops-action, and
 * one-entry-at-a-time are three different reasons to be here. Being honest about it — those are
 * also, near enough, the three sections the page already had. The design work is in the other
 * three changes: naming them in operator language rather than in the data model's ("Pages & posts",
 * not "Per-entry SEO" — the picker lists posts and pages, and nobody hunting for a page thinks of
 * it as an *entry*), giving the defaults form real internal grouping it never had, and giving the
 * Sitemap tab a state line so it is not two naked buttons.
 *
 * ## The one thing that constrained the split
 *
 * A more Yoast-shaped cut — "Search appearance" / "Social sharing" / "Crawling" — was considered
 * and rejected, because those three groups all live inside ONE uncontrolled `<form>` read via
 * `new FormData(e.currentTarget)` on submit. Splitting them across tabs unmounts the inactive
 * panels' inputs, and an unmounted input is absent from `FormData` — so saving from any tab would
 * silently blank every field on the other two. Fixing that means converting eleven fields to
 * controlled state inside `use-seo.hooks.ts`, which is a behavior change to the save path and well
 * outside a tab conversion. The grouping is instead expressed WITHIN the Site defaults tab, as
 * labelled field groups, where it costs nothing and risks nothing.
 *
 * This is also why "Sitemap enabled" stays on the Site defaults tab while the sitemap ACTIONS sit
 * on the Sitemap tab: the checkbox is part of that same form and cannot leave it. The Sitemap tab
 * reports its state instead of duplicating the control, so there is exactly one switch.
 */

/** Shared attributes for a decorative line icon — copied deliberately from
 *  `deployment-visuals.tsx`'s own `LINE_ICON` so this tab row reads as the same family as the
 *  Deployment tab row it was modelled on (24px grid, 1.5 stroke, round joins). Local rather than
 *  imported across the feature boundary: `features/deployment/index.ts` is that feature's public
 *  surface and does not export it, and this app ships no shared icon module — the sidebar's glyphs
 *  in `App.tsx` and `SettingsUi.tsx`'s tab icons are both inline SVG for the same reason.
 *  `aria-hidden` on every one: each sits directly beside the text label that already says the same
 *  thing (`frontend-accessibility` — do not give an accessible name to decoration that duplicates
 *  adjacent visible text). */

/** Site defaults — sliders, i.e. values that are set once and then apply to everything. */

/** Sitemap — a node branching into children, i.e. the shape of the file this tab rebuilds. */

/** Pages & posts — stacked documents, i.e. the collection this tab edits one at a time. */

/** The three tab ids, in render order. `defaults` is first and is the fallback — it is the only
 *  tab that is meaningful before anything else on the screen has been touched. */

/** Falls back to Site defaults for an absent or unrecognized `?tab=` value, through the same shared
 *  guard `Deployment.tsx`/`Sites.tsx`/`Database.tsx`/`Themes.tsx` use — a stale bookmark or a typo
 *  must open a real tab, never a blank panel. */

/**
 * The three tabs in the shape `TabBar` takes.
 *
 * "Sitemap" is the only label already carried by `seo-i18n.ts` (it is the existing section
 * heading's key, translated in all 21 locales). "Site defaults" and "Pages & posts" are new English
 * keys with no dictionary entries, which is a disclosed gap and not a silent one:
 * `createDictionaryTranslator` falls through feature dict -> `COMMON_I18N` -> the English key
 * itself, so every locale renders correct English rather than a placeholder, and adding
 * translations later is purely additive because in this admin the English copy string IS the key.
 * Hand-writing 21 locales of unverifiable translation for two tab labels is the trade
 * `sites-i18n.ts`'s own header already weighed and declined.
 *
 * @complexity O(1) — a fixed three-element array.
 */

/** `replace: true` so moving between tabs does not grow the back stack one entry per click — the
 *  same call `Deployment.tsx`/`Sites.tsx`/`Themes.tsx` make for their own `?tab=`. A module-level
 *  function, not an inline arrow, so `TabBar`'s `onChange` takes it directly. */

/** One `FormData` field as a string, with the caller's fallback for an absent field. Its own named
 *  function purely so {@link buildSeoSettingsPatch} below stays readable at a glance: written
 *  inline, the seven fields' `?? `/`||` chains scored the patch builder at the ESLint ceiling
 *  (`apps/admin` enforces 9/9 as a hard error) for no gain in clarity. */

/**
 * A `FormData` field that is sent as `null` when blank, rather than persisted as an empty string.
 *
 * `null` is what CLEARS a site default: the server registers these three (`default_description`,
 * `default_og_image`, `twitter_site`) as `nullable: true` and `buildScalarWrites`
 * (`apps/website/src/features/seo/settings.ts`) normalizes `null` to the `""` absent-sentinel that
 * `getSeoSettings` reads back as `undefined`.
 *
 * It used to return `undefined`, under a comment claiming "an empty box means 'no site default'".
 * That was false and is the bug this replaces: `setSeoSettings` is a MERGE, and `buildScalarWrites`
 * does `if (raw === undefined) continue;` — so an omitted key means UNCHANGED, and an operator who
 * emptied "Default meta description" to remove it just saw it come back on the next load, with no
 * way to remove it from this form at all. `undefined` also cannot survive the request: the client
 * `JSON.stringify`s this patch, which drops `undefined` keys and keeps `null` ones.
 */

/**
 * The site-wide settings patch the defaults form submits — lifted out of the form's own inline
 * `onSubmit` when this screen gained tabs. Same seven fields, same `checkbox === "on"` reading of
 * the three toggles.
 *
 * ONE deliberate behavior change since that lift (2026-09-06): the three optional scalars now
 * submit `null` rather than `undefined` when their box is empty, so emptying one CLEARS the site
 * default instead of silently leaving it as it was. See {@link optionalFormString}. `titleTemplate`
 * is unaffected — it is not nullable server-side and an emptied box still submits `""`, which the
 * server rejects with its "must contain '%s'" validation error.
 *
 * @complexity O(1) — a fixed set of field reads, no iteration.
 */

/** The Sitemap tab's one-line state read, so the tab reports whether a sitemap is published at all
 *  instead of offering a Regenerate button with no indication it is switched off. The control
 *  itself deliberately stays on the Site defaults tab — see this file's header. */

## Seo.tsx

/**
 * `SeoSettingsScreen` (SPEC-008 ui.spec.md §2.4) — the site-wide `seo.*` settings form +
 * `SitemapRegenerateButton` (§2.6). Coordinator-authored 2026-07-13, post-session-limit resume.
 * Markup only.
 *
 * State and API calls live in one hook per component: `hooks/use-seo.hooks.ts` (top-level
 * defaults form + sitemap button), `hooks/use-entry-picker.hooks.ts`, `hooks/use-seo-entry-panel
 * .hooks.ts`, `hooks/use-seo-entry-section.hooks.ts`. The issue-severity sort lives in `rules.ts`.
 *
 * SPEC-037 REQ-06/07/08: `SeoEntryPanel` closes the deferred per-entry gap this file's own header
 * used to disclose — a standalone entry picker (dropdown over `listPosts`/`listPages`, cheaper
 * than threading a new panel through `PostEditor.tsx`, per REQ-06's own "implementer's choice")
 * plus a partial-override edit form and a read-only analyze view. `RobotsRuleEditor` (§2.5) is
 * still a minimal textarea-per-rule form (unchanged from the original disclosed scope note).
 *
 * `locale` (standing i18n rule, 2026-08-11 — a component with a hook gets its locale-derived UI
 * copy FROM that hook) comes from `useWiredSeo()` — `useAdminLocale()` is now called only inside
 * that hook, not here — and is threaded down as a prop from there, same as before: see
 * `use-seo.hooks.ts`'s own header for why `EntryPicker`/`SeoEntryPanel`/`SeoEntrySection` get the
 * raw string rather than a bound `t`.
 *
 * ## Tabs (2026-09-06)
 *
 * The three sections above are now three `?tab=` tabs — Site defaults, Sitemap, Pages & posts —
 * built on the shared `@jini-ai/ui/tab-strip` that `Deployment.tsx`, `Sites.tsx`, `Themes.tsx`,
 * `Security.tsx`, `SourceControl.tsx` and `Database.tsx` already use. Nothing new was written for
 * the tab mechanism: the shell was ALREADY extracted (`@jini-ai/ui/tab-strip` for the strip,
 * `lib/resolve-active-tab-id.ts` for the `?tab=` guard), so this screen reuses it rather than
 * becoming a third implementation. The reasoning for the grouping, the tab NAMES, and the one
 * cut that was considered and rejected all live in `Seo.hooks.tsx`'s header.
 *
 * Everything below the shell is unchanged markup, only relocated: `SeoDefaultsTab` holds the form
 * verbatim (with two field-group headings added, which it never had), `SeoSitemapTab` holds the
 * sitemap actions plus a new state line, and the Pages & posts panel IS the existing
 * `SeoEntrySection`, rendered directly rather than wrapped in a new component that would add
 * nothing.
 * No component was split or merged, so `SeoEntryPanel` — the one function in this file carrying a
 * recorded complexity exemption (`development/scripts/admin-complexity-debt.json`, keyed by
 * `{rule, file, reason}`) — stays in THIS file at its recorded measurement. Moving it to a tab
 * file of its own, the way `Deployment.tsx` gives each tab a file, would have made its debt entry
 * name a path that no longer exists and required adding a NEW entry for the new file, growing a
 * baseline that JSON's own instructions say must only shrink. One file, top-level components: the
 * ESLint gate scores functions independently of which file they sit in, so the ceiling is
 * satisfied either way — only the organizational preference differs, and the debt key decides it.
 *
 * ## Out of the cards (2026-09-06, same day)
 *
 * Owner, on the screen the section above describes: "for seo can you take the stuff out of the
 * cards?" Every panel here was a `.card` (Site defaults, Sitemap) or a `.notice` (the two
 * per-entry panels) and is now content laid directly on the page, held together by `SeoSection`'s
 * heading rail and one hairline per seam. `styles/seo.css`'s header carries the measurements and
 * the full reasoning, including why the card was never what grouped the three field groups.
 *
 * Two claims in the paragraph above are now stale and are corrected here rather than rewritten in
 * place, since the tab conversion's own reasoning is still the reason the tabs exist: the defaults
 * form has THREE field-group headings, not two ("Social sharing" was split out in the same
 * commit), and those groups are `SeoSection`s rather than `.field-group` divs. What has NOT
 * changed is the constraint that matters — all seven fields still live in one `<form>`, submitted
 * as one `FormData`, with nothing about them conditional.
 */

/**
 * One titled group on this screen — title in the left rail, controls in the right column. Markup
 * only; every visual decision and the reasoning for the rail lives in `styles/seo.css`'s header.
 *
 * This is the 1:1 replacement for the `<div className="field-group"><h2 className="card-title">`
 * pair `56e87ae0` introduced, and the swap is deliberately structure-preserving: the section body
 * carries `.field-group`'s exact `flex-column` + `--space-4` gap, so the fields inside are laid
 * out identically and NOTHING becomes conditional. That matters more here than anywhere else in
 * this file — `SeoDefaultsTab` submits via `new FormData(e.currentTarget)`, so a field that stops
 * being mounted is simply absent from the payload and silently saves as blank. A wrapper element
 * cannot unmount anything, and `Seo.unit.test.tsx`'s "keeps every defaults field inside ONE form"
 * pins all seven names, in order, against exactly that.
 *
 * Fixed `<h2>` rather than a `level` prop: both callers are top-level groups under the page `H1`,
 * and the one heading on this screen that is genuinely subordinate — `SeoEntryPanel`'s "Per-entry
 * overrides", which sits INSIDE the "Per-entry SEO" section — keeps its own `<h3>` and is not
 * routed through here.
 */

/** Dependency injection seam for tests — the same convention `@jini-ai/ui`'s `CustomSelect` uses
   *  for `useCustomSelect`. */

/** Dropdown over every post + page, sourced from the already-existing `listPosts`/`listPages`
 * routes — cheapest entry-selection UX available given what's already built (REQ-06). */

/* The "Entry" caption is no longer painted (owner, 2026-09-06: "you can actually just get rid of
     'Entry'") — the placeholder option already says "Choose an entry…", so the visible word was
     saying it twice, and with no gap between the two it read as one smashed-together control.
     It stays a REAL label rather than becoming a placeholder-only select: this is the exact
     `<label class="a11y-label-wrap">` + `.visually-hidden` idiom `styles/editor.css` documents for
     the four controls a previous accessibility pass found unnamed — including, by name, a
     `<select>` with no accessible name at all. `display: contents` drops the wrapper's own box, so
     the select keeps the section body's sizing exactly as if the label were not there.
     The i18n key is unchanged and still passed through `t`, so nothing dangles. */

/** Read-only score + issues view (REQ-07) — exact field names read off `SeoAnalysis`/`SeoIssue`
 * (`src/seo/types.ts`), not guessed. No state of its own — only the severity sort, which lives in
 * `rules.ts` as `sortIssuesBySeverity`. */

/** Per-entry overrides edit form (REQ-06). Pre-fills from `getSeoEntry`'s resolved meta, but
 * tracks which fields the user actually touched so `putSeoEntry` only ever sends a genuine
 * partial patch — matching the resolved-vs-override distinction `SeoExtFields` implies (an
 * untouched field must not turn into a persisted override equal to today's resolved default). */

// EXEMPTION (complexity ceiling, 2026-08-06, updated for the ≤9/≤9 bar): ESLint scores this
// component's cyclomatic complexity at 25 against a 9 ceiling, but its cognitive complexity is 6
// (also under 9). That gap between the two is the signature of a
// measurement artifact, not real branching: eleven form fields each read as
// `fieldValue(key, resolved.X ?? default) ?? default`, and ESLint's cyclomatic rule counts every
// `??` as its own decision point — twenty of the twenty-five come from those fallback chains alone,
// none of which nest inside one another or inside each other's control flow (which is exactly what
// keeps cognitive complexity low). The other five points are ordinary flat conditionals (notice,
// saveError, the disabled expression, the Save button's label, the analysis panel) already under
// the ceiling on their own. There is nothing to extract: splitting the eleven fields into their own
// components would still evaluate the same fallback chains, just spread across more functions, for
// no complexity benefit and a real loss of "one form, one place to read its fields."

/* Two `t()` calls in one paragraph, not one longer string: the first sentence's English text
          IS its i18n key and is translated in all 21 locales (`seo-i18n.ts`), so extending it would
          orphan every one of those translations. The second sentence is a new English-only key that
          falls through to itself — the disclosed, additive trade `Seo.hooks.tsx`'s header already
          makes for the tab labels. It exists because a field's two empty states used to be
          indistinguishable AND unescapable: emptying a box stored `""` as a real override, which
          `seo.ts` resolves ahead of the site default, so the operator had no way back. */

/** Section wrapper (REQ-06/07) — entry picker over the per-entry edit + analyze panels. This IS the
 *  "Pages & posts" tab panel; it kept its name and its markup, because nothing about it changed
 *  except that a tab now selects it.
 *
 *  The `<h2>` stays, and deliberately so — dropping it as "redundant with the tab label" was tried
 *  and reverted. A tab label is not a heading: `TabBar` emits `role="tab"` buttons, which do not
 *  appear in a screen reader's heading list at all, so removing this left the whole panel with `H1`
 *  and nothing else — the exact regression `deployment/HistoryTab.tsx`'s own comment records
 *  measuring live on its tab. It is also not a duplicate: the tab reads "Pages & posts" (what you
 *  pick from), the heading reads "Per-entry SEO" (what you are editing). */

/** What the two site-wide tab panels need from `useWiredSeo()`. Named as one object rather than
 *  passed as six loose props for the same reason `Roles.tsx`'s `RoleCreateFormController` documents:
 *  none of these is meaningful without the others, so naming the group is what lets a test hand a
 *  panel a controller instead of assembling one out of parts. */

/**
 * The "Site defaults" tab — the site-wide `seo.*` settings form, moved here verbatim from `Seo`'s
 * own body.
 *
 * ONE addition beyond relocation: the two `.field-group`s now carry headings ("Search appearance",
 * "Crawling"). They are the grouping an operator already thinks in — every SEO tool they have used
 * separates what search/social show from whether to be indexed at all — and the form had no
 * internal hierarchy whatsoever before, just seven controls in a row. Expressing it as headings
 * INSIDE one tab rather than as more tabs is deliberate and load-bearing: see `Seo.hooks.tsx`'s
 * header for why splitting this form across panels would silently blank fields on save.
 *
 * The submit handler is now one call to `buildSeoSettingsPatch` (`Seo.hooks.tsx`) rather than seven
 * inline `??`/`||` field reads — same fields, same fallbacks, same payload, just not written in the
 * `.tsx`.
 */

/* Its own group, not a tail on "Search appearance". These two fields are what a link to this
          site looks like when it is PASTED somewhere — a different question from what a search
          result looks like, and the split every SEO tool an operator has already used makes. The
          form previously ran all four together in one unlabelled `.field-group`, so the OG image
          read as a search-result setting. */

/**
 * The "Sitemap" tab — the two sitemap actions, moved here verbatim, plus one line this screen never
 * had: whether a sitemap is being published at all.
 *
 * That line is the reason this is a tab rather than a footnote on Site defaults. The switch
 * ("Sitemap enabled") cannot move here — it belongs to the defaults form's `FormData` submit, see
 * `Seo.hooks.tsx`'s header — so without a state read, an operator who had sitemaps switched off
 * would find a Regenerate button that appears live and reports success while publishing nothing.
 * Reporting the state instead of duplicating the control keeps exactly one switch on the screen.
 *
 * Wrapped in a `.card` like the defaults form beside it, rather than left as loose text on the
 * page — rendered side by side the uncontained version read as an unfinished panel next to a
 * carded one. The heading is "Cached sitemap", not "Sitemap": it names what the card acts on
 * without restating the tab label, the same way `deployment/OverviewTab.tsx`'s cards are titled.
 * It also has to exist at all — a `role="tab"` button is not in a screen reader's heading list, so
 * a panel with no `<h2>` leaves that reader nothing but the page `H1`.
 */

/** Dispatches the one active tab's panel as a flat if-chain — a plain function rather than a
 *  ternary written directly in `Seo`'s JSX, which would be counted against that component's own
 *  complexity. Same split `Deployment.tsx`'s `deploymentTabPanel` and `Sites.tsx`'s `sitesTabPanel`
 *  make for the identical gate.
 *  @complexity O(1) — three mutually exclusive branches, no iteration. */

/** The `?tab=` query value from `panels.tsx`'s `seo` route (`URLSearchParams.get` returns `null`
   *  when the param is absent). Guarded by `resolveSeoTabId`, so a stale link or a typo opens Site
   *  defaults rather than a blank panel. */

/** Dependency injection seam for tests — the same convention `@jini-ai/ui`'s `CustomSelect` uses
   *  for `useCustomSelect`. Defaulted to the real hook, so production callers (`panels.tsx`) pass
   *  nothing and behave exactly as before. */

/* Both banners stay on the SHELL, above the tab strip, not inside a panel: `error` and
          `notice` come from `useWiredSeo()` and describe the screen's own load/save/regenerate
          outcomes, which are not owned by whichever tab happens to be open. A save confirmation
          rendered inside the Site defaults panel would also be the one thing on the screen that
          silently disappears when the operator switches tabs. */

/* The sitemap modal stays on the shell rather than inside `SeoSitemapTab`: it is a portal-
          shaped overlay over the whole page, and `sitemapModalOpen`/`closeSitemapModal` are shell
          state from `useWiredSeo()`. Unchanged from before the tab conversion. */

## SitemapModal.hooks.tsx

/**
 * @file `SitemapModal.tsx`'s one bit of sequencing that belongs to neither `useSitemapModal` nor
 * the outer `useSeo()` on its own — refetching the sitemap after a successful regenerate
 * (`SitemapModal.tsx`'s own file header already named this as the one thing living outside both
 * hooks). Kept as its own tiny hook, colocated with the component per the
 * `<Name>.tsx`/`<Name>.hooks.tsx` extraction pattern, rather than folded into
 * `use-sitemap-modal.hooks.ts` — that file's `SitemapModalController` is a public DI seam
 * (`SitemapModalProps.useModal`), and adding this sequencing to its signature would be a contract
 * change, not a relocation (2026-09-03 admin TSX-logic-sweep deferred exactly for this reason;
 * resolved here by giving the sequencing its own hook instead of extending that one).
 */

/**
 * @param onRegenerate - Resolves `true` on success, `false` on a caught failure (`useSeo`'s own
 *   `regenerateSitemap`) — only refetches on `true`, matching REQ 7 ("after a SUCCESSFUL
 *   regenerate it refetches"). A failed attempt leaves the currently-shown sitemap exactly as it
 *   was rather than re-fetching the same stale content.
 * @param refetch - `modal.refetch` from `useSitemapModal`.
 * @returns `handleRegenerate`, wired directly to the footer's Regenerate button.
 * @complexity O(1).
 */

## SitemapModal.tsx

/**
 * `SitemapModal` — "View sitemap" (owner request, `Seo.tsx`'s Sitemap card). Reads the exact same
 * `GET /sitemap.xml` bytes a crawler gets (`sitemap-dependencies.hooks.ts`'s `defaultSitemapPort`,
 * via `siteUrl()`) and renders them as a filterable `URL | Last modified` table, with a Raw XML
 * toggle for verifying the literal response text. `changefreq`/`priority` columns were considered
 * and dropped: `server/inbound/public-http/routes/site/sitemap.ts` never emits either field (read
 * directly, not guessed), so a column for them would only ever show blank.
 *
 * Historical chrome rationale (superseded by Jini's native owner in Phase 17): the same
 * `.settings-dialog-backdrop`/`.settings-dialog` chrome as `MediaPickerDialog.tsx` (backdrop
 * click + Escape both cancel, `role="dialog"`/`aria-modal`/`aria-labelledby`, plus a `useFocusTrap`
 * over the dialog `ref` — same call shape `MediaPickerDialog.tsx` uses, added 2026-09-20: the
 * `aria-modal="true"` attribute promises assistive tech that the page behind is unavailable, but
 * nothing kept Tab from walking out onto it) — not `ThemePageDetailsModal.tsx`'s native `<dialog>`
 * (that file's own header ties its `showModal()`/`close()` lifecycle to being permanently mounted
 * with a toggled `open` prop; this modal, like `MediaPickerDialog`, is only ever mounted while
 * actually open, so the simpler div-backdrop shape fits without adopting a lifecycle this component
 * doesn't need). `.sitemap-modal` widens the shared `.settings-dialog` to ~900px the same way
 * `.widget-picker-dialog`/`.media-picker-dialog` do for their own callers (`styles.css`);
 * `.sitemap-modal-body` is the one scrolling region between the fixed header and the fixed footer,
 * same `flex: 1 1 auto; min-height: 0; overflow-y: auto` shape those two already established.
 *
 * Domain state (fetch, parse, filter, view toggle) lives in `hooks/use-sitemap-modal
 * .hooks.ts`; this file is markup only — the one bit of sequencing that belongs to neither that
 * hook nor the outer `useSeo()` (refetching after a successful regenerate) lives in its own
 * colocated `SitemapModal.hooks.tsx`, see that file's header for why it isn't folded into either.
 *
 * ## Agent handles
 * Every interactive element carries its own `agentHandle` (grep `agentHandle(` in `Seo.tsx` for
 * the convention this follows): the raw-XML link, the table/raw toggle, the filter box, each row's
 * URL link (namespaced via `buildAgentListHandles`, the same per-item scheme `MediaPickerDialog
 * .tsx` uses), the footer Regenerate button, and the footer Close button.
 */

/** `settings.sitemapEnabled` from `useSeo()` — when `false`, the modal shows why instead of a
   *  table (REQ 8: "disabled" and "on but zero URLs" are different facts, so this never fetches to
   *  find out — it already knows).
   *
   *  Threaded into `useSitemapModal` as `SitemapModalInputs.enabled`, which is what actually makes
   *  the "never fetches" half true. Until 2026-09-02 this prop only reached
   *  {@link SitemapModalBody}: the hook was called with no notion of it and fetched on every open,
   *  so a resolved `/sitemap.xml` put `Sitemap · N URLs` in the header and a live Raw XML toggle
   *  beside it while the body read "Sitemap is off." */

/** `saving` from `useSeo()` — shared with the outer page's own Save/Regenerate buttons, same as
   *  today's single-flag convention (`Seo.tsx`'s existing `disabled={saving}` on both). */

/** `regenerateSitemap` from `useSeo()`. Resolves `true` on success, `false` on a caught failure —
   *  `handleRegenerate` below only refetches on `true`, matching REQ 7 ("after a SUCCESSFUL
   *  regenerate it refetches"). */

/** Injectable seam for the modal's fetch/parse/filter/view state. Defaults to the real
   *  {@link useWiredSitemapModal}; a test can pass a fake here to exercise this component's
   *  rendering against a fixed `SitemapModalController`. */

/** The header's `Sitemap · N URLs` title — no count while loading/erroring, since neither state
 *  has a real number to show yet.
 *
 * @complexity O(1). */

/** The header's raw-XML link + table/raw toggle — only shown once there is a real response to
 *  point at (REQ 3/6). Its own component purely so {@link SitemapModal} stays a flat sequence of
 *  blocks.
 *
 * @complexity O(1). */

/** The parsed-table view: filter box + `URL | Last modified` table, or the empty-filter/empty-
 *  sitemap notices in place of a table with nothing to show. Its own component for the same
 *  flat-sequence-of-blocks reason as {@link SitemapModalHeaderActions}.
 *
 * @complexity O(1) to render — `entries`/`filteredEntries` are already computed by
 *   `useSitemapModal` (memoized there), this only maps them to JSX. */

/** The body's content-status switch (REQ 8/9: disabled, loading, error, then raw-vs-table) — kept
 *  as its own flat sequence of guards rather than a nested ternary inline in {@link SitemapModal}.
 *
 * @complexity O(1) — delegates the actual list rendering to {@link SitemapModalTable}. */

  // Native modality keeps Tab from reaching the background, as MediaPickerDialog now does too.

## hooks/seo-dependencies.hooks.ts

/**
 * @file The only place under `features/seo/hooks` that reaches `lib/api` — see
 * `seo-port.hooks.ts` for why the split exists.
 */

/** The live implementation, as a module-level singleton — matches `redirects-dependencies.hooks.ts`'s
 *  `defaultRedirectsPort`. */

/** One entry's seed for {@link createFakeSeoPort} — the resolved meta plus its analysis. */

/** Seed state for {@link createFakeSeoPort}. */

/** Keyed by entry id. */

/** `patch value ?? meta value`, named — {@link applySeoPatch} calls this once per field instead of
 *  inlining `??` at each of its 13 fields: a plain function call isn't a decision point the way an
 *  inline `??` is, so this is what keeps that merge under the complexity ceiling (same fix this
 *  codebase's `orEmpty` established elsewhere for the same class of violation — a flat run of
 *  independent fallbacks, not real branching logic).
 *
 *  `null` (the patch's CLEAR sentinel) falls through to the meta value by the same `??`, which is
 *  the right model for this fake: the server drops the override and re-resolves, and the seeded
 *  `meta` is the closest thing this fake has to that resolved value. It is only an approximation —
 *  a test that needs to prove a clear actually reached the wire must assert on the PUT body, not on
 *  what comes back. */

/** Applies a {@link SeoEntryOverridesPatch} onto a resolved {@link SeoEntryMeta} — only the fields
 *  a fake's own tests plausibly touch are merged (title/description/canonical directly, robots and
 *  the OG/Twitter card objects field-by-field); this mirrors the server's `SeoExtFields` -> `SeoMeta`
 *  merge closely enough for hook-level tests without re-implementing the real resolution rules. */

/** One of the three site-wide scalars the server registers as `nullable: true` (`SEO_DEFINITIONS`,
 *  `apps/website/src/features/seo/settings.ts`), under the real write's own rule: an omitted key
 *  (`undefined`) keeps the current value, `null` clears it, and a string overwrites. */

/** Applies a {@link SeoSettingsPatch} the way the real `setSeoSettings` does: an omitted key leaves
 *  the current value alone (it is a MERGE — `buildScalarWrites` skips every `undefined`), and a
 *  `null` on one of the three nullable scalars clears it back to absent, which `getSeoSettings`
 *  reads back as `undefined` (via its `undefinedIfEmpty`). Naming those three explicitly rather
 *  than spreading the patch verbatim is what stops a `null` from surviving into a `SeoSettings`
 *  the fake hands back — no real response can contain one.
 *
 *  @complexity O(1) — three fixed field reads, no iteration. */

/**
 * An in-memory {@link SeoPort} for tests — the fake that lets a test describe "these are the
 * site-wide settings" or "this entry resolves to this meta" directly, instead of hand-building
 * fetch `Response`s. Shipped alongside the real binding per the pattern's "every port gets a fake"
 * rule (see `assistant-chats-dependencies.hooks.ts`).
 */

/** The site-wide settings as currently held by the fake, after any `setSeoSettings` writes. */

/** Every entry currently in the fake's store, keyed by entry id. */

## hooks/seo-port.hooks.ts

/**
 * @file What `useSeo`, `useSeoEntryPanel`, and `useEntryPicker` need from the outside world, as an
 * interface rather than a direct `lib/api` import.
 *
 * Follows the `useX(dependencies)` / `useWiredX()` pair documented on `assistant-chats-port.hooks.ts`
 * (the canonical reference in this workspace) and already applied to `features/redirects` and
 * `features/pages`: this file declares, `seo-dependencies.hooks.ts` binds the real `api` client,
 * and nothing else under `features/seo/hooks` imports `lib/api`.
 *
 * One shared port for all three hooks rather than three narrow ones — the same "genuinely
 * matches" case `redirects-port.hooks.ts` names for its own three hooks: all three read/write the
 * SAME SEO surface (site-wide settings, one entry's overrides + analysis, the post/page picker
 * feeding that entry), each calling a disjoint subset of the eight methods below, exactly the
 * shape `RedirectsPort` already established for this codebase.
 */

/** `SeoSettingsPatch`, not `Partial<SeoSettings>`: the three optional scalars take `null` to
   *  CLEAR the site default, which `Partial<SeoSettings>` cannot express (see `lib/api.ts`). */

## hooks/sitemap-dependencies.hooks.ts

/**
 * @file The only place under `features/seo/hooks` that reaches the public `/sitemap.xml` route
 * directly — see `sitemap-port.hooks.ts` for why this is a separate port from `SeoPort`.
 *
 * Uses `siteUrl()` (`lib/site-url.ts`), the same helper the admin already has for "link to a page
 * on the public Tovu site, not the admin SPA": in production the admin SPA and the public site are
 * one server/one origin, so a relative path is correct; when Vite serves the admin SPA on its own
 * origin (:5173 by default) it knows nothing about `/sitemap.xml`, so `siteUrl` resolves an
 * absolute `http://localhost:3000/sitemap.xml` instead. (Not every dev bundle: under `apps/desktop`'s
 * same-origin `/admin/*` proxy `siteUrl` stays relative, and this fetch is then answered by the site
 * server itself — see `lib/admin-dev-origin.ts`.) That cross-origin dev request is already
 * permitted — `server/inbound/shared/dev-cors.ts`'s `applyDevCors` reflects any `localhost`/
 * `127.0.0.1` origin for `GET`, mounted unconditionally in `createApp()` — so this needed no new
 * Vite proxy entry and no new server-side change.
 */

/** The live implementation, as a module-level singleton — matches `defaultSeoPort`
 *  (`seo-dependencies.hooks.ts`)'s own singleton convention. */

    // Same defensive shape `getAssistantDaemonReadyz` (`lib/api.ts`) uses for its own
    // non-`request()` fetch: a non-XML response means something ELSE answered (a dev-proxy gap, a
    // stale build, a captive portal's own error page), not the real route — surfacing that as a
    // clear message beats `res.text()` handing back an HTML 404 page that `parseSitemapXml` would
    // then silently read as "zero URLs".

/** Seed state for {@link createFakeSitemapPort}. */

/** The response body to hand back. Defaults to a well-formed, empty `<urlset>`. */

/** When set, `fetchSitemapXml()` rejects with this message instead of resolving. */

/** An in-memory {@link SitemapPort} for tests — mirrors `createFakeSeoPort`'s own role. */

## hooks/sitemap-port.hooks.ts

/**
 * @file What `useSitemapModal` needs from the outside world — a single method, deliberately NOT
 * folded into `SeoPort` (`seo-port.hooks.ts`): every other `SeoPort` method calls the authenticated
 * `/api/admin/v1/...` surface via `lib/api.ts`'s `api` client, but `GET /sitemap.xml` is the
 * public, unauthenticated route real crawlers hit (`server/inbound/public-http/routes/site/
 * sitemap.ts`) — a different origin/auth shape, so it gets its own narrow port rather than
 * widening `SeoPort` with a method that doesn't share its contract.
 */

/** Fetches the exact response body `GET /sitemap.xml` serves — the SAME bytes a crawler gets, so
   *  `SitemapModal.tsx`'s "Raw XML" view is never an approximation of what ships. Rejects with a
   *  descriptive `Error` on a network failure or a non-2xx/non-XML response. */

## hooks/use-entry-picker.hooks.ts

/**
 * @file Everything `EntryPicker` (the SEO screen's post+page dropdown, REQ-06) does, so it can stay
 * markup only.
 *
 * Extracted verbatim — same state, same effect, same error string.
 *
 * `port` is injected — see `seo-port.hooks.ts` (shared with `use-seo.hooks.ts` and
 * `use-seo-entry-panel.hooks.ts`, since all three read/write the same SEO surface) — rather than
 * importing `lib/api` directly, so a test can describe the picker's list against
 * `createFakeSeoPort` instead of stubbing global `fetch`. `useWiredEntryPicker` below is the
 * zero-argument pair `Seo.tsx` actually mounts.
 */

    // eslint-disable-next-line react-hooks/exhaustive-deps

/**
 * Binds the real `/api/.../posts` and `/api/.../pages` clients — see `seo-dependencies.hooks.ts`.
 *
 * The zero-argument half of the `useX(dependencies)` / `useWiredX()` pair, so `Seo.tsx` composes
 * this and a test composes {@link useEntryPicker} with `createFakeSeoPort`.
 */

## hooks/use-seo-entry-panel.hooks.ts

/**
 * @file Everything `SeoEntryPanel` (REQ-06's per-entry overrides edit form + REQ-07's analyze
 * view) does, so it can stay markup only.
 *
 * Extracted verbatim — same state, same declaration order, same effect, same error strings.
 * `fieldValue`/`setField` stay here rather than move to `rules.ts`: both close over this hook's
 * own `touched` state (a component-scoped getter/setter pair, not a rule of the domain), the same
 * category as `usePosts`' `setPendingDelete`.
 *
 * `port` is injected — see `seo-port.hooks.ts` (shared with `use-seo.hooks.ts` and
 * `use-entry-picker.hooks.ts`, since all three read/write the same SEO surface) — rather than
 * importing `lib/api` directly, so a test can describe load/save outcomes against
 * `createFakeSeoPort` instead of stubbing global `fetch`. `useWiredSeoEntryPanel` below is the
 * zero-argument pair `Seo.tsx` actually mounts.
 */

/** Reads back whatever the operator touched for `key`, falling back to the resolved
   *  (server-effective) value for any field not yet edited this session. A field the operator
   *  EMPTIED reads back as `null` (the pending clear), which `Seo.tsx`'s own `?? ""` renders as an
   *  empty box — so the field the operator cleared stays cleared on screen. */

/** The patch `save` will PUT — only the fields the operator actually touched this session, with
   *  `null` for each one they emptied. An untouched field is ABSENT, never `null`: "unchanged" must
   *  never become "clear". */

  // Stale-settlement guard (2026-09-07 fix, `useSettlementGeneration`) for `save`'s trailing analyze
  // refresh below — see that call's own comment for why it needs one.

  // The `overrideOrClear` call is the whole clear-an-override fix, and it lives HERE rather than at
  // the eleven `onChange` handlers in `Seo.tsx` deliberately: normalizing at the single sink means
  // no field can be added to that form later and silently miss it (the "correct primitive, unwired
  // call site" failure this codebase keeps hitting), and it keeps `Seo.tsx` markup-only. `touched`
  // therefore holds `null` for a field the operator emptied, which is exactly what `save` PUTs.

      // `saving` is already cleared by the time this settles (the `finally` below runs the moment
      // `putSeoEntry` resolves, not after this fire-and-forget call does), so the Save button
      // re-enables and a SECOND edit+save can complete — including its OWN trailing analyze
      // refresh — before this one's analyze call resolves. Minted BEFORE the request starts (2026-
      // 09-07 fix, `useSettlementGeneration`) so a later save's analyze always supersedes an
      // earlier one's, regardless of which network response happens to land last; otherwise the
      // slower, now-stale call could overwrite the newer save's analysis with a score/issue list
      // computed against overrides that save has since replaced.

/* analyze refresh is best-effort; the save itself already succeeded */

/**
 * Binds the real `/api/.../seo/entries` client — see `seo-dependencies.hooks.ts`.
 *
 * The zero-argument half of the `useX(dependencies)` / `useWiredX()` pair, so `Seo.tsx` composes
 * this and a test composes {@link useSeoEntryPanel} with `createFakeSeoPort`.
 */

## hooks/use-seo-entry-section.hooks.ts

/**
 * @file `SeoEntrySection`'s one piece of state — which entry the picker currently has selected.
 *
 * Extracted verbatim, trivial as it is: the DI-for-testing convention this pass uses applies
 * uniformly to every touched component (see `Posts.tsx`'s own doc on why), not only to sections
 * with async state.
 */

## hooks/use-seo.hooks.ts

/**
 * @file Everything the top-level `Seo` screen does (the site-wide defaults form + sitemap
 * regenerate action), so `Seo.tsx` is only markup.
 *
 * Extracted verbatim — same state, same declaration order, same effect, same error strings.
 * `SeoSettingsScreen`'s per-section state (`EntryPicker`, `SeoEntryPanel`, `SeoEntrySection`) lives
 * in its own sibling hook files, not here — each section is independent and this hook only owns
 * what the top-level component itself renders.
 *
 * `port` is injected — see `seo-port.hooks.ts` (shared with `use-seo-entry-panel.hooks.ts` and
 * `use-entry-picker.hooks.ts`, since all three read/write the same SEO surface) — rather than
 * importing `lib/api` directly, so a test can describe load/save outcomes against
 * `createFakeSeoPort` instead of stubbing global `fetch`. `useWiredSeo` below is the zero-argument
 * pair `Seo.tsx` actually mounts. `useAdminLocale()` itself is called only inside `useWiredSeo` —
 * its resolved `locale` string is what gets injected, not the hook reference.
 *
 * `locale` is ALSO returned from {@link useSeo} (standing i18n rule, 2026-08-11 — a component with
 * a hook gets its locale-derived UI copy FROM that hook, not its own `useAdminLocale()` call) so
 * `Seo.tsx` sources it from here instead of calling `useAdminLocale()` itself, then keeps threading
 * the raw string down to `EntryPicker`/`SeoEntryPanel`/`SeoEntrySection` as before — this file's own
 * header already explains why those get `locale` as a prop rather than a bound `t`: `seo-i18n.ts`'s
 * own `t(locale, key)` is a pure function every one of them calls directly, never rebuilding a
 * dictionary lookup inline, so there is no bound closure to inject, only the raw string.
 */

/** Takes a `SeoSettingsPatch` rather than a `Partial<SeoSettings>` so an emptied optional field
   *  can send `null` and actually clear its site default — `setSeoSettings` is a merge, so an
   *  omitted key means "unchanged" (see `lib/api.ts`'s `SeoSettingsPatch`). */

/** The site-wide default OG/Twitter image field's own controlled value (MediaRefField picker
   *  support, 2026-09-05) — every OTHER default on this screen stays an uncontrolled `defaultValue`
   *  (read via `FormData` on submit, `Seo.tsx`'s own file header), but a picker needs somewhere to
   *  WRITE a selection into, which an uncontrolled input has no seam for. Re-synced from `settings`
   *  whenever it (re)loads — including after a successful save, so the field reflects what was
   *  actually persisted rather than the operator's last unsaved edit. `""` until settings load. */

/** Resolves `true` on success, `false` on a caught failure (`error` is set either way this
   *  already did) — `SitemapModal.tsx`'s own footer Regenerate button uses the boolean to decide
   *  whether to refetch `/sitemap.xml`, so a failed attempt never re-fetches the same stale
   *  content. The pre-existing caller, `Seo.tsx`'s own Regenerate button, still just fires this as
   *  a plain `onClick` and discards the return value — this is a widening, not a breaking change. */

/** Whether `SitemapModal.tsx` ("View sitemap") is open. `Seo.tsx` stays markup-only (this file's
   *  own header) by keeping this state here alongside the rest of the screen's state, the same way
   *  `SeoEntrySection`'s own `entryId` selection lives in `useSeoEntrySection` rather than in
   *  `Seo.tsx` itself. */

/** The raw resolved locale — see this file's own header for why `Seo.tsx` gets this instead of
   *  calling `useAdminLocale()` itself. */

  // Re-baselines the one controlled default (`defaultOgImage`) whenever `settings` (re)loads —
  // including after `save` below calls `setSettings(r.data)`, so a saved picker selection is what
  // the field shows, not a stale local echo. Every other default field is deliberately left
  // uncontrolled (see `Seo.tsx`'s own file header) and has no equivalent resync need.

  // `locale`/`t` are deliberately not listed — same pre-existing gap `use-page-editor.hooks.ts`
  // documents (this effect only ever ran off `[]` even when `locale` came from `useAdminLocale()`
  // directly); `port` is referentially stable in production (`useWiredSeo` always passes the same
  // module-level singleton).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `locale`/`t` gap predates this conversion (see comment above); `port` is referentially stable in production.

/**
 * Binds the real `/api/.../seo/settings` client — see `seo-dependencies.hooks.ts`.
 *
 * The zero-argument half of the `useX(dependencies)` / `useWiredX()` pair, so `Seo.tsx` composes
 * this and a test composes {@link useSeo} with `createFakeSeoPort`.
 */

## hooks/use-sitemap-modal.hooks.ts

/**
 * @file `SitemapModal`'s own state — the fetch-once-per-open of `/sitemap.xml`, the parsed-vs-raw
 * view toggle and the filter box. Jini owns native Escape-to-close. Split out of the component the
 * same way `useMediaPickerDialog` is split from `MediaPickerDialog.tsx`: `SitemapModal.tsx` is
 * conditionally rendered by `Seo.tsx` only while open (never kept mounted-but-hidden), so mounting
 * this hook IS "the modal opened" — the same lifecycle `useMediaPickerDialog` relies on for its own
 * once-per-mount fetch. Native cancellation is provided by the rendered Jini dialog.
 *
 * `port` is injected (see `sitemap-port.hooks.ts`) rather than importing `sitemap-dependencies
 * .hooks.ts`'s `defaultSitemapPort` directly, so a test can describe "the sitemap has these URLs"
 * or "the fetch fails with this message" via `createFakeSitemapPort` instead of stubbing global
 * `fetch`. `useWiredSitemapModal` below is the real-port half `SitemapModal.tsx` actually mounts.
 */

/** `"disabled"` is a real, terminal state, not a stalled `"loading"`: with `sitemapEnabled` false the
 *  modal deliberately never fetches, so there is nothing in flight to be loading. Naming it keeps
 *  `SitemapModal.tsx`'s header honest — `sitemapModalTitle`/`SitemapModalHeaderActions` both key off
 *  `status === "ready"`, so a URL count and the raw/table toggle stay off a sitemap that is off. */

/** What {@link useSitemapModal} needs from its caller. An object rather than trailing positional
 *  parameters specifically so the `SitemapModal.tsx` `useModal` test seam forwards it whole: a
 *  positional `enabled` can be silently dropped by a shorter test double (TypeScript accepts a
 *  function of fewer parameters), which is exactly how the "this never fetches" claim below went
 *  untested while the fetch fired on every open. */

/** `settings.sitemapEnabled` — when `false`, `/sitemap.xml` is never requested at all. */

/** Retained for the existing hook ABI; SitemapModal forwards close directly to Jini. */

/** What {@link useSitemapModal} (and {@link useWiredSitemapModal}) hands back to
 *  `SitemapModal.tsx` — the modal's full render-time contract. */

/** A describable failure message, set only while `status === "error"`. */

/** The exact response text from `GET /sitemap.xml`, set only while `status === "ready"`. */

/** Every parsed `<url>` entry, unfiltered — `SitemapModal.tsx`'s header URL count reads this. */

/** `entries` narrowed by {@link filter}. */

/** Re-runs the fetch — `SitemapModal.tsx`'s footer Regenerate button calls this after a
   *  successful regenerate, so the count/table/raw view all reflect the freshly rebuilt sitemap
   *  without the operator closing and reopening the modal. */

/**
 * Owns the sitemap-viewer modal's data and view state.
 *
 * @param port - Injected {@link SitemapPort} — see that file's own doc for why this is a separate
 *   port from `SeoPort`.
 * @param required - `enabled` (gates the fetch entirely) and `onClose` (called on the modal's
 *   Escape-to-close path; the click-to-close/footer Close button paths stay plain
 *   `onClick={onClose}` in the component, same split `useMediaPickerDialog` uses for its own Escape
 *   listener vs. its plain-`onClick` Cancel button). See {@link SitemapModalInputs}.
 * @returns The modal's full render-time contract — see {@link SitemapModalController}.
 */

  // Bumped by `refetch()` to re-run the fetch effect below without duplicating its body — the same
  // "dependency the effect reacts to, not a value the effect reads" shape a retry button commonly
  // uses when the thing being retried takes no arguments of its own.

    // Branch INSIDE the effect, never around the hook call: `SitemapModal.tsx` reads `useModal`
    // unconditionally (Rules of Hooks), so "skip the fetch" has to be expressed here. Before this
    // guard existed the fetch fired on every open regardless of `sitemapEnabled`, and — worse than
    // the wasted request — a resolved response flipped `status` to `"ready"`, which put a URL count
    // in the header and a live raw/table toggle on a modal whose body reads "Sitemap is off."

    // `cancelled` guards against a stale response landing after a newer `refetch()` already
    // started — the same race-guard shape `use-page-editor.hooks.ts`'s own effects use elsewhere
    // in this admin for an unrelated fetch.

  // Re-parsed only when the fetched text actually changes, not on every filter keystroke — a
  // filter-box re-render would otherwise re-run `DOMParser` over the whole document each time.

/**
 * Binds the real `/sitemap.xml` fetch — see `sitemap-dependencies.hooks.ts`.
 *
 * The zero-dependencies half of the `useX(dependencies)` / `useWiredX()` pair, so `SitemapModal
 * .tsx` composes this and a test composes {@link useSitemapModal} with `createFakeSitemapPort`.
 *
 * @param required - Forwarded verbatim to {@link useSitemapModal}.
 */

## index.ts

/**
 * @file Public surface of the `seo` feature.
 *
 * `panels.tsx` imports from HERE, never from a file inside this folder. That indirection is the
 * point of the feature boundary: everything below can be split, renamed, or grown a `hooks/`
 * directory without the router noticing. Adding a file to this feature is not an API change unless
 * it is exported from this line.
 */

## rules.ts

/**
 * @file Pure logic for the `seo` feature — everything that computes a value rather than rendering
 * one.
 *
 * Follows the `rules.ts` convention `features/posts/rules.ts` establishes. `sortIssuesBySeverity`
 * was `AnalyzePanel`'s inline `.sort()` call plus its module-level `SEVERITY_ORDER` table; it
 * computes an ordering, so per that convention it moves here rather than stay "presentation" —
 * `AnalyzePanel` itself has no state and needs no hook, only this rule.
 */

/**
 * Orders issues error-first, then warning, then info, matching the severities' natural urgency.
 * An unrecognized severity sorts last (falls back to `9`) rather than throwing, since this reads
 * off a server-provided field this client does not fully control.
 *
 * @complexity Time: O(n log n) in issue count via the underlying sort; space: O(n) for the copy
 * (never mutates the array passed in).
 */

/**
 * One edited per-entry override field's outgoing value. An emptied text/URL box means "remove this
 * override so the entry falls back to the site default", which on the wire is `null` — the clear
 * sentinel `SeoExtFieldsPatch` documents (`apps/website/src/features/seo/types.ts`) and
 * `setEntrySeoOverrides` implements by `delete`-ing the key.
 *
 * It is NOT `""`. `write-service.ts` stores `""` as a genuine override and `seo.ts` resolves
 * overrides with `??`, so a blank override beats the site default — the exact trap that left one
 * post pinned at `{"description":""}` with no way back from the admin UI. It is not `undefined`
 * either: an omitted key means "leave unchanged", and `JSON.stringify` would drop it from the
 * request body entirely.
 *
 * Generic and value-shaped rather than key-shaped on purpose — the two robots checkboxes go
 * through the same setter and pass straight through, since a checkbox has no "empty" gesture with
 * which to express a clear. Only a genuinely emptied string can mean one.
 *
 * @complexity O(1) — one equality test.
 */

/** An optional site-wide default's controlled-input value — `Seo.tsx`'s three optional defaults
 *  (`defaultDescription`, `defaultOgImage`, `twitterSite`) all fall back to `""` the same way. */

/** A pending-action button's label — `Seo.tsx` uses this for both the save-settings button
 *  ("Saving…"/"Save settings") and the regenerate-sitemap button ("Working…"/"Regenerate
 *  sitemap"), same `pending ? … : …` shape, different copy. Also reused by `SitemapModal.tsx`'s
 *  own footer Regenerate button — same two states, same copy, different trigger. */

/**
 * One `<url>` entry from a parsed sitemap. Only the fields `apps/website`'s
 * `registerSeoSitemapRoute` (`server/inbound/public-http/routes/site/sitemap.ts`) actually emits —
 * `<loc>` always, `<lastmod>` when the entry has one — verified by reading that route rather than
 * guessed: it never writes `changefreq`/`priority`, so `SitemapModal.tsx`'s table has no columns
 * for those (SPEC intent: "omit a column entirely if the sitemap never emits that field").
 */

/**
 * Parses a `<urlset>` sitemap document into its `<url>` entries via the browser's built-in
 * `DOMParser` — no new dependency, and it reads the exact same bytes `GET /sitemap.xml` served
 * (this never re-derives sitemap content of its own). Malformed input (a parser error, a document
 * with no `<url>` elements, empty text) yields `[]` rather than throwing: `useSitemapModal` already
 * guards the fetch itself via `SitemapPort`; this only guards the parse step.
 *
 * @complexity Time/space: O(n) in document size — one DOM parse, one linear pass over `<url>` nodes.
 */

/** Case-insensitive substring filter over a parsed sitemap's URLs — `SitemapModal.tsx`'s filter
 *  box, for the same "narrow a long list by typing" shape every other filter in this admin uses.
 *  An empty/whitespace-only query returns every entry unchanged (a copy, not the same reference,
 *  matching `sortIssuesBySeverity`'s own never-mutate-the-input convention above).
 *
 * @complexity Time: O(n) in entry count; space: O(n) for the filtered copy. */

/**
 * `MediaRefField`'s ref-building/preview logic (`ogImage`/`twitterImage`/`defaultOgImage` all
 * share this shape — SPEC intent: "make the OG image selectable, with a preview"). The reference
 * format itself is NOT reinvented here — it is verified, not guessed, against the one function that
 * actually parses it server-side: `resolveSeoImageRef` (`apps/website/src/features/seo/media.ts`)
 * accepts either an already-absolute URL, passed through unchanged, or a bare `{assetId}:{transformName}`
 * pair split on the FIRST `:`. `isAbsoluteMediaRef`/`parseMediaRefAssetId` below duplicate that
 * parsing rather than import across the app boundary (apps/admin has no dependency on apps/website)
 * — kept in lockstep by this doc comment naming the source of truth; a change to that split MUST
 * update both.
 */

/** The transform every upload receives (the server's default rendition) — the one
 *  `buildMediaRef` always targets, matching `EmbedInsertControl.tsx`'s own
 *  `transformName: "public"` for the identical `{assetId}:{transformName}` shape it writes into a
 *  post body's image node. */

/** Mirrors `resolveSeoImageRef`'s own `isAbsoluteUrl` (`apps/website/src/features/seo/media.ts`) —
 *  see this section's file-header doc for why this is a duplicate, not an import. */

/** Mirrors `resolveSeoImageRef`'s own `parseMediaRefParts`, narrowed to just the `assetId` half —
 *  all `MediaRefField`'s preview needs. Returns `null` for an absolute URL (nothing to parse) or a
 *  malformed ref (no `:`, or nothing on one side of it). */

/** Builds the `{slug}:public` reference `MediaRefField` writes into the field on selection —
 *  prefers the asset's readable slug over its id (readable-slugs S5b, 2026-09-23), matching
 *  `resolveSeoImageRef`'s own id-or-slug lookup server-side (`findMediaByIdOrSlug`,
 *  `apps/website/src/features/seo/media.ts`, S4) so a saved override reads as a slug, not an opaque
 *  uuid. Falls back to `id` when `slug` is empty — defensive only; a real upload always derives one
 *  (`deriveUniqueMediaSlug`). Same `transformName: "public"` `EmbedInsertControl.tsx` already writes
 *  for an inserted image node. An old stored `{assetId}:public` value keeps resolving regardless
 *  (S4's `resolveSeoImageRef` accepts either spelling) — this only changes what gets WRITTEN next. */

/** `MediaRefField`'s thumbnail `<img src>` for the field's current value. An absolute URL (the
 *  field's other legal shape — someone pasted a raw URL) renders directly; a `{assetId}:{transform}`
 *  ref resolves through the injected `mediaOriginalUrl` builder — the admin media library's own
 *  preview URL (`MediaPickerPort.mediaOriginalUrl`), same as `MediaPickerDialog`'s own grid
 *  thumbnails use, NOT the public `/m/...` rendition URL (that needs a live workspace/transform
 *  lookup this client-side preview has no reason to perform). `null` for an empty or unparseable
 *  value — the caller renders no preview then, rather than a broken `<img>`. `typeof value !==
 *  "string"` also resolves to `null` rather than throwing — `MediaRefField`'s `value` prop is a
 *  `fieldValue(key, resolved) ?? ""` fallback chain (`Seo.tsx`), where `??` does not replace a
 *  non-nullish-but-wrong-typed result from a misbehaving caller; matches `resolveSeoImageRef`'s own
 *  "never throws over one bad reference" contract (`apps/website/src/features/seo/media.ts`).
 *
 * @complexity O(1) — string parsing only, no I/O (the returned URL is a template; the browser
 * performs the actual fetch only once it is used as an `<img src>`). */

## Part B input comment updates (2026-10-08)

Historical source comments retained verbatim; active owners are core AdminSeoPort and the Tovu seo-ports host binding.

### hooks/seo-dependencies.hooks.ts

/** The live implementation, as a module-level singleton — matches `integrations/jini-admin/redirects-ports.ts`'s
 *  `redirectsHostPorts`. */

### hooks/seo-port.hooks.ts

/**
 * @file What `useSeo`, `useSeoEntryPanel`, and `useEntryPicker` need from the outside world, as an
 * interface rather than a direct `lib/api` import.
 *
 * Follows the `useX(dependencies)` / `useWiredX()` pair documented on `assistant-chats-port.hooks.ts`
 * (the canonical reference in this workspace) and already applied to `features/redirects` and
 * `features/pages`: this file declares, `seo-dependencies.hooks.ts` binds the real `api` client,
 * and nothing else under `features/seo/hooks` imports `lib/api`.
 *
 * One shared port for all three hooks rather than three narrow ones — the same "genuinely
 * matches" case `Jini redirects/SOURCE-RATIONALE.md` names for its own three hooks: all three read/write the
 * SAME SEO surface (site-wide settings, one entry's overrides + analysis, the post/page picker
 * feeding that entry), each calling a disjoint subset of the eight methods below, exactly the
 * shape `RedirectsPort` already established for this codebase.
 */
