/**
 * @module capabilities
 *
 * Per-agent `--help`-probed capability flags, cached by agent id. Ported
 * verbatim from OD's `apps/daemon/src/runtimes/capabilities.ts`.
 */
import type { RuntimeCapabilityMap } from './types.js';

export const agentCapabilities = new Map<string, RuntimeCapabilityMap>();
