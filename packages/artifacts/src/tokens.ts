/**
 * ArtifactStore's typed DI token belongs to this feature package. extraction-plan.md §2.1 excludes
 * artifacts/projects/brands/design systems/marketplaces/conversations from kernel nouns; §12 C7
 * keeps adjacent capabilities as registry-bound providers rather than kernel services.
 */
import { token } from '@jini-ai/core';
import type { ArtifactStore } from './store.js';

export const ArtifactStoreToken = token<ArtifactStore>({ id: 'jini.artifactStore' });
