/**
 * Typed DI tokens for `@jini-ai/media`'s ports, following the exact pattern
 * `@jini-ai/core`'s `token()` establishes (see `packages/core/src/token.ts`)
 * and the naming convention `@jini-ai/daemon`'s `src/tokens.ts` already set
 * (bare-interface-name-suffixed-`Token`, not extraction-plan §2.2's
 * illustrative bare-name pseudocode, which would shadow the interface names
 * in this codebase's actual precedent).
 */
import { token } from '@jini-ai/core';
import type { CapabilityRegistry } from './capability-registry.js';
import type { MediaPolicy } from './policy.js';
import type { MediaTaskStore } from './task-store.js';

export const CapabilityRegistryToken = token<CapabilityRegistry>('jini.media.capabilityRegistry');
export const MediaTaskStoreToken = token<MediaTaskStore>('jini.media.taskStore');
export const MediaPolicyToken = token<MediaPolicy>('jini.media.policy');
