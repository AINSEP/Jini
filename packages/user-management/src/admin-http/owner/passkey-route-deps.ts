import { IdentityValidationError, OwnerRequiredError } from '../../core/types.js';
import type { OwnerPasskeyDeps } from '../../server/mfa/passkey-ports.js';

/** Trusted composition origin includes the public port; localhost uses the actual listener port.
 * Request Host, Origin and forwarding headers never select the RP or expected origin. O(1).
 */
export function ownerPasskeySite({ deps, localPort, name, copy }: {
  deps: { passkeyOrigin?: string; derivedPublicOrigin?: string }; localPort?: number; name: string;
  copy: { unavailable: string; insecure: string };
}, _options: Record<string, never> = {}) {
  const configured = deps.passkeyOrigin ?? deps.derivedPublicOrigin;
  if (!configured) throw new IdentityValidationError({ message: copy.unavailable });
  const url = new URL(configured);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) {
    throw new IdentityValidationError({ message: copy.insecure });
  }
  if (!deps.passkeyOrigin && url.hostname === 'localhost' && localPort) url.port = String(localPort);
  return { origin: url.origin, rpId: url.hostname, name };
}

/** Compose Jini from the serving site's trusted scope and credential adapter; O(1), no poll. */
export async function resolveOwnerPasskeyRouteDeps(required: {
  store: () => OwnerPasskeyDeps["credentials"] | undefined;
  mfa: () => Promise<OwnerPasskeyDeps["mfa"]>;
  webauthn: () => OwnerPasskeyDeps["webauthn"];
  site: Parameters<typeof ownerPasskeySite>[0];
  unavailableMessage: string;
}, _optional = {}): Promise<OwnerPasskeyDeps> {
  const credentials = required.store();
  if (!credentials) throw new IdentityValidationError({ message: required.unavailableMessage });
  return { mfa: await required.mfa(), credentials, webauthn: required.webauthn(), site: ownerPasskeySite(required.site) };
}

/** Admission failures reveal no credentials; protocol proofs are never logged. O(1). */
export function answerOwnerPasskeyFailure({ error, json, incident, operation, incidentOptions }: {
  error: unknown; json: (body: unknown, status: number) => void;
  incident: (error: unknown, options: { operation: string; code: string; message: string; failure: { step: string; action: string } }) => void;
  operation: string;
  incidentOptions: { operation: string; code: string; message: string; failure: { step: string; action: string } };
}, _optional = {}): void {
  const expected = error instanceof IdentityValidationError || error instanceof OwnerRequiredError;
  if (!expected) {
    incident(error, incidentOptions);
    return;
  }
  json({ error: error.message, code: "PASSKEY_REFUSED", details: { operation } }, error instanceof OwnerRequiredError ? 403 : 400);
}

