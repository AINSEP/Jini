import type { KeyringPort } from "@jini-ai/core/contracts/vault";
import type { Clock } from "@jini-ai/core/primitives";

import {
  DEFAULT_PUBLISHING_CAPABILITIES,
  isBackstopEntityType,
  PUBLISH_TRUST_GRANT_VERSION,
  type PublishTrustGrant,
} from "./grant.js";
import { fetchDestinationIdentity, PUBLISH_TRUST_GENERATION, type DestinationIdentity, type HandshakeClientDeps } from "./handshake-client.js";
import { deriveInstallationId, derivePublishSigningKey } from "./keys.js";
import {
  grantNotAfterFrom,
  type ProvisioningTarget,
  type PublishTrustProvisioningPort,
} from "./provisioning.js";

/**
 * @file Zero-setup publishing auth — the one action a person takes: "this site is mine".
 *
 * `provisioning.ts` can write a grant and `handshake-client.ts` can ask a destination who it is;
 * neither knows how to turn "the owner clicked Connect" into a grant. This file is that step, and
 * it is deliberately the ONLY place that composes them, so there is exactly one definition of what
 * connecting means.
 *
 * ## The whole user-visible surface is one confirmation
 *
 * The host's candidate lookup reads the address out of the deploy config the repo already
 * carries, so the common case is a pre-filled "Publish to <site>?" rather than a field to fill in.
 * Everything else — the destination's workspace id, this install's identity, the key, the entity
 * allowlist, the expiry — is derived or asked for. The owner sees none of it and is asked for none
 * of it.
 *
 * ## What connecting does and does not do
 *
 * It writes a public key into committed deploy config, and stops. It cannot deploy (that would need
 * provider credentials on the owner's machine — the dependency this design exists to remove), so
 * the grant takes effect on the next deploy and {@link ConnectedDestination.nextStep} says so in
 * one sentence. Nothing secret is written, displayed, copied or stored: the private half is derived
 * from the site key on demand and never exists between publishes.
 */

export interface ConnectDeps extends HandshakeClientDeps {
  readonly keyring: KeyringPort;
  readonly provisioning: PublishTrustProvisioningPort;
  readonly clock: Clock;
  /** Formats the clock reading the grant's expiry is computed from. */
  readonly nowIso: (
    required: { clock: Clock },
    optional?: Record<string, never>,
  ) => string;
  /** THIS install's workspace — the site key the publishing key is derived from. */
  readonly workspaceId: string;
}

/** What a successful connect produced. No key material and no identifier a person has to keep. */
export interface ConnectedDestination {
  readonly identity: DestinationIdentity;
  /** The normalized address that was connected, and the key-derivation audience. */
  readonly baseUrl: string;
  /** `false` when the config already said exactly this — nothing to commit, nothing to deploy. */
  readonly changed: boolean;
  readonly target: ProvisioningTarget;
  /** The one sentence to show the owner next. */
  readonly nextStep: string;
}

/** Thrown when the grant could not be written. `message` is a sentence for the owner. */
export class PublishTrustConnectError extends Error {
  constructor({ message }: { message: string }) {
    super(message);
    this.name = "PublishTrustConnectError";
  }
}

/**
 * Connects this install to a destination: learn who it is, derive this install's public key for it,
 * and write the grant into the deploy config.
 *
 * Idempotent by construction — `provisioning.connect` merges by source installation id, so running
 * it twice replaces this computer's own entry and leaves every other computer's alone. That is what
 * makes "click it again if you are not sure" a safe instruction to give a non-developer.
 *
 * @param input.entityTypes - What this source may publish, from its own registered publish-content
 * types. An empty list is a grant that can do nothing (`grant.ts`), so a caller that cannot
 * enumerate its types must not call this.
 * @throws {PublishTrustHandshakeError} when the destination cannot be reached or is not a peer site.
 * @throws {PublishTrustConnectError} when the deploy config could not be written.
 * @complexity O(1) plus one round trip, two HKDFs, one file read and one file write.
 */
export async function connectDestination(
  { deps, input }: {
    deps: ConnectDeps;
    input: { baseUrl: string; entityTypes: readonly string[] };
  },
  _optional = {}
): Promise<ConnectedDestination> {
  const identity = await fetchDestinationIdentity({ deps, input });

  const sourceInstallationId = await deriveInstallationId({ keyring: deps.keyring, workspaceId: deps.workspaceId });
  const signingKey = await derivePublishSigningKey({
    keyring: deps.keyring,
    workspaceId: deps.workspaceId,
    sourceInstallationId,
    // VERBATIM the same string `openPublishSession` signs with later. A grant written against a
    // different spelling of the same site produces a public key that verifies nothing.
    targetOrigin: input.baseUrl,
    generation: PUBLISH_TRUST_GENERATION,
  });

  const grant: PublishTrustGrant = {
    version: PUBLISH_TRUST_GRANT_VERSION,
    sourceInstallationId,
    publicKeys: [{ publicKeyB64u: signingKey.publicKeyB64u, generation: signingKey.generation }],
    // The DESTINATION's workspace, as the destination itself just stated it. This is the value the
    // old flow made a human find and retype, and the reason `/identity` exists.
    workspaceId: identity.workspaceId,
    // Connecting is the ordinary publish path. Backstop trust is reviewed in deploy config.
    entityTypes: input.entityTypes.filter((entityType) => !isBackstopEntityType({ entityType })),
    capabilities: DEFAULT_PUBLISHING_CAPABILITIES,
    notAfter: grantNotAfterFrom({ nowIso: deps.nowIso({ clock: deps.clock }) }),
  };

  const written = await deps.provisioning.connect({ grant });
  if (!written.ok) throw new PublishTrustConnectError({ message: `This site's publishing settings could not be saved: ${written.reason}` });

  return {
    identity,
    baseUrl: input.baseUrl,
    changed: written.changed,
    target: written.target,
    nextStep: written.changed
      ? written.target.nextStep
      : "This computer was already connected to that site. Nothing to change.",
  };
}

/**
 * Removes this install's grant from the deploy config.
 *
 * The weaker of the two disconnects on purpose: it takes effect on the next deploy. The immediate
 * one is the destination-side deny list (`revocations.ts`), which needs no deploy and wins over any
 * grant. Both exist because they answer different questions — "stop shipping my key in the repo"
 * and "cut this computer off right now".
 *
 * @complexity O(1) plus one HKDF, one file read and one file write.
 */
export async function disconnectDestination(
  { deps }: { deps: Pick<ConnectDeps, "keyring" | "provisioning" | "workspaceId"> }, _optional = {}
): Promise<{ changed: boolean; target: ProvisioningTarget }> {
  const sourceInstallationId = await deriveInstallationId({ keyring: deps.keyring, workspaceId: deps.workspaceId });
  const written = await deps.provisioning.disconnect({ sourceInstallationId });
  if (!written.ok) throw new PublishTrustConnectError({ message: `This site's publishing settings could not be saved: ${written.reason}` });
  return { changed: written.changed, target: written.target };
}
