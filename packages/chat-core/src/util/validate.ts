/**
 * @module validate
 *
 * Pre-write structural sniff for AI-emitted HTML artifacts.
 *
 * Defends an HTML-artifact persistence path against the failure mode where a
 * model emits an `<artifact type="text/html">…</artifact>` block whose body
 * is a prose summary instead of a complete document. Without this gate, such
 * content can land on disk as a real `.html` file and pollute a file panel
 * as a phantom artifact tab.
 *
 * Policy (intentionally narrow — false positives here block real saves):
 * - non-empty after trimming BOM and leading whitespace
 * - meets a minimum length threshold
 * - the *first* non-whitespace token is `<!doctype html>` or `<html`
 *   (anchored at the start; mid-string mentions of these tags do NOT count —
 *   prose like "Updated the <html lang> attribute…" must be rejected)
 * - URL-bearing attributes or CSS `url(...)` / `@import` values do not point
 *   at a reserved internal workspace-storage path
 *
 * What this gate is NOT:
 * - It is **not** an HTML linter or validator. Malformed but
 *   recognizably document-shaped HTML passes; only content that obviously
 *   isn't a document fails. The guarantee is "blocks obvious prose-as-HTML",
 *   not "validates well-formed HTML."
 * - It does **not** cover `.jsx`/`.tsx` or any other artifact kind — a caller
 *   should only invoke this for an HTML-typed artifact.
 * - It does **not** apply to user-driven file saves through some other path;
 *   those may legitimately persist partial drafts.
 *
 * Threshold note: 64 chars rejects minimal empty-body documents like
 * `<!doctype html><html><body></body></html>` (49 chars) — AI-emitted
 * artifacts are expected to be non-trivial deliverables, not test fixtures,
 * so the lower bound favors fewer phantom files over preserving
 * fixture-grade empties.
 */

const MIN_HTML_LENGTH = 64;
const STARTS_WITH_DOCUMENT_RE = /^(?:<!doctype\s+html\b|<html\b)/i;
/** Path segments reserved for internal workspace/artifact storage that a saved document must never reference. */
const RESERVED_WORKSPACE_PATH_RE = /(?:^|\/|\.\/)(?:\.live-artifacts|\.workspace|\.tmp)(?=$|[/?#"'`\s>)])/i;
const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const URL_ATTRIBUTE_RE = /\b(href|src|srcset|poster|action|formaction|data|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/gi;
const STYLE_ATTRIBUTE_RE = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/gi;
const HTML_TAG_RE = /<[a-z][^>]*>/gi;
const STYLE_BLOCK_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const CSS_URL_RE = /\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;
const CSS_IMPORT_RE = /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)|"([^"]*)"|'([^']*)')/gi;

export type HtmlArtifactValidationResult = { ok: true } | { ok: false; reason: string };

/**
 * Sniff-test whether `content` looks like a complete HTML document rather
 * than prose that happens to mention HTML.
 *
 * @complexity O(n) in `content.length` — a handful of linear regex scans.
 */
export function validateHtmlArtifact(content: string): HtmlArtifactValidationResult {
  const trimmed = content.replace(/^﻿/, '').trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'empty content' };
  }
  if (trimmed.length < MIN_HTML_LENGTH) {
    return { ok: false, reason: `content too short to be HTML (got ${trimmed.length} chars, need ≥${MIN_HTML_LENGTH})` };
  }
  if (!STARTS_WITH_DOCUMENT_RE.test(trimmed)) {
    return { ok: false, reason: 'content does not start with <!doctype html> or <html — looks like prose, not a complete HTML document' };
  }
  if (referencesReservedWorkspacePath(trimmed)) {
    return { ok: false, reason: 'content references a reserved internal workspace-storage path' };
  }
  return { ok: true };
}

function referencesReservedWorkspacePath(content: string): boolean {
  return hasReservedWorkspacePathInTags(content) || hasReservedWorkspacePathInStyleBlocks(content);
}

function hasReservedWorkspacePathInTags(content: string): boolean {
  HTML_TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HTML_TAG_RE.exec(content)) !== null) {
    // A successful regex-exec result's whole-match slot (`match[0]`) is never
    // undefined; the assertion just satisfies `noUncheckedIndexedAccess`.
    const tag = match[0]!;
    if (hasReservedWorkspacePathAttribute(tag) || hasReservedWorkspacePathInStyleAttributes(tag)) {
      return true;
    }
  }
  return false;
}

function hasReservedWorkspacePathAttribute(tag: string): boolean {
  URL_ATTRIBUTE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_ATTRIBUTE_RE.exec(tag)) !== null) {
    const attributeName = match[1]?.toLowerCase();
    // Exactly one of the three quote-form alternatives (groups 2/3/4)
    // participates in any successful match, so this is always defined; the
    // cast just satisfies `noUncheckedIndexedAccess`.
    const candidate = (match[2] ?? match[3] ?? match[4]) as string;
    if (candidateReferencesReservedWorkspacePath(candidate, attributeName === 'srcset')) {
      return true;
    }
  }
  return false;
}

function hasReservedWorkspacePathInStyleAttributes(tag: string): boolean {
  STYLE_ATTRIBUTE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = STYLE_ATTRIBUTE_RE.exec(tag)) !== null) {
    // Exactly one of the three quote-form alternatives (groups 1/2/3)
    // participates in any successful match, so this is always defined; the
    // cast just satisfies `noUncheckedIndexedAccess`.
    const cssText = (match[1] ?? match[2] ?? match[3]) as string;
    if (cssTextReferencesReservedWorkspacePath(cssText)) {
      return true;
    }
  }
  return false;
}

function hasReservedWorkspacePathInStyleBlocks(content: string): boolean {
  STYLE_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = STYLE_BLOCK_RE.exec(content)) !== null) {
    // The style-block body group uses a lazy `*?` quantifier (matches even an
    // empty body), so it always participates in a successful match; the
    // assertion just satisfies `noUncheckedIndexedAccess`.
    const cssText = match[1]!;
    if (cssTextReferencesReservedWorkspacePath(cssText)) {
      return true;
    }
  }
  return false;
}

function cssTextReferencesReservedWorkspacePath(cssText: string): boolean {
  for (const pattern of [CSS_URL_RE, CSS_IMPORT_RE]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(cssText)) !== null) {
      // Both CSS_URL_RE and CSS_IMPORT_RE are single top-level alternations
      // across all their capture groups, so exactly one group is ever defined
      // on a successful match — `.find` always finds it; the assertion just
      // satisfies `noUncheckedIndexedAccess`.
      const candidate = match.slice(1).find((value) => value !== undefined)!;
      if (candidateReferencesReservedWorkspacePath(candidate, false)) {
        return true;
      }
    }
  }
  return false;
}

function candidateReferencesReservedWorkspacePath(candidate: string, splitCandidates: boolean): boolean {
  const paths = splitCandidates ? srcsetCandidateUrls(candidate) : [firstUrlToken(candidate)];
  return paths.some((path) => {
    if (!isLocalPathLike(path)) {
      return false;
    }
    return RESERVED_WORKSPACE_PATH_RE.test(pathnameOnly(path));
  });
}

function pathnameOnly(path: string): string {
  const separator = path.search(/[?#]/);
  if (separator === -1) {
    return path;
  }
  return path.slice(0, separator);
}

function srcsetCandidateUrls(srcset: string): string[] {
  const candidates: string[] = [];
  let start = 0;
  let sawCandidate = false;
  let dataUrlCandidate = false;
  let sawWhitespaceAfterUrl = false;

  for (let index = 0; index < srcset.length; index += 1) {
    const char = srcset[index]!;
    if (!sawCandidate) {
      if (char === ',' || /\s/.test(char)) {
        start = index + 1;
        continue;
      }
      sawCandidate = true;
      dataUrlCandidate = /^data:/i.test(srcset.slice(index));
    }
    if (/\s/.test(char)) {
      sawWhitespaceAfterUrl = true;
      continue;
    }
    if (char === ',' && (!dataUrlCandidate || sawWhitespaceAfterUrl)) {
      candidates.push(srcset.slice(start, index));
      start = index + 1;
      sawCandidate = false;
      dataUrlCandidate = false;
      sawWhitespaceAfterUrl = false;
    }
  }

  candidates.push(srcset.slice(start));
  return candidates.map(firstUrlToken).filter(Boolean);
}

function firstUrlToken(value: string): string {
  // `String.split()` on a regex separator always returns at least one
  // element (even `''.split(/\s+/)` is `['']`), so `[0]` is never
  // `undefined` here — the assertion only satisfies `noUncheckedIndexedAccess`.
  return value.trim().split(/\s+/)[0]!;
}

function isLocalPathLike(path: string): boolean {
  return path.length > 0 && !path.startsWith('#') && !path.startsWith('//') && !URL_SCHEME_RE.test(path);
}
