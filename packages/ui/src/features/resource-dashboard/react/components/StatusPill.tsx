import { statusToneFor } from '../../rules.js';
import type { ResourceStatusToneMap } from '../../types.js';

export interface StatusPillProps {
  status: string;
  /** Already-translated display label — callers wrap the raw status in `t()` at the call site, per this package's i18n policy (pure `rules.ts` stays hook-free). */
  label: string;
  toneMap?: ResourceStatusToneMap;
}

/**
 * A small status badge. The single genuinely shared UI primitive between
 * DesignsTab's `design-card-status design-card-status-${status}` kanban
 * card badge and TasksView's `StatusPill` (`automation-status is-${status}`)
 * — both origins render "a status value as a small colored label," just at
 * different nesting depths (DesignsTab: top-level item; TasksView: a run
 * nested inside a row). See `archived UI source map` for the full
 * shared-vs-separate verdict this component is the "shared" half of.
 */
export function StatusPill({ status, label, toneMap }: StatusPillProps) {
  const tone = statusToneFor(status, toneMap);
  return (
    <span className={`resource-status-pill is-${status} tone-${tone}`} data-testid="resource-status-pill">
      {label}
    </span>
  );
}
