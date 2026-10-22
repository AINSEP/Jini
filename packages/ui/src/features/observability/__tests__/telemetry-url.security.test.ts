import { expect, it } from 'vitest';
import { telemetryUrl } from '../telemetry-url.js';

it.each([
  ['https://user:password@example.test/a?token=secret#private', 'https://example.test/a'],
  ['//user:password@example.test/a?token=secret#private', 'https://example.test/a'],
  ['/a?token=secret#private', '/a'], ['a?token=secret#private', '/a'],
  ['https://[?token=secret', undefined], ['not a url?token=secret', undefined],
  ['data:text/plain,private@example.test', undefined], ['javascript:private()', undefined],
  ['', undefined], [undefined, undefined],
])('sanitizes untrusted telemetry URL %j', (value, expected) => {
  expect(telemetryUrl({ value })).toBe(expected);
});
