import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Login } from '../Login.js';
import { TotpSettings } from '../TotpSettings.js';
const translate = (key: string) => key;

describe('owner authenticator UI', () => {
  it('withholds onLogin until the code succeeds and allows cancellation', async () => {
    const user = userEvent.setup(), onLogin = vi.fn();
    const completeMfa = vi.fn().mockRejectedValueOnce(new Error('Use a fresh code.')).mockResolvedValue({ user: { id: 'owner', username: 'owner' } });
    const port = { login: vi.fn().mockResolvedValue({ mfaRequired: true, pendingToken: 'proof' }), completeMfa };
    render(<Login port={port} translate={translate} productName="Example" onLogin={onLogin} />);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    const input = await screen.findByLabelText('Authenticator code');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(onLogin).not.toHaveBeenCalled();
    await user.type(input, '123456');
    await user.click(screen.getByRole('button', { name: 'Verify code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Use a fresh code.');
    expect(onLogin).not.toHaveBeenCalled();
    await user.clear(input); await user.type(input, '234567');
    await user.click(screen.getByRole('button', { name: 'Verify code' }));
    expect(completeMfa).toHaveBeenLastCalledWith({ pendingToken: 'proof', code: '234567' });
    expect(onLogin).toHaveBeenCalledWith({ id: 'owner', username: 'owner' });
  });
  it('cancels a challenge and returns to password sign-in', async () => {
    const user = userEvent.setup();
    render(<Login port={{ login: async () => ({ mfaRequired: true, pendingToken: 'proof' }) }} translate={translate} productName="Example" onLogin={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.getByLabelText('Password', { selector: 'input' })).toHaveValue('');
    expect(screen.queryByLabelText('Authenticator code')).not.toBeInTheDocument();
  });
  it('confirms enrollment before reporting enabled and erases the setup secret', async () => {
    const user = userEvent.setup();
    const port = { status: vi.fn().mockResolvedValue({ isOwner: true, available: true, enrolled: false }),
      enroll: vi.fn().mockResolvedValue({ pendingToken: 'enroll', secret: 'SETUPSECRET', uri: 'otpauth://totp/Example' }),
      confirm: vi.fn().mockResolvedValue(undefined), remove: vi.fn() };
    render(<TotpSettings port={port} translate={translate} />);
    await user.type(await screen.findByLabelText('Current owner password'), 'password');
    await user.click(screen.getByRole('button', { name: 'Set up authenticator' }));
    expect(await screen.findByText('SETUPSECRET')).toBeInTheDocument();
    expect(screen.queryByText('Authenticator enabled. Sign in again with the next code from your app.')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Authenticator code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm authenticator' }));
    await waitFor(() => expect(port.confirm).toHaveBeenCalledWith({ pendingToken: 'enroll', code: '123456' }));
    expect(await screen.findByText('Authenticator enabled. Sign in again with the next code from your app.')).toBeInTheDocument();
    expect(screen.queryByText('SETUPSECRET')).not.toBeInTheDocument();
  });
});

it('does not offer owner enrollment to staff', async () => {
  const port = { status: vi.fn().mockResolvedValue({ isOwner: false, available: true, enrolled: false }),
    enroll: vi.fn(), confirm: vi.fn(), remove: vi.fn() };
  render(<TotpSettings port={port} translate={translate} />);
  await waitFor(() => expect(port.status).toHaveBeenCalledOnce());
  expect(screen.queryByRole('button', { name: 'Set up authenticator' })).not.toBeInTheDocument();
  expect(port.enroll).not.toHaveBeenCalled();
});

it('requires the current password and factor when removing an enrolled authenticator', async () => {
  const user = userEvent.setup();
  const port = { status: vi.fn().mockResolvedValue({ isOwner: true, available: true, enrolled: true }),
    enroll: vi.fn(), confirm: vi.fn(), remove: vi.fn().mockResolvedValue(undefined) };
  render(<TotpSettings port={port} translate={translate} />);
  await user.type(await screen.findByLabelText('Current owner password'), 'owner-password');
  const remove = screen.getByRole('button', { name: 'Remove authenticator' });
  expect(remove).toBeDisabled();
  await user.type(screen.getByLabelText('Authenticator code'), '234567');
  await user.click(remove);
  expect(port.remove).toHaveBeenCalledWith({ password: 'owner-password', code: '234567' });
  expect(await screen.findByText('Authenticator removed. Sign in again.')).toBeInTheDocument();
  expect(screen.getByLabelText('Current owner password')).toHaveValue('');
});
