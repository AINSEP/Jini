import { expectTypeOf, it } from 'vitest';
import type { EventLog, EventLogAppendInput, EventLogAppendOptions, EventLogReplayResult } from '../index.js';

it('separates producer dedupe options and keeps replay results unchanged', () => {
  expectTypeOf<Parameters<EventLog['append']>>().toEqualTypeOf<[
    input: EventLogAppendInput<unknown>, options?: EventLogAppendOptions,
  ]>();
  expectTypeOf<Parameters<EventLog['replay']>>().toEqualTypeOf<[
    input: { readonly runId: string; readonly afterCursor: string | null },
  ]>();
  expectTypeOf<Parameters<EventLog['listRunIds']>>().toEqualTypeOf<[input: Record<string, never>]>();
  expectTypeOf<Parameters<EventLog['drop']>>().toEqualTypeOf<[input: { readonly runId: string }]>();
  expectTypeOf<Awaited<ReturnType<EventLog['replay']>>>().toEqualTypeOf<EventLogReplayResult>();
});
