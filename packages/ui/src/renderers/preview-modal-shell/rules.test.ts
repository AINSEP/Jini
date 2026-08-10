import { describe, expect, it } from 'vitest';
import {
  computeScalerStyle,
  computeStageScale,
  deriveContentStatus,
  findActiveView,
  resolveInitialViewId,
} from './rules.js';

describe('resolveInitialViewId', () => {
  const views = [{ id: 'a' }, { id: 'b' }];

  it('uses initialViewId when it names a real view', () => {
    expect(resolveInitialViewId(views, 'b')).toBe('b');
  });

  it('falls back to the first view when initialViewId names nothing', () => {
    expect(resolveInitialViewId(views, 'missing')).toBe('a');
  });

  it('falls back to the first view when initialViewId is omitted', () => {
    expect(resolveInitialViewId(views, undefined)).toBe('a');
  });

  it('returns an empty string when there are no views at all', () => {
    expect(resolveInitialViewId([], 'anything')).toBe('');
    expect(resolveInitialViewId([], undefined)).toBe('');
  });
});

describe('findActiveView', () => {
  const views = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];

  it('finds the matching view by id', () => {
    expect(findActiveView(views, 'b')).toEqual({ id: 'b', label: 'B' });
  });

  it('falls back to the first view when activeId matches nothing', () => {
    expect(findActiveView(views, 'missing')).toEqual({ id: 'a', label: 'A' });
  });

  it('returns undefined when there are no views', () => {
    expect(findActiveView([], 'a')).toBeUndefined();
  });
});

describe('computeStageScale', () => {
  it('returns 1 before the stage has been measured (width 0)', () => {
    expect(computeStageScale(0, 1280)).toBe(1);
  });

  it('returns stageWidth/designWidth once measured', () => {
    expect(computeStageScale(640, 1280)).toBe(0.5);
    expect(computeStageScale(1280, 1280)).toBe(1);
    expect(computeStageScale(2560, 1280)).toBe(2);
  });
});

describe('computeScalerStyle', () => {
  it('fills the stage with no transform before the first measurement', () => {
    expect(computeScalerStyle({ w: 0, h: 0 }, 1280, 1)).toEqual({
      width: '100%',
      height: '100%',
      transform: 'none',
    });
  });

  it('renders at designWidth and scales to fit once measured', () => {
    const style = computeScalerStyle({ w: 640, h: 480 }, 1280, 0.5);
    expect(style).toEqual({
      width: 1280,
      height: 960,
      transform: 'scale(0.5)',
    });
  });
});

describe('deriveContentStatus', () => {
  it('is loading when there is no view at all', () => {
    expect(deriveContentStatus(undefined)).toBe('loading');
  });

  it('is custom when a custom stage is set, even alongside error/unavailable', () => {
    expect(deriveContentStatus({ custom: 'anything' })).toBe('custom');
    expect(deriveContentStatus({ custom: 'x', error: 'boom', unavailable: { message: 'no' } })).toBe('custom');
  });

  it('treats a falsy-but-defined custom value (0, "") as present', () => {
    expect(deriveContentStatus({ custom: 0 })).toBe('custom');
    expect(deriveContentStatus({ custom: '' })).toBe('custom');
  });

  it('is unavailable when unavailable is set and custom is not', () => {
    expect(deriveContentStatus({ unavailable: { message: 'nope' } })).toBe('unavailable');
  });

  it('is error when error is set and custom/unavailable are not', () => {
    expect(deriveContentStatus({ error: 'boom' })).toBe('error');
  });

  it('is loading when html is null or undefined', () => {
    expect(deriveContentStatus({ html: null })).toBe('loading');
    expect(deriveContentStatus({ html: undefined })).toBe('loading');
    expect(deriveContentStatus({})).toBe('loading');
  });

  it('is ready when html is a string', () => {
    expect(deriveContentStatus({ html: '<p>hi</p>' })).toBe('ready');
    expect(deriveContentStatus({ html: '' })).toBe('ready');
  });
});
