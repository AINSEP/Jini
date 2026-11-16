/**
 * @file A page-control port over a `PageDriver`: the capability ids the driver serves and one `execute`
 * that runs a page capability against it. The shape is structural so a chat package can accept it
 * (its `ChatPagePort`) without agentic importing chat.
 */
import { PAGE_CAPABILITIES } from '../page-capabilities.js';
import { executePageCapability } from '../page-executor.js';
import type { PageDriver } from '../page-driver.js';

export interface DriverPagePort {
  readonly capabilityIds: readonly string[];
  execute(
    required: { capabilityId: string; input: Record<string, unknown> },
    optional?: { signal?: AbortSignal },
  ): Promise<unknown>;
}

/**
 * Binds a page driver as a port: the ids come from the shared page capability list and execution goes
 * through the shared executor, so every host serves the same verbs.
 * @complexity O(1) to build; `execute` is one executor call.
 */
export function createDriverPagePort(required: { driver: PageDriver }, _optional: Record<string, never> = {}): DriverPagePort {
  return {
    capabilityIds: PAGE_CAPABILITIES.map((capability) => capability.id),
    execute: (args, optional) => executePageCapability({ driver: required.driver, ...args }, optional),
  };
}
