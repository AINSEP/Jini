import type { PrincipalKind } from "./recovery-orchestrator.js";

/**
 * @file SPEC-019 C-306 / REQ-20 / REQ-21 / INV-04 — deep-link envelope resolution (ADR-045 §5,
 * ADR-041 §7).
 *
 * Purpose:
 * `resolveDeepLinkContext` never trusts a `DatabaseContextEnvelope`'s carried values — every id is
 * independently re-looked-up server-side on arrival (INV-04). A stale, pruned, or outright forged
 * `restorePointId` (even one that is syntactically plausible, e.g. ULID-shaped) resolves to
 * `{found:false}` rather than proceeding with the envelope's own claimed value — the envelope
 * carries display continuity only, never authority (ADR-041 §7's own rule, restated for this
 * domain's receiving side).
 *
 * How it relates to the project:
 * Isolated into its own file specifically so this mandatory re-verification rule is a single,
 * reviewable unit (ADR-PIPE-019 File Map) — every other Recovery surface that renders envelope
 * context must route through this function rather than reading `envelope.restorePointId` directly.
 */

export interface DatabaseContextEnvelope {
  v: number;
  correlationId: string;
  siteId: string;
  ledgerEventId: string | null;
  restorePointId: string | null;
  drift: string;
  intent: string;
  issuedAt: string;
}

export interface DeepLinkRestorePointLookupPort {
  findRestorePointById(id: string): Promise<{ restorePointId: string; capturedAt: string } | null>;
}

export interface ResolveDeepLinkContextRequired {
  deps: { lookup: DeepLinkRestorePointLookupPort };
  input: { principalId: string; principalKind: PrincipalKind; envelope: DatabaseContextEnvelope };
}

export interface RecoveryContextResponse {
  found: boolean;
  restorePoint: { restorePointId: string; capturedAt: string } | null;
}

/**
 * AC-30/AC-31/EC-03/INV-04 — re-resolves `envelope.restorePointId` via the injected lookup port;
 * never reads the envelope's carried value into the response directly, and never mutates the
 * input envelope object.
 *
 * @complexity O(1) — one lookup call.
 */
export async function resolveDeepLinkContext(
  required: ResolveDeepLinkContextRequired,
  _optional: Record<string, never> = {}
): Promise<RecoveryContextResponse> {
  const { deps, input } = required;

  if (!input.envelope.restorePointId) {
    return { found: false, restorePoint: null };
  }

  const restorePoint = await deps.lookup.findRestorePointById(input.envelope.restorePointId);
  return restorePoint ? { found: true, restorePoint } : { found: false, restorePoint: null };
}
