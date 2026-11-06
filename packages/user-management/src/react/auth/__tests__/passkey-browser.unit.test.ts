import { beforeEach, expect, test, vi } from 'vitest';
import { runPasskeyCeremony } from '../passkey-browser.js';
const browser = vi.hoisted(() => ({ browserSupportsWebAuthn: vi.fn(), startRegistration: vi.fn(), startAuthentication: vi.fn() }));
vi.mock('@simplewebauthn/browser', () => browser);
beforeEach(() => { vi.resetAllMocks(); browser.browserSupportsWebAuthn.mockReturnValue(true); });
const options = { challenge: 'challenge' };

test('unsupported browser explains TOTP/recovery fallback without starting a ceremony', async () => {
  browser.browserSupportsWebAuthn.mockReturnValue(false);
  await expect(runPasskeyCeremony({ kind: 'register', options })).rejects.toThrow('Use your authenticator app or recovery code');
  expect(browser.startRegistration).not.toHaveBeenCalled();
});

test('registration and authentication use library JSON ceremonies', async () => {
  browser.startRegistration.mockResolvedValue({ id: 'registered' }); browser.startAuthentication.mockResolvedValue({ id: 'asserted' });
  expect(await runPasskeyCeremony({ kind: 'register', options })).toEqual({ id: 'registered' });
  expect(await runPasskeyCeremony({ kind: 'authenticate', options })).toEqual({ id: 'asserted' });
  expect(browser.startRegistration).toHaveBeenCalledWith({ optionsJSON: options });
  expect(browser.startAuthentication).toHaveBeenCalledWith({ optionsJSON: options });
});

test('browser cancellation is actionable; unexpected exceptions never disclose assertion details', async () => {
  browser.startAuthentication.mockRejectedValueOnce(new DOMException('raw assertion', 'NotAllowedError'))
    .mockRejectedValueOnce(Error('raw assertion details'));
  await expect(runPasskeyCeremony({ kind: 'authenticate', options })).rejects.toThrow('cancelled or timed out');
  await expect(runPasskeyCeremony({ kind: 'authenticate', options })).rejects.toThrow('This browser could not complete the passkey prompt');
});
