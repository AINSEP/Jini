import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { MCP_UI_EXPIRES_AT_META_KEY, MCP_UI_MIME_TYPE } from '@jini-ai/ui/mcp-ui';
import { fakeClock } from '../../hooks/__tests__/fake-surface-expiry-clock.js';
import { McpUiSurfaceCard } from '../McpUiSurfaceCard.js';

const deadline = 1_700_000_300_000;
const base = { name: 'mcp-ui', runStreaming: true, runSucceeded: false, runId: 'run', sandboxProxyUrl: new URL('https://sandbox.example.test/proxy.html') };
const first = { type: 'resource', resource: { uri: 'ui://a/1', mimeType: MCP_UI_MIME_TYPE, text: '<p>Allow?</p>', _meta: { [MCP_UI_EXPIRES_AT_META_KEY]: deadline } } };

it('removes the live expiry ticker after an answer arrives without relabeling the card when its deadline passes', () => {
  const clock = fakeClock(deadline - 2_000);
  const { rerender } = render(<McpUiSurfaceCard {...base} events={[first]} expiryClock={clock.clock} />);
  expect(screen.getByRole('timer')).toHaveTextContent('Expires in 0:02');
  expect(clock.liveTickers()).toBe(1);
  rerender(<McpUiSurfaceCard {...base} events={[first]} expiryClock={clock.clock} answered />);
  expect(screen.queryByRole('timer')).toBeNull();
  expect(clock.liveTickers()).toBe(0);
  clock.advance(3_000);
  expect(screen.queryByRole('status')).toBeNull();
});

it('suppresses the deadline for a multi-resource group, but reinstates it when only one URI remains', () => {
  const clock = fakeClock(deadline - 1_000);
  const second = { ...first, resource: { ...first.resource, uri: 'ui://b/2' } };
  const { rerender } = render(<McpUiSurfaceCard {...base} events={[first, second]} expiryClock={clock.clock} call={{ name: 'ask', input: { title: 'Choose' } }} />);
  expect(screen.queryByRole('timer')).toBeNull();
  expect(clock.liveTickers()).toBe(0);
  rerender(<McpUiSurfaceCard {...base} events={[first]} expiryClock={clock.clock} call={{ name: 'ask', input: { title: 'Choose' } }} />);
  expect(screen.getByRole('timer')).toHaveTextContent('Expires in 0:01');
  clock.advance(1_000);
  expect(screen.getByRole('status')).toHaveTextContent('Choose: This question expired');
  expect(screen.queryByRole('timer')).toBeNull();
});

it('leaves invalid resources visible as an error without scheduling a deadline', () => {
  const clock = fakeClock(deadline);
  render(<McpUiSurfaceCard {...base} events={[null, { type: 'text', text: 'No resource' }]} expiryClock={clock.clock} />);
  expect(screen.getByRole('status')).toHaveTextContent('This MCP-UI event carried no renderable resource.');
  expect(clock.liveTickers()).toBe(0);
});
