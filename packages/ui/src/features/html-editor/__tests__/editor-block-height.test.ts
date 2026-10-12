// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { editorBlockHeight } from '../canvas-embed-placeholders.js';

describe('runtime footprint', () => {
  it.each([
    [{}, 280], [{ declaredHeight: 10 }, 96], [{ declaredHeight: 9000 }, 960],
    [{ declaredHeight: 300, nativeHeight: 150 }, 300], [{ declaredHeight: 0, nativeHeight: 150 }, 150],
    [{ declaredHeight: NaN }, 280], [{ declaredHeight: Infinity }, 280], [{ declaredHeight: -10 }, 280],
    [{ inline: true }, 64], [{ inline: true, declaredHeight: 10 }, 48], [{ inline: true, declaredHeight: 500 }, 160],
  ])('%o → %s px', (input, expected) => { expect(editorBlockHeight(input, {})).toBe(expected); });
});
