/**
 * Generic "a run/job in progress" domain shape — a progress bar + status icon
 * + step list, the pattern independently reimplemented twice against two
 * different source shapes. See `packages/ui/archived provenance ledger` for provenance.
 * Deliberately maps close to Jini's own Run/Agent/Tool vocabulary rather than
 * either source's own naming.
 */

export type ProgressStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface ProgressCardItem {
  id: string;
  label: string;
  status: ProgressStatus;
}

export interface ProgressCardData {
  id: string;
  status: ProgressStatus;
  /** Headline text. Computing status/kind-specific copy is a host concern
   *  (it's product vocabulary, not part of the generic shape) — omit to fall
   *  back to a neutral status label. */
  title?: string;
  /** Supporting detail line, e.g. the latest status event or job message. */
  detail?: string;
  /** 0-100, or 'indeterminate' for a run/job with no known total. Neither
   *  source occurrence this pattern was unified from ever produces
   *  'indeterminate' (both always compute a percentage) — it's included as a
   *  forward-looking capability for Jini's own Run/Agent/Tool dashboards. */
  progress: number | 'indeterminate';
  /** The primary step/todo checklist. */
  steps: ProgressCardItem[];
  /** An optional secondary list, e.g. "files touched" by an agent run. */
  secondaryItems?: ProgressCardItem[];
  /** Heading for `secondaryItems`, e.g. "Files touched". */
  secondaryItemsLabel?: string;
}
