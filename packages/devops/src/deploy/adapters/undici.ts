import type { LookupFunction } from 'node:net';
import { Agent, type Dispatcher } from 'undici';

export type ReachabilityDispatcher = Dispatcher;

/** Connect with the host's validating lookup; the caller owns this dispatcher. */
export function createUndiciReachabilityDispatcher({ lookup }: { lookup: LookupFunction }, _options: Record<string, never> = {}) {
  return new Agent({ connect: { lookup } });
}
