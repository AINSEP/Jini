import { SECRET_SHAPE_PATTERNS } from "@jini-ai/core";
import { pathContains } from "@jini-ai/core/primitives";
import { posix, win32 } from "node:path";

const SENSITIVE_KEY_RE = /token|password|secret|key|dsn|authorization|cookie/i;

const URL_QUERY_SECRET_RE = /([?&#])(token|password|secret|key|dsn|api[_-]?key|auth|access_token|refresh_token|id_token)(=)([^&\s#"']*)/gi;

// Catch loose key=value pairs in log lines that aren't inside a URL — e.g. env
// dumps, command-line args, or json-line meta. The leading boundary stops it
// from matching mid-identifier (e.g. `not_a_token`). Order alternatives long-
// first so `access_token` wins over `token`.
const BARE_SECRET_RE = /(^|[\s,;])(access_token|refresh_token|id_token|api[_-]?key|password|secret|token|auth(?:orization)?)(=|:\s*)([^\s,;"']+)/gi;

// Bearer / Token / Basic auth schemes embed the secret after the scheme
// keyword, so the BARE pattern above stops at the space before `Bearer` and
// leaves the actual credential exposed. This pattern matches the scheme +
// credential as one unit. Case-insensitive: HTTP auth schemes are
// case-insensitive per RFC 7235 §2.1, and we routinely see lowercase
// `authorization: bearer …` in proxy / curl-style logs.
// Character class covers RFC 6750 token68 (ALPHA / DIGIT / "-" / "." / "_"
// / "~" / "+" / "/" / "=") plus ":" for Basic credentials. Missing "~"
// previously left tokens like `Bearer abcd~efgh` partially exposed.
// Case-insensitive, so the class needs only one letter case.
const HTTP_AUTH_SCHEME_RE = /\b(Bearer|Token|Basic)\s+([a-z0-9._~\-+/=:]{4,})/gi;

const REDACTED = "[REDACTED]";

export interface RedactionOptions {
  username?: string | undefined;
}

function redactJsonObject(
  { value }: { value: object },
  opts: RedactionOptions = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_RE.test(key) && typeof raw === "string" && raw.length > 0) {
      out[key] = REDACTED;
    } else {
      out[key] = redactJsonValue({ value: raw }, opts);
    }
  }
  return out;
}

/** Returns a redacted copy; the required input value is separate from optional path policy. */
export function redactJsonValue({ value }: { value: unknown }, opts: RedactionOptions = {}): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactJsonValue({ value: entry }, opts));
  if (value !== null && typeof value === "object") {
    return redactJsonObject({ value }, opts);
  }
  if (typeof value === "string") return redactText({ text: value }, opts);
  return value;
}

/** Redacts credentials while optional username policy masks that user's home paths. */
export function redactText({ text }: { text: string }, opts: RedactionOptions = {}): string {
  // Run the HTTP auth scheme replacement first so the credential after
  // `Bearer` / `Token` / `Basic` is captured before BARE_SECRET_RE swallows
  // the `Authorization: Bearer` prefix and stops at the space.
  let out = text.replace(HTTP_AUTH_SCHEME_RE, (_match, scheme) => `${scheme} ${REDACTED}`);
  out = out.replace(URL_QUERY_SECRET_RE, (_match, sep, name, eq) => `${sep}${name}${eq}${REDACTED}`);
  out = out.replace(BARE_SECRET_RE, (_match, lead, name, sep) => `${lead}${name}${sep}${REDACTED}`);
  // Bundle redaction shares only the credential catalog; diagnostic IDs and paths must remain
  // readable, so the kernel's general-purpose redaction policy is deliberately not invoked.
  for (const { pattern } of SECRET_SHAPE_PATTERNS) {
    // `String.replace` needs a global pattern to replace every match; strip-then-append keeps a
    // pattern that is already global valid (a duplicated `g` flag would throw).
    out = out.replace(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`), REDACTED);
  }
  const username = opts.username;
  if (username && username.length > 1) {
    const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`/Users/${escaped}(?=[/"\\s])`, "g"), "/Users/<USER>");
    out = out.replace(new RegExp(`\\\\Users\\\\${escaped}(?=[\\\\"\\s])`, "g"), "\\Users\\<USER>");
    out = out.replace(new RegExp(`/home/${escaped}(?=[/"\\s])`, "g"), "/home/<USER>");
  }
  return out;
}

/** Redacts valid JSON recursively and falls back to text redaction for invalid JSON. */
export function redactJsonText({ text }: { text: string }, opts: RedactionOptions = {}): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return redactText({ text }, opts);
  }
  return JSON.stringify(redactJsonValue({ value: parsed }, opts), null, 2);
}

// Delimited stack/quoted paths may contain spaces. Other paths end at whitespace or punctuation.
// Each alternative consumes one path in a forward scan; no nested repetitions or wildcard retries.
// `<`/`>` stay inside a plain path: an upstream username redaction yields `/Users/<USER>/…`, whose
// tail would otherwise escape after a masked `/Users/` prefix.
// How a local path starts: a file URL, a drive letter, a UNC prefix, a home `~`, or a root `/`.
const BACKTICK = "`";
const LOCAL_PATH_START = String.raw`(?:file:\/\/|[A-Za-z]:[\\/]|\\\\|~[\\/]|\/)`;
const DELIMITED_LOCAL_PATH = String.raw`(["'(])(${LOCAL_PATH_START}[^"'()\r\n]*)(["')])`;
const BARE_LOCAL_PATH = String.raw`(^|[\s="'(<[\]{},;${BACKTICK}])(${LOCAL_PATH_START}[^\s"'${BACKTICK}()[\]{},;]*)`;
const LOCAL_PATH_RE = new RegExp(`${DELIMITED_LOCAL_PATH}|${BARE_LOCAL_PATH}`, "g");
const QUOTED_LOCAL_PATH_RE = new RegExp(String.raw`(["'])(${LOCAL_PATH_START}[^"'\r\n]*)\1`, "g");

/** Decode local file URLs independently of the host OS; invalid URLs are always masked. O(n). */
function decodedLocalPath({ value }: { value: string }, _options = {}): string | undefined {
  // Treat ~ as a lexical root, never expand it using the current user's home directory.
  if (value.startsWith('~/')) return `/${value}`;
  // A home-relative Windows path (`~\…`, as a host's home redaction writes it) gets a UNC-shaped root.
  if (value.startsWith('~\\')) return `\\\\${value}`;
  if (!value.startsWith('file://')) return value;
  try {
    const url = new URL(value);
    const pathname = decodeURIComponent(url.pathname);
    if (url.hostname && url.hostname !== 'localhost') return `\\\\${url.hostname}${pathname.replace(/\//g, '\\')}`;
    return pathname.replace(/^\/([A-Za-z]:\/)/, '$1');
  } catch { return undefined; }
}

/** Keep only a lexically contained app-relative path; no filesystem or cwd is consulted. O(nr). */
function maskedLocalPath({ value, keepRoots }: { value: string; keepRoots: readonly string[] }, _options = {}): string {
  const coordinates = /(?::\d+){1,2}$/.exec(value)?.[0] ?? '';
  const path = decodedLocalPath({ value: value.slice(0, value.length - coordinates.length) });
  if (path === undefined) return `<path>${coordinates}`;
  return `${retainedPath({ path, keepRoots }) ?? '<path>'}${coordinates}`;
}

/** The first retained root containing `path`, as `app:///<relative>`; undefined outside all roots. O(r). */
function retainedPath({ path, keepRoots }: { path: string; keepRoots: readonly string[] }, _options = {}): string | undefined {
  const windows = /^(?:[A-Za-z]:[\\/]|\\\\)/.test(path);
  const paths = windows ? win32 : posix;
  for (const entry of keepRoots) {
    const root = decodedLocalPath({ value: entry });
    if (root === undefined || !paths.isAbsolute(root)) continue;
    if (pathContains({ root, target: path }, { separator: windows ? '\\' : '/', caseSensitive: !windows })) {
      return `app:///${paths.relative(root, path).split(paths.sep).join('/')}`;
    }
  }
  return undefined;
}

/**
 * Mask local paths in error text; explicitly retained roots expose only app-relative filenames.
 * Supports POSIX, home-relative, Windows, UNC and file URLs on every host OS. Never reads files.
 * @returns Masked text, with stack line/column suffixes preserved. Malformed file URLs are masked.
 * @complexity O(nr) time, O(n) output space for text length n and a fixed set of r retained roots.
 */
export function maskLocalPaths(
  { text }: { text: string }, { keepRoots = [] }: { keepRoots?: readonly string[] } = {},
): string {
  // Consume quoted filenames first: parentheses and spaces are legal filename characters.
  const quotedText = text.replace(QUOTED_LOCAL_PATH_RE, (_match, quote: string, value: string) =>
    `${quote}${maskedLocalPath({ value, keepRoots })}${quote}`);
  return quotedText.replace(LOCAL_PATH_RE, (_match, open: string | undefined, quoted: string | undefined, close: string, lead: string, plain: string) => {
    const masked = maskedLocalPath({ value: quoted ?? plain, keepRoots });
    return quoted === undefined ? `${lead}${masked}` : `${open}${masked}${close}`;
  });
}
