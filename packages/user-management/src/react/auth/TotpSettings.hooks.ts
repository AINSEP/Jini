import { useEffect, useId, useState, type FormEvent } from 'react';

import type { TotpSettingsPort } from './TotpSettings.js';

import { type Translate } from '@jini-ai/core/text';
type Setup = Awaited<ReturnType<TotpSettingsPort['enroll']>>;

/** Read owner authenticator status, ignoring a result after unmount. */
export function useTotpSettings({ port, t }: { port: TotpSettingsPort; t: Translate }, _options: Record<string, never> = {}) {
  const [status, setStatus] = useState<Awaited<ReturnType<TotpSettingsPort['status']>>>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void port.status().then(value => { if (active) setStatus(value); }).catch(() => {
      if (active) setError(t('Authenticator settings could not load. Reload this page to try again.'));
    });
    return () => { active = false; };
  }, [port]);
  return { status, error };
}

/** Keep enrollment secrets and action state within the mounted form. */
export function useTotpSettingsForm({ port, initialEnrolled, t }: { port: TotpSettingsPort; initialEnrolled: boolean; t: Translate }, _options: Record<string, never> = {}) {
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
  return { enrolled, setup, password, setPassword, code, setCode, busy, error, message, passwordId, clear, enroll, confirm, remove };
}
