/**
 * Error gate, rule 1: a `catch` clause or a `.catch(handler)` must read the caught value.
 *
 * One exemption, the pure-parse refusal: the `try` block has no `await`, `yield` or `for await`,
 * every call or `new` in it is a built-in parser or decoder, a built-in string / array / regex
 * method (by member name; there is no type information), a built-in `new Error(...)` used to jump to
 * the catch, or a function on the reviewed `pureHelpers` list, and the `catch` block is not empty. The
 * only possible cause there is a `SyntaxError` that quotes the input, so dropping it is the safe
 * choice. A comment does not excuse an empty catch.
 *
 * Limits, so nobody over-trusts this: reading the value is not handling it; a caught value is not
 * followed through helper functions; member names are not types.
 */
import path from 'node:path';

// The lists below are the design's executable prototype (designs/error-system/work/fp-recheck.cjs), which
// was run on every site the exemption claims. Listed, never inferred from shape.
const PARSERS = new Set(['JSON.parse', 'decodeURIComponent', 'decodeURI', 'atob', 'btoa', 'BigInt', 'Number', 'String', 'Boolean',
  'Array.isArray', 'Array.from', 'Object.keys', 'Object.values', 'Object.entries', 'Object.fromEntries', 'Number.isFinite',
  'Number.isInteger', 'Number.isSafeInteger', 'Number.parseInt', 'Number.parseFloat', 'parseInt', 'parseFloat', 'URL.canParse',
  'Buffer.from', 'Buffer.concat', 'Buffer.byteLength', 'Date.parse', 'Math.min', 'Math.max', 'structuredClone']);
/** `new Error("shape")` and its built-in kin are how a parse block jumps to its own catch. */
const CONSTRUCTORS = new Set(['URL', 'URLSearchParams', 'TextDecoder', 'TextEncoder', 'RegExp', 'Date', 'Set', 'Map', 'Uint8Array',
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'Intl.Locale', 'Intl.DateTimeFormat', 'Intl.NumberFormat']);
const METHODS = new Set(['decode', 'encode', 'trim', 'trimStart', 'trimEnd', 'slice', 'split', 'join', 'map', 'filter', 'find', 'some', 'every',
  'includes', 'startsWith', 'endsWith', 'indexOf', 'lastIndexOf', 'replace', 'replaceAll', 'match', 'matchAll', 'test', 'exec', 'toLowerCase',
  'toUpperCase', 'toString', 'padStart', 'padEnd', 'at', 'charAt', 'charCodeAt', 'codePointAt', 'substring', 'concat', 'flat', 'flatMap',
  'reduce', 'sort', 'keys', 'values', 'entries', 'get', 'has', 'set', 'add', 'push', 'normalize', 'localeCompare', 'isInteger', 'isFinite',
  'isSafeInteger', 'isNaN', 'isArray', 'toISOString', 'getTime', 'format']);
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const ASYNC_NODES = new Set(['AwaitExpression', 'YieldExpression']);
const withoutExtension = file => String(file).split('\\').join('/').replace(/\.(m?[jt]sx?|c[jt]s)$/, '');
/** A relative import becomes the path of the file it names, so a listed module is a path, not a spelling. */
const importedModule = ({ source, filename }) => withoutExtension(String(source).startsWith('.') ? path.posix.join(path.posix.dirname(filename), String(source)) : source);

function calleeName(callee) {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed && callee.object.type === 'Identifier') return `${callee.object.name}.${callee.property.name}`;
  return undefined;
}

/**
 * True when `name` is the function the reviewed list means: imported from the listed module, or, when
 * this file does not import that name, declared in the listed module itself (several reviewed helpers
 * are private to the file that calls them). A same-named function from anywhere else does not qualify.
 */
function isPureHelper({ name, imports, pureHelpers, filename }) {
  const source = imports.get(name) ?? filename;
  return pureHelpers.some(helper => helper.name === name && source.endsWith(helper.module));
}

function isAllowedCall({ node, imports, pureHelpers, filename }) {
  const name = calleeName(node.callee);
  if (node.type === 'NewExpression') return CONSTRUCTORS.has(name);
  if (PARSERS.has(name) || (node.callee.type === 'Identifier' && isPureHelper({ name, imports, pureHelpers, filename }))) return true;
  // `Owner.method()` is a static call on a named owner: only the listed ones qualify, never by member name.
  // An ALL_CAPS receiver is a constant (a compiled regex, a decoder), so its member name decides, as for any value.
  if (name !== undefined && /^[A-Z]\w*[a-z]\w*\./.test(name)) return false;
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

/**
 * The pure-parse test, shared with rule 3 (precedence step 2: a pure-parse refusal also satisfies that
 * rule's cause clause). Returns the import listener the test needs and the test itself.
 */
export function createPureParseCheck({ context }) {
  const pureHelpers = context.options[0]?.pureHelpers ?? [];
  const lookup = { imports: new Map(), pureHelpers, filename: withoutExtension(context.filename) };
  return {
    ImportDeclaration(node) {
      for (const specifier of node.specifiers) lookup.imports.set(specifier.local.name, importedModule({ source: node.source.value, filename: lookup.filename }));
    },
    isPureParse({ handler }) {
      if (handler.type !== 'CatchClause' || handler.body.body.length === 0) return false;
      return everyNode({ node: handler.parent.block, visitorKeys: context.sourceCode.visitorKeys, check: node => {
        if (ASYNC_NODES.has(node.type) || (node.type === 'ForOfStatement' && node.await)) return false;
        return (node.type !== 'CallExpression' && node.type !== 'NewExpression') || isAllowedCall({ node, ...lookup });
      } });
    },
  };
}

function readsValue({ node, sourceCode }) {
  return sourceCode.getDeclaredVariables(node).some(variable => variable.references.length > 0);
}

export const pureHelpersSchema = { type: 'array', items: { type: 'object', required: ['name', 'module'], additionalProperties: false, properties: { name: { type: 'string' }, module: { type: 'string' } } } };

export default {
  meta: {
    type: 'problem',
    schema: [{ type: 'object', additionalProperties: false, properties: { pureHelpers: pureHelpersSchema } }],
    messages: {
      unread: 'This {{kind}} never reads the caught error. Report it, rethrow it with { cause }, or use a named idiom (observed, afterSettled, orFallback, bestEffort, absentWhen).',
    },
  },
  create(context) {
    const { sourceCode } = context;
    const pureParse = createPureParseCheck({ context });
    return {
      ImportDeclaration: pureParse.ImportDeclaration,
      CatchClause(node) {
        if (node.param !== null && readsValue({ node, sourceCode })) return;
        if (pureParse.isPureParse({ handler: node })) return;
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
