import type { SearchEnricher, SourceClassifier } from './ports.js';

/** Host vocabulary and boundary marker are required; no product dictionary ships here. */
export function createSearchEnricher(required: {
  marker: string;
  keywords: Readonly<Record<string, string>>;
  questions: Readonly<Record<string, readonly string[]>>;
}): SearchEnricher {
  const { marker, keywords, questions } = required;
  if (!marker) throw new Error('search vocabulary marker must not be empty');
  return {
    indexedDescription({ id, description }, { includeDoc2query }) {
      const tail = [keywords[id], includeDoc2query ? questions[id]?.join(' ') : undefined]
        .filter(part => Boolean(part?.length)).join(' ');
      if (!tail) return description;
      return description ? `${description}${marker}${tail}` : tail;
    },
    authoredDescription({ description }) {
      const boundary = description.indexOf(marker);
      return boundary < 0 ? description : description.slice(0, boundary);
    },
  };
}

/** Source naming conventions are supplied by the host, including the orphan-ID fallback. */
export function createPrefixSourceClassifier(required: { separator: string; fallbackSource: string }): SourceClassifier {
  if (!required.separator || !required.fallbackSource) throw new Error('source separator and fallback must not be empty');
  return { classify({ id }) { return id.split(required.separator)[0] || required.fallbackSource; } };
}
