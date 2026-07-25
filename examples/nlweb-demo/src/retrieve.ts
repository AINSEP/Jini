/**
 * Keyword retrieval — the deliberately unfashionable half of this spike.
 *
 * NLWeb's usual recipe is embeddings plus a vector store. This does BM25-ish keyword scoring
 * instead, because the interesting question for a small site is not "can we build a vector
 * index" but "is retrieval quality actually the bottleneck". On a few thousand items, a scored
 * keyword match over titles, keywords and body text answers a surprising share of real
 * questions, and it needs no API key, no index build, and no refresh lifecycle.
 *
 * Treat this as the baseline to beat. If the answers here are visibly bad, that is the evidence
 * that justifies embeddings — and if they are not, the embeddings were never the point.
 */
import type { SchemaOrgItem } from './items.js';

/** Words carrying no retrieval signal. Short list on purpose; over-stemming loses more than it gains. */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'do', 'does', 'for', 'from',
  'how', 'i', 'in', 'is', 'it', 'my', 'of', 'on', 'or', 'should', 'that', 'the', 'to', 'was',
  'what', 'when', 'where', 'which', 'who', 'why', 'with', 'you', 'your',
]);

/**
 * Splits text into comparable terms.
 *
 * Crude singularisation only — trailing "s" off words longer than three characters, so "plants"
 * matches "plant". Deliberately not a stemmer: a real one would need a dependency, and the
 * failure mode of under-stemming (a missed match) is far kinder here than over-stemming
 * (confidently wrong matches).
 *
 * @param text - Raw text.
 * @returns Lowercased terms with stop words removed.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1 && !STOP_WORDS.has(term))
    .map((term) => (term.length > 3 && term.endsWith('s') ? term.slice(0, -1) : term));
}

/** Where a term matched, and how much that is worth. A title hit means more than a body hit. */
const FIELD_WEIGHTS = { name: 6, keywords: 4, description: 3, text: 1 } as const;

export interface ScoredItem {
  readonly item: SchemaOrgItem;
  readonly score: number;
  /** Query terms that matched. Useful for explaining a result, and for spotting a bad match. */
  readonly matchedTerms: readonly string[];
}

function fieldTerms(item: SchemaOrgItem): Record<keyof typeof FIELD_WEIGHTS, Set<string>> {
  return {
    name: new Set(tokenize(item.name)),
    keywords: new Set(tokenize((item.keywords ?? []).join(' '))),
    description: new Set(tokenize(item.description)),
    text: new Set(tokenize(item.text)),
  };
}

/**
 * Scores every item against a natural-language question.
 *
 * Rarity-weighted: a term appearing in most items says little, so its contribution is damped by
 * how many items contain it. That is what stops a query like "the plants page" from ranking
 * everything that happens to mention plants equally.
 *
 * @param items - The corpus.
 * @param query - The caller's question, in natural language.
 * @param limit - Maximum results.
 * @returns Items with a non-zero score, best first.
 */
export function retrieve(
  items: readonly SchemaOrgItem[],
  query: string,
  limit = 5,
): readonly ScoredItem[] {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0) return [];

  const indexed = items.map((item) => ({ item, fields: fieldTerms(item) }));

  // Terms nothing contains are dropped here rather than skipped inside the scoring loop, so the
  // loop below has no unreachable "what if this term has no frequency" case to defend against.
  // Rarity weight: a term in every item contributes ~nothing; a term in one contributes most.
  const weightedTerms = queryTerms
    .map((term) => ({
      term,
      frequency: indexed.filter(({ fields }) =>
        Object.values(fields).some((set) => set.has(term))).length,
    }))
    .filter(({ frequency }) => frequency > 0)
    .map(({ term, frequency }) => ({ term, rarity: Math.log(1 + items.length / frequency) }));

  const scored = indexed.map(({ item, fields }) => {
    let score = 0;
    const matchedTerms: string[] = [];
    for (const { term, rarity } of weightedTerms) {
      let termScore = 0;
      for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
        if (fields[field as keyof typeof FIELD_WEIGHTS].has(term)) termScore += weight;
      }
      if (termScore > 0) {
        matchedTerms.push(term);
        score += termScore * rarity;
      }
    }
    return { item, score, matchedTerms };
  });

  return scored
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.item['@id'].localeCompare(right.item['@id']))
    .slice(0, limit);
}
