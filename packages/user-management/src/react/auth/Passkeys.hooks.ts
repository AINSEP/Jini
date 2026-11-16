import { useEffect, useRef, useState } from 'react';

import type { PasskeySettingsPort, PasskeySignInPort } from './Passkeys.js';
import type { runPasskeyCeremony } from './passkey-browser.js';

import { type Translate } from '@jini-ai/core/text';
type Ceremony = typeof runPasskeyCeremony;

/** Keep obsolete sign-in attempts from updating a replacement or unmounted view. */
export function usePasskeySignIn({ port, pendingToken, onComplete, t, ceremony }: {
  port: PasskeySignInPort; pendingToken: string; onComplete: () => void | Promise<void>; t: Translate; ceremony: Ceremony;
}, _options = {}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, [pendingToken]);
  async function signIn() {
    const attempt = generation.current;
    setBusy(true); setError('');
    try {
      const started = await port.begin({ pendingToken });
      if (attempt !== generation.current) return;
      const response = await ceremony({ kind: 'authenticate', options: started.options });
      if (attempt !== generation.current) return;
      await port.complete({ pendingToken: started.pendingToken, response });
      if (attempt === generation.current) await onComplete();
    } catch (error) { if (attempt === generation.current) setError(error instanceof Error ? error.message : t('Passkey sign-in could not finish. Use your authenticator app or recovery code.')); }
    finally { if (attempt === generation.current) setBusy(false); }
  }
  return { busy, error, signIn };
}

/** Load owner credentials and run the existing enrollment or removal ceremony. */
export function usePasskeySettings({ port, t, ceremony }: {
  port: PasskeySettingsPort; t: Translate; ceremony: Ceremony;
}, _options = {}) {
  const [status, setStatus] = useState<Awaited<ReturnType<PasskeySettingsPort['status']>>>();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [password, setPassword] = useState(''), [code, setCode] = useState('');
  useEffect(() => {
    let active = true;
    void port.status().then(value => { if (active) setStatus(value); }).catch(error => {
      if (active) setError(error instanceof Error ? error.message : t('Passkey settings could not load. Reload this page to try again.'));
    });
    return () => { active = false; };
  }, [port]);
  async function action(id?: string) {
    setBusy(true); setError('');
    try {
      if (id) await port.remove({ id, password, code });
      else {
        const started = await port.enroll({ password, code });
        const response = await ceremony({ kind: 'register', options: started.options });
        await port.confirm({ pendingToken: started.pendingToken, response });
      }
      setStatus(await port.status());
    } catch (error) { setError(error instanceof Error ? error.message : t('The passkey action could not finish. Try a new attempt.')); }
    finally { setPassword(''); setCode(''); setBusy(false); }
  }
  return { status, error, busy, password, setPassword, code, setCode, action };
}
