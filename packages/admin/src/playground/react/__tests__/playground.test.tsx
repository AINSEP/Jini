import { Suspense, StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '../../../__tests__/fetch-query-support.js';
import { createAdmin } from '../../../core/module/index.js';
import { PlaygroundPage } from '../pages/PlaygroundPage.js';
import { usePlaygroundPage } from '../hooks/PlaygroundPage.hooks.js';
import { Canvas } from '../components/Canvas.js';
import { playground } from '../index.js';
import { createMemoryPlaygroundTargets } from '../../adapters/memory.js';
afterEach(cleanup);
function setup(permissions: readonly string[] = []) {
  const feature = playground({}), targets = createMemoryPlaygroundTargets({});
  const admin = createAdmin({ modules: [feature], ports: { playgroundTargets: targets } }, { permissions });
  const { Page, tabs } = feature.react.pages.playground;
  const tree = () => <StrictMode><feature.react.Provider admin={admin}><Suspense fallback="Loading"><Page tabs={tabs} description={admin.describe().pages[0]!} /></Suspense></feature.react.Provider></StrictMode>;
  return { targets, tree, admin };
}
it('denies canvas publication without grants', async () => {
  const { targets, tree } = setup(); const spy = vi.spyOn(targets, 'register'); render(tree());
  expect(await screen.findByText('Permission denied')).toBeVisible(); expect(spy).not.toHaveBeenCalled(); expect(targets.getSnapshot().target).toBeNull();
});
it('read-only canvas survives rerenders and clears on unmount under StrictMode', async () => {
  const { targets, tree } = setup(['playground.read']); const view = render(tree());
  await screen.findByRole('heading', { name: 'Canvas' }); await waitFor(() => expect(targets.getSnapshot().target).toBeInstanceOf(HTMLDivElement));
  const node = targets.getSnapshot().target as HTMLDivElement;
  expect(node.childNodes).toHaveLength(0); expect(screen.getByText('Nothing drawn yet — ask the assistant.')).toBeVisible();
  const transitions: unknown[] = []; targets.subscribe({ listener: () => transitions.push(targets.getSnapshot().target) });
  view.rerender(tree()); expect(targets.getSnapshot().target).toBe(node); expect(transitions).toEqual([]);
  const realSurface = document.createElement('article'); realSurface.textContent = 'Assistant output'; node.appendChild(realSurface);
  expect(screen.getByText('Nothing drawn yet — ask the assistant.')).not.toBeVisible(); expect(node.firstChild).toBe(realSurface);
  view.unmount(); expect(targets.getSnapshot().target).toBeNull(); expect(transitions).toEqual([null]);
});


it('uses an injected playground denial despite granted access', () => {
  const feature = playground({});
  const admin = createAdmin({ modules: [feature], ports: { playgroundTargets: createMemoryPlaygroundTargets({}) } }, { permissions: ['playground.read'] });
  render(<PlaygroundPage tabs={feature.react.pages.playground.tabs} description={admin.describe().pages[0]!}
    usePlaygroundPageHook={(props) => ({ ...usePlaygroundPage(props), denied: true })} />);
  expect(screen.getByText('Permission denied')).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Canvas' })).toBeNull();
});

it('uses the canvas override to mount its surface and empty notice without ports', () => {
  const registerCanvas = vi.fn();
  render(<Canvas params={{}} useCanvasHook={() => ({ denied: false, styles: '', registerCanvas })} />);
  expect(screen.getByText('Nothing drawn yet — ask the assistant.')).toBeVisible();
  expect(registerCanvas).toHaveBeenCalledWith(document.querySelector('[data-jini-part="playground.canvas"]'));
});
