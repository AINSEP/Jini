// designMd* — pure helpers for slicing a single "module" section out of a
// DESIGN.md-shaped markdown document (an optional frontmatter block, an
// optional preamble before the first `##` heading, then `##`-delimited
// sections) and replacing that slice in place. A module is matched by
// checking whether any of its `keywords` appears (case-insensitively) in a
// heading's text — the same fuzzy match a hand-edited doc's headings need to
// keep matching after a human renames "Color Palette" to "Palette", etc.

export interface DesignMdModule {
  /** Rendered when the module has no preamble/heading content yet. */
  heading: string;
  /** Case-insensitive substrings matched against `##` heading text. */
  keywords: string[];
  /** When true, the module is the document's untitled preamble (before the first `##`), not a `##` section. */
  includePreamble?: boolean;
}

export interface DesignMdSlice {
  text: string;
  start: number;
  end: number;
  /** False when no matching content was found and `text` is a generated default. */
  exists: boolean;
}

interface DesignMdHeadingMatch {
  start: number;
  title: string;
}

export function designMdHeadings({ body, startOffset }: { body: string; startOffset: number }, _optional: Record<string, never> = {}): DesignMdHeadingMatch[] {
  return [...body.slice(startOffset).matchAll(/^##\s+(\S.*|.)$/gm)].map((match) => {
    // `RegExpMatchArray.index` and a capture group are typed as possibly
    // `undefined` because the JS regex API can't express "always set for a
    // `matchAll` result" / "always set for a mandatory capture group" — for
    // this specific pattern (an unanchored global match, one non-optional
    // title group) both are always defined whenever a match exists.
    const start = startOffset + match.index!;
    return {
      start,
      title: match[1]!.trimEnd() || match[1]!,
    };
  });
}

export function designMdHeadingMatches({ title, module }: { title: string; module: DesignMdModule }, _optional: Record<string, never> = {}): boolean {
  const normalized = title.replace(/^\d+[.)]\s*/, '').trim().toLowerCase();
  return module.keywords.some((keyword) => normalized.includes(keyword));
}

export function designMdDefaultModuleText({ module }: { module: DesignMdModule }, { preamble = '' }: { preamble?: string | undefined } = {}): string {
  if (module.includePreamble) return preamble || `# ${module.heading}\n`;
  return `## ${module.heading}\n\n`;
}

function designMdContentStart({ body }: { body: string }, _optional: Record<string, never> = {}): number {
  const frontmatter = body.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return frontmatter ? frontmatter[0].length : 0;
}

export function designMdModuleSlice({ body, module }: { body: string; module: DesignMdModule }, _optional: Record<string, never> = {}): DesignMdSlice {
  const contentStart = designMdContentStart({ body });
  const headings = designMdHeadings({ body, startOffset: contentStart });
  const preambleEnd = headings[0]?.start ?? body.length;
  const preamble = body.slice(contentStart, preambleEnd).trim();
  const matchedIndexes = headings
    .map((heading, index) => (designMdHeadingMatches({ title: heading.title, module }) ? index : -1))
    .filter((index) => index >= 0);

  if (module.includePreamble && preamble.length > 0) {
    return {
      text: preamble,
      start: contentStart,
      end: preambleEnd,
      exists: true,
    };
  }

  if (matchedIndexes.length > 0) {
    const first = matchedIndexes[0]!;
    const last = matchedIndexes[matchedIndexes.length - 1]!;
    const start = headings[first]!.start;
    const end = headings[last + 1]?.start ?? body.length;
    return {
      text: body.slice(start, end).trim(),
      start,
      end,
      exists: true,
    };
  }

  if (module.includePreamble) {
    return {
      text: designMdDefaultModuleText({ module }, { preamble }),
      start: contentStart,
      end: preambleEnd,
      exists: false,
    };
  }

  return {
    text: designMdDefaultModuleText({ module }),
    start: body.length,
    end: body.length,
    exists: false,
  };
}

export function normalizeDesignMdModuleDraft({ module, draft }: { module: DesignMdModule; draft: string }, _optional: Record<string, never> = {}): string {
  const trimmed = draft.trim();
  if (module.includePreamble) return trimmed;
  if (!trimmed) return `## ${module.heading}`;
  return /^##\s+/m.test(trimmed) ? trimmed : `## ${module.heading}\n\n${trimmed}`;
}

export function replaceDesignMdModule({ body, module, draft }: { body: string; module: DesignMdModule; draft: string }, _optional: Record<string, never> = {}): string {
  const slice = designMdModuleSlice({ body, module });
  const nextText = normalizeDesignMdModuleDraft({ module, draft });
  const before = body.slice(0, slice.start).trimEnd();
  const after = body.slice(slice.end).trimStart();
  return [before, nextText, after]
    .filter((part) => part.trim().length > 0)
    .join('\n\n')
    .trimEnd()
    .concat('\n');
}
