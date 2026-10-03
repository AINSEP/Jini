/** Opaque, single-use approval tokens. Clock, generation and TTL are host policy. */
export interface ConfirmationTokenRecord {
  // Keep the lifecycle independent of gateway authorization ordering. A token is a single-use,
  // time-boxed credential bound to the plan hash, scope and confirming principal, not just a nonce.
  confirmationToken: string;
  planHash: string;
  scopeId: string;
  confirmerPrincipalId: string;
  status: 'minted' | 'redeemed' | 'expired';
  createdAt: string;
  expiresAt: string;
}

export interface TokenStorePort {
  /** Insert only: never overwrite a previously issued token, including terminal states. */
  save(required: { record: ConfirmationTokenRecord }): Promise<void>;
  findByToken(required: { token: string }): Promise<ConfirmationTokenRecord | null>;
  /** Atomically check TTL/status and transition minted -> redeemed. */
  tryRedeem(required: { token: string; now: string }): Promise<{ redeemed: boolean; record: ConfirmationTokenRecord | null }>;
  // Adapters must not split redemption into a read and a write across awaits: concurrent calls
  // could both spend one approval. Persistent stores need a conditional atomic update/transaction.
  /** Atomically transition minted -> expired without overwriting concurrent redemption. */
  expire(required: { token: string }): Promise<void>;
}

export class TokenExpiredError extends Error {
  constructor(required: { message: string }, optional: ErrorOptions = {}) {
    super(required.message, optional);
  }
}
export class TokenAlreadyRedeemedError extends Error {
  constructor(required: { message: string }, optional: ErrorOptions = {}) {
    super(required.message, optional);
  }
}

/** O(1). The complete token string comes from the injected cryptographically secure generator. */
export function mintToken(required: {
  planId: string;
  planHash: string;
  scopeId: string;
  confirmerPrincipalId: string;
  now: string;
  ttlSeconds: number;
  generateToken: (required: Record<string, never>) => string;
}): ConfirmationTokenRecord {
  const timestamp = Date.parse(required.now);
  if (!Number.isFinite(timestamp) || !Number.isFinite(required.ttlSeconds) || required.ttlSeconds <= 0) {
    throw new RangeError('token timestamp must be valid and TTL must be positive and finite');
  }
  const expiresAt = new Date(timestamp + required.ttlSeconds * 1000).toISOString();
  // Exact host-selected TTL, without jitter: approval expiration is a user-visible boundary.
  const confirmationToken = required.generateToken({});
  if (typeof confirmationToken !== 'string' || confirmationToken.length === 0) {
    throw new Error('token generator must return a non-empty string');
  }
  return {
    confirmationToken, planHash: required.planHash, scopeId: required.scopeId,
    confirmerPrincipalId: required.confirmerPrincipalId, status: 'minted',
    createdAt: required.now, expiresAt,
  };
}

/** O(1). The exact expiry instant is inclusive, preserving the approval lifecycle contract. */
export function isRedeemable(required: { record: ConfirmationTokenRecord; now: string }): boolean {
  return required.record.status === 'minted' && Date.parse(required.now) <= Date.parse(required.record.expiresAt);
}

/** O(1) local work plus one atomic store operation. */
export async function redeemToken(required: { store: TokenStorePort; token: string; now: string }): Promise<ConfirmationTokenRecord> {
  // Gateways may use the port directly to interleave actor/authorization/hash checks in their own
  // required order; this wrapper owns the standalone lifecycle error contract. Missing and expired
  // approvals share an error type, while a spent approval reports its distinct terminal state.
  const { redeemed, record } = await required.store.tryRedeem({ token: required.token, now: required.now });
  if (redeemed && record) return record;
  if (!record) throw new TokenExpiredError({ message: 'confirmation token was not found' });
  if (record.status === 'redeemed') throw new TokenAlreadyRedeemedError({ message: 'confirmation token has already been redeemed' });
  throw new TokenExpiredError({ message: 'confirmation token has expired' });
}

/** Explicit revocation; now is retained for compatibility with lifecycle caller records. */
export async function expireToken(required: { store: TokenStorePort; token: string; now: string }): Promise<void> {
  // Revocation can only advance minted -> expired; it must never un-redeem a spent approval.
  await required.store.expire({ token: required.token });
}

/**
 * Instance-owned test adapter. Operations are O(1); space O(n) issued tokens.
 * No await splits conditional transitions. Records are returned as detached values.
 * Hosts must supply retention/cleanup for a long-lived store.
 */
export class InMemoryTokenStore implements TokenStorePort {
  constructor(_required: Record<string, never>) {}

  private readonly recordsByToken = new Map<string, ConfirmationTokenRecord>();

  async save(required: { record: ConfirmationTokenRecord }): Promise<void> {
    const record = required.record;
    if (this.recordsByToken.has(record.confirmationToken)) throw new Error('confirmation token already exists');
    this.recordsByToken.set(record.confirmationToken, { ...record });
  }

  async findByToken(required: { token: string }): Promise<ConfirmationTokenRecord | null> {
    const record = this.recordsByToken.get(required.token);
    return record ? { ...record } : null;
  }

  async tryRedeem(required: { token: string; now: string }): Promise<{ redeemed: boolean; record: ConfirmationTokenRecord | null }> {
    const record = this.recordsByToken.get(required.token);
    if (!record) return { redeemed: false, record: null };
    if (!isRedeemable({ record, now: required.now })) return { redeemed: false, record: { ...record } };
    const updated: ConfirmationTokenRecord = { ...record, status: 'redeemed' };
    this.recordsByToken.set(required.token, updated);
    return { redeemed: true, record: { ...updated } };
  }

  async expire(required: { token: string }): Promise<void> {
    const record = this.recordsByToken.get(required.token);
    if (record?.status === 'minted') this.recordsByToken.set(required.token, { ...record, status: 'expired' });
  }

  async count(_required: Record<string, never>): Promise<number> { return this.recordsByToken.size; }
}
