import { describe, expect, it } from 'vitest';
import { targetAtOffset, toolRowTarget } from '../ToolCard.rules.js';

describe('toolRowTarget', () => {
  it('names a plugin call by its plugin id, not by the plugin family', () => {
    expect(toolRowTarget({ input: { family: 'agent-plugin', pluginId: 'composio', enabled: true } })).toBe('composio');
  });

  describe('read window (offset and limit)', () => {
    const path = 'templates/index.html';

    it('tells two reads of one file at the same offset apart by their limit', () => {
      const short = toolRowTarget({ input: { path, offset: 10, limit: 20 } });
      const long = toolRowTarget({ input: { path, offset: 10, limit: 50 } });
      expect(short).toBe(`${path} (offset 10, limit 20)`);
      expect(long).toBe(`${path} (offset 10, limit 50)`);
      expect(short).not.toBe(long);
    });

    it('shows a limit-only read, which previously looked like an unbounded read', () => {
      expect(toolRowTarget({ input: { path, limit: 50 } })).toBe(`${path} (limit 50)`);
    });

    it('keeps the offset-only copy and the explicit-zero first-page offset unchanged', () => {
      expect(toolRowTarget({ input: { path, offset: 42 } })).toBe(`${path} (offset 42)`);
      expect(toolRowTarget({ input: { path, offset: 0, limit: 5 } })).toBe(`${path} (offset 0, limit 5)`);
    });

    it.each([0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '20', null])('ignores a limit that is not a positive whole number (%s)', (limit) => {
      expect(toolRowTarget({ input: { path, offset: 10, limit } })).toBe(`${path} (offset 10)`);
      expect(toolRowTarget({ input: { path, limit } })).toBe(path);
    });

    it('never invents a target for a limit alone', () => {
      expect(toolRowTarget({ input: { limit: 5, nested: { a: 'b' } } })).toBeUndefined();
    });
  });
});

describe('targetAtOffset', () => {
  it('appends the limit beside the offset, and alone when there is no offset', () => {
    expect(targetAtOffset({ target: 'a.html', offset: 10, limit: 20 })).toBe('a.html (offset 10, limit 20)');
    expect(targetAtOffset({ target: 'a.html', offset: undefined, limit: 20 })).toBe('a.html (limit 20)');
    expect(targetAtOffset({ target: 'a.html', offset: 10 })).toBe('a.html (offset 10)');
  });
});
