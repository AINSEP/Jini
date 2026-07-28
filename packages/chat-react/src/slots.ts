/**
 * @module slots
 *
 * The slot/adapter interfaces a host injects into `<JiniChatProvider>` (or
 * passes directly to a headless hook) to supply everything this package
 * deliberately does not own: project/workspace file access, model/agent
 * optional picker overrides, composer extension points, attachment rendering,
 * analytics, and i18n. Every OD-domain widget (OdCard, design-toolbox, brand-browser,
 * plugin folders, sketch preview, comments/annotation, AMR billing,
 * model/agent picker, file preview) is a host concern reached through one of
 * these slots — see `foundry/docs/jini-port/recon/r4b-webui-design.md` §2, which
 * this module implements field-for-field.
 *
 * Only `import type { ReactNode }` is used here (no JSX, no React runtime
 * value import), so this file stays at the package's top level per the
 * react-layout policy in `foundry/docs/jini-port/god-components-extraction-plan.md`
 * — everything that actually renders (hooks, components) lives under
 * `react/`.
 */
import type { ReactNode } from 'react';
import type { ChatAttachment } from '@jini-ai/chat-core';
import type { ArtifactFile } from './artifact-types.js';
import type { FeedbackChange, OnFeedback } from './transport.js';

export type { FeedbackChange, OnFeedback };

/**
 * Replaces OD's threaded `Project`/`ProjectFile`/`Workspace` props
 * (`providers/registry.projectFileUrl`/`projectRawUrl`) with one injected
 * value a host supplies once, high in its tree.
 */
export interface ProjectContextValue {
  projectId: string | null;
  files: ArtifactFile[];
  resolveFileUrl: (path: string) => string;
  resolveRawUrl: (path: string) => string;
  uploadFiles?: (files: File[]) => Promise<ChatAttachment[]>;
  linkedDirs?: string[];
}

/** One selectable agent/model entry a host's picker UI lists. */
export interface AgentOption {
  id: string;
  label: string;
  description?: string;
  models?: string[];
}

export interface AgentSelection {
  agentId: string;
  model?: string;
  sessionMode?: string;
}

/**
 * Optional custom model/agent picker slot for lower-level Composer consumers.
 * The self-contained `ChatPane` exports its own default `AgentRuntimePicker`;
 * this slot remains useful when composing the headless primitives directly.
 */
export interface ModelAgentPickerSlot {
  value: AgentSelection;
  onChange: (next: AgentSelection) => void;
  render?: (props: { value: AgentSelection; onChange: (next: AgentSelection) => void; agents: AgentOption[] }) => ReactNode;
}

/** Generalizes `ComposerPlusMenu`/`LibraryPicker`/Figma-import/plugin entries. */
export interface ComposerPlusItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void | Promise<ChatAttachment | null>;
}

/** One `@`-mention entry an OD skill/file/plugin picker (or any host source) supplies. */
export interface MentionResult {
  id: string;
  label: string;
  description?: string;
  insertText?: string;
}

export interface MentionSource {
  id: string;
  label: string;
  /** Trigger character(s), e.g. `'@'`. Defaults to `'@'` when omitted. */
  trigger?: string;
  search: (query: string) => MentionResult[] | Promise<MentionResult[]>;
}

export interface ComposerSlots {
  plusMenuItems?: ComposerPlusItem[];
  mentionSources?: MentionSource[];
  /** e.g. a SessionModeToggle / DesignSystemSwitchPicker-equivalent. */
  leadingAccessories?: ReactNode;
  /** Host controls rendered before the send action, such as an agent/model picker. */
  footerAccessories?: ReactNode;
  onAttach?: (a: ChatAttachment) => void;
  annotationAdapter?: AnnotationAdapter;
}

export interface AttachmentTraySlot {
  attachments: ChatAttachment[];
  onRemove: (id: string) => void;
  /** Host renders exotic attachment kinds it knows about; falls back to the built-in chip. */
  renderItem?: (a: ChatAttachment) => ReactNode;
}

/** Optional comment/annotation bridge (OD's `comments.ts` + `PreviewDrawOverlay`). */
export interface AnnotationAdapter {
  enabled: boolean;
  toAttachment: (selection: unknown) => ChatAttachment;
  displayName: (a: ChatAttachment) => string;
}

/** Host-supplied file-preview UI (OD's `FileViewer`/`FileWorkspace` are product-specific). */
export interface FilePreviewSlot {
  render: (props: { file: ArtifactFile; onClose?: () => void }) => ReactNode;
}

/** Default no-op; a host wires its own analytics provider through this shape. */
export interface AnalyticsAdapter {
  track: (event: string, props?: Record<string, unknown>) => void;
}

/**
 * Default passthrough (`t(key)` returns `key`); a host supplies a real
 * dictionary-backed translator. Every user-facing string in this package's
 * components is wrapped in `useT()`'s `t()` — the English string itself is
 * the key, per the i18n policy in
 * `foundry/docs/jini-port/god-components-extraction-plan.md`.
 */
export interface I18nAdapter {
  t: (key: string, vars?: Record<string, string | number>) => string;
  locale: string;
}
