/** Built-in member auth templates. Secrets are filled only for the interactive send payload. */

/** The slice of the host's mail renderer this module calls: static HTML plus field values in, a sendable message out.
 * Injected as `required.renderEmailForSend`, so this module never imports its owner. */
export type RenderEmailForSend = (input: { html: string; values: Record<string, string> }) => {
  subject: string; html: string; text: string;
};

const TEMPLATES = {
  "members.sign_in": `<!doctype html><html><head><title>Your sign-in link and code</title></head><body>
<p>Sign in using this link (expires in 15 minutes): <a href="{{link}}">{{link}}</a></p>
<p>Or enter this one-time code: {{code}}</p></body></html>`,
  "members.password_reset": `<!doctype html><html><head><title>Reset your password</title></head><body>
<p>Reset your password (expires in 15 minutes): <a href="{{link}}">{{link}}</a></p>
<p>If you did not request this, ignore this email.</p></body></html>`,
} as const;

/**
 * Render static HTML and text with the existing escaping/sanitization owner; no persistence.
 * Reset templates have no code field. Errors from the renderer propagate.
 * @complexity O(n) in the fixed template and supplied link length.
 */
export function renderMemberAuthMail(required: {
  purpose: "signin" | "password_reset"; link: string; code?: string; renderEmailForSend: RenderEmailForSend;
}, _options: Record<string, never> = {}): { subject: string; html: string; text: string } {
  const { purpose, link, code = "", renderEmailForSend } = required;
  const html = TEMPLATES[purpose === "signin" ? "members.sign_in" : "members.password_reset"];
  const rendered = renderEmailForSend({ html, values: { link, code } });
  return { subject: rendered.subject, html: rendered.html, text: rendered.text };
}
