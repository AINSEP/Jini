/**
 * @module features/model-picker
 *
 * Public barrel — the only entry point other code (inside or outside this
 * package) should import from; internal files are reached only through
 * this file. See `source-map.md` for provenance and `types.ts`'s header for
 * the `@jini-ai/protocol`-only dependency boundary.
 *
 * Where this belongs (2026-08-03 `@jini-ai/chat` consolidation): `foundry/docs/jini-port/recon/
 * r4b-webui-design.md` §1 line 41 explicitly lists "model/agent picker" among the widgets that
 * belong behind a host-injected slot, not inside chat-react proper — picking which LLM/agent to
 * run is a provider concern, not a chat-domain one. This module doesn't import anything from
 * chat's own domain (only this package's local `Icon`/`hooks/context` utilities), so the design
 * doc's instinct holds up on inspection. It moves here unchanged anyway: it has exactly one real
 * consumer today (this package's own barrel, plus two tests), and this workspace's precedent
 * (see `packages/desktop-host/source-map.md`) is to defer generalizing/slotting until a second
 * consumer actually exists, rather than build a slot interface nobody has asked for yet. If a
 * second consumer shows up, extracting this into a real host-injected slot is the intended end
 * state — not a rewrite, a move.
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
