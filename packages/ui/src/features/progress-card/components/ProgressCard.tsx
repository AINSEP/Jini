import { useT } from '../../i18n/index.js';
import type { ProgressCardData, ProgressCardItem } from '../types.js';
import {
  defaultProgressCardDetail,
  defaultProgressCardTitle,
  progressBarAriaValueNow,
  progressBarWidthPercent,
  progressCardItemIcon,
  progressCardStatusIcon,
} from '../rules.js';
import { Icon } from '../../../react/components/Icon.js';

export interface ProgressCardProps {
  data: ProgressCardData;
  /** Caps how many `steps` render before the rest are truncated. Matches
   *  the source `WorkspaceActivityCard`'s todo-list cap. */
  maxSteps?: number;
  /** Caps how many `secondaryItems` render. Matches the source's
   *  files-touched cap. */
  maxSecondaryItems?: number;
}

/**
 * Generic "run/job in progress" card — a status icon + headline, a progress
 * bar (determinate or indeterminate), a primary step list, and an optional
 * secondary item list. Unifies the source `WorkspaceActivityCard` and
 * `GenerationStatusCard` occurrences; see `packages/ui/source-map.md` for
 * provenance and what was dropped.
 */
export function ProgressCard({ data, maxSteps = 6, maxSecondaryItems = 5 }: ProgressCardProps) {
  const t = useT();
  const title = data.title ?? t(defaultProgressCardTitle(data.status));
  const detail = data.detail ?? t(defaultProgressCardDetail(data.status));
  const secondaryHeading = t(data.secondaryItemsLabel ?? 'Files touched');
  const visibleSteps = data.steps.slice(0, maxSteps);
  const visibleSecondaryItems = (data.secondaryItems ?? []).slice(0, maxSecondaryItems);

  return (
    <section className={`progress-card is-${data.status}`} data-progress-card-id={data.id}>
      <div className="progress-card-head">
        <Icon name={progressCardStatusIcon(data.status)} />
        <span>
          <strong>{title}</strong>
          <small>{detail}</small>
        </span>
      </div>
      <ProgressCardBar progress={data.progress} label={t('{title} progress', { title })} />
      {visibleSteps.length > 0 ? <ProgressCardItemList items={visibleSteps} className="progress-card-steps" /> : null}
      {visibleSecondaryItems.length > 0 ? (
        <div className="progress-card-secondary-items">
          <span>{secondaryHeading}</span>
          <ProgressCardItemList items={visibleSecondaryItems} className="progress-card-secondary-item-list" asCode />
        </div>
      ) : null}
    </section>
  );
}

/** Presents the existing progress rules as a determinate or indeterminate accessible bar. */
function ProgressCardBar({ progress, label }: { progress: ProgressCardData['progress']; label: string }) {
  const widthPercent = progressBarWidthPercent(progress);
  const ariaValueNow = progressBarAriaValueNow(progress);
  return (
    <div
      className={`progress-card-bar${widthPercent === null ? ' is-indeterminate' : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={ariaValueNow}
    >
      <span style={widthPercent === null ? undefined : { width: `${widthPercent}%` }} />
    </div>
  );
}

function ProgressCardItemList({
  items,
  className,
  asCode,
}: {
  items: ProgressCardItem[];
  className: string;
  asCode?: boolean;
}) {
  const Tag = asCode ? 'code' : 'span';
  return (
    <div className={className}>
      {items.map((item) => {
        const icon = progressCardItemIcon(item.status);
        return (
          <Tag key={item.id} className={`is-${item.status}`}>
            {icon ? <Icon name={icon} /> : null}
            {item.label}
          </Tag>
        );
      })}
    </div>
  );
}
