import { createElement, type ComponentType, type ReactNode } from 'react';
import { render as renderOriginal, renderHook as renderHookOriginal, type RenderOptions } from '@testing-library/react';
import { FetchQueryProvider, useCachedLoader, useFetchMutation, useFetchQuery, useFetchQueryScope, useInvalidate } from '@jini-ai/ui/fetch-query';
import { InfoTip, Lightbox, Select } from '@jini-ai/ui/admin-widgets';
import { UiKitProvider, type UiKit } from '@jini-ai/ui/react-kit';
import { ConfirmDialog, SecretInput, useConfirmController, useOverlayContainer, useSecretReveal } from '@jini-ai/ui-kit/react';
import { nativeKit, useNativeDialog } from '@jini-ai/ui-kit/react/native';
import { AdminKitProvider } from '../react/kit.js';
import { fakeAdminKit } from '../react/testing-kit.js';
import { useController } from '../core/react/use-controller.js';
import { FormsControllerContext } from '../forms/react/hooks/FormsPorts.hooks.js';
import { SeoControllerContext } from '../seo/react/hooks/SeoPorts.hooks.js';
import { RedirectsControllerContext } from '../redirects/react/hooks/RedirectsPorts.hooks.js';
import { MediaControllerContext } from '../media/react/hooks/MediaPorts.hooks.js';
import { WidgetsControllerContext } from '../widgets/react/hooks/WidgetsPorts.hooks.js';
import { CommentsControllerContext } from '../comments/react/hooks/CommentsPorts.hooks.js';
import { AgentPluginsControllerContext } from '../agent-plugins/react/hooks/AgentPluginsPorts.hooks.js';
import { SourceControlControllerContext } from '../source-control/react/hooks/SourceControlPorts.hooks.js';
export * from '@testing-library/react';

const uiKit = { components: { SecretInput }, hooks: { useOverlayContainer, useSecretReveal } } satisfies UiKit;
// Wave B C9 made the admin kit injected: every admin screen throws without <AdminKitProvider> at the root.
// query is ui's real fetch-query binding (as a host wires it), so hooks still fetch under FetchQueryProvider instead of the fake's canned data.
function pickNative(kit: typeof nativeKit) {
  const { Button, IconButton, TextField, TextArea, Select: NativeSelect, Switch, Dialog, Tabs, Menu, Notice, Spinner, Badge } = kit;
  return { Button, IconButton, TextField, TextArea, Select: NativeSelect, Switch, Dialog, ConfirmDialog, Tabs, Menu, Notice, Spinner, Badge };
}
export const testAdminKit = fakeAdminKit({
  // The searchable select, tooltip and lightbox are ui's real widgets, which a host binds into these slots.
  components: { ...pickNative(nativeKit), WidgetSelect: Select, InfoTip, Lightbox },
  hooks: { useConfirmController, useNativeDialog },
  query: { useFetchQuery, useFetchMutation, useCachedLoader, useInvalidate, useFetchQueryScope },
});

// J4 (owner 2026-11-17): domain modules receive their controller hook from the host; this scope
// plays the host for every domain, as it does for the admin kit.
const controllerContexts = [FormsControllerContext, SeoControllerContext, RedirectsControllerContext, MediaControllerContext, WidgetsControllerContext, CommentsControllerContext, AgentPluginsControllerContext, SourceControlControllerContext];
function withControllers(children: ReactNode) {
  return controllerContexts.reduce<ReactNode>((tree, context) => createElement(context.Provider, { value: useController }, tree), children);
}
/** Each rendered test tree owns one provider; rerenders retain it, independent tests do not. */
function scope(wrapper?: ComponentType<{ children: ReactNode }>) {
  return function QueryScope({ children }: { children: ReactNode }) {
    const inner = wrapper ? createElement(wrapper, { children }) : children;
    return createElement(UiKitProvider, {
      kit: uiKit,
      children: createElement(AdminKitProvider, { kit: testAdminKit, children: createElement(FetchQueryProvider, { children: withControllers(inner) }) }),
    });
  };
}
// Only the wrapper changes; retain Testing Library's query/container overloads.
export const render = ((ui: ReactNode, options?: RenderOptions) => renderOriginal(ui, { ...options, wrapper: scope(options?.wrapper) })) as typeof renderOriginal;
export const renderHook: typeof renderHookOriginal = (callback, options) => renderHookOriginal(callback, { ...options, wrapper: scope(options?.wrapper) });
