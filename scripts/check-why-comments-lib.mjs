/**
 * Core of the why-comment gate. Owner rule: refactors MOVE "why" comments with the code, never
 * delete them. A comment block deleted in a commit range is a violation unless its normalized
 * text survives somewhere: in the lines the range added, or in the current text of any tracked
 * file of this repo or the configured sibling repos. Every collaborator (git, file reads) is
 * injected so the unit tests need no real repository.
 */
import { createHash } from 'node:crypto';
import { extractComments } from './check-why-comments-lexer.mjs';

const SOURCE_FILE = /\.(ts|tsx|mjs|js)$/;
const DIRECTIVE_LINE = /^(eslint(-[a-z]+)*\b|@ts-(ignore|expect-error|nocheck|check)\b|istanbul\s|c8\s|v8\s|prettier-ignore\b|@?vitest-environment\b|@jest-environment\b|biome-ignore\b|#(end)?region\b|\/\s*<reference\b|#?\s?sourceMappingURL=|@preserve\b|@vite-ignore\b|webpack[A-Z]\w*:|jscpd:|knip:)/i;
const LICENSE_TEXT = /\b(copyright|spdx-license-identifier|licensed under|all rights reserved|permission is hereby granted)\b/i;
const CODE_LINE = [
  /^(const|let|var)\s+[\w${[]+\s*(=|:|;)/,
  /^import\s.+\sfrom\s|^import\s*['"{]/,
  /^export\s+(const|let|function|async|default|class|type|interface|enum|\{|\*)/,
  /^(if|for|while|switch|catch)\s*\(/,
  /^return\b.*;$|^return\s*[([{<]/,
  /^(await|throw new)\s/,
  /^[})\]]+[;,)]*$/,
  /^[\w$.[\]]+\(.*\)[;,]?$/,
  /[;{]$|=>\s*\{?$|^\}\)?;$/,
];
const MIN_WORDS = 4;
const PREFIX_KEY = 12;
const SHINGLE_WORDS = 3;
// A comment edited in place keeps most of its words; one that lost a sentence does not.
const EDIT_CONTAINMENT = 0.75;

/** Strips comment markers per line and returns the readable lines of a raw comment block. */
export function commentLines(raw) {
  return raw
    .split('\n')
    .map(line => line.replace(/^\s*(\/\*+|\*+\/|\/\/+|\*+(?!\/))/, '').replace(/\*+\/\s*$/, '').trim());
}

/** Lowercase, marker-free, whitespace-collapsed text: rewrapping or re-indenting a comment never changes it. */
export function normalizeText(text) {
  return text
    .replace(/^[ \t]*\*+(?!\/)/gm, ' ')
    .replace(/\/\*+|\*+\/|\/\/+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function blockId(normalized) {
  return createHash('sha1').update(normalized).digest('hex').slice(0, 12);
}

function looksLikeCode(lines) {
  const filled = lines.filter(Boolean);
  if (filled.length === 0) return false;
  const code = filled.filter(line => CODE_LINE.some(pattern => pattern.test(line))).length;
  return code / filled.length >= 0.5;
}

function wordCount(normalized) {
  return normalized.split(' ').filter(token => /[a-z0-9]/.test(token)).length;
}

/**
 * Returns the block's identity, or the reason it is exempt from the rule.
 * @returns {{skip: string} | {normalized: string, id: string}}
 */
export function classifyBlock(raw) {
  const lines = commentLines(raw);
  const kept = lines.filter(line => !DIRECTIVE_LINE.test(line));
  if (kept.join(' ').trim() === '') return { skip: 'directive' };
  if (LICENSE_TEXT.test(kept.join(' '))) return { skip: 'license' };
  const normalized = normalizeText(kept.join('\n'));
  if (wordCount(normalized) < MIN_WORDS) return { skip: 'label' };
  if (looksLikeCode(kept)) return { skip: 'commented-out code' };
  return { normalized, id: blockId(normalized) };
}

function startFile(files) {
  const file = { oldPath: undefined, ranges: [], added: [], inHunk: false };
  files.push(file);
  return file;
}

function readHunk(file, line) {
  const m = /^@@ -(\d+)(?:,(\d+))? \+/.exec(line);
  file.inHunk = true;
  if (m) file.ranges.push([Number(m[1]), Number(m[1]) + Number(m[2] ?? 1) - 1]);
}

/**
 * Parses `git diff -U0 --no-renames` into the old-file line ranges each hunk removed or rewrote
 * and the text each file gained. Headers only count before a file's first hunk, so an added line
 * that happens to start with `++ ` is content, not a header.
 * @returns {{files: {oldPath: string, ranges: number[][]}[], addedTexts: string[]}}
 */
export function parseDiff(diffText) {
  const parsed = [];
  let file;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) file = startFile(parsed);
    else if (!file) continue;
    else if (line.startsWith('@@')) readHunk(file, line);
    else if (!file.inHunk && line.startsWith('--- ')) file.oldPath = line === '--- /dev/null' ? undefined : line.slice(6);
    else if (file.inHunk && line.startsWith('+')) file.added.push(line.slice(1));
  }
  return {
    files: parsed.filter(f => f.oldPath && SOURCE_FILE.test(f.oldPath)).map(({ oldPath, ranges }) => ({ oldPath, ranges })),
    addedTexts: parsed.map(f => f.added.join('\n')).filter(Boolean),
  };
}

function touched(block, ranges) {
  return ranges.some(([from, to]) => block.endLine >= from && block.startLine <= to);
}

/** Candidate deleted blocks of one old file: blocks overlapping a removed or rewritten line. */
export function deletedBlocks({ oldPath, oldSource, ranges }) {
  const out = [];
  for (const block of extractComments(oldSource)) {
    if (!touched(block, ranges)) continue;
    const identity = classifyBlock(block.text);
    if (!identity.skip) out.push({ file: oldPath, startLine: block.startLine, endLine: block.endLine, ...identity });
  }
  return out;
}

/** Index of what still exists: every current comment block (exact) plus per-text prefix buckets (fragment). */
export function buildCorpus(texts) {
  const blocks = new Set();
  const flat = [];
  for (const { path, text } of texts) {
    if (SOURCE_FILE.test(path)) {
      for (const block of extractComments(text)) {
        const identity = classifyBlock(block.text);
        if (!identity.skip) blocks.add(identity.normalized);
      }
    }
    flat.push(normalizeText(text));
  }
  return { blocks, flat };
}

function prefixIndex(pending) {
  const index = new Map();
  for (const text of pending) {
    const key = text.slice(0, PREFIX_KEY);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(text);
  }
  return index;
}

/** One pass over the corpus: returns the set of pending texts that occur as a substring somewhere. */
export function findSurvivors(pending, flat) {
  const survivors = new Set();
  const index = prefixIndex(pending);
  for (const haystack of flat) {
    for (let pos = 0; pos <= haystack.length - PREFIX_KEY; pos += 1) {
      if (pos > 0 && haystack[pos - 1] !== ' ') continue;
      const candidates = index.get(haystack.slice(pos, pos + PREFIX_KEY));
      if (candidates) for (const text of candidates) if (haystack.startsWith(text, pos)) survivors.add(text);
    }
  }
  return survivors;
}

function shingles(normalized) {
  const words = normalized.split(' ').filter(token => /[a-z0-9]/.test(token));
  const out = [];
  for (let i = 0; i + SHINGLE_WORDS <= words.length; i += 1) out.push(words.slice(i, i + SHINGLE_WORDS).join(' '));
  return out;
}

/** Fraction of the block's 3-word runs that the range's added text still contains: an edit keeps most, a deletion keeps none. */
export function containment(normalized, pool) {
  const runs = shingles(normalized);
  if (runs.length === 0) return 0;
  return runs.filter(run => pool.has(run)).length / runs.length;
}

function shinglePool(addedTexts) {
  return new Set(addedTexts.flatMap(text => shingles(normalizeText(text))));
}

/**
 * @param {{oldPath: string, oldSource: string, ranges: number[][]}[]} files
 * @param {string[]} addedTexts  text of lines the range added
 * @param {{path: string, text: string}[]} currentTexts  current text of every file in all configured repos
 */
export function findLostBlocks({ files, addedTexts, currentTexts }) {
  const candidates = files.flatMap(f => deletedBlocks(f));
  const corpus = buildCorpus([...currentTexts, ...addedTexts.map((text, i) => ({ path: `added-${i}`, text }))]);
  const unmatched = candidates.filter(c => !corpus.blocks.has(c.normalized));
  const survivors = findSurvivors(new Set(unmatched.map(c => c.normalized)), corpus.flat);
  const pool = shinglePool(addedTexts);
  return unmatched.filter(c => !survivors.has(c.normalized) && containment(c.normalized, pool) < EDIT_CONTAINMENT);
}

/** Allow-list: `{ version: 1, allow: [{ id, reason }] }`. A missing reason is an error, never a silent pass. */
export function parseDebt(jsonText) {
  const parsed = JSON.parse(jsonText);
  if (!parsed || !Array.isArray(parsed.allow)) throw new Error('why-comments debt file needs an "allow" array');
  for (const entry of parsed.allow) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      throw new Error(`why-comments debt entry ${JSON.stringify(entry)} needs an "id" and a non-empty "reason"`);
    }
  }
  return new Map(parsed.allow.map(entry => [entry.id, entry.reason]));
}
