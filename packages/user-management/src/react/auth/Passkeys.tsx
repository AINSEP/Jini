import type { Translate } from '@jini-ai/ui/panel-kit';
import type { PasskeyOptions } from '../../core/types.js';
import { runPasskeyCeremony } from './passkey-browser.js';
import { usePasskeySettings, usePasskeySignIn } from './Passkeys.hooks.js';

type Started = { pendingToken: string; options: PasskeyOptions };
type Finish = { pendingToken: string; response: unknown };
type Ceremony = typeof runPasskeyCeremony;
export interface PasskeySignInPort {
  begin(input: { pendingToken: string }): Promise<Started>;
  complete(input: Finish): Promise<void>;
}
export interface PasskeySettingsPort {
  status(): Promise<{ isOwner: boolean; credentials: { id: string }[] }>;
  enroll(input: { password: string; code: string }): Promise<Started>;
  confirm(input: Finish): Promise<void>;
  remove(input: { id: string; password: string; code: string }): Promise<void>;
}

/** Explicit alternative to a TOTP code; password proof remains required. O(1), two single-send calls. */
export function PasskeySignIn({ port, pendingToken, onComplete, translate: t, ceremony = runPasskeyCeremony }: {
  port: PasskeySignInPort; pendingToken: string; onComplete: () => void | Promise<void>; translate: Translate; ceremony?: Ceremony;
}) {
  const { busy, error, signIn } = usePasskeySignIn({ port, pendingToken, onComplete, t, ceremony });
  return <div><button type="button" disabled={busy} onClick={signIn}>{t(busy ? 'Waiting for passkey…' : 'Use a passkey')}</button>
    {error ? <p role="alert">{error}</p> : null}</div>;
}

/** Settings use the same owner password/TOTP management policy, with public credential ids only.
 * @complexity O(n), n <= 5 credentials; one mount read and explicit single-send actions, no polling.
 */
export function PasskeySettings({ port, translate: t, ceremony = runPasskeyCeremony }: { port: PasskeySettingsPort; translate: Translate; ceremony?: Ceremony }) {
  const { status, error, busy, password, setPassword, code, setCode, action } = usePasskeySettings({ port, t, ceremony });
  if (!status?.isOwner) return error ? <p role="alert">{error}</p> : null;
  return <section className="card"><h3>{t('Passkeys')}</h3>
    <p>{t('Use a passkey after your password instead of an authenticator code. Keep your authenticator app and recovery codes as a fallback.')}</p>
    <label>{t('Current owner password')}<input type="password" autoComplete="current-password" data-agent-private="" value={password} onChange={event => setPassword(event.target.value)} /></label>
    <label>{t('Authenticator code')}<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} data-agent-private="" value={code} onChange={event => setCode(event.target.value)} /></label>
    <button type="button" disabled={busy || !password || !code || status.credentials.length >= 5} onClick={() => action()}>{t('Add passkey')}</button>
    <ul>{status.credentials.map((credential, index) => <li key={credential.id}>{t('Passkey')} {index + 1} <button type="button" disabled={busy || !password || !code} onClick={() => action(credential.id)}>{t('Remove passkey')} {index + 1}</button></li>)}</ul>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
