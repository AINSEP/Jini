/**
 * @file The SYNCHRONOUS pre-charge risk gate (gap check item 2). It runs before `createIntent`
 * dispatches, with a deadline, and answers allow / review / deny.
 *
 * v1 blocking is the provider's own fraud tooling (Stripe Radar etc.); our own geo/graph layer
 * (owner additions, L10+) feeds `review`, never an automatic ban. The default port is a no-op
 * that allows everything, so a host without a risk layer behaves exactly as before.
 *
 * `review` is not a decline: the kernel authorizes with manual capture and holds it for a human
 * (Gemini addition (a)).
 */
import type { Money } from "../../money/money.js";
import type { PaymentScope } from "./scope.js";

export type RiskVerdict = "allow" | "review" | "deny";

export interface RiskDecision {
  readonly verdict: RiskVerdict;
  /** Machine-readable reason codes, e.g. `["velocity.party"]`. Never personal data. */
  readonly reasons: readonly string[];
  /** True when the verdict came from the fail policy, not from the port. */
  readonly fallback: boolean;
}

export interface PreChargeRiskInput {
  readonly scope: PaymentScope;
  readonly amount: Money;
  readonly paymentId: string;
  readonly partyId?: string;
}

export interface PreChargeRiskPort {
  assess(
    required: PreChargeRiskInput,
    optional?: { signal?: AbortSignal }
  ): Promise<{ readonly verdict: RiskVerdict; readonly reasons: readonly string[] }>;
}

/** What to do when the port times out or throws. `open` = allow, `closed` = deny, `review` = hold. */
export type RiskFailPolicy = "open" | "closed" | "review";

const FAIL_VERDICT: Readonly<Record<RiskFailPolicy, RiskVerdict>> = { open: "allow", closed: "deny", review: "review" };
const KNOWN_VERDICTS: ReadonlySet<unknown> = new Set<RiskVerdict>(["allow", "review", "deny"]);

/** Allows everything. The default when the host wires no risk layer. */
export const noopRiskPort: PreChargeRiskPort = {
  assess: async () => ({ verdict: "allow", reasons: [] }),
};

export interface RiskGateDeps {
  readonly port: PreChargeRiskPort;
  /** Milliseconds the charge path waits before applying `failPolicy`. */
  readonly deadlineMs: number;
  readonly failPolicy: RiskFailPolicy;
  /** Injected timer so tests control the deadline. */
  readonly setTimer: (fn: () => void, ms: number) => { cancel(): void };
}

function fallback({ policy, reason }: { policy: RiskFailPolicy; reason: string }): RiskDecision {
  return { verdict: FAIL_VERDICT[policy], reasons: [reason], fallback: true };
}

/** A port answer the gate can trust, or the fail policy's verdict. A third-party port is not trusted to be well-typed. */
function fromAnswer({ answer, policy }: { answer: unknown; policy: RiskFailPolicy }): RiskDecision {
  const candidate = answer as { verdict?: unknown; reasons?: unknown } | null | undefined;
  if (!KNOWN_VERDICTS.has(candidate?.verdict) || !Array.isArray(candidate?.reasons)) {
    return fallback({ policy, reason: "risk.malformed" });
  }
  return { verdict: candidate.verdict as RiskVerdict, reasons: candidate.reasons as string[], fallback: false };
}

/**
 * Runs the risk port under its deadline. A timeout, a thrown error or a malformed verdict all
 * resolve through `failPolicy` — the charge path never hangs on, or crashes because of, the risk layer.
 */
export async function assessPreChargeRisk(
  { deps, input }: { deps: RiskGateDeps; input: PreChargeRiskInput },
  _optional: Record<string, never> = {}
): Promise<RiskDecision> {
  const controller = new AbortController();
  let resolveDeadline!: (decision: RiskDecision) => void;
  const deadline = new Promise<RiskDecision>((resolve) => {
    resolveDeadline = resolve;
  });
  const timer = deps.setTimer(() => {
    controller.abort();
    resolveDeadline(fallback({ policy: deps.failPolicy, reason: "risk.deadline" }));
  }, deps.deadlineMs);
  // `Promise.resolve().then` so a port that throws synchronously is caught like a rejection.
  const assessed = Promise.resolve()
    .then(() => deps.port.assess(input, { signal: controller.signal }))
    .then(
      (answer) => fromAnswer({ answer, policy: deps.failPolicy }),
      () => fallback({ policy: deps.failPolicy, reason: "risk.error" })
    );
  try {
    return await Promise.race([assessed, deadline]);
  } finally {
    timer.cancel();
  }
}

