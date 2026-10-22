

/** Shared credential validation; application detection policy is injected at the metadata boundary. */
export const CREDENTIAL_TOKEN_LIMIT = 8192;
export const CREDENTIAL_MESSAGES = {
  showSecret: "Show",
  hideSecret: "Hide",
  generationUnavailable: "Generation is not available yet for this provider.",
  secretValue: "Secret value",
  saveSecret: "Save secret",
  cancel: "Cancel",
  secretForm: "Enter the value in this secure form.",

  env: 'Enter environment variables as NAME=VALUE lines or a JSON object of strings.',
  url: 'The server URL must be a valid absolute URL.',
  set: 'Access token set',
  storage: 'The credential could not be saved or unlocked. Check the site credential store.',
  savedTitle: 'Saved.',
  blank: 'Enter a token. Spaces alone are not a token.',
  limit: 'The token exceeds the 8192-character limit. Copy only the token.',
  ascii: 'Hosted tokens must use visible ASCII characters (0x21–0x7E).',
  control: 'The token contains an invalid control character.',
  plain: 'Put credentials in the secret field, not in this field.',
  saved: 'Saved, not tested.',
  connected: 'Connected.',
  auth: 'The server rejected this token.',
  timeout: 'The connection timed out.',
  unreachable: 'Could not reach the server.',
  chars: '{length} chars',
} as const;
export type CredentialMessageId = keyof typeof CREDENTIAL_MESSAGES;

/** Errors carry only a rule and field, never the submitted value. */
export class CredentialInputError extends Error {
  constructor(readonly rule: CredentialMessageId, readonly field: string) {
    super(CREDENTIAL_MESSAGES[rule]);
    this.name = 'CredentialInputError';
  }
}

/** Validate without normalizing: cards may call this before a probe; only the store trims. */
export function assertCredentialToken(
  { value, field = 'token', hosted = true }: { value: unknown; field?: string; hosted?: boolean },
  _optional = {},
): void {
  if (typeof value !== 'string' || value.trim() === '') throw new CredentialInputError('blank', field);
  // Validate the stored length, so incidental edge whitespace does not consume the token limit.
  const token = value.trim();
  if (token.length > CREDENTIAL_TOKEN_LIMIT) throw new CredentialInputError('limit', field);
  if (hosted && /[^\x21-\x7e]/.test(token)) throw new CredentialInputError('ascii', field);
  if (/[\x00-\x1f\x7f-\x9f]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(token)) {
    throw new CredentialInputError('control', field);
  }
}

/** The single normalization boundary. Interior characters are never rewritten or truncated. */
export function normalizeCredentialToken(
  required: { value: unknown; field?: string; hosted?: boolean },
  _optional = {},
): string {
  assertCredentialToken(required);
  return (required.value as string).trim();
}

export interface CredentialTokenHint { length: number; last4: string | null }
/** Call only on a server-side unsealed value; short tokens expose no characters. */
export function credentialTokenHint({ token }: { token: string }, _optional = {}): CredentialTokenHint {
  return { length: token.length, last4: token.length >= 12 ? token.slice(-4) : null };
}

const SECRET_NAME = /(?:^|[_-])(?:key|api[_-]?key|token|access[_-]?token|secret|password|auth|sig)$/i;
const SECRET_ARG = /(?:^|\s)--[\w-]*(?:api[_-]?key|token|secret|password)(?:=|\s+)(?!\s*$)\S/i;
/** Protect plaintext metadata, using Jini's detector plus structural URL/CLI rules. */
export function assertCredentialFreeField(
  { value, field, containsSecret }: { value: string; field: string; containsSecret: (required: { text: string }) => boolean },
  _optional = {},
): void {
  let credential = containsSecret({ text: value }) || SECRET_ARG.test(value);
  try {
    const url = new URL(value);
    credential ||= url.username !== '' || url.password !== '' || [...url.searchParams.keys()].some(key => SECRET_NAME.test(key));
  } catch { /* A label/argument is ordinarily not an absolute URL. */ }
  if (credential) throw new CredentialInputError('plain', field);
}

export type CredentialConnection = 'connected' | 'auth' | 'timeout' | 'unreachable' | 'saved';
