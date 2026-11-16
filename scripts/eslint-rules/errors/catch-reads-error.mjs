/**
 * Error gate, rule 1: a `catch` clause or a `.catch(handler)` must read the caught value.
 *
 * One exemption, the pure-parse refusal: the `try` block has no `await`, `yield` or `for await`,
 * every call or `new` in it is a built-in parser or decoder, a built-in string / array / regex
 * method (by member name; there is no type information), a bare `new Error()` used to jump to the
 * catch, or a function on the reviewed `pureHelpers` list, and the `catch` block is not empty. The
 * only possible cause there is a `SyntaxError` that quotes the input, so dropping it is the safe
 * choice. A comment does not excuse an empty catch.
 *
 * Limits, so nobody over-trusts this: reading the value is not handling it; a caught value is not
 * followed through helper functions; member names are not types.
 */
const PARSERS = new Set(['JSON.parse', 'decodeURIComponent', 'decodeURI', 'atob', 'btoa', 'Number', 'BigInt', 'String', 'Boolean',
  'parseInt', 'parseFloat', 'Number.parseInt', 'Number.parseFloat', 'Object.keys', 'Object.entries', 'Object.values', 'Array.isArray', 'Array.from']);
const CONSTRUCTORS = new Set(['URL', 'URLSearchParams', 'TextDecoder', 'TextEncoder', 'RegExp', 'Date', 'Set', 'Map']);
const METHODS = new Set(['decode', 'encode', 'trim', 'trimStart', 'trimEnd', 'slice', 'split', 'join', 'map', 'filter', 'find', 'some', 'every',
  'includes', 'startsWith', 'endsWith', 'indexOf', 'replace', 'replaceAll', 'match', 'matchAll', 'test', 'exec', 'toLowerCase', 'toUpperCase',
  'toString', 'padStart', 'padEnd', 'at', 'charAt', 'charCodeAt', 'substring', 'concat', 'flat', 'flatMap', 'reduce', 'keys', 'values', 'entries',
  'get', 'has', 'push', 'normalize', 'localeCompare', 'isInteger', 'isFinite', 'isSafeInteger', 'isNaN']);
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const ASYNC_NODES = new Set(['AwaitExpression', 'YieldExpression']);

function calleeName(callee) {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier') return `${callee.object.name}.${callee.property.name}`;
  return undefined;
}

/** True when `name` is imported from a module the reviewed list names for it. */
function isPureHelper({ name, imports, pureHelpers }) {
  const source = imports.get(name);
  return source !== undefined && pureHelpers.some(helper => helper.name === name && source.endsWith(helper.module));
}

function isAllowedCall({ node, imports, pureHelpers }) {
  const name = calleeName(node.callee);
  if (node.type === 'NewExpression') return (name === 'Error' && node.arguments.length === 0) || CONSTRUCTORS.has(name);
  if (PARSERS.has(name) || (name !== undefined && isPureHelper({ name, imports, pureHelpers }))) return true;
  return node.callee.type === 'MemberExpression' && !node.callee.computed && METHODS.has(node.callee.property.name);
}

/** Walks a block without entering nested functions (their awaits and calls run elsewhere). */
function everyNode({ node, visitorKeys, check }) {
  if (!check(node)) return false;
  for (const key of visitorKeys[node.type] ?? []) {
    const children = [node[key]].flat().filter(child => child && typeof child.type === 'string' && !FUNCTIONS.has(child.type));
    if (!children.every(child => everyNode({ node: child, visitorKeys, check }))) return false;
  }
  return true;
}

function isPureParse({ tryBlock, handler, visitorKeys, imports, pureHelpers }) {
  if (handler.body.body.length === 0) return false;
  return everyNode({ node: tryBlock, visitorKeys, check: node => {
    if (ASYNC_NODES.has(node.type) || (node.type === 'ForOfStatement' && node.await)) return false;
    return (node.type !== 'CallExpression' && node.type !== 'NewExpression') || isAllowedCall({ node, imports, pureHelpers });
  } });
}

function readsValue({ node, sourceCode }) {
  return sourceCode.getDeclaredVariables(node).some(variable => variable.references.length > 0);
}

export default {
  meta: {
    type: 'problem',
    schema: [{ type: 'object', additionalProperties: false, properties: {
      pureHelpers: { type: 'array', items: { type: 'object', required: ['name', 'module'], properties: { name: { type: 'string' }, module: { type: 'string' } } } },
    } }],
    messages: {
      unread: 'This {{kind}} never reads the caught error. Report it, rethrow it with { cause }, or use a named idiom (observed, afterSettled, orFallback, bestEffort, absentWhen).',
    },
  },
  create(context) {
    const { sourceCode } = context;
    const pureHelpers = context.options[0]?.pureHelpers ?? [];
    const imports = new Map();
    return {
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) imports.set(specifier.local.name, String(node.source.value).replace(/\.(m?[jt]sx?)$/, ''));
      },
      CatchClause(node) {
        if (node.param !== null && readsValue({ node, sourceCode })) return;
        if (isPureParse({ tryBlock: node.parent.block, handler: node, visitorKeys: sourceCode.visitorKeys, imports, pureHelpers })) return;
        context.report({ node, messageId: 'unread', data: { kind: 'catch block' } });
      },
      'CallExpression[callee.property.name="catch"]'(node) {
        const handler = node.arguments[0];
        if (node.arguments.length !== 1 || !FUNCTIONS.has(handler.type)) return;
        if (handler.params.length > 0 && readsValue({ node: handler, sourceCode })) return;
        context.report({ node: handler, messageId: 'unread', data: { kind: '.catch handler' } });
      },
    };
  },
};
