import { SecretInput } from '../kit.js';

import { useTotpSettings, useTotpSettingsForm } from './TotpSettings.hooks.js';

import { type Translate } from '@jini-ai/core/text';
export interface TotpSettingsPort {
  status(): Promise<{ isOwner: boolean; available: boolean; enrolled: boolean }>;
  enroll(input: { password: string; code?: string }): Promise<{ pendingToken: string; secret: string; uri: string }>;
  confirm(input: { pendingToken: string; code: string }): Promise<void>;
  remove(input: { password: string; code: string }): Promise<void>;
}

/** Owner settings hold setup secrets only until confirmation/cancellation or unmount.
 * @complexity O(1): one bounded status read on mount and one request per explicit action; no polling.
 */
export function TotpSettings({ port, translate: t, useTotpSettingsHook = useTotpSettings, useTotpSettingsFormHook = useTotpSettingsForm }: { port: TotpSettingsPort; translate: Translate; useTotpSettingsHook?: typeof useTotpSettings; useTotpSettingsFormHook?: typeof useTotpSettingsForm }) {
  const { status, error } = useTotpSettingsHook({ port, t });
  if (error) return <p role="alert">{error}</p>;
  if (!status?.isOwner || !status.available) return null;
  return <TotpSettingsForm port={port} enrolled={status.enrolled} t={t} useTotpSettingsFormHook={useTotpSettingsFormHook} />;
}

const isTotpRemovalDisabled = ({ busy, password, code }: { busy: boolean; password: string; code: string }) => busy || !password || !code;

function TotpSettingsForm({ port, enrolled: initialEnrolled, t, useTotpSettingsFormHook = useTotpSettingsForm }: { port: TotpSettingsPort; enrolled: boolean; t: Translate; useTotpSettingsFormHook?: typeof useTotpSettingsForm }) {
  const { enrolled, setup, password, setPassword, code, setCode, busy, error, message, passwordId, clear, enroll, confirm, remove } = useTotpSettingsFormHook({ port, initialEnrolled, t });
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
      <CodeInput code={code} setCode={setCode} t={t} visible={enrolled} />
      <button disabled={busy || !password}>{t(enrolled ? 'Replace authenticator' : 'Set up authenticator')}</button>
      {enrolled ? <button type="button" disabled={isTotpRemovalDisabled({ busy, password, code })} onClick={remove}>{t('Remove authenticator')}</button> : null}
    </form>}
    {error ? <p role="alert">{error}</p> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}

function CodeInput({ code, setCode, t, visible = true }: { code: string; setCode: (code: string) => void; t: Translate; visible?: boolean }) {
  if (!visible) return null;
  return <label>{t('Authenticator code')}<input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} data-agent-private="" value={code} onChange={event => setCode(event.target.value)} /></label>;
}
