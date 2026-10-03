import { expect, test } from 'vitest';
import { defaultAgenticMessages, PAGE_CAPABILITIES, toAgUiTool } from '../index.js';

// REGRESSION: fails if page.navigate's description reverts to "another page of this site".
test('navigation describes a neutral page and the host can replace its descriptor copy', () => {
  const navigation = PAGE_CAPABILITIES.find(capability => capability.id === 'page.navigate');
  if (!navigation) throw new Error('Missing page navigation descriptor');
  expect(navigation.description).toBe(defaultAgenticMessages.pageNavigateDescription());
  expect(navigation.description).toContain('Move to another page,');
  const hostDescriptor = { ...navigation, description: 'Move to another published workspace view.' };
  expect(toAgUiTool({ capability: hostDescriptor }).description).toBe(hostDescriptor.description);
  expect(navigation.description).toBe(defaultAgenticMessages.pageNavigateDescription());
});
