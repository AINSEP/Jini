/**
 * @module pointer
 *
 * Detects an assistant reply that is *only* a pointer to an existing file
 * ("see design.html") rather than new content, so a host can resolve it to
 * that file instead of treating the short reply as a fresh artifact.
 */
interface HtmlPointerArtifactTargetInput {
  content: string;
  candidateFileName: string;
  projectFiles: Array<{ name: string; path?: string }>;
}

const MAX_POINTER_TEXT_BYTES = 100;
const POINTER_TARGET_RE = /^(?:见|see)(?:\s*[:：]\s*|\s+)[`"'“”‘’]?(.+?\.html?)[`"'“”‘’]?[.。]?$/iu;
const SCRIPT_OR_STYLE_RE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
const HTML_TAG_RE = /<[^>]+>/g;

/**
 * Resolve a short "see foo.html"-style reply to the referenced file name, if
 * `content` is (after stripping tags) nothing but such a pointer and the
 * target unambiguously resolves against `projectFiles`.
 *
 * @returns The resolved target file path/name, or `null` when `content`
 *   isn't a bare pointer, the target is unsafe, or it doesn't resolve to
 *   exactly one known file.
 * @complexity O(n + m) in `content.length` plus `projectFiles.length`.
 */
export function resolveHtmlPointerArtifactTarget(input: HtmlPointerArtifactTargetInput): string | null {
  const pointerText = visiblePointerText(input.content);
  if (!pointerText || utf8ByteLength(pointerText) > MAX_POINTER_TEXT_BYTES) {
    return null;
  }

  const match = POINTER_TARGET_RE.exec(pointerText);
  if (!match) return null;

  // The target group is a mandatory (non-optional) part of the pattern, not
  // inside an alternation, so it's always defined when `match` is non-null;
  // the assertion just satisfies `noUncheckedIndexedAccess`.
  const target = normalizeTarget(match[1]!);
  if (!target || target === input.candidateFileName || !isSafeHtmlTarget(target)) {
    return null;
  }

  const projectFileNames = input.projectFiles.map((file) => file.path || file.name).filter((name) => name.toLowerCase().endsWith('.html') || name.toLowerCase().endsWith('.htm'));

  if (projectFileNames.includes(target)) return target;

  const basenameMatches = projectFileNames.filter((name) => basename(name) === target);
  const [basenameMatch] = basenameMatches;
  if (basenameMatches.length === 1 && basenameMatch && basenameMatch !== input.candidateFileName) {
    return basenameMatch;
  }

  return null;
}

function visiblePointerText(content: string): string {
  const stripped = content
    .replace(/^﻿/, '')
    .replace(SCRIPT_OR_STYLE_RE, ' ')
    .replace(HTML_TAG_RE, ' ');
  return decodeBasicHtmlEntities(stripped).replace(/\s+/g, ' ').trim();
}

function normalizeTarget(value: string): string {
  return value.trim().replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, '');
}

function isSafeHtmlTarget(value: string): boolean {
  if (!/\.(?:html?|HTML?)$/.test(value)) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  if (value.startsWith('/') || value.includes('\\') || value.includes('\0')) return false;
  return value.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

function basename(value: string): string {
  const i = value.lastIndexOf('/');
  return i >= 0 ? value.slice(i + 1) : value;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
