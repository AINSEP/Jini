import { ConfirmDialog } from '../../../react/components/ConfirmDialog/ConfirmDialog.js';
import { agentHandle } from '@jini-ai/agentic';
import { useWiredFormSubmissionDetail } from '../hooks/use-form-submission-detail.hooks.js';
import { useFormSubmissionDate } from '../hooks/use-form-submission-date.hooks.js';
import { FormSubmissionDate } from "./FormSubmissionDate.js";
export interface FormSubmissionDetailProps {
  formId: string;
  submissionId: string;
  onBack: () => void;
  onDeleted: () => void;
  /** Dependency injection seam for tests — see `PostsProps.usePostsHook` for the convention. */
  useFormSubmissionDetailHook?: typeof useWiredFormSubmissionDetail;
  /** Translator closure — see `FormEditor()`'s own `t`. */
  t: (key: string) => string;
}

export function FormSubmissionDetail({
  formId,
  submissionId,
  onBack,
  onDeleted,
  useFormSubmissionDetailHook = useWiredFormSubmissionDetail,
  t,
}: FormSubmissionDetailProps, _optional: Record<string, never> = {}) {
  const formatDate = useFormSubmissionDate({});
  const { submission, error, confirmOpen, deleting, requestDelete, cancelDelete, confirmDelete } = useFormSubmissionDetailHook({
    formId,
    submissionId,
    onDeleted,
  });

  if (error && !submission) return <div className="notice error">{error}</div>;
  if (!submission) return <div className="notice">{t("Loading submission…")}</div>;

  return (
    // `form-submission-detail` (`styles/forms.css`) — the back button, table, and Delete button
    // were flush siblings with no gap between them (owner: "pad the buttons"), so the back
    // button sat right on top of the table and Delete sat right underneath it. Same
    // flex-column-plus-gap idiom `.field-group` already uses elsewhere for vertical rhythm,
    // rather than one-off margins on each button.
    <div className="form-submission-detail">
      <button
        type="button"
        className="btn-secondary"
        onClick={onBack}
        aria-label={t("Back to submissions")}
        {...agentHandle({ handle: "form-submission-back" }, { role: "link", label: "Back to this form's list of submissions" })}
      >
        &larr; {t("Back")}
      </button>
      {error ? <div className="notice error">{error}</div> : null}
      <div className="table-scroll">
        <table className="list-table">
          <tbody>
            <tr>
              <th>{t("Submitted at")}</th>
              <td><FormSubmissionDate date={formatDate({ iso: submission.submittedAt })} /></td>
            </tr>
            <tr>
              <th>{t("Source IP")}</th>
              <td>{submission.sourceIp}</td>
            </tr>
            {Object.entries(submission.data).map(([key, value]) => (
              <tr key={key}>
                <th>{key}</th>
                <td>{String(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="btn-danger"
        disabled={deleting}
        onClick={requestDelete}
        {...agentHandle({ handle: "form-submission-delete" }, {
          role: "button",
          label: "Move this submission to the trash. Opens a confirmation dialog first.",
        })}
      >
        {t("Delete submission")}
      </button>
      <ConfirmDialog
        open={confirmOpen}
        agentHandle="form-submission-delete-confirm"
        title={t("Move to trash?")}
        body={<p>{t("It will disappear from this list. You can restore it from the Trash.")}</p>}
        confirmLabel={t("Move to trash")}
        destructive
        pending={deleting}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </div>
  );
}

