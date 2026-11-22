/**
 * @file Relation 1 of the error catalog: the plain words for one error code (what failed, what to
 * do next) with its HTTP status. One definition per code.
 *
 * This is the only module a feature's `*.sentences.ts` file may import, and the admin bundle
 * imports those files, so this module imports nothing: no error class, no server code.
 * Class-to-code bindings live in `bindings.ts`, which is server-side.
 */

/** Who may read a sentence's words: any caller, or only one authorised for the operation. */
export type SentenceAudience = 'anyone' | 'authorized';

/** The plain words for one error code. English source text; `{name}` placeholders only. */
export interface ErrorSentence {
  /** HTTP status at a route boundary. */
  readonly status: number;
  readonly retryable: boolean;
  /** What failed. */
  readonly message: string;
  /** What to do next. */
  readonly action: string;
  readonly audience: SentenceAudience;
}

/** One feature's sentences. Every code starts with the set's `domain` prefix. */
export interface ErrorSentenceSet {
  readonly domain: string;
  readonly codes: Readonly<Record<string, ErrorSentence>>;
}

/** Options of {@link defineErrorSentences}. None yet; named so one can be added without changing the signature. */
export interface ErrorSentenceOptions {}
/** Options of {@link interpolateSentence}. */
export interface InterpolateSentenceOptions {
  /** Values for the `{name}` placeholders. A placeholder with no value is left as written. */
  readonly params?: Readonly<Record<string, string | number>>;
}

/** A constant token: the only shape a catalog code may have (the log describer's own rule). */
const CONSTANT_TOKEN = /^[A-Z][A-Z0-9_]{0,63}$/;
const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]{0,31})\}/g;

/** True for a code the catalog accepts: `[A-Z][A-Z0-9_]*`, at most 64 characters. */
export function isErrorCodeToken(required: { code: unknown }, _optional: ErrorSentenceOptions = {}): boolean {
  return typeof required.code === 'string' && CONSTANT_TOKEN.test(required.code);
}

function wordsProblem({ code, sentence }: { code: string; sentence: ErrorSentence }): string | undefined {
  if (typeof sentence.message !== 'string' || !sentence.message.trim()) return `"${code}" needs a message that says what failed`;
  if (typeof sentence.action !== 'string' || !sentence.action.trim()) return `"${code}" needs an action that says what to do next`;
  return undefined;
}

function sentenceProblem({ code, sentence }: { code: string; sentence: ErrorSentence }): string | undefined {
  if (!Number.isInteger(sentence.status) || sentence.status < 400 || sentence.status > 599) return `"${code}" needs an HTTP status from 400 to 599`;
  if (typeof sentence.retryable !== 'boolean') return `"${code}" needs retryable to be true or false`;
  if (sentence.audience !== 'anyone' && sentence.audience !== 'authorized') return `"${code}" needs audience "anyone" or "authorized"`;
  return wordsProblem({ code, sentence });
}

function buildSet({ domain, codes, prefixed }: { domain: string; codes: Readonly<Record<string, ErrorSentence>>; prefixed: boolean }): ErrorSentenceSet {
  if (!isErrorCodeToken({ code: domain })) throw new TypeError(`Error sentences: the domain "${String(domain)}" must be a constant token like MEMBERS.`);
  const checked: Record<string, ErrorSentence> = {};
  for (const [code, sentence] of Object.entries(codes)) {
    if (!isErrorCodeToken({ code })) throw new TypeError(`Error sentences (${domain}): the code "${code}" must be a constant token like ${domain}_NOT_FOUND.`);
    if (prefixed && !code.startsWith(`${domain}_`)) throw new TypeError(`Error sentences (${domain}): the code "${code}" must start with "${domain}_". Shared generic codes are defined only by core.`);
    const problem = sentenceProblem({ code, sentence });
    if (problem !== undefined) throw new TypeError(`Error sentences (${domain}): ${problem}.`);
    checked[code] = Object.freeze({ ...sentence });
  }
  return Object.freeze({ domain, codes: Object.freeze(checked) });
}

/**
 * Declares one feature's sentences. A code is a constant token and starts with `<domain>_`, so a
 * feature cannot give words to a shared generic code (`RESOURCE_CONFLICT` means different things in
 * different domains; its words belong to each feature's own namespaced code).
 * @throws TypeError for a code, status or text of the wrong shape (a programming error, found at load).
 * @example defineErrorSentences({ domain: 'MEMBERS', codes: { MEMBERS_NOT_FOUND: { status: 404, retryable: false, message: 'That member does not exist.', action: 'Check the member list and try again.', audience: 'anyone' } } })
 * @complexity O(codes).
 */
export function defineErrorSentences(
  required: { domain: string; codes: Readonly<Record<string, ErrorSentence>> }, _optional: ErrorSentenceOptions = {},
): ErrorSentenceSet {
  return buildSet({ ...required, prefixed: true });
}

const VERSION_CONFLICT_SENTENCE: ErrorSentence = {
  status: 409, retryable: false, audience: 'anyone',
  message: 'This record was changed by someone else after you opened it, so nothing was saved.',
  action: 'Reload it to see the latest version, then make your change again.',
};

/**
 * Core's own set: the generic version codes every domain shares. Built here, without the prefix
 * rule, because no exported function can define an unprefixed code. `CONCURRENT_EDIT` is a legacy
 * generic code with the same sentence as `VERSION_CONFLICT`: two domains answer with it today, so
 * no feature set may define it. The two version literals equal `VERSION_CONFLICT_CODE` and
 * `VERSION_REQUIRED_CODE` in `optimistic-concurrency.ts` (a test holds them together; this file
 * imports nothing).
 */
export const CORE_ERROR_SENTENCES: ErrorSentenceSet = buildSet({
  domain: 'CORE', prefixed: false,
  codes: {
    VERSION_CONFLICT: VERSION_CONFLICT_SENTENCE,
    CONCURRENT_EDIT: VERSION_CONFLICT_SENTENCE,
    VERSION_REQUIRED: {
      status: 428, retryable: false, audience: 'anyone',
      message: "This save did not say which version you were editing, so nothing was saved (it could have overwritten someone else's change).",
      action: 'Reload, make your change again, and save.',
    },
  },
});

/**
 * Fills a sentence's `{name}` placeholders. Used by the server for the English wire message and by
 * a client after translating the source text. A placeholder with no value stays as written.
 * @complexity O(text length).
 */
export function interpolateSentence(required: { text: string }, optional: InterpolateSentenceOptions = {}): string {
  const params = optional.params ?? {};
  return required.text.replace(PLACEHOLDER, (whole, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : whole));
}
