import { describeErrorParts, type ErrorDescriber } from '@jini-ai/core';
import { redactSecretShapes } from '../core/secrets-only.js';
type Attributes = Record<string, string | number>;

/** A low-cardinality error label: an approved code (`ECONNREFUSED`, `SQLITE_CONSTRAINT`), else the
 * fixed class label (`TypeError`, a label from a describer the package built), both from core's `describeErrorParts`.
 * This is the shape hosts' dashboards and alerts match on (review jini-batch1 M2: `Error(ECONNREFUSED)`
 * silently broke them). Messages are never exported: they carry SQL fragments, hostnames, emails, even
 * credentials. Both `error.code` and `Error.name` are writable secret channels (review 2026-10-25 #2),
 * so an unapproved code or an unregistered class name is never printed (it reads as the class label,
 * often `Error`; a package names its own through core's `createErrorDescriber`). The label is still
 * redacted and capped to {@link MAX_ERROR_TYPE} (redact first: a cut could leave a secret prefix too
 * short to match). */
export function errorType(
 { error }: { error: unknown },
 { describer = BUILT_IN_DESCRIBER }: { describer?: Pick<ErrorDescriber, 'describeErrorParts'> } = {},
): string {
 const { label, code } = describer.describeErrorParts({ err: error });
 return redactLabel({ text: code ?? label }).slice(0, MAX_ERROR_TYPE) || 'Error';
}

/** Core's built-in-only describer (pure); a host passes one from `createErrorDescriber` for its own vocabulary. */
const BUILT_IN_DESCRIBER = { describeErrorParts };
const MAX_ERROR_TYPE = 64;
const MAX_ATTRIBUTE_TEXT = 256;
const MAX_ATTRIBUTES = 64;
const ATTRIBUTE_KEY = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;

/** The secret-shape redaction every adapter applies to a label before export. */
export function redactLabel({ text }: { text: string }, _optional: Record<string, never> = {}): string {
 return redactSecretShapes({ text, policy: {} }).text;
}

/** Feature attributes are documented as ids and fixed labels, but a caller can still hand over a
 * secret-shaped value (an unknown tool id straight from a request, review #1). Every string is
 * redacted and capped before any SDK sees it; numbers pass. Every adapter applies this, so one careless
 * call site cannot leak through one vendor.
 * @param required The caller's attributes. @returns A fresh, redacted copy. @complexity O(total text). */
export function redactOperationAttributes({ attributes }: { attributes: Readonly<Record<string, string | number>> }): Attributes {
 const safe: Attributes = {};
 // Keys are a bounded label allow-list too: never export emails, URLs or credential-shaped keys.
 const names = Object.keys(attributes).filter(name => ATTRIBUTE_KEY.test(name) && redactLabel({ text: name }) === name);
 for (const name of names.slice(0, MAX_ATTRIBUTES)) {
  const value = attributes[name]!;
  safe[name] = typeof value === 'string' ? redactLabel({ text: value }).slice(0, MAX_ATTRIBUTE_TEXT) : value;
 }
 return safe;
}
