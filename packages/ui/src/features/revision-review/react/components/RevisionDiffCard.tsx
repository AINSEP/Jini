import { useT } from '../../../i18n/index.js';
import { diffAddedLines, formatRevisionTimestamp } from '../../rules.js';
import type { RevisionReviewItem } from '../../types.js';

export interface RevisionDiffCardProps<TMeta = unknown> {
  revision: RevisionReviewItem<TMeta>;
  saving?: boolean;
  onAccept: () => void;
  onReject: () => void;
}

/**
 * A generic "proposed change" review card: feedback, a diff/proposed-body
 * preview, an optional per-file draft preview, and accept/reject actions.
 *
 * Origin: `RevisionDiffCard` (`DesignSystemFlow.tsx`). Only
 * `DesignSystemRevision` was OD-shaped; genericized here via
 * `RevisionReviewItem<TMeta>` (see `types.ts`) — the review-widget shape
 * itself (feedback + diff preview + file previews + accept/reject) has no
 * OD coupling beyond that type.
 */
export function RevisionDiffCard<TMeta = unknown>({ revision, saving = false, onAccept, onReject, useTHook = useT }: RevisionDiffCardProps<TMeta> & { useTHook?: typeof useT }) {
  const t = useTHook();
  const diff = diffAddedLines(revision.baseBody, revision.proposedBody);
  return (
    <section className="jini-revision-diff-card">
      <div className="jini-revision-diff-card__head">
        <span>
          <strong>{t('Pending revision')}</strong>
          <small>
            {revision.sectionTitle ? `${revision.sectionTitle} · ` : ''}
            {formatRevisionTimestamp(revision.createdAt)}
          </small>
        </span>
        <div>
          <button type="button" className="ghost danger" disabled={saving} onClick={onReject}>
            {t('Reject')}
          </button>
          <button type="button" className="ghost success" disabled={saving} onClick={onAccept}>
            {t('Accept')}
          </button>
        </div>
      </div>
      <p>{revision.feedback}</p>
      <div className="jini-revision-diff-card__diff">
        <span>{t('Proposed changes')}</span>
        <pre>{diff || revision.proposedBody}</pre>
      </div>
      {revision.fileChanges?.length ? (
        <div className="jini-revision-diff-card__diff">
          <span>{t('File draft preview')}</span>
          {revision.fileChanges.map((change) => (
            <pre key={change.path}>{`${change.path}\n\n${diffAddedLines(change.baseContent, change.proposedContent) || change.proposedContent}`}</pre>
          ))}
        </div>
      ) : null}
    </section>
  );
}
