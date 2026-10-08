/**
 * ResourceBoard and ResourceRowList share status badges/vocabulary and ordered grouping rules,
 * but compose separate surfaces: a grid/kanban board versus rows with inline actions and nested
 * lazy history. A combined shell would impose unused grouping or history on the other shape.
 */

// --- Shared status vocabulary -------------------------------------------

/** Host-supplied status and label. Board and row/run vocabularies can differ; reconciling them
 * with protocol RunState is a separate decision, not implicit in this display primitive. */
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
 * `body` is a host-supplied render slot; content-kind-specific thumbnail resolution is host-owned.
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

/** Entry in an expandable run-history list. Action kinds are host-owned; the primitive does
 * not implement a product's automation-evolution workflow. */
export interface ResourceRunHistoryItem {
  id: string;
  status: string;
  startedAtLabel: string;
  durationLabel?: string;
  message?: string;
  isError?: boolean;
  actions?: ResourceRowAction[];
}
