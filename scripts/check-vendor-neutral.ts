/**
 * R15 — vendor neutrality of the daemon core and the server preset.
 *
 * `packages/daemon/src/**` and `packages/server/src/**` must not name a vendor CLI or model family
 * (`codex|claude|opencode|gemini|antigravity|xai|grok`, any case). Vendor behaviour lives in
 * `packages/agent-runtime/src/defs/<cli>/` and the provider plugins, and reaches the daemon only through
 * `AgentRuntimePort['strategies']`. The vendor code that still sits in the daemon moves out in K02-K05, so this
 * check is a shrink-only ratchet until then:
 *  - `scripts/vendor-neutral-debt.json` lists the hit count of every file that has hits today;
 *  - a file that is not listed, or whose count went up, is a violation;
 *  - a count that went down, or a listed file that is gone or clean, prints a reminder to tighten the file
 *    (`node --import tsx scripts/check-vendor-neutral.ts --tighten`, which only ever lowers a count);
 *  - `scripts/vendor-neutral-allowlist.json` names files whose COMMENT-ONLY mentions explain migration history.
 *    A hit on a code line (import, identifier, string, registration) is never allowlisted.
 *
 * Scope: non-test source. `__tests__/`, `*.test.*`, `*.typecheck.*` and `__mocks__/` are excluded because a
 * test names a vendor as fixture data; the tests move with the code they cover.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Violation } from './check-engine-boundaries.js';

const RULE = 'R15-vendor-neutral';
const SCRIPTS_DIR = join(fileURLToPath(import.meta.url), '..');
const DEBT_FILE = join(SCRIPTS_DIR, 'vendor-neutral-debt.json');
const ALLOWLIST_FILE = join(SCRIPTS_DIR, 'vendor-neutral-allowlist.json');
const VENDOR_PATTERN = /codex|claude|opencode|gemini|antigravity|xai|grok/gi;
const DEFAULT_ROOTS = ['packages/daemon/src', 'packages/server/src'] as const;
const SOURCE_FILE = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/;
const TEST_FILE = /(?:\.test\.|\.spec\.|\.typecheck\.|\.d\.ts$)/;
const TEST_DIRS = new Set(['__tests__', '__mocks__', 'node_modules', 'dist']);

export interface VendorNeutralOptions {
  /** Repo-relative roots to scan. Default: daemon and server `src`. */
  readonly roots?: readonly string[];
  /** Repo-relative file to allowed hit count. Default: `scripts/vendor-neutral-debt.json`. */
  readonly debt?: Readonly<Record<string, number>>;
  /** Repo-relative files whose comment-only hits do not count. Default: `scripts/vendor-neutral-allowlist.json`. */
  readonly allowlist?: readonly string[];
  /** Receives each tighten-the-debt reminder. Default: stdout. */
  readonly onReminder?: (message: string) => void;
}

function sourceFiles({ dir }: { dir: string }, _optional: Record<string, never> = {}): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return TEST_DIRS.has(entry.name) ? [] : sourceFiles({ dir: path });
    return SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name) ? [path] : [];
  });
}

const isCommentLine = (line: string): boolean => /^\s*(?:\/\/|\/\*|\*)/.test(line);

/** Vendor-name hits in one file's text; comment-only lines are skipped when `commentsAllowed`. O(bytes). */
export function countVendorHits({ text, commentsAllowed }: { text: string; commentsAllowed: boolean }, _optional: Record<string, never> = {}): number {
  return text.split('\n').reduce((sum, line) => (commentsAllowed && isCommentLine(line) ? sum : sum + (line.match(VENDOR_PATTERN)?.length ?? 0)), 0);
}

function readJson<T>({ file, fallback }: { file: string; fallback: T }, _optional: Record<string, never> = {}): T {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback;
}

/** Current hit counts for every scanned file that has any. */
export function collectVendorHits({ repoRoot }: { repoRoot: string }, { roots = DEFAULT_ROOTS, allowlist = readJson({ file: ALLOWLIST_FILE, fallback: { files: [] as string[] } }).files }: Pick<VendorNeutralOptions, 'roots' | 'allowlist'> = {}): Record<string, number> {
  const hits: Record<string, number> = {};
  for (const root of roots) {
    for (const path of sourceFiles({ dir: join(repoRoot, root) })) {
      const file = relative(repoRoot, path).split('\\').join('/');
      const count = countVendorHits({ text: readFileSync(path, 'utf8'), commentsAllowed: allowlist.includes(file) });
      if (count > 0) hits[file] = count;
    }
  }
  return hits;
}

/** Violations plus reminders for one comparison of current hits against the debt. */
function compareToDebt({ hits, debt }: { hits: Record<string, number>; debt: Readonly<Record<string, number>> }, _optional: Record<string, never> = {}): { violations: Violation[]; reminders: string[] } {
  const violations: Violation[] = [];
  const reminders: string[] = [];
  for (const [file, count] of Object.entries(hits)) {
    const allowed = debt[file];
    if (allowed === undefined) violations.push({ rule: RULE, file, reason: `${count} vendor-name hit(s) in a file with no recorded debt. Name no vendor here: bind the behaviour in agent-runtime's defs and read it from AgentRuntimePort strategies.` });
    else if (count > allowed) violations.push({ rule: RULE, file, reason: `vendor-name hits rose from ${allowed} to ${count}. The debt only shrinks.` });
    else if (count < allowed) reminders.push(`${file}: ${allowed} -> ${count}`);
  }
  for (const file of Object.keys(debt)) if (hits[file] === undefined) reminders.push(`${file}: ${debt[file]} -> 0`);
  return { violations, reminders };
}

export function checkVendorNeutral({ repoRoot }: { repoRoot: string }, options: VendorNeutralOptions = {}): Violation[] {
  const allowlist = options.allowlist ?? readJson({ file: ALLOWLIST_FILE, fallback: { files: [] as string[] } }).files;
  const debt = options.debt ?? readJson({ file: DEBT_FILE, fallback: { files: {} as Record<string, number> } }).files;
  const hits = collectVendorHits({ repoRoot }, { allowlist, ...(options.roots ? { roots: options.roots } : {}) });
  const { violations, reminders } = compareToDebt({ hits, debt });
  const report = options.onReminder ?? ((message: string) => console.log(message));
  if (reminders.length > 0) report(`[guard] ${RULE}: debt shrank, tighten scripts/vendor-neutral-debt.json (node --import tsx scripts/check-vendor-neutral.ts --tighten):\n  ${reminders.join('\n  ')}`);
  return violations;
}

/** Writes the debt file with every count lowered to today's, dropping clean files; a count is never raised. */
export function tightenDebt({ repoRoot }: { repoRoot: string }, _optional: Record<string, never> = {}): void {
  const current = readJson({ file: DEBT_FILE, fallback: { files: {} as Record<string, number> } }).files;
  const hits = collectVendorHits({ repoRoot });
  const files = Object.fromEntries(Object.entries(current).flatMap(([file, allowed]) => (hits[file] === undefined ? [] : [[file, Math.min(allowed, hits[file])]])));
  writeFileSync(DEBT_FILE, JSON.stringify({ _comment: readJson({ file: DEBT_FILE, fallback: { _comment: '' } })._comment, files }, null, 2) + '\n');
}

/** Writes the first debt file from today's hits. Refuses to overwrite one: raising debt is never a tooling action. */
export function seedDebt({ repoRoot }: { repoRoot: string }, _optional: Record<string, never> = {}): void {
  if (existsSync(DEBT_FILE)) throw new Error('vendor-neutral-debt.json already exists; use --tighten to lower it');
  const files = Object.fromEntries(Object.entries(collectVendorHits({ repoRoot })).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(DEBT_FILE, JSON.stringify({ files }, null, 2) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const repoRoot = join(SCRIPTS_DIR, '..');
  if (process.argv.includes('--seed')) seedDebt({ repoRoot });
  else if (process.argv.includes('--tighten')) tightenDebt({ repoRoot });
  else {
    const violations = checkVendorNeutral({ repoRoot });
    for (const v of violations) console.error(`[guard] ${v.rule} ${v.file}: ${v.reason}`);
    process.exit(violations.length ? 1 : 0);
  }
}
