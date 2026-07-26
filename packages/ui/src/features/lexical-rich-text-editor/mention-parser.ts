/**
 * Parses `@token` mentions out of a committed plain-text string. This is the
 * "reconcile a document model back into a string" side of the picture —
 * used by `deserialize.ts` to decide which `@token` runs become atomic
 * mention nodes, and available to hosts that need the same rule to fold
 * plain-text-typed `@token`s into a "currently referenced" entity list.
 *
 * Origin: `apps/web/src/utils/inlineMentions.ts`. Ported verbatim (trie-based
 * longest-match lookup, left/right boundary rules) — the only OD-specific
 * surface was `InlineMentionKind`'s fixed union, replaced by `MentionEntity`'s
 * free-form `kind: string` (see `types.ts`).
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
  if (!text) return null;
  if (!text.includes('@')) return null;
  const highlightUnknown = options.highlightUnknown ?? true;
  const known = getMentionTokenIndex(entities);
  const parts: MentionPart[] = [];
  let scanStart = 0;
  let copiedUntil = 0;
  let found = false;

  while (scanStart < text.length) {
    const start = text.indexOf('@', scanStart);
    if (start === -1) break;
    if (!isMentionBoundary(text, start)) {
      scanStart = start + 1;
      continue;
    }

    const knownMatch = findKnownMentionAt(text, known, start);
    const unknownMatch = highlightUnknown ? findUnknownMentionAt(text, start) : null;
    const match =
      knownMatch && (!unknownMatch || knownMatch.token.length >= unknownMatch.token.length)
        ? knownMatch
        : unknownMatch;

    if (!match) {
      scanStart = start + 1;
      continue;
    }

    if (match.start > copiedUntil) {
      parts.push({ kind: 'text', text: text.slice(copiedUntil, match.start) });
    }
    parts.push({
      kind: 'mention',
      entity: match.entity,
      text: match.token,
    });
    found = true;
    copiedUntil = match.start + match.token.length;
    scanStart = copiedUntil;
  }

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
  return found ? parts : null;
}

interface MentionTrieNode {
  children: Map<string, MentionTrieNode>;
  entity?: MentionEntity;
  token?: string;
}

interface MentionTokenIndex {
  root: MentionTrieNode;
}

const mentionTokenIndexCache = new WeakMap<MentionEntity[], MentionTokenIndex>();

function getMentionTokenIndex(entities: MentionEntity[]): MentionTokenIndex {
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
    if (!node.entity) {
      node.entity = entity;
      node.token = token;
    }
  }

  const index = { root };
  mentionTokenIndexCache.set(entities, index);
  return index;
}

function findKnownMentionAt(
  text: string,
  index: MentionTokenIndex,
  start: number,
): MentionMatch | null {
  let best: MentionMatch | null = null;
  let node: MentionTrieNode | undefined = index.root;
  for (let i = start; i < text.length; i += 1) {
    // `i < text.length` is the loop condition itself, so `text[i]` is always
    // defined here — the `!` documents that instead of adding an
    // unreachable `?? ''` fallback (noUncheckedIndexedAccess requires
    // narrowing a string index read either way).
    node = node.children.get(text[i]!);
    if (!node) break;
    if (node.entity && node.token && isMentionRightBoundary(text, i + 1)) {
      best = { start, token: node.token, entity: node.entity };
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
  const parts = parseMentionParts(text, known, { highlightUnknown: false });
  if (parts) {
    for (const part of parts) {
      if (part.kind === 'mention' && part.entity.kind !== 'unknown') {
        const key = `${part.entity.kind}:${part.entity.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push(part.entity);
        }
      }
    }
  }
  return result;
}
