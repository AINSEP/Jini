import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { McpUiHost, useChatSurfaces, ChatSurfacesProvider } from '../surfaces.js';
import { fakeChatSurfaces, renderWithChatSurfaces } from './fake-chat-surfaces.js';

function Probe() {
  useChatSurfaces();
  return null;
}

describe('ChatSurfacesProvider', () => {
  it('throws a pointed message when no provider is mounted', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/ChatSurfacesProvider surfaces=/);
    spy.mockRestore();
  });

  it('keeps the first surfaces value across re-renders', () => {
    const seen: unknown[] = [];
    function Capture() {
      seen.push(useChatSurfaces());
      return null;
    }
    const first = fakeChatSurfaces();
    const { rerender } = render(<ChatSurfacesProvider surfaces={first}><Capture /></ChatSurfacesProvider>);
    rerender(<ChatSurfacesProvider surfaces={fakeChatSurfaces()}><Capture /></ChatSurfacesProvider>);
    expect(seen.length).toBeGreaterThan(1);
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toBe(first);
  });

  it('McpUiHost renders the injected Host with the same props', () => {
    const Host = vi.fn((p: { title: string }) => <div data-testid="host">{p.title}</div>);
    const props = { title: 'T', html: '<p/>', sandboxProxyUrl: new URL('https://example.test/p') };
    renderWithChatSurfaces(<McpUiHost {...props} />, { surfaces: fakeChatSurfaces({ mcpUi: { Host } }) });
    expect(screen.getByTestId('host').textContent).toBe('T');
    expect(Host.mock.calls[0]![0]).toMatchObject(props);
  });
});
