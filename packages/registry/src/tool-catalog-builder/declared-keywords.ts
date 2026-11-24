/**
 * @file Collects search-only tool vocabulary that shipped manifests declare, and merges several
 * keyword maps into the one map {@link createSearchEnricher} indexes. The host owns which sources are
 * trusted (e.g. only bundled, never installed, packages), how a manifest is read and where its
 * declaration lives, and which tool ids exist; all of that is injected. The vocabulary has no
 * authority over registration, approval or callbacks: it only makes existing tools findable.
 */
import { orFallbackSync } from '@jini-ai/core/errors/idioms';

/** One trusted manifest location, as the host's source enumeration reports it. */
export interface DeclaredKeywordSource {
  readonly packageRoot: string;
}

/** Ignore non-string values and unknown tool ids; metadata can enrich only existing tools.
 * Appends to an id's existing words (space-joined) rather than replacing them.
 * @complexity O(k) declared entries, without I/O. */
export function appendToolKeywords(
  { keywords, declaration, isKnownTool }: { keywords: Record<string, string>; declaration: unknown; isKnownTool: (required: { id: string }) => boolean },
  _optional = {},
): void {
  if (typeof declaration !== 'object' || declaration === null || Array.isArray(declaration)) return;
  for (const [id, words] of Object.entries(declaration)) {
    if (!isKnownTool({ id }) || typeof words !== 'string' || !words.trim()) continue;
    keywords[id] = [keywords[id], words.trim()].filter(Boolean).join(' ');
  }
}

/**
 * Reads every source's keyword declaration through the injected reader. Missing or malformed
 * optional metadata contributes nothing: a failing enumeration yields no sources, and a failing
 * read (or a declaration that throws while being appended) skips only that source. No plugin code
 * is executed here — `readDeclaration` is the host's data read.
 * @param required.listSources - The host's trusted source enumeration.
 * @param required.readDeclaration - Reads one source's raw keyword declaration (id -> words).
 * @param required.isKnownTool - Whether an id names a tool this vocabulary may enrich.
 * @returns A prototype-less id -> words map.
 * @complexity O(p + k) for p sources and k keyword entries; one read per source.
 */
export function collectDeclaredToolKeywords(required: {
  listSources: () => readonly DeclaredKeywordSource[];
  readDeclaration: (required: { source: DeclaredKeywordSource }) => unknown;
  isKnownTool: (required: { id: string }) => boolean;
}, _optional = {}): Record<string, string> {
  const keywords: Record<string, string> = Object.create(null);
  const sources = orFallbackSync({ work: () => required.listSources(), fallback: [], step: 'List tool keyword manifests' });
  for (const source of sources) {
    orFallbackSync({ work: () => {
      appendToolKeywords({ keywords, declaration: required.readDeclaration({ source }), isKnownTool: required.isKnownTool });
    }, fallback: undefined, step: 'Read tool keyword manifest' }); /* Optional search data never prevents tool catalog construction. */
  }
  return keywords;
}

/** Merge keyword maps id by id, space-joining each id's non-empty words in map order.
 * @complexity O(m * k) for m maps of k ids. */
export function mergeKeywordMaps({ maps }: { maps: readonly Readonly<Record<string, string | undefined>>[] }, _optional = {}): Record<string, string> {
  const ids = [...new Set(maps.flatMap((map) => Object.keys(map)))];
  return Object.fromEntries(ids.map((id) => [id, maps.map((map) => map[id]).filter(Boolean).join(' ')]));
}
