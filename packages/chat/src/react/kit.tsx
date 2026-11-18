/**
 * @file The UI contract every @jini-ai/chat React component renders through. Chat imports no UI
 * package (owner 2026-11-15: everything injected): it states the primitives, hooks and policy
 * ports it needs, with only the props it passes, and the host supplies them once via
 * <ChatKitProvider kit={...}>. Shapes are local copies so this package's published types pin no
 * UI library; the host proves compatibility with `const kit = {...} satisfies ChatKit`, so a UI
 * library prop change fails the host's typecheck at that line (same pattern as admin's AdminKit).
 *
 * Hook slots are only legal because the provider keeps the FIRST kit it receives: a kit whose hooks
 * changed identity between renders would break React's hook order.
 */
import { createContext, useContext, useState } from 'react';
import type { ComponentType, CSSProperties, DragEvent, InputHTMLAttributes, KeyboardEvent, ReactNode, RefObject, TextareaHTMLAttributes } from 'react';
import type { ChatAgentPolicyPort } from '../core/agents-port.js';
import type { ChatPaneAgentOption } from './features/chat-pane/types.js';

/* ---------- component props: only what chat passes ---------- */
export interface ChatIconProps { readonly name: string; readonly size?: number | undefined; readonly className?: string | undefined }
export interface ChatAgentIconProps { readonly id: string; readonly size?: number | undefined; readonly className?: string | undefined; readonly basePath?: string | undefined }
export interface ChatInfoTipProps {
  readonly label: string;
  /** Short accessible name; given, `label` becomes the icon's description. */
  readonly triggerLabel?: string | undefined;
  /** Id of an always-present hidden copy of `label`, so the explained control can point `aria-describedby` at it. */
  readonly descriptionId?: string | undefined;
  readonly placement?: 'top' | 'bottom' | 'inline' | undefined;
  readonly agentHandle?: string | false | undefined;
  /** What the trigger shows instead of the default ⓘ. Decorative. */
  readonly icon?: ReactNode | undefined;
}
export interface ChatTabBarTab {
  readonly id: string; readonly label: string; readonly icon?: ReactNode | undefined; readonly count?: number | undefined;
  readonly tag?: string | undefined; readonly disabled?: boolean | undefined; readonly handle?: string | undefined;
  readonly handleLabel?: string | undefined; readonly dot?: boolean | undefined; readonly dotLabel?: string | undefined;
}
export interface ChatTabBarProps {
  readonly tabs: readonly ChatTabBarTab[]; readonly activeId: string; readonly onChange: (id: string) => void;
  readonly ariaLabel: string; readonly containerHandle?: string | undefined;
}
interface SecretToggle { readonly label: string; readonly toggleLabels?: { readonly show: string; readonly hide: string } | undefined }
export type ChatSecretInputProps = SecretToggle & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;
export type ChatSecretTextareaProps = SecretToggle & TextareaHTMLAttributes<HTMLTextAreaElement>;
export interface ChatModelSelectProps {
  readonly models: readonly ChatPaneAgentOption[]; readonly value: string; readonly onChange: (value: string) => void;
  readonly ariaLabel: string; readonly searchPlaceholder: string; readonly menuClassName?: string | undefined;
  readonly agentHandle?: string | false | undefined;
}
export interface ChatWorkingDirPickerProps {
  readonly workingDir: string | null; readonly recentDirs: string[]; readonly onPickDirectory: () => void;
  readonly onSelectRecent: (dir: string) => void; readonly onClear?: (() => void) | undefined; readonly invalid?: boolean | undefined;
  readonly placement?: 'up' | 'down' | undefined; readonly onOpen?: (() => void) | undefined;
  readonly labels?: Partial<{ missing: string; hint: string; trigger: string; replace: string; pick: string; recent: string; recentEmpty: string; clear: string }> | undefined;
}

export interface ChatKitComponents {
  TabBar: ComponentType<ChatTabBarProps>;
  InfoTip: ComponentType<ChatInfoTipProps>;
  RemixIcon: ComponentType<ChatIconProps>;
  AgentIcon: ComponentType<ChatAgentIconProps>;
  SecretInput: ComponentType<ChatSecretInputProps>;
  SecretTextarea: ComponentType<ChatSecretTextareaProps>;
  SearchableModelSelect: ComponentType<ChatModelSelectProps>;
  WorkingDirPicker: ComponentType<ChatWorkingDirPickerProps>;
}

/* ---------- hooks ---------- */
export interface ChatInfoTipController {
  open: boolean; placement: 'above' | 'below';
  coords: { top: number; left: number; arrowLeft?: number | undefined };
  iconRef: RefObject<HTMLSpanElement | null>; bubbleRef?: RefObject<HTMLSpanElement | null>;
  show: () => void; hide: () => void; leave: () => void; toggle: () => void;
  pointerDown?: (e: { pointerType: string }) => void;
  handleIconKeyDown: (e: KeyboardEvent<HTMLSpanElement>) => void;
}
export interface ChatFileDropTarget {
  draggingFiles: boolean; dropReadError: string | null; clearDropReadError: () => void;
  onDragEnter: (event: DragEvent<Element>) => void; onDragOver: (event: DragEvent<Element>) => void;
  onDragLeave: (event: DragEvent<Element>) => void; onDrop: (event: DragEvent<Element>) => void;
}
export interface ChatKitHooks {
  /** The host owns handle validation and its agent runtime. */
  useAgentHandle(required: { agentHandle?: string | false | undefined }, optional?: Record<string, never>): string | undefined;
  useOverlayContainer(required?: Record<string, never>, optional?: Record<string, never>): HTMLElement | null;
  useInfoTip(required?: Record<string, never>, optional?: { placement?: 'top' | 'bottom' | undefined }): ChatInfoTipController;
  useFileDropTarget(onUploadFiles: (files: File[]) => void): ChatFileDropTarget;
  useFocusTrap(required: { containerRef: RefObject<HTMLElement | null> }, optional?: { active?: boolean | undefined }): void;
}

export interface ChatKit {
  readonly components: ChatKitComponents;
  readonly hooks: ChatKitHooks;
  readonly styles: { infoTipBubbleStyle(coords: { top: number; left: number; arrowLeft?: number | undefined }): CSSProperties };
  /** Model-selection and native-tool policy: the agent runtime's domain rules (C6 port). */
  readonly agents: ChatAgentPolicyPort;
}

/* ---------- provider ---------- */
const ChatKitContext = createContext<ChatKit | null>(null);

/** Mount once per React root that renders chat. The first kit is kept: hook slots must not change identity. */
export function ChatKitProvider(required: { kit: ChatKit; children: ReactNode }, _optional: Record<string, never> = {}) {
  const [kit] = useState(() => required.kit);
  return <ChatKitContext.Provider value={kit}>{required.children}</ChatKitContext.Provider>;
}

export function useChatKit(): ChatKit {
  const kit = useContext(ChatKitContext);
  if (!kit) throw new Error('@jini-ai/chat components need <ChatKitProvider kit={...}> above them. '
    + 'The host builds the kit from its UI library and agent runtime and mounts it once at each React root that renders chat.');
  return kit;
}

/* ---------- same-name facades: components change only their import line ---------- */
function slot<K extends keyof ChatKitComponents>(name: K): ChatKitComponents[K] {
  function ChatKitSlot(props: Record<string, unknown>) {
    const Impl = useChatKit().components[name] as unknown as ComponentType<Record<string, unknown>>;
    return <Impl {...props} />;
  }
  ChatKitSlot.displayName = `ChatKit.${name}`;
  return ChatKitSlot as unknown as ChatKitComponents[K];
}
export const TabBar = slot('TabBar');
export const InfoTip = slot('InfoTip');
export const RemixIcon = slot('RemixIcon');
export const AgentIcon = slot('AgentIcon');
export const SecretInput = slot('SecretInput');
export const SecretTextarea = slot('SecretTextarea');
export const SearchableModelSelect = slot('SearchableModelSelect');
export const WorkingDirPicker = slot('WorkingDirPicker');

export const useAgentHandle: ChatKitHooks['useAgentHandle'] = (r, o) => useChatKit().hooks.useAgentHandle(r, o);
export const useOverlayContainer: ChatKitHooks['useOverlayContainer'] = (r, o) => useChatKit().hooks.useOverlayContainer(r, o);
export const useInfoTip: ChatKitHooks['useInfoTip'] = (r, o) => useChatKit().hooks.useInfoTip(r, o);
export const useFileDropTarget: ChatKitHooks['useFileDropTarget'] = (onUploadFiles) => useChatKit().hooks.useFileDropTarget(onUploadFiles);
export const useFocusTrap: ChatKitHooks['useFocusTrap'] = (r, o) => useChatKit().hooks.useFocusTrap(r, o);
/** Chat's model-selection / native-tool policy, read once per render by the code that applies it. */
export function useChatAgentPolicy(): ChatAgentPolicyPort { return useChatKit().agents; }
