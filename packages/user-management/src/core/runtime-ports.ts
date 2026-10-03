/** Host-supplied session bearer generation and storage digest strategy. */
export interface SessionTokenPort {
  newToken(required: Record<string, never>): string;
  hashToken(required: { rawToken: string }): string;
}
