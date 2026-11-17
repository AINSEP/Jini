/**
 * @file R14: the reviewed caller lists for `approveCause` and `tracker: 'skip'`. The check is run on
 * files given in memory (known-bad and known-good), then on the real tree.
 */
import { expect, test } from 'vitest';
import { checkErrorDisclosureCallers, findDisclosureCallerViolations } from '../check-error-disclosure-callers.js';

const approving = { file: 'packages/cms/src/export/failure.ts', text: 'import { approveCause } from "@jini-ai/core/errors/approved-cause";\nexport const approved = (cause: unknown) => approveCause({ step: "Export the site", cause });\n' };
const skipping = { file: 'packages/chat/src/visitor/reply.ts', text: 'export const told = (reporter, error) => reporter.record({ error, step: "Answer a visitor" }, { level: "warning", tracker: \'skip\' });\n' };

test('a production file that approves a cause or skips the tracker must be on its reviewed list', () => {
  expect(findDisclosureCallerViolations({ files: [approving, skipping] })).toEqual([
    { rule: 'R14-error-disclosure-callers', file: approving.file, reason: "uses approveCause and is not on the reviewed caller list (only the owner of an operation may approve its failure text for callers). Add it to scripts/check-error-disclosure-callers.ts with the owner's reason, or remove the call." },
    { rule: 'R14-error-disclosure-callers', file: skipping.file, reason: "uses tracker: 'skip' and is not on the reviewed caller list (skipping the tracker is only for a failure the caller caused and was told about). Add it to scripts/check-error-disclosure-callers.ts with the owner's reason, or remove the call." },
  ]);
  expect(findDisclosureCallerViolations({ files: [approving, skipping] }, {
    approveCauseCallers: [{ file: approving.file, reason: 'the export owner approved its failure text for authorised callers' }],
    trackerSkipCallers: [{ file: skipping.file, reason: 'a rate-limit refusal the visitor was told about' }],
  })).toEqual([]);
});

test('each list is per call: being listed for one does not allow the other', () => {
  const found = findDisclosureCallerViolations({ files: [approving] }, { trackerSkipCallers: [{ file: approving.file, reason: 'wrong list' }] });
  expect(found.map(violation => violation.reason)).toEqual([
    "uses approveCause and is not on the reviewed caller list (only the owner of an operation may approve its failure text for callers). Add it to scripts/check-error-disclosure-callers.ts with the owner's reason, or remove the call.",
    "is on the reviewed caller list for tracker: 'skip' and no longer uses it. Remove the entry from scripts/check-error-disclosure-callers.ts.",
  ]);
});

test('a listed file that no longer makes the call is reported, so the lists stay true', () => {
  expect(findDisclosureCallerViolations({ files: [{ file: approving.file, text: 'export const nothing = 1;\n' }] }, { approveCauseCallers: [{ file: approving.file, reason: 'old' }] })).toEqual([
    { rule: 'R14-error-disclosure-callers', file: approving.file, reason: 'is on the reviewed caller list for approveCause and no longer uses it. Remove the entry from scripts/check-error-disclosure-callers.ts.' },
  ]);
});

test('tests, the defining modules, comments and other readers of the same words are not callers', () => {
  expect(findDisclosureCallerViolations({ files: [
    { file: 'packages/cms/src/export/__tests__/failure.test.ts', text: approving.text },
    { file: 'packages/core/src/errors/testing.ts', text: skipping.text },
    { file: 'packages/core/src/errors/approved-cause.ts', text: 'export function approveCause() {}\n' },
    { file: 'packages/core/src/errors/reporter.ts', text: "if (optional.tracker === 'skip') return;\nreadonly tracker?: 'report' | 'skip';\n" },
    { file: 'packages/cms/src/export/notes.ts', text: '// approveCause({ step, cause }) is called by the export owner\n/* { tracker: "skip" } */\nexport const isApprovedCauseCheck = 1;\nexport const mode = { tracker: "report" };\n' },
  ] })).toEqual([]);
});

test('the real tree has no caller outside the reviewed lists', () => {
  expect(checkErrorDisclosureCallers()).toEqual([]);
});
