/**
 * Ratchet raw log paths in production code against the checked-in debt list.
 *
 * Why a gate and not a hand-made inventory: four reviews in a row each found raw log paths the
 * previous row list missed. A caught error's text or stack can quote untrusted input or a
 * credential that no redaction pattern knows, so production code routes failures through the safe
 * shared pieces instead (`describeErrorForLog`, the default loggers, `reportRouteInternalError`,
 * the web-clone `lib/diagnostic-labels.mjs`). This gate finds every remaining raw path
 * mechanically; the debt list may only shrink.
 *
 * Rules (ESLint core rules only, so the gate needs no custom plugin):
 * - `console`: direct `console.*` use outside the sanctioned default sinks.
 * - `error-text`: `.message` / `.stack` read inside a log call (console, `*.log/info/warn/error/
 *   debug/trace`, or a bare `log/info/warn/debug/trace` function).
 * - `error-format`: `inspect(...)`, `formatErrorForLog(...)` or `String(<error-named value>)` inside
 *   a log call.
 * - `raw-error`: an error-named value (`err`, `context.error`) passed straight to a log call, or
 *   embedded in its template string or string concatenation. The sanctioned host route is the
 *   `Logger` error bag (`logger.warn({ message }, { error })`), which this rule does not match.
 * - `error-helper`: an error-named value handed to any other helper inside a log call
 *   (`errorMessage(error)`, `messages.failed({ message: messageOf(error) })`); only
 *   `describeErrorForLog` and the scripts' `errorClassLabel` take a caught value safely.
 * - `stored-error-text`: `.message` / `.stack` / `String(err)` stored under an `error`, `detail`,
 *   `reason` or `cause` field (a manifest entry, a report row, a trace record).
 * Data flow through intermediate variables is not traced; direct `console` use is caught by the
 * `console` rule wherever it is, and Part A's search step covers the rest by reading.
 *
 * Debt identity is file + rule; the value is the count, so moving lines never churns the list.
 * Usage: `node scripts/check-log-safety.mjs` (CI gate) or `--update` (rewrite the list; the base
 * comparison still refuses any growth).
 */
import { spawnSync } from 'node:child_process';
import { globSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const debtFile = 'scripts/log-safety-debt.json';
const sourceGlob = 'packages/*/src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}';
/** Tests, fixtures, declarations and generated files are not production paths (same set as the complexity gate). */
const excludedFiles = [
  '**/{__tests__,__mocks__,__fixtures__,__measurements__,test,tests,fixtures}/**',
  '**/*.{test,spec,typecheck,stories,story}.*',
  '**/*.d.{ts,mts,cts}',
  '**/{generated,__generated__}/**',
  '**/*.{generated,gen}.*',
  '**/*.bundle.{js,mjs,cjs}',
];
/** The sanctioned default sinks: the only production modules that may write to `console` directly. */
export const sanctionedConsoleModules = [
  'packages/core/src/primitives/logger.ts',
  'packages/desktop-host/src/logging.ts',
  'packages/http-kit/src/internal-error.ts',
];

const ERROR_NAME = '/^(e|err|error|cause|reason|ex|exc|exception|[A-Za-z]+Error|[A-Za-z]+Err)$/';
const LOG_METHOD = '/^(log|info|warn|error|debug|trace)$/';
// A bare `error(...)` call is left out: its callee name would itself match ERROR_NAME below.
const BARE_LOG_FUNCTION = '/^(log|info|warn|debug|trace)$/';
/** Calls that take a caught value safely, plus `String`, which the `error-format` rule already reports. */
const SAFE_DESCRIBER = '/^(describeErrorForLog|errorClassLabel|String)$/';
/** `:nth-child` counts only list fields (`arguments`), so it never matches a callee named like an error. */
const ARGUMENT_POSITION = ':nth-child(1), :nth-child(2), :nth-child(3), :nth-child(4)';
const STORED_FIELD = '/^(error|errorMessage|errorText|detail|reason|cause)$/';
const LOG_CALL = `CallExpression:matches([callee.object.name='console'], [callee.property.name=${LOG_METHOD}], [callee.name=${BARE_LOG_FUNCTION}])`;

/** One rule per category; the message prefix maps an ESLint report back to its category. */
const restrictedSyntax = [
  { category: 'error-text', selector: `${LOG_CALL} MemberExpression[property.name=/^(message|stack)$/]` },
  { category: 'error-format', selector: `${LOG_CALL} CallExpression:matches([callee.name=/^(inspect|formatErrorForLog)$/], [callee.property.name='inspect'])` },
  { category: 'error-format', selector: `${LOG_CALL} CallExpression[callee.name='String'] > Identifier[name=${ERROR_NAME}]` },
  { category: 'raw-error', selector: `${LOG_CALL} > Identifier[name=${ERROR_NAME}]` },
  // Argument positions only: the log call's own callee (`console.error`) is a MemberExpression too.
  { category: 'raw-error', selector: `${LOG_CALL} > MemberExpression[property.name=${ERROR_NAME}]:matches(${ARGUMENT_POSITION})` },
  { category: 'raw-error', selector: `${LOG_CALL} TemplateLiteral > Identifier[name=${ERROR_NAME}]` },
  { category: 'raw-error', selector: `${LOG_CALL} BinaryExpression[operator='+'] > Identifier[name=${ERROR_NAME}]` },
  { category: 'error-helper', selector: `${LOG_CALL} CallExpression:not([callee.name=${SAFE_DESCRIBER}]) > Identifier[name=${ERROR_NAME}]:matches(${ARGUMENT_POSITION})` },
  { category: 'error-helper', selector: `${LOG_CALL} CallExpression:not([callee.name=${SAFE_DESCRIBER}]) > MemberExpression[property.name=${ERROR_NAME}]:matches(${ARGUMENT_POSITION})` },
  { category: 'stored-error-text', selector: `Property[key.name=${STORED_FIELD}] MemberExpression[object.name=${ERROR_NAME}][property.name=/^(message|stack)$/]` },
  { category: 'stored-error-text', selector: `Property[key.name=${STORED_FIELD}] CallExpression[callee.name='String'] > Identifier[name=${ERROR_NAME}]` },
].map(({ category, selector }) => ({ selector, message: `log-safety/${category}: route the failure through describeErrorForLog, the Logger error bag or a host sink.` }));

const categories = ['console', 'error-text', 'error-format', 'raw-error', 'error-helper', 'stored-error-text'];

/** The ESLint flat config of the gate: only these rules, inline directives ignored. */
export function logSafetyConfig() {
  const rules = { 'no-restricted-syntax': ['error', ...restrictedSyntax] };
  return [
    {
      files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
      languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
      rules: { ...rules, 'no-console': 'error' },
    },
    { files: sanctionedConsoleModules, rules: { 'no-console': 'off' } },
  ];
}

function categoryOf({ file, message }) {
  if (message.ruleId === 'no-console') return 'console';
  const match = message.ruleId === 'no-restricted-syntax' ? /^log-safety\/([a-z-]+):/.exec(message.message) : null;
  if (!match) throw new Error(`ESLint failed on ${file}:${message.line ?? '?'}: ${message.message}`);
  return match[1];
}

/** Every raw log path in production code, grouped by file + rule with a count and the lines. */
export async function findLogSafetyViolations() {
  const files = globSync(sourceGlob, { cwd: root, exclude: excludedFiles });
  if (!files.length) throw new Error('No production source files found for the log-safety gate.');
  const eslint = new ESLint({ cwd: root, overrideConfigFile: true, allowInlineConfig: false, errorOnUnmatchedPattern: false, overrideConfig: logSafetyConfig() });
  const grouped = new Map();
  for (const result of await eslint.lintFiles(files)) {
    const file = path.relative(root, result.filePath).split(path.sep).join('/');
    for (const message of result.messages) {
      const rule = categoryOf({ file, message });
      const key = `${file}\u0000${rule}`;
      const entry = grouped.get(key) ?? { file, rule, value: 0, lines: [] };
      entry.value += 1;
      entry.lines.push(message.line);
      grouped.set(key, entry);
    }
  }
  return [...grouped.values()].sort((a, b) => a.file.localeCompare(b.file, 'en') || a.rule.localeCompare(b.rule, 'en'));
}

function indexDebt(list, label) {
  const index = new Map();
  for (const item of list) {
    if (typeof item.file !== 'string' || !categories.includes(item.rule) || !Number.isInteger(item.value) || item.value < 1) {
      throw new Error(`Invalid ${label} entry: ${JSON.stringify(item)}`);
    }
    index.set(`${item.file}\u0000${item.rule}`, item);
  }
  return index;
}

/** Added / worsened / improved / stale entries of `current` relative to the allowed `debt`. */
export function compareLogSafetyDebt(debt, current) {
  const allowed = indexDebt(debt, 'debt list');
  const actual = indexDebt(current, 'ESLint output');
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

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
}

/** The debt list at the trusted base commit, so editing the JSON cannot raise an allowance. */
function baseDebt({ baseRef = process.env.LOG_SAFETY_BASE_REF || 'HEAD', firstCommit = process.env.LOG_SAFETY_FIRST_PUSH_COMMIT || '' } = {}) {
  const ref = /^0+$/.test(baseRef) ? (firstCommit ? `${firstCommit}^` : 'HEAD^') : baseRef;
  const commit = git(['rev-parse', '--verify', `${ref}^{commit}`]);
  if (commit.status !== 0) throw new Error(`Cannot resolve debt base ${ref}: ${commit.stderr.trim()}`);
  const listing = git(['ls-tree', '-r', '--name-only', commit.stdout.trim(), '--', debtFile]);
  if (listing.status !== 0) throw new Error(`Cannot inspect debt base: ${listing.stderr.trim()}`);
  if (!listing.stdout.trim()) return null; // Initial adoption creates the first baseline.
  const show = git(['show', `${commit.stdout.trim()}:${debtFile}`]);
  if (show.status !== 0) throw new Error(`Cannot read debt base: ${show.stderr.trim()}`);
  return JSON.parse(show.stdout);
}

function describe(v) {
  return `[${v.rule}] ${v.file} (${v.value}${v.lines ? `; lines ${v.lines.join(', ')}` : ''})`;
}

function checkBase(base, debt) {
  const growth = compareLogSafetyDebt(base, debt);
  for (const v of growth.added) console.error(`Debt added: ${describe(v)}`);
  for (const { prior, violation } of growth.worsened) console.error(`Debt allowance increased from ${prior.value}: ${describe(violation)}`);
  if (growth.added.length || growth.worsened.length) throw new Error('Log-safety debt may only shrink relative to the base commit.');
}

function checkCurrent(debt, current) {
  const { added, worsened, improved, stale } = compareLogSafetyDebt(debt, current);
  for (const v of added) console.error(`New raw log path: ${describe(v)}`);
  for (const { prior, violation } of worsened) console.error(`Worsened from ${prior.value}: ${describe(violation)}`);
  for (const { prior, violation } of improved) console.error(`Lower debt value from ${prior.value} (run --update): ${describe(violation)}`);
  for (const v of stale) console.error(`Remove stale debt entry (run --update): ${describe(v)}`);
  if (added.length || worsened.length || improved.length || stale.length) throw new Error('Log-safety ratchet failed.');
}

function toDebt(current) {
  return current.map(({ file, rule, value }) => ({ file, rule, value }));
}

async function main({ update = process.argv.includes('--update') } = {}) {
  const current = await findLogSafetyViolations();
  if (update) {
    writeFileSync(path.join(root, debtFile), `${JSON.stringify(toDebt(current), null, 2)}\n`);
  }
  const debt = JSON.parse(readFileSync(path.join(root, debtFile), 'utf8'));
  const base = baseDebt();
  if (base) checkBase(base, debt);
  checkCurrent(debt, toDebt(current));
  const total = current.reduce((sum, entry) => sum + entry.value, 0);
  console.log(`Log-safety ratchet passed: ${total} raw log paths in ${current.length} file/rule entries.`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
