/**
 * @module persistence/title
 *
 * Derives a conversation's working title from its first user message, synchronously and with no
 * model call.
 *
 * The point of doing this locally is latency and cost: a conversation needs a name the instant
 * it appears in a list, and for an anonymous-visitor surface a per-conversation LLM call to name
 * a chat is a real cost against a session that may be one message long. A host that wants a
 * better title asks its agent for one later and calls `rename(id, title, 'generated')`; the
 * store refuses to overwrite a `manual` title, so a user's own rename always wins.
 *
 * Ported from Open Design's `summarizeProjectNameFromPrompt` (`apps/web/src/utils/projectName.ts`).
 * The Latin path has since diverged: it keeps the prompt's words, names and dotted domains (the
 * original's stop-word removal and title casing turned "port orvellea.com to tovu" into "Port
 * Orvellea Com Tovu"), and `LEADING_LATIN_FILLER` fixes the original's article bug, documented at
 * its declaration. The CJK path keeps the original's filler and punctuation rules, which is not
 * decoration: they differ enough from the Latin ones that a shared path produced worse titles in both.
 */

const MAX_CJK_LENGTH = 18;
/**
 * Hard character ceiling, because a word cap is not a length cap.
 *
 * A word boundary says nothing about token size: a pasted base64 blob or minified bundle is a single
 * enormous token, so it must not survive intact and become the title verbatim. That title is
 * then stored, listed, and re-rendered on every conversation-list read — megabytes of it. Applied to
 * the finished title so both the Latin and CJK paths are covered.
 */
const MAX_TITLE_CHARS = 80;

const CJK_PATTERN = /[㐀-鿿]/;

/**
 * Leading politeness/imperative filler — "can you build a dashboard" is a dashboard.
 *
 * The trailing article group requires `\s+` *inside* it rather than the original's
 * `(an|a|the|…)?\s*`. That form is subtly wrong: with the whitespace outside the optional group,
 * the bare `a` alternative happily matches the first letter of the following word, so
 * "update app.tsx" became "Pp Tsx" and "build analytics" became "Nalytics". Any word starting
 * with `a` after a verb silently lost its first character. Requiring the separator as part of the
 * article makes an article an article rather than a prefix.
 */
const LEADING_LATIN_FILLER =
  /^(please\s+)?(can\s+you\s+|could\s+you\s+|help\s+me\s+|i\s+want\s+to\s+|i\s+need\s+to\s+)?(create|build|make|design|implement|add|fix|update|improve|optimize|generate|write|search|find|show|list|turn)\s+((this|that)\s+into\s+)?((an|a|the|this|that|my|me)\s+)?/i;

const LEADING_CJK_FILLER = [
  /^先?(帮我|帮忙|麻烦|请|可以|能不能|能否|给我|我想要|我要)/,
  /^(先)?(实现|做|做一下|创建|生成|设计|开发|新增|添加|优化|修复|改|更改|调整)(一下|一个|一版|下)?/,
  /^(一个|一份|这个|那个)/,
];

/**
 * Strips the parts of a prompt that are never a good title: fenced code, URLs, and
 * `@handle`/`#tag` tokens. Each of these is high-entropy and low-meaning in a short summary.
 * Inline code keeps its label with delimiters removed, so a filename can still name the task.
 */
function cleanPrompt(prompt: string): string {
  return stripConversationTitleMarkdown({ text: prompt })
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[@#][\w.-]+/g, ' ')
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Remove presentation markup from title text while preserving link labels and inline code.
 * Shared by prompt derivation, stored-title display and product naming adapters; no DOM or I/O.
 * Fenced programs and reference definitions are not titles. Only paired emphasis is stripped:
 * glob stars and identifier underscores are meaningful text. Older saved titles may already have
 * been cut through a markdown span; cut links keep their partial label, unpaired emphasis stays.
 * @param input.text - A prompt or a previously saved title.
 * @returns Plain text with whitespace collapsed; identifiers keep their internal underscores.
 * @complexity O(n²) worst-case regex time for unmatched spans; O(n) space in title/prompt length.
 */
export function stripConversationTitleMarkdown({ text }: { text: string }, _options = {}): string {
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/^\s{0,3}\[[^\]\n]+\]:[^\n]*(?:\n|$)/gm, ' ')
    .replace(/!?\[([^\[\]\n]+)\]\((?:[^()[\]\n]|\([^()[\]\n]*\))*(?:\)|$)/g, '$1')
    .replace(/\[([^\[\]\n]+)\]\[[^\[\]\n]*(?:\]|$)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+|[ \t]+#+[ \t]*$/gm, '')
    .replace(/(?<![\w\\*])(\*\*|\*)(?=[^\s*])([^*\n]*?[^\s*\\])\1(?![\w*])/g, '$2')
    .replace(/(?<![\w\\_])(__|_)(?=[^\s_])([^\n]*?[^\s\\])\1(?![\w_])/g, '$2')
    .replace(/`|~~/g, '')
    .replace(/!?\[([^\]\n]*)(?=\n|$)/g, '$1')
    // Unescape after markup removal so an escaped literal marker cannot become emphasis.
    .replace(/\\([\\`*_[\]~])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Keep complete words at the display ceiling. A single oversized token still gets a bounded
 * prefix: pasted blobs must never become megabyte-sized stored/listed titles. The old six-word cap
 * stranded auxiliaries and pronouns mid-clause; the character ceiling leaves short questions whole.
 * @complexity O(n) time/space, bounded by the title ceiling after the initial length check.
 */
function truncateTitle(title: string): string {
  if (title.length <= MAX_TITLE_CHARS) return title;
  const prefix = title.slice(0, MAX_TITLE_CHARS);
  if (/\s/.test(title.charAt(MAX_TITLE_CHARS))) return prefix.trimEnd();
  const lastSpace = prefix.lastIndexOf(' ');
  return (lastSpace > 0 ? prefix.slice(0, lastSpace) : prefix).trimEnd();
}

function trimLatinTitle(input: string): string {
  const words = input.replace(LEADING_LATIN_FILLER, '').match(/[\p{L}\p{N}]+(?:[._-][\p{L}\p{N}]+)*/gu) ?? [];
  const title = words.join(' ');
  // Domain and filename tokens retain their original case, even at the start of a sentence.
  return words[0]?.includes('.') ? title : title.charAt(0).toUpperCase() + title.slice(1);
}

function trimCjkTitle(input: string): string {
  let title = input.trim();
  for (const pattern of LEADING_CJK_FILLER) title = title.replace(pattern, '').trim();
  // Cut at the first sentence-ending punctuation, then drop spacing — CJK titles do not use it.
  title = title.replace(/[，。！？；：,.!?;:].*$/, '').replace(/\s+/g, '');
  return title.slice(0, MAX_CJK_LENGTH);
}

/**
 * Returns a short display title for a conversation, or `''` when the prompt yields nothing
 * usable (a bare URL, a lone code fence, pure punctuation). Callers should treat `''` as "leave
 * the conversation untitled" rather than substituting the raw prompt — a list row showing 400
 * characters of pasted code is worse than one showing "Untitled".
 *
 * @complexity O(n) in prompt length; no allocation beyond the intermediate strings.
 */
export function deriveConversationTitle({ prompt }: { prompt: string }, _optional: Record<string, never> = {}): string {
  const cleaned = cleanPrompt(prompt);
  if (!cleaned) return '';
  // `split` always yields a first element, even for a string that starts with a separator.
  const firstClause = cleaned.split(/[\n\r。！？!?]/)[0]!.trim();
  if (!firstClause) return '';
  const title = CJK_PATTERN.test(firstClause) ? trimCjkTitle(firstClause) : trimLatinTitle(firstClause);
  // Truncated without an ellipsis: this is a working title, not prose, and a `…` would end up stored
  // and shown as if the author wrote it.
  return truncateTitle(title);
}

/** A known heuristic title is already display-ready: derivation keeps the prompt's own wording.
 * Manual names, model-authored names and unloaded transcripts keep their saved wording, with
 * presentation markup removed and the display ceiling applied; no writes.
 * @complexity O(n) time/space in the first prompt's length, using the existing bounded heuristic.
 */
export function conversationTitleForDisplay({ title, titleSource, firstPrompt }: {
  title: string | null; titleSource: 'fallback' | 'generated' | 'manual'; firstPrompt?: string | undefined;
}, _options = {}): string | null {
  if (!title) return title;
  if (titleSource === 'generated' && firstPrompt && title === deriveConversationTitle({ prompt: firstPrompt })) {
    return title;
  }
  return truncateTitle(stripConversationTitleMarkdown({ text: title })) || null;
}
