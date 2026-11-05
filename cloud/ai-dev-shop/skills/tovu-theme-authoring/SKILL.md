---
name: tovu-theme-authoring
version: 1.0.0
last_updated: 2026-08-10
description: Use when creating, editing, or explaining a Tovu theme (any tier — static, declarative, templated/LiquidJS, handlebars), or when asked how Tovu's theme system works (discovery, tiers, theme.json schema, slots, embeds, regions, post templates).
---

# Skill: Tovu Theme Authoring

Domain skill for Tovu's `src/themes/` system. Thin by design — the canonical reference is:

**`development/docs/themes/theme-authoring-guide.md`**

Read that file before doing any theme work. It has the full request-path trace (discovery → selection → render), the complete `theme.json` schema split into "fields the loader actually reads" vs. "fields every theme writes that nothing reads," per-tier directory layouts, the slots/embeds/regions mechanisms, the `templateChoice`/`overridesThemePage` distinction, and a minimal worked example for a new static theme. Do not re-derive any of that from scratch or from a theme's own doc comments — this guide's claims are `path:line`-cited against the actual loader/renderer code, which is more authoritative than any single ADR (the ADRs it cross-references predate the `static` and `handlebars` tiers and do not list them).

Also skim `src/themes/README.md` for the one-paragraph orientation on the four tier subfolders.

## Load-bearing traps (the guide covers these in depth — this is the "don't skip the guide" list)

- **`theme.json`'s `modes`, `defaultMode`, `pages`, and `slots` fields are not read by any code.** Editing them does nothing. The actual slot mechanism is filename convention (`nav.html`, `footer*.html`) plus a hardcoded marker regex in `static-render.ts`, not the `slots` field.
- **`templateChoice` is a tri-state**, and `null` vs `""` are not interchangeable "unset" values — conflating them caused a real production regression (15/19 posts silently served a diagnostic page). See the guide's §7.1 before writing any code that sets this field.
- **Not every static theme embeds the CMS menu.** Most do (`data-embed-type="menu"` in `nav.html`); one hardcodes its nav links instead. Check the theme's own `nav.html`, don't assume.
- **Static-theme navs never render nested/child menu items** — only top-level links, on every theme, because none of the 7 live static themes ship submenu CSS.
- **The `handlebars` tier has a complete, tested render pipeline (allowlist, worker sandbox, discovery) and zero themes.** It is not dead code and not a stub — there's simply nothing to copy from inside this repo. Use the `templated` tier's `storefront` theme as a structural (not syntactic) starting point if asked to build one.
- **A widget-placement "region" (`theme.json`'s `regions` field, `{"type":"region"}` nodes) and a Page-authoring "region" (`data-agent-element`/`data-agent-role="region"` in `src/features/pages/skeleton.ts`) are unrelated mechanisms that share a name.** Don't conflate them.
- **No CSS sanitization exists for any tier.** A theme's `styles.css` is trusted, unvalidated content today, despite ADR-010's stated intent.
- **Discovery happens once at server boot.** Editing a theme file on disk (outside the `theme_write_file` agent tool, which re-validates on write) needs a server restart to take effect.

## Escalation

- If a request asks for a NEW capability (e.g. a parent/child template inheritance system, nested-menu rendering, CSS sanitization) rather than authoring within what exists today, that is design work, not documentation — do not extend this skill's guidance to cover unbuilt features. Check whether a design effort is already in flight before proposing one.
- If something in the live theme code contradicts the guide, trust the code, then flag the guide as stale — it is a snapshot as of 2026-08-10, not a live-generated doc.
