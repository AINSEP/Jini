import { describe, expect, it } from 'vitest';
import { createPrefixToolFamilyPort } from '../tool-family.js';

const SELECTOR_KEYS = ['resource', 'type', 'entity', 'kind'] as const;
const registryOf = (...ids: string[]) => ({ list: () => ids.map((id) => ({ id })) }) as never;
const portOf = (registry: never) => createPrefixToolFamilyPort({ registry, familyId: 'catalog_read', selectorKeys: SELECTOR_KEYS });

describe('createPrefixToolFamilyPort', () => {
  it('describes the family as its <familyId>.<name> cards, with each name selecting its card', () => {
    const port = portOf(registryOf('catalog_read.menu', 'catalog_read.page', 'catalog_post_list', 'catalog_readable'));
    expect(port.describeFamily({ familyId: 'catalog_read' })).toEqual({
      members: ['catalog_read.menu', 'catalog_read.page'],
      selector: { keys: ['resource', 'type', 'entity', 'kind'], byValue: { menu: 'catalog_read.menu', page: 'catalog_read.page' } },
    });
  });

  it('has a selector value only for a card that is registered', () => {
    const selector = portOf(registryOf('catalog_read.menu')).describeFamily({ familyId: 'catalog_read' })?.selector;
    expect(Object.keys(selector?.byValue ?? {})).toEqual(['menu']);
    expect(selector?.byValue.theme).toBeUndefined();
  });

  it('knows no other id, and a family with no registered card is not one either', () => {
    const port = portOf(registryOf('catalog_read.menu'));
    expect(port.describeFamily({ familyId: 'catalog_post_list' })).toBeUndefined();
    expect(port.describeFamily({ familyId: 'catalog_read.menu' })).toBeUndefined();
    expect(portOf(registryOf('catalog_post_list')).describeFamily({ familyId: 'catalog_read' })).toBeUndefined();
  });

  it('reads the registry on every ask, so a card retired since startup disappears', () => {
    let ids = ['catalog_read.menu', 'catalog_read.page'];
    const port = portOf({ list: () => ids.map((id) => ({ id })) } as never);
    expect(port.describeFamily({ familyId: 'catalog_read' })?.members).toEqual(['catalog_read.menu', 'catalog_read.page']);
    ids = ['catalog_read.page'];
    expect(port.describeFamily({ familyId: 'catalog_read' })?.members).toEqual(['catalog_read.page']);
  });
});
