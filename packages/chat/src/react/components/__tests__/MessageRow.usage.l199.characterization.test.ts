import { renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { ChatUsageSummary } from '../../../core/turn-usage.js';
import { useUsageSummary } from '../MessageRow.usage.js';

it.each<{ name: string; usage: ChatUsageSummary; showTotal?: boolean; text: string; title?: string }>([
  { name: 'absent values', usage: { kind: 'usage' }, text: '' },
  { name: 'zero duration and output', usage: { kind: 'usage', durationMs: 0, outputTokens: 0 }, text: '0s', title: '0 out' },
  { name: 'rounding below a minute', usage: { kind: 'usage', durationMs: 59_499 }, text: '59s' },
  { name: 'rounding into a minute', usage: { kind: 'usage', durationMs: 59_500 }, text: '1m 0s' },
  { name: 'minutes plus seconds', usage: { kind: 'usage', durationMs: 121_000 }, text: '2m 1s' },
  { name: 'cost as the fallback total', usage: { kind: 'usage', costUsd: 0.004 }, text: '$0.01 · total $0.01' },
  { name: 'an explicit zero total', usage: { kind: 'usage', costUsd: 0.1, totalCostUsd: 0 }, text: '$0.10 · total $0.00' },
  { name: 'zero cost with total hidden', usage: { kind: 'usage', costUsd: 0, totalCostUsd: 2 }, showTotal: false, text: '$0.00' },
  { name: 'total without a cost', usage: { kind: 'usage', durationMs: 1_000, totalCostUsd: 0.5, outputTokens: 7 }, text: '1s · total $0.50', title: '7 out' },
  { name: 'hidden total without a cost', usage: { kind: 'usage', totalCostUsd: 0.5, outputTokens: 7 }, showTotal: false, text: '', title: '7 out' },
])('preserves usage display for $name', ({ usage, showTotal, text, title }) => {
  const options = showTotal === undefined ? {} : { showTotal };
  const { result } = renderHook(() => useUsageSummary({ usage }, options));
  expect(result.current).toEqual({ text, title, ariaLabel: title === undefined ? undefined : `Done · ${text} · ${title}` });
});
