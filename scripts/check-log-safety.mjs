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
 * Rules (ESLint core rules only, so the gate needs no custom plugin). A "caught value" is an
 * error-named identifier (`err`, `error`, `cause`, `reason`, `loadError`) or a member with such a
 * name (`ctx.error`). A "text sink" is a log call (console, `*.log/info/warn/error/debug/trace`, a
 * bare `log/info/warn/debug/trace`), a bare `report(...)` and `process.stdout/stderr.write(...)`.
 * - `console`: direct `console.*` use outside the sanctioned default sinks.
 * - `error-text`: `.message` / `.stack` read inside a text sink.
 * - `error-format`: `inspect(...)`, `formatErrorForLog(...)` or `String(<caught value>)` inside a
 *   text sink.
 * - `raw-error`: a caught value embedded in a text sink's template string or concatenation; passed
 *   straight to a log call; or nested in a log call's object argument. The ONE exemption is the core
 *   `Logger` error bag: an object-first call (`({ message }, { error })`) on a receiver named
 *   `logger` / `*Logger`, with the value under an `error`/`err`/`reason`/`cause` key of its second
 *   argument (the default sinks describe those keys; a host logger is the host's channel). The
 *   receiver is matched by name, not by type: a job that changes such a call confirms by reading
 *   that the receiver is a core `Logger`.
 * - `error-helper`: a caught value handed to any other helper inside a text sink
 *   (`errorMessage(error)`, `messages.failed({ message: messageOf(error) })`); only
 *   `describeErrorForLog` and the scripts' `errorClassLabel` take a caught value safely.
 * - `stored-error-text`: `.message` / `.stack` of a caught value (`err.message`, `ctx.error.stack`)
 *   or `String(<caught value>)` stored under an `error`, `errorMessage`, `errorText`, `detail`,
 *   `reason` or `cause` field (a manifest entry, a report row, a trace record).
 * Not traced: data flow through intermediate variables, sinks with other names, and stored fields
 * with other names (`{ message: error.message }` is mostly a caller answer). Those stay explicit
 * rows in the design (jini-errors.md) and are fixed by reading.
 *
 * Debt identity is file + rule; the value is the count, so moving lines never churns the list.
 * Usage: `node scripts/check-log-safety.mjs` (CI gate), `--list` (print every entry with its lines,
 * the work list), `--update` (rewrite the list; the base comparison still refuses any growth), or
 * `--list --files <a.ts,b.ts>` (only those files, no ratchet: a job's check of its own files).
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
/** Calls the helper rule skips: the safe describers, and `String`, which `error-format` reports.
 *  (`inspect(err)` / `formatErrorForLog(err)` count under both rules: both must go.) */
const NOT_A_HELPER = '/^(describeErrorForLog|errorClassLabel|String)$/';
/** `:nth-child` counts only list fields (`arguments`), so it never matches a callee named like an error. */
const ARGUMENT_POSITION = ':nth-child(1), :nth-child(2), :nth-child(3), :nth-child(4)';
const STORED_FIELD = '/^(error|errorMessage|errorText|detail|reason|cause)$/';
/** Keys of a Logger call's second argument the default sinks describe (see core `describeLogMeta`). */
const ERROR_BAG_KEY = '/^(error|err|reason|cause)$/';
const LOG_CALL = `CallExpression:matches([callee.object.name='console'], [callee.property.name=${LOG_METHOD}], [callee.name=${BARE_LOG_FUNCTION}])`;
/** Log calls plus the other places text goes out as-is: a bare `report(...)` sink and process stdio. */
const TEXT_SINK = `CallExpression:matches([callee.object.name='console'], [callee.property.name=${LOG_METHOD}], [callee.name=/^(log|info|warn|debug|trace|report)$/], [callee.property.name='write'][callee.object.property.name=/^(stdout|stderr)$/])`;
/** A core Logger port call: object-first, receiver named `logger` or `*Logger` (by name, not type). */
const LOGGER_RECEIVER = '/^(logger|[a-z][A-Za-z]*Logger)$/';
const LOGGER_CALL_ATTRS = `[callee.property.name=/^(info|warn|error)$/][arguments.0.type='ObjectExpression']:matches([callee.object.name=${LOGGER_RECEIVER}], [callee.object.property.name=${LOGGER_RECEIVER}])`;
const LOGGER_CALL = `CallExpression${LOGGER_CALL_ATTRS}`;
/** A caught value: an error-named identifier or member (`err`, `ctx.error`). */
const CAUGHT = `:matches(Identifier[name=${ERROR_NAME}], MemberExpression[property.name=${ERROR_NAME}])`;
/** An object property whose value is a caught value as-is. */
const RAW_PROPERTY = `Property:matches([value.type='Identifier'][value.name=${ERROR_NAME}], [value.type='MemberExpression'][value.property.name=${ERROR_NAME}])`;
const MESSAGE_OR_STACK = '/^(message|stack)$/';

/** One rule per category; the message prefix maps an ESLint report back to its category. */
const restrictedSyntax = [
  { category: 'error-text', selector: `${TEXT_SINK} MemberExpression[property.name=${MESSAGE_OR_STACK}]` },
  { category: 'error-format', selector: `${TEXT_SINK} CallExpression:matches([callee.name=/^(inspect|formatErrorForLog)$/], [callee.property.name='inspect'])` },
  { category: 'error-format', selector: `${TEXT_SINK} CallExpression[callee.name='String'] > ${CAUGHT}` },
  { category: 'raw-error', selector: `${LOG_CALL} > Identifier[name=${ERROR_NAME}]` },
  // Argument positions only: the log call's own callee (`console.error`) is a MemberExpression too.
  { category: 'raw-error', selector: `${LOG_CALL} > MemberExpression[property.name=${ERROR_NAME}]:matches(${ARGUMENT_POSITION})` },
  { category: 'raw-error', selector: `${TEXT_SINK} TemplateLiteral > ${CAUGHT}` },
  { category: 'raw-error', selector: `${TEXT_SINK} BinaryExpression[operator='+'] > ${CAUGHT}` },
  // Nested raw values: anywhere in a log call that is not a Logger call; in a Logger call, in its
  // message object or under a non-bag key of its second argument.
  { category: 'raw-error', selector: `${LOG_CALL}:not(${LOGGER_CALL_ATTRS}) ${RAW_PROPERTY}` },
  { category: 'raw-error', selector: `${LOGGER_CALL} > ObjectExpression:first-child ${RAW_PROPERTY}` },
  { category: 'raw-error', selector: `${LOGGER_CALL} > ObjectExpression:nth-child(2) ${RAW_PROPERTY}:not([key.name=${ERROR_BAG_KEY}])` },
  { category: 'error-helper', selector: `${TEXT_SINK} CallExpression:not([callee.name=${NOT_A_HELPER}]) > Identifier[name=${ERROR_NAME}]:matches(${ARGUMENT_POSITION})` },
  { category: 'error-helper', selector: `${TEXT_SINK} CallExpression:not([callee.name=${NOT_A_HELPER}]) > MemberExpression[property.name=${ERROR_NAME}]:matches(${ARGUMENT_POSITION})` },
  { category: 'stored-error-text', selector: `Property[key.name=${STORED_FIELD}] MemberExpression:matches([object.name=${ERROR_NAME}], [object.property.name=${ERROR_NAME}])[property.name=${MESSAGE_OR_STACK}]` },
  { category: 'stored-error-text', selector: `Property[key.name=${STORED_FIELD}] CallExpression[callee.name='String'] > ${CAUGHT}` },
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

function categoryOf({ file, message }, _optional = {}) {
  if (message.ruleId === 'no-console') return 'console';
  const match = message.ruleId === 'no-restricted-syntax' ? /^log-safety\/([a-z-]+):/.exec(message.message) : null;
  if (!match) throw new Error(`ESLint failed on ${file}:${message.line ?? '?'}: ${message.message}`);
  return match[1];
}

/**
 * Every raw log path in production code, grouped by file + rule with a count and the lines.
 * @param optional.files Repo-relative paths to lint instead of every production file (a job's own
 *   files); a test, fixture or declaration among them is skipped like in the full run.
 */
export async function findLogSafetyViolations(_required = {}, { files: only } = {}) {
  const production = globSync(sourceGlob, { cwd: root, exclude: excludedFiles });
  const files = only === undefined ? production : production.filter(file => only.includes(file));
  if (!files.length) throw new Error(only === undefined ? 'No production source files found for the log-safety gate.' : `None of these is a production source file: ${only.join(', ')}`);
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

function indexDebt({ list, label }, _optional = {}) {
  const index = new Map();
  for (const item of list) {
    if (typeof item.file !== 'string' || !categories.includes(item.rule) || !Number.isInteger(item.value) || item.value < 1) {
      throw new Error(`Invalid ${label} entry: ${JSON.stringify(item)}`);
    }
    index.set(`${item.file}\u0000${item.rule}`, item);
  }
  return index;
}

/**
 * Added / worsened / improved / stale entries of `current` relative to the allowed `debt`.
 * @param required.debt The allowed entries (`{ file, rule, value }`).
 * @param required.current The entries found now.
 */
export function compareLogSafetyDebt({ debt, current }, _optional = {}) {
  const allowed = indexDebt({ list: debt, label: 'debt list' });
  const actual = indexDebt({ list: current, label: 'ESLint output' });
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

function git({ args }, _optional = {}) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
}

/** The debt list at the trusted base commit, so editing the JSON cannot raise an allowance. */
function baseDebt(_required = {}, { baseRef = process.env.LOG_SAFETY_BASE_REF || 'HEAD', firstCommit = process.env.LOG_SAFETY_FIRST_PUSH_COMMIT || '' } = {}) {
  const ref = /^0+$/.test(baseRef) ? (firstCommit ? `${firstCommit}^` : 'HEAD^') : baseRef;
  const commit = git({ args: ['rev-parse', '--verify', `${ref}^{commit}`] });
  if (commit.status !== 0) throw new Error(`Cannot resolve debt base ${ref}: ${commit.stderr.trim()}`);
  const listing = git({ args: ['ls-tree', '-r', '--name-only', commit.stdout.trim(), '--', debtFile] });
  if (listing.status !== 0) throw new Error(`Cannot inspect debt base: ${listing.stderr.trim()}`);
  if (!listing.stdout.trim()) return null; // Initial adoption creates the first baseline.
  const show = git({ args: ['show', `${commit.stdout.trim()}:${debtFile}`] });
  if (show.status !== 0) throw new Error(`Cannot read debt base: ${show.stderr.trim()}`);
  return JSON.parse(show.stdout);
}

function describe({ entry: v }, _optional = {}) {
  return `[${v.rule}] ${v.file} (${v.value}${v.lines ? `; lines ${v.lines.join(', ')}` : ''})`;
}

function checkBase({ base, debt }, _optional = {}) {
  const growth = compareLogSafetyDebt({ debt: base, current: debt });
  for (const v of growth.added) console.error(`Debt added: ${describe({ entry: v })}`);
  for (const { prior, violation } of growth.worsened) console.error(`Debt allowance increased from ${prior.value}: ${describe({ entry: violation })}`);
  if (growth.added.length || growth.worsened.length) throw new Error('Log-safety debt may only shrink relative to the base commit.');
}

function checkCurrent({ debt, current }, _optional = {}) {
  const { added, worsened, improved, stale } = compareLogSafetyDebt({ debt, current });
  for (const v of added) console.error(`New raw log path: ${describe({ entry: v })}`);
  for (const { prior, violation } of worsened) console.error(`Worsened from ${prior.value}: ${describe({ entry: violation })}`);
  for (const { prior, violation } of improved) console.error(`Lower debt value from ${prior.value} (run --update): ${describe({ entry: violation })}`);
  for (const v of stale) console.error(`Remove stale debt entry (run --update): ${describe({ entry: v })}`);
  if (added.length || worsened.length || improved.length || stale.length) throw new Error('Log-safety ratchet failed.');
}

function toDebt({ current }, _optional = {}) {
  return current.map(({ file, rule, value }) => ({ file, rule, value }));
}

/** `--files a.ts,b.ts` (or `--files=a.ts,b.ts`): the paths, or undefined for a full run. */
function filesArgument({ argv }, _optional = {}) {
  const index = argv.findIndex(arg => arg === '--files' || arg.startsWith('--files='));
  if (index === -1) return undefined;
  const value = argv[index].startsWith('--files=') ? argv[index].slice('--files='.length) : argv[index + 1];
  if (!value) throw new Error('--files needs a comma-separated list of repo-relative paths.');
  return value.split(',').map(file => file.trim()).filter(Boolean);
}

function total({ current }, _optional = {}) {
  return current.reduce((sum, entry) => sum + entry.value, 0);
}

async function main(_required = {}, { argv = process.argv } = {}) {
  const files = filesArgument({ argv });
  const current = await findLogSafetyViolations({}, files === undefined ? {} : { files });
  if (argv.includes('--list') || files !== undefined) for (const entry of current) console.log(describe({ entry }));
  if (files !== undefined) {
    // A partial run cannot judge the ratchet: it only lists what these files still carry.
    console.log(`Log-safety list for ${files.length} file(s): ${total({ current })} raw log paths in ${current.length} file/rule entries (no ratchet).`);
    return;
  }
  if (argv.includes('--update')) writeFileSync(path.join(root, debtFile), `${JSON.stringify(toDebt({ current }), null, 2)}\n`);
  const debt = JSON.parse(readFileSync(path.join(root, debtFile), 'utf8'));
  const base = baseDebt();
  if (base) checkBase({ base, debt });
  checkCurrent({ debt, current: toDebt({ current }) });
  console.log(`Log-safety ratchet passed: ${total({ current })} raw log paths in ${current.length} file/rule entries.`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
