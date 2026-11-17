import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extractComments } from '../check-why-comments-lexer.mjs';
import { classifyBlock, normalizeText, parseDebt, parseDiff } from '../check-why-comments-lib.mjs';
import { runCli } from '../check-why-comments.mjs';

const WHY = '// We retry once because the upstream drops the first connection after a deploy.';
const PROFILE = { debt: 'debt.json', siblings: [], command: 'pnpm check:why-comments' };

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });
}

function write(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
}

/** A real two-commit repo: `before` is the base, `after` the head. Files set to null are removed. */
function fixture(before, after) {
  const root = mkdtempSync(path.join(tmpdir(), 'why-gate-'));
  git(root, 'init', '-q');
  write(root, before);
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'base');
  for (const [rel, text] of Object.entries(after)) {
    if (text === null) git(root, 'rm', '-q', rel);
    else write(root, { [rel]: text });
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'head', '--allow-empty');
  return root;
}

function run(root, extra = [], options = {}) {
  const lines = [];
  const code = runCli(['--root', root, '--base', 'HEAD~1', '--head', 'HEAD', ...extra], { out: l => lines.push(l), err: l => lines.push(l), env: {}, profile: PROFILE, ...options });
  return { code, text: lines.join('\n') };
}

function withFixture(before, after, body) {
  const root = fixture(before, after);
  try { body(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

const WITH_WHY = `export function connect() {\n  ${WHY}\n  return retry(open);\n}\n`;
const WITHOUT_WHY = 'export function connect() {\n  return retry(open);\n}\n';

test('mutation: deleting a why comment makes the gate fire with file, line and id', () => {
  withFixture({ 'src/a.ts': WITH_WHY }, { 'src/a.ts': WITHOUT_WHY }, root => {
    const { code, text } = run(root);
    assert.equal(code, 1);
    assert.match(text, /src\/a\.ts:2-2/);
    assert.match(text, /we retry once because the upstream drops/);
    assert.match(text, /"id": "<id above>"/);
  });
});

test('mutation reverted: keeping the comment passes', () => {
  withFixture({ 'src/a.ts': WITH_WHY }, { 'src/a.ts': `${WITH_WHY}export const y = 2;\n` }, root => {
    assert.equal(run(root).code, 0);
  });
});

test('a comment moved to another file with the code is not lost', () => {
  withFixture({ 'src/a.ts': WITH_WHY }, { 'src/a.ts': null, 'src/b/moved.ts': WITH_WHY }, root => {
    assert.equal(run(root).code, 0);
  });
});

test('a rewrapped comment (different line breaks and markers) is not lost', () => {
  const rewrapped = 'export function connect() {\n  /**\n   * We retry once because the upstream\n   * drops the first connection after a deploy.\n   */\n  return retry(open);\n}\n';
  withFixture({ 'src/a.ts': WITH_WHY }, { 'src/a.ts': rewrapped }, root => {
    assert.equal(run(root).code, 0);
  });
});

test('a comment folded into a longer comment elsewhere is not lost', () => {
  const merged = `${WITHOUT_WHY}\n// Context: ${WHY.slice(3)} See the deploy runbook.\n`;
  withFixture({ 'src/a.ts': WITH_WHY }, { 'src/a.ts': merged }, root => {
    assert.equal(run(root).code, 0);
  });
});

test('the text surviving in the other repo counts as not lost', () => {
  const other = fixture({ 'docs.ts': WITH_WHY }, { 'docs.ts': WITH_WHY });
  withFixture({ 'src/a.ts': WITH_WHY }, { 'src/a.ts': WITHOUT_WHY }, root => {
    assert.equal(run(root).code, 1);
    assert.equal(run(root, ['--other-root', other]).code, 0);
  });
  rmSync(other, { recursive: true, force: true });
});

test('shortening a comment by dropping a sentence is flagged', () => {
  const longer = `// First we validate. Then we retry once because the upstream drops the first connection after a deploy.\nconst a = 1;\n`;
  const shorter = `// First we validate.\nconst a = 1;\n`;
  withFixture({ 'src/a.ts': longer }, { 'src/a.ts': shorter }, root => {
    assert.equal(run(root).code, 1);
  });
});

test('an allow-listed block passes, and the entry needs a reason', () => {
  withFixture({ 'src/a.ts': WITH_WHY }, { 'src/a.ts': WITHOUT_WHY }, root => {
    const first = run(root);
    const id = /\[([0-9a-f]{12})\]/.exec(first.text)[1];
    write(root, { 'debt.json': JSON.stringify({ version: 1, allow: [{ id, reason: 'obsolete since the upstream fix' }] }) });
    const allowed = run(root);
    assert.equal(allowed.code, 0);
    assert.match(allowed.text, /1 allow-listed/);
    write(root, { 'debt.json': JSON.stringify({ version: 1, allow: [{ id, reason: ' ' }] }) });
    const noReason = run(root);
    assert.equal(noReason.code, 1);
    assert.match(noReason.text, /non-empty "reason"/);
  });
});

test('exempt comments are never reported: directives, licenses, labels, commented-out code', () => {
  const before = [
    '/* Copyright 2026 Someone. Licensed under the Apache License, Version 2.0. */',
    '// eslint-disable-next-line no-console -- debugging aid for the retry loop path',
    '// Helpers',
    '// ---- types ----',
    '// const retryCount = computeRetries(options);',
    '// if (attempt > 3) { return fail(); }',
    '// @ts-expect-error legacy shape',
    'export const x = 1;',
  ].join('\n');
  withFixture({ 'src/a.ts': before }, { 'src/a.ts': 'export const x = 1;\n' }, root => {
    assert.equal(run(root).code, 0);
  });
});

test('non-source files and added-only files are out of scope', () => {
  withFixture({ 'README.md': `${WHY}\n`, 'src/a.ts': WITH_WHY }, { 'README.md': 'gone\n', 'src/a.ts': WITH_WHY, 'src/new.ts': WITHOUT_WHY }, root => {
    assert.equal(run(root).code, 0);
  });
});

test('a bad ref is a loud error, not a pass', () => {
  withFixture({ 'src/a.ts': WITH_WHY }, { 'src/a.ts': WITHOUT_WHY }, root => {
    const { code, text } = run(root, ['--base', 'no-such-ref']);
    assert.equal(code, 1);
    assert.match(text, /^why-comments: /);
  });
});

test('--merge-base diffs from the common ancestor', () => {
  withFixture({ 'src/a.ts': WITH_WHY }, { 'src/a.ts': WITHOUT_WHY }, root => {
    assert.equal(run(root, ['--merge-base', '--base', 'HEAD~1']).code, 1);
  });
});

test('an unknown flag is rejected', () => {
  assert.equal(run('/nonexistent', ['--nope']).code, 1);
});

test('lexer: comment markers inside strings, templates and regexes are not comments', () => {
  const src = [
    "const a = 'http://x.test'; // real comment one two three four",
    'const b = `// not ${"a"} comment ${`/* nested */`}`;',
    'const c = /[/*]+\\//g.test(a);',
    'const d = x / y; // after division one two three',
  ].join('\n');
  assert.deepEqual(extractComments(src).map(c => c.text), ['// real comment one two three four', '// after division one two three']);
});

test('lexer: consecutive standalone line comments form one block; trailing ones stay apart', () => {
  const src = '// one\n// two\ncode(); // tail\n\n// three\n/** doc\n * more */\n';
  const blocks = extractComments(src);
  assert.deepEqual(blocks.map(b => [b.startLine, b.endLine]), [[1, 2], [3, 3], [5, 5], [6, 7]]);
});

test('lexer: an apostrophe in JSX text cannot swallow later comments', () => {
  const src = "const el = <p>don't stop</p>;\n// a later comment with four words\n";
  assert.equal(extractComments(src).length, 1);
});

test('normalizeText ignores markers, case and whitespace; classifyBlock gives a stable id', () => {
  assert.equal(normalizeText('/**\n * Hello\n *   World\n */'), 'hello world');
  const a = classifyBlock('// Retry once because upstream drops it');
  const b = classifyBlock('/* retry once   because upstream\n drops it */');
  assert.equal(a.id, b.id);
});

test('parseDiff reads removed ranges and treats "+++" content lines as content', () => {
  const diff = 'diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -3,2 +3,1 @@\n-a\n-b\n+++ not a header\n@@ -9 +8,0 @@\n-z\n';
  const parsed = parseDiff(diff);
  assert.deepEqual(parsed.files, [{ oldPath: 'x.ts', ranges: [[3, 4], [9, 9]] }]);
  assert.deepEqual(parsed.addedTexts, ['++ not a header']);
});

test('parseDebt rejects a malformed file', () => {
  assert.throws(() => parseDebt('{}'), /allow/);
  assert.equal(parseDebt('{"allow":[{"id":"a","reason":"r"}]}').get('a'), 'r');
});
