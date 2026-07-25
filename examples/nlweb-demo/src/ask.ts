/**
 * The `/ask` endpoint's shape: natural-language question in, Schema.org results out.
 *
 * NLWeb's contract is roughly "a site becomes something you can ask questions of, and the answer
 * comes back as structured Schema.org rather than prose to scrape". That is the part worth
 * copying. The summarizer is optional and injected, so the whole thing runs with no API key and
 * no network — which also makes it testable.
 *
 * The split this demo is really arguing for: **retrieval, ranking, response shaping and the
 * endpoint are generic** and could live in the engine. **The items are not** — only the product
 * knows what its content is. That is a port, exactly like `PageDriver`.
 */
import type { SchemaOrgItem } from './items.js';
import { retrieve, type ScoredItem } from './retrieve.js';

/**
 * Optional natural-language summary step.
 *
 * Absent by default. `@jini/memory`'s `llm-provider` is the primitive that would back this in a
 * real deployment — a multi-vendor "call an LLM, get strict JSON back" call that already exists.
 */
export type Summarizer = (question: string, items: readonly SchemaOrgItem[]) => Promise<string>;

/** One result, as returned to the caller. `text` is deliberately not included — it is index fodder. */
export interface AskResultItem {
  readonly '@type': SchemaOrgItem['@type'];
  readonly '@id': string;
  readonly name: string;
  readonly description: string;
  readonly url: string;
  readonly score: number;
  readonly matchedTerms: readonly string[];
}

export interface AskResponse {
  readonly '@context': 'https://schema.org';
  readonly '@type': 'SearchResultsPage';
  readonly query: string;
  readonly results: readonly AskResultItem[];
  /** Present only when a summarizer was supplied. */
  readonly summary?: string;
  /**
   * True when nothing matched. Callers should say so rather than presenting an empty list as an
   * answer — "I don't have anything on that" is a better response than silence, and it is the
   * honest one.
   */
  readonly noMatch: boolean;
}

function toResultItem(scored: ScoredItem): AskResultItem {
  return {
    '@type': scored.item['@type'],
    '@id': scored.item['@id'],
    name: scored.item.name,
    description: scored.item.description,
    url: scored.item.url,
    score: Math.round(scored.score * 100) / 100,
    matchedTerms: scored.matchedTerms,
  };
}

export interface AskOptions {
  readonly limit?: number;
  readonly summarize?: Summarizer | undefined;
}

/**
 * Answers a natural-language question against the site's items.
 *
 * @param items - The corpus, supplied by the product.
 * @param question - The caller's question.
 * @param options - Result limit and optional summarizer.
 * @returns A Schema.org `SearchResultsPage`.
 * @throws If `question` is blank — an empty question is a caller bug, not an empty result.
 */
export async function ask(
  items: readonly SchemaOrgItem[],
  question: string,
  options: AskOptions = {},
): Promise<AskResponse> {
  const query = question.trim();
  if (query.length === 0) throw new Error('question is required');

  const scored = retrieve(items, query, options.limit ?? 5);
  const results = scored.map(toResultItem);

  // Summarize only what was actually retrieved. Handing the model the whole corpus would make
  // the answer independent of retrieval quality, which hides exactly the thing this spike is
  // meant to measure.
  const summary = options.summarize !== undefined && scored.length > 0
    ? await options.summarize(query, scored.map((entry) => entry.item))
    : undefined;

  return {
    '@context': 'https://schema.org',
    '@type': 'SearchResultsPage',
    query,
    results,
    ...(summary === undefined ? {} : { summary }),
    noMatch: results.length === 0,
  };
}
