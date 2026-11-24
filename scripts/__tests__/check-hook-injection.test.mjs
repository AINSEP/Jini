import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanSource } from '../check-hook-injection-lib.mjs';
import { runCli } from '../check-hook-injection.mjs';

const keys = findings => findings.map(f => `${f.component}::${f.hook}`);

test('a hook received as a prop defaulted to the real hook is not flagged', () => {
  const src = `export function Bar({ useFooHook = useFoo }) { const foo = useFooHook(); return <i>{foo}</i>; }`;
  assert.deepEqual(scanSource('Bar.tsx', src), []);
});

test('a hook received as a REQUIRED prop (no default, the host binds it) is not flagged', () => {
  const src = `export function Bar({ useFooHook, ...props }: { useFooHook: () => number }) { const foo = useFooHook(); return <i>{foo}</i>; }`;
  assert.deepEqual(scanSource('Bar.tsx', src), []);
});

test('a direct imported custom hook call is flagged with file line, component and hook', () => {
  const src = `import { useFoo } from './foo';\nexport function Bar() {\n  const foo = useFoo();\n  return <i>{foo}</i>;\n}`;
  assert.deepEqual(scanSource('Bar.tsx', src), [{ file: 'Bar.tsx', line: 3, component: 'Bar', hook: 'useFoo' }]);
});

test('a same-file custom hook is flagged', () => {
  const src = `function useLocal() { return 1; }\nconst Bar = () => { const n = useLocal(); return <i>{n}</i>; };`;
  assert.deepEqual(keys(scanSource('Bar.tsx', src)), ['Bar::useLocal']);
});

test('useT and useAdminLocale are not exempt', () => {
  const src = `function Bar() { const t = useT(); const l = useAdminLocale(); return <i>{t('a')}{l}</i>; }`;
  assert.deepEqual(keys(scanSource('Bar.tsx', src)), ['Bar::useT', 'Bar::useAdminLocale']);
});

test('React built-in hooks are exempt', () => {
  const src = `function Bar() { const [a] = useState(0); useEffect(() => {}, []); const r = useRef(null); useMemo(() => 1, []); useCallback(() => 1, []); useContext(X); useId(); return <i>{a}</i>; }`;
  assert.deepEqual(scanSource('Bar.tsx', src), []);
});

test('memo and forwardRef wrapped components are flagged', () => {
  const src = `const Alpha = memo(function Alpha() { useFoo(); return null; });\nconst Beta = React.memo(forwardRef((props, ref) => { useBar(); return null; }));`;
  assert.deepEqual(keys(scanSource('W.tsx', src)), ['Alpha::useFoo', 'Beta::useBar']);
});

test('lowercase functions and custom hook definitions are not components', () => {
  const src = `function useOuter() { return useInner(); }\nfunction helper() { return useFoo(); }`;
  assert.deepEqual(scanSource('h.tsx', src), []);
});

function makeRepo(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'hook-gate-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
}

function run(root, args) {
  const out = [];
  const code = runCli(['--root', root, '--baseline', path.join(root, 'debt.json'), ...args], { out: l => out.push(l), err: l => out.push(l) });
  return { code, text: out.join('\n') };
}

const bar = n => `export function Bar() {\n${'  useFoo();\n'.repeat(n)}  return null;\n}`;

test('--update writes the baseline keyed by component and hook; tests and node_modules are skipped', () => {
  const root = makeRepo({ 'packages/a/src/Bar.tsx': bar(2), 'packages/a/src/__tests__/X.tsx': bar(1), 'packages/a/node_modules/m/Y.tsx': bar(1), 'packages/a/src/Z.test.tsx': bar(1) });
  try {
    assert.equal(run(root, ['--update']).code, 0);
    const baseline = JSON.parse(readFileSync(path.join(root, 'debt.json'), 'utf8'));
    assert.deepEqual(baseline.entries, { 'Bar::useFoo': { count: 2, files: ['packages/a/src/Bar.tsx'] } });
    assert.equal(run(root, []).code, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a moved file with the same component is no new debt', () => {
  const root = makeRepo({ 'packages/a/src/Bar.tsx': bar(1) });
  try {
    run(root, ['--update']);
    rmSync(path.join(root, 'packages/a/src/Bar.tsx'));
    mkdirSync(path.join(root, 'packages/a/src/moved'), { recursive: true });
    writeFileSync(path.join(root, 'packages/a/src/moved/Bar.tsx'), bar(1));
    assert.equal(run(root, []).code, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a higher count fails and names file:line, component, hook and the fix pattern', () => {
  const root = makeRepo({ 'packages/a/src/Bar.tsx': bar(1) });
  try {
    run(root, ['--update']);
    writeFileSync(path.join(root, 'packages/a/src/Bar.tsx'), bar(2));
    const { code, text } = run(root, []);
    assert.equal(code, 1);
    assert.match(text, /packages\/a\/src\/Bar\.tsx:2/);
    assert.match(text, /Bar/);
    assert.match(text, /useFoo/);
    assert.match(text, /function Bar\(\{ useFooHook = useFoo \}\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a new key fails', () => {
  const root = makeRepo({ 'packages/a/src/Bar.tsx': bar(1) });
  try {
    run(root, ['--update']);
    writeFileSync(path.join(root, 'packages/a/src/Baz.tsx'), bar(1).replace('Bar', 'Baz'));
    const { code, text } = run(root, []);
    assert.equal(code, 1);
    assert.match(text, /Baz::useFoo/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a shrunk baseline passes and suggests --update', () => {
  const root = makeRepo({ 'packages/a/src/Bar.tsx': bar(2) });
  try {
    run(root, ['--update']);
    writeFileSync(path.join(root, 'packages/a/src/Bar.tsx'), bar(1));
    const { code, text } = run(root, []);
    assert.equal(code, 0);
    assert.match(text, /--update/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a missing baseline is a loud error, not a pass', () => {
  const root = makeRepo({ 'packages/a/src/Bar.tsx': bar(1) });
  try {
    const { code, text } = run(root, []);
    assert.equal(code, 1);
    assert.match(text, /debt\.json/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
