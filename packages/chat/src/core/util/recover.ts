/**
 * @module recover
 *
 * Recovery helpers for HTML artifacts a model emitted outside the
 * `<artifact>` protocol — as prose next to a complete `<html>` document, as
 * a standalone document reply, or as a single fenced ```html block.
 */
import { validateHtmlArtifact } from './validate.js';

type RecoverHtmlArtifactInput = {
  artifactHtml: string;
  identifier?: string | undefined;
  sourceText?: string | undefined;
};

const HTML_OPEN_RE = /<html\b/gi;
const HTML_CLOSE_RE = /<\/html\s*>/gi;
const ADJACENT_DOCTYPE_RE = /<!doctype\s+html\b[^>]*>\s*$/i;
const HTML_FENCE_RE = /```(?:html|HTML)\s*\n([\s\S]*?)\n```/g;

function findLastArtifactOpen(sourceText: string, identifier?: string): number {
  if (!identifier) return sourceText.lastIndexOf('<artifact');

  const escapedIdentifier = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const taggedOpenRe = new RegExp(`<artifact\\b(?=[^>]*\\bidentifier\\s*=\\s*(?:"${escapedIdentifier}"|'${escapedIdentifier}'))[^>]*>`, 'gi');
  let last = -1;
  let match: RegExpExecArray | null;
  while ((match = taggedOpenRe.exec(sourceText)) !== null) {
    last = match.index;
  }
  return last !== -1 ? last : sourceText.lastIndexOf('<artifact');
}

function lastIndexOfRegex(re: RegExp, text: string): number {
  re.lastIndex = 0;
  let last = -1;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    last = match.index;
  }
  return last;
}

/**
 * When an `<artifact>` body fails {@link validateHtmlArtifact} (looks like
 * prose, not a document) but a complete `<html>…</html>` document
 * immediately precedes the artifact tag in the same turn's `sourceText`,
 * recover that preceding document as the real artifact content.
 *
 * @returns The recovered HTML, or `null` when the artifact body already
 *   validates, or no adjacent recoverable document is found.
 * @complexity O(n) in `sourceText.length`.
 */
export function recoverHtmlArtifactFromPrecedingDocument({ artifactHtml, identifier, sourceText }: RecoverHtmlArtifactInput): string | null {
  if (!sourceText) return null;
  if (validateHtmlArtifact(artifactHtml).ok) return null;

  const artifactOpen = findLastArtifactOpen(sourceText, identifier);
  if (artifactOpen === -1) return null;

  const beforeArtifact = sourceText.slice(0, artifactOpen);
  if (!/<\/html\s*>\s*$/i.test(beforeArtifact)) return null;

  const htmlOpenStart = lastIndexOfRegex(HTML_OPEN_RE, beforeArtifact);
  if (htmlOpenStart === -1) return null;

  // The guard above (`beforeArtifact` ends with `</html\s*>` plus only
  // trailing whitespace) already pins HTML_CLOSE_RE's last match to that exact
  // trailing tag: `htmlClose` can't be -1, can't fall before `htmlOpenStart`
  // (no room for another `<html` open after it), and the slice from `htmlClose`
  // always re-matches `/^<\/html\s*>/i` — the assertion just satisfies
  // `String.prototype.match`'s generically-nullable return type.
  const htmlClose = lastIndexOfRegex(HTML_CLOSE_RE, beforeArtifact);
  const closeMatch = beforeArtifact.slice(htmlClose).match(/^<\/html\s*>/i)!;

  const beforeHtmlOpen = beforeArtifact.slice(0, htmlOpenStart);
  const adjacentDoctype = beforeHtmlOpen.match(ADJACENT_DOCTYPE_RE);
  const htmlStart = adjacentDoctype ? htmlOpenStart - adjacentDoctype[0].length : htmlOpenStart;

  const candidate = beforeArtifact.slice(htmlStart, htmlClose + closeMatch[0].length).trim();
  return validateHtmlArtifact(candidate).ok ? candidate : null;
}

/**
 * Resolve the HTML that should actually be persisted for an artifact. When
 * a model emits a prose-only `<artifact>` next to a complete `<html>`
 * document in the same turn, recover the real document from the preceding
 * text; otherwise keep the artifact body as-is.
 *
 * A same-turn duplicate-content lookup and the actual persist path MUST
 * resolve this identically — feeding a dedup check the raw prose summary
 * while persisting the recovered document would make an exact-match dedup
 * miss the same-turn write, causing the recovered document to persist twice.
 */
export function resolvePersistedArtifactHtml(input: RecoverHtmlArtifactInput): string {
  return recoverHtmlArtifactFromPrecedingDocument(input) ?? input.artifactHtml;
}

/** Recover a complete `<html>…</html>` document that IS the entire (trimmed) `sourceText`, or `null` otherwise. */
export function recoverStandaloneHtmlDocument(sourceText: string | null | undefined): string | null {
  const candidate = String(sourceText || '').replace(/^﻿/, '').trim();
  if (!/<\/html\s*>$/i.test(candidate)) return null;
  return validateHtmlArtifact(candidate).ok ? candidate : null;
}

/**
 * Recover a complete HTML document from a *single* ```html fenced block in
 * `sourceText`. Returns `null` when there is no such fence, more than one
 * candidate, or the recovered text doesn't validate as a document — multiple
 * candidates are ambiguous about which one is "the" artifact, so none is
 * chosen automatically.
 */
export function recoverHtmlDocumentFromMarkdownFence(sourceText: string | null | undefined): string | null {
  const text = String(sourceText || '');
  HTML_FENCE_RE.lastIndex = 0;
  let recovered: string | null = null;
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = HTML_FENCE_RE.exec(text)) !== null) {
    const candidate = (match[1] || '').replace(/^﻿/, '').trim();
    if (!/<\/html\s*>$/i.test(candidate)) continue;
    if (!validateHtmlArtifact(candidate).ok) continue;
    recovered = candidate;
    count += 1;
  }
  return count === 1 ? recovered : null;
}
