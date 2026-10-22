import { describe, it, expect, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { createAnnotatedActionsScript } from '../../annotated-actions-script.js';

/** Owner WebMCP continuation 2026-10-04: exercise the emitted browser code, not its spelling. */
describe('annotated browser actions', () => {
  async function setup(html: string, enabled = true) {
    document.body.innerHTML = html;
    const tools = new Map<string, { execute: (args: Record<string, unknown>) => Promise<unknown>; inputSchema: unknown }>();
    const signals: AbortSignal[] = [];
    const registerTool = vi.fn(async (tool, options) => { tools.set(tool.name, tool); signals.push(options.signal); });
    Object.defineProperty(document, 'modelContext', { configurable: true, value: { registerTool } });
    window.localStorage.setItem('test.webmcp.enabled', String(enabled));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    window.eval(createAnnotatedActionsScript({ preferenceKey: 'test.webmcp.enabled', confirmationMessage: 'Allow action?' }));
    await Promise.resolve();
    return { tools, signals, registerTool, confirm, cleanup: () => { window.dispatchEvent(new Event('pagehide')); confirm.mockRestore(); } };
  }

  it('registers only public actions, never native forms, cross-origin links, inputs or submit buttons', async () => {
    const s = await setup('<button type="button" data-toolname="toggle" data-tooldescription="Toggle panel">Toggle</button><a href="https://other.example" data-toolname="external" data-tooldescription="Leave">Leave</a><input type="password" data-toolname="secret" data-tooldescription="Password"><form toolname="contact" tooldescription="Contact"><button data-toolname="submit" data-tooldescription="Send">Send</button></form>');
    expect([...s.tools.keys()]).toEqual(['toggle']);
    expect(s.tools.get('toggle')!.inputSchema).toEqual({ type: 'object', properties: {}, additionalProperties: false });
    s.cleanup();
  });

  it('fails closed on denied consent, invalid input, disabled controls and stale callbacks', async () => {
    const s = await setup('<button type="button" data-toolname="toggle" data-tooldescription="Toggle panel">Toggle</button>');
    const button = document.querySelector('button')!;
    const click = vi.fn(); button.addEventListener('click', click);
    const tool = s.tools.get('toggle')!;
    await expect(tool.execute({})).rejects.toThrow('declined');
    expect(click).not.toHaveBeenCalled();
    s.confirm.mockReturnValue(true);
    await expect(tool.execute({ value: 'secret' })).rejects.toThrow('arguments');
    expect(click).not.toHaveBeenCalled();
    await expect(tool.execute({})).resolves.toEqual({ activated: true });
    expect(click).toHaveBeenCalledTimes(1);
    button.disabled = true;
    await expect(tool.execute({})).rejects.toThrow('unavailable');
    button.disabled = false;
    button.setAttribute('data-tooldescription', 'Changed');
    await expect(tool.execute({})).rejects.toThrow('unavailable');
    s.cleanup();
    expect(s.signals.every(signal => signal.aborted)).toBe(true);
    await expect(tool.execute({})).rejects.toThrow('unavailable');
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('honors opt-out and unregisters when it changes in another tab', async () => {
    const html = '<button type="button" data-toolname="toggle" data-tooldescription="Toggle panel">Toggle</button>';
    const disabled = await setup(html, false);
    expect(disabled.registerTool).not.toHaveBeenCalled(); disabled.cleanup();
    const s = await setup(html);
    window.localStorage.setItem('test.webmcp.enabled', 'false');
    window.dispatchEvent(new StorageEvent('storage', { key: 'test.webmcp.enabled', newValue: 'false' }));
    expect(s.signals.every(signal => signal.aborted)).toBe(true);
    await expect(s.tools.get('toggle')!.execute({})).rejects.toThrow('unavailable'); s.cleanup();
  });

  it('refuses duplicate names including native form names, and isolates registration rejections', async () => {
    const s = await setup('<form toolname="shared" tooldescription="Native"></form><button type="button" data-toolname="shared" data-tooldescription="Duplicate">Shared</button><button type="button" data-toolname="twice" data-tooldescription="One">One</button><button type="button" data-toolname="twice" data-tooldescription="Two">Two</button>');
    expect(s.registerTool).not.toHaveBeenCalled(); s.cleanup();
    Object.defineProperty(document, 'modelContext', { configurable: true, value: { registerTool: () => Promise.reject(new Error('unsupported')) } });
    document.body.innerHTML = '<button type="button" data-toolname="ok" data-tooldescription="Action">Action</button>';
    expect(() => window.eval(createAnnotatedActionsScript({}))).not.toThrow();
    await Promise.resolve(); window.dispatchEvent(new Event('pagehide'));
  });

  it('navigates to the real same-origin link and rejects a changed target before acting', async () => {
    document.body.innerHTML = '<a href="/docs" data-toolname="docs" data-tooldescription="Docs">Docs</a><a href="//other.example/docs" data-toolname="external" data-tooldescription="External">External</a><a href="javascript:alert(1)" data-toolname="script" data-tooldescription="Script">Script</a>';
    const tools = new Map<string, { execute: (args: Record<string, unknown>) => Promise<unknown> }>();
    const assign = vi.fn();
    const fakeWindow = {
      location: { origin: window.location.origin, assign },
      getComputedStyle: window.getComputedStyle.bind(window),
      confirm: vi.fn(),
      addEventListener: window.addEventListener.bind(window),
      removeEventListener: window.removeEventListener.bind(window),
    };
    Object.defineProperty(document, 'modelContext', { configurable: true, value: { registerTool: async (tool: { name: string; execute: (args: Record<string, unknown>) => Promise<unknown> }) => { tools.set(tool.name, tool); } } });
    runInNewContext(createAnnotatedActionsScript({}), { document, window: fakeWindow, navigator: {}, MutationObserver, AbortController, URL });
    expect([...tools.keys()]).toEqual(['docs']);
    await expect(tools.get('docs')!.execute({})).resolves.toEqual({ navigationRequested: true });
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(new URL('/docs', document.baseURI).href);
    expect(fakeWindow.confirm).not.toHaveBeenCalled();
    document.querySelector('a')!.setAttribute('href', 'https://other.example');
    await expect(tools.get('docs')!.execute({})).rejects.toThrow('unavailable');
    expect(assign).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('pagehide'));
  });

  it('rechecks duplicate insertion during confirmation and never trusts a stale click target', async () => {
    const s = await setup('<button type="button" data-toolname="toggle" data-tooldescription="Toggle panel">Toggle</button>');
    const tool = s.tools.get('toggle')!;
    const click = vi.fn(); document.querySelector('button')!.addEventListener('click', click);
    s.confirm.mockImplementation(() => { document.body.insertAdjacentHTML('beforeend', '<button type="button" data-toolname="toggle" data-tooldescription="Other">Other</button>'); return true; });
    await expect(tool.execute({})).rejects.toThrow('unavailable');
    expect(click).not.toHaveBeenCalled(); s.cleanup();
  });

  it('uses document locale for consent and tolerates an absent browser API', async () => {
    document.documentElement.lang = 'fr';
    document.body.innerHTML = '<button type="button" data-toolname="ok" data-tooldescription="Action">Action</button>';
    let tool: { execute: (args: Record<string, unknown>) => Promise<unknown> } | undefined;
    Object.defineProperty(document, 'modelContext', { configurable: true, value: { registerTool: async (value: typeof tool) => { tool = value; } } });
    const consent = vi.spyOn(window, 'confirm').mockReturnValue(false);
    window.eval(createAnnotatedActionsScript({ confirmationMessages: { fr: 'Autoriser ?' } }));
    await expect(tool!.execute({})).rejects.toThrow('declined');
    expect(consent).toHaveBeenCalledWith('Autoriser ?\n\nAction');
    window.dispatchEvent(new Event('pagehide')); consent.mockRestore(); document.documentElement.lang = '';
    Object.defineProperty(document, 'modelContext', { configurable: true, value: undefined });
    expect(() => window.eval(createAnnotatedActionsScript({}))).not.toThrow();
  });

  it('restores registrations after browser back-forward cache navigation without reviving old callbacks', async () => {
    const s = await setup('<button type="button" data-toolname="toggle" data-tooldescription="Toggle panel">Toggle</button>');
    const oldTool = s.tools.get('toggle')!;
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    expect(s.signals[0]?.aborted).toBe(true);
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    expect(s.registerTool).toHaveBeenCalledTimes(2);
    await expect(oldTool.execute({})).rejects.toThrow('unavailable');
    s.confirm.mockReturnValue(true);
    await expect(s.tools.get('toggle')!.execute({})).resolves.toEqual({ activated: true });
    s.cleanup();
  });
});
