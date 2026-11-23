/** Ratchet for the injection rules (L5/L6/L7), keyed by file + specifier + kind. Line numbers are
 * deliberately not part of the key: they shift in unrelated edits. A key missing from the debt file,
 * or one whose count rose, fails; so does an allowance above what is found (stale: lower or remove
 * it, or the room it leaves lets the import return). The debt file itself may only shrink against the
 * trusted base commit (same contract as the complexity ratchet); CI never regenerates it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { debtAtBase } from './debt-base.mjs';

const DEBT_FILE = 'scripts/injection-debt.json';

export interface Finding { rule: string; file: string; spec: string; kind: string; reason: string }
export interface DebtEntry { rule: string; file: string; spec: string; kind: string; count: number; lane: string }
export interface InjectionException { owner: string; target: string; specGlob: string; ownerQuestion: string; approved: string; note: string }
export interface DebtViolation { rule: string; file: string; reason: string }
/** GC.1/GC.2: the approved Core/Protocol runtime pairs (`<exports key as a spec>#<export>`), the rules whose
 * one-time seed has happened (the marker outlives the last entry), and the SHA the seed was captured at. */
export interface DebtMetadata { approvedRuntime: string[]; initialized: string[]; seedSha: string }
export interface DebtFile { _comment?: string; metadata?: DebtMetadata; entries: DebtEntry[] }
/** Rules a first capture may seed (Gate C1, C3). Every other rule's keys only shrink. */
export const BOOTSTRAP_RULES: readonly string[] = ['L5-resolved', 'XP4-runtime'];

export const keyOf = (item: { rule: string; file: string; spec: string; kind: string }, _optional: Record<string, never> = {}): string =>
  [item.rule, item.file, item.spec, item.kind].join('\u0000');

function readList<T>(required: { path: string; field: string }, _optional: Record<string, never> = {}): T[] {
  if (!existsSync(required.path)) return [];
  const parsed = JSON.parse(readFileSync(required.path, 'utf8')) as Record<string, unknown>;
  return Array.isArray(parsed[required.field]) ? parsed[required.field] as T[] : [];
}

export function loadDebt(required: { root: string }, _optional: Record<string, never> = {}): DebtEntry[] {
  return readList<DebtEntry>({ path: join(required.root, DEBT_FILE), field: 'entries' });
}

/** The whole debt file, metadata included; an absent file is an empty ledger. */
export function loadDebtFile(required: { root: string }, _optional: Record<string, never> = {}): DebtFile {
  const path = join(required.root, DEBT_FILE);
  if (!existsSync(path)) return { entries: [] };
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as DebtFile;
  return { ...parsed, entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
}

/** A base read from git or a test double: an entries array (pre-metadata form), a whole file, or null. */
export function asDebtFile(base: readonly DebtEntry[] | DebtFile | null, _optional: Record<string, never> = {}): DebtFile | null {
  if (base === null) return null;
  return Array.isArray(base) ? { entries: [...base] } : base as DebtFile;
}

const FILE_KEYS = new Set(['_comment', 'metadata', 'entries']);
const METADATA_KEYS = new Set(['approvedRuntime', 'initialized', 'seedSha']);
const isSortedUnique = (list: readonly string[]): boolean => list.every((item, index) => index === 0 || list[index - 1]! < item);

function metadataProblems(metadata: DebtMetadata): string[] {
  const problems = Object.keys(metadata).filter(key => !METADATA_KEYS.has(key)).map(key => `unknown metadata key ${key}`);
  if (!Array.isArray(metadata.approvedRuntime) || !isSortedUnique(metadata.approvedRuntime)) problems.push('metadata.approvedRuntime must be a sorted, unique list');
  if (!Array.isArray(metadata.initialized) || metadata.initialized.some(rule => !BOOTSTRAP_RULES.includes(rule))) problems.push('metadata.initialized holds only bootstrap rule ids');
  if (typeof metadata.seedSha !== 'string' || !metadata.seedSha) problems.push('metadata.seedSha is required');
  return problems;
}

/** Schema problems in the head debt file, plus initialized markers the base had and the head dropped. */
export function debtFileViolations(required: { file: DebtFile; base: DebtFile | null }, _optional: Record<string, never> = {}): DebtViolation[] {
  const { file, base } = required;
  const problems = Object.keys(file).filter(key => !FILE_KEYS.has(key)).map(key => `unknown top-level key ${key}`);
  if (file.metadata) problems.push(...metadataProblems(file.metadata));
  const keys = file.entries.map(entry => keyOf(entry));
  if (new Set(keys).size !== keys.length) problems.push('duplicate entry keys');
  if (file.entries.some(entry => !Number.isInteger(entry.count) || entry.count < 1)) problems.push('every count is a positive integer');
  const dropped = (base?.metadata?.initialized ?? []).filter(rule => !(file.metadata?.initialized ?? []).includes(rule));
  if (dropped.length > 0) problems.push(`initialized markers persist after the last entry: restore ${dropped.join(', ')}`);
  return problems.length === 0 ? [] : [{ rule: 'injection-debt-invalid', file: DEBT_FILE, reason: problems.join('; ') }];
}

export function loadExceptions(required: { root: string }, _optional: Record<string, never> = {}): InjectionException[] {
  return readList<InjectionException>({ path: join(required.root, 'scripts', 'injection-exceptions.json'), field: 'exceptions' });
}

/** A glob without `*` names a package or entry and covers its subpaths; with `*` it is a pattern. */
export function specMatches(required: { glob: string; spec: string }, _optional: Record<string, never> = {}): boolean {
  const { glob, spec } = required;
  if (!glob.includes('*')) return spec === glob || spec.startsWith(`${glob}/`);
  const escaped = glob.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${escaped}$`).test(spec);
}

function countByKey(findings: readonly Finding[]): Map<string, { first: Finding; count: number }> {
  const found = new Map<string, { first: Finding; count: number }>();
  for (const finding of findings) {
    const slot = found.get(keyOf(finding));
    if (slot) slot.count += 1;
    else found.set(keyOf(finding), { first: finding, count: 1 });
  }
  return found;
}

const listed = (entries: readonly DebtEntry[]): string =>
  `${entries.slice(0, 5).map(entry => `${entry.file} ${entry.spec} (${entry.kind})`).join('; ')}${entries.length > 5 ? '; …' : ''}`;

function staleViolations(required: { debt: readonly DebtEntry[]; found: ReturnType<typeof countByKey> }): DebtViolation[] {
  const stale = required.debt.filter(entry => (required.found.get(keyOf(entry))?.count ?? 0) < entry.count);
  if (stale.length === 0) return [];
  return [{ rule: 'injection-debt-stale', file: DEBT_FILE, reason: `update baseline: lower or remove ${stale.length} allowances above what is found: ${listed(stale)}` }];
}

/** The trusted base's debt entries; null when the base has no debt file yet. Fails closed when git cannot read the base. */
export function gitDebtBase(required: { root: string }, _optional: Record<string, never> = {}): DebtFile | null {
  const base = debtAtBase({ root: required.root, file: DEBT_FILE }, baseRefOptions()) as DebtFile | null;
  return base ? { ...base, entries: base.entries ?? [] } : null;
}

/** INJECTION_BASE_REF / INJECTION_FIRST_PUSH_COMMIT, the trusted base CI passes in. */
export const baseRefOptions = (_optional: Record<string, never> = {}): { baseRef: string; firstCommit: string } =>
  ({ baseRef: process.env.INJECTION_BASE_REF || 'HEAD', firstCommit: process.env.INJECTION_FIRST_PUSH_COMMIT || '' });

/** C3: a bootstrap rule may seed new keys once — when the base has no entry and no initialized marker for it
 * and the head marks it initialized. Exactness comes from `applyDebt` (no missing key) plus the stale check
 * (no slack), so a seed can only equal the live findings. */
function seeding(required: { base: DebtFile; head: DebtMetadata | undefined }): Set<string> {
  const initializedAtBase = new Set(required.base.metadata?.initialized ?? []);
  return new Set(BOOTSTRAP_RULES.filter(rule => (required.head?.initialized ?? []).includes(rule) && !initializedAtBase.has(rule)
    && !required.base.entries.some(entry => entry.rule === rule)));
}

/** A key the base did not allow, or a count above the base's, is growth: the debt file only shrinks. */
export function debtGrowth(required: { base: readonly DebtEntry[] | DebtFile | null; debt: readonly DebtEntry[] }, optional: { metadata?: DebtMetadata } = {}): DebtViolation[] {
  const base = asDebtFile(required.base);
  if (!base) return [];
  const allowed = new Map(base.entries.map(entry => [keyOf(entry), entry.count]));
  const seeds = seeding({ base, head: optional.metadata });
  const grown = required.debt.filter(entry => !seeds.has(entry.rule) && entry.count > (allowed.get(keyOf(entry)) ?? 0));
  if (grown.length === 0) return [];
  return [{ rule: 'injection-debt-growth', file: DEBT_FILE, reason: `${grown.length} allowances are new or higher than at the base commit: ${listed(grown)}` }];
}

export function applyDebt(required: { findings: readonly Finding[]; debt: readonly DebtEntry[] }, _optional: Record<string, never> = {}): DebtViolation[] {
  const allowed = new Map(required.debt.map(entry => [keyOf(entry), entry.count]));
  const found = countByKey(required.findings);
  const violations: DebtViolation[] = [];
  for (const [key, { first, count }] of found) {
    const debt = allowed.get(key) ?? 0;
    if (count <= debt) continue;
    const why = debt === 0 ? 'not in injection-debt.json' : `${count} sites exceed the debt of ${debt}`;
    violations.push({ rule: first.rule, file: first.file, reason: `${first.reason} (${why})` });
  }
  return [...violations, ...staleViolations({ debt: required.debt, found })];
}
