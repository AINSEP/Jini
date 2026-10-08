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
