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
  return [{ rule: 'injection-debt-stale', file: DEBT_FILE, reason: `lower or remove ${stale.length} allowances above what is found: ${listed(stale)}` }];
}

/** The trusted base's debt entries; null when the base has no debt file yet. Fails closed when git cannot read the base. */
export function gitDebtBase(required: { root: string }, _optional: Record<string, never> = {}): DebtEntry[] | null {
  const base = debtAtBase({ root: required.root, file: DEBT_FILE }, {
    baseRef: process.env.INJECTION_BASE_REF || 'HEAD', firstCommit: process.env.INJECTION_FIRST_PUSH_COMMIT || '',
  }) as { entries?: DebtEntry[] } | null;
  return base ? base.entries ?? [] : null;
}

/** A key the base did not allow, or a count above the base's, is growth: the debt file only shrinks. */
export function debtGrowth(required: { base: readonly DebtEntry[] | null; debt: readonly DebtEntry[] }, _optional: Record<string, never> = {}): DebtViolation[] {
  if (!required.base) return [];
  const allowed = new Map(required.base.map(entry => [keyOf(entry), entry.count]));
  const grown = required.debt.filter(entry => entry.count > (allowed.get(keyOf(entry)) ?? 0));
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
