import { useEffect, useId, useState, type FormEvent } from 'react';
import { SecretInput } from '@jini-ai/ui';
import type { Translate } from '@jini-ai/ui/panel-kit';

export interface TotpSettingsPort {
  status(): Promise<{ isOwner: boolean; available: boolean; enrolled: boolean }>;
  enroll(input: { password: string; code?: string }): Promise<{ pendingToken: string; secret: string; uri: string }>;
  confirm(input: { pendingToken: string; code: string }): Promise<void>;
  remove(input: { password: string; code: string }): Promise<void>;
}
type Setup = Awaited<ReturnType<TotpSettingsPort['enroll']>>;

/** Owner settings hold setup secrets only until confirmation/cancellation or unmount.
 * @complexity O(1): one bounded status read on mount and one request per explicit action; no polling.
 */
export function TotpSettings({ port, translate: t }: { port: TotpSettingsPort; translate: Translate }) {
  const [status, setStatus] = useState<Awaited<ReturnType<TotpSettingsPort['status']>>>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void port.status().then(value => { if (active) setStatus(value); }).catch(() => {
      if (active) setError(t('Authenticator settings could not load. Reload this page to try again.'));
    });
    return () => { active = false; };
  }, [port]);
  if (error) return <p role="alert">{error}</p>;
  if (!status?.isOwner || !status.available) return null;
  return <TotpSettingsForm port={port} enrolled={status.enrolled} t={t} />;
}

function TotpSettingsForm({ port, enrolled: initialEnrolled, t }: { port: TotpSettingsPort; enrolled: boolean; t: Translate }) {
  const [enrolled, setEnrolled] = useState(initialEnrolled), [setup, setSetup] = useState<Setup>();
  const [password, setPassword] = useState(''), [code, setCode] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const passwordId = useId();
  function clear() { setSetup(undefined); setPassword(''); setCode(''); setError(''); }
  async function enroll(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try { setSetup(await port.enroll({ password, ...(enrolled ? { code } : {}) })); setCode(''); }
    catch (error) { setError(error instanceof Error ? error.message : t('Authenticator setup could not start. Try again.')); }
    finally { setPassword(''); setBusy(false); }
  }
  async function confirm(event: FormEvent) {
    event.preventDefault(); if (!setup) return;
    setBusy(true); setError('');
    try { await port.confirm({ pendingToken: setup.pendingToken, code }); clear(); setEnrolled(true); setMessage(t('Authenticator enabled. Sign in again with the next code from your app.')); }
    catch (error) { setError(error instanceof Error ? error.message : t('The code was not accepted. Enter a fresh authenticator code.')); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setError(''); setMessage('');
    try { await port.remove({ password, code }); clear(); setEnrolled(false); setMessage(t('Authenticator removed. Sign in again.')); }
    catch (error) { setError(error instanceof Error ? error.message : t('The authenticator could not be removed. Check your password and code.')); }
    finally { setPassword(''); setCode(''); setBusy(false); }
  }
  return <section className="card">
    <h3>{t('Authenticator app')}</h3>
    <p>{t(enrolled ? 'Your authenticator code is required at every sign-in, including desktop.' : 'Add an authenticator app to require a code when signing in as the owner.')}</p>
    {setup ? <form onSubmit={confirm}>
      <p>{t('Add this setup key to your authenticator app, then enter its six-digit code. Keep the key private.')}</p>
      <code data-agent-private="">{setup.secret}</code>
      <CodeInput code={code} setCode={setCode} t={t} />
      <button disabled={busy}>{t('Confirm authenticator')}</button>
      <button type="button" disabled={busy} onClick={clear}>{t('Cancel')}</button>
    </form> : <form onSubmit={enroll}>
      <label htmlFor={passwordId}>{t('Current owner password')}</label>
      <SecretInput id={passwordId} label={t('Current owner password')} autoComplete="current-password" data-agent-private="" value={password} onChange={event => setPassword(event.target.value)} />
      {enrolled ? <CodeInput code={code} setCode={setCode} t={t} /> : null}
      <button disabled={busy || !password}>{t(enrolled ? 'Replace authenticator' : 'Set up authenticator')}</button>
      {enrolled ? <button type="button" disabled={busy || !password || !code} onClick={remove}>{t('Remove authenticator')}</button> : null}
    </form>}
    {error ? <p role="alert">{error}</p> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}

function CodeInput({ code, setCode, t }: { code: string; setCode: (code: string) => void; t: Translate }) {
  return <label>{t('Authenticator code')}<input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} data-agent-private="" value={code} onChange={event => setCode(event.target.value)} /></label>;
}
