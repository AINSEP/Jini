/**
 * @module context
 *
 * The context objects `<JiniChatProvider>` (see
 * `../components/JiniChatProvider.js`) wires up, plus the `use*` accessor
 * hooks every presentational component in this package reads instead of
 * taking these as prop-drilled arguments. Split out from the provider
 * component itself so pure consumer hooks (`useT`, `useProjectContext`, ...)
 * don't need to import the composition-root component.
 *
 * Every context defaults to a safe no-op/passthrough so a component can be
 * unit-tested standalone (no `<JiniChatProvider>` mounted) — mirrors
 * `@jini-ai/ui`'s `useI18n`/`useT` passthrough convention, reimplemented
 * locally here since `@jini-ai/chat-react` cannot depend on `@jini-ai/ui` (not an
 * allowed dependency per `foundry/docs/jini-port/recon/r4b-webui-design.md` §1).
 */
import { createContext, useContext } from 'react';
import type { AnalyticsAdapter, I18nAdapter, ProjectContextValue } from '../slots.js';
import type { ChatTransport } from '@jini-ai/chat-core';
import type { RendererRegistry } from '../artifact-types.js';

const PASSTHROUGH_I18N: I18nAdapter = {
  t: (key, vars) => interpolate(key, vars),
  locale: 'en',
};

function interpolate(template: string, vars: Record<string, string | number> | undefined): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = vars[name];
    return value === undefined ? `{${name}}` : String(value);
  });
}

const NOOP_ANALYTICS: AnalyticsAdapter = { track: () => {} };

export const I18nContext = createContext<I18nAdapter>(PASSTHROUGH_I18N);
export const AnalyticsContext = createContext<AnalyticsAdapter>(NOOP_ANALYTICS);
export const ProjectContext = createContext<ProjectContextValue | undefined>(undefined);
export const ChatTransportContext = createContext<ChatTransport | undefined>(undefined);
export const ArtifactRegistryContext = createContext<RendererRegistry | undefined>(undefined);

/** Convenience for call sites that only need the translator function. */
export function useT(): I18nAdapter['t'] {
  return useContext(I18nContext).t;
}

export function useI18n(): I18nAdapter {
  return useContext(I18nContext);
}

export function useAnalytics(): AnalyticsAdapter {
  return useContext(AnalyticsContext);
}

/** `undefined` when no `<JiniChatProvider project={...}>` is mounted — components must treat project-dependent affordances (file links, uploads) as unavailable rather than throwing. */
export function useProjectContext(): ProjectContextValue | undefined {
  return useContext(ProjectContext);
}

/** Throws when read outside `<JiniChatProvider>` — unlike the other contexts, hooks that need a transport (`useConversation`/`useRunStream`) have no sensible no-op fallback. */
export function useChatTransport(): ChatTransport {
  const transport = useContext(ChatTransportContext);
  if (!transport) throw new Error('useChatTransport() must be called within <JiniChatProvider transport={...}>');
  return transport;
}

export function useArtifactRegistry(): RendererRegistry | undefined {
  return useContext(ArtifactRegistryContext);
}
