import { describe, expect, it } from 'vitest';
import { createModelReceiptTracker } from '../model-receipts.js';
describe('authoritative model receipts', () => {
  it('deduplicates initial/current metadata and records each switch with the previous model', () => {
    const track = createModelReceiptTracker('model-a');
    expect(track({ type: 'status', label: 'initializing', model: 'model-a' })).toBeNull();
    expect(track({ type: 'text_delta', delta: 'I am model-b' })).toBeNull();
    expect(track({ type: 'status', label: 'model', model: 'model-b' })).toEqual({ type: 'status', label: 'model_switch', model: 'model-b', previousModel: 'model-a', detail: 'Previous model: model-a' });
    expect(track({ type: 'status', label: 'model', model: 'model-b' })).toBeNull();
    expect(track({ type: 'status', label: 'model', model: 'model-a' })).toEqual({ type: 'status', label: 'model_switch', model: 'model-a', previousModel: 'model-b', detail: 'Previous model: model-b' });
  });
});
