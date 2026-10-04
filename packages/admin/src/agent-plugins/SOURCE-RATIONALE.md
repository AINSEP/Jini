# Agent-plugins source rationale

Source comments retained verbatim with product identities generalized. Dated/superseded
claims are historical provenance, not current behavior. In particular both list tabs now
include disabled rows and there are three real HTTP routes; operational copy follows that
current behavior. The shared file viewer comments are retained with this port.

## Source rationale comments (mechanically captured)


### apps/admin/src/features/plugins/AgentPlugins.tsx (32 comments)

Source line 23

```text
/**
 * The panel's non-row messages: a failed load, an unsettled first load, a refused toggle, and a
 * genuinely empty scoped list.
 *
 * Extracted from `AgentPlugins` rather than inlined as four more ternaries in the tab array — that
 * shape put `AgentPlugins` at a complexity of 13 against this repo's ceiling of 9
 * (`check:admin-complexity-drift`). The split is along a real seam: these four are all "something
 * other than a list of plugins", and none of them needs a row handle or the modal.
 *
 * `toggleError` is deliberately separate from `error` and uses `role="alert"`, not `role="status"`:
 * a load failure is the state of the screen, while a refused toggle is the outcome of something the
 * operator just did and should interrupt.
 *
 * Split from `agentPlugins` as a THIRD parameter (`visiblePlugins`) since the Downloaded/Installed
 * split (2026-09-09): `agentPlugins` (the controller's raw, unfiltered load) still answers "has the
 * load settled", but "is the list genuinely empty" now depends on the TAB's own scope — Installed
 * can read `agentPlugins.length > 0` while still being empty of ENABLED rows. Collapsing these two
 * questions back into one, as the pre-split version did, would show Installed's "loading" state
 * forever whenever Downloaded had rows but none were enabled.
 */
```

Source line 80

```text
/** The row list itself, scoped to whichever tab is rendering it. Rendered only when there is at
 *  least one row, so it carries no emptiness branch of its own — {@link AgentPluginsStatus} owns
 *  that case.
 *
 * `stateControlFor` replaced a direct `controller.onToggleEnabled` call here (2026-09-09): once
 * Installed kept the real switch and Downloaded traded it for a Remove/Enable action (see
 * `AgentPluginRow`'s own header on the split), the two tabs need genuinely different per-row
 * `AgentPluginRowStateControl` values, not the same callback rendered two ways — so this list asks
 * its caller (a factory, computed once per tab in `AgentPlugins`) for one, per plugin, rather than
 * hard-coding either shape itself. */
```

Source line 101

```text
  // Plugin ids are stable and unique, same per-row-handle derivation every other list on this
```

Source line 102

```text
  // workstream uses (`buildAgentListHandles`). Derived from each id alone (see that function's own
```

Source line 103

```text
  // doc), so a plugin's row handle is identical whichever tab currently lists it.
```

Source line 132

```text
/**
 * The shared shell both list tabs (Downloaded, Installed) render through: the status line(s), the
 * row list when the tab's own scope is non-empty, and the section-wide uninstall-unavailable
 * footnote plus spec link. Introduced with the Downloaded/Installed split (2026-09-09) so those two
 * tabs — which differ only in WHICH rows they scope to and their own copy, never in markup — share
 * one implementation instead of two copies that could drift.
 *
 * `visiblePlugins` is the tab's own list — every installed plugin on both tabs since 2026-09-13,
 * when Installed stopped filtering to enabled rows — `null` while the underlying load hasn't settled
 * yet, same convention `AgentPluginsController.agentPlugins` uses.
 */
```

Source line 181

```text
/* `.agent-plugins-footnotes` (styles.css): section-wide facts, not per-plugin details, so
          they stay siblings of the list — but with their own separation, so they read as a footer
          rather than a stray line butted against the last row. Both list tabs share this exact
          footnote (and its handle) rather than each carrying their own — only one tab's panel is
          ever mounted at a time (`TabbedDialog` renders `activeTab.panel` alone), so there is no id
          collision in the live DOM. */
```

Source line 212

```text
/**
 * Downloaded tab: every package on disk for this workspace, unfiltered — the pre-split
 * `InstalledPanel`'s exact content, retitled. There is no cross-site "downloaded" registry (see
 * `agent-plugins/ws/<workspace>/packages/`), so this list is scoped to the current workspace, not
 * global — the copy below says so rather than implying otherwise.
 *
 * Reuses the pre-split lede and empty-state copy VERBATIM rather than rewording them for
 * "downloaded": a downloaded package that is not yet enabled is exactly the "sits inert until you
 * enable it" case those strings already describe. (Correction: an earlier revision of this comment
 * claimed both were already translated into every `plugins-i18n.ts` locale — checked and false,
 * neither has ever had a dictionary entry, pre-dating this split. Reusing them verbatim doesn't
 * regress anything either way, but the claim itself was wrong and is not repeated here.)
 */
```

Source line 239

```text
/**
 * Installed tab: every installed plugin, each with its real Enabled switch — off where it's off.
 *
 * Owner decision 2026-09-13: "all agent plugins should be shown even if switched off". Until then
 * this tab listed only `enabled: true` rows, and since every bundled plugin seeds switched off
 * (`seed-bundled.ts`), a newly bundled one like `supabase` was absent from the default tab with no
 * visible way to turn it on. Showing it here changes only the listing: a switched-off plugin's
 * skills, tools, and MCP servers stay out of every assistant run.
 */
```

Source line 260

```text
/**
 * The Marketplace tab: a designed empty state, not a mocked store.
 *
 * There are no listings to show because nothing in host can fetch, list, or install a remote
 * package — `installAgentPluginFromUrl` exists as a function with zero production callers, and no
 * route or tool reaches it. So this panel shows the one real thing it can honestly offer: where the
 * package format is specified. Anything resembling a browsable catalog here would be a lie the
 * operator would try to click.
 */
```

Source line 279

```text
/* On its own line rather than trailing a centered sentence — a link that wraps mid-
            paragraph in a centered block reads as part of the prose instead of as the next step. */
```

Source line 299

```text
/**
   * Dependency injection seam for tests — the same convention `PostsProps.usePostsHook` uses.
   * Defaulted to the real hook, so production callers pass nothing and behave exactly as before.
   */
```

Source line 306

```text
/**
 * Settings-style Agent Plugins catalog. Downloaded/Installed are both read from
 * `AGENT_PLUGINS_LIST` (real, per-workspace installed state); Marketplace is future-only.
 *
 * REDESIGNED 2026-09-09. Five changes worth stating, because each replaced something that was
 * deliberate at the time:
 *
 *  1. Cards became rows (`AgentPluginRow` — see its own header for the before/after and why
 *     nothing was dropped in the process).
 *  2. The enable/disable switch is REAL. This file's prior revision carried an explicit comment
 *     saying there is intentionally no toggle here because the read path was all that existed.
 *     `AGENT_PLUGIN_SET_ENABLED` now exists, so the toggle is wired end to end and its off-state
 *     genuinely refuses an assistant run.
 *  3. Marketplace got a designed empty state rather than one grey sentence. Its copy stays exactly
 *     as honest: nothing is fetched, listed, or installable, and the panel offers no control that
 *     pretends otherwise.
 *  4. The single "Installed" tab split into Downloaded (every package on disk for this workspace,
 *     unfiltered) and Installed (only `enabled: true`). They read identically today — every bundled
 *     package ships enabled — and diverge the moment an operator disables one; each has its own
 *     honest empty state for that day.
 *  5. Owner correction, same day: Installed is the FIRST/default tab (not Downloaded) — it is the
 *     "what's active" view, so it leads. And Downloaded's row dropped the Enable/Disable switch for
 *     a single Remove/Enable action (`AgentPluginRowStateControl`'s `"remove-or-enable"` variant):
 *     showing the switch on BOTH tabs repeated the same on/off fact Installed already conveys by
 *     which rows it lists at all. Both directions still turn a plugin's activation on or off through
 *     the exact same `AGENT_PLUGIN_SET_ENABLED` call either way — only which CONTROL asks, and
 *     whether it interrupts first, differs. See `AgentPluginDisableConfirmDialog`'s own header for
 *     the two `variant`s that follow from this.
 *  6. Owner decision 2026-09-13: Installed lists EVERY installed plugin, switched on or off, so its
 *     switch's off state is reachable again and a switched-off bundled plugin can be turned on
 *     from the default tab. Item 4's "Installed (only `enabled: true`)" scope no longer holds.
 */
```

Source line 341

```text
  // One id, referenced by every row's disabled uninstall control — see `AgentPluginRow`'s header
```

Source line 342

```text
  // for why the reason is stated once at section level rather than once per row.
```

Source line 345

```text
  // Which plugin (by id) is waiting on a disable/remove confirm dialog, and which CONTROL asked —
```

Source line 346

```text
  // `null` when neither tab has one open. Lives here rather than in `useAgentPlugins` — this is
```

Source line 347

```text
  // presentation flow ("has the operator confirmed yet"), not a network mutation, the same split
```

Source line 348

```text
  // `ExternalMcpSettingsPanel.tsx`'s own `confirmRemoveId` draws for the identical shape of
```

Source line 349

```text
  // interstitial. An id rather than a plugin object so the confirmed row is always looked up fresh
```

Source line 350

```text
  // against the current `agentPlugins` — a stale object reference could not reflect the plugin
```

Source line 351

```text
  // toggling or vanishing by some other route while the dialog sat open. `variant` travels alongside
```

Source line 352

```text
  // the id (not derived from `plugin.enabled` at render time) because Installed's switch and
```

Source line 353

```text
  // Downloaded's Remove button can both open this for an enabled row, and the dialog's own wording
```

Source line 354

```text
  // must match whichever one the operator actually clicked, not the plugin's state.
```

Source line 360

```text
/** Installed's switch: enabling stays a plain one-click toggle, disabling opens the confirm
   *  dialog (`variant: "disable"`) instead of calling the mutation immediately. */
```

Source line 370

```text
/** Downloaded's Remove action — shown only for a currently-enabled row (see `AgentPluginRow`'s
   *  own state-area rendering), so unlike `onRequestToggleEnabled` this has no direct-call branch:
   *  Remove always asks first, with `variant: "remove"` so the dialog reads accordingly. */
```

Source line 427

```text
/* `agent-plugins-section` (styles.css) scopes this screen's own measure to it alone — this
          panel has no `--page-flow` variant, so it had none of that modifier's existing
          `max-width` on `.jini-tabbed-dialog-content` (added for the identical "card ran the full
          admin column" problem on the BYOK tab). The row layout wants more of that column than the
          old card measure allowed, since a row carries its controls to the RIGHT of its text
          rather than underneath it — see that rule's own comment for the widened value. */
```

Source line 446

```text
            // Same derivation the row itself uses (`buildAgentListHandles`), computed from the one
```

Source line 447

```text
            // id alone rather than threaded down from whichever tab's row is currently mounted —
```

Source line 448

```text
            // that function derives a handle from the id, not list position, so this always matches
```

Source line 449

```text
            // the handle the row published, in either tab.
```

### apps/admin/src/features/plugins/AgentPluginRow.tsx (24 comments)

Source line 9

```text
/**
 * @file One installed Agent Plugin, as a ROW rather than a card (redesign, 2026-09-09).
 *
 * ---------------------------------------------------------------------------
 * What this replaced, and why
 * ---------------------------------------------------------------------------
 * Each plugin used to be a bordered `.jini-settings-section-card` holding a `<dl>` of stacked
 * VERSION / STATUS / KEYWORDS label-over-value pairs plus two labelled chip lists. Three installed
 * plugins came to 1275px of inner scroll — every field of every package shouted at once, at the
 * same weight, so nothing could be found by scanning. Owner's verdict on the result was blunt and
 * correct.
 *
 * The fix is hierarchy, not deletion: NOTHING that card showed is gone. The row carries only what
 * an operator scans a list for — is it on, what is it, which version — and the rest (keywords,
 * portable components, MCP server ids) moves into a per-row detail panel that opens on demand.
 * Collapsed, a row is two lines.
 *
 * ---------------------------------------------------------------------------
 * Accessibility decisions worth not re-litigating
 * ---------------------------------------------------------------------------
 *  - The switch is a real `role="switch"` with `aria-checked`, and it is NEVER the only signal of
 *    applied state. The state word beside it and the row's left rail say the same thing, because
 *    colour alone must not carry meaning.
 *  - The expander is the row's own summary button (`aria-expanded`/`aria-controls`), not a separate
 *    chevron hit target competing with the three real controls to its right. Its label is its
 *    visible text, so it gets no `aria-label` — one would override the text a sighted user reads.
 *  - The detail panel is ALWAYS rendered and hidden with the `hidden` attribute, so `aria-controls`
 *    always resolves. `styles.css` carries the matching `[hidden] { display: none; }` guard for it,
 *    for the reason `.cms-section-items[hidden]` already documents in that file: a `display` rule
 *    on the element itself outranks the UA stylesheet's own `[hidden]`.
 *  - The icon-only eye and uninstall buttons carry `aria-label`s naming the plugin. "Inspect
 *    package files — {name}" is preserved verbatim from the text button this eye replaced, so the
 *    accessible name (and the translated `Inspect package files` key behind it) survives the
 *    redesign.
 *
 * ---------------------------------------------------------------------------
 * Two state-area shapes, one row (2026-09-09, Downloaded/Installed row-action split)
 * ---------------------------------------------------------------------------
 * Once Downloaded and Installed existed side by side, the same switch on BOTH tabs was genuinely
 * redundant — Installed already tells the operator "this is on" by which rows it lists at all, so
 * repeating the on/off state a second time on Downloaded's identical row added nothing. Owner's
 * call: Installed keeps the real switch (that tab IS the "what's active" view); Downloaded trades it
 * for a single Remove/Enable action naming what clicking it DOES rather than mirroring state that
 * tab doesn't own. `stateControl` (a discriminated union, not a boolean) carries that difference so
 * `AgentPluginList`/`AgentPlugins.tsx` decide the variant once per tab rather than this row
 * re-deriving it — a row has no way to know which tab it is rendering inside otherwise.
 */
```

Source line 57

```text
/** The row's state-area control. `"toggle"` is Installed's real Enable/Disable switch, unchanged
 *  from before this split. `"remove-or-enable"` is Downloaded's single action: `onRemove` fires for
 *  a currently-enabled row (opens the same confirm dialog the switch does, reworded to "Remove" —
 *  see `AgentPluginDisableConfirmDialog`), `onEnable` for a currently-disabled one (a direct,
 *  unconfirmed call, same as flipping the switch on has always been). Both are supplied always,
 *  regardless of `plugin.enabled` — the row itself, not its caller, decides which one a click
 *  reaches, since only the row already knows the plugin's own current state at render time. */
```

Source line 77

```text
/** The id of the section-level note explaining why uninstall is unavailable. Referenced by the
   *  disabled uninstall control rather than repeated once per row. */
```

Source line 83

```text
/** The row's state area — split out of {@link AgentPluginRow} itself so that component's own
 *  branching stays flat; this is the one part of the row whose markup and accessible name genuinely
 *  differ by tab (see this file's own header). */
```

Source line 106

```text
/* The word, not just the switch's position — see this file's header. */
```

Source line 117

```text
          // `checkbox`, not `switch`: `AgentElementRole` (`@jini-ai/agentic`) has no `switch`
```

Source line 118

```text
          // member, and `checkbox` is the two-state control a page driver already knows how to
```

Source line 119

```text
          // read and flip. That vocabulary is the DRIVER's, independent of the ARIA `role`
```

Source line 120

```text
          // above, which stays `switch` because that is what assistive tech should hear.
```

Source line 132

```text
  // Downloaded: a single action, not a toggle — its own label already names the state (a row
```

Source line 133

```text
  // reading "Turn off" is implicitly on; one reading "Enable" is implicitly off), so this does not
```

Source line 134

```text
  // need a second, separate state word the way the switch does.
```

Source line 154

```text
/** One labelled chip list inside the detail panel. Rendered only when the package actually declares
 *  the thing — an empty "MCP servers" heading would assert that the question was asked and answered
 *  "none", which is not the same as a package that declares none. */
```

Source line 188

```text
          // The description lives INSIDE this button so the whole row is one comfortable hit
```

Source line 189

```text
          // target, but it must not become the button's accessible name — verified rendered, the
```

Source line 190

```text
          // name was the entire 60-word manifest description read aloud on focus. Pointing at the
```

Source line 191

```text
          // heading narrows the name to "Site Compliance v1.0.0" while the description stays
```

Source line 192

```text
          // visible, and stays reachable in browse mode, exactly as before.
```

Source line 203

```text
/* Shown only when the installed package actually carries a version — both are
                  genuinely optional in the Agent Plugins spec, and an invented "1.0.0" would be
                  worse than an absent chip.

                  The explicit `{" "}` is load-bearing, not formatting: this heading IS the summary
                  button's accessible name (`aria-labelledby`), and accessible-name computation
                  concatenates adjacent inline elements with no separator. The flex `gap` that
                  visually separates them is invisible to it, so without a real text node a screen
                  reader announced "Site Compliancev1.0.0". */
```

Source line 219

```text
/* `title` is the ONLY way to read the rest of a clamped line without opening the row —
                a hover tooltip, not a substitute for the unclamped copy below in the expanded
                panel (screen readers and touch have no hover; that copy is the real fix). */
```

Source line 247

```text
            // Preserved verbatim from the text button this replaced: "Inspect package files" reads
```

Source line 248

```text
            // identically on every row, so the plugin's own name must stay in the accessible name.
```

Source line 254

```text
/* HONEST-DISABLED, not decorative, and the domain agrees.
              `features/agent-plugins/uninstall.ts`'s `uninstallAgentPlugin()` (landed 2026-09-09,
              concurrently with this redesign) REFUSES any package whose activation record says
              `origin: "bundled"`, with `AgentPluginNotUninstallableError` — precisely because
              `recordBundledAgentPluginIfAbsent` re-seeds it on the next boot, so a delete would
              appear to succeed and then silently reappear. That function's own header names this
              screen's enable/disable control (the switch on Installed, Remove/Enable on Downloaded
              — see this file's own header) as the lever an operator actually has for a bundled
              package.

              Every installed package today is bundled — `installAgentPluginFromUrl` exists but has
              zero production callers, so nothing can arrive as `operator-installed` — and there is
              no HTTP uninstall route either (the only wrapper is an assistant tool). So a live
              button here would refuse on every row that exists. It becomes real when an
              install-from-url path ships; until then the affordance holds its place and says why.

              The reason is stated once at section level and referenced by every row via
              `aria-describedby`: a disabled control is not focusable, so a per-row tooltip would
              never be read. */
```

Source line 286

```text
/* The summary line above clips this same string to one line (`.agent-plugin-row-desc`,
            `-webkit-line-clamp: 1`) — a hover tooltip covers a sighted mouse user, but expanding
            the row is the only path assistive tech and touch have, so the full text repeats here,
            unclamped, first — before every other per-plugin fact this panel already held. */
```

### apps/admin/src/features/plugins/AgentPluginDetailsModal.tsx (3 comments)

Source line 11

```text
/** `AgentPlugins`' bound translator — the modal's title and subtitle copy. */
```

Source line 14

```text
/** Injectable seam for the listing. Defaults to the real {@link useWiredAgentPluginDetailsModal};
   *  a test can pass a fake to exercise the modal's rendering with a fixed file list/selection. */
```

Source line 19

```text
/**
 * Read-only inspection of one installed Agent Plugin's package files.
 *
 * Renders through the shared `PackageFilesModal` (2026-09-13), the same component the Plugins
 * screen's viewer uses. Since 2026-09-13 its content comes from `AGENT_PLUGIN_FILES` — the server
 * resolves the id against installed packages and reads inside that package root only, never
 * following a symlink — rather than a compile-time catalog that missed plugins nobody had listed.
 */
```

### apps/admin/src/features/plugins/AgentPluginDisableConfirmDialog.tsx (7 comments)

Source line 6

```text
/**
 * @file Confirmation gate in front of the SAME underlying operation from two different controls.
 * There is no admin uninstall route — the only two agent-plugins routes are `GET .../agent-plugins`
 * (list) and `PATCH .../agent-plugins/:pluginId` (set-enabled); `uninstallAgentPlugin()`
 * (`features/agent-plugins/uninstall.ts`) is reachable only from an assistant tool and refuses every
 * bundled package outright — see `AgentPluginRow`'s own header for why its trash icon is honestly
 * disabled for that reason. So "remove this plugin", mechanically, is what turning it off already
 * does: `resolveAgentPluginRefs()` refuses to pin a disabled plugin into a run, which is the only
 * lever an operator actually has over a bundled package. This dialog exists because that lever has a
 * real cost (the assistant loses those skills on its very next run) and, before it landed, a single
 * click fired that cost with no way to reconsider.
 *
 * Two `variant`s, same mechanism, added when Downloaded's row lost its Enable/Disable switch in
 * favor of a single Remove/Enable action (2026-09-09 — see `AgentPlugins.tsx`'s own header):
 *   - `"disable"` — Installed's switch. Confirm reads "Disable", matching the verb the switch itself
 *     already shows via the row's "Enabled"/"Disabled" word — the owner's explicit call against
 *     renaming that control to "Add to site / Remove from site".
 *   - `"remove"` — Downloaded's action button. Confirm reads "Remove" to match that button's own
 *     label; the body still discloses, honestly, that this can't delete anything the backend can't
 *     already refuse to delete — see `buildAgentPluginDisableConfirmCopy`'s own header.
 *
 * Enabling stays a plain one-click action in both places — see `AgentPlugins.tsx`'s own
 * `onRequestToggleEnabled`/`onRequestRemove` — because turning a plugin ON has no comparable cost to
 * interrupt: nothing an operator already depends on stops working.
 *
 * Markup, classes (`settings-dialog`/`settings-dialog-backdrop`, `btn-secondary`/`btn-danger`), and
 * behaviour (Escape-to-cancel via the paired hook, Cancel default-focused so the destructive-leaning
 * action is never the default) mirror `features/settings/ExternalMcpRemoveConfirmDialog.tsx` — the
 * most recent precedent for exactly this shape of dialog in this app, reused rather than
 * re-invented.
 */
```

Source line 39

```text
/** The plugin's own human-readable display name (`humanizeAgentPluginId(plugin.pluginId)`) —
   *  must name the exact plugin being disabled, not a generic "this plugin". */
```

Source line 42

```text
/** Which control opened this dialog — see this file's own header for what each reads and why. */
```

Source line 44

```text
/** This plugin row's own agent-handle base (e.g. `agent-plugin-row-site-compliance`) — Confirm/
   *  Cancel publish as `<rowHandle>-<variant>-confirm` / `<rowHandle>-<variant>-cancel`, nesting
   *  under the row's own control (`<rowHandle>-enabled` or `<rowHandle>-remove`) the same way
   *  `ExternalMcpRemoveConfirmDialog` nests its own controls under its card's handle. */
```

Source line 51

```text
/** The screen's own bound translator, threaded down rather than called again here — same
   *  convention `ExternalMcpRemoveConfirmDialog` uses for its own `t`. */
```

Source line 54

```text
/** Dependency injection seam for tests — see `PostsProps.usePostsHook` for the convention. */
```

Source line 84

```text
/* Cancel is the default-focused control, matching `ExternalMcpRemoveConfirmDialog`'s own
              "the interrupting action is never the default" precedent. */
```

### apps/admin/src/features/plugins/agent-plugins-visuals.tsx (17 comments)

Source line 1

```text
/**
 * @file The Agent Plugins screen's own icon set — inline SVGs, no icon dependency. Same rationale
 * `features/database/database-visuals.tsx`, `source-control-visuals.tsx`, and
 * `deployment/deployment-visuals.tsx` give for theirs: this app ships no icon component library to
 * `features/`, and importing a glyph across a feature boundary would tie this screen's rendering to
 * a sibling feature another agent owns. (`lucide-react` appears only inside the vendored skill DOCS
 * under `bundled/ui-ux-design/` — it is not a dependency of this app.)
 *
 * Two families here, and they follow opposite accessibility rules:
 *
 *   - Tab and per-plugin icons are `aria-hidden`: each sits directly beside the label that already
 *     says the same thing, so announcing it again is noise, not information.
 *   - Control icons (eye, trash) are `aria-hidden` too, but their BUTTONS carry a real `aria-label`
 *     naming the plugin — an icon-only control with no visible text has no accessible name of its
 *     own. See `AgentPluginRow`'s own call sites.
 */
```

Source line 18

```text
/** Shared attributes for a decorative line icon — the same 24px grid, 1.5 stroke, and round joins
 *  every other `*-visuals.tsx` set in this admin uses, so every icon row reads as one family. */
```

Source line 34

```text
/* ------------------------------------------------------------------ tab icons */
```

Source line 36

```text
/** Installed — a package with a check: bytes that are here and catalogued. */
```

Source line 47

```text
/** Marketplace — a shopfront awning over an open door. Deliberately not a shopping cart: nothing
 *  here can be bought or added to anything yet, and a cart would promise a transaction. */
```

Source line 59

```text
/* --------------------------------------------------------- per-plugin glyphs */
```

Source line 61

```text
/** Compliance / privacy / security — a shield with a check. */
```

Source line 71

```text
/** Deploy / hosting / release — a rocket leaving. */
```

Source line 82

```text
/** Design / UI / UX — a painter's palette. */
```

Source line 94

```text
/** MCP servers / integrations / connectors — a plug. */
```

Source line 105

```text
/** Docs / content / writing — a page with lines. */
```

Source line 116

```text
/** The fallback glyph for a plugin whose vocabulary matches no family — a plain package. Generic on
 *  purpose: an invented themed glyph for an unrecognized package would assert a category host has
 *  no evidence for. */
```

Source line 128

```text
/* ------------------------------------------------------------ control icons */
```

Source line 130

```text
/** Open the read-only package inspector. */
```

Source line 140

```text
/** Uninstall. Rendered only in a disabled control on this screen — see `AgentPluginRow`. */
```

Source line 151

```text
/** The row's own expand/collapse indicator. Rotated by CSS on the expanded row rather than swapped
 *  for a second glyph, so the transition is one continuous motion. */
```

Source line 161

```text
/** One glyph per {@link AgentPluginGlyphKind}, so the row renders a lookup rather than a chain of
 *  conditionals. Kinds come from `rules.ts`'s `agentPluginGlyphKind()`. */
```

### apps/admin/src/features/plugins/package-file-tree.ts (20 comments)

Source line 1

```text
/**
 * @file Pure helpers behind `PackageFilesModal`'s VS Code-style file tree (2026-09-29): folding a
 * package's flat `relativePath` list into folders, flattening the tree into the rows currently
 * visible for a given expansion, which rows a keyboard key moves to, and each file's icon.
 *
 * No React here — `hooks/use-package-file-tree.hooks.ts` holds the expansion and focus state and
 * calls these; the component only renders the rows it gets back.
 */
```

Source line 13

```text
/** Package-relative folder path, no trailing slash (`skills/deploy`). */
```

Source line 21

```text
/** The file's full `relativePath`, as the listing gave it. */
```

Source line 27

```text
/** One rendered row of the tree: a node plus where it sits, for `aria-level`/`-setsize`/`-posinset`
 *  and the indentation guides. */
```

Source line 31

```text
/** 0 for the package root's own entries. */
```

Source line 33

```text
/** The containing folder's path, `null` at the root. */
```

Source line 36

```text
/** 1-based, as `aria-posinset` wants. */
```

Source line 42

```text
/** Name plus the path exactly as listed. */
```

Source line 48

```text
/** Files first, then folders, each alphabetical (owner's call, 2026-09-29 — VS Code's default is the reverse). */
```

Source line 64

```text
/**
 * Groups flat package-relative paths into a folder tree. Empty segments (a leading, trailing or
 * doubled `/`) are ignored for grouping, so a stray slash can never produce a nameless folder; the
 * file node still carries the path exactly as listed, since that is what selection is keyed by.
 *
 * @complexity O(n·d + n log n) for n paths of depth d.
 */
```

Source line 95

```text
/**
 * The path of the tree's top file row once every folder on the way is open — the first file in
 * display order (files before folders, so a root file wins over anything nested); `null` for no files.
 * @complexity O(nodes).
 */
```

Source line 108

```text
/**
 * Every folder path that contains `filePath` — the folders that start expanded so the selected
 * file is visible when the dialog opens.
 * @example ancestorFolderPaths("skills/deploy/SKILL.md") // ["skills", "skills/deploy"]
 * @complexity O(d).
 */
```

Source line 120

```text
/**
 * The rows on screen, top to bottom: a collapsed folder's descendants are left out.
 * @complexity O(visible rows).
 */
```

Source line 139

```text
/** What one key press in the tree does. Every field is optional; an empty object means "not ours". */
```

Source line 141

```text
/** Row path to move keyboard focus to. */
```

Source line 143

```text
/** Folder to expand (`true`) or collapse (`false`). */
```

Source line 145

```text
/** File to open in the content pane. */
```

Source line 149

```text
/**
 * The WAI-ARIA tree keyboard pattern, as VS Code's explorer does it: Up/Down move, Home/End jump,
 * Right expands a closed folder or steps into an open one, Left collapses an open folder or steps
 * out to the parent, Enter/Space opens a file or toggles a folder.
 *
 * @param rows The visible rows, from {@link visiblePackageFileRows}.
 * @param currentPath The focused row's path.
 * @complexity O(rows).
 */
```

Source line 197

```text
/** Icon family for a file row; the component maps it to a RemixIcon glyph and a tint. */
```

Source line 247

```text
/**
 * Picks a file's icon family from its extension (the text after the last `.`, case-insensitive).
 * A dotfile with no other dot (`.env`) counts its whole name as the extension.
 * @complexity O(name length).
 */
```

### apps/admin/src/features/plugins/PackageFilesModal.tsx (11 comments)

Source line 13

```text
/**
 * @file The read-only package-files browser BOTH plugin screens open — a VS Code-style file tree
 * (files first, chevrons, indent guides, file-type icons; since 2026-09-29) on the left, the
 * selected file's source on the right with a Wrap toggle, inside Jini's `PreviewModalShell` (which
 * supplies the expand and close controls). Extracted 2026-09-13 out of `AgentPluginDetailsModal.tsx`
 * so Agent Plugins and Plugins render through one component and cannot drift apart.
 *
 * Presentational only: it loads nothing and holds no data. Each caller owns its source and passes
 * files in — Agent Plugins and Plugins both read the installed package live from the server via
 * `AGENT_PLUGIN_FILES` / `PLUGIN_FILES` (see `hooks/use-agent-plugin-details-modal.hooks.ts` and
 * `hooks/use-plugin-package-files.hooks.ts`).
 *
 * Class names keep the `agent-plugin-source-*` prefix they had before the extraction, so
 * `styles.css` needed no change.
 */
```

Source line 35

```text
/** Shown in the content pane while no file is selected: loading, a load failure, or no files. */
```

Source line 37

```text
/** One line above the file list, e.g. that the viewer's caps left some files out. */
```

Source line 39

```text
/** Prefix for each file row's agent handle (`agent-plugin-file`, `plugin-file`). */
```

Source line 45

```text
/** A package-relative path with a `<wbr>` after every `/` (visual QA, 2026-08-31). Used by the
 *  content pane's heading since the file list became a tree (2026-09-29). Paths run
 *  long (`skills/interface-design/references/commands/critique.md`) — without a preferred break point
 *  `overflow-wrap: anywhere` (styles.css) was free to split mid-filename, e.g. leaving a lone `d`
 *  orphaned on its own line after "critique.m". `<wbr>` only offers the browser a *preferred* spot
 *  to break, so `overflow-wrap: anywhere` still catches the rare segment too long for the pane on
 *  its own — this only makes the common case break at a path boundary instead of a word. */
```

Source line 67

```text
/** RemixIcon glyph per file family (`package-file-tree.ts`'s {@link packageFileIconKind}). The
 *  `is-<kind>` class on the icon carries its tint (styles.css). */
```

Source line 83

```text
/**
 * The file list as a WAI-ARIA tree, one flat row per visible node (`aria-level` carries the
 * nesting), so the selected row's highlight spans the pane's full width the way VS Code's does.
 * Expansion, focus and keys are `usePackageFileTree`; a row's full path is its tooltip, since long
 * names truncate rather than wrap. File rows keep the `…-select` agent handles the flat list had.
 */
```

Source line 158

```text
/**
 * Wrap-safe stand-in for Jini's `CodeWithLines`, used only while wrapping is on. `CodeWithLines`
 * renders the gutter and the code as two independent `white-space: pre` text blocks that stay
 * aligned only because neither one wraps — the instant a code line wraps to more than one visual
 * row, every later gutter number drifts out of sync with its line. This lays out one CSS grid row
 * per source line instead (`.code-viewer--wrap` in styles.css): a wrapped line's row simply grows
 * taller, and its own gutter number grows with it, so nothing downstream can ever desync.
 */
```

Source line 182

```text
/**
 * Keyed by `file.relativePath` in the parent, so switching the selected file remounts this and
 * resets `wrap` to its default rather than carrying a manual toggle across files.
 *
 * Defaults to wrapped for every file. Previously unwrapped for `plugin.json`/`.ts` sources on the
 * theory that structure reads better with no wrap; in practice the most likely first click in this
 * modal (`plugin.json`) ran a long line off the pane indefinitely, and the owner had to scroll
 * horizontally just to read it (owner correction, 2026-09-10). The toggle keeps unwrapped one click
 * away for whoever genuinely wants raw structure.
 *
 * A file listed without content (binary, too large, a symlink) shows its reason instead, and has no
 * Wrap toggle — there is nothing to wrap.
 */
```

Source line 255

```text
  // File paths are stable and unique within one package, same per-row-handle derivation every
```

Source line 256

```text
  // other list on this workstream uses (`buildAgentListHandles`).
```

### apps/admin/src/features/plugins/rules.ts (23 comments)

Source line 190

```text
/**
 * Segments that are acronyms, not words. Title-casing these produced "Ui Ux Design" for the
 * installed `ui-ux-design` package (2026-09-09, seen rendered) — a name an operator has to decode
 * rather than recognize, on the one screen whose whole job is recognizing a package at a glance.
 *
 * A closed list, not a heuristic: no rule distinguishes the acronym "ui" from a hypothetical word
 * segment, and inventing one would eventually shout a real word in capitals.
 */
```

Source line 214

```text
/**
 * Vocabulary -> glyph family, in evaluation order. Ordered rather than a flat map because a package
 * can legitimately match two families, and a stable first-match beats whichever key an object
 * happened to iterate first.
 *
 * Matching is on whole words only. A substring match would classify any id containing "ui" —
 * `build-ui`, but also `guide-something` — as a design package.
 */
```

Source line 230

```text
/** Lowercase whole-word tokens of one string. */
```

Source line 235

```text
/** First vocabulary family any of `tokens` matches, or `undefined`. */
```

Source line 243

```text
/**
 * Which glyph identifies one Agent Plugin in the installed list.
 *
 * Derived from the package's OWN vocabulary rather than from an allowlist of known plugin ids. An
 * id allowlist is exactly what `AGENT_PLUGINS_LIST` just replaced (the hardcoded
 * `HOST_BUNDLED_AGENT_PLUGINS` catalog), and reintroducing one here would mean a future installed
 * plugin renders with no glyph until someone remembers to add it.
 *
 * The three sources are consulted in TIERS — id, then keywords, then skill names — not merged into
 * one bag. Merging is what the first attempt did, and it put the same shield on `site-compliance`
 * and `ui-ux-design`: the latter's `frontend-accessibility` skill matched the compliance family
 * before anything in its own id was considered, so the two packages this list most needs to tell
 * apart rendered identically. A package's own NAME is the strongest statement of what it is; a
 * skill it happens to bundle is the weakest.
 *
 * Falls back to `"package"` — a deliberately generic glyph — when nothing matches. Guessing a
 * themed icon for an unrecognized package would assert a category host has no evidence for.
 *
 * @complexity O(k * w) over the package's own token count and the vocabulary size — both small,
 * and computed once per row render.
 */
```

Source line 282

```text
/**
 * The enable/disable switch's `aria-label`. Same reasoning as {@link pluginToggleAriaLabel} for the
 * sibling screen: every row's switch reads "Enable"/"Disable" identically, so without the plugin's
 * own name in the accessible name, nothing reading the accessibility tree can tell one row's
 * control from another's.
 *
 * Names the target action, not the current state, and never the transient busy state — a `role`
 * of `switch` already publishes the current position through `aria-checked`, and an accessible name
 * that flipped mid-interaction would read worse than one that stays put.
 *
 * @complexity O(1).
 */
```

Source line 299

```text
/** {@link buildAgentPluginDisableConfirmCopy}'s two pieces of copy — same `{ title, body }` shape as
 *  `features/settings/rules.ts`'s `RemoveConfirmCopy`, the precedent this dialog mirrors. */
```

Source line 306

```text
/**
 * Names the exact plugin in the title (an operator with several installed must see WHICH one is
 * about to stop reaching the assistant), and states in the body what disabling actually does and
 * does not do: it is reversible (the package stays on disk and can be re-enabled), unlike
 * `features/settings/rules.ts`'s `buildExternalMcpRemoveConfirmCopy` counterpart, whose "Remove"
 * discards a sealed credential for good.
 *
 * `variant` is the SAME underlying operation (`AGENT_PLUGIN_SET_ENABLED` with `enabled: false`)
 * asked for from two different controls, added when Downloaded's row lost its Enable/Disable switch
 * in favor of a single Turn off/Enable action (2026-09-09 — see `AgentPlugins.tsx`'s own header):
 *   - `"disable"` — Installed tab's switch. Confirm reads "Disable"; the row it guards already says
 *     "Enabled"/"Disabled", so naming the same verb keeps the dialog consistent with the control.
 *   - `"remove"` — Downloaded tab's action button. Confirm reads "Turn off" to match that button, but
 *     the body's bundled-package sentence is reused VERBATIM across both — the fact that this can't
 *     actually delete anything doesn't change based on which control asked.
 *
 * The bundled-package sentence is unconditional rather than gated on a per-plugin flag: every
 * Agent Plugin installed today ships bundled with host (`AGENT_PLUGINS_LIST`'s three rows are all
 * `origin: "bundled"` — see `AgentPluginRow`'s own header on why its uninstall button is honestly
 * disabled for the same reason), and `AdminAgentPlugin` does not expose `origin` to this screen at
 * all. Stating it as a plugin-specific conditional would require inventing that field; stating it
 * as a fact true of every row today does not. This sentence will need to become conditional once
 * `installAgentPluginFromUrl` gains a production caller and `origin` reaches the wire — tracked
 * here rather than silently assumed permanent.
 *
 * @complexity Time/space: O(1) — one ternary, no iteration.
 */
```

Source line 352

```text
/**
 * The Downloaded tab's own remove/enable action button `aria-label` — same reasoning as
 * {@link agentPluginToggleAriaLabel} for the Installed tab's switch: every row's button reads
 * "Turn off"/"Enable" identically, so the plugin's own name has to be in the accessible name for
 * anything reading the accessibility tree to tell rows apart.
 *
 * Reads "Turn off" for a currently-enabled row (Downloaded's stand-in for the switch's "on" state —
 * see `AgentPlugins.tsx`'s own header for why Downloaded dropped the switch) and "Enable" for a
 * currently-disabled one, mirroring {@link agentPluginToggleAriaLabel}'s own verb choice exactly so
 * the two tabs describe the same underlying states in the same words.
 *
 * @complexity O(1).
 */
```

Source line 370

```text
/**
 * One row of the shared package-files viewer (`PackageFilesModal.tsx`), whichever screen fed it:
 * Agent Plugins' catalog entries fit as they are; `PLUGIN_FILES` entries go through
 * {@link toPackageFileView}.
 */
```

Source line 377

```text
/** `null` when the file is listed but its content is not shown. */
```

Source line 379

```text
/** Why `content` is `null`, shown in its place. */
```

Source line 383

```text
/** What the viewer's content pane says while no file is selected. */
```

Source line 386

```text
/** `alert` for a load failure; `status` for loading or an empty package. */
```

Source line 390

```text
/** English source strings (the i18n keys) for each `PLUGIN_FILES` omission reason. */
```

Source line 398

```text
/**
 * Maps one `PLUGIN_FILES` entry onto a viewer row. An omitted file keeps its place in the list and
 * says why it has no content; a reason this client does not know yet (or a contract-breaking
 * `null` content) reads as unreadable instead of rendering blank.
 * @complexity O(1).
 */
```

Source line 410

```text
/**
 * The content pane's message before a file can be selected: a failure wins, then loading, then an
 * empty package.
 * @complexity O(1).
 */
```

Source line 425

```text
/** Set only when `PLUGIN_FILES` reports its caps cut the listing short.
 *  @complexity O(1). */
```

Source line 431

```text
/** The part of a files listing the viewer reads — shared by `PLUGIN_FILES` and
 *  `AGENT_PLUGIN_FILES`, whose responses differ only outside it. */
```

Source line 435

```text
/** One settled package-files read: the listing, or the failure text in its place. */
```

Source line 441

```text
/** What the package-files viewer renders from one read — see {@link packageFilesViewState}. */
```

Source line 449

```text
/**
 * The file whose `relativePath` is `selectedPath`, else the tree's top file row (what the user sees
 * first, not the listing's first entry); `null` only for an empty list. An unknown path falls back
 * the same way rather than clearing the selection.
 * @complexity O(files log files) on the fallback, O(files) otherwise.
 */
```

Source line 462

```text
/**
 * Maps one read onto the viewer's rows, selection, status, and caps notice. `read` is `null` while
 * the listing is still loading.
 * @complexity O(files) — capped server-side at 200.
 */
```

### apps/admin/src/features/plugins/hooks/use-agent-plugins.hooks.ts (18 comments)

Source line 10

```text
/**
 * @file State for the Agent Plugins screen, so `AgentPlugins.tsx` is only markup — same split as
 * this directory's own `use-plugins.hooks.ts` (`Plugins.tsx`'s hook).
 *
 * REWRITTEN 2026-09-09: this hook used to return the static, checked-in `HOST_BUNDLED_AGENT_PLUGINS`
 * constant with no I/O at all (the module's own prior header said so explicitly: "a port would be
 * ceremony with nothing to inject"). That premise is gone — `AGENT_PLUGINS_LIST`
 * (`server/inbound/admin-http/routes/agent-plugins/list.ts`) now exists, so this hook has a real
 * host boundary to inject, and gets the same `port` (`AgentPluginsPort`) / `useX(dependencies)` /
 * `useWiredX()` split `use-plugins.hooks.ts` already uses for this feature's sibling screen.
 *
 * EXTENDED 2026-09-09 (visual redesign): `onToggleEnabled` wires the row's enable/disable switch to
 * `AGENT_PLUGIN_SET_ENABLED`. That is a real activation write — `resolveAgentPluginRefs()` refuses a
 * run pinning a disabled plugin — so the switch's rendered position must always be server truth,
 * never an optimistic guess. See {@link useAgentPlugins}'s own `@tradeoffs`.
 *
 * `describeApiError` here is the shared default from `lib/api.ts`, not this feature's
 * `rules.ts` override — that override's `PLUGIN_NOT_FOUND`/`PLUGIN_INVALID`/`PLUGIN_INCOMPATIBLE`
 * codes belong to the `.cms-plugin` enable/disable route this screen does not call. This screen's
 * own route answers `AGENT_PLUGIN_NOT_FOUND`/`VALIDATION_ERROR`, neither of which that override
 * knows, so the shared default (which surfaces the server's own message) is the better fit.
 *
 * `t` (standing i18n rule, 2026-08-11): resolved from `useAdminLocale()` in `useWiredAgentPlugins`
 * and returned as a bound `t`, rather than `AgentPlugins.tsx` calling `useAdminLocale()`/
 * `plugins-i18n` directly.
 */
```

Source line 37

```text
/** The minimal shape `AgentPluginDetailsModal` actually reads (`plugin.id`/`plugin.displayName`) —
 *  see that component's own narrowed prop type. Kept here, not re-exported from the deleted
 *  `agent-plugin-catalog.ts`, since nothing about it is bundle-specific anymore: any installed
 *  plugin's id plus a human-readable label is enough to open the inspector. */
```

Source line 53

```text
/** `null` until the initial load settles — the caller renders a loading state. */
```

Source line 56

```text
/** The last failed toggle's message, or `null`. Separate from `error` (which means "the list
   *  itself could not load"), so a refused toggle does not blank the list the operator is reading. */
```

Source line 59

```text
/** Plugin ids with an enable/disable request in flight right now. A `Set` rather than the sibling
   *  screen's single `rowSavingId` — see {@link useAgentPlugins}'s `@tradeoffs`. */
```

Source line 62

```text
/** Flips one plugin's activation and replaces that row with the server's answer. */
```

Source line 64

```text
/** Plugin ids whose row detail panel (keywords, portable components, MCP servers) is open. */
```

Source line 66

```text
/** Opens or closes one row's detail panel. */
```

Source line 68

```text
/** The plugin currently open in the read-only package inspector, or `null` when it's closed. */
```

Source line 70

```text
/** Opens the inspector for `plugin`. */
```

Source line 72

```text
/** Closes the inspector. */
```

Source line 74

```text
/** Bound translator — `AgentPlugins.tsx`'s only source of UI copy; see this file's own header. */
```

Source line 76

```text
/** The raw resolved locale — exposed only because `AgentPlugins.tsx` passes it straight through
   *  to `I18nProvider`'s own `initialLocale`, not because anything here needs it beyond `t`. Same
   *  reasoning as `use-plugins.hooks.ts`'s own `locale` field. */
```

Source line 82

```text
/** Adds or removes one id, returning a new `Set` — so React sees an identity change. */
```

Source line 90

```text
/**
 * Loads the real installed Agent Plugins for this workspace once on mount, and toggles one
 * plugin's activation at a time per row.
 *
 * @complexity One GET on mount, plus one PATCH per toggle. No re-fetch: the route answers with the
 * updated row, which replaces its own entry in place.
 * @tradeoffs No optimistic flip. The switch shows only what the server has confirmed, so a refused
 * or failed toggle can never leave the operator looking at an "on" switch for a plugin that will
 * refuse the next run. The cost is one round-trip of visible latency, which the row's own
 * in-flight state covers.
 *
 * Row replacement goes through `setAgentPlugins`' functional updater rather than closing over the
 * array this render saw. Two rows toggled in quick succession settle independently, and a
 * settlement holding a stale array would otherwise revert the other row's newer answer.
 */
```

Source line 121

```text
    // A second activation of this row's own switch while its request is outstanding is a no-op —
```

Source line 122

```text
    // the same client-side single-flight discipline `usePlugins` uses, applied per row.
```

Source line 154

```text
/**
 * Binds the real `/api/.../agent-plugins` client and the real `useAdminLocale()` — see
 * `agent-plugins-dependencies.hooks.ts`.
 *
 * The zero-argument-dependencies half of the `useX(dependencies)` / `useWiredX()` pair, so
 * `AgentPlugins.tsx` composes this and a test composes {@link useAgentPlugins} with
 * `createFakeAgentPluginsPort`.
 */
```

### apps/admin/src/features/plugins/hooks/agent-plugins-port.hooks.ts (2 comments)

Source line 3

```text
/**
 * @file What `use-agent-plugins.hooks.ts` needs from the outside world, as an interface rather than
 * a direct `lib/api` import. Same `useX(dependencies)` / `useWiredX()` pair `plugins-port.hooks.ts`
 * establishes for this feature's sibling screen (`Plugins.tsx`).
 *
 * `setAgentPluginEnabled` resolves to the ONE updated row, unlike `PluginsPort`'s own
 * `setPluginEnabled` (which resolves to a change-set id and leaves its caller to re-fetch the whole
 * list). The row comes back in `listAgentPlugins`' exact shape, so the hook replaces one entry in
 * place — no second GET, and no window in which an unrelated row could be clobbered by a reload
 * that settled after a newer toggle.
 */
```

Source line 17

```text
/** `AGENT_PLUGIN_FILES` — the read-only package-files listing behind the row's eye button
   *  (`use-agent-plugin-details-modal.hooks.ts`). */
```

### apps/admin/src/features/plugins/hooks/agent-plugins-dependencies.hooks.ts (8 comments)

Source line 4

```text
/**
 * @file The only place under `features/plugins`'s Agent Plugins screen hook that reaches
 * `lib/api` — see `agent-plugins-port.hooks.ts` for why the split exists. Mirrors `plugins-
 * dependencies.hooks.ts`'s identical split for `Plugins.tsx`.
 */
```

Source line 10

```text
/** The live implementation, as a module-level singleton — matches `defaultPluginsPort`. */
```

Source line 17

```text
/** Seed state for {@link createFakeAgentPluginsPort}. */
```

Source line 20

```text
/** Makes `setAgentPluginEnabled` reject with this instead of writing — for the hook's own
   *  failure-path test. The seeded `enabled` value is left untouched, so a test can then assert the
   *  UI did not keep a toggle the server refused. */
```

Source line 24

```text
/** Resolves each `setAgentPluginEnabled` call only when the returned `settle` is invoked, so a
   *  test can hold two toggles in flight at once and settle them out of order. Without it the fake
   *  resolves immediately. */
```

Source line 28

```text
/** `AGENT_PLUGIN_FILES` responses by plugin id; an id with no entry rejects like the route's 404. */
```

Source line 32

```text
/**
 * An in-memory {@link AgentPluginsPort} for tests — mirrors `createFakePluginsPort`'s identical
 * role for `PluginsPort`.
 *
 * The toggle really mutates the fake's own copy and echoes the row back, so a test asserting the
 * post-toggle UI is reading state that round-tripped through the port rather than a value the
 * component kept locally.
 */
```

Source line 41

```text
/** Pending `setAgentPluginEnabled` resolvers, in call order — only populated with `deferToggles`. */
```

### apps/admin/src/features/plugins/hooks/use-agent-plugin-details-modal.hooks.ts (4 comments)

Source line 8

```text
/**
 * @file `AgentPluginDetailsModal`'s data: one `AGENT_PLUGIN_FILES` read for the inspected plugin,
 * mapped onto the shared viewer's rows, plus which file is selected.
 *
 * REWRITTEN 2026-09-13: this hook used to read `agent-plugin-source-catalog.ts`, a compile-time list
 * that knew only the plugins someone had hand-added — `supabase` and `site-customization` had no entry, so
 * their eye button opened an empty viewer. It now reads the installed package from the server and
 * delegates to the Plugins screen's own `usePluginPackageFiles`, so every installed plugin (switched
 * on or off) shows its real files, and the stale-read and selection handling exist once.
 *
 * `useX(dependencies)` / `useWiredX()` pair: a test composes {@link useAgentPluginDetailsModal} with
 * `createFakeAgentPluginsPort`.
 */
```

Source line 22

```text
/** What `AgentPluginDetailsModal` renders from. `status`/`listNotice` are optional so a rendering
 *  test's fake can supply just a file list; absent reads as nothing to report. */
```

Source line 33

```text
/**
 * Loads one installed Agent Plugin's package files once per `pluginId`.
 *
 * @complexity One GET per `pluginId`; O(files) per render (capped server-side at 200) — see
 * {@link usePluginPackageFiles}.
 */
```

Source line 43

```text
/** Binds the real `/api/.../agent-plugins/:id/files` client and a `plugins-i18n.ts` translator for
 *  the current admin locale. */
```

### apps/admin/src/features/plugins/hooks/use-agent-plugin-disable-confirm.hooks.ts (3 comments)

Source line 7

```text
/**
 * @file `AgentPluginDisableConfirmDialog`'s three behaviours — Escape-to-cancel, the name-derived
 * copy, and (2026-09-20 platform review, Finding 4) the Tab focus trap — so the dialog component
 * itself is only markup. Mirrors `features/settings/hooks/use-external-mcp-remove-confirm.hooks.ts`
 * (same split, same reason: `copy` is a derived value, not something the component should compute
 * inline).
 *
 * Not sharing that settings hook directly: it is feature-local by its own header's stated
 * convention (one consumer, `features/settings`), and duplicating an 8-line Escape effect here is
 * cheaper than a cross-feature import for a second single-consumer hook. If a third confirm dialog
 * needs the same listener, that is the point to extract a shared one, not before.
 *
 * Focus trap (Finding 4): same gap and same fix as `use-plugin-remove-confirm.hooks.ts`'s sibling
 * hook — see that file's header for the full rationale. Wired through the shared `useFocusTrap`
 * primitive (`ebcda9aae`) here, not in the component body.
 */
```

Source line 26

```text
/** Attach to the `role="dialog"` div — see this file's header. */
```

Source line 46

```text
    // eslint-disable-next-line react-hooks/exhaustive-deps
```

### apps/admin/src/features/plugins/hooks/use-plugin-package-files.hooks.ts (11 comments)

Source line 16

```text
/**
 * @file `PluginPackageFilesModal`'s data: one `PLUGIN_FILES` read for the inspected plugin, mapped
 * onto the shared `PackageFilesModal`'s row shape, plus which file is selected. The Agent Plugins
 * viewer (`use-agent-plugin-details-modal.hooks.ts`) reuses this same hook over `AGENT_PLUGIN_FILES`
 * (2026-09-13), so both screens share one stale-read and selection implementation.
 *
 * `useX(dependencies)` / `useWiredX()` pair, same as `use-plugins.hooks.ts`: a test composes
 * {@link usePluginPackageFiles} with `createFakePluginsPort`.
 */
```

Source line 28

```text
/** Any read that yields a listing — `PluginsPort.getPluginFiles`, or an adapter over
   *  `AgentPluginsPort.getAgentPluginFiles`. */
```

Source line 35

```text
/** `[]` until the listing settles, and after a failed load. */
```

Source line 37

```text
/** The selected file, else the first listed one; `null` only while `files` is empty. */
```

Source line 39

```text
/** Selects by `relativePath`. An unknown path falls back to the tree's top file rather than clearing. */
```

Source line 41

```text
/** Loading, failure (`role: "alert"`), or an empty package — `null` once there are files. */
```

Source line 43

```text
/** Set when the server's caps left some files out. */
```

Source line 45

```text
/** Bound translator — the modal's only source of copy. */
```

Source line 49

```text
/** The last settled read, tagged with the plugin it was for. */
```

Source line 54

```text
/**
 * Loads one plugin's package files once per `pluginId`.
 *
 * A read that settles after `pluginId` changed (or after unmount) is dropped by the effect's cleanup
 * flag, and a stored read for a different id is never rendered — so a slow response for the
 * previously inspected plugin can never show under the current one's title. Mapping the read onto
 * rows, selection, and status is `rules.ts`'s {@link packageFilesViewState}.
 *
 * @complexity One GET per `pluginId`; O(files) per render to map rows (capped server-side at 200).
 */
```

Source line 87

```text
/** Binds the real `/api/.../plugins/:id/files` client and a `plugins-i18n.ts` translator for the
 *  current admin locale. */
```

### apps/admin/src/features/plugins/hooks/use-package-file-tree.hooks.ts (9 comments)

Source line 11

```text
/**
 * @file `PackageFilesModal`'s file-tree state (2026-09-29): which folders are open, which row holds
 * keyboard focus, and what a click or key press does. The tree shape, visible rows and key mapping
 * are the pure helpers in `package-file-tree.ts`; this hook only stores state and moves DOM focus.
 *
 * Expansion is derived, not synced: a folder is open when the viewer toggled it open, or — until
 * they toggle it — when it contains the selected file. So the folders around the first selected file
 * open on their own once the listing loads, with no effect copying selection into state.
 */
```

Source line 22

```text
/** Every listed file's `relativePath`. */
```

Source line 29

```text
/** Attach to the `role="tree"` element; keyboard moves focus to rows inside it. */
```

Source line 32

```text
/** The one row with `tabIndex=0` (roving tabindex); `null` only while there are no rows. */
```

Source line 36

```text
/** A folder row toggles; a file row opens. */
```

Source line 38

```text
/** Keeps the roving tabindex on whichever row focus landed on (a click, or a Tab back in). */
```

Source line 42

```text
/**
 * @returns The rows to render and the handlers for the tree.
 * @complexity O(files) per render to rebuild visible rows; the tree itself is memoized on the paths.
 */
```

Source line 60

```text
  // Only after a key press: DOM focus follows the roving tabindex. Never on mount or on a
```

Source line 61

```text
  // selection that came from outside, so opening the dialog doesn't pull focus into the tree.
```

### apps/admin/src/features/plugins/hooks/use-package-file-wrap.hooks.ts (3 comments)

Source line 3

```text
/**
 * @file `PackageFilesModal`'s per-file line-wrap toggle, split out of the `.tsx` per this admin's
 * rule that component state lives in `hooks/`. The component calling this is keyed by the selected
 * file's path, so choosing another file remounts it and the toggle resets to wrapped instead of
 * carrying a manual override across files.
 */
```

Source line 11

```text
/** `true` by default for every file — see `PackageFilesModal.tsx`'s content-pane doc for why. */
```

Source line 16

```text
/**
 * @returns Whether the open file's lines wrap, and a toggle.
 * @complexity O(1).
 */
```

### Restored boundary comment — apps/admin/src/features/plugins/rules.ts:178

```text
/**
 * Title-cases a kebab-case Agent Plugin id into a human display name (`"site-compliance"` ->
 * `"Site Compliance"`) — `AGENT_PLUGINS_LIST` (`server/inbound/admin-http/routes/agent-plugins/
 * list.ts`) reports only `pluginId`, never a separate hand-curated `displayName` the way the old,
 * now-deleted `HOST_BUNDLED_AGENT_PLUGINS` catalog did, so `AgentPlugins.tsx` needs a pure
 * formatting step rather than a stored field. Mirrors `tool-registrations.ts`'s server-side
 * `humanize()` (same transform, independently kept per that file's own "private formatting helper
 * of a sibling module" precedent — see its header) — that copy has no override map of its own; it
 * feeds an LLM-facing tool description, a different surface this pass did not touch.
 *
 * @complexity O(n) in `pluginId`'s length.
 */
```

## Additional shared source: index.ts

Historical export/localization rationale retained; dictionaries are not ported.

```text
/**
 * @file Public surface of the `plugins` feature.
 *
 * `panels.tsx` imports from HERE, never from a file inside this folder. That indirection is the
 * point of the feature boundary: everything below can be split, renamed, or grown a `hooks/`
 * directory without the router noticing. Adding a file to this feature is not an API change unless
 * it is exported from this line.
 */
```

## Additional shared source: plugins-i18n.ts

Historical export/localization rationale retained; dictionaries are not ported.

```text
/**
 * @file Spanish translation for the `plugins` feature's own screens (`Plugins.tsx` and
 * `AgentPlugins.tsx`) — this feature's own dictionary, not the shared `lib/admin-nav-i18n.ts` one,
 * so parallel translation passes over other admin sections can't collide on the same file. Same
 * two-step fallback every other `t()` in this app uses: translated value, else the English source
 * string itself.
 */
```

```text
// i18n sweep 2026-09-22: Plugins/Agent Plugins tab labels and copy — previously called
```

```text
// by t() with no dictionary entry in this locale at all.
```

```text
// "Add-Ons" -> "Integrations" 2026-09-10: the nav group this page's kicker names was renamed
```

```text
// (see `panels.tsx`'s own comment on the group). Only `es` has ever carried a value for this
```

```text
// key — a pre-existing gap, not introduced by this rename — so every other locale still falls
```

```text
// through to the English key itself via `createDictionaryTranslator`'s fallback.
```

```text
// AgentPlugins.tsx's Downloaded/Installed tab split (2026-09-09) — new strings that split
```

```text
// introduced. Downloaded's own lede/empty-state reuse pre-split keys verbatim (see this file's
```

```text
// git history — those two were ALREADY untranslated at HEAD before the split, not something
```

```text
// this pass broke), so only the genuinely new copy is added here.
```

```text
// 2026-09-13: Installed lists every installed Agent Plugin, switched on or off.
```

```text
// Pre-existing gap, not introduced by the Downloaded/Installed split above: the Installed and
```

```text
// Marketplace tab labels, the reused Downloaded lede/empty-state, and the whole Marketplace
```

```text
// panel's own copy had no dictionary entry at all before this split (verified against the
```

```text
// commit before it started) — this closes that, all at once, rather than leaving the Spanish
```

```text
// view of this screen half-translated in a way later work would misattribute to the split.
```

```text
// Plugins.tsx's Installed/Downloaded/Marketplace tab rebuild (2026-09-09) — this screen's OWN
```

```text
// new copy. "Installed"/"Downloaded"/"Marketplace"/"Nothing to browse yet" are reused verbatim
```

```text
// from the keys above (shared tab-label vocabulary across both screens in this dictionary).
```

```text
// Hook-level notice/error strings (use-plugins.hooks.ts) — these never got translated during
```

```text
// the JSX-only pass since they live in `.hooks.ts` files.
```

```text
// PackageFilesModal / PluginPackageFilesModal (2026-09-13).
```

```text
// i18n sweep 2026-09-22: Plugins/Agent Plugins tab labels and copy — previously called
```

```text
// by t() with no dictionary entry in this locale at all.
```

```text
// PackageFilesModal / PluginPackageFilesModal (2026-09-13).
```

```text
// i18n sweep 2026-09-22: Plugins/Agent Plugins tab labels and copy — previously called
```

```text
// by t() with no dictionary entry in this locale at all.
```

```text
// PackageFilesModal / PluginPackageFilesModal (2026-09-13).
```

```text
// i18n sweep 2026-09-22: Plugins/Agent Plugins tab labels and copy — previously called
```

```text
// by t() with no dictionary entry in this locale at all.
```

```text
// PackageFilesModal / PluginPackageFilesModal (2026-09-13).
```

```text
// i18n sweep 2026-09-22: Plugins/Agent Plugins tab labels and copy — previously called
```

```text
// by t() with no dictionary entry in this locale at all.
```

```text
// PackageFilesModal / PluginPackageFilesModal (2026-09-13).
```

```text
// i18n sweep 2026-09-22: Plugins/Agent Plugins tab labels and copy — previously called
```

```text
// by t() with no dictionary entry in this locale at all.
```

```text
// PackageFilesModal / PluginPackageFilesModal (2026-09-13).
```

```text
// i18n sweep 2026-09-22: Plugins/Agent Plugins tab labels and copy — previously called
```

```text
// by t() with no dictionary entry in this locale at all.
```

```text
// PackageFilesModal / PluginPackageFilesModal (2026-09-13).
```

```text
// i18n sweep 2026-09-22: Plugins/Agent Plugins tab labels and copy — previously called
```

```text
// by t() with no dictionary entry in this locale at all.
```

```text
// PackageFilesModal / PluginPackageFilesModal (2026-09-13).
```

```text
// i18n sweep 2026-09-22: Plugins/Agent Plugins tab labels and copy — previously called
```

```text
// by t() with no dictionary entry in this locale at all.
```

```text
// PackageFilesModal / PluginPackageFilesModal (2026-09-13).
```

```text
// i18n sweep 2026-09-22: Plugins/Agent Plugins tab labels and copy — previously called
```

```text
// by t() with no dictionary entry in this locale at all.
```

```text
// PackageFilesModal / PluginPackageFilesModal (2026-09-13).
```

```text
// i18n sweep 2026-09-22: Plugins/Agent Plugins tab labels and copy — previously called
```

```text
// by t() with no dictionary entry in this locale at all.
```

```text
// PackageFilesModal / PluginPackageFilesModal (2026-09-13).
```

```text
// i18n sweep 2026-09-22: Plugins/Agent Plugins tab labels and copy — previously called
```

```text
// by t() with no dictionary entry in this locale at all.
```

```text
// PackageFilesModal / PluginPackageFilesModal (2026-09-13).
```

```text
// i18n sweep 2026-09-22: Plugins/Agent Plugins tab labels and copy — previously called
```

```text
// by t() with no dictionary entry in this locale at all.
```

```text
// PackageFilesModal / PluginPackageFilesModal (2026-09-13).
```

```text
// i18n sweep 2026-09-22: Plugins/Agent Plugins tab labels and copy — previously called
```

```text
// by t() with no dictionary entry in this locale at all.
```

```text
// PackageFilesModal / PluginPackageFilesModal (2026-09-13).
```

```text
// i18n sweep 2026-09-22: Plugins/Agent Plugins tab labels and copy — previously called
```

```text
// by t() with no dictionary entry in this locale at all.
```

```text
// PackageFilesModal / PluginPackageFilesModal (2026-09-13).
```

```text
// i18n sweep 2026-09-22: Plugins/Agent Plugins tab labels and copy — previously called
```

```text
// by t() with no dictionary entry in this locale at all.
```

```text
// PackageFilesModal / PluginPackageFilesModal (2026-09-13).
```

```text
// i18n sweep 2026-09-22: Plugins/Agent Plugins tab labels and copy — previously called
```

```text
// by t() with no dictionary entry in this locale at all.
```

```text
// PackageFilesModal / PluginPackageFilesModal (2026-09-13).
```

```text
// i18n sweep 2026-09-22: Plugins/Agent Plugins tab labels and copy — previously called
```

```text
// by t() with no dictionary entry in this locale at all.
```

```text
// PackageFilesModal / PluginPackageFilesModal (2026-09-13).
```

```text
// i18n sweep 2026-09-22: Plugins/Agent Plugins tab labels and copy — previously called
```

```text
// by t() with no dictionary entry in this locale at all.
```

```text
// PackageFilesModal / PluginPackageFilesModal (2026-09-13).
```

```text
// i18n sweep 2026-09-22: Plugins/Agent Plugins tab labels and copy — previously called
```

```text
// by t() with no dictionary entry in this locale at all.
```

```text
// PackageFilesModal / PluginPackageFilesModal (2026-09-13).
```

```text
// i18n sweep 2026-09-22: Plugins/Agent Plugins tab labels and copy — previously called
```

```text
// by t() with no dictionary entry in this locale at all.
```

```text
// PackageFilesModal / PluginPackageFilesModal (2026-09-13).
```
