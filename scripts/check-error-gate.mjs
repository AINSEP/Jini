/**
 * Error gate, WARN mode (error-system step E0). Runs the error rules over production source and
 * compares the result with a checked-in debt list that may only shrink. In WARN mode a new or
 * worsened entry is printed and the exit code stays 0; step E11 turns a package to ERROR when its
 * debt rows reach 0 (`--strict` already does that for a local run).
 *
 * Rules: `catch-reads-error` (rule 1), `no-generic-failure-text` (rule 2) and
 * `failure-text-from-catalog` (rule 3). One precedence order: a sanctioned module is skipped by all
 * three; a pure-parse refusal satisfies rule 1 and rule 3's cause clause while rule 2 still reads its
 * words; everything else gets all three.
 *
 * Skipped by every rule: the sanctioned reporting modules (they are where a caught value ends up, and
 * guard their own failures), and standalone skill scripts, which run in a user's project with no
 * reporter and no core import (owner decision D9).
 *
 * Debt identity is file + rule; the value is a count, so moving lines never churns the list.
 * Usage: `node scripts/check-error-gate.mjs` (warn), `--strict` (exit 1 on a new or worsened entry),
 * `--list` (every entry with its lines), `--update` (rewrite the debt list; only for a shrink or the
 * first baseline), `--list --files a.ts,b.ts` (a job's own files, no ratchet).
 */
import { existsSync, globSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import catchReadsError from './eslint-rules/errors/catch-reads-error.mjs';
import failureTextFromCatalog from './eslint-rules/errors/failure-text-from-catalog.mjs';
import noGenericFailureText from './eslint-rules/errors/no-generic-failure-text.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const debtFile = 'scripts/error-gate-debt.json';
const sourceGlob = 'packages/*/src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}';
const excludedFiles = [
  '**/{__tests__,__mocks__,__fixtures__,__measurements__,test,tests,fixtures}/**',
  '**/*.{test,spec,typecheck,stories,story}.*', '**/*.d.{ts,mts,cts}', '**/{generated,__generated__}/**', '**/*.{generated,gen}.*',
  '**/*.bundle.{js,mjs,cjs}', '**/testing.{ts,tsx}',
  // Outside the gate (D9): standalone skill scripts cannot import core.
  'packages/agent-runtime/src/skills/**/scripts/**',
];
/** Where a caught value is meant to end up; each guards its own failure path. */
export const sanctionedModules = [
  'packages/core/src/errors/reporter.ts', 'packages/core/src/errors/idioms.ts', 'packages/core/src/errors/catalog.ts',
  'packages/core/src/errors/incident-text.ts', 'packages/core/src/primitives/logger.ts', 'packages/core/src/model-facing-tool-errors.ts',
  'packages/agent-runtime/src/diagnostics.ts', 'packages/daemon/src/core/tool-audit.ts', 'packages/desktop-host/src/sidecar.ts',
  'packages/diagnostics/src/observability/report-error.ts', 'packages/plugins/src/host/provider-host.ts',
];
/** Reviewed synchronous helpers with no I/O; a call to one keeps a `try` a pure parse. Added by review. */
export const pureHelpers = [
  { name: 'addMoney', module: 'packages/commerce/src/money/money' },
  { name: 'fromBase64Url', module: 'packages/core/src/list-page' },
  { name: 'parseRequestUrl', module: 'packages/integrations/src/credentialed-http/credentialed-request' },
  { name: 'redactJsonResponseBody', module: 'packages/integrations/src/credentialed-http/response-redaction' },
];
const rules = { 'catch-reads-error': catchReadsError, 'no-generic-failure-text': noGenericFailureText, 'failure-text-from-catalog': failureTextFromCatalog };
const ruleNames = Object.keys(rules);

/** The ESLint flat config of the gate: only these rules, inline directives ignored. */
export function errorGateConfig(_required = {}, optional = {}) {
  const helpers = { pureHelpers: optional.pureHelpers ?? pureHelpers };
  return [{
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { errors: { rules } },
    rules: { 'errors/catch-reads-error': ['error', helpers], 'errors/no-generic-failure-text': 'error', 'errors/failure-text-from-catalog': ['error', helpers] },
  }];
}

/** Every finding in production code, grouped by file + rule with a count and the lines. */
export async function findErrorGateViolations(_required = {}, { files: only } = {}) {
  const production = globSync(sourceGlob, { cwd: root, exclude: excludedFiles }).map(file => file.split(path.sep).join('/'))
    .filter(file => !sanctionedModules.includes(file));
  const files = only === undefined ? production : production.filter(file => only.includes(file));
  if (!files.length) throw new Error(only === undefined ? 'No production source files found for the error gate.' : `None of these is a production source file the gate covers: ${only.join(', ')}`);
  const eslint = new ESLint({ cwd: root, overrideConfigFile: true, allowInlineConfig: false, errorOnUnmatchedPattern: false, overrideConfig: errorGateConfig() });
  const grouped = new Map();
  for (const result of await eslint.lintFiles(files)) {
    const file = path.relative(root, result.filePath).split(path.sep).join('/');
    for (const message of result.messages) {
      const rule = message.ruleId?.replace(/^errors\//, '');
      if (!ruleNames.includes(rule)) throw new Error(`ESLint failed on ${file}:${message.line ?? '?'}: ${message.message}`);
      const key = `${file}\u0000${rule}`;
      const entry = grouped.get(key) ?? { file, rule, value: 0, lines: [] };
      entry.value += 1;
      entry.lines.push(message.line);
      grouped.set(key, entry);
    }
  }
  return [...grouped.values()].sort((a, b) => a.file.localeCompare(b.file, 'en') || a.rule.localeCompare(b.rule, 'en'));
}

/** Added / worsened / improved / stale entries of `current` relative to the allowed `debt`. */
export function compareErrorGateDebt({ debt, current }, _optional = {}) {
  const index = list => new Map(list.map(item => [`${item.file}\u0000${item.rule}`, item]));
  const allowed = index(debt);
  const actual = index(current);
  const result = { added: [], worsened: [], improved: [], stale: [] };
  for (const [identity, violation] of actual) {
    const prior = allowed.get(identity);
    if (!prior) result.added.push(violation);
    else if (violation.value > prior.value) result.worsened.push({ prior, violation });
    else if (violation.value < prior.value) result.improved.push({ prior, violation });
  }
  for (const [identity, violation] of allowed) if (!actual.has(identity)) result.stale.push(violation);
  return result;
}

export function updateErrorGateDebt({ debtPath, current, scoped }, _optional = {}) {
  if (scoped) {
    console.error('Cannot update the error gate debt list with --files; run a full scan.');
    return 1;
  }
  if (existsSync(debtPath)) {
    const { added, worsened } = compareErrorGateDebt({ debt: JSON.parse(readFileSync(debtPath, 'utf8')), current });
    if (added.length || worsened.length) {
      console.error('Cannot update the error gate debt list with new or worsened entries.');
      return 1;
    }
  }
  writeFileSync(debtPath, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Wrote ${current.length} entries to ${debtFile}.`);
  return 0;
}

function reportErrorGateDebt({ argv, stored }, _optional = {}) {
  const { added, worsened, improved, stale } = compareErrorGateDebt({ debt: JSON.parse(readFileSync(path.join(root, debtFile), 'utf8')), current: stored });
  for (const entry of added) console.log(`New: [${entry.rule}] ${entry.file} (${entry.value})`);
  for (const { prior, violation } of worsened) console.log(`Worse: [${violation.rule}] ${violation.file} (${prior.value} -> ${violation.value})`);
  const shrink = improved.length + stale.length;
  if (shrink) console.log(`${shrink} entries improved or are gone: run with --update to lower the debt list.`);
  const total = stored.reduce((sum, entry) => sum + entry.value, 0);
  const failing = added.length + worsened.length;
  console.log(failing ? `Error gate (WARN mode): ${failing} new or worse entries. Not failing the build yet; fix them or use a named idiom.`
    : `Error gate passed: ${total} findings in ${stored.length} file/rule entries.`);
  return failing && argv.includes('--strict') ? 1 : 0;
}

async function main(argv) {
  const only = argv.includes('--files') ? argv[argv.indexOf('--files') + 1]?.split(',') : undefined;
  const current = await findErrorGateViolations({}, only === undefined ? {} : { files: only });
  if (argv.includes('--list')) {
    for (const entry of current) console.log(`[${entry.rule}] ${entry.file} (${entry.value}; lines ${entry.lines.join(', ')})`);
    return 0;
  }
  const stored = current.map(({ file, rule, value }) => ({ file, rule, value }));
  if (argv.includes('--update')) return updateErrorGateDebt({ debtPath: path.join(root, debtFile), current: stored, scoped: argv.includes('--files') });
  return reportErrorGateDebt({ argv, stored });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = await main(process.argv.slice(2));
