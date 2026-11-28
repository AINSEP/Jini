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

test('restores an option submitted by its text and clears stale control defaults', () => {
  const fields: FieldDescriptor[] = [
    { id: 'choice-id', name: 'choice', type: 'select', label: 'Choice', required: false, default: 'Afternoon' },
    { id: 'note', type: 'textarea', label: 'Note', required: false },
    { id: 'file', type: 'file', label: 'File', required: false },
  ];
  const output = repopulateFormRetryHtml({ fields, html: '<select name="choice"><option selected>Morning</option><option> Afternoon </option></select><textarea name="note">Old answer</textarea><input name="file" type="file" value="old.pdf"><template><input name="note" value="template value"></template>' });
  const nodes = elements(output);
  const selected = nodes.filter(node => node.tagName === 'option' && attr(node, 'selected') !== undefined);
  assert.deepEqual(selected.map(node => node.childNodes.map(child => 'value' in child ? child.value : '')), [[' Afternoon ']]);
  assert.match(output, /<textarea name="note"><\/textarea>/);
  assert.match(output, /<input name="file" type="file">/);
  assert.match(output, /<template><input name="note" value="template value"><\/template>/);
});

test('a text default fills its input, a text input without one is cleared, option text ignores comments, and named non-controls are left as authored', () => {
  const fields: FieldDescriptor[] = [
    { id: 'first', type: 'text', label: 'First name', required: false, default: 'Ada' },
    { id: 'slot', type: 'select', label: 'Slot', required: false, default: 'Late' },
    { id: 'last', type: 'text', label: 'Last name', required: false },
  ];
  const output = repopulateFormRetryHtml({ fields, html: '<fieldset name="first"><legend>Who</legend><input name="first" value="Old"></fieldset><select name="slot"><option>Early</option><option>Late<!-- shift --></option></select><input name="last" value="Stale">' });
  const nodes = elements(output);
  const input = nodes.find(node => node.tagName === 'input' && attr(node, 'name') === 'first');
  assert.equal(attr(input!, 'value'), 'Ada');
  const last = nodes.find(node => node.tagName === 'input' && attr(node, 'name') === 'last');
  assert.deepEqual(last!.attrs, [{ name: 'name', value: 'last' }]);
  const fieldset = nodes.find(node => node.tagName === 'fieldset');
  assert.deepEqual(fieldset!.attrs, [{ name: 'name', value: 'first' }]);
  assert.match(output, /<fieldset name="first"><legend>Who<\/legend>/);
  const selected = nodes.filter(node => node.tagName === 'option' && attr(node, 'selected') !== undefined);
  assert.deepEqual(selected.map(node => node.childNodes.map(child => 'value' in child ? child.value : '').join('')), ['Late']);
});
