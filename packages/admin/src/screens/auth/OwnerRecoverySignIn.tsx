import { AGENT_PRIVATE_ATTRIBUTE } from '@jini-ai/core/agent-handles';
import type { AuthErrorNotice, AuthSecretInput, OwnerRecoverRequest, OwnerRecoverySignInController } from './auth-host-slots.js';

import { type Translate } from '@jini-ai/core/text';
const identityTranslate: Translate = text => text;

/** What the host injects into {@link OwnerRecoverySignIn}: its recovery client call, the bound
 *  controller hook, and its secret input / error notice components. */
export interface OwnerRecoverySignInProps {
  recover: OwnerRecoverRequest; t?: Translate;
  useOwnerRecoverySignInHook: (args: { recover: OwnerRecoverRequest; t: Translate }) => OwnerRecoverySignInController;
  SecretInput: AuthSecretInput; ErrorNotice: AuthErrorNotice;
}

/** Sign-in adapter for a lost owner password; code scope is selected only by the server.
 * @complexity O(1), one request on explicit submit (64-character code and bounded password), no polling.
 */
export function OwnerRecoverySignIn({ recover, t = identityTranslate, useOwnerRecoverySignInHook, SecretInput, ErrorNotice }: OwnerRecoverySignInProps) {
  const { code, setCode, password, setPassword, confirmation, setConfirmation, failure, busy, message, submit } = useOwnerRecoverySignInHook({ recover, t });
  return <details className="jini-login-card"><summary>{t('Lost your owner password?')}</summary>
    <p>{t('Use a saved recovery code to reset your password and remove authenticators and passkeys. Without a code, ask the host operator to recover this site.')}</p>
    <form onSubmit={submit}>
      <label htmlFor="owner-recovery-code">{t('Recovery code')}</label>
      <SecretInput id="owner-recovery-code" label={t('Recovery code')} autoComplete="new-password" maxLength={64} value={code} onChange={event => setCode(event.target.value)} {...{ [AGENT_PRIVATE_ATTRIBUTE]: '' }} />
      <label htmlFor="owner-recovery-password">{t('New password')}</label>
      <SecretInput id="owner-recovery-password" label={t('New password')} autoComplete="new-password" maxLength={512} value={password} onChange={event => setPassword(event.target.value)} {...{ [AGENT_PRIVATE_ATTRIBUTE]: '' }} />
      <label htmlFor="owner-recovery-confirm">{t('Confirm new password')}</label>
      <SecretInput id="owner-recovery-confirm" label={t('Confirm new password')} autoComplete="new-password" maxLength={512} value={confirmation} onChange={event => setConfirmation(event.target.value)} {...{ [AGENT_PRIVATE_ATTRIBUTE]: '' }} />
      <button disabled={busy || !code || !password}>{t('Recover owner account')}</button>
    </form>
    {failure ? <ErrorNotice failure={failure} t={t} /> : null}
    {message ? <p className="jini-login-notice" role="status">{message}</p> : null}
  </details>;
}
