import { describe, expect, it } from 'vitest';
import {
  clampProgressPercent,
  defaultProgressCardDetail,
  defaultProgressCardTitle,
  progressBarAriaValueNow,
  progressBarWidthPercent,
  progressCardItemIcon,
  progressCardStatusIcon,
  progressCardStatusLabel,
} from '../rules.js';
import type { ProgressStatus } from '../types.js';

const STATUSES: ProgressStatus[] = ['pending', 'running', 'succeeded', 'failed'];

describe('progressCardStatusIcon', () => {
  it('shows sparkles for pending and running', () => {
    expect(progressCardStatusIcon({ status: 'pending' })).toBe('sparkles');
    expect(progressCardStatusIcon({ status: 'running' })).toBe('sparkles');
  });

  it('shows check for succeeded', () => {
    expect(progressCardStatusIcon({ status: 'succeeded' })).toBe('check');
  });

  it('shows help-circle for failed', () => {
    expect(progressCardStatusIcon({ status: 'failed' })).toBe('help-circle');
  });
});

describe('progressCardItemIcon', () => {
  it('only shows an icon for succeeded items', () => {
    expect(progressCardItemIcon({ status: 'succeeded' })).toBe('check');
    expect(progressCardItemIcon({ status: 'pending' })).toBeNull();
    expect(progressCardItemIcon({ status: 'running' })).toBeNull();
    expect(progressCardItemIcon({ status: 'failed' })).toBeNull();
  });
});

describe('progressCardStatusLabel / defaults', () => {
  it('has a distinct label for every status', () => {
    const labels = STATUSES.map(progressCardStatusLabel);
    expect(new Set(labels).size).toBe(STATUSES.length);
  });

  it('defaultProgressCardTitle matches the status label', () => {
    for (const status of STATUSES) {
      expect(defaultProgressCardTitle({ status })).toBe(progressCardStatusLabel(status));
    }
  });

  it('defaultProgressCardDetail has a distinct sentence for every status', () => {
    const details = STATUSES.map(defaultProgressCardDetail);
    expect(new Set(details).size).toBe(STATUSES.length);
  });
});

describe('clampProgressPercent', () => {
  it('clamps to [0, 100]', () => {
    expect(clampProgressPercent({ value: -5 })).toBe(0);
    expect(clampProgressPercent({ value: 150 })).toBe(100);
    expect(clampProgressPercent({ value: 42.6 })).toBe(43);
  });

  it('treats non-finite input as 0', () => {
    expect(clampProgressPercent({ value: Number.NaN })).toBe(0);
    expect(clampProgressPercent({ value: Number.POSITIVE_INFINITY })).toBe(0);
  });
});

describe('progressBarWidthPercent', () => {
  it('returns null for indeterminate', () => {
    expect(progressBarWidthPercent({ progress: 'indeterminate' })).toBeNull();
  });

  it('clamps determinate values', () => {
    expect(progressBarWidthPercent({ progress: 37 })).toBe(37);
    expect(progressBarWidthPercent({ progress: -10 })).toBe(0);
  });
});

describe('progressBarAriaValueNow', () => {
  it('is undefined for indeterminate (per WAI-ARIA)', () => {
    expect(progressBarAriaValueNow({ progress: 'indeterminate' })).toBeUndefined();
  });

  it('is the clamped value for determinate progress', () => {
    expect(progressBarAriaValueNow({ progress: 80 })).toBe(80);
  });
});
