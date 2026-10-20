import { useSubmissionsView } from "../hooks/forms-view.hooks.js";
import type { FormAnswerColumn } from '../../html-rules.js';
import { useWiredFormSubmissions } from '../hooks/use-form-submissions.hooks.js';
import { useFormSubmissionDate } from '../hooks/use-form-submission-date.hooks.js';
import { FormSubmissionDetail } from "./FormSubmissionDetail.js";
import { FormSubmissionsTable } from "./FormSubmissionsTable.js";
export interface FormSubmissionsProps {
  formId: string;
  /** Dependency injection seam for tests — see `PostsProps.usePostsHook` for the convention. */
  useFormSubmissionsHook?: typeof useWiredFormSubmissions;
  /** Translator closure — see `FormEditor()`'s own `t`. */
  t: (key: string) => string;
  answerColumns?: FormAnswerColumn[];
}

export function FormSubmissions({ formId, useFormSubmissionsHook = useWiredFormSubmissions, t, answerColumns = [] }: FormSubmissionsProps, _optional: Record<string, never> = {}) {
  const formatDate = useFormSubmissionDate({});
  const controller = useFormSubmissionsHook({ formId });
  const { submissions, nextCursor, error, selectedId, loadingMore } = controller;
  const { rows, back, loadMore } = useSubmissionsView({ controller });

  if (selectedId) {
    return (
      <FormSubmissionDetail
        formId={formId}
        submissionId={selectedId}
        onBack={back}
        onDeleted={back}
        t={t}
        answerColumns={answerColumns}
      />
    );
  }

  if (error && !submissions) return <div className="notice error">{error}</div>;
  if (!submissions) return <div className="notice">{t("Loading submissions…")}</div>;
  if (submissions.length === 0) return <div className="empty-state">{t("No submissions yet.")}</div>;

  // Submission ids are stable and unique, so they're what disambiguates one row's "View" button
  // from another's — same reasoning as every other list on this workstream. Not `useMemo`d:
  // computed after the three early returns above, so a `useMemo` here would need hoisting above
  // them to keep hook order stable across renders — same constraint `Media.tsx` documents for its
  // own post-early-return computation. `submissions` grows only on an explicit "Load more" click
  // (`use-form-submissions.hooks.ts`'s cursor-append), so this O(n) pass tracks real data changes,
  // not incidental re-renders.

  return (
    <FormSubmissionsTable rows={rows} loadMore={loadMore} error={error} nextCursor={nextCursor} loadingMore={loadingMore}
      formatDate={formatDate} answerColumns={answerColumns} t={t} />
  );
}
