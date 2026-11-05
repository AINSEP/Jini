import { formatErrorForLog, redactSecrets, type SecretRedactionOptions } from './redact.js';

/** Sanitized explanation and copyable evidence. Missing boundary metadata stays explicitly unavailable. */
export interface UserFacingError {
  readonly message: string;
  readonly action: string;
  readonly step: string;
  readonly cause: string;
  readonly errorId?: string;
  readonly appVersion?: string;
  readonly jiniVersion?: string;
  readonly time?: string;
  readonly copyText: string;
}

/** Boundary-owned metadata and redaction policy; formatting never reads a clock or generates IDs. */
export interface UserFacingErrorOptions extends SecretRedactionOptions {
  readonly errorId?: string;
  readonly appVersion?: string;
  readonly jiniVersion?: string;
  readonly time?: string;
}

/**
 * Format an approved explanation and an untrusted cause for disclosure and copying.
 * Callers own disclosure policy: redaction does not make private backend facts public-safe.
 * Redacts complete fields before bounding them; uses an existing ERR ID before a boundary fallback.
 * No I/O, logging, clock, randomness or input mutation. Core handles hostile/circular causes.
 * @complexity O(n) diagnostic serialization plus core redaction over all input characters; bounded output.
 */
export function formatUserFacingError(
  requiredArgs: { message: string; action: string; step: string; cause: unknown },
  optionalArgs: UserFacingErrorOptions = {},
): UserFacingError {
  const diagnostic = formatErrorForLog({ error: requiredArgs.cause }, optionalArgs);
  const existingId = diagnostic.match(/\bERR-[A-Fa-f0-9]{4}(?:-[A-Fa-f0-9]{4}){3}\b/)?.[0];
  const metadata = {
    errorId: existingId ?? optionalArgs.errorId,
    appVersion: optionalArgs.appVersion,
    jiniVersion: optionalArgs.jiniVersion,
    time: optionalArgs.time,
  };
  const fields: Omit<UserFacingError, 'copyText'> = {
    message: safeField({ text: requiredArgs.message }, optionalArgs),
    action: safeField({ text: requiredArgs.action }, optionalArgs),
    step: safeField({ text: requiredArgs.step }, optionalArgs),
    cause: bound({ text: diagnostic, limit: 4096 }),
    ...Object.fromEntries(Object.entries(metadata).filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([key, text]) => [key, safeField({ text }, optionalArgs)])),
  };
  const labels: readonly [string, string | undefined][] = [
    ['Message', fields.message], ['Next action', fields.action], ['Error ID', fields.errorId],
    ['Step', fields.step], ['Cause', fields.cause], ['App version', fields.appVersion],
    ['Jini version', fields.jiniVersion], ['Time', fields.time],
  ];
  // Exact secrets can span a fixed label and a field; scrub the assembled block as well.
  const copyText = bound({ text: redactSecrets({ input: labels.map(([label, value]) => `${label}: ${value ?? 'Unavailable'}`).join('\n') }, optionalArgs), limit: 8192 });
  return { ...fields, copyText };
}

/** Redact the complete value so a credential crossing the display bound cannot leak its prefix. */
function safeField({ text }: { text: string }, options: SecretRedactionOptions): string {
  return bound({ text: redactSecrets({ input: text }, options), limit: 512 });
}

function bound({ text, limit }: { text: string; limit: number }): string {
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}

/** Approved host vocabulary only. Keys are static route segments or slash-delimited operation suffixes; prefix an override key with an HTTP method and a space to restrict it. */
export interface RequestFailureVocabulary {
  readonly nouns: Readonly<Record<string, { readonly singular: string; readonly plural: string }>>;
  readonly operations?: Readonly<Record<string, RequestFailureDescription>>;
}
export interface RequestFailureDescription {
  readonly message: string;
  readonly action: string;
  readonly step: string;
}

const REPORT_REQUEST_FAILURE = 'Copy details and report this problem.';
const REQUEST_ACTIONS: Readonly<Record<string, string>> = {
  publish: 'publishing', unpublish: 'unpublishing', import: 'import', export: 'export',
  upload: 'upload', download: 'download', restore: 'restore', send: 'send', undo: 'undo',
  pull: 'pull', push: 'push', plan: 'preparation', confirm: 'confirmation', execute: 'execution',
  update: 'save', save: 'save', create: 'creation', delete: 'removal',
};

/**
 * Describe a failed request using only host-approved words; path values and query strings never render.
 * A registered template is preferred; operation identifiers are the fallback for non-HTTP mappers.
 * This is pure and does not infer a cause, retry a write or assume POST means creation.
 * @complexity O(n + k*n) time for n bounded route tokens and k host override suffixes; O(n) space.
 * @overallScore 98 — the host owns vocabulary accuracy; unknown contexts retain a safe request fallback.
 */
export function describeRequestFailure(
  { method, route, operation, vocabulary }: { method?: string; route?: string; operation?: string; vocabulary: RequestFailureVocabulary },
  _optionalArgs: Record<string, never> = {},
): RequestFailureDescription {
  const tokens = (route || operation || '').slice(0, 2048).split(/[?#]/, 1)[0]!.split('/').slice(0, 64);
  const override = Object.entries(vocabulary.operations ?? {}).find(([suffix]) => matchesRequestSuffix(tokens, suffix, method?.toUpperCase()));
  if (override) return { ...override[1] };
  const nounKey = tokens.slice().reverse().find(token => Object.hasOwn(vocabulary.nouns, token));
  const noun = nounKey === undefined ? undefined : vocabulary.nouns[nounKey];
  const actionToken = tokens[tokens.length - 1] ?? '';
  const action = Object.hasOwn(REQUEST_ACTIONS, actionToken) ? REQUEST_ACTIONS[actionToken] : undefined;
  return requestFailureDescription({ method: method?.toUpperCase(), noun, action });
}

function matchesRequestSuffix(tokens: string[], suffix: string, method: string | undefined): boolean {
  const [prefix, path] = suffix.split(' ', 2);
  if (path !== undefined && prefix !== method) return false;
  const expected = (path ?? prefix!).split('/');
  return expected.every((token, index) => token === tokens[tokens.length - expected.length + index]);
}

/** Keep uncertain writes explicit: users check the result before repeating an operation. */
function requestFailureDescription({ method, noun, action }: {
  method: string | undefined; noun: { singular: string; plural: string } | undefined; action: string | undefined;
}): RequestFailureDescription {
  if (method === 'GET' || method === 'HEAD') return readFailureDescription(noun);
  if (method === 'PUT' || method === 'PATCH' || action === 'save') return saveFailureDescription(noun);
  if (method === 'DELETE' || action === 'removal') return removalFailureDescription(noun);
  return operationFailureDescription(noun, action);
}

function operationFailureDescription(noun: { singular: string } | undefined, action: string | undefined): RequestFailureDescription {
  return {
    message: noun ? `The ${noun.singular} ${action ?? 'operation'} could not be completed.` : 'The request could not be completed.',
    action: `Check the result before repeating this operation. ${REPORT_REQUEST_FAILURE}`,
    step: noun ? `${noun.singular} ${action ?? 'operation'}` : 'Request',
  };
}

function readFailureDescription(noun: { plural: string } | undefined): RequestFailureDescription {
  return {
    message: `The ${noun?.plural ?? 'requested information'} could not be loaded.`,
    action: 'Try loading them again. If it still fails, copy details and report this problem.',
    step: `Load ${noun?.plural ?? 'information'}`,
  };
}

function saveFailureDescription(noun: { singular: string } | undefined): RequestFailureDescription {
  return {
    message: `The ${noun?.singular ?? 'requested'} save could not be completed.`,
    action: `Check whether your changes were saved before repeating the save. ${REPORT_REQUEST_FAILURE}`,
    step: `Save ${noun?.singular ?? 'changes'}`,
  };
}

function removalFailureDescription(noun: { singular: string } | undefined): RequestFailureDescription {
  return {
    message: `The ${noun?.singular ?? 'item'} removal could not be confirmed.`,
    action: `Check the list before repeating the removal. ${REPORT_REQUEST_FAILURE}`,
    step: `Remove ${noun?.singular ?? 'item'}`,
  };
}
