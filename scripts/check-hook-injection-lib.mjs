/**
 * AST scan for the hook-injection rule (owner HARD rule 2026-11-16): a React component must receive every
 * custom hook as a prop (defaulted to the real hook, or required and supplied by the host), `function X({ useFooHook = useFoo }) { useFooHook(); }`.
 * React built-ins are exempt. Uses the TypeScript compiler API, never regex, to find component bodies.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const BUILTIN_HOOKS = new Set([
  'useState', 'useEffect', 'useRef', 'useMemo', 'useCallback', 'useContext', 'useId', 'useReducer',
  'useLayoutEffect', 'useSyncExternalStore', 'useTransition', 'useDeferredValue', 'useImperativeHandle',
  'useInsertionEffect', 'useOptimistic', 'useActionState', 'useFormStatus', 'use', 'useDebugValue',
]);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'test', 'tests', '__tests__', '__mocks__', '.git']);
const SKIP_FILE = /\.(test|spec|stories)\./;
const HOOK_NAME = /^use[A-Z]/;
const COMPONENT_NAME = /^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/;
const WRAPPERS = new Set(['memo', 'forwardRef']);

function calleeName(expr) {
  if (ts.isIdentifier(expr)) return expr.text;
  return ts.isPropertyAccessExpression(expr) ? expr.name.text : undefined;
}

function stripWrappers(node) {
  let current = node;
  while (current && (ts.isParenthesizedExpression(current) || ts.isAsExpression(current))) current = current.expression;
  return current;
}

/** The function behind `const X = memo(forwardRef(() => ...))`, or the function itself. */
function componentFunction(init) {
  let node = stripWrappers(init);
  while (node && ts.isCallExpression(node) && WRAPPERS.has(calleeName(node.expression))) node = stripWrappers(node.arguments[0]);
  return node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) ? node : undefined;
}

function declaredComponent(node) {
  if (ts.isFunctionDeclaration(node) && node.name && node.body) return { name: node.name.text, fn: node };
  if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer) return undefined;
  const fn = componentFunction(node.initializer);
  return fn ? { name: node.name.text, fn } : undefined;
}

function findComponents(sf) {
  const found = [];
  const visit = node => {
    const component = declaredComponent(node);
    if (component && COMPONENT_NAME.test(component.name)) found.push(component);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const isHookBinding = el => ts.isIdentifier(el.name) && HOOK_NAME.test(el.name.text);

/** Hook-named bindings of a destructuring pattern, nested patterns included; defaulted or required alike. */
function patternHooks(pattern) {
  const names = [];
  for (const el of pattern.elements) {
    if (ts.isOmittedExpression(el)) continue;
    if (isHookBinding(el)) names.push(el.name.text);
    else if (ts.isObjectBindingPattern(el.name) || ts.isArrayBindingPattern(el.name)) names.push(...patternHooks(el.name));
  }
  return names;
}

/** Plain parameter identifiers, the targets of `const { useFoo } = props` inside the body. */
function parameterNames(fn) {
  return new Set(fn.parameters.map(p => p.name).filter(ts.isIdentifier).map(id => id.text));
}

function bodyDestructuredHooks(fn) {
  const params = parameterNames(fn);
  const names = [];
  const visit = node => {
    if (node !== fn && (ts.isFunctionLike(node) || ts.isClassLike(node))) return;
    const from = ts.isVariableDeclaration(node) && node.initializer ? stripWrappers(node.initializer) : undefined;
    if (from && ts.isObjectBindingPattern(node.name) && ts.isIdentifier(from) && params.has(from.text)) names.push(...patternHooks(node.name));
    ts.forEachChild(node, visit);
  };
  if (fn.body) ts.forEachChild(fn.body, visit);
  return names;
}

/**
 * Hooks the host supplies instead of the component importing them: a hook-named destructured prop or
 * parameter (defaulted `{ useFooHook = useFoo }` or REQUIRED `{ useFoo }`), a hook-named plain parameter, or
 * `const { useFoo } = props`. `props.useFoo()` is a property access and is never flagged to begin with.
 */
function injectedHooks(fn) {
  const names = [];
  for (const param of fn.parameters) {
    if (ts.isIdentifier(param.name)) {
      if (HOOK_NAME.test(param.name.text)) names.push(param.name.text);
    } else names.push(...patternHooks(param.name));
  }
  return new Set([...names, ...bodyDestructuredHooks(fn)]);
}

function isFlaggedHookCall(node, injected) {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return false;
  const name = node.expression.text;
  return HOOK_NAME.test(name) && !BUILTIN_HOOKS.has(name) && !injected.has(name);
}

function hookCallsIn({ fn, component }, sf, componentFns) {
  const injected = injectedHooks(fn);
  const calls = [];
  const visit = node => {
    if (node !== fn && componentFns.has(node)) return;
    if (isFlaggedHookCall(node, injected)) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      calls.push({ file: sf.fileName, line, component, hook: node.expression.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(fn);
  return calls;
}

/** Every custom-hook call a React component makes without receiving that hook as a defaulted prop. */
export function scanSource(fileName, text) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const components = findComponents(sf);
  const componentFns = new Set(components.map(c => c.fn));
  return components.flatMap(c => hookCallsIn({ fn: c.fn, component: c.name }, sf, componentFns));
}

function walk(dir, rel, include) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) files.push(...walk(path.join(dir, entry.name), childRel, include));
    else if (entry.isFile() && entry.name.endsWith('.tsx') && !SKIP_FILE.test(entry.name) && include.test(childRel)) files.push(childRel);
  }
  return files;
}

export function listSourceFiles(root, { areas, include }) {
  const present = areas.filter(area => { try { return readdirSync(path.join(root, area)).length >= 0; } catch { return false; } });
  return present.flatMap(area => walk(path.join(root, area), area, include)).sort();
}

export function scanRoot(root, scope) {
  return listSourceFiles(root, scope).flatMap(rel => scanSource(rel, readFileSync(path.join(root, rel), 'utf8')));
}
