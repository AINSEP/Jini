import type { AdminFormField, AdminFormSubmission } from "./models.js";

export interface FormAnswerColumn {
  key: string;
  header: string;
  cell: (submission: AdminFormSubmission) => string;
}

/** Persisted descriptors, including those derived from HTML, are the submission table's columns. */
export function formAnswerColumns({ fields }: { fields: readonly AdminFormField[] }, _optional = {}): FormAnswerColumn[] {
  return fields.map((field) => ({
    key: `answer:${field.id}`,
    header: field.label,
    cell: (submission) => submission.data[field.id] === undefined ? "" : String(submission.data[field.id]),
  }));
}

/** Detail rows reuse the table's persisted field labels, including HTML-derived descriptors.
 * Removed fields retain their answers with a plain fallback instead of exposing their IDs.
 * @complexity O(c + a) time and space for c columns and a submitted answers; no I/O.
 */
export function formSubmissionRows(
  { data, answerColumns }: { data: AdminFormSubmission['data']; answerColumns: readonly FormAnswerColumn[] },
  { unknownFieldLabel = "Unknown field" }: { unknownFieldLabel?: string } = {},
): Array<{ key: string; label: string; value: string }> {
  const labels = new Map(answerColumns.map(column => [column.key, column.header]));
  return Object.entries(data).map(([key, value]) => ({
    key, label: labels.get(`answer:${key}`)?.trim() || unknownFieldLabel, value: String(value),
  }));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

/** Editable form BODY only: the server supplies the transport and spam-protection wrapper. */
export function formHtmlStarter(
  { fields }: { fields: readonly AdminFormField[] },
  { submitLabel = "Send" }: { submitLabel?: string } = {},
): string {
  return fields.map((field) => {
    const attrs = `name="${escapeHtml(field.id)}"${field.required ? " required" : ""}${field.maxLength != null ? ` maxlength="${field.maxLength}"` : ""}`;
    const control = field.type === "textarea" ? `<textarea ${attrs}></textarea>` : `<input type="${field.type}" ${attrs}>`;
    return `<label>${escapeHtml(field.label)}\n  ${control}\n</label>`;
  }).join("\n\n") + `\n\n<button type="submit">${escapeHtml(submitLabel)}</button>`;
}

export function formHtmlEmbed({ slug }: { slug: string }, _optional = {}): string {
  const config = JSON.stringify({ type: "form", id: slug, mode: "html" }).replace(/'/g, "&#39;");
  return `<div data-embed-config='${config}'></div>`;
}
