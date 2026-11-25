import { agentHandle } from "@jini-ai/core/agent-handles";
import type { AdminNavItem } from "@jini-ai/core/contracts/site/nav";
import type { UseAdminLocaleHook } from "../kit.js";

/**
 * @file Fallback screen for a section with no dedicated component yet — reached either directly
 * (`App.tsx`'s `SECTIONS` map, e.g. `newsletter`) or via the legacy `/section/:id` route's
 * fallback for any id `parseRoute` accepts without checking it against a known section.
 *
 * Previously looked up `props.sectionId` in a separate, legacy admin-shell registry (a shared,
 * framework-agnostic shell package, since removed as dead code) that only carried 12 of the ~26
 * current sections and never had `newsletter` added. A legitimate `soon: true` nav item therefore
 * fell through to the exact same "Unknown section" error banner as an actual typo'd/bogus id —
 * audit finding (`ADS-memory/reports/audits/20260801-admin-adversarial-ux-audit.md`, Newsletter
 * section + exec summary #3): "any future `soon` nav item is one omission away from the same bug,"
 * confirmed live via `/admin/newsletter` and the `/section/:id` fallback both rendering the
 * identical banner.
 *
 * Fixed at the root rather than by adding `newsletter` to the legacy registry (which would leave
 * the same trap for the next `soon` item): looks up `props.sectionId` in `nav.ts`'s own `getNav()`
 * instead, which already carries every current section's `label` (`soon` included) and cannot
 * drift out of sync with itself the way a second parallel list can. `Unknown section` stays
 * reserved for an id that matches nothing in `getNav()` at all — a genuine bogus id, not a
 * known-but-unbuilt section (see `nav.ts`'s own file header: presence in the nav is about sidebar
 * visibility, not reachability, so this only needs `getNav()` to know a section is real).
 *
 * ## Two exported entry points
 *
 * `Placeholder` is the id-lookup case above: it is always handed a real `nav.ts`/`panels.tsx` `id`
 * and resolves the label/group through `getNav()`. `ComingSoonNotice` is the body markup with that
 * lookup stripped out, for a caller whose id `getNav()` would not recognize. Its one other caller,
 * `components/PlaceholderTabs.tsx` (one "coming soon" notice per panel-local tab id), was deleted
 * 2026-09-21 as dead code, so today `Placeholder` is its only caller.
 */

/**
 * @complexity O(n) in the total nav item count across all groups (currently ~26) — a linear scan,
 * acceptable for a lookup that runs once per Placeholder render against a small, static list.
 * @overallScore 100
 */
function findNavItem({ sectionId, navGroups }: { sectionId: string; navGroups: readonly { label?: string; items: readonly AdminNavItem[] }[] }, _options: Record<string, never> = {}): AdminNavItem | undefined {
  for (const group of navGroups) {
    const item = group.items.find((entry) => entry.id === sectionId);
    if (item) return item;
  }
  return undefined;
}

/** The nav group this item lives in, for the page header's kicker — "Overview" for the ungrouped
 *  top row (matches how `AiAssistant.unit.test.tsx` itself describes that row), otherwise the
 *  group's own `label`. Real IA, not an invented word: every kicker in this pass reuses a `nav.ts`
 *  group label rather than a per-screen ad hoc string.
 *
 * Exported for `PlaceholderTabs`, deleted 2026-09-21 as dead code; `Placeholder` is now its only
 * production caller. */
export function findNavGroupLabel({ sectionId, navGroups, copy }: { sectionId: string; navGroups: readonly { label?: string; items: readonly AdminNavItem[] }[]; copy: Pick<Parameters<typeof ComingSoonNotice>[0]["copy"], "defaultGroupLabel"> }, _options: Record<string, never> = {}): string {
  for (const group of navGroups) {
    if (group.items.some((entry) => entry.id === sectionId)) return group.label ?? copy.defaultGroupLabel;
  }
  return copy.defaultGroupLabel;
}

/**
 * The actual "not built yet" body markup — this repo's one idiom for an announced-but-unbuilt
 * section (see the file header). Split out from `Placeholder` for a caller with no `nav.ts` id to
 * look up; that caller, `PlaceholderTabs`, was deleted 2026-09-21 as dead code.
 */
export function ComingSoonNotice(props: {
  copy: {
    fallbackLocale: string;
    defaultGroupLabel: string;
    unknownSectionPrefix: (required: { locale: string }) => string;
    unknownSectionLabel: string;
    comingSoonDescription: (required: { locale: string; label: string }) => string;
    comingSoonLabel: (required: { label: string }) => string;
  };
  kicker: string;
  label: string;
  locale?: string;
  note?: string;
  /** Publishes this notice as an agent-observable status region via `agentHandle()`
   *  (`@jini-ai/agentic`) — there is no control here to click, only a fact to read (`page.read_page`
   *  et al). Omit to leave it untagged; every existing render then stays byte-identical. */
  agentHandle?: string;
}) {
  const locale = props.locale ?? props.copy.fallbackLocale;
  return (
    <div
      className="page"
      {...(props.agentHandle
        ? agentHandle({ handle: props.agentHandle }, { role: "status", label: props.copy.comingSoonLabel({ label: props.label }) })
        : {})}
    >
      <div className="page-header">
        <div className="page-header-text">
          <p className="page-kicker">{props.kicker}</p>
          <h1 className="page-title">{props.label}</h1>
          <p className="page-description">{props.copy.comingSoonDescription({ locale, label: props.label })}</p>
          {/* Optional second line for a section whose label alone could be mistaken for a
              DIFFERENT, already-shipped screen (`admin-appearance`, 2026-08-10: "Appearance" sits
              in the same Studio group as `id: "themes"`, itself labelled "Themes" but also
              rendering as an `Appearance` component under the hood — see `panels.tsx`'s own
              comment on that collision). Every other `soon` caller omits `note` and renders
              exactly as before; this does not become a second "coming soon" shape, just an
              optional extra sentence in the one that already exists. Untranslated, same disclosed
              precedent as `PostEditor.tsx`'s template picker (2026-08-10): this repo's 19-locale
              dictionaries are out of scope for a one-line disambiguation note. */}
          {props.note ? <p className="page-description">{props.note}</p> : null}
        </div>
      </div>
    </div>
  );
}

export function Placeholder({
  useAdminLocaleHook, ...props }: {
  sectionId: string;
  navGroups: readonly { label?: string; items: readonly AdminNavItem[] }[];
  translateNavLabel: (required: { locale: string; key: string }) => string;
  copy: Parameters<typeof ComingSoonNotice>[0]["copy"];
  note?: string;
  /** Passed straight through to {@link ComingSoonNotice}, or applied to this component's own
   *  "Unknown section" notice when `sectionId` matches nothing in `getNav()`. Omit to leave either
   *  branch untagged. */
  agentHandle?: string;
  /** The host's locale hook, required: every renderer (the route registry, App's unknown-section
   *  branch) passes the one host binding, so there is no default to drift from it. */
  useAdminLocaleHook: UseAdminLocaleHook;
}) {
  const locale = useAdminLocaleHook({}, {});
  const item = findNavItem({ sectionId: props.sectionId, navGroups: props.navGroups });
  if (!item) {
    const unknownSectionPrefix = props.copy.unknownSectionPrefix({ locale });
    return (
      <div
        className="notice error"
        {...(props.agentHandle ? agentHandle({ handle: props.agentHandle }, { role: "status", label: props.copy.unknownSectionLabel }) : {})}
      >
        {unknownSectionPrefix}: {props.sectionId}
      </div>
    );
  }

  return (
    <ComingSoonNotice
      copy={props.copy}
      kicker={props.translateNavLabel({ locale, key: findNavGroupLabel({ sectionId: props.sectionId, navGroups: props.navGroups, copy: props.copy }) })}
      label={props.translateNavLabel({ locale: locale, key: item.label })}
      locale={locale}
      {...(props.note !== undefined ? { note: props.note } : {})}
      {...(props.agentHandle !== undefined ? { agentHandle: props.agentHandle } : {})}
    />
  );
}
