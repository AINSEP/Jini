/**
 * @file `RedirectMatcher` implementation (SPEC-009 REQ-07/19/20/22;
 * behavior.spec.md §1, §2, §4, §7).
 *
 * Purpose:
 * Pure, bounded, no-I/O matching of a request path against a set of redirect
 * rules: match-type precedence (`exact` > `prefix` (longest) > `wildcard`),
 * the priority/recency/id tie-break chain, and wildcard capture
 * interpolation. Also owns `validatePattern`, the write-time pattern safety
 * gate that hard-rejects `matchType: 'regex'` in v1 (REQ-22/INV-05).
 *
 * How it relates to the project:
 * `phase-handler.ts` (C-006) gathers phase-eligible candidate rules from
 * `RedirectRepoPort` (exact/prefix/dynamic lookups) into one array and hands
 * them to `match()`, which applies the FULL precedence + tie-break logic
 * itself — this keeps every precedence/tie-break rule in one pure,
 * exhaustively unit-testable place (matcher.test.ts), rather than splitting
 * it between the repo adapters and this file. `RedirectRepoPort.lookupExact`/
 * `lookupLongestPrefix`/`listDynamic` remain index-backed *retrieval*
 * optimizations for the real request-serving hot path; they do not need to
 * duplicate this file's tie-break logic since `match()` re-derives the
 * correct winner regardless of the input array's order (idempotent to
 * already-sorted input, matching behavior.spec.md §2.2's "never re-sort what
 * the repo returns" invariant for the already-optimal case).
 *
 * Architectural role: INTERNAL SEAM (not an ADR-006 port, see `ports.ts`'s
 * file header) — pure functions only, no I/O.
 */
import type { RedirectMatcher } from "./ports.js";
import type { RedirectMatchType, RedirectRecord, RedirectRequest, RedirectResolution } from "./types.js";

const MIN_PATTERN_LENGTH = 1;
const MAX_PATTERN_LENGTH = 2048;

/** Precedence order, highest first — index doubles as the sort key. */
const PRECEDENCE_ORDER: Readonly<Record<RedirectMatchType, number>> = {
  exact: 0,
  prefix: 1,
  wildcard: 2,
  regex: 3, // never actually reachable — validatePattern always rejects it at write time.
};

export interface ValidatePatternRequired {
  matchType: RedirectMatchType;
  fromPattern: string;
}

/**
 * Write-time pattern safety gate (REQ-07/19/20/22). Total — never throws.
 *
 * @complexity O(1).
 */
export function validatePattern(
  required: ValidatePatternRequired,
  _optional: Record<string, never> = {},
): { ok: true } | { ok: false; reason: string } {
  const { matchType, fromPattern } = required;

  if (matchType === "regex") {
    return { ok: false, reason: "matchType 'regex' is not enabled in v1 (REQ-22)" };
  }

  const length = fromPattern.length;
  if (length < MIN_PATTERN_LENGTH || length > MAX_PATTERN_LENGTH) {
    return {
      ok: false,
      reason: `fromPattern must be ${MIN_PATTERN_LENGTH}-${MAX_PATTERN_LENGTH} characters (got ${length})`,
    };
  }

  if (!fromPattern.startsWith("/")) {
    return { ok: false, reason: "fromPattern must start with '/'" };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Candidate matching per match type (internal)
// ---------------------------------------------------------------------------

interface CandidateMatch {
  rule: RedirectRecord;
  /** Fully-interpolated destination (captures/tail already applied). */
  location: string;
  /** Higher = more specific within its own match-type band (used only for the wildcard tie-break). */
  specificity: number;
}

function matchExact(rule: RedirectRecord, path: string): CandidateMatch | null {
  if (rule.matchType !== "exact") return null;
  if (rule.fromPattern !== path) return null;
  return { rule, location: rule.toTarget, specificity: rule.fromPattern.length };
}

function matchPrefix(rule: RedirectRecord, path: string): CandidateMatch | null {
  if (rule.matchType !== "prefix") return null;
  const pattern = rule.fromPattern;
  const isExactPrefix = path === pattern;
  const isNestedPrefix = path.startsWith(pattern.endsWith("/") ? pattern : `${pattern}/`);
  if (!isExactPrefix && !isNestedPrefix) return null;
  const tail = isExactPrefix ? "" : path.slice(pattern.length);
  return { rule, location: `${rule.toTarget}${tail}`, specificity: pattern.length };
}

/** Compile a `*`-glob wildcard pattern into an anchored, non-backtracking capture regex. */
function compileWildcard(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const withCaptures = escaped.replace(/\*/g, "([^/]+)");
  return new RegExp(`^${withCaptures}$`);
}

function interpolate(template: string, captures: string[]): string {
  return template.replace(/\$(\d+)/g, (whole, indexStr: string) => {
    const index = Number(indexStr) - 1;
    return index >= 0 && index < captures.length ? captures[index]! : whole;
  });
}

function matchWildcard(rule: RedirectRecord, path: string): CandidateMatch | null {
  if (rule.matchType !== "wildcard") return null;
  const regex = compileWildcard(rule.fromPattern);
  const result = regex.exec(path);
  if (!result) return null;
  const captures = result.slice(1);
  return {
    rule,
    location: interpolate(rule.toTarget, captures),
    specificity: rule.fromPattern.length,
  };
}

function matchOne(rule: RedirectRecord, path: string): CandidateMatch | null {
  switch (rule.matchType) {
    case "exact":
      return matchExact(rule, path);
    case "prefix":
      return matchPrefix(rule, path);
    case "wildcard":
      return matchWildcard(rule, path);
    case "regex":
      // Deferred (ADR-033 §8) — never authored in v1 (validatePattern rejects it at write
      // time), so no live rule should ever carry this matchType. Defensive no-match.
      return null;
    default:
      return null;
  }
}

/**
 * Tie-break comparator (behavior.spec.md §2.1/§6.1): higher `priority` wins;
 * else more recent `updatedAt` (falling back to `createdAt`) wins; else the
 * lexicographically smaller `id` wins. Returns <0 if `a` should win over `b`.
 */
function compareTieBreak(a: CandidateMatch, b: CandidateMatch): number {
  if (a.rule.priority !== b.rule.priority) return b.rule.priority - a.rule.priority;
  const aRecency = a.rule.updatedAt || a.rule.createdAt;
  const bRecency = b.rule.updatedAt || b.rule.createdAt;
  if (aRecency !== bRecency) return aRecency > bRecency ? -1 : 1;
  return a.rule.id < b.rule.id ? -1 : a.rule.id > b.rule.id ? 1 : 0;
}

/** Within a precedence band, longest/most-specific `fromPattern` wins first, then the tie-break chain. */
function compareWithinBand(a: CandidateMatch, b: CandidateMatch): number {
  if (a.specificity !== b.specificity) return b.specificity - a.specificity;
  return compareTieBreak(a, b);
}

export interface MatchRequired {
  request: RedirectRequest;
  rules: RedirectRecord[];
}

/**
 * Resolve the highest-precedence, tie-broken match for `request.path` among
 * `rules` (behavior.spec.md §1.1, §2.1, §2.2, §6.1). Total — never throws.
 *
 * @complexity O(n) in `rules.length`.
 */
export const match: RedirectMatcher["match"] = (required: MatchRequired, _optional: Record<string, never> = {}): RedirectResolution => {
  const { request, rules } = required;

  const candidates: CandidateMatch[] = [];
  for (const rule of rules) {
    const candidate = matchOne(rule, request.path);
    if (candidate) candidates.push(candidate);
  }
  if (candidates.length === 0) return { matched: false };

  candidates.sort((a, b) => {
    const precedenceDelta = PRECEDENCE_ORDER[a.rule.matchType] - PRECEDENCE_ORDER[b.rule.matchType];
    if (precedenceDelta !== 0) return precedenceDelta;
    return compareWithinBand(a, b);
  });

  const winner = candidates[0]!;
  return {
    matched: true,
    redirectId: winner.rule.id,
    location: winner.location,
    statusCode: winner.rule.statusCode,
    matchType: winner.rule.matchType,
  };
};

export const redirectMatcher: RedirectMatcher = { match, validatePattern };
