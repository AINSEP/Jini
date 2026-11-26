import type { PublishTrustWire } from "./handshake-client.js";

/** What went wrong, as a class an admin surface can act on differently. */
export type PublishTrustHandshakeFailure =
  /** The host did not answer at all, or egress refused the address. */
  | "unreachable"
  /** Something answered, but not a peer site's handshake routes. */
  | PublishTrustWire["notPeerFailure"]
  /** The site answered correctly and does not accept publishes from this computer (yet). */
  | "not-connected"
  /** The site answered, but not in a way this source can use. */
  | "refused";

/** A handshake failure. `message` is written for the owner and contains no key material, no
 *  identifier and no error code — see this file's header. */
export class PublishTrustHandshakeError extends Error {
  readonly failure: PublishTrustHandshakeFailure;

  constructor({ message, failure }: { message: string; failure: PublishTrustHandshakeFailure }) {
    super(message);
    this.name = "PublishTrustHandshakeError";
    this.failure = failure;
  }
}

