import { expect, it } from 'vitest';
import { secretControlAttrs } from './attrs.js';

it('excludes mixed-case agent metadata without mutating ordinary control props', () => {
  const onClick = () => undefined;
  const attrs = { id: 'secret', disabled: true, onClick, 'aria-label': 'Token', 'data-testid': 'token',
    'data-agent-element': 'secret', 'data-Agent-Element': 'case-variant', 'data-agent-private': false };
  expect(secretControlAttrs({ attrs })).toEqual({ id: 'secret', disabled: true, onClick,
    'aria-label': 'Token', 'data-testid': 'token', 'data-agent-private': '' });
  expect(attrs['data-agent-element']).toBe('secret');
  expect(attrs['data-Agent-Element']).toBe('case-variant');
  expect(attrs['data-agent-private']).toBe(false);
  expect(secretControlAttrs({ attrs: {} })).toEqual({ 'data-agent-private': '' });
});
