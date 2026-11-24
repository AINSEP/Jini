import { createRouting, type Routing } from "../../../routing/index.js";

/**
 * A real, isolated routing instance for the phase-handler suites — the same `createRouting` a
 * host binds once and shares across its composition roots. Phase errors are recorded, not logged.
 * @returns The bound routing API plus every phase error it reported.
 * @complexity O(1).
 */
export function createTestRouting(): { routing: Routing; phaseErrors: { message: string; error: unknown }[] } {
  const phaseErrors: { message: string; error: unknown }[] = [];
  const routing = createRouting({ ports: {
    isLive: () => true,
    reportPhaseError: (report) => { phaseErrors.push(report); },
  } });
  return { routing, phaseErrors };
}
