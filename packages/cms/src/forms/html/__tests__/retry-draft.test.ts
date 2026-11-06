import assert from 'node:assert/strict';
import { test } from 'vitest';
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { formRetryFields } from '../../stale-form.js';
import { repopulateFormRetryHtml } from '../retry-draft.js';
import type { FieldDescriptor } from '../../types.js';

function elements(html: string): DefaultTreeAdapterMap['element'][] {
  const stack = [...parseFragment(html).childNodes]; const found: DefaultTreeAdapterMap['element'][] = [];
  while (stack.length) {
    const node = stack.pop()!;
    if (!('tagName' in node)) continue;
    found.push(node); stack.push(...node.childNodes);
  }
  return found;
}
const attr = (node: DefaultTreeAdapterMap['element'], name: string) => node.attrs.find(item => item.name === name)?.value;

test('current multi-select/radio/group choices restore while obsolete choices stay copyable and consent resets', () => {
  const options = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }];
  const fields: FieldDescriptor[] = [
    { id: 'many', type: 'multi-select', label: 'Many', required: false, options },
    { id: 'group', type: 'checkbox-group', label: 'Group', required: false, options },
    { id: 'radio', type: 'radio', label: 'Radio', required: false, options },
    { id: 'changed', type: 'select', label: 'Changed', required: false, options },
    { id: 'consent', type: 'checkbox', label: 'New terms', required: true, default: true },
  ];
  const retry = formRetryFields({ fields, answers: { many: ['a', 'b'], group: ['b'], radio: 'a', changed: 'old', consent: 'on' } });
  assert.deepEqual(retry.retained, { changed: 'old', consent: 'on' });
  const html = repopulateFormRetryHtml({ fields: retry.fields, html: '<select name="many" multiple><option value="a">A</option><option value="b">B</option></select><input type="CHECKBOX" name="group" value="a" checked><input type="checkbox" name="group" value="b"><input type="RADIO" name="radio" value="a"><input type="radio" name="radio" value="b" checked><select name="changed"><option value="a" selected>A</option><option value="b">B</option></select><input type="CHECKBOX" name="consent" checked>' });
  const nodes = elements(html);
  const selected = nodes.filter(node => node.tagName === 'option' && attr(node, 'selected') !== undefined);
  assert.deepEqual(selected.map(node => [attr(node.parentNode as DefaultTreeAdapterMap['element'], 'name'), attr(node, 'value')]).sort(), [['changed', ''], ['many', 'a'], ['many', 'b']]);
  const checked = nodes.filter(node => node.tagName === 'input' && attr(node, 'checked') !== undefined);
  assert.deepEqual(checked.map(node => [attr(node, 'name'), attr(node, 'value')]).sort(), [['group', 'b'], ['radio', 'a']]);
});
