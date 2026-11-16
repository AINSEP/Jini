/** Test fixture: the page port a host would bind over a DOM driver (Tovu binds the same shape in its React roots). */
import { PAGE_CAPABILITIES, executePageCapability, type PageDriver } from '@jini-ai/agentic';
import type { ChatPagePort } from '../page-port.js';

export function pagePortFromDriver(required: { driver: PageDriver }, _optional: Record<string, never> = {}): ChatPagePort {
  return {
    capabilityIds: PAGE_CAPABILITIES.map((capability) => capability.id),
    execute: (args, optional) => executePageCapability({ driver: required.driver, ...args }, optional),
  };
}
