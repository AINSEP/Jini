import { describe, expect, it } from 'vitest';
import { IMAGE_MODEL_IDS, imageModelIdsFrom } from '../image-model-ids.js';
import { IMAGE_MODELS, findProvider } from '../providers.js';

describe('imageModelIdsFrom', () => {
  it('keeps catalogue order and drops models whose vendor is not integrated', () => {
    const catalog = {
      modelsForSurface: () => [{ id: 'a', provider: 'real' }, { id: 'b', provider: 'planned' }, { id: 'c', provider: 'missing' }, { id: 'd', provider: 'real' }],
      findProvider: ({ id }: { id: string }) => (id === 'real' ? { integrated: true } : id === 'planned' ? { integrated: false } : null),
    };
    expect(imageModelIdsFrom({ catalog })).toEqual(['a', 'd']);
  });

  it('IMAGE_MODEL_IDS is the rule over the built-in catalogue', () => {
    expect(IMAGE_MODEL_IDS).toEqual(IMAGE_MODELS.filter((model) => findProvider({ id: model.provider })?.integrated === true).map((model) => model.id));
    expect(IMAGE_MODEL_IDS.length).toBeGreaterThan(0);
  });
});
