import { AsyncLocalStorage } from "node:async_hooks";
import type { Tracker } from "./tracker-types.js";

export type TelemetryTestSignal = "error" | "span" | "analytics";
export interface TelemetryTestResult {
  /** Local provider acceptance, not confirmation of remote delivery. Consent can refuse analytics. */
  providers: { providerId: string; signals: TelemetryTestSignal[] }[];
}
export interface TelemetryTestProbe {
  accepted(required: { providerId: string; method: string; input: unknown }, optional?: Record<string, never>): void;
  send(required: { tracker: Tracker; error: Error; userId: string }, optional?: Record<string, never>): Promise<TelemetryTestResult>;
}

/** Recognize only the fixed diagnostic signals; incidental work in the same scope is ignored. */
function testSignal({ method, input }: { method: string; input: { name?: string; context?: { operation?: string } } }): TelemetryTestSignal | undefined {
  if (method === "reportError" && input.context?.operation === "telemetry.test") return "error";
  if (method === "trackOperation" && input.name === "telemetry.test") return "span";
  if (method === "capture" && input.name === "telemetry_test") return "analytics";
  return undefined;
}

/** Tests the same facade applications use; an async scope isolates simultaneous admin actions.
 * @returns A diagnostic sender and a hook for the host's existing provider dispatch boundary.
 * @complexity O(p) receipts per test for p providers; no retained receipts after its scope ends.
 */
export function createTelemetryTestProbe(_required: Record<string, never>, _options = {}): TelemetryTestProbe {
  const active = new AsyncLocalStorage<Map<string, Set<TelemetryTestSignal>>>();
  return {
    accepted({ providerId, method, input }: { providerId: string; method: string; input: unknown }, _optional = {}): void {
      const receipts = active.getStore();
      if (!receipts || !input || typeof input !== "object") return;
      const signal = testSignal({ method, input: input as { name?: string; context?: { operation?: string } } });
      if (!signal) return;
      const signals = receipts.get(providerId) ?? new Set<TelemetryTestSignal>();
      signals.add(signal);
      receipts.set(providerId, signals);
    },
    async send({ tracker, error, userId }: { tracker: Tracker; error: Error; userId: string }, _optional = {}): Promise<TelemetryTestResult> {
      return active.run(new Map(), async () => {
        await tracker.span("telemetry.test", async () => {
          tracker.error(error, { operation: "telemetry.test" });
          tracker.capture({ name: "telemetry_test", userId });
        });
        return { providers: [...active.getStore()!].map(([providerId, signals]) => ({ providerId, signals: [...signals] })) };
      });
    },
  };
}
