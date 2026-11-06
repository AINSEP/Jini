import type { PasskeyOptions } from '../../core/types.js';

/** Load the browser protocol adapter only after an explicit passkey action.
 * @complexity O(b), bounded WebAuthn JSON; one browser ceremony, no network or polling.
 */
export async function runPasskeyCeremony({ kind, options }: { kind: 'register' | 'authenticate'; options: PasskeyOptions }, _options: Record<string, never> = {}): Promise<unknown> {
  const browser = await import('@simplewebauthn/browser');
  if (!browser.browserSupportsWebAuthn()) throw new Error('Passkeys are unavailable in this browser. Use your authenticator app or recovery code.');
  try {
    if (kind === 'register') return await browser.startRegistration({ optionsJSON: options as unknown as Parameters<typeof browser.startRegistration>[0]['optionsJSON'] });
    return await browser.startAuthentication({ optionsJSON: options as unknown as Parameters<typeof browser.startAuthentication>[0]['optionsJSON'] });
  } catch (error) {
    if ((error as { name?: unknown } | null)?.name === 'NotAllowedError') throw new Error('The passkey prompt was cancelled or timed out. Try again, or use your authenticator app.');
    throw new Error('This browser could not complete the passkey prompt. Try again, or use your authenticator app or recovery code.');
  }
}
