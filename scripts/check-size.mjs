/** Ratchet production file and function sizes against the checked-in debt list. */
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import ts from 'typescript';
import tseslint from 'typescript-eslint';
import { complexityExcludedFiles } from '../eslint.config.mjs';
import { baseDebt, compareDebt, functionRanges } from './check-complexity.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const debtFile = 'scripts/size-debt.json';
const exceptionFile = 'scripts/size-exceptions.json';
const sourceGlob = 'packages/*/src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}';
const ruleLimits = { 'max-lines': 500, 'max-lines-per-function': 50 };

function validateException(item) {
  if (!['*', 'jini'].includes(item.repo) || typeof item.reason !== 'string' || !item.reason.trim()) {
    throw new Error(`Invalid size exception: ${JSON.stringify(item)}`);
  }
}

function validateEntry(item) {
  if (typeof item.file !== 'string' || !item.file ||
      (item.function !== undefined && (typeof item.function !== 'string' || !item.function))) {
    throw new Error('Invalid size exception entry');
  }
}

function validatePathExclusion(item) {
  if (typeof item.pattern !== 'string' || !item.pattern) throw new Error('Invalid size path exclusion');
}

function readExceptions() {
  const config = JSON.parse(readFileSync(path.join(root, exceptionFile), 'utf8'));
  if (config.limits?.fileLines !== 500 || config.limits?.functionLines !== 50 ||
      !Array.isArray(config.pathExclusions) || !Array.isArray(config.entries)) {
    throw new Error(`Invalid size limits or exception lists in ${exceptionFile}`);
  }
  for (const item of [...config.pathExclusions, ...config.entries]) validateException(item);
  for (const item of config.pathExclusions) validatePathExclusion(item);
  for (const item of config.entries) validateEntry(item);
  return config;
}

function sourceFiles(config) {
  const excluded = config.pathExclusions.filter(item => item.repo === '*' || item.repo === 'jini')
    .map(item => new RegExp(item.pattern));
  return globSync(sourceGlob, { cwd: root, exclude: complexityExcludedFiles })
    .filter(file => !excluded.some(pattern => pattern.test(file.split(path.sep).join('/'))));
}

function sizeRuleConfig() {
  const common = { skipBlankLines: true, skipComments: true };
  return {
    'max-lines': ['error', { ...common, max: ruleLimits['max-lines'] }],
    'max-lines-per-function': ['error', { ...common, max: ruleLimits['max-lines-per-function'], IIFEs: true }],
  };
}

function recordFromMessage(file, message, source, ranges) {
  if (!Object.hasOwn(ruleLimits, message.ruleId)) {
    throw new Error(`ESLint failed on ${file}:${message.line ?? '?'}: ${message.message}`);
  }
  const match = /has too many lines \((\d+)\)/.exec(message.message);
  if (!match) throw new Error(`Unrecognized ${message.ruleId} report: ${message.message}`);
  let name = '<file>';
  if (message.ruleId === 'max-lines-per-function') {
    const position = source.getPositionOfLineAndCharacter(message.line - 1, message.column - 1);
    const matching = ranges.filter(range => range.start <= position && position < range.end)
      .sort((a, b) => (a.end - a.start) - (b.end - b.start));
    if (!matching.length) throw new Error(`Cannot identify function at ${file}:${message.line}:${message.column}`);
    name = matching[0].name;
  }
  return { file, function: name, line: message.line, rule: message.ruleId, value: Number(match[1]) };
}

function isExcepted(record, entries) {
  return entries.some(item => (item.repo === '*' || item.repo === 'jini') && item.file === record.file &&
    (item.function === undefined || (record.rule === 'max-lines-per-function' && item.function === record.function)));
}

/** Run only the two size rules and retain exception counts for reporting. */
export async function findSizeViolations() {
  const exceptions = readExceptions();
  const files = sourceFiles(exceptions);
  if (!files.length) throw new Error('No production source files found for the size gate.');
  const eslint = new ESLint({
    cwd: root, overrideConfigFile: true, allowInlineConfig: false, errorOnUnmatchedPattern: false,
    overrideConfig: [{
      files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
      languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
      rules: sizeRuleConfig(),
    }],
  });
  const results = await eslint.lintFiles(files);
  const all = [];
  for (const result of results) {
    if (!result.messages.length) continue;
    const file = path.relative(root, result.filePath).split(path.sep).join('/');
    const source = ts.createSourceFile(result.filePath, readFileSync(result.filePath, 'utf8'), ts.ScriptTarget.Latest, true);
    const ranges = functionRanges(source);
    for (const message of result.messages) all.push(recordFromMessage(file, message, source, ranges));
  }
  all.sort((a, b) => a.file.localeCompare(b.file, 'en') || a.line - b.line || a.rule.localeCompare(b.rule, 'en'));
  return { violations: all.filter(record => !isExcepted(record, exceptions.entries)),
    excepted: all.filter(record => isExcepted(record, exceptions.entries)) };
}

function describe(v) {
  return `[${v.rule}] ${v.file}:${v.line} ${v.function} (${v.value})`;
}

function checkBaseDebt(base, debt) {
  const growth = compareDebt(base, debt, ruleLimits);
  for (const v of growth.added) console.error(`Debt added: ${describe(v)}`);
  for (const { prior, violation } of growth.worsened) console.error(`Debt allowance increased from ${prior.value}: ${describe(violation)}`);
  if (growth.added.length || growth.worsened.length) throw new Error('Size debt may only shrink relative to the base commit.');
}

function checkCurrentDebt(debt, violations) {
  const { added, worsened, improved, stale } = compareDebt(debt, violations, ruleLimits);
  for (const v of added) console.error(`New violation: ${describe(v)}`);
  for (const { prior, violation } of worsened) console.error(`Worsened from ${prior.value}: ${describe(violation)}`);
  for (const { prior, violation } of improved) console.error(`Lower debt value from ${prior.value}: ${describe(violation)}`);
  for (const v of stale) console.error(`Remove stale debt entry: ${describe(v)}`);
  if (added.length || worsened.length || improved.length || stale.length) throw new Error('Size ratchet failed.');
}

async function main() {
  const debt = JSON.parse(readFileSync(path.join(root, debtFile), 'utf8'));
  const base = baseDebt(debtFile, process.env.SIZE_BASE_REF || 'HEAD', process.env.SIZE_FIRST_PUSH_COMMIT || '');
  if (base) checkBaseDebt(base, debt);
  const { violations, excepted } = await findSizeViolations();
  checkCurrentDebt(debt, violations);
  const functions = violations.filter(v => v.rule === 'max-lines-per-function').length;
  console.log(`Size ratchet passed: ${violations.length} debt entries (${functions} functions, ${violations.length - functions} files); ${excepted.length} accepted exceptions.`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
