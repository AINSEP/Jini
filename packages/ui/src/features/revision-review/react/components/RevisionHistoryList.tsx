import { useT } from '../../../i18n/index.js';
import { formatRevisionTimestamp } from '../../rules.js';
import type { RevisionReviewItem } from '../../types.js';

export interface RevisionHistoryListProps<TMeta = unknown> {
  revisions: RevisionReviewItem<TMeta>[];
}

/** A status-badged history list of past proposed changes (accepted/rejected/pending), newest entries in whatever order the host passes them. */
export function RevisionHistoryList<TMeta = unknown>({ revisions, useTHook = useT }: RevisionHistoryListProps<TMeta> & { useTHook?: typeof useT }) {
  const t = useTHook();
  return (
    <section className="jini-revision-history-list">
      <h2>{t('Revision history')}</h2>
      {revisions.map((revision) => (
        <div key={revision.id} className="jini-revision-history-list__row">
          <span className={`jini-revision-history-list__status is-${revision.status}`}>{t(revision.status)}</span>
          <strong>{revision.sectionTitle ?? t('General revision')}</strong>
          <small>{formatRevisionTimestamp(revision.updatedAt)}</small>
        </div>
      ))}
    </section>
  );
}
