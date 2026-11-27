/**
 * @file Contract cases of the error catalog: the three relationships a class-first table cannot
 * hold (one class with many codes, one class with a different code per scope, two classes with one
 * code), binding order, and the rule that a thrown value's own `code` property is never trusted.
 * The classes here stand in for the real ones (a cms package, a host app), which core cannot import.
 */
import { describe, expect, test } from 'vitest';
import { createErrorDescriber, reclassifyToolError, callerSafeErrorMessage, ToolInputError } from '../../index.js';
import { VERSION_CONFLICT_CODE, VERSION_REQUIRED_CODE } from '../../optimistic-concurrency.js';
import { defineErrorScope, type ErrorBinding } from '../bindings.js';
import { createErrorCatalog } from '../catalog.js';
import { CORE_ERROR_SENTENCES, defineErrorSentences, interpolateSentence, type ErrorSentence } from '../sentences.js';

const LEDGER_CODES = ['authorization-required', 'rate-limited', 'configuration-invalid', 'mapping-invalid', 'resource-not-granted',
  'destination-limit', 'outcome-unknown', 'adapter-unavailable', 'delivery-failed'] as const;
type LedgerCode = (typeof LEDGER_CODES)[number];
/** Same shape as cms's `FormDeliveryError`: one class, nine lower-case ledger codes. */
class DeliveryError extends Error {
  readonly code: string;
  constructor(required: { code: string }) { super(required.code); this.code = required.code; }
}
const CATALOG_CODE: Record<LedgerCode, string> = {
  'authorization-required': 'FORM_DELIVERY_AUTHORIZATION_REQUIRED', 'rate-limited': 'FORM_DELIVERY_RATE_LIMITED',
  'configuration-invalid': 'FORM_DELIVERY_CONFIGURATION_INVALID', 'mapping-invalid': 'FORM_DELIVERY_MAPPING_INVALID',
  'resource-not-granted': 'FORM_DELIVERY_RESOURCE_NOT_GRANTED', 'destination-limit': 'FORM_DELIVERY_DESTINATION_LIMIT',
  'outcome-unknown': 'FORM_DELIVERY_OUTCOME_UNKNOWN', 'adapter-unavailable': 'FORM_DELIVERY_ADAPTER_UNAVAILABLE',
  'delivery-failed': 'FORM_DELIVERY_FAILED',
};
class ForbiddenError extends Error {}
class PageNotFoundError extends Error {}
class PostNotFoundError extends Error {}
class PostConflictError extends Error {}
class PostVersionConflictError extends PostConflictError {}
class SealerError extends Error {}
class QuotaError extends Error { readonly used = 12; readonly limit = 10; }
/** A fake of the one logger method the catalog uses. */
function createRecordingLogger() {
  const entries: Array<{ level: 'warn'; message: string }> = [];
  return { logger: { warn: ({ message }: { message: string }) => { entries.push({ level: 'warn', message }); } }, entries };
}

const words = (message: string, status = 400): ErrorSentence => ({ status, retryable: false, message, action: 'Fix it and try again.', audience: 'anyone' });
const ownMessage = { mode: 'own-message' } as const;
const deliveryBinding: ErrorBinding = {
  error: DeliveryError, codes: Object.values(CATALOG_CODE), text: { mode: 'sentence' }, label: 'FormDeliveryError',
  codeOf: ({ error }) => CATALOG_CODE[(error as DeliveryError).code as LedgerCode],
};
const postBindings: ErrorBinding[] = [
  { error: PostVersionConflictError, code: 'VERSION_CONFLICT', text: ownMessage, guidance: 'Call get_post again.', label: 'PostVersionConflictError' },
  { error: PostConflictError, code: 'CONTENT_POST_CONFLICT', text: ownMessage, label: 'PostConflictError' },
  { error: ForbiddenError, code: 'CONTENT_POST_FORBIDDEN', text: ownMessage },
  { error: SealerError, code: 'CONTENT_POST_SEAL_FAILED', text: { mode: 'fixed', text: 'The post could not be sealed.' } },
  { error: QuotaError, code: 'CONTENT_POST_QUOTA', text: { mode: 'sentence', params: ({ error }) => ({ used: (error as QuotaError).used, limit: (error as QuotaError).limit }) } },
];
function buildCatalog() {
  return createErrorCatalog({
    sentences: [
      CORE_ERROR_SENTENCES,
      defineErrorSentences({ domain: 'FORM_DELIVERY', codes: Object.fromEntries(Object.values(CATALOG_CODE).map(code => [code, words(`Delivery failed: ${code}.`, 502)])) }),
      defineErrorSentences({ domain: 'CONTENT_POST', codes: { CONTENT_POST_QUOTA: words('You have {used} of {limit} posts.', 429) } }),
      defineErrorSentences({ domain: 'PAGES', codes: { PAGES_NOT_FOUND: words('That page does not exist.', 404) } }),
    ],
    scopes: [
      defineErrorScope({ scope: 'forms-delivery', bindings: [deliveryBinding] }),
      defineErrorScope({ scope: 'members', bindings: [{ error: ForbiddenError, code: 'MEMBERS_FORBIDDEN', text: ownMessage }] }),
      defineErrorScope({ scope: 'content-post', bindings: postBindings }),
      defineErrorScope({ scope: 'pages', bindings: [
        { error: PageNotFoundError, code: 'PAGES_NOT_FOUND', text: ownMessage }, { error: PostNotFoundError, code: 'PAGES_NOT_FOUND', text: ownMessage },
      ] }),
    ],
  });
}
const catalog = buildCatalog();
const codeOf = (error: unknown, scope: string): string | undefined => catalog.match({ error, scope })?.code;

describe('the three relationships', () => {
  test('one class, nine codes: each ledger code maps to its own catalog code', () => {
    const codes = LEDGER_CODES.map(code => codeOf(new DeliveryError({ code }), 'forms-delivery'));
    expect(codes).toEqual(LEDGER_CODES.map(code => CATALOG_CODE[code]));
    expect(new Set(codes).size).toBe(9);
  });

  test('an unlisted ledger code gives no match', () => {
    expect(catalog.match({ error: new DeliveryError({ code: 'brand-new-code' }), scope: 'forms-delivery' })).toBeUndefined();
  });

  test('a discriminant result outside the binding list, or a throwing discriminant, gives no match', () => {
    const scoped = (codeOfBinding: () => string) => createErrorCatalog({ sentences: [], scopes: [defineErrorScope({ scope: 'forms-delivery', bindings: [
      { error: DeliveryError, codes: ['FORM_DELIVERY_FAILED'], text: ownMessage, codeOf: codeOfBinding }] })] });
    const error = new DeliveryError({ code: 'rate-limited' });
    expect(scoped(() => 'FORM_DELIVERY_FAILED').match({ error, scope: 'forms-delivery' })?.code).toBe('FORM_DELIVERY_FAILED');
    expect(scoped(() => 'SK_LIVE_SECRET_TOKEN').match({ error, scope: 'forms-delivery' })).toBeUndefined();
    expect(scoped(() => { throw new Error('codeOf bug'); }).match({ error, scope: 'forms-delivery' })).toBeUndefined();
  });

  test('one class, a different code per scope; an unknown scope gives no match', () => {
    const error = new ForbiddenError('principal p-1 lacks members:write');
    expect(codeOf(error, 'members')).toBe('MEMBERS_FORBIDDEN');
    expect(codeOf(error, 'content-post')).toBe('CONTENT_POST_FORBIDDEN');
    expect(catalog.match({ error, scope: 'unknown-scope' })).toBeUndefined();
  });

  test('two classes, one code', () => {
    expect(codeOf(new PageNotFoundError('no page'), 'pages')).toBe('PAGES_NOT_FOUND');
    expect(codeOf(new PostNotFoundError('no post'), 'pages')).toBe('PAGES_NOT_FOUND');
  });
});

describe('order and trust', () => {
  test('a subclass listed first wins, with its guidance; its superclass still matches its own code', () => {
    expect(catalog.match({ error: new PostVersionConflictError('stale'), scope: 'content-post' }), 'subclass matching keeps the selected code and guidance').toMatchObject({ code: 'VERSION_CONFLICT', guidance: 'Call get_post again.' });
    expect(codeOf(new PostConflictError('slug taken'), 'content-post')).toBe('CONTENT_POST_CONFLICT');
  });

  test('a superclass listed before its subclass is rejected, as is the same class twice', () => {
    const [versionConflict, conflict] = postBindings as [ErrorBinding, ErrorBinding];
    expect(() => createErrorCatalog({ sentences: [], scopes: [defineErrorScope({ scope: 'content-post', bindings: [conflict, versionConflict] })] }))
      .toThrow('in scope "content-post", binding 2 can never match because binding 1 lists the same class or its superclass first');
    expect(() => createErrorCatalog({ sentences: [], scopes: [defineErrorScope({ scope: 'content-post', bindings: [conflict, conflict] })] })).toThrow('binding 2 can never match');
  });

  test('an error is never matched by its own code property, and a non-Error never matches', () => {
    expect(catalog.match({ error: Object.assign(new Error('x'), { code: 'MEMBERS_FORBIDDEN' }), scope: 'members' })).toBeUndefined();
    expect(catalog.match({ error: { code: 'MEMBERS_FORBIDDEN', message: 'x' }, scope: 'members' })).toBeUndefined();
    expect(catalog.match({ error: 'MEMBERS_FORBIDDEN', scope: 'members' })).toBeUndefined();
  });
});

describe('words', () => {
  test('own-message keeps its mode, fixed publishes binding text, sentence carries its values', () => {
    expect(catalog.match({ error: new ForbiddenError('principal p-1 lacks posts:write'), scope: 'content-post' }), 'own-message matches carry no error message for callers').toEqual({ scope: 'content-post', code: 'CONTENT_POST_FORBIDDEN', mode: 'own-message' });
    expect(catalog.match({ error: new SealerError('plaintext: hunter2'), scope: 'content-post' })).toEqual({ scope: 'content-post', code: 'CONTENT_POST_SEAL_FAILED', mode: 'fixed', message: 'The post could not be sealed.' });
    expect(catalog.match({ error: new QuotaError('over'), scope: 'content-post' })).toEqual({
      scope: 'content-post', code: 'CONTENT_POST_QUOTA', mode: 'sentence', params: { used: 12, limit: 10 }, sentence: words('You have {used} of {limit} posts.', 429) });
  });

  test('placeholder values keep only strings and numbers (at most 16); a throwing params function gives no match', () => {
    const withParams = (params: () => Record<string, string | number>) => createErrorCatalog({ sentences: [], scopes: [defineErrorScope({ scope: 'content-post', bindings: [
      { error: QuotaError, code: 'CONTENT_POST_QUOTA', text: { mode: 'sentence', params } }] })] }).match({ error: new QuotaError('over'), scope: 'content-post' });
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`k${index}`, index]));
    expect(Object.keys(withParams(() => many)?.params ?? {})).toHaveLength(16);
    expect(withParams(() => ({ used: 1, draft: { body: 'private' }, flag: true } as unknown as Record<string, number>))?.params).toEqual({ used: 1 });
    expect(withParams(() => null as unknown as Record<string, number>)?.params).toEqual({});
    expect(withParams(() => { throw new Error('params bug'); })).toBeUndefined();
  });

  test('interpolateSentence fills known placeholders and leaves unknown ones as written', () => {
    expect(interpolateSentence({ text: 'You have {used} of {limit} posts in {site}.' }, { params: { used: 12, limit: 10 } })).toBe('You have 12 of 10 posts in {site}.');
    expect(interpolateSentence({ text: 'No placeholders.' })).toBe('No placeholders.');
    expect(interpolateSentence({ text: '{toString}' }, { params: {} })).toBe('{toString}');
  });

  test('statusFor and sentence answer for a defined code only', () => {
    expect(catalog.statusFor({ error: { code: 'PAGES_NOT_FOUND' } })).toBe(404);
    expect(catalog.statusFor({ error: { code: 'MEMBERS_FORBIDDEN' } })).toBeUndefined();
    expect(catalog.sentence({ code: 'CONTENT_POST_QUOTA' })?.status).toBe(429);
    expect(catalog.sentence({ code: 'RESOURCE_CONFLICT' })).toBeUndefined();
  });

  test('sourceSentences lists each message and action once', () => {
    const source = catalog.sourceSentences();
    expect(source).toContain('That page does not exist.');
    expect(source.filter(text => text === 'Fix it and try again.')).toHaveLength(1);
    expect(source).toContain(CORE_ERROR_SENTENCES.codes.VERSION_REQUIRED!.action);
  });
});

describe('the existing consumers keep their exact strings', () => {
  const rules = catalog.modelFacingRules({ scope: 'content-post' });

  test('model-facing rules are field-for-field the hand-written rule shapes', () => {
    expect(rules).toEqual([
      { error: PostVersionConflictError, code: 'VERSION_CONFLICT', guidance: 'Call get_post again.' },
      { error: PostConflictError, code: 'CONTENT_POST_CONFLICT' },
      { error: ForbiddenError, code: 'CONTENT_POST_FORBIDDEN' },
      { error: SealerError, code: 'CONTENT_POST_SEAL_FAILED', message: 'The post could not be sealed.' },
    ]);
    expect(catalog.modelFacingRules({ scope: 'forms-delivery' })).toEqual([]);
    expect(catalog.modelFacingRules({ scope: 'unknown-scope' })).toEqual([]);
  });

  test('reclassifyToolError over the generated rules publishes the same text as today', () => {
    const published = (err: unknown): string => (reclassifyToolError({ err, rules }) as ToolInputError).message;
    expect(published(new PostVersionConflictError('This post was changed by someone else'))).toBe('VERSION_CONFLICT: This post was changed by someone else. Call get_post again.');
    expect(published(new ForbiddenError('principal p-1 lacks posts:write'))).toBe('CONTENT_POST_FORBIDDEN: principal p-1 lacks posts:write');
    expect(published(new SealerError('plaintext: hunter2'))).toBe('CONTENT_POST_SEAL_FAILED: The post could not be sealed.');
    const quota = new QuotaError('over');
    expect(reclassifyToolError({ err: quota, rules })).toBe(quota);
  });

  test('caller-safe rules exclude own-message while model rules keep it', () => {
    const safe = catalog.callerSafeRules({ scope: 'content-post' });
    expect(callerSafeErrorMessage({ err: new SealerError('plaintext: hunter2'), rules: safe, fallback: 'fallback' })).toBe('The post could not be sealed.');
    expect(safe.map(rule => rule.error), 'own-message bindings are absent from caller-safe rules').not.toContain(ForbiddenError);
    expect(callerSafeErrorMessage({ err: new ForbiddenError('no access'), rules: safe, fallback: 'fallback' }), 'caller-safe rules fall back for own-message errors').toBe('fallback');
    expect(rules.map(rule => rule.error), 'model rules retain own-message bindings').toContain(ForbiddenError);
    expect(callerSafeErrorMessage({ err: new QuotaError('over'), rules: safe, fallback: 'fallback' })).toBe('fallback');
  });

  test('the describer vocabulary names bound classes by their fixed label, subclass before superclass, and lists every code', () => {
    const vocabulary = catalog.describerVocabulary();
    const describer = createErrorDescriber(vocabulary);
    expect(describer.describeErrorForLog({ err: new PostVersionConflictError('private text') })).toBe('PostVersionConflictError');
    expect(describer.describeErrorForLog({ err: new PostConflictError('private text') })).toBe('PostConflictError');
    expect(describer.describeErrorForLog({ err: Object.assign(new DeliveryError({ code: 'rate-limited' }), { code: 'FORM_DELIVERY_RATE_LIMITED' }) })).toBe('FormDeliveryError(FORM_DELIVERY_RATE_LIMITED)');
    expect(describer.describeErrorForLog({ err: new DeliveryError({ code: 'rate-limited' }) })).toBe('FormDeliveryError');
    expect(vocabulary.codes).toEqual(expect.arrayContaining(['VERSION_CONFLICT', 'CONCURRENT_EDIT', 'MEMBERS_FORBIDDEN', 'PAGES_NOT_FOUND', ...Object.values(CATALOG_CODE)]));
  });
});

describe('definitions', () => {
  test("core's set defines the two version codes and the legacy code with the same sentence", () => {
    expect(Object.keys(CORE_ERROR_SENTENCES.codes).sort()).toEqual(['CONCURRENT_EDIT', VERSION_CONFLICT_CODE, VERSION_REQUIRED_CODE].sort());
    expect(CORE_ERROR_SENTENCES.codes.CONCURRENT_EDIT).toEqual(CORE_ERROR_SENTENCES.codes.VERSION_CONFLICT);
    expect(catalog.statusFor({ error: { code: VERSION_CONFLICT_CODE } })).toBe(409);
    expect(catalog.statusFor({ error: { code: VERSION_REQUIRED_CODE } })).toBe(428);
  });

  test('a feature set cannot define an unprefixed or shared generic code, or a code of another shape', () => {
    const define = (domain: string, code: string, sentence: Partial<ErrorSentence> = {}) => () =>
      defineErrorSentences({ domain, codes: { [code]: { ...words('It failed.'), ...sentence } as ErrorSentence } });
    expect(define('MEMBERS', 'RESOURCE_CONFLICT')).toThrow('the code "RESOURCE_CONFLICT" must start with "MEMBERS_". Shared generic codes are defined only by core.');
    expect(define('MEMBERS', 'CONCURRENT_EDIT')).toThrow('must start with "MEMBERS_"');
    expect(define('MEMBERS', 'rate-limited')).toThrow('the code "rate-limited" must be a constant token');
    expect(define('members', 'MEMBERS_X')).toThrow('the domain "members" must be a constant token');
    expect(define('MEMBERS', 'MEMBERS_X', { status: 200 })).toThrow('"MEMBERS_X" needs an HTTP status from 400 to 599');
    expect(define('MEMBERS', 'MEMBERS_X', { retryable: 'no' as unknown as boolean })).toThrow('needs retryable to be true or false');
    expect(define('MEMBERS', 'MEMBERS_X', { message: ' ' })).toThrow('needs a message that says what failed');
    expect(define('MEMBERS', 'MEMBERS_X', { action: '' })).toThrow('needs an action that says what to do next');
    expect(define('MEMBERS', 'MEMBERS_X', { audience: 'everyone' as 'anyone' })).toThrow('needs audience "anyone" or "authorized"');
    expect(define('MEMBERS', 'MEMBERS_X')()).toEqual({ domain: 'MEMBERS', codes: { MEMBERS_X: words('It failed.') } });
  });

  test('two sets defining one code: a conformance build throws; production warns and keeps the first', () => {
    const first = defineErrorSentences({ domain: 'PAGES', codes: { PAGES_NOT_FOUND: words('First.', 404) } });
    const second = defineErrorSentences({ domain: 'PAGES', codes: { PAGES_NOT_FOUND: words('Second.', 410) } });
    expect(() => createErrorCatalog({ sentences: [first, second], scopes: [] })).toThrow('the code "PAGES_NOT_FOUND" has a sentence in both "PAGES" and "PAGES". Remove one definition.');
    const { logger, entries } = createRecordingLogger();
    const kept = createErrorCatalog({ sentences: [first, second], scopes: [] }, { onDuplicate: 'warn', logger });
    expect(kept.sentence({ code: 'PAGES_NOT_FOUND' })?.message).toBe('First.');
    expect(entries).toEqual([{ level: 'warn', message: '[error-catalog] the code "PAGES_NOT_FOUND" has a sentence in both "PAGES" and "PAGES"; keeping the first definition' }]);
  });

  test('a scope defined twice: throws by default; production warns and keeps the first', () => {
    const scope = (code: string) => defineErrorScope({ scope: 'members', bindings: [{ error: ForbiddenError, code, text: ownMessage }] });
    expect(() => createErrorCatalog({ sentences: [], scopes: [scope('MEMBERS_FORBIDDEN'), scope('MEMBERS_DENIED')] })).toThrow('the scope "members" is defined twice');
    const { logger, entries } = createRecordingLogger();
    const kept = createErrorCatalog({ sentences: [], scopes: [scope('MEMBERS_FORBIDDEN'), scope('MEMBERS_DENIED')] }, { onDuplicate: 'warn', logger });
    expect(kept.match({ error: new ForbiddenError('x'), scope: 'members' })?.code).toBe('MEMBERS_FORBIDDEN');
    expect(entries.map(entry => entry.message)).toEqual(['[error-catalog] the scope "members" is defined twice; keeping the first definition']);
  });

  test('a scope rejects a binding of the wrong shape, naming it', () => {
    const scope = (binding: unknown, name = 'members') => () => defineErrorScope({ scope: name, bindings: [binding as ErrorBinding] });
    expect(scope({ error: ForbiddenError, code: 'MEMBERS_FORBIDDEN', text: ownMessage }, 'Members')).toThrow('the name "Members" must be lower-case words joined by hyphens');
    expect(scope({ code: 'MEMBERS_FORBIDDEN', text: ownMessage })).toThrow('Error scope "members", binding 1: each binding needs an error class.');
    expect(scope(null)).toThrow('each binding needs an error class');
    expect(scope({ error: ForbiddenError, code: 'forbidden', text: ownMessage })).toThrow('the code "forbidden" must be a constant token');
    expect(scope({ error: ForbiddenError, code: 'MEMBERS_FORBIDDEN', text: ownMessage, label: 'not a label' })).toThrow('a label must be an identifier');
    expect(scope({ error: ForbiddenError, code: 'MEMBERS_FORBIDDEN', text: { mode: 'raw' } })).toThrow('text.mode must be "own-message", "fixed" or "sentence"');
    expect(scope({ error: ForbiddenError, code: 'MEMBERS_FORBIDDEN' })).toThrow('text.mode must be');
    expect(scope({ error: ForbiddenError, code: 'MEMBERS_FORBIDDEN', text: { mode: 'fixed', text: ' ' } })).toThrow('a "fixed" text needs the words to publish');
    expect(scope({ error: ForbiddenError, code: 'MEMBERS_FORBIDDEN', text: { mode: 'sentence', params: 5 } })).toThrow('text.params must be a function');
    expect(scope({ error: DeliveryError, codes: ['FORM_DELIVERY_FAILED'], text: ownMessage })).toThrow('a binding with "codes" needs a codeOf function');
    expect(scope({ error: DeliveryError, codes: [], text: ownMessage, codeOf: () => undefined })).toThrow('needs a non-empty "codes" list');
    expect(scope({ error: DeliveryError, codes: ['rate-limited'], text: ownMessage, codeOf: () => undefined })).toThrow('the code "rate-limited" must be a constant token');
  });
});

test('an unregistered scope does not receive caller-safe rules from a registered scope', () => {
  expect(catalog.callerSafeRules({ scope: 'other-host' })).toEqual([]);
});
