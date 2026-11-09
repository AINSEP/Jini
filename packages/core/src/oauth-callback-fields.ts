/**
 * @file Neutral OAuth callback-field bounds and name rule, moved byte-exact from
 * `@jini-ai/oauth` `src/loopback-callback.ts` (blob 140d6bc2, commit deaf9ccd) so API-connection
 * descriptor parsing and the loopback receiver share one source of truth without either depending
 * on the other. Pure values; imports nothing.
 */

// `completeAuthorizationCode`'s code bound (MAX_CODE_LENGTH), applied here so an oversized code fails at the edge.
/** @agent-note Neutral protocol bound shared by the OAuth loopback receiver and API-connection descriptor parsing; one source of truth (`@jini-ai/oauth` re-exports this same binding). Never copy or redefine it. */
export const MAX_CALLBACK_FIELD_LENGTH = 4096;
/** @agent-note Neutral protocol bound shared by the OAuth loopback receiver and API-connection descriptor parsing; one source of truth (`@jini-ai/oauth` re-exports this same binding). Never copy or redefine it. */
export const MAX_CALLBACK_FIELDS = 16;
const CALLBACK_FIELD_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
// Protocol parameters the receiver interprets itself; a plugin may not re-declare them as data.
const RESERVED_CALLBACK_PARAMS: ReadonlySet<string> = new Set(['code', 'state', 'error', 'error_description', 'error_uri', 'iss']);

/**
 * The name rule for a provider callback field a plugin may declare: a short identifier that is not
 * a protocol parameter the receiver reads itself. API-connection descriptors apply this same check
 * (and admin-surface declarations copy it), so a declaration valid on hosted is valid on desktop.
 * @agent-note Neutral protocol rule shared by the OAuth loopback receiver and API-connection descriptor parsing; one source of truth (`@jini-ai/oauth` re-exports this same function). Never copy or redefine it.
 */
export function isCallbackFieldName(name: string): boolean {
    return CALLBACK_FIELD_NAME.test(name) && !RESERVED_CALLBACK_PARAMS.has(name);
}
