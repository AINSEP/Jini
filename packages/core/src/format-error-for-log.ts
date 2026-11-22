import { redactSecrets } from './redact.js';
import type { SecretRedactionOptions } from './redaction-patterns.js';

/**
 * Universal diagnostic text for any thrown value. Keeps native stacks and structured metadata,
 * then applies the shared credential policy (PII stays readable unless explicitly requested).
 * Diagnostic getters, serialization and coercion can themselves fail; fixed fallback text keeps
 * those failures from replacing the original error or interrupting the caller's recovery.
 * @param required.error - Untrusted thrown value; never mutated.
 * @param options - Shared redaction options, including caller-owned exact secrets.
 * @returns Redacted text; never throws, including for circular objects and hostile accessors.
 * @complexity O(n) serialization in the diagnostic's fields/characters, plus shared redaction passes.
 */
export function formatErrorForLog(
  required: { error: unknown }, options: SecretRedactionOptions = {},
): string {
  try {
    const { error } = required;
    let text: string;
    if (error instanceof Error) {
      const message = String(error.message);
      text = String(error.stack ?? `${error.name}: ${message}`);
      if (!text.includes(message)) text += `\n${message}`;
      const fields = Object.fromEntries(Object.getOwnPropertyNames(error)
        .filter(key => !['name', 'message', 'stack'].includes(key)).map(key => [key, Reflect.get(error, key)]));
      if (Object.keys(fields).length) text += `\n${diagnosticJson({ error: fields }, options)}`;
    } else {
      text = error !== null && typeof error === 'object' ? diagnosticJson({ error }, options) : String(error);
    }
    return redactSecrets({ input: text }, { redactPii: false, ...options });
  } catch {
    return '[Unformattable error]';
  }
}

/** JSON preserves structured fields without coercing objects; track cycles and native Error fields.
 * Property access remains inside formatErrorForLog's recovery boundary. O(n) visited fields. */
function diagnosticJson({ error }: { error: unknown }, options: SecretRedactionOptions = {}): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(error, (_key, value: unknown) => {
    if (value !== null && typeof value === 'object') {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
      if (value instanceof Error) return Object.fromEntries(Object.getOwnPropertyNames(value).map(key => [key, Reflect.get(value, key)]));
    }
    // Scrub string contents before JSON escapes their credential labels. Exact-only is kept
    // for the final pass so a caller's literal marker is never reprocessed as a supplied secret.
    if (typeof value === 'string' && options.policy !== 'exact-only') {
      return redactSecrets({ input: value }, { redactPii: false, ...options });
    }
    return typeof value === 'bigint' ? String(value) : value;
  }) ?? String(error);
}
