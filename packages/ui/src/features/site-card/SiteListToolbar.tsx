import type { SiteListFilter, SiteListSort } from "./site-list-view.js";
import type { SiteListController } from "./use-site-list-view.hooks.js";

/** Every word on the toolbar, supplied by the host so it can translate them. */
export interface SiteListToolbarCopy {
  views: string;
  pinnedRecent: string;
  /** With its count, e.g. "All sites (12)". */
  all: string;
  /** With its count, e.g. "Hidden (2)". */
  hidden: string;
  sortBy: string;
  recent: string;
  oldest: string;
  name: string;
}

type ToolbarController = Pick<SiteListController<unknown>, "filter" | "setFilter" | "sort" | "setSort" | "hiddenCount">;

/** View chips and the "Sort by" dropdown. "Hidden" appears only once something is hidden. @complexity O(1). */
export function SiteListToolbar({ list, copy }: { list: ToolbarController; copy: SiteListToolbarCopy }) {
  const views: readonly { id: SiteListFilter; label: string }[] = [
    { id: "pinned-recent", label: copy.pinnedRecent },
    { id: "all", label: copy.all },
    ...(list.hiddenCount > 0 ? [{ id: "hidden" as const, label: copy.hidden }] : []),
  ];
  return (
    <div className="jini-site-list-toolbar">
      <div className="jini-site-list-toolbar__views" role="group" aria-label={copy.views}>
        {views.map((view) => (
          <button key={view.id} type="button" className="jini-site-list-toolbar__view" aria-pressed={list.filter === view.id} onClick={() => list.setFilter(view.id)}>
            {view.label}
          </button>
        ))}
      </div>
      <label className="jini-site-list-toolbar__sort">
        {copy.sortBy}
        <select value={list.sort} onChange={(event) => list.setSort(event.target.value as SiteListSort)}>
          <option value="recent">{copy.recent}</option>
          <option value="oldest">{copy.oldest}</option>
          <option value="name">{copy.name}</option>
        </select>
      </label>
    </div>
  );
}

/** The pin on a card. Stops its events, since a card can itself be a click target. @complexity O(1). */
export function SiteCardPin({ pinned, label, onToggle }: { pinned: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="jini-site-card__pin"
      aria-pressed={pinned}
      aria-label={label}
      title={label}
      onClick={(event) => { event.stopPropagation(); onToggle(); }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <svg viewBox="0 0 24 24" fill={pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
        <path d="M9 3.5h6l-.8 7 3.3 3.5h-11l3.3-3.5zM12 14v6.5" />
      </svg>
    </button>
  );
}
