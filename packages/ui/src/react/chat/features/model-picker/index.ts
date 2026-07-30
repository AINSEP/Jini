/**
 * @module features/model-picker
 *
 * Public barrel — the only entry point other code (inside or outside this
 * package) should import from; internal files are reached only through
 * this file. See `source-map.md` for provenance and `types.ts`'s header for
 * the `@jini-ai/protocol`-only dependency boundary.
 */
export * from './types.js';
export * from './constants.js';
export * from './rules.js';
export * from './ports.js';
export { defaultModelPickerPort } from './dependencies.js';

export { useModelPicker } from './react/hooks/useModelPicker.hooks.js';
export type { UseModelPickerOptions, ModelPickerController } from './react/hooks/useModelPicker.hooks.js';
export { ModelPicker } from './react/components/ModelPicker.js';
export type { ModelPickerProps } from './react/components/ModelPicker.js';
export { CredentialStatusBadge } from './react/components/CredentialStatusBadge.js';
export type { CredentialStatusBadgeProps } from './react/components/CredentialStatusBadge.js';
