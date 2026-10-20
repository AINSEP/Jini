import type { FormAnswerColumn } from '../../html-rules.js';
import { DataTable } from '../../../react/components/DataTable.js';
import { agentHandle } from '@jini-ai/agentic';
import type { useSubmissionsView } from "../hooks/forms-view.hooks.js";
import type { useFormSubmissionDate } from '../hooks/use-form-submission-date.hooks.js';
import { FormSubmissionDate } from "./FormSubmissionDate.js";

/**
 * @file The loaded-list half of `FormSubmissions`: an optional error above the table, the table
 * itself, and "Load more" while a next page exists. Markup only.
 */

export interface FormSubmissionsTableProps {
  rows: ReturnType<typeof useSubmissionsView>["rows"];
  loadMore: () => void;
  error: string | null;
  nextCursor: string | null;
  loadingMore: boolean;
  formatDate: ReturnType<typeof useFormSubmissionDate>;
  answerColumns: FormAnswerColumn[];
  t: (key: string) => string;
}

export function FormSubmissionsTable(
  { rows, loadMore, error, nextCursor, loadingMore, formatDate, answerColumns, t }: FormSubmissionsTableProps,
) {
  return (
    <div>
      {error ? <div className="notice error">{error}</div> : null}
      <DataTable<(typeof rows)[number]>
        rows={rows}
        rowKey={(s) => s.id}
        columns={[
          { key: "submitted-at", header: t("Submitted at"), cell: (s) => <FormSubmissionDate date={formatDate({ iso: s.submittedAt })} /> },
          { key: "source-ip", header: t("Source IP"), cell: (s) => s.sourceIp },
          ...answerColumns,
          {
            key: "view",
            cell: (s) => (
              <button
                type="button"
                onClick={s.view}
                {...agentHandle({ handle: s.handle }, {
                  role: "button",
                  label: "Open this submission's full details",
                })}
              >
                {t("View")}
              </button>
            ),
          },
        ]}
      />
      {nextCursor ? (
        <button
          type="button"
          className="btn-secondary"
          disabled={loadingMore}
          onClick={loadMore}
          {...agentHandle({ handle: "form-submissions-load-more" }, {
            role: "button",
            label: "Load the next page of submissions",
          })}
        >
          {loadingMore ? t("Loading…") : t("Load more")}
        </button>
      ) : null}
    </div>
  );
}
