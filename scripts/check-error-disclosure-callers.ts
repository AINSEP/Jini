/**
 * R14 — error disclosure callers (error-system design §3.3, amendment X2).
 *
 * Two calls in `@jini-ai/core/errors` decide something no type can check, so each has a reviewed
 * caller list here:
 *
 *  - `approveCause(...)` lets a caller authorised for one operation read that failure's own text.
 *    Redaction is not permission: only the owner of the operation may say its failures are readable.
 *  - `reporter.record(..., { tracker: 'skip' })` keeps a failure away from the error tracker. It is
 *    for a failure the caller caused and was told about; anywhere else it hides incidents.
 *
 * A production file that does either must be on the matching list below with the owner's reason,
 * so adding a caller is a reviewed diff. A listed file that no longer does it is reported too, so the
 * lists stay true. Both lists are empty today: the first callers are host features, and a host
 * keeps its own list.
 *
 * Limits: the check reads text with comments removed. It does not follow a re-export, an alias
 * (`const approve = approveCause`) or a value built elsewhere (`{ tracker: mode }`).
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Violation } from './check-engine-boundaries.js';
import { listSourceFiles, REPO_ROOT, stripComments } from './lib/walk-imports.js';

export interface DisclosureCaller { readonly file: string; readonly reason: string }
export interface DisclosureCallerOptions {
  readonly approveCauseCallers?: readonly DisclosureCaller[];
  readonly trackerSkipCallers?: readonly DisclosureCaller[];
}

/** Files that may call `approveCause`, each with the operation owner's reason. */
export const APPROVE_CAUSE_CALLERS: readonly DisclosureCaller[] = [];
/** Files that may pass `tracker: 'skip'`, each with the reason the failure is the caller's own. */
export const TRACKER_SKIP_CALLERS: readonly DisclosureCaller[] = [];

const RULE = 'R14-error-disclosure-callers';
/** Where the two calls are defined; naming them there is not a call. */
const DEFINING_FILES = new Set(['packages/core/src/errors/approved-cause.ts', 'packages/core/src/errors/reporter.ts']);
const TEST_FILE = /(?:^|\/)(?:__tests__|__mocks__|test|tests|fixtures)\/|\.(?:test|spec|typecheck)\.[cm]?[jt]sx?$|(?:^|\/)testing\.tsx?$/;
const CALLS = [
  { name: 'approveCause', pattern: /\bapproveCause\b/, option: 'approveCauseCallers', why: 'only the owner of an operation may approve its failure text for callers' },
  { name: "tracker: 'skip'", pattern: /\btracker\s*:\s*['"`]skip['"`]/, option: 'trackerSkipCallers', why: 'skipping the tracker is only for a failure the caller caused and was told about' },
] as const;

/** The R14 findings for a set of files given as repo-relative path + text. Pure, so a test passes its own files. */
export function findDisclosureCallerViolations(required: { files: ReadonlyArray<{ file: string; text: string }> }, optional: DisclosureCallerOptions = {}): Violation[] {
  const allowed = { approveCauseCallers: optional.approveCauseCallers ?? APPROVE_CAUSE_CALLERS, trackerSkipCallers: optional.trackerSkipCallers ?? TRACKER_SKIP_CALLERS };
  const production = required.files.filter(({ file }) => !TEST_FILE.test(file) && !DEFINING_FILES.has(file)).map(({ file, text }) => ({ file, text: stripComments(text) }));
  const violations: Violation[] = [];
  for (const call of CALLS) {
    const callers = new Set(production.filter(({ text }) => call.pattern.test(text)).map(({ file }) => file));
    const listed = new Set(allowed[call.option].map(entry => entry.file));
    for (const file of callers) {
      if (!listed.has(file)) violations.push({ rule: RULE, file, reason: `uses ${call.name} and is not on the reviewed caller list (${call.why}). Add it to scripts/check-error-disclosure-callers.ts with the owner's reason, or remove the call.` });
    }
    for (const file of listed) {
      if (!callers.has(file)) violations.push({ rule: RULE, file, reason: `is on the reviewed caller list for ${call.name} and no longer uses it. Remove the entry from scripts/check-error-disclosure-callers.ts.` });
    }
  }
  return violations;
}

/** Runs R14 over every package's `src` tree. */
export function checkErrorDisclosureCallers(_required: Record<never, never> = {}, optional: DisclosureCallerOptions & { packagesDir?: string } = {}): Violation[] {
  const packagesDir = optional.packagesDir ?? join(REPO_ROOT, 'packages');
  const files = listSourceFiles(packagesDir, { includeJavaScript: true })
    .map(path => ({ file: relative(REPO_ROOT, path).split('\\').join('/'), text: readFileSync(path, 'utf8') }));
  return findDisclosureCallerViolations({ files }, optional);
}
