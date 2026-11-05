/** Fresh host-gated authority and the revision of its addressed raw permissions layer. */
export interface RunToolConsentSnapshot {
  readonly permissions: { readonly enabled: boolean; readonly capabilities: Readonly<Record<string, boolean>> };
  readonly revisionSeq: number;
  readonly allowed: boolean;
  readonly reason?: string;
}

export type RunToolConsentResult = { status: 'allowed' | 'cancelled' } |
  { status: 'blocked'; reason?: string } | { status: 'alternative'; agentId: string };

/** Ports bind the live run, principal and site in host closures, never in browser input. */
export interface RunToolConsentPorts {
  readonly agentId: string;
  readonly keys: readonly string[];
  /** Caller has already qualified alternatives as installed, signed-in or unknown, and RUN. */
  readonly alternatives?: readonly string[];
  readonly readFresh: () => Promise<RunToolConsentSnapshot>;
  readonly isLive: () => boolean | Promise<boolean>;
  readonly ask: (required: { snapshot: RunToolConsentSnapshot; stale: boolean }) => Promise<{ confirmed: boolean; choice?: string }>;
  /** false means the existing settings writer rejected a stale revision; other failures throw. */
  readonly allowSelected: (required: { agentId: string; keys: readonly string[]; expectedRevisionSeq: number }) => Promise<boolean>;
}

function detachSnapshot(value: RunToolConsentSnapshot): RunToolConsentSnapshot {
  return { ...value, permissions: { enabled: value.permissions.enabled, capabilities: { ...value.permissions.capabilities } } };
}

function sameConsentSnapshot(left: RunToolConsentSnapshot, right: RunToolConsentSnapshot): boolean {
  if (left.revisionSeq !== right.revisionSeq || left.permissions.enabled !== right.permissions.enabled) return false;
  const keys = new Set([...Object.keys(left.permissions.capabilities), ...Object.keys(right.permissions.capabilities)]);
  return [...keys].every(key => left.permissions.capabilities[key] === right.permissions.capabilities[key]);
}

function blocked(snapshot: RunToolConsentSnapshot): RunToolConsentResult {
  return { status: 'blocked', ...(snapshot.reason === undefined ? {} : { reason: snapshot.reason }) };
}

/** Ask through the existing human exchange, then recheck authority, run life and settings CAS.
 * A stale click opens a fresh card; it never authorizes a changed grant. No credentials or spawn
 * are created here. Errors from authority reads and writes propagate without being called success.
 * @complexity O(k) per human decision for fixed permission keys; two snapshot reads and one CAS
 * write per accepted card, with no polling or new persistence.
 */
export async function requestRunToolConsent(required: RunToolConsentPorts, _optional = {}): Promise<RunToolConsentResult> {
  const keys = [...required.keys];
  let stale = false;
  while (await required.isLive()) {
    const preview = detachSnapshot(await required.readFresh());
    if (!preview.allowed) return blocked(preview);
    const result = await consentAttempt({ ports: required, preview, stale, keys });
    if (result.status !== 'stale') return result;
    stale = true;
  }
  return { status: 'cancelled' };
}

/** Revalidation stays beside the write, so neither a stale click nor a terminal run can grant. */
async function consentAttempt({ ports, preview, stale, keys }: {
  ports: RunToolConsentPorts; preview: RunToolConsentSnapshot; stale: boolean; keys: readonly string[];
}): Promise<RunToolConsentResult | { status: 'stale' }> {
  if (!(await ports.isLive())) return { status: 'cancelled' };
  const answer = await ports.ask({ snapshot: preview, stale });
  if (!answer.confirmed || !(await ports.isLive())) return { status: 'cancelled' };
  if (answer.choice !== undefined) return alternativeResult({ choice: answer.choice, alternatives: ports.alternatives ?? [] });
  const current = await ports.readFresh();
  if (!current.allowed) return blocked(current);
  if (!sameConsentSnapshot(preview, current)) return { status: 'stale' };
  if (!(await ports.isLive())) return { status: 'cancelled' };
  const saved = await ports.allowSelected({ agentId: ports.agentId, keys, expectedRevisionSeq: current.revisionSeq });
  return saved ? { status: 'allowed' } : { status: 'stale' };
}

function alternativeResult({ choice, alternatives = [] }: { choice: string; alternatives?: readonly string[] }): RunToolConsentResult {
  return alternatives.includes(choice) ? { status: 'alternative', agentId: choice } : { status: 'cancelled' };
}
