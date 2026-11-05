import { ConfirmDialog } from '../../../react/components/ConfirmDialog/ConfirmDialog.js';
import { agentHandle } from '@jini-ai/agentic';
import { useWiredFormSubmissionDetail } from '../hooks/use-form-submission-detail.hooks.js';
import { useFormSubmissionDate } from '../hooks/use-form-submission-date.hooks.js';
import { FormSubmissionDate } from "./FormSubmissionDate.js";
import { formSubmissionRows, type FormAnswerColumn } from '../../html-rules.js';
export interface FormSubmissionDetailProps {
  formId: string;
  submissionId: string;
  onBack: () => void;
  onDeleted: () => void;
  /** Dependency injection seam for tests — see `PostsProps.usePostsHook` for the convention. */
  useFormSubmissionDetailHook?: typeof useWiredFormSubmissionDetail;
  /** Translator closure — see `FormEditor()`'s own `t`. */
  t: (key: string) => string;
  answerColumns?: readonly FormAnswerColumn[];
}

export function FormSubmissionDetail({
  formId,
  submissionId,
  onBack,
  onDeleted,
  useFormSubmissionDetailHook = useWiredFormSubmissionDetail,
  t,
  answerColumns = [],
}: FormSubmissionDetailProps, _optional: Record<string, never> = {}) {
  const formatDate = useFormSubmissionDate({});
  const { submission, error, confirmOpen, deleting, requestDelete, cancelDelete, confirmDelete, fileUrl } = useFormSubmissionDetailHook({
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
      <SubmissionStatusNotices submission={submission} error={error} t={t} />
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
            {formSubmissionRows({ data: submission.data, answerColumns, evidence: submission.evidence }, { unknownFieldLabel: t("Unknown field") }).map(({ key, label, value, file }) => {
              const href = file ? fileUrl(file) : null;
              return (
                <tr key={key}>
                  <th className="jini-submission-field-label">{label}</th>
                  <td>{href && file ? <a href={href} download={file.filename} {...agentHandle({ handle: `form-submission-file-${key}` }, { role: "link", label: `Download the uploaded file ${file.filename}` })}>{value}</a> : value}</td>
                </tr>
              );
            })}
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

/** Historical context is displayed as plain text; authored HTML is never executed here. */
function SubmissionEvidenceNotice({ submission, t }: {
  submission: import('../../models.js').AdminFormSubmission; t: (key: string) => string;
}) {
  return !submission.evidence ? <div className="notice">{t("original schema/consent unavailable")}{!submission.validation ? <p>{t("validation unknown")}</p> : null}</div> : <div className="notice">
        <p>{t("Schema hash")}: <code>{submission.evidence.schemaHash}</code></p>
        {submission.evidence.consent.map(consent => <p key={consent.fieldId}>{consent.wording}{consent.helpText ? ` — ${consent.helpText}` : ""}</p>)}
      </div>;
}

function SubmissionStatusNotices({ submission, error, t }: {
  submission: import('../../models.js').AdminFormSubmission; error: string | null; t: (key: string) => string;
}) {
  return <>
      {error ? <div className="notice error">{error}</div> : null}
      {submission.notificationDelivery && submission.notificationDelivery.failed > 0 ? <div className="notice error" role="alert">
        {t("Email notification failed. The submission is saved here. Check the email provider settings before sending a new notification.")}
        <p>{t("Details: FORM_NOTIFICATION_FAILED")} ({submission.notificationDelivery.failed})</p>
      </div> : null}
      <SubmissionEvidenceNotice submission={submission} t={t} />
      {submission.validation?.status === "invalid" ? <div className="notice error" role="alert">
        <p>{t("Imported for review: this submission did not pass the form checks.")}</p>
        <ul>{submission.validation.fieldErrors.map(({ field, reason }, index) => <li key={`${field}-${index}`}>{field}: {reason}</li>)}</ul>
      </div> : null}
  </>;
}
