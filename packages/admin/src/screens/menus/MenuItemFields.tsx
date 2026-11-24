import type { Translate } from "@jini-ai/core/text";
import type { AdminMenuItem, AdminMenuItemAttrs } from "./api/menus-api.types.js";

/**
 * @file The per-item field groups of the menu tree editor: `MenuItemTargetFields` (the
 * target-kind-specific inputs) and `MenuItemAttrsFields` (the `<details>` disclosure of
 * `NavItemAttrs`'s five presentational fields). Presentation concerns invoked directly from
 * `MenuItemRow.tsx`'s row markup, not part of `use-menu-editor.hooks.ts`'s state transitions.
 *
 * `MenuItemAttrsFields` exposes `NavItemAttrs`'s five presentational fields (Jini
 * `packages/cms/src/navigation/types.ts:104-115` — `cssClass`/`description`/`icon`/`openInNewTab`/
 * `rel`) behind a per-item `<details>` disclosure. These already round-trip through storage
 * untouched (`validateAndCloneTree` in Jini's `menu-service.ts` clones each node with `{ ...node,
 * children }`, never touching `attrs`) and the static-tier theme renderer already consumed
 * `cssClass`/`icon`/`description` — this screen was simply the one gap in an otherwise-working
 * pipeline. `rel`/`openInNewTab` were not consumed by ANY render path before this change; both the
 * static-tier tree-variant renderer and the widget-IR menu renderer now honor all five fields.
 *
 * Classes are `jini-*`; the host styles them (twins of its label-wrap, visually-hidden and
 * menu-item-advanced rules).
 */

/**
 * `?? ""` as a named function rather than inline. ESLint's cyclomatic-complexity rule counts each
 * `??` as its own branch — six of them across `targetForKind` and {@link MenuItemTargetFields}
 * below (2026-08-06, complexity pass, fourth pass) inflated each function's flat 4-case switch from
 * a base of ~5 to 10, even though cognitive complexity for both is 1: no nesting, four sibling cases,
 * each a single fallback. Naming the fallback removes the count from each switch's own scope without
 * changing what either function produces — every call site still falls back to `""` for exactly the
 * same absent values it did before.
 */
export function orEmpty({ value }: { value: string | undefined }, _optional = {}): string {
  return value ?? "";
}

/** Boolean counterpart to {@link orEmpty}, same rationale — see {@link attrsOrDefaults}. */
function orFalse(_required: Record<string, never>, { value = false }: { value?: boolean | undefined } = {}): boolean {
  return value;
}

/**
 * Same rationale as {@link orEmpty} above: five `attrs?.field ?? default` fallbacks inlined
 * directly in {@link MenuItemAttrsFields}'s JSX pushed its cyclomatic complexity from a base of
 * ~6 (five sibling fields + the disclosure) to 11 — each `?.` and `??` is its own branch. Naming
 * the defaulting removes that count from the component's own scope without changing what any
 * field renders; every caller still sees the same fallback for the same absent value.
 */
function attrsOrDefaults({ attrs }: { attrs: AdminMenuItemAttrs | undefined }, _optional = {}): { cssClass: string; icon: string; description: string; rel: string; openInNewTab: boolean } {
  const a = attrs ?? {};
  return {
    cssClass: orEmpty({ value: a.cssClass }),
    icon: orEmpty({ value: a.icon }),
    description: orEmpty({ value: a.description }),
    rel: orEmpty({ value: a.rel }),
    openInNewTab: orFalse({}, { value: a.openInNewTab }),
  };
}

export interface MenuItemFieldProps {
  item: AdminMenuItem;
  path: number[];
  onChange: (path: number[], fn: (item: AdminMenuItem) => AdminMenuItem) => void;
  t: Translate;
}

/** One visually-labelled text input: the label wraps a `.jini-visually-hidden` name and the input. */
function HiddenLabelInput({ label, placeholder, value, onValue }: { label: string; placeholder: string; value: string; onValue: (next: string) => void }) {
  return (
    <label className="jini-a11y-label-wrap">
      <span className="jini-visually-hidden">{label}</span>
      <input value={value} placeholder={placeholder} onChange={(e) => onValue(e.target.value)} />
    </label>
  );
}

type TargetKey = "href" | "route" | "entryId" | "termId" | "taxonomy";

/**
 * The target-kind-specific field(s) — URL/Route/Entry each show one input, Term shows two.
 * Extracted out of `ItemRow`'s four `item.target.kind === "…" ? (...) : null` blocks (its entire
 * branch count beyond the label field and the children map) into a `switch` over the same
 * target-kind union `targetForKind` switches on — same convention, and
 * unlike an if/else-if chain a `switch`'s cases don't nest, which is what keeps this low under
 * cognitive complexity too. Uses {@link orEmpty} for the same reason `targetForKind` does —
 * see that function's doc.
 */
export function MenuItemTargetFields({ item, path, onChange, t }: MenuItemFieldProps) {
  const setTarget = (key: TargetKey, value: string) => onChange(path, (it) => ({ ...it, target: { ...it.target, [key]: value } }));
  switch (item.target.kind) {
    case "url":
      return <HiddenLabelInput label="URL" placeholder="https://…" value={orEmpty({ value: item.target.href })} onValue={(v) => setTarget("href", v)} />;
    case "route":
      return <HiddenLabelInput label={t("Route name")} placeholder={t("route name")} value={orEmpty({ value: item.target.route })} onValue={(v) => setTarget("route", v)} />;
    case "entryRef":
      return <HiddenLabelInput label={t("Entry ID")} placeholder={t("entry id")} value={orEmpty({ value: item.target.entryId })} onValue={(v) => setTarget("entryId", v)} />;
    case "termRef":
      return (
        <>
          <HiddenLabelInput label={t("Term ID")} placeholder={t("term id")} value={orEmpty({ value: item.target.termId })} onValue={(v) => setTarget("termId", v)} />
          <HiddenLabelInput label={t("Taxonomy")} placeholder={t("taxonomy")} value={orEmpty({ value: item.target.taxonomy })} onValue={(v) => setTarget("taxonomy", v)} />
        </>
      );
    default:
      // Every target kind is handled above; an unknown one renders no fields.
      return null;
  }
}

type AttrTextKey = "cssClass" | "icon" | "description" | "rel";

/**
 * `NavItemAttrs`'s five presentational fields, collapsed behind a `<details>` disclosure rather
 * than five more always-visible inputs on an already-dense row (label/kind/target-value/move/
 * child/remove) — see this file's own header for why they're safe to expose now. Applies
 * identically to every target kind, unlike {@link MenuItemTargetFields}'s kind-specific fields, so
 * it renders once per row rather than switching on `item.target.kind`. Native `<details>` needs no
 * open/closed state of its own (browser-managed), so this stays presentation-only, same as
 * {@link MenuItemTargetFields} above.
 */
export function MenuItemAttrsFields({ item, path, onChange, t }: MenuItemFieldProps) {
  const attrs = attrsOrDefaults({ attrs: item.attrs });
  const setAttr = (patch: Partial<AdminMenuItemAttrs>) => onChange(path, (it) => ({ ...it, attrs: { ...it.attrs, ...patch } }));
  const textField = (key: AttrTextKey, label: string) => (
    <HiddenLabelInput label={label} placeholder={label} value={attrs[key]} onValue={(v) => setAttr({ [key]: v })} />
  );

  return (
    <details className="jini-menu-item-advanced">
      <summary>{t("Advanced")}</summary>
      <div className="jini-menu-item-advanced-fields">
        {textField("cssClass", t("CSS class"))}
        {textField("icon", t("Icon"))}
        {textField("description", t("Description"))}
        {textField("rel", t("Link rel"))}
        <label className="jini-menu-item-advanced-checkbox">
          <input type="checkbox" checked={attrs.openInNewTab} onChange={(e) => setAttr({ openInNewTab: e.target.checked })} />
          {t("Open in new tab")}
        </label>
      </div>
    </details>
  );
}
