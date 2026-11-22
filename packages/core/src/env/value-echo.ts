/** Shared disclosure policy for parser issues and environment diagnostics. */
import type { EnvValueEcho, EnvVarSpec } from '../contracts/env.js';
import { redactSecrets } from '../redact.js';

const SHOWN_LIMIT = 120;

/** The one definition of "is it set". Never a truthiness check: `0`, `false` and `""` are real values. */
export function isSet({ value }: { value: string | undefined }, _optional: Record<string, never> = {}): boolean {
  return value !== undefined && value.trim() !== '';
}

/** A URL setting can carry credentials although the setting itself is not a secret. */
function withoutCredentials({ raw }: { raw: string }): string | undefined {
  if (!URL.canParse(raw.trim())) return undefined;
  const url = new URL(raw.trim());
  url.username = ''; url.password = ''; url.search = ''; url.hash = '';
  return url.toString();
}

/** Sanitize an allow-listed value, hiding malformed URLs and redacting before truncation.
 * URL parsing and lexical redaction retain only bounded text; no I/O or input mutation.
 */
function shownEcho({ spec, raw }: { spec: EnvVarSpec; raw: string }): EnvValueEcho {
  const text = spec.type === 'url' || spec.type === 'origin' ? withoutCredentials({ raw }) : raw;
  if (text === undefined) return { kind: 'hidden', length: raw.length };
  // Redact before truncation so a partial credential cannot evade its shape rule.
  const redacted = redactSecrets({ input: text }, { redactPii: false });
  return { kind: 'shown', text: redacted.length > SHOWN_LIMIT ? `${redacted.slice(0, SHOWN_LIMIT)}…` : redacted };
}

/** Allow-list display: a value is shown only when its spec says it is not secret and may be shown.
 * A name with no spec can therefore never leak a value. No I/O or input mutation.
 * @param required The spec, if listed, and the raw environment value.
 * @returns Presence or sanitized text; malformed URLs are hidden, never thrown.
 * @complexity One value's URL parsing and existing lexical redaction; at most 121 output characters.
 */
export function echoEnvValue(
  { spec, raw }: { spec: EnvVarSpec | undefined; raw: string | undefined },
  _optional: Record<string, never> = {},
): EnvValueEcho {
  if (!isSet({ value: raw }) || raw === undefined) return { kind: 'unset' };
  if (!spec || spec.secret || spec.display !== 'value') return { kind: 'hidden', length: raw.length };
  return shownEcho({ spec, raw });
}
