// Dumb card for one extraction-history record: phase pill, title/meta, an
// optional failure explanation, the written-entry chips, and a delete action.
// Shared by the saved-memory list and the connected-apps scan history. Pure
// formatting comes from the slice formatters; state lives in the hooks.
import { Icon } from '../../../../react/components/Icon.js';
import { useT } from '../../../i18n/index.js';
import {
  describeExtractionFailure,
  describeRecord,
  extractionCardMeta,
  extractionCardTitle,
} from '../../formatters.js';
import type { MemoryExtractionRecord } from '../../types.js';

export function MemoryExtractionCard({
  record,
  nowClock,
  onOpenPreview,
  onDelete,
}: {
  record: MemoryExtractionRecord;
  /** Wall clock so relative ages ("12s ago") re-render without freezing. */
  nowClock: number;
  onOpenPreview: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const t = useT();
  const desc = describeRecord(record, t);
  const title = extractionCardTitle(record, t);
  const meta = extractionCardMeta(record, nowClock, t);
  // `describeExtractionFailure` already gates on phase/error (returns null when
  // the record didn't fail), so we render off its result directly instead of
  // duplicating that guard here.
  const failure = describeExtractionFailure(record);
  return (
    <div className={`library-card memory-extraction-card is-${desc.tone}`}>
      <div className="library-card-info">
        <div className="library-card-title-row">
          <span className="library-card-name">{title}</span>
          <span className={`memory-extraction-pill is-${desc.tone}`}>{desc.phaseLabel}</span>
          <span className="library-card-badge">{desc.kindLabel}</span>
        </div>
        <div className="library-card-desc">{meta}</div>
        {desc.reasonLabel ? <div className="memory-extraction-reason">{desc.reasonLabel}</div> : null}
        {failure ? (
          <div className="memory-extraction-failure">
            <strong>{failure.title}</strong>
            <span>{failure.detail}</span>
            <span>{failure.action}</span>
          </div>
        ) : null}
        {Array.isArray(record.writtenIds) && record.writtenIds.length > 0 ? (
          <div className="memory-extraction-counts">
            <span>{t('saved')}</span>
            <span className="memory-extraction-ids">
              {record.writtenIds.map((id: string) => (
                <button key={id} type="button" className="filter-pill" onClick={() => onOpenPreview(id)} title={id}>
                  {id}
                </button>
              ))}
            </span>
          </div>
        ) : null}
      </div>
      <div className="memory-card-actions">
        <button
          type="button"
          className="ghost library-card-action"
          onClick={() => onDelete(record.id)}
          title={t('Remove')}
          aria-label={t('Remove')}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
    </div>
  );
}
