import { describe, expect, it } from 'vitest';
import type { ToolRegistry } from '@jini-ai/core';
import type { DelegatedToolsHttpDeps } from '../delegated-tools.js';

// The route only ever reads descriptors (`list`) from `toolRegistry` — the read-only gate and
// `withReadOnlyToolConstraint` both take `Pick<ToolRegistry, 'list'>`. Hosts (Tovu's agent daemon)
// pass a descriptor-only facade, so demanding the full mutable `ToolRegistry` here was a TS2322
// for them. This file is checked by the package's no-emit typecheck: it fails to compile if the
// slot is widened back to the full registry.
describe('DelegatedToolsHttpDeps.toolRegistry contract', () => {
  it('accepts a list-only registry view', () => {
    const listOnly: Pick<ToolRegistry, 'list'> = { list: () => [] };
    const slot: DelegatedToolsHttpDeps['toolRegistry'] = listOnly;
    expect(slot?.list({})).toEqual([]);
  });
});
