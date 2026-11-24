/** Host-approved, translated and actionable copy for a failed credential write (for example
 * "That name is taken. Choose another."), or `undefined` for the fixed fallback. A raw `Error.message`
 * never reaches the screen on its own: only what this describer returns does. */
export type DescribeCredentialError = (required: { error: unknown }, optional?: Record<string, never>) => string | undefined;
export const REDACTED = '[redacted]';
/** Every submitted secret is cut out exactly, raw and trimmed, so a describer that echoes the server's
 * reader text (which may repeat the submitted token) still cannot put it on screen. */
export function redactSecrets({ text, secrets }: { text: string; secrets: readonly string[] }, _optional: Record<string, never> = {}): string {
  const exact = [...new Set(secrets.flatMap(secret => [secret, secret.trim()]))].filter(secret => secret.length > 0).sort((a, b) => b.length - a.length);
  return exact.reduce((out, secret) => out.split(secret).join(REDACTED), text);
}
/** The text a failed write leaves in the snapshot: the describer's copy, redacted, else the fixed
 * `fallback` (module copy, which cannot hold a submitted secret). A describer that throws counts as no
 * description, so a host bug cannot surface the raw error. */
export function credentialFailureText({ error, fallback, secrets }: { error: unknown; fallback: string; secrets: readonly string[] }, { describeError }: { describeError?: DescribeCredentialError | undefined } = {}): string {
  let described: string | undefined;
  try { described = describeError?.({ error }); } catch { described = undefined; }
  return described ? redactSecrets({ text: described, secrets }) : fallback;
}
/** The host's token check (for example the platform's `assertCredentialToken`): it throws on a rule break, and its
 * input error names the rule, never the value. */
export type CredentialTokenAssert = (required: { value: string }, optional?: Record<string, never>) => void;
/** Display copy for the token check's own input error, or `undefined` for any other failure, which is rethrown. */
export type DescribeTokenInputError = (required: { error: unknown }, optional?: Record<string, never>) => string | undefined;
/** The draft check a controller runs before a write: copy for a refused draft, else `null`. `required` is set for a create. */
export type CredentialDraftError = (required: { value: string }, optional?: { required?: boolean }) => string | null;
/** Preserve the draft bytes; an exact blank update keeps the saved secret. Only the token
 *  validator's own input error becomes display copy; any other failure is rethrown so an
 *  unknown exception never gains display permission. */
export function credentialDraftError({ value, assertToken, describeInputError }: { value: string; assertToken: CredentialTokenAssert; describeInputError: DescribeTokenInputError }, { required = false }: { required?: boolean } = {}): string | null {
  if (value === '' && !required) return null;
  try { assertToken({ value }); return null; }
  catch (error) {
    const copy = describeInputError({ error });
    if (copy !== undefined) return copy;
    throw error;
  }
}
