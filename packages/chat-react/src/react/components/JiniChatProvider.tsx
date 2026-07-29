/**
 * @module JiniChatProvider
 *
 * Wires transport, project, analytics, i18n, and the artifact-renderer
 * registry into context — exactly the `JiniChatProviderProps` shape from
 * `foundry/docs/jini-port/recon/r4b-webui-design.md` §2. This is the ONE file in
 * this package's presentational layer allowed to bind concrete
 * adapters/slots to context (mirrors the OD slice discipline's
 * "only `dependencies.ts` binds a provider" rule, per §5's engine-core
 * boundary lint item 3 — the composition-root analogue for a package
 * instead of a feature slice).
 *
 * `slots`/`onFeedback`/`toolRegistry` are threaded through unchanged for a
 * consuming host to read via `useJiniChatSlots()`/`useOnFeedback()` — this
 * package's own components (`<Composer>`, `<MessageRow>`, ...) take the
 * slots they need directly as props rather than reading them from context
 * implicitly, so a host retains full control over composition; the context
 * value exists for a host's OWN wrapper components to reach the same slots
 * without re-threading props through every layer.
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { ChatTransport, OnFeedback } from '@jini-ai/chat-core';
import type { AnalyticsAdapter, AttachmentTraySlot, ComposerSlots, FilePreviewSlot, I18nAdapter, ModelAgentPickerSlot, AnnotationAdapter, ProjectContextValue } from '../../slots.js';
import type { RendererRegistry } from '../../artifact-types.js';
import { AnalyticsContext, ArtifactRegistryContext, ChatTransportContext, I18nContext, ProjectContext } from '../hooks/context.js';

export interface JiniChatSlots {
  modelPicker?: ModelAgentPickerSlot;
  composer?: ComposerSlots;
  filePreview?: FilePreviewSlot;
  annotation?: AnnotationAdapter;
  attachmentTray?: AttachmentTraySlot;
}

export interface JiniChatProviderProps {
  transport: ChatTransport;
  project?: ProjectContextValue;
  analytics?: AnalyticsAdapter;
  i18n?: I18nAdapter;
  artifactRegistry?: RendererRegistry;
  slots?: JiniChatSlots;
  onFeedback?: OnFeedback;
  children: ReactNode;
}

const JiniChatSlotsContext = createContext<JiniChatSlots>({});
const OnFeedbackContext = createContext<OnFeedback | undefined>(undefined);

export function JiniChatProvider({ transport, project, analytics, i18n, artifactRegistry, slots, onFeedback, children }: JiniChatProviderProps) {
  let tree = (
    <ChatTransportContext.Provider value={transport}>
      <JiniChatSlotsContext.Provider value={slots ?? {}}>
        <OnFeedbackContext.Provider value={onFeedback}>{children}</OnFeedbackContext.Provider>
      </JiniChatSlotsContext.Provider>
    </ChatTransportContext.Provider>
  );
  if (artifactRegistry) tree = <ArtifactRegistryContext.Provider value={artifactRegistry}>{tree}</ArtifactRegistryContext.Provider>;
  if (project) tree = <ProjectContext.Provider value={project}>{tree}</ProjectContext.Provider>;
  if (analytics) tree = <AnalyticsContext.Provider value={analytics}>{tree}</AnalyticsContext.Provider>;
  if (i18n) tree = <I18nContext.Provider value={i18n}>{tree}</I18nContext.Provider>;
  return tree;
}

export function useJiniChatSlots(): JiniChatSlots {
  return useContext(JiniChatSlotsContext);
}

export function useOnFeedback(): OnFeedback | undefined {
  return useContext(OnFeedbackContext);
}
