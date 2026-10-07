import { describe, expect, it } from 'vitest';
import { createModelReceiptTracker } from '../model-receipts.js';
describe('authoritative model receipts', () => {
  it('normalizes catalog aliases and display names before comparing observed models', () => {
    const models = [
      { id: 'opus', label: 'Claude Opus', identityKind: 'alias' as const, resolvedId: 'claude-opus-2026' },
      { id: 'claude-opus-2026', label: 'Claude Opus', identityKind: 'concrete' as const },
      { id: 'sonnet', label: 'Claude Sonnet', identityKind: 'alias' as const, resolvedId: 'claude-sonnet-2026' },
    ];
    const track = createModelReceiptTracker('claude-opus-2026', models);
    for (const model of ['opus', 'Claude Opus', 'claude-opus-2026']) {
      expect(track({ type: 'status', label: 'model', model })).toBeNull();
    }
    expect(track({ type: 'status', label: 'model', model: 'sonnet' })).toEqual({ type: 'status', label: 'model_switch', model: 'claude-sonnet-2026', previousModel: 'claude-opus-2026', detail: 'Previous model: claude-opus-2026' });
    expect(track({ type: 'status', label: 'model', model: 'claude-sonnet-2026' })).toBeNull();
    expect(track({ type: 'status', label: 'model', model: 'auto' })).toBeNull();
    const initiallyAliased = createModelReceiptTracker('opus', models);
    expect(initiallyAliased({ type: 'status', label: 'model', model: 'claude-opus-2026' })).toBeNull();
  });
  it('deduplicates initial/current metadata and records each switch with the previous model', () => {
    const track = createModelReceiptTracker('model-a');
    expect(track({ type: 'status', label: 'initializing', model: 'model-a' })).toBeNull();
    expect(track({ type: 'text_delta', delta: 'I am model-b' })).toBeNull();
    expect(track({ type: 'status', label: 'model', model: 'model-b' })).toEqual({ type: 'status', label: 'model_switch', model: 'model-b', previousModel: 'model-a', detail: 'Previous model: model-a' });
    expect(track({ type: 'status', label: 'model', model: 'model-b' })).toBeNull();
    expect(track({ type: 'status', label: 'model', model: 'model-a' })).toEqual({ type: 'status', label: 'model_switch', model: 'model-a', previousModel: 'model-b', detail: 'Previous model: model-b' });
  });
});
