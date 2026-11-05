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
