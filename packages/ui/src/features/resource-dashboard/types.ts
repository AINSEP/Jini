/**
 * Generic status-badged resource-dashboard primitives.
 *
 * Provenance: `foundry/docs/jini-port/god-components-extraction-plan.md`'s "5 more
 * overlaps" section flagged "Resource-dashboard shell, twice, both directly
 * Run-vocabulary-relevant": `DesignsTab.tsx` (sub-tab sort + search +
 * select-mode/bulk-delete + per-item kebab menu + a grid/kanban view toggle
 * over a config-driven status-kanban board) and `TasksView.tsx` (hero header
 * with metric tiles + a flat row-list with inline per-item action buttons +
 * a lazy-loaded expandable per-row run-history sublist). Both were read in
 * full from `/tmp/od-source` (see `packages/ui/source-map.md`'s
 * `features/resource-dashboard/` section for the full shared-vs-separate
 * verdict and quoted structural evidence).
 *
 * Verdict: genuinely TWO distinct composition shapes, not one. The only
 * piece that is actually identical between the two origins is "a status
 * value renders as a small badge" plus "group a list of status-bearing
 * items into ordered buckets" — DesignsTab uses that grouping to build a
 * whole-page kanban board; TasksView never groups by status at all (its
 * only status usage is a per-row/per-run `StatusPill`, one level deeper
 * than DesignsTab's top-level items). So this feature ships ONE shared
 * status vocabulary + `StatusPill` + `groupItemsByStatus` rule, consumed by
 * TWO separately composed components: `ResourceBoard` (the DesignsTab
 * shape) and `ResourceRowList` (the TasksView shape). Neither is generic
 * over the other; forcing them through one composed shell would mean
 * bolting kanban-grouping onto a shape that never uses it, or bolting
 * expandable nested history onto a shape that never had it.
 */

// --- Shared status vocabulary -------------------------------------------

/**
 * A host-supplied status value + its display label. Never a hardcoded
 * vocabulary: DesignsTab's own 6-value kanban vocabulary
 * (`not_started`/`running`/`awaiting_input`/`succeeded`/`failed`/`canceled`)
 * and TasksView's own 5-value run vocabulary
 * (`succeeded`/`failed`/`running`/`queued`/`canceled`) are two different,
 * non-identical instantiations of this same shape — see
 * `packages/ui/source-map.md` for the note on reconciling either against
 * `@jini-ai/protocol`'s own `RunState` later (explicitly out of scope here).
 */
export interface ResourceStatusOption {
  value: string;
  label: string;
}

export type ResourceStatusTone = 'neutral' | 'active' | 'success' | 'error';

/** Host-supplied status -> visual tone mapping, so `StatusPill` never guesses a tone from a hardcoded status-name comparison. Status values absent from the map render with the `neutral` tone. */
export type ResourceStatusToneMap = Record<string, ResourceStatusTone>;

// --- ResourceBoard (DesignsTab shape) -----------------------------------

export type ResourceBoardViewMode = 'grid' | 'kanban';

/** A sub-tab-pill sort option (DesignsTab's `recent`/`yours`). Deliberately not a status *filter* — the origin's own sub-tabs only ever re-sort the same item set, never hide items (`STATUS_ORDER`'s own kanban grouping is a separate, orthogonal concern). */
export interface ResourceSortOption {
  value: string;
  label: string;
}

/** One kebab-menu entry (DesignsTab's rename/duplicate/delete). `kind` is an opaque host-defined string dispatched back via `onItemAction` — this primitive never hardcodes which actions exist. */
export interface ResourceMenuActionSpec {
  kind: string;
  label: string;
  danger?: boolean;
}

/**
 * One dashboard item. `title`/`subtitle`/`status` drive the generic chrome
 * (card head, status badge, kanban-column placement); `menuActions` drives
 * the per-item kebab menu. `sortValues`, keyed by a `ResourceSortOption`'s
 * `value`, lets a host supply whatever numeric ordering key each sort
 * option needs (DesignsTab's `recent` sorts by `updatedAt`, `yours` by
 * `createdAt` — two different fields on the same origin `Project` type) —
 * this primitive never assumes a single fixed timestamp field.
 * `body` is a host-supplied render slot for anything else (DesignsTab's
 * cover-thumbnail resolution across html/image/video/logo/brand kinds stays
 * entirely host-owned, never ported into this generic primitive — see
 * source-map.md's "Dropped" list).
 */
export interface ResourceBoardItem<TBody = unknown> {
  id: string;
  title: string;
  subtitle?: string;
  status?: string;
  menuActions?: ResourceMenuActionSpec[];
  sortValues?: Record<string, number>;
  body?: TBody;
}

// --- ResourceRowList (TasksView shape) ----------------------------------

/** One hero metric tile (TasksView's active/paused/template-count tiles). */
export interface ResourceMetric {
  key: string;
  label: string;
  value: number;
}

/** One inline row action button (TasksView's run/edit/pause-resume/delete — always visible, never a kebab menu). `kind` is dispatched back via `onRowAction`, opaque to this primitive. */
export interface ResourceRowAction {
  kind: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
}

/**
 * One row in the flat "your automations"-shaped list. `metaLine`/
 * `detailLine` are pre-formatted host strings (schedule status - target -
 * next run, and the routine's prompt preview in the origin) rather than
 * structured fields — TasksView's own formatting
 * (`scheduleStatusLabel`/`nextRunLabel`/target-mode branching) is
 * genuinely host business logic, not something this primitive re-derives.
 * `lastRunStatus`/`lastRunLabel` back the row's own `StatusPill` +
 * "last run at ..." line; both optional since a never-run row has neither.
 */
export interface ResourceRowItem {
  id: string;
  title: string;
  metaLine?: string;
  detailLine?: string;
  lastRunStatus?: string;
  lastRunLabel?: string;
  paused?: boolean;
  actions: ResourceRowAction[];
}

/** One entry in a row's expandable run-history sublist (TasksView's `RoutineRun`, lazy-fetched on first expand). `actions` generalizes the origin's per-run "crystallize"/"view progress" buttons — see source-map.md for what was dropped (the crystallize automation-evolution workflow is OD-specific and not ported; "open" is the one generic action kept). */
export interface ResourceRunHistoryItem {
  id: string;
  status: string;
  startedAtLabel: string;
  durationLabel?: string;
  message?: string;
  isError?: boolean;
  actions?: ResourceRowAction[];
}
