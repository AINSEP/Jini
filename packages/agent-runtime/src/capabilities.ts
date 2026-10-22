/**
 * @module capabilities
 *
 * Per-agent `--help`-probed capability flags, cached by agent id. Ported
 * verbatim from OD's `apps/daemon/src/runtimes/capabilities.ts`.
 */
import { defaultRuntimeState } from './runtime-state.js';

export const agentCapabilities = defaultRuntimeState.capabilities;
