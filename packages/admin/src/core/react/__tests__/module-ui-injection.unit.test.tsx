import { createElement, type Context, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { AdminConfigError, createControllerStore } from '@jini-ai/core/admin-runtime';
import type { UseAdminController } from '@jini-ai/core/contracts/admin-module';
import { reactModuleUi } from '../module-ui.js';
import { createOverlayController } from '../../../react/overlays.js';
import { forms } from '../../../forms/react/index.js';
import { FormsControllerContext, useFormsController } from '../../../forms/react/hooks/FormsPorts.hooks.js';
import { seo } from '../../../seo/react/index.js';
import { SeoControllerContext, useSeoController } from '../../../seo/react/hooks/SeoPorts.hooks.js';
import { redirects } from '../../../redirects/react/index.js';
import { RedirectsControllerContext, useRedirectsController } from '../../../redirects/react/hooks/RedirectsPorts.hooks.js';
import { media } from '../../../media/react/index.js';
import { MediaControllerContext, useMediaController } from '../../../media/react/hooks/MediaPorts.hooks.js';
import { widgets } from '../../../widgets/react/index.js';
import { WidgetsControllerContext, useWidgetsController } from '../../../widgets/react/hooks/WidgetsPorts.hooks.js';
import { comments } from '../../../comments/react/index.js';
import { CommentsControllerContext, useCommentsController } from '../../../comments/react/hooks/CommentsPorts.hooks.js';
import { agentPlugins } from '../../../agent-plugins/react/index.js';
import { AgentPluginsControllerContext, useAgentPluginsController } from '../../../agent-plugins/react/hooks/AgentPluginsPorts.hooks.js';
import { sourceControl } from '../../../source-control/react/index.js';
import { SourceControlControllerContext, useSourceControlController } from '../../../source-control/react/hooks/SourceControlPorts.hooks.js';
import { widgetTypes, defaultConfig } from '../../../widgets/react/__tests__/fixtures/catalog.js';

// J4 React half (owner 2026-11-17): a domain module receives bindReact and useController from its
// host through one grouped `ui` argument and never imports them.
afterEach(cleanup);

type Ui = typeof reactModuleUi;
const factories = [
  { name: 'forms', create: (ui: Ui) => forms({ ui }) },
  { name: 'seo', create: (ui: Ui) => seo({ ui, siteUrl: () => 'https://site.test' }) },
  { name: 'redirects', create: (ui: Ui) => redirects({ ui }) },
  { name: 'media', create: (ui: Ui) => media({ ui, overlays: createOverlayController({}) }) },
  { name: 'widgets', create: (ui: Ui) => widgets({ ui, slots: { ConfigFields: () => null, AddControl: () => null }, widgetTypes, defaultConfig }) },
  { name: 'comments', create: (ui: Ui) => comments({ ui }) },
  { name: 'agentPlugins', create: (ui: Ui) => agentPlugins({ ui }) },
  { name: 'sourceControl', create: (ui: Ui) => sourceControl({ ui }) },
];

it.each(factories)('$name binds its views through the injected bindReact', ({ create }) => {
  const ui = { ...reactModuleUi };
  const bindReact = vi.spyOn(ui, 'bindReact');
  const feature = create(ui);
  expect(bindReact).toHaveBeenCalledTimes(1);
  expect(bindReact.mock.calls[0]![0].module).toBe(feature.react.module);
});

const controllerHooks: readonly { id: string; context: Context<UseAdminController | null>; useDomainController: UseAdminController }[] = [
  { id: 'forms', context: FormsControllerContext, useDomainController: useFormsController },
  { id: 'seo', context: SeoControllerContext, useDomainController: useSeoController },
  { id: 'redirects', context: RedirectsControllerContext, useDomainController: useRedirectsController },
  { id: 'media', context: MediaControllerContext, useDomainController: useMediaController },
  { id: 'widgets', context: WidgetsControllerContext, useDomainController: useWidgetsController },
  { id: 'comments', context: CommentsControllerContext, useDomainController: useCommentsController },
  { id: 'agent-plugins', context: AgentPluginsControllerContext, useDomainController: useAgentPluginsController },
  { id: 'source-control', context: SourceControlControllerContext, useDomainController: useSourceControlController },
];

it.each(controllerHooks)('$id runs the injected controller hook with the caller arguments', ({ context, useDomainController }) => {
  const fake = vi.fn((_required: unknown, _optional?: unknown) => ({ controller: null, snapshot: null }));
  const create = () => createControllerStore({ initial: { n: 1 } });
  const start = () => {};
  const wrapper = ({ children }: { children: ReactNode }) => createElement(context.Provider, { value: fake }, children);
  const { result } = renderHook(() => useDomainController({ create, dependencies: ['a'] }, { start }), { wrapper });
  expect(result.current).toEqual({ controller: null, snapshot: null });
  expect(fake).toHaveBeenCalledWith({ create, dependencies: ['a'] }, { start });
});

it.each(controllerHooks)('$id refuses to run without an injected controller hook', ({ id, useDomainController }) => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const create = () => createControllerStore({ initial: {} });
  expect(() => renderHook(() => useDomainController({ create, dependencies: [] }))).toThrow(AdminConfigError);
  expect(() => renderHook(() => useDomainController({ create, dependencies: [] }))).toThrow(`Controller hook unavailable: ${id}`);
});
