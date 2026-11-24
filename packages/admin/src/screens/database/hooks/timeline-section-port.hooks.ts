import type { AdminLedgerRow } from "../../../core/index.js";

/**
 * @file What `use-timeline-section.hooks.ts` needs from the outside world, as an interface rather
 * than a direct import of the host's HTTP client. Follows the
 * `useX(dependencies)` / `useWiredX()` pair the host keeps beside its port implementations.
 */
export interface TimelineSectionPort {
  getDatabaseTimeline(required: {}, optional?: {
    options?: {
      kind?: string | undefined;
      outcome?: string | undefined;
      fromDate?: string | undefined;
      toDate?: string | undefined;
      cursor?: string | undefined;
      limit?: number | undefined;
    };
  }): Promise<{ items: AdminLedgerRow[]; nextCursor: string | null }>;
}
