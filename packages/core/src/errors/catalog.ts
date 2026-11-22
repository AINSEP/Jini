/**
 * @file The error catalog: sentences keyed by code, bindings grouped by scope, and scoped lookup.
 * It feeds the three existing consumers of "this class is safe and its code is X" (model-facing
 * rules, caller-safe rules, the log describer) from one registration instead of adding a fourth.
 * Immutable after creation; matching runs on the failure path only.
 */
import type { CallerSafeErrorRule, ErrorDescriberVocabulary, ModelFacingErrorRule } from '../model-facing-tool-errors.js';
import type { Logger } from '../primitives/logger.js';
import type { ClassErrorBinding, ErrorBinding, ErrorClass, ErrorScope, ErrorText } from './bindings.js';
import type { ErrorSentence, ErrorSentenceSet } from './sentences.js';

/** What one error means in one scope. */
export interface ErrorMatch {
  readonly scope: string;
  readonly code: string;
  readonly mode: ErrorText['mode'];
  /** The words the binding publishes. `own-message`: the error's own message, which the binding's
   *  owner listed as built from fixed text and the caller's own input. `fixed`: the binding's text.
   *  Absent in `sentence` mode. */
  readonly message?: string;
  /** `sentence` mode: values for the sentence's placeholders (strings and numbers, at most 16). */
  readonly params?: Readonly<Record<string, string | number>>;
  /** The sentence for the code, when a set defines one. */
  readonly sentence?: ErrorSentence;
  readonly guidance?: string;
  readonly label?: string;
}

export interface ErrorCatalog {
  /** Bindings of ONE scope, in order, first match wins. Never searches another scope. No match means incident. */
  match(required: { error: unknown; scope: string }): ErrorMatch | undefined;
  sentence(required: { code: string }): ErrorSentence | undefined;
  /** The sentence's status; `undefined` means "use the caller's own table" (a status is never `0`). */
  statusFor(required: { error: { readonly code: string } }): number | undefined;
  modelFacingRules(required: { scope: string }): readonly ModelFacingErrorRule[];
  callerSafeRules(required: { scope: string }): readonly CallerSafeErrorRule[];
  /** Input for the unchanged `createErrorDescriber`: every catalog code, and each labelled class. */
  describerVocabulary(): ErrorDescriberVocabulary;
  /** Every source string a translation must cover (each message and action, once). */
  sourceSentences(): readonly string[];
}

/**
 * What to do when two sets define the same code, or two scopes share a name. `'throw'` (the
 * default) is for a conformance test that builds the full host catalog. `'warn'` is for production,
 * which keeps the first definition and never refuses to boot; it needs somewhere to write the warning.
 */
export type ErrorCatalogOptions =
  | { readonly onDuplicate?: 'throw' }
  | { readonly onDuplicate: 'warn'; readonly logger: Pick<Logger, 'warn'> };

const MAX_PARAMS = 16;

function reportDuplicate({ what, optional }: { what: string; optional: ErrorCatalogOptions }): void {
  if (optional.onDuplicate !== 'warn') throw new TypeError(`Error catalog: ${what}. Remove one definition.`);
  optional.logger.warn({ message: `[error-catalog] ${what}; keeping the first definition` });
}

function indexSentences({ sets, optional }: { sets: readonly ErrorSentenceSet[]; optional: ErrorCatalogOptions }): Map<string, ErrorSentence> {
  const byCode = new Map<string, ErrorSentence>();
  const owner = new Map<string, string>();
  for (const set of sets) {
    for (const [code, sentence] of Object.entries(set.codes)) {
      if (byCode.has(code)) reportDuplicate({ what: `the code "${code}" has a sentence in both "${owner.get(code)}" and "${set.domain}"`, optional });
      else { byCode.set(code, sentence); owner.set(code, set.domain); }
    }
  }
  return byCode;
}

/** An earlier binding of the same class or a superclass matches first, so the later one is dead. */
function assertReachable({ scope }: { scope: ErrorScope }): void {
  scope.bindings.forEach((later, index) => {
    const shadow = scope.bindings.slice(0, index).findIndex(earlier => later.error === earlier.error || later.error.prototype instanceof earlier.error);
    if (shadow !== -1) {
      throw new TypeError(`Error catalog: in scope "${scope.scope}", binding ${index + 1} can never match because binding ${shadow + 1} lists the same class or its superclass first. List the subclass first.`);
    }
  });
}

function indexScopes({ scopes, optional }: { scopes: readonly ErrorScope[]; optional: ErrorCatalogOptions }): Map<string, readonly ErrorBinding[]> {
  const byName = new Map<string, readonly ErrorBinding[]>();
  for (const scope of scopes) {
    assertReachable({ scope });
    if (byName.has(scope.scope)) reportDuplicate({ what: `the scope "${scope.scope}" is defined twice`, optional });
    else byName.set(scope.scope, scope.bindings);
  }
  return byName;
}

/** The binding's code. A discriminant's `codeOf` is feature code: a throw, or a value outside its own list, is no match. */
function resolveCode({ binding, error }: { binding: ErrorBinding; error: Error }): string | undefined {
  if (!('codes' in binding)) return binding.code;
  try {
    const code: unknown = binding.codeOf({ error });
    return typeof code === 'string' && binding.codes.includes(code) ? code : undefined;
  } catch {
    // Rule: a throwing discriminant means "not classified". The caller then treats the original
    // failure as an incident, which records that original error; nothing is lost.
    return undefined;
  }
}

function safeParams({ values }: { values: unknown }): Readonly<Record<string, string | number>> {
  if (typeof values !== 'object' || values === null) return {};
  const entries = Object.entries(values).filter((entry): entry is [string, string | number] => typeof entry[1] === 'string' || typeof entry[1] === 'number');
  return Object.fromEntries(entries.slice(0, MAX_PARAMS));
}

/** The words a matched binding publishes. A throwing `params` is no match, for the same reason as {@link resolveCode}. */
function resolveText({ text, error }: { text: ErrorText; error: Error }): Pick<ErrorMatch, 'mode' | 'message' | 'params'> | undefined {
  try {
    if (text.mode === 'fixed') return { mode: text.mode, message: text.text };
    if (text.mode === 'own-message') return { mode: text.mode };
    return text.params === undefined ? { mode: text.mode } : { mode: text.mode, params: safeParams({ values: text.params({ error }) }) };
  } catch {
    return undefined;
  }
}

function matchBinding(required: { error: unknown; scope: string; bindings: readonly ErrorBinding[]; sentences: ReadonlyMap<string, ErrorSentence> }): ErrorMatch | undefined {
  const { error, scope, bindings, sentences } = required;
  if (!(error instanceof Error)) return undefined;
  const binding = bindings.find(candidate => error instanceof candidate.error);
  if (binding === undefined) return undefined;
  const code = resolveCode({ binding, error });
  const text = code === undefined ? undefined : resolveText({ text: binding.text, error });
  if (code === undefined || text === undefined) return undefined;
  const sentence = sentences.get(code);
  return {
    scope, code, ...text,
    ...(sentence === undefined ? {} : { sentence }),
    ...('guidance' in binding && binding.guidance !== undefined ? { guidance: binding.guidance } : {}),
    ...(binding.label === undefined ? {} : { label: binding.label }),
  };
}

/** Class-to-code bindings that publish the error's own message or a fixed text: today's rule shapes. */
function ruleBindings({ bindings }: { bindings: readonly ErrorBinding[] }): readonly (ClassErrorBinding & { text: Exclude<ErrorText, { mode: 'sentence' }> })[] {
  return bindings.filter((binding): binding is ClassErrorBinding & { text: Exclude<ErrorText, { mode: 'sentence' }> } =>
    !('codes' in binding) && binding.text.mode !== 'sentence');
}

function vocabulary({ scopes, sentences }: { scopes: ReadonlyMap<string, readonly ErrorBinding[]>; sentences: ReadonlyMap<string, ErrorSentence> }): ErrorDescriberVocabulary {
  const codes = new Set<string>(sentences.keys());
  const labels = new Map<ErrorClass, string>();
  // The describer checks classes newest first; a scope lists subclasses first, so walk it backwards.
  const bindings = [...scopes.values()].flatMap(scope => [...scope].reverse());
  for (const binding of bindings) {
    for (const code of 'codes' in binding ? binding.codes : [binding.code]) codes.add(code);
    if (binding.label !== undefined && !labels.has(binding.error)) labels.set(binding.error, binding.label);
  }
  return { codes: [...codes], classes: [...labels].map(([error, label]) => ({ error, label })) };
}

/**
 * Builds the catalog from every feature's sentence sets and scopes.
 *
 * Lookup rules: the caller always names the scope and no other scope is searched; inside a scope the
 * first `instanceof` match wins (subclass before superclass); two bindings may share a code; a
 * discriminant's result counts only if it is in the binding's own list; an arbitrary error is never
 * matched by its own `code` property, which is caller-writable.
 *
 * Rules returned for the model and for returned results are field-for-field today's rule shapes:
 * `own-message` gives no `message` (the error's own message is published), `fixed` gives
 * `message: text`. `sentence`-mode and discriminant bindings are not in them, so such a class stays
 * unlisted for the model, which is the redacting default.
 *
 * @throws TypeError when a scope lists a superclass before its subclass, and (unless `onDuplicate: 'warn'`) for a duplicate sentence or scope.
 * @complexity O(codes + bindings²) to build; O(bindings in the scope) per match.
 */
export function createErrorCatalog(
  required: { sentences: readonly ErrorSentenceSet[]; scopes: readonly ErrorScope[] }, optional: ErrorCatalogOptions = {},
): ErrorCatalog {
  const sentences = indexSentences({ sets: required.sentences, optional });
  const scopes = indexScopes({ scopes: required.scopes, optional });
  const describer = vocabulary({ scopes, sentences });
  const source = [...new Set([...sentences.values()].flatMap(sentence => [sentence.message, sentence.action]))];
  return {
    match: ({ error, scope }) => {
      const bindings = scopes.get(scope);
      return bindings === undefined ? undefined : matchBinding({ error, scope, bindings, sentences });
    },
    sentence: ({ code }) => sentences.get(code),
    statusFor: ({ error }) => sentences.get(error.code)?.status,
    modelFacingRules: ({ scope }) => ruleBindings({ bindings: scopes.get(scope) ?? [] }).map(binding => ({
      error: binding.error, code: binding.code,
      ...(binding.text.mode === 'fixed' ? { message: binding.text.text } : {}),
      ...(binding.guidance === undefined ? {} : { guidance: binding.guidance }),
    })),
    callerSafeRules: ({ scope }) => ruleBindings({ bindings: scopes.get(scope) ?? [] }).filter(binding => binding.text.mode !== 'own-message').map(binding => ({
      error: binding.error, ...(binding.text.mode === 'fixed' ? { message: binding.text.text } : {}),
    })),
    describerVocabulary: () => describer,
    sourceSentences: () => source,
  };
}
