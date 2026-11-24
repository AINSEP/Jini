/**
 * @file The host port that words a classified domain error for the caller. Jini route specs keep
 * the classification (status, code, details) and ask this port for the outward `error` copy, so
 * stored or raw error text never leaves through engine code: the host decides what a caller may
 * read (it may pass the message through, redact it, or translate it).
 */

/** Words one classified error for the response's `error` field. Required on every route deps
 *  object that refuses with a domain error's copy. */
export type OutwardErrorMessage = (required: { error: Error }, optional?: Record<string, never>) => string;
