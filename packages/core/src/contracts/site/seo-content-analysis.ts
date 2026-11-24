/**
 * @file Content-analysis input contracts. Types only; this module owns the declarations that
 * `@jini-ai/cms/seo/content-analysis` (`analyze-content.ts`) used to declare. That package imports
 * them from here and keeps its runtime values.
 */

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type ContentBlock =
  | { kind: "heading"; level: HeadingLevel; text: string }
  | { kind: "text"; text: string }
  | { kind: "image"; alt: string | null };
