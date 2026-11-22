/**
 * Error gate, rule 3: inside a `catch` (a clause, or an inline `.catch(handler)`), failure words do
 * not come from a string written on the spot.
 *
 * - Text passed to `res.status(5xx).json(...)`, to a `set*Error(...)` call or to `store.set(...)` is
 *   an error: an unexpected failure is described by the reporter (words + error ID), not by a fixed
 *   sentence with no record behind it.
 * - `new X("...")` thrown or built there without `{ cause }` is an error, unless the same catch hands
 *   the caught value to `reporter.record`, `reporter.describe`, a logger call or a named idiom. That
 *   exception is the deliberate "record privately, throw sanitised" shape (a cause can hold secrets).
 * - Precedence step 2: a pure-parse refusal (rule 1's test) satisfies the cause clause. Its only
 *   possible cause is a `SyntaxError` that quotes the input, so dropping it is the safe choice.
 *
 * "Text" is a string or template with words in it; a constant-token code (`VALIDATION_ERROR`) is not
 * text. Limits: a call nested in another function inside the catch is not followed; names are not
 * types (`store`, `reporter` and `logger` are recognised by name).
 */
import { createPureParseCheck, pureHelpersSchema } from './catch-reads-error.mjs';

const CODE_TOKEN = /^[A-Z][A-Z0-9_]{0,63}$/;
const IDIOMS = new Set(['observed', 'afterSettled', 'orFallback', 'orFallbackSync', 'bestEffort', 'absentWhen']);
const LOG_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
/** Containers a text value sits in; a nested call owns its own arguments. */
const VALUE_KEYS = { ObjectExpression: ['properties'], Property: ['value'], ArrayExpression: ['elements'], ConditionalExpression: ['consequent', 'alternate'],
  LogicalExpression: ['left', 'right'], TSAsExpression: ['expression'], TSSatisfiesExpression: ['expression'], BinaryExpression: ['left', 'right'] };

function isText(node) {
  if (node.type === 'Literal') return typeof node.value === 'string' && node.value.trim() !== '' && !CODE_TOKEN.test(node.value);
  return node.type === 'TemplateLiteral' && node.quasis.some(quasi => (quasi.value.cooked ?? '').trim() !== '');
}

function hasText(node) {
  if (!node) return false;
  return isText(node) || (VALUE_KEYS[node.type] ?? []).some(key => [node[key]].flat().some(hasText));
}

const memberName = node => (node?.type === 'MemberExpression' && !node.computed ? node.property.name : node?.type === 'Identifier' ? node.name : undefined);
const ownerName = callee => (callee.type === 'MemberExpression' ? memberName(callee.object) : undefined);

function isServerErrorJson(node) {
  const status = node.callee.type === 'MemberExpression' && memberName(node.callee) === 'json' ? node.callee.object : undefined;
  if (status?.type !== 'CallExpression' || memberName(status.callee) !== 'status') return false;
  const code = status.arguments[0];
  return code?.type === 'Literal' && typeof code.value === 'number' && code.value >= 500 && code.value <= 599;
}

function isErrorStateSetter(node) {
  const name = memberName(node.callee);
  if (name === undefined) return false;
  return /^set\w*Error$/.test(name) || (name === 'set' && /^(store|\w+Store)$/.test(ownerName(node.callee) ?? ''));
}

/** A call that records the failure: `reporter.record` / `reporter.describe`, a logger level, or a named idiom. */
function isRecordingCall(node) {
  const name = memberName(node.callee);
  const owner = ownerName(node.callee) ?? '';
  if (IDIOMS.has(name)) return true;
  if ((name === 'record' || name === 'describe') && /reporter$/i.test(owner)) return true;
  return LOG_LEVELS.has(name) && /log(ger)?$/i.test(owner);
}

const hasCause = node => node.arguments.some(argument => argument.type === 'ObjectExpression'
  && argument.properties.some(property => property.type === 'Property' && memberName(property.key) === 'cause'));

/** The catch a node runs in: the nearest clause, or the inline handler of a `.catch(...)`. */
function enclosingCatch(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === 'CatchClause') return current;
    if (!FUNCTIONS.has(current.type)) continue;
    const call = current.parent;
    const isHandler = call?.type === 'CallExpression' && call.arguments[0] === current && memberName(call.callee) === 'catch' && call.callee.type === 'MemberExpression';
    return isHandler ? current : undefined;
  }
  return undefined;
}

export default {
  meta: {
    type: 'problem',
    schema: [{ type: 'object', additionalProperties: false, properties: { pureHelpers: pureHelpersSchema } }],
    messages: {
      serverText: 'A 5xx answer written in a catch. Describe the failure with the reporter (its words carry the error ID) instead of a fixed sentence.',
      stateText: 'Failure words written in a catch and put into state. Report the failure (notice with error ID and Copy details), or show a refusal\'s own sentence.',
      noCause: 'A new error built in a catch without { cause }. Pass the caught error as the cause, or hand it to the reporter, a logger or a named idiom before throwing sanitised words.',
    },
  },
  create(context) {
    const { sourceCode } = context;
    const pureParse = createPureParseCheck({ context });
    /** True when a recording call inside this catch receives the caught value. */
    const handsOver = handler => sourceCode.getDeclaredVariables(handler).some(variable => variable.references.some(reference => {
      for (let current = reference.identifier.parent; current && current !== handler; current = current.parent) {
        if (current.type === 'CallExpression' && isRecordingCall(current)) return true;
      }
      return false;
    }));
    return {
      ImportDeclaration: pureParse.ImportDeclaration,
      CallExpression(node) {
        if (!node.arguments.some(hasText) || enclosingCatch(node) === undefined) return;
        if (isServerErrorJson(node)) context.report({ node, messageId: 'serverText' });
        else if (isErrorStateSetter(node)) context.report({ node, messageId: 'stateText' });
      },
      NewExpression(node) {
        const thrownOrError = node.parent.type === 'ThrowStatement' || /Error$/.test(memberName(node.callee) ?? '');
        if (!thrownOrError || !node.arguments.some(hasText) || hasCause(node)) return;
        const handler = enclosingCatch(node);
        if (handler === undefined || pureParse.isPureParse({ handler }) || handsOver(handler)) return;
        context.report({ node, messageId: 'noCause' });
      },
    };
  },
};
