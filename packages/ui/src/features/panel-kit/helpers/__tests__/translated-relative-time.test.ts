import { expect, it } from 'vitest';
import { formatRelativeMinutesAgo } from '../format-timestamp.js';
it('accepts translated relative-time templates without consulting a locale store', () => {
  const copy: Record<string, string> = { 'less than a minute ago': 'À l’instant', '1 minute ago': 'Il y a 1 minute', '{minutes} minutes ago': 'Il y a {minutes} minutes' };
  const translate = (key: string) => copy[key] ?? key;
  expect(formatRelativeMinutesAgo({ iso: '2026-10-01T00:00:00Z', nowMs: Date.parse('2026-10-01T00:00:00Z') }, { translate: translate })).toBe('À l’instant');
  expect(formatRelativeMinutesAgo({ iso: '2026-10-01T00:00:00Z', nowMs: Date.parse('2026-10-01T00:01:00Z') }, { translate: translate })).toBe('Il y a 1 minute');
  expect(formatRelativeMinutesAgo({ iso: '2026-10-01T00:00:00Z', nowMs: Date.parse('2026-10-01T00:02:00Z') }, { translate: translate })).toBe('Il y a 2 minutes');
});
