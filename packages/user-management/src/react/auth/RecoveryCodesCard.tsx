import type { createOwnerRecoveryKitDownload, DesktopOwnerResetHook, OwnerRecoveryFailureFormatter, OwnerRecoveryKitHook, OwnerRecoveryPort, OwnerRecoveryStatus } from './RecoveryCodesCard.hooks.js';
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import type { UserFacingError } from '@jini-ai/core';
import { AGENT_PRIVATE_ATTRIBUTE } from '@jini-ai/core/agent-handles';
import { SecretInput } from '../kit.js';

import { type Translate } from '@jini-ai/core/text';
const identityTranslate: Translate = text => text;
/** The host's failure presentation (message, action and copyable redacted details). */
export type RecoveryFailureNotice = ComponentType<{ failure: UserFacingError; t: Translate }>;
interface CardChrome { port: OwnerRecoveryPort; t: Translate; describeFailure: OwnerRecoveryFailureFormatter; FailureNotice: RecoveryFailureNotice }
export interface RecoveryCodesCardProps {
  port: OwnerRecoveryPort;
  describeFailure: OwnerRecoveryFailureFormatter;
  FailureNotice: RecoveryFailureNotice;
  /** The name the saved kit file gets; host product copy. */
  filename: string;
  t?: Translate;
  /** Host-bound hooks (owner rule: no hook is imported by the card): `createOwnerRecoveryKitDownload`,
   * and `useOwnerRecoveryKit` / `useDesktopOwnerReset` each bound to their inner owner-recovery hook. */
  createDownloadHook: typeof createOwnerRecoveryKitDownload;
  useRecoveryKitHook: OwnerRecoveryKitHook;
  useDesktopOwnerResetHook: DesktopOwnerResetHook;
}

/** Existing Security page adapter. Codes live only in component memory until saved/dismissed.
 * @complexity O(1), one small status read on mount; one ten-code write per explicit rotation.
 */
export function RecoveryCodesCard({ port, describeFailure, FailureNotice, filename, t = identityTranslate, createDownloadHook, useRecoveryKitHook, useDesktopOwnerResetHook }: RecoveryCodesCardProps) {
  const [status, setStatus] = useState<OwnerRecoveryStatus>();
  const [loadError, setLoadError] = useState<{ cause: unknown } | null>(null);
  useEffect(() => {
    let active = true;
    void port.status().then(value => { if (active) setStatus(value); }).catch(error => {
      if (active) setLoadError({ cause: error });
    });
    return () => { active = false; };
  }, [port]);
  const error = useMemo(() => loadError ? describeFailure({ error: loadError.cause,
    message: 'Owner recovery settings could not load.',
    action: 'Reload this page after resolving the server explanation. Ask the host operator to check the identity database if it continues.',
    step: 'owner-recovery-status', t }) : null, [loadError, t, describeFailure]);
  if (error) return <FailureNotice failure={error} t={t} />;
  if (!status) return <p>{t('Loading owner recovery…')}</p>;
  if (!status.isOwner || !status.available) return null;
  const chrome: CardChrome = { port, t, describeFailure, FailureNotice };
  return <section className="jini-card">
    <h3>{t('Recovery codes')}</h3>
    <p>{t('Save ten single-use codes somewhere private. Using one resets your owner password, removes authenticators and passkeys, signs out all sessions and invalidates every code in the set.')}</p>
    <RecoveryKit {...chrome} filename={filename} createDownloadHook={createDownloadHook} useRecoveryKitHook={useRecoveryKitHook} />
    {status.desktopOwnerReset ? <DesktopOwnerReset {...chrome} useDesktopOwnerResetHook={useDesktopOwnerResetHook} /> : null}
  </section>;
}

/** Issue only after password proof; never persist raw codes or leave the submitted password in state.
 * @complexity O(1), one rotation per submit and at most ten codes in memory.
 */
function RecoveryKit({ port, t, describeFailure, FailureNotice, filename, createDownloadHook,
  useRecoveryKitHook }: CardChrome & { filename: string; createDownloadHook: typeof createOwnerRecoveryKitDownload;
  useRecoveryKitHook: OwnerRecoveryKitHook; }) {
  const { password, setPassword, code, setCode, codes, setCodes, busy, error, submit } = useRecoveryKitHook({ port, t, describeFailure });
  return <div>
    <form onSubmit={submit}>
      <label htmlFor="recovery-current-password">{t('Current owner password')}</label>
      <SecretInput id="recovery-current-password" label={t('Current owner password')} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} {...{ [AGENT_PRIVATE_ATTRIBUTE]: '' }} />
      <label>{t('Authenticator code (if enabled)')}<input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} data-agent-private="" value={code} onChange={event => setCode(event.target.value)} /></label>
      <button className="jini-btn-primary" disabled={busy || !password}>{t('Generate recovery codes')}</button>
      <p>{t('Generating a new set invalidates all previous codes. Codes are shown only now.')}</p>
    </form>
    {error ? <FailureNotice failure={error} t={t} /> : null}
    {codes.length ? <RecoveryKitOutput codes={codes} dismiss={() => setCodes([])} t={t} filename={filename} createDownloadHook={createDownloadHook} /> : null}
  </div>;
}

/** Download the currently displayed kit once, then erase it from this view. No server read.
 * @complexity O(1), one local blob of ten codes (~650 bytes), immediately released.
 */
function RecoveryKitOutput({ codes, dismiss, t, filename, createDownloadHook }: { codes: string[]; dismiss: () => void; t: Translate; filename: string; createDownloadHook: typeof createOwnerRecoveryKitDownload }) {
  const download = createDownloadHook({ codes, dismiss, filename });
  return <div {...{ [AGENT_PRIVATE_ATTRIBUTE]: '' }}>
    <pre>{codes.join('\n')}</pre>
    <button type="button" className="jini-btn-secondary" onClick={download}>{t('Download codes')}</button>
    <button type="button" className="jini-btn-secondary" onClick={dismiss}>{t('I saved these codes')}</button>
  </div>;
}

/** Desktop proof restores the ordinary owner session before this action is offered by the server.
 * @complexity O(1) UI state, one reset request per explicit submit; no staff promotion.
 */
function DesktopOwnerReset({ port, t, describeFailure, FailureNotice,
  useDesktopOwnerResetHook }: CardChrome & {
  useDesktopOwnerResetHook: DesktopOwnerResetHook; }) {
  const { password, setPassword, confirmation, setConfirmation, busy, message, failure, submit } = useDesktopOwnerResetHook({ port, t, describeFailure });
  return <details><summary>{t('Reset owner password')}</summary>
    <p>{t('Your desktop launch restored your owner session. Choose a new password; this signs out all sessions and invalidates recovery codes.')}</p>
    <form onSubmit={submit}>
      <label htmlFor="desktop-owner-password">{t('New owner password')}</label>
      <SecretInput id="desktop-owner-password" label={t('New owner password')} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} {...{ [AGENT_PRIVATE_ATTRIBUTE]: '' }} />
      <label htmlFor="desktop-owner-confirm">{t('Confirm new owner password')}</label>
      <SecretInput id="desktop-owner-confirm" label={t('Confirm new owner password')} autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} {...{ [AGENT_PRIVATE_ATTRIBUTE]: '' }} />
      <button className="jini-btn-primary" disabled={busy || !password}>{t('Reset password and sign out sessions')}</button>
    </form>
    {failure ? <FailureNotice failure={failure} t={t} /> : null}
    {message ? <p className="jini-notice" role="status">{message}</p> : null}
  </details>;
}
