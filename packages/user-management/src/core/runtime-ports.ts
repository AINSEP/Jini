/** Host-supplied session bearer generation and storage digest strategy. */
export interface SessionTokenPort {
  newToken(required: Record<string, never>): string;
  hashToken(required: { rawToken: string }): string;
}

/** Host lifecycle for renames. Audit writes must join the identity transaction. */
export interface UsernameChangePort {
  /** A host can refuse a rename that its bootstrap identity cannot safely survive. */
  assertSupported?: ((required: { workspaceId: string; principalId: string }, optional?: Record<string, never>) => Promise<void>) | undefined;
  isInTrash(required: { workspaceId: string; principalId: string }, optional?: Record<string, never>): Promise<boolean>;
  record(required: {
    workspaceId: string; principalId: string; callerPrincipalId: string;
    previousUsername: string; username: string; occurredAt: string;
  }, optional?: Record<string, never>): Promise<void>;
}
