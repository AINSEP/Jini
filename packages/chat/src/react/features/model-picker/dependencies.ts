import type { ModelPickerPort } from './ports.js';

/**
 * Default port: no live provider-model fetch — the picker works from
 * whatever `models`/`providers` a host passes in directly. A host that wants
 * a live catalogue supplies its own `ModelPickerPort` (a real fetch
 * implementation) to `useModelPicker`/`<ModelPicker>` instead; this package
 * ships only the no-op default, never a concrete transport call, matching
 * the `features/connectors/` canary's `dependencies.ts` precedent.
 */
export const defaultModelPickerPort: ModelPickerPort = {};
