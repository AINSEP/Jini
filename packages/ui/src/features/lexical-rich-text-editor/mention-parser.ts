/**
 * Parses `@token` mentions out of a committed plain-text string. This is the
 * "reconcile a document model back into a string" side of the picture —
 * used by `deserialize.ts` to decide which `@token` runs become atomic
 * mention nodes, and available to hosts that need the same rule to fold
 * plain-text-typed `@token`s into a "currently referenced" entity list.
 *
 * Trie lookup prefers the longest token subject to left/right boundaries. MentionEntity.kind
 * is host-defined rather than a fixed product vocabulary.
 */
import type { MentionEntity, MentionPart } from './types.js';

export function buildMentionToken(label: string): string {
  return label.startsWith('@') ? label : `@${label}`;
}

export function parseMentionParts(
  text: string,
  entities: MentionEntity[],
  options: { highlightUnknown?: boolean } = {},
): MentionPart[] | null {
  // An empty string never contains '@', so this one check also covers `!text`.
  if (!text.includes('@')) return null;
  const scan = {
    known: getMentionTokenIndex(entities),
    highlightUnknown: options.highlightUnknown ?? true,
  };
  const parts: MentionPart[] = [];
  let copiedUntil = 0;
  let start = text.indexOf('@');

  while (start !== -1) {
    const match = findMentionAt({ ...scan, text, start });
    if (match) copiedUntil = appendMatch({ parts, text, copiedUntil, match });
    start = text.indexOf('@', match ? copiedUntil : start + 1);
  }

  // Every mention token is at least two characters ('@' plus one more), so
  // `copiedUntil` only moves off 0 once a mention part has been pushed.
  if (copiedUntil === 0) return null;
  if (copiedUntil < text.length) {
    parts.push({ kind: 'text', text: text.slice(copiedUntil) });
  }

  // Every 'text' part pushed above is guarded to be non-empty (`match.start
  // > copiedUntil` / `copiedUntil < text.length`), and each is immediately
  // followed by that iteration's mention part — so `parts` never contains
  // an empty or adjacent-duplicate 'text' entry that would need coalescing.
  // An earlier version of this function ran the result through a
  // coalesce-adjacent-and-drop-empty pass copied from the origin; removed
  // per this package's coverage-driven-refactor policy once the loop proved
  // every branch of that pass was unreachable from this one real call site
  // (Phase 9.5: a dead branch gets refactored out, not padded with a test).
  return parts;
}

/**
 * Pushes the plain text between `copiedUntil` and the match (when non-empty)
 * followed by the mention part; returns the new `copiedUntil`.
 */
function appendMatch(at: {
  parts: MentionPart[];
  text: string;
  copiedUntil: number;
  match: MentionMatch;
}): number {
  const { parts, text, copiedUntil, match } = at;
  if (match.start > copiedUntil) {
    parts.push({ kind: 'text', text: text.slice(copiedUntil, match.start) });
  }
  parts.push({ kind: 'mention', entity: match.entity, text: match.token });
  return match.start + match.token.length;
}

/**
 * The mention starting at `scan.start`, or null. A known (trie) match wins
 * unless the unknown-mention run at the same position is strictly longer.
 */
function findMentionAt(scan: {
  text: string;
  known: MentionTrieNode;
  highlightUnknown: boolean;
  start: number;
}): MentionMatch | null {
  const { text } = scan;
  if (!isMentionBoundary(text, scan.start)) return null;
  const knownMatch = findKnownMentionAt(text, scan.known, scan.start);
  const unknownMatch = scan.highlightUnknown ? findUnknownMentionAt(text, scan.start) : null;
  return knownMatch && (!unknownMatch || knownMatch.token.length >= unknownMatch.token.length)
    ? knownMatch
    : unknownMatch;
}

interface MentionTrieNode {
  children: Map<string, MentionTrieNode>;
  entity?: MentionEntity & { token: string };
}

const mentionTokenIndexCache = new WeakMap<MentionEntity[], MentionTrieNode>();

/** Root of the (cached, per entities-array) trie of every entity's `@token`. */
function getMentionTokenIndex(entities: MentionEntity[]): MentionTrieNode {
  const cached = mentionTokenIndexCache.get(entities);
  if (cached) return cached;

  const root: MentionTrieNode = { children: new Map() };
  const seen = new Set<string>();
  const normalized = entities
    .map((entity) => {
      const token = entity.token ?? buildMentionToken(entity.label);
      return {
        id: entity.id,
        kind: entity.kind,
        label: entity.label,
        token,
        ...(entity.title ? { title: entity.title } : {}),
      };
    })
    .filter((entity) => {
      if (!entity.token || entity.token === '@') return false;
      const key = `${entity.kind}:${entity.token}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    // The preceding .filter() step already excludes every entity whose
    // `token` is falsy, so by the time .sort() runs every element's `token`
    // is a real string — the `!` documents that (noUncheckedIndexedAccess
    // makes `.length` on an optional string require narrowing) rather than
    // adding an unreachable `?? 0` fallback branch no real input can hit.
    .sort((a, b) => b.token!.length - a.token!.length);

  for (const entity of normalized) {
    // `normalized` was already filtered above to exclude any falsy/`'@'`
    // token, so `token` here is always a real, non-`'@'` string.
    const token = entity.token;
    let node = root;
    for (const char of token) {
      let child = node.children.get(char);
      if (!child) {
        child = { children: new Map() };
        node.children.set(char, child);
      }
      node = child;
    }
    // First writer wins: two entities of different kinds can share a token.
    node.entity ??= entity;
  }

  mentionTokenIndexCache.set(entities, root);
  return root;
}

function findKnownMentionAt(
  text: string,
  root: MentionTrieNode,
  start: number,
): MentionMatch | null {
  let best: MentionMatch | null = null;
  let node: MentionTrieNode | undefined = root;
  for (let i = start; i < text.length; i += 1) {
    // `i < text.length` is the loop condition itself, so `text[i]` is always
    // defined here — the `!` documents that instead of adding an
    // unreachable `?? ''` fallback (noUncheckedIndexedAccess requires
    // narrowing a string index read either way).
    node = node.children.get(text[i]!);
    if (!node) break;
    if (node.entity && isMentionRightBoundary(text, i + 1)) {
      best = { start, token: node.entity.token, entity: node.entity };
    }
  }
  return best;
}

function findUnknownMentionAt(text: string, start: number): MentionMatch | null {
  let end = start + 1;
  // Both `text[end]` reads below are only ever evaluated once a preceding
  // `end < text.length` check (the `||`'s left side / the `&&`'s left side)
  // has already passed, so `text[end]` is always defined — `!` documents
  // that instead of an unreachable `?? ''` fallback.
  if (end >= text.length || /[\s@]/.test(text[end]!)) return null;
  while (end < text.length && !/[\s@]/.test(text[end]!)) {
    end += 1;
  }
  const token = text.slice(start, end);
  return {
    start,
    token,
    entity: {
      id: `unknown:${token}`,
      kind: 'unknown',
      label: token.slice(1),
      token,
      title: token,
    },
  };
}

/**
 * Left boundary rule: `@<token>` is a candidate mention only when the
 * character before `@` is the start of the string or whitespace / opening
 * bracket / quote.
 */
export function isMentionBoundary(text: string, start: number): boolean {
  if (start === 0) return true;
  // `start > 0` here (the `start === 0` case already returned), so
  // `start - 1` is always a valid index — `!` documents that instead of an
  // unreachable `?? ''` fallback.
  return /[\s([{"']/.test(text[start - 1]!);
}

/**
 * Right boundary rule: the unknown-mention regex is `/@[^\s@]+/`, so a
 * `@<token>` candidate is the full mention only when the character after the
 * token is the end of the string, whitespace, or another `@`.
 */
export function isMentionRightBoundary(text: string, end: number): boolean {
  if (end >= text.length) return true;
  // `end < text.length` here — `!` documents the always-defined read
  // instead of an unreachable `?? ''` fallback.
  return /[\s@]/.test(text[end]!);
}

interface MentionMatch {
  start: number;
  token: string;
  entity: MentionEntity;
}

/**
 * Submit-time right boundary for reconciling a *still-visible atomic pill*
 * against serialized text. Looser than `isMentionRightBoundary`: a pill stays
 * "referenced" even when the user types trailing punctuation right after it
 * (e.g. `@Slack,` or `@Notion.`), so the character after the token may also
 * be sentence/clause punctuation that cannot be part of a mention token.
 */
function isMentionSubmitRightBoundary(text: string, end: number): boolean {
  if (end >= text.length) return true;
  // `end < text.length` here — `!` documents the always-defined read
  // instead of an unreachable `?? ''` fallback.
  return /[\s@,.;:!?)\]}"'»”’]/.test(text[end]!);
}

/**
 * Whether `@label` appears in `text` as a standalone inline mention (proper
 * left boundary, not a substring of a longer word). Useful for a host that
 * reconciles a "currently referenced" entity list against typed text at
 * submit time — a chip whose `@token` the user deleted should not be kept.
 */
export function mentionTokenPresent(text: string, label: string): boolean {
  const token = buildMentionToken(label);
  let from = 0;
  let start = text.indexOf(token, from);
  while (start !== -1) {
    if (
      isMentionBoundary(text, start) &&
      isMentionSubmitRightBoundary(text, start + token.length)
    ) {
      return true;
    }
    from = start + 1;
    start = text.indexOf(token, from);
  }
  return false;
}

/**
 * Folds plain-text `@token` runs that still match a known entity into
 * `present` (entities already backed by an atomic mention node in the
 * tree). A host that inserts mentions as plain text rather than atomic
 * nodes (e.g. via `insertText` instead of `insertMention`) needs this to
 * keep a "currently referenced" list in sync with what's actually typed.
 *
 * Origin: `LexicalComposerInput.tsx`'s `foldPresentEntities`.
 */
export function foldPresentMentions(
  text: string,
  present: MentionEntity[],
  known: MentionEntity[],
): MentionEntity[] {
  const result: MentionEntity[] = [...present];
  const seen = new Set(present.map((e) => `${e.kind}:${e.id}`));
  const parts = parseMentionParts(text, known, { highlightUnknown: false }) ?? [];
  for (const part of parts) {
    if (part.kind !== 'mention' || part.entity.kind === 'unknown') continue;
    const key = `${part.entity.kind}:${part.entity.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(part.entity);
    }
  }
  return result;
}
