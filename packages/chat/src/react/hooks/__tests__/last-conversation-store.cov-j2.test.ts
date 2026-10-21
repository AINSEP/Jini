import { afterEach, describe, expect, it } from 'vitest';
import { createLastConversationStore } from '../last-conversation-store.js';

/**
 * The default-storage edge: when no storage is injected the store resolves the origin's
 * `localStorage` on every call, and a browser that refuses access (blocked site data throws on the
 * property read itself) or a runtime without it must degrade to "remembers nothing", never throw.
 */
describe('createLastConversationStore default storage resolution', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
  });

  it('remembers nothing, without throwing, when reading localStorage throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    const store = createLastConversationStore({ scope: 'ws:user-1' });
    expect(() => store.write('conv-1')).not.toThrow();
    expect(store.read()).toBeNull();
    expect(() => store.clear()).not.toThrow();
  });

  it('remembers nothing when the runtime has no localStorage at all', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
    const store = createLastConversationStore({ scope: 'ws:user-1' });
    store.write('conv-1');
    expect(store.read()).toBeNull();
  });

  it('resumes using localStorage once it becomes available, because it is resolved per call', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
    const store = createLastConversationStore({ scope: 'ws:user-2' });
    store.write('lost');
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    localStorage.clear();
    store.write('conv-2');
    expect(store.read()).toBe('conv-2');
  });
});
