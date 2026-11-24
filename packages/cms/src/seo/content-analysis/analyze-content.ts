/**
 * @file `analyzeContent` — a generic, pure SEO / readability scorer for one piece of content.
 *
 * Purpose:
 * Scores one piece of content (title + a flat list of `ContentBlock`s) and returns a versioned
 * `ContentAnalysisReport`: overall 0-100 score, word/sentence counts, reading time, Flesch reading
 * ease + Flesch-Kincaid grade, a table of contents with de-duplicated anchors, and seven fixed
 * checks whose `params` carry the numbers a UI or i18n layer interpolates.
 *
 * Architectural role:
 * No I/O, no globals, no clock. Heading anchors come from the host's required `slugify`, so they
 * match the ids its renderer emits. An editor adapter (document tree -> `ContentBlock[]`) stays with the host.
 *
 * Counting rules (documented here because the numbers are part of the contract):
 * - Only `text` blocks are prose. Headings are structure and images carry no words, so neither
 *   counts toward words, sentences or syllables.
 * - A word is a whitespace-delimited token containing at least one letter or digit — a bare "-" or
 *   "—" is punctuation, not a word.
 * - Sentences: each text block splits on runs of `.`, `!` or `?` followed by whitespace or the end
 *   of the block; only segments containing a word count. A block with words but no terminator is
 *   therefore exactly 1 sentence.
 * - Zero words: ease 0, grade 0 and band `"standard"` — `"very-difficult"` (what ease 0 maps to)
 *   would wrongly tell the reader an EMPTY post is hard to read; consumers should check
 *   `wordCount === 0` before presenting readability at all.
 */

import type { ContentBlock, HeadingLevel } from "@jini-ai/core/contracts/site/seo-content-analysis";

export type CheckId =
  | "title-length"
  | "meta-description-length"
  | "image-alt"
  | "heading-order"
  | "single-h1"
  | "content-length"
  | "subheadings";
export type CheckStatus = "pass" | "warn" | "fail" | "skip";
export interface ContentCheck {
  id: CheckId;
  status: CheckStatus;
  params: Record<string, number | string>;
}
/** `anchor` = slugified heading text, de-duplicated with `-2`, `-3`, ... */
export interface TocEntry {
  level: HeadingLevel;
  text: string;
  anchor: string;
}
export type ReadabilityBand =
  | "very-easy"
  | "easy"
  | "fairly-easy"
  | "standard"
  | "fairly-difficult"
  | "difficult"
  | "very-difficult";
export interface ContentAnalysisReport {
  v: 1;
  score: number;
  wordCount: number;
  sentenceCount: number;
  readingTimeMinutes: number;
  readability: { fleschReadingEase: number; gradeLevel: number; band: ReadabilityBand };
  toc: TocEntry[];
  /** Always all 7 ids, in `CheckId` declaration order. */
  checks: ContentCheck[];
}

export interface AnalyzeContentRequired {
  title: string;
  blocks: readonly ContentBlock[];
  /** Text -> URL slug; pass the renderer's own rule so TOC anchors match the heading ids it emits. */
  slugify: (args: { text: string }) => string;
}
export interface AnalyzeContentOptional {
  /** Absent (or blank) ⇒ the `meta-description-length` check is `skip`. */
  metaDescription?: string;
}

const TITLE_MIN = 30;
const TITLE_MAX = 60;
const TITLE_HARD_MAX = 70;
const META_MIN = 50;
const META_MAX = 160;
const CONTENT_MIN_WORDS = 300;
const DEFAULT_WORDS_PER_MINUTE = 200;
const FAIL_PENALTY = 20;
const WARN_PENALTY = 8;

const WORD_CHAR = /[\p{L}\p{N}]/u;
const SENTENCE_BREAK = /[.!?](?=\s|$)/;

/**
 * Scores one piece of content. Pure and deterministic.
 *
 * @param required - `title` (the page's H1), the body as a flat `ContentBlock[]`, and `slugify` for TOC anchors.
 * @param optional - `metaDescription` (absent ⇒ that check skips).
 * @returns The full `ContentAnalysisReport` (`v: 1`).
 * @complexity O(total characters of title + blocks).
 */
export function analyzeContent(required: AnalyzeContentRequired, optional: AnalyzeContentOptional = {}): ContentAnalysisReport {
  const { title, blocks, slugify } = required;
  const { metaDescription } = optional;

  const prose = measureProse(blocks);
  const headings = blocks.filter((b): b is Extract<ContentBlock, { kind: "heading" }> => b.kind === "heading");
  const images = blocks.filter((b): b is Extract<ContentBlock, { kind: "image" }> => b.kind === "image");

  const checks: ContentCheck[] = [
    checkTitleLength({ title }),
    checkMetaDescription({ metaDescription }),
    checkImageAlt({ images }),
    checkHeadingOrder({ headings }),
    checkSingleH1({ headings }),
    checkContentLength({ words: prose.words }),
    checkSubheadings({ words: prose.words, headings }),
  ];

  return {
    v: 1,
    score: scoreChecks(checks),
    wordCount: prose.words,
    sentenceCount: prose.sentences,
    // ceil() already yields >= 1 for any positive word count.
    readingTimeMinutes: prose.words > 0 ? Math.ceil(prose.words / DEFAULT_WORDS_PER_MINUTE) : 0,
    readability: readability(prose),
    toc: buildToc({ headings, slugify }),
    checks,
  };
}

interface ProseStats {
  words: number;
  sentences: number;
  syllables: number;
}

function measureProse(blocks: readonly ContentBlock[]): ProseStats {
  const stats: ProseStats = { words: 0, sentences: 0, syllables: 0 };
  for (const block of blocks) {
    if (block.kind !== "text") continue;
    const tokens = block.text.split(/\s+/).filter((token) => WORD_CHAR.test(token));
    stats.words += tokens.length;
    for (const token of tokens) stats.syllables += countSyllables({ word: token });
    stats.sentences += block.text.split(SENTENCE_BREAK).filter((segment) => WORD_CHAR.test(segment)).length;
  }
  return stats;
}

/**
 * English heuristic syllable count: letters only, drop a silent trailing "e" (but keep the
 * syllable of a consonant + "le" ending, as in "table"), count vowel groups (`y` included),
 * minimum 1 per word.
 *
 * @param required.word - One token; punctuation and digits are ignored.
 * @returns The estimated syllable count, always >= 1.
 * @complexity O(word.length).
 */
export function countSyllables({ word }: { word: string }, _optional = {}): number {
  let letters = word.toLowerCase().replace(/[^a-z]/g, "");
  if (letters.length > 2 && letters.endsWith("e") && !/[^aeiouy]le$/.test(letters)) {
    letters = letters.slice(0, -1);
  }
  const groups = letters.match(/[aeiouy]+/g)?.length ?? 0;
  return Math.max(1, groups);
}

function round1({ value }: { value: number }, _optional = {}): number {
  return Math.round(value * 10) / 10;
}

function readability(prose: ProseStats): ContentAnalysisReport["readability"] {
  // See the file header: an empty body is "standard", not "very-difficult".
  if (prose.words === 0) return { fleschReadingEase: 0, gradeLevel: 0, band: "standard" };
  const wordsPerSentence = prose.words / prose.sentences;
  const syllablesPerWord = prose.syllables / prose.words;
  const ease = round1({ value: Math.min(100, Math.max(0, 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord)) });
  const grade = round1({ value: Math.max(0, 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59) });
  return { fleschReadingEase: ease, gradeLevel: grade, band: bandFor({ ease }) };
}

const BAND_FLOORS: ReadonlyArray<readonly [number, ReadabilityBand]> = [
  [90, "very-easy"],
  [80, "easy"],
  [70, "fairly-easy"],
  [60, "standard"],
  [50, "fairly-difficult"],
  [30, "difficult"],
];

function bandFor({ ease }: { ease: number }, _optional = {}): ReadabilityBand {
  return BAND_FLOORS.find(([floor]) => ease >= floor)?.[1] ?? "very-difficult";
}

function checkTitleLength({ title }: { title: string }, _optional = {}): ContentCheck {
  // Code points, not UTF-16 units, so an emoji counts as one character.
  const length = [...title.trim()].length;
  const params = { length, min: TITLE_MIN, max: TITLE_MAX };
  if (length === 0 || length > TITLE_HARD_MAX) return { id: "title-length", status: "fail", params };
  if (length < TITLE_MIN || length > TITLE_MAX) return { id: "title-length", status: "warn", params };
  return { id: "title-length", status: "pass", params };
}

function checkMetaDescription({ metaDescription }: { metaDescription: string | undefined }, _optional = {}): ContentCheck {
  const trimmed = metaDescription?.trim() ?? "";
  if (trimmed === "") return { id: "meta-description-length", status: "skip", params: {} };
  const length = [...trimmed].length;
  const status = length >= META_MIN && length <= META_MAX ? "pass" : "warn";
  return { id: "meta-description-length", status, params: { length, min: META_MIN, max: META_MAX } };
}

function checkImageAlt({ images }: { images: ReadonlyArray<{ alt: string | null }> }, _optional = {}): ContentCheck {
  const missing = images.filter((image) => (image.alt ?? "").trim() === "").length;
  return { id: "image-alt", status: missing > 0 ? "fail" : "pass", params: { images: images.length, missing } };
}

function checkHeadingOrder({ headings }: { headings: ReadonlyArray<{ level: HeadingLevel; text: string }> }, _optional = {}): ContentCheck {
  // The post title is the page's H1, so the walk starts at level 1: a first body heading of H3
  // already skips H2.
  let previous = 1;
  for (const heading of headings) {
    if (heading.level > previous + 1) {
      return { id: "heading-order", status: "warn", params: { from: previous, to: heading.level, heading: heading.text } };
    }
    previous = heading.level;
  }
  return { id: "heading-order", status: "pass", params: {} };
}

function checkSingleH1({ headings }: { headings: ReadonlyArray<{ level: HeadingLevel }> }, _optional = {}): ContentCheck {
  // The post title already renders as the page H1, so ANY body H1 is a second one.
  const h1 = headings.filter((heading) => heading.level === 1).length;
  return { id: "single-h1", status: h1 > 0 ? "warn" : "pass", params: { h1 } };
}

function checkContentLength({ words }: { words: number }, _optional = {}): ContentCheck {
  const params = { words, min: CONTENT_MIN_WORDS };
  if (words === 0) return { id: "content-length", status: "fail", params };
  return { id: "content-length", status: words < CONTENT_MIN_WORDS ? "warn" : "pass", params };
}

function checkSubheadings({ words, headings }: { words: number; headings: ReadonlyArray<{ level: HeadingLevel }> }, _optional = {}): ContentCheck {
  const hasSubheading = headings.some((heading) => heading.level >= 2);
  const status = words >= CONTENT_MIN_WORDS && !hasSubheading ? "warn" : "pass";
  return { id: "subheadings", status, params: status === "warn" ? { words } : {} };
}

function scoreChecks(checks: readonly ContentCheck[]): number {
  const penaltyByStatus: Record<CheckStatus, number> = { fail: FAIL_PENALTY, warn: WARN_PENALTY, pass: 0, skip: 0 };
  const penalty = checks.reduce((sum, check) => sum + penaltyByStatus[check.status], 0);
  return Math.min(100, Math.max(0, 100 - penalty));
}

/**
 * Uses the host's slug function so transliteration and empty headings match the ids its renderer emits.
 */
function buildToc({ headings, slugify }: { headings: ReadonlyArray<{ level: HeadingLevel; text: string }>; slugify: AnalyzeContentRequired["slugify"] }, _optional = {}): TocEntry[] {
  const used = new Set<string>();
  const toc: TocEntry[] = [];
  for (const heading of headings) {
    const text = heading.text.trim();
    if (text === "") continue;
    const base = slugify({ text });
    if (base !== "") {
      let anchor = base;
      // Keep counting past a suffix a LITERAL heading already took ("Foo-2" then a second "Foo").
      let n = 2;
      while (used.has(anchor)) {
        anchor = `${base}-${n}`;
        n += 1;
      }
      used.add(anchor);
      toc.push({ level: heading.level, text, anchor });
    }
  }
  return toc;
}
