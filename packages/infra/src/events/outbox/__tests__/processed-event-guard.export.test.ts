import { expect, test } from 'vitest';
import { InMemoryProcessedEventStore, withProcessedEventGuard } from '../index.js';

// The package entry `@jini-ai/infra/events/outbox` maps to this barrel: hosts import the guard from it.
test('the processed-event guard is reachable from the outbox entry', async () => {
  const seen: string[] = [];
  const guarded = withProcessedEventGuard({
    store: new InMemoryProcessedEventStore(), handlerId: 'sitemap', handler: async (event: { id: string }) => { seen.push(event.id); },
  });
  await guarded({ id: 'evt-1' });
  await guarded({ id: 'evt-1' });
  expect(seen).toEqual(['evt-1']);
});
