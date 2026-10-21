import { describe, expect, it } from 'vitest';
import { createExtEventRendererRegistry } from '../ext-event-renderer-registry.js';

/**
 * `slot()`'s keyed path: a registered `slotKey` splits one ext-event name into per-key slots, and a
 * key function that cannot answer falls back to the shared `name` slot instead of breaking the row.
 */
describe('createExtEventRendererRegistry().slot with a registered slot key', () => {
  const renderer = () => null;

  it('appends the key the slot-key function returns', () => {
    const registry = createExtEventRendererRegistry();
    registry.register({ name: 'mcp-ui', renderer }, { slotKey: ({ data }) => (data as { id: string }).id });
    expect(registry.slot({ name: 'mcp-ui', data: { id: 'card-2' } })).toBe('mcp-ui:card-2');
  });

  it('falls back to the shared name slot when the slot-key function throws', () => {
    const registry = createExtEventRendererRegistry();
    registry.register({ name: 'mcp-ui', renderer }, {
      slotKey: () => {
        throw new Error('malformed payload');
      },
    });
    expect(registry.slot({ name: 'mcp-ui', data: null })).toBe('mcp-ui');
  });

  it('falls back to the shared name slot when the key is empty or absent', () => {
    const registry = createExtEventRendererRegistry();
    registry.register({ name: 'mcp-ui', renderer }, { slotKey: ({ data }) => data as string | undefined });
    expect(registry.slot({ name: 'mcp-ui', data: '' })).toBe('mcp-ui');
    expect(registry.slot({ name: 'mcp-ui', data: undefined })).toBe('mcp-ui');
  });
});
