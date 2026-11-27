import { describeErrorParts } from '@jini-ai/core';
import { expect, it } from 'vitest';
import { describeReportedError } from '../errors.js';

it('uses the host error label and redacts before bounding the message and stack', () => {
  const fakeCredential = 'ghp_' + 'A'.repeat(36);
  const prefix = 'x'.repeat(990);
  const error = new Error(`${prefix} ${fakeCredential} ${'y'.repeat(300)}`);
  const frames = Array.from({ length: 33 }, (_, index) => `    at frame${index + 1} (fixture.js:1:1)`);
  error.stack = [`Error: ${fakeCredential}`, ...frames].join('\n');

  const result = describeReportedError({ error }, { describer: {
    describeErrorParts: ({ err }) => ({ ...describeErrorParts({ err }), label: 'HostOperationFailure' }),
  } });

  expect(result).toEqual({
    type: 'HostOperationFailure',
    message: `${prefix} [REDACTED:credential] `.padEnd(1024, 'y'),
    stack: ['Error: [REDACTED:credential]', ...frames.slice(0, 29)].join('\n'),
  });
});
