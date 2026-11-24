
/**
 * @file Points an exported site's forms at an external receiver. The host renders every form with
 * `action="/forms/<slug>/submit"`; a co-hosted receiver serves that path itself, so only an external
 * one needs the pages rewritten. The receiver key never enters HTML: it authorizes pulls, not posts.
 * Pure: each file's `data` is already in memory.
 */

const FORM_ACTION = /action="\/forms\/([A-Za-z0-9_-]+)\/submit"/g;
const HTML_ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "\"": "&quot;", "<": "&lt;", ">": "&gt;" };

/**
 * The receiver's base address: an https origin plus an optional path, with no userinfo, query or
 * fragment, and no trailing slash. Throws a person-facing Error otherwise.
 * @complexity O(url length).
 */
export function assertSubmitUrl({ submitUrl }: { submitUrl: string }, _optional: Record<string, never> = {}): string {
  let parsed: URL | undefined;
  try { parsed = new URL(submitUrl); } catch { parsed = undefined; }
  if (!parsed || !isPlainHttps({ parsed, raw: submitUrl })) throw new Error("the form destination returned a post address that is not a plain https URL (no user name, query or fragment). Update or reinstall the destination's plugin, then publish again");
  let end = parsed.pathname.length;
  while (end > 0 && parsed.pathname[end - 1] === "/") end -= 1;
  return `${parsed.origin}${parsed.pathname.slice(0, end)}`;
}

/** https with no userinfo, query or fragment (an empty `?` or `#` counts too). @complexity O(url length). */
function isPlainHttps({ parsed, raw }: { parsed: URL; raw: string }, _optional = {}): boolean {
  return parsed.protocol === "https:" && [parsed.username, parsed.password, parsed.search, parsed.hash].every((part) => part === "") && !/[?#]/.test(raw);
}

/** Any in-memory deploy file (structurally the host's deploy-file shape); extra fields pass through untouched. */
export interface FormActionFile {
  readonly file: string;
  readonly data: Buffer | Uint8Array | string;
}

/**
 * Rewrites only the exact host form actions in `.html` files to `${submitUrl}/forms/<slug>/submit`;
 * other actions, already-absolute actions and non-HTML files are returned unchanged.
 * @complexity O(total HTML bytes).
 */
export function rewriteFormActions<F extends FormActionFile>(required: { files: readonly F[]; submitUrl: string }, _optional: Record<string, never> = {}): F[] {
  const base = assertSubmitUrl({ submitUrl: required.submitUrl }).replace(/[&"<>]/g, (char) => {
    const escaped = HTML_ESCAPES[char];
    if (escaped === undefined) throw new Error(`Form destination has no HTML escape for ${char}`);
    return escaped;
  });
  return required.files.map((file) => {
    if (!file.file.toLowerCase().endsWith(".html")) return file;
    const text = typeof file.data === "string" ? file.data : file.data.toString("utf8");
    const rewritten = text.replace(FORM_ACTION, (_match, slug: string) => `action="${base}/forms/${slug}/submit"`);
    if (rewritten === text) return file;
    return { ...file, data: typeof file.data === "string" ? rewritten : Buffer.from(rewritten, "utf8") };
  });
}
