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
 * Ported from Open Design's `summarizeProjectNameFromPrompt` (`apps/web/src/utils/projectName.ts`),
 * which this generalizes from project names to conversation titles. Its behaviour is preserved
 * deliberately — including the CJK path, which is not decoration: the filler and punctuation
 * rules for Chinese prompts differ enough from the Latin ones that a shared code path produced
 * visibly worse titles in both.
 *
 * Two intentional divergences from the original, both fixing output the original gets wrong; each
 * is documented at its own declaration below:
 *   1. `LEADING_LATIN_FILLER` requires the separator inside the article group. The original's form
 *      let a bare `a` eat the first letter of the next word ("update app.tsx" → "Pp Tsx").
 *   2. `LATIN_NEVER_TRAILING` trims function words off the end. The original's word cap lands
 *      mid-clause on question-shaped prompts and strands them ("...Posts Do I").
 */

const MAX_LATIN_WORDS = 6;
const MAX_CJK_LENGTH = 18;
/**
 * Hard character ceiling, because a word cap is not a length cap.
 *
 * Six "words" says nothing about their size: a pasted base64 blob or minified bundle is a single
 * enormous token, so it survived the word cap intact and became the title verbatim. That title is
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

const LATIN_STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'and', 'for', 'in', 'of', 'on', 'please', 'the', 'to', 'with', 'my',
]);

/**
 * Function words that are fine *inside* a title but never acceptable as its last word.
 *
 * These cannot go in `LATIN_STOP_WORDS`, because removing them everywhere mangles real titles —
 * "how many posts do I have" would lose the "how many" that makes it a question, and a prompt like
 * "make it work" would reduce to "Work". The problem is specifically the word-cap boundary: a
 * question-shaped prompt reliably spends its six words before reaching the noun, so the title got
 * cut mid-clause. Observed live: "how many published posts do I have?" produced
 * "How Many Published Posts Do I" — a dangling auxiliary plus a stranded pronoun, which in a narrow
 * dock also wrapped to leave a lone "I" on its own line.
 *
 * Trimming only the tail is what makes this safe: it can never shorten a title that already ended
 * on a content word, so no existing good title changes.
 */
const LATIN_NEVER_TRAILING: ReadonlySet<string> = new Set([
  'do', 'does', 'did', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'can', 'could', 'should', 'would', 'will', 'shall', 'may', 'might', 'must',
  'i', 'me', 'you', 'we', 'us', 'it', 'they', 'them', 'he', 'she',
  'that', 'this', 'these', 'those', 'but', 'or', 'if', 'then', 'than', 'as', 'at', 'by',
  'from', 'into', 'about', 'so', 'just', 'also', 'too', 'up', 'out',
]);

/**
 * Strips the parts of a prompt that are never a good title: fenced and inline code, URLs, and
 * `@handle`/`#tag` tokens. Each of these is high-entropy and low-meaning in a six-word summary.
 */
function cleanPrompt(prompt: string): string {
  return prompt
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[@#][\w.-]+/g, ' ')
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toTitleCase(word: string): string {
  return word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word;
}

function trimLatinTitle(input: string): string {
  const words = input
    .replace(LEADING_LATIN_FILLER, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !LATIN_STOP_WORDS.has(word.toLowerCase()))
    .slice(0, MAX_LATIN_WORDS);
  // Applied after the cap, because the cap is what strands these words in the first place.
  while (words.length > 0 && LATIN_NEVER_TRAILING.has(words[words.length - 1]!.toLowerCase())) {
    words.pop();
  }
  return words.map(toTitleCase).join(' ');
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
export function deriveConversationTitle(prompt: string): string {
  const cleaned = cleanPrompt(prompt);
  if (!cleaned) return '';
  const firstClause = cleaned.split(/[\n\r。！？!?]/)[0]?.trim() ?? cleaned;
  if (!firstClause) return '';
  const title = CJK_PATTERN.test(firstClause) ? trimCjkTitle(firstClause) : trimLatinTitle(firstClause);
  // Truncated without an ellipsis: this is a working title, not prose, and a `…` would end up stored
  // and shown as if the author wrote it.
  return title.length > MAX_TITLE_CHARS ? title.slice(0, MAX_TITLE_CHARS).trimEnd() : title;
}
