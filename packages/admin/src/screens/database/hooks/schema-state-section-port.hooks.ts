import type { AdminSchemaState } from "../../../core/index.js";

/**
 * @file What `use-schema-state-section.hooks.ts` needs from the outside world, as an interface
 * rather than a direct import of the host's HTTP client. Follows the `useX(dependencies)` /
 * `useWiredX()` pair the host keeps beside its port implementations, same as this feature's three older sections.
 *
 * READ-ONLY BY CONSTRUCTION: one method, no counterpart that repairs or reconciles anything. The
 * server exposes no such route either (see the host server's schema-state route), so
 * there is nothing here to widen this port to. Bringing a drifted database back in line is the
 * migrate-forward ceremony's job, and it has its own gated plan/confirm/execute port already.
 */
export interface SchemaStateSectionPort {
  /** Rejects on failure — never resolves a reassuring sentinel. The fetch-query layer's own contract
   *  requires this, and here it is load-bearing twice over: a resolved-on-error value would render
   *  as a clean database. */
  getDatabaseSchemaState(): Promise<AdminSchemaState>;
}
