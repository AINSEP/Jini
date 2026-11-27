// @vitest-environment jsdom
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminApiError } from '@jini-ai/core/admin-runtime';
import { ExternalMcpSharedChoice } from '../ExternalMcpSharedChoice.js';
import { useExternalMcpSharedChoice, type ExternalMcpSharedChoicePort, type SharedView, type UseExternalMcpSharedChoice } from '../ExternalMcpSharedChoice.hooks.js';

/**
 * @file The saved-connection chooser over an injected {@link ExternalMcpSharedChoicePort}. English
 * copy (`t` is the identity); the host's suite keeps the translated-copy cases, which need the host's
 * external-MCP dictionary.
 */

const t = (key: string) => key;

function fakePort(overrides: Partial<ExternalMcpSharedChoicePort> = {}): ExternalMcpSharedChoicePort {
  return {
    listSharedMcpConnections: vi.fn(async () => ({ available: false, connections: [], current: null }) satisfies SharedView),
    useSharedMcpConnection: vi.fn(async () => ({ connected: true })),
    stopSharedMcpConnection: vi.fn(async () => undefined),
    useLocalMcpConnection: vi.fn(async () => undefined),
    ...overrides,
  };
}

function bind(port: ExternalMcpSharedChoicePort): UseExternalMcpSharedChoice {
  return (args) => useExternalMcpSharedChoice({ ...args, port });
}

describe('explicit saved MCP choices', () => {
  it('loads metadata on demand, then offers saved selection, shared sign-in and explicit local selection', async () => {
    const port = fakePort({ listSharedMcpConnections: vi.fn(async () => ({ available: true, connections: [{ credentialId: 'owner-record', label: 'Saved MCP' }],
      current: { credentialId: 'owner-record', status: 'connected', granted: true } })) });
    const signIn = vi.fn();
    const onChanged = vi.fn();
    render(<ExternalMcpSharedChoice t={t} serverId="server-a" busy={false} signIn={signIn} onChanged={onChanged} useExternalMcpSharedChoiceHook={bind(port)} />);
    expect(port.listSharedMcpConnections).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use a saved connection on this Mac' }));
    await screen.findByRole('option', { name: 'Saved MCP' });
    fireEvent.change(screen.getByLabelText('Saved MCP connection'), { target: { value: 'owner-record' } });
    await waitFor(() => expect(port.useSharedMcpConnection).toHaveBeenCalledWith({ serverId: 'server-a', credentialId: 'owner-record' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in and save on this Mac' }));
    expect(signIn).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Stop using here' }));
    await waitFor(() => expect(port.stopSharedMcpConnection).toHaveBeenCalledWith({ serverId: 'server-a' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: "Use this site's local connection" }));
    await waitFor(() => expect(port.useLocalMcpConnection).toHaveBeenCalledWith({ serverId: 'server-a' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(3));
    expect(document.querySelector('.jini-external-mcp-shared-choice')).not.toBeNull();
  });

  it('gives a concrete unavailable state without offering saving on an unbound host', async () => {
    const port = fakePort();
    render(<ExternalMcpSharedChoice t={t} serverId="server-a" busy={false} signIn={vi.fn()} onChanged={vi.fn()} useExternalMcpSharedChoiceHook={bind(port)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use a saved connection on this Mac' }));
    expect(await screen.findByText('Saved connections are available in the desktop owner profile.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in and save on this Mac' })).toBeNull();
  });

  it("shows an AdminApiError's own message when the port refuses", async () => {
    const port = fakePort({ listSharedMcpConnections: vi.fn(async () => { throw new AdminApiError({ message: 'Owner profile is locked.', status: 409 }); }) });
    render(<ExternalMcpSharedChoice t={t} serverId="server-a" busy={false} signIn={vi.fn()} onChanged={vi.fn()} useExternalMcpSharedChoiceHook={bind(port)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use a saved connection on this Mac' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Owner profile is locked.');
  });

  it('shows the action fallback, never the raw text, for a non-API failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const port = fakePort({ useLocalMcpConnection: vi.fn(async () => { throw new Error('token=secret'); }),
      listSharedMcpConnections: vi.fn(async () => ({ available: true, connections: [], current: { credentialId: 'c', status: 'connected', granted: true } })) });
    render(<ExternalMcpSharedChoice t={t} serverId="server-a" busy={false} signIn={vi.fn()} onChanged={vi.fn()} useExternalMcpSharedChoiceHook={bind(port)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use a saved connection on this Mac' }));
    fireEvent.click(await screen.findByRole('button', { name: "Use this site's local connection" }));
    expect((await screen.findByRole('alert')).textContent).toBe('The local connection could not be selected. Try again.');
  });
});

it("keeps the grant on a failed stop, then shows the stopped state after retry", async () => {
  const user = userEvent.setup();
  let granted = true;
  const stop = vi.fn<ExternalMcpSharedChoicePort["stopSharedMcpConnection"]>()
    .mockRejectedValueOnce(new AdminApiError({ message: "This grant is busy.", status: 409 }))
    .mockImplementationOnce(async () => { granted = false; });
  const list = vi.fn<ExternalMcpSharedChoicePort["listSharedMcpConnections"]>(async ({ serverId }) => {
    if (serverId !== "server-b") throw new Error("Unexpected server");
    return { available: true, connections: [{ credentialId: "b", label: "Operator" }], current: { credentialId: "b", granted, status: "connected" } };
  });
  const onChanged = vi.fn();
  render(<ExternalMcpSharedChoice t={t} serverId="server-b" busy={false} signIn={vi.fn()} onChanged={onChanged} useExternalMcpSharedChoiceHook={bind(fakePort({ listSharedMcpConnections: list, stopSharedMcpConnection: stop }))} />);
  await user.click(screen.getByRole("button", { name: "Use a saved connection on this Mac" }));
  await user.click(await screen.findByRole("button", { name: "Stop using here" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("This grant is busy.");
  expect(screen.getByText("Shared connection: connected.")).toBeVisible();
  expect(onChanged).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Stop using here" }));
  expect(await screen.findByText("This shared connection is stopped on this site.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Stop using here" })).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(stop.mock.calls).toEqual([[{ serverId: "server-b" }], [{ serverId: "server-b" }]]);
  expect(list.mock.calls).toEqual([[{ serverId: "server-b" }], [{ serverId: "server-b" }]]);
  expect(onChanged).toHaveBeenCalledTimes(1);
});

it("reports a failed saved selection without treating the placeholder or the failure as a grant", async () => {
  const user = userEvent.setup();
  const choose = vi.fn<ExternalMcpSharedChoicePort["useSharedMcpConnection"]>()
    .mockRejectedValueOnce(new Error("internal credential details"));
  const port = fakePort({
    listSharedMcpConnections: async () => ({ available: true, connections: [{ credentialId: "saved-5", label: "Saved five" }], current: null }),
    useSharedMcpConnection: choose,
  });
  const onChanged = vi.fn();
  render(<ExternalMcpSharedChoice t={t} serverId="server-5" busy={false} signIn={vi.fn()} onChanged={onChanged} useExternalMcpSharedChoiceHook={bind(port)} />);
  await user.click(screen.getByRole("button", { name: "Use a saved connection on this Mac" }));
  const select = await screen.findByRole("combobox", { name: "Saved MCP connection" });
  expect(select).toHaveValue("");
  expect(screen.queryByRole("button", { name: "Use this site's local connection" })).toBeNull();
  expect(choose).not.toHaveBeenCalled();
  await user.selectOptions(select, "saved-5");
  expect(await screen.findByRole("alert")).toHaveTextContent("This saved connection could not be granted to this server. Choose another connection or sign in.");
  expect(choose.mock.calls).toEqual([[{ serverId: "server-5", credentialId: "saved-5" }]]);
  expect(select).toBeEnabled();
  expect(onChanged).not.toHaveBeenCalled();
});
