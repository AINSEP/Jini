import type { IconName } from '../../react/components/Icon.js';
import type { ProgressStatus } from './types.js';

/** Icon for the card's own overall status. `pending`/`running` share an icon
 *  (both read as "in progress, not yet resolved") — matches both source
 *  cards, which never visually distinguished a queued/not-yet-started state
 *  from an actively-running one. */
export function progressCardStatusIcon({ status }: { status: ProgressStatus }, _optional: Record<string, never> = {}): IconName {
  if (status === 'failed') return 'help-circle';
  if (status === 'succeeded') return 'check';
  return 'sparkles';
}

/** Icon for one step/secondary-item row. Both sources only ever show an icon
 *  for a succeeded row (a checkmark); other statuses rely on the `is-{status}`
 *  class for styling. */
export function progressCardItemIcon({ status }: { status: ProgressStatus }, _optional: Record<string, never> = {}): IconName | null {
  return status === 'succeeded' ? 'check' : null;
}

const STATUS_LABELS: Record<ProgressStatus, string> = {
  pending: 'Queued',
  running: 'Running',
  succeeded: 'Complete',
  failed: 'Needs attention',
};

export function progressCardStatusLabel(status: ProgressStatus): string {
  return STATUS_LABELS[status];
}

/** Neutral fallback title used when a host doesn't supply one. Deliberately
 *  generic — the source cards' actual default copy is branded product voice,
 *  not part of the generic component (see `archived UI provenance ledger`). */
export function defaultProgressCardTitle({ status }: { status: ProgressStatus }, _optional: Record<string, never> = {}): string {
  return progressCardStatusLabel(status);
}

/** Neutral fallback detail line used when a host doesn't supply one. */
const DEFAULT_DETAILS: Record<ProgressStatus, string> = {
  pending: 'Waiting to start.',
  running: 'In progress.',
  succeeded: 'Completed.',
  failed: 'Needs attention.',
};

export function defaultProgressCardDetail(status: ProgressStatus): string {
  return DEFAULT_DETAILS[status];
}

export function clampProgressPercent({ value }: { value: number }, _optional: Record<string, never> = {}): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** CSS width percentage for the progress bar fill, or `null` for an
 *  indeterminate bar (which is styled via the `is-indeterminate` class
 *  instead of an inline width). */
export function progressBarWidthPercent({ progress }: { progress: number | 'indeterminate' }, _optional: Record<string, never> = {}): number | null {
  if (progress === 'indeterminate') return null;
  return clampProgressPercent({ value: progress });
}

/** `aria-valuenow` for the progressbar role, or `undefined` for indeterminate
 *  (per WAI-ARIA, an indeterminate progressbar omits `aria-valuenow`). */
export function progressBarAriaValueNow({ progress }: { progress: number | 'indeterminate' }, _optional: Record<string, never> = {}): number | undefined {
  if (progress === 'indeterminate') return undefined;
  return clampProgressPercent({ value: progress });
}
