import { expect, test } from 'vitest';

import { installGlobalErrorReporting, type GlobalErrorReport } from '../error-events.js';

/** @file `installGlobalErrorReporting`: capped text, fallbacks, native handling kept, teardown removes both listeners. */

function dispatchError({ target, error, message }: { target: EventTarget; error: unknown; message: string }) {
  const event = Object.assign(new Event('error', { cancelable: true }), { error, message });
  target.dispatchEvent(event);
  return event;
}

function dispatchRejection({ target, reason }: { target: EventTarget; reason: unknown }) {
  target.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason }));
}

function install(_options = {}) {
  const target = new EventTarget();
  const sent: GlobalErrorReport[] = [];
  const dispose = installGlobalErrorReporting({ target, report: (report) => { sent.push(report); } });
  return { target, sent, dispose };
}

test('an error event is capped before it reaches the sink and keeps its default handling', () => {
  const { target, sent } = install();
  const failure = new Error('m'.repeat(1001));
  failure.stack = 's'.repeat(8001);
  const event = dispatchError({ target, error: failure, message: 'fallback' });
  expect(event.defaultPrevented).toBe(false);
  expect(sent).toEqual([{ message: 'm'.repeat(1000), stack: 's'.repeat(8000) }]);
});

test('an error event without an Error object reports its message text', () => {
  const { target, sent } = install();
  dispatchError({ target, error: undefined, message: 'Script error.' });
  expect(sent[0]?.message).toBe('Script error.');
});

test('a string rejection reports the string; any other reason reports the fallback', () => {
  const { target, sent } = install();
  dispatchRejection({ target, reason: 'fake rejection' });
  dispatchRejection({ target, reason: { code: 7 } });
  expect(sent.map((report) => report.message)).toEqual(['fake rejection', 'Unhandled rejection']);
});

test('host limits and fallback text replace the defaults', () => {
  const target = new EventTarget();
  const sent: GlobalErrorReport[] = [];
  installGlobalErrorReporting({ target, report: (report) => { sent.push(report); } },
    { maxMessageLength: 3, maxStackLength: 2, rejectionFallback: 'rejected' });
  const failure = new Error('abcdef');
  failure.stack = 'xyz';
  dispatchError({ target, error: failure, message: '' });
  dispatchRejection({ target, reason: 42 });
  expect(sent).toEqual([{ message: 'abc', stack: 'xy' }, { message: 'rej', stack: expect.any(String) }]);
});

test('teardown removes both listeners', () => {
  const { target, sent, dispose } = install();
  dispatchRejection({ target, reason: 'before' });
  dispose();
  dispatchError({ target, error: new Error('after'), message: 'after' });
  dispatchRejection({ target, reason: 'after dispose' });
  expect(sent).toHaveLength(1);
});

test('an Error without a stack reports an empty stack, and an event without text an empty message', () => {
  const { target, sent } = install();
  const bare = new Error('bare');
  delete (bare as { stack?: string }).stack;
  target.dispatchEvent(Object.assign(new Event('error'), { error: bare }));
  target.dispatchEvent(new Event('error'));
  expect(sent[0]).toEqual({ message: 'bare', stack: '' });
  expect(sent[1]?.message).toBe('');
});
