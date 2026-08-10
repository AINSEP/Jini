import { describe, expect, it } from 'vitest';
import { applySrcDocBridges, type SrcDocBridge } from '../bridge.js';

describe('applySrcDocBridges', () => {
  it('runs every bridge in array order, threading the doc through each', () => {
    const bridges: SrcDocBridge[] = [
      { id: 'a', inject: (doc) => `${doc}<a/>` },
      { id: 'b', inject: (doc) => `${doc}<b/>` },
    ];
    expect(applySrcDocBridges('<root/>', bridges)).toBe('<root/><a/><b/>');
  });

  it('passes the shared context through to every bridge', () => {
    const seen: unknown[] = [];
    const bridges: SrcDocBridge[] = [
      {
        id: 'a',
        inject: (doc, ctx) => {
          seen.push(ctx.baseHref);
          return doc;
        },
      },
    ];
    applySrcDocBridges('<root/>', bridges, { baseHref: 'https://example.com/' });
    expect(seen).toEqual(['https://example.com/']);
  });

  it('skips a bridge that throws and keeps the prior doc unchanged for that step', () => {
    const bridges: SrcDocBridge[] = [
      {
        id: 'broken',
        inject: () => {
          throw new Error('boom');
        },
      },
      { id: 'ok', inject: (doc) => `${doc}<ok/>` },
    ];
    expect(applySrcDocBridges('<root/>', bridges)).toBe('<root/><ok/>');
  });

  it('returns the input unchanged with no bridges', () => {
    expect(applySrcDocBridges('<root/>', [])).toBe('<root/>');
  });
});
