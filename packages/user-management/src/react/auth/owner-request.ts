/** The host's single-send request function the owner clients are bound to. Single-send matters:
 * an MFA/passkey proof or a recovery rotation must never be replayed after a lost response. */
export type OwnerRequestOnce = <T>(required: { path: string; init?: RequestInit }) => Promise<T>;
