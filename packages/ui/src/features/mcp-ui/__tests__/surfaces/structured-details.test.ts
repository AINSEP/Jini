import { describe, expect, it } from 'vitest';
import { renderDetailList } from '../../surfaces/document.js';

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('structured surface details', () => {
  it.each([[true, 'On'], [false, 'Off'], [42, '42'], [0, '0'], ['', '—'], [null, '—'], [undefined, '—']])(
    'renders %s as %s', (value, text) => {
      expect(parse(renderDetailList([{ label: 'Value', value }])).querySelector('dd')?.textContent).toBe(text);
    },
  );

  it('keeps existing plain strings and explicit status formatting', () => {
    const doc = parse(renderDetailList([{ label: 'Status', value: 'Ready', format: 'status' }], { layout: 'outcome' }));
    expect(doc.querySelector('.mcpui-detail-status')?.textContent).toBe('Ready');
    expect(doc.querySelector('.mcpui-detail-status')?.getAttribute('title')).toBe('Ready');
  });

  it('humanizes object keys, supports explicit path labels and indents nested groups', () => {
    const value = { privacyPolicyUrl: '/privacy', appearance: { fontSize: 14 }, enabled: true };
    const doc = parse(renderDetailList([{ label: 'Configuration', value, labels: { 'appearance.fontSize': 'Taille du texte' } }]));
    expect([...doc.querySelectorAll('dt')].map(node => node.textContent)).toEqual([
      'Configuration', 'Privacy policy URL', 'Appearance', 'Taille du texte', 'Enabled',
    ]);
    expect(doc.querySelectorAll('.mcpui-detail-group')).toHaveLength(2);
    expect(doc.querySelector('.mcpui-detail-raw pre')?.textContent).toBe(JSON.stringify(value, null, 2));
  });

  it('renders scalar arrays as a comma list and structured arrays as a bullet list', () => {
    const doc = parse(renderDetailList([
      { label: 'Categories', value: ['Necessary', 'Analytics', false, 0] },
      { label: 'Rules', value: [{ ruleName: 'First' }, { ruleName: 'Second' }], labels: { '0.ruleName': 'First rule' } },
      { label: 'Empty', value: [] }, { label: 'Empty object', value: {} },
    ]));
    expect(doc.querySelector('dd')?.textContent).toContain('Necessary, Analytics, Off, 0');
    expect(doc.querySelectorAll('ul > li')).toHaveLength(2);
    expect([...doc.querySelectorAll('dt')].map(node => node.textContent)).toContain('First rule');
    expect([...doc.querySelectorAll('.mcpui-detail-value')].map(node => node.textContent)).toContain('—');
  });

  it.each([
    ['customCss', '.banner {\n  color: red;\n}', 'CSS · 3 lines'],
    ['template', '<div>Hello</div>', 'HTML · 1 line'],
    ['arguments', '{"enabled":true}', 'JSON · 1 line'],
    ['description', 'First\nSecond', 'Text · 2 lines'],
  ])('collapses %s into a labeled, escaped monospace block', (key, value, label) => {
    const doc = parse(renderDetailList([{ label: 'Details', value: { [key]: value } }]));
    const disclosure = doc.querySelector('details.mcpui-detail-code');
    expect(disclosure?.hasAttribute('open')).toBe(false);
    expect(disclosure?.querySelector('summary')?.textContent).toBe(label);
    expect(disclosure?.querySelector('summary')?.getAttribute('aria-expanded')).toBe('false');
    expect(disclosure?.querySelector('pre')?.textContent).toBe(value);
  });

  it('keeps long arrays short while retaining all items behind disclosures', () => {
    const value = Array.from({ length: 8 }, (_, index) => ({ title: `Item ${index}` }));
    const doc = parse(renderDetailList([{ label: 'Items', value }]));
    expect(doc.querySelector('dd > ul')?.querySelectorAll(':scope > li')).toHaveLength(5);
    expect(doc.querySelector('summary')?.textContent).toBe('Show more (3 items)');
    expect(doc.querySelector('details ul')?.querySelectorAll(':scope > li')).toHaveLength(3);
    expect(doc.querySelector('details ul')?.textContent).toContain('Item 7');
    const scalarDoc = parse(renderDetailList([{ label: 'Items', value: Array.from({ length: 20 }, () => 'A long item') }]));
    expect(scalarDoc.querySelector('.mcpui-detail-preview')).not.toBeNull();
  });

  it('clamps long single-line text with an accessible disclosure and preserves the entire value', () => {
    const value = 'A long description '.repeat(40);
    const doc = parse(renderDetailList([{ label: 'Description', value }]));
    expect(doc.querySelector('.mcpui-detail-preview')?.textContent).toBe(value);
    expect(doc.querySelector('summary')?.textContent).toContain('Show more');
    expect(doc.querySelector('.mcpui-detail-full')?.textContent).toBe(value);
    expect(doc.querySelector('.mcpui-detail-raw pre')?.textContent).toBe(JSON.stringify(value, null, 2));
  });

  it('supports an explicit code format, even for one-line non-HTML code', () => {
    const doc = parse(renderDetailList([{ label: 'Query', value: 'select 1', format: 'code' }]));
    expect(doc.querySelector('summary')?.textContent).toBe('Code · 1 line');
    expect(doc.querySelector('pre')?.textContent).toBe('select 1');
  });

  it('shows changed fields first, collapses unchanged fields and ignores object key order', () => {
    const previous = { title: 'Same', appearance: { textColor: 'black', fontSize: 12 }, removed: 'old' };
    const value = { title: 'Same', appearance: { fontSize: 14, textColor: 'black' }, added: 'new' };
    const doc = parse(renderDetailList([{ label: 'Configuration', previous, value }]));
    const group = doc.querySelector('dd > .mcpui-detail-group');
    expect(group?.querySelector('dt')?.textContent).toBe('Appearance');
    expect(group?.textContent).toContain('Before');
    expect(group?.textContent).toContain('After');
    expect(group?.textContent).toContain('Removed');
    expect(group?.textContent).toContain('Added');
    const unchanged = group?.querySelector('details.mcpui-detail-unchanged');
    expect(unchanged?.hasAttribute('open')).toBe(false);
    expect(unchanged?.textContent).toContain('Text color');
    expect(doc.querySelector('.mcpui-detail-raw pre')?.textContent).toBe(JSON.stringify({ previous, value }, null, 2));
  });

  it('treats reordered objects as unchanged, but not reordered arrays or null and missing fields', () => {
    const doc = parse(renderDetailList([{ label: 'Change', previous: { object: { a: 1, b: 2 }, array: [1, 2], empty: null }, value: { object: { b: 2, a: 1 }, array: [2, 1] } }]));
    const unchanged = doc.querySelector('.mcpui-detail-unchanged');
    expect(unchanged?.textContent).toContain('Object');
    expect(unchanged?.textContent).not.toContain('Array');
    expect(doc.querySelector('.mcpui-detail-change')?.textContent).toContain('Before');
    expect(doc.querySelector('.mcpui-detail-group')?.textContent).toContain('Removed');
  });

  it.each([
    [{ empty: null }, {}, 'Removed'],
    [{}, { empty: null }, 'Added'],
  ])('distinguishes null from a missing field in either direction', (previous, value, status) => {
    const doc = parse(renderDetailList([{ label: 'Change', previous, value }]));
    const row = doc.querySelector('.mcpui-detail-group > .mcpui-detail-row');
    expect(row?.querySelector('dt')?.textContent).toBe('Empty');
    expect(row?.querySelector('dd > .mcpui-hint')?.textContent).toBe(status);
    expect(row?.textContent).toContain('Before');
    expect(row?.textContent).toContain('After');
    expect(doc.querySelector('.mcpui-detail-unchanged')).toBeNull();
  });

  it('keeps an explicit null unchanged when the key exists in both snapshots', () => {
    const doc = parse(renderDetailList([{ label: 'Change', previous: { empty: null }, value: { empty: null } }]));
    expect(doc.querySelector('.mcpui-detail-unchanged')?.textContent).toContain('Empty');
    expect(doc.querySelector('.mcpui-detail-change')).toBeNull();
    expect(doc.querySelector('dd > .mcpui-hint')).toBeNull();
  });

  it('escapes labels, keys, previous values, array items, code and raw JSON at the HTML boundary', () => {
    const attack = '</pre><img src=x onerror="alert(1)"><script>alert(1)</script>';
    const doc = parse(renderDetailList([{ label: attack, previous: { [attack]: 'before' }, value: { [attack]: attack, list: [attack] }, labels: { list: attack } }]));
    expect(doc.querySelector('script, img, [onerror]')).toBeNull();
    expect(doc.querySelector('dt')?.textContent).toBe(attack);
    expect(JSON.parse(doc.querySelector('.mcpui-detail-raw pre')!.textContent!).value[attack]).toBe(attack);
  });

  it('diffs prototype-named JSON keys without displaying inherited object members', () => {
    const doc = parse(renderDetailList([{ label: 'Change', previous: {}, value: JSON.parse('{"__proto__":"own value","constructor":"own constructor"}') }]));
    expect(doc.querySelector('.mcpui-detail-group')?.textContent).toContain('own value');
    expect(doc.querySelector('.mcpui-detail-group')?.textContent).not.toContain('[native code]');
    expect(doc.querySelector('.mcpui-detail-group')?.textContent).not.toContain('To string');
  });
});
