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
    expect(resolveInitialViewId({ views, initialViewId: 'b' })).toBe('b');
  });

  it('falls back to the first view when initialViewId names nothing', () => {
    expect(resolveInitialViewId({ views, initialViewId: 'missing' })).toBe('a');
  });

  it('falls back to the first view when initialViewId is omitted', () => {
    expect(resolveInitialViewId({ views, initialViewId: undefined })).toBe('a');
  });

  it('returns an empty string when there are no views at all', () => {
    expect(resolveInitialViewId({ views: [], initialViewId: 'anything' })).toBe('');
    expect(resolveInitialViewId({ views: [], initialViewId: undefined })).toBe('');
  });
});

describe('findActiveView', () => {
  const views = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];

  it('finds the matching view by id', () => {
    expect(findActiveView({ views, activeId: 'b' })).toEqual({ id: 'b', label: 'B' });
  });

  it('falls back to the first view when activeId matches nothing', () => {
    expect(findActiveView({ views, activeId: 'missing' })).toEqual({ id: 'a', label: 'A' });
  });

  it('returns undefined when there are no views', () => {
    expect(findActiveView({ views: [], activeId: 'a' })).toBeUndefined();
  });
});

describe('computeStageScale', () => {
  it('returns 1 before the stage has been measured (width 0)', () => {
    expect(computeStageScale({ stageWidth: 0, designWidth: 1280 })).toBe(1);
  });

  it('returns stageWidth/designWidth once measured', () => {
    expect(computeStageScale({ stageWidth: 640, designWidth: 1280 })).toBe(0.5);
    expect(computeStageScale({ stageWidth: 1280, designWidth: 1280 })).toBe(1);
    expect(computeStageScale({ stageWidth: 2560, designWidth: 1280 })).toBe(2);
  });
});

describe('computeScalerStyle', () => {
  it('fills the stage with no transform before the first measurement', () => {
    expect(computeScalerStyle({ stageSize: { w: 0, h: 0 }, designWidth: 1280, scale: 1 })).toEqual({
      width: '100%',
      height: '100%',
      transform: 'none',
    });
  });

  it('renders at designWidth and scales to fit once measured', () => {
    const style = computeScalerStyle({ stageSize: { w: 640, h: 480 }, designWidth: 1280, scale: 0.5 });
    expect(style).toEqual({
      width: 1280,
      height: 960,
      transform: 'scale(0.5)',
    });
  });
});

describe('deriveContentStatus', () => {
  it('is loading when there is no view at all', () => {
    expect(deriveContentStatus({ view: undefined })).toBe('loading');
  });

  it('is custom when a custom stage is set, even alongside error/unavailable', () => {
    expect(deriveContentStatus({ view: { custom: 'anything' } })).toBe('custom');
    expect(deriveContentStatus({ view: { custom: 'x', error: 'boom', unavailable: { message: 'no' } } })).toBe('custom');
  });

  it('treats a falsy-but-defined custom value (0, "") as present', () => {
    expect(deriveContentStatus({ view: { custom: 0 } })).toBe('custom');
    expect(deriveContentStatus({ view: { custom: '' } })).toBe('custom');
  });

  it('is unavailable when unavailable is set and custom is not', () => {
    expect(deriveContentStatus({ view: { unavailable: { message: 'nope' } } })).toBe('unavailable');
  });

  it('is error when error is set and custom/unavailable are not', () => {
    expect(deriveContentStatus({ view: { error: 'boom' } })).toBe('error');
  });

  it('is loading when html is null or undefined', () => {
    expect(deriveContentStatus({ view: { html: null } })).toBe('loading');
    expect(deriveContentStatus({ view: { html: undefined } })).toBe('loading');
    expect(deriveContentStatus({ view: {} })).toBe('loading');
  });

  it('is ready when html is a string', () => {
    expect(deriveContentStatus({ view: { html: '<p>hi</p>' } })).toBe('ready');
    expect(deriveContentStatus({ view: { html: '' } })).toBe('ready');
  });
});
