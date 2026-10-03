/**
 * @module verify
 *
 * Deterministic, programmatic enforcement of a "self-verify scorecard"
 * contract: after a turn that produced output and has active checkable
 * rules, evaluate whether the output's scorecard actually covers every
 * active rule and whether every row passed. Pure — no I/O, no clock, no
 * model call — `enforceVerify` is fully unit-testable.
 *
 * The scorecard's on-the-wire shape (how it's embedded in the output text)
 * is host-specific, so it is never parsed here: the host supplies
 * `extractScorecard`, a function from raw output text to a
 * {@link VerifyScorecard} or `null` when none is present. Everything else —
 * rule-to-row coverage matching, pass/fail/missing verdicts, the bounded
 * record log — is generic.
 */
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

export interface ActiveRuleForVerify {
  name: string;
  /** The rule's checkable rubric line, if any. */
  check?: string;
}

/**
 * Closed set of recognized row statuses. Any other value — `'error'`,
 * `'unknown'`, `'FAIL'`, empty string, or anything else a model might
 * emit — is not a valid pass and must not be treated as one; see
 * `isValidRowStatus`/`enforceVerify`.
 */
export type VerifyScorecardRowStatus = 'pass' | 'fail';

export interface VerifyScorecardRow {
  /** The row's own text — restates (in the model's words) which rule it addresses. */
  rule: string;
  status: VerifyScorecardRowStatus;
}

export interface VerifyScorecard {
  status?: string;
  rows: VerifyScorecardRow[];
}

export interface EnforceVerifyInput {
  /** The full turn output to scan for a scorecard. */
  assistantOutput: string;
  /** Active checkable rules at enforcement time. */
  activeRules: ActiveRuleForVerify[];
  /** Whether the turn produced the kind of output enforcement scopes to. */
  hadArtifact: boolean;
  /** Master enable switch — when false, enforcement is skipped outright. */
  verifyEnabled: boolean;
  /** Host-supplied extraction of a scorecard from `assistantOutput`, or `null` if absent. */
  extractScorecard: (required: { output: string }) => VerifyScorecard | null;
}

export type VerifyStatus = 'skipped' | 'missing' | 'fail' | 'pass';

export interface VerifyResult {
  status: VerifyStatus;
  skipReason?: 'verify-disabled' | 'no-rules' | 'no-artifact';
  rulesActive: number;
  rulesCovered: number;
  uncoveredRules: string[];
  scorecardStatus?: string;
  rowsTotal: number;
  rowsFailed: number;
  hadArtifact: boolean;
}

export interface VerifyRecord extends VerifyResult {
  id: string;
  at: number;
  runId?: string;
  contextId?: string | null;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'must', 'should', 'have',
  'from', 'into', 'when', 'then', 'than', 'your', 'over', 'every',
  'check', 'verify', 'rule', 'future', 'artifacts', 'satisfy', 'ensure',
]);

function significantWords(value: string): Set<string> {
  const words = value
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  return new Set(words);
}

/**
 * Runtime guard for `VerifyScorecardRow.status`: a host's `extractScorecard`
 * parses freeform model output, so the TypeScript type alone does not stop
 * an unrecognized value (`'error'`, `'unknown'`, wrong case, empty string,
 * ...) from reaching here at runtime. Only an exact, recognized value
 * counts as valid — everything else is treated as a failure, never as a
 * silent pass.
 * @internal
 */
function isValidRowStatus(status: unknown): status is VerifyScorecardRowStatus {
  return status === 'pass' || status === 'fail';
}

/**
 * A scorecard row covers a rule when the row shares enough signal with the
 * rule's name or check: a direct substring containment, or at least two
 * shared significant words (lenient on purpose — models paraphrase). This
 * per-pair test is intentionally fuzzy (see the module-level caveat on
 * `enforceVerify`'s unique row-consumption); it decides whether a
 * *candidate* row/rule pair matches, not whether the mapping as a whole is
 * unambiguous.
 * @internal
 */
function rowCoversRule(rowText: string, rule: ActiveRuleForVerify): boolean {
  const row = rowText.toLowerCase().trim();
  if (!row) return false;
  const name = rule.name.toLowerCase().trim();
  const check = (rule.check ?? '').toLowerCase().trim();
  if (name.length >= 5 && (row.includes(name) || name.includes(row))) return true;
  if (check.length >= 8 && (row.includes(check) || check.includes(row))) return true;
  const rowWords = significantWords(rowText);
  const ruleWords = significantWords(`${rule.name} ${rule.check ?? ''}`);
  let shared = 0;
  for (const w of rowWords) {
    if (ruleWords.has(w)) shared += 1;
    if (shared >= 2) return true;
  }
  return false;
}

/**
 * Deterministically evaluate the self-verify contract for one turn.
 *
 * Two fail-closed properties (2026-07-21 security review, SEC-RB-007):
 *  - A row whose `status` is not exactly `'pass'` or `'fail'` (wrong case,
 *    `'error'`, `'unknown'`, or any other value a model might emit) counts
 *    as a failed row, never as a silent pass.
 *  - Each row can satisfy at most one active rule: rules are matched
 *    against rows in order and a matched row is removed from the pool, so
 *    one vague/generic row can no longer be counted as covering several
 *    distinct required rules simultaneously. The underlying per-pair test
 *    (`rowCoversRule`) is still a fuzzy substring/word-overlap heuristic —
 *    this only removes the many-rules-from-one-row failure mode, it does
 *    not add a fully explicit, stable rule-ID-to-evidence mapping. That
 *    larger redesign (rule IDs instead of prose matching) is out of scope
 *    here; see the paired test asserting the current heuristic's limits.
 *
 * @param input - The turn output, active rules, artifact/enable flags, and
 *   the host's scorecard extractor.
 * @returns The verify verdict.
 */
export function enforceVerify(input: EnforceVerifyInput): VerifyResult {
  const activeRules = input.activeRules;
  const base: VerifyResult = {
    status: 'skipped',
    rulesActive: activeRules.length,
    rulesCovered: 0,
    uncoveredRules: [],
    rowsTotal: 0,
    rowsFailed: 0,
    hadArtifact: input.hadArtifact,
  };

  if (!input.verifyEnabled) return { ...base, status: 'skipped', skipReason: 'verify-disabled' };
  if (activeRules.length === 0) return { ...base, status: 'skipped', skipReason: 'no-rules' };
  if (!input.hadArtifact) return { ...base, status: 'skipped', skipReason: 'no-artifact' };

  const scorecard = input.extractScorecard({ output: input.assistantOutput });
  if (!scorecard || !Array.isArray(scorecard.rows)) {
    return { ...base, status: 'missing', uncoveredRules: activeRules.map((r) => r.name) };
  }

  const rows = scorecard.rows;
  const rowsFailed = rows.filter((r) => !isValidRowStatus(r.status) || r.status === 'fail').length;

  // Unique rule-to-row consumption: once a row has been used to cover a
  // rule, it is removed from the pool for subsequent rules.
  const usedRowIndices = new Set<number>();
  const uncoveredRules: string[] = [];
  for (const rule of activeRules) {
    let covered = false;
    for (let i = 0; i < rows.length; i++) {
      if (usedRowIndices.has(i)) continue;
      if (rowCoversRule(rows[i]!.rule, rule)) {
        usedRowIndices.add(i);
        covered = true;
        break;
      }
    }
    if (!covered) uncoveredRules.push(rule.name);
  }
  const rulesCovered = activeRules.length - uncoveredRules.length;
  const status: VerifyStatus = rowsFailed > 0 || uncoveredRules.length > 0 ? 'fail' : 'pass';

  return {
    status,
    rulesActive: activeRules.length,
    rulesCovered,
    uncoveredRules,
    ...(scorecard.status !== undefined ? { scorecardStatus: scorecard.status } : {}),
    rowsTotal: rows.length,
    rowsFailed,
    hadArtifact: true,
  };
}

export interface VerifyLog {
  readonly events: EventEmitter;
  record(required: { result: VerifyResult }, meta?: { runId?: string; contextId?: string | null }): VerifyRecord | null;
  list(): VerifyRecord[];
  remove(required: { id: string }): number;
  clear(): number;
}

const MAX_RECORDS = 20;

/**
 * Construct a bounded verify-outcome log with its own event emitter.
 * `skipped` outcomes are never persisted — this is a UX surface for
 * enforcement that had something to check, not a per-turn audit log.
 *
 * @returns A fresh, independent `VerifyLog`.
 */
export function createVerifyLog(_required: Record<string, never>, optional: { now?: () => number; ids?: () => string; defer?: (required: { callback: () => void }) => void } = {}): VerifyLog {
  const nowMs = optional.now ?? Date.now;
  const nextId = optional.ids ?? randomUUID;
  const defer = optional.defer ?? (({ callback }: { callback: () => void }) => { setImmediate(callback); });
  const records: VerifyRecord[] = [];
  const events = new EventEmitter();
  events.setMaxListeners(64);

  function emit(record: VerifyRecord | { id: string; status: string; at: number }): void {
    defer({ callback: () => {
      try {
        events.emit('verify', { ...record });
      } catch {
        // A listener throwing is not this module's problem.
      }
    } });
  }

  function record({ result }: { result: VerifyResult }, meta: { runId?: string; contextId?: string | null } = {}): VerifyRecord | null {
    if (result.status === 'skipped') return null;
    const rec: VerifyRecord = {
      ...result,
      id: nextId(),
      at: nowMs(),
      ...(meta.runId ? { runId: meta.runId } : {}),
      ...(meta.contextId !== undefined ? { contextId: meta.contextId } : {}),
    };
    records.unshift(rec);
    if (records.length > MAX_RECORDS) records.length = MAX_RECORDS;
    emit(rec);
    return rec;
  }

  function list(): VerifyRecord[] {
    return records.map((r) => ({ ...r }));
  }

  function remove({ id }: { id: string }): number {
    const idx = records.findIndex((r) => r.id === id);
    if (idx < 0) return 0;
    records.splice(idx, 1);
    emit({ id, status: 'deleted', at: nowMs() });
    return 1;
  }

  function clear(): number {
    const removed = records.length;
    records.length = 0;
    if (removed > 0) emit({ id: 'all', status: 'cleared', at: nowMs() });
    return removed;
  }

  return { events, record, list, remove, clear };
}
