/**
 * Ratchet ESLint's per-function complexity against the checked-in debt list.
 * Line numbers are diagnostic only: identities use the file, qualified function and rule.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { debtAtBase } from './lib/debt-base.mjs';
import { complexityExcludedFiles, complexitySourceFiles } from '../eslint.config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const debtFile = 'scripts/complexity-debt.json';
const rules = ['complexity', 'sonarjs/cognitive-complexity'];
const threshold = 10;
const limits = Object.fromEntries(rules.map(rule => [rule, threshold]));

function functionLabel(node, source) {
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  if (node.name) return node.name.getText(source);
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) {
    return parent.name.getText(source);
  }
  if (ts.isBinaryExpression(parent) && parent.right === node) return parent.left.getText(source);
  if (ts.isCallExpression(parent)) return `${parent.expression.getText(source)} callback`;
  return '<anonymous>';
}

/** Index function ranges and their lexical names once per file, in O(nodes) time and space. */
export function functionRanges(source) {
  const ranges = [];
  const counts = new Map();
  function visit(node, parents) {
    let childParents = parents;
    if (ts.isFunctionLike(node) && node.body) {
      const label = functionLabel(node, source);
      const base = [...parents, label].join('.');
      const count = (counts.get(base) ?? 0) + 1;
      counts.set(base, count);
      const name = count === 1 ? base : `${base}#${count}`;
      const parent = node.parent;
      const startsAtParent = ts.isArrowFunction(node) || ts.isFunctionExpression(node);
      const hasNamedParent = ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent);
      const start = startsAtParent && hasNamedParent ? parent.getStart(source) : node.getStart(source);
      ranges.push({ start, end: node.end, name });
      childParents = [name];
    } else if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.name) {
      childParents = [...parents, node.name.getText(source)];
    } else if ((ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node)) && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      childParents = [...parents, node.name.getText(source)];
    } else if (ts.isClassStaticBlockDeclaration(node)) {
      const name = [...parents, '<static block>'].join('.');
      ranges.push({ start: node.getStart(source), end: node.end, name });
      childParents = [name];
    } else if (ts.isPropertyDeclaration(node) && node.initializer) {
      ranges.push({ start: node.getStart(source), end: node.end, name: [...parents, node.name.getText(source), '<initializer>'].join('.') });
    }
    ts.forEachChild(node, child => visit(child, childParents));
  }
  visit(source, []);
  return ranges;
}

function parseValue(message) {
  const pattern = message.ruleId === 'complexity' ? /complexity of (\d+)/ : /Complexity from (\d+) to/;
  const match = pattern.exec(message.message);
  if (!match) throw new Error(`Unrecognized ${message.ruleId} report: ${message.message}`);
  return Number(match[1]);
}

/** Convert ESLint's JSON to deterministic debt records, rejecting parse/tool errors. */
function recordsFromResults(results) {
  const violations = [];
  for (const result of results) {
    if (!result.messages.length) continue;
    const file = path.relative(root, result.filePath).split(path.sep).join('/');
    const source = ts.createSourceFile(result.filePath, readFileSync(result.filePath, 'utf8'), ts.ScriptTarget.Latest, true);
    const ranges = functionRanges(source);
    for (const message of result.messages) {
      if (!rules.includes(message.ruleId)) throw new Error(`ESLint failed on ${file}:${message.line ?? '?'}: ${message.message}`);
      const position = source.getPositionOfLineAndCharacter(message.line - 1, message.column - 1);
      const matching = ranges.filter(range => range.start <= position && position < range.end)
        .sort((a, b) => (a.end - a.start) - (b.end - b.start));
      if (!matching.length) throw new Error(`Cannot identify function at ${file}:${message.line}:${message.column}`);
      violations.push({ file, function: matching[0].name, line: message.line, rule: message.ruleId, value: parseValue(message) });
    }
  }
  return violations.sort((a, b) => a.file.localeCompare(b.file, 'en') || a.line - b.line || a.rule.localeCompare(b.rule, 'en'));
}

/** Run the same production scopes as the config, with strict rule overrides and no suppressions. */
export function findViolations() {
  const args = ['--quiet', '--no-inline-config', '--no-error-on-unmatched-pattern', '-f', 'json'];
  for (const pattern of complexityExcludedFiles) args.push('--ignore-pattern', pattern);
  args.push('--rule', JSON.stringify(Object.fromEntries(rules.map(rule => [rule, ['error', threshold]]))));
  args.push(...complexitySourceFiles);
  const eslint = path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
  const result = spawnSync(process.execPath, [eslint, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) throw new Error(`ESLint failed (${result.status}): ${result.stderr}`);
  if (!result.stdout.trim()) throw new Error(`ESLint returned no JSON: ${result.stderr}`);
  return recordsFromResults(JSON.parse(result.stdout));
}

function key(violation) {
  return JSON.stringify([violation.file, violation.function, violation.rule]);
}

function index(records, source, ruleLimits) {
  if (!Array.isArray(records)) throw new Error(`${source} must contain an array of violations`);
  const map = new Map();
  for (const record of records) {
    if (typeof record.file !== 'string' || !record.file || typeof record.function !== 'string' || !record.function ||
        !Object.hasOwn(ruleLimits, record.rule) || !Number.isInteger(record.line) || record.line < 1 ||
        !Number.isInteger(record.value) || record.value <= ruleLimits[record.rule]) {
      throw new Error(`Invalid violation in ${source}: ${JSON.stringify(record)}`);
    }
    const identity = key(record);
    if (map.has(identity)) throw new Error(`Duplicate function and rule in ${source}: ${identity}`);
    map.set(identity, record);
  }
  return map;
}

/** Compare actual violations with permitted values; duplicates cannot share an allowance. */
export function compareDebt(debt, current, ruleLimits = limits) {
  const allowed = index(debt, 'debt list', ruleLimits);
  const actual = index(current, 'ESLint output', ruleLimits);
  const added = [];
  const worsened = [];
  const improved = [];
  const stale = [];
  for (const [identity, violation] of actual) {
    const prior = allowed.get(identity);
    if (!prior) added.push(violation);
    else if (violation.value > prior.value) worsened.push({ prior, violation });
    else if (violation.value < prior.value) improved.push({ prior, violation });
  }
  for (const [identity, violation] of allowed) if (!actual.has(identity)) stale.push(violation);
  return { added, worsened, improved, stale };
}

/** Compare debt to the trusted base so editing the JSON cannot increase allowances. */
export function baseDebt(file = debtFile, baseRef = process.env.COMPLEXITY_BASE_REF, firstCommit = process.env.COMPLEXITY_FIRST_PUSH_COMMIT) {
  return debtAtBase({ root, file }, { baseRef: baseRef || 'HEAD', firstCommit: firstCommit || '' });
}

function describe(v) {
  return `[${v.rule}] ${v.file}:${v.line} ${v.function} (${v.value})`;
}

function main() {
  const debt = JSON.parse(readFileSync(path.join(root, debtFile), 'utf8'));
  const base = baseDebt();
  if (base) {
    const growth = compareDebt(base, debt);
    for (const v of growth.added) console.error(`Debt added: ${describe(v)}`);
    for (const { prior, violation } of growth.worsened) console.error(`Debt allowance increased from ${prior.value}: ${describe(violation)}`);
    if (growth.added.length || growth.worsened.length) throw new Error('Complexity debt may only shrink relative to the base commit.');
  }
  const current = findViolations();
  const { added, worsened, improved, stale } = compareDebt(debt, current);
  for (const v of added) console.error(`New violation: ${describe(v)}`);
  for (const { prior, violation } of worsened) console.error(`Worsened from ${prior.value}: ${describe(violation)}`);
  for (const { prior, violation } of improved) console.error(`Lower debt value from ${prior.value}: ${describe(violation)}`);
  for (const v of stale) console.error(`Remove stale debt entry: ${describe(v)}`);
  if (added.length || worsened.length || improved.length || stale.length) throw new Error('Complexity ratchet failed.');
  const counts = Object.fromEntries(rules.map(rule => [rule, current.filter(v => v.rule === rule).length]));
  console.log(`Complexity ratchet passed: ${current.length} entries (${counts.complexity} cyclomatic, ${counts['sonarjs/cognitive-complexity']} cognitive).`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
