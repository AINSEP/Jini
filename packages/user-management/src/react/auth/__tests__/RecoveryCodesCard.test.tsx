import { fireEvent, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatUserFacingError, type UserFacingError } from '@jini-ai/core';
import { renderWithUmKit } from '../../__tests__/fake-um-kit.js';
import { RecoveryCodesCard, type RecoveryCodesCardProps } from '../RecoveryCodesCard.js';
import { createOwnerRecoveryKitDownload, useDesktopOwnerReset, useOwnerRecoveryKit, type OwnerRecoveryFailureFormatter, type OwnerRecoveryHookArgs, type OwnerRecoveryKitHook, type OwnerRecoveryPort } from '../RecoveryCodesCard.hooks.js';
import { useOwnerPasswordReset, useRecoveryKit } from '../OwnerRecovery.hooks.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const CODES = Array.from({ length: 10 }, (_, i) => String(i).padStart(64, 'a'));
const port = (owner = true, { available = owner, desktopOwnerReset = owner } = {}): OwnerRecoveryPort => ({
  status: vi.fn(async () => ({ isOwner: owner, available, desktopOwnerReset })),
  issue: vi.fn(async () => ({ codes: CODES })),
  reset: vi.fn(async () => {}), recover: vi.fn(async () => {}),
});
/** Stands in for the host formatter: the server message plus exact-secret redaction. */
const describeFailure = vi.fn<OwnerRecoveryFailureFormatter>(({ error, message, action, step, t, secrets = [] }) =>
  formatUserFacingError({ message: error instanceof Error ? error.message : t(message), action: t(action), step, cause: error }, { exactSecrets: secrets.filter(Boolean) }));
function FailureNotice({ failure }: { failure: UserFacingError }) { return <p role="alert">{failure.message}</p>; }
/** Binds the card's hooks the way a host does: each wrapper to its inner owner-recovery hook. */
function useBoundRecoveryKit(args: OwnerRecoveryHookArgs) { return useOwnerRecoveryKit(args, { useJiniRecoveryKitHook: useRecoveryKit }); }
function useBoundDesktopOwnerReset(args: OwnerRecoveryHookArgs) { return useDesktopOwnerReset(args, { useOwnerPasswordResetHook: useOwnerPasswordReset }); }
const HOOKS = { createDownloadHook: createOwnerRecoveryKitDownload, useRecoveryKitHook: useBoundRecoveryKit, useDesktopOwnerResetHook: useBoundDesktopOwnerReset };
function mount(p: OwnerRecoveryPort, extra: Partial<RecoveryCodesCardProps> = {}) {
  return renderWithUmKit(<RecoveryCodesCard port={p} describeFailure={describeFailure} FailureNotice={FailureNotice} filename="owner-recovery-codes.txt" {...HOOKS} {...extra} />);
}
const input = (id: string) => document.getElementById(id) as HTMLInputElement;

describe('owner recovery card (SEC-3, ported from the host)', () => {
  it('uses the current password for proof, one-time-code for the authenticator and new-password for the reset, all agent-private', async () => {
    mount(port());
    await screen.findByText('Generate recovery codes');
    expect(input('recovery-current-password')).toHaveAttribute('autocomplete', 'current-password');
    const code = screen.getByLabelText('Authenticator code (if enabled)');
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    for (const id of ['desktop-owner-password', 'desktop-owner-confirm']) expect(input(id)).toHaveAttribute('autocomplete', 'new-password');
    for (const element of [input('recovery-current-password'), code, input('desktop-owner-password'), input('desktop-owner-confirm')]) expect(element).toHaveAttribute('data-agent-private', '');
  });
  it('renders nothing for staff', async () => {
    const p = port(false); const { container } = mount(p);
    await waitFor(() => expect(screen.queryByText('Loading owner recovery…')).toBeNull());
    expect(container).toBeEmptyDOMElement();
  });
  it('renders nothing for an owner when recovery is unavailable', async () => {
    const { container } = mount(port(true, { available: false }));
    await waitFor(() => expect(screen.queryByText('Loading owner recovery…')).toBeNull());
    expect(container).toBeEmptyDOMElement();
  });
  it('shows a status load failure through the injected notice, with no proof to redact', async () => {
    const p = port(); p.status = async () => { throw new Error('The identity database is offline.'); };
    mount(p);
    expect(await screen.findByRole('alert')).toHaveTextContent('The identity database is offline.');
    expect(describeFailure).toHaveBeenLastCalledWith(expect.objectContaining({ step: 'owner-recovery-status', message: 'Owner recovery settings could not load.' }));
    expect(describeFailure.mock.lastCall![0].secrets).toBeUndefined();
  });
  it('issues once with the password and code, then renders exactly ten codes inside a private element', async () => {
    const p = port(); mount(p);
    await screen.findByText('Generate recovery codes');
    fireEvent.change(input('recovery-current-password'), { target: { value: 'owner-password' } });
    fireEvent.change(screen.getByLabelText('Authenticator code (if enabled)'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Generate recovery codes'));
    const output = (await screen.findByText('Download codes')).closest('[data-agent-private]')!;
    expect(p.issue).toHaveBeenCalledExactlyOnceWith({ password: 'owner-password', code: '123456' });
    expect(output.querySelector('pre')!.textContent!.split('\n')).toEqual(CODES);
    expect(screen.queryByDisplayValue('owner-password')).toBeNull();
    expect(screen.queryByDisplayValue('123456')).toBeNull();
  });
  it('passes the exact submitted password and code to the redactor when issue fails, and shows neither', async () => {
    const p = port(); p.issue = vi.fn(async () => { throw new Error('refused for owner-password 123456'); }); mount(p);
    await screen.findByText('Generate recovery codes');
    fireEvent.change(input('recovery-current-password'), { target: { value: 'owner-password' } });
    fireEvent.change(screen.getByLabelText('Authenticator code (if enabled)'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Generate recovery codes'));
    await screen.findByRole('alert');
    expect(describeFailure).toHaveBeenLastCalledWith(expect.objectContaining({ step: 'owner-recovery-issue', secrets: ['owner-password', '123456'] }));
    expect(document.body.textContent).not.toContain('owner-password');
    expect(document.body.textContent).not.toContain('123456');
  });
  it('downloads through the injected filename and the joined codes, releases the object URL, then clears the codes', async () => {
    // jsdom has no object URLs; these stand in for the browser's.
    const created = vi.fn(() => 'blob:kit'), revoked = vi.fn();
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const saved: { text: string; filename: string }[] = [];
    const createDownloadHook: typeof createOwnerRecoveryKitDownload = (required) => createOwnerRecoveryKitDownload(required, { saveTextFile: (file) => { saved.push(file); } });
    mount(port(), { createDownloadHook });
    await screen.findByText('Generate recovery codes');
    fireEvent.change(input('recovery-current-password'), { target: { value: 'owner-password' } });
    fireEvent.click(screen.getByText('Generate recovery codes'));
    fireEvent.click(await screen.findByText('Download codes'));
    expect(saved).toEqual([{ text: CODES.join('\n') + '\n', filename: 'owner-recovery-codes.txt' }]);
    expect(screen.queryByText('Download codes')).toBeNull();
    cleanup(); mount(port());
    await screen.findByText('Generate recovery codes');
    fireEvent.change(input('recovery-current-password'), { target: { value: 'owner-password' } });
    fireEvent.click(screen.getByText('Generate recovery codes'));
    fireEvent.click(await screen.findByText('Download codes'));
    expect(created).toHaveBeenCalledTimes(1); expect(click).toHaveBeenCalledTimes(1); expect(revoked).toHaveBeenCalledWith('blob:kit');
    expect(screen.queryByText('Download codes')).toBeNull();
  });
  it('dismiss clears the codes', async () => {
    mount(port());
    await screen.findByText('Generate recovery codes');
    fireEvent.change(input('recovery-current-password'), { target: { value: 'owner-password' } });
    fireEvent.click(screen.getByText('Generate recovery codes'));
    fireEvent.click(await screen.findByText('I saved these codes'));
    expect(screen.queryByText('Download codes')).toBeNull();
    expect(document.body.textContent).not.toContain(CODES[0]);
    expect(document.querySelector('[data-agent-private] pre')).toBeNull();
  });
  it('offers no reset form without desktopOwnerReset', async () => {
    mount(port(true, { desktopOwnerReset: false }));
    await screen.findByText('Generate recovery codes');
    expect(screen.queryByText('Reset owner password')).toBeNull();
  });
  it('keeps the reset button disabled until the new password is typed, and refuses a mismatch without calling reset', async () => {
    const p = port(); mount(p);
    fireEvent.click(await screen.findByText('Reset owner password'));
    const submit = screen.getByText('Reset password and sign out sessions');
    expect(submit).toBeDisabled();
    fireEvent.change(input('desktop-owner-password'), { target: { value: 'new-one' } });
    expect(submit).toBeEnabled();
    fireEvent.change(input('desktop-owner-confirm'), { target: { value: 'other' } });
    fireEvent.click(submit);
    expect(await screen.findByRole('status')).toHaveTextContent('The passwords do not match.');
    expect(p.reset).not.toHaveBeenCalled();
  });
  it('resets on a matching pair and shows the success message', async () => {
    const p = port(); mount(p);
    fireEvent.click(await screen.findByText('Reset owner password'));
    fireEvent.change(input('desktop-owner-password'), { target: { value: 'new-one' } });
    fireEvent.change(input('desktop-owner-confirm'), { target: { value: 'new-one' } });
    fireEvent.click(screen.getByText('Reset password and sign out sessions'));
    expect(await screen.findByRole('status')).toHaveTextContent('Owner password reset.');
    expect(p.reset).toHaveBeenCalledExactlyOnceWith({ password: 'new-one' });
  });
  it('passes the exact submitted password to the redactor when reset fails', async () => {
    const p = port(); p.reset = vi.fn(async () => { throw new Error('Too many attempts for new-one'); }); mount(p);
    fireEvent.click(await screen.findByText('Reset owner password'));
    fireEvent.change(input('desktop-owner-password'), { target: { value: 'new-one' } });
    fireEvent.change(input('desktop-owner-confirm'), { target: { value: 'new-one' } });
    fireEvent.click(screen.getByText('Reset password and sign out sessions'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
    expect(describeFailure).toHaveBeenLastCalledWith(expect.objectContaining({ step: 'desktop-owner-reset', secrets: ['new-one'] }));
    expect(document.body.textContent).not.toContain('new-one');
  });
  it('translates with the page translator and does not reread status on a language change', async () => {
    const p = port();
    const { rerender } = mount(p, { t: text => text });
    await screen.findByText('Recovery codes');
    rerender(<RecoveryCodesCard port={p} describeFailure={describeFailure} FailureNotice={FailureNotice} filename="f" {...HOOKS} t={text => `translated:${text}`} />);
    expect(screen.getByText('translated:Recovery codes')).toBeTruthy();
    expect(p.status).toHaveBeenCalledTimes(1);
  });
  it('renders through the host-injected recovery-kit hook, never an imported one (rv1123c FIX 3)', async () => {
    const useRecoveryKitHook = vi.fn<OwnerRecoveryKitHook>(() => ({ password: '', setPassword: vi.fn(), code: '', setCode: vi.fn(), codes: ['injected-fixture-code'], setCodes: vi.fn(), busy: false, error: null, submit: vi.fn() }) as unknown as ReturnType<OwnerRecoveryKitHook>);
    const p = port(true, { desktopOwnerReset: false });
    mount(p, { useRecoveryKitHook });
    expect(await screen.findByText('injected-fixture-code')).toBeTruthy();
    expect(useRecoveryKitHook).toHaveBeenCalledWith(expect.objectContaining({ port: p, describeFailure }));
  });
});
