import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { PasskeySignIn, PasskeySettings } from '../Passkeys.js';
const translate = (text: string) => text;
const started = { pendingToken: 'ceremony', options: { challenge: 'challenge' } };

test('passkey sign-in requires the pending password proof and completes only after the browser and server agree', async () => {
  const user = userEvent.setup(), onComplete = vi.fn(), ceremony = vi.fn().mockResolvedValue({ id: 'key' });
  const port = { begin: vi.fn().mockResolvedValue(started), complete: vi.fn().mockRejectedValueOnce(Error('Start a new attempt.')).mockResolvedValue(undefined) };
  render(<PasskeySignIn port={port} pendingToken="password-proof" onComplete={onComplete} translate={translate} ceremony={ceremony} />);
  await user.click(screen.getByRole('button', { name: 'Use a passkey' }));
  expect(port.begin).toHaveBeenCalledWith({ pendingToken: 'password-proof' });
  expect(ceremony).toHaveBeenCalledWith({ kind: 'authenticate', options: started.options });
  expect(port.complete).toHaveBeenCalledWith({ pendingToken: 'ceremony', response: { id: 'key' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('Start a new attempt.');
  expect(onComplete).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Use a passkey' }));
  await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
});

test('cancelled browser prompt leaves authenticator fallback available and never completes a server proof', async () => {
  const user = userEvent.setup(), onComplete = vi.fn();
  const port = { begin: vi.fn().mockResolvedValue(started), complete: vi.fn() };
  render(<PasskeySignIn port={port} pendingToken="password-proof" onComplete={onComplete} translate={translate}
    ceremony={async () => { throw Error('Prompt cancelled. Use your authenticator app.'); }} />);
  await user.click(screen.getByRole('button', { name: 'Use a passkey' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Prompt cancelled. Use your authenticator app.');
  expect(port.complete).not.toHaveBeenCalled(); expect(onComplete).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Use a passkey' })).toBeEnabled();
});

test('settings require password and TOTP, confirm registration before listing, and clear management proofs', async () => {
  const user = userEvent.setup();
  const port = { status: vi.fn().mockResolvedValueOnce({ isOwner: true, credentials: [] })
    .mockResolvedValueOnce({ isOwner: true, credentials: [{ id: 'key' }] }).mockResolvedValue({ isOwner: true, credentials: [] }),
    enroll: vi.fn().mockResolvedValue(started), confirm: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) };
  const ceremony = vi.fn().mockResolvedValue({ id: 'key' });
  render(<PasskeySettings port={port} translate={translate} ceremony={ceremony} />);
  const password = await screen.findByLabelText('Current owner password');
  expect(screen.getByRole('button', { name: 'Add passkey' })).toBeDisabled();
  await user.type(password, 'password'); await user.type(screen.getByLabelText('Authenticator code'), '123456');
  await user.click(screen.getByRole('button', { name: 'Add passkey' }));
  expect(port.enroll).toHaveBeenCalledWith({ password: 'password', code: '123456' });
  expect(ceremony).toHaveBeenCalledWith({ kind: 'register', options: started.options });
  expect(port.confirm).toHaveBeenCalledWith({ pendingToken: 'ceremony', response: { id: 'key' } });
  const remove = await screen.findByRole('button', { name: 'Remove passkey 1' });
  expect(password).toHaveValue(''); expect(screen.getByLabelText('Authenticator code')).toHaveValue('');
  expect(remove).toBeDisabled();
  await user.type(password, 'password'); await user.type(screen.getByLabelText('Authenticator code'), '234567');
  await user.click(remove);
  expect(port.remove).toHaveBeenCalledWith({ id: 'key', password: 'password', code: '234567' });
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove passkey 1' })).not.toBeInTheDocument());
});

test('staff sees no management controls; status failure explains fallback', async () => {
  const port = { status: vi.fn().mockResolvedValue({ isOwner: false, credentials: [] }), enroll: vi.fn(), confirm: vi.fn(), remove: vi.fn() };
  const { unmount } = render(<PasskeySettings port={port} translate={translate} />);
  await waitFor(() => expect(port.status).toHaveBeenCalledOnce());
  expect(screen.queryByLabelText('Current owner password')).not.toBeInTheDocument(); unmount();
  render(<PasskeySettings port={{ ...port, status: async () => { throw Error('Use your authenticator here.'); } }} translate={translate} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Use your authenticator here.');
});

test('cancelling the MFA screen while a prompt is open never submits its late browser response', async () => {
  const user = userEvent.setup(), onComplete = vi.fn();
  let resolve!: (response: unknown) => void;
  const response = new Promise<unknown>(done => { resolve = done; });
  const port = { begin: vi.fn().mockResolvedValue(started), complete: vi.fn() };
  const { unmount } = render(<PasskeySignIn port={port} pendingToken="password-proof" onComplete={onComplete}
    translate={translate} ceremony={() => response} />);
  await user.click(screen.getByRole('button', { name: 'Use a passkey' }));
  unmount(); resolve({ id: 'late-key' });
  await new Promise(done => setTimeout(done, 0));
  expect(port.complete).not.toHaveBeenCalled(); expect(onComplete).not.toHaveBeenCalled();
});

test('passkey sign-in renders the busy state and error of the injected hook and routes its click to the injected signIn', async () => {
  const user = userEvent.setup(), signIn = vi.fn();
  const useFake = vi.fn(() => ({ busy: false, error: 'Fake passkey failure', signIn }));
  render(<PasskeySignIn port={{} as never} pendingToken="t" onComplete={vi.fn()} translate={translate} usePasskeySignInHook={useFake as never} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Fake passkey failure');
  await user.click(screen.getByRole('button', { name: 'Use a passkey' }));
  expect(signIn).toHaveBeenCalledTimes(1);
  expect(useFake).toHaveBeenCalledWith(expect.objectContaining({ pendingToken: 't' }));
});

test('passkey settings render the credentials of the injected hook and revoke through its action', async () => {
  const user = userEvent.setup(), action = vi.fn();
  const useFake = vi.fn(() => ({
    status: { isOwner: true, credentials: [{ id: 'cred-1' }] }, error: undefined, busy: false,
    password: 'pw', setPassword: vi.fn(), code: '123456', setCode: vi.fn(), action,
  }));
  render(<PasskeySettings port={{} as never} translate={translate} usePasskeySettingsHook={useFake as never} />);
  expect(screen.getByRole('heading', { name: 'Passkeys' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Add passkey' }));
  expect(action).toHaveBeenCalledWith();
});

test('a replacement password proof while the server begin is in flight never opens the stale browser prompt', async () => {
  const user = userEvent.setup(), onComplete = vi.fn(), ceremony = vi.fn();
  let release!: (value: typeof started) => void;
  const begin = vi.fn(() => new Promise<typeof started>(done => { release = done; }));
  const port = { begin, complete: vi.fn() };
  const { rerender } = render(<PasskeySignIn port={port} pendingToken="password-proof" onComplete={onComplete} translate={translate} ceremony={ceremony} />);
  await user.click(screen.getByRole('button', { name: 'Use a passkey' }));
  expect(screen.getByRole('button', { name: 'Waiting for passkey…' })).toBeDisabled();
  rerender(<PasskeySignIn port={port} pendingToken="new-proof" onComplete={onComplete} translate={translate} ceremony={ceremony} />);
  release(started);
  await new Promise(done => setTimeout(done, 0));
  expect(begin).toHaveBeenCalledWith({ pendingToken: 'password-proof' });
  expect(ceremony).not.toHaveBeenCalled(); expect(port.complete).not.toHaveBeenCalled(); expect(onComplete).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('a sign-in failure that is not an Error shows the translated fallback guidance', async () => {
  const user = userEvent.setup();
  const port = { begin: vi.fn().mockRejectedValue('offline'), complete: vi.fn() };
  render(<PasskeySignIn port={port} pendingToken="password-proof" onComplete={vi.fn()} translate={text => `tr:${text}`} ceremony={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: 'tr:Use a passkey' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('tr:Passkey sign-in could not finish. Use your authenticator app or recovery code.');
  expect(screen.getByRole('button', { name: 'tr:Use a passkey' })).toBeEnabled();
});

test('a settings load failure that is not an Error shows the translated reload guidance', async () => {
  const port = { status: vi.fn().mockRejectedValue('offline'), enroll: vi.fn(), confirm: vi.fn(), remove: vi.fn() };
  render(<PasskeySettings port={port} translate={text => `tr:${text}`} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('tr:Passkey settings could not load. Reload this page to try again.');
});

test('a failed owner action keeps the list, shows the translated fallback for a non-Error, and clears the proofs', async () => {
  const user = userEvent.setup();
  const port = { status: vi.fn().mockResolvedValue({ isOwner: true, credentials: [{ id: 'key' }] }),
    enroll: vi.fn(), confirm: vi.fn(), remove: vi.fn().mockRejectedValue('offline') };
  render(<PasskeySettings port={port} translate={text => `tr:${text}`} ceremony={vi.fn()} />);
  const password = await screen.findByLabelText('tr:Current owner password');
  await user.type(password, 'password'); await user.type(screen.getByLabelText('tr:Authenticator code'), '123456');
  await user.click(screen.getByRole('button', { name: 'tr:Remove passkey 1' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('tr:The passkey action could not finish. Try a new attempt.');
  expect(port.remove).toHaveBeenCalledWith({ id: 'key', password: 'password', code: '123456' });
  expect(port.status).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'tr:Remove passkey 1' })).toBeDisabled();
  expect(password).toHaveValue(''); expect(screen.getByLabelText('tr:Authenticator code')).toHaveValue('');
});

test('a refused enrollment shows the server reason verbatim and never opens the browser prompt', async () => {
  const user = userEvent.setup(), ceremony = vi.fn();
  const port = { status: vi.fn().mockResolvedValue({ isOwner: true, credentials: [] }),
    enroll: vi.fn().mockRejectedValue(new Error('Set up your authenticator app before adding a passkey.')), confirm: vi.fn(), remove: vi.fn() };
  render(<PasskeySettings port={port} translate={translate} ceremony={ceremony} />);
  await user.type(await screen.findByLabelText('Current owner password'), 'password');
  await user.type(screen.getByLabelText('Authenticator code'), '123456');
  await user.click(screen.getByRole('button', { name: 'Add passkey' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Set up your authenticator app before adding a passkey.');
  expect(ceremony).not.toHaveBeenCalled(); expect(port.confirm).not.toHaveBeenCalled();
});
