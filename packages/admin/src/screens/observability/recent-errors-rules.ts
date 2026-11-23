import type { ServerLogEntry } from "@jini-ai/core/contracts/site/platform-server-logs";

/**
 * @file Pure shaping for the Recent errors tab: one-line summaries, grouping of repeated errors,
 * shortened file paths for display, and the paste-ready text the Copy button puts on the
 * clipboard. No React, no I/O — `use-recent-server-errors.hooks.ts` calls these once per load.
 *
 * Redaction: every `message` reaching this file was already secret-redacted on write by the
 * server's log buffer (the host's server-log capture, `redactSecretShapes`).
 * Nothing here un-redacts or re-reads anything, so the copied text carries exactly the same
 * `[REDACTED:…]` markers the screen shows. No second client-side pass: `@jini-ai/core`'s
 * `redactSecrets` also masks IPv4 addresses, which would turn the most useful part of an error
 * like "daemon unreachable at 127.0.0.1:51384" into a marker.
 */

/** A leading `[assistant]`-style tag the server prefixes some lines with. */
const SCOPE_PREFIX = /^\[([^\]\n]{1,40})\]\s*/;
/** A V8 stack frame line (`    at fn (file:1:2)`). */
const STACK_FRAME = /^\s*at\s/;
/** One character of a thrown error's class name (`TypeError`, `HTTP$Exception`). */
const ERROR_NAME_CHAR = /[\w$]/;
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;
/** Summaries longer than this are cut — they become the toggle button's accessible name. */
export const SUMMARY_MAX_LENGTH = 200;

/**
 * An absolute POSIX path (optionally `file://`), with an optional `:line:col` suffix. The
 * lookbehind keeps it from matching the path part of an `http://host:port/path` URL.
 */
const ABSOLUTE_PATH = /(?<![\w.:/])(?:file:\/\/)?\/(?:[\w.@+-]+\/)+[\w.@+-]+(?::\d+(?::\d+)?)?/g;
/** Folders a repo-relative path starts at; `node_modules` matches its LAST occurrence. */
const REPO_ANCHORS = ["/apps/", "/packages/"] as const;
const HOME_PREFIX = /^\/(?:Users|home)\/[^/]+\//;

export interface ErrorSummary {
  /** The leading `[tag]`, without brackets, or `null`. */
  scope: string | null;
  /** One line: the first line (minus its tag), plus the thrown error's text when it adds any. */
  summary: string;
}

/**
 * One-line summary of a log message, e.g.
 * `"[assistant] agent daemon unreachable at http://127.0.0.1:51384\nTypeError: fetch failed\n    at …"`
 * → `{ scope: "assistant", summary: "agent daemon unreachable at http://127.0.0.1:51384 — fetch failed" }`.
 * @complexity O(n) in the message length.
 */
export function summarizeErrorMessage({ message }: { message: string }): ErrorSummary {
  const lines = message.split(/\r?\n/);
  const firstEntry = [...lines.entries()].find(([, line]) => line.trim() !== "");
  if (firstEntry === undefined) return { scope: null, summary: "" };

  const [firstIndex, firstLine] = firstEntry;
  const first = firstLine.trim();
  const scopeMatch = SCOPE_PREFIX.exec(first);
  const headline = scopeMatch ? first.slice(scopeMatch[0].length) : first;
  const cause = findThrownErrorText({ lines: lines.slice(firstIndex + 1) });
  const joined = joinHeadlineAndCause({ headline: headline, cause: cause });
  // A line that is ONLY a tag ("[assistant]") with no error text after it keeps the tag visible.
  // `SCOPE_PREFIX`'s one capture group is mandatory, so a match always carries `[1]`; the `?? null` only maps "no match".
  return { scope: scopeMatch?.[1] ?? null, summary: truncate({ text: joined || first }) };
}

/** The first `XError: text` line before the stack frames begin, or `null`. */
/** The headline, then its thrown cause when that adds something; the cause alone when there is no headline. */
function joinHeadlineAndCause({ headline, cause }: { headline: string; cause: string | null }, _optional = {}): string {
  if (!cause || headline.includes(cause)) return headline;
  return headline ? `${headline} — ${cause}` : cause;
}

/** Where a thrown error's name ends when one starts at `at`: a capitalized identifier ending in
 *  `Error`/`Exception`, or `Caused by`. -1 otherwise. */
function errorNameEnd({ line, at }: { line: string; at: number }, _optional = {}): number {
  let end = at;
  while (end < line.length && ERROR_NAME_CHAR.test(line.charAt(end))) end += 1;
  const name = line.slice(at, end);
  if (/^[A-Z]/.test(name) && (name.endsWith("Error") || name.endsWith("Exception"))) return end;
  return line.startsWith("Caused by", at) ? at + "Caused by".length : -1;
}

/** The message after the colon, trimmed; it must not span lines. An all-whitespace remainder
 *  yields its last same-line character, as the lazy `(.+?)` capture this replaces did. */
function messageAfterColon({ afterColon }: { afterColon: string }, _optional = {}): string | null {
  const text = afterColon.trim();
  if (text !== "") return LINE_TERMINATOR.test(text) ? null : text;
  for (let i = afterColon.length - 1; i >= 0; i -= 1) {
    if (!LINE_TERMINATOR.test(afterColon.charAt(i))) return afterColon.charAt(i);
  }
  return null;
}

/** A thrown error's own line (`TypeError: fetch failed`, `Caused by: …`) → its message text.
 *  Same capture as `/^\s*(?:(?:[A-Z][\w$]*)?(?:Error|Exception)|Caused by)\s*:\s*(.+?)\s*$/`,
 *  in one linear pass. */
function thrownErrorText({ line }: { line: string }, _optional = {}): string | null {
  const nameEnd = errorNameEnd({ line: line, at: line.length - line.trimStart().length });
  if (nameEnd === -1) return null;
  const rest = line.slice(nameEnd).trimStart();
  return rest.startsWith(":") ? messageAfterColon({ afterColon: rest.slice(1) }) : null;
}

function findThrownErrorText({ lines }: { lines: string[] }, _optional = {}): string | null {
  for (const line of lines) {
    if (STACK_FRAME.test(line)) return null;
    const text = thrownErrorText({ line: line });
    if (text !== null) return text;
  }
  return null;
}

function truncate({ text }: { text: string }, _optional = {}): string {
  return text.length > SUMMARY_MAX_LENGTH ? `${text.slice(0, SUMMARY_MAX_LENGTH - 1)}…` : text;
}

/**
 * Shortens an absolute path for display: from the last `node_modules/`, else from the first
 * `apps/` or `packages/` folder (the repo root is not known to the browser), else `~/` for a
 * home directory. Anything else is returned unchanged. A `:line:col` suffix is kept.
 * @example shortenSourcePath({ path: "/Users/me/my-site/apps/server/src/a.ts:2:4" }) // "apps/server/src/a.ts:2:4"
 */
export function shortenSourcePath({ path }: { path: string }): string {
  const bare = path.startsWith("file://") ? path.slice("file://".length) : path;
  const nodeModules = bare.lastIndexOf("/node_modules/");
  if (nodeModules !== -1) return bare.slice(nodeModules + 1);
  for (const anchor of REPO_ANCHORS) {
    const index = bare.indexOf(anchor);
    if (index !== -1) return bare.slice(index + 1);
  }
  return bare.replace(HOME_PREFIX, "~/");
}

/** A run of message text; `fullPath` is set when `text` is a shortened file path. */
export interface ErrorMessageSegment {
  text: string;
  fullPath?: string;
}

/**
 * Splits a message into plain runs and shortened paths, so the panel can show the short form
 * with the full path in a `title`. Paths that do not shorten stay part of the plain text.
 * @complexity O(n) in the message length.
 */
export function segmentErrorPaths({ message }: { message: string }): ErrorMessageSegment[] {
  const segments: ErrorMessageSegment[] = [];
  let plain = "";
  let cursor = 0;
  for (const match of message.matchAll(ABSOLUTE_PATH)) {
    const fullPath = match[0];
    const short = shortenSourcePath({ path: fullPath });
    plain += message.slice(cursor, match.index);
    cursor = match.index + fullPath.length;
    if (short === fullPath) {
      plain += fullPath;
      continue;
    }
    if (plain) segments.push({ text: plain });
    segments.push({ text: short, fullPath });
    plain = "";
  }
  plain += message.slice(cursor);
  if (plain) segments.push({ text: plain });
  return segments;
}

/** An ISO-8601 timestamp, e.g. `2026-10-09T01:04:17.785Z`. */
const ISO_DATE = String.raw`\d{4}-\d{2}-\d{2}`;
const ISO_TIME = String.raw`\d{2}:\d{2}:\d{2}(?:\.\d+)?`;
const ISO_OFFSET = String.raw`(?:Z|[+-]\d{2}:?\d{2})?`;
const ISO_TIMESTAMP = new RegExp(String.raw`\b${ISO_DATE}T${ISO_TIME}${ISO_OFFSET}\b`, "g");
/**
 * A labeled per-request id (`requestId: 'abc'`, `"request_id":"abc"`, `traceId=abc`): the label is
 * kept, the value dropped. The `:`/`=` is required so prose ("request id was missing") is untouched.
 */
const LABELED_REQUEST_ID = /\b((?:request|req|trace|correlation)[-_ ]?id\b["']?\s*[:=]\s*["']?)[\w.-]+/gi;

/**
 * The part of a message that identifies WHICH error it is, for grouping: stack-frame lines are
 * dropped (the same failure reached from two call sites — e.g. `proxyPassthrough` and
 * `respondWithEnrichedAgentList` both hitting "agent daemon unreachable" — differs only there),
 * as are timestamps and labeled request/trace ids. Everything else is kept verbatim: the tag,
 * the headline, ports, paths outside stack frames, and the `[cause]` block (`code: 'ECONNREFUSED'`).
 * @complexity O(n) in the message length.
 */
export function normalizeErrorMessage({ message }: { message: string }): string {
  return message
    .split(/\r?\n/)
    .filter((line) => !STACK_FRAME.test(line))
    .map((line) => line.replace(ISO_TIMESTAMP, "<time>").replace(LABELED_REQUEST_ID, "$1<id>").trimEnd())
    .join("\n");
}

/** One distinct error (same source and normalized message) and how often it appeared in the window. */
export interface RecentErrorGroup {
  /** Stable across reloads: the same error keeps the same key, so an open row stays open. */
  key: string;
  latest: ServerLogEntry;
  earliest: ServerLogEntry;
  count: number;
}

/**
 * Groups the same error (same `source` and `normalizeErrorMessage` text — the `[tag]` is part of
 * that text), newest occurrence first. Grouping by the raw message split one visible error into
 * several rows whenever only its stack frames differed. Anything else that differs — a port, a
 * path in the headline, an error code — stays separate: merging "similar" errors could hide a
 * different failure behind a count. `latest` keeps the newest occurrence's full message for Copy.
 * @param required `entries` oldest first, as the server returns them.
 * @complexity O(n) time and space.
 */
export function groupErrorEntries({ entries }: { entries: readonly ServerLogEntry[] }): RecentErrorGroup[] {
  const groups = new Map<string, RecentErrorGroup>();
  for (const entry of [...entries].reverse()) {
    const key = `${entry.source}\u0000${normalizeErrorMessage({ message: entry.message })}`;
    const existing = groups.get(key);
    if (existing) {
      existing.earliest = entry;
      existing.count += 1;
    } else {
      groups.set(key, { key, latest: entry, earliest: entry, count: 1 });
    }
  }
  return [...groups.values()];
}

/**
 * The paste-ready block the Copy button puts on the clipboard: ISO time, source, how often, and
 * the FULL message with unshortened paths (the reader of a paste needs the real paths).
 * Deliberately English and not localized: it is a log record for pasting into a chat or issue,
 * like the server's own log text, not on-screen copy.
 */
export function formatErrorCopyText({ group }: { group: RecentErrorGroup }): string {
  const { latest, earliest, count } = group;
  const lines = [`Time: ${latest.at}`, `Source: ${latest.source}`];
  if (count > 1) lines.push(`Occurrences: ${count} (first ${earliest.at}, last ${latest.at})`);
  lines.push("Message:", latest.message);
  return lines.join("\n");
}
