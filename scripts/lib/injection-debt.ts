/** Ratchet for the injection rules (L5/L6/L7), keyed by file + specifier + kind. Line numbers are
 * deliberately not part of the key: they shift in unrelated edits. A key missing from the debt file,
 * or one whose count rose, fails; a lower count only warns so the entry can be removed. CI never
 * regenerates the file (same contract as hardwiring-debt.json). */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Finding { rule: string; file: string; spec: string; kind: string; reason: string }
export interface DebtEntry { rule: string; file: string; spec: string; kind: string; count: number; lane: string }
export interface InjectionException { owner: string; target: string; specGlob: string; ownerQuestion: string; approved: string; note: string }
export interface DebtViolation { rule: string; file: string; reason: string }

export const keyOf = (item: { rule: string; file: string; spec: string; kind: string }): string =>
  [item.rule, item.file, item.spec, item.kind].join('\u0000');

function readList<T>(required: { path: string; field: string }, _optional: Record<string, never> = {}): T[] {
  if (!existsSync(required.path)) return [];
  const parsed = JSON.parse(readFileSync(required.path, 'utf8')) as Record<string, unknown>;
  return Array.isArray(parsed[required.field]) ? parsed[required.field] as T[] : [];
}

export function loadDebt(required: { root: string }, _optional: Record<string, never> = {}): DebtEntry[] {
  return readList<DebtEntry>({ path: join(required.root, 'scripts', 'injection-debt.json'), field: 'entries' });
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

function reportStale(required: { debt: readonly DebtEntry[]; found: ReturnType<typeof countByKey>; warn: (message: string) => void }): void {
  const stale = required.debt.filter(entry => (required.found.get(keyOf(entry))?.count ?? 0) < entry.count);
  if (stale.length === 0) return;
  required.warn(`injection debt: stale, remove or lower ${stale.length} entries: ${stale.slice(0, 5).map(entry => `${entry.file} ${entry.spec}`).join('; ')}${stale.length > 5 ? '; …' : ''}`);
}

export function applyDebt(
  required: { findings: readonly Finding[]; debt: readonly DebtEntry[] },
  { warn = (message: string): void => console.warn(message) }: { warn?: (message: string) => void } = {},
): DebtViolation[] {
  const allowed = new Map(required.debt.map(entry => [keyOf(entry), entry.count]));
  const found = countByKey(required.findings);
  const violations: DebtViolation[] = [];
  for (const [key, { first, count }] of found) {
    const debt = allowed.get(key) ?? 0;
    if (count <= debt) continue;
    const why = debt === 0 ? 'not in injection-debt.json' : `${count} sites exceed the debt of ${debt}`;
    violations.push({ rule: first.rule, file: first.file, reason: `${first.reason} (${why})` });
  }
  reportStale({ debt: required.debt, found, warn });
  return violations;
}
