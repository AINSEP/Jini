import type { SurfaceExchangeStore } from "../../surface-exchanges.js";

/**
 * Cross-domain machinery a surface-raising tool needs that is not a domain dependency at all.
 *
 * Kept separate from `tool-registrations.ts`'s `AssistantToolRegistryDeps` on purpose: that bag is
 * "the same dependencies the admin HTTP routes are built from", which is what makes a tool call and
 * the equivalent human click reach identical domain code. An exchange store is not part of that
 * equivalence — it belongs to the assistant's transport, and only tools that talk to a human mid-call
 * ever touch it. Declared in this module rather than alongside the registration wiring so a tool can
 * name it without importing the file that imports the tool.
 */
export interface AssistantSurfaceDeps {
  /** The handlers and callback route must share this same in-process store. Opening in one store
   * and delivering to another leaves the human's answer unreachable until the deadline expires. */
  readonly surfaceExchanges: SurfaceExchangeStore;
}
