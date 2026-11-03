import { expectTypeOf, it } from 'vitest';
import type { EventLog, EventLogAppendInput, EventLogAppendOptions, EventLogEntry, EventLogReplayResult } from '../index.js';

it('separates producer dedupe options and keeps replay results unchanged', () => {
  // Assert the generic method itself so the two-object boundary and the payload's
  // input/output relationship are both part of the contract.
  expectTypeOf<EventLog['append']>().toEqualTypeOf<
    <Payload>(input: EventLogAppendInput<Payload>, options?: EventLogAppendOptions) => Promise<EventLogEntry<Payload>>
  >();
  expectTypeOf<Parameters<EventLog['replay']>>().toEqualTypeOf<[
    input: { readonly runId: string; readonly afterCursor: string | null },
  ]>();
  expectTypeOf<Parameters<EventLog['listRunIds']>>().toEqualTypeOf<[input: Record<string, never>]>();
  expectTypeOf<Parameters<EventLog['drop']>>().toEqualTypeOf<[input: { readonly runId: string }]>();
  expectTypeOf<Awaited<ReturnType<EventLog['replay']>>>().toEqualTypeOf<EventLogReplayResult>();
});
