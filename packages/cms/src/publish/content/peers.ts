/**
 * @file Neutral error vocabulary for the `publish-peer` destination store: a named remote site a
 * workspace can push content to or pull it from. Only the error names live here; vault bindings,
 * operator-facing copy and persistence stay with the host, which supplies each `message`.
 */

/** Thrown when a named peer does not exist in this workspace. */
export class PublishContentPeerNotFoundError extends Error {
  constructor({ message }: { message: string }) {
    super(message);
    this.name = "PublishContentPeerNotFoundError";
  }
}

/** Thrown when operator-supplied peer input is unusable. `message` is operator-facing and never
 *  echoes a supplied credential. */
export class PublishContentPeerValidationError extends Error {
  constructor({ message }: { message: string }) {
    super(message);
    this.name = "PublishContentPeerValidationError";
  }
}

/** Thrown when a write would violate the `(workspace, label)` uniqueness of a peer. */
export class PublishContentPeerDuplicateLabelError extends Error {
  constructor({ message }: { message: string }) {
    super(message);
    this.name = "PublishContentPeerDuplicateLabelError";
  }
}

/** Thrown when sealing or key lookup fails — fail-closed, never a plaintext write. */
export class PublishContentPeerSecretStoreUnconfiguredError extends Error {
  constructor({ message }: { message: string }) {
    super(message);
    this.name = "PublishContentPeerSecretStoreUnconfiguredError";
  }
}

/** Thrown when a peer row exists but carries no sealed credential — a push/pull cannot proceed. */
export class PublishContentPeerCredentialMissingError extends Error {
  constructor({ message }: { message: string }) {
    super(message);
    this.name = "PublishContentPeerCredentialMissingError";
  }
}
