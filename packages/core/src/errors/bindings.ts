/**
 * @file Relation 2 of the error catalog: "in this scope, this error class means this code".
 * Bindings are grouped by scope, ordered, and many-to-many on purpose: one class can mean different
 * codes in different scopes, two classes can share a code, and one class can carry several codes
 * through a discriminant. Server-side: a bindings file imports the feature's error classes, so the
 * browser never imports it (the words live in `sentences.ts`).
 */
import { isErrorCodeToken } from './sentences.js';

/** Any error class, whatever its constructor takes. */
export type ErrorClass = abstract new (...args: never[]) => Error;

/**
 * Which words a binding publishes:
 * - `own-message`: the error's own message. Correct only when every construction site builds that
 *   message from fixed text and the caller's own input.
 * - `fixed`: this text instead, for a class whose kind is safe to name but whose message is not.
 * - `sentence`: the catalog sentence for the code, with optional values for its placeholders.
 */
export type ErrorText =
  | { readonly mode: 'own-message' }
  | { readonly mode: 'fixed'; readonly text: string }
  | { readonly mode: 'sentence'; readonly params?: (required: { error: Error }) => Readonly<Record<string, string | number>> };

/** One class means one code. */
export interface ClassErrorBinding {
  readonly error: ErrorClass;
  readonly code: string;
  readonly text: ErrorText;
  /** Recovery guidance for the model, appended after the message. */
  readonly guidance?: string;
  /** The fixed label this class is logged as. Never read from the value: a class name is text. */
  readonly label?: string;
}
/** One class carries several codes; `codeOf` picks one, and only a value in `codes` is accepted. */
export interface DiscriminantErrorBinding {
  readonly error: ErrorClass;
  readonly codes: readonly string[];
  readonly text: ErrorText;
  readonly label?: string;
  readonly codeOf: (required: { error: Error }) => string | undefined;
}
export type ErrorBinding = ClassErrorBinding | DiscriminantErrorBinding;

/** The bindings of one scope, in the order they are tried. First `instanceof` match wins. */
export interface ErrorScope {
  readonly scope: string;
  readonly bindings: readonly ErrorBinding[];
}
/** Options of {@link defineErrorScope}. None yet; named so one can be added without changing the signature. */
export interface ErrorScopeOptions {}

const SCOPE_NAME = /^[a-z][a-z0-9-]{0,63}$/;
const CLASS_LABEL = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const TEXT_MODES: ReadonlySet<string> = new Set(['own-message', 'fixed', 'sentence']);

function textProblem({ text }: { text: ErrorText }): string | undefined {
  if (typeof text !== 'object' || text === null || !TEXT_MODES.has(text.mode)) return 'text.mode must be "own-message", "fixed" or "sentence"';
  if (text.mode === 'fixed' && (typeof text.text !== 'string' || !text.text.trim())) return 'a "fixed" text needs the words to publish';
  if (text.mode === 'sentence' && text.params !== undefined && typeof text.params !== 'function') return 'text.params must be a function';
  return undefined;
}

function codesProblem({ binding }: { binding: ErrorBinding }): string | undefined {
  if (!('codes' in binding)) {
    return isErrorCodeToken({ code: binding.code }) ? undefined : `the code "${String(binding.code)}" must be a constant token like MEMBERS_NOT_FOUND`;
  }
  if (typeof binding.codeOf !== 'function') return 'a binding with "codes" needs a codeOf function';
  if (!Array.isArray(binding.codes) || binding.codes.length === 0) return 'a binding with codeOf needs a non-empty "codes" list';
  const bad = binding.codes.find(code => !isErrorCodeToken({ code }));
  return bad === undefined ? undefined : `the code "${String(bad)}" must be a constant token like FORM_DELIVERY_RATE_LIMITED`;
}

function bindingProblem({ binding }: { binding: ErrorBinding }): string | undefined {
  if (typeof binding !== 'object' || binding === null || typeof binding.error !== 'function') return 'each binding needs an error class';
  if (binding.label !== undefined && !CLASS_LABEL.test(binding.label)) return 'a label must be an identifier like MemberNotFoundError';
  return codesProblem({ binding }) ?? textProblem({ text: binding.text });
}

/**
 * Declares the bindings of one scope. Order matters: list a subclass before its superclass (the
 * catalog rejects the reverse, because the later binding could never match).
 * @throws TypeError for a scope name, code, label or text of the wrong shape (a programming error, found at load).
 * @example defineErrorScope({ scope: 'members', bindings: [{ error: MemberNotFoundError, code: 'MEMBERS_NOT_FOUND', text: { mode: 'own-message' } }] })
 * @complexity O(bindings).
 */
export function defineErrorScope(required: { scope: string; bindings: readonly ErrorBinding[] }, _optional: ErrorScopeOptions = {}): ErrorScope {
  const { scope, bindings } = required;
  if (typeof scope !== 'string' || !SCOPE_NAME.test(scope)) throw new TypeError(`Error scope: the name "${String(scope)}" must be lower-case words joined by hyphens, like "content-post".`);
  bindings.forEach((binding, index) => {
    const problem = bindingProblem({ binding });
    if (problem !== undefined) throw new TypeError(`Error scope "${scope}", binding ${index + 1}: ${problem}.`);
  });
  return Object.freeze({ scope, bindings: Object.freeze(bindings.map(binding => Object.freeze({ ...binding }))) });
}
