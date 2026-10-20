import type { SearchEnricher, SourceClassifier } from './ports.js';

/** Host vocabulary and boundary marker are required; no product dictionary ships here.
 * Registered search metadata takes precedence over legacy dictionaries. The marker and question
 * switch remain host-controlled so an index migration cannot silently change authored copy. */
export function createSearchEnricher(required: {
  marker: string;
  keywords: Readonly<Record<string, string>>;
  questions: Readonly<Record<string, readonly string[]>>;
}, _optional: Record<string, never> = {}): SearchEnricher {
  const { marker, keywords, questions } = required;
  if (!marker) throw new Error('search vocabulary marker must not be empty');
  return {
    indexedDescription({ id, description, metadata }, { includeDoc2query }) {
      const search = metadata?.search;
      const vocabulary = search?.keywords ?? ownValue(keywords, id);
      const queries = includeDoc2query ? (search?.queries ?? ownValue(questions, id))?.join(' ') : undefined;
      const tail = [vocabulary, queries].filter(Boolean).join(' ');
      if (!tail) return description;
      return description ? `${description}${marker}${tail}` : tail;
    },
    authoredDescription({ description }) {
      const boundary = description.indexOf(marker);
      return boundary < 0 ? description : description.slice(0, boundary);
    },
  };
}

/** Own-property lookup: inherited object keys (`toString`, `__proto__`) never count as host vocabulary. */
function ownValue<T>(record: Readonly<Record<string, T>>, id: string): T | undefined {
  return Object.hasOwn(record, id) ? record[id] : undefined;
}

/** Source naming conventions are supplied by the host, including the orphan-ID fallback. */
export function createPrefixSourceClassifier(required: { separator: string; fallbackSource: string }): SourceClassifier {
  if (!required.separator || !required.fallbackSource) throw new Error('source separator and fallback must not be empty');
  return { classify({ id }) { return id.split(required.separator)[0] || required.fallbackSource; } };
}
