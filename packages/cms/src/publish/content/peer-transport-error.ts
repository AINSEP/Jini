import type { PeerTextRedactor } from "./peer-transport.js";

/** Machine-readable failure classes a peer call can produce. Distinct codes, because a route maps
 *  each to a different HTTP status and an operator acts on each differently. */
export type PeerTransportErrorCode =
  | "EGRESS_REFUSED"
  | "PEER_UNREACHABLE"
  | "PEER_REJECTED"
  | "PEER_RESPONSE_INVALID"
  /** The operator ticked "Overwrite on live" but the peer doesn't advertise `"overwrite-live"`. */
  | "PEER_CANNOT_OVERWRITE";

/** The single error type every failure in this module surfaces as. `message` is operator-facing:
 *  fixed local diagnostics omit upstream error text; the shared redactor also scrubs secret-shaped
 *  values from route/host context. */
export class PublishContentPeerTransportError extends Error {
  readonly code: PeerTransportErrorCode;
  /** The peer's HTTP status, when there was one. Absent for a refusal or an unreachable host. */
  readonly peerStatus?: number;

  constructor(
    { message, code, redact }: { message: string; code: PeerTransportErrorCode; redact: PeerTextRedactor },
    options: { peerStatus?: number } = {}
  ) {
    super(redact({ text: message }).text);
    this.name = "PublishContentPeerTransportError";
    this.code = code;
    if (options.peerStatus !== undefined) this.peerStatus = options.peerStatus;
  }
}

