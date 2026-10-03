import type { IconName } from '../../react/components/Icon.js';
import type { ProgressStatus } from './types.js';

/** Icon for the card's own overall status. `pending`/`running` share an icon
 *  (both read as "in progress, not yet resolved") — matches both source
 *  cards, which never visually distinguished a queued/not-yet-started state
 *  from an actively-running one. */
export function progressCardStatusIcon(status: ProgressStatus): IconName {
  if (status === 'failed') return 'help-circle';
  if (status === 'succeeded') return 'check';
  return 'sparkles';
}

/** Icon for one step/secondary-item row. Both sources only ever show an icon
 *  for a succeeded row (a checkmark); other statuses rely on the `is-{status}`
 *  class for styling. */
export function progressCardItemIcon(status: ProgressStatus): IconName | null {
  return status === 'succeeded' ? 'check' : null;
}

export function progressCardStatusLabel(status: ProgressStatus): string {
  switch (status) {
    case 'pending':
      return 'Queued';
    case 'running':
      return 'Running';
    case 'succeeded':
      return 'Complete';
    case 'failed':
      return 'Needs attention';
  }
}

/** Neutral fallback title used when a host doesn't supply one. Deliberately
 *  generic — the source cards' actual default copy is branded product voice,
 *  not part of the generic component (see `packages/ui/archived provenance ledger`). */
export function defaultProgressCardTitle(status: ProgressStatus): string {
  return progressCardStatusLabel(status);
}

/** Neutral fallback detail line used when a host doesn't supply one. */
export function defaultProgressCardDetail(status: ProgressStatus): string {
  switch (status) {
    case 'pending':
      return 'Waiting to start.';
    case 'running':
      return 'In progress.';
    case 'succeeded':
      return 'Completed.';
    case 'failed':
      return 'Needs attention.';
  }
}

export function clampProgressPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** CSS width percentage for the progress bar fill, or `null` for an
 *  indeterminate bar (which is styled via the `is-indeterminate` class
 *  instead of an inline width). */
export function progressBarWidthPercent(progress: number | 'indeterminate'): number | null {
  if (progress === 'indeterminate') return null;
  return clampProgressPercent(progress);
}

/** `aria-valuenow` for the progressbar role, or `undefined` for indeterminate
 *  (per WAI-ARIA, an indeterminate progressbar omits `aria-valuenow`). */
export function progressBarAriaValueNow(progress: number | 'indeterminate'): number | undefined {
  if (progress === 'indeterminate') return undefined;
  return clampProgressPercent(progress);
}
