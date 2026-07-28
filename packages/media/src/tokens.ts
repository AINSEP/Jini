/**
 * Typed DI tokens for `@injini/media`'s ports, following the exact pattern
 * `@injini/core`'s `token()` establishes (see `packages/core/src/token.ts`)
 * and the naming convention `@injini/daemon`'s `src/tokens.ts` already set
 * (bare-interface-name-suffixed-`Token`, not extraction-plan §2.2's
 * illustrative bare-name pseudocode, which would shadow the interface names
 * in this codebase's actual precedent).
 */
import { token } from '@injini/core';
import type { CapabilityRegistry } from './capability-registry.js';
import type { MediaPolicy } from './policy.js';
import type { MediaTaskStore } from './task-store.js';

export const CapabilityRegistryToken = token<CapabilityRegistry>('jini.media.capabilityRegistry');
export const MediaTaskStoreToken = token<MediaTaskStore>('jini.media.taskStore');
export const MediaPolicyToken = token<MediaPolicy>('jini.media.policy');
