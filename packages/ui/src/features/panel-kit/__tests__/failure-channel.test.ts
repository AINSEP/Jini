import { expect, it, vi } from 'vitest';
import { createFailureChannel } from '../failure-channel.js';
import { formatUserFacingError } from '@jini-ai/core';
const failure = formatUserFacingError({ message: 'Read failed.', action: 'Try again.', step: 'read', cause: 'Safe report.' });

it('retains only the latest failure, notifies subscribers and releases them', () => {
  const channel = createFailureChannel({});
  const listener = vi.fn();
  const unsubscribe = channel.subscribe(listener);
  expect(channel.getSnapshot()).toBeNull();
  channel.publish({ failure });
  expect(channel.getSnapshot()).toBe(failure);
  expect(listener).toHaveBeenCalledTimes(1);
  channel.publish({ failure: { ...failure, message: 'Latest' } });
  expect(channel.getSnapshot()?.message).toBe('Latest');
  unsubscribe();
  channel.reset();
  expect(channel.getSnapshot()).toBeNull();
  expect(listener).toHaveBeenCalledTimes(2);
});
it('isolates instances and rejects old in-flight failures after a scope reset', () => {
  const channel = createFailureChannel({});
  const other = createFailureChannel({});
  const generation = channel.getGeneration();
  channel.reset();
  channel.publish({ failure, generation });
  expect(channel.getSnapshot()).toBeNull();
  channel.publish({ failure, generation: channel.getGeneration() });
  expect(channel.getSnapshot()).toBe(failure);
  expect(other.getSnapshot()).toBeNull();
});
it('allows hosts to inject publication effects without retaining a history', () => {
  const onPublish = vi.fn();
  const channel = createFailureChannel({}, { onPublish });
  channel.publish({ failure });
  expect(onPublish).toHaveBeenCalledWith({ failure });
});
it('isolates failed subscribers and publication effects from transport and reset', () => {
  const channel = createFailureChannel({}, { onPublish: () => { throw new Error('effect failed'); } });
  channel.subscribe(() => { throw new Error('subscriber failed'); });
  const listener = vi.fn();
  channel.subscribe(listener);
  expect(() => channel.publish({ failure })).not.toThrow();
  expect(channel.getSnapshot()).toBe(failure);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(() => channel.reset()).not.toThrow();
  expect(channel.getSnapshot()).toBeNull();
  expect(listener).toHaveBeenCalledTimes(2);
});
