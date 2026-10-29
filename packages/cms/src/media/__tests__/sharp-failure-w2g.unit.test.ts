import { expect, test } from 'vitest';
import { ImageSourceCorruptError, SharpImageTransformer, type SharpFactory } from '../image-transformer.sharp.js';

test('a native decoder throwing a non-Error still produces the named source-corruption refusal', async () => {
  const factory: SharpFactory = () => { throw 'native decoder refused source'; };
  const transformer = new SharpImageTransformer({}, { loadSharp: () => factory });
  const result = transformer.transform({ bytes: new Uint8Array([1, 2]), params: { format: 'webp' } });
  await expect(result).rejects.toBeInstanceOf(ImageSourceCorruptError);
  await expect(result).rejects.toThrow("the source image could not be decoded/re-encoded (target format 'webp'): native decoder refused source");
});
