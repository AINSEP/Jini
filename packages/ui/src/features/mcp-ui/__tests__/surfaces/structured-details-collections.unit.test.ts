import { expect, it } from 'vitest';
import { renderStructuredDetail } from '../../surfaces/structured-details.js';

const parse = (markup: string) => new DOMParser().parseFromString(markup, 'text/html');

it('keeps nested array paths in explicit labels and renders long or multiline items as individual rows', () => {
  const value = { rules: [{ displayName: 'First' }, ['line one\nline two', null]] };
  const doc = parse(renderStructuredDetail({ detail: { label: 'Rules', value, labels: { 'rules.0.displayName': 'Localized name' } } }));
  expect([...doc.querySelectorAll('dt')].map(node => node.textContent)).toContain('Localized name');
  expect(doc.querySelector('.mcpui-detail-code summary')?.textContent).toBe('Text · 2 lines');
  expect(doc.querySelector('.mcpui-detail-code pre')?.textContent).toBe('line one\nline two');
  expect(doc.querySelector('.mcpui-detail-raw pre')?.textContent).toBe(JSON.stringify(value, null, 2));
});

it.each([
  { before: [1], after: [1, 2] },
  { before: { a: 1 }, after: { b: 1 } },
  { before: [1], after: { a: 1 } },
  { before: { a: 1 }, after: [1] },
])('shows changed collection shape $before → $after', ({ before, after }) => {
  const doc = parse(renderStructuredDetail({ detail: { label: 'Value', previous: before, value: after } }));
  expect(doc.querySelector('.mcpui-detail-unchanged')).toBeNull();
  expect(doc.querySelector('.mcpui-detail-change')).not.toBeNull();
  expect(JSON.parse(doc.querySelector('.mcpui-detail-raw pre')!.textContent!)).toEqual({ previous: before, value: after });
});

it('recognizes CSS content without a CSS property name and retains the exact text', () => {
  const css = '.banner { color: red; }';
  const doc = parse(renderStructuredDetail({ detail: { label: 'Style', value: css } }));
  expect(doc.querySelector('summary')?.textContent).toBe('CSS · 1 line');
  expect(doc.querySelector('pre')?.textContent).toBe(css);
});
